-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 4, SOUS-TRANCHE 4c : l'écran
-- @spec docs/SPEC-modeles-emails.md §13 (contrat exécutable de 4c), §13.1 (les quatre questions et
--       la mesure qui tranche chacune), §13.2 (la mesure qui RÉVISE le §11.6 bis), §13.3
--       (signature, refus et privilèges de la RPC), §13.6 (ce que l'écran en fait), §13.10
--       (contrat d'API)
-- @spec docs/SPEC-modeles-emails.md §11.6 (la position est `deferrable`, et la mesure qui
--       l'impose), §11.6 bis (ce que la route ne sait pas faire), §11.7 (autorisations des deux
--       tables)
-- @spec docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
-- @spec docs/SCHEMA.md §7 (`mail_sequence_steps`) ; docs/PROD_MIGRATIONS.md migration 62
--
-- CETTE MIGRATION CRÉE UNE SEULE FONCTION, ET NE TOUCHE À RIEN D'AUTRE.
--
-- Aucune table, aucune colonne, aucune contrainte, aucune politique, aucun privilège de table et
-- aucun trigger n'est modifié. C'est une EXPOSITION, au sens exact du guichet du §9.3 : elle rend
-- exprimable par la route un geste que la base sait déjà faire et que PostgREST ne sait pas écrire.
--
-- ---------------------------------------------------------------------------------------------
-- CE QU'ELLE RÉPARE, ET LA MESURE QUI LE DIT.
-- ---------------------------------------------------------------------------------------------
-- Réordonner des paliers, c'est permuter des positions. Le §11.6 bis a mesuré, le 2026-08-25, que
-- PostgREST ne sait pas l'écrire : un `PATCH` ne pose que des valeurs LITTÉRALES, et les deux
-- détours qu'un client tenterait sont fermés — position tampon hors bornes (`23514`), ou doublon
-- direct (`23505`). Re-mesuré le 2026-08-26 par la route, avec le jeton réel du développement
-- commercial :
--
--   PATCH /mail_sequence_steps?id=eq.…a1  {"position":2}
--   => 409  23505  mail_sequence_steps_sequence_position_key
--
-- ---------------------------------------------------------------------------------------------
-- AUCUN `set constraints`, ET C'EST UNE MESURE QUI L'A DÉCIDÉ (§13.2).
-- ---------------------------------------------------------------------------------------------
-- Le §11.6 bis annonçait que cette RPC devrait « ouvrir une transaction, émettre
-- `set constraints … deferred` et reposer les positions ». LA SECONDE MOITIÉ EST FAUSSE, et une
-- sonde du 2026-08-26 le montre : l'`update … from unnest(…) with ordinality` ci-dessous repose
-- les trois paliers du seed dans l'ordre inverse, en UNE instruction, et il est ACCEPTÉ sans
-- qu'aucun `set constraints` ne soit émis.
--
-- Le §11.6 avait déjà mesuré pourquoi : la contrainte `mail_sequence_steps_sequence_position_key`
-- est `deferrable initially immediate`, donc vérifiée en FIN D'INSTRUCTION. Une permutation
-- complète écrite en une instruction n'a jamais deux lignes en collision à cet instant-là.
--
-- ÉMETTRE LA COMMANDE QUAND MÊME SERAIT PIRE QU'INUTILE : le prochain lecteur en déduirait que la
-- contrainte est `initially deferred`, ce qu'elle n'est pas et ne doit pas devenir — hors
-- réordonnancement, un doublon doit être refusé à l'instruction qui le crée, et non à la
-- validation d'une transaction dont l'appelant ne saura plus quelle écriture a fauté (§11.6).
--
-- ---------------------------------------------------------------------------------------------
-- `security invoker`, ET C'EST LA DÉCISION DE FORME (§13.1 question 2).
-- ---------------------------------------------------------------------------------------------
-- La migration 59 a posé les quatre politiques des deux tables. Une fonction `security definer`
-- devrait RÉÉCRIRE la règle d'écriture — « admin ou business_developer du workspace » —, et deux
-- écritures de la même règle divergent. C'est le raisonnement du §3 sur la liste des variables,
-- transposé aux droits.
--
-- LA CONSÉQUENCE EST QU'UN REFUS DE POLITIQUE REND `0`, ET NON UNE ERREUR. C'est le zéro-ligne du
-- §7 de `docs/SPEC-permissions-rls.md`, celui que la lectrice reçoit déjà sur un `PATCH` (mesuré :
-- `200` et `[]`). L'écran le NOMME plutôt que de le confondre avec un succès (§13.3).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage. `create or replace function` est convergent ; `revoke` et `grant`
-- le sont aussi.

-- =============================================================================================
-- 1. `public.reordonner_paliers_sequence` — l'ordre voulu, transcrit en positions 1..n
-- =============================================================================================
--
-- ELLE PREND UN ORDRE, PAS DES POSITIONS (§13.2). Une RPC qui prendrait « ce palier monte d'un
-- cran » devrait calculer l'échange, donc relire l'état courant — et deux appels concurrents
-- liraient le même état. L'écran envoie ce qu'il affiche, la base le transcrit.
--
-- ELLE REND LE NOMBRE DE PALIERS REPOSITIONNÉS, et ce n'est pas un confort : c'est le SEUL moyen
-- de distinguer un réordonnancement consenti d'un refus silencieux de la politique.

create or replace function public.reordonner_paliers_sequence(
	p_sequence_id uuid,
	p_paliers     uuid[]
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_attendus integer;
	v_nommes   integer;
	v_communs  integer;
	v_reposes  integer;
begin
	-- (a) Réordonner sans ordre n'a pas de sens. Un tableau vide reposerait ZÉRO position en
	--     rendant `0`, ce qui serait indiscernable d'un refus de politique — la seule issue que
	--     l'appelant ne doit jamais confondre avec autre chose (§13.3).
	if p_paliers is null or cardinality(p_paliers) = 0 then
		raise exception 'paliers_requis' using errcode = '23514';
	end if;

	-- (b) Un doublon laisserait un rang inoccupé et un palier non repositionné. La base
	--     l'accepterait — `unnest` rendrait deux lignes pour le même `id`, et l'`update` en
	--     retiendrait une — sans qu'aucune contrainte ne le voie : c'est donc ici, et nulle part
	--     ailleurs, que le refus doit tomber.
	if cardinality(p_paliers) <> (select count(distinct u.id) from unnest(p_paliers) as u(id)) then
		raise exception 'paliers_dupliques' using errcode = '23514';
	end if;

	-- (c) L'ordre doit être EXACTEMENT l'ensemble des paliers LISIBLES de la séquence. Un ordre
	--     partiel laisserait des positions hors de `1..n`, ou en collision avec celles qu'il n'a
	--     pas nommées.
	--
	--     LES DEUX COMPTES SONT PRIS SOUS LA RLS DE L'APPELANT, et c'est délibéré (§13.3) : pour
	--     un appelant à qui la séquence est cachée, `v_attendus` vaut 0, `v_communs` vaut 0, et le
	--     refus tombe en `paliers_incomplets` — jamais en révélant qu'une séquence existe. Une
	--     séquence INCONNUE produit exactement le même refus, pour la même raison.
	select count(*) into v_attendus
	  from public.mail_sequence_steps s
	 where s.sequence_id = p_sequence_id;

	select count(*) into v_communs
	  from public.mail_sequence_steps s
	 where s.sequence_id = p_sequence_id
	   and s.id = any (p_paliers);

	v_nommes := cardinality(p_paliers);

	if v_attendus <> v_nommes or v_communs <> v_nommes then
		raise exception 'paliers_incomplets' using errcode = '23514';
	end if;

	-- UNE SEULE INSTRUCTION, et c'est ce qui rend `set constraints` inutile (§13.2). `with
	-- ordinality` numérote le tableau dans l'ordre reçu, à partir de 1 : c'est exactement la
	-- définition d'une position (§11.4), et aucune arithmétique n'est écrite ici.
	--
	-- `sequence_id = p_sequence_id` est REPOSÉ dans le `where`, bien que le refus (c) l'ait déjà
	-- établi : la garde vit alors dans la MÊME instruction que l'écriture, et un palier d'une
	-- autre séquence ne pourrait pas être repositionné même si le refus (c) était un jour
	-- assoupli.
	update public.mail_sequence_steps s
	   set position = o.rang
	  from (
	         select u.id, u.ord::integer as rang
	           from unnest(p_paliers) with ordinality as u(id, ord)
	       ) o
	 where s.id          = o.id
	   and s.sequence_id = p_sequence_id;

	get diagnostics v_reposes = row_count;
	return v_reposes;
end;
$$;

alter function public.reordonner_paliers_sequence(uuid, uuid[]) owner to postgres;

comment on function public.reordonner_paliers_sequence(uuid, uuid[]) is
	'CRM-063 §13.3 — repose les positions des paliers d''une séquence dans l''ordre du tableau '
	'reçu, en UNE instruction. `security invoker` : la RLS de la migration 59 fait tout le tri, et '
	'un refus de politique rend 0 — jamais une erreur. TROIS refus : paliers_requis, '
	'paliers_dupliques, paliers_incomplets. AUCUN `set constraints` : la contrainte de position '
	'est `deferrable initially immediate`, donc vérifiée en fin d''instruction (§13.2).';

-- =============================================================================================
-- 2. Privilèges — §13.3
-- =============================================================================================
--
-- LE POINT DE SÛRETÉ DES MIGRATIONS 48 À 60 S'APPLIQUE : la plateforme porte des
-- `alter default privileges … to anon`, si bien qu'un `revoke … from public` ne retire RIEN à un
-- rôle NOMMÉ. `anon` est donc révoqué nommément.
--
-- `anon` EXCLU : un appelant anonyme ne détient aucun `update` sur `mail_sequence_steps`
-- (migration 59), et l'appel s'arrêterait de toute façon sur le privilège de la table. Le fermer
-- ici AUSSI fait que le refus tombe AVANT la fonction — mécanisme mesuré au §12.11 ligne 12 — et
-- que l'appelant reçoit `401` plutôt qu'un `0` qu'il pourrait lire comme un refus de politique.

revoke all on function public.reordonner_paliers_sequence(uuid, uuid[]) from public, anon;
grant execute on function public.reordonner_paliers_sequence(uuid, uuid[])
	to authenticated, service_role;
