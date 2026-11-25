// @verifies INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T1 : le fuseau de l'espace se règle par
//           `workspace_set_timezone`, en requête directe aux vrais jetons, et tout refus vient de la base
// @verifies docs/SPEC-modeles-emails.md §8.6 bis ; docs/SPEC-seed.md §57 ; docs/JOURNAL.md décisions 992 et 996 ; CLAUDE.md §10
//           (la règle est tenue par la base, éprouvée sans l'interface, avec les droits réels)
//
// Aucune preuve ne passe par l'interface. Les refus et les réglages sont éprouvés sur un ESPACE DE SONDE, `sonde-216`, posé par la
// clé de service avec Camille pour administratrice et Farida pour lectrice, et retiré avant et après le scénario ; le retrait est
// constaté. L'espace du seed et « Studio Lumen » ne sont jamais écrits : leur fuseau est seulement LU (le seed, §57).

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'
import { DOMAINE } from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const ESPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const SLUG_SONDE = 'sonde-216'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = { 'Content-Type': 'application/json' }

async function regler(enTetes: Record<string, string>, espace: string | null, fuseau: string) {
	const reponse = await fetch(rpc('workspace_set_timezone'), {
		method: 'POST',
		headers: { ...enTetes, ...json },
		body: JSON.stringify({ p_workspace_id: espace, p_timezone: fuseau }),
	})
	const texte = await reponse.text()
	const corps = texte === '' ? null : (JSON.parse(texte) as { message?: string; code?: string })
	return { statut: reponse.status, message: corps?.message, code: corps?.code }
}

async function fuseauDe(espace: string): Promise<string> {
	const reponse = await fetch(rest(`workspaces?id=eq.${espace}&select=timezone`), { headers: enTetesService() })
	return ((await reponse.json()) as { timezone: string }[])[0]!.timezone
}

async function lignesDAudit(espace: string): Promise<number> {
	const reponse = await fetch(rest(`audit_log?workspace_id=eq.${espace}&entity_type=eq.workspace&select=id`), { headers: enTetesService() })
	return ((await reponse.json()) as unknown[]).length
}

async function purgerSonde(): Promise<void> {
	await fetch(rest(`workspaces?slug=eq.${SLUG_SONDE}`), { method: 'DELETE', headers: enTetesService() })
	const restants = await fetch(rest(`workspaces?slug=eq.${SLUG_SONDE}&select=id`), { headers: enTetesService() })
	expect(await restants.json(), 'l’espace de sonde ne doit pas rester dans la base').toEqual([])
}

let sonde = ''

test.describe('Le fuseau de l’espace (docs/SPEC-modeles-emails.md §8.6 bis)', () => {
	test.beforeAll(async () => {
		await purgerSonde()
		const creation = await fetch(rest('workspaces'), {
			method: 'POST',
			headers: { ...enTetesService(), ...json, Prefer: 'return=representation' },
			body: JSON.stringify({ name: 'Espace de sonde 216', slug: SLUG_SONDE }),
		})
		sonde = ((await creation.json()) as { id: string }[])[0]!.id
		const membres = await fetch(rest('workspace_members'), {
			method: 'POST',
			headers: { ...enTetesService(), ...json },
			body: JSON.stringify([
				{ workspace_id: sonde, user_id: CAMILLE, role: 'admin' },
				{ workspace_id: sonde, user_id: FARIDA, role: 'viewer' },
			]),
		})
		expect(membres.status).toBe(201)
	})
	test.afterAll(purgerSonde)

	test('un espace neuf porte Europe/Paris, et le seed règle « Studio Lumen » à Montréal sans toucher l’espace principal', async () => {
		expect(await fuseauDe(sonde)).toBe('Europe/Paris')
		expect(await fuseauDe(ESPACE_SEED)).toBe('Europe/Paris')
		const lumen = await fetch(rest('workspaces?slug=eq.studio-lumen&select=timezone'), { headers: enTetesService() })
		expect(((await lumen.json()) as { timezone: string }[])[0]?.timezone).toBe('America/Montreal')
	})

	test('la lectrice, l’administrateur d’un autre espace et l’anonyme ne règlent rien : le refus vient de la base', async () => {
		const avant = await fuseauDe(sonde)
		const lectrice = await regler(enTetesAuthentifies(await jetonDe(`viewer@${DOMAINE}`)), sonde, 'UTC')
		expect(lectrice.statut, 'la lectrice est refusée').toBe(403)
		expect(lectrice.message).toBe('forbidden')
		expect(lectrice.code).toBe('42501')

		// Driss (`bizdev@`) n'est pas membre de la sonde : c'est, pour lui, un espace étranger.
		const etranger = await regler(enTetesAuthentifies(await jetonDe(`bizdev@${DOMAINE}`)), sonde, 'UTC')
		expect(etranger.statut, 'un non-membre est refusé').toBe(403)
		expect(etranger.message).toBe('forbidden')

		const inconnu = await regler(enTetesAuthentifies(await jetonDe(`admin@${DOMAINE}`)), '5eed0000-0000-4000-8000-00000000dead', 'UTC')
		expect(inconnu.statut, 'un espace inexistant rend le même refus').toBe(403)
		expect(inconnu.message).toBe('forbidden')

		const sansJeton = await fetch(rpc('workspace_set_timezone'), {
			method: 'POST',
			headers: { ...json, apikey: enTetesService()['apikey'] ?? '' },
			body: JSON.stringify({ p_workspace_id: sonde, p_timezone: 'UTC' }),
		})
		expect([401, 403], 'l’anonyme n’exécute pas la fonction').toContain(sansJeton.status)
		expect(await fuseauDe(sonde), 'aucun refus n’a laissé de trace').toBe(avant)
	})

	test('un nom de fuseau inconnu est refusé, par la fonction et par la contrainte', async () => {
		const enTetes = enTetesAuthentifies(await jetonDe(`admin@${DOMAINE}`))
		const refus = await regler(enTetes, sonde, 'Mars/Phobos')
		expect(refus.statut).toBe(400)
		expect(refus.message).toBe('invalid_timezone')
		expect(refus.code).toBe('22023')

		// Même sous la clé de service, qui contourne les politiques : la CONTRAINTE tient.
		const direct = await fetch(rest(`workspaces?id=eq.${sonde}`), {
			method: 'PATCH',
			headers: { ...enTetesService(), ...json },
			body: JSON.stringify({ timezone: 'Mars/Phobos' }),
		})
		expect(direct.status, 'l’écriture directe d’un faux nom est refusée par la contrainte').toBe(400)
		expect(((await direct.json()) as { code: string }).code).toBe('23514')
		expect(await fuseauDe(sonde)).toBe('Europe/Paris')
	})

	test('l’administratrice règle son espace ; le même fuseau réécrit n’écrit rien au journal ; un autre l’y inscrit', async () => {
		const enTetes = enTetesAuthentifies(await jetonDe(`admin@${DOMAINE}`))
		const avant = await lignesDAudit(sonde)
		const reglage = await regler(enTetes, sonde, 'America/Montreal')
		expect(reglage.statut).toBe(204)
		expect(await fuseauDe(sonde)).toBe('America/Montreal')
		expect(await lignesDAudit(sonde), 'le changement est inscrit au journal d’audit de l’espace').toBe(avant + 1)

		const identique = await regler(enTetes, sonde, 'America/Montreal')
		expect(identique.statut).toBe(204)
		expect(await lignesDAudit(sonde), 'le même fuseau réécrit ne laisse aucune ligne').toBe(avant + 1)

		// L'espace du seed n'a pas bougé : le réglage est celui d'UN espace.
		expect(await fuseauDe(ESPACE_SEED)).toBe('Europe/Paris')
	})

	test('la superadministratrice règle un espace dont elle n’est pas membre', async () => {
		const enTetes = enTetesAuthentifies(await jetonDe(`plateforme@${DOMAINE}`))
		const reglage = await regler(enTetes, sonde, 'Europe/Lisbon')
		expect(reglage.statut).toBe(204)
		expect(await fuseauDe(sonde)).toBe('Europe/Lisbon')
	})
})
