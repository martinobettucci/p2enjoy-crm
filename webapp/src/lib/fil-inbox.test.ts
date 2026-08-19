// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 f
// @verifies docs/SPEC-cards.md §16.16.3 (l'ordre d'apparition EST l'ordre par récence, `dernier`
//           est la première occurrence, `nombre` compte ce que la PAGE porte), §16.16.4 (la
//           sélection désigne un fil), §16.16.5 (le filtre transposé au fil, le fil du message
//           ouvert jamais masqué), §16.16.1 mesure 10
// @verifies docs/SPEC-cards.md §16.15.3 (le COUPLE est la clé, jamais la seule chaîne)
//
// CE QUE CE FICHIER ÉPROUVE, ET QU'AUCUNE AUTRE PREUVE NE PEUT ÉPROUVER : que le groupement ne
// RETRIE rien. Un tri au client passerait toutes les preuves d'interface — l'écran montrerait les
// mêmes fils dans le même ordre sur le seed —, et divergerait silencieusement du serveur le jour
// où l'ordre de la page changerait. La coïncidence est donc figée ici, comme celle de `cleFil`.

import { describe, expect, it } from 'vitest'
import { composerFils, filDuMessage, grouperEnFils, type MessageGroupable } from './fil-inbox'
import { cleCorrespondance, type FilsEndormis } from './sommeil-fil'

const W1 = '5eed0000-0000-4000-8000-000000000001'
const W2 = '5eed0000-0000-4000-8000-000000000002'

const message = (id: string, cleFil: string, workspaceId: string = W1): MessageGroupable => ({
	id,
	workspaceId,
	cleFil,
})

// --- Le groupement — §16.16.3 --------------------------------------------------------------------

describe('grouperEnFils (§16.16.3)', () => {
	it('rend une liste vide sur une page vide', () => {
		expect(grouperEnFils([])).toEqual([])
	})

	it('rend un fil par message quand aucune clé ne se répète — le cas du seed AVANT la tranche', () => {
		// MESURE 1 : les deux messages du seed portent des clés distinctes. La propriété qui rend
		// cette tranche sûre est là — là où les fils sont d'un message, rien ne change.
		const fils = grouperEnFils([
			message('m2', '<seed-inbox-non-classe@p2enjoy.test>'),
			message('m1', '<seed-inbox-classe@p2enjoy.test>'),
		])
		expect(fils).toHaveLength(2)
		expect(fils.map((fil) => fil.nombre)).toEqual([1, 1])
		expect(fils.map((fil) => fil.dernier.id)).toEqual(['m2', 'm1'])
	})

	it('réunit les messages d’une même clé et compte ce que la PAGE porte', () => {
		const fils = grouperEnFils([
			message('reponse', '<racine@x.test>'),
			message('autre', '<autre@x.test>'),
			message('racine', '<racine@x.test>'),
		])
		expect(fils).toHaveLength(2)
		expect(fils[0]?.nombre).toBe(2)
		expect(fils[0]?.messages.map((m) => m.id)).toEqual(['reponse', 'racine'])
		expect(fils[1]?.nombre).toBe(1)
	})

	it('PREND LA PREMIÈRE OCCURRENCE COMME `dernier`, sans comparer aucune date', () => {
		// LA MESURE 10 EST TOUT L'ARGUMENT : la page arrive triée par `received_at` décroissant, donc
		// la première occurrence d'une clé EST son message le plus récent. Ce test échouerait si
		// quelqu'un « améliorait » la fonction en comparant des dates — qu'elle ne reçoit même pas.
		const fils = grouperEnFils([
			message('recent', '<racine@x.test>'),
			message('ancien', '<racine@x.test>'),
		])
		expect(fils[0]?.dernier.id).toBe('recent')
	})

	it('PRÉSERVE L’ORDRE D’APPARITION DES CLÉS, et ne retrie jamais', () => {
		const fils = grouperEnFils([
			message('c', '<gamma@x.test>'),
			message('a', '<alpha@x.test>'),
			message('b', '<beta@x.test>'),
		])
		// L'ordre alphabétique donnerait alpha, beta, gamma : le groupement ne l'invente pas.
		expect(fils.map((fil) => fil.cleFil)).toEqual(['<gamma@x.test>', '<alpha@x.test>', '<beta@x.test>'])
	})

	it('NE FUSIONNE PAS deux workspaces portant la même clé de fil', () => {
		// La mesure 5 du §16.14.1 : `mail_messages_dedoublonnage` est unique sur
		// `(workspace_id, rfc822_message_id)`. Une clé n'est donc unique QUE dans son workspace.
		const fils = grouperEnFils([
			message('chez-un', '<meme@x.test>', W1),
			message('chez-deux', '<meme@x.test>', W2),
		])
		expect(fils).toHaveLength(2)
		expect(fils[0]?.cle).toBe(cleCorrespondance(W1, '<meme@x.test>'))
		expect(fils[1]?.cle).toBe(cleCorrespondance(W2, '<meme@x.test>'))
	})

	it('accepte `__proto__` comme clé de fil — un `Message-ID` est une chaîne arbitraire', () => {
		// Sur un objet nu, cette clé n'écrirait pas une entrée mais le prototype, et le fil
		// disparaîtrait de la liste sans aucune erreur.
		const fils = grouperEnFils([message('m1', '__proto__'), message('m2', '__proto__')])
		expect(fils).toHaveLength(1)
		expect(fils[0]?.nombre).toBe(2)
	})
})

// --- Le filtre transposé au fil — §16.16.5 -------------------------------------------------------

const FUTUR = '2099-01-01T00:00:00.000Z'
const PASSE = '2020-01-01T00:00:00.000Z'
const MAINTENANT = new Date('2026-08-19T12:00:00.000Z')

const endormis = (...couples: ReadonlyArray<readonly [string, string, string]>): FilsEndormis =>
	new Map(couples.map(([ws, cle, echeance]) => [cleCorrespondance(ws, cle), echeance]))

describe('composerFils (§16.16.5)', () => {
	const fils = grouperEnFils([
		message('dormeur-recent', '<dort@x.test>'),
		message('eveille', '<eveille@x.test>'),
		message('dormeur-ancien', '<dort@x.test>'),
	])

	it('masque le fil endormi ENTIER, et en compte UN — pas ses deux messages', () => {
		const compose = composerFils(fils, endormis([W1, '<dort@x.test>', FUTUR]), 'masquees', MAINTENANT)
		expect(compose.visibles.map((fil) => fil.cleFil)).toEqual(['<eveille@x.test>'])
		expect(compose.masques).toBe(1)
	})

	it('ne masque RIEN en mode « visibles », et le compte des masqués retombe à zéro', () => {
		const compose = composerFils(fils, endormis([W1, '<dort@x.test>', FUTUR]), 'visibles', MAINTENANT)
		expect(compose.visibles).toHaveLength(2)
		expect(compose.masques).toBe(0)
	})

	it('NE MASQUE PAS le fil du message ouvert, même quand ce message n’en est pas le dernier', () => {
		// C'EST LE POINT DÉLICAT DE LA TRANSPOSITION : le prédicat porte sur `fil.messages`, non sur
		// `fil.dernier`. Le tester sur `dernier` seul laisserait disparaître la ligne dès que
		// l'utilisateur choisit un message plus ancien du fil dans le sélecteur du §16.16.4.
		const compose = composerFils(
			fils,
			endormis([W1, '<dort@x.test>', FUTUR]),
			'masquees',
			MAINTENANT,
			'dormeur-ancien',
		)
		expect(compose.visibles.map((fil) => fil.cleFil)).toEqual(['<dort@x.test>', '<eveille@x.test>'])
		expect(compose.masques).toBe(0)
	})

	it('UNE ÉCHÉANCE ÉCHUE N’EST PAS UN SOMMEIL : le fil reste affiché', () => {
		const compose = composerFils(fils, endormis([W1, '<dort@x.test>', PASSE]), 'masquees', MAINTENANT)
		expect(compose.visibles).toHaveLength(2)
		expect(compose.masques).toBe(0)
	})
})

// --- Le repère de sélection — §16.16.4 -----------------------------------------------------------

describe('filDuMessage (§16.16.4)', () => {
	const fils = grouperEnFils([message('recent', '<racine@x.test>'), message('ancien', '<racine@x.test>')])

	it('rend `null` quand aucun message n’est ouvert', () => {
		expect(filDuMessage(fils, null)).toBeNull()
	})

	it('DÉSIGNE LE FIL même quand le message ouvert n’en est pas le dernier', () => {
		expect(filDuMessage(fils, 'ancien')?.cleFil).toBe('<racine@x.test>')
	})

	it('rend `null` pour un message absent de la page — la sélection ne s’invente pas', () => {
		expect(filDuMessage(fils, 'inconnu')).toBeNull()
	})
})
