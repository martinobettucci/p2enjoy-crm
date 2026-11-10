// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images du chapitre 12, « L'inbox : lire, trier et répondre »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 12 ; docs/SPEC-mail-subsystem.md §19 (l'envoi, les
//       pièces jointes), §20 (l'inbox, le classement, la suggestion, le sommeil des fils)
// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : les images de l'aperçu d'une pièce jointe (docs/DESIGN_SYSTEM.md §5.80,
//       docs/SPEC-pieces-jointes.md §5, docs/SPEC-seed.md §35)
// @spec CRM-128 (docs/BACKLOG.md) — tranches T4 et T5 : les images de la section 12.4 — l'entrée et la liste, la relecture
//       d'un mail préparé, l'encadré de la fiche — sur les mails du seed (docs/DESIGN_SYSTEM.md §5.90 ;
//       docs/SPEC-mails-prepares.md §6 ; docs/SPEC-seed.md §37)
// @spec CRM-139 (docs/BACKLOG.md) — l'image « seulement-moi » de la section 12.2 : la case cochée et les dossiers qu'elle
//       compte (docs/DESIGN_SYSTEM.md §5.96 ; docs/SPEC-mail-subsystem.md §27.4)
// @spec CRM-137 (docs/BACKLOG.md) — l'image « classer-expediteur-connu » de la section 12.1 : le sélecteur cherchable et
//       la case « Expéditeur connu » (docs/DESIGN_SYSTEM.md §5.94 ; docs/SPEC-mail-subsystem.md §26.3)
// @spec CRM-143 (docs/BACKLOG.md) — tranche T4 : l'image « piece-non-analysee » de la section 12.1 — « Télécharger quand
//       même » et son avertissement (docs/DESIGN_SYSTEM.md §5.95 ; docs/SPEC-pieces-jointes.md §17.4)
//
// Les messages sont ceux du seed : « Candidature spontanée » (non classé), « Demande de devis — refonte » et sa réponse
// (classés dans « Refonte du site vitrine »), « Point d'avancement — migration ERP » (suggéré). Rien n'est classé, retiré,
// endormi ni envoyé : chaque geste est montré puis annulé. Les fichiers joints au formulaire, déposés dans le stockage
// dès leur choix, sont retirés à la fin comme `e2e/ui/envoi-pieces-jointes.spec.ts` le fait.
// @verifies CRM-139 (docs/BACKLOG.md) — l'inbox s'ouvre ici case « Seulement moi » décochée, `courrier=tous` : le sujet de ces
//           preuves est ailleurs (docs/SPEC-mail-subsystem.md §27.5)

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, WORKSPACE_SEED, connecterAvecLeLabs, lireService, retenir, service } from './outils'
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
	await page.goto('/inbox?courrier=tous')
	await dossiers(page).getByRole('button', { name: dossier }).click()
	await liste(page).getByTestId('inbox-message').filter({ hasText: objet }).first().click()
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText(objet)
}

test('l’inbox : les dossiers, un fil, le classement', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox?courrier=tous')
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

// `CRM-143` T4 (docs/DESIGN_SYSTEM.md §5.95) : une pièce non analysée. Le seed n'en porte pas — elle naît sans antivirus, et
// la reprise la rendrait saine dans le quart d'heure (docs/SPEC-pieces-jointes.md §17.8) : l'image la pose sur un message du
// seed, son objet réellement déposé par la clé de service, puis la retire. L'avertissement est ouvert puis annulé : aucune
// confirmation n'est enregistrée.
test('une pièce non analysée : « Télécharger quand même » et son avertissement', async ({ page, request }) => {
	test.setTimeout(90_000)
	const [message] = await lireService<{ id: string; card_id: string | null }[]>(
		request,
		`mail_messages?select=id,card_id&rfc822_message_id=eq.${encodeURIComponent('<seed-inbox-classe@p2enjoy.test>')}`,
	)
	expect(message, 'le seed porte « Demande de devis — refonte »').toBeDefined()
	const empreinte = 'a'.repeat(64)
	const chemin = `${WORKSPACE_SEED}/${message!.id}/${empreinte}`
	const depot = await request.post(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
		data: Buffer.from('%PDF-1.4 releve\n%%EOF\n'),
	})
	expect([200, 201], await depot.text()).toContain(depot.status())
	try {
		await service(request, 'post', 'mail_attachments', {
			message_id: message!.id,
			card_id: message!.card_id,
			filename: 'releve-de-compte.pdf',
			mime_type: 'application/pdf',
			size_bytes: 28,
			storage_path: chemin,
			sha256: empreinte,
			av_status: 'skipped',
		})
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/inbox?message=${message!.id}`)
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Demande de devis — refonte')
		const ligne = page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe').filter({ hasText: 'releve-de-compte.pdf' })
		await ligne.getByTestId('telecharger-quand-meme').click()
		const avertissement = ligne.getByTestId('avertissement-piece')
		await expect(avertissement).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'piece-non-analysee', cibles: [ligne, avertissement] })
		await ligne.getByTestId('annuler-risque').click()
	} finally {
		await request.delete(`${URL_API}/rest/v1/mail_attachments?storage_path=eq.${encodeURIComponent(chemin)}`, {
			headers: enTetesService(),
		})
		await request.delete(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, { headers: enTetesService() })
	}
})

// `CRM-143` T6 (docs/SPEC-seed.md §40) : les deux pièces du seed qui n'ont aucun bouton, l'infectée et la trop volumineuse.
test('deux pièces sans bouton : l’infectée et la trop volumineuse', async ({ page, request }) => {
	const [message] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-pieces-statuts@p2enjoy.test>')}`,
	)
	expect(message, 'le seed porte « Pièces à vérifier — monitoring Vertuo » (docs/SPEC-seed.md §40)').toBeDefined()
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?message=${message!.id}`)
	const ouvert = page.getByTestId('inbox-message-ouvert')
	await expect(ouvert).toContainText('Pièces à vérifier — monitoring Vertuo')
	const pieces = ouvert.getByTestId('pieces-jointes')
	await expect(pieces).toContainText('non analysée : trop volumineuse, non conservée')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'pieces-sans-bouton', cibles: [pieces] })
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

// `CRM-139` : la case « Seulement moi », cochée à l'ouverture, sans `courrier=tous` : seul le dossier de l'affaire où
// Camille a écrit est compté (docs/SPEC-mail-subsystem.md §27.5).
test('seulement moi : la case cochée, et le seul courrier qui vous concerne', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox')
	const caseMoi = page.getByTestId('inbox-seulement-moi')
	await expect(caseMoi).toBeEnabled()
	await expect(caseMoi).toBeChecked()
	await expect(dossiers(page).getByRole('button', { name: /Refonte du monitoring/ })).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'seulement-moi',
		cibles: [caseMoi, dossiers(page).getByRole('button', { name: /Refonte du monitoring/ })],
	})
	// Le vide de « Non classés » sous la case, et son action.
	await dossiers(page).getByRole('button', { name: /Non classés/ }).click()
	const vide = liste(page).getByTestId('etat-vide')
	await expect(vide).toContainText('Aucun message de ce dossier ne vous concerne')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'seulement-moi-vide', cibles: [vide] })
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

	// `CRM-137` : le formulaire de classement, la case « Expéditeur connu » cochée, l'unique affaire de Léo déjà choisie
	// (docs/SPEC-mail-subsystem.md §26.3). Le formulaire est refermé par « Annuler » : rien n'est classé.
	await page.getByTestId('inbox-classer').click()
	const choix = page.getByTestId('classement-choix')
	await expect(choix).toContainText('Affaire choisie')
	// Le panneau du message défile en lui-même : le haut du sélecteur, la case comprise, est amené en tête de la vue, sans
	// quoi l'image couperait la case qu'elle doit montrer.
	await page.getByTestId('classement-selecteur').evaluate((noeud) => noeud.scrollIntoView({ block: 'center' }))
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'classer-expediteur-connu',
		cibles: [page.getByTestId('classement-selecteur'), page.getByTestId('inbox-classer-valider')],
	})
	await page.getByRole('button', { name: 'Annuler' }).click()
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
	await page.goto('/inbox?courrier=tous')
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
