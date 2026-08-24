// @verifies CRM-062 (docs/BACKLOG.md) — tranche 3c : la composition de l'écran des affaires figées
// @verifies docs/SPEC-relances.md §10.5 (les deux lectures, et la seconde jamais bloquante),
//           §10.7 (le regroupement par dossier, l'ordre des groupes, l'ordre serveur conservé),
//           §10.8 (ce que chaque ligne rend), §10.12 (preuves unitaires attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.32 (aucun lien vers une adresse incomplète)
//
// Ces tests portent sur la LOGIQUE, sans navigateur : c'est ce que la séparation du module rend
// possible. Le rendu est éprouvé par `webapp/src/app/AffairesFigees.test.tsx`, et la pile réelle
// par `e2e/api/relances.spec.ts`.

import { describe, expect, it, vi } from 'vitest'
import {
	COLONNES_CARD_FIGEE,
	adresseChannel,
	apparier,
	libelleEtape,
	lireAffairesFigees,
	regrouperParDossier,
	type AffaireFigee,
	type LigneFigeeLue,
} from './affaires-figees'
import type { ClientCrm } from './supabase'

/** Une ligne de la règle, telle que `public.cards_figees()` la rend. */
const figee = (partiel: Partial<LigneFigeeLue> & { card_id: string }): LigneFigeeLue => ({
	channel_id: 'ch1',
	title: 'Une affaire',
	step_id: 'st1',
	seuil_jours: 14,
	jours_dans_etape: 30,
	retard_jours: 16,
	...partiel,
})

/** Une ligne de la SECONDE lecture, avec ses relations embarquées. */
const carte = (
	id: string,
	options: {
		slugChannel?: string
		nomChannel?: string
		slugTrack?: string
		nomTrack?: string
		libelle?: string | null
		noeud?: string | null
	} = {},
) => ({
	id,
	channels:
		options.slugChannel === undefined
			? null
			: {
					slug: options.slugChannel,
					name: options.nomChannel ?? 'Grands comptes',
					tracks:
						options.slugTrack === undefined
							? null
							: { slug: options.slugTrack, name: options.nomTrack ?? 'Conseil & IA' },
				},
	workflow_steps: {
		label_override: options.libelle ?? null,
		workflow_nodes_catalog: options.noeud === null ? null : { label: options.noeud ?? 'Prospection' },
	},
})

const complete = (id: string, suffixe = '1') =>
	carte(id, {
		slugChannel: `channel-${suffixe}`,
		slugTrack: `track-${suffixe}`,
		nomChannel: `Dossier ${suffixe}`,
		nomTrack: `Piste ${suffixe}`,
	})

describe('le libellé d’une étape (docs/SPEC-relances.md §10.5)', () => {
	// C'EST EXACTEMENT LA RÉSOLUTION DE `resoudreEtape` DANS `board.ts`, réemployée et non
	// réécrite : deux résolutions du même libellé divergeraient au premier changement, et l'écran
	// nommerait une étape autrement que le board qui la porte.
	it('préfère la surcharge de l’étape au libellé de son nœud', () => {
		expect(libelleEtape({ label_override: 'Négo', workflow_nodes_catalog: { label: 'Négociation' } })).toBe(
			'Négo',
		)
	})

	it('retombe sur le libellé du nœud quand l’étape n’en surcharge aucun', () => {
		expect(libelleEtape({ label_override: null, workflow_nodes_catalog: { label: 'Prospection' } })).toBe(
			'Prospection',
		)
	})

	// AUCUN LIBELLÉ INVENTÉ. Une étape que la lecture n'a pas rapportée ne se rend pas « Étape » ni
	// par un identifiant : la ligne se passe de pilule, comme le §5.11 le fait déjà d'un libellé
	// d'étape non résolu dans le fil.
	it('ne rend AUCUN libellé quand ni l’étape ni son nœud ne sont là', () => {
		expect(libelleEtape({ label_override: null, workflow_nodes_catalog: null })).toBeNull()
		expect(libelleEtape(null)).toBeNull()
		expect(libelleEtape(undefined)).toBeNull()
	})
})

describe('les adresses (docs/DESIGN_SYSTEM.md §5.32)', () => {
	it('compose l’adresse du dossier depuis les deux slugs', () => {
		expect(adresseChannel(complete('c1'))).toBe('/tracks/track-1/channel-1')
	})

	// UN LIEN VERS UNE ADRESSE INCOMPLÈTE MÈNERAIT À UN ÉCRAN QUE L'UTILISATEUR CROIRAIT CASSÉ.
	// L'affaire reste listée — c'est le §10.5 —, mais sans lien.
	it('ne compose AUCUNE adresse quand un slug manque', () => {
		expect(adresseChannel(carte('c1', { slugChannel: 'grands-comptes' }))).toBeNull()
		expect(adresseChannel(carte('c1'))).toBeNull()
		expect(adresseChannel(undefined)).toBeNull()
	})
})

describe('l’appariement des deux lectures (docs/SPEC-relances.md §10.5)', () => {
	it('porte le retard, le seuil et le titre de la RÈGLE, jamais de la seconde lecture', () => {
		const affaire = apparier(
			figee({ card_id: 'c1', title: 'Audit sécurité applicative', retard_jours: 16, seuil_jours: 14 }),
			new Map([['c1', complete('c1')]]),
		)
		expect(affaire.titre).toBe('Audit sécurité applicative')
		expect(affaire.retardJours).toBe(16)
		expect(affaire.seuilJours).toBe(14)
		expect(affaire.adresse).toBe('/tracks/track-1/channel-1/cards/c1')
		expect(affaire.adresseChannel).toBe('/tracks/track-1/channel-1')
		expect(affaire.etape).toBe('Prospection')
	})

	// LE CAS N'EST PAS THÉORIQUE : les deux lectures ne sont pas atomiques, et une affaire mise à la
	// corbeille entre elles disparaîtrait de la seconde. Elle reste LISTÉE avec ce que la règle
	// rend, et perd ce que seule la seconde apportait.
	it('garde une affaire que la seconde lecture n’a pas rapportée, sans lien ni pilule', () => {
		const affaire = apparier(figee({ card_id: 'c9', title: 'Disparue', retard_jours: 3 }), new Map())
		expect(affaire.titre).toBe('Disparue')
		expect(affaire.retardJours).toBe(3)
		expect(affaire.adresse).toBeNull()
		expect(affaire.adresseChannel).toBeNull()
		expect(affaire.nomTrack).toBeNull()
		expect(affaire.nomChannel).toBeNull()
		expect(affaire.etape).toBeNull()
	})

	// UN RETARD DE ZÉRO EST UNE DONNÉE, PAS UNE ABSENCE : la borne du §2.5 est LARGE, donc une
	// affaire atteinte exactement sur son seuil est figée. Une composition qui la traiterait comme
	// une valeur manquante ferait disparaître de l'écran la ligne du jour même de la bascule.
	it('conserve un retard de ZÉRO, qui est légitime', () => {
		const affaire = apparier(figee({ card_id: 'c1', retard_jours: 0, seuil_jours: 5 }), new Map())
		expect(affaire.retardJours).toBe(0)
		expect(affaire.seuilJours).toBe(5)
	})
})

describe('le regroupement par dossier (docs/SPEC-relances.md §10.7)', () => {
	const affaire = (id: string, idChannel: string, retard: number): AffaireFigee => ({
		id,
		titre: id,
		retardJours: retard,
		seuilJours: 5,
		idChannel,
		adresse: `/tracks/t/${idChannel}/cards/${id}`,
		adresseChannel: `/tracks/t/${idChannel}`,
		nomTrack: 'Studio web',
		nomChannel: idChannel,
		etape: 'Négociation',
	})

	// PAR CHANNEL, ET NON PAR TRACK. Le jeu de démonstration exerce réellement le cas qui les
	// distingue : `studio-web` porte `refonte` ET `maintenance` (§10.2.1). Un regroupement par
	// track les fondrait en un bloc.
	it('sépare deux dossiers d’un MÊME track', () => {
		const groupes = regrouperParDossier([
			affaire('a', 'refonte', 35),
			affaire('b', 'maintenance', 18),
		])
		expect(groupes.map((groupe) => groupe.idChannel)).toEqual(['refonte', 'maintenance'])
		expect(groupes.every((groupe) => groupe.nomTrack === 'Studio web')).toBe(true)
	})

	// L'ORDRE DES GROUPES EST CELUI DE LEUR PREMIÈRE LIGNE, donc du plus gros retard. Un ordre
	// alphabétique ferait descendre en bas d'écran le dossier le plus en retard, ce qui est
	// exactement l'information que l'écran existe pour donner.
	it('ordonne les groupes par le retard de leur première ligne, jamais par nom', () => {
		const groupes = regrouperParDossier([
			affaire('a', 'zeta', 35),
			affaire('b', 'alpha', 18),
			affaire('c', 'zeta', 7),
		])
		expect(groupes.map((groupe) => groupe.idChannel)).toEqual(['zeta', 'alpha'])
	})

	// L'ORDRE SERVEUR EST CONSERVÉ DANS UN GROUPE, jamais rejoué : la fonction ordonne déjà par
	// `retard_jours desc, title asc`, et le refaire ici le ferait diverger le jour où elle
	// changera.
	it('conserve l’ordre du serveur À L’INTÉRIEUR d’un groupe', () => {
		const groupes = regrouperParDossier([
			affaire('premier', 'ch', 35),
			affaire('second', 'ch', 18),
			affaire('troisieme', 'ch', 7),
		])
		expect(groupes).toHaveLength(1)
		expect(groupes[0]?.affaires.map((une) => une.id)).toEqual(['premier', 'second', 'troisieme'])
	})

	// UN GROUPE NAÎT D'AU MOINS UNE LIGNE : il n'y a donc rien à écrire sur l'absence, contrairement
	// aux sections fixes de « Ma journée ».
	it('ne fabrique AUCUN groupe sur une liste vide', () => {
		expect(regrouperParDossier([])).toEqual([])
	})

	// LE GROUPE EST DÉSIGNÉ PAR L'IDENTIFIANT DU DOSSIER, jamais par son nom : deux tracks peuvent
	// nommer leur dossier « Prospection », et grouper par nom les fondrait en un seul.
	it('sépare deux dossiers HOMONYMES de tracks différents', () => {
		const groupes = regrouperParDossier([
			{ ...affaire('a', 'ch-un', 35), nomChannel: 'Prospection', nomTrack: 'Alpha' },
			{ ...affaire('b', 'ch-deux', 18), nomChannel: 'Prospection', nomTrack: 'Beta' },
		])
		expect(groupes).toHaveLength(2)
	})
})

describe('la lecture (docs/SPEC-relances.md §10.5)', () => {
	/** Un client minimal : la RPC, puis la lecture des cards. */
	const clientDouble = (options: {
		regle?: { data?: unknown; error?: unknown; status?: number }
		cards?: { data?: unknown; error?: unknown }
		espionSelect?: (colonnes: string) => void
		espionIn?: (colonne: string, valeurs: readonly string[]) => void
	}) => {
		const cards = {
			select: (colonnes: string) => {
				options.espionSelect?.(colonnes)
				return {
					in: (colonne: string, valeurs: readonly string[]) => {
						options.espionIn?.(colonne, valeurs)
						return Promise.resolve({ data: options.cards?.data ?? [], error: options.cards?.error ?? null })
					},
				}
			},
		}
		return {
			rpc: vi.fn(() =>
				Promise.resolve({
					data: options.regle?.data ?? [],
					error: options.regle?.error ?? null,
					status: options.regle?.status ?? 200,
				}),
			),
			from: vi.fn(() => cards),
		} as unknown as ClientCrm
	}

	it('appelle la RÈGLE, et la seconde lecture sur les SEULS identifiants qu’elle a rendus', async () => {
		const identifiants: string[] = []
		let colonnes = ''
		const client = clientDouble({
			regle: { data: [figee({ card_id: 'c1' }), figee({ card_id: 'c2', channel_id: 'ch2' })] },
			cards: { data: [complete('c1'), complete('c2', '2')] },
			espionSelect: (lues) => {
				colonnes = lues
			},
			espionIn: (_colonne, valeurs) => identifiants.push(...valeurs),
		})
		const lu = await lireAffairesFigees(client)
		expect(lu.statut).toBe('pret')
		// LA SECONDE LECTURE EST BORNÉE À CE QUE LA RÈGLE A DÉJÀ FILTRÉ : c'est ce que le §2.1
		// exigeait — ne pas « télécharger toutes les cards pour en écarter la quasi-totalité ».
		expect(identifiants).toEqual(['c1', 'c2'])
		// La chaîne `select` est CELLE DU PRODUIT, et non une chaîne recopiée dans la preuve.
		expect(colonnes).toBe(COLONNES_CARD_FIGEE)
	})

	// AUCUN SECOND APPEL QUAND LA RÈGLE NE REND RIEN : `id=in.()` serait une requête dont on connaît
	// déjà la réponse.
	it('n’émet AUCUNE seconde lecture quand la règle ne rend rien', async () => {
		let secondes = 0
		const client = clientDouble({ regle: { data: [] }, espionSelect: () => (secondes += 1) })
		const lu = await lireAffairesFigees(client)
		expect(lu.statut === 'pret' && lu.donnees).toEqual([])
		expect(secondes).toBe(0)
	})

	// L'ÉCHEC DE LA SECONDE LECTURE NE DOIT PAS EFFACER LA PREMIÈRE. Une liste d'affaires en retard
	// vaut mieux dégradée — titres, retards et seuils — que remplacée par une erreur : c'est le sort
	// d'une affaire absente de cette lecture, généralisé à toutes (§10.5).
	it('rend la liste SANS liens quand la seconde lecture échoue', async () => {
		const client = clientDouble({
			regle: { data: [figee({ card_id: 'c1', title: 'Audit' })] },
			cards: { error: { message: 'boom' } },
		})
		const lu = await lireAffairesFigees(client)
		expect(lu.statut).toBe('pret')
		const [affaire] = lu.statut === 'pret' ? lu.donnees : []
		expect(affaire?.titre).toBe('Audit')
		expect(affaire?.adresse).toBeNull()
	})

	// L'ÉCHEC DE LA RÈGLE, LUI, EST UNE ERREUR : sans elle il n'y a aucune liste, et rendre un état
	// vide ferait passer une panne pour une bonne nouvelle — « aucune affaire ne dort » (§10.9).
	it('rend une ERREUR quand la règle échoue, jamais un état vide', async () => {
		const client = clientDouble({ regle: { error: { message: 'refus' }, status: 500 } })
		const lu = await lireAffairesFigees(client)
		expect(lu.statut).toBe('erreur')
	})
})
