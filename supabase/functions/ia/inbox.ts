// @spec CRM-166 (docs/BACKLOG.md) — tranche T1 : l'assistant de l'inbox — la demande au modèle (ce qui part, rien d'autre) et le
//       contrôle de sa sortie : un plan d'actions par fil, jamais cru, jamais appliqué ici
// @spec docs/SPEC-ia.md §17.2 (les lots), §17.3 (ce qui part au modèle), §17.4 (la sortie structurée), §17.5 (la sortie n'est
//       jamais crue), §17.7 (les bornes) ; docs/SPEC-mail-subsystem.md §36.3 (l'application par les gestes de la page) ;
//       docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10, §20
//
// Ce module est PUR : aucune lecture, aucune écriture, aucun réseau. La fonction `ia` ne touche jamais la messagerie — elle rend
// un plan, que l'écran fait accepter ou refuser, puis applique par les gestes de la page, sous le jeton de la personne.

import type { Message } from './ollama.ts'
import { LONGUEUR_TEXTE, texteDuMail } from './pastilles.ts'

/** 50 fils par demande (décision 994), 5 par lot : ~20 jetons par seconde, un lot de 5 tient dans les 60 s de Kong (§17.2). */
export const FILS_MAX = 50
export const LOT_FILS = 5
export const DEMANDE_MAX = 1_000
export const ACTIONS_MAX = 4
export const MOTIF_MAX = 200
/** La borne d'un lot : au-delà, `delai_depasse`, sans nouvelle tentative (§17.7). */
export const BORNE_PLAN_MS = 90_000

export const DUREES = ['demain', 'semaine_prochaine', 'mois_prochain'] as const
export type Duree = (typeof DUREES)[number]

export const ACTIONS = [
	'pose_pastille',
	'retire_pastille',
	'classe',
	'declasse',
	'sommeil',
	'lu',
	'non_lu',
	'supprime_ici',
	'supprime_partout',
	'transfere',
	'bloque_expediteur',
] as const
export type Action = (typeof ACTIONS)[number]

type GenreDeCible = 'pastille' | 'affaire' | 'membre' | 'duree'

/** Ce que chaque action demande comme cible (§17.4) : une clé du genre dit, ou aucune. */
const CIBLE_DE: Readonly<Record<Action, GenreDeCible | null>> = {
	pose_pastille: 'pastille',
	retire_pastille: 'pastille',
	classe: 'affaire',
	declasse: null,
	sommeil: 'duree',
	lu: null,
	non_lu: null,
	supprime_ici: null,
	supprime_partout: null,
	transfere: 'membre',
	bloque_expediteur: null,
}

/** Les gestes qui gardent une confirmation sur la page (décision 994) : « Tout accepter » ne les applique pas (§36.4). */
const A_CONFIRMATION: ReadonlySet<Action> = new Set<Action>(['supprime_partout', 'bloque_expediteur'])

/** L'ordre de l'application (§17.5) : ce qui sort le fil de son dossier passe en dernier. */
const ORDRE: Readonly<Record<Action, number>> = {
	pose_pastille: 0,
	retire_pastille: 0,
	lu: 1,
	non_lu: 1,
	sommeil: 2,
	transfere: 3,
	classe: 4,
	declasse: 4,
	bloque_expediteur: 5,
	supprime_ici: 6,
	supprime_partout: 6,
}

const estSuppression = (action: Action) => action === 'supprime_ici' || action === 'supprime_partout'

// ── Ce que la fonction lit (sous le jeton de la personne) ─────────────────────────────────────────────────────────────────

/** Le message d'un fil que le modèle lit : `inbox_assistant_messages`. Jamais une pièce jointe ni un destinataire. */
export type FilLu = {
	readonly workspace_id: string
	readonly thread_key: string
	readonly subject: string | null
	readonly from_name: string | null
	readonly from_address: string | null
	readonly received_at: string | null
	readonly body_text: string | null
	readonly body_html: string | null
}

/** Le contexte de l'espace : `inbox_assistant_context`. */
export type ContexteInbox = {
	readonly labels: readonly { readonly id: string; readonly name: string; readonly description: string | null }[]
	readonly cards: readonly { readonly id: string; readonly title: string }[]
	readonly members: readonly { readonly id: string; readonly full_name: string }[]
}

// ── La demande ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une cible rendue à l'écran : l'identifiant que la base connaît, et de quoi l'afficher. */
export type CibleDuPlan = { readonly genre: GenreDeCible; readonly id: string; readonly libelle: string }

export type ClesInbox = {
	readonly fils: ReadonlyMap<string, FilLu>
	readonly cibles: ReadonlyMap<string, CibleDuPlan>
}

export type DemandeInbox = {
	readonly messages: readonly Message[]
	readonly schema: unknown
	readonly cles: ClesInbox
}

const CONSIGNE =
	'Tu aides une personne à trier des mails reçus par une entreprise. On te donne sa demande, des listes (pastilles, affaires, ' +
	'membres, durées de sommeil) chacune avec des clés, puis des mails, chacun avec une clé [f1], [f2]… Pour chaque mail qui le ' +
	'demande, propose les actions utiles, avec la clé de la cible quand l\'action en demande une et un court motif en français. ' +
	'Les actions : pose_pastille et retire_pastille (clé de pastille), classe (clé d\'affaire), declasse, sommeil (une durée), lu, ' +
	'non_lu, supprime_ici, supprime_partout, transfere (clé de membre), bloque_expediteur. Ne propose que ce que la demande ' +
	'justifie, jamais plus de quatre actions par mail, n\'invente aucune clé. Réponds par le seul objet JSON demandé.'

const pasDeBlancs = (texte: string | null | undefined) => (texte ?? '').replace(/\s+/g, ' ').trim()

/**
 * La demande au modèle (docs/SPEC-ia.md §17.3) : la demande écrite, les listes bornées de l'espace et, pour chaque fil, l'objet,
 * l'expéditeur, la date et les 2 000 premiers caractères du texte du message reçu le plus récent. Rien d'autre : ni pièce
 * jointe, ni destinataire, ni autre message du fil, ni identifiant de la base — les clés sont courtes et propres à la demande.
 */
export function demandeInbox(demande: string, fils: readonly FilLu[], contexte: ContexteInbox): DemandeInbox {
	const cibles = new Map<string, CibleDuPlan>()
	const clesDeFils = new Map<string, FilLu>()
	const liste = <T>(elements: readonly T[], prefixe: string, genre: GenreDeCible, ligne: (e: T) => { id: string; libelle: string; texte: string }) =>
		elements.map((element, rang) => {
			const cle = `${prefixe}${rang + 1}`
			const { id, libelle, texte } = ligne(element)
			cibles.set(cle, { genre, id, libelle })
			return `- ${cle} : ${texte}`
		})
	const pastilles = liste(contexte.labels, 'p', 'pastille', (p) => ({
		id: p.id,
		libelle: p.name,
		texte: `${p.name}${p.description ? ` — ${pasDeBlancs(p.description)}` : ''}`,
	}))
	const affaires = liste(contexte.cards, 'a', 'affaire', (a) => ({ id: a.id, libelle: a.title, texte: pasDeBlancs(a.title) }))
	const membres = liste(contexte.members, 'u', 'membre', (m) => ({ id: m.id, libelle: m.full_name, texte: pasDeBlancs(m.full_name) }))
	for (const duree of DUREES) cibles.set(duree, { genre: 'duree', id: duree, libelle: duree })

	const mails = fils.map((fil, rang) => {
		const cle = `f${rang + 1}`
		clesDeFils.set(cle, fil)
		const expediteur = [pasDeBlancs(fil.from_name), fil.from_address ? `<${fil.from_address.trim()}>` : '']
			.filter((partie) => partie !== '')
			.join(' ')
		const texte = texteDuMail(fil.body_text, fil.body_html).slice(0, LONGUEUR_TEXTE)
		return [`[${cle}]`, `Objet : ${pasDeBlancs(fil.subject)}`, `De : ${expediteur}`, `Date : ${fil.received_at ?? ''}`, 'Texte :', texte].join('\n')
	})
	const contenu = [
		'Demande de la personne :',
		demande.trim(),
		'',
		'Pastilles possibles :',
		...(pastilles.length > 0 ? pastilles : ['(aucune)']),
		'',
		'Affaires où classer :',
		...(affaires.length > 0 ? affaires : ['(aucune)']),
		'',
		'Membres à qui transférer :',
		...(membres.length > 0 ? membres : ['(aucun)']),
		'',
		`Durées de sommeil possibles : ${DUREES.join(', ')}`,
		'',
		'Mails :',
		mails.join('\n\n'),
	].join('\n')

	const clesCibles = [...cibles.keys()]
	const schema = {
		type: 'object',
		properties: {
			plans: {
				type: 'array',
				maxItems: fils.length,
				items: {
					type: 'object',
					properties: {
						fil: { type: 'string', enum: [...clesDeFils.keys()] },
						actions: {
							type: 'array',
							maxItems: ACTIONS_MAX,
							items: {
								type: 'object',
								properties: {
									action: { type: 'string', enum: [...ACTIONS] },
									cible: { type: 'string', enum: ['', ...clesCibles] },
									motif: { type: 'string', maxLength: MOTIF_MAX },
								},
								required: ['action', 'cible', 'motif'],
								additionalProperties: false,
							},
						},
					},
					required: ['fil', 'actions'],
					additionalProperties: false,
				},
			},
		},
		required: ['plans'],
		additionalProperties: false,
	}
	return {
		messages: [
			{ role: 'system', content: CONSIGNE },
			{ role: 'user', content: contenu },
		],
		schema,
		cles: { fils: clesDeFils, cibles },
	}
}

// ── La sortie contrôlée ───────────────────────────────────────────────────────────────────────────────────────────────────

export type ActionDuPlan = {
	readonly action: Action
	readonly cible: CibleDuPlan | null
	readonly motif: string
	/** Vrai pour supprime_partout et bloque_expediteur : « Tout accepter » ne les applique pas (§36.4). */
	readonly confirmation: boolean
}

export type PlanDeFil = {
	readonly workspace_id: string
	readonly thread_key: string
	readonly objet: string
	/** L'adresse de l'expéditeur du message lu : de quoi afficher la ligne et bloquer (§17.5). */
	readonly expediteur: string
	readonly actions: readonly ActionDuPlan[]
}

export type PlanControle = { readonly plans: readonly PlanDeFil[]; readonly rejetees: number }

const estObjet = (valeur: unknown): valeur is Record<string, unknown> =>
	typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)

/** Deux actions du même fil se contredisent-elles ? La première gardée l'emporte (§17.5). */
function contradictoires(a: ActionDuPlan, b: ActionDuPlan): boolean {
	if ((a.action === 'pose_pastille' || a.action === 'retire_pastille') && (b.action === 'pose_pastille' || b.action === 'retire_pastille')) {
		return a.cible?.id === b.cible?.id
	}
	const paires: readonly (readonly Action[])[] = [
		['lu', 'non_lu'],
		['classe', 'declasse'],
		['supprime_ici', 'supprime_partout'],
	]
	if (paires.some((paire) => paire.includes(a.action) && paire.includes(b.action))) return true
	// Deux gestes uniques par fil : une seule affaire, un seul sommeil, un seul transfert.
	return a.action === b.action && (a.action === 'classe' || a.action === 'sommeil' || a.action === 'transfere')
}

/**
 * Le contrôle de la sortie (docs/SPEC-ia.md §17.5). `null` quand la forme est fausse : c'est l'échec `reponse_invalide`. Sinon :
 * un fil hors du lot, une action hors énumération, une cible inconnue ou incompatible sont REJETÉS et comptés — jamais devinés ni
 * rapprochés ; les doublons tombent ; la première de deux actions contradictoires est gardée ; rien ne suit une suppression ; au
 * plus quatre actions par fil ; les motifs sont rognés. Les actions gardées sont ordonnées pour l'application.
 */
export function controlerPlan(contenu: unknown, cles: ClesInbox): PlanControle | null {
	if (!estObjet(contenu) || !Array.isArray(contenu.plans)) return null
	let rejetees = 0
	const parFil = new Map<string, ActionDuPlan[]>()
	for (const entree of contenu.plans as unknown[]) {
		if (!estObjet(entree) || typeof entree.fil !== 'string' || !Array.isArray(entree.actions)) {
			rejetees += 1
			continue
		}
		const fil = cles.fils.get(entree.fil)
		if (fil === undefined) {
			rejetees += Math.max(1, entree.actions.length)
			continue
		}
		const gardees = parFil.get(entree.fil) ?? []
		parFil.set(entree.fil, gardees)
		for (const brute of entree.actions as unknown[]) {
			if (!estObjet(brute) || typeof brute.action !== 'string' || typeof brute.cible !== 'string' || typeof brute.motif !== 'string') {
				rejetees += 1
				continue
			}
			const action = ACTIONS.find((candidate) => candidate === brute.action)
			if (action === undefined) {
				rejetees += 1
				continue
			}
			const genre = CIBLE_DE[action]
			let cible: CibleDuPlan | null = null
			if (genre === null) {
				if (brute.cible !== '') {
					rejetees += 1
					continue
				}
			} else {
				const trouvee = cles.cibles.get(brute.cible)
				if (trouvee === undefined || trouvee.genre !== genre) {
					rejetees += 1
					continue
				}
				cible = trouvee
			}
			const candidate: ActionDuPlan = {
				action,
				cible,
				motif: brute.motif.replace(/\s+/g, ' ').trim().slice(0, MOTIF_MAX),
				confirmation: A_CONFIRMATION.has(action),
			}
			if (gardees.some((g) => g.action === action && g.cible?.id === cible?.id)) continue // un doublon tombe
			if (gardees.some((g) => estSuppression(g.action)) || gardees.length >= ACTIONS_MAX || gardees.some((g) => contradictoires(g, candidate))) {
				rejetees += 1
				continue
			}
			gardees.push(candidate)
		}
	}
	const plans: PlanDeFil[] = []
	for (const [cle, fil] of cles.fils) {
		const actions = parFil.get(cle)
		if (actions === undefined || actions.length === 0) continue
		plans.push({
			workspace_id: fil.workspace_id,
			thread_key: fil.thread_key,
			objet: pasDeBlancs(fil.subject),
			expediteur: (fil.from_address ?? '').trim(),
			// `sort` est stable : l'ordre du modèle est gardé entre deux actions de même rang.
			actions: [...actions].sort((a, b) => ORDRE[a.action] - ORDRE[b.action]),
		})
	}
	return { plans, rejetees }
}
