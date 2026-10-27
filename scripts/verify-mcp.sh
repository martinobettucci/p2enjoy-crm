#!/usr/bin/env bash
# @verifies CRM-102 (docs/BACKLOG.md) — tranche T3 : le harnais du connecteur MCP
# @verifies docs/SPEC-mcp.md §2 (service, profil, hôte dédié aiguillé par Caddy), §3 (mandataire OAuth, connexion longue),
#           §4 (admission), §5 (jeton interne, RLS), §6 (matrice), §7 (registre), §11 (sondes), §13 (preuves attendues) ;
#           docs/SCHEMA.md §9 quinquies ; docs/DESIGN_SYSTEM.md §5.57 ; CLAUDE.md §15, §18 (preuves non complaisantes)
# @verifies CRM-108 (docs/BACKLOG.md) — tranche T4 : la traçabilité accepte les modules de la famille `recettes`
#           (docs/SPEC-recettes.md §7)
# @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.a : la traçabilité accepte les modules de la famille `affaires`, et
#           l'intégration rejoue ses sept outils de lecture (docs/SPEC-mcp.md §9.2 bis, §13)
# @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : l'intégration rejoue les trois outils de la famille `messagerie`
#           (docs/SPEC-mcp.md §9.2 decies, §13)
# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.a : la traçabilité accepte les modules de la famille `workflows`, et
#           l'intégration rejoue ses dix outils (docs/SPEC-mcp.md §9.2 undecies, §13)
#
# Rejoue les preuves du connecteur sur la pile de développement, puis DÉGRADE réellement le code, la base et l'aiguillage,
# et exige que les preuves rougissent, avant de restaurer et de CONSTATER la restauration.
#
#   1. traçabilité : chaque fichier de l'unité porte son `@spec` ou son `@verifies` ;
#   2. le registre, MESURÉ : trois tables fermées, huit fonctions `SECURITY DEFINER` — quatre du registre, quatre de
#      l'administration (`CRM-103` T1) —, privilèges exacts, et la clé de la matrice vers les profils (D9) ;
#   3. le service : sain, prêt (`/pret` : SSO et CRM), `401` et métadonnées sans jeton ;
#   4. les suites : pgTAP 0085, pytest unitaires (image `dev`) ;
#   5. l'intégration OAuth contre le vrai Keycloak et la vraie base — en direct, puis À TRAVERS un Caddy de la cellule
#      (`Caddyfile.spark` et `routes.caddy`), joint par l'hôte du connecteur : aiguillage, chemins intacts, réponses en
#      flux à travers `encode` ;
#   6. l'interface : un vrai client MCP dans le navigateur (`e2e/ui/connecteur-mcp.spec.ts`) ;
#   7. dégradations : la matrice non consultée (code), le registre fermé au service (base), un Caddy sans hôte (aiguillage),
#      chacune rouge, puis la restauration constatée.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), service `mcp` compris. Les secrets lus
# dans `.env` ne sont jamais affichés : ils passent par un fichier en 600, effacé à la sortie.
#
# Usage :
#   scripts/verify-mcp.sh             tout
#   scripts/verify-mcp.sh --rapide    sans la preuve Playwright, et le dit
#   scripts/verify-mcp.sh --help

set -euo pipefail
cd "$(dirname "$0")/.."

# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
# @verifies CRM-115 (docs/BACKLOG.md) tranche T5 — le réseau et les volumes de la pile dérivés de son projet (`projet_pile`),
#           jamais ceux de l'emplacement 0 écrits en dur (docs/SPEC-pile-par-session.md §9)
# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RAPIDE=false
for argument in "$@"; do
	case "$argument" in
		--rapide) RAPIDE=true ;;
		--help | -h)
			sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
			exit 0
			;;
		*)
			echo "option inconnue : $argument" >&2
			exit 2
			;;
	esac
done

checks=0
failures=0
ok() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
valeur() { sed -n "s/^$1=//p" .env | tail -n 1; }

RESEAU="$(projet_pile)_default"
IMAGE=crm-mcp:dev
CADDY="$(projet_pile)-verif-mcp-caddy"  # par emplacement (CRM-115 T5)
HOTE_CADDY=crm.mcp.exemple.test
SIGNATURE_ETAT='public.mcp_etat_compte(uuid, boolean)'
TRAVAIL=$(mktemp -d)
chmod 700 "$TRAVAIL"
psql_base() { docker exec -i "$(conteneur db)" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
nettoyer() {
	psql_base -c "grant execute on function $SIGNATURE_ETAT to service_role" >/dev/null 2>&1 || true
	docker rm -f "$CADDY" >/dev/null 2>&1 || true
	rm -rf "$TRAVAIL"
}
trap nettoyer EXIT

empreinte() {
	psql_base -c "select md5(string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid)
	                || (select string_agg(r || ':' || has_function_privilege(r, p.oid, 'execute')::text, ',' order by r)
	                      from unnest(array['anon', 'authenticated', 'service_role']) r), '|' order by p.oid::regprocedure::text))
	                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	               where n.nspname = 'public' and p.proname like 'mcp\_%'"
}

# L'environnement des preuves d'intégration : les clés de la pile, jamais affichées.
ENV_INTEGRATION="$TRAVAIL/integration.env"
(
	umask 077
	{
		printf 'CRM_MCP_INTEGRATION=1\nCRM_MCP_URL=http://mcp:8080\nSUPABASE_URL=http://kong:8000\n'
		printf 'CRM_MCP_ORIGINE=http://localhost:%s\n' "$(valeur MCP_DEV_PORT)"
		printf 'SSO_OIDC_ISSUER=%s\nSSO_OIDC_CLIENT_ID=%s\n' "$(valeur SSO_OIDC_ISSUER)" "$(valeur SSO_OIDC_CLIENT_ID)"
		printf 'SSO_DEV_ADMIN_PASSWORD=%s\nSITE_URL=%s\n' "$(valeur SSO_DEV_ADMIN_PASSWORD)" "$(valeur SITE_URL)"
		printf 'SUPABASE_SERVICE_ROLE_KEY=%s\nDOMAINE=%s\n' "$(valeur SERVICE_ROLE_KEY)" "$(valeur MAIL_DEV_PERSONAL_DOMAIN)"
	} >"$ENV_INTEGRATION"
)
integration() { # integration <url du connecteur> [arguments pytest…]
	local url=$1
	shift
	docker run --rm --network "$RESEAU" --env-file "$ENV_INTEGRATION" -e CRM_MCP_URL="$url" "$IMAGE" \
		python -m pytest -q -p no:cacheprovider tests/test_integration_oauth.py tests/test_integration_recettes.py tests/test_integration_affaires.py tests/test_integration_affaires_ecriture.py tests/test_integration_structure.py tests/test_integration_contacts.py tests/test_integration_organisations.py tests/test_integration_budgets.py tests/test_integration_temps.py tests/test_integration_objectifs.py tests/test_integration_messagerie.py tests/test_integration_workflows.py tests/test_integration_droits_fins.py "$@" >"$TRAVAIL/integration.log" 2>&1
}
caddy_de_la_cellule() { # caddy_de_la_cellule [hôte du connecteur]
	docker rm -f "$CADDY" >/dev/null 2>&1 || true
	docker run -d --name "$CADDY" --network "$RESEAU" --network-alias "$HOTE_CADDY" \
		${1:+-e MCP_HOTE="$1"} \
		-v "$PWD/caddy/Caddyfile.spark:/etc/caddy/Caddyfile:ro,z" -v "$PWD/caddy/routes.caddy:/etc/caddy/routes.caddy:ro,z" \
		caddy:2.9-alpine >/dev/null
	for _ in $(seq 1 20); do
		# Toute réponse HTTP dit que Caddy sert : sans webapp montée, la racine rend un 404, et c'est attendu. La sortie est
		# lue d'abord : sous `pipefail`, le statut d'erreur de `wget` sur ce 404 l'emporterait sur celui de `grep`.
		local sortie
		sortie=$(docker exec "$CADDY" wget -S -q -O /dev/null "http://127.0.0.1:8080/" 2>&1 || true)
		grep -q 'HTTP/' <<<"$sortie" && return 0
		sleep 0.5
	done
	return 1
}

printf '\033[1mPreuves de CRM-102 — le connecteur MCP\033[0m\n'

titre '1. Traçabilité'
while IFS= read -r fichier; do
	# Un fichier du connecteur cite son unité : `CRM-102` pour le socle, `CRM-103` pour le seed du connecteur
	# (docs/SPEC-seed.md §22), `CRM-108` pour la famille `recettes` (docs/SPEC-recettes.md §7), `CRM-104` pour les familles
	# de son catalogue (docs/SPEC-mcp.md §9.2 bis), qui y ajoutent leurs propres modules sans les rattacher au socle.
	if head -8 "$fichier" | grep -Eq '@(spec|verifies) CRM-(10[2348]|11[489])'; then ok "$fichier cite son unité (CRM-102, CRM-103, CRM-104, CRM-108, CRM-114, CRM-118 ou CRM-119)"; else fail "$fichier ne cite ni CRM-102, ni CRM-103, ni CRM-104, ni CRM-108, ni CRM-114, ni CRM-118, ni CRM-119"; fi
done < <(
	find mcp -type f \( -name '*.py' -o -name 'Dockerfile' -o -name '*.toml' -o -name '*.lock' \) | sort
	printf '%s\n' supabase/migrations/0090_connecteur_mcp.sql supabase/tests/0085_connecteur_mcp.test.sql \
		e2e/mcp/client.ts e2e/ui/connecteur-mcp.spec.ts
)

titre '2. Le registre, mesuré'
[ "$(psql_base -c "select count(*) from pg_class where oid in ('public.mcp_comptes'::regclass, 'public.mcp_droits'::regclass, 'public.mcp_journal'::regclass) and relrowsecurity")" = 3 ] \
	&& ok 'RLS activée sur les trois tables du registre' || fail 'RLS absente d’une table du registre'
[ "$(psql_base -c "select count(*) from pg_policies where tablename like 'mcp\_%'")" = 0 ] \
	&& ok 'aucune politique : le registre est fermé à l’API' || fail 'une politique ouvre le registre'
[ "$(psql_base -c "select bool_or(has_table_privilege(r, t, p))::text from unnest(array['anon','authenticated']) r, unnest(array['public.mcp_comptes','public.mcp_droits','public.mcp_journal']) t, unnest(array['select','insert','update','delete']) p")" = false ] \
	&& ok 'aucun privilège client sur le registre' || fail 'un rôle client garde un privilège sur le registre'
[ "$(psql_base -c "select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'mcp\_%' and p.prosecdef and p.proconfig @> array['search_path=\"\"'] and not has_function_privilege('anon', p.oid, 'execute')")" = 'mcp_autorise:true:false,mcp_compte:true:true,mcp_comptes_liste:true:true,mcp_etat_compte:false:true,mcp_inscrire_compte:false:true,mcp_journal_liste:true:true,mcp_journaliser:false:true,mcp_poser_droits:true:true' ] \
	&& ok 'mcp_autorise pour authenticated seul, les trois RPC du registre pour service_role seul, les quatre d’administration pour authenticated (service_role par défaut, comme les plateforme_*), gardées par le drapeau' \
	|| fail 'une fonction mcp_* s’écarte de sa forme ou de ses privilèges'
[ "$(psql_base -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'mcp_droits_sub_fkey'")" = 'FOREIGN KEY (sub) REFERENCES profiles(id) ON DELETE CASCADE' ] \
	&& ok 'la matrice vise le profil, en cascade (CRM-103, D9)' || fail 'la clé de mcp_droits.sub ne vise pas les profils'

titre '3. Le service'
ORIGINE="http://localhost:$(valeur MCP_DEV_PORT)"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$(conteneur mcp)" 2>/dev/null)" = healthy ] \
	&& ok 'conteneur du service mcp sain' || fail 'conteneur du service mcp absent ou malade (./runDev.sh)'
[ "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGINE/pret")" = 200 ] \
	&& ok '/pret : SSO et CRM joignables' || fail "/pret : $(curl -s "$ORIGINE/pret")"
curl -s -D "$TRAVAIL/entetes" -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "$ORIGINE/mcp"
grep -qi "resource_metadata=\"$ORIGINE/.well-known/oauth-protected-resource/mcp\"" "$TRAVAIL/entetes" \
	&& ok '/mcp sans jeton : 401 et resource_metadata' || fail '/mcp sans jeton : en-tête WWW-Authenticate inattendu'

titre '4. Les suites'
scripts/run-sql-tests.sh supabase/tests/0085_connecteur_mcp.test.sql >/dev/null 2>&1 \
	&& ok 'pgTAP : 0085_connecteur_mcp verte' || fail 'pgTAP : 0085_connecteur_mcp rouge'
# RÉVISÉ LE 2026-10-25 (décision 704, INC-309) : derrière un proxy TLS interposé, l'étape `dev` ne pouvait pas
# installer ses dépendances — mesuré « SSLCertVerificationError » sur `pip install`, puis « pull access denied for
# crm-mcp » à chaque `docker run`. Le secret de construction `pip_ca` est transmis quand `PIP_CA_FILE` (environnement,
# sinon `.env`) désigne un fichier, comme le documente `mcp/Dockerfile` et comme le fait Compose (décision 356).
ca_pip=${PIP_CA_FILE:-$(sed -n 's/^PIP_CA_FILE=//p' .env 2>/dev/null | tail -n 1 | tr -d "\"'\r")}
secret_ca=()
[ -n "$ca_pip" ] && [ -s "$ca_pip" ] && secret_ca=(--secret "id=pip_ca,src=$ca_pip")
if docker build -q "${secret_ca[@]}" --target dev -t "$IMAGE" mcp >/dev/null 2>&1; then
	docker run --rm "$IMAGE" python -m pytest -q -p no:cacheprovider >"$TRAVAIL/unitaires.log" 2>&1 \
		&& ok "pytest unitaires : $(tail -n 1 "$TRAVAIL/unitaires.log")" || fail "pytest unitaires rouges : $(tail -n 1 "$TRAVAIL/unitaires.log")"
else
	fail 'image dev du connecteur : construction impossible'
fi

titre '5. Intégration contre le vrai Keycloak et la vraie base'
integration http://mcp:8080 && ok "en direct : $(tail -n 1 "$TRAVAIL/integration.log")" \
	|| fail "en direct : $(grep -E 'FAILED|passed|failed' "$TRAVAIL/integration.log" | tail -n 3 | tr '\n' ' ')"
if caddy_de_la_cellule "$HOTE_CADDY"; then
	integration "http://$HOTE_CADDY:8080" && ok "à travers le Caddy de la cellule, par l’hôte du connecteur : $(tail -n 1 "$TRAVAIL/integration.log")" \
		|| fail "à travers Caddy : $(grep -E 'FAILED|passed|failed' "$TRAVAIL/integration.log" | tail -n 3 | tr '\n' ' ')"
	statut=$(docker run --rm --network "$RESEAU" "$IMAGE" python -c "import httpx2; print(httpx2.get('http://$HOTE_CADDY:8080/.well-known/oauth-authorization-server', headers={'Host': 'crm.exemple.test'}).status_code)")
	[ "$statut" = 404 ] && ok 'sur l’hôte de l’application, les métadonnées OAuth restent un 404 (décision 589)' \
		|| fail "l’hôte de l’application rend $statut pour les métadonnées OAuth, 404 attendu"
else
	fail 'Caddy de la cellule : démarrage impossible'
fi

titre '6. Interface'
if [ "$RAPIDE" = true ]; then
	printf '  \033[33mOMIS\033[0m  preuve Playwright : --rapide\n'
else
	npm run e2e:ui -- e2e/ui/connecteur-mcp.spec.ts >"$TRAVAIL/ui.log" 2>&1 \
		&& ok "interface : $(grep -E 'passed' "$TRAVAIL/ui.log" | tail -n 1 | sed 's/^ *//')" || fail 'interface : e2e/ui/connecteur-mcp.spec.ts rouge'
fi

titre '7. Dégradations réelles, puis restauration constatée'
# a. Le code : la politique cesse de consulter `mcp_autorise`.
cp -r mcp/crm_mcp "$TRAVAIL/mutant"
python3 - "$TRAVAIL/mutant/politique.py" <<'PY'
import sys
chemin = sys.argv[1]
texte = open(chemin, encoding='utf-8').read()
motif = "                if await self.autorise(appel.jeton, espace, famille, action):"
if texte.count(motif) != 1:
    sys.exit("motif introuvable")
open(chemin, 'w', encoding='utf-8').write(texte.replace(motif, "                if True or await self.autorise(appel.jeton, espace, famille, action):"))
PY
if docker run --rm -v "$TRAVAIL/mutant:/app/crm_mcp:ro" "$IMAGE" python -m pytest -q -p no:cacheprovider >/dev/null 2>&1; then
	fail 'la matrice non consultée : les unitaires restent verts — ils ne mordent pas'
else
	ok 'la matrice non consultée : les unitaires rougissent'
fi

# b. La base : le service perd la lecture de l'état des comptes.
AVANT=$(empreinte)
psql_base -c "revoke execute on function $SIGNATURE_ETAT from service_role" >/dev/null
if integration http://mcp:8080 -k superadministratrice; then
	fail 'registre fermé au service : l’intégration reste verte'
else
	ok 'registre fermé au service : l’intégration rougit (aucun outil n’est plus visible)'
fi
psql_base -c "grant execute on function $SIGNATURE_ETAT to service_role" >/dev/null
[ "$AVANT" = "$(empreinte)" ] && ok "restauration constatée : empreinte des fonctions mcp_* identique ($AVANT)" \
	|| fail 'la restauration n’a pas rendu les privilèges d’avant'
integration http://mcp:8080 -k superadministratrice && ok 'l’intégration est verte après restauration' \
	|| fail 'l’intégration reste rouge après restauration'

# c. L'aiguillage : un Caddy sans hôte du connecteur ne doit plus rien lui relayer.
if caddy_de_la_cellule ""; then
	if integration "http://$HOTE_CADDY:8080" -k metadonnees; then
		fail 'Caddy sans MCP_HOTE : l’intégration passe encore — elle ne traverse pas l’aiguillage'
	else
		ok 'Caddy sans MCP_HOTE : rien n’est relayé au connecteur, l’intégration rougit (témoin de l’aiguillage)'
	fi
else
	fail 'Caddy sans MCP_HOTE : démarrage impossible (le repli mcp.invalid ne tient pas)'
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
