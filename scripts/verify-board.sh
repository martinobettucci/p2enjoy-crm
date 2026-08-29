#!/usr/bin/env bash
# @verifies CRM-041 (docs/BACKLOG.md) — Definition of Done du board kanban
# @verifies docs/SPEC-workflow-engine.md §7.2 (les quatre lectures), §7.3 (composition des
#           colonnes), §7.4 (carte de card), §7.5 (transitions atteignables), §7.6 (glisser-
#           déposer), §7.7 (clavier), §7.8 (motif exigé), §7.9 (optimisme et retour arrière),
#           §7.10 (les sept refus), §7.11 (états et responsive), §7.14 (preuves attendues)
# @verifies docs/SPEC-channels.md §5 (la lecture partagée porte `workflow_id`), §5.4 (la règle de
#           route), §5.4.1 (cette règle rendue exécutable et retournée sur un routeur muté)
# @verifies docs/DESIGN_SYSTEM.md §5.1 (carte de card), §5.2 (colonne), §7 (paliers),
#           §8 (accessibilité), §11 (classes réellement engendrées), §12.6 (débordement signalé)
# @verifies docs/INCONSISTENCY_REPORT.md INC-021 (webapp anonyme), INC-048 (le motif n'est
#           conservé nulle part), INC-066 (aucun éditeur de workflow), INC-241 (le contrôle des
#           lectures de channels était plus strict que la règle qu'il cite) ; CRM-022 ferme INC-014
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-041` :
#
#   1. les tests unitaires de la composition et du composant réel sont verts ;
#   2. la preuve d'API confronte les **quatre lectures du board** à la pile réelle, avec le jeton
#      de l'administratrice, et constate le refus opposé à l'anonyme ;
#   3. les scénarios d'interface s'exécutent contre le **build de production** servi, les captures
#      des quatre paliers sont produites, et la **vidéo `.webm` du glisser-déposer** avec elles ;
#   4. le build est vert et chaque classe citée par le board existe dans le CSS produit — une
#      classe dont le jeton n'est pas déclaré n'est pas engendrée, et en silence (§11) ;
#   5. le seed porte ce que le board démontre : sept étapes, onze transitions dont cinq à motif,
#      deux étapes sans transition sortante, quatre cards actives sur trois étapes, une archivée et
#      une en corbeille ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait échouer, et
#      la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun déplacement réel par un utilisateur connecté** : la webapp est un appelant
# anonyme faute d'écran de connexion (INC-021), et le board ne s'affiche jamais en conditions
# réelles. Les états chargés sont prouvés en substituant la réponse réseau, procédé endossé par
# docs/DESIGN_SYSTEM.md §12.5 — et le contrat d'écriture de `move_card`, lui, est prouvé hors
# interface par `e2e/api/move-card.spec.ts` (`CRM-034`).
#
# Il ne prouve **aucun éditeur de workflow** : la cinquième règle du §7 d'origine n'est portée par
# aucune unité du backlog (INC-066), et `CRM-041` ne la livre pas.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-board.sh
#   scripts/verify-board.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/board.ts
COMPOSANT=webapp/src/app/Board.tsx
ROUTE=webapp/src/app/RouteTrack.tsx
CHANNELS=webapp/src/lib/channels.ts
TEST_UNITAIRE=webapp/src/lib/board.test.ts
TEST_COMPOSANT=webapp/src/app/Board.test.tsx
SPEC_API=e2e/api/board.spec.ts
SPEC_UI=e2e/ui/board.spec.ts
CAPTURES=docs/captures/CRM-041
DB_CONTAINER=p2enjoy-db

WORKFLOW_GLOBAL=5eed0000-0000-4000-8000-000000000051
CHANNEL_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,45p' "$0"; exit 0 ;;
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
SAUVEGARDES="$TRAVAIL/sauvegardes"
mkdir -p "$SAUVEGARDES"

# Toute dégradation est restaurée, y compris si le script échoue en cours de route : un harnais
# qui laisse le produit dégradé derrière lui est pire que pas de harnais du tout (décisions 143,
# 145, 157).
#
# LES DÉGRADATIONS D9 ET D9 BIS TOUCHENT LA DONNÉE, PAS UN FICHIER (docs/SPEC-seed.md §9.12.4,
# révisé par docs/SPEC-relances.md §10.2.2). D9 vieillit une CINQUIÈME card ; D9 bis en RAJEUNIT
# une des quatre. Les deux sont donc rendues ici aussi, et par les mêmes écritures que le seed — la
# remise à zéro de sa section 8 octies bis et l'antidatage de sa 8 octies quater —, sans quoi une
# exécution tuée entre une dégradation et sa restauration laisserait le jeu de démonstration avec
# cinq cards en retard, ou avec trois.
CARD_TEMOIN_ANCIENNETE='5eed0000-0000-4000-8000-0000000000c1'
# La moins en retard des quatre du §10.2.1 : douze jours pour un seuil de cinq.
CARD_FIGEE_LEGACY='5eed0000-0000-4000-8000-0000000000cf'
anciennete_degradee=false
figee_rajeunie=false
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		local cible
		cible=$(basename "$fichier" | tr '@' '/')
		cp "$fichier" "$cible"
	done
	if [ "$anciennete_degradee" = true ]; then
		psql_db -c "update public.cards set entered_step_at = now()
		            where id = '$CARD_TEMOIN_ANCIENNETE';" >/dev/null
	fi
	if [ "$figee_rajeunie" = true ]; then
		psql_db -c "update public.cards set entered_step_at = now() - interval '12 days'
		            where id = '$CARD_FIGEE_LEGACY';" >/dev/null
	fi
	rm -rf "$TRAVAIL" "${DEPART:-}"
}
trap restaurer EXIT

sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }

# État des fichiers dégradables **à l'entrée du harnais**, et non l'état de `HEAD` : un contrôle
# qui comparerait au dernier commit ne pourrait pas être vert pendant qu'on travaille, et finirait
# par être ignoré (décision 166).
DEPART=$(mktemp -d)
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$CHANNELS"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Les fichiers livrés et leur traçabilité --------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$TEST_UNITAIRE" "$TEST_COMPOSANT" \
	"$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE"; do
	if head -3 "$fichier" | grep -q '@spec CRM-041'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-041'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# La règle du §5.4 de docs/SPEC-channels.md, rendue exécutable — RÉVISÉE le 2026-08-29, INC-241.
#
# La forme d'origine comptait les fichiers : `grep -rl "from('channels')" webapp/src | wc -l` devait
# valoir 1. Elle était à la fois trop stricte et trop faible, et le §5.4.1 de la spécification écrit
# les deux mesures. Trop stricte : le §5.4 prévoit des routes transverses, et quatre modules servent
# aujourd'hui des surfaces sans barre d'onglets — administration de l'arborescence, corbeille,
# inbox, écriture des objectifs. Trop faible : le comptage serait resté VERT si une route avait
# réécrit sa lecture À L'INTÉRIEUR de `webapp/src/lib/channels.ts`, ce qui est exactement la
# divergence que les décisions 167 et 169 redoutaient.
#
# La forme retenue éprouve la règle réelle — une règle DE ROUTE — et se mesure sur le routeur à
# chaque exécution : constantes de chemin, table `ROUTES`, déclarations `<Route>` de `App.tsx`,
# `.map(…)` compris. Aucune liste de routes, de composants ni de fichiers n'est écrite en dur ici :
# un compteur figé finit rouge de son propre succès (INC-175, INC-191, INC-242).
auditer_routeur() {
	python3 - "$1" <<'PY'
import pathlib
import re
import sys

racine = pathlib.Path(sys.argv[1])
app = racine / 'app'
chargeur = racine / 'lib' / 'channels.ts'


def litteraux(expression):
    return re.findall(r"'([^']*)'", expression)


# --- 1. Les constantes de chemin, mesurées sur `<racine>/app/` -----------------------------------

constantes = {}
for fichier in sorted(app.glob('*.ts')) + sorted(app.glob('*.tsx')):
    for nom, valeur in re.findall(
        r"export const ([A-Za-z0-9_]+)\s*=\s*(\[[^\]]*\]|'[^']*')\s*as const",
        fichier.read_text(encoding='utf-8'),
    ):
        constantes[nom] = litteraux(valeur)

# --- 2. La table `ROUTES`, qui associe un chemin à son rendu -------------------------------------

table = {}
source_routes = app / 'routes.tsx'
if source_routes.exists():
    bloc = re.search(
        r"export const ROUTES[^=]*=\s*\[(.*?)\n\]",
        source_routes.read_text(encoding='utf-8'),
        re.S,
    )
    if bloc is not None:
        for entree in re.finditer(
            r"chemin:\s*(\[[^\]]*\]|'[^']*'|[A-Za-z0-9_]+)"
            r".*?rendu:\s*\(\)\s*=>\s*<([A-Za-z0-9_]+)",
            bloc.group(1),
            re.S,
        ):
            expression, composant = entree.group(1), entree.group(2)
            for chemin in litteraux(expression) or constantes.get(expression, []):
                table[chemin] = composant

# --- 3. Les déclarations `<Route>` de `App.tsx` --------------------------------------------------

source = (app / 'App.tsx').read_text(encoding='utf-8')
tableaux = [
    (m.start(), m.group(1), m.group(2))
    for m in re.finditer(r"\{([A-Za-z0-9_]+)\.map\(\(([A-Za-z0-9_]+)\)", source)
]


def balise(texte, depart):
    """Rend le texte de la balise ouverte en `depart`, accolades appariées."""
    profondeur, indice = 0, depart
    while indice < len(texte):
        caractere = texte[indice]
        if caractere == '{':
            profondeur += 1
        elif caractere == '}':
            profondeur -= 1
        elif profondeur == 0 and texte.startswith('/>', indice):
            return texte[depart:indice]
        indice += 1
    return texte[depart:]


def attribut(tag, nom):
    """Rend la valeur brute de l'attribut, accolades appariées, ou None."""
    marque = re.search(nom + r'=', tag)
    if marque is None:
        return None
    reste = tag[marque.end():]
    if reste.startswith('"'):
        return "'" + reste[1:reste.find('"', 1)] + "'"
    if not reste.startswith('{'):
        return None
    profondeur, indice = 0, 0
    while indice < len(reste):
        if reste[indice] == '{':
            profondeur += 1
        elif reste[indice] == '}':
            profondeur -= 1
            if profondeur == 0:
                return reste[1:indice]
        indice += 1
    return None


routes = []
irresolus = []
for declaration in re.finditer(r"<Route\b", source):
    tag = balise(source, declaration.end())
    expression = attribut(tag, 'path')
    rendu = attribut(tag, 'element')
    composants = [] if rendu is None else re.findall(r"<([A-Z][A-Za-z0-9_]*)", rendu)
    if expression is None or not composants:
        irresolus.append(' '.join(tag.split())[:60])
        continue
    # Le composant d'écran est le plus interne : `<AppShell …><Corbeille /></AppShell>`.
    composant = composants[-1]
    expression = expression.strip()
    if expression.startswith("'"):
        routes.append((litteraux(expression)[0], composant))
        continue
    if expression in constantes:
        routes.extend((chemin, composant) for chemin in constantes[expression])
        continue
    englobants = [entree for entree in tableaux if entree[0] < declaration.start()]
    englobant = englobants[-1] if englobants else None
    if englobant is not None and (
        expression == englobant[2] or expression.startswith(englobant[2] + '.')
    ):
        tableau = englobant[1]
        if tableau in constantes:
            routes.extend((chemin, composant) for chemin in constantes[tableau])
            continue
        if tableau == 'ROUTES' and table:
            routes.extend(table.items())
            continue
    irresolus.append(expression)

# --- 4. Les quatre verdicts du §5.4.1 ------------------------------------------------------------


def verdict(code, conforme, message):
    print('%s %s %s' % (code, 'OK' if conforme else 'ANOMALIE', message))


porteuses = sorted({(chemin, composant) for chemin, composant in routes if ':slugTrack' in chemin})
fichiers, absents = {}, []
for chemin, composant in porteuses:
    fichier = app / (composant + '.tsx')
    if fichier.exists():
        fichiers[composant] = fichier
    else:
        absents.append('%s → %s' % (chemin, composant))

if irresolus:
    verdict('A', False, 'chemin de route non résolu : ' + ' | '.join(sorted(set(irresolus))))
elif not porteuses:
    verdict('A', False, 'aucune route porteuse de « :slugTrack » : le contrôle ne mesure plus rien')
elif absents:
    verdict('A', False, 'composant de route introuvable : ' + ', '.join(absents))
else:
    for chemin, composant in porteuses:
        print('# %s → %s' % (chemin, composant))
    verdict('A', True, '%d routes porteuses de « :slugTrack », sur %d composants, toutes résolues'
            % (len(porteuses), len(fichiers)))

sources = {composant: fichier.read_text(encoding='utf-8') for composant, fichier in fichiers.items()}
IMPORT_CHARGEUR = re.compile(
    r"import\s*\{[^}]*\buseContenuTrack\b[^}]*\}\s*from\s*'\.\./lib/channels'", re.S
)

sans_chargeur = sorted(c for c, texte in sources.items() if IMPORT_CHARGEUR.search(texte) is None)
if sans_chargeur:
    verdict('B', False, 'route sans le chargeur du chapitre : ' + ', '.join(sans_chargeur))
else:
    verdict('B', True, 'chaque route porteuse de « :slugTrack » alimente la barre par useContenuTrack')

proprietaires = sorted(c for c, texte in sources.items() if "from('channels')" in texte)
if proprietaires:
    verdict('C', False, 'route qui réécrit sa lecture des channels : ' + ', '.join(proprietaires))
else:
    verdict('C', True, 'aucune route porteuse de « :slugTrack » ne réécrit sa lecture des channels')

if not chargeur.exists():
    verdict('D', False, 'le chargeur partagé %s est ABSENT' % chargeur)
else:
    lectures = chargeur.read_text(encoding='utf-8').count("from('channels')")
    verdict('D', lectures == 1,
            'le chargeur partagé émet %d lecture(s) des channels' % lectures)
PY
}

if auditer_routeur webapp/src > "$TRAVAIL/routeur.txt" 2>&1; then
	while IFS= read -r ligne; do
		code=${ligne%% *}
		reste=${ligne#* }
		if [ "$code" = '#' ]; then
			printf '        %s\n' "$reste"
			continue
		fi
		if [ "${reste%% *}" = OK ]; then
			ok "§5.4.1 $code — ${reste#* }"
		else
			fail "§5.4.1 $code — ${reste#* }"
		fi
	done < "$TRAVAIL/routeur.txt"
else
	fail "le recensement du routeur n'a pas pu s'exécuter : $(tr '\n' ' ' < "$TRAVAIL/routeur.txt")"
fi

# `workflow_id` est lue dans la lecture PARTAGÉE, et non par une seconde requête (décision 169).
if grep -q "workflow_id" "$CHANNELS"; then
	ok "la lecture partagée des channels rapporte workflow_id"
else
	fail "workflow_id a quitté la lecture partagée : le board devra relire les mêmes lignes"
fi

# La preuve d'API importe les colonnes du produit plutôt que de les redéclarer : sinon elle
# prouverait qu'une requête quelconque fonctionne, pas que celle du produit fonctionne.
if grep -q "webapp/src/lib/colonnes-board" "$SPEC_API"; then
	ok "la preuve d'API importe les colonnes du produit, elle ne les recopie pas"
else
	fail "la preuve d'API redéclare ses colonnes : elle n'éprouve plus la requête du produit"
fi

# --- 2. Le seed porte ce que le board démontre ---------------------------------------------------

titre "2. Le seed porte les données que le board démontre"

etapes=$(psql_db -c "select count(*) from public.workflow_steps where workflow_id='$WORKFLOW_GLOBAL'")
if [ "${etapes:-0}" -eq 7 ]; then
	ok "le workflow standard porte ses sept étapes : sept colonnes"
else
	fail "le workflow standard porte $etapes étapes au lieu de 7"
fi

transitions=$(psql_db -c "select count(*) from public.workflow_transitions where workflow_id='$WORKFLOW_GLOBAL'")
if [ "${transitions:-0}" -eq 11 ]; then
	ok "il porte ses onze transitions : le menu du §7.5 a de quoi être non vide"
else
	fail "il porte $transitions transitions au lieu de 11"
fi

a_motif=$(psql_db -c "select count(*) from public.workflow_transitions where workflow_id='$WORKFLOW_GLOBAL' and require_comment")
if [ "${a_motif:-0}" -eq 5 ]; then
	ok "cinq transitions exigent un motif : le §7.8 est démontrable en permanence"
else
	fail "$a_motif transitions exigent un motif au lieu de 5 : le §7.8 n'est plus démontré"
fi

# Deux étapes sans transition sortante : c'est ce qui rend le bouton désactivé et lisible du §7.7
# démontrable par une donnée, et non par un cas fabriqué.
sans_sortie=$(psql_db -c "
	select count(*) from public.workflow_steps s
	where s.workflow_id='$WORKFLOW_GLOBAL'
	  and not exists (select 1 from public.workflow_transitions t where t.from_step_id = s.id)")
if [ "${sans_sortie:-0}" -eq 2 ]; then
	ok "deux étapes n'ont aucune transition sortante : l'état désactivé est démontré"
else
	fail "$sans_sortie étapes sans transition sortante au lieu de 2"
fi

actives=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and archived_at is null and deleted_at is null")
if [ "${actives:-0}" -eq 4 ]; then
	ok "grands-comptes porte quatre cards actives"
else
	fail "grands-comptes porte $actives cards actives au lieu de 4"
fi

rangees=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and (archived_at is not null or deleted_at is not null)")
if [ "${rangees:-0}" -eq 2 ]; then
	ok "et deux cards rangées — archivée et corbeille — que le board doit exclure"
else
	fail "$rangees cards rangées au lieu de 2 : l'exclusion du §7.3 n'est plus démontrée"
fi

# Cinq colonnes vides sur sept sont la situation NORMALE, et c'est ce qui distingue une
# composition partant des étapes d'un groupement des cards (§7.3).
occupees=$(psql_db -c "
	select count(distinct current_step_id) from public.cards
	where channel_id='$CHANNEL_GRANDS_COMPTES' and archived_at is null and deleted_at is null")
if [ "${occupees:-0}" -eq 3 ]; then
	ok "elles n'occupent que trois étapes sur sept : quatre colonnes vides sont démontrées"
else
	fail "les cards occupent $occupees étapes au lieu de 3"
fi

# CONTRÔLE RETOURNÉ — décision 51, et le motif est écrit ici plutôt que dans un journal.
#
# Ce contrôle assérait « aucune card du seed n'atteint son seuil : l'écart du §7.4 est constaté,
# pas oublié ». Il figeait une ABSENCE, et la tranche 3 de `CRM-046` (docs/SPEC-seed.md §9.12) la
# comble : le seed pose désormais `…0c3` à trente jours d'une étape dont le seuil est de quatorze.
# L'assertion n'est pas retirée — elle est retournée, et mesure la PRÉSENCE : exactement une card
# au-delà, et c'est celle-là.
#
# LA COMPARAISON EST `>=`, ET CE N'EST PAS UN DÉTAIL : `evaluerAnciennete` de
# `webapp/src/lib/board.ts` bascule à `jours >= seuilJours`. Un `>` ici mesurerait une autre règle
# que celle que l'écran applique, et laisserait passer la card posée exactement sur son seuil.
CARD_EN_RETARD='5eed0000-0000-4000-8000-0000000000c3'
# $1 : ce qui est projeté ; $2 : la comparaison à l'intervalle du seuil.
lire_anciennete() {
	psql_db -c "select $1 from public.cards c
		join public.workflow_steps s on s.id = c.current_step_id
		join public.workflow_nodes_catalog n on n.id = s.node_id
		where c.archived_at is null and c.deleted_at is null
		  and coalesce(s.stale_after_days, n.default_stale_after_days) is not null
		  and now() - c.entered_step_at $2
		      make_interval(days => coalesce(s.stale_after_days, n.default_stale_after_days))"
}
# CONTRÔLE RÉVISÉ UNE SECONDE FOIS — `CRM-062` tranche 3a, docs/SPEC-relances.md §10.2.2.
#
# Il assérait « exactement UNE card au-delà », ce qui était le contrat du §9.12.6 ligne a tant que
# `CRM-046` était seul à l'écrire. La tranche 3a le révise : l'écran des affaires figées ne
# démontrerait ni son classement ni son regroupement sur une ligne unique (§5), et le seed en pose
# donc QUATRE. L'assertion n'est ni retirée ni relâchée — un `-ge 1` aurait été le contournement que
# `CLAUDE.md` §18 interdit : elle compte quatre, et la suivante nomme lesquelles.
au_dela=$(lire_anciennete 'count(*)' '>=')
if [ "${au_dela:-0}" -eq 4 ]; then
	ok "quatre cards du seed dépassent leur seuil : la bascule du §7.4 et le classement de l'écran
   des affaires figées sont démontrables"
else
	fail "$au_dela cards dépassent leur seuil au lieu de quatre (docs/SPEC-seed.md §9.12.6 a,
   révisé par docs/SPEC-relances.md §10.2.2)"
fi

# Ligne b du contrat : ce sont bien LES QUATRE du §10.2.1, et non des cards qu'un rejeu aurait
# vieillies par accident. La liste est triée pour que la comparaison ne dépende d'aucun ordre de
# lecture, et `…0c3` — celle de `CRM-046` — doit toujours en faire partie.
lesquelles=$(lire_anciennete "string_agg(c.id::text, ',' order by c.id::text)" '>=')
ATTENDUES='5eed0000-0000-4000-8000-0000000000c3,5eed0000-0000-4000-8000-0000000000c4,5eed0000-0000-4000-8000-0000000000cf,5eed0000-0000-4000-8000-00000000d007'
if [ "$lesquelles" = "$ATTENDUES" ]; then
	ok "les quatre cards en retard sont celles du §10.2.1, « Audit sécurité applicative » comprise"
else
	fail "les cards en retard sont « $lesquelles » au lieu de « $ATTENDUES »"
fi

# L'ORDRE EST ASSÉRÉ ENTIER, ET C'EST LUI QUE L'ÉCRAN REND. Un compte de quatre et une liste
# d'identifiants seraient verts même si les retards étaient égaux — or le §10.2.1 point 1 exige
# qu'ils soient deux à deux DISTINCTS, sans quoi l'ordre du §3.4 ne serait pas total sur ce jeu et
# aucune preuve ne pourrait asserter une suite.
suite=$(psql_db -c "select string_agg(retard_jours::text, ',' order by retard_jours desc)
                      from public.cards_figees()")
if [ "$suite" = "35,18,16,7" ]; then
	ok "les retards valent 35, 18, 16, 7 — deux à deux distincts, donc l'ordre du §3.4 est total"
else
	fail "les retards du jeu sont « $suite » au lieu de « 35,18,16,7 » (§10.2.1)"
fi

# Le regroupement de l'écran porte sur le CHANNEL (§10.7), et il n'a rien à regrouper si les quatre
# affaires vivent dans quatre dossiers d'un même track. Le contrôle mesure les deux dimensions.
dossiers=$(psql_db -c "select count(distinct f.channel_id) from public.cards_figees() f")
pistes=$(psql_db -c "select count(distinct ch.track_id) from public.cards_figees() f
                       join public.channels ch on ch.id = f.channel_id")
if [ "$dossiers" = "4" ] && [ "$pistes" = "3" ]; then
	ok "quatre dossiers pour trois tracks : un track en porte deux, seul cas qui prouve que le
   regroupement du §10.7 porte sur le channel et non sur le track"
else
	fail "$dossiers dossiers et $pistes tracks au lieu de quatre et trois (§10.2.1 point 2)"
fi

# Ligne e : sans une card EN DEÇÀ, « au-delà » ne serait pas un contraste mais un état général.
en_deca=$(lire_anciennete 'count(*)' '<')
if [ "${en_deca:-0}" -ge 1 ]; then
	ok "$en_deca cards portent un seuil et restent en deçà : la pastille neutre se démontre aussi"
else
	fail "aucune card en deçà de son seuil : le contraste du §9.12.6 e a disparu"
fi

# --- 3. Tests unitaires --------------------------------------------------------------------------

titre "3. Tests unitaires"

if npm run test:unit --silent > "$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit vert"
else
	fail "npm run test:unit en échec — voir $TRAVAIL/unit.log"
	tail -20 "$TRAVAIL/unit.log" || true
fi

if npm run typecheck --silent > "$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck vert sur les quatre projets"
else
	fail "npm run typecheck en échec — voir $TRAVAIL/tsc.log"
fi

# --- 4. Preuve d'API : les quatre lectures, contre la pile réelle ---------------------------------

titre "4. Preuve d'API — les quatre lectures du §7.2, hors interface"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuve d'\''API (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		> "$TRAVAIL/api.log" 2>&1; then
		ok "e2e/api/board.spec.ts vert avec les jetons réels"
	else
		fail "e2e/api/board.spec.ts en échec — voir $TRAVAIL/api.log"
		tail -30 "$TRAVAIL/api.log" || true
	fi
fi

# --- 5. Preuve d'interface, captures et vidéo ----------------------------------------------------

titre "5. Preuve d'interface, captures et vidéo"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuve d'\''interface et build (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		> "$TRAVAIL/ui.log" 2>&1; then
		ok "e2e/ui/board.spec.ts vert contre le build de production"
	else
		fail "e2e/ui/board.spec.ts en échec — voir $TRAVAIL/ui.log"
		tail -30 "$TRAVAIL/ui.log" || true
	fi

	for capture in board-anonyme-1440 board-charge-1440 board-menu-ouvert-1440 \
		board-apres-depot-1440 board-refus-1440 board-champs-manquants-1440 \
		board-motif-exige-1440 board-xl-1440 board-lg-1152 board-md-900 board-sm-390; do
		if [ -s "$CAPTURES/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE : la vérification visuelle n'a pas eu lieu"
		fi
	done

	# La vidéo que la Definition of Done exige nommément. Elle est enregistrée délibérément par le
	# scénario dédié, et non récupérée d'un échec : la configuration conserve les vidéos
	# `retain-on-failure`, ce qui n'en produit aucune quand tout va bien.
	if [ -s "$CAPTURES/glisser-deposer.webm" ]; then
		ok "vidéo glisser-deposer.webm produite (Definition of Done de CRM-041)"
	else
		fail "vidéo glisser-deposer.webm ABSENTE : la Definition of Done l'exige nommément"
	fi

	if npm run build --silent > "$TRAVAIL/build.log" 2>&1; then
		ok "npm run build vert"
		if node scripts/lib/classes-css.mjs webapp/src webapp/dist > "$TRAVAIL/classes.log" 2>&1; then
			ok "chaque classe citée par le board existe dans le CSS produit"
		else
			fail "des classes citées n'existent pas dans le CSS produit — voir $TRAVAIL/classes.log"
			tail -10 "$TRAVAIL/classes.log" || true
		fi
	else
		fail "npm run build en échec — voir $TRAVAIL/build.log"
	fi
fi

# --- 6. Dégradations : le harnais est-il complaisant ? --------------------------------------------

titre "6. Dégradations volontaires — le harnais échoue-t-il vraiment ?"

# LE RETOURNEMENT DU RECENSEMENT DU ROUTEUR (§1) EST ICI, MAIS HORS DU GARDE `--rapide` : il ne
# lance ni npm, ni Playwright, ni la moindre requête, et il ne dégrade RIEN du dépôt — il mute une
# arborescence de routeur JETABLE, écrite ici même. Le soustraire au mode rapide reviendrait à ne
# jamais l'exécuter dans le mode qui sert justement à rejouer les contrôles de structure.
#
# Un contrôle de structure qui n'est pas retourné ne prouve rien de plus qu'un `true`
# (docs/SPEC-channels.md §5.4.1, dernier paragraphe).
ROUTEUR_FACTICE="$TRAVAIL/routeur"
mkdir -p "$ROUTEUR_FACTICE/app" "$ROUTEUR_FACTICE/lib"

cat > "$ROUTEUR_FACTICE/app/chemins.ts" <<'FACTICE'
export const CHEMIN_FACTICE_TRACK = '/tracks/:slugTrack/factice' as const
export const CHEMINS_FACTICE = ['/tracks/:slugTrack'] as const
export const CHEMIN_FACTICE_TRANSVERSE = '/factice' as const
FACTICE

cat > "$ROUTEUR_FACTICE/app/routes.tsx" <<'FACTICE'
export const ROUTES: readonly DescriptionRoute[] = [
	{
		chemin: CHEMIN_FACTICE_TRANSVERSE,
		cleTitre: 'route.factice.title',
		rendu: () => <EcranTransverseFactice />,
	},
]
FACTICE

cat > "$ROUTEUR_FACTICE/app/App.tsx" <<'FACTICE'
export function RoutesApplication() {
	return (
		<Routes>
			{ROUTES.map((route) => (
				<Route
					key={route.chemin}
					path={route.chemin}
					element={
						<AppShell cleTitreRoute={route.cleTitre}>{route.rendu()}</AppShell>
					}
				/>
			))}
			{CHEMINS_FACTICE.map((chemin) => (
				<Route key={chemin} path={chemin} element={<EcranTrackFactice />} />
			))}
			<Route path={CHEMIN_FACTICE_TRACK} element={<EcranTrackFactice />} />
		</Routes>
	)
}
FACTICE

cat > "$ROUTEUR_FACTICE/app/EcranTrackFactice.tsx" <<'FACTICE'
import { useContenuTrack } from '../lib/channels'
export function EcranTrackFactice() {
	return useContenuTrack()
}
FACTICE

cat > "$ROUTEUR_FACTICE/app/EcranTransverseFactice.tsx" <<'FACTICE'
export function EcranTransverseFactice() {
	return null
}
FACTICE

cat > "$ROUTEUR_FACTICE/lib/channels.ts" <<'FACTICE'
export function useContenuTrack() {
	return client.from('channels').select('id')
}
FACTICE

cp -r "$ROUTEUR_FACTICE" "$TRAVAIL/routeur-intact"

muter_routeur() {
	local libelle=$1 attendu=$2
	auditer_routeur "$ROUTEUR_FACTICE" > "$TRAVAIL/routeur-mute.txt" 2>&1 || true
	if grep -q "^$attendu ANOMALIE" "$TRAVAIL/routeur-mute.txt"; then
		ok "routeur muté — « $libelle » est refusé par le contrôle $attendu"
	else
		fail "COMPLAISANT : « $libelle » et le contrôle $attendu reste vert"
	fi
	rm -rf "$ROUTEUR_FACTICE"
	cp -r "$TRAVAIL/routeur-intact" "$ROUTEUR_FACTICE"
}

# M1 — la route porteuse d'un `slugTrack` résout son track sans le chargeur du chapitre.
sed -i "s|import { useContenuTrack } from '../lib/channels'|import { chargerChannels } from '../lib/propre'|" \
	"$ROUTEUR_FACTICE/app/EcranTrackFactice.tsx"
muter_routeur "une route de track sans useContenuTrack (§5.4 nié)" B

# M2 — la même route réécrit sa propre lecture des channels : le défaut nommé par le §5.4.
printf "const propre = client.from('channels').select('id')\n" \
	>> "$ROUTEUR_FACTICE/app/EcranTrackFactice.tsx"
muter_routeur "une route de track qui relit les channels (§5.4 nié)" C

# M3 — LA MUTATION QUE LE COMPTAGE DE FICHIERS NE POUVAIT PAS VOIR (INC-241) : la seconde lecture
# est glissée DANS le chargeur partagé, le fichier reste unique, et les deux définitions de
# « channel non archivé » divergent quand même (décisions 167 et 169).
printf "const seconde = client.from('channels').select('id, name')\n" \
	>> "$ROUTEUR_FACTICE/lib/channels.ts"
muter_routeur "une seconde lecture dans le chargeur partagé (§5.4.1 d nié)" D

# M4 — le recensement ne trouve plus aucune route porteuse : un contrôle qui ne mesure plus rien
# doit se déclarer fautif, jamais rendre un vert vide.
sed -i 's|:slugTrack|:idAutre|g' "$ROUTEUR_FACTICE/app/chemins.ts"
muter_routeur "un routeur sans route porteuse de « :slugTrack »" A

# L'arborescence jetable est rendue intacte : le recensement doit la déclarer conforme, sans quoi
# les quatre refus ci-dessus ne prouveraient qu'un contrôle rouge en permanence.
auditer_routeur "$ROUTEUR_FACTICE" > "$TRAVAIL/routeur-rendu.txt" 2>&1 || true
if grep -q 'ANOMALIE' "$TRAVAIL/routeur-rendu.txt"; then
	fail "le routeur factice rendu intact reste fautif : le contrôle est rouge en permanence"
else
	ok "routeur factice rendu intact — les quatre contrôles redeviennent verts"
fi

degradation() {
	local libelle=$1 fichier=$2 avant=$3 apres=$4 cible=$5
	sauvegarder "$fichier"
	if ! grep -qF "$avant" "$fichier"; then
		fail "dégradation « $libelle » impossible : motif introuvable dans $fichier"
		return
	fi
	python3 - "$fichier" "$avant" "$apres" <<'PY'
import sys
chemin, avant, apres = sys.argv[1:4]
source = open(chemin, encoding='utf-8').read()
open(chemin, 'w', encoding='utf-8').write(source.replace(avant, apres, 1))
PY
	if [ "$cible" = unit ]; then
		if npm run test:unit --silent > "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et les tests unitaires restent verts"
		else
			ok "« $libelle » fait échouer les tests unitaires"
		fi
	elif [ "$cible" = ui ]; then
		# La preuve d'interface s'exécute contre le **build de production** : Playwright le
		# reconstruit à chaque exécution, la dégradation est donc bien celle qui est servie.
		if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
			> "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et la preuve d'interface reste verte"
		else
			ok "« $libelle » fait échouer la preuve d'interface"
		fi
	else
		if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
			> "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et la preuve d'API reste verte"
		else
			ok "« $libelle » fait échouer la preuve d'API"
		fi
	fi
	rendre "$fichier"
}

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m dégradations (--rapide)\n'
else
	# D1 — la composition part des cards au lieu des étapes : les colonnes vides disparaissent.
	# C'est le défaut que le §7.3 interdit nommément, et il serait invisible sur un board où
	# toutes les étapes sont occupées.
	degradation "les colonnes vides disparaissent (§7.3 nié)" "$MODULE" \
		'	const colonnes = ordonnees.map((etape) => {' \
		'	const colonnes = ordonnees
		.filter((etape) => cards.some((card) => card.current_step_id === etape.id))
		.map((etape) => {' unit

	# D2 — l'ordre du menu revient à l'ordre de réception. MESURÉ : `workflow_transitions` ne
	# porte aucune colonne `position` ; sans tri par position de l'étape cible, « Marquer perdu »
	# passerait avant « Relancer » selon l'ordre que PostgREST rend (§7.5).
	degradation "le menu perd son ordre (§7.5 nié)" "$MODULE" \
		'		liste.sort((gauche, droite) => gauche.versEtape.position - droite.versEtape.position)' \
		'		liste.reverse()' unit

	# D3 — le cumul additionne deux devises. Le seed ne mêle jamais deux devises dans une même
	# colonne : cette règle n'est tenue par aucune donnée permanente, seulement par le test.
	degradation "deux devises s'additionnent (§7.3 nié)" "$MODULE" \
		"	if (avecMontant.some((card) => card.currency !== devise)) return null" \
		"	if (false) return null" unit

	# D4 — un refus inconnu est absorbé dans un jeton connu. C'est exactement la valeur par défaut
	# trompeuse que CLAUDE.md §18 proscrit : l'écran annoncerait une raison fausse.
	degradation "un refus inconnu est absorbé (CLAUDE.md §18 nié)" "$MODULE" \
		"	return { cle: null, champsManquants: [], brut: message }" \
		"	return { cle: 'forbidden', champsManquants: [], brut: message }" unit

	# D5 — le déplacement optimiste n'est plus annulé après un refus : la card resterait dans la
	# colonne d'arrivée alors que la base ne l'y a jamais mise (§7.9, docs/DESIGN_SYSTEM.md §6).
	degradation "le retour arrière disparaît après un refus (§7.9 nié)" "$COMPOSANT" \
		'			onCards(avant)
			setRefus(resultat.refus)' \
		'			setRefus(resultat.refus)' unit

	# D6 — une transition à motif redevient optimiste et appelle sans demander le motif. Le §7.8
	# l'interdit, et le contrat de la garde le refuserait de toute façon : l'utilisateur verrait
	# la card partir puis revenir pour rien.
	degradation "une transition à motif appelle sans le demander (§7.8 nié)" "$COMPOSANT" \
		'			if (transition.requiertCommentaire) {' \
		'			if (false) {' unit

	# D7 — toute colonne devient une cible de dépôt. La troisième règle d'origine du §7 tombe :
	# un dépôt sur une colonne non atteignable émettrait un appel que le client savait perdu.
	# Seule la preuve d'INTERFACE peut l'attraper — le refus est celui du navigateur.
	degradation "toute colonne devient une cible de dépôt (§7.6 nié)" "$COMPOSANT" \
		'				if (!atteignable) return
				evenement.preventDefault()
				evenement.dataTransfer.dropEffect = '\''move'\''' \
		'				evenement.preventDefault()
				evenement.dataTransfer.dropEffect = '\''move'\''' ui

	# D8 — le board cesse d'exclure les cards rangées côté serveur. La définition d'« active » de
	# docs/SPEC-cards.md §5 tombe, et le board afficherait des affaires archivées ou en corbeille
	# que `move_card` refuserait de déplacer.
	degradation "les cards rangées reviennent sur le board (§7.3 nié)" "$MODULE" \
		"			.is('archived_at', null)
			.is('deleted_at', null)" \
		"			.order('position')" unit

	# D9 — CONTRE-ÉPREUVE DU CONTRÔLE RETOURNÉ (docs/SPEC-seed.md §9.12.4, révisé par
	# docs/SPEC-relances.md §10.2.2). Elle ne touche aucun fichier : elle vieillit une CINQUIÈME
	# card, `…0c1`, de huit jours dans une étape dont le seuil est de sept. Sans elle, « exactement
	# quatre » ne serait pas mesuré — un contrôle qui compte pourrait compter n'importe quoi tant
	# que rien ne le contredit.
	anciennete_degradee=true
	psql_db -c "update public.cards set entered_step_at = now() - interval '8 days'
	            where id = '$CARD_TEMOIN_ANCIENNETE';" >/dev/null
	temoin=$(lire_anciennete 'count(*)' '>=')
	if [ "${temoin:-0}" -eq 4 ]; then
		fail "COMPLAISANT : une cinquième card vieillie et le compte reste à quatre"
	else
		ok "« une cinquième card vieillie » fait bien passer le compte à $temoin : le contrôle mord"
	fi
	psql_db -c "update public.cards set entered_step_at = now()
	            where id = '$CARD_TEMOIN_ANCIENNETE';" >/dev/null
	anciennete_degradee=false

	# D9 bis — LA DÉGRADATION DANS L'AUTRE SENS, et elle est due depuis que le jeu en compte
	# quatre (§10.2.2). D9 seule ne mesure qu'un débordement ; un seed qui CESSERAIT de vieillir
	# l'une des quatre passerait inaperçu, et l'écran perdrait son classement sans qu'un contrôle
	# ne bronche. Elle rajeunit `…0cf`, la moins en retard des quatre.
	figee_rajeunie=true
	psql_db -c "update public.cards set entered_step_at = now()
	            where id = '$CARD_FIGEE_LEGACY';" >/dev/null
	manquante=$(lire_anciennete 'count(*)' '>=')
	if [ "${manquante:-0}" -eq 4 ]; then
		fail "COMPLAISANT : une des quatre rajeunie et le compte reste à quatre"
	else
		ok "« une des quatre rajeunie » fait bien passer le compte à $manquante : le contrôle mord
   dans les DEUX sens"
	fi
	psql_db -c "update public.cards set entered_step_at = now() - interval '12 days'
	            where id = '$CARD_FIGEE_LEGACY';" >/dev/null
	figee_rajeunie=false

	rendu=$(lire_anciennete 'count(*)' '>=')
	rendu_suite=$(psql_db -c "select string_agg(retard_jours::text, ',' order by retard_jours desc)
	                            from public.cards_figees()")
	if [ "${rendu:-0}" -eq 4 ] && [ "$rendu_suite" = "35,18,16,7" ]; then
		ok "l'ancienneté est rendue : quatre cards en retard et la suite 35,18,16,7, comme le seed
   les pose — la restauration est CONSTATÉE, pas supposée"
	else
		fail "l'ancienneté est laissée DÉGRADÉE : $rendu cards en retard, suite « $rendu_suite »"
	fi
fi

# --- 7. L'état rendu derrière le harnais ---------------------------------------------------------

titre "7. Ce que le harnais laisse derrière lui"

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$CHANNELS"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu tel qu'il était à l'entrée du harnais"
	else
		fail "$(basename "$fichier") est laissé MODIFIÉ : une dégradation n'a pas été restaurée"
	fi
done

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m rejeu final (--rapide)\n'
else
	if npm run test:unit --silent > "$TRAVAIL/final.log" 2>&1; then
		ok "npm run test:unit rejoué après les dégradations : vert"
	else
		fail "npm run test:unit rouge APRÈS restauration : le harnais a laissé le produit dégradé"
	fi
fi

# --- Bilan ---------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
