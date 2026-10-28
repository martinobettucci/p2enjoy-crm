// @verifies CRM-069 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Étiquettes — la liste, les archivées sous leur case, la
//           fiche dans le flux (nom, couleur en cinq radios nommées), l'archivage sans confirmation, les refus, les états
// @verifies docs/SPEC-etiquettes-digest.md §2.1 ; docs/DESIGN_SYSTEM.md §5.73, §5.71, §5.8, §5.59
//
// L'écran RÉEL est monté sur un client espion qui sert le catalogue et note chaque écriture. La pile réelle est éprouvée
// par `e2e/ui/etiquettes.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesEtiquettes } from './ReglagesEtiquettes'

afterEach(cleanup)

const LUES = [
	{ id: 'e-prio', name: 'Prioritaire', color: 'danger', archived_at: null },
	{ id: 'e-salon', name: 'Salon 2025', color: 'neutral', archived_at: '2026-01-15T09:00:00Z' },
]

function client(lues: readonly unknown[] = LUES, ecriture: { data: unknown; error: unknown; status: number } = { data: [{ id: 'n' }], error: null, status: 201 }) {
	const ecritures: { methode: string; valeur: unknown }[] = []
	const faux = {
		from: () => {
			const maillon: Record<string, unknown> = {}
			let ecrit = false
			for (const methode of ['select', 'eq', 'is']) maillon[methode] = () => maillon
			for (const methode of ['insert', 'update']) {
				maillon[methode] = (valeur: unknown) => {
					ecrit = true
					ecritures.push({ methode, valeur })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(ecrit ? ecriture : { data: lues, error: null, status: 200 })
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesEtiquettes client={c} />
		</FournisseurEspace>,
	)
}

describe('Réglages ▸ Étiquettes (docs/DESIGN_SYSTEM.md §5.73)', () => {
	it('la liste montre les non archivées ; « Afficher les archivées » ramène les autres, avec leur pilule', async () => {
		monter(client().client)
		const lignes = await screen.findAllByTestId('ligne-etiquette')
		expect(lignes.map((l) => l.textContent)).toEqual([expect.stringContaining('Prioritaire')])
		await userEvent.click(screen.getByLabelText(fr['admin.labels.showArchived']))
		const archivee = screen.getAllByTestId('ligne-etiquette')[1]!
		expect(archivee.textContent).toContain(fr['admin.labels.archived'])
		expect(within(archivee).getByRole('button', { name: 'Désarchiver l’étiquette Salon 2025' })).toBeDefined()
	})

	it('« Nouvelle étiquette » : le focus dans le nom, cinq couleurs nommées, l’envoi normalisé, l’annonce', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		expect(await screen.findByText(fr['admin.labels.empty.title'])).toBeDefined()
		await userEvent.click(screen.getByTestId('nouvelle-etiquette'))
		const nom = screen.getByLabelText(fr['admin.labels.field.name'])
		expect(document.activeElement).toBe(nom)
		const couleurs = screen.getAllByRole('radio').map((r) => (r.closest('label') as HTMLElement).textContent)
		expect(couleurs).toEqual(['Bleu', 'Vert', 'Jaune', 'Rouge', 'Gris'])
		expect((screen.getByRole('radio', { name: 'Gris' }) as HTMLInputElement).checked).toBe(true)
		await userEvent.type(nom, '  Partenaire ')
		await userEvent.click(screen.getByRole('radio', { name: 'Vert' }))
		await userEvent.click(screen.getByTestId('etiquette-enregistrer'))
		expect(ecritures).toEqual([{ methode: 'insert', valeur: { workspace_id: 'ws-1', name: 'Partenaire', color: 'success' } }])
		await waitFor(() => expect(screen.getByTestId('annonce-etiquettes').textContent).toBe('Étiquette « Partenaire » enregistrée.'))
	})

	it('un nom pris est refusé sous les champs, la saisie gardée, le focus sur le nom', async () => {
		monter(client(LUES, { data: null, error: { code: '23505', message: 'dup' }, status: 409 }).client)
		await userEvent.click(await screen.findByRole('button', { name: 'Modifier l’étiquette Prioritaire' }))
		const nom = screen.getByLabelText(fr['admin.labels.field.name']) as HTMLInputElement
		expect(nom.value).toBe('Prioritaire')
		expect((screen.getByRole('radio', { name: 'Rouge' }) as HTMLInputElement).checked).toBe(true)
		await userEvent.click(screen.getByTestId('etiquette-enregistrer'))
		expect((await screen.findByRole('alert')).textContent).toContain(fr['admin.labels.refus.nom'])
		expect(document.activeElement).toBe(nom)
	})

	it('« Archiver » écrit l’instant sans confirmation ; refusée, l’écran est réservé', async () => {
		const { client: c, ecritures } = client(LUES, { data: [{ id: 'e-prio' }], error: null, status: 200 })
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: 'Archiver l’étiquette Prioritaire' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(typeof (ecritures[0]!.valeur as { archived_at: unknown }).archived_at).toBe('string')
		cleanup()
		monter(client().client, 'refusee')
		expect(screen.getByText(fr['admin.labels.forbidden.title'])).toBeDefined()
	})
})
