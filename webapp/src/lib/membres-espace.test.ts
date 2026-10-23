// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : la lecture et les écritures des membres d'un espace par son
//           administrateur
// @verifies docs/SPEC-membres.md §2 (les écritures passent par `workspace_members` sous la RLS, jamais par les fonctions
//           `plateforme_*`), §3.1 (administrateurs d'abord, puis par nom ; le dernier administrateur), §3.4 (les refus
//           traduits : dernier administrateur, sans effet, droit, réseau, inconnu)

import { describe, expect, it } from 'vitest'
import { changerRoleMembre, issueEcriture, lireMembresEspace, retirerMembreEspace, trierMembres } from './membres-espace'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown; error: { code?: string; message: string } | null; status: number }

/** Un client qui consigne la table, l'opération et les filtres, et rend la réponse donnée. */
function espion(reponse: Reponse | Error) {
	const appels: { table: string; operation: string; charge?: unknown; filtres: [string, unknown][]; colonnes?: string }[] = []
	const client = {
		from: (table: string) => {
			const appel: (typeof appels)[number] = { table, operation: 'select', filtres: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			}
			chaine.update = (charge: unknown) => {
				appel.operation = 'update'
				appel.charge = charge
				return chaine
			}
			chaine.delete = () => {
				appel.operation = 'delete'
				return chaine
			}
			chaine.eq = (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			}
			chaine.then = (ok: (r: Reponse) => unknown, ko: (e: unknown) => unknown) =>
				reponse instanceof Error ? Promise.reject(reponse).then(ok, ko) : Promise.resolve(reponse).then(ok)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels }
}

describe('la lecture des membres', () => {
	it('lit workspace_members de l’espace, avec le nom du profil, administrateurs d’abord puis par nom', async () => {
		const { client, appels } = espion({
			data: [
				{ user_id: 'u3', role: 'viewer', created_at: '2026-09-03', profiles: { full_name: 'Farida Nowak' } },
				{ user_id: 'u2', role: 'business_developer', created_at: '2026-09-02', profiles: { full_name: 'Driss Lemoine' } },
				{ user_id: 'u1', role: 'admin', created_at: '2026-09-01', profiles: { full_name: 'Camille Aubert' } },
			],
			error: null,
			status: 200,
		})
		const etat = await lireMembresEspace(client, 'w1')
		expect(appels[0]).toMatchObject({ table: 'workspace_members', filtres: [['workspace_id', 'w1']] })
		expect(etat.statut === 'pret' && etat.donnees.map((m) => m.nom)).toEqual(['Camille Aubert', 'Driss Lemoine', 'Farida Nowak'])
	})

	it('un profil illisible donne un nom nul, et un rôle inconnu écarte la ligne', async () => {
		const { client } = espion({
			data: [
				{ user_id: 'u1', role: 'admin', created_at: '2026-09-01', profiles: null },
				{ user_id: 'u9', role: 'owner', created_at: '2026-09-01', profiles: { full_name: 'X' } },
			],
			error: null,
			status: 200,
		})
		const etat = await lireMembresEspace(client, 'w1')
		expect(etat.statut === 'pret' && etat.donnees).toEqual([{ idUtilisateur: 'u1', nom: null, role: 'admin', depuis: '2026-09-01' }])
	})

	it('une erreur rend un état d’erreur, une panne de transport aussi', async () => {
		expect((await lireMembresEspace(espion({ data: null, error: { message: 'x' }, status: 403 }).client, 'w1')).statut).toBe('erreur')
		expect((await lireMembresEspace(espion(new Error('réseau')).client, 'w1')).statut).toBe('erreur')
	})

	it('le tri garde les administrateurs en tête même quand leur nom vient après', () => {
		const tries = trierMembres([
			{ idUtilisateur: 'a', nom: 'Aline', role: 'viewer', depuis: '' },
			{ idUtilisateur: 'z', nom: 'Zoé', role: 'admin', depuis: '' },
		])
		expect(tries.map((m) => m.nom)).toEqual(['Zoé', 'Aline'])
	})
})

describe('les écritures, sous la RLS et jamais par la plateforme', () => {
	it('changer le rôle met à jour la ligne du membre de l’espace, et fait rendre la ligne', async () => {
		const { client, appels } = espion({ data: [{ user_id: 'u2' }], error: null, status: 200 })
		expect(await changerRoleMembre(client, 'w1', 'u2', 'viewer')).toEqual({ ok: true })
		expect(appels[0]).toMatchObject({
			table: 'workspace_members',
			operation: 'update',
			charge: { role: 'viewer' },
			filtres: [['workspace_id', 'w1'], ['user_id', 'u2']],
			colonnes: 'user_id',
		})
	})

	it('retirer supprime la ligne du membre de l’espace, et fait rendre la ligne', async () => {
		const { client, appels } = espion({ data: [{ user_id: 'u2' }], error: null, status: 200 })
		expect(await retirerMembreEspace(client, 'w1', 'u2')).toEqual({ ok: true })
		expect(appels[0]).toMatchObject({ table: 'workspace_members', operation: 'delete', filtres: [['workspace_id', 'w1'], ['user_id', 'u2']] })
	})

	it('une panne de transport est un refus réseau, jamais un succès', async () => {
		expect(await retirerMembreEspace(espion(new Error('réseau')).client, 'w1', 'u2')).toEqual({ ok: false, motif: 'reseau' })
	})
})

describe('la traduction des issues', () => {
	it('zéro ligne est « sans effet », ni succès ni erreur', () => {
		expect(issueEcriture({ data: [], error: null, status: 200 })).toEqual({ ok: false, motif: 'sans-effet' })
	})
	it('l’invariant du dernier administrateur est reconnu par son message', () => {
		expect(issueEcriture({ data: null, error: { code: '23514', message: 'last_workspace_admin' }, status: 400 })).toEqual({
			ok: false,
			motif: 'dernier-administrateur',
		})
	})
	it('401 et 403 sont un refus de droit, 0 une panne réseau, le reste inconnu', () => {
		expect(issueEcriture({ data: null, error: { message: 'x' }, status: 403 })).toEqual({ ok: false, motif: 'droit' })
		expect(issueEcriture({ data: null, error: { message: 'x' }, status: 0 })).toEqual({ ok: false, motif: 'reseau' })
		expect(issueEcriture({ data: null, error: { message: 'x' }, status: 500 })).toEqual({ ok: false, motif: 'inconnu' })
	})
})
