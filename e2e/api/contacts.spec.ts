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
const ORGANISATION_SOGEXIA = '5eed0000-0000-4000-8000-000000000081'  // Sogexia, seule organisation à domaine

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

// ------------------------------------------------------------------------------------------------
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4e
// @verifies docs/SPEC-contacts.md §14.3 (LES ONZE MESURES de l'écriture, relevées à la main le
//           2026-08-18 et figées ici), §14.4 (ce que chaque code appelle comme classement)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus se prouve avec le JETON RÉEL du profil)
// @verifies CLAUDE.md §10 (la règle est backend : l'écran ne fait que traduire ce qu'elle rend)
//
// POURQUOI CE BLOC EXISTE ALORS QUE LA TRANCHE 1 PROUVE DÉJÀ `contacts_insertion` : la tranche 1
// prouve QUI peut écrire. Ce bloc fige ce que l'écriture RÉPOND — et c'est ce qui a décidé du
// contrat de l'écran. Trois réponses en particulier ne se devinent pas :
//
//   * `23505` et `23503` rendent TOUS DEUX `409` (mesures 5 et 10) : le statut HTTP seul les
//     confondrait, alors qu'ils appellent des gestes opposés côté humain ;
//   * la chaîne VIDE est refusée sur `email` et `phone` (mesures 8 et 9), ce qui interdit à
//     l'écran d'envoyer `''` pour un facultatif laissé blanc ;
//   * `source` n'est PAS envoyé et la base pose `manual` (mesure 1).
//
// Si une migration future assouplissait l'une de ces contraintes, c'est ICI que le contrat de
// l'écran deviendrait rouge — et non dans un test unitaire qui simule le serveur.

const ORGANISATION_SEEDEE = '5eed0000-0000-4000-8000-000000000081' // Sogexia
const EMAIL_DEJA_PORTE = 'leo.marchand@sogexia.example' // Léo Marchand, seedé
const WORKSPACE_ETRANGER = '00000000-0000-4000-8000-0000000000ff'
const ORGANISATION_INCONNUE = '00000000-0000-4000-8000-0000000000fe'

test.describe('CRM-060 4e — les onze mesures de la création d’un contact (§14.3)', () => {
	test('1 — l’administratrice crée avec le NOM SEUL : 201, `source` = `manual`, organisation nulle', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const sonde = await creerSonde()
		try {
			const reponse = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { workspace_id: WORKSPACE_SEED, full_name: 'Sonde 4e mesure 1' },
			})
			expect(reponse.status()).toBe(201)
			const [ligne] = (await reponse.json()) as [
				{ id: string; source: string; organization_id: string | null; email: string | null },
			]
			sonde.contactsSupprimes.push(ligne.id)
			// C'EST CETTE MESURE qui autorise l'écran à ne pas envoyer `source` : la base le pose.
			expect(ligne.source).toBe('manual')
			expect(ligne.organization_id).toBeNull()
			expect(ligne.email).toBeNull()
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('2 — nom + organisation du workspace : 201, la ligne porte son organisation', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const sonde = await creerSonde()
		try {
			const reponse = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					full_name: 'Sonde 4e mesure 2',
					organization_id: ORGANISATION_SEEDEE,
				},
			})
			expect(reponse.status()).toBe(201)
			const [ligne] = (await reponse.json()) as [{ id: string; organization_id: string }]
			sonde.contactsSupprimes.push(ligne.id)
			expect(ligne.organization_id).toBe(ORGANISATION_SEEDEE)
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('3 — le `business_developer` crée aussi : l’écriture n’est PAS réservée à l’administration', async ({
		request,
	}) => {
		// C'est la mesure qui justifie qu'aucune commande ne soit grisée selon le rôle (§14.6) :
		// deux profils sur trois écrivent, et l'écran ne saurait pas lequel sans demander.
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const sonde = await creerSonde()
		try {
			const reponse = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					full_name: 'Sonde 4e mesure 3',
					email: 'sonde-4e-mesure-3@exemple.test',
				},
			})
			expect(reponse.status()).toBe(201)
			const [ligne] = (await reponse.json()) as [{ id: string; email: string }]
			sonde.contactsSupprimes.push(ligne.id)
			expect(ligne.email).toBe('sonde-4e-mesure-3@exemple.test')
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('4 — LA LECTRICE est refusée : 403 / 42501, et AUCUNE ligne n’est écrite', async ({
		request,
	}) => {
		const jeton = await jetonDe('viewer@p2enjoy.test')
		const nom = 'Sonde 4e mesure 4'
		const reponse = await request.post('/rest/v1/contacts', {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE_SEED, full_name: nom },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')
		// DÉCISION 70 : un refus se constate sur la BASE, pas sur le code de réponse. La relecture
		// emploie la clé de service — la lectrice ne verrait rien de toute façon, et un « zéro
		// ligne » sous son propre jeton ne distinguerait pas un refus d'écriture d'un refus de
		// lecture.
		const relecture = await request.get(
			`/rest/v1/contacts?full_name=eq.${encodeURIComponent(nom)}`,
			{ headers: enTetesService() },
		)
		expect(await relecture.json()).toEqual([])
	})

	test('5 — email DÉJÀ PORTÉ, casse différente : 409 / 23505, l’unicité ignore la casse', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const nom = 'Sonde 4e mesure 5'
		const reponse = await request.post('/rest/v1/contacts', {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				full_name: nom,
				email: EMAIL_DEJA_PORTE.toUpperCase(),
			},
		})
		expect(reponse.status()).toBe(409)
		const erreur = (await reponse.json()) as { code: string; message: string }
		// LE CODE, PAS LE STATUT : la mesure 10 rend le MÊME 409 pour une cause opposée.
		expect(erreur.code).toBe('23505')
		expect(erreur.message).toContain('contacts_workspace_email_key')
		const relecture = await request.get(
			`/rest/v1/contacts?full_name=eq.${encodeURIComponent(nom)}`,
			{ headers: enTetesService() },
		)
		expect(await relecture.json()).toEqual([])
	})

	test('6 à 9 — les quatre contraintes de FORME rendent 400 / 23514', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		// LES MESURES 8 ET 9 ONT DÉCIDÉ DU CONTRAT DE SAISIE : un facultatif blanc ne peut pas
		// s'envoyer comme `''`. C'est pourquoi `normaliserFacultatif` rend `null`.
		const cas = [
			{ mesure: 6, contrainte: 'contacts_full_name_check', charge: { full_name: '   ' } },
			{ mesure: 7, contrainte: 'contacts_email_check', charge: { full_name: 'Sonde 4e mesure 7', email: 'pasunemail' } },
			{ mesure: 8, contrainte: 'contacts_email_check', charge: { full_name: 'Sonde 4e mesure 8', email: '' } },
			{ mesure: 9, contrainte: 'contacts_phone_check', charge: { full_name: 'Sonde 4e mesure 9', phone: '' } },
		]
		for (const attendu of cas) {
			const reponse = await request.post('/rest/v1/contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { workspace_id: WORKSPACE_SEED, ...attendu.charge },
			})
			expect(reponse.status(), `mesure ${attendu.mesure}`).toBe(400)
			const erreur = (await reponse.json()) as { code: string; message: string }
			expect(erreur.code, `mesure ${attendu.mesure}`).toBe('23514')
			expect(erreur.message, `mesure ${attendu.mesure}`).toContain(attendu.contrainte)
		}
		// Aucune des quatre n'a laissé de trace : les sondes 7 à 9 portent un nom reconnaissable.
		const relecture = await request.get('/rest/v1/contacts?full_name=like.Sonde%204e%20mesure*', {
			headers: enTetesService(),
		})
		expect(await relecture.json()).toEqual([])
	})

	test('10 — organisation INCONNUE : 409 / 23503, le MÊME statut que le doublon', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const nom = 'Sonde 4e mesure 10'
		const reponse = await request.post('/rest/v1/contacts', {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				full_name: nom,
				organization_id: ORGANISATION_INCONNUE,
			},
		})
		// C'EST LA MESURE QUI JUSTIFIE LE CLASSEMENT PAR CODE (§14.4) : même `409` que la mesure 5,
		// cause opposée — une liste d'organisations périmée, et non un email à corriger.
		expect(reponse.status()).toBe(409)
		const erreur = (await reponse.json()) as { code: string; message: string }
		expect(erreur.code).toBe('23503')
		expect(erreur.message).toContain('contacts_organization_id')
		const relecture = await request.get(
			`/rest/v1/contacts?full_name=eq.${encodeURIComponent(nom)}`,
			{ headers: enTetesService() },
		)
		expect(await relecture.json()).toEqual([])
	})

	test('11 — `workspace_id` ÉTRANGER : 403 / 42501, c’est le `WITH CHECK` qui refuse', async ({
		request,
	}) => {
		// L'administratrice a bien le droit d'écrire — dans SON workspace. Le refus ne porte donc
		// pas sur le rôle mais sur la cible, et il rend le même couple que la lectrice : l'écran
		// n'a aucune raison de les distinguer, les deux disent « pas ici » (§14.4).
		const jeton = await jetonDe('admin@p2enjoy.test')
		const nom = 'Sonde 4e mesure 11'
		const reponse = await request.post('/rest/v1/contacts', {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE_ETRANGER, full_name: nom },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')
		const relecture = await request.get(
			`/rest/v1/contacts?full_name=eq.${encodeURIComponent(nom)}`,
			{ headers: enTetesService() },
		)
		expect(await relecture.json()).toEqual([])
	})

	test('le SEED est rendu INTACT : ses trois contacts, et aucune sonde survivante', async ({
		request,
	}) => {
		// Ce scénario est la garde du §14.8 : les onze mesures écrivent, et une sonde oubliée
		// fausserait tous les compteurs du dépôt — ceux du carnet, ceux des harnais, ceux du seed.
		const relecture = await request.get('/rest/v1/contacts?select=full_name&order=full_name', {
			headers: enTetesService(),
		})
		const noms = ((await relecture.json()) as Array<{ full_name: string }>).map((c) => c.full_name)
		// L'ORDRE EST CELUI DE LA COLLATION DE LA BASE, mesuré et non supposé : « Élise » précède
		// « Léo ». C'est le même ordre que `Carnet.test.tsx` fige depuis la sous-tranche 4a, et
		// c'est bien le serveur qui trie (`order=full_name`), jamais ce fichier.
		expect(noms).toEqual(['Élise Fabre', 'Léo Marchand', 'Sophie Dupont'])
	})
})

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4f — LA LECTURE DE LA FICHE D'UN CONTACT (docs/SPEC-contacts.md §15)
// ----------------------------------------------------------------------------------------------
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4f
// @verifies docs/SPEC-contacts.md §15.3 (les quatre mesures qui ont décidé de la requête),
//           §15.4 (les sept mesures d'autorisation, et les droits fins qui traversent
//           l'embarquement)
//
// CES SCÉNARIOS NE MODIFIENT RIEN. La fiche ne livre aucune écriture (§15.8) : ils lisent le seed
// avec les jetons réels et le laissent tel quel — aucune sonde, donc aucune garde de restauration
// à poser ici, contrairement aux onze mesures de 4e juste au-dessus.

const ID_LEO = '5eed0000-0000-4000-8000-000000000091'
const ID_SOPHIE = '5eed0000-0000-4000-8000-000000000092'
const ID_ELISE = '5eed0000-0000-4000-8000-000000000093'
const ID_SOGEXIA_SEED = '5eed0000-0000-4000-8000-000000000081'
const ID_CARD_ERP = '5eed0000-0000-4000-8000-0000000000c2'

/** La sélection EXACTE que `lireFicheContact` émet — figée ici, et non recomposée. */
const SELECT_FICHE_CONTACT =
	'id,full_name,email,phone,role_title,organization_id,' +
	'organizations(id,name,domain),' +
	'card_contacts(role,cards!inner(id,title,archived_at,' +
	'channels!cards_channel_id_workspace_id_fkey(slug,tracks(slug))))'

/** L'adresse complète de la fiche, filtre de corbeille et tri compris. */
function adresseFiche(idContact: string): string {
	return (
		`/rest/v1/contacts?id=eq.${idContact}&select=${encodeURIComponent(SELECT_FICHE_CONTACT)}` +
		'&card_contacts.cards.deleted_at=is.null&card_contacts.order=cards(title)'
	)
}

type LigneFiche = {
	id: string
	full_name: string
	organizations: { id: string; name: string } | null
	card_contacts: Array<{
		role: string | null
		cards: { id: string; title: string; archived_at: string | null; channels: { slug: string; tracks: { slug: string } } }
	}>
}

test.describe('CRM-060 sous-tranche 4f — la fiche d’un contact (docs/SPEC-contacts.md §15)', () => {
	test('l’embarquement `cards → channels` est AMBIGU sans clé nommée : PGRST201', async ({
		request,
	}) => {
		// C'EST LA MESURE QUI A DÉCIDÉ DE LA REQUÊTE (§15.3), et elle est figée ici parce qu'elle
		// ne se devine pas : deux clés étrangères relient `cards` et `channels`, et la forme naïve
		// que produirait un embarquement écrit « comme d'habitude » est REFUSÉE. Sans ce scénario,
		// un futur remaniement retirerait la clé nommée en croyant simplifier.
		const jeton = await jetonDe('admin@p2enjoy.test')
		const naive = 'card_contacts(role,cards(id,channels(slug)))'
		const reponse = await request.get(
			`/rest/v1/contacts?id=eq.${ID_LEO}&select=${encodeURIComponent(naive)}`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(300)
		const erreur = (await reponse.json()) as { code: string }
		expect(erreur.code).toBe('PGRST201')
	})

	test('1 — l’administratrice lit la fiche entière en UNE requête, slugs compris', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.get(adresseFiche(ID_LEO), {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneFiche[]
		expect(lignes).toHaveLength(1)
		const leo = lignes[0]!
		expect(leo.full_name).toBe('Léo Marchand')
		expect(leo.organizations?.name).toBe('Sogexia')
		expect(leo.organizations?.id).toBe(ID_SOGEXIA_SEED)
		expect(leo.card_contacts).toHaveLength(1)
		const rattachement = leo.card_contacts[0]!
		expect(rattachement.role).toBe('decideur')
		expect(rattachement.cards.id).toBe(ID_CARD_ERP)
		expect(rattachement.cards.title).toBe('Migration ERP Sogexia')
		// LES SLUGS SONT LÀ, et c'est tout l'enjeu de la clé nommée : l'adresse d'une affaire
		// s'en déduit sans les trois requêtes en cascade de `lireCheminCard`.
		expect(rattachement.cards.channels.slug).toBe('grands-comptes')
		expect(rattachement.cards.channels.tracks.slug).toBe('conseil-ia')
	})

	test('2 — un identifiant inexistant rend 200 et []', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.get(adresseFiche('00000000-0000-4000-8000-000000000000'), {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('3 — l’ANONYME reçoit 200 et [] : un refus est zéro ligne, jamais une erreur', async ({
		request,
	}) => {
		const reponse = await request.get(adresseFiche(ID_LEO), { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('4 — un identifiant MAL FORMÉ rend 400 / 22P02 : la règle du contrôle de forme', async ({
		request,
	}) => {
		// C'est cette mesure qui impose à l'écran de contrôler la forme AVANT d'émettre : un `400`
		// classé en erreur donnerait une commande de reprise morte, sur une adresse que
		// l'utilisateur édite lui-même (§15.4).
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.get(adresseFiche('pas-un-uuid'), {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as { code: string; message: string }
		expect(erreur.code).toBe('22P02')
		expect(erreur.message).toContain('invalid input syntax for type uuid')
	})

	test('5 — le `business_developer` lit la fiche et son affaire', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const lignes = (await (
			await request.get(adresseFiche(ID_LEO), { headers: enTetesAuthentifies(jeton) })
		).json()) as LigneFiche[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]!.card_contacts).toHaveLength(1)
	})

	test('6 et 7 — LES DROITS FINS TRAVERSENT L’EMBARQUEMENT : la lectrice ne voit pas l’affaire de Léo, mais voit celle de Sophie', async ({
		request,
	}) => {
		// LA MESURE DÉCISIVE DU §15.4. Le track « Conseil IA » est fermé à la lectrice (CRM-012) :
		// la ligne de rattachement est RETIRÉE, et non rendue avec une affaire nulle. C'est ce qui
		// autorise l'écran à ne calculer AUCUN droit — il rend ce que le backend consent.
		const jeton = await jetonDe('viewer@p2enjoy.test')
		const chezLeo = (await (
			await request.get(adresseFiche(ID_LEO), { headers: enTetesAuthentifies(jeton) })
		).json()) as LigneFiche[]
		expect(chezLeo).toHaveLength(1)
		expect(chezLeo[0]!.full_name).toBe('Léo Marchand')
		expect(chezLeo[0]!.card_contacts).toEqual([])

		const chezSophie = (await (
			await request.get(adresseFiche(ID_SOPHIE), { headers: enTetesAuthentifies(jeton) })
		).json()) as LigneFiche[]
		expect(chezSophie[0]!.card_contacts).toHaveLength(1)
		expect(chezSophie[0]!.card_contacts[0]!.cards.title).toBe('Refonte intranet Ville de Lyon')
	})

	test('un contact SANS organisation rend `organizations: null`, jamais une clé absente', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const lignes = (await (
			await request.get(adresseFiche(ID_SOPHIE), { headers: enTetesAuthentifies(jeton) })
		).json()) as LigneFiche[]
		expect(lignes[0]!.organizations).toBeNull()
	})

	test('un contact SANS affaire rend une liste vide — l’état vide du §15.9 cas e', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const lignes = (await (
			await request.get(adresseFiche(ID_ELISE), { headers: enTetesAuthentifies(jeton) })
		).json()) as LigneFiche[]
		expect(lignes[0]!.full_name).toBe('Élise Fabre')
		expect(lignes[0]!.card_contacts).toEqual([])
	})

	test('une affaire à la CORBEILLE est écartée par le serveur, pas par l’écran', async ({
		request,
	}) => {
		// LA MESURE QUI A DÉCIDÉ DU FILTRE (§15.3). Le scénario pose lui-même le cas — le seed ne
		// rattache aucun contact à une affaire supprimée — puis le retire, et il vérifie LES DEUX
		// côtés : sans le filtre l'affaire apparaît, avec lui elle disparaît. Sans la première
		// moitié, la preuve ne dirait pas que le filtre SERT à quelque chose.
		const idCardSupprimee = '5eed0000-0000-4000-8000-0000000000c9'
		const workspace = '5eed0000-0000-4000-8000-000000000001'
		await request.post('/rest/v1/card_contacts', {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: { workspace_id: workspace, card_id: idCardSupprimee, contact_id: ID_ELISE, role: 'sonde-4f' },
		})
		try {
			const sansFiltre = (await (
				await request.get(
					`/rest/v1/contacts?id=eq.${ID_ELISE}&select=${encodeURIComponent('card_contacts(role,cards(id,title,deleted_at))')}`,
					{ headers: enTetesService() },
				)
			).json()) as Array<{ card_contacts: Array<{ cards: { deleted_at: string | null } }> }>
			expect(sansFiltre[0]!.card_contacts).toHaveLength(1)
			expect(sansFiltre[0]!.card_contacts[0]!.cards.deleted_at).not.toBeNull()

			const avecFiltre = (await (
				await request.get(adresseFiche(ID_ELISE), { headers: enTetesService() })
			).json()) as LigneFiche[]
			expect(avecFiltre[0]!.card_contacts).toEqual([])
		} finally {
			// La sonde est retirée quoi qu'il arrive : une sonde oubliée fausserait le carnet, les
			// harnais et la garde de convergence du seed.
			await request.delete('/rest/v1/card_contacts?role=eq.sonde-4f', {
				headers: enTetesService(),
			})
		}
	})

	test('le SEED est rendu INTACT après 4f : trois contacts, deux rattachements', async ({
		request,
	}) => {
		const contacts = (await (
			await request.get('/rest/v1/contacts?select=full_name&order=full_name', {
				headers: enTetesService(),
			})
		).json()) as Array<{ full_name: string }>
		expect(contacts.map((c) => c.full_name)).toEqual([
			'Élise Fabre',
			'Léo Marchand',
			'Sophie Dupont',
		])
		const rattachements = (await (
			await request.get('/rest/v1/card_contacts?select=contact_id,role', {
				headers: enTetesService(),
			})
		).json()) as Array<{ role: string | null }>
		expect(rattachements).toHaveLength(2)
		expect(rattachements.map((r) => r.role).sort()).toEqual(['decideur', 'prescripteur'])
	})
})

// ================================================================================================
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4g : la MODIFICATION d'un contact
// @verifies docs/SPEC-contacts.md §16.3 (les vingt et une mesures d'écriture), §16.4 (les six
//           natures de refus), §16.6 (l'écran ne calcule aucun droit)
// @verifies docs/SPEC-permissions-rls.md §7 (une écriture refusée par `USING` ne produit AUCUNE
//           erreur : la ligne est relue et constatée INCHANGÉE — décision 70)
//
// CES SCÉNARIOS FIGENT LE SILENCE. La politique `contacts_maj_bizdev_admin` porte une clause
// `USING` : une ligne que l'appelant ne peut pas écrire lui est INVISIBLE à l'écriture, et
// PostgREST rend `200` avec un tableau VIDE. Ce n'est pas une erreur, et c'est précisément ce qui
// doit être prouvé — un produit qui prendrait ce silence pour un succès laisserait croire à la
// lectrice qu'elle a modifié un contact.
// ================================================================================================

/** Crée un contact sonde avec la clé de SERVICE — jamais employée pour prouver un refus (déc. 50). */
async function contactSonde(
	request: APIRequestContext,
	sonde: Sonde,
	champs: Record<string, unknown>,
): Promise<{ id: string }> {
	const reponse = await request.post('/rest/v1/contacts', {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { workspace_id: WORKSPACE_SEED, ...champs },
	})
	expect(reponse.status()).toBe(201)
	const [ligne] = (await reponse.json()) as [{ id: string }]
	sonde.contactsSupprimes.push(ligne.id)
	return ligne
}

test.describe('CRM-060 4g — la modification d’un contact (§16.3)', () => {
	test('1 et 2 — l’administratrice et le business_developer modifient : 200, ligne rendue', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4g mesures 1 et 2' })
			for (const [adresse, valeur] of [
				['admin@p2enjoy.test', 'Sonde 4g renommée par l’admin'],
				['bizdev@p2enjoy.test', 'Sonde 4g renommée par le bizdev'],
			] as const) {
				const jeton = await jetonDe(adresse)
				const reponse = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { full_name: valeur },
				})
				expect(reponse.status()).toBe(200)
				const lignes = (await reponse.json()) as Array<{ full_name: string }>
				// L'ÉCRITURE N'EST PAS RÉSERVÉE À L'ADMINISTRATION : la politique nomme les deux rôles.
				expect(lignes).toHaveLength(1)
				expect(lignes[0]?.full_name).toBe(valeur)
			}
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('3 et 19 — LA LECTRICE REÇOIT `200` ET `[]` : le refus est SILENCIEUX, la ligne INCHANGÉE', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, {
				full_name: 'Sonde 4g mesure 3',
				role_title: 'Fonction d’origine',
			})
			const jeton = await jetonDe('viewer@p2enjoy.test')

			// Mesure 3 — sur la sonde.
			const reponse = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { full_name: 'Écrit par la lectrice', role_title: 'Fonction usurpée' },
			})
			// AUCUNE ERREUR, ET C'EST TOUT LE POINT : la clause `USING` rend la ligne invisible à
			// l'écriture au lieu de rejeter la requête. Un `403` serait plus simple à lire ; ce
			// n'est pas ce que le serveur rend, et le produit doit vivre avec ce qui est mesuré.
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			// LA LIGNE EST RELUE ET CONSTATÉE INCHANGÉE (décision 70) : sans cette relecture, le
			// scénario prouverait seulement que la réponse est vide, pas que rien n'a été écrit.
			const relecture = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}&select=full_name,role_title`,
				{ headers: enTetesService() },
			)
			expect(await relecture.json()).toEqual([
				{ full_name: 'Sonde 4g mesure 3', role_title: 'Fonction d’origine' },
			])

			// Mesure 19 — sur une ligne DU SEED, pour que le silence ne tienne pas à la sonde.
			const surLeo = await request.patch(
				'/rest/v1/contacts?id=eq.5eed0000-0000-4000-8000-000000000091',
				{
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { role_title: 'Écrit par la lectrice' },
				},
			)
			expect(surLeo.status()).toBe(200)
			expect(await surLeo.json()).toEqual([])
			const leo = await request.get(
				'/rest/v1/contacts?id=eq.5eed0000-0000-4000-8000-000000000091&select=full_name,role_title',
				{ headers: enTetesService() },
			)
			// LE SEED EST INTACT : Léo Marchand a gardé sa fonction.
			expect(await leo.json()).toEqual([
				{ full_name: 'Léo Marchand', role_title: 'Directeur achats' },
			])
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('12 — un identifiant INEXISTANT rend le MÊME `200` et `[]` que le refus', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.patch(
			'/rest/v1/contacts?id=eq.5eed0000-0000-4000-8000-0000000000ee',
			{
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { full_name: 'Fantôme' },
			},
		)
		// INDISTINGUABLE DE LA MESURE 3, par construction et non par accident : c'est ce qui impose
		// UN SEUL message côté écran (§16.4), qui n'affirme ni le refus ni la disparition.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('4 à 9 — les refus de FORME et d’UNICITÉ, classés par le code PostgreSQL', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4g refus' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const cas = [
				// Mesure 4 : l'email de Léo, dans une AUTRE CASSE — l'unicité est insensible à la casse.
				{ envoi: { email: 'LEO.MARCHAND@sogexia.example' }, statut: 409, code: '23505' },
				// Mesure 5 : un nom entièrement blanc.
				{ envoi: { full_name: '   ' }, statut: 400, code: '23514' },
				// Mesure 6 : un email malformé.
				{ envoi: { email: 'pasunemail' }, statut: 400, code: '23514' },
				// Mesures 7 et 8 : la CHAÎNE VIDE, qui décide du contrat de saisie de l'écran.
				{ envoi: { email: '' }, statut: 400, code: '23514' },
				{ envoi: { phone: '' }, statut: 400, code: '23514' },
				// Mesure 9 : une organisation inconnue — `409` comme la 4, code DIFFÉRENT.
				{
					envoi: { organization_id: '5eed0000-0000-4000-8000-0000000000ff' },
					statut: 409,
					code: '23503',
				},
			]
			for (const attendu of cas) {
				const reponse = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: attendu.envoi,
				})
				expect(reponse.status()).toBe(attendu.statut)
				expect(((await reponse.json()) as { code: string }).code).toBe(attendu.code)
			}
			// LES DEUX `409` PORTENT DES CODES DIFFÉRENTS : c'est la mesure qui impose de classer sur
			// le code PostgreSQL et non sur le statut HTTP (§16.4).
			const relecture = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}&select=full_name,email,phone,organization_id`,
				{ headers: enTetesService() },
			)
			expect(await relecture.json()).toEqual([
				{ full_name: 'Sonde 4g refus', email: null, phone: null, organization_id: null },
			])
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('16 et 17 — la ligne REPREND SON PROPRE email : l’unicité ne s’oppose pas à elle-même', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, {
				full_name: 'Sonde 4g unicité',
				email: 'sonde4g.unicite@exemple.test',
			})
			const jeton = await jetonDe('admin@p2enjoy.test')
			// CES DEUX MESURES DÉCIDENT DE LA CHARGE ENVOYÉE PAR L'ÉCRAN (§16.3) : puisque la ligne
			// peut réécrire son propre email, même en changeant la casse, le formulaire envoie les
			// cinq colonnes d'un bloc au lieu de calculer un différentiel.
			for (const email of ['sonde4g.unicite@exemple.test', 'SONDE4G.Unicite@Exemple.test']) {
				const reponse = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { full_name: 'Sonde 4g unicité', email, role_title: null, phone: null },
				})
				expect(reponse.status()).toBe(200)
				expect(((await reponse.json()) as Array<{ email: string }>)[0]?.email).toBe(email)
			}
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('10, 11 et 15 — l’organisation se retient puis se détache, et `updated_at` bouge', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4g organisation' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const avant = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}&select=created_at,updated_at`,
				{ headers: enTetesService() },
			)
			const [horodatages] = (await avant.json()) as [{ created_at: string; updated_at: string }]

			// Mesure 10 : l'organisation embarquée revient PEUPLÉE — la fiche s'actualise sans relire.
			const attachee = await request.patch(
				`/rest/v1/contacts?id=eq.${contact.id}&select=id,organizations(id,name)`,
				{
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { organization_id: ORGANISATION_SOGEXIA },
				},
			)
			expect(attachee.status()).toBe(200)
			expect(
				((await attachee.json()) as Array<{ organizations: { name: string } | null }>)[0]
					?.organizations?.name,
			).toBe('Sogexia')

			// Mesure 11 : détachée, elle revient NULLE — c'est le cas h du §16.9.
			const detachee = await request.patch(
				`/rest/v1/contacts?id=eq.${contact.id}&select=id,organizations(id,name)`,
				{
					headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
					data: { organization_id: null },
				},
			)
			expect(detachee.status()).toBe(200)
			expect(
				((await detachee.json()) as Array<{ organizations: unknown }>)[0]?.organizations,
			).toBeNull()

			// Mesure 15 : le trigger `updated_at` agit, et `created_at` ne bouge pas.
			const apres = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}&select=created_at,updated_at`,
				{ headers: enTetesService() },
			)
			const [apresHorodatages] = (await apres.json()) as [
				{ created_at: string; updated_at: string },
			]
			expect(apresHorodatages.created_at).toBe(horodatages.created_at)
			expect(new Date(apresHorodatages.updated_at).getTime()).toBeGreaterThan(
				new Date(horodatages.updated_at).getTime(),
			)
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('13 et 14 — le `workspace_id` étranger et l’anonyme sont refusés EXPLICITEMENT', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4g refus explicites' })

			// Mesure 13 : c'est le `WITH CHECK` de la politique, et il rend un `403` — contrairement
			// au refus par `USING`, qui est silencieux. Les deux voies coexistent sur la même
			// politique, et l'écran n'emprunte JAMAIS celle-ci : il n'envoie pas `workspace_id`.
			const jeton = await jetonDe('admin@p2enjoy.test')
			const etranger = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { workspace_id: '5eed0000-0000-4000-8000-0000000000aa' },
			})
			expect(etranger.status()).toBe(403)
			expect(((await etranger.json()) as { code: string }).code).toBe('42501')

			// Mesure 14 : l'anonyme n'a même pas le privilège de table.
			const anonyme = await request.patch(`/rest/v1/contacts?id=eq.${contact.id}`, {
				headers: { ...enTetesAnonymes(), Prefer: 'return=representation' },
				data: { full_name: 'Anonyme' },
			})
			expect(anonyme.status()).toBe(401)

			const relecture = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}&select=full_name,workspace_id`,
				{ headers: enTetesService() },
			)
			expect(await relecture.json()).toEqual([
				{ full_name: 'Sonde 4g refus explicites', workspace_id: WORKSPACE_SEED },
			])
		} finally {
			await nettoyer(request, sonde)
		}
	})
})

// ================================================================================================
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4h : le RATTACHEMENT d'une affaire
//           depuis la fiche d'un contact
// @verifies docs/SPEC-contacts.md §17.3 (ce que le sélecteur lit, et les trois mesures qui l'ont
//           décidé), §17.4 (les huit mesures d'autorisation), §17.5 (la charge envoyée)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne ; chaque refus
//           d'écriture RELIT la ligne pour la constater inchangée — décision 70)
//
// CES SCÉNARIOS FIGENT L'ÉCART AVEC 4g. Une INSERTION est filtrée par la clause `WITH CHECK`, qui
// REJETTE la ligne : le refus est un `403` EXPLICITE. Une mise à jour l'est par `USING`, qui rend
// la ligne invisible et produit `200` avec zéro ligne SANS erreur. Écrire ici un « sans effet »
// décrirait une issue que la base ne produit pas, et ces mesures le prouvent.
// ================================================================================================

/** « Contrat cadre 2025 » : la seule affaire ARCHIVÉE du seed, sur le track « Grands comptes ». */
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
/** « Saisie erronée » : la seule affaire du seed EN CORBEILLE. */
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'
/** « Migration ERP Sogexia », où Léo Marchand est DÉJÀ rattaché par le seed. */
const CARD_ERP = '5eed0000-0000-4000-8000-0000000000c2'
const CONTACT_LEO = '5eed0000-0000-4000-8000-000000000091'

/** Compte les rattachements d'une affaire, avec la clé de service — pour CONSTATER, jamais refuser. */
async function rattachementsDe(
	request: APIRequestContext,
	cardId: string,
	contactId: string,
): Promise<unknown[]> {
	const reponse = await request.get(
		`/rest/v1/card_contacts?card_id=eq.${cardId}&contact_id=eq.${contactId}&select=card_id,contact_id,role`,
		{ headers: enTetesService() },
	)
	return (await reponse.json()) as unknown[]
}

test.describe('CRM-060 4h — le rattachement d’une affaire depuis la fiche (§17.4)', () => {
	test('15, 16 et 17 — ce que le sélecteur LIT : 40 pour l’admin, 35 pour la lectrice, 0 pour l’anonyme', async ({
		request,
	}) => {
		const chemin = '/rest/v1/cards?select=id,title,archived_at&deleted_at=is.null&order=title&limit=200'

		const jetonAdmin = await jetonDe('admin@p2enjoy.test')
		const admin = await request.get(chemin, { headers: enTetesAuthentifies(jetonAdmin) })
		expect(admin.status()).toBe(200)
		const vuesAdmin = (await admin.json()) as Array<{ id: string; title: string; archived_at: string | null }>
		// LA CORBEILLE EST ÉCARTÉE PAR LE FILTRE, et c'est ce que le sélecteur exige : la fiche ne
		// liste jamais une affaire supprimée (§15.3), et un rattachement posé sur l'une d'elles
		// serait invisible dès sa création (§17.3).
		expect(vuesAdmin.map((card) => card.id)).not.toContain(CARD_CORBEILLE)
		// UNE AFFAIRE ARCHIVÉE EST BIEN RENDUE : la base accepte son rattachement (mesure 6), et
		// l'exclure poserait une règle de produit que personne n'a prise.
		expect(vuesAdmin.filter((card) => card.archived_at !== null).map((card) => card.title)).toEqual([
			'Contrat cadre 2025',
		])

		// LES DROITS FINS DE `cards` TRAVERSENT CETTE LECTURE, sans que l'écran calcule rien : la
		// lectrice, à qui « Grands comptes » est fermé, en voit STRICTEMENT MOINS — et aucune
		// archivée, la seule vivant sur ce track.
		const jetonLectrice = await jetonDe('viewer@p2enjoy.test')
		const lectrice = await request.get(chemin, { headers: enTetesAuthentifies(jetonLectrice) })
		expect(lectrice.status()).toBe(200)
		const vuesLectrice = (await lectrice.json()) as Array<{ id: string; archived_at: string | null }>
		expect(vuesLectrice.length).toBeLessThan(vuesAdmin.length)
		expect(vuesLectrice.filter((card) => card.archived_at !== null)).toEqual([])

		// Mesure 17 : l'anonyme reçoit `200` et `[]` — zéro ligne, JAMAIS une erreur de privilège.
		const anonyme = await request.get(chemin, { headers: enTetesAnonymes() })
		expect(anonyme.status()).toBe(200)
		expect(await anonyme.json()).toEqual([])
	})

	test('6 — une affaire ARCHIVÉE accepte le rattachement : 201, et rien ne s’y oppose', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h archivée' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: CARD_ARCHIVEE,
					contact_id: contact.id,
					role: 'sponsor',
				},
			})
			sonde.rattachementsSupprimes.push({ cardId: CARD_ARCHIVEE, contactId: contact.id })
			// C'EST LA MESURE QUI DÉCIDE QUE LE SÉLECTEUR LES OFFRE (§17.3). L'écart avec
			// `lireCardsClassables` est réel : `classify_message` refuse une affaire archivée par
			// `card_not_available`, ici RIEN ne la refuse.
			expect(reponse.status()).toBe(201)
			expect(await rattachementsDe(request, CARD_ARCHIVEE, contact.id)).toHaveLength(1)
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('7 — une affaire EN CORBEILLE l’accepte AUSSI : c’est l’écran qui l’écarte, pas la base', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h corbeille' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: CARD_CORBEILLE,
					contact_id: contact.id,
					role: null,
				},
			})
			sonde.rattachementsSupprimes.push({ cardId: CARD_CORBEILLE, contactId: contact.id })
			// LA MESURE QUI FONDE LE FILTRE DU §17.3, et il faut qu'elle reste vraie : le jour où la
			// base refuserait ce rattachement, le filtre de l'écran cesserait d'être une décision de
			// produit pour devenir une redondance, et ce scénario le dirait.
			expect(reponse.status()).toBe(201)

			// ET VOICI POURQUOI L'ÉCRAN L'ÉCARTE : la fiche du contact ne le montre JAMAIS, le
			// serveur écartant les affaires en corbeille de sa lecture (§15.3). Le rattachement
			// existe en base et reste invisible — l'utilisateur aurait agi sans rien voir changer.
			const fiche = await request.get(
				`/rest/v1/contacts?id=eq.${contact.id}` +
					'&select=id,card_contacts(role,cards!inner(id,title))' +
					'&card_contacts.cards.deleted_at=is.null',
				{ headers: enTetesAuthentifies(jeton) },
			)
			const [lue] = (await fiche.json()) as [{ card_contacts: unknown[] }]
			expect(lue.card_contacts).toEqual([])
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('8 — un doublon rend 409 / 23505, et la ligne d’origine est INCHANGÉE', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		// Léo est rattaché à « Migration ERP Sogexia » par le seed, avec le rôle `decideur`.
		const reponse = await request.post('/rest/v1/card_contacts', {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				card_id: CARD_ERP,
				contact_id: CONTACT_LEO,
				role: 'tentative de doublon',
			},
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as { code: string }).code).toBe('23505')
		// LE REFUS RELIT LA LIGNE ET LA CONSTATE INCHANGÉE (décision 70) : le rôle du seed n'a pas
		// été écrasé par la tentative.
		expect(await rattachementsDe(request, CARD_ERP, CONTACT_LEO)).toEqual([
			{ card_id: CARD_ERP, contact_id: CONTACT_LEO, role: 'decideur' },
		])
	})

	test('9 — LA LECTRICE REÇOIT UN 403 EXPLICITE, et non le silence de la modification', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h lectrice' })
			const jeton = await jetonDe('viewer@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: CARD_SEEDEE_4,
					contact_id: contact.id,
					role: null,
				},
			})
			// C'EST L'ÉCART QUI SÉPARE 4h DE 4g, ET IL EST STRUCTUREL. `card_contacts_insertion`
			// filtre par `WITH CHECK`, qui REJETTE la ligne — statut et code sont explicites. La
			// modification d'un contact filtre par `USING`, qui rend `200` et zéro ligne SANS
			// erreur (§16.3, mesure 3). L'écran n'a donc aucun « sans effet » à dire ici.
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')
			// Le refus RELIT : aucune ligne n'a été créée (décision 70).
			expect(await rattachementsDe(request, CARD_SEEDEE_4, contact.id)).toEqual([])
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('10 — le business developer RÉUSSIT : le geste n’est pas un geste d’administration', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h bizdev' })
			const jeton = await jetonDe('bizdev@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: CARD_SEEDEE_1,
					contact_id: contact.id,
					role: 'contact technique',
				},
			})
			sonde.rattachementsSupprimes.push({ cardId: CARD_SEEDEE_1, contactId: contact.id })
			// La politique porte sur le DROIT D'ÉCRITURE DE L'AFFAIRE, jamais sur un rôle de
			// workspace : c'est pourquoi aucune commande de l'écran n'est éteinte selon le rôle.
			expect(reponse.status()).toBe(201)
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('11 — un rôle CHAÎNE VIDE est refusé par la base : 400 / 23514', async ({ request }) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h rôle vide' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: CARD_SEEDEE_1,
					contact_id: contact.id,
					role: '',
				},
			})
			// C'EST CE QUI EXIGE QUE `rattacherContact` TRADUISE UN RÔLE VIDE EN `null` (§17.5).
			// Ce n'est PAS une garde de saisie doublant la base : c'est le choix de la valeur qui
			// exprime « pas de rôle ».
			expect(reponse.status()).toBe(400)
			expect(((await reponse.json()) as { code: string }).code).toBe('23514')
			expect(await rattachementsDe(request, CARD_SEEDEE_1, contact.id)).toEqual([])
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('12 — une affaire INEXISTANTE rend le MÊME 403 qu’un droit manquant, jamais 23503', async ({
		request,
	}) => {
		const sonde = await creerSonde()
		try {
			const contact = await contactSonde(request, sonde, { full_name: 'Sonde 4h affaire absente' })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.post('/rest/v1/card_contacts', {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					card_id: '5eed0000-0000-4000-8000-0000000000ff',
					contact_id: contact.id,
					role: null,
				},
			})
			// CETTE MESURE FERME UNE NATURE DE REFUS. `app.can_write_card` rend faux pour une
			// affaire qui n'existe pas, si bien que `WITH CHECK` rejette la ligne AVANT que la clé
			// étrangère ne soit éprouvée : le code `23503` — que le §12.5 distingue parce que le
			// CONTACT y était la variable — est INATTEIGNABLE depuis cette surface, où c'est
			// l'AFFAIRE qui varie. Les deux causes sont indistinguables, et un seul message les
			// couvre (§17.4).
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')
		} finally {
			await nettoyer(request, sonde)
		}
	})

	test('le seed est rendu INTACT : deux rattachements, leurs valeurs d’origine', async ({
		request,
	}) => {
		const reponse = await request.get(
			'/rest/v1/card_contacts?select=card_id,contact_id,role&order=contact_id',
			{ headers: enTetesService() },
		)
		expect(await reponse.json()).toEqual([
			{ card_id: CARD_ERP, contact_id: CONTACT_LEO, role: 'decideur' },
			{
				card_id: CARD_SEEDEE_4,
				contact_id: '5eed0000-0000-4000-8000-000000000092',
				role: 'prescripteur',
			},
		])
	})
})
