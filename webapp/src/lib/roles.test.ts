// @verifies CRM-043 (docs/BACKLOG.md) — le rôle de workspace courant, condition du geste de
//           modération (INC-072)
// @verifies docs/SPEC-cards.md §13.10 (à qui le geste est offert), §13.6 (la règle, tenue par
//           `card_comments_moderation` et non par ce module)
// @verifies docs/SPEC-permissions-rls.md §2.1 (les trois rôles), §7 (un refus rend zéro ligne)
// @verifies docs/JOURNAL.md décision 376
// @verifies CRM-092 (docs/BACKLOG.md) — tranche T8 ; docs/SPEC-session-sso.md §6.1 bis, point 7 ;
//           docs/JOURNAL.md décision 597 — le rôle vient de `public.mon_role_espace`
//
// Le client est remplacé par un double **fidèle au contrat de PostgREST** : `data`, `error` et
// `status`. Le contrat réel est éprouvé hors interface par `e2e/ui/commentaires-gestes.spec.ts`,
// qui retire un commentaire avec la session réelle de l'administratrice et relit l'effet par l'API.
//
// CE QUI EST MESURÉ ICI N'EST PAS UN DROIT. Ce module ne garde rien : il dit ce que l'écran peut
// OFFRIR. Les assertions portent donc sur la requête émise, sur la traduction des réponses, et sur
// le fait que **le doute ne vaut jamais permission**.

import { describe, expect, it, vi } from 'vitest'
import { estAdministrateur, lireRoleWorkspace, roleConnu, ROLES } from './roles'
import type { ClientCrm } from './supabase'

type ReponsePostgrest = {
	data: string | null
	error: { message: string } | null
	status: number
}

function clientFactice(reponse: ReponsePostgrest | (() => Promise<never>)): ClientCrm {
	const rpc = typeof reponse === 'function' ? reponse : () => Promise.resolve(reponse)
	return { rpc } as unknown as ClientCrm
}

describe('roleConnu', () => {
	it('reconnaît les trois rôles du §2.1', () => {
		for (const role of ROLES) expect(roleConnu(role)).toBe(role)
	})

	// `database.types.ts` déclare la colonne comme une CHAÎNE : le générateur ne voit pas le
	// `CHECK`. Une valeur inconnue ne doit donc pas être castée en rôle — elle ne l'est pas.
	it('rend null pour une valeur que la contrainte n’autorise pas', () => {
		expect(roleConnu('owner')).toBeNull()
		expect(roleConnu('')).toBeNull()
		expect(roleConnu(null)).toBeNull()
		expect(roleConnu(undefined)).toBeNull()
	})
})

describe('lireRoleWorkspace', () => {
	it('rend le rôle du membre', async () => {
		const etat = await lireRoleWorkspace(
			clientFactice({ data: 'admin', error: null, status: 200 }),
			'ws-1',
			'profil-1',
		)
		expect(etat).toEqual({ statut: 'pret', donnees: 'admin' })
	})

	// C'est le comportement RÉEL sous clé anonyme, mesuré le 2026-08-14 : `200` et aucune ligne.
	// L'absence de rôle est une réponse pleine, jamais une erreur.
	it('rend l’état prêt et sans rôle quand aucune ligne n’est consentie', async () => {
		const etat = await lireRoleWorkspace(
			clientFactice({ data: null, error: null, status: 200 }),
			'ws-1',
			'profil-1',
		)
		expect(etat).toEqual({ statut: 'pret', donnees: null })
	})

	it('rend l’état prêt et sans rôle quand la valeur lue n’est pas un rôle connu', async () => {
		const etat = await lireRoleWorkspace(
			clientFactice({ data: 'super-admin', error: null, status: 200 }),
			'ws-1',
			'profil-1',
		)
		expect(etat).toEqual({ statut: 'pret', donnees: null })
	})

	it('classe un 403 en refus', async () => {
		const etat = await lireRoleWorkspace(
			clientFactice({ data: null, error: { message: 'permission denied' }, status: 403 }),
			'ws-1',
			'profil-1',
		)
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('forbidden')
	})

	it('ne laisse pas échapper une exception du transport', async () => {
		const etat = await lireRoleWorkspace(
			clientFactice(() => Promise.reject(new Error('Failed to fetch'))),
			'ws-1',
			'profil-1',
		)
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('network')
	})

	// LE RÔLE VIENT DE LA FONCTION QUE LA BASE APPLIQUE, JAMAIS DE LA TABLE — décision 597. Lu dans
	// `workspace_members`, le porteur du rôle de realm `admin` — administrateur par la revendication
	// de son jeton, sans ligne — n'aurait aucun rôle à l'écran. Une seule requête, sur le workspace.
	it('demande le rôle à `mon_role_espace`, pour le seul workspace, et à rien d’autre', async () => {
		const rpc = vi.fn(() => Promise.resolve({ data: 'admin', error: null, status: 200 }))
		const from = vi.fn()
		await lireRoleWorkspace({ rpc, from } as unknown as ClientCrm, 'ws-1', 'profil-1')
		expect(rpc).toHaveBeenCalledTimes(1)
		expect(rpc).toHaveBeenCalledWith('mon_role_espace', { ws: 'ws-1' })
		expect(from).not.toHaveBeenCalled()
	})
})

describe('estAdministrateur', () => {
	it('est vrai pour le seul rôle admin', () => {
		expect(estAdministrateur({ statut: 'pret', donnees: 'admin' })).toBe(true)
		expect(estAdministrateur({ statut: 'pret', donnees: 'business_developer' })).toBe(false)
		expect(estAdministrateur({ statut: 'pret', donnees: 'viewer' })).toBe(false)
		expect(estAdministrateur({ statut: 'pret', donnees: null })).toBe(false)
	})

	// LE DOUTE NE VAUT PAS PERMISSION. Tant que le rôle n'est pas connu, rien n'est offert :
	// offrir puis retirer ferait clignoter une action, et offrir sans savoir produirait la
	// commande morte que le §5.10 du design system refuse.
	it('est faux tant que le rôle n’est pas connu, et faux s’il est illisible', () => {
		expect(estAdministrateur({ statut: 'chargement' })).toBe(false)
		expect(
			estAdministrateur({ statut: 'erreur', erreur: { nature: 'network', detail: 'x' } }),
		).toBe(false)
	})
})
