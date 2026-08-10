// @verifies CRM-053 (docs/BACKLOG.md) — identités sortantes SMTP, contrat d'API
// @verifies docs/SPEC-mail-subsystem.md §2.2 (entrant et sortant divergent), §14.2 (identité par
//           défaut), §14.3 (qui lit quoi), §14.4 (la voie de sortie du secret)
// @verifies docs/SPEC-permissions-rls.md §7, secondes moitiés des refus n° 6 et n° 7
// @verifies docs/JOURNAL.md décision 318 ; CLAUDE.md §10
//
// Le seed est rendu intact : le seul scénario qui écrit remet la valeur d'origine dans son
// `finally`, par le même chemin d'écriture (leçon d'INC-061).

import { expect, test } from '@playwright/test'
import {
	MOT_DE_PASSE_SEED,
	URL_API,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

type Identite = {
	readonly id: string
	readonly owner_id: string | null
	readonly from_address: string
	readonly smtp_username: string
	readonly is_default: boolean
	readonly status: string
}

test.describe('identités sortantes — ce que la pile consent', () => {
	// LE CAS D'USAGE DU §2.2, MESURÉ PLUTÔT QUE DÉCRIT : entrant et sortant divergent.
	test('Driss reçoit sur `bizdev@` et expédie depuis `contact@`', async ({ request }) => {
		const sortantes = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=from_address,smtp_username`,
			{ headers: enTetesService() },
		)
		const [identite] = (await sortantes.json()) as Identite[]
		expect(identite?.from_address).toBe('contact@p2enjoy.test')

		const entrants = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=eq.${DRISS}&select=imap_username`,
			{ headers: enTetesService() },
		)
		const [compte] = (await entrants.json()) as { imap_username: string }[]
		expect(compte?.imap_username).toBe('bizdev@p2enjoy.test')
		expect(identite?.from_address).not.toBe(compte?.imap_username)
	})

	test('REFUS N° 7, seconde moitié : un membre ne voit QUE ses identités', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const lues = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=id,owner_id,from_address,smtp_username,is_default,status`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(lues.status()).toBe(200)
		const lignes = (await lues.json()) as Identite[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.owner_id).toBe(DRISS)

		// Contre-épreuve : l'identité de service EXISTE. Sans elle, « une seule ligne » prouverait
		// aussi bien la RLS qu'un seed incomplet.
		const toutes = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=id`,
			{ headers: enTetesService() },
		)
		expect((await toutes.json()) as unknown[]).toHaveLength(2)
	})

	test('REFUS N° 6, seconde moitié : `secret_id` est illisible sur une ligne que l’on voit', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const visible = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=id,from_address`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(visible.status()).toBe(200)
		expect((await visible.json()) as unknown[]).toHaveLength(1)

		const refuse = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=secret_id`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(refuse.status()).toBe(403)
		expect(await refuse.text()).toContain('42501')
	})

	test('l’administratrice voit les deux, et n’en possède aucune', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const lues = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=id,owner_id,from_address,smtp_username,is_default,status`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const lignes = (await lues.json()) as Identite[]
		expect(lignes).toHaveLength(2)
		expect(lignes.filter((ligne) => ligne.owner_id === CAMILLE)).toHaveLength(0)
	})

	test('REFUS N° 11 : un anonyme ne lit rien', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/mail_outbound_identities?select=id`, {
			headers: enTetesAnonymes(),
		})
		expect([401, 403]).toContain(reponse.status())
	})

	test('aucune écriture directe, et la voie de sortie du secret est réservée', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const entetes = enTetesAuthentifies(jeton)

		const insertion = await request.post(`${URL_API}/rest/v1/mail_outbound_identities`, {
			headers: entetes,
			data: {
				workspace_id: WORKSPACE,
				label: 'Forgée',
				smtp_host: 'stalwart',
				smtp_port: 587,
				smtp_security: 'none',
				smtp_username: 'u@p2enjoy.test',
				from_address: 'forge@p2enjoy.test',
			},
		})
		expect(insertion.status()).toBe(403)

		const maj = await request.patch(
			`${URL_API}/rest/v1/mail_outbound_identities?owner_id=is.null`,
			{ headers: entetes, data: { status: 'ok' } },
		)
		expect(maj.status()).toBe(403)

		const service = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?owner_id=is.null&select=id`,
			{ headers: enTetesService() },
		)
		const [identite] = (await service.json()) as { id: string }[]

		for (const jeu of [entetes, enTetesAnonymes()]) {
			const refus = await request.post(
				`${URL_API}/rest/v1/rpc/mail_outbound_identity_credentials`,
				{ headers: jeu, data: { p_identity_id: identite?.id } },
			)
			expect([401, 403, 404]).toContain(refus.status())
		}

		const parService = await request.post(
			`${URL_API}/rest/v1/rpc/mail_outbound_identity_credentials`,
			{ headers: enTetesService(), data: { p_identity_id: identite?.id } },
		)
		expect(parService.status()).toBe(200)
		const [identifiants] = (await parService.json()) as { password: string }[]
		expect(identifiants?.password).toBe(MOT_DE_PASSE_SEED)
	})

	// LE DÉFAUT SE DÉPLACE, IL NE SE DISPUTE PAS — et l'état n'est jamais « aucune identité par
	// défaut », pas même un instant.
	test('déclarer une seconde identité déplace le défaut, sans jamais le perdre', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const ecrire = async (adresse: string, parDefaut: boolean) =>
			await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`, {
				headers: enTetesAuthentifies(jeton),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: `Envoi ${adresse}`,
					p_smtp_host: 'stalwart',
					p_smtp_port: 587,
					p_smtp_security: 'none',
					p_smtp_username: 'bizdev@p2enjoy.test',
					p_from_address: adresse,
					p_password: MOT_DE_PASSE_SEED,
					p_owner_id: DRISS,
					p_is_default: parDefaut,
				},
			})

		let creee: string | undefined
		try {
			const seconde = await ecrire('secondaire@p2enjoy.test', true)
			expect(seconde.status()).toBe(200)
			creee = (await seconde.json()) as string

			const apres = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=id,owner_id,from_address,smtp_username,is_default,status`,
				{ headers: enTetesService() },
			)
			const lignes = (await apres.json()) as Identite[]
			expect(lignes).toHaveLength(2)
			expect(lignes.filter((ligne) => ligne.is_default)).toHaveLength(1)
			expect(lignes.find((ligne) => ligne.is_default)?.from_address).toBe(
				'secondaire@p2enjoy.test',
			)
		} finally {
			if (creee !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${creee}`, {
					headers: enTetesService(),
				})
				// Le défaut de Driss est rendu : la suppression ne le rétablit pas d'elle-même.
				await ecrire('contact@p2enjoy.test', true)
			}
		}
	})
})
