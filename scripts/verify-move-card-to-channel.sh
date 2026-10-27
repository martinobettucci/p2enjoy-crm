#!/usr/bin/env bash
# @verifies CRM-045 (docs/BACKLOG.md) — Definition of Done du déplacement entre channels
# @verifies docs/SPEC-workflow-engine.md §6.2 (signature), §6.3 (ce que la base interdit déjà),
#           §6.4 (les huit vérifications), §6.5 (effets), §6.6 (réponses de formulaire),
#           §6.7 (l'événement), §6.8 (privilèges), §6.12 (seed), §6.13 (preuves attendues)
# @verifies docs/SPEC-cards.md §14.4 (dix types, dont `channel_changed`), §14.6 (payload)
# @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 1 et n° 5)
# @verifies docs/SPEC-seed.md §2.16 (aller-retour de channel, convergence)
# @verifies docs/JOURNAL.md décisions 213 à 218
# @verifies CLAUDE.md §8 (aucune trace fabriquée), §10 (règles prouvées hors interface)
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.4 : `move_card_to_channel(p_placement, …)` désigne le rattachement et le
#           rend, la garde `already_attached` (docs/SPEC-rattachements.md §5, §14 ; docs/JOURNAL.md décision 731) ;
#           les événements naissent sur `card_placements` (T2.3.0), les colonnes ouvertes sont quatre (T2.3.2) ; aucune
#           migration ancienne n'est plus rejouée (docs/SPEC-test-harness.md §3.7, INC-304)
# @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — les colonnes de rattachement se lisent et s'écrivent sur card_placements
#           (docs/SPEC-rattachements.md §3.2, §5)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-045` :
#
#   1. les fichiers livrés portent leur traçabilité `@spec` / `@verifies` ;
#   2. le schéma RÉELLEMENT en base porte ce que la spécification annonce : la fonction, sa
#      signature, son propriétaire, son `search_path`, ses privilèges, le `CHECK` actuel à dix
#      valeurs dont `channel_changed`,
#      et la cinquième garde du trigger de `cards` ;
#   3. LES COLONNES QUE CETTE UNITÉ NE FERME PAS SONT FERMÉES QUAND MÊME — décision 214. C'est le
#      seul contrôle du dépôt qui défende un privilège qu'aucune migration ne pose ;
#   4. la suite pgTAP dédiée est verte, et la suite globale avec elle ;
#   5. la preuve d'API dédiée est verte, et elle NETTOIE derrière elle — ce qui est constaté ;
#   6. le seed porte son aller-retour, et `prospection` porte ses deux cards DÉRIVÉES ;
#   7. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Le compte de `channel_changed` est écrit comme une BORNE INFÉRIEURE, pour la raison de la
# décision 210 : une timeline enregistre tout, y compris ce que les autres preuves du dépôt font à
# la même pile. Le seul compte exact asséré est celui des cards de `prospection` — DEUX depuis
# `CRM-046` —, qui est un état et non une histoire.
#
# AUCUN CONTRÔLE D'INTERFACE : `CRM-045` ne livre aucun écran, et sa Definition of Done est la
# seule du chunk 3 à ne pas demander de captures (docs/SPEC-workflow-engine.md §6.10).
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-move-card-to-channel.sh
#   scripts/verify-move-card-to-channel.sh --rapide   n'exécute ni Playwright ni les suites globales

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/reconstruction.sh
source scripts/lib/reconstruction.sh

# shellcheck source=scripts/lib/degradation.sh
source scripts/lib/degradation.sh

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0017_move_card_to_channel.sql
# `CRM-111` T2.3.4 : la dernière autorité sur la fonction. Le harnais ne rejoue ni l'une ni l'autre (§3.7) : il les lit.
MIGRATION_RATTACHEMENT=supabase/migrations/0117_changer_de_channel_un_rattachement.sql
TEST_SQL=supabase/tests/0019_move_card_to_channel.test.sql
SPEC_API=e2e/api/move-card-to-channel.spec.ts
SEED=supabase/seed/apply-seed.sh
# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)

SIGNATURE='public.move_card_to_channel(uuid, uuid, uuid, boolean)'
CHANNEL_PROSPECTION=5eed0000-0000-4000-8000-000000000031
CARD_SEED=5eed0000-0000-4000-8000-0000000000c5

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,41p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
	esac
	shift
done

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

TRAVAIL=$(mktemp -d)
DEPART=$(mktemp -d)
# Les définitions dégradées sont réappliquées depuis la base même si le harnais s'interrompt (§3.7).
nettoyer() { degradations_restaurer; rm -rf "$TRAVAIL" "$DEPART" "$DEGRADATIONS_DOSSIER"; }
trap nettoyer EXIT

# État des fichiers à l'entrée du harnais, et non l'état de `HEAD` : un contrôle qui comparerait au
# dernier commit ne pourrait pas être vert pendant qu'on travaille (décision 166).
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MIGRATION" "$MIGRATION_RATTACHEMENT" "$TEST_SQL"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$MIGRATION_RATTACHEMENT" "$TEST_SQL" "$SPEC_API"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

if head -3 "$MIGRATION" | grep -q '@spec CRM-045'; then
	ok "$(basename "$MIGRATION") porte son commentaire @spec"
else
	fail "$(basename "$MIGRATION") ne cite pas son unité de backlog"
fi

if head -1 "$MIGRATION_RATTACHEMENT" | grep -q '@spec CRM-111'; then
	ok "$(basename "$MIGRATION_RATTACHEMENT") porte son commentaire @spec — tranche T2.3.4"
else
	fail "$(basename "$MIGRATION_RATTACHEMENT") ne cite pas son unité de backlog"
fi

for fichier in "$TEST_SQL" "$SPEC_API"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-045'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# Le seed est un livrable de cette unité au même titre que la migration : sa section 8 septies est
# le seul endroit du dépôt où l'événement naît d'un geste réel (CLAUDE.md §8).
if grep -q 'move_card_to_channel' "$SEED"; then
	ok "le seed appelle la VRAIE RPC : aucune trace n'est fabriquée (CLAUDE.md §8)"
else
	fail "le seed n'appelle pas move_card_to_channel : l'événement serait forgé ou absent"
fi

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. La fonction réellement en base"

if [ "$(psql_db -c "select to_regprocedure('$SIGNATURE') is not null")" = t ]; then
	ok "$SIGNATURE existe"
else
	fail "la fonction est ABSENTE de la base"
fi

arguments=$(psql_db -c "select pg_get_function_arguments(to_regprocedure('$SIGNATURE'))")
# `CRM-111` T2.3.4 : le premier paramètre désigne le RATTACHEMENT ; la forme par affaire est supprimée (décision 661).
attendu='p_placement uuid, to_channel_id uuid, to_step_id uuid DEFAULT NULL::uuid, discard_field_values boolean DEFAULT false'
if [ "$arguments" = "$attendu" ]; then
	ok "les paramètres sont ceux du §6.2 — to_step_id, PAS step_mapping (INC-073) — et désignent le rattachement"
else
	fail "signature inattendue : « $arguments »"
fi

retour=$(psql_db -c "select prorettype::regtype from pg_proc where oid=to_regprocedure('$SIGNATURE')")
if [ "$retour" = card_placements ]; then
	ok "elle rend le RATTACHEMENT (card_placements), non l'affaire — docs/SPEC-rattachements.md §5"
else
	fail "type de retour inattendu : « $retour »"
fi

if [ "$(psql_db -c "select prosecdef from pg_proc where oid=to_regprocedure('$SIGNATURE')")" = t ]; then
	ok "SECURITY DEFINER : la fonction écrit ce que son appelant ne peut pas écrire"
else
	fail "la fonction n'est PAS SECURITY DEFINER : elle serait refusée comme son appelant"
fi

chemin=$(psql_db -c "select proconfig::text from pg_proc where oid=to_regprocedure('$SIGNATURE')")
if [ "$chemin" = '{"search_path=\"\""}' ]; then
	ok "search_path vidé : sans lui, un SECURITY DEFINER est une porte ouverte"
else
	fail "search_path inattendu : « $chemin »"
fi

proprietaire=$(psql_db -c "select r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner
	where p.oid=to_regprocedure('$SIGNATURE')")
if [ "$proprietaire" = postgres ]; then
	ok "propriétaire postgres : c'est de LUI que la fonction tient son droit d'écriture"
else
	fail "propriétaire inattendu : « $proprietaire »"
fi

# LE CONTRÔLE QUE LA DÉCISION 80 A RENDU NÉCESSAIRE : l'image pose des ALTER DEFAULT PRIVILEGES qui
# accordent EXECUTE nommément à anon. Un revoke … from public seul les laisserait intacts.
if [ "$(psql_db -c "select has_function_privilege('anon','$SIGNATURE','execute')")" = f ]; then
	ok "anon n'a PAS EXECUTE : le revoke vise public ET anon (décision 80)"
else
	fail "anon peut EXÉCUTER la fonction : le revoke n'a pas visé anon"
fi

for role in authenticated service_role; do
	if [ "$(psql_db -c "select has_function_privilege('$role','$SIGNATURE','execute')")" = t ]; then
		ok "$role a EXECUTE"
	else
		fail "$role n'a PAS EXECUTE : la fonction serait inappelable"
	fi
done

# --- 3. Le vocabulaire et le trigger ------------------------------------------------------------

titre "3. Le vocabulaire actuel, et l'exclusivité de la garde"

contrainte=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
	where conname='card_events_type_check'")
if printf '%s' "$contrainte" | grep -q "'channel_changed'"; then
	ok "le CHECK accepte channel_changed — neuvième valeur, ajoutée dans la MÊME migration"
else
	fail "le CHECK refuse channel_changed : le trigger écrirait un 23514"
fi

# TÉMOINS RETOURNÉS LE 2026-08-17 (décision 51). Ils figeaient l'absence de deux types en
# annonçant que `CRM-054` devrait étendre l'énumération : `mail_received` est arrivé avec `CRM-055`
# et `mail_sent` avec `CRM-058`, et les deux témoins sont passés au rouge exactement comme prévu.
# Ils vérifient désormais la PRÉSENCE, et le garde-fou se déplace sur un type que le produit n'a pas
# encore écrit — il suit le vocabulaire, il ne le devance pas.
for livre in mail_received mail_sent; do
	if printf '%s' "$contrainte" | grep -q "'$livre'"; then
		ok "$livre est ACCEPTÉ : le vocabulaire a suivi la capacité livrée"
	else
		fail "$livre n'est plus accepté : une capacité livrée a disparu du vocabulaire"
	fi
done

if printf '%s' "$contrainte" | grep -q "'mail_bounced'"; then
	fail "mail_bounced est accepté : une capacité inexistante paraîtrait livrée"
else
	ok "mail_bounced reste REFUSÉ : l'unité qui traitera les rejets devra étendre l'énumération"
fi

# La garde `moved` doit être CONDITIONNÉE au channel — décision 215. Depuis CRM-019, cette
# condition est structurelle : `moved` vit dans le dernier `elsif`, après `channel_changed` puis
# `workflow_changed`. Le contrôle lit le corps en base, non le fichier.
#
# RÉVISÉ PAR `CRM-111` T2.3.4 : depuis T2.3.0 (migration 0110), ces événements naissent sur la table du RATTACHEMENT,
# `app.card_placements_write_events` ; le déclencheur de `cards` n'écrit plus que la corbeille. Le contrôle lit le corps
# qui fait autorité.
corps=$(psql_db -c "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
	where n.nspname='app' and p.proname='card_placements_write_events'")
if printf '%s' "$corps" | grep -q "channel_changed"; then
	ok "le déclencheur du rattachement écrit channel_changed : le changement de dossier n'est plus silencieux"
else
	fail "le déclencheur n'écrit AUCUN channel_changed : le fait n° 2 du §6.3 subsisterait"
fi

if printf '%s' "$corps" | grep -q "elsif new.current_step_id is distinct from old.current_step_id"; then
	ok "moved est le dernier elsif : aucun changement de contexte n'écrit une arête fictive"
else
	fail "moved n'est pas exclusif des changements de contexte : une arête fictive pourrait naître"
fi

# --- 4. Ce que cette unité NE ferme PAS, et qui doit rester fermé — décision 214 -----------------
# C'est le seul contrôle du dépôt qui défende un privilège qu'AUCUNE migration ne pose. `CRM-013`
# avait fermé ces colonnes « par voie de conséquence » ; la conséquence n'avait pas été nommée, et
# une migration future pourrait les rouvrir sans que rien ne le dise.

titre "4. Les colonnes fermées d'avance (décision 214)"

for table in cards card_placements; do
	for colonne in channel_id workflow_id current_step_id; do
		if [ "$(psql_db -c "select has_column_privilege('authenticated','public.$table','$colonne','update')")" = f ]; then
			ok "$table.$colonne est FERMÉE à authenticated — la garde était close avant d'exister"
		else
			fail "$table.$colonne est OUVERTE : la RPC deviendrait une commodité facultative"
		fi
	done
done

ouvertes=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='cards'
	  and grantee='authenticated' and privilege_type='UPDATE'")
# ONZE DEPUIS LE 2026-08-14 : `snoozed_until` est sortie de l'énumération de `CRM-013`, `CRM-081`
# ayant livré `endormir_card` / `reveiller_card` comme seul chemin d'écriture du sommeil. Ce
# contrôle a dénoncé la fermeture dès qu'elle a eu lieu — c'est ce qu'on lui demande —, et il est
# révisé dans le même changement que la preuve qu'il compte.
#
# QUATRE DEPUIS `CRM-111` T2.3.2 (migration 0112) : les sept colonnes de rattachement s'écrivent sur `card_placements`.
# Révisé par T2.3.4, comme `0019` n° 52 et `verify-colonnes-protegees.sh` l'ont été par T2.3.2 (décision 51).
if [ "$ouvertes" = 4 ]; then
	ok "QUATRE colonnes ouvertes sur l'affaire, et pas une de plus : CRM-013, moins le sommeil et le rattachement"
else
	fail "$ouvertes colonnes ouvertes au lieu de 4 : une migration a élargi ou rétréci le privilège"
fi

if [ "$(psql_db -c "select has_column_privilege('service_role','public.cards','channel_id','update')")" = t ]; then
	ok "service_role conserve l'écriture — limite nommée, et le trigger la rend VISIBLE (§6.8)"
else
	fail "service_role a perdu l'écriture : le seed en dépend"
fi

# --- 5. Le seed, et sa convergence --------------------------------------------------------------

titre "5. Le seed"

evenements=$(psql_db -c "select count(*) from public.card_events
	where card_id='$CARD_SEED' and type='channel_changed'")
if [ "$evenements" -ge 2 ]; then
	ok "l'aller-retour du seed a produit au moins 2 channel_changed (borne inférieure, décision 210)"
else
	fail "$evenements channel_changed sur la card du seed : l'aller-retour n'a pas eu lieu"
fi

acteurs=$(psql_db -c "select count(*) from public.card_events
	where type='channel_changed' and actor_id is not null")
if [ "$acteurs" -ge 2 ]; then
	ok "les événements du seed portent un ACTEUR : jeton réel, non clé de service"
else
	fail "aucun acteur nommé : le seed n'a pas employé le jeton de l'administratrice"
fi

# LE CONTRÔLE D'INC-046, RÉVISÉ PAR `CRM-046` COMME IL AVAIT RÉVISÉ LES ASSERTIONS DE CETTE UNITÉ —
# mécanisme de la décision 51, et le garde-fou TOURNE au lieu de disparaître.
#
# `CRM-045` figeait ici « `prospection` est VIDE au repos » : c'était la conséquence mesurée
# d'INC-046, le seed y repointant le workflow deux fois par exécution. `CRM-046` a cessé ces
# écritures — convergence par état — et y a posé DEUX cards sur le workflow DÉRIVÉ.
#
# Le PATCH direct reste refusé après CRM-019 : la nouvelle RPC ferme INC-046 sans relâcher la clé.
# Une assertion de refus prouve cette protection ; une assertion de vide ne prouvait que l'absence
# d'occasion de l'enfreindre.
cards_prospection=$(psql_db -c "select count(*) from public.card_placements
	where channel_id='$CHANNEL_PROSPECTION'")
if [ "$cards_prospection" = 2 ]; then
	ok "prospection porte ses DEUX cards dérivées depuis CRM-046 (docs/SPEC-seed.md §9.3)"
else
	fail "$cards_prospection card(s) dans prospection au lieu de 2"
fi

derive=$(psql_db -c "select count(*) from public.cards c join public.card_placements cp on cp.card_id = c.id
	join public.channels ch on ch.id = cp.channel_id
	where cp.channel_id='$CHANNEL_PROSPECTION'
	  and cp.workflow_id = ch.workflow_id
	  and cp.workflow_id <> '5eed0000-0000-4000-8000-000000000051'")
if [ "$derive" = 2 ]; then
	ok "elles suivent la COPIE de portée track, jamais le workflow global — lecture n° 1 d'INC-046"
else
	fail "$derive card(s) sur le workflow dérivé au lieu de 2"
fi

# LE REFUS QUI PORTE DÉSORMAIS INC-046, MESURÉ PLUTÔT QUE DÉDUIT : repointer le workflow d'un
# channel peuplé est refusé par la clé composite, en 23503.
if psql_db -c "update public.channels set workflow_id='5eed0000-0000-4000-8000-000000000051'
	where id='$CHANNEL_PROSPECTION'" >/dev/null 2>&1; then
	fail "le workflow d'un channel PEUPLÉ a pu être repointé sans la RPC de CRM-019"
	psql_db -c "update public.channels set workflow_id=(select workflow_id from public.workflows
		where scope='track' limit 1) where id='$CHANNEL_PROSPECTION'" >/dev/null 2>&1 || true
else
	ok "le PATCH direct d'un channel PEUPLÉ reste REFUSÉ ; CRM-019 exige son mapping"
fi

etat=$(psql_db -c "select channel_id||'|'||workflow_id from public.card_placements where card_id='$CARD_SEED'")
if [ "$etat" = '5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000051' ]; then
	ok "la card du seed est rendue à son channel ET à son workflow : l'aller-retour CONVERGE"
else
	fail "état inattendu de la card du seed : « $etat »"
fi

# --- 6. Les suites ------------------------------------------------------------------------------

titre "6. Les suites de preuves"

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
	ok "la suite pgTAP dédiée est verte"
else
	fail "la suite pgTAP dédiée ÉCHOUE : voir $TRAVAIL/pgtap.log"
fi

if [ "$RAPIDE" = false ]; then
	if npm run test:sql >"$TRAVAIL/pgtap-global.log" 2>&1; then
		ok "la suite pgTAP GLOBALE est verte — aucune régression sur les unités précédentes"
	else
		fail "la suite pgTAP globale ÉCHOUE : voir $TRAVAIL/pgtap-global.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=api \
		move-card-to-channel >"$TRAVAIL/api.log" 2>&1; then
		ok "la preuve d'API dédiée est verte"
	else
		fail "la preuve d'API dédiée ÉCHOUE : voir $TRAVAIL/api.log"
	fi

	# ELLE NETTOIE DERRIÈRE ELLE, ET C'EST CONSTATÉ : INC-061 est née d'un jeu d'essai laissé en
	# place par un harnais qui se mesurait lui-même.
	essais=$(psql_db -c "select count(*) from public.cards where id::text like 'f00d%'")
	if [ "$essais" = 0 ]; then
		ok "la preuve d'API a nettoyé ses cards d'essai (INC-061 en sens inverse)"
	else
		fail "$essais card(s) d'essai laissée(s) en base par la preuve d'API"
	fi

	# ET ELLE NE PERTURBE PAS L'ÉTAT SEEDÉ — la leçon d'un garde-fou de CRM-034 déclenché pendant
	# cette unité : `position` n'est jamais rendue par un aller-retour (§6.5), donc aucune preuve
	# ne doit déplacer une card du seed sans la recréer elle-même.
	rangs=$(psql_db -c "select string_agg(position::text, ',' order by position)
		from public.card_placements where current_step_id='5eed0000-0000-4000-8000-000000000062'
		  and channel_id='5eed0000-0000-4000-8000-000000000032'")
	if [ "$rangs" = '1,2' ]; then
		ok "les rangs du seed sont intacts : aucune preuve n'a déplacé une card seedée"
	else
		fail "rangs altérés dans (grands-comptes, relance) : « $rangs » au lieu de « 1,2 »"
	fi
else
	printf '  \033[33mIGNORÉ\033[0m suites globales et Playwright (--rapide)\n'
fi

# --- 7. Non-complaisance ------------------------------------------------------------------------
# Un harnais qui ne peut pas échouer ne prouve rien. Chaque dégradation porte sur une règle que la
# spécification énonce, et le contrôle qui devrait la voir est rejoué.

titre "7. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

degrader_et_verifier() {
	local libelle=$1 sql=$2 restauration=$3
	psql_db -c "$sql" >/dev/null 2>&1 || true
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/degradation.log" 2>&1; then
		fail "DÉGRADATION NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	psql_db -c "$restauration" >/dev/null 2>&1 || true
}

degrader_et_verifier \
	"EXECUTE rendu à anon — la fonction serait appelable sans jeton" \
	"grant execute on function $SIGNATURE to anon" \
	"revoke execute on function $SIGNATURE from anon"

degrader_et_verifier \
	"channel_id rendue à authenticated — la garde deviendrait facultative (décision 214)" \
	"grant update (channel_id) on public.cards to authenticated" \
	"revoke update (channel_id) on public.cards from authenticated"

# LE `NOT VALID` N'EST PAS UNE COMMODITÉ, ET IL DIT QUELQUE CHOSE DU PRODUIT. La dégradation
# naïve — rétrécir le CHECK à huit valeurs — ÉCHOUE : le seed a produit deux `channel_changed`, et
# PostgreSQL refuse une contrainte que les lignes présentes violent. MESURÉ, et c'est le premier
# cas où l'histoire déjà écrite défend le vocabulaire mieux que le harnais ne saurait le faire.
# `NOT VALID` contourne ce refus et permet d'éprouver réellement le contrôle.
degrader_et_verifier \
	"le CHECK ramené à huit valeurs — l'événement ne pourrait plus naître" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	   check (type = any (array['created','moved','assigned','archived','unarchived','trashed',
	                            'restored','field_changed'])) not valid" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	   check (type = any (array['created','moved','assigned','channel_changed','workflow_changed','archived',
	                            'unarchived','trashed','restored','field_changed']))"

# LA DÉGRADATION LA PLUS FINE DU HARNAIS : la garde `moved` désinhibée. Le produit continue de
# fonctionner, l'événement continue de naître — et un `moved` parasite affirme qu'une arête a été
# franchie. Seule l'assertion « AUCUN moved » de la suite le voit.
#
# RÉÉCRITE PAR `CRM-111` T2.3.4 (docs/SPEC-test-harness.md §3.7) : elle remplaçait le déclencheur de `cards`, qui
# n'écrit plus ces événements depuis T2.3.0 — la dégradation ne dégradait plus rien. Elle porte désormais sur le
# déclencheur du rattachement, depuis sa définition EN BASE : le dernier `elsif` devient un `if` indépendant.
degrader_fonction_et_verifier() {
	local libelle=$1 signature=$2 avant=$3 apres=$4
	if ! degradation_fonction "$signature" "$avant" "$apres"; then
		fail "dégradation NON CONCLUANTE (fragment introuvable ou définition refusée) : $libelle"
		return
	fi
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/degradation.log" 2>&1; then
		fail "DÉGRADATION NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	degradations_restaurer
}

degrader_fonction_et_verifier \
	"la garde moved désinhibée — un moved parasite affirmerait une arête inexistante" \
	'app.card_placements_write_events()' \
	'elsif new.current_step_id is distinct from old.current_step_id then' \
	'end if; if new.current_step_id is distinct from old.current_step_id then'

# LA VÉRIFICATION N° 8 RETIRÉE : les réponses seraient détruites SANS que l'appelant l'ait dit. Réécrite par T2.3.4 :
# elle renommait la fonction, ce qui ne prouvait que son absence ; elle retire désormais le refus lui-même.
degrader_fonction_et_verifier \
	"discard_field_values ignoré — les réponses seraient détruites en silence (décision 216)" \
	"$SIGNATURE" \
	'if v_valeurs > 0 and not coalesce(discard_field_values, false) then' \
	'if false then'

# `CRM-111` T2.3.4 : la garde nouvelle retirée — la contrainte `card_placements_card_channel_key` parlerait seule, en
# 23505, au lieu du refus nommé (décision 731).
degrader_fonction_et_verifier \
	"already_attached retirée — le 23505 d'une contrainte au lieu du refus nommé" \
	"$SIGNATURE" \
	"raise exception 'already_attached';" \
	'null;'

# --- 8. Restauration ----------------------------------------------------------------------------
# La restauration est CONSTATÉE, pas supposée : la fonction est relue en base, la base reconstruite, les fichiers relus.

titre "8. Restauration"

# `CRM-111` T2.3.4 (docs/SPEC-test-harness.md §3.7) : la restauration NE REJOUE PLUS les migrations 17 et 20. La 17
# rejouée supprimerait la fonction par rattachement — même types d'arguments — pour remettre la forme par affaire ; la
# 20 redéfinirait des fonctions que des migrations postérieures ont remplacées. Les définitions dégradées sont
# réappliquées depuis la base (`degradations_restaurer`, déjà fait après chaque dégradation), et le vocabulaire réduit —
# une structure — se répare par la reconstruction qui suit.
if [ "$(psql_db -c "select pg_get_function_arguments(to_regprocedure('$SIGNATURE'))")" = "$attendu" ]; then
	ok "les dégradations de fonction sont restaurées depuis la base : la forme par rattachement est en place"
else
	fail "la fonction n'est pas revenue à sa définition par rattachement"
fi

# INC-144 — assertion RÉVISÉE, et non retirée. Elle affirmait que rejouer 17 puis 20 suffisait à
# restaurer le vocabulaire. Ce n'est plus vrai, et pour une raison légitime : ces deux migrations
# ne posent plus leur liste lorsque les lignes emploient déjà un vocabulaire plus large — sans quoi
# le rejeu échouerait sur « is violated by some row » et la pile ne redémarrerait plus. Le
# vocabulaire appartient désormais à la DERNIÈRE migration qui l'étend, aujourd'hui la 44. La
# restauration rejoue donc TOUT le répertoire, comme le fait le `migrations-runner` au démarrage —
# c'est la correction déjà appliquée à verify-colonnes-protegees.sh, pour le même motif.
	# APPEL NU CORRIGÉ LE 2026-08-21 — décision 497, cas EXACT de la décision 471 que
	# `docs/CloudWorker.md` §2.2 bis documente comme coûteux. La pile de développement est composée
	# de DEUX fichiers ; `docker compose up` NU n'en voit qu'un et **recrée avec la configuration de
	# base les conteneurs qu'il touche**. MESURÉ ce jour : ce rejeu a recréé `storage` et `db`, et
	# `storage` a perdu `AWS_ACCESS_KEY_ID: ${MINIO_ROOT_USER}` que seul le fichier `dev` pose —
	# MinIO a dès lors refusé ses identifiants (`InvalidAccessKeyId`), et la preuve n° 9 de
	# `scripts/verify-preuves-refus.sh` est devenue rouge sans aucun rapport avec les pièces
	# jointes. Le diagnostic est sans ambiguïté : les conteneurs recréés nus ne citent qu'UN fichier
	# dans `com.docker.compose.project.config_files`.
#
# RÉVISÉ PAR `CRM-111` T1 bis (décision 682, INC-289) : ce contrôle prouvait que le répertoire entier se rejoue
# sur une base PEUPLÉE (INC-144). Ce n'est plus un invariant (décision 675) — c'est rouge depuis `0099`,
# mesuré. La restauration RECONSTRUIT la base de développement (`scripts/lib/reconstruction.sh`,
# docs/SPEC-test-harness.md §3.6) ; la double garde d'INC-144 reste exigée de chaque migration, statiquement,
# par `scripts/verify-migrations.sh` §7, et l'idempotence de chaque fichier sur son propre état par son §2.
if reconstruire_base_dev >"$TRAVAIL/rejeu_complet.log" 2>&1; then
	ok "la reconstruction efface le vocabulaire réduit : base neuve construite dans l'ordre, seedée"
else
	fail "la reconstruction de la base ÉCHOUE : $(tail -n 1 "$TRAVAIL/rejeu_complet.log")"
fi

# Le vocabulaire restauré est le COMPLET, celui de la dernière migration qui l'étend — pas les neuf
# valeurs de CRM-045 ni les dix de CRM-019. Sans ce contrôle, une restauration partielle laisserait
# la base amputée de `snoozed` et `woken` sans que rien ne le signale.
vocabulaire_restaure=$(psql_db -tAc "select pg_get_constraintdef(oid) from pg_constraint
	where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check'")
manquants=""
for type_attendu in created moved assigned channel_changed workflow_changed archived unarchived \
	trashed restored field_changed mail_received mail_sent snoozed woken; do
	case "$vocabulaire_restaure" in *"'$type_attendu'"*) ;; *) manquants="$manquants $type_attendu" ;; esac
done
if [ -z "$manquants" ]; then
	ok "le vocabulaire restauré est COMPLET : les quatorze types, sommeil et courrier compris"
else
	fail "le vocabulaire restauré est amputé de :$manquants"
fi

for fichier in "$MIGRATION" "$MIGRATION_RATTACHEMENT" "$TEST_SQL"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu INTACT"
	else
		fail "$(basename "$fichier") a été modifié par le harnais"
	fi
done

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/apres.log" 2>&1; then
	ok "la suite pgTAP redevient verte après restauration"
else
	fail "la suite pgTAP reste rouge après restauration : voir $TRAVAIL/apres.log"
fi

# --- Bilan --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
