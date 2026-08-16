// @verifies CRM-040 (docs/BACKLOG.md) — le rendu réel de l'en-tête de la fiche d'affaire
// @verifies docs/SPEC-cards.md §15.4 (les six données), §15.5 (l'action de copie et son échec),
//           §15.6 (accessibilité), §15.7 (les trois états de donnée)
// @verifies docs/DESIGN_SYSTEM.md §5.3 bis (omission plutôt que tiret, couple terme/valeur,
//           pilule « Archivé », confirmation de copie), §8 (nom accessible), §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et l'isolent par ses rôles accessibles. La copie est
// injectée : `navigator.clipboard` n'existe pas dans jsdom, et substituer l'API du navigateur
// éprouverait jsdom plutôt que le produit. Le geste réel est éprouvé sur Chromium par
// `e2e/ui/entete-card.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnTeteCard } from './EnTeteCard'
import type { CardOuverte } from '../lib/formulaire'

afterEach(cleanup)

function card(surcharge: Partial<CardOuverte> = {}): CardOuverte {
	return {
		id: 'card-1',
		title: 'Migration ERP Sogexia',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		current_step_id: 'step-1',
		email_local_part: 'c-cvk2w2a1',
		amount: 125000,
		currency: 'EUR',
		next_action: 'Obtenir le cadrage technique',
		next_action_at: '2026-08-20T09:00:00+00:00',
		archived_at: null,
		profiles: { id: 'p-1', full_name: 'Driss Lemoine', avatar_url: null },
		workspaces: { inbound_domain: 'crm.p2enjoy.test' },
		...surcharge,
	}
}

const copieQuiReussit = () => Promise.resolve(true)

describe("l'en-tête d'une affaire complète", () => {
	it('rend le titre en niveau 2, nom accessible de la section', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByRole('heading', { level: 2, name: 'Migration ERP Sogexia' })).toBeTruthy()
	})

	it('rend le responsable, son nom écrit et son avatar décoratif', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-responsable')
		expect(ligne.textContent).toContain('Responsable')
		expect(ligne.textContent).toContain('Driss Lemoine')
		// L'avatar ne porte AUCUN nom accessible : le nom est écrit à côté, et l'annoncer deux fois
		// serait une redondance (docs/SPEC-identite.md §7).
		expect(screen.queryByRole('img', { name: 'Driss Lemoine' })).toBeNull()
	})

	it('rend le montant et son code devise dans deux éléments distincts', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-montant')
		// Le code devise a SON PROPRE élément : accolé par un nœud de texte nu, `gap` ne le séparerait
		// pas — défaut « Discussion1 » du §5.11 du design system.
		const elements = [...ligne.querySelectorAll('code, span')].map((n) => n.textContent)
		expect(elements).toContain('EUR')
		expect(ligne.textContent?.replace(/\s/gu, '')).toContain('125000,00')
	})

	it("rend la prochaine action et son échéance", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-prochaine-action')
		expect(ligne.textContent).toContain('Obtenir le cadrage technique')
		expect(screen.getByTestId('entete-card-echeance').textContent).toBe('20/08/2026')
	})

	it("rend l'adresse composée et son explication d'usage en toutes lettres", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse').textContent).toBe('c-cvk2w2a1@crm.p2enjoy.test')
		// L'explication est un TEXTE, pas seulement un `title` : une infobulle native n'apparaît ni
		// au clavier, ni au toucher (§15.5).
		expect(screen.getByText(/Mettez cette adresse en copie/u)).toBeTruthy()
	})

	it("ne porte aucune pilule « Archivé » sur une affaire en cours", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-archivee')).toBeNull()
	})
})

describe('les données absentes', () => {
	// LE RESPONSABLE EST LA SEULE ABSENCE QUI SOIT UNE PHRASE (§5.3 bis) : n'avoir personne à qui
	// s'adresser est un fait de l'affaire.
	it("écrit « Aucun responsable » plutôt que d'omettre la ligne", () => {
		render(<EnTeteCard card={card({ profiles: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-responsable').textContent).toContain('Aucun responsable')
	})

	// LES AUTRES DISPARAISSENT ENTIÈREMENT — ni tiret, ni « non renseigné » (§5.3 bis).
	it('omet la ligne du montant, sans tiret ni mention', () => {
		render(<EnTeteCard card={card({ amount: null })} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-montant')).toBeNull()
		expect(screen.queryByText('—')).toBeNull()
	})

	it('omet la ligne de la prochaine action', () => {
		render(<EnTeteCard card={card({ next_action: null })} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-prochaine-action')).toBeNull()
	})

	// L'ÉCHÉANCE SEULE EST OMISE, la prochaine action reste : une action sans date est une action.
	it("garde la prochaine action lorsque seule l'échéance manque", () => {
		render(<EnTeteCard card={card({ next_action_at: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-prochaine-action').textContent).toContain(
			'Obtenir le cadrage technique',
		)
		expect(screen.queryByTestId('entete-card-echeance')).toBeNull()
	})

	it("écrit « Adresse indisponible » et n'offre aucune copie sans domaine", () => {
		render(<EnTeteCard card={card({ workspaces: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse-absente')).toBeTruthy()
		// Une commande sans objet est une commande morte (docs/DESIGN_SYSTEM.md §5.10).
		expect(screen.queryByTestId('entete-card-copier')).toBeNull()
	})
})

describe("l'affaire archivée", () => {
	it('porte la pilule « Archivé » à côté de son titre', () => {
		render(
			<EnTeteCard card={card({ archived_at: '2026-03-31T16:00:00+00:00' })} copier={copieQuiReussit} />,
		)
		// La mention est un MOT, jamais une teinte seule (docs/DESIGN_SYSTEM.md §1).
		expect(screen.getByTestId('entete-card-archivee').textContent).toContain('Archivé')
	})
})

describe("l'action de copie", () => {
	it("porte un nom accessible qui dit CE QUI est copié", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByRole('button', { name: "Copier l'adresse email de l'affaire" })).toBeTruthy()
	})

	it("copie l'adresse composée, et remplace son libellé par la confirmation", async () => {
		const copier = vi.fn(() => Promise.resolve(true))
		render(<EnTeteCard card={card()} copier={copier} />)
		screen.getByTestId('entete-card-copier').click()
		await waitFor(() => {
			expect(screen.getByTestId('entete-card-copier').textContent).toContain('Copié')
		})
		expect(copier).toHaveBeenCalledWith('c-cvk2w2a1@crm.p2enjoy.test')
		// LA CONFIRMATION REMPLACE, elle ne s'ajoute pas (§5.7 ter) : deux mentions superposées
		// feraient croire à deux gestes.
		expect(screen.getByTestId('entete-card-copier').textContent).not.toContain("Copier l'adresse")
	})

	// UN BOUTON QUI NE FAIT RIEN EN SILENCE est la « simulation de succès » que CLAUDE.md §18
	// interdit : le refus est écrit, avec sa manœuvre de remplacement.
	it('dit le refus du navigateur et nomme la manœuvre de remplacement', async () => {
		render(<EnTeteCard card={card()} copier={() => Promise.resolve(false)} />)
		screen.getByTestId('entete-card-copier').click()
		await waitFor(() => {
			expect(screen.getByTestId('entete-card-copie-etat').textContent).toContain(
				"La copie n'a pas abouti",
			)
		})
		// La région d'annonce existe toujours (§8) : apparue seulement à l'échec, son contenu ne
		// serait pas annoncé par un lecteur d'écran.
		expect(screen.getByTestId('entete-card-copie-etat').getAttribute('role')).toBe('status')
	})
})

// LA RÉGRESSION TROUVÉE PAR LA CAMPAGNE DE FIN DE SESSION, figée ici.
//
// Les preuves d'interface qui substituent le réseau (docs/DESIGN_SYSTEM.md §12.5) servent une card
// SANS ses relations embarquées : `profiles` y est **absente**, et non nulle. `profil.full_name`
// levait alors `Cannot read properties of undefined` et faisait tomber la page entière — cinquante
// et un scénarios rouges. Le type ne garantit jamais une valeur (docs/SPEC-types.md).
describe('une réponse qui ne porte pas les relations embarquées', () => {
	function sansRelations(): CardOuverte {
		const { profiles: _p, workspaces: _w, ...reste } = card()
		return reste as CardOuverte
	}

	it("traite une relation ABSENTE comme une absence de responsable, sans tomber", () => {
		render(<EnTeteCard card={sansRelations()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-responsable').textContent).toContain('Aucun responsable')
	})

	it("traite un workspace ABSENT comme une adresse indisponible", () => {
		render(<EnTeteCard card={sansRelations()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse-absente')).toBeTruthy()
	})
})
