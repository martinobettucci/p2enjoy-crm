-- @spec CRM-056 (docs/BACKLOG.md) — dossiers IMAP imbriqués
-- @spec docs/SPEC-mail-subsystem.md §4.5 (dossiers IMAP), §17.1 (ce que la mesure a établi),
--       §17.2 (ce que l'unité livre)
-- @spec docs/SCHEMA.md §12 (`mail_folder_map`)
-- @spec docs/JOURNAL.md décision 323
--
-- LA TABLE N'EST PAS UNE COMMODITÉ, ET LA MESURE L'A ÉTABLI (§17.1).
--
-- Créer `CRM/Conseil & IA` puis relire la liste des dossiers rend `CRM/Conseil &- IA` : le serveur
-- applique l'UTF-7 modifié de la RFC 3501. Redemander plus tard « Conseil & IA » ne trouverait
-- donc rien. La correspondance est le SEUL chemin de retour, et elle conserve les DEUX noms — le
-- demandé et le créé —, non l'un ou l'autre.

create table if not exists public.mail_folder_map (
	id           uuid primary key default gen_random_uuid(),
	account_id   uuid not null references public.mail_inbound_accounts (id) on delete cascade,
	-- Ce que le dossier représente. Les trois niveaux de l'arborescence `CRM/<Track>/<Channel>/<Card>`.
	entity_type  text not null,
	entity_id    uuid not null,
	-- CE QUE LE PRODUIT A DEMANDÉ, après assainissement — et ce que le SERVEUR a réellement créé.
	-- Les deux, parce qu'ils diffèrent (§17.1), et que le second seul ne dirait pas d'où il vient.
	requested_path text not null,
	actual_path    text not null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint mail_folder_map_entite
		check (entity_type in ('track', 'channel', 'card')),
	constraint mail_folder_map_chemin_demande
		check (char_length(btrim(requested_path)) between 1 and 1024),
	constraint mail_folder_map_chemin_reel
		check (char_length(btrim(actual_path)) between 1 and 1024),
	-- Un compte ne porte qu'un dossier par entité : deux dossiers pour un même track feraient
	-- diverger l'arborescence sans que rien ne le dise.
	constraint mail_folder_map_unicite unique (account_id, entity_type, entity_id)
);

comment on table public.mail_folder_map is
	'CRM-056 — correspondance entre une entité du produit et le dossier IMAP qui la porte. Les '
	'DEUX chemins sont conservés : le serveur ré-encode les noms (UTF-7 modifié, RFC 3501), et '
	'redemander le nom souhaité ne retrouverait pas le dossier. docs/SPEC-mail-subsystem.md §17.1.';

comment on column public.mail_folder_map.actual_path is
	'Le chemin tel que le SERVEUR l''a rendu. `Conseil & IA` revient `Conseil &- IA` — mesuré.';

create index if not exists mail_folder_map_entite_idx
	on public.mail_folder_map (entity_type, entity_id);

drop trigger if exists mail_folder_map_updated_at on public.mail_folder_map;
create trigger mail_folder_map_updated_at
	before update on public.mail_folder_map
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- L'assainissement d'un segment de chemin — §4.5
-- =============================================================================================
--
-- IL VIT EN BASE PARCE QUE LE NOM VIENT DE LA BASE : un track se renomme par une mise à jour, et
-- la règle qui dérive son dossier doit être au même endroit que la donnée. Le serveur, lui,
-- n'assainit rien — une contre-oblique passe telle quelle (§17.1) —, et le produit ne peut donc
-- pas s'en remettre à son refus pour attraper ses propres erreurs.

create or replace function app.assainir_segment_dossier(nom text)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when pg_catalog.btrim(v.propre) = '' then 'sans-nom'
		else pg_catalog.left(pg_catalog.btrim(v.propre), 120)
	end
	from (
		select pg_catalog.regexp_replace(
			-- Le DÉLIMITEUR du serveur en premier : un `/` dans un nom de track créerait un
			-- niveau d'arborescence que personne n'a demandé.
			pg_catalog.regexp_replace(coalesce(nom, ''), '[/\\%*"[:cntrl:]]', ' ', 'g'),
			'\s+', ' ', 'g'
		) as propre
	) v;
$$;

comment on function app.assainir_segment_dossier(text) is
	'CRM-056 §4.5 — un segment de chemin IMAP sûr. Le délimiteur et les caractères interdits sont '
	'remplacés par une espace, jamais retirés en silence : « A/B » devient « A B » et reste '
	'lisible. Un nom vide devient `sans-nom` plutôt que de produire un chemin à segment vide.';

-- Le chemin souhaité d'une card, dérivé de son track, de son channel et de son titre.
-- ELLE VIT DANS `public`, ET C'EST MESURÉ — comme les fonctions de `CRM-052` : PostgREST n'expose
-- que `public`, et une fonction du schéma `app` serait inappelable par le service. `app` porte les
-- auxiliaires, `public` porte ce qui s'appelle.
create or replace function public.chemin_dossier_card(p_card_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
	select 'CRM/'
	       || app.assainir_segment_dossier(t.name) || '/'
	       || app.assainir_segment_dossier(ch.name) || '/'
	       || app.assainir_segment_dossier(c.title)
	  from public.cards c
	  join public.channels ch on ch.id = c.channel_id
	  join public.tracks t on t.id = ch.track_id
	 where c.id = p_card_id;
$$;

comment on function public.chemin_dossier_card(uuid) is
	'CRM-056 §4.5 — `CRM/<Track>/<Channel>/<Card>`, chaque segment assaini. C''est le chemin '
	'DEMANDÉ ; celui que le serveur crée peut différer, et `mail_folder_map` garde les deux.';

alter table public.mail_folder_map enable row level security;

-- La correspondance dit dans quelle BOÎTE un dossier a été créé : elle suit le compte, comme les
-- occurrences de `CRM-054`.
drop policy if exists mail_folder_map_lecture on public.mail_folder_map;
create policy mail_folder_map_lecture
	on public.mail_folder_map
	for select
	to authenticated
	using (
		exists (
			select 1
			  from public.mail_inbound_accounts a
			 where a.id = account_id
			   and (a.owner_id = (select auth.uid()) or app.is_workspace_admin(a.workspace_id))
		)
	);

revoke all on public.mail_folder_map from anon, authenticated;
grant select on public.mail_folder_map to authenticated;
grant all privileges on public.mail_folder_map to service_role;

revoke all on function public.chemin_dossier_card(uuid) from public, anon, authenticated;
grant execute on function public.chemin_dossier_card(uuid) to service_role;

drop function if exists app.chemin_dossier_card(uuid);
