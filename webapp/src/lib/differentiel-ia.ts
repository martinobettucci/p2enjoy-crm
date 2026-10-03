// @spec CRM-097 (docs/BACKLOG.md) — tranche T3.c : ce qu'une suggestion change à un workflow existant
// @spec docs/SPEC-ia.md §13.1 (l'identité d'un objet est sa clé : conservé, nouveau ou retiré se déduisent de la
//       composition vivante), §13.6 (le différentiel en tête de l'aperçu ; les affaires des étapes retirées) ;
//       docs/DESIGN_SYSTEM.md §5.53 (une section par collection, le nom du workflow, l'attribut nommé, le rang parmi
//       les étapes conservées) ; docs/JOURNAL.md décision 620
//
// Module pur : il compare deux propositions `version: 1` — la composition vivante, telle que la base la rend
// (`proposition_du_workflow`), et la cible — et ne juge rien. Les défauts sont l'affaire de la base (§12.1) ; ce
// module dit seulement ce qui changerait. Les clés sont celles du §13.1 : étape par son nœud, transition par son
// couple, champ par sa clé, règle par le couple champ × étape, exigence par le triplet.

import type { PropositionIa } from './brouillon-ia'

export type GenreChangement = 'ajout' | 'retrait' | 'modification'

export const COLLECTIONS_DIFFERENTIEL = ['workflow', 'etapes', 'transitions', 'champs', 'regles', 'exigences'] as const
export type CollectionDifferentiel = (typeof COLLECTIONS_DIFFERENTIEL)[number]

export type ObjetDifferentiel =
	| { readonly collection: 'workflow' }
	| { readonly collection: 'etapes'; readonly cle: string }
	| { readonly collection: 'transitions'; readonly de: string; readonly vers: string }
	| { readonly collection: 'champs'; readonly cle: string }
	| { readonly collection: 'regles'; readonly champ: string; readonly etape: string }
	| { readonly collection: 'exigences'; readonly de: string; readonly vers: string; readonly champ: string }

export type CodeAttribut =
	| 'nom'
	| 'initiale'
	| 'rang'
	| 'libelle'
	| 'commentaire_requis'
	| 'type'
	| 'choix'
	| 'devise'
	| 'aide'
	| 'visibilite'

export type ValeurAttribut = string | number | boolean | readonly string[] | null

export type AttributChange = { readonly code: CodeAttribut; readonly avant: ValeurAttribut; readonly apres: ValeurAttribut }

export type Changement = {
	readonly genre: GenreChangement
	readonly objet: ObjetDifferentiel
	/** Vide pour un ajout et un retrait ; au moins un attribut pour une modification. */
	readonly attributs: readonly AttributChange[]
}

const memeValeur = (a: ValeurAttribut, b: ValeurAttribut) => JSON.stringify(a) === JSON.stringify(b)

function attributsChanges(paires: readonly (readonly [CodeAttribut, ValeurAttribut, ValeurAttribut])[]): AttributChange[] {
	return paires.filter(([, avant, apres]) => !memeValeur(avant, apres)).map(([code, avant, apres]) => ({ code, avant, apres }))
}

/**
 * Compare une collection par clé : les objets de la cible d'abord, dans son ordre — ajoutés ou modifiés —, puis
 * les objets vivants absents de la cible, dans l'ordre vivant — retirés.
 */
function comparer<T>(
	vivants: readonly T[],
	cibles: readonly T[],
	cle: (objet: T) => string,
	objet: (o: T) => ObjetDifferentiel,
	attributs: (avant: T, apres: T) => AttributChange[],
): Changement[] {
	const parCle = new Map(vivants.map((v) => [cle(v), v]))
	const dansCible = new Set(cibles.map(cle))
	const changements: Changement[] = []
	for (const c of cibles) {
		const v = parCle.get(cle(c))
		if (v === undefined) {
			changements.push({ genre: 'ajout', objet: objet(c), attributs: [] })
			continue
		}
		const changes = attributs(v, c)
		if (changes.length > 0) changements.push({ genre: 'modification', objet: objet(c), attributs: changes })
	}
	for (const v of vivants) {
		if (!dansCible.has(cle(v))) changements.push({ genre: 'retrait', objet: objet(v), attributs: [] })
	}
	return changements
}

/**
 * Ce que la cible change à la composition vivante, collection par collection, dans l'ordre de l'éditeur.
 *
 * LE RANG D'UNE ÉTAPE se compare PARMI LES ÉTAPES CONSERVÉES (docs/DESIGN_SYSTEM.md §5.53) : une étape insérée ou
 * retirée décale toutes celles qui la suivent, et les dire toutes « modifiées » noierait le seul déplacement voulu.
 */
export function differentiel(vivante: PropositionIa, cible: PropositionIa): readonly Changement[] {
	const changements: Changement[] = []

	if (vivante.workflow.nom !== cible.workflow.nom) {
		changements.push({
			genre: 'modification',
			objet: { collection: 'workflow' },
			attributs: [{ code: 'nom', avant: vivante.workflow.nom, apres: cible.workflow.nom }],
		})
	}

	const clesCible = new Set(cible.etapes.map((e) => e.noeud))
	const clesVivantes = new Set(vivante.etapes.map((e) => e.noeud))
	const rangVivant = new Map(vivante.etapes.filter((e) => clesCible.has(e.noeud)).map((e, i) => [e.noeud, i + 1]))
	const rangCible = new Map(cible.etapes.filter((e) => clesVivantes.has(e.noeud)).map((e, i) => [e.noeud, i + 1]))
	changements.push(
		...comparer(
			vivante.etapes,
			cible.etapes,
			(e) => e.noeud,
			(e) => ({ collection: 'etapes', cle: e.noeud }),
			(avant, apres) =>
				attributsChanges([
					['initiale', avant.initiale, apres.initiale],
					['rang', rangVivant.get(avant.noeud) ?? null, rangCible.get(apres.noeud) ?? null],
				]),
		),
	)

	changements.push(
		...comparer(
			vivante.transitions,
			cible.transitions,
			(t) => `${t.de}>${t.vers}`,
			(t) => ({ collection: 'transitions', de: t.de, vers: t.vers }),
			(avant, apres) =>
				attributsChanges([
					['libelle', avant.libelle, apres.libelle],
					['commentaire_requis', avant.commentaire_requis, apres.commentaire_requis],
				]),
		),
	)

	changements.push(
		...comparer(
			vivante.champs,
			cible.champs,
			(c) => c.cle,
			(c) => ({ collection: 'champs', cle: c.cle }),
			(avant, apres) =>
				attributsChanges([
					['libelle', avant.libelle, apres.libelle],
					['type', avant.type, apres.type],
					['choix', avant.choix, apres.choix],
					['devise', avant.devise, apres.devise],
					['aide', avant.aide, apres.aide],
				]),
		),
	)

	changements.push(
		...comparer(
			vivante.regles,
			cible.regles,
			(r) => `${r.champ}@${r.etape}`,
			(r) => ({ collection: 'regles', champ: r.champ, etape: r.etape }),
			(avant, apres) => attributsChanges([['visibilite', avant.visibilite, apres.visibilite]]),
		),
	)

	changements.push(
		...comparer(
			vivante.exigences,
			cible.exigences,
			(x) => `${x.de}>${x.vers}@${x.champ}`,
			(x) => ({ collection: 'exigences', de: x.de, vers: x.vers, champ: x.champ }),
			() => [],
		),
	)

	return changements
}

/** Une étape retirée qui porte des affaires : elle attend une destination (docs/SPEC-ia.md §13.6). */
export type EtapeRetireeOccupee = { readonly cle: string; readonly affaires: number; readonly destination: string | null }

/**
 * Les étapes vivantes que la cible retire et qui portent des affaires, dans l'ordre vivant, avec la destination
 * que la cible leur donne — ou `null`. Une étape retirée vide ne paraît pas (docs/DESIGN_SYSTEM.md §5.53).
 */
export function etapesRetireesOccupees(
	vivante: PropositionIa,
	cible: PropositionIa,
	occupation: Readonly<Record<string, number>>,
): readonly EtapeRetireeOccupee[] {
	const gardees = new Set(cible.etapes.map((e) => e.noeud))
	return vivante.etapes
		.filter((e) => !gardees.has(e.noeud) && (occupation[e.noeud] ?? 0) > 0)
		.map((e) => ({
			cle: e.noeud,
			affaires: occupation[e.noeud] ?? 0,
			destination: cible.remappages?.find((r) => r.de === e.noeud)?.vers ?? null,
		}))
}
