// @verifies CRM-067 (docs/BACKLOG.md) — tranche T2 : le bloc « Activités » de la fiche, monté pour de vrai
// @verifies docs/SPEC-activites.md §4 (la liste, le formulaire, corriger et retirer selon les droits), §5 (états et
//           refus traduits) ; docs/DESIGN_SYSTEM.md §5.63 (ce bloc), §5.10 (pierre tombale, modération), §5.13 (focus
//           entrant puis rendu), §5.59 (commandes éteintes, lisibles, citant le motif), §5.8 (états)
//
// Les noms sont ceux du seed — Driss Benali business developer, Camille Aubert administratrice, Léo Marchand contact —
// pour que ces preuves se lisent comme la preuve de bout en bout qui exerce la pile réelle (tranche T3).

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlocActivitesCard } from './BlocActivitesCard'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n'
import type { ActiviteLue } from '../lib/activites'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const DRISS = '5eed0000-0000-4000-8000-000000000012'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const LEO = '5eed0000-0000-4000-8000-000000000092'

function activite(partiel: Partial<ActiviteLue> & { id: string }): ActiviteLue {
	return {
		card_id: 'card-1',
		type: 'call',
		occurred_at: '2026-10-20T09:00:00+00:00',
		duration_minutes: 30,
		subject: 'Appel de découverte',
		body: null,
		author_id: DRISS,
		created_at: '2026-10-20T10:00:00+00:00',
		edited_at: null,
		deleted_at: null,
		deleted_by: null,
		auteur: { id: DRISS, full_name: 'Driss Benali', avatar_url: null },
		participants: [],
		...partiel,
	}
}

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }
type Ecriture = { readonly table: string; readonly geste: string; readonly charge?: unknown; readonly filtres: string[] }

/**
 * Un client qui distingue les tables et note les écritures. `activites` peut être une suite : la n-ième lecture rend le
 * n-ième jeu (le dernier se répète), pour prouver qu'un geste RELIT la liste.
 */
function clientDouble({
	activites = [[]] as readonly (readonly ActiviteLue[])[],
	lecture = null as Reponse | null,
	insertion = { data: { id: 'neuve' }, status: 201 } as Reponse,
	miseAJour = { data: [{ id: 'x' }] } as Reponse,
	participant = (() => ({ status: 201 })) as (charge: Record<string, string>) => Reponse,
} = {}) {
	const ecritures: Ecriture[] = []
	let lectures = 0
	const reponse = (r: Reponse) => ({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 })
	const chaine = (fin: () => Reponse, filtres: string[] = []) => {
		const objet: Record<string, unknown> = {
			eq: (colonne: string, valeur: string) => {
				filtres.push(`${colonne}=${valeur}`)
				return objet
			},
			order: () => objet,
			select: () => objet,
			single: () => objet,
			then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse(fin())).then(resoudre),
		}
		return objet
	}
	const client = {
		from: (table: string) => ({
			select: () => {
				if (table === 'card_activities') {
					return chaine(() => {
						lectures += 1
						if (lecture !== null) return lecture
						return { data: activites[Math.min(lectures, activites.length) - 1] }
					})
				}
				if (table === 'card_contacts') {
					return chaine(() => ({
						data: [
							{
								contact_id: LEO,
								role: null,
								contacts: { id: LEO, full_name: 'Léo Marchand', organization_id: null, organizations: null },
							},
						],
					}))
				}
				if (table === 'workspace_members') {
					return chaine(() => ({
						data: [
							{ user_id: CAMILLE, role: 'admin', created_at: '2026-01-01', profiles: { full_name: 'Camille Aubert' } },
							{ user_id: DRISS, role: 'business_developer', created_at: '2026-01-01', profiles: { full_name: 'Driss Benali' } },
						],
					}))
				}
				return chaine(() => ({ data: [] }))
			},
			insert: (charge: Record<string, string>) => {
				ecritures.push({ table, geste: 'insert', charge, filtres: [] })
				return chaine(() => (table === 'card_activity_participants' ? participant(charge) : insertion))
			},
			update: (charge: unknown) => {
				const ecriture: Ecriture = { table, geste: 'update', charge, filtres: [] }
				ecritures.push(ecriture)
				return chaine(() => miseAJour, ecriture.filtres)
			},
			delete: () => {
				const ecriture: Ecriture = { table, geste: 'delete', filtres: [] }
				ecritures.push(ecriture)
				return chaine(() => ({ data: [{ activity_id: 'x' }] }), ecriture.filtres)
			},
		}),
	} as unknown as ClientCrm
	return { client, ecritures, lectures: () => lectures }
}

function monter(
	options: Parameters<typeof clientDouble>[0] = {},
	{ idUtilisateur = DRISS, estAdminWorkspace = false, refus = false } = {},
) {
	const double = clientDouble(options)
	const onChange = vi.fn()
	const bloc = (
		<BlocActivitesCard
			client={double.client}
			idCard="card-1"
			idWorkspace="ws-1"
			idUtilisateur={idUtilisateur}
			estAdminWorkspace={estAdminWorkspace}
			onChange={onChange}
		/>
	)
	render(
		refus ? (
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif-fiche' }}>{bloc}</FournisseurRefus>
		) : (
			bloc
		),
	)
	return { ...double, onChange }
}

describe('la liste (docs/DESIGN_SYSTEM.md §5.63)', () => {
	it('rend la plus récente EN TÊTE, avec le type en mot, la durée, l’auteur, les participants et le compte rendu replié', async () => {
		monter({
			activites: [
				[
					activite({ id: 'a1', occurred_at: '2026-10-19T09:00:00+00:00', subject: 'Plus ancienne' }),
					activite({
						id: 'a2',
						type: 'meeting',
						subject: 'Réunion de cadrage',
						duration_minutes: 45,
						body: 'Points :\n- budget',
						participants: [{ contact_id: LEO, profile_id: null, contact: { full_name: 'Léo Marchand' }, profil: null }],
					}),
				],
			],
		})
		const lignes = within(await screen.findByTestId('liste-activites')).getAllByTestId('ligne-activite')
		expect(lignes.map((l) => within(l).getByTestId('sujet-activite').textContent)).toEqual([
			'Réunion de cadrage',
			'Plus ancienne',
		])
		const premiere = lignes[0] as HTMLElement
		expect(within(premiere).getByTestId('type-activite').textContent).toBe(fr['activities.type.meeting'])
		expect(premiere.textContent).toContain('45 min')
		expect(premiere.textContent).toContain('par Driss Benali')
		expect(within(premiere).getByTestId('participants-activite').textContent).toBe('Avec Léo Marchand')
		const compteRendu = within(premiere).getByTestId('compte-rendu-activite')
		expect(compteRendu.closest('details')?.open).toBe(false)
		expect(compteRendu.textContent).toBe('Points :\n- budget')
		// Une activité sans participant ni compte rendu ne rend RIEN à leur place (§5.9).
		expect(within(lignes[1] as HTMLElement).queryByTestId('participants-activite')).toBeNull()
		expect((lignes[1] as HTMLElement).querySelector('details')).toBeNull()
	})

	it('l’état vide garde la commande ; l’erreur offre une reprise qui relit réellement', async () => {
		const { lectures } = monter({ lecture: { error: { message: 'boum' }, status: 500 } })
		await screen.findByTestId('erreur-activites')
		expect(screen.getByTestId('consigner-activite')).toBeTruthy()
		const avant = lectures()
		await userEvent.click(screen.getByRole('button', { name: fr['activities.error.retry'] }))
		await waitFor(() => expect(lectures()).toBe(avant + 1))
	})

	it('l’état vide dit qu’aucune activité n’est consignée', async () => {
		monter()
		expect((await screen.findByTestId('activites-vide')).textContent).toBe(fr['activities.empty'])
	})
})

describe('les commandes suivent la règle de la base (docs/SPEC-activites.md §3, docs/DESIGN_SYSTEM.md §5.10)', () => {
	it('l’auteur reçoit « Corriger » et « Retirer »', async () => {
		monter({ activites: [[activite({ id: 'a1' })]] })
		const actions = await screen.findByTestId('actions-activite')
		expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
			fr['activities.action.edit'],
			fr['activities.action.retire'],
		])
	})

	it('un administrateur NON auteur ne reçoit que « Retirer » ; un autre membre, rien', async () => {
		monter({ activites: [[activite({ id: 'a1' })]] }, { idUtilisateur: CAMILLE, estAdminWorkspace: true })
		const actions = await screen.findByTestId('actions-activite')
		expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([fr['activities.action.retire']])
		cleanup()
		monter({ activites: [[activite({ id: 'a1' })]] }, { idUtilisateur: CAMILLE, estAdminWorkspace: false })
		await screen.findByTestId('ligne-activite')
		expect(screen.queryByTestId('actions-activite')).toBeNull()
	})

	it('une pierre tombale tient sa place, sans commande ; la modération est nommée sans nommer le modérateur', async () => {
		monter({
			activites: [
				[
					activite({ id: 'a1', subject: '', deleted_at: '2026-10-21T00:00:00+00:00', deleted_by: DRISS }),
					activite({
						id: 'a2',
						occurred_at: '2026-10-18T09:00:00+00:00',
						subject: '',
						deleted_at: '2026-10-21T00:00:00+00:00',
						deleted_by: CAMILLE,
					}),
				],
			],
		})
		const retirees = await screen.findAllByTestId('activite-retiree')
		expect(retirees.map((p) => p.textContent)).toEqual([fr['activities.retired'], fr['activities.retired.moderation']])
		expect(screen.queryByTestId('actions-activite')).toBeNull()
		expect(document.body.textContent).not.toContain('Camille')
	})

	it('sous le refus de la fiche, les commandes sont MONTÉES, désactivées, et citent le motif (§5.59)', async () => {
		monter({ activites: [[activite({ id: 'a1' })]] }, { refus: true })
		const consigner = await screen.findByTestId('consigner-activite')
		expect((consigner as HTMLButtonElement).disabled).toBe(true)
		expect(consigner.getAttribute('aria-describedby')).toBe('motif-fiche')
		for (const bouton of within(await screen.findByTestId('actions-activite')).getAllByRole('button')) {
			expect((bouton as HTMLButtonElement).disabled).toBe(true)
			expect(bouton.getAttribute('aria-describedby')).toBe('motif-fiche')
		}
	})
})

describe('consigner (docs/DESIGN_SYSTEM.md §5.63, §5.13)', () => {
	it('au clavier : le focus entre dans le formulaire, la commande s’efface, puis revient avec l’annonce et la relecture', async () => {
		const { ecritures, onChange, lectures } = monter({
			activites: [[], [activite({ id: 'neuve', subject: 'Visio de démonstration', type: 'visio' })]],
		})
		await screen.findByTestId('activites-vide')
		await userEvent.click(screen.getByTestId('consigner-activite'))
		const formulaire = screen.getByTestId('formulaire-activite')
		expect(screen.queryByTestId('consigner-activite')).toBeNull()
		expect(document.activeElement).toBe(within(formulaire).getByRole('radio', { name: fr['activities.type.call'] }))

		const envoyer = within(formulaire).getByTestId('envoyer-activite') as HTMLButtonElement
		expect(envoyer.disabled).toBe(true)
		await userEvent.click(within(formulaire).getByRole('radio', { name: fr['activities.type.visio'] }))
		await userEvent.type(within(formulaire).getByLabelText(fr['activities.form.subject']), 'Visio de démonstration')
		await userEvent.type(within(formulaire).getByLabelText(fr['activities.form.duration']), '50')
		// Les participants sont lus à la première ouverture : contacts de l'affaire et membres de l'espace.
		await userEvent.click(await within(formulaire).findByRole('checkbox', { name: 'Léo Marchand' }))
		await userEvent.click(within(formulaire).getByRole('checkbox', { name: 'Camille Aubert' }))
		const avant = lectures()
		await userEvent.click(envoyer)

		await waitFor(() => expect(screen.queryByTestId('formulaire-activite')).toBeNull())
		expect(ecritures[0]).toMatchObject({
			table: 'card_activities',
			geste: 'insert',
			charge: { card_id: 'card-1', type: 'visio', duration_minutes: 50, subject: 'Visio de démonstration', body: null },
		})
		expect(ecritures[0]?.charge).not.toHaveProperty('author_id')
		expect(ecritures[0]?.charge).not.toHaveProperty('workspace_id')
		expect(ecritures.slice(1).map((e) => e.charge)).toEqual([
			{ activity_id: 'neuve', contact_id: LEO },
			{ activity_id: 'neuve', profile_id: CAMILLE },
		])
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('consigner-activite')))
		expect(screen.getByRole('status', { name: fr['activities.live.aria'] }).textContent).toBe(
			fr['activities.live.created'],
		)
		await waitFor(() => expect(lectures()).toBe(avant + 1))
		expect(await screen.findByText('Visio de démonstration')).toBeTruthy()
		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it('un refus reste DANS le formulaire, la saisie conservée ; rien n’est relu, le fil n’est pas prévenu', async () => {
		const { onChange } = monter({ insertion: { error: { code: '23514', message: 'activity_in_future' }, status: 400 } })
		await screen.findByTestId('activites-vide')
		await userEvent.click(screen.getByTestId('consigner-activite'))
		const sujet = screen.getByLabelText(fr['activities.form.subject'])
		await userEvent.type(sujet, 'Demain')
		await userEvent.click(screen.getByTestId('envoyer-activite'))
		expect((await screen.findByTestId('refus-activite')).textContent).toBe(fr['activities.refus.future'])
		expect((sujet as HTMLInputElement).value).toBe('Demain')
		expect(onChange).not.toHaveBeenCalled()
	})

	it('une durée qui n’est pas un entier est refusée AVANT tout envoi', async () => {
		const { ecritures } = monter()
		await screen.findByTestId('activites-vide')
		await userEvent.click(screen.getByTestId('consigner-activite'))
		await userEvent.type(screen.getByLabelText(fr['activities.form.subject']), 'Appel')
		const duree = screen.getByLabelText(fr['activities.form.duration']) as HTMLInputElement
		// `type="number"` refuse la virgule à la frappe dans un navigateur ; le test pose une valeur décimale.
		await userEvent.type(duree, '1.5')
		await userEvent.click(screen.getByTestId('envoyer-activite'))
		expect((await screen.findByTestId('refus-activite')).textContent).toBe(fr['activities.refus.duree'])
		expect(ecritures).toEqual([])
	})

	it('`Échap` referme et rend le focus à la commande', async () => {
		monter()
		await screen.findByTestId('activites-vide')
		await userEvent.click(screen.getByTestId('consigner-activite'))
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('formulaire-activite')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('consigner-activite')))
	})

	it('un participant refusé n’annule pas l’activité : le bloc dit combien, et pourquoi', async () => {
		monter({
			participant: (charge) =>
				charge['contact_id'] === LEO
					? { error: { code: '23514', message: 'participant_outside_card' }, status: 400 }
					: { status: 201 },
		})
		await screen.findByTestId('activites-vide')
		await userEvent.click(screen.getByTestId('consigner-activite'))
		await userEvent.type(screen.getByLabelText(fr['activities.form.subject']), 'Appel')
		await userEvent.click(await screen.findByRole('checkbox', { name: 'Léo Marchand' }))
		await userEvent.click(screen.getByTestId('envoyer-activite'))
		const message = await screen.findByTestId('message-activites')
		expect(message.textContent).toBe(
			`${fr['activities.participants.partial.one']} ${fr['activities.refus.participant']}`,
		)
		expect(screen.getByRole('status', { name: fr['activities.live.aria'] }).textContent).toBe(
			fr['activities.live.created'],
		)
	})
})

describe('corriger et retirer', () => {
	it('« Corriger » ouvre le formulaire prérempli À LA PLACE de la ligne, et « sans effet » se dit sous la liste', async () => {
		monter({
			activites: [[activite({ id: 'a1', subject: 'Appel initial' })]],
			miseAJour: { data: [] },
		})
		await userEvent.click(await screen.findByRole('button', { name: /Corriger l’activité/ }))
		const formulaire = screen.getByTestId('formulaire-activite')
		expect((within(formulaire).getByLabelText(fr['activities.form.subject']) as HTMLInputElement).value).toBe('Appel initial')
		expect(screen.queryByTestId('sujet-activite')).toBeNull()
		await userEvent.click(within(formulaire).getByTestId('envoyer-activite'))
		expect((await screen.findByTestId('message-activites')).textContent).toBe(fr['activities.refus.sans-effet'])
		expect(screen.queryByTestId('formulaire-activite')).toBeNull()
	})

	it('une correction qui ne touche pas la date renvoie l’instant EXACT que la base porte', async () => {
		const { ecritures } = monter({
			activites: [[activite({ id: 'a1', occurred_at: '2026-10-20T09:00:37.123+00:00' })]],
		})
		await userEvent.click(await screen.findByRole('button', { name: /Corriger l’activité/ }))
		await userEvent.click(screen.getByTestId('envoyer-activite'))
		await waitFor(() => expect(ecritures[0]?.geste).toBe('update'))
		expect(ecritures[0]?.charge).toMatchObject({ occurred_at: '2026-10-20T09:00:37.123+00:00' })
	})

	it('« Retirer » demande confirmation sur la ligne, focus sur le bouton destructif ; confirmer n’envoie que la date', async () => {
		const { ecritures, onChange } = monter({ activites: [[activite({ id: 'a1' })]] })
		await userEvent.click(await screen.findByRole('button', { name: /Retirer l’activité/ }))
		const confirmation = screen.getByTestId('confirmation-retrait-activite')
		expect(confirmation.textContent).toContain(fr['activities.retire.body'])
		const confirmer = within(confirmation).getByTestId('confirmer-retrait-activite')
		expect(document.activeElement).toBe(confirmer)
		await userEvent.click(confirmer)
		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(ecritures).toHaveLength(1)
		expect(Object.keys(ecritures[0]?.charge as object)).toEqual(['deleted_at'])
		expect(ecritures[0]?.filtres).toContain('id=a1')
		expect(screen.getByRole('status', { name: fr['activities.live.aria'] }).textContent).toBe(
			fr['activities.live.retired'],
		)
	})

	it('le texte du modérateur est distinct : il nomme l’auteur et dit que le retrait sera à son nom', async () => {
		monter({ activites: [[activite({ id: 'a1' })]] }, { idUtilisateur: CAMILLE, estAdminWorkspace: true })
		await userEvent.click(await screen.findByRole('button', { name: /Retirer l’activité/ }))
		expect(screen.getByTestId('confirmation-retrait-activite').textContent).toContain(
			fr['activities.retire.body.moderation'].replace('{nom}', 'Driss Benali'),
		)
	})

	it('annuler le retrait rend le focus à « Retirer »', async () => {
		monter({ activites: [[activite({ id: 'a1' })]] })
		await userEvent.click(await screen.findByRole('button', { name: /Retirer l’activité/ }))
		await userEvent.click(screen.getByRole('button', { name: fr['activities.retire.cancel'] }))
		await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Retirer l’activité/))
	})
})
