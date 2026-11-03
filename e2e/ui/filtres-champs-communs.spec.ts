// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.b : filtrer la vue liste sur les champs de l'affaire, sur la pile réelle —
//           « contient » sans accents ni majuscules, un choix, une borne, une case « vide » ; l'adresse qui les porte et
//           se relit ; la borne illisible refusée ; « Effacer les filtres » ; le clavier ; la lectrice qui ne lit aucune
//           valeur d'un channel fermé, par requête directe ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/DESIGN_SYSTEM.md §5.92, §7 ; docs/JOURNAL.md décision 831
// @verifies CLAUDE.md §10 (la règle de lecture prouvée avec le jeton réel de la lectrice), §15, §16 (captures observées)
//
// Les champs de sonde portent le préfixe `sonde-112-lf`, les affaires le titre `tst-crm112-lf` ; la clé de service les
// pose dans « Grands comptes », que la lectrice ne lit pas, et les retire après chaque scénario — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const LISTE = '/tracks/conseil-ia/grands-comptes/liste'
const PREFIXE = 'sonde-112-lf'
const TITRE = 'tst-crm112-lf'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	for (const { id } of await lireService<{ id: string }>(request, `cards?select=id&title=like.${TITRE}*`)) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)).toEqual([])
	expect(await lireService(request, `cards?select=id&title=like.${TITRE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

type Sonde = { readonly champs: Record<'texte' | 'secteur' | 'ca' | 'signe', string>; readonly affaires: Record<'A' | 'B' | 'C', string> }

/**
 * Quatre champs posés par l'administratrice ; trois affaires de sonde et leurs valeurs, par la clé de service :
 * A — « Société Élan », BTP, 12 000, signé ; B — « Atelier Morel », Santé, 3 000, sans case ; C — aucune valeur.
 */
async function poser(request: APIRequestContext): Promise<Sonde> {
	const admin = { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' }
	const reponse = await request.post(rest('card_common_fields'), {
		headers: admin,
		data: [
			{ workspace_id: ESPACE, key: `${PREFIXE}-texte`, label: 'Raison sociale (sonde)', type: 'text', position: 901, options: {} },
			{
				workspace_id: ESPACE,
				key: `${PREFIXE}-secteur`,
				label: 'Secteur (sonde)',
				type: 'select',
				position: 902,
				options: { choices: [{ key: 'btp', label: 'BTP' }, { key: 'sante', label: 'Santé' }] },
			},
			{ workspace_id: ESPACE, key: `${PREFIXE}-ca`, label: 'Chiffre d’affaires (sonde)', type: 'money', position: 903, options: { currency: 'EUR' } },
			{ workspace_id: ESPACE, key: `${PREFIXE}-signe`, label: 'Contrat signé (sonde)', type: 'checkbox', position: 904, options: {} },
		],
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const lus = (await reponse.json()) as { id: string; key: string }[]
	const id = (suffixe: string) => lus.find((c) => c.key === `${PREFIXE}-${suffixe}`)?.id ?? ''
	const champs = { texte: id('texte'), secteur: id('secteur'), ca: id('ca'), signe: id('signe') }
	const affaires = { A: randomUUID(), B: randomUUID(), C: randomUUID() }
	for (const [lettre, idCard] of Object.entries(affaires)) {
		const creation = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: `${TITRE} ${lettre}` },
		})
		expect(creation.status(), await creation.text()).toBe(201)
	}
	const valeur = (card: string, champ: string, value: unknown) => ({ card_id: card, field_id: champ, workspace_id: ESPACE, value })
	const valeurs = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: [
			valeur(affaires.A, champs.texte, 'Société Élan'),
			valeur(affaires.A, champs.secteur, 'btp'),
			valeur(affaires.A, champs.ca, 12000),
			valeur(affaires.A, champs.signe, true),
			valeur(affaires.B, champs.texte, 'Atelier Morel'),
			valeur(affaires.B, champs.secteur, 'sante'),
			valeur(affaires.B, champs.ca, 3000),
		],
	})
	expect(valeurs.status(), await valeurs.text()).toBe(201)
	return { champs, affaires }
}

/**
 * Les affaires de sonde que la liste montre, par leur lettre. Lue par `expect.poll` : juste après « Appliquer », la liste
 * d'avant est encore à l'écran — *trouvé au second passage*, la lecture la prenait pour la nouvelle.
 */
async function sondesVisibles(page: Page): Promise<string[]> {
	await expect(page.getByTestId('tableau-liste').or(page.getByTestId('effacer-filtres-vide'))).toBeVisible()
	const titres = await page.getByTestId('ligne-card').getByRole('link').allTextContents()
	return titres.filter((titre) => titre.startsWith(TITRE)).map((titre) => titre.slice(TITRE.length + 1)).sort()
}

const panneau = (page: Page) => page.getByTestId('panneau-filtres-communs')
const filtre = (page: Page, suffixe: string) => panneau(page).locator(`[data-champ="${PREFIXE}-${suffixe}"]`)

async function appliquer(page: Page): Promise<void> {
	await panneau(page).getByTestId('appliquer-filtres-communs').click()
}

test.describe('Filtrer la liste sur les champs de l’affaire (docs/DESIGN_SYSTEM.md §5.92)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('contient, choix, borne, case vide : la liste suit, l’adresse les porte, effacer les retire', async ({ page, request }) => {
		await poser(request)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(LISTE)
		await expect.poll(() => sondesVisibles(page)).toEqual(['A', 'B', 'C'])

		const bouton = page.getByTestId('ouvrir-filtres-communs')
		await bouton.click()
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		// « contient » sans majuscule ni accent trouve « Société Élan ».
		await filtre(page, 'texte').getByLabel('Contient').fill('elan')
		await appliquer(page)
		await expect(page).toHaveURL(new RegExp(`c\\.${PREFIXE}-texte=elan`))
		await expect.poll(() => sondesVisibles(page)).toEqual(['A'])
		await expect(bouton).toHaveText('Champs de l’affaire (1)')
		await capturer(page, 'filtres-communs-contient-xl-1440', UNITE)

		// Un choix : Santé ; le texte retiré.
		await filtre(page, 'texte').getByLabel('Contient').fill('')
		await filtre(page, 'secteur').getByLabel('Santé').check()
		await appliquer(page)
		await expect.poll(() => sondesVisibles(page)).toEqual(['B'])

		// Une borne : à partir de 10 000.
		await filtre(page, 'secteur').getByLabel('Santé').uncheck()
		await filtre(page, 'ca').getByLabel('De').fill('10 000')
		await appliquer(page)
		await expect.poll(() => sondesVisibles(page)).toEqual(['A'])

		// Une case « vide » : B (sans valeur) et C (aucune valeur), jamais A (signé).
		await filtre(page, 'ca').getByLabel('De').fill('')
		await filtre(page, 'signe').getByRole('combobox').selectOption('vide')
		await appliquer(page)
		await expect.poll(() => sondesVisibles(page)).toEqual(['B', 'C'])

		// L'adresse se relit : rechargée, la liste reste filtrée, le panneau replié.
		await page.reload()
		await expect.poll(() => sondesVisibles(page)).toEqual(['B', 'C'])
		await expect(page.getByTestId('ouvrir-filtres-communs')).toHaveText('Champs de l’affaire (1)')

		await page.getByTestId('effacer-filtres').click()
		await expect.poll(() => sondesVisibles(page)).toEqual(['A', 'B', 'C'])
		await expect(page).not.toHaveURL(/c\./)
	})

	test('une borne illisible est refusée sous son champ ; au clavier, Échap rend le focus au bouton', async ({ page, request }) => {
		await poser(request)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(LISTE)
		const bouton = page.getByTestId('ouvrir-filtres-communs')
		await bouton.focus()
		await page.keyboard.press('Enter')
		await expect(panneau(page)).toBeVisible()
		const a = filtre(page, 'ca').getByLabel('À')
		await a.focus()
		await page.keyboard.type('douze')
		await appliquer(page)
		await expect(filtre(page, 'ca').getByText('Saisissez un nombre.')).toBeVisible()
		await expect(a).toHaveAttribute('aria-invalid', 'true')
		await expect(page).not.toHaveURL(/c\./)
		await capturer(page, 'filtres-communs-illisible-xl-1440', UNITE)
		await a.focus()
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(bouton).toBeFocused()
	})

	test('la lectrice ne lit aucune valeur d’un channel qu’elle ne lit pas : requête directe', async ({ request }) => {
		const sonde = await poser(request)
		const chemin = rest(`card_common_field_values?select=card_id&field_id=eq.${sonde.champs.texte}`)
		const deLaLectrice = await request.get(chemin, { headers: enTetesAuthentifies(await jetonDe(LECTRICE)) })
		expect(deLaLectrice.status()).toBe(200)
		expect(await deLaLectrice.json(), 'la politique de lecture ne lui ouvre aucune valeur de « Grands comptes »').toEqual([])
		const deLAdmin = await request.get(chemin, { headers: enTetesAuthentifies(await jetonDe(ADMIN)) })
		expect(((await deLAdmin.json()) as unknown[]).length, '(témoin) l’administratrice les lit').toBe(2)
		// Le filtre de la liste, rejoué sous son jeton : aucune affaire.
		const filtree = await request.get(
			rest(
				`card_placements?select=id,affaire:cards!inner(id,fc0:card_common_field_values!inner(field_id))&channel_id=eq.${CHANNEL}&affaire.fc0.field_id=eq.${sonde.champs.texte}&affaire.fc0.value_search=like.*elan*`,
			),
			{ headers: enTetesAuthentifies(await jetonDe(LECTRICE)) },
		)
		expect(filtree.status()).toBe(200)
		expect(await filtree.json()).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : le panneau dans le cadre, sans défilement de côté`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await poser(request)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(LISTE)
			await page.getByTestId('ouvrir-filtres-communs').click()
			await expect(panneau(page)).toBeVisible()
			const cadre = await panneau(page).boundingBox()
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await panneau(page).scrollIntoViewIfNeeded()
			await capturer(page, `filtres-communs-${palier.nom}`, UNITE)
		})
	}
})
