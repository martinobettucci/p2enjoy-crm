-- @spec CRM-060 tranche 3 (docs/BACKLOG.md) — résolution des champs `contact` et `user`
-- @spec docs/SPEC-contacts.md §9 (la règle, la portée, les cas a à j, la limite nommée)
-- @spec docs/SPEC-form-composer.md §6.4 (le trigger), §6.5 (ce que chaque type accepte)
-- @spec docs/JOURNAL.md décision 295 (l'arbitrage du responsable), INC-053 (close ici)
-- @spec docs/SCHEMA.md §4 (card_field_values) ; docs/SCHEMA.md §6 (contacts)
--
-- CETTE MIGRATION CLÔT INC-053, ouverte depuis le 2026-08-08.
--
-- Ce que le produit faisait jusqu'ici, MESURÉ le 2026-08-18 en transaction roulée en arrière sur
-- la base seedée (PostgreSQL 17.6) :
--
--   insert into public.card_field_values (…, value)
--   values (…, '"00000000-0000-4000-8000-000000000000"');   -- champ de type `contact`
--   => INSERT 0 1                                            -- ACCEPTÉ ; idem pour `user`
--
-- Un identifiant bien formé mais ne désignant RIEN était accepté. C'est exactement la « dette de
-- données impossible à distinguer d'une référence valide » que la décision 295 refuse.
--
-- Aucune colonne, aucune table, aucun privilège ne bouge : cette migration REDÉFINIT une seule
-- fonction, `app.card_field_values_valider()`, et son trigger. Le `create or replace` préserve
-- l'ACL ; les révocations et le trigger sont néanmoins ré-affirmés, comme dans 0013, pour qu'un
-- rejeu isolé de CE fichier laisse la base dans le même état qu'un rejeu de la série entière.
--
-- IDEMPOTENCE : `create or replace function` et `drop trigger if exists` puis `create trigger`.
-- Un second passage ne change rien.

-- =============================================================================================
-- 1. La validation par type, avec la RÉSOLUTION des deux types qui désignent un objet
-- =============================================================================================
-- Le corps ci-dessous est celui de la migration 0013, section 5, à une seule différence près : le
-- bloc 5.6. Il est recopié EN ENTIER plutôt que rapiécé, parce qu'une fonction PL/pgSQL n'admet
-- pas de redéfinition partielle et qu'un lecteur doit voir en un seul endroit ce que la base
-- exécute réellement.

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
	-- La cible résolue des types `user` et `contact` — section 5.6. Déclarée ici plutôt que
	-- reconvertie deux fois : la conversion est le seul endroit qui peut échouer, et elle doit
	-- échouer AVANT la recherche.
	v_cible  uuid;
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
		-- LA PORTÉE EST `new.workspace_id`, le workspace de la VALEUR — non celui de la cible.
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
				v_cible := (new.value #>> '{}')::uuid;
			exception when others then
				raise exception 'invalid_field_value'
					using detail = format('%s attend un identifiant', v_champ.key);
			end;

			if v_champ.type = 'contact' then
				if not exists (
					select 1
					  from public.contacts c
					 where c.id = v_cible
					   and c.workspace_id = new.workspace_id
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
					   and m.workspace_id = new.workspace_id
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

	new.updated_at := now();
	return new;
end;
$$;
comment on function app.card_field_values_valider() is
	'CRM-036 + CRM-060 tranche 3 — docs/SPEC-form-composer.md §6.4, §6.5, docs/SPEC-contacts.md '
	'§9. Trigger BEFORE INSERT OR UPDATE : valide la FORME de `value` selon `form_fields.type`, et '
	'RÉSOUT la cible des types `user` (membre de `workspace_members`) et `contact` (ligne de '
	'`contacts`), dans le workspace de la valeur écrite. `SECURITY DEFINER` parce qu''il doit voir '
	'toutes les lignes, pas celles que la RLS de l''appelant montre. Refus : `invalid_field_value`, '
	'le DETAIL nommant la clé et la raison. INC-053 close par la décision 295.';

-- =============================================================================================
-- 2. Le trigger — ré-affirmé, non modifié
-- =============================================================================================
-- `create or replace function` suffit à changer le comportement : le trigger pointe la fonction
-- par son nom, non par une copie de son corps. Le `drop`/`create` ci-dessous ne sert donc qu'à
-- rendre CE fichier autonome — un harnais qui ne rejouerait que lui doit laisser une base
-- complète (décision 296).

drop trigger if exists card_field_values_valider on public.card_field_values;
create trigger card_field_values_valider
	before insert or update on public.card_field_values
	for each row execute function app.card_field_values_valider();

revoke all on function app.card_field_values_valider() from public;
