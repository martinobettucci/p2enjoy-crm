// @verifies CRM-157 (docs/BACKLOG.md) — tranche T2 : l'espace sans domaine sur la vraie pile — le formulaire d'envoi prévient
//           avant qu'on rédige (l'avertissement, « Mettre en file » éteint et décrit), le super-administrateur y trouve le
//           lien vers la fiche de l'espace, le refus de la base dit sa cause quand la lecture a été contournée, la
//           relecture d'un mail préparé prévient de même, la relance arrêtée faute de domaine est dite sur la fiche ; à la
//           souris, au clavier, aux quatre paliers ; captures
// @verifies docs/SPEC-mail-subsystem.md §33.2 bis, §33.3, §33.4, §33.6, §33.7 ; docs/DESIGN_SYSTEM.md §5.110, §5.59 ;
//           docs/JOURNAL.md décisions 951, 953 et 955 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// L'ESPACE EST JETABLE (`e2e/api/espace-sans-domaine.ts`) : le seed garde son espace unique (`CRM-005`). Sabine, la
// superadministratrice du seed, n'est membre d'aucun espace ; elle y est ajoutée le temps de la preuve du lien, retirée
// avec l'espace.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { type Page } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import {
	CAMILLE,
	ESPACE_SANS_DOMAINE,
	demonterEspaceSansDomaine,
	monterEspaceSansDomaine,
	poserRelanceArretee,
	type MontageSansDomaine,
} from '../api/espace-sans-domaine'
import { PALIERS, capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

// Révisé le 2026-11-21 (`CRM-161` T2.b, DS §5.113) : `getByLabel('Message', { exact: true })` — le bouton du menu des espaces porte
// « … des messages non lus … » dans son nom, et un libellé partiel l'attrapait aussi.

const UNITE = 'CRM-157'
const SABINE = { adresse: 'plateforme@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000018' } as const
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const TEXTE_REFUS =
	'Aucun mail ne peut partir de cet espace pour l’instant : il n’a pas de domaine d’adresses d’affaire, et les réponses ne reviendraient nulle part. Un super-administrateur le règle dans Plateforme ▸ Espaces.'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

let montage: MontageSansDomaine | null = null

test.beforeAll(async ({ request }) => {
	montage = await monterEspaceSansDomaine(request)
	const sabine = await request.post(rest('workspace_members'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { workspace_id: ESPACE_SANS_DOMAINE.id, user_id: SABINE.id, role: 'business_developer' },
	})
	expect(sabine.status(), await sabine.text()).toBe(201)
})
test.afterAll(async ({ request }) => {
	await demonterEspaceSansDomaine(request)
})

const ficheDe = (m: MontageSansDomaine) => `/tracks/${m.slugTrack}/${m.slugChannel}/cards/${m.idAffaire}`

async function ouvrirFormulaire(page: Page): Promise<void> {
	if (montage === null) throw new Error('montage absent')
	await page.goto(ficheDe(montage))
	await expect(page.getByTestId('entete-card').getByRole('heading', { name: montage.titreAffaire })).toBeVisible()
	await page.getByTestId('envoi-ouvrir').click()
	await expect(page.getByTestId('envoi-formulaire')).toBeVisible()
}

test.describe('envoyer depuis un espace sans domaine (docs/DESIGN_SYSTEM.md §5.110)', () => {
	test('à la souris : l’avertissement en tête, « Mettre en file » éteint et décrit, la rédaction possible', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await ouvrirFormulaire(page)
		const note = page.getByTestId('envoi-domaine-absent')
		await expect(note).toBeVisible()
		await expect(note).toHaveAttribute('role', 'note')
		await expect(note).toContainText('Un super-administrateur le règle dans Plateforme ▸ Espaces.')
		await expect(page.getByTestId('envoi-domaine-lien')).toHaveCount(0)
		const valider = page.getByTestId('envoi-valider')
		await expect(valider).toBeDisabled()
		await expect(valider).toHaveAttribute('aria-describedby', /envoi-domaine-absent/)
		await page.getByLabel('Message', { exact: true }).fill('Bonjour, voici notre proposition.')
		await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Bonjour, voici notre proposition.')
		await capturer(page, 'envoi-sans-domaine-1440', UNITE)
	})

	test('au clavier : Entrée ouvre le formulaire, l’avertissement est lu avant les champs, la saisie reste possible', async ({
		page,
	}) => {
		if (montage === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await page.goto(ficheDe(montage))
		// Révisé le 2026-11-21 (campagne du lot `CRM-161`) : la commande est attendue ACTIVE avant le focus. Pendant la lecture
		// des capacités de l'espace, elle est désactivée sans motif (`CRM-093`, docs/SPEC-droits-interface.md) ; un bouton
		// désactivé refuse le focus, et l'Entrée tombait sur la page (mesuré : l'élément actif restait `BODY`, deux fois sur cinq
		// rejoué seul). Le clic de la preuve à la souris attend de lui-même qu'elle soit active ; le focus, non. Il est constaté
		// avant la touche.
		await expect(page.getByTestId('entete-card').getByRole('heading', { name: montage.titreAffaire })).toBeVisible()
		const ouvrir = page.getByTestId('envoi-ouvrir')
		await expect(ouvrir).toBeEnabled()
		await ouvrir.focus()
		await expect(ouvrir).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('envoi-domaine-absent')).toBeVisible()
		// L'avertissement précède le premier champ dans l'ordre du document : il est lu avant qu'on rédige.
		const avant = await page.evaluate(() => {
			const note = document.querySelector('[data-testid="envoi-domaine-absent"]')
			const champ = document.querySelector('#envoi-identite')
			return note !== null && champ !== null && (note.compareDocumentPosition(champ) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
		})
		expect(avant, 'l’avertissement vient avant « Expédier depuis »').toBe(true)
		await page.getByLabel('Message', { exact: true }).focus()
		await page.keyboard.type('Rédigé au clavier.')
		await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Rédigé au clavier.')
		await expect(page.getByTestId('envoi-valider')).toBeDisabled()
	})

	test('le super-administrateur trouve le lien vers la fiche de l’espace', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		await ouvrirFormulaire(page)
		const lien = page.getByTestId('envoi-domaine-lien')
		await expect(lien).toHaveText('Régler le domaine de l’espace')
		await expect(lien).toHaveAttribute('href', `/plateforme/espaces/${ESPACE_SANS_DOMAINE.slug}`)
		await capturer(page, 'envoi-sans-domaine-superadmin-1440', UNITE)
		await lien.click()
		await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${ESPACE_SANS_DOMAINE.slug}$`))
	})

	test('la lecture contournée, la base refuse : le refus dit sa cause, la saisie gardée', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		// La lecture du domaine échoue : rien n'est éteint (§5.59), et c'est la base qui refuse, par son nom.
		// La SEULE lecture du formulaire (`COLONNES_DOMAINE_AFFAIRE`) : l'en-tête de la fiche lit aussi le domaine, autrement.
		await page.route(/\/rest\/v1\/cards\?select=workspace_id%2Cworkspaces%28slug%2Cinbound_domain%29/, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"indisponible"}' }),
		)
		await ouvrirFormulaire(page)
		await expect(page.getByTestId('envoi-domaine-absent')).toHaveCount(0)
		await page.getByLabel('Destinataires').fill('client@exterieur.test')
		await page.getByLabel('Message', { exact: true }).fill('Bonjour.')
		await page.getByTestId('envoi-valider').click()
		await expect(page.getByTestId('envoi-formulaire').getByRole('alert')).toHaveText(TEXTE_REFUS)
		await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Bonjour.')
		await capturer(page, 'envoi-refus-domaine-1440', UNITE)
		// La panne simulée de la lecture et le refus de la base sont les erreurs que ce scénario vient de vérifier. La lecture
		// part QUATRE fois : le client PostgREST relance d'office une lecture qui rend `503` (trois relances, mesuré).
		const indisponible = 'console.error: Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
		autoriserErreursConsole(page, [indisponible, indisponible, indisponible, indisponible, ERREUR_RESSOURCE_HTTP[400]])
	})

	test('la relecture d’un mail préparé prévient de même', async ({ page, request }) => {
		if (montage === null) throw new Error('montage absent')
		const camille = { ...enTetesAuthentifies(await jetonDe(CAMILLE.adresse)), 'Content-Type': 'application/json' }
		const prepare = await request.post(rest('rpc/prepare_email'), {
			headers: camille,
			data: { p_card_id: montage.idAffaire, p_to: ['client@exterieur.test'], p_body_text: 'Préparé dans l’espace jetable.' },
		})
		expect(prepare.status(), await prepare.text()).toBe(200)
		const idBrouillon = (await prepare.json()) as string
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		// Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.4 et §15.5, décision 974) : le brouillon est de
		// l'espace jetable ; l'ANCIENNE adresse le mène dans son espace (la redirection du §15.4). `/p2enjoy/inbox?brouillon=`
		// — l'inbox du seed — ne passait qu'à la faveur du défaut 974, la page montée avant que l'espace ne soit lu.
		await page.goto(`/inbox?brouillon=${idBrouillon}`)
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SANS_DOMAINE.slug}/inbox`))
		await expect(page.getByTestId('envoi-domaine-absent')).toBeVisible()
		await expect(page.getByTestId('envoi-valider')).toBeDisabled()
		await capturer(page, 'relecture-sans-domaine-1440', UNITE)
	})

	test('une relance arrêtée faute de domaine est dite sur la fiche, au-dessus du geste d’armement', async ({
		page,
		request,
	}) => {
		if (montage === null) throw new Error('montage absent')
		await poserRelanceArretee(request, montage)
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await page.goto(ficheDe(montage))
		const note = page.getByTestId('sequence-arretee-domaine')
		await expect(note).toHaveText(
			'La relance s’est arrêtée : l’espace n’a pas de domaine d’adresses d’affaire, et les réponses ne reviendraient nulle part. Réarmez-la une fois le domaine réglé.',
		)
		await note.scrollIntoViewIfNeeded()
		await capturer(page, 'relance-arretee-domaine-1440', UNITE)
	})

	test('les quatre paliers : l’avertissement passe à la ligne, la page ne défile jamais de côté', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrirFormulaire(page)
			await expect(page.getByTestId('envoi-domaine-absent')).toBeVisible()
			await page.getByTestId('envoi-domaine-absent').scrollIntoViewIfNeeded()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `envoi-sans-domaine-${palier.nom}`, UNITE)
		}
	})
})
