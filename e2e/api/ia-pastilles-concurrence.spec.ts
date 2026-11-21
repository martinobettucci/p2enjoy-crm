// @verifies CRM-163 (docs/BACKLOG.md) — pendant une passe des pastilles longue, l'assistant répond : `GET /ia/etat` rend
//           `200` en moins de 5 s, là où il rendait `502` à 10 s ; et le réveil de la minute n'appelle pas une seconde
//           passe tant que la première tient le bail
// @verifies docs/SPEC-ia.md §16.2 (la passe sur sa propre voie), §16.3 (le bail de la passe), §16.6 ;
//           docs/SPEC-mail-subsystem.md §31.5
//
// LA PASSE EST LONGUE PAR LE VRAI CHEMIN : le scénario du simulateur que lit `app.pastilles_reveiller` passe, le temps de la
// preuve, de `pastilles` à `pastilles_lentes` (4 s par évaluation), cinq mails sont posés, et le réveil est appelé comme
// `pg_cron` l'appelle. Le scénario d'origine est rendu quoi qu'il arrive, et les mails retirés une fois évalués.

import { execFileSync } from 'node:child_process'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { conteneur } from '../conteneur'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const SCENARIO = 'p2enjoy-pastilles-simulateur'
const suffixe = Date.now().toString(36)
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

const sql = (requete: string): string =>
	execFileSync('docker', ['exec', conteneur('db'), 'psql', '-U', 'postgres', '-d', 'postgres', '-qtAc', requete], {
		encoding: 'utf8',
	}).trim()
const lireScenario = () => sql(`select decrypted_secret from vault.decrypted_secrets where name = '${SCENARIO}'`)
const poserScenario = (valeur: string) =>
	sql(`select vault.update_secret((select id from vault.secrets where name = '${SCENARIO}'), '${valeur}')`)

test.describe.configure({ mode: 'serial' })

let scenarioDOrigine = ''
const crees: string[] = []

async function poserMail(request: APIRequestContext, rang: number): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm163-${suffixe}-${rang}@sonde.test>`,
			card_id: CARD_C1,
			classification: 'manual',
			from_address: 'compta@sonde.test',
			subject: `Facture n° ${rang} — échéance`,
			body_text: 'Veuillez trouver notre facture.',
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	crees.push(((await reponse.json()) as { id: string }[])[0]!.id)
}

const restants = () =>
	Number(sql(`select count(*) from public.mail_label_evaluations where message_id in (${crees.map((id) => `'${id}'`).join(',')}) and state = 'pending'`))

test.beforeAll(() => {
	scenarioDOrigine = lireScenario()
	expect(scenarioDOrigine, 'le seed de développement pose le scénario du simulateur (docs/SPEC-mail-subsystem.md §31.5)').not.toBe('')
})

test.afterAll(async ({ request }, testInfo) => {
	testInfo.setTimeout(90_000)
	poserScenario(scenarioDOrigine)
	// La passe en cours finit ses mails avant qu'ils soient retirés : 5 × 4 s au plus, et la passe suivante pour un reste.
	for (let attente = 0; attente < 60 && crees.length > 0 && restants() > 0; attente++) await new Promise((r) => setTimeout(r, 1_000))
	for (const id of crees) await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${id}`, { headers: enTetesService() })
})

test('pendant une passe longue, l’assistant répond, et le réveil suivant n’appelle pas une seconde passe', async ({ request }) => {
	test.setTimeout(300_000)
	poserScenario('pastilles_lentes')
	// Une passe déjà en route — réveillée avant la bascule du scénario — prendrait les mails de la preuve en mode rapide :
	// la preuve attend que le bail soit libre (160 s au plus).
	await expect
		.poll(() => sql('select leased_until is null or leased_until < now() from app.label_pass_lease'), { timeout: 170_000, intervals: [1_000] })
		.toBe('t')
	for (let rang = 1; rang <= 5; rang++) await poserMail(request, rang)

	// Le réveil, tel que `pg_cron` l'appelle — et la tâche de la minute peut le devancer : toute passe réveillée désormais
	// vise `pastilles_lentes`. La passe a pris son premier mail : elle tient le worker de sa voie.
	await expect
		.poll(
			() => {
				sql('select app.pastilles_reveiller()')
				return restants()
			},
			{ timeout: 30_000, intervals: [1_000] },
		)
		.toBeLessThan(5)

	const jeton = await jetonDe('admin@p2enjoy.test')
	const debut = Date.now()
	const etat = await request.get(`${URL_API}/functions/v1/ia/etat`, { headers: enTetesAuthentifies(jeton), timeout: 30_000 })
	const duree = Date.now() - debut
	expect(etat.status(), `l'assistant répond pendant la passe (${duree} ms)`).toBe(200)
	expect(duree, 'sans attendre la fin de la passe').toBeLessThan(5_000)
	expect(restants(), 'la passe était bien en cours pendant l’appel').toBeGreaterThan(0)

	// Une passe est en cours : le réveil de la minute n'appelle pas une seconde passe (le bail, §16.3).
	expect(sql('select app.pastilles_reveiller()'), 'aucune requête pg_net pendant une passe en cours').toBe('')
})
