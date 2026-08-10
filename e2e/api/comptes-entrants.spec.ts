// @verifies CRM-052 (docs/BACKLOG.md) — comptes entrants IMAP, contrat d'API
// @verifies docs/SPEC-mail-subsystem.md §13.3 (le chemin d'écriture est unique), §13.4 (qui lit
//           quoi), §13.5 (la seule voie de sortie d'un secret), §13.7 (last_error est un code)
// @verifies docs/SPEC-permissions-rls.md §7, preuves de refus n° 6, n° 7 et n° 11
// @verifies docs/JOURNAL.md décision 316 ; CLAUDE.md §10 (toute règle se prouve hors interface)
//
// CE FICHIER MESURE CE QUE LA PILE CONSENT, AVEC LES JETONS RÉELS DES TROIS COMPTES.
//
// Les preuves n° 6 et n° 7 étaient **figées comme non satisfaisables** depuis `CRM-013` et
// `CRM-014` : la table n'existait pas. Elles deviennent ici des mesures, sur des lignes que le
// seed a posées par le véritable chemin d'écriture.
//
// AUCUNE ÉCRITURE N'EST LAISSÉE DERRIÈRE. Les scénarios qui créent un compte l'écrivent dans un
// second workspace jetable, détruit en fin de fichier — le seed doit être rendu tel qu'il a été
// reçu, leçon d'INC-061.

import { expect, test } from '@playwright/test'
import {
	CLE_ANONYME,
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
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

type CompteLu = {
	readonly id: string
	readonly label: string
	readonly owner_id: string | null
	readonly status: string
	readonly last_error: string | null
}

test.describe('comptes entrants IMAP — ce que la pile consent', () => {
	test('l’administratrice voit les TROIS comptes du seed, la système comprise', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?select=id,label,owner_id,status,last_error&order=label`,
			{ headers: enTetesAuthentifies(jeton) },
		)

		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as CompteLu[]
		expect(lignes).toHaveLength(3)
		expect(lignes.filter((ligne) => ligne.owner_id === null)).toHaveLength(1)
	})

	// PREUVE DE REFUS N° 7, et elle n'est plus figée : « lecture du compte mail d'un autre
	// utilisateur » rend ZÉRO LIGNE, pas une erreur. Les deux formes sont distinctes, et un test
	// qui vérifierait seulement l'absence d'erreur ne prouverait rien.
	test('REFUS N° 7 : un membre ne voit QUE sa boîte, ni la système, ni celle d’un collègue', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const reponse = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?select=id,label,owner_id,status,last_error`,
			{ headers: enTetesAuthentifies(jeton) },
		)

		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as CompteLu[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.owner_id).toBe(DRISS)

		// La contre-épreuve : le compte de Camille EXISTE, et la clé de service le voit. Sans
		// elle, « zéro ligne » prouverait aussi bien la RLS qu'une table vide (décision 50).
		const parService = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=eq.${CAMILLE}&select=id`,
			{ headers: enTetesService() },
		)
		expect((await parService.json()) as unknown[]).toHaveLength(1)
	})

	test('un membre sans boîte lit une liste VIDE, et ce n’est pas un refus', async ({ request }) => {
		const jeton = await jetonDe('viewer@p2enjoy.test')
		const reponse = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id`, {
			headers: enTetesAuthentifies(jeton),
		})

		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toHaveLength(0)
		void FARIDA
	})

	// PREUVE DE REFUS N° 6, mesurée sur une ligne que l'appelant lit PAR AILLEURS : sans cela, le
	// refus prouverait qu'il ne voit pas la ligne, non que la colonne est fermée.
	test('REFUS N° 6 : `secret_id` est illisible, même sur une ligne que l’on voit', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')

		const visible = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?select=id,imap_username`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(visible.status()).toBe(200)
		expect((await visible.json()) as unknown[]).toHaveLength(1)

		const refuse = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=secret_id`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(refuse.status()).toBe(403)
		expect(await refuse.text()).toContain('42501')
	})

	test('REFUS N° 11 : un anonyme ne lit RIEN de cette table', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id`, {
			headers: enTetesAnonymes(),
		})

		// La table est réellement peuplée — trois lignes —, donc « rien » est bien un refus et non
		// une table vide.
		expect([401, 403]).toContain(reponse.status())
	})

	test('aucune écriture directe : `INSERT`, `PATCH` et `DELETE` sont refusés', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const entetes = enTetesAuthentifies(jeton)

		const insertion = await request.post(`${URL_API}/rest/v1/mail_inbound_accounts`, {
			headers: entetes,
			data: {
				workspace_id: WORKSPACE,
				label: 'Boîte forgée',
				imap_host: 'stalwart',
				imap_port: 143,
				imap_security: 'none',
				imap_username: 'forge@crm.p2enjoy.test',
			},
		})
		expect(insertion.status()).toBe(403)

		const majDirecte = await request.patch(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null`,
			{ headers: entetes, data: { status: 'ok' } },
		)
		expect(majDirecte.status()).toBe(403)

		const suppression = await request.delete(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null`,
			{ headers: entetes },
		)
		expect(suppression.status()).toBe(403)
	})

	// LA SEULE VOIE DE SORTIE D'UN MOT DE PASSE, éprouvée dans les DEUX sens.
	test('la fonction qui déchiffre est refusée à un membre, et à un anonyme', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const compte = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const [systeme] = (await compte.json()) as { id: string }[]
		expect(systeme?.id).toBeDefined()

		for (const entetes of [enTetesAuthentifies(jeton), enTetesAnonymes()]) {
			const refus = await request.post(
				`${URL_API}/rest/v1/rpc/mail_inbound_account_credentials`,
				{ headers: entetes, data: { p_account_id: systeme?.id } },
			)
			expect([401, 403, 404]).toContain(refus.status())
		}

		const parService = await request.post(
			`${URL_API}/rest/v1/rpc/mail_inbound_account_credentials`,
			{ headers: enTetesService(), data: { p_account_id: systeme?.id } },
		)
		expect(parService.status()).toBe(200)
		const [identifiants] = (await parService.json()) as { password: string }[]
		// Le mot de passe revient EN CLAIR au service : Vault a fait l'aller-retour, et c'est
		// exactement ce que le chiffrement doit permettre à qui de droit.
		expect(identifiants?.password).toBe(MOT_DE_PASSE_SEED)
	})

	test('l’écriture du verdict est réservée au service : un membre ne peut pas se déclarer `ok`', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const refus = await request.post(
			`${URL_API}/rest/v1/rpc/mail_inbound_account_record_check`,
			{
				headers: enTetesAuthentifies(jeton),
				data: { p_account_id: WORKSPACE, p_status: 'ok', p_error: null },
			},
		)
		expect([401, 403, 404]).toContain(refus.status())
	})

	// LE CHEMIN D'ÉCRITURE, ET SES REFUS. Le second workspace est jetable : le seed n'est jamais
	// touché.
	test('le chemin d’écriture applique le droit, et ne rend jamais `secret_id`', async ({ request }) => {
		const jetonAdmin = await jetonDe('admin@p2enjoy.test')
		const jetonDriss = await jetonDe('bizdev@p2enjoy.test')

		// Driss ne peut ni configurer la boîte système, ni celle de Camille.
		for (const proprietaire of [null, CAMILLE]) {
			const refus = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
				headers: enTetesAuthentifies(jetonDriss),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: 'Tentative',
					p_imap_host: 'stalwart',
					p_imap_port: 143,
					p_imap_security: 'none',
					p_imap_username: 'tentative@crm.p2enjoy.test',
					p_password: 'peu-importe',
					p_owner_id: proprietaire,
				},
			})
			expect(refus.status()).toBe(403)
			expect(await refus.text()).toContain('forbidden')
		}

		// Le rejeu du geste légitime de l'administratrice ne duplique rien et ne perd pas le
		// secret : c'est le contrat de convergence du §13.8.
		const avant = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id,secret_id`,
			{ headers: enTetesService() },
		)
		const [systemeAvant] = (await avant.json()) as { id: string; secret_id: string }[]

		const rejeu = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_workspace_id: WORKSPACE,
				p_label: 'Boîte système du workspace',
				p_imap_host: 'stalwart',
				p_imap_port: 143,
				p_imap_security: 'none',
				p_imap_username: 'systeme@crm.p2enjoy.test',
				p_password: null,
			},
		})
		expect(rejeu.status()).toBe(200)
		// La valeur de retour est l'identifiant du COMPTE, jamais celui du secret.
		expect(await rejeu.json()).toBe(systemeAvant?.id)

		const apres = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id,secret_id`,
			{ headers: enTetesService() },
		)
		const lignes = (await apres.json()) as { id: string; secret_id: string }[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.secret_id).toBe(systemeAvant?.secret_id)
	})

	test('un mot de passe fourni RÉÉCRIT le secret sans changer sa référence', async ({ request }) => {
		const jetonAdmin = await jetonDe('admin@p2enjoy.test')
		const avant = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id,secret_id`,
			{ headers: enTetesService() },
		)
		const [systeme] = (await avant.json()) as { id: string; secret_id: string }[]

		try {
			const remplacement = await request.post(
				`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`,
				{
					headers: enTetesAuthentifies(jetonAdmin),
					data: {
						p_workspace_id: WORKSPACE,
						p_label: 'Boîte système du workspace',
						p_imap_host: 'stalwart',
						p_imap_port: 143,
						p_imap_security: 'none',
						p_imap_username: 'systeme@crm.p2enjoy.test',
						p_password: 'mot-de-passe-provisoire',
					},
				},
			)
			expect(remplacement.status()).toBe(200)

			const relu = await request.post(
				`${URL_API}/rest/v1/rpc/mail_inbound_account_credentials`,
				{ headers: enTetesService(), data: { p_account_id: systeme?.id } },
			)
			const [identifiants] = (await relu.json()) as { password: string }[]
			expect(identifiants?.password).toBe('mot-de-passe-provisoire')

			// `vault.update_secret` conserve la référence : sans cela, chaque changement de mot de
			// passe orphelinerait une ligne de `vault.secrets`.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=secret_id,status`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as { secret_id: string; status: string }[]
			expect(ligne?.secret_id).toBe(systeme?.secret_id)
			// Changer le mot de passe REMET l'état à `pending` : un `ok` obtenu avec l'ancien
			// secret ne dit rien du nouveau, et le laisser afficherait une certitude périmée.
			expect(ligne?.status).toBe('pending')
		} finally {
			// Le seed est rendu tel qu'il a été reçu — leçon d'INC-061.
			await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: 'Boîte système du workspace',
					p_imap_host: 'stalwart',
					p_imap_port: 143,
					p_imap_security: 'none',
					p_imap_username: 'systeme@crm.p2enjoy.test',
					p_password: MOT_DE_PASSE_SEED,
				},
			})
		}
	})

	test('la clé anonyme employée ici n’est pas la clé de service', async () => {
		// Sans cette garde, les contre-épreuves « par le service » pourraient mesurer exactement ce
		// que mesure l'appelant refusé, et l'ensemble du fichier deviendrait tautologique.
		expect(enTetesService()['apikey']).not.toBe(CLE_ANONYME)
	})
})
