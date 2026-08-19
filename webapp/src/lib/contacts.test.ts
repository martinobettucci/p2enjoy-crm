// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a, 4b,
//           4c, 4d, 4e, 4f et 4g (chaque bloc porte ses propres références plus bas)
// @verifies docs/SPEC-contacts.md §16.3 (ce que `modifierContact` envoie : les cinq colonnes d'un
//           bloc, `workspace_id` jamais, les facultatifs blancs rendus `null`),
//           §16.4 (dictionnaire FERMÉ des six refus, dont `sans-effet` sur zéro ligne)
// @verifies docs/SPEC-contacts.md §10.3 (la lecture, ses colonnes, son ordre, l'organisation
//           embarquée), §10.4 (aucun droit calculé : zéro ligne est une liste vide),
//           §10.7 (aucune pagination, aucun filtre)
// @verifies docs/SPEC-contacts.md §11.3 (la lecture de la fiche : colonnes, filtre sur `id`, tri
//           des contacts embarqués par `referencedTable`), §11.4 (trois absences rendent le même
//           `null`, et un identifiant mal formé n'émet AUCUNE requête), §11.9 cas a et d
// @verifies docs/SPEC-contacts.md §15.3 (la lecture de la fiche de contact : la désambiguïsation
//           de `channels`, le filtre qui écarte la corbeille, le tri des rattachements),
//           §15.4 (trois absences rendent le même `null`), §15.9 cas a, b, e, f, g
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone : l'erreur est classée sur le code HTTP)
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les colonnes demandées, l'organisation embarquée et le tri côté serveur sont
// des exigences de la spécification portées par la requête elle-même. Une lecture qui rendrait
// les bonnes données en trichant sur la requête violerait le §10.3 sans qu'aucune assertion de
// valeur ne s'en aperçoive.

import { describe, expect, it } from 'vitest'
import {
	AFFAIRES_RATTACHABLES_MAX,
	COLONNES_AFFAIRE_RATTACHABLE,
	COLONNES_CONTACT_CARNET,
	CHEMIN_FILTRE_CORBEILLE,
	FILTRE_CORBEILLE_AFFAIRE,
	TRI_AFFAIRES_RATTACHABLES,
	lireAffairesRattachables,
	COLONNES_FICHE_CONTACT,
	COLONNES_FICHE_ORGANISATION,
	TABLE_TRI_AFFAIRES_FICHE,
	TRI_AFFAIRES_FICHE,
	adresseAffaire,
	TABLE_TRI_CONTACTS_FICHE,
	TRI_CARNET,
	TRI_CONTACTS_FICHE,
	CODE_CONTACT_INCONNU,
	CODE_DOUBLON,
	CODE_SAISIE_INVALIDE,
	COLONNES_CONTACTS_AFFAIRE,
	TRI_CONTACTS_AFFAIRE,
	classerRefusCreation,
	classerRefusRattachement,
	creerContact,
	modifierContact,
	detacherContact,
	estFormeUuid,
	libelleContactAvecOrganisation,
	normaliserFacultatif,
	lireContactsDeLAffaire,
	lireContactsDuCarnet,
	lireFicheContact,
	lireFicheOrganisation,
	rattacherContact,
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

// ------------------------------------------------------------------------------------------------
// Sous-tranche 4c — LES CONTACTS D'UNE AFFAIRE (docs/SPEC-contacts.md §12)
// ------------------------------------------------------------------------------------------------
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4c
// @verifies docs/SPEC-contacts.md §12.3 (la lecture : colonnes, embarquement sur DEUX niveaux,
//           filtre sur `card_id`, tri au PREMIER niveau — écart mesuré avec le §11.3),
//           §12.4 (les treize mesures : le refus d'insertion est bruyant, celui de suppression
//           SILENCIEUX), §12.5 (le dictionnaire fermé, code PostgreSQL AVANT code HTTP),
//           §12.7 cas j (un rôle vide vaut `null`, jamais `""`)

/** Espion d'écriture : il enregistre la table, la charge envoyée et les filtres posés. */
type AppelEcriture = {
	table?: string
	operation?: 'insert' | 'delete'
	charge?: unknown
	filtres: string[]
	colonnes?: string
}

function espionEcriture(reponse: {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelEcriture } {
	const appel: AppelEcriture = { filtres: [] }
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push(`eq(${colonne},${String(valeur)})`)
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return chaine
		},
		then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: unknown) => {
					appel.operation = 'insert'
					appel.charge = charge
					return chaine
				},
				delete: () => {
					appel.operation = 'delete'
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

const ID_CARD = '5eed0000-0000-4000-8000-0000000000c2'
const ID_WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Le rattachement de Léo Marchand à `Migration ERP Sogexia`, tel que le seed le pose. */
const RATTACHEMENT_LEO = {
	contact_id: '5eed0000-0000-4000-8000-000000000091',
	role: 'decideur',
	contacts: {
		id: '5eed0000-0000-4000-8000-000000000091',
		full_name: 'Léo Marchand',
		organization_id: '5eed0000-0000-4000-8000-000000000081',
		organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia' },
	},
}

/** Sophie Dupont : aucune organisation, et un rattachement SANS rôle — cas b et c du §12.7. */
const RATTACHEMENT_SOPHIE = {
	contact_id: '5eed0000-0000-4000-8000-000000000092',
	role: null,
	contacts: {
		id: '5eed0000-0000-4000-8000-000000000092',
		full_name: 'Sophie Dupont',
		organization_id: null,
		organizations: null,
	},
}

describe('lireContactsDeLAffaire', () => {
	it('interroge `card_contacts`, filtre sur la card et trie au PREMIER niveau — §12.3', async () => {
		const { client, appel } = espion({ data: [RATTACHEMENT_LEO], error: null, status: 200 })
		await lireContactsDeLAffaire(client, ID_CARD)
		expect(appel.table).toBe('card_contacts')
		expect(appel.colonnes).toBe(COLONNES_CONTACTS_AFFAIRE)
		expect(appel.filtres).toEqual([`eq(card_id,${ID_CARD})`])
		// LE TRI EST UN ÉCART MESURÉ AVEC LE §11.3 : la fiche d'organisation trie une relation
		// to-MANY, que PostgREST n'accepte que par `referencedTable` ; ici la relation est to-ONE,
		// et `order=contacts(full_name)` trie les RATTACHEMENTS par le nom du contact désigné.
		expect(appel.tris).toEqual([TRI_CONTACTS_AFFAIRE])
		expect(TRI_CONTACTS_AFFAIRE).toBe('contacts(full_name)')
	})

	it("embarque le contact ET son organisation dans la MÊME requête, sans `role_title` — §12.3", () => {
		// L'embarquement tient sur DEUX niveaux, mesuré sans ambiguïté `PGRST201`.
		expect(COLONNES_CONTACTS_AFFAIRE).toContain('contacts(')
		expect(COLONNES_CONTACTS_AFFAIRE).toContain('organizations(id, name)')
		// `role_title` qualifie le contact dans son ORGANISATION ; ce bloc dit son rôle dans CETTE
		// affaire. Les afficher tous deux ferait lire deux « rôles » contradictoires.
		expect(COLONNES_CONTACTS_AFFAIRE).not.toContain('role_title')
		// `created_at` non plus : c'est le fil unifié qui raconte la chronologie d'une affaire.
		expect(COLONNES_CONTACTS_AFFAIRE).not.toContain('created_at')
	})

	it('renomme les relations embarquées et conserve le rôle du RATTACHEMENT', async () => {
		const { client } = espion({
			data: [RATTACHEMENT_LEO, RATTACHEMENT_SOPHIE],
			error: null,
			status: 200,
		})
		const lu = await lireContactsDeLAffaire(client, ID_CARD)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toEqual([
			{
				contactId: '5eed0000-0000-4000-8000-000000000091',
				nom: 'Léo Marchand',
				role: 'decideur',
				organisation: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia' },
			},
			// Cas b et c du §12.7 : ni rôle, ni organisation — `null` des deux côtés, jamais
			// `undefined`, et surtout pas une chaîne de remplacement.
			{
				contactId: '5eed0000-0000-4000-8000-000000000092',
				nom: 'Sophie Dupont',
				role: null,
				organisation: null,
			},
		])
	})

	it('écarte une ligne dont le contact embarqué manque, au lieu de la rendre anonyme', async () => {
		// La FK composite l'interdit en base ; fabriquer une ligne sans nom afficherait une donnée
		// que le modèle ne produit pas.
		const { client } = espion({
			data: [{ contact_id: 'x', role: null, contacts: null }, RATTACHEMENT_LEO],
			error: null,
			status: 200,
		})
		const lu = await lireContactsDeLAffaire(client, ID_CARD)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toHaveLength(1)
	})

	it('rend une liste VIDE sur zéro ligne — l’anonyme reçoit `200` et `[]` (§12.4, mesure 3)', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const lu = await lireContactsDeLAffaire(client, ID_CARD)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees).toEqual([])
	})

	it("classe l'erreur sur le code HTTP, jamais sur le texte — §6.4", async () => {
		const { client } = espion({ data: null, error: { message: 'boom' }, status: 500 })
		const lu = await lireContactsDeLAffaire(client, ID_CARD)
		expect(lu.statut).toBe('erreur')
		if (lu.statut !== 'erreur') return
		expect(lu.erreur.nature).toBe('unknown')
	})
})

describe('classerRefusRattachement', () => {
	it('lit le code PostgreSQL AVANT le code HTTP — 23505 et 23503 rendent tous deux 409', () => {
		// C'est la conséquence 3 du §12.4 : un classement qui commencerait par le statut
		// confondrait « déjà rattaché », qui appelle un autre choix, avec « contact inconnu », qui
		// signale une liste périmée. Les fondre serait la valeur par défaut trompeuse de §18.
		expect(classerRefusRattachement(409, CODE_DOUBLON, 'duplicate key').nature).toBe('deja-rattache')
		expect(classerRefusRattachement(409, CODE_CONTACT_INCONNU, 'fk').nature).toBe('contact-inconnu')
	})

	it('classe le refus de droit, le réseau et l’inattendu — §12.5', () => {
		// MESURÉ : la lectrice qui INSÈRE reçoit `403` et `42501` (mesure 6 du §12.4).
		expect(classerRefusRattachement(403, '42501', 'rls').nature).toBe('forbidden')
		expect(classerRefusRattachement(401, undefined, 'jwt').nature).toBe('forbidden')
		expect(classerRefusRattachement(undefined, undefined, 'offline').nature).toBe('network')
		expect(classerRefusRattachement(0, undefined, 'offline').nature).toBe('network')
		expect(classerRefusRattachement(500, undefined, 'boom').nature).toBe('unknown')
	})

	it('conserve le détail pour le diagnostic, sans jamais le destiner à l’écran', () => {
		expect(classerRefusRattachement(500, undefined, 'boom').detail).toBe('boom')
	})
})

describe('rattacherContact', () => {
	it('insère les quatre colonnes, le workspace étant TRANSMIS et non deviné — §12.3', async () => {
		const { client, appel } = espionEcriture({ data: [{}], error: null, status: 201 })
		const resultat = await rattacherContact(client, {
			idWorkspace: ID_WORKSPACE,
			idCard: ID_CARD,
			idContact: '5eed0000-0000-4000-8000-000000000093',
			role: 'technique',
		})
		expect(resultat.statut).toBe('appliquee')
		expect(appel.table).toBe('card_contacts')
		expect(appel.operation).toBe('insert')
		expect(appel.charge).toEqual({
			workspace_id: ID_WORKSPACE,
			card_id: ID_CARD,
			contact_id: '5eed0000-0000-4000-8000-000000000093',
			role: 'technique',
		})
	})

	it('envoie `null` pour un rôle vide ou blanc, JAMAIS `""` — cas j du §12.7', async () => {
		// MESURÉ (mesure 10 du §12.4) : `role: ""` rend `400` et `23514`, la contrainte
		// `card_contacts_role_check` refusant la chaîne vide. `null` est la valeur qui exprime
		// « pas de rôle », et la colonne l'accepte.
		for (const saisie of ['', '   ']) {
			const { client, appel } = espionEcriture({ data: [{}], error: null, status: 201 })
			await rattacherContact(client, {
				idWorkspace: ID_WORKSPACE,
				idCard: ID_CARD,
				idContact: '5eed0000-0000-4000-8000-000000000093',
				role: saisie,
			})
			expect((appel.charge as { role: string | null }).role).toBeNull()
		}
	})

	it('traduit le doublon et le contact inconnu en refus DISTINCTS — §12.5', async () => {
		const doublon = espionEcriture({
			data: null,
			error: { message: 'duplicate key', code: CODE_DOUBLON },
			status: 409,
		})
		const refusDoublon = await rattacherContact(doublon.client, {
			idWorkspace: ID_WORKSPACE,
			idCard: ID_CARD,
			idContact: '5eed0000-0000-4000-8000-000000000091',
			role: '',
		})
		expect(refusDoublon.statut).toBe('refus')
		if (refusDoublon.statut !== 'refus') return
		expect(refusDoublon.refus.nature).toBe('deja-rattache')

		const inconnu = espionEcriture({
			data: null,
			error: { message: 'fk', code: CODE_CONTACT_INCONNU },
			status: 409,
		})
		const refusInconnu = await rattacherContact(inconnu.client, {
			idWorkspace: ID_WORKSPACE,
			idCard: ID_CARD,
			idContact: '00000000-0000-4000-8000-000000000000',
			role: '',
		})
		expect(refusInconnu.statut).toBe('refus')
		if (refusInconnu.statut !== 'refus') return
		expect(refusInconnu.refus.nature).toBe('contact-inconnu')
	})

	it('ne lève jamais : une exception du client devient un refus réseau', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await rattacherContact(client, {
			idWorkspace: ID_WORKSPACE,
			idCard: ID_CARD,
			idContact: '5eed0000-0000-4000-8000-000000000093',
			role: '',
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('network')
	})
})

describe('detacherContact', () => {
	it('supprime la SEULE ligne du couple, et demande une colonne en retour — §12.4', async () => {
		const { client, appel } = espionEcriture({
			data: [{ contact_id: '5eed0000-0000-4000-8000-000000000091' }],
			error: null,
			status: 200,
		})
		const resultat = await detacherContact(client, ID_CARD, '5eed0000-0000-4000-8000-000000000091')
		expect(resultat.statut).toBe('appliquee')
		expect(appel.operation).toBe('delete')
		expect(appel.filtres).toEqual([
			`eq(card_id,${ID_CARD})`,
			'eq(contact_id,5eed0000-0000-4000-8000-000000000091)',
		])
		// Sans ce `select`, PostgREST ne rend aucun corps et « zéro ligne touchée » n'existerait
		// pas comme réponse : le refus silencieux serait indistinguable d'un succès.
		expect(appel.colonnes).toBe('contact_id')
	})

	it('rend « sans effet » sur zéro ligne — ni un succès, ni une erreur (§12.4, conséquence 1)', async () => {
		// MESURÉ (mesures 12 et 13) : la lectrice qui détache un rattachement EXISTANT reçoit
		// `200` et `[]`, la ligne relue inchangée — indistinguable d'une ligne déjà partie. La
		// clause `USING` filtre AVANT de supprimer, comme celle de `cards_maj` au §4 ter.3.
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		const resultat = await detacherContact(client, ID_CARD, '5eed0000-0000-4000-8000-000000000092')
		expect(resultat.statut).toBe('sans-effet')
	})

	it('traduit une erreur réelle en refus classé', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'permission denied', code: '42501' },
			status: 403,
		})
		const resultat = await detacherContact(client, ID_CARD, '5eed0000-0000-4000-8000-000000000092')
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('forbidden')
	})
})

// @verifies CRM-060 (docs/BACKLOG.md) — sous-tranche 4d
// @verifies docs/SPEC-contacts.md §13.3 (la composition du libellé, EXTRAITE et partagée)
// @verifies docs/DESIGN_SYSTEM.md §5.21, §5.22 (le libellé d'une option est une donnée)
describe('libelleContactAvecOrganisation (§13.3)', () => {
	it('compose « nom — organisation » lorsque le contact en a une : deux homonymes se distinguent', () => {
		expect(
			libelleContactAvecOrganisation({ full_name: 'Léo Marchand', organisation: { name: 'Sogexia' } }),
		).toBe('Léo Marchand — Sogexia')
	})

	it('rend le SEUL nom lorsque le contact n’a pas d’organisation : aucun tiret orphelin', () => {
		expect(libelleContactAvecOrganisation({ full_name: 'Sophie Dupont', organisation: null })).toBe(
			'Sophie Dupont',
		)
	})
})

// ------------------------------------------------------------------------------------------------
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4e
// @verifies docs/SPEC-contacts.md §14.3 (les onze mesures : la charge réellement envoyée, et les
//           facultatifs blancs rendus `null` — JAMAIS `''`, mesures 8 et 9), §14.4 (le
//           dictionnaire fermé des cinq refus, code PostgreSQL AVANT code HTTP, mesures 5 et 10)
//
// CE QUE CE BLOC ÉPROUVE, ET POURQUOI IL ÉPROUVE LA REQUÊTE ET PAS SEULEMENT SA VALEUR : les
// mesures 8 et 9 du §14.3 ont DÉCIDÉ du contrat de saisie — `contacts_email_check` et
// `contacts_phone_check` refusent la chaîne vide en `400` / `23514`. Une implémentation qui
// enverrait `''` rendrait exactement le même résultat qu'ici tant que le serveur est un espion :
// seule l'assertion sur la CHARGE la prend en défaut.

/** Espion de création : `insert().select().single()`, la chaîne exacte de `creerContact`. */
type AppelCreation = { table?: string; charge?: unknown; colonnes?: string; single: boolean }

function espionCreation(reponse: {
	data: unknown
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelCreation } {
	const appel: AppelCreation = { single: false }
	const chaine: Record<string, unknown> = {
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return chaine
		},
		single: () => {
			appel.single = true
			return chaine
		},
		then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: unknown) => {
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** La saisie du formulaire, cinq chaînes — le module normalise, pas l'écran (§14.3). */
const SAISIE_NOM_SEUL = {
	nom: 'Camille Roy',
	idOrganisation: '',
	fonction: '',
	email: '',
	telephone: '',
}

/** La ligne rendue par PostgREST pour une création : la relation y porte le nom de la TABLE. */
const LIGNE_CREEE = {
	id: '5eed0000-0000-4000-8000-0000000000e1',
	full_name: 'Camille Roy',
	email: null,
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
}

describe('classerRefusCreation (§14.4)', () => {
	it('classe sur le CODE POSTGRESQL d’abord : `23505` et `23503` rendent tous deux `409`', () => {
		// MESURES 5 ET 10 : le statut HTTP seul les CONFONDRAIT, alors qu'ils appellent des gestes
		// opposés — corriger l'email, ou relire une liste d'organisations périmée.
		expect(classerRefusCreation(409, CODE_DOUBLON, 'duplicate key').nature).toBe('doublon')
		expect(classerRefusCreation(409, CODE_CONTACT_INCONNU, 'fk').nature).toBe('organisation-inconnue')
		// Le MÊME statut, sans code : rien ne permet de trancher, et l'écran ne devine pas.
		expect(classerRefusCreation(409, undefined, 'conflit').nature).toBe('indisponible')
	})

	it('classe les trois contraintes de forme sous une seule nature — mesures 6 à 9', () => {
		// `contacts_full_name_check`, `contacts_email_check` et `contacts_phone_check` rendent le
		// MÊME code : l'écran dit « la saisie est invalide », le champ fautif restant visible.
		for (const detail of ['contacts_full_name_check', 'contacts_email_check', 'contacts_phone_check']) {
			expect(classerRefusCreation(400, CODE_SAISIE_INVALIDE, detail).nature).toBe('saisie-invalide')
		}
	})

	it('classe `403` / `42501` en `interdit` — mesures 4 et 11, la lectrice et le workspace étranger', () => {
		expect(classerRefusCreation(403, '42501', 'row-level security').nature).toBe('interdit')
		// `401` rejoint `interdit` : une session expirée n'est pas une panne, et l'écran ne
		// distingue pas « pas le droit » de « plus le droit » — les deux appellent le même message.
		expect(classerRefusCreation(401, undefined, 'jwt expired').nature).toBe('interdit')
	})

	it('rend `indisponible` pour tout le reste, sans jamais inventer une sixième nature', () => {
		expect(classerRefusCreation(500, undefined, 'boom').nature).toBe('indisponible')
		expect(classerRefusCreation(undefined, undefined, 'réseau coupé').nature).toBe('indisponible')
	})

	it('conserve le détail SANS l’afficher : il sert au diagnostic, pas à l’interface', () => {
		// `docs/DESIGN_SYSTEM.md` §10 : un message de serveur n'est pas un texte d'interface. Le
		// détail est porté pour le diagnostic ; c'est le dictionnaire fermé qui rend le texte.
		expect(classerRefusCreation(409, CODE_DOUBLON, 'contacts_workspace_email_key').detail).toBe(
			'contacts_workspace_email_key',
		)
	})
})

describe('creerContact (§14.3)', () => {
	it('envoie la charge du §14.3 et demande la LIGNE en retour — table, colonnes, `single`', async () => {
		const { client, appel } = espionCreation({ data: LIGNE_CREEE, error: null, status: 201 })
		const resultat = await creerContact(client, {
			idWorkspace: ID_WORKSPACE,
			saisie: SAISIE_NOM_SEUL,
		})
		expect(resultat.statut).toBe('creee')
		expect(appel.table).toBe('contacts')
		// `source` n'est PAS envoyé : la base pose `manual` par défaut (§14.3, mesure 1). En
		// envoyer un ici figerait dans l'écran une valeur qui appartient au modèle (§2.2).
		expect(appel.charge).toEqual({
			workspace_id: ID_WORKSPACE,
			full_name: 'Camille Roy',
			organization_id: null,
			role_title: null,
			email: null,
			phone: null,
		})
		// Sans ce `select`, PostgREST ne rendrait aucun corps et le carnet devrait RELIRE la liste
		// entière pour montrer la ligne créée (§14.5 cas e) : une seconde requête pour une donnée
		// déjà en main.
		expect(appel.colonnes).toBe(COLONNES_CONTACT_CARNET)
		expect(appel.single).toBe(true)
	})

	it('rend `null` sur un facultatif BLANC, jamais `""` — mesures 8 et 9, qui ont DÉCIDÉ du contrat', async () => {
		// `contacts_email_check` et `contacts_phone_check` refusent la chaîne vide en `400` /
		// `23514` : envoyer `''` transformerait un champ laissé vide en refus serveur.
		const { client, appel } = espionCreation({ data: LIGNE_CREEE, error: null, status: 201 })
		await creerContact(client, {
			idWorkspace: ID_WORKSPACE,
			saisie: { nom: '  Camille Roy  ', idOrganisation: '   ', fonction: ' ', email: '', telephone: '\t' },
		})
		expect(appel.charge).toEqual({
			workspace_id: ID_WORKSPACE,
			// Le nom, lui, est OBLIGATOIRE : il est ébarbé, jamais annulé.
			full_name: 'Camille Roy',
			organization_id: null,
			role_title: null,
			email: null,
			phone: null,
		})
	})

	it('ébarbe les facultatifs RENSEIGNÉS plutôt que de les rejeter — la saisie humaine porte des blancs', async () => {
		const { client, appel } = espionCreation({ data: LIGNE_CREEE, error: null, status: 201 })
		await creerContact(client, {
			idWorkspace: ID_WORKSPACE,
			saisie: {
				nom: 'Camille Roy',
				idOrganisation: ' 5eed0000-0000-4000-8000-000000000081 ',
				fonction: ' Acheteuse ',
				email: ' camille@sogexia.example ',
				telephone: ' +33 1 02 03 04 05 ',
			},
		})
		expect(appel.charge).toEqual({
			workspace_id: ID_WORKSPACE,
			full_name: 'Camille Roy',
			organization_id: '5eed0000-0000-4000-8000-000000000081',
			role_title: 'Acheteuse',
			email: 'camille@sogexia.example',
			phone: '+33 1 02 03 04 05',
		})
	})

	it('renomme la relation embarquée en `organisation` : l’écran ne dépend d’aucun nom de table', async () => {
		const { client } = espionCreation({
			data: {
				...LIGNE_CREEE,
				organization_id: '5eed0000-0000-4000-8000-000000000081',
				organizations: {
					id: '5eed0000-0000-4000-8000-000000000081',
					name: 'Sogexia',
					domain: 'sogexia.example',
				},
			},
			error: null,
			status: 201,
		})
		const resultat = await creerContact(client, {
			idWorkspace: ID_WORKSPACE,
			saisie: { ...SAISIE_NOM_SEUL, idOrganisation: '5eed0000-0000-4000-8000-000000000081' },
		})
		expect(resultat.statut).toBe('creee')
		if (resultat.statut !== 'creee') return
		// C'est cette forme qui permet à la ligne créée de rejoindre le tableau SANS relecture
		// (§14.5 cas e et f) : la cellule d'organisation y trouve son lien.
		expect(resultat.contact.organisation).toEqual({
			id: '5eed0000-0000-4000-8000-000000000081',
			name: 'Sogexia',
			domain: 'sogexia.example',
		})
		expect('organizations' in resultat.contact).toBe(false)
	})

	it('traduit les cinq refus mesurés, et rend la saisie intacte à l’appelant', async () => {
		const cas = [
			{ statut: 403, code: '42501', message: 'row-level security', nature: 'interdit' },
			{ statut: 409, code: CODE_DOUBLON, message: 'contacts_workspace_email_key', nature: 'doublon' },
			{
				statut: 409,
				code: CODE_CONTACT_INCONNU,
				message: 'contacts_organization_id_workspace_id_fkey',
				nature: 'organisation-inconnue',
			},
			{ statut: 400, code: CODE_SAISIE_INVALIDE, message: 'contacts_email_check', nature: 'saisie-invalide' },
			{ statut: 500, code: undefined, message: 'boom', nature: 'indisponible' },
		] as const
		for (const attendu of cas) {
			const { client } = espionCreation({
				data: null,
				error: { message: attendu.message, code: attendu.code },
				status: attendu.statut,
			})
			const resultat = await creerContact(client, {
				idWorkspace: ID_WORKSPACE,
				saisie: SAISIE_NOM_SEUL,
			})
			expect(resultat.statut).toBe('refus')
			if (resultat.statut !== 'refus') return
			expect(resultat.refus.nature).toBe(attendu.nature)
		}
	})

	it('ne lève JAMAIS : une exception du client devient un refus `indisponible`', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await creerContact(client, {
			idWorkspace: ID_WORKSPACE,
			saisie: SAISIE_NOM_SEUL,
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('indisponible')
		// Le message de l'exception est CONSERVÉ pour le diagnostic, jamais affiché (§14.4).
		expect(resultat.refus.detail).toBe('réseau coupé')
	})
})

// @verifies docs/SPEC-contacts.md §14.3 (la règle des facultatifs, PARTAGÉE avec `rattacherContact`)
describe('normaliserFacultatif (§14.3)', () => {
	it('rend `null` sur une saisie blanche, et la valeur ébarbée sinon', () => {
		expect(normaliserFacultatif('')).toBeNull()
		expect(normaliserFacultatif('   ')).toBeNull()
		expect(normaliserFacultatif('\t\n')).toBeNull()
		expect(normaliserFacultatif(' Acheteuse ')).toBe('Acheteuse')
	})
})

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4f — LA FICHE D'UN CONTACT (docs/SPEC-contacts.md §15)
// ----------------------------------------------------------------------------------------------

const ID_LEO = '5eed0000-0000-4000-8000-000000000091'
const ID_CARD_ERP = '5eed0000-0000-4000-8000-0000000000c2'

/**
 * Espion de la fiche de contact : il enregistre en plus le filtre `is`, que la fiche pose pour
 * écarter la corbeille (§15.3). Un espion qui l'ignorerait laisserait passer un code qui aurait
 * oublié ce filtre, et la preuve ne dirait rien de la règle qu'elle prétend tenir.
 */
function espionFicheContact(reponse: Reponse): {
	client: ClientCrm
	appel: { table?: string; colonnes?: string; eq: string[]; is: string[]; tris: unknown[] }
} {
	const appel: { table?: string; colonnes?: string; eq: string[]; is: string[]; tris: unknown[] } = {
		eq: [],
		is: [],
		tris: [],
	}
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: string) => {
			appel.eq.push(`${colonne}=${valeur}`)
			return chaine
		},
		is: (colonne: string, valeur: unknown) => {
			appel.is.push(`${colonne}=${String(valeur)}`)
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

/** Léo Marchand, tel que la pile réelle le rend — mesure 1 du §15.3. */
const LEO_FICHE = {
	id: ID_LEO,
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
	card_contacts: [
		{
			role: 'decideur',
			cards: {
				id: ID_CARD_ERP,
				title: 'Migration ERP Sogexia',
				archived_at: null,
				channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
			},
		},
	],
}

describe('lireFicheContact (§15.3)', () => {
	it('interroge `contacts`, filtre sur `id`, ÉCARTE la corbeille et trie les rattachements', async () => {
		const { client, appel } = espionFicheContact({ data: [LEO_FICHE], error: null, status: 200 })
		await lireFicheContact(client, ID_LEO)
		expect(appel.table).toBe('contacts')
		expect(appel.colonnes).toBe(COLONNES_FICHE_CONTACT)
		expect(appel.eq).toEqual([`id=${ID_LEO}`])
		// LE FILTRE QUI ÉCARTE LA CORBEILLE. Sans lui, une affaire supprimée apparaît — mesuré sur
		// « Saisie erronée » — et la fiche offrirait un lien vers une affaire dont la corbeille est
		// la surface propriétaire (CRM-077).
		expect(appel.is).toEqual([`${CHEMIN_FILTRE_CORBEILLE}=null`])
		expect(appel.tris).toEqual([[TRI_AFFAIRES_FICHE, { referencedTable: TABLE_TRI_AFFAIRES_FICHE }]])
	})

	it("DÉSIGNE la relation ambiguë `cards → channels` au lieu de la contourner — §15.3", () => {
		// MESURÉ : la forme naïve `cards(channels(...))` est refusée par `PGRST201`, deux clés
		// étrangères existant entre `cards` et `channels`. La clé retenue est celle du
		// CLOISONNEMENT, et cette assertion la fige : l'écrire au hasard rendrait la requête
		// rouge sur la pile, mais seule cette preuve dit POURQUOI cette clé-là.
		expect(COLONNES_FICHE_CONTACT).toContain('channels!cards_channel_id_workspace_id_fkey')
		expect(COLONNES_FICHE_CONTACT).not.toContain('cards_channel_id_workflow_id_fkey')
		// `!inner` n'est pas décoratif : sans lui, le filtre rendrait `cards: null` au lieu de
		// retirer la ligne (mesuré).
		expect(COLONNES_FICHE_CONTACT).toContain('cards!inner')
		// `archived_at` est la SEULE colonne de cycle de vie demandée : une affaire archivée reste
		// rendue, son état étant dit (§15.3).
		expect(COLONNES_FICHE_CONTACT).toContain('archived_at')
		// `source` et `created_at` ne sont pas demandés, pour le motif du §10.3.
		expect(COLONNES_FICHE_CONTACT).not.toContain('source')
		expect(COLONNES_FICHE_CONTACT).not.toContain('created_at')
	})

	it('rend le contact, son organisation et ses affaires, adresses comprises — cas a', async () => {
		const { client } = espionFicheContact({ data: [LEO_FICHE], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
		expect(lu.donnees.full_name).toBe('Léo Marchand')
		expect(lu.donnees.organisation?.name).toBe('Sogexia')
		expect(lu.donnees.affaires).toHaveLength(1)
		expect(lu.donnees.affaires[0]).toEqual({
			idCard: ID_CARD_ERP,
			titre: 'Migration ERP Sogexia',
			role: 'decideur',
			archivee: false,
			adresse: `/tracks/conseil-ia/grands-comptes/cards/${ID_CARD_ERP}`,
		})
	})

	it("rend `organisation` nulle quand le contact n'en a aucune — cas b", async () => {
		const sansOrganisation = { ...LEO_FICHE, organization_id: null, organizations: null }
		const { client } = espionFicheContact({ data: [sansOrganisation], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
		expect(lu.donnees.organisation).toBeNull()
	})

	it('rend une liste vide quand aucun rattachement ne revient — cas e et o', async () => {
		// C'est aussi la réponse MESURÉE pour la lectrice sur Léo : les droits fins de `cards`
		// traversent l'embarquement et RETIRENT la ligne. L'écran ne calcule donc aucun droit.
		const sansAffaire = { ...LEO_FICHE, card_contacts: [] }
		const { client } = espionFicheContact({ data: [sansAffaire], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
		expect(lu.donnees.affaires).toEqual([])
	})

	it('rend une liste vide quand la relation est absente ou nulle — jamais une anomalie', async () => {
		for (const brute of [{ ...LEO_FICHE, card_contacts: null }, { ...LEO_FICHE, card_contacts: undefined }]) {
			const { client } = espionFicheContact({ data: [brute], error: null, status: 200 })
			const lu = await lireFicheContact(client, ID_LEO)
			if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
			expect(lu.donnees.affaires).toEqual([])
		}
	})

	it('marque une affaire ARCHIVÉE, et ne marque pas une affaire active — cas f', async () => {
		const archivee = {
			...LEO_FICHE,
			card_contacts: [
				{
					role: null,
					cards: {
						id: '5eed0000-0000-4000-8000-0000000000c8',
						title: 'Contrat cadre 2025',
						archived_at: '2026-03-31T16:00:00+00:00',
						channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
					},
				},
			],
		}
		const { client } = espionFicheContact({ data: [archivee], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
		expect(lu.donnees.affaires[0]?.archivee).toBe(true)
		expect(lu.donnees.affaires[0]?.role).toBeNull()
	})

	it("écarte un rattachement dont les slugs manquent, plutôt que de rendre une ligne morte", async () => {
		const sansSlug = {
			...LEO_FICHE,
			card_contacts: [
				{ role: 'x', cards: { id: 'c', title: 'T', archived_at: null, channels: null } },
			],
		}
		const { client } = espionFicheContact({ data: [sansSlug], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		if (lu.statut !== 'pret' || lu.donnees === null) throw new Error('fiche attendue')
		expect(lu.donnees.affaires).toEqual([])
	})

	it("n'émet AUCUNE requête quand l'identifiant n'a pas la forme d'un uuid — §15.4", async () => {
		const { client, appel } = espionFicheContact({ data: [LEO_FICHE], error: null, status: 200 })
		const lu = await lireFicheContact(client, 'pas-un-uuid')
		expect(appel.table).toBeUndefined()
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') throw new Error('état prêt attendu')
		expect(lu.donnees).toBeNull()
	})

	it('rend `null` sur une réponse vide — inexistant et refusé sont INDISTINGUABLES', async () => {
		const { client } = espionFicheContact({ data: [], error: null, status: 200 })
		const lu = await lireFicheContact(client, ID_LEO)
		if (lu.statut !== 'pret') throw new Error('état prêt attendu')
		expect(lu.donnees).toBeNull()
	})

	it("classe l'erreur sur le code HTTP réellement reçu, et ne lève jamais", async () => {
		const { client } = espionFicheContact({ data: null, error: { message: 'panne' }, status: 500 })
		const lu = await lireFicheContact(client, ID_LEO)
		expect(lu.statut).toBe('erreur')
	})

	it("ne lève pas non plus quand le client jette — le contrat asynchrone tient", async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const lu = await lireFicheContact(client, ID_LEO)
		expect(lu.statut).toBe('erreur')
	})
})

describe('adresseAffaire (§15.3)', () => {
	it("construit l'adresse depuis les slugs EMBARQUÉS, sans requête supplémentaire", () => {
		expect(
			adresseAffaire({
				role: null,
				cards: {
					id: ID_CARD_ERP,
					title: 'Migration ERP Sogexia',
					archived_at: null,
					channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
				},
			}),
		).toBe(`/tracks/conseil-ia/grands-comptes/cards/${ID_CARD_ERP}`)
	})

	it('rend `null` plutôt qu’une adresse partielle quand un slug manque', () => {
		// Un lien vers `/tracks/undefined/...` mènerait à un écran que l'utilisateur croirait
		// cassé : c'est la règle de `lireCheminCard`, tenue ici à l'identique.
		expect(adresseAffaire({ role: null, cards: null })).toBeNull()
		expect(
			adresseAffaire({
				role: null,
				cards: { id: 'c', title: 'T', archived_at: null, channels: { slug: 'x', tracks: null } },
			}),
		).toBeNull()
	})
})

// ================================================================================================
// SOUS-TRANCHE 4g — `modifierContact` (docs/SPEC-contacts.md §16.3 et §16.4)
// ================================================================================================

/**
 * Espion de modification : `update().eq().select().maybeSingle()`, la chaîne EXACTE du module.
 *
 * `maybeSingle` et non `single` : c'est une exigence du §16.3, non un détail d'écriture. Zéro
 * ligne est ici un RÉSULTAT ATTENDU — le refus silencieux —, et `single()` le déguiserait en
 * erreur `PGRST116`, c'est-à-dire en panne. Un espion qui accepterait `single()` laisserait passer
 * un code qui confond un refus avec une avarie.
 */
type AppelModification = {
	table?: string
	charge?: unknown
	colonnes?: string
	filtre?: { colonne: string; valeur: unknown }
	maybeSingle: boolean
}

function espionModification(reponse: {
	data: unknown
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelModification } {
	const appel: AppelModification = { maybeSingle: false }
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtre = { colonne, valeur }
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return chaine
		},
		maybeSingle: () => {
			appel.maybeSingle = true
			return Promise.resolve(reponse)
		},
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				update: (charge: unknown) => {
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

const SAISIE_COMPLETE = {
	nom: '  Léo Marchand-Vasseur  ',
	idOrganisation: '5eed0000-0000-4000-8000-000000000081',
	fonction: 'Directeur général',
	email: 'leo@sogexia.example',
	telephone: '  ',
}

describe('modifierContact (§16.3)', () => {
	it('envoie les CINQ colonnes d’un bloc, sans `workspace_id` ni `source`', async () => {
		const { client, appel } = espionModification({
			data: {
				id: 'c1',
				full_name: 'Léo Marchand-Vasseur',
				email: 'leo@sogexia.example',
				phone: null,
				role_title: 'Directeur général',
				organization_id: '5eed0000-0000-4000-8000-000000000081',
				organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia' },
			},
			error: null,
			status: 200,
		})
		const resultat = await modifierContact(client, { idContact: 'c1', saisie: SAISIE_COMPLETE })

		expect(appel.table).toBe('contacts')
		// LES CINQ COLONNES, ET ELLES SEULES (§16.3, mesures 16 à 18). `workspace_id` n'est jamais
		// envoyé — il n'ouvrirait qu'un refus (mesure 13) —, et `source` appartient au modèle.
		expect(appel.charge).toEqual({
			full_name: 'Léo Marchand-Vasseur',
			organization_id: '5eed0000-0000-4000-8000-000000000081',
			role_title: 'Directeur général',
			email: 'leo@sogexia.example',
			// UN FACULTATIF BLANC VAUT `null`, JAMAIS `''` : les contraintes de forme refusent la
			// chaîne vide (§16.3, mesures 7 et 8).
			phone: null,
		})
		expect(appel.filtre).toEqual({ colonne: 'id', valeur: 'c1' })
		expect(appel.maybeSingle).toBe(true)
		expect(resultat.statut).toBe('modifiee')
		if (resultat.statut !== 'modifiee') throw new Error('modification attendue')
		// L'organisation embarquée revient avec la ligne : la fiche s'actualise SANS relire (§16.7).
		expect(resultat.contact.organisation).toEqual({
			id: '5eed0000-0000-4000-8000-000000000081',
			name: 'Sogexia',
		})
	})

	it('ZÉRO LIGNE et AUCUNE erreur rendent `sans-effet` (§16.3, mesures 3, 12 et 19)', async () => {
		const { client } = espionModification({ data: null, error: null, status: 200 })
		const resultat = await modifierContact(client, { idContact: 'c1', saisie: SAISIE_COMPLETE })
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') throw new Error('refus attendu')
		// C'est CE QUI SÉPARE 4g DE 4e : la clause `USING` de la politique de mise à jour rend la
		// ligne invisible à l'écriture, et PostgREST rend `200` avec un tableau VIDE. Sans cette
		// branche, un refus d'autorisation passerait pour une modification réussie.
		expect(resultat.refus.nature).toBe('sans-effet')
	})

	it('classe les cinq refus d’ERREUR par le code PostgreSQL d’abord (§16.4)', async () => {
		const cas = [
			{ code: '23505', status: 409, nature: 'doublon' },
			{ code: '23503', status: 409, nature: 'organisation-inconnue' },
			{ code: '23514', status: 400, nature: 'saisie-invalide' },
			{ code: undefined, status: 403, nature: 'interdit' },
			{ code: undefined, status: 401, nature: 'interdit' },
			{ code: undefined, status: 500, nature: 'indisponible' },
		] as const
		for (const attendu of cas) {
			const { client } = espionModification({
				data: null,
				error: { message: 'refus', ...(attendu.code === undefined ? {} : { code: attendu.code }) },
				status: attendu.status,
			})
			const resultat = await modifierContact(client, { idContact: 'c1', saisie: SAISIE_COMPLETE })
			if (resultat.statut !== 'refus') throw new Error('refus attendu')
			// `23505` et `23503` rendent TOUS DEUX `409` (mesures 4 et 9) : classer par le statut
			// les confondrait, alors qu'ils appellent des gestes opposés.
			expect(resultat.refus.nature).toBe(attendu.nature)
		}
	})

	it('ne lève jamais : une exception du client devient `indisponible`', async () => {
		const client = {
			from: () => ({
				update: () => {
					throw new Error('réseau coupé')
				},
			}),
		} as unknown as ClientCrm
		const resultat = await modifierContact(client, { idContact: 'c1', saisie: SAISIE_COMPLETE })
		if (resultat.statut !== 'refus') throw new Error('refus attendu')
		expect(resultat.refus.nature).toBe('indisponible')
		expect(resultat.refus.detail).toContain('réseau coupé')
	})
})

// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4h : le rattachement d'une affaire
//           depuis la fiche d'un contact
// @verifies docs/SPEC-contacts.md §17.3 (la lecture du sélecteur : ses colonnes, le filtre qui
//           écarte la CORBEILLE, le tri demandé au serveur, la borne), §17.4 (un refus de lecture
//           est zéro ligne), §17.5 (`workspace_id` porté par la fiche), §17.7 cas d, h, l
// @verifies docs/DESIGN_SYSTEM.md §5.26 (une affaire archivée est offerte, la corbeille non)
describe('lireAffairesRattachables (§17.3)', () => {
	const AFFAIRE = { id: '5eed0000-0000-4000-8000-0000000000c2', title: 'Migration ERP Sogexia', archived_at: null }
	const ARCHIVEE = {
		id: '5eed0000-0000-4000-8000-0000000000c8',
		title: 'Contrat cadre 2025',
		archived_at: '2026-03-31T16:00:00+00:00',
	}

	it('demande les trois colonnes du §17.3, et NI le track NI le channel', async () => {
		const { client, appel } = espion({ data: [AFFAIRE], error: null, status: 200 })
		await lireAffairesRattachables(client)
		expect(appel.table).toBe('cards')
		expect(appel.colonnes).toBe(COLONNES_AFFAIRE_RATTACHABLE)
		// Un sélecteur n'a AUCUNE adresse à construire : il envoie un identifiant. Demander les
		// slugs imposerait la levée d'ambiguïté `PGRST201` du §15.3 pour une donnée que rien
		// n'afficherait, et le §10.3 a posé qu'une requête ne rapporte que ce qui est affiché.
		expect(appel.colonnes).not.toContain('channels')
		expect(appel.colonnes).not.toContain('tracks')
	})

	it('ÉCARTE LES AFFAIRES DE LA CORBEILLE, que la base accepterait pourtant', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireAffairesRattachables(client)
		// MESURÉ (§17.3, mesure 7) : la base rend `201` sur une affaire supprimée. C'est l'ÉCRAN
		// qui l'écarte, la fiche ne listant jamais une affaire en corbeille (§15.3) — le
		// rattachement serait invisible dès sa création. Le filtre est donc une exigence du
		// produit, et sa disparition ne serait rattrapée par aucune assertion de valeur.
		expect(appel.filtres).toContain(`is(${FILTRE_CORBEILLE_AFFAIRE},null)`)
	})

	it('demande le tri au SERVEUR et pose la borne du sélecteur', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireAffairesRattachables(client)
		expect(appel.tris).toEqual([TRI_AFFAIRES_RATTACHABLES])
		expect(appel.filtres).toContain(`limit(${AFFAIRES_RATTACHABLES_MAX})`)
	})

	it('rend une affaire ARCHIVÉE, en la marquant comme telle', async () => {
		const { client } = espion({ data: [AFFAIRE, ARCHIVEE], error: null, status: 200 })
		const lues = await lireAffairesRattachables(client)
		expect(lues.statut).toBe('pret')
		if (lues.statut !== 'pret') return
		// Elle est OFFERTE — la base accepte ce rattachement (mesure 6) —, et son archivage est
		// PORTÉ pour que l'option puisse le dire (§5.26). L'exclure poserait à l'écran une règle
		// de produit que personne n'a prise.
		expect(lues.donnees).toEqual([
			{ id: AFFAIRE.id, titre: 'Migration ERP Sogexia', archivee: false },
			{ id: ARCHIVEE.id, titre: 'Contrat cadre 2025', archivee: true },
		])
	})

	it('rend une liste VIDE sans erreur quand la RLS ne consent aucune ligne', async () => {
		// MESURÉ (§17.4, mesure 17) : l'anonyme reçoit `200` et `[]`, jamais une erreur de
		// privilège. L'écran n'a donc aucun refus de lecture à mettre en scène.
		const { client } = espion({ data: [], error: null, status: 200 })
		const lues = await lireAffairesRattachables(client)
		expect(lues).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe une erreur sur le CODE HTTP réellement reçu, jamais sur le texte', async () => {
		const { client } = espion({ data: null, error: { message: 'boom' }, status: 500 })
		const lues = await lireAffairesRattachables(client)
		expect(lues.statut).toBe('erreur')
	})
})

describe('la fiche porte `workspace_id` depuis 4h (§17.5)', () => {
	it('le demande dans ses colonnes et le rend', async () => {
		const { client, appel } = espion({
			data: [{ ...LEO, workspace_id: '5eed0000-0000-4000-8000-000000000001', card_contacts: [] }],
			error: null,
			status: 200,
		})
		const lue = await lireFicheContact(client, LEO.id)
		expect(appel.colonnes).toContain('workspace_id')
		expect(lue.statut).toBe('pret')
		if (lue.statut !== 'pret' || lue.donnees === null) return
		// La clé composite de `card_contacts` l'exige au rattachement, et le §12.5 a posé qu'elle
		// est TRANSMISE et non devinée. C'est une colonne de plus dans une requête déjà émise,
		// contre une requête entière si on la relisait.
		expect(lue.donnees.workspace_id).toBe('5eed0000-0000-4000-8000-000000000001')
	})
})
