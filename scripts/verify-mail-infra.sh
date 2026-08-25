#!/usr/bin/env bash
# @verifies CRM-050 (docs/BACKLOG.md) — Definition of Done de l'infrastructure mail de développement
# @verifies docs/SPEC-mail-subsystem.md §11.2 (composants et placement), §11.3 (configuration),
#           §11.4 (domaines et boîtes), §11.6 (ClamAV), §11.7 (variables), §11.8 (ports),
#           §11.9 (preuves exigées)
# @verifies docs/JOURNAL.md décision 235 (les trois pannes), décision 236 (placement de ClamAV),
#           décision 237 (les deux domaines convergent), décision 239 (pas de boîte pour le
#           `viewer`), décision 245 (démarrage déterministe et journal Stalwart propre)
# @verifies README.md §6 (services exposés en développement) ; CLAUDE.md §3 (variables documentées)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. la configuration versionnée respecte ses invariants — aucune liaison `[::]`, quatre
#      listeners, traceur `stdout`, aucun secret en clair ;
#   2. les quatre services sont déclarés dans l'overlay de DÉVELOPPEMENT, et aucun n'apparaît
#      dans l'assemblage de production ;
#   3. les dix variables sont déclarées dans `.env.example` avec leur rôle, leur format et leur
#      caractère obligatoire, et renseignées dans `.env` ;
#   4. le domaine des cards de `.env` est CELUI QUE LA BASE PORTE — décision 237 ;
#   5. les conteneurs tournent, sont sains, et le provisionnement s'est terminé en succès ;
#   6. les boîtes existent avec leur rôle, le catch-all est déclaré, le `viewer` n'a pas de boîte ;
#   7. un client IMAP réel ouvre une session sur chacune des trois boîtes ;
#   8. `clamd` répond et DÉTECTE la signature de test, ce qu'un simple `PING` ne prouve pas ;
#   9. Roundcube sert son formulaire de connexion ;
#  10. aucun secret réel n'est versionné, et le mot de passe d'administration tiré au hasard
#      n'apparaît nulle part dans le dépôt ;
#  11. chaque fichier livré par l'unité porte son commentaire de traçabilité ;
#  12. `README.md` §6 annonce exactement les ports que `.env.example` déclare.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun aller-retour d'email complet** : la remise d'un message par le catch-all et
# sa relecture sont l'objet de `e2e/mail/infrastructure.spec.ts`, et l'ingestion par le produit
# reste due par `CRM-054`. Il ne prouve **aucun écran** : c'est l'objet de
# `e2e/mail/roundcube.spec.ts`.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-mail-infra.sh
#   scripts/verify-mail-infra.sh --contre-epreuve   dégrade une COPIE des fichiers versionnés et
#                                                   exige que le harnais morde ; ne touche jamais
#                                                   au dépôt

set -euo pipefail

cd "$(dirname "$0")/.."

RACINE=$PWD
DB_CONTAINER=p2enjoy-db

CONTRE_EPREUVE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--contre-epreuve) CONTRE_EPREUVE=true ;;
		--help|-h) sed -n '2,45p' "$0"; exit 0 ;;
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

lire_env() {
	local nom=$1 fichier=${2:-$RACINE/.env}
	sed -n "s/^${nom}=//p" "$fichier" | head -1
}

# Les dix variables que l'unité introduit, et le port du conteneur qu'elles publient lorsqu'elles
# en publient un (docs/SPEC-mail-subsystem.md §11.7 et §11.8) — plus l'onzième, ajoutée par
# `CRM-060` sous-tranche 2 bis et commentée à sa place dans la liste.
VARIABLES=(
	STALWART_IMAP_PORT
	STALWART_SMTP_PORT
	STALWART_SUBMISSION_PORT
	STALWART_ADMIN_PORT
	STALWART_ADMIN_USER
	STALWART_ADMIN_PASSWORD
	STALWART_MAILBOX_PASSWORD
	MAIL_DEV_PERSONAL_DOMAIN
	ROUNDCUBE_PORT
	CLAMAV_PORT
	# ONZIÈME, ET ELLE N'EST PAS DE `CRM-050` : `CRM-060` sous-tranche 2 bis l'introduit pour la
	# boîte du correspondant de démonstration (docs/SPEC-mail-subsystem.md §11.4). Elle est
	# vérifiée ICI parce que c'est ce provisionnement-ci qui la consomme, et qu'une variable
	# gouvernant une boîte sans harnais qui la réclame disparaîtrait sans bruit.
	MAIL_DEV_CORRESPONDENT_ADDRESS
)

# Fichiers livrés par l'unité, et le marqueur de traçabilité attendu (CLAUDE.md §5).
TRACABILITE=(
	"stalwart/config.toml|@spec CRM-050"
	"stalwart/provision.sh|@spec CRM-050"
	"stalwart/webadmin-disabled/index.html|@spec CRM-050"
	"stalwart/config.test.ts|@verifies CRM-050"
	"e2e/mail/protocoles.ts|@spec CRM-050"
	"e2e/mail/infrastructure.spec.ts|@verifies CRM-050"
	"e2e/mail/roundcube.spec.ts|@verifies CRM-050"
	"scripts/verify-mail-infra.sh|@verifies CRM-050"
)

# ---------------------------------------------------------------------------------------------
# Famille 1 — la configuration versionnée.
# ---------------------------------------------------------------------------------------------
# Isolée dans une fonction paramétrée par sa racine : la contre-épreuve la rejoue sur une COPIE
# dégradée, sans jamais toucher au dépôt.

controles_fichiers() {
	local racine=$1
	local config="$racine/stalwart/config.toml"
	local dev="$racine/docker-compose.dev.yml"
	local prod="$racine/docker-compose.prod.yml"
	local exemple="$racine/.env.example"
	local readme="$racine/README.md"
	local webadmin_source="$racine/stalwart/webadmin-disabled/index.html"
	local webadmin_zip="$racine/stalwart/webadmin-disabled.zip"

	titre "1. Configuration versionnée de Stalwart"

	if [ -f "$config" ]; then
		ok "stalwart/config.toml est versionné"
	else
		fail "stalwart/config.toml absent"
		return
	fi

	# LE contrôle de l'unité : une liaison `[::]` arrête le serveur sans écrire une ligne
	# (docs/JOURNAL.md décision 235).
	if grep -q 'bind = "\[::\]' "$config"; then
		fail "une liaison vise « [::] » : le serveur s'arrêterait en silence sans IPv6"
	else
		ok "aucune liaison ne vise « [::] »"
	fi

	local liaisons_non_conformes
	liaisons_non_conformes=$(grep -c '^bind = "' "$config" || true)
	local liaisons_conformes
	liaisons_conformes=$(grep -c '^bind = "0\.0\.0\.0:' "$config" || true)
	if [ "$liaisons_non_conformes" -gt 0 ] && [ "$liaisons_non_conformes" -eq "$liaisons_conformes" ]; then
		ok "les $liaisons_conformes liaisons visent explicitement 0.0.0.0"
	else
		fail "liaisons non conformes : $liaisons_conformes sur $liaisons_non_conformes visent 0.0.0.0"
	fi

	local listeners
	listeners=$(grep -o '^\[server\.listener\.[a-z0-9-]*\]' "$config" | sed 's/.*listener\.//; s/\]//' | sort | tr '\n' ' ')
	if [ "$listeners" = "http imap smtp submission " ]; then
		ok "quatre listeners déclarés, et pas un de plus : $listeners"
	else
		fail "listeners inattendus : « $listeners » au lieu de « http imap smtp submission »"
	fi

	if grep -q '^\[tracer\.stdout\]' "$config" && ! grep -q '^\[tracer\.log\]' "$config"; then
		ok "le traceur écrit sur la sortie standard, et aucun traceur fichier n'est déclaré"
	else
		fail "traceur non conforme : stdout attendu, aucun traceur fichier"
	fi

	# Aucun secret en clair : toute affectation `secret` ou `password` doit être une macro.
	local secrets_en_clair
	secrets_en_clair=$(grep -iE '^[[:space:]]*(secret|password)[[:space:]]*=' "$config" \
		| grep -vcE '=[[:space:]]*"%\{env:[A-Z0-9_]+\}%"' || true)
	if [ "$secrets_en_clair" -eq 0 ]; then
		ok "aucun secret en clair dans la configuration"
	else
		fail "$secrets_en_clair affectation(s) de secret ne passent pas par une macro d'environnement"
	fi

	if grep -qE '\$[0-9a-z]+\$[^[:space:]"]{8,}' "$config"; then
		fail "une empreinte de mot de passe est versionnée dans la configuration"
	else
		ok "aucune empreinte de mot de passe pré-calculée"
	fi

	if grep -q 'resource = "file:///opt/stalwart/etc/webadmin-disabled.zip"' "$config" \
		&& grep -q 'config.local-keys.15 = "webadmin.resource"' "$config" \
		&& ! grep -q 'releases/latest' "$config"; then
		ok "la ressource webadmin est locale, déterministe et explicitement locale pour Stalwart"
	else
		fail "la ressource webadmin peut encore dépendre d'une release mouvante ou produire un avertissement"
	fi

	if [ -f "$webadmin_source" ] && [ -f "$webadmin_zip" ] \
		&& head -c 4 "$webadmin_zip" | grep -aq $'PK\003\004' \
		&& grep -aq '<h1>Console Stalwart désactivée</h1>' "$webadmin_zip"; then
		ok "le bundle webadmin est un ZIP réel contenant la page explicative versionnée"
	else
		fail "bundle webadmin absent, invalide ou divergent de sa page source"
	fi

	if ! grep -qE '^\[(session|imap)\.auth\]' "$config" \
		&& grep -q '/api/settings' "$racine/stalwart/provision.sh" \
		&& grep -q '/api/reload' "$racine/stalwart/provision.sh"; then
		ok "les réglages IMAP/SMTP modifiables passent par l'API puis le rechargement"
	else
		fail "des réglages modifiables restent locaux, ou leur provisionnement API manque"
	fi

	titre "2. Placement des services — développement seulement"

	local service
	for service in stalwart stalwart-init roundcube clamav; do
		if grep -qE "^  ${service}:$" "$dev"; then
			ok "le service « $service » est déclaré dans l'overlay de développement"
		else
			fail "le service « $service » manque à l'overlay de développement"
		fi
		# `docker-compose.prod.yml` ne doit connaître aucun d'eux : la production lit les
		# serveurs des utilisateurs (docs/DAT.md §3.6, docs/JOURNAL.md décision 236).
		if grep -qE "^  ${service}:$" "$prod"; then
			fail "le service « $service » apparaît dans l'assemblage de PRODUCTION"
		else
			ok "le service « $service » n'apparaît pas dans l'assemblage de production"
		fi
	done

	local meta_bloc stalwart_bloc
	meta_bloc=$(awk '
		/^  meta:$/ { dans_service = 1 }
		dans_service && !/^  meta:$/ && /^  [[:alnum:]_-]+:$/ { exit }
		dans_service { print }
	' "$dev")
	if grep -q 'start_period: 20s' <<<"$meta_bloc"; then
		ok "Meta dispose de sa fenêtre de démarrage mesurée de 20 secondes"
	else
		fail "Meta n'a pas la fenêtre de démarrage qui évite son faux négatif à froid"
	fi

	stalwart_bloc=$(awk '
		/^  stalwart:$/ { dans_service = 1 }
		dans_service && !/^  stalwart:$/ && /^  [[:alnum:]_-]+:$/ { exit }
		dans_service { print }
	' "$dev")
	if grep -q './stalwart/webadmin-disabled.zip:/opt/stalwart/etc/webadmin-disabled.zip:ro' \
		<<<"$stalwart_bloc"; then
		ok "Stalwart monte le bundle webadmin local en lecture seule"
	else
		fail "Stalwart ne monte pas le bundle webadmin local en lecture seule"
	fi

	titre "3. Contrat des variables d'environnement"

	local nom
	for nom in "${VARIABLES[@]}"; do
		if grep -qE "^${nom}=" "$exemple"; then
			ok "$nom est déclarée dans .env.example"
		else
			fail "$nom manque à .env.example"
			continue
		fi
		# Chaque variable doit être documentée : rôle, format, caractère obligatoire
		# (CLAUDE.md §3). Le commentaire précède immédiatement la déclaration.
		local doc
		doc=$(awk -v cible="^${nom}=" '
			/^#/ { bloc = bloc $0 " "; next }
			$0 ~ cible { print bloc; exit }
			{ bloc = "" }
		' "$exemple")
		if [[ "$doc" == *"Format :"* && "$doc" == *"Requise :"* ]]; then
			ok "$nom est documentée (format et caractère obligatoire)"
		else
			fail "$nom n'est pas documentée : « Format : » et « Requise : » attendus"
		fi
	done

	titre "4. README §6 annonce les ports réellement déclarés"

	local attendus=(
		"STALWART_IMAP_PORT|IMAP"
		"STALWART_SMTP_PORT|SMTP"
		"ROUNDCUBE_PORT|Roundcube"
	)
	local couple valeur etiquette
	for couple in "${attendus[@]}"; do
		nom=${couple%%|*}
		etiquette=${couple##*|}
		valeur=$(lire_env "$nom" "$exemple")
		if grep -q "$valeur" "$readme"; then
			ok "README.md cite le port $valeur ($etiquette)"
		else
			fail "README.md ne cite pas le port $valeur ($etiquette), déclaré par $nom"
		fi
	done

	titre "5. Traçabilité des fichiers livrés"

	local entree fichier marqueur
	for entree in "${TRACABILITE[@]}"; do
		fichier=${entree%%|*}
		marqueur=${entree##*|}
		if [ ! -f "$racine/$fichier" ]; then
			fail "$fichier absent"
		elif grep -q "$marqueur" "$racine/$fichier"; then
			ok "$fichier porte « $marqueur »"
		else
			fail "$fichier ne porte pas « $marqueur »"
		fi
	done
}

# ---------------------------------------------------------------------------------------------
# Contre-épreuve : le harnais doit MORDRE sur une copie dégradée.
# ---------------------------------------------------------------------------------------------
# Cinq dégradations, une par famille de contrôle. Un harnais qui ne rendrait aucune anomalie sur
# cette copie serait complaisant, et sa couleur verte ne vaudrait rien.

if [ "$CONTRE_EPREUVE" = true ]; then
	COPIE=$(mktemp -d)
	trap 'rm -rf "$COPIE"' EXIT
	mkdir -p "$COPIE/stalwart/webadmin-disabled" "$COPIE/e2e/mail" "$COPIE/scripts"
	cp stalwart/config.toml stalwart/provision.sh stalwart/config.test.ts "$COPIE/stalwart/"
	cp stalwart/webadmin-disabled.zip "$COPIE/stalwart/"
	cp stalwart/webadmin-disabled/index.html "$COPIE/stalwart/webadmin-disabled/"
	cp e2e/mail/protocoles.ts e2e/mail/infrastructure.spec.ts e2e/mail/roundcube.spec.ts "$COPIE/e2e/mail/"
	cp scripts/verify-mail-infra.sh "$COPIE/scripts/"
	cp docker-compose.dev.yml docker-compose.prod.yml .env.example README.md "$COPIE/"

	printf '\033[1mContre-épreuve : cinq dégradations posées sur une copie\033[0m\n'
	# 1. La liaison IPv6 qui tue le serveur en silence.
	sed -i 's|bind = "0\.0\.0\.0:143"|bind = "[::]:143"|' "$COPIE/stalwart/config.toml"
	info "1. la liaison IMAP repasse en « [::] »"
	# 2. Un secret en clair dans la configuration.
	sed -i 's|secret = "%{env:STALWART_ADMIN_PASSWORD}%"|secret = "motdepasse-en-clair"|' \
		"$COPIE/stalwart/config.toml"
	info "2. le secret d'administration est écrit en clair"
	# 3. ClamAV réapparaît dans l'assemblage de production.
	printf '\n  clamav:\n    restart: always\n' >> "$COPIE/docker-compose.prod.yml"
	info "3. « clamav » est déclaré dans l'assemblage de production"
	# 4. Une variable perd sa documentation.
	sed -i 's|^# Port du webmail de contrôle Roundcube. Format : entier 1-65535.|# Port du webmail.|' \
		"$COPIE/.env.example"
	sed -i 's|^# Requise : oui en développement.\nROUNDCUBE_PORT|ROUNDCUBE_PORT|' "$COPIE/.env.example"
	info "4. ROUNDCUBE_PORT perd son format documenté"
	# 5. Un fichier livré perd sa traçabilité.
	sed -i 's|@verifies CRM-050|@verifies CRM-XXX|g' "$COPIE/e2e/mail/roundcube.spec.ts"
	info "5. e2e/mail/roundcube.spec.ts perd son marqueur @verifies"

	controles_fichiers "$COPIE"

	printf '\n\033[1mRésultat de la contre-épreuve\033[0m\n'
	info "$checks contrôles, $failures anomalie(s) sur la copie dégradée"
	if [ "$failures" -ge 5 ]; then
		printf '  \033[32mLe harnais mord : %s anomalies pour 5 dégradations.\033[0m\n' "$failures"
		exit 0
	fi
	printf '  \033[31mHARNAIS COMPLAISANT : %s anomalie(s) seulement pour 5 dégradations.\033[0m\n' "$failures"
	exit 1
fi

controles_fichiers "$RACINE"

# ---------------------------------------------------------------------------------------------
# Famille 6 — les conteneurs réellement en marche.
# ---------------------------------------------------------------------------------------------

titre "6. Conteneurs de la messagerie de développement"

etat_conteneur() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo absent; }
sante_conteneur() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sans{{end}}' "$1" 2>/dev/null || echo absent; }

for conteneur in p2enjoy-stalwart p2enjoy-roundcube p2enjoy-clamav; do
	if [ "$(etat_conteneur "$conteneur")" = running ]; then
		ok "$conteneur tourne"
	else
		fail "$conteneur ne tourne pas (état : $(etat_conteneur "$conteneur"))"
	fi
	if [ "$(sante_conteneur "$conteneur")" = healthy ]; then
		ok "$conteneur est sain"
	else
		fail "$conteneur n'est pas sain (santé : $(sante_conteneur "$conteneur"))"
	fi
done

# Le provisionnement est un service jetable : sa sortie en succès EST la preuve qu'il a abouti.
code_init=$(docker inspect -f '{{.State.ExitCode}}' p2enjoy-stalwart-init 2>/dev/null || echo absent)
if [ "$code_init" = 0 ]; then
	ok "p2enjoy-stalwart-init s'est terminé en succès"
else
	fail "p2enjoy-stalwart-init n'a pas abouti (code de sortie : $code_init)"
fi

if docker logs p2enjoy-stalwart-init 2>&1 | grep -q 'Quatre boîtes provisionnées et relues'; then
	ok "le provisionnement a relu ce qu'il a écrit"
else
	fail "le provisionnement n'a pas relu ce qu'il a écrit"
fi

if docker logs p2enjoy-stalwart-init 2>&1 \
	| grep -q 'réglages IMAP/SMTP et ressource webadmin — relus'; then
	ok "le provisionnement a écrit et relu les réglages et la ressource modifiables"
else
	fail "le provisionnement n'a pas relu les réglages IMAP/SMTP et la ressource webadmin"
fi

if docker logs p2enjoy-stalwart-init 2>&1 | grep -q 'bundle webadmin local — chargé'; then
	ok "le provisionnement a rendu le bundle webadmin convergent sans supprimer les mails"
else
	fail "le provisionnement n'a pas chargé le bundle webadmin local"
fi

# ---------------------------------------------------------------------------------------------
# Famille 7 — les deux domaines convergent (décision 237).
# ---------------------------------------------------------------------------------------------

titre "7. Le domaine des cards de .env est celui que la base porte"

DOMAINE_ENV=$(lire_env CRM_INBOUND_DOMAIN)
DOMAINE_PERSO=$(lire_env MAIL_DEV_PERSONAL_DOMAIN)

if [ "$(etat_conteneur "$DB_CONTAINER")" = running ]; then
	DOMAINE_BASE=$(psql_db -c "select coalesce(inbound_domain, '') from workspaces where slug = 'p2enjoy'" | head -1 | tr -d '\r')
	if [ -z "$DOMAINE_BASE" ]; then
		fail "le workspace seedé n'a pas de inbound_domain : le seed est-il appliqué ?"
	elif [ "$DOMAINE_BASE" = "$DOMAINE_ENV" ]; then
		ok "CRM_INBOUND_DOMAIN et workspaces.inbound_domain valent tous deux « $DOMAINE_ENV »"
	else
		fail "divergence : .env dit « $DOMAINE_ENV », la base dit « $DOMAINE_BASE » — la boîte système n'attraperait rien"
	fi
else
	fail "$DB_CONTAINER ne tourne pas : la comparaison des domaines est impossible"
fi

# ---------------------------------------------------------------------------------------------
# Famille 8 — les boîtes, lues par l'API de gestion.
# ---------------------------------------------------------------------------------------------

titre "8. Domaines et boîtes provisionnés"

API="http://$(lire_env DEV_BIND_ADDRESS):$(lire_env STALWART_ADMIN_PORT)"
ADMIN="$(lire_env STALWART_ADMIN_USER):$(lire_env STALWART_ADMIN_PASSWORD)"
BOITE_SYSTEME="systeme@$DOMAINE_ENV"
# LA QUATRIÈME BOÎTE N'EST PAS UNE BOÎTE DU WORKSPACE — `CRM-060` sous-tranche 2 bis,
# docs/SPEC-mail-subsystem.md §11.4. C'est celle du correspondant de démonstration, qui n'existe
# que pour ÉMETTRE ; elle est vérifiée comme les trois autres, et une famille dédiée plus bas
# constate qu'elle ne devient PAS un compte entrant du produit.
CORRESPONDANT=$(lire_env MAIL_DEV_CORRESPONDENT_ADDRESS)
DOMAINE_CORRESPONDANT=${CORRESPONDANT#*@}
BOITES=("$BOITE_SYSTEME" "admin@$DOMAINE_PERSO" "bizdev@$DOMAINE_PERSO" "$CORRESPONDANT")

api() { curl -sS --noproxy '*' -u "$ADMIN" "$API$1"; }

if api '/api/settings/list?prefix=session.auth' | grep -q '"mechanisms":"\[plain, login\]"' \
	&& api '/api/settings/list?prefix=imap.auth' | grep -q '"allow-plain-text":"true"' \
	&& api '/api/settings/list?prefix=auth.dkim' | grep -q '"sign":"false"' \
	&& api '/api/settings/list?prefix=auth.arc' | grep -q '"seal":"false"' \
	&& api '/api/settings/list?prefix=webadmin' \
		| grep -q 'file:///opt/stalwart/etc/webadmin-disabled.zip'; then
	ok "l'API relit les réglages IMAP/SMTP, les signatures désactivées et la ressource webadmin"
else
	fail "l'API ne relit pas tous les réglages IMAP/SMTP, de signature et webadmin attendus"
fi

if curl -sS --noproxy '*' "$API/" | grep -q '<h1>Console Stalwart désactivée</h1>'; then
	ok "la racine Stalwart sert la page locale explicative"
else
	fail "la racine Stalwart ne sert pas la page locale explicative"
fi

code_anonyme=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' "$API/api/principal" || echo 000)
if [ "$code_anonyme" = 401 ]; then
	ok "l'API de gestion refuse une requête anonyme (401)"
else
	fail "l'API de gestion rend $code_anonyme à une requête anonyme, 401 attendu"
fi

for domaine in "$DOMAINE_ENV" "$DOMAINE_PERSO" "$DOMAINE_CORRESPONDANT"; do
	if api "/api/principal?types=domain&fields=name" | grep -q "\"$domaine\""; then
		ok "le domaine $domaine est déclaré"
	else
		fail "le domaine $domaine n'est pas déclaré"
	fi
done

for boite in "${BOITES[@]}"; do
	lue=$(api "/api/principal/$boite")
	if printf '%s' "$lue" | grep -q '"roles":\["user"\]'; then
		ok "la boîte $boite existe et porte le rôle « user »"
	else
		fail "la boîte $boite manque, ou n'a pas le rôle « user » — elle s'authentifierait sans rien pouvoir faire"
	fi
done

if api "/api/principal/$BOITE_SYSTEME" | grep -q "\"@$DOMAINE_ENV\""; then
	ok "la boîte système porte le catch-all « @$DOMAINE_ENV »"
else
	fail "la boîte système ne porte pas le catch-all « @$DOMAINE_ENV »"
fi

# LE CORRESPONDANT N'EST PAS UN COMPTE ENTRANT DU PRODUIT — `CRM-060` sous-tranche 2 bis. Le
# CRM ne relève jamais dans sa boîte ; l'y inscrire en ferait une boîte du workspace, ce qu'il
# n'est pas (docs/SPEC-mail-subsystem.md §11.4). Le contrôle est NON COMPLAISANT : il compte les
# lignes, il ne se contente pas de l'absence d'erreur.
if [ "$(etat_conteneur "$DB_CONTAINER")" = running ]; then
	comptes_correspondant=$(psql_db -c "select count(*) from mail_inbound_accounts
	                                    where imap_username = '$CORRESPONDANT'" | head -1 | tr -d '\r ')
	if [ "$comptes_correspondant" = 0 ]; then
		ok "la boîte du correspondant n'est pas un compte entrant du produit"
	else
		fail "la boîte du correspondant est déclarée comme compte entrant ($comptes_correspondant ligne(s)) : le CRM relèverait dans une boîte qui n'est pas la sienne"
	fi
else
	fail "$DB_CONTAINER ne tourne pas : le compte entrant du correspondant ne peut pas être écarté"
fi

# Farida Nowak lit ; elle ne correspond pas (docs/JOURNAL.md décision 239).
if api "/api/principal?types=individual&fields=name" | grep -q "viewer@$DOMAINE_PERSO"; then
	fail "une boîte existe pour le « viewer », que la décision 239 exclut"
else
	ok "le « viewer » n'a pas de boîte, conformément à la décision 239"
fi

# ---------------------------------------------------------------------------------------------
# Famille 9 — les protocoles, exercés par de vrais clients.
# ---------------------------------------------------------------------------------------------

titre "9. IMAP, SMTP et ClamAV répondent réellement"

HOTE=$(lire_env DEV_BIND_ADDRESS)
MDP=$(lire_env STALWART_MAILBOX_PASSWORD)

for boite in "${BOITES[@]}"; do
	# `curl` est ici un véritable client IMAP : il ouvre la session et liste les dossiers.
	if curl -sS --noproxy '*' --url "imap://$HOTE:$(lire_env STALWART_IMAP_PORT)/" \
		--user "$boite:$MDP" 2>/dev/null | grep -q INBOX; then
		ok "un client IMAP réel ouvre une session sur $boite et voit INBOX"
	else
		fail "aucune session IMAP possible sur $boite"
	fi
done

if curl -sS --noproxy '*' --url "imap://$HOTE:$(lire_env STALWART_IMAP_PORT)/" \
	--user "$BOITE_SYSTEME:mauvais-mot-de-passe" >/dev/null 2>&1; then
	fail "un mot de passe faux ouvre une session IMAP"
else
	ok "un mot de passe faux est refusé par IMAP"
fi

EXPEDITEUR="admin@$DOMAINE_PERSO"
# LE MESSAGE PORTE DÉSORMAIS UN `Message-ID` STABLE, ET CE N'EST PAS UN DÉTAIL DE FORME — INC-212.
# Sans en-tête, `mail-sync` lui calcule un identifiant de repli `fallback-sha256:…` qui change avec
# le contenu : le message n'était reconnaissable NI dans la boîte, NI en base, et la reprise
# ci-dessous n'aurait su quoi reprendre. Le domaine est celui du harnais, jamais celui du produit.
MESSAGE_ID_CONTROLE='<preuve-journal-stalwart@verify-mail-infra.p2enjoy.test>'
if printf 'From: %s\r\nTo: %s\r\nMessage-ID: %s\r\nSubject: Preuve journal Stalwart propre\r\n\r\nMessage de contrôle.\r\n' \
	"$EXPEDITEUR" "$BOITE_SYSTEME" "$MESSAGE_ID_CONTROLE" \
	| curl -sS --noproxy '*' --url "smtp://$HOTE:$(lire_env STALWART_SUBMISSION_PORT)" \
		--user "$EXPEDITEUR:$MDP" --mail-from "$EXPEDITEUR" --mail-rcpt "$BOITE_SYSTEME" \
		--upload-file - >/dev/null; then
	ok "un client SMTP réel soumet un message authentifié sans signature de production"
else
	fail "la soumission SMTP authentifiée du contrôle de journal échoue"
fi

# `clamd` en protocole binaire, sans dépendance : bash suffit.
clamd_dialogue() {
	local charge=$1 reponse=''
	exec 3<>"/dev/tcp/$HOTE/$(lire_env CLAMAV_PORT)" || return 1
	printf '%b' "$charge" >&3
	reponse=$(timeout 10 cat <&3 | tr -d '\0')
	exec 3<&- 3>&-
	printf '%s' "$reponse"
}

if [ "$(clamd_dialogue 'zPING\0')" = PONG ]; then
	ok "clamd répond PONG"
else
	fail "clamd ne répond pas PONG"
fi

# La chaîne EICAR est assemblée ici, et n'existe donc pas telle quelle dans ce fichier : un
# antivirus installé sur le poste mettrait autrement le dépôt en quarantaine.
EICAR='X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-'"ANTIVIRUS-TEST-FILE!\$H+H*"
taille=$(printf '%s' "$EICAR" | wc -c)
entete=$(printf '%08x' "$taille" | sed 's/\(..\)/\\x\1/g')
verdict=$(clamd_dialogue "zINSTREAM\0${entete}$(printf '%s' "$EICAR" | sed 's/\\/\\\\/g')\\x00\\x00\\x00\\x00" || true)
if printf '%s' "$verdict" | grep -q 'FOUND'; then
	ok "clamd DÉTECTE la signature de test : « $(printf '%s' "$verdict" | tr -d '\n') »"
else
	fail "clamd ne détecte pas la signature de test — base de signatures absente ? (« $verdict »)"
fi

code_roundcube=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' "http://$HOTE:$(lire_env ROUNDCUBE_PORT)/" || echo 000)
if [ "$code_roundcube" = 200 ]; then
	ok "Roundcube répond 200"
else
	fail "Roundcube rend $code_roundcube, 200 attendu"
fi

if curl -sS --noproxy '*' "http://$HOTE:$(lire_env ROUNDCUBE_PORT)/" | grep -q 'rcmloginuser'; then
	ok "Roundcube sert son formulaire de connexion"
else
	fail "Roundcube ne sert pas son formulaire de connexion"
fi

# Ce contrôle vient APRÈS les gestes IMAP et SMTP : placé au démarrage, il ne voyait pas les
# avertissements de signature que la première soumission authentifiée faisait apparaître.
if docker logs p2enjoy-stalwart 2>&1 | grep -qE '(^|[[:space:]])(WARN|ERROR)([[:space:]]|$)'; then
	fail "le journal Stalwart contient au moins un WARN ou ERROR après les protocoles"
else
	ok "le journal Stalwart reste sans WARN ni ERROR après les protocoles"
fi

# ---------------------------------------------------------------------------------------------
# LE HARNAIS REPREND SON MESSAGE — INC-212, corrigée le 2026-08-25.
# ---------------------------------------------------------------------------------------------
# Le contrôle du journal ci-dessus EXIGE une soumission réelle ; il n'exige pas qu'elle survive au
# harnais. Or elle survivait deux fois : dans la boîte système, où chaque exécution ajoutait une
# copie, et en base dès qu'une relève l'ingérait — un message NON CLASSÉ de plus dans l'inbox.
#
# MESURÉ le 2026-08-25 : `e2e/ui/sommeil-fil.spec.ts` endort les fils du dossier « Non classés »
# puis exige son état vide ; ce message formait un fil de plus, et l'état vide devenait
# inatteignable. La campagne rendait `589 passés, 1 échec` sur un défaut qui n'était pas celui du
# produit. C'est la famille d'INC-209 : une preuve qui écrit dans la base de développement doit
# reprendre ses écritures.
#
# La reprise porte sur les DEUX côtés, et l'ordre compte : la boîte d'abord — sans quoi une relève
# ultérieure réingérerait la ligne qu'on vient d'effacer —, la base ensuite.
# LA REMISE N'EST PAS INSTANTANÉE, ET LE PREMIER ÉCRIT DE CETTE REPRISE L'IGNORAIT. Le serveur
# ACCEPTE la soumission, puis dépose — c'est ce que `supabase/seed/apply-seed.sh` gère déjà par
# cinq tentatives espacées. Cherché trop tôt, le message n'est pas encore dans la boîte : la
# recherche ne rend rien, l'`EXPUNGE` n'a rien à retirer, le message arrive APRÈS, et une relève
# ultérieure l'ingère — exactement le défaut qu'INC-212 décrit, reproduit par sa propre correction.
# MESURÉ le 2026-08-25 : un exemplaire portant le `Message-ID` stable a survécu de cette façon.
# On attend donc qu'il soit là avant de le retirer, et l'attente est BORNÉE.
# LA FORME DE LA RECHERCHE EST MESURÉE, ET LES CHEVRONS LA CASSENT. Trois formes essayées le
# 2026-08-25 sur la même boîte, le même message :
#
#   UID SEARCH HEADER Message-ID <id@domaine>    => * SEARCH        (RIEN)
#   UID SEARCH HEADER Message-ID "id@domaine"    => * SEARCH 37     (trouvé)
#   UID SEARCH SUBJECT "Preuve journal…"         => * SEARCH 37     (trouvé)
#
# La première est celle qu'on écrit spontanément, puisque c'est ainsi que l'en-tête s'écrit ; elle
# rend une recherche VIDE, donc un `EXPUNGE` sans objet, donc un message qui survit — et la reprise
# d'INC-212 reproduisait ainsi le défaut qu'elle corrige. La valeur est donc cherchée SANS ses
# chevrons et ENTRE GUILLEMETS.
IDENTIFIANT_NU=${MESSAGE_ID_CONTROLE#<}
IDENTIFIANT_NU=${IDENTIFIANT_NU%>}

chercher_controle() {
	curl -sS --noproxy '*' --url "imap://$HOTE:$(lire_env STALWART_IMAP_PORT)/INBOX" \
		--user "$BOITE_SYSTEME:$MDP" \
		--request "UID SEARCH HEADER Message-ID \"$IDENTIFIANT_NU\"" 2>/dev/null \
		| tr -d '\r' | sed -n 's/^\* SEARCH //p'
}

uids_controle=''
for _tentative in 1 2 3 4 5 6 7 8 9 10; do
	uids_controle=$(chercher_controle)
	[ -n "$uids_controle" ] && break
	sleep 2
done
for uid in $uids_controle; do
	curl -sS --noproxy '*' --url "imap://$HOTE:$(lire_env STALWART_IMAP_PORT)/INBOX" \
		--user "$BOITE_SYSTEME:$MDP" --request "UID STORE $uid +Flags \\Deleted" >/dev/null 2>&1 || true
done
curl -sS --noproxy '*' --url "imap://$HOTE:$(lire_env STALWART_IMAP_PORT)/INBOX" \
	--user "$BOITE_SYSTEME:$MDP" --request 'EXPUNGE' >/dev/null 2>&1 || true
psql_db -c "delete from public.mail_messages
	where rfc822_message_id in ('$MESSAGE_ID_CONTROLE', 'preuve-journal-stalwart@verify-mail-infra.p2enjoy.test')
	   or subject = 'Preuve journal Stalwart propre';" >/dev/null 2>&1 || true

# LA REPRISE EST CONSTATÉE, JAMAIS SUPPOSÉE (docs/SPEC-test-harness.md §7.2) : les deux côtés sont
# relus. Un `delete` qui n'aurait rien effacé et un `EXPUNGE` sans effet rendraient ce contrôle
# rouge, au lieu de laisser la dérive repartir silencieusement à l'exécution suivante.
# Le constat porte AUSSI sur le fait que la reprise a eu quelque chose à reprendre : un
# `uids_controle` vide signifierait que le message n'est jamais arrivé en vingt secondes, et le
# contrôle serait vert sur une absence au lieu d'un retrait.
restes_boite=$(chercher_controle | wc -w)
restes_base=$(psql_db -c "select count(*) from public.mail_messages
	where subject = 'Preuve journal Stalwart propre';" | tr -d '[:space:]')
if [ -z "$uids_controle" ]; then
	fail "le message de contrôle n'est pas arrivé dans la boîte en 20 s : rien n'a été repris"
elif [ "$restes_boite" = 0 ] && [ "$restes_base" = 0 ]; then
	ok "le harnais REPREND son message de contrôle : ni dans la boîte système, ni en base"
else
	fail "le message de contrôle survit au harnais : $restes_boite dans la boîte, $restes_base en base"
fi

# ---------------------------------------------------------------------------------------------
# Famille 10 — aucun secret réel versionné.
# ---------------------------------------------------------------------------------------------

titre "10. Aucun secret réel dans le dépôt"

MDP_ADMIN=$(lire_env STALWART_ADMIN_PASSWORD)
if [ -z "$MDP_ADMIN" ]; then
	fail "STALWART_ADMIN_PASSWORD est vide dans .env"
elif git grep -q -- "$MDP_ADMIN" -- . 2>/dev/null; then
	fail "le mot de passe d'administration tiré au hasard est présent dans un fichier versionné"
else
	ok "le mot de passe d'administration n'apparaît dans aucun fichier versionné"
fi

if [ "$(lire_env STALWART_ADMIN_PASSWORD "$RACINE/.env.example")" = "CHANGE_ME_STALWART_ADMIN_PASSWORD" ]; then
	ok ".env.example ne porte qu'un marqueur pour le mot de passe d'administration"
else
	fail ".env.example porte une autre valeur que le marqueur CHANGE_ME_ pour STALWART_ADMIN_PASSWORD"
fi

# ---------------------------------------------------------------------------------------------

printf '\n\033[1mRésultat\033[0m\n'
info "$checks contrôles, $failures anomalie(s)"
if [ "$failures" -gt 0 ]; then
	printf '  \033[31m%s anomalie(s). Voir ci-dessus.\033[0m\n' "$failures"
	exit 1
fi
printf '  \033[32mAucune anomalie.\033[0m\n'
