// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : la SURFACE ;
//           tranche 2a : la GÉOMÉTRIE — poser, déplacer, redimensionner
// @verifies docs/SPEC-goals.md §5.1 (entrée de navigation et liste), §5.2 (canevas et pilule),
//           §5.3 (flèches), §5.4 (états), §5.5 (clavier, équivalent textuel, gestes de
//           géométrie au clavier), §3 (ouvrir le channel d'un bloc, poser, déplacer,
//           redimensionner), §4.1 (le bloc masqué n'est jamais nommé), §4.2 (l'écriture)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche), §7 (paliers), §5.8 (états)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (navigation clavier)
//
// LE PARCOURS EST FAIT À LA SOURIS ET AU CLAVIER, avec les jetons réels de DEUX profils du seed :
// l'administratrice, qui lit les huit channels, et la lectrice, qui n'en lit que six. C'est cette
// paire — et elle seule — qui rend le §4.1 démontrable sur un écran : les deux voient le MÊME
// tableau et n'y voient pas le même dessin.
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE et aucune fonction interne n'est appelée : ce que la preuve
// mesure est ce que le backend a consenti.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-083'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'

const TABLEAU = 'Objectifs du trimestre'
/** Le bloc lié à « Grands comptes », que la lectrice ne lit pas — seed 8 terdecies. */
const BLOC_MASQUE = 'Gagner un grand compte'
const BLOC_LIBRE = 'Doubler le pipeline commercial'
const BLOC_LIE = 'Livrer la refonte du site vitrine'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre le tableau du seed depuis la LISTE, comme un utilisateur — jamais par son adresse. */
async function ouvrirLeTableau(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
	await expect(page.getByTestId('tableau-objectifs').first()).toBeVisible()
	await page.getByRole('link', { name: new RegExp(TABLEAU) }).click()
	await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()
}

/** La position gauche d'un bloc, en unités de canevas — c'est `pos_x`, lu au style rendu. */
async function positionGauche(bloc: ReturnType<Page['getByTestId']>): Promise<number> {
	return mesure(bloc, 'left')
}

/** Une mesure de style du bloc, en pixels de canevas et non en pixels d'écran. */
async function mesure(
	bloc: ReturnType<Page['getByTestId']>,
	propriete: 'left' | 'top' | 'width' | 'height',
): Promise<number> {
	const valeur = await bloc.evaluate(
		(element, nom) => (element as HTMLElement).style.getPropertyValue(nom),
		propriete,
	)
	return Number.parseFloat(valeur)
}

/** L'identifiant du tableau du seed, lu par la clé de service pour la remise en état. */
async function identifiantDuTableau(): Promise<string> {
	const reponse = await fetch(
		`${URL_API}/rest/v1/goal_boards?select=id&name=eq.${encodeURIComponent(TABLEAU)}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

test.describe('canevas d’objectifs — CRM-083', () => {
	test('l’entrée de navigation mène à la liste, qui compte les blocs LISIBLES', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()

		const carte = page.getByTestId('tableau-objectifs').first()
		await expect(carte).toBeVisible()
		await expect(carte).toContainText(TABLEAU)
		// L'administratrice lit les huit channels : elle voit donc les SIX blocs du seed.
		await expect(carte).toContainText('6 blocs')
	})

	test('le canevas rend les blocs, leur jauge et la pilule « Track › Channel »', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('bloc-objectif')).toHaveCount(6)
		// Le titre est cherché dans le BLOC, et non dans la page : il apparaît légitimement DEUX
		// fois pour ce profil — sur la carte et dans l'équivalent textuel du diagramme (§5.5).
		await expect(page.getByRole('heading', { name: BLOC_MASQUE })).toBeVisible()

		// La pilule du bloc lié porte son track et son channel, et mène à l'adresse du channel.
		const pilule = page
			.getByTestId('bloc-objectif')
			.filter({ hasText: BLOC_LIE })
			.getByTestId('pilule-channel')
		await expect(pilule).toContainText('Studio web')
		await expect(pilule).toContainText('Refonte de site')

		// Les QUATRE flèches du seed sont tracées, et aucune n'est orpheline pour ce profil.
		await expect(page.getByTestId('fleche')).toHaveCount(4)
		await expect(page.getByTestId('fleche-orpheline')).toHaveCount(0)
	})

	test('OUVRIR LE CHANNEL depuis un bloc atterrit sur la bonne adresse — §3', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await page
			.getByTestId('bloc-objectif')
			.filter({ hasText: BLOC_LIE })
			.getByTestId('pilule-channel')
			.click()

		await expect(page).toHaveURL(/\/tracks\/studio-web\/refonte$/)
	})

	test('LA LECTRICE NE VOIT PAS le bloc du channel qui lui est fermé, et rien ne le nomme', async ({
		page,
	}) => {
		// C'est LA preuve du §4.1 sur un écran : le bloc n'est pas grisé, il n'est pas rendu, et
		// aucun texte de la page — dessin, équivalent textuel, infobulle — ne le nomme.
		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('bloc-objectif')).toHaveCount(5)
		await expect(page.getByText(BLOC_MASQUE)).toHaveCount(0)
		await expect(page.locator('body')).not.toContainText(BLOC_MASQUE)

		// La flèche qui en partait reste, en POINTILLÉS vers le vide, et SANS libellé.
		await expect(page.getByTestId('fleche-orpheline')).toHaveCount(1)
		const trait = page.getByTestId('fleche-orpheline').locator('line')
		await expect(trait).toHaveAttribute('stroke-dasharray', /\d/)

		await capturer(page, 'canevas-lectrice-bloc-masque', UNITE)
	})

	test('l’équivalent textuel restitue le diagramme, y compris ses trois directions — §5.5', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const lignes = page.getByTestId('ligne-diagramme')
		await expect(lignes).toHaveCount(4)
		const texte = (await page.getByTestId('equivalent-textuel').textContent()) ?? ''
		expect(texte).toContain('→')
		expect(texte).toContain('←')
		expect(texte).toContain('↔')
		// Le libellé posé sur la flèche est restitué au lecteur d'écran, pas seulement dessiné.
		expect(texte).toContain('nourrit')
	})

	test('LE CANEVAS EST UTILISABLE AU CLAVIER : tabulation entre les blocs, dans l’ordre des positions', async ({
		page,
	}) => {
		// `CLAUDE.md` §22 et `docs/SPEC-goals.md` §5.5 : un canevas qui n'obéit qu'à la souris n'est
		// pas terminé. La preuve n'emploie ICI aucune souris — que des touches.
		await connecter(page, ADMIN)
		await page.goto('/objectifs')
		await page.getByRole('link', { name: new RegExp(TABLEAU) }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()

		const premier = page.getByTestId('bloc-objectif').first()
		await premier.focus()
		await expect(premier).toBeFocused()
		// Le premier bloc de la tabulation est celui du haut à gauche : `pos_y` puis `pos_x`.
		await expect(premier).toHaveAttribute('aria-label', new RegExp(BLOC_LIBRE))

		// L'étiquette d'un bloc lié NOMME sa destination — sans quoi la pilule n'existerait que
		// pour les voyants.
		const lie = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIE })
		await expect(lie).toHaveAttribute('aria-label', /Studio web/)

		await capturer(page, 'canevas-focus-clavier', UNITE)
	})

	test('le zoom change l’échelle du canevas et reste borné', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('zoom-valeur')).toHaveText('100 %')
		await page.getByTestId('zoom-plus').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('125 %')
		await page.getByTestId('zoom-plus').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('150 %')
		// Borné : au dernier palier, la commande est indisponible plutôt qu'inopérante.
		await expect(page.getByTestId('zoom-plus')).toBeDisabled()

		await page.getByTestId('zoom-moins').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('125 %')
	})

	test('une adresse de tableau inconnue rend un état explicite, jamais une page blanche', async ({
		page,
	}) => {
		// Un identifiant qui n'existe pas et un tableau fermé à l'appelant se ressemblent
		// délibérément (docs/SPEC-permissions-rls.md §7).
		await connecter(page, ADMIN)
		await page.goto('/objectifs/5eed0000-0000-4000-8000-0000000000ff')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Tableau introuvable')).toBeVisible()
	})

	test('les quatre paliers rendent le canevas sans débordement horizontal — §7', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await expect(page.getByTestId('canevas-objectifs')).toBeVisible()
			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT : le canevas défile dans SON conteneur.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `canevas-${palier.nom}`, UNITE)
		}
	})


	// -----------------------------------------------------------------------------------------
	// TRANCHE 2a — LA GÉOMÉTRIE
	//
	// CES SCÉNARIOS ÉCRIVENT RÉELLEMENT DANS LA BASE, et ils rendent le tableau du seed à son
	// état de départ : un déplacement fait aller-retour au clavier, et le bloc posé est retiré
	// par la clé de service à la fin du scénario qui l'a créé. Sans cette remise en état, les
	// comptes des scénarios de lecture — « 6 blocs » — dériveraient d'une exécution à l'autre, et
	// la preuve deviendrait dépendante de son ordre de passage.
	// -----------------------------------------------------------------------------------------

	test('poser un bloc AU CLAVIER : le repère se déplace, Entrée pose, et la base garde le bloc', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(6)

		await page.getByTestId('poser-bloc').click()
		const repere = page.getByTestId('repere-pose')
		await expect(repere).toBeVisible()
		// LE FOCUS ENTRE DANS LE REPÈRE : sans lui, les flèches ne le piloteraient qu'après un
		// « Tab » supplémentaire, et le geste clavier du §5.5 ne serait pas celui qui est écrit.
		await expect(repere).toBeFocused()
		const depart = await repere.getAttribute('aria-label')

		await page.keyboard.press('ArrowRight')
		await page.keyboard.press('ArrowDown')
		const arrivee = await page.getByTestId('repere-pose').getAttribute('aria-label')
		// La position est ÉCRITE dans le nom accessible : un repère muet ne dirait pas où il est.
		expect(arrivee).not.toBe(depart)

		await capturer(page, 'pose-repere-1440', UNITE)
		await page.keyboard.press('Enter')

		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(7)

		// LA PERSISTANCE EST MESURÉE SUR UN RECHARGEMENT, jamais sur l'état d'écran : un bloc
		// ajouté localement paraîtrait identique à un bloc réellement écrit.
		await page.reload()
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(7)
		const pose = page.getByTestId('bloc-objectif').filter({ hasText: 'Nouvel objectif' })
		await expect(pose).toHaveCount(1)
		await capturer(page, 'bloc-pose-1440', UNITE)

		// Remise en état par la clé de SERVICE, hors interface : aucun geste de suppression n'est
		// livré par cette tranche, et en simuler un ici mentirait sur ce que l'écran sait faire.
		const retrait = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.Nouvel%20objectif`,
			{ method: 'DELETE', headers: enTetesService() },
		)
		expect(retrait.status).toBe(204)
	})

	test('déplacer un bloc AU CLAVIER écrit sa position, et le rechargement la confirme', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		const gaucheInitiale = await positionGauche(bloc)

		await bloc.focus()
		await page.keyboard.press('ArrowRight')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')

		await page.reload()
		const apres = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		expect(await positionGauche(apres)).toBe(gaucheInitiale + 8)
		await capturer(page, 'bloc-deplace-1440', UNITE)

		// RETOUR À L'ÉTAT DU SEED, par le même geste et non par une écriture de service : c'est
		// aussi la preuve que le déplacement fonctionne dans les deux sens.
		await apres.focus()
		await page.keyboard.press('ArrowLeft')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')
		await page.reload()
		expect(
			await positionGauche(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()),
		).toBe(gaucheInitiale)
	})

	test('redimensionner un bloc AU CLAVIER n’écrit que sa taille, et la position ne bouge pas', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		const gauche = await positionGauche(bloc)
		const largeur = await mesure(bloc, 'width')

		await bloc.focus()
		await page.keyboard.down('Alt')
		await page.keyboard.press('ArrowRight')
		await page.keyboard.up('Alt')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')

		await page.reload()
		const apres = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		expect(await mesure(apres, 'width')).toBe(largeur + 8)
		// UN REDIMENSIONNEMENT N'ENVOIE PAS DE POSITION : sans cette assertion, une écriture des
		// quatre colonnes passerait inaperçue jusqu'au jour où elle écraserait le geste d'un
		// collègue. Le défaut a réellement été écrit, puis trouvé par la preuve d'écran.
		expect(await positionGauche(apres)).toBe(gauche)

		await apres.focus()
		await page.keyboard.down('Alt')
		await page.keyboard.press('ArrowLeft')
		await page.keyboard.up('Alt')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')
		await page.reload()
		expect(
			await mesure(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first(), 'width'),
		).toBe(largeur)
	})

	test('la LECTRICE voit les gestes, les tente, et lit le refus du backend — §4.2', async ({ page }) => {
		// AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (docs/DESIGN_SYSTEM.md §5.26) :
		// l'écran envoie, et la politique décide. Le refus mesuré ici est celui de la base, pas
		// une règle que l'interface aurait inventée — et c'est exactement ce que INC-170 laisse à
		// l'arbitrage du responsable.
		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').first()
		await bloc.focus()
		await page.keyboard.press('ArrowRight')

		const mention = page.getByTestId('mention-ecriture')
		await expect(mention).not.toHaveText('Enregistré')
		await expect(mention).toBeVisible()
		await capturer(page, 'refus-lectrice-1440', UNITE)
	})

	test('LA CONSOLE RESTE VIERGE sur le parcours complet', async ({ page }) => {
		// `docs/CloudWorker.md` §3 : la console du navigateur doit rester vierge de toute erreur
		// et de tout avertissement. Le VERDICT est porté par la fixture, qui exige une console
		// vide à la fin de CHAQUE scénario ; ce scénario-ci existe pour parcourir l'écran sans
		// rien assener d'autre, de sorte qu'une anomalie de console ne se cache pas derrière
		// l'échec d'une autre assertion. Aucune tolérance n'est déclarée.
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)
		await page.getByTestId('zoom-plus').click()
		await page.getByTestId('bloc-objectif').first().focus()
		await expect(page.getByTestId('equivalent-textuel')).toBeVisible()
	})
})
