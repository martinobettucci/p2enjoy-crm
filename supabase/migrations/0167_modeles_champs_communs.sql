-- @spec CRM-112 (docs/BACKLOG.md) — tranche T5 : les champs de l'affaire dans les modèles d'email — `{{card.field.<clé>}}`
--       contrôlé à l'écriture par un déclencheur, rendu selon le type, l'aperçu `[libellé]`, le guichet de la palette,
--       l'archivage qui nomme aussi les modèles
-- @spec docs/SPEC-champs-communs.md §9 (précision T5), §6 ; docs/SPEC-modeles-emails.md §2.5, §8.4 ; docs/SCHEMA.md
--       « Migration `0167` » ; docs/JOURNAL.md décision 842
--
-- `public.rendre_modele_email`, `public.render_mail_template_sample` et `app.card_common_fields_refuser_archivage_employe`
-- SONT REPRISES À L'IDENTIQUE DE LEUR DÉFINITION EN BASE (`pg_get_functiondef`), chacune avec un seul ajout.

-- --- 1. Le contrôle des variables, avec l'espace du modèle --------------------------------------------------------
create or replace function app.mail_template_variables_inconnues_espace(p_texte text, p_workspace uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(
			select array_agg(distinct v order by v)
			  from (
				select btrim(m[1]) as v
				  from regexp_matches(coalesce(p_texte, ''), '\{\{([^{}]*)\}\}', 'g') as m
			  ) as trous
			 where not (v = any (app.mail_template_variables()))
			   and not exists (select 1 from public.card_common_fields f
			                    where f.workspace_id = p_workspace and f.archived_at is null and 'card.field.' || f.key = v)
		),
		array[]::text[]
	);
$$;
alter function app.mail_template_variables_inconnues_espace(text, uuid) owner to postgres;
revoke all on function app.mail_template_variables_inconnues_espace(text, uuid) from public;

-- Le refus garde la forme des deux `CHECK` qu'il remplace : `23514`, et leur nom, que l'écran classe déjà.
create or replace function app.mail_templates_valider_variables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if cardinality(app.mail_template_variables_inconnues_espace(new.subject, new.workspace_id)) > 0 then
		raise exception 'new row for relation "mail_templates" violates check constraint "mail_templates_subject_variables"'
			using errcode = '23514', constraint = 'mail_templates_subject_variables', table = 'mail_templates', schema = 'public';
	end if;
	if cardinality(app.mail_template_variables_inconnues_espace(new.body_text, new.workspace_id)) > 0 then
		raise exception 'new row for relation "mail_templates" violates check constraint "mail_templates_body_variables"'
			using errcode = '23514', constraint = 'mail_templates_body_variables', table = 'mail_templates', schema = 'public';
	end if;
	return new;
end;
$$;
alter function app.mail_templates_valider_variables() owner to postgres;
revoke all on function app.mail_templates_valider_variables() from public;

alter table public.mail_templates drop constraint if exists mail_templates_subject_variables;
alter table public.mail_templates drop constraint if exists mail_templates_body_variables;
drop trigger if exists mail_templates_valider_variables on public.mail_templates;
create trigger mail_templates_valider_variables
	before insert or update of subject, body_text on public.mail_templates
	for each row execute function app.mail_templates_valider_variables();

-- --- 2. La valeur d'un champ de l'affaire dans un texte -------------------------------------------------------------
create or replace function app.card_common_field_texte(p_type text, p_options jsonb, p_value jsonb)
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
				return to_char((p_value #>> '{}')::timestamptz at time zone 'UTC', 'DD/MM/YYYY HH24:MI');
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
grant execute on function app.card_common_field_texte(text, jsonb, jsonb) to authenticated, service_role;

-- --- 3. Le rendu : une entrée par champ dans la carte unique --------------------------------------------------------
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
		       ch.name                                as channel
		  from public.cards c
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
			'card.next_action_at',  to_char(a.next_action_at at time zone 'UTC', 'DD/MM/YYYY HH24:MI'),
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
			select pg_catalog.jsonb_object_agg('card.field.' || f.key, app.card_common_field_texte(f.type, f.options, v.value))
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

-- --- 4. L'aperçu : un champ par son libellé entre crochets ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.render_mail_template_sample(p_template_id uuid)
 RETURNS TABLE(subject text, body_text text, signature_text text, identity_is_sample boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with modele as (
		select m.workspace_id, m.subject, m.body_text
		  from public.mail_templates m
		 where m.id = p_template_id
	),
	-- L'IDENTITÉ DE LA PERSONNE QUI REGARDE, PAR LA RÈGLE DE LA DÉCISION 805 (§14.4) : son défaut, à défaut son
	-- unique identité, sinon aucune. `owner_id = auth.uid()` écarte l'identité de service, qui ne sert qu'aux envois
	-- automatiques. La RLS de `mail_outbound_identities` s'applique en plus, telle quelle.
	siennes as (
		select i.from_name, i.from_address, i.signature_text, i.is_default,
		       count(*) over () as nombre
		  from public.mail_outbound_identities i
		  join modele m on m.workspace_id = i.workspace_id
		 where i.owner_id = auth.uid()
	),
	expediteur as (
		select s.from_name, s.from_address, s.signature_text
		  from siennes s
		 where s.is_default or s.nombre = 1
		 order by s.is_default desc
		 limit 1
	),
	-- LE JEU D'EXEMPLE, ÉCRIT UNE SEULE FOIS (§14.3). Les valeurs non textuelles sont déjà dans la forme du §8.6.
	-- Les domaines `.example` sont réservés (RFC 2606) : aucune adresse d'exemple n'appartient à quelqu'un.
	valeurs as (
		select jsonb_build_object(
			'card.title',            'Projet exemple',
			'card.channel',          'Prospection',
			'card.step',             'Proposition envoyée',
			'card.amount',           '12500.00',
			'card.currency',         'EUR',
			'card.next_action',      'Rappeler pour validation',
			'card.next_action_at',   '15/01/2027 10:00',
			'contact.full_name',     'M. Dupont',
			'contact.email',         'm.dupont@entreprise.example',
			'contact.organization',  'ENTREPRISE INC',
			-- Une identité sans `from_name` reçoit la valeur d'exemple de ce seul champ : l'aperçu ne porte aucun trou.
			'identity.from_name',    coalesce(e.from_name, 'Votre nom'),
			'identity.from_address', coalesce(e.from_address, 'vous@entreprise.example')
		) as carte,
		e.signature_text,
		e.from_address is null as identite_fictive
		  from (select 1) as un
		  left join expediteur e on true
	)
	select
		app.mail_template_substituer(m.subject,   v.carte || coalesce(c.champs, '{}'::jsonb)) as subject,
		app.mail_template_substituer(m.body_text, v.carte || coalesce(c.champs, '{}'::jsonb)) as body_text,
		-- RENDUE À PART ET TELLE QUELLE : une signature ne se substitue pas (§10.8), et son ajout au corps appartient
		-- à l'expédition (`queue_outbound_email`).
		v.signature_text,
		v.identite_fictive as identity_is_sample
	  from modele m
	 cross join valeurs v
	 -- `CRM-112` T5 : un champ de l'affaire se rend par son libellé entre crochets — le jeu d'exemple ne devine aucune valeur.
	 cross join lateral (
		select pg_catalog.jsonb_object_agg('card.field.' || f.key, '[' || f.label || ']') as champs
		  from public.card_common_fields f
		 where f.workspace_id = m.workspace_id and f.archived_at is null
	 ) c;
$function$;

-- --- 5. Le guichet de la palette : les variables, et le libellé d'un champ -------------------------------------------
create or replace function public.mail_template_variables_espace(p_workspace uuid)
returns table (name text, label text)
language sql
stable
security invoker
set search_path = ''
as $$
	select v, null::text from unnest(app.mail_template_variables()) as v
	union all
	(select 'card.field.' || f.key, f.label
	   from public.card_common_fields f
	  where f.workspace_id = p_workspace and f.archived_at is null
	  order by f.position, f.label);
$$;
revoke all on function public.mail_template_variables_espace(uuid) from public;
grant execute on function public.mail_template_variables_espace(uuid) to authenticated, service_role;

-- --- 6. L'archivage gardé nomme aussi les modèles ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.card_common_fields_refuser_archivage_employe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_transitions text;
	v_modeles     text;
begin
	if old.archived_at is null and new.archived_at is not null then
		-- Le libellé d'une étape est sa surcharge, sinon celui de son nœud du catalogue.
		select string_agg(format('%s : %s → %s', w.name, coalesce(sf.label_override, nf.label), coalesce(st.label_override, nt.label)),
		                  ' ; ' order by w.name, sf.position, st.position)
		  into v_transitions
		  from public.workflow_transition_required_common_fields r
		  join public.workflow_transitions t on t.id = r.transition_id
		  join public.workflows w on w.id = t.workflow_id
		  join public.workflow_steps sf on sf.id = t.from_step_id
		  join public.workflow_nodes_catalog nf on nf.id = sf.node_id
		  join public.workflow_steps st on st.id = t.to_step_id
		  join public.workflow_nodes_catalog nt on nt.id = st.node_id
		 where r.common_field_id = new.id;
		-- `CRM-112` T5 : les modèles d'email qui citent le champ, par le motif de la substitution.
		select string_agg(format('Modèle : %s', t.name), ' ; ' order by t.name)
		  into v_modeles
		  from public.mail_templates t
		 where t.workspace_id = new.workspace_id
		   and exists (select 1 from regexp_matches(t.subject || ' ' || t.body_text, '\{\{([^{}]*)\}\}', 'g') m
		                where btrim(m[1]) = 'card.field.' || new.key);
		if v_transitions is not null or v_modeles is not null then
			raise exception 'common_field_in_use' using errcode = 'P0001', detail = concat_ws(' ; ', v_transitions, v_modeles);
		end if;
	end if;
	return new;
end;
$function$;
