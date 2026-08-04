#!/usr/bin/env bash
# @spec CRM-005 (docs/BACKLOG.md) — seed socle : comptes, espace de travail, rôles
# @spec CRM-020 (docs/BACKLOG.md) — tracks de démonstration, dont un archivé
# @spec CRM-021 (docs/BACKLOG.md) — channels de démonstration, dont un archivé
# @spec CRM-030 (docs/BACKLOG.md) — catalogue de nœuds de démonstration, dont un archivé
# @spec docs/SPEC-seed.md §2 (contrat), §3 (mécanismes mesurés), §4 (identifiants), §5 (gardes)
# @spec docs/SPEC-tracks.md §8 (seed des tracks) ; docs/SPEC-channels.md §8 (seed des channels)
# @spec docs/SPEC-workflow-engine.md §2.9 (catalogue initial livré par le seed)
# @spec docs/SCHEMA.md §1 (identité et cloisonnement), §2 (organisation), §3 (workflows)
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

# Tracks du workspace — docs/SPEC-tracks.md §8.
#
# Le quatrième est **archivé** : sans lui, l'état « archivé » serait documenté sans être
# démontrable, ce que `CLAUDE.md` §8 refuse (« couvrir les principaux états »). Les couleurs
# emploient quatre des cinq jetons du design system ; `danger` reste libre, aucune activité ne se
# décrivant honnêtement comme « en danger » par défaut.
#
# `position` est écrite explicitement plutôt que laissée au trigger : le seed est un **contrat**
# opposable, et un ordre attribué par un effet de bord ne serait pas reproductible si l'ordre des
# insertions changeait. Le trigger reste éprouvé par la suite pgTAP et par les scénarios d'API.
#
# id | slug | nom | couleur | icône | position | date d'archivage (ou « - »)
TRACKS=(
	'5eed0000-0000-4000-8000-000000000021|conseil-ia|Conseil & IA|brand|sparkles|1|-'
	'5eed0000-0000-4000-8000-000000000022|studio-web|Studio web|success|layout-dashboard|2|-'
	'5eed0000-0000-4000-8000-000000000023|formation|Formation|accent|graduation-cap|3|-'
	'5eed0000-0000-4000-8000-000000000024|pipeline-2024|Pipeline 2024|neutral|archive|4|2026-01-15T09:00:00Z'
)

# Channels des tracks actifs — docs/SPEC-channels.md §8.
#
# Trois tracks actifs sur quatre en portent ; `formation` n'en porte qu'**un**, ce qui donne une
# barre à un seul onglet — un cas d'affichage réel, distinct de la barre vide. Le track archivé
# `pipeline-2024` n'en porte **aucun** : un track masqué n'a pas à démontrer une barre d'onglets.
#
# `appels-offres` est **archivé**, pour que l'état le soit aussi côté channels et non seulement
# documenté (`CLAUDE.md` §8).
#
# `workflow_id` est laissé **nul** partout : c'est l'état réel du produit jusqu'à `CRM-031`
# (INC-029). Le seed ne fabrique pas une donnée que le modèle ne sait pas encore produire.
#
# `position` est écrite explicitement, pour le même motif que les tracks : un ordre attribué par
# effet de bord ne serait pas reproductible si l'ordre des insertions changeait.
#
# id | track | slug | nom | position | date d'archivage (ou « - »)
CHANNELS=(
	'5eed0000-0000-4000-8000-000000000031|5eed0000-0000-4000-8000-000000000021|prospection|Prospection|1|-'
	'5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000021|grands-comptes|Grands comptes|2|-'
	"5eed0000-0000-4000-8000-000000000033|5eed0000-0000-4000-8000-000000000021|appels-offres|Appels d'offres|3|2026-02-01T09:00:00Z"
	'5eed0000-0000-4000-8000-000000000034|5eed0000-0000-4000-8000-000000000022|refonte|Refonte de site|1|-'
	'5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000022|maintenance|Maintenance|2|-'
	'5eed0000-0000-4000-8000-000000000036|5eed0000-0000-4000-8000-000000000023|inter-entreprises|Inter-entreprises|1|-'
)

# Catalogue de nœuds du workspace — docs/SPEC-workflow-engine.md §2.9.
#
# Les sept nœuds du tableau de la spécification, plus **un huitième archivé** : sans lui, l'état
# « archivé » du catalogue serait documenté sans être démontrable, ce que `CLAUDE.md` §8 refuse.
# C'est le même choix qu'un track archivé pour `CRM-020` et un channel archivé pour `CRM-021`.
#
# Les couleurs emploient les **cinq** jetons du design system : les deux nœuds terminaux prennent
# `success` et `danger`, dont c'est exactement le sens (`docs/DESIGN_SYSTEM.md` §1), `relance` prend
# `accent`, et `prospection` reste `neutral` — un début d'affaire ne porte aucun jugement.
#
# Le seuil de relance est **nul** pour les deux nœuds terminaux : une affaire livrée ou perdue
# n'est pas en retard. La contrainte de la migration refuserait un zéro, qui signalerait toute card
# dès son arrivée.
#
# `position` est écrite explicitement, pour le même motif que les tracks et les channels : un ordre
# attribué par effet de bord ne serait pas reproductible si l'ordre des insertions changeait. Le
# trigger reste éprouvé par la suite pgTAP et par les scénarios d'API.
#
# id | clé | libellé | type | couleur | probabilité (ou « - ») | seuil en jours (ou « - ») |
#    position | date d'archivage (ou « - »)
NOEUDS=(
	'5eed0000-0000-4000-8000-000000000041|prospection|Prospection|open|neutral|10|14|1|-'
	'5eed0000-0000-4000-8000-000000000042|relance|Relance|open|accent|20|7|2|-'
	'5eed0000-0000-4000-8000-000000000043|negociation|Négociation|open|brand|50|10|3|-'
	'5eed0000-0000-4000-8000-000000000044|signature|Signature|open|brand|90|7|4|-'
	'5eed0000-0000-4000-8000-000000000045|realisation|Réalisation|open|success|100|30|5|-'
	'5eed0000-0000-4000-8000-000000000046|livre|Livré|won|success|100|-|6|-'
	'5eed0000-0000-4000-8000-000000000047|perdu|Perdu|lost|danger|0|-|7|-'
	'5eed0000-0000-4000-8000-000000000048|qualification|Qualification|open|neutral|5|21|8|2026-03-01T09:00:00Z'
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

# --- 3. Tracks — docs/SPEC-tracks.md §8 --------------------------------------------------------
# Créés par la véritable API REST avec la clé de service, comme le workspace et les appartenances
# (docs/JOURNAL.md décision 32) : le seed ne parle jamais SQL à la place du produit.
#
# `resolution=merge-duplicates` : l'écriture est **convergente**. Un track renommé à la main pendant
# une session de développement est rétabli au contrat, pas dupliqué — mesuré par `CRM-005`
# (décision 34), et l'upsert porte ici sur la clé primaire `id`.

echo
say "3. Tracks"

for ligne in "${TRACKS[@]}"; do
	IFS='|' read -r id slug nom couleur icone position archive <<< "$ligne"

	if [ "$archive" = '-' ]; then
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg nom "$nom" --arg slug "$slug" \
		               --arg couleur "$couleur" --arg icone "$icone" --argjson position "$position" \
		     '{id: $id, workspace_id: $ws, name: $nom, slug: $slug, color: $couleur,
		       icon: $icone, position: $position, archived_at: null}')
	else
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg nom "$nom" --arg slug "$slug" \
		               --arg couleur "$couleur" --arg icone "$icone" --argjson position "$position" \
		               --arg archive "$archive" \
		     '{id: $id, workspace_id: $ws, name: $nom, slug: $slug, color: $couleur,
		       icon: $icone, position: $position, archived_at: $archive}')
	fi

	code=$(api POST /rest/v1/tracks \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création du track $slug" 200 201

	if [ "$archive" = '-' ]; then etat='actif'; else etat="archivé le ${archive%%T*}"; fi
	printf '  %-16s %-14s %-18s %s\n' "$slug" "$couleur" "$icone" "$etat"
done

# --- 4. Channels — docs/SPEC-channels.md §8 ----------------------------------------------------
# Mêmes règles que les tracks : véritable API REST, clé de service, écriture convergente sur `id`.
#
# `workspace_id` est envoyé explicitement bien qu'il soit déductible du track : la colonne est
# `NOT NULL` et dénormalisée par convention (`docs/SCHEMA.md`). Sa cohérence avec le track n'est
# pas laissée à la bonne foi du seed — la clé étrangère composite de `CRM-021` la refuserait si
# elle mentait (docs/SPEC-channels.md §2.4).

echo
say "4. Channels"

for ligne in "${CHANNELS[@]}"; do
	IFS='|' read -r id track slug nom position archive <<< "$ligne"

	if [ "$archive" = '-' ]; then
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: null, position: $position, archived_at: null}')
	else
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" --arg archive "$archive" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: null, position: $position, archived_at: $archive}')
	fi

	code=$(api POST /rest/v1/channels \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création du channel $slug" 200 201

	if [ "$archive" = '-' ]; then etat='actif'; else etat="archivé le ${archive%%T*}"; fi
	printf '  %-20s %-18s %s\n' "$slug" "${track: -3}" "$etat"
done

# --- 5. Catalogue de nœuds — docs/SPEC-workflow-engine.md §2.9 ---------------------------------
# Mêmes règles que les tracks et les channels : véritable API REST, clé de service, écriture
# convergente sur `id`.
#
# `default_probability` et `default_stale_after_days` sont envoyés **null** lorsque le contrat dit
# « — », et non omis : omettre laisserait la valeur précédente en place lors d'un rejeu convergent,
# de sorte qu'un seuil posé à la main sur `livre` y survivrait. Le seed est un contrat opposable ;
# il doit ramener la ligne à son état déclaré, y compris pour effacer.

echo
say "5. Catalogue de nœuds"

for ligne in "${NOEUDS[@]}"; do
	IFS='|' read -r id cle libelle type couleur proba seuil position archive <<< "$ligne"

	[ "$proba"   = '-' ] && proba_json='null'   || proba_json="$proba"
	[ "$seuil"   = '-' ] && seuil_json='null'   || seuil_json="$seuil"
	[ "$archive" = '-' ] && archive_json='null' || archive_json="\"$archive\""

	charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg cle "$cle" --arg libelle "$libelle" \
	               --arg type "$type" --arg couleur "$couleur" --argjson position "$position" \
	               --argjson proba "$proba_json" --argjson seuil "$seuil_json" \
	               --argjson archive "$archive_json" \
	     '{id: $id, workspace_id: $ws, key: $cle, label: $libelle, kind: $type, color: $couleur,
	       default_probability: $proba, default_stale_after_days: $seuil, position: $position,
	       archived_at: $archive}')

	code=$(api POST /rest/v1/workflow_nodes_catalog \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création du nœud $cle" 200 201

	if [ "$archive" = '-' ]; then etat='actif'; else etat="archivé le ${archive%%T*}"; fi
	[ "$proba" = '-' ] && affiche_proba='—' || affiche_proba="${proba} %"
	[ "$seuil" = '-' ] && affiche_seuil='—' || affiche_seuil="${seuil} j"
	printf '  %-14s %-6s %-9s %6s %5s   %s\n' \
		"$cle" "$type" "$couleur" "$affiche_proba" "$affiche_seuil" "$etat"
done

# --- 6. Ce que le seed rend visible, et ce qu'il ne rend pas visible ----------------------------
# Rappel volontaire, affiché à chaque exécution, et **mis à jour par `CRM-020`** : peupler la base
# ne la rend pas lisible pour autant. L'état réel est désormais mixte, et le dire faux dans un sens
# ou dans l'autre tromperait celui qui lit cette sortie.
#
#   * les tables du socle — profiles, workspaces, workspace_members — restent en refus par défaut
#     depuis `CRM-003` : RLS activée, aucune politique. Elles relèvent de `CRM-012` ;
#   * `tracks` porte les politiques de `CRM-020`, `channels` celles de `CRM-021` et
#     `workflow_nodes_catalog` celles de `CRM-030` : un membre du workspace y lit, un
#     administrateur seul y écrit. Un appelant **anonyme** n'y lit rien.

echo
say "Seed appliqué"
info "Espace de travail : $WS_NAME ($WS_SLUG)"
info "Comptes : ${#COMPTES[@]}, un par rôle — mot de passe commun publié dans docs/SPEC-seed.md §2.3"
info "Tracks : ${#TRACKS[@]}, dont un archivé — docs/SPEC-tracks.md §8"
info "Channels : ${#CHANNELS[@]}, dont un archivé, répartis sur trois tracks — docs/SPEC-channels.md §8"
info "Nœuds du catalogue : ${#NOEUDS[@]}, dont un archivé — docs/SPEC-workflow-engine.md §2.9"
echo
warn "profiles, workspaces et workspace_members ne sont lisibles par AUCUN jeton d'utilisateur :"
warn "ces tables restent en refus par défaut jusqu'à CRM-012 (aucune politique RLS)."
info "tracks, channels et workflow_nodes_catalog sont lisibles par un membre du workspace, et par lui seul"
info "(CRM-020, CRM-021, CRM-030). Aucun workflow n'existe encore : CRM-031."
info "Preuves du seed : scripts/verify-seed.sh — tracks : scripts/verify-tracks.sh"
info "channels : scripts/verify-channels.sh — catalogue : scripts/verify-catalogue.sh"
