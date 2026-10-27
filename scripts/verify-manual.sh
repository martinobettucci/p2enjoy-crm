#!/usr/bin/env bash
# @verifies CRM-117 (docs/BACKLOG.md) tranche T3.0 — la preuve du manuel public, révisée avant la réécriture
# @verifies docs/SPEC-manual.md §10 (le contrat d'un chapitre public : aucune référence interne, libellés réels, aucun
#           volume, aucun secret), §10 bis (le plan, les chapitres réécrits à mesure), §12 (la correspondance entre
#           unités et chapitres), §15 (le manuel construit est à jour), §16 (la preuve du manuel et sa contre-épreuve)
# @verifies CLAUDE.md §7 (documentation utilisateur : compréhensible sans le code, sans secret ni adresse interne)
# @verifies CRM-047 (docs/BACKLOG.md) — l'origine de ce harnais et de ses contrôles des libellés et des volumes
# @verifies CRM-097 (docs/BACKLOG.md) tranche T2.d — les libellés du parcours de l'assistant IA (docs/SPEC-ia.md §12.5)
# @verifies CRM-097 tranche T3.d — les libellés du parcours « Suggérer » (docs/SPEC-ia.md §13.6, chapitre 18.3)
# @verifies CRM-098 (docs/BACKLOG.md) tranche T4 — les libellés de la saisie de temps et du coût du personnel
#           (docs/SPEC-temps.md §7, chapitre 28)
# @verifies CRM-099 (docs/BACKLOG.md) — les libellés des réels d'une ligne de coût (chapitre 27)
# @verifies CRM-106 (docs/BACKLOG.md) tranche T3 — les libellés de la bande de la fiche (docs/SPEC-temps.md §7.6,
#           chapitre 28.7) ; CRM-107 tranche T3 — ceux du calculateur (§7.4 bis, chapitre 28.5)
# @verifies CRM-101 (docs/BACKLOG.md) tranche T4 — les libellés de la plateforme (docs/SPEC-plateforme.md §7, chapitre 32)
# @verifies CRM-103 (docs/BACKLOG.md) tranche T3 — les libellés de l'administration du connecteur (docs/SPEC-mcp.md §8.1,
#           chapitre 33)
#
# Vérifie que `docs/manual.md` est un manuel PUBLIC : écrit pour une personne membre d'un espace, qui ne connaît ni le
# dépôt, ni le backlog, ni le jeu de démonstration (docs/SPEC-manual.md §9).
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. le manuel construit (`docs/manuel/construit/`) est celui que la source produit ;
#   2. les chapitres déjà réécrits ne portent aucune référence interne — identifiant d'unité, d'incohérence ou de
#      décision, tranche, chemin ou nom de fichier du dépôt, nom de variable d'environnement, commande de terminal,
#      mention du seed, du jeu de démonstration ou du développement (§10, point 2) ;
#   3. chaque libellé du parcours cité par le manuel existe LITTÉRALEMENT dans `webapp/src/i18n/fr.ts` ;
#   4. aucun volume du jeu de démonstration n'est recopié (§10, point 4) ;
#   5. le manuel ne porte aucune valeur de variable d'environnement, aucune clé, aucun jeton ;
#   6. chaque chapitre et chaque section de la table du §12 existe dans le manuel construit.
#
# RÉVISÉ PAR `CRM-117` T3.0 (docs/SPEC-manual.md §10 bis, 2026-10-27). La version de `CRM-047` exigeait l'annexe A
# comparée à la base, les dossiers de captures cités, les unités citées et leur couverture : exactement ce que le §10
# interdit désormais. Ces quatre contrôles sont RETIRÉS, non affaiblis : leur objet a disparu du manuel. Le harnais ne
# lit plus la base.
#
# LE CONTRÔLE 2 GRANDIT AVEC LA RÉÉCRITURE. Il porte sur `CHAPITRES_REECRITS`, que chaque tranche de T3 complète ; à la
# fin de T3.5, il couvre tout le manuel et la liste disparaît au profit du manuel entier.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il vérifie des FAITS, pas du SENS. Il ne reconnaît pas un nom de table ou de colonne écrit en toutes lettres, ni une
# phrase juste mais trompeuse. Les identifiants de `aide-ecrans.ts` sont prouvés par sa preuve unitaire
# (`webapp/src/app/aide-ecrans.test.ts`). Les images arrivent avec T4, et leurs contrôles avec elles. La relecture
# humaine reste la seule preuve de la qualité d'un manuel.
#
# Usage :
#   scripts/verify-manual.sh
#   scripts/verify-manual.sh --contre-epreuve   dégrade une COPIE du manuel et de la table du §12, et exige que
#                                               chaque famille de contrôles morde ; ne touche jamais au dépôt

set -euo pipefail

cd "$(dirname "$0")/.."

MANUEL=docs/manual.md
SPEC=docs/SPEC-manual.md
CONSTRUIT=docs/manuel/construit
I18N=webapp/src/i18n/fr.ts

CONTRE_EPREUVE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--contre-epreuve) CONTRE_EPREUVE=true ;;
		--help|-h) sed -n '2,52p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0
checks=0

ok()    { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail()  { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }

# ---------------------------------------------------------------------------------------------
# Les chapitres déjà réécrits pour le lecteur (docs/SPEC-manual.md §10 bis), par identifiant. Chaque tranche de T3 y
# ajoute les siens ; le contrôle 2 ne porte que sur eux tant que la réécriture n'est pas finie.
# ---------------------------------------------------------------------------------------------
CHAPITRES_REECRITS=(
)

# Libellés que le manuel cite entre guillemets pour décrire un parcours, et qui
# doivent exister LITTÉRALEMENT dans le catalogue de traductions. C'est le contrôle qui aurait
# attrapé « Affaire introuvable » deux unités plus tôt.
LIBELLES_PARCOURS=(
	"Aucun board à afficher"
	"Aucun track"
	"Aucun channel"
	"Aucun workspace accessible"
	"Track introuvable"
	"Card introuvable"
	"Aucune affaire dans ce channel"
	"Aucune affaire ne correspond"
	"Cette page n'existe plus"
	"Chargement impossible"
	"Accès refusé"
	"Configuration incomplète"
	"Aucun élément pour ces filtres"
	"Aucun événement pour le moment"
	"Commentaire supprimé"
	# CRM-097 T2 — l'assistant IA (chapitre 18.2)
	"Créer avec l’IA"
	"Décrivez le workflow"
	"Générer la suggestion"
	"Revoir avec l’IA"
	"Enregistrer la correction"
	"Accepter et créer le workflow"
	"Abandonner la suggestion"
	"Suggestions de l’IA en revue"
	# CRM-097 T3 — faire évoluer un workflow (chapitre 18.3)
	"Suggérer"
	"Décrivez ce qui doit changer"
	"Ce qui change"
	"Où vont les affaires des étapes retirées"
	"Aucune destination"
	"Accepter et faire évoluer le workflow"
	"Suggestions de l’IA pour ce workflow"
	# CRM-098 — la saisie de temps et le coût du personnel (chapitre 28)
	"Ajouter une affaire"
	"Cette valeur dépasserait la journée de 7 heures."
	"Semaine précédente"
	"Semaine suivante"
	"Cette semaine"
	"En heures"
	"Saisir pour"
	"Rapport mensuel"
	"non valorisé"
	"Toute l’équipe"
	"Coût du personnel"
	"Nouvelle version"
	"Historique"
	"Temps passé"
	"Votre temps"
	"Le temps de toute l’équipe"
	# CRM-106 — saisir son temps depuis la fiche (chapitre 28.7)
	"Votre semaine"
	"Ouvrir dans Temps"
	# CRM-107 — le calculateur du coût par quart (chapitre 28.5)
	"Calculer depuis le coût mensuel"
	"Utiliser ce coût"
	"Enregistrer la version"
	"Coût par quart"
	# CRM-099 — plusieurs réels par ligne de coût (chapitre 27)
	"Un réel de plus"
	"Déjà saisi"
	"Ajouter le réel"
	"Sans libellé"
	"Soldé"
	# CRM-101 — la plateforme (chapitre 32)
	"Plateforme"
	"Accès réservé"
	"Espaces"
	"Superadministrateurs"
	"Journal"
	"Nouvel espace"
	"Nom"
	"Identifiant court"
	"Domaine entrant (facultatif)"
	"Créer"
	"Aucun administrateur"
	"Membres"
	"Ajouter un membre"
	"Retirer"
	"Inscrire une attente"
	"En suspens"
	"Modifier"
	"Supprimer l’espace"
	"Supprimer définitivement"
	"Amorçage"
	"Accorder le drapeau"
	"Entrées plus anciennes"
	# CRM-101 T6 et CRM-103 — les utilisateurs et le connecteur (chapitres 32.7 et 33)
	"Utilisateurs"
	"Rechercher un utilisateur"
	"Droits du connecteur"
	"Connecteur MCP"
	"Sans profil dans le CRM"
	"Accorder des droits à un utilisateur"
	"Jamais connecté"
	"Toute la famille"
	"Toute l’action"
	"Enregistrer les droits"
	"Annuler les modifications"
	"Droits enregistrés."
	"Journal des appels"
	"Réussi"
	"Refusé par la matrice"
	"Refusé par le CRM"
	"Réponse trop volumineuse"
)


# ---------------------------------------------------------------------------------------------
# Contrôles.
# ---------------------------------------------------------------------------------------------

controler_construit() {
	titre "1. Le manuel construit est celui que la source produit (§15)"
	if node scripts/manuel/construire.mjs --verifier >/dev/null 2>&1; then
		ok "docs/manuel/construit/ est à jour"
	else
		fail "docs/manuel/construit/ diffère de ce que docs/manual.md produit : npm run manuel:construire"
	fi
}

# Les motifs d'une référence interne (§10, point 2). Chacun est une forme RÉELLEMENT présente dans le manuel d'avant
# la réécriture : 166 identifiants d'unité, 60 chemins, 58 mentions du seed ou du développement (mesuré le 2026-10-27).
MOTIFS_INTERNES=(
	'unité|\bCRM-[0-9P][0-9]{2}'
	'incohérence|\bINC-[0-9]+'
	'décision|\b[Dd]écisions? (n° ?)?[0-9]+'
	'tranche|\b[Tt]ranches? [0-9T]|\bT[0-9]+(\.[0-9a-z]+)?\b'
	'chemin du dépôt|\b(docs|scripts|webapp|supabase|e2e|mcp|stalwart)/'
	'fichier du dépôt|\b[A-Za-z0-9_.-]+\.(md|ts|tsx|mjs|sql|sh|py)\b'
	'variable d'"'"'environnement|\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b'
	'commande|\b(npm|npx|docker|psql|git|curl) [a-z-]'
	'jeu de démonstration|\b[Ss]eed\b|[Dd]émonstration|\.test\b|localhost'
	'développement|[Dd]éveloppement'
)

# Rend, pour chaque chapitre nommé, les lignes qui portent une référence interne : « famille|chapitre|n°|ligne ».
references_internes() {
	local fichier=$1
	shift
	node --input-type=module - "$fichier" "$@" <<'JS'
import { readFileSync } from 'node:fs'
import { identifiant } from './scripts/manuel/construction.mjs'
const [fichier, ...listes] = process.argv.slice(2)
const separation = listes.indexOf('--')
const chapitres = new Set(listes.slice(0, separation))
const motifs = listes.slice(separation + 1).map((m) => {
	const i = m.indexOf('|')
	return [m.slice(0, i), new RegExp(m.slice(i + 1))]
})
let courant = null
readFileSync(fichier, 'utf8').split('\n').forEach((ligne, i) => {
	const titre = /^## (.*)$/.exec(ligne)
	if (titre) courant = identifiant(titre[1])
	if (!chapitres.has(courant)) return
	for (const [famille, motif] of motifs)
		if (motif.test(ligne)) console.log(`${famille}|${courant}|${i + 1}|${ligne.slice(0, 140)}`)
})
JS
}

controler_references() {
	local fichier=$1
	shift
	titre "2. Aucune référence interne dans les chapitres réécrits (§10, point 2)"
	if [ $# -eq 0 ]; then
		info "aucun chapitre n'est encore réécrit : la liste CHAPITRES_REECRITS grandit à chaque tranche de T3"
		return 0
	fi
	local trouve=0 famille chapitre numero ligne
	while IFS='|' read -r famille chapitre numero ligne; do
		[ -z "$famille" ] && continue
		trouve=1
		fail "référence interne ($famille), $chapitre, ligne $numero : $ligne"
	done < <(references_internes "$fichier" "$@" -- "${MOTIFS_INTERNES[@]}")
	if [ "$trouve" -eq 0 ]; then ok "aucune référence interne dans $# chapitre(s) réécrit(s)"; fi
}

controler_libelles() {
	local fichier=$1
	titre "3. Chaque libellé du parcours cité est le libellé réel du produit (§10, point 1)"

	# Le manuel est replié à cent vingt colonnes : un libellé de plusieurs mots y est coupé par un retour à la ligne.
	# Comparer ligne à ligne déclarerait « non cité » un libellé pourtant présent. Le document est donc aplati d'abord.
	local aplati
	aplati=$(mktemp)
	tr '\n' ' ' < "$fichier" | tr -s ' ' > "$aplati"

	local libelle
	for libelle in "${LIBELLES_PARCOURS[@]}"; do
		if ! grep -qF "$libelle" "$aplati"; then
			info "libellé « $libelle » : non cité par le manuel, rien à vérifier"
			continue
		fi
		if grep -qF "$libelle" "$I18N"; then
			ok "libellé : « $libelle » existe dans le catalogue"
		else
			fail "libellé : le manuel cite « $libelle », que $I18N ne contient pas"
		fi
	done

	# Le contraire du même contrôle : un libellé PROCHE mais faux ne doit jamais reparaître. Il n'est pas déduit — il est
	# nommé, parce qu'il a réellement figuré dans le manuel.
	if grep -qF 'Affaire introuvable' "$aplati"; then
		fail "libellé : « Affaire introuvable » est de retour ; l'écran dit « Card introuvable »"
	else
		ok "libellé : « Affaire introuvable » n'est pas revenu"
	fi
	rm -f "$aplati"
}

controler_volumes() {
	local fichier=$1
	titre "4. Aucun volume du jeu de démonstration n'est recopié (§10, point 4)"
	# Tournures qui ont RÉELLEMENT produit une dérive, et elles seules. Un contrôle qui interdirait tout nombre
	# attraperait « 25 lignes par page », qui est une règle du produit et doit rester dans son chapitre.
	local motifs=(
		'[0-9]\+ affaires\?'
		'[0-9]\+ cards\?'
		'[0-9]\+ réponses\?'
		'[0-9]\+ commentaires\?'
		'[0-9]\+ événements\?'
		'[0-9]\+ channels\?'
		'[0-9]\+ tracks\?'
	)
	# Exclusions, et chacune est une RÈGLE du produit, pas un état de la base.
	local regles='affaires par page'

	local motif trouve=0 ligne
	for motif in "${motifs[@]}"; do
		while IFS= read -r ligne; do
			[ -z "$ligne" ] && continue
			if printf '%s' "$ligne" | grep -q "$regles"; then continue; fi
			trouve=1
			fail "volume recopié : $ligne"
		done < <(grep -n "$motif" "$fichier" | cut -c1-160)
	done
	# `if`, et non `[ … ] && ok …` : sous `set -e`, un `&&` dont la condition est fausse fait rendre 1 à la FONCTION, et
	# le script s'interrompt à la première anomalie sans jouer les contrôles suivants.
	if [ "$trouve" -eq 0 ]; then ok "aucun volume recopié"; fi
}

controler_secrets() {
	local fichier=$1
	titre "5. Le manuel ne porte aucun secret (CLAUDE.md §7)"
	local trouve=0 motif
	# Un JWT, une clé de service, un mot de passe recopié : les trois formes qu'un secret prend dans ce dépôt.
	for motif in 'eyJ[A-Za-z0-9_-]\{10,\}\.' 'SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' 'ANON_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' 'POSTGRES_PASSWORD[[:space:]]*=[[:space:]]*[^[:space:]]'; do
		if grep -q "$motif" "$fichier"; then
			trouve=1
			fail "secret : le manuel contient une valeur correspondant à « $motif »"
		fi
	done
	if [ "$trouve" -eq 0 ]; then ok "aucune valeur de secret dans le manuel"; fi
}

# La table du §12 : « | `CRM-0NN` | identifiant-du-chapitre | identifiant-de-section ou — | ».
controler_correspondance() {
	local spec=$1 sommaire=$2
	titre "6. Chaque chapitre et chaque section de la table du §12 existe dans le manuel construit"
	local resultat
	resultat=$(node --input-type=module - "$spec" "$sommaire" <<'JS'
import { readFileSync } from 'node:fs'
const [spec, sommaire] = process.argv.slice(2)
const texte = readFileSync(spec, 'utf8')
const debut = texte.indexOf('## 12. ')
const fin = texte.indexOf('\n## ', debut + 1)
const { chapters } = JSON.parse(readFileSync(sommaire, 'utf8'))
let lignes = 0
for (const ligne of texte.slice(debut, fin).split('\n')) {
	const m = /^\| `?(CRM-[0-9]{3})`? \| `?([a-z0-9-]+)`? \| `?([a-z0-9-]+|—)`? \|/.exec(ligne)
	if (!m) continue
	lignes += 1
	const [, unite, slug, ancre] = m
	const chapitre = chapters.find((c) => c.slug === slug)
	if (!chapitre) console.log(`ECHEC|${unite} : le chapitre « ${slug} » n'existe pas`)
	else if (ancre !== '—' && !chapitre.sections.some((s) => s.anchor === ancre))
		console.log(`ECHEC|${unite} : la section « ${ancre} » n'existe pas dans « ${slug} »`)
	else console.log(`OK|${unite} : ${slug}${ancre === '—' ? '' : '#' + ancre}`)
}
if (lignes === 0) console.log('INFO|la table du §12 n’a encore aucune ligne : elle s’établit à la réécriture')
JS
)
	local statut message
	while IFS='|' read -r statut message; do
		case "$statut" in
			OK) ok "$message" ;;
			ECHEC) fail "$message" ;;
			INFO) info "$message" ;;
		esac
	done <<< "$resultat"
}

executer_tous() {
	local fichier=$1 spec=$2
	shift 2
	controler_construit
	controler_references "$fichier" "$@"
	controler_libelles "$fichier"
	controler_volumes "$fichier"
	controler_secrets "$fichier"
	controler_correspondance "$spec" "$CONSTRUIT/contents.json"
}

# ---------------------------------------------------------------------------------------------
# Contre-épreuve : chaque famille de contrôles doit MORDRE.
# ---------------------------------------------------------------------------------------------
# Un harnais qu'on n'a jamais vu échouer ne prouve pas qu'il échoue. Les dégradations sont posées sur des COPIES du
# manuel et de la spécification — jamais sur le dépôt —, et CHACUNE doit produire au moins une anomalie de sa famille :
# un total global laisserait passer une famille devenue aveugle si une autre en produisait plusieurs.
#   2. un chapitre réécrit qui cite une unité, un fichier, une variable et le seed ;
#   3. le libellé faux, remis (« Affaire introuvable ») ;
#   4. un volume recopié dans un chapitre ;
#   5. une clé recopiée ;
#   6. une ligne du §12 qui désigne une section disparue.
# Le contrôle 1 lit le dépôt et non une copie : sa contre-épreuve est celle de la construction
# (`scripts/manuel/construction.test.ts`), qui dégrade la source.
if [ "$CONTRE_EPREUVE" = true ]; then
	titre "Contre-épreuve — chaque famille mord-elle ?"
	TEMPORAIRE=$(mktemp -d)
	trap 'rm -rf "$TEMPORAIRE"' EXIT
	COPIE="$TEMPORAIRE/manual-degrade.md"
	SPEC_COPIE="$TEMPORAIRE/SPEC-degradee.md"
	{
		cat "$MANUEL"
		printf '\n## 99. Un chapitre dégradé\n\n'
		printf 'Livré par CRM-999, voir docs/SPEC-x.md ; la variable SUPABASE_URL ; le seed le montre.\n\n'
		printf 'Cette adresse affiche « Affaire introuvable », et le channel porte 42 affaires.\n\n'
		printf 'SERVICE_ROLE_KEY=abc\n'
	} > "$COPIE"
	awk '
		/^## 12\. / { dans = 1 }
		dans && /^\| Unité \|/ { print; getline; print; print "| `CRM-998` | le-carnet-de-contacts | une-section-disparue |"; next }
		{ print }
	' "$SPEC" > "$SPEC_COPIE"

	compter() { local avant=$failures; "$@" > /dev/null; echo $((failures - avant)); }
	manquantes=()
	failures=0
	[ "$(compter controler_references "$COPIE" un-chapitre-degrade)" -ge 1 ] || manquantes+=("2 (références internes)")
	failures=0
	[ "$(compter controler_libelles "$COPIE")" -ge 1 ] || manquantes+=("3 (libellés)")
	failures=0
	[ "$(compter controler_volumes "$COPIE")" -ge 1 ] || manquantes+=("4 (volumes)")
	failures=0
	[ "$(compter controler_secrets "$COPIE")" -ge 1 ] || manquantes+=("5 (secrets)")
	failures=0
	[ "$(compter controler_correspondance "$SPEC_COPIE" "$CONSTRUIT/contents.json")" -ge 1 ] || manquantes+=("6 (table du §12)")

	printf '\n'
	if [ "${#manquantes[@]}" -eq 0 ]; then
		printf '\033[32mLe harnais MORD : chacune des cinq familles dégradées produit son anomalie.\033[0m\n'
		exit 0
	fi
	printf '\033[31mLe harnais est COMPLAISANT pour : %s.\033[0m\n' "${manquantes[*]}"
	exit 1
fi

titre "Preuves du manuel public — CRM-117 (docs/SPEC-manual.md §16)"
info "Manuel : $MANUEL — spécification : $SPEC"

executer_tous "$MANUEL" "$SPEC" "${CHAPITRES_REECRITS[@]}"

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
