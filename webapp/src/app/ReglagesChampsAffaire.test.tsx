// @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.a : Réglages ▸ « Champs de l'affaire » — la liste dans l'ordre, les
//           archivés sous leur case, la déclaration (clé, type, choix), l'édition qui fige clé et type, l'ordre en une
//           écriture, l'archivage confirmé et son refus qui nomme les transitions et le geste, la capacité refusée qui
//           éteint les commandes avec leur motif, les états
// @verifies CRM-112 tranche T4.a — la case « Afficher dans la liste des affaires », refusée aux types personne, contact et
//           fichier, et la pilule « Dans la liste » (docs/DESIGN_SYSTEM.md §5.91)
// @verifies docs/SPEC-champs-communs.md §3.2, §4, §6, §7 ; docs/DESIGN_SYSTEM.md §5.86, §5.15, §5.59, §5.8
//
// L'écran RÉEL est monté sur un client espion qui sert les champs et note chaque écriture. La pile réelle est éprouvée
// par `e2e/ui/reglages-champs-affaire.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { fr, t } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import { classerRefusChampCommun } from '../lib/champs-communs'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesChampsAffaire } from './ReglagesChampsAffaire'

afterEach(cleanup)

const LUS = [
	{ id: 'c-siret', key: 'siret', label: 'SIRET', type: 'text', options: {}, help_text: null, position: 1, archived_at: null },
	{
		id: 'c-secteur',
		key: 'secteur',
		label: 'Secteur',
		type: 'select',
		options: { choices: [{ key: 'industrie', label: 'Industrie' }] },
		help_text: 'Le secteur du client',
		position: 2,
		archived_at: null,
	},
	{ id: 'c-ancien', key: 'ancien', label: 'Ancien code', type: 'text', options: {}, help_text: null, position: 3, archived_at: '2026-10-01T00:00:00Z' },
]

type Reponse = { data: unknown; error: unknown; status: number }

function client(lus: readonly unknown[] = LUS, ecriture: Reponse = { data: [{ id: 'n' }], error: null, status: 201 }) {
	const ecritures: { methode: string; valeur: unknown; filtres: unknown[] }[] = []
	const lectures: unknown[][] = []
	const faux = {
		from: (table: string) => {
			expect(table).toBe('card_common_fields')
			const maillon: Record<string, unknown> = {}
			let courante: { methode: string; valeur: unknown; filtres: unknown[] } | null = null
			const filtres: unknown[] = []
			maillon.select = () => maillon
			maillon.order = () => maillon
			maillon.eq = (colonne: string, valeur: unknown) => {
				filtres.push([colonne, valeur])
				return maillon
			}
			for (const methode of ['insert', 'update']) {
				maillon[methode] = (valeur: unknown) => {
					courante = { methode, valeur, filtres }
					ecritures.push(courante)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				if (courante !== null) return resoudre(ecriture)
				lectures.push(filtres)
				return resoudre({ data: lus, error: null, status: 200 })
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures, lectures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<MemoryRouter>
			<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
				<ReglagesChampsAffaire client={c} />
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const lignes = () => screen.getAllByTestId('ligne-champ')

describe('Réglages ▸ Champs de l’affaire (docs/DESIGN_SYSTEM.md §5.86)', () => {
	it('la liste de l’espace, dans l’ordre ; « Afficher les archivés » ramène l’archivé, nommé, avec « Restaurer »', async () => {
		const { client: c, lectures } = client()
		monter(c)
		await waitFor(() => expect(lignes()).toHaveLength(2))
		expect(lectures[0]).toEqual([['workspace_id', 'ws-1']])
		expect(lignes().map((l) => l.querySelector('code')?.textContent)).toEqual(['siret', 'secteur'])
		expect(lignes()[1]!.textContent).toContain('Le secteur du client')
		await userEvent.click(screen.getByLabelText(fr['admin.commonFields.showArchived']))
		const archive = lignes()[2]!
		expect(archive.textContent).toContain(fr['admin.workflows.fields.archived'])
		expect(within(archive).getByRole('button', { name: t('admin.workflows.fields.action.restore', { nom: 'Ancien code' }) })).toBeDefined()
		// L'ordre se dit, il ne se masque pas : « Monter » existe sur la première ligne, désactivé.
		expect((within(lignes()[0]!).getByRole('button', { name: t('admin.action.up', { nom: 'SIRET' }) }) as HTMLButtonElement).disabled).toBe(true)
	})

	it('« Nouveau champ » : la clé d’abord, une liste à choix, l’envoi composé ; l’annonce, et le focus rendu', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		expect(await screen.findByText(fr['admin.commonFields.empty.title'])).toBeDefined()
		await userEvent.click(screen.getByTestId('nouveau-champ-commun'))
		const cle = screen.getByLabelText(fr['admin.workflows.fields.form.key'])
		expect(document.activeElement).toBe(cle)
		await userEvent.type(cle, 'budget-client')
		await userEvent.type(screen.getByLabelText(fr['admin.workflows.fields.form.label']), ' Budget du client ')
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.workflows.fields.form.type']), 'money')
		await userEvent.click(screen.getByRole('button', { name: fr['admin.action.save'] }))
		expect(ecritures).toEqual([
			{
				methode: 'insert',
				// RÉVISÉ PAR `CRM-112` T4.a (§5.91) : la déclaration porte `is_listed`, faux sans la case cochée — décision 51.
				valeur: {
					workspace_id: 'ws-1',
					key: 'budget-client',
					label: 'Budget du client',
					type: 'money',
					help_text: null,
					options: { currency: 'EUR' },
					is_listed: false,
				},
				filtres: [],
			},
		])
		await waitFor(() => expect(screen.getByTestId('region-annonces').textContent).toBe(t('admin.commonFields.saved', { nom: 'Budget du client' })))
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('nouveau-champ-commun')))
	})

	it('l’édition fige la clé et le type, en phrase ; elle n’envoie que libellé, aide et options', async () => {
		const { client: c, ecritures } = client(LUS, { data: [{ id: 'c-secteur' }], error: null, status: 200 })
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: t('admin.workflows.fields.action.edit', { nom: 'Secteur' }) }))
		expect(screen.getByTestId('champ-cle-figee').textContent).toContain('secteur')
		expect(screen.getByTestId('champ-type-fige')).toBeDefined()
		const libelle = screen.getByLabelText(fr['admin.workflows.fields.form.label'])
		await userEvent.clear(libelle)
		await userEvent.type(libelle, 'Secteur d’activité')
		await userEvent.click(screen.getByRole('button', { name: fr['admin.action.save'] }))
		expect(ecritures[0]).toEqual({
			methode: 'update',
			// RÉVISÉ PAR `CRM-112` T4.a (§5.91) : la modification réécrit aussi `is_listed` — décision 51.
			valeur: {
				label: 'Secteur d’activité',
				help_text: 'Le secteur du client',
				options: { choices: [{ key: 'industrie', label: 'Industrie' }] },
				is_listed: false,
			},
			filtres: [['id', 'c-secteur']],
		})
	})

	it('descendre écrit UNE position, entre les voisines', async () => {
		const { client: c, ecritures } = client(LUS, { data: [{ id: 'c-siret' }], error: null, status: 200 })
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: t('admin.action.down', { nom: 'SIRET' }) }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		// Descendre en fin de liste visible : la position suivante plus un.
		expect(ecritures[0]).toEqual({ methode: 'update', valeur: { position: 3 }, filtres: [['id', 'c-siret']] })
	})

	it('archiver passe par la confirmation ; le refus nomme les transitions et mène à l’éditeur', async () => {
		const refus = {
			data: null,
			error: { code: 'P0001', message: 'common_field_in_use', details: 'Cycle commercial standard : Négociation → Signature' },
			status: 400,
		}
		const { client: c, ecritures } = client(LUS, refus)
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: t('admin.workflows.fields.action.archive', { nom: 'SIRET' }) }))
		const confirmation = screen.getByTestId('confirmation-archivage-champ-commun')
		expect(confirmation.textContent).toContain(t('admin.commonFields.archive.confirm', { nom: 'SIRET' }))
		await userEvent.click(within(confirmation).getByRole('button', { name: fr['admin.workflows.fields.archive.confirm.action'] }))
		expect(typeof (ecritures[0]!.valeur as { archived_at: unknown }).archived_at).toBe('string')
		const alerte = await within(confirmation).findByRole('alert')
		expect(alerte.textContent).toContain('Cycle commercial standard : Négociation → Signature')
		expect(within(confirmation).getByRole('link', { name: fr['admin.commonFields.refus.employe.lien'] }).getAttribute('href')).toBe('/reglages/workflows')
		// Annuler rend le focus à « Archiver » (§5.13).
		await userEvent.click(within(confirmation).getByRole('button', { name: fr['admin.action.cancel'] }))
		await waitFor(() =>
			expect(document.activeElement?.getAttribute('aria-label')).toBe(t('admin.workflows.fields.action.archive', { nom: 'SIRET' })),
		)
	})

	it('la capacité refusée : le motif en tête, chaque commande montée, désactivée, qui le cite', async () => {
		monter(client().client, 'refusee')
		await waitFor(() => expect(lignes()).toHaveLength(2))
		expect(screen.getByTestId('motif-lecture-seule').textContent).toBe(fr['rights.readonly.administration'])
		const nouveau = screen.getByTestId('nouveau-champ-commun') as HTMLButtonElement
		expect(nouveau.disabled).toBe(true)
		expect(nouveau.getAttribute('aria-describedby')).toBe('motif-champs-affaire')
		const modifier = screen.getByRole('button', { name: t('admin.workflows.fields.action.edit', { nom: 'SIRET' }) }) as HTMLButtonElement
		expect(modifier.disabled).toBe(true)
	})

	it('une lecture en panne se dit, avec « Réessayer »', async () => {
		const panne = {
			from: () => {
				const m: Record<string, unknown> = {}
				for (const methode of ['select', 'eq', 'order']) m[methode] = () => m
				m.then = (resoudre: (r: unknown) => unknown) => resoudre({ data: null, error: { message: 'panne' }, status: 500 })
				return m
			},
		} as unknown as ClientCrm
		monter(panne)
		expect(await screen.findByText(fr['admin.commonFields.error.title'])).toBeDefined()
		expect(screen.getByRole('button', { name: fr['state.error.retry'] })).toBeDefined()
	})
})

describe('la case « Afficher dans la liste des affaires » (CRM-112 T4.a, §5.91)', () => {
	it('cochée, elle part avec la déclaration ; un type personne la rend désactivée, avec sa raison', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		await userEvent.click(await screen.findByTestId('nouveau-champ-commun'))
		await userEvent.type(screen.getByLabelText(fr['admin.workflows.fields.form.key']), 'siret')
		await userEvent.type(screen.getByLabelText(fr['admin.workflows.fields.form.label']), 'SIRET')
		const caseListe = screen.getByLabelText(fr['admin.commonFields.form.listed']) as HTMLInputElement
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.workflows.fields.form.type']), 'user')
		expect(caseListe.disabled).toBe(true)
		expect(screen.getByText(fr['admin.commonFields.form.listed.unavailable'])).toBeDefined()
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.workflows.fields.form.type']), 'text')
		expect(caseListe.disabled).toBe(false)
		await userEvent.click(caseListe)
		await userEvent.click(screen.getByRole('button', { name: fr['admin.action.save'] }))
		expect((ecritures[0]?.valeur as { is_listed: boolean }).is_listed).toBe(true)
	})

	it('un champ listé porte la pilule « Dans la liste » sur sa ligne', async () => {
		monter(client([{ ...LUS[0], is_listed: true }, LUS[1]]).client)
		await waitFor(() => expect(lignes()).toHaveLength(2))
		expect(within(lignes()[0]!).getByTestId('champ-dans-la-liste').textContent).toBe(fr['admin.commonFields.listed.pill'])
		expect(within(lignes()[1]!).queryByTestId('champ-dans-la-liste')).toBeNull()
	})
})

describe('classerRefusChampCommun', () => {
	it('le dictionnaire fermé : employé avec son détail, clé prise, forme, droit, réseau, inconnu', () => {
		expect(classerRefusChampCommun(400, { code: 'P0001', message: 'common_field_in_use', details: 'A : x → y' })).toEqual({ nature: 'employe', detail: 'A : x → y' })
		expect(classerRefusChampCommun(409, { code: '23505', message: 'dup' }).nature).toBe('cle-prise')
		expect(classerRefusChampCommun(400, { code: '23514', message: 'check' }).nature).toBe('forme')
		expect(classerRefusChampCommun(403, { code: '42501', message: 'rls' }).nature).toBe('forbidden')
		expect(classerRefusChampCommun(undefined, { message: 'Failed to fetch' }).nature).toBe('network')
		expect(classerRefusChampCommun(500, { message: 'boom' }).nature).toBe('unknown')
	})
})
