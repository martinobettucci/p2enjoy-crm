// @verifies CRM-100 (docs/BACKLOG.md) tranche T1 — « Nouveau channel » dans la vue d'un track
// @verifies docs/SPEC-administration-arborescence.md §13.3 (la liste lue à l'ouverture avec le `workspace_id` du
//           track ; l'écriture du §7 avec le track de la route ; un refus dans le formulaire, saisie conservée ;
//           « Annuler » et `Échap` retirent les paramètres et rendent la main), §13.4 (l'adresse d'origine garde le
//           chemin et les paramètres de la vue), §13.6 (le brouillon et le workflow attendu au retour)
// @verifies docs/DESIGN_SYSTEM.md §5.55, §5.50 (`Échap` referme)
//
// La zone est montée SEULE, dans un routeur dont l'adresse est lue par une sonde : ce qu'elle écrit dans l'adresse
// et ce qu'elle envoie au client factice sont les deux effets observés. Ce que la ROUTE fait ensuite — le board du
// nouveau channel, l'onglet focalisé, l'état vide sans lien — est éprouvé sur la pile réelle par
// `e2e/ui/nouveau-channel.spec.ts`, la coquille entière ne se montant pas sans elle.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { ZoneNouveauChannel } from './NouveauChannelTrack'
import { fr } from '../i18n'
import type { TrackOuvert } from '../lib/channels'
import type { ClientCrm } from '../lib/supabase'

const TRACK: TrackOuvert = { id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', workspace_id: 'ws-1' }

const WORKFLOWS = [
	{ id: 'wf-1', name: 'Pipeline standard', scope: 'global', is_default: true },
	{ id: 'wf-2', name: 'Partenariats', scope: 'track', is_default: false },
]

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

/** Client factice : il rend les workflows, et enregistre les filtres de lecture et les insertions reçues. */
function clientFactice(reponseEcriture: Reponse = { data: [{ id: 'c-9' }], error: null, status: 201 }) {
	const filtres: [string, string][] = []
	const insertions: { table: string; charge: Record<string, unknown> }[] = []
	const lecture = () => {
		const chaine: Record<string, unknown> = {}
		chaine['eq'] = (colonne: string, valeur: string) => {
			filtres.push([colonne, valeur])
			return chaine
		}
		chaine['or'] = (filtre: string) => {
			filtres.push(['or', filtre])
			return chaine
		}
		chaine['order'] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
			Promise.resolve({ data: WORKFLOWS, error: null, status: 200 }).then(resoudre)
		return chaine
	}
	const client = {
		from: (table: string) => ({
			select: () => lecture(),
			insert: (charge: Record<string, unknown>) => {
				insertions.push({ table, charge })
				return { select: () => Promise.resolve(reponseEcriture) }
			},
		}),
	} as unknown as ClientCrm
	return { client, filtres, insertions }
}

function SondeAdresse() {
	const { pathname, search } = useLocation()
	return <output data-testid="sonde-adresse">{`${pathname}${search}`}</output>
}

function monter(adresse: string, reponseEcriture?: Reponse) {
	const factice = clientFactice(reponseEcriture)
	const onCree = vi.fn()
	const onFerme = vi.fn()
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<ZoneNouveauChannel client={factice.client} track={TRACK} onCree={onCree} onFerme={onFerme} />
			<SondeAdresse />
		</MemoryRouter>,
	)
	return { ...factice, onCree, onFerme }
}

const adresse = () => screen.getByTestId('sonde-adresse').textContent ?? ''
const parametresDe = (valeur: string) => Object.fromEntries(new URLSearchParams(valeur.slice(valeur.indexOf('?') + 1)))

afterEach(cleanup)

describe('la zone « Nouveau channel » de la vue d’un track (§13.3)', () => {
	it('lit les workflows affectables À L’OUVERTURE, avec le workspace et le track de la route (§7.2, §7.3)', async () => {
		const { filtres } = monter('/tracks/conseil-ia?nouveau-channel=1')
		await screen.findByLabelText('Workflow')
		expect(filtres).toContainEqual(['workspace_id', 'ws-1'])
		expect(filtres).toContainEqual(['or', 'scope.eq.global,and(scope.eq.track,track_id.eq.t-1)'])
	})

	it('prend le focus dans son premier champ, sans défaut présélectionné', async () => {
		monter('/tracks/conseil-ia?nouveau-channel=1')
		const workflow = (await screen.findByLabelText('Workflow')) as HTMLSelectElement
		expect(document.activeElement).toBe(screen.getByLabelText('Nom'))
		expect(workflow.value).toBe('')
	})

	it('envoie l’écriture du §7 avec le track de la route, puis rend la main avec le slug et le nom', async () => {
		const utilisateur = userEvent.setup()
		const { insertions, onCree } = monter('/tracks/conseil-ia?nouveau-channel=1')
		await utilisateur.selectOptions(await screen.findByLabelText('Workflow'), 'wf-2')
		await utilisateur.type(screen.getByLabelText('Nom'), '  Partenariats ')
		// @verifies CRM-116 — §14.3 : la couleur choisie dans le sélecteur part avec la création.
		await utilisateur.click(screen.getByRole('radio', { name: 'Vert' }))
		await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(onCree).toHaveBeenCalledWith('partenariats', 'Partenariats'))
		expect(insertions).toEqual([
			{
				table: 'channels',
				charge: {
					workspace_id: 'ws-1',
					track_id: 't-1',
					workflow_id: 'wf-2',
					name: '  Partenariats ',
					slug: 'partenariats',
					description: null,
					color: 'success',
					position: null,
				},
			},
		])
	})

	it('un refus s’écrit DANS le formulaire, la saisie conservée, et rien n’est rendu à la route (§9)', async () => {
		const utilisateur = userEvent.setup()
		const { onCree } = monter('/tracks/conseil-ia?nouveau-channel=1', {
			data: null,
			error: { code: '42501', message: 'new row violates row-level security policy' },
			status: 403,
		})
		await utilisateur.selectOptions(await screen.findByLabelText('Workflow'), 'wf-1')
		await utilisateur.type(screen.getByLabelText('Nom'), 'Partenariats')
		await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))
		const formulaire = screen.getByTestId('formulaire-channel')
		expect((await within(formulaire).findByRole('alert')).textContent).toBe(fr['admin.refus.forbidden'])
		expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Partenariats')
		expect(onCree).not.toHaveBeenCalled()
		expect(adresse()).toContain('nouveau-channel=1')
	})

	it('« Annuler » retire le formulaire de l’adresse — et lui seul — puis rend la main', async () => {
		const utilisateur = userEvent.setup()
		const { onFerme } = monter('/tracks/conseil-ia/prospection/liste?page=2&nouveau-channel=1&nc-nom=X')
		await screen.findByLabelText('Workflow')
		await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))
		expect(adresse()).toBe('/tracks/conseil-ia/prospection/liste?page=2')
		expect(onFerme).toHaveBeenCalledTimes(1)
	})

	it('`Échap` depuis un champ referme comme « Annuler » (§5.50)', async () => {
		const utilisateur = userEvent.setup()
		const { onFerme } = monter('/tracks/conseil-ia?nouveau-channel=1')
		await screen.findByLabelText('Workflow')
		await utilisateur.type(screen.getByLabelText('Nom'), 'Brouillon{Escape}')
		expect(adresse()).toBe('/tracks/conseil-ia')
		expect(onFerme).toHaveBeenCalledTimes(1)
	})
})

describe('l’aller-retour depuis la vue d’un track (§13.4, §13.6)', () => {
	it('« Nouveau workflow » mène à l’éditeur et revient à l’adresse COURANTE, vue liste comprise', async () => {
		const utilisateur = userEvent.setup()
		monter('/tracks/conseil-ia/prospection/liste?page=2&nouveau-channel=1')
		await screen.findByLabelText('Workflow')
		await utilisateur.type(screen.getByLabelText('Nom'), 'Partenariats')
		const lien = screen.getByRole('link', { name: 'Nouveau workflow' }).getAttribute('href') ?? ''
		expect(lien.startsWith('/reglages/workflows?')).toBe(true)
		const { creer, track, retour = '' } = parametresDe(lien)
		expect({ creer, track }).toEqual({ creer: '1', track: 't-1' })
		expect(retour.startsWith('/tracks/conseil-ia/prospection/liste?')).toBe(true)
		expect(parametresDe(retour)).toEqual({ page: '2', 'nouveau-channel': '1', 'nc-nom': 'Partenariats' })
	})

	it('au retour, le formulaire est prérempli et le workflow créé choisi', async () => {
		monter('/tracks/conseil-ia?nouveau-channel=1&nc-nom=Partenariats&nc-description=Accords&nc-workflow=wf-2')
		const workflow = (await screen.findByLabelText('Workflow')) as HTMLSelectElement
		await waitFor(() => expect(workflow.value).toBe('wf-2'))
		expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Partenariats')
		expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('partenariats')
		expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Accords')
	})
})
