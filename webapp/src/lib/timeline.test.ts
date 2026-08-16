// @verifies CRM-044 (docs/BACKLOG.md) — fusion du fil, familles, filtres et résolution des libellés
// @verifies CRM-022 (docs/BACKLOG.md) — acteur embarqué et auteur nommé
// @verifies docs/SPEC-cards.md §14.4 (les dix types), §14.6 (payloads, aucun libellé),
//           §14.10 (une requête par source, fusion en mémoire, ordre total)
// @verifies docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée, cinq familles, compte de la source)
// @verifies docs/JOURNAL.md décisions 204 (`clock_timestamp()`), 209 (fusion à la lecture)
//
// Ces tests portent sur la LOGIQUE, sans navigateur : c'est ce que la séparation du module rend
// possible. Le rendu est éprouvé par `webapp/src/app/PanneauTimeline.test.tsx`.

import { describe, expect, it } from 'vitest'
import type { CommentaireAffiche } from './commentaires'
import {
	COLONNES_EVENEMENT,
	FAMILLES,
	TYPES_EVENEMENT,
	compterParFamille,
	familleDe,
	filtrer,
	fusionnerFil,
	projeterEvenements,
	resoudreDetail,
	type EvenementLu,
	type Famille,
	type LigneEvenement,
} from './timeline'

function evenement(partiel: Partial<EvenementLu> & { id: string }): EvenementLu {
	return {
		card_id: 'card-1',
		type: 'created',
		actor_id: null,
		payload: {},
		created_at: '2026-08-05T10:00:00.000Z',
		acteur: null,
		...partiel,
	}
}

function commentaire(partiel: Partial<CommentaireAffiche> & { id: string }): CommentaireAffiche {
	return {
		auteurId: 'profil-1',
		auteur: null,
		corps: 'Une parole.',
		creeLe: '2026-08-05T10:00:00.000Z',
		modifieLe: null,
		supprime: false,
		retireParModeration: false,
		...partiel,
	}
}

describe('la requête émise', () => {
	// `workspace_id` n'est pas demandée : une dénormalisation que l'écran n'affiche pas. Une
	// requête ne rapporte que ce que l'écran montre.
	it('embarque le profil de l’acteur et omet les dénormalisations invisibles', () => {
		expect(COLONNES_EVENEMENT).toContain('acteur:profiles!card_events_actor_id_fkey')
		expect(COLONNES_EVENEMENT).not.toContain('workspace_id')
	})
})

describe('les familles (docs/DESIGN_SYSTEM.md §5.11)', () => {
	// RÉVISÉ PAR `CRM-057`, ET L'ASSERTION AVAIT BIEN JOUÉ. Elle figeait « dix types, quatre
	// familles » et est devenue rouge à l'arrivée du onzième : `mail_received`. Elle est révisée,
	// non retirée — les cinq familles sont désormais toutes portées.
	//
	// RÉVISÉE À NOUVEAU PAR `CRM-081`, tranche 2 a : `snoozed` et `woken` portent le vocabulaire de
	// l'écran à TREIZE (docs/SPEC-cards.md §16.11.5). Le compte est révisé avec son motif écrit
	// ici, jamais retiré (décision 51) : c'est un arbitrage, non une régression. Les cinq familles
	// restent cinq, et c'est précisément ce que cette assertion garde.
	it('range les treize types livrés dans exactement cinq familles d’événements', () => {
		expect(TYPES_EVENEMENT).toHaveLength(13)
		const familles = new Set(TYPES_EVENEMENT.map((type) => familleDe(type)))
		expect([...familles].sort()).toEqual(['champs', 'cycle', 'discussion', 'etapes', 'organisation'])
		expect(TYPES_EVENEMENT).toContain('channel_changed')
		expect(TYPES_EVENEMENT).toContain('workflow_changed')
		expect(familleDe('channel_changed')).toBe('organisation')
		expect(familleDe('workflow_changed')).toBe('organisation')
	})

	// RÉVISÉE ELLE AUSSI : la discussion n'était portée par aucun TYPE — seuls les commentaires y
	// tombaient. `CRM-057` y range le courrier reçu, parce qu'un message est une parole et non un
	// fait de cycle de vie (docs/SPEC-mail-subsystem.md §18.6). La famille reste unique.
	it('déclare cinq familles, dont la discussion que le courrier reçu porte désormais', () => {
		expect([...FAMILLES]).toEqual(['discussion', 'etapes', 'champs', 'organisation', 'cycle'])
		expect(TYPES_EVENEMENT.filter((type) => familleDe(type) === 'discussion')).toEqual([
			'mail_received',
		])
	})

	// Le repli est DOCUMENTÉ : la valeur vient du backend, et un type ne garantit jamais une
	// valeur. Un événement inconnu doit rester VISIBLE — c'est une mémoire. Le témoin n'est plus
	// `mail_received`, qui est désormais un type CONNU : s'en servir encore aurait mesuré autre
	// chose que le repli.
	it('replie un type inconnu sur le cycle de vie plutôt que de le perdre', () => {
		expect(familleDe('mail_sent')).toBe('cycle')
		expect(familleDe('')).toBe('cycle')
	})
})

describe('la fusion (décision 209)', () => {
	it('range les deux sources dans l’ordre CROISSANT', () => {
		const fil = fusionnerFil(
			[commentaire({ id: 'c1', creeLe: '2026-08-05T11:00:00.000Z' })],
			projeterEvenements([
				evenement({ id: 'e1', created_at: '2026-08-05T09:00:00.000Z' }),
				evenement({ id: 'e2', created_at: '2026-08-05T12:00:00.000Z' }),
			]),
		)
		expect(fil.map((ligne) => ligne.cle)).toEqual(['e:e1', 'c:c1', 'e:e2'])
	})

	// L'ordre doit être TOTAL **entre** les sources : deux `uuid` indépendants ne le rendraient pas
	// déterministe, le préfixe `c:` / `e:` si.
	it('reste déterministe quand une parole et un fait partagent l’horodatage', () => {
		const meme = '2026-08-05T10:00:00.000Z'
		const premier = fusionnerFil(
			[commentaire({ id: 'x', creeLe: meme })],
			projeterEvenements([evenement({ id: 'x', created_at: meme })]),
		)
		const second = fusionnerFil(
			[commentaire({ id: 'x', creeLe: meme })],
			projeterEvenements([evenement({ id: 'x', created_at: meme })]),
		)
		expect(premier.map((ligne) => ligne.cle)).toEqual(second.map((ligne) => ligne.cle))
		expect(premier.map((ligne) => ligne.cle)).toEqual(['c:x', 'e:x'])
	})

	it('ne masque aucun commentaire supprimé : sa place est tenue', () => {
		const fil = fusionnerFil([commentaire({ id: 'c1', supprime: true, corps: '' })], [])
		expect(fil).toHaveLength(1)
	})

	it('rend un payload non objet comme un objet vide, sans jamais échouer', () => {
		const lignes = projeterEvenements([evenement({ id: 'e1', payload: 'texte' })])
		expect(lignes[0]?.genre).toBe('evenement')
		expect(lignes[0]).toMatchObject({ payload: {} })
	})
})

describe('les comptes et les filtres (docs/DESIGN_SYSTEM.md §5.11)', () => {
	const fil = fusionnerFil(
		[commentaire({ id: 'c1' })],
		projeterEvenements([
			evenement({ id: 'e1', type: 'moved' }),
			evenement({ id: 'e2', type: 'field_changed' }),
			evenement({ id: 'e3', type: 'created' }),
			evenement({ id: 'e4', type: 'trashed' }),
			evenement({ id: 'e5', type: 'channel_changed' }),
		]),
	)

	it('compte chaque famille', () => {
		expect(compterParFamille(fil)).toEqual({
			discussion: 1,
			etapes: 1,
			champs: 1,
			organisation: 1,
			cycle: 2,
		})
	})

	// LE COMPTE SUIT LA SOURCE, PAS LE FILTRE : un compte qui suivrait le filtre vaudrait toujours
	// zéro sur une famille éteinte, et ne dirait plus rien.
	it('ne change pas quand une famille est éteinte', () => {
		const actives: ReadonlySet<Famille> = new Set(['discussion'])
		expect(compterParFamille(filtrer(fil, actives))).not.toEqual(compterParFamille(fil))
		expect(compterParFamille(fil).etapes).toBe(1)
	})

	it('filtre sans réordonner ni altérer les lignes', () => {
		const actives: ReadonlySet<Famille> = new Set(['etapes', 'champs'])
		expect(filtrer(fil, actives).map((ligne) => ligne.cle)).toEqual(['e:e1', 'e:e2'])
	})

	it('rend un fil vide quand toutes les familles sont éteintes', () => {
		expect(filtrer(fil, new Set())).toEqual([])
	})
})

describe('la résolution des libellés (§14.6)', () => {
	const etapes = new Map([
		['s1', 'Qualification'],
		['s2', 'Relance'],
	])
	const champs = new Map([['f1', 'Budget']])
	const libelles = { etapes, champs }

	const ligne = (partiel: Partial<EvenementLu> & { id: string }): LigneEvenement => {
		const projetee = projeterEvenements([evenement(partiel)])[0]
		if (projetee === undefined || projetee.genre !== 'evenement') throw new Error('projection')
		return projetee
	}

	it('nomme les deux étapes d’un déplacement', () => {
		const detail = resoudreDetail(
			ligne({ id: 'e1', type: 'moved', payload: { from_step_id: 's1', to_step_id: 's2' } }),
			libelles,
		)
		expect(detail.detail).toBe('Qualification → Relance')
	})

	// LES DEUX, OU AUCUN. Une flèche dont un seul côté porte un nom est une phrase tronquée, et le
	// §5.11 l'interdit explicitement.
	it('ne rend AUCUN détail si une seule des deux étapes est connue', () => {
		const detail = resoudreDetail(
			ligne({ id: 'e1', type: 'moved', payload: { from_step_id: 's1', to_step_id: 's9' } }),
			libelles,
		)
		expect(detail.detail).toBeNull()
	})

	it('nomme le champ d’un événement de valeur, et rien s’il est inconnu', () => {
		expect(
			resoudreDetail(ligne({ id: 'e1', type: 'field_changed', payload: { field_id: 'f1' } }), libelles)
				.detail,
		).toBe('Budget')
		expect(
			resoudreDetail(ligne({ id: 'e2', type: 'field_changed', payload: { field_id: 'f9' } }), libelles)
				.detail,
		).toBeNull()
	})

	// Les libellés ne sont JAMAIS lus dans le `payload` : une trace qui les recopierait dirait
	// demain ce qui était vrai hier.
	it('ignore un libellé qu’un payload prétendrait porter', () => {
		const detail = resoudreDetail(
			ligne({
				id: 'e1',
				type: 'moved',
				payload: { from_step_id: 's9', to_step_id: 's8', to_label: 'Signature' },
			}),
			libelles,
		)
		expect(detail.detail).toBeNull()
	})

	// LE SEUL CAS OÙ LE FIL LIT UNE VALEUR DU `payload` (§16.11.5) : une date n'est pas un libellé
	// qui pourrait changer de sens demain, c'est la valeur même du fait.
	it('rend l’échéance en date courte pour `snoozed` et pour `woken`', () => {
		expect(
			resoudreDetail(
				ligne({ id: 'e-s', type: 'snoozed', payload: { until: '2026-08-26T12:00:00Z' } }),
				libelles,
			).detail,
		).toBe('26/08/2026')
		expect(
			resoudreDetail(
				ligne({ id: 'e-w', type: 'woken', payload: { from: '2026-09-04T08:00:00Z' } }),
				libelles,
			).detail,
		).toBe('04/09/2026')
	})

	it('rend un détail ABSENT plutôt qu’« Invalid Date » quand l’échéance est illisible', () => {
		expect(
			resoudreDetail(ligne({ id: 'e-s2', type: 'snoozed', payload: { until: 'demain' } }), libelles)
				.detail,
		).toBeNull()
		expect(resoudreDetail(ligne({ id: 'e-w2', type: 'woken', payload: {} }), libelles).detail)
			.toBeNull()
	})

	it('les deux gestes du sommeil sont des faits de CYCLE DE VIE (§16.11.5)', () => {
		expect(familleDe('snoozed')).toBe('cycle')
		expect(familleDe('woken')).toBe('cycle')
	})

	it('ne rend aucun détail pour les types qui n’en ont pas', () => {
		for (const type of [
			'created',
			'channel_changed',
			'workflow_changed',
			'assigned',
			'archived',
			'unarchived',
			'trashed',
			'restored',
		]) {
			expect(resoudreDetail(ligne({ id: `e-${type}`, type }), libelles).detail).toBeNull()
		}
	})
})
