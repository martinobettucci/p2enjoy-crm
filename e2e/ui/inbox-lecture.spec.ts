// @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : lu / non lu dans l'inbox, parcours d'écran complet
// @verifies docs/SPEC-mail-subsystem.md §18 bis.2 (ouvrir un fil le marque lu tout entier, « Marquer comme non lu »,
//           « Tout marquer comme lu », le total gardé), §18 bis.4 (l'écran, l'échec qui ne change rien), §18 bis.7
// @verifies docs/DESIGN_SYSTEM.md §5.4 quinquies (liseré, pastille, bouton des notifications), §7 (paliers), §10
//           (clavier) ; docs/JOURNAL.md décisions 715 et 716 ; CLAUDE.md §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE COURRIER VIENT DU SEED (docs/SPEC-seed.md §2.19) : quatre messages réellement reçus. Camille (admin) les voit tous.
//
// L'ÉTAT DE DÉPART EST POSÉ, PUIS RENDU. Avant chaque scénario, les lectures de Camille sur les messages du seed sont
// relevées par la clé de service puis retirées — tout est non lu ; après, elles sont réécrites telles quelles. Le seed
// sort donc intact, et chaque scénario part du même état quelle que soit la session qui l'a précédé.

import { autoriserErreursConsole, connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-057'
const ADMIN = 'admin@p2enjoy.test'
const ID_ADMIN = '5eed0000-0000-4000-8000-000000000011'
const TITRE_CARD_COURRIER = 'Refonte du site vitrine'
const OBJET_REPONSE = 'Re: Demande de devis — refonte'
const MSGID_SEED = [
	'<seed-inbox-classe@p2enjoy.test>',
	'<seed-inbox-reponse@p2enjoy.test>',
	'<seed-inbox-non-classe@p2enjoy.test>',
	'<seed-inbox-suggere@sogexia.example>',
]

type Lecture = { message_id: string; user_id: string; read_at: string }

async function idsDuSeed(page: Page): Promise<string[]> {
	const liste = MSGID_SEED.map((msgid) => `"${msgid}"`).join(',')
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=in.(${encodeURIComponent(liste)})`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { id: string }[]
	expect(lignes, 'les quatre messages du seed existent').toHaveLength(4)
	return lignes.map((ligne) => ligne.id)
}

/** Les lectures de Camille sur les messages du seed, vues par la clé de service. */
async function lecturesDeCamille(page: Page, ids: readonly string[]): Promise<Lecture[]> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_message_reads?select=*&user_id=eq.${ID_ADMIN}&message_id=in.(${ids.join(',')})`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Lecture[]
}

let ids: string[] = []
let avant: Lecture[] = []

test.beforeEach(async ({ page }) => {
	ids = await idsDuSeed(page)
	avant = await lecturesDeCamille(page, ids)
	const vidage = await page.request.delete(
		`${URL_API}/rest/v1/mail_message_reads?user_id=eq.${ID_ADMIN}&message_id=in.(${ids.join(',')})`,
		{ headers: enTetesService() },
	)
	expect(vidage.status()).toBe(204)
})

test.afterEach(async ({ page }) => {
	await page.request.delete(
		`${URL_API}/rest/v1/mail_message_reads?user_id=eq.${ID_ADMIN}&message_id=in.(${ids.join(',')})`,
		{ headers: enTetesService() },
	)
	if (avant.length > 0) {
		const remise = await page.request.post(`${URL_API}/rest/v1/mail_message_reads`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: avant,
		})
		expect(remise.status()).toBe(201)
	}
})

/** La barre latérale glisse sous 1024 px : on attend qu'elle soit IMMOBILE, jamais un délai (`CLAUDE.md` §18). */
async function attendreBarreImmobile(page: Page): Promise<void> {
	const barre = page.getByRole('complementary', { name: 'Barre latérale' })
	let precedente = ''
	await expect
		.poll(async () => {
			const boite = await barre.boundingBox()
			const courante = boite === null ? 'absente' : `${Math.round(boite.x)}x${Math.round(boite.width)}`
			const verdict = courante === precedente ? 'stable' : 'en mouvement'
			precedente = courante
			return verdict
		})
		.toBe('stable')
}

test.describe('lu / non lu dans l’inbox (docs/SPEC-mail-subsystem.md §18 bis)', () => {
	test('ouvrir un fil le marque lu, le total reste, et « Marquer comme non lu » le rétablit — à la souris', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/inbox')
		const dossiers = page.getByTestId('inbox-panneau-dossiers')

		// LE DOSSIER PORTE SES NON LUS À CÔTÉ DU TOTAL (décision 716), et son nom accessible le compte exact.
		const dossier = dossiers.getByRole('button', { name: new RegExp(`${TITRE_CARD_COURRIER}.*2 messages non lus`) })
		await expect(dossier).toBeVisible()
		await expect(dossier.getByTestId('inbox-dossier-non-lus')).toHaveText('2')
		await dossier.click()

		const liste = page.getByTestId('inbox-panneau-liste')
		const ligne = liste.getByTestId('inbox-message').filter({ hasText: OBJET_REPONSE })
		await expect(ligne).toHaveAttribute('data-non-lu', 'true')
		await expect(ligne).toHaveAccessibleName(/^Non lu, /)
		await capturer(page, 'inbox-lecture-non-lu-1440', UNITE)

		await ligne.click()
		await expect(page.getByTestId('inbox-message-ouvert').getByRole('heading', { name: OBJET_REPONSE })).toBeVisible()
		// LE FIL ENTIER EST LU : la ligne perd son liseré, la pastille du dossier disparaît, le total reste à deux.
		await expect(ligne).not.toHaveAttribute('data-non-lu', 'true')
		const dossierLu = dossiers.getByRole('button', { name: new RegExp(TITRE_CARD_COURRIER) })
		await expect(dossierLu.getByTestId('inbox-dossier-non-lus')).toHaveCount(0)
		await expect(dossierLu).toContainText('2')
		// L'EFFET BACKEND : les deux messages du fil sont lus pour Camille, et eux seuls.
		await expect.poll(async () => (await lecturesDeCamille(page, ids)).length).toBe(2)
		await capturer(page, 'inbox-lecture-fil-lu-1440', UNITE)

		await page.getByRole('button', { name: 'Marquer comme non lu', exact: true }).click()
		await expect(ligne).toHaveAttribute('data-non-lu', 'true')
		await expect(page.getByRole('button', { name: 'Marquer comme lu', exact: true })).toBeVisible()
		await expect.poll(async () => (await lecturesDeCamille(page, ids)).length).toBe(1)
		// LE PANNEAU RESTE OUVERT, ET LA RELECTURE NE REMARQUE PAS : l'état tient.
		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
		expect((await lecturesDeCamille(page, ids)).length).toBe(1)
		await capturer(page, 'inbox-lecture-remis-non-lu-1440', UNITE)
	})

	test('« Tout marquer comme lu » se mène AU CLAVIER, puis disparaît', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/inbox')
		const nonClasses = page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ })
		await nonClasses.focus()
		await page.keyboard.press('Enter')

		const tout = page.getByRole('button', { name: 'Tout marquer comme lu' })
		await expect(tout).toBeVisible()
		await tout.focus()
		await page.keyboard.press('Enter')

		await expect(tout).toHaveCount(0)
		await expect(page.getByTestId('inbox-panneau-liste').locator('[data-non-lu="true"]')).toHaveCount(0)
		// Les DEUX non classés du seed, et pas les messages des autres dossiers.
		await expect.poll(async () => (await lecturesDeCamille(page, ids)).length).toBe(2)
	})

	test('un marquage qui échoue est DIT, et la ligne reste non lue', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		// UN CHEMIN D'ERREUR DÉTERMINISTE (`CLAUDE.md` §15) : la seule fonction de marquage répond 503, comme un serveur
		// indisponible. Tout le reste de l'écran parle à la vraie pile.
		await page.route('**/rest/v1/rpc/mark_messages_read', (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"indisponible"}' }),
		)
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
		await page.getByRole('button', { name: 'Tout marquer comme lu' }).click()

		await expect(page.getByTestId('inbox-lecture-refus')).toHaveText(
			"La lecture n'a pas pu être enregistrée : l'état n'a pas changé.",
		)
		await expect(page.getByTestId('inbox-panneau-liste').locator('[data-non-lu="true"]')).toHaveCount(2)
		expect(await lecturesDeCamille(page, ids)).toEqual([])
		await capturer(page, 'inbox-lecture-erreur-1440', UNITE)
		autoriserErreursConsole(page, [
			'console.error: Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
		])
	})

	test('les quatre paliers : la ligne non lue et la pastille tiennent de 390 à 1440 px', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/inbox')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await attendreBarreImmobile(page)
			const dossiers = page.getByTestId('inbox-panneau-dossiers')
			if (palier.largeur < 1024 && !(await dossiers.isVisible())) {
				await page.getByTestId('inbox-panneau-liste').getByRole('button', { name: 'Retour aux dossiers' }).click()
			}
			// LES DOSSIERS : la pastille ne déborde pas du panneau, le total reste lisible.
			const pastille = dossiers.getByTestId('inbox-dossier-non-lus').first()
			await expect(pastille).toBeVisible()
			const boitePanneau = await dossiers.boundingBox()
			const boitePastille = await pastille.boundingBox()
			expect(boitePastille!.x + boitePastille!.width).toBeLessThanOrEqual(boitePanneau!.x + boitePanneau!.width)
			if (palier.largeur < 1024) await capturer(page, `inbox-lecture-dossiers-${palier.nom}`, UNITE)

			await dossiers.getByRole('button', { name: /Non classés/ }).click()
			await expect(page.getByTestId('inbox-panneau-liste').locator('[data-non-lu="true"]').first()).toBeVisible()
			await capturer(page, `inbox-lecture-${palier.nom}`, UNITE)
		}
	})
})
