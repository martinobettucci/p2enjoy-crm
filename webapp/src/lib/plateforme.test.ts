// @verifies CRM-101 (docs/BACKLOG.md) — tranche T3 : les appels de la plateforme, leurs refus, et la logique de l'écran
// @verifies docs/SPEC-plateforme.md §6 (fonctions, dictionnaire des refus §6.1), §7 (écran) ; docs/DESIGN_SYSTEM.md §5.56
//           (dictionnaire fermé, confirmation par l'identifiant court, attente en suspens, journal paginé)

import { describe, expect, it } from 'vitest'
import { CLES_APPARTENANCES, compter, detailJournal, libelleActeur, libelleGeste, texteRefus } from '../app/presentation-plateforme'
import {
	PAGE_JOURNAL,
	attenteEnSuspens,
	classerRefus,
	confirmationSuppressionValide,
	creerEspace,
	curseurSuivant,
	lireEspaces,
	lireEstSuperadmin,
	rechercheEmissible,
	roleConnu,
	type EntreeJournal,
} from './plateforme'
import type { ClientCrm } from './supabase'

type Appel = { readonly nom: string; readonly args: Record<string, unknown> }

function client(reponse: (nom: string) => unknown, appels: Appel[] = []): ClientCrm {
	return {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appels.push({ nom, args })
			return Promise.resolve(reponse(nom))
		},
	} as unknown as ClientCrm
}

const entree = (geste: EntreeJournal['geste'], cible: Record<string, unknown>, acteur: string | null = 'Sabine Plateforme'): EntreeJournal => ({
	id: 1,
	acteur,
	geste,
	cible,
	creeLe: '2026-10-20T10:00:00Z',
})

describe('classerRefus', () => {
	it('reconnaît chaque code du dictionnaire par le message exact que la fonction lève', () => {
		expect(classerRefus(403, 'reserve_aux_superadministrateurs')).toBe('reserve_aux_superadministrateurs')
		expect(classerRefus(409, 'identifiant_pris')).toBe('identifiant_pris')
		expect(classerRefus(400, 'last_workspace_admin')).toBe('last_workspace_admin')
		expect(classerRefus(400, 'dernier_superadministrateur')).toBe('dernier_superadministrateur')
	})

	it('ne laisse jamais passer un message inconnu, et distingue la panne de transport', () => {
		expect(classerRefus(400, 'duplicate key value violates unique constraint "workspaces_slug_key"')).toBe('unknown')
		expect(classerRefus(undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefus(0, '')).toBe('network')
	})
})

describe('logique de l’écran', () => {
	it('n’ouvre la suppression qu’à la saisie EXACTE de l’identifiant court', () => {
		expect(confirmationSuppressionValide('atelier', 'atelier')).toBe(true)
		expect(confirmationSuppressionValide(' atelier', 'atelier')).toBe(false)
		expect(confirmationSuppressionValide('Atelier', 'atelier')).toBe(false)
		expect(confirmationSuppressionValide('', '')).toBe(false)
	})

	it('met en suspens une attente non administratrice dans un espace sans administrateur, et seulement elle', () => {
		const attente = { email: 'a@b.test', role: 'viewer' as const, invitePar: null, depuis: '' }
		expect(attenteEnSuspens(attente, 0)).toBe(true)
		expect(attenteEnSuspens({ ...attente, role: 'admin' }, 0)).toBe(false)
		expect(attenteEnSuspens(attente, 1)).toBe(false)
	})

	it('n’émet une recherche de personne qu’à partir de deux caractères', () => {
		expect(rechercheEmissible('C')).toBe(false)
		expect(rechercheEmissible('  C ')).toBe(false)
		expect(rechercheEmissible('Ca')).toBe(true)
	})

	it('confronte un rôle lu à la liste, jamais une conversion', () => {
		expect(roleConnu('admin')).toBe('admin')
		expect(roleConnu('owner')).toBeNull()
		expect(roleConnu(null)).toBeNull()
	})

	it('donne le curseur de la page suivante quand la page est pleine, et aucun sinon', () => {
		const pleine = Array.from({ length: PAGE_JOURNAL }, (_, i) => ({ ...entree('espace_cree', {}), id: 100 - i }))
		expect(curseurSuivant(pleine)).toBe(100 - PAGE_JOURNAL + 1)
		expect(curseurSuivant(pleine.slice(1))).toBeNull()
	})
})

describe('appels', () => {
	it('lit les espaces et rend un domaine absent comme `null`, jamais une chaîne vide', async () => {
		const etat = await lireEspaces(
			client(() => ({
				data: [{ id: 'w1', nom: 'Atelier', slug: 'atelier', domaine_entrant: null, membres: 0, administrateurs: 0, attentes: 1 }],
				error: null,
				status: 200,
			})),
		)
		expect(etat).toEqual({
			statut: 'pret',
			donnees: [{ id: 'w1', nom: 'Atelier', slug: 'atelier', domaineEntrant: null, membres: 0, administrateurs: 0, attentes: 1 }],
		})
	})

	it('envoie `null` pour un domaine laissé blanc, et rend le refus par son code', async () => {
		const appels: Appel[] = []
		const issue = await creerEspace(
			client(() => ({ data: null, error: { message: 'identifiant_pris' }, status: 409 }), appels),
			'Atelier',
			'atelier',
			'   ',
		)
		expect(appels).toEqual([{ nom: 'plateforme_creer_espace', args: { p_nom: 'Atelier', p_slug: 'atelier', p_domaine_entrant: null } }])
		expect(issue).toEqual({ statut: 'refus', refus: 'identifiant_pris' })
	})

	it('classe une exception de transport comme une panne réseau', async () => {
		const enPanne = { rpc: () => Promise.reject(new Error('Failed to fetch')) } as unknown as ClientCrm
		expect(await creerEspace(enPanne, 'A', 'ab', '')).toEqual({ statut: 'refus', refus: 'network' })
	})

	it('ne tient le drapeau pour vrai que si la base rend exactement `true`', async () => {
		expect(await lireEstSuperadmin(client(() => ({ data: true, error: null, status: 200 })))).toEqual({ statut: 'pret', donnees: true })
		expect(await lireEstSuperadmin(client(() => ({ data: 'true', error: null, status: 200 })))).toEqual({ statut: 'pret', donnees: false })
	})
})

describe('présentation', () => {
	it('traduit chaque refus, et un code inconnu par le texte générique', () => {
		expect(texteRefus('dernier_superadministrateur')).toContain('au moins un superadministrateur')
		expect(texteRefus('unknown')).toBe(texteRefus('unknown'))
		expect(texteRefus('unknown')).not.toContain('unknown')
	})

	it('compose le détail par une clé par geste, sans jamais rendre `undefined`', () => {
		expect(detailJournal(entree('membre_pose', { nom: 'Driss Lemoine', espace: 'Atelier', avant: null, apres: 'admin' }))).toBe(
			'Driss Lemoine dans «\u00a0Atelier\u00a0»\u00a0: Administrateur',
		)
		expect(detailJournal(entree('membre_pose', { nom: 'Driss Lemoine', espace: 'Atelier', avant: 'viewer', apres: 'admin' }))).toBe(
			'Driss Lemoine dans «\u00a0Atelier\u00a0»\u00a0: Lecteur → Administrateur',
		)
		expect(detailJournal(entree('espace_modifie', { avant: { nom: 'A' }, apres: { nom: 'B' } }))).toBe('A → B')
		expect(detailJournal(entree('membre_retire', {}))).not.toContain('undefined')
		expect(detailJournal(entree(null, { nom: 'x' }))).toBe('')
	})

	it('accorde un compte par clé, jamais par un gabarit à « (s) » (§10) — défaut trouvé sur la capture', () => {
		expect([0, 1, 4].map((n) => compter(n, CLES_APPARTENANCES))).toEqual(['aucune appartenance', 'une appartenance', '4 appartenances'])
	})

	it('nomme l’acteur absent : « Amorçage » pour l’amorçage, « Compte supprimé » sinon', () => {
		expect(libelleActeur(entree('superadmin_amorce', {}, null))).toBe('Amorçage')
		expect(libelleActeur(entree('espace_cree', {}, null))).toBe('Compte supprimé')
		expect(libelleGeste(null)).toBe('')
	})
})
