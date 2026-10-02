// @verifies CRM-092 (docs/BACKLOG.md) — la clé de signature n'atteint que l'échangeur de session
// @verifies docs/SPEC-session-sso.md §5.5 (environnement par fonction) ; docs/SPEC-edge-functions.md §2
// @verifies docs/JOURNAL.md décisions 584 et 586 (le secret du client confidentiel)
// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la clé du serveur LLM n'atteint que `ia`, et sa borne
//           de 150 s ne s'étend à aucune autre fonction (docs/SPEC-ia.md §11.1, §11.6)

import { describe, expect, it } from 'vitest'
import { DELAI_COMMUN_MS, ENVIRONNEMENT_COMMUN, ENVIRONNEMENT_PROPRE, delaiDe, environnementDe } from './environnement.ts'

const CONTENEUR: Record<string, string> = {
	SUPABASE_URL: 'http://kong:8000',
	SUPABASE_ANON_KEY: 'cle-anonyme',
	SUPABASE_SERVICE_ROLE_KEY: 'cle-de-service',
	JWT_SECRET: 'secret-de-signature',
	SSO_OIDC_ISSUER: 'http://sso.localhost:18480/realms/lelabs',
	SSO_OIDC_CLIENT_ID: 'lelabs-crm-serveur',
	OIDC_CLIENT_SECRET: 'secret-du-client',
	POSTGRES_PASSWORD: 'jamais-transmis',
	OLLAMA_HOST: 'https://llm.example.test:21434',
	OLLAMA_API_KEY: 'sk-ollama-jamais-ailleurs',
	OLLAMA_MODEL: 'gemma4:e2b',
	OLLAMA_CONTEXT_LENGTH: '36864',
	IA_SIMULATEUR_HOST: 'http://ollama-simule:11434',
}
const lire = (nom: string) => CONTENEUR[nom]
const noms = (valeurs: [string, string][]) => valeurs.map(([nom]) => nom).sort()

describe('environnementDe', () => {
	it('remet à `session` le commun, la clé de signature, la configuration SSO et le secret du client', () => {
		expect(noms(environnementDe('session', lire))).toEqual(
			['JWT_SECRET', 'OIDC_CLIENT_SECRET', 'SSO_OIDC_CLIENT_ID', 'SSO_OIDC_ISSUER', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'],
		)
	})

	it('ne remet JAMAIS la clé de signature à une autre fonction, présente ou future', () => {
		for (const fonction of ['example', 'une-fonction-future', 'toString', '__proto__', 'constructor']) {
			const recu = noms(environnementDe(fonction, lire))
			expect(recu, fonction).toEqual([...ENVIRONNEMENT_COMMUN].sort())
			expect(recu, fonction).not.toContain('JWT_SECRET')
			expect(recu, fonction).not.toContain('OIDC_CLIENT_SECRET')
		}
	})

	it('ne remet aucune variable qui n’est pas nommée, même présente dans le conteneur', () => {
		expect(noms(environnementDe('session', lire))).not.toContain('POSTGRES_PASSWORD')
	})

	it('omet une variable absente plutôt que de transmettre une valeur vide', () => {
		expect(environnementDe('session', (nom) => (nom === 'JWT_SECRET' ? undefined : CONTENEUR[nom])).map(([n]) => n))
			.not.toContain('JWT_SECRET')
	})

	// RÉVISÉ PAR `CRM-097` T1, non relâché : la liste reste NOMMÉE. `ia` y entre pour la clé du serveur
	// LLM (docs/SPEC-ia.md §11.6) ; toute autre entrée fait rougir ce test et doit se justifier.
	it('seules `session` et `ia` ont un environnement propre', () => {
		expect(Object.keys(ENVIRONNEMENT_PROPRE).sort()).toEqual(['ia', 'session'])
	})
})

describe('la fonction `ia` (CRM-097)', () => {
	it('reçoit le commun, les quatre variables OLLAMA_* et le simulateur — et rien de session', () => {
		expect(noms(environnementDe('ia', lire))).toEqual(
			['IA_SIMULATEUR_HOST', 'OLLAMA_API_KEY', 'OLLAMA_CONTEXT_LENGTH', 'OLLAMA_HOST', 'OLLAMA_MODEL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'],
		)
		expect(noms(environnementDe('ia', lire))).not.toContain('JWT_SECRET')
	})

	it('la clé du serveur LLM n’atteint aucune autre fonction', () => {
		for (const fonction of ['session', 'example', 'une-fonction-future', '__proto__']) {
			expect(noms(environnementDe(fonction, lire)), fonction).not.toContain('OLLAMA_API_KEY')
		}
	})

	it('seule `ia` a une borne de 150 s ; toute autre garde la borne commune', () => {
		expect(delaiDe('ia')).toBe(150_000)
		for (const fonction of ['session', 'example', 'toString', '__proto__', 'constructor']) {
			expect(delaiDe(fonction), fonction).toBe(DELAI_COMMUN_MS)
		}
	})
})
