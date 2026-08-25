#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, TRANCHE 1 : le modèle d'email
# @verifies docs/SPEC-modeles-emails.md §2.2 (colonnes et bornes), §2.4 (la liste fermée des douze
#           variables), §2.5 (ce que la base refuse, ligne à ligne), §2.6 (autorisations),
#           §2.7 (contrat d'API), §2.8 (le jeu de démonstration), §3 et §4 (les deux fonctions)
# @verifies docs/SCHEMA.md §7 (`mail_templates`) ; docs/PROD_MIGRATIONS.md §3 (migration 55)
# @verifies docs/SPEC-seed.md §14 (les deux modèles du seed et leur convergence)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la tranche, puis DÉGRADE RÉELLEMENT la migration — une
# dégradation par règle qu'elle porte — et exige que la suite pgTAP rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu (`docs/SPEC-test-harness.md`
# §7.2 point 3) : aucun RENDU de modèle — la substitution des variables est la tranche 2 ; aucun
# envoi — `mail_outbox` ignore les modèles ; aucun écran, cette tranche n'en livrant aucun.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0055_modeles_emails.sql
SUITE_SQL=supabase/tests/0053_modeles_emails.test.sql
SUITE_API=e2e/api/modeles-emails.spec.ts
SPEC=docs/SPEC-modeles-emails.md
SEED=supabase/seed/apply-seed.sh

# Les deux modèles du seed — `docs/SPEC-seed.md` §14.1.
MODELE_RELANCE=7e11a7e0-0000-4000-8000-000000000001
MODELE_CONTACT=7e11a7e0-0000-4000-8000-000000000002
MODELES_DU_SEED=2
WORKSPACE=5eed0000-0000-4000-8000-000000000001

RAPIDE=false
[ "${1:-}" = '--rapide' ] && RAPIDE=true

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
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

# Substitue dans une COPIE de la migration, puis l'applique. Le motif est comparé AVANT et APRÈS :
# une substitution qui ne substituerait rien laisserait la suite verte et le harnais conclurait à
# tort à la complaisance — c'est le défaut trouvé à `CRM-061` (décision 503), et il ne se refait pas.
degrader() {
	local avant=$1 apres=$2 nom=$3
	# LA COPIE PRÉCÉDENTE EST DÉTRUITE D'ABORD, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE.
	# MESURÉ le 2026-08-25, dans ce harnais même : `degrader` est appelée dans un `||`, ce qui
	# suspend `set -e` sur tout le composé. Un motif ambigu faisait donc échouer le substituteur
	# SANS arrêter la fonction, `degrade.sql` gardait la dégradation PRÉCÉDENTE, `cmp` la trouvait
	# différente de la migration, et le harnais réappliquait l'ancienne en annonçant la nouvelle
	# comme mordante. C'était exactement le mensonge tranquille que la décision 503 reproche.
	rm -f -- "$TRAVAIL/degrade.sql"
	if ! python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	then
		fail "dégradation « $nom » IMPOSSIBLE : motif absent ou ambigu dans $MIGRATION"
		return 1
	fi
	if ! cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		restauration_due=true
		psql_db -f - < "$TRAVAIL/degrade.sql" >/dev/null 2>&1
		return 0
	fi
	fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	return 1
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_due=false
}

eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3
	degrader "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-063 tranche 1 — les modèles d'email"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# L'INSTANTANÉ EST PRIS AVANT LA PREMIÈRE DÉGRADATION, et non contre `HEAD` : le harnais doit
# fonctionner dans un arbre portant une évolution légitime non encore committée
# (`docs/SPEC-test-harness.md` §7.2 point 9).
cp "$MIGRATION" "$TRAVAIL/migration.origine"

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la tranche n'est orphelin de sa spécification"
# =================================================================================================
# `CLAUDE.md` §5 : chaque fichier porte ses commentaires `@spec` / `@verifies` vers l'unité de
# backlog ET les chapitres.

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-063' \
	&& head -n 12 "$MIGRATION" | grep -q 'docs/SPEC-modeles-emails.md'; then
	ok "traçabilité : $MIGRATION cite CRM-063 et sa spécification"
else
	fail "traçabilité : $MIGRATION n'a pas d'en-tête @spec complet"
fi

for fichier in "$SUITE_SQL" "$SUITE_API"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-063' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-modeles-emails.md'; then
		ok "traçabilité : $fichier cite CRM-063 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

if [ -f "$SPEC" ] && grep -q '^### 2.4 La liste fermée des variables' "$SPEC" \
	&& grep -q '^### 2.5 Ce que la base refuse, ligne à ligne' "$SPEC" \
	&& grep -q '^### 2.6 Autorisations' "$SPEC" \
	&& grep -q '^### 2.7 Contrat d' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "$SPEC absent ou amputé d'un chapitre cité"
fi

# =================================================================================================
echo
echo "2. Forme de la table, mesurée dans le catalogue et non relue dans le SQL"
# =================================================================================================
# Lire la migration prouverait ce qui est ÉCRIT ; seul le catalogue dit ce qui est APPLIQUÉ. La
# distinction n'est pas théorique : une migration corrigée mais non rejouée laisserait le fichier
# juste et la base fausse.

if [ "$(psql_db -c "select to_regclass('public.mail_templates') is not null;")" = t ]; then
	ok "public.mail_templates existe dans la base"
else
	fail "public.mail_templates ABSENTE — la migration 55 n'a pas été appliquée"
fi

colonnes=$(psql_db -c "select string_agg(column_name, ',' order by ordinal_position)
	from information_schema.columns
	where table_schema = 'public' and table_name = 'mail_templates';")
attendu='id,workspace_id,name,subject,body_text,created_by,created_at,updated_at'
if [ "$colonnes" = "$attendu" ]; then
	ok "les huit colonnes du §2.2, dans l'ordre"
else
	fail "colonnes inattendues : '$colonnes' au lieu de '$attendu'"
fi

# AUCUNE colonne d'archivage : le §2.2 tranche que le modèle se SUPPRIME. Le contrôle fige la
# décision — le voir rougir signalerait qu'un archivage a été ajouté sans réviser la spécification.
if [ "$(psql_db -c "select count(*) from information_schema.columns
	where table_schema='public' and table_name='mail_templates' and column_name='archived_at';")" = 0 ]; then
	ok "aucune colonne archived_at : un modèle se supprime réellement (§2.2)"
else
	fail "une colonne archived_at est apparue — le §2.2 dit l'inverse"
fi

if [ "$(psql_db -c "select relrowsecurity from pg_class where oid='public.mail_templates'::regclass;")" = t ]; then
	ok "la RLS est ACTIVÉE sur mail_templates"
else
	fail "la RLS est DÉSACTIVÉE : toute politique serait décorative"
fi

politiques=$(psql_db -c "select string_agg(policyname, ',' order by policyname)
	from pg_policies where schemaname='public' and tablename='mail_templates';")
attendu_pol='mail_templates_insertion_membre_ecrivant,mail_templates_lecture_membre,mail_templates_maj_membre_ecrivant,mail_templates_suppression_membre_ecrivant'
if [ "$politiques" = "$attendu_pol" ]; then
	ok "les quatre politiques du §2.6, nommément"
else
	fail "politiques inattendues : '$politiques'"
fi

# Les deux fonctions DOIVENT être `immutable` : c'est la condition d'existence des contraintes.
for fonction in mail_template_variables mail_template_variables_inconnues; do
	volatilite=$(psql_db -c "select p.provolatile from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname='app' and p.proname='$fonction';")
	if [ "$volatilite" = i ]; then
		ok "app.$fonction est IMMUTABLE — condition des contraintes de vérification"
	else
		fail "app.$fonction n'est pas IMMUTABLE ('$volatilite') : les contraintes ne tiendraient pas"
	fi
done

# =================================================================================================
echo
echo "3. Privilèges — la porte que les privilèges par défaut laisseraient ouverte"
# =================================================================================================
# `alter default privileges … to anon` accorde `all privileges` à `anon` sur toute table neuve de
# `public`. Un `revoke … from public` ne retire RIEN à un rôle nommé : c'est le point de sûreté des
# migrations 48 à 54, et il se mesure ici sur la base réelle.

for action in insert update delete; do
	if [ "$(psql_db -c "select has_table_privilege('anon','public.mail_templates','$action');")" = f ]; then
		ok "anon n'a PAS le privilège $action"
	else
		fail "anon a le privilège $action : le revoke nominatif manque"
	fi
done

if [ "$(psql_db -c "select has_table_privilege('anon','public.mail_templates','select');")" = t ]; then
	ok "anon conserve select : le refus de lecture est un FILTRAGE, pas une erreur (§2.7 ligne 1)"
else
	fail "anon a perdu select : la lecture anonyme rendrait 401 au lieu de 200 []"
fi

if [ "$(psql_db -c "select has_function_privilege('anon','app.mail_template_variables()','execute');")" = t ]; then
	ok "app.mail_template_variables() est exécutable par anon : elle ne divulgue rien"
else
	fail "app.mail_template_variables() fermée à anon : la contrainte ne s'évaluerait pas partout"
fi

# =================================================================================================
echo
echo "4. La liste des douze variables, comparée nom à nom au §2.4"
# =================================================================================================
# UN COMPTE NE SUFFIT PAS : une liste qui aurait perdu `card.title` et gagné `card.titel` garderait
# son cardinal. Le contrôle compare la liste de la BASE à celle de la SPÉCIFICATION, lue dans son
# tableau — deux sources indépendantes, ce qui est le seul montage qui puisse dénoncer une dérive.

liste_base=$(psql_db -c "select array_to_string(app.mail_template_variables(), ',');")
liste_spec=$(grep -oE '^\| `[a-z]+\.[a-z_]+` \|' "$SPEC" | tr -d '|` ' | sort | paste -sd, -)
if [ "$liste_base" = "$liste_spec" ]; then
	ok "les douze variables de la base sont EXACTEMENT celles du tableau du §2.4"
else
	fail "la base et le §2.4 divergent : base='$liste_base' spec='$liste_spec'"
fi

if [ "$(psql_db -c "select cardinality(app.mail_template_variables());")" = 12 ]; then
	ok "douze variables, et pas une de plus"
else
	fail "le nombre de variables a changé sans révision du §2.4"
fi

# LES NEUF CAS DE LA FONCTION DE REFUS, mesurés sur la base. Trois d'entre eux ne s'écriraient pas
# spontanément — le trou vide, la triple accolade et le texte nul — et ce sont ceux qui décident du
# comportement aux bords.
verifier_inconnues() {
	local libelle=$1 texte=$2 attendu=$3
	local obtenu
	obtenu=$(psql_db -c "select array_to_string(app.mail_template_variables_inconnues(\$\$$texte\$\$), ',');")
	if [ "$obtenu" = "$attendu" ]; then
		ok "refus « $libelle » : '$obtenu'"
	else
		fail "refus « $libelle » : '$obtenu' au lieu de '$attendu'"
	fi
}

verifier_inconnues 'aucune variable'          'Bonjour, rien ici'                      ''
verifier_inconnues 'connue et répétée'        '{{card.title}} et {{card.title}}'       ''
verifier_inconnues 'blancs de bord tolérés'   '{{  card.title  }}'                     ''
verifier_inconnues 'faute de frappe'          '{{card.titel}}'                         'card.titel'
verifier_inconnues 'trou vide'                '{{}}'                                   ''
verifier_inconnues 'casse différente'         '{{CARD.TITLE}}'                         'CARD.TITLE'
verifier_inconnues 'triés et dédoublonnés'    '{{zebre}} {{alpha}} {{zebre}}'          'alpha,zebre'

# Le trou vide rend un tableau d'UN élément vide, que `array_to_string` rend comme la chaîne vide —
# indistinguable du tableau vide par ce chemin. Le cardinal, lui, les sépare, et c'est ce qui décide
# si `{{}}` est refusé ou accepté.
if [ "$(psql_db -c "select cardinality(app.mail_template_variables_inconnues('{{}}'));")" = 1 ]; then
	ok "le trou VIDE compte pour un inconnu : « {{}} » est refusé à l'écriture"
else
	fail "le trou vide ne compte pour rien : « {{}} » s'écrirait sans bruit"
fi
if [ "$(psql_db -c "select cardinality(app.mail_template_variables_inconnues(null));")" = 0 ]; then
	ok "un texte nul ne refuse rien : une contrainte ne refuse jamais sur null"
else
	fail "un texte nul produit un inconnu : la contrainte refuserait une ligne à colonne nulle"
fi

# =================================================================================================
echo
echo "5. Le jeu de démonstration — son compte ET ce qu'il doit démontrer"
# =================================================================================================
# `docs/SPEC-seed.md` §14.3. Le compte seul ne dit rien : deux modèles identiques passeraient. Ce
# qui compte est la DIFFÉRENCE — variables dans les deux colonnes pour l'un, dans le corps seul
# pour l'autre —, sans laquelle une contrainte posée sur `subject` seul passerait tout.

compte=$(psql_db -c "select count(*) from public.mail_templates where workspace_id = '$WORKSPACE';")
if [ "$compte" = "$MODELES_DU_SEED" ]; then
	ok "le seed pose $MODELES_DU_SEED modèles, ni plus ni moins"
else
	fail "$compte modèles au lieu de $MODELES_DU_SEED — seed non appliqué, ou preuve non nettoyée"
fi

if [ "$(psql_db -c "select subject like '%{{%' from public.mail_templates where id='$MODELE_RELANCE';")" = t ]; then
	ok "« Relance sans réponse » porte une variable dans son OBJET"
else
	fail "« Relance sans réponse » a perdu la variable de son objet : le §2.8 la lui donne"
fi

if [ "$(psql_db -c "select subject like '%{{%' from public.mail_templates where id='$MODELE_CONTACT';")" = f ]; then
	ok "« Prise de contact » porte un objet FIXE : le cas qui prouve que c'est légitime"
else
	fail "« Prise de contact » a gagné une variable dans son objet — le §2.8 dit l'inverse"
fi

# LA VARIABLE POUVANT ÊTRE NULLE est ce que la tranche 2 devra trancher. Sa présence dans le seed
# n'est pas décorative : sans elle, le rendu serait écrit sur un jeu qui ne l'exerce jamais.
if [ "$(psql_db -c "select body_text like '%{{card.amount}}%' from public.mail_templates where id='$MODELE_RELANCE';")" = t ]; then
	ok "le seed porte une variable POUVANT ÊTRE NULLE, que la tranche 2 devra rendre"
else
	fail "aucune variable nullable dans le seed : la tranche 2 s'écrirait à l'aveugle"
fi

if grep -q '8 sexdecies' "$SEED" && grep -q 'api_admin POST /rest/v1/mail_templates' "$SEED"; then
	ok "le seed crée les modèles PAR LA ROUTE, avec le jeton réel de l'administratrice"
else
	fail "le seed n'emploie plus api_admin : une écriture par la clé de service n'exerce pas la RLS"
fi

# =================================================================================================
echo
echo "6. La suite pgTAP de la tranche"
# =================================================================================================

if suite_sql_verte; then
	ok "$SUITE_SQL : $(grep -oE '[0-9]+ assertions' "$TRAVAIL/tap.log" | head -n 1)"
else
	fail "$SUITE_SQL rougit — voir $TRAVAIL/tap.log"
	sed -n '1,40p' "$TRAVAIL/tap.log" >&2
fi

# =================================================================================================
echo
echo "7. Le contrat d'API, par la vraie route"
# =================================================================================================
# La suite pgTAP prouve la règle SOUS DES RÔLES ENDOSSÉS ; elle ne dit rien du cache de schéma de
# PostgREST ni des privilèges tels que la route les applique. C'est exactement le défaut que la
# migration 53 portait et que seule la mesure par l'API avait trouvé (décision 504).

if [ "$RAPIDE" = true ]; then
	ok "contrat d'API NON exécuté (--rapide) — dit plutôt que tu"
else
	if npm run e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1; then
		ok "$SUITE_API : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1)"
	else
		fail "$SUITE_API rougit — voir $TRAVAIL/api.log"
		tail -n 40 "$TRAVAIL/api.log" >&2
	fi
fi

# =================================================================================================
echo
echo "8. Dégradations réelles — chacune retire UNE règle et doit faire rougir la suite"
# =================================================================================================

# D-A — la contrainte de variables de l'OBJET est retirée. Un modèle portant `{{card.titel}}` dans
# son objet s'écrirait, et le défaut n'apparaîtrait qu'à l'envoi (§2.3).
eprouver_degradation 'contrainte de variables sur subject' \
	'	check (cardinality(app.mail_template_variables_inconnues(subject)) = 0);' \
	'	check (true);'

# D-B — la contrainte de variables du CORPS est retirée. Elle est éprouvée SÉPARÉMENT de la
# précédente : une validation posée sur une seule colonne est exactement le défaut que le second
# modèle du seed existe pour attraper (§2.8).
eprouver_degradation 'contrainte de variables sur body_text' \
	'	check (cardinality(app.mail_template_variables_inconnues(body_text)) = 0);' \
	'	check (true);'

# D-C — l'unicité cesse de NORMALISER. « Relance » et « Relance   » cohabiteraient alors dans la
# liste, indistinguables à l'œil (§2.5 point i).
eprouver_degradation 'unicité sur la forme normalisée' \
	'	on public.mail_templates (workspace_id, app.btrim_blancs(name));' \
	'	on public.mail_templates (workspace_id, name);'

# D-D — une variable est RETIRÉE de la liste fermée. La suite compare la liste nom à nom, donc elle
# doit rougir ; si elle ne comparait que le cardinal, elle rougirait ici mais laisserait passer un
# renommage, et le contrôle 4 ci-dessus ne vaudrait rien.
eprouver_degradation 'une variable retirée de la liste fermée' \
	"		'card.channel',          -- public.channels.name                         (jamais nul)" \
	''

# D-E — la politique d'insertion s'ouvre à TOUT membre. La lectrice pourrait alors créer un modèle,
# et le §2.6 dit l'inverse.
# LE MOTIF EST ANCRÉ SUR LES DEUX LIGNES QUI PRÉCÈDENT, et c'est nécessaire : la clause
# `with check` de l'insertion est mot pour mot celle de la mise à jour, et un motif ambigu ne
# dégraderait rien. Le harnais le dirait désormais — il l'a dit une fois, et c'est ce qui a fait
# corriger `degrader` ci-dessus.
eprouver_degradation "politique d'insertion ouverte à tout membre" \
	"	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));" \
	"	for insert
	to authenticated
	with check (app.is_workspace_member(workspace_id));"

# D-F — le privilège d'insertion est rendu à `anon`. C'est le point de sûreté des `alter default
# privileges`, et la suite le mesure par `has_table_privilege`.
eprouver_degradation "privilège d'insertion rendu à anon" \
	'grant insert, update, delete on public.mail_templates to authenticated;' \
	'grant insert, update, delete on public.mail_templates to anon, authenticated;'

# =================================================================================================
echo
echo "9. La restauration est CONSTATÉE, octet à octet, et la base avec elle"
# =================================================================================================
# Constatée contre l'instantané pris au début, jamais contre `HEAD` : le harnais doit fonctionner
# dans un arbre portant une évolution légitime non encore committée.

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de son état initial"
fi

if [ "$(psql_db -c "select has_table_privilege('anon','public.mail_templates','insert');")" = f ] \
	&& [ "$(psql_db -c "select cardinality(app.mail_template_variables());")" = 12 ]; then
	ok "la base est restaurée : anon n'insère pas, et la liste porte de nouveau douze variables"
else
	fail "la base est restée DÉGRADÉE — un état dégradé ne doit jamais survivre au harnais"
fi

if suite_sql_verte; then
	ok "après restauration, la suite pgTAP est de nouveau VERTE"
else
	fail "la suite pgTAP reste rouge après restauration"
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
