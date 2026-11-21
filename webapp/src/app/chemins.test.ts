// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : l'espace en tête du chemin — la route et le lien d'une page d'un espace,
//           les pages globales inchangées, les anciennes adresses déclarées, et les slugs réservés qui couvrent chaque premier
//           segment d'une route globale (la contrainte `workspaces_slug_not_reserved` de la migration `0196`)
// @verifies docs/SPEC-espace-courant.md §8.1, §15.1, §15.3

import { describe, expect, it } from 'vitest'
import {
	ANCIENNES_ADRESSES,
	CHEMIN_ADMIN_ETIQUETTES,
	CHEMIN_CONTACTS,
	CHEMIN_INBOX,
	SLUGS_RESERVES,
	cheminAffaire,
	cheminEspace,
	enEspace,
	estPageDEspace,
} from './chemins'
import { ROUTES } from './routes'

describe('l’espace en tête du chemin (§8.1, §15.3)', () => {
	it('la route et le lien d’une page d’un espace', () => {
		expect(enEspace(CHEMIN_INBOX)).toBe('/:slugEspace/inbox')
		expect(cheminEspace('p2enjoy', CHEMIN_ADMIN_ETIQUETTES)).toBe('/p2enjoy/reglages/etiquettes')
		expect(cheminEspace('studio-lumen', cheminAffaire('conseil', 'grands-comptes', 'c-1'))).toBe(
			'/studio-lumen/tracks/conseil/grands-comptes/cards/c-1',
		)
	})

	it('seules l’inbox, les tracks et les réglages sont des pages d’un espace', () => {
		expect(['/inbox', '/tracks/a', '/reglages', '/reglages/etiquettes'].every(estPageDEspace)).toBe(true)
		expect([CHEMIN_CONTACTS, '/objectifs', '/ma-journee', '/aide/x', '/plateforme/espaces', '/'].some(estPageDEspace)).toBe(false)
		expect(estPageDEspace('/inboxes')).toBe(false)
		expect(ANCIENNES_ADRESSES).toEqual(['/inbox', '/reglages', '/reglages/*', '/tracks/*'])
	})

	it('chaque premier segment d’une route globale est un slug réservé : aucune adresse ambiguë (§15.1)', () => {
		const premiers = new Set(ROUTES.map((r) => r.chemin.split('/')[1]).filter((s): s is string => s !== undefined && s !== ''))
		for (const segment of ['contacts', 'objectifs', 'couts', 'pilotage', 'temps', 'rentabilite', 'ma-journee', 'affaires-figees', 'aide', 'plateforme', 'demarrage']) premiers.add(segment)
		for (const segment of premiers) expect(SLUGS_RESERVES, `« ${segment} » doit être réservé`).toContain(segment)
	})
})
