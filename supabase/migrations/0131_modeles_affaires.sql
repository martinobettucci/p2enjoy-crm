-- @spec CRM-068 (docs/BACKLOG.md) — tranche T4a : les modèles d'affaires, en base
-- @spec docs/SPEC-checklists.md §3.5 (la table `card_templates`), §3.6 (`creer_affaire` étendue, `save_card_as_template`),
--       §4 ; docs/SCHEMA.md « Migration `0131` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 747 à 749
-- @spec CRM-036 (docs/BACKLOG.md) — la validation d'une valeur de champ, extraite du déclencheur de `card_field_values` en une
--       fonction partagée, SANS changement de règle ni de message (docs/SPEC-form-composer.md §6.6, décisions 131 à 133, 295)
--
-- UNE SEULE RÈGLE POUR UNE VALEUR, QU'ELLE SOIT ÉCRITE SUR UNE AFFAIRE OU DANS UN MODÈLE. Un modèle qui porterait une valeur
-- que l'affaire refuserait ferait échouer « Nouvelle affaire » au moment où on l'applique, loin de la saisie qui l'a causée.
-- La validation est donc extraite du déclencheur de `card_field_values` en `app.valider_valeur_champ`, et les deux
-- déclencheurs l'appellent : le texte de chaque refus est inchangé, la pgTAP `0014` le tient.

-- =============================================================================================
-- 1. La validation partagée d'une valeur
-- =============================================================================================

create or replace function app.valider_valeur_champ(v_champ public.form_fields, p_valeur jsonb, p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_forme   text := jsonb_typeof(p_valeur);
	v_texte   text;
	v_element jsonb;
	v_cible   uuid;
begin
	-- « Vidé explicitement » est accepté pour TOUS les types (docs/SPEC-form-composer.md §6.6, décision 133).
	if p_valeur is null or v_forme = 'null' then
		return;
	end if;

	case v_champ.type

		-- --- 5.2 Les types textuels -------------------------------------------------------
		-- `phone` n'est PAS contraint, et c'est délibéré : les formats nationaux sont trop divers
		-- pour qu'un refus soit défendable. Le dire vaut mieux que d'imposer une norme arbitraire.
		when 'text', 'textarea', 'phone', 'file' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;

		when 'url' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			-- `^https?://` refuse `javascript:` et `data:`, qui sont les seules formes dont
			-- l'affichage serait dangereux. Une validation plus fine refuserait des adresses
			-- légitimes sans rien gagner.
			if (p_valeur #>> '{}') !~ '^https?://[^[:space:]]+$' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une adresse http(s)', v_champ.key);
			end if;

		when 'email' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			if (p_valeur #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une adresse électronique', v_champ.key);
			end if;

		-- --- 5.3 Les types numériques -----------------------------------------------------
		-- `money` ne vérifie PAS la devise : elle est portée par `options.currency` du champ, non
		-- par la valeur (docs/SPEC-form-composer.md §2.4).
		when 'number', 'money' then
			if v_forme <> 'number' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un nombre, reçu %s', v_champ.key, v_forme);
			end if;

		when 'checkbox' then
			if v_forme <> 'boolean' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un booléen, reçu %s', v_champ.key, v_forme);
			end if;

		-- --- 5.4 Les types temporels ------------------------------------------------------
		-- La conversion EST la validation : PostgreSQL sait dire si une chaîne est une date.
		-- Le `begin … exception` local convertit son refus en un message du produit, plutôt que de
		-- laisser remonter « invalid input syntax for type date », qui nomme un type interne.
		when 'date' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			begin
				perform (p_valeur #>> '{}')::date;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une date ISO 8601', v_champ.key);
			end;

		when 'datetime' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			begin
				perform (p_valeur #>> '{}')::timestamptz;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un horodatage ISO 8601', v_champ.key);
			end;

		-- --- 5.5 Les types à choix — décision 131 -----------------------------------------
		-- Le point ouvert n° 4 du §8 était en suspens depuis `CRM-035` : la base ne contraint pas
		-- la forme des entrées de `options.choices`, un `CHECK` ne pouvant porter de sous-requête.
		-- La contrainte est posée là où elle a une conséquence — LA VALEUR. La déclaration reste
		-- libre ; aucune card ne peut plus porter une réponse que son champ n'offre pas.
		when 'select' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			v_texte := p_valeur #>> '{}';
			if not exists (
				select 1
				  from jsonb_array_elements(v_champ.options -> 'choices') c
				 where c ->> 'key' = v_texte
			) then
				raise exception 'invalid_field_value'
					using detail = format('%s : « %s » ne figure pas dans les choix déclarés',
					                      v_champ.key, v_texte);
			end if;

		when 'multiselect' then
			if v_forme <> 'array' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un tableau, reçu %s', v_champ.key, v_forme);
			end if;
			for v_element in select * from jsonb_array_elements(p_valeur) loop
				if jsonb_typeof(v_element) <> 'string' then
					raise exception 'invalid_field_value'
						using detail = format('%s attend un tableau de chaînes', v_champ.key);
				end if;
				if not exists (
					select 1
					  from jsonb_array_elements(v_champ.options -> 'choices') c
					 where c ->> 'key' = v_element #>> '{}'
				) then
					raise exception 'invalid_field_value'
						using detail = format('%s : « %s » ne figure pas dans les choix déclarés',
						                      v_champ.key, v_element #>> '{}');
				end if;
			end loop;

		-- --- 5.6 Les types qui désignent un objet — décision 295, INC-053 CLOSE -----------
		-- LA CIBLE EST DÉSORMAIS RÉSOLUE, ET PLUS SEULEMENT SA FORME.
		--
		-- Ce bloc validait la seule forme d'un `uuid` (décision 132) parce que `contacts`
		-- n'existait pas et que résoudre `user` seul aurait posé une règle d'appartenance que nul
		-- document n'énonçait. Les deux motifs sont tombés : `CRM-060` tranche 1 a livré
		-- `contacts`, et la décision 295 a rendu l'arbitrage — « une valeur `user` doit désigner
		-- un membre actif du workspace ; une valeur `contact` […] une clé vers un contact du même
		-- workspace ; accepter un UUID opaque temporaire créerait une dette de données impossible
		-- à distinguer d'une référence valide ».
		--
		-- LA PORTÉE EST `p_workspace`, le workspace de la VALEUR — non celui de la cible.
		-- Sa véracité est tenue par la clé composite `(workflow_id, workspace_id)` vers
		-- `workflows`. Un client qui mentirait sur `workspace_id` serait refusé par cette clé,
		-- mais APRÈS ce trigger, qui est `BEFORE` : le refus qui remonte est alors celui-ci, et il
		-- est juste — la cible n'appartient pas au workspace revendiqué.
		--
		-- « MEMBRE ACTIF » SE LIT « MEMBRE », ET LA MESURE L'IMPOSE : ni `workspace_members` ni
		-- `profiles` ne portent de statut, de suspension ou de date de sortie. Le produit n'a
		-- aucune notion de membre inactif ; retirer un membre, c'est supprimer sa ligne. Le jour
		-- où un statut d'appartenance apparaîtrait, cette règle devrait être resserrée dans le
		-- même changement — docs/SPEC-contacts.md §9.3 le dit pour que la dette reste visible.
		--
		-- LA RÉSOLUTION LIT LES TABLES EN ENTIER : `SECURITY DEFINER` vaut ici pour la même raison
		-- qu'il vaut pour `form_fields` — un contact invisible à l'appelant ne doit pas être un
		-- contact « inexistant ».
		--
		-- CE QUE CELA NE GARANTIT PAS, et qui est nommé plutôt que tu (docs/SPEC-contacts.md
		-- §9.4) : la vérification a lieu À L'ÉCRITURE. `value` est un `jsonb`, où aucune clé
		-- étrangère n'est possible (INC-033) ; supprimer un contact laisse en place les valeurs
		-- qui le désignaient. Ce bloc supprime la création d'une référence morte, pas la
		-- possibilité qu'une référence meure ensuite.
		when 'user', 'contact' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			begin
				v_cible := (p_valeur #>> '{}')::uuid;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un identifiant', v_champ.key);
			end;

			if v_champ.type = 'contact' then
				if not exists (
					select 1
					  from public.contacts c
					 where c.id = v_cible
					   and c.workspace_id = p_workspace
				) then
					raise exception 'invalid_field_value'
						using detail = format(
							'%s : %s ne désigne aucun contact de ce workspace',
							v_champ.key, v_cible);
				end if;
			else
				if not exists (
					select 1
					  from public.workspace_members m
					 where m.user_id = v_cible
					   and m.workspace_id = p_workspace
				) then
					raise exception 'invalid_field_value'
						using detail = format(
							'%s : %s ne désigne aucun membre de ce workspace',
							v_champ.key, v_cible);
				end if;
			end if;

		-- --- 5.7 Aucun type ne doit échapper au `case` ------------------------------------
		-- Le `CHECK` de `form_fields.type` énumère quinze types. Si l'un venait à s'ajouter sans
		-- être traité ici, il serait silencieusement NON VALIDÉ. Refuser est le seul comportement
		-- qui rende l'oubli visible.
		else
			raise exception 'invalid_field_value'
				using detail = format('type %s non pris en charge par la validation', v_champ.type);
	end case;
end;
$$;

comment on function app.valider_valeur_champ(public.form_fields, jsonb, uuid) is
	'CRM-036, extraite par CRM-068 T4a. Valide une valeur pour un champ : refuse en `invalid_field_value`.';
revoke all on function app.valider_valeur_champ(public.form_fields, jsonb, uuid) from public;

create or replace function app.card_field_values_valider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_champ public.form_fields%rowtype;
begin
	select f.* into v_champ
	  from public.form_fields f
	 where f.id = new.field_id;

	-- MESURÉ : ce `not found` est le chemin ordinaire d'un `field_id` inconnu — un trigger `BEFORE` passe avant la clé
	-- étrangère (pgTAP `0014`).
	if not found then
		raise exception 'invalid_field_value'
			using detail = format('champ %s introuvable', new.field_id);
	end if;

	perform app.valider_valeur_champ(v_champ, new.value, new.workspace_id);

	if new.value is not null and jsonb_typeof(new.value) <> 'null' then
		new.updated_at := now();
	end if;
	return new;
end;
$$;

-- =============================================================================================
-- 2. Les modèles d'affaires — §3.5
-- =============================================================================================

create table if not exists public.card_templates (
	id           uuid          primary key default gen_random_uuid(),
	workspace_id uuid          not null references public.workspaces (id) on delete cascade,
	workflow_id  uuid          not null,
	name         text          not null,
	title        text,
	description  text,
	amount       numeric(14,2),
	currency     text          not null default 'EUR',
	field_values jsonb         not null default '{}'::jsonb,
	checklist    jsonb         not null default '[]'::jsonb,
	archived_at  timestamptz,
	created_by   uuid          default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz   not null default now(),
	updated_at   timestamptz   not null default now(),
	constraint card_templates_workflow_fkey
		foreign key (workflow_id, workspace_id) references public.workflows (id, workspace_id) on delete cascade,
	constraint card_templates_name_check check (app.btrim_blancs(name) <> '' and char_length(name) <= 120),
	constraint card_templates_title_check check (title is null or char_length(title) <= 500),
	constraint card_templates_currency_check check (currency ~ '^[A-Z]{3}$'),
	constraint card_templates_field_values_check check (jsonb_typeof(field_values) = 'object'),
	constraint card_templates_checklist_check check (jsonb_typeof(checklist) = 'array')
);

-- Un nom par espace parmi les modèles NON archivés : archiver libère le nom.
create unique index if not exists card_templates_workspace_name_key
	on public.card_templates (workspace_id, lower(app.btrim_blancs(name))) where archived_at is null;
create index if not exists card_templates_workflow_idx on public.card_templates (workflow_id) where archived_at is null;

comment on table public.card_templates is
	'CRM-068 — docs/SPEC-checklists.md §3.5. Les modèles d''affaires : ce qu''un modèle préremplit à la création.';

-- La forme d'un modèle, tenue par la base : chaque valeur répond à une question NON archivée de son workflow, et passe la
-- règle d'une valeur d'affaire ; chaque point de checklist est un libellé de 1 à 200 caractères.
create or replace function app.card_templates_valider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cle    text;
	v_valeur jsonb;
	v_champ  public.form_fields%rowtype;
	v_point  jsonb;
begin
	for v_cle, v_valeur in select key, value from jsonb_each(new.field_values) loop
		select f.* into v_champ
		  from public.form_fields f
		 where f.workflow_id = new.workflow_id and f.key = v_cle and f.archived_at is null;
		if not found then
			raise exception 'template_field_unknown'
				using errcode = '22023', detail = v_cle;
		end if;
		perform app.valider_valeur_champ(v_champ, v_valeur, new.workspace_id);
	end loop;

	for v_point in select value from jsonb_array_elements(new.checklist) loop
		if jsonb_typeof(v_point) <> 'string'
		   or app.btrim_blancs(v_point #>> '{}') = ''
		   or char_length(v_point #>> '{}') > 200 then
			raise exception 'template_checklist_invalid'
				using errcode = '22023', detail = v_point::text;
		end if;
	end loop;

	if tg_op = 'UPDATE' then
		new.created_by := old.created_by;
		new.created_at := old.created_at;
		new.updated_at := now();
	end if;
	return new;
end;
$$;

drop trigger if exists card_templates_valider on public.card_templates;
create trigger card_templates_valider
	before insert or update on public.card_templates
	for each row execute function app.card_templates_valider();

alter table public.card_templates enable row level security;

-- Lecture : tout membre de l'espace (« Nouvelle affaire » les propose) ; écriture : l'administrateur (Q1, décision 748).
drop policy if exists card_templates_lecture on public.card_templates;
create policy card_templates_lecture on public.card_templates
	for select to authenticated using (app.is_workspace_member(workspace_id));
drop policy if exists card_templates_ecriture on public.card_templates;
create policy card_templates_ecriture on public.card_templates
	for all to authenticated
	using (app.is_workspace_admin(workspace_id)) with check (app.is_workspace_admin(workspace_id));

-- Aucune suppression : un modèle s'archive (§3.5). L'auteur et les dates sont posés par la base. Les privilèges par défaut
-- de `public` sont d'abord retirés — sans cela, `authenticated` recevrait `DELETE` (mesuré, pgTAP `0122` n° 2).
revoke all on public.card_templates from anon, authenticated;
grant select on public.card_templates to authenticated;
grant insert (workspace_id, workflow_id, name, title, description, amount, currency, field_values, checklist)
	on public.card_templates to authenticated;
grant update (name, title, description, amount, currency, field_values, checklist, archived_at)
	on public.card_templates to authenticated;

-- =============================================================================================
-- 3. `creer_affaire` applique un modèle — §3.6
-- =============================================================================================

-- LA SIGNATURE GAGNE UN PARAMÈTRE PAR DÉFAUT, ET L'ANCIENNE EST RETIRÉE : les deux coexistant, un appel à deux arguments
-- serait ambigu. Les appels existants — webapp, seed, preuves, connecteur — gardent leur forme.
drop function if exists public.creer_affaire(uuid, text);

create or replace function public.creer_affaire(p_channel uuid, p_titre text, p_template uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
	appelant   uuid := auth.uid();
	le_channel record;
	l_etape    uuid;
	l_affaire  uuid;
	le_modele  public.card_templates%rowtype;
	le_rattachement uuid;
	v_cle      text;
	v_valeur   jsonb;
	v_rang     integer := 0;
	v_point    jsonb;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Le channel, lu sous la RLS de l'appelant : illisible et inexistant se confondent.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at
	  into le_channel
	  from public.channels c
	 where c.id = p_channel;
	if not found then
		raise exception 'channel introuvable'
			using errcode = 'P0002';
	end if;

	-- 3. Un channel archivé ou à la corbeille ne reçoit plus d'affaire.
	if le_channel.archived_at is not null or le_channel.deleted_at is not null then
		raise exception 'channel ferme'
			using errcode = 'P0001',
			      detail  = 'le channel est archive ou a la corbeille';
	end if;

	-- 3 bis. `CRM-068` T4a — le modèle, lu sous la RLS : un modèle illisible, archivé ou inexistant se confondent ; un
	--        modèle d'un autre workflow que celui du channel est refusé (§3.6).
	if p_template is not null then
		select t.* into le_modele
		  from public.card_templates t
		 where t.id = p_template and t.archived_at is null;
		if not found then
			raise exception 'template_not_found'
				using errcode = 'P0002';
		end if;
		if le_modele.workflow_id <> le_channel.workflow_id then
			raise exception 'template_workflow_mismatch'
				using errcode = '22023';
		end if;
	end if;

	-- 4. L'étape d'entrée est l'étape INITIALE du workflow du channel.
	select s.id into l_etape
	  from public.workflow_steps s
	 where s.workflow_id = le_channel.workflow_id
	   and s.is_initial
	 order by s.position
	 limit 1;
	if l_etape is null then
		raise exception 'aucune etape initiale'
			using errcode = 'P0001',
			      detail  = 'designer l''etape initiale du workflow dans l''editeur';
	end if;

	-- 5. L'affaire. Un titre blanc est refusé par la contrainte existante (`23514`) ; un channel que l'appelant ne peut
	--    pas écrire, par `cards_insertion` (`42501`).
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, created_by)
	values (le_channel.workspace_id, le_channel.id, le_channel.workflow_id, l_etape, btrim(p_titre), appelant)
	returning id into l_affaire;

	-- 6. `CRM-068` T4a — LE MODÈLE EST APPLIQUÉ DANS LA MÊME TRANSACTION, PAR LES MÊMES ÉCRITURES QU'À L'ÉCRAN, sous la RLS
	--    de l'appelant : description et devise sur l'affaire, montant sur son rattachement, valeurs de champ sur le
	--    rattachement (le déclencheur de `card_field_values` les valide encore), points libres sur l'affaire. Une question
	--    archivée depuis l'écriture du modèle est ignorée : elle ne serait demandée nulle part.
	if p_template is not null then
		update public.cards
		   set description = coalesce(le_modele.description, description),
		       currency    = le_modele.currency
		 where id = l_affaire;

		select p.id into le_rattachement
		  from public.card_placements p
		 where p.card_id = l_affaire
		 order by p.created_at, p.id
		 limit 1;

		if le_modele.amount is not null then
			update public.card_placements set amount = le_modele.amount where id = le_rattachement;
		end if;

		for v_cle, v_valeur in select key, value from jsonb_each(le_modele.field_values) loop
			insert into public.card_field_values (card_id, placement_id, field_id, workflow_id, workspace_id, value)
			select l_affaire, le_rattachement, f.id, f.workflow_id, f.workspace_id, v_valeur
			  from public.form_fields f
			 where f.workflow_id = le_channel.workflow_id and f.key = v_cle and f.archived_at is null;
		end loop;

		for v_point in select value from jsonb_array_elements(le_modele.checklist) loop
			v_rang := v_rang + 1;
			insert into public.card_checklist_items (workspace_id, card_id, label, position)
			values (le_channel.workspace_id, l_affaire, v_point #>> '{}', v_rang);
		end loop;
	end if;

	return l_affaire;
end;
$$;

revoke all on function public.creer_affaire(uuid, text, uuid) from public, anon;
grant execute on function public.creer_affaire(uuid, text, uuid) to authenticated, service_role;

-- =============================================================================================
-- 4. « Enregistrer comme modèle » — §3.6
-- =============================================================================================

-- SOUS LA RLS DE L'APPELANT : il lit le rattachement et ses valeurs comme l'écran les lit, et l'insertion du modèle est
-- tenue par la politique d'écriture (administrateur). Le refus est nommé avant d'écrire, pour un message propre.
create or replace function public.save_card_as_template(p_placement uuid, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
	le_rattachement public.card_placements%rowtype;
	l_affaire       public.cards%rowtype;
	v_valeurs       jsonb;
	v_points        jsonb;
	le_modele       uuid;
begin
	select p.* into le_rattachement from public.card_placements p where p.id = p_placement;
	if not found then
		raise exception 'placement_not_found' using errcode = 'P0002';
	end if;
	if not app.is_workspace_admin(le_rattachement.workspace_id) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	select c.* into l_affaire from public.cards c where c.id = le_rattachement.card_id;

	-- Les valeurs du rattachement, sur ses questions NON archivées, renseignées.
	select coalesce(jsonb_object_agg(f.key, v.value), '{}'::jsonb)
	  into v_valeurs
	  from public.card_field_values v
	  join public.form_fields f on f.id = v.field_id
	 where v.placement_id = p_placement
	   and f.archived_at is null
	   and not app.valeur_de_champ_est_vide(v.value);

	-- Les libellés de TOUS ses points — d'étape et libres —, devenus libres dans le modèle ; les cochages ne sont pas repris.
	select coalesce(jsonb_agg(i.label order by i.placement_id nulls last, i.position, i.created_at), '[]'::jsonb)
	  into v_points
	  from public.card_checklist_items i
	 where i.card_id = l_affaire.id
	   and (i.placement_id is null or i.placement_id = p_placement);

	insert into public.card_templates
		(workspace_id, workflow_id, name, title, description, amount, currency, field_values, checklist)
	values
		(le_rattachement.workspace_id, le_rattachement.workflow_id, app.btrim_blancs(p_name), l_affaire.title,
		 l_affaire.description, le_rattachement.amount, l_affaire.currency, v_valeurs, v_points)
	returning id into le_modele;
	return le_modele;
end;
$$;

revoke all on function public.save_card_as_template(uuid, text) from public, anon;
grant execute on function public.save_card_as_template(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
