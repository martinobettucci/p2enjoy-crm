// @verifies CRM-138 (docs/BACKLOG.md) — tranche T3 : « Effacer » et sa confirmation dans le flux (le focus, `Échap`, la case
//           offerte selon la capacité et décochée à chaque ouverture, l'appel envoyé, le refus dans le bloc), la liste de la
//           corbeille (l'auteur et la date inconnus nommés, l'état du déplacement en toutes lettres, « Restaurer » sans
//           confirmation et son refus dans la ligne)
// @verifies CRM-151 (docs/BACKLOG.md) — tranche T2 : « Supprimer ici » et « Supprimer partout » — la commande absente sans
//           capacité, la confirmation qui rappelle l'effet, la case d'une heure posée au seul succès, la suspension dite et
//           « Redemander », le refus sous la rangée — docs/SPEC-mail-subsystem.md §29.11 ; docs/DESIGN_SYSTEM.md §5.102 révisé
// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : la confirmation et le panneau « Pastilles » s'excluent, hors effacement
//           en vol (docs/DESIGN_SYSTEM.md §5.103)
// @verifies docs/DESIGN_SYSTEM.md §5.102, §5.16, §5.13 ; docs/SPEC-mail-subsystem.md §29.1, §29.3 à §29.5 ; décision 921
//
// Les composants sont réellement montés et interrogés par leur rôle accessible ; le client ne simule que la fonction de la
// base appelée, et sa réponse.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLE_SUPPRESSION_SANS_CONFIRMATION } from '../lib/suppression-sans-confirmation'
import type { ClientCrm } from '../lib/supabase'
import type { MessageEnCorbeille } from '../lib/corbeille-inbox'

const injecte = vi.hoisted(() => ({
	rpc: null as null | ((fonction: string, corps: unknown) => Promise<unknown>),
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return injecte.rpc === null ? null : ({ rpc: injecte.rpc } as unknown as ClientCrm)
	},
}))

const { PanneauCorbeille, RangeeCommandesMessage } = await import('./CorbeilleInbox')

afterEach(() => {
	cleanup()
	injecte.rpc = null
})

const RETENTION = { statut: 'pret', donnees: 30 } as const

function monterRangee(effacableDansBoite: boolean, onEfface = vi.fn()) {
	render(
		<RangeeCommandesMessage
			idMessage="m1"
			objet="Devis signé"
			effacableDansBoite={effacableDansBoite}
			retention={RETENTION}
			commandes={<button type="button">Mettre le message en sommeil</button>}
			onEfface={onEfface}
		/>,
	)
	return onEfface
}

const accepter = (appels: unknown[] = []) => {
	injecte.rpc = async (fonction, corps) => {
		appels.push([fonction, corps])
		return { data: { message_id: 'm1' }, error: null, status: 200 }
	}
	return appels
}

describe('« Supprimer ici » et « Supprimer partout » (§29.11, §5.102 révisé)', () => {
	beforeEach(() => sessionStorage.clear())

	it('les deux commandes suivent les autres ; « Supprimer partout » est ABSENTE sans la capacité de la base', () => {
		monterRangee(true)
		const boutons = Array.from(screen.getByTestId('inbox-commandes-message').querySelectorAll('button')).map((b) => b.textContent)
		expect(boutons).toEqual(['Mettre le message en sommeil', 'Supprimer ici', 'Supprimer partout'])
		cleanup()
		monterRangee(false)
		expect(screen.queryByRole('button', { name: 'Supprimer partout' })).toBeNull()
		expect(screen.getByRole('button', { name: 'Supprimer ici' })).toBeTruthy()
	})

	it('« Supprimer ici » : la confirmation rappelle l’effet, porte la case décochée, et le focus entre sur « Annuler »', async () => {
		monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		const groupe = screen.getByRole('group', { name: 'Supprimer ce message' })
		expect(groupe.textContent).toMatch(/Supprimer «\u00a0Devis signé\u00a0» ici\u202f\?/)
		expect(groupe.textContent).toContain('pendant 30 jours. Votre boîte mail le garde.')
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Ne plus demander pendant 1 heure' }).checked).toBe(false)
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }))
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByRole('group', { name: 'Supprimer ce message' })).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('inbox-supprimer-ici')))
	})

	it('« Supprimer partout » envoie la boîte ; « Supprimer ici » ne l’envoie pas ; l’étendue est rendue à l’écran', async () => {
		const appels = accepter()
		const onEfface = monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer partout' }))
		const groupe = screen.getByRole('group', { name: 'Supprimer ce message' })
		expect(groupe.textContent).toContain("d'où restaurer ne le ressortira pas")
		await userEvent.click(screen.getByTestId('inbox-suppression-confirmer'))
		await waitFor(() => expect(onEfface).toHaveBeenCalledWith('partout'))
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		await userEvent.click(screen.getByTestId('inbox-suppression-confirmer'))
		await waitFor(() => expect(onEfface).toHaveBeenLastCalledWith('ici'))
		expect(appels).toEqual([
			['delete_message', { p_message_id: 'm1', p_also_mailbox: true }],
			['delete_message', { p_message_id: 'm1', p_also_mailbox: false }],
		])
	})

	it('la case cochée suspend la confirmation : la rangée le dit, le clic suivant supprime aussitôt, « Redemander » la rétablit', async () => {
		const appels = accepter()
		const onEfface = monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		await userEvent.click(screen.getByRole('checkbox', { name: 'Ne plus demander pendant 1 heure' }))
		await userEvent.click(screen.getByTestId('inbox-suppression-confirmer'))
		await waitFor(() => expect(onEfface).toHaveBeenCalledTimes(1))
		const mention = screen.getByTestId('inbox-suppression-suspendue')
		expect(mention.textContent).toMatch(/Sans confirmation jusqu’à \d\d:\d\d/)
		expect(sessionStorage.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)).not.toBeNull()
		// La commande décrit ce qu'un clic fera.
		expect(screen.getByTestId('inbox-supprimer-partout').getAttribute('aria-describedby')).not.toBeNull()

		await userEvent.click(screen.getByRole('button', { name: 'Supprimer partout' }))
		await waitFor(() => expect(onEfface).toHaveBeenLastCalledWith('partout'))
		expect(screen.queryByRole('group', { name: 'Supprimer ce message' })).toBeNull()
		expect(appels).toHaveLength(2)

		await userEvent.click(screen.getByTestId('inbox-suppression-redemander'))
		expect(screen.queryByTestId('inbox-suppression-suspendue')).toBeNull()
		expect(sessionStorage.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		expect(screen.getByRole('group', { name: 'Supprimer ce message' })).toBeTruthy()
	})

	it('la case n’agit qu’au succès : un refus garde le bloc ouvert et ne suspend rien', async () => {
		injecte.rpc = async () => ({ data: null, error: { message: 'no_writable_mailbox' }, status: 400 })
		const onEfface = monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer partout' }))
		await userEvent.click(screen.getByRole('checkbox', { name: 'Ne plus demander pendant 1 heure' }))
		await userEvent.click(screen.getByTestId('inbox-suppression-confirmer'))
		expect((await screen.findByRole('alert')).textContent).toBeTruthy()
		expect(screen.getByRole('group', { name: 'Supprimer ce message' })).toBeTruthy()
		expect(onEfface).not.toHaveBeenCalled()
		expect(sessionStorage.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)).toBeNull()
	})

	it('suspendue, un refus se dit SOUS LA RANGÉE, et rien n’est rendu à l’écran', async () => {
		sessionStorage.setItem(CLE_SUPPRESSION_SANS_CONFIRMATION, new Date(Date.now() + 30 * 60_000).toISOString())
		injecte.rpc = async () => ({ data: null, error: { message: 'forbidden', code: '42501' }, status: 403 })
		const onEfface = monterRangee(false)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		expect((await screen.findByRole('alert')).getAttribute('data-testid')).toBe('inbox-suppression-refus')
		expect(screen.queryByRole('group', { name: 'Supprimer ce message' })).toBeNull()
		expect(onEfface).not.toHaveBeenCalled()
	})

	it('CRM-141 : le panneau « Pastilles » referme la confirmation, jamais pendant une suppression en vol', async () => {
		let rendre: (valeur: unknown) => void = () => {}
		injecte.rpc = () => new Promise((resoudre) => (rendre = resoudre))
		const proprietes = {
			idMessage: 'm1',
			objet: 'Devis signé',
			effacableDansBoite: false,
			retention: RETENTION,
			commandes: null,
			onEfface: vi.fn(),
		}
		const onConfirmationOuverte = vi.fn()
		const { rerender } = render(
			<RangeeCommandesMessage {...proprietes} refermerConfirmation={0} onConfirmationOuverte={onConfirmationOuverte} />,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		expect(onConfirmationOuverte).toHaveBeenCalledTimes(1)
		rerender(<RangeeCommandesMessage {...proprietes} refermerConfirmation={1} onConfirmationOuverte={onConfirmationOuverte} />)
		expect(screen.queryByRole('group', { name: 'Supprimer ce message' })).toBeNull()

		await userEvent.click(screen.getByRole('button', { name: 'Supprimer ici' }))
		await userEvent.click(screen.getByTestId('inbox-suppression-confirmer'))
		rerender(<RangeeCommandesMessage {...proprietes} refermerConfirmation={2} onConfirmationOuverte={onConfirmationOuverte} />)
		expect(screen.getByRole('group', { name: 'Supprimer ce message' })).not.toBeNull()
		rendre({ data: null, error: { message: 'boom' }, status: 500 })
		expect(await screen.findByRole('alert')).toBeTruthy()
	})
})

const EN_CORBEILLE: readonly MessageEnCorbeille[] = [
	{
		id: 'm1',
		objet: 'Devis signé',
		expediteur: 'client@exemple.test',
		cardId: null,
		effaceLe: '2026-11-11T09:00:00Z',
		effacePar: null,
		purgeLe: null,
		deplacement: 'echec',
		motifDeplacement: 'no_trash_folder',
	},
	{
		id: 'm2',
		objet: 'Relance',
		expediteur: 'autre@exemple.test',
		cardId: null,
		effaceLe: '2026-11-10T09:00:00Z',
		effacePar: 'Camille Durand',
		purgeLe: '2026-12-10T09:00:00Z',
		deplacement: 'fait',
		motifDeplacement: null,
	},
]

function monterCorbeille(donnees: readonly MessageEnCorbeille[], personnelle: boolean, onRestaure = vi.fn()) {
	render(
		<PanneauCorbeille
			etat={{ statut: 'pret', donnees }}
			retention={RETENTION}
			personnelle={personnelle}
			mention=""
			onRestaure={onRestaure}
			onRetour={() => {}}
			onReprise={() => {}}
			visible
			refVide={createRef<HTMLDivElement>()}
			refsLignes={{ current: new Map() }}
		/>,
	)
	return onRestaure
}

describe('la liste de la corbeille (§5.102)', () => {
	it('dit la règle en tête, l’auteur et la date inconnus en toutes lettres, et l’état du déplacement', () => {
		monterCorbeille(EN_CORBEILLE, true)
		expect(screen.getByText('Un message reste 30 jours dans la corbeille, puis il est effacé définitivement.')).not.toBeNull()
		expect(screen.getByText('Vous voyez les messages que vous avez effacés.')).not.toBeNull()
		const [premiere, seconde] = screen.getAllByTestId('inbox-corbeille-ligne')
		expect(premiere!.textContent).toContain('par Auteur inconnu')
		expect(premiere!.textContent).toContain('Effacement définitif le Inconnue')
		expect(premiere!.textContent).toContain("Déplacement impossible : la boîte n'annonce aucun dossier corbeille")
		expect(seconde!.textContent).toContain('par Camille Durand')
		expect(seconde!.textContent).toContain('Déplacé dans la corbeille de la boîte')
	})

	it('pour qui administre l’espace, la phrase de portée est absente ; une corbeille vide n’offre aucune action', () => {
		monterCorbeille([], false)
		expect(screen.queryByText('Vous voyez les messages que vous avez effacés.')).toBeNull()
		const vide = screen.getByTestId('inbox-corbeille-vide')
		expect(vide.textContent).toContain('La corbeille est vide.')
		expect(vide.querySelector('button')).toBeNull()
	})

	it('« Restaurer » appelle `restore_message` sans confirmation', async () => {
		const appels: unknown[] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			return { data: { message_id: 'm2' }, error: null, status: 200 }
		}
		const onRestaure = monterCorbeille(EN_CORBEILLE, false)
		await userEvent.click(screen.getByRole('button', { name: 'Restaurer « Relance »' }))
		await waitFor(() => expect(onRestaure).toHaveBeenCalledWith('m2'))
		expect(appels).toEqual([['restore_message', { p_message_id: 'm2' }]])
		expect(screen.queryByRole('group')).toBeNull()
	})

	it('un refus de restauration se dit dans la ligne, et la ligne reste', async () => {
		injecte.rpc = async () => ({ data: null, error: { message: 'message_not_found' }, status: 404 })
		const onRestaure = monterCorbeille(EN_CORBEILLE, false)
		await userEvent.click(screen.getByRole('button', { name: 'Restaurer « Devis signé »' }))
		const refus = await screen.findByRole('alert')
		expect(refus.textContent).toBe("Ce message n'est plus dans la corbeille.")
		expect(refus.closest('[data-testid="inbox-corbeille-ligne"]')?.getAttribute('data-message')).toBe('m1')
		expect(onRestaure).not.toHaveBeenCalled()
	})
})
