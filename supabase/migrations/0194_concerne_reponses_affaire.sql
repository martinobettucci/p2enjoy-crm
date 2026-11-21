-- @spec CRM-160 (docs/BACKLOG.md) — « Seulement moi » retient les réponses reçues dans une affaire : un message reçu et
--       rattaché concerne aussi qui a écrit dans son fil (i) et le responsable d'un rattachement non archivé de l'affaire (ii)
-- @spec docs/SPEC-mail-subsystem.md §27.2 (révisé), §27.7.2 (la règle), §27.7.3 (cette migration) ; docs/SCHEMA.md
--       « Migration `0194` » ; docs/JOURNAL.md décisions 959 et 960 (INC-363) ; CLAUDE.md §10 (la RLS ne change pas)
--
-- UNE SEULE FONCTION, SOUS LA MÊME SIGNATURE. `inbox_arborescence`, `app.inbox_scope_messages` (`0175`, `0189`), puis
-- `inbox_messages` et `inbox_hidden_counts` (`0193`) appellent `public.concerns_me(m)` et suivent d'elles-mêmes. Le
-- paramètre reste anonyme : c'est ce qui en fait la colonne calculée `concerns_me` de PostgREST (§27.2).
--
-- La définition reprend celle de `0190` (les adresses personnelles, le transfert), à l'identique, et y ajoute la
-- disjonction marquée `CRM-160`.
--
-- `security invoker`, comme avant : le fil et les rattachements sont lus SOUS LES DROITS de l'appelant. Un écrit qu'il ne
-- lit pas (en corbeille, dans une affaire qui lui est fermée) ne compte pas ; un rattachement qu'il ne lit pas non plus. Ce
-- n'est pas une règle d'accès : la fonction ne fait que restreindre ce que l'appelant demande à voir (§27.1).
--
-- IDEMPOTENCE : `create or replace`.
-- RETOUR ARRIÈRE : rejouer la définition de `concerns_me` de `0190`.

create or replace function public.concerns_me(public.mail_messages)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select exists (
		select 1
		  from public.mail_outbound_identities i
		 where i.owner_id = (select auth.uid())
		   and lower(btrim(i.from_address)) in (
			select lower(btrim(a))
			  from unnest(
				coalesce($1.to_addresses, '{}'::text[])
				|| coalesce($1.cc_addresses, '{}'::text[])
				|| coalesce($1.bcc_addresses, '{}'::text[])
				|| array[$1.from_address]
			  ) as a
			 where a is not null
		   )
	)
	or app.message_transfere_a_moi($1.id)
	-- CRM-160 (§27.7.2) : un message REÇU et RATTACHÉ à une affaire, que l'appelant a suivie en écrivant dans le fil (i) ou
	-- dont il est responsable d'un rattachement actif (ii). La réponse à un envoi d'affaire n'est adressée qu'à `c-*`.
	or ($1.direction = 'inbound'
	    and $1.card_id is not null
	    and (
		-- (i) un message lisible du même fil (même espace, même clé, `mail_messages_cle_fil_idx`) a pour expéditeur une
		-- identité PERSONNELLE de l'appelant ; l'identité de service, sans propriétaire, n'est l'adresse de personne.
		exists (
			select 1
			  from public.mail_messages o
			  join public.mail_outbound_identities i
			    on i.owner_id = (select auth.uid())
			   and lower(btrim(i.from_address)) = lower(btrim(o.from_address))
			 where o.workspace_id = $1.workspace_id
			   and app.cle_fil(o.references_ids, o.rfc822_message_id) = app.cle_fil($1.references_ids, $1.rfc822_message_id)
		)
		-- (ii) l'appelant est le responsable d'au moins un rattachement NON ARCHIVÉ de l'affaire (décision 960).
		or exists (
			select 1
			  from public.card_placements p
			 where p.card_id = $1.card_id
			   and p.archived_at is null
			   and p.owner_id = (select auth.uid())
		)
	    ));
$$;

comment on function public.concerns_me(public.mail_messages) is
	'CRM-139, CRM-156, CRM-160 : vrai quand le message est adressé à (À, Cc, Cci) ou expédié par une identité sortante '
	'personnelle de l''appelant, quand il lui a été transféré, ou, reçu et rattaché à une affaire, quand l''appelant a écrit '
	'dans son fil ou est responsable d''un rattachement non archivé de l''affaire. Restriction d''affichage, pas règle d''accès.';

revoke all on function public.concerns_me(public.mail_messages) from public, anon;
grant execute on function public.concerns_me(public.mail_messages) to authenticated, service_role;
