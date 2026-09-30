#!/usr/bin/env bash
# @verifies CRM-096 (docs/BACKLOG.md) — tranche T2 : le runner tient le registre des migrations
# @verifies docs/DAT.md §3.2 bis (le passage : contrôle des inscrits, contrôle de l'ordre, delta
#           transactionnel, adoption) ; docs/SCHEMA.md §8 (`app.migrations_appliquees`) ;
#           docs/JOURNAL.md décision 616
# @verifies CLAUDE.md §15 (preuve sur une vraie base, pas sur un simulacre), §18 (chaque garde vue
#           rouge sous dégradation)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
# Le VRAI runner (`supabase/docker/migrations-runner/apply-migrations.sh`), exécuté dans l'image de
# la pile (`postgres:17-alpine`, celle du service `migrations-runner`), contre un PostgreSQL 17
# JETABLE, sur des migrations de fixture dont la seconde est la vraie migration du registre (`0082`,
# copiée sous un autre numéro) :
#
#   A. base neuve : adoption, deux fichiers inscrits en mode `adoption`, aux empreintes des fichiers ;
#   B. second passage : RIEN n'est rejoué — la fixture `0001` insère une ligne à chaque application ;
#   C. fichier nouveau et NON idempotent : appliqué une fois, inscrit `application`, jamais rejoué ;
#   D. fichier inscrit modifié : refus, rien d'appliqué ;
#   E. fichier inscrit absent : refus, rien d'appliqué ;
#   F. fichier non inscrit inséré dans le passé : refus, rien d'appliqué ;
#   G. migration en échec : ni appliquée ni inscrite, son effet annulé ;
#   H. nom hors forme : refus avant tout ;
#   I. base peuplée sans registre, puis registre VIDE : deux adoptions, rejeu complet puis inscription ;
#   J. non-complaisance : chaque garde retirée du runner fait tomber sa preuve.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# L'adoption du VRAI répertoire (82 fichiers) sur la pile de développement : c'est la tranche T3
# (`./resetMe.sh`, puis `./runDev.sh` qui n'applique rien). Ici, `postgres` est superutilisateur, ce
# qu'il n'est pas dans l'image Supabase : le registre ne dépend que de sa qualité de PROPRIÉTAIRE de la
# table, que la pile réelle lui donne aussi (`docs/SCHEMA.md` §8).

set -euo pipefail
cd "$(dirname "$0")/.."

checks=0
failures=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

RUNNER="$PWD/supabase/docker/migrations-runner/apply-migrations.sh"
REGISTRE="$PWD/supabase/migrations/0082_registre_migrations.sql"
IMAGE=postgres:17-alpine
BASE="crm-registre-$$"
RESEAU="crm-registre-net-$$"
TRAVAIL=$(mktemp -d)

nettoyer() {
	docker rm -f "$BASE" >/dev/null 2>&1 || true
	docker network rm "$RESEAU" >/dev/null 2>&1 || true
	rm -rf "$TRAVAIL"
}
trap nettoyer EXIT

printf '\033[1mPreuves de CRM-096 — le registre des migrations, sur une base jetable\033[0m\n'

# ---------------------------------------------------------------------------------------------
# La base jetable et ses rôles : ceux que la vraie migration du registre nomme.
# ---------------------------------------------------------------------------------------------
docker network create "$RESEAU" >/dev/null
docker run -d --name "$BASE" --network "$RESEAU" -e POSTGRES_PASSWORD=jetable "$IMAGE" >/dev/null
pret=false
for _ in $(seq 1 60); do
	if docker exec "$BASE" pg_isready -U postgres -q 2>/dev/null \
		&& docker exec "$BASE" psql -U postgres -qAtc 'select 1' >/dev/null 2>&1; then
		pret=true
		break
	fi
	sleep 1
done
[ "$pret" = true ] || { echo "la base jetable ne répond pas" >&2; exit 1; }

sql() { docker exec -i "$BASE" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -qAtc "$2"; }
sql postgres "create role supabase_admin superuser login password 'jetable';
	create role anon nologin; create role authenticated nologin; create role service_role nologin;"

nouvelle_base() {
	sql postgres "create database $1" >/dev/null
	sql "$1" "create schema app" >/dev/null
}

# Un passage du runner, comme Compose le lance : même image, mêmes variables, répertoire monté.
# $1 base, $2 répertoire de migrations, $3 journal, $4 runner (le vrai par défaut). Rend son code.
passage() {
	local runner=${4:-$RUNNER}
	set +e
	docker run --rm --network "$RESEAU" \
		-e PGHOST="$BASE" -e PGPORT=5432 -e PGUSER=postgres -e PGPASSWORD=jetable -e PGDATABASE="$1" \
		-e APPLY_MIGRATIONS=true -e MIGRATIONS_DIR=/migrations \
		-v "$2:/migrations:ro,z" -v "$runner:/usr/local/bin/apply-migrations.sh:ro,z" \
		"$IMAGE" sh /usr/local/bin/apply-migrations.sh >"$3" 2>&1
	local code=$?
	set -e
	return $code
}

empreinte() { sha256sum "$1" | cut -d ' ' -f 1; }
registre() { sql "$1" "select fichier || ':' || mode || ':' || empreinte from app.migrations_appliquees order by fichier"; }
existe() { sql "$1" "select to_regclass('$2') is not null"; }

# Le répertoire de fixture : `0001` compte ses applications, `0002` est la vraie migration du registre.
fixture() {
	local dossier="$TRAVAIL/$1"
	mkdir -p "$dossier"
	printf '%s\n' 'create table if not exists public.sonde (n int);' 'insert into public.sonde values (1);' \
		>"$dossier/0001_socle.sql"
	cp "$REGISTRE" "$dossier/0002_registre_migrations.sql"
	printf '%s' "$dossier"
}

# ---------------------------------------------------------------------------------------------
titre "A. Base neuve : l'adoption inscrit tout ce qu'elle a rejoué"
nouvelle_base a
DA=$(fixture a)
if passage a "$DA" "$TRAVAIL/a1.log" \
	&& [ "$(registre a)" = "0001_socle.sql:adoption:$(empreinte "$DA/0001_socle.sql")
0002_registre_migrations.sql:adoption:$(empreinte "$DA/0002_registre_migrations.sql")" ] \
	&& [ "$(sql a 'select count(*) from public.sonde')" = 1 ] \
	&& grep -q "adoption" "$TRAVAIL/a1.log"; then
	ok "deux fichiers rejoués puis inscrits en mode adoption, aux empreintes des fichiers"
else
	fail "l'adoption d'une base neuve n'inscrit pas ce qu'elle a rejoué : $(tr '\n' ' ' <"$TRAVAIL/a1.log")"
fi

titre "B. Second passage : rien n'est rejoué"
if passage a "$DA" "$TRAVAIL/a2.log" \
	&& [ "$(sql a 'select count(*) from public.sonde')" = 1 ] \
	&& [ "$(sql a 'select count(*) from app.migrations_appliquees')" = 2 ] \
	&& grep -q "0 à appliquer" "$TRAVAIL/a2.log"; then
	ok "le second passage n'applique rien : la sonde n'a reçu qu'une ligne"
else
	fail "le second passage a rejoué ou inscrit quelque chose : $(tr '\n' ' ' <"$TRAVAIL/a2.log")"
fi

titre "C. Un fichier nouveau et NON idempotent : appliqué une fois, jamais rejoué"
printf '%s\n' 'create table public.t3 (n int);' >"$DA/0003_non_idempotente.sql"
if passage a "$DA" "$TRAVAIL/a3.log" \
	&& [ "$(existe a public.t3)" = t ] \
	&& [ "$(sql a "select mode || ':' || empreinte from app.migrations_appliquees where fichier = '0003_non_idempotente.sql'")" \
		= "application:$(empreinte "$DA/0003_non_idempotente.sql")" ] \
	&& passage a "$DA" "$TRAVAIL/a4.log"; then
	ok "0003 appliquée et inscrite en mode application ; le passage suivant ne la rejoue pas (elle échouerait)"
else
	fail "le fichier nouveau n'est pas appliqué une seule fois : $(tr '\n' ' ' <"$TRAVAIL/a3.log" "$TRAVAIL/a4.log" 2>/dev/null)"
fi

titre "D. Un fichier inscrit modifié : refus, rien d'appliqué"
cp "$DA/0001_socle.sql" "$TRAVAIL/0001.orig"
printf '%s\n' '-- corrigée après coup' >>"$DA/0001_socle.sql"
printf '%s\n' 'create table public.t4 (n int);' >"$DA/0004_nouvelle.sql"
if passage a "$DA" "$TRAVAIL/d.log"; then
	fail "le runner applique malgré un fichier inscrit modifié"
elif grep -q "0001_socle.sql a été modifié" "$TRAVAIL/d.log" && [ "$(existe a public.t4)" = f ]; then
	ok "refus qui nomme 0001_socle.sql, et 0004 n'est pas appliquée"
else
	fail "refus sans diagnostic, ou 0004 appliquée : $(tr '\n' ' ' <"$TRAVAIL/d.log")"
fi
cp "$TRAVAIL/0001.orig" "$DA/0001_socle.sql"

titre "E. Un fichier inscrit absent : refus, rien d'appliqué"
mv "$DA/0003_non_idempotente.sql" "$TRAVAIL/"
if passage a "$DA" "$TRAVAIL/e.log"; then
	fail "le runner applique malgré un fichier inscrit absent"
elif grep -q "0003_non_idempotente.sql est absent" "$TRAVAIL/e.log" && [ "$(existe a public.t4)" = f ]; then
	ok "refus qui nomme 0003_non_idempotente.sql, et 0004 n'est pas appliquée"
else
	fail "refus sans diagnostic, ou 0004 appliquée : $(tr '\n' ' ' <"$TRAVAIL/e.log")"
fi
mv "$TRAVAIL/0003_non_idempotente.sql" "$DA/"

titre "F. Un fichier non inscrit inséré dans le passé : refus, rien d'appliqué"
printf '%s\n' 'create table public.tz (n int);' >"$DA/0002_zz_inseree.sql"
if passage a "$DA" "$TRAVAIL/f.log"; then
	fail "le runner applique un fichier inséré avant le dernier inscrit"
elif grep -q "0002_zz_inseree.sql précède le dernier fichier inscrit" "$TRAVAIL/f.log" \
	&& [ "$(existe a public.tz)" = f ] && [ "$(existe a public.t4)" = f ]; then
	ok "refus qui nomme 0002_zz_inseree.sql ; ni elle ni 0004 ne sont appliquées"
else
	fail "refus sans diagnostic, ou fichier appliqué : $(tr '\n' ' ' <"$TRAVAIL/f.log")"
fi
rm "$DA/0002_zz_inseree.sql"

titre "G. Une migration en échec : ni appliquée ni inscrite"
printf '%s\n' 'create table public.t4 (n int);' 'select 1 / 0;' >"$DA/0004_nouvelle.sql"
if passage a "$DA" "$TRAVAIL/g.log"; then
	fail "le runner rend un succès malgré une migration en échec"
elif [ "$(existe a public.t4)" = f ] \
	&& [ "$(sql a "select count(*) from app.migrations_appliquees where fichier = '0004_nouvelle.sql'")" = 0 ] \
	&& ! grep -q "appliqué(s) avec succès" "$TRAVAIL/g.log"; then
	ok "la transaction est annulée : ni la table de 0004 ni son inscription, aucun succès annoncé"
else
	fail "l'échec laisse une trace : $(tr '\n' ' ' <"$TRAVAIL/g.log")"
fi
printf '%s\n' 'create table public.t4 (n int);' >"$DA/0004_nouvelle.sql"
if passage a "$DA" "$TRAVAIL/g2.log" && [ "$(existe a public.t4)" = t ]; then
	ok "corrigée, 0004 s'applique au passage suivant"
else
	fail "0004 corrigée ne s'applique pas : $(tr '\n' ' ' <"$TRAVAIL/g2.log")"
fi

titre "H. Un nom hors forme : refus avant tout"
printf '%s\n' 'create table public.t5 (n int);' >"$DA/0005_Majuscule.sql"
if passage a "$DA" "$TRAVAIL/h.log"; then
	fail "le runner accepte un nom hors de la forme NNNN_nom.sql"
elif grep -q "hors de la forme" "$TRAVAIL/h.log" && [ "$(existe a public.t5)" = f ]; then
	ok "0005_Majuscule.sql refusé, rien d'appliqué"
else
	fail "refus sans diagnostic : $(tr '\n' ' ' <"$TRAVAIL/h.log")"
fi
rm "$DA/0005_Majuscule.sql"

titre "I. Base peuplée sans registre, puis registre vide : deux adoptions"
nouvelle_base i
DI=$(fixture i)
sql i "create table if not exists public.sonde (n int); insert into public.sonde values (1);" >/dev/null
if passage i "$DI" "$TRAVAIL/i1.log" \
	&& [ "$(sql i 'select count(*) from public.sonde')" = 2 ] \
	&& [ "$(sql i "select count(*) from app.migrations_appliquees where mode = 'adoption'")" = 2 ]; then
	ok "base peuplée adoptée : 0001 rejouée (la sonde passe à deux lignes), deux fichiers inscrits"
else
	fail "l'adoption d'une base peuplée échoue : $(tr '\n' ' ' <"$TRAVAIL/i1.log")"
fi
sql i "delete from app.migrations_appliquees" >/dev/null
if passage i "$DI" "$TRAVAIL/i2.log" \
	&& [ "$(sql i 'select count(*) from public.sonde')" = 3 ] \
	&& [ "$(sql i "select count(*) from app.migrations_appliquees where mode = 'adoption'")" = 2 ]; then
	ok "registre vide : nouvelle adoption, jamais d'inscription en mode application de fichiers rejoués"
else
	fail "un registre vide n'est pas adopté : $(tr '\n' ' ' <"$TRAVAIL/i2.log")"
fi

# ---------------------------------------------------------------------------------------------
titre "J. Non-complaisance : chaque garde retirée fait tomber sa preuve"
# Chaque dégradation est une copie du runner ; le vrai n'est jamais modifié.
degrader() {
	local nom=$1 avant=$2 apres=$3
	local copie="$TRAVAIL/runner-$nom.sh"
	python3 - "$RUNNER" "$copie" "$avant" "$apres" <<'PY'
import sys
source, cible, avant, apres = sys.argv[1:5]
texte = open(source, encoding='utf-8').read()
if texte.count(avant) != 1:
    sys.exit(f"motif introuvable ou ambigu : {avant!r}")
open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres, 1))
PY
	printf '%s' "$copie"
}

# Une base adoptée avec 0001, 0002 et 0003, pour chaque dégradation.
base_adoptee() {
	nouvelle_base "$1"
	local dossier
	dossier=$(fixture "$1")
	passage "$1" "$dossier" "$TRAVAIL/$1-adoption.log"
	printf '%s\n' 'create table public.t3 (n int);' >"$dossier/0003_non_idempotente.sql"
	passage "$1" "$dossier" "$TRAVAIL/$1-0003.log"
	printf '%s' "$dossier"
}

R=$(degrader empreinte '[ "$(empreinte "$MIGRATIONS_DIR/$fichier")" = "$attendue" ] \' 'true || [ "$(empreinte "$MIGRATIONS_DIR/$fichier")" = "$attendue" ] \')
DJ=$(base_adoptee j1)
printf '%s\n' '-- corrigée après coup' >>"$DJ/0001_socle.sql"
if passage j1 "$DJ" "$TRAVAIL/j1.log" "$R"; then
	ok "sans le contrôle d'empreinte, le fichier modifié passe : la preuve D tomberait"
else
	fail "dégradation de l'empreinte non vue : $(tr '\n' ' ' <"$TRAVAIL/j1.log")"
fi

R=$(degrader ordre '		if [ "$(printf '"'"'%s\n%s\n'"'"' "$nom" "$dernier" | LC_ALL=C sort | head -n 1)" = "$nom" ]; then' '		if false; then')
DJ=$(base_adoptee j2)
printf '%s\n' 'create table public.tz (n int);' >"$DJ/0002_zz_inseree.sql"
if passage j2 "$DJ" "$TRAVAIL/j2.log" "$R" && [ "$(existe j2 public.tz)" = t ]; then
	ok "sans le contrôle d'ordre, le fichier inséré dans le passé s'applique : la preuve F tomberait"
else
	fail "dégradation de l'ordre non vue : $(tr '\n' ' ' <"$TRAVAIL/j2.log")"
fi

R=$(degrader delta '		*"
$nom:"*) continue ;;' '		*"
$nom:"*) ;;')
DJ=$(base_adoptee j3)
# Sans le saut, un fichier inscrit tombe dans le contrôle d'ordre, qui le refuse : le second passage
# d'une base à jour échoue au lieu de ne rien appliquer.
if passage j3 "$DJ" "$TRAVAIL/j3.log" "$R"; then
	fail "dégradation du delta non vue : le passage d'une base à jour réussit encore"
else
	ok "sans le saut des inscrits, le passage d'une base à jour échoue : la preuve B tomberait"
fi

R=$(degrader transaction '			--single-transaction --file "$1" --file "$INSCRIPTION"' '			--single-transaction --file "$INSCRIPTION"
		PGUSER=$migration_role psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
			--single-transaction --file "$1"')
DJ=$(base_adoptee j4)
printf '%s\n' 'create table public.t4 (n int);' 'select 1 / 0;' >"$DJ/0004_nouvelle.sql"
passage j4 "$DJ" "$TRAVAIL/j4.log" "$R" || true
if [ "$(sql j4 "select count(*) from app.migrations_appliquees where fichier = '0004_nouvelle.sql'")" = 1 ]; then
	ok "inscrite hors de sa transaction, une migration en échec reste inscrite : la preuve G tomberait"
else
	fail "dégradation de la transaction non vue : $(tr '\n' ' ' <"$TRAVAIL/j4.log")"
fi

R=$(degrader adoption '		psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --single-transaction --file "$INSCRIPTION"
		echo' '		echo')
nouvelle_base j5
DJ=$(fixture j5)
passage j5 "$DJ" "$TRAVAIL/j5.log" "$R" || true
if [ "$(sql j5 'select count(*) from app.migrations_appliquees')" = 0 ]; then
	ok "sans l'inscription de l'adoption, le registre reste vide : la preuve A tomberait"
else
	fail "dégradation de l'adoption non vue : $(tr '\n' ' ' <"$TRAVAIL/j5.log")"
fi

titre "Bilan"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '  \033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
	exit 1
fi
