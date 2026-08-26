#!/usr/bin/env bash
# @verifies CRM-064 (docs/BACKLOG.md) — @mentions et notifications, SOUS-TRANCHE 3B : l'émission
# @verifies docs/SPEC-notifications.md §34 (d'où vient la liste du sélecteur), §35 (les deux
#           écritures ne sont pas atomiques), §36 (ce que l'écran rend), §37 (le contrat d'API),
#           §40 (les preuves attendues)
# @verifies docs/DESIGN_SYSTEM.md §5.44 (le sélecteur de mentions) ; docs/SCHEMA.md §9 bis.9 bis
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §16 (vérification visuelle)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée, et Node 24 sourcé (`nvm use`).
#
# CE QUE CE HARNAIS ÉPROUVE, ET QUE LES DEUX AUTRES N'ÉPROUVENT PAS. `verify-mentions.sh` dégrade la
# règle d'ÉLIGIBILITÉ ; `verify-notifications-surface.sh` dégrade la surface de RÉCEPTION. Celui-ci
# dégrade la liaison entre les deux : la fonction qui donne la liste, et la séquence qui pose les
# mentions. C'est le seul endroit du dépôt où un défaut ferait qu'un auteur mentionne quelqu'un que
# le backend refuse — ou pire, qu'il ne mentionne personne sans que rien ne le dise.
#
# LA DÉGRADATION LA PLUS UTILE DE CE HARNAIS EST LA PREMIÈRE, ET ELLE EST SANS ÉQUIVALENT ICI : elle
# rend la fonction `SECURITY DEFINER` en laissant son corps, ses colonnes, ses privilèges et son
# appelant intacts. La liste continue de sortir, ordonnée, avec les bons noms — mais elle sort pour
# `postgres`, qui traverse toute la RLS. Une suite qui resterait verte prouverait qu'elle ne mesure
# que la forme de la fonction, jamais QUI la calcule.
#
# LA SECONDE FAIT GROUPER LES MENTIONS EN UN SEUL `POST`. Le module compile, l'écran rend, les
# mentions arrivent en base quand tout va bien — et le jour où une seule est refusée, TOUTES sont
# perdues sans que le refus dise laquelle. C'est exactement la mesure M5, et c'est le défaut que la
# forme séquentielle du §35.2 existe pour empêcher.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0066_mentionnables.sql
MODULE=webapp/src/lib/mentions.ts
SURFACE=webapp/src/app/PanneauTimeline.tsx
COMMENTAIRES=webapp/src/lib/commentaires.ts
SUITE_SQL=supabase/tests/0063_mentionnables.test.sql
SUITE_UNITAIRE=webapp/src/lib/mentions.test.ts
SUITE_RENDU=webapp/src/app/PanneauTimeline.test.tsx
SUITE_API=e2e/api/mentions-composeur.spec.ts
SUITE_UI=e2e/ui/mentions-composeur.spec.ts
SPEC=docs/SPEC-notifications.md
DESIGN=docs/DESIGN_SYSTEM.md
MANUEL=docs/manual.md

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false
migration_degradee=false

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
	# LA BASE AUSSI EST RENDUE, ET C'EST PLUS IMPORTANT QUE LE FICHIER : une fonction laissée
	# `SECURITY DEFINER` par un harnais interrompu serait une FUITE persistante, invisible à
	# `git diff`. La migration est rejouée sans condition.
	if [ "$migration_degradee" = true ]; then
		docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
			<"$MIGRATION" >/dev/null 2>&1
		printf 'restauration de secours : la migration 0066 a été rejouée.\n' >&2
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

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/pgtap.log" 2>&1
}

suites_unitaires_vertes() {
	npx vitest run --config webapp/vitest.config.ts "$SUITE_UNITAIRE" "$SUITE_RENDU" \
		>"$TRAVAIL/vitest.log" 2>&1
}

# Remplace un motif dans un fichier, après en avoir gardé une copie. Le remplacement est VÉRIFIÉ —
# la leçon de la décision 503, poussée d'un cran par la tranche 1 : une dégradation qui n'a rien
# changé laisse le produit intact, la suite reste verte, et le harnais accuse à tort sa propre
# preuve d'être complaisante.
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

# Dégrade la SURFACE et regarde les suites unitaires rougir.
eprouver_surface() {
	local nom=$1 fichier=$2 avant=$3 apres=$4
	degrader "$fichier" "$avant" "$apres" "$nom" || return 0
	if suites_unitaires_vertes; then
		fail "COMPLAISANT — « $nom » retirée, les suites de l'émission restent VERTES"
	else
		ok "dégradation « $nom » : les suites de l'émission rougissent, comme elles doivent"
	fi
	restaurer
}

# Dégrade la BASE — la migration est modifiée, appliquée, la suite pgTAP rejouée, puis la migration
# d'origine est réappliquée. `psql` doit avoir ACCEPTÉ la copie dégradée : sans cette vérification,
# une dégradation refusée laisserait le produit intact et le harnais accuserait sa propre suite.
eprouver_base() {
	local nom=$1 avant=$2 apres=$3
	local copie="$TRAVAIL/degradee.sql"
	python3 - "$MIGRATION" "$copie" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if ! docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		<"$copie" >"$TRAVAIL/degradation.log" 2>&1; then
		fail "dégradation « $nom » REFUSÉE par psql : le produit est intact, rien n'a été éprouvé"
		return 0
	fi
	migration_degradee=true
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		<"$MIGRATION" >/dev/null 2>&1
	migration_degradee=false
}

echo
echo "Preuves de CRM-064 sous-tranche 3b — l'émission d'une mention"
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

for fichier in "$MIGRATION" "$MODULE" "$SURFACE" "$COMMENTAIRES"; do
	contient "$fichier cite son unité de backlog" "$fichier" 'CRM-064'
done
contient "$SUITE_SQL cite ce qu'elle vérifie" "$SUITE_SQL" '@verifies CRM-064'
contient "$SUITE_UNITAIRE cite ce qu'elle vérifie" "$SUITE_UNITAIRE" '@verifies CRM-064'
contient "$SUITE_API cite ce qu'elle vérifie" "$SUITE_API" '@verifies CRM-064'
contient "$SUITE_UI cite ce qu'elle vérifie" "$SUITE_UI" '@verifies CRM-064'
contient "la spécification porte les chapitres de la sous-tranche" "$SPEC" \
	"SOUS-TRANCHE 3B — L'ÉMISSION"
contient "le design system porte la surface" "$DESIGN" \
	'### 5.44 Sélecteur de mentions du composeur'
contient "le manuel décrit le geste" "$MANUEL" 'Mentionner quelqu’un'

# =================================================================================================
echo "2. La règle n'a qu'une seule écriture — §34.1"
# =================================================================================================

contient "la fonction DÉLÈGUE à la chaîne généralisée par la tranche 1" "$MIGRATION" \
	'app.can_read_card_pour(c.id, p.id)'
# LES MOTIFS VISENT LE CODE, JAMAIS LA PROSE, et c'est une correction MESURÉE : écrits sur les
# seuls noms de tables, ces deux contrôles rougissaient sur les COMMENTAIRES qui expliquent
# précisément que le module ne les lit pas. Un contrôle qui prend en défaut la prose expliquant la
# règle ne mesure pas la règle — la même leçon que l'assertion 6 de la suite pgTAP.
absent "le MODULE client n'interroge AUCUNE table d'appartenance (CLAUDE.md §10)" "$MODULE" \
	"from('workspace_members')"
absent "le MODULE client n'interroge pas non plus les droits fins" "$MODULE" \
	"from('channel_members')"
absent "la SURFACE n'interroge AUCUNE table d'appartenance" "$SURFACE" \
	"from('workspace_members')"
contient "la SURFACE passe par le module, jamais par une requête à elle" "$SURFACE" \
	'lireMentionnables,'
contient "la lecture passe par la RPC, jamais par une table" "$MODULE" \
	"client.rpc('mentionnables', { card_id: idCard })"

# =================================================================================================
echo "3. La forme de la fonction, mesurée en base — §34.2 et §34.4"
# =================================================================================================

mesurer "la fonction existe" \
	"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables';" 1
mesurer "elle est SECURITY INVOKER, jamais DEFINER" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables';" f
mesurer "elle est STABLE : PostgREST n'expose en lecture que le non-volatile" \
	"select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables';" s
mesurer "anon N'A PAS execute — révoqué NOMMÉMENT (leçon de la migration 53)" \
	"select has_function_privilege('anon', 'public.mentionnables(uuid)', 'EXECUTE');" f
mesurer "authenticated A execute : c'est le rôle sous lequel l'écran appelle" \
	"select has_function_privilege('authenticated', 'public.mentionnables(uuid)', 'EXECUTE');" t

# =================================================================================================
echo "4. Ce que la fonction rend, sur le croisement du seed — §32 M1, §37"
# =================================================================================================

# LE CROISEMENT EST CELUI DU SEED, ET IL EXISTE DÉJÀ : la lectrice est éligible sur « Maintenance »
# et ne l'est pas sur « Grands comptes ». Un sélecteur qui rendrait partout la même liste passerait
# la première mesure et échouerait la seconde.
mesurer "sur « Grands comptes », la lectrice N'EST PAS éligible (M1)" \
	"select app.can_read_card_pour('5eed0000-0000-4000-8000-0000000000c1',
	                               '5eed0000-0000-4000-8000-000000000013');" f
mesurer "sur « Maintenance », la MÊME lectrice EST éligible (M1)" \
	"select app.can_read_card_pour('5eed0000-0000-4000-8000-0000000000c5',
	                               '5eed0000-0000-4000-8000-000000000013');" t
mesurer "sous l'administratrice, « Grands comptes » n'offre QU'UNE personne" \
	"set local role authenticated;
	 set local request.jwt.claims to '{\"sub\":\"5eed0000-0000-4000-8000-000000000011\"}';
	 select count(*) from public.mentionnables('5eed0000-0000-4000-8000-0000000000c1');" 1
mesurer "sous l'administratrice, « Maintenance » en offre DEUX" \
	"set local role authenticated;
	 set local request.jwt.claims to '{\"sub\":\"5eed0000-0000-4000-8000-000000000011\"}';
	 select count(*) from public.mentionnables('5eed0000-0000-4000-8000-0000000000c5');" 2
mesurer "l'appelante n'est JAMAIS dans sa propre liste (§34.3)" \
	"set local role authenticated;
	 set local request.jwt.claims to '{\"sub\":\"5eed0000-0000-4000-8000-000000000011\"}';
	 select count(*) from public.mentionnables('5eed0000-0000-4000-8000-0000000000c5')
	  where profile_id = '5eed0000-0000-4000-8000-000000000011';" 0
mesurer "sous la lectrice, une affaire fermée rend ZÉRO LIGNE et aucune erreur (M8)" \
	"set local role authenticated;
	 set local request.jwt.claims to '{\"sub\":\"5eed0000-0000-4000-8000-000000000013\"}';
	 select count(*) from public.mentionnables('5eed0000-0000-4000-8000-0000000000c1');" 0

# =================================================================================================
echo "5. La forme de l'émission — §35"
# =================================================================================================

contient "les mentions sont posées UNE PAR UNE, dans une boucle (§35.2)" "$MODULE" \
	'for (const personne of personnes) {'
absent "aucune insertion groupée : un POST groupé est TOUT OU RIEN (M5)" "$MODULE" \
	'.insert(personnes'
contient "le commentaire rend son identifiant : rien ne se pose sans lui (§35)" "$COMMENTAIRES" \
	"idCommentaire: (reponse.data ?? [])[0]?.id ?? null"
contient "un succès PARTIEL est une issue distincte du succès et du refus (§35.4)" "$MODULE" \
	"statut: 'partiel'"
contient "les trois symboles du trigger sont distingués (§35.4)" "$MODULE" \
	'SYMBOLE_DESTINATAIRE_SANS_ACCES'
absent "le composeur ne SUPPRIME jamais le commentaire publié (§35.3)" "$SURFACE" \
	'supprimerCommentaire(client, resultat.idCommentaire'

# =================================================================================================
echo "6. Dégradations de la BASE : chaque règle retirée doit faire ROUGIR la preuve"
# =================================================================================================

# D-A — LA FONCTION DEVIENT `SECURITY DEFINER`. Son corps, ses colonnes, son ordre, ses privilèges
# et son appelant survivent tous ; la liste continue de sortir avec les bons noms. Ce qui change est
# QUI la calcule : `postgres` traverse toute la RLS, et une affaire fermée rendrait alors la liste
# de ses lecteurs. C'est la dégradation la plus utile de ce harnais, et elle est sans équivalent
# dans le dépôt.
eprouver_base "la fonction SECURITY INVOKER (§34.2)" \
	'security invoker' \
	'security definer'

# D-B — `anon` RETROUVE `execute`. C'est le défaut que la migration 53 a payé : `pg_default_acl`
# accorde `execute` à `anon` sur toute fonction neuve de `public`, et `revoke … from public` ne lui
# retire rien, `public` étant le pseudo-rôle.
#
# LA DÉGRADATION ACCORDE EXPLICITEMENT AU LIEU DE RETIRER LA LIGNE `revoke`, ET C'EST UNE CORRECTION
# MESURÉE — le fait est utile bien au-delà de ce harnais. Écrite d'abord comme la suppression du
# mot `anon`, elle ne dégradait RIEN : `create or replace function` **conserve l'ACL existante**,
# si bien que la fonction déjà créée gardait sa révocation et que la suite pgTAP restait verte à
# juste titre. Le harnais s'accusait alors lui-même de complaisance. L'état à reproduire est celui
# qu'une base NEUVE recevrait — `anon=X` —, et il est donc posé explicitement.
#
# CE QUE CE FAIT DIT DU CONTRAT DE DÉPLOIEMENT : sur une base où la fonction existe déjà, corriger
# une ACL fautive demande un `revoke` explicite, jamais un simple rejeu de la migration corrigée.
eprouver_base "la révocation NOMMÉE d'anon (§34.4)" \
	'revoke all on function public.mentionnables(uuid) from public, anon;' \
	'grant execute on function public.mentionnables(uuid) to anon;'

# D-C — L'APPELANT REVIENT DANS SA PROPRE LISTE. La fonction rend une personne de plus, dont la
# mention serait acceptée et ne produirait AUCUNE notification (§14.3) : le geste le plus silencieux
# qui soit.
eprouver_base "l'appelant retiré de sa propre liste (§34.3)" \
	"and p.id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)" \
	'and true'

# D-D — LA RÈGLE D'ÉLIGIBILITÉ DISPARAÎT, et la fonction rend TOUS les membres du workspace. C'est
# précisément la liste que le §34.1 refuse : celle qui contient un nom que le backend refusera.
eprouver_base "la règle d'éligibilité elle-même (§5.1)" \
	'and app.can_read_card_pour(c.id, p.id)' \
	'and true'

# =================================================================================================
echo "7. Dégradations de la SURFACE : chaque règle retirée doit faire ROUGIR la preuve"
# =================================================================================================

# D-E — LES MENTIONS SONT GROUPÉES EN UN SEUL `POST`. Le module compile, l'écran rend, et les
# mentions arrivent en base quand tout va bien. Le jour où une seule est refusée, TOUTES sont
# perdues et le refus ne dit pas laquelle — la mesure M5, c'est-à-dire le défaut exact que la forme
# séquentielle existe pour empêcher.
eprouver_surface "l'émission UNE PAR UNE (§35.2)" \
	"$MODULE" \
	'	const issues: IssueMention[] = []
	for (const personne of personnes) {
		issues.push(await poserUneMention(client, idCommentaire, idWorkspace, personne))
	}
	return issues' \
	'	const groupe = personnes.map((personne) => ({
		comment_id: idCommentaire,
		profile_id: personne.id,
		workspace_id: idWorkspace,
	}))
	const reponse = await client.from("card_comment_mentions").insert(groupe)
	return personnes.map((personne) =>
		reponse.error === null
			? ({ personne, statut: "posee" } as IssueMention)
			: ({ personne, statut: "refus", nature: "unknown", detail: "" } as IssueMention),
	)'

# D-F — LE REFUS PARTIEL EST RANGÉ AVEC LE SUCCÈS. Le commentaire est publié, les mentions ont
# échoué, et l'écran n'en dit RIEN : la troisième issue du §35.4 disparaît, et l'auteur croit avoir
# prévenu quelqu'un qui n'a rien reçu.
eprouver_surface "la troisième issue, distincte du succès (§35.4)" \
	"$MODULE" \
	"	return refusees.length === 0 ? { statut: 'complet' } : { statut: 'partiel', refusees }" \
	"	return { statut: 'complet' }"

# D-G — LES TROIS SYMBOLES DU TRIGGER SONT CONFONDUS. Un `P0001` quelconque devient
# « cette personne ne peut pas lire cette affaire », y compris quand le commentaire a été supprimé :
# la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
eprouver_surface "la distinction des trois refus du trigger (§35.4)" \
	"$MODULE" \
	"		if (detail === SYMBOLE_COMMENTAIRE_SUPPRIME) return { nature: 'commentaire-supprime', detail }" \
	"		if (false) return { nature: 'commentaire-supprime', detail }"

# D-H — LE COMMENTAIRE PERD SON IDENTIFIANT. `select('id')` disparaît, la publication réussit, et
# AUCUNE mention n'est jamais posée — en silence, puisque rien n'a échoué.
eprouver_surface "l'identifiant du commentaire publié (§35)" \
	"$COMMENTAIRES" \
	"		return { statut: 'publie', idCommentaire: (reponse.data ?? [])[0]?.id ?? null }" \
	"		return { statut: 'publie', idCommentaire: null }"

# =================================================================================================
echo "8. La restauration est CONSTATÉE, jamais supposée"
# =================================================================================================

for fichier in "$MIGRATION" "$MODULE" "$SURFACE" "$COMMENTAIRES"; do
	if git diff --quiet -- "$fichier"; then
		ok "après restauration : $fichier est rendu tel qu'il était"
	else
		fail "après restauration : $fichier PORTE ENCORE une dégradation"
	fi
done

# LA BASE AUSSI EST RELUE, et c'est ce qui distingue ce harnais d'un harnais de fichiers : une
# dégradation appliquée en base ne laisse AUCUNE trace dans `git diff`.
mesurer "après restauration : la fonction est de nouveau SECURITY INVOKER" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables';" f
mesurer "après restauration : anon n'a de nouveau AUCUN privilège d'exécution" \
	"select has_function_privilege('anon', 'public.mentionnables(uuid)', 'EXECUTE');" f

if suite_sql_verte; then
	ok "après restauration : la suite pgTAP est VERTE — la base est rendue"
else
	fail "après restauration : la suite pgTAP reste ROUGE, la base n'a PAS été rendue"
fi

if suites_unitaires_vertes; then
	ok "après restauration : les suites de l'émission sont VERTES — le produit est rendu"
else
	fail "après restauration : les suites de l'émission restent ROUGES, le produit n'a PAS été rendu"
fi

# =================================================================================================
echo "9. Le seed est intact — §38"
# =================================================================================================

mesurer "cinq commentaires" "select count(*) from public.card_comments;" 5
mesurer "deux mentions" "select count(*) from public.card_comment_mentions;" 2
mesurer "deux notifications, toutes deux non lues" \
	"select count(*) from public.notifications where read_at is null;" 2

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
