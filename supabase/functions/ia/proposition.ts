// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la proposition `version: 1` et son contrôle
// @spec docs/SPEC-ia.md §2 (la sortie du modèle n'est jamais crue), §6 (clés normalisées par le produit),
//       §6.1 (le format, et « la fonction contrôle et dit, sans corriger en silence »), §11.5 ;
//       docs/SCHEMA.md §3 et §4 (types de champ, unicité d'un nœud par workflow) ; décision 617
//
// Module pur. Deux issues seulement : une sortie qui n'a pas la FORME d'une proposition est une
// `reponse_invalide` (la génération échoue) ; une proposition de bonne forme est conservée AVEC la liste
// de ses défauts, que l'administrateur corrige ou fait revoir. La seule transformation est celle que la
// spécification nomme : la normalisation des clés, appliquée à toutes leurs références à la fois.

export const TYPES_DE_CHAMP = [
	'text', 'textarea', 'number', 'money', 'date', 'datetime', 'select', 'multiselect',
	'checkbox', 'url', 'email', 'phone', 'user', 'contact', 'file',
] as const
export const NATURES = ['open', 'won', 'lost'] as const
export const VISIBILITES = ['hidden', 'visible', 'required'] as const

/** Au-delà, la sortie n'est plus un workflow mais une dérive du modèle. */
export const ELEMENTS_MAX = 200

export type Noeud = { cle: string; libelle: string; nature: string; probabilite: number }
export type Etape = { noeud: string; initiale: boolean }
export type Transition = { de: string; vers: string; libelle: string; commentaire_requis: boolean }
export type Champ = { cle: string; libelle: string; type: string; choix: string[] | null; devise: string | null; aide: string | null }
export type Regle = { champ: string; etape: string; visibilite: string }
export type Exigence = { de: string; vers: string; champ: string }

export type Proposition = {
	version: 1
	workflow: { nom: string }
	noeuds: Noeud[]
	etapes: Etape[]
	transitions: Transition[]
	champs: Champ[]
	regles: Regle[]
	exigences: Exigence[]
}

export type Defaut = { readonly code: string; readonly chemin: string; readonly message: string }

export type Controle =
	| { readonly ok: true; readonly proposition: Proposition; readonly defauts: Defaut[] }
	| { readonly ok: false }

/** Le schéma passé en `format` à Ollama : la FORME, que le modèle respecte ; le sens est contrôlé ici. */
export const SCHEMA_WORKFLOW = {
	type: 'object',
	required: ['workflow', 'noeuds', 'etapes', 'transitions', 'champs', 'regles', 'exigences'],
	properties: {
		workflow: { type: 'object', required: ['nom'], properties: { nom: { type: 'string' } } },
		noeuds: {
			type: 'array',
			items: {
				type: 'object',
				required: ['cle', 'libelle', 'nature', 'probabilite'],
				properties: {
					cle: { type: 'string' },
					libelle: { type: 'string' },
					nature: { type: 'string', enum: [...NATURES] },
					probabilite: { type: 'number' },
				},
			},
		},
		etapes: {
			type: 'array',
			items: {
				type: 'object',
				required: ['noeud', 'initiale'],
				properties: { noeud: { type: 'string' }, initiale: { type: 'boolean' } },
			},
		},
		transitions: {
			type: 'array',
			items: {
				type: 'object',
				required: ['de', 'vers', 'libelle', 'commentaire_requis'],
				properties: {
					de: { type: 'string' },
					vers: { type: 'string' },
					libelle: { type: 'string' },
					commentaire_requis: { type: 'boolean' },
				},
			},
		},
		champs: {
			type: 'array',
			items: {
				type: 'object',
				required: ['cle', 'libelle', 'type'],
				properties: {
					cle: { type: 'string' },
					libelle: { type: 'string' },
					type: { type: 'string', enum: [...TYPES_DE_CHAMP] },
					choix: { type: ['array', 'null'], items: { type: 'string' } },
					devise: { type: ['string', 'null'] },
					aide: { type: ['string', 'null'] },
				},
			},
		},
		regles: {
			type: 'array',
			items: {
				type: 'object',
				required: ['champ', 'etape', 'visibilite'],
				properties: {
					champ: { type: 'string' },
					etape: { type: 'string' },
					visibilite: { type: 'string', enum: [...VISIBILITES] },
				},
			},
		},
		exigences: {
			type: 'array',
			items: {
				type: 'object',
				required: ['de', 'vers', 'champ'],
				properties: { de: { type: 'string' }, vers: { type: 'string' }, champ: { type: 'string' } },
			},
		},
	},
} as const

/**
 * La forme de clé du produit, `^[a-z0-9]+(-[a-z0-9]+)*$` : minuscules, accents retirés, tout autre
 * caractère devient un tiret. « D_Présentation_Négociation » devient `d-presentation-negociation`.
 */
export function normaliserCle(brute: string): string {
	return brute
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Contrôle une sortie du modèle contre le format `version: 1`.
 *
 * `catalogue` : les clés des nœuds déjà au catalogue de l'espace, qu'une étape peut viser sans les
 * redéclarer.
 */
export function controlerProposition(sortie: unknown, catalogue: readonly string[]): Controle {
	if (!estObjet(sortie)) return { ok: false }
	const listes = ['noeuds', 'etapes', 'transitions', 'champs', 'regles', 'exigences'] as const
	if (!estObjet(sortie.workflow) || listes.some((l) => !Array.isArray(sortie[l]))) return { ok: false }
	const total = listes.reduce((n, l) => n + (sortie[l] as unknown[]).length, 0)
	if (total > ELEMENTS_MAX) return { ok: false }
	const brut = (l: (typeof listes)[number]) => (sortie[l] as unknown[]).filter(estObjet)
	if (listes.some((l) => brut(l).length !== (sortie[l] as unknown[]).length)) return { ok: false }

	const defauts: Defaut[] = []
	const dire = (code: string, chemin: string, message: string) => defauts.push({ code, chemin, message })
	const cle = (valeur: unknown, chemin: string) => {
		const normalisee = normaliserCle(texte(valeur))
		if (normalisee === '') dire('cle_vide', chemin, 'Une clé est vide une fois normalisée.')
		return normalisee
	}

	const proposition: Proposition = {
		version: 1,
		workflow: { nom: texte(sortie.workflow.nom) },
		noeuds: brut('noeuds').map((n, i) => ({
			cle: cle(n.cle, `noeuds[${i}].cle`),
			libelle: texte(n.libelle),
			nature: texte(n.nature),
			probabilite: typeof n.probabilite === 'number' ? n.probabilite : Number.NaN,
		})),
		etapes: brut('etapes').map((e, i) => ({ noeud: cle(e.noeud, `etapes[${i}].noeud`), initiale: e.initiale === true })),
		transitions: brut('transitions').map((t, i) => ({
			de: cle(t.de, `transitions[${i}].de`),
			vers: cle(t.vers, `transitions[${i}].vers`),
			libelle: texte(t.libelle),
			commentaire_requis: t.commentaire_requis === true,
		})),
		champs: brut('champs').map((c, i) => ({
			cle: cle(c.cle, `champs[${i}].cle`),
			libelle: texte(c.libelle),
			type: texte(c.type),
			choix: Array.isArray(c.choix) ? c.choix.map(texte).filter((x) => x !== '') : null,
			devise: typeof c.devise === 'string' && c.devise.trim() !== '' ? c.devise.trim().toUpperCase() : null,
			aide: typeof c.aide === 'string' && c.aide.trim() !== '' ? c.aide.trim() : null,
		})),
		regles: brut('regles').map((r, i) => ({
			champ: cle(r.champ, `regles[${i}].champ`),
			etape: cle(r.etape, `regles[${i}].etape`),
			visibilite: texte(r.visibilite),
		})),
		exigences: brut('exigences').map((x, i) => ({
			de: cle(x.de, `exigences[${i}].de`),
			vers: cle(x.vers, `exigences[${i}].vers`),
			champ: cle(x.champ, `exigences[${i}].champ`),
		})),
	}

	if (proposition.workflow.nom === '') dire('nom_absent', 'workflow.nom', 'Le workflow n’a pas de nom.')

	// Les nœuds que la proposition ajouterait au catalogue.
	const noeudsProposes = new Set<string>()
	proposition.noeuds.forEach((n, i) => {
		if (noeudsProposes.has(n.cle)) dire('noeud_en_double', `noeuds[${i}]`, `Le nœud « ${n.cle} » est déclaré deux fois.`)
		if (catalogue.includes(n.cle)) dire('noeud_deja_au_catalogue', `noeuds[${i}]`, `Le nœud « ${n.cle} » existe déjà au catalogue : une étape le vise sans le redéclarer.`)
		if (n.libelle === '') dire('libelle_absent', `noeuds[${i}].libelle`, `Le nœud « ${n.cle} » n’a pas de libellé.`)
		if (!(NATURES as readonly string[]).includes(n.nature)) dire('nature_invalide', `noeuds[${i}].nature`, `La nature du nœud « ${n.cle} » n’est ni open, ni won, ni lost.`)
		if (!(n.probabilite >= 0 && n.probabilite <= 100)) dire('probabilite_invalide', `noeuds[${i}].probabilite`, `La probabilité du nœud « ${n.cle} » n’est pas entre 0 et 100.`)
		noeudsProposes.add(n.cle)
	})

	// Les étapes : chacune vise un nœud connu, une seule fois ; exactement une est initiale.
	const etapes = new Set<string>()
	if (proposition.etapes.length === 0) dire('aucune_etape', 'etapes', 'Le workflow n’a aucune étape.')
	proposition.etapes.forEach((e, i) => {
		if (etapes.has(e.noeud)) dire('etape_en_double', `etapes[${i}]`, `Le nœud « ${e.noeud} » porte deux étapes.`)
		if (!noeudsProposes.has(e.noeud) && !catalogue.includes(e.noeud)) dire('noeud_inconnu', `etapes[${i}].noeud`, `L’étape vise le nœud « ${e.noeud} », ni proposé ni au catalogue.`)
		etapes.add(e.noeud)
	})
	const initiales = proposition.etapes.filter((e) => e.initiale).length
	if (proposition.etapes.length > 0 && initiales !== 1) dire('etape_initiale', 'etapes', `Il faut exactement une étape initiale ; la proposition en a ${initiales}.`)

	// Les transitions : entre deux étapes de la proposition, distinctes, une fois chacune.
	const aretes = new Set<string>()
	proposition.transitions.forEach((t, i) => {
		if (!etapes.has(t.de) || !etapes.has(t.vers)) dire('transition_etape_absente', `transitions[${i}]`, `La transition « ${t.de} » → « ${t.vers} » vise une étape absente.`)
		if (t.de === t.vers) dire('transition_boucle', `transitions[${i}]`, `La transition « ${t.de} » mène à elle-même.`)
		if (aretes.has(`${t.de}>${t.vers}`)) dire('transition_en_double', `transitions[${i}]`, `La transition « ${t.de} » → « ${t.vers} » est déclarée deux fois.`)
		if (t.libelle === '') dire('transition_sans_libelle', `transitions[${i}].libelle`, `La transition « ${t.de} » → « ${t.vers} » n’a pas de libellé.`)
		aretes.add(`${t.de}>${t.vers}`)
	})

	// Les champs : un type connu, ses options exigées.
	const champs = new Set<string>()
	proposition.champs.forEach((c, i) => {
		if (champs.has(c.cle)) dire('champ_en_double', `champs[${i}]`, `Le champ « ${c.cle} » est déclaré deux fois.`)
		if (c.libelle === '') dire('libelle_absent', `champs[${i}].libelle`, `Le champ « ${c.cle} » n’a pas de libellé.`)
		if (!(TYPES_DE_CHAMP as readonly string[]).includes(c.type)) dire('type_inconnu', `champs[${i}].type`, `Le type « ${c.type} » du champ « ${c.cle} » n’existe pas.`)
		if ((c.type === 'select' || c.type === 'multiselect') && (c.choix === null || c.choix.length === 0)) dire('choix_requis', `champs[${i}].choix`, `Le champ « ${c.cle} » est une liste sans choix.`)
		if (c.type === 'money' && (c.devise === null || !/^[A-Z]{3}$/.test(c.devise))) dire('devise_requise', `champs[${i}].devise`, `Le champ monétaire « ${c.cle} » n’a pas de devise à trois lettres.`)
		champs.add(c.cle)
	})

	proposition.regles.forEach((r, i) => {
		if (!champs.has(r.champ)) dire('regle_champ_absent', `regles[${i}].champ`, `La règle vise le champ absent « ${r.champ} ».`)
		if (!etapes.has(r.etape)) dire('regle_etape_absente', `regles[${i}].etape`, `La règle vise l’étape absente « ${r.etape} ».`)
		if (!(VISIBILITES as readonly string[]).includes(r.visibilite)) dire('visibilite_invalide', `regles[${i}].visibilite`, `La visibilité « ${r.visibilite} » n’existe pas.`)
	})

	proposition.exigences.forEach((x, i) => {
		if (!aretes.has(`${x.de}>${x.vers}`)) dire('exigence_transition_absente', `exigences[${i}]`, `L’exigence vise la transition absente « ${x.de} » → « ${x.vers} ».`)
		if (!champs.has(x.champ)) dire('exigence_champ_absent', `exigences[${i}].champ`, `L’exigence vise le champ absent « ${x.champ} ».`)
	})

	return { ok: true, proposition, defauts }
}
