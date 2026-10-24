#!/usr/bin/env bash
# @spec CRM-102 (docs/BACKLOG.md) — tranche T5 : les contrôles du connecteur MCP portés dans scripts/spark/verifier.sh
# @spec docs/SPEC-deploiement-spark.md §7 (point 7) ; docs/SPEC-mcp.md §2.1 (service éteint sans hôte), §2.2 (hôte
#       dédié, `/plateforme`), §3.4 (adresses de retour restreintes), §11 (`/pret`) ; docs/PROD_MIGRATIONS.md §2.14
#       (geste 5) ; docs/JOURNAL.md décision 683
#
# Bibliothèque de `scripts/spark/verifier.sh`, éprouvée par `scripts/verify-controles-connecteur.sh`. Elle n'exécute
# rien à l'inclusion. L'appelant définit `ok`, `echec` et `attente` (un contrôle rendu), et `distant` (une commande
# exécutée dans la cellule).
#
# Tout est en LECTURE SEULE : l'enregistrement d'un client au retour non listé est refusé par le connecteur, rien n'est
# écrit. Une seule tentative par contrôle, bornée à 20 s : un échec ponctuel est rapporté, jamais repris (décision 683).

# Le connecteur, joint par <URL de base>, répond comme celui que l'<origine publique> désigne, et mène à <SITE_URL>.
#   controler_connecteur <URL de base> <origine publique attendue> <SITE_URL attendue>
controler_connecteur() {
	local base=$1 origine=$2 site=$3 reponse code entetes
	entetes=$(mktemp)

	reponse=$(curl -s -m 20 -w '\n%{http_code}' "$base/pret")
	code=${reponse##*$'\n'}
	reponse=${reponse%$'\n'*}
	if [ "$code" = 200 ] && grep -Eq '"pret": *true' <<<"$reponse"; then
		ok "connecteur $origine : /pret rend 200, SSO et CRM joignables"
	else
		echec "connecteur $origine : /pret rend HTTP $code — $(printf '%s' "$reponse" | head -c 200)"
	fi

	code=$(curl -s -m 20 -D "$entetes" -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$base/mcp")
	if [ "$code" = 401 ] && grep -qiF "resource_metadata=\"$origine/.well-known/oauth-protected-resource/mcp\"" "$entetes"; then
		ok "connecteur $origine : /mcp sans jeton rend 401 et désigne ses métadonnées (resource_metadata)"
	else
		echec "connecteur $origine : /mcp sans jeton rend HTTP $code, $(grep -i '^www-authenticate:' "$entetes" | tr -d '\r' | head -c 200 || true)"
	fi
	rm -f "$entetes"

	reponse=$(curl -s -m 20 -w '\n%{http_code}' -X POST -H 'content-type: application/json' \
		-d '{"client_name":"verifier.sh","redirect_uris":["https://malveillant.exemple.test/cb"]}' "$base/register")
	code=${reponse##*$'\n'}
	reponse=${reponse%$'\n'*}
	if [ "$code" = 400 ] && grep -q 'invalid_redirect_uri' <<<"$reponse"; then
		ok "connecteur $origine : un client au retour non listé est refusé (400 invalid_redirect_uri), rien n'est écrit"
	else
		echec "connecteur $origine : enregistrement d'un retour non listé, HTTP $code — $(printf '%s' "$reponse" | head -c 200)"
	fi

	code=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' "$base/plateforme")
	if [ "$code" = "302 $site/plateforme" ]; then
		ok "connecteur $origine : /plateforme mène à $site/plateforme (302)"
	else
		echec "connecteur $origine : /plateforme rend « $code », 302 vers $site/plateforme attendu"
	fi
}

# Le point 7 du §7 : connecteur éteint, ou allumé, aiguillé par Caddy, routé et joignable.
#   verifier_connecteur_cellule <CRM_MCP_HOTE> <SPARK_HTTP_PORT> <SITE_URL> <noms|états des conteneurs>
verifier_connecteur_cellule() {
	local hote=$1 port=$2 site=$3 etats=$4 presents reponse code mode propose
	presents=$(printf '%s\n' "$etats" | cut -d'|' -f1 | grep -cx 'p2enjoy-mcp')

	if [ -z "$hote" ]; then
		if [ "$presents" = 0 ]; then
			ok "connecteur MCP éteint (CRM_MCP_HOTE vide) : aucun conteneur p2enjoy-mcp"
		else
			echec "CRM_MCP_HOTE est vide, mais un conteneur p2enjoy-mcp subsiste : il garde les secrets du connecteur"
		fi
		return 0
	fi

	if [ "$presents" = 1 ]; then
		ok "connecteur MCP allumé pour $hote : conteneur p2enjoy-mcp présent"
	else
		echec "CRM_MCP_HOTE=$hote, mais aucun conteneur p2enjoy-mcp : ./runProd.sh --spark"
	fi

	reponse=$(distant "curl -s -m 20 -H 'Host: $hote' -w '\n%{http_code}' 'http://127.0.0.1:$port/pret'")
	code=${reponse##*$'\n'}
	reponse=${reponse%$'\n'*}
	if [ "$code" = 200 ] && grep -Eq '"pret": *true' <<<"$reponse"; then
		ok "Caddy aiguille $hote vers le connecteur : /pret rend 200 depuis la cellule"
	else
		echec "Caddy, hôte $hote : /pret rend HTTP $code depuis la cellule — $(printf '%s' "$reponse" | head -c 200)"
	fi

	mode=$(distant "awk -v d='$hote' '\$1 == d { print \$3 }' /etc/spark/routes")
	propose=$(distant "awk -v d='$hote' '/^#/ { next } \$1 == d { print \$3 }' '/etc/spark/routes.?' 2>/dev/null")
	if [ "$mode" = tls ]; then
		ok "route $hote active en tls"
	elif [ "$propose" = tls ]; then
		attente "route $hote active en « ${mode:-aucune} » ; la route tls est proposée, à accepter par le propriétaire du Spark"
	else
		echec "route $hote active en « ${mode:-aucune} » : https:// non publié — scripts/spark/proposer.sh --connecteur-mcp"
	fi

	if [ "$mode" != tls ]; then
		attente "https://$hote/ non vérifiable tant que sa route n'est pas en tls"
	elif getent ahostsv4 "$hote" >/dev/null; then
		controler_connecteur "https://$hote" "https://$hote" "$site"
	else
		attente "$hote ne résout pas : enregistrement DNS à poser par le propriétaire du Spark"
	fi
}
