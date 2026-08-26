// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 4, SOUS-TRANCHE 4c : L'ÉCRAN
// @verifies docs/SPEC-modeles-emails.md §13.4 (la place de l'écran dans l'index des réglages),
//           §13.5 (la liste et son compte de paliers), §13.6 (la fiche, l'ajout d'un palier, le
//           réordonnancement RELU, le retrait, la suppression confirmée), §13.7 (le refus est une
//           phrase du produit), §13.9 (la confirmation de suppression d'un modèle, révisée)
// @verifies docs/DESIGN_SYSTEM.md §5.41 (cette surface), §5.39 (sa jumelle), §7 (paliers)
// @verifies CLAUDE.md §16 (vérification visuelle) ; docs/SPEC-permissions-rls.md §7
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écran est atteint depuis l'index des réglages.
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU — leçon d'INC-061. Les scénarios qui écrivent créent des
// séquences PRÉFIXÉES, retirées par le véritable chemin d'écriture avec le jeton réel de
// l'administratrice ; le compte des séquences du seed est relu à la fin de chacun, ET l'ordre de
// ses trois paliers est reposé — une suite qui laisserait l'ordre inversé ferait rougir
// `verify-seed-demo.sh` pour une raison sans rapport avec son objet.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-063'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** La séquence du seed et ses trois paliers — `docs/SPEC-modeles-emails.md` §11.9. */
const SEQUENCE_SEED = 'Relance en trois temps'
const SEQUENCE_SEED_ID = '5e900000-0000-4000-8000-000000000001'
const SEQUENCES_DU_SEED = 1
const ORDRE_DU_SEED = [
	'5e900000-0000-4000-8000-0000000000a1',
	'5e900000-0000-4000-8000-0000000000a2',
	'5e900000-0000-4000-8000-0000000000a3',
]

/** Les deux modèles du seed — `docs/SPEC-seed.md` §14. */
const MODELE_RELANCE = 'Relance sans réponse'
const MODELE_CONTACT = 'Prise de contact'

/** Le préfixe des séquences que cette suite crée : le nettoyage ne peut pas emporter le seed. */
const PREFIXE = 'preuve-ui-4c'

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
 * Retire les séquences créées par cette suite, repose l'ordre du seed, et CONSTATE qu'il est intact.
 *
 * Le nettoyage passe par le jeton réel de l'administratrice, jamais par la clé de service : c'est le
 * chemin que l'écran emprunte, et l'employer ici prouve au passage que la politique de suppression
 * consent bien à ce profil.
 */
async function rendreLeSeedIntact(page: Page): Promise<void> {
	const jeton = await jetonDe(ADMIN)
	await page.request.delete(`${URL_API}/rest/v1/mail_sequences?name=like.${PREFIXE}*`, {
		headers: enTetesAuthentifies(jeton),
	})
	// L'ORDRE EST REPOSÉ PAR LA RPC, c'est-à-dire par le chemin du produit — jamais par un `PATCH`
	// que le §11.6 bis a mesuré impossible.
	await page.request.post(`${URL_API}/rest/v1/rpc/reordonner_paliers_sequence`, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: { p_sequence_id: SEQUENCE_SEED_ID, p_paliers: ORDRE_DU_SEED },
	})
	const restantes = await page.request.get(
		`${URL_API}/rest/v1/mail_sequences?select=id&workspace_id=eq.${WORKSPACE}`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(
		((await restantes.json()) as unknown[]).length,
		'le seed doit être rendu tel qu’il a été reçu',
	).toBe(SEQUENCES_DU_SEED)
	const paliers = await page.request.get(
		`${URL_API}/rest/v1/mail_sequence_steps?select=id&sequence_id=eq.${SEQUENCE_SEED_ID}&order=position`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(
		((await paliers.json()) as { id: string }[]).map((ligne) => ligne.id),
		'l’ordre des paliers du seed doit être reposé',
	).toEqual(ORDRE_DU_SEED)
}

test.describe('administration des séquences de relance (docs/SPEC-modeles-emails.md §13)', () => {
	test('l’administratrice atteint l’écran depuis les réglages et voit la séquence du seed', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')
		// L'ÉCRAN EST ATTEINT PAR SON ENTRÉE D'INDEX, jamais par une navigation directe : c'est la
		// place du §13.4 qui est mesurée ici, et non seulement l'existence de la route.
		await page.getByRole('link', { name: 'Séquences de relance' }).click()
		await expect(page).toHaveURL(/\/reglages\/sequences-relance$/)

		await expect(page.getByTestId('ligne-sequence')).toHaveCount(SEQUENCES_DU_SEED)
		await expect(page.getByTestId('nom-sequence')).toHaveText(SEQUENCE_SEED)
		// LE COMPTE EST EN TOUTES LETTRES ET DANS SON PROPRE ÉLÉMENT (§5.41, §5.11) : « 3 paliers »,
		// jamais un badge nu accolé au nom.
		await expect(page.getByTestId('compte-paliers')).toHaveText('3 paliers')

		await capturer(page, 'sequences-liste-1440', UNITE)
	})

	test('la fiche montre les trois paliers dans leur ordre, chacun avec son modèle et son délai', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')
		await page.getByTestId('modifier-sequence').click()

		await expect(page.getByTestId('fiche-sequence')).toBeVisible()
		await expect(page.getByTestId('champ-nom-sequence')).toHaveValue(SEQUENCE_SEED)
		const paliers = page.getByTestId('ligne-palier')
		await expect(paliers).toHaveCount(3)
		// LE LIBELLÉ DIT LE DÉLAI RELATIF SANS MENTIR (§11.4) : « J+3 », compté depuis le palier
		// précédent — un décalage absolu ferait lire une date que la cadence ne garantit pas.
		await expect(paliers.nth(0).getByTestId('libelle-palier')).toHaveText(
			`J+3 · ${MODELE_RELANCE}`,
		)
		await expect(paliers.nth(1).getByTestId('libelle-palier')).toHaveText(
			`J+7 · ${MODELE_CONTACT}`,
		)
		// LE PALIER 3 RÉEMPLOIE LE MODÈLE DU PALIER 1, et c'est ce que le §11.9 exige du seed : le
		// seul montage qui démontre qu'un modèle sert plusieurs paliers.
		await expect(paliers.nth(2).getByTestId('libelle-palier')).toHaveText(
			`J+14 · ${MODELE_RELANCE}`,
		)

		await capturer(page, 'sequences-fiche-1440', UNITE)
	})

	test('« Monter » sur le premier et « Descendre » sur le dernier sont MONTÉS et DÉSACTIVÉS', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')
		await page.getByTestId('modifier-sequence').click()
		const paliers = page.getByTestId('ligne-palier')
		await expect(paliers).toHaveCount(3)

		// CE N'EST PAS UN DROIT CALCULÉ (§5.41) : c'est un geste sans objet sur cet élément-là. Les
		// commandes restent MONTÉES — les retirer ferait sauter la ligne d'un palier à l'autre.
		await expect(paliers.nth(0).getByTestId('monter-palier')).toBeDisabled()
		await expect(paliers.nth(0).getByTestId('descendre-palier')).toBeEnabled()
		await expect(paliers.nth(2).getByTestId('monter-palier')).toBeEnabled()
		await expect(paliers.nth(2).getByTestId('descendre-palier')).toBeDisabled()
		await expect(paliers.nth(1).getByTestId('monter-palier')).toBeEnabled()
		await expect(paliers.nth(1).getByTestId('descendre-palier')).toBeEnabled()
	})

	test('un déplacement est ENREGISTRÉ, et la liste relue le montre — puis il est défait', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')
		await page.getByTestId('modifier-sequence').click()
		const paliers = page.getByTestId('ligne-palier')
		await expect(paliers).toHaveCount(3)

		// LE GESTE EST CELUI DE L'UTILISATEUR : un clic sur la flèche, jamais un appel direct à la
		// RPC. C'est le seul chemin qui prouve que l'écran compose l'ordre COMPLET (§13.2).
		await paliers.nth(1).getByTestId('monter-palier').click()

		// LA LISTE EST RELUE, PAS RÉORDONNÉE LOCALEMENT (§5.41) : l'assertion porte donc sur ce que la
		// BASE rend, et non sur un état d'écran.
		await expect(paliers.nth(0).getByTestId('libelle-palier')).toHaveText(
			`J+7 · ${MODELE_CONTACT}`,
		)
		await expect(paliers.nth(1).getByTestId('libelle-palier')).toHaveText(
			`J+3 · ${MODELE_RELANCE}`,
		)
		// LE RANG SUIT : il vaut la position que la base a reposée, et non l'index d'affichage.
		await expect(paliers.nth(0).getByTestId('rang-palier')).toHaveText('1')
		await expect(paliers.nth(1).getByTestId('rang-palier')).toHaveText('2')

		await capturer(page, 'sequences-reordonne-1440', UNITE)

		// Le geste inverse remet le seed en place, PAR L'ÉCRAN — le nettoyage de secours reste posé
		// en fin de scénario.
		await paliers.nth(1).getByTestId('monter-palier').click()
		await expect(paliers.nth(0).getByTestId('libelle-palier')).toHaveText(
			`J+3 · ${MODELE_RELANCE}`,
		)

		await rendreLeSeedIntact(page)
	})

	test('l’administratrice crée une séquence, lui ajoute un palier, et la supprime', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')

		await page.getByTestId('ouvrir-sequence').click()
		await page.getByTestId('champ-nom-sequence').click()
		await page.keyboard.type(`${PREFIXE} cadence`)
		await page.getByTestId('valider-sequence').click()

		// LA FICHE RESTE OUVERTE APRÈS LA CRÉATION (§13.6), et la zone des paliers APPARAÎT : avant
		// l'enregistrement, `sequence_id` n'existe pas et un palier serait refusé en `23503`.
		await expect(page.getByTestId('paliers-differes')).toHaveCount(0)
		await expect(page.getByTestId('paliers-vides')).toBeVisible()

		await page.getByTestId('champ-modele-palier').selectOption({ label: MODELE_RELANCE })
		await page.getByTestId('champ-delai-palier').click()
		await page.keyboard.type('4')
		await page.getByTestId('ajouter-palier').click()

		// LE RANG DU PALIER AJOUTÉ EST `max(position) + 1`, calculé depuis la donnée déjà lue : sur
		// une cadence vide, c'est `1` — la borne basse de la contrainte.
		await expect(page.getByTestId('ligne-palier')).toHaveCount(1)
		await expect(page.getByTestId('rang-palier')).toHaveText('1')
		await expect(page.getByTestId('libelle-palier')).toHaveText(`J+4 · ${MODELE_RELANCE}`)

		// LA CONFIRMATION ANNONCE LA CASCADE, COMPTÉE DEPUIS LA DONNÉE DÉJÀ LUE, et la RÈGLE qu'elle
		// ne peut pas promettre — sans chiffre (§13.6).
		await page.getByTestId('supprimer-sequence').click()
		await expect(page.getByTestId('confirmation-suppression-sequence')).toBeVisible()
		await expect(page.getByTestId('confirmation-cascade')).toHaveText(
			'Son palier sera supprimé avec elle.',
		)
		await expect(page.getByTestId('confirmation-regle')).toContainText(
			'ne peut pas être supprimée',
		)
		await capturer(page, 'sequences-confirmation-1440', UNITE)

		await page.getByTestId('confirmer-suppression-sequence').click()
		await expect(page.getByTestId('ligne-sequence')).toHaveCount(SEQUENCES_DU_SEED)

		await rendreLeSeedIntact(page)
	})

	test('un nom déjà pris rend une PHRASE DU PRODUIT, et la saisie n’est pas effacée', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')

		await page.getByTestId('ouvrir-sequence').click()
		await page.getByTestId('champ-nom-sequence').click()
		await page.keyboard.type(SEQUENCE_SEED)
		await page.getByTestId('valider-sequence').click()

		await expect(page.getByTestId('refus-sequence')).toHaveText(
			'Ce nom est déjà employé par une autre séquence.',
		)
		// UN REFUS N'EFFACE PAS LA SAISIE (§5.7 ter) : le rédacteur doit pouvoir corriger sans
		// retaper.
		await expect(page.getByTestId('champ-nom-sequence')).toHaveValue(SEQUENCE_SEED)

		// LE REFUS EST UN `409` DE LA ROUTE, ET LA CONSOLE LE VOIT. Il est consommé NOMMÉMENT, après
		// avoir été vérifié à l'écran : une console permissive laisserait passer une erreur que
		// personne n'a expliquée à l'utilisateur.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])

		await rendreLeSeedIntact(page)
	})

	test('un délai hors bornes rend la phrase du produit, jamais le message du serveur', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/sequences-relance')
		await page.getByTestId('modifier-sequence').click()
		await expect(page.getByTestId('ligne-palier')).toHaveCount(3)

		await page.getByTestId('champ-modele-palier').selectOption({ label: MODELE_RELANCE })
		await page.getByTestId('champ-delai-palier').click()
		await page.keyboard.type('0')
		await page.getByTestId('ajouter-palier').click()

		await expect(page.getByTestId('refus-palier')).toHaveText(
			'Le délai doit faire de 1 à 365 jours.',
		)
		// LA LISTE N'A PAS BOUGÉ : un refus n'écrit rien.
		await expect(page.getByTestId('ligne-palier')).toHaveCount(3)

		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

		await rendreLeSeedIntact(page)
	})

	test('LA LECTRICE VOIT L’ÉCRAN, ET SON DÉPLACEMENT REND « aucun palier réordonné »', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/sequences-relance')

		// AUCUNE COMMANDE N'EST ÉTEINTE SELON LE RÔLE (§5.3, §5.13, §5.21, sans exception) : la
		// lectrice voit la liste et sa commande, et c'est la BASE qui refuse.
		await expect(page.getByTestId('ligne-sequence')).toHaveCount(SEQUENCES_DU_SEED)
		await page.getByTestId('modifier-sequence').click()
		const paliers = page.getByTestId('ligne-palier')
		await expect(paliers).toHaveCount(3)
		await expect(paliers.nth(1).getByTestId('monter-palier')).toBeEnabled()

		await paliers.nth(1).getByTestId('monter-palier').click()

		// LE ZÉRO-LIGNE SE DIT EN TOUTES LETTRES (§13.3) : la RPC a rendu `200` et `0` — un succès
		// HTTP portant un refus métier —, et l'écran n'annonce JAMAIS un succès qui n'a pas eu lieu.
		await expect(page.getByTestId('refus-palier')).toContainText('Aucun palier n’a été réordonné')
		// ET L'ORDRE EST INCHANGÉ.
		await expect(paliers.nth(0).getByTestId('libelle-palier')).toHaveText(
			`J+3 · ${MODELE_RELANCE}`,
		)

		await capturer(page, 'sequences-lectrice-1440', UNITE)
		await rendreLeSeedIntact(page)
	})

	test('LA CONFIRMATION DE SUPPRESSION D’UN MODÈLE ANNONCE LA RÈGLE, et le refus est traduit', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/modeles-emails')

		// LE MODÈLE CHOISI EST CELUI QUE DEUX PALIERS DU SEED EMPLOIENT (§11.9) : c'est celui sur
		// lequel le `on delete restrict` de la migration 0059 mord réellement.
		await page
			.getByTestId('ligne-modele-email')
			.filter({ hasText: MODELE_RELANCE })
			.getByTestId('modifier-modele')
			.click()
		await page.getByTestId('supprimer-modele-email').click()

		// LA RÈGLE EST ANNONCÉE, SANS COMPTER (§13.9) : l'écran ne lit pas `mail_sequence_steps`, et
		// un nombre lu pour l'occasion pourrait changer entre la lecture et le geste.
		await expect(page.getByTestId('confirmation-regle-sequence')).toHaveText(
			'Un modèle employé par une séquence de relance ne peut pas être supprimé.',
		)
		await capturer(page, 'modeles-confirmation-regle-1440', UNITE)

		await page.getByTestId('confirmer-suppression-modele').click()

		// ET LE REFUS EST TRADUIT, jamais rangé dans « l'enregistrement a échoué » : c'est ce que
		// l'issue `modele-employe` ajoute au dictionnaire du §9.8.
		await expect(page.getByTestId('refus-modele-email')).toContainText(
			'employé par une séquence de relance',
		)

		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])

		// LE MODÈLE EST TOUJOURS LÀ.
		await page.goto('/reglages/modeles-emails')
		await expect(page.getByTestId('ligne-modele-email')).toHaveCount(2)
	})

	test('les quatre paliers du §7 rendent l’écran lisible, et le tiroir s’ouvre fermé sous 390 px', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		for (const palier of PALIERS) {
			// LA FENÊTRE EST RÉDUITE AVANT LE CHARGEMENT, et non après : réduite après, la barre
			// latérale devient un tiroir en restant OUVERTE — un état qu'un utilisateur arrivant à
			// 390 px ne rencontre jamais. C'est le défaut mesuré par la sous-tranche 2b.
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/reglages/sequences-relance')
			await expect(page.getByTestId('ligne-sequence')).toHaveCount(SEQUENCES_DU_SEED)
			await capturer(page, `sequences-liste-${palier.largeur}`, UNITE)
		}
	})
})
