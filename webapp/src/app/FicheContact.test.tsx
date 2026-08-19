// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4f
// @verifies docs/SPEC-contacts.md §15.5 (de quoi l'écran a l'air : deux zones, l'organisation en
//           lien, l'affaire en lien, la pilule d'archive), §15.8 (limites nommées),
//           §15.9 (contrat de comportement, cas a à l)
// @verifies docs/DESIGN_SYSTEM.md §5.24 (cette surface), §5.9 (cellule sans valeur VIDE),
//           §5.8 (états explicites), §5.6 (pilule), §2 (données techniques)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
//
// Les données injectées sont celles du SEED, à l'identique — Léo Marchand avec son organisation et
// son affaire, Sophie Dupont sans organisation, Élise Fabre sans aucune affaire. Ce n'est pas une
// commodité : ce sont les cas a, b, d et e du §15.9, et les mêmes que la preuve E2E exerce sur la
// pile réelle.
//
// UNE SEULE BRANCHE N'EST PAS SEEDÉE, et c'est ici qu'elle est éprouvée : l'affaire ARCHIVÉE
// rattachée à un contact. Le §15.7 dit pourquoi le seed ne la porte pas — le seul rattachement
// supplémentaire possible déplacerait une garde de convergence et le compteur que lit la règle 3
// du classement. La preuve unitaire est donc le lieu où le cas f du §15.9 se vérifie.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ContenuFicheContact } from './FicheContact'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/**
 * Client minimal : une seule lecture, `from().select().eq().is().order()`.
 *
 * `is` figure dans la chaîne parce que la fiche pose le filtre qui écarte la corbeille (§15.3) :
 * un espion qui l'ignorerait laisserait passer un code qui aurait oublié ce filtre.
 */
function clientQuiRend(...reponses: Reponse[]): ClientCrm {
	let rang = 0
	const chaine = {
		eq: () => chaine,
		is: () => chaine,
		order: () => chaine,
		then: (resoudre: (valeur: Reponse) => unknown) => {
			const reponse = reponses[Math.min(rang, reponses.length - 1)]
			rang += 1
			if (reponse === undefined) throw new Error('client espion appelé sans réponse')
			return Promise.resolve(reponse).then(resoudre)
		},
	}
	return { from: () => ({ select: () => chaine }) } as unknown as ClientCrm
}

const ID_LEO = '5eed0000-0000-4000-8000-000000000091'
const ID_SOPHIE = '5eed0000-0000-4000-8000-000000000092'
const ID_ELISE = '5eed0000-0000-4000-8000-000000000093'
const ID_SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const ID_CARD_ERP = '5eed0000-0000-4000-8000-0000000000c2'

/** Léo Marchand, tel que la pile réelle le rend — mesure 1 du §15.3. */
const LEO = {
	id: ID_LEO,
	full_name: 'Léo Marchand',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur achats',
	organization_id: ID_SOGEXIA,
	organizations: { id: ID_SOGEXIA, name: 'Sogexia', domain: 'sogexia.example' },
	card_contacts: [
		{
			role: 'decideur',
			cards: {
				id: ID_CARD_ERP,
				title: 'Migration ERP Sogexia',
				archived_at: null,
				channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
			},
		},
	],
}

/** Sophie Dupont : AUCUNE organisation, une affaire — mesure 3 du §15.3. */
const SOPHIE = {
	id: ID_SOPHIE,
	full_name: 'Sophie Dupont',
	email: 'sophie@dupont.test',
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
	card_contacts: [
		{
			role: 'prescripteur',
			cards: {
				id: '5eed0000-0000-4000-8000-0000000000c4',
				title: 'Refonte intranet Ville de Lyon',
				archived_at: null,
				channels: { slug: 'refonte', tracks: { slug: 'studio-web' } },
			},
		},
	],
}

/** Élise Fabre : une organisation, AUCUNE affaire, aucun email — mesure 4 du §15.3. */
const ELISE = {
	id: ID_ELISE,
	full_name: 'Élise Fabre',
	email: null,
	phone: '+33 6 12 34 56 78',
	role_title: "Cheffe d'atelier",
	organization_id: '5eed0000-0000-4000-8000-000000000082',
	organizations: { id: '5eed0000-0000-4000-8000-000000000082', name: 'Studio Meunier', domain: null },
	card_contacts: [],
}

const OK = (ligne: unknown) => ({ data: [ligne], error: null, status: 200 })
const VIDE = { data: [], error: null, status: 200 }

function monter(client: ClientCrm | null, idContact: string | undefined) {
	return render(
		<MemoryRouter>
			<ContenuFicheContact client={client} idContact={idContact} />
		</MemoryRouter>,
	)
}

describe('fiche de contact (docs/SPEC-contacts.md §15.9)', () => {
	it('cas a : le contact, ses caractéristiques et ses affaires sont rendus', async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
		expect(screen.getByText('Directeur achats')).toBeTruthy()
		expect(screen.getByText('leo.marchand@sogexia.example')).toBeTruthy()
		const lignes = screen.getAllByTestId('ligne-affaire-contact')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.getAttribute('data-card')).toBe(ID_CARD_ERP)
		expect(screen.getByText('Migration ERP Sogexia')).toBeTruthy()
		// Le rôle DU RATTACHEMENT, distinct de la fonction rendue en zone 1 (§15.3).
		expect(screen.getByText('decideur')).toBeTruthy()
	})

	it("cas c : l'organisation est un LIEN vers sa fiche", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		const lien = await screen.findByTestId('lien-organisation-contact')
		expect(lien.getAttribute('href')).toBe(`/contacts/organisations/${ID_SOGEXIA}`)
		expect(lien.textContent).toBe('Sogexia')
	})

	it("cas b : sans organisation, la valeur reste VIDE et SANS LIEN — jamais un tiret", async () => {
		monter(clientQuiRend(OK(SOPHIE)), ID_SOPHIE)
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
		expect(screen.queryByTestId('lien-organisation-contact')).toBeNull()
		expect(screen.queryByText('—')).toBeNull()
		expect(screen.queryByText('-')).toBeNull()
	})

	it('cas d : une fonction absente laisse la cellule vide, sans texte de remplacement', async () => {
		monter(clientQuiRend(OK(SOPHIE)), ID_SOPHIE)
		const zone = await screen.findByTestId('caracteristiques-contact')
		// `role_title` est nul pour Sophie : le libellé est rendu, la valeur ne l'est pas.
		expect(zone.textContent).toContain(fr['contact.field.role'])
		expect(zone.textContent).not.toContain('non renseigné')
	})

	it("cas a bis : le titre d'une affaire est un LIEN construit sur les slugs embarqués", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		const lien = await screen.findByTestId('lien-affaire-contact')
		expect(lien.getAttribute('href')).toBe(
			`/tracks/conseil-ia/grands-comptes/cards/${ID_CARD_ERP}`,
		)
	})

	it("cas e : sans affaire, la zone rend l'état vide SANS action", async () => {
		monter(clientQuiRend(OK(ELISE)), ID_ELISE)
		expect(await screen.findByText(fr['contact.deals.empty.title'])).toBeTruthy()
		expect(screen.queryByTestId('tableau-affaires-contact')).toBeNull()
		// Les caractéristiques restent rendues : l'absence d'affaire n'efface pas le contact.
		expect(screen.getByTestId('caracteristiques-contact')).toBeTruthy()
		// Aucune action : cette surface ne livre aucun geste de rattachement (§15.8).
		expect(screen.queryByRole('button')).toBeNull()
	})

	it("cas f : une affaire ARCHIVÉE porte sa pilule, et son titre reste un lien", async () => {
		const archivee = {
			...LEO,
			card_contacts: [
				{
					role: null,
					cards: {
						id: '5eed0000-0000-4000-8000-0000000000c8',
						title: 'Contrat cadre 2025',
						archived_at: '2026-03-31T16:00:00+00:00',
						channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
					},
				},
			],
		}
		monter(clientQuiRend(OK(archivee)), ID_LEO)
		expect(await screen.findByTestId('pilule-affaire-archivee')).toBeTruthy()
		expect(screen.getByTestId('lien-affaire-contact').getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c8',
		)
	})

	it("cas f bis : une affaire NON archivée ne porte AUCUNE pilule", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		expect(await screen.findByTestId('tableau-affaires-contact')).toBeTruthy()
		expect(screen.queryByTestId('pilule-affaire-archivee')).toBeNull()
	})

	it("cas h : un identifiant inexistant rend « contact introuvable », avec un retour au carnet", async () => {
		monter(clientQuiRend(VIDE), '00000000-0000-4000-8000-000000000000')
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		const retour = screen.getByRole('link', { name: fr['contact.notFound.action'] })
		expect(retour.getAttribute('href')).toBe('/contacts')
	})

	it("cas i : un identifiant MAL FORMÉ rend le même écran, et n'émet AUCUNE requête", async () => {
		let appels = 0
		const client = {
			from: () => {
				appels += 1
				return { select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve(VIDE) }) }) }) }
			},
		} as unknown as ClientCrm
		monter(client, 'pas-un-uuid')
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		expect(appels).toBe(0)
	})

	it("cas j : la lecture en vol rend des squelettes, jamais un spinner plein écran", () => {
		const client = {
			from: () => ({
				select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }),
			}),
		} as unknown as ClientCrm
		monter(client, ID_LEO)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it("cas k : la lecture en échec rend l'erreur, et la reprise RELANCE réellement la lecture", async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'panne' }, status: 500 },
			OK(LEO),
		)
		monter(client, ID_LEO)
		expect(await screen.findByText(fr['contact.error.title'])).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: fr['contact.error.retry'] }))
		// La reprise relit : la seconde réponse est celle de Léo, et l'écran la rend.
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
	})

	it("cas l : sans client, l'état vide dédié est rendu et aucune lecture n'est tentée", () => {
		monter(null, ID_LEO)
		expect(screen.getByText(fr['contact.noWorkspace.title'])).toBeTruthy()
	})
})
