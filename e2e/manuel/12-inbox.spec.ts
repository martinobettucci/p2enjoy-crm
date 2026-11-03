// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images du chapitre 12, « L'inbox : lire, trier et répondre »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 12 ; docs/SPEC-mail-subsystem.md §19 (l'envoi, les
//       pièces jointes), §20 (l'inbox, le classement, la suggestion, le sommeil des fils)
// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : les images de l'aperçu d'une pièce jointe (docs/DESIGN_SYSTEM.md §5.80,
//       docs/SPEC-pieces-jointes.md §5, docs/SPEC-seed.md §35)
// @spec CRM-128 (docs/BACKLOG.md) — tranches T4 et T5 : les images de la section 12.4 — l'entrée et la liste, la relecture
//       d'un mail préparé, l'encadré de la fiche — sur les mails du seed (docs/DESIGN_SYSTEM.md §5.90 ;
//       docs/SPEC-mails-prepares.md §6 ; docs/SPEC-seed.md §37)
//
// Les messages sont ceux du seed : « Candidature spontanée » (non classé), « Demande de devis — refonte » et sa réponse
// (classés dans « Refonte du site vitrine »), « Point d'avancement — migration ERP » (suggéré). Rien n'est classé, retiré,
// endormi ni envoyé : chaque geste est montré puis annulé. Les fichiers joints au formulaire, déposés dans le stockage
// dès leur choix, sont retirés à la fin comme `e2e/ui/envoi-pieces-jointes.spec.ts` le fait.

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, connecterAvecLeLabs, lireService, retenir } from './outils'
import { URL_API, enTetesService } from '../api/jetons'

// LE CHROMIUM COMPLET, et non le « headless shell » : seul le premier porte le lecteur PDF du navigateur, que l'image de
// l'aperçu d'un PDF montre (`CRM-074` T3). Le choix vaut pour le fichier entier : Playwright ne le permet pas par groupe.
test.use({ channel: 'chromium' })

const CHAPITRE = 'l-inbox-lire-trier-et-repondre'
const LIRE = 'l-inbox-lire-et-trier-le-courrier-recu'
const ECRIRE = 'ecrire-et-repondre'

const dossiers = (page: Page) => page.getByTestId('inbox-panneau-dossiers')
const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')

async function ouvrir(page: Page, dossier: RegExp, objet: string): Promise<void> {
	await page.goto('/inbox')
	await dossiers(page).getByRole('button', { name: dossier }).click()
	await liste(page).getByTestId('inbox-message').filter({ hasText: objet }).first().click()
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText(objet)
}

test('l’inbox : les dossiers, un fil, le classement', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox')
	await expect(dossiers(page)).toBeVisible()
	// L'image d'ouverture montre un dossier déplié et un message lu : les trois panneaux remplis.
	await dossiers(page).getByRole('button', { name: /Non classés/ }).click()
	await liste(page).getByTestId('inbox-message').first().click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'inbox', cibles: [], pleinePage: true })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'dossiers',
		cibles: [page.getByRole('link', { name: 'Inbox', exact: true }), dossiers(page).getByRole('button', { name: /Non classés/ })],
	})

	await ouvrir(page, /Refonte du site vitrine/, 'Demande de devis — refonte')
	const ouvert = page.getByTestId('inbox-message-ouvert')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'messages-de-ce-fil', cibles: [ouvert.getByRole('region', { name: 'Choisir un message du fil' })] })
	await illustrer(page, { chapitre: CHAPITRE, section: ECRIRE, nom: 'repondre', cibles: [page.getByTestId('envoi-ouvrir')] })

	// Le sommeil d'un fil : le bouton, puis le panneau qui le remplace, montré puis refermé.
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'mettre-le-fil-en-sommeil', cibles: [page.getByTestId('fil-endormir')] })
	await page.getByTestId('fil-endormir').click()
	const panneau = page.getByTestId('fil-panneau')
	await expect(panneau).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'jusqu-a-quand', cibles: [panneau] })
	await panneau.getByRole('button', { name: 'Annuler', exact: true }).click()
	await expect(panneau).toBeHidden()

	// Retirer de l'affaire : le bouton, puis la confirmation qui le remplace, refermée par « Annuler ».
	const retirer = page.getByRole('button', { name: 'Retirer de l’affaire' })
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'retirer-de-l-affaire', cibles: [retirer] })
	await retirer.click()
	const confirmation = page.getByTestId('inbox-retrait-confirmation')
	await expect(confirmation).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'confirmer-le-retrait', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click()
	await expect(confirmation).toBeHidden()

	// Le même message, dans le fil de l'affaire.
	await page.getByTestId('inbox-pilule-card').click()
	// Le fil écrit le genre et l'objet sur une même ligne : « Message reçu·<objet> ».
	const recu = page.getByRole('listitem').filter({ hasText: /^\s*Message reçu/ }).first()
	await expect(recu).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'message-recu', cibles: [recu] })
	await page.goto('/tracks/conseil-ia/grands-comptes')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'afficher-les-affaires-en-sommeil', cibles: [page.getByTestId('barre-sommeil-board')] })

	// Une pièce déclarée saine : la seule du seed, jointe au message envoyé sur « Refonte du monitoring ».
	await ouvrir(page, /Refonte du monitoring/, 'Proposition de refonte du monitoring')
	const piece = page.getByTestId('inbox-message-ouvert').getByText('proposition-monitoring.txt').first()
	const telecharger = page.getByTestId('inbox-message-ouvert').getByRole('button', { name: /Télécharger/ }).first()
	await expect(telecharger).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'telecharger', cibles: [piece, telecharger] })
})

// `CRM-074` T3 (docs/DESIGN_SYSTEM.md §5.80) : l'aperçu des pièces du courrier « Dossier de consultation — monitoring Vertuo »
// (docs/SPEC-seed.md §35).
test.describe('l’aperçu d’une pièce jointe', () => {
	test('le PDF et son texte, un document Word, un scan, et les pièces dans l’historique', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrir(page, /Refonte du monitoring/, 'Dossier de consultation — monitoring Vertuo')
		const piece = (nom: string) => page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe').filter({ hasText: nom })

		const devis = piece('devis-refonte-vertuo.pdf')
		await devis.getByRole('button', { name: /Aperçu de/ }).click()
		await expect(devis.getByTestId('texte-contenu')).toContainText('Devis n° 2026-118')
		await devis.getByTestId('apercu-pdf').scrollIntoViewIfNeeded()
		// Le lecteur PDF peint hors du processus de la page, sans événement observable : l'attente ne sert qu'à l'image.
		await page.waitForTimeout(2_000)
		await page.setViewportSize({ width: 1440, height: 1600 })
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'apercu-pdf', cibles: [devis] })

		const cahier = piece('cahier-des-charges.docx')
		await cahier.getByRole('button', { name: /Aperçu de/ }).click()
		await expect(cahier.getByTestId('texte-contenu')).toContainText('Cahier des charges')
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'apercu-texte-extrait', cibles: [cahier] })

		const scan = piece('plan-signe-scanne.pdf')
		await scan.getByRole('button', { name: /Aperçu de/ }).click()
		await expect(scan.getByTestId('texte-etat')).toContainText('Aucun texte lisible')
		await scan.getByTestId('texte-extrait').scrollIntoViewIfNeeded()
		// La pièce entière, et non la seule phrase : l'image doit dire de quel fichier elle parle.
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'aucun-texte-lisible', cibles: [scan] })

		await page.getByTestId('inbox-pilule-card').click()
		const ligne = page.getByRole('listitem').filter({ hasText: /^\s*Message reçu.*Dossier de consultation/ }).first()
		const budget = ligne.getByTestId('inbox-piece-jointe').filter({ hasText: 'budget-previsionnel.xlsx' })
		await budget.getByRole('button', { name: /Aperçu de/ }).click()
		await expect(budget.getByTestId('texte-contenu')).toContainText('Tableaux de bord')
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'pieces-dans-l-historique', cibles: [ligne] })
	})
})

test('un message non classé, et une suggestion', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrir(page, /Non classés/, 'Point d’avancement — migration ERP')
	const suggestion = page.getByText('Suggestion de classement').first().locator('xpath=ancestor::*[self::section or self::div][1]')
	await expect(suggestion).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'suggestion-de-classement',
		cibles: [suggestion, page.getByTestId('inbox-classer')],
	})
})

test('écrire depuis une affaire : la copie cachée, les pièces jointes', async ({ page, request }) => {
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(AFFAIRE_SOGEXIA)
		await illustrer(page, { chapitre: CHAPITRE, section: ECRIRE, nom: 'ecrire-un-message', cibles: [page.getByTestId('envoi-ouvrir')] })
		await page.getByTestId('envoi-ouvrir').click()
		const formulaire = page.getByTestId('envoi-formulaire')
		await page.getByLabel('Destinataires').fill('dsi@sogexia.example')
		await page.getByLabel('Objet').fill('Proposition pour le lot 2')
		await page.getByLabel('Message').fill('Bonjour,\n\nVous trouverez notre proposition jointe.')
		await page.getByRole('button', { name: 'Ajouter Cci' }).click()
		await page.getByLabel('Copie cachée (Cci)').fill('direction@p2enjoy.test')

		const depot = retenir()
		await page.route('**/storage/v1/object/mail-outbound-attachments/**', async (route) => {
			await depot.attendre
			await route.continue()
		})
		await page.getByTestId('envoi-fichiers').setInputFiles([
			{ name: 'Proposition lot 2.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2_400_000, 0x41) },
			{ name: 'Planning.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1_000_000, 0x42) },
		])
		const envoi = page.getByTestId('envoi-piece').filter({ hasText: 'Envoi du fichier…' }).first()
		await expect(envoi).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: ECRIRE, nom: 'envoi-du-fichier', cibles: [envoi] })
		depot.liberer()
		await expect(page.locator('[data-testid="envoi-piece"][data-etat="pret"]')).toHaveCount(2)
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: ECRIRE,
			nom: 'formulaire-d-envoi',
			cibles: [page.getByText('Copie cachée (Cci)', { exact: true }), page.getByLabel('Copie cachée (Cci)'), page.getByTestId('envoi-pieces-total'), page.getByTestId('envoi-valider')],
		})
		await expect(formulaire).toBeVisible()
	} finally {
		// Les dépôts que le formulaire a laissés, jamais envoyés.
		const restes = await lireService<{ name: string }[]>(request, `rpc/depots_envoi_abandonnes?p_age=${encodeURIComponent('-1 minute')}`)
		const aRetirer = restes.map((ligne) => ligne.name).filter((nom) => /Proposition lot 2|Planning/.test(nom.split('/').at(-1) ?? ''))
		if (aRetirer.length > 0)
			await request.delete(`${URL_API}/storage/v1/object/mail-outbound-attachments`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { prefixes: aRetirer },
			})
	}
})

// `CRM-128` T4 et T5 : les mails préparés du seed (docs/SPEC-seed.md §37), préparés comme le connecteur les prépare ; rien
// n'est mis en file ni écarté — l'image montre la relecture, pas son issue.
test('relire un mail préparé : l’entrée, la liste, la relecture, puis l’encadré de la fiche', async ({ page }) => {
	const SECTION = 'relire-et-envoyer-un-mail-prepare-par-l-assistant'
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox')
	const entree = dossiers(page).getByTestId('inbox-mails-prepares')
	await entree.click()
	const ligne = page.getByTestId('inbox-mail-prepare').filter({ hasText: 'Billetterie : proposition de calendrier' })
	await expect(ligne).toContainText('Préparé par l’assistant')
	await illustrer(page, { chapitre: CHAPITRE, section: SECTION, nom: 'mails-prepares', cibles: [entree, ligne] })
	await ligne.click()
	const relecture = page.getByTestId('inbox-relecture')
	await expect(relecture.getByLabel('Objet')).toHaveValue('Billetterie : proposition de calendrier')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'relire-un-mail-prepare',
		cibles: [relecture.getByRole('note'), page.getByTestId('envoi-valider'), page.getByTestId('mail-prepare-ecarter')],
	})
	await page.goto('/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c1')
	const encadre = page.getByTestId('fiche-mail-prepare').filter({ hasText: 'Re: Demande de devis — refonte' })
	await expect(encadre).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'mail-prepare-sur-la-fiche',
		cibles: [encadre, page.getByTestId('envoi-ouvrir')],
	})
})
