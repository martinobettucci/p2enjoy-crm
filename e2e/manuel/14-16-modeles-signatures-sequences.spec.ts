// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images des chapitres 14, 15 et 16 — les modèles d'emails, la
//       signature d'une identité, les séquences de relance
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 14, 15, 16 ; docs/SPEC-modeles-emails.md (les
//       modèles, la prévisualisation, les séquences, l'armement §13.8)
//
// Les modèles, les identités et la séquence « Relance en trois temps » sont ceux du seed. Rien n'est enregistré ni
// supprimé : les confirmations sont montrées puis annulées. La relance armée sur « Refonte intranet Ville de Lyon »
// (affaire figée du seed) est interrompue aussitôt, et ses inscriptions retirées, comme `e2e/ui/armement-sequence.spec.ts`
// le fait — une inscription active ferait partir de vrais messages.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, connecterAvecLeLabs, service } from './outils'

const MODELES = 'ecrire-des-modeles-d-emails-et-les-previsualiser'
const SIGNATURES = 'signer-les-messages-expedies-depuis-une-identite'
const SEQUENCES = 'enchainer-des-relances-les-sequences'
const AFFAIRE_FIGEE = { id: '5eed0000-0000-4000-8000-0000000000c4', adresse: '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4' }

test('les modèles d’emails : la liste, la création, la prévisualisation, la suppression', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/modeles-emails')
	await expect(page.getByTestId('ligne-modele-email').first()).toBeVisible()
	await illustrer(page, { chapitre: MODELES, section: null, nom: 'modeles-d-emails', cibles: [], pleinePage: true })
	// Le bouton cède la place au formulaire : l'image pleine page de l'introduction le montre.
	await page.getByRole('button', { name: 'Nouveau modèle' }).click()
	await expect(page.getByTestId('champ-nom-modele')).toBeVisible()
	await illustrer(page, { chapitre: MODELES, section: 'ecrire-un-modele', nom: 'nouveau-modele', cibles: [page.getByTestId('champ-nom-modele'), page.getByTestId('champ-corps-modele'), page.getByTestId('valider-modele-email')] })
	await page.getByTestId('annuler-modele-email').click()

	// `ouvrir-modele` est « Nouveau modèle » : un modèle existant se prévisualise depuis sa ligne.
	await page.getByTestId('previsualiser-modele').first().click()
	const previsualisation = page.getByTestId('previsualisation-modele')
	await page.getByTestId('champ-affaire-previsualisation').selectOption({ index: 1 })
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-objet')).toBeVisible()
	// Le panneau rendu dépasse la fenêtre de 900 px : elle est agrandie le temps de cette image (comme au chapitre 9).
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: MODELES, section: 'previsualiser-un-modele-sur-une-affaire-reelle', nom: 'previsualisation', cibles: [previsualisation] })
	await page.setViewportSize({ width: 1440, height: 900 })

	await page.getByTestId('fermer-previsualisation').click()
	// La suppression est dans la fiche du modèle, ouverte par « Modifier ».
	await page.getByTestId('modifier-modele').first().click()
	await page.getByTestId('supprimer-modele-email').click()
	const confirmation = page.getByTestId('confirmation-suppression-modele')
	await expect(confirmation).toBeVisible()
	await illustrer(page, { chapitre: MODELES, section: 'supprimer-un-modele', nom: 'supprimer', cibles: [confirmation] })
	await page.getByTestId('annuler-suppression-modele').click()

	// Ce qui n'est pas encore offert : le formulaire « Écrire un message » d'une affaire ne part pas d'un modèle.
	await page.goto(AFFAIRE_SOGEXIA)
	await illustrer(page, { chapitre: MODELES, section: 'ce-qui-n-est-pas-encore-offert', nom: 'ecrire-un-message', cibles: [page.getByTestId('envoi-ouvrir')] })
})

test('la signature d’une identité', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/identites-mail')
	await expect(page.getByTestId('ligne-identite-mail').first()).toBeVisible()
	await illustrer(page, { chapitre: SIGNATURES, section: null, nom: 'identites-d-expedition', cibles: [page.getByRole('heading', { level: 1 }), page.getByTestId('configurer-identite').first()] })
	// La pastille « Signature » d'une ligne de la liste, avant que le formulaire ne s'ouvre.
	const ligne = page.getByTestId('ligne-identite-mail').filter({ hasText: 'Signature' }).first()
	await illustrer(page, { chapitre: SIGNATURES, section: 'ou-la-signature-apparait-dans-le-message', nom: 'signature', cibles: [ligne] })
	const configurer = ligne.getByTestId('configurer-identite')
	await illustrer(page, { chapitre: SIGNATURES, section: 'ecrire-modifier-supprimer-une-signature', nom: 'configurer', cibles: [configurer] })
	await configurer.click()
	const signature = page.getByTestId('champ-signature-identite')
	await expect(signature).toBeVisible()
	await illustrer(page, {
		chapitre: SIGNATURES,
		section: 'ecrire-modifier-supprimer-une-signature',
		nom: 'champ-signature',
		// Le formulaire entier : deux cibles éloignées font défiler la page entre leurs deux mesures.
		cibles: [page.getByTestId('formulaire-identite-mail')],
	})
})

test('les séquences : la liste, une nouvelle, les paliers', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/sequences-relance')
	await expect(page.getByTestId('ligne-sequence').first()).toBeVisible()
	await illustrer(page, { chapitre: SEQUENCES, section: null, nom: 'sequences', cibles: [], pleinePage: true })
	// Le bouton cède la place au formulaire : l'image pleine page de l'introduction le montre.
	await page.getByRole('button', { name: 'Nouvelle séquence' }).click()
	const differes = page.getByTestId('paliers-differes')
	await expect(differes).toBeVisible()
	await illustrer(page, { chapitre: SEQUENCES, section: 'ecrire-une-cadence', nom: 'nouvelle-sequence', cibles: [page.getByTestId('champ-nom-sequence'), differes] })
	await page.keyboard.press('Escape')

	await page.goto('/reglages/sequences-relance')
	// `ouvrir-sequence` est « Nouvelle séquence » : une séquence existante s'ouvre par « Modifier ».
	await page.getByTestId('modifier-sequence').first().click()
	const fiche = page.getByTestId('fiche-sequence')
	await expect(fiche.getByTestId('ligne-palier').first()).toBeVisible()
	await illustrer(page, { chapitre: SEQUENCES, section: 'ecrire-une-cadence', nom: 'ajouter-le-palier', cibles: [page.getByTestId('ajouter-palier')] })
	await illustrer(page, { chapitre: SEQUENCES, section: 'changer-l-ordre-des-paliers', nom: 'paliers', cibles: [fiche.getByTestId('ligne-palier').first(), fiche.getByTestId('ligne-palier').last()] })
})

test('armer puis interrompre une relance sur une affaire figée', async ({ page, request }) => {
	// Armer n'écrit rien dans le fil (migration 0119) ; un tic du planificateur entre l'armement et l'interruption
	// mettrait pourtant un premier palier en file : il est retiré avec l'inscription.
	const debut = new Date().toISOString()
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(AFFAIRE_FIGEE.adresse)
		const bloc = page.getByTestId('bloc-sequence-card')
		await expect(bloc).toBeVisible()
		await illustrer(page, { chapitre: SEQUENCES, section: null, nom: 'relance-automatique', cibles: [bloc] })
		await bloc.getByTestId('champ-sequence').selectOption({ label: 'Relance en trois temps' })
		await bloc.getByTestId('champ-identite-sequence').selectOption({ index: 1 })
		await illustrer(page, { chapitre: SEQUENCES, section: 'armer-une-relance-sur-une-affaire', nom: 'armer', cibles: [bloc] })
		await bloc.getByTestId('armer-sequence').click()
		await expect(bloc.getByTestId('sequence-active')).toBeVisible()
		await illustrer(page, { chapitre: SEQUENCES, section: 'armer-une-relance-sur-une-affaire', nom: 'relance-armee', cibles: [bloc] })
		await bloc.getByTestId('interrompre-sequence').click()
		await expect(bloc.getByTestId('sequence-vide')).toBeVisible()
	} finally {
		await service(request, 'delete', `card_sequence_enrollments?card_id=eq.${AFFAIRE_FIGEE.id}`)
		await service(request, 'delete', `mail_outbox?card_id=eq.${AFFAIRE_FIGEE.id}&created_at=gte.${encodeURIComponent(debut)}`)
	}
})
