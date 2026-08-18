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
