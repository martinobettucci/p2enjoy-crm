// @verifies CRM-111 (docs/BACKLOG.md) — tranche T6.2 : le rendu d'un modèle par rattachement, par la vraie route
// @verifies docs/SPEC-modeles-emails.md §15.2 (le rattachement désigné ; zéro ligne pour un rattachement d'une autre
//           affaire ou d'un track fermé), §15.5 (preuves API) ; docs/SPEC-rattachements.md §7 ; CLAUDE.md §10
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service avec un montant de 12 000, que
// l'administratrice rattache aussi à `grands-comptes` (track « Conseil & IA », fermé à la lectrice) par `attach_card` ;
// le second rattachement reçoit un montant de 4 321. Le modèle « Relance sans réponse » du seed cite `card.amount`. Tout
// est retiré après le scénario.

import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { posterAffaire } from '../affaire'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const W = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
/** « Relance sans réponse » — `docs/SPEC-seed.md` §14.1 ; son corps cite `{{card.amount}}`. */
const MODELE_RELANCE = '7e11a7e0-0000-4000-8000-000000000001'
/** `Refonte intranet Ville de Lyon`, une AUTRE affaire du seed. */
const AUTRE_AFFAIRE = '5eed0000-0000-4000-8000-0000000000c4'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

type Rendu = { subject: string; body_text: string; variables_nulles: string[] }

let affaire = ''

test.afterEach(async ({ request }) => {
	if (affaire === '') return
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
	affaire = ''
})

test('chaque rattachement rend ses propres variables ; un rattachement étranger ou fermé rend zéro ligne', async ({ request }) => {
	affaire = randomUUID()
	const pose = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL,
			current_step_id: ETAPE_INITIALE, title: 'Portail partagé des adhérents', amount: 12000,
		},
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const admin = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
	const rattache = await request.post(rest('rpc/attach_card'), { headers: admin, data: { p_card: affaire, p_channel: GRANDS_COMPTES } })
	expect(rattache.status(), await rattache.text()).toBe(200)

	const lus = await request.get(rest(`card_placements?card_id=eq.${affaire}&select=id,channel_id&order=created_at,id`), {
		headers: enTetesService(),
	})
	const rattachements = (await lus.json()) as { id: string; channel_id: string }[]
	const premier = rattachements.find((r) => r.channel_id === REFONTE)!.id
	const second = rattachements.find((r) => r.channel_id === GRANDS_COMPTES)!.id
	const montant = await request.patch(rest(`card_placements?id=eq.${second}`), {
		headers: { ...enTetesService(), Prefer: 'return=minimal' },
		data: { amount: 4321 },
	})
	expect(montant.status(), await montant.text()).toBe(204)

	const rendre = async (entetes: Record<string, string>, carte: string, rattachement?: string) => {
		const reponse = await request.post(rest('rpc/rendre_modele_email'), {
			headers: entetes,
			data: { p_template_id: MODELE_RELANCE, p_card_id: carte, ...(rattachement ? { p_placement_id: rattachement } : {}) },
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		return (await reponse.json()) as Rendu[]
	}

	// L'administratrice : chaque rattachement rend SON montant ; sans désignation, le plus ancien.
	expect((await rendre(admin, affaire, premier))[0]?.body_text).toContain('(12000.00 EUR)')
	expect((await rendre(admin, affaire, second))[0]?.body_text).toContain('(4321.00 EUR)')
	expect((await rendre(admin, affaire))[0]?.body_text).toContain('(12000.00 EUR)')
	// Un rattachement d'une autre affaire : zéro ligne, jamais l'autre affaire sur ce channel.
	expect(await rendre(admin, AUTRE_AFFAIRE, second)).toEqual([])

	// La lectrice, fermée à « Conseil & IA » : elle rend le rattachement qu'elle lit, et zéro ligne pour l'autre.
	const lectrice = enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test'))
	expect((await rendre(lectrice, affaire, premier))[0]?.body_text).toContain('(12000.00 EUR)')
	expect(await rendre(lectrice, affaire, second)).toEqual([])
})
