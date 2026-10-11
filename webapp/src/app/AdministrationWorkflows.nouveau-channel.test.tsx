// @verifies CRM-100 (docs/BACKLOG.md) tranche T1 — l'éditeur de workflows au bout de l'aller-retour
// @verifies docs/SPEC-administration-arborescence.md §13.5 (`creer=1` ouvre la création, `track` pré-règle la portée
//           et le track, les deux quittent l'adresse ; un workflow créé — par le formulaire ou par l'acceptation d'une
//           suggestion de l'IA — inscrit `workflow-cree` ; le bandeau et son lien de retour, qui porte le workflow
//           créé), §13.7 (un retour invalide n'ouvre aucun bandeau ; sans retour, rien n'est inscrit)
// @verifies docs/SPEC-workflow-engine.md §3 bis.2 ; docs/DESIGN_SYSTEM.md §5.55 (une carte, pas une alerte), §5.13
//           (le focus entre au premier champ à l'OUVERTURE — jamais à un remontage, défaut trouvé par l'E2E du guide)
//
// UN FICHIER À PART, ET C'EST VOULU. L'acceptation d'une suggestion passe par `PanneauSuggestionIa`, dont le parcours
// complet est éprouvé par `PanneauSuggestionIa.test.tsx` ; ici, seul compte ce que l'ÉDITEUR fait du workflow
// accepté. Le panneau est donc remplacé par un double qui appelle `onAcceptee` — un remplacement qui, dans
// `AdministrationWorkflows.test.tsx`, priverait de leur objet les preuves du panneau réel.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { ClientCrm } from '../lib/supabase'
import { t } from '../i18n'
import { EVENEMENT_WORKFLOW_DEPART } from '../lib/demarrage'

vi.mock('./PanneauSuggestionIa', () => ({
	PanneauSuggestionIa: ({ onAcceptee }: { onAcceptee: (id: string, nom: string, version: number | null) => void }) => (
		<button type="button" onClick={() => onAcceptee('wf-ia', 'Cycle proposé', null)}>
			Accepter la suggestion (double)
		</button>
	),
}))

const { AdministrationWorkflows } = await import('./AdministrationWorkflows')

const WORKFLOWS = [
	{ id: 'wf-1', workspace_id: 'ws-1', name: 'Pipeline standard', scope: 'global', track_id: null, is_default: true, archived_at: null },
	{ id: 'wf-neuf', workspace_id: 'ws-1', name: 'Partenariats', scope: 'track', track_id: 'tr-2', is_default: false, archived_at: null },
	{ id: 'wf-ia', workspace_id: 'ws-1', name: 'Cycle proposé', scope: 'global', track_id: null, is_default: false, archived_at: null },
]
const TRACKS = [
	{ id: 'tr-1', name: 'Conseil & IA' },
	{ id: 'tr-2', name: 'Studio web' },
]

/**
 * Une chaîne PostgREST permissive : tout affineur la rend, et elle se résout sur `resultat`. Les lectures que ces
 * preuves n'observent pas — étapes, champs, versions — rendent une liste vide, que l'écran sait déjà dire.
 */
function chaine(resultat: unknown): unknown {
	const proxy: unknown = new Proxy(() => undefined, {
		get: (_cible, propriete) =>
			propriete === 'then'
				? (resoudre: (valeur: unknown) => unknown, rejeter: (raison: unknown) => unknown) =>
						Promise.resolve(resultat).then(resoudre, rejeter)
				: () => proxy,
		apply: () => proxy,
	})
	return proxy
}

function clientFactice(workflows: unknown[] = WORKFLOWS) {
	const insertions: { table: string; charge: unknown }[] = []
	const pretes = (data: unknown) => ({ data, error: null, status: 200, count: null })
	const client = {
		from: (table: string) => ({
			select: () => {
				// Lue par référence à chaque requête : la remplir simule la base après un geste du guide.
				if (table === 'workflows') return chaine(pretes([...workflows]))
				if (table === 'workspaces') return chaine(pretes([{ id: 'ws-1', name: 'P2Enjoy', slug: 'p2enjoy' }]))
				if (table === 'tracks') return chaine(pretes(TRACKS))
				return chaine(pretes([]))
			},
			insert: (charge: unknown) => {
				insertions.push({ table, charge })
				return chaine({ data: [{ id: 'wf-neuf' }], error: null, status: 201 })
			},
		}),
		rpc: () => chaine(pretes(null)),
	} as unknown as ClientCrm
	return { client, insertions }
}

function SondeAdresse() {
	const { pathname, search } = useLocation()
	return <output data-testid="sonde-adresse">{`${pathname}${search}`}</output>
}

const RETOUR = '/tracks/studio-web?nouveau-channel=1&nc-nom=Partenariats'

function monter(adresse: string, workflows?: unknown[]) {
	const factice = clientFactice(workflows)
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<AdministrationWorkflows client={factice.client} acces={null} />
			<SondeAdresse />
		</MemoryRouter>,
	)
	return factice
}

const editeurAvec = (parametres: Record<string, string>) => `/reglages/workflows?${new URLSearchParams(parametres).toString()}`
const parametresAdresse = () => {
	const adresse = screen.getByTestId('sonde-adresse').textContent ?? ''
	return adresse.includes('?') ? Object.fromEntries(new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1))) : {}
}
const parametresDe = (adresse: string) => Object.fromEntries(new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1)))

afterEach(cleanup)

describe('l’ouverture par l’adresse (§13.5)', () => {
	it('`creer=1` et `track` ouvrent la création, portée « propre à un track » sur CE track', async () => {
		monter(editeurAvec({ creer: '1', track: 'tr-2', retour: RETOUR }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		expect((within(formulaire).getByLabelText('Portée') as HTMLSelectElement).value).toBe('track')
		await waitFor(() =>
			expect((within(formulaire).getByLabelText('Track') as HTMLSelectElement).value).toBe('tr-2'),
		)
		// Modifiable : « Global » reste un choix légitime.
		await userEvent.selectOptions(within(formulaire).getByLabelText('Portée'), 'global')
		expect(within(formulaire).queryByLabelText('Track')).toBeNull()
	})

	it('lus, `creer` et `track` QUITTENT l’adresse ; `retour` y reste', async () => {
		monter(editeurAvec({ creer: '1', track: 'tr-2', retour: RETOUR }))
		await screen.findByTestId('workflows-formulaire-creation')
		await waitFor(() => expect(parametresAdresse()).toEqual({ retour: RETOUR }))
	})

	it('`creer=1` sans track ouvre une création vierge, portée globale', async () => {
		monter(editeurAvec({ creer: '1' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		expect((within(formulaire).getByLabelText('Portée') as HTMLSelectElement).value).toBe('global')
	})

	it('sans `creer`, rien ne s’ouvre et aucun bandeau n’est rendu', async () => {
		monter('/reglages/workflows')
		await screen.findByText('Pipeline standard')
		expect(screen.queryByTestId('workflows-formulaire-creation')).toBeNull()
		expect(screen.queryByTestId('bandeau-retour-channel')).toBeNull()
	})
})

describe('le bandeau de retour (§13.5, §13.7)', () => {
	it('un retour valide rend une CARTE — pas une alerte — et le lien ramène au formulaire tel qu’il a été quitté', async () => {
		monter(editeurAvec({ retour: RETOUR }))
		const bandeau = await screen.findByTestId('bandeau-retour-channel')
		expect(bandeau.getAttribute('role')).toBe('region')
		expect(within(bandeau).queryByRole('alert')).toBeNull()
		expect(bandeau.textContent).toContain('Vous créez un channel.')
		const lien = within(bandeau).getByRole('link', { name: 'Revenir au nouveau channel' })
		expect(lien.getAttribute('href')).toBe('/tracks/studio-web?nouveau-channel=1&nc-nom=Partenariats')
		expect(lien.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
	})

	it.each([
		['une adresse absolue', 'https://exemple.test/tracks/studio-web?nouveau-channel=1'],
		['un autre écran', '/reglages/corbeille?nouveau-channel=1'],
		['sans formulaire ouvert', '/tracks/studio-web'],
	])('un retour invalide — %s — n’ouvre aucun bandeau', async (_cas, retour) => {
		monter(editeurAvec({ retour }))
		await screen.findByText('Pipeline standard')
		expect(screen.queryByTestId('bandeau-retour-channel')).toBeNull()
	})
})

describe('le workflow créé (§13.5)', () => {
	it('créé par le formulaire, il s’inscrit dans l’adresse, le bandeau le nomme, le lien le porte', async () => {
		const utilisateur = userEvent.setup()
		const { insertions } = monter(editeurAvec({ creer: '1', track: 'tr-2', retour: RETOUR }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await waitFor(() =>
			expect((within(formulaire).getByLabelText('Track') as HTMLSelectElement).value).toBe('tr-2'),
		)
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Partenariats')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))

		await waitFor(() => expect(parametresAdresse()).toEqual({ retour: RETOUR, 'workflow-cree': 'wf-neuf' }))
		expect(insertions).toEqual([
			{ table: 'workflows', charge: { workspace_id: 'ws-1', name: 'Partenariats', scope: 'track', track_id: 'tr-2' } },
		])
		const bandeau = screen.getByTestId('bandeau-retour-channel')
		expect(bandeau.textContent).toContain(t('admin.workflows.retour.body.created', { nom: 'Partenariats' }))
		const lien = within(bandeau).getByRole('link', { name: 'Revenir au nouveau channel' }).getAttribute('href') ?? ''
		expect(parametresDe(lien)).toEqual({ 'nouveau-channel': '1', 'nc-nom': 'Partenariats', 'nc-workflow': 'wf-neuf' })
	})

	it('créé par l’acceptation d’une suggestion de l’IA, il compte de même', async () => {
		const utilisateur = userEvent.setup()
		monter(editeurAvec({ retour: RETOUR }))
		await screen.findByText('Pipeline standard')
		await utilisateur.click(screen.getByRole('button', { name: 'Créer avec l’IA' }))
		await utilisateur.click(await screen.findByRole('button', { name: 'Accepter la suggestion (double)' }))
		await waitFor(() => expect(parametresAdresse()['workflow-cree']).toBe('wf-ia'))
		expect(screen.getByTestId('bandeau-retour-channel').textContent).toContain('Cycle proposé')
	})

	it('sans retour valide, une création n’inscrit rien dans l’adresse', async () => {
		const utilisateur = userEvent.setup()
		monter(editeurAvec({ creer: '1' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Partenariats')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(screen.queryByTestId('workflows-formulaire-creation')).toBeNull())
		expect(parametresAdresse()).toEqual({})
	})
})

describe('le formulaire ouvert par l’adresse, remonté par une relecture (§13.5, docs/DESIGN_SYSTEM.md §5.13)', () => {
	// DÉFAUT TROUVÉ PAR `e2e/ui/guide-flottant.spec.ts` : sur un éditeur vide, le workflow de départ posé depuis le
	// guide flottant fait relire la liste ; le formulaire passe de l'état vide à la colonne de gauche — il est
	// REMONTÉ —, et reprenait le focus au guide. La saisie, elle, repartait de zéro.
	it('ne reprend pas le focus, et garde la saisie', async () => {
		const utilisateur = userEvent.setup()
		const workflows: unknown[] = []
		monter(editeurAvec({ creer: '1', track: 'tr-2', retour: RETOUR }), workflows)
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		expect(document.activeElement).toBe(within(formulaire).getByLabelText('Nom'))
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Partenariats')

		// Le guide a le focus quand il pose le workflow de départ : un élément hors de l'éditeur le figure.
		const guide = document.createElement('button')
		document.body.append(guide)
		guide.focus()
		workflows.push(WORKFLOWS[0])
		act(() => {
			globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
		})
		await screen.findByText('Pipeline standard')
		const remonte = await screen.findByTestId('workflows-formulaire-creation')
		expect((within(remonte).getByLabelText('Nom') as HTMLInputElement).value).toBe('Partenariats')
		expect((within(remonte).getByLabelText('Portée') as HTMLSelectElement).value).toBe('track')
		expect(document.activeElement).toBe(guide)
		guide.remove()
	})
})
