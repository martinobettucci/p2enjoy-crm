// @verifies CRM-041 (docs/BACKLOG.md) — rendu réel du board, de son menu et de ses refus
// @verifies CRM-022 (docs/BACKLOG.md) — avatar du responsable sans UUID
// @verifies docs/SPEC-workflow-engine.md §7.3 (colonnes), §7.4 (carte de card), §7.5 (menu),
//           §7.7 (déplacement au clavier), §7.8 (motif exigé, jamais optimiste),
//           §7.9 (optimisme et retour arrière), §7.10 (les sept refus), §7.11 (accessibilité)
// @verifies docs/DESIGN_SYSTEM.md §5.1 (carte de card), §5.2 (colonne), §8 (états désactivés
//           lisibles, annonces), §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et isolent son menu, son optimisme et chaque refus par
// leurs rôles accessibles. Les déplacements connecté autorisé et refusé sont prouvés en complément
// par `e2e/ui/authentification.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Board } from './Board'
import { fr } from '../i18n'
import { composerBoard, type CardBoard, type EtapeBoard, type TransitionLue } from '../lib/board'
import type { ModeSommeil } from '../lib/filtre-sommeil'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const ETAPES: readonly EtapeBoard[] = [
	{ id: 's1', position: 1, libelle: 'Prospection', couleur: 'neutral', kind: 'open', seuilJours: 14 },
	{ id: 's2', position: 2, libelle: 'Relance', couleur: 'accent', kind: 'open', seuilJours: 7 },
	{ id: 's7', position: 7, libelle: 'Perdu', couleur: 'danger', kind: 'lost', seuilJours: null },
]

const TRANSITIONS: readonly TransitionLue[] = [
	{ id: 't1', from_step_id: 's1', to_step_id: 's2', label: 'Relancer', require_comment: false },
	{ id: 't2', from_step_id: 's1', to_step_id: 's7', label: 'Marquer perdu', require_comment: true },
]

const MAINTENANT = new Date('2026-08-05T12:00:00.000Z')

function card(partiel: Partial<CardBoard> & Pick<CardBoard, 'id' | 'current_step_id'>): CardBoard {
	return {
		title: partiel.id,
		position: 1,
		amount: null,
		currency: 'EUR',
		next_action: null,
		entered_step_at: MAINTENANT.toISOString(),
		// Défaut du jeu d'essai : une affaire qui n'a jamais dormi (`CRM-081` tranche 2 b).
		snoozed_until: null,
		email_local_part: 'c-00000000',
		owner_id: null,
		responsable: null,
		...partiel,
	}
}

const LIBELLES = new Map([['lien-proposition', 'Lien vers la proposition']])

type ReponseRpc = {
	data: unknown
	error: { message: string; details: string | null; code: string | null } | null
}

/** Client factice : seule `rpc` est employée par le board, et elle est **observée**. */
function clientRpc(...reponses: readonly ReponseRpc[]): {
	client: ClientCrm
	appels: { nom: string; arguments: Record<string, unknown> }[]
} {
	const appels: { nom: string; arguments: Record<string, unknown> }[] = []
	let rang = 0
	const client = {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appels.push({ nom, arguments: args })
			const reponse = reponses[Math.min(rang++, reponses.length - 1)]
			return Promise.resolve(reponse ?? { data: null, error: null })
		},
	} as unknown as ClientCrm
	return { client, appels }
}

function monter({
	cards,
	client,
	onCards = () => {},
	transitions = TRANSITIONS,
	modeSommeil = 'masquees',
	onModeSommeil = () => {},
}: {
	readonly cards: readonly CardBoard[]
	readonly client: ClientCrm
	readonly onCards?: (cards: readonly CardBoard[]) => void
	/** Jeu de rechange, pour exercer le **repli** du libellé d'une transition (§7.5). */
	readonly transitions?: readonly TransitionLue[]
	/** Le mode de la bascule du sommeil (`CRM-081` tranche 2 b, docs/SPEC-cards.md §16.12.4). */
	readonly modeSommeil?: ModeSommeil
	readonly onModeSommeil?: (mode: ModeSommeil) => void
}) {
	const modele = composerBoard({
		etapes: ETAPES,
		cards,
		transitions,
		maintenant: MAINTENANT,
		modeSommeil,
	})
	return render(
		<MemoryRouter>
			<Board
				modele={modele}
				cards={cards}
				onCards={onCards}
				libellesChamps={LIBELLES}
				client={client}
				slugTrack="conseil-ia"
				slugChannel="grands-comptes"
				modeSommeil={modeSommeil}
				onModeSommeil={onModeSommeil}
			/>
		</MemoryRouter>,
	)
}

describe('colonnes rendues (docs/SPEC-workflow-engine.md §7.3)', () => {
	it('rend une colonne par étape, y compris celles que personne n’occupe', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		expect(screen.getAllByTestId('colonne')).toHaveLength(3)
	})

	it('nomme chaque colonne et compte ses affaires', () => {
		monter({
			cards: [
				card({ id: 'c1', current_step_id: 's1' }),
				card({ id: 'c2', current_step_id: 's1', position: 2 }),
			],
			client: clientRpc().client,
		})
		const premiere = screen.getAllByTestId('colonne')[0]
		expect(within(premiere as HTMLElement).getByRole('heading').textContent).toBe('Prospection')
		expect((premiere as HTMLElement).textContent).toContain('2')
	})

	it('une colonne vide le dit, plutôt que de rester muette (docs/DESIGN_SYSTEM.md §5.2)', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		expect(screen.getAllByTestId('colonne-vide')).toHaveLength(2)
	})

	it('affiche le cumul d’une colonne, et aucun cumul quand deux devises s’y mêlent', () => {
		monter({
			cards: [
				card({ id: 'c1', current_step_id: 's1', amount: 48000, currency: 'EUR' }),
				card({ id: 'c2', current_step_id: 's1', position: 2, amount: 12000, currency: 'EUR' }),
				card({ id: 'c3', current_step_id: 's2', amount: 28000, currency: 'CHF' }),
				card({ id: 'c4', current_step_id: 's2', position: 2, amount: 1, currency: 'EUR' }),
			],
			client: clientRpc().client,
		})
		const cumuls = screen.getAllByTestId('cumul-colonne')
		expect(cumuls).toHaveLength(1)
		expect(cumuls[0]?.textContent).toContain('60')
	})
})

describe('carte de card (§7.4, docs/DESIGN_SYSTEM.md §5.1)', () => {
	it('mène à la fiche de l’affaire par son identifiant', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's1', title: 'Audit' })], client: clientRpc().client })
		expect(screen.getByRole('link', { name: 'Audit' }).getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/c1',
		)
	})

	it('rend le montant en donnée technique, et rien quand il n’y en a pas', () => {
		monter({
			cards: [
				card({ id: 'c1', current_step_id: 's1', amount: 15500 }),
				card({ id: 'c2', current_step_id: 's1', position: 2, amount: null }),
			],
			client: clientRpc().client,
		})
		const montants = screen.getAllByTestId('montant-card')
		expect(montants).toHaveLength(1)
		expect(montants[0]?.tagName.toLowerCase()).toBe('code')
	})

	it('rend l’avatar accessible du responsable sans écrire son UUID', () => {
		monter({
			cards: [
				card({
					id: 'c1',
					current_step_id: 's1',
					owner_id: 'profil-camille',
					responsable: {
						id: 'profil-camille',
						full_name: 'Camille Aubert',
						avatar_url: '/avatars/camille-aubert.svg',
					},
				}),
			],
			client: clientRpc().client,
		})
		expect(screen.getByRole('img', { name: 'Responsable : Camille Aubert' })).toBeDefined()
		expect(screen.getByTestId('carte-card').textContent).not.toContain('profil-camille')
	})

	it('n’affiche aucune pastille d’ancienneté quand l’étape ne pose aucun seuil', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's7' })], client: clientRpc().client })
		expect(screen.queryByTestId('anciennete')).toBeNull()
	})

	it('signale une affaire au-delà du seuil de relance', () => {
		monter({
			cards: [
				card({
					id: 'c1',
					current_step_id: 's2',
					entered_step_at: new Date(MAINTENANT.getTime() - 30 * 86400000).toISOString(),
				}),
			],
			client: clientRpc().client,
		})
		expect(screen.getByTestId('anciennete').getAttribute('data-depassee')).toBe('oui')
	})
})

describe('menu des transitions (§7.5, §7.7)', () => {
	it('liste EXACTEMENT les transitions déclarées depuis l’étape courante', async () => {
		const utilisateur = userEvent.setup()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		const gestes = screen.getAllByTestId('transition')
		expect(gestes.map((geste) => geste.textContent)).toEqual(['Relancer', 'Marquer perdu'])
	})

	// MESURÉ : les étapes `Livré` et `Perdu` du seed n'ont aucune transition sortante. Le bouton
	// reste **lisible** et dit pourquoi (docs/DESIGN_SYSTEM.md §8).
	it('reste lisible et explique l’indisponibilité quand aucune transition n’est déclarée', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's7' })], client: clientRpc().client })
		const bouton = screen.getByTestId('menu-transitions') as HTMLButtonElement
		expect(bouton.disabled).toBe(true)
		expect(bouton.textContent?.trim().length).toBeGreaterThan(0)
	})

	// LE REPLI DU §7.5, QU'AUCUNE DONNÉE DU SEED N'EXERCE. MESURÉ : `workflow_transitions.label` est
	// nullable, et les onze transitions du seed en portent toutes un. Sans ce jeu de rechange, le
	// repli ne serait vérifié par rien — et il l'était d'autant moins qu'il était **construit par
	// concaténation dans le composant**, ce que le §7.5 interdit nommément.
	it('replie le libellé d’une transition sans nom sur son étape d’arrivée', async () => {
		const utilisateur = userEvent.setup()
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1' })],
			client: clientRpc().client,
			transitions: [
				{ id: 't1', from_step_id: 's1', to_step_id: 's2', label: null, require_comment: false },
			],
		})
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		const geste = screen.getByTestId('transition')
		// La phrase entière vient de la clé, paramétrée par le libellé de l'étape cible : le
		// composant n'en assemble aucun morceau.
		expect(geste.textContent).toBe(fr['board.transition.fallback'].replace('{etape}', 'Relance'))
		// Le marqueur ne fuit jamais jusqu'à l'écran.
		expect(geste.textContent).not.toContain('{etape}')
		expect(geste.textContent).toContain('Relance')
	})

	it('annonce son état d’ouverture aux technologies d’assistance', async () => {
		const utilisateur = userEvent.setup()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		const bouton = screen.getByTestId('menu-transitions')
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		await utilisateur.click(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		expect(bouton.getAttribute('aria-controls')).toBe(
			screen.getByTestId('liste-transitions').getAttribute('id'),
		)
	})

	it('se referme par Échap et rend le focus au bouton qui l’a ouvert', async () => {
		const utilisateur = userEvent.setup()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		const bouton = screen.getByTestId('menu-transitions')
		await utilisateur.click(bouton)
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByTestId('liste-transitions')).toBeNull()
		expect(document.activeElement).toBe(bouton)
	})

	// Le chemin clavier du déplacement (docs/DESIGN_SYSTEM.md §8) : aucun glisser-déposer au
	// clavier n'est inventé, le menu EST ce chemin.
	it('déplace une affaire au clavier seul, sans souris', async () => {
		const utilisateur = userEvent.setup()
		const { client, appels } = clientRpc({
			data: card({ id: 'c1', current_step_id: 's2' }),
			error: null,
		})
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client })
		screen.getByTestId('menu-transitions').focus()
		await utilisateur.keyboard('{Enter}')
		const geste = screen.getAllByTestId('transition')[0] as HTMLElement
		geste.focus()
		await utilisateur.keyboard('{Enter}')
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]).toEqual({ nom: 'move_card', arguments: { card_id: 'c1', to_step_id: 's2' } })
	})
})

describe('motif exigé, jamais optimiste (§7.8)', () => {
	it('demande le motif avant d’appeler, et n’appelle pas tant qu’il manque', async () => {
		const utilisateur = userEvent.setup()
		const { client, appels } = clientRpc({ data: card({ id: 'c1', current_step_id: 's7' }), error: null })
		const onCards = vi.fn()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client, onCards })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[1] as HTMLElement)
		expect(screen.getByTestId('saisie-motif')).toBeDefined()
		expect(appels).toHaveLength(0)
		// La card n'a pas bougé : ce geste n'est pas optimiste (§7.8).
		expect(onCards).not.toHaveBeenCalled()
	})

	it('dit que le motif n’est pas encore conservé, plutôt que de laisser croire l’inverse', async () => {
		const utilisateur = userEvent.setup()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[1] as HTMLElement)
		expect(screen.getByTestId('saisie-motif').textContent).toMatch(/conserv/i)
	})

	it('transmet le motif saisi à la garde', async () => {
		const utilisateur = userEvent.setup()
		const { client, appels } = clientRpc({ data: card({ id: 'c1', current_step_id: 's7' }), error: null })
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[1] as HTMLElement)
		await utilisateur.type(screen.getByTestId('champ-motif'), 'Budget gelé')
		await utilisateur.click(screen.getByTestId('valider-motif'))
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]?.arguments['comment']).toBe('Budget gelé')
	})

	it('refuse de valider un motif vide, sans appeler la garde', async () => {
		const utilisateur = userEvent.setup()
		const { client, appels } = clientRpc()
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[1] as HTMLElement)
		expect((screen.getByTestId('valider-motif') as HTMLButtonElement).disabled).toBe(true)
		expect(appels).toHaveLength(0)
	})
})

describe('optimisme et retour arrière (§7.9)', () => {
	it('déplace la card avant la réponse, puis la remplace par la ligne du serveur', async () => {
		const utilisateur = userEvent.setup()
		const ligne = card({ id: 'c1', current_step_id: 's2', position: 9 })
		const { client } = clientRpc({ data: ligne, error: null })
		const etats: (readonly CardBoard[])[] = []
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1' })],
			client,
			onCards: (cards) => etats.push(cards),
		})
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[0] as HTMLElement)
		await waitFor(() => expect(etats).toHaveLength(2))
		expect(etats[0]?.[0]?.current_step_id).toBe('s2')
		expect(etats[1]?.[0]).toEqual(ligne)
	})

	it('replace exactement la card à son état d’origine après un refus', async () => {
		const utilisateur = userEvent.setup()
		const origine = card({ id: 'c1', current_step_id: 's1' })
		const { client } = clientRpc({
			data: null,
			error: { message: 'transition_not_allowed', details: null, code: 'P0001' },
		})
		const etats: (readonly CardBoard[])[] = []
		monter({ cards: [origine], client, onCards: (cards) => etats.push(cards) })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[0] as HTMLElement)
		await waitFor(() => expect(etats).toHaveLength(2))
		expect(etats[1]).toEqual([origine])
	})
})

describe('les sept refus, affichés (§7.10)', () => {
	async function provoquer(erreur: { message: string; details: string | null; code: string | null }) {
		const utilisateur = userEvent.setup()
		const { client } = clientRpc({ data: null, error: erreur })
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client })
		await utilisateur.click(screen.getByTestId('menu-transitions'))
		await utilisateur.click(screen.getAllByTestId('transition')[0] as HTMLElement)
		return await screen.findByTestId('refus-deplacement')
	}

	it('affiche la raison exacte d’un refus, dans une alerte', async () => {
		const bandeau = await provoquer({
			message: 'transition_not_allowed',
			details: null,
			code: 'P0001',
		})
		expect(bandeau.getAttribute('role')).toBe('alert')
		expect(bandeau.getAttribute('data-cle')).toBe('transition_not_allowed')
	})

	it('nomme les champs manquants par leur LIBELLÉ, et non par leur clé', async () => {
		const bandeau = await provoquer({
			message: 'missing_required_fields',
			details: 'lien-proposition',
			code: 'P0001',
		})
		expect(within(bandeau).getByTestId('champs-manquants').textContent).toContain(
			'Lien vers la proposition',
		)
	})

	it('reconnaît l’appelant sans session par son SQLSTATE', async () => {
		const bandeau = await provoquer({
			message: 'permission denied for function move_card',
			details: null,
			code: '42501',
		})
		expect(bandeau.getAttribute('data-cle')).toBe('anonyme')
	})

	// CLAUDE.md §18 : un refus non prévu n'est jamais absorbé.
	it('n’absorbe pas un refus inconnu et montre le message brut', async () => {
		const bandeau = await provoquer({ message: 'quelque_chose_de_neuf', details: null, code: 'P0001' })
		expect(bandeau.getAttribute('data-cle')).toBe('inconnu')
		expect(within(bandeau).getByTestId('refus-brut').textContent).toBe('quelque_chose_de_neuf')
	})

	it('annonce le résultat dans la région polie (docs/DESIGN_SYSTEM.md §8)', async () => {
		await provoquer({ message: 'forbidden', details: null, code: '42501' })
		await waitFor(() =>
			expect(screen.getAllByTestId('region-annonces').at(-1)?.textContent).not.toBe(''),
		)
	})
})

// --- Le sommeil dans le board (`CRM-081` tranche 2 b) -----------------------------------------
//
// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 b : la barre de bascule et la pastille compacte
// @verifies docs/SPEC-cards.md §16.12.3 (le board filtre à la composition), §16.12.4 (la bascule),
//           §16.12.7 (la carte porte la pastille compacte, à côté de l'ancienneté)
// @verifies docs/DESIGN_SYSTEM.md §5.3 quinquies (la première barre du board, rendue même sur un
//           board vide ; la pastille compacte), §8 (cible de 40 px, nom accessible)

describe('la barre de bascule du sommeil (§16.12.4, §5.3 quinquies)', () => {
	// LA PREMIÈRE BARRE DU BOARD, et elle ne porte que ce contrôle.
	it('rend une case à cocher étiquetée, décochée en mode masqué', () => {
		monter({ cards: [card({ id: 'c1', current_step_id: 's1' })], client: clientRpc().client })
		const case_ = screen.getByRole('checkbox', { name: fr['sommeil.afficher'] })
		expect((case_ as HTMLInputElement).checked).toBe(false)
	})

	it('la rend cochée en mode visible', () => {
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1' })],
			client: clientRpc().client,
			modeSommeil: 'visibles',
		})
		expect(
			(screen.getByRole('checkbox', { name: fr['sommeil.afficher'] }) as HTMLInputElement).checked,
		).toBe(true)
	})

	it('demande le changement de mode dans les deux sens', async () => {
		const utilisateur = userEvent.setup()
		const onModeSommeil = vi.fn()
		monter({ cards: [], client: clientRpc().client, onModeSommeil })
		await utilisateur.click(screen.getByRole('checkbox', { name: fr['sommeil.afficher'] }))
		expect(onModeSommeil).toHaveBeenCalledWith('visibles')

		cleanup()
		onModeSommeil.mockClear()
		monter({ cards: [], client: clientRpc().client, modeSommeil: 'visibles', onModeSommeil })
		await utilisateur.click(screen.getByRole('checkbox', { name: fr['sommeil.afficher'] }))
		expect(onModeSommeil).toHaveBeenCalledWith('masquees')
	})

	// Elle reste rendue sur un board sans une seule carte : elle est la cause possible de ce vide.
	it('reste rendue sur un board qui ne montre aucune carte', () => {
		monter({ cards: [], client: clientRpc().client })
		expect(screen.getByTestId('barre-sommeil-board')).toBeDefined()
		expect(screen.getByRole('checkbox', { name: fr['sommeil.afficher'] })).toBeDefined()
	})

	// La cible interactive fait au moins 40 px (§8), et c'est le `label` entier qui la porte, de
	// sorte que le texte soit cliquable — pas seulement la case.
	it('porte la cible de 40 px sur le libellé entier', () => {
		monter({ cards: [], client: clientRpc().client })
		expect(screen.getByTestId('bascule-sommeil').className).toContain('min-h-[var(--size-target)]')
	})
})

describe('la pastille compacte sur une carte de board (§16.12.7)', () => {
	/** Une échéance relative à l'instant du jeu d'essai : jamais figée (§16.11.1). */
	function echeance(jours: number): string {
		return new Date(MAINTENANT.getTime() + jours * 24 * 60 * 60 * 1000).toISOString()
	}

	it('ne rend aucune carte endormie en mode masqué, donc aucune pastille', () => {
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: echeance(10) })],
			client: clientRpc().client,
		})
		expect(screen.queryAllByTestId('carte-card')).toHaveLength(0)
		expect(screen.queryByTestId('pastille-sommeil')).toBeNull()
	})

	it('marque la carte endormie que la bascule ramène', () => {
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: echeance(10) })],
			client: clientRpc().client,
			modeSommeil: 'visibles',
		})
		expect(screen.getAllByTestId('carte-card')).toHaveLength(1)
		expect(screen.getByTestId('pastille-sommeil')).toBeDefined()
	})

	// UNE ÉCHÉANCE ÉCHUE N'EST PAS UN SOMMEIL : la carte est là dans les DEUX modes, sans marque.
	it('rend sans marque une carte dont l’échéance est passée, dans les deux modes', () => {
		for (const mode of ['masquees', 'visibles'] as const) {
			cleanup()
			monter({
				cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: echeance(-2) })],
				client: clientRpc().client,
				modeSommeil: mode,
			})
			expect(screen.getAllByTestId('carte-card')).toHaveLength(1)
			expect(screen.queryByTestId('pastille-sommeil')).toBeNull()
		}
	})

	// LES DEUX PASTILLES COEXISTENT (§16.12.7) : l'ancienneté et le sommeil sont deux faits, et
	// masquer l'un derrière l'autre en perdrait un.
	it('voisine la pastille d’ancienneté sans la remplacer', () => {
		monter({
			// `s1` porte un seuil de 14 jours, et la card y est entrée à l'instant : l'ancienneté est
			// donc rendue. L'échéance de sommeil est future.
			cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: echeance(10) })],
			client: clientRpc().client,
			modeSommeil: 'visibles',
		})
		const carte = screen.getByTestId('carte-card')
		expect(within(carte).getByTestId('anciennete')).toBeDefined()
		expect(within(carte).getByTestId('pastille-sommeil')).toBeDefined()
	})

	// La phrase entière est le NOM ACCESSIBLE ; l'œil ne lit que la date (§5.3 quinquies).
	it('porte la phrase entière comme nom accessible, et la date seule à l’œil', () => {
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: echeance(10) })],
			client: clientRpc().client,
			modeSommeil: 'visibles',
		})
		const courte = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(
			new Date(echeance(10)),
		)
		const pastille = screen.getByRole('img', {
			name: fr['card.sleep.badge'].replace('{echeance}', courte),
		})
		expect(pastille.textContent).toBe(courte)
	})

	it('disparaît sur une échéance que `Date` ne sait pas lire', () => {
		monter({
			cards: [card({ id: 'c1', current_step_id: 's1', snoozed_until: 'pas-une-date' })],
			client: clientRpc().client,
			modeSommeil: 'visibles',
		})
		expect(screen.getAllByTestId('carte-card')).toHaveLength(1)
		expect(screen.queryByTestId('pastille-sommeil')).toBeNull()
	})

	// Le compteur de la colonne annonce ce qu'elle MONTRE (§16.12.8) : une carte masquée n'y entre pas.
	it('borne le compteur de la colonne aux cartes rendues', () => {
		const cards = [
			card({ id: 'c1', current_step_id: 's1' }),
			card({ id: 'c2', current_step_id: 's1', snoozed_until: echeance(10) }),
		]
		monter({ cards, client: clientRpc().client })
		const colonne = screen.getAllByTestId('colonne')[0]
		expect(colonne).toBeDefined()
		if (colonne === undefined) return
		expect(within(colonne).getAllByTestId('carte-card')).toHaveLength(1)
	})
})
