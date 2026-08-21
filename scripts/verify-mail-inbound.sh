#!/usr/bin/env bash
# @verifies CRM-052 (docs/BACKLOG.md) — Definition of Done des comptes entrants IMAP
# @verifies docs/SPEC-mail-subsystem.md §13.1 (périmètre), §13.2 (modèle), §13.3 (chemin
#           d'écriture unique), §13.4 (qui lit quoi), §13.5 (test de connexion réel),
#           §13.6 (ce que le développement peut prouver), §13.7 (le code, jamais la phrase),
#           §13.8 (seed), §13.9 (preuves exigées)
# @verifies docs/SPEC-permissions-rls.md §7, preuves de refus n° 6, n° 7 et n° 11
# @verifies docs/SCHEMA.md §12 ; docs/SPEC-seed.md §2.17
# @verifies docs/JOURNAL.md décision 316 ; CLAUDE.md §8 (aucune trace fabriquée), §10 (la règle
#           est appliquée côté backend et prouvée hors interface)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité `@spec` / `@verifies` ;
#   2. le schéma RÉELLEMENT en base porte ce que la spécification annonce : les deux index
#      uniques partiels, les deux politiques de lecture, l'absence de toute écriture directe, et
#      `secret_id` fermée à `authenticated` ;
#   3. les trois fonctions existent, sont `SECURITY DEFINER` là où il le faut, et leurs droits
#      d'exécution sont ceux du §13.5 ;
#   4. le secret n'est PAS dans la table : il est dans Vault, et le chiffré ne ressemble pas au
#      clair ;
#   5. le seed porte ses trois comptes, posés par le vrai chemin d'écriture, et il CONVERGE ;
#   6. la preuve d'API dédiée est verte — refus n° 6, n° 7 et n° 11 compris ;
#   7. la preuve `mail` ouvre de VRAIES sessions IMAP et écrit ses verdicts en base ;
#   8. `pytest mail-sync/tests` est vert, et le service embarque bien IMAPClient ;
#   9. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN ÉCRAN. Le §2.3 décrit des formulaires de configuration qu'aucune unité du backlog ne
# porte ; le geste existe par l'API interne du service, comme l'exploitant l'exercera (§13.1).
#
# AUCUNE SYNCHRONISATION. `last_sync_at` et `sync_state` restent nuls : `CRM-054` les remplira.
# Le harnais échoue si l'un d'eux prétend autre chose — une valeur y apparaîtrait sans que rien
# ne l'écrive.
#
# `ssl` IMPLICITE N'EST PAS PROUVABLE ici, faute de listener 993 (§13.6). L'absence est figée par
# une assertion de `e2e/mail/comptes-entrants.spec.ts`, jamais par un commentaire.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-mail-inbound.sh
#   scripts/verify-mail-inbound.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
MIGRATION=supabase/migrations/0022_comptes_entrants_imap.sql
TEST_SQL=supabase/tests/0024_comptes_entrants_imap.test.sql
SPEC_API=e2e/api/comptes-entrants.spec.ts
SPEC_MAIL=e2e/mail/comptes-entrants.spec.ts
SONDE=mail-sync/src/mail_sync/imap_probe.py
CLIENT=mail-sync/src/mail_sync/postgrest.py
TEST_SONDE=mail-sync/tests/test_imap_probe.py
SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,48p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
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
RAPPORTS=e2e/output/verify-mail-inbound
mkdir -p "$RAPPORTS"

# Même leçon qu'à `scripts/verify-commentaires.sh` : un message d'échec qui renvoie vers un
# répertoire effacé par son propre `trap` ne vaut pas mieux qu'un échec tu (CLAUDE.md §18).
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

SAUVEGARDES="$TRAVAIL/sauvegardes"
mkdir -p "$SAUVEGARDES"
sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }

restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-052 — comptes entrants IMAP\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$SONDE" "$CLIENT" "$TEST_SONDE"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$SONDE" "$CLIENT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-052'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$TEST_SONDE"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-052'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. Le schéma réellement en base"

if [ "$(psql_db -c "select to_regclass('public.mail_inbound_accounts') is not null")" = t ]; then
	ok "la table mail_inbound_accounts existe"
else
	fail "la table mail_inbound_accounts est ABSENTE"
fi

nb_partiels=$(psql_db -c "select count(*) from pg_indexes where schemaname='public'
	and tablename='mail_inbound_accounts' and indexdef ilike '%unique%' and indexdef ilike '%where%'")
if [ "$nb_partiels" = 2 ]; then
	ok "deux index uniques PARTIELS : un catch-all par workspace, une boîte par personne"
else
	fail "index uniques partiels : $nb_partiels au lieu de 2 — §13.2"
fi

nb_politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public'
	and tablename='mail_inbound_accounts'")
nb_ecriture=$(psql_db -c "select count(*) from pg_policies where schemaname='public'
	and tablename='mail_inbound_accounts' and cmd <> 'SELECT'")
if [ "$nb_politiques" = 2 ] && [ "$nb_ecriture" = 0 ]; then
	ok "deux politiques, toutes deux en LECTURE : rien n'ouvre l'écriture directe"
else
	fail "politiques : $nb_politiques dont $nb_ecriture d'écriture — attendu 2 et 0"
fi

# PREUVE DE REFUS N° 6, au niveau du catalogue : la révocation est un privilège de COLONNE, elle
# ne dépend d'aucune ligne et ne peut pas être contournée par un `select` bien choisi.
nb_secret=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_inbound_accounts'
	  and grantee='authenticated' and column_name='secret_id'")
if [ "$nb_secret" = 0 ]; then
	ok "REFUS N° 6 : authenticated n'a AUCUN privilège sur secret_id"
else
	fail "secret_id est ouverte à authenticated ($nb_secret privilège(s)) — refus n° 6 rompu"
fi

nb_ecritures_colonnes=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_inbound_accounts'
	  and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')")
if [ "$nb_ecritures_colonnes" = 0 ]; then
	ok "aucune écriture directe accordée : le seul chemin correct est la fonction du §13.3"
else
	fail "$nb_ecritures_colonnes privilège(s) d'écriture directe — §13.3 rompu"
fi

nb_anon=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_inbound_accounts' and grantee='anon'")
if [ "$nb_anon" = 0 ]; then
	ok "REFUS N° 11 : anon n'a rien du tout sur cette table"
else
	fail "anon détient $nb_anon privilège(s) sur les comptes entrants"
fi

for fonction in upsert_mail_inbound_account mail_inbound_account_credentials \
	mail_inbound_account_record_check; do
	if [ "$(psql_db -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
		and p.proname='$fonction' and p.prosecdef")" = 1 ]; then
		ok "$fonction est livrée dans public et SECURITY DEFINER"
	else
		fail "$fonction est absente, hors de public, ou n'est pas SECURITY DEFINER"
	fi
done

for fonction in "mail_inbound_account_credentials(uuid)" \
	"mail_inbound_account_record_check(uuid, text, text)"; do
	if [ "$(psql_db -c "select has_function_privilege('authenticated','public.$fonction','execute')")" = f ] \
		&& [ "$(psql_db -c "select has_function_privilege('service_role','public.$fonction','execute')")" = t ]; then
		ok "${fonction%%(*} : refusée à authenticated, accordée à service_role (§13.5)"
	else
		fail "${fonction%%(*} : ses droits d'exécution ne sont pas ceux du §13.5"
	fi
done

# --- 3. Le secret est dans Vault, pas dans la table ---------------------------------------------

titre "3. Le secret est dans Vault"

if [ "$(psql_db -c "select count(*) from information_schema.columns
	where table_schema='public' and table_name='mail_inbound_accounts'
	  and column_name in ('password','secret','imap_password')")" = 0 ]; then
	ok "aucune colonne de mot de passe : la table ne porte qu'une référence"
else
	fail "une colonne de mot de passe est apparue dans la table — §2.3 rompu"
fi

MOT_DE_PASSE_SEED=$(grep '^STALWART_MAILBOX_PASSWORD=' .env | cut -d= -f2-)
if [ -n "$MOT_DE_PASSE_SEED" ]; then
	nb_clair=$(psql_db -c "select count(*) from vault.secrets s
		join public.mail_inbound_accounts a on a.secret_id = s.id
		where s.secret like '%$MOT_DE_PASSE_SEED%'")
	if [ "$nb_clair" = 0 ]; then
		ok "le chiffré stocké ne contient PAS le mot de passe en clair"
	else
		fail "$nb_clair secret(s) stockent le mot de passe en clair — Vault ne chiffre plus"
	fi

	nb_dechiffre=$(psql_db -c "select count(*) from vault.decrypted_secrets s
		join public.mail_inbound_accounts a on a.secret_id = s.id
		where s.decrypted_secret = '$MOT_DE_PASSE_SEED'")
	if [ "$nb_dechiffre" = 3 ]; then
		ok "les trois secrets se déchiffrent correctement pour qui en a le droit"
	else
		fail "secrets déchiffrables : $nb_dechiffre au lieu de 3"
	fi
else
	fail "STALWART_MAILBOX_PASSWORD absente de .env : le contrôle du chiffrement est impossible"
fi

# --- 4. Le seed ---------------------------------------------------------------------------------

titre "4. Le seed et sa convergence"

nb_comptes=$(psql_db -c "select count(*) from public.mail_inbound_accounts")
nb_systeme=$(psql_db -c "select count(*) from public.mail_inbound_accounts where owner_id is null")
if [ "$nb_comptes" = 3 ] && [ "$nb_systeme" = 1 ]; then
	ok "trois comptes seedés, dont exactement une boîte système — §13.8"
else
	fail "comptes seedés : $nb_comptes dont $nb_systeme système — attendu 3 et 1"
fi

# Farida n'a pas de boîte, et c'est ce qui donne aux preuves un membre sans compte.
if [ "$(psql_db -c "select count(*) from public.mail_inbound_accounts
	where owner_id = '5eed0000-0000-4000-8000-000000000013'")" = 0 ]; then
	ok "le viewer n'a AUCUNE boîte : un viewer lit, il ne correspond pas"
else
	fail "une boîte a été créée pour le viewer — §11.4 et §13.8 disent le contraire"
fi

# RETOURNÉE LE 2026-08-21 — INC-191, décision 497. Cette assertion figeait une ABSENCE — « aucune
# synchronisation n'est prétendue » — sur les DEUX colonnes à la fois, à une époque où rien ne les
# écrivait. `CRM-054` est livrée depuis, et sa relève réelle écrit `sync_state` : le harnais
# rougissait donc du fonctionnement du produit, et non d'une synchronisation simulée. La précision
# mesurée par la session `CRM-088` désigne la moitié exacte à retourner, et les deux moitiés se
# séparent ici.
#
# MOITIÉ 1 — `last_sync_at` reste nulle, et l'assertion RESTE une absence figée, délibérément :
# aucune unité ne remplit encore cette colonne. Elle rougira le jour où l'une le fera, et désignera
# alors le contrôle à écrire. C'est le mécanisme de la décision 51, et il n'a pas encore joué ici.
if [ "$(psql_db -c "select count(*) from public.mail_inbound_accounts where last_sync_at is not null")" = 0 ]; then
	ok "\`last_sync_at\` reste nulle partout : aucune unité ne la remplit encore — absence FIGÉE, qui rougira le jour venu"
else
	fail "\`last_sync_at\` est renseignée : une unité a livré son écriture, ce contrôle doit être retourné en preuve de cette écriture"
fi

# MOITIÉ 2 — `sync_state` est écrite par la relève réelle de `CRM-054`, et l'absence ne se fige plus.
# Ce qui doit rester vrai est que RIEN D'AUTRE que cette relève ne l'écrit : un état non vide porte
# donc, pour chaque dossier, les deux bornes d'UID entières que `mail-sync` y met — MESURÉ le
# 2026-08-21 sur la boîte système, `{"INBOX": {"uid_max": 4, "uid_min": 1}}`. Un état vide reste
# légitime : il dit qu'aucune relève n'a encore tourné sur cette boîte.
mal_formes=$(psql_db -c "select count(*) from public.mail_inbound_accounts a
	where a.sync_state <> '{}'::jsonb
	  and exists (
	      select 1 from jsonb_each(a.sync_state) d
	       where jsonb_typeof(d.value) <> 'object'
	          or jsonb_typeof(d.value -> 'uid_min') <> 'number'
	          or jsonb_typeof(d.value -> 'uid_max') <> 'number')")
if [ "$mal_formes" = 0 ]; then
	renseignes=$(psql_db -c "select count(*) from public.mail_inbound_accounts where sync_state <> '{}'::jsonb")
	ok "\`sync_state\` n'est écrite que par la relève de \`CRM-054\` : $renseignes boîte(s) relevée(s), chacune portant ses bornes d'UID par dossier"
else
	fail "$mal_formes boîte(s) portent un \`sync_state\` que la relève de \`CRM-054\` n'a pas pu écrire : bornes d'UID absentes ou non numériques"
fi

if [ "$RAPIDE" = false ]; then
	if "$SEED" >"$TRAVAIL/seed.log" 2>&1; then
		nb_apres=$(psql_db -c "select count(*) from public.mail_inbound_accounts")
		if [ "$nb_apres" = 3 ]; then
			ok "le seed CONVERGE : un rejeu ne duplique ni ne perd aucun compte"
		else
			fail "après rejeu du seed : $nb_apres comptes au lieu de 3"
		fi
	else
		fail_journal "le rejeu du seed ÉCHOUE" "$TRAVAIL/seed.log"
	fi
fi

# --- 5. Les preuves exécutables -----------------------------------------------------------------

if [ "$RAPIDE" = false ]; then
	titre "5. Preuves exécutables"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 60 ]; then
			ok "suite pgTAP dédiée — 60 assertions"
		else
			fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 60"
		fi
	else
		fail_journal "la suite pgTAP dédiée ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 11 ]; then
			ok "preuve d'API dédiée — 11 scénarios, refus n° 6, n° 7 et n° 11 compris"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 11"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_MAIL" >"$TRAVAIL/mail.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 6 ]; then
			ok "preuve mail — 6 scénarios ouvrant de VRAIES sessions IMAP"
		else
			fail "preuve mail verte mais ${passes:-0} scénarios au lieu de 6"
		fi
	else
		fail_journal "la preuve mail ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/pytest.log" 2>&1; then
		ok "pytest mail-sync/tests : $(tail -1 "$TRAVAIL/pytest.log")"
	else
		fail_journal "pytest mail-sync/tests ÉCHOUE" "$TRAVAIL/pytest.log"
	fi

	# La bibliothèque du §10 arbitrage n° 1 est réellement dans l'image, et c'est elle que le
	# service emploie — pas `imaplib`, qui prouverait un chemin que le produit n'emprunte pas.
	if docker exec p2enjoy-mail-sync python -c 'import imapclient; print(imapclient.__version__)' \
		>"$TRAVAIL/imapclient.log" 2>&1 && grep -q '^3\.1\.0$' "$TRAVAIL/imapclient.log"; then
		ok "le conteneur embarque IMAPClient 3.1.0, la bibliothèque de l'arbitrage n° 1"
	else
		fail_journal "IMAPClient 3.1.0 est absent du conteneur" "$TRAVAIL/imapclient.log"
	fi
fi

# --- 6. Non-complaisance ------------------------------------------------------------------------
# Chaque dégradation doit faire réellement ÉCHOUER une preuve. Un harnais qui reste vert sur un
# produit affaibli ne prouve rien (décisions 143, 157).

if [ "$RAPIDE" = false ]; then
	titre "6. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

	# LE TÉMOIN AVANT LES DÉGRADATIONS, ET IL N'EST PAS DÉCORATIF. Si la suite était DÉJÀ rouge,
	# chaque dégradation serait déclarée « vue » sans rien avoir prouvé — six faux verts d'affilée,
	# et le contrôle le plus important du harnais deviendrait le plus trompeur. C'est arrivé une
	# fois, en écrivant cette unité : la suite tombait sur les comptes seedés, et les six
	# dégradations passaient toutes.
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : la suite est VERTE avant toute dégradation — les refus qui suivent comptent"
	else
		fail_journal "témoin ROUGE : les dégradations qui suivent ne prouveraient rien" \
			"$TRAVAIL/temoin.log"
	fi

	degradation_sql() {
		local libelle=$1 sql_casser=$2 sql_reparer=$3
		psql_db -c "$sql_casser" >/dev/null 2>&1
		if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		psql_db -c "$sql_reparer" >/dev/null 2>&1
	}

	degradation_sql "secret_id rouverte en lecture à authenticated — le refus n° 6 tomberait" \
		"grant select (secret_id) on public.mail_inbound_accounts to authenticated" \
		"revoke select (secret_id) on public.mail_inbound_accounts from authenticated"

	degradation_sql "l'écriture directe rendue à authenticated — deux chemins d'écriture" \
		"grant insert on public.mail_inbound_accounts to authenticated" \
		"revoke insert on public.mail_inbound_accounts from authenticated"

	degradation_sql "la voie de sortie du secret ouverte à authenticated — §13.5 rompu" \
		"grant execute on function public.mail_inbound_account_credentials(uuid) to authenticated" \
		"revoke execute on function public.mail_inbound_account_credentials(uuid) from authenticated"

	degradation_sql "l'unicité de la boîte système retirée — deux catch-all dédoubleraient tout" \
		"drop index if exists public.mail_inbound_accounts_systeme_unique" \
		"create unique index if not exists mail_inbound_accounts_systeme_unique
		 on public.mail_inbound_accounts (workspace_id) where owner_id is null"

	degradation_sql "la contrainte de code d'erreur retirée — un texte de serveur passerait" \
		"alter table public.mail_inbound_accounts drop constraint mail_inbound_accounts_erreur_code" \
		"alter table public.mail_inbound_accounts add constraint mail_inbound_accounts_erreur_code
		 check (last_error is null or last_error in ('auth_failed','host_unreachable',
		        'connection_refused','tls_failed','timeout','protocol_error'))"

	degradation_sql "la politique de lecture du propriétaire élargie à tout membre — refus n° 7" \
		"alter policy mail_inbound_accounts_lecture_proprietaire on public.mail_inbound_accounts
		 using (app.is_workspace_member(workspace_id))" \
		"alter policy mail_inbound_accounts_lecture_proprietaire on public.mail_inbound_accounts
		 using (owner_id = (select auth.uid()))"

	# La sonde IMAP dégradée : un code hors catalogue doit faire échouer pytest, sans quoi le
	# service écrirait une valeur que la contrainte de la base rejette.
	sauvegarder "$SONDE"
	sed -i 's/^AUTH_FAILED = "auth_failed"$/AUTH_FAILED = "mauvais_mot_de_passe"/' "$SONDE"
	if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/degrade-py.log" 2>&1; then
		fail "dégradation NON VUE : un code hors catalogue passe les preuves Python"
	else
		ok "dégradation vue : un code hors catalogue fait échouer pytest"
	fi
	rendre "$SONDE"

	titre "7. Restauration"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/restaure.log" 2>&1; then
		ok "la suite pgTAP redevient verte après restauration"
	else
		fail_journal "la suite pgTAP reste ROUGE après restauration" "$TRAVAIL/restaure.log"
	fi

	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/restaure-py.log" 2>&1; then
		ok "pytest redevient vert après restauration"
	else
		fail_journal "pytest reste ROUGE après restauration" "$TRAVAIL/restaure-py.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
