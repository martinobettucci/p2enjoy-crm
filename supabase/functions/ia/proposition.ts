// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la proposition `version: 1` ; tranche T2.b : sa mise en forme seule ;
//       tranche T3.b : `remappages` et le schéma d'une modification (docs/SPEC-ia.md §13.1, §13.5 ; décision 620)
// @spec docs/SPEC-ia.md §2 (la sortie du modèle n'est jamais crue), §6 (clés normalisées par le produit),
//       §6.1 (le format), §11.5 ; §12.1 (la base, seule juge des défauts — la fonction ne vérifie plus que la
//       forme) ; docs/SCHEMA.md §3 et §4 (types de champ) ; docs/JOURNAL.md décisions 617 et 618
//
// Module pur. Deux issues seulement : une sortie qui n'a pas la FORME d'une proposition est une
// `reponse_invalide` (la génération échoue) ; une proposition de bonne forme est rendue, ses clés normalisées
// — la seule transformation que la spécification nomme, appliquée à toutes leurs références à la fois. Son
// SENS est jugé par la base, une fois, pour toute révision (`app.defauts_proposition_ia`, décision 618) : la
// forme rendue ici est celle que le trigger de la base accepte.

export const TYPES_DE_CHAMP = [
	'text', 'textarea', 'number', 'money', 'date', 'datetime', 'select', 'multiselect',
	'checkbox', 'url', 'email', 'phone', 'user', 'contact', 'file',
] as const
export const NATURES = ['open', 'won', 'lost'] as const
export const VISIBILITES = ['hidden', 'visible', 'required'] as const

/** Au-delà, la sortie n'est plus un workflow mais une dérive du modèle. */
export const ELEMENTS_MAX = 200

export type Noeud = { cle: string; libelle: string; nature: string; probabilite: number | null }
export type Etape = { noeud: string; initiale: boolean }
export type Transition = { de: string; vers: string; libelle: string; commentaire_requis: boolean }
export type Champ = { cle: string; libelle: string; type: string; choix: string[] | null; devise: string | null; aide: string | null }
export type Regle = { champ: string; etape: string; visibilite: string }
export type Exigence = { de: string; vers: string; champ: string }
/** Où vont les affaires d'une étape retirée (docs/SPEC-ia.md §13.1) — la forme de `step_overrides`, en clés. */
export type Remappage = { de: string; vers: string }

export type Proposition = {
	version: 1
	workflow: { nom: string }
	noeuds: Noeud[]
	etapes: Etape[]
	transitions: Transition[]
	champs: Champ[]
	regles: Regle[]
	exigences: Exigence[]
	/** Facultative : une modification seulement. */
	remappages?: Remappage[]
}

/** Un défaut tel que la base l'écrit (docs/SPEC-ia.md §12.1) ; la fonction ne le calcule plus, elle le relit. */
export type Defaut = { readonly code: string; readonly chemin: string; readonly valeurs: Record<string, unknown> }

export type MiseEnForme = { readonly ok: true; readonly proposition: Proposition } | { readonly ok: false }

/** Le schéma passé en `format` à Ollama : la FORME, que le modèle respecte ; le sens est jugé par la base. */
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
 * Le schéma d'une MODIFICATION (docs/SPEC-ia.md §13.5) : celui d'une création, et `remappages` EXIGÉ — un petit
 * modèle omet plus volontiers une clé facultative ; un tableau vide dit « aucun remappage ».
 */
export const SCHEMA_MODIFICATION = {
	...SCHEMA_WORKFLOW,
	required: [...SCHEMA_WORKFLOW.required, 'remappages'],
	properties: {
		...SCHEMA_WORKFLOW.properties,
		remappages: {
			type: 'array',
			items: {
				type: 'object',
				required: ['de', 'vers'],
				properties: { de: { type: 'string' }, vers: { type: 'string' } },
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
 * Met une sortie du modèle à la forme `version: 1`, ou la refuse. Aucun défaut n'est calculé ici : la base
 * les écrit à la création de la révision (docs/SPEC-ia.md §12.1).
 */
export function mettreEnForme(sortie: unknown): MiseEnForme {
	if (!estObjet(sortie)) return { ok: false }
	const listes = ['noeuds', 'etapes', 'transitions', 'champs', 'regles', 'exigences'] as const
	if (!estObjet(sortie.workflow) || listes.some((l) => !Array.isArray(sortie[l]))) return { ok: false }
	const total = listes.reduce((n, l) => n + (sortie[l] as unknown[]).length, 0)
	if (total > ELEMENTS_MAX) return { ok: false }
	const brut = (l: (typeof listes)[number]) => (sortie[l] as unknown[]).filter(estObjet)
	if (listes.some((l) => brut(l).length !== (sortie[l] as unknown[]).length)) return { ok: false }
	// `remappages` : absente, elle le reste ; présente, un tableau d'objets — sinon la sortie n'a pas la forme.
	const remappages = sortie.remappages
	if (remappages !== undefined && (!Array.isArray(remappages) || !remappages.every(estObjet))) return { ok: false }

	const cle = (valeur: unknown) => normaliserCle(texte(valeur))

	const proposition: Proposition = {
		version: 1,
		workflow: { nom: texte(sortie.workflow.nom) },
		noeuds: brut('noeuds').map((n) => ({
			cle: cle(n.cle),
			libelle: texte(n.libelle),
			nature: texte(n.nature),
			probabilite: typeof n.probabilite === 'number' && Number.isFinite(n.probabilite) ? n.probabilite : null,
		})),
		etapes: brut('etapes').map((e) => ({ noeud: cle(e.noeud), initiale: e.initiale === true })),
		transitions: brut('transitions').map((t) => ({
			de: cle(t.de),
			vers: cle(t.vers),
			libelle: texte(t.libelle),
			commentaire_requis: t.commentaire_requis === true,
		})),
		champs: brut('champs').map((c) => ({
			cle: cle(c.cle),
			libelle: texte(c.libelle),
			type: texte(c.type),
			choix: Array.isArray(c.choix) ? c.choix.map(texte).filter((x) => x !== '') : null,
			devise: typeof c.devise === 'string' && c.devise.trim() !== '' ? c.devise.trim().toUpperCase() : null,
			aide: typeof c.aide === 'string' && c.aide.trim() !== '' ? c.aide.trim() : null,
		})),
		regles: brut('regles').map((r) => ({
			champ: cle(r.champ),
			etape: cle(r.etape),
			visibilite: texte(r.visibilite),
		})),
		exigences: brut('exigences').map((x) => ({
			de: cle(x.de),
			vers: cle(x.vers),
			champ: cle(x.champ),
		})),
		...(remappages === undefined
			? {}
			: { remappages: (remappages as Record<string, unknown>[]).map((r) => ({ de: cle(r.de), vers: cle(r.vers) })) }),
	}

	return { ok: true, proposition }
}
