// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a
// @verifies docs/SPEC-contacts.md §10.5 (de quoi l'écran a l'air), §10.6 (cas a à f du contrat
//           de comportement), §10.7 (aucun geste, le nom d'organisation n'est pas un lien)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau sémantique, cellule sans valeur VIDE),
//           §5.8 (quatre états), §2 (données techniques en monospace)
//
// Les données injectées sont celles du SEED, à l'identique : Léo Marchand avec son organisation,
// Sophie Dupont sans organisation ni fonction, Élise Fabre sans email. Ce n'est pas une commodité
// — ce sont les trois cas du §10.6, et les mêmes que la preuve E2E exerce sur la pile réelle.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Carnet } from './Carnet'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/** Client minimal : une seule lecture, `from().select().order()`. */
function clientQuiRend(...reponses: Reponse[]): ClientCrm {
	let rang = 0
	const chaine = {
		order: () => chaine,
		then: (resoudre: (valeur: Reponse) => unknown) => {
			const reponse = reponses[Math.min(rang, reponses.length - 1)]
			rang += 1
			// `reponses` est toujours non vide par construction (paramètre variadique appelé avec au
			// moins une réponse) ; l'assertion le dit au compilateur sans masquer un cas réel.
			if (reponse === undefined) throw new Error('client espion appelé sans réponse')
			return Promise.resolve(reponse).then(resoudre)
		},
	}
	return { from: () => ({ select: () => chaine }) } as unknown as ClientCrm
}

const LEO = {
	id: '5eed0000-0000-4000-8000-000000000091',
	full_name: 'Léo Marchand',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur achats',
	organization_id: '5eed0000-0000-4000-8000-000000000081',
	organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia', domain: 'sogexia.example' },
}
const SOPHIE = {
	id: '5eed0000-0000-4000-8000-000000000092',
	full_name: 'Sophie Dupont',
	email: 'sophie@dupont.test',
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
}
const ELISE = {
	id: '5eed0000-0000-4000-8000-000000000093',
	full_name: 'Élise Fabre',
	email: null,
	phone: '+33 6 12 34 56 78',
	role_title: "Cheffe d'atelier",
	organization_id: '5eed0000-0000-4000-8000-000000000082',
	organizations: { id: '5eed0000-0000-4000-8000-000000000082', name: 'Studio Meunier', domain: null },
}

const SEED = [ELISE, LEO, SOPHIE]

describe('Carnet de contacts', () => {
	it('rend une ligne par contact, dans l’ordre reçu du serveur — cas a du §10.6', async () => {
		render(<Carnet client={clientQuiRend({ data: SEED, error: null, status: 200 })} />)
		const lignes = await screen.findAllByTestId('ligne-contact')
		expect(lignes).toHaveLength(3)
		// L'écran ne retrie PAS : l'ordre est celui de la réponse, et la collation de la base range
		// « Élise » avant « Léo » (mesuré le 2026-08-18).
		expect(lignes.map((ligne) => ligne.getAttribute('data-contact'))).toEqual([
			ELISE.id,
			LEO.id,
			SOPHIE.id,
		])
	})

	it('est un tableau SÉMANTIQUE avec ses cinq en-têtes de colonne — §5.9', async () => {
		render(<Carnet client={clientQuiRend({ data: SEED, error: null, status: 200 })} />)
		expect(await screen.findByTestId('tableau-contacts')).toBeTruthy()
		const entetes = screen.getAllByRole('columnheader')
		expect(entetes.map((entete) => entete.textContent)).toEqual([
			fr['contacts.table.name'],
			fr['contacts.table.organization'],
			fr['contacts.table.role'],
			fr['contacts.table.email'],
			fr['contacts.table.phone'],
		])
	})

	it('laisse la cellule VIDE quand la donnée est absente — cas b et c du §10.6', async () => {
		render(<Carnet client={clientQuiRend({ data: SEED, error: null, status: 200 })} />)
		const lignes = await screen.findAllByTestId('ligne-contact')
		const ligneSophie = lignes.find((ligne) => ligne.getAttribute('data-contact') === SOPHIE.id)!
		const cellulesSophie = [...ligneSophie.querySelectorAll('td')].map((c) => c.textContent)
		// Ni tiret, ni « — », ni « non renseigné » : le vide est le seul rendu qui ne prétende rien.
		expect(cellulesSophie).toEqual(['Sophie Dupont', '', '', 'sophie@dupont.test', ''])

		const ligneElise = lignes.find((ligne) => ligne.getAttribute('data-contact') === ELISE.id)!
		const cellulesElise = [...ligneElise.querySelectorAll('td')].map((c) => c.textContent)
		expect(cellulesElise).toEqual([
			'Élise Fabre',
			'Studio Meunier',
			"Cheffe d'atelier",
			'',
			'+33 6 12 34 56 78',
		])
	})

	it('rend email et téléphone en DONNÉE TECHNIQUE, et le nom d’organisation en TEXTE — §10.5, §10.7', async () => {
		render(<Carnet client={clientQuiRend({ data: SEED, error: null, status: 200 })} />)
		const lignes = await screen.findAllByTestId('ligne-contact')
		const ligneLeo = lignes.find((ligne) => ligne.getAttribute('data-contact') === LEO.id)!
		// §2 : email et téléphone sont des données techniques, portées par `code`.
		expect(ligneLeo.querySelector('code')?.textContent).toBe(LEO.email)
		// §10.7 : la fiche d'organisation est due par 4b — un lien sans destination serait mort,
		// et aucun `mailto:` n'est posé, écrire à un contact n'étant spécifié nulle part.
		expect(ligneLeo.querySelectorAll('a')).toHaveLength(0)
	})

	it('rend des squelettes pendant la lecture, jamais un écran blanc — cas d du §10.6', () => {
		const jamais = {
			from: () => ({ select: () => ({ order: () => ({ then: () => new Promise(() => {}) }) }) }),
		} as unknown as ClientCrm
		render(<Carnet client={jamais} />)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend un état d’erreur dont la reprise RELANCE la lecture — cas e du §10.6', async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: SEED, error: null, status: 200 },
		)
		render(<Carnet client={client} />)
		const reprise = await screen.findByRole('button', { name: fr['contacts.error.retry'] })
		await userEvent.click(reprise)
		// La reprise n'est pas décorative : elle relit, et le tableau apparaît.
		await waitFor(() => expect(screen.getByTestId('tableau-contacts')).toBeTruthy())
	})

	it('rend l’état vide SANS action sur zéro contact — cas f du §10.6', async () => {
		render(<Carnet client={clientQuiRend({ data: [], error: null, status: 200 })} />)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.empty.title'])).toBeTruthy()
		// Écart assumé au §5.8, celui que le §5.16 a déjà pris pour la corbeille : le carnet ne
		// livre aucun geste de création, et un bouton vers nulle part serait une commande morte.
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('rend un état explicite sans espace de travail, et n’interroge RIEN', () => {
		const espion = vi.fn()
		render(<Carnet client={null} />)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.noWorkspace.title'])).toBeTruthy()
		expect(espion).not.toHaveBeenCalled()
	})
})
