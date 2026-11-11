// @verifies CRM-141 (docs/BACKLOG.md) — tranche T2 : l'évaluation des pastilles de bout en bout sur la vraie base — la
//           tâche de la minute, la fonction `ia`, le simulateur, la clôture ; la main qui prime ; le vrai modèle quand il
//           est joignable
// @verifies docs/SPEC-mail-subsystem.md §31.5 (un mail reçu entre dans la file ; `pg_cron` réveille la passe ; la clôture
//           ne touche aucun choix manuel), §31.4 ; docs/SPEC-ia.md §15.4 (le secret exigé, derrière Kong comme sur le
//           réseau interne), §15.5 (le scénario `pastilles`) ; CLAUDE.md §15 (contre le vrai modèle quand il est joignable)
//
// LES DEUX MAILS SONT PROPRES À LA PREUVE, posés par la clé de service dans « Refonte du site vitrine » (`…00c1`) que
// l'administratrice lit, et retirés à la fin quoi qu'il arrive. En développement, la tâche de la minute vise le simulateur
// (le secret `p2enjoy-pastilles-simulateur` du seed) : l'issue est déterministe.

import { execFileSync } from 'node:child_process'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { conteneur } from '../conteneur'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const ROUTE = `${URL_API}/functions/v1/ia/pastilles/evaluer`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const suffixe = Date.now().toString(36)

type Ligne = { label_id: string; source: string; applied: boolean }

test.describe.configure({ mode: 'serial' })

const crees: string[] = []

async function poserMail(request: APIRequestContext, objet: string, texte: string): Promise<string> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm141-${suffixe}-${crees.length}@sonde.test>`,
			card_id: CARD_C1,
			classification: 'manual',
			from_address: 'compta@sonde.test',
			subject: objet,
			body_text: texte,
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	crees.push(id)
	return id
}

async function pastille(request: APIRequestContext, nom: string): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_labels?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(nom)}&select=id`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function etat(request: APIRequestContext, message: string): Promise<string> {
	const reponse = await request.get(`${URL_API}/rest/v1/mail_label_evaluations?message_id=eq.${message}&select=state`, {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { state: string }[])[0]?.state ?? 'absent'
}

async function lignes(request: APIRequestContext, message: string): Promise<Ligne[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_message_labels?message_id=eq.${message}&select=label_id,source,applied&order=label_id`,
		{ headers: enTetesService() },
	)
	return (await reponse.json()) as Ligne[]
}

test.afterAll(async ({ request }) => {
	for (const id of crees) await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${id}`, { headers: enTetesService() })
})

test('P1 — la route refuse un appel sans le secret, ou avec un faux, même derrière Kong', async ({ request }) => {
	const essais: Record<string, string>[] = [{ apikey: CLE_ANONYME }, { apikey: CLE_ANONYME, 'x-pastilles-dispatch': 'faux' }]
	for (const entetes of essais) {
		const reponse = await request.post(ROUTE, { headers: entetes })
		expect(reponse.status()).toBe(401)
	}
})

test('P2 — la tâche de la minute évalue un mail reçu ; un retrait manuel posé avant n’est pas défait', async ({ request }) => {
	test.setTimeout(200_000)
	const facture = await pastille(request, 'Facture / paiement')
	const libre = await poserMail(request, 'Facture de mars — échéance', 'Veuillez trouver notre facture de mars.')
	const corrige = await poserMail(request, 'Facture de mars — relance', 'Seconde facture de mars, à régler.')
	expect(await etat(request, libre)).toBe('pending')

	// Le choix manuel, posé AVANT toute évaluation, sous le jeton de l'administratrice : la passe ne le défera pas.
	const jeton = await jetonDe('admin@p2enjoy.test')
	const retrait = await request.post(`${URL_API}/rest/v1/rpc/set_message_label`, {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_message_id: corrige, p_label_id: facture, p_applied: false },
	})
	expect(retrait.status(), await retrait.text()).toBe(204)

	await expect
		.poll(async () => [await etat(request, libre), await etat(request, corrige)].join(','), { timeout: 150_000, intervals: [2_000] })
		.toBe('done,done')
	expect(await lignes(request, libre)).toEqual([{ label_id: facture, source: 'llm', applied: true }])
	expect(await lignes(request, corrige)).toEqual([{ label_id: facture, source: 'manual', applied: false }])
})

test('P3 — contre le vrai modèle, quand il est joignable : la passe aboutit et ne rend que des comptes', async ({ request }) => {
	test.setTimeout(200_000)
	const etatReel = await request.get(`${URL_API}/functions/v1/ia/etat`, { headers: { apikey: CLE_ANONYME } })
	const disponible = ((await etatReel.json()) as { disponible?: boolean }).disponible === true
	test.skip(!disponible, 'le serveur Ollama réel n’est pas joignable depuis cette pile (docs/SPEC-ia.md §3)')

	const secret = execFileSync(
		'docker',
		['exec', conteneur('db'), 'psql', '-U', 'postgres', '-d', 'postgres', '-qtAc',
			"select decrypted_secret from vault.decrypted_secrets where name = 'p2enjoy-pastilles-dispatch'"],
		{ encoding: 'utf8' },
	).trim()
	const message = await poserMail(request, 'Demande de devis pour une refonte', 'Bonjour, nous souhaitons un devis.')
	// La tâche de la minute, en développement, viserait le simulateur : la passe réelle est appelée ici, SANS l'en-tête
	// du simulateur, jusqu'à ce qu'elle prenne le message de la preuve.
	let bilan: { evalues?: number; echecs?: number; raison?: string } = {}
	for (let essai = 0; essai < 3 && (await etat(request, message)) === 'pending'; essai++) {
		const reponse = await request.post(ROUTE, { headers: { apikey: CLE_ANONYME, 'x-pastilles-dispatch': secret } })
		expect(reponse.status()).toBe(200)
		bilan = (await reponse.json()) as typeof bilan
	}
	expect(Object.keys(bilan).every((cle) => ['evalues', 'echecs', 'rejetees', 'raison'].includes(cle))).toBe(true)
	expect(await etat(request, message)).toBe('done')
})
