// @verifies CRM-021 (docs/BACKLOG.md) — barre d'onglets : rendu réel des channels
// @verifies docs/SPEC-channels.md §5 (ce que la barre lit), §5.3 (patron ARIA), §4 (archivage)
// @verifies docs/DESIGN_SYSTEM.md §4 (onglets), §5.8 (états), §8 (clavier, cibles), §12.1 (écart)
// @verifies docs/SPEC-webapp.md §7 (états systématiques), §10 (aucun texte en dur)
//
// Ces tests montent la **vraie** barre d'onglets et l'interrogent par ses rôles accessibles.
// Ils existent parce que le rendu chargé des channels ne peut être vu nulle part ailleurs : la
// webapp est un appelant anonyme faute d'écran de connexion (INC-021), et son E2E n'obtient donc
// jamais de ligne. Sans ce fichier, un onglet réel ne serait exercé par aucune preuve.
//
// Ce qu'ils ne prouvent PAS, et qui reste dû : que l'écran affiche réellement des onglets à un
// utilisateur connecté. C'est une limite du produit, nommée dans `docs/BACKLOG.md`.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { TabBar } from './TabBar'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { fr } from '../i18n'
import type { Channel } from '../lib/channels'

// `workflow_id` a rejoint la lecture partagée à `CRM-041` (docs/SPEC-channels.md §5) : la barre
// d'onglets ne l'affiche pas, mais elle la transporte, et une fixture amputée ne compilerait plus.
const CHANNELS: readonly Channel[] = [
	{ id: 'c-1', name: 'Prospection', slug: 'prospection', position: 1, workflow_id: 'wf-1' },
	{ id: 'c-2', name: 'Grands comptes', slug: 'grands-comptes', position: 2, workflow_id: 'wf-1' },
]

function monter(
	etat: EtatAsync<readonly Channel[]> | undefined,
	options: { slugTrack?: string; adresse?: string } = {},
) {
	const { slugTrack = 'conseil-ia', adresse = '/tracks/conseil-ia' } = options
	return render(
		<MemoryRouter initialEntries={[adresse]}>
			<TabBar {...(etat === undefined ? {} : { etat })} slugTrack={slugTrack} />
		</MemoryRouter>,
	)
}

afterEach(cleanup)

describe('barre d’onglets — états', () => {
	it('affiche son état vide hors d’une route de track', () => {
		// Inbox, Ma journée et Réglages n'ont pas de channels : la barre reste présente, pour que
		// la structure de l'écran ne change pas d'une route à l'autre (`CRM-007`).
		monter(undefined, { slugTrack: undefined as unknown as string })
		expect(screen.getByTestId('onglets-vides').textContent).toBe(fr['tabs.empty'])
	})

	it('affiche son état vide lorsque le track n’a aucun channel', () => {
		monter(pret([]))
		expect(screen.getByTestId('onglets-vides').textContent).toBe(fr['tabs.empty'])
		expect(screen.queryAllByTestId('onglet-channel')).toHaveLength(0)
	})

	it('affiche des squelettes pendant le chargement, jamais un vide prématuré', () => {
		// Annoncer « aucun channel » avant d'avoir la réponse serait une valeur par défaut
		// trompeuse (CLAUDE.md §18).
		monter(enChargement())
		expect(screen.queryByTestId('onglets-vides')).toBeNull()
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('ne duplique pas l’erreur : elle est présentée au centre de l’écran', () => {
		monter(enErreur({ nature: 'network', detail: 'fetch failed' }))
		expect(screen.getByTestId('onglets-vides')).toBeTruthy()
	})
})

describe('barre d’onglets — onglets réels', () => {
	it('rend un lien par channel, dans l’ordre reçu', () => {
		monter(pret(CHANNELS))
		const onglets = screen.getAllByTestId('onglet-channel')
		expect(onglets.map((o) => o.getAttribute('data-slug'))).toEqual([
			'prospection',
			'grands-comptes',
		])
		expect(onglets[0]?.textContent).toBe('Prospection')
	})

	it('mène chaque onglet à l’adresse de son channel dans son track', () => {
		monter(pret(CHANNELS))
		const [premier] = screen.getAllByTestId('onglet-channel')
		expect(premier?.getAttribute('href')).toBe('/tracks/conseil-ia/prospection')
	})

	it('est une navigation, pas un `tablist` — docs/DESIGN_SYSTEM.md §12.1', () => {
		// Décision 62 : nos onglets changent l'URL, ils ne permutent pas des panneaux dans la même
		// page. Les annoncer comme des onglets décrirait un comportement qui n'est pas celui du
		// produit, et le `tabindex` glissant retirerait la navigation par `Tab`.
		monter(pret(CHANNELS))
		expect(screen.getByRole('navigation', { name: fr['tabs.aria'] })).toBeTruthy()
		expect(screen.queryAllByRole('tab')).toHaveLength(0)
		expect(screen.queryByRole('tablist')).toBeNull()
	})

	it('signale l’onglet courant par `aria-current`, et pas seulement par la couleur', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/grands-comptes' })
		const onglets = screen.getAllByTestId('onglet-channel')
		expect(onglets[1]?.getAttribute('aria-current')).toBe('page')
		expect(onglets[0]?.getAttribute('aria-current')).toBeNull()
	})

	it('garde chaque onglet atteignable au clavier', () => {
		// Un ensemble de liens est parcouru par `Tab` sans qu'aucun code ne l'organise : c'est
		// précisément ce que le patron `tablist` aurait retiré.
		monter(pret(CHANNELS))
		for (const onglet of screen.getAllByTestId('onglet-channel')) {
			expect(onglet.tagName).toBe('A')
			expect(onglet.getAttribute('href')).toBeTruthy()
		}
	})

	it('n’écrit aucun texte en dur : les libellés sont des données, le reste des clés', () => {
		monter(pret(CHANNELS))
		// Le nom du channel vient du backend — c'est une donnée, pas une traduction
		// (docs/DESIGN_SYSTEM.md §10).
		expect(screen.getByTitle('Grands comptes')).toBeTruthy()
		expect(screen.getByRole('navigation', { name: fr['tabs.aria'] })).toBeTruthy()
	})
})
