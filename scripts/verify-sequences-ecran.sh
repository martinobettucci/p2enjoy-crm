#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
#           TRANCHE 4, SOUS-TRANCHE 4c : L'ÉCRAN
# @verifies docs/SPEC-modeles-emails.md §13.2 (la mesure qui RÉVISE le §11.6 bis, et l'absence de
#           `set constraints`), §13.3 (la RPC, ses refus, ses privilèges), §13.4 (où l'écran vit),
#           §13.5 (la liste), §13.5 bis (l'embarquement ambigu et la relation NOMMÉE), §13.6 (la
#           fiche et le réordonnancement), §13.7 (le dictionnaire fermé), §13.8 (l'armement),
#           §13.9 (la confirmation de suppression d'un modèle, révisée), §13.12 (les preuves)
# @verifies docs/DESIGN_SYSTEM.md §5.41 et §5.42 ; docs/PROD_MIGRATIONS.md §3 (migration 62)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la sous-tranche, puis DÉGRADE RÉELLEMENT — la migration de la
# RPC et le module de données des écrans — et exige que la preuve concernée rougisse. Aucun état
# dégradé ne subsiste, même en cas d'échec : les deux fichiers sont restaurés par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la preuve la dénonce ; une dégradation qui laisserait la preuve verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# LA DÉGRADATION LA PLUS IMPORTANTE DE CE HARNAIS EST D-C, ET ELLE MÉRITE D'ÊTRE LUE. Elle fait
# passer la RPC en `security definer` : la lectrice écrirait alors, la politique d'écriture de la
# migration 59 cessant d'être opposable par cette porte. C'est exactement la décision du §13.1
# question 2, et si la suite pgTAP restait verte, cette décision ne serait éprouvée nulle part.
#
# DEUX CONTRÔLES PORTENT SUR CE QUI N'EST PAS LÀ, et ils sont les plus fragiles à écrire — le §9.10
# bis a payé ce piège une fois. Le corps de la RPC ne doit contenir AUCUN `set constraints`
# (§13.2), et l'écran ne doit porter AUCUNE garde de saisie (§5.3 ter) : les deux lisent le CODE
# SANS SES COMMENTAIRES, faute de quoi ils trouveraient les mots dans la prose qui explique
# pourquoi ils sont absents, et rendraient un FAUX ROUGE.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu
# (`docs/SPEC-test-harness.md` §7.2 point 3) : aucun ENVOI — la sous-tranche ne met aucun message
# en file ; aucune EXÉCUTION du job de la 4b ; aucune PRÉVISUALISATION d'une séquence entière, que
# le §13.14 point 1 écarte explicitement.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0062_reordonnancement_paliers.sql
MODULE=webapp/src/lib/sequences-relance.ts
ECRAN=webapp/src/app/ReglagesSequencesRelance.tsx
BLOC=webapp/src/app/BlocSequenceCard.tsx
SUITE_SQL=supabase/tests/0060_reordonnancement_paliers.test.sql
SUITE_UNITAIRE=webapp/src/lib/sequences-relance.test.ts
SUITE_API=e2e/api/reordonnancement-paliers.spec.ts
SUITE_UI=e2e/ui/reglages-sequences-relance.spec.ts
SUITE_UI_ARMEMENT=e2e/ui/armement-sequence.spec.ts
SPEC=docs/SPEC-modeles-emails.md
DESIGN=docs/DESIGN_SYSTEM.md

WORKSPACE=5eed0000-0000-4000-8000-000000000001
SEQUENCE_SEED=5e900000-0000-4000-8000-000000000001
SEQUENCES_DU_SEED=1
PALIERS_DU_SEED=3
CHEMIN_ECRAN='/reglages/sequences-relance'

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_sql_due=false
restauration_module_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_sql_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
	fi
	# LE MODULE EST RESTAURÉ DEPUIS L'INSTANTANÉ, jamais depuis `git checkout` : le harnais doit
	# fonctionner dans un arbre portant une évolution légitime non encore committée.
	if [ "$restauration_module_due" = true ] && [ -f "$TRAVAIL/module.origine" ]; then
		cp "$TRAVAIL/module.origine" "$MODULE"
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

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

suite_unitaire_verte() {
	npx vitest run "$SUITE_UNITAIRE" >"$TRAVAIL/unit.log" 2>&1
}

# LE CODE SANS SES COMMENTAIRES — remède du §9.10 bis, repris tel quel plutôt que redécouvert. Un
# contrôle qui cherche ce que le code s'INTERDIT et qui lit le fichier brut trouve les mots dans le
# commentaire qui explique pourquoi ils sont absents, et rend un FAUX ROUGE.
code_seul() {
	python3 - "$1" <<-'PY'
		import io, re, sys
		texte = io.open(sys.argv[1], encoding='utf-8').read()
		texte = re.sub(r'/\*.*?\*/', '', texte, flags=re.S)
		texte = re.sub(r'^\s*//.*$', '', texte, flags=re.M)
		sys.stdout.write(texte)
	PY
}

# Substitue dans une COPIE du fichier visé, puis l'installe. La copie précédente est DÉTRUITE
# d'abord, et l'échec du substituteur est TESTÉ : c'est le défaut que les harnais jumeaux ont trouvé
# dans leur propre code (§2.11 puis §8.9 bis), et le remède est repris ici tel quel.
substituer() {
	local source=$1 cible=$2 avant=$3 apres=$4 nom=$5
	rm -f -- "$cible"
	if ! python3 - "$source" "$cible" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : motif absent ou ambigu dans $source"
		return 1
	fi
	if cmp -s "$source" "$cible"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	return 0
}

# LA DÉGRADATION SQL DOIT S'APPLIQUER, et son code de retour est TESTÉ : une dégradation dont le SQL
# ne compile pas laisse la base INCHANGÉE, la suite reste verte, et le harnais conclurait
# « COMPLAISANT » alors que rien n'a été dégradé (§8.9 bis).
degrader_sql() {
	local avant=$1 apres=$2 nom=$3
	substituer "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" "$nom" || return 1
	restauration_sql_due=true
	if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation « $nom » IMPOSSIBLE : le SQL dégradé ne s'applique pas — $(tail -n 1 "$TRAVAIL/degrade.log")"
		restaurer_sql
		return 1
	fi
	return 0
}

restaurer_sql() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_sql_due=false
}

eprouver_degradation_sql() {
	local nom=$1 avant=$2 apres=$3
	degrader_sql "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer_sql
}

eprouver_degradation_module() {
	local nom=$1 avant=$2 apres=$3
	substituer "$MODULE" "$TRAVAIL/degrade.ts" "$avant" "$apres" "$nom" || return 0
	restauration_module_due=true
	cp "$TRAVAIL/degrade.ts" "$MODULE"
	if suite_unitaire_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite unitaire reste VERTE"
	else
		ok "dégradation « $nom » : la suite unitaire rougit, comme elle doit"
	fi
	cp "$TRAVAIL/module.origine" "$MODULE"
	restauration_module_due=false
}

echo
echo "Preuves de CRM-063 sous-tranche 4c — l'écran des séquences et l'armement depuis l'affaire"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# LES INSTANTANÉS SONT PRIS AVANT LA PREMIÈRE DÉGRADATION, et non contre `HEAD`
# (`docs/SPEC-test-harness.md` §7.2 point 9).
cp "$MIGRATION" "$TRAVAIL/migration.origine"
cp "$MODULE" "$TRAVAIL/module.origine"

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la sous-tranche n'est orphelin de sa spécification"
# =================================================================================================

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-063' \
	&& head -n 12 "$MIGRATION" | grep -q 'docs/SPEC-modeles-emails.md'; then
	ok "traçabilité : $MIGRATION cite CRM-063 et sa spécification"
else
	fail "traçabilité : $MIGRATION n'a pas d'en-tête @spec complet"
fi

for fichier in "$MODULE" "$ECRAN" "$BLOC"; do
	if head -n 14 "$fichier" | grep -q '@spec CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "traçabilité : $fichier cite CRM-063 et sa spécification en @spec"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec complet"
	fi
done

# LES DEUX SURFACES CITENT LE DESIGN SYSTEM : une règle d'interface sans renvoi au §5.41 ou au §5.42
# serait une règle que personne ne pourrait relire.
for fichier in "$ECRAN" "$BLOC"; do
	if head -n 14 "$fichier" | grep -q 'docs/DESIGN_SYSTEM.md'; then
		ok "traçabilité : $fichier cite docs/DESIGN_SYSTEM.md"
	else
		fail "traçabilité : $fichier ne cite pas le design system"
	fi
done

for fichier in "$SUITE_SQL" "$SUITE_UNITAIRE" "$SUITE_API" "$SUITE_UI" "$SUITE_UI_ARMEMENT"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "traçabilité : $fichier cite CRM-063 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

# LES CHAPITRES CITÉS DOIVENT EXISTER. Un fichier qui renvoie à un §13.3 absent serait une trace
# morte, et la traçabilité du §5 de `CLAUDE.md` ne serait plus qu'une formalité.
if [ -f "$SPEC" ] \
	&& grep -q '^### 13.2 LE RÉORDONNANCEMENT' "$SPEC" \
	&& grep -q '^### 13.3 ' "$SPEC" \
	&& grep -q '^### 13.5 bis ' "$SPEC" \
	&& grep -q '^### 13.7 Le dictionnaire fermé des refus' "$SPEC" \
	&& grep -q '^### 13.8 L' "$SPEC" \
	&& grep -q '^### 13.9 LA CONFIRMATION DE SUPPRESSION' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "$SPEC absent ou amputé d'un chapitre cité"
fi

if grep -q '^### 5.41 Séquences de relance' "$DESIGN" && grep -q '^### 5.42 Armer une relance' "$DESIGN"; then
	ok "le design system porte ses §5.41 et §5.42"
else
	fail "$DESIGN n'a pas de §5.41 ou de §5.42 : deux surfaces sans règle écrite"
fi

# =================================================================================================
echo
echo "2. La RPC, mesurée dans le CATALOGUE et non relue dans le SQL"
# =================================================================================================
# Lire la migration prouverait ce qui est ÉCRIT ; seul le catalogue dit ce qui est APPLIQUÉ. La
# distinction n'est pas théorique : une migration corrigée mais non rejouée laisserait le fichier
# juste et la base fausse.

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'reordonner_paliers_sequence';")" = 1 ]; then
	ok "public.reordonner_paliers_sequence existe dans la base"
else
	fail "public.reordonner_paliers_sequence ABSENTE — la migration 62 n'a pas été appliquée"
fi

if [ "$(psql_db -c "select prosecdef from pg_proc
	where oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure;")" = f ]; then
	ok "elle est security INVOKER : la RLS de la migration 59 fait tout le tri (§13.1 question 2)"
else
	fail "elle est security DEFINER — elle réécrirait la règle d'écriture de la migration 59"
fi

if [ "$(psql_db -c "select has_function_privilege('anon', 'public.reordonner_paliers_sequence(uuid, uuid[])', 'execute');")" = f ] \
	&& [ "$(psql_db -c "select has_function_privilege('authenticated', 'public.reordonner_paliers_sequence(uuid, uuid[])', 'execute');")" = t ]; then
	ok "les privilèges de la RPC : authenticated exécute, anon NON"
else
	fail "les privilèges de la RPC ne sont pas ceux du §13.3"
fi

# LE PRÉALABLE MESURÉ DU §11.6, SANS LEQUEL LA RPC ÉCHOUERAIT. Sa disparition doit rougir ICI, et
# non en production.
if [ "$(psql_db -c "select condeferrable and not condeferred from pg_constraint
	where conname = 'mail_sequence_steps_sequence_position_key';")" = t ]; then
	ok "la contrainte de position est DEFERRABLE INITIALLY IMMEDIATE — préalable du §11.6"
else
	fail "la contrainte de position n'est plus deferrable initially immediate : la RPC ne peut plus fonctionner"
fi

# LA DÉCISION DU §13.2, MESURÉE SUR LE CORPS APPLIQUÉ. Réintroduire `set constraints` ferait croire
# au lecteur suivant que la contrainte est `initially deferred`, ce qu'elle n'est pas.
if [ "$(psql_db -c "select regexp_replace(prosrc, '--[^\\n]*', '', 'g') ~* 'set\\s+constraints' from pg_proc
	where oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure;")" = f ]; then
	ok "le corps de la RPC n'émet AUCUN set constraints — la mesure du §13.2 l'a écarté"
else
	fail "la RPC émet un set constraints — inutile, et trompeur sur la nature de la contrainte"
fi

# =================================================================================================
echo
echo "3. Les deux lectures NOMMENT leur relation, et une mesure l'impose (§13.5 bis)"
# =================================================================================================
# C'est le contrôle qui relie la forme du schéma au code des écrans. Les deux clés étrangères du
# §11.5 points n et o rendent l'embarquement AMBIGU — `300` / `PGRST201` —, et une composition qui
# cesserait de nommer sa relation ferait retomber la liste sur le repli `inconnu` de l'écran.

if [ "$(psql_db -c "select count(*) from pg_constraint
	where conrelid = 'public.mail_sequence_steps'::regclass
	  and confrelid = 'public.mail_sequences'::regclass and contype = 'f';")" -ge 2 ]; then
	ok "deux clés étrangères mènent aux séquences : l'embarquement EST ambigu, et le nommage est dû"
else
	fail "moins de deux clés étrangères vers mail_sequences — le §13.5 bis serait à réviser"
fi

if code_seul "$MODULE" | grep -q '!mail_sequence_steps_sequence_id_fkey' \
	&& code_seul "$MODULE" | grep -q '!mail_sequence_steps_template_id_fkey'; then
	ok "les deux compositions NOMMENT leur clé étrangère simple"
else
	fail "une composition ne nomme pas sa relation — PostgREST rendrait 300 / PGRST201"
fi

# LA CLÉ NOMMÉE EST LA SIMPLE, ET NON LA COMPOSITE (§13.5 bis) : nommer le garde-fou ferait croire
# qu'il est consultable, et une migration qui le retirerait casserait toutes les lectures.
if ! code_seul "$MODULE" | grep -qE 'mail_sequence_steps_(sequence|template)_workspace_fkey'; then
	ok "aucune composition ne nomme une clé COMPOSITE : le garde-fou n'est pas une relation du produit"
else
	fail "une composition nomme une clé composite — le §13.5 bis l'écarte"
fi

# =================================================================================================
echo
echo "4. Les règles des écrans que seule une LECTURE du code peut constater"
# =================================================================================================
# Ces règles ne se mesurent ni en base ni par une assertion d'interface : elles portent sur ce que
# les écrans s'INTERDISENT. Une preuve d'interface ne voit pas ce qui n'est pas là.

# LA RELECTURE APRÈS ÉCRITURE (§13.7) : sans `select()`, PostgREST rend `204` aussi bien pour un
# `PATCH` consenti que pour un `PATCH` que la politique a laissé passer sans rien écrire.
if code_seul "$MODULE" | grep -q "\.select('id, name')" && code_seul "$MODULE" | grep -q "\.select('id')"; then
	ok "toute écriture RELIT sa ligne : c'est ce qui distingue un succès d'un zéro-ligne"
else
	fail "une écriture ne relit pas sa ligne — un refus silencieux passerait pour un succès"
fi

# LE `0` DE LA RPC N'EST PAS UN SUCCÈS (§13.3) : c'est le refus de la politique, et l'écran le nomme.
#
# LE MOTIF EST CELUI DES DEUX ISSUES, ET C'EST UN DÉFAUT DU HARNAIS TROUVÉ PAR LE HARNAIS, le
# 2026-08-26 — le quatrième de sa famille, et le second FAUX ROUGE après le §9.10 bis. Écrit
# d'abord `=== 0) ? 'zero-ligne'`, il portait une parenthèse fermante que le code n'a pas : la
# comparaison est `(reponse.data ?? 0) === 0 ? …`, et la parenthèse ferme le `??`, non la
# comparaison. Le harnais rendait « ECHEC » sur un module parfaitement conforme, et la dégradation
# D-F — qui trouve pourtant CETTE MÊME LIGNE — passait au vert dans le même passage : deux
# contrôles du même fichier se contredisaient.
#
# LA LEÇON EST ÉCRITE PLUTÔT QUE LA SEULE CORRECTION : un contrôle qui recopie un fragment de code
# à la parenthèse près est fragile par construction. Le motif porte désormais les DEUX ISSUES, qui
# sont ce que le contrôle veut vraiment dire — la distinction, jamais sa syntaxe.
if code_seul "$MODULE" | grep -q "'zero-ligne' : 'reordonne'"; then
	ok "un 0 rendu par la RPC est classé « zero-ligne », jamais confondu avec un succès"
else
	fail "le 0 de la RPC n'est pas distingué — l'écran annoncerait un réordonnancement qui n'a pas eu lieu"
fi

# AUCUNE PHRASE DU SERVEUR N'ATTEINT LES ÉCRANS (§13.7).
if ! { code_seul "$ECRAN"; code_seul "$BLOC"; } | grep -q 'erreur\.detail'; then
	ok "les écrans ne rendent jamais le détail technique d'une erreur"
else
	fail "un écran rend un détail technique du serveur"
fi

# AUCUNE GARDE DE SAISIE (§5.3 ter) : ni `required`, ni `maxLength`, ni `min`/`max` sur le délai.
# C'est la base qui tranche, et l'écran traduit son refus.
if ! { code_seul "$ECRAN"; code_seul "$BLOC"; } | grep -qE 'required|maxLength|pattern=|min=|max='; then
	ok "aucune garde de saisie ne double une contrainte de la base"
else
	fail "un écran porte une garde de saisie — le §5.3 ter l'interdit"
fi

# AUCUNE COMMANDE ÉTEINTE SELON LE RÔLE (§5.3, §5.13, §5.21, §5.27) : les écrans ne calculent aucun droit.
if ! { code_seul "$ECRAN"; code_seul "$BLOC"; } | grep -qE "role ===|=== 'admin'|=== 'viewer'|workspace_role"; then
	ok "les écrans ne calculent AUCUN droit : c'est la base qui refuse"
else
	fail "un écran calcule un droit — aucune surface n'a le droit de le faire"
fi

# LE BLOC D'ARMEMENT NE RECOPIE PAS LA DÉFINITION DE « FIGÉE » (§13.8). C'est le contrôle le plus
# important de cette section : `public.cards_figees()` porte cette définition une seule fois, et une
# recopie en TypeScript créerait la seconde définition que le §2.1 de docs/SPEC-relances.md existe
# pour empêcher — invisible à toute assertion d'interface, puisque les deux coïncideraient au départ.
if ! code_seul "$BLOC" | grep -qE 'cards_figees|jours_dans_etape|seuil_jours|entered_step_at'; then
	ok "le bloc d'armement ne recopie AUCUN prédicat de « figée » : la base seule le porte"
else
	fail "le bloc recopie la définition de « figée » — seconde source de vérité"
fi

# LE BLOC RÉEMPLOIE LA RÈGLE D'EMPRUNT D'IDENTITÉ DE CRM-058 (§13.8), au lieu d'écrire un second
# filtre. Deux filtres pour une même règle divergeraient.
if code_seul "$BLOC" | grep -q 'lireIdentitesDisponibles'; then
	ok "le bloc réemploie lireIdentitesDisponibles : une seule règle d'emprunt, écrite une fois"
else
	fail "le bloc n'emploie pas lireIdentitesDisponibles — un second filtre d'identités"
fi

# L'INTERRUPTION RELIT (§13.8) : `204` ne dit pas qu'une ligne a été fermée, l'appel étant idempotent.
if code_seul "$BLOC" | grep -q 'lireInscriptionActive(client, idCard)' \
	&& code_seul "$BLOC" | grep -q 'stop.refusal.stillActive'; then
	ok "l'interruption RELIT l'inscription avant d'annoncer quoi que ce soit"
else
	fail "l'interruption annonce un succès sur un 204 — l'appel est pourtant idempotent"
fi

# LES ÉCRANS SONT ATTEIGNABLES, et l'adresse est celle du §13.4.
if grep -q "$CHEMIN_ECRAN" webapp/src/app/chemins.ts \
	&& grep -q 'CHEMIN_ADMIN_SEQUENCES_MAIL' webapp/src/app/App.tsx \
	&& grep -q 'CHEMIN_ADMIN_SEQUENCES_MAIL' webapp/src/app/routes.tsx; then
	ok "l'écran est routé et atteignable depuis l'index des réglages"
else
	fail "l'écran n'est pas routé : une surface inatteignable n'est pas livrée"
fi

if grep -q 'BlocSequenceCard' webapp/src/app/RouteCard.tsx; then
	ok "le bloc d'armement est monté dans la fiche d'affaire"
else
	fail "le bloc d'armement n'est monté nulle part : le geste serait inatteignable"
fi

# =================================================================================================
echo
echo "5. Le seed, et ce que la sous-tranche NE change pas"
# =================================================================================================

if [ "$(psql_db -c "select count(*) from public.mail_sequences where workspace_id = '$WORKSPACE';")" = "$SEQUENCES_DU_SEED" ] \
	&& [ "$(psql_db -c "select count(*) from public.mail_sequence_steps where sequence_id = '$SEQUENCE_SEED';")" = "$PALIERS_DU_SEED" ]; then
	ok "le seed porte $SEQUENCES_DU_SEED séquence et $PALIERS_DU_SEED paliers, inchangé par 4c"
else
	fail "le seed des séquences a dérivé"
fi

# LE SEED N'ARME RIEN (§12.12, §13.11), ET C'EST UNE GARDE DE SÛRETÉ : une inscription active serait
# exécutée par le job DIX SECONDES après le démarrage de la pile, et des messages partiraient
# réellement chez les adresses du jeu de démonstration. Cette garde attrape deux choses — un seed
# qui armerait, et une preuve qui n'aurait pas refermé.
if [ "$(psql_db -c "select count(*) from public.card_sequence_enrollments where status = 'active';")" = 0 ]; then
	ok "aucune inscription ACTIVE ne subsiste : le job n'expédiera rien"
else
	fail "une inscription est ACTIVE — le job en expédiera les paliers au prochain passage"
fi

# LES POSITIONS DU SEED SONT 1, 2, 3 : une preuve qui aurait laissé l'ordre inversé ferait rougir
# `verify-seed-demo.sh` pour une raison sans rapport avec son objet.
if [ "$(psql_db -c "select string_agg(position::text, ',' order by position) from public.mail_sequence_steps
	where sequence_id = '$SEQUENCE_SEED';")" = '1,2,3' ]; then
	ok "les positions du seed sont 1, 2, 3 — aucune preuve n'a laissé l'ordre inversé"
else
	fail "les positions du seed ont dérivé"
fi

# =================================================================================================
echo
echo "6. Les preuves de la sous-tranche"
# =================================================================================================

if suite_sql_verte; then
	ok "$SUITE_SQL : $(grep -oE '[0-9]+ assertions' "$TRAVAIL/tap.log" | tail -n 1)"
else
	fail "$SUITE_SQL rougit — voir $TRAVAIL/tap.log"
	tail -n 20 "$TRAVAIL/tap.log" >&2
fi

# LA CHAÎNE NODE EST PRÉPARÉE AVANT LE PREMIER APPEL À `npm` : l'hôte démarre sur la v22 du système
# alors que le dépôt exige Node 24, et `scripts/verify-node-toolchain.sh` vérifie mécaniquement que
# TOUT harnais invoquant `npm` porte cette garde.
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

if suite_unitaire_verte; then
	ok "$SUITE_UNITAIRE : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "$SUITE_UNITAIRE rougit — voir $TRAVAIL/unit.log"
	tail -n 30 "$TRAVAIL/unit.log" >&2
fi

if [ "$RAPIDE" = true ]; then
	ok "contrat d'API et parcours E2E NON exécutés (--rapide) — dit plutôt que tu"
else
	if npm run e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1; then
		ok "$SUITE_API : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1)"
	else
		fail "$SUITE_API rougit — voir $TRAVAIL/api.log"
		tail -n 40 "$TRAVAIL/api.log" >&2
	fi

	# LE NAVIGATEUR EST EXPORTÉ : sans cela, tout scénario d'interface meurt à `browserType.launch`
	# sur un binaire que l'hôte ne porte pas, AVANT la moindre assertion — ce qui n'est ni un
	# verdict rouge ni une preuve (`docs/CloudWorker.md` §2.1 ter).
	export PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium}
	for suite in "$SUITE_UI" "$SUITE_UI_ARMEMENT"; do
		if npm run e2e:ui -- "$suite" >"$TRAVAIL/ui.log" 2>&1; then
			ok "$suite : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -n 1)"
		else
			fail "$suite rougit — voir $TRAVAIL/ui.log"
			tail -n 40 "$TRAVAIL/ui.log" >&2
		fi
	done
fi

# =================================================================================================
echo
echo "7. Dégradations RÉELLES : les preuves savent-elles rougir ?"
# =================================================================================================

# D-A — le refus du tableau VIDE est retiré. Sans lui, un ordre vide reposerait zéro position en
# rendant `0`, indiscernable du refus de politique (§13.3 refus a).
eprouver_degradation_sql "le refus du tableau vide est retiré" \
	"	if p_paliers is null or cardinality(p_paliers) = 0 then
		raise exception 'paliers_requis' using errcode = '23514';
	end if;" \
	"	if false then
		raise exception 'paliers_requis' using errcode = '23514';
	end if;"

# D-B — le refus du DOUBLON est retiré. Aucune contrainte de la base ne le verrait : un palier
# resterait sans position, et un rang serait inoccupé.
eprouver_degradation_sql "le refus du doublon est retiré" \
	"	if cardinality(p_paliers) <> (select count(distinct u.id) from unnest(p_paliers) as u(id)) then
		raise exception 'paliers_dupliques' using errcode = '23514';
	end if;" \
	"	if false then
		raise exception 'paliers_dupliques' using errcode = '23514';
	end if;"

# D-C — LA RPC PASSE EN `security definer`. C'EST LA DÉGRADATION LA PLUS IMPORTANTE DE CE HARNAIS :
# la lectrice écrirait alors, la politique d'écriture de la migration 59 cessant d'être opposable
# par cette porte. Si la suite pgTAP restait verte, la décision du §13.1 question 2 ne serait
# éprouvée nulle part.
eprouver_degradation_sql "la RPC passe en security DEFINER" \
	'volatile
security invoker
set search_path = ' \
	'volatile
security definer
set search_path = '

# D-D — LE REFUS DE L'ORDRE PARTIEL NE COMPARE PLUS QUE LES CARDINAUX. C'est la dégradation
# subtile : un ordre de trois paliers dont l'un appartient à une AUTRE séquence passerait, et un
# palier du seed se retrouverait sans position.
eprouver_degradation_sql "le refus de l'ordre partiel ne compare plus que les cardinaux" \
	"	if v_attendus <> v_nommes or v_communs <> v_nommes then" \
	"	if v_attendus <> v_nommes then"

# D-E — L'ÉCRITURE CESSE DE RELIRE SA LIGNE : un zéro-ligne devient un succès. C'est le refus
# silencieux du §11.8 ligne 8, et la suite unitaire doit le dénoncer.
eprouver_degradation_module "un zéro-ligne à l'écriture passe pour un succès" \
	"		if (premiere === undefined) return { issue: 'zero-ligne' }" \
	"		if (premiere === undefined) return { issue: 'enregistre', sequence: { id: '', name: '' } }"

# D-F — LE `0` DE LA RPC PASSE POUR UN SUCCÈS. C'est le pendant de D-C côté interface : la base
# refuse en rendant `0`, et l'écran annoncerait un réordonnancement qui n'a pas eu lieu.
eprouver_degradation_module "un 0 rendu par la RPC passe pour un réordonnancement" \
	"		return (reponse.data ?? 0) === 0 ? 'zero-ligne' : 'reordonne'" \
	"		return 'reordonne'"

# D-G — LA COMPOSITION CESSE DE NOMMER SA RELATION. La lecture rendrait alors `300` / `PGRST201`,
# et l'écran classerait ce code dans son repli `inconnu` sur une liste parfaitement saine (§13.5 bis).
eprouver_degradation_module "la composition cesse de nommer sa relation" \
	"'id, workspace_id, name, mail_sequence_steps!mail_sequence_steps_sequence_id_fkey(count)' as const" \
	"'id, workspace_id, name, mail_sequence_steps(count)' as const"

# =================================================================================================
echo
echo "8. Restauration : l'arbre et la base sont rendus tels qu'ils ont été trouvés"
# =================================================================================================

# LA RESTAURATION EST CONSTATÉE OCTET À OCTET, CONTRE L'INSTANTANÉ pris avant la première
# dégradation — jamais contre `HEAD` : le harnais doit fonctionner dans un arbre portant une
# évolution légitime non encore committée (`docs/SPEC-test-harness.md` §7.2 point 9).
if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "$MIGRATION restauré octet à octet"
else
	fail "$MIGRATION DIFFÈRE de son instantané d'entrée"
fi

if cmp -s "$MODULE" "$TRAVAIL/module.origine"; then
	ok "$MODULE restauré octet à octet"
else
	fail "$MODULE DIFFÈRE de son instantané d'entrée"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

if suite_unitaire_verte; then
	ok "après restauration, la suite unitaire est de nouveau VERTE"
else
	fail "la suite unitaire reste rouge après restauration"
fi

if [ "$(psql_db -c "select string_agg(position::text, ',' order by position) from public.mail_sequence_steps
	where sequence_id = '$SEQUENCE_SEED';")" = '1,2,3' ]; then
	ok "le seed est rendu INTACT : positions 1, 2, 3 comme à l'entrée"
else
	fail "les positions du seed ont été laissées dérivées par les preuves"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
