// @verifies CRM-097 (docs/BACKLOG.md) — tranche T3.c : ce qu'une suggestion change à un workflow existant
// @verifies docs/SPEC-ia.md §13.1 (identité par clés : conservé, nouveau, retiré), §13.6 (le différentiel ; les
//           affaires des étapes retirées) ; docs/DESIGN_SYSTEM.md §5.53 (le nom du workflow, le rang parmi les étapes
//           conservées, une étape retirée vide qui ne paraît pas) ; décision 620

import { describe, expect, it } from 'vitest'
import type { PropositionIa } from './brouillon-ia'
import { differentiel, etapesRetireesOccupees } from './differentiel-ia'

/** Le workflow vivant, tel que `proposition_du_workflow` le rend : une transition sans libellé propre porte « ». */
const VIVANTE: PropositionIa = {
	version: 1,
	workflow: { nom: 'Pipeline' },
	noeuds: [],
	etapes: [
		{ noeud: 'prospection', initiale: true },
		{ noeud: 'relance', initiale: false },
		{ noeud: 'negociation', initiale: false },
		{ noeud: 'perdu', initiale: false },
	],
	transitions: [
		{ de: 'prospection', vers: 'relance', libelle: '', commentaire_requis: false },
		{ de: 'relance', vers: 'negociation', libelle: 'Relancer', commentaire_requis: false },
		{ de: 'negociation', vers: 'perdu', libelle: 'Perdre', commentaire_requis: true },
	],
	champs: [
		{ cle: 'budget', libelle: 'Budget', type: 'money', choix: null, devise: 'EUR', aide: null },
		{ cle: 'source', libelle: 'Source', type: 'select', choix: ['Salon', 'Site'], devise: null, aide: null },
	],
	regles: [{ champ: 'budget', etape: 'negociation', visibilite: 'required' }],
	exigences: [{ de: 'negociation', vers: 'perdu', champ: 'source' }],
}

const copie = (): PropositionIa => structuredClone(VIVANTE) as PropositionIa

describe('differentiel', () => {
	it('la composition vivante comparée à elle-même : rien ne change', () => {
		expect(differentiel(VIVANTE, copie())).toEqual([])
	})

	it('le nom du workflow, quand la cible le change, vient en tête', () => {
		const cible = { ...copie(), workflow: { nom: 'Pipeline revu' } }
		expect(differentiel(VIVANTE, cible)[0]).toEqual({
			genre: 'modification',
			objet: { collection: 'workflow' },
			attributs: [{ code: 'nom', avant: 'Pipeline', apres: 'Pipeline revu' }],
		})
	})

	it('une étape retirée, une ajoutée : aucune étape conservée ne paraît déplacée', () => {
		const cible = copie()
		const sansRelance = { ...cible, etapes: cible.etapes.filter((e) => e.noeud !== 'relance') }
		const avecQualification = {
			...sansRelance,
			etapes: [sansRelance.etapes[0]!, { noeud: 'qualification', initiale: false }, ...sansRelance.etapes.slice(1)],
		}
		const etapes = differentiel(VIVANTE, avecQualification).filter((c) => c.objet.collection === 'etapes')
		expect(etapes).toEqual([
			{ genre: 'ajout', objet: { collection: 'etapes', cle: 'qualification' }, attributs: [] },
			{ genre: 'retrait', objet: { collection: 'etapes', cle: 'relance' }, attributs: [] },
		])
	})

	it('deux étapes conservées échangées : leur rang parmi les conservées change, et lui seul', () => {
		const cible = copie()
		const echangees = { ...cible, etapes: [cible.etapes[0]!, cible.etapes[2]!, cible.etapes[1]!, cible.etapes[3]!] }
		expect(differentiel(VIVANTE, echangees)).toEqual([
			{ genre: 'modification', objet: { collection: 'etapes', cle: 'negociation' }, attributs: [{ code: 'rang', avant: 3, apres: 2 }] },
			{ genre: 'modification', objet: { collection: 'etapes', cle: 'relance' }, attributs: [{ code: 'rang', avant: 2, apres: 3 }] },
		])
	})

	it('l’étape initiale déplacée : deux modifications de « initiale »', () => {
		const cible = copie()
		const initiale = { ...cible, etapes: cible.etapes.map((e) => ({ ...e, initiale: e.noeud === 'relance' })) }
		expect(differentiel(VIVANTE, initiale).map((c) => [c.objet, c.attributs])).toEqual([
			[{ collection: 'etapes', cle: 'prospection' }, [{ code: 'initiale', avant: true, apres: false }]],
			[{ collection: 'etapes', cle: 'relance' }, [{ code: 'initiale', avant: false, apres: true }]],
		])
	})

	it('les transitions par leur couple : libellé et motif modifiés, une ajoutée, une retirée', () => {
		const cible = copie()
		const transitions = {
			...cible,
			transitions: [
				{ de: 'prospection', vers: 'relance', libelle: 'Relancer le contact', commentaire_requis: false },
				{ de: 'negociation', vers: 'perdu', libelle: 'Perdre', commentaire_requis: false },
				{ de: 'prospection', vers: 'perdu', libelle: 'Abandonner', commentaire_requis: true },
			],
		}
		expect(differentiel(VIVANTE, transitions)).toEqual([
			{
				genre: 'modification',
				objet: { collection: 'transitions', de: 'prospection', vers: 'relance' },
				attributs: [{ code: 'libelle', avant: '', apres: 'Relancer le contact' }],
			},
			{
				genre: 'modification',
				objet: { collection: 'transitions', de: 'negociation', vers: 'perdu' },
				attributs: [{ code: 'commentaire_requis', avant: true, apres: false }],
			},
			{ genre: 'ajout', objet: { collection: 'transitions', de: 'prospection', vers: 'perdu' }, attributs: [] },
			{ genre: 'retrait', objet: { collection: 'transitions', de: 'relance', vers: 'negociation' }, attributs: [] },
		])
	})

	it('les champs par leur clé : choix et type modifiés, un champ retiré', () => {
		const cible = copie()
		const champs = {
			...cible,
			champs: [{ cle: 'source', libelle: 'Source', type: 'multiselect', choix: ['Salon', 'Site', 'Réseau'], devise: null, aide: null }],
		}
		expect(differentiel(VIVANTE, champs).filter((c) => c.objet.collection === 'champs')).toEqual([
			{
				genre: 'modification',
				objet: { collection: 'champs', cle: 'source' },
				attributs: [
					{ code: 'type', avant: 'select', apres: 'multiselect' },
					{ code: 'choix', avant: ['Salon', 'Site'], apres: ['Salon', 'Site', 'Réseau'] },
				],
			},
			{ genre: 'retrait', objet: { collection: 'champs', cle: 'budget' }, attributs: [] },
		])
	})

	it('une règle par son couple, une exigence par son triplet', () => {
		const cible = copie()
		const modifiee = {
			...cible,
			regles: [{ champ: 'budget', etape: 'negociation', visibilite: 'visible' }],
			exigences: [{ de: 'negociation', vers: 'perdu', champ: 'budget' }],
		}
		expect(differentiel(VIVANTE, modifiee)).toEqual([
			{
				genre: 'modification',
				objet: { collection: 'regles', champ: 'budget', etape: 'negociation' },
				attributs: [{ code: 'visibilite', avant: 'required', apres: 'visible' }],
			},
			{ genre: 'ajout', objet: { collection: 'exigences', de: 'negociation', vers: 'perdu', champ: 'budget' }, attributs: [] },
			{ genre: 'retrait', objet: { collection: 'exigences', de: 'negociation', vers: 'perdu', champ: 'source' }, attributs: [] },
		])
	})
})

describe('etapesRetireesOccupees', () => {
	const cible = (): PropositionIa => ({ ...copie(), etapes: copie().etapes.filter((e) => e.noeud !== 'relance' && e.noeud !== 'perdu') })

	it('seules les étapes retirées QUI PORTENT des affaires, dans l’ordre vivant ; une étape vide ne paraît pas', () => {
		expect(etapesRetireesOccupees(VIVANTE, cible(), { prospection: 11, relance: 9, perdu: 0 })).toEqual([
			{ cle: 'relance', affaires: 9, destination: null },
		])
	})

	it('la destination vient des remappages de la cible ; aucune n’est devinée', () => {
		const avecRemappage = { ...cible(), remappages: [{ de: 'relance', vers: 'negociation' }] }
		expect(etapesRetireesOccupees(VIVANTE, avecRemappage, { relance: 9, perdu: 1 })).toEqual([
			{ cle: 'relance', affaires: 9, destination: 'negociation' },
			{ cle: 'perdu', affaires: 1, destination: null },
		])
	})
})
