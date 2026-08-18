// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a et 4b
// @verifies docs/SPEC-contacts.md §10.3 (la lecture, ses colonnes, son ordre, l'organisation
//           embarquée), §10.4 (aucun droit calculé : zéro ligne est une liste vide),
//           §10.7 (aucune pagination, aucun filtre)
// @verifies docs/SPEC-contacts.md §11.3 (la lecture de la fiche : colonnes, filtre sur `id`, tri
//           des contacts embarqués par `referencedTable`), §11.4 (trois absences rendent le même
//           `null`, et un identifiant mal formé n'émet AUCUNE requête), §11.9 cas a et d
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone : l'erreur est classée sur le code HTTP)
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les colonnes demandées, l'organisation embarquée et le tri côté serveur sont
// des exigences de la spécification portées par la requête elle-même. Une lecture qui rendrait
// les bonnes données en trichant sur la requête violerait le §10.3 sans qu'aucune assertion de
// valeur ne s'en aperçoive.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_CONTACT_CARNET,
	COLONNES_FICHE_ORGANISATION,
	TABLE_TRI_CONTACTS_FICHE,
	TRI_CARNET,
	TRI_CONTACTS_FICHE,
	estFormeUuid,
	lireContactsDuCarnet,
	lireFicheOrganisation,
} from './contacts'
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

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4b — LA LECTURE DE LA FICHE D'ORGANISATION (docs/SPEC-contacts.md §11.3, §11.4)
// ----------------------------------------------------------------------------------------------

/**
 * Espion de la fiche : il enregistre en plus les filtres `eq` — la fiche en pose UN, sur `id` —
 * et le couple réellement transmis à `order`, colonne ET table référencée. Cette seconde mesure
 * n'est pas un détail : la forme du carnet, `order('contacts(full_name)')`, est refusée par
 * PostgREST avec `PGRST108`, et seul le couple `(colonne, referencedTable)` construit le
 * `contacts.order=full_name` relevé au §11.3.
 */
function espionFiche(reponse: Reponse): {
	client: ClientCrm
	appel: { table?: string; colonnes?: string; eq: string[]; tris: unknown[] }
} {
	const appel: { table?: string; colonnes?: string; eq: string[]; tris: unknown[] } = {
		eq: [],
		tris: [],
	}
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: string) => {
			appel.eq.push(`${colonne}=${valeur}`)
			return chaine
		},
		order: (colonne: string, options?: unknown) => {
			appel.tris.push([colonne, options])
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
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

const ID_SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const ID_SANS_CONTACT = '5eed0000-0000-4000-8000-000000000083'

/** Sogexia, du seed enrichi par la tranche 4b : un domaine, un site web, un contact. */
const SOGEXIA = {
	id: ID_SOGEXIA,
	name: 'Sogexia',
	domain: 'sogexia.example',
	website: 'https://www.sogexia.example',
	contacts: [
		{
			id: '5eed0000-0000-4000-8000-000000000091',
			full_name: 'Léo Marchand',
			email: 'leo.marchand@sogexia.example',
			phone: null,
			role_title: 'Directeur achats',
		},
	],
}

describe('estFormeUuid', () => {
	it('accepte un uuid, refuse tout le reste — §11.4', () => {
		expect(estFormeUuid(ID_SOGEXIA)).toBe(true)
		expect(estFormeUuid('5EED0000-0000-4000-8000-000000000081')).toBe(true)
		expect(estFormeUuid('pas-un-uuid')).toBe(false)
		expect(estFormeUuid('')).toBe(false)
		expect(estFormeUuid(undefined)).toBe(false)
		// Un uuid tronqué reste refusé : la mesure sur la pile rend `400` et `22P02`.
		expect(estFormeUuid(ID_SOGEXIA.slice(0, -1))).toBe(false)
	})
})

describe('lireFicheOrganisation', () => {
	it('interroge `organizations`, filtre sur `id` et trie les contacts EMBARQUÉS — §11.3', async () => {
		const { client, appel } = espionFiche({ data: [SOGEXIA], error: null, status: 200 })
		await lireFicheOrganisation(client, ID_SOGEXIA)
		expect(appel.table).toBe('organizations')
		expect(appel.colonnes).toBe(COLONNES_FICHE_ORGANISATION)
		expect(appel.eq).toEqual([`id=${ID_SOGEXIA}`])
		// Le couple, et non une chaîne recomposée : `order('contacts(full_name)')` construirait
		// `order=contacts(full_name)`, que PostgREST refuse par `PGRST108`.
		expect(appel.tris).toEqual([
			[TRI_CONTACTS_FICHE, { referencedTable: TABLE_TRI_CONTACTS_FICHE }],
		])
	})

	it('embarque les contacts et demande `website`, que le carnet ne demandait pas — §11.3', () => {
		expect(COLONNES_FICHE_ORGANISATION).toContain(
			'contacts(id, full_name, email, phone, role_title)',
		)
		expect(COLONNES_FICHE_ORGANISATION).toContain('website')
		// `organization_id` ne figure pas dans les colonnes des contacts embarqués : sur cette
		// surface, tous appartiennent à l'organisation de la page (§11.5).
		expect(COLONNES_FICHE_ORGANISATION).not.toContain('organization_id')
		// `source` n'est pas davantage demandée qu'au §10.3.
		expect(COLONNES_FICHE_ORGANISATION).not.toContain('source')
	})

	it("n'émet AUCUNE requête quand l'identifiant n'a pas la forme d'un uuid — §11.4", async () => {
		// LA RÈGLE QUE LA MESURE A IMPOSÉE. Un `400` classé par `classerErreur` tomberait sur
		// l'état d'erreur, dont la reprise relancerait la même requête pour le même `400` : une
		// commande morte, sur une surface dont l'adresse est éditable par l'utilisateur.
		const { client, appel } = espionFiche({ data: [SOGEXIA], error: null, status: 200 })
		const lu = await lireFicheOrganisation(client, 'pas-un-uuid')
		expect(appel.table).toBeUndefined()
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toBeNull()
	})

	it("rend `null` — jamais une erreur — quand la réponse est vide, quelle qu'en soit la cause", async () => {
		// MESURÉ : une organisation inexistante et un appelant anonyme rendent TOUS DEUX `200` et
		// `[]`. Les distinguer renseignerait un appelant sans droit sur l'EXISTENCE d'une
		// organisation (docs/SPEC-permissions-rls.md §7).
		const { client } = espionFiche({ data: [], error: null, status: 200 })
		const lu = await lireFicheOrganisation(client, ID_SOGEXIA)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toBeNull()
	})

	it('rend une organisation SANS CONTACT comme un état légitime, non comme une anomalie — §11.9 cas d', async () => {
		// Comptoir Vasseur, seedée par la tranche 4b. MESURÉ sur la pile : `"contacts": []`.
		const { client } = espionFiche({
			data: [{ id: ID_SANS_CONTACT, name: 'Comptoir Vasseur', domain: 'comptoir-vasseur.example', website: null, contacts: [] }],
			error: null,
			status: 200,
		})
		const lu = await lireFicheOrganisation(client, ID_SANS_CONTACT)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret' || lu.donnees === null) return
		expect(lu.donnees.contacts).toEqual([])
		expect(lu.donnees.website).toBeNull()
	})

	it('traite une relation embarquée ABSENTE comme « aucun contact », jamais comme `undefined`', async () => {
		const { client } = espionFiche({
			data: [{ id: ID_SANS_CONTACT, name: 'Comptoir Vasseur', domain: null, website: null }],
			error: null,
			status: 200,
		})
		const lu = await lireFicheOrganisation(client, ID_SANS_CONTACT)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret' || lu.donnees === null) return
		expect(lu.donnees.contacts).toEqual([])
	})

	it('rend la première ligne avec ses contacts embarqués — §11.9 cas a', async () => {
		const { client } = espionFiche({ data: [SOGEXIA], error: null, status: 200 })
		const lu = await lireFicheOrganisation(client, ID_SOGEXIA)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret' || lu.donnees === null) return
		expect(lu.donnees.name).toBe('Sogexia')
		expect(lu.donnees.website).toBe('https://www.sogexia.example')
		expect(lu.donnees.contacts).toHaveLength(1)
	})

	it("classe l'erreur sur le code HTTP, jamais sur le texte du message — §6.4", async () => {
		const { client } = espionFiche({ data: null, error: { message: 'boom' }, status: 500 })
		const lu = await lireFicheOrganisation(client, ID_SOGEXIA)
		expect(lu.statut).toBe('erreur')
		if (lu.statut !== 'erreur') return
		expect(lu.erreur.nature).toBe('unknown')

		const refus = espionFiche({ data: null, error: { message: 'permission denied' }, status: 403 })
		const luRefus = await lireFicheOrganisation(refus.client, ID_SOGEXIA)
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
		const lu = await lireFicheOrganisation(client, ID_SOGEXIA)
		expect(lu.statut).toBe('erreur')
	})
})
