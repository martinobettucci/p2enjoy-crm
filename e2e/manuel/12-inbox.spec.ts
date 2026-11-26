// @spec CRM-158 (docs/BACKLOG.md) — l'image « outbox-annuler » attend SA ligne reprogrammée, la boucle d'envoi active
//       (docs/SPEC-mail-subsystem.md §34.7 ; décision 954)
// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images du chapitre 12, « L'inbox : lire, trier et répondre »
// @spec CRM-157 (docs/BACKLOG.md) — tranche T2 : l'image « envoi-sans-domaine », dans un espace jetable sans domaine
//       (docs/SPEC-mail-subsystem.md §33.4, §33.6 ; docs/manual.md §12.3)
// @spec CRM-155 (docs/BACKLOG.md) — tranche T1 : l'image « pastilles-dans-la-liste » montre les filtres rapides
//       (docs/SPEC-mail-subsystem.md §31.12 ; docs/DESIGN_SYSTEM.md §5.108 ; docs/manual.md §12.2)
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 12 ; docs/SPEC-mail-subsystem.md §19 (l'envoi, les
//       pièces jointes), §20 (l'inbox, le classement, la suggestion, le sommeil des fils)
// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : les images de l'aperçu d'une pièce jointe (docs/DESIGN_SYSTEM.md §5.80,
//       docs/SPEC-pieces-jointes.md §5, docs/SPEC-seed.md §35)
// @spec CRM-128 (docs/BACKLOG.md) — tranches T4 et T5 : les images de la section 12.4 — l'entrée et la liste, la relecture
//       d'un mail préparé, l'encadré de la fiche — sur les mails du seed (docs/DESIGN_SYSTEM.md §5.90 ;
//       docs/SPEC-mails-prepares.md §6 ; docs/SPEC-seed.md §37)
// @spec CRM-139 (docs/BACKLOG.md) — l'image « seulement-moi » de la section 12.2 : la case cochée et les dossiers qu'elle
//       compte (docs/DESIGN_SYSTEM.md §5.96 ; docs/SPEC-mail-subsystem.md §27.4)
// @spec CRM-160 (docs/BACKLOG.md) — la même image : le dossier de Vertuo porte la réponse reçue du seed §53, et celui de
//       « Plateforme de billetterie », dont Camille est responsable, paraît (docs/SPEC-mail-subsystem.md §27.7)
// @spec CRM-160 (docs/BACKLOG.md) — l'image « telecharger » : l'envoi choisi dans le sélecteur du fil, que la réponse du seed
//       §53 rallonge ; la réponse rendue non lue à la fin (docs/SPEC-seed.md §53 ; docs/SPEC-mail-subsystem.md §18 bis.2)
// @spec CRM-137 (docs/BACKLOG.md) — l'image « classer-expediteur-connu » de la section 12.1 : le sélecteur cherchable et
//       la case « Expéditeur connu » (docs/DESIGN_SYSTEM.md §5.94 ; docs/SPEC-mail-subsystem.md §26.3)
// @spec CRM-144 (docs/BACKLOG.md) — tranche T5 : les images de la section 12.5 — « Échecs » et « Réessayer » sur l'échec du
//       seed, « En file » et la confirmation d'annulation sur un envoi posé par la vraie voie (docs/DESIGN_SYSTEM.md §5.98 ;
//       docs/SPEC-seed.md §42 ; décision 913)
// @spec CRM-140 (docs/BACKLOG.md) — tranche T4 : l'image « afficher-les-images » de la section 12.2 — le courrier HTML du
//       seed dans son cadre, le bandeau et son bouton, images bloquées (docs/DESIGN_SYSTEM.md §5.100 ; docs/SPEC-seed.md §44)
// @spec CRM-138 (docs/BACKLOG.md) — tranche T5 : la rangée de boutons du message ouvert (« mettre-le-fil-en-sommeil »,
//       nom gardé), « effacer-un-message » (la confirmation dans le flux, ouverte puis annulée) et « corbeille » (le courrier
//       que le seed efface avec sa boîte, déplacé) — docs/DESIGN_SYSTEM.md §5.102 ; docs/SPEC-seed.md §45
// @spec CRM-151 (docs/BACKLOG.md) — tranche T3 : « effacer-un-message » montre la confirmation de « Supprimer partout », et
//       « sans-confirmation » la mention et « Redemander » (docs/SPEC-mail-subsystem.md §29.11 ; docs/DESIGN_SYSTEM.md §5.102)
// @spec CRM-141 (docs/BACKLOG.md) — tranche T6 : les images des pastilles — « pastilles-dans-la-liste » et
//       « pastilles-d-un-message » (section 12.2), « pastilles-des-mails », « pastille-archivee » et « fiche-d-une-pastille » (section 12.6) — sur la
//       correction du seed (docs/DESIGN_SYSTEM.md §5.103 ; docs/SPEC-mail-subsystem.md §31.7 ; docs/SPEC-seed.md §46) ;
//       rien n'est posé, retiré ni créé : la liste et la fiche sont ouvertes puis refermées
// @spec CRM-159 (docs/BACKLOG.md) — tranche T4 : l'image « fils-masques » (section 12.2) — la mention sous les non classés, sur
//       les deux mails Spam du seed (docs/DESIGN_SYSTEM.md §5.111 ; docs/SPEC-seed.md §52) ;
//       « fiche-d-une-pastille » montre désormais la case « Cacher ses mails dans l'inbox »
// @spec CRM-156 (docs/BACKLOG.md) — tranche T5 : les images des actions groupées et des ajouts de l'inbox — « actions-groupees »,
//       « confirmation-groupee », « filtre-expediteur », « transferer-un-message », « bloquer-un-expediteur »,
//       « creer-des-contacts » (section 12.2), « expediteurs-bloques » (section 12.7), et « transfert-de-mail » du
//       chapitre 5 (section 5.2), sur les données du §49 du seed ; chaque geste est ouvert puis annulé, rien n'est écrit
//       (docs/DESIGN_SYSTEM.md §5.109, §5.109 bis ; docs/SPEC-mail-subsystem.md §32.13 ; docs/SPEC-seed.md §49)
// @spec CRM-166 (docs/BACKLOG.md) — tranche T3 : l'image « assistant-ia » de la section 12.2 — la bulle et le plan proposé, rien n'est appliqué
//       (docs/DESIGN_SYSTEM.md §5.116 ; docs/SPEC-mail-subsystem.md §36 ; docs/SPEC-ia.md §17)
// @spec CRM-143 (docs/BACKLOG.md) — tranche T4 : l'image « piece-non-analysee » de la section 12.1 — « Télécharger quand
//       même » et son avertissement (docs/DESIGN_SYSTEM.md §5.95 ; docs/SPEC-pieces-jointes.md §17.4)
//
// Les messages sont ceux du seed : « Candidature spontanée » (non classé), « Demande de devis — refonte » et sa réponse
// (classés dans « Refonte du site vitrine »), « Point d'avancement — migration ERP » (suggéré). Rien n'est classé, retiré,
// endormi ni envoyé : chaque geste est montré puis annulé. Les fichiers joints au formulaire, déposés dans le stockage
// dès leur choix, sont retirés à la fin comme `e2e/ui/envoi-pieces-jointes.spec.ts` le fait.
// @verifies CRM-139 (docs/BACKLOG.md) — l'inbox s'ouvre ici case « Seulement moi » décochée, `courrier=tous` : le sujet de ces
//           preuves est ailleurs (docs/SPEC-mail-subsystem.md §27.5)
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { conteneur } from '../conteneur'
import { lireEnv } from '../env'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, BIZDEV, WORKSPACE_SEED, connecterAvecLeLabs, lireService, rest, retenir, service } from './outils'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { attendreLeSort } from '../sort-envoi'
import { demonterEspaceSansDomaine, monterEspaceSansDomaine } from '../api/espace-sans-domaine'

// Révisé le 2026-11-21 (`CRM-161` T2.b, DS §5.113) : `getByLabel('Message', { exact: true })` — le bouton du menu des espaces porte
// « … des messages non lus … » dans son nom, et un libellé partiel l'attrapait aussi.

// LE CHROMIUM COMPLET, et non le « headless shell » : seul le premier porte le lecteur PDF du navigateur, que l'image de
// l'aperçu d'un PDF montre (`CRM-074` T3). Le choix vaut pour le fichier entier : Playwright ne le permet pas par groupe.
test.use({ channel: 'chromium' })

const CHAPITRE = 'l-inbox-lire-trier-et-repondre'
const LIRE = 'l-inbox-lire-et-trier-le-courrier-recu'
const ECRIRE = 'ecrire-et-repondre'

const dossiers = (page: Page) => page.getByTestId('inbox-panneau-dossiers')
const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')

async function ouvrir(page: Page, dossier: RegExp, objet: string): Promise<void> {
	await page.goto('/p2enjoy/inbox?courrier=tous')
	await dossiers(page).getByRole('button', { name: dossier }).click()
	await liste(page).getByTestId('inbox-message').filter({ hasText: objet }).first().click()
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText(objet)
}

test('l’inbox : les dossiers, un fil, le classement', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/p2enjoy/inbox?courrier=tous')
	await expect(dossiers(page)).toBeVisible()
	// L'image d'ouverture montre un dossier déplié et un message lu : les trois panneaux remplis.
	await dossiers(page).getByRole('button', { name: /Non classés/ }).click()
	// UN MESSAGE EN TEXTE, NOMMÉ (`CRM-138`) : le premier de la liste est devenu le courrier HTML du §44, dont le cadre
	// confiné ne se peint pas à temps pour une image pleine page.
	await liste(page).getByTestId('inbox-message').filter({ hasText: 'Point d’avancement — migration ERP' }).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Où en sommes-nous du chantier de migration')
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

	// `CRM-138`, `CRM-141`, `CRM-151` : la rangée de boutons — le sommeil, la lecture, les pastilles, « Supprimer ici » et
	// « Supprimer partout » (§5.102) ; l'image garde son nom.
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'mettre-le-fil-en-sommeil', cibles: [page.getByTestId('inbox-commandes-message')] })
	// `CRM-151` : « Supprimer partout » — sa confirmation dans le flux, montrée puis annulée ; rien n'est supprimé. L'image
	// garde son nom (`effacer-un-message`).
	await page.getByTestId('inbox-supprimer-partout').click()
	const effacement = page.getByTestId('inbox-suppression-confirmation')
	await expect(effacement).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'effacer-un-message', cibles: [effacement] })
	await effacement.getByRole('button', { name: 'Annuler', exact: true }).click()
	await expect(effacement).toBeHidden()
	// `CRM-151` : la suspension, posée dans l'onglet par son échéance comme la case la pose (§29.11), puis retirée par
	// « Redemander » — rien n'est supprimé ni écrit en base.
	await page.evaluate(() =>
		sessionStorage.setItem('p2enjoy.inbox.suppression.sans-confirmation', new Date(Date.now() + 45 * 60_000).toISOString()),
	)
	// Le rechargement revient à la liste (l'ouverture a retiré `message` de l'adresse) : le message est rouvert.
	await page.reload()
	await ouvrir(page, /Refonte du site vitrine/, 'Demande de devis — refonte')
	const suspendue = page.getByTestId('inbox-suppression-suspendue')
	await expect(suspendue).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'sans-confirmation',
		cibles: [page.getByTestId('inbox-supprimer-ici'), suspendue],
	})
	await suspendue.getByRole('button', { name: 'Redemander' }).click()
	await expect(suspendue).toBeHidden()
	await page.getByTestId('fil-endormir').click()
	const panneau = page.getByTestId('fil-panneau')
	await expect(panneau).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'jusqu-a-quand', cibles: [panneau] })
	await panneau.getByRole('button', { name: 'Annuler', exact: true }).click()
	await expect(panneau).toBeHidden()

	// Retirer de l'affaire : le bouton, puis la confirmation qui le remplace, refermée par « Annuler ».
	const retirer = page.getByRole('button', { name: 'Retirer de l’affaire' })
	// CENTRÉ AVANT L'IMAGE (`CRM-151`) : rouvert après le rechargement, le message laisse le bouton au ras de la fenêtre, et
	// `scrollIntoViewIfNeeded` l'y amène à une fraction de pixel près.
	await retirer.evaluate((element) => element.scrollIntoView({ block: 'center' }))
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'retirer-de-l-affaire', cibles: [retirer] })
	await retirer.click()
	const confirmation = page.getByTestId('inbox-retrait-confirmation')
	await expect(confirmation).toBeVisible()
	// CENTRÉE AVANT L'IMAGE (`CRM-138`) : la rangée de boutons allonge l'en-tête du message, et la confirmation, au bas du
	// panneau, sortait de la fenêtre — `scrollIntoViewIfNeeded` ne fait défiler que le minimum.
	await confirmation.evaluate((element) => element.scrollIntoView({ block: 'center' }))
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'confirmer-le-retrait', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click()
	await expect(confirmation).toBeHidden()

	// Le même message, dans le fil de l'affaire.
	await page.getByTestId('inbox-pilule-card').click()
	// Le fil écrit le genre et l'objet sur une même ligne : « Message reçu·<objet> ».
	const recu = page.getByRole('listitem').filter({ hasText: /^\s*Message reçu/ }).first()
	await expect(recu).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'message-recu', cibles: [recu] })
	await page.goto('/p2enjoy/tracks/conseil-ia/grands-comptes')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'afficher-les-affaires-en-sommeil', cibles: [page.getByTestId('barre-sommeil-board')] })

	// Une pièce déclarée saine : la seule du seed, jointe au message envoyé sur « Refonte du monitoring ».
	// RÉVISÉ par `CRM-160` (seed §53) : le fil de cet envoi porte désormais la réponse de Driss, son message le plus récent,
	// que l'ouverture du fil affiche (§16.16.4) et MARQUE LUE pour Camille (§18 bis.2). L'envoi est choisi dans le sélecteur
	// du fil, et la réponse est rendue non lue à la fin, par la vraie fonction et sous le jeton de Camille : les preuves qui
	// comptent ses non-lus (pgTAP `0095` n° 11) ne dépendent pas de ce parcours.
	await ouvrir(page, /Refonte du monitoring/, 'Proposition de refonte du monitoring')
	try {
		await page.getByTestId('inbox-message-ouvert').getByTestId('inbox-fil-message').filter({ hasNotText: 'Driss' }).first().click()
		const piece = page.getByTestId('inbox-message-ouvert').getByText('proposition-monitoring.txt').first()
		const telecharger = page.getByTestId('inbox-message-ouvert').getByRole('button', { name: /Télécharger/ }).first()
		await expect(telecharger).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'telecharger', cibles: [piece, telecharger] })
	} finally {
		const [reponse] = (await (
			await page.request.get(
				`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-reponse-affaire@p2enjoy.test>')}`,
				{ headers: enTetesService() },
			)
		).json()) as { id: string }[]
		if (reponse !== undefined) {
			const remise = await page.request.post(`${URL_API}/rest/v1/rpc/mark_message_unread`, {
				headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), 'Content-Type': 'application/json' },
				data: { p_message_id: reponse.id },
			})
			expect(remise.status(), await remise.text()).toBe(200)
		}
	}
})

// `CRM-138` T5 : la corbeille de l'inbox, avec le courrier que le seed efface avec sa boîte (docs/SPEC-seed.md §45) — son
// auteur, sa date d'effacement définitif, son déplacement fait, et « Restaurer », qui n'est pas appuyé.
test('la corbeille de l’inbox : un message effacé avec sa boîte, et « Restaurer »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/p2enjoy/inbox?courrier=tous')
	await dossiers(page).getByTestId('inbox-corbeille').click()
	const ligne = page.getByTestId('inbox-corbeille-ligne').filter({ hasText: 'Offre de partenariat — salon Numérique Lyon' })
	await expect(ligne).toContainText('Déplacé dans la corbeille de la boîte')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'corbeille',
		cibles: [
			dossiers(page).getByTestId('inbox-corbeille'),
			page.getByTestId('inbox-panneau-corbeille').getByText(/Un message reste \d+ jours dans la corbeille/),
			ligne,
		],
	})
})

// `CRM-143` T4 (docs/DESIGN_SYSTEM.md §5.95) : une pièce non analysée. Le seed n'en porte pas — elle naît sans antivirus, et
// la reprise la rendrait saine dans le quart d'heure (docs/SPEC-pieces-jointes.md §17.8) : l'image la pose sur un message du
// seed, son objet réellement déposé par la clé de service, puis la retire. L'avertissement est ouvert puis annulé : aucune
// confirmation n'est enregistrée.
test('un courrier mis en forme : son cadre, et le bandeau « Afficher les images »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrir(page, /Non classés/, 'Invitation — journée partenaires Sogexia')
	// LE CADRE ENTIER NE TIENT PAS dans l'image avec le bandeau (il mesure 70 % de la fenêtre) : l'image cite le bandeau et
	// le titre du courrier, rendu DANS le cadre.
	const titre = page.frameLocator('[data-testid="inbox-corps-cadre"]').getByRole('heading', { name: /Journée partenaires Sogexia/ })
	await expect(titre).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'afficher-les-images', cibles: [page.getByTestId('bandeau-images'), titre] })
})

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
		await page.goto(`/p2enjoy/inbox?message=${message!.id}`)
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Demande de devis — refonte')
		const ligne = page.getByTestId('inbox-message-ouvert').getByTestId('inbox-piece-jointe').filter({ hasText: 'releve-de-compte.pdf' })
		await ligne.getByTestId('telecharger-quand-meme').click()
		const avertissement = ligne.getByTestId('avertissement-piece')
		await expect(avertissement).toBeVisible()
		// `CRM-141` T6 : la ligne des pastilles et la rangée de cinq boutons, sur deux lignes, abaissent la pièce ; le panneau
		// du message défile en lui-même, et la pièce est amenée en tête de la vue pour que l'avertissement y tienne.
		await ligne.evaluate((noeud) => noeud.scrollIntoView({ block: 'start' }))
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
	await page.goto(`/p2enjoy/inbox?message=${message!.id}`)
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
// Camille a écrit est compté (docs/SPEC-mail-subsystem.md §27.5). RÉVISÉ par `CRM-160` (§27.7) : celui d'une affaire dont
// elle est responsable l'est aussi — « Plateforme de billetterie » —, et le manuel le dit.
test('seulement moi : la case cochée, et le seul courrier qui vous concerne', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/p2enjoy/inbox')
	const caseMoi = page.getByTestId('inbox-seulement-moi')
	await expect(caseMoi).toBeEnabled()
	await expect(caseMoi).toBeChecked()
	await expect(dossiers(page).getByRole('button', { name: /Refonte du monitoring/ })).toBeVisible()
	await expect(dossiers(page).getByRole('button', { name: /Plateforme de billetterie/ })).toBeVisible()
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
		await page.getByLabel('Message', { exact: true }).fill('Bonjour,\n\nVous trouverez notre proposition jointe.')
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
	await page.goto('/p2enjoy/inbox?courrier=tous')
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
	await page.goto('/p2enjoy/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c1')
	const encadre = page.getByTestId('fiche-mail-prepare').filter({ hasText: 'Re: Demande de devis — refonte' })
	await expect(encadre).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'mail-prepare-sur-la-fiche',
		cibles: [encadre, page.getByTestId('envoi-ouvrir')],
	})
})

/** Une passe d'envoi par la route interne du service — le vrai chemin (`e2e/ui/connecteur-messagerie.spec.ts`). */
function passeDEnvoi(): Record<string, number> {
	const reseau = execFileSync('docker', ['inspect', conteneur('mail-sync'), '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'], { encoding: 'utf8' }).trim()
	const source = `
import os, urllib.error, urllib.request
requete = urllib.request.Request("http://mail-sync:8080/internal/v1/outbox/flush", data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`
	const brut = execFileSync(
		'docker',
		['run', '--rm', '--network', reseau, '-e', `JETON=${lireEnv('MAIL_SYNC_INTERNAL_TOKEN')}`, 'python:3.13.13-slim-bookworm', 'python', '-c', source],
		{ encoding: 'utf8', timeout: 300_000 },
	).trim()
	return JSON.parse(brut) as Record<string, number>
}

// `CRM-144` T5 : l'outbox (docs/SPEC-seed.md §42). L'échec est celui du seed, « Facture d'acompte — monitoring » (un vrai
// `auth_failed`) : il ne bouge plus. L'envoi en file du seed, lui, ne vit qu'une heure et demie (le worker le rejoue puis
// l'abandonne au fil des passes) : la preuve pose donc le sien par la même voie — mis en file sous le jeton de Camille sur
// l'identité injoignable, puis soumis par une vraie passe du worker —, montre la confirmation sans annuler, puis l'annule par la
// vraie fonction. La ligne « Envoi annulé » que cela laisse au fil de l'affaire est l'historique, qui ne se corrige pas.
test('suivre ses envois : « Échecs » et « Réessayer », puis « En file » et sa confirmation', async ({ page, request }) => {
	test.setTimeout(180_000)
	const SECTION = 'suivre-ses-envois-en-file-envoyes-echecs'
	const OBJET = 'Relance — point de calendrier'
	const entetesCamille = { ...enTetesAuthentifies(await jetonDe(ADMIN)), 'Content-Type': 'application/json' }
	const [injoignable] = await lireService<{ id: string }[]>(request, 'mail_outbound_identities?select=id&from_address=like.relances@*')
	expect(injoignable, 'l’identité injoignable du seed (§42)').toBeDefined()
	const mise = await request.post(rest('rpc/queue_outbound_email'), {
		headers: entetesCamille,
		data: {
			p_card_id: '5eed0000-0000-4000-8000-00000000d012',
			p_identity_id: injoignable!.id,
			p_to: ['bizdev@p2enjoy.test'],
			p_subject: OBJET,
			p_body_text: 'Bonjour,\n\nPouvons-nous fixer le point de calendrier ?',
		},
	})
	expect(mise.status(), await mise.text()).toBe(200)
	const id = (await mise.json()) as string
	try {
		// UNE VRAIE PASSE DU WORKER le prend et le reprogramme : l'image montre un envoi retardé par une vraie panne.
		// *Révisé par `CRM-158` (§34.7, décision 51), non relâché* : la boucle d'envoi a pu faire cette tentative avant la
		// passe, qui reste un accélérateur ; la tentative se lit sur SA ligne. Son échéance est ensuite reportée de dix
		// minutes par la clé de service : la boucle la rejouerait sinon une minute plus tard, pendant la prise de l'image.
		passeDEnvoi()
		const relu = await attendreLeSort(request, id, { etats: ['queued'], condition: (ligne) => ligne.attempts >= 1 })
		expect({ status: relu.status, attempts: relu.attempts, last_error: relu.last_error }).toEqual({
			status: 'queued',
			attempts: 1,
			last_error: 'connection_refused',
		})
		await request.patch(rest(`mail_outbox?id=eq.${id}`), {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: { next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString() },
		})
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/p2enjoy/inbox?courrier=tous&envois=echecs')
		const echec = page.getByTestId('inbox-envoi').filter({ hasText: "Facture d'acompte — monitoring" })
		await expect(echec).toContainText('le serveur d’envoi a refusé l’identifiant ou le mot de passe')
		await echec.click()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: SECTION,
			nom: 'outbox-echecs',
			cibles: [page.getByTestId('inbox-envois'), echec, page.getByTestId('inbox-envoi-reessayer')],
		})
		await page.getByTestId('inbox-envois-file').click()
		const enFile = page.locator(`[data-testid="inbox-envoi"][data-envoi="${id}"]`)
		await expect(enFile).toContainText('1 essai — le serveur d’envoi a refusé la connexion')
		await enFile.click()
		await page.getByTestId('inbox-envoi-annuler').click()
		await expect(page.getByTestId('inbox-envoi-confirmation')).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: SECTION,
			nom: 'outbox-annuler',
			cibles: [enFile, page.getByTestId('inbox-envoi-confirmation')],
		})
		await page.getByTestId('inbox-envoi-annuler-garder').click()
	} finally {
		await request.post(rest('rpc/cancel_outbound_email'), { headers: entetesCamille, data: { p_outbox_id: id } })
		await request.delete(rest(`mail_outbox?id=eq.${id}`), { headers: enTetesService() })
	}
})


// `CRM-155` T1 : les filtres rapides remplacent le filtre « Pastille » (docs/SPEC-mail-subsystem.md §31.12).
// `CRM-141` T6 : les pastilles d'un mail — la liste et son filtre, la liste à cocher d'un message, puis les réglages et la
// fiche d'une pastille. Tout est ouvert puis refermé : rien n'est posé ni créé.
test('les pastilles : dans la liste, sur un message, et dans les réglages', async ({ page, request }) => {
	// Le message corrigé à la main par le seed (§46) — et non la réponse « Re: », que la ligne du fil ouvrirait.
	const [corrige] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-inbox-classe@p2enjoy.test>')}`,
	)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${corrige!.id}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Demande de devis — refonte')
	// `CRM-155` (§5.108) : les filtres rapides — une pastille active, le volet des archivées déplié, « Toutes les
	// pastilles » ; l'adresse seule change, rien n'est écrit. Ils sont désactivés après l'image.
	const filtres = liste(page).getByTestId('inbox-filtres-pastilles')
	await expect(liste(page).getByTestId('inbox-pastilles-ligne').first()).toBeVisible()
	await filtres.getByRole('button', { name: 'Devis / commande', exact: true }).click()
	await expect(filtres.getByRole('button', { name: 'Devis / commande', exact: true })).toHaveAttribute('aria-pressed', 'true')
	await filtres.getByTestId('inbox-volet-archivees').click()
	await expect(filtres.getByRole('button', { name: 'Newsletter, pastille archivée' })).toBeVisible()
	await filtres.evaluate((bloc) => Promise.all(bloc.getAnimations({ subtree: true }).map((a) => a.finished)))
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'pastilles-dans-la-liste',
		cibles: [filtres, liste(page).getByTestId('inbox-message').first()],
	})
	await filtres.getByRole('button', { name: 'Toutes les pastilles' }).click()
	await page.getByTestId('inbox-pastilles').click()
	const panneau = page.getByTestId('inbox-panneau-pastilles')
	await expect(panneau).toContainText('retirée à la main')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'pastilles-d-un-message',
		cibles: [page.getByTestId('inbox-pastilles-message'), panneau],
	})
	await page.getByTestId('inbox-pastilles-fermer').click()
	await expect(panneau).toBeHidden()

	// `CRM-159` (§5.111) : les fils masqués par Spam, sous la liste des non classés — les deux mails Spam du seed (§52).
	const [invitation] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-corps-html@p2enjoy.test>')}`,
	)
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${invitation!.id}`)
	const masques = liste(page).getByTestId('inbox-fils-masques')
	await expect(masques).toContainText('fils masqués (Spam)')
	// La mention seule : en bas d'une longue liste, elle ne tient pas dans la fenêtre avec les filtres rapides. Elle est
	// amenée au centre de la vue, sa marge comprise.
	await masques.evaluate((noeud) => noeud.scrollIntoView({ block: 'center' }))
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'fils-masques', cibles: [masques] })

	const REGLAGES = 'definir-les-pastilles-des-mails'
	await page.goto('/p2enjoy/reglages/pastilles-mails')
	const ecran = page.getByTestId('reglages-pastilles-mail')
	await expect(ecran.getByTestId('ligne-pastille-mail').first()).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: REGLAGES,
		nom: 'pastilles-des-mails',
		cibles: [page.getByTestId('nouvelle-pastille'), ecran.getByTestId('ligne-pastille-mail').first()],
	})
	// Newsletter, archivée par le seed (§46), sous la case : sa mention et son seul bouton.
	await page.getByTestId('pastilles-archivees').check()
	const archivee = ecran.getByTestId('ligne-pastille-mail').filter({ hasText: 'Newsletter' })
	await expect(archivee).toContainText('Archivée')
	await archivee.evaluate((noeud) => noeud.scrollIntoView({ block: 'center' }))
	await illustrer(page, { chapitre: CHAPITRE, section: REGLAGES, nom: 'pastille-archivee', cibles: [archivee] })
	await page.getByTestId('pastilles-archivees').uncheck()
	await page.getByRole('button', { name: 'Modifier la pastille Lead' }).click()
	const fiche = page.getByTestId('fiche-pastille-mail')
	await expect(fiche).toBeVisible()
	// La fiche s'ouvre à la place de la ligne, plus bas que la fenêtre ne la montre : elle est amenée en tête de la vue.
	await fiche.evaluate((noeud) => noeud.scrollIntoView({ block: 'start' }))
	await illustrer(page, { chapitre: CHAPITRE, section: REGLAGES, nom: 'fiche-d-une-pastille', cibles: [fiche] })
	await fiche.getByTestId('pastille-annuler').click()
	await expect(fiche).toBeHidden()
})

test('les actions groupées, le filtre par expéditeur, le transfert, le blocage et les contacts (CRM-156)', async ({ page, request }) => {
	// Le mail de Nora Nouveau, expéditrice inconnue, transféré par Camille à Driss (seed §49).
	const [nora] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-inbox-inconnu@atelier-lumen.example>')}`,
	)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${nora!.id}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Nora Nouveau')

	// 1. Deux conversations cochées, puis la confirmation d'une action — annulée.
	const ligneDe = (objet: string) =>
		liste(page).locator('li').filter({ has: page.getByTestId('inbox-message').filter({ hasText: objet }) })
	await ligneDe('formation IA').getByTestId('inbox-case-fil').check()
	await ligneDe('Candidature spontanée').getByTestId('inbox-case-fil').check()
	await expect(page.getByTestId('inbox-selection-compte')).toHaveText('2 fils sélectionnés')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'actions-groupees',
		cibles: [page.getByTestId('inbox-rangee-action'), ligneDe('formation IA').getByTestId('inbox-case-fil')],
	})
	await page.getByTestId('inbox-action-groupee').selectOption('mark_unread')
	await page.getByTestId('inbox-action-continuer').click()
	const confirmation = page.getByTestId('inbox-confirmation-groupee')
	await expect(confirmation).toContainText('Marquer comme non lus 2 fils')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'confirmation-groupee', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler' }).click()

	// 2. La liste à vérifier des contacts, sur la seule conversation de Nora — annulée.
	await ligneDe('Candidature spontanée').getByTestId('inbox-case-fil').uncheck()
	await page.getByTestId('inbox-action-groupee').selectOption('contacts')
	await page.getByTestId('inbox-action-continuer').click()
	const verification = page.getByTestId('inbox-contacts-verifier')
	await expect(verification.getByTestId('inbox-contact-organisation')).toHaveValue('Atelier Lumen')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'creer-des-contacts', cibles: [verification] })
	await verification.getByRole('button', { name: 'Annuler' }).click()
	await page.getByTestId('inbox-deselectionner').click()

	// 3. Le transfert déjà fait par le seed, et le bloc « Transférer » ouvert — annulé.
	await page.getByTestId('inbox-transferer').click()
	const bloc = page.getByTestId('inbox-transfert-bloc')
	await expect(bloc.getByTestId('inbox-transfert-membre')).toBeEnabled()
	await expect(page.getByTestId('inbox-transferts')).toContainText('Transféré à Driss Lemoine par Camille Aubert')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'transferer-un-message',
		cibles: [page.getByTestId('inbox-transferts'), bloc],
	})
	await bloc.getByRole('button', { name: 'Annuler' }).click()

	// 4. Le filtre sur l'expéditeur de « Point d'avancement — migration ERP », puis la première confirmation du blocage — annulée.
	const [leo] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-inbox-suggere@sogexia.example>')}`,
	)
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${leo!.id}`)
	await page.getByTestId('inbox-filtrer-expediteur').click()
	const filtre = page.getByTestId('inbox-filtre-expediteur')
	await expect(filtre).toContainText('leo.marchand@sogexia.example')
	await illustrer(page, { chapitre: CHAPITRE, section: LIRE, nom: 'filtre-expediteur', cibles: [filtre, liste(page).getByTestId('inbox-message').first()] })
	await page.getByTestId('inbox-bloquer-expediteur').click()
	const blocage = page.getByTestId('inbox-blocage')
	await expect(page.getByTestId('inbox-blocage-impact')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'bloquer-un-expediteur',
		cibles: [page.getByTestId('inbox-bloquer-expediteur'), blocage],
	})
	await blocage.getByRole('button', { name: 'Annuler' }).click()
	await page.getByTestId('inbox-filtre-expediteur-retirer').click()

	// 5. Réglages ▸ Expéditeurs bloqués : l'adresse bloquée par le seed.
	await page.goto('/p2enjoy/reglages/expediteurs-bloques')
	const ecran = page.getByTestId('reglages-expediteurs-bloques')
	await expect(ecran.getByTestId('ligne-expediteur-bloque').filter({ hasText: 'offres@promo-flash.example' })).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-expediteurs-bloques',
		nom: 'expediteurs-bloques',
		cibles: [ecran.getByTestId('ligne-expediteur-bloque').first()],
	})
})

// `CRM-166` T3 : l'assistant de l'inbox — la bulle et le plan proposé, sur la conversation « Candidature spontanée » du seed. Le serveur du modèle n'est jamais
// appelé : l'en-tête du simulateur local choisit le scénario (docs/SPEC-ia.md §11.6, §17.9). RIEN N'EST APPLIQUÉ : le plan est montré, puis le panneau est fermé.
test("l'assistant IA de l'inbox : la bulle, la demande et le plan proposé (CRM-166)", async ({ page, request }) => {
	await page.route('**/functions/v1/ia/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': 'inbox' } }))
	const [nora] = await lireService<{ id: string }[]>(
		request,
		`mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent('<seed-inbox-inconnu@atelier-lumen.example>')}`,
	)
	// Le panneau et son plan tiennent dans la fenêtre : « Tout accepter », en pied, paraît sur l'image.
	await page.setViewportSize({ width: 1440, height: 1200 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${nora!.id}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText('Nora Nouveau')
	await liste(page)
		.locator('li')
		.filter({ has: page.getByTestId('inbox-message').filter({ hasText: 'Candidature spontanée' }) })
		.getByTestId('inbox-case-fil')
		.check()
	await page.getByTestId('assistant-bulle').click()
	await page.getByTestId('assistant-demande').fill('Marque lu et supprime partout')
	await page.getByTestId('assistant-envoyer').click()
	await expect(page.getByTestId('assistant-fil')).toHaveCount(1)
	await expect(page.getByTestId('assistant-fil')).toContainText('irréversible')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: LIRE,
		nom: 'assistant-ia',
		cibles: [page.getByTestId('assistant-panneau'), page.getByTestId('assistant-bulle')],
	})
	await page.keyboard.press('Escape')
	await expect(page.getByTestId('assistant-panneau')).toHaveCount(0)
})

test('le transfert reçu, dans la cloche de Driss (CRM-156)', async ({ page }) => {
	// L'image du chapitre 5 est produite ici, avec les données du §49 : le transfert est un fait de l'inbox.
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/')
	await page.getByTestId('cloche-notifications').click()
	const ligne = page.getByTestId('panneau-notifications').getByTestId('notification').filter({ hasText: 'vous a transféré 1 mail' })
	await expect(ligne).toContainText("Demande d'information — formation IA")
	await illustrer(page, {
		chapitre: 'vos-notifications-savoir-qu-on-vous-a-nomme',
		section: 'ce-que-le-panneau-montre',
		nom: 'transfert-de-mail',
		cibles: [ligne],
	})
})

// `CRM-157` T2 : le formulaire d'envoi dans un espace sans domaine, monté pour l'image puis retiré — le seed garde son
// espace unique (docs/SPEC-mail-subsystem.md §33.6). Rien n'est envoyé : « Mettre en file » est éteint.
test('envoyer depuis un espace sans domaine : l’avertissement, « Mettre en file » éteint', async ({ page, request }) => {
	const montage = await monterEspaceSansDomaine(request)
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/p2enjoy/tracks/${montage.slugTrack}/${montage.slugChannel}/cards/${montage.idAffaire}`)
		await page.getByTestId('envoi-ouvrir').click()
		const note = page.getByTestId('envoi-domaine-absent')
		await expect(note).toBeVisible()
		await expect(page.getByTestId('envoi-valider')).toBeDisabled()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: ECRIRE,
			nom: 'envoi-sans-domaine',
			cibles: [note, page.getByTestId('envoi-valider')],
		})
	} finally {
		await demonterEspaceSansDomaine(request)
	}
})
