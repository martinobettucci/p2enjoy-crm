// @verifies CRM-092 (docs/BACKLOG.md) — cookie de la poignée de session
// @verifies docs/SPEC-session-sso.md §5.6 (HttpOnly, SameSite=Strict, Path, Secure sur https, sans durée)

import { describe, expect, it } from 'vitest'
import { cookieDePoignee, cookieEfface, lirePoignee, origineSecurisee } from './cookie.ts'

const POIGNEE = 'A'.repeat(43)

describe('cookieDePoignee et cookieEfface', () => {
	it('pose HttpOnly, SameSite=Strict et le chemin de l’échangeur, sans durée', () => {
		expect(cookieDePoignee(POIGNEE, false)).toBe(`p2enjoy_crm_session=${POIGNEE}; Path=/functions/v1/session; HttpOnly; SameSite=Strict`)
		expect(cookieDePoignee(POIGNEE, false)).not.toMatch(/Max-Age|Expires/)
	})

	it('ajoute Secure sur une origine https, et seulement là', () => {
		expect(cookieDePoignee(POIGNEE, true)).toMatch(/; Secure$/)
		expect(cookieDePoignee(POIGNEE, false)).not.toContain('Secure')
	})

	it('efface le cookie avec les mêmes attributs et Max-Age=0', () => {
		expect(cookieEfface(true)).toBe('p2enjoy_crm_session=; Path=/functions/v1/session; HttpOnly; SameSite=Strict; Secure; Max-Age=0')
	})
})

describe('origineSecurisee', () => {
	it.each([
		['https://crm.lelabs.tech', true],
		['http://127.0.0.1:5273', false],
		[null, false],
		['', false],
	])('%s → %s', (origine, attendu) => {
		expect(origineSecurisee(origine)).toBe(attendu)
	})
})

describe('lirePoignee', () => {
	it('lit la poignée parmi d’autres cookies', () => {
		expect(lirePoignee(`autre=1; p2enjoy_crm_session=${POIGNEE}; encore=2`)).toBe(POIGNEE)
	})

	it.each([
		['aucun en-tête', null],
		['un autre cookie seul', 'autre=1'],
		['une poignée trop courte', 'p2enjoy_crm_session=abc'],
		['une poignée hors alphabet', `p2enjoy_crm_session=${'A'.repeat(42)}=`],
		['une poignée vide', 'p2enjoy_crm_session='],
	])('rend null pour %s', (_cas, entete) => {
		expect(lirePoignee(entete)).toBeNull()
	})
})
