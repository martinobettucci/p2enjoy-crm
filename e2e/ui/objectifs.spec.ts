// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : la SURFACE ;
//           tranche 2a : la GÉOMÉTRIE — poser, déplacer, redimensionner ;
//           tranche 2c : les TABLEAUX — créer, renommer, réordonner, archiver
// @verifies docs/SPEC-goals.md §2.1 (nom unique par workspace, `position` attribuée par trigger,
//           l'archivage tient lieu de suppression)
// @verifies docs/DESIGN_SYSTEM.md §5.13 (formulaires dans le flux, focus au premier champ)
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

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
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


	test('poser un bloc À LA SOURIS : le bloc naît au POINT DU CLIC — §3', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(6)

		await page.getByTestId('poser-bloc').click()
		const surface = page.getByTestId('canevas-surface')
		const cadre = await surface.boundingBox()
		expect(cadre).not.toBeNull()
		if (cadre === null) return

		// Un point de la zone LIBRE, sous les six blocs du seed, et surtout DANS la partie visible
		// du conteneur : celui-ci est borné à 70 % de la hauteur de la fenêtre (§5.2), si bien
		// qu'un point pris plus bas tomberait hors de la zone rognée et le clic n'atteindrait
		// jamais la surface. Mesuré : à `+620`, la surface ne reçoit rien du tout.
		const cible = { x: cadre.x + 120, y: cadre.y + 450 }
		await page.mouse.click(cible.x, cible.y)
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')

		await page.reload()
		const pose = page.getByTestId('bloc-objectif').filter({ hasText: 'Nouvel objectif' })
		await expect(pose).toHaveCount(1)
		// LA POSITION VIENT DU GESTE : le coin haut gauche du bloc est le point du clic, à la
		// tolérance d'arrondi près. Aucun placement automatique, aucune grille.
		expect(Math.abs((await positionGauche(pose.first())) - 120)).toBeLessThanOrEqual(2)
		expect(Math.abs((await mesure(pose.first(), 'top')) - 450)).toBeLessThanOrEqual(2)
		await capturer(page, 'bloc-pose-souris-1440', UNITE)

		const retrait = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.Nouvel%20objectif`,
			{ method: 'DELETE', headers: enTetesService() },
		)
		expect(retrait.status).toBe(204)
	})

	test('déplacer et redimensionner À LA SOURIS, puis remettre le bloc en place', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		const gauche = await positionGauche(bloc)
		const haut = await mesure(bloc, 'top')
		const cadre = await bloc.boundingBox()
		expect(cadre).not.toBeNull()
		if (cadre === null) return

		// Le glissement part du CORPS du bloc, jamais de sa pilule : un `pointerdown` sur un lien
		// n'arme aucun déplacement, sans quoi ouvrir un channel deviendrait impossible.
		await page.mouse.move(cadre.x + 60, cadre.y + 20)
		await page.mouse.down()
		await page.mouse.move(cadre.x + 120, cadre.y + 80, { steps: 5 })
		await page.mouse.up()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')

		await page.reload()
		const apres = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		expect(await positionGauche(apres)).toBe(gauche + 60)
		expect(await mesure(apres, 'top')).toBe(haut + 60)
		await capturer(page, 'bloc-deplace-souris-1440', UNITE)

		// La POIGNÉE redimensionne, et elle seule : la position ne bouge pas.
		const largeur = await mesure(apres, 'width')
		const cadreApres = await apres.boundingBox()
		expect(cadreApres).not.toBeNull()
		if (cadreApres === null) return
		await page.mouse.move(cadreApres.x + cadreApres.width - 6, cadreApres.y + cadreApres.height - 6)
		await page.mouse.down()
		await page.mouse.move(cadreApres.x + cadreApres.width + 34, cadreApres.y + cadreApres.height - 6, {
			steps: 5,
		})
		await page.mouse.up()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')

		await page.reload()
		const redimensionne = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		expect(await mesure(redimensionne, 'width')).toBe(largeur + 40)
		expect(await positionGauche(redimensionne)).toBe(gauche + 60)

		// REMISE EN ÉTAT du seed, par la clé de service : le geste de souris ne se rejoue pas à
		// l'identique en sens inverse, et une preuve qui laisserait le tableau déformé rendrait
		// les captures des exécutions suivantes différentes des siennes.
		const remise = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(BLOC_LIBRE)}`,
			{
				method: 'PATCH',
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ pos_x: gauche, pos_y: haut, width: largeur }),
			},
		)
		expect(remise.status).toBe(204)
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

	// --- TRANCHE 2b-1 : LE CONTENU ---------------------------------------------------------
	// @verifies docs/SPEC-goals.md §3 (saisir titre, corps, couleur ; régler le remplissage au
	//           curseur ET au champ), §5.5 (`Entrée` ouvre la fiche d'édition)
	// @verifies docs/DESIGN_SYSTEM.md §5.7 ter (chaque champ s'enregistre pour lui-même), §5.29
	//
	// CES SCÉNARIOS ÉCRIVENT RÉELLEMENT DANS LA BASE, avec le jeton réel de l'administratrice, et
	// REMETTENT le seed en état par la clé de service. Sans cette remise, les comptes et les
	// captures des scénarios de lecture dériveraient d'une exécution à l'autre.

	test('`Entrée` ouvre la fiche, et le TITRE saisi survit au rechargement — §3 et §5.5', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')

		const fiche = page.getByTestId('fiche-bloc')
		await expect(fiche).toBeVisible()
		// LE FOCUS EST ENTRÉ DANS LA FICHE : sans cela, il faudrait traverser tout le canevas au
		// clavier pour l'atteindre, et le geste du §5.5 ne serait tenu qu'en apparence.
		await expect(page.getByTestId('champ-titre')).toBeFocused()
		await capturer(page, 'fiche-edition-1440', UNITE)

		const NOUVEAU = 'Doubler le pipeline commercial (révisé)'
		await page.getByTestId('champ-titre').fill(NOUVEAU)
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('etat-titre')).toHaveText('Enregistré')

		// LE TITRE EST BIEN EN BASE : la mention seule ne le prouverait pas.
		await page.reload()
		await expect(page.getByRole('heading', { name: NOUVEAU })).toBeVisible()

		const remise = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(NOUVEAU)}`,
			{
				method: 'PATCH',
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: BLOC_LIBRE }),
			},
		)
		expect(remise.status).toBe(204)
	})

	test('LE CURSEUR ET LE CHAMP ÉCRIVENT LA MÊME VALEUR, et la jauge du bloc la porte — §3', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		const jauge = bloc.getByTestId('jauge-remplissage')
		const avant = await jauge.evaluate((element) => (element as HTMLElement).style.width)

		await bloc.click()
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		// Le champ numérique écrit, et le CURSEUR affiche la même valeur : un seul état les porte.
		await page.getByTestId('champ-remplissage').fill('85')
		await page.getByTestId('champ-remplissage').press('Enter')
		await expect(page.getByTestId('etat-remplissage')).toHaveText('Enregistré')
		await expect(page.getByTestId('curseur-remplissage')).toHaveValue('85')
		await expect(jauge).toHaveCSS('width', /.+/)

		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await expect(recharge).toContainText('Remplissage 85 %')
		expect(
			await recharge.getByTestId('jauge-remplissage').evaluate((element) => (element as HTMLElement).style.width),
		).not.toBe(avant)
		await capturer(page, 'remplissage-saisi-1440', UNITE)

		const remise = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(BLOC_LIBRE)}`,
			{
				method: 'PATCH',
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ fill_percent: 25 }),
			},
		)
		expect(remise.status).toBe(204)
	})

	test('LA COULEUR CHOISIE change le liseré du bloc, et n’emporte aucune autre colonne — §2.2', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		await page.getByTestId('couleur-danger').getByRole('radio').check()
		await expect(page.getByTestId('etat-couleur')).toHaveText('Enregistré')

		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		// Le liseré porte le jeton `danger` ; le titre et le remplissage, eux, n'ont pas bougé.
		await expect(recharge.locator('span.bg-danger').first()).toBeVisible()
		await expect(recharge).toContainText('Remplissage 25 %')

		const remise = await fetch(
			`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(BLOC_LIBRE)}`,
			{
				method: 'PATCH',
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ color: 'brand' }),
			},
		)
		expect(remise.status).toBe(204)
	})

	test('la LECTRICE ouvre la fiche, saisit, et lit le refus SOUS le champ — §4.2', async ({ page }) => {
		// Même règle que la tranche 2a : aucune commande n'est éteinte d'avance selon le rôle
		// (docs/DESIGN_SYSTEM.md §5.26). L'écran envoie, la politique décide, l'écran traduit —
		// et la contradiction avec le §5.4 de la spécification reste consignée en INC-170.
		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		await page.getByTestId('champ-titre').fill('Titre écrit par une lectrice')
		await page.keyboard.press('Enter')

		const mention = page.getByTestId('etat-titre')
		await expect(mention).toBeVisible()
		await expect(mention).not.toHaveText('Enregistré')
		// LA SAISIE RESTE : un refus n'efface pas ce qui a été tapé (§5.7 ter).
		await expect(page.getByTestId('champ-titre')).toHaveValue('Titre écrit par une lectrice')
		await capturer(page, 'fiche-refus-lectrice-1440', UNITE)
	})

	test('`Échap` ferme la fiche et rend le focus au bloc — §5.5', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		await page.keyboard.press('Escape')
		await expect(page.getByTestId('fiche-bloc')).toHaveCount(0)
		// Le focus REVIENT au bloc : le renvoyer au début du document ferait perdre sa place au
		// clavier, et le canevas ne serait plus pilotable sans souris.
		await expect(bloc).toBeFocused()
	})
})

// ---------------------------------------------------------------------------------------------
// TRANCHE 2b-2a — LE LIEN VERS UN CHANNEL
//
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-2a
// @verifies docs/SPEC-goals.md §3 (sélecteur des channels LISIBLES groupés par track ; retirer
//           le lien remet `channel_id` à nul), §4.2 (poser le lien exige `app.can_write_channel`,
//           le retirer non), §5.2 (pilule « Track › Channel »)
//
// CES SCÉNARIOS ÉCRIVENT RÉELLEMENT, avec le jeton de l'administratrice, et REMETTENT le seed en
// état par la clé de service. Sans cette remise, les comptes des scénarios de lecture dériveraient
// d'une exécution à l'autre.
// ---------------------------------------------------------------------------------------------

/** Remet `channel_id` du bloc nommé à la valeur du seed, hors interface. */
async function remettreLien(titre: string, idChannel: string | null): Promise<void> {
	const reponse = await fetch(
		`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(titre)}`,
		{
			method: 'PATCH',
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ channel_id: idChannel }),
		},
	)
	expect(reponse.status).toBe(204)
}

/** L'identifiant d'un channel du seed, lu par la clé de service. */
async function identifiantDuChannel(nom: string): Promise<string> {
	const reponse = await fetch(
		`${URL_API}/rest/v1/channels?select=id&name=eq.${encodeURIComponent(nom)}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

test.describe('canevas d’objectifs — le lien vers un channel, CRM-083 tranche 2b-2a', () => {
	test('le sélecteur GROUPE les channels par track, et le lien posé se relit après rechargement', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		const selecteur = page.getByTestId('champ-lien')
		await expect(selecteur).toBeVisible()
		// LE REGROUPEMENT PAR TRACK EST MESURÉ SUR LE DOM RENDU (§3) : les `optgroup` portent le nom
		// des tracks du seed, et le bloc libre part bien SANS destination.
		await expect(selecteur.locator('optgroup')).not.toHaveCount(0)
		await expect(selecteur.locator('optgroup', { hasText: 'Refonte de site' })).toHaveAttribute(
			'label',
			'Studio web',
		)
		await expect(selecteur).toHaveValue('')
		// LE CHAMP EST AMENÉ DANS LA VUE AVANT LA CAPTURE : `capturer` prend la fenêtre et non la
		// page entière, et la fiche vit SOUS le canevas. Sans ce défilement, la capture s'arrête
		// au-dessus du sélecteur et ne montre pas ce qu'elle est censée prouver — c'est ce que
		// l'observation de la première capture a révélé (`CLAUDE.md` §16).
		await selecteur.scrollIntoViewIfNeeded()
		await capturer(page, 'fiche-lien-selecteur-1440', UNITE)

		await selecteur.selectOption({ label: 'Refonte de site' })
		await expect(page.getByTestId('etat-lien')).toHaveText('Enregistré')

		// LE LIEN EST RELU DU SERVEUR, pas de l'état d'écran : la pilule « Track › Channel » du §5.2
		// paraît sur le bloc après un rechargement complet.
		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await expect(recharge).toContainText('Studio web')
		await expect(recharge).toContainText('Refonte de site')
		await recharge.scrollIntoViewIfNeeded()
		await capturer(page, 'bloc-lie-1440', UNITE)

		await remettreLien(BLOC_LIBRE, null)
	})

	test('RETIRER le lien fait disparaître la pilule, et le bouton avec elle', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIE }).first()
		await expect(bloc).toContainText('Refonte de site')
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		// La destination du seed est bien celle que le sélecteur montre AVANT le geste.
		await expect(page.getByTestId('champ-lien')).not.toHaveValue('')
		await page.getByTestId('retirer-lien').click()
		await expect(page.getByTestId('etat-lien')).toHaveText('Enregistré')
		// LE BOUTON PART AVEC LE LIEN : il n'aurait plus rien à défaire, et une commande morte ment
		// plus qu'une absence.
		await expect(page.getByTestId('retirer-lien')).toHaveCount(0)
		await expect(page.getByTestId('champ-lien')).toHaveValue('')

		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIE }).first()
		await expect(recharge).not.toContainText('Refonte de site')

		await remettreLien(BLOC_LIE, await identifiantDuChannel('Refonte de site'))
	})

	test('la LECTRICE envoie le lien et lit le refus SOUS le champ — §4.2', async ({ page }) => {
		// Aucune commande n'est éteinte d'avance selon le rôle (docs/DESIGN_SYSTEM.md §5.26) :
		// l'écran envoie, la politique décide, l'écran traduit. La contradiction avec le §5.4 de la
		// spécification reste consignée en INC-170.
		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		const selecteur = page.getByTestId('champ-lien')
		await expect(selecteur).toBeVisible()
		await selecteur.selectOption({ label: 'Refonte de site' })

		const mention = page.getByTestId('etat-lien')
		await expect(mention).toBeVisible()
		await expect(mention).not.toHaveText('Enregistré')
		await mention.scrollIntoViewIfNeeded()
		await capturer(page, 'lien-refus-lectrice-1440', UNITE)

		// LE REFUS EST MESURÉ HORS INTERFACE, sur la même ligne et avec le jeton de la lectrice :
		// l'écran n'est pas la preuve du droit, la politique l'est.
		const apres = await fetch(
			`${URL_API}/rest/v1/goal_blocks?select=channel_id&board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(BLOC_LIBRE)}`,
			{ headers: enTetesService() },
		)
		const lignes = (await apres.json()) as { channel_id: string | null }[]
		expect(lignes[0]?.channel_id).toBeNull()
	})
})


// ---------------------------------------------------------------------------------------------
// TRANCHE 2b-2c — LES SUPPRESSIONS
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-2c
// @verifies docs/SPEC-goals.md §3 (« Supprimer une flèche, supprimer un bloc — la suppression
//           d'un bloc emporte ses flèches (cascade) » ; « un bloc se supprime réellement, il ne
//           s'archive pas »), §2.3 (`on delete cascade`), §4.2 (une flèche exige le droit d'écrire
//           les DEUX blocs qu'elle relie)
// @verifies docs/DESIGN_SYSTEM.md §6 (confirmation nommant l'objet), §5.29 (canevas)
//
// CES SCÉNARIOS DÉTRUISENT, et ils ne détruisent donc RIEN DU SEED : chacun pose d'abord son
// propre bloc et sa propre flèche par la clé de service, puis les supprime par l'interface. Le
// seed reste intact quoi qu'il arrive, là où supprimer un bloc du seed ferait dériver les comptes
// de tous les scénarios de lecture — et une remise en état après une CASCADE devrait recréer des
// lignes que rien ne garde.
// ---------------------------------------------------------------------------------------------

const BLOC_JETABLE = 'Bloc jetable de la preuve de suppression'

/** Pose un bloc de preuve sur le tableau du seed, par la clé de service. Rend son identifiant. */
async function poserBlocJetable(titre: string): Promise<string> {
	const reponse = await fetch(`${URL_API}/rest/v1/goal_blocks`, {
		method: 'POST',
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		body: JSON.stringify({
			board_id: await identifiantDuTableau(),
			title: titre,
			pos_x: 40,
			pos_y: 460,
			width: 240,
			height: 120,
			color: 'neutral',
		}),
	})
	expect(reponse.status).toBe(201)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

/** L'identifiant d'un bloc du tableau, par son titre — clé de service. */
async function identifiantDuBloc(titre: string): Promise<string | null> {
	const reponse = await fetch(
		`${URL_API}/rest/v1/goal_blocks?select=id&board_id=eq.${await identifiantDuTableau()}&title=eq.${encodeURIComponent(titre)}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? null
}

/** Trace une flèche entre deux blocs par la clé de service, et rend son identifiant. */
async function tracerFlecheDeService(idSource: string, idCible: string): Promise<string> {
	const reponse = await fetch(`${URL_API}/rest/v1/goal_links`, {
		method: 'POST',
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		body: JSON.stringify({
			board_id: await identifiantDuTableau(),
			source_block_id: idSource,
			target_block_id: idCible,
			direction: 'forward',
		}),
	})
	expect(reponse.status).toBe(201)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

/** Retire tout ce qu'un scénario aurait laissé — appelé même quand il a réussi. */
async function nettoyerBlocJetable(): Promise<void> {
	await fetch(
		`${URL_API}/rest/v1/goal_blocks?board_id=eq.${await identifiantDuTableau()}&title=like.*jetable*`,
		{ method: 'DELETE', headers: enTetesService() },
	)
}

/** Le nombre de flèches portant cet identifiant — zéro prouve la cascade. */
async function flecheExiste(idFleche: string): Promise<boolean> {
	const reponse = await fetch(`${URL_API}/rest/v1/goal_links?select=id&id=eq.${idFleche}`, {
		headers: enTetesService(),
	})
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes.length > 0
}

test.describe('canevas d’objectifs — les suppressions, CRM-083 tranche 2b-2c', () => {
	test.afterEach(async () => {
		await nettoyerBlocJetable()
	})

	test('SUPPRIMER UN BLOC EMPORTE SES FLÈCHES, et la base le prouve après rechargement', async ({
		page,
	}) => {
		const idJetable = await poserBlocJetable(BLOC_JETABLE)
		const idLibre = (await identifiantDuBloc(BLOC_LIBRE)) ?? ''
		const idFleche = await tracerFlecheDeService(idJetable, idLibre)

		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_JETABLE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		const commande = page.getByTestId('supprimer-bloc')
		await commande.scrollIntoViewIfNeeded()
		await commande.click()

		// §6 : LA CONFIRMATION NOMME LE BLOC, et annonce ce que la cascade emporte.
		const confirmation = page.getByTestId('confirmation-suppression-bloc')
		await expect(confirmation).toContainText(BLOC_JETABLE)
		await expect(confirmation).toContainText('la flèche qui le relie')
		await confirmation.scrollIntoViewIfNeeded()
		await capturer(page, 'suppression-bloc-confirmation-1440', UNITE)

		await page.getByTestId('confirmer-suppression-bloc').click()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Bloc supprimé')
		// LA FICHE SE FERME SEULE, son bloc n'étant plus rendu.
		await expect(page.getByTestId('fiche-bloc')).toHaveCount(0)
		await expect(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_JETABLE })).toHaveCount(0)
		await capturer(page, 'suppression-bloc-1440', UNITE)

		// LA CASCADE EST MESURÉE EN BASE, jamais déduite de l'écran (§2.3).
		expect(await flecheExiste(idFleche)).toBe(false)
		expect(await identifiantDuBloc(BLOC_JETABLE)).toBeNull()

		// Et le rechargement ne le ramène pas : la suppression est réelle, pas un archivage (§3).
		await page.reload()
		await expect(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_JETABLE })).toHaveCount(0)
	})

	test('SUPPRIMER UNE FLÈCHE laisse ses deux blocs en place', async ({ page }) => {
		const idJetable = await poserBlocJetable(BLOC_JETABLE)
		const idLibre = (await identifiantDuBloc(BLOC_LIBRE)) ?? ''
		const idFleche = await tracerFlecheDeService(idJetable, idLibre)

		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		// La ligne de CETTE flèche dans l'équivalent textuel — le seul endroit du diagramme que le
		// clavier et un lecteur d'écran atteignent (§5.5).
		const ligne = page.getByTestId('ligne-diagramme').filter({ hasText: BLOC_JETABLE }).first()
		await expect(ligne).toBeVisible()
		await ligne.getByTestId('supprimer-fleche').click()

		const confirmation = page.getByTestId('confirmation-suppression-fleche')
		await expect(confirmation).toContainText(BLOC_JETABLE)
		await expect(confirmation).toContainText(BLOC_LIBRE)
		await confirmation.scrollIntoViewIfNeeded()
		await capturer(page, 'suppression-fleche-confirmation-1440', UNITE)

		await page.getByTestId('confirmer-suppression-fleche').click()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Flèche supprimée')
		await expect(page.getByTestId('ligne-diagramme').filter({ hasText: BLOC_JETABLE })).toHaveCount(0)

		expect(await flecheExiste(idFleche)).toBe(false)
		// LES DEUX BLOCS SONT INTACTS : une flèche n'emporte rien.
		expect(await identifiantDuBloc(BLOC_JETABLE)).not.toBeNull()
		await expect(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIBRE })).toHaveCount(1)
	})

	test('la LECTRICE supprime, et lit « aucun bloc n’a été supprimé » — le silence du `using`', async ({
		page,
	}) => {
		// Aucune commande n'est éteinte d'avance selon le rôle (docs/DESIGN_SYSTEM.md §5.26) :
		// l'écran envoie, la politique décide, l'écran traduit. Le refus est ensuite MESURÉ HORS
		// INTERFACE — la ligne est toujours là.
		const idJetable = await poserBlocJetable(BLOC_JETABLE)
		expect(idJetable).not.toBe('')

		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_JETABLE }).first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		const commande = page.getByTestId('supprimer-bloc')
		await commande.scrollIntoViewIfNeeded()
		await commande.click()
		await page.getByTestId('confirmer-suppression-bloc').click()

		const mention = page.getByTestId('mention-ecriture')
		await expect(mention).toHaveAttribute('role', 'alert')
		await expect(mention).not.toHaveText('Bloc supprimé')
		await mention.scrollIntoViewIfNeeded()
		await capturer(page, 'suppression-refus-lectrice-1440', UNITE)

		// LE BLOC EST TOUJOURS RENDU, et la BASE le porte toujours : faire disparaître le bloc sur
		// ce silence annoncerait une suppression qui n'a pas eu lieu.
		await expect(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_JETABLE })).toHaveCount(1)
		expect(await identifiantDuBloc(BLOC_JETABLE)).toBe(idJetable)
	})
})

// =================================================================================================
// TRANCHE 2c — LES TABLEAUX
// =================================================================================================
//
// CHAQUE SCÉNARIO POSE SON PROPRE TABLEAU ET LE DÉTRUIT, par la clé de service : le seed n'est
// jamais entamé. C'est la règle que la tranche 2b-2c a déjà suivie pour les blocs, et elle compte
// double ici — un tableau ARCHIVÉ retient son nom (`goal_boards_workspace_name_key` est TOTAL), si
// bien qu'un scénario qui laisserait derrière lui un tableau archivé ferait échouer sa propre
// exécution suivante sur un doublon.

/** Le tableau que ces scénarios créent et détruisent. Jamais un tableau du seed. */
const TABLEAU_JETABLE = 'Tableau jetable de preuve'
const TABLEAU_JETABLE_RENOMME = 'Tableau jetable renommé'

/** Crée un tableau par la clé de service — pour les scénarios qui éprouvent un AUTRE geste. */
async function creerTableauDeService(nom: string, position: number): Promise<string> {
	const reponse = await fetch(`${URL_API}/rest/v1/goal_boards`, {
		method: 'POST',
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		body: JSON.stringify({ workspace_id: await identifiantDuWorkspace(), name: nom, position }),
	})
	expect(reponse.status).toBe(201)
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

/** L'espace de travail du seed, celui que la liste rend — `lireWorkspaces` prend le premier. */
async function identifiantDuWorkspace(): Promise<string> {
	const reponse = await fetch(`${URL_API}/rest/v1/workspaces?select=id&order=name`, {
		headers: enTetesService(),
	})
	const lignes = (await reponse.json()) as { id: string }[]
	return lignes[0]?.id ?? ''
}

/** La ligne d'un tableau relue EN BASE, archivés compris — l'écran ne la rend plus une fois archivée. */
async function tableauEnBase(
	nom: string,
): Promise<{ id: string; name: string; description: string | null; position: number; archived_at: string | null } | null> {
	const reponse = await fetch(
		`${URL_API}/rest/v1/goal_boards?select=id,name,description,position,archived_at&name=eq.${encodeURIComponent(nom)}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as {
		id: string
		name: string
		description: string | null
		position: number
		archived_at: string | null
	}[]
	return lignes[0] ?? null
}

/** Détruit RÉELLEMENT les tableaux jetables — un archivage laisserait leur nom pris. */
async function nettoyerTableauxJetables(): Promise<void> {
	for (const nom of [TABLEAU_JETABLE, TABLEAU_JETABLE_RENOMME]) {
		await fetch(`${URL_API}/rest/v1/goal_boards?name=eq.${encodeURIComponent(nom)}`, {
			method: 'DELETE',
			headers: enTetesService(),
		})
	}
}

test.describe('tableaux d’objectifs — CRM-083 tranche 2c', () => {
	test.beforeEach(async () => {
		await nettoyerTableauxJetables()
	})
	test.afterEach(async () => {
		await nettoyerTableauxJetables()
	})

	test('CRÉER un tableau depuis la liste, et la base le porte avec sa position', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(page.getByTestId('tableau-objectifs').first()).toBeVisible()

		await page.getByTestId('creer-tableau').click()
		const formulaire = page.getByTestId('formulaire-creation-tableau')
		await expect(formulaire).toBeVisible()
		// LE FOCUS EST DÉJÀ DANS LE PREMIER CHAMP (docs/DESIGN_SYSTEM.md §5.13) : la saisie part
		// donc au clavier sans un `Tab` de plus, et c'est ce que la frappe qui suit démontre.
		await page.keyboard.type(TABLEAU_JETABLE)
		await page.keyboard.press('Tab')
		await page.keyboard.type('Preuve de la tranche 2c.')
		await capturer(page, 'tableau-creation-1440', UNITE)
		await page.getByTestId('valider-tableau').click()

		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau créé')
		const ligne = page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE })
		await expect(ligne).toHaveCount(1)
		// Un tableau neuf n'a aucun bloc, et la liste le DIT au lieu de laisser un blanc (§5.1).
		await expect(ligne.first()).toContainText('Aucun bloc')
		await capturer(page, 'tableau-liste-1440', UNITE)

		// LA BASE EST RELUE : la position vient du TRIGGER, jamais de l'écran (§2.1).
		const enBase = await tableauEnBase(TABLEAU_JETABLE)
		expect(enBase).not.toBeNull()
		expect(enBase?.description).toBe('Preuve de la tranche 2c.')
		expect(enBase?.position).toBeGreaterThan(0)
		expect(enBase?.archived_at).toBeNull()
	})

	test('REFUSE un second tableau du même nom, et dit le geste à faire', async ({ page }) => {
		await creerTableauDeService(TABLEAU_JETABLE, 90)

		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await page.getByTestId('creer-tableau').click()
		await page.keyboard.type(TABLEAU_JETABLE)
		await page.getByTestId('valider-tableau').click()

		// Le refus est lu DANS le formulaire, près du champ qui l'a causé (§5.13), et il nomme le
		// geste à faire — choisir un autre nom — au lieu d'envoyer retenter le même.
		const formulaire = page.getByTestId('formulaire-creation-tableau')
		await expect(formulaire).toContainText('porte déjà ce nom')
		await capturer(page, 'tableau-doublon-1440', UNITE)

		// L'UNIQUE ERREUR DE CONSOLE EST LE REFUS QUE CE SCÉNARIO VIENT DE PROVOQUER ET DE LIRE :
		// le navigateur journalise lui-même toute réponse HTTP en échec, et `409 Conflict` est
		// exactement ce que PostgREST rend sur `goal_boards_workspace_name_key`. Elle est CONSOMMÉE
		// par sa liste exacte, jamais filtrée globalement — un statut, un nombre ou un ordre
		// différent échouerait ici, et toute anomalie postérieure reste dans le verdict final.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
	})

	test('RENOMMER un tableau, mesuré en base après rechargement', async ({ page }) => {
		await creerTableauDeService(TABLEAU_JETABLE, 91)

		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		const ligne = page
			.getByTestId('tableau-objectifs')
			.filter({ hasText: TABLEAU_JETABLE })
			.first()
		await expect(ligne).toBeVisible()

		await page.getByRole('button', { name: `Renommer le tableau ${TABLEAU_JETABLE}` }).click()
		const champ = page.getByTestId('champ-nom-tableau')
		// Le champ arrive REMPLI : un renommage qui repartirait d'un champ vide obligerait à
		// ressaisir ce que l'on ne veut pas changer.
		await expect(champ).toHaveValue(TABLEAU_JETABLE)
		await champ.fill(TABLEAU_JETABLE_RENOMME)
		await capturer(page, 'tableau-renommage-1440', UNITE)
		await page.getByTestId('valider-tableau').click()

		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau enregistré')
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE_RENOMME }),
		).toHaveCount(1)

		expect((await tableauEnBase(TABLEAU_JETABLE_RENOMME))?.name).toBe(TABLEAU_JETABLE_RENOMME)
		// Et le rechargement le confirme : l'écriture est réelle, pas un état d'écran.
		await page.reload()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE_RENOMME }),
		).toHaveCount(1)
	})

	test('RÉORDONNER un tableau écrit UNE position, et la liste suit', async ({ page }) => {
		// Deux tableaux jetables en QUEUE de liste — positions hautes —, de sorte que le geste ne
		// touche jamais l'ordre des tableaux du seed.
		await creerTableauDeService(TABLEAU_JETABLE, 92)
		await creerTableauDeService(TABLEAU_JETABLE_RENOMME, 93)

		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE_RENOMME }),
		).toHaveCount(1)

		const avant = (await tableauEnBase(TABLEAU_JETABLE_RENOMME))?.position ?? 0
		expect(avant).toBe(93)

		// LE GESTE EST FAIT AU CLAVIER : la commande est atteinte par le focus, et actionnée par
		// `Entrée` (CLAUDE.md §22).
		const monter = page.getByRole('button', { name: `Monter le tableau ${TABLEAU_JETABLE_RENOMME}` })
		await monter.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Ordre enregistré')

		// LA POSITION EST RELUE EN BASE, ET LA BORNE BASSE EST CELLE DE LA LIGNE D'AVANT LA
		// PRÉCÉDENTE, non celle de la précédente — c'est l'arithmétique du milieu, et le mesurer a
		// corrigé cette preuve : monter la dernière ligne d'une liste `[seed, 92, 93]` la place
		// entre le SEED et 92, soit très en dessous de 91. Exiger « entre 91 et 92 » aurait décrit
		// une permutation, geste que ce produit ne fait justement pas.
		const apres = (await tableauEnBase(TABLEAU_JETABLE_RENOMME))?.position ?? 0
		expect(apres).toBeLessThan(avant)
		expect(apres).toBeLessThan(92)
		// L'autre jetable n'a PAS bougé : une SEULE ligne a été écrite, jamais deux.
		expect((await tableauEnBase(TABLEAU_JETABLE))?.position).toBe(92)
		// Et l'ordre RENDU a bien changé : la preuve ne se contente pas de la valeur écrite.
		const noms = await page.getByTestId('tableau-objectifs').allInnerTexts()
		const rangRenomme = noms.findIndex((texte) => texte.includes(TABLEAU_JETABLE_RENOMME))
		const rangJetable = noms.findIndex((texte) => texte.includes(TABLEAU_JETABLE))
		expect(rangRenomme).toBeLessThan(rangJetable)
	})

	test('ARCHIVER un tableau le retire de la liste, et la base le porte archivé', async ({ page }) => {
		await creerTableauDeService(TABLEAU_JETABLE, 94)

		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(1)

		await page.getByRole('button', { name: `Archiver le tableau ${TABLEAU_JETABLE}` }).click()
		const confirmation = page.getByTestId('confirmation-archivage-tableau')
		// §6 : LA CONFIRMATION NOMME CE QU'ELLE ARCHIVE, et dit ce que le geste coûte — le tableau
		// quitte la liste, et son nom reste pris.
		await expect(confirmation).toContainText(TABLEAU_JETABLE)
		await expect(confirmation).toContainText('quitte cette liste')
		await capturer(page, 'tableau-archivage-confirmation-1440', UNITE)

		await page.getByTestId('confirmer-archivage-tableau').click()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau archivé')
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(0)

		// L'ARCHIVAGE N'EST PAS UNE SUPPRESSION : la ligne EXISTE toujours, horodatée. Le travail
		// qu'elle contient est conservé (§2.1).
		const enBase = await tableauEnBase(TABLEAU_JETABLE)
		expect(enBase).not.toBeNull()
		expect(enBase?.archived_at).not.toBeNull()

		// Et le rechargement ne le ramène pas : la liste ne rend que les tableaux vivants (§5.1).
		await page.reload()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(0)
	})

	test('la LECTRICE crée, et lit le refus — mesuré HORS interface derrière', async ({ page }) => {
		// Aucune commande n'est éteinte d'avance selon le rôle (docs/DESIGN_SYSTEM.md §5.26) :
		// l'écran envoie, la politique décide, l'écran traduit. `goal_boards_insertion_membre_ecrivant`
		// exige `admin` ou `business_developer` (§4.2 : « un viewer n'écrit rien »).
		await connecter(page, LECTRICE)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(page.getByTestId('tableau-objectifs').first()).toBeVisible()

		await page.getByTestId('creer-tableau').click()
		await page.keyboard.type(TABLEAU_JETABLE)
		await page.getByTestId('valider-tableau').click()

		const formulaire = page.getByTestId('formulaire-creation-tableau')
		await expect(formulaire).toContainText('Vous ne pouvez pas administrer les tableaux')
		await capturer(page, 'tableau-refus-lectrice-1440', UNITE)

		// L'unique erreur de console est le `403` que la politique vient de rendre, et que l'écran
		// vient de traduire — consommée par sa liste exacte (voir le scénario du doublon).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])

		// LA BASE N'A RIEN REÇU, et c'est la mesure qui compte : l'écran pourrait dire n'importe
		// quoi, la ligne n'existe pas.
		expect(await tableauEnBase(TABLEAU_JETABLE)).toBeNull()
	})
})

// =================================================================================================
// TRANCHE 2g — LE CLAVIER DES GESTES D'ADMINISTRATION
// =================================================================================================
//
// @verifies CRM-083 (docs/BACKLOG.md) — tranche 2g
// @verifies docs/SPEC-goals.md §5.5 bis.1 (les quatre mesures), §5.5 bis.2 (l'ancre de retour du
//           focus SURVIT au geste), §5.5 bis.3 (`Échap` referme les trois surfaces de la liste)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (administration des tableaux, clavier), §5.13 (le focus
//           revient à la commande qui a ouvert) ; CLAUDE.md §22 (navigation clavier)
//
// AUCUN CLIC N'EST EMPLOYÉ POUR LES GESTES ÉPROUVÉS ICI. C'est la condition même de la preuve :
// un parcours qui ouvrirait le formulaire à la souris ne dirait rien de ce qu'un utilisateur au
// clavier peut faire, et le défaut mesuré — le focus perdu après un archivage — ne se voit QUE
// dans le parcours clavier.

/** Décrit l'élément qui porte le focus, sans rien supposer de l'écran. */
async function focusCourant(page: Page): Promise<{ testid: string; aria: string }> {
	return page.evaluate(() => {
		const element = document.activeElement as HTMLElement | null
		return {
			testid: element?.getAttribute('data-testid') ?? (element?.tagName ?? 'null').toLowerCase(),
			aria: element?.getAttribute('aria-label') ?? '',
		}
	})
}

test.describe('clavier des gestes d’administration — CRM-083 tranche 2g', () => {
	test.beforeEach(async () => {
		await nettoyerTableauxJetables()
	})
	test.afterEach(async () => {
		await nettoyerTableauxJetables()
	})

	test('CRÉER puis ARCHIVER entièrement au clavier, sans jamais perdre le focus', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(page.getByTestId('tableau-objectifs').first()).toBeVisible()

        // --- CRÉATION. La commande est atteinte par le focus, ouverte par `Entrée`, et la saisie
        // part sans un `Tab` de plus : le focus entre dans le premier champ (§5.13).
		await page.getByTestId('creer-tableau').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('formulaire-creation-tableau')).toBeVisible()
		expect((await focusCourant(page)).testid).toBe('champ-nom-tableau')
		await page.keyboard.type(TABLEAU_JETABLE)
		await page.keyboard.press('Tab')
		await page.keyboard.type('Preuve clavier de la tranche 2g.')
		await capturer(page, 'tableau-clavier-creation-1440', UNITE)
		// `Entrée` dans un champ soumet le formulaire par le PREMIER bouton de soumission, qui est
		// « Valider » : « Annuler » porte `type="button"`, et ne peut donc pas le devancer.
		await page.keyboard.press('Enter')

		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau créé')
		const ligne = page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE })
		await expect(ligne).toHaveCount(1)
		expect(await tableauEnBase(TABLEAU_JETABLE)).not.toBeNull()
		// Le formulaire fermé, le focus revient à la commande qui l'a ouvert — elle survit au geste.
		await expect
			.poll(async () => (await focusCourant(page)).testid)
			.toBe('creer-tableau')

        // --- ARCHIVAGE. C'est le geste qui détruit la ligne portant sa propre commande, donc le
        // seul dont l'ancre de retour ne peut pas être celle du §5.13.
		await page.getByRole('button', { name: `Archiver le tableau ${TABLEAU_JETABLE}` }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('confirmation-archivage-tableau')).toBeVisible()
		// Le focus entre sur le bouton d'action : la confirmation ouverte au clavier doit être
		// répondue sans traverser la liste.
		expect((await focusCourant(page)).testid).toBe('confirmer-archivage-tableau')
		// DÉFAUT TROUVÉ EN REGARDANT CETTE CAPTURE (CLAUDE.md §16, docs/SPEC-goals.md §5.5 bis.5) :
		// la confirmation portait « Tableau créé » — l'issue du geste PRÉCÉDENT — en vert sous son
		// bouton destructif. Ouvrir une surface efface désormais la mention de la précédente.
		await expect(page.getByTestId('confirmation-archivage-tableau')).not.toContainText('Tableau créé')
		await expect(page.getByTestId('mention-formulaire-tableau')).toBeEmpty()
		await capturer(page, 'tableau-clavier-confirmation-1440', UNITE)
		await page.keyboard.press('Enter')

		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau archivé')
		await expect(ligne).toHaveCount(0)
		expect((await tableauEnBase(TABLEAU_JETABLE))?.archived_at).not.toBeNull()

		// L'ASSERTION QUI TIENT TOUTE LA TRANCHE. Avant correction, `document.activeElement`
		// retombait ici sur `body` — la commande visée venait d'être démontée avec sa ligne.
		await expect
			.poll(async () => (await focusCourant(page)).testid)
			.toBe('creer-tableau')
		// Et le `Tab` suivant reste DANS l'écran : il repartait du lien d'évitement, en tête de
		// document, ce qui obligeait à retraverser toute la coquille pour revenir à la liste.
		await page.keyboard.press('Tab')
		expect((await focusCourant(page)).testid).not.toBe('lien-evitement')
		await capturer(page, 'tableau-clavier-apres-archivage-1440', UNITE)
	})

	test('`ÉCHAP` referme les TROIS surfaces, rend le focus à sa commande, et n’écrit rien', async ({ page }) => {
		await creerTableauDeService(TABLEAU_JETABLE, 95)
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(1)

		// --- 1. LA CRÉATION.
		await page.getByTestId('creer-tableau').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('formulaire-creation-tableau')).toBeVisible()
		await page.keyboard.type('Tableau que personne ne veut')
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('formulaire-creation-tableau')).toHaveCount(0)
		await expect.poll(async () => (await focusCourant(page)).testid).toBe('creer-tableau')

		// --- 2. LE RENOMMAGE, et `Échap` frappé depuis le SECOND champ : l'écoute est posée sur le
		// conteneur, jamais sur le seul champ qui reçoit le focus à l'ouverture.
		await page.getByRole('button', { name: `Renommer le tableau ${TABLEAU_JETABLE}` }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('formulaire-renommage-tableau')).toBeVisible()
		await page.getByTestId('champ-nom-tableau').fill(TABLEAU_JETABLE_RENOMME)
		await page.getByTestId('champ-description-tableau').focus()
		await capturer(page, 'tableau-clavier-echap-renommage-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('formulaire-renommage-tableau')).toHaveCount(0)
		await expect
			.poll(async () => (await focusCourant(page)).aria)
			.toBe(`Renommer le tableau ${TABLEAU_JETABLE}`)

		// --- 3. LA CONFIRMATION D'ARCHIVAGE.
		await page.getByRole('button', { name: `Archiver le tableau ${TABLEAU_JETABLE}` }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('confirmation-archivage-tableau')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('confirmation-archivage-tableau')).toHaveCount(0)
		await expect
			.poll(async () => (await focusCourant(page)).aria)
			.toBe(`Archiver le tableau ${TABLEAU_JETABLE}`)

		// LA BASE EST RELUE, ET C'EST ELLE QUI DIT QUE `ÉCHAP` N'A RIEN ENVOYÉ : le nom est intact,
		// le tableau n'est pas archivé, et aucun second tableau n'a été créé. Une fermeture qui
		// aurait envoyé son geste serait pire que l'absence du raccourci.
		const enBase = await tableauEnBase(TABLEAU_JETABLE)
		expect(enBase?.name).toBe(TABLEAU_JETABLE)
		expect(enBase?.archived_at).toBeNull()
		expect(await tableauEnBase(TABLEAU_JETABLE_RENOMME)).toBeNull()
		// La ligne est toujours là, et l'écran n'a annoncé aucune écriture.
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(1)
	})

	test('LES QUATRE PALIERS gardent les trois surfaces utilisables, sans débordement — §7', async ({
		page,
	}) => {
		// Cette tranche ne change aucune géométrie : elle ajoute une touche et déplace une ancre de
		// focus. Le palier est éprouvé quand même, parce que la tranche 2c n'avait capturé que le
		// 1440 et que `Échap` fait désormais de la confirmation une surface qu'on ouvre et referme
		// beaucoup plus souvent — y compris sur un écran où elle occupe presque toute la hauteur.
		await creerTableauDeService(TABLEAU_JETABLE, 96)
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await expect(
			page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU_JETABLE }),
		).toHaveCount(1)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.getByRole('button', { name: `Archiver le tableau ${TABLEAU_JETABLE}` }).focus()
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('confirmation-archivage-tableau')).toBeVisible()
			// Le focus entre sur l'action à CHAQUE palier : la largeur ne change pas le clavier.
			expect((await focusCourant(page)).testid).toBe('confirmer-archivage-tableau')
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `tableau-clavier-confirmation-${palier.nom}`, UNITE)
			// Et `Échap` la referme au même palier, en rendant le focus à la commande de la ligne.
			await page.keyboard.press('Escape')
			await expect(page.getByTestId('confirmation-archivage-tableau')).toHaveCount(0)
			await expect
				.poll(async () => (await focusCourant(page)).aria)
				.toBe(`Archiver le tableau ${TABLEAU_JETABLE}`)
		}

		// Rien n'a été écrit : quatre ouvertures, quatre renoncements.
		expect((await tableauEnBase(TABLEAU_JETABLE))?.archived_at).toBeNull()
	})
})
