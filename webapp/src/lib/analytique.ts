// @spec CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//       TRANCHE 2 b : le module qui lit l'agrégat et en dérive les deux grandeurs
// @spec docs/SPEC-analytique.md §5.1 (les quatorze colonnes rendues, le grain, l'ordre),
//       §5.2 (aucun paramètre de portée : les trois portées se déduisent par sommation),
//       §5.5 (une ligne n'existe que si elle est peuplée), §7.1 (taux de conversion des affaires
//       DÉCIDÉES, et l'INCONNU quand il n'y en a aucune), §7.2 (prévisionnel par devise),
//       §7.3 (ce que l'écran doit dire et qu'un total ne dit pas), §11.2 (aucune conversion de
//       devises)
// @spec docs/SCHEMA.md §9 bis.11 (contrat de `public.entonnoir_conversion`)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CE MODULE NE RECALCULE JAMAIS LA RÈGLE. La probabilité effective, les deux exclusions et le
// montant pondéré vivent dans `public.entonnoir_conversion()` (`docs/SPEC-analytique.md` §3 à §5),
// et pour la raison écrite au §5.2 : un écran qui les recalculerait devrait télécharger tout le
// portefeuille pour en écarter la quasi-totalité, ce que `CLAUDE.md` §21 interdit. Ce module
// **replie** ce que la base a déjà agrégé, et il en dérive deux rapports de nombres.
//
// POURQUOI CES DEUX GRANDEURS SONT ICI ET NON EN BASE (§7). Ce sont des rapports entre des nombres
// que la fonction rend déjà. Les calculer côté serveur imposerait une SECONDE définition à
// maintenir — et c'est exactement le mode de défaillance qu'INC-138, INC-241 et la décision 560 ont
// coûté au dépôt : une règle écrite deux fois diverge à la première évolution.
//
// AUCUNE ADDITION DE DEUX DEVISES, JAMAIS (§11.2). Aucun taux de change n'existe dans ce dépôt.
// Un total « toutes devises » serait un nombre que personne n'a arbitré, et il se lirait comme un
// chiffre d'affaires. Chaque devise garde donc le sien, comme les histogrammes de `CRM-086`.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Une ligne telle que `public.entonnoir_conversion()` la rend — les quatorze colonnes du §5.1.
 *
 * `node_label` est celui du CATALOGUE et jamais le `label_override` de l'étape : l'entonnoir compare
 * des affaires à travers les workflows, et le libellé d'étape ferait porter deux noms à une même
 * ligne dès que deux workflows renomment le même nœud. La base le garantit ; ce type le nomme.
 */
export type LigneEntonnoirLue = {
	readonly workspace_id: string
	readonly track_id: string
	readonly channel_id: string
	readonly node_id: string
	readonly node_key: string
	readonly node_label: string
	readonly node_kind: string
	readonly node_position: number
	readonly currency: string
	readonly affaires: number
	readonly affaires_sans_montant: number
	readonly affaires_sans_probabilite: number
	readonly montant: number
	readonly montant_pondere: number
}

/** Les trois genres du catalogue — `workflow_nodes_catalog.kind`, contraint en base. */
export type GenreNoeud = 'open' | 'won' | 'lost'

/**
 * La portée affichée. Elle N'EST PAS un paramètre du serveur (§5.2) : la fonction rend le grain le
 * plus fin, et les trois portées s'en déduisent par sommation. Un paramètre obligerait à choisir sa
 * portée avant de savoir ce que le backend consent, et l'écran ferait un appel par track.
 */
export type Portee =
	| { readonly type: 'workspace' }
	| { readonly type: 'track'; readonly id: string }
	| { readonly type: 'channel'; readonly id: string }

/** Une barre de l'entonnoir : un nœud du catalogue, dans une devise. */
export type NoeudEntonnoir = {
	readonly idNoeud: string
	readonly cle: string
	readonly libelle: string
	readonly genre: GenreNoeud
	readonly position: number
	readonly devise: string
	readonly affaires: number
	/**
	 * LES DEUX COMPTEURS D'ABSENCE NE SONT PAS DÉCORATIFS (§7.3). Sans eux, un prévisionnel bas se
	 * lit comme un portefeuille pauvre au lieu d'un portefeuille mal renseigné, et l'écran ne peut
	 * pas écrire la mention que le §7.3 lui impose.
	 */
	readonly affairesSansMontant: number
	readonly affairesSansProbabilite: number
	readonly montant: number
	readonly montantPondere: number
}

/** Le prévisionnel d'une devise — §7.2. */
export type PrevisionnelDevise = {
	readonly devise: string
	readonly montant: number
}

/**
 * Le taux de conversion des affaires DÉCIDÉES — §7.1.
 *
 * `taux` vaut `null` — INCONNU — lorsqu'aucune affaire n'est décidée, et **jamais** zéro : un taux
 * de 0 % dit « tout a été perdu », l'absence de décision ne dit rien. La distinction est portée par
 * le type plutôt que laissée à l'écran, où elle se perdrait au premier `?? 0`.
 */
export type TauxConversion = {
	readonly gagnees: number
	readonly perdues: number
	readonly decidees: number
	readonly taux: number | null
}

/** Le genre d'un nœud, ou `open` par défaut — la base contraint déjà les trois valeurs. */
function genreDe(valeur: string): GenreNoeud {
	return valeur === 'won' || valeur === 'lost' ? valeur : 'open'
}

/**
 * Arrondit au centime.
 *
 * La base arrondit déjà chaque ligne (§5.1) ; sommer des valeurs au centime peut néanmoins produire
 * la poussière binaire habituelle — `0.1 + 0.2` —, que cet arrondi retire. Il ne CHANGE aucun
 * montant : il retire ce que la représentation flottante ajoute.
 */
const auCentime = (valeur: number): number => Math.round(valeur * 100) / 100

/**
 * Restreint les lignes à une portée — §5.2.
 *
 * Aucune sommation ici : le filtre est séparé du repli, parce que les deux répondent à des
 * questions différentes et que les éprouver séparément est ce qui rend leur composition sûre.
 */
export function restreindre(
	lignes: readonly LigneEntonnoirLue[],
	portee: Portee,
): readonly LigneEntonnoirLue[] {
	if (portee.type === 'workspace') return lignes
	if (portee.type === 'track') return lignes.filter((ligne) => ligne.track_id === portee.id)
	return lignes.filter((ligne) => ligne.channel_id === portee.id)
}

/**
 * Replie les lignes par `(nœud, devise)`, dans l'ordre du catalogue puis de la devise.
 *
 * L'ORDRE EST CELUI DU SERVEUR, reconstruit sur `node_position` et non sur le rang reçu : le repli
 * fusionne des lignes de channels différents, et l'ordre d'apparition ne survivrait pas à une
 * restriction de portée. La position vient du catalogue, donc de la même autorité que l'ordre du
 * board (`docs/SPEC-workflow-engine.md` §2).
 *
 * DEUX DEVISES AU MÊME NŒUD RESTENT DEUX BARRES (§11.2), jamais une somme.
 */
export function replier(lignes: readonly LigneEntonnoirLue[]): readonly NoeudEntonnoir[] {
	const cumul = new Map<string, NoeudEntonnoir>()
	for (const ligne of lignes) {
		const clef = `${ligne.node_id} ${ligne.currency}`
		const courant = cumul.get(clef)
		cumul.set(clef, {
			idNoeud: ligne.node_id,
			cle: ligne.node_key,
			libelle: ligne.node_label,
			genre: genreDe(ligne.node_kind),
			position: ligne.node_position,
			devise: ligne.currency,
			affaires: (courant?.affaires ?? 0) + ligne.affaires,
			affairesSansMontant: (courant?.affairesSansMontant ?? 0) + ligne.affaires_sans_montant,
			affairesSansProbabilite:
				(courant?.affairesSansProbabilite ?? 0) + ligne.affaires_sans_probabilite,
			montant: auCentime((courant?.montant ?? 0) + ligne.montant),
			montantPondere: auCentime((courant?.montantPondere ?? 0) + ligne.montant_pondere),
		})
	}
	return [...cumul.values()].sort(
		(a, b) => a.position - b.position || a.devise.localeCompare(b.devise),
	)
}

/** Un tableau de l'entonnoir : les nœuds d'UNE devise, dans l'ordre du catalogue — §5.48. */
export type GroupeDevise = {
	readonly devise: string
	readonly noeuds: readonly NoeudEntonnoir[]
}

/**
 * Groupe les nœuds repliés par devise — `docs/DESIGN_SYSTEM.md` §5.48.
 *
 * UN TABLEAU PAR DEVISE, ET JAMAIS UNE COLONNE « devise » DANS UN TABLEAU UNIQUE. Le §11.2 de la
 * spécification interdit d'additionner deux monnaies ; une colonne ne les additionnerait pas, mais
 * elle les ferait se comparer ligne à ligne dans la MÊME colonne de montants, ce qui revient au
 * même à l'œil. C'est la forme que le §5.33 a déjà retenue pour le cumul des coûts, et deux écrans
 * qui font la même chose la font de la même façon.
 *
 * L'ORDRE DES GROUPES EST CELUI DE LA DEVISE, ET L'ORDRE INTERNE CELUI DU CATALOGUE. `replier` trie
 * déjà par `position` puis par devise ; ce groupement PRÉSERVE cet ordre au lieu de le rejouer —
 * retrier ici ferait diverger les deux tris au premier changement de l'un.
 *
 * AUCUN NŒUD N'EST INVENTÉ. Une devise ne reçoit que les nœuds qu'elle peuple réellement : rendre
 * `Négociation / CHF / 0` inventerait une devise à un nœud qu'aucune affaire n'y porte, ce que le
 * §5.1 interdit déjà à la fonction elle-même.
 */
export function grouperParDevise(
	noeuds: readonly NoeudEntonnoir[],
): readonly GroupeDevise[] {
	const groupes = new Map<string, NoeudEntonnoir[]>()
	for (const noeud of noeuds) {
		const courant = groupes.get(noeud.devise)
		if (courant === undefined) groupes.set(noeud.devise, [noeud])
		else courant.push(noeud)
	}
	return [...groupes.entries()]
		.map(([devise, liste]) => ({ devise, noeuds: liste as readonly NoeudEntonnoir[] }))
		.sort((a, b) => a.devise.localeCompare(b.devise))
}

/**
 * Le prévisionnel pondéré, par devise — §7.2.
 *
 * LES NŒUDS TERMINAUX EN SONT EXCLUS, et les deux motifs sont distincts : une affaire gagnée n'est
 * plus une prévision, et une affaire perdue vaut zéro — l'inclure ne changerait aucun total tout en
 * laissant croire qu'elle compte.
 *
 * UNE DEVISE SANS AUCUNE AFFAIRE OUVERTE N'APPARAÎT PAS. Rendre « CHF : 0,00 » là où toutes les
 * affaires en francs sont closes ferait lire une prévision nulle au lieu d'une absence de
 * prévision — la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
 */
export function previsionnel(lignes: readonly LigneEntonnoirLue[]): readonly PrevisionnelDevise[] {
	const total = new Map<string, number>()
	for (const ligne of lignes) {
		if (genreDe(ligne.node_kind) !== 'open') continue
		total.set(ligne.currency, (total.get(ligne.currency) ?? 0) + ligne.montant_pondere)
	}
	return [...total.entries()]
		.map(([devise, montant]) => ({ devise, montant: auCentime(montant) }))
		.sort((a, b) => a.devise.localeCompare(b.devise))
}

/**
 * Le taux de conversion des affaires DÉCIDÉES — §7.1.
 *
 * IL NE S'APPELLE PAS « TAUX DE CONVERSION » TOUT COURT, et le nom est la moitié de la règle. Ce
 * nombre mesure la part gagnée parmi les affaires **actuellement** à un nœud terminal — pas la part
 * gagnée parmi les affaires entrées dans une période. Les deux diffèrent dès qu'une affaire décidée
 * est archivée, et le jeu de démonstration en porte une. L'analyse de cohortes est hors périmètre
 * (§11.1) ; l'appeler du nom de la seconde en n'en faisant que la première serait un compteur
 * complaisant.
 *
 * LE COMPTE EST INDÉPENDANT DE LA DEVISE : ce sont des affaires, pas des montants. C'est la seule
 * grandeur de ce module qui traverse les devises, et elle le peut précisément parce qu'elle
 * n'additionne aucun argent.
 */
export function tauxConversion(lignes: readonly LigneEntonnoirLue[]): TauxConversion {
	let gagnees = 0
	let perdues = 0
	for (const ligne of lignes) {
		const genre = genreDe(ligne.node_kind)
		if (genre === 'won') gagnees += ligne.affaires
		if (genre === 'lost') perdues += ligne.affaires
	}
	const decidees = gagnees + perdues
	return { gagnees, perdues, decidees, taux: decidees === 0 ? null : gagnees / decidees }
}

/**
 * Les affaires sans montant et sans probabilité de la portée affichée — §7.3.
 *
 * L'écran DOIT les dire, et les porter dans l'agrégat plutôt que de les recompter ailleurs est ce
 * qui rend l'égalité structurelle au lieu d'être une coïncidence à surveiller (procédé de
 * `couts-ecrans.ts`, décision 476).
 */
export function absences(lignes: readonly LigneEntonnoirLue[]): {
	readonly sansMontant: number
	readonly sansProbabilite: number
} {
	return {
		sansMontant: lignes.reduce((somme, ligne) => somme + ligne.affaires_sans_montant, 0),
		sansProbabilite: lignes.reduce((somme, ligne) => somme + ligne.affaires_sans_probabilite, 0),
	}
}

/**
 * Un nœud du catalogue, tel que la complétion du §8 bis.5 en a besoin.
 *
 * @spec CRM-066 — TRANCHE 3 c : les nœuds sans affaire
 * @spec docs/SPEC-analytique.md §5.1 (une ligne n'existe que si elle est peuplée), §8 bis.5 (les
 *       nœuds vides sont NOMMÉS, sans devise ni montant)
 */
export type NoeudCatalogue = {
	readonly id: string
	readonly cle: string
	readonly libelle: string
	readonly genre: GenreNoeud
	readonly position: number
}

/** Les colonnes du catalogue que la complétion lit — et rien d'autre. */
export const COLONNES_CATALOGUE = 'id, key, label, kind, position'

/**
 * Lit les nœuds du catalogue de l'espace de travail — la TROISIÈME lecture de l'écran.
 *
 * ELLE EST TRAITÉE COMME LA SECONDE (§8 bis.5) : son échec ne casse pas l'écran. Nommer un nœud vide
 * est un enrichissement de la lecture, jamais sa condition — les tableaux sont rendus dans tous les
 * cas, et la mention n'est simplement pas écrite.
 *
 * LES NŒUDS ARCHIVÉS SONT ÉCARTÉS. Un nœud retiré du catalogue n'est plus une étape du chemin :
 * le nommer « sans affaire » inviterait à y en mettre une.
 *
 * Ne lève jamais.
 */
export async function lireNoeudsCatalogue(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly NoeudCatalogue[]>> {
	try {
		const reponse = await client
			.from('workflow_nodes_catalog')
			.select(COLONNES_CATALOGUE)
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.order('position')
			.order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(
			(reponse.data ?? []).map((brut) => {
				const ligne = brut as unknown as {
					id: string
					key: string
					label: string
					kind: string
					position: number
				}
				return {
					id: ligne.id,
					cle: ligne.key,
					libelle: ligne.label,
					genre: genreDe(ligne.kind),
					position: ligne.position,
				}
			}),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les nœuds du catalogue qu'AUCUNE ligne de la portée affichée ne peuple — §8 bis.5.
 *
 * LA FORME EST UN NOM, JAMAIS UN ZÉRO, et l'arbitrage est écrit au §8 bis.5. Les tableaux sont **par
 * devise** : y poser `Qualification / CHF / 0` inventerait à ce nœud une devise qu'aucune affaire
 * n'y porte — ce que le §5.1 interdit déjà à la fonction elle-même —, et compléter hors des devises
 * mêlerait deux monnaies dans une colonne, ce que le §11.2 interdit. Ce que l'écran sait d'un tel
 * nœud est exactement ceci : *aucune affaire ne s'y trouve*. C'est un COMPTE D'AFFAIRES, grandeur
 * qui traverse licitement les devises parce qu'elle n'additionne aucun argent — le motif exact pour
 * lequel le §7.1 fait déjà traverser les devises au compte des affaires décidées.
 *
 * L'ORDRE EST CELUI DU CATALOGUE, jamais un autre : l'entonnoir est un CHEMIN, et l'ordre dit *où*
 * est le trou.
 *
 * LA COMPARAISON SE FAIT SUR `node_id`, ET NON SUR LA CLÉ : la clé est unique par espace de travail,
 * mais c'est l'identifiant que la fonction rend, et comparer ce que la base a joint plutôt qu'un
 * libellé recomposé est ce qui rend l'égalité structurelle.
 */
export function noeudsSansAffaire(
	catalogue: readonly NoeudCatalogue[],
	lignes: readonly LigneEntonnoirLue[],
): readonly NoeudCatalogue[] {
	const peuples = new Set(lignes.map((ligne) => ligne.node_id))
	return catalogue.filter((noeud) => !peuples.has(noeud.id))
}

/**
 * Lit l'entonnoir de l'appelant, en UNE requête.
 *
 * Sans session, la lecture rend `401` : la fonction est refusée à `anon` PAR LE PRIVILÈGE (§5.4), et
 * non par une politique. C'est plus strict qu'un tableau vide, et le module le classe comme un refus
 * plutôt que de le déguiser en état vide — masquer un `401` en « aucune affaire » ferait lire une
 * absence de droit comme un portefeuille vide.
 *
 * Le module ne bifurque JAMAIS sur un rôle (`CLAUDE.md` §10) : ce que la base consent est ce que
 * l'écran montre, et deux appelants n'obtiennent pas le même total — c'est le point du §5.3, pas un
 * défaut à compenser ici.
 */
export async function lireEntonnoir(
	client: ClientCrm,
): Promise<EtatAsync<readonly LigneEntonnoirLue[]>> {
	try {
		const reponse = await client.rpc('entonnoir_conversion')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		// Le passage par `unknown` est celui que le dépôt emploie pour toute réponse PostgREST : le
		// type généré décrit ce que la base PEUT rendre, jamais ce que cette lecture-ci demande
		// (`docs/SPEC-types.md` §4).
		return pret((reponse.data ?? []) as unknown as readonly LigneEntonnoirLue[])
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}
