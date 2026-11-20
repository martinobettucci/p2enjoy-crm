-- @spec CRM-159 (docs/BACKLOG.md) — tranche T1 : les pastilles cachées en base — le drapeau `hidden` de `mail_labels`,
--       Spam cochée dans chaque espace et dans les défauts d'un espace créé, les fils masqués (`app.mail_hidden_threads`),
--       la liste de l'inbox (`inbox_messages`) et la mention (`inbox_hidden_counts`), les compteurs (`inbox_arborescence`),
--       la portée des actions groupées (`app.inbox_scope_messages`), la recherche (`app.search_query`,
--       `recherche_globale`, `search_hidden_mail_counts`)
-- @spec docs/SPEC-mail-subsystem.md §31.13.1 à §31.13.6 ; docs/SCHEMA.md « Migration `0193` » ;
--       docs/JOURNAL.md décisions 957 et 958 ; CLAUDE.md §10 (la règle tenue en base)
--
-- `0194` EST CELLE DE `CRM-160` (décision 959), QUI REDÉFINIT `public.concerns_me` : cette migration l'APPELLE et ne la
-- recopie pas ; l'ordre des deux est indifférent. Les fonctions reprises (`inbox_arborescence`,
-- `app.inbox_scope_messages`, `recherche_globale`) le sont de leur définition vivante (`0175`, `0189`, `0168`), seules les
-- lignes marquées `CRM-159` changeant.
--
-- IDEMPOTENCE : `add column if not exists`, `create or replace`. La pose de Spam ne se rejoue pas d'elle-même : le
-- registre des migrations ne passe qu'une fois.

-- =============================================================================================
-- 1. Le drapeau — §31.13.1
-- =============================================================================================

alter table public.mail_labels add column if not exists hidden boolean not null default false;

comment on column public.mail_labels.hidden is
	'CRM-159 §31.13.1 — vraie : les fils qui portent cette pastille (posée) ne paraissent dans la liste de l''inbox, ses '
	'compteurs et la recherche que si on l''active dans les filtres rapides. Réglée par qui administre l''espace (la '
	'politique UPDATE existante).';

-- Les privilèges sont posés COLONNE PAR COLONNE sur `mail_labels` (`0183`) : la colonne nouvelle reçoit les siens, à
-- l'insertion (une pastille créée cachée) et à la mise à jour. La politique des administrateurs juge la ligne (§31.3) :
-- une lectrice ou un business developer qui écrit le drapeau ne touche aucune ligne.
grant insert (hidden), update (hidden) on public.mail_labels to authenticated;

-- Spam cachée d'office dans chaque espace existant (décision 957, point ii) : reconnue par le nom que les défauts lui
-- donnent (§31.6). Une pastille renommée n'est plus « la pastille par défaut » ; elle n'est pas retrouvée.
update public.mail_labels set hidden = true where pg_catalog.lower(pg_catalog.btrim(name)) = 'spam' and not hidden;

-- Les défauts d'un espace créé : Spam cachée, les huit autres visibles. Reprise de `0183`, seule la colonne s'ajoute.
create or replace function app.seed_default_mail_labels(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.mail_labels (workspace_id, name, color, description, hidden)
	values
		(p_workspace_id, 'Spam', 'danger',
		 'Courrier indésirable : publicité non sollicitée, arnaque, hameçonnage, message sans rapport avec l''activité.', true),
		(p_workspace_id, 'Lead', 'success',
		 'Un prospect qui s''intéresse à nos services : demande d''information, de rendez-vous ou de premier échange.', false),
		(p_workspace_id, 'Devis / commande', 'brand',
		 'Une demande de devis, l''acceptation d''un devis, un bon de commande ou la confirmation d''une commande.', false),
		(p_workspace_id, 'Facture / paiement', 'accent',
		 'Une facture reçue ou à émettre, une relance de paiement, un avis de virement ou une question de règlement.', false),
		(p_workspace_id, 'Support client', 'brand',
		 'Un client existant qui signale un problème, pose une question d''usage ou demande une assistance.', false),
		(p_workspace_id, 'Partenariat', 'success',
		 'Une proposition de partenariat, de collaboration, de sponsoring ou de co-production.', false),
		(p_workspace_id, 'Recrutement', 'neutral',
		 'Une candidature, une offre d''emploi, une demande de stage ou un échange avec un cabinet de recrutement.', false),
		(p_workspace_id, 'Newsletter', 'neutral',
		 'Une lettre d''information, une publication périodique ou un envoi groupé auquel on est abonné.', false),
		(p_workspace_id, 'Administratif', 'neutral',
		 'Une démarche administrative, juridique, fiscale ou sociale : impôts, banque, assurance, organismes publics.', false)
	on conflict (workspace_id, lower(name)) do nothing;
$$;
revoke all on function app.seed_default_mail_labels(uuid) from public;

-- =============================================================================================
-- 2. Les fils masqués — §31.13.2
-- =============================================================================================

-- Les fils qui portent au moins une pastille cachée (archivées comprises) POSÉE sur l'un de leurs messages hors corbeille
-- QUE L'APPELANT VOIT, avec ces pastilles. `SECURITY DEFINER` : chaque message passe EXPLICITEMENT par
-- `app.peut_voir_message`, le juge des actions unitaires — un message invisible ne masque rien et ne révèle rien.
-- Ensembliste et non par fil : les lectures la matérialisent UNE fois puis l'anti-joignent ; le nombre de fils qui portent
-- une pastille cachée est petit devant celui des messages (le spam, pas l'inbox). Servie par `mail_message_labels_filtre_idx`.
create or replace function app.mail_hidden_threads()
returns table (workspace_id uuid, thread_key text, hidden_label_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
	select m.workspace_id,
	       app.cle_fil(m.references_ids, m.rfc822_message_id),
	       pg_catalog.array_agg(distinct ml.label_id order by ml.label_id)
	  from public.mail_labels l
	  join public.mail_message_labels ml on ml.label_id = l.id and ml.applied
	  join public.mail_messages m on m.id = ml.message_id
	 where l.hidden
	   and m.deleted_at is null
	   and app.peut_voir_message(m.id)
	 group by m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id);
$$;

comment on function app.mail_hidden_threads() is
	'CRM-159 §31.13.2 — les fils (workspace_id, thread_key) qui portent une pastille cachée posée sur un message hors '
	'corbeille que l''appelant voit, avec ces pastilles. Un fil est MASQUÉ quand aucune d''elles n''est activée.';

revoke all on function app.mail_hidden_threads() from public, anon;
grant execute on function app.mail_hidden_threads() to authenticated, service_role;

-- =============================================================================================
-- 3. La liste de l'inbox — §31.13.4
-- =============================================================================================

-- `SECURITY INVOKER` : la RLS de `mail_messages` juge chaque ligne, comme la lecture directe que l'écran faisait. Tous
-- les filtres de la liste y sont, pour que le masquage s'applique AVANT la limite.
create or replace function public.inbox_messages(
	p_card_id   uuid    default null,
	p_only_me   boolean default false,
	p_label_ids uuid[]  default '{}',
	p_sender    text    default null,
	p_limit     integer default 50
)
returns setof public.mail_messages
language sql
stable
security invoker
set search_path = ''
as $$
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
		 where not (t.hidden_label_ids operator(pg_catalog.&&) coalesce(p_label_ids, '{}'::uuid[]))
	)
	select m.*
	  from public.mail_messages m
	 where (case when p_card_id is null then m.card_id is null else m.card_id = p_card_id end)
	   -- « Seulement moi » : la fonction de `CRM-139`, appelée et jamais recopiée (`CRM-160` la redéfinit).
	   and (not coalesce(p_only_me, false) or public.concerns_me(m))
	   -- Les pastilles activées, en OU, posées (§31.12.2).
	   and (coalesce(pg_catalog.cardinality(p_label_ids), 0) = 0 or exists (
			select 1 from public.mail_message_labels ml
			 where ml.message_id = m.id and ml.applied and ml.label_id = any (p_label_ids)))
	   -- L'expéditeur, sans casse (§32.9).
	   and (nullif(pg_catalog.btrim(p_sender), '') is null
	        or pg_catalog.lower(m.from_address) = pg_catalog.lower(pg_catalog.btrim(p_sender)))
	   and not exists (
			select 1 from masques k
			 where k.workspace_id = m.workspace_id
			   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	 -- L'ordre TOTAL, terminé par `id` (décision 185) ; la limite bornée côté serveur.
	 order by m.received_at desc, m.id desc
	 limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

comment on function public.inbox_messages(uuid, boolean, uuid[], text, integer) is
	'CRM-159 §31.13.4 — la liste de l''inbox : « Non classés » (p_card_id nul) ou le dossier d''une affaire, « Seulement '
	'moi », les pastilles en OU, l''expéditeur, et les fils masqués écartés sauf pastille cachée activée ; sous la RLS.';

revoke all on function public.inbox_messages(uuid, boolean, uuid[], text, integer) from public, anon;
grant execute on function public.inbox_messages(uuid, boolean, uuid[], text, integer) to authenticated;

-- =============================================================================================
-- 4. La mention des fils masqués — §31.13.5
-- =============================================================================================

-- Pour chaque pastille cachée NON activée : les fils masqués du dossier, sous les mêmes filtres, qui paraîtraient si on
-- l'activait — un de leurs messages du dossier porte cette pastille ou l'une des activées. Un fil à deux pastilles
-- cachées compte sous chacune (décision 958 : l'une suffit à le montrer).
create or replace function public.inbox_hidden_counts(
	p_card_id        uuid    default null,
	p_only_me        boolean default false,
	p_label_ids      uuid[]  default '{}',
	p_sender         text    default null,
	p_snoozed_shown  boolean default false
)
returns table (label_id uuid, thread_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
	with masques as materialized (
		select t.workspace_id, t.thread_key, t.hidden_label_ids from app.mail_hidden_threads() t
		 where not (t.hidden_label_ids operator(pg_catalog.&&) coalesce(p_label_ids, '{}'::uuid[]))
	),
	candidats as materialized (
		select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id) as thread_key
		  from public.mail_messages m
		 where (case when p_card_id is null then m.card_id is null else m.card_id = p_card_id end)
		   and (not coalesce(p_only_me, false) or public.concerns_me(m))
		   and (nullif(pg_catalog.btrim(p_sender), '') is null
		        or pg_catalog.lower(m.from_address) = pg_catalog.lower(pg_catalog.btrim(p_sender)))
		   and (coalesce(p_snoozed_shown, false) or not exists (
				select 1 from public.mail_thread_snoozes s
				 where s.workspace_id = m.workspace_id
				   and s.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id)
				   and s.snoozed_until > pg_catalog.now()))
	)
	select l.id, pg_catalog.count(distinct (k.workspace_id, k.thread_key))::integer
	  from masques k
	 cross join lateral pg_catalog.unnest(k.hidden_label_ids) x(id)
	  join public.mail_labels l on l.id = x.id
	 where exists (
			select 1 from candidats c
			  join public.mail_message_labels ml on ml.message_id = c.id and ml.applied
			 where c.workspace_id = k.workspace_id and c.thread_key = k.thread_key
			   and (ml.label_id = x.id or ml.label_id = any (coalesce(p_label_ids, '{}'::uuid[]))))
	 group by l.id, l.name
	 order by l.name collate "fr-FR-x-icu", l.id;
$$;

comment on function public.inbox_hidden_counts(uuid, boolean, uuid[], text, boolean) is
	'CRM-159 §31.13.5 — la mention sous la liste : pour chaque pastille cachée non activée, les fils masqués du dossier '
	'(mêmes filtres) qui paraîtraient si on l''activait.';

revoke all on function public.inbox_hidden_counts(uuid, boolean, uuid[], text, boolean) from public, anon;
grant execute on function public.inbox_hidden_counts(uuid, boolean, uuid[], text, boolean) to authenticated;

-- =============================================================================================
-- 5. Les compteurs de l'arborescence — §31.13.3 (reprise de `0175`)
-- =============================================================================================

create or replace function public.inbox_arborescence(p_only_me boolean default false)
returns table (track_id uuid, track_name text, channel_id uuid, channel_name text, card_id uuid, card_title text,
               nombre bigint, unread_count bigint)
language sql
stable
set search_path = ''
as $$
	-- `CRM-111` T6.1 (décision 657) : les affaires ne se rangent plus sous leurs channels — une affaire partagée n'a
	-- qu'un dossier. Le type de retour est gardé : le track et le channel d'une ligne d'affaire sont nuls. La ligne des
	-- NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3) ; les affaires suivent par titre, puis par
	-- identifiant. `CRM-139` : `p_only_me` ne compte que les messages qui concernent l'appelant (§27.3) ; une affaire
	-- dont aucun message ne le concerne n'a pas de ligne, comme une affaire sans message.
	-- `CRM-159` (§31.13.3) : les compteurs comptent ce que la liste montre SANS FILTRE — les fils masqués n'y sont pas ;
	-- une affaire dont tous les messages sont masqués n'a pas de ligne.
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
	),
	visibles as (
		select m.id
		  from public.mail_messages m
		 where (not coalesce(p_only_me, false) or public.concerns_me(m))
		   and not exists (
				select 1 from masques k
				 where k.workspace_id = m.workspace_id
				   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	)
	select x.track_id, x.track_name, x.channel_id, x.channel_name, x.card_id, x.card_title, x.nombre, x.unread_count
	  from (
		select null::uuid as track_id, null::text as track_name, null::uuid as channel_id, null::text as channel_name,
		       null::uuid as card_id, null::text as card_title, count(*) as nombre,
		       count(*) filter (where not public.is_read(m)) as unread_count
		  from public.mail_messages m
		 where m.card_id is null
		   and m.id in (select v.id from visibles v)
		union all
		select null::uuid, null::text, null::uuid, null::text, c.id, c.title, count(*),
		       count(*) filter (where not public.is_read(m))
		  from public.mail_messages m
		  join public.cards c on c.id = m.card_id
		 where m.id in (select v.id from visibles v)
		 group by c.id, c.title
	  ) x
	 order by x.card_id is not null, x.card_title collate "fr-FR-x-icu", x.card_id;
$$;

revoke all on function public.inbox_arborescence(boolean) from public, anon;
grant execute on function public.inbox_arborescence(boolean) to authenticated, service_role;

-- =============================================================================================
-- 6. La portée des actions groupées — §31.13.3 (reprise de `0189`)
-- =============================================================================================

create or replace function app.inbox_scope_messages(p_scope jsonb)
 RETURNS TABLE(message_id uuid, workspace_id uuid, thread_key text, direction text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_dossier   text;
	v_card      uuid;
	v_moi       boolean;
	v_pastilles uuid[];
	v_expediteur text;
	v_sommeil   text;
	v_fils      jsonb;
	v_messages  uuid[];
begin
	if p_scope is null or pg_catalog.jsonb_typeof(p_scope) <> 'object' then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- LA LECTURE DES CHAMPS : une valeur d'un mauvais type (un identifiant mal formé, un tableau qui n'en est pas un)
	-- lève une erreur de la classe 22 ; elle devient `invalid_scope`, et seulement elle.
	begin
		v_dossier := p_scope ->> 'folder';
		v_card := (p_scope ->> 'card_id')::uuid;
		v_moi := coalesce((p_scope ->> 'only_me')::boolean, false);
		v_pastilles := coalesce(
			(select pg_catalog.array_agg(e::uuid) from pg_catalog.jsonb_array_elements_text(
				case when p_scope ? 'label_ids' and pg_catalog.jsonb_typeof(p_scope -> 'label_ids') <> 'null'
				     then p_scope -> 'label_ids' else '[]'::jsonb end) e),
			'{}'::uuid[]);
		v_expediteur := nullif(pg_catalog.lower(pg_catalog.btrim(p_scope ->> 'sender')), '');
		v_sommeil := coalesce(p_scope ->> 'snoozed', 'hidden');
		v_fils := case when pg_catalog.jsonb_typeof(p_scope -> 'threads') = 'array' then p_scope -> 'threads' end;
		if p_scope ? 'threads' and pg_catalog.jsonb_typeof(p_scope -> 'threads') not in ('array', 'null') then
			raise exception 'invalid_scope' using errcode = '22023';
		end if;
		if v_fils is not null and exists (
			select 1 from pg_catalog.jsonb_array_elements(v_fils) f
			 where pg_catalog.jsonb_typeof(f) <> 'object'
			    or (f ->> 'workspace_id') is null or (f ->> 'thread_key') is null
			    or ((f ->> 'workspace_id')::uuid) is null
		) then
			raise exception 'invalid_scope' using errcode = '22023';
		end if;
		if pg_catalog.jsonb_typeof(p_scope -> 'message_ids') = 'array' then
			select coalesce(pg_catalog.array_agg(e::uuid), '{}'::uuid[]) into v_messages
			  from pg_catalog.jsonb_array_elements_text(p_scope -> 'message_ids') e;
		end if;
	exception when data_exception then
		raise exception 'invalid_scope' using errcode = '22023';
	end;

	if v_dossier is null or v_dossier not in ('unclassified', 'card', 'trash')
	   or (v_dossier = 'card' and v_card is null)
	   or (v_dossier = 'trash' and v_messages is null)
	   or v_sommeil not in ('hidden', 'shown') then
		raise exception 'invalid_scope' using errcode = '22023';
	end if;

	-- §32.3 — « TOUT LE FILTRE » EXIGE UN FILTRE EXPLICITE : une pastille, « Seulement moi » appliqué, un expéditeur. Le
	-- dossier seul ne suffit pas, ni le mode de sommeil. La corbeille n'a pas de « tout » : elle exige `message_ids`.
	if v_dossier <> 'trash' and v_fils is null
	   and not (v_moi or pg_catalog.cardinality(v_pastilles) > 0 or v_expediteur is not null) then
		raise exception 'filter_required' using errcode = '22023';
	end if;

	if v_dossier = 'trash' then
		return query
		select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id), m.direction
		  from public.mail_messages m
		 where m.id = any (v_messages)
		   and app.message_en_corbeille_visible(m);
		return;
	end if;

	-- `CRM-159` (docs/SPEC-mail-subsystem.md §31.13.3) : « un fil coché agit sur les messages que la liste montre »
	-- (§32.2) ; un fil masqué n'est pas montré, sauf si l'une de ses pastilles cachées est dans `label_ids`.
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
		 where not (t.hidden_label_ids operator(pg_catalog.&&) v_pastilles)
	)
	select m.id, m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id), m.direction
	  from public.mail_messages m
	 where m.deleted_at is null
	   and not exists (
			select 1 from masques k
			 where k.workspace_id = m.workspace_id
			   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	   and (case when v_dossier = 'unclassified' then m.card_id is null else m.card_id = v_card end)
	   and (not v_moi or public.concerns_me(m))
	   and (pg_catalog.cardinality(v_pastilles) = 0 or exists (
			select 1 from public.mail_message_labels ml
			 where ml.message_id = m.id and ml.applied and ml.label_id = any (v_pastilles)))
	   and (v_expediteur is null or pg_catalog.lower(pg_catalog.btrim(m.from_address)) = v_expediteur)
	   and (v_sommeil = 'shown' or not exists (
			select 1 from public.mail_thread_snoozes s
			 where s.workspace_id = m.workspace_id
			   and s.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id)
			   and s.snoozed_until > pg_catalog.now()))
	   and (v_fils is null or exists (
			select 1 from pg_catalog.jsonb_array_elements(v_fils) f
			 where (f ->> 'workspace_id')::uuid = m.workspace_id
			   and f ->> 'thread_key' = app.cle_fil(m.references_ids, m.rfc822_message_id)))
	   and app.peut_voir_message(m.id);
end;
$function$;

comment on function app.inbox_scope_messages(jsonb) is
	'CRM-156 §32.2 — la portée d''une action groupée : valide la description (invalid_scope, filter_required) et rend les '
	'messages qu''elle désigne parmi ceux que l''appelant voit (peut_voir_message ; dans la corbeille, '
	'message_en_corbeille_visible). CRM-159 §31.13.3 : les fils masqués en sont écartés, sauf pastille cachée activée.';

revoke all on function app.inbox_scope_messages(jsonb) from public, anon, authenticated;

-- =============================================================================================
-- 7. La recherche — §31.13.6 (reprise de `0168`)
-- =============================================================================================

-- Le terme devient une requête : la découpe de `recherche_globale` (docs/SPEC-recherche.md §6.2, §6.7), extraite sans
-- changement. Nulle pour un terme nul, vide, fait de ponctuation ou de mots vides.
create or replace function app.search_query(p_terme text)
returns tsquery
language plpgsql
stable
set search_path = ''
as $$
declare
	v_mots text;
begin
	-- Découpe sur toute suite de caractères NON alphanumériques. Les lettres accentuées sont
	-- alphanumériques dans la locale de la base et survivent au découpage — mesuré : « Audit
	-- Sécu!! » rend « audit », « sécu ».
	--
	-- L'ÉCHAPPEMENT EST STRUCTUREL, et ce n'est pas une précaution de style : après cette
	-- découpe, un fragment ne contient QUE des caractères alphanumériques. Aucun métacaractère
	-- de `tsquery` — & | ! ( ) : ' — ne peut donc atteindre `to_tsquery`, qui LÈVE UNE ERREUR
	-- sur une syntaxe invalide. Une erreur serveur à chaque frappe d'une palette serait un
	-- défaut visible.
	--
	-- Le suffixe `:*` fait la recherche par préfixe, sans laquelle une palette est inutile —
	-- « audi » doit trouver « Audit sécurité applicative » avant que l'utilisateur ait fini de
	-- taper. `to_tsquery` applique le dictionnaire — désaccentuation PUIS radicalisation —
	-- AVANT de poser le préfixe : mesuré, « societe:* » rend « 'societ':* » (§2 M7).
	--
	-- ` & ` et non ` | ` : CONJONCTION. Une palette qui rendrait l'union noierait la ligne
	-- cherchée dès le deuxième mot saisi.
	select coalesce(string_agg(mot || ':*', ' & '), '')
	  into v_mots
	  from unnest(regexp_split_to_array(lower(coalesce(p_terme, '')), '[^[:alnum:]]+')) as mot
	 where mot <> '';

	-- Lignes *d* et *e* du §6.7 : terme nul, vide, ou fait de blancs et de ponctuation.
	if v_mots = '' then
		return null;
	end if;

	-- Ligne *f* du §6.7 : terme fait UNIQUEMENT de mots vides français (« le la de »).
	--
	-- Le contrôle passe par `to_tsvector` et NON par `to_tsquery`, et c'est mesuré (§2 M8) :
	-- `to_tsquery` émet un `NOTICE: text-search query contains only stop words` dès que sa
	-- requête ne porte aucun lexème. Ce n'est pas une erreur, mais ce serait une ligne de
	-- journal du serveur À CHAQUE FRAPPE d'une palette. `to_tsvector` emploie exactement les
	-- mêmes dictionnaires et n'émet rien.
	if to_tsvector('app.francais_sans_accent', p_terme) = ''::tsvector then
		return null;
	end if;

	return to_tsquery('app.francais_sans_accent', v_mots);
end;
$$;

revoke all on function app.search_query(text) from public, anon;
grant execute on function app.search_query(text) to authenticated, service_role;

create or replace function public.recherche_globale(p_terme text, p_limite integer DEFAULT 20)
 RETURNS TABLE(objet text, id uuid, workspace_id uuid, titre text, sous_titre text, extrait text, rang real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_limite  integer;
	v_requete tsquery;
begin
	-- ------------------------------------------------------------------------------------
	-- 4.1 La borne — §6.6, et lignes *g* et *h* du §6.7
	-- ------------------------------------------------------------------------------------
	-- Bornée à 50 CÔTÉ SERVEUR, parce qu'un client peut demander ce qu'il veut. Une palette
	-- n'affiche pas cent lignes.
	v_limite := least(coalesce(p_limite, 0), 50);

	if v_limite <= 0 then
		return;
	end if;

	-- ------------------------------------------------------------------------------------
	-- 4.2 Le terme devient une requête — §6.2
	-- ------------------------------------------------------------------------------------
	-- `CRM-159` (docs/SPEC-mail-subsystem.md §31.13.6) : la découpe vit dans `app.search_query`, que
	-- `search_hidden_mail_counts` lit aussi — une copie pourrait diverger. Son comportement est inchangé.
	v_requete := app.search_query(p_terme);
	if v_requete is null then
		return;
	end if;

	-- ------------------------------------------------------------------------------------
	-- 4.3 Les cinq familles — §4, §6.4
	-- ------------------------------------------------------------------------------------
	-- TOUTES LES JOINTURES DE CONTEXTE SONT EXTERNES, et le motif est celui de la décision 104
	-- de `CRM-012` : une jointure interne transformerait une politique de lecture absente sur la
	-- table de contexte en DISPARITION du résultat principal, c'est-à-dire un refus par
	-- accident. Le contexte manquant se dit par `null` ; la ligne, elle, reste.
	--
	-- `deleted_at is null` là où la colonne existe — ligne *i* du §6.7. Une affaire à la
	-- corbeille reste lisible par la RLS, c'est précisément ce qui permet de la restaurer
	-- (`CRM-077`) : l'exclure est une décision de la RECHERCHE, pas une conséquence de la
	-- sécurité. `contacts`, `organizations` et `mail_messages` ne portent pas la colonne.
	return query
	with valeurs as materialized (
		-- `CRM-112` T6 : les valeurs qui répondent, lues D'ABORD par l'index de `value_tsv`, une seule fois ; la politique
		-- de lecture des valeurs (semi-jointure, `0164`) ne s'applique qu'à elles. Une par affaire : le premier champ ACTIF
		-- dans l'ordre de la partie commune.
		select distinct on (v.card_id)
		       v.card_id, f.label as libelle, app.card_common_field_texte(f.type, f.options, v.value) as texte, v.value_tsv as tsv
		  from public.card_common_field_values v
		  join public.card_common_fields f on f.id = v.field_id and f.archived_at is null
		 where v.value_tsv @@ v_requete
		 order by v.card_id, f.position, f.label
	),
	-- `CRM-159` (§31.13.6) : les fils masqués, lus une fois ; aucune pastille n'est activée dans une recherche.
	masques as materialized (
		select t.workspace_id, t.thread_key from app.mail_hidden_threads() t
	),
	resultats as (

		-- 4.3.1 `affaire`
		select
			'affaire'::text                                          as objet,
			c.id                                                     as id,
			c.workspace_id                                           as workspace_id,
			c.title                                                  as titre,
			lu.channels                                              as sous_titre,
			-- `CRM-112` T6 : l'extrait nomme le champ de l'affaire qui répond ; nul quand l'affaire répond par elle-même.
			case when cv.libelle is not null then cv.libelle || ' : ' || coalesce(cv.texte, '') end as extrait,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(lu.actions, '')), 'B') ||
				setweight(coalesce(cv.tsv, ''::tsvector), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C'),
				v_requete
			)                                                        as rang
		  from public.cards c
		  -- `CRM-111` T4.1 (décision 814) : l'affaire est nommée par TOUS ses rattachements lisibles, dans l'ordre des tracks
		  -- puis des channels — l'identifiant du rattachement départage le reste, et la webapp range de même
		  -- (`premierDansLOrdreDesTracks`) —, et cherchée dans toutes leurs prochaines actions. La fonction est
		  -- `security invoker` : la RLS de `card_placements` et de `channels` ne laisse ici que ce que l'appelant lit.
		  left join lateral (
			select string_agg(ch.name, ', ' order by t.position, t.name collate "fr-FR-x-icu", ch.position, ch.name collate "fr-FR-x-icu", pl.id) as channels,
			       string_agg(coalesce(pl.next_action, ''), ' ' order by t.position, t.name collate "fr-FR-x-icu", ch.position, ch.name collate "fr-FR-x-icu", pl.id) as actions
			  from public.card_placements pl
			  join public.channels ch on ch.id = pl.channel_id
			  left join public.tracks t on t.id = ch.track_id
			 where pl.card_id = c.id
		  ) lu on true
		  left join valeurs cv on cv.card_id = c.id
		 where c.deleted_at is null
		   and (
				(setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				 setweight(to_tsvector('app.francais_sans_accent', coalesce(lu.actions, '')), 'B') ||
				 setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C')) @@ v_requete
				or cv.libelle is not null
		   )

		union all

		-- 4.3.2 `contact`
		select
			'contact'::text,
			ct.id,
			ct.workspace_id,
			ct.full_name,
			coalesce(o.name, ct.email),
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C'),
				v_requete
			)
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.3 `organisation`
		select
			'organisation'::text,
			o.id,
			o.workspace_id,
			o.name,
			o.domain,
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B'),
				v_requete
			)
		  from public.organizations o
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B')
		   ) @@ v_requete

		union all

		-- 4.3.4 `commentaire`
		-- L'extrait est REPLIÉ sur une ligne : mesuré (§2 M11), `ts_headline` rend un corps
		-- court EN ENTIER, retours à la ligne compris, et une palette n'affiche qu'une ligne.
		-- `StartSel` et `StopSel` VIDES : la donnée rendue est du texte pur, sans balise à
		-- échapper côté client.
		select
			'commentaire'::text,
			cc.id,
			cc.workspace_id,
			c2.title,
			p.full_name,
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(cc.body, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C'),
				v_requete
			)
		  from public.card_comments cc
		  left join public.cards c2 on c2.id = cc.card_id
		  left join public.profiles p on p.id = cc.author_id
		 where cc.deleted_at is null
		   -- UN COMMENTAIRE D'AFFAIRE MISE À LA CORBEILLE SORT AUSSI (§6.7, ligne *i*), et le
		   -- besoin a été trouvé par une assertion de la suite pgTAP, pas supposé : `card_comments`
		   -- porte son propre `deleted_at`, que mettre l'affaire à la corbeille ne touche pas. Sans
		   -- cette clause, la palette de la tranche 2 offrirait une destination morte — ce que le
		   -- §5.10 du design system interdit.
		   --
		   -- `not exists` et non une condition sur la jointure externe : si l'affaire n'est PAS
		   -- lisible, la sous-requête ne la voit pas non plus et le commentaire reste — le contexte
		   -- manquant se dit par `null`, il ne fait pas disparaître la ligne (§6.4). En pratique le
		   -- cas ne se produit pas, `card_comments_lecture` exigeant déjà de lire l'affaire.
		   and not exists (
				select 1
				  from public.cards cx
				 where cx.id = cc.card_id
				   and cx.deleted_at is not null
		   )
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.5 `message`
		select
			'message'::text,
			m.id,
			m.workspace_id,
			m.subject,
			coalesce(nullif(m.from_name, ''), m.from_address),
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(m.body_text, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C'),
				v_requete
			)
		  from public.mail_messages m
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C')
		   ) @@ v_requete
		   -- `CRM-159` : un mail dont le fil est masqué ne sort pas ; `search_hidden_mail_counts` le compte.
		   and not exists (
				select 1 from masques k
				 where k.workspace_id = m.workspace_id
				   and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id))
	)
	select r.objet, r.id, r.workspace_id, r.titre, r.sous_titre, r.extrait, r.rang
	  from resultats r
	-- L'ORDRE PORTE TROIS CRITÈRES, ET LES DEUX DERNIERS NE SONT PAS DÉCORATIFS (§6.6) : sans
	-- eux, deux lignes de rang égal — cas courant d'un terme trouvé une seule fois dans deux
	-- titres — s'ordonneraient au gré du plan d'exécution, et la palette changerait d'ordre
	-- d'une frappe à l'autre. `collate "fr-FR-x-icu"` plutôt que l'ordre binaire : « Émile » se
	-- rangerait après « Emma » avec le second.
	 order by r.rang desc, r.titre collate "fr-FR-x-icu", r.id
	 limit v_limite;
end;
$function$;

-- Les mails que le masquage a écartés d'une recherche, par pastille cachée. Le vecteur est celui de la famille `message`
-- de `recherche_globale`, mot pour mot : c'est l'expression de `mail_messages_recherche_idx`, qui ne sert que si elle est
-- recopiée telle quelle. La borne de 50 ne s'applique pas : le compte dit tout ce qui a été écarté.
create or replace function public.search_hidden_mail_counts(p_terme text)
returns table (label_id uuid, workspace_id uuid, workspace_name text, label_name text, mail_count integer)
language plpgsql
stable
set search_path = ''
as $$
declare
	v_requete tsquery;
begin
	v_requete := app.search_query(p_terme);
	if v_requete is null then
		return;
	end if;
	return query
	with masques as materialized (
		select t.workspace_id, t.thread_key, t.hidden_label_ids from app.mail_hidden_threads() t
	)
	select l.id, l.workspace_id, w.name, l.name, pg_catalog.count(*)::integer
	  from public.mail_messages m
	  join masques k on k.workspace_id = m.workspace_id
	                and k.thread_key = app.cle_fil(m.references_ids, m.rfc822_message_id)
	 cross join lateral pg_catalog.unnest(k.hidden_label_ids) x(id)
	  join public.mail_labels l on l.id = x.id
	  -- Le nom de l'espace : la palette nomme celui d'une pastille qui n'est pas de l'espace courant (§31.13.6).
	  join public.workspaces w on w.id = l.workspace_id
	 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C')
		   ) @@ v_requete
	 group by l.id, l.workspace_id, w.name, l.name
	 order by l.name collate "fr-FR-x-icu", l.id;
end;
$$;

comment on function public.search_hidden_mail_counts(text) is
	'CRM-159 §31.13.6 — pour chaque pastille cachée, les mails qui répondent au terme et que recherche_globale a écartés '
	'parce que leur fil est masqué.';

revoke all on function public.search_hidden_mail_counts(text) from public, anon;
grant execute on function public.search_hidden_mail_counts(text) to authenticated;
