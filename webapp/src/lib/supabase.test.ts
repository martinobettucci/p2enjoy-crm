// @verifies CRM-009 (docs/BACKLOG.md) — session limitée à l'onglet et repli mémoire
// @verifies docs/SPEC-auth.md §9.2 ; docs/SPEC-webapp.md §6.2 ; CLAUDE.md §11

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { creerClientSupabase } = vi.hoisted(() => ({
	creerClientSupabase: vi.fn(() => ({})),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: creerClientSupabase }))

import { creerClient, creerStockageSession, type StockageSession } from './supabase'

beforeEach(() => {
	globalThis.sessionStorage.clear()
	globalThis.localStorage.clear()
	creerClientSupabase.mockClear()
})

describe('stockage de session Supabase', () => {
	it('écrit dans sessionStorage et jamais dans localStorage', () => {
		const stockage = creerStockageSession()
		stockage.setItem('session-crm', 'jeton')

		expect(globalThis.sessionStorage.getItem('session-crm')).toBe('jeton')
		expect(globalThis.localStorage.length).toBe(0)
		expect(stockage.getItem('session-crm')).toBe('jeton')

		stockage.removeItem('session-crm')
		expect(globalThis.sessionStorage.getItem('session-crm')).toBeNull()
	})

	it('se replie en mémoire si le navigateur refuse toute opération', () => {
		const verrouille: StockageSession = {
			getItem: vi.fn(() => {
				throw new DOMException('refusé', 'SecurityError')
			}),
			setItem: vi.fn(() => {
				throw new DOMException('refusé', 'SecurityError')
			}),
			removeItem: vi.fn(() => {
				throw new DOMException('refusé', 'SecurityError')
			}),
		}
		const stockage = creerStockageSession(verrouille)

		stockage.setItem('session-crm', 'jeton-memoire')
		expect(stockage.getItem('session-crm')).toBe('jeton-memoire')
		stockage.removeItem('session-crm')
		expect(stockage.getItem('session-crm')).toBeNull()
	})

	it('conserve en mémoire une valeur si le stockage devient indisponible après son écriture', () => {
		let disponible = true
		const valeurs = new Map<string, string>()
		const instable: StockageSession = {
			getItem: (cle) => {
				if (!disponible) throw new DOMException('refusé', 'SecurityError')
				return valeurs.get(cle) ?? null
			},
			setItem: (cle, valeur) => valeurs.set(cle, valeur),
			removeItem: (cle) => valeurs.delete(cle),
		}
		const stockage = creerStockageSession(instable)
		stockage.setItem('session-crm', 'jeton')
		disponible = false

		expect(stockage.getItem('session-crm')).toBe('jeton')
	})

	it('consomme le retour GoTrue dans le même stockage limité à l’onglet', () => {
		creerClient({ url: 'https://api.exemple.test', cleAnonyme: 'cle-anonyme-de-test' })

		expect(creerClientSupabase).toHaveBeenCalledWith(
			'https://api.exemple.test',
			'cle-anonyme-de-test',
			{
				auth: {
					persistSession: true,
					autoRefreshToken: true,
					detectSessionInUrl: true,
					storage: expect.objectContaining({
						getItem: expect.any(Function),
						setItem: expect.any(Function),
						removeItem: expect.any(Function),
					}),
				},
			},
		)
	})
})
