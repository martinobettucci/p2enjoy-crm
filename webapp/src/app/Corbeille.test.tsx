// @verifies CRM-077 (docs/BACKLOG.md) — corbeille et restauration : l'écran, sixième tranche
// @verifies docs/SPEC-corbeille.md §4.3 (l'auteur inconnu est nommé), §4.4 (les trois états de
//           l'énumération, et une énumération en échec n'invalide pas la liste), §4.5 (les trois
//           issues de la restauration, et aucune commande éteinte d'avance), §4.6 (les quatre
//           états, l'état vide sans action), §4.7 (aucun effacement définitif)
// @verifies docs/DESIGN_SYSTEM.md §5.16 (cette surface), §5.9 (tableau), §5.8 (états)
// @verifies CLAUDE.md §10 (la garde est backend, jamais une aide d'interface)
//
// Ces preuves montent le VRAI écran avec un client factice, comme `EtatMessagerie.test.tsx`. Le
// parcours connecté sur la vraie base relève de `e2e/ui/corbeille.spec.ts`.
//
// LA PREUVE LA PLUS UTILE DE CE FICHIER EST CELLE DE LA COMMANDE NON ÉTEINTE. Un enfant sous parent
// en corbeille porte la même commande « Restaurer » que les autres : la garde vit dans `0038`, et
// une commande désactivée par l'interface ferait passer une règle de la base pour une décision
// d'écran — sans compter qu'elle se tromperait dès qu'un autre utilisateur aurait restauré le
// parent entre le chargement de la liste et le clic.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Corbeille } from './Corbeille'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = {
	data: Record<string, unknown>[] | null
	error: { message: string; code?: string } | null
	status: number
}

const VIDE: Reponse = { data: [], error: null, status: 200 }

const TRACK = {
	id: 't-25',
	name: 'Legacy 2023',
	deleted_at: '2026-07-20T14:30:00Z',
	auteur: { full_name: 'Camille Aubert' },
}
const CHANNEL = {
	id: 'ch-38',
	name: 'Annexes 2023',
	deleted_at: '2026-07-20T14:30:00Z',
	auteur: { full_name: 'Camille Aubert' },
}
/** Le cas RÉEL du seed : née en corbeille sous la clé de service, donc sans auteur (§4.3). */
const CARD = { id: 'c-9', title: 'Saisie erronée', deleted_at: '2026-04-02T11:00:00Z', auteur: null }

type Options = {
	readonly lectures?: Readonly<Record<string, Reponse>>
	/** Réponses des énumérations, dans l'ordre où elles sont demandées. */
	readonly enumerations?: readonly Reponse[]
	readonly ecriture?: Reponse
	readonly surEcriture?: () => void
}

/**
 * Client factice distinguant les trois usages : la lecture de la corbeille (`select` puis `not`),
 * l'énumération (`select` puis `eq`/`in`), et la restauration (`update`).
 */
function client({ lectures = {}, enumerations = [], ecriture = VIDE, surEcriture }: Options): ClientCrm {
	let rangEnumeration = 0
	return {
		from: (table: string) => ({
			select: (_colonnes: string, options?: unknown) => {
				const chaine: Record<string, unknown> = {}
				// Lecture de la corbeille : elle seule appelle `not`.
				chaine['not'] = () => chaine
				chaine['order'] = () => chaine
				// Énumération : elle seule filtre par `eq`/`in` puis `is`.
				chaine['eq'] = () => chaineEnumeration()
				chaine['in'] = () => chaineEnumeration()
				chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve(lectures[table] ?? VIDE).then(resoudre)
				function chaineEnumeration() {
					const suite: Record<string, unknown> = {}
					suite['is'] = () => suite
					suite['then'] = (resoudre: (valeur: unknown) => unknown) => {
						const reponse = enumerations[rangEnumeration++] ?? VIDE
						const compte =
							options === undefined ? undefined : (reponse.data?.length ?? 0)
						return Promise.resolve({ ...reponse, count: reponse.error === null ? compte : null }).then(
							resoudre,
						)
					}
					return suite
				}
				return chaine
			},
			update: () => {
				surEcriture?.()
				const chaine: Record<string, unknown> = {}
				chaine['eq'] = () => chaine
				chaine['select'] = () => chaine
				chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve(ecriture).then(resoudre)
				return chaine
			},
		}),
	} as unknown as ClientCrm
}

describe('Corbeille — les quatre états (§4.6)', () => {
	it("dit que la corbeille est vide, et n'offre AUCUNE action (§4.6, §5.16)", async () => {
		render(<Corbeille client={client({})} />)
		expect(await screen.findByText('La corbeille est vide')).toBeTruthy()
		// L'écart assumé avec le §5.8 : il n'y a rien à faire d'une corbeille vide, et un bouton y
		// serait un chemin vers nulle part.
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByTestId('tableau-corbeille')).toBeNull()
	})

	it('rend une erreur reprenable quand une lecture échoue (§4.2)', async () => {
		const rendu = render(
			<Corbeille
				client={client({
					lectures: { channels: { data: null, error: { message: 'refusé' }, status: 403 } },
				})}
			/>,
		)
		expect(await screen.findByText("La corbeille n'a pas pu être chargée")).toBeTruthy()
		// Une corbeille amputée serait pire qu'une erreur : rien ne dirait qu'il en manque.
		expect(rendu.container.querySelector('[data-testid="tableau-corbeille"]')).toBeNull()
	})

	it("n'affiche pas de tableau sans espace de travail (§4.6)", () => {
		render(<Corbeille client={null} />)
		expect(screen.getByText('Aucun espace de travail accessible')).toBeTruthy()
	})
})

describe('Corbeille — ce que le tableau montre (§4.3, §4.4)', () => {
	it('nomme un auteur non enregistré au lieu de laisser un blanc (§4.3)', async () => {
		render(<Corbeille client={client({ lectures: { cards: { data: [CARD], error: null, status: 200 } } })} />)
		expect(await screen.findByText('Auteur inconnu')).toBeTruthy()
		expect(screen.getByText('Saisie erronée')).toBeTruthy()
		// Le type est un MOT, jamais une icône seule (§5.16).
		expect(screen.getByText('Affaire')).toBeTruthy()
	})

	it("laisse la cellule d'énumération VIDE pour une affaire, qui n'a pas d'enfant (§4.4)", async () => {
		render(<Corbeille client={client({ lectures: { cards: { data: [CARD], error: null, status: 200 } } })} />)
		await screen.findByText('Saisie erronée')
		// C'est le seul endroit de cet écran où le vide est le bon rendu : le §5.9 réserve la
		// cellule vide à une donnée qui n'existe pas pour la ligne.
		expect(screen.getByTestId('cellule-enumeration').textContent).toBe('')
		expect(screen.queryByText('En cours de mesure')).toBeNull()
	})

	it('compose l’énumération d’un track en deux lignes, singulier et pluriel (§4.4)', async () => {
		render(
			<Corbeille
				client={client({
					lectures: { tracks: { data: [TRACK], error: null, status: 200 } },
					enumerations: [
						// Première lecture : les channels du track (une ligne = un channel).
						{ data: [{ id: 'ch-a' }], error: null, status: 200 },
						// Seconde lecture : le compte des affaires de ces channels.
						{ data: [{ id: 'c-1' }, { id: 'c-2' }], error: null, status: 200 },
					],
				})}
			/>,
		)
		expect(await screen.findByText('1 channel')).toBeTruthy()
		expect(await screen.findByText('2 affaires')).toBeTruthy()
	})

	it("dit qu'une énumération n'a pas pu être mesurée SANS perdre la liste (§4.4)", async () => {
		render(
			<Corbeille
				client={client({
					lectures: {
						tracks: { data: [TRACK], error: null, status: 200 },
						cards: { data: [CARD], error: null, status: 200 },
					},
					enumerations: [{ data: null, error: { message: 'panne' }, status: 500 }],
				})}
			/>,
		)
		expect(await screen.findByText("N'a pas pu être mesuré")).toBeTruthy()
		// L'entrée reste affichée, et les autres aussi : une liste entière perdue parce qu'un
		// compte a échoué serait une panne plus grande que celle qu'on signale.
		expect(screen.getByText('Legacy 2023')).toBeTruthy()
		expect(screen.getByText('Saisie erronée')).toBeTruthy()
	})
})

describe('Corbeille — la restauration et ses trois issues (§4.5)', () => {
	it("n'éteint AUCUNE commande d'avance, la garde étant backend (§4.5, CLAUDE.md §10)", async () => {
		render(
			<Corbeille
				client={client({
					lectures: {
						tracks: { data: [TRACK], error: null, status: 200 },
						channels: { data: [CHANNEL], error: null, status: 200 },
					},
					enumerations: [VIDE, VIDE, VIDE],
				})}
			/>,
		)
		await screen.findByText('Annexes 2023')
		const commandes = screen.getAllByTestId('bouton-restaurer')
		expect(commandes).toHaveLength(2)
		// Le channel `Annexes 2023` est sous un track lui-même en corbeille : sa restauration SERA
		// refusée par `0038`. L'écran le laisse pourtant tenter, et c'est le point.
		for (const commande of commandes) expect((commande as HTMLButtonElement).disabled).toBe(false)
	})

	it('affiche le refus de la garde DANS la ligne concernée, en `role="alert"` (§4.5, §5.16)', async () => {
		render(
			<Corbeille
				client={client({
					lectures: { channels: { data: [CHANNEL], error: null, status: 200 } },
					enumerations: [VIDE],
					ecriture: { data: null, error: { code: 'P0001', message: 'parent_en_corbeille' }, status: 400 },
				})}
			/>,
		)
		await screen.findByText('Annexes 2023')
		await userEvent.click(screen.getByTestId('bouton-restaurer'))

		const refus = await screen.findByTestId('refus-restauration')
		expect(refus.getAttribute('role')).toBe('alert')
		// Le texte est celui de l'écran, jamais le `details` du serveur : celui-ci est écrit dans une
		// migration, pour le diagnostic.
		expect(refus.textContent).toBe("Son parent est lui-même en corbeille : restaurez-le d'abord.")
	})

	it("dit que RIEN n'a été restauré sur `200` et zéro ligne — décision 70 (§4.5)", async () => {
		render(
			<Corbeille
				client={client({
					lectures: { tracks: { data: [TRACK], error: null, status: 200 } },
					enumerations: [VIDE],
					ecriture: { data: [], error: null, status: 200 },
				})}
			/>,
		)
		await screen.findByText('Legacy 2023')
		await userEvent.click(screen.getByTestId('bouton-restaurer'))

		// Confondre ce cas avec un succès annoncerait une restauration qui n'a pas eu lieu.
		const refus = await screen.findByTestId('refus-restauration')
		expect(refus.textContent).toContain("Rien n'a été restauré")
		expect(screen.queryByTestId('corbeille-succes')).toBeNull()
	})

	it('annonce le succès en `role="status"` et RELIT la liste (§4.6)', async () => {
		const surEcriture = vi.fn()
		const lectures = { tracks: { data: [TRACK], error: null, status: 200 } }
		render(
			<Corbeille
				client={client({
					lectures,
					enumerations: [VIDE, VIDE],
					ecriture: { data: [{ id: 't-25' }], error: null, status: 200 },
					surEcriture,
				})}
			/>,
		)
		await screen.findByText('Legacy 2023')
		await userEvent.click(screen.getByTestId('bouton-restaurer'))

		// La liste est RELUE, jamais corrigée en mémoire : c'est la base qui décide de ce que
		// contient la corbeille, et restaurer un track rend aussi ses enfants joignables.
		await waitFor(() => expect(surEcriture).toHaveBeenCalledTimes(1))
		const succes = await screen.findByTestId('corbeille-succes')
		expect(succes.getAttribute('role')).toBe('status')
		expect(succes.textContent).toContain('Legacy 2023')
	})
})

describe("Corbeille — ce que l'écran ne fait PAS (§4.7)", () => {
	it("n'expose aucune commande d'effacement définitif ni de vidage (§4.7)", async () => {
		render(
			<Corbeille
				client={client({
					lectures: {
						tracks: { data: [TRACK], error: null, status: 200 },
						cards: { data: [CARD], error: null, status: 200 },
					},
					enumerations: [VIDE, VIDE],
				})}
			/>,
		)
		await screen.findByText('Legacy 2023')
		// Le §6 n'est pas arbitré : livrer une destruction irréversible sans règle de conservation
		// serait le contraire d'une mesure de conformité. Cette assertion garde la porte fermée.
		const commandes = screen.getAllByRole('button').map((bouton) => bouton.textContent ?? '')
		for (const libelle of commandes) {
			expect(libelle).not.toMatch(/supprim|effac|vider|définitif/i)
		}
		expect(commandes.every((libelle) => libelle.includes('Restaurer'))).toBe(true)
	})
})
