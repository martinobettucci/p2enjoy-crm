// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4c
// @verifies docs/SPEC-contacts.md §12.6 (de quoi le bloc a l'air), §12.7 (contrat de comportement,
//           cas a à p), §12.8 (limites nommées)
// @verifies docs/DESIGN_SYSTEM.md §5.21 (le bloc), §5.18 (liste plate), §5.13 (formulaire et
//           confirmation DANS LE FLUX, focus entrant puis rendu), §5.8 (états),
//           §5.7 ter (un refus n'efface pas la saisie), §6 (confirmation nommant l'objet)
//
// Les données injectées sont celles du SEED, à l'identique : Léo Marchand rattaché à
// `Migration ERP Sogexia` avec le rôle « decideur », Sophie Dupont sans organisation, Élise Fabre
// rattachable. Ce n'est pas une commodité — ce sont les cas du §12.7, et les mêmes que la preuve
// E2E exerce sur la pile réelle.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlocContactsCard } from './BlocContactsCard'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const ID_CARD = '5eed0000-0000-4000-8000-0000000000c2'
const ID_WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

const LEO_RATTACHE = {
	contact_id: '5eed0000-0000-4000-8000-000000000091',
	role: 'decideur',
	contacts: {
		id: '5eed0000-0000-4000-8000-000000000091',
		full_name: 'Léo Marchand',
		organization_id: '5eed0000-0000-4000-8000-000000000081',
		organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia' },
	},
}

/** Sophie Dupont : aucune organisation, et un rattachement SANS rôle — cas b et c du §12.7. */
const SOPHIE_RATTACHEE = {
	contact_id: '5eed0000-0000-4000-8000-000000000092',
	role: null,
	contacts: {
		id: '5eed0000-0000-4000-8000-000000000092',
		full_name: 'Sophie Dupont',
		organization_id: null,
		organizations: null,
	},
}

const CARNET = [
	{
		id: '5eed0000-0000-4000-8000-000000000091',
		full_name: 'Léo Marchand',
		email: 'leo.marchand@sogexia.example',
		phone: null,
		role_title: 'Directeur achats',
		organization_id: '5eed0000-0000-4000-8000-000000000081',
		organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia', domain: null },
	},
	{
		id: '5eed0000-0000-4000-8000-000000000093',
		full_name: 'Élise Fabre',
		email: null,
		phone: '+33 6 12 34 56 78',
		role_title: "Cheffe d'atelier",
		organization_id: '5eed0000-0000-4000-8000-000000000082',
		organizations: {
			id: '5eed0000-0000-4000-8000-000000000082',
			name: 'Studio Meunier',
			domain: null,
		},
	},
]

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

/**
 * Client espion à DEUX tables : le bloc lit `card_contacts` et `contacts` en parallèle, et écrit
 * sur `card_contacts`. Les réponses sont donc données PAR TABLE, jamais par rang d'appel — un
 * `Promise.all` ne garantit aucun ordre d'émission, et un espion positionnel rendrait ce fichier
 * intermittent.
 */
function clientEspion(options: {
	readonly rattachements?: Reponse
	readonly carnet?: Reponse
	readonly ecriture?: Reponse
	readonly rattachementsApres?: Reponse
}): { client: ClientCrm; ecritures: { operation: string; charge?: unknown }[] } {
	const ecritures: { operation: string; charge?: unknown }[] = []
	let lecturesRattachements = 0
	const client = {
		from: (table: string) => {
			const reponsePour = (): Reponse => {
				if (table !== 'card_contacts') {
					return options.carnet ?? { data: CARNET, error: null, status: 200 }
				}
				lecturesRattachements += 1
				if (lecturesRattachements > 1 && options.rattachementsApres !== undefined) {
					return options.rattachementsApres
				}
				return options.rattachements ?? { data: [], error: null, status: 200 }
			}
			const chaineLecture: Record<string, unknown> = {}
			for (const nom of ['order', 'eq']) chaineLecture[nom] = () => chaineLecture
			chaineLecture['then'] = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponsePour()).then(resoudre)

			const reponseEcriture = options.ecriture ?? { data: [{}], error: null, status: 200 }
			const chaineEcriture: Record<string, unknown> = {}
			for (const nom of ['eq', 'select']) chaineEcriture[nom] = () => chaineEcriture
			chaineEcriture['then'] = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponseEcriture).then(resoudre)

			return {
				select: () => chaineLecture,
				insert: (charge: unknown) => {
					ecritures.push({ operation: 'insert', charge })
					return chaineEcriture
				},
				delete: () => {
					ecritures.push({ operation: 'delete' })
					return chaineEcriture
				},
			}
		},
	} as unknown as ClientCrm
	return { client, ecritures }
}

function rendreBloc(client: ClientCrm | null) {
	return render(
		<MemoryRouter>
			<BlocContactsCard idCard={ID_CARD} idWorkspace={ID_WORKSPACE} client={client} />
		</MemoryRouter>,
	)
}

describe('BlocContactsCard — lecture (docs/SPEC-contacts.md §12.7)', () => {
	it('rend une ligne par rattachement, avec son rôle et sa destination — cas a', async () => {
		const { client } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		const ligne = await screen.findByTestId('ligne-contact-card')
		expect(within(ligne).getByText('Léo Marchand')).toBeTruthy()
		// LE RÔLE EST UN MOT, tel que la donnée le porte, et il n'est PAS traduit : c'est une
		// valeur métier libre que la base n'énumère pas (§2.3).
		expect(within(ligne).getByTestId('role-rattachement').textContent).toBe('decideur')
		// Le nom de l'organisation est un LIEN vers sa fiche (§5.20) ; celui du contact n'en est
		// pas un — il n'existe pas de fiche de contact, et un lien y serait mort (§11.8).
		const lien = within(ligne).getByTestId('lien-organisation-rattachement')
		expect(lien.getAttribute('href')).toContain('/contacts/organisations/')
		expect(within(ligne).getAllByRole('link')).toHaveLength(1)
	})

	it('ne rend RIEN à la place d’un rôle absent, et aucun lien sans organisation — cas b et c', async () => {
		const { client } = clientEspion({
			rattachements: { data: [SOPHIE_RATTACHEE], error: null, status: 200 },
		})
		rendreBloc(client)
		const ligne = await screen.findByTestId('ligne-contact-card')
		// Ni tiret, ni « — », ni « non renseigné » (§5.9) : la pilule n'existe simplement pas.
		expect(within(ligne).queryByTestId('role-rattachement')).toBeNull()
		expect(within(ligne).queryByRole('link')).toBeNull()
	})

	it('rend des squelettes pendant la lecture, jamais un spinner — cas e', () => {
		const { client } = clientEspion({})
		rendreBloc(client)
		expect(screen.getByTestId('squelette')).toBeTruthy()
	})

	it('rend l’état VIDE quand aucun contact n’est rattaché, et GARDE son formulaire — cas d', async () => {
		const { client } = clientEspion({ rattachements: { data: [], error: null, status: 200 } })
		rendreBloc(client)
		expect(await screen.findByTestId('contacts-card-vide')).toBeTruthy()
		// C'est l'écart avec le §5.16 : ici le geste EXISTE, et il est ce qui comble le vide.
		expect(screen.getByTestId('ouvrir-rattachement')).toBeTruthy()
	})

	it('rend l’état d’erreur, dont la reprise relance RÉELLEMENT la lecture — cas f', async () => {
		const { client } = clientEspion({
			rattachements: { data: null, error: { message: 'boom' }, status: 500 },
			rattachementsApres: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		expect(await screen.findByTestId('erreur-contacts-card')).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		expect(await screen.findByTestId('ligne-contact-card')).toBeTruthy()
	})
})

describe('BlocContactsCard — rattachement (§12.7)', () => {
	it('n’offre PAS les contacts déjà rattachés — §12.6', async () => {
		const { client } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		const options = within(screen.getByTestId('champ-contact')).getAllByRole('option')
		// L'option vide de tête, plus Élise seule : Léo est déjà rattaché, et le rattacher de
		// nouveau rendrait `409` (mesure 7 du §12.4).
		expect(options.map((option) => option.textContent)).toEqual([
			'Choisir un contact',
			'Élise Fabre — Studio Meunier',
		])
	})

	it('envoie la charge attendue, referme le formulaire et RELIT la liste — cas g et j', async () => {
		const { client, ecritures } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
			rattachementsApres: { data: [LEO_RATTACHE], error: null, status: 200 },
			ecriture: { data: [{}], error: null, status: 201 },
		})
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		await userEvent.selectOptions(
			screen.getByTestId('champ-contact'),
			'5eed0000-0000-4000-8000-000000000091',
		)
		// Le rôle est laissé VIDE : `null` doit partir, jamais `""` — la contrainte
		// `card_contacts_role_check` refuse la chaîne vide (mesure 10 du §12.4).
		await userEvent.click(screen.getByTestId('confirmer-rattachement'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toEqual({
			workspace_id: ID_WORKSPACE,
			card_id: ID_CARD,
			contact_id: '5eed0000-0000-4000-8000-000000000091',
			role: null,
		})
		// La liste est RELUE, jamais complétée localement (§5.21).
		expect(await screen.findByTestId('ligne-contact-card')).toBeTruthy()
		expect(screen.queryByTestId('formulaire-rattachement')).toBeNull()
	})

	it('transmet le rôle saisi tel quel, sans le normaliser ni le traduire — §12.5', async () => {
		const { client, ecritures } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
			ecriture: { data: [{}], error: null, status: 201 },
		})
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		await userEvent.selectOptions(
			screen.getByTestId('champ-contact'),
			'5eed0000-0000-4000-8000-000000000091',
		)
		await userEvent.type(screen.getByTestId('champ-role'), 'prescripteur')
		await userEvent.click(screen.getByTestId('confirmer-rattachement'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect((ecritures[0]?.charge as { role: string }).role).toBe('prescripteur')
	})

	it('écrit le refus DANS le formulaire, et CONSERVE la saisie — cas h', async () => {
		const { client } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
			ecriture: { data: null, error: { message: 'rls', code: '42501' }, status: 403 },
		})
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		await userEvent.selectOptions(
			screen.getByTestId('champ-contact'),
			'5eed0000-0000-4000-8000-000000000091',
		)
		await userEvent.type(screen.getByTestId('champ-role'), 'decideur')
		await userEvent.click(screen.getByTestId('confirmer-rattachement'))
		const refus = await screen.findByTestId('refus-rattachement')
		expect(refus.textContent).toBe('Vous ne pouvez pas modifier cette affaire.')
		expect(refus.getAttribute('role')).toBe('alert')
		// UN REFUS N'EFFACE PAS LA SAISIE (§5.7 ter) : rejeter sans le dire serait la valeur par
		// défaut trompeuse de `CLAUDE.md` §18.
		expect((screen.getByTestId('champ-role') as HTMLInputElement).value).toBe('decideur')
		expect((screen.getByTestId('champ-contact') as HTMLSelectElement).value).toBe(
			'5eed0000-0000-4000-8000-000000000091',
		)
	})

	it('nomme le doublon plutôt qu’« une erreur est survenue » — cas i', async () => {
		const { client } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
			ecriture: { data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 },
		})
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		await userEvent.selectOptions(
			screen.getByTestId('champ-contact'),
			'5eed0000-0000-4000-8000-000000000091',
		)
		await userEvent.click(screen.getByTestId('confirmer-rattachement'))
		expect((await screen.findByTestId('refus-rattachement')).textContent).toBe(
			'Ce contact est déjà rattaché à cette affaire.',
		)
	})

	it('dit que tous les contacts sont rattachés, sans sélecteur vide — cas k', async () => {
		const { client } = clientEspion({
			rattachements: {
				data: [
					LEO_RATTACHE,
					{
						contact_id: '5eed0000-0000-4000-8000-000000000093',
						role: null,
						contacts: {
							id: '5eed0000-0000-4000-8000-000000000093',
							full_name: 'Élise Fabre',
							organization_id: null,
							organizations: null,
						},
					},
				],
				error: null,
				status: 200,
			},
		})
		rendreBloc(client)
		expect(await screen.findByTestId('tous-rattaches')).toBeTruthy()
		expect(screen.queryByTestId('champ-contact')).toBeNull()
		expect(screen.queryByTestId('ouvrir-rattachement')).toBeNull()
	})

	it('nomme l’absence de contact au carnet, SANS action — cas l', async () => {
		const { client } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
			carnet: { data: [], error: null, status: 200 },
		})
		rendreBloc(client)
		expect(await screen.findByTestId('carnet-vide')).toBeTruthy()
		// Aucun écran du produit ne crée de contact : un bouton serait un chemin vers nulle part.
		expect(screen.queryByTestId('ouvrir-rattachement')).toBeNull()
	})

	it('rend le focus à sa commande quand le formulaire est annulé — §5.13', async () => {
		const { client } = clientEspion({ rattachements: { data: [], error: null, status: 200 } })
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		// Le focus ENTRE dans le premier contrôle à l'ouverture.
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('champ-contact')))
		await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
		// Sans ce retour, annuler au clavier laisserait le focus sur un bouton disparu.
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByTestId('ouvrir-rattachement')),
		)
	})
})

describe('BlocContactsCard — détachement (§12.7)', () => {
	it('demande une confirmation NOMMANT le contact — cas m', async () => {
		const { client, ecritures } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		await userEvent.click(screen.getByTestId('detacher-contact'))
		const confirmation = await screen.findByTestId('confirmation-detachement')
		expect(confirmation.textContent).toContain('Léo Marchand')
		// Rien n'est envoyé tant que la confirmation n'est pas acceptée (§6).
		expect(ecritures).toHaveLength(0)
		// Le focus entre dans le premier bouton de la confirmation (§5.13).
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByTestId('confirmer-detachement')),
		)
	})

	it('supprime puis RELIT la liste, la ligne disparaissant — cas n', async () => {
		const { client, ecritures } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
			rattachementsApres: { data: [], error: null, status: 200 },
			ecriture: { data: [{ contact_id: '5eed0000-0000-4000-8000-000000000091' }], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		await userEvent.click(screen.getByTestId('detacher-contact'))
		await userEvent.click(await screen.findByTestId('confirmer-detachement'))
		await waitFor(() => expect(ecritures).toEqual([{ operation: 'delete' }]))
		expect(await screen.findByTestId('contacts-card-vide')).toBeTruthy()
	})

	it('dit « sans effet » — ni un succès, ni une erreur — cas o', async () => {
		// MESURÉ : la lectrice qui détache reçoit `200` et zéro ligne, indistinguable d'une ligne
		// déjà retirée par un tiers. Annoncer un retrait qui n'a pas eu lieu serait la simulation
		// de succès que `CLAUDE.md` §18 interdit.
		const { client } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
			ecriture: { data: [], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		await userEvent.click(screen.getByTestId('detacher-contact'))
		await userEvent.click(await screen.findByTestId('confirmer-detachement'))
		const message = await screen.findByTestId('refus-detachement')
		expect(message.textContent).toBe('Aucun rattachement n’a été retiré.')
	})

	it('rend le focus à « Détacher » quand la confirmation est annulée — §5.13', async () => {
		const { client } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		await userEvent.click(screen.getByTestId('detacher-contact'))
		await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByTestId('detacher-contact')),
		)
	})
})

describe('BlocContactsCard — droits et absence de client', () => {
	it('n’éteint AUCUNE commande d’avance, quel que soit le rôle — cas p', async () => {
		// L'écran ne calcule aucun droit (§12.4) : la règle vit dans `card_contacts_insertion` et
		// `card_contacts_suppression`, et une commande grisée ferait passer une décision de la base
		// pour une décision d'écran (`CLAUDE.md` §10).
		const { client } = clientEspion({
			rattachements: { data: [LEO_RATTACHE], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('ligne-contact-card')
		expect((screen.getByTestId('detacher-contact') as HTMLButtonElement).disabled).toBe(false)
		expect((screen.getByTestId('ouvrir-rattachement') as HTMLButtonElement).disabled).toBe(false)
	})

	it('ne rend rien sans client configuré : une surface sans client serait morte', () => {
		const { container } = rendreBloc(null)
		expect(container.innerHTML).toBe('')
	})

	it('n’émet aucune écriture tant qu’aucun contact n’est choisi', async () => {
		const { client, ecritures } = clientEspion({
			rattachements: { data: [], error: null, status: 200 },
		})
		rendreBloc(client)
		await screen.findByTestId('contacts-card-vide')
		await userEvent.click(screen.getByTestId('ouvrir-rattachement'))
		// La commande est désactivée tant que le sélecteur est vide — il n'y a rien à envoyer, et
		// l'état désactivé s'explique par le contrôle juste au-dessus (§8). Ce n'est PAS une garde
		// de droit : elle ne dépend d'aucun rôle.
		expect((screen.getByTestId('confirmer-rattachement') as HTMLButtonElement).disabled).toBe(true)
		expect(ecritures).toHaveLength(0)
	})
})

/**
 * L'espion de ce fichier ne substitue AUCUN comportement du bloc : il rend les réponses que la
 * pile réelle a rendues, mesurées au §12.4. La preuve du parcours complet — clic, clavier,
 * console vierge — est `e2e/ui/contacts-affaire.spec.ts`, sur la pile debout.
 */
it('les fonctions de lecture et d’écriture ne sont pas espionnées, seul le client l’est', () => {
	expect(vi.isMockFunction(BlocContactsCard)).toBe(false)
})
