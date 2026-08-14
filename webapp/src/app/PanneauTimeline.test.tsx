// @verifies CRM-044 (docs/BACKLOG.md) — rendu réel de la timeline unifiée
// @verifies CRM-043 (docs/BACKLOG.md) — le fil des commentaires, repris par cette unité
// @verifies CRM-022 (docs/BACKLOG.md) — auteurs et acteurs nommés
// @verifies docs/SPEC-cards.md §14.10 (ce que le fil unifié montre), §14.6 (aucun libellé dans le
//           `payload`), §13.4 (la pierre tombale garde sa place), §13.5 (mention « modifié »),
//           §13.6 (le refus vient du backend), §13.9 (recharger à l'abonnement), §13.10 (ce que
//           le panneau montre)
// @verifies docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée), §5.10 (panneau de commentaires),
//           §5.8 (états systématiques), §8 (libellé de formulaire, état désactivé lisible),
//           §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et isolent les formes du fil et ses refus par leurs rôles
// accessibles. La publication connectée réelle et le refus du `viewer` sont prouvés en complément
// par `e2e/ui/authentification.spec.ts`.

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
		deleted_by: null,
		auteur: null,
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
		acteur: null,
		...partiel,
	}
}

type Journal = {
	/** Statuts successifs rendus à l'abonné, dans l'ordre. */
	readonly evenements: string[]
	/** Nombre de lectures réellement émises. */
	nbLectures: number
	/** Nombre d'abonnements ouverts, et nombre de canaux retirés — décision 315. */
	nbAbonnements: number
	nbRetraits: number
	/** Déblocage des lectures retenues, par rang — voir `lecturesRetenues`. */
	readonly liberer: Map<number, () => void>
	/** Dernière charge d'insertion. */
	charge?: Record<string, unknown>
	/** Dernière charge de mise à jour — les gestes d'auteur du §5.10. */
	miseAJour?: Record<string, unknown>
	/** Identifiant ciblé par le `eq('id', …)` de la mise à jour. */
	cible?: string
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
	miseAJour = {
		error: null as { message: string; code?: string } | null,
		status: 200,
		data: [{ id: 'a' }] as readonly { id: string }[],
	},
	lecturesRetenues = [] as readonly number[],
	lignesParRang = {} as Readonly<Record<number, readonly CommentaireLu[]>>,
}: {
	lignes?: readonly CommentaireLu[]
	evenements?: readonly EvenementLu[]
	etapes?: readonly { id: string; workflow_nodes_catalog: { label: string } | null }[]
	statutCanal?: string
	insertion?: { error: { message: string; code?: string } | null; status: number }
	lecture?: { error: { message: string; code?: string } | null; status: number }
	miseAJour?: {
		error: { message: string; code?: string } | null
		status: number
		data?: readonly { id: string }[]
	}
	/**
	 * Rangs des lectures **retenues** au lieu de répondre, libérées à la demande par le test.
	 *
	 * Sans ce levier, aucune assertion ne peut se placer PENDANT une relecture, et deux faits
	 * mesurés par la décision 315 resteraient invisibles : le vidage du fil, qui ne dure que le
	 * temps d'un aller-retour, et le croisement de deux lectures.
	 */
	lecturesRetenues?: readonly number[]
	/** Réponse propre à une lecture donnée, pour distinguer deux lectures qui se croisent. */
	lignesParRang?: Readonly<Record<number, readonly CommentaireLu[]>>
} = {}): { client: ClientCrm; journal: Journal } {
	const journal: Journal = {
		evenements: [],
		nbLectures: 0,
		nbAbonnements: 0,
		nbRetraits: 0,
		liberer: new Map(),
	}

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
				const rang = journal.nbLectures
				const rendues = compter ? (lignesParRang[rang] ?? donnees) : donnees
				const reponse = {
					data: compter && lecture.error !== null ? null : [...rendues],
					error: compter ? lecture.error : null,
					status: compter ? lecture.status : 200,
				}
				if (compter && lecturesRetenues.includes(rang)) {
					return new Promise((livrer) => {
						journal.liberer.set(rang, () => livrer(reponse))
					}).then(resoudre)
				}
				return Promise.resolve(reponse).then(resoudre)
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
			journal.nbAbonnements += 1
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
			// `update(...).eq(...).select(...)` : la forme EXACTE que la bibliothèque emploie. Le
			// `select` final n'est pas décoratif — sans lui, PostgREST ne rend aucun corps et le
			// filtrage silencieux du `USING` serait indiscernable d'une modification.
			update: (charge: Record<string, unknown>) => {
				journal.miseAJour = charge
				const chaine = {
					eq: (_colonne: string, valeur: string) => {
						journal.cible = valeur
						return chaine
					},
					select: () =>
						Promise.resolve({
							data: miseAJour.error === null ? [...(miseAJour.data ?? [])] : null,
							error: miseAJour.error,
							status: miseAJour.status,
						}),
				}
				return chaine
			},
		}),
		channel: () => canal,
		removeChannel: () => {
			journal.nbRetraits += 1
			return Promise.resolve('ok')
		},
	} as unknown as ClientCrm

	return { client, journal }
}

function monter(
	options: Parameters<typeof clientFactice>[0] = {},
	idUtilisateur: string | null = null,
	// Par défaut, l'appelant n'est PAS administrateur : les scénarios existants mesurent alors
	// exactement ce qu'ils mesuraient avant que la modération n'existe.
	estAdminWorkspace = false,
) {
	const { client, journal } = clientFactice(options)
	render(
		<PanneauTimeline
			client={client}
			idCard="card-1"
			idWorkspace="ws-1"
			idWorkflow="wf-1"
			libellesChamps={new Map([['champ-1', 'Budget']])}
			idUtilisateur={idUtilisateur}
			estAdminWorkspace={estAdminWorkspace}
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

	it('affiche le nom et l’avatar embarqués de l’auteur, jamais son identifiant', async () => {
		monter({
			lignes: [
				ligne({
					id: 'a',
					author_id: 'profil-secret',
					auteur: {
						id: 'profil-secret',
						full_name: 'Camille Aubert',
						avatar_url: '/avatars/camille-aubert.svg',
					},
				}),
			],
		})
		const article = await screen.findByRole('article')
		expect(within(article).getByText('Camille Aubert')).toBeDefined()
		expect(within(article).getByTestId('avatar')).toBeDefined()
		expect(article.textContent).not.toContain('profil-secret')
	})

	it('nomme « Compte supprimé » quand la FK auteur a été détachée', async () => {
		monter({ lignes: [ligne({ id: 'a', author_id: null, auteur: null })] })
		const article = await screen.findByRole('article')
		expect(article.textContent).toContain(fr['comments.author.deleted'])
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

	// =============================================================================================
	// Décision 315 — une relecture n'est ni une reprise, ni une reconnexion
	// =============================================================================================
	//
	// DÉFAUT VU SUR UNE CAPTURE, pas à la lecture : `docs/captures/CRM-043/commentaire-supprime-…`
	// montrait un fil **entièrement vide** — « Discussion 0 », aucun événement — juste après une
	// suppression pourtant réussie. Toute la conversation disparaissait le temps de l'aller-retour,
	// parce que la relecture repassait par l'état de chargement ET recréait le canal.

	it('ne vide PAS le fil pendant la relecture qui suit une publication', async () => {
		const journal = monter({
			lignes: [ligne({ id: 'a', body: 'Déjà dit.' })],
			lecturesRetenues: [2],
		})
		await screen.findByText('Déjà dit.')

		await userEvent.type(screen.getByLabelText(fr['comments.compose.label']), 'Suite')
		await userEvent.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))

		// La seconde lecture est RETENUE : l'assertion se place donc pendant l'aller-retour, à
		// l'instant exact où le défaut se voyait.
		await waitFor(() => expect(journal.nbLectures).toBe(2))
		expect(screen.getByText('Déjà dit.')).not.toBeNull()

		journal.liberer.get(2)?.()
		await waitFor(() => expect(screen.getByText('Déjà dit.')).not.toBeNull())
	})

	// DEUXIÈME DÉFAUT DE LA MÊME DÉCISION, trouvé en rejouant la preuve d'interface complète : un
	// commentaire supprimé RÉAPPARAISSAIT. Deux lectures étaient en vol — celle de l'événement de
	// publication, celle du geste de suppression —, et la plus ancienne revenait en dernier.
	it('une lecture plus ANCIENNE n’écrase jamais une lecture plus récente', async () => {
		const journal = monter({
			lignes: [ligne({ id: 'a', body: 'Périmé.' })],
			lecturesRetenues: [2],
			lignesParRang: { 3: [ligne({ id: 'a', body: 'À jour.' })] },
		})
		await screen.findByText('Périmé.')

		// Deux relectures se croisent : la 2ᵉ est retenue, la 3ᵉ répond tout de suite.
		journal.notifier?.()
		await waitFor(() => expect(journal.nbLectures).toBe(2))
		journal.notifier?.()
		await screen.findByText('À jour.')

		// La lecture périmée revient EN DERNIER, et ne doit rien écraser.
		journal.liberer.get(2)?.()
		await waitFor(() => expect(screen.getByText('À jour.')).not.toBeNull())
		expect(screen.queryByText('Périmé.')).toBeNull()
	})

	it('ne DÉFAIT PAS l’abonnement pour relire', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a' })] })
		await screen.findByRole('article')
		expect(journal.nbAbonnements).toBe(1)

		await userEvent.type(screen.getByLabelText(fr['comments.compose.label']), 'Suite')
		await userEvent.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))
		await waitFor(() => expect(journal.nbLectures).toBe(2))

		// Recréer le canal ferait payer une reconnexion pour une relecture, et laisserait une
		// fenêtre sans abonnement à l'instant précis où le fil change.
		expect(journal.nbAbonnements).toBe(1)
		expect(journal.nbRetraits).toBe(0)
	})

	// La reprise explicite, elle, refait TOUT : une erreur peut venir du canal autant que de la
	// requête, et une reprise qui ne rejouerait que la lecture laisserait le panneau sans mise à
	// jour automatique sans que rien ne le dise.
	it('la reprise après erreur RÉABONNE, là où la relecture ne le fait pas', async () => {
		const journal = monter({
			lignes: [ligne({ id: 'a' })],
			lecture: { error: { message: 'boom' }, status: 500 },
		})
		await screen.findByText(fr['comments.error.title'])
		expect(journal.nbAbonnements).toBe(1)

		await userEvent.click(screen.getByRole('button', { name: fr['state.error.retry'] }))
		await waitFor(() => expect(journal.nbAbonnements).toBe(2))
		expect(journal.nbRetraits).toBe(1)
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

	// Décision 315 : « Publier » devient DÉSACTIVÉ dès que le brouillon est vidé, et le navigateur
	// rend alors le focus au `body`. Publier au clavier renvoyait donc l'utilisateur en haut du
	// document. Le champ qu'il vient de quitter est le seul endroit sensé (§8).
	it('rend le focus au champ après une publication réussie', async () => {
		const utilisateur = userEvent.setup()
		monter({ lignes: [] })
		const champ = await screen.findByLabelText(fr['comments.compose.label'])
		await utilisateur.type(champ, 'Bonjour')
		await utilisateur.click(screen.getByRole('button', { name: fr['comments.compose.submit'] }))

		await waitFor(() => expect(document.activeElement).toBe(champ))
	})

	// Le pendant du cas précédent : sur un refus, le texte reste ET le bouton reste actif, donc le
	// focus n'est pas perdu. Le déplacer d'autorité éloignerait l'utilisateur du message d'erreur.
	it('ne déplace PAS le focus quand la publication est refusée', async () => {
		const utilisateur = userEvent.setup()
		monter({ lignes: [], insertion: { error: { message: 'refusé', code: '42501' }, status: 403 } })
		const champ = await screen.findByLabelText(fr['comments.compose.label'])
		await utilisateur.type(champ, 'Un texte auquel je tiens')
		const bouton = screen.getByRole('button', { name: fr['comments.compose.submit'] })
		await utilisateur.click(bouton)

		await screen.findByText(fr['comments.refus.forbidden'])
		expect(document.activeElement).toBe(bouton)
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

	it('nomme les changements de dossier et de workflow sans exposer leurs UUID', async () => {
		monter({
			evenements: [
				evenement({
					id: 'e-channel',
					type: 'channel_changed',
					payload: { from_channel_id: 'channel-secret-a', to_channel_id: 'channel-secret-b' },
				}),
				evenement({
					id: 'e-workflow',
					type: 'workflow_changed',
					payload: { from_workflow_id: 'workflow-secret-a', to_workflow_id: 'workflow-secret-b' },
				}),
			],
		})

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.channel_changed'])).not.toBeNull()
			expect(screen.getByText(fr['timeline.event.workflow_changed'])).not.toBeNull()
		})
		expect(screen.queryByText(/secret/)).toBeNull()
	})

	// Le repli d'un type inconnu est DOCUMENTÉ : une mémoire ne cache pas ce qu'elle ne comprend
	// pas. Le jour où `CRM-054` écrira `mail_received`, le fil le montrera.
	// RÉVISÉ PAR `CRM-057` : le témoin était `mail_received`, qui est devenu un type CONNU et porte
	// désormais son propre libellé. Continuer à s'en servir aurait mesuré le contraire de ce que le
	// test dit mesurer. Le témoin est donc un type que le produit n'a pas encore livré.
	it('montre un type inconnu plutôt que de le faire disparaître', async () => {
		monter({ evenements: [evenement({ id: 'e1', type: 'mail_sent' })] })

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.unknown'])).not.toBeNull()
		})
	})

	// `CRM-057` §18.6 — le courrier reçu n'est plus un événement anonyme : il porte son libellé.
	it('nomme le courrier reçu au lieu de le montrer sans détail', async () => {
		monter({ evenements: [evenement({ id: 'e1', type: 'mail_received' })] })

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.mail_received'])).not.toBeNull()
		})
	})

	it('nomme l’acteur embarqué et n’affiche jamais son identifiant', async () => {
		monter({
			evenements: [
				evenement({
					id: 'e1',
					actor_id: '5eed0000-0000-4000-8000-000000000011',
					acteur: {
						id: '5eed0000-0000-4000-8000-000000000011',
						full_name: 'Camille Aubert',
						avatar_url: '/avatars/camille-aubert.svg',
					},
				}),
			],
		})

		await waitFor(() => {
			expect(screen.getByText(fr['timeline.event.created'])).not.toBeNull()
		})
		expect(screen.getByText('par Camille Aubert')).toBeDefined()
		expect(screen.queryByText(/5eed0000/)).toBeNull()
	})
})

describe('les filtres (docs/DESIGN_SYSTEM.md §5.11)', () => {
	it('rend cinq bascules, toutes actives, dont le compte suit la SOURCE et non le filtre', async () => {
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
		expect(bascules).toHaveLength(5)
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

		for (const nom of [/Discussion/, /Étapes/, /Champs/, /Organisation/, /Cycle de vie/]) {
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

// =================================================================================================
// Les deux gestes de l'auteur — docs/DESIGN_SYSTEM.md §5.10, docs/SPEC-cards.md §13.4 et §13.5
// =================================================================================================
//
// `CRM-043` avait écarté ces boutons faute de session : « un bouton offert à tous, qui échouerait
// pour tous sauf l'auteur, serait une aide d'interface trompeuse ». Le motif a disparu avec
// INC-021, et ces cas éprouvent ce qui le remplace.

describe('les gestes de l’auteur (docs/DESIGN_SYSTEM.md §5.10)', () => {
	it('n’offre aucun geste sur le commentaire d’autrui', async () => {
		monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, 'profil-2')
		await screen.findByText('Un commentaire.')

		expect(screen.queryByRole('button', { name: fr['comments.action.edit'] })).toBeNull()
		expect(screen.queryByRole('button', { name: fr['comments.action.delete'] })).toBeNull()
	})

	it('n’offre aucun geste hors session', async () => {
		monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, null)
		await screen.findByText('Un commentaire.')

		expect(screen.queryByRole('button', { name: fr['comments.action.edit'] })).toBeNull()
	})

	// Une pierre tombale est définitive (docs/SPEC-cards.md §13.4) : le trigger refuse toute
	// écriture ultérieure, et proposer le geste serait une commande morte.
	it('n’offre aucun geste sur son propre commentaire déjà supprimé', async () => {
		monter(
			{
				lignes: [
					ligne({ id: 'a', author_id: 'profil-1', body: '', deleted_at: '2026-08-05T12:00:00.000Z' }),
				],
			},
			'profil-1',
		)
		await screen.findByText(fr['comments.deleted'])

		expect(screen.queryByRole('button', { name: fr['comments.action.edit'] })).toBeNull()
		expect(screen.queryByRole('button', { name: fr['comments.action.delete'] })).toBeNull()
	})

	it('corrige le corps sans jamais envoyer `edited_at`, que le trigger seul écrit', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, 'profil-1')
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.edit'] }))
		const zone = screen.getByLabelText(fr['comments.edit.label'])
		await userEvent.clear(zone)
		await userEvent.type(zone, 'Corrigé.')
		await userEvent.click(screen.getByRole('button', { name: fr['comments.edit.save'] }))

		await waitFor(() => {
			expect(journal.miseAJour).toEqual({ body: 'Corrigé.' })
		})
		expect(journal.cible).toBe('a')
		// `edited_at` est FERMÉE à `authenticated` : l'envoyer rendrait 403 (§13.5).
		expect(Object.keys(journal.miseAJour ?? {})).not.toContain('edited_at')
	})

	it('annuler une correction ne touche à rien', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, 'profil-1')
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.edit'] }))
		await userEvent.type(screen.getByLabelText(fr['comments.edit.label']), ' et encore')
		await userEvent.click(screen.getByRole('button', { name: fr['comments.edit.cancel'] }))

		expect(journal.miseAJour).toBeUndefined()
		expect(screen.getByText('Un commentaire.')).not.toBeNull()
	})

	// §6 : une action destructive demande une confirmation explicite. Le premier clic ne supprime
	// donc rien — c'est la moitié de la règle que l'on vérifie ici.
	it('la suppression demande une confirmation, et le premier clic n’écrit rien', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, 'profil-1')
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.delete'] }))

		expect(journal.miseAJour).toBeUndefined()
		expect(screen.getByText(fr['comments.delete.confirm.title'])).not.toBeNull()

		await userEvent.click(screen.getByRole('button', { name: fr['comments.delete.confirm.cancel'] }))
		expect(journal.miseAJour).toBeUndefined()
	})

	it('la confirmation vide le corps ET pose la pierre tombale, comme le `CHECK` l’exige', async () => {
		const journal = monter({ lignes: [ligne({ id: 'a', author_id: 'profil-1' })] }, 'profil-1')
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.delete'] }))
		await userEvent.click(screen.getByRole('button', { name: fr['comments.delete.confirm.action'] }))

		await waitFor(() => {
			expect(journal.miseAJour?.['body']).toBe('')
		})
		// Les deux colonnes ensemble : `deleted_at` seul violerait le `CHECK` du §13.4 au lieu de
		// supprimer. La valeur envoyée est sans importance — le trigger la remplace par `now()`.
		expect(journal.miseAJour?.['deleted_at']).toEqual(expect.any(String))
	})

	// Ligne *j* du §13.8 : le `USING` de la politique FILTRE — 200 et zéro ligne. Ce n'est ni un
	// succès ni une erreur HTTP, et le confondre avec l'un des deux afficherait un effet qui n'a
	// pas eu lieu.
	it('un 200 rendant zéro ligne est dit, jamais pris pour un succès', async () => {
		monter(
			{
				lignes: [ligne({ id: 'a', author_id: 'profil-1' })],
				miseAJour: { error: null, status: 200, data: [] },
			},
			'profil-1',
		)
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.edit'] }))
		await userEvent.click(screen.getByRole('button', { name: fr['comments.edit.save'] }))

		expect(await screen.findByTestId('geste-sans-effet')).not.toBeNull()
	})

	it('le refus P0001 de la pierre tombale a son propre message', async () => {
		monter(
			{
				lignes: [ligne({ id: 'a', author_id: 'profil-1' })],
				miseAJour: { error: { message: 'comment_deleted', code: 'P0001' }, status: 400 },
			},
			'profil-1',
		)
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.edit'] }))
		await userEvent.click(screen.getByRole('button', { name: fr['comments.edit.save'] }))

		expect(await screen.findByText(fr['comments.refus.supprime'])).not.toBeNull()
	})
})

// @verifies CRM-043 (docs/BACKLOG.md) — le geste de modération, INC-072
// @verifies docs/SPEC-cards.md §13.6 (l'admin supprime, ne modifie pas), §13.10 (à qui le geste
//           est offert), §13.13 point 7 (le nom du modérateur reste hors de l'écran)
// @verifies docs/DESIGN_SYSTEM.md §5.10 (action de modération, confirmation distincte)
// @verifies docs/JOURNAL.md décision 376
describe('la modération (docs/SPEC-cards.md §13.6, INC-072)', () => {
	const DAUTRUI = { id: 'a', author_id: 'profil-1' }

	// LE CŒUR DE L'UNITÉ. Avant la décision 376, `actionsOffertes = estAuteur && !supprime`
	// n'offrait rien ici, et aucun administrateur ne pouvait modérer depuis le produit — la forme
	// exacte d'INC-085 : un droit qui n'a pas de chemin n'est pas un droit.
	it('offre au seul administrateur UNE action sur le commentaire d’autrui — Supprimer', async () => {
		monter({ lignes: [ligne(DAUTRUI)] }, 'profil-2', true)
		await screen.findByText('Un commentaire.')

		expect(screen.getByRole('button', { name: fr['comments.action.delete'] })).not.toBeNull()
		// « Modifier » n'est PAS rendu — même pas désactivé. Un contrôle grisé annonce un droit
		// temporairement indisponible ; celui-ci ne le sera jamais (§13.6 : réécrire le propos
		// d'autrui est une falsification, pas une modération).
		expect(screen.queryByRole('button', { name: fr['comments.action.edit'] })).toBeNull()
		expect(screen.getByTestId('actions-moderation')).not.toBeNull()
	})

	// MESURÉ sur la pile réelle le 2026-08-14 : un `business_developer` qui tenterait le geste
	// reçoit `200` et ZÉRO ligne — donc une commande qui ne dit rien et ne fait rien. Le §5.10 du
	// design system refuse déjà exactement cela à propos de la pierre tombale.
	it('n’offre rien à un non-administrateur sur le commentaire d’autrui', async () => {
		monter({ lignes: [ligne(DAUTRUI)] }, 'profil-2', false)
		await screen.findByText('Un commentaire.')

		expect(screen.queryByTestId('actions-moderation')).toBeNull()
		expect(screen.queryByRole('button', { name: fr['comments.action.delete'] })).toBeNull()
	})

	// Un administrateur EST l'auteur de ses propres commentaires : il doit alors recevoir SES deux
	// actions, non celle d'un modérateur. Les deux régimes sont mutuellement exclusifs.
	it('rend à l’administrateur ses DEUX actions sur son propre commentaire', async () => {
		monter({ lignes: [ligne({ id: 'a', author_id: 'profil-2' })] }, 'profil-2', true)
		await screen.findByText('Un commentaire.')

		expect(screen.getByRole('button', { name: fr['comments.action.edit'] })).not.toBeNull()
		expect(screen.getByTestId('actions-commentaire')).not.toBeNull()
		expect(screen.queryByTestId('actions-moderation')).toBeNull()
	})

	// La pierre tombale reste définitive POUR TOUT LE MONDE, `admin` compris — le trigger refuse
	// toute écriture ultérieure, et la politique de modération ne l'ouvre pas davantage (§13.6).
	it('n’offre aucune modération sur un commentaire déjà supprimé', async () => {
		monter(
			{
				lignes: [
					ligne({ ...DAUTRUI, body: '', deleted_at: '2026-08-05T12:00:00.000Z' }),
				],
			},
			'profil-2',
			true,
		)
		await screen.findByText(fr['comments.deleted'])

		expect(screen.queryByTestId('actions-moderation')).toBeNull()
	})

	it('demande une confirmation DISTINCTE, qui nomme la trace nominative', async () => {
		monter({ lignes: [ligne(DAUTRUI)] }, 'profil-2', true)
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.delete'] }))

		expect(await screen.findByTestId('confirmation-moderation')).not.toBeNull()
		expect(screen.queryByTestId('confirmation-suppression')).toBeNull()
		expect(screen.getByText(fr['comments.moderation.confirm.body'])).not.toBeNull()
		expect(
			screen.getByRole('button', { name: fr['comments.moderation.confirm.action'] }),
		).not.toBeNull()
	})

	// §6 du design system : le premier clic DEMANDE, il ne retire pas. Le journal du client
	// factice le prouve mieux que l'absence de changement à l'écran.
	it('ne retire rien avant la confirmation, et pose les deux colonnes ensuite', async () => {
		const journal = monter({ lignes: [ligne(DAUTRUI)] }, 'profil-2', true)
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.delete'] }))
		expect(journal.miseAJour).toBeUndefined()

		await userEvent.click(
			screen.getByRole('button', { name: fr['comments.moderation.confirm.action'] }),
		)
		// Le MÊME `PATCH` que celui de l'auteur : c'est le trigger qui distingue les deux gestes,
		// pas le client (§13.6). `deleted_by` n'est jamais envoyée — elle est fermée au client.
		expect(journal.miseAJour?.['body']).toBe('')
		expect(journal.miseAJour?.['deleted_at']).toEqual(expect.any(String))
		expect(journal.miseAJour?.['deleted_by']).toBeUndefined()
	})

	// La pierre tombale d'un retrait par un tiers se lit dans la DONNÉE : `deleted_by` non nul et
	// différent d'`author_id`. Sans cette lecture, la colonne d'audit livrée par la migration
	// `0035` ne serait lue par personne (décision 376).
	it('nomme un retrait par la modération, sans nommer le modérateur', async () => {
		monter(
			{
				lignes: [
					ligne({
						...DAUTRUI,
						body: '',
						deleted_at: '2026-08-05T12:00:00.000Z',
						deleted_by: 'profil-2',
					}),
				],
			},
			'profil-2',
			true,
		)

		expect(await screen.findByText(fr['comments.deleted.moderation'])).not.toBeNull()
		expect(screen.queryByText(fr['comments.deleted'])).toBeNull()
		// §13.13, point 7 : l'écran dit qu'un tiers est intervenu, jamais qui.
		expect(screen.queryByText(/profil-2/)).toBeNull()
	})

	it('garde « Commentaire supprimé » quand l’auteur s’est supprimé lui-même', async () => {
		monter(
			{
				lignes: [
					ligne({
						...DAUTRUI,
						body: '',
						deleted_at: '2026-08-05T12:00:00.000Z',
						deleted_by: 'profil-1',
					}),
				],
			},
			'profil-2',
			true,
		)

		expect(await screen.findByText(fr['comments.deleted'])).not.toBeNull()
		expect(screen.queryByText(fr['comments.deleted.moderation'])).toBeNull()
	})

	// Le second `P0001` du trigger. Rendre ici le message de la pierre tombale serait faux : le
	// commentaire est vivant, c'est le geste qui est borné (décision 376).
	it('le refus `comment_moderation_limitee` a son propre message', async () => {
		monter(
			{
				lignes: [ligne(DAUTRUI)],
				miseAJour: {
					error: { message: 'comment_moderation_limitee', code: 'P0001' },
					status: 400,
				},
			},
			'profil-2',
			true,
		)
		await screen.findByText('Un commentaire.')

		await userEvent.click(screen.getByRole('button', { name: fr['comments.action.delete'] }))
		await userEvent.click(
			screen.getByRole('button', { name: fr['comments.moderation.confirm.action'] }),
		)

		expect(await screen.findByText(fr['comments.refus.moderation'])).not.toBeNull()
		expect(screen.queryByText(fr['comments.refus.supprime'])).toBeNull()
	})
})
