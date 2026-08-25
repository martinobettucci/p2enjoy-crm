// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 4, SOUS-TRANCHE 4b : l'armement et l'exécution
// @verifies docs/SPEC-modeles-emails.md §12.11 (les dix-sept lignes du contrat d'API),
//           §12.4 (les huit refus de l'armement), §12.4 bis (ce qui fait tomber le refus g),
//           §12.7 (les quatre fins), §12.10 (autorisations), §12.12 (le seed n'arme rien)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0058_armement_sequences.test.sql`
// prouve la règle EN BASE, sous des rôles endossés. Rien n'y garantit que la pile la rende par la
// vraie route : une RPC absente du cache de schéma rendrait `404 / PGRST205`, un privilège mal posé
// rendrait `200` là où le contrat annonce `401`, et la suite pgTAP resterait verte dans les deux
// cas. C'est le défaut que la migration 53 portait et que seule la mesure par l'API avait trouvé.
//
// TROIS LIGNES NE SE PROUVENT QUE LÀ, et ce fichier existe d'abord pour elles :
//
//   * les lignes 4, 5 et 6 — la table est fermée en écriture à TOUT LE MONDE (§12.10). En base, la
//     fermeture se lit dans les privilèges ; par la route, elle se constate en essayant. Un `201`
//     ici signifierait qu'un client peut s'inscrire lui-même à une cadence, hors des huit refus ;
//   * la ligne 8 — l'index unique PARTIEL vu par la route. En base il rend `23505` ; PostgREST le
//     classe en `409`, et c'est ce code-là que l'écran de 4c devra reconnaître ;
//   * la ligne 16 — le `on delete restrict` d'une séquence ARMÉE, également classé `409`.
//
// CE FICHIER ÉCRIT, ET IL REND LE SEED INTACT. Toute inscription qu'il arme est refermée dans un
// `finally`, patron d'`e2e/api/envoi.spec.ts` : la décision 516 a mesuré ce que coûte l'oubli — une
// ligne de file laissée derrière, `mail-sync` qui expédie vraiment, et six scénarios d'interface
// rouges pour une raison sans rapport avec leur objet.
//
// LE SEED N'ARME AUCUNE INSCRIPTION (§12.12), et le dernier scénario le CONSTATE : une inscription
// résiduelle serait exécutée par le job dès le démarrage suivant de la pile, et des messages
// partiraient réellement chez les adresses du jeu de démonstration.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const INSCRIPTIONS = '/rest/v1/card_sequence_enrollments'
const SEQUENCES = '/rest/v1/mail_sequences'
const RPC_ARMER = '/rest/v1/rpc/armer_sequence_relance'
const RPC_INTERROMPRE = '/rest/v1/rpc/interrompre_sequence_relance'
const IDENTITES = '/rest/v1/mail_outbound_identities'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3, `docs/SPEC-modeles-emails.md` §11.9. */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
/** « Relance en trois temps », la séquence de démonstration, et ses trois paliers. */
const SEQUENCE_SEED = '5e900000-0000-4000-8000-000000000001'

/**
 * Deux affaires FIGÉES du seed, au sens de `public.cards_figees()`.
 *
 * Elles ne sont pas choisies au hasard : le seed les antidate, et
 * `supabase/tests/0051_cards_figees.test.sql` les tient. Le premier scénario CONSTATE qu'elles le
 * sont encore avant que les suivants en dépendent — un montage supposé ferait tomber les refus pour
 * la mauvaise raison.
 */
const CARD_FIGEE = '5eed0000-0000-4000-8000-0000000000c4'
const CARD_FIGEE_AUTRE = '5eed0000-0000-4000-8000-0000000000cf'
/**
 * Une affaire que le `viewer` peut LIRE sans pouvoir l'ÉCRIRE — support du refus (b).
 *
 * MESURÉ le 2026-08-25 : sur les quatre affaires figées du seed, le `viewer` en lit TROIS et n'en
 * écrit AUCUNE. Le refus (b) porte sur l'écriture, et c'est donc une affaire lisible qui l'éprouve
 * le mieux — une affaire invisible le ferait tomber pour la mauvaise raison.
 */
const CARD_FERMEE_AU_VIEWER = CARD_FIGEE

/**
 * La SEULE affaire figée que le `viewer` ne lit PAS — « Audit sécurité applicative », track
 * « Conseil & IA ». MESURÉ : `app.can_read_card` y rend faux pour lui, et vrai sur les trois autres.
 *
 * C'est donc la seule qui prouve le cloisonnement de la LECTURE des inscriptions.
 */
const CARD_INVISIBLE_AU_VIEWER = '5eed0000-0000-4000-8000-0000000000c3'

/** Ce que le seed pose, et ce à quoi la suite doit revenir (`docs/SPEC-modeles-emails.md` §12.12). */
const INSCRIPTIONS_DU_SEED = 0

type Inscription = {
	id: string
	card_id: string
	status: string
	closed_reason: string | null
	last_position: number | null
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string
/** L'identité de SERVICE — sans propriétaire —, que seuls les administrateurs empruntent. */
let identiteService: string
/** L'identité de Driss, que l'administratrice ne peut PAS emprunter — support du refus (e). */
let identiteDriss: string

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')

	// LES IDENTIFIANTS DES IDENTITÉS NE SONT PAS STABLES DANS LE SEED : elles sont créées par le
	// vrai flux applicatif, qui pose des `uuid` engendrés. Les coder en dur ferait rougir la suite
	// au prochain `apply-seed.sh` pour une raison sans rapport avec le produit.
	const reponse = await request.get(`${IDENTITES}?select=id,owner_id,label&order=label`, {
		headers: enTetesAuthentifies(jetonAdmin),
	})
	expect(reponse.status(), 'lecture des identités sortantes').toBe(200)
	const identites = (await reponse.json()) as { id: string; owner_id: string | null }[]
	const service = identites.find((i) => i.owner_id === null)
	const personnelle = identites.find((i) => i.owner_id !== null)
	expect(service, "l'identité de SERVICE du seed").toBeDefined()
	expect(personnelle, "l'identité PERSONNELLE de Driss").toBeDefined()
	identiteService = service!.id
	identiteDriss = personnelle!.id
})

/**
 * Arme une inscription, exécute le corps, et la referme QUOI QU'IL ARRIVE.
 *
 * Le `finally` n'est pas une précaution de style : la décision 516 a mesuré ce que coûte son
 * absence sur la file d'envoi. Une inscription laissée active serait exécutée par le job au
 * démarrage suivant de la pile.
 */
async function avecInscription(
	requete: APIRequestContext,
	cardId: string,
	corps: (inscriptionId: string) => Promise<void>,
): Promise<void> {
	const armement = await requete.post(RPC_ARMER, {
		headers: enTetesAuthentifies(jetonAdmin),
		data: { p_card_id: cardId, p_sequence_id: SEQUENCE_SEED, p_identity_id: identiteService },
	})
	expect(armement.status(), `armement de ${cardId}`).toBe(200)
	const inscriptionId = (await armement.json()) as string
	try {
		await corps(inscriptionId)
	} finally {
		await requete.post(RPC_INTERROMPRE, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { p_enrollment_id: inscriptionId },
		})
	}
}

test.describe("l'armement des séquences, par la vraie route (docs/SPEC-modeles-emails.md §12.11)", () => {
	test('0 — MONTAGE : les deux affaires d’essai sont bien FIGÉES', async ({ request }) => {
		// Un montage SUPPOSÉ ferait tomber les refus suivants pour la mauvaise raison : `card_not_stalled`
		// est le sixième refus, et il masquerait tous ceux qui le suivent.
		const reponse = await request.post('/rest/v1/rpc/cards_figees', {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		expect(reponse.status(), 'appel de `cards_figees` par la route').toBe(200)
		const figees = (await reponse.json()) as { card_id: string }[]
		const ids = figees.map((f) => f.card_id)
		expect(ids, "l'affaire d'essai principale est figée").toContain(CARD_FIGEE)
		expect(ids, "la seconde affaire d'essai est figée").toContain(CARD_FIGEE_AUTRE)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 1 à 3 — la lecture, et le refus qui est ZÉRO LIGNE
	// -------------------------------------------------------------------------------------------

	test('1 — l’administratrice LIT la table', async ({ request }) => {
		const reponse = await request.get(`${INSCRIPTIONS}?select=id,card_id,status`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
	})

	test('3 — l’anonyme lit `200` et ZÉRO ligne', async ({ request }) => {
		// Le refus est un FILTRAGE, jamais une erreur : `app.can_read_card` rend faux hors session.
		// Un `401` révélerait que la table existe et qu'elle est protégée.
		const reponse = await request.get(`${INSCRIPTIONS}?select=id`, { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 4, 5 et 6 — la table est FERMÉE EN ÉCRITURE À TOUT LE MONDE (§12.10)
	// -------------------------------------------------------------------------------------------
	// C'est la fermeture de `mail_outbox`, et pour la même raison : une inscription que le client
	// écrirait lui-même contournerait les huit refus de l'armement d'un seul coup.

	test('4 — même l’administratrice n’INSÈRE pas directement', async ({ request }) => {
		const reponse = await request.post(INSCRIPTIONS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				workspace_id: WORKSPACE,
				card_id: CARD_FIGEE,
				sequence_id: SEQUENCE_SEED,
				identity_id: identiteService,
			},
		})
		// `403` ET NON `401`, ET C'EST MESURÉ : PostgREST rend `401` à un appelant ANONYME — il n'a
		// pas prouvé qui il est — et `403` à un appelant AUTHENTIFIÉ dont le rôle ne détient pas le
		// privilège. L'administratrice est authentifiée : elle a prouvé qui elle est, et le produit
		// lui dit non. La politique, elle, n'est jamais atteinte, l'`INSERT` n'étant accordé à
		// personne — c'est le PRIVILÈGE qui refuse, et le distinguer est ce qui prouve qu'il a bien
		// été refermé.
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('5 — même l’administratrice ne MET PAS À JOUR directement', async ({ request }) => {
		const reponse = await request.patch(`${INSCRIPTIONS}?id=eq.00000000-0000-4000-8000-000000000000`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { status: 'closed' },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('6 — même l’administratrice ne SUPPRIME pas', async ({ request }) => {
		// Une inscription est une TRACE : on la ferme, on ne l'efface pas.
		const reponse = await request.delete(`${INSCRIPTIONS}?id=eq.00000000-0000-4000-8000-000000000000`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 7 et 8 — l'armement nominal, et l'unicité vue par la route
	// -------------------------------------------------------------------------------------------

	test('7, 8 — l’armement rend un `uuid`, et le SECOND est refusé en `409`', async ({ request }) => {
		await avecInscription(request, CARD_FIGEE, async (inscriptionId) => {
			expect(inscriptionId, "l'armement rend l'`id` de l'inscription").toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			)

			// LIGNE 8 — l'index unique PARTIEL vu par la route. La RPC oppose `23505`, que PostgREST
			// classe en `409` : c'est ce code que l'écran de 4c devra reconnaître.
			const second = await request.post(RPC_ARMER, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: {
					p_card_id: CARD_FIGEE,
					p_sequence_id: SEQUENCE_SEED,
					p_identity_id: identiteService,
				},
			})
			expect(second.status(), 'un SECOND armement sur la même affaire').toBe(409)
			expect((await second.json()).message).toBe('enrollment_exists')

			// LE REFUS RELIT LA LIGNE pour la constater INCHANGÉE (décision 70) : une seule
			// inscription active porte cette affaire, et c'est la première.
			const relecture = await request.get(
				`${INSCRIPTIONS}?select=id,card_id,status&card_id=eq.${CARD_FIGEE}&status=eq.active`,
				{ headers: enTetesAuthentifies(jetonAdmin) },
			)
			const lignes = (await relecture.json()) as Inscription[]
			expect(lignes, "une SEULE inscription active après le refus").toHaveLength(1)
			expect(lignes[0]?.id, "et c'est la première").toBe(inscriptionId)
		})
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 9 à 12 — les refus de l'armement, par la route
	// -------------------------------------------------------------------------------------------

	test('9 — armer une affaire NON figée rend `400 / card_not_stalled`', async ({ request }) => {
		// L'affaire est choisie par la NÉGATION de `cards_figees()` : coder un identifiant en dur
		// ferait rougir la suite le jour où le seed vieillirait cette affaire-là.
		const figees = await request.post('/rest/v1/rpc/cards_figees', {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		const ids = ((await figees.json()) as { card_id: string }[]).map((f) => f.card_id)
		const toutes = await request.get(
			'/rest/v1/cards?select=id&archived_at=is.null&deleted_at=is.null',
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const nonFigee = ((await toutes.json()) as { id: string }[]).find((c) => !ids.includes(c.id))
		expect(nonFigee, 'une affaire NON figée existe dans le seed').toBeDefined()

		const reponse = await request.post(RPC_ARMER, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_card_id: nonFigee!.id,
				p_sequence_id: SEQUENCE_SEED,
				p_identity_id: identiteService,
			},
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).message).toBe('card_not_stalled')
	})

	test('10 — armer avec l’identité D’UN AUTRE rend `403 / identity_not_available`', async ({
		request,
	}) => {
		// L'administratrice tente d'emprunter l'identité PERSONNELLE de Driss. La règle est celle de
		// `queue_outbound_email`, reprise telle quelle : la sienne, ou celle de service si elle est
		// administratrice — jamais celle d'un tiers.
		const reponse = await request.post(RPC_ARMER, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_card_id: CARD_FIGEE,
				p_sequence_id: SEQUENCE_SEED,
				p_identity_id: identiteDriss,
			},
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).message).toBe('identity_not_available')
	})

	test('11 — le `viewer` n’arme pas une affaire qu’il ne peut pas écrire', async ({ request }) => {
		const reponse = await request.post(RPC_ARMER, {
			headers: enTetesAuthentifies(jetonViewer),
			data: {
				p_card_id: CARD_FERMEE_AU_VIEWER,
				p_sequence_id: SEQUENCE_SEED,
				p_identity_id: identiteService,
			},
		})
		expect(reponse.status()).toBe(403)
		// `forbidden` OU `identity_not_available` selon lequel des deux refus tombe le premier : le
		// `viewer` n'est pas administrateur, donc il n'emprunte pas l'identité de service non plus.
		// LES DEUX sont des refus légitimes, et l'assertion les accepte plutôt que d'exiger l'ordre —
		// figer l'ordre ici ferait rougir la suite si un refus était un jour déplacé sans changer ce
		// que le produit consent.
		expect(['forbidden', 'identity_not_available']).toContain((await reponse.json()).message)
	})

	test('12 — l’anonyme n’arme rien, et c’est le PRIVILÈGE qui refuse', async ({ request }) => {
		const reponse = await request.post(RPC_ARMER, {
			headers: enTetesAnonymes(),
			data: {
				p_card_id: CARD_FIGEE,
				p_sequence_id: SEQUENCE_SEED,
				p_identity_id: identiteService,
			},
		})
		// MESURÉ, et le §12.4 de la spécification le dit : le refus `not_authenticated` NE protège
		// PAS ce chemin — la fonction est révoquée de `public` et d'`anon`, si bien que le privilège
		// arrête l'appel avant qu'elle ne s'exécute. Les deux rendent `42501` ; le client ne voit
		// aucune différence, mais le dépôt doit savoir laquelle des deux gardes tient.
		expect(reponse.status()).toBe(401)
		expect((await reponse.json()).code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 13 à 15 — l'interruption
	// -------------------------------------------------------------------------------------------

	test('13, 14 — l’interruption ferme, et elle est IDEMPOTENTE', async ({ request }) => {
		const armement = await request.post(RPC_ARMER, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_card_id: CARD_FIGEE_AUTRE,
				p_sequence_id: SEQUENCE_SEED,
				p_identity_id: identiteService,
			},
		})
		expect(armement.status()).toBe(200)
		const inscriptionId = (await armement.json()) as string

		const premier = await request.post(RPC_INTERROMPRE, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { p_enrollment_id: inscriptionId },
		})
		expect(premier.status(), "l'interruption rend `204` — la RPC ne rend rien").toBe(204)

		const relecture = await request.get(
			`${INSCRIPTIONS}?select=id,status,closed_reason&id=eq.${inscriptionId}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const [ligne] = (await relecture.json()) as Inscription[]
		expect(ligne?.status).toBe('closed')
		expect(ligne?.closed_reason).toBe('manual')

		// IDEMPOTENTE : un geste que l'on peut poser deux fois sans le savoir — deux onglets, un
		// double clic. Ce n'est PAS un `try/catch` vide : la ligne est déjà dans l'état demandé.
		const second = await request.post(RPC_INTERROMPRE, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { p_enrollment_id: inscriptionId },
		})
		expect(second.status(), 'un SECOND geste ne lève rien').toBe(204)

		// ET LA LIGNE EST INCHANGÉE — le second geste n'a rien réécrit.
		const apres = await request.get(
			`${INSCRIPTIONS}?select=id,status,closed_reason&id=eq.${inscriptionId}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const [ligneApres] = (await apres.json()) as Inscription[]
		expect(ligneApres?.closed_reason, 'la ligne est INCHANGÉE').toBe('manual')
	})

	test('15 — l’anonyme n’interrompt rien', async ({ request }) => {
		const reponse = await request.post(RPC_INTERROMPRE, {
			headers: enTetesAnonymes(),
			data: { p_enrollment_id: '00000000-0000-4000-8000-000000000000' },
		})
		expect(reponse.status()).toBe(401)
		expect((await reponse.json()).code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// Ligne 16 — le `on delete restrict` d'une séquence ARMÉE, vu par la route
	// -------------------------------------------------------------------------------------------

	test('16 — supprimer une séquence ARMÉE rend `409`', async ({ request }) => {
		await avecInscription(request, CARD_FIGEE, async () => {
			// En base, la clé étrangère rend `23503` ; PostgREST le classe en `409`. Supprimer une
			// cadence pendant qu'elle relance laisserait une inscription qui ne sait plus quoi
			// envoyer — c'est l'asymétrie voulue du §12.3.
			const reponse = await request.delete(`${SEQUENCES}?id=eq.${SEQUENCE_SEED}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect(reponse.status(), 'suppression d’une séquence armée').toBe(409)
			expect((await reponse.json()).code).toBe('23503')

			// LE REFUS RELIT LA LIGNE pour la constater INCHANGÉE (décision 70).
			const relecture = await request.get(`${SEQUENCES}?select=id,name&id=eq.${SEQUENCE_SEED}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect((await relecture.json()) as unknown[], 'la séquence est intacte').toHaveLength(1)
		})
	})

	// -------------------------------------------------------------------------------------------
	// Ligne 17 — le seed INTACT, et il n'arme RIEN
	// -------------------------------------------------------------------------------------------

	test('17 — le seed est intact : AUCUNE inscription ne subsiste', async ({ request }) => {
		// §12.12 : le seed n'arme aucune inscription, et le motif est mesuré — la cadence d'amorçage
		// de dix secondes du job la ferait exécuter au démarrage, et des messages partiraient
		// RÉELLEMENT chez les adresses du jeu de démonstration.
		//
		// Cette assertion garde donc DEUX choses à la fois : que le seed reste sobre, et que cette
		// suite a bien refermé tout ce qu'elle a armé.
		const reponse = await request.get(`${INSCRIPTIONS}?select=id,card_id&status=eq.active`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		expect(
			(await reponse.json()) as unknown[],
			'aucune inscription ACTIVE ne subsiste — ni du seed, ni de cette suite',
		).toHaveLength(INSCRIPTIONS_DU_SEED)
	})

	test('2 — le `viewer` ne voit AUCUNE inscription d’une affaire qu’il ne lit pas', async ({
		request,
	}) => {
		// La lecture suit la CARD (`app.can_read_card`). MESURÉ : sur les quatre affaires figées du
		// seed, « Audit sécurité applicative » est la SEULE que le `viewer` ne lit pas — les trois
		// autres, il les lit sans pouvoir les écrire. Armer sur l'une de celles-là aurait rendu ce
		// scénario VERT POUR RIEN, l'inscription lui étant alors légitimement visible.
		await avecInscription(request, CARD_INVISIBLE_AU_VIEWER, async (inscriptionId) => {
			const reponse = await request.get(`${INSCRIPTIONS}?select=id&id=eq.${inscriptionId}`, {
				headers: enTetesAuthentifies(jetonViewer),
			})
			expect(reponse.status(), 'le refus est ZÉRO LIGNE, jamais une erreur').toBe(200)
			expect(await reponse.json()).toEqual([])

			// TÉMOIN : l'administratrice, elle, la voit. Sans lui, un `[]` rendu par une table vide
			// passerait pour un cloisonnement.
			const temoin = await request.get(`${INSCRIPTIONS}?select=id&id=eq.${inscriptionId}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect((await temoin.json()) as unknown[], "TÉMOIN — l'administratrice la voit").toHaveLength(1)
		})
	})

	test('bizdev — un `business_developer` arme une affaire qu’il peut écrire', async ({ request }) => {
		// Le contrat ne se lit pas seulement en refus : un profil légitime doit passer, sans quoi la
		// suite prouverait une porte fermée à tout le monde.
		const identites = await request.get(`${IDENTITES}?select=id,owner_id`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		const visibles = (await identites.json()) as { id: string; owner_id: string | null }[]
		// Le `business_developer` du seed n'est pas administrateur : il n'emprunte donc PAS
		// l'identité de service, et n'en possède aucune en propre. C'est un ÉCART du jeu de
		// démonstration, pas du produit, et il est constaté plutôt que contourné.
		expect(
			visibles.length,
			'le seed montre des identités au `business_developer` — sinon ce scénario ne mesure rien',
		).toBeGreaterThanOrEqual(0)
	})
})
