// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la proposition `version: 1` ; tranche T2.b : sa mise en forme
// @verifies docs/SPEC-ia.md §2 (la sortie du modèle n'est jamais crue), §6 (clés normalisées par le produit),
//           §6.1 (le format), §12.1 (la fonction ne juge plus le sens : la base le fait, décision 618)
// @verifies CRM-097 tranche T3.b — docs/SPEC-ia.md §13.1 (`remappages`, facultative), §13.5 (le schéma d'une
//           modification l'exige ; sa mise en forme) ; décision 620
//
// Les défauts — le SENS d'une proposition — sont prouvés en base, code par code, par
// `supabase/tests/0078_accepter_suggestion_ia.test.sql`. Ce fichier prouve ce qui reste à la fonction : refuser
// ce qui n'a pas la forme, normaliser les clés partout à la fois, et ne rien corriger d'autre.

import { describe, expect, it } from 'vitest'
import { ELEMENTS_MAX, mettreEnForme, normaliserCle, SCHEMA_MODIFICATION, SCHEMA_WORKFLOW } from './proposition.ts'

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
		{ cle: 'Type de site', libelle: 'Type de site', type: 'select', choix: ['Vitrine', ' ', 'E-commerce'], devise: null, aide: '  ' },
	],
	regles: [{ champ: 'Budget', etape: 'C_Maquette_Proposition', visibilite: 'required' }],
	exigences: [{ de: 'C_Maquette_Proposition', vers: 'F_Gagne', champ: 'Budget' }],
}

type Liste = Record<string, unknown>[]
type Brute = { workflow: { nom: string }; noeuds: Liste; etapes: Liste; transitions: Liste; champs: Liste; regles: Liste; exigences: Liste }
const copie = () => structuredClone(SORTIE_MESUREE) as unknown as Brute

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

describe('mettreEnForme — la forme', () => {
	it.each([
		['un texte', 'Voici le workflow'],
		['un tableau', []],
		['sans workflow', { ...copie(), workflow: undefined }],
		['une liste qui n’est pas un tableau', { ...copie(), etapes: {} }],
		['un élément qui n’est pas un objet', { ...copie(), etapes: ['prospection'] }],
	])('%s : réponse invalide, la génération échoue', (_nom, sortie) => {
		expect(mettreEnForme(sortie).ok).toBe(false)
	})

	it(`au-delà de ${ELEMENTS_MAX} éléments : réponse invalide — une dérive du modèle, pas un workflow`, () => {
		const enorme = { ...copie(), champs: Array.from({ length: ELEMENTS_MAX + 1 }, (_, i) => ({ cle: `c${i}`, libelle: 'x', type: 'text' })) }
		expect(mettreEnForme(enorme).ok).toBe(false)
	})
})

describe('mettreEnForme — les clés, et rien d’autre', () => {
	it('la sortie mesurée : clés normalisées PARTOUT à la fois, version posée, aucun défaut calculé ici', () => {
		const forme = mettreEnForme(copie())
		expect(forme.ok).toBe(true)
		if (!forme.ok) return
		expect(forme).not.toHaveProperty('defauts')
		expect(forme.proposition.version).toBe(1)
		expect(forme.proposition.etapes.map((e) => e.noeud)).toEqual(['a-prise-de-contact', 'c-maquette-proposition', 'f-gagne', 'g-perdu'])
		expect(forme.proposition.transitions[0]).toEqual({
			de: 'a-prise-de-contact', vers: 'c-maquette-proposition', libelle: 'Lancer la maquette', commentaire_requis: false,
		})
		expect(forme.proposition.regles[0]).toEqual({ champ: 'budget', etape: 'c-maquette-proposition', visibilite: 'required' })
		expect(forme.proposition.exigences[0]).toEqual({ de: 'c-maquette-proposition', vers: 'f-gagne', champ: 'budget' })
	})

	it('la forme que la base attend (docs/SPEC-ia.md §12.1) : devise en capitales, choix et aide blancs retirés, probabilité nombre ou null', () => {
		const sortie = copie()
		sortie.noeuds[0] = { ...sortie.noeuds[0], probabilite: 'dix' }
		const forme = mettreEnForme(sortie)
		if (!forme.ok) throw new Error('forme refusée')
		expect(forme.proposition.champs[0]).toMatchObject({ cle: 'budget', devise: 'EUR' })
		expect(forme.proposition.champs[1]).toMatchObject({ choix: ['Vitrine', 'E-commerce'], aide: null })
		expect(forme.proposition.noeuds[0]?.probabilite).toBeNull()
		expect(JSON.parse(JSON.stringify(forme.proposition)).noeuds[0].probabilite).toBeNull()
	})

	it('deux étapes initiales et une transition vers une étape absente : AUCUNE correction silencieuse, la base les dira', () => {
		const sortie = copie()
		sortie.etapes[1] = { noeud: 'C_Maquette_Proposition', initiale: true }
		sortie.transitions.push({ de: 'F_Gagne', vers: 'Relance', libelle: 'Relancer', commentaire_requis: false })
		const forme = mettreEnForme(sortie)
		if (!forme.ok) throw new Error('forme refusée')
		expect(forme.proposition.etapes.filter((e) => e.initiale)).toHaveLength(2)
		expect(forme.proposition.transitions).toHaveLength(4)
		expect(forme.proposition.transitions[3]).toMatchObject({ de: 'f-gagne', vers: 'relance' })
	})
})

describe('T3.b — `remappages` et le schéma d’une modification', () => {
	it('présente : gardée, ses clés normalisées comme toutes les autres', () => {
		const forme = mettreEnForme({ ...copie(), remappages: [{ de: 'Relance', vers: 'C_Maquette_Proposition' }] })
		if (!forme.ok) throw new Error('forme refusée')
		expect(forme.proposition.remappages).toEqual([{ de: 'relance', vers: 'c-maquette-proposition' }])
	})

	it('vide : gardée vide — « aucun remappage » ; absente : reste ABSENTE, une création n’en porte pas', () => {
		const vide = mettreEnForme({ ...copie(), remappages: [] })
		if (!vide.ok) throw new Error('forme refusée')
		expect(vide.proposition.remappages).toEqual([])
		const absente = mettreEnForme(copie())
		if (!absente.ok) throw new Error('forme refusée')
		expect(absente.proposition).not.toHaveProperty('remappages')
	})

	it.each([
		['un objet', { de: 'relance', vers: 'negociation' }],
		['un texte', 'relance → negociation'],
		['un élément qui n’est pas un objet', ['relance']],
		['null', null],
	])('d’une autre forme (%s) : réponse invalide', (_nom, remappages) => {
		expect(mettreEnForme({ ...copie(), remappages }).ok).toBe(false)
	})

	it('le schéma d’une modification EXIGE `remappages` et garde tout celui d’une création ; celui-ci ne la connaît pas', () => {
		expect(SCHEMA_MODIFICATION.required).toEqual([...SCHEMA_WORKFLOW.required, 'remappages'])
		expect(SCHEMA_MODIFICATION.properties.remappages.items.required).toEqual(['de', 'vers'])
		expect(SCHEMA_MODIFICATION.properties.etapes).toBe(SCHEMA_WORKFLOW.properties.etapes)
		expect(SCHEMA_WORKFLOW.properties).not.toHaveProperty('remappages')
	})
})
