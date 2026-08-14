// @verifies CRM-043 (docs/BACKLOG.md) — le rôle de workspace courant, condition du geste de
//           modération (INC-072)
// @verifies docs/SPEC-cards.md §13.10 (à qui le geste est offert), §13.6 (la règle, tenue par
//           `card_comments_moderation` et non par ce module)
// @verifies docs/SPEC-permissions-rls.md §2.1 (les trois rôles), §7 (un refus rend zéro ligne)
// @verifies docs/JOURNAL.md décision 376
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
	data: { role: string } | null
	error: { message: string } | null
	status: number
}

function clientFactice(reponse: ReponsePostgrest | (() => Promise<never>)): ClientCrm {
	const maybeSingle = typeof reponse === 'function' ? reponse : () => Promise.resolve(reponse)
	return {
		from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
	} as unknown as ClientCrm
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
			clientFactice({ data: { role: 'admin' }, error: null, status: 200 }),
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
			clientFactice({ data: { role: 'super-admin' }, error: null, status: 200 }),
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

	// LA REQUÊTE PORTE LES DEUX FILTRES, ET C'EST LE POINT. Filtrer sur le seul workspace
	// rapporterait les lignes de TOUS les membres — mesuré, un membre les lit — et le module
	// choisirait alors une ligne parmi plusieurs, c'est-à-dire déciderait.
	it('demande une seule ligne, filtrée sur le couple (workspace, utilisateur)', async () => {
		const maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null, status: 200 }))
		const eqUtilisateur = vi.fn(() => ({ maybeSingle }))
		const eqWorkspace = vi.fn(() => ({ eq: eqUtilisateur }))
		const select = vi.fn(() => ({ eq: eqWorkspace }))
		const from = vi.fn(() => ({ select }))
		await lireRoleWorkspace({ from } as unknown as ClientCrm, 'ws-1', 'profil-1')
		expect(from).toHaveBeenCalledWith('workspace_members')
		expect(select).toHaveBeenCalledWith('role')
		expect(eqWorkspace).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(eqUtilisateur).toHaveBeenCalledWith('user_id', 'profil-1')
		expect(maybeSingle).toHaveBeenCalledTimes(1)
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
