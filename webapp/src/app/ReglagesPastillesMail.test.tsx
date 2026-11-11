// @verifies CRM-141 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Pastilles des mails — la liste et ses descriptifs, les
//           archivées sous leur case, la fiche dans le flux (nom, couleur, descriptif pour l'IA), l'archivage confirmé, le
//           désarchivage sans confirmation, les refus, l'écran lisible par tout membre et ses commandes éteintes avec motif
// @verifies docs/SPEC-mail-subsystem.md §31.3, §31.7 ; docs/DESIGN_SYSTEM.md §5.103, §5.29 bis, §5.59, §5.8 ;
//           docs/JOURNAL.md décision 926
//
// L'écran RÉEL est monté sur un client espion qui sert la liste et note chaque écriture. La pile réelle est éprouvée par
// `e2e/ui/pastilles-reglages.spec.ts` et, pour les droits, par `e2e/api/pastilles-reglages.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesPastillesMail } from './ReglagesPastillesMail'

afterEach(cleanup)

const LUES = [
	{ id: 'p-spam', name: 'Spam', color: 'danger', description: 'Courrier indésirable.', archived_at: null },
	{ id: 'p-lead', name: 'Lead', color: 'success', description: 'Un prospect intéressé.', archived_at: null },
	{ id: 'p-news', name: 'Newsletter', color: 'neutral', description: 'Une lettre d’information.', archived_at: '2026-11-11T09:00:00Z' },
]

type Ecriture = { methode: string; valeur: unknown }

function client(
	lues: readonly unknown[] = LUES,
	ecriture: { data: unknown; error: unknown; status: number } = { data: [{ id: 'n' }], error: null, status: 201 },
) {
	const ecritures: Ecriture[] = []
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
			<ReglagesPastillesMail client={c} />
		</FournisseurEspace>,
	)
}

describe('Réglages ▸ Pastilles des mails (docs/DESIGN_SYSTEM.md §5.103)', () => {
	it('la liste montre les actives et leur descriptif ; « Afficher les archivées » ramène les autres, mention textuelle', async () => {
		monter(client().client)
		const lignes = await screen.findAllByTestId('ligne-pastille-mail')
		expect(lignes.map((l) => within(l).getByTestId('pastille-etiquette').textContent)).toEqual(['Lead', 'Spam'])
		expect(within(lignes[0]!).getByTestId('descriptif-pastille-mail').textContent).toBe('Un prospect intéressé.')
		await userEvent.click(screen.getByLabelText(fr['admin.mailLabels.showArchived']))
		const archivee = screen.getAllByTestId('ligne-pastille-mail')[2]!
		expect(archivee.textContent).toContain(fr['admin.mailLabels.archived'])
		// Une archivée ne garde que « Désarchiver » (§5.29 bis), et sa pilule le dit dans son nom accessible.
		expect(within(archivee).queryByRole('button', { name: /Modifier/ })).toBeNull()
		expect(within(archivee).getByRole('button', { name: 'Désarchiver la pastille Newsletter' })).toBeTruthy()
		expect(within(archivee).getByRole('img').getAttribute('aria-label')).toBe('Newsletter, pastille archivée')
	})

	it('« Nouvelle pastille » ouvre la fiche dans le flux ; l’envoi porte le nom, la couleur et le descriptif nettoyés', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		await screen.findAllByTestId('ligne-pastille-mail')
		await userEvent.click(screen.getByTestId('nouvelle-pastille'))
		expect(document.activeElement).toBe(screen.getByTestId('pastille-nom'))
		await userEvent.type(screen.getByTestId('pastille-nom'), '  Youtube ')
		await userEvent.click(screen.getByRole('radio', { name: /Rouge/ }))
		await userEvent.type(screen.getByTestId('pastille-descriptif'), ' Toute demande pour la chaîne. ')
		await userEvent.click(screen.getByTestId('pastille-enregistrer'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({
			methode: 'insert',
			valeur: { workspace_id: 'ws-1', name: 'Youtube', color: 'danger', description: 'Toute demande pour la chaîne.' },
		})
	})

	it('un nom pris par une ARCHIVÉE : le refus nomme « Afficher les archivées », la saisie est gardée', async () => {
		monter(client(LUES, { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 }).client)
		await screen.findAllByTestId('ligne-pastille-mail')
		await userEvent.click(screen.getByTestId('nouvelle-pastille'))
		await userEvent.type(screen.getByTestId('pastille-nom'), 'newsletter')
		await userEvent.type(screen.getByTestId('pastille-descriptif'), 'x')
		await userEvent.click(screen.getByTestId('pastille-enregistrer'))
		const refus = await screen.findByTestId('refus-pastille-mail')
		expect(refus.textContent).toBe(fr['admin.mailLabels.refus.nomArchivee'])
		expect((screen.getByTestId('pastille-nom') as HTMLInputElement).value).toBe('newsletter')
	})

	it('« Archiver » ouvre une confirmation dans le flux, qui dit la conséquence ; « Annuler » n’écrit rien', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		const [lead] = await screen.findAllByTestId('ligne-pastille-mail')
		await userEvent.click(within(lead!).getByRole('button', { name: 'Archiver la pastille Lead' }))
		const confirmation = within(lead!).getByTestId('confirmation-archivage')
		expect(confirmation.textContent).toContain(fr['admin.mailLabels.archive.confirm'].replace('{nom}', 'Lead'))
		expect(confirmation.textContent).toContain(fr['admin.mailLabels.archive.confirm.body'])
		await userEvent.click(within(confirmation).getByRole('button', { name: fr['admin.action.cancel'] }))
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		expect(ecritures).toHaveLength(0)
	})

	it('confirmer archive ; « Désarchiver » écrit aussitôt, sans confirmation', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		const [lead] = await screen.findAllByTestId('ligne-pastille-mail')
		await userEvent.click(within(lead!).getByRole('button', { name: 'Archiver la pastille Lead' }))
		await userEvent.click(within(lead!).getByRole('button', { name: fr['admin.archive.confirm.action'] }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]!.methode).toBe('update')
		expect(typeof (ecritures[0]!.valeur as { archived_at: unknown }).archived_at).toBe('string')
		await userEvent.click(screen.getByLabelText(fr['admin.mailLabels.showArchived']))
		await userEvent.click(screen.getByRole('button', { name: 'Désarchiver la pastille Newsletter' }))
		await waitFor(() => expect(ecritures).toHaveLength(2))
		expect(ecritures[1]).toEqual({ methode: 'update', valeur: { archived_at: null } })
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
	})

	it('qui n’administre pas l’espace LIT l’écran ; les commandes sont rendues, éteintes, avec le motif', async () => {
		monter(client().client, 'refusee')
		await screen.findAllByTestId('ligne-pastille-mail')
		const motif = screen.getByTestId('motif-lecture-seule')
		expect(motif.textContent).toBe(fr['rights.readonly.administration'])
		const nouvelle = screen.getByTestId('nouvelle-pastille') as HTMLButtonElement
		expect(nouvelle.disabled).toBe(true)
		expect(nouvelle.getAttribute('aria-describedby')).toBe(motif.id)
		for (const bouton of screen.getAllByRole('button', { name: /^(Modifier|Archiver) la pastille/ })) {
			expect((bouton as HTMLButtonElement).disabled).toBe(true)
		}
	})

	it('les états : l’erreur de lecture offre « Réessayer » ; une liste vide le dit', async () => {
		const enPanne = {
			from: () => {
				const maillon: Record<string, unknown> = {}
				for (const methode of ['select', 'eq']) maillon[methode] = () => maillon
				maillon.then = (resoudre: (r: unknown) => unknown) => resoudre({ data: null, error: { message: 'fetch failed' }, status: 0 })
				return maillon
			},
		} as unknown as ClientCrm
		monter(enPanne)
		expect(await screen.findByRole('button', { name: fr['state.error.retry'] })).toBeTruthy()
		cleanup()
		monter(client([]).client)
		expect(await screen.findByText(fr['admin.mailLabels.empty.title'])).toBeTruthy()
	})
})
