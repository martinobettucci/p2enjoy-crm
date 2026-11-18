// @verifies CRM-156 (docs/BACKLOG.md) — tranche T4 : Réglages ▸ Expéditeurs bloqués — la liste lue (l'adresse en `code`,
//           « Bloqué par {nom} le {date} »), le vide sans action, « Débloquer » sans icône et éteint sans l'administration,
//           sa confirmation courte dans le flux (primaire, `Échap`, le focus sur « Annuler »), l'appel `unblock_sender`, le
//           refus traduit, la relecture et l'annonce
// @verifies docs/DESIGN_SYSTEM.md §5.109 bis (« RÉGLAGES ▸ EXPÉDITEURS BLOQUÉS ») ; docs/SPEC-mail-subsystem.md §32.8 ;
//           docs/JOURNAL.md décision 947

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesExpediteursBloques } from './ReglagesExpediteursBloques'

afterEach(cleanup)

const LUS = [
	{ address: 'promo@bruit.example', created_at: '2026-11-18T09:00:00Z', auteur: { full_name: 'Camille Admin' } },
	{ address: 'spam@exemple.test', created_at: '2026-11-17T08:00:00Z', auteur: null },
]

type Reponse = { data: unknown; error: unknown; status: number }

function client(lus: readonly unknown[] = LUS, deblocage: Reponse = { data: null, error: null, status: 204 }) {
	const appels: [string, unknown][] = []
	let lectures = 0
	let restants = [...lus]
	const faux = {
		from: () => {
			const maillon: Record<string, unknown> = {}
			maillon.select = () => maillon
			maillon.eq = () => maillon
			maillon.order = () => maillon
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				lectures += 1
				return resoudre({ data: restants, error: null, status: 200 })
			}
			return maillon
		},
		rpc: async (fonction: string, corps: { p_address: string }) => {
			appels.push([fonction, corps])
			if (deblocage.error === null) restants = restants.filter((l) => (l as { address: string }).address !== corps.p_address)
			return deblocage
		},
	} as unknown as ClientCrm
	return { client: faux, appels, lectures: () => lectures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesExpediteursBloques client={c} />
		</FournisseurEspace>,
	)
}

describe('Réglages ▸ Expéditeurs bloqués (§5.109 bis)', () => {
	it('une ligne par adresse : l’adresse en `code`, qui l’a bloquée et quand ; « Compte supprimé » pour un profil détaché', async () => {
		monter(client().client)
		const lignes = await screen.findAllByTestId('ligne-expediteur-bloque')
		expect(lignes).toHaveLength(2)
		expect(within(lignes[0]!).getByText('promo@bruit.example').tagName).toBe('CODE')
		expect(lignes[0]!.textContent).toMatch(/Bloqué par Camille Admin le 18\/11\/2026/)
		expect(lignes[1]!.textContent).toMatch(/Bloqué par Compte supprimé le 17\/11\/2026/)
		const debloquer = within(lignes[0]!).getByTestId('debloquer-expediteur')
		expect(debloquer.querySelector('svg')).toBeNull()
		expect(debloquer.getAttribute('aria-label')).toBe('Débloquer promo@bruit.example')
	})

	it('le vide se dit, sans aucune action', async () => {
		monter(client([]).client)
		expect(await screen.findByText('Aucun expéditeur bloqué.')).toBeTruthy()
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('sans l’administration, les commandes sont éteintes et le motif est dit', async () => {
		monter(client().client, 'refusee')
		const boutons = await screen.findAllByTestId('debloquer-expediteur')
		expect(boutons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
		expect(screen.getByTestId('motif-lecture-seule')).toBeTruthy()
	})

	it('« Débloquer » ouvre la confirmation courte ; `Échap` la referme et rend le focus', async () => {
		monter(client().client)
		const [premier] = await screen.findAllByTestId('debloquer-expediteur')
		await userEvent.click(premier!)
		const bloc = screen.getByTestId('confirmation-deblocage')
		expect(bloc.textContent).toContain(
			'Débloquer promo@bruit.example ? Ses prochains mails arriveront de nouveau dans l’inbox. Ceux qui sont déjà dans la corbeille y restent.',
		)
		expect(document.activeElement?.textContent).toBe('Annuler')
		expect(screen.getByTestId('confirmer-deblocage').className).not.toContain('bg-danger')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('confirmation-deblocage')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(premier))
	})

	it('confirmer appelle `unblock_sender`, relit la liste et annonce', async () => {
		const { client: c, appels } = client()
		monter(c)
		const [premier] = await screen.findAllByTestId('debloquer-expediteur')
		await userEvent.click(premier!)
		await userEvent.click(screen.getByTestId('confirmer-deblocage'))
		await waitFor(() => expect(screen.getAllByTestId('ligne-expediteur-bloque')).toHaveLength(1))
		expect(appels).toEqual([['unblock_sender', { p_workspace_id: 'ws-1', p_address: 'promo@bruit.example' }]])
		expect(screen.getByTestId('annonce-expediteurs-bloques').textContent).toBe('promo@bruit.example est débloqué.')
	})

	it('le refus de la base se dit dans la confirmation', async () => {
		monter(client(LUS, { data: null, error: { message: 'forbidden' }, status: 403 }).client)
		const [premier] = await screen.findAllByTestId('debloquer-expediteur')
		await userEvent.click(premier!)
		await userEvent.click(screen.getByTestId('confirmer-deblocage'))
		expect((await screen.findByTestId('refus-deblocage')).textContent).toBe(
			'Seul un administrateur de l’espace débloque un expéditeur.',
		)
	})
})
