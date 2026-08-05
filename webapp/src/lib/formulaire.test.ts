// @verifies CRM-037 (docs/BACKLOG.md) — composition du formulaire conditionnel
// @verifies docs/SPEC-form-composer.md §4.1 (composition), §4.2 (trois destinations),
//           §4.3 (« renseigné »), §4.4 (champ exigé), §3.1 (défaut « visible »), §5 (archivage)
// @verifies docs/SPEC-form-composer.md §6.6 (définition de « renseigné », côté SQL)
//
// Le jeu d'essai reprend **le seed réellement appliqué**, relu en base le 2026-08-05 : sept
// champs dont un archivé, l'étape `Prospection` et ses cinq règles pour six champs actifs. Ce
// n'est pas une décoration — c'est ce qui fait que le cas « un champ sans règle » est exercé par
// une donnée que le produit porte, et non par un cas inventé pour la preuve.

import { describe, expect, it } from 'vitest'
import {
	CAS_RENSEIGNE,
	composerFormulaire,
	estRenseigne,
	VISIBILITE_PAR_DEFAUT,
	type ChampFormulaire,
	type RegleVisibilite,
	type ValeurChamp,
} from './formulaire'

const ETAPE = { id: 'etape-prospection', label: 'Prospection' }
const AUTRE_ETAPE = 'etape-negociation'

function champ(partiel: Partial<ChampFormulaire> & Pick<ChampFormulaire, 'id' | 'key' | 'position'>): ChampFormulaire {
	return {
		label: partiel.key,
		type: 'text',
		options: {},
		help_text: null,
		archived_at: null,
		...partiel,
	}
}

/** Les six champs actifs du seed, plus le champ archivé, dans leur ordre de `position`. */
const CHAMPS: readonly ChampFormulaire[] = [
	champ({ id: 'f-budget', key: 'budget', position: 1, type: 'money', label: 'Budget estimé' }),
	champ({ id: 'f-source', key: 'source', position: 2, type: 'select', label: 'Origine du contact' }),
	champ({ id: 'f-date', key: 'date-signature-prevue', position: 3, type: 'date' }),
	champ({ id: 'f-motif', key: 'motif-perte', position: 4, type: 'textarea' }),
	champ({ id: 'f-decideur', key: 'decideur-identifie', position: 5, type: 'checkbox' }),
	champ({ id: 'f-lien', key: 'lien-proposition', position: 6, type: 'url' }),
	champ({
		id: 'f-previsionnel',
		key: 'budget-previsionnel',
		position: 7,
		type: 'number',
		archived_at: '2026-08-03T00:00:00Z',
	}),
]

/** Les cinq règles du seed à l'étape `Prospection`. `decideur-identifie` n'en a aucune. */
const REGLES: readonly RegleVisibilite[] = [
	{ field_id: 'f-budget', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
	{ field_id: 'f-date', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-motif', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-lien', step_id: ETAPE.id, visibility: 'hidden' },
	// Règle d'une **autre** étape : elle ne doit avoir aucun effet ici.
	{ field_id: 'f-decideur', step_id: AUTRE_ETAPE, visibility: 'required' },
]

const composer = (valeurs: readonly ValeurChamp[] = []) =>
	composerFormulaire({ champs: CHAMPS, regles: REGLES, valeurs, etape: ETAPE })

describe('« renseigné » donne la même lecture que app.valeur_de_champ_est_vide (§4.3, §6.6)', () => {
	it.each(CAS_RENSEIGNE)('$nom', (cas) => {
		expect(estRenseigne(cas.valeur)).toBe(cas.renseigne)
	})

	it("l'absence de ligne n'est pas renseignée, comme un null explicite", () => {
		expect(estRenseigne(undefined)).toBe(false)
	})

	it('le tableau de cas couvre les cinq façons d’être vide du §6.6', () => {
		const vides = CAS_RENSEIGNE.filter((cas) => !cas.renseigne)
		expect(vides).toHaveLength(4)
		// `undefined` n'est pas une valeur `jsonb` : il est exercé par le test ci-dessus, et ne
		// peut pas figurer dans un tableau que la preuve d'API écrit en base.
		expect(vides.map((cas) => cas.nom)).toContain('null explicite')
	})

	it('faux, zéro et « 0 » sont renseignés : une case décochée est une réponse', () => {
		expect(estRenseigne(false)).toBe(true)
		expect(estRenseigne(0)).toBe(true)
		expect(estRenseigne('0')).toBe(true)
	})
})

describe('composition du formulaire d’une étape (§4.1)', () => {
	it('part des champs, jamais des règles : un champ sans règle apparaît par le défaut « visible »', () => {
		const modele = composer()
		const cles = modele.champs.map((resolu) => resolu.champ.key)
		expect(cles).toContain('decideur-identifie')
		const decideur = modele.champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.visibilite).toBe(VISIBILITE_PAR_DEFAUT)
	})

	it('ignore les règles des autres étapes', () => {
		// `decideur-identifie` est `required` à l'étape `Négociation` : ici, il ne l'est pas.
		const decideur = composer().champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.visibilite).toBe('visible')
		expect(decideur?.manquant).toBe(false)
	})

	it('ordonne les champs par position, quel que soit l’ordre d’entrée', () => {
		const desordre = [...CHAMPS].reverse()
		const modele = composerFormulaire({ champs: desordre, regles: REGLES, valeurs: [], etape: ETAPE })
		expect(modele.champs.map((resolu) => resolu.champ.position)).toEqual([2, 5])
	})

	it('un champ « hidden » sans valeur n’apparaît nulle part', () => {
		const modele = composer()
		const partout = [...modele.champs, ...modele.autresEtapes].map((resolu) => resolu.champ.key)
		expect(partout).not.toContain('lien-proposition')
	})

	it('un champ « hidden » porteur d’une valeur va dans la section repliée (§4.2)', () => {
		// Le cas de la card `…0000c6` du seed : à `Prospection`, `motif-perte` est `hidden` et
		// porte pourtant une valeur.
		const modele = composer([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('motif-perte')
		expect(modele.autresEtapes.map((resolu) => resolu.champ.key)).toEqual(['motif-perte'])
	})

	it('un champ archivé porteur d’une valeur va dans la section repliée, jamais dans le formulaire (§5)', () => {
		const modele = composer([{ field_id: 'f-previsionnel', value: 72000 }])
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('budget-previsionnel')
		expect(modele.autresEtapes.map((resolu) => resolu.champ.key)).toContain('budget-previsionnel')
	})

	it('un champ archivé sans valeur n’apparaît nulle part', () => {
		const modele = composer()
		const partout = [...modele.champs, ...modele.autresEtapes].map((resolu) => resolu.champ.key)
		expect(partout).not.toContain('budget-previsionnel')
	})

	it('une visibilité inconnue du backend se replie sur « visible » plutôt que de masquer', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-budget', step_id: ETAPE.id, visibility: 'fantaisie' }],
			valeurs: [],
			etape: ETAPE,
		})
		expect(modele.champs.map((resolu) => resolu.champ.key)).toContain('budget')
	})
})

describe('champ exigé et manquant (§4.4)', () => {
	it('un champ « required » vide est manquant, et sa clé est listée', () => {
		const modele = composer()
		const source = modele.champs.find((resolu) => resolu.champ.key === 'source')
		expect(source?.visibilite).toBe('required')
		expect(source?.manquant).toBe(true)
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('renseigné, il cesse d’être manquant', () => {
		const modele = composer([{ field_id: 'f-source', value: 'salon' }])
		expect(modele.clesManquantes).toEqual([])
	})

	it('une valeur vidée explicitement le rend de nouveau manquant (INC-054)', () => {
		const modele = composer([{ field_id: 'f-source', value: null }])
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('une chaîne d’espaces ne renseigne pas un champ exigé', () => {
		const modele = composer([{ field_id: 'f-source', value: '   ' }])
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('un champ « visible » vide n’est jamais manquant : l’absence de règle n’exige rien', () => {
		const modele = composer()
		const decideur = modele.champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.renseigne).toBe(false)
		expect(decideur?.manquant).toBe(false)
	})

	it('les clés manquantes sortent dans l’ordre des positions', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [
				{ field_id: 'f-lien', step_id: ETAPE.id, visibility: 'required' },
				{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
			],
			valeurs: [],
			etape: ETAPE,
		})
		expect(modele.clesManquantes).toEqual(['source', 'lien-proposition'])
	})

	it('une case décochée satisfait un champ exigé : faux est une réponse', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-decideur', step_id: ETAPE.id, visibility: 'required' }],
			valeurs: [{ field_id: 'f-decideur', value: false }],
			etape: ETAPE,
		})
		expect(modele.clesManquantes).toEqual([])
	})
})
