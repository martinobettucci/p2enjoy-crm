// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2 : les images du chapitre 10, « Le carnet de contacts »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 10 ; docs/SPEC-contacts.md (le carnet, la fiche, la
//       suppression), docs/SPEC-rattachements.md (rattacher, détacher, le rôle), docs/SPEC-audit.md §7 (le RGPD)
//
// Les contacts et les organisations sont ceux du seed : Léo Marchand, Sogexia, le contact déjà anonymisé. Les gestes qui
// ne se défont pas — supprimer, anonymiser — portent sur un contact posé par la clé de service et retiré ensuite ; la
// confirmation d'anonymisation est montrée puis ANNULÉE. Rattacher et détacher écrivent dans le fil de l'affaire, qui est
// en ajout seul : ces gestes se jouent sur des AFFAIRES JETABLES — l'une archivée —, que leur suppression emporte avec
// leur fil, jamais sur une affaire du seed. Deux refus exigent une concurrence : un rattachement posé entre l'ouverture
// du formulaire et l'envoi, et un rôle retiré à Driss Lemoine entre l'ouverture et l'envoi — l'un et l'autre défaits.
// « Le nom est requis. » n'est pas montré : « Créer » reste grisé tant que le nom est vide (SPEC-manual §11.3).

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import {
	ADMIN,
	BIZDEV,
	CHANNEL_GRANDS_COMPTES,
	ETAPE_SIGNATURE,
	VIEWER,
	WORKFLOW_GLOBAL,
	WORKSPACE_SEED,
	connecterAvecLeLabs,
	detruireAffaire,
	lireService,
	poserAffaire,
	retablirLeSeed,
	service,
} from './outils'

const CHAPITRE = 'le-carnet-de-contacts'
const LEO = '5eed0000-0000-4000-8000-000000000091'
const ANONYME = '5eed0000-0000-4000-8000-0000000000a9'
const SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const EPHEMERE = { id: 'e1170000-0000-4000-8000-0000000010c1', nom: 'Hugo Ferrand' } as const
const ARCHIVEE = { id: 'e1170000-0000-4000-8000-0000000010a1', titre: 'Contrat cadre 2024' } as const
const AUDIT = { id: 'e1170000-0000-4000-8000-0000000010a2', titre: 'Audit des accès Sogexia' } as const

/** Une affaire jetable dans « Grands comptes », retirée d'abord si un passage précédent l'a laissée. */
async function affaireJetable(requete: APIRequestContext, affaire: { readonly id: string; readonly titre: string }): Promise<void> {
	await detruireAffaire(requete, affaire.id)
	await poserAffaire(requete, { ...affaire, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
}

const entete = (page: Page) => [page.getByTestId('ouvrir-modification-contact'), page.getByTestId('ouvrir-suppression-contact')]

// Le rôle de Driss et les affaires jetables sont rétablis même quand un test dépasse son délai.
test.afterEach(async ({ request }) => retablirLeSeed(request, [ARCHIVEE.titre, AUDIT.titre]))

test('le carnet, la création et la fiche d’un contact', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/contacts')
	await expect(page.getByTestId('ligne-contact').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'carnet', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'exporter-contacts', cibles: [page.getByTestId('ouvrir-creation-contact'), page.getByTestId('exporter-contacts')] })
	// Le bouton cède sa place au formulaire : deux images.
	await illustrer(page, { chapitre: CHAPITRE, section: 'creer-un-contact', nom: 'nouveau-contact', cibles: [page.getByTestId('ouvrir-creation-contact')] })
	await page.getByTestId('ouvrir-creation-contact').click()
	const formulaire = page.locator('form').filter({ has: page.getByLabel('Nom') }).first()
	await expect(formulaire).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'creer-un-contact', nom: 'formulaire-de-creation', cibles: [formulaire] })
	await page.keyboard.press('Escape')

	await page.goto(`/contacts/${LEO}`)
	await expect(page.getByTestId('caracteristiques-contact')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'creer-un-contact', nom: 'modifier-sur-la-fiche', cibles: entete(page) })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-fiche-d-un-contact',
		nom: 'fiche-contact',
		cibles: [page.getByRole('heading', { level: 1 }), page.getByTestId('caracteristiques-contact'), page.getByTestId('tableau-affaires-contact')],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: 'modifier-un-contact', nom: 'modifier-contact', cibles: [page.getByTestId('ouvrir-modification-contact')] })
	await page.getByTestId('ouvrir-modification-contact').click()
	const modification = page.locator('form').filter({ has: page.getByLabel('Nom') }).first()
	await expect(modification).toBeVisible()
	// « Modifier » cède sa place au formulaire : le bouton paraît sur l'image `modifier-sur-la-fiche`.
	await illustrer(page, { chapitre: CHAPITRE, section: 'modifier-un-contact', nom: 'formulaire-de-modification', cibles: [modification] })

	await page.goto('/contacts/00000000-0000-4000-8000-000000000000')
	const introuvable = page.getByText('Contact introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'la-fiche-d-un-contact', nom: 'contact-introuvable', cibles: [introuvable] })
})

/**
 * Le fichier d'un salon : deux personnes nouvelles d'une organisation nouvelle, un doublon de Léo Marchand (même email,
 * en majuscules), une ligne refusée. La colonne « Notes » n'a pas d'équivalent au carnet : elle est ignorée.
 */
const FICHIER_SALON = [
	'Nom;Email;Organisation;Domaine;Site;Notes',
	'Hélène Garnier;helene.garnier@atelier-orme.example;Atelier Orme;atelier-orme.example;https://www.atelier-orme.example;stand B12',
	'Yanis Roche;yanis.roche@atelier-orme.example;Atelier Orme;atelier-orme.example;;rappeler en janvier',
	'Léo Marchand;LEO.MARCHAND@sogexia.example;Sogexia;;;déjà au carnet',
	'Margaux;pas-un-email;;;;carte illisible',
].join('\n')

/** Retire ce que l'import a créé : ses deux contacts et son organisation. */
async function retirerImport(requete: APIRequestContext): Promise<void> {
	await service(requete, 'delete', `contacts?email=like.${encodeURIComponent('*@atelier-orme.example')}`)
	await service(requete, 'delete', `organizations?name=eq.${encodeURIComponent('Atelier Orme')}`)
}

test('importer un fichier : les colonnes, la vérification, le rapport', async ({ page, request }) => {
	await retirerImport(request)
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts')
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'importer-un-fichier', cibles: [page.getByTestId('exporter-contacts'), page.getByTestId('importer-contacts')] })
		await page.getByTestId('importer-contacts').click()
		const panneau = page.getByTestId('panneau-import')
		await expect(panneau).toBeVisible()
		await panneau.getByLabel('Fichier CSV').setInputFiles({ name: 'salon.csv', mimeType: 'text/csv', buffer: Buffer.from(FICHIER_SALON, 'utf8') })
		await expect(panneau.getByTestId('champ-colonne-import')).toHaveCount(6)
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'import-colonnes', cibles: [panneau] })

		await panneau.getByTestId('import-verifier').click()
		await expect(panneau.getByTestId('import-comptes')).toBeVisible()
		await expect(panneau.getByTestId('ligne-ecartee-import')).toHaveCount(2)
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'import-verification', cibles: [panneau.getByTestId('import-comptes'), panneau.getByTestId('import-confirmer')] })

		await panneau.getByTestId('import-confirmer').click()
		await expect(panneau.getByTestId('import-rapport')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'import-rapport', cibles: [panneau.getByTestId('import-rapport'), panneau.getByTestId('import-terminer')] })
		await panneau.getByTestId('import-terminer').click()
		await expect(page.getByRole('link', { name: 'Hélène Garnier' })).toBeVisible()
	} finally {
		await retirerImport(request)
	}
})

test('rattacher, corriger le rôle, détacher — sur une affaire archivée', async ({ page, request }) => {
	await affaireJetable(request, ARCHIVEE)
	await service(request, 'patch', `card_placements?card_id=eq.${ARCHIVEE.id}`, { archived_at: new Date().toISOString() })
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/contacts/${LEO}`)
		// « Rattacher à une affaire » cède sa place au formulaire : le bouton d'abord, puis le formulaire rempli.
		await illustrer(page, { chapitre: CHAPITRE, section: 'rattacher-une-personne-a-une-affaire', nom: 'rattacher-a-une-affaire', cibles: [page.getByTestId('ouvrir-rattachement-affaire')] })
		await page.getByTestId('ouvrir-rattachement-affaire').click()
		const formulaire = page.getByTestId('formulaire-rattachement-affaire')
		await formulaire.getByTestId('champ-affaire').selectOption({ label: `${ARCHIVEE.titre} (archivée)` })
		await formulaire.getByTestId('champ-role-affaire').fill('décideur')
		await illustrer(page, { chapitre: CHAPITRE, section: 'rattacher-une-personne-a-une-affaire', nom: 'rattacher', cibles: [formulaire] })

		// Quelqu'un d'autre rattache Léo entre-temps : l'envoi est refusé, la saisie conservée.
		await service(request, 'post', 'card_contacts', [{ workspace_id: WORKSPACE_SEED, card_id: ARCHIVEE.id, contact_id: LEO, role: 'décideur' }])
		await formulaire.getByTestId('confirmer-rattachement-affaire').click()
		const refus = formulaire.getByTestId('refus-rattachement-affaire')
		await expect(refus).toContainText('Ce contact est déjà rattaché à cette affaire')
		await illustrer(page, { chapitre: CHAPITRE, section: 'rattacher-une-personne-a-une-affaire', nom: 'deja-rattache', cibles: [formulaire] })

		await page.reload()
		const ligne = page.getByTestId('ligne-affaire-contact').filter({ hasText: ARCHIVEE.titre })
		await expect(ligne.getByTestId('pilule-affaire-archivee')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'la-fiche-d-un-contact', nom: 'affaire-archivee', cibles: [ligne] })

		await ligne.getByTestId('modifier-role-affaire').click()
		const formRole = page.getByTestId('ligne-formulaire-role')
		await expect(formRole).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'corriger-le-role-d-une-personne-dans-une-affaire',
			nom: 'modifier-le-role',
			cibles: [page.getByRole('columnheader', { name: 'Rôle dans l’affaire' }), page.getByRole('columnheader', { name: 'Commandes' }), ligne, formRole],
		})
		await formRole.getByTestId('annuler-role-affaire').click()

		await ligne.getByRole('button', { name: /^Détacher/ }).click()
		const confirmation = page.getByTestId('ligne-confirmation-detachement')
		await expect(confirmation).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'detacher-une-personne-d-une-affaire',
			nom: 'detacher',
			cibles: [page.getByTestId('ouvrir-rattachement-affaire'), page.getByRole('columnheader', { name: 'Commandes' }), ligne, confirmation],
		})
		await confirmation.getByRole('button', { name: /Détacher/ }).click()
		await expect(ligne).toHaveCount(0)
	} finally {
		await detruireAffaire(request, ARCHIVEE.id)
	}
})

test('supprimer un contact rattaché, et la trace dans l’affaire', async ({ page, request }) => {
	await affaireJetable(request, AUDIT)
	await service(request, 'delete', `contacts?id=eq.${EPHEMERE.id}`)
	await service(request, 'post', 'contacts', [{ id: EPHEMERE.id, workspace_id: WORKSPACE_SEED, full_name: EPHEMERE.nom, email: 'hugo.ferrand@exemple.test' }])
	await service(request, 'post', 'card_contacts', [{ workspace_id: WORKSPACE_SEED, card_id: AUDIT.id, contact_id: EPHEMERE.id, role: 'prescripteur' }])
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/contacts/${EPHEMERE.id}`)
		await page.getByTestId('ouvrir-suppression-contact').click()
		const confirmation = page.getByTestId('confirmation-suppression-contact')
		await expect(confirmation).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'supprimer-un-contact', nom: 'supprimer', cibles: [...entete(page), confirmation] })
		await page.getByTestId('confirmer-suppression-contact').click()
		await expect(page).toHaveURL(/\/contacts$/)

		await page.goto('/tracks/conseil-ia/grands-comptes/cards/' + AUDIT.id)
		const trace = page.getByText('Contact détaché', { exact: true }).last()
		await expect(trace).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'supprimer-un-contact', nom: 'contact-detache', cibles: [trace.locator('xpath=ancestor::li[1]')] })
	} finally {
		await service(request, 'delete', `contacts?id=eq.${EPHEMERE.id}`)
		await detruireAffaire(request, AUDIT.id)
	}
})

test('les données personnelles : la zone, la confirmation, un contact anonymisé', async ({ page, request }) => {
	await service(request, 'delete', `contacts?id=eq.${EPHEMERE.id}`)
	await service(request, 'post', 'contacts', [{ id: EPHEMERE.id, workspace_id: WORKSPACE_SEED, full_name: EPHEMERE.nom, email: 'hugo.ferrand@exemple.test' }])
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/contacts/${EPHEMERE.id}`)
		const zone = page.getByTestId('zone-rgpd-contact')
		await illustrer(page, { chapitre: CHAPITRE, section: 'les-donnees-personnelles-d-un-contact-les-exporter-les-anonymiser', nom: 'zone-rgpd', cibles: [zone] })
		await zone.getByRole('button', { name: 'Anonymiser ce contact' }).click()
		await zone.getByLabel('Nom du contact').fill(EPHEMERE.nom)
		await expect(zone.getByRole('button', { name: 'Anonymiser définitivement' })).toBeEnabled()
		await illustrer(page, { chapitre: CHAPITRE, section: 'les-donnees-personnelles-d-un-contact-les-exporter-les-anonymiser', nom: 'confirmation', cibles: [zone] })
		// La confirmation est montrée, jamais envoyée : l'anonymisation ne se défait pas.
	} finally {
		await service(request, 'delete', `contacts?id=eq.${EPHEMERE.id}`)
	}
	await page.goto(`/contacts/${ANONYME}`)
	await expect(page.getByTestId('pilule-contact-anonymise')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-donnees-personnelles-d-un-contact-les-exporter-les-anonymiser',
		nom: 'contact-anonymise',
		cibles: [page.getByRole('heading', { level: 1 }), page.getByTestId('pilule-contact-anonymise'), ...entete(page)],
	})
})

test('les organisations : la liste, la fiche, la modification', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/contacts')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-fiche-d-une-organisation',
		nom: 'colonne-organisation',
		cibles: [page.getByRole('columnheader', { name: 'Organisation' }), page.getByTestId('lien-organisation').first()],
	})
	await page.goto('/contacts/organisations')
	await expect(page.getByTestId('ligne-organisation').first()).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'l-onglet-organisations',
		nom: 'onglet-organisations',
		cibles: [page.getByTestId('ouvrir-creation-organisation'), page.getByTestId('tableau-organisations')],
	})
	await page.goto(`/contacts/organisations/${SOGEXIA}`)
	await expect(page.getByTestId('caracteristiques-organisation')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-fiche-d-une-organisation',
		nom: 'fiche-organisation',
		cibles: [page.getByRole('heading', { level: 1 }), page.getByTestId('caracteristiques-organisation'), page.getByTestId('tableau-contacts-organisation')],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: 'l-onglet-organisations', nom: 'modifier-organisation', cibles: [page.getByTestId('modifier-organisation')] })
	await illustrer(page, { chapitre: CHAPITRE, section: 'creer-une-organisation', nom: 'modifier-apres-creation', cibles: [page.getByTestId('modifier-organisation')] })
	await illustrer(page, { chapitre: CHAPITRE, section: 'modifier-une-organisation', nom: 'modifier', cibles: [page.getByTestId('modifier-organisation')] })
	await page.getByTestId('modifier-organisation').click()
	const formulaire = page.getByTestId('formulaire-organisation')
	await expect(formulaire).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'modifier-une-organisation', nom: 'formulaire-organisation', cibles: [formulaire] })
	await formulaire.getByTestId('annuler-organisation').click()

	await page.goto('/contacts/organisations/f0000000-0000-4000-8000-000000000404')
	const introuvable = page.getByText('Organisation introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'la-fiche-d-une-organisation', nom: 'organisation-introuvable', cibles: [introuvable] })
})

test('créer une organisation : les refus', async ({ page, request }) => {
	const [driss] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Driss Lemoine')}&select=id`)
	if (driss === undefined) throw new Error('le profil de Driss Lemoine est absent du seed')
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/contacts/organisations')
	// « Nouvelle organisation » cède sa place au formulaire : le bouton d'abord, puis chaque refus dans le formulaire.
	await illustrer(page, { chapitre: CHAPITRE, section: 'creer-une-organisation', nom: 'nouvelle-organisation', cibles: [page.getByTestId('ouvrir-creation-organisation')] })
	await page.getByTestId('ouvrir-creation-organisation').click()
	const formulaire = page.getByTestId('formulaire-organisation')
	const refus = page.getByTestId('refus-organisation')
	const montrer = async (nom: string) => illustrer(page, { chapitre: CHAPITRE, section: 'creer-une-organisation', nom, cibles: [formulaire] })

	await page.getByTestId('champ-nom-organisation').fill('Atelier Lumière')
	await page.getByTestId('champ-site-organisation').fill('www.atelier-lumiere.example')
	await page.getByTestId('envoyer-organisation').click()
	await expect(formulaire).toContainText('Le site web doit commencer par http:// ou https://.')
	await montrer('site-web')

	await page.getByTestId('champ-site-organisation').fill('')
	await page.getByTestId('champ-domaine-organisation').fill('sogexia.example')
	await page.getByTestId('envoyer-organisation').click()
	await expect(refus).toContainText('Ce domaine est déjà celui d’une autre organisation de l’espace.')
	await montrer('domaine-pris')

	// Le rôle de Driss lui est retiré entre l'ouverture et l'envoi, puis rendu.
	await page.getByTestId('champ-domaine-organisation').fill('')
	await service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${driss.id}`, { role: 'viewer' })
	try {
		await page.getByTestId('envoyer-organisation').click()
		await expect(refus).toContainText('Vous ne pouvez pas modifier les organisations de cet espace.')
		await montrer('droits-retires')
	} finally {
		await service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${driss.id}`, { role: 'business_developer' })
	}
	await formulaire.getByTestId('annuler-organisation').click()
})

test('la lectrice : les commandes du carnet grisées', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto(`/contacts/organisations/${SOGEXIA}`)
	await expect(page.getByTestId('modifier-organisation')).toBeDisabled()
	await illustrer(page, { chapitre: CHAPITRE, section: 'l-onglet-organisations', nom: 'lectrice', cibles: [page.getByTestId('modifier-organisation')] })
})
