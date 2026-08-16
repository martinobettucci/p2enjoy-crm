// @verifies CRM-040 (docs/BACKLOG.md) — composition de l'en-tête de la fiche d'affaire
// @verifies docs/SPEC-cards.md §15.3 (l'adresse n'est pas composable sans domaine),
//           §15.4 (montant, échéance, affaire archivée), §3.5 (l'adresse est une dérivation)
// @verifies docs/DESIGN_SYSTEM.md §5.3 bis (le code devise dans son propre élément), §2
//
// Ces cas vivent hors du composant, comme ceux de `formulaire.ts` : ils exercent la RÈGLE, sans
// navigateur ni rendu, et c'est ce qui les rend lisibles quand ils échouent.

import { describe, expect, it } from 'vitest'
import {
	classerEcritureEntete,
	composerAdresseCard,
	estArchivee,
	formaterEcheance,
	formaterMontant,
	normaliserSaisieEntete,
} from './entete-card'
import { pourControleDateHeure } from '../app/EnTeteCard'
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
		// Une affaire ÉVEILLÉE par défaut : le sommeil est l'exception, et une fixture qui
		// dormirait rendrait la pastille présente dans toutes les preuves (CRM-081, §16.11).
		snoozed_until: null,
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

// ---------------------------------------------------------------------------------------------
// L'ÉCRITURE des six champs — docs/SPEC-cards.md §15 bis
//
// @verifies CRM-040 (docs/BACKLOG.md) — écriture des champs d'en-tête
// @verifies docs/SPEC-cards.md §15 bis.4 (normalisation des six saisies),
//           §15 bis.6 (la liste des membres), §15 bis.7 (dictionnaire fermé des sept issues),
//           §15 bis.8 (contrat d'API mesuré, lignes b, d, f, h, i, j)
// ---------------------------------------------------------------------------------------------

describe("normalisation d'une saisie d'en-tête", () => {
	it('met la devise en majuscules, parce que la base refuse les minuscules en 23514', () => {
		expect(normaliserSaisieEntete('currency', 'eur')).toBe('EUR')
	})

	it("n'écarte PAS une devise de quatre lettres : c'est la base qui tranche (§15 bis.5)", () => {
		expect(normaliserSaisieEntete('currency', 'euro')).toBe('EURO')
	})

	it('transmet un titre de blancs tel quel, sans trim — la base le refuse en 23514', () => {
		expect(normaliserSaisieEntete('title', '   ')).toBe('   ')
	})

	it('transmet un titre vide tel quel, et ne le convertit jamais en null', () => {
		expect(normaliserSaisieEntete('title', '')).toBe('')
	})

	it('convertit un montant en NOMBRE, jamais en chaîne', () => {
		expect(normaliserSaisieEntete('amount', '48000.5')).toBe(48000.5)
	})

	it('accepte un montant NÉGATIF : aucune contrainte de signe, MESURÉ 200 (§15 bis.5)', () => {
		expect(normaliserSaisieEntete('amount', '-500')).toBe(-500)
	})

	it('garde zéro comme montant, et ne le confond pas avec une absence', () => {
		expect(normaliserSaisieEntete('amount', '0')).toBe(0)
	})

	it('vide un montant par null, jamais par zéro', () => {
		expect(normaliserSaisieEntete('amount', '')).toBeNull()
	})

	it("rend la CHAÎNE d'un montant non convertible, et jamais NaN — que JSON change en null", () => {
		expect(normaliserSaisieEntete('amount', 'douze mille')).toBe('douze mille')
	})

	it('vide la prochaine action, son échéance et le responsable par null', () => {
		expect(normaliserSaisieEntete('next_action', '')).toBeNull()
		expect(normaliserSaisieEntete('next_action_at', '')).toBeNull()
		expect(normaliserSaisieEntete('owner_id', '')).toBeNull()
	})

	it("ne rogne pas la prochaine action : rogner à l'écriture ferait diverger l'écran de la base", () => {
		expect(normaliserSaisieEntete('next_action', '  relancer la DSI  ')).toBe('  relancer la DSI  ')
	})
})

describe("classement d'une écriture d'en-tête", () => {
	it('200 avec une ligne rendue est un enregistrement', () => {
		expect(classerEcritureEntete(200, null, 1)).toBe('enregistree')
	})

	// LA MESURE QUI COMMANDE TOUT LE GESTE : le viewer reçoit 200 et ZÉRO ligne, jamais 403.
	// Sans ce cas, l'écran annoncerait « Enregistré » à qui n'a rien écrit (CLAUDE.md §18).
	it("200 avec ZÉRO ligne est « sans effet », et surtout pas un succès (mesure b)", () => {
		expect(classerEcritureEntete(200, null, 0)).toBe('sans-effet')
	})

	it('23514 en 400 est une valeur invalide — titre vide, devise mal formée (mesures d, e, h)', () => {
		expect(classerEcritureEntete(400, '23514', 0)).toBe('invalide')
	})

	it("22007 en 400 est une valeur invalide — échéance illisible (mesure i)", () => {
		expect(classerEcritureEntete(400, '22007', 0)).toBe('invalide')
	})

	it('23502 en 400 est une valeur invalide — devise vidée sur une colonne NOT NULL (mesure g)', () => {
		expect(classerEcritureEntete(400, '23502', 0)).toBe('invalide')
	})

	it("23503 en 409 nomme un responsable qui n'est plus membre (mesure j)", () => {
		expect(classerEcritureEntete(409, '23503', 0)).toBe('introuvable')
	})

	it('42501 en 403 est un refus de privilège — colonne fermée (mesures k, l)', () => {
		expect(classerEcritureEntete(403, '42501', 0)).toBe('refus')
	})

	it("l'absence de réponse est un défaut de réseau, jamais un refus", () => {
		expect(classerEcritureEntete(undefined, null, 0)).toBe('reseau')
	})

	it("un code inattendu ne se déguise pas : l'interface ne prétend pas savoir", () => {
		expect(classerEcritureEntete(418, 'ZZZZZ', 0)).toBe('inconnu')
		expect(classerEcritureEntete(500, null, 0)).toBe('inconnu')
	})

	it('classe sur le CODE, jamais sur le message — un texte de serveur peut changer sans préavis', () => {
		// Le même SQLSTATE sous deux codes HTTP ne rend pas la même issue : c'est le couple qui décide.
		expect(classerEcritureEntete(400, '23503', 0)).toBe('inconnu')
	})
})

describe("valeur d'un contrôle datetime-local", () => {
	it("rend la chaîne vide pour une échéance absente, jamais « Invalid Date »", () => {
		expect(pourControleDateHeure(null)).toBe('')
	})

	it("rend la chaîne vide pour un horodatage illisible", () => {
		expect(pourControleDateHeure('pas-une-date')).toBe('')
	})

	// L'HEURE LOCALE ET NON UN `slice` DE LA CHAÎNE ISO : la base rend un timestamptz en UTC, et
	// couper la chaîne afficherait l'heure UTC, décalant l'échéance de l'écart de fuseau.
	it("rend les composantes LOCALES au format que le contrôle accepte", () => {
		const attendu = new Date('2026-08-20T09:00:00+00:00')
		const deux = (nombre: number) => String(nombre).padStart(2, '0')
		expect(pourControleDateHeure('2026-08-20T09:00:00+00:00')).toBe(
			`${attendu.getFullYear()}-${deux(attendu.getMonth() + 1)}-${deux(attendu.getDate())}T${deux(attendu.getHours())}:${deux(attendu.getMinutes())}`,
		)
	})

	it("ne porte ni seconde ni fuseau : le contrôle n'accepte que AAAA-MM-JJTHH:MM", () => {
		expect(pourControleDateHeure('2026-08-20T09:00:00+00:00')).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
		)
	})
})
