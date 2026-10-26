// @spec CRM-062 (docs/BACKLOG.md) — tranche 3c : la chaîne `select` de la SECONDE lecture
// @spec docs/SPEC-relances.md §10.5 (les deux lectures, et les deux désambiguïsations mesurées)
// @spec docs/SPEC-types.md §4 (un type ne garantit jamais une valeur)
// @spec CRM-111 T2.4.1 (docs/BACKLOG.md) — les colonnes de la seconde lecture, sur `card_placements` (docs/SPEC-rattachements.md §5)
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// La chaîne `select` de la seconde lecture doit être exercée des DEUX côtés : par le test unitaire,
// qui vérifie la requête que le module de composition construit, et par la preuve d'API, qui
// vérifie que la pile réelle rend bien ce que ces colonnes demandent. Or la preuve d'API appartient
// à un autre projet TypeScript (`tsconfig.tools.json`), qui n'a ni `vite/client` ni les types du
// DOM : importer `affaires-figees.ts` depuis `e2e/` fait échouer la compilation sur
// `webapp/src/lib/supabase.ts` — mesuré, et écrit dans `colonnes-board.ts` puis dans
// `carte-figee.ts`.
//
// La recopier dans la preuve aurait prouvé qu'une requête quelconque fonctionne, pas que **celle du
// produit** fonctionne. C'est le procédé retenu par `CRM-041` (`colonnes-board.ts`), par `CRM-037`
// (`valeur-renseignee.ts`) et par la tranche 1 de cette unité (`carte-figee.ts`) : UNE seule
// déclaration, atteignable des deux côtés.

/**
 * Ce que la seconde lecture demande, et **les deux désambiguïsations sont OBLIGATOIRES** — toutes
 * deux trouvées par l'erreur sur la pile réelle le 2026-08-24, jamais par la lecture du schéma.
 *
 `CRM-111` T2.4.1 : la seconde lecture porte sur les RATTACHEMENTS — `cards_figees()` en rend un par
 * ligne, une affaire rattachée à deux channels pouvant y figurer deux fois (docs/SPEC-rattachements.md
 * §6) —, et l'appariement se fait sur `card_id` et `channel_id`.
 *
 * `channels!card_placements_channel_fk` — `card_placements` porte **deux** clés étrangères vers
 * `channels`, `card_placements_channel_workflow_fk` et celle-ci. Un `channels(…)` nu rend `PGRST201`,
 * comme sur `cards` avant elle. La forme retenue est celle que `colonnes-ma-journee.ts` et
 * `card-costs.ts` emploient : une seule dans tout le produit.
 *
 * `workflow_steps!card_placements_step_fk` — l'étape courante du rattachement, nommée par sa clé.
 *
 * `workflow_steps(label_override, …)` — l'étape **n'a pas de colonne `label`**. Un
 * `workflow_steps(label)` rend :
 *
 * ```
 * 42703 — column workflow_steps_1.label does not exist
 * ```
 *
 * Le libellé d'une étape est `coalesce(label_override, workflow_nodes_catalog.label)`, exactement la
 * résolution de `resoudreEtape` dans `board.ts`. Le nœud est donc embarqué avec elle : le rapporter
 * séparément obligerait à une troisième requête et à un appariement que la base fait mieux.
 *
 * `card_id` et `channel_id` sont demandées bien qu'elles soient déjà connues : c'est la clé
 * d'appariement de la lecture, et une réponse sans elles serait inutilisable.
 */
export const COLONNES_RATTACHEMENT_FIGE =
	'card_id, channel_id, channels!card_placements_channel_fk(slug, name, tracks(slug, name)), ' +
	'workflow_steps!card_placements_step_fk(label_override, workflow_nodes_catalog(label))'
