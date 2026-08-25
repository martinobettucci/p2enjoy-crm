// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 3 : LA SIGNATURE
// @verifies docs/SPEC-modeles-emails.md §10.2 (la colonne et sa borne), §10.3 (le corps mis en
//           file est le corps SIGNÉ, et le septième refus), §10.4 (les trois états de
//           l'effacement), §10.6 (ce que l'écran lit et envoie), §10.7 (les preuves exigées)
// @verifies docs/SPEC-mail-subsystem.md §22.3 (ce que l'écran lit), §22.7 (le contrat mesuré)
// @verifies docs/SPEC-seed.md — Driss signe, l'identité de service ne signe pas
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0056_signature_identite.test.sql`
// prouve la règle EN BASE, sous des rôles endossés. Rien n'y garantit que la pile la rende par la
// vraie route : un cache de schéma resté sur `signature_html` rendrait `PGRST204` à la première
// écriture, un privilège de colonne mal reposé après le renommage rendrait `403` à la lecture, et
// la suite pgTAP resterait verte dans les deux cas. Le renommage d'une colonne est précisément le
// changement dont seule la mesure par l'API dit s'il a été propagé.
//
// CE FICHIER ÉCRIT, ET IL REND LE SEED INTACT : le scénario `h` réinstalle la signature du seed et
// la relit pour la constater.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const IDENTITES = '/rest/v1/mail_outbound_identities'
const ECRIRE_IDENTITE = '/rest/v1/rpc/upsert_mail_outbound_identity'
const METTRE_EN_FILE = '/rest/v1/rpc/queue_outbound_email'
const OUTBOX = '/rest/v1/mail_outbox'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3. */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
/** Une affaire du seed que Driss ÉCRIT, et qui porte une adresse (`CRM-040`). */
const CARD = '5eed0000-0000-4000-8000-0000000000c1'

/** La signature que le seed pose sur l'identité de Driss, et à laquelle la suite doit revenir. */
const SIGNATURE_DU_SEED = 'Driss Lemoine — Business developer\nP2Enjoy SAS'

/** Le séparateur de la RFC 3676 §4.3 — deux tirets et UNE espace (§10.3). */
const SEPARATEUR = '--' + ' '

/** Préfixe des objets écrits par cette suite : lisible, et jamais confondu avec le seed. */
const PREFIXE = 'preuve-api-signature'

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** Les arguments complets de l'écriture d'identité — ceux que l'écran envoie (§10.6). */
function ecritureDeDriss(signature: string | null) {
	return {
		p_workspace_id: WORKSPACE,
		p_label: 'Envoi de Driss Lemoine',
		p_smtp_host: 'stalwart',
		p_smtp_port: 587,
		p_smtp_security: 'none',
		p_smtp_username: 'bizdev@p2enjoy.test',
		p_from_address: 'contact@p2enjoy.test',
		p_owner_id: DRISS,
		p_is_default: true,
		...(signature === null ? {} : { p_signature_text: signature }),
	}
}

async function signatureDeDriss(request: import('@playwright/test').APIRequestContext, jeton: string) {
	const reponse = await request.get(
		`${IDENTITES}?select=signature_text&from_address=eq.contact@p2enjoy.test`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as { signature_text: string | null }[]
	const ligne = lignes[0]
	expect(ligne, 'la signature de Driss : réponse VIDE — seed non appliqué ?').toBeDefined()
	return (ligne as { signature_text: string | null }).signature_text
}

test.describe('la signature d’une identité sortante, par la vraie route (§10)', () => {
	// -------------------------------------------------------------------------------------------
	// a et b — la colonne est bien celle du renommage, et le cache de schéma le sait
	// -------------------------------------------------------------------------------------------

	test('a — `signature_text` se lit ; `signature_html` n’existe plus', async ({ request }) => {
		expect(await signatureDeDriss(request, jetonBizdev)).toBe(SIGNATURE_DU_SEED)

		// LE CACHE DE SCHÉMA EST CE QUI EST MESURÉ ICI : après un renommage, une colonne disparue
		// répond `42703` par la route, et non une erreur de base. C'est la preuve que la migration
		// a été PROPAGÉE, pas seulement appliquée.
		const ancienne = await request.get(`${IDENTITES}?select=signature_html`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		expect(ancienne.status()).toBe(400)
		expect((await ancienne.json()).code).toBe('42703')
	})

	test('b — l’anonyme ne lit AUCUNE identité, signature comprise', async ({ request }) => {
		const reponse = await request.get(`${IDENTITES}?select=signature_text`, {
			headers: enTetesAnonymes(),
		})
		// `401` et non zéro ligne : contrairement à `mail_templates`, cette table n'accorde AUCUN
		// privilège à `anon` (migration 23). Le refus est celui du privilège.
		expect(reponse.status()).toBe(401)
		expect((await reponse.json()).code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// c, d, e — les TROIS états de l'effacement, chacun relu (§10.4)
	// -------------------------------------------------------------------------------------------

	test('c — REMPLI écrit, et la relecture le constate', async ({ request }) => {
		const reponse = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss(`${PREFIXE} — première signature`),
		})
		expect(reponse.status()).toBe(200)
		expect(await signatureDeDriss(request, jetonBizdev)).toBe(`${PREFIXE} — première signature`)
	})

	test('d — OMIS conserve : un appel sans le paramètre ne l’écrase pas', async ({ request }) => {
		const reponse = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss(null),
		})
		expect(reponse.status()).toBe(200)
		expect(await signatureDeDriss(request, jetonBizdev)).toBe(`${PREFIXE} — première signature`)
	})

	test('e — VIDE efface, et rend `null` : le produit ne connaît qu’UN état d’absence', async ({
		request,
	}) => {
		// C'EST LA RÉPARATION QUE LA TRANCHE APPORTE. Avant la migration 58, le `coalesce` rendait
		// cette colonne INEFFAÇABLE — motif exact pour lequel le §22.1 refusait d'ouvrir le champ.
		const reponse = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss(''),
		})
		expect(reponse.status()).toBe(200)
		expect(await signatureDeDriss(request, jetonBizdev)).toBeNull()
	})

	// -------------------------------------------------------------------------------------------
	// f — la borne, et son témoin
	// -------------------------------------------------------------------------------------------

	test('f — 2000 caractères passent, 2001 sont refusés en nommant la borne', async ({
		request,
	}) => {
		const temoin = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss('x'.repeat(2000)),
		})
		expect(temoin.status()).toBe(200)

		const refus = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss('x'.repeat(2001)),
		})
		expect(refus.status()).toBe(400)
		const corps = await refus.json()
		expect(corps.code).toBe('23514')
		// LA CONTRAINTE EST NOMMÉE, et c'est ce qui permet à l'écran de classer le refus plutôt que
		// de rendre la phrase du serveur (§9.8, INC-193).
		expect(JSON.stringify(corps)).toContain('mail_outbound_identities_signature_borne')

		// LA LIGNE EST RELUE POUR ÊTRE CONSTATÉE INCHANGÉE : un refus qui aurait écrit à moitié
		// serait pire qu'un refus.
		expect(await signatureDeDriss(request, jetonBizdev)).toBe('x'.repeat(2000))
	})

	// -------------------------------------------------------------------------------------------
	// g — la mise en file porte le corps SIGNÉ (§10.3)
	// -------------------------------------------------------------------------------------------

	test('g — le corps mis en file est le corps SIGNÉ, et un corps vide est refusé', async ({
		request,
	}) => {
		const signature = 'Driss Lemoine\nP2Enjoy SAS'
		const pose = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: ecritureDeDriss(signature),
		})
		expect(pose.status()).toBe(200)

		const identites = await request.get(
			`${IDENTITES}?select=id&from_address=eq.contact@p2enjoy.test`,
			{ headers: enTetesAuthentifies(jetonBizdev) },
		)
		const idIdentite = ((await identites.json()) as { id: string }[])[0]?.id
		expect(idIdentite, 'l’identité de Driss est introuvable').toBeDefined()

		// LA LIGNE MISE EN FILE EST RETIRÉE DANS UN `finally`, ET CE N'EST PAS DE LA POLITESSE.
		// MESURÉ le 2026-08-25 : sans ce retrait, `mail-sync` a VRAIMENT expédié le message, le
		// serveur l'a remis dans la boîte de l'affaire, l'ingestion l'a classé — et les cinq
		// scénarios de `e2e/ui/groupement-fils.spec.ts` ont rougi, cette suite-là comptant les
		// messages de l'affaire « Refonte du site vitrine », qui est celle-ci. Une preuve qui
		// laisse partir un courrier n'est pas isolée : elle change l'état que les autres lisent.
		// C'est le patron de `e2e/api/envoi.spec.ts`, repris tel quel plutôt que redécouvert.
		const objet = `${PREFIXE} ${Date.now()}`
		let idFile: string | undefined
		try {
			const miseEnFile = await request.post(METTRE_EN_FILE, {
				headers: enTetesAuthentifies(jetonBizdev),
				data: {
					p_card_id: CARD,
					p_identity_id: idIdentite,
					p_to: ['client@example.test'],
					p_subject: objet,
					p_body_text: 'Bonjour.',
				},
			})
			expect(miseEnFile.status()).toBe(200)
			idFile = (await miseEnFile.json()) as string

			const file = await request.get(
				`${OUTBOX}?select=body_text&subject=eq.${encodeURIComponent(objet)}`,
				{ headers: enTetesAuthentifies(jetonBizdev) },
			)
			expect(file.status()).toBe(200)
			const ligne = ((await file.json()) as { body_text: string }[])[0]
			expect(ligne, 'la ligne de file est introuvable').toBeDefined()
			// CARACTÈRE À CARACTÈRE : c'est la seule comparaison qui dénonce une ligne vide de trop
			// ou l'espace du séparateur perdue en route.
			expect((ligne as { body_text: string }).body_text).toBe(
				`Bonjour.\n\n${SEPARATEUR}\n${signature}`,
			)
		} finally {
			if (idFile !== undefined) {
				await request.delete(`${URL_API}${OUTBOX}?id=eq.${idFile}`, {
					headers: enTetesService(),
				})
			}
		}

		// LE SEPTIÈME REFUS, et son témoin est l'appel qui précède : le même envoi avec un corps
		// non vide vient d'être accepté.
		const vide = await request.post(METTRE_EN_FILE, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {
				p_card_id: CARD,
				p_identity_id: idIdentite,
				p_to: ['client@example.test'],
				p_subject: `${PREFIXE} vide`,
				p_body_text: '',
			},
		})
		expect(vide.status()).toBe(400)
		const refus = await vide.json()
		expect(refus.code).toBe('23514')
		expect(refus.message).toBe('body_required')
	})

	// -------------------------------------------------------------------------------------------
	// h — la lectrice est refusée, et le seed est rendu
	// -------------------------------------------------------------------------------------------

	test('h — la lectrice n’écrit aucune signature, et le seed est rendu intact', async ({
		request,
	}) => {
		// Farida est `viewer` et ne possède aucune identité : la fonction refuse `forbidden` avant
		// même de regarder la signature. Le refus est celui du DROIT, pas celui du contenu.
		const refus = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { ...ecritureDeDriss('Farida'), p_owner_id: DRISS },
		})
		expect(refus.status()).toBe(403)
		expect((await refus.json()).message).toBe('forbidden')

		// L'administratrice, elle, PEUT écrire l'identité d'un collègue : la RLS de cette table est
		// une règle de supervision (§22.3). C'est par elle que le seed est rendu.
		const rendu = await request.post(ECRIRE_IDENTITE, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: ecritureDeDriss(SIGNATURE_DU_SEED),
		})
		expect(rendu.status()).toBe(200)
		expect(await signatureDeDriss(request, jetonBizdev)).toBe(SIGNATURE_DU_SEED)
	})
})
