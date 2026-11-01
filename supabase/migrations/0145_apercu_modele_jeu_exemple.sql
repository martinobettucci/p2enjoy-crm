-- @spec CRM-125 (docs/BACKLOG.md) T2 — l'aperçu d'un modèle sur un jeu d'exemple, pour le composer des séquences
-- @spec docs/SPEC-modeles-emails.md §14.2 (contrat de la fonction), §14.3 (le jeu d'exemple), §14.4 (l'identité de la
--       personne qui regarde) ; §8.2 (la substitution vit en base), §8.6 (formatage), §8.7 (privilèges), §10.8 (une
--       signature ne se substitue pas)
-- @spec docs/SCHEMA.md §7 (`mail_templates`, `mail_outbound_identities`) ; docs/PROD_MIGRATIONS.md §3 (migration 145)
-- @spec docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur) ; docs/JOURNAL.md décision 809
--
-- CETTE MIGRATION N'AJOUTE AUCUNE TABLE ET AUCUNE COLONNE, ET NE TOUCHE À RIEN D'EXISTANT. Elle livre une fonction
-- publique, `public.render_mail_template_sample` (nom anglais, décision 658), qui rend un modèle avec le moteur partagé
-- `app.mail_template_substituer` (`0056`) : l'aperçu ne peut pas diverger de ce qui partira.
--
-- Idempotence : `create or replace function`, `revoke` / `grant` nominatifs — le `migrations-runner` rejoue tout le
-- répertoire à chaque démarrage (`docs/DAT.md` §3.2).

create or replace function public.render_mail_template_sample(
	p_template_id uuid
)
returns table (
	subject            text,
	body_text          text,
	signature_text     text,
	identity_is_sample boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
	with modele as (
		select m.workspace_id, m.subject, m.body_text
		  from public.mail_templates m
		 where m.id = p_template_id
	),
	-- L'IDENTITÉ DE LA PERSONNE QUI REGARDE, PAR LA RÈGLE DE LA DÉCISION 805 (§14.4) : son défaut, à défaut son
	-- unique identité, sinon aucune. `owner_id = auth.uid()` écarte l'identité de service, qui ne sert qu'aux envois
	-- automatiques. La RLS de `mail_outbound_identities` s'applique en plus, telle quelle.
	siennes as (
		select i.from_name, i.from_address, i.signature_text, i.is_default,
		       count(*) over () as nombre
		  from public.mail_outbound_identities i
		  join modele m on m.workspace_id = i.workspace_id
		 where i.owner_id = auth.uid()
	),
	expediteur as (
		select s.from_name, s.from_address, s.signature_text
		  from siennes s
		 where s.is_default or s.nombre = 1
		 order by s.is_default desc
		 limit 1
	),
	-- LE JEU D'EXEMPLE, ÉCRIT UNE SEULE FOIS (§14.3). Les valeurs non textuelles sont déjà dans la forme du §8.6.
	-- Les domaines `.example` sont réservés (RFC 2606) : aucune adresse d'exemple n'appartient à quelqu'un.
	valeurs as (
		select jsonb_build_object(
			'card.title',            'Projet exemple',
			'card.channel',          'Prospection',
			'card.step',             'Proposition envoyée',
			'card.amount',           '12500.00',
			'card.currency',         'EUR',
			'card.next_action',      'Rappeler pour validation',
			'card.next_action_at',   '15/01/2027 10:00',
			'contact.full_name',     'M. Dupont',
			'contact.email',         'm.dupont@entreprise.example',
			'contact.organization',  'ENTREPRISE INC',
			-- Une identité sans `from_name` reçoit la valeur d'exemple de ce seul champ : l'aperçu ne porte aucun trou.
			'identity.from_name',    coalesce(e.from_name, 'Votre nom'),
			'identity.from_address', coalesce(e.from_address, 'vous@entreprise.example')
		) as carte,
		e.signature_text,
		e.from_address is null as identite_fictive
		  from (select 1) as un
		  left join expediteur e on true
	)
	select
		app.mail_template_substituer(m.subject,   v.carte) as subject,
		app.mail_template_substituer(m.body_text, v.carte) as body_text,
		-- RENDUE À PART ET TELLE QUELLE : une signature ne se substitue pas (§10.8), et son ajout au corps appartient
		-- à l'expédition (`queue_outbound_email`).
		v.signature_text,
		v.identite_fictive as identity_is_sample
	  from modele m
	 cross join valeurs v;
$$;

alter function public.render_mail_template_sample(uuid) owner to postgres;

comment on function public.render_mail_template_sample(uuid) is
	'CRM-125 — docs/SPEC-modeles-emails.md §14.2. Rend l''objet et le corps d''un modèle sur un jeu d''exemple fixe, '
	'l''expéditeur et la signature venant de l''identité de la personne (défaut, à défaut unique). SECURITY INVOKER : '
	'un modèle non lisible rend ZÉRO LIGNE, jamais une erreur.';

-- Privilèges : ceux de `rendre_modele_email` (§8.7) — `authenticated` et `service_role`, jamais `anon`.
revoke all on function public.render_mail_template_sample(uuid) from public, anon;
grant execute on function public.render_mail_template_sample(uuid) to authenticated, service_role;
