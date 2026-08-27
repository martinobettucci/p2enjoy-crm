-- @spec CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences
-- @spec docs/SPEC-notifications.md §43 (le modèle), §43.1 (une table, non une colonne de
--       profiles), §43.2 (les colonnes et la clé naturelle), §43.3 (aucun workspace_id),
--       §43.4 (l'absence de ligne vaut consentement), §44 (le filtrage est À LA LECTURE),
--       §45 (la lecture de la préférence et l'unique écriture de la règle), §46 (autorisations,
--       privilèges, et l'unique chemin d'écriture)
-- @spec docs/SPEC-permissions-rls.md §3.2, §7 ; docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3
--
-- MESURÉ le 2026-08-27, avant cette migration (docs/SPEC-notifications.md §41) :
--
--   GET /rest/v1/profiles?select=id,locale                       (jeton de Driss)
--     => 200, LES TROIS profils, `locale` comprise                          (M7)
--
--   politique de notifications déléguant à une fonction de préférence, Driss ayant coupé :
--     GET /rest/v1/notifications                (jeton de Driss)  => 200 []  (M8)
--     ... avec count=exact                                        => */0
--     GET /rest/v1/notifications?recipient_id=eq.<Driss>  (service) => LA LIGNE EST LÀ
--
--   PATCH /rest/v1/notifications?id=eq.<sienne> {"read_at":…}     (jeton de Driss, coupé)
--     => 204, et `read_at` reste NULL — zéro ligne touchée                  (M9)
--     le même PATCH par Camille, NON coupée                       => 204 et une date
--
--   POST /rest/v1/<table> avec `Prefer: resolution=merge-duplicates`, la table n'accordant que
--   `insert (…)` et `update (in_app)` à `authenticated`
--     => 403  42501  permission denied for table                            (M10)
--     un second POST sans merge-duplicates                         => 409  23505
--
--   POST /rest/v1/rpc/<rpc security definer>, la table étant FERMÉE en écriture
--     => 200 deux fois de suite sur la même clé, un seul aller-retour       (M11)
--     l'anonyme                                                    => 401  42501
--
-- Ces cinq mesures décident respectivement : la table séparée (section 1), le filtrage à la
-- LECTURE (section 4), le comportement figé du marquage (docs, §44.1), et la RPC comme unique
-- chemin d'écriture (section 5).
--
-- CETTE MIGRATION NE REJUGE RIEN DES TRANCHES 1, 2 ET 3. Elle ajoute une CONDITION à la lecture
-- des notifications, sans toucher ni à la production, ni à l'éligibilité, ni au marquage.
-- `0061_mentions_commentaires.test.sql` et `0063_mentionnables.test.sql` doivent rester verts
-- SANS AUCUNE modification ; `0062_notifications.test.sql` aussi, le défaut étant « je reçois ».

-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout ce qui suit est donc
-- rejouable : `create table if not exists`, `create or replace function`, `drop policy if exists`
-- suivi de `create policy`, et des `revoke` / `grant` nominatifs.

-- =============================================================================================
-- 0. Convergence des contraintes — le mécanisme des migrations 0015, 0019, 0063 et 0064
-- =============================================================================================
-- `alter table … add constraint` rend 42710 sur une contrainte déjà posée, et `if not exists`
-- n'existe pas pour les contraintes.

create or replace function app.migration_0067_converger_contrainte(
	table_cible     text,
	nom_contrainte  text,
	definition      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	definition_actuelle text;
begin
	select pg_catalog.pg_get_constraintdef(c.oid)
	  into definition_actuelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = table_cible::regclass
	   and c.conname  = nom_contrainte;

	if definition_actuelle is not distinct from definition then
		return;
	end if;

	if definition_actuelle is not null then
		execute format('alter table %s drop constraint %I', table_cible, nom_contrainte);
	end if;

	execute format('alter table %s add constraint %I %s', table_cible, nom_contrainte, definition);
end;
$$;

alter function app.migration_0067_converger_contrainte(text, text, text) owner to postgres;

comment on function app.migration_0067_converger_contrainte(text, text, text) is
	'CRM-064 — outil de migration, rejouable. Pose la contrainte si elle manque, la remplace si '
	'sa définition diffère, ne fait rien si elle est déjà conforme.';

-- =============================================================================================
-- 1. `public.notification_preferences` — docs/SPEC-notifications.md §43
-- =============================================================================================
-- UNE TABLE, ET NON UNE COLONNE DE `profiles`, ET M7 LE DÉCIDE. Le réflexe est de poser un
-- booléen à côté de `profiles.locale`, qui est déjà une préférence personnelle. La politique
-- `profiles_lecture_equipe` ouvre la lecture de la ligne ENTIÈRE à tout membre du workspace, et
-- la mesure le confirme par la vraie route : Driss lit les trois profils. Une colonne posée là
-- publierait à toute l'équipe que quelqu'un a coupé ses notifications — ce n'est pas une donnée
-- d'équipe, c'est une décision personnelle, du même ordre que la boîte elle-même dont le §16.1
-- dit qu'elle n'est « pas une donnée d'exploitation ».
--
-- CLÉ PRIMAIRE `(profile_id, type)`, NATURELLE, ET C'EST L'INVERSE DE `notifications`. Le §13.2
-- donne une clé technique à la notification parce qu'un message A SA PROPRE EXISTENCE. Une
-- préférence n'en a aucune : elle EST le fait qu'une personne a décidé quelque chose au sujet
-- d'un type. Deux décisions de la même personne sur le même type ne sont pas deux préférences,
-- c'est la seconde qui vaut ; une clé technique autoriserait deux lignes contradictoires que rien
-- ne départagerait.
--
-- AUCUN `workspace_id` (§43.3). Une préférence est une décision sur SOI, non sur un contexte de
-- travail. Le coût est nommé plutôt que masqué : le jour où quelqu'un appartiendra à deux espaces
-- et voudra couper l'un sans l'autre, la table gagnera une colonne et sa clé primaire changera.
--
-- AUCUNE COLONNE `created_at` : la date qui compte est celle de la DERNIÈRE décision, et
-- `updated_at` la porte. Même écart assumé aux conventions de `docs/SCHEMA.md` que
-- `card_comments` et `card_comment_mentions` (INC-025), et il est nommé.

create table if not exists public.notification_preferences (
	profile_id  uuid        not null,
	type        text        not null,
	in_app      boolean     not null default true,
	updated_at  timestamptz not null default now(),
	constraint notification_preferences_pkey primary key (profile_id, type)
);

comment on table public.notification_preferences is
	'CRM-064 tranche 4 — docs/SPEC-notifications.md §43. Ce que chacun consent à recevoir. '
	'L''ABSENCE DE LIGNE VAUT CONSENTEMENT (§43.4) : le défaut est « je reçois », et il est posé '
	'par le `coalesce` de `app.notification_consentie`, jamais par une ligne fabriquée. Table '
	'SÉPARÉE de `profiles` parce que `profiles_lecture_equipe` ouvre la ligne entière à toute '
	'l''équipe (§43.1, M7) : une décision personnelle ne se publie pas.';

comment on column public.notification_preferences.type is
	'CRM-064 — la MÊME garde fermée qu''au §13.3 : `check (type in (''mention''))`. Elle empêche '
	'd''écrire un type inventé. Une tranche ultérieure qui ajouterait une source remplacerait la '
	'contrainte par `app.migration_00xx_converger_contrainte`.';

comment on column public.notification_preferences.in_app is
	'CRM-064 — recevoir, ou ne pas recevoir, EN APPLICATION. Il n''y a pas d''autre canal, et le '
	'§42.1 le mesure : aucun canal sortant n''existe (§13.1). Une colonne `channel` à une seule '
	'valeur ne garderait rien — l''argument du §13.3 ne vaut que pour `type`.';

comment on column public.notification_preferences.updated_at is
	'CRM-064 — POSÉE PAR LA BASE, jamais par le client. Mécanisme de la décision 95, déjà employé '
	'pour le `created_at` de la mention (§6) et le `read_at` de la notification (§15.1). Le '
	'trigger est la seconde barrière : il tient aussi pour la clé de service, qui contourne la '
	'RLS mais pas les triggers.';

select app.migration_0067_converger_contrainte(
	'public.notification_preferences',
	'notification_preferences_profile_id_fkey',
	'foreign key (profile_id) references public.profiles (id) on delete cascade'
);

-- LE `check` EST FERMÉ SUR `'mention'`, exactement comme celui de `public.notifications` (§13.3).
-- Écrire aujourd'hui `check (type in ('mention', 'assignation', 'echeance'))` pour des sources
-- qui n'existent pas serait l'anticipation que `CLAUDE.md` §1 interdit : la contrainte
-- autoriserait des préférences que rien ne produirait et qu'aucune preuve n'éprouverait.
-- LA DÉFINITION EST ÉCRITE SOUS SA FORME NORMALISÉE, et c'est ce que fait déjà la migration 0064
-- pour le `check` de `notifications`. Le moteur réécrit `type in ('mention')` en
-- `type = 'mention'::text` : la convergence comparerait alors deux textes différents et
-- DÉTRUIRAIT puis reposerait la contrainte À CHAQUE rejeu du répertoire, en prenant un verrou
-- `ACCESS EXCLUSIVE` sur la table pour ne rien changer. Écrite normalisée, elle converge au
-- premier passage et ne fait plus rien ensuite. La forme retenue est la MÊME que celle de
-- `notifications_type_check`, pour que les deux tables portent une garde identique.
select app.migration_0067_converger_contrainte(
	'public.notification_preferences',
	'notification_preferences_type_check',
	$$CHECK ((type = ANY (ARRAY['mention'::text])))$$
);

-- =============================================================================================
-- 2. La date de dernière décision est posée par la BASE — docs/SPEC-notifications.md §43.2
-- =============================================================================================
-- `SECURITY INVOKER` : le trigger ne lit ni n'écrit rien d'autre que la ligne qu'on lui passe.

create or replace function app.preferences_notifications_avant_ecriture()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

alter function app.preferences_notifications_avant_ecriture() owner to postgres;

comment on function app.preferences_notifications_avant_ecriture() is
	'CRM-064 — docs/SPEC-notifications.md §43.2. Impose `now()` à `updated_at`, en insertion '
	'comme en mise à jour. Le privilège de colonne refuse déjà le PATCH direct par 403 (M10) ; '
	'ce trigger est la SECONDE barrière, et la seule qui tienne pour la clé de service.';

drop trigger if exists preferences_notifications_avant_ecriture on public.notification_preferences;
create trigger preferences_notifications_avant_ecriture
	before insert or update on public.notification_preferences
	for each row execute function app.preferences_notifications_avant_ecriture();

-- =============================================================================================
-- 3. Autorisations et privilèges — docs/SPEC-notifications.md §46.1 et §46.2
-- =============================================================================================
-- LE `revoke` EST ÉCRIT AVANT LES `grant`, et c'est la décision 134, remesurée par M11 de cette
-- tranche : l'image Supabase pose un `alter default privileges in schema public` qui accorde
-- `arwdDxtm`, NOMMÉMENT, à `anon` et `authenticated` sur toute table neuve. Sans lui, il n'y
-- aurait ni refus d'insertion, ni refus de suppression, ni chemin d'écriture unique.

alter table public.notification_preferences enable row level security;

revoke all on public.notification_preferences from anon, authenticated;

-- `anon` REÇOIT `SELECT`, pour la raison du §3.2 de `docs/SPEC-permissions-rls.md` : sans le
-- privilège, un anonyme recevrait une ERREUR là où le comportement exigé est ZÉRO LIGNE.
-- `auth.uid()` étant nul, le prédicat de la politique est faux.
grant select         on public.notification_preferences to anon;
grant select         on public.notification_preferences to authenticated;
grant all privileges on public.notification_preferences to service_role;

-- AUCUN PRIVILÈGE D'ÉCRITURE, D'AUCUNE SORTE, et le refus est DOUBLE comme au §15.3 : ni
-- privilège, ni politique. Sans les deux, on ne saurait pas lequel refuse, et la dégradation du
-- harnais ne pourrait pas éprouver la seconde barrière en relâchant la première.
--
-- UNE SEULE POLITIQUE. L'absence des trois autres est figée par une assertion pgTAP qui les
-- compte et les nomme : sans cela, une politique ajoutée par mégarde passerait inaperçue.

drop policy if exists notification_preferences_lecture on public.notification_preferences;
create policy notification_preferences_lecture
	on public.notification_preferences
	for select
	to anon, authenticated
	using (profile_id = (select auth.uid()));

-- =============================================================================================
-- 4. LE FILTRAGE EST À LA LECTURE — docs/SPEC-notifications.md §44 et §45
-- =============================================================================================
-- Le §18, point 3, laissait la question ouverte : « à la production ou à la lecture — et les deux
-- ne se valent pas : la première perd l'information, la seconde la garde. » La réponse est À LA
-- LECTURE, pour quatre raisons dont trois sont mesurées :
--
--   1. LA PRODUCTION NE JUGE RIEN, et le §14.6 en fait une propriété. Lui faire lire une
--      préférence en ferait un juge SECURITY DEFINER qui décide en silence de ne pas écrire une
--      ligne — la forme la plus difficile à diagnostiquer : rien ne distingue « la préférence a
--      filtré » de « le trigger a échoué ».
--   2. UNE DÉCISION RÉVOCABLE NE DOIT PAS DÉTRUIRE. Couper puis rétablir doit rendre l'état
--      d'avant. M8 le mesure des deux côtés : liste vide, compteur nul, ET la ligne toujours en
--      base sous la clé de service.
--   3. LA RÈGLE N'A QU'UNE SEULE ÉCRITURE, ET ELLE COUVRE TROIS SURFACES. La liste, le compteur
--      et le TEMPS RÉEL lisent tous cette table sous cette politique ; le §16.3 établit que le
--      temps réel évalue la politique SELECT de chaque abonné. Filtrer dans l'écran aurait été la
--      seconde écriture en TypeScript que le §34.1 a déjà refusée pour le sélecteur.
--   4. LE COÛT EST NOMMÉ : les lignes d'une personne qui a coupé s'accumulent sans être lues.
--      C'est le point ouvert n° 1 — la rétention — rendu plus pressant, non résolu.
--
-- `SECURITY INVOKER`, ET C'EST L'ÉCART AVEC LE §14.1 COMME C'ÉTAIT CELUI DU §34.2. La fonction
-- est appelée depuis la politique de `notifications`, dont la première condition exige déjà
-- `recipient_id = auth.uid()` : la seule ligne de préférence qu'elle lit est donc celle de
-- l'appelant, que la politique de la section 3 lui ouvre. En DEFINER, elle deviendrait un ORACLE
-- — appelable directement avec n'importe quel `uuid`, elle dirait si un tiers a coupé ses
-- notifications. C'est la « refus de discrétion » que le §5.5 avait pesée, et ici rien ne
-- l'impose.
--
-- LE `coalesce` EST EXPLICITE, ET IL PORTE LE §43.4. Sans lui, la sous-requête rendrait NULL pour
-- une préférence absente, et `NULL and …` se comporte comme FAUX dans une politique : l'absence
-- de décision COUPERAIT TOUT, exactement l'inverse du défaut voulu. C'est le piège que le §16.1
-- avait déjà désamorcé pour `subject_card_id is null`.

create or replace function app.notification_consentie(p_destinataire uuid, p_type text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select coalesce(
		(select np.in_app
		   from public.notification_preferences np
		  where np.profile_id = p_destinataire
		    and np.type       = p_type),
		true);
$$;

alter function app.notification_consentie(uuid, text) owner to postgres;

comment on function app.notification_consentie(uuid, text) is
	'CRM-064 — docs/SPEC-notifications.md §45.1. Dit si un destinataire consent à recevoir un '
	'type. SECURITY INVOKER par DISCRÉTION : en DEFINER elle serait un oracle disant si un tiers '
	'a coupé ses notifications. Le `coalesce` est EXPLICITE : sans lui, une préférence absente '
	'rendrait NULL, qui se comporte comme faux dans une politique — l''absence de décision '
	'couperait tout, l''inverse du défaut du §43.4.';

-- LE PRIVILÈGE D'EXÉCUTION EST ACCORDÉ À `authenticated`, ET C'EST LA LEÇON DE LA DÉCISION 522 :
-- la politique s'évalue SOUS LE RÔLE DE L'APPELANT, et une fonction sans EXECUTE ferait rendre
-- `403 / 42501` là où le contrat attend des lignes — sans qu'aucune suite pgTAP, qui s'exécute
-- sous le propriétaire, ne le voie.
--
-- `anon` LE REÇOIT AUSSI, et ce n'est pas un relâchement : la politique le nomme dans ses rôles
-- (§16.1), donc le moteur évaluera le prédicat entier pour un appelant anonyme. Sans le
-- privilège, il obtiendrait `403 / 42501` là où le §15.2 exige ZÉRO LIGNE. La fonction ne lui
-- apprend rien : `auth.uid()` étant nul, la première condition de la politique est déjà fausse,
-- et la table qu'elle lit est fermée à `anon` par sa propre politique.
revoke all on function app.notification_consentie(uuid, text) from public;
grant execute on function app.notification_consentie(uuid, text) to anon, authenticated, service_role;

-- LA POLITIQUE DE LECTURE DE `notifications` GAGNE UNE TROISIÈME CONDITION — §45.2.
--
-- `notifications_marquage` (UPDATE) N'EST PAS TOUCHÉE, et le §44.1 dit pourquoi elle n'a pas
-- besoin de l'être : PostgREST écrit son UPDATE avec RETURNING, que la politique SELECT filtre —
-- M9 le mesure (204, et `read_at` reste NULL). L'y recopier serait une seconde écriture de la
-- même règle, sans effet observable.
drop policy if exists notifications_lecture on public.notifications;
create policy notifications_lecture
	on public.notifications
	for select
	to anon, authenticated
	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
		and app.notification_consentie(recipient_id, type)
	);

-- =============================================================================================
-- 5. L'UNIQUE CHEMIN D'ÉCRITURE — docs/SPEC-notifications.md §46.3
-- =============================================================================================
-- L'ÉCRITURE DIRECTE A ÉTÉ MESURÉE, ET SA FORME NATURELLE EST REFUSÉE. Une préférence est un
-- réglage qu'on pose sans savoir s'il existe déjà : l'upsert PostgREST est la forme évidente.
-- M10 mesure qu'elle rend 403 / 42501 dès lors que `authenticated` n'a que `insert (…)` et
-- `update (in_app)` — PostgREST exige l'UPDATE DE TABLE pour un `on conflict do update`. Il ne
-- restait alors que deux voies : ouvrir l'UPDATE de table, ce qui rendrait `profile_id`, `type`
-- et `updated_at` modifiables par le client ; ou écrire en deux appels, un PATCH puis un POST
-- s'il n'a touché aucune ligne — deux allers-retours et un 409 à interpréter comme un succès
-- conditionnel.
--
-- LA TROISIÈME VOIE EST LA BONNE, ET LE DÉPÔT LA PRATIQUE DÉJÀ : une RPC SECURITY DEFINER, seul
-- chemin d'écriture d'une table fermée. C'est la forme de `public.snooze_thread` et
-- `public.wake_thread` pour `mail_thread_snoozes` (`docs/SCHEMA.md` §7). M11 la mesure : 200 deux
-- fois de suite sur la même clé, en un seul aller-retour.
--
-- LE DESTINATAIRE N'EST PAS UN PARAMÈTRE, et c'est ce qui rend l'écriture d'autrui IMPOSSIBLE
-- plutôt que REFUSÉE. La fonction lit `auth.uid()` elle-même : aucun appelant ne peut désigner
-- quelqu'un d'autre, il n'y a pas de champ pour le dire. M10 mesure qu'une politique aurait
-- refusé un `profile_id` étranger par 403 / 42501 ; ne pas offrir le paramètre est la barrière
-- d'avant, celle qui ne dépend d'aucune politique.
--
-- ELLE REND LA LIGNE, jamais `void` : l'écran affiche l'état que la base a réellement retenu, et
-- non celui qu'il croyait envoyer (§5.45 du design system).

create or replace function public.definir_preference_notification(
	p_type   text,
	p_in_app boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_ligne    public.notification_preferences;
begin
	-- SANS SESSION, UN REFUS NOMMÉ. `auth.uid()` est nul pour l'anonyme, et AUSSI pour la clé de
	-- service, qui contourne la RLS mais n'a pas d'identité — et qui est le chemin du seed et des
	-- harnais. Écrire une ligne pour `null` serait refusé par la non-nullité, mais avec un
	-- message qui ne dit rien.
	if v_appelant is null then
		raise exception 'preference_sans_session'
			using errcode = 'P0001',
			      hint    = 'Cette RPC écrit la préférence de l''appelant : elle exige une session.';
	end if;

	-- UN TYPE INCONNU EST REFUSÉ NOMMÉMENT, ET LA CONTRAINTE RESTE. M10 et M11 mesurent que, sans
	-- ce refus, la cause vient du `check` avec 23514 et un message qui RECOPIE LA LIGNE FAUTIVE —
	-- illisible pour un écran. Le `check` de la section 1 n'est pas retiré pour autant : c'est le
	-- refus DOUBLE du §46.2, et c'est lui qui tient pour la clé de service.
	if p_type is null or p_type not in ('mention') then
		raise exception 'preference_type_inconnu'
			using errcode = 'P0001',
			      hint    = 'Le seul type de notification produit est « mention » (§13.3).';
	end if;

	if p_in_app is null then
		raise exception 'preference_valeur_absente'
			using errcode = 'P0001',
			      hint    = 'Une préférence vaut vrai ou faux ; l''absence de ligne vaut vrai (§43.4).';
	end if;

	-- IDEMPOTENTE PAR CONSTRUCTION. Poser deux fois la même décision rend deux fois la même ligne,
	-- et `updated_at` avance — ce qui est exact : c'est bien une seconde décision, au même sens
	-- que le §14.5 dit d'une mention reposée qu'elle est un second geste.
	insert into public.notification_preferences (profile_id, type, in_app)
	values (v_appelant, p_type, p_in_app)
	on conflict on constraint notification_preferences_pkey
		do update set in_app = excluded.in_app
	returning * into v_ligne;

	return v_ligne;
end;
$$;

alter function public.definir_preference_notification(text, boolean) owner to postgres;

comment on function public.definir_preference_notification(text, boolean) is
	'CRM-064 — docs/SPEC-notifications.md §46.3. UNIQUE chemin d''écriture d''une préférence, la '
	'table étant fermée en écriture aux deux rôles clients. SECURITY DEFINER par NÉCESSITÉ. Le '
	'DESTINATAIRE N''EST PAS UN PARAMÈTRE : la fonction lit `auth.uid()`, si bien qu''écrire pour '
	'autrui est IMPOSSIBLE plutôt que refusé. Idempotente, et elle rend la LIGNE RETENUE pour que '
	'l''écran affiche ce que la base porte et non ce qu''il croyait envoyer.';

-- `ANON` EST RÉVOQUÉ NOMMÉMENT, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE : c'est la leçon payée
-- par la migration `0053` (`CRM-062`) et redite par le §34.4. `pg_default_acl` porte
-- `alter default privileges in schema public … on functions to anon`, si bien que TOUTE fonction
-- neuve de `public` naît avec `anon=X` — et `revoke … from public` ne lui retire rien, `public`
-- étant le pseudo-rôle et `anon` un rôle NOMMÉ.
--
-- ET LA LEÇON DU §34.4 VA PLUS LOIN : `create or replace function` CONSERVE L'ACL EXISTANTE. Sur
-- une base où la fonction existe déjà, corriger une ACL fautive demande ce `revoke` explicite,
-- jamais un simple rejeu de la migration corrigée. C'est pourquoi il est écrit ici plutôt que
-- supposé acquis.
revoke all on function public.definir_preference_notification(text, boolean) from public, anon;
grant execute on function public.definir_preference_notification(text, boolean) to authenticated, service_role;

-- =============================================================================================
-- 6. La table n'est PAS publiée au temps réel — docs/SPEC-notifications.md §46.4
-- =============================================================================================
-- Même motif qu'aux §7.3 et §16.3, et il tient : rien ne s'y abonne. Une préférence change là où
-- on la change, et l'écran qui la change connaît déjà sa réponse — la RPC la lui rend. L'absence
-- est FIGÉE par une assertion pgTAP, la ligne de base étant `public.card_comments` et
-- `public.notifications`, et elles seules (M13).
--
-- Aucune ligne ici : ne rien faire EST la décision, et c'est l'assertion qui la garde.

-- =============================================================================================
-- 7. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une table et une fonction neuves restent INVISIBLES au cache jusqu'à son rechargement :
-- `/rest/v1/notification_preferences` rendrait `404 / PGRST205` — c'est exactement M3 — et
-- `rpc/definir_preference_notification` rendrait `404 / PGRST202` sur une pile déjà démarrée.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';
