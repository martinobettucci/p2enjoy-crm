// @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.a : Réglages ▸ « Champs de l'affaire » sur la pile réelle — déclarer
//           une liste à choix, la modifier, la réordonner, l'archiver et la restaurer à la souris et au clavier ; l'archivage
//           d'un champ exigé refusé par la base, qui nomme la transition ; la lectrice, refusée à l'écran ET par une
//           écriture directe ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §3.2, §4, §6, §7 ; docs/DESIGN_SYSTEM.md §5.86, §5.59, §7, §8
// @verifies CLAUDE.md §10 (le refus prouvé avec le jeton réel de la lectrice), §15 (état déterministe, effets relus en
//           base), §16 (captures observées)
//
// Les champs de sonde portent le préfixe `sonde-112-r` ; l'exigence qui bloque l'archivage est posée par l'administratrice
// elle-même, sur la transition `…0071` du seed. Après chaque scénario, la clé de service retire l'exigence puis les
// champs — retrait CONSTATÉ.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	connecterAvecLeLabs,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const ECRAN = '/reglages/champs'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const TRANSITION = '5eed0000-0000-4000-8000-000000000071'
const PREFIXE = 'sonde-112-r'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	const sondes = await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)
	if (sondes.length > 0) {
		const ids = sondes.map((s) => s.id).join(',')
		await request.delete(rest(`workflow_transition_required_common_fields?common_field_id=in.(${ids})`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=in.(${ids})`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${PREFIXE}*`), 'aucun champ de sonde ne doit rester').toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** Deux champs posés par l'administratrice, avec son jeton : un texte, et un second texte qu'une transition exige. */
async function poserDeux(request: APIRequestContext): Promise<string> {
	const entetes = { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' }
	const reponse = await request.post(rest('card_common_fields'), {
		headers: entetes,
		data: [
			{ workspace_id: ESPACE, key: `${PREFIXE}-tva`, label: 'Numéro de TVA (sonde)', type: 'text' },
			{ workspace_id: ESPACE, key: `${PREFIXE}-siret`, label: 'SIRET (sonde)', type: 'text' },
		],
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [, siret] = (await reponse.json()) as { id: string }[]
	const exigence = await request.post(rest('workflow_transition_required_common_fields'), {
		headers: entetes,
		data: { transition_id: TRANSITION, common_field_id: siret?.id },
	})
	expect(exigence.status(), await exigence.text()).toBe(201)
	return siret?.id ?? ''
}

const ligne = (page: Page, cle: string) => page.locator(`[data-champ="${cle}"]`)

test.describe('Réglages ▸ Champs de l’affaire (docs/DESIGN_SYSTEM.md §5.86)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('déclarer, modifier, réordonner, archiver et restaurer ; l’archivage d’un champ exigé est refusé et nommé', async ({ page, request }) => {
		const idSiret = await poserDeux(request)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages')
		await page.getByTestId('entree-champs-affaire').click()
		await expect(page).toHaveURL(/\/reglages\/champs$/)
		await expect(page.getByRole('heading', { level: 2, name: 'Champs de l’affaire' })).toBeVisible()
		await expect(ligne(page, `${PREFIXE}-siret`)).toBeVisible()

		// Déclarer une liste à choix.
		await page.getByTestId('nouveau-champ-commun').click()
		await expect(page.getByLabel('Clé')).toBeFocused()
		await page.getByLabel('Clé').fill(`${PREFIXE}-secteur`)
		await page.getByLabel('Libellé', { exact: true }).fill('Secteur (sonde)')
		await page.getByLabel('Type').selectOption('select')
		await page.getByRole('button', { name: 'Ajouter un choix' }).click()
		await page.getByLabel('Clé du choix').first().fill('industrie')
		await page.getByLabel('Libellé du choix').first().fill('Industrie')
		await capturer(page, 'champs-affaire-declarer-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(ligne(page, `${PREFIXE}-secteur`)).toBeVisible()
		await expect(page.getByTestId('nouveau-champ-commun')).toBeFocused()
		const [secteur] = await lireService<{ type: string; options: unknown; label: string }>(
			request,
			`card_common_fields?select=type,options,label&key=eq.${PREFIXE}-secteur`,
		)
		expect(secteur).toEqual({ type: 'select', options: { choices: [{ key: 'industrie', label: 'Industrie' }] }, label: 'Secteur (sonde)' })

		// Modifier : la clé et le type se lisent en phrase ; le libellé change.
		await ligne(page, `${PREFIXE}-secteur`).getByRole('button', { name: /Modifier le champ/ }).click()
		await expect(page.getByTestId('champ-cle-figee')).toContainText(`${PREFIXE}-secteur`)
		await page.getByLabel('Libellé', { exact: true }).fill('Secteur d’activité (sonde)')
		await page.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(ligne(page, `${PREFIXE}-secteur`)).toContainText('Secteur d’activité (sonde)')

		// Réordonner, au clavier : le secteur, déclaré en dernier, monte d'un rang.
		const monter = ligne(page, `${PREFIXE}-secteur`).getByRole('button', { name: /Monter/ })
		await monter.focus()
		await page.keyboard.press('Enter')
		const ordre = await lireService<{ key: string }>(request, `card_common_fields?select=key&key=like.${PREFIXE}*&order=position`)
		await expect
			.poll(async () => (await lireService<{ key: string }>(request, `card_common_fields?select=key&key=like.${PREFIXE}*&order=position`)).map((c) => c.key))
			.toEqual([`${PREFIXE}-tva`, `${PREFIXE}-secteur`, `${PREFIXE}-siret`])
		expect(ordre.length).toBe(3)

		// Archiver le SIRET, exigé par une transition : la base refuse et nomme la transition ; le lien mène à l'éditeur.
		await ligne(page, `${PREFIXE}-siret`).getByRole('button', { name: /Archiver le champ/ }).click()
		const confirmation = page.getByTestId('confirmation-archivage-champ-commun')
		await confirmation.getByRole('button', { name: 'Archiver', exact: true }).click()
		const alerte = confirmation.getByRole('alert')
		await expect(alerte).toContainText('Ce champ est exigé par des transitions')
		await expect(alerte).toContainText('Cycle commercial standard')
		await expect(confirmation.getByRole('link', { name: 'Ouvrir l’éditeur de workflows' })).toHaveAttribute('href', '/reglages/workflows')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'champs-affaire-refus-employe-xl-1440', UNITE)
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		const [siret] = await lireService<{ archived_at: string | null }>(request, `card_common_fields?select=archived_at&id=eq.${idSiret}`)
		expect(siret?.archived_at).toBeNull()

		// Archiver la TVA, que rien n'exige : elle quitte la liste, puis revient sous « Afficher les archivés » et se restaure.
		await ligne(page, `${PREFIXE}-tva`).getByRole('button', { name: /Archiver le champ/ }).click()
		await page.getByTestId('confirmation-archivage-champ-commun').getByRole('button', { name: 'Archiver', exact: true }).click()
		await expect(ligne(page, `${PREFIXE}-tva`)).toHaveCount(0)
		await page.getByTestId('champs-communs-archives').check()
		await expect(ligne(page, `${PREFIXE}-tva`)).toContainText('Archivé')
		await ligne(page, `${PREFIXE}-tva`).getByRole('button', { name: /Restaurer le champ/ }).click()
		await expect(ligne(page, `${PREFIXE}-tva`)).not.toContainText('Archivé')
		const [tva] = await lireService<{ archived_at: string | null }>(request, `card_common_fields?select=archived_at&key=eq.${PREFIXE}-tva`)
		expect(tva?.archived_at).toBeNull()
	})

	test('la lectrice consulte : le motif en tête, les commandes éteintes ; une écriture directe est refusée par la base', async ({ page, request }) => {
		await poserDeux(request)
		const ecriture = await request.post(rest('card_common_fields'), {
			headers: enTetesAuthentifies(await jetonDe(LECTRICE)),
			data: { workspace_id: ESPACE, key: `${PREFIXE}-pirate`, label: 'Pirate', type: 'text' },
		})
		expect(ecriture.status(), 'la RLS refuse la déclaration à la lectrice').toBe(403)
		const archivage = await request.patch(rest(`card_common_fields?key=eq.${PREFIXE}-tva`), {
			headers: { ...enTetesAuthentifies(await jetonDe(LECTRICE)), Prefer: 'return=representation' },
			data: { archived_at: new Date().toISOString() },
		})
		expect(await archivage.json(), 'la RLS filtre l’archivage : aucune ligne').toEqual([])

		await connecterAvecLeLabs(page, LECTRICE)
		await page.goto(ECRAN)
		await expect(ligne(page, `${PREFIXE}-tva`)).toBeVisible()
		await expect(page.getByTestId('motif-lecture-seule')).toBeVisible()
		await expect(page.getByTestId('nouveau-champ-commun')).toBeDisabled()
		await expect(ligne(page, `${PREFIXE}-tva`).getByRole('button', { name: /Modifier le champ/ })).toBeDisabled()
		await capturer(page, 'champs-affaire-lectrice-xl-1440', UNITE)
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : la liste et le formulaire dans le cadre, sans défilement de côté`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await poserDeux(request)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(ECRAN)
			await expect(ligne(page, `${PREFIXE}-siret`)).toBeVisible()
			for (const cle of [`${PREFIXE}-tva`, `${PREFIXE}-siret`]) {
				const boite = await ligne(page, cle).boundingBox()
				expect((boite?.x ?? 0) + (boite?.width ?? 0), cle).toBeLessThanOrEqual(palier.largeur)
			}
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `champs-affaire-liste-${palier.nom}`, UNITE)
			await page.getByTestId('nouveau-champ-commun').click()
			await page.getByLabel('Type').selectOption('select')
			const formulaire = page.getByTestId('formulaire-champ')
			const cadre = await formulaire.boundingBox()
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			await capturer(page, `champs-affaire-formulaire-${palier.nom}`, UNITE)
		})
	}
})
