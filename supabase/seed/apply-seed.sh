#!/usr/bin/env bash
# @spec CRM-005 (docs/BACKLOG.md) — seed socle : comptes, espace de travail, rôles
# @spec CRM-020 (docs/BACKLOG.md) — tracks de démonstration, dont un archivé
# @spec CRM-021 (docs/BACKLOG.md) — channels de démonstration, dont un archivé
# @spec CRM-030 (docs/BACKLOG.md) — catalogue de nœuds de démonstration, dont un archivé
# @spec CRM-031 (docs/BACKLOG.md) — workflow par défaut, ses étapes et ses transitions
# @spec CRM-032 (docs/BACKLOG.md) — copie du workflow vers un track, par la véritable RPC
# @spec CRM-035 (docs/BACKLOG.md) — champs de formulaire et règles de visibilité
# @spec CRM-018 (docs/BACKLOG.md) — champs exigés par une transition, avec intégrité référentielle
# @spec CRM-078 (docs/BACKLOG.md) — une version publiée du workflow par défaut
# @spec CRM-081 (docs/BACKLOG.md) — deux affaires en sommeil, dont une échue (docs/SPEC-cards.md §16.11.6)
# @spec docs/SPEC-seed.md §2 (contrat), §2.9 (copie), §3 (mécanismes mesurés), §4 (identifiants),
#       §5 (gardes)
# @spec docs/SPEC-tracks.md §8 (seed des tracks) ; docs/SPEC-channels.md §8 (seed des channels)
# @spec docs/SPEC-workflow-engine.md §2.9 (catalogue initial), §3.9 (workflow par défaut),
#       §4.10 (copie livrée par le seed)
# @spec docs/SPEC-form-composer.md §2.9 (champs et règles livrés par le seed) ;
#       docs/SPEC-seed.md §2.10
# @spec docs/SCHEMA.md §1 (identité et cloisonnement), §2 (organisation), §3 (workflows),
#       §4 (formulaires conditionnels)
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
# détruit aucune donnée inconnue ni copie utilisateur. La seule reconstruction destructive est
# celle de l'ancienne fixture dérivée sans formulaire, sous les gardes de la décision 300.
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

# id | email | nom affiché | avatar même origine | rôle de workspace
COMPTES=(
	'5eed0000-0000-4000-8000-000000000011|admin@p2enjoy.test|Camille Aubert|/avatars/camille-aubert.svg|admin'
	'5eed0000-0000-4000-8000-000000000012|bizdev@p2enjoy.test|Driss Lemoine|/avatars/driss-lemoine.svg|business_developer'
	'5eed0000-0000-4000-8000-000000000013|viewer@p2enjoy.test|Farida Nowak|/avatars/farida-nowak.svg|viewer'
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
# LE CINQUIÈME EST EN CORBEILLE, ET SON ÉTAT N'EST PAS DÉCLARÉ ICI — `CRM-077`, docs/SPEC-seed.md
# §10. Il naît **actif** comme les trois premiers, et la section 8 septies l'y met par un geste
# réel. Déclarer `deleted_at` dans cette charge le ferait naître en corbeille avec un `deleted_by`
# NUL — la clé de service ne porte aucune revendication `sub` —, et le trigger de la migration 37
# figerait ensuite ce nul pour toujours. Son icône est `folder`, prise au catalogue de
# `webapp/src/app/presentation-tracks.ts` : un nom hors catalogue tomberait sur le repli et le seed
# démontrerait le repli au lieu du track. Sa couleur reste `neutral` et n'inaugure pas `danger` :
# une activité retirée n'est pas une activité en danger, et la corbeille est réversible.
#
# id | slug | nom | couleur | icône | position | date d'archivage (ou « - »)
TRACKS=(
	'5eed0000-0000-4000-8000-000000000021|conseil-ia|Conseil & IA|brand|sparkles|1|-'
	'5eed0000-0000-4000-8000-000000000022|studio-web|Studio web|success|layout-dashboard|2|-'
	'5eed0000-0000-4000-8000-000000000023|formation|Formation|accent|graduation-cap|3|-'
	'5eed0000-0000-4000-8000-000000000024|pipeline-2024|Pipeline 2024|neutral|archive|4|2026-01-15T09:00:00Z'
	'5eed0000-0000-4000-8000-000000000025|legacy-2023|Legacy 2023|neutral|folder|5|-'
)

# Channels des tracks actifs, et deux sous le track en corbeille — docs/SPEC-channels.md §8.
#
# Trois tracks actifs sur quatre en portent ; `formation` n'en porte qu'**un**, ce qui donne une
# barre à un seul onglet — un cas d'affichage réel, distinct de la barre vide. Le track archivé
# `pipeline-2024` n'en porte **aucun** : un track masqué n'a pas à démontrer une barre d'onglets.
#
# `appels-offres` est **archivé**, pour que l'état le soit aussi côté channels et non seulement
# documenté (`CLAUDE.md` §8).
#
# `workflow_id` est **obligatoire** depuis `CRM-033` (INC-029 soldée) : les six channels naissent
# rattachés au workflow par défaut, dont la ligne est créée en section 3 bis. `prospection` est
# ensuite rattaché à la copie de portée `track` en section 7 — elle dérive du workflow global et ne
# peut donc pas le précéder (docs/SPEC-workflow-engine.md §4.12.7).
#
# `position` est écrite explicitement, pour le même motif que les tracks : un ordre attribué par
# effet de bord ne serait pas reproductible si l'ordre des insertions changeait.
#
# LES DEUX DERNIERS SONT SOUS LE TRACK EN CORBEILLE — `CRM-077`, docs/SPEC-seed.md §10. Ils
# démontrent les DEUX situations que le §3.3 de `docs/SPEC-corbeille.md` distingue, et qu'aucune
# donnée ne séparait :
#
#   * `dossiers-2023` reste ACTIF et ne porte AUCUN `deleted_at`. C'est le point le plus facile à
#     manquer en relisant la base : en colonne, ce channel est parfaitement vivant. Il est
#     injoignable parce que son track ne se résout plus (troisième tranche, webapp/src/lib/tracks.ts),
#     et c'est précisément ce qui garde la restauration NON AMBIGUË — restaurer le track le rend,
#     sans que quiconque ait eu à distinguer les enfants emportés de ceux déjà retirés ;
#   * `annexes-2023` est lui-même EN CORBEILLE, de sorte que sa restauration rend
#     `parent_en_corbeille` (garde de la migration 38). Son état n'est pas déclaré ici, pour le
#     motif du §10.2 : la section 8 septies l'y met par un geste réel.
#
# Un seul des deux aurait laissé croire que « enfant d'un parent en corbeille » est un état unique.
#
# id | track | slug | nom | position | date d'archivage (ou « - »)
CHANNELS=(
	'5eed0000-0000-4000-8000-000000000031|5eed0000-0000-4000-8000-000000000021|prospection|Prospection|1|-'
	'5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000021|grands-comptes|Grands comptes|2|-'
	"5eed0000-0000-4000-8000-000000000033|5eed0000-0000-4000-8000-000000000021|appels-offres|Appels d'offres|3|2026-02-01T09:00:00Z"
	'5eed0000-0000-4000-8000-000000000034|5eed0000-0000-4000-8000-000000000022|refonte|Refonte de site|1|-'
	'5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000022|maintenance|Maintenance|2|-'
	'5eed0000-0000-4000-8000-000000000036|5eed0000-0000-4000-8000-000000000023|inter-entreprises|Inter-entreprises|1|-'
	'5eed0000-0000-4000-8000-000000000037|5eed0000-0000-4000-8000-000000000025|dossiers-2023|Dossiers 2023|1|-'
	'5eed0000-0000-4000-8000-000000000038|5eed0000-0000-4000-8000-000000000025|annexes-2023|Annexes 2023|2|-'
)

# Droits fins par track et par channel — docs/SPEC-seed.md §2.11, docs/SPEC-permissions-rls.md §2.2.
#
# Quatre lignes, choisies pour que **chacune des quatre situations** de la matrice du §2.2 soit
# exercée par une donnée réelle, et non seulement décrite. Elles ne sont posées qu'à partir de
# `CRM-012`, l'unité qui les rend opposables : avant elle, elles auraient donné à croire à une
# restriction qui n'existait pas.
#
# La quatrième — un `none` sur l'administratrice — mérite son motif : sans elle, « un administrateur
# n'est jamais restreint » resterait démontré par la seule suite pgTAP, sur une ligne créée puis
# détruite. Avec elle, la démonstration est **permanente** et opposable.
#
# Aucune ligne ne vise un track ou un channel **archivé** : les deux causes de refus s'y
# confondraient, et l'assertion ne prouverait plus laquelle agit.
#
# table | cible | compte | access
DROITS_FINS=(
	'track_members|5eed0000-0000-4000-8000-000000000021|5eed0000-0000-4000-8000-000000000013|none'
	'channel_members|5eed0000-0000-4000-8000-000000000031|5eed0000-0000-4000-8000-000000000013|member'
	'channel_members|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000012|viewer'
	'track_members|5eed0000-0000-4000-8000-000000000021|5eed0000-0000-4000-8000-000000000011|none'
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

# Workflow par défaut du workspace — docs/SPEC-workflow-engine.md §3.9.
#
# Un seul workflow, `global`, par défaut du workspace. Sept étapes, une par nœud **actif** du
# catalogue : le nœud archivé `qualification` reste hors du workflow, un vocabulaire retiré ne
# s'instanciant pas.
#
# Deux surcharges, sur deux colonnes différentes, sans quoi la faculté de surcharger serait
# documentée sans être démontrable (`CLAUDE.md` §8) : `negociation` raccourcit son seuil de relance,
# `realisation` change son libellé. Une surcharge absente vaut « prendre la valeur du catalogue »,
# jamais zéro — elle est donc envoyée **null** et non omise, pour qu'un rejeu convergent efface une
# valeur posée à la main.
#
# `position` est écrite explicitement, pour le même motif que les tracks, les channels et les
# nœuds : un ordre attribué par effet de bord ne serait pas reproductible si l'ordre des insertions
# changeait. Le trigger reste éprouvé par la suite pgTAP et par les scénarios d'API.
WF_ID=5eed0000-0000-4000-8000-000000000051
WF_NOM='Cycle commercial standard'

# Copie du workflow par défaut vers le track « Conseil & IA » — docs/SPEC-workflow-engine.md §4.10.
#
# Le contrat porte ici le **track**, le **nom** et la **source**, mais **pas l'identifiant** de la
# copie : il est frappé par la fonction, et c'est voulu. `CLAUDE.md` §8 exige qu'une donnée de
# démonstration naisse du mécanisme réel ; imposer un identifiant supposerait un paramètre de plus
# sur `copy_workflow_to_track`, ajouté pour le seul confort du seed. La copie se retrouve donc par
# sa source et son track, ce que font les preuves (docs/SPEC-seed.md §2.9).
WF_COPIE_TRACK=5eed0000-0000-4000-8000-000000000021
WF_COPIE_NOM='Cycle commercial — Conseil IA'
# Le channel qui suit la copie, et non le workflow global — docs/SPEC-workflow-engine.md §4.12.7.
# `prospection` appartient au track « Conseil & IA », celui-là même que la copie porte : c'est le cas
# **accepté** le plus intéressant de la règle de `CRM-033`, et il doit être démontrable.
WF_COPIE_CHANNEL=5eed0000-0000-4000-8000-000000000031

# id | nœud | position | initiale (oui/non) | libellé surchargé (ou « - ») | probabilité (ou « - »)
#    | seuil surchargé (ou « - »)
ETAPES=(
	'5eed0000-0000-4000-8000-000000000061|5eed0000-0000-4000-8000-000000000041|1|oui|-|-|-'
	'5eed0000-0000-4000-8000-000000000062|5eed0000-0000-4000-8000-000000000042|2|non|-|-|-'
	'5eed0000-0000-4000-8000-000000000063|5eed0000-0000-4000-8000-000000000043|3|non|-|-|5'
	'5eed0000-0000-4000-8000-000000000064|5eed0000-0000-4000-8000-000000000044|4|non|-|-|-'
	'5eed0000-0000-4000-8000-000000000065|5eed0000-0000-4000-8000-000000000045|5|non|Réalisation en cours|-|-'
	'5eed0000-0000-4000-8000-000000000066|5eed0000-0000-4000-8000-000000000046|6|non|-|-|-'
	'5eed0000-0000-4000-8000-000000000067|5eed0000-0000-4000-8000-000000000047|7|non|-|-|-'
)

# Onze transitions, exactement celles du graphe de docs/SPEC-workflow-engine.md §3.9 : la
# progression linéaire, le retour Négociation → Relance, et le passage vers Perdu depuis les **cinq**
# étapes non terminales.
#
# **`Réalisation en cours → Perdu` EST déclarée depuis la décision 259** (INC-003, close). Elle ne
# l'était pas : le graphe d'origine recopiait une **énumération d'exemples** du responsable comme
# s'il s'agissait du graphe complet, et laissait une affaire signée puis abandonnée en cours de
# réalisation sans aucun chemin vers Perdu — un cul-de-sac à l'endroit exact où une affaire échoue.
#
# Le graphe a été **relu en entier** à cette occasion, et la règle tenue est : toute étape a au
# moins une sortie, ou son absence de sortie est justifiée. Deux étapes n'en ont pas, et les deux
# sont justifiées — `Livré` porte l'issue `won`, `Perdu` l'issue `lost` : ce sont les deux fins du
# cycle, et une transition sortante y contredirait la notion même d'issue.
#
# Les cinq transitions vers Perdu **exigent un commentaire** : une affaire perdue sans motif n'est
# exploitable par aucune analyse, et c'est la seule transition du graphe dont la raison ne se déduit
# pas de l'étape d'arrivée. Choix pris faute d'énoncé d'origine, nommé au §3.9 et renversable ici
# même (docs/JOURNAL.md, décision 75).
#
# id | étape de départ | étape d'arrivée | libellé | commentaire exigé (oui/non)
# La sixième colonne porte l'identifiant du champ à lier **après** la création de `form_fields`.
# Elle n'est plus envoyée dans `workflow_transitions` depuis `CRM-018`. « Démarrer la réalisation »
# exige `lien-proposition` : c'est la SEULE donnée du seed qui exerce le second membre de l'union
# de docs/SPEC-form-composer.md §3.5, celui porté par l'arête et non par l'étape.
TRANSITIONS=(
	'5eed0000-0000-4000-8000-000000000071|5eed0000-0000-4000-8000-000000000061|5eed0000-0000-4000-8000-000000000062|Relancer|non|-'
	'5eed0000-0000-4000-8000-000000000072|5eed0000-0000-4000-8000-000000000062|5eed0000-0000-4000-8000-000000000063|Engager la négociation|non|-'
	'5eed0000-0000-4000-8000-000000000073|5eed0000-0000-4000-8000-000000000063|5eed0000-0000-4000-8000-000000000064|Passer en signature|non|-'
	'5eed0000-0000-4000-8000-000000000074|5eed0000-0000-4000-8000-000000000064|5eed0000-0000-4000-8000-000000000065|Démarrer la réalisation|non|5eed0000-0000-4000-8000-000000000086'
	'5eed0000-0000-4000-8000-000000000075|5eed0000-0000-4000-8000-000000000065|5eed0000-0000-4000-8000-000000000066|Marquer comme livré|non|-'
	'5eed0000-0000-4000-8000-000000000076|5eed0000-0000-4000-8000-000000000063|5eed0000-0000-4000-8000-000000000062|Revenir en relance|non|-'
	'5eed0000-0000-4000-8000-000000000077|5eed0000-0000-4000-8000-000000000061|5eed0000-0000-4000-8000-000000000067|Marquer perdu|oui|-'
	'5eed0000-0000-4000-8000-000000000078|5eed0000-0000-4000-8000-000000000062|5eed0000-0000-4000-8000-000000000067|Marquer perdu|oui|-'
	'5eed0000-0000-4000-8000-000000000079|5eed0000-0000-4000-8000-000000000063|5eed0000-0000-4000-8000-000000000067|Marquer perdu|oui|-'
	'5eed0000-0000-4000-8000-00000000007a|5eed0000-0000-4000-8000-000000000064|5eed0000-0000-4000-8000-000000000067|Marquer perdu|oui|-'
	'5eed0000-0000-4000-8000-00000000007b|5eed0000-0000-4000-8000-000000000065|5eed0000-0000-4000-8000-000000000067|Marquer perdu|oui|-'
)

# Champs de formulaire du workflow par défaut — docs/SPEC-form-composer.md §2.9,
# docs/SPEC-seed.md §2.10.
#
# Sept champs, dont **un archivé** : sans lui, l'état « archivé » serait documenté sans être
# démontrable côté formulaire, ce que `CLAUDE.md` §8 refuse. C'est le même choix qu'un track, un
# channel et un nœud archivés avant lui, et il démontre en outre qu'un champ archivé **garde sa clé
# réservée** (décision 96).
#
# Six types distincts sont couverts, et ce n'est pas un hasard : `money` et `select` sont les deux
# seuls dont la base **exige** des options (décision 94). Sans eux ici, ces deux contraintes
# seraient documentées sans être démontrables.
#
# `options` est envoyé pour **tous** les champs, `{}` compris, et non omis : omettre laisserait la
# valeur précédente en place lors d'un rejeu convergent, de sorte qu'un `choices` posé à la main sur
# `motif-perte` y survivrait. Le seed est un contrat opposable ; il doit ramener la ligne à son état
# déclaré, y compris pour effacer.
#
# `position` est écrite explicitement, pour le même motif que les tracks, les channels, les nœuds et
# les étapes : un ordre attribué par effet de bord ne serait pas reproductible si l'ordre des
# insertions changeait. Le trigger reste éprouvé par la suite pgTAP et par les scénarios d'API.
#
# id | clé | libellé | type | position | aide (ou « - ») | date d'archivage (ou « - »)
CHAMPS=(
	'5eed0000-0000-4000-8000-000000000081|budget|Budget estimé|money|1|Montant hors taxes, en euros.|-'
	"5eed0000-0000-4000-8000-000000000082|source|Origine du contact|select|2|-|-"
	'5eed0000-0000-4000-8000-000000000083|date-signature-prevue|Date de signature prévue|date|3|-|-'
	'5eed0000-0000-4000-8000-000000000084|motif-perte|Motif de la perte|textarea|4|Repris tel quel dans l’analyse des affaires perdues.|-'
	'5eed0000-0000-4000-8000-000000000085|decideur-identifie|Décideur identifié|checkbox|5|-|-'
	'5eed0000-0000-4000-8000-000000000086|lien-proposition|Lien vers la proposition|url|6|-|-'
	'5eed0000-0000-4000-8000-000000000087|budget-previsionnel|Budget prévisionnel|number|7|-|2026-03-15T09:00:00Z'
)

# Options des deux champs qui ne peuvent pas s'en passer. Écrites à part parce qu'elles contiennent
# des séparateurs `|` impossibles à loger dans le tableau ci-dessus.
OPTIONS_BUDGET='{"currency": "EUR", "min": 0}'
OPTIONS_SOURCE='{"choices": [
	{"key": "salon",         "label": "Salon"},
	{"key": "recommandation","label": "Recommandation"},
	{"key": "site",          "label": "Site web"},
	{"key": "prospection",   "label": "Prospection directe"}
]}'

# Règles de visibilité — docs/SPEC-form-composer.md §3.1, docs/SPEC-seed.md §2.10.
#
# Quinze règles couvrant les **trois** visibilités. `visible` est écrit **explicitement** deux fois,
# bien qu'il soit la valeur par défaut : sans cela, la valeur `'visible'` de la colonne ne serait
# jamais exercée par aucune donnée, et rien ne distinguerait « déclaré facultatif » de « non
# déclaré ».
#
# Vingt-sept couples champ × étape restent **sans règle** — sept étapes fois six champs actifs, moins
# les quinze règles, qui portent toutes sur un champ actif. C'est ce qui démontre la valeur par défaut du §3.1 :
# une valeur par défaut qu'aucune donnée n'exerce n'est pas démontrée.
#
# Le champ archivé n'a **aucune** règle : l'archivage ne demande aucun ménage.
#
# champ | étape | visibilité
REGLES=(
	'5eed0000-0000-4000-8000-000000000081|5eed0000-0000-4000-8000-000000000061|hidden'
	'5eed0000-0000-4000-8000-000000000081|5eed0000-0000-4000-8000-000000000063|required'
	'5eed0000-0000-4000-8000-000000000081|5eed0000-0000-4000-8000-000000000064|required'
	'5eed0000-0000-4000-8000-000000000082|5eed0000-0000-4000-8000-000000000061|required'
	'5eed0000-0000-4000-8000-000000000082|5eed0000-0000-4000-8000-000000000062|visible'
	'5eed0000-0000-4000-8000-000000000083|5eed0000-0000-4000-8000-000000000061|hidden'
	'5eed0000-0000-4000-8000-000000000083|5eed0000-0000-4000-8000-000000000064|required'
	'5eed0000-0000-4000-8000-000000000084|5eed0000-0000-4000-8000-000000000061|hidden'
	'5eed0000-0000-4000-8000-000000000084|5eed0000-0000-4000-8000-000000000062|hidden'
	'5eed0000-0000-4000-8000-000000000084|5eed0000-0000-4000-8000-000000000063|hidden'
	'5eed0000-0000-4000-8000-000000000084|5eed0000-0000-4000-8000-000000000064|hidden'
	'5eed0000-0000-4000-8000-000000000084|5eed0000-0000-4000-8000-000000000067|required'
	'5eed0000-0000-4000-8000-000000000085|5eed0000-0000-4000-8000-000000000064|required'
	'5eed0000-0000-4000-8000-000000000086|5eed0000-0000-4000-8000-000000000061|hidden'
	'5eed0000-0000-4000-8000-000000000086|5eed0000-0000-4000-8000-000000000063|visible'
)

# Cards de démonstration — docs/SPEC-cards.md §9, docs/SPEC-seed.md §2.12.
#
# Treize cards sur le workflow **global**, réparties sur cinq channels et quatre tracks, aux
# **sept** étapes du graphe. Chaque état du cycle de vie est représenté par une donnée réelle : onze
# actives, **une archivée**, **une en corbeille**. Sans ces deux dernières, les deux suppressions
# douces de `docs/SPEC-cards.md` §4 seraient documentées sans être démontrables, ce que
# `CLAUDE.md` §8 refuse.
#
# LA TREIZIÈME EST AJOUTÉE PAR LA CINQUIÈME TRANCHE DE `CRM-077` (docs/SPEC-seed.md §10.4 bis), et
# elle n'est pas décorative non plus : `…0cf` vit sous `dossiers-2023`, l'enfant VIVANT d'un track
# EN CORBEILLE. Elle donne son compte non nul à l'énumération du §3.5 de `docs/SPEC-corbeille.md` —
# sans elle, le track `…025` énumérerait un channel et zéro affaire, et la composition des deux
# lignes ne serait démontrée par aucune donnée — et elle est le SEUL cas de garde à deux niveaux du
# seed : son channel est vivant, son track ne l'est pas. Son étape est `negociation` par mesure et
# non par goût : `livre` aurait faussé le préalable de `e2e/api/cards.spec.ts` — « plus aucune card
# ACTIVE » à cette étape une fois `…0cd` archivée —, et `perdu` EXIGE `motif-perte`, si bien que
# l'affaire y serait née avec une fiche incomplète.
#
# LES TROIS DERNIÈRES SONT AJOUTÉES PAR `CRM-046` (docs/SPEC-seed.md §9.3), et aucune n'est
# décorative : elles ferment les trois étapes que `CRM-040` laissait sans card active — MESURÉ le
# 2026-08-06 : `realisation` **0**, `livre` **1 card archivée**, `perdu` **0**. Sur un board de sept
# colonnes, trois étaient vides quel que soit le profil.
#
#   * `…0cc` occupe `realisation`, et porte `lien-proposition` : l'arête « Démarrer la réalisation »
#     l'**exige** par sa liaison, et une card à cette étape sans ce champ décrirait un
#     franchissement que `move_card` aurait refusé ;
#   * `…0cd` occupe `livre` et est **active** : la seule card de cette étape était archivée, donc
#     invisible de tout écran ;
#   * `…0ce` occupe `perdu` — la **branche alternative** du graphe, que rien n'exerçait — et porte
#     `motif-perte`, que son étape exige.
#
# LES CARDS DE `prospection` SONT AILLEURS : elles vivent sur le workflow **dérivé**, et leurs deux
# clés étrangères ne peuvent pas être écrites dans un contrat. Voir `CARDS_DERIVE` ci-dessous.
#
# L'obstruction qui interdisait toute card dans `prospection` jusqu'à `CRM-045` — sections 4 et 7
# repointant le channel, clé composite refusant en `23503` — est levée par **convergence par état**
# (décision 221, §9.2). Le PATCH direct d'un channel peuplé reste refusé ; CRM-019 ferme ensuite
# INC-046 par `change_channel_workflow`, que le seed n'a pas besoin d'appeler sur un état conforme.
#
# `email_local_part` n'est **jamais** envoyé : il est généré par le trigger de la migration 0011 et
# ne doit pas venir du client (docs/SPEC-cards.md §3.4). Il reste donc **stable d'un rejeu à
# l'autre**, la branche `merge-duplicates` ne mettant à jour que les colonnes envoyées.
#
# `position` est écrite explicitement, pour le même motif que les tracks, les channels, les nœuds,
# les étapes et les champs : un ordre attribué par effet de bord ne serait pas reproductible si
# l'ordre des insertions changeait. Le trigger reste éprouvé par la suite pgTAP et par les
# scénarios d'API.
#
# `owner_id`, `amount`, `next_action` et `next_action_at` sont envoyés **null** lorsque le contrat
# dit « - », et non omis : un rejeu convergent doit ramener la ligne à son état déclaré, y compris
# pour effacer une valeur posée à la main.
#
# id | channel | étape | titre | responsable | montant | devise | position | prochaine action | échéance | archivage | corbeille
CARDS=(
	'5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000062|Refonte du site vitrine|5eed0000-0000-4000-8000-000000000012|48000.00|EUR|1|Relancer la DSI après la démo|2026-08-12T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c2|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000062|Migration ERP Sogexia|5eed0000-0000-4000-8000-000000000012|125000.00|EUR|2|Obtenir le cadrage technique|2026-08-20T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c3|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000061|Audit sécurité applicative|5eed0000-0000-4000-8000-000000000011|15500.00|EUR|1|Premier appel de qualification|2026-08-07T14:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c4|5eed0000-0000-4000-8000-000000000034|5eed0000-0000-4000-8000-000000000063|Refonte intranet Ville de Lyon|5eed0000-0000-4000-8000-000000000012|72000.00|EUR|1|Négocier le lot accessibilité|2026-08-18T10:30:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c5|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Support niveau 2 — Atelier Meunier|5eed0000-0000-4000-8000-000000000013|9600.00|EUR|1|Confirmer le périmètre d’astreinte|2026-08-25T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c6|5eed0000-0000-4000-8000-000000000036|5eed0000-0000-4000-8000-000000000061|Piste entrante à qualifier|-|-|EUR|1|-|-|-|-'
	'5eed0000-0000-4000-8000-0000000000c7|5eed0000-0000-4000-8000-000000000036|5eed0000-0000-4000-8000-000000000064|Formation Data & IA — promo 2026|5eed0000-0000-4000-8000-000000000011|28000.00|CHF|2|Faire signer la convention|2026-08-10T08:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000c8|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000066|Contrat cadre 2025|5eed0000-0000-4000-8000-000000000011|96000.00|EUR|1|-|-|2026-03-31T16:00:00Z|-'
	'5eed0000-0000-4000-8000-0000000000c9|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000061|Saisie erronée|5eed0000-0000-4000-8000-000000000011|-|EUR|2|-|-|-|2026-04-02T11:00:00Z'
	'5eed0000-0000-4000-8000-0000000000cc|5eed0000-0000-4000-8000-000000000034|5eed0000-0000-4000-8000-000000000065|Portail adhérents — MGEN Loire|5eed0000-0000-4000-8000-000000000012|64000.00|EUR|1|Recetter le module de cotisations|2026-09-04T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-0000000000cd|5eed0000-0000-4000-8000-000000000032|5eed0000-0000-4000-8000-000000000066|Socle analytique — Vertuo|5eed0000-0000-4000-8000-000000000011|210000.00|EUR|1|-|-|-|-'
	'5eed0000-0000-4000-8000-0000000000ce|5eed0000-0000-4000-8000-000000000036|5eed0000-0000-4000-8000-000000000067|Cursus DevSecOps — Institut Berthier|5eed0000-0000-4000-8000-000000000012|31000.00|EUR|1|-|-|-|-'
	'5eed0000-0000-4000-8000-0000000000cf|5eed0000-0000-4000-8000-000000000037|5eed0000-0000-4000-8000-000000000063|Reprise du dossier Marchand|5eed0000-0000-4000-8000-000000000012|22000.00|EUR|1|-|-|-|-'
)

# --- Cards de VOLUME et de DONNÉES LONGUES — docs/SPEC-seed.md §9.11, `CRM-046` tranche 2 -------
#
# Vingt-six cards dans le seul channel `maintenance`, qui passe de 1 à VINGT-SEPT cards actives.
#
# CE QU'ELLES FERMENT, ET LE MANQUE EST MESURÉ (§9.11, 2026-08-16, pile réelle) : le titre le plus
# long du seed faisait 36 caractères, la prochaine action la plus longue 34, et le channel le plus
# chargé portait 4 cards actives là où la vue liste pagine à 25 lignes. Les données longues et la
# seconde page de `CRM-042` n'étaient donc démontrables que contre des réponses SUBSTITUÉES.
#
# VINGT-SEPT ET NON VINGT-SIX : à vingt-six, la seconde page ne porterait qu'une ligne, et une page
# d'une ligne ne se distingue pas d'une erreur d'un rang au bord de la plage — le cas même que le
# §12.6 de docs/SPEC-cards.md classe sous le 416. À vingt-sept, la première page est pleine, la
# seconde en porte deux.
#
# `maintenance` ET NON `grands-comptes` (§9.11.1) : un channel de maintenance porte structurellement
# beaucoup d'affaires simultanées, et il est cité par SIX fichiers de preuves contre VINGT-NEUF pour
# `grands-comptes` — charger le second réécrirait les onze captures du board de `CRM-041` et les
# douze de `CRM-042` sans rien démontrer de plus.
#
# QUATRE ÉTAPES SUR SEPT, ET CHAQUE EXCLUSION EST UNE RÈGLE MESURÉE (§9.11.3).
#
#   * `realisation` et `perdu` : la transition `signature → realisation` exige `lien-proposition`,
#     et l'étape `perdu` exige `motif-perte`. Une card posée là sans sa valeur décrirait un
#     franchissement que `move_card` aurait REFUSÉ — la trace fabriquée que CLAUDE.md §8 proscrit.
#     Les deux portent déjà leur card de démonstration, `…0cc` et `…0ce`, avec leurs valeurs ;
#   * `signature` : le seed y démontre, et lui seul, que `previsualiser_exigence` rend ZÉRO affaire
#     « sur place » quand elle en rend plusieurs « à l'entrée » — l'inversion exacte du compte de
#     `Prospection`, qui est le fait justifiant l'écran de prévisualisation
#     (`supabase/tests/0034_previsualisation_exigence.test.sql`, assertions 5 et 6). Y poser du
#     volume effacerait cette démonstration sans rien apporter à celle-ci.
#
# UNE SEULE porte les données longues, `…d001` : titre de 128 caractères, prochaine action de 134 —
# exactement les longueurs que les réponses substituées de `CRM-042` servent aujourd'hui. Son titre
# commence par « A », ce qui la place en PREMIÈRE page du tri par défaut (`title` ascendant) : une
# donnée longue reléguée en seconde page ne serait pas capturable sans un geste de pagination.
#
# `position` tient compte de l'existant : `…0c5` occupe déjà la position 1 de l'étape `prospection`
# dans ce channel, les cards de volume y commencent donc à 2. Les quatre autres étapes sont vides.
#
# Aucune valeur de formulaire, aucun commentaire, aucun événement écrit à la main : elles démontrent
# un VOLUME et une LONGUEUR, pas une règle de formulaire (§9.11.5).
#
# AUCUNE NE CUMULE « SANS RESPONSABLE » ET « SANS MONTANT », et c'est une contrainte MESURÉE, non
# une préférence : `supabase/tests/0012_cards.test.sql` démontre le caractère nullable des deux
# colonnes par l'UNICITÉ d'une telle card dans le seed. `…d004` et `…d015` sont donc sans
# responsable mais AVEC montant — la cellule « Responsable » vide reste démontrée dans le volume,
# et l'assertion de `CRM-040` garde l'objet qu'elle s'était donné.
#
# id | channel | étape | titre | responsable | montant | devise | position | prochaine action | échéance | archivage | corbeille
CARDS_VOLUME=(
	'5eed0000-0000-4000-8000-00000000d001|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Astreinte 24/7 et supervision applicative du portail client de la Ville de Lyon — reconduction sous engagement de niveau garanti|5eed0000-0000-4000-8000-000000000013|142000.00|EUR|2|Consolider le relevé complet des incidents des douze derniers mois et présenter le plan de remédiation au comité de pilotage du client|2026-09-18T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d002|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Renouvellement TMA — Clinique Saint-Ambroise|5eed0000-0000-4000-8000-000000000013|18400.00|EUR|3|Chiffrer le lot astreinte|2026-09-02T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d003|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Correctifs de sécurité — extranet Perrin|5eed0000-0000-4000-8000-000000000012|7200.00|EUR|4|Planifier la fenêtre de mise en production|2026-08-29T14:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d004|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Supervision applicative — Groupe Vallier|-|5400.00|EUR|5|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d005|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Maintenance évolutive — boutique Havas Nord|5eed0000-0000-4000-8000-000000000011|11900.00|EUR|6|Recueillir les besoins de la saison 2027|2026-10-06T10:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d006|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Reprise de dette technique — API Sogexia|5eed0000-0000-4000-8000-000000000012|26500.00|EUR|7|Cadrer le périmètre avec l’architecte|2026-09-24T09:30:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d007|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Contrat TMA 2026 — Mairie de Vaulx|5eed0000-0000-4000-8000-000000000013|33000.00|EUR|1|Relancer le service juridique|2026-09-08T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d008|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Hébergement infogéré — Éditions Bertrand|5eed0000-0000-4000-8000-000000000011|21750.00|EUR|2|Obtenir la validation budgétaire|2026-09-15T11:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d009|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Sauvegardes externalisées — Cabinet Lorris|5eed0000-0000-4000-8000-000000000012|9400.00|EUR|3|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d010|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Mise à niveau PHP — intranet Duchamp|5eed0000-0000-4000-8000-000000000013|13600.00|EUR|4|Confirmer la date de gel des développements|2026-09-30T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d011|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Support de niveau 3 — plateforme Nordis|5eed0000-0000-4000-8000-000000000011|47000.00|CHF|5|Arbitrer le volume d’heures mensuel|2026-10-13T08:30:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d012|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Refonte du monitoring — Vertuo|5eed0000-0000-4000-8000-000000000012|38900.00|EUR|1|Négocier la reprise de l’outillage existant|2026-09-11T15:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d013|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Astreinte week-end — Transports Béranger|5eed0000-0000-4000-8000-000000000013|16250.00|EUR|2|Ajuster la grille de pénalités|2026-09-19T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d014|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Migration base de données — MGEN Loire|5eed0000-0000-4000-8000-000000000011|54000.00|EUR|3|Trancher la fenêtre de bascule|2026-10-02T07:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d015|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Audit de performance — portail Meunier|-|8300.00|EUR|4|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d016|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Plan de reprise d’activité — Institut Berthier|5eed0000-0000-4000-8000-000000000012|61500.00|EUR|5|Faire valider le RTO par la direction|2026-10-20T10:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d017|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|TMA annuelle — Fédération sportive du Rhône|5eed0000-0000-4000-8000-000000000013|24800.00|EUR|6|Faire signer l’avenant de reconduction|2026-09-05T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d018|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000063|Veille de vulnérabilités — Atelier Meunier|5eed0000-0000-4000-8000-000000000011|6900.00|EUR|6|Recueillir la signature électronique|2026-09-12T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d019|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Optimisation du cache — site Havas Nord|5eed0000-0000-4000-8000-000000000012|12300.00|EUR|6|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d020|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000061|Reprise du parc de tests — Groupe Vallier|5eed0000-0000-4000-8000-000000000013|19700.00|EUR|8|Confirmer le périmètre de la recette|2026-09-26T14:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d021|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000062|Maintenance corrective — application Lorris|5eed0000-0000-4000-8000-000000000011|8800.00|EUR|7|Obtenir le bon de commande|2026-10-09T09:00:00Z|-|-'
	'5eed0000-0000-4000-8000-00000000d022|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Correctif majeur livré — extranet Sogexia|5eed0000-0000-4000-8000-000000000012|15400.00|EUR|1|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d023|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Montée de version livrée — portail de Vaulx|5eed0000-0000-4000-8000-000000000013|29600.00|EUR|2|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d024|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Reprise d’incident livrée — Saint-Ambroise|5eed0000-0000-4000-8000-000000000011|4200.00|EUR|3|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d025|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Automatisation des sauvegardes — Duchamp|5eed0000-0000-4000-8000-000000000012|17100.00|EUR|4|-|-|-|-'
	'5eed0000-0000-4000-8000-00000000d026|5eed0000-0000-4000-8000-000000000035|5eed0000-0000-4000-8000-000000000066|Tableau de bord de supervision livré — Nordis|5eed0000-0000-4000-8000-000000000013|22400.00|EUR|5|-|-|-|-'
)

# Cards du workflow DÉRIVÉ — docs/SPEC-seed.md §9.3 et §9.4, ajoutées par `CRM-046`.
#
# Elles vivent dans `prospection`, seul channel rattaché à la copie de portée `track`. Sans elles,
# le workflow dérivé est seedé, rattaché, et **rien ne l'exerce** : ses sept étapes portent zéro
# card, et la route `/tracks/conseil-ia/prospection` rend un board sans une seule colonne peuplée —
# l'écran vide que l'énoncé de `CRM-046` proscrit (§9.1, mesuré).
#
# ELLES NE PEUVENT PAS PORTER LEUR WORKFLOW NI LEUR ÉTAPE DANS CE CONTRAT, et ce n'est pas un
# relâchement du §4 : `copy_workflow_to_track` frappe la copie et ses sept étapes avec
# `gen_random_uuid()`. Le contrat porte donc la **clé de nœud** de l'étape voulue, stable et
# déclarée en section 5, et la section 8 septies résout les deux clés étrangères à l'exécution
# (décision 222). Les identifiants des cards, eux, restent fixes.
#
# Deux étapes distinctes, et non une seule : un board dont une seule colonne est peuplée ne
# démontre pas l'ordre des colonnes ni la répartition.
#
# Le formulaire copié est réellement exercé : les valeurs de `VALEURS_DERIVE` sont résolues par
# clé de champ vers les nouveaux identifiants. Réutiliser un identifiant source serait refusé par
# la clé composite, ce que les preuves de CRM-018 vérifient directement.
#
# id | channel | clé de nœud de l'étape | titre | responsable | montant | devise | position |
#    prochaine action | échéance
CARDS_DERIVE=(
	'5eed0000-0000-4000-8000-0000000000ca|5eed0000-0000-4000-8000-000000000031|prospection|Cadrage data — Groupe Vallier|5eed0000-0000-4000-8000-000000000012|38000.00|EUR|1|Fixer l’atelier de cadrage|2026-08-28T09:00:00Z'
	'5eed0000-0000-4000-8000-0000000000cb|5eed0000-0000-4000-8000-000000000031|negociation|Assistant IA support — Nordis|5eed0000-0000-4000-8000-000000000011|87000.00|EUR|1|Arbitrer le périmètre de la V1|2026-09-11T10:00:00Z'
)

# --- Valeurs de formulaire — docs/SPEC-form-composer.md §6.11, docs/SPEC-seed.md §2.13 ----------
# Dix-huit valeurs sur neuf cards du workflow global. Chaque ligne exerce une règle, aucune n'est
# décorative :
#
#   * `…0c1` porte `budget` à `null` — une LIGNE PRÉSENTE N'EST PAS UNE VALEUR RENSEIGNÉE
#     (§6.6) : sa transition vers négociation est refusée, et c'est le cas de refus permanent du
#     produit ;
#   * `…0c2` est son symétrique exact — même étape, même transition, acceptée. Sans cette paire, un
#     refus ne prouverait pas que la règle discrimine ;
#   * `…0c3` porte une valeur sur `budget`, HIDDEN à son étape courante (§4, section repliée), et
#     une valeur sur `budget-previsionnel`, champ ARCHIVÉ (§5, décision 129) ;
#   * `…0c4` manque deux exigences de la transition suivante : la liste du refus porte DEUX clés ;
#   * `…0c6` rend le parcours « Marquer perdu » franchissable — l'étape perdu exige `motif-perte` ;
#   * `…0c7` satisfait les trois exigences de son étape et reste bloquée par une QUATRIÈME, portée
#     par la liaison de l'arête et non par l'étape.
#
# Quatre valeurs sont ajoutées par `CRM-046` (docs/SPEC-seed.md §9.6), et aucune n'est décorative :
#
#   * `…0cc` porte `lien-proposition` parce que l'arête « Démarrer la réalisation » l'EXIGE, et
#     `budget` pour que le cumul de sa colonne ne soit pas muet ;
#   * `…0cd` porte `budget` : c'est la seule affaire GAGNÉE active du seed, et une colonne « Livré »
#     sans montant ne dirait rien du cumul ;
#   * `…0ce` porte `motif-perte`, que son étape exige — une affaire perdue sans motif est une donnée
#     que le produit refuse de produire lui-même.
#
# Trois valeurs supplémentaires vivent sur les deux cards du workflow dérivé : `…0ca` démontre la
# règle `source` requise en prospection ; `…0cb` démontre `budget` requis et
# `lien-proposition` visible en négociation. Leurs identifiants de champ sont résolus à l'exécution.
#
# `false` serait tout autant renseigné que `true` (§6.6) : `decideur-identifie` vaut `true` parce
# que la card est en signature, pas parce que la valeur fausse serait refusée.
#
# La valeur est du JSON **littéral**, envoyé tel quel : c'est ce que la colonne `jsonb` attend, et
# le trigger de validation la juge selon `form_fields.type`.
#
# card | champ | valeur JSON
VALEURS=(
	'5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000082|"recommandation"'
	'5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000081|null'
	'5eed0000-0000-4000-8000-0000000000c2|5eed0000-0000-4000-8000-000000000082|"salon"'
	'5eed0000-0000-4000-8000-0000000000c2|5eed0000-0000-4000-8000-000000000081|45000'
	'5eed0000-0000-4000-8000-0000000000c3|5eed0000-0000-4000-8000-000000000082|"site"'
	'5eed0000-0000-4000-8000-0000000000c3|5eed0000-0000-4000-8000-000000000081|90000'
	'5eed0000-0000-4000-8000-0000000000c3|5eed0000-0000-4000-8000-000000000087|72000'
	'5eed0000-0000-4000-8000-0000000000c4|5eed0000-0000-4000-8000-000000000081|120000'
	'5eed0000-0000-4000-8000-0000000000c4|5eed0000-0000-4000-8000-000000000086|"https://p2enjoy.fr/propositions/lyon-intranet"'
	'5eed0000-0000-4000-8000-0000000000c6|5eed0000-0000-4000-8000-000000000082|"prospection"'
	'5eed0000-0000-4000-8000-0000000000c6|5eed0000-0000-4000-8000-000000000084|"Budget gelé jusqu\u2019au prochain exercice."'
	'5eed0000-0000-4000-8000-0000000000c7|5eed0000-0000-4000-8000-000000000081|78000'
	'5eed0000-0000-4000-8000-0000000000c7|5eed0000-0000-4000-8000-000000000083|"2026-09-30"'
	'5eed0000-0000-4000-8000-0000000000c7|5eed0000-0000-4000-8000-000000000085|true'
	'5eed0000-0000-4000-8000-0000000000cc|5eed0000-0000-4000-8000-000000000086|"https://p2enjoy.fr/propositions/mgen-loire"'
	'5eed0000-0000-4000-8000-0000000000cc|5eed0000-0000-4000-8000-000000000081|64000'
	'5eed0000-0000-4000-8000-0000000000cd|5eed0000-0000-4000-8000-000000000081|210000'
	'5eed0000-0000-4000-8000-0000000000ce|5eed0000-0000-4000-8000-000000000084|"Budget arbitré au profit d’un organisme déjà référencé."'
)

# card dérivée | clé du champ dérivé | valeur JSON
VALEURS_DERIVE=(
	'5eed0000-0000-4000-8000-0000000000ca|source|"recommandation"'
	'5eed0000-0000-4000-8000-0000000000cb|budget|87000'
	'5eed0000-0000-4000-8000-0000000000cb|lien-proposition|"https://p2enjoy.fr/propositions/nordis-assistant-ia"'
)

# --- Commentaires — docs/SPEC-cards.md §13.11, docs/SPEC-seed.md §2.14 -------------------------
# Cinq commentaires sur trois cards, écrits par les trois comptes. Aucun n'est décoratif :
#
#   * deux auteurs sur `…0c1` font un FIL, ce qu'un commentaire isolé ne démontre pas ;
#   * le troisième est MODIFIÉ : `edited_at` renseigné, état démontré et non seulement décrit ;
#   * celui de `…0c4` est RETIRÉ PAR LA MODÉRATION — pierre tombale, corps vide, `deleted_by`
#     différent d'`author_id` (INC-072, décision 376) —, et il vit dans un channel d'un AUTRE
#     track, pour que le retrait ne soit pas prouvé sur le seul channel déjà couvert ;
#   * celui de `…0c5` porte pour auteur Farida Nowak, `viewer` du workspace. Il est le TÉMOIN de la
#     preuve de lecture : sans lui, « le viewer lit `200` et `[]` » serait vrai que la RLS refuse ou
#     qu'elle autorise tout (décision 50). C'est la seule ligne du seed dont l'auteur ne pourrait
#     PAS l'écrire lui-même : la politique d'insertion exige le droit d'écriture (INC-071), et le
#     seed le dit plutôt que de le maquiller.
#
# `workspace_id` n'est JAMAIS envoyé : le trigger de la migration 15 le dérive de la card, quelle
# que soit la valeur fournie. `edited_at`, `deleted_at` et `deleted_by` non plus — ils sont posés
# par le produit, dans les deux mises à jour conditionnelles de la section 8 quinquies.
#
# id | card | auteur | corps
COMMENTAIRES=(
	'5eed0000-0000-4000-8000-0000000000d1|5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000011|La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq.'
	'5eed0000-0000-4000-8000-0000000000d2|5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000012|Démo faite le 3 août. Retour attendu sous quinzaine, relance calée.'
	'5eed0000-0000-4000-8000-0000000000d3|5eed0000-0000-4000-8000-0000000000c1|5eed0000-0000-4000-8000-000000000011|Budget confirmé à 48 000 EUR hors maintenance.'
	'5eed0000-0000-4000-8000-0000000000d4|5eed0000-0000-4000-8000-0000000000c4|5eed0000-0000-4000-8000-000000000012|Note interne publiée par erreur sur la mauvaise affaire.'
	"5eed0000-0000-4000-8000-0000000000d5|5eed0000-0000-4000-8000-0000000000c5|5eed0000-0000-4000-8000-000000000013|Astreinte à confirmer : le client demande une couverture jusqu'à 20 h."
)

# Corps du commentaire `…d3` APRÈS modification. C'est ce second corps qui pose `edited_at` : le
# trigger ne marque que si le corps change réellement.
COMMENTAIRE_D3_MODIFIE='Budget confirmé à 48 000 EUR hors maintenance, et hors reprise de contenu.'

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

# Sélectionne la fixture dérivée selon l'unique contrat de la décision 300. Cette fonction est
# appelée avant les channels, puis avant la convergence complète de la copie : les deux sections
# ne doivent jamais interpréter différemment la présence de copies utilisateur.
#
# Résultats globaux : `copies_total`, `copies_exactes`, `copie_selectionnee`.
selectionner_copie_seed() {
	local fichier=$1

	copies_total=$(jq -r 'length' "$fichier")
	copies_exactes=$(jq -r --arg nom "$WF_COPIE_NOM" \
		'[.[] | select(.name == $nom)] | length' "$fichier")
	copie_selectionnee=''

	if [ "$copies_exactes" -eq 1 ]; then
		copie_selectionnee=$(jq -r --arg nom "$WF_COPIE_NOM" \
			'.[] | select(.name == $nom) | .id' "$fichier")
	elif [ "$copies_exactes" -gt 1 ]; then
		die "plusieurs copies portent le nom seedé « $WF_COPIE_NOM » : état ambigu, aucune suppression.
        Identifiants : $(jq -r --arg nom "$WF_COPIE_NOM" \
			'[.[] | select(.name == $nom) | .id] | join(", ")' "$fichier")"
	elif [ "$copies_total" -eq 1 ]; then
		# Reprise d'une fixture historique unique qui aurait été renommée ou déplacée.
		copie_selectionnee=$(jq -r '.[0].id' "$fichier")
	elif [ "$copies_total" -gt 1 ]; then
		die "plusieurs dérivations existent sans candidate seedée non ambiguë : aucune suppression.
        Identifiants : $(jq -r '[.[].id] | join(", ")' "$fichier")"
	fi
}

# Rend la composition métier canonique d'un workflow en faisant abstraction des identifiants que
# `copy_workflow_to_track` remappe et des horodatages techniques — décision 303. Les nœuds du
# catalogue gardent leur identifiant dans la copie ; les étapes sont donc identifiées par `node_id`,
# les champs par `key`, et les arêtes par le couple de nœuds qu'elles relient.
#
# Cette lecture passe uniquement par l'API réelle. Elle ne sert pas à déclarer qu'une copie
# utilisateur doit rester identique à sa source : elle ne sera appelée que pour la candidate
# officielle sélectionnée par `selectionner_copie_seed`.
composition_metier_workflow() {
	local workflow=$1 code etapes transitions champs regles

	code=$(api GET "/rest/v1/workflow_steps?workflow_id=eq.$workflow&select=id,node_id,position,label_override,probability_override,stale_after_days,is_initial")
	attendu "$code" "lecture des étapes pour comparer la copie seedée" 200
	etapes=$(cat "$CORPS")

	code=$(api GET "/rest/v1/workflow_transitions?workflow_id=eq.$workflow&select=id,from_step_id,to_step_id,label,require_comment,workflow_transition_required_fields(field_id)")
	attendu "$code" "lecture des transitions et exigences pour comparer la copie seedée" 200
	transitions=$(cat "$CORPS")

	code=$(api GET "/rest/v1/form_fields?workflow_id=eq.$workflow&select=id,key,label,type,options,help_text,position,archived_at")
	attendu "$code" "lecture des champs pour comparer la copie seedée" 200
	champs=$(cat "$CORPS")

	code=$(api GET "/rest/v1/form_field_rules?workflow_id=eq.$workflow&select=field_id,step_id,visibility")
	attendu "$code" "lecture des règles pour comparer la copie seedée" 200
	regles=$(cat "$CORPS")

	jq -ncS --argjson etapes "$etapes" --argjson transitions "$transitions" \
		--argjson champs "$champs" --argjson regles "$regles" '
		def noeud($etape_id):
			first($etapes[] | select(.id == $etape_id) | .node_id);
		def cle_champ($champ_id):
			first($champs[] | select(.id == $champ_id) | .key);
		{
			steps: ([$etapes[] | {
				node_id, position, label_override, probability_override, stale_after_days, is_initial
			}] | sort_by(.node_id)),
			transitions: ([$transitions[] | {
				from_node_id: noeud(.from_step_id),
				to_node_id: noeud(.to_step_id),
				label: .label,
				require_comment
			}] | sort_by(.from_node_id, .to_node_id)),
			fields: ([$champs[] | {
				key,
				label: .label,
				type,
				options,
				help_text,
				position,
				archived_at
			}] | sort_by(.key)),
			rules: ([$regles[] | {
				field_key: cle_champ(.field_id),
				node_id: noeud(.step_id),
				visibility
			}] | sort_by(.field_key, .node_id)),
			required_fields: ([
				$transitions[] as $transition
				| $transition.workflow_transition_required_fields[]?
				| {
					from_node_id: noeud($transition.from_step_id),
					to_node_id: noeud($transition.to_step_id),
					field_key: cle_champ(.field_id)
				}
			] | sort_by(.from_node_id, .to_node_id, .field_key))
		}'
}

verifier_composition_copie_seed() {
	local copie=$1 composition_source composition_copie
	composition_source=$(composition_metier_workflow "$WF_ID")
	composition_copie=$(composition_metier_workflow "$copie")
	[ "$composition_source" = "$composition_copie" ] || die "la composition métier de la copie seedée moderne $copie diverge de sa source,
		malgré des volumes éventuellement identiques.
        Refus de la réécrire ou de la reconstruire automatiquement — décision 303. Restaurer
        explicitement cette fixture, ou repartir d'une base locale neuve par ./resetMe.sh."
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
	IFS='|' read -r id email nom avatar role <<< "$ligne"

	# 2.a. Le compte. Recréer une adresse existante est refusé en `422 email_exists` : la présence
	#      est donc testée avant la création, jamais rattrapée après coup (décision 34).
	existant=$(compte_id_par_email "$email")

	if [ -z "$existant" ]; then
		code=$(api POST /auth/v1/admin/users \
			-d "$(jq -nc --arg id "$id" --arg email "$email" --arg mdp "$SEED_PASSWORD" \
			              --arg nom "$nom" --arg avatar "$avatar" \
			     '{id: $id, email: $email, password: $mdp, email_confirm: true,
			       user_metadata: {full_name: $nom, avatar_url: $avatar, locale: "fr"}}')")
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
			-d "$(jq -nc --arg mdp "$SEED_PASSWORD" --arg nom "$nom" --arg avatar "$avatar" \
			     '{password: $mdp, email_confirm: true,
			       user_metadata: {full_name: $nom, avatar_url: $avatar, locale: "fr"}}')")
		attendu "$code" "mise à jour du compte $email" 200
		etat='mis à jour'
	fi

	# 2.b. Le profil. Il naît du trigger de `CRM-003` — le seed n'en crée aucun. En revanche il le
	#      CONVERGE explicitement : mettre à jour `user_metadata` ne met pas à jour le profil, le
	#      trigger étant `AFTER INSERT` et portant `on conflict do nothing` (décision 34). Sans ce
	#      PATCH, une dérive du nom affiché ne serait jamais rattrapée.
	code=$(api PATCH "/rest/v1/profiles?id=eq.$id" \
		-H 'Prefer: return=representation' \
		-d "$(jq -nc --arg nom "$nom" --arg avatar "$avatar" \
		     '{full_name: $nom, avatar_url: $avatar, locale: "fr"}')")
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

# --- 3 bis. La ligne du workflow par défaut — docs/SPEC-workflow-engine.md §4.12.5 -------------
# Cette section n'existait pas avant `CRM-033`. Le workflow était créé en section 6, après les
# channels, et ceux-ci lui étaient rattachés par un `PATCH` de fin de section — la table `workflows`
# n'existant pas encore au moment de leur création (INC-029).
#
# `CRM-033` pose la contrainte `NOT NULL` sur `channels.workflow_id` : un channel ne peut plus naître
# sans workflow, et l'ordre du seed doit suivre le contrat du produit plutôt que l'inverse.
#
# Seule la **ligne** du workflow est créée ici. Ses **étapes** instancient des nœuds du catalogue,
# qui n'existe qu'en section 5 : elles restent donc en section 6, avec les transitions. Un workflow
# sans étape est un **brouillon**, état structurellement valide du produit (§3.5, décision 72) — le
# seed n'en fabrique pas un durablement, il traverse cet état le temps de deux sections.

echo
say "3 bis. Ligne du workflow par défaut"

charge=$(jq -nc --arg id "$WF_ID" --arg ws "$WS_ID" --arg nom "$WF_NOM" \
	'{id: $id, workspace_id: $ws, name: $nom, scope: "global", track_id: null,
	  derived_from_workflow_id: null, derived_at: null, is_default: true, archived_at: null}')
code=$(api POST /rest/v1/workflows \
	-H 'Prefer: return=representation,resolution=merge-duplicates' \
	-d "$charge")
attendu "$code" "création du workflow $WF_NOM" 200 201
info "$WF_NOM — global, par défaut du workspace ; ses étapes arrivent en section 6"

# --- 4. Channels — docs/SPEC-channels.md §8 ----------------------------------------------------
# Mêmes règles que les tracks : véritable API REST, clé de service, écriture convergente sur `id`.
#
# `workspace_id` est envoyé explicitement bien qu'il soit déductible du track : la colonne est
# `NOT NULL` et dénormalisée par convention (`docs/SCHEMA.md`). Sa cohérence avec le track n'est
# pas laissée à la bonne foi du seed — la clé étrangère composite de `CRM-021` la refuserait si
# elle mentait (docs/SPEC-channels.md §2.4).
#
# `workflow_id` est désormais **obligatoire** (`CRM-033`) : les six channels naissent rattachés au
# workflow par défaut, créé en section 3 bis. `prospection` sera rattaché à la copie de portée
# `track` en section 7, une fois celle-ci créée — elle dérive du workflow global et ne peut donc pas
# le précéder.
#
# CONVERGENCE PAR ÉTAT SUR `prospection` — `CRM-046`, décision 221, docs/SPEC-seed.md §9.2.
#
# Envoyer `workflow_id = $WF_ID` pour ce channel le RAMÈNE au workflow global, alors que son état
# déclaré est la copie. Tant qu'aucune card n'y vivait, l'aller-retour était invisible ; dès qu'une
# card l'occupe, la clé étrangère composite `cards (channel_id, workflow_id)` refuse le premier des
# deux gestes. MESURÉ : HTTP `409`, `23503`, code de sortie `1`, ici même en section 4.
#
# La valeur envoyée pour ce channel est donc **celle qu'il porte déjà** lorsqu'il suit la copie
# déclarée, et le workflow global sinon. Sur une base neuve, la copie n'existe pas encore : la
# valeur envoyée est le workflow global, et la section 7 fait le rattachement avant que la moindre
# card ne soit posée. Sur une base conforme, la colonne est réécrite **à l'identique** : la clé
# référencée `(id, workflow_id)` ne change pas, et la clé étrangère n'a rien à refuser.
#
# OMETTRE LA COLONNE NE MARCHE PAS, ET C'EST MESURÉ. L'`upsert` de PostgREST construit d'abord le
# tuple d'INSERT ; une colonne absente y vaut `NULL`, et `channels.workflow_id` est `NOT NULL`
# depuis `CRM-033`. PostgreSQL refuse en `23502` **avant** d'atteindre la clause `ON CONFLICT` :
#
#   {"code":"23502","message":"null value in column \"workflow_id\" of relation \"channels\"
#    violates not-null constraint"}
#
# Réécrire la valeur courante est donc la seule forme de non-écriture que cette route autorise.
#
# Ce n'est pas un relâchement de la garde : c'est le seed qui cesse de faire **changer** ce qui n'a
# pas à changer. Depuis CRM-019, un changement légitime passe par `change_channel_workflow`.

echo
say "4. Channels"

# L'état réel du rattachement de `prospection`, relu AVANT d'écrire quoi que ce soit.
code=$(api GET "/rest/v1/channels?id=eq.$WF_COPIE_CHANNEL&select=workflow_id")
attendu "$code" "relecture du rattachement de prospection" 200
CH_PROSPECTION_WF=$(jq -r '.[0].workflow_id // empty' "$CORPS")

code=$(api GET "/rest/v1/workflows?select=id,name&derived_from_workflow_id=eq.$WF_ID&order=created_at")
attendu "$code" "relecture des copies dérivées avant les channels" 200
selectionner_copie_seed "$CORPS"
WF_COPIE_ID_CONNUE=$copie_selectionnee

for ligne in "${CHANNELS[@]}"; do
	IFS='|' read -r id track slug nom position archive <<< "$ligne"

	# Le workflow envoyé. Le seul channel dont le workflow déclaré n'est pas le workflow global est
	# `prospection` : s'il porte déjà la copie déclarée, la valeur est réécrite à l'identique.
	wf_envoye=$WF_ID
	note=''
	if [ "$id" = "$WF_COPIE_CHANNEL" ] \
	   && [ -n "$WF_COPIE_ID_CONNUE" ] \
	   && [ "$CH_PROSPECTION_WF" = "$WF_COPIE_ID_CONNUE" ]; then
		wf_envoye=$WF_COPIE_ID_CONNUE
		note=' — workflow inchangé (déjà sur la copie)'
	fi

	if [ "$archive" = '-' ]; then
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" --arg wf "$wf_envoye" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: $wf, position: $position, archived_at: null}')
	else
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" --arg archive "$archive" \
		               --arg wf "$wf_envoye" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: $wf, position: $position, archived_at: $archive}')
	fi

	code=$(api POST /rest/v1/channels \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création du channel $slug" 200 201

	if [ "$archive" = '-' ]; then etat='actif'; else etat="archivé le ${archive%%T*}"; fi
	printf '  %-20s %-18s %s\n' "$slug" "${track: -3}" "$etat$note"
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

# --- 6. Workflow par défaut — docs/SPEC-workflow-engine.md §3.9 --------------------------------
# Mêmes règles que les sections précédentes : véritable API REST, clé de service, écriture
# convergente sur `id`.
#
# Cette section vient **après** le catalogue parce qu'une étape instancie un nœud. La **ligne** du
# workflow, elle, est créée en section 3 bis : `CRM-033` rend `channels.workflow_id` obligatoire, et
# les channels de la section 4 doivent pouvoir la désigner. Le `PATCH` de rattachement qui terminait
# cette section jusqu'à `CRM-031` a disparu pour la même raison.

echo
say "6. Étapes et transitions du workflow par défaut"

for ligne in "${ETAPES[@]}"; do
	IFS='|' read -r id noeud position initiale libelle proba seuil <<< "$ligne"

	[ "$initiale" = 'oui' ] && initiale_json='true' || initiale_json='false'
	[ "$libelle" = '-' ] && libelle_json='null'  || libelle_json="\"$libelle\""
	[ "$proba"   = '-' ] && proba_json='null'    || proba_json="$proba"
	[ "$seuil"   = '-' ] && seuil_json='null'    || seuil_json="$seuil"

	charge=$(jq -nc --arg id "$id" --arg wf "$WF_ID" --arg ws "$WS_ID" --arg noeud "$noeud" \
	               --argjson position "$position" --argjson initiale "$initiale_json" \
	               --argjson libelle "$libelle_json" --argjson proba "$proba_json" \
	               --argjson seuil "$seuil_json" \
	     '{id: $id, workflow_id: $wf, workspace_id: $ws, node_id: $noeud, position: $position,
	       is_initial: $initiale, label_override: $libelle, probability_override: $proba,
	       stale_after_days: $seuil}')

	code=$(api POST /rest/v1/workflow_steps \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de l'étape $position du workflow" 200 201

	cle=$(jq -r '.[0].node_id // empty' "$CORPS")
	[ "$initiale" = 'oui' ] && marque='initiale' || marque='        '
	[ "$libelle" = '-' ] && surcharge='' || surcharge="libellé « $libelle »"
	[ "$seuil"   = '-' ] || surcharge="seuil $seuil j"
	printf '  étape %s  %s  %s\n' "$position" "$marque" "$surcharge"
done

for ligne in "${TRANSITIONS[@]}"; do
	IFS='|' read -r id depuis vers libelle commentaire champs <<< "$ligne"

	[ "$commentaire" = 'oui' ] && commentaire_json='true' || commentaire_json='false'

	charge=$(jq -nc --arg id "$id" --arg wf "$WF_ID" --arg ws "$WS_ID" --arg depuis "$depuis" \
	               --arg vers "$vers" --arg libelle "$libelle" \
	               --argjson commentaire "$commentaire_json" \
	     '{id: $id, workflow_id: $wf, workspace_id: $ws, from_step_id: $depuis, to_step_id: $vers,
	       label: $libelle, require_comment: $commentaire}')

	code=$(api POST /rest/v1/workflow_transitions \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la transition « $libelle »" 200 201
done
info "Étapes : ${#ETAPES[@]} — transitions : ${#TRANSITIONS[@]}, dont 5 exigeant un commentaire"
info "L'exigence de lien-proposition sera posée avec le formulaire avant la copie — CRM-018"


# --- 6 bis. Formulaire source avant la copie — CRM-018, décision 293 ---------------------------
# La fonction du produit copie désormais champs, règles et exigences. Le formulaire source doit
# donc exister AVANT l'appel RPC, sous peine de recréer exactement l'ancien défaut : une copie vide
# qu'un second passage du seed ne saurait transformer en vraie copie.

echo
say "6 bis. Champs, règles et exigence du workflow source"

for ligne in "${CHAMPS[@]}"; do
	IFS='|' read -r id cle libelle type position aide archive <<< "$ligne"

	case "$cle" in
		budget) options=$OPTIONS_BUDGET ;;
		source) options=$OPTIONS_SOURCE ;;
		*)      options='{}' ;;
	esac

	[ "$aide"    = '-' ] && aide_json='null'    || aide_json=$(jq -nc --arg v "$aide" '$v')
	[ "$archive" = '-' ] && archive_json='null' || archive_json=$(jq -nc --arg v "$archive" '$v')

	charge=$(jq -nc --arg id "$id" --arg wf "$WF_ID" --arg ws "$WS_ID" --arg cle "$cle" \
	               --arg libelle "$libelle" --arg type "$type" --argjson position "$position" \
	               --argjson options "$options" --argjson aide "$aide_json" \
	               --argjson archive "$archive_json" \
	     '{id: $id, workflow_id: $wf, workspace_id: $ws, key: $cle, label: $libelle, type: $type,
	       options: $options, help_text: $aide, position: $position, archived_at: $archive}')

	code=$(api POST /rest/v1/form_fields \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création du champ source $cle" 200 201
done

for ligne in "${REGLES[@]}"; do
	IFS='|' read -r champ etape visibilite <<< "$ligne"
	charge=$(jq -nc --arg champ "$champ" --arg etape "$etape" --arg wf "$WF_ID" --arg ws "$WS_ID" \
	               --arg v "$visibilite" \
	     '{field_id: $champ, step_id: $etape, workflow_id: $wf, workspace_id: $ws, visibility: $v}')
	code=$(api POST /rest/v1/form_field_rules \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la règle source ${champ: -3}×${etape: -3}" 200 201
done

for ligne in "${TRANSITIONS[@]}"; do
	IFS='|' read -r transition_id reste_transition <<< "$ligne"
	code=$(api DELETE "/rest/v1/workflow_transition_required_fields?transition_id=eq.$transition_id")
	attendu "$code" "nettoyage des exigences source ${transition_id: -3}" 200 204
done

charge=$(jq -nc \
	--arg transition '5eed0000-0000-4000-8000-000000000074' \
	--arg champ '5eed0000-0000-4000-8000-000000000086' \
	'{transition_id: $transition, field_id: $champ}')
code=$(api POST /rest/v1/workflow_transition_required_fields \
	-H 'Prefer: return=representation,resolution=merge-duplicates' -d "$charge")
attendu "$code" "liaison source Démarrer la réalisation → lien-proposition" 200 201

# Une reconstruction de copie n'est autorisée que depuis la composition source EXACTE du seed.
# Les upserts ci-dessus garantissent déjà la présence de chaque identifiant connu ; l'égalité des
# comptes garantit donc qu'aucun objet utilisateur supplémentaire ne serait aspiré dans la copie
# puis revendiqué par les assertions du seed.
code=$(api GET "/rest/v1/workflow_steps?workflow_id=eq.$WF_ID&select=id")
attendu "$code" "inventaire exact des étapes source avant copie" 200
[ "$(jq -r 'length' "$CORPS")" -eq "${#ETAPES[@]}" ] || \
	die "le workflow source porte des étapes étrangères au seed : aucune copie n'est reconstruite."

code=$(api GET "/rest/v1/workflow_transitions?workflow_id=eq.$WF_ID&select=id")
attendu "$code" "inventaire exact des transitions source avant copie" 200
[ "$(jq -r 'length' "$CORPS")" -eq "${#TRANSITIONS[@]}" ] || \
	die "le workflow source porte des transitions étrangères au seed : aucune copie n'est reconstruite."

code=$(api GET "/rest/v1/form_fields?workflow_id=eq.$WF_ID&select=id")
attendu "$code" "inventaire exact des champs source avant copie" 200
[ "$(jq -r 'length' "$CORPS")" -eq "${#CHAMPS[@]}" ] || \
	die "le workflow source porte des champs étrangers au seed : aucune copie n'est reconstruite."

code=$(api GET "/rest/v1/form_field_rules?workflow_id=eq.$WF_ID&select=field_id,step_id")
attendu "$code" "inventaire exact des règles source avant copie" 200
[ "$(jq -r 'length' "$CORPS")" -eq "${#REGLES[@]}" ] || \
	die "le workflow source porte des règles étrangères au seed : aucune copie n'est reconstruite."

code=$(api GET "/rest/v1/workflow_transitions?workflow_id=eq.$WF_ID&select=id,workflow_transition_required_fields(field_id)")
attendu "$code" "inventaire exact des exigences source avant copie" 200
[ "$(jq -r '[.[].workflow_transition_required_fields[]?] | length' "$CORPS")" -eq 1 ] || \
	die "le workflow source ne porte pas exactement l'exigence seedée : aucune copie n'est reconstruite."
info "Source : ${#CHAMPS[@]} champs, ${#REGLES[@]} règles et 1 exigence — prête à copier"


# --- 7. Copie vers un track — docs/SPEC-workflow-engine.md §4.10 --------------------------------
# Cette section n'écrit **aucune** ligne directement : elle appelle `copy_workflow_to_track`, la
# véritable fonction du produit, par la véritable route — l'appel RPC de l'API REST. `CLAUDE.md` §8
# l'exige : « une inscription doit utiliser le véritable flux applicatif ».
#
# Quatre différences avec les sections précédentes, et toutes voulues.
#
# 1. **Le jeton employé est celui de l'administrateur seedé, obtenu par la vraie route de
#    connexion**, et non la clé de service. La fonction exige `app.is_workspace_admin`, qui lit
#    `auth.uid()` : la clé de service n'a pas de `sub`, `auth.uid()` y est nul, et l'appel serait
#    refusé par `workflow_not_found`. Ce n'est pas un obstacle contourné, c'est la garde qui
#    fonctionne — et le seed la traverse comme un administrateur le ferait.
#
# 2. **La convergence est vérifiée avant d'agir**, et non obtenue par un upsert : la fonction crée
#    toujours une ligne neuve. Le seed sélectionne sa candidate par le nom déclaré, avec repli sur
#    une dérivation unique ; un état ambigu est refusé et aucune copie utilisateur n'est détruite.
#
#    DÉFAUT RÉEL CORRIGÉ ICI PAR `CRM-033` — INC-041. La recherche portait sur la source **et** le
#    track. MESURÉ, reproductible en quatre gestes : le `track_id` de la copie déplacé à la main, la
#    recherche ne la trouvait plus et le seed en créait une **seconde**. Le contrat en déclare une ;
#    le seed en laissait deux, sans erreur ni avertissement. Il était idempotent sans être
#    convergent — troisième forme de la décision 57, la première sur un seed.
#
#    Le track est **ramené** à la valeur déclarée plutôt que de servir de critère de recherche.
#    Une dérivation supplémentaire est préservée conformément à la décision 300.
#
# 3. **`prospection` suit la copie**, et non le workflow global (docs/SPEC-workflow-engine.md
#    §4.12.7). Sans ce rattachement, le cas accepté le plus intéressant de la règle de `CRM-033` — un
#    workflow `track` sur un channel de **son** track — serait documenté sans être démontrable.
#
#    L'ordre des trois gestes n'est pas indifférent : le channel est d'abord rendu au workflow
#    global, ce qui **libère** la copie, puis la copie est ramenée à son track déclaré, puis le
#    channel la rejoint. Rattacher d'abord ferait refuser la convergence par le trigger de
#    `CRM-033`, qui interdit de déplacer un workflow sous ses occupants — la garde fonctionnant, le
#    seed la traverse dans le bon ordre plutôt que de la contourner.
#
# 4. **LA SÉQUENCE DES TROIS GESTES EST DÉSORMAIS CONDITIONNELLE** — `CRM-046`, décision 221,
#    docs/SPEC-seed.md §9.2.
#
#    Le premier des trois — la libération — ramène `prospection` au workflow global. Tant qu'aucune
#    card n'y vivait, le geste était gratuit ; dès qu'une card l'occupe, la clé étrangère composite
#    `cards (channel_id, workflow_id)` le refuse en `23503`. Or il n'a d'objet que si la copie doit
#    réellement bouger.
#
#    La séquence n'est donc jouée que si la copie **diverge** de son contrat — portée, track, nom,
#    défaut, archivage — ou si le channel ne la suit pas. Sur une base conforme, la section ne fait
#    AUCUNE écriture et le dit. Sur une base neuve, la copie n'existe pas : elle est créée par la
#    fonction du produit, puis le channel la rejoint — et aucune card n'existe encore, la section
#    8 ter venant après.
#
#    IL SUBSISTE UN CAS D'ÉCHEC LÉGITIME, et le seed le NOMME au lieu de laisser lire un `23503`
#    brut : une copie déplacée à la main **et** des cards dans `prospection`. La réparation exige
#    alors de déplacer le workflow d'un channel peuplé, ce qu'INC-046 interdit et doit interdire.

echo
say "7. Copie du workflow vers un track"

JETON_ADMIN=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" \
	-H "apikey: $(env_get "$ENV_FILE" ANON_KEY)" -H 'Content-Type: application/json' \
	-d "$(jq -nc --arg m 'admin@p2enjoy.test' --arg p "$SEED_PASSWORD" \
	      '{email: $m, password: $p}')" \
	| jq -r '.access_token // empty')
[ -n "$JETON_ADMIN" ] || die "connexion de l'administrateur seedé impossible : la copie ne peut pas
        être créée par la véritable route."

# Rend le code HTTP d'un appel effectué avec le jeton RÉEL de l'administratrice.
#
# ELLE EST DÉFINIE ICI, ET NON PLUS À LA SECTION 8 SEXIES qui l'a introduite : la section 8
# quinquies en a besoin depuis la décision 376 pour retirer `…d4` comme un modérateur le ferait.
# La dupliquer aurait garanti que les deux copies divergent.
api_admin() {
	local method=$1 chemin=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$API$chemin" \
		-H "apikey: $(env_get "$ENV_FILE" ANON_KEY)" \
		-H "Authorization: Bearer $JETON_ADMIN" \
		-H 'Content-Type: application/json' \
		"$@"
}

# L'état réel est relu AVANT toute écriture — décision 221. Trois questions, et leurs réponses
# décident de tout ce qui suit : combien de copies existent, laquelle est conforme à son contrat, et
# le channel la suit-il déjà.
code=$(api GET "/rest/v1/workflows?select=id,scope,track_id,name,is_default,archived_at,source_composition_fingerprint&derived_from_workflow_id=eq.$WF_ID&order=created_at")
attendu "$code" "recherche d'une copie existante" 200
COPIES_DERIVEES=$(cat "$CORPS")
selectionner_copie_seed "$CORPS"
copie_id=$copie_selectionnee

empreinte_copie=''
[ -z "$copie_id" ] || empreinte_copie=$(jq -r --arg id "$copie_id" \
	'.[] | select(.id == $id) | .source_composition_fingerprint // empty' <<< "$COPIES_DERIVEES")

composition_conforme='non'
composition_cible_verifiee='non'
if [ -n "$copie_id" ]; then
	code=$(api GET "/rest/v1/workflow_derivations?workflow_id=eq.$copie_id&select=source_modified_since_copy")
	attendu "$code" "comparaison de composition de la copie seedée" 200
	composition_conforme=$(jq -r \
		'if length == 1 and .[0].source_modified_since_copy == false then "oui" else "non" end' \
		"$CORPS")
fi

# `source_modified_since_copy` ne juge que la SOURCE. Une cible dont un libellé, une option, une
# règle ou une exigence aurait été modifié à compte constant passerait donc ce premier contrôle.
# Pour la seule fixture sélectionnée, les compositions normalisées doivent rester égales. Une
# divergence moderne est refusée avant toute écriture sur la cible : le seed ne s'approprie jamais
# une adaptation en la réécrivant silencieusement (décision 303).
if [ -n "$copie_id" ] && [ "$composition_conforme" = 'oui' ]; then
	verifier_composition_copie_seed "$copie_id"
	composition_cible_verifiee='oui'
fi

# DEUX CONFORMITÉS, ET NON UNE — défaut réel trouvé par `scripts/verify-seed-demo.sh`, décision 225.
#
# Conditionner TOUTE la réparation à la conformité de la copie fait perdre la convergence pour
# toute dérive : un nom modifié à la main n'était plus rattrapé dès qu'une card occupait
# « prospection ». Or une seule des colonnes du contrat exige de libérer le channel.
#
#   * `scope` et `track_id` — les DÉPLACER exige que le channel ne suive plus la copie : le trigger
#     de `CRM-033` interdit de déplacer un workflow sous ses occupants, et la clé composite refuse
#     de rendre le channel au workflow global si des cards y vivent. C'est le seul cas bloqué ;
#   * `name`, `is_default` et `archived_at` — leur convergence n'exige RIEN. Elle est faite
#     inconditionnellement, comme avant `CRM-046`.
copie_placee=$(jq -r --arg id "$copie_id" --arg tr "$WF_COPIE_TRACK" \
	'[.[] | select(.id == $id)] |
	 if length == 1 and .[0].scope == "track" and .[0].track_id == $tr
	 then "oui" else "non" end' <<< "$COPIES_DERIVEES")

# Une copie historique vide doit repasser par le vrai geste de copie. Une empreinte moderne
# divergente n'est jamais reconstruite automatiquement. Pour la fixture legacy, le seed ne retire
# que ses deux cards stables, uniquement sans formulaire, commentaire utilisateur, activité métier
# dans leur timeline ni card étrangère. Toute donnée inconnue transforme la réparation en refus
# explicite, jamais en perte silencieuse.
if [ -n "$copie_id" ] && [ "$composition_conforme" != 'oui' ]; then
	[ -z "$empreinte_copie" ] || die "la copie seedée porte une empreinte moderne mais sa source a
        divergé : refus de la reconstruire automatiquement. Inspecter $copie_id ou repartir d'une
        base locale neuve par ./resetMe.sh."

	code=$(api GET "/rest/v1/form_fields?workflow_id=eq.$copie_id&select=id&limit=1")
	attendu "$code" "absence de formulaire dans l'ancienne copie seedée" 200
	[ "$(jq -r 'length' "$CORPS")" -eq 0 ] || die "la copie legacy $copie_id porte déjà un
        formulaire : elle n'est pas reconstruite automatiquement pour ne perdre aucune adaptation."

	code=$(api GET "/rest/v1/cards?workflow_id=eq.$copie_id&select=id")
	attendu "$code" "inventaire des cards avant recréation de la copie seedée" 200
	cards_copie=$(cat "$CORPS")
	if jq -e '[.[] | select(.id != "5eed0000-0000-4000-8000-0000000000ca" and
	                       .id != "5eed0000-0000-4000-8000-0000000000cb")] | length > 0' \
		<<< "$cards_copie" >/dev/null; then
		die "la copie seedée a divergé mais porte une card non détenue par le seed. Elle n'est pas
	        recréée automatiquement : sauvegarder ou déplacer cette card, puis relancer le seed."
	fi

	code=$(api GET "/rest/v1/cards?id=in.(5eed0000-0000-4000-8000-0000000000ca,5eed0000-0000-4000-8000-0000000000cb)&select=id,workflow_id")
	attendu "$code" "propriété des identifiants de cards avant recréation de la copie seedée" 200
	if jq -e --arg copie "$copie_id" 'any(.[]; .workflow_id != $copie)' "$CORPS" >/dev/null; then
		die "au moins une card seedée de la copie existe dans un autre workflow. Sa propriété est
	        ambiguë : aucune reconstruction ni réaffectation automatique — décision 300."
	fi

	for card_seedee in 5eed0000-0000-4000-8000-0000000000ca 5eed0000-0000-4000-8000-0000000000cb; do
		code=$(api GET "/rest/v1/card_comments?card_id=eq.$card_seedee&select=id&limit=1")
		attendu "$code" "absence de commentaire utilisateur avant recréation de la copie" 200
		[ "$(jq -r 'length' "$CORPS")" -eq 0 ] || die "la card seedée $card_seedee porte un
	        commentaire : la copie divergente n'est pas recréée pour ne pas perdre cette parole."

		code=$(api GET "/rest/v1/card_events?card_id=eq.$card_seedee&select=type,actor_id")
		attendu "$code" "timeline de la card seedée avant recréation de la copie" 200
		if ! jq -e 'length == 0 or
			(length == 1 and .[0].type == "created" and .[0].actor_id == null)' \
			"$CORPS" >/dev/null; then
			die "la card seedée $card_seedee porte une activité métier dans sa timeline. La cascade
	        la détruirait : aucune reconstruction automatique — décision 305."
		fi
	done

	code=$(api DELETE "/rest/v1/cards?workflow_id=eq.$copie_id")
	attendu "$code" "retrait des seules cards seedées avant vraie recopie" 200 204
	warn "Copie historique sans formulaire : ses seules fixtures sont retirées avant vraie recopie"
fi

code=$(api GET "/rest/v1/channels?id=eq.$WF_COPIE_CHANNEL&select=workflow_id")
attendu "$code" "relecture du rattachement de prospection" 200
channel_wf=$(jq -r '.[0].workflow_id // empty' "$CORPS")

# LE CHEMIN COURT, et c'est celui de toute base dont la copie est BIEN PLACÉE : sa portée et son
# track sont conformes, et le channel la suit. La libération ci-dessous ramènerait `prospection` au
# workflow global, ce que la clé étrangère composite refuse dès qu'une card l'occupe (§9.2, mesuré).
# Les trois autres colonnes sont convergées juste après, hors de cette branche.
if [ "$copie_placee" = 'oui' ] && [ "$composition_conforme" = 'oui' ] \
	&& [ -n "$copie_id" ] && [ "$channel_wf" = "$copie_id" ]; then
	info "Copie conforme et prospection la suit déjà : AUCUNE écriture (convergence par état, §9.2)"
	info "Copie : ${#ETAPES[@]} étapes et ${#TRANSITIONS[@]} transitions reprises, lignage renseigné"
	WF_COPIE_ID="$copie_id"
else
	# Quelque chose diverge. La réparation exige de déplacer le workflow de `prospection`, ce que
	# la clé composite refuse si des cards l'occupent. Le cas est NOMMÉ plutôt que laissé à un
	# `23503` brut — INC-046, docs/SPEC-seed.md §9.2.
	code=$(api GET "/rest/v1/cards?channel_id=eq.$WF_COPIE_CHANNEL&select=id&limit=1")
	attendu "$code" "recherche de cards dans prospection avant réparation" 200
	if [ "$(jq -r 'length' "$CORPS")" -gt 0 ]; then
		die "la copie de portée track est MAL PLACÉE — portée ou track divergents — et des cards
        occupent « prospection ». Réparer exigerait de déplacer le workflow d'un channel peuplé, ce que la clé étrangère
        composite « cards_channel_id_workflow_id_fkey » refuse — INC-046, docs/SPEC-seed.md §9.2.
        Copies trouvées : $copies_total, bien placée : $copie_placee, channel sur : ${channel_wf:-aucun}.
        Rétablir le rattachement à la main, ou repartir d'une base neuve par ./resetMe.sh."
	fi
	warn "Portée, track ou rattachement divergents : la séquence de réparation est jouée (§9.2)"

	# Le channel est rendu au workflow global : la copie doit être **libre** pour que son track
	# puisse être ramené à la valeur déclarée.
	code=$(api PATCH "/rest/v1/channels?id=eq.$WF_COPIE_CHANNEL" \
		-H 'Prefer: return=representation' \
		-d "$(jq -nc --arg wf "$WF_ID" '{workflow_id: $wf}')")
	attendu "$code" "libération du channel $WF_COPIE_CHANNEL avant convergence de la copie" 200

	if [ -n "$copie_id" ] && [ "$composition_conforme" != 'oui' ]; then
		code=$(api DELETE "/rest/v1/workflows?id=eq.$copie_id")
		attendu "$code" "retrait de la copie seedée à recomposer par la vraie RPC" 200 204
		warn "Copie $copie_id retirée : son empreinte était absente ou divergente"
		copie_id=''
	fi

	if [ -n "$copie_id" ]; then
		# Convergence : la copie retrouvée est **ramenée** à son track et à son nom déclarés. C'est ce
		# qui manquait, et ce qui faisait naître une seconde copie (INC-041).
		code=$(api PATCH "/rest/v1/workflows?id=eq.$copie_id" \
			-H 'Prefer: return=representation' \
			-d "$(jq -nc --arg tr "$WF_COPIE_TRACK" --arg nom "$WF_COPIE_NOM" \
			      '{scope: "track", track_id: $tr, name: $nom, is_default: false, archived_at: null}')")
		attendu "$code" "convergence de la copie $WF_COPIE_NOM" 200
		info "Copie déjà présente : $WF_COPIE_NOM — ramenée à son contrat (seed convergent)"
	else
		copie_id=$(curl -s -X POST "$API/rest/v1/rpc/copy_workflow_to_track" \
			-H "apikey: $(env_get "$ENV_FILE" ANON_KEY)" \
			-H "Authorization: Bearer $JETON_ADMIN" \
			-H 'Content-Type: application/json' \
			-d "$(jq -nc --arg wf "$WF_ID" --arg tr "$WF_COPIE_TRACK" --arg nom "$WF_COPIE_NOM" \
			      '{workflow_id: $wf, track_id: $tr, new_name: $nom}')" \
			| jq -r 'if type == "string" then . else empty end')
		[ -n "$copie_id" ] || die "l'appel à copy_workflow_to_track n'a rendu aucun identifiant."
		info "$WF_COPIE_NOM — créée par copy_workflow_to_track, portée track"
	fi

	info "Copie : ${#ETAPES[@]} étapes et ${#TRANSITIONS[@]} transitions reprises, lignage renseigné"

	# `prospection` rejoint la copie : un workflow de portée `track` sur un channel de **son** track,
	# cas accepté de la règle de `CRM-033` (docs/SPEC-workflow-engine.md §4.12.7).
	code=$(api PATCH "/rest/v1/channels?id=eq.$WF_COPIE_CHANNEL" \
		-H 'Prefer: return=representation' \
		-d "$(jq -nc --arg wf "$copie_id" '{workflow_id: $wf}')")
	attendu "$code" "rattachement de prospection à la copie de portée track" 200
	WF_COPIE_ID="$copie_id"
fi

[ -n "$WF_COPIE_ID" ] || die "la copie de portée track n'a pas d'identifiant à l'issue de la
        section 7 : les cards du workflow dérivé ne peuvent pas être posées (docs/SPEC-seed.md §9.4)."

# Convergence des trois colonnes qui n'exigent AUCUNE libération — décision 225. Elle est faite
# quel que soit le chemin emprunté ci-dessus : un nom modifié à la main, une copie archivée ou
# promue par défaut sont rattrapés même lorsque des cards occupent « prospection ».
#
# `scope` et `track_id` ne sont PAS de ce lot : les déplacer est le seul geste que la clé composite
# et le trigger de `CRM-033` peuvent refuser, et il vit dans la branche de réparation ci-dessus.
code=$(api PATCH "/rest/v1/workflows?id=eq.$WF_COPIE_ID" \
	-H 'Prefer: return=representation' \
	-d "$(jq -nc --arg nom "$WF_COPIE_NOM" '{name: $nom, is_default: false, archived_at: null}')")
attendu "$code" "convergence du nom, du défaut et de l'archivage de la copie" 200

info "prospection suit $WF_COPIE_NOM — les cinq autres channels suivent le workflow global"

# --- 8. Vérification du formulaire réellement copié — CRM-018, décision 293 --------------------
# Cette section ne fabrique aucune composition dérivée. Elle constate que le vrai geste de copie a
# remappé chaque famille. Une copie ancienne sans empreinte est traitée plus haut par le chemin de
# recréation seedé ; une copie utilisateur n'est jamais complétée ici par des insertions directes.

echo
say "8. Formulaire et exigences de la copie"

code=$(api GET "/rest/v1/form_fields?workflow_id=eq.$WF_COPIE_ID&select=id,key")
attendu "$code" "lecture des champs remappés de la copie" 200
CHAMPS_COPIE=$(cat "$CORPS")
[ "$(jq -r 'length' <<< "$CHAMPS_COPIE")" -eq "${#CHAMPS[@]}" ] || \
	die "la copie ne porte pas les ${#CHAMPS[@]} champs attendus : reset local requis, CRM-018."
[ "$(jq -r '[.[].id] | unique | length' <<< "$CHAMPS_COPIE")" -eq "${#CHAMPS[@]}" ] || \
	die "la copie porte des identifiants de champ dupliqués : invariant CRM-018 rompu."

code=$(api GET "/rest/v1/form_field_rules?workflow_id=eq.$WF_COPIE_ID&select=field_id,step_id")
attendu "$code" "lecture des règles remappées de la copie" 200
[ "$(jq -r 'length' "$CORPS")" -eq "${#REGLES[@]}" ] || \
	die "la copie ne porte pas les ${#REGLES[@]} règles attendues : invariant CRM-018 rompu."

code=$(api GET "/rest/v1/workflow_transitions?workflow_id=eq.$WF_COPIE_ID&select=id,workflow_transition_required_fields(field_id)")
attendu "$code" "lecture de l'exigence remappée de la copie" 200
[ "$(jq -r '[.[].workflow_transition_required_fields[]?] | length' "$CORPS")" -eq 1 ] || \
	die "la copie doit porter exactement une exigence de transition remappée — CRM-018."

if jq -e --argjson source "$(printf '%s\n' "${CHAMPS[@]}" | cut -d'|' -f1 | jq -Rsc 'split("\n")[:-1]')" \
	'$source as $ids_source | any(.[]; .id as $id | ($ids_source | index($id)) != null)' \
	<<< "$CHAMPS_COPIE" >/dev/null; then
	die "la copie partage au moins un identifiant de champ avec sa source — CRM-018."
fi
[ "$composition_cible_verifiee" = 'oui' ] || verifier_composition_copie_seed "$WF_COPIE_ID"
info "Copie : ${#CHAMPS[@]} champs, ${#REGLES[@]} règles et 1 exigence, tous remappés"

# --- 8 bis. Droits fins par track et par channel — docs/SPEC-seed.md §2.11 ---------------------
# Posés par la véritable API REST avec la clé de service, comme tout le reste du seed. La clé de
# service est employée ici pour la même raison qu'aux sections précédentes : l'écriture par un
# **administrateur** est possible depuis `CRM-012` (§4.1), mais le seed doit pouvoir s'appliquer
# sur une base où aucun compte n'est encore connecté. Le geste d'administration réel est prouvé
# hors du seed, par `e2e/api/droits-fins.spec.ts` avec le jeton de l'administratrice.
#
# La clé primaire est le couple `(cible, utilisateur)` : `merge-duplicates` rend l'application
# convergente, un rejeu ne crée aucun doublon et corrige un `access` divergent.

echo
say "8 bis. Droits fins par track et par channel"

for ligne in "${DROITS_FINS[@]}"; do
	IFS='|' read -r table cible compte acces <<< "$ligne"

	case "$table" in
		track_members)   colonne=track_id ;;
		channel_members) colonne=channel_id ;;
		*) die "table de droit fin inconnue « $table » — corrigez DROITS_FINS." ;;
	esac

	charge=$(jq -nc --arg colonne "$colonne" --arg cible "$cible" --arg u "$compte" \
	               --arg a "$acces" \
	     '{($colonne): $cible, user_id: $u, access: $a}')

	code=$(api POST "/rest/v1/$table" \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "droit fin $table ${cible: -3} → ${compte: -3}" 200 201

	printf '  %-16s %-6s %s\n' "$table" "${cible: -3}" "$acces"
done
info "Droits fins : ${#DROITS_FINS[@]} — une ligne par situation de la matrice (docs/SPEC-permissions-rls.md §2.2)"
info "Farida Nowak (viewer) ne voit plus « Conseil & IA », mais voit « Prospection » : le droit"
info "de channel rouvre ce que le droit de track ferme. Camille Aubert (admin) voit tout."

# --- 8 ter. Cards — docs/SPEC-cards.md §9 ------------------------------------------------------
# Mêmes règles que les sections précédentes : véritable API REST, clé de service, écriture
# convergente sur la clé primaire.
#
# Cette section vient **après** la copie de la section 7, et l'ordre n'est pas indifférent : à froid,
# `prospection` rejoint d'abord le workflow dérivé, puis seulement ses deux cards sont insérées. Au
# rejeu, les sections 4 et 7 conservent ce rattachement à l'identique ; la clé composite de
# `CRM-040` interdirait de le faire osciller sous les cards (INC-046).
#
# `workflow_id` vaut `$WF_ID` — le workflow **global** — pour les douze lignes de `CARDS`; leurs
# channels le suivent tous. Les deux lignes de `CARDS_DERIVE` résolvent au contraire
# `$WF_COPIE_ID` et les étapes de la copie avant leur écriture : aucune identité dérivée n'est figée
# dans le contrat, et la clé composite refuserait tout mélange en `23503`.

echo
say "8 ter. Cards"

# Poser UNE card du workflow global à partir d'une ligne de contrat.
#
# Extraite du corps de boucle par `CRM-046` tranche 2 (docs/SPEC-seed.md §9.11) : la section
# 8 ter ter pose vingt-six cards de plus, avec exactement le même contrat et exactement la même
# écriture. Recopier le corps aurait créé deux chemins d'écriture divergents pour une même table —
# le premier défaut que corrigerait la première évolution du contrat.
poser_card_globale() {
	local ligne="$1"
	local id channel etape titre owner montant devise position action echeance archive corbeille
	local owner_json montant_json action_json echeance_json archive_json corbeille_json charge code etat

	IFS='|' read -r id channel etape titre owner montant devise position action echeance archive corbeille <<< "$ligne"

	[ "$owner"     = '-' ] && owner_json='null'     || owner_json=$(jq -nc --arg v "$owner" '$v')
	[ "$montant"   = '-' ] && montant_json='null'   || montant_json=$montant
	[ "$action"    = '-' ] && action_json='null'    || action_json=$(jq -nc --arg v "$action" '$v')
	[ "$echeance"  = '-' ] && echeance_json='null'  || echeance_json=$(jq -nc --arg v "$echeance" '$v')
	[ "$archive"   = '-' ] && archive_json='null'   || archive_json=$(jq -nc --arg v "$archive" '$v')
	[ "$corbeille" = '-' ] && corbeille_json='null' || corbeille_json=$(jq -nc --arg v "$corbeille" '$v')

	charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg ch "$channel" --arg wf "$WF_ID" \
	               --arg etape "$etape" --arg titre "$titre" --arg devise "$devise" \
	               --argjson position "$position" --argjson owner "$owner_json" \
	               --argjson montant "$montant_json" --argjson action "$action_json" \
	               --argjson echeance "$echeance_json" --argjson archive "$archive_json" \
	               --argjson corbeille "$corbeille_json" \
	     '{id: $id, workspace_id: $ws, channel_id: $ch, workflow_id: $wf, current_step_id: $etape,
	       title: $titre, owner_id: $owner, amount: $montant, currency: $devise,
	       position: $position, next_action: $action, next_action_at: $echeance,
	       created_by: "5eed0000-0000-4000-8000-000000000011",
	       archived_at: $archive, deleted_at: $corbeille}')

	code=$(api POST /rest/v1/cards \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la card ${titre:0:28}" 200 201

	if   [ "$corbeille" != '-' ]; then etat='corbeille'
	elif [ "$archive"   != '-' ]; then etat='archivée'
	else                               etat='active'
	fi
	printf '  %-36s %-10s %s\n' "${titre:0:36}" "$etat" "$(jq -r '.[0].email_local_part // "?"' "$CORPS")"
}

for ligne in "${CARDS[@]}"; do
	poser_card_globale "$ligne"
done

info "Cards du workflow global : ${#CARDS[@]}, aux SEPT étapes, dont une archivée et une en corbeille"
info "— docs/SPEC-cards.md §9, étendu par CRM-046 (docs/SPEC-seed.md §9.3)."


# --- 8 ter ter. Volume et données longues — docs/SPEC-seed.md §9.11 ----------------------------
# Ajoutée par `CRM-046` tranche 2. Même contrat, même écriture, même fonction que la section 8 ter :
# ces cards ne sont pas d'une autre nature, elles sont simplement NOMBREUSES et l'une d'elles est
# LONGUE. Le motif de chaque choix — le channel, le compte de vingt-sept, les cinq étapes, la card
# `…d001` — est écrit au-dessus du tableau `CARDS_VOLUME`.

echo
say "8 ter ter. Volume et données longues"

for ligne in "${CARDS_VOLUME[@]}"; do
	poser_card_globale "$ligne"
done

info "Cards de volume : ${#CARDS_VOLUME[@]} dans « maintenance », qui porte désormais VINGT-SEPT cards actives"
info "La première page de la vue liste est PLEINE (25 lignes) et la seconde en porte deux — CRM-042"
info "« $(printf '%s' "${CARDS_VOLUME[0]}" | cut -d'|' -f4 | cut -c1-40)… » porte 128 caractères de titre et 134 de prochaine action"
info "— docs/SPEC-seed.md §9.11 : les données longues et la seconde page cessent d'être substituées."


# --- 8 ter bis. Cards du workflow DÉRIVÉ — docs/SPEC-seed.md §9.3 et §9.4 ----------------------
# Ajoutée par `CRM-046`. Elle est la seule section du seed dont deux clés étrangères sont RÉSOLUES
# À L'EXÉCUTION, et le motif est le produit lui-même : `copy_workflow_to_track` frappe la copie et
# ses sept étapes avec `gen_random_uuid()` (décision 222).
#
# La résolution passe par la **clé de nœud** du catalogue, stable et déclarée en section 5. Elle est
# obtenue par la jointure embarquée de PostgREST sur `workflow_nodes_catalog`, une seule requête
# pour les sept étapes.
#
# SI LA COPIE OU L'ÉTAPE MANQUE, LE SEED ÉCHOUE EN LE DISANT. Poser ces cards sur le workflow global
# rendrait un seed vert et un contrat faux : le board lit les étapes du workflow **du channel**, et
# la card n'apparaîtrait dans aucune colonne.
#
# Cette section vient après la section 8 ter pour une raison de lisibilité seule : rien ne la lie
# aux douze cards du workflow global. Elle vient en revanche nécessairement après la section 7, qui
# établit la copie et le rattachement du channel.

echo
say "8 ter bis. Cards du workflow dérivé"

code=$(api GET "/rest/v1/workflow_steps?workflow_id=eq.$WF_COPIE_ID&select=id,workflow_nodes_catalog(key)")
attendu "$code" "lecture des étapes de la copie de portée track" 200
ETAPES_COPIE=$(cat "$CORPS")

for ligne in "${CARDS_DERIVE[@]}"; do
	IFS='|' read -r id channel cle_noeud titre owner montant devise position action echeance <<< "$ligne"

	etape=$(printf '%s' "$ETAPES_COPIE" | jq -r --arg k "$cle_noeud" \
		'.[] | select(.workflow_nodes_catalog.key == $k) | .id' | head -n 1)
	[ -n "$etape" ] || die "la copie de portée track ne porte aucune étape instanciant le nœud
        « $cle_noeud » : la card « $titre » ne peut pas être posée sans mentir sur son workflow
        (docs/SPEC-seed.md §9.4)."

	[ "$owner"    = '-' ] && owner_json='null'    || owner_json=$(jq -nc --arg v "$owner" '$v')
	[ "$montant"  = '-' ] && montant_json='null'  || montant_json=$montant
	[ "$action"   = '-' ] && action_json='null'   || action_json=$(jq -nc --arg v "$action" '$v')
	[ "$echeance" = '-' ] && echeance_json='null' || echeance_json=$(jq -nc --arg v "$echeance" '$v')

	charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg ch "$channel" --arg wf "$WF_COPIE_ID" \
	               --arg etape "$etape" --arg titre "$titre" --arg devise "$devise" \
	               --argjson position "$position" --argjson owner "$owner_json" \
	               --argjson montant "$montant_json" --argjson action "$action_json" \
	               --argjson echeance "$echeance_json" \
	     '{id: $id, workspace_id: $ws, channel_id: $ch, workflow_id: $wf, current_step_id: $etape,
	       title: $titre, owner_id: $owner, amount: $montant, currency: $devise,
	       position: $position, next_action: $action, next_action_at: $echeance,
	       created_by: "5eed0000-0000-4000-8000-000000000011",
	       archived_at: null, deleted_at: null}')

	code=$(api POST /rest/v1/cards \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la card ${titre:0:28}" 200 201

	printf '  %-36s %-14s %s\n' "${titre:0:36}" "$cle_noeud" "$(jq -r '.[0].email_local_part // "?"' "$CORPS")"
done

info "Cards du workflow dérivé : ${#CARDS_DERIVE[@]}, dans « prospection », à deux étapes distinctes"
info "Leurs workflow_id et current_step_id sont RÉSOLUS, jamais écrits — docs/SPEC-seed.md §9.4"
info "Leurs valeurs de formulaire seront résolues par clé vers les champs réellement copiés (§9.5)"


# --- 8 quater. Valeurs de formulaire — docs/SPEC-form-composer.md §6.11 ------------------------
# Mêmes règles que les sections précédentes : véritable API REST, clé de service, écriture
# convergente sur la clé primaire composite `(card_id, field_id)`.
#
# Cette section vient **après** les cards et **après** les champs, et l'ordre est structurel : les
# deux clés étrangères composites de la migration 13 exigent que la card et le champ existent tous
# deux, et qu'ils désignent le MÊME workflow. Un ordre différent ferait échouer le seed en `23503`,
# jamais en silence.
#
# `workflow_id` vaut `$WF_ID` pour les dix-huit valeurs historiques ; les trois autres résolvent
# leurs champs dans `$WF_COPIE_ID`. Dans les deux familles, les clés composites refusent toute
# valeur dont la card et le champ ne suivent pas le même workflow.
#
# LE TRIGGER DE VALIDATION S'APPLIQUE ICI COMME AILLEURS. Le seed n'écrit pas « à côté » du
# produit : une valeur mal typée ferait échouer cette section, ce qui est exactement le
# comportement voulu — `CLAUDE.md` §8 proscrit les traces fabriquées.

echo
say "8 quater. Valeurs de formulaire"

for ligne in "${VALEURS[@]}"; do
	IFS='|' read -r card champ valeur <<< "$ligne"

	charge=$(jq -nc --arg card "$card" --arg champ "$champ" --arg wf "$WF_ID" --arg ws "$WS_ID" \
	               --argjson valeur "$valeur" \
	     '{card_id: $card, field_id: $champ, workflow_id: $wf, workspace_id: $ws, value: $valeur,
	       updated_by: "5eed0000-0000-4000-8000-000000000011"}')

	code=$(api POST /rest/v1/card_field_values \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "valeur ${card: -2}×${champ: -3}" 200 201

	printf '  card %s  champ %s  %s\n' "${card: -2}" "${champ: -3}" "$valeur"
done

for ligne in "${VALEURS_DERIVE[@]}"; do
	IFS='|' read -r card cle_champ valeur <<< "$ligne"
	champ=$(jq -r --arg cle "$cle_champ" '.[] | select(.key == $cle) | .id' <<< "$CHAMPS_COPIE")
	[ -n "$champ" ] || die "le champ dérivé « $cle_champ » manque : impossible de démontrer sa valeur."

	charge=$(jq -nc --arg card "$card" --arg champ "$champ" --arg wf "$WF_COPIE_ID" --arg ws "$WS_ID" \
	               --argjson valeur "$valeur" \
	     '{card_id: $card, field_id: $champ, workflow_id: $wf, workspace_id: $ws, value: $valeur,
	       updated_by: "5eed0000-0000-4000-8000-000000000011"}')
	code=$(api POST /rest/v1/card_field_values \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "valeur dérivée ${card: -2}×$cle_champ" 200 201
	printf '  card %s  champ dérivé %-20s %s\n' "${card: -2}" "$cle_champ" "$valeur"
done

info "Valeurs : $(( ${#VALEURS[@]} + ${#VALEURS_DERIVE[@]} )) sur 11 cards, dont 3 remappées sur la copie — docs/SPEC-form-composer.md §6.11"
info "« budget » de la card c1 vaut null : une ligne présente n'est PAS une valeur renseignée (§6.6)"

# --- 8 quinquies. Commentaires — docs/SPEC-cards.md §13.11 -------------------------------------
# CETTE SECTION NE CONVERGE PAS COMME LES AUTRES, et le motif est structurel (docs/SPEC-seed.md
# §2.14). Partout ailleurs le seed emploie `resolution=merge-duplicates` : la ligne présente est
# réécrite, ce qui répare une modification faite à la main. Ici ce geste ÉCHOUERAIT — le trigger de
# la migration 15 refuse toute écriture sur une ligne supprimée (`comment_deleted`), et le rejeu
# tomberait en erreur sur `…d4`. Il serait de surcroît faux dans son principe : un commentaire est
# une PAROLE, non un paramètre ; la réécrire à chaque rejeu effacerait ce qu'un utilisateur aurait
# ajouté.
#
# La section emploie donc `resolution=ignore-duplicates` pour les cinq insertions, puis deux mises
# à jour CONDITIONNÉES PAR UNE RELECTURE. La convergence est celle de la PRÉSENCE ET DE L'ÉTAT,
# non celle du contenu.
#
# Elle vient après les cards : la clé composite `(card_id, workspace_id)` exige que la card existe,
# et le trigger d'insertion lit son `workspace_id`.

echo
say "8 quinquies. Commentaires"

for ligne in "${COMMENTAIRES[@]}"; do
	IFS='|' read -r id card auteur corps <<< "$ligne"

	charge=$(jq -nc --arg id "$id" --arg card "$card" --arg auteur "$auteur" --arg corps "$corps" \
	     '{id: $id, card_id: $card, author_id: $auteur, body: $corps}')

	code=$(api POST /rest/v1/card_comments \
		-H 'Prefer: return=representation,resolution=ignore-duplicates' \
		-d "$charge")
	attendu "$code" "commentaire ${id: -2}" 200 201

	printf '  %-4s card %s  auteur %s\n' "${id: -2}" "${card: -2}" "${auteur: -2}"
done

# --- L'état « modifié », posé par le produit et non fabriqué ----------------------------------
# `edited_at` est écrite par le trigger SI ET SEULEMENT SI le corps change. Le seed ne peut donc
# pas la poser : il modifie réellement le corps, et le produit marque.
etat_d3=$(curl -s "$API/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d3&select=edited_at" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].edited_at // "null"')

if [ "$etat_d3" = 'null' ]; then
	charge=$(jq -nc --arg corps "$COMMENTAIRE_D3_MODIFIE" '{body: $corps}')
	code=$(api PATCH '/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d3' \
		-H 'Prefer: return=representation' -d "$charge")
	attendu "$code" "modification du commentaire d3" 200
	info "d3 modifié : edited_at posé par le trigger, non par le seed"
else
	info "d3 déjà modifié : rien à faire (convergence par état)"
fi

# --- L'état « retiré par la modération », posé par un MODÉRATEUR RÉEL --------------------------
# docs/SPEC-cards.md §13.11, docs/SPEC-seed.md §2.14, décision 376, INC-072.
#
# La date envoyée est ignorée : le trigger pose `now()` et VIDE le corps. Le seed ne fabrique donc
# aucune pierre tombale — il demande le retrait, et le produit le réalise.
#
# LE JETON RÉEL DE L'ADMINISTRATRICE, ET NON LA CLÉ DE SERVICE, ET C'EST TOUT L'INTÉRÊT DE LA
# LIGNE. La clé de service ne porte aucune revendication `sub` : `auth.uid()` y est nul, le trigger
# écrit donc `deleted_by = NULL`, et la pierre tombale démontre la destruction du corps mais JAMAIS
# la modération. Or `…d4` porte « Note interne publiée par erreur sur la mauvaise affaire », écrite
# par Driss Lemoine : c'est littéralement le propos qu'une administratrice retirerait, et le seul
# geste qui le démontre est celui qu'un modérateur ferait.
#
# Camille Aubert n'est PAS l'auteur de `…d4`. Ce `PATCH` traverse donc réellement la politique
# `card_comments_moderation` et la borne du trigger : il ne pose que `deleted_at`, et toute autre
# écriture rendrait `comment_moderation_limitee`. Le seed éprouve ainsi la règle en l'appliquant.
etat_d4=$(curl -s "$API/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d4&select=deleted_at" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].deleted_at // "null"')

if [ "$etat_d4" = 'null' ]; then
	code=$(api_admin PATCH '/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d4' \
		-H 'Prefer: return=representation' -d '{"body": "", "deleted_at": "2026-08-04T15:00:00Z"}')
	attendu "$code" "retrait du commentaire d4 par la modération" 200
	corps_d4=$(jq -r '.[0].body' "$CORPS")
	[ "$corps_d4" = '' ] || die "d4 retiré mais son corps n'est pas vide : « $corps_d4 »."
	auteur_du_retrait=$(jq -r '.[0].deleted_by // "null"' "$CORPS")
	[ "$auteur_du_retrait" = '5eed0000-0000-4000-8000-000000000011' ] \
		|| die "d4 retiré mais deleted_by vaut « $auteur_du_retrait » : le retrait n'a pas été fait
        par l'administratrice, et le seed ne démontre alors AUCUNE modération (INC-072)."
	info "d4 retiré par Camille Aubert : corps VIDÉ par le trigger, deleted_by relevé, date ignorée"
else
	info "d4 déjà retiré : rien à faire (convergence par état)"
fi

info "Commentaires : ${#COMMENTAIRES[@]} sur 3 cards, dont un modifié et un RETIRÉ PAR LA MODÉRATION — docs/SPEC-cards.md §13.11"
info "Celui de la card c5 porte pour auteur le viewer : témoin de la preuve de lecture (décision 50)"
info "Celui de la card c4 est retiré par un TIERS : deleted_by diffère d'author_id (INC-072, décision 376)"

# --- 8 sexies. Événements de timeline — docs/SPEC-cards.md §14.11, docs/SPEC-seed.md §2.15 -----
# LE SEED N'ÉCRIT AUCUN ÉVÉNEMENT, ET IL NE LE PEUT PAS. `card_events` n'accorde le privilège
# `INSERT` à personne, `service_role` compris — MESURÉ, décision 205. Cette section est donc la
# première dont le contenu est ENTIÈREMENT DÉRIVÉ des autres actes du seed : les 14 cards
# produisent chacune un `created`, et les 21 valeurs un `field_changed` lors d'un seed froid.
#
# Restent deux familles qu'aucune écriture du seed ne produit spontanément, parce que le seed pose
# ses cards dans leur état final : `moved` et `assigned`. Elles sont démontrées par DEUX
# ALLERS-RETOURS qui laissent l'état du seed RIGOUREUSEMENT IDENTIQUE — c'est la condition pour
# qu'aucune assertion des unités précédentes ne bouge. Seule l'histoire s'allonge.
#
# LES DEUX GESTES PASSENT PAR LE JETON RÉEL DE L'ADMINISTRATRICE, non par la clé de service :
#   * `move_card` refuserait la clé de service — `auth.uid()` y est nul, donc `card_not_found` ;
#   * et l'acteur des six événements est ainsi un PROFIL RÉEL, ce qu'aucun autre événement du
#     seed ne démontre (les 35 autres portent `actor_id` nul, marque du service).
#
# CONVERGENCE : les deux gestes sont CONDITIONNÉS PAR UNE RELECTURE. Un événement ne peut être ni
# réécrit ni supprimé ; sans cette garde, chaque rejeu allongerait le fil de quatre lignes et le
# seed cesserait de converger. La lecture passe par la clé de service, qui a le droit de LIRE la
# table sans avoir celui d'y écrire.

echo
say "8 sexies. Événements de timeline"

# Nombre d'événements d'un type déjà portés par une card, lu avec la clé de service.
evenements_de() {
	curl -s "$API/rest/v1/card_events?card_id=eq.$1&type=eq.$2&select=id" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		| jq -r 'length'
}

CARD_MOUVEMENT=5eed0000-0000-4000-8000-0000000000c4   # Refonte intranet Ville de Lyon, en négociation
ETAPE_NEGOCIATION=5eed0000-0000-4000-8000-000000000063
ETAPE_RELANCE=5eed0000-0000-4000-8000-000000000062
CARD_ATTRIBUTION=5eed0000-0000-4000-8000-0000000000c1 # Refonte du site vitrine
OWNER_DECLARE=5eed0000-0000-4000-8000-000000000012    # Driss Lemoine, responsable au contrat du seed
OWNER_TRANSITOIRE=5eed0000-0000-4000-8000-000000000011 # Camille Aubert, le temps de l'aller-retour

# --- Aller-retour d'étape : deux `moved`, par la VRAIE RPC -------------------------------------
# « Revenir en relance » puis « Engager la négociation » : deux transitions RÉELLEMENT DÉCLARÉES du
# workflow global. `entered_step_at` et `position` sont réécrits par `move_card` — seul effet que
# l'aller-retour ne rend pas à l'identique, et il est nommé (docs/SPEC-cards.md §14.11).
if [ "$(evenements_de "$CARD_MOUVEMENT" moved)" = '0' ]; then
	for etape in "$ETAPE_RELANCE" "$ETAPE_NEGOCIATION"; do
		code=$(api_admin POST /rest/v1/rpc/move_card \
			-d "$(jq -nc --arg c "$CARD_MOUVEMENT" --arg e "$etape" \
			      '{card_id: $c, to_step_id: $e}')")
		attendu "$code" "déplacement de ${CARD_MOUVEMENT: -2} vers ${etape: -2}" 200
	done
	etape_finale=$(jq -r '.current_step_id' "$CORPS")
	[ "$etape_finale" = "$ETAPE_NEGOCIATION" ] || die "l'aller-retour de ${CARD_MOUVEMENT: -2} n'a pas
        rendu la card à son étape de départ : « $etape_finale »."
	info "c4 : aller-retour d'étape par move_card — 2 événements moved, état rendu identique"
else
	info "c4 : déjà déplacée au moins une fois — rien à faire (convergence par état)"
fi

# --- Aller-retour de responsable : deux `assigned`, par un VRAI PATCH --------------------------
if [ "$(evenements_de "$CARD_ATTRIBUTION" assigned)" = '0' ]; then
	for proprietaire in "$OWNER_TRANSITOIRE" "$OWNER_DECLARE"; do
		code=$(api_admin PATCH "/rest/v1/cards?id=eq.$CARD_ATTRIBUTION" \
			-H 'Prefer: return=representation' \
			-d "$(jq -nc --arg o "$proprietaire" '{owner_id: $o}')")
		attendu "$code" "attribution de ${CARD_ATTRIBUTION: -2} à ${proprietaire: -2}" 200
	done
	owner_final=$(jq -r '.[0].owner_id' "$CORPS")
	[ "$owner_final" = "$OWNER_DECLARE" ] || die "l'aller-retour de responsable de ${CARD_ATTRIBUTION: -2}
        n'a pas rendu la card à son responsable déclaré : « $owner_final »."
	info "c1 : aller-retour de responsable par PATCH — 2 événements assigned, état rendu identique"
else
	info "c1 : déjà réattribuée au moins une fois — rien à faire (convergence par état)"
fi

# --- Aller-retour de channel : deux `channel_changed`, par la VRAIE RPC ------------------------
# docs/SPEC-seed.md §2.16, docs/SPEC-workflow-engine.md §6.12, décision 218 — `CRM-045`.
#
# CE QUE CE GESTE DÉMONTRE, ET QU'AUCUN AUTRE DU SEED NE DÉMONTRAIT : une card qui suit RÉELLEMENT
# un workflow DÉRIVÉ. `prospection` est le seul channel du seed rattaché à la copie de portée track
# créée en section 7. Deux cards dérivées y résident déjà ; INC-046 garantit précisément que nul ne
# peut repointer ce channel sous elles. L'aller-retour ajoute temporairement une card globale par la
# vraie RPC, lui fait emprunter le graphe dérivé, puis la rend à son channel et à son workflow.
#
# `…0c5` EST CHOISIE PARCE QU'ELLE NE PORTE AUCUNE RÉPONSE DE FORMULAIRE — MESURÉ, elle est l'une
# des trois dans ce cas. Le changement de workflow n'a donc rien à détruire, `discard_field_values`
# reste à `false`, et le seed ne démontre PAS la destruction : il ne le pourrait pas sans cesser
# d'être convergent, une réponse détruite ne renaissant pas au retour. La destruction est prouvée
# par `e2e/api/move-card-to-channel.spec.ts`, sur une card qu'elle crée et qu'elle détruit.
#
# L'ÉTAPE EST FOURNIE EXPLICITEMENT DANS LES DEUX SENS, et elle le doit : les deux workflows sont
# distincts, donc `step_mapping_required` refuserait un appel sans étape (§6.4). Les identifiants
# d'étapes de la copie sont tirés au hasard par `copy_workflow_to_track` — ils ne peuvent pas être
# écrits en dur, et sont donc LUS par la clé de service.

CARD_CHANNEL=5eed0000-0000-4000-8000-0000000000c5     # Support niveau 2, sans aucune réponse
CHANNEL_MAINTENANCE=5eed0000-0000-4000-8000-000000000035
CHANNEL_PROSPECTION=5eed0000-0000-4000-8000-000000000031
ETAPE_PROSPECT_GLOBAL=5eed0000-0000-4000-8000-000000000061

if [ "$(evenements_de "$CARD_CHANNEL" channel_changed)" = '0' ]; then
	# Première étape du workflow DÉRIVÉ, lue et non devinée.
	workflow_derive=$(curl -s "$API/rest/v1/channels?id=eq.$CHANNEL_PROSPECTION&select=workflow_id" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].workflow_id')
	etape_derivee=$(curl -s \
		"$API/rest/v1/workflow_steps?workflow_id=eq.$workflow_derive&select=id,position&order=position.asc&limit=1" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].id')
	[ -n "$etape_derivee" ] && [ "$etape_derivee" != null ] \
		|| die "l'étape initiale du workflow dérivé de prospection est introuvable."

	for cible in "$CHANNEL_PROSPECTION:$etape_derivee" "$CHANNEL_MAINTENANCE:$ETAPE_PROSPECT_GLOBAL"; do
		code=$(api_admin POST /rest/v1/rpc/move_card_to_channel \
			-d "$(jq -nc --arg c "$CARD_CHANNEL" --arg ch "${cible%%:*}" --arg e "${cible##*:}" \
			      '{card_id: $c, to_channel_id: $ch, to_step_id: $e}')")
		attendu "$code" "déplacement de ${CARD_CHANNEL: -2} vers le channel ${cible%%:*}" 200
	done
	channel_final=$(jq -r '.channel_id' "$CORPS")
	[ "$channel_final" = "$CHANNEL_MAINTENANCE" ] || die "l'aller-retour de channel de ${CARD_CHANNEL: -2}
        n'a pas rendu la card à son channel de départ : « $channel_final »."
	info "c5 : aller-retour de channel par move_card_to_channel — 2 événements channel_changed"
	info "     et AUCUN moved : une card qui change de channel ne franchit aucune arête (décision 215)"
else
	info "c5 : déjà déplacée de channel au moins une fois — rien à faire (convergence par état)"
fi

# --- 8 septies. Comptes entrants IMAP — docs/SPEC-seed.md §2.17, CRM-052 ----------------------
#
# TROIS COMPTES, POSÉS PAR LE VÉRITABLE CHEMIN D'ÉCRITURE. `upsert_mail_inbound_account` est la
# seule voie qui met le mot de passe dans Vault ; un `INSERT` direct est d'ailleurs REFUSÉ à
# `authenticated`, et la suite pgTAP le mesure. Le seed ne démontre donc pas un état que le produit
# ne saurait pas atteindre (CLAUDE.md §8).
#
# LE STATUT RESTE `pending`. Le seed n'ouvre aucune session IMAP et ne force aucun `ok` : un état
# « connecté » sans connexion réelle serait exactement la trace fabriquée que CLAUDE.md §8
# proscrit. C'est `e2e/mail/mail-inbound.spec.ts` qui l'obtient, en se connectant vraiment.
#
# `none` SUR LE PORT 143, et le motif est mesuré (docs/SPEC-mail-subsystem.md §13.6) : le
# certificat du Stalwart de développement est auto-signé, et le produit refuse à raison de lui
# faire confiance. Aucun mode dégradé de vérification TLS n'existe.

MAILBOX_PASSWORD=$(env_get "$ENV_FILE" STALWART_MAILBOX_PASSWORD)
INBOUND_DOMAIN=$(env_get "$ENV_FILE" CRM_INBOUND_DOMAIN)
PERSONAL_DOMAIN=$(env_get "$ENV_FILE" MAIL_DEV_PERSONAL_DOMAIN)
[ -n "$MAILBOX_PASSWORD" ] || die "STALWART_MAILBOX_PASSWORD est absente : les comptes entrants ne
        peuvent pas être configurés par le vrai chemin d'écriture."

# `label|owner_id|imap_username` — l'ordre suit celui du §2.17.
COMPTES_ENTRANTS=(
	"Boîte système du workspace||systeme@$INBOUND_DOMAIN"
	"Boîte de Camille Aubert|5eed0000-0000-4000-8000-000000000011|admin@$PERSONAL_DOMAIN"
	"Boîte de Driss Lemoine|5eed0000-0000-4000-8000-000000000012|bizdev@$PERSONAL_DOMAIN"
)

for entree in "${COMPTES_ENTRANTS[@]}"; do
	IFS='|' read -r mc_label mc_owner mc_user <<< "$entree"
	# LES DEUX DOSSIERS SONT SURVEILLÉS, ET LE MOTIF EST MESURÉ (docs/SPEC-mail-subsystem.md
	# §15.4) : sur cette pile, un message venant de l'extérieur sans authentification est classé
	# dans « Junk Mail », et un worker aveugle à ce dossier ne verrait jamais arriver le courrier
	# qu'il est censé relever. Le DÉFAUT de la colonne reste `{INBOX}` : c'est le seul choix qu'un
	# produit puisse faire à la place de quelqu'un, et le seed montre ce qu'un exploitant tranche.
	code=$(api_admin POST /rest/v1/rpc/upsert_mail_inbound_account \
		-d "$(jq -nc --arg ws "$WS_ID" --arg l "$mc_label" --arg u "$mc_user" \
		         --arg p "$MAILBOX_PASSWORD" --arg o "$mc_owner" \
		      '{p_workspace_id: $ws, p_label: $l, p_imap_host: "stalwart", p_imap_port: 143,
		        p_imap_security: "none", p_imap_username: $u, p_password: $p,
		        p_owner_id: (if $o == "" then null else $o end),
		        p_watch_folders: ["INBOX", "Junk Mail"]}')")
	attendu "$code" "configuration du compte entrant « $mc_label »" 200
done

comptes_entrants=$(curl -s "$API/rest/v1/mail_inbound_accounts?select=id" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r 'length')
[ "$comptes_entrants" = "${#COMPTES_ENTRANTS[@]}" ] || die "comptes entrants : $comptes_entrants
        lignes au lieu de ${#COMPTES_ENTRANTS[@]} — le rejeu a dupliqué ou perdu une boîte."
info "Comptes entrants : $comptes_entrants, dont la boîte système — secrets dans Vault, statut pending"

# --- 8 octies. Identités sortantes SMTP — docs/SPEC-seed.md §2.18, CRM-053 ---------------------
#
# DEUX IDENTITÉS, ET LA SECONDE EST LE CAS D'USAGE DU §2.2 : Driss REÇOIT sur bizdev@ et EXPÉDIE
# depuis contact@. Entrant et sortant divergent — c'est ce que la Definition of Done de `CRM-053`
# réclame, et le seed le DÉMONTRE au lieu de le décrire.
#
# Camille n'a pas d'identité sortante, et c'est utile aux preuves : une administratrice sans
# identité donne un cas de lecture vide qui n'est pas un refus.
#
# Le statut reste `pending` : aucune session SMTP n'est ouverte ici (même règle qu'au §2.17).

# `label|owner_id|smtp_username|from_address`
IDENTITES_SORTANTES=(
	"Identité de service||systeme@$INBOUND_DOMAIN|systeme@$INBOUND_DOMAIN"
	"Envoi de Driss Lemoine|5eed0000-0000-4000-8000-000000000012|bizdev@$PERSONAL_DOMAIN|contact@$PERSONAL_DOMAIN"
)

for entree in "${IDENTITES_SORTANTES[@]}"; do
	IFS='|' read -r mi_label mi_owner mi_user mi_from <<< "$entree"
	code=$(api_admin POST /rest/v1/rpc/upsert_mail_outbound_identity \
		-d "$(jq -nc --arg ws "$WS_ID" --arg l "$mi_label" --arg u "$mi_user" --arg f "$mi_from" \
		         --arg p "$MAILBOX_PASSWORD" --arg o "$mi_owner" \
		      '{p_workspace_id: $ws, p_label: $l, p_smtp_host: "stalwart", p_smtp_port: 587,
		        p_smtp_security: "none", p_smtp_username: $u, p_from_address: $f, p_password: $p,
		        p_owner_id: (if $o == "" then null else $o end), p_is_default: true}')")
	attendu "$code" "configuration de l'identité sortante « $mi_label »" 200
done

identites_sortantes=$(curl -s "$API/rest/v1/mail_outbound_identities?select=id" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r 'length')
[ "$identites_sortantes" = "${#IDENTITES_SORTANTES[@]}" ] || die "identités sortantes :
        $identites_sortantes lignes au lieu de ${#IDENTITES_SORTANTES[@]} — le rejeu a dupliqué."
info "Identités sortantes : $identites_sortantes ; Driss reçoit sur bizdev@ et expédie depuis contact@"

# --- 8 nonies. Deux messages RÉELLEMENT reçus — docs/SPEC-seed.md §2.19, CRM-057 ---------------
#
# L'INBOX GLOBALE NE SE DÉMONTRE PAS SUR UN ÉCRAN VIDE, et CLAUDE.md §8 interdit d'y suppléer par
# une trace fabriquée : « un e-mail de démonstration doit être envoyé par le véritable mécanisme
# d'envoi local ». Le seed n'écrit donc pas un message : il en FAIT ARRIVER un.
#
# DEUX MESSAGES, DEUX ÉTATS. L'un vise l'adresse d'une card et sera classé par la règle 1 du §4.4 ;
# l'autre ne vise que la boîte système et restera NON CLASSÉ. Le premier démontre la double
# visibilité — dans la card et dans l'inbox —, le second démontre le panneau « Non classés ».
#
# LES `Message-ID` SONT FIXES : le dédoublonnage du §4.2 fait le reste, un rejeu n'ajoute rien, et
# les captures peuvent dépendre de ces deux objets.
#
# L'ORDRE EST « RELEVER, PUIS ENVOYER SI NÉCESSAIRE, PUIS RELEVER » : relever d'abord ingère ce qui
# dormait déjà dans la boîte après une remise à zéro de la base, et évite d'en déposer un doublon.

MAIL_SYNC_TOKEN=$(env_get "$ENV_FILE" MAIL_SYNC_INTERNAL_TOKEN)
[ -n "$MAIL_SYNC_TOKEN" ] || die "MAIL_SYNC_INTERNAL_TOKEN est absente : la relève ne peut pas être
        déclenchée, et les messages de démonstration ne peuvent pas exister."
command -v docker >/dev/null 2>&1 || die "docker est introuvable : l'envoi réel et la relève réelle
        passent par le conteneur mail-sync (docs/SPEC-seed.md §2.19). Aucune substitution n'est
        prévue — un message forgé en base serait la trace fabriquée que CLAUDE.md §8 proscrit."

MSGID_CLASSE='seed-inbox-classe@p2enjoy.test'
MSGID_NON_CLASSE='seed-inbox-non-classe@p2enjoy.test'
CARD_COURRIER=5eed0000-0000-4000-8000-0000000000c1   # Refonte du site vitrine

compte_systeme=$(curl -s "$API/rest/v1/mail_inbound_accounts?select=id&imap_username=eq.systeme@$INBOUND_DOMAIN" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].id // empty')
[ -n "$compte_systeme" ] || die "la boîte système n'a pas d'identifiant : le §2.17 vient pourtant
        de la poser."

adresse_card=$(curl -s "$API/rest/v1/cards?select=email_local_part&id=eq.$CARD_COURRIER" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	| jq -r '.[0].email_local_part // empty')
[ -n "$adresse_card" ] || die "la card ${CARD_COURRIER: -2} n'a pas d'adresse : le trigger de la
        migration 11 aurait dû la frapper."

# La relève, déclenchée depuis le conteneur qui la porte. `-T` : pas de pseudo-terminal, sinon la
# sortie est polluée par des retours chariot et `jq` ne lit plus rien.
relever_boite() {
	docker compose exec -T -e JETON="$MAIL_SYNC_TOKEN" -e COMPTE="$compte_systeme" mail-sync \
		python -c '
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://localhost:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll",
    data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=300) as reponse:
        print(reponse.read().decode(), end="")
except urllib.error.HTTPError as erreur:
    print(erreur.read().decode(), end="")
' 2>/dev/null
}

messages_seedes() {
	curl -s "$API/rest/v1/mail_messages?select=rfc822_message_id&rfc822_message_id=in.(%3C$MSGID_CLASSE%3E,%3C$MSGID_NON_CLASSE%3E)" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r 'length'
}

if [ "$(messages_seedes)" != 2 ]; then
	releve=$(relever_boite)
	echo "$releve" | jq -e '.account_id? != null' >/dev/null 2>&1 \
		|| die "la relève n'a rien rendu d'exploitable : « $releve ». Le service mail-sync
        est-il démarré ? (./runDev.sh)"
fi

if [ "$(messages_seedes)" != 2 ]; then
	# LA SOUMISSION AUTHENTIFIÉE, seul chemin d'un message légitime (§15.4). Elle part du conteneur
	# mail-sync parce qu'il est sur le réseau Compose et joint `stalwart` par son nom ; le port
	# publié sur l'hôte servirait aussi, mais un seul mécanisme vaut mieux que deux.
	#
	# L'EXPÉDITEUR EST UNE BOÎTE LOCALE, ET C'EST MESURÉ : soumettre depuis `client.test` — ou même
	# depuis `contact@p2enjoy.test` avec le principal `bizdev@` — est refusé net par le serveur en
	# `501 5.5.4 You are not allowed to send from this address.`. Un principal n'expédie que depuis
	# ses propres adresses. Le correspondant de démonstration est donc Driss, et non un prospect
	# extérieur : le domaine `.test` n'est pas routable et aucun tiers n'existe sur cette pile.
	# La divergence promise par l'identité sortante du §2.18 est de ce fait inapplicable ici :
	# INC-087.
	envoi=$(docker compose exec -T \
		-e DEST_CARD="$adresse_card@$INBOUND_DOMAIN" \
		-e DEST_SYSTEME="systeme@$INBOUND_DOMAIN" \
		-e MDP="$MAILBOX_PASSWORD" \
		-e MSGID_CLASSE="$MSGID_CLASSE" \
		-e MSGID_NON_CLASSE="$MSGID_NON_CLASSE" \
		mail-sync python -c '
import os, smtplib
from email.message import EmailMessage

def composer(objet, destinataire, identifiant, corps):
    message = EmailMessage()
    message["From"] = "bizdev@p2enjoy.test"
    message["To"] = destinataire
    message["Subject"] = objet
    message["Message-ID"] = "<" + identifiant + ">"
    message.set_content(corps)
    return message

messages = [
    composer("Demande de devis — refonte", os.environ["DEST_CARD"], os.environ["MSGID_CLASSE"],
             "Bonjour,\n\nNous souhaitons un devis pour la refonte de notre site vitrine.\n\n"
             "Merci d avance,\nSolène Ferrand"),
    composer("Candidature spontanée", os.environ["DEST_SYSTEME"], os.environ["MSGID_NON_CLASSE"],
             "Bonjour,\n\nJe vous adresse ma candidature spontanée pour un poste de développeur.\n\n"
             "Cordialement,\nMalik Ferreira"),
]
session = smtplib.SMTP("stalwart", 587, timeout=60)
session.ehlo()
session.login("bizdev@p2enjoy.test", os.environ["MDP"])
for message in messages:
    session.send_message(message)
session.quit()
print("envoyes")
' 2>&1) || die "l envoi des messages de démonstration a échoué : « $envoi »"
	[ "${envoi##*$'\n'}" = "envoyes" ] || die "l envoi des messages de démonstration n a rien
        confirmé : « $envoi »"

	# La remise n'est pas instantanée : le serveur accepte, puis dépose. Cinq tentatives espacées
	# valent mieux qu'un délai fixe, qui serait soit trop court, soit du temps perdu.
	for _tentative in 1 2 3 4 5; do
		relever_boite >/dev/null
		[ "$(messages_seedes)" = 2 ] && break
		sleep 3
	done
fi

[ "$(messages_seedes)" = 2 ] || die "les deux messages de démonstration ne sont pas arrivés en base
        après relève : l inbox globale serait vide, et le §2.19 ne serait pas tenu."

etat_courrier=$(curl -s "$API/rest/v1/mail_messages?select=rfc822_message_id,classification,card_id&rfc822_message_id=in.(%3C$MSGID_CLASSE%3E,%3C$MSGID_NON_CLASSE%3E)" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
classe=$(echo "$etat_courrier" | jq -r --arg m "<$MSGID_CLASSE>" \
	'.[] | select(.rfc822_message_id == $m) | .card_id // "aucune"')
non_classe=$(echo "$etat_courrier" | jq -r --arg m "<$MSGID_NON_CLASSE>" \
	'.[] | select(.rfc822_message_id == $m) | .classification')
[ "$classe" = "$CARD_COURRIER" ] || die "le message adressé à la card ${CARD_COURRIER: -2} n a pas
        été classé par la règle 1 : card_id = « $classe ». Le seed ne force RIEN en base — c est
        classer_message_automatiquement qui écrit, ou personne."
[ "$non_classe" = unclassified ] || die "le message adressé à la seule boîte système est « $non_classe »
        au lieu de « unclassified » : le panneau des non classés serait vide."
info "Courrier : 2 messages réellement reçus — un classé sur ${CARD_COURRIER: -2} par la règle 1,"
info "          un non classé pour le panneau de tri. Rien n a été forgé en base (§2.19)"

total_evenements=$(curl -s "$API/rest/v1/card_events?select=id" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r 'length')
info "Événements : $total_evenements, tous écrits par les triggers — le seed ne peut PAS en forger un"

# --- 8 decies. La corbeille, posée par un GESTE RÉEL — docs/SPEC-seed.md §10, CRM-077 ----------
# @spec CRM-077 (docs/BACKLOG.md), docs/SPEC-corbeille.md §3.1 (les trois états), §3.3 (la mise en
#       corbeille d'un parent ne descend pas), §3.4 (la restauration refuse plutôt que de deviner),
#       §5 (ligne « Seed ») ; docs/SPEC-seed.md §10 ; docs/JOURNAL.md décision 403
#
# CE QUE CETTE SECTION COMBLE. Les migrations 37 et 38 ont livré la corbeille et sa garde de
# restauration, et AUCUNE donnée du seed ne les exerçait : la corbeille ne contenait qu'une card, si
# bien que le refus `parent_en_corbeille` n'avait aucun cas de démonstration et que l'écran du §4
# n'aurait rien eu à afficher.
#
# POURQUOI UN GESTE, ET NON UNE DÉCLARATION DANS LA CHARGE DE CRÉATION. `app.corbeille_avant_ecriture()`
# écrit `deleted_by` depuis `auth.uid()`. LA CLÉ DE SERVICE NE PORTE AUCUNE REVENDICATION `sub` :
# un objet créé avec `deleted_at` déjà renseigné par elle naît en corbeille avec un `deleted_by`
# **NUL**, et le trigger FIGE ensuite cette valeur tant que la ligne reste en corbeille — l'objet ne
# retrouvera donc jamais son auteur. C'est vérifiable sur la donnée existante : la card
# `Saisie erronée`, née en corbeille en section 8 ter, porte `deleted_by` nul.
#
# Les trois objets naissent donc ACTIFS dans les sections 3 et 4, et sont mis en corbeille ici avec
# LE JETON RÉEL DE L'ADMINISTRATRICE. C'est le patron exact de la décision 376 pour le commentaire
# retiré par la modération (INC-072) : le seed ne fabrique pas la trace d'un geste, il FAIT le geste
# et laisse le produit la produire (`CLAUDE.md` §8).
#
# ET C'EST AUSSI LA SEULE FORME QUI CONVERGE. Les charges des sections 3 et 4 n'envoient pas
# `deleted_at`, et `Prefer: resolution=merge-duplicates` ne met à jour que les colonnes présentes :
# un rejeu laisse donc l'état de corbeille intact. Une charge qui enverrait `deleted_at: null`
# demanderait au contraire la RESTAURATION de l'objet à chaque passage — et pour `annexes-2023`,
# dont le parent est en corbeille, cette restauration est REFUSÉE par la garde de la migration 38 :
# le seed échouerait à son second passage.
#
# CETTE SECTION VIENT EN DERNIER parce qu'elle applique un geste à des objets que les sections
# précédentes ont créés, et qu'aucune section ne doit les rouvrir après elle. Elle exige `api_admin`,
# définie en section 7.
#
# L'ORDRE EST ENFANT D'ABORD, PARENT ENSUITE. Il n'est imposé par aucune garde — seule la
# restauration en pose une —, mais il est le MIROIR de l'ordre qu'un script de reprise devra suivre,
# consigné au contrat de déploiement : remonter l'arborescence des parents avant les enfants.

echo
say "8 decies. La corbeille"

# La date est la même pour les deux objets : ils sont retirés par le même geste, et deux dates
# distinctes suggéreraient deux décisions distinctes.
CORBEILLE_LE='2026-07-20T14:30:00Z'
ADMINISTRATRICE='5eed0000-0000-4000-8000-000000000011'

# table | id | libellé
OBJETS_CORBEILLE=(
	"channels|5eed0000-0000-4000-8000-000000000038|le channel « Annexes 2023 »"
	"tracks|5eed0000-0000-4000-8000-000000000025|le track « Legacy 2023 »"
)

for ligne in "${OBJETS_CORBEILLE[@]}"; do
	IFS='|' read -r table id libelle <<< "$ligne"

	# CONVERGENCE PAR ÉTAT, comme les allers-retours de la section 8 sexies : l'état réel est relu
	# AVANT d'écrire. Sans cette relecture, chaque rejeu récrirait `deleted_at` — sans dommage pour
	# l'audit, que le trigger fige, mais en déplaçant `updated_at` sans qu'aucune décision n'ait
	# été prise.
	etat=$(curl -s "$API/rest/v1/$table?id=eq.$id&select=deleted_at,deleted_by" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
	deja=$(printf '%s' "$etat" | jq -r '.[0].deleted_at // "null"')

	if [ "$deja" = 'null' ]; then
		code=$(api_admin PATCH "/rest/v1/$table?id=eq.$id" \
			-H 'Prefer: return=representation' \
			-d "$(jq -nc --arg d "$CORBEILLE_LE" '{deleted_at: $d}')")
		attendu "$code" "mise en corbeille de $libelle" 200
		auteur=$(jq -r '.[0].deleted_by // "null"' "$CORPS")
		info "$libelle mis en corbeille par Camille Aubert"
	else
		auteur=$(printf '%s' "$etat" | jq -r '.[0].deleted_by // "null"')
		info "$libelle déjà en corbeille : rien à faire (convergence par état)"
	fi

	# L'AUDIT EST VÉRIFIÉ, ET NON SUPPOSÉ. Sans ce contrôle, une régression du trigger rendrait un
	# seed vert et un audit muet : l'écran de corbeille afficherait « retiré par — », et le seed
	# n'aurait rien démontré de ce qu'il est censé démontrer.
	[ "$auteur" = "$ADMINISTRATRICE" ] || die "$libelle est en corbeille, mais deleted_by vaut
        « $auteur » au lieu de l'administratrice. Le seed ne démontre alors AUCUN audit de
        suppression (docs/SPEC-seed.md §10.2). La cause la plus probable est une mise en corbeille
        effectuée avec la CLÉ DE SERVICE, qui ne porte aucune revendication « sub »."
done

# L'ENFANT DU §3.3 N'EST PAS HORODATÉ, et c'est une propriété qu'il faut ÉPROUVER plutôt que
# croire : c'est elle qui garde la restauration non ambiguë. Si une tranche future descendait
# l'horodatage sur les enfants, cette assertion serait la première à le dire.
enfant_vivant=$(curl -s "$API/rest/v1/channels?id=eq.5eed0000-0000-4000-8000-000000000037&select=deleted_at" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	| jq -r '.[0].deleted_at // "null"')
[ "$enfant_vivant" = 'null' ] || die "le channel « Dossiers 2023 » porte deleted_at = « $enfant_vivant »
        alors qu'il doit rester VIVANT sous un parent en corbeille (docs/SPEC-corbeille.md §3.3).
        La mise en corbeille d'un parent ne descend PAS sur ses enfants : descendre l'horodatage
        rendrait la restauration ambiguë."

info "Dossiers 2023 reste ACTIF sous un parent en corbeille : aucun deleted_at, injoignable"
info "          du seul fait que son track ne se résout plus — docs/SPEC-corbeille.md §3.3"
info "Corbeille : 1 track, 1 channel, 1 card — et 1 enfant vivant sous parent en corbeille (§10)"

# --- 8 nonies. Une version publiée du workflow par défaut ---------------------------------------
# @spec CRM-078 (docs/BACKLOG.md) — versionnement des workflows, première tranche
# @spec docs/SPEC-workflow-engine.md §7 ter.8 (ce que le seed livre)
#
# Sans elle, `workflow_versions` resterait vide et aucune preuve de lecture n'aurait de ligne à
# montrer : « l'API rend [] » serait vrai que la politique refuse ou qu'elle autorise tout, donc
# sans valeur probante (décision 50).
#
# Publiée par la VÉRITABLE RPC et avec le jeton réel de l'administratrice, jamais par une insertion
# directe — que les privilèges refusent de toute façon (`CLAUDE.md` §8). `published_by` porte donc
# une personne réelle, ce qu'une écriture à la clé de service ne produirait pas.
#
# CONVERGENCE, et non simple idempotence : un second passage ne publie PAS de seconde version, la
# composition étant inchangée. Ce n'est pas une garde propre au seed — c'est la cinquième
# vérification de la RPC (§7 ter.5) qui l'assure, et le seed se contente de l'observer. Le refus
# « composition inchangee » est donc un SUCCÈS attendu au rejeu, et toute autre erreur est fatale.
#
# Cette section vient APRÈS les étapes, les transitions, les champs, les règles et les exigences :
# la photographie doit porter la composition complète, pas un état intermédiaire.
say "Version publiée du workflow par défaut"

reponse_version=$(curl -s -X POST "$API/rest/v1/rpc/publish_workflow_version" \
	-H "apikey: $(env_get "$ENV_FILE" ANON_KEY)" \
	-H "Authorization: Bearer $JETON_ADMIN" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc --arg wf "$WF_ID" \
	      '{target_workflow_id: $wf, note: "Composition de référence livrée par le seed"}')")

if [ "$(printf '%s' "$reponse_version" | jq -r '.version_number // empty')" != '' ]; then
	info "Version $(printf '%s' "$reponse_version" | jq -r '.version_number') publiée par Camille Aubert"
elif [ "$(printf '%s' "$reponse_version" | jq -r '.message // empty')" = 'composition inchangee' ]; then
	info "Version déjà publiée et composition inchangée : rien à faire (seed convergent)"
else
	die "la publication d'une version du workflow par défaut a échoué : $reponse_version"
fi

# L'AUTEUR EST VÉRIFIÉ, ET NON SUPPOSÉ, pour la même raison que la corbeille au §10 : une version
# publiée avec la clé de service porterait `published_by = null` et ne démontrerait aucun audit.
auteur_version=$(curl -s "$API/rest/v1/workflow_versions?workflow_id=eq.$WF_ID&select=published_by&order=version_number.desc&limit=1" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	| jq -r '.[0].published_by // "null"')
[ "$auteur_version" = "$ADMINISTRATRICE" ] || die "la dernière version du workflow par défaut porte
        published_by = « $auteur_version » au lieu de l'administratrice. Le seed ne démontre alors
        AUCUN auteur de publication (docs/SPEC-workflow-engine.md §7 ter.8). La cause la plus
        probable est une publication effectuée avec la CLÉ DE SERVICE, qui ne porte aucune
        revendication « sub »."

# --- 8 duodecies. Sommeil de démonstration — docs/SPEC-cards.md §16.11.6 ------------------------
# @spec CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 a
#
# Deux affaires portent une échéance de sommeil, faute de quoi l'écran de la tranche 2 a ne serait
# démontrable ni dans un état, ni dans l'autre : une base où toutes les cards ont `snoozed_until`
# nulle ne montre jamais la pastille.
#
# LES ÉCHÉANCES SONT RELATIVES À L'INSTANT DU SEED, jamais des dates fixes (§16.11.6) : une date
# fixe cesserait d'être future au bout de quelques semaines, et la première affaire cesserait de
# démontrer quoi que ce soit.
#
# L'ÉCRITURE PASSE PAR LA CLÉ DE SERVICE, et c'est la démonstration même du §16.5 : la trace est
# posée par un trigger de TABLE, si bien que même une écriture de service laisse ses `snoozed` au
# fil de l'affaire. Un seed qui appellerait `snooze_card` avec un jeton d'administratrice
# prouverait la fonction ; celui-ci prouve que la trace ne dépend pas du chemin.
#
# CONVERGENCE PAR ÉTAT, comme la corbeille de la section 8 decies : l'état réel est relu AVANT
# d'écrire, et n'est réécrit que s'il ne correspond plus à ce que la ligne doit démontrer. Sans
# cette relecture, chaque rejeu poserait une échéance neuve, donc un `snoozed` de plus au fil —
# le seed cesserait d'être convergent, et les empreintes d'événements dériveraient à chaque
# application.
#
# id | état voulu | décalage en jours | libellé
SOMMEILS=(
	"5eed0000-0000-4000-8000-0000000000ca|endormie|10|« Cadrage data — Groupe Vallier », en sommeil"
	"5eed0000-0000-4000-8000-0000000000c1|echue|-2|« Refonte du site vitrine », sommeil échu"
)

echo
say "8 duodecies. Sommeil de démonstration"

for ligne in "${SOMMEILS[@]}"; do
	IFS='|' read -r id etat jours libelle <<< "$ligne"

	actuel=$(curl -s "$API/rest/v1/cards?id=eq.$id&select=snoozed_until" 		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" 		| jq -r '.[0].snoozed_until // "null"')

	# Le prédicat est celui du §16.2, appliqué ici plutôt que déduit : « en sommeil » vaut
	# « non nulle ET future ». Une ligne déjà dans l'état voulu n'est pas réécrite.
	if [ "$actuel" = 'null' ]; then
		conforme='non'
	elif [ "$(date -u -d "$actuel" +%s 2>/dev/null || echo 0)" -gt "$(date -u +%s)" ]; then
		conforme=$([ "$etat" = 'endormie' ] && echo 'oui' || echo 'non')
	else
		conforme=$([ "$etat" = 'echue' ] && echo 'oui' || echo 'non')
	fi

	if [ "$conforme" = 'oui' ]; then
		info "$libelle : déjà dans l'état voulu, rien à faire (convergence par état)"
		continue
	fi

	echeance=$(date -u -d "$jours days" +%Y-%m-%dT%H:%M:%SZ)
	code=$(api PATCH "/rest/v1/cards?id=eq.$id" 		-H 'Prefer: return=representation' 		-d "$(jq -nc --arg d "$echeance" '{snoozed_until: $d}')")
	attendu "$code" "sommeil de $libelle" 200
	info "$libelle jusqu'au $echeance"
done

# LA TRACE EST VÉRIFIÉE, ET NON SUPPOSÉE, pour la même raison que l'audit de la corbeille : sans ce
# contrôle, une régression du trigger de la migration 44 rendrait un seed vert et un fil muet, et
# la timeline de la tranche 2 a n'aurait rien à nommer.
traces=$(curl -s "$API/rest/v1/card_events?type=eq.snoozed&select=id" 	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r 'length')
[ "${traces:-0}" -ge 2 ] || die "les deux affaires portent une échéance de sommeil, mais card_events
        ne compte que « ${traces:-0} » événement(s) « snoozed ». Le trigger de table de la migration
        44 est la seule source de cette trace (docs/SPEC-cards.md §16.5) : le seed ne démontre alors
        AUCUNE trace de sommeil."

info "Sommeil : 2 affaires — une endormie, une dont l'échéance est échue — docs/SPEC-cards.md §16.11.6"


# --- 9. Ce que le seed rend visible, et ce qu'il ne rend pas visible ----------------------------
# Rappel volontaire, affiché à chaque exécution, et **mis à jour par `CRM-020`** : peupler la base
# ne la rend pas lisible pour autant. L'état réel est désormais mixte, et le dire faux dans un sens
# ou dans l'autre tromperait celui qui lit cette sortie.
#
#   * les tables du socle — profiles, workspaces, workspace_members — sont lisibles par les
#     membres du workspace depuis `CRM-022`; seul le profil propre et les memberships administrés
#     sont modifiables ;
#   * `track_members` et `channel_members` portent les politiques de `CRM-012` : un administrateur
#     y lit et y écrit, l'intéressé y lit sa propre ligne, personne d'autre n'y voit rien ;
#   * `tracks` porte les politiques de `CRM-020`, `channels` celles de `CRM-021` et
#     `workflow_nodes_catalog` celles de `CRM-030` : un membre du workspace y lit, un
#     administrateur seul y écrit. Un appelant **anonyme** n'y lit rien.

echo
say "Seed appliqué"
info "Espace de travail : $WS_NAME ($WS_SLUG)"
info "Comptes : ${#COMPTES[@]}, un par rôle — mot de passe commun publié dans docs/SPEC-seed.md §2.3"
info "Tracks : ${#TRACKS[@]}, dont un archivé et un EN CORBEILLE — docs/SPEC-tracks.md §8"
info "Channels : ${#CHANNELS[@]}, dont un archivé et un EN CORBEILLE, sur quatre tracks — docs/SPEC-channels.md §8"
info "Nœuds du catalogue : ${#NOEUDS[@]}, dont un archivé — docs/SPEC-workflow-engine.md §2.9"
info "Workflow : 1, global et par défaut, ${#ETAPES[@]} étapes et ${#TRANSITIONS[@]} transitions — docs/SPEC-workflow-engine.md §3.9"
info "Fixture de copie : 1, de portée track sur « Conseil & IA », créée par copy_workflow_to_track — docs/SPEC-workflow-engine.md §4.10"
info "Versions de workflow : 1, publiée sur le workflow par défaut par la véritable RPC — docs/SPEC-workflow-engine.md §7 ter.8"
info "Champs : ${#CHAMPS[@]}, dont un archivé, et ${#REGLES[@]} règles de visibilité sur le workflow global — docs/SPEC-form-composer.md §2.9"
info "Champs exigés par transition : 1 liaison globale et 1 dérivée remappée — CRM-018"
info "Droits fins : ${#DROITS_FINS[@]}, opposables depuis CRM-012 — docs/SPEC-seed.md §2.11"
info "Cards : $(( ${#CARDS[@]} + ${#CARDS_DERIVE[@]} + ${#CARDS_VOLUME[@]} )), dont une archivée et une en corbeille, sur SIX channels — docs/SPEC-cards.md §9"
info "  dont ${#CARDS[@]} sur le workflow global, à ses SEPT étapes, et ${#CARDS_DERIVE[@]} sur le workflow dérivé — CRM-046, docs/SPEC-seed.md §9.3"
info "  et ${#CARDS_VOLUME[@]} de VOLUME dans « maintenance », qui en porte VINGT-SEPT actives — CRM-046, docs/SPEC-seed.md §9.11"
info "Valeurs de formulaire : $(( ${#VALEURS[@]} + ${#VALEURS_DERIVE[@]} )) sur 11 cards, dont une vidée explicitement et 3 dérivées — docs/SPEC-form-composer.md §6.11"
info "Commentaires : ${#COMMENTAIRES[@]} sur 3 cards, dont un modifié et un supprimé — docs/SPEC-cards.md §13.11"
info "Comptes entrants IMAP : ${#COMPTES_ENTRANTS[@]}, dont la boîte système ; Farida n'en a pas — docs/SPEC-seed.md §2.17"
info "Identités sortantes SMTP : ${#IDENTITES_SORTANTES[@]} — entrant et sortant divergent pour Driss — docs/SPEC-seed.md §2.18"
echo
info "profiles, workspaces et workspace_members sont lisibles par les trois membres du seed :"
info "le profil propre est modifiable, et seul l'admin gère les memberships (CRM-022)."
info "Les droits fins sont OPPOSABLES depuis CRM-012 : le viewer ne voit que 3 des 4 tracks."
info "tracks, channels, workflow_nodes_catalog, workflows, workflow_steps, workflow_transitions,"
info "form_fields, form_field_rules et workflow_transition_required_fields sont lisibles par un"
info "membre du workspace, et par lui seul (CRM-020, CRM-021, CRM-030, CRM-031, CRM-035, CRM-018)."
info "cards applique les droits fins DÈS SA PREMIÈRE LIGNE (CRM-040) : le viewer ne voit aucune"
info "card de « Grands comptes », dont le track lui est fermé. « Prospection » porte enfin des"
info "cards, sur le workflow DÉRIVÉ — CRM-046, docs/SPEC-seed.md §9.2 et §9.3. CRM-019 ferme INC-046 :"
info "un changement légitime passe par change_channel_workflow ; le PATCH direct reste refusé."
info "workflow_derivations expose la divergence d'une copie, en lecture seule (CRM-032)."
info "Preuves du seed : scripts/verify-seed.sh — tracks : scripts/verify-tracks.sh"
info "channels : scripts/verify-channels.sh — catalogue : scripts/verify-catalogue.sh"
info "workflows : scripts/verify-workflows.sh — copie : scripts/verify-copie-workflow.sh"
info "champs de formulaire : scripts/verify-champs-formulaire.sh — cards : scripts/verify-cards.sh"
info "commentaires : scripts/verify-commentaires.sh — jeu de démonstration : scripts/verify-seed-demo.sh"
info "identités et memberships : scripts/verify-identites.sh"
