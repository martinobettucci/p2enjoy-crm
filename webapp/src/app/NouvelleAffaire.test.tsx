// @verifies CRM-095 (docs/BACKLOG.md) — tranche T2 : le geste « Nouvelle affaire », rendu réel
// @verifies docs/SPEC-cards.md §18.3 (le formulaire dans le flux, « Créer » éteint sur un titre blanc,
//           `Échap`, les refus qui gardent la saisie, le succès qui ouvre la fiche), §18.1 (arbitrages)
// @verifies docs/DESIGN_SYSTEM.md §5.50 (Nouvelle affaire), §5.2 (l'action de la colonne initiale),
//           §5.13 (focus entrant puis rendu à la commande qui a ouvert), §5.25 (retour différé d'un tour
//           de rendu), §5.29 bis (le refus nomme le geste qui le lève), §8 (état désactivé lisible)
//
// Ces tests montent le VRAI module — commandes, formulaire, état partagé — derrière un vrai routeur :
// l'ouverture de la fiche est observée sur l'adresse atteinte, jamais sur un appel simulé à la navigation.
// La pile réelle est éprouvée par `e2e/ui/nouvelle-affaire.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import type { ClientCrm } from '../lib/supabase'
import {
	ActionColonneInitiale,
	CommandeNouvelleAffaire,
	FormulaireNouvelleAffaire,
	useCreationAffaire,
} from './NouvelleAffaire'

afterEach(cleanup)

const ID_CARD = '0c950000-0000-4000-8000-0000000000aa'

type Reponse = { readonly data: unknown; readonly error: { readonly code: string; readonly message: string } | null }

/** Client espion : chaque appel `rpc` est noté et rend la promesse donnée, résolue ou en suspens. */
function client(reponse: Reponse | Promise<Reponse>): { client: ClientCrm; appels: [string, unknown][] } {
	const appels: [string, unknown][] = []
	const faux = {
		rpc: (nom: string, args: unknown) => {
			appels.push([nom, args])
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

/** Une réponse que le test libère quand il veut : l'état « en vol » devient observable. */
function enSuspens(): { promesse: Promise<Reponse>; liberer: (reponse: Reponse) => void } {
	let liberer: (reponse: Reponse) => void = () => {}
	const promesse = new Promise<Reponse>((resoudre) => {
		liberer = resoudre
	})
	return { promesse, liberer }
}

/** Le banc : l'état partagé, les deux commandes et le formulaire, placés comme le board les place. */
function Banc({ client: c }: { readonly client: ClientCrm }) {
	const creation = useCreationAffaire()
	return (
		<>
			<CommandeNouvelleAffaire creation={creation} />
			{creation.ouvert ? (
				<FormulaireNouvelleAffaire
					creation={creation}
					client={c}
					idChannel="ch-1"
					slugTrack="conseil-ia"
					slugChannel="grands-comptes"
				/>
			) : null}
			<ActionColonneInitiale creation={creation} />
		</>
	)
}

function FicheOuverte() {
	const { idCard } = useParams()
	return <output data-testid="fiche-ouverte">{idCard}</output>
}

function monter(c: ClientCrm) {
	return render(
		<MemoryRouter initialEntries={['/tracks/conseil-ia/grands-comptes']}>
			<Routes>
				<Route path="/tracks/:slugTrack/:slugChannel" element={<Banc client={c} />} />
				<Route path="/tracks/:slugTrack/:slugChannel/cards/:idCard" element={<FicheOuverte />} />
				<Route path="/reglages/workflows" element={<output data-testid="editeur-atteint" />} />
			</Routes>
		</MemoryRouter>,
	)
}

const champ = () => screen.getByTestId('champ-titre-affaire') as HTMLInputElement
const creer = () => screen.getByTestId('creer-affaire') as HTMLButtonElement

describe('ouvrir, saisir, refermer (docs/DESIGN_SYSTEM.md §5.50, §5.13)', () => {
	it('la commande ouvre le formulaire, le focus entre dans le titre, et les deux commandes cèdent la place', async () => {
		monter(client({ data: ID_CARD, error: null }).client)
		expect(screen.getByTestId('nouvelle-affaire').textContent).toBe(fr['affaire.creation.commande'])
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		expect(screen.getByRole('form', { name: fr['affaire.creation.aria'] })).toBeDefined()
		expect(document.activeElement).toBe(champ())
		expect(screen.getByLabelText(fr['affaire.creation.titre'])).toBe(champ())
		// La commande et le formulaire S'EXCLUENT (§5.50) — les deux commandes du même geste.
		expect(screen.queryByTestId('nouvelle-affaire')).toBeNull()
		expect(screen.queryByTestId('creer-affaire-colonne')).toBeNull()
	})

	it('« Créer » reste éteint tant que le titre est blanc — espaces compris —, puis s’allume', async () => {
		monter(client({ data: ID_CARD, error: null }).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		expect(creer().disabled).toBe(true)
		await userEvent.type(champ(), '   ')
		expect(creer().disabled).toBe(true)
		await userEvent.type(champ(), 'Refonte')
		expect(creer().disabled).toBe(false)
		expect(creer().textContent).toBe(fr['affaire.creation.creer'])
	})

	it('`Échap` referme depuis le champ et rend le focus à la commande de la barre, au rendu suivant', async () => {
		monter(client({ data: ID_CARD, error: null }).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Brouillon{Escape}')
		expect(screen.queryByTestId('formulaire-nouvelle-affaire')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('nouvelle-affaire')))
	})

	it('« Annuler » rend le focus à l’action de la COLONNE quand c’est elle qui a ouvert', async () => {
		monter(client({ data: ID_CARD, error: null }).client)
		expect(screen.getByTestId('creer-affaire-colonne').textContent).toBe(fr['affaire.creation.colonne'])
		await userEvent.click(screen.getByTestId('creer-affaire-colonne'))
		expect(document.activeElement).toBe(champ())
		await userEvent.click(screen.getByTestId('annuler-nouvelle-affaire'))
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('creer-affaire-colonne')))
	})

	it('le formulaire consomme `Échap` : une surface voisine qui l’écoute ne se referme pas avec lui', async () => {
		const ecoute = vi.fn()
		document.addEventListener('keydown', ecoute)
		try {
			monter(client({ data: ID_CARD, error: null }).client)
			await userEvent.click(screen.getByTestId('nouvelle-affaire'))
			await userEvent.keyboard('{Escape}')
			expect(ecoute.mock.calls.filter(([evenement]) => (evenement as KeyboardEvent).key === 'Escape')).toEqual([])
		} finally {
			document.removeEventListener('keydown', ecoute)
		}
	})
})

describe('créer (docs/SPEC-cards.md §18.2, §18.3)', () => {
	it('`Entrée` envoie le channel et le titre, puis la fiche de l’affaire s’ouvre', async () => {
		const { client: c, appels } = client({ data: ID_CARD, error: null })
		monter(c)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Refonte du site{Enter}')
		expect((await screen.findByTestId('fiche-ouverte')).textContent).toBe(ID_CARD)
		expect(appels).toEqual([['creer_affaire', { p_channel: 'ch-1', p_titre: 'Refonte du site' }]])
	})

	it('pendant l’envoi, « Créer » dit « Création… », et ni « Annuler » ni `Échap` n’interrompent le vol', async () => {
		const vol = enSuspens()
		monter(client(vol.promesse).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Refonte')
		await userEvent.click(creer())
		expect(creer().textContent).toBe(fr['affaire.creation.encours'])
		expect(creer().disabled).toBe(true)
		expect((screen.getByTestId('annuler-nouvelle-affaire') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(champ(), '{Escape}')
		expect(screen.getByTestId('formulaire-nouvelle-affaire')).toBeDefined()
		vol.liberer({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
		expect((await screen.findByRole('alert')).textContent).toBe(fr['affaire.creation.refus.interdit'])
		expect(creer().textContent).toBe(fr['affaire.creation.creer'])
	})
})

describe('les refus : écrits sous le champ, la saisie gardée (docs/SPEC-cards.md §18.3, §5.7 ter)', () => {
	it.each([
		['42501', 'new row violates row-level security policy', 'affaire.creation.refus.interdit'],
		['P0002', 'channel introuvable', 'affaire.creation.refus.interdit'],
		['P0001', 'channel ferme', 'affaire.creation.refus.ferme'],
		['P0001', 'aucune etape initiale', 'affaire.creation.refus.initiale'],
		['XX000', 'panne inattendue', 'affaire.creation.refus.panne'],
	] as const)('%s « %s » s’écrit « %s », role=alert, cité par le champ, qui garde sa saisie et le focus', async (code, message, cle) => {
		monter(client({ data: null, error: { code, message } }).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Refonte')
		await userEvent.click(creer())
		const alerte = await screen.findByRole('alert')
		expect(alerte.querySelector('p')?.textContent).toBe(fr[cle])
		expect(champ().value).toBe('Refonte')
		expect(champ().getAttribute('aria-describedby')).toBe(alerte.id)
		await waitFor(() => expect(document.activeElement).toBe(champ()))
		expect(screen.queryByTestId('fiche-ouverte')).toBeNull()
	})

	it('seul le refus « aucune étape initiale » porte le lien vers l’éditeur de workflows (§5.29 bis)', async () => {
		monter(client({ data: null, error: { code: 'P0001', message: 'aucune etape initiale' } }).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Refonte{Enter}')
		const lien = await screen.findByTestId('lien-editeur-workflows')
		expect(lien.textContent).toBe(fr['affaire.creation.refus.initiale.lien'])
		await userEvent.click(lien)
		expect(await screen.findByTestId('editeur-atteint')).toBeDefined()
	})

	it('les autres refus ne portent aucun lien', async () => {
		monter(client({ data: null, error: { code: 'P0001', message: 'channel ferme' } }).client)
		await userEvent.click(screen.getByTestId('nouvelle-affaire'))
		await userEvent.type(champ(), 'Refonte{Enter}')
		await screen.findByRole('alert')
		expect(screen.queryByTestId('lien-editeur-workflows')).toBeNull()
	})
})
