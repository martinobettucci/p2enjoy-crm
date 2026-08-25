-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 2, sous-tranche 2a : LE RENDU
-- @spec docs/SPEC-modeles-emails.md §8.2 (pourquoi la substitution vit en base), §8.3 (contrat de
--       la fonction), §8.4 (ce qu'un trou dont la source est nulle rend), §8.5 (les sources ne se
--       devinent pas), §8.6 (formatage des valeurs non textuelles), §8.7 (autorisations)
-- @spec docs/SPEC-modeles-emails.md §2.4 (la liste fermée des douze variables et leur source)
-- @spec docs/SCHEMA.md §7 (`mail_templates`) ; docs/PROD_MIGRATIONS.md §3 (migration 56)
-- @spec docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
--
-- CETTE MIGRATION N'AJOUTE AUCUNE TABLE ET AUCUNE COLONNE, ET NE TOUCHE À RIEN D'EXISTANT.
--
-- Elle livre DEUX fonctions : une fonction privée de substitution, et la fonction publique qui
-- lit les sources et l'appelle. Aucune table, aucune politique, aucun privilège et aucun trigger
-- d'une autre unité n'est modifié. `mail_outbound_identities.signature_html` reste EXACTEMENT dans
-- l'état où `CRM-053` l'a laissée — morte et mal nommée (§6, INC-215) : la corriger est la
-- tranche 3, et le comportement est laissé inchangé (`CLAUDE.md` §18).
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LE RENDU DESCEND EN BASE (§8.2).
-- ---------------------------------------------------------------------------------------------
-- 1. La TRANCHE 4 fera écrire des emails par l'ORDONNANCEUR de `CRM-017`, qui n'a pas d'écran :
--    un rendu vivant dans la webapp serait hors de sa portée.
--
-- 2. La PRÉVISUALISATION de la sous-tranche 2b doit montrer EXACTEMENT ce qui partira. Deux
--    implémentations — une en TypeScript pour l'écran, une en SQL pour l'ordonnanceur —
--    divergeraient au premier ajustement, et l'écran mentirait alors sur le contenu de l'envoi.
--    C'est le raisonnement du §3 sur la liste des variables, transposé au rendu.
--
-- 3. Les valeurs viennent de tables SOUS RLS. Substituer côté client obligerait à rapatrier
--    l'affaire, son channel, son étape, son contact et l'identité, puis à refaire la jointure
--    d'étape — quatre lectures et une règle de plus dans l'écran, pour un résultat que la base
--    sait produire en une.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout est donc écrit pour être
-- rejouable : `create or replace function` et des `revoke` / `grant` nominatifs.

-- =============================================================================================
-- 1. `app.mail_template_substituer(texte, valeurs)` — la substitution, écrite une seule fois
-- =============================================================================================
-- docs/SPEC-modeles-emails.md §8.4.
--
-- Rend le texte dont chaque trou `{{nom}}` est remplacé par `valeurs ->> nom`, la CHAÎNE VIDE
-- lorsque cette valeur est nulle ou absente.
--
-- POURQUOI UNE DÉCOUPE ET UN ENTRELACEMENT, ET NON UNE SUITE DE `replace()`. Les blancs de bord
-- sont tolérés à l'intérieur des accolades (§2.3) : `{{ card.title }}` et `{{card.title}}`
-- désignent la même variable, et une suite de `replace()` littéraux devrait énumérer toutes les
-- graphies possibles — ce qu'aucune énumération finie ne fait. `regexp_replace` ne sait pas non
-- plus appeler une fonction par occurrence. La découpe sur le MÊME motif que celui du §4 —
-- `\{\{[^{}]*\}\}` — puis l'entrelacement des littéraux et des trous est exact, préserve l'ordre,
-- et n'emploie qu'une seule définition de ce qu'est un trou.
--
-- LE MOTIF EST CELUI DE `app.mail_template_variables_inconnues`, MOT POUR MOT, et ce n'est pas une
-- coïncidence : la fonction qui REFUSE à l'écriture et celle qui SUBSTITUE à la lecture doivent
-- découper le texte de la même façon, sans quoi un texte accepté porterait un trou que le rendu ne
-- verrait pas — ou l'inverse. Les faire diverger serait garantir qu'elles se contredisent.
--
-- `IMMUTABLE` : la fonction ne lit aucune table et ne dépend d'aucun réglage. Elle est appelée par
-- une fonction `STABLE`, qui ne peut pas appeler plus volatile qu'elle.

create or replace function app.mail_template_substituer(texte text, valeurs jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
	select coalesce(
		(
			select string_agg(morceau, '' order by rang, genre)
			from (
				-- Les littéraux : ce qui sépare les trous. `regexp_split_to_array` rend toujours
				-- au moins un élément, et un de plus qu'il n'y a de trous — y compris vide en
				-- tête ou en queue lorsque le texte commence ou finit par un trou.
				select ordinality * 2 as rang, 0 as genre, litteral as morceau
				  from unnest(regexp_split_to_array(coalesce(texte, ''), '\{\{[^{}]*\}\}'))
				       with ordinality as decoupe(litteral, ordinality)
				union all
				-- Les trous, dans l'ordre. Une valeur nulle ou absente rend la CHAÎNE VIDE : c'est
				-- la décision du §8.4, et elle n'est acceptable que parce que
				-- `public.rendre_modele_email` NOMME ces trous dans son troisième retour.
				select ordinality * 2 + 1 as rang, 1 as genre,
				       coalesce(valeurs ->> btrim(trou[1]), '') as morceau
				  from regexp_matches(coalesce(texte, ''), '\{\{([^{}]*)\}\}', 'g')
				       with ordinality as trous(trou, ordinality)
			) as morceaux
		),
		''
	);
$$;

alter function app.mail_template_substituer(text, jsonb) owner to postgres;

comment on function app.mail_template_substituer(text, jsonb) is
	'CRM-063 — docs/SPEC-modeles-emails.md §8.4. Remplace chaque trou {{nom}} du texte par la '
	'valeur du même nom, la chaîne vide lorsqu''elle est nulle ou absente. Même motif de trou que '
	'app.mail_template_variables_inconnues, pour que refus et rendu ne divergent jamais.';

-- --- 1.1 Privilèges ---------------------------------------------------------------------------
-- UN `revoke ... from public` NE SUFFIT PAS : `anon` conserverait son `EXECUTE`, posé par les
-- `alter default privileges` de la distribution. C'est le point de sûreté des migrations 48 à 55.
--
-- Cette fonction vit dans le schéma privé `app`, que PostgREST n'expose pas. Elle est attribuée
-- aux trois rôles clients comme ses deux voisines de la migration 55 : elle ne divulgue RIEN — elle
-- ne lit aucune table — et la fonction publique du §2 doit pouvoir l'appeler sous le rôle de
-- l'appelant, étant `SECURITY INVOKER`.

revoke all on function app.mail_template_substituer(text, jsonb) from public;
grant execute on function app.mail_template_substituer(text, jsonb)
	to anon, authenticated, service_role;

-- =============================================================================================
-- 2. `public.rendre_modele_email(...)` — le rendu — docs/SPEC-modeles-emails.md §8.3
-- =============================================================================================
-- `SECURITY INVOKER` et `STABLE`, exactement comme `public.cards_figees()` — mesuré :
-- `provolatile = 's'`, `prosecdef = f`. La RLS de `mail_templates`, `cards`, `channels`,
-- `contacts`, `organizations` et `mail_outbound_identities` s'applique TELLE QUELLE, et aucun
-- prédicat n'est recopié : les recopier créerait la duplication que la décision de `CRM-062` §9.2
-- combat, et ferait naître une seconde définition de « lisible ».
--
-- ZÉRO LIGNE lorsque le modèle ou l'affaire n'est pas lisible — jamais une erreur, jamais un
-- identifiant divulgué (`docs/SPEC-permissions-rls.md` §7). Un identifiant INCONNU et un
-- identifiant MASQUÉ rendent la même chose, et c'est la seule façon de ne rien révéler.
--
-- ---------------------------------------------------------------------------------------------
-- LES SOURCES NE SE DEVINENT PAS (§8.5), ET DEUX MESURES L'IMPOSENT.
-- ---------------------------------------------------------------------------------------------
-- * `p_contact_id` nul fait TROIS trous nommés. Le rendu ne choisit JAMAIS un contact parmi ceux
--   de l'affaire : MESURÉ, `card_contacts` admet plusieurs lignes par affaire, deux affaires
--   seulement du seed en portent une, et la plupart n'en portent aucune. Deviner reviendrait à
--   écrire au mauvais destinataire — la faute la moins rattrapable du sous-système.
--
-- * `p_identity_id` nul fait DEUX trous nommés. Prendre « l'identité par défaut » est IMPOSSIBLE,
--   et ce n'est pas une prudence mais une mesure : DEUX lignes du seed portent `is_default`, les
--   index uniques partiels `mail_outbound_identities_defaut_personne` et `..._defaut_service`
--   garantissant l'unicité par personne et pour le service, jamais pour le workspace.
--
-- * UN CONTACT NON RATTACHÉ À L'AFFAIRE EST ACCEPTÉ. La RLS garantit déjà que l'appelant LIT ce
--   contact ; exiger en plus le rattachement poserait une règle de produit que personne n'a prise,
--   et `CLAUDE.md` §10 refuse cela DANS LES DEUX SENS. La tranche 4 choisira son destinataire par
--   la séquence, et c'est là que la règle, si elle doit exister, sera prise.
--
-- ---------------------------------------------------------------------------------------------
-- LE FORMATAGE DES DEUX VALEURS NON TEXTUELLES (§8.6), MESURÉ.
-- ---------------------------------------------------------------------------------------------
-- * `card.amount` — `numeric` — rend `48000.00` : aucun séparateur de milliers, qui dépendrait
--   d'une locale que la base ne porte pas pour un workspace, et aucun symbole de devise, qui
--   doublerait `card.currency` — variable DISTINCTE que le rédacteur place où il veut.
--
-- * `card.next_action_at` — `timestamptz` — rend `16/08/2026 09:00`, EN UTC, ET C'EST UNE LIMITE
--   NOMMÉE. MESURÉ : aucune colonne de fuseau n'existe dans le schéma, la seule préférence étant
--   `profiles.locale`, qui est une LANGUE. UTC est donc le seul choix qui ne soit pas arbitraire,
--   et il est écrit ici plutôt que découvert par un destinataire à qui l'on donnerait rendez-vous
--   à la mauvaise heure. L'écart est consigné au registre (INC-216).

create or replace function public.rendre_modele_email(
	p_template_id uuid,
	p_card_id     uuid,
	p_contact_id  uuid default null,
	p_identity_id uuid default null
)
returns table (
	subject          text,
	body_text        text,
	variables_nulles text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
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
		       c.amount,
		       c.currency,
		       c.next_action,
		       c.next_action_at,
		       coalesce(ws.label_override, cat.label) as etape,
		       ch.name                                as channel
		  from public.cards c
		  join public.channels             ch  on ch.id  = c.channel_id
		  join public.workflow_steps       ws  on ws.id  = c.current_step_id
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
		) as carte
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
$$;

alter function public.rendre_modele_email(uuid, uuid, uuid, uuid) owner to postgres;

comment on function public.rendre_modele_email(uuid, uuid, uuid, uuid) is
	'CRM-063 — docs/SPEC-modeles-emails.md §8.3. Rend l''objet et le corps d''un modèle appliqués à '
	'une affaire, avec l''inventaire des trous dont la source est nulle. SECURITY INVOKER : la RLS '
	'décide de tout, et un objet non lisible rend ZÉRO LIGNE, jamais une erreur.';

-- --- 2.1 Privilèges ---------------------------------------------------------------------------
-- `authenticated` et `service_role`, JAMAIS `anon` — les privilèges mesurés de
-- `public.cards_figees()`, repris sans changement (§8.7). Un appelant anonyme ne lit AUCUNE
-- affaire : lui donner l'exécution ne lui rendrait que du vide, au prix d'une surface de plus.
--
-- Le refus de l'anonyme est donc un `401` de PRIVILÈGE, distinct du `200 []` de la lecture de
-- `mail_templates` (§2.7 ligne 1) : là-bas la politique est ouverte `to anon` et FILTRE ; ici la
-- fonction n'est pas exécutable. Les deux refus sont de nature différente, et la preuve les
-- distingue — comme le §2.7 distingue déjà le `401` du `403`.

revoke all on function public.rendre_modele_email(uuid, uuid, uuid, uuid)
	from public, anon;
grant execute on function public.rendre_modele_email(uuid, uuid, uuid, uuid)
	to authenticated, service_role;
