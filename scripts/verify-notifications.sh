#!/usr/bin/env bash
# @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 2
# @verifies docs/SPEC-notifications.md §13 (modèle, `check` de `type`, clés étrangères, index),
#           §14 (la production, l'auto-mention écartée, l'absence de clé vers la mention),
#           §15 (le seul geste ouvert, les deux refus doubles, la date imposée par la base),
#           §16 (les deux politiques, l'absence des deux autres, aucune publication), §19 (le seed)
# @verifies docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3 (migration 64)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
# @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de la tranche, puis DÉGRADE RÉELLEMENT la migration — une
# dégradation par règle qu'elle porte — et exige que la preuve concernée rougisse. Aucun état
# dégradé ne subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# LA DÉGRADATION LA PLUS UTILE DE CE HARNAIS EST LA PREMIÈRE : elle fait produire une notification
# À L'AUTEUR LUI-MÊME. La table, ses clés, ses politiques, ses privilèges et le trigger survivent
# tous ; seule la DISCRIMINATION disparaît. Une suite qui resterait verte prouverait qu'elle ne
# mesure que la forme du modèle, jamais ce que la production décide.
#
# LA SECONDE EST SANS ÉQUIVALENT DANS LE DÉPÔT : elle retire la SECONDE condition de la politique
# de lecture — celle qui délègue à `app.can_read_card`. Le refus « ce n'est pas ta boîte » tient
# encore ; ce qui tombe est le rattrapage du §14.4, c'est-à-dire la seule raison pour laquelle
# conserver une notification dont la mention a été retirée reste sûr.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0064_notifications.sql
SUITE_SQL=supabase/tests/0062_notifications.test.sql
SUITE_API=e2e/api/notifications.spec.ts
SPEC=docs/SPEC-notifications.md
SEED=supabase/seed/apply-seed.sh

# Les identifiants du seed, stables (docs/SPEC-seed.md §4).
PROFIL_ADMIN=5eed0000-0000-4000-8000-000000000011
PROFIL_BIZDEV=5eed0000-0000-4000-8000-000000000012
PROFIL_VIEWER=5eed0000-0000-4000-8000-000000000013
COMMENTAIRE_D1=5eed0000-0000-4000-8000-0000000000d1
COMMENTAIRE_D2=5eed0000-0000-4000-8000-0000000000d2
CARD_FERMEE=5eed0000-0000-4000-8000-0000000000c1

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
		# Même motif que dans `restaurer` : la migration ne retire pas la table de la publication.
		psql_db -c "alter publication supabase_realtime drop table public.notifications;" \
			>/dev/null 2>&1
		psql_db -c "delete from public.notifications
		             where payload->>'comment_id' is null
		                or payload->>'comment_id' not in ('$COMMENTAIRE_D1', '$COMMENTAIRE_D2');" \
			>/dev/null 2>&1
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

# Rend vrai si la valeur SQL attendue est celle mesurée. Le contrôle NOMME les deux valeurs en cas
# d'écart : un harnais qui dit seulement « échec » oblige à refaire la mesure à la main.
mesurer() {
	local libelle=$1 requete=$2 attendu=$3 obtenu
	obtenu=$(psql_db -c "$requete" 2>/dev/null | tr -d '[:space:]')
	if [ "$obtenu" = "$attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — attendu « $attendu », mesuré « $obtenu »"
	fi
}

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# Remplace un motif dans une copie de la migration, puis l'applique. Le motif est comparé AVANT et
# APRÈS, et l'APPLICATION est vérifiée — leçon de la décision 503 poussée d'un cran par la
# tranche 1 : une migration dégradée que `psql` refuse laisse le produit INTACT, la suite reste
# verte, et le harnais accuse à tort sa propre preuve d'être complaisante. Un faux verdict de
# complaisance est plus dangereux qu'un vrai, puisqu'il invite à affaiblir une preuve saine.
degrader() {
	local avant=$1 apres=$2 nom=$3
	python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if ! cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		restauration_due=true
		if ! psql_db -f - < "$TRAVAIL/degrade.sql" >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation « $nom » NON APPLIQUÉE : psql l'a refusée — $(tail -n 1 "$TRAVAIL/degrade.log")"
			restaurer
			return 1
		fi
		return 0
	fi
	fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	return 1
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	# LA MIGRATION PROPRE NE SAIT PAS EXPRIMER UNE ABSENCE : elle n'ajoute pas la table à la
	# publication, mais elle ne l'en retire pas non plus. Rejouer la migration ne défait donc PAS
	# la dégradation D-F, et le harnais sortirait en laissant le produit publié — exactement le
	# défaut de la décision 108.
	psql_db -c "alter publication supabase_realtime drop table public.notifications;" \
		>/dev/null 2>&1 || true
	# ELLE NE SAIT PAS DÉFAIRE UNE PRODUCTION NON PLUS, et c'est propre à CETTE tranche : les
	# dégradations D-A et D-B font NAÎTRE des notifications que la suite pgTAP compte ensuite. Une
	# ligne surnuméraire laissée ici ferait rougir l'assertion 41 sur un état que plus rien ne
	# produit — même famille de défaut que le tampon de `docker logs` de la décision 471.
	psql_db -c "delete from public.notifications
	             where payload->>'comment_id' is null
	                or payload->>'comment_id' not in ('$COMMENTAIRE_D1', '$COMMENTAIRE_D2');" \
		>/dev/null 2>&1 || true
	psql_db -c "delete from public.card_comment_mentions
	             where comment_id not in ('$COMMENTAIRE_D1', '$COMMENTAIRE_D2');" \
		>/dev/null 2>&1 || true
	psql_db -c "update public.notifications set read_at = null where read_at is not null;" \
		>/dev/null 2>&1 || true
	restauration_due=false
}

# Pose une mention par le propriétaire, ce qui DÉCLENCHE la production, puis rend l'état.
#   $1 = profil mentionné
provoquer() {
	psql_db -c "insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	            values ('5eed0000-0000-4000-8000-0000000000d3', '$1',
	                    '5eed0000-0000-4000-8000-000000000001')
	            on conflict do nothing;" >/dev/null 2>&1 || true
}

eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3 mentionne=${4:-}
	degrader "$avant" "$apres" "$nom" || return 0
	# Certaines dégradations ne se voient QUE si une production a lieu derrière elles : une règle
	# de trigger affaiblie ne laisse aucune trace tant que le trigger ne s'exécute pas.
	if [ -n "$mentionne" ]; then
		provoquer "$mentionne"
	fi
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-064 tranche 2 — la notification"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité : aucun fichier de la tranche n'est orphelin de sa spécification"
# =================================================================================================
# `CLAUDE.md` §5 : chaque fichier porte ses commentaires `@spec` / `@verifies` vers l'unité de
# backlog ET les chapitres.

if head -n 12 "$MIGRATION" | grep -q '@spec CRM-064' \
	&& head -n 12 "$MIGRATION" | grep -q "$SPEC"; then
	ok "traçabilité : $MIGRATION cite CRM-064 et sa spécification"
else
	fail "traçabilité : $MIGRATION n'a pas d'en-tête @spec complet"
fi

for fichier in "$SUITE_SQL" "$SUITE_API"; do
	if head -n 12 "$fichier" | grep -q '@verifies CRM-064' \
		&& head -n 12 "$fichier" | grep -q "$SPEC"; then
		ok "traçabilité : $fichier cite CRM-064 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

# =================================================================================================
echo "2. La forme : la table, ses colonnes, ses clés, ses index"
# =================================================================================================

mesurer "la table \`public.notifications\` existe" \
	"select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'notifications';" 1

mesurer "HUIT colonnes, et huit seulement — aucune \`updated_at\`" \
	"select count(*) from pg_attribute
	  where attrelid = 'public.notifications'::regclass and attnum > 0 and not attisdropped;" 8

mesurer "la clé primaire est TECHNIQUE — une notification est un message, non un lien" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.notifications'::regclass and contype = 'p'
	    and array_length(conkey, 1) = 1;" 1

mesurer "TROIS clés étrangères, dont la composite vers \`cards\`" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.notifications'::regclass and contype = 'f';" 3

mesurer "AUCUNE clé étrangère vers la mention — retirer une mention n'efface pas un message (§14.4)" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.notifications'::regclass and contype = 'f'
	    and confrelid = 'public.card_comment_mentions'::regclass;" 0

mesurer "le \`check\` de \`type\` est FERMÉ sur la seule source livrée (§13.3)" \
	"select count(*) from pg_constraint
	  where conrelid = 'public.notifications'::regclass and contype = 'c'
	    and conname = 'notifications_type_check';" 1

mesurer "l'index du compteur de non-lues est PARTIEL (§13.7)" \
	"select count(*) from pg_index i
	  where i.indrelid = 'public.notifications'::regclass and i.indpred is not null;" 1

# =================================================================================================
echo "3. La production, éprouvée par le geste et non par la forme"
# =================================================================================================
# LA FORME NE DIT RIEN DE CE QUE LA PRODUCTION DÉCIDE. Ces trois contrôles posent réellement une
# mention et relisent ce qui en naît.

psql_db -c "delete from public.card_comment_mentions
             where comment_id = '5eed0000-0000-4000-8000-0000000000d3';" >/dev/null 2>&1 || true

provoquer "$PROFIL_BIZDEV"

mesurer "poser une mention PRODUIT une notification, et elle est adressée au MENTIONNÉ" \
	"select count(*) from public.notifications
	  where payload->>'comment_id' = '5eed0000-0000-4000-8000-0000000000d3'
	    and recipient_id = '$PROFIL_BIZDEV' and type = 'mention'
	    and subject_card_id = '$CARD_FERMEE' and read_at is null;" 1

provoquer "$PROFIL_ADMIN"

mesurer "une AUTO-MENTION ne produit AUCUNE notification (§14.3)" \
	"select count(*) from public.notifications
	  where payload->>'comment_id' = '5eed0000-0000-4000-8000-0000000000d3'
	    and recipient_id = '$PROFIL_ADMIN';" 0

mesurer "mais la mention, elle, RESTE POSÉE : la tranche 1 n'est pas rejugée" \
	"select count(*) from public.card_comment_mentions
	  where comment_id = '5eed0000-0000-4000-8000-0000000000d3'
	    and profile_id = '$PROFIL_ADMIN';" 1

psql_db -c "delete from public.card_comment_mentions
             where comment_id = '5eed0000-0000-4000-8000-0000000000d3'
               and profile_id = '$PROFIL_BIZDEV';" >/dev/null 2>&1

mesurer "retirer la mention n'EFFACE PAS sa notification (§14.4)" \
	"select count(*) from public.notifications
	  where payload->>'comment_id' = '5eed0000-0000-4000-8000-0000000000d3';" 1

psql_db -c "delete from public.card_comment_mentions
             where comment_id = '5eed0000-0000-4000-8000-0000000000d3';
            delete from public.notifications
             where payload->>'comment_id' = '5eed0000-0000-4000-8000-0000000000d3';" >/dev/null 2>&1

# =================================================================================================
echo "4. Les deux refus DOUBLES, et le geste borné à une seule colonne"
# =================================================================================================

mesurer "aucun privilège \`INSERT\` : une notification se PRODUIT (§15.3)" \
	"select has_table_privilege('authenticated', 'public.notifications', 'INSERT');" f

mesurer "aucun privilège \`DELETE\` : la rétention n'est pas tranchée (§15.4)" \
	"select has_table_privilege('authenticated', 'public.notifications', 'DELETE');" f

mesurer "aucune politique \`INSERT\` — la seconde moitié du refus double" \
	"select count(*) from pg_policies where schemaname = 'public'
	  and tablename = 'notifications' and cmd = 'INSERT';" 0

mesurer "aucune politique \`DELETE\` — la seconde moitié du second refus double" \
	"select count(*) from pg_policies where schemaname = 'public'
	  and tablename = 'notifications' and cmd = 'DELETE';" 0

mesurer "la mise à jour est bornée à la SEULE colonne \`read_at\` (§15.2)" \
	"select count(*) from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'notifications'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE';" 1

mesurer "DEUX politiques, et deux seulement (§16.2)" \
	"select count(*) from pg_policies where schemaname = 'public' and tablename = 'notifications';" 2

mesurer "la lecture DÉLÈGUE à \`app.can_read_card\` — une seule écriture de la règle (§16.1)" \
	"select count(*) from pg_policies where schemaname = 'public'
	  and tablename = 'notifications' and policyname = 'notifications_lecture'
	  and qual like '%can_read_card%';" 1

mesurer "la table n'est PAS publiée au temps réel (§16.3)" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'notifications';" 0

# =================================================================================================
echo "5. Ce que le seed livre, et ce qu'il ne livre pas"
# =================================================================================================

mesurer "DEUX notifications, PROVOQUÉES par les deux mentions du seed (§19)" \
	"select count(*) from public.notifications;" 2

mesurer "toutes deux NON LUES — une notification naît non lue" \
	"select count(*) from public.notifications where read_at is null;" 2

mesurer "la LECTRICE n'en porte AUCUNE : aucune mention ne la désigne" \
	"select count(*) from public.notifications where recipient_id = '$PROFIL_VIEWER';" 0

mesurer "chacune désigne l'affaire de son commentaire, jamais rien de son contenu (§13.4)" \
	"select count(*) from public.notifications
	  where subject_card_id = '$CARD_FERMEE'
	    and payload ?& array['comment_id', 'author_id']
	    and not (payload ?| array['body', 'title', 'author_name']);" 2

# =================================================================================================
echo "6. Les preuves de la tranche, rejouées"
# =================================================================================================

if suite_sql_verte; then
	ok "$SUITE_SQL est VERTE"
else
	fail "$SUITE_SQL est ROUGE — $(tail -n 3 "$TRAVAIL/tap.log" | tr '\n' ' ')"
fi

# LA SUITE DE LA TRANCHE 1 DOIT RESTER VERTE SANS AVOIR ÉTÉ MODIFIÉE, et c'est la preuve de
# non-régression NOMMÉE D'AVANCE au §20 : la tranche 2 ajoute une CONSÉQUENCE à la pose d'une
# mention, elle n'en change pas la RÈGLE.
if scripts/run-sql-tests.sh supabase/tests/0061_mentions_commentaires.test.sql \
	>"$TRAVAIL/tranche1.log" 2>&1 && grep -q 'aucune anomalie' "$TRAVAIL/tranche1.log"; then
	ok "la suite de la TRANCHE 1 reste verte : la règle de la mention n'a pas bougé (§20)"
else
	fail "la suite de la TRANCHE 1 rougit — la tranche 2 a changé une règle qu'elle ne devait pas toucher"
fi

# =================================================================================================
echo "7. Dégradations : chaque règle retirée doit faire ROUGIR la preuve"
# =================================================================================================

# D-A — LA PLUS UTILE. La discrimination de l'auto-mention disparaît : le trigger produit pour tout
# le monde, y compris pour l'auteur lui-même. La table, ses clés, ses politiques, ses privilèges et
# le trigger SURVIVENT TOUS ; seule la règle du §14.3 tombe. Une suite qui resterait verte
# prouverait qu'elle ne mesure que la forme du modèle.
eprouver_degradation "la discrimination de l'auto-mention (§14.3)" \
	'	if v_auteur is not null and v_auteur = new.profile_id then
		return null;
	end if;' \
	'	if false then
		return null;
	end if;' \
	"$PROFIL_ADMIN"

# D-B — la comparaison porte sur `auth.uid()` au lieu d'`author_id`. C'EST LE DÉFAUT SUBTIL QUE LE
# §14.3 NOMME : par la vraie route, les deux coïncident, et rien ne se verrait. Sous le
# propriétaire — où `auth.uid()` est NUL, comme sous la clé de service qu'empruntent le seed et les
# harnais —, la discrimination cesse d'opérer et l'auto-mention produit.
eprouver_degradation "la comparaison sur \`author_id\` plutôt que sur \`auth.uid()\` (§14.3)" \
	'	if v_auteur is not null and v_auteur = new.profile_id then' \
	'	if (select auth.uid()) is not null and (select auth.uid()) = new.profile_id then' \
	"$PROFIL_ADMIN"

# D-C — la charge utile porte le CORPS du commentaire. Le §13.4 le refuse sur une mesure : une
# mention survit à la pierre tombale de son commentaire, dont le corps est vidé, si bien qu'un
# instantané survivrait à son propre effacement.
eprouver_degradation "la charge utile qui ne porte AUCUN contenu (§13.4)" \
	"		jsonb_build_object('comment_id', new.comment_id, 'author_id', v_auteur)," \
	"		jsonb_build_object('comment_id', new.comment_id, 'author_id', v_auteur,
		                   'body', (select cc.body from public.card_comments cc
		                             where cc.id = new.comment_id))," \
	"$PROFIL_BIZDEV"

# D-D — la date de lecture redevient celle que le client envoie. Le §15.1 l'interdit : une date
# antidatée fausserait l'ordre de lecture et le compteur de non-lues.
eprouver_degradation "la date de lecture imposée par la base (§15.1)" \
	'	if new.read_at is not null then
		new.read_at := now();
	end if;' \
	'	if false then
		new.read_at := now();
	end if;'

# D-E — le privilège `INSERT` est rendu à `authenticated`. Le refus cesse d'être double, et un
# client pourrait s'écrire des messages — ou en écrire à quelqu'un d'autre (§15.3).
eprouver_degradation "le refus double de l'insertion (§15.3)" \
	'grant select           on public.notifications to authenticated;' \
	'grant select, insert   on public.notifications to authenticated;'

# D-F — le privilège de colonne devient un privilège de table. `type`, `payload` et `recipient_id`
# deviennent modifiables par leur destinataire (§15.2).
eprouver_degradation "la mise à jour bornée à la seule colonne \`read_at\` (§15.2)" \
	'grant update (read_at) on public.notifications to authenticated;' \
	'grant update           on public.notifications to authenticated;'

# D-G — la table est publiée au temps réel. Une surface d'autorisation sans preuve (§16.3).
#
# LA SUBSTITUTION EST UN `ALTER PUBLICATION` NU, SANS AUCUNE APOSTROPHE, ET C'EST DÉLIBÉRÉ : la
# tranche 1 a mesuré qu'un SQL portant des apostrophes est doublé par son passage en argument
# shell, si bien que `psql` refuse le fichier, que le produit reste intact et que le harnais
# accuse à tort sa propre preuve d'être complaisante.
eprouver_degradation "l'absence de publication au temps réel (§16.3)" \
	"alter table public.notifications enable row level security;" \
	"alter table public.notifications enable row level security;
alter publication supabase_realtime add table public.notifications;"

# D-H — la seconde condition de la politique de lecture disparaît. Le refus « ce n'est pas ta
# boîte » tient encore ; ce qui tombe est le RATTRAPAGE du §14.4 — la seule raison pour laquelle
# conserver une notification dont la mention a été retirée reste sûr.
eprouver_degradation "la délégation à \`app.can_read_card\` dans la lecture (§16.1)" \
	'	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
	);' \
	'	using (
		recipient_id = (select auth.uid())
	);'

# =================================================================================================
echo "8. La restauration est CONSTATÉE, jamais supposée"
# =================================================================================================
# Un harnais qui laisse le produit dégradé en sortant fait mesurer un produit amputé à tous ceux
# qui le suivent — c'est la décision 108, et sa seconde occurrence à `CRM-036`.

restaurer

mesurer "après restauration : aucun privilège \`INSERT\`" \
	"select has_table_privilege('authenticated', 'public.notifications', 'INSERT');" f

mesurer "après restauration : la mise à jour est de nouveau bornée à \`read_at\`" \
	"select count(*) from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'notifications'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE';" 1

mesurer "après restauration : la table n'est toujours pas publiée" \
	"select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
	  and schemaname = 'public' and tablename = 'notifications';" 0

mesurer "après restauration : la lecture délègue de nouveau à \`app.can_read_card\`" \
	"select count(*) from pg_policies where schemaname = 'public'
	  and tablename = 'notifications' and policyname = 'notifications_lecture'
	  and qual like '%can_read_card%';" 1

mesurer "après restauration : le seed est intact, DEUX notifications non lues" \
	"select count(*) from public.notifications where read_at is null;" 2

mesurer "après restauration : le seed est intact, deux mentions" \
	"select count(*) from public.card_comment_mentions;" 2

if suite_sql_verte; then
	ok "après restauration : $SUITE_SQL est VERTE — le produit est rendu tel qu'il était"
else
	fail "après restauration : $SUITE_SQL reste ROUGE, le produit n'a PAS été rendu"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
