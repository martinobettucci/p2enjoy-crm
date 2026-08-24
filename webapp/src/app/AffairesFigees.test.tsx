// @verifies CRM-062 (docs/BACKLOG.md) — tranche 3c : l'écran des affaires figées
// @verifies docs/SPEC-relances.md §10.7 (regroupement et classement), §10.8 (ce que chaque ligne
//           rend), §10.9 (les états, et l'UNIQUE vide), §10.10 (accessibilité)
// @verifies docs/DESIGN_SYSTEM.md §5.37 (cette surface), §5.8 (états), §5.9 (cellule sans valeur
//           VIDE), §5.32 (aucun lien vers une adresse incomplète), §5.29 (pilule de channel)
//
// LES DONNÉES INJECTÉES SONT CELLES DU SEED, À L'IDENTIQUE — les quatre affaires du §10.2.1, avec
// leurs retards 35, 18, 16 et 7, leurs quatre dossiers et leurs trois tracks. Ce n'est pas une
// commodité : ce sont les lignes que la preuve E2E exerce sur la pile réelle, et la preuve d'API
// sur la vraie route.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { AffairesFigees } from './AffairesFigees'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

/** Une ligne de la règle, telle que `public.cards_figees()` la rend. */
type LigneRegle = {
	card_id: string
	channel_id: string
	title: string
	step_id: string
	seuil_jours: number
	jours_dans_etape: number
	retard_jours: number
}

/** Les quatre affaires du §10.2.1, dans l'ordre du §3.4. */
const REGLE: LigneRegle[] = [
	{
		card_id: 'c4',
		channel_id: 'ch-refonte',
		title: 'Refonte intranet Ville de Lyon',
		step_id: 'st1',
		seuil_jours: 5,
		jours_dans_etape: 40,
		retard_jours: 35,
	},
	{
		card_id: 'd007',
		channel_id: 'ch-maintenance',
		title: 'Contrat TMA 2026 — Mairie de Vaulx',
		step_id: 'st2',
		seuil_jours: 7,
		jours_dans_etape: 25,
		retard_jours: 18,
	},
	{
		card_id: 'c3',
		channel_id: 'ch-grands-comptes',
		title: 'Audit sécurité applicative',
		step_id: 'st3',
		seuil_jours: 14,
		jours_dans_etape: 30,
		retard_jours: 16,
	},
	{
		card_id: 'cf',
		channel_id: 'ch-dossiers',
		title: 'Reprise du dossier Marchand',
		step_id: 'st4',
		seuil_jours: 5,
		jours_dans_etape: 12,
		retard_jours: 7,
	},
]

const carte = (
	id: string,
	slugChannel: string,
	nomChannel: string,
	slugTrack: string,
	nomTrack: string,
	etape: string,
) => ({
	id,
	channels: { slug: slugChannel, name: nomChannel, tracks: { slug: slugTrack, name: nomTrack } },
	workflow_steps: { label_override: null, workflow_nodes_catalog: { label: etape } },
})

const CARTES = [
	carte('c4', 'refonte', 'Refonte', 'studio-web', 'Studio web', 'Négociation'),
	carte('d007', 'maintenance', 'Maintenance', 'studio-web', 'Studio web', 'Relance'),
	carte('c3', 'grands-comptes', 'Grands comptes', 'conseil-ia', 'Conseil & IA', 'Prospection'),
	carte('cf', 'dossiers-2023', 'Dossiers 2023', 'legacy-2023', 'Legacy 2023', 'Négociation'),
]

/**
 * Client minimal : la RPC de la règle, puis la lecture des cards.
 *
 * Les deux réponses sont indépendantes, ce qui est le point : le §10.5 exige que l'échec de la
 * SECONDE n'efface pas la PREMIÈRE, et cela ne se mesure qu'en les dissociant.
 */
function clientQuiRend(options: {
	regle?: { data?: unknown; error?: { message: string } | null; status?: number }
	cards?: { data?: unknown; error?: { message: string } | null }
}): ClientCrm {
	return {
		rpc: () =>
			Promise.resolve({
				data: options.regle?.data ?? [],
				error: options.regle?.error ?? null,
				status: options.regle?.status ?? 200,
			}),
		from: () => ({
			select: () => ({
				in: () =>
					Promise.resolve({
						data: options.cards?.data ?? [],
						error: options.cards?.error ?? null,
					}),
			}),
		}),
	} as unknown as ClientCrm
}

const monter = (client: ClientCrm) =>
	render(
		<MemoryRouter>
			<AffairesFigees client={client} />
		</MemoryRouter>,
	)

describe('l’écran des affaires figées (docs/SPEC-relances.md §10)', () => {
	it('groupe par DOSSIER, dans l’ordre du plus gros retard', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('groupe-figees')).toHaveLength(4))
		const groupes = screen.getAllByTestId('groupe-figees')
		// QUATRE GROUPES POUR TROIS TRACKS : `studio-web` en porte DEUX, et c'est le seul cas qui
		// prouve que le regroupement porte sur le dossier et non sur le track (§10.2.1 point 2).
		expect(groupes.map((groupe) => groupe.getAttribute('data-dossier'))).toEqual([
			'ch-refonte',
			'ch-maintenance',
			'ch-grands-comptes',
			'ch-dossiers',
		])
	})

	it('rend les quatre affaires dans l’ordre du serveur, retard décroissant', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('ligne-figee')).toHaveLength(4))
		expect(
			screen.getAllByTestId('ligne-figee').map((ligne) => ligne.getAttribute('data-affaire')),
		).toEqual(['c4', 'd007', 'c3', 'cf'])
	})

	// LE COMPTE VIT DANS SON PROPRE ÉLÉMENT (§5.36, §5.11) : un nœud de texte accolé au libellé
	// devient un élément flex anonyme que `gap` ne sépare pas — le défaut « Discussion1 ».
	it('écrit le compte de chaque groupe dans son propre élément', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('compte-groupe')).toHaveLength(4))
		expect(screen.getAllByTestId('compte-groupe')[0]?.textContent).toBe('(1)')
	})

	// LA TEINTE DE DANGER PORTE SUR LE RETARD, PAS SUR LA LIGNE (§10.8) : une affaire figée est un
	// travail à faire, pas une erreur. Le §1 est tenu par l'unité et le seuil, écrits en clair.
	it('teinte le RETARD et non la ligne, et écrit son unité dans un élément séparé', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('retard-figee')).toHaveLength(4))
		const retard = screen.getAllByTestId('retard-figee')[0]
		expect(retard?.className).toContain('bg-danger-soft')
		expect(retard?.textContent).toBe(`35${fr['stalled.unit.days']}`)
		// La ligne, elle, ne porte AUCUNE teinte de danger.
		const ligne = screen.getAllByTestId('ligne-figee')[0]
		expect(ligne?.className).not.toContain('danger')
	})

	// UN RETARD SANS SON SEUIL N'A PAS D'ÉCHELLE (§10.8, même raison qu'au §9.6 pour le `payload`).
	it('accompagne chaque retard de son seuil, qui VARIE d’une ligne à l’autre', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('seuil-figee')).toHaveLength(4))
		const seuils = screen.getAllByTestId('seuil-figee').map((element) => element.textContent)
		expect(seuils[0]).toBe(fr['stalled.threshold'].replace('{seuil}', '5'))
		expect(seuils[2]).toBe(fr['stalled.threshold'].replace('{seuil}', '14'))
		// Trois valeurs distinctes : une preuve ne peut donc pas confondre le seuil rendu avec une
		// constante (§10.2.1 point 3).
		expect(new Set(seuils).size).toBeGreaterThan(1)
	})

	it('nomme l’étape en pilule NEUTRE, et la pilule de dossier nomme sa destination', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('etape-figee')).toHaveLength(4))
		const etape = screen.getAllByTestId('etape-figee')[0]
		expect(etape?.textContent).toBe('Négociation')
		// NEUTRE, jamais une teinte de donnée : c'est le dossier interne de l'affaire, pas son
		// identité (§10.8).
		expect(etape?.className).toContain('bg-hover')
		// Le nom accessible de la pilule NOMME sa destination : la même pilule répétée sur quatre
		// lignes ne dirait pas ce que chacune ouvre (§5.29).
		const pilule = screen.getAllByTestId('pilule-situation')[0]
		expect(pilule?.getAttribute('aria-label')).toBe('Ouvrir Studio web › Refonte')
	})

	// UNE AFFAIRE ABSENTE DE LA SECONDE LECTURE RESTE LISTÉE (§10.5), avec ce que la règle rend, et
	// SANS lien : un lien vers une adresse incomplète mènerait à un écran qu'on croirait cassé.
	it('liste sans lien, sans étape et sans pilule une affaire que la seconde lecture ignore', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: [CARTES[0]] } }))
		await waitFor(() => expect(screen.getAllByTestId('ligne-figee')).toHaveLength(4))
		// Les quatre titres sont là — aucune affaire en retard n'a disparu.
		expect(screen.getByText('Audit sécurité applicative')).toBeTruthy()
		// Un seul lien d'affaire, et une seule pilule : ceux de la carte réellement rapportée.
		expect(screen.getAllByTestId('lien-affaire-figee')).toHaveLength(1)
		expect(screen.getAllByTestId('pilule-situation')).toHaveLength(1)
		expect(screen.getAllByTestId('etape-figee')).toHaveLength(1)
		// Les quatre retards restent rendus : ils viennent de la RÈGLE, pas de la seconde lecture.
		expect(screen.getAllByTestId('retard-figee')).toHaveLength(4)
	})

	// L'ÉTAT VIDE DIT QUE L'ÉTAT EST SAIN, et il n'offre AUCUNE action (§10.9) — l'écart assumé au
	// §5.8 que la corbeille et le carnet prennent déjà.
	it('rend UN seul état vide, sans aucune action', async () => {
		monter(clientQuiRend({ regle: { data: [] } }))
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['stalled.empty.title'])
		expect(screen.queryByRole('link')).toBeNull()
		expect(screen.queryByRole('button')).toBeNull()
	})

	// L'ÉCHEC DE LA RÈGLE EST UNE ERREUR AVEC REPRISE, jamais un état vide : rendre « aucune affaire
	// ne dort » sur une panne ferait passer un défaut pour une bonne nouvelle (§10.9).
	it('rend une erreur AVEC REPRISE quand la règle échoue, jamais l’état vide', async () => {
		monter(clientQuiRend({ regle: { error: { message: 'boom' }, status: 500 } }))
		expect(await screen.findByTestId('etat-erreur')).toBeTruthy()
		expect(screen.queryByText(fr['stalled.empty.title'])).toBeNull()
		expect(screen.getByRole('button', { name: fr['stalled.error.retry'] })).toBeTruthy()
	})

	it('rend un état explicite quand aucun espace de travail n’est configuré', () => {
		render(
			<MemoryRouter>
				<AffairesFigees client={null} />
			</MemoryRouter>,
		)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['stalled.noWorkspace.title'])
	})

	// LE COMPTE EST ANNONCÉ (§10.10) : une liste qui se recompose sans un mot est un changement
	// invisible pour qui ne voit pas l'écran.
	it('annonce le compte total dans une région polie', async () => {
		monter(clientQuiRend({ regle: { data: REGLE }, cards: { data: CARTES } }))
		await waitFor(() => expect(screen.getAllByTestId('ligne-figee')).toHaveLength(4))
		expect(screen.getByLabelText(fr['stalled.live.aria']).textContent).toBe(
			fr['stalled.live.message'].replace('{total}', '4'),
		)
	})
})
