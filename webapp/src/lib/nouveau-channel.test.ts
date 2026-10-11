// @verifies CRM-100 (docs/BACKLOG.md) — tranche T1 : les adresses de « Nouveau channel » et de l'aller-retour
// @verifies docs/SPEC-administration-arborescence.md §13.3 (l'ouverture par l'adresse, la vue liste conservée, la
//           racine du track hors d'une vue de track), §13.4 (l'adresse de départ, le brouillon, une valeur vide non
//           écrite), §13.5 (`creer`, `track`, le workflow créé au retour), §13.6, §13.7 (la validation du retour et
//           ses formes d'attaque)
//
// Le module est pur : chaque fonction est éprouvée par ses entrées et ses sorties, et l'aller-retour entier est
// rejoué de bout en bout — la saisie confiée au départ est exactement celle que le retour rend.

import { describe, expect, it } from 'vitest'
import {
	PARAMS_BROUILLON,
	cheminEditeurNouveauWorkflow,
	cheminOuvertureNouveauChannel,
	cheminRetour,
	estVueTrack,
	lireBrouillon,
	lireDemandeCreation,
	lireRetour,
	origineDepuisArborescence,
	origineDepuisTrack,
	sansNouveauChannel,
} from './nouveau-channel'

const ID_TRACK = '0c100000-0000-4000-8000-000000000001'
const ID_WORKFLOW = '0c100000-0000-4000-8000-0000000000aa'

/** Les paramètres d'une adresse composée, pour les comparer sans dépendre de l'ordre d'écriture. */
function parametresDe(adresse: string): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1)))
}

describe('estVueTrack — les adresses qui rendent le formulaire (§13.3)', () => {
	it.each([
		'/tracks/commercial',
		'/tracks/commercial/prospection',
		'/tracks/commercial/prospection/liste',
		'/tracks/studio-web/couts-annexes',
	])('%s est une vue de track', (chemin) => {
		expect(estVueTrack(chemin)).toBe(true)
	})

	it.each([
		'/tracks/commercial/couts',
		'/tracks/commercial/couts/0c10',
		'/tracks/commercial/prospection/cards/0c10',
		'/tracks/Commercial',
		'/tracks/',
		'/reglages/arborescence',
		'/tracks/commercial/prospection/liste/autre',
	])("%s n'en est pas une", (chemin) => {
		expect(estVueTrack(chemin)).toBe(false)
	})
})

describe('cheminOuvertureNouveauChannel — la commande de la barre d’onglets', () => {
	it('garde le chemin et les paramètres de la vue liste, et ouvre le formulaire', () => {
		const adresse = cheminOuvertureNouveauChannel('/tracks/commercial/prospection/liste', '?page=2&tri=titre', 'commercial')
		expect(adresse.startsWith('/tracks/commercial/prospection/liste?')).toBe(true)
		expect(parametresDe(adresse)).toEqual({ page: '2', tri: 'titre', 'nouveau-channel': '1' })
	})

	it('remplace un brouillon périmé plutôt que de le rouvrir', () => {
		const adresse = cheminOuvertureNouveauChannel(
			'/tracks/commercial',
			`?nouveau-channel=1&${PARAMS_BROUILLON.nom}=Ancien`,
			'commercial',
		)
		expect(parametresDe(adresse)).toEqual({ 'nouveau-channel': '1' })
	})

	it('mène à la racine du track depuis l’écran des coûts ou la fiche d’une affaire', () => {
		expect(cheminOuvertureNouveauChannel('/tracks/commercial/couts', '?annee=2026', 'commercial')).toBe(
			'/tracks/commercial?nouveau-channel=1',
		)
		expect(cheminOuvertureNouveauChannel('/tracks/commercial/prospection/cards/0c10', '', 'commercial')).toBe(
			'/tracks/commercial?nouveau-channel=1',
		)
	})
})

describe('lireBrouillon et sansNouveauChannel', () => {
	it('lit le brouillon, une clé absente valant la chaîne vide et le workflow absent `null`', () => {
		expect(lireBrouillon(new URLSearchParams('nc-nom=Partenariats&nc-workflow=' + ID_WORKFLOW))).toEqual({
			nom: 'Partenariats',
			slug: '',
			description: '',
			idWorkflow: ID_WORKFLOW,
		})
		expect(lireBrouillon(new URLSearchParams('nc-workflow='))).toEqual({
			nom: '',
			slug: '',
			description: '',
			idWorkflow: null,
		})
	})

	it('retire le formulaire et son brouillon, et rien d’autre', () => {
		const reste = sansNouveauChannel(
			new URLSearchParams('page=3&nouveau-channel=1&nc-nom=A&nc-slug=a&nc-description=d&nc-workflow=w&sommeil=visibles'),
		)
		expect(Object.fromEntries(reste)).toEqual({ page: '3', sommeil: 'visibles' })
	})
})

describe('les adresses d’origine (§13.4)', () => {
	it('depuis la vue d’un track : l’adresse courante, formulaire ouvert, brouillon compris', () => {
		const origine = origineDepuisTrack('/tracks/commercial/prospection/liste', '?page=2&nouveau-channel=1', {
			nom: 'Partenariats & co',
			slug: 'partenariats',
			description: 'Les accords « cadre »',
		})
		expect(origine.startsWith('/tracks/commercial/prospection/liste?')).toBe(true)
		expect(parametresDe(origine)).toEqual({
			page: '2',
			'nouveau-channel': '1',
			'nc-nom': 'Partenariats & co',
			'nc-slug': 'partenariats',
			'nc-description': 'Les accords « cadre »',
		})
	})

	it('une valeur vide ou blanche n’est pas écrite', () => {
		const origine = origineDepuisTrack('/tracks/commercial', '', { nom: 'X', slug: '', description: '   ' })
		expect(parametresDe(origine)).toEqual({ 'nouveau-channel': '1', 'nc-nom': 'X' })
	})

	it('depuis l’arborescence : le track nommé par son id', () => {
		const origine = origineDepuisArborescence(ID_TRACK, { nom: 'Partenariats', slug: '', description: '' })
		expect(origine.startsWith('/reglages/arborescence?')).toBe(true)
		expect(parametresDe(origine)).toEqual({ 'nouveau-channel': ID_TRACK, 'nc-nom': 'Partenariats' })
	})
})

describe('l’éditeur de workflows (§13.5)', () => {
	it('« Nouveau workflow » ouvre la création sur le track, et porte le retour encodé', () => {
		const origine = origineDepuisTrack('/tracks/commercial', '', { nom: 'A & B', slug: '', description: '' })
		const adresse = cheminEditeurNouveauWorkflow(ID_TRACK, origine)
		expect(adresse.startsWith('/reglages/workflows?')).toBe(true)
		const parametres = new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1))
		expect(lireDemandeCreation(parametres)).toEqual({ ouvrir: true, idTrack: ID_TRACK })
		expect(lireRetour(parametres.get('retour'))).toBe(origine)
	})

	it('sans `creer=1`, rien ne s’ouvre ; un track vide vaut `null`', () => {
		expect(lireDemandeCreation(new URLSearchParams('creer=0&track='))).toEqual({ ouvrir: false, idTrack: null })
	})
})

describe('lireRetour — aucune redirection ouverte (§13.7)', () => {
	it.each([
		'/tracks/commercial?nouveau-channel=1',
		'/tracks/commercial/prospection/liste?page=2&nouveau-channel=1&nc-nom=X',
		`/reglages/arborescence?nouveau-channel=${ID_TRACK}`,
	])('retient %s', (retour) => {
		expect(lireRetour(retour)).toBe(retour)
	})

	it.each([
		['absente', null],
		['adresse absolue', 'https://exemple.test/tracks/commercial?nouveau-channel=1'],
		['hôte par double barre', '//exemple.test/tracks/commercial?nouveau-channel=1'],
		['hôte par barre inverse', '/\\exemple.test/tracks/commercial?nouveau-channel=1'],
		['schéma javascript', 'javascript:alert(1)//?nouveau-channel=1'],
		['caractère de contrôle', '/tracks/commercial\t?nouveau-channel=1'],
		['chemin hors des deux écrans', '/reglages/corbeille?nouveau-channel=1'],
		['écran des coûts', '/tracks/commercial/couts?nouveau-channel=1'],
		['sans formulaire ouvert', '/tracks/commercial?page=2'],
		['formulaire vide', '/tracks/commercial?nouveau-channel='],
		['sans paramètres', '/tracks/commercial'],
	])('écarte : %s', (_cas, retour) => {
		expect(lireRetour(retour)).toBeNull()
	})
})

describe('cheminRetour — le lien « Revenir au nouveau channel »', () => {
	const retour = '/tracks/commercial?nouveau-channel=1&nc-nom=Partenariats'

	it('ajoute le workflow créé', () => {
		const adresse = cheminRetour(retour, ID_WORKFLOW)
		expect(adresse.startsWith('/tracks/commercial?')).toBe(true)
		expect(lireBrouillon(new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1)))).toEqual({
			nom: 'Partenariats',
			slug: '',
			description: '',
			idWorkflow: ID_WORKFLOW,
		})
	})

	it('sans création, ramène au formulaire tel qu’il a été quitté — un workflow forgé dans le retour est écarté', () => {
		const adresse = cheminRetour(`${retour}&nc-workflow=forge`, null)
		expect(parametresDe(adresse)).toEqual({ 'nouveau-channel': '1', 'nc-nom': 'Partenariats' })
	})

	it('l’aller-retour entier rend la saisie confiée au départ', () => {
		const saisie = { nom: 'Équipe « nord » & sud', slug: 'nord-sud', description: 'ligne 1\nligne 2' }
		const origine = origineDepuisArborescence(ID_TRACK, saisie)
		const editeur = cheminEditeurNouveauWorkflow(ID_TRACK, origine)
		const retenu = lireRetour(new URLSearchParams(editeur.slice(editeur.indexOf('?') + 1)).get('retour'))
		expect(retenu).not.toBeNull()
		const arrivee = cheminRetour(retenu ?? '', ID_WORKFLOW)
		const parametres = new URLSearchParams(arrivee.slice(arrivee.indexOf('?') + 1))
		expect(parametres.get('nouveau-channel')).toBe(ID_TRACK)
		expect(lireBrouillon(parametres)).toEqual({ ...saisie, idWorkflow: ID_WORKFLOW })
	})
})
