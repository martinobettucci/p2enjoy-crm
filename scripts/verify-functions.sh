#!/usr/bin/env bash
# @verifies CRM-016 (docs/BACKLOG.md) — runtime, route et fonction edge d'exemple
# @verifies docs/SPEC-edge-functions.md §2, §4.1, §5, §6, §7
# @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5 — `JWT_SECRET` au conteneur,
#           remis au SEUL worker `session` (contrôle RÉVISÉ, décision 584)
#
# Le script ne démarre ni ne recrée la pile : `./runDev.sh` doit avoir appliqué la version du
# dépôt. Il exerce les modules purs, la vraie route Kong et l'isolate Deno, puis refuse tout
# warning ou erreur dans les journaux du service.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh

failures=0
checks=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

echo
echo "Preuves de CRM-016 — fonctions edge"
echo

if node_toolchain_prepare "$PWD/.nvmrc"; then
	ok "Node $NODE_TOOLCHAIN_NODE_VERSION / npm $NODE_TOOLCHAIN_NPM_VERSION Linux"
else
	exit 1
fi

status=$(docker inspect -f '{{.State.Status}}' p2enjoy-functions 2>/dev/null || echo absent)
health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sans-sonde{{end}}' \
	p2enjoy-functions 2>/dev/null || echo absent)
if [ "$status" = running ] && [ "$health" = healthy ]; then
	ok "p2enjoy-functions : running / healthy"
else
	fail "p2enjoy-functions : status=$status health=$health (attendu running/healthy)"
fi

image=$(docker inspect -f '{{.Config.Image}}' p2enjoy-functions 2>/dev/null || true)
if [ "$image" = 'public.ecr.aws/supabase/edge-runtime:v1.74.2' ]; then
	ok "image edge-runtime épinglée : v1.74.2"
else
	fail "image du runtime : '$image' (attendu public.ecr.aws/supabase/edge-runtime:v1.74.2)"
fi

command=$(docker inspect -f '{{json .Config.Cmd}}' p2enjoy-functions 2>/dev/null || true)
if [ "$command" = '["start","--policy","oneshot","--main-service","/home/deno/functions/main"]' ]; then
	ok "politique oneshot et service principal explicites"
else
	fail "commande runtime inattendue : $command"
fi

mount=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.RW}}|{{.Source}}{{end}}{{end}}' \
	p2enjoy-functions 2>/dev/null || true)
if [[ "$mount" == false\|*/supabase/functions ]]; then
	ok "sources montées en lecture seule"
else
	fail "montage /home/deno/functions inattendu : '$mount'"
fi

ports=$(docker inspect -f '{{json .HostConfig.PortBindings}}' p2enjoy-functions 2>/dev/null || true)
if [ "$ports" = 'null' ] || [ "$ports" = '{}' ]; then
	ok "aucun port du runtime publié sur l'hôte"
else
	fail "ports hôte inattendus pour functions : $ports"
fi

environment=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' p2enjoy-functions 2>/dev/null || true)
environment_ok=true
for name in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
	if ! printf '%s\n' "$environment" | grep -q "^${name}="; then
		environment_ok=false
	fi
done
if $environment_ok; then
	ok "les trois variables nécessaires sont présentes"
else
	fail "une variable nécessaire manque au runtime"
fi
# RÉVISÉ par `CRM-092` (décisions 584, 586 : le secret du client confidentiel s'y ajoute). CRM-016 exigeait que `JWT_SECRET` n'atteigne pas le runtime ;
# l'échangeur de session doit pourtant signer le jeton interne que PostgREST, Realtime et Storage
# acceptent. La propriété défendue devient : le CONTENEUR reçoit la clé, le service principal ne la
# remet QU'AU worker `session`. La preuve de la répartition est unitaire (`environnement.test.ts`,
# ci-dessous) ; ici, la présence au conteneur et l'emploi effectif de la répartition par `main`.
if printf '%s\n' "$environment" | grep -q '^JWT_SECRET=' \
	&& printf '%s\n' "$environment" | grep -q '^SSO_OIDC_ISSUER=' \
	&& printf '%s\n' "$environment" | grep -q '^SSO_OIDC_CLIENT_ID=' \
	&& printf '%s\n' "$environment" | grep -q '^SSO_OIDC_CLIENT_SECRET=.'; then
	ok "le conteneur reçoit JWT_SECRET et la configuration SSO de l'échangeur, secret du client compris"
else
	fail "JWT_SECRET ou SSO_OIDC_* absents du conteneur : l'échangeur de session ne peut ni échanger ni signer"
fi
if grep -q 'envVars: workerEnvironment(route.functionName)' supabase/functions/main/index.ts \
	&& grep -q 'return environnementDe(functionName' supabase/functions/main/index.ts \
	&& ! grep -q 'Deno.env.toObject' supabase/functions/main/index.ts; then
	ok "le service principal remet à chaque worker l'environnement de SA fonction, et rien d'autre"
else
	fail "le service principal ne passe plus par environnementDe : JWT_SECRET pourrait atteindre toute fonction"
fi

revision=$(docker inspect -f '{{index .Config.Labels "com.p2enjoy.kong-config-revision"}}' \
	p2enjoy-kong 2>/dev/null || true)
if [ "$revision" = crm-016 ]; then
	ok "Kong exécute la révision déclarative crm-016"
else
	fail "révision Kong active : '$revision' (attendu crm-016 ; relancer ./runDev.sh)"
fi

if docker compose -f docker-compose.yml -f docker-compose.prod.yml config --services \
	| grep -qx functions; then
	ok "functions appartient aussi à l'assemblage de production"
else
	fail "functions absent de l'assemblage de production"
fi

# Bornés aux fichiers de CRM-016 et au service principal : les tests de l'échangeur (`session/`)
# sont comptés par `scripts/verify-session-sso.sh`. 6 d'origine, plus les 5 de l'environnement par
# fonction (CRM-092) = 11, valeur COMPTÉE.
if npm run --silent test:unit -- ../supabase/functions/main ../supabase/functions/example >"$WORK/unit.log" 2>&1 \
	&& grep -qE 'Tests +11 passed' "$WORK/unit.log"; then
	ok "11 tests unitaires du routeur, de l'environnement par fonction et du handler d'exemple"
else
	fail "tests unitaires edge en échec ou compte différent de 11"
	sed 's/^/        /' "$WORK/unit.log" | tail -n 20
fi

if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
	e2e/api/functions.spec.ts >"$WORK/api.log" 2>&1 \
	&& grep -qE '6 passed' "$WORK/api.log"; then
	ok "6 scénarios API par la vraie passerelle"
else
	fail "scénarios API edge en échec ou compte différent de 6"
	sed 's/^/        /' "$WORK/api.log" | tail -n 25
fi

# La terminaison murale fautive est différée jusqu'à la borne de 10 secondes. Lire les journaux
# immédiatement reproduirait le faux vert qui a précédé la décision 286.
sleep 11
docker logs p2enjoy-functions >"$WORK/functions.log" 2>&1 || true
if grep -Eqi 'warning|error|panic|early termination|wall clock' "$WORK/functions.log"; then
	fail "les journaux du runtime portent un warning ou une erreur"
	sed 's/^/        /' "$WORK/functions.log" | tail -n 20
else
	ok "journaux runtime sans warning, erreur, panic ni terminaison d'isolate"
fi

echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1
