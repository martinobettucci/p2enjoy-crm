-- @verifies CRM-142 (docs/BACKLOG.md) — la santé d'un rattachement sous un seul contrôle de droits : `app.health_context`
--           rend, pour chaque rattachement du seed et sous chaque profil, exactement ce que rendait sa version d'avant
--           sous la RLS — sauf l'appel direct sur un rattachement illisible, qui rend vide ; le contrôle porte sur
--           l'identité de l'appelant ; la clé de service et le propriétaire lisent tout, comme avant ; un rattachement forgé
--           n'apprend rien, et un illisible ne se distingue pas d'un inconnu ; un jeton d'utilisateur ne peut pas se
--           servir du contournement (ni `SET ROLE`, ni `set_config('role')`, ni un claim `role` forgé) ;
--           `SECURITY DEFINER` à `search_path` vide, fermée à `anon`
-- @verifies docs/SPEC-analytique.md §13.10 (l'équivalence des droits ; qui est l'appelant) ; docs/SCHEMA.md « Migration `0171` » ; docs/JOURNAL.md décisions 888 et 890 ; CLAUDE.md §10 (la règle d'accès vérifiée par une requête directe)
--
-- L'ANCIENNE VERSION est recréée dans la transaction (`pg_temp.health_context_avant`, la définition de la `0134`, telle
-- quelle, `SECURITY INVOKER`) : la comparaison porte sur les deux fonctions, ligne à ligne, sous le même jeton. Les
-- rattachements sont ceux du seed, lus par le propriétaire ; les profils sont ceux du seed (`…0011` admin, `…0012`
-- business_developer, `…0013` viewer) et un compte qui n'est membre de rien. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- La définition de la `0134`, recopiée sans changement : la référence de l'équivalence.
create function pg_temp.health_context_avant(p_card public.card_placements)
 returns table(seuil_jours integer, jours_dans_etape integer, jours_sans_contact integer, probabilite numeric)
 language sql stable set search_path to ''
as $function$
	select coalesce(ws.stale_after_days, n.default_stale_after_days),
	       floor(extract(epoch from (now() - p_card.entered_step_at)) / 86400.0)::integer,
	       floor(extract(epoch from (now() - coalesce(app.health_last_contact(p_card.card_id), a.created_at)))
	             / 86400.0)::integer,
	       coalesce(p_card.probability_override, ws.probability_override, n.default_probability)
	  from public.workflow_steps ws
	  join public.cards a on a.id = p_card.card_id
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 where ws.id = p_card.current_step_id
	   and n.kind = 'open'
	   and p_card.archived_at is null
	   and a.deleted_at is null;
$function$;

-- Tous les rattachements de la base, lus par le propriétaire : l'appelant ne les lit pas tous, et c'est voulu.
create temp table pg_temp.lignes as select p as ligne from public.card_placements p;
create temp table pg_temp.ecarts (profil text, id uuid, lisible boolean, avant jsonb, apres jsonb);
grant select on pg_temp.lignes to authenticated;
grant insert on pg_temp.ecarts to authenticated;

create function pg_temp.comparer(profil text, utilisateur uuid) returns void language plpgsql as $$
begin
	perform pg_temp.endosser(utilisateur);
	insert into pg_temp.ecarts
	select profil, (l.ligne).id, app.can_read_channel((l.ligne).channel_id),
	       (select to_jsonb(x) from pg_temp.health_context_avant(l.ligne) x),
	       (select to_jsonb(x) from app.health_context(l.ligne) x)
	  from pg_temp.lignes l;
	reset role;
end;
$$;

select pg_temp.comparer('admin', '5eed0000-0000-4000-8000-000000000011');
select pg_temp.comparer('business_developer', '5eed0000-0000-4000-8000-000000000012');
select pg_temp.comparer('viewer', '5eed0000-0000-4000-8000-000000000013');
select pg_temp.comparer('non membre', 'b0000000-0000-4000-8000-0000000000ff');

-- Les rôles qui contournent la RLS : la clé de service, sans jeton d'utilisateur ; le propriétaire, sans `SET ROLE`.
grant insert on pg_temp.ecarts to service_role;
grant select on pg_temp.lignes to service_role;
create function pg_temp.comparer_privilegie(profil text, role_sql text) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	if role_sql is not null then
		execute format('set local role %I', role_sql);
	end if;
	insert into pg_temp.ecarts
	select profil, (l.ligne).id, null,
	       (select to_jsonb(x) from pg_temp.health_context_avant(l.ligne) x),
	       (select to_jsonb(x) from app.health_context(l.ligne) x)
	  from pg_temp.lignes l;
	reset role;
end;
$$;
select pg_temp.comparer_privilegie('service_role', 'service_role');
select pg_temp.comparer_privilegie('proprietaire', null);

-- ------------------------------------------------------------------------------------------------------------------
-- La forme de la fonction
-- ------------------------------------------------------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'app.health_context(public.card_placements)'::regprocedure),
	'1 — `app.health_context` est `SECURITY DEFINER`');
select is((select proconfig from pg_proc where oid = 'app.health_context(public.card_placements)'::regprocedure),
	array['search_path=""'], '2 — à `search_path` vide');
select ok(not has_function_privilege('anon', 'app.health_context(public.card_placements)', 'execute'),
	'3 — l''anonyme ne l''exécute pas');
select is((select bool_or(prosecdef) from pg_proc
            where oid in ('public.health_momentum(public.card_placements)'::regprocedure,
                          'public.health_commercial(public.card_placements)'::regprocedure,
                          'app.health_last_contact(uuid)'::regprocedure)), false,
	'4 — les deux scores et le dernier contact restent `SECURITY INVOKER`');

-- ------------------------------------------------------------------------------------------------------------------
-- L'équivalence : un rattachement lisible rend exactement la même chose qu'avant, sous chaque profil.
-- ------------------------------------------------------------------------------------------------------------------
select is((select count(*) from pg_temp.ecarts where profil = 'admin' and lisible and avant is distinct from apres),
	0::bigint, '5 — administratrice : chaque rattachement lisible rend la même santé qu''avant');
select is((select count(*) from pg_temp.ecarts where profil = 'business_developer' and lisible and avant is distinct from apres),
	0::bigint, '6 — business developer : de même');
select is((select count(*) from pg_temp.ecarts where profil = 'viewer' and lisible and avant is distinct from apres),
	0::bigint, '7 — lectrice : de même');
select ok((select count(*) from pg_temp.ecarts where profil = 'viewer' and lisible and apres is not null) > 0
      and (select count(*) from pg_temp.ecarts where profil = 'admin' and lisible and apres is not null) > 0,
	'8 — la comparaison n''est pas triviale : des santés non vides sont comparées');

-- Un rattachement illisible ne rend jamais rien ; avant, il ne rendait rien non plus, sauf l'appel direct sur une affaire
-- lisible par un autre channel — le seul cas devenu plus strict.
select is((select count(*) from pg_temp.ecarts where not lisible and apres is not null), 0::bigint,
	'9 — sous aucun profil, un rattachement illisible ne rend de santé');
select is((select count(*) from pg_temp.ecarts
            where not lisible and avant is distinct from apres
              and not exists (select 1 from pg_temp.lignes l, public.card_placements autre
                               where (l.ligne).id = pg_temp.ecarts.id and autre.card_id = (l.ligne).card_id
                                 and autre.id <> (l.ligne).id)),
	0::bigint,
	'10 — hors le cas strict (une affaire à plusieurs rattachements), l''illisible rendait déjà vide');
select is((select count(*) from pg_temp.ecarts where profil = 'non membre' and (avant is not null or apres is not null)),
	0::bigint, '11 — un compte qui n''est membre de rien n''obtient aucune santé, ni avant ni après');

select is((select count(*) from pg_temp.ecarts where profil in ('service_role', 'proprietaire') and avant is distinct from apres),
	0::bigint, '12 — la clé de service et le propriétaire, qui contournaient la RLS, obtiennent la même santé qu''avant');
select ok((select count(*) from pg_temp.ecarts where profil = 'service_role' and apres is not null)
          = (select count(*) from pg_temp.ecarts where profil = 'proprietaire' and apres is not null)
      and (select count(*) from pg_temp.ecarts where profil = 'service_role' and apres is not null)
          > (select count(*) from pg_temp.ecarts where profil = 'viewer' and apres is not null),
	'13 — la clé de service lit la santé de tout rattachement ouvert, plus que la lectrice');

-- Le contrôle porte sur l'identité de l'appelant (`auth.uid()`), jamais sur le propriétaire de la fonction : un même
-- rattachement rend une santé à l'administratrice et rien à la lectrice qui ne lit pas son channel.
select ok(exists (select 1 from pg_temp.ecarts a join pg_temp.ecarts v on v.id = a.id
                   where a.profil = 'admin' and a.apres is not null
                     and v.profil = 'viewer' and not v.lisible and v.apres is null),
	'14 — même rattachement : une santé pour l''administratrice, rien pour la lectrice qui ne lit pas son channel');

-- ------------------------------------------------------------------------------------------------------------------
-- Le rattachement forgé : la fonction relit la ligne en base, elle ne croit pas l'appelant.
-- ------------------------------------------------------------------------------------------------------------------
create temp table pg_temp.vraie as
	select l.ligne from pg_temp.lignes l
	 where (l.ligne).archived_at is null
	   and exists (select 1 from pg_temp.ecarts e where e.id = (l.ligne).id and e.profil = 'viewer' and e.apres is not null)
	 limit 1;
grant select on pg_temp.vraie to authenticated;
create temp table pg_temp.forgees (cas text, rendu jsonb);
grant insert on pg_temp.forgees to authenticated;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
insert into pg_temp.forgees
select 'reelle', (select to_jsonb(x) from app.health_context(v.ligne) x) from pg_temp.vraie v;
reset role;

-- Les valeurs inventées : même identifiant, probabilité et date d'entrée changées.
create temp table pg_temp.inventee as select ligne from pg_temp.vraie;
update pg_temp.inventee
   set ligne.probability_override = 99, ligne.entered_step_at = '2000-01-01T00:00:00Z';
grant select on pg_temp.inventee to authenticated;
create temp table pg_temp.inconnue as select ligne from pg_temp.vraie;
update pg_temp.inconnue set ligne.id = gen_random_uuid();
grant select on pg_temp.inconnue to authenticated;
-- Un rattachement qui existe, ouvert, que la lectrice ne lit pas : son identifiant, des valeurs quelconques.
create temp table pg_temp.illisible as
	select l.ligne from pg_temp.lignes l
	 where exists (select 1 from pg_temp.ecarts e where e.id = (l.ligne).id and e.profil = 'viewer' and not e.lisible)
	   and exists (select 1 from pg_temp.ecarts e where e.id = (l.ligne).id and e.profil = 'admin' and e.apres is not null)
	 limit 1;
grant select on pg_temp.illisible to authenticated;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
insert into pg_temp.forgees select 'inventee', (select to_jsonb(x) from app.health_context(i.ligne) x) from pg_temp.inventee i;
insert into pg_temp.forgees select 'inconnue', (select to_jsonb(x) from app.health_context(i.ligne) x) from pg_temp.inconnue i;
insert into pg_temp.forgees
select 'illisible', (select count(*)::text::jsonb from app.health_context(i.ligne) x) from pg_temp.illisible i;
insert into pg_temp.forgees
select 'inconnue, compte', (select count(*)::text::jsonb from app.health_context(i.ligne) x) from pg_temp.inconnue i;
reset role;

select is((select rendu from pg_temp.forgees where cas = 'inventee'), (select rendu from pg_temp.forgees where cas = 'reelle'),
	'15 — des valeurs inventées sur un vrai identifiant rendent la santé calculée sur la ligne en base');
select is((select rendu from pg_temp.forgees where cas = 'inconnue'), null,
	'16 — un identifiant inconnu ne rend rien');
select ok((select rendu from pg_temp.forgees where cas = 'reelle') is not null,
	'17 — la ligne réelle choisie a une santé : les preuves 15 et 16 ne sont pas triviales');
select ok((select rendu from pg_temp.forgees where cas = 'illisible') = '0'::jsonb
      and (select rendu from pg_temp.forgees where cas = 'illisible') = (select rendu from pg_temp.forgees where cas = 'inconnue, compte'),
	'18 — l''identifiant d''un rattachement illisible rend le même ensemble vide qu''un identifiant inconnu : rien ne dit qu''il existe');

-- ------------------------------------------------------------------------------------------------------------------
-- Le contournement repose sur l'ATTRIBUT du rôle (`rolbypassrls`, `rolsuper`), jamais sur un claim : la lectrice ne peut
-- ni prendre le rôle de service, ni le faire croire par son jeton.
-- ------------------------------------------------------------------------------------------------------------------
create temp table pg_temp.tentatives (cas text, resultat text);
grant insert on pg_temp.tentatives to authenticated;
create function pg_temp.tenter() returns void language plpgsql as $$
begin
	perform pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
	begin
		execute 'set local role service_role';
		insert into pg_temp.tentatives values ('set role', 'accepté');
	exception when others then
		insert into pg_temp.tentatives values ('set role', sqlstate);
	end;
	begin
		perform set_config('role', 'service_role', true);
		insert into pg_temp.tentatives values ('set_config role', 'accepté');
	exception when others then
		insert into pg_temp.tentatives values ('set_config role', sqlstate);
	end;
	-- Le claim forgé : l'identité de la lectrice, et le rôle de service écrit dans le jeton.
	perform set_config('request.jwt.claims',
		json_build_object('sub', '5eed0000-0000-4000-8000-000000000013', 'role', 'service_role')::text, true);
	insert into pg_temp.tentatives values ('role courant', current_setting('role'));
	insert into pg_temp.tentatives
	select 'claim forgé', (select count(*) from app.health_context(i.ligne))::text from pg_temp.illisible i;
	reset role;
end;
$$;
select pg_temp.tenter();

select is((select resultat from pg_temp.tentatives where cas = 'set role'), '42501',
	'19 — sous le jeton de la lectrice, `SET ROLE service_role` est refusé (permission denied)');
select is((select resultat from pg_temp.tentatives where cas = 'set_config role'), '42501',
	'20 — `set_config(''role'', ''service_role'')` aussi');
select is((select resultat from pg_temp.tentatives where cas = 'role courant'), 'authenticated',
	'21 — un claim `role` forgé ne change pas le rôle courant');
select is((select resultat from pg_temp.tentatives where cas = 'claim forgé'), '0',
	'22 — et le rattachement qu''elle ne lit pas reste sans santé');

select * from finish();
rollback;
