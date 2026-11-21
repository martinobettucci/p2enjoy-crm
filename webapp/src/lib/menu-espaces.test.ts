// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.b : le menu des espaces — les non-lus par espace lus par la base, la pastille
//           quand un AUTRE espace en a, et l'adresse où mène un choix (la même page, l'inbox depuis un objet, rien sur une
//           page globale)
// @verifies docs/SPEC-espace-courant.md §9 ; docs/DESIGN_SYSTEM.md §5.113 ; docs/SPEC-mail-subsystem.md §35.4

import { describe, expect, it } from 'vitest'
import { pret } from './async'
import { adresseApresChoix, autreEspaceANonLus, lireNonLusParEspace } from './menu-espaces'
import type { ClientCrm } from './supabase'

describe('les non-lus par espace (§35.4)', () => {
	it('sont lus par `inbox_unread_by_workspace`, par identifiant', async () => {
		const appels: unknown[] = []
		const client = {
			rpc: (nom: string, args: unknown) => {
				appels.push([nom, args])
				return Promise.resolve({ data: [{ workspace_id: 'w-1', unread_count: 0 }, { workspace_id: 'w-2', unread_count: 3 }], error: null, status: 200 })
			},
		} as unknown as ClientCrm
		const lu = await lireNonLusParEspace(client)
		expect(appels).toEqual([['inbox_unread_by_workspace', {}]])
		expect(lu.statut === 'pret' && [...lu.donnees]).toEqual([['w-1', 0], ['w-2', 3]])
	})

	it('la pastille du bouton : un AUTRE espace a des non-lus ; jamais pendant la lecture', () => {
		expect(autreEspaceANonLus(pret(new Map([['w-1', 5], ['w-2', 0]])), 'w-1')).toBe(false)
		expect(autreEspaceANonLus(pret(new Map([['w-1', 0], ['w-2', 2]])), 'w-1')).toBe(true)
		expect(autreEspaceANonLus({ statut: 'chargement' }, 'w-1')).toBe(false)
	})
})

describe('où mène le choix d’un espace (§9)', () => {
	it.each([
		['/p2enjoy/inbox', '/studio-lumen/inbox'],
		['/p2enjoy/reglages/etiquettes', '/studio-lumen/reglages/etiquettes'],
		['/p2enjoy/reglages', '/studio-lumen/reglages'],
		['/p2enjoy/tracks/conseil-ia/grands-comptes/cards/c-1', '/studio-lumen/inbox'],
		['/p2enjoy/tracks/conseil-ia/couts', '/studio-lumen/inbox'],
	])('%s → %s', (depuis, vers) => {
		expect(adresseApresChoix(depuis, 'studio-lumen')).toBe(vers)
	})

	it.each(['/', '/contacts', '/contacts/organisations', '/objectifs/t-1', '/aide/reglages', '/ma-journee'])(
		'%s : page globale, l’adresse ne change pas',
		(depuis) => {
			expect(adresseApresChoix(depuis, 'studio-lumen')).toBeNull()
		},
	)
})
