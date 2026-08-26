// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 4, SOUS-TRANCHE 4c : l'armement depuis l'affaire
// @verifies docs/SPEC-modeles-emails.md §13.8 (où le bloc vit, ses deux états, ses refus traduits,
//           et ce qu'il ne rend PAS), §13.1 question 3 (la mesure qui place le geste ici),
//           §12.4 (les huit refus), §12.7 (les quatre fins), §12.12 (le seed n'arme rien)
// @verifies docs/DESIGN_SYSTEM.md §5.42 (ce bloc), §5.21 (sa place), §7 (paliers)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// TOUTE INSCRIPTION ARMÉE EST REFERMÉE, ET C'EST UNE EXIGENCE DE SÛRETÉ, pas de style. Le §12.12
// l'écrit : une inscription active est exécutée par le job DIX SECONDES après le démarrage de la
// pile, et des messages de relance partiraient réellement chez les adresses du jeu de
// démonstration. C'est la pollution que la décision 516 a payée une fois.
//
// LE BLOC S'OUVRE SUR SON GESTE, ET NON SUR UN ÉTAT : le seed n'arme rien (§13.11), délibérément.
// C'est cette suite qui produit l'autre état, en armant, en mesurant, et en refermant.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-063'
const ADMIN = 'admin@p2enjoy.test'

/**
 * « Refonte intranet Ville de Lyon » — une affaire FIGÉE au sens de `public.cards_figees()`.
 *
 * MESURÉ le 2026-08-26 : elle porte 40 jours dans son étape pour un seuil de 5. C'est celle que la
 * sous-tranche 4b a employée pour ses preuves d'API, et l'employer ici garde une seule affaire de
 * référence pour tout l'armement.
 */
const AFFAIRE_FIGEE = {
	id: '5eed0000-0000-4000-8000-0000000000c4',
	adresse: '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4',
	titre: 'Refonte intranet Ville de Lyon',
}

/**
 * « Refonte du site vitrine » — une affaire que `public.cards_figees()` NE REND PAS.
 *
 * C'est le témoin du refus `card_not_stalled`, et il est nécessaire : sans lui, le refus serait
 * vert sur n'importe quelle affaire, y compris pour une raison qui n'est pas la sienne.
 */
const AFFAIRE_NON_FIGEE = {
	adresse: '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c1',
}

const SEQUENCE_SEED = 'Relance en trois temps'
const IDENTITE_SERVICE = 'Identité de service'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Referme toute inscription active de l'affaire, et CONSTATE qu'il n'en reste aucune.
 *
 * Elle passe par la RPC réelle avec le jeton de l'administratrice — le chemin du produit —, jamais
 * par un `DELETE` : la table n'en expose aucun, une inscription étant une TRACE (§12.10).
 */
async function refermerToutArmement(page: Page): Promise<void> {
	const jeton = await jetonDe(ADMIN)
	const actives = await page.request.get(
		`${URL_API}/rest/v1/card_sequence_enrollments?select=id&card_id=eq.${AFFAIRE_FIGEE.id}&status=eq.active`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	for (const ligne of (await actives.json()) as { id: string }[]) {
		await page.request.post(`${URL_API}/rest/v1/rpc/interrompre_sequence_relance`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { p_enrollment_id: ligne.id },
		})
	}
	const restantes = await page.request.get(
		`${URL_API}/rest/v1/card_sequence_enrollments?select=id&status=eq.active`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(
		((await restantes.json()) as unknown[]).length,
		'aucune inscription ne doit rester ACTIVE : le job en expédierait les paliers',
	).toBe(0)
}

test.afterEach(async ({ page }) => {
	await refermerToutArmement(page)
})

test.describe('armer une relance depuis l’affaire (docs/SPEC-modeles-emails.md §13.8)', () => {
	test('le bloc vit dans la fiche, et s’ouvre sur son geste — aucune relance armée', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(AFFAIRE_FIGEE.adresse)

		const bloc = page.getByTestId('bloc-sequence-card')
		await expect(bloc).toBeVisible()
		// LE SEED N'ARME RIEN (§13.11) : le bloc s'ouvre donc toujours sur son geste.
		await expect(bloc.getByTestId('sequence-vide')).toHaveText(
			'Aucune relance n’est armée sur cette affaire.',
		)
		await expect(bloc.getByTestId('sequence-active')).toHaveCount(0)

		// LES DEUX SÉLECTEURS OUVRENT SUR UNE OPTION VIDE (§5.42) : rien n'est présélectionné.
		await expect(bloc.getByTestId('champ-sequence')).toHaveValue('')
		await expect(bloc.getByTestId('champ-identite-sequence')).toHaveValue('')
		// LA COMMANDE N'EST JAMAIS ÉTEINTE (§5.3 ter, §5.42).
		await expect(bloc.getByTestId('armer-sequence')).toBeEnabled()

		await capturer(page, 'armement-geste-1440', UNITE)
	})

	test('l’administratrice arme une relance, et le bloc rend alors L’ÉTAT de la cadence', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(AFFAIRE_FIGEE.adresse)
		const bloc = page.getByTestId('bloc-sequence-card')
		await expect(bloc.getByTestId('sequence-vide')).toBeVisible()

		await bloc.getByTestId('champ-sequence').selectOption({ label: SEQUENCE_SEED })
		await bloc
			.getByTestId('champ-identite-sequence')
			.selectOption({ index: 1 })
		await bloc.getByTestId('armer-sequence').click()

		// LE BLOC BASCULE SUR SON SECOND ÉTAT, et il n'y en a que deux — la table ne porte que deux
		// valeurs de `status` (§12.7).
		await expect(bloc.getByTestId('sequence-active')).toBeVisible()
		await expect(bloc.getByTestId('sequence-active-nom')).toContainText(SEQUENCE_SEED)
		await expect(bloc.getByTestId('sequence-active-adresse')).toContainText('@')
		// LES DEUX COLONNES SONT NULLES ENSEMBLE (§12.3) : aucun palier n'est encore parti.
		await expect(bloc.getByTestId('sequence-active-avancement')).toHaveText(
			'Aucun palier envoyé pour l’instant.',
		)
		// AUCUNE DATE DE PROCHAIN ENVOI (§5.42, §13.8) : elle serait la seconde source de vérité que
		// le §12.3 a refusée en base, et l'écran ne peut pas la calculer honnêtement.
		await expect(bloc).not.toContainText('Prochain envoi')

		// LE BLOC AMENÉ DANS LE CHAMP VISIBLE AVANT LA CAPTURE — leçon des décisions 508 et 519 :
		// une capture qui ne porte pas son sujet est une preuve vide, et aucune assertion ne le
		// signale.
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'armement-actif-1440', UNITE)
	})

	test('l’interruption est RELUE : le bloc ne l’annonce qu’après avoir constaté la fermeture', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(AFFAIRE_FIGEE.adresse)
		const bloc = page.getByTestId('bloc-sequence-card')
		await bloc.getByTestId('champ-sequence').selectOption({ label: SEQUENCE_SEED })
		await bloc.getByTestId('champ-identite-sequence').selectOption({ index: 1 })
		await bloc.getByTestId('armer-sequence').click()
		await expect(bloc.getByTestId('sequence-active')).toBeVisible()

		await bloc.getByTestId('interrompre-sequence').click()

		// LE BLOC REVIENT À SON GESTE, et c'est la RELECTURE qui l'a établi : `204` ne dit pas qu'une
		// ligne a été fermée — l'appel est IDEMPOTENT (§12.4).
		await expect(bloc.getByTestId('sequence-vide')).toBeVisible()
		await expect(bloc.getByTestId('sequence-active')).toHaveCount(0)
		await expect(bloc.getByTestId('refus-sequence')).toHaveCount(0)
	})

	test('LE REFUS « affaire non figée » EST TRADUIT, et l’écran ne calcule rien', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(AFFAIRE_NON_FIGEE.adresse)
		const bloc = page.getByTestId('bloc-sequence-card')
		await expect(bloc).toBeVisible()

		// LE BLOC EST RENDU ET SA COMMANDE EST ACTIVE, alors même que l'affaire n'est PAS figée :
		// l'écran ne calcule pas ce prédicat (§13.8), et c'est la base qui refuse.
		await expect(bloc.getByTestId('armer-sequence')).toBeEnabled()

		await bloc.getByTestId('champ-sequence').selectOption({ label: SEQUENCE_SEED })
		await bloc.getByTestId('champ-identite-sequence').selectOption({ index: 1 })
		await bloc.getByTestId('armer-sequence').click()

		await expect(bloc.getByTestId('refus-sequence')).toContainText(
			'n’a pas dépassé le seuil d’inactivité',
		)
		// AUCUNE INSCRIPTION N'A ÉTÉ CRÉÉE.
		await expect(bloc.getByTestId('sequence-active')).toHaveCount(0)

		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'armement-refus-non-figee-1440', UNITE)

		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('UN SECOND ARMEMENT SUR LA MÊME AFFAIRE EST REFUSÉ, et le refus est traduit', async ({
		page,
	}) => {
		await connecter(page)
		// L'INSCRIPTION EST POSÉE PAR LA RPC RÉELLE, hors de l'écran : le bloc ne montre pas son
		// geste quand une inscription est déjà active, et le refus `enrollment_exists` ne se
		// provoquerait donc pas par deux clics. Le poser par la route mesure ce que l'écran fait
		// quand un AUTRE onglet a armé entre-temps — le cas réel.
		const jeton = await jetonDe(ADMIN)
		const identites = await page.request.get(
			`${URL_API}/rest/v1/mail_outbound_identities?select=id,owner_id`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const service = ((await identites.json()) as { id: string; owner_id: string | null }[]).find(
			(ligne) => ligne.owner_id === null,
		)
		expect(service, 'l’identité de service du seed').toBeDefined()

		await page.goto(AFFAIRE_FIGEE.adresse)
		const bloc = page.getByTestId('bloc-sequence-card')
		await expect(bloc.getByTestId('sequence-vide')).toBeVisible()

		const sequences = await page.request.get(`${URL_API}/rest/v1/mail_sequences?select=id,name`, {
			headers: enTetesAuthentifies(jeton),
		})
		const cadence = ((await sequences.json()) as { id: string; name: string }[]).find(
			(ligne) => ligne.name === SEQUENCE_SEED,
		)
		expect(cadence, 'la séquence du seed').toBeDefined()
		await page.request.post(`${URL_API}/rest/v1/rpc/armer_sequence_relance`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				p_card_id: AFFAIRE_FIGEE.id,
				p_sequence_id: cadence!.id,
				p_identity_id: service!.id,
			},
		})

		await bloc.getByTestId('champ-sequence').selectOption({ label: SEQUENCE_SEED })
		await bloc.getByTestId('champ-identite-sequence').selectOption({ index: 1 })
		await bloc.getByTestId('armer-sequence').click()

		await expect(bloc.getByTestId('refus-sequence')).toContainText(
			'Une relance est déjà armée sur cette affaire',
		)

		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
	})

	test('les quatre paliers du §7 rendent le bloc lisible', async ({ page }) => {
		await connecter(page)
		for (const palier of PALIERS) {
			// LA FENÊTRE EST RÉDUITE AVANT LE CHARGEMENT, et non après : réduite après, la barre
			// latérale devient un tiroir en restant OUVERTE — un état qu'un utilisateur arrivant à
			// 390 px ne rencontre jamais.
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(AFFAIRE_FIGEE.adresse)
			const bloc = page.getByTestId('bloc-sequence-card')
			await expect(bloc).toBeVisible()
			// LE BLOC EST AMENÉ DANS LE CHAMP VISIBLE : il vit en bas de la colonne gauche, et une
			// capture cadrée sur l'en-tête de la fiche ne prouverait rien de lui.
			await bloc.scrollIntoViewIfNeeded()
			await capturer(page, `armement-bloc-${palier.largeur}`, UNITE)
		}
	})
})
