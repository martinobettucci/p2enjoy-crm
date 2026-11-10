// @verifies CRM-139 (docs/BACKLOG.md) — « Seulement moi » : la clé `courrier` (lecture, écriture, valeur inconnue), la
//           décision « le filtre s'applique ou non » selon l'identité et l'échec de sa lecture, et la lecture de la
//           présence d'une identité PERSONNELLE
// @verifies docs/SPEC-mail-subsystem.md §27.4, §27.6 ; docs/DESIGN_SYSTEM.md §5.96 ; docs/JOURNAL.md décision 902

import { describe, expect, it } from 'vitest'
import {
	CLE_URL_COURRIER,
	ecrireModeCourrier,
	filtreApplique,
	lireModeCourrier,
	lirePresenceIdentite,
} from './seulement-moi'
import type { ClientCrm } from './supabase'

describe('la clé `courrier` de l’adresse', () => {
	it('lit `tous` seulement pour la valeur exacte, et ramène tout le reste au défaut, la case cochée', () => {
		expect(lireModeCourrier('tous')).toBe('tous')
		expect(lireModeCourrier(null)).toBe('moi')
		expect(lireModeCourrier(undefined)).toBe('moi')
		expect(lireModeCourrier('')).toBe('moi')
		expect(lireModeCourrier('TOUS')).toBe('moi')
		expect(lireModeCourrier('moi')).toBe('moi')
	})

	it('écrit `tous`, retire la clé pour le défaut, et garde les autres paramètres', () => {
		const depart = new URLSearchParams('sommeil=visibles')
		const decochee = ecrireModeCourrier(depart, 'tous')
		expect(decochee.get(CLE_URL_COURRIER)).toBe('tous')
		expect(decochee.get('sommeil')).toBe('visibles')
		const recochee = ecrireModeCourrier(decochee, 'moi')
		expect(recochee.has(CLE_URL_COURRIER)).toBe(false)
		expect(recochee.toString()).toBe('sommeil=visibles')
		// La copie : les paramètres d'origine ne sont pas touchés.
		expect(depart.toString()).toBe('sommeil=visibles')
	})
})

describe('le filtre s’applique-t-il ?', () => {
	it('attend tant que la présence d’une identité n’est pas lue', () => {
		expect(filtreApplique('moi', 'chargement')).toBeNull()
		expect(filtreApplique('tous', 'chargement')).toBeNull()
	})

	it('avec une identité personnelle, suit la case', () => {
		expect(filtreApplique('moi', 'presente')).toBe(true)
		expect(filtreApplique('tous', 'presente')).toBe(false)
	})

	it('sans identité, ou sur un échec de lecture, ne s’applique jamais : rien n’est caché', () => {
		expect(filtreApplique('moi', 'aucune')).toBe(false)
		expect(filtreApplique('moi', 'erreur')).toBe(false)
	})
})

/** Un client qui rend une réponse fixe à la lecture des identités, et retient les filtres reçus. */
function clientIdentites(reponse: () => Promise<unknown>) {
	const filtres: Array<[string, unknown]> = []
	const client = {
		from: (table: string) => {
			filtres.push(['table', table])
			return {
				select: (colonnes: string) => {
					filtres.push(['select', colonnes])
					return {
						eq: (colonne: string, valeur: unknown) => {
							filtres.push([colonne, valeur])
							return { limit: () => reponse() }
						},
					}
				},
			}
		},
	} as unknown as ClientCrm
	return { client, filtres }
}

describe('la présence d’une identité personnelle', () => {
	it('demande les identités DONT LA PERSONNE EST PROPRIÉTAIRE, pas toutes celles qu’elle lit', async () => {
		const { client, filtres } = clientIdentites(() => Promise.resolve({ data: [{ id: 'i1' }], error: null }))
		expect(await lirePresenceIdentite(client, 'moi-1')).toBe('presente')
		expect(filtres).toContainEqual(['table', 'mail_outbound_identities'])
		expect(filtres).toContainEqual(['owner_id', 'moi-1'])
	})

	it('rend `aucune` sans ligne', async () => {
		const { client } = clientIdentites(() => Promise.resolve({ data: [], error: null }))
		expect(await lirePresenceIdentite(client, 'moi-1')).toBe('aucune')
	})

	it('rend `erreur` sur un refus, une exception, ou sans client', async () => {
		const refus = clientIdentites(() => Promise.resolve({ data: null, error: { message: 'refus' } }))
		expect(await lirePresenceIdentite(refus.client, 'moi-1')).toBe('erreur')
		const panne = clientIdentites(() => Promise.reject(new Error('réseau')))
		expect(await lirePresenceIdentite(panne.client, 'moi-1')).toBe('erreur')
		expect(await lirePresenceIdentite(null, 'moi-1')).toBe('erreur')
	})
})
