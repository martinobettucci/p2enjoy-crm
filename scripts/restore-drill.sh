#!/usr/bin/env bash
# @spec CRM-080 (docs/BACKLOG.md) — tranche 2, la restauration prouvée
# @spec docs/SPEC-backups.md §10 (les huit mesures qui commandent ce script),
#       §11.1 (un environnement jetable et un seul), §11.2 (la garde de destruction,
#       structurelle), §11.3 (le déroulé dans l'ordre que les mesures imposent),
#       §11.4 (les sept invariants comparés), §11.5 (variables d'environnement),
#       §11.6 (les onze refus), §11.7 (ce que l'exercice n'écrit jamais),
#       §12 (contrat de comportement, cas o à z), §14 (limites nommées)
# @spec docs/DAT.md §10 (reprise et continuité), §8 (chiffrement des secrets par pgsodium)
# @spec CLAUDE.md §9 (aucune écriture non validée, aucune commande destructrice par
#       commodité), §10 (les politiques d'autorisation sont une règle de backend),
#       §20 (aucun secret journalisé)
#
# Restaure une archive de scripts/backup.sh dans un environnement JETABLE, compare les
# invariants avec la pile de référence, puis détruit cet environnement — et lui seul.
#
# Usage :
#   scripts/restore-drill.sh                 restaure la plus récente archive de $BACKUP_OUTPUT_DIR
#   scripts/restore-drill.sh ARCHIVE         restaure l'archive désignée
#   scripts/restore-drill.sh --conserver     laisse l'environnement jetable debout pour inspection
#   scripts/restore-drill.sh --suffixe NOM   nomme l'environnement jetable au lieu de l'horodater
#   scripts/restore-drill.sh --help
#
# Variables d'environnement (docs/SPEC-backups.md §11.5) :
#   RESTORE_AGE_IDENTITY_FILE  fichier de la CLÉ PRIVÉE age qui déchiffre l'archive — requis
#   BACKUP_OUTPUT_DIR          répertoire où chercher l'archive — défaut /var/backups/p2enjoy
#
# C'EST ICI, ET SEULEMENT ICI, QU'UNE CLÉ PRIVÉE EST LUE. scripts/backup.sh n'en lit jamais : l'hôte
# qui sauvegarde ne peut relire aucune de ses archives (docs/SPEC-backups.md §3.4). L'exercice de
# restauration est donc l'opération d'un poste DISTINCT, celui qui détient l'identité.
#
# CE SCRIPT NE TOUCHE JAMAIS LA PILE COURANTE. Il ne fait sur elle que des lectures — des `select`
# pour les invariants de référence, `docker ps` pour savoir si elle tourne. Il ne crée que les deux
# conteneurs dont il retient lui-même le nom, et ne détruit jamais rien d'autre.

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/env.sh"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

PREFIXE_ARCHIVE=p2enjoy-sauvegarde
SUFFIXE_ARCHIVE=.tar.age
FORMAT_CONNU=1
# LES IMAGES SONT LUES DANS LES FICHIERS COMPOSE, JAMAIS RECOPIÉES ICI : une version épinglée en
# double dériverait, et l'exercice restaurerait dans une version de PostgreSQL différente de celle
# qui a produit le dump. `db` est déclaré par le fichier de base, `minio` par le fichier `dev` —
# le dépôt objet local n'existe qu'en développement, la production employant un fournisseur S3
# (docs/SPEC-backups.md §3.2).
IMAGE_DB=$(awk '/^  db:/{d=1} d && /^    image:/{print $2; exit}' "$REPO_ROOT/docker-compose.yml")
IMAGE_MINIO=$(awk '/^  minio:/{d=1} d && /^    image:/{print $2; exit}' "$REPO_ROOT/docker-compose.dev.yml")
DELAI_DEMARRAGE=120

# --- Arguments ----------------------------------------------------------------------------------

ARCHIVE_ARG=""
CONSERVER=0
SUFFIXE_ARG=""

while [ $# -gt 0 ]; do
	case "$1" in
		--help|-h) print_header_help "$SCRIPT_PATH"; exit 0 ;;
		--conserver) CONSERVER=1; shift ;;
		--suffixe)
			[ $# -ge 2 ] || die "--suffixe attend un nom."
			SUFFIXE_ARG=$2
			# LE PRÉFIXE N'EST JAMAIS NÉGOCIABLE, ET C'EST CE QUI REND CETTE OPTION SÛRE. Le suffixe
			# ne peut porter que des lettres, des chiffres, un point, un tiret ou un souligné : il ne
			# peut donc pas fabriquer un nom qui sortirait de « p2enjoy-restauration-* », ni viser un
			# conteneur de la pile. Sans cette validation, l'option ouvrirait exactement le trou que
			# la garde du §11.2 ferme.
			case "$SUFFIXE_ARG" in
				''|*[!A-Za-z0-9._-]*) die "--suffixe n'accepte que des lettres, chiffres, points, tirets et soulignés." ;;
			esac
			shift 2
			;;
		-*) die "argument inconnu « $1 ». Voir --help." ;;
		*)
			[ -z "$ARCHIVE_ARG" ] || die "une seule archive peut être restaurée à la fois."
			ARCHIVE_ARG=$1
			shift
			;;
	esac
done

# --- La garde de destruction, et elle est STRUCTURELLE (docs/SPEC-backups.md §11.2) -------------
#
# LE POINT LE PLUS IMPORTANT DE CE SCRIPT. Le `trap` ne détruit QUE les conteneurs dont ce script a
# lui-même retenu le nom, dans ces deux variables, au moment où il les a créés. Il ne construit
# aucun motif, n'énumère aucune liste et n'interroge aucun filtre pour décider quoi détruire : il
# ne peut donc, par construction, atteindre un conteneur de la pile.
#
# Les noms portent le préfixe `p2enjoy-restauration-` et l'horodatage de l'exercice. AUCUN conteneur
# de la pile ne peut porter un tel nom : `docker-compose.yml` les fixe (`container_name: p2enjoy-db`,
# `p2enjoy-minio`, …). Et si l'un de ces noms était déjà pris, R24 arrête l'exercice AVANT toute
# création, plutôt que de réutiliser un environnement que ce script n'a pas fait.

JETABLE_DB=""
JETABLE_MINIO=""
ASSEMBLAGE=""

nettoyer() {
	local code=$?
	[ -n "$ASSEMBLAGE" ] && [ -d "$ASSEMBLAGE" ] && rm -rf "$ASSEMBLAGE"
	if [ "$CONSERVER" = "1" ] && { [ -n "$JETABLE_DB" ] || [ -n "$JETABLE_MINIO" ]; }; then
		warn "environnement jetable CONSERVÉ à votre demande. Détruisez-le avec :"
		[ -n "$JETABLE_DB" ] && warn "  docker rm -f $JETABLE_DB"
		[ -n "$JETABLE_MINIO" ] && warn "  docker rm -f $JETABLE_MINIO"
		return "$code"
	fi
	[ -n "$JETABLE_DB" ] && docker rm -f "$JETABLE_DB" >/dev/null 2>&1
	[ -n "$JETABLE_MINIO" ] && docker rm -f "$JETABLE_MINIO" >/dev/null 2>&1
	return "$code"
}
trap nettoyer EXIT INT TERM

# --- Prérequis : rien n'est créé avant qu'ils soient tous satisfaits (§11.3 point 1) ------------

# R20 — `age` est un prérequis dur, comme à la sauvegarde : l'archive n'a qu'un format.
command -v age >/dev/null 2>&1 \
	|| die "« age » est introuvable : la restauration chiffrée l'exige (voir README §4)."

reglage() {
	local nom=$1 depuis_env
	depuis_env=$(eval "printf '%s' \"\${$nom:-}\"")
	if [ -n "$depuis_env" ]; then
		printf '%s' "$depuis_env"
	elif [ -f "$ENV_FILE" ] && env_has "$ENV_FILE" "$nom"; then
		env_get "$ENV_FILE" "$nom"
	fi
}

# R21 — l'identité de déchiffrement. C'est une clé PRIVÉE, et le script ne l'imprime jamais : ni son
# contenu, ni même une empreinte de son contenu (CLAUDE.md §20).
IDENTITE=$(reglage RESTORE_AGE_IDENTITY_FILE)
[ -n "$IDENTITE" ] \
	|| die "RESTORE_AGE_IDENTITY_FILE doit désigner le fichier de la clé privée « age » qui déchiffre l'archive."
[ -r "$IDENTITE" ] && [ -s "$IDENTITE" ] \
	|| die "RESTORE_AGE_IDENTITY_FILE doit désigner le fichier de la clé privée « age » qui déchiffre l'archive (« $IDENTITE » est illisible ou vide)."

# R26 — l'archive. Sans argument, la plus récente du répertoire : le nom se trie
# lexicographiquement dans l'ordre chronologique, ce que le §3.1 garantit.
ARCHIVE=$ARCHIVE_ARG
if [ -z "$ARCHIVE" ]; then
	SORTIE=$(reglage BACKUP_OUTPUT_DIR)
	SORTIE=${SORTIE:-/var/backups/p2enjoy}
	ARCHIVE=$(find "$SORTIE" -maxdepth 1 -type f -name "$PREFIXE_ARCHIVE-*$SUFFIXE_ARCHIVE" 2>/dev/null | sort | tail -1)
	[ -n "$ARCHIVE" ] \
		|| die "aucune archive à restaurer : « $SORTIE » ne contient aucun fichier « $PREFIXE_ARCHIVE-*$SUFFIXE_ARCHIVE »."
fi
[ -r "$ARCHIVE" ] || die "aucune archive à restaurer : « $ARCHIVE » est introuvable ou illisible."

# R27 — Docker.
require_docker

say "Exercice de restauration"
info "archive     $ARCHIVE"

# --- Déchiffrement (§11.3 point 2) --------------------------------------------------------------

ASSEMBLAGE=$(mktemp -d)
chmod 700 "$ASSEMBLAGE"

# R28 — l'échec de déchiffrement se distingue de l'échec d'extraction : `age` seul, puis `tar`.
# Enchaîner les deux dans un tube ferait attribuer à `tar` une identité qui n'ouvre pas l'archive.
if ! age --decrypt -i "$IDENTITE" -o "$ASSEMBLAGE/archive.tar" "$ARCHIVE" 2>"$ASSEMBLAGE/age.err"; then
	warn "$(head -c 500 "$ASSEMBLAGE/age.err")"
	die "le déchiffrement a échoué : l'identité fournie n'ouvre pas cette archive."
fi
tar -C "$ASSEMBLAGE" -xf "$ASSEMBLAGE/archive.tar"
rm -f "$ASSEMBLAGE/archive.tar"

RACINE=$(find "$ASSEMBLAGE" -mindepth 1 -maxdepth 1 -type d -name "$PREFIXE_ARCHIVE-*" | head -1)
[ -n "$RACINE" ] && [ -f "$RACINE/MANIFESTE.txt" ] \
	|| die "l'archive ne porte pas la racine attendue et son MANIFESTE.txt : elle n'a pas été produite par scripts/backup.sh."

# --- Le manifeste D'ABORD, puis TOUTES les empreintes (§11.3 points 3 et 4) ---------------------
#
# L'ordre n'est pas décoratif. Le manifeste dit comment lire le reste : un format inconnu se refuse
# AVANT de lire des membres qu'on interpréterait de travers. Et les empreintes se vérifient TOUTES
# avant de restaurer quoi que ce soit — restaurer d'abord et vérifier ensuite reviendrait à écrire
# un contenu qu'on sait peut-être corrompu.

manifeste() { grep -E "^$1=" "$RACINE/MANIFESTE.txt" | head -1 | cut -d= -f2- ; }

# R22 — le format.
FORMAT=$(manifeste format_version)
[ "$FORMAT" = "$FORMAT_CONNU" ] \
	|| die "le manifeste annonce le format « ${FORMAT:-absent} », que cet exercice ne sait pas lire (il lit le format $FORMAT_CONNU)."

DEPOT_OBJET=$(manifeste depot_objet)
BUCKET=$(manifeste bucket_objet)
BASE=$(manifeste base_de_donnees)
BASE=${BASE:-postgres}

info "format      $FORMAT ; créée le $(manifeste cree_le) ; profil $(manifeste profil)"
info "dépôt objet $DEPOT_OBJET"

# R23 — les empreintes, RECALCULÉES sur les membres extraits. Elles détectent une corruption
# survenue AVANT le chiffrement — un `pg_dump` tronqué par un disque plein. Une altération
# postérieure, elle, empêche purement et simplement le déchiffrement, le format `age` étant
# authentifié (docs/SPEC-backups.md §3.3).
MEMBRES=0
while IFS=' ' read -r nom taille empreinte; do
	[ -n "$nom" ] || continue
	[ -f "$RACINE/$nom" ] \
		|| die "le membre « $nom » est annoncé par le manifeste mais absent de l'archive : rien n'a été restauré."
	taille_reelle=$(stat -c%s "$RACINE/$nom")
	empreinte_reelle=$(sha256sum "$RACINE/$nom" | awk '{print $1}')
	[ "$taille_reelle" = "$taille" ] && [ "$empreinte_reelle" = "$empreinte" ] \
		|| die "le membre « $nom » ne correspond pas au manifeste : l'archive est corrompue, rien n'a été restauré."
	MEMBRES=$((MEMBRES + 1))
done < <(grep '^membre=' "$RACINE/MANIFESTE.txt" | sed 's/^membre=//')

[ "$MEMBRES" -ge 1 ] || die "le manifeste ne déclare aucun membre : l'archive est inexploitable."
info "empreintes  $MEMBRES membre(s) vérifié(s), toutes conformes"

[ -f "$RACINE/base.dump" ] || die "le membre « base.dump » manque : il n'y a rien à restaurer."
[ -f "$RACINE/pgsodium_root.key" ] \
	|| die "le membre « pgsodium_root.key » manque : sans la clé racine, aucun secret de messagerie ne serait restituable (docs/DAT.md §10)."

# --- L'environnement jetable (§11.1, §11.3 point 5) ---------------------------------------------

HORODATAGE=$(date -u '+%Y%m%dT%H%M%SZ')
# `--suffixe` REND LE NOM PRÉVISIBLE, et il a été ajouté pour une raison mesurée : le refus R24 ne
# pouvait pas être éprouvé autrement. Un harnais qui veut placer un conteneur sur le nom que
# l'exercice s'apprête à prendre doit deviner la seconde à laquelle l'exercice l'aura calculée —
# après le déchiffrement et la vérification des empreintes, dont la durée varie. Le contrôle
# devenait intermittent, c'est-à-dire sans valeur probante ; l'option le rend déterministe. Elle
# sert aussi à l'exploitation, deux exercices lancés dans la même seconde entrant sinon en
# collision. Le préfixe, lui, reste imposé (voir la validation ci-dessus).
DISCRIMINANT=${SUFFIXE_ARG:-$HORODATAGE}
NOM_DB="p2enjoy-restauration-$DISCRIMINANT"
NOM_MINIO="p2enjoy-restauration-objets-$DISCRIMINANT"

# R24 — un nom déjà pris arrête l'exercice. Il ne réutilise ni n'écrase un conteneur qu'il n'a pas
# créé : c'est ce qui rend la garde de destruction sûre, puisqu'elle ne détruira jamais que ce que
# ce script a lui-même fait naître sous ces noms.
for nom in "$NOM_DB" "$NOM_MINIO"; do
	if [ -n "$(docker ps -aq --filter "name=^/$nom$")" ]; then
		die "le conteneur « $nom » existe déjà : l'exercice refuse de réutiliser un environnement qu'il n'a pas créé."
	fi
done

# LA CLÉ RACINE EST MONTÉE DÈS LA CRÉATION, ET C'EST LA CONTRAINTE M9. `pgsodium_getkey.sh` fabrique
# une clé au hasard si le fichier manque au premier démarrage ; la déposer ensuite ne répare rien,
# les secrets restant chiffrés par une clé que le serveur n'a plus. L'ordre est donc imposé par la
# mesure, non par le goût.
cp "$RACINE/pgsodium_root.key" "$ASSEMBLAGE/racine.key"
chmod 644 "$ASSEMBLAGE/racine.key"

# LES SCRIPTS D'INITIALISATION DU DÉPÔT, AUX CHEMINS DE `docker-compose.yml` (M11). `pg_dump` ne
# porte aucun objet global : les rôles ne sont pas dans l'archive. L'environnement jetable reproduit
# donc l'amorçage réel de la pile plutôt que d'inventer le sien.
VOLUMES_INIT=(
	-v "$REPO_ROOT/supabase/docker/volumes/db/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro"
	-v "$REPO_ROOT/supabase/docker/volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro"
	-v "$REPO_ROOT/supabase/docker/volumes/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro"
	-v "$REPO_ROOT/supabase/docker/volumes/db/realtime.sql:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:ro"
)

# AUCUN PORT N'EST PUBLIÉ, ET AUCUN RÉSEAU N'EST REJOINT (M14). C'est plus fort que « des ports
# distincts » : rien n'étant exposé, rien ne peut entrer en collision avec la pile courante. Tout
# passe par `docker exec` et le socket local du conteneur, comme la sauvegarde elle-même.
#
# Le mot de passe posé ici n'ouvre rien : il ne sert qu'à l'amorçage d'un cluster jetable, sans port
# publié, détruit dans la minute. Il n'est ni un secret du dépôt ni celui de la pile.
docker run -d --name "$NOM_DB" \
	--label "com.p2enjoy.restauration=$HORODATAGE" \
	-e POSTGRES_PASSWORD=exercice-jetable-sans-port-publie \
	-e POSTGRES_DB="$BASE" \
	-e POSTGRES_HOST=/var/run/postgresql \
	-e JWT_SECRET=exercice-jetable-jwt-secret-inutilise-0000 \
	-e JWT_EXP=3600 \
	-v "$ASSEMBLAGE/racine.key:/etc/postgresql-custom/pgsodium_root.key:ro" \
	"${VOLUMES_INIT[@]}" \
	"$IMAGE_DB" postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
JETABLE_DB=$NOM_DB
info "jetable     $NOM_DB (image $IMAGE_DB, aucun port publié)"

# R29 — l'attente est plafonnée : un conteneur qui ne démarre pas doit rendre un refus nommé, jamais
# faire tourner l'exercice indéfiniment.
PRET=0
for _ in $(seq 1 "$DELAI_DEMARRAGE"); do
	if docker exec "$NOM_DB" pg_isready -U supabase_admin -h localhost >/dev/null 2>&1; then
		PRET=1
		break
	fi
	sleep 1
done
[ "$PRET" = "1" ] \
	|| die "la base jetable n'a pas démarré en ${DELAI_DEMARRAGE}s : l'exercice s'arrête et détruit son environnement."

# LE SEUL RÔLE QUE LES SCRIPTS DU DÉPÔT NE CRÉENT PAS (M11) : le service Realtime le crée lui-même
# au démarrage dans la pile réelle, et l'exercice ne monte pas ce service. Ses attributs sont ceux
# mesurés sur la pile — NOLOGIN NOINHERIT, aucun autre droit. Sans lui, `pg_restore` rend douze
# erreurs de GRANT et l'exercice ne pourrait plus exiger zéro.
docker exec "$NOM_DB" psql -U supabase_admin -d "$BASE" -q \
	-c "create role supabase_realtime_admin nologin noinherit;" >/dev/null

# --- Restauration (§11.3 point 7) ---------------------------------------------------------------
#
# SOUS `supabase_admin`, ET C'EST LA MESURE M10. `postgres` n'est PAS superutilisateur dans cette
# pile, et `vault.secrets` appartient à `supabase_admin` : restaurer sous `postgres` rend
# « permission denied for table secrets », les cinq secrets ne sont pas restaurés du tout, et RIEN
# ne s'arrête. La base aurait l'apparence de la complétude sans aucun de ses secrets.

set +e
docker exec -i "$NOM_DB" pg_restore -U supabase_admin -d "$BASE" --clean --if-exists --no-owner \
	< "$RACINE/base.dump" > "$ASSEMBLAGE/pg_restore.log" 2>&1
CODE_RESTORE=$?
set -e

ERREURS=$(grep -c '^pg_restore: error' "$ASSEMBLAGE/pg_restore.log" || true)

# R25 — ZÉRO erreur exigée. Tolérer un nombre connu d'erreurs reviendrait à tolérer la suivante :
# un exercice qui accepte « les quatorze erreurs habituelles » accepte silencieusement la quinzième.
if [ "$ERREURS" != "0" ] || [ "$CODE_RESTORE" != "0" ]; then
	warn "$(grep -A1 '^pg_restore: error' "$ASSEMBLAGE/pg_restore.log" | head -c 2000)"
	die "« pg_restore » a rendu $ERREURS erreur(s) (code $CODE_RESTORE) : la restauration n'est pas fidèle."
fi
info "restaurée   base.dump appliqué sous supabase_admin, 0 erreur"

# --- Les objets, si l'archive en porte (§11.3 point 8) ------------------------------------------

if [ "$DEPOT_OBJET" = "minio-local" ] && [ -f "$RACINE/objets.tar" ]; then
	docker run -d --name "$NOM_MINIO" \
		--label "com.p2enjoy.restauration=$HORODATAGE" \
		-e MINIO_ROOT_USER=exercicejetable \
		-e MINIO_ROOT_PASSWORD=exercicejetable \
		"$IMAGE_MINIO" server /data >/dev/null
	JETABLE_MINIO=$NOM_MINIO

	# L'IMAGE MINIO NE PORTE NI `tar` NI `find` (M5). C'est donc le DÉMON Docker qui extrait le flux,
	# exactement comme il l'avait produit à la sauvegarde : `docker cp - <conteneur>:<chemin>` est le
	# miroir de `docker cp <conteneur>:<chemin> -`.
	PRET=0
	for _ in $(seq 1 30); do
		if docker exec "$NOM_MINIO" true >/dev/null 2>&1; then PRET=1; break; fi
		sleep 1
	done
	[ "$PRET" = "1" ] || die "le dépôt objet jetable n'a pas démarré : l'exercice s'arrête et détruit son environnement."

	docker cp - "$NOM_MINIO:/data" < "$RACINE/objets.tar"
	info "objets      restaurés dans $NOM_MINIO (bucket « $BUCKET »)"
fi

# --- Les invariants (§11.4) ---------------------------------------------------------------------
#
# Ils sont LUS sur la pile de référence, jamais codés en dur : un exercice qui porterait les nombres
# du seed deviendrait faux au premier seed modifié, et rougirait pour une raison étrangère à la
# sauvegarde (M16).

REFERENCE=$(docker ps --filter "name=^/p2enjoy-db$" --filter "status=running" --format '{{.Names}}')

# UNE REQUÊTE QUI ÉCHOUE EST UNE RÉPONSE, PAS UN ACCIDENT — corrigé après que le harnais l'eut
# trouvé. `interroger` rendait le code de `psql`, et `VALEUR=$(interroger …)` propage ce code : sous
# `set -euo pipefail`, l'exercice MOURAIT au premier `select` en erreur. C'est précisément ce qui
# arrive au cas q du §12, où `vault.decrypted_secrets` rend « invalid ciphertext » — l'exercice
# s'arrêtait donc sans jamais dire que I1 avait échoué, et rendait un code non nul muet là où il
# devait rendre un diagnostic.
#
# La fonction rend désormais TOUJOURS 0, et le texte de l'erreur devient la valeur de l'invariant.
# Rien n'est masqué : I1 cherche « ERROR » dans ce texte, et les invariants comparés le voient
# différer de la référence. Un `|| true` posé sur l'appel aurait, lui, avalé aussi les vraies
# erreurs de l'exercice.
interroger() {
	local sortie
	set +e
	sortie=$(docker exec "$1" psql -U supabase_admin -d "$BASE" -At -c "$2" 2>&1)
	set -e
	printf '%s' "$sortie"
	return 0
}

# I1 — LE CŒUR. Le déchiffrement effectif d'un secret de Vault est le SEUL invariant qui voie une
# clé racine perdue : mesuré, une restauration faite avec une clé tirée au hasard rend `rc=0`, zéro
# erreur, et TOUS les autres invariants identiques (M12). La comparaison porte sur l'EMPREINTE du
# secret déchiffré, jamais sur son contenu : rien de secret ne traverse cette sortie (M13).
REQUETE_VAULT="select name || ' ' || encode(digest(decrypted_secret,'sha256'),'hex') from vault.decrypted_secrets order by name;"
REQUETES=(
	"I2 secrets de Vault|select count(*) from vault.secrets;"
	"I3 utilisateurs|select count(*) from auth.users;"
	"I3 cards|select count(*) from public.cards;"
	"I3 messages|select count(*) from public.mail_messages;"
	"I4 tables de public|select count(*) from pg_tables where schemaname='public';"
	"I5 politiques RLS|select count(*) from pg_policies where schemaname='public';"
	"I6 tables à RLS active|select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;"
)

say "Invariants"
ANOMALIES=0

VAULT_RESTAURE=$(interroger "$NOM_DB" "$REQUETE_VAULT")
if printf '%s' "$VAULT_RESTAURE" | grep -q 'invalid ciphertext\|ERROR'; then
	warn "I1 déchiffrement de Vault : ÉCHEC — la clé racine de l'archive n'ouvre pas ces secrets."
	warn "$(printf '%s' "$VAULT_RESTAURE" | head -2)"
	ANOMALIES=$((ANOMALIES + 1))
elif [ -z "$VAULT_RESTAURE" ]; then
	warn "I1 déchiffrement de Vault : ÉCHEC — aucun secret déchiffré, la pile restaurée n'en porte pas."
	ANOMALIES=$((ANOMALIES + 1))
else
	info "I1 déchiffrement de Vault : $(printf '%s\n' "$VAULT_RESTAURE" | wc -l) secret(s) déchiffré(s)"
fi

if [ -n "$REFERENCE" ]; then
	info "référence   $REFERENCE (comparaison des deux côtés)"

	VAULT_REFERENCE=$(interroger "$REFERENCE" "$REQUETE_VAULT")
	if [ "$ANOMALIES" = "0" ] && [ "$VAULT_RESTAURE" != "$VAULT_REFERENCE" ]; then
		# Les empreintes diffèrent : les secrets déchiffrés ne sont pas les mêmes. Le détail n'est
		# PAS imprimé — ce sont des empreintes de secrets, et le §20 de CLAUDE.md vaut aussi pour
		# ce qui permettrait de les reconnaître.
		warn "I1 déchiffrement de Vault : les empreintes diffèrent de la référence."
		ANOMALIES=$((ANOMALIES + 1))
	fi

	for entree in "${REQUETES[@]}"; do
		libelle=${entree%%|*}
		requete=${entree#*|}
		valeur_restauree=$(interroger "$NOM_DB" "$requete")
		valeur_reference=$(interroger "$REFERENCE" "$requete")
		if [ "$valeur_restauree" = "$valeur_reference" ]; then
			info "$libelle : $valeur_restauree"
		else
			warn "invariant « $libelle » : la pile restaurée rend $valeur_restauree, la référence rend $valeur_reference."
			ANOMALIES=$((ANOMALIES + 1))
		fi
	done
else
	# PAS DE RÉFÉRENCE — cas d'une restauration sur un hôte de secours. L'exercice vérifie ce qui se
	# vérifie sans elle, et le DIT, plutôt que de laisser croire à une égalité qu'il n'a pas mesurée.
	warn "la pile de référence « p2enjoy-db » ne tourne pas : AUCUNE comparaison n'a eu lieu."
	warn "les invariants ci-dessous sont seulement vérifiés NON NULS."
	for entree in "${REQUETES[@]}"; do
		libelle=${entree%%|*}
		requete=${entree#*|}
		valeur=$(interroger "$NOM_DB" "$requete")
		if [ "$valeur" -gt 0 ] 2>/dev/null; then
			info "$libelle : $valeur"
		else
			warn "invariant « $libelle » : la pile restaurée rend « $valeur », attendu non nul."
			ANOMALIES=$((ANOMALIES + 1))
		fi
	done
fi

# I7 — les objets. Chaque entrée de `objets.tar` doit se retrouver dans le dépôt jetable.
if [ -n "$JETABLE_MINIO" ]; then
	MANQUANTS=0
	while IFS= read -r entree; do
		[ -n "$entree" ] || continue
		case "$entree" in */) continue ;; esac
		docker exec "$NOM_MINIO" test -e "/data/$entree" \
			|| { warn "objet « $entree » absent du dépôt restauré."; MANQUANTS=$((MANQUANTS + 1)); }
	done < <(tar -tf "$RACINE/objets.tar")
	if [ "$MANQUANTS" = "0" ]; then
		info "I7 dépôt objet : $(tar -tf "$RACINE/objets.tar" | grep -cv '/$' || true) objet(s) restauré(s), aucun manquant"
	else
		ANOMALIES=$((ANOMALIES + MANQUANTS))
	fi
else
	info "I7 dépôt objet : sans objet (depot_objet=$DEPOT_OBJET), contrôle non applicable"
fi

# --- Verdict ------------------------------------------------------------------------------------

if [ "$ANOMALIES" != "0" ]; then
	die "l'exercice de restauration a relevé $ANOMALIES anomalie(s) : cette archive ne restitue pas la pile."
fi

say "Restauration prouvée"
info "archive     $(basename "$ARCHIVE")"
info "$MEMBRES membre(s) vérifié(s), base restaurée sans erreur, invariants conformes"
if [ "$CONSERVER" = "1" ]; then
	info "environnement jetable conservé : voir les commandes de destruction ci-dessus"
else
	info "environnement jetable détruit ; la pile courante n'a pas été touchée"
fi
