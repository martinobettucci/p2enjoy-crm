// @spec CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1 : la règle
//       n'a qu'UNE déclaration, atteignable des deux côtés
// @spec CRM-041 (docs/BACKLOG.md) — pastille d'ancienneté du board, d'où ces trois fonctions sont
//       extraites sans changer un caractère de leur comportement
// @spec docs/SPEC-relances.md §2.1 (pourquoi la règle descend en base, et pourquoi les deux
//       définitions doivent rester identiques), §2.2 (seuil effectif), §2.5 (jours révolus, borne
//       large)
// @spec docs/SPEC-workflow-engine.md §3.3 (résolution du seuil), §7.4 (pastille d'ancienneté)
// @spec docs/SCHEMA.md §9 bis.9 (`public.cards_figees`, la MÊME règle en SQL)
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// La règle « cette affaire est figée » existe désormais à DEUX endroits : ici, pour la pastille du
// board, qui qualifie une carte déjà téléchargée ; et en SQL, dans `public.cards_figees()`, pour
// l'ordonnanceur et pour l'écran qui listera ces affaires sans télécharger tout le pipeline. Le §2.1
// de `docs/SPEC-relances.md` explique pourquoi les deux sont nécessaires — et exige qu'elles rendent
// TOUJOURS le même verdict.
//
// Cette exigence n'est pas tenable si la moitié TypeScript vit à l'intérieur de `board.ts` : ce
// module importe `./supabase`, et la preuve d'API appartient à un autre projet TypeScript
// (`tsconfig.tools.json`), qui n'a ni `vite/client` ni les types du DOM — l'importer depuis `e2e/`
// fait échouer la compilation, ce qui est MESURÉ et écrit dans `colonnes-board.ts`.
//
// La règle descend donc dans un module sans aucune importation, dont `board.ts` se sert et que la
// preuve d'API peut lire. C'est le procédé déjà retenu par `CRM-041` pour ses quatre chaînes
// `select` (`colonnes-board.ts`) et par `CRM-037` pour son tableau de cas partagé
// (`valeur-renseignee.ts`) : UNE seule déclaration, atteignable des deux côtés. La recopier dans la
// preuve aurait prouvé qu'une règle quelconque coïncide avec le SQL, pas que **celle du produit**
// coïncide.

/** Un jour en millisecondes. Recopié de `board.ts`, d'où ce module l'extrait. */
export const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000

/**
 * Le seuil de relance **effectif** d'une étape : le sien s'il est posé, sinon celui de son nœud.
 *
 * **UN SEUIL ABSENT NE DEVIENT JAMAIS UN SEUIL PAR DÉFAUT** (`docs/SPEC-relances.md` §2.2). Le §5.1
 * du design system parle du « seuil de relance » ; en inventer un serait une règle de produit que
 * personne n'a prise. MESURÉ : l'étape `Livré` du seed n'en porte aucun, et ses affaires ne sont
 * donc jamais figées.
 *
 * `undefined` est traité comme `null` : le nœud embarqué peut manquer (`board.ts`), et le type
 * généré ne garantit aucune valeur (`docs/SPEC-types.md`).
 */
export function seuilEffectif(
	seuilEtape: number | null | undefined,
	seuilNoeud: number | null | undefined,
): number | null {
	return seuilEtape ?? seuilNoeud ?? null
}

/**
 * L'ancienneté dans l'étape, en **jours révolus** et jamais négative.
 *
 * `Math.floor`, et non un arrondi : « six jours et vingt-trois heures » est six jours, pas sept.
 * C'est le même compte que `floor(extract(epoch from now() - entered_step_at) / 86400)` en SQL, et
 * l'égalité des deux est ce que la preuve de cohérence mesure.
 *
 * Une date que `Date` ne sait pas lire rend **zéro** plutôt qu'un `NaN` propagé : une carte dont
 * l'horodatage est illisible n'est pas « en retard depuis toujours ».
 */
export function joursDansEtape(entreeIso: string, maintenant: Date): number {
	const entree = new Date(entreeIso).getTime()
	const jours = Math.floor((maintenant.getTime() - entree) / MILLISECONDES_PAR_JOUR)
	return Number.isFinite(jours) ? Math.max(jours, 0) : 0
}

/**
 * La borne, et elle est **large** (`docs/SPEC-relances.md` §2.5).
 *
 * Un seuil nul n'est jamais dépassé. Écrire `>` plutôt que `>=` ferait diverger la pastille du board
 * et la relance de la base d'une journée entière, et personne ne saurait laquelle a raison.
 */
export function ancienneteDepassee(joursRevolus: number, seuil: number | null): boolean {
	return seuil !== null && Number.isFinite(joursRevolus) && joursRevolus >= seuil
}
