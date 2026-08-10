// @verifies CRM-007 (docs/BACKLOG.md) — lecture des espaces de travail par la coquille
// @verifies docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
// @verifies docs/SPEC-permissions-rls.md (le refus par défaut rend 200 et zéro ligne)
//
// Le client est remplacé par un double **fidèle au contrat de PostgREST** : `data`, `error` et
// `status`. Le contrat réel, lui, est éprouvé hors interface par `scripts/verify-webapp.sh`,
// qui interroge la véritable API avec la clé anonyme puis avec le jeton d'un compte seedé.

import { describe, expect, it, vi } from 'vitest'
import { lireWorkspaces, type Workspace } from './workspaces'
import type { ClientCrm } from './supabase'

type ReponsePostgrest = {
	data: Workspace[] | null
	error: { message: string } | null
	status: number
}

function clientFactice(reponse: ReponsePostgrest | (() => Promise<never>)): ClientCrm {
	const order = typeof reponse === 'function' ? reponse : () => Promise.resolve(reponse)
	return {
		from: () => ({ select: () => ({ order }) }),
	} as unknown as ClientCrm
}

const UN_WORKSPACE: Workspace = { id: 'w-1', name: 'Atelier', slug: 'atelier' }

describe('lireWorkspaces', () => {
	it('rend l’état prêt avec les lignes consenties par le backend', async () => {
		const etat = await lireWorkspaces(clientFactice({ data: [UN_WORKSPACE], error: null, status: 200 }))
		expect(etat).toEqual({ statut: 'pret', donnees: [UN_WORKSPACE] })
	})

	// C'est le comportement réel sous clé anonyme : la RLS en refus par défaut rend 200 et [].
	// L'interface doit y voir un état vide, jamais une erreur.
	it('rend l’état prêt et vide quand la RLS ne consent aucune ligne', async () => {
		const etat = await lireWorkspaces(clientFactice({ data: [], error: null, status: 200 }))
		expect(etat).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe un 403 en refus', async () => {
		const etat = await lireWorkspaces(
			clientFactice({ data: null, error: { message: 'permission denied' }, status: 403 }),
		)
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('forbidden')
	})

	it('classe une réponse sans code en panne de transport', async () => {
		const etat = await lireWorkspaces(
			clientFactice({ data: null, error: { message: 'Failed to fetch' }, status: 0 }),
		)
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('network')
	})

	// Une panne de transport ne doit pas remonter en exception non traitée jusqu'à React :
	// elle serait alors invisible pour l'utilisateur et casserait le rendu.
	it('ne laisse pas échapper une exception du transport', async () => {
		const etat = await lireWorkspaces(
			clientFactice(() => Promise.reject(new Error('Network request failed'))),
		)
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('network')
		expect(etat.statut === 'erreur' && etat.erreur.detail).toBe('Network request failed')
	})

	it('demande exactement les colonnes affichées, et les trie', async () => {
		const order = vi.fn(() => Promise.resolve({ data: [], error: null, status: 200 }))
		const select = vi.fn(() => ({ order }))
		const from = vi.fn(() => ({ select }))
		await lireWorkspaces({ from } as unknown as ClientCrm)
		expect(from).toHaveBeenCalledWith('workspaces')
		expect(select).toHaveBeenCalledWith('id, name, slug')
		expect(order).toHaveBeenCalledWith('name')
	})
})
