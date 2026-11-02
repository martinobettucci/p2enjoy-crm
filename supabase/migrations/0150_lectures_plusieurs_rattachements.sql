-- @spec CRM-111 (docs/BACKLOG.md) — tranche T4.1 : la recherche, le temps valorisé et la relance des affaires figées à
--       plusieurs rattachements
-- @spec docs/SPEC-rattachements.md §5 (un événement de rattachement désigne son rattachement), §6 (le temps valorisé,
--       `shared`, la saisie comptée une fois), §9 (la recherche nomme les rattachements lisibles) ;
--       docs/SPEC-recherche.md ; docs/SPEC-temps.md §6.2 ; docs/SPEC-relances.md §9.3, §9.4 ;
--       docs/SCHEMA.md « Migration `0150` » ; docs/PROD_MIGRATIONS.md ; docs/JOURNAL.md décision 814
--
-- QUATRE FONCTIONS, chacune réécrite depuis sa dernière autorité — la 109 pour les trois lectures, la 54 pour la
-- relance —, seules les lignes de rattachement changeant. `recherche_globale` garde son type de retour ;
-- `temps_valorise` gagne `shared`, ce qui impose de la supprimer puis de la recréer, ses droits avec elle ;
-- `rentabilite_affaires`, qui l'additionne par affaire, ne compte qu'une fois une saisie partagée ;
-- `app.relancer_cards_figees` inscrit son `stalled` sur LE rattachement figé, et non plus sur le plus ancien.

-- =============================================================================================
-- 1. La recherche — SPEC-rattachements §9
-- =============================================================================================

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
	with resultats as (

		-- 4.3.1 `affaire`
		select
			'affaire'::text                                          as objet,
			c.id                                                     as id,
			c.workspace_id                                           as workspace_id,
			c.title                                                  as titre,
			lu.channels                                              as sous_titre,
			null::text                                               as extrait,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(lu.actions, '')), 'B') ||
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
		 where c.deleted_at is null
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(lu.actions, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C')
		   ) @@ v_requete

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

-- =============================================================================================
-- 2. Le temps valorisé — SPEC-rattachements §6, SPEC-temps §6.2
-- =============================================================================================

-- `rentabilite_affaires` l'appelle depuis un corps plpgsql, qui ne crée aucune dépendance : la suppression passe sans
-- cascade, et la section 3 la réécrit dans la même transaction.
drop function if exists public.temps_valorise(date, date, uuid, uuid, uuid);

CREATE FUNCTION public.temps_valorise(p_debut date, p_fin date, p_profile uuid DEFAULT NULL::uuid, p_track uuid DEFAULT NULL::uuid, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(profile_id uuid, track_id uuid, channel_id uuid, card_id uuid, minutes bigint, montant numeric, devise text, shared boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with saisies as (
		select s.workspace_id, s.profile_id, s.jour, s.minutes, s.card_id,
		       coalesce(s.channel_id, ca.channel_id)         as channel_id,
		       coalesce(s.track_id, ch.track_id)             as track_id,
		       coalesce(ca.partagee, false)                  as shared
		  from public.saisies_temps s
		  -- `CRM-111` T4.1 (décision 814) : une saisie posée sur l'affaire paraît sous CHAQUE channel rattaché lisible —
		  -- une saisie n'a qu'une cible (`saisies_temps_cible_check`), et seule une saisie d'affaire en a plusieurs —, et
		  -- `shared` le dit quand il y en a plus d'un ; la RLS de `card_placements` ne rend que les lisibles.
		  left join lateral (select pl.channel_id, count(*) over () > 1 as partagee
		                       from public.card_placements pl where pl.card_id = s.card_id) ca on true
		  left join public.channels ch on ch.id = coalesce(s.channel_id, ca.channel_id)
		 where s.jour between p_debut and p_fin
		   and (p_profile is null or s.profile_id = p_profile)
		   and (p_card is null or s.card_id = p_card)
	)
	select sa.profile_id, sa.track_id, sa.channel_id, sa.card_id,
	       sum(sa.minutes)::bigint,
	       sum(round(sa.minutes * v.cout_quart / 105, 2)),
	       v.devise,
	       sa.shared
	  from saisies sa
	  left join lateral (
		select cp.cout_quart, cp.devise
		  from public.couts_personnel cp
		 where cp.workspace_id = sa.workspace_id
		   and cp.profile_id = sa.profile_id
		   and cp.date_effet <= sa.jour
		 order by cp.date_effet desc
		 limit 1) v on true
	 where p_track is null or sa.track_id = p_track
	 group by sa.profile_id, sa.track_id, sa.channel_id, sa.card_id, v.devise, sa.shared
	 order by sa.profile_id, sa.track_id, sa.channel_id nulls first, sa.card_id nulls first, v.devise;
$function$;

comment on function public.temps_valorise(date, date, uuid, uuid, uuid) is
	'CRM-098 et CRM-111 T4.1 — docs/SPEC-temps.md §6.2, docs/SPEC-rattachements.md §6. Temps (minutes) et coût valorisé '
	'par la version en vigueur le jour travaillé, par personne × cible × devise, sous la RLS de l''appelant ; montant '
	'null sans version lisible. Une saisie d''affaire paraît sous chaque channel rattaché lisible, `shared` vrai s''il y '
	'en a plusieurs : un total la compte une fois.';

revoke all on function public.temps_valorise(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.temps_valorise(date, date, uuid, uuid, uuid) to authenticated, service_role;

-- =============================================================================================
-- 3. La rentabilité, qui lit le temps valorisé — la saisie partagée comptée une fois
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.rentabilite_affaires(p_debut date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(workspace_id uuid, track_id uuid, channel_id uuid, card_id uuid, node_kind text, archivee boolean, currency text, recettes_prevues numeric, recettes_reelles numeric, lignes_recette integer, lignes_recette_sans_reel integer, couts_prevus numeric, couts_reels numeric, lignes_cout integer, lignes_cout_sans_reel integer, personnel numeric, minutes bigint, minutes_non_valorisees bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
	espace_carte uuid;
begin
	if not exists (select 1 from public.workspaces w where app.is_workspace_admin(w.id)) then
		raise exception 'rentabilite_reservee' using errcode = '42501',
			detail = 'La rentabilité soustrait le coût de toute l''équipe : elle est réservée aux administrateurs de l''espace.';
	end if;
	if p_card is not null then
		select c.workspace_id into espace_carte
		  from public.cards c where c.id = p_card and c.deleted_at is null;
		-- Une affaire qu'il ne lit pas rend zéro ligne ; une affaire qu'il lit sans administrer son espace est refusée.
		if espace_carte is not null and not app.is_workspace_admin(espace_carte) then
			raise exception 'rentabilite_reservee' using errcode = '42501',
				detail = 'La rentabilité soustrait le coût de toute l''équipe : elle est réservée aux administrateurs de l''espace.';
		end if;
	end if;

	return query
	with affaires as (
		select c.id, c.workspace_id, ch.track_id, pl.channel_id, n.kind, pl.archived_at is not null as archivee, c.currency
		  from public.cards c
		  join lateral (select pl.channel_id, pl.current_step_id, pl.archived_at from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
		  join public.channels ch on ch.id = pl.channel_id
		  join public.workflow_steps s on s.id = pl.current_step_id
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		 where c.deleted_at is null
		   and app.is_workspace_admin(c.workspace_id)
		   and (p_card is null or c.id = p_card)
	),
	recettes as (
		select r.card_id, a.currency,
		       sum(r.estimated_amount) as prevu,
		       count(*)::integer as lignes,
		       count(*) filter (where r.settled_at is null and r.actual_amount is null)::integer as sans_reel,
		       bool_or(r.settled_at is not null
		               and not exists (select 1 from public.card_revenue_actuals x where x.card_revenue_id = r.id)) as soldee_a_zero,
		       sum((select sum(x.amount) from public.card_revenue_actuals x
		             where x.card_revenue_id = r.id
		               and (p_debut is null or x.received_on >= p_debut)
		               and (p_fin is null or x.received_on <= p_fin))) as reel_periode
		  from public.card_revenues r
		  join affaires a on a.id = r.card_id
		 group by r.card_id, a.currency
	),
	couts as (
		select k.card_id, b.currency,
		       sum(k.estimated_cost) as prevu,
		       count(*)::integer as lignes,
		       count(*) filter (where k.settled_at is null and k.actual_cost is null)::integer as sans_reel,
		       bool_or(k.settled_at is not null
		               and not exists (select 1 from public.card_cost_actuals x where x.card_cost_id = k.id)) as soldee_a_zero,
		       sum((select sum(x.amount) from public.card_cost_actuals x
		             where x.card_cost_id = k.id
		               and (p_debut is null or x.spent_on >= p_debut)
		               and (p_fin is null or x.spent_on <= p_fin))) as reel_periode
		  from public.card_costs k
		  join affaires a on a.id = k.card_id
		  join public.budgets b on b.id = k.budget_id
		 group by k.card_id, b.currency
	),
	-- Le temps NON VALORISÉ (devise nulle) se range sous la devise de l'affaire : il n'a pas de montant, seulement des
	-- minutes, et une ligne de devise nulle laisserait l'écran sans tableau où ranger l'affaire (§5, précision de T2).
	temps as (
		select t.card_id, coalesce(t.devise, a.currency) as currency,
		       sum(t.montant) as montant,
		       sum(t.minutes)::bigint as minutes,
		       coalesce(sum(t.minutes) filter (where t.montant is null), 0)::bigint as non_valorisees
		  -- `CRM-111` T4.1 : une saisie partagée paraît sous chaque rattachement lisible ; l'affaire n'en compte qu'UNE ligne
		  -- par personne et devise (§6 : le temps de l'affaire est compté une fois). La ventilation par rattachement est T5.
		  from (select distinct on (tv.profile_id, tv.card_id, tv.devise) tv.*
		          from public.temps_valorise(coalesce(p_debut, '-infinity'::date), coalesce(p_fin, 'infinity'::date),
		                                     null, null, p_card) tv
		         order by tv.profile_id, tv.card_id, tv.devise, tv.channel_id) t
		  join affaires a on a.id = t.card_id
		 group by t.card_id, coalesce(t.devise, a.currency)
	),
	cles as (
		select x.card_id, x.currency from recettes x
		union select x.card_id, x.currency from couts x
		union select x.card_id, x.currency from temps x
	)
	select a.workspace_id, a.track_id, a.channel_id, a.id, a.kind, a.archivee, k.currency,
	       round(r.prevu, 2),
	       round(case when r.reel_periode is not null or r.soldee_a_zero then coalesce(r.reel_periode, 0) end, 2),
	       coalesce(r.lignes, 0),
	       coalesce(r.sans_reel, 0),
	       round(c.prevu, 2),
	       round(case when c.reel_periode is not null or c.soldee_a_zero then coalesce(c.reel_periode, 0) end, 2),
	       coalesce(c.lignes, 0),
	       coalesce(c.sans_reel, 0),
	       round(t.montant, 2),
	       coalesce(t.minutes, 0)::bigint,
	       coalesce(t.non_valorisees, 0)::bigint
	  from cles k
	  join affaires a on a.id = k.card_id
	  left join recettes r on r.card_id = k.card_id and r.currency is not distinct from k.currency
	  left join couts c    on c.card_id = k.card_id and c.currency is not distinct from k.currency
	  left join temps t    on t.card_id = k.card_id and t.currency is not distinct from k.currency
	 order by a.track_id, a.channel_id, a.id, k.currency nulls last;
end;
$function$;

-- =============================================================================================
-- 4. La relance des affaires figées — SPEC-rattachements §5, SPEC-relances §9.3 et §9.4
-- =============================================================================================
-- `public.cards_figees()` rend déjà une ligne par RATTACHEMENT figé. La relance de la 54 n'en gardait que l'affaire :
-- son `stalled` partait sans rattachement, et `app.card_events_fill_placement` le posait sur le plus ancien ; son
-- idempotence se lisait par affaire, si bien qu'un second rattachement figé après la relance du premier n'en recevait
-- aucune. Elle désigne désormais le rattachement — retrouvé par `(card_id, channel_id)`, unique — et l'idempotence s'y
-- ancre : au plus un `stalled` par entrée d'un rattachement dans son étape. Pour une affaire à un rattachement, rien ne
-- change : ses `stalled` passés portent déjà ce rattachement (remplissage de la 109).
--
-- `create or replace` garde le propriétaire et les droits posés par la 54 (aucun rôle client ne l'exécute).

create or replace function app.relancer_cards_figees()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_figee   record;
	v_ecrites integer := 0;
	v_job_id  bigint;
begin
	-- --- 1 Les rattachements à relancer -------------------------------------------------------
	-- `public.cards_figees()` est appelée, jamais recopiée (§9.2) : ses exclusions — rattachement archivé, affaire en
	-- corbeille, rattachement en sommeil — et l'absence de seuil sont héritées telles quelles.
	--
	-- L'IDEMPOTENCE EST ANCRÉE SUR L'ENTRÉE DU RATTACHEMENT DANS SON ÉTAPE (§9.4) : au plus un `stalled` par entrée.
	-- `created_at` est posé par `clock_timestamp()` (docs/SPEC-cards.md §14.3), donc postérieur à l'entrée qui l'a rendu
	-- possible : le rejeu du même jour n'écrit rien, et tout `move_card` réarme la relance de CE rattachement.
	for v_figee in
		select f.card_id, f.workspace_id, pl.id as placement_id, f.seuil_jours, f.retard_jours
		  from public.cards_figees() f
		  join public.card_placements pl on pl.card_id = f.card_id and pl.channel_id = f.channel_id
		 where not exists (
			select 1
			  from public.card_events e
			 where e.placement_id = pl.id
			   and e.type         = 'stalled'
			   and e.created_at  >= f.entered_step_at
		 )
	loop
		-- L'écriture de `app.card_event_ecrire`, le rattachement en plus : l'acteur est nul hors PostgREST, et le payload
		-- porte deux nombres et aucun libellé (§9.6, docs/SPEC-cards.md §14.6).
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (
			v_figee.card_id,
			v_figee.workspace_id,
			v_figee.placement_id,
			'stalled',
			(select p.id from public.profiles p where p.id = auth.uid()),
			jsonb_build_object('seuil_jours', v_figee.seuil_jours, 'retard_jours', v_figee.retard_jours));
		v_ecrites := v_ecrites + 1;
	end loop;

	-- --- 2 Promotion de la cadence d'amorçage vers la cadence nominale -------------------------
	-- Repris tel quel de la 54 (§9.7) : inscription et promotion dans la même transaction, et l'absence du job est une
	-- incohérence de la base, levée plutôt que tue.
	select jobid
	  into v_job_id
	  from cron.job
	 where jobname = 'p2enjoy-relances-cards-figees'
	   and username = 'postgres';

	if v_job_id is null then
		raise exception 'relances_job_absent';
	end if;

	perform cron.alter_job(v_job_id, schedule => '23 3 * * *', database => 'postgres', active => true);

	return v_ecrites;
end;
$$;

comment on function app.relancer_cards_figees() is
	'CRM-062 tranche 2 et CRM-111 T4.1 — docs/SPEC-relances.md §9.3, docs/SPEC-rattachements.md §5. Inscrit un '
	'événement `stalled` par ENTRÉE DANS L''ÉTAPE de chaque rattachement que `public.cards_figees()` rend au rôle '
	'd''exploitation, sur ce rattachement, puis ramène le job de son amorçage vers sa cadence quotidienne. Rend le nombre '
	'd''événements réellement inscrits. L''acteur est NUL hors PostgREST. Aucun libellé dans le payload.';
