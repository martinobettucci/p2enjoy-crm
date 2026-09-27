// @verifies CRM-094 (docs/BACKLOG.md) tranche T3 — le guide flottant des administrateurs
// @verifies docs/SPEC-onboarding.md §10.2 (pour qui, où, quand, deux formes, non modal, re-mesure),
//           §10.3 (le geste tenu jusqu'à la re-mesure), §10.4 (stockage de session) ;
//           docs/DESIGN_SYSTEM.md §5.49 (pastille, panneau, focus, Échap)
// @verifies docs/JOURNAL.md décisions 606 — « quand on clique, on le perd » — et 607 ; CLAUDE.md §11
//
// Ces preuves montent le VRAI composant avec un client factice, comme `GuideDemarrage.test.tsx`. Le
// parcours sur la vraie base, dans un espace neuf, relève de `e2e/ui/guide-flottant.spec.ts`.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router'
import { FournisseurEspace } from './ContexteEspace'
import { GuideFlottant, oublierDerniereMesure } from './GuideFlottant'
import { CLE_PREFERENCE_DEMARRAGE_MASQUE, CLE_PREFERENCE_GUIDE_FLOTTANT } from './preferences'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)
beforeEach(() => {
	globalThis.sessionStorage.clear()
	globalThis.localStorage.clear()
	oublierDerniereMesure()
})

type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }
const ok = (count: number): ReponseCompte => ({ count, error: null, status: 200 })

/** Un espace neuf vu par son administratrice : seule l'étape « espace » est accomplie. */
const NEUF: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(0),
	workflows: ok(0),
	channels: ok(0),
	cards: ok(0),
	mail_inbound_accounts: ok(0),
}
const TOUT_FAIT: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(3),
	workflows: ok(2),
	channels: ok(6),
	cards: ok(14),
	mail_inbound_accounts: ok(3),
}

function client(reponses: Readonly<Record<string, ReponseCompte>> | 'jamais'): ClientCrm {
	return {
		from: (table: string) => ({
			select: () => {
				const chaine = {
					is: () => chaine,
					then: (resoudre: (valeur: ReponseCompte) => unknown) => {
						if (reponses === 'jamais') return new Promise(() => undefined)
						const reponse = reponses[table]
						if (reponse === undefined) throw new Error(`table non attendue : ${table}`)
						return Promise.resolve(reponse).then(resoudre)
					},
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
}

const ADMIN = { idWorkspace: 'e0940000-0000-4000-8000-0000000000c1', estAdmin: true }

function monter(
	reponses: Readonly<Record<string, ReponseCompte>> | 'jamais' | ClientCrm,
	{ chemin = '/contacts', valeur = ADMIN }: { chemin?: string; valeur?: typeof ADMIN } = {},
) {
	const fourni = typeof reponses === 'object' && 'from' in reponses ? (reponses as ClientCrm) : null
	return render(
		<MemoryRouter initialEntries={[chemin]}>
			<FournisseurEspace valeur={valeur}>
				<main id="contenu-principal" tabIndex={-1}>
					<GuideFlottant
						sessionOuverte
						client={fourni ?? client(reponses as Readonly<Record<string, ReponseCompte>> | 'jamais')}
					/>
				</main>
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const pastille = () => screen.getByTestId('pastille-guide-flottant')

describe('quand la pastille paraît — §10.2', () => {
	it('paraît pour l’administratrice, avec la progression écrite en toutes lettres', async () => {
		monter(NEUF)
		await waitFor(() => expect(pastille()).toBeTruthy())
		expect(pastille().textContent).toContain('Démarrage · 1 sur 6')
		expect(pastille().getAttribute('aria-expanded')).toBe('false')
		// Réduite, elle ne désigne aucun panneau qui n'existe pas.
		expect(pastille().getAttribute('aria-controls')).toBeNull()
	})

	it('ne paraît PAS à qui la base ne rend pas `admin`, et ne mesure rien pour lui', async () => {
		monter(NEUF, { valeur: { ...ADMIN, estAdmin: false } })
		await new Promise((resoudre) => setTimeout(resoudre, 20))
		expect(screen.queryByTestId('pastille-guide-flottant')).toBeNull()
	})

	it('ne paraît PAS là où la page rend déjà le guide : `/` et `/demarrage`', async () => {
		for (const chemin of ['/', '/demarrage']) {
			const { unmount } = monter(NEUF, { chemin })
			await new Promise((resoudre) => setTimeout(resoudre, 20))
			expect(screen.queryByTestId('pastille-guide-flottant'), chemin).toBeNull()
			unmount()
		}
	})

	it('ne paraît PAS pendant la première mesure : « 0 sur 6 » dirait faux', () => {
		monter('jamais')
		expect(screen.queryByTestId('pastille-guide-flottant')).toBeNull()
	})

	it('disparaît une fois tout accompli', async () => {
		monter(TOUT_FAIT)
		await new Promise((resoudre) => setTimeout(resoudre, 20))
		expect(screen.queryByTestId('pastille-guide-flottant')).toBeNull()
	})

	it('respecte « Masquer le guide » de la session : la même préférence masque la pastille', async () => {
		globalThis.sessionStorage.setItem(CLE_PREFERENCE_DEMARRAGE_MASQUE, '1')
		monter(NEUF)
		await new Promise((resoudre) => setTimeout(resoudre, 20))
		expect(screen.queryByTestId('pastille-guide-flottant')).toBeNull()
	})

	it('garde au bas de la zone principale la place de la pastille', async () => {
		monter(NEUF)
		await waitFor(() => expect(screen.getByTestId('reserve-guide-flottant')).toBeTruthy())
	})
})

describe('ouvrir, suivre un lien, revenir — le défaut relevé par le responsable', () => {
	it('s’ouvre en panneau, place le focus sur son titre, et retient la forme pour la session', async () => {
		const utilisateur = userEvent.setup()
		monter(NEUF)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		const panneau = screen.getByTestId('panneau-guide-flottant')
		expect(pastille().getAttribute('aria-expanded')).toBe('true')
		expect(pastille().getAttribute('aria-controls')).toBe(panneau.id)
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Démarrage'))
		expect(globalThis.sessionStorage.getItem(CLE_PREFERENCE_GUIDE_FLOTTANT)).toBe('ouvert')
		// Le panneau porte la liste du guide, telle quelle : six étapes.
		expect(panneau.querySelectorAll('li')).toHaveLength(6)
	})

	it('remonté par un changement de page, il RESTE ouvert — sans voler le focus', async () => {
		globalThis.sessionStorage.setItem(CLE_PREFERENCE_GUIDE_FLOTTANT, 'ouvert')
		monter(NEUF, { chemin: '/reglages/workflows' })
		expect(await screen.findByTestId('panneau-guide-flottant')).toBeTruthy()
		expect(document.activeElement?.textContent).not.toBe('Démarrage')
	})

	it('le geste réussi garde son bouton éteint pendant la re-mesure : aucun second appel', async () => {
		const utilisateur = userEvent.setup()
		let apres = false
		let appels = 0
		// Après le geste, la re-mesure est en vol et ne rendra jamais : le panneau garde la dernière
		// progression mesurée, où l'étape « Workflow » est encore à faire — c'est la fenêtre du défaut.
		const c = {
			from: (table: string) =>
				(client(apres ? 'jamais' : NEUF) as unknown as { from: (nom: string) => unknown }).from(table),
			rpc: async () => {
				appels += 1
				apres = true
				return { data: 'w', error: null, status: 200 }
			},
		} as unknown as ClientCrm
		monter(c)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		await utilisateur.click(screen.getByTestId('creer-workflow-depart'))
		const bouton = screen.getByTestId('creer-workflow-depart') as HTMLButtonElement
		await waitFor(() => expect(appels).toBe(1))
		expect(bouton.disabled).toBe(true)
		expect(bouton.textContent).toBe('Création…')
		await utilisateur.click(bouton)
		expect(appels).toBe(1)
	})

	/**
	 * Le cas RÉEL des réglages : deux routes qui rendent la même coquille au même endroit, et React la
	 * garde — ce guide avec elle. Trouvé par la preuve E2E (décision 607) : la preuve ci-dessus remonte le
	 * composant, ce que l'application ne fait pas d'une page de réglages à l'autre.
	 */
	function monterSousRouteur(depart: string, c: ClientCrm) {
		const routeur = createMemoryRouter(
			[
				{
					path: '*',
					element: (
						<FournisseurEspace valeur={ADMIN}>
							<main id="contenu-principal" tabIndex={-1}>
								<GuideFlottant sessionOuverte client={c} />
							</main>
						</FournisseurEspace>
					),
				},
			],
			{ initialEntries: [depart] },
		)
		render(<RouterProvider router={routeur} />)
		return routeur
	}

	/** Un client dont les comptes changent entre deux mesures, et qui COMPTE les mesures lancées. */
	function clientCompte(): { client: ClientCrm; poser: (r: Readonly<Record<string, ReponseCompte>>) => void; mesures: () => number } {
		let comptes: Readonly<Record<string, ReponseCompte>> = NEUF
		let mesures = 0
		return {
			client: {
				from: (table: string) => {
					// Une mesure compte les six tables, `workspaces` comprise, une fois chacune.
					if (table === 'workspaces') mesures += 1
					return (client(comptes) as unknown as { from: (nom: string) => unknown }).from(table)
				},
			} as unknown as ClientCrm,
			poser: (r) => {
				comptes = r
			},
			mesures: () => mesures,
		}
	}

	it('une nouvelle page RE-MESURE, même quand la coquille n’est pas remontée (§10.2)', async () => {
		const espion = clientCompte()
		const routeur = monterSousRouteur('/reglages/arborescence', espion.client)
		await waitFor(() => expect(pastille().textContent).toContain('1 sur 6'))
		expect(espion.mesures()).toBe(1)
		// Un track vient de naître sur l'arborescence ; l'administrateur passe à l'éditeur.
		espion.poser({ ...NEUF, tracks: ok(1) })
		await act(async () => {
			await routeur.navigate('/reglages/workflows')
		})
		await waitFor(() => expect(pastille().textContent).toContain('2 sur 6'))
		expect(espion.mesures()).toBe(2)
	})

	it('devenu actif en quittant l’accueil, il ne mesure qu’UNE fois — pas deux', async () => {
		const espion = clientCompte()
		const routeur = monterSousRouteur('/', espion.client)
		await new Promise((resoudre) => setTimeout(resoudre, 20))
		expect(espion.mesures()).toBe(0)
		await act(async () => {
			await routeur.navigate('/contacts')
		})
		await waitFor(() => expect(pastille().textContent).toContain('1 sur 6'))
		expect(espion.mesures()).toBe(1)
	})

	it('garde la dernière progression pendant la nouvelle mesure : aucun clignotement', async () => {
		const { unmount } = monter(NEUF)
		await waitFor(() => expect(pastille().textContent).toContain('1 sur 6'))
		unmount()
		// Nouvelle page : la mesure est en vol, et ne rendra jamais — la pastille reste pourtant là.
		monter('jamais', { chemin: '/inbox' })
		expect(pastille().textContent).toContain('1 sur 6')
	})
})

describe('refermer au clavier et à la souris — §10.2, docs/DESIGN_SYSTEM.md §5.49', () => {
	it('`Échap` referme et rend le focus à la pastille', async () => {
		const utilisateur = userEvent.setup()
		monter(NEUF)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-guide-flottant')).toBeNull()
		expect(document.activeElement).toBe(pastille())
		expect(globalThis.sessionStorage.getItem(CLE_PREFERENCE_GUIDE_FLOTTANT)).toBeNull()
	})

	it('« Réduire » referme et rend le focus à la pastille', async () => {
		const utilisateur = userEvent.setup()
		monter(NEUF)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		await utilisateur.click(screen.getByTestId('reduire-guide-flottant'))
		expect(screen.queryByTestId('panneau-guide-flottant')).toBeNull()
		expect(document.activeElement).toBe(pastille())
	})

	it('« Masquer pour la session » retire la pastille et rend le focus au contenu principal', async () => {
		const utilisateur = userEvent.setup()
		monter(NEUF)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		await utilisateur.click(screen.getByTestId('masquer-guide-flottant'))
		await act(async () => undefined)
		expect(screen.queryByTestId('pastille-guide-flottant')).toBeNull()
		expect(globalThis.sessionStorage.getItem(CLE_PREFERENCE_DEMARRAGE_MASQUE)).toBe('1')
		expect(document.activeElement?.id).toBe('contenu-principal')
	})

	it('n’écrit RIEN en `localStorage`', async () => {
		const utilisateur = userEvent.setup()
		monter(NEUF)
		await utilisateur.click(await screen.findByTestId('pastille-guide-flottant'))
		await utilisateur.keyboard('{Escape}')
		expect(globalThis.localStorage.length).toBe(0)
	})
})
