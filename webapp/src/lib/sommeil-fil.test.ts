// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 e
// @verifies docs/SPEC-cards.md §16.15.2 (`cleFil` est le miroir EXACT de `app.cle_fil`, sans
//           tolérance), §16.15.3 (la table de correspondance porte le COUPLE), §16.15.4 (le
//           prédicat et ses deux côtés), §16.15.5 (le filtre de composition, le compte des masqués,
//           le message ouvert jamais masqué), §16.15.6 (le dictionnaire fermé des issues, moins une)
// @verifies docs/SPEC-cards.md §16.14.2 (la racine RFC 5322), §16.14.4, §16.14.5
//
// CE QUE CE FICHIER ÉPROUVE, ET QU'AUCUNE AUTRE PREUVE NE PEUT ÉPROUVER : la coïncidence des deux
// définitions de la clé de fil — celle du serveur, `app.cle_fil`, et celle de l'écran. Les mesures
// A du §16.15.1 la fondent ; ici elle est figée, pour que « améliorer » l'une des deux devienne un
// échec plutôt qu'un refus incompréhensible en production.

import { describe, expect, it } from 'vitest'
import {
	classerSommeilFil,
	cleCorrespondance,
	cleFil,
	composerListe,
	echeanceFil,
	indexerFilsEndormis,
	type LigneSommeilFil,
} from './sommeil-fil'

// --- La clé d'un fil — §16.15.2 -----------------------------------------------------------------

describe('la clé d’un fil (§16.15.2)', () => {
	it('rend le Message-ID propre quand la chaîne de références est vide — le cas COURANT du seed', () => {
		// MESURE A : les deux messages du seed portent `references_ids` = `[]`, jamais `null`.
		expect(cleFil([], '<seed-inbox-classe@p2enjoy.test>')).toBe('<seed-inbox-classe@p2enjoy.test>')
	})

	it('rend le PREMIER élément de References — la racine RFC 5322 —, jamais le dernier', () => {
		expect(cleFil(['<racine@x.test>', '<intermediaire@x.test>'], '<feuille@x.test>')).toBe(
			'<racine@x.test>',
		)
	})

	it('traite un tableau `null` comme un tableau vide', () => {
		// Le type engendré autorise `null` ; `coalesce` le traiterait de la même façon.
		expect(cleFil(null, '<propre@x.test>')).toBe('<propre@x.test>')
	})

	it('RETIENT UNE CHAÎNE VIDE, parce que `coalesce` la retiendrait aussi', () => {
		// C'EST LE TEST QUI PROTÈGE LA COÏNCIDENCE DES DEUX DÉFINITIONS. Écarter ici la chaîne vide
		// serait « améliorer » la règle d'un seul côté : l'écran demanderait alors le sommeil d'une
		// clé que la garde du serveur ne connaît pas, et `thread_not_found` porterait sur une clé
		// que personne n'a affichée (§16.15.2).
		expect(cleFil([''], '<propre@x.test>')).toBe('')
	})
})

// --- La table de correspondance — §16.15.3 -------------------------------------------------------

const ligne = (partiel: Partial<LigneSommeilFil> = {}): LigneSommeilFil => ({
	workspace_id: 'w1',
	thread_key: '<fil@x.test>',
	snoozed_until: '2099-01-01T00:00:00.000Z',
	...partiel,
})

describe('la table des fils endormis (§16.15.3)', () => {
	it('indexe sur le COUPLE, de sorte que deux workspaces portant la même clé ne se confondent pas', () => {
		// La mesure 5 du §16.14.1 : une clé de fil n'est unique qu'à l'intérieur de son workspace.
		const fils = indexerFilsEndormis([
			ligne({ workspace_id: 'w1', snoozed_until: '2099-01-01T00:00:00.000Z' }),
			ligne({ workspace_id: 'w2', snoozed_until: '2099-06-01T00:00:00.000Z' }),
		])
		expect(fils.size).toBe(2)
		expect(fils.get(cleCorrespondance('w1', '<fil@x.test>'))).toBe('2099-01-01T00:00:00.000Z')
		expect(fils.get(cleCorrespondance('w2', '<fil@x.test>'))).toBe('2099-06-01T00:00:00.000Z')
	})
})

// --- Le prédicat — §16.15.4 ---------------------------------------------------------------------

const MAINTENANT = new Date('2026-08-19T12:00:00.000Z')

describe('le prédicat de sommeil d’un fil (§16.15.4)', () => {
	const fils = indexerFilsEndormis([
		ligne({ thread_key: '<futur@x.test>', snoozed_until: '2026-08-20T12:00:00.000Z' }),
		ligne({ thread_key: '<echu@x.test>', snoozed_until: '2026-08-18T12:00:00.000Z' }),
		ligne({ thread_key: '<pile@x.test>', snoozed_until: '2026-08-19T12:00:00.000Z' }),
		ligne({ thread_key: '<illisible@x.test>', snoozed_until: 'pas-une-date' }),
	])

	it('rend l’échéance d’un fil dont l’échéance est FUTURE', () => {
		expect(echeanceFil(fils, 'w1', '<futur@x.test>', MAINTENANT)).toBe('2026-08-20T12:00:00.000Z')
	})

	it('ne rend RIEN d’un fil dont l’échéance est ÉCHUE — une échéance passée n’est pas un sommeil', () => {
		expect(echeanceFil(fils, 'w1', '<echu@x.test>', MAINTENANT)).toBeNull()
	})

	it('ne rend rien à l’instant EXACT de l’échéance : le prédicat est STRICT', () => {
		expect(echeanceFil(fils, 'w1', '<pile@x.test>', MAINTENANT)).toBeNull()
	})

	it('ne rend rien d’un fil absent de la table — l’absence de ligne EST « éveillé »', () => {
		expect(echeanceFil(fils, 'w1', '<jamais-endormi@x.test>', MAINTENANT)).toBeNull()
	})

	it('ne rend rien d’une échéance que `Date` ne sait pas lire, plutôt qu’un `NaN` propagé', () => {
		expect(echeanceFil(fils, 'w1', '<illisible@x.test>', MAINTENANT)).toBeNull()
	})

	it('ne confond pas deux workspaces', () => {
		expect(echeanceFil(fils, 'w2', '<futur@x.test>', MAINTENANT)).toBeNull()
	})
})

// --- Le filtre de composition — §16.15.5 --------------------------------------------------------

const message = (id: string, cle: string, workspaceId = 'w1') => ({ id, workspaceId, cleFil: cle })

describe('le filtre de composition (§16.15.5)', () => {
	const fils = indexerFilsEndormis([
		ligne({ thread_key: '<dort@x.test>', snoozed_until: '2026-08-20T12:00:00.000Z' }),
	])
	const messages = [
		message('m1', '<dort@x.test>'),
		message('m2', '<eveille@x.test>'),
		message('m3', '<dort@x.test>'),
	]

	it('masque les messages d’un fil endormi et COMPTE ce qu’il a masqué', () => {
		const { visibles, masques } = composerListe(messages, fils, 'masquees', MAINTENANT)
		expect(visibles.map((m) => m.id)).toEqual(['m2'])
		expect(masques).toBe(2)
	})

	it('rend tout en mode « visibles », et ne masque alors RIEN', () => {
		const { visibles, masques } = composerListe(messages, fils, 'visibles', MAINTENANT)
		expect(visibles).toHaveLength(3)
		// Le compte est zéro sur une liste rendue entière : c'est ce qui permet à l'état vide de
		// dire s'il est dû au sommeil ou à un dossier réellement vide.
		expect(masques).toBe(0)
	})

	it('NE MASQUE JAMAIS LE MESSAGE OUVERT, même si son fil dort', () => {
		// Endormir le fil de ce qu'on lit fait quitter la ligne de la liste ; vider le panneau de
		// lecture sous le geste de l'utilisateur serait le punir de l'avoir fait (§16.15.5).
		const { visibles, masques } = composerListe(messages, fils, 'masquees', MAINTENANT, 'm1')
		expect(visibles.map((m) => m.id)).toEqual(['m1', 'm2'])
		expect(masques).toBe(1)
	})

	it('ne masque pas un message dont le fil dort dans un AUTRE workspace', () => {
		const etranger = [message('m4', '<dort@x.test>', 'w2')]
		const { visibles, masques } = composerListe(etranger, fils, 'masquees', MAINTENANT)
		expect(visibles).toHaveLength(1)
		expect(masques).toBe(0)
	})

	it('ne masque rien quand aucune ligne n’existe : une liste sans fil endormi sort entière', () => {
		const { visibles, masques } = composerListe(messages, new Map(), 'masquees', MAINTENANT)
		expect(visibles).toHaveLength(3)
		expect(masques).toBe(0)
	})
})

// --- Le classement des issues — §16.15.6 --------------------------------------------------------

describe('le classement des issues (§16.15.6)', () => {
	it('classe les TROIS refus sur leur message, mesurés aux points I, K1, K2 et M du §16.15.1', () => {
		expect(classerSommeilFil(400, 'thread_not_found', 'endormi')).toBe('introuvable')
		expect(classerSommeilFil(400, 'snooze_date_required', 'endormi')).toBe('echeance-requise')
		expect(classerSommeilFil(400, 'snooze_date_in_past', 'endormi')).toBe('echeance-passee')
	})

	it('classe le refus du RÉVEIL de la même façon — mesure M, la lectrice reçoit `thread_not_found`', () => {
		expect(classerSommeilFil(400, 'thread_not_found', 'reveille')).toBe('introuvable')
	})

	it('rend le succès qu’on lui a passé, et lui seul', () => {
		expect(classerSommeilFil(200, null, 'endormi')).toBe('endormi')
		expect(classerSommeilFil(200, null, 'reveille')).toBe('reveille')
	})

	it('nomme une absence de réponse « réseau », jamais un refus du serveur', () => {
		expect(classerSommeilFil(undefined, null, 'endormi')).toBe('reseau')
		expect(classerSommeilFil(0, null, 'endormi')).toBe('reseau')
	})

	it('ne prétend pas savoir ce que le serveur n’a pas dit', () => {
		expect(classerSommeilFil(400, 'un_refus_que_personne_n_a_ecrit', 'endormi')).toBe('inconnu')
		expect(classerSommeilFil(500, null, 'endormi')).toBe('inconnu')
	})

	it('N’A AUCUNE ISSUE `refus`, et c’est mesuré : `snooze_thread` n’oppose aucun `forbidden`', () => {
		// Le §16.14.4 l'établit : aucun droit d'écriture n'est défini sur un fil de messagerie, donc
		// la garde ne peut opposer que `thread_not_found`. Un `403` — que rien ne produit — retombe
		// donc sur `inconnu`, et l'écran ne porte aucune mention qu'il ne pourrait jamais afficher.
		expect(classerSommeilFil(403, null, 'endormi')).toBe('inconnu')
	})
})
