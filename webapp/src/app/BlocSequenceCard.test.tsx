// @verifies INC-365 (docs/BACKLOG.md, relevé du 2026-11-24 ; décisions 985 et 986) — le bloc « Relance automatique » rend un
//           squelette, et ni l'état ni le geste, tant que l'inscription active, les séquences et les adresses proposées ne
//           sont pas lues ; une lecture en échec termine le chargement ; le squelette revient le temps de la relecture qui
//           suit un armement (docs/DESIGN_SYSTEM.md §5.42, §5.8 ; docs/SPEC-modeles-emails.md §13.8)
//
// LE VRAI COMPOSANT, SES TROIS LECTURES REMPLACÉES PAR DES PROMESSES QUE LE TEST RÉSOUT LUI-MÊME : c'est l'ordre d'arrivée
// des réponses qui fait le défaut, et seul un test qui le tient en main le prouve. Le parcours réel contre la base est
// `e2e/ui/armement-sequence.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EtatAsync } from '../lib/async'
import type { IdentiteEnvoi } from '../lib/envoi'
import type { InscriptionSequence, IssueArmement, SequenceRelance } from '../lib/sequences-relance'

type Differee<T> = { promesse: Promise<T>; resoudre: (valeur: T) => void }

function differee<T>(): Differee<T> {
	let resoudre!: (valeur: T) => void
	const promesse = new Promise<T>((r) => {
		resoudre = r
	})
	return { promesse, resoudre }
}

const lectures: {
	inscription: Differee<EtatAsync<InscriptionSequence | null>>[]
	sequences: Differee<EtatAsync<readonly SequenceRelance[]>>
	identites: Differee<readonly IdentiteEnvoi[]>
	armement: IssueArmement
} = { inscription: [], sequences: differee(), identites: differee(), armement: 'arme' }

vi.mock('../lib/supabase', () => ({ clientCrm: {} }))
vi.mock('./Authentification', () => ({
	useAuthentification: () => ({ etat: { statut: 'authentifie', utilisateur: { id: 'personne-1' } } }),
}))
vi.mock('../lib/sequences-relance', async (original) => ({
	...(await original<typeof import('../lib/sequences-relance')>()),
	lireInscriptionActive: () => {
		const lecture = differee<EtatAsync<InscriptionSequence | null>>()
		lectures.inscription.push(lecture)
		return lecture.promesse
	},
	lireRelanceArreteeFauteDeDomaine: () => Promise.resolve(false),
	lireSequences: () => lectures.sequences.promesse,
	armerSequence: () => Promise.resolve(lectures.armement),
}))
vi.mock('../lib/envoi', async (original) => ({
	...(await original<typeof import('../lib/envoi')>()),
	lireIdentitesDisponibles: () => lectures.identites.promesse,
}))

const { BlocSequenceCard } = await import('./BlocSequenceCard')

const SEQUENCE: SequenceRelance = { id: 'seq-1', workspace_id: 'espace-1', name: 'Relance devis', paliers: 2 }
const IDENTITE: IdentiteEnvoi = { id: 'id-1', libelle: 'Envoi A', adresse: 'a@p2enjoy.test', parDefaut: true }
const ACTIVE: InscriptionSequence = {
	id: 'inscription-1',
	sequence: 'Relance devis',
	identite: 'id-1',
	adresse: 'a@p2enjoy.test',
	armed_at: '2026-11-24T08:00:00Z',
	last_position: null,
	last_sent_at: null,
}

function rendre() {
	render(
		<BlocSequenceCard
			idCard="card-1"
			idWorkspace="espace-1"
			rattachements={{ card_placements: [{ id: 'rattachement-1', created_at: '2026-11-01T00:00:00Z' }] }}
		/>,
	)
}

/** Le chargement : le squelette annoncé, et aucune des deux branches. */
function attendreChargement() {
	expect(screen.getByRole('status', { name: 'Chargement en cours' })).toBeTruthy()
	expect(screen.queryByTestId('sequence-armement')).toBeNull()
	expect(screen.queryByTestId('sequence-vide')).toBeNull()
	expect(screen.queryByTestId('armer-sequence')).toBeNull()
	expect(screen.queryByTestId('sequence-active')).toBeNull()
	expect(screen.queryByTestId('sequence-aucune-sequence')).toBeNull()
	expect(screen.queryByTestId('sequence-aucune-identite')).toBeNull()
}

/** Laisse passer les microtâches : une réponse qui n'est pas arrivée ne doit pas avoir changé l'écran. */
const laisserPasser = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
	lectures.inscription = []
	lectures.sequences = differee()
	lectures.identites = differee()
	lectures.armement = 'arme'
})

afterEach(cleanup)

describe('BlocSequenceCard — le chargement avant les deux états (INC-365)', () => {
	it("pendant la lecture de l'inscription, n'affirme pas « aucune relance » et n'offre pas d'armer", async () => {
		rendre()
		lectures.sequences.resoudre({ statut: 'pret', donnees: [SEQUENCE] })
		lectures.identites.resoudre([IDENTITE])
		await laisserPasser()
		attendreChargement()

		lectures.inscription[0]!.resoudre({ statut: 'pret', donnees: null })
		expect((await screen.findByTestId('sequence-vide')).textContent).toContain('Aucune relance')
		expect(screen.getByTestId('armer-sequence')).toBeTruthy()
		expect(screen.queryByRole('status', { name: 'Chargement en cours' })).toBeNull()
	})

	it("une relance armée lue rend son état, sans être passée par le geste d'armer", async () => {
		rendre()
		lectures.sequences.resoudre({ statut: 'pret', donnees: [SEQUENCE] })
		lectures.identites.resoudre([IDENTITE])
		await laisserPasser()
		attendreChargement()

		lectures.inscription[0]!.resoudre({ statut: 'pret', donnees: ACTIVE })
		expect((await screen.findByTestId('sequence-active-nom')).textContent).toContain('Relance devis')
		expect(screen.queryByTestId('armer-sequence')).toBeNull()
	})

	it("pendant la lecture des séquences, n'affirme pas « aucune séquence »", async () => {
		rendre()
		lectures.inscription[0]!.resoudre({ statut: 'pret', donnees: null })
		lectures.identites.resoudre([IDENTITE])
		await laisserPasser()
		attendreChargement()

		lectures.sequences.resoudre({ statut: 'pret', donnees: [] })
		expect(await screen.findByTestId('sequence-aucune-sequence')).toBeTruthy()
	})

	it("pendant la lecture des adresses, n'affirme pas « aucune adresse »", async () => {
		rendre()
		lectures.inscription[0]!.resoudre({ statut: 'pret', donnees: null })
		lectures.sequences.resoudre({ statut: 'pret', donnees: [SEQUENCE] })
		await laisserPasser()
		attendreChargement()

		lectures.identites.resoudre([])
		expect(await screen.findByTestId('sequence-aucune-identite')).toBeTruthy()
		expect(screen.getByTestId('champ-sequence')).toBeTruthy()
	})

	it("une lecture de l'inscription en échec termine le chargement : l'erreur est dite, le geste reste offert", async () => {
		rendre()
		lectures.sequences.resoudre({ statut: 'pret', donnees: [SEQUENCE] })
		lectures.identites.resoudre([IDENTITE])
		lectures.inscription[0]!.resoudre({ statut: 'erreur', erreur: { nature: 'network', detail: 'hors ligne' } })
		expect(await screen.findByTestId('sequence-erreur')).toBeTruthy()
		expect(screen.getByTestId('armer-sequence')).toBeTruthy()
		expect(screen.queryByRole('status', { name: 'Chargement en cours' })).toBeNull()
	})

	it("le squelette revient le temps de la relecture qui suit un armement, puis l'état", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		lectures.sequences.resoudre({ statut: 'pret', donnees: [SEQUENCE] })
		lectures.identites.resoudre([IDENTITE])
		lectures.inscription[0]!.resoudre({ statut: 'pret', donnees: null })
		await utilisateur.selectOptions(await screen.findByTestId('champ-sequence'), 'seq-1')
		await utilisateur.click(screen.getByTestId('armer-sequence'))

		await waitFor(() => expect(lectures.inscription).toHaveLength(2))
		attendreChargement()
		lectures.inscription[1]!.resoudre({ statut: 'pret', donnees: ACTIVE })
		expect(await screen.findByTestId('sequence-active')).toBeTruthy()
	})
})
