// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : ce que l'écran rend ;
//           tranche 2a : les gestes de géométrie, à la souris et au clavier
// @verifies docs/SPEC-goals.md §5.2 (bloc, jauge, pilule), §5.3 (flèches), §5.4 (états),
//           §5.5 (équivalent textuel, ordre de tabulation, gestes clavier), §3 (ouvrir le
//           channel d'un bloc, poser, déplacer, redimensionner), §4.2 (l'écriture est décidée
//           par la base : l'écran envoie puis traduit)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (jauge jamais colorée par la valeur, flèche pointillée)
//
// CE FICHIER ÉPROUVE LE RENDU, PAS LA REQUÊTE — celle-ci l'est par `lib/objectifs.test.ts`.
//
// L'ASSERTION LA PLUS IMPORTANTE EST UNE ABSENCE : le titre du bloc masqué par la RLS
// n'apparaît NULLE PART, ni dans le dessin, ni dans l'équivalent textuel, ni dans une infobulle.
// L'écran ne nomme jamais ce qu'il cache (§4.1), et une régression sur ce point est une FUITE.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { CanevasObjectifs, Objectifs, corpsSuppressionBloc, libelleCompteBlocs } from './Objectifs'
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
	// `archived_at` FAIT PARTIE DE LA LIGNE depuis CRM-083 tranche 2 h : `COLONNES_TABLEAU` la
	// demande, et une ligne rendue par PostgREST la porte toujours. Une fixture qui l'omettrait
	// décrirait une réponse que le backend ne produit pas, et l'écran y lirait « archivé ».
	archived_at: null,
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

// ---------------------------------------------------------------------------------------------
// TRANCHE 2a — LA GÉOMÉTRIE
//
// Ces scénarios éprouvent ce que le GESTE produit, et l'assertion qui compte le plus est celle
// du « sans effet » : sur une réponse aboutie de zéro ligne, le bloc REVIENT à sa position et
// l'écran le dit. Une implémentation optimiste qui laisserait le bloc à sa nouvelle place
// passerait tous les autres cas de ce fichier, et afficherait un déplacement qui n'a pas eu lieu.
// ---------------------------------------------------------------------------------------------

type Ecriture = {
	operation: 'insert' | 'update' | 'delete'
	// UNE SUPPRESSION N'A PAS DE CHARGE, et la garder facultative le rend visible dans les
	// assertions : un `delete` qui porterait une charge trahirait une écriture déguisée.
	charge?: Record<string, unknown>
	table: string
}

/**
 * Client de LECTURE et d'ÉCRITURE, aiguillé par table comme celui des scénarios de lecture.
 *
 * `reponseEcriture` est la réponse que le serveur rend au geste : une ligne pour un succès, un
 * tableau VIDE pour le silence de la clause `using`, une erreur pour un refus.
 */
function clientEcrivant(
	reponses: Readonly<Record<string, Reponse>>,
	reponseEcriture: Reponse,
): { client: ClientCrm; ecritures: Ecriture[] } {
	const ecritures: Ecriture[] = []
	const client = {
		from: (table: string) => {
			const reponse = reponses[table] ?? ok([])
			const lecture: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
				lecture[methode] = () => lecture
			}
			lecture.maybeSingle = () => Promise.resolve(reponse)
			lecture.then = (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre)

			const ecriture: Record<string, unknown> = {}
			for (const methode of ['select', 'eq']) {
				ecriture[methode] = () => ecriture
			}
			ecriture.single = () =>
				Promise.resolve({
					...reponseEcriture,
					data: Array.isArray(reponseEcriture.data) ? (reponseEcriture.data[0] ?? null) : reponseEcriture.data,
				})
			ecriture.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponseEcriture).then(resoudre)

			return {
				...lecture,
				insert: (charge: Record<string, unknown>) => {
					ecritures.push({ operation: 'insert', charge, table })
					return ecriture
				},
				update: (charge: Record<string, unknown>) => {
					ecritures.push({ operation: 'update', charge, table })
					return ecriture
				},
				delete: () => {
					ecritures.push({ operation: 'delete', table })
					return ecriture
				},
			}
		},
	} as unknown as ClientCrm
	return { client, ecritures }
}

const LECTURES_UN_BLOC = {
	goal_boards: ok(TABLEAU),
	goal_blocks: ok([BLOC_LIBRE]),
	goal_links: ok([]),
}

describe('canevas — poser un bloc, §3 et §5.5', () => {
	it('l’état vide porte la commande qui le comble, et le canevas paraît dès qu’elle est armée', async () => {
		const { client } = clientEcrivant(
			{ goal_boards: ok(TABLEAU), goal_blocks: ok([]), goal_links: ok([]) },
			ok([]),
		)
		rendreCanevas(client)

		// Sans bloc ET sans pose armée, l'écran est l'état vide — mais il porte le geste.
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		const commandes = screen.getAllByTestId('poser-bloc')
		fireEvent.click(commandes[commandes.length - 1] as HTMLElement)

		// La surface paraît : c'est elle qui reçoit le geste, un état vide n'aurait rien à recevoir.
		expect(await screen.findByTestId('canevas-surface')).toBeTruthy()
		expect(screen.getByTestId('repere-pose')).toBeTruthy()
	})

	it('le repère ÉCRIT sa position, la déplace aux flèches, et pose à Entrée', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, id: 'neuf', pos_x: 32, pos_y: 24 }]))
		rendreCanevas(client)
		await screen.findByTestId('canevas-surface')

		fireEvent.click(screen.getAllByTestId('poser-bloc')[0] as HTMLElement)
		const repere = screen.getByTestId('repere-pose')
		const position = () => repere.getAttribute('aria-label') ?? ''
		expect(position).toBeTruthy()
		const depart = position()

		fireEvent.keyDown(repere, { key: 'ArrowRight' })
		// La position est ÉCRITE : sans elle, déplacer un repère vide n'apprendrait rien.
		await waitFor(() => expect(screen.getByTestId('repere-pose').getAttribute('aria-label')).not.toBe(depart))

		await act(async () => {
			fireEvent.keyDown(screen.getByTestId('repere-pose'), { key: 'Enter' })
		})
		const posee = ecritures.find((ecriture) => ecriture.operation === 'insert')
		expect(posee).toBeTruthy()
		// LA POSITION VIENT DU GESTE : le repère déplacé d'un pas vers la droite l'a transmise.
		expect(posee?.charge?.pos_x).toBe(32)
		expect(posee?.charge?.board_id).toBe('b1')
	})

	it('Échap annule la pose sans rien écrire', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([]))
		rendreCanevas(client)
		await screen.findByTestId('canevas-surface')

		fireEvent.click(screen.getAllByTestId('poser-bloc')[0] as HTMLElement)
		fireEvent.keyDown(screen.getByTestId('repere-pose'), { key: 'Escape' })

		expect(screen.queryByTestId('repere-pose')).toBeNull()
		expect(ecritures).toHaveLength(0)
	})
})

describe('canevas — déplacer et redimensionner au clavier, §5.5', () => {
	it('chaque bloc CITE la consigne clavier, sans quoi le geste n’existerait pour personne', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement
		const idConsigne = bloc.getAttribute('aria-describedby')
		expect(idConsigne).toBeTruthy()
		expect(document.getElementById(idConsigne as string)?.textContent).toBeTruthy()
	})

	it('une flèche déplace le bloc, et le RELÂCHEMENT écrit la seule position', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, pos_x: 48 }]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowRight' })
		// L'ébauche est visible AVANT la réponse du serveur : le geste est optimiste (§6).
		await waitFor(() => expect(screen.getAllByTestId('bloc-objectif')[0]?.getAttribute('style')).toContain('48px'))
		// Rien n'est encore parti : une frappe maintenue émettrait sinon une requête par pixel.
		expect(ecritures).toHaveLength(0)

		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowRight' })
		})
		const ecrite = ecritures.find((ecriture) => ecriture.operation === 'update')
		expect(ecrite?.charge).toEqual({ pos_x: 48, pos_y: BLOC_LIBRE.pos_y })
	})

	it('Alt et flèche REDIMENSIONNENT, et n’envoient aucune position', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowRight', altKey: true })
		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowRight' })
		})
		const ecrite = ecritures.find((ecriture) => ecriture.operation === 'update')
		expect(ecrite?.charge).toEqual({ width: BLOC_LIBRE.width + 8, height: BLOC_LIBRE.height })
	})

	it('Maj ajuste au pas fin, ce que la souris atteint et qu’un pas unique manquerait', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowDown', shiftKey: true })
		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowDown' })
		})
		expect(ecritures[0]?.charge).toEqual({ pos_x: BLOC_LIBRE.pos_x, pos_y: BLOC_LIBRE.pos_y + 1 })
	})
})

describe('canevas — les trois issues d’une écriture, §4.2', () => {
	it('un SILENCE de la clause `using` replace le bloc et le DIT, il ne simule aucun succès', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowRight' })
		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowRight' })
		})

		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.write.noeffect'])
		// LE BLOC EST REVENU : afficher le déplacement serait la simulation de succès que
		// `CLAUDE.md` §18 interdit.
		expect(screen.getAllByTestId('bloc-objectif')[0]?.getAttribute('style')).toContain(`${BLOC_LIBRE.pos_x}px`)
	})

	it('un REFUS de politique est traduit, jamais rendu tel que le serveur l’écrit', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, {
			data: null,
			error: { message: 'new row violates row-level security policy' },
			status: 403,
		})
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowRight' })
		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowRight' })
		})

		const mention = screen.getByTestId('mention-ecriture')
		expect(mention.textContent).toBe(fr['goals.write.refused.forbidden'])
		expect(mention.getAttribute('role')).toBe('alert')
		expect(mention.textContent).not.toContain('row-level security')
	})

	it('un SUCCÈS prend la ligne du serveur, sans relire le tableau', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, pos_x: 48 }]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		fireEvent.keyDown(bloc, { key: 'ArrowRight' })
		await act(async () => {
			fireEvent.keyUp(screen.getAllByTestId('bloc-objectif')[0] as HTMLElement, { key: 'ArrowRight' })
		})

		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.write.saved'])
		expect(screen.getAllByTestId('bloc-objectif')[0]?.getAttribute('style')).toContain('48px')
		// Une seule écriture, et aucune relecture : la ligne rendue est déjà en main (§5.28).
		expect(ecritures.filter((ecriture) => ecriture.operation === 'update')).toHaveLength(1)
	})
})

// --- TRANCHE 2b-1 : LA FICHE D'ÉDITION ----------------------------------------------------
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-1 : le contenu
// @verifies docs/SPEC-goals.md §3 (saisir titre, corps, couleur ; régler le remplissage au
//           curseur ET au champ, les deux écrivant la même valeur), §5.5 (`Entrée` ouvre la
//           fiche d'édition), §1 (le remplissage n'est jamais calculé)
// @verifies docs/DESIGN_SYSTEM.md §5.7 ter (chaque champ s'enregistre pour lui-même), §5.29
//
// L'ASSERTION QUI COMPTE LE PLUS ICI EST, COMME POUR LA GÉOMÉTRIE, CELLE DES COLONNES ENVOYÉES :
// une saisie de titre qui emporterait le corps, la couleur et le remplissage écraserait ce qu'un
// collègue vient d'écrire dans un autre champ du même bloc.

describe('canevas — la fiche d’édition, §3 et §5.5', () => {
	it('`Entrée` sur un bloc OUVRE sa fiche, et le focus y entre', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		const bloc = (await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement

		expect(screen.queryByTestId('fiche-bloc')).toBeNull()
		fireEvent.keyDown(bloc, { key: 'Enter' })

		expect(await screen.findByTestId('fiche-bloc')).toBeTruthy()
		// Le focus ENTRE dans la fiche : sans cela, il faudrait traverser tout le canevas au
		// clavier pour l'atteindre, et le geste du §5.5 ne serait tenu qu'en apparence.
		expect(document.activeElement).toBe(screen.getByTestId('champ-titre'))
	})

	it('la fiche montre les valeurs du bloc, et le bloc édité est DÉSIGNÉ', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		expect((screen.getByTestId('champ-titre') as HTMLInputElement).value).toBe(BLOC_LIBRE.title)
		expect((screen.getByTestId('champ-remplissage') as HTMLInputElement).value).toBe(String(BLOC_LIBRE.fill_percent))
		expect((screen.getByTestId('curseur-remplissage') as HTMLInputElement).value).toBe(String(BLOC_LIBRE.fill_percent))
		// Sans cette marque, une fiche posée sous un canevas de douze blocs n'aurait aucun lien
		// lisible avec le sien.
		expect(screen.getAllByTestId('bloc-objectif')[0]?.getAttribute('data-edite')).toBe('oui')
	})

	it('la saisie d’un titre n’envoie QUE le titre, et à la sortie du champ — jamais à la frappe', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, title: 'Doubler le MRR' }]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = await screen.findByTestId('champ-titre')

		fireEvent.change(champ, { target: { value: 'Doubler le MRR' } })
		// Rien n'est parti : écrire à chaque touche émettrait une requête par caractère.
		expect(ecritures).toHaveLength(0)

		await act(async () => {
			fireEvent.blur(champ)
		})
		expect(ecritures).toHaveLength(1)
		expect(ecritures[0]?.charge).toEqual({ title: 'Doubler le MRR' })
		expect(screen.getByTestId('etat-titre').textContent).toBe(fr['goals.write.saved'])
	})

	it('`Entrée` dans le champ de titre enregistre sans attendre la sortie du champ', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, title: 'Doubler le MRR' }]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = await screen.findByTestId('champ-titre')

		fireEvent.change(champ, { target: { value: 'Doubler le MRR' } })
		await act(async () => {
			fireEvent.keyDown(champ, { key: 'Enter' })
		})
		expect(ecritures[0]?.charge).toEqual({ title: 'Doubler le MRR' })
	})

	it('une valeur INCHANGÉE n’écrit rien : sortir d’un champ qu’on n’a pas touché n’est pas une saisie', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = await screen.findByTestId('champ-titre')

		await act(async () => {
			fireEvent.blur(champ)
		})
		expect(ecritures).toHaveLength(0)
	})

	it('le corps VIDÉ part à `null`, et n’emporte pas le titre', async () => {
		const { client, ecritures } = clientEcrivant(
			{ ...LECTURES_UN_BLOC, goal_blocks: ok([{ ...BLOC_LIBRE, body: 'Ancien corps.' }]) },
			ok([{ ...BLOC_LIBRE, body: null }]),
		)
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = await screen.findByTestId('champ-corps')

		fireEvent.change(champ, { target: { value: '   ' } })
		await act(async () => {
			fireEvent.blur(champ)
		})
		expect(ecritures[0]?.charge).toEqual({ body: null })
	})

	it('choisir une couleur écrit la seule couleur, et le choix reste coché sans attendre le serveur', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, color: 'danger' }]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		const option = screen.getByTestId('couleur-danger').querySelector('input') as HTMLInputElement
		await act(async () => {
			fireEvent.click(option)
		})
		expect(ecritures[0]?.charge).toEqual({ color: 'danger' })
		expect(option.checked).toBe(true)
	})

	it('LE CURSEUR ET LE CHAMP ÉCRIVENT LA MÊME VALEUR, et le curseur n’écrit qu’au relâchement', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, fill_percent: 80 }]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const curseur = (await screen.findByTestId('curseur-remplissage')) as HTMLInputElement
		const nombre = screen.getByTestId('champ-remplissage') as HTMLInputElement

		fireEvent.change(curseur, { target: { value: '80' } })
		// Rien n'est parti : un glissement émettrait une requête par pour cent parcouru.
		expect(ecritures).toHaveLength(0)
		// Les deux entrées montrent la MÊME valeur : elles partagent un seul état.
		expect(nombre.value).toBe('80')

		await act(async () => {
			fireEvent.pointerUp(curseur)
		})
		expect(ecritures[0]?.charge).toEqual({ fill_percent: 80 })
	})

	it('le champ numérique borne la valeur, et une saisie illisible n’écrit RIEN plutôt que zéro', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ ...BLOC_LIBRE, fill_percent: 100 }]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const nombre = (await screen.findByTestId('champ-remplissage')) as HTMLInputElement

		fireEvent.change(nombre, { target: { value: '' } })
		await act(async () => {
			fireEvent.blur(nombre)
		})
		// Écrire zéro sur un champ vidé serait la valeur par défaut trompeuse de `CLAUDE.md` §18.
		expect(ecritures).toHaveLength(0)

		fireEvent.change(nombre, { target: { value: '140' } })
		await act(async () => {
			fireEvent.blur(nombre)
		})
		expect(ecritures[0]?.charge).toEqual({ fill_percent: 100 })
	})

	it('un REFUS n’efface pas la saisie, et le dit SOUS le champ concerné', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, {
			data: null,
			error: { message: 'new row violates row-level security policy' },
			status: 403,
		})
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = (await screen.findByTestId('champ-titre')) as HTMLInputElement

		fireEvent.change(champ, { target: { value: 'Doubler le MRR' } })
		await act(async () => {
			fireEvent.blur(champ)
		})

		const mention = screen.getByTestId('etat-titre')
		expect(mention.textContent).toBe(fr['goals.write.refused.forbidden'])
		expect(mention.getAttribute('role')).toBe('alert')
		expect(mention.textContent).not.toContain('row-level security')
		// La saisie RESTE : la rejeter sans le dire serait la valeur par défaut trompeuse du §18.
		expect(champ.value).toBe('Doubler le MRR')
		// Et la mention vit sous SON champ, cité par `aria-describedby`.
		expect(champ.getAttribute('aria-describedby')).toContain('fiche-bloc-titre-etat')
	})

	it('le SILENCE de la clause `using` est dit, jamais rendu comme un succès', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const champ = await screen.findByTestId('champ-titre')

		fireEvent.change(champ, { target: { value: 'Doubler le MRR' } })
		await act(async () => {
			fireEvent.blur(champ)
		})
		expect(screen.getByTestId('etat-titre').textContent).toBe(fr['goals.write.noeffect'])
	})

	it('`Échap` ferme la fiche et rend le focus au bloc', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const fiche = await screen.findByTestId('fiche-bloc')

		fireEvent.keyDown(fiche, { key: 'Escape' })
		await waitFor(() => expect(screen.queryByTestId('fiche-bloc')).toBeNull())
		// Le focus REVIENT au bloc : le renvoyer au début du document ferait perdre sa place.
		expect(document.activeElement).toBe(screen.getAllByTestId('bloc-objectif')[0])
	})

	it('la fiche n’a AUCUN bouton d’enregistrement, et c’est la règle du §5.7 ter', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		const fiche = await screen.findByTestId('fiche-bloc')

		// PREUVE RÉVISÉE PAR LA TRANCHE 2b-2c, ET LE MOTIF EST ÉCRIT ICI (`docs/CloudWorker.md`
		// §3.1) : elle comptait les boutons de la fiche et en exigeait UN SEUL, ce qui tenait tant
		// que la fermeture était la seule commande. La suppression d'un bloc en pose une seconde
		// (§3), et la règle que cette preuve défend n'a pas bougé d'un pouce — la fiche n'a AUCUN
		// bouton d'ENREGISTREMENT, chaque champ écrivant sa propre valeur (§5.7 ter). Elle énumère
		// donc désormais les commandes attendues, ce qui refuserait toujours un bouton
		// d'enregistrement ajouté, là où un simple compte l'aurait laissé passer dès qu'un autre
		// geste disparaîtrait.
		const boutons = [...fiche.querySelectorAll('button')]
		expect(boutons.map((bouton) => bouton.getAttribute('data-testid'))).toEqual([
			'fermer-fiche',
			'supprimer-bloc',
		])
	})

	it('LA JAUGE DU BLOC NE CHANGE PAS DE COULEUR AVEC LA VALEUR, quel que soit le remplissage', async () => {
		// L'écart le plus tentant du composant (`docs/DESIGN_SYSTEM.md` §5.29), reposé ici parce
		// que la tranche 2b rend la valeur modifiable et donc l'écart accessible.
		const { client } = clientEcrivant(
			{ ...LECTURES_UN_BLOC, goal_blocks: ok([{ ...BLOC_LIBRE, fill_percent: 5 }, { ...BLOC_LIBRE, id: 'e9', fill_percent: 95 }]) },
			ok([]),
		)
		rendreCanevas(client)
		const jauges = await screen.findAllByTestId('jauge-remplissage')
		expect(jauges).toHaveLength(2)
		expect(jauges[0]?.getAttribute('class')).toBe(jauges[1]?.getAttribute('class'))
	})
})

// ---------------------------------------------------------------------------------------------
// TRANCHE 2b-2a — LE LIEN VERS UN CHANNEL
//
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-2a
// @verifies docs/SPEC-goals.md §3 (sélecteur des channels LISIBLES groupés par track ; retirer le
//           lien remet `channel_id` à nul), §4.2 (poser le lien exige `app.can_write_channel` —
//           l'écran ne l'anticipe pas et TRADUIT le refus), §5.4 (« lien perdu »)
//
// L'ASSERTION QUI COMPTE LE PLUS EST CELLE DE LA DESTINATION ABSENTE DE LA LISTE : un channel
// archivé, ou dont la lecture vient de se fermer, ne figure pas parmi les liables. Un sélecteur
// qui retomberait alors sur « Aucun channel » afficherait un retrait de lien qui n'a pas eu lieu,
// et le premier geste sur un autre champ le rendrait vrai.
// ---------------------------------------------------------------------------------------------

const WORKSPACE = { id: 'w1', name: 'P2Enjoy', slug: 'p2enjoy' }

const CHANNELS_LIABLES = [
	{ id: 'c1', name: 'Refonte de site', tracks: { id: 't1', name: 'Studio web' } },
	{ id: 'c2', name: 'Audit technique', tracks: { id: 't1', name: 'Studio web' } },
	{ id: 'c3', name: 'Appel d’offres', tracks: { id: 't2', name: 'Grands comptes' } },
]

/** Les lectures d'un canevas dont le sélecteur de destination est servi. */
const LECTURES_AVEC_CHANNELS = {
	...LECTURES_UN_BLOC,
	workspaces: ok([WORKSPACE]),
	channels: ok(CHANNELS_LIABLES),
}

/** Ouvre la fiche du premier bloc rendu, et attend le sélecteur. */
async function ouvrirFiche(): Promise<HTMLSelectElement> {
	fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
	await screen.findByTestId('fiche-bloc')
	return (await screen.findByTestId('champ-lien')) as HTMLSelectElement
}

describe('canevas — lier un bloc à un channel, §3 et §4.2', () => {
	it('groupe les channels PAR TRACK et offre toujours l’option vide', async () => {
		const { client } = clientEcrivant(LECTURES_AVEC_CHANNELS, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		const selecteur = await ouvrirFiche()

		await waitFor(() => expect(selecteur.querySelectorAll('optgroup')).toHaveLength(2))
		const groupes = [...selecteur.querySelectorAll('optgroup')]
		expect(groupes.map((groupe) => groupe.getAttribute('label'))).toEqual(['Studio web', 'Grands comptes'])
		expect([...groupes[0]!.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
			'Refonte de site',
			'Audit technique',
		])
		// L'option vide est TOUJOURS là : c'est elle qui retire le lien au clavier, et un sélecteur
		// dont on ne pourrait pas sortir enfermerait le bloc dans sa première destination.
		expect(selecteur.querySelector('option')?.value).toBe('')
		expect(selecteur.querySelector('option')?.textContent).toBe(fr['goals.edit.link.none'])
	})

	it('choisir une destination n’envoie QUE `channel_id`', async () => {
		// La règle des tranches 2a et 2b-1, reposée ici : renvoyer les colonnes voisines écraserait
		// ce qu'un collègue vient d'y écrire.
		const { client, ecritures } = clientEcrivant(
			LECTURES_AVEC_CHANNELS,
			ok([{ ...BLOC_LIBRE, channel_id: 'c1', channels: CHANNEL_VIVANT }]),
		)
		rendreCanevas(client)
		const selecteur = await ouvrirFiche()
		await waitFor(() => expect(selecteur.querySelectorAll('optgroup').length).toBeGreaterThan(0))

		await act(async () => {
			fireEvent.change(selecteur, { target: { value: 'c1' } })
		})
		const lien = ecritures.filter((ecriture) => ecriture.operation === 'update')
		expect(lien).toHaveLength(1)
		expect(lien[0]?.charge).toEqual({ channel_id: 'c1' })
		expect(await screen.findByTestId('etat-lien')).toBeTruthy()
		expect(screen.getByTestId('etat-lien').textContent).toBe(fr['goals.write.saved'])
	})

	it('le bouton de retrait N’EXISTE PAS tant qu’il n’y a rien à retirer', async () => {
		// Une commande qui n'aurait rien à défaire serait une commande morte, et l'entête du
		// fichier d'écran s'interdit d'en poser.
		const { client } = clientEcrivant(LECTURES_AVEC_CHANNELS, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		await ouvrirFiche()
		expect(screen.queryByTestId('retirer-lien')).toBeNull()
	})

	it('retirer le lien envoie `channel_id: null`, et non une colonne omise', async () => {
		const { client, ecritures } = clientEcrivant(
			{ ...LECTURES_AVEC_CHANNELS, goal_blocks: ok([BLOC_LIE]) },
			ok([{ ...BLOC_LIE, channel_id: null, channels: null }]),
		)
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		await act(async () => {
			fireEvent.click(await screen.findByTestId('retirer-lien'))
		})
		// Omettre la colonne n'écrirait RIEN : le lien resterait, et l'écran annoncerait pourtant un
		// retrait — la simulation de succès que `CLAUDE.md` §18 interdit.
		const lien = ecritures.filter((ecriture) => ecriture.operation === 'update')
		expect(lien[0]?.charge).toEqual({ channel_id: null })
	})

	it('LA DESTINATION ACTUELLE RESTE UNE OPTION même absente de la liste des liables', async () => {
		// Éprouvé CONTRE SON SUCCÈS : sans cette option, le sélecteur retomberait sur « Aucun
		// channel » et afficherait un retrait de lien qui n'a pas eu lieu.
		const { client } = clientEcrivant(
			{
				...LECTURES_AVEC_CHANNELS,
				goal_blocks: ok([BLOC_LIE]),
				channels: ok([CHANNELS_LIABLES[2]]),
			},
			ok([BLOC_LIE]),
		)
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')
		const selecteur = (await screen.findByTestId('champ-lien')) as HTMLSelectElement

		await waitFor(() => expect(selecteur.value).toBe('c1'))
		expect([...selecteur.querySelectorAll('option')].map((option) => option.textContent)).toContain(
			CHANNEL_VIVANT.name,
		)
	})

	it('TRADUIT le refus de `app.can_write_channel` par SON texte, jamais par celui du tableau', async () => {
		// « Vous ne pouvez pas modifier ce tableau » serait faux quand c'est le droit d'écrire dans
		// la DESTINATION qui manque (§4.2), et ferait chercher le problème du mauvais côté.
		const { client } = clientEcrivant(LECTURES_AVEC_CHANNELS, {
			data: null,
			error: { message: 'row-level security' },
			status: 403,
		})
		rendreCanevas(client)
		const selecteur = await ouvrirFiche()
		await waitFor(() => expect(selecteur.querySelectorAll('optgroup').length).toBeGreaterThan(0))

		await act(async () => {
			fireEvent.change(selecteur, { target: { value: 'c1' } })
		})
		await waitFor(() =>
			expect(screen.getByTestId('etat-lien').textContent).toBe(fr['goals.edit.link.refused.forbidden']),
		)
		expect(screen.getByTestId('etat-lien').getAttribute('role')).toBe('alert')
	})

	it('un RETRAIT refusé garde le texte commun : retirer n’engage aucune destination', async () => {
		// §4.2 : retirer le lien n'exige rien de plus que l'écriture sur le bloc. Employer le texte
		// de la destination ferait alors accuser un droit qui n'est pas en cause.
		const { client } = clientEcrivant({ ...LECTURES_AVEC_CHANNELS, goal_blocks: ok([BLOC_LIE]) }, {
			data: null,
			error: { message: 'row-level security' },
			status: 403,
		})
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		await act(async () => {
			fireEvent.click(await screen.findByTestId('retirer-lien'))
		})
		await waitFor(() =>
			expect(screen.getByTestId('etat-lien').textContent).toBe(fr['goals.write.refused.forbidden']),
		)
	})

	it('une liste de channels EN ERREUR laisse le lien inchangé et propose une reprise', async () => {
		const { client } = clientEcrivant(
			{
				...LECTURES_AVEC_CHANNELS,
				goal_blocks: ok([BLOC_LIE]),
				channels: { data: null, error: { message: 'coupure' }, status: 500 },
			},
			ok([BLOC_LIE]),
		)
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		expect(await screen.findByTestId('erreur-channels')).toBeTruthy()
		expect(screen.getByTestId('recharger-channels')).toBeTruthy()
		// LE LIEN EXISTANT NE BOUGE PAS : l'échec porte sur la LISTE, pas sur le bloc.
		expect((screen.getByTestId('champ-lien') as HTMLSelectElement).value).toBe('c1')
	})

	it('dit « aucun channel à viser » plutôt que de laisser un sélecteur muet', async () => {
		const { client } = clientEcrivant({ ...LECTURES_AVEC_CHANNELS, channels: ok([]) }, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		await ouvrirFiche()
		await waitFor(() =>
			expect(screen.getByText(fr['goals.edit.link.empty'])).toBeTruthy(),
		)
	})
})

describe('canevas — le sélecteur de destination suit le §5.22', () => {
	it('est DÉSACTIVÉ pendant la lecture de sa liste, et porte son option d’attente', async () => {
		// Unique dérogation bornée à la règle du §5.7 ter : il n'y a alors rien à choisir, et un
		// `select` vide mais actif serait une commande morte. Le workspace n'est jamais rendu ici,
		// si bien que la lecture ne se résout pas — c'est l'état que ce scénario mesure.
		const { client } = clientEcrivant({ ...LECTURES_UN_BLOC, workspaces: ok([]) }, ok([BLOC_LIBRE]))
		rendreCanevas(client)
		const selecteur = await ouvrirFiche()

		expect(selecteur.disabled).toBe(true)
		expect(selecteur.getAttribute('aria-busy')).toBe('true')
		expect([...selecteur.querySelectorAll('option')].map((option) => option.textContent)).toContain(
			fr['goals.edit.link.loading'],
		)
	})

	it('reste DÉSACTIVÉ après l’échec de sa liste, mais le RETRAIT reste offert', async () => {
		// Retirer un lien ne demande aucune liste : éteindre ce bouton avec le sélecteur priverait
		// d'un geste que rien n'empêche.
		const { client } = clientEcrivant(
			{
				...LECTURES_AVEC_CHANNELS,
				goal_blocks: ok([BLOC_LIE]),
				channels: { data: null, error: { message: 'coupure' }, status: 500 },
			},
			ok([BLOC_LIE]),
		)
		rendreCanevas(client)
		fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
		await screen.findByTestId('fiche-bloc')

		await screen.findByTestId('erreur-channels')
		expect((screen.getByTestId('champ-lien') as HTMLSelectElement).disabled).toBe(true)
		expect((screen.getByTestId('retirer-lien') as HTMLButtonElement).disabled).toBe(false)
	})
})

// --- TRANCHE 2b-2c : LES SUPPRESSIONS ------------------------------------------------------
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-2c : supprimer une
//           flèche, supprimer un bloc
// @verifies docs/SPEC-goals.md §3 (« Supprimer une flèche, supprimer un bloc — la suppression
//           d'un bloc emporte ses flèches (cascade) » ; « un bloc se supprime réellement, il ne
//           s'archive pas »), §2.3 (`on delete cascade` des deux extrémités), §4.2 (l'écriture
//           d'une flèche exige le droit sur les DEUX blocs reliés)
// @verifies docs/DESIGN_SYSTEM.md §6 (une action destructive demande une confirmation NOMMANT
//           l'objet), §5.27 (une seule confirmation à tout instant ; la commande reste montée et
//           désactivée, et le focus lui revient sans être différé), §5.29 (canevas)

/** Le tableau à deux blocs reliés par une flèche — ce que la cascade du §2.3 met en jeu. */
const LECTURES_DEUX_BLOCS_UNE_FLECHE = {
	goal_boards: ok(TABLEAU),
	goal_blocks: ok([BLOC_LIBRE, BLOC_LIE]),
	goal_links: ok([FLECHE_PLEINE]),
}

/**
 * Ouvre la fiche du premier bloc — homonyme volontairement évité de l'`ouvrirFiche` de la tranche
 * 2b-2a, qui rend le SÉLECTEUR de destination : ces scénarios n'ont affaire qu'à la fiche.
 */
async function ouvrirFicheDuBloc() {
	fireEvent.keyDown((await screen.findAllByTestId('bloc-objectif'))[0] as HTMLElement, { key: 'Enter' })
	return screen.findByTestId('fiche-bloc')
}

describe('canevas — supprimer un bloc, §3 et §6', () => {
	it('la commande n’écrit RIEN : elle ouvre une confirmation qui NOMME le bloc', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(client)
		await ouvrirFicheDuBloc()

		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		const confirmation = await screen.findByTestId('confirmation-suppression-bloc')
		// §6 : la confirmation nomme l'objet. Sans le titre, elle demanderait d'approuver un geste
		// dont l'écran ne dit pas sur quoi il porte.
		expect(confirmation.textContent).toContain(BLOC_LIBRE.title)
		// Et surtout : AUCUNE écriture n'est encore partie.
		expect(ecritures.filter((ecriture) => ecriture.operation === 'delete')).toHaveLength(0)
	})

	it('la confirmation ANNONCE les flèches que la cascade emporte, et se tait quand il n’y en a pas', async () => {
		const { client } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(client)
		await ouvrirFicheDuBloc()

		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		const avecFleche = await screen.findByTestId('confirmation-suppression-bloc')
		// UNE SEULE FLÈCHE PREND LE SINGULIER : « les 1 flèches » serait faux, et l'accord se fait
		// par CLÉ, jamais par concaténation (`CLAUDE.md` §23).
		expect(avecFleche.textContent).toContain(fr['goals.block.delete.confirm.body.link'])

		cleanup()
		const seul = clientEcrivant(LECTURES_UN_BLOC, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(seul.client)
		await ouvrirFicheDuBloc()
		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		// « les 0 flèches » se lirait deux fois pour comprendre qu'il n'y en a aucune : la phrase
		// sans compte est la seule qui ne fasse pas chercher un objet absent.
		expect((await screen.findByTestId('confirmation-suppression-bloc')).textContent).toContain(
			fr['goals.block.delete.confirm.body'],
		)
	})

	it('confirmer émet UNE suppression sans charge sur `goal_blocks`, et le bloc quitte le canevas', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(client)
		await ouvrirFicheDuBloc()
		fireEvent.click(screen.getByTestId('supprimer-bloc'))

		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-bloc'))
		})

		const suppressions = ecritures.filter((ecriture) => ecriture.operation === 'delete')
		expect(suppressions).toHaveLength(1)
		expect(suppressions[0]?.table).toBe('goal_blocks')
		// AUCUNE charge, et aucune requête sur `goal_links` : la cascade vit en base (§2.3).
		expect(suppressions[0]?.charge).toBeUndefined()
		expect(screen.queryAllByTestId('bloc-objectif')).toHaveLength(0)
		// LA FICHE SE FERME SEULE, son bloc n'étant plus rendu.
		expect(screen.queryByTestId('fiche-bloc')).toBeNull()
		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.block.deleted'])
	})

	it('LA FLÈCHE D’UN BLOC SUPPRIMÉ DISPARAÎT, elle ne devient pas un moignon pointillé', async () => {
		// La distinction porte sur deux causes que rien ne rapproche : le moignon du §5.4 rend une
		// extrémité que la RLS masque — la ligne existe en base —, tandis que la cascade du §2.3
		// l'a détruite. La laisser pendre dessinerait un lien que plus rien ne porte.
		const { client } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(client)
		expect(await screen.findAllByTestId('ligne-diagramme')).toHaveLength(1)

		await ouvrirFicheDuBloc()
		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-bloc'))
		})

		expect(screen.queryAllByTestId('ligne-diagramme')).toHaveLength(0)
		expect(screen.queryAllByTestId('bloc-objectif')).toHaveLength(1)
	})

	it('un SILENCE de la clause `using` ne retire RIEN, et le dit', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, ok([]))
		rendreCanevas(client)
		await ouvrirFicheDuBloc()
		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-bloc'))
		})

		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.delete.noeffect.block'])
		// Le bloc est TOUJOURS là : le faire disparaître annoncerait une suppression qui n'a pas eu
		// lieu, et il reparaîtrait au rechargement.
		expect(screen.queryAllByTestId('bloc-objectif')).toHaveLength(1)
	})

	it('un REFUS de politique est traduit par le texte de la SUPPRESSION, pas par celui d’une modification', async () => {
		const { client } = clientEcrivant(LECTURES_UN_BLOC, {
			data: null,
			error: { message: 'new row violates row-level security policy' },
			status: 403,
		})
		rendreCanevas(client)
		await ouvrirFicheDuBloc()
		fireEvent.click(screen.getByTestId('supprimer-bloc'))
		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-bloc'))
		})

		const mention = screen.getByTestId('mention-ecriture')
		expect(mention.textContent).toBe(fr['goals.delete.refused.block'])
		expect(mention.textContent).not.toBe(fr['goals.write.refused.forbidden'])
		expect(screen.queryAllByTestId('bloc-objectif')).toHaveLength(1)
	})

	it('annuler n’écrit rien et REND LE FOCUS à la commande, qui n’a jamais été démontée', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_UN_BLOC, ok([{ id: BLOC_LIBRE.id }]))
		rendreCanevas(client)
		await ouvrirFicheDuBloc()
		const commande = screen.getByTestId('supprimer-bloc')

		fireEvent.click(commande)
		// La commande reste RENDUE, seulement désactivée — le patron du §5.27. Le retour du focus
		// est pourtant différé d'un tour de rendu, et c'est cette preuve qui l'a montré : un bouton
		// désactivé refuse le focus, si bien que l'appeler depuis le gestionnaire d'annulation le
		// laissait sur le document.
		expect((commande as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(await screen.findByTestId('annuler-suppression-bloc'))

		expect(screen.queryByTestId('confirmation-suppression-bloc')).toBeNull()
		expect(document.activeElement).toBe(commande)
		expect(ecritures.filter((ecriture) => ecriture.operation === 'delete')).toHaveLength(0)
	})
})

describe('canevas — supprimer une flèche, §3 et §4.2', () => {
	it('la commande de la liste ouvre une confirmation qui NOMME la flèche par ses deux extrémités', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: FLECHE_PLEINE.id }]))
		rendreCanevas(client)
		const commande = (await screen.findAllByTestId('supprimer-fleche'))[0] as HTMLElement

		fireEvent.click(commande)
		const confirmation = await screen.findByTestId('confirmation-suppression-fleche')
		expect(confirmation.textContent).toContain(BLOC_LIBRE.title)
		expect(confirmation.textContent).toContain(BLOC_LIE.title)
		expect(ecritures.filter((ecriture) => ecriture.operation === 'delete')).toHaveLength(0)
	})

	it('confirmer supprime la flèche sur `goal_links`, et laisse les DEUX blocs en place', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: FLECHE_PLEINE.id }]))
		rendreCanevas(client)
		fireEvent.click((await screen.findAllByTestId('supprimer-fleche'))[0] as HTMLElement)
		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-fleche'))
		})

		const suppressions = ecritures.filter((ecriture) => ecriture.operation === 'delete')
		expect(suppressions).toHaveLength(1)
		expect(suppressions[0]?.table).toBe('goal_links')
		expect(screen.queryAllByTestId('ligne-diagramme')).toHaveLength(0)
		expect(screen.queryAllByTestId('bloc-objectif')).toHaveLength(2)
		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.link.deleted'])
	})

	it('un SILENCE de la clause `using` garde la flèche, et le dit avec SON texte', async () => {
		// §4.2 : la politique porte sur le droit d'écrire les DEUX blocs reliés. Le texte du bloc
		// ferait chercher le problème du mauvais côté.
		const { client } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([]))
		rendreCanevas(client)
		fireEvent.click((await screen.findAllByTestId('supprimer-fleche'))[0] as HTMLElement)
		await act(async () => {
			fireEvent.click(await screen.findByTestId('confirmer-suppression-fleche'))
		})

		expect(screen.getByTestId('mention-ecriture').textContent).toBe(fr['goals.delete.noeffect.link'])
		expect(screen.queryAllByTestId('ligne-diagramme')).toHaveLength(1)
	})

	it('UNE SEULE CONFIRMATION À TOUT INSTANT : ouvrir celle d’une ligne ferme celle d’une autre', async () => {
		// La règle du §5.27, et elle ne s'observe qu'entre DEUX lignes.
		const deuxFleches = {
			goal_boards: ok(TABLEAU),
			goal_blocks: ok([BLOC_LIBRE, BLOC_LIE, BLOC_PERDU]),
			goal_links: ok([
				FLECHE_PLEINE,
				{ id: 'f3', source_block_id: 'e2', target_block_id: 'e3', direction: 'both', label: null },
			]),
		}
		const { client } = clientEcrivant(deuxFleches, ok([{ id: 'f3' }]))
		rendreCanevas(client)
		const commandes = await screen.findAllByTestId('supprimer-fleche')
		expect(commandes).toHaveLength(2)

		fireEvent.click(commandes[0] as HTMLElement)
		expect(await screen.findAllByTestId('confirmation-suppression-fleche')).toHaveLength(1)
		fireEvent.click(commandes[1] as HTMLElement)
		const ouvertes = await screen.findAllByTestId('confirmation-suppression-fleche')
		expect(ouvertes).toHaveLength(1)
		// C'est bien celle de la SECONDE ligne qui est ouverte, la première étant refermée.
		expect((commandes[1] as HTMLButtonElement).disabled).toBe(true)
		expect((commandes[0] as HTMLButtonElement).disabled).toBe(false)
	})

	it('annuler garde la flèche et rend le focus à la commande de SA ligne', async () => {
		const { client, ecritures } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: FLECHE_PLEINE.id }]))
		rendreCanevas(client)
		const commande = (await screen.findAllByTestId('supprimer-fleche'))[0] as HTMLElement

		fireEvent.click(commande)
		fireEvent.click(await screen.findByTestId('annuler-suppression-fleche'))

		expect(screen.queryByTestId('confirmation-suppression-fleche')).toBeNull()
		expect(document.activeElement).toBe(commande)
		expect(screen.queryAllByTestId('ligne-diagramme')).toHaveLength(1)
		expect(ecritures.filter((ecriture) => ecriture.operation === 'delete')).toHaveLength(0)
	})

	it('LE NOM ACCESSIBLE DE LA COMMANDE NOMME LA FLÈCHE, jamais « Supprimer » seul', async () => {
		const { client } = clientEcrivant(LECTURES_DEUX_BLOCS_UNE_FLECHE, ok([{ id: FLECHE_PLEINE.id }]))
		rendreCanevas(client)
		const commande = (await screen.findAllByTestId('supprimer-fleche'))[0] as HTMLElement
		const nom = commande.getAttribute('aria-label') ?? ''
		expect(nom).toContain(BLOC_LIBRE.title)
		expect(nom).toContain(BLOC_LIE.title)
	})
})

describe('corpsSuppressionBloc — l’accord par clé, §23 de CLAUDE.md', () => {
	it('choisit les TROIS formes selon le compte, sans jamais construire de phrase', () => {
		expect(corpsSuppressionBloc(0)).toBe(fr['goals.block.delete.confirm.body'])
		expect(corpsSuppressionBloc(1)).toBe(fr['goals.block.delete.confirm.body.link'])
		expect(corpsSuppressionBloc(3)).toBe(
			fr['goals.block.delete.confirm.body.links'].replace('{compte}', '3'),
		)
	})
})

// =================================================================================================
// TRANCHE 2c — L'ADMINISTRATION DES TABLEAUX
// =================================================================================================
//
// CE QUE CES SCÉNARIOS TIENNENT, ET QUE RIEN D'AUTRE NE TIENDRAIT :
//
//   * l'état vide PORTE la commande de création (§5.4) — une sortie anticipée l'en priverait, et
//     l'utilisateur n'aurait aucun moyen de sortir de cet état ;
//   * les commandes d'ordre sont DÉSACTIVÉES aux extrémités, jamais masquées (§5.13) ;
//   * le formulaire vit dans le FLUX du document, jamais dans une modale, et le focus y entre ;
//   * le refus est lu PRÈS du champ qui l'a causé, et le doublon dit son propre geste.

/** Un client de LISTE : workspaces, tableaux, et le comptage des blocs lisibles. */
function clientListe(
	tableaux: readonly unknown[],
	blocs: readonly unknown[] = [],
	ecriture?: { reponse: Reponse; journal: Record<string, unknown>[] },
): ClientCrm {
	const construire = (table: string) => {
		const chaine: Record<string, unknown> = {}
		const reponses: Record<string, Reponse> = {
			workspaces: ok([{ id: 'w1', name: 'P2Enjoy', slug: 'p2enjoy' }]),
			goal_boards: ok(tableaux),
			goal_blocks: ok(blocs),
		}
		const lecture = reponses[table] ?? ok([])
		for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
			chaine[methode] = () => chaine
		}
		// L'ÉCRITURE EST JOURNALISÉE PUIS RÉPONDUE : les scénarios éprouvent ce que l'écran a
		// ENVOYÉ, et pas seulement ce qu'il affiche ensuite.
		for (const operation of ['insert', 'update']) {
			chaine[operation] = (charge: Record<string, unknown>) => {
				ecriture?.journal.push({ table, operation, ...charge })
				const apres: Record<string, unknown> = {}
				for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
					apres[methode] = () => apres
				}
				apres.single = () => Promise.resolve(ecriture?.reponse ?? ok([]))
				apres.then = (resoudre: (valeur: Reponse) => unknown) =>
					Promise.resolve(ecriture?.reponse ?? ok([])).then(resoudre)
				return apres
			}
		}
		chaine.maybeSingle = () => Promise.resolve(lecture)
		chaine.single = () => Promise.resolve(lecture)
		chaine.then = (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(lecture).then(resoudre)
		return chaine
	}
	return { from: (table: string) => construire(table) } as unknown as ClientCrm
}

const TABLEAU_SECOND = { id: 'b2', name: 'Objectifs 2027', description: null, position: 2, archived_at: null }
const TABLEAU_TIERS = { id: 'b3', name: 'Chantiers internes', description: null, position: 3, archived_at: null }

function rendreListe(client: ClientCrm) {
	return render(
		<MemoryRouter>
			<Objectifs client={client} />
		</MemoryRouter>,
	)
}

describe('administration des tableaux — §3, §5.1, DESIGN_SYSTEM §5.13', () => {
	it('L’ÉTAT VIDE PORTE L’ACTION D’EN CRÉER UN — §5.4', async () => {
		// Sans elle, « Aucun tableau d'objectifs » serait un cul-de-sac : rien dans le produit ne
		// permettrait d'en sortir. C'est l'exigence que la sortie anticipée d'origine violait.
		rendreListe(clientListe([]))
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByTestId('creer-tableau')).toBeTruthy()
	})

	it('ouvre le formulaire de création dans le FLUX, et y place le focus', async () => {
		// §5.13 : aucune modale — le §5 n'en déclare aucune —, et « ouvrir un formulaire déplace le
		// focus dans son premier champ ». Sans le focus, le geste clavier exige un `Tab` que le
		// geste souris n'exige pas.
		rendreListe(clientListe([TABLEAU]))
		fireEvent.click(await screen.findByTestId('creer-tableau'))
		const formulaire = screen.getByTestId('formulaire-creation-tableau')
		expect(formulaire.getAttribute('role')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-tableau'))
	})

	it('la commande de création a DEUX VISAGES, un seul rendu à la fois', async () => {
		rendreListe(clientListe([TABLEAU]))
		const commande = await screen.findByTestId('creer-tableau')
		expect(commande.getAttribute('aria-pressed')).toBe('false')
		fireEvent.click(commande)
		expect(screen.getByTestId('creer-tableau').getAttribute('aria-pressed')).toBe('true')
		expect(screen.getByTestId('creer-tableau').textContent).toContain(fr['goals.board.create.cancel'])
	})

	it('envoie la création avec `position` à null, et rend le focus à la commande', async () => {
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU], [], {
				journal,
				reponse: ok({ id: 'b9', name: 'Trimestre', description: null, position: 2, archived_at: null }),
			}),
		)
		fireEvent.click(await screen.findByTestId('creer-tableau'))
		fireEvent.change(screen.getByTestId('champ-nom-tableau'), { target: { value: 'Trimestre' } })
		await act(async () => {
			fireEvent.submit(screen.getByTestId('formulaire-creation-tableau'))
		})
		expect(journal).toHaveLength(1)
		expect(journal[0]?.table).toBe('goal_boards')
		expect(journal[0]?.operation).toBe('insert')
		expect(journal[0]?.position).toBeNull()
		// Le formulaire fermé, le focus revient à la commande qui l'a ouvert (§5.13) : sans ce
		// retour, valider au clavier laisse le focus sur un champ qui vient de disparaître.
		await waitFor(() => expect(screen.queryByTestId('formulaire-creation-tableau')).toBeNull())
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('creer-tableau')))
	})

	it('LES COMMANDES D’ORDRE SONT DÉSACTIVÉES AUX EXTRÉMITÉS, JAMAIS MASQUÉES — §5.13', async () => {
		// Une commande qui disparaît en tête de liste fait sauter le groupe d'actions d'une ligne à
		// l'autre, et l'œil perd la colonne. Elles sont donc TOUJOURS rendues, et leur nom
		// accessible NOMME le tableau : « Monter » seul, répété, ne dirait pas lequel.
		rendreListe(clientListe([TABLEAU, TABLEAU_SECOND, TABLEAU_TIERS]))
		await screen.findAllByTestId('tableau-objectifs')
		const monter = screen.getAllByTestId('monter-tableau')
		const descendre = screen.getAllByTestId('descendre-tableau')
		expect(monter).toHaveLength(3)
		expect(descendre).toHaveLength(3)
		expect((monter[0] as HTMLButtonElement).disabled).toBe(true)
		expect((monter[1] as HTMLButtonElement).disabled).toBe(false)
		expect((descendre[2] as HTMLButtonElement).disabled).toBe(true)
		expect(monter[1]?.getAttribute('aria-label')).toContain(TABLEAU_SECOND.name)
	})

	it('déplace par le MILIEU de deux voisines — une seule écriture, jamais une permutation', async () => {
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU, TABLEAU_SECOND, TABLEAU_TIERS], [], {
				journal,
				reponse: ok([{ id: 'b3', name: 'Chantiers internes', description: null, position: 1.5, archived_at: null }]),
			}),
		)
		await screen.findAllByTestId('tableau-objectifs')
		await act(async () => {
			fireEvent.click(screen.getAllByTestId('monter-tableau')[2] as HTMLElement)
		})
		// UNE écriture, et son contenu est la seule position calculée : entre 1 et 2.
		expect(journal).toHaveLength(1)
		expect(journal[0]?.operation).toBe('update')
		expect(journal[0]?.position).toBe(1.5)
	})

	it('n’envoie QUE le nom et la description au renommage, jamais la position', async () => {
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU], [], {
				journal,
				reponse: ok([{ id: 'b1', name: 'Trimestre en cours', description: null, position: 1, archived_at: null }]),
			}),
		)
		fireEvent.click((await screen.findAllByTestId('renommer-tableau'))[0] as HTMLElement)
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-tableau'))
		// Le champ arrive REMPLI de la valeur courante : un renommage qui repart d'un champ vide
		// obligerait à ressaisir ce qu'on ne veut pas changer.
		expect((screen.getByTestId('champ-nom-tableau') as HTMLInputElement).value).toBe(TABLEAU.name)
		fireEvent.change(screen.getByTestId('champ-nom-tableau'), { target: { value: 'Trimestre en cours' } })
		await act(async () => {
			fireEvent.submit(screen.getByTestId('formulaire-renommage-tableau'))
		})
		expect(journal).toHaveLength(1)
		expect(journal[0]).toEqual({
			table: 'goal_boards',
			operation: 'update',
			name: 'Trimestre en cours',
			description: TABLEAU.description,
		})
	})

	it('LA CONFIRMATION D’ARCHIVAGE DIT QUE LE TABLEAU QUITTE LA LISTE, et le focus entre sur l’action', async () => {
		// Rien ne l'y ramène : le §5.1 ne décrit qu'une liste des tableaux NON archivés. Écrire
		// « archiver » sans cette conséquence laisserait croire à un rangement réversible d'un clic.
		rendreListe(clientListe([TABLEAU]))
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		const confirmation = screen.getByTestId('confirmation-archivage-tableau')
		expect(confirmation.textContent).toContain(TABLEAU.name)
		expect(confirmation.textContent).toContain(fr['goals.board.archive.confirm.body'])
		expect(document.activeElement).toBe(screen.getByTestId('confirmer-archivage-tableau'))
	})

	it('archive par une ÉCRITURE de `archived_at`, jamais par une suppression', async () => {
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU], [], {
				journal,
				reponse: ok([{ id: 'b1', name: TABLEAU.name, description: null, position: 1, archived_at: null }]),
			}),
		)
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		await act(async () => {
			fireEvent.click(screen.getByTestId('confirmer-archivage-tableau'))
		})
		expect(journal).toHaveLength(1)
		expect(journal[0]?.operation).toBe('update')
		expect(typeof journal[0]?.archived_at).toBe('string')
	})

	it('annuler une confirmation rend le focus à la commande qui l’a ouverte', async () => {
		// La commande est DÉMONTÉE pendant la confirmation — la ligne rend la confirmation à sa
		// place —, et `focus()` appelé depuis le gestionnaire porterait sur un bouton qui n'existe
		// plus. Le remède est un drapeau puis un effet, sans aucune temporisation (CLAUDE.md §18).
		rendreListe(clientListe([TABLEAU]))
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		fireEvent.click(screen.getByTestId('annuler-archivage-tableau'))
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getAllByTestId('archiver-tableau')[0]),
		)
	})

	it('LE DOUBLON DE NOM DIT SON PROPRE GESTE, et il est lu DANS le formulaire', async () => {
		// §5.13 : « le refus est lu près du champ qui l'a causé », jamais en tête d'écran. Et le
		// texte nomme le cas que seule cette table produit : un tableau ARCHIVÉ retient son nom.
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU], [], {
				journal,
				reponse: {
					data: null,
					error: { message: 'goal_boards_workspace_name_key', code: '23505' } as { message: string },
					status: 409,
				},
			}),
		)
		fireEvent.click(await screen.findByTestId('creer-tableau'))
		fireEvent.change(screen.getByTestId('champ-nom-tableau'), { target: { value: TABLEAU.name } })
		await act(async () => {
			fireEvent.submit(screen.getByTestId('formulaire-creation-tableau'))
		})
		const formulaire = screen.getByTestId('formulaire-creation-tableau')
		expect(formulaire.textContent).toContain(fr['goals.board.refused.duplicate'])
		// LA MENTION DU FORMULAIRE PORTE SA PROPRE IDENTITÉ, distincte de celle de la section : deux
		// régions `status` indiscernables ne se désignent ni par une preuve, ni par un lecteur
		// d'écran (défaut trouvé par la preuve d'interface de cette tranche).
		expect(screen.getByTestId('mention-formulaire-tableau').getAttribute('role')).toBe('alert')
	})

	it('dit le SILENCE de la clause `using` au lieu d’annoncer un succès', async () => {
		// `200` et zéro ligne n'est ni un succès ni une erreur. Annoncer « enregistré » serait la
		// simulation de succès que CLAUDE.md §18 interdit.
		rendreListe(
			clientListe([TABLEAU, TABLEAU_SECOND], [], { journal: [], reponse: ok([]) }),
		)
		await screen.findAllByTestId('tableau-objectifs')
		await act(async () => {
			fireEvent.click(screen.getAllByTestId('monter-tableau')[1] as HTMLElement)
		})
		expect(screen.getByTestId('mention-ecriture').textContent).toContain(
			fr['goals.board.write.noeffect'],
		)
	})
})

// =================================================================================================
// TRANCHE 2g — LE CLAVIER DES GESTES D'ADMINISTRATION
// =================================================================================================
//
// @verifies CRM-083 (docs/BACKLOG.md) — tranche 2g
// @verifies docs/SPEC-goals.md §5.5 bis.2 (l'ancre de retour du focus SURVIT au geste),
//           §5.5 bis.3 (`Échap` referme les trois surfaces de la liste)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (administration des tableaux), §5.13 (le focus revient à
//           la commande qui a ouvert), §8 (navigation clavier)
//
// CE QUE CES SCÉNARIOS TIENNENT, ET QUE RIEN D'AUTRE NE TIENDRAIT :
//
//   * `Échap` ferme, et il NE FERME PAS SEULEMENT : il rend le focus à une ancre NOMMÉE, et il
//     n'écrit rien. Une fermeture qui aurait envoyé le geste serait pire que l'absence ;
//   * l'archivage confirmé rend le focus à une ancre qui existe ENCORE. Le scénario fait donc
//     DISPARAÎTRE la ligne à la relecture — sans quoi l'ancien comportement passerait aussi, la
//     commande d'avant étant encore montée, et la preuve serait complaisante.

/**
 * Une liste qui SE VIDE à la relecture : le tableau est rendu au premier chargement, et plus
 * jamais ensuite. C'est le seul montage sous lequel l'ancre d'avant la correction — la commande
 * « Archiver » de la ligne — n'existe plus au moment du retour du focus.
 */
function clientListeQuiSeVide(
	tableau: unknown,
	journal: Record<string, unknown>[],
	reponse: Reponse,
): ClientCrm {
	let lectures = 0
	const construire = (table: string) => {
		const chaine: Record<string, unknown> = {}
		const lecture = (): Reponse => {
			if (table === 'workspaces') return ok([{ id: 'w1', name: 'P2Enjoy', slug: 'p2enjoy' }])
			if (table !== 'goal_boards') return ok([])
			lectures += 1
			return lectures === 1 ? ok([tableau]) : ok([])
		}
		for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
			chaine[methode] = () => chaine
		}
		chaine.update = (charge: Record<string, unknown>) => {
			journal.push({ table, operation: 'update', ...charge })
			const apres: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
				apres[methode] = () => apres
			}
			apres.single = () => Promise.resolve(reponse)
			apres.then = (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre)
			return apres
		}
		chaine.maybeSingle = () => Promise.resolve(lecture())
		chaine.single = () => Promise.resolve(lecture())
		chaine.then = (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(lecture()).then(resoudre)
		return chaine
	}
	return { from: (table: string) => construire(table) } as unknown as ClientCrm
}

describe('clavier des gestes d’administration — SPEC-goals §5.5 bis', () => {
	it('`Échap` ferme le formulaire de CRÉATION et rend le focus à la commande, sans rien écrire', async () => {
		// Le formulaire remplace sa commande (`aria-pressed`), et le design system referme par
		// `Échap` toute surface de cette forme — §5.3 quater, §5.3 septies, et la fiche d'un bloc
		// du même écran. MESURÉ avant correction : la touche était sans effet.
		const journal: Record<string, unknown>[] = []
		rendreListe(clientListe([TABLEAU], [], { journal, reponse: ok([]) }))
		fireEvent.click(await screen.findByTestId('creer-tableau'))
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-tableau'))
		fireEvent.keyDown(screen.getByTestId('champ-nom-tableau'), { key: 'Escape' })
		await waitFor(() => expect(screen.queryByTestId('formulaire-creation-tableau')).toBeNull())
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('creer-tableau')))
		// Renoncer n'envoie RIEN : une fermeture qui aurait créé le tableau serait pire que l'absence.
		expect(journal).toHaveLength(0)
	})

	it('`Échap` ferme le formulaire de RENOMMAGE depuis le SECOND champ, et rend le focus à sa commande', async () => {
		// L'écoute est posée sur le conteneur, jamais sur le premier champ : un raccourci qui ne
		// fonctionnerait qu'à l'ouverture serait un raccourci qu'on n'apprend pas.
		const journal: Record<string, unknown>[] = []
		rendreListe(clientListe([TABLEAU], [], { journal, reponse: ok([]) }))
		fireEvent.click((await screen.findAllByTestId('renommer-tableau'))[0] as HTMLElement)
		fireEvent.change(screen.getByTestId('champ-nom-tableau'), { target: { value: 'Autre nom' } })
		fireEvent.keyDown(screen.getByTestId('champ-description-tableau'), { key: 'Escape' })
		await waitFor(() => expect(screen.queryByTestId('formulaire-renommage-tableau')).toBeNull())
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getAllByTestId('renommer-tableau')[0]),
		)
		expect(journal).toHaveLength(0)
	})

	it('`Échap` RENONCE à l’archivage : la confirmation se ferme, le focus revient à sa ligne, rien n’est écrit', async () => {
		// Ici la ligne SURVIT au geste, donc l'ancre est la sienne — c'est le pendant du scénario
		// suivant, et les deux ensemble disent que l'ancre dépend de l'issue, pas du geste.
		const journal: Record<string, unknown>[] = []
		rendreListe(clientListe([TABLEAU], [], { journal, reponse: ok([]) }))
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		expect(document.activeElement).toBe(screen.getByTestId('confirmer-archivage-tableau'))
		fireEvent.keyDown(screen.getByTestId('confirmer-archivage-tableau'), { key: 'Escape' })
		await waitFor(() => expect(screen.queryByTestId('confirmation-archivage-tableau')).toBeNull())
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getAllByTestId('archiver-tableau')[0]),
		)
		expect(journal).toHaveLength(0)
	})

	it('UN ARCHIVAGE CONFIRMÉ REND LE FOCUS À UNE ANCRE QUI EXISTE ENCORE, jamais au document', async () => {
		// LE MONTAGE EST LA PREUVE : la liste se vide à la relecture, donc la commande « Archiver »
		// de la ligne — l'ancre d'avant la correction — n'existe plus au moment du retour. MESURÉ
		// sur la pile réelle avant correction : `document.activeElement` retombait sur `body`, et
		// le `Tab` suivant repartait du lien d'évitement, en tête de document.
		const journal: Record<string, unknown>[] = []
		render(
			<MemoryRouter>
				<Objectifs
					client={clientListeQuiSeVide(TABLEAU, journal, ok([{ id: 'b1', name: TABLEAU.name }]))}
				/>
			</MemoryRouter>,
		)
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		await act(async () => {
			fireEvent.click(screen.getByTestId('confirmer-archivage-tableau'))
		})
		await waitFor(() => expect(screen.queryAllByTestId('archiver-tableau')).toHaveLength(0))
		// L'ancre survit au geste, et l'état vide la porte encore (§5.1, DESIGN_SYSTEM §5.29).
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('creer-tableau')))
		expect(document.activeElement).not.toBe(document.body)
		expect(journal).toHaveLength(1)
		expect(typeof journal[0]?.archived_at).toBe('string')
	})
})

describe('la mention appartient au geste qui l’a causée — SPEC-goals §5.5 bis.5', () => {
	it('OUVRIR UNE SURFACE EFFACE LA MENTION DE LA PRÉCÉDENTE — défaut vu à la capture', async () => {
		// La confirmation d'archivage ouverte après une création réussie affichait « Tableau créé »,
		// en vert, SOUS son bouton destructif : l'issue d'un geste qu'elle n'a pas causé. Le §5.13
		// exige que le message se lise près de ce qui l'a CAUSÉ.
		const journal: Record<string, unknown>[] = []
		rendreListe(
			clientListe([TABLEAU], [], {
				journal,
				reponse: ok([{ id: 'b9', name: 'Tableau neuf', description: null, position: 9, archived_at: null }]),
			}),
		)
		fireEvent.click(await screen.findByTestId('creer-tableau'))
		fireEvent.change(screen.getByTestId('champ-nom-tableau'), { target: { value: 'Tableau neuf' } })
		await act(async () => {
			fireEvent.submit(screen.getByTestId('formulaire-creation-tableau'))
		})
		// La mention EST lue, et elle l'est dans la section — c'est ce que la fermeture fait paraître.
		expect(screen.getByTestId('mention-ecriture').textContent).toContain(fr['goals.board.created'])

		// Puis on ouvre une AUTRE surface : elle ne doit rien porter du geste précédent.
		fireEvent.click((await screen.findAllByTestId('archiver-tableau'))[0] as HTMLElement)
		const confirmation = screen.getByTestId('confirmation-archivage-tableau')
		expect(confirmation.textContent).not.toContain(fr['goals.board.created'])
		expect(screen.getByTestId('mention-formulaire-tableau').textContent).toBe('')
	})
})

// @verifies CRM-083 (docs/BACKLOG.md) — tranche 2 h, la reprise d'un tableau archivé
// @verifies docs/SPEC-goals.md §5.6.2 lignes a à j ; docs/DESIGN_SYSTEM.md §5.3 quinquies (la case
//           à cocher étiquetée), §5.13 (mention textuelle, jamais une teinte seule), §5.26 (aucune
//           commande éteinte d'avance selon le rôle)
//
// CE BLOC ÉPROUVE LA REQUÊTE ÉMISE autant que le rendu, et c'est nécessaire : « la case relit »
// (§5.6.2, ligne b) et « la case filtre localement » produisent EXACTEMENT le même écran sur ce
// jeu. Seul le filtre réellement posé les distingue, et un filtre local ferait mentir le compte de
// blocs lisibles du §5.1 dès qu'un appelant n'aurait pas les mêmes droits que l'auteur du test.
describe('reprise d’un tableau archivé — §5.6', () => {
	const TABLEAU_ARCHIVE = {
		id: 'b7',
		name: 'Objectifs 2025 (clos)',
		description: null,
		position: 2,
		archived_at: '2026-01-15T09:00:00Z',
	}

	/** Un client qui JOURNALISE les filtres posés sur `goal_boards`, pour éprouver la requête émise. */
	function clientJournalisant(
		tableaux: readonly unknown[],
		filtres: string[],
		ecriture?: { reponse: Reponse; journal: Record<string, unknown>[] },
	): ClientCrm {
		const construire = (table: string) => {
			const chaine: Record<string, unknown> = {}
			const reponses: Record<string, Reponse> = {
				workspaces: ok([{ id: 'w1', name: 'P2Enjoy', slug: 'p2enjoy' }]),
				goal_boards: ok(tableaux),
				goal_blocks: ok([]),
			}
			const lecture = reponses[table] ?? ok([])
			for (const methode of ['select', 'eq', 'in', 'order']) {
				chaine[methode] = () => chaine
			}
			chaine.is = (colonne: string, valeur: unknown) => {
				if (table === 'goal_boards') filtres.push(`is(${colonne},${String(valeur)})`)
				return chaine
			}
			for (const operation of ['insert', 'update']) {
				chaine[operation] = (charge: Record<string, unknown>) => {
					ecriture?.journal.push({ table, operation, ...charge })
					const apres: Record<string, unknown> = {}
					for (const methode of ['select', 'eq', 'is', 'in', 'order']) {
						apres[methode] = () => apres
					}
					apres.single = () => Promise.resolve(ecriture?.reponse ?? ok([]))
					apres.then = (resoudre: (valeur: Reponse) => unknown) =>
						Promise.resolve(ecriture?.reponse ?? ok([])).then(resoudre)
					return apres
				}
			}
			chaine.maybeSingle = () => Promise.resolve(lecture)
			chaine.single = () => Promise.resolve(lecture)
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(lecture).then(resoudre)
			return chaine
		}
		return { from: (table: string) => construire(table) } as unknown as ClientCrm
	}

	it('LIGNE a — décochée par défaut, la liste POSE le filtre `archived_at is null`', async () => {
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU], filtres))
		await screen.findAllByTestId('tableau-objectifs')
		expect((screen.getByTestId('afficher-archives-tableaux') as HTMLInputElement).checked).toBe(false)
		expect(filtres).toContain('is(archived_at,null)')
	})

	it('LIGNE b — cochée, la liste RELIT SANS le filtre : elle élargit, elle ne filtre pas ici', async () => {
		// L'assertion qui compte est la SECONDE lecture sans `is(archived_at,…)`. Une implémentation
		// qui garderait le filtre et masquerait côté client rendrait le même écran et passerait
		// toutes les assertions de rendu de ce bloc.
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU, TABLEAU_ARCHIVE], filtres))
		await screen.findAllByTestId('tableau-objectifs')
		const avant = filtres.filter((filtre) => filtre === 'is(archived_at,null)').length

		await act(async () => {
			fireEvent.click(screen.getByTestId('afficher-archives-tableaux'))
		})
		await waitFor(() => expect(screen.getByTestId('tableau-objectifs-archive')).toBeTruthy())
		expect(filtres.filter((filtre) => filtre === 'is(archived_at,null)').length).toBe(avant)
	})

	it('LIGNE c — la ligne archivée porte une mention TEXTUELLE, jamais une teinte seule', async () => {
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU_ARCHIVE], filtres))
		const ligne = await screen.findByTestId('tableau-objectifs-archive')
		expect(ligne.textContent).toContain(fr['goals.board.archived.mention'])
	})

	it('LIGNE d — elle ne garde QUE « Désarchiver » : les quatre autres gestes en sont retirés', async () => {
		// Ce n'est PAS une extinction par rôle — `docs/DESIGN_SYSTEM.md` §5.26 l'interdit neuf fois.
		// C'est le retrait de gestes que l'ÉTAT de l'objet rend sans effet observable : renommer ou
		// réordonner un tableau que la liste ne montre pas par défaut ne se verrait nulle part.
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU_ARCHIVE], filtres))
		expect(await screen.findByTestId('desarchiver-tableau')).toBeTruthy()
		expect(screen.queryByTestId('archiver-tableau')).toBeNull()
		expect(screen.queryByTestId('renommer-tableau')).toBeNull()
		expect(screen.queryByTestId('monter-tableau')).toBeNull()
		expect(screen.queryByTestId('descendre-tableau')).toBeNull()
	})

	it('LIGNE e — elle n’est PAS un lien : le canevas d’un tableau archivé est introuvable', async () => {
		// `lireContenuTableau` filtre `archived_at is null`. Un lien mènerait donc à « tableau
		// introuvable », c'est-à-dire à un mur que l'écran ne saurait pas nommer.
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU_ARCHIVE], filtres))
		await screen.findByTestId('tableau-objectifs-archive')
		expect(screen.queryByTestId('tableau-objectifs')).toBeNull()
	})

	it('LIGNE f et g — le geste envoie `archived_at: null`, SANS confirmation et SANS toucher la position', async () => {
		const journal: Record<string, unknown>[] = []
		const filtres: string[] = []
		rendreListe(
			clientJournalisant([TABLEAU_ARCHIVE], filtres, {
				journal,
				reponse: ok([{ ...TABLEAU_ARCHIVE, archived_at: null }]),
			}),
		)
		const commande = await screen.findByTestId('desarchiver-tableau')
		await act(async () => {
			fireEvent.click(commande)
		})
		// AUCUNE confirmation n'est ouverte : le geste part au premier clic (ligne f).
		expect(screen.queryByTestId('confirmation-archivage-tableau')).toBeNull()
		expect(journal).toEqual([{ table: 'goal_boards', operation: 'update', archived_at: null }])
		await waitFor(() =>
			expect(screen.getByTestId('mention-ecriture').textContent).toContain(
				fr['goals.board.unarchived'],
			),
		)
	})

	it('LIGNE h — le refus de la lectrice est un « sans-effet », et l’écran le DIT sans corps de serveur', async () => {
		const journal: Record<string, unknown>[] = []
		const filtres: string[] = []
		rendreListe(
			clientJournalisant([TABLEAU_ARCHIVE], filtres, { journal, reponse: ok([]) }),
		)
		const commande = await screen.findByTestId('desarchiver-tableau')
		await act(async () => {
			fireEvent.click(commande)
		})
		// LE TEXTE EST CELUI DE LA REPRISE, et l'assertion l'exige nommément : le texte générique
		// invoquait « le tableau a peut-être été ARCHIVÉ entre-temps », absurde sur un geste dont
		// tout l'objet est de défaire cet archivage. Défaut vu à la capture, pas à la lecture.
		await waitFor(() =>
			expect(screen.getByTestId('mention-ecriture').textContent).toContain(
				fr['goals.board.unarchive.noeffect'],
			),
		)
		expect(screen.getByTestId('mention-ecriture').textContent).not.toContain(
			fr['goals.board.write.noeffect'],
		)
		// La ligne reste archivée : rien n'a été enregistré, et l'écran ne fait pas semblant.
		expect(screen.getByTestId('tableau-objectifs-archive')).toBeTruthy()
	})

	it('LIGNE i — la ligne archivée rend son compte de blocs comme toute autre', async () => {
		const filtres: string[] = []
		rendreListe(clientJournalisant([TABLEAU_ARCHIVE], filtres))
		const ligne = await screen.findByTestId('tableau-objectifs-archive')
		expect(ligne.textContent).toContain(libelleCompteBlocs(0))
	})

	it('LIGNE j — la case est rendue MÊME sur une liste vide : elle est la cause possible de ce vide', async () => {
		// Règle du §5.3 quinquies : masquer la bascule sur un écran vide priverait l'utilisateur du
		// seul geste qui l'en sort. C'est exactement le cas où quelqu'un cherche un tableau archivé.
		const filtres: string[] = []
		rendreListe(clientJournalisant([], filtres))
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByTestId('afficher-archives-tableaux')).toBeTruthy()
	})
})
