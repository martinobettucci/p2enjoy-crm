-- @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration, deuxième tranche : la garde de
--       restauration
-- @spec docs/SPEC-corbeille.md §3.4 (la restauration refuse plutôt que de deviner),
--       §3.3 (la mise en corbeille d'un parent ne descend pas sur ses enfants),
--       §2.3 (les cascades physiques, et pourquoi on ne les emprunte jamais)
-- @spec docs/SPEC-cards.md §4 (archivage et corbeille sont indépendants)
-- @spec docs/SCHEMA.md §3 et §4 ; docs/PROD_MIGRATIONS.md §3
-- @spec docs/JOURNAL.md décisions 398 et 399
--
-- CE QUE CETTE MIGRATION POSE, ET POURQUOI C'EST UNE GARDE ET NON UNE AIDE D'ÉCRAN.
--
-- Le §3.3 pose que mettre un parent à la corbeille NE DESCEND PAS sur ses enfants — descendre
-- l'horodatage rendrait la restauration ambiguë, puisque rien ne distinguerait plus les enfants
-- emportés par le parent de ceux déjà en corbeille avant lui.
--
-- Ce choix a une conséquence directe, et c'est elle que cette migration traite : un enfant peut se
-- retrouver EN CORBEILLE sous un parent LUI-MÊME en corbeille. Le restaurer seul le rendrait à un
-- endroit où personne ne le verrait — un channel restauré dans un track supprimé, une card rendue à
-- un channel supprimé. L'utilisateur aurait cliqué « restaurer », le produit aurait répondu
-- « c'est fait », et rien n'aurait été rendu.
--
-- Le refus est donc posé DANS LA BASE (`CLAUDE.md` §10). Masquer le bouton dans l'écran serait une
-- aide d'interface ; ce qui empêche réellement le geste doit vivre là où passent toutes les
-- écritures, y compris celles qui ne passent pas par l'écran.
--
-- CE QU'ELLE NE FAIT PAS :
--
--   * elle n'empêche pas de METTRE un enfant à la corbeille sous un parent déjà supprimé : c'est un
--     état atteignable et sans ambiguïté, et l'interdire n'aurait servi à rien ;
--   * elle ne restaure RIEN en cascade. Restaurer un parent ne ressuscite pas ses enfants : ils
--     n'ont jamais été touchés (§3.3), donc il n'y a rien à leur rendre ;
--   * elle ne touche ni les cascades physiques, ni les politiques, ni les privilèges.
--
-- AUCUN CHANGEMENT DE SCHÉMA : deux fonctions et deux triggers, rien d'autre.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Un channel ne se restaure pas sous un track en corbeille
-- ---------------------------------------------------------------------------------------------

create or replace function app.channels_restauration_verifier_parent()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
	-- La garde ne se déclenche QUE sur une restauration — la transition « était en corbeille,
	-- ne l'est plus ». Toute autre écriture passe sans être interrogée : une garde qui inspecterait
	-- le parent à chaque mise à jour coûterait une lecture par écriture, pour une question qui ne
	-- se pose qu'une fois.
	if old.deleted_at is null or new.deleted_at is not null then
		return new;
	end if;

	if exists (
		select 1
		  from public.tracks t
		 where t.id = new.track_id
		   and t.deleted_at is not null
	) then
		raise exception 'parent_en_corbeille'
			using errcode = 'P0001',
			      detail  = 'Le track de ce channel est lui-même en corbeille : restaurez-le d''abord.';
	end if;

	return new;
end;
$$;

alter function app.channels_restauration_verifier_parent() owner to postgres;

comment on function app.channels_restauration_verifier_parent() is
	'CRM-077 (docs/SPEC-corbeille.md §3.4) — refuse de restaurer un channel dont le track est en '
	'corbeille. Le rendre là serait le rendre à un endroit où personne ne le verrait.';

drop trigger if exists channels_restauration_parent on public.channels;
create trigger channels_restauration_parent
	before update on public.channels
	for each row execute function app.channels_restauration_verifier_parent();

-- ---------------------------------------------------------------------------------------------
-- 2. Une card ne se restaure pas sous un channel — ou un track — en corbeille
-- ---------------------------------------------------------------------------------------------
--
-- DEUX NIVEAUX, ET C'EST NÉCESSAIRE. Une card pend à un channel, qui pend à un track. Ne vérifier
-- que le channel laisserait restaurer une card sous un channel vivant dont le TRACK est supprimé :
-- la card serait rendue à un endroit tout aussi introuvable, d'un cran plus haut.

create or replace function app.cards_restauration_verifier_parent()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
	if old.deleted_at is null or new.deleted_at is not null then
		return new;
	end if;

	if exists (
		select 1
		  from public.channels c
		  left join public.tracks t on t.id = c.track_id
		 where c.id = new.channel_id
		   and (c.deleted_at is not null or t.deleted_at is not null)
	) then
		raise exception 'parent_en_corbeille'
			using errcode = 'P0001',
			      detail  = 'Le channel de cette affaire, ou son track, est en corbeille : restaurez-le d''abord.';
	end if;

	return new;
end;
$$;

alter function app.cards_restauration_verifier_parent() owner to postgres;

comment on function app.cards_restauration_verifier_parent() is
	'CRM-077 (docs/SPEC-corbeille.md §3.4) — refuse de restaurer une card dont le channel OU le '
	'track est en corbeille. Les deux niveaux sont vérifiés : un seul laisserait passer l''autre.';

drop trigger if exists cards_restauration_parent on public.cards;
create trigger cards_restauration_parent
	before update on public.cards
	for each row execute function app.cards_restauration_verifier_parent();

commit;
