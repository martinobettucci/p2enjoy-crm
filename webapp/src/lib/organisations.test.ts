// @verifies CRM-114 (docs/BACKLOG.md) — tranche T2 : la bibliothèque des organisations — lecture, normalisation, refus,
//           écritures
// @verifies docs/SPEC-organisations.md §2 (ce qui est lu et écrit), §3 (dictionnaire fermé des refus ; zéro ligne est un
//           refus) ; docs/DESIGN_SYSTEM.md §5.64 (domaine en minuscules, champ facultatif vidé effacé)

import { describe, expect, it } from 'vitest'
import {
	COLONNES_ORGANISATION_LISTE,
	classerRefusOrganisation,
	creerOrganisation,
	lireOrganisations,
	modifierOrganisation,
	normaliserSaisieOrganisation,
} from './organisations'
import type { ClientCrm } from './supabase'

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }

function double(reponse: Reponse) {
	const appels: { methode: string; charge?: unknown; filtres: string[]; select?: string; ordres: string[] }[] = []
	const client = {
		from: (table: string) => {
			const appel = { methode: '', table, charge: undefined as unknown, filtres: [] as string[], select: undefined as string | undefined, ordres: [] as string[] }
			const chaine: Record<string, unknown> = {
				select: (c: string) => { appel.select = c; return chaine },
				order: (c: string) => { appel.ordres.push(c); return chaine },
				eq: (c: string, v: string) => { appel.filtres.push(`${c}=${v}`); return chaine },
				insert: (charge: unknown) => { appel.methode = 'insert'; appel.charge = charge; return chaine },
				update: (charge: unknown) => { appel.methode = 'update'; appel.charge = charge; return chaine },
				then: (resoudre: (v: unknown) => unknown) =>
					Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null, status: reponse.status ?? 200 }).then(resoudre),
			}
			appels.push(appel)
			return chaine
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('normaliserSaisieOrganisation', () => {
	it('rogne, met le domaine en minuscules, et efface un champ facultatif blanc', () => {
		expect(normaliserSaisieOrganisation({ nom: ' Sogexia ', domaine: ' Sogexia.FR ', siteWeb: '  ' })).toEqual({
			name: 'Sogexia', domain: 'sogexia.fr', website: null,
		})
		expect(normaliserSaisieOrganisation({ nom: 'x', domaine: '', siteWeb: ' https://x.fr ' })).toEqual({
			name: 'x', domain: null, website: 'https://x.fr',
		})
	})
})

describe('classerRefusOrganisation (docs/SPEC-organisations.md §3)', () => {
	it.each([
		[409, '23505', 'duplicate key value violates unique constraint "organizations_workspace_domain_key"', 'domaine-pris'],
		[400, '23514', 'violates check constraint "organizations_name_check"', 'nom-invalide'],
		[400, '23514', 'violates check constraint "organizations_domain_check"', 'domaine-invalide'],
		[400, '23514', 'violates check constraint "organizations_website_check"', 'site-invalide'],
		[400, '23514', 'violates check constraint "autre"', 'inconnu'],
		[403, '42501', 'new row violates row-level security policy', 'interdit'],
		[401, undefined, 'JWT expired', 'interdit'],
		[undefined, undefined, 'Failed to fetch', 'reseau'],
		[500, 'XX000', 'boum', 'inconnu'],
	] as const)('%s %s → %s', (statut, code, message, nature) => {
		expect(classerRefusOrganisation(statut, code, message)).toBe(nature)
	})
})

describe('lireOrganisations', () => {
	it('demande le compte embarqué des contacts et rend un nombre, zéro compris', async () => {
		const { client, appels } = double({ data: [
			{ id: 'o1', name: 'Comptoir', domain: null, website: null, contacts: [{ count: 0 }] },
			{ id: 'o2', name: 'Sogexia', domain: 'sogexia.example', website: 'https://s', contacts: [{ count: 3 }] },
		] })
		const etat = await lireOrganisations(client)
		expect(appels[0]?.select).toBe(COLONNES_ORGANISATION_LISTE)
		expect(appels[0]?.ordres).toEqual(['name', 'id'])
		expect(etat).toEqual({ statut: 'pret', donnees: [
			{ id: 'o1', name: 'Comptoir', domain: null, website: null, contacts: 0 },
			{ id: 'o2', name: 'Sogexia', domain: 'sogexia.example', website: 'https://s', contacts: 3 },
		] })
	})

	it('rend une erreur classée, jamais une liste vide trompeuse', async () => {
		const { client } = double({ error: { message: 'refus' }, status: 403 })
		expect(await lireOrganisations(client)).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
	})
})

describe('créer et modifier', () => {
	it('crée dans l’espace donné, avec la saisie normalisée, et rend l’identifiant', async () => {
		const { client, appels } = double({ data: [{ id: 'neuve' }], status: 201 })
		expect(await creerOrganisation(client, 'ws', { nom: 'Atelier', domaine: 'Atelier.FR', siteWeb: '' })).toEqual({
			statut: 'enregistree', id: 'neuve',
		})
		expect(appels[0]?.charge).toEqual({ workspace_id: 'ws', name: 'Atelier', domain: 'atelier.fr', website: null })
	})

	it('modifie l’organisation ciblée ; zéro ligne est un refus, jamais un succès', async () => {
		const { client, appels } = double({ data: [] })
		expect(await modifierOrganisation(client, 'o1', { nom: 'X', domaine: '', siteWeb: '' })).toEqual({
			statut: 'refus', nature: 'interdit',
		})
		expect(appels[0]?.filtres).toEqual(['id=o1'])
		expect(appels[0]?.charge).toEqual({ name: 'X', domain: null, website: null })
	})

	it('traduit le domaine déjà pris', async () => {
		const { client } = double({ error: { code: '23505', message: 'duplicate key' }, status: 409 })
		expect(await creerOrganisation(client, 'ws', { nom: 'X', domaine: 'x.fr', siteWeb: '' })).toEqual({
			statut: 'refus', nature: 'domaine-pris',
		})
	})
})
