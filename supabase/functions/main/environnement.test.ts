// @verifies CRM-092 (docs/BACKLOG.md) — la clé de signature n'atteint que l'échangeur de session
// @verifies docs/SPEC-session-sso.md §5.5 (environnement par fonction) ; docs/SPEC-edge-functions.md §2
// @verifies docs/JOURNAL.md décision 584

import { describe, expect, it } from 'vitest'
import { ENVIRONNEMENT_COMMUN, ENVIRONNEMENT_PROPRE, environnementDe } from './environnement.ts'

const CONTENEUR: Record<string, string> = {
	SUPABASE_URL: 'http://kong:8000',
	SUPABASE_ANON_KEY: 'cle-anonyme',
	SUPABASE_SERVICE_ROLE_KEY: 'cle-de-service',
	JWT_SECRET: 'secret-de-signature',
	SSO_OIDC_ISSUER: 'http://sso.localhost:18480/realms/lelabs',
	SSO_OIDC_CLIENT_ID: 'lelabs-crm',
	POSTGRES_PASSWORD: 'jamais-transmis',
}
const lire = (nom: string) => CONTENEUR[nom]
const noms = (valeurs: [string, string][]) => valeurs.map(([nom]) => nom).sort()

describe('environnementDe', () => {
	it('remet à `session` le commun, la clé de signature et la configuration SSO', () => {
		expect(noms(environnementDe('session', lire))).toEqual(
			['JWT_SECRET', 'SSO_OIDC_CLIENT_ID', 'SSO_OIDC_ISSUER', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'],
		)
	})

	it('ne remet JAMAIS la clé de signature à une autre fonction, présente ou future', () => {
		for (const fonction of ['example', 'une-fonction-future', 'toString', '__proto__', 'constructor']) {
			const recu = noms(environnementDe(fonction, lire))
			expect(recu, fonction).toEqual([...ENVIRONNEMENT_COMMUN].sort())
			expect(recu, fonction).not.toContain('JWT_SECRET')
		}
	})

	it('ne remet aucune variable qui n’est pas nommée, même présente dans le conteneur', () => {
		expect(noms(environnementDe('session', lire))).not.toContain('POSTGRES_PASSWORD')
	})

	it('omet une variable absente plutôt que de transmettre une valeur vide', () => {
		expect(environnementDe('session', (nom) => (nom === 'JWT_SECRET' ? undefined : CONTENEUR[nom])).map(([n]) => n))
			.not.toContain('JWT_SECRET')
	})

	it('seule `session` a un environnement propre', () => {
		expect(Object.keys(ENVIRONNEMENT_PROPRE)).toEqual(['session'])
	})
})
