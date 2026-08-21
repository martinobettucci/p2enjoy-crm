// @verifies CRM-053 (docs/BACKLOG.md) — identités sortantes SMTP, contrat d'API
// @verifies CRM-089 (docs/BACKLOG.md) — les trois scénarios finaux, ajoutés par l'écran de
//           configuration : docs/SPEC-mail-subsystem.md §22.7 (les réponses mesurées),
//           §22.4 (la clé est un TRIPLET), §22.5 (le nom d'expéditeur est effaçable)
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
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

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
	// -----------------------------------------------------------------------------------------
	// CRM-089 — ce que l'ÉCRAN de configuration exerce, mesuré §22.7
	// -----------------------------------------------------------------------------------------

	// MESURÉ : la fonction n'exige l'`admin` que pour l'identité de SERVICE ou celle d'autrui. Une
	// lectrice déclare donc la sienne — c'est ce qui justifie que le sélecteur de l'écran ne soit
	// restreint pour personne (§22.5).
	test('CRM-089 — une lectrice déclare SA propre identité, et se voit refuser celle de service', async ({
		request,
	}) => {
		const jeton = await jetonDe('viewer@p2enjoy.test')
		const corps = {
			p_workspace_id: WORKSPACE,
			p_label: 'Envoi de Farida Nowak',
			p_smtp_host: 'stalwart',
			p_smtp_port: 587,
			p_smtp_security: 'none',
			p_smtp_username: 'viewer@p2enjoy.test',
			p_from_address: 'farida@p2enjoy.test',
			p_password: MOT_DE_PASSE_SEED,
		}

		let creee: string | undefined
		try {
			const sienne = await request.post(
				`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`,
				{ headers: enTetesAuthentifies(jeton), data: { ...corps, p_owner_id: FARIDA } },
			)
			expect(sienne.status()).toBe(200)
			creee = (await sienne.json()) as string
			expect(typeof creee).toBe('string')

			// LA CONTRE-ÉPREUVE : le MÊME appel, sans `p_owner_id`, vise l'identité de service et
			// est refusé. Sans elle, le `200` ci-dessus pourrait venir d'une fonction qui n'exige
			// jamais rien.
			const service = await request.post(
				`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`,
				{
					headers: enTetesAuthentifies(jeton),
					data: { ...corps, p_from_address: 'service-refuse@p2enjoy.test' },
				},
			)
			expect(service.status()).toBe(403)
			expect((await service.json()) as { message: string }).toMatchObject({
				message: 'forbidden',
			})
		} finally {
			if (creee !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${creee}`, {
					headers: enTetesService(),
				})
				// LE SECRET VAULT RESTE, ET C'EST VOULU : `vault.secrets.name` est UNIQUE, et la
				// migration `0023` REPREND un orphelin au lieu de le recréer — précisément pour
				// qu'une identité supprimée ne bloque pas la déclaration du même couple. Aucune
				// purge n'est livrée : elle relève d'une unité RGPD (§13.10, §21.1).
			}
		}
	})

	// CE QUE L'ÉCRAN NE PEUT PAS DEVINER, ET QU'IL DOIT DIRE (§22.4) : l'adresse fait partie de la
	// clé. La changer ne renomme rien — elle DÉCLARE une seconde identité, et la première demeure.
	test('CRM-089 — changer l’adresse d’expédition déclare une SECONDE identité', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const ecrire = async (adresse: string) =>
			await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`, {
				headers: enTetesAuthentifies(jeton),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: 'Envoi de Driss Lemoine',
					p_smtp_host: 'stalwart',
					p_smtp_port: 587,
					p_smtp_security: 'none',
					p_smtp_username: 'bizdev@p2enjoy.test',
					p_from_address: adresse,
					p_password: MOT_DE_PASSE_SEED,
					p_owner_id: DRISS,
					p_is_default: true,
				},
			})

		const avant = await request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=id`,
			{ headers: enTetesService() },
		)
		const originelles = (await avant.json()) as { id: string }[]
		expect(originelles).toHaveLength(1)

		let creee: string | undefined
		try {
			const seconde = await ecrire('devis@p2enjoy.test')
			expect(seconde.status()).toBe(200)
			creee = (await seconde.json()) as string
			// L'IDENTIFIANT EST NEUF : ce n'est pas une modification, c'est une déclaration.
			expect(creee).not.toBe(originelles[0]?.id)

			const apres = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=id,owner_id,from_address,smtp_username,is_default,status`,
				{ headers: enTetesService() },
			)
			const lignes = (await apres.json()) as Identite[]
			expect(lignes).toHaveLength(2)
			expect(lignes.map((ligne) => ligne.from_address).sort()).toEqual([
				'contact@p2enjoy.test',
				'devis@p2enjoy.test',
			])
		} finally {
			if (creee !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${creee}`, {
					headers: enTetesService(),
				})
				await ecrire('contact@p2enjoy.test')
			}
		}
	})

	// LA RÈGLE OPPOSÉE À CELLE DU MOT DE PASSE, et c'est elle qui commande le module de l'écran :
	// `p_from_name` est sous `coalesce`. Omis, un nom d'expéditeur serait INEFFAÇABLE ; envoyé
	// vide, il s'efface (§22.5). L'écran l'envoie donc toujours.
	test('CRM-089 — le nom d’expéditeur s’écrit, et une chaîne vide l’EFFACE', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const ecrire = async (nom: string | undefined) =>
			await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`, {
				headers: enTetesAuthentifies(jeton),
				data: {
					p_workspace_id: WORKSPACE,
					p_label: 'Envoi de Driss Lemoine',
					p_smtp_host: 'stalwart',
					p_smtp_port: 587,
					p_smtp_security: 'none',
					p_smtp_username: 'bizdev@p2enjoy.test',
					p_from_address: 'contact@p2enjoy.test',
					p_owner_id: DRISS,
					p_is_default: true,
					...(nom === undefined ? {} : { p_from_name: nom }),
				},
			})
		const nomLu = async () => {
			const lue = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=from_name`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await lue.json()) as { from_name: string | null }[]
			return ligne?.from_name
		}

		try {
			expect((await ecrire('Driss Lemoine')).status()).toBe(200)
			expect(await nomLu()).toBe('Driss Lemoine')

			// OMIS : la valeur est CONSERVÉE — c'est ce qui la rendrait ineffaçable si l'écran
			// omettait le champ vide.
			expect((await ecrire(undefined)).status()).toBe(200)
			expect(await nomLu()).toBe('Driss Lemoine')

			// ENVOYÉ VIDE : la valeur est EFFACÉE. C'est ce que fait l'écran.
			expect((await ecrire('')).status()).toBe(200)
			expect(await nomLu()).toBe('')
		} finally {
			// Le seed est rendu intact : `from_name` y est nul, et seule la clé de service peut le
			// remettre à `null`, la fonction n'acceptant que des valeurs.
			await request.patch(
				`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}`,
				{ headers: enTetesService(), data: { from_name: null } },
			)
		}
	})
})
