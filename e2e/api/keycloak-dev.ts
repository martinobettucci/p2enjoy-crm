// @spec CRM-092 (docs/BACKLOG.md) — administration du Keycloak de DÉVELOPPEMENT par les preuves
// @spec docs/SPEC-session-sso.md §10 (« l'API d'administration du Keycloak de développement sert au
//       seul harnais »), §13 (comptes jetables, rôle retiré, rotation de clés, session LeLabs fermée)
// @spec docs/SSO.md (« N'appelez pas l'API d'administration de Keycloak depuis une application
//       intégrée ») — le PRODUIT ne l'appelle jamais ; ce module n'est importé que par des preuves
//
// Chaque geste de ce module a son inverse, et les preuves qui l'emploient le rendent dans un
// `finally` : le realm est une donnée de démonstration, et une preuve le laisse comme elle l'a trouvé.

import { expect } from '@playwright/test'
import { lireEnv } from '../env'
import { DOMAINE, EMETTEUR } from './sso'
import { MOT_DE_PASSE_SEED } from './jetons'

const BASE = EMETTEUR.replace(/\/realms\/lelabs$/, '')
const REALM = `${BASE}/admin/realms/lelabs`

async function jetonAdministration(): Promise<string> {
	const reponse = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: 'admin-cli',
			username: 'admin',
			password: lireEnv('SSO_DEV_ADMIN_PASSWORD'),
			grant_type: 'password',
		}),
	})
	expect(reponse.status, 'jeton d’administration du Keycloak de développement').toBe(200)
	return ((await reponse.json()) as { access_token: string }).access_token
}

async function admin(chemin: string, init: RequestInit = {}): Promise<Response> {
	const jeton = await jetonAdministration()
	return fetch(`${REALM}${chemin}`, {
		...init,
		headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
	})
}

export async function idUtilisateur(adresse: string): Promise<string> {
	const reponse = await admin(`/users?exact=true&email=${encodeURIComponent(adresse)}`)
	const id = ((await reponse.json()) as Array<{ id: string }>)[0]?.id
	if (!id) throw new Error(`compte ${adresse} absent du realm de développement`)
	return id
}

/** Crée un compte jetable, adresse vérifiée, rôles par défaut et `verified` ; rend son `sub`. */
export async function creerCompteJetable(prefixe: string, prenom: string, nom: string): Promise<{ adresse: string; sub: string }> {
	const adresse = `${prefixe}-${Math.random().toString(36).slice(2, 10)}@${DOMAINE}`
	const creation = await admin('/users', {
		method: 'POST',
		body: JSON.stringify({
			username: adresse,
			email: adresse,
			emailVerified: true,
			enabled: true,
			firstName: prenom,
			lastName: nom,
			credentials: [{ type: 'password', value: MOT_DE_PASSE_SEED, temporary: false }],
		}),
	})
	expect(creation.status, `création du compte jetable ${adresse}`).toBe(201)
	const sub = creation.headers.get('location')?.split('/').pop() ?? ''
	await attribuerRoles(sub, ['default-roles-lelabs', 'verified'])
	return { adresse, sub }
}

export async function supprimerCompte(sub: string): Promise<void> {
	await admin(`/users/${sub}`, { method: 'DELETE' })
}

async function roles(noms: readonly string[]): Promise<unknown[]> {
	return Promise.all(noms.map(async (nom) => (await admin(`/roles/${nom}`)).json()))
}

export async function attribuerRoles(sub: string, noms: readonly string[]): Promise<void> {
	const reponse = await admin(`/users/${sub}/role-mappings/realm`, { method: 'POST', body: JSON.stringify(await roles(noms)) })
	expect(reponse.status, `rôles ${noms.join(', ')} attribués`).toBe(204)
}

export async function retirerRoles(sub: string, noms: readonly string[]): Promise<void> {
	const reponse = await admin(`/users/${sub}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify(await roles(noms)) })
	expect(reponse.status, `rôles ${noms.join(', ')} retirés`).toBe(204)
}

/**
 * Ferme toutes les sessions LeLabs d'un compte, comme le ferait la personne depuis son espace de compte
 * ou un administrateur du realm : ses jetons de rafraîchissement cessent de valoir (K16).
 */
export async function fermerSessionsLeLabs(sub: string): Promise<void> {
	expect((await admin(`/users/${sub}/logout`, { method: 'POST' })).status, 'sessions LeLabs fermées').toBe(204)
}

/** Le realm exige-t-il la vérification d'adresse ? Levée le temps d'émettre un jeton `email_verified=false`. */
export async function exigerVerificationAdresse(exiger: boolean): Promise<void> {
	expect((await admin('', { method: 'PUT', body: JSON.stringify({ verifyEmail: exiger }) })).status).toBe(204)
}

/**
 * Une tentative de connexion d'une adresse non prouvée, realm exigeant la vérification, pose sur le
 * compte l'action requise `VERIFY_EMAIL`, qui persiste (décision 583) : la preuve l'efface.
 */
export async function effacerActionsRequises(sub: string): Promise<void> {
	expect((await admin(`/users/${sub}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) })).status).toBe(204)
}

type Composant = { id: string; name: string; providerId: string; parentId: string; config: Record<string, string[]> }

/** Fournisseurs de clés RS256 du realm. */
async function fournisseursRs256(): Promise<Composant[]> {
	const reponse = await admin('/components?type=org.keycloak.keys.KeyProvider')
	const tous = (await reponse.json()) as Composant[]
	return tous.filter((c) => c.providerId === 'rsa-generated')
}

/**
 * Rotation de clés : ajoute un fournisseur RS256 prioritaire. Rend de quoi désactiver l'ancien puis
 * tout remettre en l'état.
 */
export async function ajouterCleRs256Prioritaire(): Promise<{
	desactiverAnciennes: () => Promise<void>
	restaurer: () => Promise<void>
}> {
	const anciennes = await fournisseursRs256()
	expect(anciennes.length, 'le realm porte au moins une clé RS256').toBeGreaterThan(0)
	const parentId = anciennes[0]?.parentId ?? ''
	const nom = `rotation-preuve-${Math.random().toString(36).slice(2, 8)}`
	const creation = await admin('/components', {
		method: 'POST',
		body: JSON.stringify({
			name: nom,
			providerId: 'rsa-generated',
			providerType: 'org.keycloak.keys.KeyProvider',
			parentId,
			config: { priority: ['1000'], enabled: ['true'], active: ['true'], algorithm: ['RS256'], keySize: ['2048'] },
		}),
	})
	expect(creation.status, 'fournisseur de clé prioritaire créé').toBe(201)
	const idNouveau = creation.headers.get('location')?.split('/').pop() ?? ''

	const regler = async (c: Composant, active: boolean) => {
		const reponse = await admin(`/components/${c.id}`, {
			method: 'PUT',
			body: JSON.stringify({ ...c, config: { ...c.config, enabled: [String(active)], active: [String(active)] } }),
		})
		expect(reponse.status, `clé ${c.name} ${active ? 'réactivée' : 'désactivée'}`).toBe(204)
	}
	return {
		desactiverAnciennes: async () => {
			for (const c of anciennes) await regler(c, false)
		},
		restaurer: async () => {
			for (const c of anciennes) await regler(c, true)
			await admin(`/components/${idNouveau}`, { method: 'DELETE' })
		},
	}
}
