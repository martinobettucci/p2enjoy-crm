// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a
// @verifies docs/SPEC-contacts.md §10.3 (la lecture, ses colonnes, son ordre, l'organisation
//           embarquée), §10.4 (aucun droit calculé : zéro ligne est une liste vide),
//           §10.7 (aucune pagination, aucun filtre)
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone : l'erreur est classée sur le code HTTP)
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les colonnes demandées, l'organisation embarquée et le tri côté serveur sont
// des exigences de la spécification portées par la requête elle-même. Une lecture qui rendrait
// les bonnes données en trichant sur la requête violerait le §10.3 sans qu'aucune assertion de
// valeur ne s'en aperçoive.

import { describe, expect, it } from 'vitest'
import { COLONNES_CONTACT_CARNET, TRI_CARNET, lireContactsDuCarnet } from './contacts'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

type Appel = { table?: string; colonnes?: string; tris: string[]; filtres: string[] }

/**
 * Client espion : il enregistre la table, les colonnes et les tris, et refuse silencieusement
 * tout filtre — `is`, `eq`, `limit` et `range` sont posés pour que leur emploi soit VISIBLE dans
 * l'assertion « aucun filtre », plutôt que d'échouer sur un `undefined is not a function` qui ne
 * dirait pas lequel a été employé.
 */
function espion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { tris: [], filtres: [] }
	const chaine: Record<string, unknown> = {
		order: (colonne: string) => {
			appel.tris.push(colonne)
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	for (const nom of ['is', 'eq', 'limit', 'range', 'not', 'filter']) {
		chaine[nom] = (...arguments_: unknown[]) => {
			appel.filtres.push(`${nom}(${arguments_.map(String).join(',')})`)
			return chaine
		}
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

const LEO = {
	id: '5eed0000-0000-4000-8000-000000000091',
	full_name: 'Léo Marchand',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur achats',
	organization_id: '5eed0000-0000-4000-8000-000000000081',
	organizations: {
		id: '5eed0000-0000-4000-8000-000000000081',
		name: 'Sogexia',
		domain: 'sogexia.example',
	},
}

/** Sophie Dupont, du seed : aucune organisation, aucune fonction — le cas b du §10.6. */
const SOPHIE = {
	id: '5eed0000-0000-4000-8000-000000000092',
	full_name: 'Sophie Dupont',
	email: 'sophie@dupont.test',
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
}

describe('lireContactsDuCarnet', () => {
	it('interroge `contacts`, demande les colonnes du §10.3 et trie par nom côté serveur', async () => {
		const { client, appel } = espion({ data: [LEO], error: null, status: 200 })
		await lireContactsDuCarnet(client)
		expect(appel.table).toBe('contacts')
		expect(appel.colonnes).toBe(COLONNES_CONTACT_CARNET)
		expect(appel.tris).toEqual([TRI_CARNET])
	})

	it("embarque l'organisation dans la MÊME requête, et ne demande pas `source` — §10.3", () => {
		// L'organisation embarquée est mesurée possible ici : `contacts` ne porte qu'une seule clé
		// étrangère vers `organizations`, donc aucune ambiguïté `PGRST201` — contrairement à
		// `corbeille.ts` et `inbox.ts`, qui ont dû se rabattre sur deux lectures.
		expect(COLONNES_CONTACT_CARNET).toContain('organizations(id, name, domain)')
		// `source` n'est pas affichée par le carnet : une requête ne rapporte que ce qui est rendu.
		expect(COLONNES_CONTACT_CARNET).not.toContain('source')
	})

	it("n'applique AUCUN filtre et AUCUNE pagination — limites nommées du §10.7", async () => {
		// `contacts` ne porte ni `archived_at` ni `deleted_at` (§2.2) : le cycle de vie d'un contact
		// est laissé à l'arbitrage du responsable (§6, point 1), et inventer ici un masquage
		// poserait une règle que personne n'a prise.
		const { client, appel } = espion({ data: [LEO, SOPHIE], error: null, status: 200 })
		await lireContactsDuCarnet(client)
		expect(appel.filtres).toEqual([])
	})

	it("renomme la relation embarquée en `organisation`, et rend `null` — jamais `undefined`", async () => {
		const { client } = espion({ data: [LEO, SOPHIE], error: null, status: 200 })
		const lu = await lireContactsDuCarnet(client)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toHaveLength(2)
		const [leo, sophie] = lu.donnees
		expect(leo).toBeDefined()
		expect(sophie).toBeDefined()
		if (leo === undefined || sophie === undefined) return
		expect(leo.organisation).toEqual({
			id: '5eed0000-0000-4000-8000-000000000081',
			name: 'Sogexia',
			domain: 'sogexia.example',
		})
		// La distinction compte : `undefined` obligerait l'écran à traiter deux absences
		// différentes, et la mesure sur la pile réelle rend bien `"organizations": null`.
		expect(sophie.organisation).toBeNull()
		expect('organizations' in sophie).toBe(false)
	})

	it('rend une liste VIDE sur zéro ligne, jamais une erreur — §10.4', async () => {
		// MESURÉ : un appelant anonyme reçoit `200` et `[]`. C'est l'état vide ordinaire du §5.8,
		// et surtout pas un refus à mettre en scène (docs/SPEC-permissions-rls.md §7).
		const { client } = espion({ data: [], error: null, status: 200 })
		const lu = await lireContactsDuCarnet(client)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toEqual([])
	})

	it("classe l'erreur sur le code HTTP, jamais sur le texte du message — §6.4", async () => {
		const { client } = espion({ data: null, error: { message: 'boom' }, status: 500 })
		const lu = await lireContactsDuCarnet(client)
		expect(lu.statut).toBe('erreur')
		if (lu.statut !== 'erreur') return
		expect(lu.erreur.nature).toBe('unknown')

		// `403` est classé `forbidden` par la même fonction, sans que le TEXTE du message n'entre
		// dans la décision : c'est le contrat du §6.4, et il vaut ici comme partout.
		const refus = espion({ data: null, error: { message: 'permission denied' }, status: 403 })
		const luRefus = await lireContactsDuCarnet(refus.client)
		expect(luRefus.statut).toBe('erreur')
		if (luRefus.statut !== 'erreur') return
		expect(luRefus.erreur.nature).toBe('forbidden')
	})

	it('ne lève jamais : une exception du client devient un état d’erreur', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const lu = await lireContactsDuCarnet(client)
		expect(lu.statut).toBe('erreur')
	})
})
