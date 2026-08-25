// @verifies CRM-044 (docs/BACKLOG.md) — fusion du fil, familles, filtres et résolution des libellés
// @verifies CRM-062 (docs/BACKLOG.md) — tranche 3b : le vocabulaire à quatorze et le détail d'une
//           relance (docs/SPEC-relances.md §10.3.1 ; docs/INCONSISTENCY_REPORT.md INC-207)
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
	FAMILLE_PAR_TYPE,
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
	//
	// RÉVISÉE UNE TROISIÈME FOIS PAR `CRM-062` tranche 3b, ET ELLE A JOUÉ EXACTEMENT COMME ATTENDU.
	// `stalled` porte le vocabulaire de l'écran à QUATORZE (docs/SPEC-relances.md §10.3.1). Le type
	// existait EN BASE depuis la migration `0054` sans être nommé ici, et le fil le rendait
	// « Événement » (INC-207) : cette assertion est devenue rouge à la ligne près où il fallait
	// qu'elle le devienne. Sixième évolution du vocabulaire, et aucune valeur n'a jamais été
	// retirée. Les cinq familles restent cinq.
	//
	// RÉVISÉE UNE QUATRIÈME FOIS PAR `CRM-060` tranche 5, ET ELLE A JOUÉ ENCORE UNE FOIS. Les trois
	// gestes de rattachement d'un contact — `contact_linked`, `contact_unlinked`,
	// `contact_role_changed` — portent le vocabulaire de l'écran à DIX-HUIT
	// (docs/SPEC-contacts.md §19.5). Cette fois le type n'a PAS vécu en base avant d'être nommé
	// ici : la migration `0061`, la table de familles, les libellés et la présentation sont du même
	// changement, et c'est l'assertion ci-dessous qui a exigé qu'ils le soient. Septième évolution
	// du vocabulaire, aucune valeur jamais retirée, et les cinq familles restent cinq.
	it('range les dix-huit types livrés dans exactement cinq familles d’événements', () => {
		expect(TYPES_EVENEMENT).toHaveLength(18)
		const familles = new Set(TYPES_EVENEMENT.map((type) => familleDe(type)))
		expect([...familles].sort()).toEqual(['champs', 'cycle', 'discussion', 'etapes', 'organisation'])
		expect(TYPES_EVENEMENT).toContain('channel_changed')
		expect(TYPES_EVENEMENT).toContain('workflow_changed')
		expect(familleDe('channel_changed')).toBe('organisation')
		expect(familleDe('workflow_changed')).toBe('organisation')
		// LA FAMILLE DE `stalled` EST ASSÉRÉE SUR LA TABLE, ET NON SUR LA FONCTION — et cette
		// correction vient du HARNAIS, pas de la lecture.
		//
		// La première écriture assérait `familleDe('stalled') === 'cycle'` en affirmant dans son
		// commentaire que retirer la ligne de `FAMILLE_PAR_TYPE` ferait rougir. C'était FAUX, et
		// `scripts/verify-relances.sh` l'a mesuré : sa dégradation D-E retire la ligne, le repli
		// documenté rend `cycle` à son tour, et la suite restait VERTE. Une preuve qui interroge une
		// fonction dont le repli donne le même résultat ne mesure rien.
		//
		// L'assertion porte donc sur l'existence de la CLÉ dans la table, seule façon de distinguer
		// une valeur ÉCRITE d'une valeur obtenue par défaut (§10.3.1).
		expect(TYPES_EVENEMENT).toContain('stalled')
		expect(Object.hasOwn(FAMILLE_PAR_TYPE, 'stalled')).toBe(true)
		expect(FAMILLE_PAR_TYPE.stalled).toBe('cycle')
		// LES TROIS GESTES DE RATTACHEMENT SONT ASSÉRÉS SUR LA TABLE, pour le motif exact de
		// `stalled` juste au-dessus : le repli rendrait `cycle` et une assertion sur `familleDe`
		// ne distinguerait pas une valeur écrite d'une valeur obtenue par défaut. Ici le repli
		// donnerait même une famille FAUSSE — `cycle` au lieu d'`organisation` —, ce qu'aucune
		// preuve interrogeant la seule fonction ne verrait.
		for (const type of ['contact_linked', 'contact_unlinked', 'contact_role_changed'] as const) {
			expect(TYPES_EVENEMENT).toContain(type)
			expect(Object.hasOwn(FAMILLE_PAR_TYPE, type), `${type} n'est pas ÉCRIT dans la table`).toBe(
				true,
			)
			expect(FAMILLE_PAR_TYPE[type]).toBe('organisation')
		}
		// `mail_sent` EST ASSÉRÉ SUR LA TABLE, comme les trois ci-dessus : INC-220 a vécu cinq
		// unités en base sans être nommé ici, et le repli le rangeait silencieusement en `cycle`
		// alors qu'il appartient à la discussion.
		expect(TYPES_EVENEMENT).toContain('mail_sent')
		expect(Object.hasOwn(FAMILLE_PAR_TYPE, 'mail_sent')).toBe(true)
		expect(FAMILLE_PAR_TYPE.mail_sent).toBe('discussion')
		// LA TABLE COUVRE LES DIX-HUIT TYPES, sans exception : un type ajouté demain sans y être
		// rangé retomberait sur le repli, et c'est précisément l'oubli d'INC-207 qui se répéterait.
		for (const type of TYPES_EVENEMENT) {
			expect(Object.hasOwn(FAMILLE_PAR_TYPE, type), `${type} n'est rangé nulle part`).toBe(true)
		}
	})

	// RÉVISÉE ELLE AUSSI : la discussion n'était portée par aucun TYPE — seuls les commentaires y
	// tombaient. `CRM-057` y range le courrier reçu, parce qu'un message est une parole et non un
	// fait de cycle de vie (docs/SPEC-mail-subsystem.md §18.6). La famille reste unique.
	// RÉVISÉE : la discussion porte les DEUX sens du courrier depuis INC-220. `mail_sent` existait
	// en base depuis la migration `0030` et n'était nommé nulle part côté écran ; les ranger
	// différemment ferait disparaître la moitié d'une conversation quand l'utilisateur filtre.
	it('déclare cinq familles, dont la discussion que le courrier des DEUX SENS porte', () => {
		expect([...FAMILLES]).toEqual(['discussion', 'etapes', 'champs', 'organisation', 'cycle'])
		expect(TYPES_EVENEMENT.filter((type) => familleDe(type) === 'discussion')).toEqual([
			'mail_received',
			'mail_sent',
		])
	})

	// Le repli est DOCUMENTÉ : la valeur vient du backend, et un type ne garantit jamais une
	// valeur. Un événement inconnu doit rester VISIBLE — c'est une mémoire.
	//
	// LE TÉMOIN A ÉTÉ CHOISI DEUX FOIS PARMI DES TYPES QUE LE PRODUIT LIVRAIT DÉJÀ, ET C'EST
	// AINSI QU'UN DÉFAUT A SURVÉCU CINQ UNITÉS — INC-220. D'abord `mail_received`, révisé quand
	// `CRM-057` l'a nommé ; puis `mail_sent`, qui semblait « pas encore livré » alors que la
	// migration `0030` l'ÉCRIVAIT depuis `CRM-058` et que la base en portait NEUF, rendus
	// « Événement » à l'écran. La preuve s'était appropriée le manque au lieu de le dénoncer.
	//
	// LA RÈGLE DE LA DÉCISION 408 EST DONC APPLIQUÉE ICI : un témoin n'emploie jamais une valeur
	// que le produit peut livrer un jour. Celui-ci n'est pas dans `card_events_type_check` et ne
	// peut donc pas être écrit en base ; il ne cessera jamais d'être inconnu.
	it('replie un type inconnu sur le cycle de vie plutôt que de le perdre', () => {
		expect(familleDe('sonde_type_jamais_livre')).toBe('cycle')
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

	// ------------------------------------------------------------------------------------------
	// `CRM-062` tranche 3b — le détail d'une relance (docs/SPEC-relances.md §10.3.1)
	// ------------------------------------------------------------------------------------------
	// LA PHRASE EST COMPOSÉE PAR UNE CLÉ DE TRADUCTION, jamais par concaténation (§10 du design
	// system). Ces assertions portent sur le TEXTE RENDU, et non sur la clé choisie : une clé
	// exacte pointant vers une phrase fausse serait verte si l'on n'assérait que la clé.

	it('dit le retard d’une relance avec son seuil', () => {
		expect(
			resoudreDetail(
				ligne({ id: 'e1', type: 'stalled', payload: { seuil_jours: 14, retard_jours: 16 } }),
				libelles,
			).detail,
		).toBe('16 jours de retard, pour un seuil de 14 jours')
	})

	// L'ACCORD EST POSÉ, JAMAIS CONSTRUIT. « 1 jours de retard » serait faux, et c'est exactement
	// la faute que le §10 du design system nomme — une phrase ne se fabrique pas en collant un
	// nombre à un pluriel.
	it('accorde au singulier un retard d’un seul jour', () => {
		expect(
			resoudreDetail(
				ligne({ id: 'e1', type: 'stalled', payload: { seuil_jours: 7, retard_jours: 1 } }),
				libelles,
			).detail,
		).toBe('1 jour de retard, pour un seuil de 7 jours')
	})

	// LA BORNE DU §2.5 EST LARGE, DONC ZÉRO EST UNE VALEUR LÉGITIME — une affaire atteinte
	// exactement sur son seuil est figée. « 0 jours de retard » se lirait comme une erreur de
	// calcul ; la phrase change, elle ne se tait pas.
	it('dit autrement une affaire atteinte EXACTEMENT sur son seuil', () => {
		expect(
			resoudreDetail(
				ligne({ id: 'e1', type: 'stalled', payload: { seuil_jours: 5, retard_jours: 0 } }),
				libelles,
			).detail,
		).toBe('atteint son seuil de 5 jours')
	})

	// UN PAYLOAD AMPUTÉ NE REND AUCUN DÉTAIL, et surtout pas un `undefined` traversé jusqu'à
	// l'écran : la ligne retombe sur son seul libellé, comme un libellé d'étape non résolu
	// (§14.10). La valeur vient du backend, et un type ne garantit jamais une valeur.
	it('ne rend AUCUN détail sur un payload de relance incomplet ou mal typé', () => {
		for (const payload of [
			{ seuil_jours: 14 },
			{ retard_jours: 16 },
			{},
			{ seuil_jours: '14', retard_jours: '16' },
			{ seuil_jours: 14, retard_jours: Number.NaN },
			{ seuil_jours: 14, retard_jours: 2.5 },
		]) {
			expect(resoudreDetail(ligne({ id: 'e1', type: 'stalled', payload }), libelles).detail).toBeNull()
		}
	})

	// LE DÉTAIL D'UNE RELANCE NE LIT QUE SES DEUX NOMBRES. Un `payload` qui prétendrait porter un
	// libellé d'étape ne doit rien changer : c'est la règle du §14.6, déjà tenue pour `moved`
	// juste en dessous, et le §9.6 refuse explicitement d'y mettre autre chose.
	it('ignore ce qu’un payload de relance prétendrait porter en plus', () => {
		expect(
			resoudreDetail(
				ligne({
					id: 'e1',
					type: 'stalled',
					payload: { seuil_jours: 14, retard_jours: 16, step_label: 'Prospection' },
				}),
				libelles,
			).detail,
		).toBe('16 jours de retard, pour un seuil de 14 jours')
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
	// Les deux instants sont construits en heure LOCALE — INC-203 : écrits en `Z`, ils figeaient le
	// jour civil d'un hôte réglé en UTC, et la preuve changeait de verdict selon le fuseau de la
	// machine. Midi local d'un jour donné est ce jour-là partout.
	it('rend l’échéance en date courte pour `snoozed` et pour `woken`', () => {
		const midiLocal26Aout = new Date(2026, 7, 26, 12, 0, 0).toISOString()
		const midiLocal4Septembre = new Date(2026, 8, 4, 12, 0, 0).toISOString()
		expect(
			resoudreDetail(
				ligne({ id: 'e-s', type: 'snoozed', payload: { until: midiLocal26Aout } }),
				libelles,
			).detail,
		).toBe('26/08/2026')
		expect(
			resoudreDetail(
				ligne({ id: 'e-w', type: 'woken', payload: { from: midiLocal4Septembre } }),
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
