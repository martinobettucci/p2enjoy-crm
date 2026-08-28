#!/usr/bin/env bash
# @verifies CRM-082 (docs/BACKLOG.md) — Definition of Done des objectifs : modèle, RLS et API
# @verifies docs/SPEC-goals.md §1 (aucun calcul), §2.1 à §2.4 (objets et contraintes),
#           §4.1 (lecture, et le bloc invisible), §4.2 (écriture, et le lien qui engage)
# @verifies docs/SCHEMA.md §9 bis.1 à §9 bis.3 (colonnes), §9 bis.7 (politiques)
# @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.5 (récursion)
# @verifies docs/JOURNAL.md décision 431 (le tableau est une lavagna, pas une projection)
# @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-082`, POUR CE QUI EST LIVRÉ :
#
#   1. les fichiers livrés portent leur traçabilité `@spec` / `@verifies` ;
#   2. le schéma RÉELLEMENT en base porte ce que la spécification annonce — les trois tables, la
#      RLS, les douze politiques, les quatre fonctions d'appui `SECURITY DEFINER`, les deux
#      triggers, et les contraintes de valeur ;
#   3. la suite pgTAP dédiée est verte ;
#   4. la preuve d'API dédiée est verte, et elle NETTOIE derrière elle — ce qui est constaté ;
#   5. le seed porte son tableau démontrable, et il CONVERGE ;
#   6. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# `CRM-082` ne livre AUCUN ÉCRAN : ni entrée de navigation, ni canevas, ni geste. Le harnais ne
# lance donc aucune preuve d'interface et ne cherche aucune capture — c'est `CRM-083` qui les
# devra. Un contrôle qui les exigerait ici rendrait rouge une unité correctement livrée.
#
# LA RÈGLE LA PLUS IMPORTANTE DE CETTE UNITÉ NE SE PROUVE PAS AU CATALOGUE : `docs/SPEC-goals.md`
# §1 interdit de CALCULER `fill_percent` à partir des cards du channel lié. Aucune requête ne
# distingue une colonne saisie d'une colonne dérivée. Ce que le harnais peut faire, il le fait :
# il vérifie qu'AUCUN trigger d'écriture ne pèse sur `goal_blocks` en dehors de `updated_at`, ce
# qui est la forme sous laquelle un calcul automatique s'introduirait.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-objectifs.sh
#   scripts/verify-objectifs.sh --rapide   n'exécute ni Playwright ni les dégradations

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0049_objectifs.sql
TEST_SQL=supabase/tests/0047_objectifs.test.sql
SPEC_API=e2e/api/objectifs.spec.ts
SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

# Identifiants du seed, stables par contrat (`docs/SPEC-seed.md`).
TABLEAU_SEED='5eed0000-0000-4000-8000-0000000000e1'
BLOC_GRANDS_COMPTES='5eed0000-0000-4000-8000-0000000000e3'

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,38p' "$0"; exit 0 ;;
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
nettoyer() { rm -rf "$TRAVAIL"; }
trap nettoyer EXIT

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

if head -3 "$MIGRATION" | grep -q '@spec CRM-082'; then
	ok "$(basename "$MIGRATION") porte son commentaire @spec"
else
	fail "$(basename "$MIGRATION") ne cite pas son unité de backlog"
fi

for fichier in "$TEST_SQL" "$SPEC_API"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-082'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. Le schéma réellement en base"

for table in goal_boards goal_blocks goal_links; do
	if [ "$(psql_db -c "select to_regclass('public.$table') is not null")" = t ]; then
		ok "public.$table existe"
	else
		fail "public.$table est ABSENTE"
	fi
done

for table in goal_boards goal_blocks goal_links; do
	if [ "$(psql_db -c "select relrowsecurity from pg_class where oid='public.$table'::regclass")" = t ]; then
		ok "la RLS est activée sur $table — sans elle, l'inventaire des politiques serait rassurant sur une table ouverte"
	else
		fail "la RLS n'est PAS activée sur $table"
	fi
done

# Quatre politiques par table : la lecture, et les trois gestes d'écriture. Le compte est asséré
# EXACTEMENT : une politique surnuméraire est aussi grave qu'une politique manquante, puisqu'elles
# s'additionnent par OU.
for table in goal_boards goal_blocks goal_links; do
	compte=$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='$table'")
	if [ "$compte" = '4' ]; then
		ok "$table porte EXACTEMENT quatre politiques — les politiques s'additionnent par OU, une de trop ouvre"
	else
		fail "$table porte « $compte » politique(s), quatre attendues"
	fi
done

# LE POINT DE VIGILANCE ÉCRIT DANS LA DoD : les fonctions d'appui doivent être `SECURITY DEFINER`,
# sous peine de la récursion mesurée à la décision 27.
for fonction in can_read_goal_board can_write_goal_board can_read_goal_block can_write_goal_block; do
	forme=$(psql_db -c "select p.prosecdef::text || ',' || coalesce(array_to_string(p.proconfig, ';'), '')
		from pg_proc p join pg_namespace n on n.oid = p.pronamespace
		where n.nspname='app' and p.proname='$fonction'")
	if [ "$forme" = 'true,search_path=""' ]; then
		ok "app.$fonction est SECURITY DEFINER, search_path vidé (décision 27)"
	else
		fail "app.$fonction a la forme « $forme », attendu « true,search_path=\"\" »"
	fi
done

for fonction in goal_boards_attribuer_position goal_links_verifier_tableau; do
	if [ "$(psql_db -c "select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='$fonction'")" = t ]; then
		ok "app.$fonction est SECURITY DEFINER"
	else
		fail "app.$fonction n'est PAS SECURITY DEFINER : un objet masqué par la RLS lui ferait rendre un refus faux"
	fi
done

# AUCUN TRIGGER D'ÉCRITURE SUR `goal_blocks` HORS `updated_at`. C'est la seule forme sous laquelle
# un calcul automatique de `fill_percent` s'introduirait, et le §1 de la spécification l'interdit.
triggers_blocs=$(psql_db -c "select string_agg(tgname, ',' order by tgname) from pg_trigger
	where tgrelid='public.goal_blocks'::regclass and not tgisinternal")
if [ "$triggers_blocs" = 'goal_blocks_set_updated_at' ]; then
	ok "goal_blocks ne porte QUE son trigger updated_at — aucun calcul de fill_percent (§1)"
else
	fail "goal_blocks porte « $triggers_blocs » : un trigger de plus est la forme sous laquelle un calcul automatique s'introduit"
fi

# L'UNICITÉ DU NOM D'UN TABLEAU EST TOTALE, ET C'EST UNE RÈGLE TRANCHÉE, PAS UN ÉTAT DE FAIT.
# `docs/SPEC-goals.md` §2.1 bis, décision 542 : un tableau archivé RETIENT son nom, comme un track
# archivé retient son `slug`. Le contrôle porte sur le PRÉDICAT de l'index, seul endroit où la règle
# est observable au catalogue : un index refait `where archived_at is null` resterait unique, et un
# contrôle qui ne regarderait que `indisunique` le laisserait passer.
#
# Ce que ce contrôle protège CONCRÈTEMENT : le désarchivage (§5.6) s'exécute sans confirmation et
# n'a aucun cas `doublon` dans son dictionnaire fermé. Il ne peut s'en passer que parce que le nom
# n'a jamais été libéré. Rendre cet index partiel rendrait donc « Désarchiver » faillible sur un
# refus que rien n'annonce — la perte silencieuse du `CLAUDE.md` §18.
predicat_nom=$(psql_db -c "select coalesce(pg_get_expr(ix.indpred, ix.indrelid), 'AUCUN')
	from pg_index ix join pg_class i on i.oid = ix.indexrelid
	where i.relname = 'goal_boards_workspace_name_key'")
if [ "$predicat_nom" = 'AUCUN' ]; then
	ok "goal_boards_workspace_name_key est TOTAL — un tableau archivé retient son nom (§2.1 bis)"
else
	fail "goal_boards_workspace_name_key porte le prédicat « $predicat_nom » : l'archivage libérerait le nom, et « Désarchiver » deviendrait faillible sur un doublon"
fi

# LE PENDANT, ET IL EST INDISPENSABLE : l'écart avec les budgets est VOULU (§2.1 bis.2). Sans ce
# contrôle, une session qui « harmoniserait » les deux index dans l'autre sens — en rendant celui
# des budgets total — passerait inaperçue ici, et un budget récurrent ne pourrait plus reprendre son
# nom d'une période à l'autre.
predicat_budget=$(psql_db -c "select coalesce(pg_get_expr(ix.indpred, ix.indrelid), 'AUCUN')
	from pg_index ix join pg_class i on i.oid = ix.indexrelid
	where i.relname = 'budgets_track_name_ouvert_key'")
if [ "$predicat_budget" = '(closed_at IS NULL)' ]; then
	ok "budgets_track_name_ouvert_key reste PARTIEL — clôturer n'est pas archiver, et l'écart est voulu (§2.1 bis.2)"
else
	fail "budgets_track_name_ouvert_key porte « $predicat_budget », attendu « (closed_at IS NULL) » : l'écart motivé entre les deux règles a été effacé"
fi

# `on delete set null` et non `cascade` : un channel mis à la corbeille ne fait pas disparaître un
# objectif (§2.2).
if [ "$(psql_db -c "select confdeltype from pg_constraint
	where conrelid='public.goal_blocks'::regclass and confrelid='public.channels'::regclass")" = 'n' ]; then
	ok "goal_blocks.channel_id est ON DELETE SET NULL — le bloc survit à sa destination"
else
	fail "goal_blocks.channel_id n'est pas ON DELETE SET NULL : supprimer un channel détruirait un raisonnement"
fi

# Les privilèges, accordés ET refusés : `anon` lit, et n'écrit pas. Le refus de lecture doit être
# ZÉRO LIGNE, non une erreur de privilège (docs/SPEC-permissions-rls.md §7).
for table in goal_boards goal_blocks goal_links; do
	if [ "$(psql_db -c "select has_table_privilege('anon','public.$table','SELECT')")" = t ]; then
		ok "anon a SELECT sur $table : le refus est un filtrage, non une erreur"
	else
		fail "anon n'a pas SELECT sur $table : le refus deviendrait une erreur de privilège"
	fi

	ecritures=$(psql_db -c "select string_agg(privilege_type, ',' order by privilege_type)
		from information_schema.role_table_grants
		where table_schema='public' and table_name='$table'
		  and grantee='anon' and privilege_type <> 'SELECT'")
	if [ -z "$ecritures" ]; then
		ok "anon n'a AUCUN privilège d'écriture sur $table"
	else
		fail "anon détient « $ecritures » sur $table"
	fi
done

# --- 3. La suite pgTAP dédiée -------------------------------------------------------------------

titre "3. La suite pgTAP dédiée"

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
	ok "$(basename "$TEST_SQL") est verte"
else
	fail "$(basename "$TEST_SQL") est ROUGE — voir $TRAVAIL/pgtap.log"
	tail -20 "$TRAVAIL/pgtap.log"
fi

# --- 4. La preuve d'API dédiée ------------------------------------------------------------------

titre "4. La preuve d'API dédiée"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m %s\n' "preuve d'API : --rapide"
else
	if npm run e2e:api -- "$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		ok "$(basename "$SPEC_API") est verte"
	else
		fail "$(basename "$SPEC_API") est ROUGE — voir $TRAVAIL/api.log"
		tail -20 "$TRAVAIL/api.log"
	fi

	# ELLE NETTOIE DERRIÈRE ELLE, ET C'EST CONSTATÉ. Un fichier de preuves qui laisse ses fixtures
	# fait dériver le seed, et les captures de `CRM-083` avec lui.
	restes=$(psql_db -c "select count(*) from public.goal_boards where position >= 90")
	if [ "$restes" = '0' ]; then
		ok "la preuve d'API ne laisse AUCUNE fixture derrière elle"
	else
		fail "« $restes » tableau(x) d'essai survivent à la preuve d'API : le seed dérive"
	fi
fi

# --- 5. Le seed porte son tableau démontrable ---------------------------------------------------
# Un modèle sans données ne démontre rien : `CRM-083` doit trouver de quoi rendre ses états.

titre "5. Le seed porte son tableau démontrable"

blocs=$(psql_db -c "select count(*) from public.goal_blocks where board_id='$TABLEAU_SEED'")
if [ "$blocs" = '6' ]; then
	ok "le tableau du seed porte SIX blocs"
else
	fail "le tableau du seed porte « $blocs » bloc(s), six attendus — appliquez $SEED"
fi

directions=$(psql_db -c "select count(distinct direction) from public.goal_links where board_id='$TABLEAU_SEED'")
if [ "$directions" = '3' ]; then
	ok "les TROIS directions de flèche sont représentées (§2.3)"
else
	fail "« $directions » direction(s) sur trois : le canevas de CRM-083 n'éprouverait son rendu qu'à moitié"
fi

# LES DEUX BORNES DE LA JAUGE. Une jauge n'est fausse qu'aux bords, et un jeu où tous les blocs
# seraient à cinquante ne montrerait ni la jauge vide, ni la jauge pleine.
bornes=$(psql_db -c "select count(*) from public.goal_blocks
	where board_id='$TABLEAU_SEED' and fill_percent in (0, 100)")
if [ "$bornes" -ge 2 ]; then
	ok "les deux bornes de remplissage, 0 et 100, sont présentes"
else
	fail "les bornes 0 et 100 ne sont pas toutes deux présentes : la jauge n'est éprouvée qu'au milieu"
fi

# LE BLOC INVISIBLE, MESURÉ AVEC LE RÔLE RÉEL DE LA LECTRICE plutôt que déduit du modèle. C'est le
# contrôle qui distingue « la donnée est posée » de « la règle s'applique ».
vus_lectrice=$(psql_db <<-SQL
	select set_config('request.jwt.claims',
		json_build_object('sub', '5eed0000-0000-4000-8000-000000000013',
		                  'role', 'authenticated')::text, false);
	set role authenticated;
	select count(*) from public.goal_blocks where board_id = '$TABLEAU_SEED';
SQL
)
vus_lectrice=$(printf '%s' "$vus_lectrice" | tail -1)
if [ "$vus_lectrice" = '5' ]; then
	ok "la lectrice voit CINQ blocs sur six — celui de « Grands comptes » lui est invisible (§4.1)"
else
	fail "la lectrice voit « $vus_lectrice » bloc(s), cinq attendus : soit la règle de visibilité ne s'applique pas, soit le seed ne la démontre plus"
fi

# ET SA FLÈCHE RESTE LISIBLE : la lecture d'un lien ne dépend que du tableau (§9 bis.7).
fleches_lectrice=$(psql_db <<-SQL
	select set_config('request.jwt.claims',
		json_build_object('sub', '5eed0000-0000-4000-8000-000000000013',
		                  'role', 'authenticated')::text, false);
	set role authenticated;
	select count(*) from public.goal_links where board_id = '$TABLEAU_SEED';
SQL
)
fleches_lectrice=$(printf '%s' "$fleches_lectrice" | tail -1)
if [ "$fleches_lectrice" = '4' ]; then
	ok "la lectrice voit les QUATRE flèches, dont celle qui part du bloc qu'elle ne voit pas (§5.4)"
else
	fail "la lectrice voit « $fleches_lectrice » flèche(s), quatre attendues"
fi

# LE BLOC INVISIBLE EST BIEN CELUI QU'ON CROIT, et pas un autre. Sans ce contrôle nominatif, une
# erreur ailleurs dans le seed rendrait l'assertion précédente verte sur le mauvais bloc.
if [ "$(psql_db -c "select channel_id is not null from public.goal_blocks where id='$BLOC_GRANDS_COMPTES'")" = t ]; then
	ok "le bloc invisible est bien celui qui porte un lien de channel"
else
	fail "le bloc « Gagner un grand compte » ne porte plus de lien : le cas du §4.1 n'est plus démontré"
fi

# --- 6. Non-complaisance ------------------------------------------------------------------------
# Un harnais qui ne peut pas échouer ne prouve rien. Chaque dégradation porte sur une règle que la
# spécification énonce, et le contrôle qui devrait la voir est rejoué.

titre "6. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m %s\n' "dégradations : --rapide"
else
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

	# LA DÉGRADATION LA PLUS IMPORTANTE DE CETTE UNITÉ. Sans la condition de channel, un bloc lié à
	# un channel fermé redeviendrait visible : c'est la fuite que le §4.1 sert à empêcher.
	degrader_et_verifier \
		"la lecture d'un bloc ne regarde plus son channel — un objectif posé sur un dossier interdit redeviendrait visible" \
		"drop policy goal_blocks_lecture on public.goal_blocks;
		 create policy goal_blocks_lecture on public.goal_blocks for select to anon, authenticated
		   using (app.can_read_goal_board(board_id))" \
		"drop policy goal_blocks_lecture on public.goal_blocks;
		 create policy goal_blocks_lecture on public.goal_blocks for select to anon, authenticated
		   using (app.can_read_goal_board(board_id)
		          and (channel_id is null or app.can_read_channel(channel_id)))"

	# La seconde moitié de la même règle : poser un lien exigerait seulement de LIRE la
	# destination, et n'importe quel lecteur pourrait engager le dossier d'autrui.
	degrader_et_verifier \
		"poser un lien n'exigerait plus que la LECTURE du channel — un lecteur engagerait le dossier d'autrui" \
		"drop policy goal_blocks_insertion on public.goal_blocks;
		 create policy goal_blocks_insertion on public.goal_blocks for insert to authenticated
		   with check (app.can_write_goal_board(board_id)
		               and (channel_id is null or app.can_read_channel(channel_id)))" \
		"drop policy goal_blocks_insertion on public.goal_blocks;
		 create policy goal_blocks_insertion on public.goal_blocks for insert to authenticated
		   with check (app.can_write_goal_board(board_id)
		               and (channel_id is null or app.can_write_channel(channel_id)))"

	degrader_et_verifier \
		"l'écriture d'un tableau ouverte à tout membre, viewer compris — l'invariant du §2.1 des permissions serait percé" \
		"drop policy goal_boards_insertion_membre_ecrivant on public.goal_boards;
		 create policy goal_boards_insertion_membre_ecrivant on public.goal_boards for insert
		   to authenticated with check (app.is_workspace_member(workspace_id))" \
		"drop policy goal_boards_insertion_membre_ecrivant on public.goal_boards;
		 create policy goal_boards_insertion_membre_ecrivant on public.goal_boards for insert
		   to authenticated
		   with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'))"

	degrader_et_verifier \
		"le trigger de cohérence des flèches retiré — un lien entre deux tableaux passerait" \
		"drop trigger goal_links_verifier_tableau on public.goal_links" \
		"create trigger goal_links_verifier_tableau before insert or update on public.goal_links
		   for each row execute function app.goal_links_verifier_tableau()"

	degrader_et_verifier \
		"la borne haute de fill_percent portée à 1000 — la jauge cesserait d'être une jauge" \
		"alter table public.goal_blocks drop constraint goal_blocks_fill_percent_check;
		 alter table public.goal_blocks add constraint goal_blocks_fill_percent_check
		   check (fill_percent between 0 and 1000)" \
		"alter table public.goal_blocks drop constraint goal_blocks_fill_percent_check;
		 alter table public.goal_blocks add constraint goal_blocks_fill_percent_check
		   check (fill_percent between 0 and 100)"

	# LA DÉGRADATION DE LA DÉCISION 542, et c'est celle qui ressemble le plus à une amélioration :
	# rendre l'index du nom partiel « comme celui des budgets » paraît une harmonisation, et c'est
	# une régression — le nom libéré par l'archivage rendrait « Désarchiver » faillible sur un
	# doublon que rien n'annonce (§2.1 bis.2).
	degrader_et_verifier \
		"l'unicité du nom ne porterait plus que sur les tableaux VIVANTS — l'archivage libérerait le nom" \
		"drop index public.goal_boards_workspace_name_key;
		 create unique index goal_boards_workspace_name_key
		   on public.goal_boards (workspace_id, app.btrim_blancs(name)) where archived_at is null" \
		"drop index public.goal_boards_workspace_name_key;
		 create unique index goal_boards_workspace_name_key
		   on public.goal_boards (workspace_id, app.btrim_blancs(name))"

	# LA DÉGRADATION QUI PROTÈGE LA RÈGLE LA PLUS FACILE À « AMÉLIORER » : refuser les cycles
	# paraîtrait un durcissement, et détruirait une intention légitime (§2.3). Elle doit rendre la
	# suite rouge par son assertion de cycle accepté, et par elle seule.
	degrader_et_verifier \
		"un refus de cycle ajouté — « A nourrit B, B nourrit A » deviendrait impossible" \
		"create or replace function app.degradation_refuser_cycle() returns trigger
		   language plpgsql as \$\$
		   begin
		     if exists (select 1 from public.goal_links l
		                 where l.source_block_id = new.target_block_id
		                   and l.target_block_id = new.source_block_id) then
		       raise exception 'cycle refusé' using errcode = 'check_violation';
		     end if;
		     return new;
		   end; \$\$;
		 create trigger goal_links_degradation_cycle before insert on public.goal_links
		   for each row execute function app.degradation_refuser_cycle()" \
		"drop trigger if exists goal_links_degradation_cycle on public.goal_links;
		 drop function if exists app.degradation_refuser_cycle()"
fi

# --- 7. Restauration ----------------------------------------------------------------------------
# Les dégradations ci-dessus rejouent leur restauration, mais une restauration qui échouerait
# passerait inaperçue derrière son `|| true`. La migration est donc rejouée, et la suite avec
# elle : c'est le seul contrôle qui établisse que la base est rendue dans l'état du dépôt.

titre "7. La base est rendue dans l'état du dépôt"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m %s\n' "restauration : --rapide"
else
	if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		-f - <"$MIGRATION" >"$TRAVAIL/restauration.log" 2>&1; then
		ok "la migration se rejoue sans erreur — convergence"
	else
		fail "la migration NE SE REJOUE PAS — voir $TRAVAIL/restauration.log"
		tail -20 "$TRAVAIL/restauration.log"
	fi

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/final.log" 2>&1; then
		ok "la suite pgTAP est verte APRÈS les dégradations : la base est rendue intacte"
	else
		fail "la suite pgTAP reste ROUGE après restauration — voir $TRAVAIL/final.log"
		tail -20 "$TRAVAIL/final.log"
	fi
fi

# --- Bilan --------------------------------------------------------------------------------------

titre "Bilan"

if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi

printf '  \033[31m%s contrôles, %s en échec.\033[0m\n\n' "$checks" "$failures"
exit 1
