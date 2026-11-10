// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : le repli confirmé sur la vraie pile, à la souris et au clavier — la
//           raison écrite, « Télécharger quand même », l'avertissement dans le flux, l'annulation qui n'écrit rien, la
//           confirmation enregistrée en base puis le téléchargement RÉEL par l'adresse signée, la pièce infectée sans
//           commande, la collègue à qui la confirmation d'autrui ne vaut rien ; les quatre paliers
// @verifies docs/SPEC-pieces-jointes.md §17.4, §17.9 (ligne « E2E `ui` ») ; docs/DESIGN_SYSTEM.md §5.95, §5.4, §7 ;
//           CLAUDE.md §10, §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les pièces naissent de la vraie table, sur un message du seed que l'administratrice et le business developer voient
// (docs/SPEC-seed.md §2.19) : leur objet est RÉELLEMENT déposé par la clé de service — le dépôt est le fait du service — et
// leur raison est posée par le déclencheur de la migration `0173`. Le scénario retire ce qu'il a créé, confirmations
// comprises (cascade).

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'

const UNITE = 'CRM-143'
const MSGID = '<seed-inbox-classe@p2enjoy.test>'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const NON_ANALYSEE = 'releve-non-analyse.pdf'
const INFECTEE = 'facture-infectee.pdf'

test.use({ viewport: { width: 1440, height: 1100 } })

type Creees = {
	readonly message: string
	readonly ids: string[]
	readonly chemins: string[]
}

/** Le message du seed, et deux pièces déposées : une non analysée faute d'antivirus, une infectée. */
async function poserLesPieces(request: APIRequestContext, suffixe: string): Promise<Creees> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=id,card_id&rfc822_message_id=eq.${encodeURIComponent(MSGID)}`,
		{ headers: enTetesService() },
	)
	const [message] = (await reponse.json()) as {
		id: string
		card_id: string | null
	}[]
	expect(message?.id, `le seed porte ${MSGID}`).toBeTruthy()
	const creees: Creees = { message: message!.id, ids: [], chemins: [] }
	for (const [nom, statut, octet] of [
		[NON_ANALYSEE, 'skipped', '7'],
		[INFECTEE, 'infected', '8'],
	] as const) {
		// Une empreinte HEXADÉCIMALE, propre à chaque scénario : le suffixe est encodé, jamais recopié.
		const empreinte = `${octet}${Buffer.from(suffixe).toString('hex')}`.padEnd(64, octet).slice(0, 64)
		const chemin = `${WORKSPACE}/${message!.id}/${empreinte}`
		const depot = await request.post(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, {
			// `x-upsert` : un passage interrompu peut avoir laissé l'objet, que ce dépôt remplace.
			headers: {
				...enTetesService(),
				'Content-Type': 'application/pdf',
				'x-upsert': 'true',
			},
			data: Buffer.from(`%PDF-1.4 ${nom}\n%%EOF\n`),
		})
		expect([200, 201], await depot.text()).toContain(depot.status())
		creees.chemins.push(chemin)
		const ligne = await request.post(`${URL_API}/rest/v1/mail_attachments?select=id`, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				message_id: message!.id,
				card_id: message!.card_id,
				filename: nom,
				mime_type: 'application/pdf',
				size_bytes: 40,
				storage_path: chemin,
				sha256: empreinte,
				av_status: statut,
			},
		})
		expect(ligne.status(), await ligne.text()).toBe(201)
		creees.ids.push(((await ligne.json()) as { id: string }[])[0]!.id)
	}
	return creees
}

async function retirer(request: APIRequestContext, creees: Creees): Promise<void> {
	for (const id of creees.ids) {
		await request.delete(`${URL_API}/rest/v1/mail_attachments?id=eq.${id}`, {
			headers: enTetesService(),
		})
	}
	for (const chemin of creees.chemins) {
		await request.delete(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, { headers: enTetesService() })
	}
}

async function confirmations(request: APIRequestContext, idPiece: string): Promise<string[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_attachment_risk_acknowledgments?select=user_id&attachment_id=eq.${idPiece}`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { user_id: string }[]).map((ligne) => ligne.user_id)
}

async function ouvrirLeMessage(page: Page, adresse: string, message: string): Promise<void> {
	await connecterAvecLeLabs(page, adresse)
	await page.goto(`/inbox?message=${message}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Demande de devis — refonte')
}

const piece = (page: Page, nom: string) =>
	page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe').filter({ hasText: nom })

test('à la souris : la raison, l’avertissement, l’annulation, puis la confirmation en base et le téléchargement réel', async ({
	page,
	request,
}) => {
	const creees = await poserLesPieces(request, 'souris')
	try {
		await ouvrirLeMessage(page, 'admin@p2enjoy.test', creees.message)
		const ligne = piece(page, NON_ANALYSEE)
		await expect(ligne.getByTestId('statut-piece')).toHaveText('non analysée : antivirus indisponible')
		await expect(ligne.getByTestId('apercu-piece')).toHaveCount(0)
		// L'INFECTÉE GARDE SA FORME : son statut, aucune commande.
		const infectee = piece(page, INFECTEE)
		await expect(infectee).toContainText('écartée par l’antivirus')
		await expect(infectee.getByRole('button')).toHaveCount(0)
		await capturer(page, 'non-analysee-ligne-1440', UNITE)

		const commande = ligne.getByTestId('telecharger-quand-meme')
		await commande.click()
		const avertissement = ligne.getByTestId('avertissement-piece')
		await expect(avertissement).toContainText('il peut contenir un logiciel malveillant')
		await expect(ligne.getByTestId('accepter-risque')).toBeFocused()
		await capturer(page, 'non-analysee-avertissement-1440', UNITE)

		// ANNULER N'ÉCRIT RIEN.
		await ligne.getByTestId('annuler-risque').click()
		await expect(avertissement).toHaveCount(0)
		await expect(commande).toBeFocused()
		expect(await confirmations(request, creees.ids[0]!)).toEqual([])

		// ACCEPTER : la confirmation est écrite en base, puis le fichier s'ouvre par l'adresse signée, et il se lit.
		await commande.click()
		// LE FICHIER S'OUVRE PAR L'ADRESSE SIGNÉE : la requête du nouvel onglet est observée sur le contexte — le navigateur
		// sans tête télécharge un PDF au lieu de le montrer, et l'onglet n'a alors pas d'adresse à lire. Le `POST` qui CRÉE
		// l'adresse vise le même chemin : seul le `GET` qui porte le jeton est l'ouverture.
		const signee = page
			.context()
			.waitForEvent(
				'request',
				(requete) =>
					requete.method() === 'GET' &&
					requete.url().includes('/storage/v1/object/sign/mail-attachments/') &&
					requete.url().includes('token='),
			)
		const ouverture = page.waitForEvent('popup')
		await ligne.getByTestId('accepter-risque').click()
		const adresse = (await signee).url()
		const fichier = await request.get(adresse)
		expect(fichier.status(), `${adresse} : ${await fichier.text()}`).toBe(200)
		expect(await fichier.text()).toContain(`%PDF-1.4 ${NON_ANALYSEE}`)
		await (await ouverture).close()
		await page.bringToFront()
		expect(await confirmations(request, creees.ids[0]!)).toHaveLength(1)
		await expect(ligne.getByTestId('telecharger-confirmee')).toBeFocused()
		await expect(ligne.getByTestId('statut-piece')).toHaveText('non analysée : antivirus indisponible')
		await capturer(page, 'non-analysee-confirmee-1440', UNITE)

		// RELUE, LA LIGNE PORTE « Télécharger » : la confirmation vient de la base, pas de l'écran.
		// L'ADRESSE ROUVERTE, et non rechargée : `?message=` se retire de l'adresse au montage (§5.90).
		await page.goto(`/inbox?message=${creees.message}`)
		await expect(piece(page, NON_ANALYSEE).getByTestId('telecharger-confirmee')).toBeVisible()
	} finally {
		await retirer(request, creees)
	}
})

test('au clavier : Entrée ouvre, Échap referme et rend le focus, Entrée confirme ; la collègue voit toujours l’avertissement', async ({
	page,
	request,
	browser,
}) => {
	const creees = await poserLesPieces(request, 'clavier')
	try {
		await ouvrirLeMessage(page, 'admin@p2enjoy.test', creees.message)
		const ligne = piece(page, NON_ANALYSEE)
		const commande = ligne.getByTestId('telecharger-quand-meme')
		await commande.focus()
		await page.keyboard.press('Enter')
		await expect(ligne.getByTestId('accepter-risque')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(ligne.getByTestId('avertissement-piece')).toHaveCount(0)
		await expect(commande).toBeFocused()
		await expect(commande).toHaveAttribute('aria-expanded', 'false')

		await page.keyboard.press('Enter')
		await expect(ligne.getByTestId('accepter-risque')).toBeFocused()
		const ouverture = page.waitForEvent('popup')
		await page.keyboard.press('Enter')
		await (await ouverture).close()
		await page.bringToFront()
		await expect(ligne.getByTestId('telecharger-confirmee')).toBeFocused()
		expect(await confirmations(request, creees.ids[0]!)).toHaveLength(1)

		// LA CONFIRMATION EST CELLE D'UNE PERSONNE : le business developer voit toujours « Télécharger quand même ».
		const contexte = await browser.newContext({
			viewport: { width: 1440, height: 1100 },
		})
		const collegue = await contexte.newPage()
		try {
			await ouvrirLeMessage(collegue, 'bizdev@p2enjoy.test', creees.message)
			await expect(piece(collegue, NON_ANALYSEE).getByTestId('telecharger-quand-meme')).toBeVisible()
			await expect(piece(collegue, NON_ANALYSEE).getByTestId('telecharger-confirmee')).toHaveCount(0)
		} finally {
			await contexte.close()
		}
	} finally {
		await retirer(request, creees)
	}
})

for (const palier of PALIERS) {
	test(`les paliers : ${palier.nom}, l’avertissement tient dans la fenêtre sans défilement de page`, async ({
		page,
		request,
	}) => {
		const creees = await poserLesPieces(request, `p${palier.largeur}`)
		try {
			await page.setViewportSize({
				width: palier.largeur,
				height: palier.hauteur,
			})
			await ouvrirLeMessage(page, 'admin@p2enjoy.test', creees.message)
			const ligne = piece(page, NON_ANALYSEE)
			await ligne.getByTestId('telecharger-quand-meme').click()
			const avertissement = ligne.getByTestId('avertissement-piece')
			await expect(avertissement).toBeVisible()
			await avertissement.scrollIntoViewIfNeeded()
			const cadre = await avertissement.boundingBox()
			expect(cadre, 'l’avertissement est rendu').not.toBeNull()
			expect(cadre!.x, 'bord gauche dans la fenêtre').toBeGreaterThanOrEqual(0)
			expect(cadre!.x + cadre!.width, 'bord droit dans la fenêtre').toBeLessThanOrEqual(palier.largeur)
			for (const bouton of [ligne.getByTestId('accepter-risque'), ligne.getByTestId('annuler-risque')]) {
				const boite = await bouton.boundingBox()
				expect(boite!.height, 'cible d’au moins 40 px').toBeGreaterThanOrEqual(40)
			}
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'aucun défilement horizontal de page').toBeLessThanOrEqual(0)
			await capturer(page, `non-analysee-palier-${palier.nom}`, UNITE)
		} finally {
			await retirer(request, creees)
		}
	})
}
