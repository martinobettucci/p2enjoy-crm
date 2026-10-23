// @verifies CRM-070 (docs/BACKLOG.md) — tranche T4 : la matrice des droits fins d'un membre
// @verifies docs/SPEC-membres.md §3.3 (hérité, membre, lecture, aucun accès ; l'accès effectif rendu par la base et relu
//           après chaque écriture ; un administrateur n'est jamais restreint) ; docs/DESIGN_SYSTEM.md §5.61, §5.27
//
// La base est simulée en mémoire : `acces_effectif_membre` rend la matrice, et l'accès effectif y est DÉCIDÉ PAR LA BASE
// SIMULÉE — l'écran n'a qu'à l'afficher. La règle réelle est prouvée par la suite pgTAP `0088` et par l'API.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClientCrm } from '../lib/supabase'
import { DroitsFins, type MembreDroits } from './DroitsFins'

afterEach(cleanup)

type Reponse = { data: unknown; error: { code?: string; message: string } | null; status: number }
type Pose = 'member' | 'viewer' | 'none'

const MEMBRES: readonly MembreDroits[] = [
	{ idUtilisateur: 'camille', nom: 'Camille Aubert', administrateur: true },
	{ idUtilisateur: 'farida', nom: 'Farida Nowak', administrateur: false },
	{ idUtilisateur: 'driss', nom: 'Driss Lemoine', administrateur: false },
]

const OBJETS = [
	{ objet: 'track', id: 't1', track_id: 't1', nom: 'Conseil & IA' },
	{ objet: 'channel', id: 'c1', track_id: 't1', nom: 'Prospection' },
	{ objet: 'channel', id: 'c2', track_id: 't1', nom: 'Grands comptes' },
] as const

/** L'accès que la base simulée rend : un droit posé l'emporte, sinon le track, sinon la lecture. */
function effectif(poses: Map<string, Pose>, user: string, objet: (typeof OBJETS)[number]): string {
	if (user === 'camille') return 'write'
	const ordre = [poses.get(`${objet.id}:${user}`), objet.objet === 'channel' ? poses.get(`${objet.track_id}:${user}`) : undefined]
	const pose = ordre.find((valeur) => valeur !== undefined)
	return pose === 'member' ? 'write' : pose === 'none' ? 'none' : 'read'
}

function base(options: { refus?: Reponse; lecture?: Reponse } = {}) {
	const poses = new Map<string, Pose>([
		['t1:farida', 'none'],
		['c1:farida', 'member'],
	])
	const lectures: unknown[] = []
	const ecritures: { table: string; operation: string; charge?: unknown; filtres: Record<string, unknown> }[] = []
	const client = {
		rpc(_fonction: string, args: { p_user: string }) {
			lectures.push(args)
			if (options.lecture !== undefined) return Promise.resolve(options.lecture)
			return Promise.resolve({
				data: OBJETS.map((objet) => ({
					...objet,
					archive: false,
					acces_pose: poses.get(`${objet.id}:${args.p_user}`) ?? null,
					acces_effectif: effectif(poses, args.p_user, objet),
					// Le track est lisible par un channel pour chacun : la mention ne vaut que pour un accès « aucun ».
					lisible_par_un_channel: objet.objet === 'track' ? true : null,
				})),
				error: null,
				status: 200,
			})
		},
		from(table: string) {
			const appel: (typeof ecritures)[number] = { table, operation: '', filtres: {} }
			const chaine: Record<string, unknown> = {
				upsert: (charge: { access: Pose; user_id: string; track_id?: string; channel_id?: string }) => {
					appel.operation = 'upsert'
					appel.charge = charge
					return chaine
				},
				delete: () => {
					appel.operation = 'delete'
					return chaine
				},
				eq: (colonne: string, valeur: unknown) => {
					appel.filtres[colonne] = valeur
					return chaine
				},
				select: () => chaine,
				then(ok: (r: Reponse) => unknown) {
					ecritures.push(appel)
					if (options.refus !== undefined) return Promise.resolve(options.refus).then(ok)
					if (appel.operation === 'upsert') {
						const charge = appel.charge as { access: Pose; user_id: string; track_id?: string; channel_id?: string }
						poses.set(`${charge.track_id ?? charge.channel_id}:${charge.user_id}`, charge.access)
					} else {
						poses.delete(`${appel.filtres.track_id ?? appel.filtres.channel_id}:${appel.filtres.user_id}`)
					}
					return Promise.resolve({ data: [{ user_id: 'x' }], error: null, status: 200 }).then(ok)
				},
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, lectures, ecritures }
}

function monter(client: ClientCrm) {
	render(<DroitsFins client={client} idWorkspace="w" membres={MEMBRES} texteRefus={(motif) => `refus:${motif}`} />)
}

const ligne = (nom: string) => screen.getAllByTestId('ligne-droit').find((tr) => within(tr).getByRole('rowheader').textContent?.startsWith(nom))!
const effectifDe = (nom: string) => within(ligne(nom)).getByTestId('acces-effectif').textContent

describe('la matrice des droits fins', () => {
	it('montre d’abord le premier membre qui n’administre pas, le track puis ses channels, et l’accès que rend la base', async () => {
		const { client, lectures } = base()
		monter(client)
		await screen.findByTestId('tableau-droits')
		expect((screen.getByLabelText('Membre') as HTMLSelectElement).value).toBe('farida')
		expect(lectures).toEqual([{ p_ws: 'w', p_user: 'farida' }])
		expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Conseil & IA', 'Grands comptes', 'Prospection'])
		expect((screen.getByLabelText('Droit posé sur Conseil & IA') as HTMLSelectElement).value).toBe('none')
		expect((screen.getByLabelText('Droit posé sur Grands comptes') as HTMLSelectElement).value).toBe('herite')
		expect(effectifDe('Conseil & IA')).toBe('Aucun accèsLisible par l’un de ses channels')
		expect(effectifDe('Prospection')).toBe('Écriture')
		expect(effectifDe('Grands comptes')).toBe('Aucun accès')
	})

	it('poser un droit écrit dans la table de l’objet, annonce, et relit l’accès que la base recalcule', async () => {
		const { client, ecritures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Droit posé sur Grands comptes'), 'viewer')
		expect((await screen.findByTestId('message-droits')).textContent).toBe('Droit de Farida Nowak sur « Grands comptes » : Lecture.')
		expect(ecritures).toEqual([
			{ table: 'channel_members', operation: 'upsert', charge: { channel_id: 'c2', user_id: 'farida', access: 'viewer' }, filtres: {} },
		])
		await waitFor(() => expect(effectifDe('Grands comptes')).toBe('Lecture'))
	})

	it('« Hérité » retire la ligne posée, et l’accès revient à celui du track', async () => {
		const { client, ecritures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Droit posé sur Prospection'), 'herite')
		expect((await screen.findByTestId('message-droits')).textContent).toBe('Droit de Farida Nowak sur « Prospection » : Hérité.')
		expect(ecritures).toEqual([{ table: 'channel_members', operation: 'delete', filtres: { channel_id: 'c1', user_id: 'farida' } }])
		await waitFor(() => expect(effectifDe('Prospection')).toBe('Aucun accès'))
	})

	it('choisir un autre membre relit sa matrice', async () => {
		const { client, lectures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		await screen.findByTestId('tableau-droits')
		await utilisateur.selectOptions(screen.getByLabelText('Membre'), 'driss')
		await waitFor(() => expect(lectures).toEqual([{ p_ws: 'w', p_user: 'farida' }, { p_ws: 'w', p_user: 'driss' }]))
		await waitFor(() => expect(effectifDe('Conseil & IA')).toBe('Lecture'))
	})

	it('un administrateur : la phrase le dit, et chaque droit est éteint', async () => {
		monter(base().client)
		const utilisateur = userEvent.setup()
		await screen.findByTestId('tableau-droits')
		await utilisateur.selectOptions(screen.getByLabelText('Membre'), 'camille')
		expect((await screen.findByTestId('droits-administrateur')).textContent).toContain('n’est jamais restreint')
		await waitFor(() => expect(effectifDe('Conseil & IA')).toBe('Écriture'))
		for (const select of screen.getAllByRole('combobox', { name: /Droit posé sur/ })) expect((select as HTMLSelectElement).disabled).toBe(true)
	})

	it('un refus de la base est traduit sous le tableau', async () => {
		monter(base({ refus: { data: null, error: { code: '42501', message: 'denied' }, status: 403 } }).client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Droit posé sur Grands comptes'), 'member')
		const message = await screen.findByTestId('message-droits')
		expect(message.textContent).toBe('refus:droit')
		expect(message.getAttribute('role')).toBe('alert')
	})

	it('une lecture refusée rend l’erreur avec sa reprise, jamais une matrice vide', async () => {
		monter(base({ lecture: { data: null, error: { code: '42501', message: 'reserve_aux_administrateurs' }, status: 403 } }).client)
		expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy()
		expect(screen.queryByTestId('tableau-droits')).toBeNull()
	})
})
