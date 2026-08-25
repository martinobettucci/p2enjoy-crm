-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 1 : le modèle d'email
-- @spec docs/SPEC-modeles-emails.md §2 (la table), §2.2 (colonnes et bornes), §2.3 (pourquoi les
--       variables sont validées en base), §2.4 (la liste fermée des douze variables), §2.5 (ce que
--       la base refuse, ligne à ligne), §2.6 (autorisations), §3 (`app.modele_variables_connues`),
--       §4 (`app.modele_variables_inconnues`)
-- @spec docs/SCHEMA.md §7 (`mail_templates`)
-- @spec docs/SPEC-permissions-rls.md §3 (fonctions d'autorisation), §7 (le refus est zéro ligne)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 55)
--
-- CETTE MIGRATION CRÉE UNE TABLE ET DEUX FONCTIONS, ET NE TOUCHE À RIEN D'EXISTANT.
--
-- Aucune table, aucune politique, aucun privilège et aucun trigger d'une autre unité n'est
-- modifié. `mail_outbound_identities.signature_html` en particulier reste EXACTEMENT dans l'état
-- où `CRM-053` l'a laissée — morte et mal nommée (§6 de la spécification) : la corriger est la
-- tranche 3, et le comportement est laissé inchangé (`CLAUDE.md` §18).
--
-- ---------------------------------------------------------------------------------------------
-- LE NOM DE LA TABLE ET LA FORME DES VARIABLES NE SONT PAS INVENTÉS ICI.
-- ---------------------------------------------------------------------------------------------
-- `docs/SCHEMA.md` §7, « Autres tables de messagerie », nomme cette table `mail_templates` depuis
-- `CRM-000` et illustre ses variables par `{{card.title}}` et `{{contact.full_name}}`. La tranche 1
-- SUIT ce plan au lieu d'ouvrir une divergence : une variable est donc écrite `<objet>.<colonne>`,
-- et chaque nom du §2.4 désigne la colonne réelle dont il tire sa valeur.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LA VALIDATION DES VARIABLES DESCEND ICI (§2.3).
-- ---------------------------------------------------------------------------------------------
-- 1. Un modèle portant `{{card.titel}}` s'écrirait sans bruit, et le défaut n'apparaîtrait qu'au
--    moment de l'envoi — c'est-à-dire chez le destinataire.
--
-- 2. `CLAUDE.md` §10 : « valide » est une règle de produit, et une règle de produit s'applique là
--    où l'interface ne peut pas être contournée. Une validation vivant dans l'écran serait
--    contournée par le premier appel PostgREST.
--
-- 3. La tranche 4 fera écrire des emails par l'ORDONNANCEUR de `CRM-017`, qui n'a pas d'écran.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout est donc écrit pour être
-- rejouable : `create table if not exists`, `drop constraint if exists` avant `add constraint`,
-- `create or replace function`, `drop policy if exists` avant `create policy`.

-- =============================================================================================
-- 1. `app.mail_template_variables()` — la liste, écrite une seule fois
-- =============================================================================================
-- docs/SPEC-modeles-emails.md §2.4 et §3.
--
-- CHAQUE VARIABLE DÉSIGNE UNE COLONNE QUI EXISTE EN BASE AUJOURD'HUI, et la source de chacune est
-- écrite en regard. Aucune n'anticipe une colonne à venir : une variable dont la source n'existe
-- pas serait un trou qui ne se remplit jamais.
--
-- TROIS SOURCES ONT ÉTÉ CORRIGÉES PAR LA MESURE, et non par la lecture d'un document :
--   * `public.contacts` ne sépare NI prénom NI nom — elle porte `full_name`, et c'est d'ailleurs
--     la graphie que `docs/SCHEMA.md` §7 illustrait déjà ;
--   * `public.workflow_steps` ne porte AUCUNE colonne `label` (le `42703` que la décision 507
--     avait déjà relevé) : l'étape se lit `coalesce(label_override, catalogue.label)`, et la
--     variable est donc nommée `card.step` et non `card.step_label` ;
--   * `public.cards` porte `next_action_at` et non une colonne `due_date`.
--
-- `IMMUTABLE` EST EXIGÉ PAR LA CONTRAINTE qui l'appelle : une contrainte de vérification n'accepte
-- qu'une expression immuable. La conséquence est écrite plutôt que découverte — ajouter une
-- variable à cette liste NE REVALIDE PAS les lignes existantes, ce qui est sans danger dans ce
-- sens, la liste ne pouvant que s'élargir ; EN RETIRER UNE laisserait des lignes non conformes en
-- base, et la migration qui retirera devra porter sa propre reprise de données (§3).

create or replace function app.mail_template_variables()
returns text[]
language sql
immutable
set search_path = ''
as $$
	select array[
		'card.amount',           -- public.cards.amount                          (nul possible)
		'card.channel',          -- public.channels.name                         (jamais nul)
		'card.currency',         -- public.cards.currency                        (jamais nul)
		'card.next_action',      -- public.cards.next_action                     (nul possible)
		'card.next_action_at',   -- public.cards.next_action_at                  (nul possible)
		'card.step',             -- coalesce(steps.label_override, catalogue.label)
		'card.title',            -- public.cards.title                           (jamais nul)
		'contact.email',         -- public.contacts.email                        (nul possible)
		'contact.full_name',     -- public.contacts.full_name                    (jamais nul)
		'contact.organization',  -- public.organizations.name                    (nul possible)
		'identity.from_address', -- public.mail_outbound_identities.from_address (jamais nul)
		'identity.from_name'     -- public.mail_outbound_identities.from_name    (nul possible)
	]::text[];
$$;

alter function app.mail_template_variables() owner to postgres;

comment on function app.mail_template_variables() is
	'CRM-063 — docs/SPEC-modeles-emails.md §2.4, §3. Liste FERMÉE et triée des variables qu''un '
	'modèle d''email peut porter. Source unique : les contraintes l''appellent, la suite pgTAP la '
	'compare au §2.4, et la tranche 2 la lira pour proposer les variables à l''écran.';

-- =============================================================================================
-- 2. `app.mail_template_variables_inconnues(text)` — le refus
-- =============================================================================================
-- docs/SPEC-modeles-emails.md §4.
--
-- Rend le tableau TRIÉ ET DÉDOUBLONNÉ des variables du texte qui ne figurent pas dans la liste du
-- §1. Un texte sans variable rend `{}`. Un texte `null` rend `{}` — convention de PostgreSQL pour
-- une contrainte, qui ne refuse jamais sur `null` ; les colonnes concernées sont de toute façon
-- `not null`.
--
-- LE MOTIF INTERDIT LES ACCOLADES À L'INTÉRIEUR DU TROU, et c'est ce qui décide le cas `{{{x}}}` :
-- la sous-chaîne `{{{x}}` ne correspond pas, `{{x}}` correspond, et `x` est donc une variable
-- inconnue — le texte est refusé. C'est le comportement voulu : une accolade en trop est une faute
-- de frappe, pas une intention. MESURÉ, et figé par une assertion.
--
-- LES BLANCS DE BORD SONT TOLÉRÉS À L'INTÉRIEUR DES ACCOLADES : `{{ card.title }}` désigne la même
-- variable que `{{card.title}}` (§2.3). La casse, elle, N'EST PAS normalisée — décision du §2.5
-- point g : accepter `{{Card.Title}}` obligerait le rendu de la tranche 2 à décider ce que
-- `{{contact.EMAIL}}` rend, et rendrait la liste ambiguë.

create or replace function app.mail_template_variables_inconnues(texte text)
returns text[]
language sql
immutable
set search_path = ''
as $$
	select coalesce(
		(
			select array_agg(distinct v order by v)
			from (
				select btrim(m[1]) as v
				from regexp_matches(coalesce(texte, ''), '\{\{([^{}]*)\}\}', 'g') as m
			) as trous
			where not (v = any (app.mail_template_variables()))
		),
		array[]::text[]
	);
$$;

alter function app.mail_template_variables_inconnues(text) owner to postgres;

comment on function app.mail_template_variables_inconnues(text) is
	'CRM-063 — docs/SPEC-modeles-emails.md §4. Variables du texte absentes de la liste fermée, '
	'triées et dédoublonnées. Appelée par les deux contraintes de public.mail_templates.';

-- --- 2.1 Privilèges des deux fonctions --------------------------------------------------------
-- UN `revoke ... from public` NE SUFFIT PAS : `anon` conserverait son `EXECUTE`, posé par les
-- `alter default privileges` de la distribution. C'est le point de sûreté des migrations 48 à 54,
-- et la mesure de `CRM-062` l'a payé une fois — l'anonyme obtenait `200 []` là où le contrat
-- annonçait `401`.
--
-- Ces deux fonctions sont attribuées aux trois rôles clients comme les gardes de `CRM-082` : elles
-- ne divulguent RIEN — la liste des variables est publique par construction, elle est destinée au
-- manuel — et la contrainte doit pouvoir s'évaluer sous n'importe quel rôle écrivant.

revoke all on function app.mail_template_variables()                from public;
revoke all on function app.mail_template_variables_inconnues(text)  from public;

grant execute on function app.mail_template_variables()               to anon, authenticated, service_role;
grant execute on function app.mail_template_variables_inconnues(text) to anon, authenticated, service_role;

-- =============================================================================================
-- 3. `public.mail_templates` — le modèle d'email
-- =============================================================================================
-- docs/SCHEMA.md §7, docs/SPEC-modeles-emails.md §2.1 et §2.2.
--
-- LE MODÈLE APPARTIENT AU WORKSPACE, et jamais à un track, à un channel ou à une identité
-- sortante (§2.1). Un modèle « relance sans réponse » sert dans tous les dossiers ; le dupliquer
-- par channel serait la duplication que `CLAUDE.md` §4 proscrit. Le lier à une identité ferait
-- dépendre le TEXTE du compte SMTP qui l'expédie.
--
-- AUCUNE COLONNE `archived_at`, et c'est une décision (§2.2). Un modèle se SUPPRIME réellement,
-- comme un bloc d'objectif et contrairement à un track ou un channel : il ne contient aucun
-- travail, il est une chaîne de caractères. La tranche 4 posera la clé étrangère du palier de
-- séquence en `on delete restrict` — un modèle employé ne se supprimera plus, et le refus sera
-- nommé. La contrainte est écrite ici pour que la tranche 4 ne la découvre pas.

create table if not exists public.mail_templates (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	subject      text        not null,
	body_text    text        not null,
	-- Trace, JAMAIS un droit : même règle qu'à `docs/SPEC-goals.md` §4.2. Aucune politique ne lit
	-- cette colonne, et le §2.7 point 14 le fige par une assertion plutôt que de le taire.
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 3.1 Contraintes de valeur, posées de façon convergente -----------------------------------
--
-- LES BORNES SONT MESURÉES, PAS CHOISIES AU HASARD (§2.2). 300 pour l'objet : la ligne `Subject`
-- de RFC 5322 est repliée au-delà de 78 octets et les clients tronquent bien avant 300 — au-delà,
-- on n'écrit plus un objet. 20 000 pour le corps : `mail_outbox.body_text` n'est pas borné, et une
-- borne haute ici évite qu'un copier-coller accidentel d'un fil entier devienne un modèle.
--
-- `app.btrim_blancs` est la normalisation du dépôt — elle retire les blancs de bord, y compris les
-- blancs Unicode invisibles de `CRM-035` —, et elle est `IMMUTABLE`, donc utilisable en contrainte
-- comme en index.

alter table public.mail_templates drop constraint if exists mail_templates_name_borne;
alter table public.mail_templates add  constraint mail_templates_name_borne
	check (char_length(app.btrim_blancs(name)) between 1 and 120);

alter table public.mail_templates drop constraint if exists mail_templates_subject_borne;
alter table public.mail_templates add  constraint mail_templates_subject_borne
	check (char_length(app.btrim_blancs(subject)) between 1 and 300);

alter table public.mail_templates drop constraint if exists mail_templates_body_borne;
alter table public.mail_templates add  constraint mail_templates_body_borne
	check (char_length(app.btrim_blancs(body_text)) between 1 and 20000);

-- Les deux contraintes qui portent la règle du §2.3. Elles sont NOMMÉES par colonne : le refus
-- doit dire LAQUELLE des deux porte le trou inconnu, sans quoi l'écran de la tranche 2 devrait
-- deviner où placer son message.
alter table public.mail_templates drop constraint if exists mail_templates_subject_variables;
alter table public.mail_templates add  constraint mail_templates_subject_variables
	check (cardinality(app.mail_template_variables_inconnues(subject)) = 0);

alter table public.mail_templates drop constraint if exists mail_templates_body_variables;
alter table public.mail_templates add  constraint mail_templates_body_variables
	check (cardinality(app.mail_template_variables_inconnues(body_text)) = 0);

comment on table public.mail_templates is
	'CRM-063 — docs/SCHEMA.md §7, docs/SPEC-modeles-emails.md §2. Modèle d''email d''un '
	'workspace : un texte réutilisable, nommé, à trous. La liste des trous est FERMÉE et le refus '
	'vit en base (§2.3).';
comment on column public.mail_templates.created_by is
	'Trace, jamais un droit : docs/SPEC-modeles-emails.md §2.7 point 14. Aucune politique ne la lit.';
comment on column public.mail_templates.subject is
	'Objet du message, 1 à 300 caractères normalisés. Peut porter les variables du §2.4.';
comment on column public.mail_templates.body_text is
	'Corps TEXTE — docs/SPEC-mail-subsystem.md §18 a tranché que rien n''est expédié en HTML.';

-- Unicité par workspace sur la forme NORMALISÉE (§2.2, §2.5 point i). Deux modèles nommés
-- « Relance » et « Relance » aux blancs près sont le même modèle pour qui les lit dans une liste.
drop index if exists mail_templates_workspace_name_key;
create unique index mail_templates_workspace_name_key
	on public.mail_templates (workspace_id, app.btrim_blancs(name));

create index if not exists mail_templates_workspace_idx
	on public.mail_templates (workspace_id, name);

drop trigger if exists mail_templates_set_updated_at on public.mail_templates;
create trigger mail_templates_set_updated_at
	before update on public.mail_templates
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 4. Row Level Security
-- =============================================================================================
-- docs/SPEC-modeles-emails.md §2.6. AUCUNE NOTION NOUVELLE : le patron est exactement celui de
-- `goal_boards` (`docs/SPEC-goals.md` §4.1), et la raison est la même — un modèle est un objet
-- éditorial collectif du workspace.
--
-- Refus par défaut : la RLS est activée et aucune politique n'est implicite.

alter table public.mail_templates enable row level security;

drop policy if exists mail_templates_lecture_membre on public.mail_templates;
create policy mail_templates_lecture_membre
	on public.mail_templates
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists mail_templates_insertion_membre_ecrivant on public.mail_templates;
create policy mail_templates_insertion_membre_ecrivant
	on public.mail_templates
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_templates_maj_membre_ecrivant on public.mail_templates;
create policy mail_templates_maj_membre_ecrivant
	on public.mail_templates
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('admin', 'business_developer'))
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_templates_suppression_membre_ecrivant on public.mail_templates;
create policy mail_templates_suppression_membre_ecrivant
	on public.mail_templates
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

-- =============================================================================================
-- 5. Privilèges de la table
-- =============================================================================================
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas
-- des `alter default privileges` de la distribution (§2.6). `anon` conserve `select` — et n'obtient
-- RIEN, aucune politique ne le laissant passer : `app.is_workspace_member` rend faux hors session.
-- C'est le patron des migrations 49 à 51, et il rend le refus de l'anonyme mesurable en `200 []`
-- sur la lecture — un filtrage, qui ne révèle pas que la table existe — et en `401` sur les
-- écritures, refusées par le PRIVILÈGE avant toute politique. Les deux ont été MESURÉS.

revoke all on public.mail_templates from anon, authenticated;
grant select                 on public.mail_templates to anon, authenticated;
grant insert, update, delete on public.mail_templates to authenticated;
grant all privileges         on public.mail_templates to service_role;
