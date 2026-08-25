// @verifies CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 a
// @verifies docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.3 (les quatre
//           refus), §16.4 (l'idempotence du réveil), §16.11.1 (le prédicat et son instant
//           injectable), §16.11.3 (les quatre échéances usuelles et la saisie),
//           §16.11.4 (dictionnaire fermé des huit issues)
// @verifies docs/DESIGN_SYSTEM.md §5.3 quater (aucune garde de saisie ne double la base)
//
// Ces preuves n'ouvrent aucun navigateur : c'est tout l'objet de la séparation du module. Le
// prédicat est éprouvé DES DEUX CÔTÉS de l'échéance avec un instant injecté, ce qu'aucune fixture
// de date fixe ne permettrait — une échéance figée cesserait d'être future au bout de quelques
// semaines et la preuve changerait de verdict sans que le produit ait bougé.

import { describe, expect, it } from 'vitest'
import {
	ECHEANCES_USUELLES,
	classerSommeil,
	echeanceSaisie,
	echeanceUsuelle,
	estEnSommeil,
	formaterEcheanceSommeil,
	mettreEnSommeil,
	reveiller,
	type IssueSommeil,
} from './sommeil-card'
import type { ClientCrm } from './supabase'

const MAINTENANT = new Date('2026-08-16T12:00:00Z')

describe('estEnSommeil — le prédicat du §16.2, des deux côtés', () => {
	it('une échéance future est un sommeil', () => {
		expect(estEnSommeil('2026-08-26T12:00:00Z', MAINTENANT)).toBe(true)
	})

	it('une échéance passée n’en est PAS un, et la colonne conserve pourtant sa valeur', () => {
		expect(estEnSommeil('2026-08-14T12:00:00Z', MAINTENANT)).toBe(false)
	})

	it('une colonne nulle n’est pas un sommeil', () => {
		expect(estEnSommeil(null, MAINTENANT)).toBe(false)
	})

	it('l’instant exact de l’échéance n’est PAS un sommeil : le §16.2 dit « strictement future »', () => {
		expect(estEnSommeil('2026-08-16T12:00:00Z', MAINTENANT)).toBe(false)
	})

	it('une valeur illisible rend `false` plutôt qu’une comparaison sur `NaN`', () => {
		expect(estEnSommeil('pas-une-date', MAINTENANT)).toBe(false)
	})
})

describe('formaterEcheanceSommeil — la date courte du produit', () => {
	// L'ÉCHÉANCE EST CONSTRUITE EN HEURE LOCALE, ET C'EST LA CORRECTION D'INC-203. Écrite en `Z`,
	// elle figeait le jour civil d'un hôte réglé en UTC : `2026-08-26T12:00:00Z` est le **27** à
	// Auckland, et la preuve rougissait sur une machine dont le fuseau décale la journée, sans que
	// le produit ait bougé. `formaterEcheanceSommeil` rend la date dans le fuseau du LECTEUR, ce
	// qu'elle doit faire ; c'est l'attente qui devait cesser de dépendre de la montre de l'hôte.
	// Midi LOCAL du 26 août est le 26 août partout, par construction.
	it('rend la date courte de l’échéance', () => {
		const midiLocal = new Date(2026, 7, 26, 12, 0, 0).toISOString()
		expect(formaterEcheanceSommeil(midiLocal)).toBe('26/08/2026')
	})

	it('rend `null` sur une valeur illisible, jamais « Invalid Date »', () => {
		expect(formaterEcheanceSommeil('pas-une-date')).toBeNull()
	})

	it('rend `null` sur une colonne nulle', () => {
		expect(formaterEcheanceSommeil(null)).toBeNull()
	})
})

describe('echeanceUsuelle — quatre échéances, comptées depuis l’instant courant', () => {
	it('les quatre du §16.11.3 valent 1, 3, 7 et 30 jours', () => {
		expect(ECHEANCES_USUELLES.map((usuelle) => usuelle.jours)).toEqual([1, 3, 7, 30])
	})

	it('« demain » vaut l’instant courant plus un jour, à la MÊME heure', () => {
		expect(echeanceUsuelle(1, MAINTENANT)).toBe('2026-08-17T12:00:00.000Z')
	})

	it('« le mois prochain » vaut trente jours, non le même quantième du mois suivant', () => {
		expect(echeanceUsuelle(30, new Date('2026-01-31T09:00:00Z'))).toBe('2026-03-02T09:00:00.000Z')
	})

	it('chaque échéance usuelle est un sommeil pour le prédicat', () => {
		for (const usuelle of ECHEANCES_USUELLES) {
			expect(estEnSommeil(echeanceUsuelle(usuelle.jours, MAINTENANT), MAINTENANT)).toBe(true)
		}
	})
})

describe('echeanceSaisie — la conversion d’un `datetime-local`', () => {
	it('convertit une saisie locale en ISO 8601', () => {
		// `Date` interprète une chaîne sans fuseau dans celui du navigateur : la preuve compare donc
		// à ce que la même conversion rend, plutôt qu'à une constante qui dépendrait de `TZ`.
		expect(echeanceSaisie('2026-09-01T14:30')).toBe(new Date('2026-09-01T14:30').toISOString())
	})

	it('une saisie VIDE rend `null`, et ce null est ENVOYÉ : c’est la base qui refuse', () => {
		expect(echeanceSaisie('')).toBeNull()
	})

	it('une saisie illisible rend `null` plutôt qu’une date inventée', () => {
		expect(echeanceSaisie('pas-une-date')).toBeNull()
	})
})

describe('classerSommeil — les huit issues du §16.11.4', () => {
	const cas: readonly (readonly [number | undefined, string | null, 'endormie' | 'reveillee', IssueSommeil])[] = [
		[200, null, 'endormie', 'endormie'],
		[200, null, 'reveillee', 'reveillee'],
		[400, 'snooze_date_required', 'endormie', 'echeance-requise'],
		[400, 'snooze_date_in_past', 'endormie', 'echeance-passee'],
		[400, 'card_not_found', 'endormie', 'introuvable'],
		[403, 'forbidden', 'endormie', 'refus'],
		[undefined, null, 'endormie', 'reseau'],
		[500, 'boom', 'endormie', 'inconnu'],
	]

	for (const [statut, message, succes, attendu] of cas) {
		it(`${statut ?? 'aucune réponse'} / ${message ?? 'sans message'} → ${attendu}`, () => {
			expect(classerSommeil(statut, message, succes)).toBe(attendu)
		})
	}

	it('un code inattendu SANS message ne devient pas un succès', () => {
		expect(classerSommeil(418, null, 'endormie')).toBe('inconnu')
	})

	it('les quatre refus sont distingués par leur MESSAGE, trois partageant `P0001`', () => {
		const messages = ['snooze_date_required', 'snooze_date_in_past', 'card_not_found']
		const issues = messages.map((message) => classerSommeil(400, message, 'endormie'))
		expect(new Set(issues).size).toBe(3)
	})
})

/** Un client réduit à `rpc`, suffisant pour éprouver les deux gestes sans réseau. */
function clientRpc(reponse: { status?: number; error?: { message: string } | null; data?: unknown }) {
	return {
		rpc: async () => ({
			status: reponse.status,
			error: reponse.error ?? null,
			data: reponse.data ?? null,
		}),
	} as unknown as ClientCrm
}

describe('mettreEnSommeil et reveiller — la ligne rendue est la source, jamais la saisie', () => {
	it('un succès rend l’échéance que la BASE a écrite', async () => {
		const client = clientRpc({
			status: 200,
			data: { id: 'card-1', snoozed_until: '2026-08-26T12:00:00Z' },
		})
		const resultat = await mettreEnSommeil(client, 'card-1', '2026-08-26T12:00:00Z')
		expect(resultat.issue).toBe('endormie')
		expect(resultat.issue === 'endormie' && resultat.ligne.snoozed_until).toBe(
			'2026-08-26T12:00:00Z',
		)
	})

	it('un refus ne rend AUCUNE ligne : rien n’a été écrit', async () => {
		const client = clientRpc({ status: 400, error: { message: 'snooze_date_in_past' } })
		const resultat = await mettreEnSommeil(client, 'card-1', '2020-01-01T00:00:00Z')
		expect(resultat.issue).toBe('echeance-passee')
		expect('ligne' in resultat).toBe(false)
	})

	it('le réveil rend une échéance nulle', async () => {
		const client = clientRpc({ status: 200, data: { id: 'card-1', snoozed_until: null } })
		const resultat = await reveiller(client, 'card-1')
		expect(resultat.issue).toBe('reveillee')
		expect(resultat.issue === 'reveillee' && resultat.ligne.snoozed_until).toBeNull()
	})

	it('le réveil d’une affaire qui ne dort pas est un SUCCÈS, non un refus (§16.4)', async () => {
		const client = clientRpc({ status: 200, data: { id: 'card-1', snoozed_until: null } })
		expect((await reveiller(client, 'card-1')).issue).toBe('reveillee')
	})

	it('un `200` sans ligne exploitable retombe sur `inconnu`, jamais sur un succès inventé', async () => {
		const client = clientRpc({ status: 200, data: null })
		expect((await mettreEnSommeil(client, 'card-1', '2026-08-26T12:00:00Z')).issue).toBe('inconnu')
	})

	it('une panne de transport relancée est classée `reseau`, non `inconnu`', async () => {
		const client = {
			rpc: async () => {
				throw new Error('transport')
			},
		} as unknown as ClientCrm
		expect((await reveiller(client, 'card-1')).issue).toBe('reseau')
	})
})
