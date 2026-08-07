#!/bin/sh
# @spec CRM-050 (docs/BACKLOG.md) — provisionnement des domaines et des boîtes de développement
# @spec docs/SPEC-mail-subsystem.md §11.4 (domaines et boîtes, créés par le véritable mécanisme)
# @spec docs/JOURNAL.md décision 235 (le rôle `user` est obligatoire), décision 239 (pas de boîte
#       pour le `viewer`)
# @spec CLAUDE.md §8 (les données de développement sont créées par les vrais mécanismes)
#
# Exécuté par le service `stalwart-init` de `docker-compose.dev.yml`, dans une image qui ne porte
# qu'un client HTTP : l'image de Stalwart n'embarque ni `curl` ni `wget`, et son `stalwart-cli`
# v0.13.4 n'expose aucune sous-commande de gestion de compte (mesuré).
#
# Le provisionnement passe par l'**API de gestion**, comme le ferait un exploitant. Aucune écriture
# directe dans RocksDB, aucune donnée fabriquée à la main.
#
# CONVERGENT, comme le seed socle (docs/SPEC-seed.md §3) : rejoué, il ne duplique rien et rétablit
# une valeur modifiée à la main. Il ne détruit jamais un message : une boîte existante est mise à
# jour, jamais recréée.
#
# Variables attendues : STALWART_API, STALWART_ADMIN_USER, STALWART_ADMIN_PASSWORD,
# CRM_INBOUND_DOMAIN, MAIL_DEV_PERSONAL_DOMAIN, STALWART_MAILBOX_PASSWORD.

set -eu

API=${STALWART_API:?STALWART_API manquante}
AUTH="${STALWART_ADMIN_USER:?}:${STALWART_ADMIN_PASSWORD:?}"
DOMAINE_CARDS=${CRM_INBOUND_DOMAIN:?CRM_INBOUND_DOMAIN manquante}
DOMAINE_PERSO=${MAIL_DEV_PERSONAL_DOMAIN:?MAIL_DEV_PERSONAL_DOMAIN manquante}
MDP=${STALWART_MAILBOX_PASSWORD:?STALWART_MAILBOX_PASSWORD manquante}

dire() { printf '  %s\n' "$*"; }
echec() { printf 'ERREUR %s\n' "$*" >&2; exit 1; }

# `--fail` est écarté volontairement : l'API rend **200** avec un corps `fieldAlreadyExists`
# lorsqu'un principal existe déjà (mesuré). La convergence se lit donc dans le corps, pas dans le
# code HTTP, et un `--fail` masquerait le cas au lieu de le traiter.
appel() {
	methode=$1
	chemin=$2
	corps=${3:-}
	if [ -n "$corps" ]; then
		curl -sS -u "$AUTH" -H 'Content-Type: application/json' \
			-X "$methode" "$API$chemin" -d "$corps"
	else
		curl -sS -u "$AUTH" -X "$methode" "$API$chemin"
	fi
}

# --- 1. Attente de l'API de gestion -------------------------------------------------------------
# Le service dépend de la santé de Stalwart, mais un `healthcheck` satisfait ne garantit pas que
# le magasin interne accepte déjà une écriture. L'attente est bornée : sans elle, un échec
# d'infrastructure deviendrait une boucle infinie, ce qu'aucun journal ne rend lisible.

printf 'Provisionnement des boîtes de développement\n'
essai=0
until appel GET '/api/principal?types=domain' >/dev/null 2>&1; do
	essai=$((essai + 1))
	[ "$essai" -lt 60 ] || echec "API de gestion injoignable après 60 tentatives : $API"
	sleep 1
done
dire "API de gestion joignable après $essai tentative(s) : $API"

# --- 2. Réglages d'authentification -------------------------------------------------------------
# Ces clés appartiennent au magasin modifiable de Stalwart. Les laisser dans `config.toml`
# fonctionne, mais produit un avertissement de collision à chaque démarrage. L'API est le vrai
# mécanisme d'administration de ce magasin ; l'insertion avec écrasement rend l'opération
# convergente, puis le rechargement rend l'effet observable avant le premier client IMAP/SMTP.

reglages='[{"type":"insert","prefix":null,"values":[["session.auth.mechanisms","[plain, login]"],["imap.auth.allow-plain-text","true"],["auth.dkim.sign","false"],["auth.arc.seal","false"],["webadmin.resource","file:///opt/stalwart/etc/webadmin-disabled.zip"]],"assert_empty":false}]'
reponse=$(appel POST /api/settings "$reglages")
case "$reponse" in
	*'"data"'*) dire "réglages IMAP/SMTP et ressource webadmin — écrits dans le magasin de configuration" ;;
	*) echec "réglages IMAP/SMTP et ressource webadmin : réponse inattendue — $reponse" ;;
esac

reponse=$(appel GET /api/reload)
case "$reponse" in
	*'"data"'*) dire "configuration Stalwart — rechargée" ;;
	*) echec "rechargement de la configuration : réponse inattendue — $reponse" ;;
esac

# Le démarrage à froid importe déjà ce bundle. Cet appel supplémentaire rend aussi un ancien
# volume convergent : le blob éventuellement téléchargé par une version précédente est remplacé
# par la ressource locale, sans supprimer les boîtes ni leurs messages.
reponse=$(appel GET /api/update/webadmin)
case "$reponse" in
	*'"data"'*) dire "bundle webadmin local — chargé et décompressé" ;;
	*) echec "chargement du bundle webadmin local : réponse inattendue — $reponse" ;;
esac

session_lue=$(appel GET '/api/settings/list?prefix=session.auth')
case "$session_lue" in
	*'"mechanisms":"[plain, login]"'*) : ;;
	*) echec "session.auth.mechanisms non relu après écriture — $session_lue" ;;
esac

imap_lue=$(appel GET '/api/settings/list?prefix=imap.auth')
case "$imap_lue" in
	*'"allow-plain-text":"true"'*) : ;;
	*) echec "imap.auth.allow-plain-text non relu après écriture — $imap_lue" ;;
esac

dkim_lu=$(appel GET '/api/settings/list?prefix=auth.dkim')
case "$dkim_lu" in
	*'"sign":"false"'*) : ;;
	*) echec "auth.dkim.sign non relu après écriture — $dkim_lu" ;;
esac

arc_lu=$(appel GET '/api/settings/list?prefix=auth.arc')
case "$arc_lu" in
	*'"seal":"false"'*) : ;;
	*) echec "auth.arc.seal non relu après écriture — $arc_lu" ;;
esac

webadmin_lu=$(appel GET '/api/settings/list?prefix=webadmin')
case "$webadmin_lu" in
	*'"resource":"file:///opt/stalwart/etc/webadmin-disabled.zip"'*) : ;;
	*) echec "webadmin.resource non relu après écriture — $webadmin_lu" ;;
esac
dire "réglages IMAP/SMTP et ressource webadmin — relus"

# --- 3. Domaines --------------------------------------------------------------------------------

domaine() {
	reponse=$(appel POST /api/principal "{\"type\":\"domain\",\"name\":\"$1\"}")
	case "$reponse" in
		*fieldAlreadyExists*) dire "domaine $1 — déjà présent" ;;
		*'"data"'*)           dire "domaine $1 — créé" ;;
		*)                    echec "domaine $1 : réponse inattendue — $reponse" ;;
	esac
}

domaine "$DOMAINE_CARDS"
domaine "$DOMAINE_PERSO"

# --- 4. Boîtes ----------------------------------------------------------------------------------
# `roles: ["user"]` est OBLIGATOIRE. Sans lui, le compte valide ses identifiants — le serveur écrit
# `Authentication successful` — puis refuse la commande avec `Unauthorized access`, **sans rien
# renvoyer au client**, qui attend jusqu'à sa propre expiration (docs/JOURNAL.md décision 235).
#
# La liste `emails` de la boîte système porte l'adresse sans partie locale `@<domaine>` : c'est le
# catch-all du domaine des cards (docs/SPEC-mail-subsystem.md §2.1 et §11.4).

boite() {
	nom=$1
	description=$2
	adresses=$3

	corps=$(printf '{"type":"individual","name":"%s","description":"%s","secrets":["%s"],"emails":%s,"roles":["user"]}' \
		"$nom" "$description" "$MDP" "$adresses")
	reponse=$(appel POST /api/principal "$corps")

	case "$reponse" in
		*fieldAlreadyExists*)
			# Convergence : la boîte existe, ses attributs sont rétablis sans que ses messages
			# soient touchés.
			maj=$(printf '[{"action":"set","field":"description","value":"%s"},{"action":"set","field":"secrets","value":["%s"]},{"action":"set","field":"emails","value":%s},{"action":"set","field":"roles","value":["user"]}]' \
				"$description" "$MDP" "$adresses")
			reponse_maj=$(appel PATCH "/api/principal/$nom" "$maj")
			case "$reponse_maj" in
				*'"data"'*) dire "boîte $nom — déjà présente, attributs rétablis" ;;
				*)          echec "mise à jour de $nom : réponse inattendue — $reponse_maj" ;;
			esac
			;;
		*'"data"'*) dire "boîte $nom — créée" ;;
		*)          echec "boîte $nom : réponse inattendue — $reponse" ;;
	esac
}

# Boîte système du workspace : `owner_id` NULL au sens du §2.1, catch-all du domaine des cards.
boite "systeme@$DOMAINE_CARDS" 'Boite systeme du workspace P2Enjoy SAS' \
	"[\"systeme@$DOMAINE_CARDS\",\"@$DOMAINE_CARDS\"]"

# Boîtes personnelles des deux comptes seedés qui correspondent. Farida Nowak (`viewer`) n'en a
# pas : un `viewer` lit, il ne correspond pas (docs/JOURNAL.md décision 239).
boite "admin@$DOMAINE_PERSO" 'Camille Aubert' "[\"admin@$DOMAINE_PERSO\"]"
boite "bizdev@$DOMAINE_PERSO" 'Driss Lemoine' "[\"bizdev@$DOMAINE_PERSO\"]"

# --- 5. Contrôle de sortie ----------------------------------------------------------------------
# Le script ne se déclare pas réussi parce qu'il n'a pas échoué : il relit ce qu'il a écrit.

for attendue in "systeme@$DOMAINE_CARDS" "admin@$DOMAINE_PERSO" "bizdev@$DOMAINE_PERSO"; do
	lue=$(appel GET "/api/principal/$attendue")
	case "$lue" in
		*'"roles":["user"]'*) : ;;
		*) echec "la boîte $attendue n'a pas le rôle « user » après provisionnement — $lue" ;;
	esac
done

printf 'Trois boîtes provisionnées et relues.\n'
