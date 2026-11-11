// @verifies CRM-136 (docs/BACKLOG.md) — tranche T2 : `folder_names` rendu par un vrai `LIST` pour une boîte, jamais pour une
//           identité sortante (docs/SPEC-mail-subsystem.md §25.3)
// @verifies CRM-127 (docs/BACKLOG.md) — tranches T2 et T3 : tester la connexion d'un compte de messagerie, hors interface
// @verifies docs/SPEC-mail-subsystem.md §23.3 (le droit d'écrire la ligne, `not_found` sans divulgation, `disabled`, garde
//           de 30 s), §23.4 (la fonction edge `mail-connection-test` : forme, session, relais vers `mail-sync`, verdict écrit
//           en base par le service) ; docs/SPEC-permissions-rls.md §7, preuves de refus n° 7 et n° 11 ;
//           docs/JOURNAL.md décision 816 ; CLAUDE.md §10 (toute règle se prouve hors interface)
//
// CE FICHIER APPELLE LA VRAIE FONCTION, DERRIÈRE LA VRAIE PASSERELLE, AVEC LES VRAIS JETONS DES COMPTES DU SEED. Le test de
// connexion ouvre de vraies sessions IMAP et SMTP vers le Stalwart de développement.
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU : chaque ligne touchée retrouve son `status`, son `last_error` et son
// `last_checked_at` d'avant, par la clé de service (leçon d'INC-061).

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesService, jetonDe } from './jetons'

const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FONCTION = `${URL_API}/functions/v1/mail-connection-test`

type Ligne = { id: string; status: string; last_error: string | null; last_checked_at: string | null }
type Table = 'mail_inbound_accounts' | 'mail_outbound_identities'

const lignes: Record<string, { table: Table; avant: Ligne }> = {}

async function lire(request: import('@playwright/test').APIRequestContext, table: Table, filtre: string): Promise<Ligne> {
	const reponse = await request.get(`${URL_API}/rest/v1/${table}?select=id,status,last_error,last_checked_at&${filtre}`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	const [ligne] = (await reponse.json()) as Ligne[]
	expect(ligne, `${table} ${filtre}`).toBeDefined()
	return ligne!
}

async function retenir(request: import('@playwright/test').APIRequestContext, table: Table, filtre: string): Promise<Ligne> {
	const ligne = await lire(request, table, filtre)
	lignes[ligne.id] ??= { table, avant: ligne }
	// Un test récent laissé par une campagne précédente déclencherait la garde de 30 s : on part d'une ligne sans test.
	await request.patch(`${URL_API}/rest/v1/${table}?id=eq.${ligne.id}`, {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: { last_checked_at: null },
	})
	return ligne
}

const appeler = (request: import('@playwright/test').APIRequestContext, corps: unknown, jeton: string | null) =>
	request.post(FONCTION, {
		headers: { apikey: CLE_ANONYME, 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
		data: corps,
	})

test.describe.configure({ mode: 'serial' })

test.describe('mail-connection-test — ce que la pile consent', () => {
	test.afterAll(async ({ request }) => {
		for (const [id, { table, avant }] of Object.entries(lignes)) {
			await request.patch(`${URL_API}/rest/v1/${table}?id=eq.${id}`, {
				headers: { ...enTetesService(), prefer: 'return=minimal' },
				data: { status: avant.status, last_error: avant.last_error, last_checked_at: avant.last_checked_at },
			})
		}
	})

	test('sans session, la base refuse : 401, et aucun test n’a lieu', async ({ request }) => {
		const systeme = await retenir(request, 'mail_inbound_accounts', 'owner_id=is.null')
		const reponse = await appeler(request, { target: 'inbound', id: systeme.id }, null)
		expect(reponse.status()).toBe(401)
		expect(await reponse.json()).toEqual({ error: 'unauthorized' })
		expect((await lire(request, 'mail_inbound_accounts', `id=eq.${systeme.id}`)).last_checked_at).toBeNull()
	})

	test('une demande mal formée est refusée par 400 avant toute lecture', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		expect((await appeler(request, { target: 'carrier-pigeon', id: CAMILLE }, jeton)).status()).toBe(400)
		expect((await appeler(request, { target: 'inbound', id: '42' }, jeton)).status()).toBe(400)
	})

	test('un membre ne teste ni la boîte système ni celle d’une collègue : le même 404 qu’une ligne absente (preuve n° 7)', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const systeme = await retenir(request, 'mail_inbound_accounts', 'owner_id=is.null')
		const camille = await retenir(request, 'mail_inbound_accounts', `owner_id=eq.${CAMILLE}`)
		const service = await retenir(request, 'mail_outbound_identities', 'owner_id=is.null')
		for (const [cible, id] of [
			['inbound', systeme.id],
			['inbound', camille.id],
			['outbound', service.id],
			['inbound', '5eed0000-0000-4000-8000-0000000fffff'],
		] as const) {
			const reponse = await appeler(request, { target: cible, id }, jeton)
			expect(reponse.status(), `${cible} ${id}`).toBe(404)
			expect(await reponse.json()).toEqual({ error: 'not_found' })
		}
		expect((await lire(request, 'mail_inbound_accounts', `id=eq.${systeme.id}`)).last_checked_at).toBeNull()
	})

	test('l’administratrice teste la boîte système : vraie session IMAP, verdict écrit en base par le service', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const systeme = await retenir(request, 'mail_inbound_accounts', 'owner_id=is.null')
		const reponse = await appeler(request, { target: 'inbound', id: systeme.id }, jeton)
		expect(reponse.status()).toBe(200)
		const verdict = (await reponse.json()) as { status: string; error: string | null; checked_at: string; folder_names?: string[] }
		expect(verdict).toMatchObject({ status: 'ok', error: null })
		// `CRM-136` T2 (§25.3) : le vrai `LIST` de Stalwart rend les dossiers sélectionnables de la boîte — `INBOX` d'abord
		// présent —, et jamais la racine `CRM` du produit ni ses descendants.
		expect(verdict.folder_names, JSON.stringify(verdict)).toContain('INBOX')
		expect((verdict.folder_names ?? []).some((nom) => nom === 'CRM' || nom.startsWith('CRM/'))).toBe(false)
		const relue = await lire(request, 'mail_inbound_accounts', `id=eq.${systeme.id}`)
		expect(relue.status).toBe('ok')
		expect(relue.last_checked_at).not.toBeNull()
	})

	test('un second test dans les 30 secondes est refusé par 429', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const systeme = await lire(request, 'mail_inbound_accounts', 'owner_id=is.null')
		const reponse = await appeler(request, { target: 'inbound', id: systeme.id }, jeton)
		expect(reponse.status()).toBe(429)
		expect(await reponse.json()).toEqual({ error: 'too_soon' })
	})

	test('un membre teste sa propre identité d’expédition : vraie session SMTP', async ({ request }) => {
		test.setTimeout(60_000)
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const sienne = await retenir(request, 'mail_outbound_identities', `owner_id=eq.${DRISS}`)
		const reponse = await appeler(request, { target: 'outbound', id: sienne.id }, jeton)
		expect(reponse.status()).toBe(200)
		const verdictSortant = (await reponse.json()) as Record<string, unknown>
		expect(verdictSortant).toMatchObject({ status: 'ok', error: null })
		// `CRM-136` T2 (§25.3) : la réponse d'une identité sortante est inchangée — aucun dossier.
		expect('folder_names' in verdictSortant).toBe(false)
		expect((await lire(request, 'mail_outbound_identities', `id=eq.${sienne.id}`)).status).toBe('ok')
	})

	test('une ligne désactivée ne se teste pas : 409, et son état d’exploitation reste intact', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const sienne = await retenir(request, 'mail_inbound_accounts', `owner_id=eq.${DRISS}`)
		await request.patch(`${URL_API}/rest/v1/mail_inbound_accounts?id=eq.${sienne.id}`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { status: 'disabled' },
		})
		const reponse = await appeler(request, { target: 'inbound', id: sienne.id }, jeton)
		expect(reponse.status()).toBe(409)
		expect(await reponse.json()).toEqual({ error: 'disabled' })
		expect((await lire(request, 'mail_inbound_accounts', `id=eq.${sienne.id}`)).status).toBe('disabled')
	})
})
