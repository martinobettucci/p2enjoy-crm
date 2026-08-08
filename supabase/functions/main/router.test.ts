// @verifies CRM-016 (docs/BACKLOG.md) — preuve unitaire du routeur edge
// @verifies docs/SPEC-edge-functions.md §4, §7.1

import { describe, expect, it } from 'vitest'
import { resolveFunctionRoute, safeRequestId } from './router.ts'

describe('resolveFunctionRoute', () => {
	it('résout une fonction et conserve la possibilité d’un sous-chemin', () => {
		expect(resolveFunctionRoute('/example')).toEqual({ ok: true, functionName: 'example' })
		expect(resolveFunctionRoute('/example/sous-chemin')).toEqual({
			ok: true,
			functionName: 'example',
		})
	})

	it('distingue le nom absent du nom interdit', () => {
		expect(resolveFunctionRoute('/')).toEqual({
			ok: false,
			status: 400,
			error: 'missing_function',
		})
		for (const pathname of ['/Main', '/main', '/../secret', `/${'a'.repeat(64)}`]) {
			expect(resolveFunctionRoute(pathname), pathname).toEqual({
				ok: false,
				status: 404,
				error: 'function_not_found',
			})
		}
	})
})

describe('safeRequestId', () => {
	it('reprend seulement un identifiant court et sans caractère de contrôle', () => {
		expect(safeRequestId('client:123_abc.def-4', 'generated')).toBe('client:123_abc.def-4')
		expect(safeRequestId('ligne\nforgee', 'generated')).toBe('generated')
		expect(safeRequestId('a'.repeat(129), 'generated')).toBe('generated')
		expect(safeRequestId(null, 'generated')).toBe('generated')
	})
})
