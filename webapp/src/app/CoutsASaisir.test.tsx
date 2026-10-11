// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6b : la SURFACE de l'onglet
// @verifies CRM-099 (docs/BACKLOG.md) — révisée : un réel de plus par ligne, la somme retenue, la case « Soldé »
//           (docs/SPEC-costs.md §2.3 bis, docs/DESIGN_SYSTEM.md §5.31 bis)
//           « À saisir », et les preuves que la Definition of Done réclame nommément
// @verifies docs/SPEC-costs.md §4.8 (le badge, la saisie en série, la ligne enregistrée qui reste
//           en place, zéro qui n'est pas un vide, une ligne de budget clôturé présente ET
//           saisissable, une ligne lisible mais non écrivable rendue avec son motif et jamais
//           masquée, les trois états), §4.8.1 (le droit lu et non calculé, les trois issues),
//           §4.8.2 (le badge compte ce que le tableau liste), §4.8.3 (l'arbitrage d'INC-182 : le nom
//           accessible du badge nomme sa population, et l'onglet « Vue d'ensemble » écrit la portée
//           du compteur dès que le badge paraît), §4.0 (`?onglet=saisir`)
// @verifies docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série : onglets, badge, clavier,
//           pilule « clôturé », lecture seule), §5.7 ter (les trois mentions), §5.8 (les états),
//           §12.1 (navigation par liens, `aria-current`)
//
// CE FICHIER ÉPROUVE LA SURFACE, PAS LA LECTURE. `couts-a-saisir.test.ts` couvre déjà la forme de
// la requête, le repli du droit vers le refus, l'ancienneté et le classement des refus ; les
// répéter ici les ferait diverger. Ce qui est éprouvé ici est ce que le montage ajoute : le badge,
// le geste clavier, les trois issues rendues, et ce que la table refuse de masquer.
//
// LE CLAVIER EST ÉPROUVÉ AU CLAVIER, jamais par un appel de fonction : `Entrée` est la raison
// d'être de cet écran (§5.31), et une preuve qui appellerait le gestionnaire directement ne dirait
// rien du focus, qui est précisément ce que la règle promet.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoneCoutsAOnglets } from './CoutsASaisir'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}

type Envoi = { readonly id: string; readonly valeurs: Record<string, unknown> }

/**
 * Client factice : la lecture des lignes, et les gestes d'écriture que l'onglet émet depuis `CRM-099` — l'ajout d'un
 * réel (`card_cost_actuals`), la relecture de la somme de la ligne, et « Soldé ».
 *
 * Il ENREGISTRE les envois, parce que c'est le contrat que cette surface doit tenir : un réel AJOUTÉ, jamais
 * `actual_cost` écrit directement — la base le refuserait (« reel derive », docs/SPEC-costs.md §2.3 bis). La somme
 * relue est tenue ici comme la base la tient ; `reponsesEcriture` remplace, dans l'ordre, la réponse d'une insertion.
 */
function clientFactice(
	lignes: readonly unknown[],
	reponsesEcriture: readonly Reponse[] = [],
	sommesRelues: Readonly<Record<string, number>> = {},
): { client: ClientCrm; envois: Envoi[] } {
	const envois: Envoi[] = []
	let rangEcriture = 0
	const sommes = new Map<string, number>()
	const client = {
		from: (table: string) => ({
			select: (colonnes?: string) => {
				const chaine: Record<string, unknown> = {}
				let id: string | null = null
				const rendre = () => chaine
				chaine.is = rendre
				chaine.order = rendre
				chaine.eq = (_colonne: string, valeur: string) => {
					id = valeur
					return chaine
				}
				chaine.then = (resoudre: (valeur: Reponse) => unknown) => {
					if (table === 'card_costs' && colonnes === 'actual_cost' && id !== null) {
						const somme = sommesRelues[id] ?? sommes.get(id) ?? null
						return Promise.resolve({ data: [{ actual_cost: somme }], error: null, status: 200 }).then(resoudre)
					}
					return Promise.resolve({ data: [...lignes], error: null, status: 200 }).then(resoudre)
				}
				return chaine
			},
			insert: (valeurs: Record<string, unknown>) => {
				const id = String(valeurs.card_cost_id)
				envois.push({ id, valeurs })
				return {
					select: () => {
						const reponse = reponsesEcriture[rangEcriture++] ?? { data: [{ id: 'r' }], error: null, status: 201 }
						if (reponse.error === null && (reponse.data?.length ?? 0) > 0) {
							sommes.set(id, (sommes.get(id) ?? 0) + Number(valeurs.amount))
						}
						return Promise.resolve(reponse)
					},
				}
			},
			update: (valeurs: Record<string, unknown>) => ({
				eq: (_colonne: string, id: string) => {
					envois.push({ id, valeurs })
					return {
						select: () =>
							Promise.resolve({
								data: [{ actual_cost: sommes.get(id) ?? (valeurs.settled_at === null ? null : 0) }],
								error: null,
								status: 200,
							}),
					}
				},
			}),
		}),
	} as unknown as ClientCrm
	return { client, envois }
}

/** Une ligne en attente, telle que la lecture du §4.8 la rapporte. */
const ligneEnAttente = (
	id: string,
	label: string,
	options: {
		saisissable?: boolean
		budgetClos?: boolean
		occurrenceClose?: boolean
		occurrence?: string | null
		creee?: string
		affaire?: boolean
	} = {},
) => ({
	id,
	label,
	estimated_cost: 100,
	created_at: options.creee ?? '2026-08-01T00:00:00.000Z',
	reel_saisissable: options.saisissable ?? true,
	budgets: {
		id: `b-${id}`,
		name: 'Publicité 2026',
		currency: 'EUR',
		is_recurrent: options.occurrence !== undefined && options.occurrence !== null,
		closed_at: options.budgetClos === true ? '2026-07-01T00:00:00.000Z' : null,
	},
	budget_occurrences:
		options.occurrence === undefined || options.occurrence === null
			? null
			: {
					id: `o-${id}`,
					label: options.occurrence,
					closed_at: options.occurrenceClose === true ? '2026-07-01T00:00:00.000Z' : null,
				},
	cards:
		options.affaire === false
			? null
			: {
					id: `c-${id}`,
					title: `Affaire ${id}`,
					archived_at: null,
					channels: { slug: 'nouvelles', tracks: { id: 't1', slug: 'conseil-ia', name: 'Conseil' } },
				},
})

/**
 * La zone montée sur l'onglet demandé.
 *
 * L'ONGLET VIENT DE L'ADRESSE, JAMAIS D'UNE PROPRIÉTÉ : c'est le contrat du §4.0, et le monter
 * autrement éprouverait un écran que personne ne peut atteindre.
 */
const monter = (client: ClientCrm | null, adresse = '/couts?onglet=saisir') =>
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<ZoneCoutsAOnglets
				client={client}
				portee={{ genre: 'workspace' }}
				ensemble={<p>vue d’ensemble</p>}
			/>
		</MemoryRouter>,
	)

const champs = () => screen.getAllByTestId('couts-a-saisir-champ') as HTMLInputElement[]

// ---------------------------------------------------------------------------------------------

describe('La barre d’onglets (§4.0, §4.8, §5.31, §12.1)', () => {
	it('ouvre la VUE D’ENSEMBLE par défaut, et sur toute valeur inconnue', async () => {
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		monter(client, '/couts')
		expect(await screen.findByText('vue d’ensemble')).toBeTruthy()
		cleanup()
		// Une adresse portant une valeur que personne ne connaît ouvre l'onglet par défaut, jamais un
		// état vide inventé (§4.0).
		monter(clientFactice([]).client, '/couts?onglet=nimportequoi')
		expect(await screen.findByText('vue d’ensemble')).toBeTruthy()
	})

	it('porte `aria-current` sur le SEUL onglet courant, alors que les deux partagent le chemin', async () => {
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		monter(client, '/couts?onglet=saisir')
		await screen.findByTestId('couts-a-saisir')
		const saisir = screen.getByTestId('onglet-couts-saisir')
		const ensemble = screen.getByTestId('onglet-couts-ensemble')
		expect(saisir.getAttribute('aria-current')).toBe('page')
		// C'est la règle que `NavLink` ne saurait pas tenir : les deux liens ont le même chemin, et
		// seule la chaîne de requête les distingue (§5.31).
		expect(ensemble.getAttribute('aria-current')).toBeNull()
		expect(saisir.getAttribute('href')).toBe('/couts?onglet=saisir')
		// L'adresse de l'onglet par défaut est la plus COURTE : aucun paramètre, pas même un `?` nu.
		expect(ensemble.getAttribute('href')).toBe('/couts')
	})

	it('porte un badge qui compte les lignes que le tableau LISTE, budget clôturé compris (§4.8.2)', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production', { budgetClos: true }),
			ligneEnAttente('l3', 'Impression', { saisissable: false }),
		])
		monter(client, '/couts?onglet=saisir')
		const badge = await screen.findByTestId('onglet-couts-badge')
		expect(badge.textContent).toBe('3')
		// Le badge et le tableau ne peuvent pas répondre à deux sources : le nombre annoncé est celui
		// des lignes rendues juste en dessous, y compris celles que l'appelant ne peut pas écrire.
		expect(screen.getAllByTestId('couts-a-saisir-ligne')).toHaveLength(3)
		// LE NOM ACCESSIBLE NOMME LA POPULATION, ET CETTE ASSERTION EST RÉVISÉE, non contournée :
		// elle attendait « 3 ligne(s) en attente de leur coût réel », phrase qui disait qu'on compte
		// sans dire ce qu'on compte. L'arbitrage d'INC-182 (décision 544, §4.8.3) la complète, parce
		// que ce badge et la mention du §4.4 affichent deux nombres différents sur le même écran.
		expect(badge.getAttribute('aria-label')).toBe(
			'3 ligne(s) en attente de leur coût réel, budgets clôturés compris, toutes devises confondues',
		)
	})

	it('ÉCRIT LA PORTÉE DU COMPTEUR sur la vue d’ensemble, dès que le badge paraît (§4.8.3)', async () => {
		// La preuve de l'arbitrage d'INC-182 : deux nombres qui comptent deux populations se lisent
		// comme une erreur de calcul tant que rien ne dit ce que chacun compte.
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production', { budgetClos: true }),
		])
		monter(client, '/couts')
		const portee = await screen.findByTestId('couts-portee-compteur')
		expect(portee.textContent).toBe(fr['costs.tabs.pending.scope'])
		// Elle accompagne le badge : c'est lui qu'elle explique.
		expect(screen.getByTestId('onglet-couts-badge').textContent).toBe('2')
	})

	it('n’écrit AUCUNE portée sans badge, ni sur l’onglet « À saisir » (§4.8.3)', async () => {
		// Sans badge, il n'y a aucun second nombre à expliquer : la phrase serait un avertissement
		// permanent, que l'œil cesserait de lire — la règle de la mention du §4.4.
		monter(clientFactice([]).client, '/couts')
		await screen.findByText('vue d’ensemble')
		expect(screen.queryByTestId('couts-portee-compteur')).toBeNull()
		cleanup()
		// Sur l'onglet « À saisir », le tableau rendu EST la population du badge : la phrase n'aurait
		// rien à expliquer, et les mentions du §4.4 ne sont pas là.
		monter(clientFactice([ligneEnAttente('l1', 'Publicité')]).client, '/couts?onglet=saisir')
		await screen.findByTestId('couts-a-saisir')
		expect(screen.getByTestId('onglet-couts-badge').textContent).toBe('1')
		expect(screen.queryByTestId('couts-portee-compteur')).toBeNull()
	})

	it('n’écrit aucune portée PENDANT la lecture, comme le badge (§4.8.3)', async () => {
		// Le compte n'est pas connu : annoncer sa portée avant lui laisserait une phrase orpheline.
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		monter(client, '/couts')
		expect(screen.queryByTestId('couts-portee-compteur')).toBeNull()
		expect(screen.queryByTestId('onglet-couts-badge')).toBeNull()
		await screen.findByTestId('couts-portee-compteur')
	})

	it('ne rend AUCUN badge à zéro, ni pendant la lecture', async () => {
		const { client } = clientFactice([])
		monter(client, '/couts')
		// Pendant la lecture : un « 0 » affirmerait que tout est saisi alors que rien n'a été lu.
		expect(screen.queryByTestId('onglet-couts-badge')).toBeNull()
		await screen.findByText('vue d’ensemble')
		expect(screen.queryByTestId('onglet-couts-badge')).toBeNull()
	})

	it('rend la barre d’onglets MÊME quand la vue d’ensemble n’a rien à montrer', async () => {
		// La barre est une navigation, pas un contenu : la retirer priverait de l'onglet « À saisir »
		// précisément là où il porte des lignes que l'histogramme exclut (budgets clôturés).
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		monter(client, '/couts')
		expect(await screen.findByTestId('onglets-couts')).toBeTruthy()
	})
})

describe('La table de saisie en série (§4.8, §5.31)', () => {
	it('rend « tous les coûts réels sont saisis » sans aucune action, et non un vide en défaut', async () => {
		const { client } = clientFactice([])
		monter(client)
		expect(await screen.findByText(fr['costs.pending.empty.title'])).toBeTruthy()
		const vide = screen.getByTestId('etat-vide')
		expect(within(vide).queryByRole('link')).toBeNull()
		expect(within(vide).queryByRole('button')).toBeNull()
	})

	it('liste les lignes avec leur ancienneté, et laisse la cellule VIDE sur une date illisible', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité', { creee: '2026-08-01T00:00:00.000Z' }),
			ligneEnAttente('l2', 'Production', { creee: 'pas une date' }),
		])
		monter(client)
		const lignes = await screen.findAllByTestId('couts-a-saisir-ligne')
		// L'ancienneté est formulée en durée (§5.31) et mesurée sur `created_at` (§4.8.1).
		expect(lignes[0]?.textContent).toMatch(/jour\(s\)/)
		// « 0 jour » sur une date qu'on n'a pas su lire serait la valeur par défaut trompeuse de
		// `CLAUDE.md` §18 : la cellule reste vide (§5.9).
		expect(lignes[1]?.textContent).not.toMatch(/jour\(s\)/)
	})

	it('porte la pilule « clôturé » sur un budget clos ET sur une occurrence close, et la ligne reste SAISISSABLE', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production', { budgetClos: true }),
			ligneEnAttente('l3', 'Impression', { occurrence: 'T3', occurrenceClose: true }),
		])
		monter(client)
		const lignes = await screen.findAllByTestId('couts-a-saisir-ligne')
		expect(within(lignes[0] as HTMLElement).queryByTestId('couts-a-saisir-clos')).toBeNull()
		expect(within(lignes[1] as HTMLElement).getByTestId('couts-a-saisir-clos')).toBeTruthy()
		expect(within(lignes[2] as HTMLElement).getByTestId('couts-a-saisir-clos')).toBeTruthy()
		// C'EST LA MESURE QUE LA DoD RÉCLAME : « une ligne d'un budget clôturé est présente et
		// saisissable ». Une pilule qui vaudrait verrou viderait l'onglet de sa raison d'être — « c'est
		// précisément après la clôture que les factures arrivent » (§4.8).
		expect((champs()[1] as HTMLInputElement).disabled).toBe(false)
	})

	it('rend une ligne NON ÉCRIVABLE désactivée avec son motif, jamais masquée', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production', { saisissable: false }),
		])
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		expect(champs()).toHaveLength(2)
		expect(champs()[1]?.disabled).toBe(true)
		expect(screen.getByText(fr['costs.pending.readonly.line'])).toBeTruthy()
		// Le motif est ASSOCIÉ au champ, pas seulement posé à côté (§8).
		const mention = champs()[1]?.getAttribute('aria-describedby')
		expect(mention).not.toBeNull()
		expect(document.getElementById(mention as string)?.textContent).toBe(
			fr['costs.pending.readonly.line'],
		)
	})

	it('dit EN TÊTE que le tableau est en lecture seule quand aucune ligne n’est écrivable', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité', { saisissable: false }),
			ligneEnAttente('l2', 'Production', { saisissable: false }),
		])
		monter(client)
		expect(await screen.findByTestId('couts-a-saisir-lecture-seule')).toBeTruthy()
		// Le tableau reste rendu ENTIER : une table qui cacherait des lignes se lirait comme complète
		// alors qu'elle ne l'est pas (§4.8).
		expect(screen.getAllByTestId('couts-a-saisir-ligne')).toHaveLength(2)
	})

	it('n’écrit RIEN quand une ligne est écrivable, même si une autre ne l’est pas', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production', { saisissable: false }),
		])
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		expect(screen.queryByTestId('couts-a-saisir-lecture-seule')).toBeNull()
	})

	it('écrit la distinction du zéro et la consigne clavier SOUS le tableau', async () => {
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		// Testing Library normalise les espaces de la page (insécables comprises), pas la chaîne cherchée.
		expect(screen.getByText(fr['costs.pending.zero.notice'].replace(/\s+/g, ' '))).toBeTruthy()
		expect(screen.getByText(fr['costs.pending.keyboard.notice'])).toBeTruthy()
	})
})

describe('La saisie, au clavier et pour elle-même (§4.8, §4.8.1, §5.7 ter)', () => {
	it('ENTRÉE enregistre et porte le focus sur le champ de la LIGNE SUIVANTE — mesuré au clavier seul', async () => {
		const { client, envois } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production'),
		])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		const [premier, second] = champs()
		premier?.focus()
		await clavier.keyboard('376{Enter}')
		// C'EST LA MESURE QUE LA DoD RÉCLAME : le focus part immédiatement, sans attendre la réponse —
		// une série qui attendrait l'aller-retour à chaque ligne ne serait pas une série.
		expect(document.activeElement).toBe(second)
		await waitFor(() => expect(envois).toHaveLength(1))
		// L'ENVOI AJOUTE UN RÉEL (CRM-099, §2.3 bis) : jamais `actual_cost` écrit, aucun rattachement touché.
		expect(envois[0]).toEqual({ id: 'l1', valeurs: { card_cost_id: 'l1', amount: 376, label: null } })
	})

	it('laisse la LIGNE ENREGISTRÉE en place, marquée, et ne la retire jamais à chaud', async () => {
		const { client } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production'),
		])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('120{Enter}')
		expect(await screen.findByTestId('couts-a-saisir-enregistre')).toBeTruthy()
		// Les DEUX lignes sont toujours là : les retirer ferait remonter les suivantes sous les doigts
		// de celui qui saisit, et lui ferait écrire une valeur dans la mauvaise ligne (§4.8).
		expect(screen.getAllByTestId('couts-a-saisir-ligne')).toHaveLength(2)
		expect(screen.getAllByTestId('couts-a-saisir-ligne')[0]?.className).toContain('bg-success-soft')
	})

	it('envoie ZÉRO comme un réel, et n’envoie RIEN sur un champ laissé vide', async () => {
		const { client, envois } = clientFactice([
			ligneEnAttente('l1', 'Publicité'),
			ligneEnAttente('l2', 'Production'),
		])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('0{Enter}')
		// « Zéro est une valeur, pas un vide » (§4.8) : un réel de zéro s'ajoute comme un autre (CRM-099).
		await waitFor(() => expect(envois).toEqual([{ id: 'l1', valeurs: { card_cost_id: 'l1', amount: 0, label: null } }]))
		// Le champ suivant, laissé vide, n'envoie rien : la ligne reste en attente.
		await clavier.keyboard('{Enter}')
		await clavier.tab()
		expect(envois).toHaveLength(1)
	})

	it('n’ajoute pas DEUX FOIS le même réel, `Entrée` étant suivi d’un `blur` (CRM-099 : chaque envoi AJOUTE)', async () => {
		const { client, envois } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('50{Enter}')
		await clavier.tab()
		await waitFor(() => expect(envois).toHaveLength(1))
	})

	it('ÉCHAP annule la saisie en cours et laisse la ligne intacte', async () => {
		const { client, envois } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('999{Escape}')
		expect(champs()[0]?.value).toBe('')
		// Rien n'a été envoyé, et la ligne reste en attente : `Échap` n'écrit pas.
		await clavier.tab()
		expect(envois).toHaveLength(0)
	})

	it('nomme une saisie qui n’est pas un nombre, et n’envoie rien', async () => {
		const { client, envois } = clientFactice([ligneEnAttente('l1', 'Publicité')])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('abc{Enter}')
		expect(await screen.findByText(fr['costs.pending.invalid'])).toBeTruthy()
		expect(envois).toHaveLength(0)
		// La saisie est CONSERVÉE (§5.7 ter) : rejeter sans le dire ferait perdre ce qui a été tapé.
		expect(champs()[0]?.value).toBe('abc')
	})

	it('DIT l’issue « sans effet » — ni un succès, ni une erreur (§4.8.1)', async () => {
		const { client } = clientFactice(
			[ligneEnAttente('l1', 'Publicité')],
			[{ data: [], error: null, status: 201 }],
		)
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('12{Enter}')
		const message = await screen.findByTestId('couts-a-saisir-message')
		expect(message.textContent).toBe(fr['costs.pending.refus.sans-effet'])
		// Annoncer « Enregistré » sur zéro ligne serait la simulation de succès que `CLAUDE.md` §18
		// interdit : la mention de succès ne paraît pas.
		expect(screen.queryByTestId('couts-a-saisir-enregistre')).toBeNull()
		// Et la saisie reste à l'écran, avec son explication.
		expect(champs()[0]?.value).toBe('12')
	})

	it('TRADUIT un refus, et ne rend jamais un code brut', async () => {
		const { client } = clientFactice(
			[ligneEnAttente('l1', 'Publicité')],
			[{ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 }],
		)
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('12{Enter}')
		const message = await screen.findByTestId('couts-a-saisir-message')
		expect(message.textContent).toBe(fr['costs.pending.refus.forbidden'])
		expect(message.getAttribute('role')).toBe('alert')
	})

	it('affiche la SOMME retenue par la base dans « Déjà saisi », et vide le champ pour le réel suivant', async () => {
		// La base arrondit et additionne (`numeric(14,2)`, CRM-099) : afficher la saisie ferait croire enregistré autre
		// chose que ce qui l'est (§4.8.1).
		const { client } = clientFactice([ligneEnAttente('l1', 'Publicité')], [], { l1: 112.35 })
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		champs()[0]?.focus()
		await clavier.keyboard('12.348{Enter}')
		await screen.findByTestId('couts-a-saisir-enregistre')
		// Le format des montants de cette table, celui de l'estimé voisin (`formaterMontant`, à l'euro).
		expect(screen.getByTestId('couts-a-saisir-deja').textContent).toMatch(/^112\s€$/)
		expect(champs()[0]?.value).toBe('')
	})

	it('« Soldé » envoie le drapeau de la ligne, et la ligne reste en place, marquée', async () => {
		const { client, envois } = clientFactice([ligneEnAttente('l1', 'Publicité'), ligneEnAttente('l2', 'Production')])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		const [caseSolde] = screen.getAllByTestId('couts-a-saisir-solde') as HTMLInputElement[]
		await clavier.click(caseSolde!)
		await waitFor(() => expect(envois).toHaveLength(1))
		expect(envois[0]?.id).toBe('l1')
		expect(Object.keys(envois[0]?.valeurs ?? {})).toEqual(['settled_at'])
		await waitFor(() => expect(caseSolde!.checked).toBe(true))
		expect(screen.getAllByTestId('couts-a-saisir-ligne')).toHaveLength(2)
		// Soldée, la ligne ne reçoit plus de réel : son champ est éteint jusqu'au prochain chargement.
		expect(champs()[0]?.disabled).toBe(true)
	})

	it('n’écrit RIEN depuis une ligne non écrivable, et le champ refuse la saisie', async () => {
		const { client, envois } = clientFactice([
			ligneEnAttente('l1', 'Publicité', { saisissable: false }),
		])
		const clavier = userEvent.setup()
		monter(client)
		await screen.findAllByTestId('couts-a-saisir-ligne')
		const champ = champs()[0] as HTMLInputElement
		// Le champ est désactivé parce que la BASE dit que la ligne n'est pas écrivable (§4.8.1) :
		// une frappe n'y entre pas, et rien ne part. La garde reste celle de la base — l'écran ne
		// fait que rendre lisible ce qu'elle répond.
		await clavier.type(champ, '42{Enter}')
		expect(champ.value).toBe('')
		expect(envois).toHaveLength(0)
	})
})
