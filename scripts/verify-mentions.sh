#!/usr/bin/env bash
# @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 1
# @verifies docs/SPEC-notifications.md §4 (modèle et clés étrangères), §5 (la règle d'éligibilité et
#           sa généralisation par délégation), §6 (le trigger et ses trois refus), §7 (politiques,
#           privilèges, temps réel, retrait de la colonne), §8 (le contrat d'API), §9 (le seed)
# @verifies docs/SCHEMA.md §5 ; docs/PROD_MIGRATIONS.md §3 (migration 63)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de l'unité, puis DÉGRADE RÉELLEMENT la migration — une dégradation
# par règle qu'elle porte — et exige que la preuve concernée rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# UNE DÉGRADATION DE CE HARNAIS EST SANS ÉQUIVALENT AILLEURS, et c'est la plus utile : elle rend
# `app.can_read_card_pour` toujours vraie. La table, ses clés et ses politiques survivraient toutes ;
# seule l'ÉLIGIBILITÉ disparaîtrait, c'est-à-dire précisément ce que la tranche existe pour livrer.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0063_mentions_commentaires.sql
SUITE_SQL=supabase/tests/0061_mentions_commentaires.test.sql
SUITE_API=e2e/api/mentions.spec.ts
SPEC=docs/SPEC-notifications.md
SEED=supabase/seed/apply-seed.sh

# Les identifiants du seed, stables (docs/SPEC-seed.md §4).
PROFIL_ADMIN=5eed0000-0000-4000-8000-000000000011
PROFIL_BIZDEV=5eed0000-0000-4000-8000-000000000012
PROFIL_VIEWER=5eed0000-0000-4000-8000-000000000013
COMMENTAIRE_D1=5eed0000-0000-4000-8000-0000000000d1
COMMENTAIRE_D2=5eed0000-0000-4000-8000-0000000000d2
CARD_FERMEE=5eed0000-0000-4000-8000-0000000000c1
CARD_OUVERTE=5eed0000-0000-4000-8000-0000000000c5

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
		# Même motif que dans `restaurer` : la migration ne retire pas la table de la publication.
		psql_db -c "alter publication supabase_realtime drop table public.card_comment_mentions;" \
			>/dev/null 2>&1
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

# Rend vrai si la valeur SQL attendue est celle mesurée. Le contrôle NOMME les deux valeurs en cas
# d'écart : un harnais qui dit seulement « échec » oblige à refaire la mesure à la main.
mesurer() {
	local libelle=$1 requete=$2 attendu=$3 obtenu
	obtenu=$(psql_db -c "$requete" 2>/dev/null | tr -d '[:space:]')
	if [ "$obtenu" = "$attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — attendu « $attendu », mesuré « $obtenu »"
	fi
}

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# Remplace un motif dans une copie de la migration, puis l'applique. Le motif est comparé AVANT et
# APRÈS : une substitution qui ne substituerait rien laisserait la suite verte et le harnais
# conclurait à tort à la complaisance — c'est le défaut trouvé à `CRM-061` (décision 503), et il ne
# se refait pas.
degrader() {
	local avant=$1 apres=$2 nom=$3
	python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if ! cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		restauration_due=true
		# L'APPLICATION EST VÉRIFIÉE, ET C'EST LA LEÇON DE LA DÉCISION 503 POUSSÉE D'UN CRAN.
		# Elle exigeait que la SUBSTITUTION change quelque chose ; il faut aussi que l'APPLICATION
		# réussisse. Une migration dégradée que `psql` refuse laisse le produit INTACT, la suite
		# reste verte, et le harnais conclut à tort à la complaisance — verdict d'autant plus
		# dangereux qu'il accuse une preuve saine. MESURÉ le 2026-08-26 sur deux dégradations de ce
		# fichier même.
		if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation « $nom » NON APPLIQUÉE : psql l'a refusée — $(tail -n 1 "$TRAVAIL/degrade.log")"
			restaurer
			return 1
		fi
		return 0
	fi
	fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	return 1
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	# LA MIGRATION PROPRE NE SAIT PAS EXPRIMER UNE ABSENCE : elle n'ajoute pas la table à la
	# publication, mais elle ne l'en retire pas non plus. Rejouer la migration ne défait donc PAS la
	# dégradation D-F, et le harnais sortirait en laissant le produit publié — exactement le défaut
	# de la décision 108. La restauration est donc explicite sur ce point.
	psql_db -c "alter publication supabase_realtime drop table public.card_comment_mentions;" \
		>/dev/null 2>&1 || true
	restauration_due=false
}

eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3
	degrader "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-064 tranche 1 — la mention en base"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité : aucun fichier de l'unité n'est orphelin de sa spécification"
# =================================================================================================
# `CLAUDE.md` §5 : chaque fichier porte ses commentaires `@spec` / `@verifies` vers l'unité de
# backlog ET les chapitres.

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-064' \
	&& head -n 12 "$MIGRATION" | grep -q "$SPEC"; then
	ok "traçabilité : $MIGRATION cite CRM-064 et sa spécification"
else
	fail "traçabilité : $MIGRATION n'a pas d'en-tête @spec complet"
fi

for fichier in "$SUITE_SQL" "$SUITE_API"; do
	if head -n 12 "$fichier" | grep -q '@verifies CRM-064' \
		&& head -n 12 "$fichier" | grep -q "$SPEC"; then
		ok "traçabilité : $fichier cite CRM-064 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

if [ -f "$SPEC" ]; then
	ok "la spécification $SPEC existe"
else
	fail "la spécification $SPEC est absente"
fi

# =================================================================================================
echo "2. La forme : la relation, ses clés, son index"
# =================================================================================================

mesurer "la table \`public.card_comment_mentions\` existe" \
	"select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'card_comment_mentions';" 1

mesurer "QUATRE colonnes, et quatre seulement — aucune clé technique, aucune \`updated_at\`" \
	"select count(*) from pg_attribute
	  where attrelid = 'public.card_comment_mentions'::regclass and attnum > 0 and not attisdropped;" 4

mesurer "la clé primaire porte le COUPLE \`(comment_id, profile_id)\`" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.card_comment_mentions'::regclass and contype = 'p'
	    and conkey = array[1, 2]::smallint[];" 1

mesurer "TROIS clés étrangères : le commentaire, le profil, l'espace" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.card_comment_mentions'::regclass and contype = 'f';" 3

mesurer "l'index de la lecture inverse existe — « qu'est-ce qui me mentionne »" \
	"select count(*) from pg_indexes where schemaname = 'public'
	  and indexname = 'card_comment_mentions_profile_id_created_at_idx';" 1

# =================================================================================================
echo "3. Le retrait de \`card_comments.mentions\`, et sa garde"
# =================================================================================================

mesurer "\`card_comments.mentions\` a DISPARU" \
	"select count(*) from pg_attribute where attrelid = 'public.card_comments'::regclass
	  and attname = 'mentions' and attnum > 0 and not attisdropped;" 0

mesurer "l'unicité \`(id, workspace_id)\` exigée par la clé composite est posée" \
	"select count(*) from pg_constraint where conrelid = 'public.card_comments'::regclass
	  and conname = 'card_comments_id_workspace_id_key';" 1

# LA GARDE DU §7.4 EST ÉCRITE, ET CE CONTRÔLE EXIGE QU'ELLE LE RESTE. Une migration destructrice
# dont la garde disparaîtrait détruirait, au prochain rejeu sur une base peuplée, des données
# qu'elle ne sait pas transposer.
if grep -q 'card_comments_mentions_non_vide' "$MIGRATION"; then
	ok "la garde de retrait \`card_comments_mentions_non_vide\` est écrite dans la migration"
else
	fail "la garde de retrait a DISPARU : la migration détruirait sans compter (§7.4)"
fi

# =================================================================================================
echo "4. La règle d'accès n'a qu'UNE écriture — les quatre délégations"
# =================================================================================================
# `docs/SPEC-notifications.md` §5.3. Le contrôle est mécanique : le corps de chaque déléguée doit
# APPELER sa variante paramétrée, et ne rien relire lui-même. Une déléguée qui recopierait la
# lecture serait une seconde écriture de la règle, et divergerait au premier droit ajouté.

for couple in "workspace_role:workspace_role_pour" \
              "resolve_channel_access:resolve_channel_access_pour" \
              "can_read_channel:can_read_channel_pour" \
              "can_read_card:can_read_card_pour"; do
	deleguee=${couple%%:*}
	cible=${couple##*:}
	mesurer "\`app.$deleguee\` DÉLÈGUE à \`app.$cible\` et ne relit rien elle-même" \
		"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
		  where n.nspname = 'app' and p.proname = '$deleguee'
		    and p.prosrc like '%app.$cible%'
		    and p.prosrc not like '%workspace_members%'
		    and p.prosrc not like '%track_members%'
		    and p.prosrc not like '%channel_members%';" 1
done

# `app.resolve_access` PORTE LA RÈGLE, et elle n'est pas touchée. Le contrôle est le témoin de cette
# abstention : la généralisation lui apporte les mêmes entrées pour quelqu'un d'autre, rien de plus.
mesurer "\`app.resolve_access\` est INCHANGÉE : elle porte toujours la règle" \
	"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'resolve_access'
	    and p.prosrc like '%ws_role = ''admin''%';" 1

# =================================================================================================
echo "5. L'éligibilité, mesurée contre la matrice du seed"
# =================================================================================================
# `docs/SPEC-notifications.md` §2, mesures M5 et M6. C'est le CROISEMENT qui fonde la tranche, et il
# est mesuré plutôt que recopié : si la lectrice se mettait à lire `…0c1`, les preuves de refus
# deviendraient vertes sans rien prouver.

mesurer "la lectrice NE lit PAS la card fermée \`…0c1\` — le cas de refus de la tranche" \
	"select app.can_read_card_pour('$CARD_FERMEE', '$PROFIL_VIEWER');" f

mesurer "…mais elle LIT \`…0c5\` : le refus est une ligne absente d'une liste peuplée" \
	"select app.can_read_card_pour('$CARD_OUVERTE', '$PROFIL_VIEWER');" t

mesurer "le business developer lit la card fermée : le refus vise la personne, non la card" \
	"select app.can_read_card_pour('$CARD_FERMEE', '$PROFIL_BIZDEV');" t

mesurer "l'administratrice lit tout : \`admin\` passe avant les droits fins" \
	"select app.can_read_card_pour('$CARD_FERMEE', '$PROFIL_ADMIN');" t

# =================================================================================================
echo "6. Les privilèges, et le refus DOUBLE de la mise à jour"
# =================================================================================================

mesurer "aucun \`UPDATE\` à \`authenticated\` — première moitié du refus double" \
	"select has_table_privilege('authenticated', 'public.card_comment_mentions', 'UPDATE');" f

mesurer "aucune politique \`UPDATE\` — seconde moitié" \
	"select count(*) from pg_policy where polrelid = 'public.card_comment_mentions'::regclass
	  and polcmd = 'w';" 0

mesurer "TROIS politiques, et trois seulement" \
	"select count(*) from pg_policy where polrelid = 'public.card_comment_mentions'::regclass;" 3

mesurer "\`anon\` LIT — sans quoi son refus serait une erreur et non zéro ligne" \
	"select has_table_privilege('anon', 'public.card_comment_mentions', 'SELECT');" t

mesurer "\`anon\` n'INSÈRE pas" \
	"select has_table_privilege('anon', 'public.card_comment_mentions', 'INSERT');" f

# LE PRIVILÈGE QU'UNE PREUVE A IMPOSÉ (décision 522). Le trigger étant `SECURITY INVOKER`, il
# exécute `app.can_read_card_pour` sous le rôle de l'appelant ; sans ce privilège, les refus MÉTIER
# sont masqués par un `42501`.
mesurer "\`authenticated\` EXÉCUTE \`app.can_read_card_pour\` — le trigger est INVOKER" \
	"select has_function_privilege('authenticated', 'app.can_read_card_pour(uuid, uuid)', 'execute');" t

mesurer "\`anon\` ne l'exécute PAS : il n'insère rien, donc le trigger ne tourne jamais sous lui" \
	"select has_function_privilege('anon', 'app.can_read_card_pour(uuid, uuid)', 'execute');" f

mesurer "la table n'est PAS publiée au temps réel : rien ne s'y abonne avant la tranche 3" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'card_comment_mentions';" 0

# =================================================================================================
echo "7. Ce que le seed livre, et ce qu'il ne parvient PAS à écrire"
# =================================================================================================
# `docs/SPEC-notifications.md` §9. LA SECONDE MESURE EST LA PLUS PORTEUSE : le seed démontre la règle
# par la ligne qu'il ne pose pas.

mesurer "le seed pose DEUX mentions" \
	"select count(*) from public.card_comment_mentions;" 2

mesurer "la lectrice n'en porte AUCUNE : elle est « none » là où vivent les commentaires porteurs" \
	"select count(*) from public.card_comment_mentions where profile_id = '$PROFIL_VIEWER';" 0

mesurer "Driss est mentionné sur \`…0d1\`, par l'administratrice qui en est l'auteure" \
	"select count(*) from public.card_comment_mentions
	  where comment_id = '$COMMENTAIRE_D1' and profile_id = '$PROFIL_BIZDEV';" 1

mesurer "Camille est mentionnée sur \`…0d2\` : second auteur, second jeton" \
	"select count(*) from public.card_comment_mentions
	  where comment_id = '$COMMENTAIRE_D2' and profile_id = '$PROFIL_ADMIN';" 1

# LE SEED ÉCRIT PAR LE VRAI CHEMIN, et le contrôle l'exige du SCRIPT — pas seulement du résultat.
# Un `insert` sous la clé de service donnerait le même état final en ne prouvant rien (`CLAUDE.md` §8).
if grep -q 'api_bizdev POST /rest/v1/card_comment_mentions' "$SEED" \
	&& grep -q 'api_admin POST /rest/v1/card_comment_mentions' "$SEED"; then
	ok "le seed pose ses deux mentions par la ROUTE REST, avec les jetons réels de leurs auteurs"
else
	fail "le seed n'emploie plus les jetons réels : l'état final ne prouverait plus la règle"
fi

# =================================================================================================
echo "8. La suite pgTAP et le contrat d'API de l'unité"
# =================================================================================================

if suite_sql_verte; then
	ok "$SUITE_SQL — verte"
else
	fail "$SUITE_SQL — ROUGE, voir $TRAVAIL/tap.log"
	cat "$TRAVAIL/tap.log" >&2
fi

# =================================================================================================
echo "9. Dégradations : chaque règle retirée DOIT faire rougir la suite"
# =================================================================================================

# D-A — L'ÉLIGIBILITÉ DISPARAÎT, ET RIEN D'AUTRE. C'est la dégradation sans équivalent ailleurs : la
# table, ses trois clés, ses trois politiques et ses privilèges survivent tous. Seule la règle que la
# tranche existe pour livrer s'en va, et une suite qui resterait verte prouverait qu'elle ne mesure
# que de la forme.
eprouver_degradation "l'éligibilité du destinataire (§5.1)" \
	'	if not app.can_read_card_pour(v_card, new.profile_id) then' \
	'	if false then'

# D-B — la pierre tombale accepte de nouveau des mentions. Mentionner quelqu'un dans un commentaire
# vidé de son corps l'adresserait à un propos détruit (§6, refus 2).
eprouver_degradation "le refus d'une pierre tombale (§6)" \
	'	if v_supprime is not null then' \
	'	if false then'

# D-C — `workspace_id` n'est plus DÉRIVÉ mais accepté du client. La clé composite le rattraperait
# dans le cas simple ; l'assertion de dérivation, elle, envoie une valeur FAUSSE et exige la bonne.
eprouver_degradation "la dérivation de \`workspace_id\` (§6)" \
	'	new.workspace_id := v_espace;' \
	'	new.workspace_id := coalesce(new.workspace_id, v_espace);'

# D-D — `created_at` n'est plus posé par le trigger. Une mention antidatée fausserait l'ordre de la
# lecture « qu'est-ce qui me mentionne », qui est LA lecture de la tranche 2 (§4.1).
eprouver_degradation "\`created_at\` posé par le trigger (§4.1)" \
	'	new.created_at   := now();' \
	'	new.created_at   := coalesce(new.created_at, now());'

# D-E — le privilège `UPDATE` est rendu à `authenticated`. Le refus cesse d'être double, et une
# mention pourrait changer de destinataire (§7.1).
eprouver_degradation "le refus double de la mise à jour (§7.1)" \
	'grant select, insert, delete on public.card_comment_mentions to authenticated;' \
	'grant select, insert, delete, update on public.card_comment_mentions to authenticated;'

# D-F — la table est publiée au temps réel. Une surface d'autorisation sans preuve (§7.3).
#
# LA SUBSTITUTION EST UN `ALTER PUBLICATION` NU, SANS AUCUNE APOSTROPHE, ET C'EST DÉLIBÉRÉ. La
# première écriture employait un bloc `do $$ … $$` conditionnel, dont le SQL contenait des chaînes
# entre apostrophes — impossibles à porter dans un argument shell entre apostrophes simples, où
# elles se sont retrouvées DOUBLÉES. `psql` refusait le fichier, la migration restait intacte, la
# suite restait verte, et le harnais accusait à tort sa propre preuve d'être complaisante. C'est ce
# faux verdict qui a fait ajouter le contrôle d'application de `degrader`.
eprouver_degradation "l'absence de publication au temps réel (§7.3)" \
	"alter table public.card_comment_mentions enable row level security;" \
	"alter table public.card_comment_mentions enable row level security;
alter publication supabase_realtime add table public.card_comment_mentions;"

# D-G — le privilège d'exécution est retiré à `authenticated`. C'est LE DÉFAUT QUE LA MESURE A
# TROUVÉ (décision 522), rejoué ici : la suite pgTAP le voit désormais, là où elle serait restée
# verte avant que l'assertion 26 n'existe.
eprouver_degradation "le privilège d'exécution de \`can_read_card_pour\` (décision 522)" \
	'grant execute on function app.can_read_card_pour(uuid, uuid) to authenticated, service_role;' \
	'grant execute on function app.can_read_card_pour(uuid, uuid) to service_role;'

# =================================================================================================
echo "10. La restauration est CONSTATÉE, jamais supposée"
# =================================================================================================
# Un harnais qui laisse le produit dégradé en sortant fait mesurer un produit amputé à tous ceux qui
# le suivent — c'est la décision 108, et sa seconde occurrence à `CRM-036`.

restaurer

mesurer "après restauration : le privilège d'exécution est revenu" \
	"select has_function_privilege('authenticated', 'app.can_read_card_pour(uuid, uuid)', 'execute');" t

mesurer "après restauration : aucun \`UPDATE\`" \
	"select has_table_privilege('authenticated', 'public.card_comment_mentions', 'UPDATE');" f

mesurer "après restauration : la table n'est toujours pas publiée" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'card_comment_mentions';" 0

mesurer "après restauration : le seed est intact, deux mentions" \
	"select count(*) from public.card_comment_mentions;" 2

if suite_sql_verte; then
	ok "après restauration : $SUITE_SQL est VERTE — le produit est rendu tel qu'il était"
else
	fail "après restauration : $SUITE_SQL reste ROUGE, le produit n'a PAS été rendu"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
