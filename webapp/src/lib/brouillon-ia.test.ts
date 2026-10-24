// @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.c : la correction à la main d'une suggestion
// @verifies docs/SPEC-ia.md §12.5 (ce qui se corrige dans l'aperçu ; « un retrait emporte ce qui en dépend, comme la
//           base l'emporterait » ; l'ajout d'une transition) ; docs/DESIGN_SYSTEM.md §5.52 (ce qu'un retrait
//           emporte est annoncé : les comptes viennent d'ici)
// @verifies CRM-097 tranche T3.c — docs/SPEC-ia.md §13.1 (`remappages`, facultative), §13.6 (choisir une destination
//           écrit le remappage ; « Aucune destination » le retire) ; décision 620
// @verifies CRM-113 (docs/BACKLOG.md) tranche T3 — docs/SPEC-ia.md §14.3 (l'étape porte `libelle` et `probabilite`),
//           §14.7 (le nom et la probabilité de toute étape se corrigent ; « Utiliser le nœud du catalogue » les garde,
//           ou rien quand ils sont égaux) ; docs/DESIGN_SYSTEM.md §5.52 bis (le nom effectif) ; décision 677

import { describe, expect, it } from 'vitest'
import {
	ajouterTransition,
	definirRemappage,
	designerInitiale,
	memesPropositions,
	modifierChamp,
	modifierEtape,
	modifierNoeud,
	nomEffectifEtape,
	normaliser,
	retirerChamp,
	retirerEtape,
	retirerTransition,
	utiliserNoeudDuCatalogue,
	type PropositionIa,
} from './brouillon-ia'

/** La proposition `valide` du simulateur, telle que la base la conserve (clés normalisées). */
const VALIDE: PropositionIa = {
	version: 1,
	workflow: { nom: 'Cycle d’une agence web' },
	noeuds: [
		{ cle: 'prise-de-contact', libelle: 'Prise de contact', nature: 'open', probabilite: 10 },
		{ cle: 'maquette', libelle: 'Maquette et devis', nature: 'open', probabilite: 40 },
		{ cle: 'gagne-web', libelle: 'Gagné', nature: 'won', probabilite: 100 },
		{ cle: 'perdu-web', libelle: 'Perdu', nature: 'lost', probabilite: 0 },
	],
	etapes: [
		{ noeud: 'prise-de-contact', initiale: true },
		{ noeud: 'maquette', initiale: false },
		{ noeud: 'gagne-web', initiale: false },
		{ noeud: 'perdu-web', initiale: false },
	],
	transitions: [
		{ de: 'prise-de-contact', vers: 'maquette', libelle: 'Lancer la maquette', commentaire_requis: false },
		{ de: 'maquette', vers: 'gagne-web', libelle: 'Devis signé', commentaire_requis: false },
		{ de: 'prise-de-contact', vers: 'perdu-web', libelle: 'Abandonner', commentaire_requis: true },
		{ de: 'maquette', vers: 'perdu-web', libelle: 'Abandonner', commentaire_requis: true },
	],
	champs: [
		{ cle: 'budget', libelle: 'Budget', type: 'money', choix: null, devise: 'EUR', aide: null },
		{ cle: 'type-de-site', libelle: 'Type de site', type: 'select', choix: ['Vitrine', 'E-commerce'], devise: null, aide: null },
	],
	regles: [{ champ: 'budget', etape: 'maquette', visibilite: 'required' }],
	exigences: [{ de: 'maquette', vers: 'gagne-web', champ: 'budget' }],
}

describe('les retraits emportent ce qui en dépend, et le disent', () => {
	it('retirer une étape : ses transitions entrantes et sortantes, leurs exigences, ses règles et son nœud proposé', () => {
		const { proposition, emportes } = retirerEtape(VALIDE, 'maquette')
		expect(emportes).toEqual({ transitions: 3, regles: 1, exigences: 1 })
		expect(proposition.etapes.map((e) => e.noeud)).toEqual(['prise-de-contact', 'gagne-web', 'perdu-web'])
		expect(proposition.noeuds.map((n) => n.cle)).not.toContain('maquette')
		expect(proposition.transitions).toEqual([VALIDE.transitions[2]])
		expect(proposition.regles).toEqual([])
		expect(proposition.exigences).toEqual([])
		// Rien n'est muté : la révision d'origine reste entière pour « Rétablir ».
		expect(VALIDE.etapes).toHaveLength(4)
	})

	it('retirer une étape qui vise un nœud du catalogue ne retire aucun nœud proposé', () => {
		const avecCatalogue: PropositionIa = { ...VALIDE, etapes: [...VALIDE.etapes, { noeud: 'relance', initiale: false }] }
		expect(retirerEtape(avecCatalogue, 'relance').proposition.noeuds).toHaveLength(4)
	})

	it('retirer une transition emporte ses exigences, et seulement les siennes', () => {
		expect(retirerTransition(VALIDE, 1)).toMatchObject({ emportes: { transitions: 0, regles: 0, exigences: 1 } })
		expect(retirerTransition(VALIDE, 0).emportes.exigences).toBe(0)
		expect(retirerTransition(VALIDE, 9)).toEqual({ proposition: VALIDE, emportes: { transitions: 0, regles: 0, exigences: 0 } })
	})

	it('retirer un champ emporte ses règles et ses exigences', () => {
		const { proposition, emportes } = retirerChamp(VALIDE, 0)
		expect(emportes).toEqual({ transitions: 0, regles: 1, exigences: 1 })
		expect(proposition.champs.map((c) => c.cle)).toEqual(['type-de-site'])
	})
})

describe('les corrections', () => {
	it('l’étape initiale est unique : la désigner retire la marque des autres', () => {
		expect(designerInitiale(VALIDE, 'maquette').etapes.filter((e) => e.initiale).map((e) => e.noeud)).toEqual(['maquette'])
	})

	it('« utiliser le nœud du catalogue » retire le nœud proposé et garde l’étape', () => {
		const corrigee = utiliserNoeudDuCatalogue(VALIDE, 'perdu-web')
		expect(corrigee.noeuds.map((n) => n.cle)).not.toContain('perdu-web')
		expect(corrigee.etapes.map((e) => e.noeud)).toContain('perdu-web')
	})

	it('modifier un nœud, un champ, ajouter une transition', () => {
		expect(modifierNoeud(VALIDE, 'maquette', { probabilite: 55 }).noeuds[1]?.probabilite).toBe(55)
		expect(modifierChamp(VALIDE, 1, { choix: ['Vitrine', 'E-commerce', 'Intranet'] }).champs[1]?.choix).toHaveLength(3)
		const ajoutee = ajouterTransition(VALIDE, { de: 'gagne-web', vers: 'perdu-web', libelle: 'Annuler', commentaire_requis: true })
		expect(ajoutee.transitions.at(-1)).toEqual({ de: 'gagne-web', vers: 'perdu-web', libelle: 'Annuler', commentaire_requis: true })
	})
})

describe('comparer et envoyer', () => {
	it('deux propositions égales à l’ordre des clés près sont les mêmes ; une correction les distingue', () => {
		const desordonnee = JSON.parse(JSON.stringify({ ...VALIDE, workflow: { nom: VALIDE.workflow.nom }, version: 1 })) as PropositionIa
		expect(memesPropositions(VALIDE, desordonnee)).toBe(true)
		expect(memesPropositions(VALIDE, modifierNoeud(VALIDE, 'maquette', { libelle: 'Maquette' }))).toBe(false)
	})

	it('la forme canonique ne porte que les clés du format `version: 1`', () => {
		const bruitee = { ...VALIDE, workflow: { nom: 'x', autre: 1 } } as unknown as PropositionIa
		expect(Object.keys(normaliser(bruitee).workflow)).toEqual(['nom'])
	})
})

describe('T3.c — les remappages d’une modification', () => {
	it('choisir une destination l’écrit ; en choisir une autre la REMPLACE ; « Aucune destination » la retire', () => {
		const une = definirRemappage(VALIDE, 'relance', 'maquette')
		expect(une.remappages).toEqual([{ de: 'relance', vers: 'maquette' }])
		expect(definirRemappage(une, 'relance', 'gagne-web').remappages).toEqual([{ de: 'relance', vers: 'gagne-web' }])
		expect(definirRemappage(une, 'relance', null).remappages).toEqual([])
		expect(definirRemappage(definirRemappage(une, 'signature', 'maquette'), 'relance', null).remappages).toEqual([
			{ de: 'signature', vers: 'maquette' },
		])
	})

	it('retirer une étape retire les remappages qui la visaient — une destination absente n’en est plus une', () => {
		const remappee = definirRemappage(definirRemappage(VALIDE, 'relance', 'maquette'), 'signature', 'gagne-web')
		expect(retirerEtape(remappee, 'maquette').proposition.remappages).toEqual([{ de: 'signature', vers: 'gagne-web' }])
		expect(retirerEtape(VALIDE, 'maquette').proposition).not.toHaveProperty('remappages')
	})

	it('la forme canonique garde les remappages ; absents, ils restent absents — une création n’en porte pas', () => {
		expect(normaliser(definirRemappage(VALIDE, 'relance', 'maquette')).remappages).toEqual([{ de: 'relance', vers: 'maquette' }])
		expect(normaliser(VALIDE)).not.toHaveProperty('remappages')
		expect(memesPropositions(VALIDE, definirRemappage(VALIDE, 'relance', 'maquette'))).toBe(false)
	})
})

describe('CRM-113 T3 — le nom et la probabilité d’une étape (docs/SPEC-ia.md §14.3, §14.7)', () => {
	const CATALOGUE = new Map([
		['negociation', { libelle: 'Négociation', probabilite: 50 }],
		['maquette', { libelle: 'Maquette et devis', probabilite: 40 }],
	])
	const avecCatalogue: PropositionIa = {
		...VALIDE,
		noeuds: [...VALIDE.noeuds.filter((n) => n.cle !== 'maquette'), { cle: 'negociation', libelle: 'Discussion commerciale', nature: 'open', probabilite: 60 }],
		etapes: [...VALIDE.etapes.filter((e) => e.noeud !== 'maquette'), { noeud: 'negociation', initiale: false }],
	}

	it('modifier le nom et la probabilité d’une étape ; un nom blanc vaut l’absence de surcharge', () => {
		const posee = modifierEtape(VALIDE, 'maquette', { libelle: 'Devis', probabilite: 45 })
		expect(posee.etapes[1]).toEqual({ noeud: 'maquette', initiale: false, libelle: 'Devis', probabilite: 45 })
		const videe = modifierEtape(posee, 'maquette', { libelle: '   ' })
		expect(videe.etapes[1]).toEqual({ noeud: 'maquette', initiale: false, libelle: null, probabilite: 45 })
		expect(modifierEtape(videe, 'maquette', { probabilite: null }).etapes[1]?.probabilite).toBeNull()
		expect(posee.etapes[0]).toBe(VALIDE.etapes[0])
	})

	it('le nom effectif : celui de l’étape, sinon du nœud proposé, sinon du catalogue, sinon la clé', () => {
		const nommee = modifierEtape(avecCatalogue, 'negociation', { libelle: 'Échange' })
		expect(nomEffectifEtape(nommee, 'negociation', CATALOGUE)).toBe('Échange')
		expect(nomEffectifEtape(avecCatalogue, 'negociation', CATALOGUE)).toBe('Discussion commerciale')
		const sansNoeud = utiliserNoeudDuCatalogue(avecCatalogue, 'negociation')
		expect(nomEffectifEtape(sansNoeud, 'negociation', CATALOGUE)).toBe('Négociation')
		expect(nomEffectifEtape(VALIDE, 'inconnu', CATALOGUE)).toBe('inconnu')
	})

	it('« utiliser le nœud du catalogue » garde le nom et la probabilité qui diffèrent du catalogue', () => {
		const resultat = utiliserNoeudDuCatalogue(avecCatalogue, 'negociation', CATALOGUE.get('negociation'))
		expect(resultat.noeuds.some((n) => n.cle === 'negociation')).toBe(false)
		expect(resultat.etapes.find((e) => e.noeud === 'negociation')).toEqual({
			noeud: 'negociation', initiale: false, libelle: 'Discussion commerciale', probabilite: 60,
		})
	})

	it('égaux au catalogue, ils ne surchargent rien ; un nom que l’étape porte déjà l’emporte', () => {
		const egal = modifierNoeud(avecCatalogue, 'negociation', { libelle: ' Négociation ', probabilite: 50 })
		expect(utiliserNoeudDuCatalogue(egal, 'negociation', CATALOGUE.get('negociation')).etapes.find((e) => e.noeud === 'negociation'))
			.toEqual({ noeud: 'negociation', initiale: false, libelle: null, probabilite: null })
		const dejaNommee = modifierEtape(avecCatalogue, 'negociation', { libelle: 'Échange' })
		expect(utiliserNoeudDuCatalogue(dejaNommee, 'negociation', CATALOGUE.get('negociation')).etapes.find((e) => e.noeud === 'negociation')?.libelle)
			.toBe('Échange')
	})

	it('la forme canonique porte le nom et la probabilité de chaque étape, `null` quand une révision antérieure ne les a pas', () => {
		expect(normaliser(VALIDE).etapes[0]).toEqual({ noeud: 'prise-de-contact', initiale: true, libelle: null, probabilite: null })
		expect(memesPropositions(VALIDE, normaliser(VALIDE))).toBe(true)
		expect(memesPropositions(VALIDE, modifierEtape(VALIDE, 'maquette', { libelle: 'Devis' }))).toBe(false)
	})
})
