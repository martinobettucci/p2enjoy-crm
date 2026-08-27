// @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 4
// @verifies docs/SPEC-notifications.md §47 (les dix-sept lignes du contrat d'API), §43.1 (la
//           préférence d'autrui est INOBSERVABLE), §43.4 (l'absence de ligne vaut consentement),
//           §44 (le filtrage est à la lecture : couper MASQUE, la ligne reste en base),
//           §44.1 (une notification masquée ne peut plus être marquée lue), §46.2 (le refus
//           double de l'écriture directe), §46.3 (la RPC, unique chemin, et ses refus nommés),
//           §48 bis (le seed ne pose aucune préférence)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0064_preferences_notifications.test.sql`
// prouve la règle EN BASE, sous le propriétaire. Rien n'y garantit que la pile la rende par la
// vraie route, et la tranche 1 a payé cette leçon : le privilège d'exécution de
// `app.can_read_card_pour` manquait à `authenticated`, quatre lignes du contrat rendaient
// `403 / 42501` là où trois attendaient un refus MÉTIER, et la suite pgTAP restait verte —
// elle s'exécute sous le propriétaire, qui n'a besoin d'aucun privilège (décision 522).
//
// LA MÊME MENACE EXISTE ICI, ET ELLE EST PLUS DISCRÈTE ENCORE. `app.notification_consentie` est
// appelée DEPUIS UNE POLITIQUE, donc sous le rôle de l'appelant. Sans son `execute`, la lecture
// des notifications rendrait `403 / 42501` pour tout le monde — c'est-à-dire que la cloche
// cesserait de fonctionner pour l'ensemble du produit —, et aucune assertion de `0062` ne le
// verrait.
//
// CE FICHIER ÉCRIT, ET IL REND LE PRODUIT DANS L'ÉTAT OÙ IL LE TROUVE. Chaque préférence posée est
// retirée par la clé de service, qui seule en a le privilège, et une dernière lecture le CONSTATE
// — décision 501. Le §43.4 rend cette remise en état EXACTE : sans ligne, le défaut est « je
// reçois », c'est-à-dire l'état d'avant.

import { expect, request as requetePlaywright, test } from '@playwright/test'
import { CLE_ANONYME, CLE_SERVICE, URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const PREFERENCES = '/rest/v1/notification_preferences'
const NOTIFICATIONS = '/rest/v1/notifications'
const RPC = '/rest/v1/rpc/definir_preference_notification'

/** Les trois profils du seed — `docs/SPEC-seed.md` §2.3. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

const enTetesService = () => ({ apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` })

/** Relit AVEC LA CLÉ DE SERVICE, donc hors de toute politique : c'est ce qui distingue un refus
 *  d'un effacement, et un masquage d'une destruction. */
async function enBase(
	requete: import('@playwright/test').APIRequestContext,
	chemin: string,
	filtre: string,
): Promise<Array<Record<string, unknown>>> {
	const reponse = await requete.get(`${URL_API}${chemin}?${filtre}`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Array<Record<string, unknown>>
}

/** Retire TOUTES les préférences par la clé de service. Le §43.4 rend cet état identique à celui
 *  d'avant : sans ligne, chacun reçoit. */
async function remettreEnEtat(
	requete: import('@playwright/test').APIRequestContext,
): Promise<void> {
	const reponse = await requete.delete(`${URL_API}${PREFERENCES}?type=eq.mention`, {
		headers: enTetesService(),
	})
	expect([200, 204]).toContain(reponse.status())
}

test.describe('CRM-064 tranche 4 — les préférences de notification, contrat d’API', () => {
	let requete: import('@playwright/test').APIRequestContext
	let jetonCamille: string
	let jetonDriss: string
	let jetonFarida: string

	test.beforeAll(async () => {
		requete = await requetePlaywright.newContext({ baseURL: URL_API })
		jetonCamille = await jetonDe('admin@p2enjoy.test')
		jetonDriss = await jetonDe('bizdev@p2enjoy.test')
		jetonFarida = await jetonDe('viewer@p2enjoy.test')
	})

	test.afterAll(async () => {
		await remettreEnEtat(requete)
		await requete.dispose()
	})

	test.beforeEach(async () => {
		await remettreEnEtat(requete)
	})

	// §48 bis : LE SEED NE POSE AUCUNE PRÉFÉRENCE, et c'est une décision. Poser trois lignes
	// `in_app = true` serait poser trois lignes qui ne changent rien, et un écran qui les rendrait
	// ne montrerait pas l'état par défaut réel d'un compte neuf — celui de TOUT LE MONDE en
	// production le jour du déploiement.
	test('le seed ne pose aucune préférence, et les deux notifications restent lisibles (§48 bis)', async () => {
		const preferences = await enBase(requete, PREFERENCES, 'select=*')
		expect(preferences).toHaveLength(0)

		for (const [nom, jeton, attendu] of [
			['Camille', jetonCamille, 1],
			['Driss', jetonDriss, 1],
			['Farida', jetonFarida, 0],
		] as const) {
			const reponse = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status(), `${nom} lit ses notifications`).toBe(200)
			expect((await reponse.json()) as unknown[], `${nom} en a ${attendu}`).toHaveLength(attendu)
		}
	})

	// LIGNES *a*, *b*, *c*, *d* — LE CŒUR DE LA TRANCHE. Couper MASQUE : la liste et le compteur
	// tombent, ET LA LIGNE RESTE EN BASE. C'est ce qui rend la décision révocable, et c'est
	// exactement ce que le §18 point 3 opposait au filtrage à la production.
	test('couper masque la liste ET le compteur, sans détruire la ligne (§44)', async () => {
		// *a*
		const ecriture = await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})
		expect(ecriture.status()).toBe(200)
		const ligne = (await ecriture.json()) as Record<string, unknown>
		expect(ligne['profile_id']).toBe(DRISS)
		expect(ligne['type']).toBe('mention')
		expect(ligne['in_app']).toBe(false)
		// LA DATE EST POSÉE PAR LA BASE (§43.2) : elle existe, et elle est récente.
		expect(typeof ligne['updated_at']).toBe('string')

		// *b* — la liste
		const liste = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAuthentifies(jetonDriss),
		})
		expect(liste.status()).toBe(200)
		expect((await liste.json()) as unknown[]).toHaveLength(0)

		// *c* — le compteur. Il suit SANS QUE PERSONNE NE L'AIT PROGRAMMÉ : il lit la même table
		// sous la même politique, et c'est le sens de « la règle n'a qu'une seule écriture ».
		const compteur = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id&read_at=is.null`, {
			headers: { ...enTetesAuthentifies(jetonDriss), Prefer: 'count=exact', Range: '0-0' },
		})
		expect(compteur.headers()['content-range']).toBe('*/0')

		// *d* — LA LIGNE EST TOUJOURS LÀ. C'est l'assertion qui distingue cette tranche de celle
		// qu'on n'a pas écrite.
		const enSilence = await enBase(requete, NOTIFICATIONS, `select=id&recipient_id=eq.${DRISS}`)
		expect(enSilence).toHaveLength(1)
	})

	// LIGNE *e* — LA DÉCISION DE L'UN NE TOUCHE PAS L'AUTRE. Sans cette ligne, une politique
	// fautive qui ignorerait `recipient_id` dans l'appel à la fonction passerait toutes les
	// assertions précédentes.
	test('la préférence de l’un ne masque rien à l’autre (§43.1)', async () => {
		await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})

		const liste = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAuthentifies(jetonCamille),
		})
		expect(liste.status()).toBe(200)
		expect((await liste.json()) as unknown[]).toHaveLength(1)
	})

	// LIGNE *f* — LE COMPORTEMENT QUE M9 A MESURÉ, FIGÉ. Il n'est PAS une anomalie : c'est la forme
	// de refus que ce dépôt emploie partout, et la Definition of Done de `CRM-064` l'exige — « le
	// refus de lecture se mesure comme ZÉRO LIGNE et non comme une erreur ». La cause est
	// mécanique : PostgREST écrit son `UPDATE` avec `RETURNING`, que la politique `SELECT` filtre.
	test('une notification masquée ne peut plus être marquée lue, et le refus est zéro ligne (§44.1)', async () => {
		const avant = await enBase(requete, NOTIFICATIONS, `select=id,read_at&recipient_id=eq.${DRISS}`)
		const identifiant = avant[0]?.['id']
		expect(typeof identifiant).toBe('string')
		expect(avant[0]?.['read_at']).toBeNull()

		await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})

		const marquage = await requete.patch(`${URL_API}${NOTIFICATIONS}?id=eq.${String(identifiant)}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { read_at: '2026-08-27T00:00:00.000Z' },
		})
		expect(marquage.status(), 'le refus est un 204 sans effet, jamais une erreur').toBe(204)

		const apres = await enBase(requete, NOTIFICATIONS, `select=read_at&id=eq.${String(identifiant)}`)
		expect(apres[0]?.['read_at'], 'aucune ligne n’a été touchée').toBeNull()
	})

	// LIGNE *g* — RÉTABLIR REND L'ÉTAT D'AVANT, ET C'EST LA RAISON D'ÊTRE DU FILTRAGE À LA LECTURE.
	test('rétablir rend la notification, non lue, telle qu’elle était (§44)', async () => {
		await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})

		const retabli = await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: true },
		})
		expect(retabli.status(), 'la RPC est IDEMPOTENTE : aucun 409 sur la même clé').toBe(200)
		expect(((await retabli.json()) as Record<string, unknown>)['in_app']).toBe(true)

		const liste = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id,read_at`, {
			headers: enTetesAuthentifies(jetonDriss),
		})
		const lignes = (await liste.json()) as Array<Record<string, unknown>>
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.['read_at'], 'elle revient NON LUE, comme elle l’était').toBeNull()
	})

	// LIGNES *h*, *i*, *j* — LA PRÉFÉRENCE D'AUTRUI EST INOBSERVABLE, et c'est le motif même de la
	// table séparée (§43.1, M7) : `profiles` est lisible par toute l'équipe, une préférence posée
	// là aurait publié une décision personnelle.
	test('chacun lit sa préférence, personne ne lit celle d’un autre, l’anonyme lit zéro ligne (§43.1)', async () => {
		await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})

		// *h*
		const sienne = await requete.get(`${URL_API}${PREFERENCES}?select=*`, {
			headers: enTetesAuthentifies(jetonDriss),
		})
		expect(sienne.status()).toBe(200)
		const lignes = (await sienne.json()) as Array<Record<string, unknown>>
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.['profile_id']).toBe(DRISS)

		// *i* — L'ADMINISTRATRICE NON PLUS. Une boîte n'est pas une donnée d'exploitation, et une
		// décision de ne pas être dérangé encore moins.
		const autrui = await requete.get(`${URL_API}${PREFERENCES}?select=*`, {
			headers: enTetesAuthentifies(jetonCamille),
		})
		expect(autrui.status()).toBe(200)
		expect((await autrui.json()) as unknown[]).toHaveLength(0)

		// *j* — L'ANONYME REÇOIT ZÉRO LIGNE, JAMAIS UNE ERREUR : `anon` a le privilège `select`,
		// et c'est délibéré (§46.1).
		const anonyme = await requete.get(`${URL_API}${PREFERENCES}?select=*`, {
			headers: enTetesAnonymes(),
		})
		expect(anonyme.status()).toBe(200)
		expect((await anonyme.json()) as unknown[]).toHaveLength(0)

		// ET LA CLÉ DE SERVICE, ELLE, LA VOIT — c'est ce qui rend l'assertion *i* probante : la
		// ligne existe bel et bien, elle n'est pas simplement absente.
		expect(await enBase(requete, PREFERENCES, 'select=*')).toHaveLength(1)
	})

	// LIGNE *k* — LE REFUS DE L'ANONYME EST UN REFUS DE PRIVILÈGE, pas un refus métier. C'est la
	// leçon de la migration `0053` : sans le `revoke … from anon` NOMMÉ, il obtiendrait un autre
	// refus, plus tardif et plus bavard.
	test('l’anonyme ne peut pas appeler la RPC : refus de PRIVILÈGE (§46.3)', async () => {
		const reponse = await requete.post(`${URL_API}${RPC}`, {
			headers: { apikey: CLE_ANONYME, 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})
		expect(reponse.status()).toBe(401)
		expect(((await reponse.json()) as Record<string, unknown>)['code']).toBe('42501')
		expect(await enBase(requete, PREFERENCES, 'select=*')).toHaveLength(0)
	})

	// LIGNES *l*, *m*, *n* — LE REFUS DOUBLE DE L'ÉCRITURE DIRECTE (§46.2). Les trois verbes sont
	// refusés par le PRIVILÈGE ; l'absence de politique est la seconde barrière, que la suite
	// pgTAP tient et que le harnais dégrade.
	test('l’écriture directe de la table est refusée, verbe par verbe (§46.2)', async () => {
		const enTetes = { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' }

		// *m* — POST
		const insertion = await requete.post(`${URL_API}${PREFERENCES}`, {
			headers: enTetes,
			data: { profile_id: DRISS, type: 'mention', in_app: false },
		})
		expect(insertion.status()).toBe(403)
		expect(((await insertion.json()) as Record<string, unknown>)['code']).toBe('42501')

		// *l* — PATCH
		const maj = await requete.patch(`${URL_API}${PREFERENCES}?profile_id=eq.${DRISS}&type=eq.mention`, {
			headers: enTetes,
			data: { in_app: true },
		})
		expect(maj.status()).toBe(403)

		// *n* — DELETE. Il est refusé MÊME pour sa propre ligne : revenir au défaut se fait en
		// recochant, pas en effaçant — un seul chemin vers un même état.
		const suppression = await requete.delete(
			`${URL_API}${PREFERENCES}?profile_id=eq.${DRISS}&type=eq.mention`,
			{ headers: enTetes },
		)
		expect(suppression.status()).toBe(403)

		expect(await enBase(requete, PREFERENCES, 'select=*'), 'aucun refus n’a laissé de trace').toHaveLength(0)
	})

	// LIGNE *o* — UN TYPE INCONNU EST REFUSÉ NOMMÉMENT. Sans le refus de la RPC, la cause viendrait
	// du `check` avec `23514` et un message qui RECOPIE la ligne fautive — illisible pour un écran.
	test('un type inventé est refusé par un SYMBOLE, jamais par un code de contrainte brut (§46.3)', async () => {
		const reponse = await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonDriss), 'Content-Type': 'application/json' },
			data: { p_type: 'echeance', p_in_app: false },
		})
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Record<string, unknown>
		expect(corps['code']).toBe('P0001')
		expect(corps['message']).toBe('preference_type_inconnu')
		expect(await enBase(requete, PREFERENCES, 'select=*')).toHaveLength(0)
	})

	// LIGNE *p* — LA CLÉ DE SERVICE EST REFUSÉE, ET C'EST VOULU. Elle contourne la RLS mais n'a
	// AUCUNE identité : `auth.uid()` y est nul. Sans ce refus nommé, elle écrirait une ligne pour
	// `null`, refusée par la non-nullité avec un message qui ne dit rien. C'est le chemin du seed
	// et des harnais : il doit échouer clairement.
	test('la clé de service est refusée, faute d’identité, et le refus est nommé (§46.3)', async () => {
		const reponse = await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Record<string, unknown>
		expect(corps['code']).toBe('P0001')
		expect(corps['message']).toBe('preference_sans_session')
	})

	// LIGNE *q* — COUPER SUR UNE BOÎTE VIDE NE FABRIQUE AUCUNE ERREUR. Farida n'a aucune
	// notification, coupée ou non : la préférence n'a pas à connaître l'état de la boîte.
	test('couper sur une boîte vide reste un succès, et ne rend toujours rien (§47, ligne q)', async () => {
		const ecriture = await requete.post(`${URL_API}${RPC}`, {
			headers: { ...enTetesAuthentifies(jetonFarida), 'Content-Type': 'application/json' },
			data: { p_type: 'mention', p_in_app: false },
		})
		expect(ecriture.status()).toBe(200)

		const liste = await requete.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAuthentifies(jetonFarida),
		})
		expect(liste.status()).toBe(200)
		expect((await liste.json()) as unknown[]).toHaveLength(0)
	})

	// LA DERNIÈRE ASSERTION CONSTATE L'ÉTAT DU SEED — décision 501. Une preuve qui laisse ses
	// sondes en base fait rougir la suivante, et ici elle ferait pire : elle laisserait quelqu'un
	// coupé, et `notifications-surface.spec.ts` mesurerait une cloche vide sans cause visible.
	test('le produit est rendu dans l’état où il a été trouvé (décision 501)', async () => {
		await remettreEnEtat(requete)
		expect(await enBase(requete, PREFERENCES, 'select=*')).toHaveLength(0)

		const notifications = await enBase(requete, NOTIFICATIONS, 'select=id,recipient_id,read_at')
		expect(notifications).toHaveLength(2)
		expect(notifications.every((ligne) => ligne['read_at'] === null)).toBe(true)
		expect(notifications.map((ligne) => ligne['recipient_id']).sort()).toEqual([CAMILLE, DRISS].sort())
	})
})
