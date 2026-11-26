// @verifies CRM-166 (docs/BACKLOG.md) — tranche T1 : `ia/inbox/…` servi depuis `_ia-inbox` (docs/SPEC-ia.md §17.6)
// @verifies CRM-016 (docs/BACKLOG.md) — preuve unitaire du routeur edge
// @verifies docs/SPEC-edge-functions.md §4, §7.1
// @verifies CRM-163 (docs/BACKLOG.md) — la passe des pastilles servie depuis sa propre voie, que le premier segment ne peut
//           atteindre (docs/SPEC-ia.md §16.2)

import { describe, expect, it } from 'vitest'
import { repertoireDe, resolveFunctionRoute, safeRequestId } from './router.ts'

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

describe('repertoireDe (CRM-163, docs/SPEC-ia.md §16.2)', () => {
	it('le plan de l’assistant de l’inbox est servi depuis `_ia-inbox`, et ce répertoire n’est pas une fonction publique (CRM-166)', () => {
		expect(repertoireDe('ia', '/ia/inbox/plan')).toBe('_ia-inbox')
		expect(repertoireDe('ia', '/ia/etat')).toBe('ia')
		expect(repertoireDe('autre', '/autre/inbox/plan')).toBe('autre')
		expect(resolveFunctionRoute('/_ia-inbox/inbox/plan')).toEqual({ ok: false, status: 404, error: 'function_not_found' })
	})

	it('la passe des pastilles est servie depuis `_ia-pastilles`', () => {
		expect(repertoireDe('ia', '/ia/pastilles/evaluer')).toBe('_ia-pastilles')
	})

	it('toute autre route de `ia`, et toute autre fonction, depuis son propre répertoire', () => {
		expect(repertoireDe('ia', '/ia/etat')).toBe('ia')
		expect(repertoireDe('ia', '/ia/suggestions/123/revue')).toBe('ia')
		expect(repertoireDe('ia', '/ia')).toBe('ia')
		expect(repertoireDe('webhooks', '/webhooks/pastilles')).toBe('webhooks')
	})

	it('la voie n’est pas une fonction : son nom est refusé au premier segment', () => {
		expect(resolveFunctionRoute('/_ia-pastilles/pastilles/evaluer')).toEqual({ ok: false, status: 404, error: 'function_not_found' })
	})
})
