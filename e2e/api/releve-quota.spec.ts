// @verifies CRM-136 (docs/BACKLOG.md) — tranche T3 : les réglages de relève et le quota par une requête directe qui contourne
//           l'interface, avec de vrais jetons — un membre règle l'historique et les dossiers de SA boîte et se voit refuser
//           ceux de la boîte d'une collègue (le test de connexion en 404, l'écriture en 42501) ; une identité reçoit un
//           plafond puis revient à « aucun plafond », relu `null` en base ; un appel sans le drapeau conserve le plafond
// @verifies docs/SPEC-mail-subsystem.md §25.3 à §25.6, §25.9 (ligne « API ») ; docs/SCHEMA.md « Migration `0178` » ;
//           CLAUDE.md §10
//
// Les boîtes et les identités sont celles du seed (docs/SPEC-seed.md §22). Chaque ligne touchée est remise dans son état
// d'avant, même en cas d'échec.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

type Boite = { id: string; label: string; imap_host: string; imap_port: number; imap_security: string; imap_username: string; watch_folders: string[]; backfill_months: number }
type Identite = { id: string; label: string; smtp_host: string; smtp_port: number; smtp_security: string; smtp_username: string; from_address: string; daily_quota: number | null }

async function service<T>(request: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await request.get(`${URL_API}/rest/v1/${chemin}`, { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

const boiteDe = async (request: APIRequestContext, proprietaire: string) =>
	(await service<Boite[]>(request, `mail_inbound_accounts?select=id,label,imap_host,imap_port,imap_security,imap_username,watch_folders,backfill_months&owner_id=eq.${proprietaire}`))[0]!

const ecrireBoite = (request: APIRequestContext, jeton: string, boite: Boite, proprietaire: string, reglages: Record<string, unknown>) =>
	request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
		headers: enTetesAuthentifies(jeton),
		data: {
			p_workspace_id: WORKSPACE,
			p_label: boite.label,
			p_imap_host: boite.imap_host,
			p_imap_port: boite.imap_port,
			p_imap_security: boite.imap_security,
			p_imap_username: boite.imap_username,
			p_owner_id: proprietaire,
			...reglages,
		},
	})

test.describe('les réglages de relève et le quota (§25.3 à §25.6)', () => {
	test('un membre règle sa boîte, jamais celle d’une collègue', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const sienne = await boiteDe(request, DRISS)
		const deCamille = await boiteDe(request, CAMILLE)
		try {
			const ecrite = await ecrireBoite(request, driss, sienne, DRISS, { p_backfill_months: 3, p_watch_folders: ['INBOX'] })
			expect(ecrite.status(), await ecrite.text()).toBe(200)
			expect(await boiteDe(request, DRISS)).toMatchObject({ backfill_months: 3, watch_folders: ['INBOX'] })

			// LA BOÎTE DE CAMILLE : la liste de ses dossiers lui est refusée comme une ligne absente (404), et l'écriture en 42501.
			const test = await request.post(`${URL_API}/functions/v1/mail-connection-test`, {
				headers: enTetesAuthentifies(driss),
				data: { target: 'inbound', id: deCamille.id },
			})
			expect(test.status()).toBe(404)
			expect(await test.json()).toEqual({ error: 'not_found' })
			const refusee = await ecrireBoite(request, driss, deCamille, CAMILLE, { p_watch_folders: ['INBOX'], p_backfill_months: 12 })
			expect(refusee.status(), await refusee.text()).toBe(403)
			expect(((await refusee.json()) as { code: string }).code).toBe('42501')
			expect(await boiteDe(request, CAMILLE)).toMatchObject({ backfill_months: deCamille.backfill_months, watch_folders: deCamille.watch_folders })

			// Les bornes de la base, que l'écran traduit : aucun dossier, et un historique hors de 0 à 120.
			const vide = await ecrireBoite(request, driss, sienne, DRISS, { p_watch_folders: [] })
			expect(await vide.text()).toContain('mail_inbound_accounts_watch_folders_non_vide')
			const profond = await ecrireBoite(request, driss, sienne, DRISS, { p_backfill_months: 121 })
			expect(await profond.text()).toContain('mail_inbound_accounts_backfill_borne')
		} finally {
			await ecrireBoite(request, driss, sienne, DRISS, { p_backfill_months: sienne.backfill_months, p_watch_folders: sienne.watch_folders })
		}
	})

	test('une identité reçoit un plafond, le garde sans le drapeau, puis revient à « aucun plafond »', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const [identite] = await service<Identite[]>(
			request,
			`mail_outbound_identities?select=id,label,smtp_host,smtp_port,smtp_security,smtp_username,from_address,daily_quota&owner_id=eq.${DRISS}&is_default=is.true`,
		)
		const ecrire = (reglages: Record<string, unknown>) =>
			request.post(`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`, {
				headers: enTetesAuthentifies(driss),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: identite!.label,
					p_smtp_host: identite!.smtp_host,
					p_smtp_port: identite!.smtp_port,
					p_smtp_security: identite!.smtp_security,
					p_smtp_username: identite!.smtp_username,
					p_from_address: identite!.from_address,
					p_owner_id: DRISS,
					...reglages,
				},
			})
		const quota = async () =>
			(await service<{ daily_quota: number | null }[]>(request, `mail_outbound_identities?select=daily_quota&id=eq.${identite!.id}`))[0]!.daily_quota
		try {
			expect((await ecrire({ p_daily_quota: 150, p_daily_quota_set: true })).status()).toBe(200)
			expect(await quota()).toBe(150)
			expect((await ecrire({})).status()).toBe(200)
			expect(await quota(), 'sans le drapeau, le plafond est conservé').toBe(150)
			expect((await ecrire({ p_daily_quota: null, p_daily_quota_set: true })).status()).toBe(200)
			expect(await quota(), 'retour à « aucun plafond »').toBeNull()
			const borne = await ecrire({ p_daily_quota: 100001, p_daily_quota_set: true })
			expect(await borne.text()).toContain('mail_outbound_identities_quota_borne')
		} finally {
			await ecrire({ p_daily_quota: identite!.daily_quota, p_daily_quota_set: true })
		}
	})
})
