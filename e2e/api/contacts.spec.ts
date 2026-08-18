// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 1
// @verifies docs/SPEC-contacts.md §3 (autorisations), §4 (contrat d'API, lignes a à p)
// @verifies docs/SPEC-permissions-rls.md §4 (ligne contacts/organizations), §7 (preuves de refus)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend AVEC LES JETONS RÉELS des trois profils seedés obtenus par
// la véritable route de connexion. Aucun navigateur n'est lancé : la tranche 1 ne livre aucun
// écran, seuls le modèle et ses règles.
//
// TROIS PIÈGES, hérités des unités précédentes et actifs ici aussi :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit AUCUNE erreur :
//     PostgREST rend `200`/`204` sans modifier. Tout refus d'autorisation relit donc la ligne
//     et la constate INCHANGÉE (décision 70) ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise.
//     Les tables reçoivent des lignes témoins insérées avec la clé de service AVANT chaque test
//     de refus, la clé n'étant JAMAIS employée pour prouver un refus (décision 50) ;
//   * chaque scénario qui écrit NETTOIE derrière lui, y compris en cas d'échec — un scénario en
//     échec laisserait la base dans un état que les suivants prendraient pour le contrat.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const CARD_SEEDEE_1  = '5eed0000-0000-4000-8000-0000000000c1'  // Refonte du site vitrine (grands-comptes)
const CARD_SEEDEE_4  = '5eed0000-0000-4000-8000-0000000000c4'  // Refonte intranet Ville de Lyon (refonte)

type Sonde = {
	organizationsSupprimees: string[]
	contactsSupprimes: string[]
	rattachementsSupprimes: Array<{ cardId: string; contactId: string }>
}

async function creerSonde(): Promise<Sonde> {
	return { organizationsSupprimees: [], contactsSupprimes: [], rattachementsSupprimes: [] }
}

async function nettoyer(request: APIRequestContext, sonde: Sonde): Promise<void> {
	// La clé de service contourne la RLS : pour PURGER, elle est acceptable (décision 50 :
	// jamais employée pour prouver un refus).
	for (const paire of sonde.rattachementsSupprimes) {
		await request.delete(
			`/rest/v1/card_contacts?card_id=eq.${paire.cardId}&contact_id=eq.${paire.contactId}`,
			{ headers: enTetesService() },
		)
	}
	for (const id of sonde.contactsSupprimes) {
		await request.delete(`/rest/v1/contacts?id=eq.${id}`, { headers: enTetesService() })
	}
	for (const id of sonde.organizationsSupprimees) {
		await request.delete(`/rest/v1/organizations?id=eq.${id}`, { headers: enTetesService() })
	}
}

test.describe('CRM-060 — contacts et organisations, tranche 1 : le contrat', () => {
	test.describe('a-d — organisations : les quatre profils, une seule règle', () => {
		test('a — l’administratrice crée une organisation (201)', async ({ request }) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const reponse = await request.post('/rest/v1/organizations', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, name: 'Acme SA' },
				})
				expect(reponse.status()).toBe(201)
				const [ligne] = (await reponse.json()) as [{ id: string; name: string }]
				expect(ligne.name).toBe('Acme SA')
				sonde.organizationsSupprimees.push(ligne.id)
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('b — le business developer crée une organisation (201)', async ({ request }) => {
			const jeton = await jetonDe('bizdev@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const reponse = await request.post('/rest/v1/organizations', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, name: 'Bizdev SARL' },
				})
				expect(reponse.status()).toBe(201)
				const [ligne] = (await reponse.json()) as [{ id: string }]
				sonde.organizationsSupprimees.push(ligne.id)
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('c — la lectrice se voit refuser la création (403 / 42501)', async ({ request }) => {
			const jeton = await jetonDe('viewer@p2enjoy.test')
			const reponse = await request.post('/rest/v1/organizations', {
				headers: enTetesAuthentifies(jeton),
				data: { workspace_id: WORKSPACE_SEED, name: 'Refus viewer' },
			})
			expect(reponse.status()).toBe(403)
			const corps = (await reponse.json()) as { code?: string }
			expect(corps.code).toBe('42501')
		})

		test('d — l’anonyme se voit refuser la création (401)', async ({ request }) => {
			const reponse = await request.post('/rest/v1/organizations', {
				headers: enTetesAnonymes(),
				data: { workspace_id: WORKSPACE_SEED, name: 'Refus anonyme' },
			})
			// PostgREST rend 401 sur POST sans jeton contre une table à RLS pour INSERT réservé.
			expect([401, 403]).toContain(reponse.status())
		})
	})

	test.describe('e — unicité partielle du domaine par workspace', () => {
		test('e — la seconde insertion du même domaine est refusée (409 / 23505)', async ({
			request,
		}) => {
			// La contrainte de forme du §2.1 refuse les majuscules dans un domaine : c'est la
			// convention RFC 1035, et la base stocke la forme canonique. L'unicité `lower(domain)`
			// reste une défense en profondeur ; la casse-insensibilité elle-même se prouve à
			// l'ÉCRITURE par le refus 23514 (contrainte), et à l'UNICITÉ par cette assertion.
			const jeton = await jetonDe('admin@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const premier = await request.post('/rest/v1/organizations', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, name: 'Un', domain: 'exemple-unicite.test' },
				})
				expect(premier.status()).toBe(201)
				const [{ id }] = (await premier.json()) as [{ id: string }]
				sonde.organizationsSupprimees.push(id)

				const second = await request.post('/rest/v1/organizations', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, name: 'Deux', domain: 'exemple-unicite.test' },
				})
				expect(second.status()).toBe(409)
				const corps = (await second.json()) as { code?: string }
				expect(corps.code).toBe('23505')
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('e bis — un domaine avec majuscules est refusé par la CONTRAINTE (400 / 23514)', async ({
			request,
		}) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const refus = await request.post('/rest/v1/organizations', {
				headers: enTetesAuthentifies(jeton),
				data: { workspace_id: WORKSPACE_SEED, name: 'Casse', domain: 'EXEMPLE.test' },
			})
			expect(refus.status()).toBeGreaterThanOrEqual(400)
			const corps = (await refus.json()) as { code?: string }
			expect(corps.code).toBe('23514')
		})
	})

	test.describe('f-i — contacts : la même règle, plus la forme', () => {
		test('f — le bizdev crée un contact avec email (201)', async ({ request }) => {
			const jeton = await jetonDe('bizdev@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const reponse = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Céline Nova', email: 'celine@nova.test' },
				})
				expect(reponse.status()).toBe(201)
				const [ligne] = (await reponse.json()) as [{ id: string; email: string; source: string }]
				expect(ligne.email).toBe('celine@nova.test')
				expect(ligne.source).toBe('manual')
				sonde.contactsSupprimes.push(ligne.id)
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('g — le bizdev crée un contact SANS email (201) — email facultatif', async ({ request }) => {
			const jeton = await jetonDe('bizdev@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const reponse = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Sans Email' },
				})
				expect(reponse.status()).toBe(201)
				const [ligne] = (await reponse.json()) as [{ id: string; email: string | null }]
				expect(ligne.email).toBeNull()
				sonde.contactsSupprimes.push(ligne.id)
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('h — deux emails identiques à la casse près sont refusés (409 / 23505)', async ({ request }) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const premier = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'X', email: 'unicite-api@exemple.test' },
				})
				expect(premier.status()).toBe(201)
				const [{ id }] = (await premier.json()) as [{ id: string }]
				sonde.contactsSupprimes.push(id)

				const second = await request.post('/rest/v1/contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Y', email: 'UNICITE-API@Exemple.Test' },
				})
				expect(second.status()).toBe(409)
				const corps = (await second.json()) as { code?: string }
				expect(corps.code).toBe('23505')
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('i — un `full_name` vide est refusé (contrainte de valeur)', async ({ request }) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.post('/rest/v1/contacts', {
				headers: enTetesAuthentifies(jeton),
				data: { workspace_id: WORKSPACE_SEED, full_name: '   ' },
			})
			// PostgREST rend un `4xx` sur un CHECK. Le code SQL est `23514`.
			expect(reponse.status()).toBeGreaterThanOrEqual(400)
			const corps = (await reponse.json()) as { code?: string }
			expect(corps.code).toBe('23514')
		})
	})

	test.describe('j — cloisonnement structurel', () => {
		test('j — un contact pointant une organisation d’un autre workspace est refusé (409 / 23503)', async ({
			request,
		}) => {
			// Fabriquer un second workspace jetable avec la clé de service (fixture, pas un test
			// d'autorisation), y créer une organisation, puis essayer depuis le workspace seedé.
			const wsB = crypto.randomUUID()
			await request.post('/rest/v1/workspaces', {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				data: { id: wsB, name: 'Workspace jetable', slug: `ws-${wsB.slice(0, 8)}` },
			})
			const orgReponse = await request.post('/rest/v1/organizations', {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { workspace_id: wsB, name: 'Org du workspace B' },
			})
			const [{ id: orgB }] = (await orgReponse.json()) as [{ id: string }]
			try {
				const jeton = await jetonDe('admin@p2enjoy.test')
				const refus = await request.post('/rest/v1/contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Fuite', organization_id: orgB },
				})
				expect(refus.status()).toBe(409)
				const corps = (await refus.json()) as { code?: string }
				expect(corps.code).toBe('23503')
			} finally {
				await request.delete(`/rest/v1/organizations?id=eq.${orgB}`, { headers: enTetesService() })
				await request.delete(`/rest/v1/workspaces?id=eq.${wsB}`,        { headers: enTetesService() })
			}
		})
	})

	test.describe('k-l — lecture par les membres, refus par zéro ligne pour l’anonyme', () => {
		test('k — la lectrice lit les contacts de son workspace (200)', async ({ request }) => {
			// Insertion témoin par la clé de service (fixture, pas un test d'écriture).
			const sonde = await creerSonde()
			const insertion = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { workspace_id: WORKSPACE_SEED, full_name: 'Témoin lectrice', email: 'temoin-l@exemple.test' },
			})
			const [{ id }] = (await insertion.json()) as [{ id: string }]
			sonde.contactsSupprimes.push(id)
			try {
				const jeton = await jetonDe('viewer@p2enjoy.test')
				const lecture = await request.get(`/rest/v1/contacts?id=eq.${id}&select=id,full_name`, {
					headers: enTetesAuthentifies(jeton),
				})
				expect(lecture.status()).toBe(200)
				const lignes = (await lecture.json()) as Array<{ id: string; full_name: string }>
				expect(lignes).toHaveLength(1)
				expect(lignes[0]!.full_name).toBe('Témoin lectrice')
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('l — l’anonyme lit `contacts` : 200 et [] (zéro ligne, jamais une erreur)', async ({
			request,
		}) => {
			// On garantit qu'AU MOINS UNE ligne existe côté service (sinon un `[]` sur table vide
			// serait vrai que la RLS refuse ou qu'elle autorise tout — décision 50).
			const sonde = await creerSonde()
			const insertion = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { workspace_id: WORKSPACE_SEED, full_name: 'Témoin anonyme', email: 'temoin-a@exemple.test' },
			})
			const [{ id }] = (await insertion.json()) as [{ id: string }]
			sonde.contactsSupprimes.push(id)
			try {
				const anonyme = await request.get('/rest/v1/contacts?select=id', {
					headers: enTetesAnonymes(),
				})
				expect(anonyme.status()).toBe(200)
				const lignes = await anonyme.json()
				expect(lignes).toEqual([])
			} finally {
				await nettoyer(request, sonde)
			}
		})
	})

	test.describe('m-o — card_contacts : composition can_read_card / can_write_card', () => {
		test('m — le bizdev rattache un contact à une affaire de son workspace (201)', async ({ request }) => {
			const jeton = await jetonDe('bizdev@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const contactReponse = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Rattaché m' },
				})
				const [{ id: contactId }] = (await contactReponse.json()) as [{ id: string }]
				sonde.contactsSupprimes.push(contactId)

				const rattachement = await request.post('/rest/v1/card_contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, card_id: CARD_SEEDEE_4, contact_id: contactId, role: 'decideur' },
				})
				expect(rattachement.status()).toBe(201)
				sonde.rattachementsSupprimes.push({ cardId: CARD_SEEDEE_4, contactId })
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('n — la lectrice, fermée sur `grands-comptes`, se voit refuser le rattachement (403 / 42501)', async ({
			request,
		}) => {
			// Un contact témoin, créé par la clé de service. La lectrice tente le rattachement
			// vers une card d'un track fermé (grands-comptes, decision seed).
			const sonde = await creerSonde()
			const contact = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { workspace_id: WORKSPACE_SEED, full_name: 'Témoin refus n' },
			})
			const [{ id: contactId }] = (await contact.json()) as [{ id: string }]
			sonde.contactsSupprimes.push(contactId)
			try {
				const jeton = await jetonDe('viewer@p2enjoy.test')
				const refus = await request.post('/rest/v1/card_contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, card_id: CARD_SEEDEE_1, contact_id: contactId },
				})
				expect(refus.status()).toBe(403)
				const corps = (await refus.json()) as { code?: string }
				expect(corps.code).toBe('42501')
				// Relecture : rien n'a été inséré (décision 70).
				const relecture = await request.get(
					`/rest/v1/card_contacts?card_id=eq.${CARD_SEEDEE_1}&contact_id=eq.${contactId}`,
					{ headers: enTetesService() },
				)
				expect(await relecture.json()).toEqual([])
			} finally {
				await nettoyer(request, sonde)
			}
		})

		test('o — la même paire (card, contact) n’entre pas deux fois (409 / 23505)', async ({ request }) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const contact = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'Double' },
				})
				const [{ id: contactId }] = (await contact.json()) as [{ id: string }]
				sonde.contactsSupprimes.push(contactId)

				const premier = await request.post('/rest/v1/card_contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, card_id: CARD_SEEDEE_4, contact_id: contactId },
				})
				expect(premier.status()).toBe(201)
				sonde.rattachementsSupprimes.push({ cardId: CARD_SEEDEE_4, contactId })

				const second = await request.post('/rest/v1/card_contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, card_id: CARD_SEEDEE_4, contact_id: contactId },
				})
				expect(second.status()).toBe(409)
				const corps = (await second.json()) as { code?: string }
				expect(corps.code).toBe('23505')
			} finally {
				await nettoyer(request, sonde)
			}
		})
	})

	test.describe('p — cascade sur suppression de contact', () => {
		test('p — supprimer un contact emporte ses `card_contacts` (204, la liaison disparaît)', async ({
			request,
		}) => {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const sonde = await creerSonde()
			try {
				const contact = await request.post('/rest/v1/contacts', {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { workspace_id: WORKSPACE_SEED, full_name: 'À supprimer p' },
				})
				const [{ id: contactId }] = (await contact.json()) as [{ id: string }]
				const rattachement = await request.post('/rest/v1/card_contacts', {
					headers: enTetesAuthentifies(jeton),
					data: { workspace_id: WORKSPACE_SEED, card_id: CARD_SEEDEE_4, contact_id: contactId },
				})
				expect(rattachement.status()).toBe(201)

				const suppression = await request.delete(`/rest/v1/contacts?id=eq.${contactId}`, {
					headers: enTetesAuthentifies(jeton),
				})
				expect([204, 200]).toContain(suppression.status())

				// La liaison a disparu (cascade).
				const relecture = await request.get(
					`/rest/v1/card_contacts?contact_id=eq.${contactId}`,
					{ headers: enTetesService() },
				)
				expect(await relecture.json()).toEqual([])
			} finally {
				// Nettoyage défensif : le contact est déjà parti, mais on tente au cas où.
				await nettoyer(request, sonde)
			}
		})
	})

	test('inventaire : les trois profils seedés se connectent', async () => {
		// Sanity — si un profil ne se connecte plus, tout le reste échouerait avec un message
		// obscur ; ce sanity le rend explicite.
		for (const compte of COMPTES_SEED) {
			const jeton = await jetonDe(compte.adresse)
			expect(typeof jeton).toBe('string')
			expect(jeton.length).toBeGreaterThan(0)
		}
	})
})
