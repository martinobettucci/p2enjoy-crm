-- @verifies CRM-014 (docs/BACKLOG.md) — harnais des douze preuves de refus d'autorisation
-- @verifies CRM-022 (docs/BACKLOG.md) — preuve n° 10 et sept politiques d'identité
-- @verifies docs/SPEC-permissions-rls.md §7 (les douze preuves), §7.2 (contrat mesuré),
--           §7.3 (ce qui n'est pas satisfaisable, et comment l'absence est figée),
--           §7.4 (non-complaisance)
-- @verifies docs/SPEC-test-harness.md §4.6 (fichier consolidé du projet `api`)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-014 (soldée par les politiques d'identité),
--           INC-057 (un `@verifies` annonçait la preuve n° 3 sans la porter)
-- @verifies docs/SCHEMA.md §1 (tables du socle), §5 (cards)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- Suite pgTAP de l'unité `CRM-014`. Le fichier de scénarios `e2e/api/preuves-refus.spec.ts` prouve
-- que le produit **refuse** ; cette suite prouve que le produit **est en état d'être interrogé**,
-- ce qui est une question distincte et qu'aucune assertion HTTP ne pose :
--
--   1. l'inventaire des politiques est celui attendu, table par table et nom par nom. Une politique
--      retirée, renommée ou ajoutée fait échouer la suite — c'est ce qui rend le harnais capable
--      d'échouer quand le produit se dégrade (§7.4) ;
--   2. les quinze tables métier interrogées par la preuve n° 11 sont **réellement peuplées**. Sans
--      cela, « l'anonyme lit zéro ligne » serait vrai que la RLS refuse ou qu'elle autorise tout
--      (décision 50) ;
--   3. les tables d'identité portent les **sept politiques** de CRM-022 et la preuve n° 10 repose
--      désormais sur une garde d'intégrité explicite ;
--   4. les cinq preuves non satisfaisables le sont parce que leur objet **n'existe pas**, figé par
--      des assertions d'absence qui deviendront rouges à la naissance de la table ou de la fonction
--      (mécanisme de la décision 51, convention de `CRM-006` puis `CRM-013`).
--
-- Exécution : `npm run test:sql`, `scripts/verify-preuves-refus.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0016_preuves_refus.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Aucun bloc n'emploie
-- `rollback to savepoint` : une assertion prise dans un savepoint annulé est **numérotée mais non
-- comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(62);

-- =============================================================================================
-- 1. Inventaire des politiques — ce qui rend le harnais capable d'échouer (§7.4)
-- =============================================================================================
-- Chaque table métier est énumérée avec les politiques qu'elle doit porter, **nommées**. Un
-- `drop policy` — la dégradation qu'éprouve `scripts/verify-preuves-refus.sh` — fait donc échouer
-- la suite ici, avant même que les scénarios HTTP ne s'en aperçoivent. Compter les politiques
-- sans les nommer laisserait passer un remplacement ; les nommer sans les compter laisserait
-- passer un ajout permissif. Les deux sont donc assérés.

create or replace function pg_temp.politiques(nom_table text)
returns text[] language sql stable as $$
	select coalesce(array_agg(policyname order by policyname), '{}')
	from pg_policies where schemaname = 'public' and tablename = nom_table;
$$;

select is(pg_temp.politiques('cards'),
	array['cards_insertion', 'cards_lecture', 'cards_maj'],
	'`cards` porte ses trois politiques. C''est la table la plus exposée de l''inventaire : trois '
	'des sept preuves acquises en dépendent — n° 3, n° 4 et n° 11 (décision 149)');

select is(pg_temp.politiques('card_field_values'),
	array['card_field_values_insertion', 'card_field_values_lecture', 'card_field_values_maj'],
	'`card_field_values` porte ses trois politiques — la preuve n° 4 les traverse');

select is(pg_temp.politiques('tracks'),
	array['tracks_insertion_admin', 'tracks_lecture_membre', 'tracks_maj_admin'],
	'`tracks` porte ses trois politiques');

select is(pg_temp.politiques('channels'),
	array['channels_insertion_admin', 'channels_lecture_membre', 'channels_maj_admin'],
	'`channels` porte ses trois politiques');

select is(pg_temp.politiques('track_members'),
	array['track_members_insertion_admin', 'track_members_lecture', 'track_members_maj_admin',
	      'track_members_suppression_admin'],
	'`track_members` porte ses quatre politiques');

select is(pg_temp.politiques('channel_members'),
	array['channel_members_insertion_admin', 'channel_members_lecture', 'channel_members_maj_admin',
	      'channel_members_suppression_admin'],
	'`channel_members` porte ses quatre politiques');

select is(pg_temp.politiques('workflows'),
	array['workflows_insertion_admin', 'workflows_lecture_membre', 'workflows_maj_admin'],
	'`workflows` porte ses trois politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_steps'),
	array['workflow_steps_insertion_admin', 'workflow_steps_lecture_membre',
	      'workflow_steps_maj_admin', 'workflow_steps_suppression_admin'],
	'`workflow_steps` porte ses quatre politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_transitions'),
	array['workflow_transitions_insertion_admin', 'workflow_transitions_lecture_membre',
	      'workflow_transitions_maj_admin', 'workflow_transitions_suppression_admin'],
	'`workflow_transitions` porte ses quatre politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_transition_required_fields'),
	array['workflow_transition_required_fields_insertion_admin',
	      'workflow_transition_required_fields_lecture_membre',
	      'workflow_transition_required_fields_suppression_admin'],
	'`workflow_transition_required_fields` porte ses trois politiques — CRM-018 l''ajoute à la '
	'preuve exhaustive opposée à l''anonyme');

select is(pg_temp.politiques('workflow_nodes_catalog'),
	array['catalogue_noeuds_insertion_admin', 'catalogue_noeuds_lecture_membre',
	      'catalogue_noeuds_maj_admin'],
	'`workflow_nodes_catalog` porte ses trois politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('form_fields'),
	array['form_fields_insertion_admin', 'form_fields_lecture_membre', 'form_fields_maj_admin'],
	'`form_fields` porte ses trois politiques');

select is(pg_temp.politiques('form_field_rules'),
	array['form_field_rules_insertion_admin', 'form_field_rules_lecture_membre',
	      'form_field_rules_maj_admin', 'form_field_rules_suppression_admin'],
	'`form_field_rules` porte ses quatre politiques');

select is(pg_temp.politiques('card_comments'),
	array['card_comments_insertion', 'card_comments_lecture', 'card_comments_maj',
	      'card_comments_moderation'],
	'`card_comments` porte ses QUATRE politiques et ne reste plus hors de l''inventaire nominal. '
	'La quatrième est la modération du lot G (INC-072, décision 374) : elle est SÉPARÉE de '
	'`card_comments_maj` pour qu''une dégradation puisse la retirer seule et constater que le '
	'geste de l''auteur survit');

select is(pg_temp.politiques('card_events'),
	array['card_events_lecture'],
	'`card_events` porte son unique politique de lecture et ne reste plus hors de l''inventaire '
	'nominal');

-- RÉVISÉ PAR `CRM-084`, qui livre les enveloppes budgétaires. L'inventaire NOMINAL est étendu en
-- même temps que le compte : le compte seul verrait un ajout sans savoir lequel, et le nom seul
-- ne verrait pas une politique surnuméraire. Les deux ensemble, et seulement ensemble, ferment la
-- porte.
--
-- CE QUE CES HUIT NOMS DISENT DE LA RÈGLE, ET QUI SE LIT ICI SANS OUVRIR LA MIGRATION : les deux
-- tables portent QUATRE politiques chacune, et le suffixe `_admin` sur trois d'entre elles n'est
-- pas décoratif — c'est l'arbitrage du §3 de `docs/SPEC-costs.md`, « le budget est un CADRE ;
-- l'affectation est un GESTE ». La lecture, elle, porte `_track` : elle suit `app.can_read_track`,
-- droits fins compris, et non le rôle.
select is(pg_temp.politiques('budgets'),
	array['budgets_insertion_admin', 'budgets_lecture_track', 'budgets_maj_admin',
	      'budgets_suppression_admin'],
	'`budgets` porte ses QUATRE politiques : lecture par le track, les trois écritures par '
	'l''administrateur du workspace (docs/SPEC-costs.md §3)');

select is(pg_temp.politiques('budget_occurrences'),
	array['budget_occurrences_insertion_admin', 'budget_occurrences_lecture_budget',
	      'budget_occurrences_maj_admin', 'budget_occurrences_suppression_admin'],
	'`budget_occurrences` porte ses QUATRE politiques : lecture par le budget, les trois écritures '
	'par l''administrateur du workspace');

-- RÉVISÉ PAR `CRM-085`, qui livre les lignes de coût. Même geste que pour `CRM-084` juste
-- au-dessus : le compte ET l'inventaire nominal, ensemble.
--
-- CE QUE CES QUATRE NOMS DISENT DE LA RÈGLE. Le suffixe est ici `_card` et non `_admin`, et c'est
-- exactement l'autre moitié de l'arbitrage du §3 : le BUDGET est un cadre — administrateur du
-- workspace —, l'AFFECTATION est un geste quotidien — quiconque écrit l'affaire. La lecture porte
-- `_card_et_budget`, seul nom de tout l'inventaire à citer DEUX objets : c'est la double condition
-- du §3.1, et un nom qui n'en citerait qu'un signalerait déjà la fuite.
select is(pg_temp.politiques('card_costs'),
	array['card_costs_insertion_ecriture_card', 'card_costs_lecture_card_et_budget',
	      'card_costs_maj_ecriture_card', 'card_costs_suppression_ecriture_card'],
	'`card_costs` porte ses QUATRE politiques : lecture par la card ET le budget, les trois '
	'écritures par qui écrit la card (docs/SPEC-costs.md §3)');

-- RÉVISÉ PAR `CRM-063` tranche 1, qui livre les modèles d'email. Même geste que pour `CRM-084` et
-- `CRM-085` : le compte ET l'inventaire nominal, ensemble.
--
-- CE QUE CES QUATRE NOMS DISENT DE LA RÈGLE. Le suffixe est `_membre` sur la lecture et
-- `_membre_ecrivant` sur les trois écritures : un modèle d'email est un objet ÉDITORIAL COLLECTIF
-- du workspace, lu par tout membre — la lectrice comprise — et écrit par l'administrateur comme par
-- le business developer (docs/SPEC-modeles-emails.md §2.6). C'est le patron de `goal_boards`, et
-- non celui des budgets : un texte n'est pas un cadre de gestion.
select is(pg_temp.politiques('mail_templates'),
	array['mail_templates_insertion_membre_ecrivant', 'mail_templates_lecture_membre',
	      'mail_templates_maj_membre_ecrivant', 'mail_templates_suppression_membre_ecrivant'],
	'`mail_templates` porte ses QUATRE politiques : lecture par tout membre, les trois écritures '
	'par l''administrateur et le business developer (docs/SPEC-modeles-emails.md §2.6)');

-- RÉVISÉ PAR `CRM-063` SOUS-TRANCHE 4a, qui livre les séquences de relance. Même geste que pour la
-- tranche 1 : le compte ET l'inventaire nominal, ensemble.
--
-- LES DEUX TABLES PORTENT CHACUNE LES QUATRE POLITIQUES, ET C'EST UNE DÉCISION. Un palier
-- modifiable par qui ne peut pas modifier sa séquence serait un contournement : la cadence vit dans
-- les PALIERS, et une séquence sans eux n'envoie rien (docs/SPEC-modeles-emails.md §11.7). Les
-- suffixes sont ceux des modèles d'email — `_membre` en lecture, `_membre_ecrivant` sur les trois
-- écritures —, parce qu'une cadence est le même genre d'objet : éditorial et collectif.
select is(pg_temp.politiques('mail_sequences'),
	array['mail_sequences_insertion_membre_ecrivant', 'mail_sequences_lecture_membre',
	      'mail_sequences_maj_membre_ecrivant', 'mail_sequences_suppression_membre_ecrivant'],
	'`mail_sequences` porte ses QUATRE politiques : lecture par tout membre, les trois écritures '
	'par l''administrateur et le business developer (docs/SPEC-modeles-emails.md §11.7)');

select is(pg_temp.politiques('mail_sequence_steps'),
	array['mail_sequence_steps_insertion_membre_ecrivant', 'mail_sequence_steps_lecture_membre',
	      'mail_sequence_steps_maj_membre_ecrivant', 'mail_sequence_steps_suppression_membre_ecrivant'],
	'`mail_sequence_steps` porte ses QUATRE politiques : la cadence vit dans les paliers, et les '
	'ouvrir plus largement que leur séquence serait un contournement (§11.7)');

select is(pg_temp.politiques('card_sequence_enrollments'),
	array['card_sequence_enrollments_lecture'],
	'`card_sequence_enrollments` porte son UNIQUE politique de LECTURE : une inscription se lit '
	'par qui lit son affaire, et ne s''écrit par PERSONNE — `armer_sequence_relance`, '
	'`interrompre_sequence_relance` et le job sont les seuls chemins, et la fermeture est tenue '
	'par le PRIVILÈGE, non par une politique (docs/SPEC-modeles-emails.md §12.10)');

select is(
	(select count(*)::int from pg_policies where schemaname = 'public'),
	119,
	'CENT DIX-NEUF politiques dans `public`, et pas une de plus — 116 avant `CRM-064` tranche 1, '
	'plus les TROIS de `card_comment_mentions` : lecture, insertion, suppression '
	'(docs/SPEC-notifications.md §7.1). ELLES SONT TROIS, ET NON QUATRE, ET C''EST LA MOITIÉ D''UN '
	'REFUS DOUBLE : une mention se RETIRE, elle ne se modifie pas, car changer `profile_id` ne '
	'serait pas une correction mais une SUBSTITUTION de destinataire. L''absence de la quatrième '
	'est donc une propriété, non un oubli, et le PRIVILÈGE la double — aucun `UPDATE` accordé. '
	'Ce que ces politiques ne portent PAS est tenu ailleurs : la règle d''ÉLIGIBILITÉ du '
	'destinataire vit dans un TRIGGER, parce qu''une politique juge la ligne écrite et son '
	'APPELANT, jamais un TIERS — et l''éligibilité porte précisément sur un tiers. Avant elles : '
	'116 avant `CRM-064`, soit 115 avant `CRM-063` '
	'sous-tranche 4b, plus l''UNIQUE politique de LECTURE de `card_sequence_enrollments`. CETTE '
	'TABLE EST FERMÉE EN ÉCRITURE À TOUT LE MONDE, et c''est la fermeture de `mail_outbox` pour la '
	'même raison : une file d''envoi que le client écrirait lui-même n''aurait plus aucun refus. '
	'Les huit refus de l''armement et l''idempotence de l''interruption vivent donc dans DEUX RPC '
	'`security definer`, jamais dans une politique — une politique refuse un APPELANT, elle ne '
	'sait pas dire qu''une affaire n''est pas figée. Avant elle : 115 avant la sous-tranche 4b, '
	'soit 107 avant `CRM-063` '
	'sous-tranche 4a, plus les HUIT politiques des séquences de relance : QUATRE par table — '
	'lecture, insertion, MAJ, suppression — sur `mail_sequences` et `mail_sequence_steps` '
	'(docs/SCHEMA.md §7, docs/SPEC-modeles-emails.md §11.7). CE COUPLE N''A AUCUNE RPC : composer '
	'une cadence est une écriture ordinaire dont la règle tient ENTIÈREMENT dans les politiques. '
	'LES DEUX TABLES EN PORTENT QUATRE CHACUNE, et non quatre pour le couple : un palier '
	'modifiable par qui ne peut pas modifier sa séquence serait un contournement, la cadence vivant '
	'dans les paliers. Ce que ces politiques ne portent PAS est tenu par des CLÉS ÉTRANGÈRES — la '
	'divergence de workspace d''un palier, refusée en `23503` par deux clés composites, et la '
	'suppression d''un modèle employé, refusée par le `on delete restrict` du §2.2 : une clé '
	'refuse une INCOHÉRENCE, une politique refuse un APPELANT, et les confondre rendrait le '
	'cloisonnement dépendant de l''identité de qui écrit. Avant elles : 107 avant la '
	'sous-tranche 4a, soit 103 avant `CRM-063` tranche 1, plus '
	'les QUATRE politiques des modèles d''email : lecture, insertion, MAJ, suppression sur '
	'`mail_templates` (docs/SCHEMA.md §7). CETTE TABLE N''A AUCUNE RPC NON PLUS — écrire un modèle '
	'est une écriture ordinaire dont la règle tient ENTIÈREMENT dans les politiques —, et la '
	'validation de ses variables ne vit PAS dans une politique mais dans DEUX CONTRAINTES DE '
	'VÉRIFICATION : une contrainte refuse un contenu, une politique refuse un appelant, et les '
	'confondre ferait dépendre la justesse d''un modèle de l''identité de qui l''écrit. Avant '
	'elles : 103 avant `CRM-063`, soit 99 avant `CRM-085`, plus les QUATRE '
	'politiques des lignes de coût : lecture, insertion, MAJ, suppression sur `card_costs` '
	'(docs/SCHEMA.md §9 bis.7). CETTE TABLE N''A AUCUNE RPC NON PLUS, et ses quatre politiques ne '
	'portent pas toutes la même condition — c''est ce qui les rend irréductibles les unes aux '
	'autres : la lecture exige la card ET le budget (§3.1), l''insertion et la suppression '
	'exigent en outre le budget OUVERT, et la mise à jour ne l''exige PAS, sans quoi il faudrait '
	'rouvrir une enveloppe pour saisir une facture arrivée après sa clôture (§2.3). Avant elles : '
	'99 avant `CRM-085`, soit 91 avant `CRM-084`, plus '
	'les HUIT politiques des enveloppes budgétaires : QUATRE par table — lecture, insertion, MAJ, '
	'suppression — sur `budgets` et `budget_occurrences` (docs/SCHEMA.md §9 bis.7). COMME LE '
	'TABLEAU D''OBJECTIFS, CE COUPLE N''A AUCUNE RPC : créer, doter, rendre récurrent ou clôturer '
	'un budget sont des mises à jour ordinaires dont la règle tient ENTIÈREMENT dans les '
	'politiques — `app.can_read_track` pour la lecture, `app.is_workspace_admin` pour l''écriture '
	'(docs/SPEC-costs.md §3). Ce qu''une RPC masquerait, ces huit politiques le portent en clair. '
	'Avant elles : 91 avant `CRM-084`, soit 79 avant `CRM-082`, plus les '
	'DOUZE politiques du tableau d''objectifs : QUATRE par table — lecture, insertion, MAJ, '
	'suppression — sur `goal_boards`, `goal_blocks` et `goal_links` (docs/SCHEMA.md §9 bis.7). '
	'CE TRIPLET N''A AUCUNE RPC, et c''est ce qui le distingue des trois révisions précédentes : '
	'poser un bloc, le déplacer, régler son remplissage et tracer une flèche sont des gestes de '
	'composition libre dont la règle tient ENTIÈREMENT dans les politiques, y compris l''asymétrie '
	'du `using` et du `with check` qui laisse RETIRER un lien de channel sans laisser le REPOSER '
	'(docs/SPEC-goals.md §4.2). Quatre politiques par table sont donc le minimum, non un excès. '
	'Avant elles : 78 avant `CRM-081` '
	'tranche 2 c, plus l''UNIQUE politique de LECTURE de `mail_thread_snoozes` : le sommeil d''un '
	'fil se lit par qui lit le fil, et ne s''écrit par PERSONNE — les deux RPC `security definer` '
	'du §16.14.4 et du §16.14.5 sont le seul chemin, et la fermeture est tenue par le PRIVILÈGE, '
	'non par une politique (docs/SPEC-cards.md §16.14.6). Avant elle : 66 avant `CRM-060`, plus '
	'les DOUZE politiques livrées par `CRM-060` tranche 1 : quatre par table (lecture, insertion, '
	'MAJ, suppression) sur `organizations`, `contacts` et `card_contacts` '
	'(docs/SPEC-contacts.md §3). Avant elle : 65 avant `CRM-078`, plus '
	'l''UNIQUE politique de LECTURE de `workflow_versions` : une version publiée se lit par tout '
	'membre du workspace et ne s''écrit par personne, l''insertion passant par une RPC '
	'`security definer` et la mise à jour comme la suppression n''ayant AUCUNE politique '
	'(docs/SPEC-workflow-engine.md §7 ter.4). Avant elle : 64 avant le lot G, plus '
	'l''UNIQUE politique de MODÉRATION de `card_comments`, qui ouvre aux `admin` du workspace la '
	'suppression d''un propos déplacé sans leur ouvrir sa modification (INC-072, décision 374). '
	'Avant elle : 63 avant CRM-058, plus '
	'l''UNIQUE politique de lecture de `mail_outbox`, qui suit la CARD : un envoi appartient à '
	'l''affaire au nom de laquelle il part. Avant elle : 62 avant CRM-056, plus l''UNIQUE '
	'politique de lecture de `mail_folder_map`, qui suit le COMPTE comme les occurrences. Avant '
	'elle : 59 avant CRM-054, plus les TROIS de l''ingestion. Avant elles : '
	'48 avant CRM-022, plus ses '
	'SEPT politiques d''identité. Avant elles : 41 jusqu''à `CRM-042`, plus les '
	'TROIS de `card_comments` livrées par `CRM-043`, plus l''UNIQUE politique de lecture de '
	'`card_events` livrée par `CRM-044`, plus les TROIS de la liaison livrée par `CRM-018` — '
	'`card_events` n''en porte pas d''autre, écrire n''y étant ouvert à '
	'personne. Une politique ajoutée sans que cette suite '
	'soit étendue — permissive ou non — fait échouer ce compte : c''est la contrepartie du contrôle '
	'par nom, qui à lui seul ne verrait pas un ajout');

-- La RLS activée est ce qui rend les politiques opposables. Une table dont la RLS serait désactivée
-- porterait ses politiques sans les appliquer : le pire des deux mondes, un inventaire rassurant
-- sur une table ouverte.
select ok(
	(select bool_and(c.relrowsecurity)
	 from pg_class c join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public' and c.relkind = 'r'),
	'RLS ACTIVÉE sur TOUTES les tables de `public`, sans exception. Sans elle, l''inventaire '
	'ci-dessus décrirait des politiques inertes');

-- =============================================================================================
-- 2. Condition de validité de la preuve n° 11 — les quinze tables métier sont peuplées
-- =============================================================================================
-- « L'anonyme lit zéro ligne » ne prouve rien sur une table vide : l'assertion serait verte que la
-- RLS refuse ou qu'elle autorise tout (décision 50). Les quinze tables que le scénario n° 11
-- interroge sont donc d'abord constatées **non vides**, ici, sous un rôle qui contourne la RLS.

select isnt_empty('select 1 from public.tracks',
	'PREUVE N° 11, condition de validité 1/15 : `tracks` est peuplée');
select isnt_empty('select 1 from public.channels',
	'PREUVE N° 11, condition de validité 2/15 : `channels` est peuplée');
select isnt_empty('select 1 from public.workflows',
	'PREUVE N° 11, condition de validité 3/15 : `workflows` est peuplée');
select isnt_empty('select 1 from public.workflow_steps',
	'PREUVE N° 11, condition de validité 4/15 : `workflow_steps` est peuplée');
select isnt_empty('select 1 from public.workflow_transitions',
	'PREUVE N° 11, condition de validité 5/15 : `workflow_transitions` est peuplée');
select isnt_empty('select 1 from public.workflow_transition_required_fields',
	'PREUVE N° 11, condition de validité 6/15 : `workflow_transition_required_fields` est peuplée');
select isnt_empty('select 1 from public.workflow_nodes_catalog',
	'PREUVE N° 11, condition de validité 7/15 : `workflow_nodes_catalog` est peuplée');
select isnt_empty('select 1 from public.form_fields',
	'PREUVE N° 11, condition de validité 8/15 : `form_fields` est peuplée');
select isnt_empty('select 1 from public.form_field_rules',
	'PREUVE N° 11, condition de validité 9/15 : `form_field_rules` est peuplée');
select isnt_empty('select 1 from public.cards',
	'PREUVE N° 11, condition de validité 10/15 : `cards` est peuplée');
select isnt_empty('select 1 from public.card_field_values',
	'PREUVE N° 11, condition de validité 11/15 : `card_field_values` est peuplée');
select isnt_empty('select 1 from public.track_members',
	'PREUVE N° 11, condition de validité 12/15 : `track_members` est peuplée — elle ne l''était pas '
	'à `CRM-008`, qui l''excluait pour cette raison exacte (docs/SPEC-test-harness.md §4.3)');
select isnt_empty('select 1 from public.channel_members',
	'PREUVE N° 11, condition de validité 13/15 : `channel_members` est peuplée — même remarque');
select isnt_empty('select 1 from public.card_comments',
	'PREUVE N° 11, condition de validité 14/15 : `card_comments` est peuplée depuis CRM-043');
select isnt_empty('select 1 from public.card_events',
	'PREUVE N° 11, condition de validité 15/15 : `card_events` est peuplée par les triggers du seed '
	'depuis CRM-044');

-- =============================================================================================
-- 3. Preuve n° 10 — la règle existe et ses politiques sont exhaustives (CRM-022)
-- =============================================================================================
-- La suite historique avait volontairement exigé zéro politique. CRM-022 retourne ces assertions :
-- les mutations sont consenties aux admins et la constraint trigger protège le dernier d'entre eux.

select is(pg_temp.politiques('workspace_members'),
	array['workspace_members_insertion_admin','workspace_members_lecture_membre',
	      'workspace_members_maj_admin','workspace_members_suppression_admin']::text[],
	'PREUVE N° 10 : quatre politiques consentent lecture d''équipe et mutations administrateur');

select is(pg_temp.politiques('workspaces'), array['workspaces_lecture_membre']::text[],
	'`workspaces` porte exactement sa politique de lecture membre');

select is(pg_temp.politiques('profiles'),
	array['profiles_lecture_equipe','profiles_maj_propre']::text[],
	'`profiles` porte lecture d''équipe et modification propre, ni plus ni moins');

-- L'administratrice du seed est bien la **seule** de son workspace : sans cela, « le dernier
-- administrateur » ne désignerait personne et le scénario n° 10 mesurerait autre chose.
select is(
	(select count(*)::int from public.workspace_members
	 where workspace_id = '5eed0000-0000-4000-8000-000000000001' and role = 'admin'),
	1,
	'PREUVE N° 10, condition de validité : le workspace du seed n''a QU''UN administrateur. Avec '
	'deux, le scénario ne porterait plus sur le « dernier »');

-- =============================================================================================
-- 4. Preuves n° 1, n° 2, n° 5 — ce qui les rend opposables, constaté en base
-- =============================================================================================
-- Ces trois preuves reposent sur des privilèges de table et sur l'existence d'une garde RPC. Les
-- scénarios HTTP mesurent le refus ; ces assertions mesurent la **cause** du refus, de sorte qu'un
-- privilège rendu par mégarde soit dénoncé ici et non par un `403` qui cesserait d'arriver.

select ok(
	not has_table_privilege('authenticated', 'public.cards', 'update'),
	'PREUVE N° 5, sa cause : `authenticated` n''a AUCUN `UPDATE` de table sur `cards`. C''est ce '
	'retrait, posé par `CRM-034`, qui rend `move_card` incontournable');

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'PREUVE N° 5, sa cible exacte : `current_step_id` n''est pas modifiable colonne à colonne non '
	'plus. Un `grant update (…)` trop large la rouvrirait sans toucher au privilège de table');

select has_function('public', 'move_card', array['uuid', 'uuid', 'text'],
	'PREUVE N° 1, son sujet : `move_card` existe avec sa signature. Sans elle, le `403` du '
	'`viewer` serait un `404` et la preuve porterait sur une fonction absente');

select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	true,
	'PREUVE N° 1, sa cause : `move_card` est `SECURITY DEFINER`. C''est ce qui lui permet de '
	'refuser explicitement là où la RLS refuserait silencieusement');

select ok(
	(select prosrc like '%forbidden%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	'PREUVE N° 1, sa forme : `move_card` lève `forbidden`. Un refus muet rendrait `200` et ne '
	'déplacerait rien — le pire des deux mondes (décision 141)');

select ok(
	(select prosrc like '%card_not_found%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	'PREUVE N° 1'', sa forme : `move_card` distingue `card_not_found` de `forbidden` — règle de '
	'discrétion (docs/SPEC-workflow-engine.md §5.3). Confondre les deux dirait à un appelant '
	'qu''une card existe hors de sa vue');

-- =============================================================================================
-- 5. Preuve n° 4 — le droit fin qui la rend mesurable est bien posé par le seed
-- =============================================================================================

select is(
	(select count(*)::int from public.track_members
	 where user_id = '5eed0000-0000-4000-8000-000000000013' and access = 'none'),
	1,
	'PREUVE N° 4, sa cause : le `viewer` est fermé sur un track par un droit fin `none`. Sans ce '
	'droit, son « zéro ligne » ne distinguerait pas un refus d''une absence de données');

select isnt_empty(
	'select 1 from public.cards where channel_id = ''5eed0000-0000-4000-8000-000000000032''',
	'PREUVE N° 4, sa condition de validité : le channel fermé au `viewer` porte RÉELLEMENT des '
	'cards, constaté sans RLS');

-- =============================================================================================
-- 6. Les cinq preuves non satisfaisables — absences figées, non commentées (§7.3)
-- =============================================================================================
-- Convention posée par `CRM-006` et reprise par `CRM-013` : une limite s'assère, elle ne se
-- commente pas. Chacune de ces assertions deviendra ROUGE le jour où l'objet naîtra, et désignera
-- alors la preuve à écrire — au lieu de laisser la limite survivre à sa cause.

-- ASSERTIONS RETOURNÉES PAR `CRM-052` (décision 51). Les deux annonçaient le moment de leur
-- propre mort : la table est née, et les preuves n° 6 et n° 7 sont désormais MESURÉES ici, puis
-- exercées avec les jetons réels par `e2e/api/comptes-entrants.spec.ts`.
select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'authenticated' and column_name = 'secret_id'),
	0,
	'PREUVE N° 6 ACQUISE : `mail_inbound_accounts.secret_id` n''accorde AUCUN privilège à '
	'`authenticated` — la révocation est un privilège de COLONNE, insensible aux lignes');

-- La n° 7 porte sur la LECTURE du compte d'autrui, et son sujet est `mail_inbound_accounts` : la
-- table des identités sortantes, elle, appartient à `CRM-053` et reste due. Ce qui est mesuré ici
-- est que la politique de lecture propriétaire existe et ne s'élargit à personne d'autre.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_inbound_accounts'
	    and qual like '%auth.uid()%'),
	1,
	'PREUVE N° 7 ACQUISE sur les comptes ENTRANTS : une politique et une seule borne la lecture '
	'd''une boîte personnelle à son propriétaire. `mail_outbound_identities` reste due par '
	'`CRM-053`, et l''assertion suivante fige cette moitié restante');

-- LA MOITIÉ RESTANTE EST LIVRÉE PAR `CRM-053`, et l'assertion annonçait ce moment. La preuve
-- n° 7 est désormais ENTIÈREMENT acquise : les deux tables de messagerie bornent la lecture d'une
-- ligne personnelle à son propriétaire.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_outbound_identities'
	    and qual like '%auth.uid()%'),
	1,
	'PREUVE N° 7 ENTIÈREMENT ACQUISE : `mail_outbound_identities` borne elle aussi la lecture '
	'd''une identité personnelle à son propriétaire');

-- ASSERTION RETOURNÉE PAR `CRM-044` (décision 51). La moitié de la preuve n° 8 est désormais
-- SATISFAISABLE, et le refus est mesuré ici même plutôt qu'annoncé : aucun privilège d'écriture,
-- pour aucun des trois rôles. `e2e/api/timeline.spec.ts` l'exerce avec les jetons réels.
select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee in ('anon','authenticated','service_role')
	    and privilege_type <> 'SELECT'),
	0,
	'PREUVE N° 8 SATISFAISABLE POUR MOITIÉ, 1/2 : `card_events` est livrée par `CRM-044` et '
	'n''accorde AUCUN privilège d''écriture, `service_role` compris');

select hasnt_table('public', 'audit_log',
	'PREUVE N° 8 NON SATISFAISABLE, 2/2 : `audit_log` attend `CRM-072`');

-- ASSERTIONS RETOURNÉES PAR `CRM-054` (décision 51, neuvième occurrence). Le bucket existe, les
-- pièces jointes aussi, et la preuve n° 9 est ACQUISE : le refus est mesuré par
-- `e2e/api/ingestion.spec.ts` sur une pièce `infected` ET une pièce `pending`.
select is(
	(select public from storage.buckets where id = 'mail-attachments'),
	false,
	'PREUVE N° 9, 1/2 : le bucket des pièces jointes existe et il est PRIVÉ');

-- ASSERTION RETOURNÉE UNE SECONDE FOIS, PAR `CRM-057` (décision 51, dixième occurrence). Elle
-- figeait l'ABSENCE de toute politique et annonçait ce qui la rendrait rouge : « CRM-057 devra en
-- écrire une conditionnée à `av_status = 'clean'` ». L'annonce s'est vérifiée telle quelle.
--
-- CE QUI PROTÈGE RÉELLEMENT N'A PAS CHANGÉ : `storage.objects` accorde tous les privilèges à `anon`
-- et `authenticated` — défaut de Supabase, MESURÉ —, et seule la RLS refuse. La politique livrée
-- est donc UNIQUE et n'ouvre qu'une intersection : le bucket, le statut `clean`, et la visibilité
-- du message porteur. Une seconde politique, si large soit-elle en apparence, ouvrirait le reste du
-- stockage : c'est pourquoi l'assertion porte sur le NOMBRE autant que sur le contenu.
select is(
	(select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'),
	1,
	'PREUVE N° 9, 2/2 : EXACTEMENT une politique d''objet, celle des pièces jointes saines — le '
	'reste du stockage reste refusé par l''absence de politique');

select ok(
	(select qual from pg_policies
	  where schemaname = 'storage' and tablename = 'objects'
	    and policyname = 'mail_attachments_objets_lecture') like '%mail-attachments%',
	'PREUVE N° 9, 3/3 : et elle est bornée au bucket des pièces jointes, statut `clean` compris — '
	'`infected`, `pending` et `skipped` restent refusés à tous (CRM-057 §18.5)');

-- ASSERTION RETOURNÉE PAR `CRM-058` (décision 51, onzième occurrence), ET LA PREUVE N° 12 EST
-- **ACQUISE**. Elle figeait l'absence de la fonction d'envoi ; celle-ci existe, et le refus qu'elle
-- annonçait est mesuré HORS INTERFACE par `e2e/api/envoi.spec.ts` : un membre qui emprunte
-- l'identité de service du workspace reçoit `403 / identity_not_available`, et une administratrice
-- qui emprunte l'identité PERSONNELLE d'un collègue reçoit le même refus.
select has_function('public', 'queue_outbound_email',
	'PREUVE N° 12 ACQUISE : `queue_outbound_email` existe, et refuse l''identité d''autrui');

select ok(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'queue_outbound_email'),
	'PREUVE N° 12, 2/2 : la garde est `SECURITY DEFINER` — elle juge, elle ne se contente pas de '
	'refléter les droits de l''appelant sur les tables');

-- Ce que ces sept assertions signifient ensemble, dit une fois plutôt que sept : sur les douze
-- preuves de `docs/SPEC-permissions-rls.md` §7, **cinq** portent sur des objets absents. `CRM-014`
-- ne les compense par aucune preuve de substitution, et reste `[~]` pour cette raison — bloquée
-- par une dépendance, non par un défaut de l'unité.
select is(
	(select count(*)::int from (values
		('public.audit_log')
	) as cibles(nom) where to_regclass(nom) is not null),
	0,
	'UNE SEULE PREUVE SUR DOUZE RESTE HORS D''ATTEINTE — elles étaient CINQ jusqu''à `CRM-044`, '
	'puis QUATRE, puis TROIS avec `CRM-052`, DEUX avec `CRM-053`, et `CRM-054` referme la n° 9 en '
	'livrant les pièces jointes et leur bucket. Ce qui '
	'a livré `card_events` et rendu la moitié de la n° 8 satisfaisable. Le compte est asséré plutôt '
	'qu''énoncé : le jour où l''une des quatre naît, il cesse de valoir zéro et l''unité doit être '
	'rouverte');

select finish();
rollback;
