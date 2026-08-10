// @verifies CRM-042 (docs/BACKLOG.md) — rendu réel du tableau, de ses tris, filtres et pages
// @verifies CRM-022 (docs/BACKLOG.md) — colonne Responsable avec avatar et nom
// @verifies docs/SPEC-cards.md §12.4 (bascule de tri), §12.5 (filtres), §12.6 (pagination),
//           §12.7 (le tableau, sa densité et ses colonnes), §12.8 (accessibilité et clavier)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau de données), §8 (états désactivés lisibles,
//           `aria-sort`), §10 (aucun texte en dur), §12.1 (navigation par liens)
//
// Ces tests montent le **vrai** composant et isolent tri, filtres et pagination par leurs rôles
// accessibles. La session réelle est prouvée séparément ; les données servies ici rendent les
// branches déterministes conformément à docs/DESIGN_SYSTEM.md §12.5.

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BasculeVue, ListeCards } from './ListeCards'
import { fr } from '../i18n'
import type { EtapeBoard } from '../lib/board'
import {
	LIGNES_PAR_PAGE,
	PARAMETRES_PAR_DEFAUT,
	type CardListe,
	type ParametresListe,
} from '../lib/liste-cards'

afterEach(cleanup)

const ETAPES: readonly EtapeBoard[] = [
	{ id: 's1', position: 1, libelle: 'Prospection', couleur: 'neutral', kind: 'open', seuilJours: 14 },
	{ id: 's2', position: 2, libelle: 'Relance', couleur: 'accent', kind: 'open', seuilJours: 7 },
	{ id: 's7', position: 7, libelle: 'Perdu', couleur: 'danger', kind: 'lost', seuilJours: null },
]

function card(partiel: Partial<CardListe> & Pick<CardListe, 'id'>): CardListe {
	return {
		title: partiel.id,
		amount: null,
		currency: 'EUR',
		next_action: null,
		next_action_at: null,
		current_step_id: 's2',
		owner_id: null,
		responsable: null,
		...partiel,
	}
}

const CARDS: readonly CardListe[] = [
	card({
		id: 'c1',
		title: 'Refonte du site vitrine',
		amount: 48000,
		currency: 'EUR',
		next_action: 'Relancer la DSI',
		next_action_at: '2026-08-12T09:00:00+00:00',
		owner_id: 'profil-camille',
		responsable: {
			id: 'profil-camille',
			full_name: 'Camille Aubert',
			avatar_url: '/avatars/camille-aubert.svg',
		},
	}),
	card({ id: 'c3', title: 'Audit sécurité applicative', amount: 15500, current_step_id: 's1' }),
	card({ id: 'c6', title: 'Piste entrante à qualifier', current_step_id: 's1' }),
]

function parametres(partiel: Partial<ParametresListe> = {}): ParametresListe {
	return { ...PARAMETRES_PAR_DEFAUT, ...partiel }
}

function rendre({
	cards = CARDS,
	params = parametres(),
	total = CARDS.length,
	onParametres = vi.fn(),
}: {
	cards?: readonly CardListe[]
	params?: ParametresListe
	total?: number
	onParametres?: (parametres: ParametresListe) => void
} = {}) {
	render(
		<MemoryRouter>
			<ListeCards
				cards={cards}
				etapes={ETAPES}
				parametres={params}
				total={total}
				slugTrack="conseil-ia"
				slugChannel="grands-comptes"
				onParametres={onParametres}
			/>
		</MemoryRouter>,
	)
	return { onParametres }
}

// --- Le tableau (§12.7) ----------------------------------------------------------------------

describe('le tableau de la vue liste (§12.7)', () => {
	// Un `table` sémantique, non une grille de `div` : c'est ce qui donne la navigation par
	// cellule et l'en-tête rappelé à chaque cellule (docs/DESIGN_SYSTEM.md §5.9).
	it('est un vrai tableau, annoncé comme tel', () => {
		rendre()
		expect(screen.getByRole('table')).toBeDefined()
		expect(screen.getByRole('table').tagName).toBe('TABLE')
	})

	it('porte les six colonnes, dont le responsable livré par CRM-022', () => {
		rendre()
		const entetes = screen.getAllByRole('columnheader').map((entete) => entete.textContent ?? '')
		expect(entetes).toHaveLength(6)
		expect(entetes[0]).toContain(fr['liste.colonne.title'])
		expect(entetes[1]).toContain(fr['liste.colonne.owner'])
		expect(entetes[2]).toContain(fr['liste.colonne.etape'])
		expect(entetes[3]).toContain(fr['liste.colonne.amount'])
		expect(entetes[4]).toContain(fr['liste.colonne.next_action'])
		expect(entetes[5]).toContain(fr['liste.colonne.next_action_at'])
	})

	it('rend avatar et nom du responsable, jamais son identifiant', () => {
		rendre()
		const premiere = screen.getAllByTestId('ligne-card')[0] as HTMLElement
		expect(within(premiere).getByText('Camille Aubert')).toBeDefined()
		expect(within(premiere).getByTestId('avatar')).toBeDefined()
		expect(premiere.textContent).not.toContain('profil-camille')
	})

	it('rend une ligne par card, dans l’ordre reçu', () => {
		rendre()
		const lignes = screen.getAllByTestId('ligne-card')
		expect(lignes.map((ligne) => ligne.getAttribute('data-card'))).toEqual(['c1', 'c3', 'c6'])
	})

	// Seul le titre est un lien : la cible du clic doit être la cible annoncée (§5.9).
	it('fait du titre un lien vers la card, et de lui seul', () => {
		rendre()
		const premiere = screen.getAllByTestId('ligne-card')[0]
		const liens = within(premiere as HTMLElement).getAllByRole('link')
		expect(liens).toHaveLength(1)
		expect(liens[0]?.getAttribute('href')).toBe('/tracks/conseil-ia/grands-comptes/cards/c1')
	})

	// La valeur entière est portée par `title` : la cellule est en ellipse sur une seule ligne.
	it('porte la valeur entière du titre en attribut, la cellule étant tronquée', () => {
		rendre()
		const lien = screen.getByRole('link', { name: 'Refonte du site vitrine' })
		expect(lien.getAttribute('title')).toBe('Refonte du site vitrine')
	})

	it('rend l’étape en badge, avec son libellé et jamais la seule couleur', () => {
		rendre()
		const premiere = screen.getAllByTestId('ligne-card')[0]
		expect(within(premiere as HTMLElement).getByText('Relance')).toBeDefined()
		const seconde = screen.getAllByTestId('ligne-card')[1]
		expect(within(seconde as HTMLElement).getByText('Prospection')).toBeDefined()
	})

	// Une étape que l'appelant n'a pas le droit de lire laisse la cellule vide plutôt qu'un
	// identifiant technique (CLAUDE.md §18).
	it('laisse la cellule d’étape vide lorsque l’étape n’est pas lisible', () => {
		rendre({ cards: [card({ id: 'cX', title: 'Sans étape', current_step_id: 'inconnue' })] })
		const ligne = screen.getAllByTestId('ligne-card')[0]
		const cellules = within(ligne as HTMLElement).getAllByRole('cell')
		expect(cellules[2]?.textContent).toBe('')
	})

	it('rend le montant en donnée technique, et laisse la cellule vide sans montant', () => {
		rendre()
		const montants = screen.getAllByTestId('montant-liste')
		expect(montants).toHaveLength(2)
		expect(montants[0]?.tagName).toBe('CODE')
		expect(montants[0]?.textContent?.replace(/ | /g, ' ')).toContain('48 000')
		const derniere = screen.getAllByTestId('ligne-card')[2]
		expect(within(derniere as HTMLElement).queryByTestId('montant-liste')).toBeNull()
	})

	// Ni tiret, ni « — », ni « non renseigné » : un tiret est un caractère que rien ne distingue
	// d'une donnée (docs/DESIGN_SYSTEM.md §5.9).
	it('n’écrit aucun substitut dans une cellule sans valeur', () => {
		rendre({ cards: [card({ id: 'c6', title: 'Piste entrante à qualifier' })] })
		const ligne = screen.getAllByTestId('ligne-card')[0]
		const cellules = within(ligne as HTMLElement).getAllByRole('cell')
		expect(cellules[1]?.textContent).toBe('')
		expect(cellules[3]?.textContent).toBe('')
		expect(cellules[4]?.textContent).toBe('')
		expect(cellules[5]?.textContent).toBe('')
	})

	it('rend l’échéance en donnée technique au format court', () => {
		rendre()
		const echeance = screen.getAllByTestId('echeance-liste')[0]
		expect(echeance?.tagName).toBe('CODE')
		expect(echeance?.textContent).toBe('12/08/2026')
	})

	// Le §12.6 du design system l'annonçait nommément pour la vue liste.
	it('signale le débordement horizontal par la classe du §12.6', () => {
		rendre()
		const conteneur = screen.getByRole('table').parentElement
		expect(conteneur?.className).toContain('indique-debordement-x')
		expect(conteneur?.className).toContain('overflow-x-auto')
	})
})

// --- Le tri (§12.4, §12.8) -------------------------------------------------------------------

describe('le tri (§12.4)', () => {
	// Sans `aria-sort`, un lecteur d'écran ne sait pas sur quelle colonne le tableau est trié.
	it('annonce la colonne triée par `aria-sort`, et une seule', () => {
		rendre({ params: parametres({ tri: 'amount', sens: 'desc' }) })
		const entetes = screen.getAllByTestId('entete-triable')
		const triees = entetes.filter((entete) => entete.getAttribute('aria-sort') !== 'none')
		expect(triees).toHaveLength(1)
		expect(triees[0]?.getAttribute('data-cle')).toBe('amount')
		expect(triees[0]?.getAttribute('aria-sort')).toBe('descending')
	})

	it('annonce le sens ascendant lorsqu’il l’est', () => {
		rendre({ params: parametres({ tri: 'title', sens: 'asc' }) })
		const entete = screen
			.getAllByTestId('entete-triable')
			.find((candidat) => candidat.getAttribute('data-cle') === 'title')
		expect(entete?.getAttribute('aria-sort')).toBe('ascending')
	})

	it('n’offre le tri que sur les trois colonnes triables', () => {
		rendre()
		expect(
			screen.getAllByTestId('entete-triable').map((entete) => entete.getAttribute('data-cle')),
		).toEqual(['title', 'amount', 'next_action_at'])
	})

	it('inverse le sens lorsqu’on clique la colonne déjà triée', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ tri: 'title', sens: 'asc', page: 3 }) })
		await utilisateur.click(screen.getAllByTestId('tri')[0] as HTMLElement)
		expect(onParametres).toHaveBeenCalledWith(
			expect.objectContaining({ tri: 'title', sens: 'desc', page: 1 }),
		)
	})

	// Le sens par défaut d'une NOUVELLE clé est le sien, pas celui qu'on quitte.
	it('prend le sens par défaut de la clé lorsqu’on change de colonne', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ tri: 'title', sens: 'asc' }) })
		await utilisateur.click(screen.getAllByTestId('tri')[1] as HTMLElement)
		expect(onParametres).toHaveBeenCalledWith(
			expect.objectContaining({ tri: 'amount', sens: 'desc' }),
		)
	})

	// La page 3 d'un tri n'a aucun rapport avec la page 3 d'un autre (§12.4).
	it('ramène toujours à la première page', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ tri: 'title', page: 4 }) })
		await utilisateur.click(screen.getAllByTestId('tri')[2] as HTMLElement)
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
	})

	it('donne au bouton de tri un nom accessible qui nomme la colonne', () => {
		rendre()
		expect(
			screen.getByRole('button', { name: `${fr['liste.tri.aria'].replace('{colonne}', fr['liste.colonne.amount'])}` }),
		).toBeDefined()
	})

	// Le marqueur de la clé paramétrée ne doit jamais atteindre l'utilisateur (décision 180).
	it('ne laisse fuir aucun marqueur de paramètre', () => {
		rendre({ total: LIGNES_PAR_PAGE * 2 })
		expect(document.body.textContent ?? '').not.toContain('{')
		for (const bouton of screen.getAllByTestId('tri')) {
			expect(bouton.getAttribute('aria-label') ?? '').not.toContain('{')
		}
		expect(screen.getByTestId('pagination-liste').getAttribute('aria-label') ?? '').not.toContain('{')
	})
})

// --- Les filtres (§12.5) ---------------------------------------------------------------------

describe('les filtres (§12.5)', () => {
	// Toutes les étapes du workflow, y compris celles qu'aucune card n'occupe : une étape absente
	// ferait croire qu'elle n'existe pas.
	it('offre toutes les étapes du workflow, plus le choix « toutes »', () => {
		rendre()
		const choix = within(screen.getByTestId('filtre-etape')).getAllByRole('option')
		expect(choix.map((option) => option.textContent)).toEqual([
			fr['liste.filtre.etape.toutes'],
			'Prospection',
			'Relance',
			'Perdu',
		])
	})

	it('remonte le filtre d’étape choisi et revient page 1', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ page: 3 }) })
		await utilisateur.selectOptions(screen.getByTestId('filtre-etape'), 's7')
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ etape: 's7', page: 1 }))
	})

	it('remonte `null` lorsqu’on revient à « toutes les étapes »', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ etape: 's7' }) })
		await utilisateur.selectOptions(screen.getByTestId('filtre-etape'), '')
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ etape: null }))
	})

	// Une recherche qui partirait à chaque frappe émettrait une requête par caractère (§12.8).
	it('n’émet la recherche qu’à la soumission, pas à la frappe', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre()
		await utilisateur.type(screen.getByTestId('filtre-recherche'), 'refonte')
		expect(onParametres).not.toHaveBeenCalled()
		await utilisateur.click(screen.getByTestId('valider-recherche'))
		expect(onParametres).toHaveBeenCalledWith(
			expect.objectContaining({ recherche: 'refonte', page: 1 }),
		)
	})

	// `Entrée` dans le champ soumet le formulaire : c'est le chemin clavier du §12.8.
	it('soumet la recherche à la touche Entrée, sans souris', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre()
		await utilisateur.type(screen.getByTestId('filtre-recherche'), 'audit{Enter}')
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ recherche: 'audit' }))
	})

	it('n’offre l’effacement des filtres que lorsqu’il y en a', () => {
		rendre()
		expect(screen.queryByTestId('effacer-filtres')).toBeNull()
		cleanup()
		rendre({ params: parametres({ recherche: 'refonte' }) })
		expect(screen.getByTestId('effacer-filtres')).toBeDefined()
	})

	it('efface les deux filtres d’un seul geste', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ params: parametres({ etape: 's1', recherche: 'audit', page: 2 }) })
		await utilisateur.click(screen.getByTestId('effacer-filtres'))
		expect(onParametres).toHaveBeenCalledWith(
			expect.objectContaining({ etape: null, recherche: '', page: 1 }),
		)
	})

	it('affiche le total des lignes filtrées', () => {
		rendre({ total: 42 })
		expect(screen.getByTestId('total-liste').textContent).toBe(
			fr['liste.total'].replace('{total}', '42'),
		)
	})
})

// --- La pagination (§12.6, §12.8) -------------------------------------------------------------

describe('la pagination (§12.6)', () => {
	it('écrit le rang et le nombre de pages en toutes lettres', () => {
		rendre({ total: LIGNES_PAR_PAGE * 3, params: parametres({ page: 2 }) })
		expect(screen.getByTestId('rang-page').textContent).toBe(
			fr['liste.page.position'].replace('{rang}', '2').replace('{pages}', '3'),
		)
	})

	// Désactivés, jamais masqués : un état désactivé reste lisible (docs/DESIGN_SYSTEM.md §8).
	it('désactive le bouton précédent sur la première page, sans le masquer', () => {
		rendre({ total: LIGNES_PAR_PAGE * 3, params: parametres({ page: 1 }) })
		const precedent = screen.getByTestId('page-precedente') as HTMLButtonElement
		expect(precedent.disabled).toBe(true)
		expect(screen.getByTestId('page-suivante')).toBeDefined()
	})

	it('désactive le bouton suivant sur la dernière page, sans le masquer', () => {
		rendre({ total: LIGNES_PAR_PAGE * 3, params: parametres({ page: 3 }) })
		expect((screen.getByTestId('page-suivante') as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByTestId('page-precedente')).toBeDefined()
	})

	it('désactive les deux boutons lorsqu’il n’y a qu’une page', () => {
		rendre({ total: 3 })
		expect((screen.getByTestId('page-precedente') as HTMLButtonElement).disabled).toBe(true)
		expect((screen.getByTestId('page-suivante') as HTMLButtonElement).disabled).toBe(true)
	})

	it('avance et recule d’une page, en conservant tri et filtres', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({
			total: LIGNES_PAR_PAGE * 3,
			params: parametres({ page: 2, tri: 'amount', sens: 'desc', etape: 's1' }),
		})
		await utilisateur.click(screen.getByTestId('page-suivante'))
		expect(onParametres).toHaveBeenCalledWith({
			tri: 'amount',
			sens: 'desc',
			etape: 's1',
			recherche: '',
			page: 3,
		})
		await utilisateur.click(screen.getByTestId('page-precedente'))
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
	})
})

// --- La bascule board ↔ liste (§12.8) ---------------------------------------------------------

describe('la bascule entre les deux vues (§12.8)', () => {
	function rendreBascule(vue: 'board' | 'liste') {
		render(
			<MemoryRouter>
				<BasculeVue slugTrack="conseil-ia" slugChannel="grands-comptes" vue={vue} />
			</MemoryRouter>,
		)
	}

	// Des LIENS, non un `tablist` : les deux vues changent d'adresse (docs/DESIGN_SYSTEM.md §12.1).
	it('est une paire de liens, non un `tablist`', () => {
		rendreBascule('board')
		expect(screen.queryByRole('tablist')).toBeNull()
		const liens = screen.getAllByTestId('lien-vue')
		expect(liens).toHaveLength(2)
		expect(liens.map((lien) => lien.getAttribute('href'))).toEqual([
			'/tracks/conseil-ia/grands-comptes',
			'/tracks/conseil-ia/grands-comptes/liste',
		])
	})

	it('marque la vue ouverte par `aria-current`, et elle seule', () => {
		rendreBascule('liste')
		const courants = screen
			.getAllByTestId('lien-vue')
			.filter((lien) => lien.getAttribute('aria-current') === 'page')
		expect(courants).toHaveLength(1)
		expect(courants[0]?.getAttribute('data-vue')).toBe('liste')
	})

	it('marque le board lorsque c’est lui qui est ouvert', () => {
		rendreBascule('board')
		const courant = screen
			.getAllByTestId('lien-vue')
			.find((lien) => lien.getAttribute('aria-current') === 'page')
		expect(courant?.getAttribute('data-vue')).toBe('board')
	})
})

// --- L'état vide, et le défaut qu'une capture a dénoncé (§12.9) --------------------------------

describe('l’état vide du tableau (§12.9)', () => {
	function rendreVide(params: ParametresListe) {
		const onParametres = vi.fn()
		render(
			<MemoryRouter>
				<ListeCards
					cards={[]}
					etapes={ETAPES}
					parametres={params}
					total={0}
					slugTrack="conseil-ia"
					slugChannel="grands-comptes"
					onParametres={onParametres}
					etatVide={<p data-testid="etat-vide-servi">Aucune affaire ne correspond</p>}
				/>
			</MemoryRouter>,
		)
		return { onParametres }
	}

	// Les trois défauts trouvés EN REGARDANT UNE CAPTURE (décision 190), figés par des assertions
	// pour qu'ils ne puissent pas revenir.
	it('remplace le tableau par l’état vide, au lieu de laisser une carcasse d’en-têtes', () => {
		rendreVide(parametres({ recherche: 'zzzintrouvable' }))
		expect(screen.getByTestId('etat-vide-servi')).toBeDefined()
		expect(screen.queryByTestId('tableau-liste')).toBeNull()
		expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
	})

	it('n’affiche aucune pagination quand il n’y a rien à paginer', () => {
		rendreVide(parametres({ recherche: 'zzzintrouvable' }))
		expect(screen.queryByTestId('pagination-liste')).toBeNull()
	})

	// Les filtres restent AU-DESSUS de l'état vide : ils en sont la cause, et les masquer
	// priverait l'utilisateur du seul geste qui l'en sort.
	it('garde les filtres, et les place avant le message', () => {
		rendreVide(parametres({ recherche: 'zzzintrouvable' }))
		const filtres = screen.getByTestId('filtres-liste')
		const message = screen.getByTestId('etat-vide-servi')
		expect(filtres.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
	})

	// Une seule action « Effacer les filtres » : celle de l'état vide. Deux boutons identiques à
	// cent pixels l'un de l'autre, c'est ce que la capture montrait.
	it('ne double pas l’action d’effacement des filtres', () => {
		rendreVide(parametres({ etape: 's1', recherche: 'audit' }))
		expect(screen.queryByTestId('effacer-filtres')).toBeNull()
	})

	// Sans état vide fourni — le cas d'un appelant qui n'en donne pas —, le tableau reste rendu :
	// le composant ne décide pas seul de faire disparaître son contenu.
	it('rend quand même le tableau lorsqu’aucun état vide n’est fourni', () => {
		render(
			<MemoryRouter>
				<ListeCards
					cards={[]}
					etapes={ETAPES}
					parametres={parametres()}
					total={0}
					slugTrack="conseil-ia"
					slugChannel="grands-comptes"
					onParametres={vi.fn()}
				/>
			</MemoryRouter>,
		)
		expect(screen.getByTestId('tableau-liste')).toBeDefined()
	})
})
