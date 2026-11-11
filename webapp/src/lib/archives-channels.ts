// @spec CRM-134 (docs/BACKLOG.md) tranche T1 — archiver un channel depuis sa vue, et le groupe « Archivés » de la barre
//       d'onglets : l'état déplié porté par l'adresse, la vue après un archivage, le focus après un désarchivage
// @spec docs/SPEC-channels.md §11.2 (après la réussite : le channel suivant, à défaut le précédent, à défaut la racine),
//       §11.3 (le groupe, `archives=1`, le lien hors de la vue d'un track, le focus après un désarchivage) ;
//       docs/DESIGN_SYSTEM.md §5.101 ; CLAUDE.md §11 (une préférence d'écran, ni cookie ni stockage) ; décision 919
//
// Ce module ne rend rien et n'écrit rien : il calcule des adresses et des cibles, et ses règles se vérifient sans
// navigateur. L'écriture est celle de Réglages, `archiverChannel` (`administration-arborescence.ts`).

import { estVueTrack } from './nouveau-channel'

/** Le paramètre d'adresse qui déplie le groupe « Archivés » — une préférence d'écran, jamais persistée (§11.3). */
export const PARAM_ARCHIVES = 'archives'
export const VALEUR_ARCHIVES = '1'

/** L'identifiant du panneau des archivés, que la commande du groupe désigne par `aria-controls`. */
export const ID_PANNEAU_ARCHIVES = 'panneau-archives-channels'

/** Ce qu'il faut savoir d'un channel pour décider de la suite : son identifiant et son slug. */
type Repere = { readonly id: string; readonly slug: string }

/** Vrai si l'adresse déplie le groupe. */
export function archivesDepliees(parametres: URLSearchParams): boolean {
	return parametres.get(PARAM_ARCHIVES) === VALEUR_ARCHIVES
}

/**
 * La recherche de l'adresse, groupe déplié ou replié, les AUTRES paramètres conservés — la vue liste garde sa page et
 * ses filtres, comme pour « Nouveau channel ». Rendue sans `?`, vide si plus rien ne reste.
 */
export function rechercheAvecArchives(recherche: string, deplier: boolean): string {
	const parametres = new URLSearchParams(recherche)
	if (deplier) parametres.set(PARAM_ARCHIVES, VALEUR_ARCHIVES)
	else parametres.delete(PARAM_ARCHIVES)
	return parametres.toString()
}

/**
 * L'adresse du groupe HORS de la vue d'un track (la fiche d'une affaire, les coûts) : la racine du track, groupe déplié.
 * Sur la vue d'un track, le groupe est un bouton et n'a pas d'adresse (§11.3).
 */
export function cheminArchivesTrack(slugTrack: string): string {
	return `/tracks/${slugTrack}?${PARAM_ARCHIVES}=${VALEUR_ARCHIVES}`
}

/** Le groupe est-il un bouton (vue d'un track) ou un lien (ailleurs) ? */
export function groupeEstUnBouton(chemin: string): boolean {
	return estVueTrack(chemin)
}

/**
 * Le channel où la vue passe après l'archivage de `idArchive` (§11.2) : le channel actif qui le suivait dans l'ordre des
 * onglets, à défaut celui qui le précédait, à défaut aucun — la vue va alors à la racine du track. `channels` est la
 * liste des onglets AVANT l'archivage, archivé compris.
 */
export function channelApresArchivage<C extends Repere>(channels: readonly C[], idArchive: string): C | null {
	const rang = channels.findIndex((channel) => channel.id === idArchive)
	if (rang === -1) return channels[0] ?? null
	return channels[rang + 1] ?? channels[rang - 1] ?? null
}

/** Où le focus va après un désarchivage (§11.3). */
export type FocusApresDesarchivage =
	| { readonly cible: 'desarchiver'; readonly id: string }
	| { readonly cible: 'onglet'; readonly slug: string }

/**
 * Le « Désarchiver » suivant du panneau, à défaut le précédent ; le dernier archivé rendu, l'onglet du channel rendu —
 * le panneau et le groupe disparaissent avec lui. `archives` est la liste du panneau AVANT le désarchivage.
 */
export function focusApresDesarchivage(archives: readonly Repere[], rendu: Repere): FocusApresDesarchivage {
	const rang = archives.findIndex((channel) => channel.id === rendu.id)
	const voisin = rang === -1 ? undefined : (archives[rang + 1] ?? archives[rang - 1])
	return voisin === undefined ? { cible: 'onglet', slug: rendu.slug } : { cible: 'desarchiver', id: voisin.id }
}
