// @verifies CRM-113 (docs/BACKLOG.md) — tranche T2 : ce que le modèle apprend du produit — réutiliser le catalogue sous
//           un libellé d'étape, ne jamais déclarer un champ natif — et le catalogue envoyé avec ses probabilités
// @verifies docs/SPEC-ia.md §14.5 (la liste des informations natives, donnée statique du produit), §14.6 (les deux
//           règles ajoutées, le catalogue `- cle — libelle (nature, 30 %)`), §3 (rien d'une affaire n'est envoyé) ;
//           docs/JOURNAL.md décisions 646 et 677 ; tranche T5 : la consigne nomme les clés `label` et `probability`
//           de l'étape (décision 679)
// @verifies CRM-112 (docs/BACKLOG.md) tranche T2.d.1 — docs/SPEC-ia.md §6.1 : la règle des « exigences_communes » et la
//           liste des champs communs de l'espace envoyées au modèle (décision 825)
//
// Module pur : les messages se lisent tels qu'ils partiraient au modèle.

import { describe, expect, it } from 'vitest'
import { INFORMATIONS_NATIVES, messagesDePremiereGeneration, messagesDeRevue, type NoeudDuCatalogue } from './consignes.ts'

const CATALOGUE: NoeudDuCatalogue[] = [
	{ cle: 'prospection', libelle: 'Prospection', nature: 'open', probabilite: 10 },
	{ cle: 'perdu', libelle: 'Perdu', nature: 'lost', probabilite: 0 },
	{ cle: 'sans-proba', libelle: 'Sans probabilité', nature: 'open', probabilite: null },
]

const systeme = (catalogue = CATALOGUE) => messagesDePremiereGeneration('Un cycle de vente', catalogue)[0]?.content ?? ''

describe('les règles envoyées au modèle (docs/SPEC-ia.md §14.6)', () => {
	it('la liste des informations natives : les huit lignes du §14.5, dans l’ordre', () => {
		expect(INFORMATIONS_NATIVES).toEqual([
			'son titre et sa description',
			'son responsable',
			'son montant et sa devise',
			'sa probabilité',
			'sa prochaine action et son échéance',
			'ses contacts et son organisation',
			'ses coûts, ses recettes et son temps',
			'ses commentaires et ses e-mails',
		])
	})

	it('chaque information native est nommée au modèle, avec l’interdit de déclarer un champ pour elle', () => {
		const texte = systeme()
		for (const information of INFORMATIONS_NATIVES) expect(texte).toContain(`  - ${information} ;`)
		expect(texte).toContain('ne déclare jamais de champ pour ces informations')
		expect(texte).toContain('un champ natif ne s\'exige pas ici')
	})

	it('la consigne de réutiliser le catalogue : viser le nœud, et mettre le nom voulu dans le libellé de l’étape', () => {
		const texte = systeme()
		expect(texte).toContain('quand un nœud du catalogue joue déjà le rôle d\'une étape, vise ce nœud et écris le nom voulu dans le « label »')
		expect(texte).toContain('ne déclare un nœud que si\n  aucun nœud du catalogue ne joue ce rôle')
		expect(texte).toContain('« label » et « probability » valent null quand le nœud convient tel quel')
	})

	it('les règles valent pour une revue comme pour une première génération', () => {
		const revue = messagesDeRevue('Un cycle de vente', {}, [], 'Plus court', CATALOGUE)[0]?.content ?? ''
		expect(revue).toBe(systeme())
	})
})

describe('le catalogue envoyé, avec la probabilité par défaut de chaque nœud (docs/SPEC-ia.md §14.6)', () => {
	it('une ligne par nœud : clé, libellé, nature et probabilité ; sans probabilité, la nature seule', () => {
		const texte = systeme()
		expect(texte).toContain('- prospection — Prospection (open, 10 %)')
		expect(texte).toContain('- perdu — Perdu (lost, 0 %)')
		expect(texte).toContain('- sans-proba — Sans probabilité (open)')
	})

	it('un catalogue vide se dit tel', () => {
		expect(systeme([])).toContain('Le catalogue de nœuds de l’espace est vide.')
	})
})

describe('CRM-112 T2.d.1 — les champs communs envoyés au modèle (docs/SPEC-ia.md §6.1, décision 825)', () => {
	const CHAMPS = [{ cle: 'siret', libelle: 'SIRET', type: 'text' }]

	it('une ligne par champ commun : clé, libellé et type, à la première génération comme à la revue', () => {
		const premiere = messagesDePremiereGeneration('Un cycle', CATALOGUE, null, CHAMPS)[0]?.content ?? ''
		const revue = messagesDeRevue('Un cycle', {}, [], 'Corrige', CATALOGUE, null, CHAMPS)[0]?.content ?? ''
		for (const texte of [premiere, revue]) expect(texte).toContain('- siret — SIRET (text)')
	})

	it('la règle : exiger par la clé, ne jamais déclarer un champ commun, laisser la liste vide sinon', () => {
		const texte = systeme()
		expect(texte).toContain('« exigences_communes »')
		expect(texte).toContain('ne déclare jamais un champ commun dans « champs »')
	})

	it('sans champ commun, le modèle l’apprend et laisse la liste vide', () => {
		expect(systeme()).toContain('L’espace n’a aucun champ commun : « exigences_communes » reste vide.')
	})
})
