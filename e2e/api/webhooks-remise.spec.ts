// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : la remise de bout en bout, sur la vraie pile — `pg_cron` réveille la
//           fonction edge par `pg_net`, la fonction signe et remet au récepteur local en HTTPS, la base inscrit le résultat ;
//           l'échec et son prochain essai, le délai dépassé, l'adresse interne refusée, le renvoi, l'appel sans secret
// @verifies docs/SPEC-webhooks.md §2, §5.1, §5.2, §5.3, §6, §8, §12 ; docs/JOURNAL.md décision 784 ; CLAUDE.md §10, §15
//
// Aucun raccourci : la preuve attend la tâche `pg_cron` de la minute, comme en production. Les webhooks et l'affaire de la
// preuve portent le préfixe `tst-crm073` et sont retirés à la fin ; le récepteur est lu par `docker exec`.

import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { conteneur } from '../conteneur'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const RPC = `${URL_API}/rest/v1/rpc`
const RECEPTEUR = 'https://webhook-sink:8443'
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

type Gardee = { chemin: string; entetes: Record<string, string>; corps: string }
type Remise = { id: string; status: string; attempts: number; last_status_code: number | null; last_error: string | null; next_attempt_at: string | null; last_attempt_at: string | null; payload: unknown }

function lireRecepteur(remise: string): Gardee[] {
	const script = `import urllib.request,sys;sys.stdout.write(urllib.request.urlopen('http://127.0.0.1:8080/requetes?remise=${remise}').read().decode())`
	return JSON.parse(execFileSync('docker', ['exec', conteneur('webhook-sink'), 'python', '-c', script], { encoding: 'utf8' })) as Gardee[]
}

async function creer(request: APIRequestContext, jeton: string, nom: string, chemin: string) {
	const reponse = await request.post(`${RPC}/create_webhook_endpoint`, {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_workspace: ESPACE, p_name: `tst-crm073 ${nom}`, p_url: `${RECEPTEUR}${chemin}`, p_events: ['card.owner_changed'] },
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return ((await reponse.json()) as { id: string; secret: string }[])[0]!
}

async function remisesDe(request: APIRequestContext, webhook: string): Promise<Remise[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/webhook_deliveries?endpoint_id=eq.${webhook}&select=id,status,attempts,last_status_code,last_error,next_attempt_at,last_attempt_at,payload&order=created_at`,
		{ headers: enTetesService() },
	)
	return (await reponse.json()) as Remise[]
}

/** Attend qu'une remise ait été ESSAYÉE au moins `essais` fois : la tâche `pg_cron` tire chaque minute. */
async function attendreEssai(request: APIRequestContext, webhook: string, essais = 1): Promise<Remise> {
	let derniere: Remise | undefined
	await expect
		.poll(async () => ((derniere = (await remisesDe(request, webhook)).at(-1)), derniere?.attempts ?? 0), {
			timeout: 150_000,
			intervals: [2_000],
		})
		.toBeGreaterThanOrEqual(essais)
	// L'essai compté, son résultat inscrit : la réservation de quinze minutes a cédé la place au vrai prochain essai.
	await expect
		.poll(async () => ((derniere = (await remisesDe(request, webhook)).at(-1)), derniere!.status !== 'pending' || derniere!.last_status_code !== null || derniere!.last_error !== null), {
			timeout: 30_000,
		})
		.toBe(true)
	return derniere!
}

test.describe('la remise des webhooks — de bout en bout (docs/SPEC-webhooks.md §2, §5)', () => {
	test.setTimeout(300_000)

	test.afterEach(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/cards?title=like.${encodeURIComponent('tst-crm073*')}`, { headers: enTetesService() })
		await request.delete(`${URL_API}/rest/v1/webhook_endpoints?name=like.${encodeURIComponent('tst-crm073*')}`, { headers: enTetesService() })
	})

	test('remise signée, échec et prochain essai, délai dépassé, adresse interne, renvoi — par la tâche de la minute', async ({ request }) => {
		const admin = await jetonDe('admin@p2enjoy.test')
		const marque = randomUUID()
		const ok = await creer(request, admin, 'Réussie', `/crm/${marque}`)
		const echec = await creer(request, admin, 'Échec', `/statut/500/${marque}`)
		const lent = await creer(request, admin, 'Lente', `/lent/${marque}`)
		const interne = await request.post(`${RPC}/create_webhook_endpoint`, {
			headers: json(enTetesAuthentifies(admin)),
			data: { p_workspace: ESPACE, p_name: 'tst-crm073 Interne', p_url: 'https://kong:8000/rest/v1/', p_events: ['card.owner_changed'] },
		})
		const idInterne = ((await interne.json()) as { id: string }[])[0]!.id

		// Un vrai geste : une affaire jetable confiée à Driss, par l'API, avec le jeton de l'administratrice.
		const creation = await request.post(`${RPC}/creer_affaire`, {
			headers: json(enTetesAuthentifies(admin)),
			data: { p_channel: REFONTE, p_titre: 'tst-crm073 Affaire remise' },
		})
		const affaire = (await creation.json()) as string
		const geste = await request.patch(`${URL_API}/rest/v1/card_placements?card_id=eq.${affaire}`, {
			headers: json(enTetesAuthentifies(admin)),
			data: { owner_id: DRISS },
		})
		expect(geste.status()).toBe(204)

		// La remise réussie : reçue en HTTPS, signée du secret rendu à la création, corps identique à la charge inscrite.
		const reussie = await attendreEssai(request, ok.id)
		expect(reussie).toMatchObject({ status: 'delivered', attempts: 1, last_status_code: 200, next_attempt_at: null })
		const [recue] = lireRecepteur(reussie.id)
		expect(recue, 'le récepteur a bien reçu la remise').toBeDefined()
		expect(JSON.parse(recue!.corps)).toEqual(reussie.payload)
		expect(recue!.entetes['x-p2enjoy-event']).toBe('card.owner_changed')
		expect(recue!.entetes['user-agent']).toBe('P2Enjoy-CRM-Webhooks/1')
		const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(recue!.entetes['x-p2enjoy-signature'] ?? '') ?? []
		expect(v1, 'la signature a la forme du §5.1').toBeDefined()
		expect(v1).toBe(createHmac('sha256', ok.secret).update(`${t}.${recue!.corps}`).digest('hex'))
		expect(Math.abs(Date.now() / 1000 - Number(t)), 'l’horodatage est celui de l’envoi').toBeLessThan(300)
		expect((reussie.payload as { data: Record<string, unknown> }).data).toMatchObject({
			card_id: affaire,
			owner: { id: DRISS, full_name: 'Driss Lemoine' },
			// `creer_affaire` ne pose aucun responsable : il n'y en avait pas avant.
			from_owner: null,
		})

		// L'échec : 500, et le prochain essai une minute après celui-ci.
		const ratee = await attendreEssai(request, echec.id)
		expect(ratee).toMatchObject({ status: 'pending', attempts: 1, last_status_code: 500, last_error: null })
		expect(Date.parse(ratee.next_attempt_at!) - Date.parse(ratee.last_attempt_at!)).toBe(60_000)

		// Le délai dépassé : le récepteur répond après 12 s, la remise en attend 10.
		const lente = await attendreEssai(request, lent.id)
		expect(lente).toMatchObject({ status: 'pending', attempts: 1, last_status_code: null, last_error: 'timeout' })

		// L'adresse interne : refusée avant tout appel.
		const refusee = await attendreEssai(request, idInterne)
		expect(refusee).toMatchObject({ status: 'pending', last_status_code: null, last_error: 'address_forbidden' })

		// Le renvoi : une nouvelle remise du même corps, reçue à son tour sous un autre identifiant de remise.
		const renvoi = await request.post(`${RPC}/redeliver_webhook`, { headers: json(enTetesAuthentifies(admin)), data: { p_delivery: reussie.id } })
		expect(renvoi.status(), await renvoi.text()).toBe(200)
		const nouvelle = (await renvoi.json()) as string
		const renvoyee = await attendreEssai(request, ok.id)
		expect(renvoyee.id).toBe(nouvelle)
		expect(renvoyee.status).toBe('delivered')
		const [secondeRecue] = lireRecepteur(nouvelle)
		expect(JSON.parse(secondeRecue!.corps)).toEqual(JSON.parse(recue!.corps))
	})

	test('la fonction refuse un appel sans le secret de la tâche, même par la passerelle avec une clé valide', async ({ request }) => {
		for (const entetes of [{}, { 'x-webhooks-dispatch': 'un-faux-secret' }] as Record<string, string>[]) {
			const reponse = await request.post(`${URL_API}/functions/v1/webhooks/remettre`, {
				headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}`, ...entetes },
				data: {},
			})
			expect(reponse.status()).toBe(401)
			expect(await reponse.json()).toEqual({ error: 'unauthorized' })
		}
	})
})
