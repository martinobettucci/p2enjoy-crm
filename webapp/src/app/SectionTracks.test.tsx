// @verifies CRM-020 (docs/BACKLOG.md) — barre latérale : rendu réel des tracks
// @verifies docs/SPEC-tracks.md §7 (ce que la barre latérale lit), §7.1 (pilule)
// @verifies docs/DESIGN_SYSTEM.md §4 (tracks en pilules), §5.6 (icône obligatoire), §7 (paliers)
// @verifies docs/SPEC-webapp.md §7 (états systématiques), §10 (aucun texte en dur)
//
// Ces tests montent la **vraie** barre latérale et l'interrogent par ses rôles accessibles et
// ses attributs de données. Ils existent parce que le rendu chargé des tracks ne peut être vu
// nulle part ailleurs : la webapp est un appelant anonyme faute d'écran de connexion (INC-021),
// et son E2E n'obtient donc jamais de ligne. Sans ce fichier, le rendu d'une pilule ne serait
// exercé par aucune preuve.
//
// Ce qu'ils ne prouvent PAS, et qui reste dû : que l'écran affiche réellement des tracks à un
// utilisateur connecté. C'est une limite du produit, nommée dans `docs/BACKLOG.md`.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { Sidebar } from './Sidebar'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import type { Track } from '../lib/tracks'

const TRACKS: readonly Track[] = [
	{ id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', color: 'brand', icon: 'sparkles', position: 1 },
	{
		id: 't-2',
		name: 'Studio web',
		slug: 'studio-web',
		color: 'success',
		icon: 'layout-dashboard',
		position: 2,
	},
	// Icône inconnue du catalogue : elle doit se replier, pas casser le rendu.
	{ id: 't-3', name: 'Formation', slug: 'formation', color: 'accent', icon: 'inexistante', position: 3 },
]

function monter(etat: EtatAsync<readonly Track[]>, replie = false) {
	return render(
		<MemoryRouter>
			<Sidebar
				replie={replie}
				onBasculerRepli={() => {}}
				tiroirOuvert={false}
				onFermerTiroir={() => {}}
				etatTracks={etat}
			/>
		</MemoryRouter>,
	)
}

afterEach(cleanup)

describe('états de la section (docs/DESIGN_SYSTEM.md §5.8)', () => {
	it('affiche des squelettes pendant le chargement, jamais un spinner', () => {
		monter(enChargement())
		expect(screen.getByTestId('squelette')).toBeTruthy()
		expect(screen.queryAllByTestId('entree-track')).toHaveLength(0)
	})

	it('affiche l’état vide quand le backend ne consent aucune ligne', () => {
		monter(pret([]))
		expect(screen.getByTestId('tracks-vides').textContent).toBe('Aucun track')
		expect(screen.queryAllByTestId('entree-track')).toHaveLength(0)
	})

	// La barre latérale n'a pas la place d'expliquer une erreur ni d'offrir une reprise
	// utilisable : c'est la zone principale qui la présente. Elle ne doit pas pour autant
	// inventer des lignes.
	it('n’invente aucune ligne quand le chargement a échoué', () => {
		monter(enErreur({ nature: 'network', detail: 'Failed to fetch' }))
		expect(screen.queryAllByTestId('entree-track')).toHaveLength(0)
		expect(screen.getByTestId('tracks-vides')).toBeTruthy()
	})
})

describe('rendu d’une pilule (docs/DESIGN_SYSTEM.md §4, §5.6)', () => {
	it('rend une pilule par track, dans l’ordre reçu du serveur', () => {
		monter(pret(TRACKS))
		const entrees = screen.getAllByTestId('entree-track')
		expect(entrees).toHaveLength(3)
		// L'ordre est celui du serveur : l'interface ne retrie pas ce que `position` a décidé.
		expect(entrees.map((element) => element.getAttribute('data-slug'))).toEqual([
			'conseil-ia',
			'studio-web',
			'formation',
		])
	})

	it('affiche le libellé du track, qui est une donnée et non une traduction', () => {
		monter(pret(TRACKS))
		expect(screen.getByText('Conseil & IA')).toBeTruthy()
		expect(screen.getByText('Studio web')).toBeTruthy()
	})

	it('porte le nom complet en `title` : un libellé ellipsé reste consultable', () => {
		// docs/DESIGN_SYSTEM.md §10 : les mises en page tolèrent des textes plus longs, et
		// aucun contenu n'est masqué sans point d'accès (§7).
		monter(pret(TRACKS))
		const entrees = screen.getAllByTestId('entree-track')
		expect(entrees.map((element) => element.getAttribute('title'))).toEqual([
			'Conseil & IA',
			'Studio web',
			'Formation',
		])
	})

	it('précède chaque pilule d’une icône, pour que la couleur ne porte pas seule l’information', () => {
		monter(pret(TRACKS))
		for (const entree of screen.getAllByTestId('entree-track')) {
			const icone = entree.querySelector('svg')
			expect(icone).toBeTruthy()
			// L'icône accompagne un libellé : elle est décorative pour un lecteur d'écran
			// (docs/DESIGN_SYSTEM.md §9).
			expect(icone?.getAttribute('aria-hidden')).toBe('true')
		}
	})

	it('donne à chaque track les classes de son jeton de couleur, sans hexadécimal', () => {
		monter(pret(TRACKS))
		const classes = screen.getAllByTestId('entree-track').map((element) => element.className)
		expect(classes[0]).toContain('bg-brand-soft')
		expect(classes[1]).toContain('bg-success-soft')
		expect(classes[0]).not.toMatch(new RegExp('#[0-9a-f]{3,8}', 'i'))
	})

	it('rend tout de même le track dont l’icône est inconnue', () => {
		// C'est le repli de `docs/SPEC-tracks.md` §2.4 vu depuis l'écran : un nom d'icône qui
		// n'existe pas ne doit produire ni trou, ni exception.
		monter(pret(TRACKS))
		const formation = screen
			.getAllByTestId('entree-track')
			.find((element) => element.getAttribute('data-slug') === 'formation')
		expect(formation).toBeTruthy()
		expect(formation?.querySelector('svg')).toBeTruthy()
		expect(formation?.textContent).toContain('Formation')
	})
})

describe('paliers et lecteurs d’écran (docs/DESIGN_SYSTEM.md §7, §8)', () => {
	it('masque visuellement les libellés quand la barre est repliée, sans les retirer', () => {
		// docs/DESIGN_SYSTEM.md §12.3 : réduire l'affichage ne doit pas réduire l'information
		// annoncée aux technologies d'assistance. Le libellé reste dans le document.
		monter(pret(TRACKS), true)
		const libelle = screen.getByText('Conseil & IA')
		expect(libelle.className).toContain('sr-only')
		expect(libelle.textContent).toBe('Conseil & IA')
	})

	it('groupe les tracks dans une liste, sous un titre de section', () => {
		monter(pret(TRACKS))
		expect(screen.getByRole('list')).toBeTruthy()
		expect(screen.getAllByRole('listitem')).toHaveLength(3)
		expect(screen.getByRole('heading', { level: 2, name: 'Tracks' })).toBeTruthy()
	})
})
