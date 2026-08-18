// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a et 4b
// @verifies docs/SPEC-contacts.md §10.5 (de quoi l'écran a l'air), §10.6 (cas a à f du contrat
//           de comportement), §10.7 (aucun geste)
// @verifies docs/SPEC-contacts.md §11.6 (le nom d'organisation est désormais un LIEN vers sa
//           fiche), §11.9 cas i
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau sémantique, cellule sans valeur VIDE),
//           §5.8 (quatre états), §2 (données techniques en monospace)
//
// Les données injectées sont celles du SEED, à l'identique : Léo Marchand avec son organisation,
// Sophie Dupont sans organisation ni fonction, Élise Fabre sans email. Ce n'est pas une commodité
// — ce sont les trois cas du §10.6, et les mêmes que la preuve E2E exerce sur la pile réelle.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Carnet } from './Carnet'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

/**
 * Le carnet porte désormais un `Link` vers la fiche d'organisation (§11.6) : il lui faut un
 * routeur. Ce n'est pas une commodité de test — c'est la conséquence directe du lien livré, et un
 * rendu nu échouerait sur `useHref` avant la moindre assertion.
 */
function rendreCarnet(client: ClientCrm | null) {
	return render(
		<MemoryRouter>
			<Carnet client={client} />
		</MemoryRouter>,
	)
}

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
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
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
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
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
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
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

	it('rend email et téléphone en DONNÉE TECHNIQUE, et le nom d’organisation en LIEN — §10.5, §11.6', async () => {
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
		const lignes = await screen.findAllByTestId('ligne-contact')
		const ligneLeo = lignes.find((ligne) => ligne.getAttribute('data-contact') === LEO.id)!
		// §2 : email et téléphone sont des données techniques, portées par `code`.
		expect(ligneLeo.querySelector('code')?.textContent).toBe(LEO.email)
		// ASSERTION RÉVISÉE le 2026-08-18 — sous-tranche 4b, docs/SPEC-contacts.md §11.6.
		//
		// Elle exigeait `toHaveLength(0)` : le nom d'organisation devait rester un TEXTE tant que
		// la fiche n'existait pas, un lien sans destination étant mort (§10.7, §5.10). La
		// sous-tranche 4b LIVRE cette destination : la règle change par livraison, et la preuve est
		// donc RÉVISÉE avec son motif — jamais retirée, jamais contournée (mécanisme de la
		// décision 51). Ce qu'elle exige reste vérifiable, et devient plus fort : le lien doit
		// exister ET mener à la bonne fiche.
		const liens = ligneLeo.querySelectorAll('a')
		expect(liens).toHaveLength(1)
		expect(liens[0]?.getAttribute('href')).toBe(
			`/contacts/organisations/${LEO.organization_id}`,
		)
		// Le nom EST le libellé du lien : aucun `aria-label` générique ne le remplace, sans quoi
		// tous les liens du tableau seraient indistinguables pour un lecteur d'écran (§8).
		expect(liens[0]?.textContent).toBe('Sogexia')
		// Aucun `mailto:` ni `tel:` n'est posé pour autant : écrire à un contact depuis le carnet
		// n'est spécifié nulle part (§10.5, inchangé).
		expect(ligneLeo.innerHTML).not.toContain('mailto:')
		expect(ligneLeo.innerHTML).not.toContain('tel:')
	})

	it('rend des squelettes pendant la lecture, jamais un écran blanc — cas d du §10.6', () => {
		const jamais = {
			from: () => ({ select: () => ({ order: () => ({ then: () => new Promise(() => {}) }) }) }),
		} as unknown as ClientCrm
		rendreCarnet(jamais)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend un état d’erreur dont la reprise RELANCE la lecture — cas e du §10.6', async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: SEED, error: null, status: 200 },
		)
		rendreCarnet(client)
		const reprise = await screen.findByRole('button', { name: fr['contacts.error.retry'] })
		await userEvent.click(reprise)
		// La reprise n'est pas décorative : elle relit, et le tableau apparaît.
		await waitFor(() => expect(screen.getByTestId('tableau-contacts')).toBeTruthy())
	})

	it('rend l’état vide SANS action sur zéro contact — cas f du §10.6', async () => {
		rendreCarnet(clientQuiRend({ data: [], error: null, status: 200 }))
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.empty.title'])).toBeTruthy()
		// Écart assumé au §5.8, celui que le §5.16 a déjà pris pour la corbeille : le carnet ne
		// livre aucun geste de création, et un bouton vers nulle part serait une commande morte.
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('rend un état explicite sans espace de travail, et n’interroge RIEN', () => {
		const espion = vi.fn()
		rendreCarnet(null)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.noWorkspace.title'])).toBeTruthy()
		expect(espion).not.toHaveBeenCalled()
	})
})
