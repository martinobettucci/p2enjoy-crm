-- @spec CRM-123 (docs/BACKLOG.md) — tranche T2 : le préfixe des adresses d'affaire se règle par espace, et une
--       régénération explicite l'applique aux affaires existantes
-- @spec docs/SPEC-cards.md §3.6 (points 1 à 8) ; docs/SCHEMA.md §5 ; docs/SPEC-plateforme.md §6.1, §6.2 ;
--       docs/SPEC-mail-subsystem.md §3 ; docs/JOURNAL.md décision 804
--
-- Le préfixe `c-` était une constante du trigger et de la contrainte de `0011`. Une messagerie qui ne délègue qu'un
-- motif d'alias (`app-*`) sur son domaine ne remettait donc rien au CRM. Le préfixe devient une colonne de l'espace ;
-- le jeton de huit caractères base32 Crockford reste celui des §3.2 et §3.3.
--
-- CE QUI NE CHANGE PAS : le classement (`app.card_par_adresse`) et le `Reply-To` (`claim_outbound`) composent l'adresse
-- STOCKÉE, sans reconnaître de motif (§3.6 point 8). Aucune de leurs définitions n'est donc reprise ici.
--
-- IDEMPOTENCE : `add column if not exists`, contraintes retirées puis reposées, fonctions retirées par leur signature
-- ancienne et recréées, trigger d'audit reposé.

-- =============================================================================================
-- 1. La colonne et sa forme — §3.6 points 1 et 2
-- =============================================================================================

alter table public.workspaces add column if not exists card_address_prefix text not null default 'c-';

alter table public.workspaces drop constraint if exists workspaces_card_address_prefix_check;
alter table public.workspaces add constraint workspaces_card_address_prefix_check
	check (card_address_prefix ~ '^[a-z0-9][a-z0-9._+-]{0,23}$' and pg_catalog.strpos(card_address_prefix, '..') = 0);

comment on column public.workspaces.card_address_prefix is
	'CRM-123 — docs/SPEC-cards.md §3.6. Préfixe des adresses d''affaire de l''espace, suivi du jeton de huit caractères '
	'base32 : il suit le motif d''alias du serveur de messagerie (`app-*`). Réglé par le superadministrateur seul.';

-- Normalise et contrôle un préfixe saisi : minuscules, blancs retirés, puis la forme de la contrainte. Le refus est un
-- CODE du dictionnaire de la plateforme (§6.1), non le texte d'une contrainte.
create or replace function app.card_address_prefix_normalize(p_prefix text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	prefixe text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_prefix, '')));
begin
	if prefixe !~ '^[a-z0-9][a-z0-9._+-]{0,23}$' or pg_catalog.strpos(prefixe, '..') > 0 then
		raise exception 'invalid_card_address_prefix' using errcode = '22023';
	end if;
	return prefixe;
end;
$$;

revoke all on function app.card_address_prefix_normalize(text) from public;

-- Une partie locale porte un préfixe lorsqu'elle est EXACTEMENT ce préfixe suivi du jeton de huit caractères : `c` ne
-- reconnaît pas `c-abcdefgh`, dont le préfixe est `c-`.
create or replace function app.card_address_has_prefix(p_local_part text, p_prefix text)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select pg_catalog.char_length(p_local_part) = pg_catalog.char_length(p_prefix) + 8
	   and pg_catalog.left(p_local_part, pg_catalog.char_length(p_prefix)) = p_prefix;
$$;

revoke all on function app.card_address_has_prefix(text, text) from public;

-- =============================================================================================
-- 2. Le tirage, factorisé — §3.6 point 3
-- =============================================================================================
--
-- Le tirage de `0011`, à l'identique, hormis la constante `'c-'` devenue le paramètre. La boucle ne garantit rien :
-- l'index unique `cards_email_local_part_key` le fait (§3.3, décision 112). `SECURITY DEFINER` : la vérification doit
-- voir TOUTES les cards, pas celles que la RLS de l'appelant lui montre.

create or replace function app.card_address_draw(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
	tirage   bigint;
	candidat text;
	i        integer;
	essai    integer := 0;
begin
	loop
		essai := essai + 1;

		tirage   := ('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40)::bigint;
		candidat := p_prefix;
		for i in 0..7 loop
			candidat := candidat || substr(alphabet, ((tirage >> (5 * (7 - i))) & 31)::int + 1, 1);
		end loop;

		exit when not exists (
			select 1 from public.cards c where c.email_local_part = candidat
		);

		if essai >= 10 then
			raise exception
				'email_local_part : dix tirages consécutifs déjà pris, ce qui est anormal sur un espace de 2^40'
				using errcode = 'unique_violation';
		end if;
	end loop;

	return candidat;
end;
$$;

comment on function app.card_address_draw(text) is
	'CRM-123 — docs/SPEC-cards.md §3.6 point 3. Tire une partie locale libre : le préfixe, puis huit caractères base32.';

revoke all on function app.card_address_draw(text) from public;

-- Le trigger de `0011` lit désormais le préfixe de l'espace de la nouvelle affaire. La valeur fournie par l'appelant
-- reste ignorée et remplacée (§3.4).
create or replace function app.cards_generer_email_local_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	new.email_local_part := app.card_address_draw(coalesce(
		(select w.card_address_prefix from public.workspaces w where w.id = new.workspace_id), 'c-'));
	return new;
end;
$$;

comment on function app.cards_generer_email_local_part() is
	'CRM-040 — docs/SPEC-cards.md §3, révisé par CRM-123 (§3.6) : trigger BEFORE INSERT, renseigne `email_local_part` '
	'au préfixe de l''espace, quelle que soit la valeur fournie. La boucle ne garantit rien — l''index unique le fait.';

-- =============================================================================================
-- 3. La contrainte de la card, élargie — §3.6 point 4
-- =============================================================================================

alter table public.cards drop constraint if exists cards_email_local_part_check;
alter table public.cards add constraint cards_email_local_part_check
	check (email_local_part ~ '^[a-z0-9][a-z0-9._+-]{0,23}[0-9abcdefghjkmnpqrstvwxyz]{8}$');

-- =============================================================================================
-- 4. Le journal de la plateforme reçoit un geste — §3.6 point 7
-- =============================================================================================

alter table public.plateforme_journal drop constraint if exists plateforme_journal_geste_check;
alter table public.plateforme_journal add constraint plateforme_journal_geste_check
	check (geste in ('superadmin_amorce', 'superadmin_accorde', 'superadmin_retire', 'espace_cree', 'espace_modifie',
	                 'espace_supprime', 'membre_pose', 'membre_retire', 'attente_inscrite', 'attente_retiree',
	                 'mcp_droits_poses', 'logs_purged', 'card_addresses_regenerated'));

-- =============================================================================================
-- 5. Régler le préfixe — §3.6 point 5
-- =============================================================================================
--
-- La signature change : l'ancienne est retirée, faute de quoi un appel à trois arguments serait ambigu. Un appel à trois
-- arguments résout toujours, vers la nouvelle, dont le quatrième vaut `null` : le préfixe est alors laissé tel quel.

drop function if exists public.plateforme_modifier_espace(uuid, text, text);

create or replace function public.plateforme_modifier_espace(
	p_id uuid, p_nom text, p_domaine_entrant text, p_card_address_prefix text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	nom     text;
	domaine text;
	prefixe text;
	avant   public.workspaces;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_id);
	nom := app.plateforme_nom(p_nom);
	domaine := app.plateforme_domaine(p_domaine_entrant);

	select * into avant from public.workspaces w where w.id = p_id for update;
	prefixe := case when p_card_address_prefix is null then avant.card_address_prefix
	                else app.card_address_prefix_normalize(p_card_address_prefix) end;
	update public.workspaces w set name = nom, inbound_domain = domaine, card_address_prefix = prefixe where w.id = p_id;

	perform app.journaliser_plateforme('espace_modifie', p_id, pg_catalog.jsonb_build_object(
		'avant', pg_catalog.jsonb_build_object('nom', avant.name, 'domaine_entrant', avant.inbound_domain,
		                                       'card_address_prefix', avant.card_address_prefix),
		'apres', pg_catalog.jsonb_build_object('nom', nom, 'domaine_entrant', domaine,
		                                       'card_address_prefix', prefixe)));
end;
$$;

revoke all on function public.plateforme_modifier_espace(uuid, text, text, text) from public, anon;
grant execute on function public.plateforme_modifier_espace(uuid, text, text, text) to authenticated, service_role;

-- =============================================================================================
-- 6. La liste des espaces rend le préfixe et le décompte — §3.6 point 7
-- =============================================================================================
--
-- Le type de retour change : `create or replace` ne le permet pas sur l'ancienne, la fonction est retirée puis recréée
-- avec ses droits. `create or replace` reste écrit : c'est la forme que `scripts/verify-plateforme.sh` extrait.

drop function if exists public.plateforme_espaces();

create or replace function public.plateforme_espaces()
returns table(id uuid, nom text, slug text, domaine_entrant text, membres integer, administrateurs integer,
              attentes integer, cree_le timestamptz, card_address_prefix text, card_addresses_to_regenerate integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select w.id, w.name, w.slug, w.inbound_domain,
	       (select pg_catalog.count(*)::integer from public.workspace_members m where m.workspace_id = w.id),
	       (select pg_catalog.count(*)::integer from public.workspace_members m
	         where m.workspace_id = w.id and m.role = 'admin'),
	       (select pg_catalog.count(*)::integer from public.workspace_invitations i where i.workspace_id = w.id),
	       w.created_at,
	       w.card_address_prefix,
	       (select pg_catalog.count(*)::integer from public.cards c
	         where c.workspace_id = w.id and not app.card_address_has_prefix(c.email_local_part, w.card_address_prefix))
	  from public.workspaces w
	 order by w.name, w.slug;
end;
$$;

revoke all on function public.plateforme_espaces() from public, anon;
grant execute on function public.plateforme_espaces() to authenticated, service_role;

-- =============================================================================================
-- 7. Régénérer — §3.6 points 7 et 8
-- =============================================================================================
--
-- Seules les affaires hors du préfixe courant sont réécrites, archivées et en corbeille comprises : une affaire déjà
-- conforme garde son adresse, et le geste se rejoue sans dommage. Un rejeu sans affaire à réécrire ne journalise rien.

create or replace function public.platform_regenerate_card_addresses(p_workspace_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	prefixe text;
	affaire uuid;
	nombre  integer := 0;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_workspace_id);

	-- Le verrou de l'espace sérialise la régénération avec un changement de préfixe concurrent.
	select w.card_address_prefix into prefixe from public.workspaces w where w.id = p_workspace_id for update;

	for affaire in
		select c.id from public.cards c
		 where c.workspace_id = p_workspace_id
		   and not app.card_address_has_prefix(c.email_local_part, prefixe)
		 order by c.created_at, c.id
		   for update
	loop
		update public.cards c set email_local_part = app.card_address_draw(prefixe) where c.id = affaire;
		nombre := nombre + 1;
	end loop;

	if nombre > 0 then
		perform app.journaliser_plateforme('card_addresses_regenerated', p_workspace_id,
			pg_catalog.jsonb_build_object('card_address_prefix', prefixe, 'count', nombre));
	end if;
	return nombre;
end;
$$;

comment on function public.platform_regenerate_card_addresses(uuid) is
	'CRM-123 — docs/SPEC-cards.md §3.6 point 7. Réservée au superadministrateur : tire une nouvelle adresse au préfixe '
	'courant pour chaque affaire de l''espace qui ne le porte pas ; rend leur nombre.';

revoke all on function public.platform_regenerate_card_addresses(uuid) from public, anon;
grant execute on function public.platform_regenerate_card_addresses(uuid) to authenticated, service_role;

-- =============================================================================================
-- 8. La journalisation de configuration suit la colonne — §3.6 point 5
-- =============================================================================================

drop trigger if exists workspaces_audit on public.workspaces;
create trigger workspaces_audit after update on public.workspaces
	for each row execute function app.audit_configuration('workspace', 'name', 'name', 'inbound_domain', 'settings',
	                                                      'card_address_prefix');
