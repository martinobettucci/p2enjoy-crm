// @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration : la présentation PARTAGÉE de
//       l'énumération, entre l'écran de corbeille et la confirmation du geste
// @spec docs/SPEC-corbeille.md §3.5 (la composition ne rend aucun texte), §4.4 (les trois états de
//       l'énumération dans l'écran), §4 bis.3 (les mêmes trois états dans la confirmation)
// @spec docs/DESIGN_SYSTEM.md §5.15 (un blanc se lirait comme un zéro), §5.16 (la corbeille)
// @spec CLAUDE.md §23 (singulier et pluriel sont deux clés, jamais une concaténation)
//
// POURQUOI CE MODULE EXISTE. La septième tranche donne un SECOND appelant à l'énumération : la
// confirmation du geste de mise à la corbeille (§4 bis.3) affiche exactement ce que la colonne
// « Retient avec lui » de l'écran de corbeille affiche déjà. Recopier les deux — le type des trois
// états et le choix de la clé singulier/pluriel — aurait laissé deux écrans diverger sur le même
// fait, ce qui est précisément la duplication que `CLAUDE.md` §3 proscrit.
//
// Ce module NE REND AUCUN COMPOSANT : les deux surfaces n'affichent pas la même forme — une cellule
// de tableau d'un côté, une liste dans le flux de la confirmation de l'autre. Ce qu'elles partagent
// est le vocabulaire, pas la mise en page.

import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import type { LigneEnumeration } from '../lib/corbeille'

/**
 * L'énumération d'un objet parent, dans ses trois états distincts.
 *
 * Ils ne se confondent pas : un compte, « en cours de mesure », et « n'a pas pu être mesuré ». Un
 * blanc se lirait comme un zéro — règle posée par `docs/DESIGN_SYSTEM.md` §5.15 pour la
 * prévisualisation d'exigence, et reprise ici pour la même raison.
 */
export type EtatEnumeration =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'echec' }
	| { readonly statut: 'pret'; readonly lignes: readonly LigneEnumeration[] }

/**
 * Le texte d'une ligne d'énumération, singulier et pluriel étant DEUX CLÉS distinctes du catalogue.
 *
 * Le module `lib/corbeille.ts` ne rend aucun texte : il rend un type et un compte, et le choix de la
 * clé appartient à la présentation (`CLAUDE.md` §23). Une phrase construite par concaténation
 * figerait ici l'ordre des mots du français.
 */
export function texteLigneEnumeration(ligne: LigneEnumeration): string {
	const cle: CleTraduction =
		ligne.type === 'channels'
			? ligne.compte === 1
				? 'admin.trash.holds.channels.one'
				: 'admin.trash.holds.channels.many'
			: ligne.compte === 1
				? 'admin.trash.holds.cards.one'
				: 'admin.trash.holds.cards.many'
	return t(cle, { compte: String(ligne.compte) })
}
