// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la proposition `version: 1` et son contrôle
// @verifies docs/SPEC-ia.md §2 (la sortie du modèle n'est jamais crue), §6 (clés normalisées par le produit),
//           §6.1 (le format ; « la fonction contrôle et dit, sans corriger en silence »)

import { describe, expect, it } from 'vitest'
import { ELEMENTS_MAX, controlerProposition, normaliserCle } from './proposition.ts'

/** La forme de la sortie MESURÉE de `gemma4:e2b` le 2026-10-02 (docs/SPEC-ia.md §3), clés comprises. */
const SORTIE_MESUREE = {
	workflow: { nom: 'Workflow Refonte Site Web' },
	noeuds: [
		{ cle: 'A_Prise_de_Contact', libelle: 'Prise de contact', nature: 'open', probabilite: 10 },
		{ cle: 'C_Maquette_Proposition', libelle: 'Maquette et devis', nature: 'open', probabilite: 40 },
		{ cle: 'F_Gagne', libelle: 'Gagné', nature: 'won', probabilite: 100 },
		{ cle: 'G_Perdu', libelle: 'Perdu', nature: 'lost', probabilite: 0 },
	],
	etapes: [
		{ noeud: 'A_Prise_de_Contact', initiale: true },
		{ noeud: 'C_Maquette_Proposition', initiale: false },
		{ noeud: 'F_Gagne', initiale: false },
		{ noeud: 'G_Perdu', initiale: false },
	],
	transitions: [
		{ de: 'A_Prise_de_Contact', vers: 'C_Maquette_Proposition', libelle: 'Lancer la maquette', commentaire_requis: false },
		{ de: 'C_Maquette_Proposition', vers: 'F_Gagne', libelle: 'Devis signé', commentaire_requis: false },
		{ de: 'C_Maquette_Proposition', vers: 'G_Perdu', libelle: 'Abandonner', commentaire_requis: true },
	],
	champs: [
		{ cle: 'Budget', libelle: 'Budget', type: 'money', choix: null, devise: 'eur', aide: null },
		{ cle: 'Type de site', libelle: 'Type de site', type: 'select', choix: ['Vitrine', 'E-commerce'], devise: null, aide: null },
	],
	regles: [{ champ: 'Budget', etape: 'C_Maquette_Proposition', visibilite: 'required' }],
	exigences: [{ de: 'C_Maquette_Proposition', vers: 'F_Gagne', champ: 'Budget' }],
}

type Liste = Record<string, unknown>[]
type Brute = { workflow: { nom: string }; noeuds: Liste; etapes: Liste; transitions: Liste; champs: Liste; regles: Liste; exigences: Liste }
/** Une copie modifiable de la sortie mesurée : chaque cas y ajoute ses défauts. */
const copie = () => structuredClone(SORTIE_MESUREE) as unknown as Brute
const codes = (sortie: unknown, catalogue: string[] = []) => {
	const controle = controlerProposition(sortie, catalogue)
	if (!controle.ok) throw new Error('forme refusée')
	return controle.defauts.map((d) => d.code)
}

describe('normaliserCle', () => {
	it.each([
		['D_Présentation_Négociation', 'd-presentation-negociation'],
		['  Gagné !! ', 'gagne'],
		['Type de site', 'type-de-site'],
		['__', ''],
	])('« %s » devient « %s »', (brute, attendue) => {
		expect(normaliserCle(brute)).toBe(attendue)
	})
})

describe('controlerProposition — la forme', () => {
	it.each([
		['un texte', 'Voici le workflow'],
		['un tableau', []],
		['sans workflow', { ...copie(), workflow: undefined }],
		['une liste qui n’est pas un tableau', { ...copie(), etapes: {} }],
		['un élément qui n’est pas un objet', { ...copie(), etapes: ['prospection'] }],
	])('%s : réponse invalide, la génération échoue', (_nom, sortie) => {
		expect(controlerProposition(sortie, []).ok).toBe(false)
	})

	it(`au-delà de ${ELEMENTS_MAX} éléments : réponse invalide — une dérive du modèle, pas un workflow`, () => {
		const enorme = { ...copie(), champs: Array.from({ length: ELEMENTS_MAX + 1 }, (_, i) => ({ cle: `c${i}`, libelle: 'x', type: 'text' })) }
		expect(controlerProposition(enorme, []).ok).toBe(false)
	})
})

describe('controlerProposition — le sens', () => {
	it('la sortie mesurée passe sans défaut : clés normalisées PARTOUT à la fois, références cohérentes, version posée', () => {
		const controle = controlerProposition(copie(), [])
		expect(controle.ok).toBe(true)
		if (!controle.ok) return
		expect(controle.defauts).toEqual([])
		expect(controle.proposition.version).toBe(1)
		expect(controle.proposition.etapes.map((e) => e.noeud)).toEqual(['a-prise-de-contact', 'c-maquette-proposition', 'f-gagne', 'g-perdu'])
		expect(controle.proposition.transitions[0]).toEqual({
			de: 'a-prise-de-contact', vers: 'c-maquette-proposition', libelle: 'Lancer la maquette', commentaire_requis: false,
		})
		expect(controle.proposition.champs[0]).toMatchObject({ cle: 'budget', devise: 'EUR' })
		expect(controle.proposition.exigences[0]).toEqual({ de: 'c-maquette-proposition', vers: 'f-gagne', champ: 'budget' })
	})

	it('deux étapes initiales et une transition vers une étape absente : DITES, et la proposition est conservée telle quelle', () => {
		const sortie = copie()
		sortie.etapes[1] = { noeud: 'C_Maquette_Proposition', initiale: true }
		sortie.transitions.push({ de: 'F_Gagne', vers: 'Relance', libelle: 'Relancer', commentaire_requis: false })
		const controle = controlerProposition(sortie, [])
		expect(controle.ok).toBe(true)
		if (!controle.ok) return
		expect(controle.defauts.map((d) => d.code)).toEqual(['etape_initiale', 'transition_etape_absente'])
		// Aucune correction silencieuse : les deux initiales et l'arête fautive restent, pour la revue.
		expect(controle.proposition.etapes.filter((e) => e.initiale)).toHaveLength(2)
		expect(controle.proposition.transitions).toHaveLength(4)
	})

	it('une étape peut viser un nœud du catalogue sans le redéclarer ; un nœud redéclaré ou inconnu est dit', () => {
		const sortie = copie()
		sortie.etapes.push({ noeud: 'relance', initiale: false })
		expect(codes(sortie, ['relance'])).toEqual([])
		expect(codes(sortie, [])).toEqual(['noeud_inconnu'])
		sortie.noeuds.push({ cle: 'relance', libelle: 'Relance', nature: 'open', probabilite: 20 })
		expect(codes(sortie, ['relance'])).toEqual(['noeud_deja_au_catalogue'])
	})

	it('les options exigées d’un champ, son type, et les doublons', () => {
		const sortie = copie()
		sortie.champs.push(
			{ cle: 'Canal', libelle: 'Canal', type: 'multiselect', choix: [], devise: null, aide: null },
			{ cle: 'Marge', libelle: 'Marge', type: 'money', choix: null, devise: null, aide: null },
			{ cle: 'Humeur', libelle: 'Humeur', type: 'emoji', choix: null, devise: null, aide: null },
			{ cle: 'budget', libelle: 'Budget bis', type: 'number', choix: null, devise: null, aide: null },
		)
		expect(codes(sortie)).toEqual(['choix_requis', 'devise_requise', 'type_inconnu', 'champ_en_double'])
	})

	it('règles et exigences qui visent un champ, une étape ou une transition absents', () => {
		const sortie = copie()
		sortie.regles.push({ champ: 'Fantome', etape: 'Nulle_Part', visibilite: 'parfois' })
		sortie.exigences.push({ de: 'A_Prise_de_Contact', vers: 'F_Gagne', champ: 'Fantome' })
		expect(codes(sortie)).toEqual([
			'regle_champ_absent', 'regle_etape_absente', 'visibilite_invalide',
			'exigence_transition_absente', 'exigence_champ_absent',
		])
	})

	it('une boucle, une arête doublée, une transition sans libellé, un nom vide, une clé vide', () => {
		const sortie = copie()
		sortie.workflow.nom = '   '
		sortie.transitions.push(
			{ de: 'F_Gagne', vers: 'F_Gagne', libelle: 'Rester', commentaire_requis: false },
			{ de: 'A_Prise_de_Contact', vers: 'C_Maquette_Proposition', libelle: '', commentaire_requis: false },
		)
		sortie.noeuds.push({ cle: '___', libelle: 'Rien', nature: 'open', probabilite: 5 })
		expect(codes(sortie)).toEqual([
			'cle_vide', 'nom_absent', 'transition_boucle', 'transition_en_double', 'transition_sans_libelle',
		])
	})
})
