// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : l'écran et ses deux surfaces
// @verifies docs/SPEC-onboarding.md §4.1 (le guide est toujours rendu à son adresse),
//           §4.2 (les quatre cas de l'accueil), §5 (interruption limitée à la session),
//           §6.1 (états), §6.2 (les trois états d'une étape), §6.3 (aucune étape désactivée),
//           §7 (accessibilité : une `ol`, un mot et non une icône seule)
// @verifies docs/DESIGN_SYSTEM.md §5.17 (cette surface)
// @verifies CLAUDE.md §10 (aucun rôle lu côté client), §11 (rien hors de la session)
//
// Ces preuves montent le VRAI écran avec un client factice, comme `Corbeille.test.tsx`. Le parcours
// connecté sur la vraie base relève de `e2e/ui/demarrage.spec.ts`.
//
// LA PREUVE LA PLUS UTILE DE CE FICHIER EST CELLE DU `localStorage` INTACT. Le guide est la première
// surface du produit à mémoriser un choix de l'utilisateur ; le faire survivre à la fermeture de
// l'onglet demanderait un consentement que rien ne justifie (`CLAUDE.md` §11).

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AccueilDemarrage, GuideDemarrage } from './GuideDemarrage'
import { CLE_PREFERENCE_DEMARRAGE_MASQUE } from './preferences'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)
beforeEach(() => {
	globalThis.sessionStorage.clear()
	globalThis.localStorage.clear()
})

type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }

const ok = (count: number): ReponseCompte => ({ count, error: null, status: 200 })

/** Le seed réel vu par `admin@p2enjoy.test`, mesuré le 2026-08-15 (docs/SPEC-onboarding.md §3.1). */
const SEED_ADMIN: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(3),
	channels: ok(6),
	cards: ok(14),
	mail_inbound_accounts: ok(3),
}

/** Le seed réel vu par `viewer@p2enjoy.test` : la cinquième étape lui paraît toujours à faire. */
const SEED_VIEWER: Readonly<Record<string, ReponseCompte>> = {
	...SEED_ADMIN,
	channels: ok(5),
	cards: ok(9),
	mail_inbound_accounts: ok(0),
}

/** Un espace de travail neuf : tout reste à faire. */
const NEUF: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(0),
	channels: ok(0),
	cards: ok(0),
	mail_inbound_accounts: ok(0),
}

function client(reponses: Readonly<Record<string, ReponseCompte>>): ClientCrm {
	return {
		from: (table: string) => ({
			select: () => {
				const reponse = reponses[table]
				if (reponse === undefined) throw new Error(`table non attendue : ${table}`)
				const chaine = {
					is: () => chaine,
					then: (resoudre: (valeur: ReponseCompte) => unknown) =>
						Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
}

function monter(element: React.ReactElement) {
	return render(<MemoryRouter>{element}</MemoryRouter>)
}

describe('le guide, à son adresse — docs/SPEC-onboarding.md §4.1', () => {
	it('rend les cinq étapes dans une liste ORDONNÉE', async () => {
		monter(<GuideDemarrage client={client(NEUF)} />)
		const liste = await screen.findByRole('list')
		expect(liste.tagName).toBe('OL')
		expect(await screen.findAllByRole('listitem')).toHaveLength(5)
	})

	it('est rendu MÊME intégralement accompli : c’est ce qui le rend relançable', async () => {
		monter(<GuideDemarrage client={client(SEED_ADMIN)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toContain('5'),
		)
	})

	it('est rendu MÊME masqué pour la session : l’adresse ignore la préférence', async () => {
		globalThis.sessionStorage.setItem(CLE_PREFERENCE_DEMARRAGE_MASQUE, '1')
		monter(<GuideDemarrage client={client(NEUF)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
	})

	it('n’offre PAS le masquage : la commande n’aurait aucun effet observable ici', async () => {
		monter(<GuideDemarrage client={client(NEUF)} />)
		await screen.findByTestId('guide-demarrage')
		expect(screen.queryByTestId('masquer-guide')).toBeNull()
	})
})

describe('l’état d’une étape est un MOT — §6.2, docs/DESIGN_SYSTEM.md §5.17', () => {
	it('écrit « Fait » sur une étape accomplie, et lui LAISSE son lien', async () => {
		monter(<GuideDemarrage client={client(SEED_ADMIN)} />)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() => expect(ligne.textContent).toContain('Fait'))
		// Une étape accomplie garde son chemin : on ajoute un second track après le premier.
		expect(screen.getByTestId('lien-track')).toBeTruthy()
	})

	it('écrit « À faire » sur une étape non accomplie, sans affirmer que rien n’existe', async () => {
		monter(<GuideDemarrage client={client(NEUF)} />)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() => expect(ligne.textContent).toContain('À faire'))
		// La phrase dit ce que l'appelant VOIT : le `viewer` seedé compte 5 channels là où la base
		// en porte 6 (docs/SPEC-onboarding.md §3.1, fait 1).
		expect(ligne.textContent).toContain('Vous n’en voyez aucun pour le moment.')
	})

	it('nomme une étape non mesurable, et ne la laisse pas passer pour « à faire »', async () => {
		monter(
			<GuideDemarrage
				client={client({ ...NEUF, tracks: { count: null, error: { message: 'panne' }, status: 500 } })}
			/>,
		)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() =>
			expect(ligne.textContent).toContain('Cette étape n’a pas pu être vérifiée'),
		)
		expect(ligne.textContent).not.toContain('À faire')
	})

	it('offre une reprise sur une PANNE, et aucune sur un REFUS', async () => {
		const { unmount } = monter(
			<GuideDemarrage
				client={client({ ...NEUF, tracks: { count: null, error: { message: 'panne' }, status: 500 } })}
			/>,
		)
		await waitFor(() =>
			expect(screen.getByTestId('etape-track').textContent).toContain('Réessayer'),
		)
		unmount()

		// Un refus est définitif tant que la session ne change pas : proposer de réessayer
		// promettrait un aboutissement que le backend a déjà refusé (§6.1).
		monter(
			<GuideDemarrage
				client={client({
					...NEUF,
					mail_inbound_accounts: { count: null, error: { message: 'refus' }, status: 401 },
				})}
			/>,
		)
		const ligne = await screen.findByTestId('etape-messagerie')
		await waitFor(() =>
			expect(ligne.textContent).toContain('Cette étape n’a pas pu être vérifiée'),
		)
		expect(ligne.textContent).not.toContain('Réessayer')
	})

	it('n’éteint AUCUN lien, quel que soit l’état de l’étape — CLAUDE.md §10', async () => {
		monter(<GuideDemarrage client={client(SEED_VIEWER)} />)
		await screen.findByTestId('guide-demarrage')
		for (const cle of ['track', 'channel', 'affaire', 'messagerie']) {
			const lien = await screen.findByTestId(`lien-${cle}`)
			expect(lien.getAttribute('aria-disabled')).toBeNull()
			expect(lien.getAttribute('href')).toBeTruthy()
		}
	})

	it('la première étape ne porte aucun lien : elle est accomplie par la connexion', async () => {
		monter(<GuideDemarrage client={client(NEUF)} />)
		await screen.findByTestId('etape-espace')
		expect(screen.queryByTestId('lien-espace')).toBeNull()
	})
})

describe('la progression s’écrit en toutes lettres — §7', () => {
	it('n’écrit aucun chiffre tant qu’une mesure est en vol', () => {
		monter(<AccueilDemarrage client={client(NEUF)} />)
		expect(screen.getByTestId('progression-demarrage').textContent).toContain('Mesure des étapes')
	})

	it('écrit le compte et le total une fois les cinq mesures rendues', async () => {
		monter(<GuideDemarrage client={client(SEED_VIEWER)} />)
		// admin : 5 sur 5 ; viewer : 4 sur 5, faute de voir une boîte entrante (§3.1, fait 2).
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toBe('4 étape(s) sur 5'),
		)
	})
})

describe('l’accueil et sa décision — §4.2', () => {
	it('rend le guide tant qu’une étape reste à faire', async () => {
		monter(<AccueilDemarrage client={client(NEUF)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
		expect(screen.getByTestId('masquer-guide')).toBeTruthy()
	})

	it('rend l’état vide du board une fois les cinq étapes accomplies', async () => {
		monter(<AccueilDemarrage client={client(SEED_ADMIN)} />)
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		// Rien à rouvrir : le guide n'a plus rien à enseigner.
		expect(screen.queryByTestId('rouvrir-guide')).toBeNull()
	})

	it('ne rend JAMAIS l’état vide pendant le chargement', () => {
		// Sinon l'écran d'arrivée clignoterait et afficherait « aucun board » à qui en a.
		monter(<AccueilDemarrage client={client(SEED_ADMIN)} />)
		expect(screen.queryByTestId('etat-vide')).toBeNull()
		expect(screen.getByTestId('guide-demarrage')).toBeTruthy()
	})

	it('masqué, il cède la place à l’état vide ET laisse un chemin de retour', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(screen.getByTestId('rouvrir-guide').getAttribute('href')).toBe('/demarrage')
	})

	it('reste masqué au remontage : la préférence survit à un rechargement d’onglet', async () => {
		const utilisateur = userEvent.setup()
		const { unmount } = monter(<AccueilDemarrage client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		unmount()

		monter(<AccueilDemarrage client={client(NEUF)} />)
		await waitFor(() => expect(screen.getByTestId('rouvrir-guide')).toBeTruthy())
		expect(screen.queryByTestId('guide-demarrage')).toBeNull()
	})
})

describe('ce que le guide N’ÉCRIT PAS sur l’appareil — CLAUDE.md §11', () => {
	it('n’écrit RIEN en `localStorage`, y compris après avoir été masqué', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(globalThis.localStorage.length).toBe(0)
	})

	it('écrit sa seule préférence en `sessionStorage`, sous une clé nommée', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() =>
			expect(globalThis.sessionStorage.getItem(CLE_PREFERENCE_DEMARRAGE_MASQUE)).toBe('1'),
		)
	})

	it('n’écrit AUCUNE progression : elle est mesurée, jamais mémorisée — §2', async () => {
		monter(<GuideDemarrage client={client(SEED_ADMIN)} />)
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toBe('5 étape(s) sur 5'),
		)
		expect(globalThis.sessionStorage.length).toBe(0)
		expect(globalThis.localStorage.length).toBe(0)
	})
})
