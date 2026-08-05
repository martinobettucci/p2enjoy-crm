#!/usr/bin/env bash
# @spec CRM-005 (docs/BACKLOG.md) — seed socle : comptes, espace de travail, rôles
# @spec CRM-020 (docs/BACKLOG.md) — tracks de démonstration, dont un archivé
# @spec CRM-021 (docs/BACKLOG.md) — channels de démonstration, dont un archivé
# @spec CRM-030 (docs/BACKLOG.md) — catalogue de nœuds de démonstration, dont un archivé
# @spec CRM-031 (docs/BACKLOG.md) — workflow par défaut, ses étapes et ses transitions
# @spec CRM-032 (docs/BACKLOG.md) — copie du workflow vers un track, par la véritable RPC
# @spec CRM-035 (docs/BACKLOG.md) — champs de formulaire et règles de visibilité
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
# `workflow_id` est **obligatoire** depuis `CRM-033` (INC-029 soldée) : les six channels naissent
# rattachés au workflow par défaut, dont la ligne est créée en section 3 bis. `prospection` est
# ensuite rattaché à la copie de portée `track` en section 7 — elle dérive du workflow global et ne
# peut donc pas le précéder (docs/SPEC-workflow-engine.md §4.12.7).
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

# Dix transitions, exactement celles du graphe de docs/SPEC-workflow-engine.md §3.9 : la
# progression linéaire, le retour Négociation → Relance, et le passage vers Perdu depuis les quatre
# premières étapes. **Réalisation → Perdu n'est pas déclaré** : une affaire signée qui échoue relève
# d'un autre traitement, point ouvert n° 1 de la spécification.
#
# Les quatre transitions vers Perdu **exigent un commentaire** : une affaire perdue sans motif n'est
# exploitable par aucune analyse, et c'est la seule transition du graphe dont la raison ne se déduit
# pas de l'étape d'arrivée. Choix pris faute d'énoncé d'origine, nommé au §3.9 et renversable ici
# même (docs/JOURNAL.md, décision 75).
#
# `require_fields` reste vide partout. Le motif a changé avec `CRM-035` et il est réécrit plutôt que
# laissé périmé : la colonne peut désormais désigner des champs réels, mais **aucune garde ne la
# lit** — `move_card` est `CRM-034`, non commencée (décision 92, INC-043). Une donnée de
# démonstration que rien n'exerce est une décoration, pas une preuve, et elle serait la première à
# pourrir, aucune intégrité référentielle n'étant possible sur un `uuid[]` (INC-033).
#
# id | étape de départ | étape d'arrivée | libellé | commentaire exigé (oui/non)
# La sixième colonne porte `require_fields` — docs/SPEC-workflow-engine.md §5.9,
# docs/SPEC-seed.md §2.13. Elle est restée vide sur les dix transitions tant qu'aucune garde ne la
# lisait ; `CRM-036` a livré la sixième vérification de `move_card`, et une donnée que rien n'exerce
# n'est plus une décoration. « Démarrer la réalisation » exige donc `lien-proposition` : c'est la
# SEULE donnée du seed qui exerce le second membre de l'union de docs/SPEC-form-composer.md §3.5,
# celui porté par l'arête et non par l'étape.
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
# Neuf cards, réparties sur quatre channels et trois tracks, à cinq étapes distinctes du workflow
# global. Chaque état du cycle de vie est représenté par une donnée réelle : sept actives, **une
# archivée**, **une en corbeille**. Sans ces deux dernières, les deux suppressions douces de
# `docs/SPEC-cards.md` §4 seraient documentées sans être démontrables, ce que `CLAUDE.md` §8 refuse.
#
# AUCUNE CARD DANS `prospection`, ET LE MOTIF EST MESURÉ — INC-046, docs/SPEC-cards.md §9.1.
# `prospection` est le seul channel que ce seed **repointe** : la section 4 le ramène au workflow
# global déclaré, la section 7 le rattache ensuite à la copie de portée track. La clé étrangère
# composite `cards (channel_id, workflow_id)` de `CRM-040` refuse ce déplacement dès qu'une card y
# vit. MESURÉ : une card dans `prospection` puis ce seed rejoué échoue **en section 4**, code de
# sortie 1, `23503`. Contre-épreuve mesurée : une card dans `grands-comptes`, channel dont le
# workflow ne change jamais, laisse le seed vert. La réouverture d'un channel par droit fin reste
# démontrée — mieux — par `e2e/api/cards.spec.ts`, où le `viewer` crée lui-même une card dans
# `prospection` avant de la retirer.
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
)

# --- Valeurs de formulaire — docs/SPEC-form-composer.md §6.11, docs/SPEC-seed.md §2.13 ----------
# Quatorze valeurs sur six cards. Chaque ligne exerce une règle, aucune n'est décorative :
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
#     par `require_fields` de l'arête et non par l'étape.
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
)

# --- Commentaires — docs/SPEC-cards.md §13.11, docs/SPEC-seed.md §2.14 -------------------------
# Cinq commentaires sur trois cards, écrits par les trois comptes. Aucun n'est décoratif :
#
#   * deux auteurs sur `…0c1` font un FIL, ce qu'un commentaire isolé ne démontre pas ;
#   * le troisième est MODIFIÉ : `edited_at` renseigné, état démontré et non seulement décrit ;
#   * celui de `…0c4` est SUPPRIMÉ — pierre tombale, corps vide —, et il vit dans un channel d'un
#     AUTRE track, pour que la suppression ne soit pas prouvée sur le seul channel déjà couvert ;
#   * celui de `…0c5` porte pour auteur Farida Nowak, `viewer` du workspace. Il est le TÉMOIN de la
#     preuve de lecture : sans lui, « le viewer lit `200` et `[]` » serait vrai que la RLS refuse ou
#     qu'elle autorise tout (décision 50). C'est la seule ligne du seed dont l'auteur ne pourrait
#     PAS l'écrire lui-même : la politique d'insertion exige le droit d'écriture (INC-071), et le
#     seed le dit plutôt que de le maquiller.
#
# `workspace_id` n'est JAMAIS envoyé : le trigger de la migration 15 le dérive de la card, quelle
# que soit la valeur fournie. `edited_at` et `deleted_at` non plus — ils sont posés par le produit,
# dans les deux mises à jour conditionnelles de la section 8 quinquies.
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

echo
say "4. Channels"

for ligne in "${CHANNELS[@]}"; do
	IFS='|' read -r id track slug nom position archive <<< "$ligne"

	if [ "$archive" = '-' ]; then
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" --arg wf "$WF_ID" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: $wf, position: $position, archived_at: null}')
	else
		charge=$(jq -nc --arg id "$id" --arg ws "$WS_ID" --arg track "$track" --arg nom "$nom" \
		               --arg slug "$slug" --argjson position "$position" --arg archive "$archive" \
		               --arg wf "$WF_ID" \
		     '{id: $id, workspace_id: $ws, track_id: $track, name: $nom, slug: $slug,
		       workflow_id: $wf, position: $position, archived_at: $archive}')
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
	# `require_fields` est envoyé **toujours**, vide ou non : un rejeu convergent doit ramener la
	# ligne à son état déclaré, y compris pour effacer un identifiant posé à la main.
	[ "$champs" = '-' ] && champs_json='[]' || champs_json=$(jq -nc --arg v "$champs" '[$v]')

	charge=$(jq -nc --arg id "$id" --arg wf "$WF_ID" --arg ws "$WS_ID" --arg depuis "$depuis" \
	               --arg vers "$vers" --arg libelle "$libelle" \
	               --argjson commentaire "$commentaire_json" --argjson champs "$champs_json" \
	     '{id: $id, workflow_id: $wf, workspace_id: $ws, from_step_id: $depuis, to_step_id: $vers,
	       label: $libelle, require_comment: $commentaire, require_fields: $champs}')

	code=$(api POST /rest/v1/workflow_transitions \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la transition « $libelle »" 200 201
done
info "Étapes : ${#ETAPES[@]} — transitions : ${#TRANSITIONS[@]}, dont 4 exigeant un commentaire"
info "« Démarrer la réalisation » exige en outre le champ lien-proposition — CRM-036, docs/SPEC-seed.md §2.13"


# --- 7. Copie vers un track — docs/SPEC-workflow-engine.md §4.10 --------------------------------
# Cette section n'écrit **aucune** ligne directement : elle appelle `copy_workflow_to_track`, la
# véritable fonction du produit, par la véritable route — l'appel RPC de l'API REST. `CLAUDE.md` §8
# l'exige : « une inscription doit utiliser le véritable flux applicatif ».
#
# Deux différences avec les sections précédentes, et toutes deux voulues.
#
# 1. **Le jeton employé est celui de l'administrateur seedé, obtenu par la vraie route de
#    connexion**, et non la clé de service. La fonction exige `app.is_workspace_admin`, qui lit
#    `auth.uid()` : la clé de service n'a pas de `sub`, `auth.uid()` y est nul, et l'appel serait
#    refusé par `workflow_not_found`. Ce n'est pas un obstacle contourné, c'est la garde qui
#    fonctionne — et le seed la traverse comme un administrateur le ferait.
#
# 2. **La convergence est vérifiée avant d'agir**, et non obtenue par un upsert : la fonction crée
#    toujours une ligne neuve, et rien n'interdit deux copies du même workflow sur le même track.
#    Le seed regarde donc si la copie existe déjà et n'appelle la fonction que si elle manque.
#
#    DÉFAUT RÉEL CORRIGÉ ICI PAR `CRM-033` — INC-041. La recherche portait sur la source **et** le
#    track. MESURÉ, reproductible en quatre gestes : le `track_id` de la copie déplacé à la main, la
#    recherche ne la trouvait plus et le seed en créait une **seconde**. Le contrat en déclare une ;
#    le seed en laissait deux, sans erreur ni avertissement. Il était idempotent sans être
#    convergent — troisième forme de la décision 57, la première sur un seed.
#
#    La copie est désormais cherchée par sa **seule** dérivation, et son track est **ramené** à la
#    valeur déclarée plutôt que de servir de critère de recherche.
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

echo
say "7. Copie du workflow vers un track"

JETON_ADMIN=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" \
	-H "apikey: $(env_get "$ENV_FILE" ANON_KEY)" -H 'Content-Type: application/json' \
	-d "$(jq -nc --arg m 'admin@p2enjoy.test' --arg p "$SEED_PASSWORD" \
	      '{email: $m, password: $p}')" \
	| jq -r '.access_token // empty')
[ -n "$JETON_ADMIN" ] || die "connexion de l'administrateur seedé impossible : la copie ne peut pas
        être créée par la véritable route."

# Le channel est rendu au workflow global avant toute chose : la copie doit être **libre** pour que
# son track puisse être ramené à la valeur déclarée.
code=$(api PATCH "/rest/v1/channels?id=eq.$WF_COPIE_CHANNEL" \
	-H 'Prefer: return=representation' \
	-d "$(jq -nc --arg wf "$WF_ID" '{workflow_id: $wf}')")
attendu "$code" "libération du channel $WF_COPIE_CHANNEL avant convergence de la copie" 200

code=$(api GET "/rest/v1/workflows?select=id&derived_from_workflow_id=eq.$WF_ID&order=created_at")
attendu "$code" "recherche d'une copie existante" 200
copie_id=$(jq -r '.[0].id // empty' "$CORPS")

# Convergence, suite d'INC-041 : le contrat en déclare **une**. Une base qui en porte plusieurs —
# héritage du défaut corrigé ici, ou copie créée à la main — est ramenée à une, la plus ancienne
# étant conservée. Sans cela, le seed serait convergent pour un track déplacé mais pas pour un
# doublon, et le contrôle du harnais de `CRM-032` resterait rouge sans que rien ne le répare.
for surnumeraire in $(jq -r '.[1:][].id' "$CORPS"); do
	code=$(api DELETE "/rest/v1/workflows?id=eq.$surnumeraire")
	attendu "$code" "suppression de la copie surnuméraire $surnumeraire" 200 204
	warn "Copie surnuméraire supprimée : $surnumeraire — le contrat n'en déclare qu'une (INC-041)"
done

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
info "prospection suit $WF_COPIE_NOM — les cinq autres channels suivent le workflow global"

# --- 8. Champs de formulaire et règles de visibilité — docs/SPEC-form-composer.md §2.9 ---------
# Mêmes règles que les sections précédentes : véritable API REST, clé de service, écriture
# convergente sur la clé primaire.
#
# Cette section vient **après** la copie, et non avant, pour une raison qui mérite d'être écrite :
# elle ne change rien. Les champs appartiennent au workflow **global**, et `copy_workflow_to_track`
# n'en copie aucun — la copie de la section 7 naît donc sans formulaire, qu'elle soit créée avant ou
# après. C'est l'écart d'INC-037, dont l'arbitrage appartient au responsable (décision 93). Il est
# **compté** par `scripts/verify-copie-workflow.sh` et par la suite pgTAP `0008`, jamais corrigé en
# silence.
#
# `help_text` et `archived_at` sont envoyés **null** lorsque le contrat dit « — », et non omis, pour
# le même motif que `options` : un rejeu convergent doit ramener la ligne à son état déclaré, y
# compris pour effacer une valeur posée à la main.

echo
say "8. Champs de formulaire et règles de visibilité"

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
	attendu "$code" "création du champ $cle" 200 201

	if [ "$archive" = '-' ]; then etat='actif'; else etat="archivé le ${archive%%T*}"; fi
	printf '  %-24s %-11s %s\n' "$cle" "$type" "$etat"
done

for ligne in "${REGLES[@]}"; do
	IFS='|' read -r champ etape visibilite <<< "$ligne"

	charge=$(jq -nc --arg champ "$champ" --arg etape "$etape" --arg wf "$WF_ID" --arg ws "$WS_ID" \
	               --arg v "$visibilite" \
	     '{field_id: $champ, step_id: $etape, workflow_id: $wf, workspace_id: $ws, visibility: $v}')

	code=$(api POST /rest/v1/form_field_rules \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$charge")
	attendu "$code" "création de la règle ${champ: -3}×${etape: -3}" 200 201
done
info "Champs : ${#CHAMPS[@]}, dont un archivé — règles : ${#REGLES[@]}, couvrant les trois visibilités"
info "La copie de portée track ne reçoit aucun champ : INC-037, arbitrage attendu"

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
# Cette section vient **après** la copie de la section 7, et l'ordre n'est pas indifférent : la
# section 4 puis la section 7 repointent toutes deux le `workflow_id` de `prospection`, geste que la
# clé composite de `CRM-040` refuse dès qu'une card occupe ce channel (INC-046). Aucune card n'y est
# posée, et les huit autres vivent dans des channels dont le workflow ne bouge jamais — le seed
# reste donc convergent, ce qui est vérifié en le rejouant.
#
# `workflow_id` vaut `$WF_ID` — le workflow **global** — pour les neuf cards, et le contrat ne le
# répète pas ligne à ligne : les quatre channels employés le suivent tous. Le seul channel qui
# porte la copie de portée track est `prospection`, qui n'en reçoit aucune. Si une card devait un
# jour y vivre, cette valeur ne serait plus correcte et la clé composite le dirait — en `23503`,
# jamais en silence.

echo
say "8 ter. Cards"

for ligne in "${CARDS[@]}"; do
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
done

info "Cards : ${#CARDS[@]}, dont une archivée et une en corbeille — docs/SPEC-cards.md §9"
info "Aucune dans « prospection » : la clé composite de CRM-040 refuse que le seed y repointe le"
info "workflow tant qu'une card l'occupe — INC-046, mesuré, docs/SPEC-cards.md §9.1."


# --- 8 quater. Valeurs de formulaire — docs/SPEC-form-composer.md §6.11 ------------------------
# Mêmes règles que les sections précédentes : véritable API REST, clé de service, écriture
# convergente sur la clé primaire composite `(card_id, field_id)`.
#
# Cette section vient **après** les cards et **après** les champs, et l'ordre est structurel : les
# deux clés étrangères composites de la migration 13 exigent que la card et le champ existent tous
# deux, et qu'ils désignent le MÊME workflow. Un ordre différent ferait échouer le seed en `23503`,
# jamais en silence.
#
# `workflow_id` vaut `$WF_ID` pour les quatorze valeurs : les six cards concernées suivent toutes le
# workflow global, et les sept champs y sont déclarés. Si l'une venait à changer de workflow, la
# clé composite le dirait.
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

info "Valeurs : ${#VALEURS[@]} sur 6 cards, couvrant 7 types — docs/SPEC-form-composer.md §6.11"
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

# --- L'état « supprimé », idem ------------------------------------------------------------------
# La date envoyée est ignorée : le trigger pose `now()` et VIDE le corps. Le seed ne fabrique donc
# aucune pierre tombale — il demande la suppression, et le produit la réalise.
etat_d4=$(curl -s "$API/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d4&select=deleted_at" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[0].deleted_at // "null"')

if [ "$etat_d4" = 'null' ]; then
	code=$(api PATCH '/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d4' \
		-H 'Prefer: return=representation' -d '{"deleted_at": "2026-08-04T15:00:00Z"}')
	attendu "$code" "suppression du commentaire d4" 200
	corps_d4=$(jq -r '.[0].body' "$CORPS")
	[ "$corps_d4" = '' ] || die "d4 supprimé mais son corps n'est pas vide : « $corps_d4 »."
	info "d4 supprimé : corps VIDÉ par le trigger, et la date envoyée ignorée au profit de now()"
else
	info "d4 déjà supprimé : rien à faire (convergence par état)"
fi

info "Commentaires : ${#COMMENTAIRES[@]} sur 3 cards, dont un modifié et un supprimé — docs/SPEC-cards.md §13.11"
info "Celui de la card c5 porte pour auteur le viewer : témoin de la preuve de lecture (décision 50)"

# --- 9. Ce que le seed rend visible, et ce qu'il ne rend pas visible ----------------------------
# Rappel volontaire, affiché à chaque exécution, et **mis à jour par `CRM-020`** : peupler la base
# ne la rend pas lisible pour autant. L'état réel est désormais mixte, et le dire faux dans un sens
# ou dans l'autre tromperait celui qui lit cette sortie.
#
#   * les tables du socle — profiles, workspaces, workspace_members — restent en refus par défaut
#     depuis `CRM-003` : RLS activée, aucune politique. Aucune unité ne les porte, INC-014 ;
#   * `track_members` et `channel_members` portent les politiques de `CRM-012` : un administrateur
#     y lit et y écrit, l'intéressé y lit sa propre ligne, personne d'autre n'y voit rien ;
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
info "Workflow : 1, global et par défaut, ${#ETAPES[@]} étapes et ${#TRANSITIONS[@]} transitions — docs/SPEC-workflow-engine.md §3.9"
info "Copie : 1, de portée track sur « Conseil & IA », créée par copy_workflow_to_track — docs/SPEC-workflow-engine.md §4.10"
info "Champs : ${#CHAMPS[@]}, dont un archivé, et ${#REGLES[@]} règles de visibilité sur le workflow global — docs/SPEC-form-composer.md §2.9"
info "Droits fins : ${#DROITS_FINS[@]}, opposables depuis CRM-012 — docs/SPEC-seed.md §2.11"
info "Cards : ${#CARDS[@]}, dont une archivée et une en corbeille, sur quatre channels — docs/SPEC-cards.md §9"
info "Valeurs de formulaire : ${#VALEURS[@]} sur 6 cards, dont une vidée explicitement — docs/SPEC-form-composer.md §6.11"
info "Commentaires : ${#COMMENTAIRES[@]} sur 3 cards, dont un modifié et un supprimé — docs/SPEC-cards.md §13.11"
echo
warn "profiles, workspaces et workspace_members ne sont lisibles par AUCUN jeton d'utilisateur :"
warn "ces tables restent en refus par défaut : aucune unité ne porte leurs politiques (INC-014)."
info "Les droits fins sont OPPOSABLES depuis CRM-012 : le viewer ne voit que 3 des 4 tracks."
info "tracks, channels, workflow_nodes_catalog, workflows, workflow_steps, workflow_transitions,"
info "form_fields et form_field_rules sont lisibles par un membre du workspace, et par lui seul"
info "(CRM-020, CRM-021, CRM-030, CRM-031, CRM-035)."
info "cards applique les droits fins DÈS SA PREMIÈRE LIGNE (CRM-040) : le viewer ne voit aucune"
info "card de « Grands comptes », dont le track lui est fermé. Aucune card dans « Prospection » :"
info "INC-046, docs/SPEC-cards.md §9.1."
info "workflow_derivations expose la divergence d'une copie, en lecture seule (CRM-032)."
info "Preuves du seed : scripts/verify-seed.sh — tracks : scripts/verify-tracks.sh"
info "channels : scripts/verify-channels.sh — catalogue : scripts/verify-catalogue.sh"
info "workflows : scripts/verify-workflows.sh — copie : scripts/verify-copie-workflow.sh"
info "champs de formulaire : scripts/verify-champs-formulaire.sh — cards : scripts/verify-cards.sh"
info "commentaires : scripts/verify-commentaires.sh"
