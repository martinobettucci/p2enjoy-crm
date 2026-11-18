// @verifies CRM-153 (docs/BACKLOG.md) — tranche T3 : le bloc « Commentaires » de la fiche d'une organisation — le fil dans
//           l'ordre croissant, l'état vide, la publication et ses mentions (les membres de l'espace moins soi), la relecture
//           après le geste, les gestes de l'auteur et le seul geste de modération de l'administrateur, le composeur éteint
//           avec le motif quand la base refuse l'édition, et l'ancre `#commentaire-{id}` qui donne le focus au commentaire
// @verifies docs/SPEC-organisations.md §9.2, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.10, §5.44, §5.59
//
// L'écran RÉEL est monté sur un client espion par table, qui sert le fil et note chaque écriture. La pile réelle est
// éprouvée par `e2e/ui/organisation-fiche-commentaires.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { BlocCommentairesOrganisation } from './CommentairesOrganisation'

afterEach(cleanup)

const CAMILLE = 'u-camille'
const DRISS = 'u-driss'

const commentaire = (id: string, auteur: string, nom: string, created_at: string, body = `Corps ${id}`) => ({
	id,
	organization_id: 'org-1',
	author_id: auteur,
	body,
	created_at,
	edited_at: null,
	deleted_at: null,
	deleted_by: null,
	auteur: { id: auteur, full_name: nom, avatar_url: null },
})

const FIL = [
	commentaire('c-2', DRISS, 'Driss Benali', '2026-11-18T10:00:00Z', 'Leur directeur répond vite.'),
	commentaire('c-1', CAMILLE, 'Camille Aubert', '2026-11-18T09:00:00Z', 'Premier contact pris.'),
]

const MEMBRES = [
	{ user_id: CAMILLE, profiles: { id: CAMILLE, full_name: 'Camille Aubert', avatar_url: null } },
	{ user_id: DRISS, profiles: { id: DRISS, full_name: 'Driss Benali', avatar_url: null } },
	{ user_id: 'u-farida', profiles: { id: 'u-farida', full_name: 'Farida Nowak', avatar_url: null } },
]

type Ecriture = { table: string; methode: string; valeur: unknown }

function client(fil: () => readonly unknown[] = () => FIL) {
	const ecritures: Ecriture[] = []
	let lectures = 0
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			let ecrit: Ecriture | null = null
			for (const methode of ['select', 'eq', 'order']) maillon[methode] = () => maillon
			for (const methode of ['insert', 'update']) {
				maillon[methode] = (valeur: unknown) => {
					ecrit = { table, methode, valeur }
					ecritures.push(ecrit)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				if (ecrit !== null) return resoudre({ data: [{ id: 'c-neuf' }], error: null, status: 201 })
				if (table === 'workspace_members') return resoudre({ data: MEMBRES, error: null, status: 200 })
				lectures += 1
				return resoudre({ data: fil(), error: null, status: 200 })
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures, lectures: () => lectures }
}

function monter(c: ClientCrm, options: { idUtilisateur?: string; estAdmin?: boolean; edition?: Capacite; adresse?: string } = {}) {
	return render(
		<MemoryRouter initialEntries={[options.adresse ?? '/contacts/organisations/org-1']}>
			<p id="motif-fiche">Motif</p>
			<BlocCommentairesOrganisation
				client={c}
				idOrganisation="org-1"
				idWorkspace="ws-1"
				idUtilisateur={options.idUtilisateur ?? CAMILLE}
				estAdmin={options.estAdmin ?? false}
				edition={options.edition ?? 'permise'}
				idMotif="motif-fiche"
			/>
		</MemoryRouter>,
	)
}

describe('le fil de commentaires d’une organisation (docs/DESIGN_SYSTEM.md §5.107)', () => {
	it('rend le fil dans l’ordre CROISSANT ; vide, il le dit', async () => {
		monter(client().client)
		const cartes = await screen.findAllByTestId('commentaire')
		expect(cartes.map((c) => c.textContent?.includes('Premier contact pris.'))).toEqual([true, false])
		expect(cartes[0]!.id).toBe('commentaire-c-1')
		cleanup()
		monter(client(() => []).client)
		expect(await screen.findByText(fr['organization.comments.empty'])).toBeTruthy()
	})

	it('publie, mentionne les membres choisis — l’appelant n’est pas proposé —, vide le brouillon et relit le fil', async () => {
		const { client: c, ecritures, lectures } = client()
		monter(c)
		await screen.findAllByTestId('commentaire')
		await userEvent.type(screen.getByTestId('composeur-commentaire-organisation'), 'Relance faite.')
		await userEvent.click(screen.getByRole('button', { name: fr['comments.mentions.toggle'] }))
		expect(await screen.findAllByRole('checkbox')).toHaveLength(2)
		expect(screen.getByRole('checkbox', { name: 'Driss Benali' })).toBeTruthy()
		expect(screen.queryByRole('checkbox', { name: 'Camille Aubert' })).toBeNull()
		await userEvent.click(screen.getByRole('checkbox', { name: 'Farida Nowak' }))
		const avant = lectures()
		await userEvent.click(screen.getByTestId('publier-commentaire-organisation'))
		await waitFor(() => expect(ecritures).toHaveLength(2))
		expect(ecritures[0]).toEqual({ table: 'organization_comments', methode: 'insert', valeur: { organization_id: 'org-1', body: 'Relance faite.' } })
		expect(ecritures[1]).toEqual({
			table: 'organization_comment_mentions',
			methode: 'insert',
			// Sans l'espace : la 0188 n'accorde l'insertion que sur ces deux colonnes, le déclencheur pose l'espace.
			valeur: { comment_id: 'c-neuf', profile_id: 'u-farida' },
		})
		await waitFor(() => expect(lectures()).toBeGreaterThan(avant))
		expect((screen.getByTestId('composeur-commentaire-organisation') as HTMLTextAreaElement).value).toBe('')
	})

	it('l’auteur reçoit « Modifier » et « Supprimer » sur le sien ; l’administrateur, « Supprimer » seul sur celui d’un tiers', async () => {
		monter(client().client, { idUtilisateur: CAMILLE, estAdmin: true })
		const [sien, tiers] = await screen.findAllByTestId('commentaire')
		expect(within(sien!).getByTestId('actions-commentaire').textContent).toContain(fr['comments.action.edit'])
		const moderation = within(tiers!).getByTestId('actions-moderation')
		expect(within(moderation).queryByRole('button', { name: fr['comments.action.edit'] })).toBeNull()
		expect(within(moderation).getByRole('button', { name: fr['comments.action.delete'] })).toBeTruthy()
	})

	it('modifier écrit dans `organization_comments` le seul corps', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		const [sien] = await screen.findAllByTestId('commentaire')
		await userEvent.click(within(sien!).getByRole('button', { name: fr['comments.action.edit'] }))
		const champ = within(sien!).getByRole('textbox')
		await userEvent.type(champ, ' Et relancé.')
		await userEvent.click(within(sien!).getByRole('button', { name: fr['comments.edit.save'] }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({ table: 'organization_comments', methode: 'update', valeur: { body: 'Premier contact pris. Et relancé.' } })
	})

	it('quand la base refuse l’édition, le composeur et les gestes sont rendus éteints, citant le motif de la fiche', async () => {
		monter(client().client, { edition: 'refusee' })
		await screen.findAllByTestId('commentaire')
		const composeur = screen.getByTestId('composeur-commentaire-organisation') as HTMLTextAreaElement
		expect(composeur.disabled).toBe(true)
		expect(composeur.getAttribute('aria-describedby')).toBe('motif-fiche')
		expect((screen.getByTestId('publier-commentaire-organisation') as HTMLButtonElement).disabled).toBe(true)
		expect((screen.getByRole('button', { name: fr['comments.mentions.toggle'] }) as HTMLButtonElement).disabled).toBe(true)
	})

	it('l’ancre `#commentaire-{id}` d’une notification donne le focus au commentaire visé', async () => {
		monter(client().client, { adresse: '/contacts/organisations/org-1#commentaire-c-2' })
		const cartes = await screen.findAllByTestId('commentaire')
		await waitFor(() => expect(document.activeElement).toBe(cartes[1]))
	})
})
