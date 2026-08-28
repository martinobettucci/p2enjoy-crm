// @verifies CRM-055 (docs/BACKLOG.md) — classement manuel et ses refus
// @verifies docs/SPEC-mail-subsystem.md §16.3 (droit d'écriture exigé, idempotence)
// @verifies docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
//
// Le scénario crée ses propres messages avec la clé de service et les retire : le seed n'est
// jamais touché.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
// Card d'un channel que le `viewer` NE PEUT PAS écrire — c'est ce qui rend son refus mesurable.
const CARD = '5eed0000-0000-4000-8000-0000000000c1'

async function creerMessage(
	request: import('@playwright/test').APIRequestContext,
	identifiant: string,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE,
			rfc822_message_id: identifiant,
			from_address: 'client@exterieur.test',
			subject: 'Message de preuve',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [ligne] = (await reponse.json()) as { id: string }[]
	return ligne!.id
}

/**
 * Donne au message une OCCURRENCE dans la boîte du workspace — ajouté par `CRM-057`.
 *
 * Un message que la relève n'a vu nulle part n'existe pour personne : depuis que classer exige de
 * VOIR le message (§18.2), un message sans occurrence n'est classable par quiconque. Ce n'est pas
 * un contournement de la garde, c'est la donnée qui manquait pour que la sonde ressemble à un
 * message réellement reçu.
 */
async function poserOccurrence(
	request: import('@playwright/test').APIRequestContext,
	message: string,
): Promise<void> {
	const comptes = await request.get(
		`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=is.null&limit=1`,
		{ headers: enTetesService() },
	)
	const [compte] = (await comptes.json()) as { id: string }[]
	expect(compte, 'la boîte système du seed est introuvable').toBeDefined()
	const pose = await request.post(`${URL_API}/rest/v1/mail_message_occurrences`, {
		headers: { ...enTetesService(), Prefer: 'return=minimal' },
		data: { message_id: message, account_id: compte!.id, folder: 'INBOX', uid: 900001 },
	})
	expect(pose.status(), await pose.text()).toBe(201)
}

test.describe('classement manuel — ce que la pile consent', () => {
	test('classer exige le droit d’ÉCRITURE, non celui de lecture', async ({ request }) => {
		const identifiant = `<classe-${Date.now()}@preuves.test>`
		const message = await creerMessage(request, identifiant)

		try {
			const jetonViewer = await jetonDe('viewer@p2enjoy.test')
			const refus = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jetonViewer),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(refus.status()).toBe(403)
			expect(await refus.text()).toContain('forbidden')

			const anonyme = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAnonymes(),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect([401, 403]).toContain(anonyme.status())

			// La ligne est relue : un refus ne doit RIEN avoir écrit.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=classification,card_id`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as { classification: string; card_id: null }[]
			expect(ligne?.classification).toBe('unclassified')
			expect(ligne?.card_id).toBeNull()
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})

	// RÉVISÉ PAR `CRM-057`, ET L'ASSERTION AVAIT JOUÉ. Elle mesurait qu'un message non classé
	// n'était lisible par PERSONNE, administratrice comprise — le contrat de `CRM-054`, qui laissait
	// explicitement à l'unité suivante le soin de dire qui les voit. C'est fait : la visibilité d'un
	// non classé suit désormais la BOÎTE où il a été vu (§18.1). Le scénario ne mesure donc plus
	// « invisible pour tous », mais la bascule d'un titre de visibilité à l'autre.
	test('un message classé change de titre de visibilité : de sa boîte à sa card', async ({
		request,
	}) => {
		const identifiant = `<lisible-${Date.now()}@preuves.test>`
		const message = await creerMessage(request, identifiant)
		await poserOccurrence(request, message)
		const jeton = await jetonDe('admin@p2enjoy.test')
		const jetonMembre = await jetonDe('bizdev@p2enjoy.test')

		try {
			// AVANT : l'administratrice le voit — la boîte du workspace est la sienne à ce titre.
			const avant = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect((await avant.json()) as unknown[]).toHaveLength(1)

			// ET LE MEMBRE, LUI, NE LE VOIT PAS : il ne répond d'aucune boîte où ce message est
			// arrivé, et aucun rôle de tri n'existe (§18.1). C'est le témoin du refus.
			const avantMembre = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jetonMembre) },
			)
			expect((await avantMembre.json()) as unknown[]).toHaveLength(0)

			const classement = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jeton),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(classement.status(), await classement.text()).toBe(200)

			// APRÈS : classé, donc lisible par qui lit la card.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id,classification,classified_by`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			const lues = (await apres.json()) as {
				classification: string
				classified_by: string
			}[]
			expect(lues).toHaveLength(1)
			expect(lues[0]?.classification).toBe('manual')
			// Le classement manuel a un AUTEUR, et il est journalisé (§16.3).
			expect(lues[0]?.classified_by).toBe('5eed0000-0000-4000-8000-000000000011')

			// APRÈS, POUR LE MEMBRE AUSSI : il lit la card, donc il lit son courrier. Le titre de
			// visibilité a changé, et c'est tout l'objet du classement.
			const apresMembre = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jetonMembre) },
			)
			expect((await apresMembre.json()) as unknown[]).toHaveLength(1)

			// L'événement de timeline est écrit : la card garde la mémoire du message reçu.
			const evenements = await request.get(
				`${URL_API}/rest/v1/card_events?card_id=eq.${CARD}&type=eq.mail_received&select=id`,
				{ headers: enTetesService() },
			)
			expect(((await evenements.json()) as unknown[]).length).toBeGreaterThanOrEqual(1)
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
			// L'ÉVÉNEMENT DE TIMELINE N'EST PAS RETIRÉ, ET IL NE PEUT PAS L'ÊTRE : `card_events`
			// n'accorde aucun privilège d'écriture, `service_role` compris (`CRM-044`).
			// L'historique ne se corrige pas. Un `DELETE` ici aurait été refusé en silence, et le
			// scénario aurait cru nettoyer ce qu'il laissait derrière lui — c'est exactement le
			// piège d'INC-061, à l'envers.
		}
	})

	test('le classement AUTOMATIQUE n’est pas offert au client', async ({ request }) => {
		// C'est un constat de la relève, pas un geste d'utilisateur : l'exposer laisserait un
		// client déclarer qu'un message a été classé par une règle qui ne s'est pas appliquée.
		const jeton = await jetonDe('admin@p2enjoy.test')
		const refus = await request.post(
			`${URL_API}/rest/v1/rpc/classer_message_automatiquement`,
			{ headers: enTetesAuthentifies(jeton), data: { p_message_id: CARD } },
		)
		expect([401, 403, 404]).toContain(refus.status())
	})
})

// @verifies CRM-060 tranche 2 (docs/BACKLOG.md) — activation de la règle 3 du classement
// @verifies docs/SPEC-contacts.md §8 (la suggestion par expéditeur connu), §8.6 (preuve API)
//
// La règle 3 SUGGÈRE sans classer. `classer_message_automatiquement` étant réservée à
// `service_role` (constat de la relève), ces scénarios l'appellent avec la clé de service, par la
// vraie route REST, et RELISENT la ligne. Léo Marchand (seed) est rattaché à EXACTEMENT une card
// active — l'état que la règle 3 lit. Ni `page.route()`, ni jeton fabriqué : la donnée est réelle.
//
// L'interaction règles 1/2 → pas de suggestion est prouvée en pgTAP (0044, cas g et h), rejouée en
// transaction sans laisser de résidu sur une card seedée ; on ne la rejoue pas ici pour ne pas
// écrire un card_event permanent sur une card de démonstration (`card_events` est append-only).
const CARD_LEO = '5eed0000-0000-4000-8000-0000000000c2'
// Le message que le SEED fait réellement arriver depuis la boîte du correspondant — CRM-060
// sous-tranche 2 bis, docs/SPEC-seed.md §2.19. C'est le seul message du dépôt qui porte une
// suggestion sans avoir été fabriqué pour la preuve.
const MSGID_SUGGERE_SEED = '<seed-inbox-suggere@sogexia.example>'

async function creerMessageDe(
	request: import('@playwright/test').APIRequestContext,
	identifiant: string,
	expediteur: string,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE,
			rfc822_message_id: identifiant,
			from_address: expediteur,
			subject: 'Sonde règle 3',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [ligne] = (await reponse.json()) as { id: string }[]
	return ligne!.id
}

test.describe('règle 3 — la suggestion par expéditeur connu', () => {
	test('un expéditeur contact à une seule card active reçoit une SUGGESTION, sans être classé', async ({
		request,
	}) => {
		const message = await creerMessageDe(
			request,
			`<suggestion-leo-${Date.now()}@preuves.test>`,
			'leo.marchand@sogexia.example',
		)
		try {
			const retour = await request.post(
				`${URL_API}/rest/v1/rpc/classer_message_automatiquement`,
				{ headers: enTetesService(), data: { p_message_id: message } },
			)
			expect(retour.status(), await retour.text()).toBe(200)
			// La chaîne rend « non classé » : la règle 3 ne classe pas.
			expect((await retour.json()) as string | null).toBeNull()

			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=classification,card_id,suggested_card_id,suggested_at`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as {
				classification: string
				card_id: null
				suggested_card_id: string | null
				suggested_at: string | null
			}[]
			// SUGGÉRÉ vers la seule card active de Léo, mais TOUJOURS non classé.
			expect(ligne?.suggested_card_id).toBe(CARD_LEO)
			expect(ligne?.suggested_at).not.toBeNull()
			expect(ligne?.classification).toBe('unclassified')
			expect(ligne?.card_id).toBeNull()
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})


	// ---------------------------------------------------------------------------------------------
	// CE QUE LA SURFACE LIT, AVEC LES VRAIS JETONS — `CRM-060` sous-tranche 2 bis,
	// docs/SPEC-contacts.md §8.8.3 et §8.8.7.
	// ---------------------------------------------------------------------------------------------
	//
	// Les deux preuves ci-dessus emploient la CLÉ DE SERVICE, qui ne prouve rien de ce qu'un membre
	// voit. Or l'écran, lui, lit sous le jeton de son utilisateur : ce qui suit mesure donc la
	// suggestion telle que la RLS la consent, sur le message que le SEED fait réellement arriver.

	test('l’administratrice lit la suggestion que le SEED fait réellement arriver', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const lecture = await request.get(
			`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(MSGID_SUGGERE_SEED)}&select=id,classification,card_id,suggested_card_id`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(lecture.status(), await lecture.text()).toBe(200)
		const [ligne] = (await lecture.json()) as {
			id: string
			classification: string
			card_id: string | null
			suggested_card_id: string | null
		}[]
		// LE MESSAGE DU SEED PORTE SON INDICE, et il le porte pour l'appelant qui le LIT — c'est
		// exactement ce que la surface reçoit, et rien d'autre. Les deux preuves précédentes
		// emploient la clé de service, qui ne dit rien de ce qu'un membre voit.
		expect(ligne?.suggested_card_id).toBe(CARD_LEO)
		expect(ligne?.classification).toBe('unclassified')
		expect(ligne?.card_id).toBeNull()

		// CE SCÉNARIO NE CLASSE PAS, ET C'EST DÉLIBÉRÉ. Accepter la suggestion écrirait un
		// `card_event` **permanent** sur une card de démonstration — `card_events` est append-only,
		// et un `DELETE` y rend 403 même à la clé de service (INC-185). Le geste est prouvé de bout
		// en bout, avec la session réelle d'une administratrice, par
		// `e2e/ui/suggestion-classement.spec.ts` : le rejouer ici doublerait la dérive sans rien
		// apprendre, la requête partant du même jeton dans les deux cas.
	})

	test('le business developer et la lectrice ne voient AUCUN message non classé de la boîte système', async ({
		request,
	}) => {
		// UN MESSAGE NON CLASSÉ N'EST LISIBLE QUE PAR LA BOÎTE OÙ IL A ÉTÉ VU
		// (docs/SPEC-mail-subsystem.md §18.1) : la boîte système est celle des administrateurs.
		// L'écran ne calcule pas ce refus — il reçoit zéro ligne, et il n'a donc aucun bloc à rendre.
		for (const compte of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
			const jeton = await jetonDe(compte)
			const lecture = await request.get(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(MSGID_SUGGERE_SEED)}&select=id,suggested_card_id`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect(lecture.status(), `${compte} : ${await lecture.text()}`).toBe(200)
			expect((await lecture.json()) as unknown[], `${compte} voit un message qu'il ne doit pas voir`).toHaveLength(0)
		}
	})

	test('un expéditeur qui n’est aucun contact ne reçoit AUCUNE suggestion', async ({ request }) => {
		const message = await creerMessageDe(
			request,
			`<suggestion-inconnu-${Date.now()}@preuves.test>`,
			'inconnu@nulle-part.test',
		)
		try {
			const retour = await request.post(
				`${URL_API}/rest/v1/rpc/classer_message_automatiquement`,
				{ headers: enTetesService(), data: { p_message_id: message } },
			)
			expect(retour.status(), await retour.text()).toBe(200)

			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=suggested_card_id,classification`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as {
				suggested_card_id: string | null
				classification: string
			}[]
			expect(ligne?.suggested_card_id).toBeNull()
			expect(ligne?.classification).toBe('unclassified')
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})
})

// @verifies CRM-055 tranche 2 (docs/BACKLOG.md) — le DÉCLASSEMENT d'un message
// @verifies docs/SPEC-mail-subsystem.md §16.5.2 (les cinq lignes du contrat, la borne mesurée de
//           l'idempotence), §16.5.3 (l'historique conservé, le départ écrit)
// @verifies docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
//
// CE QUE CES SCÉNARIOS MESURENT ET QUE LA pgTAP NE PEUT PAS MESURER : la garde vue depuis la VRAIE
// ROUTE, avec les jetons réels des profils du seed. La suite `0066` endosse un utilisateur par
// `set_config`, ce qui prouve la fonction ; ici c'est PostgREST qui répond, et le statut HTTP fait
// partie du contrat que l'écran traduira.
//
// LES ÉVÉNEMENTS DE TIMELINE NE SONT PAS RETIRÉS EN SORTIE, ET ILS NE PEUVENT PAS L'ÊTRE :
// `card_events` n'accorde aucun privilège d'écriture, `service_role` compris (`CRM-044`).
// C'est le même constat que le scénario de classement ci-dessus, et pour la même cause.
test.describe('déclassement — ce que la pile consent', () => {
	test('la lectrice ne déclasse pas, et son refus ne laisse RIEN derrière lui', async ({
		request,
	}) => {
		const message = await creerMessage(request, `<declasse-refus-${Date.now()}@preuves.test>`)
		await poserOccurrence(request, message)
		const jetonAdmin = await jetonDe('admin@p2enjoy.test')

		try {
			const classement = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(classement.status(), await classement.text()).toBe(200)

			const jetonViewer = await jetonDe('viewer@p2enjoy.test')
			const refus = await request.post(`${URL_API}/rest/v1/rpc/unclassify_message`, {
				headers: enTetesAuthentifies(jetonViewer),
				data: { p_message_id: message },
			})
			expect(refus.status()).toBe(403)
			expect(await refus.text()).toContain('forbidden')

			const anonyme = await request.post(`${URL_API}/rest/v1/rpc/unclassify_message`, {
				headers: enTetesAnonymes(),
				data: { p_message_id: message },
			})
			expect([401, 403]).toContain(anonyme.status())

			// LA LIGNE EST RELUE : un refus ne doit rien avoir défait.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=classification,card_id`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as { classification: string; card_id: string }[]
			expect(ligne?.classification).toBe('manual')
			expect(ligne?.card_id).toBe(CARD)
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})

	// LE SCÉNARIO QUI PORTE L'ARBITRAGE DE LA DÉCISION 536, ET IL EST MESURÉ DES DEUX CÔTÉS.
	// Le `bizdev` ne répond d'aucune boîte : il voit ce message par sa CARD SEULE. Le déclasser
	// l'en prive — c'est la conséquence que le §16.5.2 a choisi d'assumer plutôt que d'interdire,
	// pour ne pas lui refuser de défaire son propre geste.
	test('le membre déclasse et PERD la visibilité ; l’administratrice la garde', async ({
		request,
	}) => {
		const message = await creerMessage(request, `<declasse-perte-${Date.now()}@preuves.test>`)
		await poserOccurrence(request, message)
		const jetonAdmin = await jetonDe('admin@p2enjoy.test')
		const jetonMembre = await jetonDe('bizdev@p2enjoy.test')

		try {
			const classement = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(classement.status(), await classement.text()).toBe(200)

			// TÉMOIN : classé, le membre le voit — par la card, et seulement par elle.
			const avant = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jetonMembre) },
			)
			expect((await avant.json()) as unknown[]).toHaveLength(1)

			const geste = await request.post(`${URL_API}/rest/v1/rpc/unclassify_message`, {
				headers: enTetesAuthentifies(jetonMembre),
				data: { p_message_id: message },
			})
			expect(geste.status(), await geste.text()).toBe(200)
			// LA FONCTION REND LA CARD QUITTÉE : c'est la seule trace qui reste à un appelant que
			// le geste prive de la visibilité du message.
			expect(await geste.json()).toBe(CARD)

			// LA PERTE, RELUE DERRIÈRE LE GESTE. Ce n'est pas une déduction : PostgREST rend zéro
			// ligne au membre qui vient pourtant d'agir sur ce message.
			const apresMembre = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jetonMembre) },
			)
			expect((await apresMembre.json()) as unknown[]).toHaveLength(0)

			// LA BORNE DE L'IDEMPOTENCE, PAR LA VRAIE ROUTE : son second appel est refusé, et ce
			// refus est juste — il n'a plus le droit d'agir sur ce message.
			const second = await request.post(`${URL_API}/rest/v1/rpc/unclassify_message`, {
				headers: enTetesAuthentifies(jetonMembre),
				data: { p_message_id: message },
			})
			expect(second.status()).toBe(403)

			// L'ADMINISTRATRICE, ELLE, VOIT LA BOÎTE : le geste ne lui retire rien, et son propre
			// second appel rend `null` au lieu de refuser.
			const apresAdmin = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=classification,card_id,classified_by`,
				{ headers: enTetesAuthentifies(jetonAdmin) },
			)
			const lues = (await apresAdmin.json()) as {
				classification: string
				card_id: string | null
				classified_by: string | null
			}[]
			expect(lues).toHaveLength(1)
			expect(lues[0]?.classification).toBe('unclassified')
			expect(lues[0]?.card_id).toBeNull()
			expect(lues[0]?.classified_by).toBeNull()

			const idempotent = await request.post(`${URL_API}/rest/v1/rpc/unclassify_message`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { p_message_id: message },
			})
			expect(idempotent.status(), await idempotent.text()).toBe(200)
			expect(await idempotent.json()).toBeNull()

			// L'HISTOIRE N'EST PAS RÉÉCRITE, ET LE DÉPART EST ÉCRIT. Les deux événements portent le
			// même `message_id` : le courrier est arrivé, puis il est parti.
			const arrivee = await request.get(
				`${URL_API}/rest/v1/card_events?card_id=eq.${CARD}&type=eq.mail_received` +
					`&payload->>message_id=eq.${message}&select=id`,
				{ headers: enTetesService() },
			)
			expect((await arrivee.json()) as unknown[]).toHaveLength(1)

			const depart = await request.get(
				`${URL_API}/rest/v1/card_events?card_id=eq.${CARD}&type=eq.mail_unclassified` +
					`&payload->>message_id=eq.${message}&select=id`,
				{ headers: enTetesService() },
			)
			expect((await depart.json()) as unknown[]).toHaveLength(1)
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})
})
