// @verifies CRM-064 (docs/BACKLOG.md) — tranche 3a : le rendu de la cloche et du panneau
// @verifies docs/SPEC-notifications.md §23.2 (le panneau, ni modale ni route), §24.3 (les trois
//           cas de ligne), §26.1 (le compteur), §26.2 (l'ordre et la forme), §26.4 (le marquage
//           et ses trois issues), §26.5 (la troncature écrite), §26.7 (les états), §31
// @verifies docs/DESIGN_SYSTEM.md §5.43 (cette surface), §5.8 (états systématiques),
//           §5.32 (aucun lien vers une adresse incomplète), §8 (accessibilité)
//
// LES DONNÉES INJECTÉES SONT CELLES DU SEED, À L'IDENTIQUE — la notification de Driss produite par
// la mention de Camille sur le commentaire `…0d1`, portée par la card `…0c1` de « Grands comptes ».
// Ce n'est pas une commodité : c'est la ligne que la preuve E2E exerce sur la pile réelle.
//
// Les composants sont réellement montés et interrogés par leur **rôle accessible** quand il existe :
// un test qui n'interrogerait que des classes CSS validerait une apparence sans rien dire de
// l'utilisabilité.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCrm } from '../lib/supabase'

const injecte = vi.hoisted(() => ({
	client: null as ClientCrm | null,
	session: null as { statut: string; utilisateur?: { id: string } } | null,
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return injecte.client
	},
}))

vi.mock('./Authentification', () => ({
	useAuthentification: () => ({
		etat: injecte.session ?? { statut: 'anonyme' },
		profilCourant: { statut: 'pret', donnees: null },
		connecter: async () => ({ ok: true }),
		deconnecter: async () => ({ ok: true }),
	}),
}))

const { ClocheNotifications } = await import('./Notifications')

afterEach(cleanup)

const CAMILLE = {
	id: '5eed0000-0000-4000-8000-000000000011',
	full_name: 'Camille Aubert',
	avatar_url: '/avatars/camille-aubert.svg',
}

/** La notification du seed adressée à Driss, telle que la requête 1 la rend. */
const N1 = {
	id: 'n-1',
	type: 'mention',
	read_at: null as string | null,
	created_at: '2026-08-26T16:25:30.556393+00:00',
	subject_card_id: '5eed0000-0000-4000-8000-0000000000c1',
	payload: {
		comment_id: '5eed0000-0000-4000-8000-0000000000d1',
		author_id: CAMILLE.id,
	},
	cards: {
		id: '5eed0000-0000-4000-8000-0000000000c1',
		title: 'Refonte du site vitrine',
		channels: {
			slug: 'grands-comptes',
			name: 'Grands comptes',
			tracks: { slug: 'conseil-ia', name: 'Conseil & IA' },
		},
	},
}

const D1 = {
	id: '5eed0000-0000-4000-8000-0000000000d1',
	body: 'La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq.',
	deleted_at: null as string | null,
	author_id: CAMILLE.id,
	auteur: CAMILLE,
}

type Options = {
	readonly notifications?: readonly unknown[]
	readonly erreurLecture?: boolean
	readonly commentaires?: readonly unknown[]
	readonly compte?: number | null
	readonly lignesMarquees?: readonly unknown[]
	readonly onMarquage?: () => void
	readonly onRetraitCanal?: () => void
}

/**
 * Client factice servant les deux tables du §24.1, plus le `PATCH` du §26.4.
 *
 * Le constructeur reproduit la forme réellement employée par `notifications.ts` :
 * `select().order().limit()`, `select(head).is()`, `select().in()` et `update().eq().select()`.
 */
function client(options: Options): ClientCrm {
	const canal = {
		on: () => canal,
		subscribe: (rappel: (statut: string) => void) => {
			rappel('SUBSCRIBED')
			return canal
		},
	}
	return {
		channel: () => canal,
		removeChannel: () => {
			options.onRetraitCanal?.()
			return Promise.resolve('ok')
		},
		from: (table: string) => {
			if (table === 'card_comments') {
				return {
					select: () => ({
						in: () => Promise.resolve({ data: options.commentaires ?? [D1], error: null }),
					}),
				}
			}
			return {
				select: (_colonnes: string, extra?: { head?: boolean }) => {
					if (extra?.head === true) {
						return {
							is: () =>
								Promise.resolve({
									count: options.compte === undefined ? 1 : options.compte,
									error: null,
								}),
						}
					}
					return {
						order: () => ({
							limit: () =>
								Promise.resolve(
									options.erreurLecture === true
										? { data: null, error: { message: 'panne' }, status: 0 }
										: { data: options.notifications ?? [N1], error: null, status: 200 },
								),
						}),
					}
				},
				update: () => ({
					eq: () => ({
						select: () => {
							options.onMarquage?.()
							return Promise.resolve({
								data: options.lignesMarquees ?? [{ id: 'n-1' }],
								error: null,
							})
						},
					}),
				}),
			}
		},
	} as unknown as ClientCrm
}

function monter(options: Options = {}) {
	injecte.client = client(options)
	injecte.session = { statut: 'authentifie', utilisateur: { id: 'p12' } }
	return render(
		<MemoryRouter>
			<ClocheNotifications />
		</MemoryRouter>,
	)
}

describe('l’abonnement partagé (docs/SPEC-notifications.md §25, décision 525)', () => {
	// L'ABONNEMENT SURVIT AU DÉMONTAGE, ET C'EST UN DÉFAUT TROUVÉ PAR LA CAMPAGNE. Chaque route
	// rend sa propre coquille : la cloche est donc démontée et remontée À CHAQUE NAVIGATION, et un
	// canal créé puis retiré à ce rythme faisait fermer la socket avant la fin de sa poignée de
	// main — « WebSocket is closed before the connection is established » dans la console, que le
	// parcours clavier de « Ma journée » a fait paraître. Le remède est à la CAUSE : le canal vit
	// au niveau du module, il n'appartient plus au composant.
	it('ne retire PAS le canal au démontage : la navigation ne paie aucune reconnexion', async () => {
		let retraits = 0
		injecte.client = client({ onRetraitCanal: () => (retraits += 1) })
		injecte.session = { statut: 'authentifie', utilisateur: { id: 'p12' } }
		const rendu = render(
			<MemoryRouter>
				<ClocheNotifications />
			</MemoryRouter>,
		)
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		rendu.unmount()
		expect(retraits).toBe(0)
	})

	// UNE DÉCONNEXION, ELLE, FERME LE CANAL : le laisser ouvert au nom de qui vient de partir
	// délivrerait des événements à une session qui n'existe plus.
	it('ferme le canal quand la session disparaît', async () => {
		let retraits = 0
		injecte.client = client({ onRetraitCanal: () => (retraits += 1) })
		injecte.session = { statut: 'authentifie', utilisateur: { id: 'p12' } }
		const rendu = render(
			<MemoryRouter>
				<ClocheNotifications />
			</MemoryRouter>,
		)
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		injecte.session = { statut: 'anonyme' }
		rendu.rerender(
			<MemoryRouter>
				<ClocheNotifications />
			</MemoryRouter>,
		)
		await waitFor(() => expect(retraits).toBe(1))
	})
})

describe('la cloche (docs/SPEC-notifications.md §26.1, §26.7)', () => {
	// SANS SESSION, RIEN N'EST RENDU (§26.7). Une cloche offerte à un anonyme annoncerait une boîte
	// qu'aucune session ne peut remplir, et son compteur serait un zéro permanent.
	it('ne rend RIEN sans session', () => {
		injecte.client = client({})
		injecte.session = { statut: 'anonyme' }
		render(
			<MemoryRouter>
				<ClocheNotifications />
			</MemoryRouter>,
		)
		expect(screen.queryByTestId('cloche-notifications')).toBeNull()
	})

	// LE NOM ACCESSIBLE PORTE LE COMPTE EXACT : un chiffre dessiné sur une icône n'existe pas pour
	// un lecteur d'écran (§5.43). L'accord se fait par clé — « 1 non lue », jamais « 1 non lues ».
	it('porte le compte EXACT dans son nom accessible, accordé', async () => {
		monter({ compte: 1 })
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Notifications — 1 non lue' })).toBeTruthy(),
		)
		cleanup()
		monter({ compte: 4 })
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Notifications — 4 non lues' })).toBeTruthy(),
		)
	})

	// LA PASTILLE EST ABSENTE À ZÉRO : l'absence dit déjà ce que « 0 » répéterait (§26.1).
	it('ne dessine AUCUNE pastille à zéro', async () => {
		monter({ compte: 0, notifications: [] })
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		expect(screen.queryByTestId('compteur-notifications')).toBeNull()
	})

	// UN COMPTEUR INCONNU NE DESSINE RIEN NON PLUS, et son nom accessible ne prétend pas « aucune » :
	// affirmer sans avoir mesuré serait la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
	it('ne prétend PAS « aucune non lue » quand le compte est inconnu', async () => {
		monter({ compte: null })
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy(),
		)
		expect(screen.queryByTestId('compteur-notifications')).toBeNull()
	})

	// LA BORNE BORNE LE DESSIN, JAMAIS LA MESURE : la pastille écrit « 99+ », le nom accessible
	// garde le compte exact (§26.1, §5.43).
	it('écrit « 99+ » sur la pastille et le compte exact dans le nom accessible', async () => {
		monter({ compte: 132 })
		await waitFor(() => expect(screen.getByTestId('compteur-notifications').textContent).toBe('99+'))
		expect(screen.getByRole('button', { name: 'Notifications — 132 non lues' })).toBeTruthy()
	})
})

describe('le panneau (docs/SPEC-notifications.md §23.2, §26.7)', () => {
	it('est fermé par défaut, et la cloche le dit par aria-expanded', async () => {
		monter()
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		expect(screen.getByTestId('cloche-notifications').getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByTestId('panneau-notifications')).toBeNull()
	})

	it('s’ouvre au clic, et la cloche RESTE rendue', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		expect(screen.getByTestId('panneau-notifications')).toBeTruthy()
		// LA CLOCHE RESTE MONTÉE : elle est l'ancre du panneau et porte son `aria-expanded`. C'est
		// ce qui rend le retour du focus immédiat, sans le report du §5.25 (§5.43).
		expect(screen.getByTestId('cloche-notifications').getAttribute('aria-expanded')).toBe('true')
	})

	// `ÉCHAP` REFERME ET REND LE FOCUS À LA CLOCHE (§5.29 tranche 2 g, §5.43).
	it('se referme par Échap, en rendant le focus à la cloche', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		await utilisateur.keyboard('{Escape}')
		await waitFor(() => expect(screen.queryByTestId('panneau-notifications')).toBeNull())
		expect(document.activeElement).toBe(screen.getByTestId('cloche-notifications'))
	})

	// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION, et son message dit que l'état est SAIN (§26.7).
	it('rend un état vide SANS action', async () => {
		const utilisateur = userEvent.setup()
		monter({ notifications: [], compte: 0 })
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		const vide = await screen.findByTestId('notifications-vide')
		expect(vide.textContent).toContain('Aucune notification.')
		expect(vide.querySelector('button')).toBeNull()
	})

	// L'ERREUR PORTE UNE REPRISE QUI RELIT RÉELLEMENT (§5.8).
	it('rend une erreur avec sa reprise', async () => {
		const utilisateur = userEvent.setup()
		monter({ erreurLecture: true })
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		expect(await screen.findByText('Notifications indisponibles')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
	})
})

describe('la ligne (docs/SPEC-notifications.md §24.3, §26.2)', () => {
	const ouvrir = async () => {
		const utilisateur = userEvent.setup()
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		return utilisateur
	}

	it('rend l’auteur, l’extrait, l’affaire en lien et la pilule', async () => {
		monter()
		await ouvrir()
		expect(await screen.findByText('Camille Aubert vous a mentionné')).toBeTruthy()
		expect(screen.getByTestId('notification-extrait').textContent).toContain(
			'La DSI a confirmé le périmètre',
		)
		const lien = screen.getByTestId('notification-lien')
		expect(lien.getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c1',
		)
		expect(lien.getAttribute('aria-label')).toBe('Ouvrir Refonte du site vitrine')
		expect(screen.getByTestId('notification-pilule').getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes',
		)
	})

	// L'ÉTAT DE LECTURE SE REND PAR LA FORME, jamais par la place (§26.2, §5.43).
	it('marque une ligne non lue, et la distingue d’une ligne lue', async () => {
		monter()
		await ouvrir()
		const ligne = await screen.findByTestId('notification')
		expect(ligne.getAttribute('data-lue')).toBe('non')
		cleanup()
		monter({ notifications: [{ ...N1, read_at: '2026-08-26T17:00:00Z' }] })
		await ouvrir()
		expect((await screen.findByTestId('notification')).getAttribute('data-lue')).toBe('oui')
	})

	// UNE LIGNE DONT LE COMMENTAIRE N'EST PLUS LISIBLE GARDE SA PLACE, sans auteur ni extrait, et
	// NE DIT NI que le propos a été supprimé NI qu'il est illisible (§24.3).
	it('garde la ligne d’un propos illisible, sans auteur ni extrait, et sans le nommer', async () => {
		monter({ commentaires: [] })
		await ouvrir()
		const ligne = await screen.findByTestId('notification')
		expect(ligne.textContent).toContain('Vous avez été mentionné')
		expect(screen.queryByTestId('notification-extrait')).toBeNull()
		expect(ligne.textContent).not.toContain('supprimé')
		expect(ligne.textContent).not.toContain('illisible')
		// Le lien SURVIT : l'affaire reste lisible, c'est ce que la politique garantit.
		expect(screen.getByTestId('notification-lien')).toBeTruthy()
	})

	// L'ORDRE EST CELUI DU SERVEUR — le plus récent en haut —, ET LES NON-LUES NE REMONTENT PAS
	// (§26.2) : un second critère de tri ferait sauter une ligne au moment de son marquage.
	it('conserve l’ordre du serveur, sans faire remonter les non-lues', async () => {
		monter({
			notifications: [
				{ ...N1, id: 'n-recente', read_at: '2026-08-26T17:00:00Z' },
				{ ...N1, id: 'n-ancienne', read_at: null },
			],
		})
		await ouvrir()
		const lignes = await screen.findAllByTestId('notification')
		expect(lignes.map((une) => une.getAttribute('data-lue'))).toEqual(['oui', 'non'])
	})

	// LA TRONCATURE EST ÉCRITE, jamais laissée à deviner (§26.5).
	it('écrit la troncature quand la lecture atteint sa borne', async () => {
		monter({
			notifications: Array.from({ length: 20 }, (_, rang) => ({ ...N1, id: `n-${rang}` })),
		})
		await ouvrir()
		expect((await screen.findByTestId('notifications-tronquee')).textContent).toContain('20')
	})

	it('n’écrit AUCUNE troncature sous la borne', async () => {
		monter()
		await ouvrir()
		await screen.findByTestId('notification')
		expect(screen.queryByTestId('notifications-tronquee')).toBeNull()
	})
})

describe('le marquage (docs/SPEC-notifications.md §26.4)', () => {
	const ouvrir = async () => {
		const utilisateur = userEvent.setup()
		await waitFor(() => expect(screen.getByTestId('cloche-notifications')).toBeTruthy())
		await utilisateur.click(screen.getByTestId('cloche-notifications'))
		return utilisateur
	}

	// DEUX VISAGES, UN SEUL RENDU À LA FOIS, et le MOT porte l'information — le §1 du design system
	// ne laisse jamais une couleur ni une icône la porter seule.
	it('offre « Marquer comme lue » sur une non-lue, et l’inverse sur une lue', async () => {
		monter()
		await ouvrir()
		expect(await screen.findByRole('button', { name: 'Marquer comme lue' })).toBeTruthy()
		cleanup()
		monter({ notifications: [{ ...N1, read_at: '2026-08-26T17:00:00Z' }] })
		await ouvrir()
		expect(await screen.findByRole('button', { name: 'Marquer comme non lue' })).toBeTruthy()
	})

	// LE GESTE EST SON PROPRE BOUTON : le clic sur le LIEN ne marque rien (§26.4, §5.43).
	it('ne marque RIEN au clic sur le lien de l’affaire', async () => {
		let marquages = 0
		const utilisateur = await (async () => {
			monter({ onMarquage: () => (marquages += 1) })
			return await ouvrir()
		})()
		await utilisateur.click(await screen.findByTestId('notification-lien'))
		expect(marquages).toBe(0)
	})

	it('appelle le serveur au clic sur le bouton de marquage', async () => {
		let marquages = 0
		monter({ onMarquage: () => (marquages += 1) })
		const utilisateur = await ouvrir()
		await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme lue' }))
		await waitFor(() => expect(marquages).toBe(1))
	})

	// L'ISSUE « SANS EFFET » EST DITE, et elle n'affirme NI le refus NI la disparition (§26.4,
	// §5.40). Un `PATCH` filtré par la clause `USING` rend `204` sans erreur.
	it('dit « aucune notification n’a été modifiée » sur zéro ligne rendue', async () => {
		monter({ lignesMarquees: [] })
		const utilisateur = await ouvrir()
		await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme lue' }))
		const message = await screen.findByTestId('message-marquage')
		expect(message.textContent).toContain('Aucune notification n’a été modifiée')
		expect(message.getAttribute('role')).toBe('alert')
	})

	// SUR UN SUCCÈS, AUCUN MESSAGE : la ligne porte son nouvel état, et elle EST la confirmation
	// (§5.7 ter du design system, repris au §5.28).
	it('n’écrit AUCUN message sur un succès', async () => {
		monter()
		const utilisateur = await ouvrir()
		await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme lue' }))
		await waitFor(() => expect(screen.queryByTestId('message-marquage')).toBeNull())
	})
})
