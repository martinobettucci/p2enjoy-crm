#!/usr/bin/env bash
# @verifies CRM-065 (docs/BACKLOG.md) — recherche globale, TRANCHE 1 : la recherche en base
# @verifies docs/SPEC-recherche.md §3 (le vocabulaire et ce qu'il garantit), §4 (les cinq familles
#           et leurs poids), §5 (les index d'expression, et les deux index GIN de `cards`),
#           §6.2 (le terme devient une requête), §6.3 (volatilité, `security invoker`, privilèges),
#           §6.6 (ordre et bornes), §6.7 (les quinze lignes du contrat), §9 (preuves dues)
# @verifies docs/SCHEMA.md §9 bis.9 ter ; docs/PROD_MIGRATIONS.md §3 (migration 68)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée, et Node 24 sourcé (`nvm use`).
#
#   scripts/verify-recherche.sh            série complète, dégradations comprises
#   scripts/verify-recherche.sh --rapide   n'exécute pas Playwright — les mesures et les
#                                          dégradations de la base seulement
#
# CE QUE CE HARNAIS ÉPROUVE, ET QU'AUCUN AUTRE N'ÉPROUVE. La tranche 1 ne livre AUCUNE surface :
# tout ce qu'elle promet vit dans une migration. Un harnais qui se bornerait à lire le catalogue
# certifierait la FORME de la fonction — sa volatilité, son `prosecdef`, ses privilèges — sans jamais
# établir que ces propriétés SERVENT à quelque chose. Les sept dégradations ci-dessous retirent
# chacune UNE promesse du §6, appliquent réellement la migration amputée, et regardent les preuves
# rougir.
#
# LA PREMIÈRE EST LA PLUS UTILE, ET ELLE EST SANS ÉQUIVALENT DANS LE DÉPÔT POUR CETTE UNITÉ : elle
# rend la fonction `SECURITY DEFINER` en laissant son corps, ses colonnes, ses index et ses
# privilèges intacts. La recherche continue de rendre des lignes, ordonnées, avec leurs extraits —
# mais elle les calcule pour `postgres`, qui traverse toute la RLS. Une suite qui resterait verte
# prouverait qu'elle ne mesure que la forme de la fonction, jamais QUI la calcule ; et le produit
# aurait, lui, une fuite silencieuse : chacun trouverait les affaires, les contacts et les messages
# de tous.
#
# LA TROISIÈME REMET `french` À LA PLACE DE `app.francais_sans_accent`, ce qui est exactement la
# « simplification » qu'un lecteur pressé pourrait faire un jour, la configuration dérivée ayant
# l'air redondante. Elle mesure ce que la contre-épreuve de la suite pgTAP interdit d'oublier :
# `french` ne trouve « créance » sur « creance » qu'une fois sur deux (§2 M2).

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0068_recherche_globale.sql
SUITE_SQL=supabase/tests/0065_recherche_globale.test.sql
SUITE_API=e2e/api/recherche-globale.spec.ts
SPEC=docs/SPEC-recherche.md
SCHEMA=docs/SCHEMA.md
CONTRAT=docs/PROD_MIGRATIONS.md
REGISTRE=docs/INCONSISTENCY_REPORT.md

RAPIDE=false
for argument in "$@"; do
	case "$argument" in
		--rapide) RAPIDE=true ;;
		*) echo "ERREUR : option inconnue « $argument »." >&2; exit 2 ;;
	esac
done

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
migration_degradee=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	# LA BASE EST RENDUE SANS CONDITION, et c'est le point le plus important de ce fichier : une
	# fonction laissée `SECURITY DEFINER` par un harnais interrompu serait une FUITE persistante,
	# invisible à `git diff` puisqu'elle ne vit que dans la base.
	if [ "$migration_degradee" = true ]; then
		docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
			<"$MIGRATION" >/dev/null 2>&1
		printf 'restauration de secours : la migration 0068 a été rejouée.\n' >&2
	fi
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

mesurer() {
	local libelle=$1 requete=$2 attendu=$3 obtenu
	obtenu=$(psql_db -c "$requete" 2>/dev/null | tr -d '[:space:]')
	if [ "$obtenu" = "$attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — attendu « $attendu », mesuré « $obtenu »"
	fi
}

contient() {
	local libelle=$1 fichier=$2 motif=$3
	if grep -qF -- "$motif" "$fichier"; then
		ok "$libelle"
	else
		fail "$libelle — motif absent de $fichier"
	fi
}

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/pgtap.log" 2>&1
}

suite_api_verte() {
	npx playwright test --config=e2e/playwright.config.ts --project=api \
		"$(basename "$SUITE_API")" >"$TRAVAIL/api.log" 2>&1
}

# Dégrade la BASE — la migration est copiée, amputée, appliquée, la suite pgTAP rejouée, puis la
# migration d'origine est réappliquée. `psql` doit avoir ACCEPTÉ la copie dégradée : sans cette
# vérification, une dégradation refusée laisserait le produit intact et le harnais accuserait à tort
# sa propre suite d'être complaisante (leçon de la décision 503).
eprouver_base() {
	local nom=$1 avant=$2 apres=$3
	local copie="$TRAVAIL/degradee.sql"
	if ! python3 - "$MIGRATION" "$copie" "$avant" "$apres" 2>"$TRAVAIL/substitution.log" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : $(tr -d '\n' <"$TRAVAIL/substitution.log")"
		return 0
	fi
	if ! docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		<"$copie" >"$TRAVAIL/degradation.log" 2>&1; then
		fail "dégradation « $nom » REFUSÉE par psql : le produit est intact, rien n'a été éprouvé"
		return 0
	fi
	migration_degradee=true
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		<"$MIGRATION" >/dev/null 2>&1
	migration_degradee=false
}

echo
echo "Preuves de CRM-065 tranche 1 — la recherche globale en base"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi
if [ "$RAPIDE" = false ] && ! command -v npx >/dev/null 2>&1; then
	echo "ERREUR : npx introuvable. Exécutez « nvm use » puis relancez." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité — CLAUDE.md §5"
# =================================================================================================

contient "la migration cite son unité de backlog" "$MIGRATION" '@spec CRM-065'
contient "la migration cite sa spécification" "$MIGRATION" 'docs/SPEC-recherche.md'
contient "la suite pgTAP cite ce qu'elle vérifie" "$SUITE_SQL" '@verifies CRM-065'
contient "le contrat d'API cite ce qu'il vérifie" "$SUITE_API" '@verifies CRM-065'
contient "la spécification porte le contrat de la fonction" "$SPEC" \
	'## 6. `public.recherche_globale` — le contrat'
contient "la spécification porte les quinze lignes du contrat" "$SPEC" \
	'### 6.7 Refus et cas limites — le contrat ligne à ligne'
contient "le schéma décrit la fonction" "$SCHEMA" '### 9 bis.9 ter'
contient "le contrat de déploiement porte la migration 68" "$CONTRAT" \
	'| 68 — `CRM-065` |'
contient "le registre porte l'écart de vocabulaire laissé inchangé" "$REGISTRE" 'INC-230'

# =================================================================================================
echo "2. Le vocabulaire — docs/SPEC-recherche.md §3"
# =================================================================================================

mesurer "l'extension unaccent est installée" \
	"select count(*) from pg_extension where extname = 'unaccent';" 1
mesurer "la configuration app.francais_sans_accent existe" \
	"select count(*) from pg_ts_config c join pg_namespace n on n.oid = c.cfgnamespace
	  where n.nspname = 'app' and c.cfgname = 'francais_sans_accent';" 1

# LA CONTRE-ÉPREUVE DU VOCABULAIRE, MESURÉE ICI AUSSI. Elle ne coûte rien et elle empêche la
# question « à quoi sert cette configuration ? » de se reposer un jour sans réponse.
mesurer "french seule NE TROUVE PAS « créance » sur « creance »" \
	"select to_tsvector('pg_catalog.french','créance') @@ plainto_tsquery('pg_catalog.french','creance');" f
mesurer "la configuration dérivée la trouve" \
	"select to_tsvector('app.francais_sans_accent','créance')
	     @@ plainto_tsquery('app.francais_sans_accent','creance');" t
mesurer "et dans l'autre sens" \
	"select to_tsvector('app.francais_sans_accent','creance')
	     @@ plainto_tsquery('app.francais_sans_accent','créance');" t

# `default_text_search_config` N'A PAS BOUGÉ (§3.3). La changer altérerait silencieusement tout
# appel à un argument de `to_tsvector` écrit ailleurs dans le produit — `cards.search_tsv` la
# nomme explicitement, mais rien ne garantit que le prochain le fera.
mesurer "default_text_search_config est resté au défaut" \
	"select current_setting('default_text_search_config');" pg_catalog.english

# =================================================================================================
echo "3. Les index, et ce qu'ils n'ont pas changé — §5"
# =================================================================================================

mesurer "les cinq index GIN de la recherche existent" \
	"select count(*) from pg_class c
	   join pg_namespace n on n.oid = c.relnamespace
	   join pg_am am on am.oid = c.relam
	  where n.nspname = 'public' and c.relname like '%\\_recherche\\_idx' and am.amname = 'gin';" 5

# LA TRANCHE N'AJOUTE AUCUNE COLONNE, ET LA SEULE QUI EXISTE EST CELLE DE `CRM-040` (§5.4, M12).
mesurer "aucune colonne tsvector neuve : seule cards.search_tsv existe" \
	"select coalesce(string_agg(table_name || '.' || column_name, ','), '')
	   from information_schema.columns
	  where table_schema = 'public'
	    and table_name in ('cards','contacts','organizations','card_comments','mail_messages')
	    and data_type = 'tsvector';" cards.search_tsv
mesurer "l'index de la recherche LOCALE de CRM-040 est intact" \
	"select count(*) from pg_indexes
	  where tablename = 'cards' and indexname = 'cards_search_tsv_idx';" 1

# =================================================================================================
echo "4. La forme de la fonction et ses privilèges — §6.3"
# =================================================================================================

mesurer "security invoker — jamais definer" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale';" f
mesurer "stable — donc joignable en GET par PostgREST" \
	"select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale';" s
mesurer "search_path vide" \
	"select array_to_string(proconfig, ',') from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale';" 'search_path=""'
mesurer "anon n'a PAS execute" \
	"select has_function_privilege('anon','public.recherche_globale(text,integer)','EXECUTE');" f
mesurer "authenticated a execute" \
	"select has_function_privilege('authenticated','public.recherche_globale(text,integer)','EXECUTE');" t
mesurer "service_role a execute" \
	"select has_function_privilege('service_role','public.recherche_globale(text,integer)','EXECUTE');" t

# =================================================================================================
echo "5. Ce que la tranche n'a PAS touché — §7"
# =================================================================================================
# Une migration qui n'ouvre rien doit se PROUVER, pas s'affirmer. Les cinq politiques de lecture
# qu'elle traverse sont celles d'avant, et le compte de politiques de `public` n'a pas bougé du
# fait de cette tranche.

mesurer "les cinq politiques de lecture traversées sont intactes" \
	"select count(*) from pg_policies
	  where schemaname = 'public' and cmd = 'SELECT'
	    and policyname in ('cards_lecture','contacts_lecture_membre','organizations_lecture_membre',
	                       'card_comments_lecture','mail_messages_lecture');" 5
mesurer "aucune politique n'est née sur les cinq tables cherchées" \
	"select count(*) from pg_policies
	  where schemaname = 'public'
	    and tablename in ('cards','contacts','organizations','card_comments','mail_messages');" 16

# =================================================================================================
echo "6. Le comportement, sous les jetons simulés des trois profils — §6.7"
# =================================================================================================

sous() {
	local libelle=$1 profil=$2 requete=$3 attendu=$4
	mesurer "$libelle" \
		"set local role authenticated;
		 set local request.jwt.claims to '{\"sub\":\"5eed0000-0000-4000-8000-0000000000$profil\",\"role\":\"authenticated\"}';
		 $requete" "$attendu"
}

sous "l'administratrice trouve les deux affaires « audi » (préfixe)" 11 \
	"select count(*) from public.recherche_globale('audi', 20);" 2
sous "« refonte » traverse trois familles" 11 \
	"select count(distinct objet) from public.recherche_globale('refonte', 20);" 3
sous "« elise » trouve « Élise Fabre », saisie sans accent" 11 \
	"select count(*) from public.recherche_globale('elise', 20);" 1
sous "la conjonction refuse « audit zzzzz »" 11 \
	"select count(*) from public.recherche_globale('audit zzzzz', 20);" 0
sous "les mots vides seuls rendent zéro" 11 \
	"select count(*) from public.recherche_globale('le la de', 20);" 0
sous "la lectrice ne trouve PAS l'affaire fermée" 13 \
	"select count(*) from public.recherche_globale('vitrine', 20);" 0
sous "la lectrice ne trouve PAS son commentaire" 13 \
	"select count(*) from public.recherche_globale('gabarit', 20);" 0
sous "la lectrice ne trouve PAS le message non classé" 13 \
	"select count(*) from public.recherche_globale('candidature', 20);" 0
# LA CONTRE-ÉPREUVE DES TROIS REFUS : sans elle, ils seraient également verts sur une fonction
# muette, un vocabulaire cassé ou un index absent.
sous "et la lectrice trouve bien les cinq lignes qu'elle a le droit de lire" 13 \
	"select count(*) from public.recherche_globale('astreint', 20);" 5
# « vitrine » est porté par DEUX familles — l'affaire, et le message dont le corps la nomme —, et
# c'est ce qui en fait un bon témoin : une fonction qui aurait perdu une famille rendrait encore
# une ligne. Le compte est donc mesuré par famille, pas globalement.
sous "le business developer lit l'affaire ET le message classé de « vitrine »" 12 \
	"select count(*) filter (where objet = 'affaire')::text || '/' ||
	        count(*) filter (where objet = 'message')::text
	   from public.recherche_globale('vitrine', 20);" 1/1
sous "et il ne lit pas le message non classé" 12 \
	"select count(*) from public.recherche_globale('candidature', 20);" 0

# =================================================================================================
echo "7. Les suites, avant toute dégradation"
# =================================================================================================

if suite_sql_verte; then
	ok "la suite pgTAP est VERTE avant dégradation"
else
	fail "la suite pgTAP est ROUGE avant toute dégradation — rien ne peut être éprouvé ensuite"
fi

if [ "$RAPIDE" = false ]; then
	if suite_api_verte; then
		ok "le contrat d'API est VERT avant dégradation"
	else
		fail "le contrat d'API est ROUGE avant toute dégradation"
	fi
else
	echo "  (--rapide : le contrat d'API n'est pas exécuté)"
fi

# =================================================================================================
echo "8. Les dégradations — docs/SPEC-test-harness.md §7.2"
# =================================================================================================

# 1. LA FUITE. La fonction répond pour `postgres`, qui traverse toute la RLS.
eprouver_base "security invoker devient definer" \
	'security invoker
set search_path = '"''"'' \
	'security definer
set search_path = '"''"''

# 2. LE PRIVILÈGE RENDU À L'ANONYME. `200 []` au lieu de `401`, et la porte rouverte en silence.
eprouver_base "anon retrouve execute" \
	'revoke all on function public.recherche_globale(text, integer) from public, anon;' \
	'grant execute on function public.recherche_globale(text, integer) to anon;'

# 3. LE VOCABULAIRE REMIS À `french`. La « simplification » que la contre-épreuve interdit.
# L'ANCRAGE DOIT ÊTRE UNIQUE, ET AUCUNE EXPRESSION SEULE NE L'EST : le §5.2 impose que la clause
# `where` et le calcul du rang portent la MÊME expression, mot pour mot, sans quoi l'index cesse
# d'être retenu. Le motif ci-dessous prend donc la fin de la clause `where` du contact — le
# `) @@ v_requete` qui la termine —, que le calcul du rang n'a pas.
# LA PREMIÈRE VERSION DE CETTE DÉGRADATION ÉTAIT INERTE, ET C'EST CE HARNAIS QUI L'A DIT. Elle ne
# remplaçait que le DERNIER des trois termes de la clause : les deux premiers gardaient le bon
# vocabulaire, « elise » continuait de trouver « Élise Fabre », et la suite pgTAP restait
# légitimement verte. Le harnais a rendu « COMPLAISANT », ce qui était le bon signal sur la
# mauvaise cible — la preuve n'était pas complaisante, la dégradation était fausse. Elle porte
# désormais sur la clause ENTIÈRE.
eprouver_base "le vocabulaire redevient french dans la requête du contact" \
	"	 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C')
		   ) @@ v_requete" \
	"	 where (
				setweight(to_tsvector('pg_catalog.french', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('pg_catalog.french', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('pg_catalog.french', coalesce(ct.role_title, '')), 'C')
		   ) @@ v_requete"

# 4. LE PRÉFIXE RETIRÉ. « audi » ne trouve plus rien avant le dernier caractère.
eprouver_base "le suffixe :* du préfixe disparaît" \
	"select coalesce(string_agg(mot || ':*', ' & '), '')" \
	"select coalesce(string_agg(mot, ' & '), '')"

# 5. LA CONJONCTION DEVIENT UNE UNION. La ligne cherchée se noie dès le deuxième mot.
eprouver_base "la conjonction devient une union" \
	"select coalesce(string_agg(mot || ':*', ' & '), '')" \
	"select coalesce(string_agg(mot || ':*', ' | '), '')"

# 6. LA BORNE DU SERVEUR DISPARAÎT. Un client demanderait alors ce qu'il veut.
eprouver_base "le plafond de 50 disparaît" \
	'v_limite := least(coalesce(p_limite, 0), 50);' \
	'v_limite := coalesce(p_limite, 0);'

# 7. LE COMMENTAIRE NE SUIT PLUS SON AFFAIRE À LA CORBEILLE. La palette offrirait une destination
#    morte — c'est la règle que la mesure M13 a imposée.
eprouver_base "le commentaire d'une affaire à la corbeille redevient trouvable" \
	'		   and not exists (
				select 1
				  from public.cards cx
				 where cx.id = cc.card_id
				   and cx.deleted_at is not null
		   )
' \
	''

# =================================================================================================
echo "9. Après restauration — la base est rendue, et c'est CONSTATÉ"
# =================================================================================================

mesurer "security invoker est rétabli" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale';" f
mesurer "anon est de nouveau sans execute" \
	"select has_function_privilege('anon','public.recherche_globale(text,integer)','EXECUTE');" f
mesurer "les cinq index sont de nouveau là" \
	"select count(*) from pg_class c
	   join pg_namespace n on n.oid = c.relnamespace
	   join pg_am am on am.oid = c.relam
	  where n.nspname = 'public' and c.relname like '%\\_recherche\\_idx' and am.amname = 'gin';" 5

if suite_sql_verte; then
	ok "après restauration : la suite pgTAP est VERTE — la base est rendue"
else
	fail "après restauration : la suite pgTAP reste ROUGE, la base n'a PAS été rendue"
fi

if [ "$RAPIDE" = false ]; then
	if suite_api_verte; then
		ok "après restauration : le contrat d'API est VERT — la base est rendue"
	else
		fail "après restauration : le contrat d'API reste ROUGE, la base n'a PAS été rendue"
	fi
fi

# =================================================================================================
echo "10. Le seed est intact"
# =================================================================================================
# Le harnais ne devrait rien avoir écrit — la recherche est une lecture, et les dégradations ne
# touchent que des définitions. La vérification est faite plutôt que supposée : c'est le seul moyen
# de distinguer « je n'ai rien écrit » de « je ne l'ai pas regardé ».

# QUARANTE ET UNE, ET LA VALEUR A ÉTÉ PRISE SUR UNE BASE AU REPOS. Mesurée pendant qu'une autre
# série de harnais tournait, elle rend 42 : ces harnais posent et retirent leurs propres affaires.
# Un compteur relevé au milieu d'une série fige un état transitoire, pas le seed.
mesurer "quarante et une affaires, dont une à la corbeille" \
	"select count(*) from public.cards;" 41
mesurer "aucune affaire n'a été mise à la corbeille par ce harnais" \
	"select count(*) from public.cards where deleted_at is not null;" 1
mesurer "trois contacts" "select count(*) from public.contacts;" 3
mesurer "cinq commentaires" "select count(*) from public.card_comments;" 5
mesurer "quatre messages" "select count(*) from public.mail_messages;" 4

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
