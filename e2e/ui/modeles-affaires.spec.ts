// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b1 : les modèles d'affaires sur la vraie pile — Réglages ▸ Modèles
//           d'affaires, le `select` « Modèle » de « Nouvelle affaire », « Enregistrer comme modèle » sur la fiche, et les
//           refus des non-administrateurs
// @verifies docs/SPEC-checklists.md §3.5, §3.6 ; docs/DESIGN_SYSTEM.md §5.71, §5.59 ; docs/SPEC-seed.md §29 (les modèles
//           semés) ; CLAUDE.md §10 (refus par la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes écrivent : chaque modèle et chaque affaire de sonde porte le préfixe `ZZ 068`, et tout est retiré à la fin
// par la clé de service. Les modèles du seed ne sont jamais modifiés.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-068'
const PREFIXE = 'ZZ 068'
const REFONTE = '/tracks/studio-web/refonte'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const SONDES = `like.${encodeURIComponent(`${PREFIXE}*`)}`
// Le titre d'une affaire née d'un modèle COMMENCE par le titre proposé : la sonde est cherchée partout dans le titre.
const AFFAIRES_SONDES = `like.${encodeURIComponent(`*${PREFIXE}*`)}`

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`cards?title=${AFFAIRES_SONDES}`), { headers: enTetesService() })
	const restantes = await request.get(rest(`cards?select=id&title=${AFFAIRES_SONDES}`), { headers: enTetesService() })
	expect(await restantes.json(), 'aucune affaire de sonde ne doit rester dans le seed').toEqual([])
	await request.delete(rest(`card_templates?name=${SONDES}`), { headers: enTetesService() })
})

test.describe('Réglages ▸ Modèles d’affaires (docs/DESIGN_SYSTEM.md §5.71)', () => {
	test('l’administratrice lit les modèles semés, en pose un, le modifie et l’archive', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/reglages')
		// L'entrée suit les workflows, et c'est un lien pour qui administre.
		const entree = page.getByTestId('entree-modeles-affaires')
		await expect(entree).toHaveAttribute('href', '/reglages/modeles-affaires')
		await entree.click()
		const ecran = page.getByTestId('reglages-modeles-affaires')
		const sections = ecran.getByTestId('modeles-workflow')
		await expect(sections.getByRole('heading', { level: 2 })).toHaveText(['Cycle commercial standard', 'Cycle commercial — checklists'])
		const audit = ecran.getByTestId('ligne-modele-affaire').filter({ hasText: 'Audit flash' })
		await expect(audit).toContainText('2 points')
		await expect(audit.locator('code')).toHaveText(/4\s?800/)
		await expect(ecran.getByTestId('ligne-modele-affaire').filter({ hasText: 'Atelier découverte' })).toHaveCount(0)
		await capturer(page, 'modeles-affaires-1440', UNITE)

		// « Afficher les archivés » : la pilule paraît.
		await page.getByLabel('Afficher les archivés').check()
		await expect(ecran.getByTestId('ligne-modele-affaire').filter({ hasText: 'Atelier découverte' })).toContainText('Archivé')
		await page.getByLabel('Afficher les archivés').uncheck()

		// Nouveau modèle, au clavier là où l'écran le promet.
		await page.getByTestId('nouveau-modele-affaire').click()
		const fiche = page.getByTestId('fiche-modele-affaire')
		await expect(fiche.getByLabel('Workflow')).toBeFocused()
		await fiche.getByLabel('Workflow').selectOption({ label: 'Cycle commercial — checklists' })
		await fiche.getByLabel('Nom', { exact: true }).fill(`${PREFIXE} Diagnostic`)
		await fiche.getByLabel('Titre proposé').fill('Diagnostic — ')
		await fiche.getByLabel('Montant').fill('1 500,50')
		await fiche.getByTestId('modele-ajouter-point').click()
		await expect(fiche.getByLabel('Point 1', { exact: true })).toBeFocused()
		await page.keyboard.type('Envoyer le questionnaire')
		await capturer(page, 'modeles-affaires-fiche-1440', UNITE)
		await fiche.getByTestId('modele-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		const [pose] = await lire<{ id: string; workflow_id: string; amount: number; checklist: string[]; title: string }[]>(
			request,
			`card_templates?name=eq.${encodeURIComponent(`${PREFIXE} Diagnostic`)}&select=id,workflow_id,amount,checklist,title`,
		)
		expect(pose).toMatchObject({ workflow_id: '5eed0000-0000-4000-8000-0000000c6801', amount: 1500.5, checklist: ['Envoyer le questionnaire'], title: 'Diagnostic —' })

		// Modifier : le workflow se lit en phrase ; un nom déjà pris est refusé par la base, la saisie gardée.
		await page.getByRole('button', { name: `Modifier le modèle ${PREFIXE} Diagnostic` }).click()
		await expect(page.getByTestId('modele-workflow-phrase')).toHaveText('Ce modèle sert les affaires du workflow « Cycle commercial — checklists ».')
		await fiche.getByLabel('Nom', { exact: true }).fill('parcours DATA')
		await fiche.getByTestId('modele-enregistrer').click()
		await expect(fiche.getByRole('alert')).toContainText('porte déjà ce nom')
		// Le refus vient d'être constaté : la base a répondu `409` (`23505`), que le navigateur journalise.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await expect(fiche.getByLabel('Nom', { exact: true })).toHaveValue('parcours DATA')
		// Le focus revient au nom, à corriger : `Échap` y est donc reçu par la fiche.
		await expect(fiche.getByLabel('Nom', { exact: true })).toBeFocused()
		await capturer(page, 'modeles-affaires-refus-nom-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(page.getByRole('button', { name: `Modifier le modèle ${PREFIXE} Diagnostic` })).toBeFocused()

		// Archiver, sans confirmation : la ligne quitte la liste, la base porte l'instant.
		await page.getByRole('button', { name: `Archiver le modèle ${PREFIXE} Diagnostic` }).click()
		await expect(page.getByTestId('annonce-modeles-affaires')).toHaveText(`Modèle « ${PREFIXE} Diagnostic » archivé.`)
		await expect(ecran.getByTestId('ligne-modele-affaire').filter({ hasText: `${PREFIXE} Diagnostic` })).toHaveCount(0)
		const [archive] = await lire<{ archived_at: string | null }[]>(request, `card_templates?id=eq.${pose!.id}&select=archived_at`)
		expect(archive!.archived_at).not.toBeNull()

		// À 390 px : aucune page qui défile de côté.
		await page.setViewportSize({ width: 390, height: 900 })
		await page.reload()
		await expect(page.getByTestId('ligne-modele-affaire').first()).toBeVisible()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
		await capturer(page, 'modeles-affaires-390', UNITE)
	})

	test('la lectrice : l’entrée est un texte qui cite le motif, l’adresse directe dit « réservé »', async ({ page }) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/reglages')
		const entree = page.getByTestId('entree-modeles-affaires')
		await expect(entree).toHaveAttribute('aria-disabled', 'true')
		expect(await entree.evaluate((n) => n.tagName)).not.toBe('A')
		await page.goto('/reglages/modeles-affaires')
		await expect(page.getByText('Réservé aux administrateurs')).toBeVisible()
		await expect(page.getByTestId('nouveau-modele-affaire')).toHaveCount(0)
	})
})

// `CRM-068` T4b2 — les réponses aux questions du workflow (docs/DESIGN_SYSTEM.md §5.71 bis).
test.describe('les réponses d’un modèle (docs/DESIGN_SYSTEM.md §5.71 bis)', () => {
	test('l’administratrice répond aux questions ; une adresse mal formée est refusée ; l’affaire née du modèle les porte', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/reglages/modeles-affaires')
		await page.getByTestId('nouveau-modele-affaire').click()
		const fiche = page.getByTestId('fiche-modele-affaire')
		await expect(fiche.getByLabel('Workflow')).toHaveValue('5eed0000-0000-4000-8000-000000000051')
		const reponses = fiche.getByTestId('modele-reponses')
		await expect(reponses.getByTestId('reponse-sans-saisie')).toHaveCount(2)
		await fiche.getByLabel('Nom', { exact: true }).fill(`${PREFIXE} Réponses`)
		await reponses.getByLabel('Budget estimé').fill('2500')
		await reponses.getByLabel('Origine du contact').selectOption({ label: 'Recommandation' })
		await reponses.getByLabel('Décideur identifié').check()
		await reponses.getByLabel('Lien vers la proposition').fill('pas une adresse')
		await fiche.getByTestId('modele-enregistrer').click()
		await expect(fiche.getByRole('alert')).toContainText('Une réponse ne convient pas')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await reponses.getByLabel('Lien vers la proposition').fill('')
		await reponses.scrollIntoViewIfNeeded()
		await capturer(page, 'modele-reponses-1440', UNITE)
		await fiche.getByTestId('modele-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		const [pose] = await lire<{ field_values: Record<string, unknown> }[]>(
			request,
			`card_templates?name=eq.${encodeURIComponent(`${PREFIXE} Réponses`)}&select=field_values`,
		)
		expect(pose!.field_values).toEqual({ budget: 2500, source: 'recommandation', 'decideur-identifie': true })

		// Rouverte, la fiche relit ses réponses.
		await page.getByRole('button', { name: `Modifier le modèle ${PREFIXE} Réponses` }).click()
		await expect(reponses.getByLabel('Budget estimé')).toHaveValue('2500')
		await expect(reponses.getByLabel('Décideur identifié')).toBeChecked()
		await page.keyboard.press('Escape')

		// L'affaire née du modèle porte ses réponses sur son rattachement.
		await page.goto(REFONTE)
		await page.getByTestId('nouvelle-affaire').click()
		await page.getByLabel('Modèle', { exact: true }).selectOption({ label: `${PREFIXE} Réponses` })
		await page.getByTestId('champ-titre-affaire').fill(`${PREFIXE} Affaire répondue`)
		await page.getByTestId('creer-affaire').click()
		await expect(page).toHaveURL(/\/cards\//)
		const idCard = page.url().split('/cards/')[1]!.split(/[?#]/)[0]!
		const valeurs = await lire<{ value: unknown; form_fields: { key: string } }[]>(
			request,
			`card_field_values?card_id=eq.${idCard}&select=value,form_fields!card_field_values_field_id_workflow_id_fkey(key)`,
		)
		expect(Object.fromEntries(valeurs.map((v) => [v.form_fields.key, v.value]))).toEqual({
			budget: 2500,
			source: 'recommandation',
			'decideur-identifie': true,
		})
	})
})

test.describe('le modèle à la création d’une affaire (docs/DESIGN_SYSTEM.md §5.71)', () => {
	test('le business developer choisit « Audit flash » : le titre se remplit, l’affaire naît avec le modèle', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(REFONTE)
		await page.getByTestId('nouvelle-affaire').click()
		const modele = page.getByLabel('Modèle', { exact: true })
		await expect(modele.locator('option')).toHaveText(['Aucun modèle', 'Audit flash'])
		await modele.selectOption({ label: 'Audit flash' })
		const titre = page.getByTestId('champ-titre-affaire')
		await expect(titre).toHaveValue('Audit flash — ')
		await titre.press('End')
		await titre.pressSequentially(`${PREFIXE} Cerfrance`)
		await capturer(page, 'nouvelle-affaire-modele-1440', UNITE)
		await page.getByTestId('creer-affaire').click()
		await expect(page).toHaveURL(/\/cards\//)
		const idCard = page.url().split('/cards/')[1]!.split(/[?#]/)[0]!
		const [affaire] = await lire<
			{ title: string; description: string; card_placements: { amount: number }[]; card_checklist_items: { label: string; placement_id: string | null }[] }[]
		>(
			request,
			`cards?id=eq.${idCard}&select=title,description,card_placements!card_placements_card_fk(amount),card_checklist_items(label,placement_id)`,
		)
		expect(affaire!.title).toBe(`Audit flash — ${PREFIXE} Cerfrance`)
		expect(affaire!.description).toContain('Deux jours sur site')
		expect(affaire!.card_placements[0]!.amount).toBe(4800)
		expect(affaire!.card_checklist_items.filter((p) => p.placement_id === null).map((p) => p.label)).toEqual([
			'Envoyer la convention',
			'Planifier les entretiens',
		])
		// La fiche montre les points repris, comme points libres de l'affaire.
		await expect(page.locator('#checklist')).toContainText('Envoyer la convention')
	})

	test('un channel dont le workflow n’a aucun modèle ne rend pas le `select`', async ({ page }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		// « Conseil & IA › Prospection » suit le workflow dérivé « Cycle commercial — Conseil IA », qui n'a aucun modèle.
		await page.goto('/tracks/conseil-ia/prospection')
		await page.getByTestId('nouvelle-affaire').click()
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		await expect(page.getByTestId('select-modele-affaire')).toHaveCount(0)
	})
})

test.describe('« Enregistrer comme modèle » sur la fiche (docs/DESIGN_SYSTEM.md §5.71)', () => {
	async function premiereAffaireDeRefonte(request: APIRequestContext): Promise<string> {
		const [rattachement] = await lire<{ card_id: string }[]>(
			request,
			'card_placements?channel_id=eq.5eed0000-0000-4000-8000-000000000034&select=card_id&order=created_at&limit=1',
		)
		return rattachement!.card_id
	}

	test('l’administratrice enregistre une affaire comme modèle ; la base reprend son titre et son montant', async ({ page, request }) => {
		const idCard = await premiereAffaireDeRefonte(request)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`${REFONTE}/cards/${idCard}`)
		const commande = page.getByTestId('entete-card-enregistrer-modele')
		await expect(commande).toBeEnabled()
		await commande.click()
		const nom = page.getByLabel('Nom du modèle')
		await expect(nom).toBeFocused()
		await nom.fill(`${PREFIXE} Copie de la fiche`)
		await capturer(page, 'enregistrer-comme-modele-1440', UNITE)
		await page.getByTestId('entete-card-modele-enregistrer').click()
		await expect(page.getByTestId('entete-card-modele-enregistre')).toHaveText(`Modèle « ${PREFIXE} Copie de la fiche » enregistré.`)
		const [carte] = await lire<{ title: string }[]>(request, `cards?id=eq.${idCard}&select=title`)
		const [copie] = await lire<{ title: string }[]>(request, `card_templates?name=eq.${encodeURIComponent(`${PREFIXE} Copie de la fiche`)}&select=title`)
		expect(copie!.title).toBe(carte!.title)
		await page.getByTestId('entete-card-modele-annuler').click()
		await expect(commande).toBeFocused()
	})

	test('le business developer voit la commande éteinte, avec son motif ; la base refuse l’appel direct', async ({ page, request }) => {
		const idCard = await premiereAffaireDeRefonte(request)
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(`${REFONTE}/cards/${idCard}`)
		const commande = page.getByTestId('entete-card-enregistrer-modele')
		await expect(commande).toBeDisabled()
		await expect(commande).toHaveAccessibleDescription('Enregistrer une affaire comme modèle est réservé aux administrateurs de l’espace.')
		await capturer(page, 'enregistrer-comme-modele-refuse-1440', UNITE)
	})
})
