// @verifies CRM-009 (docs/BACKLOG.md) — stockage limité à l'onglet et repli mémoire
// @verifies docs/SPEC-auth.md §9.2 ; docs/SPEC-webapp.md §6.2 ; CLAUDE.md §11
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §8.3 (jeton en mémoire), §8.4 (K6)

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { creerClientSupabase } = vi.hoisted(() => ({
	creerClientSupabase: vi.fn(() => ({})),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: creerClientSupabase }))

import { creerClient, creerPorteurJeton, creerStockageSession, type StockageSession } from './supabase'

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

})

describe('client Supabase sans module auth (CRM-092)', () => {
	it('présente le jeton interne tenu en mémoire, et rien d’autre', async () => {
		const porteur = creerPorteurJeton()
		creerClient({ url: 'https://api.exemple.test', cleAnonyme: 'cle-anonyme-de-test' }, porteur)

		expect(creerClientSupabase).toHaveBeenCalledWith('https://api.exemple.test', 'cle-anonyme-de-test', {
			accessToken: expect.any(Function),
		})
		const options = (creerClientSupabase.mock.calls[0] as unknown as [string, string, { accessToken: () => Promise<string | null> }])[2]
		expect(await options.accessToken()).toBeNull()
		porteur.poser('jeton.interne')
		expect(await options.accessToken()).toBe('jeton.interne')
		porteur.poser(null)
		expect(await options.accessToken()).toBeNull()
	})

	it('n’écrit rien sur l’appareil en tenant le jeton', () => {
		creerPorteurJeton().poser('jeton.interne')
		expect(globalThis.sessionStorage.length).toBe(0)
		expect(globalThis.localStorage.length).toBe(0)
	})
})
