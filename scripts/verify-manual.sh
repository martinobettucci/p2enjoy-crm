#!/usr/bin/env bash
# @verifies CRM-047 (docs/BACKLOG.md) — Definition of Done du manuel utilisateur du chunk 3
# @verifies docs/SPEC-manual.md §2 (contrat de couverture), §3 (contrat d'un chapitre),
#           §4 (les chiffres vivent dans l'annexe A), §5 (contrat de captures),
#           §7.2 (preuve documentaire et sa contre-épreuve)
# @verifies docs/manual.md (annexe A, règles de rédaction) ; docs/BACKLOG.md (unités citées)
# @verifies CLAUDE.md §7 (documentation utilisateur, aucun secret)
#
# Vérifie que `docs/manual.md` décrit le produit **réellement exécuté**, hors interface, contre la
# base réelle et contre les fichiers du dépôt.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. chaque grandeur de l'annexe A égale ce que la base porte, valeur par valeur ;
#   2. chaque dossier `docs/captures/<unité>/` cité par le manuel existe et n'est pas vide ;
#   3. chaque unité `CRM-0NN` citée par le manuel existe dans `docs/BACKLOG.md` ;
#   4. chaque unité du chunk 3 livrée est citée par le manuel — le contrat de couverture du §2 ;
#   5. chaque libellé du parcours cité par le manuel existe LITTÉRALEMENT dans `webapp/src/i18n/fr.ts` ;
#   6. aucun volume mesurable n'est recopié hors de l'annexe A ;
#   7. le manuel ne porte aucune valeur de variable d'environnement, aucune clé, aucun jeton.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il vérifie des FAITS, pas du SENS. Il attrape un chiffre faux, un libellé paraphrasé, une capture
# disparue, une unité oubliée, un secret recopié. Il n'attrape pas une phrase juste mais trompeuse,
# ni un chapitre qui décrirait correctement un écran sans dire l'essentiel. La relecture humaine
# reste la seule preuve de la qualité d'un manuel (docs/SPEC-manual.md §8).
#
# Il ne prouve **aucun écran** : c'est l'objet de `e2e/ui/manuel.spec.ts`, qui ouvre les huit
# adresses citées par le manuel en visiteur anonyme réel.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-manual.sh
#   scripts/verify-manual.sh --contre-epreuve   dégrade une COPIE du manuel et exige que le
#                                               harnais morde ; ne touche jamais au dépôt

set -euo pipefail

cd "$(dirname "$0")/.."

MANUEL=docs/manual.md
BACKLOG=docs/BACKLOG.md
I18N=webapp/src/i18n/fr.ts
DB_CONTAINER=p2enjoy-db

CONTRE_EPREUVE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--contre-epreuve) CONTRE_EPREUVE=true ;;
		--help|-h) sed -n '2,38p' "$0"; exit 0 ;;
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

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# ---------------------------------------------------------------------------------------------
# Les grandeurs de l'annexe A, et la requête qui fait foi pour chacune.
# ---------------------------------------------------------------------------------------------
# Le libellé de gauche est celui de la table du manuel, AU CARACTÈRE PRÈS : c'est la clé de
# jointure entre le document et la base. Le changer d'un côté sans l'autre rend le contrôle rouge,
# ce qui est le comportement voulu — une grandeur renommée en douce cesserait d'être vérifiée.
GRANDEURS=(
	"Tracks actifs|select count(*) from tracks where archived_at is null"
	"Tracks archivés|select count(*) from tracks where archived_at is not null"
	"Channels actifs|select count(*) from channels where archived_at is null"
	"Channels archivés|select count(*) from channels where archived_at is not null"
	"États du catalogue actifs|select count(*) from workflow_nodes_catalog where archived_at is null"
	"États du catalogue archivés|select count(*) from workflow_nodes_catalog where archived_at is not null"
	"Workflows|select count(*) from workflows"
	"Workflows copiés dans un track|select count(*) from workflows where scope = 'track'"
	"Étapes du workflow général|select count(*) from workflow_steps s join workflows w on w.id = s.workflow_id where w.scope = 'global'"
	"Déplacements déclarés par le workflow général|select count(*) from workflow_transitions t join workflows w on w.id = t.workflow_id where w.scope = 'global'"
	"Questions du formulaire actives|select count(*) from form_fields where archived_at is null"
	"Questions du formulaire retirées|select count(*) from form_fields where archived_at is not null"
	"Affaires|select count(*) from cards"
	"Affaires actives|select count(*) from cards where archived_at is null and deleted_at is null"
	"Affaires archivées|select count(*) from cards where archived_at is not null"
	"Affaires en corbeille|select count(*) from cards where deleted_at is not null"
	"Réponses de formulaire|select count(*) from card_field_values"
	"Affaires portant au moins une réponse|select count(distinct card_id) from card_field_values"
	"Commentaires|select count(*) from card_comments"
	"Commentaires supprimés|select count(*) from card_comments where deleted_at is not null"
	"Comptes de démonstration|select count(*) from workspace_members"
)

# Unités du chunk 3 qui ont livré du comportement visible ou opposable, et que le manuel doit donc
# citer (docs/SPEC-manual.md §2). `CRM-046` y figure : l'annexe A est son chapitre.
UNITES_CHUNK3=(
	CRM-007 CRM-012 CRM-013 CRM-020 CRM-021 CRM-030 CRM-031 CRM-032 CRM-033 CRM-034
	CRM-035 CRM-036 CRM-037 CRM-040 CRM-041 CRM-042 CRM-043 CRM-044 CRM-045 CRM-046
)

# Libellés que le manuel cite entre guillemets pour décrire le parcours d'un visiteur, et qui
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
)

# ---------------------------------------------------------------------------------------------
# Contrôles.
# ---------------------------------------------------------------------------------------------

# Extrait la valeur d'une grandeur de l'annexe A. Le manuel étant en Markdown, la ligne est de la
# forme `| <libellé> | <valeur> |`. L'appariement est ANCRÉ sur le libellé entier : un libellé
# préfixe d'un autre — « Affaires » et « Affaires actives » — ne doit jamais capturer sa suite.
valeur_annexe() {
	local libelle=$1 fichier=$2
	awk -F'|' -v cible=" $libelle " '
		NF >= 3 && $2 == cible { gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3; exit }
	' "$fichier"
}

controler_annexe() {
	local fichier=$1
	titre "1. Les grandeurs de l'annexe A égalent la base (docs/SPEC-manual.md §4)"
	local entree libelle requete attendu mesure
	for entree in "${GRANDEURS[@]}"; do
		libelle=${entree%%|*}
		requete=${entree#*|}
		attendu=$(valeur_annexe "$libelle" "$fichier")
		if [ -z "$attendu" ]; then
			fail "annexe A : grandeur « $libelle » absente du manuel"
			continue
		fi
		mesure=$(psql_db -c "$requete" | tr -d '[:space:]')
		if [ "$attendu" = "$mesure" ]; then
			ok "annexe A : $libelle = $mesure"
		else
			fail "annexe A : $libelle — le manuel dit « $attendu », la base dit « $mesure »"
		fi
	done

	# LE TOTAL D'ÉVÉNEMENTS N'EST PAS DANS LA TABLE, ET C'EST MESURÉ, PAS SUPPOSÉ (décision 234).
	# Il y figurait ; la première exécution de ce harnais après la suite d'API a rendu « le manuel
	# dit 38, la base dit 73 ». Un total d'événements ne se fige pas — décision 226 l'avait déjà
	# établi pour le seed. Ce qui se fige est l'invariant : aucune affaire sans son `created`.
	local orphelines
	orphelines=$(psql_db -c "select count(*) from cards c where not exists (select 1 from card_events e where e.card_id = c.id and e.type = 'created')" | tr -d '[:space:]')
	if [ "$orphelines" = "0" ]; then
		ok "annexe A : chaque affaire porte l'événement de sa création"
	else
		fail "annexe A : $orphelines affaire(s) sans événement de création"
	fi
}

controler_captures() {
	local fichier=$1
	titre "2. Chaque dossier de captures cité existe et n'est pas vide (§3.4)"
	local dossiers dossier
	dossiers=$(grep -o 'docs/captures/CRM-[0-9]\{3\}/' "$fichier" | sort -u)
	if [ -z "$dossiers" ]; then
		fail "aucun dossier de captures n'est cité par le manuel"
		return
	fi
	for dossier in $dossiers; do
		if [ ! -d "$dossier" ]; then
			fail "captures : « $dossier » est cité et n'existe pas"
		elif [ -z "$(ls -A "$dossier" 2>/dev/null)" ]; then
			fail "captures : « $dossier » existe et est vide"
		else
			ok "captures : $dossier ($(ls -1 "$dossier" | wc -l | tr -d ' ') fichier(s))"
		fi
	done
}

controler_unites_citees() {
	local fichier=$1
	titre "3. Chaque unité citée par le manuel existe dans le backlog"
	local unites unite
	unites=$(grep -o 'CRM-[0-9P][0-9]\{2\}' "$fichier" | sort -u)
	for unite in $unites; do
		# Deux formes légitimes dans le backlog : un en-tête `### CRM-0NN — …` pour les unités
		# détaillées, une ligne de tableau `| CRM-0NN | … |` pour le chunk 5, dont les unités
		# n'ont pas encore de fiche propre.
		if grep -q "^### $unite " "$BACKLOG" || grep -q "^| $unite |" "$BACKLOG"; then
			ok "backlog : $unite existe"
		else
			fail "backlog : le manuel cite « $unite », qui n'a aucune unité"
		fi
	done
}

controler_couverture() {
	local fichier=$1
	titre "4. Chaque unité du chunk 3 est citée par le manuel (contrat de couverture, §2)"
	local unite
	for unite in "${UNITES_CHUNK3[@]}"; do
		if grep -q "$unite" "$fichier"; then
			ok "couverture : $unite"
		else
			fail "couverture : $unite a livré du comportement et le manuel n'en parle nulle part"
		fi
	done
}

controler_libelles() {
	local fichier=$1
	titre "5. Chaque libellé du parcours cité est le libellé réel du produit (§3.1)"

	# Le manuel est replié à cent colonnes : un libellé de plusieurs mots y est coupé par un
	# retour à la ligne. Comparer ligne à ligne déclarerait « non cité » un libellé pourtant
	# présent — et le contrôle serait vert sans rien prouver. Le document est donc aplati d'abord.
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

	# Le contraire du même contrôle : un libellé PROCHE mais faux ne doit jamais reparaître. Il
	# n'est pas déduit — il est nommé, parce qu'il a réellement figuré dans le manuel.
	if grep -qF 'Affaire introuvable' "$aplati"; then
		fail "libellé : « Affaire introuvable » est de retour ; l'écran dit « Card introuvable »"
	else
		ok "libellé : « Affaire introuvable » n'est pas revenu (écart n° 1 de docs/SPEC-manual.md §6)"
	fi
	rm -f "$aplati"
}

controler_chiffres_hors_annexe() {
	local fichier=$1
	titre "6. Aucun volume du jeu de démonstration n'est écrit hors de l'annexe A (§4)"
	# Le corps du manuel s'arrête où commence l'annexe : au-delà, les chiffres sont à leur place.
	local corps
	corps=$(mktemp)
	awk '/^## Annexe A /{exit} {print}' "$fichier" > "$corps"

	# Tournures qui ont RÉELLEMENT produit une dérive, et elles seules. Un contrôle qui
	# interdirait tout nombre attraperait « 25 lignes par page », qui est une règle du produit et
	# doit rester dans son chapitre.
	local motifs=(
		'[0-9]\+ affaires\?'
		'[0-9]\+ cards\?'
		'[0-9]\+ réponses\?'
		'[0-9]\+ commentaires\?'
		'[0-9]\+ événements\?'
		'[0-9]\+ channels\?'
		'[0-9]\+ tracks\?'
	)
	# Exclusions, et chacune est une RÈGLE du produit, pas un état de la base : « 25 affaires par
	# page » ne bouge qu'avec `LIGNES_PAR_PAGE`, et sa place est dans son chapitre (§4).
	local regles='affaires par page'

	local motif trouve=0 ligne
	for motif in "${motifs[@]}"; do
		while IFS= read -r ligne; do
			[ -z "$ligne" ] && continue
			if printf '%s' "$ligne" | grep -q "$regles"; then continue; fi
			trouve=1
			fail "chiffre hors annexe : $ligne"
		done < <(grep -n "$motif" "$corps" | cut -c1-160)
	done
	rm -f "$corps"
	# `if`, et non `[ … ] && ok …` : sous `set -e`, un `&&` dont la condition est fausse fait
	# rendre 1 à la FONCTION, et le script s'interrompt à la première anomalie sans jouer les
	# contrôles suivants. Défaut trouvé par la contre-épreuve, jamais par une exécution verte
	# (docs/JOURNAL.md décision 234).
	if [ "$trouve" -eq 0 ]; then ok "aucun volume recopié dans un chapitre"; fi
}

controler_secrets() {
	local fichier=$1
	titre "7. Le manuel ne porte aucun secret (CLAUDE.md §7)"
	local trouve=0 motif
	# Un JWT, une clé de service, un mot de passe recopié : les trois formes qu'un secret prend
	# dans ce dépôt. Le NOM d'une variable reste permis, sa VALEUR jamais.
	for motif in 'eyJ[A-Za-z0-9_-]\{10,\}\.' 'SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' 'ANON_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' 'POSTGRES_PASSWORD[[:space:]]*=[[:space:]]*[^[:space:]]'; do
		if grep -q "$motif" "$fichier"; then
			trouve=1
			fail "secret : le manuel contient une valeur correspondant à « $motif »"
		fi
	done
	if [ "$trouve" -eq 0 ]; then ok "aucune valeur de secret dans le manuel"; fi
}

executer_tous() {
	local fichier=$1
	controler_annexe "$fichier"
	controler_captures "$fichier"
	controler_unites_citees "$fichier"
	controler_couverture "$fichier"
	controler_libelles "$fichier"
	controler_chiffres_hors_annexe "$fichier"
	controler_secrets "$fichier"
}

# ---------------------------------------------------------------------------------------------
# Contre-épreuve : le harnais doit MORDRE.
# ---------------------------------------------------------------------------------------------
# Un harnais qu'on n'a jamais vu échouer ne prouve pas qu'il échoue. Trois dégradations sont
# posées sur une COPIE du manuel — jamais sur le dépôt — et chacune doit produire au moins une
# anomalie de la famille visée.
if [ "$CONTRE_EPREUVE" = true ]; then
	titre "Contre-épreuve — le harnais est-il complaisant ?"
	TEMPORAIRE=$(mktemp -d)
	COPIE="$TEMPORAIRE/manual-degrade.md"

	# CINQ DÉGRADATIONS, UNE PAR FAMILLE DE CONTRÔLE, posées sur une COPIE — jamais sur le dépôt.
	# Chacune reproduit une dérive RÉELLEMENT survenue, ou qui survient de la même façon :
	#   1. un volume de l'annexe faussé          → contrôle 1 (écart n° 6 des treize)
	#   2. un dossier de captures qui n'existe pas → contrôle 2
	#   3. une unité citée qui n'a aucun backlog   → contrôle 3
	#   4. le libellé faux, remis                  → contrôle 5 (écart n° 1 des treize)
	#   5. un volume recopié dans un chapitre      → contrôle 6 (écart n° 7 des treize)
	awk '
		/^\| Affaires \| [0-9]+ \|$/ { print "| Affaires | 999 |"; next }
		/^## Annexe A / {
			print "Voir `docs/captures/CRM-999/` — capture inexistante, unité `CRM-998` inconnue."
			print ""
			print "Cette adresse affiche « Affaire introuvable », et le channel porte 42 affaires."
			print ""
		}
		{ print }
	' "$MANUEL" > "$COPIE"

	failures=0
	checks=0
	executer_tous "$COPIE"
	degradees=$failures
	rm -rf "$TEMPORAIRE"

	printf '\n'
	if [ "$degradees" -ge 5 ]; then
		printf '\033[32mLe harnais MORD : %s anomalie(s) sur le manuel dégradé.\033[0m\n' "$degradees"
		exit 0
	fi
	printf '\033[31mLe harnais est COMPLAISANT : %s anomalie(s) seulement sur un manuel dégradé, 5 attendues.\033[0m\n' \
		"$degradees"
	exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
	echo "ERREUR : conteneur « $DB_CONTAINER » absent. Lancez ./runDev.sh." >&2
	exit 1
fi

titre "Preuves du manuel utilisateur du chunk 3 — CRM-047"
info "Manuel : $MANUEL — spécification : docs/SPEC-manual.md"

executer_tous "$MANUEL"

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
