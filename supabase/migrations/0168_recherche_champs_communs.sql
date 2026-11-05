-- @spec CRM-112 (docs/BACKLOG.md) — tranche T6 : la recherche globale par les champs de l'affaire — `value_tsv` posée par
--       la base et indexée, recalculée quand les choix d'un champ changent ; la famille `affaire` de `recherche_globale`
--       trouve aussi par un champ actif, et l'extrait le nomme
-- @spec docs/SPEC-champs-communs.md §10 (précision T6, mesure du 2026-11-05) ; docs/SPEC-recherche.md §6.5 ;
--       docs/SCHEMA.md « Migration `0168` » ; docs/JOURNAL.md décisions 844 et 848
--
-- `app.card_common_field_values_validate` et `public.recherche_globale` SONT REPRISES À L'IDENTIQUE DE LEUR DERNIÈRE
-- DÉFINITION (`0164` et `0150`), avec leurs seuls ajouts, marqués `CRM-112` T6. Aucune donnée ne change hors `value_tsv`.

alter table public.card_common_field_values add column if not exists value_tsv tsvector;
comment on column public.card_common_field_values.value_tsv is
	'CRM-112 T6 — le texte cherchable d''une valeur commune (texte, ou libellé des choix), posé par la base ; la recherche globale.';
create index if not exists card_common_field_values_value_tsv_idx on public.card_common_field_values using gin (value_tsv);

-- Le texte cherchable : les types texte tels quels, les choix par leur LIBELLÉ ; nul pour les autres types.
create or replace function app.card_common_value_tsv(p_type text, p_options jsonb, p_value jsonb)
returns tsvector
language sql
stable
set search_path = ''
as $$
	select case
		when p_value is null or p_value = 'null'::jsonb then null
		when p_type in ('text', 'textarea', 'email', 'phone', 'url') and jsonb_typeof(p_value) = 'string'
			then to_tsvector('app.francais_sans_accent', p_value #>> '{}')
		when p_type in ('select', 'multiselect')
			then to_tsvector('app.francais_sans_accent', coalesce(app.card_common_field_texte(p_type, p_options, p_value), ''))
		else null
	end;
$$;
alter function app.card_common_value_tsv(text, jsonb, jsonb) owner to postgres;
revoke all on function app.card_common_value_tsv(text, jsonb, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.card_common_field_values_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_champ public.card_common_fields%rowtype;
begin
	-- Un `field_id` inconnu ou d'un autre espace : le déclencheur passe avant la clé étrangère, le refus est nommé ici.
	select f.* into v_champ from public.card_common_fields f where f.id = new.field_id and f.workspace_id = new.workspace_id;
	-- `CRM-112` T6 : le recalcul de `value_tsv` après un changement de choix (`app.card_common_fields_recompute_tsv`) ne
	-- revalide pas la valeur — retirer un choix encore employé reste permis — et ne la date pas : elle n'a pas changé.
	if tg_op = 'UPDATE' and current_setting('app.common_value_tsv_recompute', true) = 'on' then
		new.value_tsv := app.card_common_value_tsv(v_champ.type, v_champ.options, new.value);
		return new;
	end if;
	if not found then
		raise exception 'invalid_field_value' using detail = format('champ commun %s introuvable', new.field_id);
	end if;
	perform app.validate_field_value(v_champ.type, v_champ.options, v_champ.key, new.value, new.workspace_id);
	-- `CRM-112` T4.b : les colonnes de recherche, toujours recalculées — l'appelant ne les écrit pas.
	select c.value_search, c.value_date, c.value_timestamp
	  into new.value_search, new.value_date, new.value_timestamp
	  from app.card_common_value_columns(v_champ.type, new.value) c;
	-- `CRM-112` T6 : le texte cherchable, toujours recalculé — l'appelant ne l'écrit pas.
	new.value_tsv := app.card_common_value_tsv(v_champ.type, v_champ.options, new.value);
	new.updated_by := coalesce((select auth.uid()), new.updated_by);
	if tg_op = 'UPDATE' then
		new.created_at := old.created_at;
		new.updated_at := now();
	end if;
	return new;
end;
$function$;

-- Les choix d'un champ changent : le texte cherchable de ses valeurs est recalculé (les libellés ont pu changer). Le
-- drapeau de transaction réduit le déclencheur de validation à ce seul calcul, le temps de cette mise à jour.
create or replace function app.card_common_fields_recompute_tsv()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.options is distinct from old.options and new.type in ('select', 'multiselect') then
		perform set_config('app.common_value_tsv_recompute', 'on', true);
		update public.card_common_field_values v
		   set value_tsv = null
		 where v.field_id = new.id;
		perform set_config('app.common_value_tsv_recompute', '', true);
	end if;
	return null;
end;
$$;
alter function app.card_common_fields_recompute_tsv() owner to postgres;
revoke all on function app.card_common_fields_recompute_tsv() from public, anon, authenticated;
drop trigger if exists card_common_fields_recompute_tsv on public.card_common_fields;
create trigger card_common_fields_recompute_tsv
	after update of options on public.card_common_fields
	for each row execute function app.card_common_fields_recompute_tsv();

-- La reprise de l'existant, sans passer par le déclencheur de validation (il toucherait `updated_at`).
alter table public.card_common_field_values disable trigger card_common_field_values_validate;
update public.card_common_field_values v
   set value_tsv = (select app.card_common_value_tsv(f.type, f.options, v.value) from public.card_common_fields f where f.id = v.field_id);
alter table public.card_common_field_values enable trigger card_common_field_values_validate;

CREATE OR REPLACE FUNCTION public.recherche_globale(p_terme text, p_limite integer DEFAULT 20)
 RETURNS TABLE(objet text, id uuid, workspace_id uuid, titre text, sous_titre text, extrait text, rang real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_mots    text;
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
		return;
	end if;

	-- Ligne *f* du §6.7 : terme fait UNIQUEMENT de mots vides français (« le la de »).
	--
	-- Le contrôle passe par `to_tsvector` et NON par `to_tsquery`, et c'est mesuré (§2 M8) :
	-- `to_tsquery` émet un `NOTICE: text-search query contains only stop words` dès que sa
	-- requête ne porte aucun lexème. Ce n'est pas une erreur, mais ce serait une ligne de
	-- journal du serveur À CHAQUE FRAPPE d'une palette. `to_tsvector` emploie exactement les
	-- mêmes dictionnaires et n'émet rien.
	if to_tsvector('app.francais_sans_accent', p_terme) = ''::tsvector then
		return;
	end if;

	v_requete := to_tsquery('app.francais_sans_accent', v_mots);

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
