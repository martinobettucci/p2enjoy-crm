// @verifies CRM-044 (docs/BACKLOG.md) — rendu réel de la timeline unifiée
// @verifies CRM-043 (docs/BACKLOG.md) — le fil des commentaires, repris par cette unité
// @verifies docs/SPEC-cards.md §14.10 (ce que le fil unifié montre), §14.6 (aucun libellé dans le
//           `payload`), §13.4 (la pierre tombale garde sa place), §13.5 (mention « modifié »),
//           §13.6 (le refus vient du backend), §13.9 (recharger à l'abonnement), §13.10 (ce que
//           le panneau montre)
// @verifies docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée), §5.10 (panneau de commentaires),
//           §5.8 (états systématiques), §8 (libellé de formulaire, état désactivé lisible),
//           §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et l'interrogent par ses rôles accessibles. Ils existent
// parce que le fil chargé ne peut être vu nulle part ailleurs : la webapp est un appelant anonyme
// faute d'écran de connexion (INC-021), et son E2E n'obtient donc jamais de commentaire — le
// procédé est celui endossé par docs/DESIGN_SYSTEM.md §12.5.
//
// Ce qu'ils ne prouvent PAS, et qui reste dû : qu'un utilisateur connecté publie réellement un
// commentaire depuis l'écran. C'est INC-021, et c'est nommé dans docs/BACKLOG.md.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PanneauTimeline } from './PanneauTimeline'
import { fr } from '../i18n'
import type { CommentaireLu } from '../lib/commentaires'
import type { ClientCrm } from '../lib/supabase'
import type { EvenementLu } from '../lib/timeline'

afterEach(cleanup)

function ligne(partiel: Partial<CommentaireLu> & { id: string }): CommentaireLu {
	return {
		card_id: 'card-1',
		author_id: 'profil-1',
		body: 'Un commentaire.',
		created_at: '2026-08-05T10:00:00.000Z',
		edited_at: null,
		deleted_at: null,
		...partiel,
	}
}

function evenement(partiel: Partial<EvenementLu> & { id: string }): EvenementLu {
	return {
		card_id: 'card-1',
		type: 'created',
		actor_id: null,
		payload: {},
		created_at: '2026-08-05T09:00:00.000Z',
		...partiel,
	}
}

type Journal = {
	/** Statuts successifs rendus à l'abonné, dans l'ordre. */
	readonly evenements: string[]
	/** Nombre de lectures réellement émises. */
	nbLectures: number
	/** Dernière charge d'insertion. */
	charge?: Record<string, unknown>
	/** Rappel enregistré par `on('postgres_changes', …)`, pour simuler un événement. */
	notifier?: () => void
}

/**
 * Client factice : il rend les commentaires voulus, enregistre l'ordre des gestes, et permet de
 * **provoquer** un événement de temps réel.
 *
 * Le statut d'abonnement est paramétrable, parce que la règle du §13.9 en dépend : la lecture est
 * déclenchée par l'abonnement, et un abonnement en échec doit malgré tout charger le fil.
 */
function clientFactice({
	lignes = [],
	evenements = [],
	etapes = [],
	statutCanal = 'SUBSCRIBED',
	insertion = { error: null, status: 201 },
	lecture = { error: null as { message: string; code?: string } | null, status: 200 },
}: {
	lignes?: readonly CommentaireLu[]
	evenements?: readonly EvenementLu[]
	etapes?: readonly { id: string; workflow_nodes_catalog: { label: string } | null }[]
	statutCanal?: string
	insertion?: { error: { message: string; code?: string } | null; status: number }
	lecture?: { error: { message: string; code?: string } | null; status: number }
} = {}): { client: ClientCrm; journal: Journal } {
	const journal: Journal = { evenements: [], nbLectures: 0 }

	// LE CLIENT DISTINGUE LES TABLES, et il le doit : le panneau lit désormais TROIS sources —
	// les commentaires, les événements et les étapes du workflow. Un client qui rendrait la même
	// réponse à toutes projetterait des commentaires en événements, et le test serait vert sur un
	// produit faux.
	const chaineDe = (donnees: readonly unknown[], compter: boolean) => {
		const chaine = {
			eq: () => chaine,
			order: () => chaine,
			then: (resoudre: (valeur: unknown) => unknown) => {
				if (compter) journal.nbLectures += 1
				return Promise.resolve({
					data: compter && lecture.error !== null ? null : [...donnees],
					error: compter ? lecture.error : null,
					status: compter ? lecture.status : 200,
				}).then(resoudre)
			},
		}
		return chaine
	}

	const canal = {
		on: (_type: string, _filtre: unknown, rappel: () => void) => {
			journal.notifier = rappel
			return canal
		},
		subscribe: (rappel: (statut: string) => void) => {
			journal.evenements.push(statutCanal)
			rappel(statutCanal)
			return canal
		},
	}

	const client = {
		from: (table: string) => ({
			select: () =>
				table === 'card_comments'
					? chaineDe(lignes, true)
					: table === 'card_events'
						? chaineDe(evenements, false)
						: chaineDe(etapes, false),
			insert: (charge: Record<string, unknown>) => {
				journal.charge = charge
				return Promise.resolve(insertion)
			},
		}),
		channel: () => canal,
		removeChannel: () => Promise.resolve('ok'),
	} as unknown as ClientCrm

	return { client, journal }
}

function monter(options: Parameters<typeof clientFactice>[0] = {}) {
	const { client, journal } = clientFactice(options)
	render(
		<PanneauTimeline
			client={client}
			idCard="card-1"
			idWorkspace="ws-1"
			idWorkflow="wf-1"
			libellesChamps={new Map([['champ-1', 'Budget']])}
		/>,
	)
	return journal
}

describe('le fil (docs/DESIGN_SYSTEM.md §5.10)', () => {
	it('rend les commentaires du plus ancien au plus récent', async () => {
		monter({
			lignes: [
				ligne({ id: 'b', body: 'Second', created_at: '2026-08-05T11:00:00.000Z' }),
				ligne({ id: 'a', body: 'Premier', created_at: '2026-08-05T10:00:00.000Z' }),
			],
		})
		const articles = await screen.findAllByRole('article')
		expect(articles).toHaveLength(2)
		expect(articles[0]?.textContent).toContain('Premier')
		expect(articles[1]?.textContent).toContain('Second')
	})

	it('rend un commentaire supprimé À SA PLACE, réduit à sa mention', async () => {
		monter({
			lignes: [
				ligne({ id: 'a', body: 'Vivant', created_at: '2026-08-05T10:00:00.000Z' }),
				ligne({
					id: 'b',
					body: '',
					deleted_at: '2026-08-05T11:00:00.000Z',
					created_at: '2026-08-05T11:00:00.000Z',
				}),
			],
		})
		const articles = await screen.findAllByRole('article')
		// Le masquer ferait disparaître un tour de parole d'une conversation (§13.4).
		expect(articles).toHaveLength(2)
		expect(articles[1]?.textContent).toContain(fr['comments.deleted'])
	})

	it('porte la mention « modifié », et la date de modification en infobulle', async () => {
		monter({ lignes: [ligne({ id: 'a', edited_at: '2026-08-05T12:00:00.000Z' })] })
		const article = await screen.findByRole('article')
		const mention = within(article).getByText(fr['comments.edited'])
		expect(mention.getAttribute('title')).toContain(fr['comments.edited.title'])
	})

	it('ne porte AUCUNE mention « modifié » sur un commentaire intact', async () => {
		monter({ lignes: [ligne({ id: 'a' })] })
		await screen.findByRole('article')
		expect(screen.queryByText(fr['comments.edited'])).toBeNull()
	})

	// INC-014 : `profiles` n'est lisible par aucun jeton d'utilisateur. La règle du §12.5 du design
	// system s'applique — une donnée illisible n'est PAS rendue, plutôt que rendue vide.
	it('n’affiche AUCUN nom ni identifiant d’auteur', async () => {
		monter({ lignes: [ligne({ id: 'a', author_id: 'profil-secret' })] })
		const article = await screen.findByRole('article')
		expect(article.textContent).not.toContain('profil-secret')
	})

	it('affiche l’état vide quand le fil est vide, jamais un panneau muet', async () => {
		monter({ lignes: [] })
		expect(await screen.findByText(fr['comments.empty.title'])).not.toBeNull()
	})

	it('affiche un état d’erreur avec reprise quand la lecture échoue', async () => {
		monter({ lecture: { error: { message: 'boum' }, status: 500 } })
		expect(await screen.findByText(fr['comments.error.title'])).not.toBeNull()
		expect(screen.getByRole('button', { name: fr['state.error.retry'] })).not.toBeNull()
	})
})

describe('le temps réel (§13.9)', () => {
	// Décision 195 : la lecture est déclenchée par l'abonnement, jamais avant. Une insertion émise
	// juste après `SUBSCRIBED` a été reçue dans les quatre délais mesurés, mais une première sonde
	// ne l'a pas été — cas non reproduit, donc non expliqué.
	it('charge le fil APRÈS l’abonnement, et une seule fois', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a' })] })
		await screen.findByRole('article')
		expect(journal.evenements).toEqual(['SUBSCRIBED'])
		expect(journal.nbLectures).toBe(1)
	})

	// Un abonnement en échec ne doit pas laisser un panneau muet : le fil est chargé quand même, et
	// l'utilisateur garde l'action de rechargement.
	it('charge le fil MÊME quand l’abonnement échoue', async () => {
		monter({ lignes: [ligne({ id: 'a' })], statutCanal: 'CHANNEL_ERROR' })
		expect(await screen.findByRole('article')).not.toBeNull()
	})

	// Décision 201 : le flux DÉCLENCHE la lecture, il ne la remplace pas. Un événement ne porte pas
	// le fil — il dit qu'il a changé.
	it('relit le fil à chaque événement reçu, plutôt que de fusionner une charge', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a' })] })
		await screen.findByRole('article')
		expect(journal.nbLectures).toBe(1)
		journal.notifier?.()
		await waitFor(() => expect(journal.nbLectures).toBe(2))
	})
})

describe('le composeur (§13.10)', () => {
	it('est TOUJOURS rendu : l’interface ne calcule aucun droit d’écriture', async () => {
		monter({ lignes: [] })
		expect(await screen.findByLabelText(fr['comments.compose.label'])).not.toBeNull()
		expect(screen.getByRole('button', { name: fr['comments.compose.submit'] })).not.toBeNull()
	})

	it('désactive la publication tant que le champ est vide ou blanc', async () => {
		const utilisateur = userEvent.setup()
		monter({ lignes: [] })
		const bouton = await screen.findByRole('button', { name: fr['comments.compose.submit'] })
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		await utilisateur.type(screen.getByLabelText(fr['comments.compose.label']), '   ')
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		await utilisateur.type(screen.getByLabelText(fr['comments.compose.label']), 'Bonjour')
		expect((bouton as HTMLButtonElement).disabled).toBe(false)
	})

	it('publie sans envoyer `author_id`, et vide le champ en cas de succès', async () => {
		const utilisateur = userEvent.setup()
		const journal = monter({ lignes: [] })
		const champ = await screen.findByLabelText(fr['comments.compose.label'])
		await utilisateur.type(champ, 'Bonjour')
		await utilisateur.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))

		await waitFor(() => expect(journal.charge).toBeDefined())
		expect(journal.charge).toEqual({ card_id: 'card-1', workspace_id: 'ws-1', body: 'Bonjour' })
		await waitFor(() => expect((champ as HTMLTextAreaElement).value).toBe(''))
	})

	// LE TEXTE SAISI EST CONSERVÉ (§5.10) : le vider ferait perdre à l'utilisateur un texte pour
	// une erreur qui n'est pas la sienne.
	it('affiche le refus du backend ET CONSERVE le texte saisi', async () => {
		const utilisateur = userEvent.setup()
		monter({ lignes: [], insertion: { error: { message: 'refusé', code: '42501' }, status: 403 } })
		const champ = await screen.findByLabelText(fr['comments.compose.label'])
		await utilisateur.type(champ, 'Un texte auquel je tiens')
		await utilisateur.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))

		expect((await screen.findByRole('alert')).textContent).toContain(fr['comments.refus.forbidden'])
		expect((champ as HTMLTextAreaElement).value).toBe('Un texte auquel je tiens')
	})

	it('distingue le refus du `CHECK` du refus d’autorisation', async () => {
		const utilisateur = userEvent.setup()
		monter({ lignes: [], insertion: { error: { message: 'trop long', code: '23514' }, status: 400 } })
		await utilisateur.type(await screen.findByLabelText(fr['comments.compose.label']), 'x')
		await utilisateur.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))
		expect((await screen.findByRole('alert')).textContent).toContain(fr['comments.refus.invalide'])
	})

	it('publie au CLAVIER, sans aucune souris', async () => {
		const utilisateur = userEvent.setup()
		const journal = monter({ lignes: [] })
		const champ = await screen.findByLabelText(fr['comments.compose.label'])
		champ.focus()
		await utilisateur.keyboard('Au clavier')
		await utilisateur.tab()
		await utilisateur.keyboard('{Enter}')
		await waitFor(() => expect(journal.charge?.['body']).toBe('Au clavier'))
	})
})

describe('le fil unifié (docs/DESIGN_SYSTEM.md §5.11)', () => {
	it('range les événements et les commentaires dans un seul fil, du plus ancien au plus récent', async () => {
		monter({
			lignes: [ligne({ id: 'c', body: 'Une parole', created_at: '2026-08-05T10:00:00.000Z' })],
			evenements: [
				evenement({ id: 'e1', type: 'created', created_at: '2026-08-05T09:00:00.000Z' }),
				evenement({ id: 'e2', type: 'archived', created_at: '2026-08-05T11:00:00.000Z' }),
			],
		})

		const elements = await screen.findAllByRole('listitem')
		expect(elements).toHaveLength(3)
		expect(elements[0]?.textContent).toContain(fr['timeline.event.created'])
		expect(elements[1]?.textContent).toContain('Une parole')
		expect(elements[2]?.textContent).toContain(fr['timeline.event.archived'])
	})

	it('résout le libellé d’une étape franchie, sans jamais le lire dans le payload', async () => {
		monter({
			evenements: [
				evenement({
					id: 'e1',
					type: 'moved',
					payload: { from_step_id: 's1', to_step_id: 's2' },
				}),
			],
			etapes: [
				{ id: 's1', workflow_nodes_catalog: { label: 'Qualification' } },
				{ id: 's2', workflow_nodes_catalog: { label: 'Relance' } },
			],
		})

		await waitFor(() => {
			expect(screen.getByText(/Qualification → Relance/)).not.toBeNull()
		})
	})

	// §5.11 : un libellé non résolu n'est PAS une phrase tronquée. La ligne montre le libellé
	// générique de son type, et aucune concaténation ne produit d'`undefined` à l'écran.
	it('se replie sur le libellé générique quand une étape est introuvable', async () => {
		monter({
			evenements: [
				evenement({ id: 'e1', type: 'moved', payload: { from_step_id: 's1', to_step_id: 's9' } }),
			],
			etapes: [{ id: 's1', workflow_nodes_catalog: { label: 'Qualification' } }],
		})

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.moved'])).not.toBeNull()
		})
		expect(screen.queryByText(/Qualification/)).toBeNull()
		expect(screen.queryByText(/undefined/)).toBeNull()
	})

	it('nomme le champ d’un événement de valeur, d’après les libellés déjà chargés', async () => {
		monter({
			evenements: [
				evenement({ id: 'e1', type: 'field_changed', payload: { field_id: 'champ-1', to: 1 } }),
			],
		})

		await waitFor(() => {
			expect(screen.getByText('Budget')).not.toBeNull()
		})
	})

	// Le repli d'un type inconnu est DOCUMENTÉ : une mémoire ne cache pas ce qu'elle ne comprend
	// pas. Le jour où `CRM-054` écrira `mail_received`, le fil le montrera.
	it('montre un type inconnu plutôt que de le faire disparaître', async () => {
		monter({ evenements: [evenement({ id: 'e1', type: 'mail_received' })] })

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.unknown'])).not.toBeNull()
		})
	})

	it('n’affiche AUCUN identifiant d’acteur (INC-014)', async () => {
		monter({
			evenements: [evenement({ id: 'e1', actor_id: '5eed0000-0000-4000-8000-000000000011' })],
		})

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.created'])).not.toBeNull()
		})
		expect(screen.queryByText(/5eed0000/)).toBeNull()
	})
})

describe('les filtres (docs/DESIGN_SYSTEM.md §5.11)', () => {
	it('rend quatre bascules, toutes actives, dont le compte suit la SOURCE et non le filtre', async () => {
		monter({
			lignes: [ligne({ id: 'c' })],
			evenements: [
				evenement({ id: 'e1', type: 'created' }),
				evenement({ id: 'e2', type: 'moved' }),
			],
		})

		// La barre n'existe qu'une fois le fil chargé : elle n'a rien à filtrer avant (décision 212).
		const barre = await screen.findByRole('group', { name: fr['timeline.filters.aria'] })
		const bascules = within(barre).getAllByRole('button')
		expect(bascules).toHaveLength(4)
		for (const bascule of bascules) expect(bascule.getAttribute('aria-pressed')).toBe('true')

		await waitFor(() => {
			expect(within(barre).getByRole('button', { name: /Étapes/ }).textContent).toContain('1')
		})

		// Le compte ne bouge pas quand la famille est éteinte : il compte ce que la source porte.
		await userEvent.click(within(barre).getByRole('button', { name: /Étapes/ }))
		expect(within(barre).getByRole('button', { name: /Étapes/ }).textContent).toContain('1')
	})

	it('filtrer masque sans jamais relire : aucune requête supplémentaire n’est émise', async () => {
		const journal = monter({
			lignes: [ligne({ id: 'c', body: 'Une parole' })],
			evenements: [evenement({ id: 'e1', type: 'moved' })],
		})

		await screen.findByText('Une parole')
		const lecturesAvant = journal.nbLectures

		await userEvent.click(screen.getByRole('button', { name: /Discussion/ }))

		expect(screen.queryByText('Une parole')).toBeNull()
		expect(screen.getByText(fr['timeline.event.moved'])).not.toBeNull()
		expect(journal.nbLectures).toBe(lecturesAvant)
	})

	// DEUX VIDES DISTINCTS : les confondre ferait passer un filtre trop restrictif pour une
	// affaire sans histoire.
	it('distingue « aucun événement » de « aucun élément pour ces filtres »', async () => {
		monter({ evenements: [evenement({ id: 'e1', type: 'moved' })] })
		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.moved'])).not.toBeNull()
		})

		for (const nom of [/Discussion/, /Étapes/, /Champs/, /Cycle de vie/]) {
			await userEvent.click(screen.getByRole('button', { name: nom }))
		}
		expect(screen.getByText(fr['timeline.filtered.title'])).not.toBeNull()

		cleanup()
		monter({})
		await waitFor(() => {
			expect(screen.getByText(fr['comments.empty.title'])).not.toBeNull()
		})
	})

	// `CLAUDE.md` §11 : aucune donnée n'est écrite sur l'appareil, pas même une préférence
	// d'interface. Le filtre repart complet à chaque ouverture.
	it('n’écrit aucune préférence sur l’appareil', async () => {
		monter({ evenements: [evenement({ id: 'e1', type: 'moved' })] })
		await userEvent.click(await screen.findByRole('button', { name: /Étapes/ }))

		expect(window.localStorage.length).toBe(0)
		expect(window.sessionStorage.length).toBe(0)
	})
})
