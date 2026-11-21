// @verifies CRM-156 (docs/BACKLOG.md) — tranche T3 : la rangée et la barre d'actions groupées — « Tout sélectionner » sous
//           un filtre explicite seulement, le compte lu en base, l'option refusée par la capacité d'éditer, la confirmation
//           qui dit les nombres et n'agit qu'au bouton, la suppression sans la case d'une heure, la progression, le compte
//           rendu des faits et des refus, l'interruption, la corbeille et « Restaurer »
// @verifies docs/DESIGN_SYSTEM.md §5.109 ; docs/SPEC-mail-subsystem.md §32.3 à §32.6 ; docs/JOURNAL.md décisions 946 et 949
// @verifies CRM-156 tranche T4 : « Transférer à un membre » et son `select` (la personne exceptée, l'argument envoyé) ;
//           « Bloquer l'expéditeur » rendu sous le seul filtre expéditeur et l'administration consentie, sa double
//           confirmation et son bilan ; « Créer des contacts », la liste à vérifier et le compte rendu de l'import ; la
//           ligne du filtre par expéditeur — docs/DESIGN_SYSTEM.md §5.109 bis ; docs/SPEC-mail-subsystem.md §32.7 à §32.10

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCrm } from '../lib/supabase'
import type { PorteeGroupee } from '../lib/actions-groupees'

const injecte = vi.hoisted(() => ({
	rpc: null as null | ((fonction: string, corps: unknown) => Promise<unknown>),
}))

/** Les membres de l'espace, tels que `workspace_members` les rend avec leur profil. */
const MEMBRES = [
	{ user_id: 'moi', profiles: { id: 'moi', full_name: 'Camille Admin' } },
	{ user_id: 'u2', profiles: { id: 'u2', full_name: 'Driss Bizdev' } },
]

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return injecte.rpc === null
			? null
			: ({
					rpc: injecte.rpc,
					from: () => ({ select: () => ({ eq: async () => ({ data: MEMBRES, error: null, status: 200 }) }) }),
				} as unknown as ClientCrm)
	},
}))

const { ActionsGroupees, FiltreExpediteur } = await import('./ActionsGroupeesInbox')

afterEach(() => {
	cleanup()
	injecte.rpc = null
})

const PORTEE: PorteeGroupee = {
	idWorkspace: 'w',
	dossier: { genre: 'non-classes' },
	seulementMoi: false,
	pastilles: ['p1'],
	expediteur: null,
	sommeilVisible: false,
	fils: [{ workspaceId: 'w', cleFil: '<a@x>' }],
}

/** La base : `inbox_bulk_count` rend 2 fils / 5 messages ; `inbox_bulk_apply` rend les paquets donnés. */
function base(paquets: readonly unknown[], appels: [string, unknown][] = []) {
	let rang = 0
	injecte.rpc = async (fonction, corps) => {
		appels.push([fonction, corps])
		if (fonction === 'inbox_bulk_count') return { data: [{ thread_count: 2, message_count: 5 }], error: null, status: 200 }
		const paquet = paquets[Math.min(rang, paquets.length - 1)]
		rang += 1
		return paquet
	}
}

function monter(proprietes: Partial<Parameters<typeof ActionsGroupees>[0]> = {}) {
	const onTermine = vi.fn()
	render(
		<ActionsGroupees
			nonLusAffiches={[]}
			onToutMarquer={vi.fn()}
			filtreExplicite={true}
			selection={{ genre: 'fils', nombre: 2 }}
			onToutSelectionner={vi.fn()}
			onDeselectionner={vi.fn()}
			portee={PORTEE}
			dansUneAffaire={false}
			edition="permise"
			catalogue={new Map()}
			idEspace="w"
			ancre={{ messageId: 'm1', expediteur: 'a@x.fr' }}
			retention={30}
			onTermine={onTermine}
			{...proprietes}
		/>,
	)
	return { onTermine }
}

describe('la rangée d’action (§5.109)', () => {
	it('« Tout sélectionner » n’existe que sous un filtre explicite', () => {
		monter({ selection: { genre: 'aucune' }, filtreExplicite: false, nonLusAffiches: ['m'] })
		expect(screen.queryByTestId('inbox-tout-selectionner')).toBeNull()
		expect(screen.getByTestId('inbox-tout-marquer-lu')).toBeTruthy()
		cleanup()
		const onToutSelectionner = vi.fn()
		monter({ selection: { genre: 'aucune' }, onToutSelectionner })
		expect(screen.getByTestId('inbox-tout-selectionner')).toBeTruthy()
	})

	it('sans filtre, sans non-lu ni sélection, la rangée n’est pas rendue', () => {
		monter({ selection: { genre: 'aucune' }, filtreExplicite: false })
		expect(screen.queryByTestId('inbox-rangee-action')).toBeNull()
	})

	it('« tout le filtre » dit son nombre lu en base, jamais un compte de la page', async () => {
		base([])
		monter({ selection: { genre: 'tout' }, portee: { ...PORTEE, fils: null } })
		await waitFor(() => expect(screen.getByTestId('inbox-selection-compte').textContent).toBe('Tout le filtre : 2 fils (5 messages)'))
	})

	it('une action refusée par la capacité d’éditer reste une option, désactivée, avec son mot', () => {
		monter({ edition: 'refusee' })
		const option = screen.getByRole('option', { name: 'Poser une pastille — non permis' }) as HTMLOptionElement
		expect(option.disabled).toBe(true)
		expect((screen.getByRole('option', { name: 'Marquer comme lu' }) as HTMLOptionElement).disabled).toBe(false)
	})

	it('« Retirer de l’affaire » n’est offert que dans le dossier d’une affaire', () => {
		monter()
		expect(screen.queryByRole('option', { name: 'Retirer de l’affaire' })).toBeNull()
		cleanup()
		monter({ dansUneAffaire: true })
		expect(screen.getByRole('option', { name: 'Retirer de l’affaire' })).toBeTruthy()
	})
})

describe('la confirmation et le compte rendu (§5.109, décision 946)', () => {
	it('choisir n’ouvre rien ; « Continuer » ouvre la confirmation, qui dit les nombres et n’agit qu’au bouton', async () => {
		const appels: [string, unknown][] = []
		base([{ data: { threads: 2, messages: 5, done: 5, refused: {}, next: null }, error: null, status: 200 }], appels)
		const { onTermine } = monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'mark_read')
		expect(screen.queryByTestId('inbox-confirmation-groupee')).toBeNull()
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const bloc = await screen.findByTestId('inbox-confirmation-groupee')
		await waitFor(() => expect(within(bloc).getByText('Marquer comme lus 2 fils (5 messages) ?')).toBeTruthy())
		expect(appels.some(([f]) => f === 'inbox_bulk_apply')).toBe(false)
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const compteRendu = await screen.findByTestId('inbox-compte-rendu')
		expect(within(compteRendu).getByTestId('inbox-compte-rendu-fait').textContent).toBe('Fait : 5 messages.')
		expect(onTermine).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Marquer comme lu'))
	})

	it('la suppression est destructive, rappelle sa conséquence, et ne porte pas la case « Ne plus demander »', async () => {
		base([])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'delete_everywhere')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const bloc = await screen.findByTestId('inbox-confirmation-groupee')
		expect(within(bloc).getByText(/pendant 30 jours, et dans la corbeille de la boîte mail/)).toBeTruthy()
		expect(within(bloc).queryByRole('checkbox')).toBeNull()
		expect(screen.getByTestId('inbox-groupe-confirmer').className).toContain('bg-danger')
	})

	it('`Échap` referme la confirmation et rend le focus au `select`', async () => {
		base([])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'wake')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await screen.findByTestId('inbox-confirmation-groupee')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-confirmation-groupee')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('inbox-action-groupee'))
	})

	it('le compte rendu nomme chaque refus et son nombre, par le dictionnaire', async () => {
		base([
			{
				data: { threads: 2, messages: 5, done: 3, refused: { forbidden: 1, outbound_message: 1 }, next: null },
				error: null,
				status: 200,
			},
		])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'reevaluate')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const refus = await screen.findByTestId('inbox-compte-rendu-refus')
		expect(refus.textContent).toContain('1 — vous n’avez pas le droit de faire ce geste sur ces messages')
		expect(refus.textContent).toContain('1 — messages envoyés : ils ne sont pas évalués')
		expect(screen.getByTestId('inbox-compte-rendu').getAttribute('role')).toBe('status')
	})

	it('un paquet en échec passe le compte rendu en alerte, qui dit ce qui a été traité avant l’arrêt', async () => {
		base([
			{ data: { threads: 2, messages: 3, done: 3, refused: {}, next: 'x' }, error: null, status: 200 },
			{ data: null, error: { message: 'panne' }, status: 500 },
		])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'mark_unread')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const bloc = await screen.findByTestId('inbox-compte-rendu')
		expect(bloc.getAttribute('role')).toBe('alert')
		expect(bloc.textContent).toContain('Action interrompue : 3 messages traités avant l’arrêt')
	})

	it('le sommeil n’agit pas tant qu’aucune échéance n’est choisie ; une échéance usuelle la choisit sans confirmer', async () => {
		const appels: [string, unknown][] = []
		base([{ data: { threads: 2, messages: 5, done: 2, refused: {}, next: null }, error: null, status: 200 }], appels)
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'snooze')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await screen.findByTestId('inbox-confirmation-groupee')
		await waitFor(() => expect(screen.getByText('Mettre en sommeil 2 fils (5 messages) ?')).toBeTruthy())
		expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.click(screen.getByRole('button', { name: 'Demain' }))
		expect(appels.some(([f]) => f === 'inbox_bulk_apply')).toBe(false)
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-fait')).textContent).toBe('Fait : 2 fils.')
	})
})

describe('la corbeille (§5.109)', () => {
	it('une sélection de messages, « Restaurer » direct, et aucun `select`', async () => {
		base([{ data: { threads: 1, messages: 2, done: 2, refused: {}, next: null }, error: null, status: 200 }])
		monter({
			dansLaCorbeille: true,
			filtreExplicite: false,
			selection: { genre: 'fils', nombre: 2 },
			portee: { ...PORTEE, dossier: { genre: 'corbeille' }, fils: null, messages: ['m1', 'm2'] },
		})
		expect(screen.getByTestId('inbox-selection-compte').textContent).toBe('2 messages sélectionnés')
		expect(screen.queryByTestId('inbox-action-groupee')).toBeNull()
		await userEvent.click(screen.getByTestId('inbox-corbeille-restaurer-selection'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		expect(screen.getByTestId('inbox-groupe-confirmer').className).not.toContain('bg-danger')
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-fait')).textContent).toBe('Fait : 2 messages.')
	})
})

describe('le transfert groupé (§5.109 bis, §32.7)', () => {
	it('le `select` « Membre » excepte la personne ; l’action envoie `recipient_id` et compte les faits', async () => {
		const appels: [string, unknown][] = []
		base([{ data: { threads: 2, messages: 5, done: 5, refused: {}, next: null }, error: null, status: 200 }], appels)
		monter({ idMoi: 'moi' })
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'transfer')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const membre = (await screen.findByTestId('inbox-transfert-membre')) as HTMLSelectElement
		await waitFor(() => expect(membre.disabled).toBe(false))
		expect([...membre.options].map((option) => option.textContent)).toEqual(['Choisir un membre', 'Driss Bizdev'])
		await waitFor(() => expect(document.activeElement).toBe(membre))
		expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.selectOptions(membre, 'u2')
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-fait')).textContent).toBe('Fait : 5 messages.')
		const appel = appels.find(([f]) => f === 'inbox_bulk_apply')?.[1] as { p_action: string; p_argument: unknown }
		expect(appel.p_action).toBe('transfer')
		expect(appel.p_argument).toEqual({ recipient_id: 'u2' })
	})

	it('refusée par la capacité d’éditer, l’option porte « — non permis »', () => {
		monter({ edition: 'refusee' })
		expect(
			(screen.getByRole('option', { name: 'Transférer à un membre — non permis' }) as HTMLOptionElement).disabled,
		).toBe(true)
		expect((screen.getByRole('option', { name: 'Créer des contacts — non permis' }) as HTMLOptionElement).disabled).toBe(true)
	})

	it('les refus propres au transfert se nomment dans le compte rendu', async () => {
		base([{ data: { threads: 1, messages: 2, done: 1, refused: { self_transfer: 1 }, next: null }, error: null, status: 200 }])
		monter({ idMoi: 'moi' })
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'transfer')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const membre = (await screen.findByTestId('inbox-transfert-membre')) as HTMLSelectElement
		await waitFor(() => expect(membre.disabled).toBe(false))
		await userEvent.selectOptions(membre, 'u2')
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-refus')).textContent).toContain(
			'1 — un message ne se transfère pas à soi-même',
		)
	})
})

describe('bloquer l’expéditeur (§5.109 bis, §32.8)', () => {
	const SOUS_EXPEDITEUR: PorteeGroupee = { ...PORTEE, pastilles: [], expediteur: 'spam@exemple.test' }

	it('n’est rendue que sous le SEUL filtre expéditeur, et quand la base consent l’administration', () => {
		monter({ selection: { genre: 'aucune' }, portee: SOUS_EXPEDITEUR, administration: 'permise' })
		expect(screen.getByTestId('inbox-bloquer-expediteur')).toBeTruthy()
		cleanup()
		monter({ selection: { genre: 'aucune' }, portee: SOUS_EXPEDITEUR, administration: 'refusee' })
		expect(screen.queryByTestId('inbox-bloquer-expediteur')).toBeNull()
		cleanup()
		monter({ selection: { genre: 'aucune' }, portee: { ...SOUS_EXPEDITEUR, pastilles: ['p1'] }, administration: 'permise' })
		expect(screen.queryByTestId('inbox-bloquer-expediteur')).toBeNull()
		cleanup()
		monter({ selection: { genre: 'aucune' }, portee: { ...SOUS_EXPEDITEUR, seulementMoi: true }, administration: 'permise' })
		expect(screen.queryByTestId('inbox-bloquer-expediteur')).toBeNull()
	})

	it('deux confirmations : l’effet lu en base, puis le bouton destructif ; le bilan part au parent', async () => {
		const appels: [string, unknown][] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			if (fonction === 'blocked_sender_impact') return { data: 3, error: null, status: 200 }
			return { data: { address: 'spam@exemple.test', trashed: 3, refused: 0 }, error: null, status: 200 }
		}
		const onBloque = vi.fn()
		monter({ selection: { genre: 'aucune' }, portee: SOUS_EXPEDITEUR, administration: 'permise', onBloque })
		await userEvent.click(screen.getByTestId('inbox-bloquer-expediteur'))
		const bloc = await screen.findByTestId('inbox-blocage')
		expect(within(bloc).getByText('Bloquer spam@exemple.test ?')).toBeTruthy()
		expect((await screen.findByTestId('inbox-blocage-impact')).textContent).toContain(
			'3 mails reçus de cette adresse iront à la corbeille de l’inbox',
		)
		expect(document.activeElement?.textContent).toBe('Annuler')
		await userEvent.click(screen.getByTestId('inbox-blocage-continuer'))
		expect(within(bloc).getByText('Confirmez le blocage de spam@exemple.test.')).toBeTruthy()
		expect(document.activeElement?.textContent).toBe('Annuler')
		expect(appels.some(([f]) => f === 'block_sender')).toBe(false)
		const confirmer = screen.getByTestId('inbox-blocage-confirmer')
		expect(confirmer.className).toContain('bg-danger')
		expect(confirmer.textContent).toBe('Bloquer spam@exemple.test')
		await userEvent.click(confirmer)
		await waitFor(() => expect(onBloque).toHaveBeenCalledWith('spam@exemple.test', 3))
		expect(appels.find(([f]) => f === 'block_sender')?.[1]).toEqual({ p_workspace_id: 'w', p_address: 'spam@exemple.test' })
	})

	it('le refus de la base se dit sous le bloc, sans rien fermer', async () => {
		injecte.rpc = async (fonction) =>
			fonction === 'blocked_sender_impact'
				? { data: 0, error: null, status: 200 }
				: { data: null, error: { message: 'forbidden' }, status: 403 }
		monter({ selection: { genre: 'aucune' }, portee: SOUS_EXPEDITEUR, administration: 'permise' })
		await userEvent.click(screen.getByTestId('inbox-bloquer-expediteur'))
		await waitFor(() => expect((screen.getByTestId('inbox-blocage-continuer') as HTMLButtonElement).disabled).toBe(false))
		expect(screen.getByTestId('inbox-blocage-impact').textContent).toContain('Aucun mail reçu')
		await userEvent.click(screen.getByTestId('inbox-blocage-continuer'))
		await userEvent.click(screen.getByTestId('inbox-blocage-confirmer'))
		expect((await screen.findByTestId('inbox-blocage-refus')).textContent).toBe(
			'Seul un administrateur de l’espace bloque un expéditeur.',
		)
		expect(screen.getByTestId('inbox-blocage')).toBeTruthy()
	})
})

describe('créer des contacts (§5.109 bis, §32.10)', () => {
	const INCONNUS = [
		{ workspace_id: 'w', address: 'nora@lumen.example', suggested_name: 'Nora', suggested_organization_name: 'Lumen', message_count: 2 },
		{ workspace_id: 'w', address: 'yan@autre.example', suggested_name: 'Yan', suggested_organization_name: null, message_count: 1 },
	]

	it('la liste à vérifier : cochées, préremplies ; on décoche, on corrige, on crée par l’import', async () => {
		const appels: [string, unknown][] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			if (fonction === 'inbox_bulk_unknown_senders') return { data: INCONNUS, error: null, status: 200 }
			return {
				data: [{ line: 1, outcome: 'refused', code: 'duplicate_email', contact_id: null }],
				error: null,
				status: 200,
			}
		}
		const { onTermine } = monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'contacts')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const lignes = await screen.findAllByTestId('inbox-contact-ligne')
		expect(lignes).toHaveLength(2)
		expect((screen.getAllByTestId('inbox-contact-organisation')[0] as HTMLInputElement).value).toBe('Lumen')
		expect((screen.getAllByTestId('inbox-contact-organisation')[1] as HTMLInputElement).value).toBe('')
		expect(screen.getByTestId('inbox-contacts-creer').textContent).toBe('Créer 2 contacts')
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Créer le contact nora@lumen.example' })),
		)
		await userEvent.click(screen.getByRole('checkbox', { name: 'Créer le contact yan@autre.example' }))
		expect(screen.getByTestId('inbox-contacts-creer').textContent).toBe('Créer 1 contact')
		const nom = screen.getAllByTestId('inbox-contact-nom')[0] as HTMLInputElement
		await userEvent.clear(nom)
		await userEvent.type(nom, 'Nora Lumen')
		await userEvent.click(screen.getByTestId('inbox-contacts-creer'))
		const compteRendu = await screen.findByTestId('inbox-compte-rendu')
		expect(within(compteRendu).getByTestId('inbox-compte-rendu-fait').textContent).toBe(
			'0 contacts créés ; 0 ignorés ; 1 refusé.',
		)
		expect(within(compteRendu).getByTestId('inbox-compte-rendu-refus').textContent).toBe(
			'nora@lumen.example — Un contact de l’espace porte déjà cet email.',
		)
		const creation = appels.find(([f]) => f === 'import_contacts')?.[1] as { p_rows: unknown; p_source: string }
		expect(creation.p_source).toBe('email')
		expect(creation.p_rows).toEqual([{ full_name: 'Nora Lumen', email: 'nora@lumen.example', organization_name: 'Lumen' }])
		expect(onTermine).toHaveBeenCalledTimes(1)
	})

	it('aucun inconnu : la phrase, sans action', async () => {
		injecte.rpc = async () => ({ data: [], error: null, status: 200 })
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'contacts')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		expect((await screen.findByTestId('inbox-contacts-aucun')).textContent).toBe(
			'Tous les expéditeurs de la sélection sont déjà des contacts.',
		)
		expect(screen.queryByTestId('inbox-contacts-creer')).toBeNull()
	})
})

describe('la ligne du filtre par expéditeur (§5.109 bis)', () => {
	it('nomme l’adresse et la retire', async () => {
		const onRetirer = vi.fn()
		render(<FiltreExpediteur adresse="spam@exemple.test" onRetirer={onRetirer} />)
		expect(screen.getByTestId('inbox-filtre-expediteur').textContent).toContain('spam@exemple.test')
		await userEvent.click(screen.getByTestId('inbox-filtre-expediteur-retirer'))
		expect(onRetirer).toHaveBeenCalledTimes(1)
	})
})
