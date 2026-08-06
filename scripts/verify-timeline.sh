#!/usr/bin/env bash
# @verifies CRM-044 (docs/BACKLOG.md) — Definition of Done de la timeline unifiée
# @verifies docs/SPEC-cards.md §14.2 (modèle), §14.3 (`clock_timestamp()`), §14.4 (les huit
#           types), §14.5 (triggers), §14.7 (AUCUNE écriture cliente), §14.8 (immuabilité),
#           §14.9 (contrat d'API), §14.11 (seed), §14.14 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 8, satisfaisable pour moitié)
# @verifies docs/SPEC-seed.md §2.15 (événements du seed, convergence)
# @verifies docs/JOURNAL.md décisions 203 à 210
# @verifies CLAUDE.md §8 (aucune trace fabriquée), §10 (règles prouvées hors interface)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-044`, POUR CE QUI EST LIVRÉ :
#
#   1. les fichiers livrés portent leur traçabilité `@spec` / `@verifies` ;
#   2. la suite pgTAP dédiée est verte, et la suite globale avec elle ;
#   3. la preuve d'API dédiée est verte, et elle NETTOIE derrière elle — ce qui est constaté ;
#   4. le schéma réellement en base porte ce que la spécification annonce : une seule politique,
#      AUCUN privilège d'écriture pour aucun des trois rôles, les cinq triggers, le défaut
#      `clock_timestamp()`, le `CHECK` des huit types ;
#   5. le seed porte ses événements, et il CONVERGE — le rejeu n'allonge pas le fil ;
#   6. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Le compte exact de 27 événements ne vaut qu'IMMÉDIATEMENT APRÈS l'application du seed sur une
# base neuve (décision 210) : une timeline enregistre tout, y compris ce que les autres preuves du
# dépôt font à la même pile. Le contrôle correspondant est donc écrit comme une BORNE INFÉRIEURE,
# et le seul compte exact asséré est celui des neuf naissances — une card ne naît qu'une fois.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-timeline.sh
#   scripts/verify-timeline.sh --rapide   n'exécute ni Playwright ni les suites globales

set -euo pipefail

cd "$(dirname "$0")/.."

MIGRATION=supabase/migrations/0016_timeline.sql
# LA MIGRATION 17 FAIT PARTIE DE LA SÉQUENCE DE RESTAURATION, ET CE N'EST PAS UN AJOUT DE PÉRIMÈTRE
# — même mécanisme que `scripts/verify-cards.sh`, qui reprend la migration 14 depuis `CRM-013`.
# `CRM-045` étend `app.card_events_apres_maj_card()` d'une CINQUIÈME garde. Rejouer la seule
# migration 16 la remplace par sa forme à quatre gardes et laisse la base dans un état que plus
# aucune unité ne décrit : MESURÉ, neuf assertions de
# `supabase/tests/0019_move_card_to_channel.test.sql` en devenaient rouges, longtemps après que ce
# harnais eut rendu la main. C'est la parente d'INC-074 : un fichier qui n'est plus la dernière
# autorité sur un objet ne peut pas, seul, le restaurer.
MIGRATION_SUIVANTE=supabase/migrations/0017_move_card_to_channel.sql
TEST_SQL=supabase/tests/0018_timeline.test.sql
SPEC_API=e2e/api/timeline.spec.ts
MODULE=webapp/src/lib/timeline.ts
COMPOSANT=webapp/src/app/PanneauTimeline.tsx
TEST_UNITAIRE=webapp/src/lib/timeline.test.ts
TEST_COMPOSANT=webapp/src/app/PanneauTimeline.test.tsx
SPEC_UI=e2e/ui/timeline.spec.ts
CAPTURES=docs/captures/CRM-044
SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,36p' "$0"; exit 0 ;;
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
nettoyer() { rm -rf "$TRAVAIL" "$DEPART"; }
trap nettoyer EXIT

# État des fichiers à l'entrée du harnais, et non l'état de `HEAD` : un contrôle qui comparerait au
# dernier commit ne pourrait pas être vert pendant qu'on travaille (décision 166).
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MIGRATION" "$TEST_SQL"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$MODULE" "$COMPOSANT" "$TEST_UNITAIRE" \
	"$TEST_COMPOSANT" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MODULE" "$COMPOSANT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-044'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-044'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. Le schéma réellement en base"

if [ "$(psql_db -c "select to_regclass('public.card_events') is not null")" = t ]; then
	ok "public.card_events existe"
else
	fail "public.card_events est ABSENTE"
fi

politiques=$(psql_db -c "select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname='public' and tablename='card_events'")
if [ "$politiques" = 'card_events_lecture' ]; then
	ok "UNE politique, et une seule : la lecture. Écrire n'est ouvert à personne (§14.7)"
else
	fail "politiques inattendues sur card_events : « $politiques »"
fi

if [ "$(psql_db -c "select relrowsecurity from pg_class where oid='public.card_events'::regclass")" = t ]; then
	ok "la RLS est activée — sans elle, l'inventaire des politiques serait rassurant sur une table ouverte"
else
	fail "la RLS n'est PAS activée sur card_events"
fi

# LE CONTRÔLE CENTRAL DE L'UNITÉ : `service_role` est nommé au même titre que les deux autres.
for role in anon authenticated service_role; do
	ecritures=$(psql_db -c "select string_agg(privilege_type, ',' order by privilege_type)
		from information_schema.role_table_grants
		where table_schema='public' and table_name='card_events'
		  and grantee='$role' and privilege_type <> 'SELECT'")
	if [ -z "$ecritures" ]; then
		ok "$role n'a AUCUN privilège d'écriture sur card_events"
	else
		fail "$role détient « $ecritures » sur card_events : le seed pourrait forger une trace"
	fi
done

for role in anon authenticated service_role; do
	if [ "$(psql_db -c "select has_table_privilege('$role','public.card_events','SELECT')")" = t ]; then
		ok "$role a SELECT : le refus de lecture doit être ZÉRO LIGNE, non une erreur de privilège"
	else
		fail "$role n'a pas SELECT sur card_events"
	fi
done

defaut=$(psql_db -c "select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
	join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
	where d.adrelid = 'public.card_events'::regclass and a.attname = 'created_at'")
if [ "$defaut" = 'clock_timestamp()' ]; then
	ok "created_at a pour défaut clock_timestamp() et non now() (§14.3, décision 204)"
else
	fail "created_at a pour défaut « $defaut » : l'ordre du fil cesserait d'être signifiant"
fi

for trigger in card_events_apres_insertion card_events_apres_maj; do
	if [ "$(psql_db -c "select count(*) from pg_trigger where tgrelid='public.cards'::regclass and tgname='$trigger'")" = 1 ]; then
		ok "le trigger $trigger est posé sur cards"
	else
		fail "le trigger $trigger est ABSENT de cards"
	fi
done

if [ "$(psql_db -c "select count(*) from pg_trigger where tgrelid='public.card_field_values'::regclass and tgname='card_events_apres_ecriture_valeur'")" = 1 ]; then
	ok "le trigger de valeurs de formulaire est posé"
else
	fail "le trigger card_events_apres_ecriture_valeur est ABSENT"
fi

if [ "$(psql_db -c "select count(*) from pg_trigger where tgrelid='public.card_events'::regclass and tgname='card_events_refuser_maj'")" = 1 ]; then
	ok "le trigger d'immuabilité est posé — il ferme la porte que les privilèges laissent ouverte"
else
	fail "le trigger d'immuabilité est ABSENT : la clé de service pourrait réécrire l'histoire"
fi

secdef=$(psql_db -c "select count(*) from pg_proc where pronamespace='app'::regnamespace
	and proname in ('card_event_ecrire','card_events_apres_insertion_card',
	                'card_events_apres_maj_card','card_events_apres_ecriture_valeur')
	and prosecdef and coalesce(proconfig, '{}') @> array['search_path=\"\"']")
if [ "$secdef" = 4 ]; then
	ok "les quatre fonctions d'alimentation sont SECURITY DEFINER, search_path VIDÉ"
else
	fail "seules $secdef fonctions sur 4 sont SECURITY DEFINER à search_path vidé"
fi

if [ "$(psql_db -c "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='card_events'")" = 0 ]; then
	ok "card_events n'est PAS publiée au temps réel : le fil se relit à l'ouverture (§14.1)"
else
	fail "card_events est publiée : une surface d'abonnement qu'aucune preuve n'exerce"
fi

# --- 3. Le refus, MESURÉ hors interface ---------------------------------------------------------
# Le catalogue dit ce qui est accordé ; seule une écriture réelle dit ce qui est refusé.

titre "3. Le refus, éprouvé plutôt que déduit"

for role in authenticated service_role; do
	sortie=$(psql_db -c "begin; set local role $role;
		insert into public.card_events (card_id, workspace_id, type)
		select id, workspace_id, 'created' from public.cards limit 1; rollback;" 2>&1 || true)
	if printf '%s' "$sortie" | grep -q 'permission denied for table card_events'; then
		ok "$role est réellement REFUSÉ à l'insertion"
	else
		fail "$role n'a pas été refusé : « $(printf '%s' "$sortie" | head -1) »"
	fi
done

sortie=$(psql_db -c "begin; update public.card_events set payload='{}'::jsonb
	where id = (select id from public.card_events limit 1); rollback;" 2>&1 || true)
if printf '%s' "$sortie" | grep -q 'card_event_immutable'; then
	ok "le PROPRIÉTAIRE lui-même est refusé en mise à jour : le journal ne se réécrit pas"
else
	fail "une mise à jour est passée : « $(printf '%s' "$sortie" | head -1) »"
fi

# --- 4. Le seed, et sa convergence --------------------------------------------------------------

titre "4. Le seed"

CARDS_SEED="'5eed0000-0000-4000-8000-0000000000c1','5eed0000-0000-4000-8000-0000000000c2',
'5eed0000-0000-4000-8000-0000000000c3','5eed0000-0000-4000-8000-0000000000c4',
'5eed0000-0000-4000-8000-0000000000c5','5eed0000-0000-4000-8000-0000000000c6',
'5eed0000-0000-4000-8000-0000000000c7','5eed0000-0000-4000-8000-0000000000c8',
'5eed0000-0000-4000-8000-0000000000c9'"

naissances=$(psql_db -c "select count(*) from public.card_events where type='created' and card_id in ($CARDS_SEED)")
if [ "$naissances" = 9 ]; then
	ok "NEUF naissances, une par card du seed — le seul compte exact qui tienne (décision 210)"
else
	fail "le seed ne porte pas neuf événements « created » mais $naissances"
fi

if [ "$(psql_db -c "select count(*) from public.card_events where type='created' and actor_id is not null and card_id in ($CARDS_SEED)")" = 0 ]; then
	ok "aucune naissance ne porte d'acteur : la clé de service n'a pas de revendication « sub »"
else
	fail "une naissance du seed porte un acteur : le seed n'aurait pas été appliqué par le service"
fi

for couple in "moved:2" "assigned:2" "field_changed:14"; do
	type=${couple%%:*}; borne=${couple##*:}
	compte=$(psql_db -c "select count(*) from public.card_events where type='$type' and card_id in ($CARDS_SEED)")
	if [ "$compte" -ge "$borne" ]; then
		ok "au moins $borne événements « $type » ($compte mesurés) — borne inférieure, décision 210"
	else
		fail "seulement $compte événements « $type », attendu au moins $borne"
	fi
done

if [ "$(psql_db -c "select count(*) from public.card_events where actor_id='5eed0000-0000-4000-8000-000000000011' and card_id in ($CARDS_SEED)")" -ge 4 ]; then
	ok "au moins quatre événements portent un acteur RÉEL : les allers-retours du seed"
else
	fail "les allers-retours du seed ne portent plus d'acteur réel"
fi

# L'ÉTAT DU SEED EST INCHANGÉ PAR LES ALLERS-RETOURS. Sans ce contrôle, la démonstration de la
# timeline se paierait d'une dérive silencieuse des autres unités.
etat=$(psql_db -c "select (select current_step_id from public.cards where id='5eed0000-0000-4000-8000-0000000000c4')
	|| ':' || (select owner_id from public.cards where id='5eed0000-0000-4000-8000-0000000000c1')")
if [ "$etat" = '5eed0000-0000-4000-8000-000000000063:5eed0000-0000-4000-8000-000000000012' ]; then
	ok "les allers-retours n'ont laissé AUCUNE trace d'état : c4 en négociation, c1 à Driss Lemoine"
else
	fail "l'état du seed a dérivé : « $etat »"
fi

if [ "$RAPIDE" = false ]; then
	avant=$(psql_db -c "select count(*) from public.card_events")
	if "$SEED" >"$TRAVAIL/seed.log" 2>&1; then
		ok "le seed se rejoue sans erreur"
	else
		fail "le rejeu du seed ÉCHOUE : voir $TRAVAIL/seed.log"
	fi
	apres=$(psql_db -c "select count(*) from public.card_events")
	if [ "$avant" = "$apres" ]; then
		ok "le rejeu du seed n'allonge PAS le fil : les deux allers-retours sont conditionnés (§2.15)"
	else
		fail "le rejeu a ajouté $((apres - avant)) événements : le seed ne converge plus"
	fi
fi

# --- 5. Les suites ------------------------------------------------------------------------------

titre "5. Suites de preuves"

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
	ok "la suite pgTAP dédiée est verte"
else
	fail "la suite pgTAP dédiée ÉCHOUE : voir $TRAVAIL/pgtap.log"
fi

if [ "$RAPIDE" = false ]; then
	if npm run test:sql >"$TRAVAIL/pgtap-global.log" 2>&1; then
		ok "la suite pgTAP GLOBALE est verte — aucune régression sur les unités antérieures"
	else
		fail "la suite pgTAP globale ÉCHOUE : voir $TRAVAIL/pgtap-global.log"
	fi

	if npm run e2e:api >"$TRAVAIL/api.log" 2>&1; then
		ok "la suite d'API GLOBALE est verte"
	else
		fail "la suite d'API ÉCHOUE : voir $TRAVAIL/api.log"
	fi

	# INC-061 : un jeu d'essai laissé en base fait tomber les preuves des autres unités. Le
	# nettoyage est CONSTATÉ par une relecture, non supposé.
	restes=$(psql_db -c "select count(*) from public.cards where id::text like 'f00d%'")
	if [ "$restes" = 0 ]; then
		ok "la preuve d'API a NETTOYÉ derrière elle : aucune card d'essai en base (INC-061)"
	else
		fail "$restes cards d'essai « f00d… » subsistent en base"
	fi

	if npm run typecheck >"$TRAVAIL/typecheck.log" 2>&1; then
		ok "npm run typecheck est vert — les types générés portent card_events"
	else
		fail "npm run typecheck ÉCHOUE : voir $TRAVAIL/typecheck.log"
	fi

	if npm run test:unit >"$TRAVAIL/unit.log" 2>&1; then
		ok "les tests unitaires sont verts"
	else
		fail "les tests unitaires ÉCHOUENT : voir $TRAVAIL/unit.log"
	fi

	if npm run build >"$TRAVAIL/build.log" 2>&1; then
		ok "npm run build est vert"
	else
		fail "npm run build ÉCHOUE : voir $TRAVAIL/build.log"
	fi

	if npm run e2e:ui >"$TRAVAIL/ui.log" 2>&1; then
		ok "la preuve d'interface est verte, contre le BUILD DE PRODUCTION"
	else
		fail "la preuve d'interface ÉCHOUE : voir $TRAVAIL/ui.log"
	fi
fi

# --- 5 bis. L'écran, et ce que les captures ont dénoncé ------------------------------------------
# `CLAUDE.md` §16 : les tests automatisés ne remplacent pas l'observation. Quatre défauts ont été
# trouvés en REGARDANT alors que les 127 scénarios étaient verts (décision 212) ; les trois
# contrôles ci-dessous figent ce qui les a causés.

titre "5 bis. L'écran"

# LES CONTRÔLES CI-DESSOUS LISENT LE CODE, PAS LES COMMENTAIRES. Écrits d'abord sur le fichier
# entier, ils échouaient sur leurs propres explications — chaque défaut de la décision 212 est
# nommé dans un commentaire du composant, `size-7` et `overflow-x-auto` compris. Un harnais qui
# accuse la prose qu'il a lui-même demandé d'écrire est un harnais faux.
code_seul() { sed -e 's;//.*;;' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*{\/\*/,/\*\/}/d' "$1"; }

for capture in fil-unifie-1440 fil-filtre-1440 fil-tout-filtre-1440 fil-vide-1440 \
	fil-xl-1440 fil-lg-1152 fil-md-900 fil-sm-390; do
	if [ -s "$CAPTURES/$capture.jpg" ]; then
		ok "capture $capture.jpg produite"
	else
		fail "capture $capture.jpg ABSENTE — CLAUDE.md §16"
	fi
done

# DÉFAUT 1 et 2 de la décision 212 : une classe hors de l'échelle discrète du §3 du design system
# ne produit AUCUNE règle CSS, et n'échoue jamais bruyamment.
if code_seul "$COMPOSANT" | grep -qE "gap-1\.5|size-7[^0-9]"; then
	fail "le composant emploie une classe hors échelle (gap-1.5, size-7) : elle serait IGNORÉE"
else
	ok "aucune classe hors de l'échelle discrète du §3 (décision 212)"
fi

# DÉFAUT 3 : la barre se replie, elle ne défile pas — une option hors cadre est une option cachée.
if code_seul "$COMPOSANT" | grep -q "overflow-x-auto"; then
	fail "la barre de filtres défile : « Cycle de vie » sortirait du panneau (décision 212)"
else
	ok "la barre de filtres se replie plutôt que de défiler"
fi

# Séparation : le composant ne porte AUCUNE règle. L'ordre, les familles et la résolution des
# libellés vivent dans le module, vérifiables sans navigateur.
if code_seul "$COMPOSANT" | grep -qE "\.sort\(|familleDe[[:space:]]*="; then
	fail "le composant trie ou classe : ces règles appartiennent à $MODULE"
else
	ok "le composant ne trie ni ne classe : les règles vivent dans $MODULE"
fi

if { code_seul "$COMPOSANT"; code_seul "$MODULE"; } | grep -qE "localStorage|sessionStorage"; then
	fail "une persistance côté client est apparue (CLAUDE.md §11)"
else
	ok "aucune persistance côté client (CLAUDE.md §11)"
fi

# --- 6. Non-complaisance -------------------------------------------------------------------------
# Un harnais qui ne peut pas échouer ne prouve rien. Chaque dégradation porte sur une règle que la
# spécification énonce, et le contrôle qui devrait la voir est rejoué.

titre "6. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

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
	"le privilège INSERT rendu à authenticated — n'importe qui pourrait forger une trace" \
	"grant insert on public.card_events to authenticated" \
	"revoke insert on public.card_events from authenticated"

degrader_et_verifier \
	"le privilège INSERT rendu à service_role — le seed pourrait fabriquer une histoire" \
	"grant insert on public.card_events to service_role" \
	"revoke insert on public.card_events from service_role"

degrader_et_verifier \
	"le trigger d'immuabilité retiré — le journal deviendrait réécrivable" \
	"drop trigger card_events_refuser_maj on public.card_events" \
	"create trigger card_events_refuser_maj before update on public.card_events
	   for each row execute function app.card_events_refuser_maj()"

# RÉVISÉ PAR `CRM-045` (mécanisme de la décision 51, et cette dégradation était de celles qui
# CESSENT DE MORDRE plutôt que de devenir rouges — la forme la plus discrète). Les deux listes
# ci-dessous omettaient `channel_changed`, neuvième valeur livrée par la migration 17. Le seed
# écrivant désormais deux événements de ce type, PostgreSQL refusait la contrainte dégradée comme
# la contrainte restaurée — MESURÉ, « is violated by some row » —, l'`ALTER` échouait en silence
# derrière son `|| true`, et le harnais rendait « DÉGRADATION NON VUE » sans que rien du produit
# n'ait changé. Les deux listes portent désormais les neuf valeurs, et la dégradation redevient
# l'ajout de `mail_received` — ce qu'elle a toujours prétendu être.
degrader_et_verifier \
	"le CHECK élargi à mail_received — une capacité inexistante paraîtrait livrée" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	   check (type = any (array['created','moved','assigned','channel_changed','archived',
	                            'unarchived','trashed','restored','field_changed',
	                            'mail_received']))" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	   check (type = any (array['created','moved','assigned','channel_changed','archived',
	                            'unarchived','trashed','restored','field_changed']))"

degrader_et_verifier \
	"la politique de lecture ouverte à tous — la mémoire d'une affaire fermée serait lisible" \
	"drop policy card_events_lecture on public.card_events;
	 create policy card_events_lecture on public.card_events for select to anon, authenticated
	   using (true)" \
	"drop policy card_events_lecture on public.card_events;
	 create policy card_events_lecture on public.card_events for select to anon, authenticated
	   using (app.can_read_card(card_id))"

degrader_et_verifier \
	"le trigger de mise à jour de cards retiré — un déplacement ne laisserait plus de trace" \
	"drop trigger card_events_apres_maj on public.cards" \
	"create trigger card_events_apres_maj after update on public.cards
	   for each row execute function app.card_events_apres_maj_card()"

# --- 7. Restauration -----------------------------------------------------------------------------
# La restauration est CONSTATÉE, pas supposée : la migration est rejouée, puis les fichiers relus.

titre "7. Restauration"

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
	-f - <"$MIGRATION" >"$TRAVAIL/rejeu.log" 2>&1; then
	ok "la migration se rejoue sans erreur — idempotence et convergence (INC-035)"
else
	fail "le rejeu de la migration ÉCHOUE : voir $TRAVAIL/rejeu.log"
fi

# Puis la 17, qui est la dernière autorité sur `app.card_events_apres_maj_card()` et sur le
# vocabulaire de `card_events` (INC-074, décision 219). Sans elle, la restauration RÉGRESSE.
if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
	-f - <"$MIGRATION_SUIVANTE" >"$TRAVAIL/rejeu17.log" 2>&1; then
	ok "la migration 17 est rejouée avec elle : la restauration ne régresse pas (INC-074)"
else
	fail "le rejeu de la migration 17 ÉCHOUE : voir $TRAVAIL/rejeu17.log"
fi

if [ "$(psql_db -c "select prosrc like '%channel_changed%' from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname='app' and p.proname='card_events_apres_maj_card'")" = t ]; then
	ok "la cinquième garde du trigger est bien rendue — et c'est CONSTATÉ, non supposé"
else
	fail "le trigger est resté dans sa forme à quatre gardes : la restauration a régressé"
fi

for fichier in "$MIGRATION" "$TEST_SQL"; do
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

# --- Bilan ---------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
