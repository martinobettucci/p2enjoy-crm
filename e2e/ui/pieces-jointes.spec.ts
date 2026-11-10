// @verifies CRM-074 (docs/BACKLOG.md) — tranche T3 : l'aperçu des pièces jointes sur la vraie pile — les cinq pièces du
//           courrier semé dans l'inbox (taille, « Aperçu » et « Télécharger »), le PDF dans son cadre et son texte extrait,
//           le scan sans texte, l'image, le fichier Office en texte seul, un seul panneau ouvert, Échap qui rend le focus ;
//           les mêmes pièces sous la ligne du courrier dans le fil de l'affaire ; les quatre paliers
// @verifies docs/DESIGN_SYSTEM.md §5.80, §5.4, §5.28, §7 ; docs/SPEC-pieces-jointes.md §5, §5.2 (décision 791) ;
//           docs/SPEC-seed.md §35 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
// @verifies CRM-143 (docs/BACKLOG.md) — tranche T6 : le fil de l'affaire montre aussi les deux pièces du seed qui ne se
//           téléchargent jamais, l'infectée et la trop volumineuse (docs/SPEC-seed.md §40 ; docs/DESIGN_SYSTEM.md §5.95)
//
// Le courrier vient du seed (§35) : réellement reçu, ses pièces analysées et leur texte extrait par la vraie chaîne. Le
// scénario ne fait que lire : rien n'est écrit, rien n'est à rendre.

import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'

const UNITE = 'CRM-074'
const MSGID = '<seed-pieces-jointes@p2enjoy.test>'
const OBJET = 'Dossier de consultation — monitoring Vertuo'

// LE CHROMIUM COMPLET, EN NOUVEAU MODE SANS TÊTE, ET NON LE « headless shell » par défaut : seul le premier porte le lecteur
// PDF du navigateur — mesuré, le cadre restait blanc sous le second, et la capture n'aurait rien montré du PDF (CLAUDE.md §16).
test.use({ viewport: { width: 1440, height: 1100 }, channel: 'chromium' })

async function ouvrirLeCourrier(page: Page): Promise<void> {
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(MSGID)}`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, `le seed porte ${MSGID} (docs/SPEC-seed.md §35)`).toBeTruthy()
	await page.goto(`/inbox?message=${ligne?.id ?? ''}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText(OBJET)
}

const piece = (page: Page, nom: string) =>
	page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe').filter({ hasText: nom })

test('l’inbox : cinq pièces ; le PDF dans son cadre et son texte, le scan sans texte ; Échap rend le focus', async ({ page }) => {
	await ouvrirLeCourrier(page)
	await expect(page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe')).toHaveCount(5)
	await expect(piece(page, 'devis-refonte-vertuo.pdf').getByTestId('taille-piece')).toHaveText('894 o')

	const devis = piece(page, 'devis-refonte-vertuo.pdf')
	const commande = devis.getByRole('button', { name: 'Aperçu de devis-refonte-vertuo.pdf' })
	await commande.click()
	await expect(commande).toHaveAttribute('aria-expanded', 'true')
	await expect(devis.getByTestId('apercu-pdf')).toHaveAttribute('src', /^blob:/)
	await expect(devis.getByTestId('texte-contenu')).toContainText('Devis n° 2026-118 — Refonte du monitoring Vertuo')
	await expect(devis.getByTestId('texte-contenu')).toContainText('Total hors taxes : 11 000 €')
	// La capture montre le PDF RENDU : le lecteur du navigateur peint hors du processus de la page, sans événement que la page
	// puisse observer. L'attente ne sert qu'à l'image, jamais à une assertion (CLAUDE.md §16, §18).
	await devis.getByTestId('apercu-pdf').scrollIntoViewIfNeeded()
	await page.waitForTimeout(2_000)
	await capturer(page, 'apercu-pdf-1440', UNITE)

	await page.keyboard.press('Escape')
	await expect(page.getByTestId('apercu-panneau')).toHaveCount(0)
	await expect(commande).toBeFocused()

	const scan = piece(page, 'plan-signe-scanne.pdf')
	await scan.getByRole('button', { name: /Aperçu de/ }).click()
	await expect(scan.getByTestId('texte-etat')).toHaveText('Aucun texte lisible : le document est sans doute numérisé.')
	await capturer(page, 'apercu-scan-1440', UNITE)
})

test('l’image s’affiche sans texte ; le fichier Office ne montre que son texte ; un seul panneau ouvert', async ({ page }) => {
	await ouvrirLeCourrier(page)
	const maquette = piece(page, 'maquette-accueil.png')
	await maquette.getByRole('button', { name: /Aperçu de/ }).click()
	const image = maquette.getByTestId('apercu-image')
	await expect(image).toBeVisible()
	expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
	await expect(maquette.getByTestId('texte-extrait')).toHaveCount(0)
	await capturer(page, 'apercu-image-1440', UNITE)

	const cahier = piece(page, 'cahier-des-charges.docx')
	await cahier.getByRole('button', { name: /Aperçu de/ }).click()
	await expect(page.getByTestId('apercu-panneau')).toHaveCount(1)
	await expect(cahier.getByTestId('apercu-pdf')).toHaveCount(0)
	await expect(cahier.getByTestId('texte-contenu')).toContainText('Cahier des charges — Refonte du monitoring')
	await capturer(page, 'apercu-texte-office-1440', UNITE)
})

test('le fil de l’affaire liste les pièces sous la ligne du courrier, et l’aperçu s’y ouvre', async ({ page }) => {
	await ouvrirLeCourrier(page)
	await page.getByTestId('inbox-pilule-card').click()
	const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
	const pieces = fil.getByTestId('inbox-piece-jointe')
	// les cinq du courrier reçu, proposition-monitoring.txt de l'envoi du seed, et les deux du courrier « Pièces à vérifier »
	// de `CRM-143` T6 (docs/SPEC-seed.md §40) : l'infectée et la trop volumineuse, sans commande.
	await expect(pieces).toHaveCount(8)
	await expect(pieces.filter({ hasText: 'eicar-test.txt' })).toContainText('écartée par l’antivirus')
	await expect(pieces.filter({ hasText: 'enregistrement-reunion.mov' })).toContainText('non analysée : trop volumineuse, non conservée')
	await expect(pieces.filter({ hasText: 'enregistrement-reunion.mov' }).getByRole('button')).toHaveCount(0)
	const budget = pieces.filter({ hasText: 'budget-previsionnel.xlsx' })
	await budget.getByRole('button', { name: /Aperçu de/ }).click()
	await expect(budget.getByTestId('texte-contenu')).toContainText('Tableaux de bord 7800')
	await capturer(page, 'fil-apercu-1440', UNITE)
	// Le texte de l'envoi du seed n'a pas d'aperçu : un texte brut se télécharge (§5.80).
	await expect(pieces.filter({ hasText: 'proposition-monitoring.txt' }).getByTestId('apercu-piece')).toHaveCount(0)
})

for (const palier of PALIERS) {
	test(`les paliers : ${palier.nom}, l’aperçu tient dans la fenêtre sans défilement de page`, async ({ page }) => {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await ouvrirLeCourrier(page)
		const devis = piece(page, 'devis-refonte-vertuo.pdf')
		await devis.getByRole('button', { name: /Aperçu de/ }).click()
		const panneau = devis.getByTestId('apercu-panneau')
		await expect(panneau.getByTestId('texte-contenu')).toBeVisible()
		const cadre = await panneau.boundingBox()
		expect(cadre, 'le panneau est rendu').not.toBeNull()
		expect(cadre!.x, 'bord gauche du panneau dans la fenêtre').toBeGreaterThanOrEqual(0)
		expect(cadre!.x + cadre!.width, 'bord droit du panneau dans la fenêtre').toBeLessThanOrEqual(palier.largeur)
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, 'aucun défilement horizontal de page').toBeLessThanOrEqual(0)
		await capturer(page, `apercu-palier-${palier.nom}`, UNITE)
	})
}
