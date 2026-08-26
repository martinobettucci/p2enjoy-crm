#!/usr/bin/env bash
# @verifies CRM-064 (docs/BACKLOG.md) — @mentions et notifications, SOUS-TRANCHE 3a : la réception
# @verifies docs/SPEC-notifications.md §24 (le modèle de lecture, et ce qu'il ne demande pas),
#           §25 (la publication et les deux règles d'abonnement), §26 (ce que l'écran rend),
#           §27 (le contrat d'API), §31 (les preuves attendues)
# @verifies docs/DESIGN_SYSTEM.md §5.43 (la cloche et le panneau) ; docs/manual.md §8
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §16 (vérification visuelle)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée, et Node 24 sourcé (`nvm use`).
#
# CE QUE CE HARNAIS ÉPROUVE, ET QUE `verify-notifications.sh` N'ÉPROUVE PAS. Celui-là dégrade la
# BASE et regarde la suite pgTAP rougir. Celui-ci dégrade la **surface** — le module de lecture, la
# composition de la ligne, le compteur, le canal — et regarde les preuves de la surface rougir. Les
# deux niveaux voient des choses différentes : une règle prouvée en base n'est pas une règle rendue
# par l'écran, et l'inverse est vrai aussi.
#
# LA DÉGRADATION LA PLUS UTILE DE CE HARNAIS EST LA PREMIÈRE : elle fait rendre au compteur le
# nombre de lignes de la PAGE au lieu de celui du serveur. Le module, ses types, ses deux requêtes
# et son canal survivent tous ; seule la source du nombre change. Une suite qui resterait verte
# prouverait qu'elle ne mesure que la forme du module, jamais ce que le compteur dit.
#
# LA SECONDE EST SANS ÉQUIVALENT DANS LE DÉPÔT : elle fait **nommer** au panneau ce qu'il ne doit
# pas nommer — « ce propos a été supprimé » — sur une ligne dont le commentaire n'est plus lisible.
# Le rendu reste complet, la ligne garde sa place et son lien ; ce qui tombe est la **discrétion**
# du §24.3, c'est-à-dire la seule raison pour laquelle conserver une notification dont la mention a
# été retirée reste sûr.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MODULE=webapp/src/lib/notifications.ts
COLONNES=webapp/src/lib/colonnes-notifications.ts
SURFACE=webapp/src/app/Notifications.tsx
SUITE_UNITAIRE=src/lib/notifications.test.ts
SUITE_RENDU=src/app/Notifications.test.tsx
SUITE_API=e2e/api/notifications-surface.spec.ts
SUITE_UI=e2e/ui/notifications.spec.ts
SPEC=docs/SPEC-notifications.md
MANUEL=docs/manual.md

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

# Le fichier dégradé du moment, restauré par le `trap` même en cas d'échec.
FICHIER_DEGRADE=""
SAUVEGARDE=""

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ] && [ -n "$SAUVEGARDE" ] && [ -f "$SAUVEGARDE" ]; then
		cp "$SAUVEGARDE" "$FICHIER_DEGRADE"
		printf 'restauration de secours : %s rendu à son état d’origine.\n' "$FICHIER_DEGRADE" >&2
	fi
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

mesurer() {
	local libelle=$1 requete=$2 attendu=$3 obtenu
	obtenu=$(psql_db -c "$requete" 2>/dev/null | tr -d '[:space:]')
	if [ "$obtenu" = "$attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — attendu « $attendu », mesuré « $obtenu »"
	fi
}

contient() {
	local libelle=$1 fichier=$2 motif=$3
	if grep -qF -- "$motif" "$fichier"; then
		ok "$libelle"
	else
		fail "$libelle — motif absent de $fichier"
	fi
}

absent() {
	local libelle=$1 fichier=$2 motif=$3
	if grep -qF -- "$motif" "$fichier"; then
		fail "$libelle — motif PRÉSENT dans $fichier, alors qu'il ne doit pas l'être"
	else
		ok "$libelle"
	fi
}

suites_unitaires_vertes() {
	npx vitest run --config webapp/vitest.config.ts "webapp/$SUITE_UNITAIRE" "webapp/$SUITE_RENDU" \
		>"$TRAVAIL/vitest.log" 2>&1
}

# Remplace un motif dans un fichier de la surface, après en avoir gardé une copie. Le motif est
# comparé AVANT et APRÈS, et le remplacement est VÉRIFIÉ — la leçon de la décision 503, poussée
# d'un cran par la tranche 1 : une dégradation qui n'a rien changé laisse le produit intact, la
# suite reste verte, et le harnais accuse à tort sa propre preuve d'être complaisante.
degrader() {
	local fichier=$1 avant=$2 apres=$3 nom=$4
	SAUVEGARDE="$TRAVAIL/$(basename "$fichier").orig"
	FICHIER_DEGRADE="$fichier"
	cp "$fichier" "$SAUVEGARDE"
	python3 - "$fichier" "$avant" "$apres" <<-'PY'
		import io, sys
		cible, avant, apres = sys.argv[1:4]
		texte = io.open(cible, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if cmp -s "$fichier" "$SAUVEGARDE"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	restauration_due=true
	return 0
}

restaurer() {
	if [ -n "$SAUVEGARDE" ] && [ -f "$SAUVEGARDE" ]; then
		cp "$SAUVEGARDE" "$FICHIER_DEGRADE"
	fi
	restauration_due=false
}

eprouver_degradation() {
	local nom=$1 fichier=$2 avant=$3 apres=$4
	degrader "$fichier" "$avant" "$apres" "$nom" || return 0
	if suites_unitaires_vertes; then
		fail "COMPLAISANT — « $nom » retirée, les suites de la surface restent VERTES"
	else
		ok "dégradation « $nom » : les suites de la surface rougissent, comme elles doivent"
	fi
	restaurer
}

echo
echo "Preuves de CRM-064 sous-tranche 3a — la surface de réception"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
	echo "ERREUR : npx introuvable. Exécutez « nvm use » puis relancez." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité — CLAUDE.md §5"
# =================================================================================================

for fichier in "$MODULE" "$COLONNES" "$SURFACE"; do
	contient "$fichier cite son unité de backlog" "$fichier" '@spec CRM-064'
done
contient "$SUITE_UNITAIRE cite ce qu'elle vérifie" "webapp/$SUITE_UNITAIRE" '@verifies CRM-064'
contient "$SUITE_RENDU cite ce qu'elle vérifie" "webapp/$SUITE_RENDU" '@verifies CRM-064'
contient "$SUITE_API cite ce qu'elle vérifie" "$SUITE_API" '@verifies CRM-064'
contient "$SUITE_UI cite ce qu'elle vérifie" "$SUITE_UI" '@verifies CRM-064'
contient "la spécification porte les chapitres de la sous-tranche" "$SPEC" 'TRANCHE 3 — LA SURFACE'
contient "le manuel porte son chapitre, le PREMIER de l'unité" "$MANUEL" \
	'## 8. Vos notifications'

# =================================================================================================
echo "2. Ce que la surface demande, et ce qu'elle ne demande pas — §24"
# =================================================================================================

contient "l'affaire est embarquée par la clé étrangère composite (§24.1, M5)" "$COLONNES" \
	'cards(id, title, channels!cards_channel_id_workspace_id_fkey'
contient "les DEUX slugs sont demandés : l'adresse d'une affaire les exige (§24.1)" "$COLONNES" \
	'tracks(slug, name)'
absent "\`recipient_id\` n'est PAS demandé : la politique le garantit (§24.2)" "$COLONNES" \
	'recipient_id, '
contient "l'auteur du commentaire cité est embarqué (§24.1, M8)" "$COLONNES" \
	'profiles!card_comments_author_id_fkey'
contient "\`deleted_at\` est demandée : une pierre tombale a le corps vide (§13.4)" "$COLONNES" \
	'deleted_at'
contient "le canal porte l'identifiant du DESTINATAIRE, jamais un nom fixe (§25.3)" "$COLONNES" \
	'notifications:${idProfil}'
contient "le filtre porte sur le destinataire (§25.3)" "$COLONNES" \
	'recipient_id=eq.${idProfil}'

# =================================================================================================
echo "3. Les règles que le rendu tient — §26, docs/DESIGN_SYSTEM.md §5.43"
# =================================================================================================

contient "l'ordre est le plus récent en haut (§26.2)" "$MODULE" "ascending: false"
contient "le compteur se lit SANS CORPS (§26.1, M4)" "$MODULE" "head: true"
contient "le marquage demande sa ligne en retour, pour distinguer « sans effet » (§26.4)" "$MODULE" \
	".select('id')"
contient "le panneau s'ancre à l'EN-TÊTE, jamais à la cloche (§5.43)" "$SURFACE" \
	'left-4 right-4 md:left-auto'
contient "la teinte du compteur est celle de la MARQUE, jamais du danger (§5.43)" "$SURFACE" \
	'bg-brand text-white'
absent "aucune teinte de danger sur le compteur (§5.43)" "$SURFACE" 'bg-danger text-white'
contient "le liseré distingue une ligne non lue (§26.2, §5.43)" "$SURFACE" 'border-l-brand'
contient "les deux visages du marquage, un seul rendu à la fois (§5.43)" "$SURFACE" \
	'notifications.item.markUnread'
absent "AUCUN « tout marquer comme lu » n'est livré (§23.3, §29)" "$SURFACE" 'markAllRead'
absent "l'écran ne NOMME jamais la cause d'un propos illisible (§24.3)" "$SURFACE" \
	'propos retiré'

# =================================================================================================
echo "4. Ce que la base rend à la surface — §25.1, §27"
# =================================================================================================

mesurer "la table EST publiée au temps réel (§25.1)" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'notifications';" 1

mesurer "la politique de lecture délègue à \`app.can_read_card\` — c'est elle que le flux évalue" \
	"select count(*) from pg_policies where schemaname = 'public'
	  and tablename = 'notifications' and policyname = 'notifications_lecture'
	  and qual like '%can_read_card%';" 1

mesurer "le seed livre DEUX notifications, toutes deux non lues (§28)" \
	"select count(*) from public.notifications where read_at is null;" 2

mesurer "la LECTRICE n'en porte AUCUNE : l'état vide s'exerce sur un profil réel (§28)" \
	"select count(*) from public.notifications
	  where recipient_id = '5eed0000-0000-4000-8000-000000000013';" 0

# =================================================================================================
echo "5. Les preuves de la surface, rejouées"
# =================================================================================================

if suites_unitaires_vertes; then
	ok "les suites unitaires du module et du rendu sont VERTES"
else
	fail "les suites unitaires du module et du rendu sont ROUGES — $(tail -n 3 "$TRAVAIL/vitest.log" | tr '\n' ' ')"
fi

# =================================================================================================
echo "6. Dégradations : chaque règle retirée doit faire ROUGIR la preuve"
# =================================================================================================

# D-A — le compteur compte les lignes de la PAGE au lieu de celles du serveur. Le module, ses
# types, ses deux requêtes et son canal survivent tous ; seule la SOURCE du nombre change. C'est la
# dégradation la plus utile de ce harnais : une suite qui resterait verte prouverait qu'elle ne
# mesure que la forme du module (§26.5).
eprouver_degradation "le compteur qui compte TOUTES les non-lues, jamais la page (§26.5)" \
	"$MODULE" \
	'nonLues: await compterNonLues(client),' \
	'nonLues: lignes.filter((une) => une.read_at === null).length,'

# D-B — le panneau NOMME la cause d'un propos illisible. Le rendu reste complet, la ligne garde sa
# place et son lien ; ce qui tombe est la DISCRÉTION du §24.3 — la seule raison pour laquelle
# conserver une notification dont la mention a été retirée reste sûr.
eprouver_degradation "la discrétion sur un propos illisible (§24.3)" \
	"$MODULE" \
	"extrait: corps.length > 0 ? corps : null," \
	"extrait: corps.length > 0 ? corps : 'Ce propos a été supprimé.',"

# D-C — le marquage cesse de distinguer « sans effet » d'un succès. La requête part, le serveur
# répond, et l'écran annonce une modification qui n'a pas eu lieu (§26.4).
eprouver_degradation "la distinction « sans effet » / « appliqué » (§26.4)" \
	"$MODULE" \
	"return (reponse.data ?? []).length === 0 ? { statut: 'sans-effet' } : { statut: 'applique' }" \
	"return { statut: 'applique' }"

# D-D — le compteur retombe à ZÉRO quand la mesure échoue, au lieu de rester inconnu. Il affirme
# alors que tout est lu alors que rien n'a été mesuré — la valeur par défaut trompeuse que
# `CLAUDE.md` §18 interdit (§26.1).
eprouver_degradation "le compteur INCONNU plutôt qu'un zéro non mesuré (§26.1)" \
	"$MODULE" \
	"		if (reponse.error !== null) return null
		return reponse.count ?? null" \
	"		if (reponse.error !== null) return 0
		return reponse.count ?? 0"

# D-E — la borne d'affichage du compteur disparaît : la pastille rend un nombre à quatre chiffres
# qui déforme la cloche (§26.1).
eprouver_degradation "la borne d'affichage « 99+ » du compteur (§26.1)" \
	"$COLONNES" \
	'return compte > BORNE_COMPTEUR ? `${BORNE_COMPTEUR}+` : String(compte)' \
	'return String(compte)'

# D-F — le canal reprend un nom FIXE. Deux sessions du même navigateur s'abonnent alors au même
# canal, `supabase-js` les réutilisant par leur nom (§25.3).
eprouver_degradation "le canal nommé par son DESTINATAIRE (§25.3)" \
	"$COLONNES" \
	'`notifications:${idProfil}`' \
	"'notifications'"

# D-G — la lecture cesse d'être bornée. Une boîte qui croît indéfiniment finirait par lire des
# milliers de lignes pour en montrer dix (§26.5).
eprouver_degradation "la borne de lecture du panneau (§26.5)" \
	"$MODULE" \
	'.limit(BORNE_LISTE)' \
	'.limit(1000)'

# =================================================================================================
echo "7. La restauration est CONSTATÉE, jamais supposée"
# =================================================================================================

for fichier in "$MODULE" "$COLONNES" "$SURFACE"; do
	if git diff --quiet -- "$fichier"; then
		ok "après restauration : $fichier est rendu tel qu'il était"
	else
		fail "après restauration : $fichier PORTE ENCORE une dégradation"
	fi
done

if suites_unitaires_vertes; then
	ok "après restauration : les suites de la surface sont VERTES — le produit est rendu"
else
	fail "après restauration : les suites de la surface restent ROUGES, le produit n'a PAS été rendu"
fi

mesurer "après restauration : le seed est intact, DEUX notifications non lues" \
	"select count(*) from public.notifications where read_at is null;" 2

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
