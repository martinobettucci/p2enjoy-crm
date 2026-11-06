// @verifies CRM-112 (docs/BACKLOG.md) — tranche T8 : l'arrivée sur un champ demandé attend la fin de la lecture de la partie
//           commune (docs/DESIGN_SYSTEM.md §5.88, §5.7 quater ; décision 856)
// @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.c : la partie commune de la fiche — la composition (actifs dans l'ordre,
//           archivé valué en lecture, archivé vide absent, clés demandées), l'écriture par mise à jour puis insertion et
//           sa reprise sur un `23505`, le bloc absent sans objet, le champ demandé et son focus, la capacité refusée,
//           l'erreur de lecture
// @verifies docs/SPEC-champs-communs.md §3.3, §7 (précision T3.c) ; docs/DESIGN_SYSTEM.md §5.88, §5.7 quater, §5.59, §5.8
//
// Le bloc RÉEL est monté sur un client espion qui sert les champs et les valeurs et note chaque écriture. La pile réelle est
// éprouvée par `e2e/ui/fiche-champs-communs.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { composerPartieCommune, ecrireValeurCommune } from '../lib/champs-communs'
import type { ClientCrm } from '../lib/supabase'
import { BlocChampsCommunsCard } from './BlocChampsCommunsCard'

afterEach(cleanup)

const CHAMPS = [
	{ id: 'cc-secteur', key: 'secteur', label: 'Secteur', type: 'text', options: {}, help_text: null, position: 2, archived_at: null },
	{ id: 'cc-siret', key: 'siret', label: 'SIRET', type: 'text', options: {}, help_text: 'Quatorze chiffres', position: 1, archived_at: null },
	{ id: 'cc-vieux', key: 'vieux', label: 'Ancien code', type: 'text', options: {}, help_text: null, position: 3, archived_at: '2026-10-01T00:00:00Z' },
	{ id: 'cc-vide', key: 'vide', label: 'Archivé vide', type: 'text', options: {}, help_text: null, position: 4, archived_at: '2026-10-01T00:00:00Z' },
]
const VALEURS = [
	{ field_id: 'cc-siret', value: '12345678900011' },
	{ field_id: 'cc-vieux', value: 'A-42' },
]

type Reponse = { data: unknown; error: unknown; status: number }

function client(options: { champs?: unknown[]; valeurs?: unknown[]; maj?: Reponse; insertion?: Reponse; erreurLecture?: boolean } = {}) {
	const ecritures: { verbe: string; charge: unknown; filtres: unknown[] }[] = []
	const majs = [options.maj ?? { data: [{ field_id: 'x' }], error: null, status: 200 }]
	const faux = {
		from: (table: string) => {
			const filtres: unknown[] = []
			let ecriture: { verbe: string; charge: unknown; filtres: unknown[] } | null = null
			const m: Record<string, unknown> = {}
			m.select = () => m
			m.order = () => m
			m.eq = (colonne: string, valeur: unknown) => {
				filtres.push([colonne, valeur])
				return m
			}
			m.update = (charge: unknown) => {
				ecriture = { verbe: 'update', charge, filtres }
				ecritures.push(ecriture)
				return m
			}
			m.insert = (charge: unknown) => {
				ecriture = { verbe: 'insert', charge, filtres }
				ecritures.push(ecriture)
				return m
			}
			m.then = (resoudre: (r: unknown) => unknown) => {
				if (ecriture?.verbe === 'update') return resoudre(majs.shift() ?? { data: [{ field_id: 'x' }], error: null, status: 200 })
				if (ecriture?.verbe === 'insert') return resoudre(options.insertion ?? { data: [{ field_id: 'x' }], error: null, status: 201 })
				if (options.erreurLecture === true) return resoudre({ data: null, error: { message: 'panne' }, status: 500 })
				if (table === 'card_common_fields') return resoudre({ data: options.champs ?? CHAMPS, error: null, status: 200 })
				return resoudre({ data: options.valeurs ?? VALEURS, error: null, status: 200 })
			}
			return m
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures, majs }
}

describe('composerPartieCommune (docs/DESIGN_SYSTEM.md §5.88)', () => {
	it('les actifs dans l’ordre de la partie commune ; l’archivé valué en lecture ; l’archivé vide absent', () => {
		const partie = composerPartieCommune(CHAMPS, VALEURS, ['secteur', 'vieux', 'inconnu'])
		expect(partie.actifs.map((r) => r.champ.key)).toEqual(['siret', 'secteur'])
		expect(partie.actifs.every((r) => r.visibilite === 'visible' && !r.manquant)).toBe(true)
		expect(partie.archives.map((r) => r.champ.key)).toEqual(['vieux'])
		// Une clé demandée qui n'est pas un champ ACTIF est ignorée, comme au formulaire (§4 ter.7).
		expect(partie.clesExigeesRetenues).toEqual(['secteur'])
		expect(partie.actifs.find((r) => r.champ.key === 'secteur')?.exigeParDeplacement).toBe(true)
	})
})

describe('ecrireValeurCommune (docs/SPEC-champs-communs.md §7)', () => {
	it('met à jour la ligne qui existe, sans insertion', async () => {
		const espion = client()
		const issue = await ecrireValeurCommune(espion.client, { idCard: 'c-1', idChamp: 'cc-siret', idWorkspace: 'ws-1', valeur: '1' })
		expect(issue).toEqual({ statut: 'enregistree' })
		expect(espion.ecritures).toEqual([{ verbe: 'update', charge: { value: '1' }, filtres: [['card_id', 'c-1'], ['field_id', 'cc-siret']] }])
	})

	it('insère quand aucune ligne n’existe ; reprend en mise à jour sur un 23505 ; traduit un refus de valeur', async () => {
		const vide = { data: [], error: null, status: 200 }
		const espion = client({ maj: vide })
		expect(await ecrireValeurCommune(espion.client, { idCard: 'c-1', idChamp: 'cc-secteur', idWorkspace: 'ws-1', valeur: 'BTP' })).toEqual({
			statut: 'enregistree',
		})
		expect(espion.ecritures.map((e) => e.verbe)).toEqual(['update', 'insert'])
		expect(espion.ecritures[1]?.charge).toEqual({ card_id: 'c-1', field_id: 'cc-secteur', workspace_id: 'ws-1', value: 'BTP' })

		const course = client({ maj: vide, insertion: { data: null, error: { code: '23505', message: 'dup' }, status: 409 } })
		expect(await ecrireValeurCommune(course.client, { idCard: 'c-1', idChamp: 'cc-secteur', idWorkspace: 'ws-1', valeur: 'BTP' })).toEqual({
			statut: 'enregistree',
		})
		expect(course.ecritures.map((e) => e.verbe)).toEqual(['update', 'insert', 'update'])

		const invalide = client({ maj: { data: null, error: { message: 'invalid_field_value' }, status: 400 } })
		const refus = await ecrireValeurCommune(invalide.client, { idCard: 'c-1', idChamp: 'cc-siret', idWorkspace: 'ws-1', valeur: 'x' })
		expect(refus.statut === 'refus' && refus.refus.nature).toBe('invalid')
	})
})

describe('BlocChampsCommunsCard (docs/DESIGN_SYSTEM.md §5.88)', () => {
	it('rend les champs actifs saisissables, l’archivé valué en lecture avec « Archivé », et enregistre une saisie', async () => {
		const espion = client()
		render(<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={[]} focaliser client={espion.client} />)
		const bloc = await screen.findByTestId('bloc-champs-communs')
		expect(within(bloc).getByRole('heading', { level: 2 }).textContent).toBe(fr['card.commonFields.title'])
		const siret = (await within(bloc).findByLabelText('SIRET')) as HTMLInputElement
		expect(siret.value).toBe('12345678900011')
		expect(within(bloc).getByTestId('commun-archive-vieux').textContent).toContain('A-42')
		expect(within(bloc).getByTestId('commun-archive-vieux').textContent).toContain(fr['card.commonFields.archived'])
		expect(within(bloc).queryByTestId('commun-archive-vide')).toBeNull()
		expect(within(bloc).queryByText(/Requis à l’étape/)).toBeNull()
		await userEvent.type(within(bloc).getByLabelText('Secteur'), 'BTP')
		await userEvent.tab()
		await waitFor(() => expect(espion.ecritures.some((e) => e.verbe === 'update' || e.verbe === 'insert')).toBe(true))
	})

	// `CRM-112` T8 : la fin de la lecture est signalée à la fiche, que le bloc rende des champs ou rien.
	it('CRM-112 T8 : signale la fin de sa lecture, avec des champs comme sans aucun', async () => {
		const lu = vi.fn()
		render(<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={[]} focaliser={false} onLu={lu} client={client().client} />)
		expect(lu).not.toHaveBeenCalled()
		await screen.findByLabelText('Secteur')
		expect(lu).toHaveBeenCalled()
		const vide = vi.fn()
		render(<BlocChampsCommunsCard idCard="c-2" idWorkspace="ws-1" clesExigees={[]} focaliser={false} onLu={vide} client={client({ champs: [], valeurs: [] }).client} />)
		await waitFor(() => expect(vide).toHaveBeenCalled())
	})

	it('un espace sans champ commun ne rend aucun bloc', async () => {
		const { container } = render(
			<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={[]} focaliser client={client({ champs: [], valeurs: [] }).client} />,
		)
		await waitFor(() => expect(container.querySelector('[data-testid="bloc-champs-communs"]')).toBeNull())
		expect(screen.queryByRole('status')).toBeNull()
	})

	it('un champ demandé par un déplacement refusé est mis en évidence et prend le focus', async () => {
		render(<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={['secteur']} focaliser client={client().client} />)
		const champ = await screen.findByLabelText('Secteur')
		await waitFor(() => expect(document.activeElement).toBe(champ))
		expect(screen.getByText(fr['form.demanded'])).toBeDefined()
	})

	it('sans focus quand le formulaire d’étape a déjà le sien', async () => {
		render(<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={['secteur']} focaliser={false} client={client().client} />)
		const champ = await screen.findByLabelText('Secteur')
		expect(document.activeElement).not.toBe(champ)
	})

	it('la capacité de l’affaire refusée : les champs inactifs, lisibles, et citant le motif', async () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif-card' }}>
				<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={[]} focaliser client={client().client} />
			</FournisseurRefus>,
		)
		const siret = (await screen.findByLabelText('SIRET')) as HTMLInputElement
		expect(siret.disabled).toBe(true)
		expect(siret.value).toBe('12345678900011')
		expect(siret.getAttribute('aria-describedby')).toContain('motif-card')
	})

	it('une lecture en panne se dit dans le bloc, avec « Réessayer »', async () => {
		render(<BlocChampsCommunsCard idCard="c-1" idWorkspace="ws-1" clesExigees={[]} focaliser client={client({ erreurLecture: true }).client} />)
		expect((await screen.findByRole('alert')).textContent).toContain(fr['card.commonFields.error'])
		expect(screen.getByRole('button', { name: fr['state.error.retry'] })).toBeDefined()
	})
})
