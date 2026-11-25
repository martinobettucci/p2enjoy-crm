-- @spec INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T1 : le fuseau d'un e-mail est celui de
--       l'ESPACE — la colonne `workspaces.timezone` (`Europe/Paris` par défaut), sa validation, sa fonction de réglage, le rendu des deux
--       variables horodatées d'un modèle à ce fuseau
-- @spec docs/SPEC-modeles-emails.md §8.6 bis ; docs/SCHEMA.md `workspaces` ; docs/SPEC-audit.md (le trigger `workspaces_audit` nomme la
--       colonne) ; docs/JOURNAL.md décisions 992 et 996
--
-- `public.rendre_modele_email` est REPRISE À L'IDENTIQUE DE SA DÉFINITION DE `0167` (`pg_get_functiondef`), avec trois changements :
-- l'affaire porte `fuseau`, `card.next_action_at` s'écrit à ce fuseau, et les champs communs `datetime` aussi. `app.card_common_field_texte`
-- à TROIS paramètres devient l'enveloppe de la version à quatre, en UTC : l'index de recherche des champs (`0168`, `0193`) n'a pas de
-- fuseau d'espace et garde son comportement.
--
-- Rejouable : tout s'écrit `if not exists` / `create or replace` / `drop … if exists`. Retour arrière : voir `docs/PROD_MIGRATIONS.md`.

-- --- 1. Le fuseau est un nom IANA que Postgres connaît -------------------------------------------------------------
create or replace function app.is_valid_timezone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
	select p_name is not null
	   and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_name);
$$;
alter function app.is_valid_timezone(text) owner to postgres;
revoke all on function app.is_valid_timezone(text) from public, anon;
grant execute on function app.is_valid_timezone(text) to authenticated, service_role;

-- --- 2. La colonne -----------------------------------------------------------------------------------------------
alter table public.workspaces add column if not exists timezone text not null default 'Europe/Paris';
alter table public.workspaces drop constraint if exists workspaces_timezone_valide;
alter table public.workspaces add constraint workspaces_timezone_valide check (app.is_valid_timezone(timezone));
comment on column public.workspaces.timezone is
	'INC-216 — le fuseau des horodatages rendus dans les e-mails de l''espace : un nom IANA connu de pg_timezone_names. Défaut Europe/Paris.';

-- Le journal d'audit nomme la colonne changée (les valeurs recopiées restent la liste courte de `app.audit_configuration`).
drop trigger if exists workspaces_audit on public.workspaces;
create trigger workspaces_audit after update on public.workspaces
	for each row execute function app.audit_configuration('workspace', 'name', 'name', 'inbound_domain', 'settings',
	                                                      'card_address_prefix', 'timezone');

-- --- 3. Le réglage : l'administrateur de l'espace, ou un superadministrateur ------------------------------------
create or replace function public.workspace_set_timezone(p_workspace_id uuid, p_timezone text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	-- La règle est appliquée ICI, jamais dans l'écran (`CLAUDE.md` §10). Un espace inexistant et un espace étranger rendent LE MÊME refus :
	-- l'existence d'un espace ne se devine pas par la différence de deux erreurs.
	if p_workspace_id is null
	   or not (app.is_workspace_admin(p_workspace_id) or app.est_superadmin())
	   or not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	if not app.is_valid_timezone(p_timezone) then
		raise exception 'invalid_timezone' using errcode = '22023';
	end if;
	update public.workspaces w set timezone = p_timezone where w.id = p_workspace_id;
end;
$$;
alter function public.workspace_set_timezone(uuid, text) owner to postgres;
revoke all on function public.workspace_set_timezone(uuid, text) from public, anon;
grant execute on function public.workspace_set_timezone(uuid, text) to authenticated, service_role;
comment on function public.workspace_set_timezone(uuid, text) is
	'INC-216 — règle le fuseau des e-mails d''un espace : l''administrateur de l''espace ou un superadministrateur ; refus forbidden (42501) sinon, invalid_timezone (22023) pour un nom inconnu.';

-- --- 4. Les champs communs : le fuseau devient un paramètre ----------------------------------------------------------
create or replace function app.card_common_field_texte(p_type text, p_options jsonb, p_value jsonb, p_timezone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
	v_texte text;
begin
	if p_value is null or p_value = 'null'::jsonb then
		return null;
	end if;
	case
		when p_type in ('number', 'money') and jsonb_typeof(p_value) = 'number' then
			return to_char((p_value #>> '{}')::numeric, 'FM999999999990.00');
		when p_type = 'date' then
			begin
				return to_char((p_value #>> '{}')::date, 'DD/MM/YYYY');
			exception when others then
				return p_value #>> '{}';
			end;
		when p_type = 'datetime' then
			begin
				return to_char((p_value #>> '{}')::timestamptz at time zone p_timezone, 'DD/MM/YYYY HH24:MI');
			exception when others then
				return p_value #>> '{}';
			end;
		when p_type = 'select' then
			select c ->> 'label' into v_texte from jsonb_array_elements(p_options -> 'choices') c where c ->> 'key' = p_value #>> '{}';
			return coalesce(v_texte, p_value #>> '{}');
		when p_type = 'multiselect' then
			if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then
				return null;
			end if;
			select string_agg(coalesce((select c ->> 'label' from jsonb_array_elements(p_options -> 'choices') c where c ->> 'key' = e), e),
			                  ', ' order by o)
			  into v_texte
			  from jsonb_array_elements_text(p_value) with ordinality as x(e, o);
			return v_texte;
		when p_type = 'checkbox' then
			return case p_value when 'true'::jsonb then 'Oui' when 'false'::jsonb then 'Non' end;
		when p_type = 'user' then
			select full_name into v_texte from public.profiles where id::text = p_value #>> '{}';
			return coalesce(v_texte, p_value #>> '{}');
		when p_type = 'contact' then
			select full_name into v_texte from public.contacts where id::text = p_value #>> '{}';
			return coalesce(v_texte, p_value #>> '{}');
		else
			return nullif(p_value #>> '{}', '');
	end case;
end;
$$;
alter function app.card_common_field_texte(text, jsonb, jsonb) owner to postgres;
alter function app.card_common_field_texte(text, jsonb, jsonb, text) owner to postgres;
grant execute on function app.card_common_field_texte(text, jsonb, jsonb, text) to authenticated, service_role;

-- La version à trois paramètres reste, et reste en UTC : celle de l'index de recherche des champs (`0168`, `0193`).
create or replace function app.card_common_field_texte(p_type text, p_options jsonb, p_value jsonb)
returns text
language sql
stable
set search_path = ''
as $$
	select app.card_common_field_texte(p_type, p_options, p_value, 'UTC');
$$;

-- --- 5. Le rendu : le fuseau de l'espace ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rendre_modele_email(p_template_id uuid, p_card_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_identity_id uuid DEFAULT NULL::uuid, p_placement_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subject text, body_text text, variables_nulles text[])
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with modele as (
		select m.subject, m.body_text
		  from public.mail_templates m
		 where m.id = p_template_id
	),
	affaire as (
		-- LES JOINTURES SONT INTERNES POUR LE CHANNEL ET L'ÉTAPE, ET EXTERNES POUR LE RESTE. Le
		-- channel et l'étape d'une card sont `not null` en base, et une card lisible dont le
		-- channel ne le serait pas rendrait un rendu amputé sans le dire. La RLS des deux tables
		-- dérive du même droit de lecture que celle de `cards`, si bien qu'une jointure interne
		-- ne retranche rien en pratique — et là où elle retrancherait, l'absence de ligne est
		-- préférable à un rendu partiel silencieux.
		select c.title,
		       pl.amount,
		       c.currency,
		       pl.next_action,
		       pl.next_action_at,
		       coalesce(ws.label_override, cat.label) as etape,
		       ch.name                                as channel,
		       -- INC-216 (décision 996) : le fuseau de l'ESPACE de l'affaire. `left join` + repli sur le défaut du produit : une
		       -- espace que la RLS masquerait ne doit pas faire disparaître l'affaire d'un rendu qui, sinon, la lit.
		       coalesce(sp.timezone, 'Europe/Paris') as fuseau
		  from public.cards c
		  left join public.workspaces sp on sp.id = c.workspace_id
		-- `CRM-111` T6.2 (§15.2) : le rattachement DÉSIGNÉ, s'il appartient à l'affaire et que l'appelant
		-- le lit ; à défaut de désignation, le plus ancien lisible. Un rattachement d'une autre affaire,
		-- inconnu ou masqué ne trouve aucune ligne : la jointure interne rend ZÉRO LIGNE, comme une
		-- affaire illisible (§8.3).
		  join lateral (select pl.channel_id, pl.current_step_id, pl.amount, pl.next_action, pl.next_action_at
		                  from public.card_placements pl
		                 where pl.card_id = c.id
		                   and (p_placement_id is null or pl.id = p_placement_id)
		                 order by pl.created_at, pl.id
		                 limit 1) pl on true
		  join public.channels             ch  on ch.id  = pl.channel_id
		  join public.workflow_steps       ws  on ws.id  = pl.current_step_id
		  join public.workflow_nodes_catalog cat on cat.id = ws.node_id
		 where c.id = p_card_id
	),
	personne as (
		select ct.full_name, ct.email, o.name as organisation
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where ct.id = p_contact_id
	),
	expediteur as (
		select i.from_name, i.from_address
		  from public.mail_outbound_identities i
		 where i.id = p_identity_id
	),
	-- LA CARTE DES VALEURS EST LA SOURCE UNIQUE DES DEUX RÉSULTATS : la substitution la lit, et
	-- l'inventaire des trous nuls la lit aussi. En construire deux garantirait qu'un jour l'une
	-- dise « vide » là où l'autre dit « rempli ».
	--
	-- `jsonb_build_object` conserve les valeurs NULLES, que `->>` rend alors nulles : c'est ce qui
	-- permet de distinguer « la variable existe et vaut null » de « la variable n'existe pas », et
	-- les DEUX rendent la chaîne vide à la substitution (§8.4).
	valeurs as (
		select jsonb_build_object(
			'card.title',           a.title,
			'card.amount',          to_char(a.amount, 'FM999999999990.00'),
			'card.currency',        a.currency,
			'card.next_action',     a.next_action,
			'card.next_action_at',  to_char(a.next_action_at at time zone a.fuseau, 'DD/MM/YYYY HH24:MI'),
			'card.step',            a.etape,
			'card.channel',         a.channel,
			'contact.full_name',    p.full_name,
			'contact.email',        p.email,
			'contact.organization', p.organisation,
			'identity.from_name',   e.from_name,
			'identity.from_address', e.from_address
		)
		-- `CRM-112` T5 : une entrée par champ ACTIF de l'espace de l'affaire, mise en forme selon le type ; un champ vide
		-- vaut `null`, que la substitution rend vide et que `variables_nulles` nomme (§8.4).
		|| coalesce((
			select pg_catalog.jsonb_object_agg('card.field.' || f.key, app.card_common_field_texte(f.type, f.options, v.value, a.fuseau))
			  from public.cards c
			  join public.card_common_fields f on f.workspace_id = c.workspace_id and f.archived_at is null
			  left join public.card_common_field_values v on v.card_id = c.id and v.field_id = f.id
			 where c.id = p_card_id
		), '{}'::jsonb) as carte
		  from affaire a
		  left join personne   p on true
		  left join expediteur e on true
	)
	select
		app.mail_template_substituer(m.subject,   v.carte) as subject,
		app.mail_template_substituer(m.body_text, v.carte) as body_text,
		-- L'INVENTAIRE DES TROUS NULS — trié, dédoublonné, et BORNÉ AUX VARIABLES QUE LE MODÈLE
		-- EMPLOIE RÉELLEMENT (§8.4). Une variable que le modèle n'emploie pas n'est pas un trou :
		-- l'y faire figurer donnerait à lire une liste d'absences sans objet, et la sous-tranche 2b
		-- afficherait un avertissement pour un texte qui n'en porte pas la trace.
		--
		-- Les trous du modèle sont relus par le MÊME motif que la substitution : un nom qui ne
		-- serait pas découpé pareillement ici ferait mentir l'inventaire sur le texte rendu.
		coalesce(
			(
				select array_agg(distinct nom order by nom)
				  from (
					select btrim(trou[1]) as nom
					  from regexp_matches(m.subject || ' ' || m.body_text,
					                      '\{\{([^{}]*)\}\}', 'g') as trou
				  ) as trous
				 where v.carte ->> nom is null
			),
			array[]::text[]
		) as variables_nulles
	  from modele m
	 cross join valeurs v;
$function$;
