-- @spec CRM-138 (docs/BACKLOG.md) — tranche T4 : l'espace d'un message de la corbeille, pour l'ancre `trashed_message` du
--       connecteur MCP (`crm_mail_restore`)
-- @spec docs/SPEC-mail-subsystem.md §29.8 (précisé avant le code de T4) ; docs/SPEC-mcp.md §9.2 (CRM-138) ; docs/SCHEMA.md
--       « Migration `0182` » ; la règle de visibilité de la corbeille : `app.message_en_corbeille_visible` (`0180`, décision 707)
--
-- UN MESSAGE EFFACÉ N'EST PLUS LU PAR LA POLITIQUE DE `mail_messages` (§29.4) : le connecteur ne peut donc pas en lire l'espace
-- comme il lit celui d'un message vivant. Cette fonction le lui rend, sous le jeton de la personne, seulement pour un message
-- de SA corbeille visible — exactement ce que `trashed_messages` lui montre déjà. Inconnu, non effacé, ou effacé par un autre
-- sans administrer l'espace : `NULL`, indiscernables.

create or replace function public.trashed_message_workspace(p_message_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select m.workspace_id
	  from public.mail_messages m
	 where m.id = p_message_id
	   and app.message_en_corbeille_visible(m);
$$;

comment on function public.trashed_message_workspace(uuid) is
	'CRM-138 — docs/SPEC-mail-subsystem.md §29.8, docs/SCHEMA.md « Migration 0182 ». L''espace d''un message de la corbeille '
	'visible de l''appelant (le sien, ou tout l''espace qu''il administre) ; NULL sinon. Ancre `trashed_message` du connecteur.';

revoke all on function public.trashed_message_workspace(uuid) from public, anon;
grant execute on function public.trashed_message_workspace(uuid) to authenticated;
