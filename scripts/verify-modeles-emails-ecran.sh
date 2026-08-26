#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, TRANCHE 2, sous-tranche 2b : L'ÉCRAN
# @verifies docs/SPEC-modeles-emails.md §9.1 (où l'écran vit), §9.3 (le guichet des variables et la
#           mesure qui l'impose), §9.4 (la liste), §9.5 (les sélecteurs sans présélection), §9.6
#           (ce que `variables_nulles` rend), §9.7 (la confirmation de suppression), §9.8 (le
#           dictionnaire fermé des refus), §9.9 (contrat d'API), §9.10 (les preuves exigées)
# @verifies docs/DESIGN_SYSTEM.md §5.39 (cette surface) ; docs/PROD_MIGRATIONS.md §3 (migration 57)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la sous-tranche, puis DÉGRADE RÉELLEMENT — la migration du
# guichet, et le module de données de l'écran — et exige que la preuve concernée rougisse. Aucun
# état dégradé ne subsiste, même en cas d'échec : les deux fichiers sont restaurés par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la preuve la dénonce ; une dégradation qui laisserait la preuve verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# LA DÉGRADATION LA PLUS IMPORTANTE DE CE HARNAIS EST D-C, ET ELLE MÉRITE D'ÊTRE LUE. Elle fait
# CESSER LE GUICHET DE DÉLÉGUER : la fonction publique rend alors une liste FIGÉE de douze noms, au
# lieu d'appeler `app.mail_template_variables()`. C'est exactement le défaut que le §9.3 écarte
# lorsqu'il refuse de recopier la liste en TypeScript, et si la suite pgTAP restait verte, la
# décision de la sous-tranche ne serait éprouvée nulle part.
#
# LES DEUX DERNIÈRES DÉGRADATIONS PORTENT SUR LE MODULE DE L'ÉCRAN, et non sur la base. C'est un
# écart avec les deux harnais jumeaux, et il a une cause : cette sous-tranche livre pour la première
# fois de `CRM-063` de la LOGIQUE TypeScript — le classement des refus, et la relecture qui
# distingue un succès d'un zéro-ligne. Une dégradation qui ne toucherait que le SQL laisserait cette
# logique-là sans preuve de sa capacité à rougir.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu (`docs/SPEC-test-harness.md`
# §7.2 point 3) : aucun ENVOI — `mail_outbox` ignore toujours les modèles ; aucune SIGNATURE et
# aucune SÉQUENCE, tranches 3 et 4 ; aucun FUSEAU HORAIRE — la prévisualisation rend l'UTC que la
# base rend (INC-216), et l'écran ne corrige pas un écart consigné.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0057_guichet_variables_modeles.sql
MODULE=webapp/src/lib/modeles-emails.ts
ECRAN=webapp/src/app/ReglagesModelesEmails.tsx
SUITE_SQL=supabase/tests/0055_guichet_variables_modeles.test.sql
SUITE_UNITAIRE=webapp/src/lib/modeles-emails.test.ts
SUITE_API=e2e/api/guichet-variables-modeles.spec.ts
SUITE_UI=e2e/ui/reglages-modeles-emails.spec.ts
SPEC=docs/SPEC-modeles-emails.md
DESIGN=docs/DESIGN_SYSTEM.md

WORKSPACE=5eed0000-0000-4000-8000-000000000001
MODELES_DU_SEED=2
VARIABLES_ATTENDUES=12
CHEMIN_ECRAN='/reglages/modeles-emails'

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_sql_due=false
restauration_module_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_sql_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
	fi
	# LE MODULE EST RESTAURÉ DEPUIS L'INSTANTANÉ, jamais depuis `git checkout` : le harnais doit
	# fonctionner dans un arbre portant une évolution légitime non encore committée.
	if [ "$restauration_module_due" = true ] && [ -f "$TRAVAIL/module.origine" ]; then
		cp "$TRAVAIL/module.origine" "$MODULE"
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

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

suite_unitaire_verte() {
	npx vitest run "$SUITE_UNITAIRE" >"$TRAVAIL/unit.log" 2>&1
}

# LE CODE SANS SES COMMENTAIRES — ET C'EST UN DÉFAUT DU HARNAIS TROUVÉ PAR LE HARNAIS, le
# 2026-08-25, troisième de sa famille après le §2.11 et le §8.9 bis.
#
# Les contrôles de la section 4 cherchent ce que l'écran s'INTERDIT : `required`, `maxLength`, un
# droit calculé. Écrits sur le fichier BRUT, ils trouvaient ces mots dans le COMMENTAIRE qui
# explique pourquoi ils sont absents — « AUCUNE GARDE DE SAISIE : ni `required`, ni `maxLength` » —
# et le harnais rendait « ECHEC » sur un écran conforme.
#
# Les deux défauts précédents étaient des FAUX VERTS ; celui-ci est un FAUX ROUGE, et il est tout
# aussi grave : un harnais qui rougit sur du texte juste finit par être lu comme du bruit, et son
# verdict cesse de vouloir dire quelque chose. Corrigé à sa cause — le contrôle lit désormais le
# CODE, jamais la prose qui le décrit.
code_seul() {
	python3 - "$1" <<-'PY'
		import io, re, sys
		texte = io.open(sys.argv[1], encoding='utf-8').read()
		texte = re.sub(r'/\*.*?\*/', '', texte, flags=re.S)
		texte = re.sub(r'^\s*//.*$', '', texte, flags=re.M)
		sys.stdout.write(texte)
	PY
}

# Substitue dans une COPIE du fichier visé, puis l'installe. La copie précédente est DÉTRUITE
# d'abord, et l'échec du substituteur est TESTÉ : c'est le défaut que les deux harnais jumeaux ont
# trouvé dans leur propre code (§2.11 puis §8.9 bis), et le remède est repris ici tel quel plutôt
# que redécouvert.
substituer() {
	local source=$1 cible=$2 avant=$3 apres=$4 nom=$5
	rm -f -- "$cible"
	if ! python3 - "$source" "$cible" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : motif absent ou ambigu dans $source"
		return 1
	fi
	if cmp -s "$source" "$cible"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	return 0
}

# LA DÉGRADATION SQL DOIT S'APPLIQUER, et son code de retour est TESTÉ : une dégradation dont le SQL
# ne compile pas laisse la base INCHANGÉE, la suite reste verte, et le harnais conclurait
# « COMPLAISANT » alors que rien n'a été dégradé (§8.9 bis).
degrader_sql() {
	local avant=$1 apres=$2 nom=$3
	substituer "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" "$nom" || return 1
	restauration_sql_due=true
	if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation « $nom » IMPOSSIBLE : le SQL dégradé ne s'applique pas — $(tail -n 1 "$TRAVAIL/degrade.log")"
		restaurer_sql
		return 1
	fi
	return 0
}

restaurer_sql() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_sql_due=false
}

eprouver_degradation_sql() {
	local nom=$1 avant=$2 apres=$3
	degrader_sql "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer_sql
}

eprouver_degradation_module() {
	local nom=$1 avant=$2 apres=$3
	substituer "$MODULE" "$TRAVAIL/degrade.ts" "$avant" "$apres" "$nom" || return 0
	restauration_module_due=true
	cp "$TRAVAIL/degrade.ts" "$MODULE"
	if suite_unitaire_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite unitaire reste VERTE"
	else
		ok "dégradation « $nom » : la suite unitaire rougit, comme elle doit"
	fi
	cp "$TRAVAIL/module.origine" "$MODULE"
	restauration_module_due=false
}

echo
echo "Preuves de CRM-063 sous-tranche 2b — l'écran d'administration des modèles d'emails"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# LES INSTANTANÉS SONT PRIS AVANT LA PREMIÈRE DÉGRADATION, et non contre `HEAD`
# (`docs/SPEC-test-harness.md` §7.2 point 9).
cp "$MIGRATION" "$TRAVAIL/migration.origine"
cp "$MODULE" "$TRAVAIL/module.origine"

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la sous-tranche n'est orphelin de sa spécification"
# =================================================================================================

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-063' \
	&& head -n 12 "$MIGRATION" | grep -q 'docs/SPEC-modeles-emails.md'; then
	ok "traçabilité : $MIGRATION cite CRM-063 et sa spécification"
else
	fail "traçabilité : $MIGRATION n'a pas d'en-tête @spec complet"
fi

for fichier in "$MODULE" "$ECRAN"; do
	if head -n 14 "$fichier" | grep -q '@spec CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "traçabilité : $fichier cite CRM-063 et sa spécification en @spec"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec complet"
	fi
done

# L'ÉCRAN CITE AUSSI LE DESIGN SYSTEM, et c'est une exigence propre à une surface : une règle
# d'interface sans renvoi au §5.39 serait une règle que personne ne pourrait relire.
if head -n 14 "$ECRAN" | grep -q 'docs/DESIGN_SYSTEM.md'; then
	ok "traçabilité : $ECRAN cite docs/DESIGN_SYSTEM.md"
else
	fail "traçabilité : $ECRAN ne cite pas le design system"
fi

for fichier in "$SUITE_SQL" "$SUITE_UNITAIRE" "$SUITE_API" "$SUITE_UI"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "traçabilité : $fichier cite CRM-063 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

# LES CHAPITRES CITÉS DOIVENT EXISTER. Un fichier qui renvoie à un §9.3 absent serait une trace
# morte, et la traçabilité du §5 de `CLAUDE.md` ne serait plus qu'une formalité.
if [ -f "$SPEC" ] \
	&& grep -q '^### 9.3 LA LISTE FERMÉE DES DOUZE VARIABLES' "$SPEC" \
	&& grep -q '^### 9.5 LA PRÉVISUALISATION' "$SPEC" \
	&& grep -q '^### 9.6 CE QUE ' "$SPEC" \
	&& grep -q '^### 9.7 CE QUE LA CONFIRMATION DE SUPPRESSION ANNONCE' "$SPEC" \
	&& grep -q '^### 9.8 Le dictionnaire fermé des refus' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "$SPEC absent ou amputé d'un chapitre cité"
fi

if grep -q '^### 5.39 Modèles d' "$DESIGN"; then
	ok "le design system porte le §5.39, la huitième surface de réglages"
else
	fail "$DESIGN n'a pas de §5.39 : l'écran serait une surface sans règle écrite"
fi

# =================================================================================================
echo
echo "2. Le guichet, mesuré dans le CATALOGUE et non relu dans le SQL"
# =================================================================================================
# Lire la migration prouverait ce qui est ÉCRIT ; seul le catalogue dit ce qui est APPLIQUÉ. La
# distinction n'est pas théorique : une migration corrigée mais non rejouée laisserait le fichier
# juste et la base fausse.

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'mail_template_variables';")" = 1 ]; then
	ok "public.mail_template_variables existe dans la base"
else
	fail "public.mail_template_variables ABSENTE — la migration 57 n'a pas été appliquée"
fi

if [ "$(psql_db -c "select public.mail_template_variables() = app.mail_template_variables();")" = t ]; then
	ok "le guichet rend EXACTEMENT la liste déléguée : il délègue, il ne recopie pas"
else
	fail "le guichet DIVERGE de app.mail_template_variables() — la source unique du §3 est rompue"
fi

if [ "$(psql_db -c "select array_length(public.mail_template_variables(), 1);")" = "$VARIABLES_ATTENDUES" ]; then
	ok "le guichet rend $VARIABLES_ATTENDUES variables"
else
	fail "le guichet ne rend pas $VARIABLES_ATTENDUES variables"
fi

if [ "$(psql_db -c "select has_function_privilege('anon', 'public.mail_template_variables()', 'execute');")" = f ] \
	&& [ "$(psql_db -c "select has_function_privilege('authenticated', 'public.mail_template_variables()', 'execute');")" = t ]; then
	ok "les privilèges du guichet : authenticated exécute, anon NON"
else
	fail "les privilèges du guichet ne sont pas ceux du §9.3"
fi

# =================================================================================================
echo
echo "3. L'ÉCRAN NE RECOPIE PAS LA LISTE, et c'est la décision structurante du §9.3"
# =================================================================================================
# C'est le contrôle qui relie la migration au code de l'écran. Une liste recopiée en TypeScript
# serait ACCEPTÉE par le compilateur, verte à tous les tests unitaires, et pourtant fausse le jour
# où une treizième variable entrerait au §2.4.

recopiees=0
for variable in $(psql_db -c "select unnest(public.mail_template_variables());"); do
	if { code_seul "$MODULE"; code_seul "$ECRAN"; } | grep -q "'$variable'"; then
		recopiees=$((recopiees + 1))
	fi
done
if [ "$recopiees" -eq 0 ]; then
	ok "aucun des $VARIABLES_ATTENDUES noms de variable n'est écrit en dur dans le module ni l'écran"
else
	fail "$recopiees nom(s) de variable recopié(s) dans le code de l'écran — la source unique du §3 est rompue"
fi

if grep -q "client.rpc('mail_template_variables')" "$MODULE"; then
	ok "le module appelle le guichet, et c'est de là que la palette tire ses noms"
else
	fail "le module n'appelle pas public.mail_template_variables"
fi

# =================================================================================================
echo
echo "4. Les règles de l'écran que seule une LECTURE du code peut constater"
# =================================================================================================
# Ces règles ne se mesurent ni en base ni par une assertion d'interface : elles portent sur ce que
# l'écran s'INTERDIT. Une preuve d'interface ne voit pas ce qui n'est pas là.

# LA RELECTURE APRÈS ÉCRITURE (§9.8) : sans `select()`, PostgREST rend `204` aussi bien pour un
# `PATCH` consenti que pour un `PATCH` que la politique a laissé passer sans rien écrire.
if grep -q "\.select(COLONNES_MODELE_EMAIL)" "$MODULE" && grep -q "\.select('id')" "$MODULE"; then
	ok "toute écriture RELIT sa ligne : c'est ce qui distingue un succès d'un zéro-ligne"
else
	fail "une écriture ne relit pas sa ligne — un refus silencieux passerait pour un succès"
fi

# AUCUNE PHRASE DU SERVEUR N'ATTEINT L'ÉCRAN (§9.8) : le champ `details` d'un refus de contrainte
# porte la ligne fautive ENTIÈRE, c'est-à-dire le corps du modèle.
if ! code_seul "$ECRAN" | grep -q 'erreur\.detail'; then
	ok "l'écran ne rend jamais le détail technique d'une erreur"
else
	fail "l'écran rend un détail technique — le champ details porte le corps entier du modèle"
fi

# AUCUNE GARDE DE SAISIE (§5.3 ter) : ni `required`, ni `maxLength`, ni `pattern`. C'est la base qui
# tranche, et l'écran traduit son refus.
if ! code_seul "$ECRAN" | grep -qE 'required|maxLength|pattern='; then
	ok "aucune garde de saisie ne double une contrainte de la base"
else
	fail "l'écran porte une garde de saisie — le §5.3 ter l'interdit"
fi

# AUCUNE COMMANDE ÉTEINTE SELON LE RÔLE (§5.3, §5.13, §5.21, §5.27) : l'écran ne calcule aucun droit.
if ! code_seul "$ECRAN" | grep -qE "role ===|=== 'admin'|=== 'viewer'|workspace_role"; then
	ok "l'écran ne calcule AUCUN droit : c'est la base qui refuse"
else
	fail "l'écran calcule un droit — aucune surface de réglages n'a le droit de le faire"
fi

# CE CONTRÔLE EST RÉVISÉ, ET NON RETIRÉ — 2026-08-26, sous-tranche 4c, `CLAUDE.md` §18.
#
# Il mesurait, le 2026-08-25, que RIEN ne référençait `mail_templates`, et il en concluait que la
# confirmation du §9.7 avait raison de se taire. LA MIGRATION `0059` A POSÉ CETTE CLÉ — le
# `on delete restrict` du §11.4, annoncé quatre tranches à l'avance —, et le contrôle rougissait
# donc À JUSTE TITRE : il a fait exactement ce pour quoi il a été écrit, dénoncer une confirmation
# devenue fausse.
#
# Il mesure désormais l'ÉTAT ATTENDU : la clé existe, la confirmation annonce la RÈGLE (§13.9), et
# l'écran sait TRADUIRE le refus. Les trois sont vérifiés ensemble — la clé sans la phrase serait
# une confirmation muette sur un refus réel, et la phrase sans la traduction ferait retomber le
# refus dans le repli `inconnu`.
references=$(psql_db -c "select count(*) from pg_constraint
	where confrelid = 'public.mail_templates'::regclass
	  and conname = 'mail_sequence_steps_template_id_fkey';")
if [ "$references" = 1 ]; then
	ok "le on delete restrict de la migration 59 référence mail_templates, comme le §11.4 l'annonçait"
else
	fail "mail_sequence_steps_template_id_fkey ABSENTE — la migration 59 n'a pas été appliquée"
fi

if code_seul "$ECRAN" | grep -q "admin.mailTemplates.delete.confirm.sequenceRule"; then
	ok "la confirmation annonce la RÈGLE du §13.9 : un modèle employé ne se supprime pas"
else
	fail "la confirmation ne dit rien du on delete restrict — le §9.7 reste faux (§13.9)"
fi

if code_seul "$MODULE" | grep -q "mail_sequence_steps_template_id_fkey"; then
	ok "le refus du on delete restrict est CLASSÉ, jamais rangé dans le repli inconnu"
else
	fail "le module ne classe pas mail_sequence_steps_template_id_fkey — le refus retomberait sur inconnu"
fi

# L'ÉCRAN EST ATTEIGNABLE, et son adresse est celle du §9.1.
if grep -q "$CHEMIN_ECRAN" webapp/src/app/chemins.ts \
	&& grep -q 'CHEMIN_ADMIN_MODELES_MAIL' webapp/src/app/App.tsx \
	&& grep -q 'CHEMIN_ADMIN_MODELES_MAIL' webapp/src/app/routes.tsx; then
	ok "l'écran est routé et atteignable depuis l'index des réglages"
else
	fail "l'écran n'est pas routé : une surface inatteignable n'est pas livrée"
fi

# =================================================================================================
echo
echo "5. Les preuves de la sous-tranche"
# =================================================================================================

if suite_sql_verte; then
	ok "$SUITE_SQL : $(grep -oE '[0-9]+ assertions' "$TRAVAIL/tap.log" | tail -n 1)"
else
	fail "$SUITE_SQL rougit — voir $TRAVAIL/tap.log"
	tail -n 20 "$TRAVAIL/tap.log" >&2
fi

# LA CHAÎNE NODE EST PRÉPARÉE AVANT LE PREMIER APPEL À `npm`, et ce n'est pas une formalité :
# l'hôte démarre sur la v22 du système alors que le dépôt exige Node 24, et
# `scripts/verify-node-toolchain.sh` vérifie mécaniquement que TOUT harnais invoquant `npm` porte
# cette garde.
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

if suite_unitaire_verte; then
	ok "$SUITE_UNITAIRE : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "$SUITE_UNITAIRE rougit — voir $TRAVAIL/unit.log"
	tail -n 30 "$TRAVAIL/unit.log" >&2
fi

if [ "$RAPIDE" = true ]; then
	ok "contrat d'API et parcours E2E NON exécutés (--rapide) — dit plutôt que tu"
else
	if npm run e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1; then
		ok "$SUITE_API : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1)"
	else
		fail "$SUITE_API rougit — voir $TRAVAIL/api.log"
		tail -n 40 "$TRAVAIL/api.log" >&2
	fi

	# LE NAVIGATEUR EST EXPORTÉ : sans cela, tout scénario d'interface meurt à `browserType.launch`
	# sur un binaire que l'hôte ne porte pas, AVANT la moindre assertion — ce qui n'est ni un
	# verdict rouge ni une preuve (`docs/CloudWorker.md` §2.1 ter).
	export PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium}
	if npm run e2e:ui -- "$SUITE_UI" >"$TRAVAIL/ui.log" 2>&1; then
		ok "$SUITE_UI : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -n 1)"
	else
		fail "$SUITE_UI rougit — voir $TRAVAIL/ui.log"
		tail -n 40 "$TRAVAIL/ui.log" >&2
	fi
fi

# =================================================================================================
echo
echo "6. Dégradations RÉELLES : les preuves savent-elles rougir ?"
# =================================================================================================

# D-A — le guichet devient `stable` au lieu d'`immutable`. La suite doit dénoncer la forme, faute de
# quoi le guichet pourrait perdre la propriété que la fonction déléguée porte.
eprouver_degradation_sql "le guichet devient STABLE au lieu d'IMMUTABLE" \
	'returns text[]
language sql
immutable' \
	'returns text[]
language sql
stable'

# D-B — le privilège d'exécution est rendu à `anon`. C'est le point de sûreté des `alter default
# privileges`, et la suite le mesure par `has_function_privilege`.
eprouver_degradation_sql "le privilège d'exécution est rendu à anon" \
	'grant execute on function public.mail_template_variables() to authenticated, service_role;' \
	'grant execute on function public.mail_template_variables() to anon, authenticated, service_role;'

# D-C — LE GUICHET CESSE DE DÉLÉGUER. C'EST LA DÉGRADATION LA PLUS IMPORTANTE DE CE HARNAIS : la
# fonction publique rend une liste FIGÉE au lieu d'appeler la source unique, ce qui est exactement
# le défaut que le §9.3 écarte en refusant de recopier la liste en TypeScript. La liste figée est
# VOLONTAIREMENT amputée d'un nom : si elle était identique, la dégradation ne mordrait pas — et
# c'est bien la DÉLÉGATION, non le contenu du moment, que la suite doit défendre.
eprouver_degradation_sql "le guichet cesse de DÉLÉGUER et rend une liste figée" \
	'	select app.mail_template_variables();' \
	"	select array['card.amount', 'card.channel', 'card.currency', 'card.next_action',
		'card.next_action_at', 'card.step', 'card.title', 'contact.email',
		'contact.full_name', 'contact.organization', 'identity.from_address']::text[];"

# D-D — L'ÉCRITURE CESSE DE RELIRE SA LIGNE : un zéro-ligne devient un succès. C'est le refus
# silencieux du §2.7 ligne 7, et la suite unitaire doit le dénoncer — sans quoi l'écran annoncerait
# un enregistrement que la politique a refusé.
eprouver_degradation_module "un zéro-ligne à l'écriture passe pour un succès" \
	"		if (lignes.length === 0) return { issue: 'zero-ligne' }" \
	"		if (lignes.length === 0) return { issue: 'enregistre', modele: {} as ModeleEmail }"

# D-E — LES DEUX REFUS DE VARIABLE SONT CONFONDUS. L'écran poserait alors son message près du
# mauvais champ, et la migration `0055` aurait nommé deux contraintes pour rien (§2.3).
eprouver_degradation_module "les refus de variable de l'objet et du corps sont confondus" \
	"	if (message.includes('mail_templates_subject_variables')) return 'variable-inconnue-objet'" \
	"	if (message.includes('mail_templates_subject_variables')) return 'variable-inconnue-corps'"

# =================================================================================================
echo
echo "7. La restauration est CONSTATÉE, octet à octet, et la base avec elle"
# =================================================================================================
# Constatée contre les instantanés pris au début, jamais contre `HEAD` : le harnais doit fonctionner
# dans un arbre portant une évolution légitime non encore committée.

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de son état initial"
fi

if cmp -s "$MODULE" "$TRAVAIL/module.origine"; then
	ok "le module de l'écran est restauré à l'octet près"
else
	fail "le module de l'écran DIFFÈRE de son état initial"
fi

if [ "$(psql_db -c "select has_function_privilege('anon', 'public.mail_template_variables()', 'execute');")" = f ] \
	&& [ "$(psql_db -c "select public.mail_template_variables() = app.mail_template_variables();")" = t ]; then
	ok "la base est restaurée : anon n'exécute pas, et le guichet délègue de nouveau"
else
	fail "la base est restée DÉGRADÉE — un état dégradé ne doit jamais survivre au harnais"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

if suite_unitaire_verte; then
	ok "après restauration, la suite unitaire est de nouveau VERTE"
else
	fail "la suite unitaire reste rouge après restauration"
fi

compte_final=$(psql_db -c "select count(*) from public.mail_templates where workspace_id = '$WORKSPACE';")
if [ "$compte_final" = "$MODELES_DU_SEED" ]; then
	ok "le seed est rendu INTACT : $MODELES_DU_SEED modèles, comme à l'entrée"
else
	fail "le seed porte $compte_final modèles au lieu de $MODELES_DU_SEED"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
