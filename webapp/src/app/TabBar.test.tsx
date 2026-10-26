// @verifies CRM-093 (docs/BACKLOG.md) tranche T4 — « Nouveau channel » en texte citant son motif quand la base refuse
// @verifies CRM-116 (docs/BACKLOG.md) tranche T3 — la pastille de couleur de l'onglet (docs/DESIGN_SYSTEM.md §5.68)
//           l'administration (docs/DESIGN_SYSTEM.md §5.59)
// @verifies CRM-021 (docs/BACKLOG.md) — barre d'onglets : rendu réel des channels
// @verifies CRM-086 (docs/BACKLOG.md) — l'entrée « Coûts » du track, docs/SPEC-costs.md §4.0
// @verifies docs/SPEC-channels.md §5 (ce que la barre lit), §5.3 (patron ARIA), §4 (archivage)
// @verifies docs/DESIGN_SYSTEM.md §4 (onglets), §5.8 (états), §8 (clavier, cibles), §12.1 (écart)
// @verifies docs/SPEC-webapp.md §7 (états systématiques), §10 (aucun texte en dur)
// @verifies CRM-105 (docs/BACKLOG.md) — la description d'un channel en infobulle sur son onglet :
//           docs/DESIGN_SYSTEM.md §5.58, docs/SPEC-channels.md §5
// @verifies CRM-100 (docs/BACKLOG.md) tranche T1 — la commande « Nouveau channel » :
//           docs/SPEC-administration-arborescence.md §13.3 (un lien qui ouvre le formulaire par l'adresse, la vue
//           liste conservée, la racine du track hors d'une vue de track, absente pendant la saisie) ;
//           docs/DESIGN_SYSTEM.md §5.55 (après les channels, avant le filet ; ni bordure basse ni `aria-current`)
//
// Ces tests montent la **vraie** barre d'onglets et isolent ses états par leurs rôles accessibles.
// Le parcours connecté réel atteint la même barre dans `e2e/ui/authentification.spec.ts`.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { TabBar } from './TabBar'
import { FournisseurEspace } from './ContexteEspace'
import type { Capacite } from '../lib/capacites'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { fr } from '../i18n'
import type { Channel } from '../lib/channels'

// `workflow_id` a rejoint la lecture partagée à `CRM-041` (docs/SPEC-channels.md §5) : la barre
// d'onglets ne l'affiche pas, mais elle la transporte, et une fixture amputée ne compilerait plus.
// `description` l'a rejointe avec `CRM-105` (docs/DESIGN_SYSTEM.md §5.58) : nulle ici, l'onglet est rendu
// comme avant ; l'infobulle est éprouvée plus bas.
const CHANNELS: readonly Channel[] = [
	{ id: 'c-1', name: 'Prospection', slug: 'prospection', position: 1, workflow_id: 'wf-1', description: null, color: 'brand' },
	{
		id: 'c-2',
		name: 'Grands comptes',
		slug: 'grands-comptes',
		position: 2,
		workflow_id: 'wf-1',
		description: null,
		color: 'neutral',
	},
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

	// ---------------------------------------------------------------------------------------------
	// L'entrée transverse du track — `CRM-086`, docs/SPEC-costs.md §4.0 et §4.2.
	// ---------------------------------------------------------------------------------------------

	it('porte l’entrée « Coûts » du track, hors du groupe des channels', () => {
		monter(pret(CHANNELS))
		const couts = screen.getByTestId('onglet-couts-track')
		expect(couts.getAttribute('href')).toBe('/tracks/conseil-ia/couts')
		// Elle vit dans sa PROPRE `nav` : mêlée aux channels, elle se lirait comme un channel de
		// plus, sur une barre où tout le reste en est un.
		const groupeChannels = screen.getByRole('navigation', { name: fr['tabs.aria'] })
		expect(groupeChannels.contains(couts)).toBe(false)
		expect(screen.getByRole('navigation', { name: fr['tabs.track.aria'] }).contains(couts)).toBe(
			true,
		)
	})

	it('porte l’entrée « Coûts » MÊME sur un track sans aucun channel', () => {
		// Les budgets d'un track existent indépendamment de ses channels : l'état vide de la barre
		// reste vrai, mais il ne dit plus tout ce que la barre a à proposer.
		monter(pret([]))
		expect(screen.getByTestId('onglets-vides')).toBeTruthy()
		expect(screen.getByTestId('onglet-couts-track').getAttribute('href')).toBe(
			'/tracks/conseil-ia/couts',
		)
	})

	it('ne propose AUCUNE entrée de track hors d’une route de track', () => {
		// Rendue SANS passer par `monter`, dont le paramètre par défaut réintroduirait un slug : une
		// route transverse — Inbox, Réglages — n'en fournit aucun, et c'est cette absence qui décide.
		render(
			<MemoryRouter initialEntries={['/inbox']}>
				<TabBar />
			</MemoryRouter>,
		)
		expect(screen.queryByTestId('onglet-couts-track')).toBeNull()
		expect(screen.getByTestId('onglets-vides')).toBeTruthy()
	})

	it('signale l’entrée « Coûts » courante par `aria-current`, comme un onglet de channel', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/couts' })
		expect(screen.getByTestId('onglet-couts-track').getAttribute('aria-current')).toBe('page')
		for (const onglet of screen.getAllByTestId('onglet-channel')) {
			expect(onglet.getAttribute('aria-current')).toBeNull()
		}
	})

	it('accompagne son icône d’un libellé écrit, jamais l’inverse (§9)', () => {
		monter(pret(CHANNELS))
		const couts = screen.getByTestId('onglet-couts-track')
		expect(couts.textContent).toBe(fr['tabs.track.costs'])
		expect(couts.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
	})
})

describe('barre d’onglets — « Nouveau channel » (CRM-100, §13.3)', () => {
	const commande = () => screen.queryByTestId('commande-nouveau-channel')

	it('est un LIEN qui ouvre le formulaire par l’adresse, libellé écrit à côté de son icône', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/prospection' })
		const lien = commande()
		expect(lien?.tagName).toBe('A')
		expect(lien?.getAttribute('href')).toBe('/tracks/conseil-ia/prospection?nouveau-channel=1')
		expect(lien?.textContent).toBe(fr['tabs.newChannel'])
		expect(lien?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
	})

	it('vient APRÈS les onglets des channels et AVANT les entrées transverses du track', () => {
		monter(pret(CHANNELS))
		const barre = screen.getByTestId('barre-onglets')
		const ordre = Array.from(barre.querySelectorAll('[data-testid]'))
			.map((element) => element.getAttribute('data-testid'))
			.filter((id) => id === 'onglet-channel' || id === 'commande-nouveau-channel' || id === 'onglet-couts-track')
		expect(ordre).toEqual(['onglet-channel', 'onglet-channel', 'commande-nouveau-channel', 'onglet-couts-track'])
	})

	it('n’est pas un onglet : ni `aria-current`, ni hors de toute `nav` des channels', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia?nouveau-channel=0' })
		expect(commande()?.getAttribute('aria-current')).toBeNull()
		expect(commande()?.closest('nav')).toBeNull()
	})

	it('est rendue aussi quand le track n’a aucun channel, à côté de « Aucun channel »', () => {
		monter(pret([]))
		expect(screen.getByTestId('onglets-vides')).toBeTruthy()
		expect(commande()?.getAttribute('href')).toBe('/tracks/conseil-ia?nouveau-channel=1')
	})

	it('garde les paramètres de la vue liste', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/prospection/liste?page=2' })
		expect(commande()?.getAttribute('href')).toBe('/tracks/conseil-ia/prospection/liste?page=2&nouveau-channel=1')
	})

	it('mène à la racine du track depuis l’écran des coûts, qui ne rend pas le formulaire', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/couts' })
		expect(commande()?.getAttribute('href')).toBe('/tracks/conseil-ia?nouveau-channel=1')
	})

	it('quitte la barre pendant la saisie (§5.50 : la commande et le formulaire s’excluent)', () => {
		monter(pret(CHANNELS), { adresse: '/tracks/conseil-ia/prospection?nouveau-channel=1' })
		expect(commande()).toBeNull()
	})

	it('n’existe pas hors d’une route de track', () => {
		render(
			<MemoryRouter initialEntries={['/inbox']}>
				<TabBar />
			</MemoryRouter>,
		)
		expect(commande()).toBeNull()
	})
})

describe('infobulle de description (docs/DESIGN_SYSTEM.md §5.58) — CRM-105', () => {
	it('un onglet décrit cite sa description ; un onglet sans description garde son `title`', () => {
		monter(pret([{ ...CHANNELS[0]!, description: 'Premiers contacts à qualifier.' }, CHANNELS[1]!]))
		const [decrit, nu] = screen.getAllByTestId('onglet-channel')
		const id = decrit?.getAttribute('aria-describedby') ?? ''
		expect(document.getElementById(id)?.textContent).toBe('Premiers contacts à qualifier.')
		expect(decrit?.hasAttribute('title')).toBe(false)
		expect(nu?.getAttribute('title')).toBe('Grands comptes')
		expect(nu?.hasAttribute('aria-describedby')).toBe(false)
	})
})

// --- CRM-093 — « Nouveau channel » quand la base refuse l'administration (docs/DESIGN_SYSTEM.md §5.59) ---------------

describe('« Nouveau channel » selon la capacité d’administrer (CRM-093)', () => {
	function monterAvec(administration: Capacite) {
		return render(
			<MemoryRouter initialEntries={['/tracks/conseil-ia']}>
				<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false, capacites: { administration, edition: 'permise' } }}>
					<TabBar etat={pret([])} slugTrack="conseil-ia" />
				</FournisseurEspace>
			</MemoryRouter>,
		)
	}

	it('refusée : le lien devient un texte, au même libellé, qui cite son motif', () => {
		monterAvec('refusee')
		const commande = screen.getByTestId('commande-nouveau-channel')
		expect(commande.tagName).toBe('SPAN')
		expect(commande.textContent).toContain(fr['tabs.newChannel'])
		const motif = document.getElementById(commande.getAttribute('aria-describedby') ?? '')
		expect(motif?.textContent).toBe(fr['rights.readonly.administration'])
	})

	it('permise ou inconnue : la commande reste un lien', () => {
		for (const administration of ['permise', 'inconnue'] as const) {
			monterAvec(administration)
			expect(screen.getByTestId('commande-nouveau-channel').tagName, administration).toBe('A')
			cleanup()
		}
	})
})

// @verifies CRM-116 — docs/DESIGN_SYSTEM.md §5.68 : la pastille de l'onglet porte la couleur du channel, elle est
// décorative pour les technologies d'assistance — le nom porte l'information —, et une valeur inconnue s'affiche en Gris.
describe('barre d’onglets — la pastille de couleur (CRM-116)', () => {
	it('chaque onglet porte, avant son nom, la pastille de la couleur de son channel', () => {
		monter(pret(CHANNELS))
		const onglets = screen.getAllByTestId('onglet-channel')
		const pastilles = onglets.map((onglet) => onglet.querySelector('[data-testid="pastille-channel"]'))
		expect(pastilles.map((pastille) => pastille?.getAttribute('data-couleur'))).toEqual(['brand', 'neutral'])
		expect(pastilles[0]?.className).toContain('bg-brand')
		expect(pastilles[1]?.className).toContain('bg-text-3')
		for (const pastille of pastilles) expect(pastille?.getAttribute('aria-hidden')).toBe('true')
	})

	it('le nom accessible de l’onglet reste le nom du channel, sans mention de couleur', () => {
		monter(pret(CHANNELS))
		expect(screen.getByRole('link', { name: 'Prospection' })).toBeTruthy()
	})

	it('une couleur hors des cinq jetons s’affiche en Gris', () => {
		monter(pret([{ ...CHANNELS[0]!, color: 'turquoise' }]))
		const pastille = screen.getByTestId('pastille-channel')
		expect(pastille.getAttribute('data-couleur')).toBe('neutral')
		expect(pastille.className).toContain('bg-text-3')
	})
})
