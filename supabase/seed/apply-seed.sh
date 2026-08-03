#!/usr/bin/env bash
# @spec CRM-005 (docs/BACKLOG.md) — seed socle : comptes, espace de travail, rôles
# @spec docs/SPEC-seed.md §2 (contrat), §3 (mécanismes mesurés), §4 (identifiants), §5 (gardes)
# @spec docs/SCHEMA.md §1 (identité et cloisonnement)
# @spec docs/SPEC-permissions-rls.md §2.1 (rôles de workspace)
# @spec docs/DAT.md §11 (données de développement) ; README.md §5 et §8
#
# Applique le seed socle sur la pile de développement en cours d'exécution.
#
# Rien n'est écrit en SQL direct : les comptes naissent de l'API d'administration GoTrue, les
# profils du trigger de `CRM-003`, l'espace de travail et les appartenances de l'API REST
# (docs/JOURNAL.md décision 32). Un seed qui contournerait le produit ne prouverait rien du
# produit.
#
# Le script CONVERGE : il est rejouable sans erreur ni doublon, et rattrape une dérive. Il ne
# détruit jamais rien — la destruction appartient à `resetMe.sh`, qui porte ses propres gardes.
#
# GARDE PRINCIPALE : il refuse tout profil d'environnement autre que `dev`. Les mots de passe
# qu'il pose sont publiés dans ce dépôt.
#
# Usage :
#   supabase/seed/apply-seed.sh
#   supabase/seed/apply-seed.sh --help

set -euo pipefail

# shellcheck source=../../scripts/lib/env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/env.sh"

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--help|-h) usage; exit 0 ;;
		*)         die "option inconnue « $1 ». Voir supabase/seed/apply-seed.sh --help." ;;
	esac
	shift
done

# --- Gardes ------------------------------------------------------------------------------------

env_validate
env_require_profile dev

KONG_HTTP_PORT=$(env_get "$ENV_FILE" KONG_HTTP_PORT)
SERVICE_ROLE_KEY=$(env_get "$ENV_FILE" SERVICE_ROLE_KEY)
ANON_KEY=$(env_get "$ENV_FILE" ANON_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

command -v curl >/dev/null 2>&1 || die "curl est introuvable : le seed passe par l'API."
command -v jq   >/dev/null 2>&1 || die "jq est introuvable : le seed lit des réponses JSON."

# La pile doit tourner. Sans elle le seed ne peut qu'échouer, et il doit le dire plutôt que
# réussir à moitié (docs/SPEC-seed.md §5).
if ! curl -sf -o /dev/null "$API/auth/v1/health" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"; then
	die "l'API ne répond pas sur $API. Lancez ./runDev.sh, puis relancez le seed."
fi

# --- Contrat du seed — docs/SPEC-seed.md §2 ----------------------------------------------------
# Toute valeur ci-dessous est le contrat opposable au code. Elle ne se déduit d'aucune exécution :
# elle est écrite ici et dans `docs/SPEC-seed.md`, et `scripts/verify-seed.sh` la vérifie.

WS_ID='5eed0000-0000-4000-8000-000000000001'
WS_NAME='P2Enjoy SAS'
WS_SLUG='p2enjoy'
WS_DOMAIN='crm.p2enjoy.test'

# Mot de passe de développement, volontairement à 16 caractères. Ce n'est pas un secret : le §2.3
# de la spécification explique pourquoi il est publié, et pourquoi cela reste acceptable.
#
# Il satisfait `PASSWORD_MIN_LENGTH` par choix, non par contrainte : l'API d'administration ne
# l'applique pas (docs/SPEC-seed.md §3.5, INC-018). `scripts/verify-seed.sh` le prouve.
SEED_PASSWORD='SeedDev2026Local'

# id | email | nom affiché | rôle de workspace
COMPTES=(
	'5eed0000-0000-4000-8000-000000000011|admin@p2enjoy.test|Camille Aubert|admin'
	'5eed0000-0000-4000-8000-000000000012|bizdev@p2enjoy.test|Driss Lemoine|business_developer'
	'5eed0000-0000-4000-8000-000000000013|viewer@p2enjoy.test|Farida Nowak|viewer'
)

# --- Accès à l'API -----------------------------------------------------------------------------

CORPS=$(mktemp)
trap 'rm -f "$CORPS"' EXIT

# Rend le code HTTP sur la sortie standard ; le corps de la réponse est dans $CORPS.
api() {
	local method=$1 chemin=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$API$chemin" \
		-H "apikey: $SERVICE_ROLE_KEY" \
		-H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		-H 'Content-Type: application/json' \
		"$@"
}

# Échoue bruyamment plutôt que de poursuivre sur un état partiel. Un seed qui continue après une
# erreur laisse une base à moitié peuplée, plus trompeuse qu'une base vide.
attendu() {
	local code=$1 libelle=$2
	shift 2
	for voulu in "$@"; do
		[ "$code" = "$voulu" ] && return 0
	done
	die "$libelle : code HTTP $code, attendu $*.
        Réponse : $(head -c 400 "$CORPS")"
}

compte_id_par_email() {
	curl -s "$API/auth/v1/admin/users?page=1&per_page=200" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		| jq -r --arg m "$1" '.users[]? | select(.email == $m) | .id' | head -n 1
}

say "Application du seed socle — docs/SPEC-seed.md"
info "Cible : $API"
info "Profil d'environnement : dev (vérifié)"

# --- 1. Espace de travail ----------------------------------------------------------------------
# Upsert natif de PostgREST : `resolution=merge-duplicates` a été mesuré comme un véritable upsert
# (docs/JOURNAL.md décision 34). Une ligne modifiée à la main est donc rétablie, pas dupliquée.

echo
say "1. Espace de travail"

code=$(api POST /rest/v1/workspaces \
	-H 'Prefer: return=representation,resolution=merge-duplicates' \
	-d "$(jq -nc --arg id "$WS_ID" --arg name "$WS_NAME" --arg slug "$WS_SLUG" \
	              --arg domaine "$WS_DOMAIN" \
	     '{id: $id, name: $name, slug: $slug, inbound_domain: $domaine, settings: {}}')")
attendu "$code" "création de l'espace de travail $WS_SLUG" 200 201
info "$WS_NAME ($WS_SLUG) — $WS_ID"

# --- 2. Comptes, profils et appartenances ------------------------------------------------------

echo
say "2. Comptes, profils et appartenances"

for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom role <<< "$ligne"

	# 2.a. Le compte. Recréer une adresse existante est refusé en `422 email_exists` : la présence
	#      est donc testée avant la création, jamais rattrapée après coup (décision 34).
	existant=$(compte_id_par_email "$email")

	if [ -z "$existant" ]; then
		code=$(api POST /auth/v1/admin/users \
			-d "$(jq -nc --arg id "$id" --arg email "$email" --arg mdp "$SEED_PASSWORD" \
			              --arg nom "$nom" \
			     '{id: $id, email: $email, password: $mdp, email_confirm: true,
			       user_metadata: {full_name: $nom, locale: "fr"}}')")
		attendu "$code" "création du compte $email" 200 201
		etat='créé'
	else
		[ "$existant" = "$id" ] || die "le compte $email existe avec l'identifiant $existant,
        alors que le contrat du seed impose $id. Le seed ne détruit rien : réinitialisez la base
        avec ./resetMe.sh, ou corrigez ce compte à la main (docs/SPEC-seed.md §4)."

		# Le mot de passe est réaligné sur le contrat : sans cela, un compte dont le mot de passe
		# a été changé pendant une session de développement cesserait silencieusement de servir
		# aux preuves et aux tests.
		code=$(api PUT "/auth/v1/admin/users/$id" \
			-d "$(jq -nc --arg mdp "$SEED_PASSWORD" --arg nom "$nom" \
			     '{password: $mdp, email_confirm: true,
			       user_metadata: {full_name: $nom, locale: "fr"}}')")
		attendu "$code" "mise à jour du compte $email" 200
		etat='mis à jour'
	fi

	# 2.b. Le profil. Il naît du trigger de `CRM-003` — le seed n'en crée aucun. En revanche il le
	#      CONVERGE explicitement : mettre à jour `user_metadata` ne met pas à jour le profil, le
	#      trigger étant `AFTER INSERT` et portant `on conflict do nothing` (décision 34). Sans ce
	#      PATCH, une dérive du nom affiché ne serait jamais rattrapée.
	code=$(api PATCH "/rest/v1/profiles?id=eq.$id" \
		-H 'Prefer: return=representation' \
		-d "$(jq -nc --arg nom "$nom" '{full_name: $nom, locale: "fr"}')")
	attendu "$code" "convergence du profil de $email" 200
	[ "$(jq 'length' "$CORPS")" -eq 1 ] \
		|| die "aucun profil pour $email après création du compte : le trigger de CRM-003
        (app.handle_new_user) ne s'est pas déclenché. La base n'est pas dans l'état attendu."

	# 2.c. L'appartenance, et donc le rôle. Upsert : la clé primaire est composite, et deux
	#      passages laissent une seule ligne (mesuré, décision 34).
	code=$(api POST /rest/v1/workspace_members \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$(jq -nc --arg ws "$WS_ID" --arg u "$id" --arg r "$role" \
		     '{workspace_id: $ws, user_id: $u, role: $r}')")
	attendu "$code" "appartenance de $email au workspace" 200 201

	printf '  %-22s %-20s %s\n' "$email" "$role" "$etat"
done

# --- 3. Ce que le seed ne rend PAS visible -----------------------------------------------------
# Rappel volontaire, affiché à chaque exécution : peupler la base ne la rend pas lisible. Les
# tables du socle sont en refus par défaut depuis `CRM-003` — RLS activée, aucune politique — et
# le seed ne pose surtout aucune politique pour « rendre l'application utilisable ». Les
# politiques sont l'objet de `CRM-012`.

echo
say "Seed appliqué"
info "Espace de travail : $WS_NAME ($WS_SLUG)"
info "Comptes : ${#COMPTES[@]}, un par rôle — mot de passe commun publié dans docs/SPEC-seed.md §2.3"
echo
warn "Les données seedées ne sont PAS lisibles par l'API avec un jeton d'utilisateur :"
warn "les tables du socle restent en refus par défaut jusqu'à CRM-012 (aucune politique RLS)."
info "Preuves du seed : scripts/verify-seed.sh"
