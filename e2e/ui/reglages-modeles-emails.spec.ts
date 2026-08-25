// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
// @verifies docs/SPEC-modeles-emails.md §9.1 (la place de l'écran dans l'index des réglages),
//           §9.3 (la palette et l'insertion d'un trou), §9.4 (la liste), §9.5 (les trois
//           sélecteurs sans présélection), §9.6 (ce que `variables_nulles` rend), §9.7 (la
//           confirmation de suppression), §9.8 (le refus est une phrase du produit)
// @verifies docs/DESIGN_SYSTEM.md §5.39 (cette surface), §7 (paliers) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écran est atteint depuis l'index des réglages, jamais par une
// navigation directe — sauf dans les scénarios qui ne mesurent pas la navigation.
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU — leçon d'INC-061. Les scénarios qui écrivent créent des
// modèles PRÉFIXÉS, qu'ils retirent par le véritable chemin d'écriture et avec le jeton réel de
// l'administratrice ; le compte des modèles du seed est relu à la fin de chacun.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-063'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Les deux modèles du seed (`docs/SPEC-seed.md` §14) — des littéraux stables. */
const MODELE_RELANCE = 'Relance sans réponse'
const MODELE_CONTACT = 'Prise de contact'
const MODELES_DU_SEED = 2

/**
 * L'affaire du seed qui porte À LA FOIS un montant, une étape et un contact rattaché.
 *
 * C'est celle que la sous-tranche 2a a mesurée (`0054`), et c'est elle qui rend le rendu observable
 * sans fabriquer de donnée.
 */
const AFFAIRE_SOGEXIA = 'Migration ERP Sogexia'
const CONTACT_SOGEXIA = 'Léo Marchand'

/** Le préfixe des modèles que cette suite crée : le nettoyage ne peut pas emporter le seed. */
const PREFIXE = 'preuve-ui-0063'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Retire les modèles créés par cette suite, et CONSTATE que le seed est intact.
 *
 * Le nettoyage passe par le jeton réel de l'administratrice, jamais par la clé de service : c'est
 * le chemin que l'écran emprunte, et l'employer ici prouve au passage que la politique de
 * suppression consent bien à ce profil.
 */
async function rendreLeSeedIntact(page: Page): Promise<void> {
	const jeton = await jetonDe(ADMIN)
	await page.request.delete(`${URL_API}/rest/v1/mail_templates?name=like.${PREFIXE}*`, {
		headers: enTetesAuthentifies(jeton),
	})
	const restants = await page.request.get(
		`${URL_API}/rest/v1/mail_templates?select=id&workspace_id=eq.${WORKSPACE}`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(
		((await restants.json()) as unknown[]).length,
		'le seed doit être rendu tel qu’il a été reçu',
	).toBe(MODELES_DU_SEED)
}

test.describe('administration des modèles d’emails (docs/SPEC-modeles-emails.md §9)', () => {
	test('l’administratrice atteint l’écran depuis les réglages et voit les deux modèles', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')

		// L'entrée vit APRÈS « Identités d'expédition » et AVANT « État de la messagerie » (§9.1) :
		// on déclare l'expéditeur avant d'écrire le texte qu'il expédiera, et on configure avant de
		// superviser. L'ordre est une règle, il se vérifie.
		const libelles = await page.getByRole('link').allInnerTexts()
		const rangIdentites = libelles.findIndex((libelle) => libelle.includes('Identités d’expédition'))
		const rangModeles = libelles.findIndex((libelle) => libelle.includes('Modèles d’emails'))
		const rangEtat = libelles.findIndex((libelle) => libelle.includes('État de la messagerie'))
		expect(rangModeles).toBeGreaterThanOrEqual(0)
		expect(rangIdentites).toBeLessThan(rangModeles)
		expect(rangModeles).toBeLessThan(rangEtat)

		await page.getByRole('link', { name: 'Modèles d’emails' }).click()
		await expect(page).toHaveURL(/\/reglages\/modeles-emails$/)
		await expect(page.getByRole('heading', { name: 'Modèles d’emails' })).toBeVisible()

		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(MODELES_DU_SEED)
		// LE NOM EST EN TÊTE, ET C'EST LA CLÉ (§9.4).
		await expect(page.getByTestId('nom-modele').first()).toHaveText(MODELE_CONTACT)
		// L'OBJET SE REND AVEC SES VARIABLES TELLES QUELLES : la liste n'est PAS une
		// prévisualisation, et substituer y supposerait une affaire qu'elle n'a pas (§5.39).
		await expect(
			page.getByTestId('objet-modele').filter({ hasText: '{{card.title}}' }),
		).toBeVisible()

		// La fiche est REPLIÉE par défaut (§5.39, §5.23), et aucune prévisualisation n'est ouverte.
		await expect(page.getByTestId('fiche-modele-email')).toHaveCount(0)
		await expect(page.getByTestId('previsualisation-modele')).toHaveCount(0)

		await capturer(page, 'modeles-emails-liste-1440', UNITE)
	})

	test('elle crée un modèle en INSÉRANT une variable de la palette, et la liste est relue', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')

		await page.getByTestId('ouvrir-modele').click()
		const fiche = page.getByTestId('fiche-modele-email')
		await expect(fiche).toBeVisible()
		// LE FOCUS ENTRE DANS LE PREMIER CHAMP (§5.13).
		await expect(page.getByTestId('champ-nom-modele')).toBeFocused()

		await page.keyboard.type(`${PREFIXE}-palette`)
		await page.getByTestId('champ-objet-modele').click()
		await page.keyboard.type('Au sujet de ')

		// LA PALETTE VIENT DE LA BASE (§9.3) : douze boutons, et la liste n'est jamais recopiée dans
		// l'écran. Le compte se vérifie, parce que c'est lui qui dirait qu'une variable a disparu.
		await expect(page.getByTestId('inserer-variable')).toHaveCount(12)

		// L'INSERTION SE FAIT DANS LE DERNIER CHAMP VISITÉ, à la position du curseur — ici l'objet,
		// que l'on vient de quitter pour cliquer sur la palette.
		await page.getByTestId('inserer-variable').filter({ hasText: '{{card.title}}' }).click()
		await expect(page.getByTestId('champ-objet-modele')).toHaveValue('Au sujet de {{card.title}}')

		await page.getByTestId('champ-corps-modele').click()
		await page.keyboard.type('Bonjour ')
		await page
			.getByTestId('inserer-variable')
			.filter({ hasText: '{{contact.full_name}}' })
			.click()
		await expect(page.getByTestId('champ-corps-modele')).toHaveValue(
			'Bonjour {{contact.full_name}}',
		)

		// LA CAPTURE EST PRISE ICI, FICHE OUVERTE, et c'est un défaut trouvé en regardant une capture
		// (`CLAUDE.md` §16, 2026-08-25) : prise après la validation, `modeles-emails-fiche-1440.jpg`
		// montrait la LISTE — la fiche venant de se refermer — sous un nom qui annonçait la fiche.
		// Une capture dont le nom ne décrit pas ce qu'elle montre est pire qu'absente : elle se relit
		// comme une preuve de ce qu'elle ne porte pas.
		await capturer(page, 'modeles-emails-fiche-1440', UNITE)

		await page.getByTestId('valider-modele-email').click()

		// LA LISTE EST RELUE, jamais complétée localement : c'est la relecture qui rend le nom tel
		// que `app.btrim_blancs` l'a normalisé.
		await expect(page.getByTestId('fiche-modele-email')).toHaveCount(0)
		await expect(
			page.getByTestId('nom-modele').filter({ hasText: `${PREFIXE}-palette` }),
		).toBeVisible()
		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(MODELES_DU_SEED + 1)

		await capturer(page, 'modeles-emails-liste-apres-creation-1440', UNITE)
		await rendreLeSeedIntact(page)
	})

	test('une variable INCONNUE est refusée par la base, et l’écran nomme le champ fautif', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')

		await page.getByTestId('ouvrir-modele').click()
		await page.keyboard.type(`${PREFIXE}-variable-inconnue`)
		await page.getByTestId('champ-objet-modele').click()
		// LA FAUTE DE FRAPPE DU §2.5 d — `titel` pour `title`. Le champ n'est pas gardé : rien
		// n'empêche de la taper, et c'est la base qui tranche (§5.3 ter).
		await page.keyboard.type('Où en est {{card.titel}} ?')
		await page.getByTestId('champ-corps-modele').click()
		await page.keyboard.type('Bonjour,')

		await page.getByTestId('valider-modele-email').click()

		// LE REFUS EST UNE PHRASE DU PRODUIT, `role="alert"`, et il NOMME LE CHAMP — c'est pour cela
		// que la migration `0055` pose deux contraintes plutôt qu'une (§2.3). Aucune phrase du
		// serveur n'atteint l'écran : le champ `details` d'un refus de contrainte porte la ligne
		// fautive ENTIÈRE (§9.8).
		const refus = page.getByTestId('refus-modele-email')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText('L’objet emploie une variable qui n’existe pas')
		await expect(refus).not.toContainText('constraint')
		await expect(refus).not.toContainText('mail_templates')

		// LE REFUS N'EFFACE PAS LA SAISIE et laisse la fiche ouverte (§5.7 ter, §9.8).
		await expect(page.getByTestId('champ-objet-modele')).toHaveValue('Où en est {{card.titel}} ?')
		await expect(page.getByTestId('fiche-modele-email')).toBeVisible()

		// LE REFUS DE CONTRAINTE ARRIVE EN `400`, que la console du navigateur journalise. Il est
		// ATTENDU : c'est le refus que ce scénario mesure, et non une panne. Le bilan se solde ICI,
		// après l'action — la fonction est une ASSERTION d'égalité, et non une autorisation posée
		// d'avance : appelée avant, elle constaterait un tableau vide et ne prouverait rien.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

		await capturer(page, 'modeles-emails-refus-1440', UNITE)
		await rendreLeSeedIntact(page)
	})

	test('elle prévisualise un modèle sur une affaire réelle, et les trous vides sont NOMMÉS', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')

		await page
			.getByTestId('ligne-modele-email')
			.filter({ hasText: MODELE_RELANCE })
			.getByTestId('previsualiser-modele')
			.click()

		const panneau = page.getByTestId('previsualisation-modele')
		await expect(panneau).toBeVisible()

		// AUCUN DES TROIS SÉLECTEURS NE PRÉSÉLECTIONNE (§9.5), y compris celui de l'affaire, qui est
		// pourtant obligatoire : présélectionner la première affaire du tri ferait rendre un texte au
		// sujet d'une affaire que personne n'a désignée.
		await expect(page.getByTestId('champ-affaire-previsualisation')).toHaveValue('')
		await expect(page.getByTestId('champ-contact-previsualisation')).toHaveValue('')
		await expect(page.getByTestId('champ-identite-previsualisation')).toHaveValue('')
		await expect(page.getByTestId('previsualisation-inactive')).toBeVisible()

		// UN RENDU SANS AFFAIRE N'EST PAS UNE ERREUR : la fonction rend zéro ligne, et l'écran le dit
		// dans la MÊME phrase que pour une affaire masquée (§9.6).
		await page.getByTestId('lancer-previsualisation').click()
		await expect(page.getByTestId('previsualisation-vide')).toBeVisible()

		await page
			.getByTestId('champ-affaire-previsualisation')
			.selectOption({ label: AFFAIRE_SOGEXIA })
		await page
			.getByTestId('champ-contact-previsualisation')
			.selectOption({ label: `${CONTACT_SOGEXIA} — leo.marchand@sogexia.example` })
		await page.getByTestId('lancer-previsualisation').click()

		// L'OBJET ET LE CORPS SONT SUBSTITUÉS PAR LA BASE, et l'écran les rend tels quels.
		await expect(page.getByTestId('rendu-objet')).toHaveText(`Où en est ${AFFAIRE_SOGEXIA} ?`)
		await expect(page.getByTestId('rendu-corps')).toContainText(`Bonjour ${CONTACT_SOGEXIA},`)
		// LE FORMATAGE DU §8.6, mesuré : ni séparateur de milliers, ni symbole de devise.
		await expect(page.getByTestId('rendu-corps')).toContainText('125000.00 EUR')

		// `variables_nulles` EST UN `role="status"` ET NON UN `role="alert"` : la prévisualisation a
		// RÉUSSI (§9.6).
		//
		// L'ATTENDU EST UNE MESURE, ET LA PREMIÈRE ÉCRITURE DE CETTE ASSERTION ÉTAIT FAUSSE. Elle
		// annonçait DEUX trous, en supposant que le modèle citait les deux variables d'identité.
		// MESURÉ : « Relance sans réponse » ne cite que `{{identity.from_name}}`, et
		// `{{identity.from_address}}` n'y figure pas. Une variable que le modèle N'EMPLOIE PAS n'est
		// pas un trou, et l'y faire figurer donnerait à lire une liste d'absences sans objet (§8.4).
		// C'est précisément la règle que cette assertion fige, et c'est elle qui a corrigé l'écriture.
		const bloc = page.getByTestId('variables-nulles')
		await expect(bloc).toBeVisible()
		await expect(bloc).toHaveAttribute('role', 'status')
		// LE COMPTE EST EN TOUTES LETTRES, dans son PROPRE élément, et accordé PAR CLÉ (§9.6) : le
		// SINGULIER est éprouvé ici, le PLURIEL juste après. « les 1 variables » serait faux (§10).
		await expect(page.getByTestId('variables-nulles-compte')).toHaveText('1 variable sans valeur')
		await expect(page.getByTestId('variable-nulle')).toHaveCount(1)
		// LE NOM EST RENDU DANS LA GRAPHIE EXACTE que le rédacteur a tapée : c'est la chaîne qu'il
		// ira chercher dans son texte, et la traduire l'obligerait à la retraduire.
		await expect(
			page.getByTestId('variable-nulle').filter({ hasText: '{{identity.from_name}}' }),
		).toBeVisible()
		// UNE VARIABLE PLEINE N'EST JAMAIS LISTÉE : `contact.full_name` est rendue plus haut, et elle
		// ne figure PAS parmi les trous.
		await expect(
			page.getByTestId('variable-nulle').filter({ hasText: '{{contact.full_name}}' }),
		).toHaveCount(0)

		await capturer(page, 'modeles-emails-previsualisation-1440', UNITE)

		// LE MÊME RENDU SANS CONTACT REND DEUX TROUS, et c'est la preuve INVERSE de la précédente :
		// si `contact.full_name` apparaît quand le contact est retiré, c'est bien qu'elle était
		// PLEINE — et non ignorée — lorsqu'il était choisi. Le pluriel de l'accord y est éprouvé.
		//
		// CHOISIR UNE IDENTITÉ NE REFERMERAIT PAS LE TROU RESTANT, et c'est une MESURE du seed : les
		// DEUX identités portent un `from_name` nul (§8.8 ligne 14). Le jeu de démonstration porte
		// réellement ce trou, ce qui rend la règle du §8.4 observable sans fabriquer de donnée.
		await page.getByTestId('champ-contact-previsualisation').selectOption('')
		await page.getByTestId('lancer-previsualisation').click()
		await expect(page.getByTestId('variables-nulles-compte')).toHaveText('2 variables sans valeur')
		await expect(
			page.getByTestId('variable-nulle').filter({ hasText: '{{contact.full_name}}' }),
		).toBeVisible()
	})

	test('elle supprime un modèle derrière une confirmation qui le NOMME', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')

		// Le modèle supprimé est créé par cette preuve : supprimer un modèle du seed le priverait de
		// ce qu'il doit démontrer.
		await page.getByTestId('ouvrir-modele').click()
		await page.keyboard.type(`${PREFIXE}-a-supprimer`)
		await page.getByTestId('champ-objet-modele').click()
		await page.keyboard.type('Objet sans variable')
		await page.getByTestId('champ-corps-modele').click()
		await page.keyboard.type('Corps sans variable.')
		await page.getByTestId('valider-modele-email').click()
		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(MODELES_DU_SEED + 1)

		// LA SUPPRESSION VIT DANS LA FICHE, ET NON SUR LA LIGNE (§9.4) : un geste destructeur ne se
		// déclenche pas depuis une liste qu'on balaye.
		await expect(page.getByTestId('supprimer-modele-email')).toHaveCount(0)
		await page
			.getByTestId('ligne-modele-email')
			.filter({ hasText: `${PREFIXE}-a-supprimer` })
			.getByTestId('modifier-modele')
			.click()
		await page.getByTestId('supprimer-modele-email').click()

		// LA CONFIRMATION NOMME LE MODÈLE ET N'ANNONCE AUCUNE CASCADE (§9.7) : rien, dans la base,
		// ne référence un modèle aujourd'hui, et promettre une rupture de séquence décrirait un objet
		// que la tranche 4 n'a pas posé.
		const confirmation = page.getByTestId('confirmation-suppression-modele')
		await expect(confirmation).toBeVisible()
		await expect(confirmation).toContainText(`Supprimer « ${PREFIXE}-a-supprimer » ?`)
		await expect(confirmation).toContainText('Le texte du modèle est définitivement perdu.')
		await expect(confirmation).not.toContainText('séquence')
		// LE FOCUS ENTRE SUR LE BOUTON D'ACTION — patron du §5.29.
		await expect(page.getByTestId('confirmer-suppression-modele')).toBeFocused()

		await capturer(page, 'modeles-emails-confirmation-1440', UNITE)

		// ANNULER NE SUPPRIME RIEN, et rend le focus à la commande qui a ouvert (§5.29).
		await page.getByTestId('annuler-suppression-modele').click()
		await expect(confirmation).toHaveCount(0)
		await expect(page.getByTestId('supprimer-modele-email')).toBeFocused()

		await page.getByTestId('supprimer-modele-email').click()
		await page.getByTestId('confirmer-suppression-modele').click()

		await expect(page.getByTestId('fiche-modele-email')).toHaveCount(0)
		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(MODELES_DU_SEED)
		await rendreLeSeedIntact(page)
	})

	test('la lectrice LIT les modèles, et son écriture est refusée SANS erreur', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/modeles-emails')

		// La lectrice LIT : tout membre du workspace lit (§2.6).
		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(MODELES_DU_SEED)

		// AUCUNE COMMANDE N'EST ÉTEINTE SELON LE RÔLE (§5.3, §5.13, §5.21, §5.27, sans exception) :
		// l'écran ne calcule aucun droit, et c'est la base qui refuse.
		await expect(page.getByTestId('previsualiser-modele').first()).toBeEnabled()
		await expect(page.getByTestId('modifier-modele').first()).toBeEnabled()

		await page
			.getByTestId('ligne-modele-email')
			.filter({ hasText: MODELE_RELANCE })
			.getByTestId('modifier-modele')
			.click()
		await page.getByTestId('champ-objet-modele').click()
		await page.keyboard.type(' modifié par la lectrice')
		await page.getByTestId('valider-modele-email').click()

		// LE SILENCE DE LA CLAUSE `using` SE DIT EN TOUTES LETTRES : la lectrice reçoit `200` et
		// ZÉRO LIGNE — la base ne lève AUCUNE erreur (§2.7 ligne 7). L'écran n'annonce jamais un
		// enregistrement qui n'a pas eu lieu.
		const refus = page.getByTestId('refus-modele-email')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText('Aucun modèle n’a été enregistré')

		await capturer(page, 'modeles-emails-lectrice-1440', UNITE)

		// LA LIGNE EST RELUE ET CONSTATÉE INCHANGÉE — la preuve du refus, et non sa promesse.
		await page.getByTestId('annuler-modele-email').click()
		await expect(
			page.getByTestId('objet-modele').filter({ hasText: 'modifié par la lectrice' }),
		).toHaveCount(0)
	})

})

// LE PALIER EST POSÉ AVANT LA CONNEXION, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE
// (`CLAUDE.md` §16, 2026-08-25). La première écriture chargeait l'écran à la taille par défaut puis
// RÉDUISAIT la fenêtre : la barre latérale, déployée au chargement, devenait un tiroir en restant
// OUVERTE, et `modeles-emails-sm-390.jpg` montrait l'écran à moitié recouvert par ce tiroir. Ce
// n'était pas l'état qu'un utilisateur arrivant à 390 px rencontre, et une capture qui ne
// représente pas l'état réellement exécuté ne prouve rien (`CLAUDE.md` §16). Le palier est donc posé
// AVANT, comme la suite jumelle du §5.35 le fait déjà, et chaque palier est un test à part entière.
for (const palier of PALIERS) {
	test(`${palier.nom} : la liste, la fiche et la prévisualisation restent lisibles`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')
		await expect(page.getByTestId('liste-modeles-emails')).toBeVisible()

		// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT (§7) : c'est la règle que le §5.34 a déjà
		// éprouvée sur sa liste, et sa borne `104ch` est reprise ici pour le même motif.
		const listeDeborde = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(listeDeborde, `débordement horizontal de la liste au palier ${palier.nom}`).toBe(false)

		// LA FICHE PORTE LA PALETTE, dont les douze boutons sont ce qui replie le plus au palier
		// étroit : la capture doit la montrer, sans quoi le palier ne prouverait que la liste.
		await page.getByTestId('modifier-modele').first().click()
		await expect(page.getByTestId('fiche-modele-email')).toBeVisible()
		const ficheDeborde = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(ficheDeborde, `débordement horizontal de la fiche au palier ${palier.nom}`).toBe(false)

		await capturer(page, `modeles-emails-${palier.nom}`, UNITE)

		// LE SÉLECTEUR D'AFFAIRE TIRE SA LARGEUR DE SA PLUS LONGUE OPTION, et le seed en porte une de
		// 130 caractères : c'est le débordement mesuré au §5.35 sur son propre sélecteur, et la borne
		// `max-w-full` du champ est ce qui l'empêche ici. Il se vérifie plutôt que se supposer.
		await page.getByTestId('annuler-modele-email').click()
		await page.getByTestId('previsualiser-modele').first().click()
		await expect(page.getByTestId('previsualisation-modele')).toBeVisible()
		const previsualisationDeborde = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(
			previsualisationDeborde,
			`débordement horizontal de la prévisualisation au palier ${palier.nom}`,
		).toBe(false)
		await capturer(page, `modeles-emails-previsualisation-${palier.nom}`, UNITE)
	})
}
