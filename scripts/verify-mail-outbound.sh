#!/usr/bin/env bash
# @verifies CRM-053 (docs/BACKLOG.md) — Definition of Done des identités sortantes SMTP
# @verifies docs/SPEC-mail-subsystem.md §14.1 (périmètre), §14.2 (modèle), §14.3 (chemin
#           d'écriture unique), §14.4 (qui lit quoi), §14.5 (test de connexion réel),
#           §14.6 (ce que le développement peut prouver), §14.7 (le code, jamais la phrase),
#           §14.8 (seed), §14.9 (preuves exigées)
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
#      d'exécution sont ceux du §14.5 ;
#   4. le secret n'est PAS dans la table : il est dans Vault, et le chiffré ne ressemble pas au
#      clair ;
#   5. le seed porte ses trois comptes, posés par le vrai chemin d'écriture, et il CONVERGE ;
#   6. la preuve d'API dédiée est verte — refus n° 6, n° 7 et n° 11 compris ;
#   7. la preuve `mail` ouvre de VRAIES sessions IMAP et écrit ses verdicts en base ;
#   8. `pytest mail-sync/tests` est vert, y compris la garde du DÉLAI : le test SMTP doit rester
#      plus patient que le délai de pénalité mesuré du serveur ;
#   9. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN ÉCRAN. Le §2.3 décrit des formulaires de configuration qu'aucune unité du backlog ne
# porte ; le geste existe par l'API interne du service, comme l'exploitant l'exercera (§14.1).
#
# AUCUN ENVOI. `daily_quota` est créée SANS consommateur, et le quota n'est appliqué nulle part :
# l'envoi appartient à `CRM-058`. Le harnais échoue si un quota consommé apparaissait, puisque rien
# ne saurait l'écrire.
#
# LA PREUVE DE REFUS N° 12 RESTE HORS D'ATTEINTE : elle exige `queue_outbound_email`, due par
# `CRM-058`. Son absence est figée par `e2e/api/preuves-refus.spec.ts`, jamais commentée.
#
# SMTPS IMPLICITE N'EST PAS PROUVABLE ici, faute de listener 465 (§14.5). L'absence est figée par
# une assertion de `e2e/mail/identites-sortantes.spec.ts`, jamais par un commentaire.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-mail-outbound.sh
#   scripts/verify-mail-outbound.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
MIGRATION=supabase/migrations/0023_identites_sortantes_smtp.sql
TEST_SQL=supabase/tests/0025_identites_sortantes_smtp.test.sql
SPEC_API=e2e/api/identites-sortantes.spec.ts
SPEC_MAIL=e2e/mail/identites-sortantes.spec.ts
SONDE=mail-sync/src/mail_sync/smtp_probe.py
CLIENT=mail-sync/src/mail_sync/postgrest.py
TEST_SONDE=mail-sync/tests/test_smtp_probe.py
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
RAPPORTS=e2e/output/verify-mail-outbound
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

printf '\033[1mPreuves de CRM-053 — identités sortantes SMTP\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$SONDE" "$CLIENT" "$TEST_SONDE"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$SONDE" "$CLIENT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-053'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$TEST_SONDE"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-053'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. Le schéma réellement en base"

if [ "$(psql_db -c "select to_regclass('public.mail_outbound_identities') is not null")" = t ]; then
	ok "la table mail_outbound_identities existe"
else
	fail "la table mail_outbound_identities est ABSENTE"
fi

nb_partiels=$(psql_db -c "select count(*) from pg_indexes where schemaname='public'
	and tablename='mail_outbound_identities' and indexdef ilike '%unique%' and indexdef ilike '%is_default%'")
if [ "$nb_partiels" = 2 ]; then
	ok "deux index uniques partiels sur l'identité par DÉFAUT : une par personne, une de service"
else
	fail "index uniques partiels : $nb_partiels au lieu de 2 — §14.2"
fi

# LE TRIGGER EST `BEFORE`, ET C'EST MESURÉ : écrit `AFTER`, l'index refusait la seconde identité
# avant que le défaut n'ait été rabattu. Un invariant tenu par un index et rétabli par un trigger
# n'a de sens que si le second parle en premier.
if [ "$(psql_db -c "select t.tgtype::int & 2 from pg_trigger t
	where t.tgrelid='public.mail_outbound_identities'::regclass
	  and t.tgname='mail_outbound_identities_defaut'")" = 2 ]; then
	ok "le trigger d'identité par défaut est BEFORE : il rabat avant que l'index ne refuse"
else
	fail "le trigger d'identité par défaut n'est pas BEFORE — l'index refusera la seconde identité"
fi

nb_politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public'
	and tablename='mail_outbound_identities'")
nb_ecriture=$(psql_db -c "select count(*) from pg_policies where schemaname='public'
	and tablename='mail_outbound_identities' and cmd <> 'SELECT'")
if [ "$nb_politiques" = 2 ] && [ "$nb_ecriture" = 0 ]; then
	ok "deux politiques, toutes deux en LECTURE : rien n'ouvre l'écriture directe"
else
	fail "politiques : $nb_politiques dont $nb_ecriture d'écriture — attendu 2 et 0"
fi

# PREUVE DE REFUS N° 6, au niveau du catalogue : la révocation est un privilège de COLONNE, elle
# ne dépend d'aucune ligne et ne peut pas être contournée par un `select` bien choisi.
nb_secret=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_outbound_identities'
	  and grantee='authenticated' and column_name='secret_id'")
if [ "$nb_secret" = 0 ]; then
	ok "REFUS N° 6 : authenticated n'a AUCUN privilège sur secret_id"
else
	fail "secret_id est ouverte à authenticated ($nb_secret privilège(s)) — refus n° 6 rompu"
fi

nb_ecritures_colonnes=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_outbound_identities'
	  and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')")
if [ "$nb_ecritures_colonnes" = 0 ]; then
	ok "aucune écriture directe accordée : le seul chemin correct est la fonction du §14.3"
else
	fail "$nb_ecritures_colonnes privilège(s) d'écriture directe — §14.3 rompu"
fi

nb_anon=$(psql_db -c "select count(*) from information_schema.column_privileges
	where table_schema='public' and table_name='mail_outbound_identities' and grantee='anon'")
if [ "$nb_anon" = 0 ]; then
	ok "REFUS N° 11 : anon n'a rien du tout sur cette table"
else
	fail "anon détient $nb_anon privilège(s) sur les comptes entrants"
fi

for fonction in upsert_mail_outbound_identity mail_outbound_identity_credentials \
	mail_outbound_identity_record_check; do
	if [ "$(psql_db -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
		and p.proname='$fonction' and p.prosecdef")" = 1 ]; then
		ok "$fonction est livrée dans public et SECURITY DEFINER"
	else
		fail "$fonction est absente, hors de public, ou n'est pas SECURITY DEFINER"
	fi
done

for fonction in "mail_outbound_identity_credentials(uuid)" \
	"mail_outbound_identity_record_check(uuid, text, text)"; do
	if [ "$(psql_db -c "select has_function_privilege('authenticated','public.$fonction','execute')")" = f ] \
		&& [ "$(psql_db -c "select has_function_privilege('service_role','public.$fonction','execute')")" = t ]; then
		ok "${fonction%%(*} : refusée à authenticated, accordée à service_role (§14.5)"
	else
		fail "${fonction%%(*} : ses droits d'exécution ne sont pas ceux du §14.5"
	fi
done

# --- 3. Le secret est dans Vault, pas dans la table ---------------------------------------------

titre "3. Le secret est dans Vault"

if [ "$(psql_db -c "select count(*) from information_schema.columns
	where table_schema='public' and table_name='mail_outbound_identities'
	  and column_name in ('password','secret','imap_password')")" = 0 ]; then
	ok "aucune colonne de mot de passe : la table ne porte qu'une référence"
else
	fail "une colonne de mot de passe est apparue dans la table — §2.3 rompu"
fi

MOT_DE_PASSE_SEED=$(grep '^STALWART_MAILBOX_PASSWORD=' .env | cut -d= -f2-)
if [ -n "$MOT_DE_PASSE_SEED" ]; then
	nb_clair=$(psql_db -c "select count(*) from vault.secrets s
		join public.mail_outbound_identities a on a.secret_id = s.id
		where s.secret like '%$MOT_DE_PASSE_SEED%'")
	if [ "$nb_clair" = 0 ]; then
		ok "le chiffré stocké ne contient PAS le mot de passe en clair"
	else
		fail "$nb_clair secret(s) stockent le mot de passe en clair — Vault ne chiffre plus"
	fi

	nb_dechiffre=$(psql_db -c "select count(*) from vault.decrypted_secrets s
		join public.mail_outbound_identities a on a.secret_id = s.id
		where s.decrypted_secret = '$MOT_DE_PASSE_SEED'")
	if [ "$nb_dechiffre" = 2 ]; then
		ok "les deux secrets se déchiffrent correctement pour qui en a le droit"
	else
		fail "secrets déchiffrables : $nb_dechiffre au lieu de 2"
	fi
else
	fail "STALWART_MAILBOX_PASSWORD absente de .env : le contrôle du chiffrement est impossible"
fi

# --- 4. Le seed ---------------------------------------------------------------------------------

titre "4. Le seed et sa convergence"

nb_comptes=$(psql_db -c "select count(*) from public.mail_outbound_identities")
nb_service=$(psql_db -c "select count(*) from public.mail_outbound_identities where owner_id is null")
if [ "$nb_comptes" = 2 ] && [ "$nb_service" = 1 ]; then
	ok "deux identités seedées, dont exactement une de service — §14.6"
else
	fail "identités seedées : $nb_comptes dont $nb_service de service — attendu 2 et 1"
fi

# LE CAS D'USAGE DU §2.2, MESURÉ SUR LE SEED : entrant et sortant divergent.
if [ "$(psql_db -c "select i.from_address <> a.imap_username
	from public.mail_outbound_identities i
	join public.mail_inbound_accounts a on a.owner_id = i.owner_id
	where i.owner_id = '5eed0000-0000-4000-8000-000000000012'")" = t ]; then
	ok "Driss reçoit sur bizdev@ et expédie depuis contact@ : le seed DÉMONTRE le §2.2"
else
	fail "entrant et sortant coïncident pour Driss — le cas d'usage du §2.2 n'est plus démontré"
fi

# Un seul défaut par personne, et jamais zéro : c'est l'invariant du §14.2.
if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities
	where owner_id is not null and is_default")" = 1 ] \
	&& [ "$(psql_db -c "select count(*) from public.mail_outbound_identities
	where owner_id is null and is_default")" = 1 ]; then
	ok "une identité par défaut pour Driss, une pour le service — et pas zéro"
else
	fail "l'invariant d'identité par défaut du §14.2 n'est pas tenu"
fi

# Camille n'a AUCUNE identité sortante, et c'est ce qui donne aux preuves une administratrice qui
# lit tout sans rien posséder.
if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities
	where owner_id = '5eed0000-0000-4000-8000-000000000011'")" = 0 ]; then
	ok "l'administratrice n'a aucune identité à elle : lire n'est pas posséder"
else
	fail "une identité a été créée pour l'administratrice — §14.6 dit le contraire"
fi

# AUCUN QUOTA N'EST APPLIQUÉ : `CRM-058` seule livrera l'envoi et son décompte. Une valeur non
# nulle ici laisserait croire qu'un garde-fou existe.
if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities where daily_quota <> 0")" = 0 ]; then
	ok "aucun quota n'est prétendu : daily_quota reste à zéro, faute de consommateur"
else
	fail "un quota est affiché alors que rien ne le décompte — CRM-058 n'est pas livrée"
fi

if [ "$RAPIDE" = false ]; then
	if "$SEED" >"$TRAVAIL/seed.log" 2>&1; then
		nb_apres=$(psql_db -c "select count(*) from public.mail_outbound_identities")
		nb_defauts=$(psql_db -c "select count(*) from public.mail_outbound_identities where is_default")
		if [ "$nb_apres" = 2 ] && [ "$nb_defauts" = 2 ]; then
			ok "le seed CONVERGE : un rejeu ne duplique rien et ne perd aucun défaut"
		else
			fail "après rejeu du seed : $nb_apres identités et $nb_defauts défauts — attendu 2 et 2"
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
		if [ "${assertions:-0}" -eq 38 ]; then
			ok "suite pgTAP dédiée — 38 assertions"
		else
			fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 38"
		fi
	else
		fail_journal "la suite pgTAP dédiée ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 7 ]; then
			ok "preuve d'API dédiée — 7 scénarios, secondes moitiés des refus n° 6 et n° 7 comprises"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 7"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_MAIL" >"$TRAVAIL/mail.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 5 ]; then
			ok "preuve mail — 5 scénarios ouvrant de VRAIES sessions SMTP"
		else
			fail "preuve mail verte mais ${passes:-0} scénarios au lieu de 5"
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

	# LE DÉLAI EST LA MESURE QUI COMPTE (décision 318). Le serveur attend dix secondes avant de
	# refuser une authentification : un test réglé plus court rapporterait un mot de passe faux
	# comme un `timeout`, et le diagnostic mentirait. Le contrôle lit la valeur réellement
	# employée par le conteneur, pas celle du gabarit.
	if docker exec p2enjoy-mail-sync python -c \
		'from mail_sync.smtp_probe import DEFAULT_TIMEOUT_SECONDS as d; print(int(d))' \
		>"$TRAVAIL/delai.log" 2>&1 && [ "$(cat "$TRAVAIL/delai.log")" -gt 10 ]; then
		ok "le délai du test SMTP dépasse le délai de pénalité mesuré du serveur (10 s)"
	else
		fail_journal "le délai du test SMTP ne dépasse pas la pénalité de 10 s — décision 318" \
			"$TRAVAIL/delai.log"
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
		"grant select (secret_id) on public.mail_outbound_identities to authenticated" \
		"revoke select (secret_id) on public.mail_outbound_identities from authenticated"

	degradation_sql "l'écriture directe rendue à authenticated — deux chemins d'écriture" \
		"grant insert on public.mail_outbound_identities to authenticated" \
		"revoke insert on public.mail_outbound_identities from authenticated"

	degradation_sql "la voie de sortie du secret ouverte à authenticated — §14.5 rompu" \
		"grant execute on function public.mail_outbound_identity_credentials(uuid) to authenticated" \
		"revoke execute on function public.mail_outbound_identity_credentials(uuid) from authenticated"

	degradation_sql "le trigger d'identité par défaut retiré — deux défauts, ou aucun" \
		"drop trigger if exists mail_outbound_identities_defaut on public.mail_outbound_identities" \
		"create trigger mail_outbound_identities_defaut
		 before insert or update of is_default on public.mail_outbound_identities
		 for each row execute function app.mail_outbound_identities_rabattre_defaut()"

	degradation_sql "la borne de l'adresse d'expédition retirée — le destinataire verrait n'importe quoi" \
		"alter table public.mail_outbound_identities drop constraint mail_outbound_identities_from_address" \
		"alter table public.mail_outbound_identities add constraint mail_outbound_identities_from_address
		 check (char_length(btrim(from_address)) between 3 and 320
		        and btrim(from_address) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+\$')"

	degradation_sql "la contrainte de code d'erreur retirée — un texte de serveur passerait" \
		"alter table public.mail_outbound_identities drop constraint mail_outbound_identities_erreur_code" \
		"alter table public.mail_outbound_identities add constraint mail_outbound_identities_erreur_code
		 check (last_error is null or last_error in ('auth_failed','host_unreachable',
		        'connection_refused','tls_failed','timeout','protocol_error'))"

	degradation_sql "la politique de lecture du propriétaire élargie à tout membre — refus n° 7" \
		"alter policy mail_outbound_identities_lecture_proprietaire on public.mail_outbound_identities
		 using (app.is_workspace_member(workspace_id))" \
		"alter policy mail_outbound_identities_lecture_proprietaire on public.mail_outbound_identities
		 using (owner_id = (select auth.uid()))"

	# La sonde IMAP dégradée : un code hors catalogue doit faire échouer pytest, sans quoi le
	# service écrirait une valeur que la contrainte de la base rejette.
	sauvegarder "$SONDE"
	sed -i 's/^DEFAULT_TIMEOUT_SECONDS = 30.0$/DEFAULT_TIMEOUT_SECONDS = 5.0/' "$SONDE"
	if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/degrade-py.log" 2>&1; then
		fail "dégradation NON VUE : un délai plus court que la pénalité passe les preuves Python"
	else
		ok "dégradation vue : ramener le délai SMTP sous la pénalité fait échouer pytest"
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
