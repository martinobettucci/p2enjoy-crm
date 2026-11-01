// @verifies CRM-123 (docs/BACKLOG.md) — tranche T2 : le préfixe des adresses d'affaire et la régénération, en requête
//           directe aux vrais jetons
// @verifies docs/SPEC-cards.md §3.6 (points 2, 3, 5 et 7) ; docs/SPEC-plateforme.md §6.1, §6.2 ; docs/JOURNAL.md
//           décision 804 ; CLAUDE.md §10 (la règle est tenue par la base, éprouvée sans l'interface, avec les droits réels)
//
// Aucune preuve ne passe par l'interface. Les refus sont éprouvés sur l'ESPACE SEEDÉ, qu'ils ne modifient pas — c'est
// leur objet. Le parcours du superadministrateur se joue sur un espace de SONDE, `sonde-123`, posé par la clé de service
// avec trois affaires, et retiré avant et après le scénario ; le retrait est constaté.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'
import { DOMAINE } from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const ESPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const SABINE = `plateforme@${DOMAINE}`
const SLUG_SONDE = 'sonde-123'
const FORME_APP = /^app-[0-9abcdefghjkmnpqrstvwxyz]{8}$/u

const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function appeler(nom: string, enTetes: Record<string, string>, corps: Record<string, unknown>) {
	const reponse = await fetch(rpc(nom), { method: 'POST', headers: { ...enTetes, 'Content-Type': 'application/json' }, body: JSON.stringify(corps) })
	const texte = await reponse.text()
	return { statut: reponse.status, corps: texte === '' ? null : (JSON.parse(texte) as unknown) }
}

const messageDe = (corps: unknown): string | undefined =>
	typeof corps === 'object' && corps !== null ? ((corps as { message?: string }).message ?? undefined) : undefined

async function prefixeDe(espace: string): Promise<string> {
	const reponse = await fetch(rest(`workspaces?id=eq.${espace}&select=card_address_prefix`), { headers: enTetesService() })
	return ((await reponse.json()) as { card_address_prefix: string }[])[0]!.card_address_prefix
}

async function purgerSonde(): Promise<void> {
	await fetch(rest(`workspaces?slug=eq.${SLUG_SONDE}`), { method: 'DELETE', headers: enTetesService() })
	const restants = await fetch(rest(`workspaces?slug=eq.${SLUG_SONDE}&select=id`), { headers: enTetesService() })
	expect(await restants.json(), 'l’espace de sonde ne doit pas rester dans la base').toEqual([])
}

test.describe('Le préfixe des adresses d’affaire (docs/SPEC-cards.md §3.6)', () => {
	test.beforeAll(purgerSonde)
	test.afterAll(purgerSonde)

	test('la lectrice, l’administratrice d’espace et l’anonyme ne règlent ni ne régénèrent, et rien ne change', async () => {
		const avant = await prefixeDe(ESPACE_SEED)
		for (const [qui, adresse] of [
			['la lectrice', `viewer@${DOMAINE}`],
			['l’administratrice d’espace', `admin@${DOMAINE}`],
		] as const) {
			const enTetes = enTetesAuthentifies(await jetonDe(adresse))
			const reglage = await appeler('plateforme_modifier_espace', enTetes, {
				p_id: ESPACE_SEED, p_nom: 'P2Enjoy SAS', p_domaine_entrant: 'crm.p2enjoy.test', p_card_address_prefix: 'app-',
			})
			expect(reglage.statut, `${qui} : réglage refusé`).toBe(403)
			expect(messageDe(reglage.corps)).toBe('reserve_aux_superadministrateurs')
			const regeneration = await appeler('platform_regenerate_card_addresses', enTetes, { p_workspace_id: ESPACE_SEED })
			expect(regeneration.statut, `${qui} : régénération refusée`).toBe(403)
			expect(messageDe(regeneration.corps)).toBe('reserve_aux_superadministrateurs')
			// Aucune écriture directe de la colonne : le privilège n'existe pas pour un client (§3.6 point 5).
			const directe = await fetch(rest(`workspaces?id=eq.${ESPACE_SEED}`), {
				method: 'PATCH',
				headers: { ...enTetes, 'Content-Type': 'application/json', Prefer: 'return=representation' },
				body: JSON.stringify({ card_address_prefix: 'app-' }),
			})
			expect(directe.status, `${qui} : écriture directe refusée`).toBe(403)
		}
		const anonymes = { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}` }
		const anonyme = await appeler('platform_regenerate_card_addresses', anonymes, { p_workspace_id: ESPACE_SEED })
		expect([401, 403], 'l’anonyme n’exécute pas la fonction').toContain(anonyme.statut)
		expect(await prefixeDe(ESPACE_SEED), 'le préfixe de l’espace seedé est inchangé').toBe(avant)
	})

	test('le superadministrateur règle le préfixe, voit le décompte, régénère, et le rejeu ne réécrit rien', async () => {
		const service = { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' }
		const pose = await fetch(rest('workspaces'), {
			method: 'POST',
			headers: service,
			body: JSON.stringify({ name: 'Sonde 123', slug: SLUG_SONDE, inbound_domain: 'crm.sonde-123.test' }),
		})
		expect(pose.status, 'espace de sonde posé par la clé de service').toBe(201)
		const [espace] = (await pose.json()) as { id: string; card_address_prefix: string }[]
		expect(espace!.card_address_prefix, 'un espace neuf reçoit « c- »').toBe('c-')
		const cartes = await fetch(rest('cards'), {
			method: 'POST',
			headers: service,
			body: JSON.stringify(['Une', 'Deux', 'Trois'].map((titre) => ({ workspace_id: espace!.id, title: `Sonde 123 ${titre}` }))),
		})
		expect(cartes.status).toBe(201)
		const avant = (await cartes.json()) as { id: string; email_local_part: string }[]
		expect(avant.every((carte) => /^c-/u.test(carte.email_local_part))).toBe(true)

		const sabine = enTetesAuthentifies(await jetonDe(SABINE))
		const refuse = await appeler('plateforme_modifier_espace', sabine, {
			p_id: espace!.id, p_nom: 'Sonde 123', p_domaine_entrant: 'crm.sonde-123.test', p_card_address_prefix: 'app*',
		})
		expect(refuse.statut, 'un préfixe hors forme est refusé').toBe(400)
		expect(messageDe(refuse.corps)).toBe('invalid_card_address_prefix')

		const regle = await appeler('plateforme_modifier_espace', sabine, {
			p_id: espace!.id, p_nom: 'Sonde 123', p_domaine_entrant: 'crm.sonde-123.test', p_card_address_prefix: ' APP- ',
		})
		expect(regle.statut, 'le superadministrateur règle le préfixe').toBe(204)
		expect(await prefixeDe(espace!.id), 'le préfixe est rangé normalisé').toBe('app-')

		const liste = await appeler('plateforme_espaces', sabine, {})
		const ligne = (liste.corps as { id: string; card_address_prefix: string; card_addresses_to_regenerate: number }[]).find((l) => l.id === espace!.id)
		expect(ligne).toMatchObject({ card_address_prefix: 'app-', card_addresses_to_regenerate: 3 })

		const regeneration = await appeler('platform_regenerate_card_addresses', sabine, { p_workspace_id: espace!.id })
		expect(regeneration).toEqual({ statut: 200, corps: 3 })
		const apres = (await (await fetch(rest(`cards?workspace_id=eq.${espace!.id}&select=id,email_local_part`), { headers: enTetesService() })).json()) as {
			id: string
			email_local_part: string
		}[]
		expect(apres).toHaveLength(3)
		for (const carte of apres) expect(carte.email_local_part, 'adresse régénérée au préfixe').toMatch(FORME_APP)

		const rejeu = await appeler('platform_regenerate_card_addresses', sabine, { p_workspace_id: espace!.id })
		expect(rejeu, 'le rejeu ne réécrit rien').toEqual({ statut: 200, corps: 0 })
		const relues = (await (await fetch(rest(`cards?workspace_id=eq.${espace!.id}&select=id,email_local_part&order=id`), { headers: enTetesService() })).json()) as unknown[]
		expect(relues).toEqual([...apres].sort((a, b) => a.id.localeCompare(b.id)))

		const journal = await fetch(rest(`plateforme_journal?workspace_id=eq.${espace!.id}&geste=eq.card_addresses_regenerated&select=cible`), {
			headers: enTetesService(),
		})
		expect(await journal.json(), 'une seule entrée de journal : le rejeu sans effet ne journalise rien').toEqual([
			{ cible: { card_address_prefix: 'app-', count: 3 } },
		])
	})
})
