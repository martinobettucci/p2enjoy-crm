-- @spec CRM-036 (docs/BACKLOG.md) — valeurs de formulaire, validation par type, union étape +
--       transition
-- @spec docs/SPEC-form-composer.md §6.2 (modèle), §6.3 (clés composites), §6.4 (la validation est
--       un trigger), §6.5 (ce que chaque type accepte), §6.6 (« renseigné »), §6.7 (la sixième
--       vérification), §6.9 (autorisations)
-- @spec docs/SCHEMA.md §4 (`card_field_values`), §9 (fonctions), §10 (index),
--       « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §4 (politiques), §7 (refus n° 4,
--       n° 11)
-- @spec docs/SPEC-workflow-engine.md §5.3 (les six vérifications), §5.7 (la n° 6, désormais livrée)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décisions 123 (INC-047 close), 124 (l'unicité qui manquait à `cards`),
--       125 (la validation est un trigger), 126 (le DETAIL porte la liste), 127 (« renseigné »),
--       128 (compatibilité de l'ancien tableau), 129 (un champ archivé n'exige rien),
--       130 (`app.can_write_card`), 131 (les choix contraints du côté des réponses),
--       132 (`user` et `contact` non résolus)
-- @spec docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes omises par les tableaux, quatrième
--       occurrence), INC-033 (corrigée ensuite par CRM-018), INC-047 (**close par cette migration**),
--       INC-053 (`user` et `contact` non résolus)
--
-- Depuis `CRM-035`, le produit sait poser des questions ; il ne sait pas recevoir de réponses.
-- Depuis `CRM-034`, `move_card` garde le graphe du workflow avec **cinq** vérifications sur six :
-- la sixième compare un ensemble exigé — calculable — à un ensemble renseigné qui n'a aucune
-- source. Cette migration livre la source, et la sixième vérification avec elle.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : `public.card_field_values` et ses **trois clés étrangères composites**, l'unicité que
-- `cards` devait offrir pour que la première soit légale, la validation par type de la valeur —
-- un trigger, parce qu'un `CHECK` ne le peut pas —, `app.valeur_de_champ_est_vide`,
-- `app.can_write_card`, trois politiques RLS, les privilèges explicites, et la **redéfinition de
-- `public.move_card` avec sa sixième vérification**.
--
-- Non livré, et nommé — chaque manque est **figé par une assertion** de
-- `supabase/tests/0014_valeurs_champs.test.sql` :
--
--   * **aucun écran.** Le rendu du formulaire, la section repliée « Informations d'autres étapes »
--     et la mention « requis pour passer à » sont `CRM-037` (docs/SPEC-form-composer.md §4) ;
--
--   * **aucune résolution de `user`, `contact` ni `file`.** La forme d'un `uuid` est validée, pas
--     l'existence de sa cible : `contacts` n'existe pas (`CRM-060`), et résoudre `user` seul
--     poserait une règle d'appartenance que nul document n'énonce. INC-053 ;
--
--   * **aucune trace.** Une valeur écrasée est perdue : `card_events` est due par `CRM-044` ;
--
--   * **aucune condition inter-champs** (docs/SPEC-form-composer.md §8, point 1).
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi `move_card` est redéfinie ici plutôt que corrigée dans la migration 12.
-- ---------------------------------------------------------------------------------------------
-- La migration 12 est le livrable de `CRM-034`, et elle est **déjà appliquée**. La réécrire
-- ferait dériver le registre de `docs/PROD_MIGRATIONS.md` de ce qui a réellement été exécuté sur
-- une base de production. Le `migrations-runner` rejouant le répertoire **en ordre** à chaque
-- démarrage (docs/JOURNAL.md, décision 20), la définition de cette migration-ci l'emporte : 12
-- pose la version à cinq vérifications, 13 la remplace par celle à six. La dépendance d'ordre est
-- inscrite dans `docs/PROD_MIGRATIONS.md` §3, comme celle entre 3, 4 et 10 avant elle.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence et convergence.
-- ---------------------------------------------------------------------------------------------
-- Tout est rejouable, et **convergent** au sens d'INC-035 : une contrainte remplacée à la main par
-- une contrainte plus faible portant le même nom est réparée par le rejeu. Le mécanisme est celui
-- de la décision 78, repris de la migration 11.

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Même fonction que la migration 11, sous un nom propre à cette migration : les deux sont retirées
-- en fin de fichier, et un nom partagé rendrait l'ordre de suppression significatif.

create or replace function app.migration_0013_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname  = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

-- =============================================================================================
-- 1. L'unicité que `cards` devait offrir, et qui manquait — décision 124
-- =============================================================================================
-- MESURÉ le 2026-08-05, sur une table sonde créée puis détruite :
--
--   create table sonde (card_id uuid, workflow_id uuid,
--     foreign key (card_id, workflow_id) references public.cards (id, workflow_id));
--   ERROR:  there is no unique constraint matching given keys for referenced table "cards"
--
-- `cards` ne porte que `PRIMARY KEY (id)`, là où `form_fields` porte `UNIQUE (id, workflow_id)`
-- depuis `CRM-035` et `workflow_steps` depuis `CRM-031`. La contrainte manquait par **omission**,
-- non par choix : `CRM-040` n'avait aucune table fille à servir.
--
-- ELLE NE CHANGE AUCUN COMPORTEMENT. `id` étant déjà clé primaire, le couple était déjà unique ;
-- elle rend seulement la relation exprimable. C'est le même geste que `CRM-021` sur `tracks`,
-- `CRM-031` sur le catalogue et `CRM-040` sur `channels`.

select app.migration_0013_converger_contrainte(
	'public.cards', 'cards_id_workflow_id_key', 'UNIQUE (id, workflow_id)');

comment on constraint cards_id_workflow_id_key on public.cards is
	'CRM-036 — docs/SPEC-form-composer.md §6.3. Unicité redondante, exigée par la clé étrangère '
	'composite de `card_field_values` : sans elle, « there is no unique constraint matching given '
	'keys for referenced table "cards" » — MESURÉ. Ne change aucun comportement de `cards`.';

-- =============================================================================================
-- 2. `public.card_field_values`
-- =============================================================================================
-- docs/SPEC-form-composer.md §6.2, docs/SCHEMA.md §4.
--
-- La clé primaire est `(card_id, field_id)` : une card porte **au plus une** valeur par champ.
-- Deux réponses contradictoires à la même question sont structurellement impossibles, comme deux
-- visibilités pour un même couple champ × étape.
--
-- `created_at` s'ajoute au tableau de docs/SCHEMA.md §4, qui n'énumérait qu'`updated_at` :
-- **quatrième occurrence d'INC-025**, les « Conventions générales » du même document imposant les
-- deux horodatages à toute table métier. Le tableau est corrigé dans le même changement.

create table if not exists public.card_field_values (
	card_id      uuid        not null,
	field_id     uuid        not null,
	workflow_id  uuid        not null,
	workspace_id uuid        not null,
	-- NULLABLE, ET C'EST UNE MESURE QUI L'A IMPOSÉ — décision 133, INC-054.
	-- docs/SCHEMA.md §4 annonçait `non nul`, avec `'null'::jsonb` pour « explicitement vide ».
	-- MESURÉ le 2026-08-05 contre PostgREST v14.12 : un `null` JSON dans le corps d'une requête est
	-- converti en **SQL NULL**, jamais en `'null'::jsonb` — et `"null"` est la chaîne. La valeur
	-- `'null'::jsonb` est donc INATTEIGNABLE depuis l'API, ce qui rendait « vider un champ »
	-- impossible pour tout type dont la validation refuse la chaîne vide : un `money` vidé n'avait
	-- aucune écriture licite. Les deux formes valent « explicitement vide » (§6.6).
	value        jsonb,
	updated_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	primary key (card_id, field_id)
);

comment on table public.card_field_values is
	'CRM-036 — docs/SPEC-form-composer.md §6. Réponse d''une card à une question de son workflow. '
	'`''null''::jsonb` signifie EXPLICITEMENT VIDE : une ligne présente n''est pas une valeur '
	'renseignée (§6.6). La forme de `value` est validée par trigger selon `form_fields.type`, un '
	'`CHECK` ne pouvant porter aucune sous-requête — MESURÉ (décision 125).';

comment on column public.card_field_values.workflow_id is
	'CRM-036 — charnière des deux clés composites de la section 3 : c''est elle qui rend impossible '
	'une valeur répondant à la question d''un AUTRE workflow.';

comment on column public.card_field_values.value is
	'CRM-036 — docs/SPEC-form-composer.md §6.5 et §6.6. NULLABLE : MESURÉ, PostgREST convertit un '
	'`null` JSON en SQL NULL et ne sait pas produire `''null''::jsonb`, ce qui rendait « vider un '
	'champ money » impossible (décision 133, INC-054). SQL NULL, `''null''::jsonb`, la chaîne vide '
	'et le tableau vide valent « non renseigné » ; `false`, `0` et `"0"` sont des réponses.';

-- =============================================================================================
-- 3. Trois clés étrangères composites — décision 124
-- =============================================================================================
-- Le mécanisme de la décision 95, repris et non réinventé : un trigger aurait rendu le même
-- service, plus tard et moins sûrement. Ici, le moteur vérifie des deux côtés de la relation, y
-- compris contre un `PATCH` direct qu'aucune garde applicative ne verrait passer.

-- --- 3.1 La valeur appartient à la card, et la card au workflow déclaré ----------------------
-- `ON DELETE CASCADE` : une réponse sans card n'est pas une donnée à conserver.

select app.migration_0013_converger_contrainte(
	'public.card_field_values', 'card_field_values_card_id_workflow_id_fkey',
	'FOREIGN KEY (card_id, workflow_id) REFERENCES public.cards(id, workflow_id) ON DELETE CASCADE');

-- --- 3.2 La valeur répond à un champ du MÊME workflow ----------------------------------------
-- MESURÉ dans les deux sens, comme pour `form_field_rules` : quel que soit le `workflow_id`
-- déclaré, l'une des deux clés attrape l'erreur en `23503`.
--
-- `ON DELETE CASCADE` : ce cas ne se produit pas depuis le produit — `form_fields` n'expose
-- **aucune** suppression et l'archivage en tient lieu (docs/SPEC-form-composer.md §2.7). La
-- cascade protège la cohérence d'un geste d'exploitation, pas d'un geste d'utilisateur.

select app.migration_0013_converger_contrainte(
	'public.card_field_values', 'card_field_values_field_id_workflow_id_fkey',
	'FOREIGN KEY (field_id, workflow_id) REFERENCES public.form_fields(id, workflow_id) ON DELETE CASCADE');

-- --- 3.3 Le `workspace_id` dénormalisé dit la vérité ------------------------------------------
-- Une politique décide qui écrit la ligne, pas ce que la ligne raconte (décision 73).

select app.migration_0013_converger_contrainte(
	'public.card_field_values', 'card_field_values_workflow_id_workspace_id_fkey',
	'FOREIGN KEY (workflow_id, workspace_id) REFERENCES public.workflows(id, workspace_id) ON DELETE CASCADE');

-- =============================================================================================
-- 4. `app.valeur_de_champ_est_vide` — décision 127
-- =============================================================================================
-- docs/SPEC-form-composer.md §6.6. « Renseigné » est une définition, et elle ne doit exister qu'à
-- un seul endroit : la sixième vérification de `move_card` et le rendu de `CRM-037` doivent en
-- donner la MÊME lecture, faute de quoi l'interface annoncerait passable une transition que la
-- garde refuse.
--
-- `false`, `0` et `"0"` sont des réponses, pas des absences de réponse : confondre les deux
-- rendrait une case à cocher impossible à satisfaire par la négative.
--
-- `IMMUTABLE` : la fonction ne lit aucune table et ne dépend que de son argument. `SECURITY
-- INVOKER` pour la même raison — lui donner les droits du propriétaire serait un privilège gratuit.

create or replace function app.valeur_de_champ_est_vide(valeur jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
	select valeur is null
	    or jsonb_typeof(valeur) = 'null'
	    or (jsonb_typeof(valeur) = 'string' and btrim(valeur #>> '{}') = '')
	    or (jsonb_typeof(valeur) = 'array'  and jsonb_array_length(valeur) = 0);
$$;

comment on function app.valeur_de_champ_est_vide(jsonb) is
	'CRM-036 — docs/SPEC-form-composer.md §6.6. Seule définition de « non renseigné » du produit : '
	'`null` jsonb, chaîne vide ou d''espaces, tableau vide. `false`, `0` et `"0"` sont RENSEIGNÉS.';

revoke all on function app.valeur_de_champ_est_vide(jsonb) from public;
grant execute on function app.valeur_de_champ_est_vide(jsonb) to anon, authenticated, service_role;

-- =============================================================================================
-- 5. La validation par type — décisions 125, 131 et 132
-- =============================================================================================
-- docs/SPEC-form-composer.md §6.4 et §6.5.
--
-- UN `CHECK` NE PEUT PAS LA PORTER, ET C'EST MESURÉ, non déduit :
--
--   create table sonde (… check (exists (select 1 from public.form_fields …)));
--   ERROR:  cannot use subquery in check constraint
--
-- Le type qui gouverne une valeur est déclaré sur une **autre** table. La validation est donc un
-- trigger `BEFORE INSERT OR UPDATE`.
--
-- `SECURITY DEFINER` n'est pas un confort : le trigger doit lire `form_fields` **en entier**, et
-- non ce que la RLS de l'appelant lui montre. Un champ invisible ne doit pas être un champ non
-- validé.
--
-- Le refus porte `message = 'invalid_field_value'` — jeton stable, comparable par égalité, comme
-- les six refus de `move_card` — et le `DETAIL` nomme la clé du champ et la forme attendue
-- (décision 126). MESURÉ : PostgREST rend `400` pour un refus levé depuis un trigger, et expose le
-- `DETAIL` dans la clé `details` de sa réponse.

create or replace function app.card_field_values_valider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_champ  public.form_fields%rowtype;
	v_forme  text := jsonb_typeof(new.value);
	v_texte  text;
	v_element jsonb;
begin
	select f.* into v_champ
	  from public.form_fields f
	 where f.id = new.field_id;

	-- MESURÉ, ET CONTRE-INTUITIF : ce `not found` est le chemin ORDINAIRE d'un `field_id` inconnu.
	-- Un trigger `BEFORE` s'exécute AVANT la vérification des clés étrangères, si bien que la clé
	-- composite de la section 3.2 n'est jamais atteinte dans ce cas — c'est ce refus-ci qui remonte,
	-- en `invalid_field_value` et non en `23503`. Les deux refusent ; seul leur auteur change, et
	-- l'ordre est figé par une assertion de `supabase/tests/0014_valeurs_champs.test.sql`.
	if not found then
		raise exception 'invalid_field_value'
			using detail = format('champ %s introuvable', new.field_id);
	end if;

	-- --- 5.1 « Vidé explicitement » est accepté pour TOUS les types --------------------------
	-- docs/SCHEMA.md §4 et docs/SPEC-form-composer.md §6.6. Deux écritures valent vide : le SQL
	-- NULL, seul que l'API sache produire, et `'null'::jsonb`, qu'un client SQL peut écrire.
	-- Sans cette sortie anticipée, vider un champ `select` exigerait une clé de choix, et vider un
	-- `money` serait impossible — décision 133.
	if new.value is null or v_forme = 'null' then
		return new;
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
			if (new.value #>> '{}') !~ '^https?://[^[:space:]]+$' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une adresse http(s)', v_champ.key);
			end if;

		when 'email' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			if (new.value #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
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
				perform (new.value #>> '{}')::date;
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
				perform (new.value #>> '{}')::timestamptz;
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
			v_texte := new.value #>> '{}';
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
			for v_element in select * from jsonb_array_elements(new.value) loop
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

		-- --- 5.6 Les types qui désignent un objet — décision 132, INC-053 -----------------
		-- LA FORME EST VALIDÉE, PAS L'EXISTENCE DE LA CIBLE, et c'est nommé plutôt que tu.
		-- `contact` vise `contacts`, table qui n'existe pas (`CRM-060`) ; résoudre `user` seul
		-- rendrait la famille incohérente et poserait une règle d'appartenance que nul document
		-- n'énonce. INC-053, arbitrage attendu.
		when 'user', 'contact' then
			if v_forme <> 'string' then
				raise exception 'invalid_field_value'
					using detail = format('%s attend une chaîne, reçu %s', v_champ.key, v_forme);
			end if;
			begin
				perform (new.value #>> '{}')::uuid;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un identifiant', v_champ.key);
			end;

		-- --- 5.7 Aucun type ne doit échapper au `case` ------------------------------------
		-- Le `CHECK` de `form_fields.type` énumère quinze types. Si l'un venait à s'ajouter sans
		-- être traité ici, il serait silencieusement NON VALIDÉ. Refuser est le seul comportement
		-- qui rende l'oubli visible.
		else
			raise exception 'invalid_field_value'
				using detail = format('type %s non pris en charge par la validation', v_champ.type);
	end case;

	new.updated_at := now();
	return new;
end;
$$;

comment on function app.card_field_values_valider() is
	'CRM-036 — docs/SPEC-form-composer.md §6.4, §6.5. Trigger BEFORE INSERT OR UPDATE : valide la '
	'FORME de `value` selon `form_fields.type`. `SECURITY DEFINER` parce qu''il doit voir tous les '
	'champs, pas ceux que la RLS de l''appelant montre. Refus : `invalid_field_value`, le DETAIL '
	'nommant la clé et la forme attendue. `user` et `contact` ne sont PAS résolus — INC-053.';

revoke all on function app.card_field_values_valider() from public;

drop trigger if exists card_field_values_valider on public.card_field_values;
create trigger card_field_values_valider
	before insert or update on public.card_field_values
	for each row execute function app.card_field_values_valider();

-- `updated_at` : le trigger ci-dessus le pose déjà, mais seulement lorsqu'il s'exécute. Le trigger
-- commun est conservé pour que la colonne soit tenue même si la validation venait à être retirée.
drop trigger if exists card_field_values_set_updated_at on public.card_field_values;
create trigger card_field_values_set_updated_at
	before update on public.card_field_values
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 6. Index
-- =============================================================================================
-- docs/SCHEMA.md §10 : GIN sur `value`, pour les filtres des vues sauvegardées (`CRM-042`).
-- L'index sur `field_id` sert la lecture « toutes les valeurs d'un champ », que l'export et les
-- statistiques emprunteront ; la clé primaire couvre déjà l'accès par card.

create index if not exists card_field_values_value_idx
	on public.card_field_values using gin (value);

create index if not exists card_field_values_field_idx
	on public.card_field_values (field_id);

-- =============================================================================================
-- 7. `app.can_write_card` — décision 130
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.7. Symétrique exact d'`app.can_read_card`, livrée pour la même
-- raison : une table fille ne dispose que d'un `card_id`, et aucune politique d'écriture ne peut
-- atteindre le channel sans cette jointure.
--
-- COMME SA JUMELLE, ELLE N'EST PAS APPELÉE PAR LES POLITIQUES DE `cards`, qui jugent sur
-- `channel_id`, colonne de la ligne jugée (décision 110). Une politique qui relirait sa propre
-- table ferait rendre `403` à toute création.
--
-- `EXECUTE` à `anon` aussi : sans lui, un appelant anonyme atteignant une table dont la politique
-- l'appelle recevrait une **erreur de privilège**, alors que le comportement exigé par
-- docs/SPEC-permissions-rls.md §7 est **zéro ligne**. Le droit n'ouvre rien : `auth.uid()` étant
-- nul, `app.can_write_channel` rend faux.

create or replace function app.can_write_card(card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_write_channel(c.channel_id) from public.cards c where c.id = card),
		false);
$$;

comment on function app.can_write_card(uuid) is
	'CRM-036 — docs/SPEC-permissions-rls.md §3.7. Droit d''ÉCRITURE effectif sur une card, dérivé '
	'de son channel. Destinée aux tables FILLES : les politiques de `cards` elles-mêmes jugent sur '
	'`channel_id` (décision 110).';

revoke all on function app.can_write_card(uuid) from public;
grant execute on function app.can_write_card(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 8. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.card_field_values enable row level security;

-- --- 8.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 : « Lecture de la card ». `app.can_read_card` existe depuis
-- `CRM-040` et son commentaire nomme `card_field_values` parmi ses appelants prévus : c'est ici
-- son PREMIER appelant réel.
--
-- Le défaut de la décision 107 ne se reproduit pas : la fonction lit `cards`, une AUTRE table,
-- déjà écrite. Il se reproduirait si la politique relisait `card_field_values`, ce qu'elle ne fait
-- pas.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège.

drop policy if exists card_field_values_lecture on public.card_field_values;
create policy card_field_values_lecture
	on public.card_field_values
	for select
	to anon, authenticated
	using (app.can_read_card(card_id));

comment on policy card_field_values_lecture on public.card_field_values is
	'CRM-036 — docs/SPEC-form-composer.md §6.9. Lecture par droit effectif sur la card, droits fins '
	'appliqués : un `channel_members.access = ''none''` masque les valeurs comme il masque la card.';

-- --- 8.2 Insertion ----------------------------------------------------------------------------

drop policy if exists card_field_values_insertion on public.card_field_values;
create policy card_field_values_insertion
	on public.card_field_values
	for insert
	to authenticated
	with check (app.can_write_card(card_id));

comment on policy card_field_values_insertion on public.card_field_values is
	'CRM-036 — docs/SPEC-form-composer.md §6.9. Écriture réservée à qui a le droit d''ÉCRITURE sur '
	'le channel de la card : un `viewer` de workspace est refusé, un droit fin `member` le rouvre.';

-- --- 8.3 Mise à jour --------------------------------------------------------------------------
-- Le `WITH CHECK` juge la ligne d'arrivée : sans lui, un appelant ayant le droit d'écriture sur la
-- card A pourrait déplacer une valeur **vers** la card B. MESURÉ par `CRM-040` : PostgreSQL
-- réutilise le `USING` quand le `WITH CHECK` manque, donc l'omettre ne rouvrirait rien — la clause
-- est écrite pour que la règle soit lisible sans connaître ce détail du moteur.

drop policy if exists card_field_values_maj on public.card_field_values;
create policy card_field_values_maj
	on public.card_field_values
	for update
	to authenticated
	using      (app.can_write_card(card_id))
	with check (app.can_write_card(card_id));

comment on policy card_field_values_maj on public.card_field_values is
	'CRM-036 — docs/SPEC-form-composer.md §6.9. `USING` juge la ligne avant modification, '
	'`WITH CHECK` après. Le second est redondant — mesuré — et écrit quand même.';

-- --- 8.4 Aucune politique `for delete` --------------------------------------------------------
-- docs/SPEC-form-composer.md §6.9 : vider un champ, c'est écrire `'null'::jsonb`. La suppression
-- n'est exposée à personne. Le refus est DOUBLE — aucun privilège `DELETE` en section 8.5, aucune
-- politique ici —, comme pour `form_fields` (décision 96) : la dégradation du harnais accorde le
-- privilège pour constater que la politique tient encore la seconde barrière. Sans les deux, on ne
-- saurait pas lequel des deux mécanismes refuse.

-- --- 8.5 Privilèges ---------------------------------------------------------------------------
-- Les privilèges de table sont un cran AU-DESSUS des politiques : sans `SELECT`, une lecture rend
-- une erreur de privilège là où le comportement exigé est zéro ligne (§7).
--
-- UN DÉFAUT RÉEL, TROUVÉ PAR LA SUITE pgTAP DE CETTE UNITÉ ET CORRIGÉ DANS LE MÊME CHANGEMENT —
-- décision 134. Ce bloc n'a d'abord porté que les trois `grant` ci-dessous, sans `revoke`.
-- MESURÉ : `anon` ET `authenticated` détenaient alors `DELETE`, `INSERT`, `UPDATE`, `TRUNCATE`,
-- `REFERENCES` et `TRIGGER` sur la table neuve. L'image Supabase pose un
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout, nommément, à ces trois rôles sur
-- toute table nouvelle — c'est la décision 80 sur les FONCTIONS, dont personne n'avait tiré la
-- conséquence pour les TABLES.
--
-- Conséquence exacte : le « refus DOUBLE » que le §8.4 annonce n'existait pas. Aucun privilège ne
-- manquait, et seule la politique RLS refusait la suppression — donc un seul mécanisme, là où le
-- commentaire en promettait deux. Le `revoke all` est ce qui rend cette promesse vraie. Il est
-- écrit AVANT les `grant`, de sorte qu'un rejeu de la migration RÉPARE un privilège relâché à la
-- main plutôt que de le laisser en l'état (décision 57).

revoke all on public.card_field_values from anon, authenticated;

grant select                 on public.card_field_values to anon;
grant select, insert, update on public.card_field_values to authenticated;
grant all privileges         on public.card_field_values to service_role;

-- =============================================================================================
-- 9. `public.move_card`, redéfinie avec sa SIXIÈME vérification — décisions 123, 126 à 129
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §5.3 et §5.7, docs/SPEC-form-composer.md §6.7.
--
-- La migration 12 pose la version à cinq vérifications ; celle-ci la remplace. Le
-- `migrations-runner` rejouant le répertoire EN ORDRE, la définition qui subsiste est celle-ci.
-- La dépendance est inscrite dans `docs/PROD_MIGRATIONS.md` §3.
--
-- Les cinq premières vérifications sont **inchangées, à la lettre** : les rouvrir dans un passage
-- consacré à la sixième mêlerait deux sujets et rendrait le diff illisible.

-- Adaptateur strictement transitoire de rejeu : sur une ancienne base à mettre à niveau, la source
-- peut encore être le tableau `workflow_transitions.require_fields`; sur une base neuve, ni cette
-- colonne ni la relation de CRM-018 n'existent encore à ce point de l'ordre. Sur une base déjà
-- migrée, seule la relation existe. CRM-018 remplace ensuite `move_card` par sa définition
-- canonique et supprime cet adaptateur ; il ne subsiste donc jamais dans le schéma final.
create or replace function app.workflow_transition_required_field_ids(target_transition_id uuid)
returns uuid[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_required_field_ids uuid[];
begin
	if pg_catalog.to_regclass('public.workflow_transition_required_fields') is not null then
		execute $query$
			select coalesce(array_agg(required.field_id order by required.field_id), '{}'::uuid[])
			  from public.workflow_transition_required_fields required
			 where required.transition_id = $1
		$query$
		into v_required_field_ids
		using target_transition_id;
	elsif exists (
		select 1
		  from pg_catalog.pg_attribute attribute
		 where attribute.attrelid = 'public.workflow_transitions'::pg_catalog.regclass
		   and attribute.attname = 'require_fields'
		   and attribute.attnum > 0
		   and not attribute.attisdropped
	) then
		execute $query$
			select coalesce(t.require_fields, '{}'::uuid[])
			  from public.workflow_transitions t
			 where t.id = $1
		$query$
		into v_required_field_ids
		using target_transition_id;
	else
		v_required_field_ids := '{}'::uuid[];
	end if;

	return coalesce(v_required_field_ids, '{}'::uuid[]);
end;
$$;

alter function app.workflow_transition_required_field_ids(uuid) owner to postgres;
revoke all on function app.workflow_transition_required_field_ids(uuid)
	from public, anon, authenticated, service_role;

drop function if exists public.move_card(uuid, uuid, text);

create function public.move_card(
	card_id    uuid,
	to_step_id uuid,
	comment    text default null
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card_id uuid := card_id;
	v_cible   uuid := to_step_id;
	v_comment text := nullif(btrim(comment), '');
	v_card    public.cards%rowtype;
	v_transition public.workflow_transitions%rowtype;
	v_manquants text[];
begin
	-- --- 9.1 La card existe, est visible de l'appelant, et elle est **active** -----------------
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- --- 9.2 L'appelant a le droit d'écriture sur le channel de la card ------------------------
	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 9.3 L'étape cible existe et appartient au workflow de la card -------------------------
	if not exists (
		select 1
		  from public.workflow_steps s
		 where s.id = v_cible
		   and s.workflow_id = v_card.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- --- 9.4 Une transition est déclarée de l'étape courante vers la cible ---------------------
	select t.* into v_transition
	  from public.workflow_transitions t
	 where t.workflow_id  = v_card.workflow_id
	   and t.from_step_id = v_card.current_step_id
	   and t.to_step_id   = v_cible;

	if not found then
		raise exception 'transition_not_allowed';
	end if;

	-- --- 9.5 Le commentaire est fourni si la transition l'exige --------------------------------
	if v_transition.require_comment and v_comment is null then
		raise exception 'comment_required';
	end if;

	-- --- 9.6 LES CHAMPS REQUIS DE L'ÉTAPE CIBLE SONT RENSEIGNÉS --------------------------------
	-- docs/SPEC-form-composer.md §6.7. `CRM-034` avait livré cinq vérifications sur six ; la
	-- sixième attendait `card_field_values`, livrée par la section 2 de cette migration. INC-047
	-- est close (décision 123).
	--
	-- ELLE VIENT EN DERNIER, et ce n'est pas un détail d'écriture : une card invisible ne doit pas
	-- apprendre par un refus quels champs son workflow exige. La discrétion du §5.3 prime.
	--
	-- L'ENSEMBLE EXIGÉ est l'union du §3.5 :
	--   1. les champs portant une règle `required` sur l'ÉTAPE CIBLE ;
	--   2. les champs exigés par la TRANSITION empruntée. L'adaptateur ci-dessus lit le tableau
	--      historique à froid et la table de liaison lors d'un rejeu sur le schéma final.
	--
	-- CE QUI N'EN FAIT PAS PARTIE, et chaque exclusion est une décision :
	--   * un champ SANS RÈGLE à l'étape cible. Le défaut du §3.1 est `visible`, non `required` ;
	--   * un champ `hidden` à l'étape cible par la règle de cette étape — `hidden` n'est pas
	--     `required`, et la Definition of Done le nomme ;
	--   * un champ ARCHIVÉ, quelle que soit sa règle et quelle que soit l'exigence de transition
	--     (décision 129) : exiger un champ qu'aucun formulaire n'affiche rendrait la transition
	--     impossible à satisfaire depuis le produit ;
	--   * dans l'état historique seulement, un identifiant de tableau que la jointure ne résout pas
	--     (décision 128). La migration 19 refuse ensuite explicitement cet état avant de créer la
	--     liaison : aucun identifiant mort ne peut subsister dans le schéma final.
	--
	-- EN REVANCHE, un champ `hidden` à l'étape cible ET lié à la transition EST exigé : le
	-- §3.5 dit « indépendamment de l'étape cible », et une arête déclarée par un administrateur est
	-- un geste explicite là où l'absence de règle est un défaut.
	--
	-- `app.valeur_de_champ_est_vide` est la SEULE définition de « renseigné » du produit
	-- (décision 127) : une ligne présente portant `'null'::jsonb` n'est pas une valeur.
	select array_agg(f.key order by f.position, f.key)
	  into v_manquants
	  from public.form_fields f
	 where f.workflow_id = v_card.workflow_id
	   and f.archived_at is null
	   and (
	       exists (
	           select 1
	             from public.form_field_rules r
	            where r.field_id = f.id
	              and r.step_id  = v_cible
	              and r.visibility = 'required'
	       )
	       or f.id = any (app.workflow_transition_required_field_ids(v_transition.id))
	   )
	   and not exists (
	       select 1
	         from public.card_field_values v
	        where v.card_id  = v_card_id
	          and v.field_id = f.id
	          and not app.valeur_de_champ_est_vide(v.value)
	   );

	if v_manquants is not null and array_length(v_manquants, 1) > 0 then
		-- LA LISTE VOYAGE DANS LE `DETAIL`, PAS DANS LE MESSAGE — décision 126, MESURÉ. Le message
		-- reste un jeton stable comparable par égalité, comme les cinq refus précédents ; PostgREST
		-- expose le `DETAIL` dans la clé `details` de sa réponse JSON.
		raise exception 'missing_required_fields'
			using detail = array_to_string(v_manquants, ', ');
	end if;

	-- --- 9.7 L'écriture -------------------------------------------------------------------------
	update public.cards c
	   set current_step_id = v_cible,
	       entered_step_at = now(),
	       position        = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.cards autre
	            where autre.channel_id      = v_card.channel_id
	              and autre.current_step_id = v_cible
	       )
	 where c.id = v_card_id
	returning c.* into v_card;

	return v_card;
end;
$$;

alter function public.move_card(uuid, uuid, text) owner to postgres;

comment on function public.move_card(uuid, uuid, text) is
	'CRM-034, étendue par CRM-036 — docs/SPEC-workflow-engine.md §5. Seul chemin par lequel une '
	'card change d''étape. SIX vérifications sur six depuis CRM-036 : card_not_found, forbidden, '
	'step_not_in_workflow, transition_not_allowed, comment_required, missing_required_fields — ce '
	'dernier portant la liste des clés manquantes dans son DETAIL (décision 126). Le commentaire '
	'fourni n''est toujours conservé nulle part (INC-048, CRM-043).';

revoke all on function public.move_card(uuid, uuid, text) from public, anon;
grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;

-- =============================================================================================
-- 10. Retrait de l'échafaudage
-- =============================================================================================

drop function if exists app.migration_0013_converger_contrainte(text, text, text);
