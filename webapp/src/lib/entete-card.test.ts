// @verifies CRM-040 (docs/BACKLOG.md) — composition de l'en-tête de la fiche d'affaire
// @verifies docs/SPEC-cards.md §15.3 (l'adresse n'est pas composable sans domaine),
//           §15.4 (montant, échéance, affaire archivée), §3.5 (l'adresse est une dérivation)
// @verifies docs/DESIGN_SYSTEM.md §5.3 bis (le code devise dans son propre élément), §2
//
// Ces cas vivent hors du composant, comme ceux de `formulaire.ts` : ils exercent la RÈGLE, sans
// navigateur ni rendu, et c'est ce qui les rend lisibles quand ils échouent.

import { describe, expect, it } from 'vitest'
import { composerAdresseCard, estArchivee, formaterEcheance, formaterMontant } from './entete-card'
import type { CardOuverte } from './formulaire'

function card(surcharge: Partial<CardOuverte> = {}): CardOuverte {
	return {
		id: 'card-1',
		title: 'Migration ERP',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		current_step_id: 'step-1',
		email_local_part: 'c-cvk2w2a1',
		amount: null,
		currency: 'EUR',
		next_action: null,
		next_action_at: null,
		archived_at: null,
		profiles: null,
		workspaces: { inbound_domain: 'crm.p2enjoy.test' },
		...surcharge,
	}
}

describe("l'adresse de l'affaire", () => {
	it('compose la partie locale et le domaine du workspace', () => {
		expect(composerAdresseCard(card())).toBe('c-cvk2w2a1@crm.p2enjoy.test')
	})

	// SANS DOMAINE, AUCUNE ADRESSE — et surtout pas la partie locale seule, qui serait une adresse
	// fausse et non incomplète (docs/SPEC-cards.md §15.3).
	it("ne compose rien lorsque le workspace n'est pas consenti", () => {
		expect(composerAdresseCard(card({ workspaces: null }))).toBeNull()
	})

	it('ne compose rien lorsque le domaine entrant est nul', () => {
		expect(composerAdresseCard(card({ workspaces: { inbound_domain: null } }))).toBeNull()
	})

	it('ne compose rien lorsque le domaine est une chaîne de blancs', () => {
		expect(composerAdresseCard(card({ workspaces: { inbound_domain: '   ' } }))).toBeNull()
	})
})

describe('le montant', () => {
	it('rend le nombre et le code devise séparément', () => {
		const rendu = formaterMontant(card({ amount: 125000, currency: 'EUR' }))
		expect(rendu?.devise).toBe('EUR')
		// L'espace de groupement du français est insécable : la comparaison porte sur les chiffres
		// et la virgule décimale, jamais sur la classe d'espace, que la version d'ICU peut changer.
		expect(rendu?.montant.replace(/\s/gu, '')).toBe('125000,00')
	})

	// ZÉRO EST UN MONTANT. Seule l'absence de valeur fait disparaître la ligne (§15.4) : confondre
	// les deux ferait passer une affaire chiffrée à zéro pour une affaire non chiffrée.
	it('rend zéro plutôt que rien', () => {
		expect(formaterMontant(card({ amount: 0 }))?.montant.replace(/\s/gu, '')).toBe('0,00')
	})

	it('ne rend rien lorsque le montant est absent', () => {
		expect(formaterMontant(card({ amount: null }))).toBeNull()
	})

	// La base ne contraint que la FORME du code devise, jamais sa liste réelle : un code inconnu
	// ne doit pas faire tomber l'écran, ce qu'un `style: 'currency'` provoquerait en `RangeError`.
	it("n'échoue pas sur un code devise que le navigateur ne connaît pas", () => {
		const rendu = formaterMontant(card({ amount: 42, currency: 'XYZ' }))
		expect(rendu?.devise).toBe('XYZ')
		expect(rendu?.montant.replace(/\s/gu, '')).toBe('42,00')
	})
})

describe("l'échéance", () => {
	it('rend une date courte', () => {
		expect(formaterEcheance('2026-08-20T09:00:00+00:00')).toBe('20/08/2026')
	})

	it('ne rend rien sans échéance', () => {
		expect(formaterEcheance(null)).toBeNull()
	})

	// Le type généré ne garantit aucune valeur (docs/SPEC-types.md) : « Invalid Date » à l'écran
	// serait une valeur par défaut trompeuse (CLAUDE.md §18).
	it('ne rend rien sur une valeur que Date ne sait pas lire', () => {
		expect(formaterEcheance('pas une date')).toBeNull()
	})
})

describe("l'archivage", () => {
	it('reconnaît une affaire archivée', () => {
		expect(estArchivee(card({ archived_at: '2026-03-31T16:00:00+00:00' }))).toBe(true)
	})

	it('reconnaît une affaire en cours', () => {
		expect(estArchivee(card())).toBe(false)
	})
})
