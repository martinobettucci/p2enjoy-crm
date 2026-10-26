#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
#           TRANCHE 4, SOUS-TRANCHE 4b : L'ARMEMENT ET L'EXÉCUTION
# @verifies docs/SPEC-modeles-emails.md §12.2 (qui arme), §12.3 (`card_sequence_enrollments`),
#           §12.4 (les huit refus), §12.4 bis (ce qui fait tomber le refus g), §12.5 (quand un
#           palier est dû), §12.6 (ce qu'une réponse produit), §12.7 (les quatre fins),
#           §12.8 (`app.mail_outbox_inserer`), §12.9 (le job), §12.10 (autorisations),
#           §12.12 (le seed n'arme rien), §12.13 (preuves exigées)
# @verifies docs/SPEC-relances.md §9.2 (le job APPELLE la règle, il ne la recopie pas)
# @verifies docs/SCHEMA.md §7 ; docs/PROD_MIGRATIONS.md migration 60
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.5 : l'armement désigne le rattachement, l'unicité est par rattachement,
#           l'exécuteur juge l'inéligibilité par le rattachement inscrit ; aucune migration ancienne n'est plus rejouée —
#           les fonctions se dégradent depuis leur définition en base, l'index se restaure depuis la sienne
#           (docs/SPEC-rattachements.md §5, §7 ; docs/SPEC-test-harness.md §3.7, INC-304)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la sous-tranche, puis DÉGRADE RÉELLEMENT chaque règle — une
# dégradation par règle — et exige que la suite pgTAP rougisse. Aucun état dégradé ne subsiste, même
# en cas d'échec : le `trap` réapplique les définitions lues en base avant la première dégradation.
# RÉVISÉ PAR `CRM-111` T2.3.5 : il rejouait la migration 60, dont la fonction d'armement a changé de signature par la
# migration 0119 ; le rejeu échouait en cours de fichier ou la ramenait en arrière (§3.7).
#
# CE QUE CE HARNAIS SURVEILLE EN PROPRE, ET QU'AUCUN AUTRE NE PEUT VOIR.
#
# 1. QUE `app.mail_outbox_inserer` RESTE LA SEULE LIGNE D'INSERTION DANS `mail_outbox` (§12.8).
#    C'est la règle du §10.3 — « ce qui est stocké est ce qui part » —, et elle n'a de valeur que
#    tant qu'elle a UNE définition. Le jour où quelqu'un réécrirait un second `insert into
#    public.mail_outbox` dans une migration, la signature cesserait de s'ajouter par un des deux
#    chemins, et AUCUNE suite pgTAP ne le verrait : les deux chemins resteraient verts chacun de
#    son côté. Ce contrôle compte les occurrences dans le répertoire des migrations.
#
# 2. QUE LE JOB EST ENREGISTRÉ ET QUE SA CADENCE EST LA BONNE, minute 41 — ni celle du heartbeat
#    (7), ni celle des relances de `CRM-062` (23). Trois jobs qui se disputeraient la même minute
#    ne se verraient qu'en production.
#
# 3. QUE LE SEED N'ARME AUCUNE INSCRIPTION (§12.12). Une inscription résiduelle serait exécutée dix
#    secondes après le démarrage de la pile, et des messages partiraient RÉELLEMENT chez les
#    adresses du jeu de démonstration. C'est la pollution mesurée par la décision 516.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu
# (`docs/SPEC-test-harness.md` §7.2 point 3) : aucun ÉCRAN — la sous-tranche n'en livre aucun,
# c'est 4c ; aucun ENVOI RÉEL — ce que le job met en file, c'est `mail-sync` qui l'expédie, et son
# contrat est celui de `CRM-058`.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)
MIGRATION=supabase/migrations/0060_armement_sequences.sql
# `CRM-111` T2.3.5 : la dernière autorité sur l'armement, l'index d'inscription active et l'exécuteur. Lue, jamais rejouée.
MIGRATION_RATTACHEMENT=supabase/migrations/0119_armer_une_cadence_par_rattachement.sql
SIGNATURE_ARMER='public.armer_sequence_relance(uuid,uuid,uuid)'
SIGNATURE_EXECUTEUR='app.executer_sequences_relance()'
INDEX_ACTIF=public.card_sequence_enrollments_active_unique
SUITE_SQL=supabase/tests/0058_armement_sequences.test.sql
SUITE_API=e2e/api/armement-sequences.spec.ts
SPEC=docs/SPEC-modeles-emails.md

# Ce que le seed pose — `docs/SPEC-modeles-emails.md` §11.9 et §12.12.
SEQUENCE_DU_SEED='5e900000-0000-4000-8000-000000000001'
# LE SEED N'ARME RIEN, et c'est une décision motivée par une mesure (§12.12).
INSCRIPTIONS_DU_SEED=0
# La cadence nominale du job, et les deux minutes qu'elle doit éviter.
MINUTE_DU_JOB=41
CADENCE_NOMINALE='41 3 * * *'

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
index_a_restaurer=false

# shellcheck source=scripts/lib/degradation.sh
source scripts/lib/degradation.sh

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	degradations_restaurer
	if [ "$index_a_restaurer" = true ]; then
		if ! restaurer_index; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$INDEX_ACTIF" >&2
			statut=1
		fi
	fi
	rm -rf -- "$TRAVAIL" "$DEGRADATIONS_DOSSIER"
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

# RÉÉCRIT PAR `CRM-111` T2.3.5 (docs/SPEC-test-harness.md §3.7). La dégradation se fait sur la définition EN BASE de la
# fonction visée (`degradation_fonction`), qui exige un fragment présent exactement une fois — la leçon des harnais
# jumeaux (§2.11, §8.9 bis) tient toujours : une substitution qui ne substitue rien, ou un SQL dégradé qui ne compile
# pas, sont déclarés NON CONCLUANTS au lieu de passer pour une preuve. La restauration réapplique la définition lue.
eprouver_degradation() {
	local nom=$1 signature=$2 avant=$3 apres=$4
	if ! degradation_fonction "$signature" "$avant" "$apres"; then
		fail "dégradation « $nom » IMPOSSIBLE : fragment absent ou ambigu, ou SQL dégradé refusé"
		return 0
	fi
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	degradations_restaurer
}

# L'INDEX D'INSCRIPTION ACTIVE se restaure depuis SA définition lue en base (`pg_get_indexdef`) et son commentaire :
# un objet isolé, rendu à l'octet près, et constaté en section 9.
DEFINITION_INDEX=''
COMMENTAIRE_INDEX=''
restaurer_index() {
	psql_db -c "$DEFINITION_INDEX" >/dev/null 2>&1 \
		&& psql_db -c "comment on index $INDEX_ACTIF is \$c\$$COMMENTAIRE_INDEX\$c\$" >/dev/null 2>&1 \
		&& index_a_restaurer=false
}

echo
echo "Preuves de CRM-063 sous-tranche 4b — l'armement et l'exécution des séquences"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

cp "$MIGRATION" "$TRAVAIL/migration.origine"
DEFINITION_INDEX=$(psql_db -c "select pg_get_indexdef('$INDEX_ACTIF'::regclass);")
COMMENTAIRE_INDEX=$(psql_db -c "select obj_description('$INDEX_ACTIF'::regclass, 'pg_class');")

# =================================================================================================
echo "1. Les fichiers de la sous-tranche, et leurs commentaires de traçabilité"
# =================================================================================================

for fichier in "$MIGRATION" "$MIGRATION_RATTACHEMENT" "$SUITE_SQL" "$SUITE_API" "$SPEC" scripts/verify-armement-sequences.sh; do
	if [ -f "$fichier" ]; then
		ok "$fichier existe"
	else
		fail "$fichier MANQUE"
	fi
done

# `CLAUDE.md` §5 : chaque fichier porte sa trace vers l'unité de backlog ET vers la spécification.
for fichier in "$MIGRATION" "$SUITE_SQL" "$SUITE_API"; do
	if head -n 12 "$fichier" | grep -q 'CRM-063' && head -n 12 "$fichier" | grep -q '§12'; then
		ok "$(basename "$fichier") cite CRM-063 et le §12 dans son en-tête"
	else
		fail "$(basename "$fichier") n'a pas ses commentaires @spec/@verifies vers CRM-063 §12"
	fi
done

if head -n 1 "$MIGRATION_RATTACHEMENT" | grep -q '@spec CRM-111'; then
	ok "$(basename "$MIGRATION_RATTACHEMENT") cite CRM-111 — tranche T2.3.5"
else
	fail "$(basename "$MIGRATION_RATTACHEMENT") n'a pas son commentaire @spec vers CRM-111"
fi

# =================================================================================================
echo
echo "2. La forme en base — la table, ses contraintes, son index PARTIEL"
# =================================================================================================

if [ "$(psql_db -c "select to_regclass('public.card_sequence_enrollments') is not null;")" = t ]; then
	ok "\`public.card_sequence_enrollments\` existe"
else
	fail "\`public.card_sequence_enrollments\` MANQUE — la migration n'est pas appliquée"
fi

# `relrowsecurity::text` D'UN BOOLÉEN REND `true`, JAMAIS `t` — c'est l'un des deux faux ROUGES que
# le harnais de 4a a trouvés dans son propre code (décision 517). La leçon est appliquée ici.
if [ "$(psql_db -c "select relrowsecurity::text from pg_class where oid='public.card_sequence_enrollments'::regclass;")" = true ]; then
	ok "la RLS est ACTIVÉE sur la table"
else
	fail "la RLS n'est PAS activée — la table serait ouverte à tout porteur de jeton"
fi

for contrainte in \
	card_sequence_enrollments_status_borne \
	card_sequence_enrollments_motif_borne \
	card_sequence_enrollments_fermeture_coherente \
	card_sequence_enrollments_progression_coherente \
	card_sequence_enrollments_sequence_fk \
	card_sequence_enrollments_identity_fk
do
	if [ "$(psql_db -c "select count(*) from pg_constraint where conrelid='public.card_sequence_enrollments'::regclass and conname='$contrainte';")" = 1 ]; then
		ok "contrainte \`$contrainte\` posée"
	else
		fail "contrainte \`$contrainte\` ABSENTE"
	fi
done

# L'INDEX EST PARTIEL, et c'est la moitié qui compte : sans le `where status = 'active'`, une
# affaire ne pourrait porter qu'UNE inscription dans toute son histoire, fermées comprises.
if [ "$(psql_db -c "select (indpred is not null)::text from pg_index where indexrelid='public.card_sequence_enrollments_active_unique'::regclass;")" = true ]; then
	ok "l'index unique d'inscription active est bien PARTIEL (§12.2)"
else
	fail "l'index unique n'est PAS partiel — une affaire ne porterait qu'une inscription à vie"
fi

# `CRM-111` T2.3.5 : l'unicité porte sur le RATTACHEMENT (docs/SPEC-rattachements.md §7).
if [ "$(psql_db -c "select a.attname from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0] where x.indexrelid='$INDEX_ACTIF'::regclass;")" = placement_id ]; then
	ok "l'index unique porte sur \`placement_id\` — une cadence active par rattachement (CRM-111 T2.3.5)"
else
	fail "l'index unique ne porte pas sur \`placement_id\` — l'unicité serait restée par affaire"
fi

if [ "$(psql_db -c "select pg_get_function_arguments('$SIGNATURE_ARMER'::regprocedure);")" = 'p_placement uuid, p_sequence_id uuid, p_identity_id uuid' ]; then
	ok "l'armement désigne le rattachement : \`armer_sequence_relance(p_placement, …)\`"
else
	fail "la signature de l'armement n'est pas celle du rattachement"
fi

# LES DEUX CLÉS SONT `restrict`, ET LA TROISIÈME EST `cascade` : l'asymétrie est voulue (§12.3), et
# une inversion la rendrait muette — supprimer une cadence armée effacerait l'inscription au lieu
# de refuser.
#
# RÉVISÉ LE 2026-10-25 (décision 704, INC-309), PARCE QUE LA RÈGLE A CHANGÉ. `0085_suppression_espace.sql` a remplacé
# les deux `restrict` par `no action deferrable initially immediate` : supprimer une cadence armée est TOUJOURS refusé
# (le contrôle reste immédiat), mais la seule transaction qui supprime un espace l'ajourne, pour que la cascade de
# l'espace emporte tout avant la validation. L'asymétrie du §12.3 tient donc encore ; le contrôle exige désormais
# `a` (no action), différable et immédiat par défaut — `r` serait la régression, et `n`/`c` effaceraient en silence.
for couple in 'card_sequence_enrollments_sequence_fk:a:true:false' 'card_sequence_enrollments_identity_fk:a:true:false' 'card_sequence_enrollments_card_fk:c:false:false'; do
	nom=${couple%%:*}
	attendu=${couple#*:}
	obtenu=$(psql_db -c "select confdeltype::text || ':' || condeferrable::text || ':' || condeferred::text from pg_constraint where conrelid='public.card_sequence_enrollments'::regclass and conname='$nom';")
	if [ "$obtenu" = "$attendu" ]; then
		ok "\`$nom\` porte bien \`$([ "${attendu%%:*}" = a ] && echo 'on delete no action, différable, immédiate' || echo 'on delete cascade')\`"
	else
		fail "\`$nom\` porte \`$obtenu\` au lieu de \`$attendu\` — l'asymétrie du §12.3 est perdue"
	fi
done

# =================================================================================================
echo
echo "3. Les autorisations — la table est FERMÉE EN ÉCRITURE À TOUT LE MONDE (§12.10)"
# =================================================================================================

if [ "$(psql_db -c "select has_table_privilege('authenticated','public.card_sequence_enrollments','SELECT')::text;")" = true ]; then
	ok "\`authenticated\` LIT la table"
else
	fail "\`authenticated\` ne lit pas la table — la politique ne serait jamais atteinte"
fi

for verbe in INSERT UPDATE DELETE; do
	if [ "$(psql_db -c "select has_table_privilege('authenticated','public.card_sequence_enrollments','$verbe')::text;")" = false ]; then
		ok "\`authenticated\` n'a PAS \`$verbe\` — les RPC sont les seules portes"
	else
		fail "\`authenticated\` détient \`$verbe\` — les huit refus de l'armement sont contournables"
	fi
done

# LA PORTE PRIVÉE EST FERMÉE AUX QUATRE RÔLES. `revoke … from public` ne retire RIEN à un rôle
# NOMMÉ : c'est le point de sûreté que les migrations 48 à 59 ont payé pour apprendre.
for role in anon authenticated service_role; do
	if [ "$(psql_db -c "select has_function_privilege('$role','app.executer_sequences_relance()','EXECUTE')::text;")" = false ]; then
		ok "\`$role\` ne déclenche PAS le job — la relance est un fait de l'horloge"
	else
		fail "\`$role\` peut déclencher le job — un client forcerait des envois"
	fi
done

# =================================================================================================
echo
echo '4. app.mail_outbox_inserer est la SEULE ligne d'"'"'insertion dans la file (§12.8)'
# =================================================================================================
# C'EST LE CONTRÔLE QUE CE HARNAIS EST LE SEUL À PORTER, et le motif est écrit en tête : le jour où
# une migration réécrirait un second `insert into public.mail_outbox`, la signature cesserait de
# s'ajouter par un des deux chemins et AUCUNE suite pgTAP ne le verrait — les deux chemins
# resteraient verts chacun de son côté.

# TROIS MIGRATIONS PORTENT CETTE ÉCRITURE, ET C'EST LÉGITIME — une migration passée ne se réécrit
# JAMAIS : la 30 porte le corps d'origine de `queue_outbound_email` (`CRM-058`), la 58 celui que la
# signature a révisé (`CRM-063` tranche 3), et la 60 la porte extraite. Seule la DERNIÈRE définition
# vaut, et c'est elle que la section 4 vérifie ensuite en base.
#
# LES TROIS SONT NOMMÉES PLUTÔT QUE COMPTÉES : un compte seul ne verrait pas une migration
# remplacée par une autre, et c'est la leçon de l'inventaire des politiques de
# `0016_preuves_refus.test.sql`. Une QUATRIÈME signifierait qu'un nouveau chemin d'écriture a été
# ouvert, et que la règle du §10.3 a cessé d'avoir une seule définition.
ATTENDUES='supabase/migrations/0030_envoi_sortant.sql
supabase/migrations/0058_signature_identite_sortante.sql
supabase/migrations/0060_armement_sequences.sql'
trouvees=$(grep -rl 'insert into public.mail_outbox' supabase/migrations/ 2>/dev/null | sort)
if [ "$trouvees" = "$ATTENDUES" ]; then
	ok "les TROIS migrations qui écrivent dans la file sont celles attendues — 30, 58 et 60"
else
	fail "les migrations qui écrivent dans la file ont changé : $(echo "$trouvees" | tr '\n' ' ') — la règle du §10.3 a DIVERGÉ"
fi

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='mail_outbox_inserer';")" = 1 ]; then
	ok "\`app.mail_outbox_inserer\` existe"
else
	fail "\`app.mail_outbox_inserer\` MANQUE — la porte extraite n'est pas posée"
fi

# `queue_outbound_email` DOIT L'APPELER : si elle réécrivait son `insert`, l'extraction n'aurait
# servi à rien et les deux chemins pourraient diverger de nouveau.
if psql_db -c "select prosrc from pg_proc where proname='queue_outbound_email';" | grep -q 'mail_outbox_inserer'; then
	ok "\`queue_outbound_email\` APPELLE la porte extraite — un seul chemin d'écriture"
else
	fail "\`queue_outbound_email\` n'appelle pas la porte extraite — deux chemins peuvent diverger"
fi

# =================================================================================================
echo
echo "5. Le job — enregistré, et sur la minute qui ne dispute rien (§12.9)"
# =================================================================================================

cadence=$(psql_db -c "select schedule from cron.job where jobname='p2enjoy-sequences-relance' and username='postgres';")
if [ -n "$cadence" ]; then
	ok "le job \`p2enjoy-sequences-relance\` est enregistré"
else
	fail "le job \`p2enjoy-sequences-relance\` est ABSENT — aucune relance ne partirait jamais"
fi

# LA CADENCE PEUT ÊTRE CELLE D'AMORÇAGE OU LA NOMINALE, et les deux sont légitimes : le premier
# passage promeut lui-même (§12.9). Ce qui serait faux est une TROISIÈME valeur.
if [ "$cadence" = "$CADENCE_NOMINALE" ] || [ "$cadence" = '10 seconds' ]; then
	ok "sa cadence est « $cadence » — nominale, ou l'amorçage que le premier passage promeut"
else
	fail "sa cadence est « $cadence » — ni « $CADENCE_NOMINALE », ni l'amorçage de dix secondes"
fi

# TROIS JOBS NE DOIVENT PAS SE DISPUTER LA MÊME MINUTE, et cela ne se verrait qu'en production.
minutes=$(psql_db -c "select string_agg(distinct split_part(schedule,' ',1), ',' order by split_part(schedule,' ',1)) from cron.job where schedule ~ '^[0-9]';")
if [ "$(psql_db -c "select count(*) from cron.job where schedule ~ '^[0-9]' group by split_part(schedule,' ',1) having count(*) > 1;" | head -n 1)" = '' ]; then
	ok "les jobs à cadence fixe occupent des minutes DISTINCTES ($minutes)"
else
	fail "deux jobs partagent la même minute ($minutes) — ils se disputeraient les ressources"
fi

# =================================================================================================
echo
echo "6. Le seed n'arme AUCUNE inscription (§12.12)"
# =================================================================================================
# Une inscription résiduelle serait exécutée DIX SECONDES après le démarrage de la pile, et des
# messages partiraient RÉELLEMENT chez les adresses du jeu de démonstration. C'est la pollution que
# la décision 516 a payée pour apprendre.

actives=$(psql_db -c "select count(*) from public.card_sequence_enrollments where status='active';")
if [ "$actives" = "$INSCRIPTIONS_DU_SEED" ]; then
	ok "aucune inscription ACTIVE en base — le jeu MONTRE une cadence, il ne l'EXPÉDIE pas"
else
	fail "$actives inscription(s) ACTIVE(s) — le job les ferait partir au prochain démarrage"
fi

# LA GARDE DU SEED EXISTE, et elle est ce qui empêchera la dérive. La constater ici plutôt que de
# la supposer : un seed dont la garde aurait été retirée repasserait ce harnais sans rien dire.
if grep -q 'inscriptions_actives' supabase/seed/apply-seed.sh; then
	ok "\`apply-seed.sh\` porte sa garde d'inscription résiduelle"
else
	fail "\`apply-seed.sh\` n'a plus sa garde du §12.12 — la dérive redeviendrait silencieuse"
fi

# =================================================================================================
echo
echo "7. La suite pgTAP et le contrat d'API"
# =================================================================================================

if suite_sql_verte; then
	ok "$(basename "$SUITE_SQL") : $(grep -oE '[0-9]+ assertions' "$TRAVAIL/tap.log" | tail -n 1), aucune anomalie"
else
	fail "$(basename "$SUITE_SQL") ROUGIT — $(tail -n 3 "$TRAVAIL/tap.log" | tr '\n' ' ')"
fi

if [ "$RAPIDE" = false ]; then
	# Le port 4173 est libéré AVANT, et le motif est protégé par la classe `[v]` : écrit
	# `pkill -f vite`, le motif se retrouve dans la ligne de commande du shell qui l'exécute et
	# `pkill` tue son propre appelant — MESURÉ (`docs/CloudWorker.md` §2.1 ter).
	pkill -f "[v]ite" >/dev/null 2>&1 || true
	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		armement-sequences >"$TRAVAIL/api.log" 2>&1
	then
		ok "$(basename "$SUITE_API") : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1)"
	else
		fail "$(basename "$SUITE_API") ROUGIT — $(tail -n 5 "$TRAVAIL/api.log" | tr '\n' ' ')"
	fi
else
	echo "  (--rapide : le contrat d'API n'est pas rejoué)"
fi

# =================================================================================================
echo
echo "8. Dégradations — la suite pgTAP doit RÉELLEMENT mordre"
# =================================================================================================
# Chaque dégradation retire UNE règle que la migration porte, et la suite doit rougir. Une
# dégradation qui laisserait la suite verte signalerait un trou dans la preuve, pas dans la
# migration.

if [ "$RAPIDE" = false ]; then
	# 1. L'index unique n'est plus PARTIEL, mais TOTAL : une affaire ne pourrait plus porter deux
	#    inscriptions successives. C'est l'assertion 7 et le scénario de réarmement qui doivent voir.
	# L'INDEX EST RETIRÉ, ET NON RENDU TOTAL — et le motif de ce choix est une MESURE qui vaut
	# mieux que la dégradation qu'elle a remplacée.
	#
	# La dégradation naturelle était « retirer le `where status = 'active'` », ce qui rend l'index
	# TOTAL. Elle est INAPPLICABLE dès qu'une preuve a tourné : le contrat d'API laisse derrière lui
	# les inscriptions qu'il a FERMÉES — une inscription est une trace, on la ferme, on ne l'efface
	# pas (§12.10) —, si bien qu'une affaire en porte déjà plusieurs et que l'index total est refusé
	# à sa création : « Key (card_id)=(5eed…00c4) is duplicated ».
	#
	# Cette inapplicabilité N'EST PAS UN OBSTACLE : c'est la démonstration même de ce que le
	# prédicat partiel sert à permettre. La base de développement PROUVE, par son seul état, qu'une
	# affaire doit pouvoir porter plusieurs inscriptions successives. La dégradation retenue retire
	# donc l'index ENTIÈREMENT, ce qui fait rougir les assertions 6 et 7 de la suite.
	#
	# LE `comment on index` QUI SUIT EST EMPORTÉ AVEC LUI, et c'est MESURÉ : laissé seul, il rend
	# « relation … does not exist » et la dégradation est refusée à l'application. Une dégradation
	# doit retirer une règle ENTIÈRE, pas la moitié qui laisse l'autre orpheline.
	# RÉÉCRITE PAR `CRM-111` T2.3.5 : l'index est retiré en base, et restauré depuis sa définition lue avant.
	index_a_restaurer=true
	if psql_db -c "drop index $INDEX_ACTIF;" >/dev/null 2>&1; then
		if suite_sql_verte; then
			fail "COMPLAISANT — « index unique d'inscription active RETIRÉ », la suite pgTAP reste VERTE"
		else
			ok "dégradation « index unique d'inscription active RETIRÉ » : la suite pgTAP rougit, comme elle doit"
		fi
	else
		fail "dégradation « index unique d'inscription active RETIRÉ » IMPOSSIBLE : le retrait est refusé"
	fi
	restaurer_index || fail "l'index unique n'a pas pu être restauré depuis sa définition"

	# 2. Le refus (h) est retiré. L'index le rattraperait — en `23505` aussi —, mais avec un message
	#    de catalogue au lieu d'un nom. C'est l'assertion 22, qui exige le NOM.
	eprouver_degradation "refus (h) enrollment_exists retiré" "$SIGNATURE_ARMER" \
		"raise exception 'enrollment_exists' using errcode = '23505';" \
		"null;"

	# 3. Le refus (f) est retiré : n'importe quel rattachement s'armerait, figé ou non. C'est le cœur
	#    du §12.2, et l'assertion 25 doit le voir.
	eprouver_degradation "refus (f) card_not_stalled retiré" "$SIGNATURE_ARMER" \
		"raise exception 'card_not_stalled' using errcode = '23514';" \
		"null;"

	# 4. La détection de réponse est ancrée sur `sent_at` au lieu de `created_at`. C'EST LA
	#    DÉGRADATION QUI COMPTE LE PLUS : `sent_at` est NULLE sur les messages du seed (§12.1), si
	#    bien qu'aucune réponse ne serait jamais détectée et que le produit relancerait quelqu'un
	#    qui vient de répondre — le seul défaut qu'un système de relance ne doit jamais avoir.
	eprouver_degradation "ancre de la réponse ramenée à sent_at" "$SIGNATURE_EXECUTEUR" \
		"and m.created_at > e.armed_at" \
		"and m.sent_at > e.armed_at"

	# 5. La borne de détection est `last_sent_at` au lieu d'`armed_at` : un premier palier partirait
	#    chez quelqu'un qui a déjà répondu, `last_sent_at` étant nulle avant le premier envoi.
	eprouver_degradation "borne de la réponse ramenée à last_sent_at" "$SIGNATURE_EXECUTEUR" \
		"and m.created_at > e.armed_at" \
		"and m.created_at > e.last_sent_at"

	# 6. Le délai est compté depuis l'ARMEMENT et non depuis le palier précédent : la cadence
	#    entière partirait le même jour. C'est le §11.4, et les assertions 41 et 42 doivent le voir.
	eprouver_degradation "délai compté depuis l'armement au lieu du palier précédent" "$SIGNATURE_EXECUTEUR" \
		"and now() >= coalesce(v_inscription.last_sent_at, v_inscription.armed_at)" \
		"and now() >= v_inscription.armed_at"

	# 7. La fermeture pour inéligibilité est retirée : un rattachement déplacé, endormi ou archivé
	#    continuerait de recevoir des relances. Quatre interruptions tombent d'un coup (§12.7). Depuis
	#    `CRM-111` T2.3.5, le prédicat porte sur le rattachement inscrit.
	eprouver_degradation "fermeture card_ineligible retirée" "$SIGNATURE_EXECUTEUR" \
		"where f.card_id = pl.card_id and f.channel_id = pl.channel_id);" \
		"where true);"
else
	echo "  (--rapide : les dégradations ne sont pas jouées)"
fi

# =================================================================================================
echo
echo "9. Restauration — aucun état dégradé ne survit à ce harnais"
# =================================================================================================

# Chaque dégradation a été restaurée depuis sa définition lue en base ; le `trap` le refait au besoin. Aucune
# migration n'est rejouée (`CRM-111` T2.3.5, docs/SPEC-test-harness.md §3.7).
degradations_restaurer

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de l'instantané pris avant la première dégradation"
fi

if [ "$(psql_db -c "select (indpred is not null)::text from pg_index where indexrelid='public.card_sequence_enrollments_active_unique'::regclass;")" = true ]; then
	ok "la base est restaurée : l'index unique est de nouveau PARTIEL"
	if [ "$(psql_db -c "select pg_get_indexdef('$INDEX_ACTIF'::regclass);")" = "$DEFINITION_INDEX" ]; then
		ok "…et sa définition est celle lue à l'entrée, à l'octet près"
	else
		fail "la définition de l'index diffère de celle lue à l'entrée"
	fi
else
	fail "la base est restée DÉGRADÉE — un état dégradé ne doit jamais survivre au harnais"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

restantes=$(psql_db -c "select count(*) from public.card_sequence_enrollments where status='active';")
if [ "$restantes" = "$INSCRIPTIONS_DU_SEED" ]; then
	ok "le seed est rendu INTACT : aucune inscription active, comme à l'entrée"
else
	fail "$restantes inscription(s) active(s) subsistent — ce harnais a pollué le jeu"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
