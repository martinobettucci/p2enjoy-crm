#!/usr/bin/env bash
# @verifies CRM-006 (docs/BACKLOG.md) — Definition of Done des types TypeScript générés
# @verifies docs/SPEC-types.md §3 (source), §4 (commandes), §5 (fichier), §6 (garde), §8 (preuves)
# @verifies docs/SCHEMA.md §1 (socle d'identité) ; docs/DAT.md §3.1 (webapp)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-006` :
#
#   1. la génération produit le fichier attendu, en-tête de traçabilité compris, et refuse
#      d'écrire quoi que ce soit lorsque le générateur ne répond pas ;
#   2. la sortie est **déterministe** et l'écriture **idempotente** ;
#   3. la garde anti-dérive est verte sur le dépôt tel qu'il est committé ;
#   4. la garde est **non complaisante**, éprouvée de deux façons — par le fichier, et **par le
#      schéma** : une table réellement créée en base doit la faire échouer, puis sa suppression
#      doit rendre la sortie identique au fichier versionné ;
#   5. les types compilent en mode strict, et leurs assertions sont **non complaisantes** : une
#      assertion faussée doit faire échouer `tsc` ;
#   6. les gardes du script de génération refusent ce qu'elles doivent refuser.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`). Tout ce qu'il
# modifie — table de preuve, fichier altéré, conteneur arrêté — est restauré par un `trap`, y
# compris en cas d'interruption, et l'état final est vérifié avant de conclure.
#
# Usage :
#   scripts/verify-types.sh

set -euo pipefail

cd "$(dirname "$0")/.."

META_CONTAINER=p2enjoy-meta
DB_CONTAINER=p2enjoy-db
TYPES_FILE=webapp/src/lib/database.types.ts
ASSERTIONS_FILE=webapp/src/lib/database.types.test-d.ts
TABLE_PREUVE=tst_crm006_table_de_preuve

TRAVAIL=$(mktemp -d)
SAUVEGARDE_TYPES="$TRAVAIL/database.types.ts.orig"
SAUVEGARDE_ASSERTIONS="$TRAVAIL/database.types.test-d.ts.orig"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# Le ménage est posé avant la première altération : une interruption ne doit laisser derrière
# elle ni table de preuve, ni fichier altéré, ni conteneur arrêté.
menage() {
	psql_db -c "drop table if exists public.${TABLE_PREUVE};" >/dev/null 2>&1 || true
	[ -f "$SAUVEGARDE_TYPES" ] && cp "$SAUVEGARDE_TYPES" "$TYPES_FILE"
	[ -f "$SAUVEGARDE_ASSERTIONS" ] && cp "$SAUVEGARDE_ASSERTIONS" "$ASSERTIONS_FILE"
	if [ "$(docker inspect -f '{{.State.Status}}' "$META_CONTAINER" 2>/dev/null || echo absent)" = exited ]; then
		docker start "$META_CONTAINER" >/dev/null 2>&1 || true
	fi
	rm -rf "$TRAVAIL"
}
trap menage EXIT

echo
echo "Preuves de CRM-006 — types TypeScript générés depuis le schéma"
echo

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi
for conteneur in "$META_CONTAINER" "$DB_CONTAINER"; do
	if [ "$(docker inspect -f '{{.State.Status}}' "$conteneur" 2>/dev/null || echo absent)" != running ]; then
		echo "ERREUR : conteneur $conteneur non démarré. Lancez ./runDev.sh." >&2
		exit 1
	fi
done
if [ ! -d node_modules ]; then
	echo "ERREUR : dépendances absentes. Lancez npm install." >&2
	exit 1
fi

cp "$TYPES_FILE" "$SAUVEGARDE_TYPES"
cp "$ASSERTIONS_FILE" "$SAUVEGARDE_ASSERTIONS"

# --- 1. Le fichier livré -----------------------------------------------------------------------

echo "1. Fichier livré"

if [ -f "$TYPES_FILE" ]; then
	ok "$TYPES_FILE présent"
else
	fail "$TYPES_FILE absent"
fi

if head -n 3 "$TYPES_FILE" | grep -q '@spec CRM-006'; then
	ok "en-tête de traçabilité présent (@spec CRM-006)"
else
	fail "en-tête de traçabilité absent : docs/MASTER_PLAN.md §3"
fi

if grep -q 'FICHIER GÉNÉRÉ' "$TYPES_FILE"; then
	ok "le fichier se déclare généré, et nomme la commande qui le régénère"
else
	fail "le fichier ne se déclare pas généré"
fi

if grep -q '^export type Database = {' "$TYPES_FILE"; then
	ok "type Database exporté"
else
	fail "type Database absent"
fi

tables_attendues="channel_members profiles track_members workspace_members workspaces"
tables_manquantes=""
for t in $tables_attendues; do
	grep -q "^      ${t}: {" "$TYPES_FILE" || tables_manquantes="$tables_manquantes $t"
done
if [ -z "$tables_manquantes" ]; then
	ok "les 5 tables du socle d'identité sont décrites (docs/SCHEMA.md §1)"
else
	fail "tables absentes du type :$tables_manquantes"
fi

# Le schéma `app` n'est pas exposé par PostgREST : le décrire produirait un type d'appels
# impossibles (docs/SPEC-types.md §3).
if grep -q '^  app: {' "$TYPES_FILE"; then
	fail "le schéma app est décrit alors que PostgREST ne l'expose pas"
else
	ok "le schéma app n'est pas décrit, conformément à docs/SPEC-types.md §3"
fi

if grep -q 'isOneToOne' "$TYPES_FILE"; then
	ok "detect_one_to_one_relationships appliqué (isOneToOne présent)"
else
	fail "isOneToOne absent : supabase-js typerait mal une relation embarquée"
fi

# --- 2. Déterminisme et idempotence -------------------------------------------------------------

echo
echo "2. Déterminisme et idempotence"

./scripts/generate-types.sh --stdout > "$TRAVAIL/sortie1.ts" 2>/dev/null
./scripts/generate-types.sh --stdout > "$TRAVAIL/sortie2.ts" 2>/dev/null

if cmp -s "$TRAVAIL/sortie1.ts" "$TRAVAIL/sortie2.ts"; then
	ok "deux générations successives rendent des octets identiques"
else
	fail "la sortie du générateur n'est pas déterministe"
fi

empreinte_avant=$(sha256sum "$TYPES_FILE" | cut -d' ' -f1)
sortie_write=$(./scripts/generate-types.sh 2>&1)
empreinte_apres=$(sha256sum "$TYPES_FILE" | cut -d' ' -f1)

if [ "$empreinte_avant" = "$empreinte_apres" ]; then
	ok "une régénération sur un dépôt à jour ne modifie pas le fichier"
else
	fail "la régénération a modifié le fichier alors que le schéma n'a pas changé"
fi

if printf '%s' "$sortie_write" | grep -q 'Types inchangés'; then
	ok "la régénération le dit explicitement plutôt que de réécrire en silence"
else
	fail "la régénération n'annonce pas que le fichier était déjà à jour"
fi

# --- 3. Garde anti-dérive -----------------------------------------------------------------------

echo
echo "3. Garde anti-dérive"

if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	ok "npm run types:check : le fichier versionné correspond au schéma, octet à octet"
else
	fail "npm run types:check échoue sur le dépôt tel qu'il est committé"
fi

# --- 4. La garde échoue quand elle le doit — par le fichier --------------------------------------

echo
echo "4. Non-complaisance de la garde, par le fichier"

# Une seule colonne renommée : l'altération la plus discrète qu'un humain puisse commettre.
sed -i 's/^          full_name: string$/          full_name_altere: string/' "$TYPES_FILE"
if grep -q 'full_name_altere' "$TYPES_FILE"; then
	if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
		fail "une colonne renommée à la main passe la garde"
	else
		ok "une colonne renommée à la main fait échouer la garde"
	fi
else
	fail "altération de contrôle non appliquée : la preuve ne vaut rien"
fi

cp "$SAUVEGARDE_TYPES" "$TYPES_FILE"
if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	ok "altération annulée : la garde redevient verte"
else
	fail "la garde reste rouge après restauration du fichier"
fi

# --- 5. La garde échoue quand elle le doit — par le schéma ---------------------------------------
# C'est la preuve qui établit que le générateur lit la **base vivante**, et non un cache ou un
# artefact : rien n'est touché ici que la base elle-même.

echo
echo "5. Non-complaisance de la garde, par le schéma"

psql_db -v ON_ERROR_STOP=1 -c "
	create table public.${TABLE_PREUVE} (
		id uuid primary key default gen_random_uuid(),
		libelle text not null
	);
	alter table public.${TABLE_PREUVE} enable row level security;
	grant select on public.${TABLE_PREUVE} to anon, authenticated;
" >/dev/null

./scripts/generate-types.sh --stdout > "$TRAVAIL/sortie_avec_table.ts" 2>/dev/null

if grep -q "${TABLE_PREUVE}: {" "$TRAVAIL/sortie_avec_table.ts"; then
	ok "une table créée en base apparaît immédiatement dans la sortie du générateur"
else
	fail "une table créée en base n'apparaît pas : le générateur ne lit pas la base vivante"
fi

if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	fail "un schéma modifié passe la garde : la dérive ne serait jamais détectée"
else
	ok "un schéma modifié fait échouer la garde"
fi

psql_db -v ON_ERROR_STOP=1 -c "drop table public.${TABLE_PREUVE};" >/dev/null

./scripts/generate-types.sh --stdout > "$TRAVAIL/sortie_apres_retrait.ts" 2>/dev/null
if cmp -s "$TRAVAIL/sortie_apres_retrait.ts" "$TYPES_FILE"; then
	ok "table retirée : la sortie redevient identique au fichier versionné"
else
	fail "la sortie ne redevient pas identique après retrait de la table de preuve"
fi

if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	ok "la garde redevient verte"
else
	fail "la garde reste rouge après retrait de la table de preuve"
fi

# --- 6. Compilation stricte et assertions --------------------------------------------------------

echo
echo "6. Compilation stricte et assertions de type"

if npm run --silent typecheck >/dev/null 2>&1; then
	ok "npm run typecheck : tsc --noEmit vert, en mode strict"
else
	fail "npm run typecheck échoue sur le dépôt tel qu'il est committé"
	npm run --silent typecheck 2>&1 | head -n 10 | sed 's/^/        /'
fi

if grep -q '"strict": true' tsconfig.json; then
	ok "tsconfig.json impose strict : true"
else
	fail "tsconfig.json ne compile pas en mode strict"
fi

# Une assertion volontairement fausse. Sans cette preuve, un fichier d'assertions qui ne
# contraindrait rien passerait pour une preuve.
sed -i "s/Equal<Tables<'profiles'>\['full_name'\], string>/Equal<Tables<'profiles'>['full_name'], number>/" "$ASSERTIONS_FILE"
if grep -q "\['full_name'\], number>" "$ASSERTIONS_FILE"; then
	if npm run --silent typecheck >/dev/null 2>&1; then
		fail "une assertion fausse compile : les assertions ne contraignent rien"
	else
		ok "une assertion fausse fait échouer tsc"
	fi
else
	fail "altération de contrôle non appliquée sur les assertions : la preuve ne vaut rien"
fi

cp "$SAUVEGARDE_ASSERTIONS" "$ASSERTIONS_FILE"
if npm run --silent typecheck >/dev/null 2>&1; then
	ok "assertion restaurée : tsc redevient vert"
else
	fail "tsc reste rouge après restauration des assertions"
fi

nb_assertions=$(grep -c '^type _' "$ASSERTIONS_FILE")
if [ "$nb_assertions" -ge 19 ]; then
	ok "$nb_assertions assertions de type dans $ASSERTIONS_FILE"
else
	fail "seulement $nb_assertions assertions : la couverture a régressé"
fi

# --- 7. Gardes du script de génération -----------------------------------------------------------

echo
echo "7. Gardes du script de génération"

if ./scripts/generate-types.sh --option-inexistante >/dev/null 2>&1; then
	fail "une option inconnue est acceptée en silence"
else
	ok "une option inconnue est refusée"
fi

if ./scripts/generate-types.sh --help 2>/dev/null | grep -q 'types:check'; then
	ok "--help documente les modes depuis l'en-tête du fichier"
else
	fail "--help ne rend pas l'aide attendue"
fi

# Profil : la génération lit une base, et ne doit jamais viser autre chose qu'un environnement de
# développement (CLAUDE.md §9). Le fichier jetable évite de toucher au .env du poste.
ENV_JETABLE="$TRAVAIL/env-prod"
sed 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=prod/' .env > "$ENV_JETABLE"
if P2ENJOY_ENV_FILE="$ENV_JETABLE" ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	fail "la génération accepte un environnement en profil prod"
else
	ok "la génération refuse un environnement en profil prod"
fi

# Générateur injoignable : le script doit échouer bruyamment, et surtout ne rien écrire.
docker stop "$META_CONTAINER" >/dev/null
empreinte_avant_arret=$(sha256sum "$TYPES_FILE" | cut -d' ' -f1)
if ./scripts/generate-types.sh >/dev/null 2>&1; then
	fail "la génération réussit alors que le générateur est arrêté"
else
	ok "générateur arrêté : la génération échoue explicitement"
fi
if [ "$(sha256sum "$TYPES_FILE" | cut -d' ' -f1)" = "$empreinte_avant_arret" ]; then
	ok "générateur arrêté : aucun fichier n'a été écrit"
else
	fail "le fichier a été écrit alors que le générateur ne répondait pas"
fi
docker start "$META_CONTAINER" >/dev/null
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$META_CONTAINER" 2>/dev/null)" = healthy ]; do
	sleep 1
done
if ./scripts/generate-types.sh --check >/dev/null 2>&1; then
	ok "générateur redémarré : la garde redevient verte"
else
	fail "la garde reste rouge après redémarrage du générateur"
fi

# --- 8. État final ------------------------------------------------------------------------------
# Un harnais qui laisserait derrière lui une table de preuve ou un fichier altéré ne prouverait
# rien : il faut le constater, pas le supposer.

echo
echo "8. État final"

if [ "$(psql_db -c "select count(*) from pg_tables where schemaname = 'public' and tablename = '${TABLE_PREUVE}';")" = "0" ]; then
	ok "aucune table de preuve résiduelle en base"
else
	fail "la table de preuve ${TABLE_PREUVE} subsiste en base"
fi

if cmp -s "$TYPES_FILE" "$SAUVEGARDE_TYPES" && cmp -s "$ASSERTIONS_FILE" "$SAUVEGARDE_ASSERTIONS"; then
	ok "les fichiers du dépôt sont dans leur état initial"
else
	fail "un fichier du dépôt a été laissé altéré"
fi

# --- Bilan ---------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
