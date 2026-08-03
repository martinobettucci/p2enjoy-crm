#!/usr/bin/env bash
# @verifies CRM-004 (docs/BACKLOG.md) — décision de chiffrement des secrets de messagerie
# @verifies docs/DAT.md §8 (chiffrement des secrets), §10 (reprise et continuité), §15
# @verifies docs/SCHEMA.md §7 (comptes de messagerie), §11 (points à trancher)
# @verifies docs/SPEC-mail-subsystem.md §2 (comptes entrants et identités sortantes)
# @verifies docs/JOURNAL.md décision 7 (secrets en Vault), décision 8 (ordonnanceur applicatif)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-004` :
#
#   1. l'image PostgreSQL **réellement épinglée** par `docker-compose.yml` fournit
#      `supabase_vault` et `pg_cron` ;
#   2. Vault chiffre et déchiffre réellement : le clair n'est pas dans la table, et la vue le
#      restitue à l'identique ;
#   3. le cloisonnement de la décision 7 est **effectif** : `anon` et `authenticated` sont
#      refusés, seul `service_role` lit et écrit ;
#   4. la clé racine vit **hors de `PGDATA`** : elle survit à un redémarrage, et sa perte rend
#      les secrets définitivement indéchiffrables — c'est la contrainte de sauvegarde de
#      `docs/DAT.md` §10 ;
#   5. le harnais est **non complaisant** : les contrôles 3 et 4 échouent bien lorsqu'on relâche
#      le cloisonnement, ou lorsqu'on restitue la clé d'origine.
#
# Le script est autonome : il ne dépend ni de `.env`, ni de la pile en cours d'exécution. Il crée
# ses propres conteneur et volumes jetables, préfixés `p2enjoy-vault-`, et les détruit en
# sortant — y compris en cas d'interruption. Il ne touche jamais à la pile de développement.
#
# Usage :
#   scripts/verify-vault.sh

set -euo pipefail

cd "$(dirname "$0")/.."

CONTAINER=p2enjoy-vault-probe
VOL_DATA=p2enjoy-vault-pgdata
VOL_CONF=p2enjoy-vault-config
KEY_FILE=/etc/postgresql-custom/pgsodium_root.key
CLAIR='mot-de-passe-imap-de-preuve-CRM-004'
CLAIR2='mot-de-passe-imap-remplace'

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

nettoyer() {
	docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	docker volume rm -f "$VOL_DATA" "$VOL_CONF" >/dev/null 2>&1 || true
}
trap nettoyer EXIT

# L'image n'est jamais recopiée ici : elle est lue dans l'assemblage, de sorte que le harnais ne
# puisse pas prouver une chose sur une image que le projet n'utilise plus.
IMAGE=$(sed -n 's|^[[:space:]]*image:[[:space:]]*\(supabase/postgres:[^[:space:]]*\).*|\1|p' \
	docker-compose.yml | head -n 1)

if [ -z "$IMAGE" ]; then
	echo "ERREUR : aucune image 'supabase/postgres:<version>' trouvée dans docker-compose.yml." >&2
	exit 1
fi

# `demarrer` (re)crée le conteneur sur les volumes demandés et attend que PostgreSQL réponde.
demarrer() {
	docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
	docker run -d --name "$CONTAINER" \
		-e POSTGRES_PASSWORD=preuve \
		-e POSTGRES_HOST=/var/run/postgresql \
		-v "$VOL_DATA":/var/lib/postgresql/data \
		-v "$VOL_CONF":/etc/postgresql-custom \
		"$IMAGE" >/dev/null
	local i
	for i in $(seq 1 90); do
		if docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
	done
	echo "ERREUR : PostgreSQL n'a pas démarré dans le conteneur de preuve." >&2
	exit 1
}

# `sql` renvoie la sortie brute, erreurs comprises : les refus attendus sont des erreurs, et les
# masquer reviendrait à ne rien prouver. Le `|| true` neutralise le seul code de retour de psql,
# pas le message : c'est la sortie textuelle qui est examinée par chaque contrôle.
sql() { docker exec "$CONTAINER" psql -U postgres -qtAX -c "$1" 2>&1 | tr -d '\r' || true; }

# `sql_role` exécute la requête sous un rôle donné, sans superutilisateur.
sql_role() {
	docker exec "$CONTAINER" psql -U postgres -qtAX -c "set role $1; $2" 2>&1 | tr -d '\r' || true
}

echo "Harnais de preuves CRM-004 — chiffrement des secrets de messagerie"
echo "Image épinglée par docker-compose.yml : $IMAGE"
echo

nettoyer
docker volume create "$VOL_DATA" >/dev/null
docker volume create "$VOL_CONF" >/dev/null
demarrer

# --- 1. Capacité de l'image réellement épinglée -------------------------------------------------
echo "1. Extensions fournies par l'image"

vault_dispo=$(sql "select default_version from pg_available_extensions where name='supabase_vault';")
if [ -n "$vault_dispo" ]; then
	ok "supabase_vault disponible (version $vault_dispo)"
else
	fail "supabase_vault ABSENTE de l'image — le repli pgcrypto s'impose (docs/DAT.md §8)"
fi

vault_installe=$(sql "select extversion from pg_extension where extname='supabase_vault';")
if [ -n "$vault_installe" ]; then
	ok "supabase_vault déjà installée par défaut (version $vault_installe)"
else
	fail "supabase_vault non installée : une migration devrait la créer explicitement"
fi

preload=$(sql "show shared_preload_libraries;")
case "$preload" in
	*supabase_vault*) ok "supabase_vault préchargée par le serveur" ;;
	*) fail "supabase_vault absente de shared_preload_libraries : $preload" ;;
esac

cron_dispo=$(sql "select default_version from pg_available_extensions where name='pg_cron';")
if [ -n "$cron_dispo" ]; then
	ok "pg_cron disponible (version $cron_dispo)"
else
	fail "pg_cron ABSENT de l'image"
fi

case "$preload" in
	*pg_cron*) ok "pg_cron préchargé par le serveur" ;;
	*) fail "pg_cron absent de shared_preload_libraries : $preload" ;;
esac

# `pg_cron` n'est pas retenu (décision 8), mais son installabilité est mesurée, et non supposée :
# c'est précisément l'hypothèse que `CRM-004` doit lever.
sql "create extension if not exists pg_cron;" >/dev/null 2>&1 || true
cron_installe=$(sql "select extversion from pg_extension where extname='pg_cron';")
if [ -n "$cron_installe" ]; then
	ok "pg_cron réellement installable (version $cron_installe)"
else
	fail "pg_cron disponible mais non installable"
fi

job=$(sql "select cron.schedule('p2enjoy-vault-sonde','5 seconds','select 1');")
if printf '%s' "$job" | grep -qE '^[0-9]+$'; then
	ok "pg_cron ordonnance réellement une tâche (jobid $job)"
	sql "select cron.unschedule('p2enjoy-vault-sonde');" >/dev/null 2>&1 || true
else
	fail "pg_cron n'ordonnance pas : $job"
fi

pgcrypto=$(sql "select extversion from pg_extension where extname='pgcrypto';")
if [ -n "$pgcrypto" ]; then
	ok "pgcrypto présent (version $pgcrypto) — repli disponible, non retenu"
else
	fail "pgcrypto absent : ni Vault ni son repli ne seraient garantis"
fi

# --- 2. Vault chiffre et déchiffre réellement ---------------------------------------------------
echo
echo "2. Chiffrement et déchiffrement effectifs"

secret_id=$(sql "select vault.create_secret('$CLAIR','crm004-preuve','preuve CRM-004');")
if printf '%s' "$secret_id" \
	| grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
then
	ok "vault.create_secret retourne un identifiant ($secret_id)"
else
	fail "vault.create_secret n'a pas créé de secret : $secret_id"
fi

# L'absence du clair ne suffit pas : une requête en erreur ne le contient pas non plus. Le
# contrôle exige donc une valeur réellement lue, en base64, et distincte du clair.
au_repos=$(sql "select secret from vault.secrets where name='crm004-preuve';")
if printf '%s' "$au_repos" | grep -q 'ERROR'; then
	fail "vault.secrets illisible : $au_repos — contrôle non concluant"
elif [ -z "$au_repos" ]; then
	fail "aucune ligne dans vault.secrets : le secret n'a pas été stocké"
elif printf '%s' "$au_repos" | grep -qF "$CLAIR"; then
	fail "le clair est lisible au repos dans vault.secrets"
elif printf '%s' "$au_repos" | grep -qE '^[A-Za-z0-9+/=[:space:]]+$'; then
	ok "le clair n'apparaît pas dans vault.secrets (chiffré base64 réellement stocké)"
else
	fail "vault.secrets ne contient pas un chiffré base64 : $au_repos"
fi

nonce=$(sql "select nonce is not null from vault.secrets where name='crm004-preuve';")
if [ "$nonce" = t ]; then
	ok "un nonce est enregistré avec le secret"
else
	fail "aucun nonce enregistré : chiffrement déterministe sans aléa"
fi

dechiffre=$(sql "select decrypted_secret from vault.decrypted_secrets where name='crm004-preuve';")
if [ "$dechiffre" = "$CLAIR" ]; then
	ok "vault.decrypted_secrets restitue le clair à l'identique"
else
	fail "restitution incorrecte : '$dechiffre' au lieu de '$CLAIR'"
fi

sql "select vault.update_secret('$secret_id','$CLAIR2');" >/dev/null 2>&1 || true
dechiffre2=$(sql "select decrypted_secret from vault.decrypted_secrets where id='$secret_id';")
if [ "$dechiffre2" = "$CLAIR2" ]; then
	ok "vault.update_secret remplace réellement la valeur chiffrée"
else
	fail "update_secret sans effet : '$dechiffre2' au lieu de '$CLAIR2'"
fi

# --- 3. Cloisonnement par rôle (décision 7) -----------------------------------------------------
# Le contrôle porte sur ce que la pile expose réellement à PostgREST : `anon` et `authenticated`
# sont les rôles que porte un jeton de navigateur.
echo
echo "3. Cloisonnement par rôle"

# `refuse_vault` retourne 0 lorsque le rôle est bien refusé sur les trois chemins d'accès.
refuse_vault() {
	local role=$1 requete sortie
	for requete in \
		"select count(*) from vault.secrets" \
		"select count(*) from vault.decrypted_secrets" \
		"select vault.create_secret('intrusion','intrusion-$role')"
	do
		sortie=$(sql_role "$role" "$requete")
		printf '%s' "$sortie" | grep -q 'permission denied' || return 1
	done
	return 0
}

for role in anon authenticated; do
	if refuse_vault "$role"; then
		ok "$role : refusé sur vault.secrets, vault.decrypted_secrets et vault.create_secret"
	else
		fail "$role : atteint Vault — le secret d'un collègue serait lisible"
	fi
done

lecture=$(sql_role service_role "select count(*) from vault.secrets;")
if printf '%s' "$lecture" | grep -qE '^[0-9]+$'; then
	ok "service_role lit vault.secrets ($lecture ligne(s))"
else
	fail "service_role ne lit pas vault.secrets : $lecture — mail-sync ne fonctionnerait pas"
fi

lecture=$(sql_role service_role "select decrypted_secret from vault.decrypted_secrets where id='$secret_id';")
if [ "$lecture" = "$CLAIR2" ]; then
	ok "service_role déchiffre réellement le secret"
else
	fail "service_role ne déchiffre pas : '$lecture'"
fi

ecriture=$(sql_role service_role "select vault.create_secret('autre','crm004-service');")
if printf '%s' "$ecriture" \
	| grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
then
	ok "service_role crée un secret"
else
	fail "service_role ne peut pas créer de secret : $ecriture"
fi

# --- 4. Cycle de vie de la clé racine -----------------------------------------------------------
# Point le plus lourd de conséquences : la clé ne vit pas dans `PGDATA`. Une sauvegarde de la
# seule base ne restitue donc AUCUN secret. Ce qui suit le mesure au lieu de l'affirmer.
echo
echo "4. Cycle de vie de la clé racine"

cle_origine=$(docker exec "$CONTAINER" cat "$KEY_FILE" 2>/dev/null | tr -d '\r\n' || true)
if [ -n "$cle_origine" ]; then
	ok "clé racine présente dans $KEY_FILE, hors de PGDATA"
else
	fail "clé racine introuvable dans $KEY_FILE"
fi

# Ce contrôle n'a de sens que si une clé existe quelque part : sans cela, « absente de PGDATA »
# serait vrai pour une image qui ne chiffre rien du tout.
dans_pgdata=$(docker exec "$CONTAINER" \
	sh -c "find /var/lib/postgresql/data -name 'pgsodium_root.key' 2>/dev/null | head -n 1")
if [ -z "$cle_origine" ]; then
	fail "aucune clé racine trouvée : le contrôle d'emplacement est non concluant"
elif [ -z "$dans_pgdata" ]; then
	ok "aucune copie de la clé dans PGDATA : la sauvegarde de la base ne suffit pas"
else
	fail "clé trouvée dans PGDATA ($dans_pgdata) — la contrainte de DAT §10 serait à revoir"
fi

# Redémarrage sur les mêmes volumes : le secret doit survivre.
demarrer
survivant=$(sql "select decrypted_secret from vault.decrypted_secrets where id='$secret_id';")
if [ "$survivant" = "$CLAIR2" ]; then
	ok "redémarrage sur les mêmes volumes : secret toujours déchiffrable"
else
	fail "secret perdu au simple redémarrage : '$survivant'"
fi

# PGDATA conservé, volume de configuration neuf : exactement ce que produit une restauration qui
# n'aurait sauvegardé que la base.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker volume rm -f "$VOL_CONF" >/dev/null
docker volume create "$VOL_CONF" >/dev/null
demarrer

cle_neuve=$(docker exec "$CONTAINER" cat "$KEY_FILE" 2>/dev/null | tr -d '\r\n' || true)
if [ -n "$cle_neuve" ] && [ "$cle_neuve" != "$cle_origine" ]; then
	ok "volume de configuration neuf : une clé différente est engendrée"
else
	fail "la clé n'a pas changé — le contrôle suivant ne prouverait rien"
fi

reste=$(sql "select length(secret) from vault.secrets where id='$secret_id';")
if printf '%s' "$reste" | grep -qE '^[0-9]+$'; then
	ok "le chiffré est toujours en base ($reste octets) : seule la clé manque"
else
	fail "la ligne chiffrée a disparu : $reste — la perte ne serait pas imputable à la clé"
fi

perdu=$(sql "select decrypted_secret from vault.decrypted_secrets where id='$secret_id';")
if printf '%s' "$perdu" | grep -qi 'invalid ciphertext'; then
	ok "clé perdue : déchiffrement impossible — sauvegarde du volume de configuration OBLIGATOIRE"
else
	fail "le secret reste lisible sans sa clé d'origine : '$perdu'"
fi

# --- 5. Non-complaisance du harnais -------------------------------------------------------------
# Un harnais qui ne peut pas échouer ne prouve rien. Les deux contrôles les plus structurants
# sont donc réexécutés sur un état volontairement dégradé, avec l'attente inverse.
echo
echo "5. Non-complaisance : les contrôles doivent échouer sur un état dégradé"

sql "grant usage on schema vault to authenticated;" >/dev/null 2>&1 || true
sql "grant select on vault.secrets, vault.decrypted_secrets to authenticated;" >/dev/null 2>&1 || true
if refuse_vault authenticated; then
	fail "cloisonnement relâché mais le contrôle reste vert — il ne prouve rien"
else
	ok "cloisonnement relâché : le contrôle du §3 échoue bien"
fi
sql "revoke select on vault.secrets, vault.decrypted_secrets from authenticated;" >/dev/null 2>&1 || true
sql "revoke usage on schema vault from authenticated;" >/dev/null 2>&1 || true

# La clé d'origine restituée doit rendre le secret de nouveau lisible : si le déchiffrement
# échouait pour une autre raison, ce contrôle resterait rouge et dénoncerait le précédent.
docker exec "$CONTAINER" sh -c "printf '%s' '$cle_origine' > $KEY_FILE" >/dev/null 2>&1 || true
docker restart "$CONTAINER" >/dev/null
for i in $(seq 1 60); do
	docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
	sleep 2
done
retrouve=$(sql "select decrypted_secret from vault.decrypted_secrets where id='$secret_id';")
if [ "$retrouve" = "$CLAIR2" ]; then
	ok "clé d'origine restituée : le secret redevient lisible — la perte était bien la sienne"
else
	fail "clé restituée mais secret toujours illisible ('$retrouve') : le §4 échouait pour une autre raison"
fi

# --- Bilan --------------------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1
