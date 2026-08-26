-- @spec CRM-064 (docs/BACKLOG.md) — tranche 3a : la surface de réception
-- @spec docs/SPEC-notifications.md §25.1 (la table est publiée dans le même changement que
--       l'écran qui l'écoute), §16.3 (la ligne de base que cette migration change)
-- @spec docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3
--
-- CETTE MIGRATION NE FAIT QU'UNE CHOSE, ET C'EST DÉLIBÉRÉ : elle publie `public.notifications`
-- au temps réel. Aucune colonne, aucune politique, aucun privilège ne bouge — la tranche 3a ne
-- change AUCUNE règle de la table, elle lui donne une surface. `0062_notifications.test.sql`
-- doit rester vert sans autre modification que l'assertion de publication, et
-- `0061_mentions_commentaires.test.sql` sans aucune.
--
-- MESURÉ le 2026-08-26, avant cette migration (docs/SPEC-notifications.md §21, M13) :
--
--   select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime'
--     => public.card_comments      (et elle seule)
--
-- Le §16.3 de la spécification avait FIGÉ cette absence par une assertion, en écrivant la
-- condition de sa levée : « la tranche 3 publiera la table dans le même changement que l'écran
-- qui l'écoute ». La condition est remplie. La levée se fait donc PAR LIVRAISON, jamais par
-- précaution — publier une table que personne n'écoute reviendrait à poser une surface
-- d'autorisation sans preuve.
--
-- LE TEMPS RÉEL EST UNE SURFACE D'AUTORISATION, et c'est la seule raison pour laquelle cette
-- migration mérite d'exister seule. `realtime.apply_rls` évalue la politique `SELECT` de la table
-- pour le rôle et les revendications de CHAQUE abonné : `notifications_lecture` exige
-- `recipient_id = auth.uid()` ET `app.can_read_card(subject_card_id)`, si bien qu'un membre qui
-- n'est pas le destinataire ne reçoit RIEN, et qu'un destinataire dont le droit sur l'affaire
-- retombe cesse de recevoir. C'est une propriété qui se PROUVE : les lignes u, v et w du §27
-- l'exercent avec les jetons réels des trois profils.
--
-- `REPLICA IDENTITY` reste à sa valeur par défaut — la clé primaire. Elle suffit : aucune
-- suppression n'est exposée (§15.4), et le marquage lu est un `UPDATE` dont la ligne d'arrivée
-- est lisible par son destinataire. C'est le choix de la migration 0015 pour `card_comments`,
-- repris sans changement et pour le même motif.

-- =============================================================================================
-- 1. Publication au temps réel — docs/SPEC-notifications.md §25.1
-- =============================================================================================
-- Idempotent, et il le doit : le `migrations-runner` ne tient aucun registre et rejoue le
-- répertoire entier à chaque démarrage. `alter publication … add table` rend `42710` sur une
-- table déjà publiée. C'est le bloc de la migration 0015 §8, transposé à cette table.

do $$
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		-- La publication est posée par l'image Supabase. La créer ici garde la migration
		-- rejouable sur une base neuve dont l'image ne l'aurait pas fait.
		create publication supabase_realtime;
	end if;

	if not exists (
		select 1 from pg_publication_tables
		 where pubname    = 'supabase_realtime'
		   and schemaname = 'public'
		   and tablename  = 'notifications'
	) then
		alter publication supabase_realtime add table public.notifications;
	end if;
end;
$$;

notify pgrst, 'reload schema';
