-- @spec CRM-149 (docs/BACKLOG.md) — tranche T1 : les prompts du connecteur MCP — la table de l'espace, ses droits tenus en
--       base, les cinq défauts posés à la création d'un espace et repris pour les espaces existants
-- @spec docs/SPEC-mcp.md §17.2 (le modèle), §17.3 (qui lit, qui écrit), §17.4 (les cinq défauts, au mot près) ;
--       docs/SCHEMA.md « Migration de `CRM-149` » ; docs/DAT.md §12 bis (noms anglais, décision 658) ; docs/JOURNAL.md
--       décision 930 ; CLAUDE.md §10 (la règle tenue en base, jamais par l'écran)
--
-- UN PROMPT N'OUVRE RIEN. Il guide l'assistant connecté ; chaque outil qu'il fait appeler reste soumis à la matrice du
-- connecteur et à la RLS. La table n'a donc aucune case dans `mcp_droits` (décision 930).
--
-- SUPPRIMER DÉTRUIT : aucun objet ne référence un prompt (décision 930), à la différence d'une pastille (décision 926).

-- =============================================================================================
-- 1. La table
-- =============================================================================================

create table public.mcp_prompts (
	id           uuid primary key default gen_random_uuid(),
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	key          text not null
		constraint mcp_prompts_key_check check (char_length(key) between 2 and 40 and key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	title        text not null
		constraint mcp_prompts_title_check check (title = btrim(title) and char_length(title) between 1 and 80),
	description  text not null
		constraint mcp_prompts_description_check check (description = btrim(description) and char_length(description) between 1 and 300),
	body         text not null
		-- Resserré des blancs ET des fins de ligne : un texte fait de lignes vides est vide.
		constraint mcp_prompts_body_check check (char_length(btrim(body, E' \t\r\n')) between 1 and 8000),
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	created_by   uuid references public.profiles (id) on delete set null,
	updated_by   uuid references public.profiles (id) on delete set null,
	constraint mcp_prompts_key_unique unique (workspace_id, key)
);
comment on table public.mcp_prompts is
	'CRM-149 : les prompts que le connecteur MCP propose, par espace — un identifiant, un titre, une description et un '
	'texte inséré dans la conversation. Édités par les administrateurs de l''espace, lus par tout membre. '
	'docs/SPEC-mcp.md §17.';

create trigger mcp_prompts_updated_at
	before update on public.mcp_prompts
	for each row execute function app.set_updated_at();

-- L'auteur et le dernier modificateur sont posés par le serveur, jamais lus de la requête. Sous la clé de propriétaire
-- ou de service — les défauts, la migration —, `auth.uid()` est nul et les deux restent nuls.
create or replace function app.mcp_prompts_auteurs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	v_auteur uuid := (select p.id from public.profiles p where p.id = auth.uid());
begin
	if tg_op = 'INSERT' then
		new.created_by := v_auteur;
	else
		new.created_by := old.created_by;
	end if;
	new.updated_by := v_auteur;
	return new;
end;
$$;
create trigger mcp_prompts_auteurs
	before insert or update on public.mcp_prompts
	for each row execute function app.mcp_prompts_auteurs();

-- =============================================================================================
-- 2. Qui lit, qui écrit (docs/SPEC-mcp.md §17.3)
-- =============================================================================================

alter table public.mcp_prompts enable row level security;

create policy mcp_prompts_lecture on public.mcp_prompts
	for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));
create policy mcp_prompts_insertion on public.mcp_prompts
	for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));
create policy mcp_prompts_maj on public.mcp_prompts
	for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));
create policy mcp_prompts_suppression on public.mcp_prompts
	for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

-- `anon` lit pour rendre zéro ligne plutôt qu'une erreur de privilège (docs/SPEC-permissions-rls.md §7). L'espace d'un
-- prompt ne se change pas : il est absent des colonnes modifiables. Les auteurs et les dates ne s'écrivent pas.
revoke all on public.mcp_prompts from anon, authenticated;
grant select on public.mcp_prompts to anon, authenticated;
grant insert (workspace_id, key, title, description, body) on public.mcp_prompts to authenticated;
grant update (key, title, description, body) on public.mcp_prompts to authenticated;
grant delete on public.mcp_prompts to authenticated;

-- =============================================================================================
-- 3. Les cinq défauts (docs/SPEC-mcp.md §17.4 — le texte est le contrat, au mot près)
-- =============================================================================================

create or replace function app.seed_default_mcp_prompts(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values
		(p_workspace_id, 'creer-une-affaire', 'Créer une affaire complète',
		 'Crée une affaire avec son organisation, son contact, ses recettes et un commentaire de synthèse, sans doublon.',
		 E'Je veux créer une affaire complète dans le CRM.\n'
		 '1. Demande-moi ce qui manque : le nom de l''affaire, le channel où la ranger, le client (organisation et contact) et les montants prévus.\n'
		 '2. Avant toute création, cherche l''existant avec crm_search : l''organisation et le contact existent souvent déjà. Ne crée jamais de doublon.\n'
		 '3. Trouve le channel avec crm_channel_list, puis crée l''affaire avec crm_card_create. Complète-la avec crm_card_update : champs, prochaine action, échéance. crm_common_field_list donne les champs de l''espace.\n'
		 '4. S''ils manquent, crée l''organisation (crm_organization_create) et le contact (crm_contact_create), puis lie le contact à l''affaire avec crm_card_contact_link.\n'
		 '5. Ajoute les recettes prévues avec crm_card_revenue_add. Un montant déjà encaissé s''enregistre avec crm_card_revenue_actual_add.\n'
		 '6. Termine par un commentaire de synthèse (crm_card_comment_add), puis récapitule-moi ce que tu as créé.'),
		(p_workspace_id, 'faire-le-point', 'Faire le point sur une affaire',
		 'Résume une affaire : étape, prochaine action, recettes prévues et réelles, derniers échanges, points d''attention.',
		 E'Fais le point sur une affaire.\n'
		 '1. Si je ne t''ai pas dit laquelle, demande-le-moi, puis retrouve-la avec crm_search.\n'
		 '2. Lis la fiche avec crm_card_get, les recettes avec crm_card_revenue_list, les commentaires avec crm_card_comment_list et l''historique avec crm_card_timeline. Les mails de l''affaire sont dans crm_card_mail_list.\n'
		 '3. Rends-moi un résumé court : où en est l''affaire, ce qui est prévu et ce qui est réel pour les recettes, les derniers échanges, la prochaine action et son échéance, et ce qui te paraît à risque.\n'
		 'Ne modifie rien : c''est une lecture.'),
		(p_workspace_id, 'faire-avancer', 'Faire avancer une affaire',
		 'Met l''affaire à jour, vérifie ce que l''étape suivante exige, la déplace avec votre accord et laisse un commentaire.',
		 E'Je veux faire avancer une affaire.\n'
		 '1. Retrouve-la avec crm_search si besoin, puis lis-la avec crm_card_get.\n'
		 '2. Lis son workflow avec crm_workflow_get : les transitions permises depuis l''étape actuelle, et les champs qu''elles exigent.\n'
		 '3. Mets d''abord l''affaire à jour avec crm_card_update : les champs exigés, la prochaine action, l''échéance.\n'
		 '4. Dis-moi vers quelle étape tu vas la déplacer et attends mon accord, puis déplace-la avec crm_card_move. Si le CRM refuse, explique-moi ce qui manque.\n'
		 '5. Laisse un commentaire qui dit pourquoi l''affaire avance (crm_card_comment_add).'),
		(p_workspace_id, 'retrouver-une-affaire', 'Retrouver une affaire',
		 'Retrouve une affaire par quelques mots, plutôt qu''en parcourant les listes.',
		 E'Retrouve une affaire.\n'
		 '1. Commence par crm_search avec les mots que je te donne : le client, l''affaire, un contact. C''est le moyen le plus direct.\n'
		 '2. Si plusieurs affaires correspondent, montre-les-moi avec leur channel et leur étape, et demande-moi laquelle.\n'
		 '3. Si la recherche ne trouve rien, liste les channels avec crm_channel_list, puis les affaires d''un channel avec crm_card_list. crm_card_mine donne les affaires qui me sont confiées.\n'
		 '4. Une fois l''affaire trouvée, lis-la avec crm_card_get.'),
		(p_workspace_id, 'enregistrer-une-recette-reelle', 'Enregistrer une recette réelle',
		 'Enregistre un montant encaissé ou facturé sur la bonne ligne de recette d''une affaire.',
		 E'Je veux enregistrer une recette réelle : un montant encaissé ou facturé.\n'
		 '1. Retrouve l''affaire avec crm_search, puis lis ses recettes avec crm_card_revenue_list.\n'
		 '2. Choisis avec moi la ligne de recette concernée. Si aucune ne convient, propose d''en créer une avec crm_card_revenue_add.\n'
		 '3. Enregistre le montant avec crm_card_revenue_actual_add : le montant, la date d''encaissement et, si besoin, un libellé comme un numéro de facture. La devise est celle de la ligne.\n'
		 '4. Si la ligne est entièrement encaissée, propose de la marquer soldée avec crm_card_revenue_settle.\n'
		 '5. Récapitule-moi ce qui a été enregistré, et ce qui reste attendu sur l''affaire.')
	on conflict (workspace_id, key) do nothing;
$$;
revoke all on function app.seed_default_mcp_prompts(uuid) from public;

create or replace function app.workspaces_default_mcp_prompts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform app.seed_default_mcp_prompts(new.id);
	return new;
end;
$$;
create trigger workspaces_default_mcp_prompts
	after insert on public.workspaces
	for each row execute function app.workspaces_default_mcp_prompts();

-- Les espaces existants reçoivent leurs défauts.
select app.seed_default_mcp_prompts(w.id) from public.workspaces w;
