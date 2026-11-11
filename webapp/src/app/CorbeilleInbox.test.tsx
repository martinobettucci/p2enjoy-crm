// @verifies CRM-138 (docs/BACKLOG.md) — tranche T3 : « Effacer » et sa confirmation dans le flux (le focus, `Échap`, la case
//           offerte selon la capacité et décochée à chaque ouverture, l'appel envoyé, le refus dans le bloc), la liste de la
//           corbeille (l'auteur et la date inconnus nommés, l'état du déplacement en toutes lettres, « Restaurer » sans
//           confirmation et son refus dans la ligne)
// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : la confirmation et le panneau « Pastilles » s'excluent, hors effacement
//           en vol (docs/DESIGN_SYSTEM.md §5.103)
// @verifies docs/DESIGN_SYSTEM.md §5.102, §5.16, §5.13 ; docs/SPEC-mail-subsystem.md §29.1, §29.3 à §29.5 ; décision 921
//
// Les composants sont réellement montés et interrogés par leur rôle accessible ; le client ne simule que la fonction de la
// base appelée, et sa réponse.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('« Effacer » et sa confirmation dans le flux (§5.102)', () => {
	it('la commande suit le sommeil, ouvre une confirmation qui nomme le message, et le focus entre sur « Annuler »', async () => {
		monterRangee(false)
		const rangee = screen.getByTestId('inbox-commandes-message')
		const boutons = Array.from(rangee.querySelectorAll('button')).map((bouton) => bouton.textContent)
		expect(boutons).toEqual(['Mettre le message en sommeil', 'Effacer'])
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		const groupe = screen.getByRole('group', { name: 'Effacer ce message' })
		// Les espaces de la question sont insécables (`\s` les reconnaît) : le « ? » ne part jamais seul à la ligne.
		expect(groupe.textContent).toMatch(/Effacer «\u00a0Devis signé\u00a0»\u202f\?/)
		expect(groupe.textContent).toContain("d'où vous pourrez le restaurer pendant 30 jours")
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }))
	})

	it('`Échap` abandonne et rend le focus à « Effacer »', async () => {
		monterRangee(false)
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByRole('group', { name: 'Effacer ce message' })).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('inbox-effacer')))
	})

	it('sans la capacité rendue par la base, la case est ABSENTE, non désactivée', async () => {
		monterRangee(false)
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		expect(screen.queryByRole('checkbox')).toBeNull()
	})

	it('avec elle, la case est offerte, décochée, décrite, et décochée de nouveau à chaque ouverture', async () => {
		monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		const caseBoite = screen.getByRole<HTMLInputElement>('checkbox', { name: /L'effacer aussi dans la boîte mail/ })
		expect(caseBoite.checked).toBe(false)
		expect(caseBoite.getAttribute('aria-describedby')).not.toBeNull()
		expect(document.getElementById(caseBoite.getAttribute('aria-describedby') ?? '')?.textContent).toContain(
			"Restaurer ne l'en ressortira pas",
		)
		await userEvent.click(caseBoite)
		expect(caseBoite.checked).toBe(true)
		await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /L'effacer aussi dans la boîte mail/ }).checked).toBe(false)
	})

	it('confirmer envoie `delete_message` avec la case, puis rend la main à l’écran', async () => {
		const appels: unknown[] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			return { data: { message_id: 'm1' }, error: null, status: 200 }
		}
		const onEfface = monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		await userEvent.click(screen.getByRole('checkbox'))
		const groupe = screen.getByRole('group', { name: 'Effacer ce message' })
		await userEvent.click(Array.from(groupe.querySelectorAll('button')).find((b) => b.textContent === 'Effacer')!)
		await waitFor(() => expect(onEfface).toHaveBeenCalledTimes(1))
		expect(appels).toEqual([['delete_message', { p_message_id: 'm1', p_also_mailbox: true }]])
		expect(screen.queryByRole('group', { name: 'Effacer ce message' })).toBeNull()
	})

	it('un refus se dit DANS le bloc, qui reste ouvert, et rien n’est rendu à l’écran', async () => {
		injecte.rpc = async () => ({ data: null, error: { message: 'no_writable_mailbox' }, status: 400 })
		const onEfface = monterRangee(true)
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		await userEvent.click(screen.getByRole('checkbox'))
		await userEvent.click(screen.getByTestId('inbox-effacer-confirmer'))
		const refus = await screen.findByRole('alert')
		expect(refus.textContent).toContain('effacez-le sans cocher la case')
		expect(screen.getByRole('group', { name: 'Effacer ce message' })).not.toBeNull()
		expect(onEfface).not.toHaveBeenCalled()
	})

	// `CRM-141` T4 (§5.103) : le panneau « Pastilles » referme la confirmation, SAUF pendant un effacement en vol — son refus
	// atterrirait sinon sur un bloc fermé, et l'écran tairait l'échec (relevé par la session ea).
	it('CRM-141 : le panneau « Pastilles » referme la confirmation, jamais pendant un effacement en vol', async () => {
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
		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		expect(onConfirmationOuverte).toHaveBeenCalledTimes(1)
		rerender(<RangeeCommandesMessage {...proprietes} refermerConfirmation={1} onConfirmationOuverte={onConfirmationOuverte} />)
		expect(screen.queryByRole('group', { name: 'Effacer ce message' })).toBeNull()

		await userEvent.click(screen.getByRole('button', { name: 'Effacer' }))
		await userEvent.click(screen.getByTestId('inbox-effacer-confirmer'))
		rerender(<RangeeCommandesMessage {...proprietes} refermerConfirmation={2} onConfirmationOuverte={onConfirmationOuverte} />)
		expect(screen.getByRole('group', { name: 'Effacer ce message' })).not.toBeNull()
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
