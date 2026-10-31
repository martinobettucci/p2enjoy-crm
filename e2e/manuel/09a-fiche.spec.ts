// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2b : les images du chapitre 9, « L'affaire » — la fiche
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 9 (sections 9.1 à 9.9, 9.15)
// @spec docs/SPEC-cards.md (l'en-tête, le formulaire, la corbeille), docs/SPEC-workflow-engine.md §7 (la garde du
//       déplacement), docs/SPEC-rattachements.md (les contacts de l'affaire), docs/DESIGN_SYSTEM.md §5.63 (les activités),
//       §5.70 (la checklist)
//
// Ce qui se LIT vient du seed : « Migration ERP Sogexia » (contacts, activités, santé), « Contrat cadre 2025 »
// (archivée), « Atelier prompt — Lycée Vauban » (checklist). Ce qui s'ÉCRIT porte sur une affaire posée à « Signature »
// par la clé de service, comme `e2e/ui/parcours-transition.spec.ts`, et détruite à la fin — sauf le point libre de
// Vauban, ajouté puis retiré par l'écran. Les refus « vos droits ont changé » naissent du rôle de Driss Lemoine abaissé
// entre l'ouverture et le geste, puis rendu.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, BIZDEV, WORKSPACE_SEED, connecterAvecLeLabs, detruireAffaire, immobile, lireService, poserAffaire, retablirLeSeed, retenir, service } from './outils'

const CHAPITRE = 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre'
const S = {
	porte: 'ce-qu-une-affaire-porte',
	avancer: 'faire-avancer-une-affaire-ce-que-le-produit-autorise-et-ce-qu-il-refuse',
	fiche: 'la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent',
	contacts: 'les-contacts-d-une-affaire-les-rattacher-les-detacher',
	activites: 'les-activites-d-une-affaire-appels-reunions-visios',
	checklist: 'la-checklist-d-une-affaire-les-points-a-cocher',
	corbeille: 'mettre-une-affaire-a-la-corbeille',
} as const

const GRANDS_COMPTES = '/tracks/conseil-ia/grands-comptes'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const ARCHIVEE = `${GRANDS_COMPTES}/cards/5eed0000-0000-4000-8000-0000000000c8`
const LEO = '5eed0000-0000-4000-8000-000000000091'
const CHECKLISTS = '/tracks/studio-web/checklists'
const ETAPE_NEGOCIATION_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6813'



/** Abaisse Driss Lemoine en lecteur, le temps d'un geste ; le rend toujours. */
async function sansDroits(requete: APIRequestContext, geste: () => Promise<void>): Promise<void> {
	const [driss] = await lireService<{ id: string }[]>(requete, `profiles?full_name=eq.${encodeURIComponent('Driss Lemoine')}&select=id`)
	if (driss === undefined) throw new Error('le profil de Driss Lemoine est absent du seed')
	const membre = `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${driss.id}`
	await service(requete, 'patch', membre, { role: 'viewer' })
	try {
		await geste()
	} finally {
		await service(requete, 'patch', membre, { role: 'business_developer' })
	}
}

/** Une affaire à « Signature », d'où « Démarrer la réalisation » exige « Lien vers la proposition ». */
async function affaireASignature(requete: APIRequestContext, titre: string): Promise<string> {
	const id = randomUUID()
	await poserAffaire(requete, { id, titre, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	return id
}

// Le rôle de Driss et les affaires jetables sont rétablis même quand un test dépasse son délai.
test.afterEach(async ({ request }) => retablirLeSeed(request, ['Refonte de l’intranet Valdor', 'Audit de conformité Brenac']))

const carte = (page: Page, id: string) => page.locator(`[data-testid="carte-card"][data-card="${id}"]`)

test('une affaire du seed : la fiche, la santé, l’adresse', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'])
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(AFFAIRE_SOGEXIA)
	await expect(page.getByTestId('entete-card')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'fiche', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: CHAPITRE, section: S.porte, nom: 'sante', cibles: [page.getByTestId('bloc-sante')] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.porte, nom: 'ma-journee', cibles: [page.getByRole('link', { name: 'Ma journée' })] })
	const copier = page.getByRole('button', { name: "Copier l'adresse email de l'affaire" })
	await copier.click()
	await expect(copier).toContainText('Copié')
	await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'copier-l-adresse', cibles: [page.getByTestId('entete-card-adresse'), copier] })
	const autres = page.getByTestId('autres-etapes')
	if ((await autres.count()) > 0) await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'autres-etapes', cibles: [autres] })

	await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'contacts-de-l-affaire', cibles: [page.getByTestId('bloc-contacts-card')] })
	const activites = page.getByTestId('bloc-activites-card')
	await activites.getByText('Compte rendu', { exact: true }).first().click()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: S.activites,
		nom: 'activites',
		cibles: [page.getByRole('heading', { name: 'Contacts de l’affaire' }), activites],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: S.activites, nom: 'temps', cibles: [page.getByRole('link', { name: 'Temps', exact: true })] })

	await page.goto(ARCHIVEE)
	// Le titre de l'en-tête, et non celui du fil d'Ariane, tronqué.
	await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'archivee', cibles: [page.getByTestId('entete-card').getByRole('heading', { level: 2 }), page.getByTestId('entete-card-archivee')] })

	await page.goto(`${GRANDS_COMPTES}/cards/00000000-0000-4000-8000-000000000000`)
	const introuvable = page.getByText('Card introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'card-introuvable', cibles: [introuvable] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.corbeille, nom: 'card-introuvable-corbeille', cibles: [introuvable] })

	await page.goto(`/contacts/${LEO}`)
	await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'modifier-le-role', cibles: [page.getByTestId('modifier-role-affaire').first()] })
})

test('une affaire neuve : le refus du déplacement, la reprise, l’en-tête, les blocs, la corbeille', async ({ page, request }) => {
	test.setTimeout(180_000)
	const titre = 'Refonte de l’intranet Valdor'
	const id = await affaireASignature(request, titre)
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(GRANDS_COMPTES)
		await carte(page, id).getByRole('button', { name: `Actions ${titre}` }).click()
		await illustrer(page, { chapitre: CHAPITRE, section: S.avancer, nom: 'menu-actions', cibles: [carte(page, id), page.getByTestId('menu-carte')] })
		await carte(page, id).getByRole('button', { name: 'Démarrer la réalisation' }).click()
		const refus = page.getByTestId('refus-deplacement')
		await expect(page.getByTestId('champs-manquants')).toContainText('Lien vers la proposition')
		await illustrer(page, { chapitre: CHAPITRE, section: S.avancer, nom: 'refus-champs-manquants', cibles: [refus] })
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'renseigner-ces-champs', cibles: [refus] })

		await page.getByTestId('reprendre-saisie').click()
		const exige = page.getByTestId('champ-lien-proposition')
		await expect(exige).toHaveAttribute('data-exige', 'true')
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'exige-par-le-deplacement', cibles: [exige] })
		await page.keyboard.type('https://p2enjoy.test/propositions/valdor')
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('etat-lien-proposition')).toContainText('Enregistré')
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'formulaire-de-l-etape', cibles: [page.getByTestId('formulaire-card')] })

		// L'en-tête : sans responsable, puis en saisie.
		const entete = page.getByTestId('entete-card')
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Aucun responsable')
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'entete', cibles: [entete] })
		await page.getByTestId('entete-card-modifier').click()
		const edition = page.getByTestId('entete-card-edition')
		await expect(edition).toBeVisible()
		const ecriture = retenir()
		await page.route('**/rest/v1/card_placements?*', async (route) => {
			if (route.request().method() === 'PATCH') await ecriture.attendre
			await route.continue()
		})
		await edition.getByLabel('Montant').fill('48000')
		await edition.getByLabel('Montant').press('Tab')
		await expect(edition.getByText('Enregistrement…').first()).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'enregistrement', cibles: [edition] })
		ecriture.liberer()
		await expect(edition.getByText('Enregistré', { exact: true }).first()).toBeVisible()
		await page.unroute('**/rest/v1/card_placements?*')
		await edition.getByLabel('Responsable').selectOption({ label: 'Driss Lemoine' })
		await expect(edition.getByText('Enregistré', { exact: true }).first()).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'en-saisie', cibles: [edition, page.getByTestId('entete-card-terminer')] })
		await page.getByTestId('entete-card-terminer').click()
		// Le fil ne relit pas un changement de responsable fait depuis l'en-tête (seules les étiquettes appellent
		// `onEvenement`) : la ligne n'y paraît qu'à la relecture. Défaut signalé au responsable, hors de CRM-117.
		await page.reload()
		const responsableModifie = page.getByText('Responsable modifié', { exact: true }).last()
		await expect(responsableModifie).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'responsable-modifie', cibles: [responsableModifie.locator('xpath=ancestor::li[1]')] })

		// Les contacts : rattacher Léo, puis la confirmation du détachement.
		const contacts = page.getByTestId('bloc-contacts-card')
		await contacts.getByTestId('ouvrir-rattachement').click()
		const formulaire = contacts.getByTestId('formulaire-rattachement')
		await formulaire.getByTestId('champ-contact').selectOption({ label: 'Léo Marchand — Sogexia' })
		await formulaire.getByTestId('champ-role').fill('décideur')
		await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'rattacher-un-contact', cibles: [contacts] })
		await formulaire.getByTestId('confirmer-rattachement').click()
		await expect(contacts.getByTestId('ligne-contact-card')).toHaveCount(1)
		await contacts.getByTestId('detacher-contact').click()
		await expect(contacts.getByTestId('confirmation-detachement')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'detacher', cibles: [contacts] })
		await contacts.getByTestId('confirmer-detachement').click()
		await expect(contacts.getByTestId('ligne-contact-card')).toHaveCount(0)

		// Les activités : consigner, puis retirer la sienne.
		const activites = page.getByTestId('bloc-activites-card')
		await activites.getByTestId('consigner-activite').click()
		await activites.getByTestId('champ-sujet-activite').fill('Appel de découverte avec la DSI')
		// Le formulaire dépasse 900 px : il se montre dans une fenêtre plus haute, comme la checklist.
		await page.setViewportSize({ width: 1440, height: 1300 })
		await illustrer(page, { chapitre: CHAPITRE, section: S.activites, nom: 'consigner-une-activite', cibles: [activites.getByTestId('formulaire-activite')] })
		await page.setViewportSize({ width: 1440, height: 900 })
		await activites.getByTestId('envoyer-activite').click()
		await expect(activites.getByTestId('ligne-activite')).toHaveCount(1)
		await activites.getByTestId('actions-activite').first().click()
		await page.getByRole('menuitem', { name: /Retirer/ }).or(page.getByRole('button', { name: /^Retirer/ })).first().click()
		await activites.getByTestId('confirmer-retrait-activite').click()
		await expect(activites.getByTestId('activite-retiree').first()).toHaveText('Activité retirée')
		await illustrer(page, { chapitre: CHAPITRE, section: S.activites, nom: 'activite-retiree', cibles: [activites.getByTestId('ligne-activite').first()] })

		// La checklist d'une affaire dont l'étape n'en porte pas.
		const checklist = page.getByTestId('bloc-checklist-card')
		if ((await checklist.getByTestId('checklist-vide').count()) > 0)
			await illustrer(page, { chapitre: CHAPITRE, section: S.checklist, nom: 'aucun-point', cibles: [checklist] })

		// La corbeille.
		await page.getByTestId('geste-corbeille-card').getByRole('button', { name: 'Mettre à la corbeille' }).click()
		const confirmation = page.getByTestId('confirmation-corbeille-card')
		await expect(confirmation).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.corbeille, nom: 'confirmation', cibles: [confirmation] })
		await page.getByTestId('confirmer-corbeille-card').click()
		const retiree = page.getByTestId('affaire-retiree')
		await expect(retiree).toContainText('Affaire mise à la corbeille')
		await illustrer(page, { chapitre: CHAPITRE, section: S.corbeille, nom: 'mise-a-la-corbeille', cibles: [retiree] })
	} finally {
		await detruireAffaire(request, id)
	}
})

test('les refus, quand les droits ont changé', async ({ page, request }) => {
	test.setTimeout(120_000)
	const titre = 'Audit de conformité Brenac'
	const id = await affaireASignature(request, titre)
	await service(request, 'post', 'card_contacts', [{ workspace_id: WORKSPACE_SEED, card_id: id, contact_id: LEO, role: 'décideur' }])
	try {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(`${GRANDS_COMPTES}/cards/${id}`)
		await expect(page.getByTestId('entete-card')).toBeVisible()

		await page.getByTestId('entete-card-modifier').click()
		const edition = page.getByTestId('entete-card-edition')
		await sansDroits(request, async () => {
			await edition.getByLabel('Montant').fill('12000')
			await edition.getByLabel('Montant').press('Tab')
			await expect(edition).toContainText("Rien n'a été enregistré : votre compte ne peut pas modifier cette affaire")
			await illustrer(page, { chapitre: CHAPITRE, section: S.fiche, nom: 'rien-n-a-ete-enregistre', cibles: [edition] })
		})
		await page.getByTestId('entete-card-terminer').click()

		const contacts = page.getByTestId('bloc-contacts-card')
		await sansDroits(request, async () => {
			await contacts.getByTestId('detacher-contact').click()
			await contacts.getByTestId('confirmer-detachement').click()
			await expect(contacts.getByTestId('refus-detachement')).toContainText('Aucun rattachement n’a été retiré.')
			await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'detachement-sans-effet', cibles: [contacts] })
		})
		await page.reload()
		// Le formulaire s'ouvre avec les droits ; ils changent entre l'ouverture et l'envoi.
		await contacts.getByTestId('ouvrir-rattachement').click()
		const formulaire = contacts.getByTestId('formulaire-rattachement')
		await formulaire.getByTestId('champ-contact').selectOption({ index: 1 })
		await sansDroits(request, async () => {
			await formulaire.getByTestId('confirmer-rattachement').click()
			await expect(contacts.getByTestId('refus-rattachement')).toContainText('Vous ne pouvez pas modifier cette affaire.')
			await illustrer(page, { chapitre: CHAPITRE, section: S.contacts, nom: 'rattachement-refuse', cibles: [contacts] })
		})
		await page.reload()
		await page.getByTestId('geste-corbeille-card').getByRole('button', { name: 'Mettre à la corbeille' }).click()
		await sansDroits(request, async () => {
			await page.getByTestId('confirmer-corbeille-card').click()
			const refus = page.getByTestId('refus-corbeille-card')
			await expect(refus).toContainText('Aucune modification')
			await immobile(page, 'geste-corbeille-card')
			await illustrer(page, { chapitre: CHAPITRE, section: S.corbeille, nom: 'corbeille-refusee', cibles: [page.getByTestId('geste-corbeille-card').getByRole('heading', { level: 2 }), refus, page.getByTestId('confirmer-corbeille-card')] })
		})
	} finally {
		await detruireAffaire(request, id)
	}
})

test('la checklist d’une affaire, son fil et le refus du board', async ({ page, request }) => {
	const [vauban] = await lireService<{ card_id: string }[]>(
		request,
		`card_placements?select=card_id,affaire:cards!inner(title)&affaire.title=eq.${encodeURIComponent('Atelier prompt — Lycée Vauban')}`,
	)
	if (vauban === undefined) throw new Error('l’affaire « Atelier prompt — Lycée Vauban » est absente du seed')
	await page.setViewportSize({ width: 1440, height: 1100 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`${CHECKLISTS}/cards/${vauban.card_id}`)
	const bloc = page.getByTestId('bloc-checklist-card')
	await expect(bloc.getByTestId('checklist-compte')).toHaveText('2 sur 3')
	await bloc.getByTestId('checklist-nouveau').fill('Rappeler le proviseur')
	await bloc.getByTestId('checklist-ajouter').click()
	const libre = bloc.getByTestId('checklist-point').filter({ hasText: 'Rappeler le proviseur' })
	await expect(libre).toBeVisible()
	await bloc.getByTestId('checklist-nouveau').fill('Envoyer le support')
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklist, nom: 'checklist', cibles: [bloc] })
	await libre.getByTestId('checklist-retirer').click()
	await expect(libre).toHaveCount(0)
	await bloc.getByTestId('checklist-nouveau').fill('')

	// Les filtres sont tous actifs à l'ouverture : « Champs » se montre tel quel, sans clic qui le désactiverait.
	const coche = page.getByText('Point de checklist coché').first()
	await expect(coche).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklist, nom: 'fil-point-coche', cibles: [page.getByRole('group', { name: 'Filtres du fil' }).getByRole('button', { name: /^Champs/ }), coche.locator('xpath=ancestor::li[1]')] })

	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto(CHECKLISTS)
	await page
		.getByTestId('carte-card')
		.filter({ hasText: 'Atelier prompt — Lycée Vauban' })
		.dragTo(page.locator(`[data-testid="colonne"][data-etape="${ETAPE_NEGOCIATION_CHECKLISTS}"]`))
	const bandeau = page.getByTestId('refus-deplacement')
	await expect(bandeau.getByRole('link', { name: 'Cocher ces points' })).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklist, nom: 'cocher-ces-points', cibles: [bandeau] })
})
