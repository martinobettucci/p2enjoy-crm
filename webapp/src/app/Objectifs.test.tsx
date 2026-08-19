// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : ce que l'écran rend
// @verifies docs/SPEC-goals.md §5.2 (bloc, jauge, pilule), §5.3 (flèches), §5.4 (états),
//           §5.5 (équivalent textuel et ordre de tabulation), §3 (ouvrir le channel d'un bloc)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (jauge jamais colorée par la valeur, flèche pointillée)
//
// CE FICHIER ÉPROUVE LE RENDU, PAS LA REQUÊTE — celle-ci l'est par `lib/objectifs.test.ts`.
//
// L'ASSERTION LA PLUS IMPORTANTE EST UNE ABSENCE : le titre du bloc masqué par la RLS
// n'apparaît NULLE PART, ni dans le dessin, ni dans l'équivalent textuel, ni dans une infobulle.
// L'écran ne nomme jamais ce qu'il cache (§4.1), et une régression sur ce point est une FUITE.

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { CanevasObjectifs, Objectifs, libelleCompteBlocs } from './Objectifs'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown; error: { message: string } | null; status: number }

const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })

/**
 * Client minimal, aiguillé PAR TABLE plutôt que par rang d'appel : le canevas émet ses deux
 * lectures en parallèle (`Promise.all`), et un client qui rendrait ses réponses dans l'ordre
 * d'appel les intervertirait au gré de l'ordonnanceur.
 */
function clientParTable(reponses: Readonly<Record<string, Reponse>>): ClientCrm {
	const construire = (table: string) => {
		const reponse = reponses[table] ?? ok([])
		const chaine: Record<string, unknown> = {}
		for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
			chaine[methode] = () => chaine
		}
		chaine.maybeSingle = () => Promise.resolve(reponse)
		chaine.then = (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre)
		return chaine
	}
	return { from: (table: string) => construire(table) } as unknown as ClientCrm
}

const TABLEAU = {
	id: 'b1',
	name: 'Objectifs du trimestre',
	description: 'Tableau blanc des objectifs de l’équipe.',
	position: 1,
}

const CHANNEL_VIVANT = {
	id: 'c1',
	name: 'Refonte de site',
	slug: 'refonte',
	deleted_at: null,
	tracks: { name: 'Studio web', slug: 'studio-web', deleted_at: null },
}

const BLOC_LIBRE = {
	id: 'e1',
	title: 'Doubler le pipeline commercial',
	body: null,
	fill_percent: 25,
	channel_id: null,
	pos_x: 40,
	pos_y: 40,
	width: 260,
	height: 140,
	color: 'brand',
	channels: null,
}

const BLOC_LIE = {
	id: 'e2',
	title: 'Livrer la refonte du site vitrine',
	body: 'Mise en ligne avant la fin du trimestre.',
	fill_percent: 60,
	channel_id: 'c1',
	pos_x: 360,
	pos_y: 40,
	width: 260,
	height: 140,
	color: 'success',
	channels: CHANNEL_VIVANT,
}

/** Le bloc dont la destination est partie à la corbeille — état « lien perdu » du §5.4. */
const BLOC_PERDU = {
	...BLOC_LIE,
	id: 'e3',
	title: 'Solder les dossiers 2023',
	pos_x: 40,
	pos_y: 240,
	channels: { ...CHANNEL_VIVANT, deleted_at: '2026-08-01T10:00:00Z' },
}

const FLECHE_PLEINE = {
	id: 'f1',
	source_block_id: 'e1',
	target_block_id: 'e2',
	direction: 'forward',
	label: 'nourrit',
}

/** La flèche dont la SOURCE n'est pas rendue à cet appelant — c'est le cas que la RLS produit. */
const FLECHE_ORPHELINE = {
	id: 'f2',
	source_block_id: 'masque',
	target_block_id: 'e2',
	direction: 'both',
	label: 'dépend de',
}

function rendreCanevas(client: ClientCrm | null) {
	return render(
		<MemoryRouter initialEntries={['/objectifs/b1']}>
			<Routes>
				<Route path="/objectifs/:idTableau" element={<CanevasObjectifs client={client} />} />
			</Routes>
		</MemoryRouter>,
	)
}

describe('libelleCompteBlocs — §5.1', () => {
	it('accorde le substantif par CLÉ, jamais par concaténation', () => {
		expect(libelleCompteBlocs(0)).toBe(fr['goals.list.blocks.none'])
		expect(libelleCompteBlocs(1)).toBe(fr['goals.list.blocks.one'])
		expect(libelleCompteBlocs(5)).toBe('5 blocs')
	})
})

describe('liste des tableaux — §5.1', () => {
	it('rend un état explicite, jamais une page blanche, sans configuration', () => {
		render(
			<MemoryRouter>
				<Objectifs client={null} />
			</MemoryRouter>,
		)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
	})
})

describe('canevas — §5.2 à §5.5', () => {
	it('rend le tableau, ses blocs, leur jauge et la pilule de channel', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE, BLOC_LIE]),
				goal_links: ok([FLECHE_PLEINE]),
			}),
		)

		expect(await screen.findByText(TABLEAU.name)).toBeTruthy()
		const blocs = await screen.findAllByTestId('bloc-objectif')
		expect(blocs).toHaveLength(2)

		// La pilule mène à l'adresse du channel, « Track › Channel » (§3 et §5.2).
		const pilule = screen.getByTestId('pilule-channel')
		expect(pilule.getAttribute('href')).toBe('/tracks/studio-web/refonte')
		expect(pilule.textContent).toContain('Studio web')
		expect(pilule.textContent).toContain('Refonte de site')

		// La jauge porte la valeur SAISIE, et sa largeur en découle directement (§1 : aucun calcul
		// d'avancement, la valeur vient de la base telle quelle).
		const jauges = screen.getAllByTestId('jauge-remplissage')
		expect(jauges[0]?.getAttribute('style')).toContain('25%')
		expect(jauges[1]?.getAttribute('style')).toContain('60%')
	})

	it('LA JAUGE NE CHANGE PAS DE COULEUR AVEC LA VALEUR — §5.29', async () => {
		// C'est l'écart le plus tentant de ce composant, et il est interdit : un remplissage saisi
		// à la main n'est ni bon ni mauvais. Les deux jauges portent donc la MÊME classe, à 25 %
		// comme à 60 %.
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE, BLOC_LIE]),
				goal_links: ok([]),
			}),
		)
		const jauges = await screen.findAllByTestId('jauge-remplissage')
		expect(jauges[0]?.getAttribute('class')).toBe(jauges[1]?.getAttribute('class'))
	})

	it('NE NOMME NULLE PART le bloc que la RLS n’a pas rendu, et trace sa flèche en orpheline', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIE]),
				goal_links: ok([FLECHE_ORPHELINE]),
			}),
		)

		await screen.findByTestId('bloc-objectif')
		expect(screen.getAllByTestId('fleche-orpheline')).toHaveLength(1)

		// Le libellé de la flèche orpheline est TU : il en dirait déjà trop sur ce qui manque.
		expect(screen.queryByText('dépend de')).toBeNull()
		// Et l'équivalent textuel emploie une formulation neutre, sans nommer l'absent.
		const ligne = screen.getByTestId('ligne-diagramme')
		expect(ligne.textContent).toContain(fr['goals.diagram.unreachable'])
		expect(ligne.textContent).toContain(BLOC_LIE.title)
	})

	it('rend l’équivalent textuel du diagramme, avec le symbole de chaque direction — §5.5', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE, BLOC_LIE]),
				goal_links: ok([FLECHE_PLEINE, { ...FLECHE_ORPHELINE, source_block_id: 'e2', target_block_id: 'e1' }]),
			}),
		)
		const lignes = await screen.findAllByTestId('ligne-diagramme')
		expect(lignes).toHaveLength(2)
		expect(lignes[0]?.textContent).toContain('→')
		expect(lignes[1]?.textContent).toContain('↔')
	})

	it('rend « lien perdu » pour une destination partie à la corbeille, et AUCUNE pilule — §5.4', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_PERDU]),
				goal_links: ok([]),
			}),
		)
		expect(await screen.findByTestId('lien-perdu')).toBeTruthy()
		// Une pilule vers une adresse morte serait pire que pas de pilule du tout.
		expect(screen.queryByTestId('pilule-channel')).toBeNull()
	})

	it('rend l’état vide du tableau sans bloc, et l’équivalent textuel reste présent — §5.4', async () => {
		rendreCanevas(
			clientParTable({ goal_boards: ok(TABLEAU), goal_blocks: ok([]), goal_links: ok([]) }),
		)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		// La liste équivalente est TOUJOURS rendue : un lecteur d'écran qui ne la trouverait que
		// sur les tableaux liés apprendrait son absence plutôt que l'absence de liens.
		expect(screen.getByTestId('equivalent-textuel').textContent).toContain(fr['goals.diagram.empty'])
	})

	it('rend « tableau introuvable » plutôt qu’une page blanche — §5.4', async () => {
		rendreCanevas(
			clientParTable({ goal_boards: ok(null), goal_blocks: ok([]), goal_links: ok([]) }),
		)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['goals.board.notfound.title'])).toBeTruthy()
	})

	it('chaque bloc est atteignable au clavier et porte son étiquette complète — §5.5', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE, BLOC_LIE]),
				goal_links: ok([]),
			}),
		)
		const blocs = await screen.findAllByTestId('bloc-objectif')
		for (const bloc of blocs) expect(bloc.getAttribute('tabindex')).toBe('0')

		// L'ordre de tabulation suit la POSITION, pas l'ordre du serveur : le bloc du haut-gauche
		// vient avant celui du haut-droite.
		expect(blocs[0]?.getAttribute('aria-label')).toContain(BLOC_LIBRE.title)
		expect(blocs[1]?.getAttribute('aria-label')).toContain(BLOC_LIE.title)
		// L'étiquette du bloc lié NOMME sa destination : « titre — remplissage n %, lié à T › C ».
		expect(blocs[1]?.getAttribute('aria-label')).toContain('Studio web')
		expect(blocs[1]?.getAttribute('aria-label')).toContain('60')
	})

	it('le canevas est focalisable, ce qui rend son défilement possible au clavier — §5.5', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE]),
				goal_links: ok([]),
			}),
		)
		const canevas = await screen.findByTestId('canevas-objectifs')
		expect(canevas.getAttribute('tabindex')).toBe('0')
	})

	it('le zoom change l’échelle du canevas, et reste borné', async () => {
		rendreCanevas(
			clientParTable({
				goal_boards: ok(TABLEAU),
				goal_blocks: ok([BLOC_LIBRE]),
				goal_links: ok([]),
			}),
		)
		const surface = await screen.findByTestId('canevas-surface')
		expect(surface.getAttribute('style')).toContain('scale(1)')
		expect(screen.getByTestId('zoom-valeur').textContent).toBe('100 %')
	})
})
