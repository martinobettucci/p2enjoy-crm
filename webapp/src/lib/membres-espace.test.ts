// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : la lecture et les écritures des membres d'un espace par son
//           administrateur
// @verifies docs/SPEC-membres.md §2 (les écritures passent par `workspace_members` sous la RLS, jamais par les fonctions
//           `plateforme_*`), §3.1 (administrateurs d'abord, puis par nom ; le dernier administrateur), §3.4 (les refus
//           traduits : dernier administrateur, sans effet, droit, réseau, inconnu)
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T3 : les attentes lues, inscrites par `inscrire_attente`, retirées ; « en
//           suspens » ; docs/SPEC-membres.md §3.2, §5 point 3
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T4 : la matrice lue par `acces_effectif_membre`, ordonnée track puis ses
//           channels ; un droit posé par `upsert`, retiré pour « hérité » ; docs/SPEC-membres.md §3.3
// @verifies CRM-109 (docs/BACKLOG.md) — tranche T3 : la trace du dernier refus, embarquée avec chaque attente ;
//           docs/SPEC-refus-admission.md §3, §5

import { describe, expect, it } from 'vitest'
import {
	attenteSuspendue,
	changerRoleMembre,
	inscrireAttente,
	issueEcriture,
	lireDroitsFins,
	ordonnerDroits,
	poserDroitFin,
	lireAttentesEspace,
	lireMembresEspace,
	retirerAttenteEspace,
	retirerMembreEspace,
	trierMembres,
} from './membres-espace'
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
			chaine.upsert = (charge: unknown, options: unknown) => {
				appel.operation = 'upsert'
				appel.charge = { charge, options }
				return chaine
			}
			chaine.delete = () => {
				appel.operation = 'delete'
				return chaine
			}
			chaine.order = () => chaine
			chaine.eq = (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			}
			chaine.then = (ok: (r: Reponse) => unknown, ko: (e: unknown) => unknown) =>
				reponse instanceof Error ? Promise.reject(reponse).then(ok, ko) : Promise.resolve(reponse).then(ok)
			return chaine
		},
		rpc: (fonction: string, args: unknown) => {
			appels.push({ table: `rpc:${fonction}`, operation: 'rpc', charge: args, filtres: [] })
			return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse)
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

describe('les attentes (T3)', () => {
	it('lit workspace_invitations de l’espace, avec le nom de qui l’a inscrite, et écarte un rôle inconnu', async () => {
		const { client, appels } = espion({
			data: [
				{
					email: 'a@x.test',
					role: 'viewer',
					created_at: '2026-10-01',
					profiles: { full_name: 'Camille Aubert' },
					admission_refus: { motif: 'attente_verification', premier_refus: '2026-10-18', dernier_refus: '2026-10-21', refus: 3 },
				},
				{
					email: 'b@x.test',
					role: 'admin',
					created_at: '2026-10-02',
					profiles: null,
					// Une version de PostgREST qui rend la relation un-à-un en tableau : la trace est lue quand même.
					admission_refus: [{ motif: 'adresse_non_verifiee', premier_refus: '2026-10-20', dernier_refus: '2026-10-20', refus: 1 }],
				},
				{ email: 'c@x.test', role: 'owner', created_at: '2026-10-03', profiles: null, admission_refus: null },
			],
			error: null,
			status: 200,
		})
		const etat = await lireAttentesEspace(client, 'w1')
		expect(appels[0]).toMatchObject({ table: 'workspace_invitations', filtres: [['workspace_id', 'w1']] })
		expect(appels[0]?.colonnes).toContain('admission_refus(motif, premier_refus, dernier_refus, refus)')
		expect(etat.statut === 'pret' && etat.donnees).toEqual([
			{
				email: 'a@x.test',
				role: 'viewer',
				invitePar: 'Camille Aubert',
				depuis: '2026-10-01',
				refus: { motif: 'attente_verification', premier: '2026-10-18', dernier: '2026-10-21', nombre: 3 },
			},
			{
				email: 'b@x.test',
				role: 'admin',
				invitePar: null,
				depuis: '2026-10-02',
				refus: { motif: 'adresse_non_verifiee', premier: '2026-10-20', dernier: '2026-10-20', nombre: 1 },
			},
		])
	})

	it('inscrire appelle inscrire_attente et rend le rôle remplacé, ou null pour une attente neuve', async () => {
		const neuve = espion({ data: null, error: null, status: 200 })
		expect(await inscrireAttente(neuve.client, 'w1', 'a@x.test', 'viewer')).toEqual({ ok: true, remplace: null })
		expect(neuve.appels[0]).toMatchObject({ table: 'rpc:inscrire_attente', charge: { p_ws: 'w1', p_email: 'a@x.test', p_role: 'viewer' } })
		const remplacee = espion({ data: 'business_developer', error: null, status: 200 })
		expect(await inscrireAttente(remplacee.client, 'w1', 'a@x.test', 'admin')).toEqual({ ok: true, remplace: 'business_developer' })
	})

	it('les refus de la fonction sont traduits : adresse, rôle, droit, réseau', async () => {
		const refus = (message: string, status: number) => espion({ data: null, error: { code: '22023', message }, status }).client
		expect(await inscrireAttente(refus('adresse_invalide', 400), 'w1', 'x', 'viewer')).toEqual({ ok: false, motif: 'adresse-invalide' })
		expect(await inscrireAttente(refus('role_invalide', 400), 'w1', 'x@y', 'viewer')).toEqual({ ok: false, motif: 'role-invalide' })
		expect(await inscrireAttente(refus('reserve_aux_administrateurs', 403), 'w1', 'x@y', 'viewer')).toEqual({ ok: false, motif: 'droit' })
		expect(await inscrireAttente(espion(new Error('réseau')).client, 'w1', 'x@y', 'viewer')).toEqual({ ok: false, motif: 'reseau' })
	})

	it('retirer supprime l’attente de l’adresse, et zéro ligne est « sans effet »', async () => {
		const { client, appels } = espion({ data: [{ email: 'a@x.test' }], error: null, status: 200 })
		expect(await retirerAttenteEspace(client, 'w1', 'a@x.test')).toEqual({ ok: true })
		expect(appels[0]).toMatchObject({ table: 'workspace_invitations', operation: 'delete', filtres: [['workspace_id', 'w1'], ['email', 'a@x.test']] })
		expect(await retirerAttenteEspace(espion({ data: [], error: null, status: 200 }).client, 'w1', 'a@x.test')).toEqual({
			ok: false,
			motif: 'sans-effet',
		})
	})

	it('« en suspens » : une attente non administratrice dans un espace sans administrateur membre', () => {
		expect(attenteSuspendue('viewer', 0)).toBe(true)
		expect(attenteSuspendue('admin', 0)).toBe(false)
		expect(attenteSuspendue('viewer', 1)).toBe(false)
	})
})

describe('les droits fins (T4)', () => {
	const ligne = (objet: string, id: string, track: string, nom: string, pose: string | null, effectif: string) => ({
		objet,
		id,
		track_id: track,
		nom,
		archive: false,
		acces_pose: pose,
		acces_effectif: effectif,
		lisible_par_un_channel: objet === 'track' ? false : null,
	})

	it('lit acces_effectif_membre, ordonne chaque track suivi de ses channels, et écarte un vocabulaire inconnu', async () => {
		const { client, appels } = espion({
			data: [
				ligne('channel', 'c2', 't1', 'Prospection', 'member', 'write'),
				ligne('track', 't2', 't2', 'Studio web', null, 'read'),
				ligne('channel', 'c1', 't1', 'Grands comptes', null, 'none'),
				ligne('track', 't1', 't1', 'Conseil & IA', 'none', 'none'),
				ligne('channel', 'c3', 't2', 'Maintenance', 'owner', 'read'),
				ligne('channel', 'c4', 't2', 'Refonte', null, 'admin'),
			],
			error: null,
			status: 200,
		})
		const etat = await lireDroitsFins(client, 'w1', 'u3')
		expect(appels[0]).toMatchObject({ table: 'rpc:acces_effectif_membre', charge: { p_ws: 'w1', p_user: 'u3' } })
		expect(etat.statut === 'pret' && etat.donnees.map((d) => `${d.nom}:${d.pose ?? 'hérité'}:${d.effectif}`)).toEqual([
			'Conseil & IA:none:none',
			'Grands comptes:hérité:none',
			'Prospection:member:write',
			'Studio web:hérité:read',
			'Maintenance:hérité:read',
		])
	})

	it('un refus de la fonction rend une erreur, jamais une matrice vide', async () => {
		const etat = await lireDroitsFins(espion({ data: null, error: { code: '42501', message: 'reserve_aux_administrateurs' }, status: 403 }).client, 'w1', 'u3')
		expect(etat.statut).toBe('erreur')
	})

	it('poser écrit par upsert dans la table de l’objet, sur sa clé', async () => {
		const track = espion({ data: [{ user_id: 'u3' }], error: null, status: 200 })
		expect(await poserDroitFin(track.client, 'track', 't1', 'u3', 'viewer')).toEqual({ ok: true })
		expect(track.appels[0]).toMatchObject({
			table: 'track_members',
			operation: 'upsert',
			charge: { charge: { track_id: 't1', user_id: 'u3', access: 'viewer' }, options: { onConflict: 'track_id,user_id' } },
		})
		const channel = espion({ data: [{ user_id: 'u3' }], error: null, status: 200 })
		await poserDroitFin(channel.client, 'channel', 'c1', 'u3', 'none')
		expect(channel.appels[0]).toMatchObject({
			table: 'channel_members',
			charge: { charge: { channel_id: 'c1', user_id: 'u3', access: 'none' }, options: { onConflict: 'channel_id,user_id' } },
		})
	})

	it('« hérité » supprime la ligne posée ; zéro ligne rendue est « sans effet »', async () => {
		const { client, appels } = espion({ data: [{ user_id: 'u3' }], error: null, status: 200 })
		expect(await poserDroitFin(client, 'channel', 'c1', 'u3', null)).toEqual({ ok: true })
		expect(appels[0]).toMatchObject({ table: 'channel_members', operation: 'delete', filtres: [['channel_id', 'c1'], ['user_id', 'u3']] })
		expect(await poserDroitFin(espion({ data: [], error: null, status: 200 }).client, 'track', 't1', 'u3', null)).toEqual({
			ok: false,
			motif: 'sans-effet',
		})
	})

	it('un channel dont le track n’est pas rendu n’apparaît pas : la matrice ne montre rien hors de son arbre', () => {
		const orphelin = { objet: 'channel' as const, id: 'c9', idTrack: 'tx', nom: 'Orphelin', archive: false, pose: null, effectif: 'none' as const, lisibleParUnChannel: null }
		expect(ordonnerDroits([orphelin])).toEqual([])
	})
})
