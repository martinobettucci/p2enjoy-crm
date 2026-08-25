#!/usr/bin/env bash
# @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, TRANCHE 2, sous-tranche 2a : LE RENDU
# @verifies docs/SPEC-modeles-emails.md §8.2 (la substitution vit en base), §8.3 (contrat de la
#           fonction), §8.4 (ce qu'un trou nul rend, et son inventaire), §8.5 (les sources ne se
#           devinent pas), §8.6 (formatage), §8.7 (privilèges), §8.8 (contrat d'API)
# @verifies docs/SCHEMA.md §7 (`mail_templates`) ; docs/PROD_MIGRATIONS.md §3 (migration 56)
# @verifies docs/SPEC-seed.md §14 (les deux modèles du seed)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la sous-tranche, puis DÉGRADE RÉELLEMENT la migration — une
# dégradation par règle qu'elle porte — et exige que la suite pgTAP rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# LA DÉGRADATION LA PLUS IMPORTANTE DE CE HARNAIS EST D-C, ET ELLE MÉRITE D'ÊTRE LUE. Elle remplace
# la chaîne vide d'un trou nul par un TIRET — l'une des trois branches que le §7.1 posait et que le
# §8.4 a écartée. Si la suite restait verte, cela voudrait dire que la décision de la tranche n'est
# éprouvée nulle part, et qu'un futur rendu pourrait inventer une valeur sans que rien ne bronche.
#
# CE QUE CE HARNAIS NE PROUVE PAS, et qui est dit plutôt que sous-entendu (`docs/SPEC-test-harness.md`
# §7.2 point 3) : aucun ÉCRAN — l'administration des modèles est la sous-tranche 2b ; aucun ENVOI —
# `mail_outbox` ignore toujours les modèles ; aucune SIGNATURE et aucune SÉQUENCE, tranches 3 et 4.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0056_rendu_modeles_emails.sql
SUITE_SQL=supabase/tests/0054_rendu_modeles_emails.test.sql
SUITE_API=e2e/api/rendu-modeles-emails.spec.ts
SPEC=docs/SPEC-modeles-emails.md

# Le modèle du seed qui porte des variables dans les DEUX colonnes — `docs/SPEC-seed.md` §14.1.
MODELE_RELANCE=7e11a7e0-0000-4000-8000-000000000001
# `Migration ERP Sogexia` — montant, prochaine action et échéance tous renseignés.
AFFAIRE_COMPLETE=5eed0000-0000-4000-8000-0000000000c2
# `Piste entrante à qualifier` — MESURÉ : montant, prochaine action et échéance tous NULS.
AFFAIRE_SANS_MONTANT=5eed0000-0000-4000-8000-0000000000c6
# Léo Marchand, avec organisation et email.
CONTACT_LEO=5eed0000-0000-4000-8000-000000000091
WORKSPACE=5eed0000-0000-4000-8000-000000000001
MODELES_DU_SEED=2
VARIABLES_ATTENDUES=12

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

# Substitue dans une COPIE de la migration, puis l'applique. La copie précédente est DÉTRUITE
# d'abord, et l'échec du substituteur est TESTÉ : c'est le défaut que le harnais jumeau a trouvé
# dans son propre code le 2026-08-25 (§2.11) — `degrader` appelée dans un `||` suspend `set -e`,
# si bien qu'un motif ambigu laissait réappliquer la dégradation PRÉCÉDENTE en annonçant la
# nouvelle comme mordante. Le remède est repris ici tel quel plutôt que redécouvert.
degrader() {
	local avant=$1 apres=$2 nom=$3
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
	if cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
		return 1
	fi
	# LA DÉGRADATION DOIT S'APPLIQUER, ET C'EST UN DÉFAUT TROUVÉ PAR CE HARNAIS DANS CE HARNAIS,
	# le 2026-08-25. Une dégradation dont le SQL ne compile pas — un `trou[1]` posé sur un `text`,
	# par exemple — laisse la base INCHANGÉE : la suite pgTAP reste alors verte, et le harnais
	# conclut « COMPLAISANT » alors que rien n'a été dégradé. C'est la même famille de mensonge
	# tranquille que le §2.11 a corrigée sur le substituteur, sous une forme nouvelle — là c'était
	# la SUBSTITUTION qui échouait sans arrêter, ici c'est l'APPLICATION. Le code de retour de
	# `psql` est donc TESTÉ, et un échec est nommé « IMPOSSIBLE » plutôt que compté pour une preuve.
	restauration_due=true
	if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation « $nom » IMPOSSIBLE : le SQL dégradé ne s'applique pas — $(tail -n 1 "$TRAVAIL/degrade.log")"
		restaurer
		return 1
	fi
	return 0
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

# Un appel du rendu, réduit à une colonne. Il s'exécute en PROPRIÉTAIRE — la RLS n'est pas ce que
# ces contrôles mesurent, la suite pgTAP et le contrat d'API s'en chargent avec les profils réels.
rendu() {
	local colonne=$1 modele=$2 affaire=$3 personne=${4:-null} expediteur=${5:-null}
	psql_db -c "select $colonne from public.rendre_modele_email(
		'$modele'::uuid, '$affaire'::uuid,
		$([ "$personne" = null ] && echo null || echo "'$personne'::uuid"),
		$([ "$expediteur" = null ] && echo null || echo "'$expediteur'::uuid"));"
}

echo
echo "Preuves de CRM-063 tranche 2a — le rendu d'un modèle d'email"
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
echo "1. Traçabilité : aucun fichier de la sous-tranche n'est orphelin de sa spécification"
# =================================================================================================

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

# LES CHAPITRES CITÉS DOIVENT EXISTER. Un fichier qui renvoie à un §8.4 absent serait une trace
# morte, et la traçabilité du §5 de `CLAUDE.md` ne serait plus qu'une formalité.
if [ -f "$SPEC" ] \
	&& grep -q '^### 8.3 Contrat de ' "$SPEC" \
	&& grep -q '^### 8.4 CE QU' "$SPEC" \
	&& grep -q '^### 8.5 LES SOURCES NE SE DEVINENT PAS' "$SPEC" \
	&& grep -q '^### 8.6 Le formatage des valeurs non textuelles' "$SPEC" \
	&& grep -q '^### 8.8 Contrat d' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "$SPEC absent ou amputé d'un chapitre cité"
fi

# =================================================================================================
echo
echo "2. Forme des deux fonctions, mesurée dans le CATALOGUE et non relue dans le SQL"
# =================================================================================================
# Lire la migration prouverait ce qui est ÉCRIT ; seul le catalogue dit ce qui est APPLIQUÉ. La
# distinction n'est pas théorique : une migration corrigée mais non rejouée laisserait le fichier
# juste et la base fausse.

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'rendre_modele_email';")" = 1 ]; then
	ok "public.rendre_modele_email existe dans la base"
else
	fail "public.rendre_modele_email ABSENTE — la migration 56 n'a pas été appliquée"
fi

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'app' and p.proname = 'mail_template_substituer';")" = 1 ]; then
	ok "app.mail_template_substituer existe dans la base"
else
	fail "app.mail_template_substituer ABSENTE"
fi

# `SECURITY INVOKER` EST LA PROPRIÉTÉ DONT TOUT LE RESTE DÉPEND. Une fonction livrée
# `security definer` par accident lirait TOUT pour tout le monde, et les refus mesurés par la suite
# pgTAP et par le contrat d'API seraient verts sans rien prouver.
if [ "$(psql_db -c "select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'rendre_modele_email';")" = f ]; then
	ok "le rendu est SECURITY INVOKER : c'est la RLS qui décide"
else
	fail "le rendu est SECURITY DEFINER — il lirait TOUT, pour tout le monde"
fi

if [ "$(psql_db -c "select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'rendre_modele_email';")" = s ]; then
	ok "le rendu est STABLE : il ne fait que lire"
else
	fail "le rendu n'est pas STABLE — il pourrait écrire"
fi

# `anon` DOIT ÊTRE EXCLU (§8.7). Le contrôle NÉGATIF est ici aussi important que les positifs :
# c'est lui qui fige le `401` de la ligne 1 du contrat d'API.
if [ "$(psql_db -c "select has_function_privilege('anon',
	'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute');")" = f ] \
	&& [ "$(psql_db -c "select has_function_privilege('authenticated',
		'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute');")" = t ]; then
	ok "privilèges : authenticated exécute, anon N'EXÉCUTE PAS"
else
	fail "privilèges du rendu inattendus — le 401 de l'anonyme n'est plus garanti"
fi

# =================================================================================================
echo
echo "3. Le rendu, mesuré sur les données RÉELLES du seed"
# =================================================================================================
# Ces contrôles n'appellent pas la suite pgTAP : ils interrogent la base comme un appelant le
# ferait. Une suite verte sur des fixtures qu'elle pose elle-même ne dit rien de ce que le jeu de
# démonstration produit — et c'est le seed que l'écran de 2b ouvrira.

corps=$(rendu 'body_text' "$MODELE_RELANCE" "$AFFAIRE_COMPLETE" "$CONTACT_LEO")
if printf '%s' "$corps" | grep -q 'Bonjour Léo Marchand,' \
	&& printf '%s' "$corps" | grep -q '125000.00 EUR'; then
	ok "le corps est substitué sur l'affaire complète du seed"
else
	fail "le corps n'est pas substitué comme attendu : $corps"
fi

objet=$(rendu 'subject' "$MODELE_RELANCE" "$AFFAIRE_COMPLETE" "$CONTACT_LEO")
if [ "$objet" = 'Où en est Migration ERP Sogexia ?' ]; then
	ok "l'OBJET est substitué, pas seulement le corps"
else
	fail "l'objet rendu est inattendu : $objet"
fi

# LA DÉCISION DU §8.4, MESURÉE SUR LE SEED : la chaîne vide, JAMAIS un tiret.
corps_troue=$(rendu 'body_text' "$MODELE_RELANCE" "$AFFAIRE_SANS_MONTANT" "$CONTACT_LEO")
if printf '%s' "$corps_troue" | grep -q '( EUR)' \
	&& ! printf '%s' "$corps_troue" | grep -q '—'; then
	ok "un trou nul rend la CHAÎNE VIDE, jamais un tiret (§8.4)"
else
	fail "le trou nul n'est pas rendu comme le §8.4 l'exige : $corps_troue"
fi

nuls=$(rendu 'variables_nulles::text' "$MODELE_RELANCE" "$AFFAIRE_SANS_MONTANT" "$CONTACT_LEO")
if printf '%s' "$nuls" | grep -q 'card.amount'; then
	ok "et le trou est NOMMÉ : c'est ce qui rend la chaîne vide acceptable"
else
	fail "card.amount n'est pas inventorié : $nuls"
fi

# LES SOURCES NE SE DEVINENT PAS (§8.5). L'affaire visée PORTE un contact rattaché ; ne pas le
# passer doit faire des trous, et non le choisir à notre place.
sans_contact=$(rendu 'variables_nulles::text' "$MODELE_RELANCE" "$AFFAIRE_COMPLETE")
if printf '%s' "$sans_contact" | grep -q 'contact.full_name'; then
	ok "sans p_contact_id, le rendu ne DEVINE pas le destinataire (§8.5)"
else
	fail "le rendu a deviné un contact — l'affaire en porte un, il ne doit pas le prendre"
fi

# LES DEUX FORMATAGES DU §8.6, mesurés séparément — l'horodatage en UTC est la limite INC-216.
if printf '%s' "$corps" | grep -qE '\b125000\.00\b'; then
	ok "card.amount rend 125000.00 : ni séparateur de milliers, ni symbole (§8.6)"
else
	fail "le formatage du montant a changé sans révision du §8.6"
fi

horodatage=$(psql_db -c "select app.mail_template_substituer('{{card.next_action_at}}',
	jsonb_build_object('card.next_action_at',
		to_char(next_action_at at time zone 'UTC', 'DD/MM/YYYY HH24:MI')))
	from public.cards where id = '$AFFAIRE_COMPLETE';")
if [ "$horodatage" = '24/08/2026 09:00' ]; then
	ok "card.next_action_at rend JJ/MM/AAAA HH:MM en UTC — limite nommée, INC-216"
else
	fail "le formatage de l'horodatage a changé sans révision du §8.6 : $horodatage"
fi

# UN OBJET NON LISIBLE ET UN OBJET INCONNU RENDENT LA MÊME CHOSE (§8.3). Le contrôle porte sur le
# cas INCONNU, le cas MASQUÉ étant mesuré avec les jetons réels par la suite pgTAP et l'API.
if [ "$(psql_db -c "select count(*) from public.rendre_modele_email(
	'00000000-0000-4000-8000-000000000000'::uuid, '$AFFAIRE_COMPLETE'::uuid);")" = 0 ]; then
	ok "un modèle inconnu rend ZÉRO LIGNE, jamais une erreur (§8.3)"
else
	fail "un modèle inconnu ne rend pas zéro ligne"
fi

# LA LISTE FERMÉE RESTE À DOUZE. Le rendu la lit indirectement — la carte de valeurs porte les mêmes
# noms — et un élargissement de l'une sans l'autre ferait un trou que rien ne remplirait jamais.
if [ "$(psql_db -c "select cardinality(app.mail_template_variables());")" = "$VARIABLES_ATTENDUES" ]; then
	ok "la liste fermée porte toujours $VARIABLES_ATTENDUES variables"
else
	fail "la liste fermée a changé de cardinal sans révision du §2.4"
fi

# CHAQUE VARIABLE DE LA LISTE EST CONNUE DE LA CARTE DE VALEURS DU RENDU. Ce contrôle est le seul
# qui relie les deux migrations : une variable ajoutée au §2.4 sans être ajoutée à la carte serait
# ACCEPTÉE à l'écriture et rendrait un trou vide à l'envoi — inventoriée comme nulle pour toujours,
# sur une affaire pourtant complète. Le modèle jetable ci-dessous cite les douze d'un coup.
gabarit=$(psql_db -c "select string_agg('{{' || v || '}}', ' ')
	from unnest(app.mail_template_variables()) as v;")

if [ -z "$gabarit" ]; then
	fail "le gabarit des douze variables n'a pas pu être construit"
else
	# Le modèle jetable et l'expéditeur jetable sont posés, mesurés, puis DÉFAITS par le `rollback`
	# de la même transaction : le seed doit être rendu intact, et le contrôle final le constate.
	#
	# LE SCRIPT PASSE PAR UN FICHIER, ET LA SORTIE D'ERREUR EST CAPTURÉE. Écrit d'abord en
	# here-document nourrissant `psql` par son entrée standard, ce contrôle rendait une chaîne
	# VIDE lorsque le SQL échouait — et le harnais concluait « des variables ne sont pas rendues »
	# en nommant une liste vide, c'est-à-dire un diagnostic qui ne dit rien. Un contrôle dont
	# l'échec ne se distingue pas de son verdict est un contrôle qui ment.
	cat > "$TRAVAIL/couverture.sql" <<-SQL
		begin;
		insert into public.mail_templates (id, workspace_id, name, subject, body_text)
		values ('d0000000-0000-4000-8000-0000000000f1', '$WORKSPACE',
		        'Gabarit jetable du harnais 2a', 'Objet fixe', '$gabarit');
		insert into public.mail_outbound_identities
		    (id, workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security,
		     smtp_username, from_address, from_name, is_default)
		values ('d0000000-0000-4000-8000-0000000000f2', '$WORKSPACE', null,
		        'Expéditeur jetable', 'stalwart', 587, 'none', 'x',
		        'jetable-harnais-2a@p2enjoy.test', 'Expéditeur Jetable', false);
		select coalesce(nullif(array_to_string(r.variables_nulles, ','), ''), 'aucune')
		  from public.rendre_modele_email('d0000000-0000-4000-8000-0000000000f1'::uuid,
		       '$AFFAIRE_COMPLETE'::uuid, '$CONTACT_LEO'::uuid,
		       'd0000000-0000-4000-8000-0000000000f2'::uuid) r;
		rollback;
	SQL
	if ! couverture=$(psql_db -f - < "$TRAVAIL/couverture.sql" 2>&1); then
		fail "le contrôle de couverture n'a pas pu s'exécuter : $(printf '%s' "$couverture" | tail -n 1)"
	elif [ "$couverture" = aucune ]; then
		ok "les $VARIABLES_ATTENDUES variables de la liste sont TOUTES connues de la carte du rendu"
	else
		fail "des variables acceptées à l'écriture ne sont pas rendues : $couverture"
	fi
fi

# =================================================================================================
echo
echo "4. La suite pgTAP et le contrat d'API, rejoués"
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
echo "5. Dégradations RÉELLES : la suite pgTAP sait-elle rougir ?"
# =================================================================================================

# D-A — la volatilité passe de `stable` à `volatile`. La suite doit dénoncer la forme, faute de quoi
# une fonction de lecture pourrait devenir écrivante sans que rien ne le signale.
eprouver_degradation "le rendu devient VOLATILE" \
	'language sql
stable
security invoker' \
	'language sql
volatile
security invoker'

# D-B — la fonction passe en `security definer`. C'EST LA DÉGRADATION LA PLUS GRAVE DU HARNAIS :
# elle ferait lire à tout le monde ce que la RLS ferme, et les refus mesurés ailleurs deviendraient
# des refus imaginaires.
eprouver_degradation "le rendu devient SECURITY DEFINER" \
	'stable
security invoker' \
	'stable
security definer'

# D-C — LA DÉCISION DU §8.4 EST RETIRÉE : un trou nul rend un TIRET au lieu de la chaîne vide. C'est
# l'une des trois branches que le §7.1 posait et que le §8.4 a écartée, et c'est la dégradation qui
# dit si cette décision est éprouvée quelque part. Si la suite restait verte, un futur rendu
# pourrait inventer une valeur sans que rien ne bronche.
eprouver_degradation "un trou nul rend un TIRET au lieu de la chaîne vide" \
	"coalesce(valeurs ->> btrim(trou[1]), '') as morceau" \
	"coalesce(valeurs ->> btrim(trou[1]), '—') as morceau"

# D-D — l'inventaire des trous nuls disparaît. La chaîne vide sans l'inventaire est exactement le
# « mensonge tranquille » que le §8.4 refuse : le défaut n'apparaîtrait qu'à l'envoi.
eprouver_degradation "l'inventaire des trous nuls est toujours VIDE" \
	'		coalesce(
			(
				select array_agg(distinct nom order by nom)' \
	'		coalesce(
			(
				select array_agg(distinct nom order by nom) filter (where false)'

# D-E — l'inventaire cesse d'être BORNÉ aux variables que le modèle emploie : il liste tout ce qui
# est nul, y compris ce que le texte ne cite pas. L'écran de 2b avertirait alors pour un texte qui
# n'en porte pas la trace.
eprouver_degradation "l'inventaire n'est plus borné aux variables du modèle" \
	"					select btrim(trou[1]) as nom
					  from regexp_matches(m.subject || ' ' || m.body_text,
					                      '\\{\\{([^{}]*)\\}\\}', 'g') as trou" \
	"					select v as nom
					  from unnest(app.mail_template_variables()) as v"

# D-F — les blancs de bord cessent d'être tolérés à l'intérieur des accolades. `{{ card.title }}`
# est ACCEPTÉ à l'écriture par la migration 55 ; s'il cessait d'être substitué ici, un modèle
# valide partirait avec un trou vide — la divergence entre refus et rendu que le §8.4 combat.
eprouver_degradation "les blancs de bord ne sont plus tolérés dans un trou" \
	"coalesce(valeurs ->> btrim(trou[1]), '') as morceau" \
	"coalesce(valeurs ->> trou[1], '') as morceau"

# D-G — le privilège d'exécution est rendu à `anon`. C'est le point de sûreté des `alter default
# privileges`, et la suite le mesure par `has_function_privilege`.
eprouver_degradation "le privilège d'exécution est rendu à anon" \
	'grant execute on function public.rendre_modele_email(uuid, uuid, uuid, uuid)
	to authenticated, service_role;' \
	'grant execute on function public.rendre_modele_email(uuid, uuid, uuid, uuid)
	to anon, authenticated, service_role;'

# =================================================================================================
echo
echo "6. La restauration est CONSTATÉE, octet à octet, et la base avec elle"
# =================================================================================================
# Constatée contre l'instantané pris au début, jamais contre `HEAD` : le harnais doit fonctionner
# dans un arbre portant une évolution légitime non encore committée.

if cmp -s "$MIGRATION" "$TRAVAIL/migration.origine"; then
	ok "le fichier de migration est restauré à l'octet près"
else
	fail "le fichier de migration DIFFÈRE de son état initial"
fi

if [ "$(psql_db -c "select has_function_privilege('anon',
		'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute');")" = f ] \
	&& [ "$(psql_db -c "select prosecdef from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public' and p.proname = 'rendre_modele_email';")" = f ]; then
	ok "la base est restaurée : anon n'exécute pas, et le rendu est de nouveau SECURITY INVOKER"
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
