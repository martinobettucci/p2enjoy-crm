-- @spec CRM-138 (docs/BACKLOG.md) — tranche T3 : la capacité « L'effacer aussi dans la boîte mail », rendue sur le message
--       ouvert pour que l'écran sache s'il offre la case
-- @spec docs/SPEC-mail-subsystem.md §29.1 (précisé avant le code de T3), §29.3 point 4 ; docs/SCHEMA.md « Migration
--       `0181` » ; docs/SPEC-droits-interface.md §2.1 (le patron de la colonne calculée) ; docs/DESIGN_SYSTEM.md §5.102
--
-- UNE COLONNE CALCULÉE, ET NON UN RÔLE LU PAR L'ÉCRAN (§5.59) : la règle est celle même par laquelle `delete_message`
-- choisit les boîtes à vider (`app.peut_ecrire_boite_du_message`, `0180`). Condition SUFFISANTE de refus, jamais
-- nécessaire : la base refuse de toute façon (`no_writable_mailbox`).

-- LE PARAMÈTRE EST ANONYME, comme celui d'`is_read` et de `concerns_me` : c'est ainsi que le générateur des types range la
-- colonne dans `mail_messages.Row` et que la sélection typée de la webapp la voit (mesuré : nommé, il ne l'y range pas).
create or replace function public.mailbox_trash_permitted(public.mail_messages)
returns boolean
language sql
stable
set search_path = ''
as $$
	select app.peut_ecrire_boite_du_message($1.id);
$$;

comment on function public.mailbox_trash_permitted(public.mail_messages) is
	'CRM-138 — docs/SPEC-mail-subsystem.md §29.1, docs/SCHEMA.md « Migration 0181 ». Colonne CALCULÉE : l''appelant peut-il '
	'effacer aussi ce message dans sa boîte mail — titulaire d''une boîte où il figure, ou administrateur de l''espace de '
	'cette boîte (app.peut_ecrire_boite_du_message). Condition SUFFISANTE de refus, jamais nécessaire. SECURITY INVOKER.';

-- `anon` reçoit `execute` pour la raison de la migration 71 (reprise par la 91) : zéro ligne plutôt qu'une erreur de
-- privilège ; la RLS ne lui rend aucun message.
revoke all on function public.mailbox_trash_permitted(public.mail_messages) from public;
grant execute on function public.mailbox_trash_permitted(public.mail_messages) to anon, authenticated, service_role;

-- Une colonne calculée neuve reste invisible au cache de schéma de PostgREST jusqu'à son rechargement.
notify pgrst, 'reload schema';
