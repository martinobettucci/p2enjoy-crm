// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2b : les images du chapitre 9, « L'affaire » — les vues sauvegardées,
//       l'export et l'import de la liste, les étiquettes, le fil
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 9 (sections 9.11, 9.12, 9.14, 9.16) ;
//       docs/SPEC-vues-import-export.md (CRM-071 : les vues, l'export, l'import), docs/SPEC-etiquettes-digest.md (CRM-069 : les étiquettes)
//
// Ce qui se LIT vient du seed : les vues « Mes négociations » et « Secteur public, par échéance » de « Refonte de site »,
// les étiquettes de l'espace dont « Salon 2025 », archivée, et le « Dossier changé » de « Support niveau 2 — Atelier
// Meunier ». Rien n'écrit dans le seed : une vue est ouverte puis abandonnée, jamais enregistrée ; le panneau d'import est
// refermé avant toute vérification ; la fiche d'étiquette est annulée. Ce qui écrit un fil — une étiquette posée, un
// workflow changé — porte sur une affaire jetable, retirée avec son fil.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import {
	ADMIN,
	CHANNEL_GRANDS_COMPTES,
	ETAPE_SIGNATURE,
	WORKFLOW_GLOBAL,
	WORKSPACE_SEED,
	connecterAvecLeLabs,
	detruireAffaire,
	lireService,
	poserAffaire,
	retablirLeSeed,
	service,
} from './outils'

const CHAPITRE = 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre'
const S = {
	liste: 'la-vue-liste-d-un-channel',
	fil: 'l-historique-et-la-discussion-d-une-affaire',
	ranger: 'ranger-une-affaire-dans-un-autre-dossier',
	etiquettes: 'les-etiquettes-d-une-affaire',
	fiche: 'la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent',
} as const

const LISTE_REFONTE = '/tracks/studio-web/refonte/liste'
const GRANDS_COMPTES = '/tracks/conseil-ia/grands-comptes'
const SUPPORT_MEUNIER = '/tracks/studio-web/maintenance/cards/5eed0000-0000-4000-8000-0000000000c5'
const JETABLE = { id: 'e1170000-0000-4000-8000-0000000009c2', titre: 'Audit de sécurité Pelletier' } as const
const WORKFLOW_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6801'
const ETAPE_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6811'
/** Un channel jetable du track « Studio web », que l'administratrice fait passer au workflow « Checklists ». */
const CHANNEL_JETABLE = { id: 'e1170000-0000-4000-8000-0000000009c4', slug: 'missions-courtes' } as const
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'
/** La première étape du workflow global, la seule où « Budget estimé » est caché. */
const ETAPE_PREMIERE = '5eed0000-0000-4000-8000-000000000061'
/** « Budget estimé », un champ de « Signature » que la première étape ne montre pas. */
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'

test.afterEach(async ({ request }) => {
	await retablirLeSeed(request, [JETABLE.titre])
	await service(request, 'delete', `channels?id=eq.${CHANNEL_JETABLE.id}`)
})

test('les vues sauvegardées, l’export et l’import de la liste', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(LISTE_REFONTE)
	const selecteur = page.getByTestId('selecteur-vue')
	await expect(selecteur).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'selecteur-de-vue', cibles: [selecteur, page.getByTestId('vue-enregistrer')] })

	await selecteur.selectOption({ label: 'Secteur public, par échéance' })
	await expect(page).toHaveURL(/vue=/)
	const commandes = page.getByTestId('commandes-vues')
	await expect(page.getByTestId('vue-supprimer')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'vue-choisie', cibles: [commandes] })

	// Un filtre change après le choix : la vue reste nommée, l'écart est dit. La vue n'est PAS mise à jour.
	await page.getByTestId('filtre-recherche').fill('portail')
	await page.getByTestId('valider-recherche').click()
	await expect(page.getByTestId('vue-ecart')).toContainText('Filtres modifiés depuis la vue')
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'filtres-modifies', cibles: [commandes, page.getByTestId('vue-ecart')] })

	// Le panneau d'enregistrement, ouvert puis abandonné : rien n'est écrit.
	await page.getByTestId('vue-enregistrer').click()
	const panneauVue = page.getByTestId('panneau-vue')
	await expect(panneauVue).toBeVisible()
	await panneauVue.getByTestId('champ-nom-vue').fill('Portails publics')
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'enregistrer-la-vue', cibles: [panneauVue] })
	await panneauVue.getByRole('button', { name: 'Annuler' }).click()

	await page.goto(LISTE_REFONTE)
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'exporter-importer', cibles: [page.getByTestId('exporter-affaires'), page.getByTestId('importer-affaires')] })
	await page.getByTestId('importer-affaires').click()
	const panneauImport = page.getByTestId('panneau-import')
	await expect(panneauImport).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'importer-des-affaires', cibles: [panneauImport] })
	await panneauImport.getByRole('button', { name: 'Annuler' }).click()
})

test('une affaire importée : la première ligne de son fil', async ({ page, request }) => {
	await retablirLeSeed(request, [JETABLE.titre])
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(LISTE_REFONTE)
	// Le vrai import, par le panneau : un fichier d'une ligne, sans étape — l'affaire entre à l'étape initiale.
	await page.getByTestId('importer-affaires').click()
	const panneau = page.getByTestId('panneau-import')
	await panneau.getByLabel('Fichier CSV').setInputFiles({ name: 'affaires.csv', mimeType: 'text/csv', buffer: Buffer.from(`Affaire\n${JETABLE.titre}\n`, 'utf8') })
	await panneau.getByTestId('import-verifier').click()
	await expect(panneau.getByTestId('import-comptes')).toBeVisible()
	await panneau.getByTestId('import-confirmer').click()
	await expect(panneau.getByTestId('import-rapport')).toBeVisible()
	await panneau.getByTestId('import-terminer').click()

	const [importee] = await lireService<{ id: string }[]>(request, `cards?title=eq.${encodeURIComponent(JETABLE.titre)}&select=id`)
	if (importee === undefined) throw new Error('l’affaire importée est introuvable')
	await page.goto(`/tracks/studio-web/refonte/cards/${importee.id}`)
	const creee = page.getByText('Affaire créée par import', { exact: true }).first()
	await expect(creee).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'affaire-creee-par-import', cibles: [creee.locator('xpath=ancestor::li[1]')] })
})

test('les étiquettes : la fiche, le filtre, les réglages', async ({ page, request }) => {
	await detruireAffaire(request, JETABLE.id)
	await poserAffaire(request, { ...JETABLE, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`${GRANDS_COMPTES}/cards/${JETABLE.id}`)
		await page.getByTestId('entete-card-etiquettes').click()
		const panneau = page.getByTestId('entete-card-panneau-etiquettes')
		await expect(panneau).toBeVisible()
		const prioritaire = panneau.getByRole('checkbox', { name: /Prioritaire/ })
		// La case ne se coche qu'une fois la pose enregistrée : le clic, puis l'attente de l'état.
		await prioritaire.click()
		await expect(prioritaire).toBeChecked()
		await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'poser-une-etiquette', cibles: [panneau] })
		await page.getByTestId('entete-card-etiquettes-fermer').click()
	} finally {
		await detruireAffaire(request, JETABLE.id)
	}

	// « Refonte de site » porte une affaire « Prioritaire » : le filtre posé y garde une liste.
	await page.goto(LISTE_REFONTE)
	const filtre = page.getByTestId('filtre-etiquette')
	await expect(filtre).toBeVisible()
	// Le champ avec son libellé « Étiquette ».
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'filtre-etiquette', cibles: [filtre.locator('xpath=..')] })
	await filtre.selectOption({ label: 'Prioritaire' })
	const effacer = page.getByRole('button', { name: 'Effacer les filtres' })
	await expect(effacer).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'filtre-pose', cibles: [filtre, effacer] })

	// L'entrée des réglages, après « Modèles d'affaires », puis la page qu'elle ouvre.
	await page.goto('/reglages')
	await expect(page.getByTestId('entree-etiquettes')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'entree-etiquettes', cibles: [page.getByTestId('entree-modeles-affaires'), page.getByTestId('entree-etiquettes')] })
	await page.getByTestId('entree-etiquettes').click()
	const reglages = page.getByTestId('reglages-etiquettes')
	await expect(page.getByTestId('ligne-etiquette').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'reglages-etiquettes', cibles: [reglages] })
	await page.getByTestId('etiquettes-archivees').check()
	const archivee = page.getByTestId('ligne-etiquette').filter({ hasText: 'Salon 2025' })
	await expect(archivee.getByRole('button', { name: /Désarchiver/ })).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'etiquette-archivee', cibles: [page.getByTestId('etiquettes-archivees').locator('xpath=ancestor::label[1]'), archivee] })

	// La fiche d'une nouvelle étiquette, annulée : rien n'est créé.
	await page.getByTestId('nouvelle-etiquette').click()
	const fiche = page.getByTestId('fiche-etiquette')
	await expect(fiche).toBeVisible()
	await fiche.getByTestId('etiquette-nom').fill('Grand compte')
	await illustrer(page, { chapitre: CHAPITRE, section: S.etiquettes, nom: 'nouvelle-etiquette', cibles: [fiche] })
	await fiche.getByTestId('etiquette-annuler').click()
})

test('le fil : un dossier changé, un workflow modifié, des filtres qui ne laissent rien', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(SUPPORT_MEUNIER)
	const dossier = page.getByText('Dossier changé', { exact: true }).first()
	await expect(dossier).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'dossier-change', cibles: [dossier.locator('xpath=ancestor::li[1]')] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.ranger, nom: 'dossier-change-dans-le-fil', cibles: [dossier.locator('xpath=ancestor::li[1]')] })

	await detruireAffaire(request, JETABLE.id)
	await service(request, 'delete', `channels?id=eq.${CHANNEL_JETABLE.id}`)
	await service(request, 'post', 'channels', [
		{ id: CHANNEL_JETABLE.id, workspace_id: WORKSPACE_SEED, track_id: TRACK_STUDIO, workflow_id: WORKFLOW_GLOBAL, name: 'Missions courtes', slug: CHANNEL_JETABLE.slug, position: 90 },
	])
	await poserAffaire(request, { ...JETABLE, channel: CHANNEL_JETABLE.id, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	try {
		// « Workflow modifié » naît d'un channel qui change de workflow, l'affaire y restant : l'administratrice le fait par
		// la fonction de l'écran d'administration, avec ses droits, l'étape « Signature » remappée vers « Checklists ».
		const reponse = await request.post(`${URL_API}/rest/v1/rpc/change_channel_workflow`, {
			headers: { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' },
			data: {
				channel_id: CHANNEL_JETABLE.id,
				workflow_id: WORKFLOW_CHECKLISTS,
				step_mapping: [{ from_step_id: ETAPE_SIGNATURE, to_step_id: ETAPE_CHECKLISTS }],
				discard_field_values: false,
			},
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		await page.goto(`/tracks/studio-web/${CHANNEL_JETABLE.slug}/cards/${JETABLE.id}`)
		const workflow = page.getByText('Workflow modifié', { exact: true }).first()
		await expect(workflow).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'workflow-modifie', cibles: [workflow.locator('xpath=ancestor::li[1]')] })

		// Toutes les familles désactivées : le fil le dit.
		const filtres = page.getByRole('group', { name: 'Filtres du fil' })
		for (const bouton of await filtres.getByRole('button').all()) await bouton.click()
		const rien = page.getByText('Aucun élément pour ces filtres', { exact: true }).first()
		await expect(rien).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'aucun-element-filtres', cibles: [filtres, rien] })
	} finally {
		await detruireAffaire(request, JETABLE.id)
		await service(request, 'delete', `channels?id=eq.${CHANNEL_JETABLE.id}`)
	}
})

test('les informations d’autres étapes', async ({ page, request }) => {
	await detruireAffaire(request, JETABLE.id)
	await poserAffaire(request, { ...JETABLE, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	try {
		// Une réponse donnée à « Signature », puis l'affaire ramenée à la première étape : la réponse reste, repliée.
		const [rattachement] = await lireService<{ id: string }[]>(request, `card_placements?card_id=eq.${JETABLE.id}&select=id`)
		if (rattachement === undefined) throw new Error('le rattachement de l’affaire jetable est absent')
		await service(request, 'post', 'card_field_values', [
			{ card_id: JETABLE.id, field_id: CHAMP_BUDGET, workflow_id: WORKFLOW_GLOBAL, workspace_id: WORKSPACE_SEED, placement_id: rattachement.id, value: 48000 },
		])
		await service(request, 'patch', `card_placements?card_id=eq.${JETABLE.id}`, { current_step_id: ETAPE_PREMIERE })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`${GRANDS_COMPTES}/cards/${JETABLE.id}`)
		const autres = page.getByTestId('autres-etapes')
		await expect(autres).toBeVisible()
		await autres.locator('summary').click()
		await expect(autres.getByTestId('autre-budget_estime').or(autres.getByText('Budget estimé')).first()).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'informations-d-autres-etapes', cibles: [autres] })
	} finally {
		await detruireAffaire(request, JETABLE.id)
	}
})

test('une liste de référence qui ne se lit pas', async ({ page, request }) => {
	test.setTimeout(60_000)
	await detruireAffaire(request, JETABLE.id)
	await poserAffaire(request, { ...JETABLE, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	try {
		await connecterAvecLeLabs(page, ADMIN)
		// La lecture des contacts, qui remplit « Contact principal », est coupée — une vraie panne réseau, comme au chapitre 7.
		await page.route('**/rest/v1/contacts?*', (route) => route.abort('connectionrefused'))
		await page.goto(`${GRANDS_COMPTES}/cards/${JETABLE.id}`)
		const erreur = page.locator('[data-testid^="selecteur-erreur-"]').first()
		// Le client relit avant de conclure à l'échec, comme au chapitre 7.
		await expect(erreur).toBeVisible({ timeout: 30_000 })
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'liste-illisible', cibles: [erreur.locator('xpath=..'), erreur] })
	} finally {
		await page.unroute('**/rest/v1/contacts?*')
		await detruireAffaire(request, JETABLE.id)
	}
})
