// @verifies CRM-155 (docs/BACKLOG.md) — tranche T1 : les pastilles en filtres rapides sur la vraie pile — les bascules de
//           l'espace courant, plusieurs en OU, l'adresse qui se répète et « Précédent » qui la défait, « Toutes les
//           pastilles » et le focus, le volet des archivées replié puis ouvert d'office, une adresse retouchée nettoyée, le
//           vide à une et à plusieurs pastilles, à la souris et au clavier, et les quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §31.12.1 à §31.12.4, §31.12.6 ; docs/DESIGN_SYSTEM.md §5.108 ; décisions 943 et 948 ;
//           CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LES MAILS SONT PROPRES À LA PREUVE, posés par la clé de service dans « Refonte du site vitrine » (`…00c1`) et retirés à
// la fin ; leurs pastilles sont posées par `set_message_label` sous le jeton de l'administratrice (le vrai geste). Aucun mot
// d'un nom de pastille dans leurs objets : le simulateur ne leur en pose aucune. Le seed n'est que lu : « Newsletter »,
// archivée, portée par l'invitation non classée (docs/SPEC-seed.md §46).

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, consommerTraceCadreIsole, expect, test } from './fixtures'

const UNITE = 'CRM-155'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const suffixe = Date.now().toString(36)
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const crees: string[] = []
const mails: { lead: string; spam: string; sans: string } = { lead: '', spam: '', sans: '' }
const ids: Record<string, string> = {}

async function poserMail(request: APIRequestContext, objet: string): Promise<string> {
	const reponse = await request.post(rest('mail_messages'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm155-ui-${suffixe}-${crees.length}@sonde.test>`,
			card_id: CARD_C1,
			classification: 'manual',
			from_address: 'contact@sonde.test',
			subject: objet,
			body_text: 'Preuve des filtres rapides.',
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	crees.push(id)
	return id
}

test.beforeAll(async ({ request }) => {
	const reponse = await request.get(rest(`mail_labels?workspace_id=eq.${ESPACE}&select=id,name`), { headers: enTetesService() })
	for (const { id, name } of (await reponse.json()) as { id: string; name: string }[]) ids[name] = id
	const camille = await jetonDe('admin@p2enjoy.test')
	mails.lead = await poserMail(request, `ZZ 155 un ${suffixe}`)
	mails.spam = await poserMail(request, `ZZ 155 deux ${suffixe}`)
	mails.sans = await poserMail(request, `ZZ 155 trois ${suffixe}`)
	for (const [message, label] of [
		[mails.lead, ids['Lead']],
		[mails.spam, ids['Spam']],
	] as const) {
		const pose = await request.post(rest('rpc/set_message_label'), {
			headers: { ...enTetesAuthentifies(camille), 'Content-Type': 'application/json' },
			data: { p_message_id: message, p_label_id: label, p_applied: true },
		})
		expect(pose.status(), await pose.text()).toBe(204)
	}
})

test.afterAll(async ({ request }) => {
	// PAR PRÉFIXE, et non par la liste `crees` : après un échec, Playwright relance le worker, et `afterAll` y tourne avec
	// une liste vide — trois sondes étaient ainsi restées en base (relevé par la session fc, 2026-11-18).
	const prefixe = encodeURIComponent('<tst-crm155-ui-*')
	await request.delete(`${URL_API}/rest/v1/mail_messages?rfc822_message_id=like.${prefixe}`, { headers: enTetesService() })
})

const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const filtres = (page: Page) => liste(page).getByRole('group', { name: 'Filtrer par pastille' })
const bascule = (page: Page, nom: string) => filtres(page).getByRole('button', { name: nom, exact: true })
const ligne = (page: Page, objet: string) => liste(page).getByTestId('inbox-message').filter({ hasText: objet })
const valeursAdresse = (page: Page) => new URL(page.url()).searchParams.getAll('pastille')

/**
 * Attend la FIN des transitions de couleur des bascules (150 ms, §3) avant une capture : prise juste après un clic, elle
 * montrait une bascule active encore à mi-chemin de son état éteint — vu en capture le 2026-11-18. Une attente sur
 * l'état réel (`getAnimations`), jamais une temporisation.
 */
async function transitionsFinies(page: Page): Promise<void> {
	await filtres(page).evaluate((bloc) => Promise.all(bloc.getAnimations({ subtree: true }).map((a) => a.finished)))
}

/** Les pastilles actives de l'espace qu'aucun message de « Refonte du site vitrine » ne porte : de quoi un vide sûr. */
async function sansMailDansC1(request: APIRequestContext): Promise<string[]> {
	const reponse = await request.get(
		rest(`mail_message_labels?applied=is.true&select=label_id,mail_messages!inner(card_id)&mail_messages.card_id=eq.${CARD_C1}`),
		{ headers: enTetesService() },
	)
	const portees = new Set(((await reponse.json()) as { label_id: string }[]).map((l) => l.label_id))
	return ['Partenariat', 'Recrutement', 'Administratif', 'Support client', 'Facture / paiement'].filter(
		(nom) => !portees.has(ids[nom] ?? ''),
	)
}

test.describe('les filtres rapides de l’inbox (docs/DESIGN_SYSTEM.md §5.108)', () => {
	test('à la souris : une bascule filtre, deux s’unissent, l’adresse se répète, « Précédent » la défait, « Toutes les pastilles » l’efface', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${mails.sans}`)
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toBeVisible()
		// Une bascule par pastille ACTIVE de l'espace courant, toutes éteintes ; l'archivée est dans le volet, replié.
		const toutes = filtres(page).getByTestId('inbox-bascule-pastille')
		await expect(toutes.first()).toBeVisible()
		for (const b of await toutes.all()) await expect(b).toHaveAttribute('aria-pressed', 'false')
		await expect(bascule(page, 'Newsletter, pastille archivée')).toHaveCount(0)
		await expect(filtres(page).getByTestId('inbox-volet-archivees')).toHaveAttribute('aria-expanded', 'false')
		await capturer(page, 'filtres-rapides-eteints-1440', UNITE)

		await bascule(page, 'Lead').click()
		await expect(bascule(page, 'Lead')).toHaveAttribute('aria-pressed', 'true')
		expect(valeursAdresse(page)).toEqual([ids['Lead']])
		await expect(ligne(page, `ZZ 155 un ${suffixe}`)).toBeVisible()
		await expect(ligne(page, `ZZ 155 deux ${suffixe}`)).toHaveCount(0)
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toHaveCount(0)

		await bascule(page, 'Spam').click()
		await expect(page).toHaveURL(/pastille=.*pastille=/)
		expect(valeursAdresse(page)).toEqual([ids['Lead'], ids['Spam']])
		await expect(ligne(page, `ZZ 155 un ${suffixe}`)).toBeVisible()
		await expect(ligne(page, `ZZ 155 deux ${suffixe}`)).toBeVisible()
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toHaveCount(0)
		await transitionsFinies(page)
		await capturer(page, 'filtres-rapides-deux-1440', UNITE)

		// « Précédent » défait le dernier geste.
		await page.goBack()
		await expect(bascule(page, 'Spam')).toHaveAttribute('aria-pressed', 'false')
		await expect(bascule(page, 'Lead')).toHaveAttribute('aria-pressed', 'true')
		await expect(ligne(page, `ZZ 155 deux ${suffixe}`)).toHaveCount(0)

		await filtres(page).getByRole('button', { name: 'Toutes les pastilles' }).click()
		expect(valeursAdresse(page)).toEqual([])
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toBeVisible()
		await expect(filtres(page).getByTestId('inbox-bascule-pastille').first()).toBeFocused()
		await expect(filtres(page).getByRole('button', { name: 'Toutes les pastilles' })).toHaveCount(0)
	})

	test('au clavier : Tab jusqu’à « Spam », Espace ; le volet par Entrée, l’archivée par Entrée ; le focus reste sur la bascule', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${mails.sans}`)
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toBeVisible()
		const premiere = filtres(page).getByTestId('inbox-bascule-pastille').first()
		await premiere.focus()
		const noms = await filtres(page).getByTestId('inbox-bascule-pastille').allTextContents()
		for (let pas = 0; pas < noms.indexOf('Spam'); pas += 1) await page.keyboard.press('Tab')
		await expect(bascule(page, 'Spam')).toBeFocused()
		await page.keyboard.press('Space')
		await expect(bascule(page, 'Spam')).toHaveAttribute('aria-pressed', 'true')
		await expect(bascule(page, 'Spam')).toBeFocused()
		await expect(ligne(page, `ZZ 155 deux ${suffixe}`)).toBeVisible()
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toHaveCount(0)

		// Après la dernière bascule active : le volet, puis « Toutes les pastilles ».
		for (let pas = noms.indexOf('Spam'); pas < noms.length; pas += 1) await page.keyboard.press('Tab')
		const volet = filtres(page).getByTestId('inbox-volet-archivees')
		await expect(volet).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(volet).toHaveAttribute('aria-expanded', 'true')
		await page.keyboard.press('Tab')
		await expect(filtres(page).getByRole('button', { name: 'Toutes les pastilles' })).toBeFocused()
		await page.keyboard.press('Tab')
		const archivee = bascule(page, 'Newsletter, pastille archivée')
		await expect(archivee).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(archivee).toHaveAttribute('aria-pressed', 'true')
		expect(valeursAdresse(page)).toEqual([ids['Spam'], ids['Newsletter']])
		await transitionsFinies(page)
		await capturer(page, 'filtres-rapides-clavier-volet-1440', UNITE)
	})

	test('l’arrivée sur une archivée ouvre le volet ; une adresse retouchée est nettoyée au premier geste', async ({ page }) => {
		const invitation = await page.request.get(
			rest(`mail_messages?select=id&subject=like.${encodeURIComponent('Invitation — journée partenaires*')}`),
			{ headers: enTetesService() },
		)
		const [ligneInvitation] = (await invitation.json()) as { id: string }[]
		expect(ligneInvitation?.id, 'le seed porte l’invitation non classée (docs/SPEC-seed.md §46)').toBeTruthy()
		const idInvitation = ligneInvitation?.id ?? ''
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		// Une valeur mal formée, une inconnue, puis Newsletter : seule Newsletter compte.
		await page.goto(
			`/inbox?courrier=tous&message=${idInvitation}&pastille=xyz&pastille=00000000-0000-4000-8000-0000000000aa&pastille=${ids['Newsletter']}`,
		)
		await expect(filtres(page).getByTestId('inbox-volet-archivees')).toHaveAttribute('aria-expanded', 'true')
		await expect(bascule(page, 'Newsletter, pastille archivée')).toHaveAttribute('aria-pressed', 'true')
		await expect(liste(page).getByTestId('inbox-message').filter({ hasText: 'Invitation — journée partenaires' })).toBeVisible()
		await capturer(page, 'filtres-rapides-archivee-1440', UNITE)
		consommerTraceCadreIsole(page)
		// Le premier geste réécrit l'adresse avec les seules valeurs reconnues.
		await bascule(page, 'Lead').click()
		expect(valeursAdresse(page)).toEqual([ids['Newsletter'], ids['Lead']])
	})

	test('le vide : à une pastille, puis à plusieurs, il les nomme et porte « Toutes les pastilles »', async ({ page, request }) => {
		const absentes = await sansMailDansC1(request)
		expect(absentes.length, 'deux pastilles actives que le dossier ne porte pas').toBeGreaterThanOrEqual(2)
		const [a, b] = absentes as [string, string]
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${mails.sans}&pastille=${ids[a]}`)
		await expect(liste(page).getByText(`Aucun message ne porte la pastille « ${a} » dans ce dossier.`)).toBeVisible()
		await bascule(page, b).click()
		await expect(liste(page).getByText(`Aucun message ne porte l’une des pastilles « ${a} » ou « ${b} » dans ce dossier.`)).toBeVisible()
		// Les filtres restent rendus sur la liste vide : ils en sont la cause.
		await expect(filtres(page)).toBeVisible()
		await transitionsFinies(page)
		await capturer(page, 'filtres-rapides-vide-1440', UNITE)
		await liste(page).getByTestId('inbox-filtre-pastille-toutes-vide').click()
		expect(valeursAdresse(page)).toEqual([])
		await expect(ligne(page, `ZZ 155 trois ${suffixe}`)).toBeVisible()
	})

	test('les quatre paliers : les bascules passent à la ligne, la page ne défile jamais horizontalement', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/inbox?courrier=tous&message=${mails.lead}&pastille=${ids['Lead']}&pastille=${ids['Spam']}`)
			// Sous 1024 px, l'inbox est une pile : on remonte du message à la liste.
			const retour = page.getByRole('button', { name: 'Retour aux messages' })
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			if (await retour.isVisible()) await retour.click()
			await expect(filtres(page)).toBeVisible()
			await filtres(page).getByTestId('inbox-volet-archivees').click()
			await expect(bascule(page, 'Newsletter, pastille archivée')).toBeVisible()
			// Aucune bascule tronquée : chacune tient dans la colonne.
			const cadre = await filtres(page).boundingBox()
			for (const b of await filtres(page).getByTestId('inbox-bascule-pastille').all()) {
				const boite = await b.boundingBox()
				expect(boite && cadre && boite.x + boite.width <= cadre.x + cadre.width + 0.5, 'la bascule tient dans le bloc').toBe(true)
			}
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await transitionsFinies(page)
			await capturer(page, `filtres-rapides-${palier.nom}`, UNITE)
		}
	})
})
