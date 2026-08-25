#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
#           TRANCHE 4, SOUS-TRANCHE 4a : LA SÉQUENCE ET SES PALIERS
# @verifies docs/SPEC-modeles-emails.md §11.3 (colonnes de `mail_sequences`), §11.4 (le palier, le
#           délai relatif, le `on delete restrict`), §11.5 (les seize refus), §11.6 (la position est
#           `deferrable`, et une mesure l'impose), §11.6 bis (ce que la route ne sait pas faire),
#           §11.7 (autorisations), §11.9 (le seed), §11.10 (preuves exigées)
# @verifies docs/SPEC-modeles-emails.md §2.2 (le `on delete restrict` annoncé quatre tranches avant)
# @verifies docs/SCHEMA.md §7 ; docs/PROD_MIGRATIONS.md migration 59
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la sous-tranche, puis DÉGRADE RÉELLEMENT la migration — une
# dégradation par règle qu'elle porte — et exige que la suite pgTAP rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QUE CE HARNAIS SURVEILLE EN PROPRE, ET QU'AUCUN AUTRE NE PEUT VOIR.
#
# 1. LE REJEU DE LA MIGRATION, TROIS FOIS DE SUITE. Cette migration pose deux contraintes uniques
#    dont des CLÉS ÉTRANGÈRES dépendent, et un `drop constraint if exists` y échoue dès le DEUXIÈME
#    passage — MESURÉ le 2026-08-25, « cannot drop … because other objects depend on it ». La
#    panne ne se serait vue qu'au deuxième démarrage suivant, c'est-à-dire chez le prochain
#    contributeur. C'est la même famille que celle payée par la migration 58 (décision 516), et
#    seul un rejeu répété la dénoncerait.
#
# 2. LE CARACTÈRE `DEFERRABLE` DE LA CONTRAINTE DE POSITION, éprouvé par le GESTE et non par le
#    seul catalogue : un échange atomique de deux positions doit passer. Avec une contrainte
#    simple, il rend `23505` (§11.6).
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu
# (`docs/SPEC-test-harness.md` §7.2 point 3) : aucun ARMEMENT — aucune affaire n'est liée à une
# séquence, c'est la sous-tranche 4b ; aucun ENVOI ; aucun ÉCRAN, qui est 4c.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0059_sequences_relance.sql
SUITE_SQL=supabase/tests/0057_sequences_relance.test.sql
SUITE_API=e2e/api/sequences-relance.spec.ts
SPEC=docs/SPEC-modeles-emails.md

# Ce que le seed pose — `docs/SPEC-modeles-emails.md` §11.9. Les identifiants sont STABLES, le seed
# les posant explicitement.
SEQUENCE_DU_SEED='5e900000-0000-4000-8000-000000000001'
SEQUENCES_DU_SEED=1
PALIERS_DU_SEED=3
# Le modèle EMPLOYÉ par les paliers 1 et 3 — c'est lui que le `on delete restrict` protège.
MODELE_EMPLOYE='7e11a7e0-0000-4000-8000-000000000001'

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

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

# Substitue dans une COPIE de la migration, puis l'applique. L'échec du substituteur ET celui de
# l'application sont TESTÉS : ce sont les deux défauts que les harnais jumeaux ont trouvés dans leur
# propre code (§2.11 et §8.9 bis) — une substitution qui ne substitue rien, ou un SQL dégradé qui ne
# compile pas, laissent la base INCHANGÉE et le harnais conclut « COMPLAISANT » sans rien avoir
# dégradé. Le remède est repris ici tel quel plutôt que redécouvert.
degrader() {
	local avant=$1 apres=$2 nom=$3
	rm -f -- "$TRAVAIL/degrade.sql"
	if ! python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : motif absent ou ambigu dans $MIGRATION"
		return 1
	fi
	if cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	restauration_due=true
	if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation « $nom » IMPOSSIBLE : le SQL dégradé ne s'applique pas — $(tail -n 1 "$TRAVAIL/degrade.log")"
		restaurer
		return 1
	fi
	return 0
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
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
echo "Preuves de CRM-063 tranche 4a — la séquence de relance et ses paliers"
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

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la sous-tranche n'est orphelin de sa spécification"
# =================================================================================================

for fichier in "$MIGRATION" "$SUITE_SQL" "$SUITE_API"; do
	if head -n 14 "$fichier" | grep -qE '@(spec|verifies) CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "$(basename "$fichier") cite CRM-063 et sa spécification"
	else
		fail "$(basename "$fichier") n'a pas ses commentaires de traçabilité (CLAUDE.md §5)"
	fi
done

if grep -q '^## 11. Tranche 4 — la séquence de relance' "$SPEC"; then
	ok "le §11 de la spécification existe : le code ne précède pas sa spécification"
else
	fail "le §11 de docs/SPEC-modeles-emails.md est ABSENT : le code précéderait sa spécification"
fi

if grep -q '^### 11.6 bis' "$SPEC"; then
	ok "le §11.6 bis existe : la ligne 15 du contrat révisée par la mesure est écrite"
else
	fail "le §11.6 bis est absent : la révision de la ligne 15 ne serait consignée nulle part"
fi

# =================================================================================================
echo
echo "2. LE REJEU DE LA MIGRATION — le contrôle propre à cette sous-tranche"
# =================================================================================================
# MESURÉ le 2026-08-25 : posées par `drop constraint if exists` puis `add`, les deux contraintes
# uniques `(id, workspace_id)` font échouer le DEUXIÈME passage — les clés étrangères composites en
# dépendent. Un `cascade` les emporterait silencieusement. La forme conditionnelle est la seule qui
# converge, et seul un rejeu RÉPÉTÉ la vérifie.

if psql_db -f - < "$MIGRATION" >"$TRAVAIL/rejeu1.log" 2>&1 \
	&& psql_db -f - < "$MIGRATION" >"$TRAVAIL/rejeu2.log" 2>&1 \
	&& psql_db -f - < "$MIGRATION" >"$TRAVAIL/rejeu3.log" 2>&1; then
	ok "la migration 59 se rejoue TROIS fois de suite : ses contraintes référencées convergent"
else
	fail "la migration 59 n'est pas idempotente : $(tail -n 1 "$TRAVAIL/rejeu3.log")"
fi

# LES DEUX CLÉS COMPOSITES ONT SURVÉCU AUX REJEUX. Si un `drop … cascade` s'était glissé quelque
# part, elles auraient disparu sans bruit et le cloisonnement serait devenu faux.
for contrainte in mail_sequence_steps_sequence_workspace_fkey mail_sequence_steps_template_workspace_fkey; do
	if [ "$(psql_db -c "select count(*) from pg_constraint where conrelid='public.mail_sequence_steps'::regclass and conname='$contrainte';")" = 1 ]; then
		ok "après les trois rejeux, $contrainte est toujours là"
	else
		fail "$contrainte a DISPARU : un cascade l'a emportée, le cloisonnement n'est plus tenu"
	fi
done

# =================================================================================================
echo
echo "3. La forme des deux tables — §11.3 et §11.4"
# =================================================================================================

for table in mail_sequences mail_sequence_steps; do
	if [ "$(psql_db -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$table';")" = 1 ]; then
		ok "la table public.$table existe"
	else
		fail "la table public.$table est ABSENTE"
	fi
	if [ "$(psql_db -c "select relrowsecurity::text from pg_class where oid='public.$table'::regclass;")" = true ]; then
		ok "la RLS est activée sur $table"
	else
		fail "la RLS n'est PAS activée sur $table : la table serait ouverte à tout porteur de jeton"
	fi
	if [ "$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='$table';")" = 4 ]; then
		ok "$table porte ses quatre politiques, une par action"
	else
		fail "$table ne porte pas quatre politiques"
	fi
done

# « AUCUNE COLONNE SANS LECTEUR » — la leçon d'INC-215, que la tranche 3 vient de payer (§11.3).
for colonne in description is_active archived_at identity_id; do
	if [ "$(psql_db -c "select count(*) from information_schema.columns where table_schema='public' and table_name='mail_sequences' and column_name='$colonne';")" = 0 ]; then
		ok "mail_sequences ne porte AUCUNE colonne $colonne : la décision du §11.3 tient"
	else
		fail "mail_sequences porte une colonne $colonne : ajoutée sans réviser le §11.3 ?"
	fi
done

# =================================================================================================
echo
echo "4. LA POSITION EST DEFERRABLE, et l'échange atomique le prouve — §11.6"
# =================================================================================================

if [ "$(psql_db -c "select condeferrable::text from pg_constraint where conrelid='public.mail_sequence_steps'::regclass and conname='mail_sequence_steps_sequence_position_key';")" = true ]; then
	ok "la contrainte de position est DEFERRABLE, lu dans pg_constraint"
else
	fail "la contrainte de position n'est PAS deferrable : tout réordonnancement devient impossible"
fi

if [ "$(psql_db -c "select condeferred::text from pg_constraint where conrelid='public.mail_sequence_steps'::regclass and conname='mail_sequence_steps_sequence_position_key';")" = false ]; then
	ok "elle reste INITIALLY IMMEDIATE : un doublon est refusé par l'instruction qui le crée"
else
	fail "elle est INITIALLY DEFERRED : l'appelant ne saurait plus quelle écriture a fauté"
fi

# LE GESTE, ET NON LE SEUL CATALOGUE. Tout vit dans une transaction annulée : le seed est intact.
#
# LES SONDES CAPTURENT `2>&1`, ET C'EST UN DÉFAUT TROUVÉ PAR CE HARNAIS DANS CE HARNAIS, le
# 2026-08-25. `raise notice` écrit sur STDERR : une sonde qui ne capture que stdout lit la chaîne
# VIDE et conclut au refus QUOI QU'IL ARRIVE — un verdict rouge sur un produit sain, qui accuse la
# migration d'un défaut qu'elle n'a pas. C'est la quatrième forme du même mensonge tranquille
# consignée par cette unité, après la substitution qui échoue en silence (§2.11), l'application qui
# échoue en silence (§8.9 bis) et la dégradation qui converge (décision 516) : ici, c'est la SONDE
# QUI N'ÉCOUTE PAS. La règle générale vaut au-delà de ce harnais : une sonde qui lit un `notice`
# lit STDERR.
echange=$(psql_db 2>&1 <<SQL
begin;
insert into public.mail_sequences (id, workspace_id, name)
values ('c1a00000-0000-4000-8000-0000000000e1', (select workspace_id from public.mail_sequences where id = '$SEQUENCE_DU_SEED'), 'Sonde du harnais 4a');
insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
select (select workspace_id from public.mail_sequences where id = '$SEQUENCE_DU_SEED'),
       'c1a00000-0000-4000-8000-0000000000e1', p, p * 3, '$MODELE_EMPLOYE'
  from generate_series(1, 2) p;
do \$\$
begin
	update public.mail_sequence_steps set position = 3 - position
	 where sequence_id = 'c1a00000-0000-4000-8000-0000000000e1';
	raise notice 'ECHANGE_ACCEPTE';
exception when unique_violation then raise notice 'ECHANGE_REFUSE';
end \$\$;
rollback;
SQL
)
if printf '%s' "$echange" | grep -q 'ECHANGE_ACCEPTE'; then
	ok "l'échange atomique de deux positions PASSE : c'est ce que le deferrable existe pour permettre"
else
	fail "l'échange atomique de deux positions est REFUSÉ — la contrainte se comporte en unique simple"
fi

# =================================================================================================
echo
echo "5. LE ON DELETE RESTRICT annoncé par le §2.2 — et son témoin"
# =================================================================================================
# LE TÉMOIN EST INDISPENSABLE : un `restrict` qui refuserait TOUTE suppression de modèle passerait
# le premier contrôle et serait pourtant une panne. Le second l'en distingue.

refus=$(psql_db 2>&1 <<SQL
do \$\$
begin
	delete from public.mail_templates where id = '$MODELE_EMPLOYE';
	raise notice 'SUPPRESSION_ACCEPTEE';
exception when foreign_key_violation then raise notice 'SUPPRESSION_REFUSEE';
end \$\$;
SQL
)
if printf '%s' "$refus" | grep -q 'SUPPRESSION_REFUSEE'; then
	ok "un modèle EMPLOYÉ par un palier ne se supprime plus (§2.2)"
else
	fail "un modèle employé s'est SUPPRIMÉ : le on delete restrict du §2.2 n'est pas posé"
fi

temoin=$(psql_db 2>&1 <<SQL
begin;
insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values ('c1a00000-0000-4000-8000-0000000000e9',
        (select workspace_id from public.mail_sequences where id = '$SEQUENCE_DU_SEED'),
        'Modèle libre du harnais 4a', 'Objet fixe', 'Employé par aucun palier.');
do \$\$
begin
	delete from public.mail_templates where id = 'c1a00000-0000-4000-8000-0000000000e9';
	raise notice 'LIBRE_SUPPRIME';
exception when foreign_key_violation then raise notice 'LIBRE_RETENU';
end \$\$;
rollback;
SQL
)
if printf '%s' "$temoin" | grep -q 'LIBRE_SUPPRIME'; then
	ok "TÉMOIN : un modèle employé par AUCUN palier se supprime — le restrict ne bloque pas tout"
else
	fail "un modèle LIBRE ne se supprime pas non plus : le restrict bloque au-delà de son objet"
fi

# =================================================================================================
echo
echo "6. Le seed pose ce que le §11.9 exige, et ce qu'il doit DÉMONTRER"
# =================================================================================================

if [ "$(psql_db -c "select count(*) from public.mail_sequences;")" = "$SEQUENCES_DU_SEED" ]; then
	ok "le seed pose $SEQUENCES_DU_SEED séquence"
else
	fail "le seed ne pose pas $SEQUENCES_DU_SEED séquence : rejeu dupliqué, ou écriture refusée"
fi

if [ "$(psql_db -c "select count(*) from public.mail_sequence_steps where sequence_id = '$SEQUENCE_DU_SEED';")" = "$PALIERS_DU_SEED" ]; then
	ok "elle porte ses $PALIERS_DU_SEED paliers"
else
	fail "la séquence du seed ne porte pas $PALIERS_DU_SEED paliers"
fi

# LES DÉLAIS SONT RELATIFS (§11.4) : 3, 7, 14 — et non 3, 10, 24 qui serait la lecture absolue.
if [ "$(psql_db -c "select string_agg(delai_jours::text, ',' order by position) from public.mail_sequence_steps where sequence_id = '$SEQUENCE_DU_SEED';")" = '3,7,14' ]; then
	ok "les délais du seed sont 3, 7 et 14 — comptés depuis le palier précédent, jamais en absolu"
else
	fail "les délais du seed ont changé : la convention relative du §11.4 n'est plus démontrée"
fi

# CE QUE LE JEU DOIT DÉMONTRER, et non son seul compte : un modèle sert PLUSIEURS paliers.
if [ "$(psql_db -c "select count(distinct template_id) from public.mail_sequence_steps where sequence_id = '$SEQUENCE_DU_SEED';")" = 2 ] \
	&& [ "$(psql_db -c "select count(*) from public.mail_sequence_steps where sequence_id = '$SEQUENCE_DU_SEED' and template_id = '$MODELE_EMPLOYE';")" = 2 ]; then
	ok "un même modèle sert DEUX paliers : c'est ce que le jeu de démonstration existe pour prouver"
else
	fail "aucun modèle ne sert deux paliers : une unicité posée par erreur passerait inaperçue"
fi

# =================================================================================================
echo
echo "7. Les preuves de la sous-tranche, rejouées"
# =================================================================================================

if suite_sql_verte; then
	ok "la suite pgTAP $SUITE_SQL est verte"
else
	fail "la suite pgTAP $SUITE_SQL ROUGIT : $(tail -n 3 "$TRAVAIL/tap.log" | tr '\n' ' ')"
fi

# La chaîne Node est préparée ici, et pas plus haut : les contrôles précédents n'en ont pas besoin,
# et trente et un des harnais du dépôt refusent de s'exécuter sans le couple Node 24 / npm 11+.
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

if [ "$RAPIDE" = true ]; then
	ok "contrat d'API NON exécuté (--rapide) — dit plutôt que tu"
else
	if npm run e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1; then
		ok "$SUITE_API : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1)"
	else
		fail "$SUITE_API rougit — voir $TRAVAIL/api.log"
		tail -n 40 "$TRAVAIL/api.log" >&2
	fi
fi

# =================================================================================================
echo
echo "8. DÉGRADATIONS RÉELLES — la suite pgTAP doit rougir pour chacune"
# =================================================================================================
# Une dégradation par RÈGLE que la migration porte. Un harnais dont les dégradations ne mordent pas
# certifie une suite qui ne prouve rien (`docs/SPEC-test-harness.md` §7.2).

eprouver_degradation "la borne du délai" \
	'check (delai_jours between 1 and 365)' \
	'check (delai_jours between 0 and 100000)'

eprouver_degradation "la borne de la position" \
	'check (position between 1 and 50)' \
	'check (position between 0 and 100000)'

# CETTE DÉGRADATION A TROUVÉ UN DÉFAUT DE LA MIGRATION, ET NON L'INVERSE. Écrite d'abord contre la
# clé étrangère déclarée EN LIGNE dans le `create table if not exists`, elle laissait la suite pgTAP
# VERTE : un `create table if not exists` est un no-op sur une table existante, si bien que la règle
# en ligne n'est jamais reposée — donc jamais réparée non plus, sur aucune base déjà migrée. Les
# trois clés du palier sont désormais posées par `alter table`, et la dégradation MORD.
eprouver_degradation "le on delete restrict du modèle" \
	'	foreign key (template_id) references public.mail_templates (id) on delete restrict;' \
	'	foreign key (template_id) references public.mail_templates (id) on delete cascade;'

eprouver_degradation "le caractère deferrable de la position" \
	'	unique (sequence_id, position) deferrable initially immediate;' \
	'	unique (sequence_id, position);'

eprouver_degradation "la clé composite vers le modèle" \
	'	foreign key (template_id, workspace_id)
	references public.mail_templates (id, workspace_id) on delete restrict;' \
	'	foreign key (template_id) references public.mail_templates (id) on delete restrict;'

eprouver_degradation "la politique d'insertion des paliers" \
	"	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequence_steps_maj_membre_ecrivant" \
	"	with check (true);

drop policy if exists mail_sequence_steps_maj_membre_ecrivant"

eprouver_degradation "le privilège refermé sur anon" \
	'revoke all on public.mail_sequences from anon, authenticated;
grant select                 on public.mail_sequences to anon, authenticated;
grant insert, update, delete on public.mail_sequences to authenticated;' \
	'revoke all on public.mail_sequences from anon, authenticated;
grant select                 on public.mail_sequences to anon, authenticated;
grant insert, update, delete on public.mail_sequences to authenticated, anon;'

# =================================================================================================
echo
echo "9. Restauration — aucun état dégradé ne survit à ce harnais"
# =================================================================================================

restaurer

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de l'instantané pris avant la première dégradation"
fi

if [ "$(psql_db -c "select condeferrable::text from pg_constraint where conrelid='public.mail_sequence_steps'::regclass and conname='mail_sequence_steps_sequence_position_key';")" = true ]; then
	ok "la base est restaurée : la contrainte de position est de nouveau DEFERRABLE"
else
	fail "la base est restée DÉGRADÉE — un état dégradé ne doit jamais survivre au harnais"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

compte_paliers=$(psql_db -c "select count(*) from public.mail_sequence_steps;")
if [ "$compte_paliers" = "$PALIERS_DU_SEED" ]; then
	ok "le seed est rendu INTACT : $PALIERS_DU_SEED paliers, comme à l'entrée"
else
	fail "le seed porte $compte_paliers palier(s) au lieu de $PALIERS_DU_SEED"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
