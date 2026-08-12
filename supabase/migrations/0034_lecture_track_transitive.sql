-- @spec CRM-012 (docs/BACKLOG.md) — reprise de la politique de lecture de `tracks`
-- @spec CRM-010 (docs/BACKLOG.md) — la matrice de résolution est rouverte par la même décision
-- @spec docs/SPEC-permissions-rls.md §3.3 bis (la règle, écrite avant ce fichier), §3.5 (une
--       politique n'appelle jamais une fonction qui relit sa propre table), §4.2 ligne f
-- @spec docs/SPEC-tracks.md §5.3 (politique de lecture), docs/SPEC-channels.md §5.1 (la route
--       qui n'existe qu'une fois le track ouvert, et qui fait de ce défaut un défaut)
-- @spec docs/JOURNAL.md décision 333 (arbitrage), décision 107 (le défaut à ne pas réintroduire)
--
-- UN DROIT QUI N'A PAS DE CHEMIN N'EST PAS UN DROIT.
--
-- MESURÉ sur la pile de développement, avec le jeton du `viewer` seedé, AVANT cette migration :
--
--   GET /rest/v1/tracks    → Studio web, Formation, Pipeline 2024      (« Conseil & IA » ABSENT)
--   GET /rest/v1/channels  → Refonte de site, Inter-entreprises, Prospection, Maintenance
--
-- Farida Nowak porte `track_members.access = 'none'` sur « Conseil & IA » et
-- `channel_members.access = 'member'` sur « Prospection », channel de ce track. « Le plus
-- spécifique gagne » (§2.2) rouvre donc le channel, `app.can_read_channel` l'applique, et une
-- assertion pgTAP le prouve depuis `CRM-012`. Mais l'interface ne liste les channels qu'une fois
-- un track ouvert (`docs/SPEC-channels.md` §5.1, route `/tracks/:slugTrack/:slugChannel`) : le
-- track n'étant pas rendu, AUCUN geste de navigation ne mène à « Prospection ». Un droit accordé
-- était invisible et inexerçable, là où un droit retiré restait correctement observable.
--
-- INC-085 et INC-075 décrivent ce même défaut à trois jours d'écart. La décision 333 tranche :
-- **un track est lisible dès que l'un au moins de ses channels l'est** — « le plus spécifique
-- gagne » devient TRANSITIF.

begin;

-- =============================================================================================
-- 1. `app.track_has_readable_channel` — la transitivité, isolée dans une fonction
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.3 bis et §3.5.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi une fonction, et non un `EXISTS` écrit dans la politique.
-- ---------------------------------------------------------------------------------------------
-- Un `EXISTS (select 1 from public.channels …)` posé directement dans le `USING` de `tracks`
-- serait évalué avec les droits de l'appelant : la politique de lecture de `channels`
-- s'appliquerait à cette sous-requête, et le prédicat dépendrait alors d'une SECONDE politique
-- pour être juste. Cela fonctionnerait aujourd'hui — `channels_lecture_membre` n'interroge pas
-- `tracks`, donc aucune récursion — mais ferait reposer une règle sur un effet de bord : il
-- suffirait qu'un jour la politique de `channels` consulte `tracks` pour obtenir une récursion
-- croisée, exactement le motif qui impose déjà `SECURITY DEFINER` au §3.4.
--
-- La fonction énonce donc son prédicat EXPLICITEMENT, et le lit sans RLS.
--
-- ---------------------------------------------------------------------------------------------
-- Le §3.5 reste opposable, et c'est la propriété à ne pas perdre.
-- ---------------------------------------------------------------------------------------------
-- docs/JOURNAL.md, décision 107. La politique `SELECT` de `tracks` gouverne aussi le `RETURNING`
-- d'un `INSERT` — ce que PostgREST émet dès `Prefer: return=representation`. Une fonction `STABLE`
-- qui relirait `public.tracks` ne verrait pas la ligne insérée par l'instruction en cours, et
-- l'écriture entière échouerait en `42501`.
--
-- Cette fonction ne lit **jamais** `public.tracks` : elle reçoit l'identifiant du track et
-- interroge `public.channels`, une table TIERCE que l'instruction gouvernée ne touche pas. Un
-- track qui vient d'être créé n'a d'ailleurs aucun channel — la fonction rend `false`, et c'est
-- la première branche de la disjonction, inchangée, qui rend `true` à son administrateur.
--
-- ---------------------------------------------------------------------------------------------
-- `app.can_read_channel` plutôt que `app.resolve_channel_access`.
-- ---------------------------------------------------------------------------------------------
-- Les deux calculent la même chose, et appeler `app.resolve_channel_access(c.workspace_id,
-- c.track_id, c.id)` économiserait une relecture de `channels` par ligne candidate. C'est
-- `app.can_read_channel` qui est retenue, pour deux raisons qui pèsent plus que cette économie :
-- le §3.3 bis la nomme explicitement, et c'est ELLE qui porte le contrat « ce channel est-il
-- lisible ? ». Réécrire son corps ici dupliquerait la règle à un second endroit, où une évolution
-- future de l'une ne suivrait pas l'autre. Le §3.5 n'interdit que la relecture de la table
-- **gouvernée** ; `channels` est tierce pour la politique de `tracks`.

create or replace function app.track_has_readable_channel(track uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.channels c
		 where c.track_id = track
		   and app.can_read_channel(c.id)
	);
$$;

alter function app.track_has_readable_channel(uuid) owner to postgres;

comment on function app.track_has_readable_channel(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.3 bis. Vrai si au moins un channel du track est '
	'lisible par l''appelant. Ne lit jamais `tracks` : c''est ce qui préserve `insert … returning` '
	'(décision 107).';

revoke all on function app.track_has_readable_channel(uuid) from public;
grant execute on function app.track_has_readable_channel(uuid)
	to anon, authenticated, service_role;

-- =============================================================================================
-- 2. Élargissement de la politique de lecture de `tracks`
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.3 bis, docs/SPEC-tracks.md §5.3.
--
-- La politique garde son NOM, pour le motif déjà retenu par `CRM-012` : le nom désigne la règle du
-- produit — « un membre lit » —, non son implémentation. Le renommer casserait les assertions de
-- deux suites pgTAP et les scripts de dégradation de deux harnais, sans rien apprendre à personne.
--
-- CE QUE CET ÉLARGISSEMENT NE FAIT PAS, et que les preuves de la reprise vérifient une à une :
--
--   * il n'ouvre AUCUN channel supplémentaire — la politique de `channels` est inchangée, et
--     c'est elle qui filtrera les onglets du track réapparu (§3.3 bis, deuxième tiret) ;
--   * il ne confère AUCUN droit d'écriture — l'écriture de `tracks` reste `app.is_workspace_admin`
--     (§4, colonne « Écriture »), et atteindre un track par l'un de ses channels ne la touche pas ;
--   * il ne modifie AUCUNE des trois fonctions `can_*` du §3.3 — `app.can_read_track` garde son
--     contrat exact : elle répond « l'appelant a-t-il droit à ce track ? », pas « peut-il
--     l'atteindre ? ». C'est la politique qui s'élargit, jamais la fonction.
--
-- L'ordre de la disjonction n'est pas indifférent : la branche héritée, de très loin la plus
-- fréquente et la moins coûteuse, est évaluée en premier ; PostgreSQL n'appelle la seconde que
-- pour les tracks qu'elle vient de refuser.

drop policy if exists tracks_lecture_membre on public.tracks;
create policy tracks_lecture_membre
	on public.tracks
	for select
	to anon, authenticated
	using (
		app.resolve_track_access(workspace_id, id) <> 'none'
		or app.track_has_readable_channel(id)
	);

comment on policy tracks_lecture_membre on public.tracks is
	'CRM-012 — lecture par les membres du workspace, droit fin appliqué, ÉLARGIE par la '
	'décision 333 : un track est lisible dès qu''un de ses channels l''est (§3.3 bis, INC-085 et '
	'INC-075). Le prédicat emploie les colonnes de la ligne et une table tierce, jamais une '
	'relecture de `tracks` : décision 107.';

commit;
