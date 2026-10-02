// @spec CRM-097 (docs/BACKLOG.md) — tranche T2.c : la correction à la main d'une suggestion, sur un brouillon local
// @spec docs/SPEC-ia.md §6.1 (le format `version: 1`), §12.5 (« Corriger à la main » : ce qui se corrige dans
//       l'aperçu, et « un retrait emporte ce qui en dépend, comme la base l'emporterait ») ; docs/JOURNAL.md
//       décision 618 (point 7 : l'aperçu n'est pas un second éditeur)
//
// Module pur : chaque geste rend une NOUVELLE proposition, jamais une mutation, et les retraits disent ce qu'ils
// ont emporté — l'écran l'annonce (docs/DESIGN_SYSTEM.md §5.52). Rien n'est jugé ici : une correction peut
// introduire un défaut, et c'est la base qui le dira en écrivant la révision (docs/SPEC-ia.md §12.1).

export type NatureNoeud = 'open' | 'won' | 'lost'

export type NoeudIa = { readonly cle: string; readonly libelle: string; readonly nature: string; readonly probabilite: number | null }
export type EtapeIa = { readonly noeud: string; readonly initiale: boolean }
export type TransitionIa = { readonly de: string; readonly vers: string; readonly libelle: string; readonly commentaire_requis: boolean }
export type ChampIa = {
	readonly cle: string
	readonly libelle: string
	readonly type: string
	readonly choix: readonly string[] | null
	readonly devise: string | null
	readonly aide: string | null
}
export type RegleIa = { readonly champ: string; readonly etape: string; readonly visibilite: string }
export type ExigenceIa = { readonly de: string; readonly vers: string; readonly champ: string }

export type PropositionIa = {
	readonly version: 1
	readonly workflow: { readonly nom: string }
	readonly noeuds: readonly NoeudIa[]
	readonly etapes: readonly EtapeIa[]
	readonly transitions: readonly TransitionIa[]
	readonly champs: readonly ChampIa[]
	readonly regles: readonly RegleIa[]
	readonly exigences: readonly ExigenceIa[]
}

/** Ce qu'un retrait a emporté avec lui, pour l'annonce. */
export type Emportes = { readonly transitions: number; readonly regles: number; readonly exigences: number }

export type Retrait = { readonly proposition: PropositionIa; readonly emportes: Emportes }

const AUCUN: Emportes = { transitions: 0, regles: 0, exigences: 0 }

/** Deux propositions sont les mêmes si elles s'écrivent pareil : l'ordre des clés est celui de ce module. */
export function memesPropositions(a: PropositionIa, b: PropositionIa): boolean {
	return JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b))
}

/** La forme canonique d'une proposition : l'ordre des clés fixé, pour comparer et pour envoyer. */
export function normaliser(p: PropositionIa): PropositionIa {
	return {
		version: 1,
		workflow: { nom: p.workflow.nom },
		noeuds: p.noeuds.map((n) => ({ cle: n.cle, libelle: n.libelle, nature: n.nature, probabilite: n.probabilite })),
		etapes: p.etapes.map((e) => ({ noeud: e.noeud, initiale: e.initiale })),
		transitions: p.transitions.map((t) => ({ de: t.de, vers: t.vers, libelle: t.libelle, commentaire_requis: t.commentaire_requis })),
		champs: p.champs.map((c) => ({ cle: c.cle, libelle: c.libelle, type: c.type, choix: c.choix, devise: c.devise, aide: c.aide })),
		regles: p.regles.map((r) => ({ champ: r.champ, etape: r.etape, visibilite: r.visibilite })),
		exigences: p.exigences.map((x) => ({ de: x.de, vers: x.vers, champ: x.champ })),
	}
}

export function renommerWorkflow(p: PropositionIa, nom: string): PropositionIa {
	return { ...p, workflow: { nom } }
}

/** Le nœud proposé qui porte cette clé, s'il y en a un. */
export const noeudPropose = (p: PropositionIa, cle: string): NoeudIa | undefined => p.noeuds.find((n) => n.cle === cle)

export function modifierNoeud(p: PropositionIa, cle: string, modification: Partial<Omit<NoeudIa, 'cle'>>): PropositionIa {
	return { ...p, noeuds: p.noeuds.map((n) => (n.cle === cle ? { ...n, ...modification } : n)) }
}

/** L'étape initiale est UNIQUE : la désigner retire la marque des autres. */
export function designerInitiale(p: PropositionIa, cle: string): PropositionIa {
	return { ...p, etapes: p.etapes.map((e) => ({ ...e, initiale: e.noeud === cle })) }
}

/**
 * Un nœud proposé existe déjà au catalogue : l'étape le vise sans le redéclarer. Le nœud quitte la liste des
 * nœuds proposés ; l'étape reste, et vise désormais celui du catalogue.
 */
export function utiliserNoeudDuCatalogue(p: PropositionIa, cle: string): PropositionIa {
	return { ...p, noeuds: p.noeuds.filter((n) => n.cle !== cle) }
}

/** Retire une étape, ses transitions entrantes et sortantes, leurs exigences, ses règles et son nœud proposé. */
export function retirerEtape(p: PropositionIa, cle: string): Retrait {
	const touchees = (t: { de: string; vers: string }) => t.de === cle || t.vers === cle
	const transitions = p.transitions.filter((t) => !touchees(t))
	const exigences = p.exigences.filter((x) => !touchees(x))
	const regles = p.regles.filter((r) => r.etape !== cle)
	return {
		proposition: {
			...p,
			noeuds: p.noeuds.filter((n) => n.cle !== cle),
			etapes: p.etapes.filter((e) => e.noeud !== cle),
			transitions,
			regles,
			exigences,
		},
		emportes: {
			transitions: p.transitions.length - transitions.length,
			regles: p.regles.length - regles.length,
			exigences: p.exigences.length - exigences.length,
		},
	}
}

export function modifierTransition(
	p: PropositionIa,
	rang: number,
	modification: Partial<Pick<TransitionIa, 'libelle' | 'commentaire_requis'>>,
): PropositionIa {
	return { ...p, transitions: p.transitions.map((t, i) => (i === rang ? { ...t, ...modification } : t)) }
}

export function ajouterTransition(p: PropositionIa, transition: TransitionIa): PropositionIa {
	return { ...p, transitions: [...p.transitions, transition] }
}

/** Retire une transition et les exigences qui portaient sur elle. */
export function retirerTransition(p: PropositionIa, rang: number): Retrait {
	const visee = p.transitions[rang]
	if (visee === undefined) return { proposition: p, emportes: AUCUN }
	const exigences = p.exigences.filter((x) => !(x.de === visee.de && x.vers === visee.vers))
	return {
		proposition: { ...p, transitions: p.transitions.filter((_, i) => i !== rang), exigences },
		emportes: { transitions: 0, regles: 0, exigences: p.exigences.length - exigences.length },
	}
}

export function modifierChamp(p: PropositionIa, rang: number, modification: Partial<Omit<ChampIa, 'cle'>>): PropositionIa {
	return { ...p, champs: p.champs.map((c, i) => (i === rang ? { ...c, ...modification } : c)) }
}

/** Retire un champ, ses règles et ses exigences. */
export function retirerChamp(p: PropositionIa, rang: number): Retrait {
	const vise = p.champs[rang]
	if (vise === undefined) return { proposition: p, emportes: AUCUN }
	const regles = p.regles.filter((r) => r.champ !== vise.cle)
	const exigences = p.exigences.filter((x) => x.champ !== vise.cle)
	return {
		proposition: { ...p, champs: p.champs.filter((_, i) => i !== rang), regles, exigences },
		emportes: { transitions: 0, regles: p.regles.length - regles.length, exigences: p.exigences.length - exigences.length },
	}
}

export function modifierRegle(p: PropositionIa, rang: number, visibilite: string): PropositionIa {
	return { ...p, regles: p.regles.map((r, i) => (i === rang ? { ...r, visibilite } : r)) }
}

export function retirerRegle(p: PropositionIa, rang: number): PropositionIa {
	return { ...p, regles: p.regles.filter((_, i) => i !== rang) }
}

export function retirerExigence(p: PropositionIa, rang: number): PropositionIa {
	return { ...p, exigences: p.exigences.filter((_, i) => i !== rang) }
}

/**
 * Les choix d'une liste, tels que l'écran les édite : une ligne vide est conservée pendant la saisie — sans
 * quoi la ligne qu'on vient d'ajouter disparaîtrait — et c'est la base qui dira un choix sans clé.
 */
export function modifierChoix(p: PropositionIa, rang: number, choix: readonly string[]): PropositionIa {
	return modifierChamp(p, rang, { choix })
}
