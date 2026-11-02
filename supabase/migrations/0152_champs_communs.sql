-- @spec CRM-112 (docs/BACKLOG.md) — tranche T1 : les champs personnalisés communs de portée espace, en base — les deux
--       tables, leurs clés composites, la validation par type partagée, les politiques et les privilèges
-- @spec docs/SPEC-champs-communs.md §3 (le modèle), §4 (les autorisations) ; docs/SCHEMA.md « Migration `0152` » ;
--       docs/JOURNAL.md décisions 642, 658, 664 et 665
--
-- Deux tables DISTINCTES de `form_fields` (§3.1, décision 664) : un champ commun appartient à l'ESPACE, jamais à un
-- workflow, si bien que les clés composites de `form_fields` et les trois fonctions de composition restent intactes.
-- Un champ commun a UNE valeur par affaire, partagée par tous ses rattachements.
--
-- LA VALIDATION PAR TYPE EST UNE SEULE (§3.3) : le cœur de `app.valider_valeur_champ` (CRM-036, extrait par CRM-068 T4a)
-- devient `app.validate_field_value(type, options, clé, valeur, espace)`, que les champs de workflow et les champs communs
-- appellent. La clé est un paramètre de plus que la proposition du §3.3 : chaque refus la nomme, et la pgTAP `0014` en
-- tient le texte. `app.valider_valeur_champ` garde sa signature et délègue.
--
-- IDEMPOTENCE : `create table if not exists`, contraintes retirées puis reposées, `create or replace`, déclencheurs et
-- politiques retirés puis recréés.

-- =============================================================================================
-- 1. La validation par type, partagée — §3.3
-- =============================================================================================

create or replace function app.validate_field_value(p_type text, p_options jsonb, p_key text, p_valeur jsonb, p_workspace uuid)
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

	case p_type

		-- --- 5.2 Les types textuels -------------------------------------------------------
		-- `phone` n'est PAS contraint, et c'est délibéré : les formats nationaux sont trop divers
		-- pour qu'un refus soit défendable. Le dire vaut mieux que d'imposer une norme arbitraire.
		when 'text', 'textarea', 'phone', 'file' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;

		when 'url' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			-- `^https?://` refuse `javascript:` et `data:`, qui sont les seules formes dont
			-- l'affichage serait dangereux. Une validation plus fine refuserait des adresses
			-- légitimes sans rien gagner.
			if (p_valeur #>> '{}') !~ '^https?://[^[:space:]]+$' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une adresse http(s)', p_key);
			end if;

		when 'email' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			if (p_valeur #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une adresse électronique', p_key);
			end if;

		-- --- 5.3 Les types numériques -----------------------------------------------------
		-- `money` ne vérifie PAS la devise : elle est portée par `options.currency` du champ, non
		-- par la valeur (docs/SPEC-form-composer.md §2.4).
		when 'number', 'money' then
			if v_forme <> 'number' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un nombre, reçu %s', p_key, v_forme);
			end if;

		when 'checkbox' then
			if v_forme <> 'boolean' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un booléen, reçu %s', p_key, v_forme);
			end if;

		-- --- 5.4 Les types temporels ------------------------------------------------------
		-- La conversion EST la validation : PostgreSQL sait dire si une chaîne est une date.
		-- Le `begin … exception` local convertit son refus en un message du produit, plutôt que de
		-- laisser remonter « invalid input syntax for type date », qui nomme un type interne.
		when 'date' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			begin
				perform (p_valeur #>> '{}')::date;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une date ISO 8601', p_key);
			end;

		when 'datetime' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			begin
				perform (p_valeur #>> '{}')::timestamptz;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un horodatage ISO 8601', p_key);
			end;

		-- --- 5.5 Les types à choix — décision 131 -----------------------------------------
		-- Le point ouvert n° 4 du §8 était en suspens depuis `CRM-035` : la base ne contraint pas
		-- la forme des entrées de `options.choices`, un `CHECK` ne pouvant porter de sous-requête.
		-- La contrainte est posée là où elle a une conséquence — LA VALEUR. La déclaration reste
		-- libre ; aucune card ne peut plus porter une réponse que son champ n'offre pas.
		when 'select' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			v_texte := p_valeur #>> '{}';
			if not exists (
				select 1
				  from jsonb_array_elements(p_options -> 'choices') c
				 where c ->> 'key' = v_texte
			) then
				raise exception 'invalid_field_value'
					using detail = format('%s : « %s » ne figure pas dans les choix déclarés',
					                      p_key, v_texte);
			end if;

		when 'multiselect' then
			if v_forme <> 'array' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un tableau, reçu %s', p_key, v_forme);
			end if;
			for v_element in select * from jsonb_array_elements(p_valeur) loop
				if jsonb_typeof(v_element) <> 'string' then
					raise exception 'invalid_field_value'
						using detail = format('%s attend un tableau de chaînes', p_key);
				end if;
				if not exists (
					select 1
					  from jsonb_array_elements(p_options -> 'choices') c
					 where c ->> 'key' = v_element #>> '{}'
				) then
					raise exception 'invalid_field_value'
						using detail = format('%s : « %s » ne figure pas dans les choix déclarés',
						                      p_key, v_element #>> '{}');
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
					using detail = format('%s attend une chaîne, reçu %s', p_key, v_forme);
			end if;
			begin
				v_cible := (p_valeur #>> '{}')::uuid;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un identifiant', p_key);
			end;

			if p_type = 'contact' then
				if not exists (
					select 1
					  from public.contacts c
					 where c.id = v_cible
					   and c.workspace_id = p_workspace
				) then
					raise exception 'invalid_field_value'
						using detail = format(
							'%s : %s ne désigne aucun contact de ce workspace',
							p_key, v_cible);
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
							p_key, v_cible);
				end if;
			end if;

		-- --- 5.7 Aucun type ne doit échapper au `case` ------------------------------------
		-- Le `CHECK` de `form_fields.type` énumère quinze types. Si l'un venait à s'ajouter sans
		-- être traité ici, il serait silencieusement NON VALIDÉ. Refuser est le seul comportement
		-- qui rende l'oubli visible.
		else
			raise exception 'invalid_field_value'
				using detail = format('type %s non pris en charge par la validation', p_type);
	end case;
end;
$$;
comment on function app.validate_field_value(text, jsonb, text, jsonb, uuid) is
	'CRM-112 (0152) : valide une valeur selon le type et les options d''un champ, de workflow ou commun ; refuse en '
	'`invalid_field_value`. Extraite de app.valider_valeur_champ (CRM-036, CRM-068 T4a).';
revoke all on function app.validate_field_value(text, jsonb, text, jsonb, uuid) from public;

-- La fonction des champs de workflow garde sa signature — trois déclencheurs l'appellent — et délègue.
create or replace function app.valider_valeur_champ(v_champ public.form_fields, p_valeur jsonb, p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.validate_field_value(v_champ.type, v_champ.options, v_champ.key, p_valeur, p_workspace);
end;
$$;

-- =============================================================================================
-- 2. `public.card_common_fields` — la définition, §3.2
-- =============================================================================================

create table if not exists public.card_common_fields (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	key          text        not null,
	label        text        not null,
	type         text        not null,
	options      jsonb       not null default '{}'::jsonb,
	help_text    text,
	is_listed    boolean     not null default false,
	position     numeric     not null,
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- Les contraintes de `form_fields` (0009), à l'identique : même forme de clé, mêmes quinze types, mêmes options.
alter table public.card_common_fields drop constraint if exists card_common_fields_id_workspace_key;
alter table public.card_common_fields add  constraint card_common_fields_id_workspace_key unique (id, workspace_id);
alter table public.card_common_fields drop constraint if exists card_common_fields_workspace_key_key;
alter table public.card_common_fields add  constraint card_common_fields_workspace_key_key unique (workspace_id, key);
alter table public.card_common_fields drop constraint if exists card_common_fields_key_check;
alter table public.card_common_fields add  constraint card_common_fields_key_check
	check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table public.card_common_fields drop constraint if exists card_common_fields_label_check;
alter table public.card_common_fields add  constraint card_common_fields_label_check check (btrim(label) <> '');
alter table public.card_common_fields drop constraint if exists card_common_fields_help_text_check;
alter table public.card_common_fields add  constraint card_common_fields_help_text_check
	check (help_text is null or btrim(help_text) <> '');
alter table public.card_common_fields drop constraint if exists card_common_fields_type_check;
alter table public.card_common_fields add  constraint card_common_fields_type_check
	check (type in ('text', 'textarea', 'number', 'money', 'date', 'datetime',
	                'select', 'multiselect', 'checkbox', 'url', 'email', 'phone',
	                'user', 'contact', 'file'));
alter table public.card_common_fields drop constraint if exists card_common_fields_options_object_check;
alter table public.card_common_fields add  constraint card_common_fields_options_object_check
	check (jsonb_typeof(options) = 'object');
-- Le `coalesce` n'est pas une précaution de style (0009, décision 102) : sans lui, un `select` à `{}` passait.
alter table public.card_common_fields drop constraint if exists card_common_fields_choices_check;
alter table public.card_common_fields add  constraint card_common_fields_choices_check
	check (type not in ('select', 'multiselect')
	       or coalesce(jsonb_typeof(options -> 'choices') = 'array' and options -> 'choices' <> '[]'::jsonb, false));
alter table public.card_common_fields drop constraint if exists card_common_fields_currency_check;
alter table public.card_common_fields add  constraint card_common_fields_currency_check
	check (type <> 'money' or coalesce((options ->> 'currency') ~ '^[A-Z]{3}$', false));

create index if not exists card_common_fields_workspace_idx
	on public.card_common_fields (workspace_id, position) where archived_at is null;

comment on table public.card_common_fields is
	'CRM-112 — docs/SPEC-champs-communs.md §3.2. Les champs communs d''un espace : une valeur par affaire, partagée '
	'par ses rattachements. La clé n''est pas modifiable (les modèles d''email la citent) ; aucune suppression.';

-- La position : en fin de liste de l'espace lorsqu'elle est omise, les archivés comptant (comme `form_fields`, 0009).
create or replace function app.card_common_fields_set_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(f.position), 0) + 1 from public.card_common_fields f where f.workspace_id = new.workspace_id
		);
	end if;
	return new;
end;
$$;
revoke all on function app.card_common_fields_set_position() from public;

drop trigger if exists card_common_fields_set_position on public.card_common_fields;
create trigger card_common_fields_set_position
	before insert on public.card_common_fields
	for each row execute function app.card_common_fields_set_position();

drop trigger if exists card_common_fields_set_updated_at on public.card_common_fields;
create trigger card_common_fields_set_updated_at
	before update on public.card_common_fields
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. `public.card_common_field_values` — les valeurs, §3.3
-- =============================================================================================

create table if not exists public.card_common_field_values (
	card_id      uuid        not null,
	field_id     uuid        not null,
	workspace_id uuid        not null,
	value        jsonb,
	updated_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint card_common_field_values_pkey primary key (card_id, field_id)
);

-- `workspace_id` est la CHARNIÈRE des deux clés composites : une valeur ne répond qu'à un champ de l'espace de son affaire.
alter table public.card_common_field_values drop constraint if exists card_common_field_values_card_fkey;
alter table public.card_common_field_values add  constraint card_common_field_values_card_fkey
	foreign key (card_id, workspace_id) references public.cards (id, workspace_id) on delete cascade;
alter table public.card_common_field_values drop constraint if exists card_common_field_values_field_fkey;
alter table public.card_common_field_values add  constraint card_common_field_values_field_fkey
	foreign key (field_id, workspace_id) references public.card_common_fields (id, workspace_id) on delete cascade;

create index if not exists card_common_field_values_field_idx on public.card_common_field_values (field_id);

comment on table public.card_common_field_values is
	'CRM-112 — docs/SPEC-champs-communs.md §3.3. La valeur d''un champ commun pour une affaire ; `NULL` et '
	'`''null''::jsonb` valent vide ; aucune suppression : vider, c''est écrire `''null''::jsonb`.';

-- La validation par type, la même que celle des champs de workflow ; l'auteur et les dates posés par la base.
create or replace function app.card_common_field_values_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_champ public.card_common_fields%rowtype;
begin
	-- Un `field_id` inconnu ou d'un autre espace : le déclencheur passe avant la clé étrangère, le refus est nommé ici.
	select f.* into v_champ from public.card_common_fields f where f.id = new.field_id and f.workspace_id = new.workspace_id;
	if not found then
		raise exception 'invalid_field_value' using detail = format('champ commun %s introuvable', new.field_id);
	end if;
	perform app.validate_field_value(v_champ.type, v_champ.options, v_champ.key, new.value, new.workspace_id);
	new.updated_by := coalesce((select auth.uid()), new.updated_by);
	if tg_op = 'UPDATE' then
		new.created_at := old.created_at;
		new.updated_at := now();
	end if;
	return new;
end;
$$;
revoke all on function app.card_common_field_values_validate() from public;

drop trigger if exists card_common_field_values_validate on public.card_common_field_values;
create trigger card_common_field_values_validate
	before insert or update on public.card_common_field_values
	for each row execute function app.card_common_field_values_validate();

-- =============================================================================================
-- 4. Les autorisations — §4
-- =============================================================================================

alter table public.card_common_fields enable row level security;
alter table public.card_common_field_values enable row level security;

drop policy if exists card_common_fields_select_member on public.card_common_fields;
create policy card_common_fields_select_member on public.card_common_fields
	for select to anon, authenticated using (app.is_workspace_member(workspace_id));
drop policy if exists card_common_fields_insert_admin on public.card_common_fields;
create policy card_common_fields_insert_admin on public.card_common_fields
	for insert to authenticated with check (app.is_workspace_admin(workspace_id));
drop policy if exists card_common_fields_update_admin on public.card_common_fields;
create policy card_common_fields_update_admin on public.card_common_fields
	for update to authenticated
	using (app.is_workspace_admin(workspace_id)) with check (app.is_workspace_admin(workspace_id));

drop policy if exists card_common_field_values_select on public.card_common_field_values;
create policy card_common_field_values_select on public.card_common_field_values
	for select to anon, authenticated using (app.can_read_card(card_id));
drop policy if exists card_common_field_values_insert on public.card_common_field_values;
create policy card_common_field_values_insert on public.card_common_field_values
	for insert to authenticated with check (app.can_write_card(card_id));
drop policy if exists card_common_field_values_update on public.card_common_field_values;
create policy card_common_field_values_update on public.card_common_field_values
	for update to authenticated using (app.can_write_card(card_id)) with check (app.can_write_card(card_id));

-- Aucune suppression ; la clé et le type ne se modifient pas (les modèles d'email citent la clé, et une valeur existante
-- dépend du type) ; l'auteur et les dates sont posés par la base. Les privilèges par défaut sont d'abord retirés.
revoke all on public.card_common_fields from anon, authenticated;
revoke all on public.card_common_field_values from anon, authenticated;
grant select on public.card_common_fields to anon, authenticated;
grant insert (workspace_id, key, label, type, options, help_text, is_listed, position)
	on public.card_common_fields to authenticated;
grant update (label, options, help_text, is_listed, position, archived_at) on public.card_common_fields to authenticated;
grant select on public.card_common_field_values to anon, authenticated;
grant insert (card_id, field_id, workspace_id, value) on public.card_common_field_values to authenticated;
grant update (value) on public.card_common_field_values to authenticated;
grant all privileges on public.card_common_fields to service_role;
grant all privileges on public.card_common_field_values to service_role;
