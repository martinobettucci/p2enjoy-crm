// @verifies CRM-124 (docs/BACKLOG.md) T2 — la prévisualisation d'un modèle présélectionne l'unique contact rattaché à
//           l'affaire choisie : un rattaché, aucun, plusieurs, choix manuel conservé, présélection retirée, lecture en
//           échec, réponse périmée ignorée, identifiant transmis au rendu
// @verifies docs/SPEC-modeles-emails.md §9.5 (révision `CRM-124`, décision 806) ; docs/DESIGN_SYSTEM.md §5.39
//
// L'écran RÉEL est monté sur un client espion qui sert les lectures et retient la réponse des rattachements d'une affaire,
// pour éprouver l'ordre d'arrivée. La pile réelle est éprouvée par `e2e/ui/reglages-modeles-emails.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPACITES_INCONNUES } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesModelesEmails } from './ReglagesModelesEmails'

afterEach(cleanup)

const LEO = 'c-leo'
const DUPONT = 'c-dupont'
const MARTIN = 'c-martin'
const contact = (id: string, full_name: string) => ({
	id, full_name, email: null, phone: null, role_title: null, organization_id: null, organizations: null,
})
const CONTACTS = [contact(DUPONT, 'Claire Dupont'), contact(LEO, 'Léo Marchand'), contact(MARTIN, 'Paul Martin')]
const AFFAIRES = [
	{ id: 'a-sogexia', title: 'Migration ERP Sogexia' },
	{ id: 'a-vide', title: 'Affaire sans contact' },
	{ id: 'a-deux', title: 'Affaire à deux contacts' },
	{ id: 'a-dupont', title: 'Affaire de Claire' },
	{ id: 'a-panne', title: 'Affaire illisible' },
]
const rattache = (contactId: string) => ({ contact_id: contactId, role: null, contacts: { id: contactId, full_name: contactId, organizations: null } })
const RATTACHEMENTS: Record<string, readonly unknown[]> = {
	'a-sogexia': [rattache(LEO)],
	'a-vide': [],
	'a-deux': [rattache(DUPONT), rattache(LEO)],
	'a-dupont': [rattache(DUPONT)],
}

type Reponse = { data: unknown; error: unknown; status: number }

/** Le client espion ; `retenir` garde la réponse des rattachements d'une affaire jusqu'à ce que le test la libère. */
function client(retenir: ReadonlySet<string> = new Set()) {
	const rendus: Record<string, unknown>[] = []
	const liberations = new Map<string, () => void>()
	const repondre = (table: string, carte: string | null): Reponse => {
		if (table === 'workspaces') return { data: [{ id: 'ws-1', name: 'Démo', slug: 'demo' }], error: null, status: 200 }
		if (table === 'mail_templates') {
			return { data: [{ id: 'm-1', workspace_id: 'ws-1', name: 'Relance', subject: 'Objet', body_text: 'Corps' }], error: null, status: 200 }
		}
		if (table === 'cards') return { data: AFFAIRES, error: null, status: 200 }
		if (table === 'contacts') return { data: CONTACTS, error: null, status: 200 }
		if (table === 'card_contacts') {
			if (carte === null || !(carte in RATTACHEMENTS)) return { data: null, error: { message: 'boom' }, status: 500 }
			return { data: RATTACHEMENTS[carte], error: null, status: 200 }
		}
		return { data: [], error: null, status: 200 }
	}
	const faux = {
		from: (table: string) => {
			let carte: string | null = null
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'order', 'is', 'in', 'limit', 'neq']) maillon[methode] = () => maillon
			maillon.eq = (colonne: string, valeur: string) => {
				if (colonne === 'card_id') carte = valeur
				return maillon
			}
			maillon.then = (resoudre: (r: Reponse) => unknown) => {
				const reponse = repondre(table, carte)
				if (table === 'card_contacts' && carte !== null && retenir.has(carte)) {
					return new Promise((fin) => liberations.set(carte!, () => fin(resoudre(reponse))))
				}
				return resoudre(reponse)
			}
			return maillon
		},
		rpc: (nom: string, args: Record<string, unknown>) => {
			if (nom === 'rendre_modele_email') rendus.push(args)
			const data = nom === 'mail_template_variables' ? ['contact.full_name'] : [{ subject: 'Objet', body_text: 'Corps', variables_nulles: [] }]
			return Promise.resolve({ data, error: null, status: 200 })
		},
	} as unknown as ClientCrm
	return { client: faux, rendus, liberer: (carte: string) => liberations.get(carte)?.() }
}

async function ouvrirPrevisualisation(c: ClientCrm) {
	render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES } }}>
			<ReglagesModelesEmails client={c} />
		</FournisseurEspace>,
	)
	await userEvent.click(await screen.findByTestId('previsualiser-modele'))
	const affaire = screen.getByTestId('champ-affaire-previsualisation') as HTMLSelectElement
	const contactChamp = screen.getByTestId('champ-contact-previsualisation') as HTMLSelectElement
	// Les listes arrivent : la présélection exige que le contact soit proposé.
	await waitFor(() => expect(contactChamp.options.length).toBe(CONTACTS.length + 1))
	await waitFor(() => expect(affaire.options.length).toBe(AFFAIRES.length + 1))
	return { affaire, contact: contactChamp }
}

describe('le contact présélectionné de la prévisualisation (§9.5, CRM-124)', () => {
	it('présélectionne l’unique contact rattaché, et le transmet au rendu', async () => {
		const { client: c, rendus } = client()
		const { affaire, contact: champ } = await ouvrirPrevisualisation(c)
		expect(champ.value).toBe('')
		await userEvent.selectOptions(affaire, 'a-sogexia')
		await waitFor(() => expect(champ.value).toBe(LEO))
		await userEvent.click(screen.getByTestId('lancer-previsualisation'))
		await waitFor(() => expect(rendus).toHaveLength(1))
		expect(rendus[0]).toMatchObject({ p_card_id: 'a-sogexia', p_contact_id: LEO })
	})

	it('aucun ou plusieurs rattachés : rien n’est présélectionné, et la présélection précédente est retirée', async () => {
		const { client: c } = client()
		const { affaire, contact: champ } = await ouvrirPrevisualisation(c)
		await userEvent.selectOptions(affaire, 'a-sogexia')
		await waitFor(() => expect(champ.value).toBe(LEO))
		await userEvent.selectOptions(affaire, 'a-deux')
		await waitFor(() => expect(champ.value).toBe(''))
		await userEvent.selectOptions(affaire, 'a-dupont')
		await waitFor(() => expect(champ.value).toBe(DUPONT))
		await userEvent.selectOptions(affaire, 'a-vide')
		await waitFor(() => expect(champ.value).toBe(''))
	})

	it('un choix manuel survit au changement d’affaire', async () => {
		const { client: c } = client()
		const { affaire, contact: champ } = await ouvrirPrevisualisation(c)
		await userEvent.selectOptions(champ, MARTIN)
		await userEvent.selectOptions(affaire, 'a-sogexia')
		// La lecture des rattachements a lieu ; le choix manuel reste.
		await userEvent.selectOptions(affaire, 'a-dupont')
		await new Promise((fin) => setTimeout(fin, 0))
		expect(champ.value).toBe(MARTIN)
	})

	it('une lecture en échec ne présélectionne rien, et retire la présélection de l’affaire précédente', async () => {
		const { client: c } = client()
		const { affaire, contact: champ } = await ouvrirPrevisualisation(c)
		await userEvent.selectOptions(affaire, 'a-sogexia')
		await waitFor(() => expect(champ.value).toBe(LEO))
		await userEvent.selectOptions(affaire, 'a-panne')
		await waitFor(() => expect(champ.value).toBe(''))
		// L'écran reste utilisable : rien n'est bloqué.
		expect((screen.getByTestId('lancer-previsualisation') as HTMLButtonElement).disabled).toBe(false)
	})

	it('une réponse arrivée après un nouveau changement d’affaire est ignorée', async () => {
		const { client: c, liberer } = client(new Set(['a-sogexia']))
		const { affaire, contact: champ } = await ouvrirPrevisualisation(c)
		await userEvent.selectOptions(affaire, 'a-sogexia')
		await userEvent.selectOptions(affaire, 'a-dupont')
		await waitFor(() => expect(champ.value).toBe(DUPONT))
		liberer('a-sogexia')
		await new Promise((fin) => setTimeout(fin, 0))
		expect(champ.value).toBe(DUPONT)
	})
})
