#!/usr/bin/env bash
# @verifies CRM-064 (docs/BACKLOG.md) — @mentions et notifications, TRANCHE 4 : les préférences
# @verifies docs/SPEC-notifications.md §42.1 (il n'y a qu'un canal), §43 (le modèle),
#           §43.4 (l'absence de ligne vaut consentement), §44 (le filtrage est À LA LECTURE),
#           §45 (l'unique écriture de la règle), §46 (autorisations et unique chemin d'écriture),
#           §49 (les preuves attendues)
# @verifies docs/DESIGN_SYSTEM.md §5.45 (l'écran des préférences) ; docs/SCHEMA.md §8
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §16 (vérification visuelle)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée, et Node 24 sourcé (`nvm use`).
#
# CE QUE CE HARNAIS ÉPROUVE, ET QUE LES TROIS AUTRES N'ÉPROUVENT PAS. `verify-mentions.sh` dégrade
# la règle d'ÉLIGIBILITÉ, `verify-notifications-surface.sh` la surface de RÉCEPTION,
# `verify-mentions-composeur.sh` la liaison entre les deux. Celui-ci dégrade ce qui décide si une
# notification produite est MONTRÉE — c'est-à-dire la seule chose qui sépare, pour l'utilisateur,
# une boîte qui marche d'une boîte muette.
#
# LA DÉGRADATION LA PLUS UTILE DE CE HARNAIS EST LA PREMIÈRE, ET ELLE N'A D'ÉQUIVALENT NULLE PART :
# elle retire le `coalesce` de `app.notification_consentie`. Rien ne casse en apparence — la
# fonction existe, la politique délègue, la table est en place, les privilèges sont bons. Mais une
# préférence ABSENTE rend alors `NULL`, qui se comporte comme FAUX dans une politique : l'absence
# de décision COUPE TOUT, et le produit livré cesse de notifier qui que ce soit. Le seed ne posant
# AUCUNE préférence (§48 bis), c'est exactement l'état de tout le monde en production.
#
# LA SECONDE RETIRE LA TROISIÈME CONDITION DE LA POLITIQUE. La table, la fonction et l'écran
# restent debout, l'écriture fonctionne, la case se coche et se décoche — et la préférence ne fait
# plus RIEN. C'est le défaut le plus silencieux que cette tranche puisse porter : l'utilisateur
# croit avoir coupé, et continue de recevoir.
#
# LA TROISIÈME OUVRE L'ÉCRITURE DIRECTE DE LA TABLE. La RPC continue de marcher, l'écran ne change
# pas, et la preuve d'API rougit sur les trois verbes — c'est le refus double du §46.2, dont il
# faut éprouver la moitié « privilège » séparément de la moitié « politique ».

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0067_preferences_notifications.sql
MODULE=webapp/src/lib/preferences-notifications.ts
SURFACE=webapp/src/app/ReglagesNotifications.tsx
NOTIFICATIONS=webapp/src/lib/notifications.ts
SUITE_SQL=supabase/tests/0064_preferences_notifications.test.sql
SUITE_UNITAIRE=webapp/src/lib/preferences-notifications.test.ts
SUITE_RENDU=webapp/src/app/ReglagesNotifications.test.tsx
SUITE_API=e2e/api/preferences-notifications.spec.ts
SUITE_UI=e2e/ui/preferences-notifications.spec.ts
SPEC=docs/SPEC-notifications.md
DESIGN=docs/DESIGN_SYSTEM.md
SCHEMA=docs/SCHEMA.md
PROD=docs/PROD_MIGRATIONS.md

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false
migration_degradee=false

FICHIER_DEGRADE=""
SAUVEGARDE=""

nettoyer() {
	local statut=$?
	set +e
	if [ "$restauration_due" = true ] && [ -n "$SAUVEGARDE" ] && [ -f "$SAUVEGARDE" ]; then
		cp "$SAUVEGARDE" "$FICHIER_DEGRADE"
		printf 'restauration de secours : %s rendu à son état d’origine.\n' "$FICHIER_DEGRADE" >&2
	fi
	# LA BASE AUSSI EST RENDUE, ET C'EST PLUS IMPORTANT QUE LE FICHIER. Une politique laissée sans
	# sa troisième condition serait un produit qui ignore les préférences — invisible à `git diff`,
	# et strictement indétectable en regardant l'écran, qui continuerait de cocher et décocher.
	if [ "$migration_degradee" = true ]; then
		docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
			<"$MIGRATION" >/dev/null 2>&1
		printf 'restauration de secours : la migration 0067 a été rejouée.\n' >&2
	fi
	# LES PRÉFÉRENCES POSÉES PAR LES PREUVES SONT RETIRÉES. Une préférence laissée à faux ferait
	# rougir `e2e/ui/notifications.spec.ts`, qui mesure une cloche à « 1 non lue », et la cause
	# serait introuvable depuis ce fichier-là.
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q \
		-c "delete from public.notification_preferences;" >/dev/null 2>&1
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

suite_api_verte() {
	E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		preferences-notifications >"$TRAVAIL/api.log" 2>&1
}

# Remplace un motif dans un fichier, après en avoir gardé une copie. Le remplacement est VÉRIFIÉ —
# la leçon de la décision 503 : une dégradation qui n'a rien changé laisse le produit intact, la
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

# Dégrade la SURFACE et regarde les suites unitaires rougir.
eprouver_surface() {
	local nom=$1 fichier=$2 avant=$3 apres=$4
	degrader "$fichier" "$avant" "$apres" "$nom" || return 0
	if suites_unitaires_vertes; then
		fail "COMPLAISANT — « $nom » retirée, les suites des préférences restent VERTES"
	else
		ok "dégradation « $nom » : les suites des préférences rougissent, comme elles doivent"
	fi
	restaurer
}

# Dégrade la BASE. `psql` doit avoir ACCEPTÉ la copie dégradée : sans cette vérification, une
# dégradation refusée laisserait le produit intact et le harnais accuserait sa propre suite.
#
# `juge` dit QUI doit rougir : la suite pgTAP, ou le contrat d'API. Les deux ne voient pas la même
# chose — le `coalesce` et la troisième condition de la politique sont INVISIBLES au catalogue, et
# ne se mesurent qu'en lisant sous un jeton réel.
eprouver_base() {
	local nom=$1 juge=$2 avant=$3 apres=$4
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
	if [ "$juge" = pgtap ]; then
		if suite_sql_verte; then
			fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
		else
			ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
		fi
	else
		if suite_api_verte; then
			fail "COMPLAISANT — « $nom » retirée, le contrat d'API reste VERT"
		else
			ok "dégradation « $nom » : le contrat d'API rougit, comme il doit"
		fi
	fi
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
		<"$MIGRATION" >/dev/null 2>&1
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q \
		-c "delete from public.notification_preferences;" >/dev/null 2>&1
	# LES NOTIFICATIONS SONT RENDUES NON LUES, ET C'EST UN DÉFAUT MESURÉ AU PREMIER LANCEMENT.
	# Le contrat d'API éprouve, ligne *f*, qu'une notification masquée NE PEUT PAS être marquée
	# lue — un `204` sans effet. Sous une politique DÉGRADÉE, ce `PATCH` aboutit pour de bon : la
	# preuve laisse alors une notification lue derrière elle, et tout ce qui suit mesure « 1 non
	# lue » au lieu de deux. Une preuve n'est self-restauratrice que tant que le produit est juste ;
	# c'est au harnais, qui casse le produit exprès, de rendre l'état.
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q \
		-c "update public.notifications set read_at = null where read_at is not null;" >/dev/null 2>&1
	migration_degradee=false
}

echo
echo "Preuves de CRM-064 tranche 4 — les préférences de notification"
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

for fichier in "$MIGRATION" "$MODULE" "$SURFACE"; do
	contient "$fichier cite son unité de backlog" "$fichier" 'CRM-064'
done
contient "$SUITE_SQL cite ce qu'elle vérifie" "$SUITE_SQL" '@verifies CRM-064'
contient "$SUITE_UNITAIRE cite ce qu'elle vérifie" "$SUITE_UNITAIRE" '@verifies CRM-064'
contient "$SUITE_RENDU cite ce qu'il vérifie" "$SUITE_RENDU" '@verifies CRM-064'
contient "$SUITE_API cite ce qu'il vérifie" "$SUITE_API" '@verifies CRM-064'
contient "$SUITE_UI cite ce qu'il vérifie" "$SUITE_UI" '@verifies CRM-064'
contient "la spécification porte les chapitres de la tranche" "$SPEC" \
	'## 43. Modèle : `public.notification_preferences`'
contient "la spécification tranche le point ouvert n° 3 du §18" "$SPEC" \
	'## 44. LA DÉCISION QUE LE §18, POINT 3, LAISSAIT OUVERTE'
contient "le design system porte la surface" "$DESIGN" \
	'### 5.45 Écran des préférences de notification'
contient "le schéma décrit la table livrée" "$SCHEMA" '### `notification_preferences`'
contient "le contrat de déploiement porte la migration 67" "$PROD" '| 67 — `CRM-064` |'

# =================================================================================================
echo "2. La règle n'a qu'une seule écriture — §44, raison 3"
# =================================================================================================

contient "la politique DÉLÈGUE à la fonction de consentement" "$MIGRATION" \
	'app.notification_consentie(recipient_id, type)'
# LE MOTIF VISE LE CODE, JAMAIS LA PROSE — la leçon de la sous-tranche 3b : le module EXPLIQUE en
# commentaire qu'il ne filtre rien, et un contrôle écrit sur le nom nu de la table prendrait en
# défaut cette explication même.
absent "le MODULE ne filtre AUCUNE notification (CLAUDE.md §10)" "$MODULE" \
	"from('notifications')"
absent "la SURFACE ne filtre AUCUNE notification non plus" "$SURFACE" \
	"from('notifications')"
contient "la lecture passe par la table, sous SA politique" "$MODULE" \
	"client.from('notification_preferences').select('type, in_app')"
contient "l'écriture passe par la RPC, seul chemin ouvert" "$MODULE" \
	"client.rpc('definir_preference_notification'"
# LE DESTINATAIRE N'EST PAS UN PARAMÈTRE. Un `p_profile_id` ajouté « pour rendre la RPC
# réutilisable » rendrait possible d'écrire pour autrui, et rien d'autre ne le verrait.
absent "aucun destinataire n'est envoyé à la RPC" "$MODULE" 'p_profile_id'
absent "la RPC n'accepte AUCUN paramètre de destinataire" "$MIGRATION" 'p_profile_id'

# =================================================================================================
echo "3. Le modèle et la forme des fonctions, mesurés en base — §43, §45.1, §46.3"
# =================================================================================================

mesurer "la table existe" \
	"select count(*) from pg_class where oid = 'public.notification_preferences'::regclass;" 1
mesurer "sa clé primaire est NATURELLE : (profile_id, type)" \
	"select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.notification_preferences'::regclass and contype = 'p';" \
	"PRIMARYKEY(profile_id,type)"
mesurer "app.notification_consentie est SECURITY INVOKER, jamais DEFINER" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notification_consentie';" f
mesurer "elle est STABLE, jamais IMMUTABLE" \
	"select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notification_consentie';" s
mesurer "la RPC d'écriture est SECURITY DEFINER, par nécessité" \
	"select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'definir_preference_notification';" t
mesurer "anon n'a PAS execute sur la RPC — la leçon de la migration 0053" \
	"select has_function_privilege('anon',
	  'public.definir_preference_notification(text, boolean)', 'EXECUTE');" f
mesurer "authenticated l'a" \
	"select has_function_privilege('authenticated',
	  'public.definir_preference_notification(text, boolean)', 'EXECUTE');" t
# LE PRIVILÈGE D'EXÉCUTION DE LA FONCTION DE LECTURE EST LA LEÇON DE LA DÉCISION 522, et son oubli
# serait bien pire ici : la politique s'évaluant sous le rôle de l'appelant, la cloche cesserait de
# fonctionner pour TOUT LE PRODUIT.
mesurer "authenticated peut exécuter app.notification_consentie (décision 522)" \
	"select has_function_privilege('authenticated',
	  'app.notification_consentie(uuid, text)', 'EXECUTE');" t
mesurer "anon aussi — la politique le nomme dans ses rôles" \
	"select has_function_privilege('anon', 'app.notification_consentie(uuid, text)', 'EXECUTE');" t

# =================================================================================================
echo "4. Le refus double de l'écriture — §46.2"
# =================================================================================================

mesurer "UNE seule politique sur la table, en lecture" \
	"select count(*) from pg_policy where polrelid = 'public.notification_preferences'::regclass;" 1
for verbe in INSERT UPDATE DELETE; do
	mesurer "authenticated n'a PAS $verbe" \
		"select has_table_privilege('authenticated', 'public.notification_preferences', '$verbe');" f
done
mesurer "anon a SELECT — le refus est zéro ligne, jamais une erreur" \
	"select has_table_privilege('anon', 'public.notification_preferences', 'SELECT');" t
mesurer "la table n'est PAS publiée au temps réel — §46.4" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'notification_preferences';" 0

# =================================================================================================
echo "5. Il n'y a qu'un canal — §42.1"
# =================================================================================================
# AUCUNE COLONNE POUR UN CANAL QUI N'EXISTE PAS. Une colonne `channel` à une seule valeur ne
# garderait rien — l'argument du §13.3 ne vaut que pour `type` —, et une case « par email » serait
# une promesse fausse.

mesurer "la table porte QUATRE colonnes, et pas une de plus" \
	"select count(*) from information_schema.columns
	  where table_schema = 'public' and table_name = 'notification_preferences';" 4
# LE MOTIF VISE LE CODE, JAMAIS LA PROSE, et le harnais s'est pris LUI-MÊME à ce piège au premier
# lancement : écrit sur le mot `channel` nu, ce contrôle rougissait sur le COMMENTAIRE de la
# migration, qui explique précisément qu'une colonne `channel` à une seule valeur ne garderait
# rien. Un contrôle qui prend en défaut la prose expliquant la règle ne mesure pas la règle — la
# même leçon que la sous-tranche 3b, apprise une seconde fois.
mesurer "aucune colonne de canal dans la table" \
	"select count(*) from information_schema.columns
	  where table_schema = 'public' and table_name = 'notification_preferences'
	    and column_name in ('channel', 'email', 'digest');" 0
absent "aucune case « email » dans la surface" "$SURFACE" 'email'
contient "le §8 du schéma ne promet plus trois canaux" "$SCHEMA" \
	"**Il n'y a qu'un canal**"

# =================================================================================================
echo "6. Le seed ne pose AUCUNE préférence — §48 bis"
# =================================================================================================
# ET C'EST UNE DÉCISION : poser trois lignes à vrai serait poser trois lignes qui ne changent rien,
# et un écran qui les rendrait ne montrerait pas l'état par défaut réel d'un compte neuf.

mesurer "aucune préférence en base" "select count(*) from public.notification_preferences;" 0
mesurer "deux notifications, toutes deux non lues" \
	"select count(*) from public.notifications where read_at is null;" 2
mesurer "le défaut est « je reçois », sans aucune ligne" \
	"select app.notification_consentie('5eed0000-0000-4000-8000-000000000012'::uuid, 'mention');" t

# =================================================================================================
echo "7. Les preuves passent AVANT toute dégradation"
# =================================================================================================

if suite_sql_verte; then
	ok "la suite pgTAP est verte au départ"
else
	fail "la suite pgTAP est ROUGE au départ — rien de ce qui suit n'aurait de sens"
fi
if suites_unitaires_vertes; then
	ok "les suites unitaires sont vertes au départ"
else
	fail "les suites unitaires sont ROUGES au départ"
fi
if suite_api_verte; then
	ok "le contrat d'API est vert au départ"
else
	fail "le contrat d'API est ROUGE au départ"
fi

# =================================================================================================
echo "8. Dégradations — un harnais qui ne mord pas ne prouve rien"
# =================================================================================================

# D-A. LA DÉGRADATION SANS ÉQUIVALENT AILLEURS. Le `coalesce` retiré, une préférence ABSENTE rend
# NULL, qui se comporte comme FAUX dans une politique : l'absence de décision COUPE TOUT. Rien ne
# casse en apparence — la fonction existe, la politique délègue, les privilèges sont bons —, et le
# seed ne posant aucune préférence, c'est l'état de TOUT LE MONDE en production.
eprouver_base "le coalesce du défaut « je reçois » (§43.4)" pgtap \
	'	select coalesce(
		(select np.in_app
		   from public.notification_preferences np
		  where np.profile_id = p_destinataire
		    and np.type       = p_type),
		true);' \
	'	select (select np.in_app
	          from public.notification_preferences np
	         where np.profile_id = p_destinataire
	           and np.type       = p_type);'

# D-B. LA TROISIÈME CONDITION RETIRÉE, LA PRÉFÉRENCE NE FAIT PLUS RIEN. C'est le défaut le plus
# SILENCIEUX que cette tranche puisse porter : la table est là, l'écriture marche, la case se coche
# et se décoche, et l'utilisateur qui croit avoir coupé continue de recevoir. Aucune assertion de
# catalogue ne le verrait : seul un jeton réel qui LIT peut le mesurer.
eprouver_base "la troisième condition de notifications_lecture (§45.2)" api \
	'		and app.notification_consentie(recipient_id, type)' \
	'		and true'

# D-C. L'ÉCRITURE DIRECTE OUVERTE. La RPC continue de marcher, l'écran ne change pas — et les trois
# verbes que le §46.2 refuse deviennent possibles. C'est la moitié « privilège » du refus double,
# éprouvée séparément de la moitié « politique ».
eprouver_base "le refus de privilège de l'écriture directe (§46.2)" api \
	'grant select         on public.notification_preferences to authenticated;' \
	'grant select, insert, update, delete on public.notification_preferences to authenticated;'

# D-D. LA POLITIQUE DE LECTURE OUVERTE À TOUS. La préférence d'autrui devient observable — le motif
# même de la table séparée (§43.1, M7). Rien d'autre ne change.
eprouver_base "la politique qui garde une préférence PRIVÉE (§43.1)" api \
	'	using (profile_id = (select auth.uid()));' \
	'	using (true);'

# D-E. LA DATE N'EST PLUS IMPOSÉE. Le trigger retiré, une date antidatée survit — et la suite pgTAP
# la mesure sous le PROPRIÉTAIRE, c'est-à-dire par le chemin exact du seed et des harnais.
eprouver_base "le trigger qui impose la date (§43.2)" pgtap \
	'	new.updated_at := now();' \
	'	new.updated_at := coalesce(new.updated_at, now());'

# D-F. LE DÉFAUT DE L'ÉCRAN INVERSÉ. Une préférence absente afficherait une case DÉCOCHÉE, faisant
# croire à chacun qu'il a coupé ce qu'il n'a pas coupé.
eprouver_surface "le défaut « je reçois » DANS L'ÉCRAN (§43.4)" "$MODULE" \
	'			recevoirDansApplication: ligne?.in_app ?? true,' \
	'			recevoirDansApplication: ligne?.in_app ?? false,'

# D-G. LA CASE COCHÉE PAR ANTICIPATION. L'écran afficherait la valeur DEMANDÉE au lieu de celle que
# la base a retenue — un état que l'utilisateur voit et qui n'existe pas (§5.45).
eprouver_surface "la case cochée d'après la BASE, jamais d'après la demande (§46.3)" "$MODULE" \
	'			preference: { type, recevoirDansApplication: ligne.in_app },' \
	'			preference: { type, recevoirDansApplication },'

# D-H. LA CLOCHE N'EST PLUS PRÉVENUE. C'est le défaut que la preuve E2E a trouvé, remis en place :
# le compteur de l'en-tête reste à sa valeur d'avant jusqu'au rechargement de la page.
eprouver_surface "la cloche prévenue d'un changement d'ensemble lisible" "$SURFACE" \
	'			relireBoiteNotifications()' \
	'			void 0'

# D-I. LES TROIS REFUS NOMMÉS CONFONDUS. « Mettez à jour l'application » et « reconnectez-vous »
# demandent deux gestes différents ; les confondre rend un message faux.
eprouver_surface "les refus nommés restent DISTINCTS (CLAUDE.md §18)" "$MODULE" \
	"		if (detail === SYMBOLE_SANS_SESSION) return { nature: 'sans-session', detail }" \
	"		if (detail === SYMBOLE_SANS_SESSION) return { nature: 'type-inconnu', detail }"

# =================================================================================================
echo "9. La restauration est CONSTATÉE, pas supposée"
# =================================================================================================

if git diff --quiet -- "$MODULE" "$SURFACE" "$NOTIFICATIONS"; then
	ok "après restauration : aucun écart au dépôt sur les fichiers dégradés"
else
	fail "après restauration : « git diff » signale un écart — un fichier n'a PAS été rendu"
fi

if suite_sql_verte; then
	ok "après restauration : la suite pgTAP est VERTE — la base est rendue"
else
	fail "après restauration : la suite pgTAP reste ROUGE, la base n'a PAS été rendue"
fi

if suites_unitaires_vertes; then
	ok "après restauration : les suites unitaires sont VERTES — le produit est rendu"
else
	fail "après restauration : les suites unitaires restent ROUGES, le produit n'a PAS été rendu"
fi

if suite_api_verte; then
	ok "après restauration : le contrat d'API est VERT"
else
	fail "après restauration : le contrat d'API reste ROUGE"
fi

# =================================================================================================
echo "10. Le seed est intact — §48 bis"
# =================================================================================================

mesurer "aucune préférence résiduelle" "select count(*) from public.notification_preferences;" 0
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
