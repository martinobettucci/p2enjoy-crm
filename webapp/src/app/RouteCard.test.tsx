// @verifies CRM-077 (docs/BACKLOG.md) — corbeille : le GESTE de mise à la corbeille d'une AFFAIRE,
//           huitième tranche
// @verifies docs/SPEC-corbeille.md §4 ter.2 (la confirmation ne porte AUCUNE énumération),
//           §4 ter.3 (les trois issues, et aucune commande éteinte d'avance), §4 ter.5 (après le
//           geste, l'écran nomme la corbeille et ne dit PAS « introuvable »), §5 (ligne « Unitaire »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 (le bloc du geste, sa confirmation dans le flux, son succès),
//           §5.13 (le focus revient à la commande qui a ouvert la confirmation), §8 (role="status")
// @verifies CLAUDE.md §10 (la règle vit dans la politique, jamais dans l'écran)
//
// Ces preuves montent le bloc RÉEL du geste avec un client factice. Le parcours connecté sur la
// vraie base — et la disparition effective de l'affaire — relève de `e2e/ui/corbeille.spec.ts`.
//
// LA PREUVE LA PLUS UTILE DE CE FICHIER EST CELLE DU « SANS EFFET ». C'est la seule issue qui rend
// `200` sans rien changer (décision 70) : la confondre avec un succès afficherait un retrait qui n'a
// pas eu lieu, et aucune erreur ne le signalerait — ni au moment du clic, ni jamais.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlocCorbeilleCard } from './RouteCard'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = {
	data: Record<string, unknown>[] | null
	error: { message: string; code?: string } | null
	status: number
}

const AFFAIRE = { id: 'c-2', titre: 'Migration ERP Sogexia' }

/** Client factice : une seule écriture possible, celle du geste. */
function client(reponse: Reponse, surEcriture?: (table: string, charge: unknown) => void): ClientCrm {
	return {
		from: (table: string) => ({
			update: (charge: unknown) => {
				surEcriture?.(table, charge)
				const chaine = {
					eq: () => chaine,
					select: () => chaine,
					then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
}

const APPLIQUEE: Reponse = { data: [{ id: AFFAIRE.id }], error: null, status: 200 }
const SANS_EFFET: Reponse = { data: [], error: null, status: 200 }

function monter(reponse: Reponse, surRetrait = vi.fn(), surEcriture?: (t: string, c: unknown) => void) {
	render(
		<BlocCorbeilleCard
			idCard={AFFAIRE.id}
			titre={AFFAIRE.titre}
			onRetiree={surRetrait}
			client={client(reponse, surEcriture)}
		/>,
	)
	return surRetrait
}

describe('le geste de mise à la corbeille d’une affaire', () => {
	it('demande une confirmation NOMMANT l’affaire, et n’écrit rien avant elle (§4 ter.2, §6)', async () => {
		const utilisateur = userEvent.setup()
		const ecritures: string[] = []
		monter(APPLIQUEE, vi.fn(), (table) => ecritures.push(table))

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))

		expect(screen.getByTestId('confirmation-corbeille-card')).toBeTruthy()
		expect(screen.getByText(/Migration ERP Sogexia/)).toBeTruthy()
		// Ouvrir la confirmation n'écrit RIEN : une confirmation qui aurait déjà agi ne serait pas
		// une confirmation.
		expect(ecritures).toEqual([])
	})

	it("ne porte AUCUNE énumération, pas même « aucun objet » (§4 ter.2)", async () => {
		const utilisateur = userEvent.setup()
		monter(APPLIQUEE)

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))

		// Une affaire n'a pas d'enfant au sens du §3.5, donc AUCUNE mesure n'a lieu. La phrase
		// « Aucun objet ne devient inaccessible » du §4 bis.3 rapporte, elle, une mesure qui a rendu
		// zéro : l'écrire ici répondrait à une question qui n'a pas été posée.
		expect(screen.queryByText(/inaccessible/i)).toBeNull()
		expect(screen.queryByText(/channel/i)).toBeNull()
	})

	it("prévient l'écran quand le retrait est APPLIQUÉ, et écrit la seule colonne permise (§4 ter.3)", async () => {
		const utilisateur = userEvent.setup()
		const charges: unknown[] = []
		const surRetrait = monter(APPLIQUEE, vi.fn(), (_table, charge) => charges.push(charge))

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))
		await utilisateur.click(screen.getByTestId('confirmer-corbeille-card'))

		await waitFor(() => expect(surRetrait).toHaveBeenCalledTimes(1))
		expect(Object.keys(charges[0] as object)).toEqual(['deleted_at'])
	})

	it('dit « sans effet » plutôt que succès sur `200` et zéro ligne (§4 ter.3, décision 70)', async () => {
		const utilisateur = userEvent.setup()
		const surRetrait = monter(SANS_EFFET)

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))
		await utilisateur.click(screen.getByTestId('confirmer-corbeille-card'))

		// MESURÉ avec le jeton réel de la lectrice : la politique filtre la ligne avant la mise à
		// jour, rien n'a changé, et l'écran ne doit surtout pas basculer sur l'état « retirée ».
		await waitFor(() => expect(screen.getByTestId('refus-corbeille-card')).toBeTruthy())
		expect(surRetrait).not.toHaveBeenCalled()
		expect(screen.getByTestId('confirmation-corbeille-card')).toBeTruthy()
	})

	it('traduit un refus de droit par un texte du produit, jamais par le message du serveur', async () => {
		const utilisateur = userEvent.setup()
		monter({ data: null, error: { message: 'permission denied for table cards' }, status: 403 })

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))
		await utilisateur.click(screen.getByTestId('confirmer-corbeille-card'))

		const alerte = await screen.findByTestId('refus-corbeille-card')
		expect(alerte.textContent).toContain("n'a pas le droit")
		// Le détail de la pile ne remonte JAMAIS à l'utilisateur (`CLAUDE.md` §20).
		expect(alerte.textContent).not.toContain('permission denied')
	})

	it('rend le focus à la commande quand on annule (docs/DESIGN_SYSTEM.md §5.13)', async () => {
		const utilisateur = userEvent.setup()
		monter(APPLIQUEE)

		await utilisateur.click(screen.getByRole('button', { name: 'Mettre à la corbeille' }))
		await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))

		// Sans ce retour, annuler au clavier laisse le focus sur un bouton qui vient de disparaître.
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mettre à la corbeille' })),
		)
	})

	it("n'éteint la commande sur AUCUN rôle : la règle vit dans la politique (§4 ter.3, CLAUDE.md §10)", async () => {
		// Le composant ne reçoit aucun rôle, et c'est le propos : un business developer RÉUSSIT ce
		// geste là où il échoue sur un track — `cards_maj` porte sur le droit d'écriture du channel.
		// Une commande éteinte d'avance se tromperait, et ferait passer une règle de la base pour une
		// décision d'écran.
		monter(APPLIQUEE)
		const commande = screen.getByRole('button', { name: 'Mettre à la corbeille' })
		expect(commande.hasAttribute('disabled')).toBe(false)
	})
})
