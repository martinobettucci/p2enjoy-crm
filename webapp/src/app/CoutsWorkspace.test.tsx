// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 5 : le montage de l'écran du §4.5
// @verifies docs/SPEC-costs.md §4.5 (un groupe de barres par track, les devises ne se mélangent
//           pas, le cumul est calculé APRÈS la RLS : une réponse amputée rend un total amputé),
//           §4.4 (la mention des réels manquants), §4.7 (les états),
//           §4.0 (l'adresse de l'écran de coûts d'un track, vers laquelle le tableau renvoie)
// @verifies docs/DESIGN_SYSTEM.md §5.33 (cet écran), §5.8 (les quatre états systématiques),
//           §5.30 (tableau équivalent, et le lien y vit — jamais sur la barre `aria-hidden`)
//
// CE FICHIER ÉPROUVE L'ÉCRAN, PAS L'AGRÉGATION. `couts-ecrans.test.ts` couvre déjà le cumul par
// track, le groupement par devise et la forme des trois requêtes ; les répéter ici les ferait
// diverger. Ce qui est éprouvé ici est ce que le montage ajoute : les cinq issues de la zone, le
// lien vers les coûts de chaque track, et la phrase de portée que le §4.5 rend nécessaire.
//
// LA PROPRIÉTÉ DU §4.5 EST ÉPROUVÉE PAR LA RÉPONSE, ET NON PAR UN RÔLE — la règle que
// `CoutsTrack.test.tsx` a déjà posée : une preuve unitaire ne peut pas poser une RLS, mais elle
// peut poser ce que la RLS PRODUIT et vérifier que l'écran rend alors un total plus petit, sans
// compenser ni signaler un manque qu'il ne connaît pas. C'est la preuve E2E qui exerce la RLS
// réelle avec deux profils, et qui mesure que la différence est exactement le budget non lu.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ContenuCoutsWorkspace, enGroupesDeTracks } from './CoutsWorkspace'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import type { HistogrammeDeviseTracks } from '../lib/couts-ecrans'

afterEach(cleanup)

type Reponse = {
	data: unknown[] | null
	error: { message: string } | null
	status: number
}

/**
 * Client factice rendant les réponses en séquence — les tracks, leurs budgets, puis les lignes.
 *
 * Volontairement plus pauvre que celui de `couts-ecrans.test.ts`, qui enregistre chaque filtre :
 * la forme des requêtes est le contrat du module, éprouvé là-bas, et la réenregistrer ici ferait de
 * ce fichier une seconde source de vérité sur un sujet qui n'est pas le sien.
 */
function clientQuiRend(
	reponses: readonly Reponse[],
	/**
	 * La réponse de l'onglet « À saisir » — vide par défaut.
	 *
	 * SERVIE À PART, ET C'EST UNE RÉVISION DE LA TRANCHE 6b. Depuis que l'écran est à onglets, la
	 * zone lit AUSSI les lignes en attente, pour le badge du §4.8 — et l'effet d'un enfant s'exécute
	 * AVANT celui de son parent, si bien que cette lecture consommerait le premier rang de la
	 * séquence et décalerait toutes les réponses du cumul. La requête est reconnaissable à son seul
	 * filtre `actual_cost is null`, qu'aucune autre lecture de ces écrans ne pose.
	 */
	enAttente: Reponse = { data: [], error: null, status: 200 },
): ClientCrm {
	let rang = 0
	return {
		from: () => {
			const chaine: Record<string, unknown> = {}
			let attente = false
			const rendre = () => chaine
			chaine.is = (colonne: string, valeur: unknown) => {
				if (colonne === 'actual_cost' && valeur === null) attente = true
				return chaine
			}
			chaine.eq = rendre
			chaine.in = rendre
			chaine.order = rendre
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(
					attente ? enAttente : (reponses[rang++] ?? { data: [], error: null, status: 200 }),
				).then(resoudre)
			return { select: () => chaine }
		},
	} as unknown as ClientCrm
}

const track = (id: string, name: string, slug: string) => ({ id, name, slug })

const budget = (id: string, name: string, track_id: string, currency = 'EUR') => ({
	id,
	name,
	track_id,
	currency,
	is_recurrent: false,
	planned_amount: null,
	closed_at: null,
	position: 1,
})

const ligne = (budget_id: string, estimated_cost: number, actual_cost: number | null) => ({
	id: `l-${budget_id}-${estimated_cost}`,
	budget_id,
	estimated_cost,
	actual_cost,
})

const ok = (data: unknown[]): Reponse => ({ data, error: null, status: 200 })

/**
 * La zone est montée SOUS un routeur : le tableau équivalent porte un `Link` par track, et un
 * `Link` hors routeur lève. Le routeur n'est pas la chose éprouvée, il est le contexte minimal que
 * le rendu exige.
 */
const monter = (client: ClientCrm | null): ReturnType<typeof render> =>
	render(
		<MemoryRouter>
			<ContenuCoutsWorkspace client={client} />
		</MemoryRouter>,
	)

/** La ligne du tableau équivalent (§5.30) portant ce nom de track. */
const ligneDuTableau = (libelle: string) => screen.getByRole('row', { name: new RegExp(libelle) })

// ---------------------------------------------------------------------------------------------

describe('ContenuCoutsWorkspace — les états (§4.7, §5.8)', () => {
	it('rend un squelette accessible pendant la lecture, jamais une page blanche', () => {
		monter(clientQuiRend([]))
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend « aucun espace de travail » quand aucun client n’est configuré, et n’attend pas', () => {
		// Sans cet état, l'écran resterait sur son squelette pour toujours : aucune lecture n'est
		// émise, donc aucune réponse ne viendra. C'est la page blanche déguisée que le §5.8 refuse.
		monter(null)
		expect(screen.getByText(fr['costs.workspace.noworkspace.title'])).toBeTruthy()
		expect(screen.queryByLabelText(fr['state.loading.aria'])).toBeNull()
	})

	it('rend l’état vide sans AUCUNE action quand aucun budget ouvert n’est lisible', async () => {
		monter(clientQuiRend([ok([track('t1', 'Conseil & IA', 'conseil-ia')]), ok([])]))
		expect(await screen.findByText(fr['costs.workspace.empty.title'])).toBeTruthy()
		// La création d'un budget vit dans l'administration de l'arborescence (§4.1) : y renvoyer
		// conditionnellement au rôle ferait calculer un droit à l'interface (`CLAUDE.md` §10).
		//
		// L'ASSERTION EST SCOPÉE AU BLOC DE L'ÉTAT VIDE, ET C'EST UNE RÉVISION PAR LIVRAISON DE LA
		// TRANCHE 6b — le motif exact écrit dans `CoutsTrack.test.tsx` : l'écran porte désormais une
		// barre d'ONGLETS (§4.8), dont les deux liens sont une navigation et non une action de l'état
		// vide.
		const vide = screen.getByTestId('etat-vide')
		expect(within(vide).queryByRole('link')).toBeNull()
		expect(within(vide).queryByRole('button')).toBeNull()
	})

	it('rend le MÊME état vide sans aucun track lisible, sans dire lequel des deux cas s’applique', async () => {
		// Distinguer « aucun track » de « aucun budget » renseignerait un appelant sans droit sur
		// l'existence de tracks qu'il ne lit pas (docs/SPEC-permissions-rls.md §7).
		monter(clientQuiRend([ok([])]))
		expect(await screen.findByText(fr['costs.workspace.empty.title'])).toBeTruthy()
	})

	it('rend le refus, et non une erreur générique, sur un 403', async () => {
		monter(clientQuiRend([{ data: null, error: { message: 'denied' }, status: 403 }]))
		expect(await screen.findByText(fr['state.forbidden.title'])).toBeTruthy()
	})

	it('rend une erreur avec une reprise qui RELIT réellement', async () => {
		const client = clientQuiRend([
			{ data: null, error: { message: 'boom' }, status: 500 },
			ok([track('t1', 'Conseil & IA', 'conseil-ia')]),
			ok([budget('b1', 'Prospection', 't1')]),
			ok([ligne('b1', 800, 700)]),
		])
		monter(client)
		const reprise = await screen.findByRole('button', { name: fr['state.error.retry'] })
		reprise.click()
		// La reprise relance la requête, elle ne recharge pas la page (docs/SPEC-webapp.md §7).
		expect(await screen.findByRole('table')).toBeTruthy()
	})
})

describe('ContenuCoutsWorkspace — l’histogramme rendu (§4.5)', () => {
	it('rend une paire de barres par track, cumulant ses budgets ouverts', async () => {
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia'), track('t2', 'Studio web', 'studio-web')]),
				ok([
					budget('b1', 'Prospection sortante', 't1'),
					budget('b2', 'Publicité 2026', 't2'),
					budget('b3', 'Salon du web', 't2'),
				]),
				ok([ligne('b1', 800, 700), ligne('b2', 1000, 880), ligne('b3', 350, 375)]),
			]),
		)
		await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
		// Les DEUX budgets de « Studio web » sont cumulés en UNE ligne : c'est la différence exacte
		// avec l'écran du §4.2, qui en rendrait deux.
		expect(screen.getAllByRole('row')).toHaveLength(4) // en-tête + 2 tracks + total
		const studio = ligneDuTableau('Studio web')
		// L'espace des milliers rendu par `Intl` est une espace fine insécable (U+202F), jamais une
		// espace ordinaire : l'écrire littéralement rendrait cette assertion fausse pour une raison
		// qui n'a rien à voir avec ce qu'elle éprouve.
		expect(studio.textContent).toContain('1\u202f350')
		expect(studio.textContent).toContain('1\u202f255')
	})

	it('rend UN histogramme PAR devise, et ne les mélange jamais', async () => {
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia'), track('t2', 'Formation', 'formation')]),
				ok([budget('b1', 'Prospection', 't1'), budget('b2', 'Suisse romande', 't2', 'CHF')]),
				ok([ligne('b1', 800, 700), ligne('b2', 500, 500)]),
			]),
		)
		await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2))
		expect(screen.getByLabelText(fr['costs.chart.region'].replace('{devise}', 'EUR'))).toBeTruthy()
		expect(screen.getByLabelText(fr['costs.chart.region'].replace('{devise}', 'CHF'))).toBeTruthy()
		// ET CHAQUE HISTOGRAMME PORTE SON TITRE VISIBLE — défaut trouvé en regardant une capture :
		// deux blocs empilés portant la même légende et les mêmes en-têtes, sans qu'aucun texte ne
		// dise que le second compte des francs. Un nom de région n'est pas rendu à l'écran.
		expect(screen.getByRole('heading', { name: 'Coûts en EUR' })).toBeTruthy()
		expect(screen.getByRole('heading', { name: 'Coûts en CHF' })).toBeTruthy()
	})

	it('ne titre AUCUN histogramme quand une seule devise est présente (§4.5)', async () => {
		// « S'il n'y en a qu'une — le cas attendu —, l'utilisateur ne voit rien de cette mécanique. »
		// Un titre « Coûts en EUR » sur un workspace entièrement en euros serait du bruit permanent.
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia')]),
				ok([budget('b1', 'Prospection', 't1')]),
				ok([ligne('b1', 800, 700)]),
			]),
		)
		await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
		expect(screen.queryByRole('heading', { name: /Coûts en/ })).toBeNull()
	})

	it('rend la mention du §4.4 dès qu’une ligne n’a pas de réel, et le compte est celui du cumul', async () => {
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia')]),
				ok([budget('b1', 'Prospection', 't1'), budget('b2', 'Salon', 't1')]),
				ok([ligne('b1', 800, null), ligne('b2', 100, null), ligne('b2', 50, 50)]),
			]),
		)
		// « 2 ligne(s) sans coût réel saisi, pour 900 € de prévisionnel. » — le badge de l'onglet du
		// §4.8 devra porter le MÊME nombre, sans quoi l'un des deux mentirait.
		expect(await screen.findByText(/2 ligne\(s\) sans coût réel saisi/)).toBeTruthy()
		expect(screen.getByText(/900/)).toBeTruthy()
	})

	it('un track dont le budget n’a aucune ligne garde ses barres ET reçoit la phrase du §4.7', async () => {
		monter(
			clientQuiRend([
				ok([track('t2', 'Formation', 'formation')]),
				ok([budget('b2', 'Suisse romande', 't2', 'CHF')]),
				ok([]),
			]),
		)
		expect(await screen.findByText(fr['costs.chart.empty'])).toBeTruthy()
		// Les barres restent rendues à côté de la phrase : les retirer ferait disparaître le track.
		expect(ligneDuTableau('Formation')).toBeTruthy()
	})

	it('une réponse AMPUTÉE rend un total amputé, sans compenser ni signaler ce qu’il ignore', async () => {
		// Ce que la RLS PRODUIT pour la lectrice : le track « Conseil & IA » ne lui est pas rendu,
		// donc son budget n'entre pas dans le cumul. Le total obtenu est celui qu'elle a le droit de
		// connaître (§4.5) — et l'écran n'écrit nulle part qu'il manque quelque chose, ce qu'il ne
		// sait pas et ce qui divulguerait par soustraction s'il le devinait.
		monter(
			clientQuiRend([
				ok([track('t2', 'Studio web', 'studio-web')]),
				ok([budget('b2', 'Publicité 2026', 't2')]),
				ok([ligne('b2', 1000, 880)]),
			]),
		)
		await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
		expect(screen.queryByText(/Conseil/)).toBeNull()
		expect(ligneDuTableau('Studio web').textContent).toContain('1\u202f000')
	})

	it('écrit la PORTÉE du cumul sous les histogrammes, jamais avant', async () => {
		// Deux profils lisent deux totaux différents sur les mêmes données, et c'est voulu (§4.5).
		// Sans cette phrase, l'écart se lirait comme une erreur de calcul.
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia')]),
				ok([budget('b1', 'Prospection', 't1')]),
				ok([ligne('b1', 800, 700)]),
			]),
		)
		expect(await screen.findByText(fr['costs.workspace.scope'])).toBeTruthy()
	})

	it('n’écrit PAS la portée du cumul sur l’état vide, où il n’y a aucun nombre à qualifier', async () => {
		monter(clientQuiRend([ok([])]))
		expect(await screen.findByText(fr['costs.workspace.empty.title'])).toBeTruthy()
		expect(screen.queryByText(fr['costs.workspace.scope'])).toBeNull()
	})
})

describe('enGroupesDeTracks — le lien vers les coûts d’un track (§4.0, §5.30)', () => {
	const histogramme: HistogrammeDeviseTracks = {
		devise: 'EUR',
		barres: [
			{
				track: { id: 't1', name: 'Conseil & IA', slug: 'conseil-ia' },
				agregat: { estime: 800, reel: 700, sansReel: 0, estimeSansReel: 0, lignes: 1 },
			},
		],
		total: { estime: 800, reel: 700, sansReel: 0, estimeSansReel: 0, lignes: 1 },
	}

	it('compose l’adresse des coûts du track, et un nom accessible qui NOMME le track', () => {
		const groupes = enGroupesDeTracks(histogramme)
		expect(groupes[0]?.lien?.adresse).toBe('/tracks/conseil-ia/couts')
		// « Voir les coûts du track X » et non « X » : cinq liens ne portant que leur libellé ne
		// diraient pas ce que chacun ouvre (§5.29 du design system).
		expect(groupes[0]?.lien?.nomAccessible).toBe('Voir les coûts du track Conseil & IA')
	})

	it('ne pose AUCUNE précision : sur cet écran, une paire de barres désigne un track', () => {
		expect(enGroupesDeTracks(histogramme)[0]?.precision).toBeUndefined()
	})

	it('rend le lien DANS le tableau équivalent, jamais sur la barre `aria-hidden`', async () => {
		monter(
			clientQuiRend([
				ok([track('t1', 'Conseil & IA', 'conseil-ia')]),
				ok([budget('b1', 'Prospection', 't1')]),
				ok([ligne('b1', 800, 700)]),
			]),
		)
		const lien = await screen.findByRole('link', { name: 'Voir les coûts du track Conseil & IA' })
		expect(lien.getAttribute('href')).toBe('/tracks/conseil-ia/couts')
		// Le graphique est `aria-hidden` (§5.30) : une cible interactive posée dessus serait perdue
		// au clavier comme au lecteur d'écran, ce que le §8 interdit sans exception.
		expect(lien.closest('[aria-hidden="true"]')).toBeNull()
		expect(lien.closest('table')).toBeTruthy()
	})
})
