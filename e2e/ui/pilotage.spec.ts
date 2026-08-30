// @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//           TRANCHE 3 a : le parcours d'interface de l'écran `/pilotage` ;
//           TRANCHE 3 b : le sélecteur de portée, sur la pile réelle
// @verifies docs/SPEC-analytique.md §8 bis.2 (l'adresse porte DEUX clés, et M8 l'impose),
//           §8 bis.3 (changer de portée ne relit rien), §8 bis.4 (l'échec de la seconde lecture),
//           §8 (l'adresse `/pilotage`, route de premier niveau portée par
//           une entrée de la barre latérale), §5.3 (l'entonnoir est calculé APRÈS la RLS : deux
//           appelants n'obtiennent pas le même prévisionnel), §7.1 (le taux porte son nom entier),
//           §7.2 (prévisionnel par devise), §7.3 (les trois mentions obligatoires),
//           §11.2 (aucune addition de deux devises), M6 (les nombres du jeu de démonstration)
// @verifies docs/DESIGN_SYSTEM.md §5.48 bis (le sélecteur de portée et ses états), §4 (l'entrée
//           transverse de la barre latérale), §5.48 (cet
//           écran), §5.9 (le tableau), §5.33 (le titre de devise conditionnel), §5.8 (les états),
//           §7 (les quatre paliers), §8 (clavier)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE FICHIER NE MODIFIE RIEN, ET C'EST UNE CONTRAINTE DURE — la règle de `couts-workspace.spec.ts`,
// reprise sans changement. L'écran du §8 est en lecture seule ; aucun scénario ne pose ni ne retire
// de ligne, et aucun épilogue de purge n'est donc nécessaire (décision 362 : la purge accompagne
// l'écriture). Il n'écrit AUCUNE probabilité : les lignes *m* et *n* du contrat d'API le font, dans
// `e2e/api/analytique.spec.ts`, et les restaurent.
//
// LA MESURE QUE CE FICHIER EXISTE POUR TENIR, ET QU'AUCUNE PREUVE UNITAIRE NE PEUT POSER : le §5.3
// exige que « deux appelants n'obtiennent pas le même prévisionnel », et c'est le point même de la
// fonction `security invoker`. `S5` et `S6` sont ce couple, sur la pile réelle, avec les deux
// jetons obtenus par la véritable route de connexion. Les nombres ci-dessous sont ceux du §5.3,
// MESURÉS sur le seed :
//
//   * l'administratrice lit 39 affaires, et son prévisionnel vaut 381 042,50 EUR / 34 600,00 CHF ;
//   * la lectrice en lit 35 — `track_members` pose `conseil-ia = none` pour elle, et
//     `channel_members` ROUVRE `prospection` —, et son prévisionnel vaut 344 892,50 EUR pour le
//     MÊME 34 600,00 CHF : aucune des quatre affaires qu'elle ne voit pas n'est en francs ;
//   * l'écart vaut donc 36 150,00 EUR, et il est INCHANGÉ depuis la tranche 2 c : les quatre
//     affaires manquantes sont à `prospection`, `relance` et `livre`, aucune à `negociation`.

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-066'
const ADMIN = 'admin@p2enjoy.test'
/** La lectrice : quatre affaires de `grands-comptes` lui sont fermées (§5.3, M7). */
const VIEWER = 'viewer@p2enjoy.test'

const PILOTAGE = '/pilotage'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Le tableau d'une devise, désigné par le nom accessible de sa région (§5.48). */
const entonnoirDe = (page: Page, devise: string) =>
	page.getByRole('region', { name: `Entonnoir en ${devise}` })

/** La ligne d'un nœud, dans le tableau d'une devise. */
const ligneNoeud = (page: Page, devise: string, libelle: string) =>
	entonnoirDe(page, devise).getByRole('row', { name: new RegExp(libelle) })

/** Le prévisionnel d'une devise, tel que la tête d'écran le rend. */
const previsionnelDe = (page: Page, devise: string) =>
	page.locator(`[data-testid="pilotage-previsionnel-devise"][data-devise="${devise}"]`)

/** Les chiffres d'un texte, séparateurs et unités retirés — le nombre, et rien d'autre. */
const chiffresDe = (texte: string): number => Number(texte.replace(/[^0-9]/g, ''))

test.describe('CRM-066 — tableau de pilotage (docs/SPEC-analytique.md §8)', () => {
	test('S1 — l’entonnoir rend les huit lignes de M6, dans l’ORDRE DU CATALOGUE', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)

		// Les six nœuds peuplés en euros, dans l'ordre du catalogue et non par montant : un entonnoir
		// est un CHEMIN (§5.48), et trié par montant « Livré » — 311 000 — remonterait au-dessus de
		// « Prospection ».
		const euros = entonnoirDe(page, 'EUR').getByTestId('pilotage-ligne')
		await expect(euros).toHaveCount(6)
		// L'ordre est lu EN UNE FOIS, jamais par une assertion d'attribut sur le locator entier :
		// `toHaveAttribute` sur six éléments viole le mode strict de Playwright — défaut de MA
		// PREUVE, trouvé en l'exécutant, et la suite ci-dessous disait déjà tout ce qu'il visait.
		const cles = await euros.evaluateAll((lignes) =>
			lignes.map((l) => l.getAttribute('data-noeud')),
		)
		expect(cles).toEqual([
			'prospection',
			'relance',
			'negociation',
			'realisation',
			'livre',
			'perdu',
		])

		// Les nombres de M6, mesurés sur le seed. `Négociation` porte 230 752,50 de pondéré depuis
		// que la tranche 2 c a posé les deux surcharges — jamais 183 425,00, la valeur qu'il avait
		// quand le catalogue l'emportait partout.
		const negociation = ligneNoeud(page, 'EUR', 'Négociation')
		await expect(negociation.getByTestId('pilotage-affaires')).toHaveText('9')
		expect(chiffresDe(await negociation.getByTestId('pilotage-montant').innerText())).toBe(36685000)
		expect(chiffresDe(await negociation.getByTestId('pilotage-pondere').innerText())).toBe(23075250)
	})

	test('S2 — LE GENRE EST UN MOT, et c’est lui qui dit pourquoi « Livré » n’est pas au prévisionnel', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)

		// Les mots EXACTS du §5.18 — c'est la même donnée, `workflow_nodes_catalog.kind`, et deux
		// écrans qui la rendent ne peuvent pas la nommer de deux façons.
		await expect(ligneNoeud(page, 'EUR', 'Livré').getByTestId('pilotage-genre')).toHaveText(
			'Gagné',
		)
		await expect(ligneNoeud(page, 'EUR', 'Perdu').getByTestId('pilotage-genre')).toHaveText(
			'Perdu',
		)
		await expect(
			ligneNoeud(page, 'EUR', 'Prospection').getByTestId('pilotage-genre'),
		).toHaveText('Ouvert')

		// « Livré » porte 311 000 dans l'entonnoir, et le prévisionnel n'en tient AUCUN compte : les
		// nœuds terminaux en sont exclus (§7.2). 381 042,50 et non 692 042,50.
		expect(chiffresDe(await previsionnelDe(page, 'EUR').innerText())).toBe(38104250)
	})

	test('S3 — UN TABLEAU PAR DEVISE, et le franc n’est jamais mêlé à l’euro (§11.2)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)

		// Deux régions étiquetées, deux tableaux. Un total « toutes devises » serait un nombre que
		// personne n'a arbitré, et il se lirait comme un chiffre d'affaires.
		await expect(page.getByRole('table')).toHaveCount(2)
		await expect(entonnoirDe(page, 'EUR')).toBeVisible()
		await expect(entonnoirDe(page, 'CHF')).toBeVisible()
		// ET CHAQUE TABLEAU PORTE SON TITRE VISIBLE dès qu'il y en a plusieurs — la règle du §5.33,
		// que le cumul des coûts a payée en regardant une capture.
		await expect(page.getByRole('heading', { name: 'Entonnoir en EUR' })).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Entonnoir en CHF' })).toBeVisible()

		// LES DEUX EN-TÊTES DE MONTANT NOMMENT LA DEVISE, et c'est un défaut trouvé en regardant une
		// capture (`CLAUDE.md` §16) : le titre `h2` étant CONDITIONNEL, sur une devise unique — le cas
		// attendu — plus rien à l'œil ne disait de quelle monnaie ces nombres sont. Une assertion le
		// fige, faute de quoi le défaut reviendrait sans bruit.
		await expect(
			entonnoirDe(page, 'EUR').getByRole('columnheader', { name: 'Montant (EUR)' }),
		).toBeVisible()
		await expect(
			entonnoirDe(page, 'CHF').getByRole('columnheader', { name: 'Pondéré (CHF)' }),
		).toBeVisible()

		// Le franc ne peuple que DEUX nœuds, et aucun n'y est inventé : rendre « Négociation / CHF /
		// 0 » inventerait une devise à un nœud qu'aucune affaire n'y porte (§5.1).
		const francs = entonnoirDe(page, 'CHF').getByTestId('pilotage-ligne')
		await expect(francs).toHaveCount(2)
		await expect(entonnoirDe(page, 'CHF').getByRole('row', { name: /Négociation/ })).toHaveCount(0)
		expect(chiffresDe(await previsionnelDe(page, 'CHF').innerText())).toBe(3460000)
	})

	test('S4 — les deux mentions obligatoires du §7.3, et le taux avec son nom entier', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)

		// « Taux de conversion des affaires DÉCIDÉES », jamais « taux de conversion » tout court : ce
		// nombre mesure la part gagnée parmi les affaires ACTUELLEMENT à un nœud terminal (§7.1).
		await expect(page.getByText('Taux de conversion des affaires décidées')).toBeVisible()
		// Sept gagnées sur huit décidées — 87,5 %. `Contrat cadre 2025`, gagnée puis ARCHIVÉE, ne
		// compte dans ni l'un ni l'autre : c'est ce que le §7.1 nomme.
		await expect(page.getByTestId('pilotage-taux-detail')).toHaveText('7 gagnées sur 8 décidées')

		// La mention du §7.3 : une affaire active sans montant — `Piste entrante à qualifier`. Sans
		// elle, un prévisionnel bas se lit comme un portefeuille PAUVRE au lieu d'un portefeuille MAL
		// RENSEIGNÉ.
		await expect(page.getByTestId('pilotage-sans-montant')).toHaveText(
			'1 affaire sans montant renseigné.',
		)
		// La portée est ÉCRITE : sans elle, l'écart avec le total d'un collègue se lirait comme une
		// erreur de calcul.
		await expect(page.getByTestId('pilotage-portee')).toContainText(
			'affaires actives que vous pouvez lire',
		)
	})

	test('S5 — LE PRÉVISIONNEL DE LA LECTRICE DIFFÈRE DE CELUI DE L’ADMINISTRATRICE (§5.3)', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(PILOTAGE)

		// 344 892,50 et non 381 042,50 : quatre affaires du channel `grands-comptes` lui sont fermées.
		expect(chiffresDe(await previsionnelDe(page, 'EUR').innerText())).toBe(34489250)
		// Le FRANC est identique — aucune des quatre affaires manquantes n'est en francs. Une preuve
		// qui n'observerait que l'écart global ne dirait pas où il se loge.
		expect(chiffresDe(await previsionnelDe(page, 'CHF').innerText())).toBe(3460000)

		// Trois lignes repliées diffèrent, et elles sont NOMMÉES au §5.3 : `prospection` 11 → 10,
		// `relance` 8 → 6, `livre` 7 → 6.
		await expect(
			ligneNoeud(page, 'EUR', 'Prospection').getByTestId('pilotage-affaires'),
		).toHaveText('10')
		await expect(ligneNoeud(page, 'EUR', 'Relance').getByTestId('pilotage-affaires')).toHaveText(
			'6',
		)
		await expect(ligneNoeud(page, 'EUR', 'Livré').getByTestId('pilotage-affaires')).toHaveText('6')
		// Et `Négociation` est IDENTIQUE : aucune des affaires qu'elle ne voit pas n'est à ce nœud.
		await expect(
			ligneNoeud(page, 'EUR', 'Négociation').getByTestId('pilotage-affaires'),
		).toHaveText('9')

		// L'ÉCRAN NE NOMME JAMAIS CE QU'IL NE MONTRE PAS (§5.48) : aucune phrase ne dit qu'une
		// affaire lui est masquée, et l'y écrire divulguerait par la bande ce que la RLS ferme.
		await expect(page.getByText(/masqué/i)).toHaveCount(0)
	})

	test('S6 — LA CONTRE-ÉPREUVE : l’administratrice lit 36 150,00 de plus, et rien d’autre', async ({
		page,
	}) => {
		// Sans elle, `S5` ne prouverait rien : 344 892,50 serait indistinguable d'un portefeuille qui
		// ne vaut que cela. Le même écran, les mêmes données, un autre profil.
		await connecter(page)
		await page.goto(PILOTAGE)

		const eur = chiffresDe(await previsionnelDe(page, 'EUR').innerText())
		expect(eur, 'le prévisionnel de l’administratrice vaut 381 042,50 EUR').toBe(38104250)
		// LA DIFFÉRENCE EST MESURÉE, et pas seulement la présence d'une ligne de plus : 381 042,50 −
		// 344 892,50 vaut 36 150,00, et c'est ce que la Definition of Done demande de prouver. Une
		// preuve qui n'observerait que le nombre de lignes ne dirait pas si l'entonnoir a été calculé
		// avant ou après la RLS.
		expect(eur - 34489250, 'l’écart entre les deux profils vaut 36 150,00 EUR').toBe(3615000)
		// Le compte des affaires suit la même règle : onze pour elle, dix pour la lectrice.
		await expect(
			ligneNoeud(page, 'EUR', 'Prospection').getByTestId('pilotage-affaires'),
		).toHaveText('11')
	})

	test('S7 — l’entrée « Pilotage » de la barre latérale mène ici, atteinte au CLAVIER', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/')

		const entree = page
			.getByRole('navigation', { name: 'Navigation principale' })
			.getByRole('link', { name: 'Pilotage' })
		await expect(entree).toBeVisible()
		// Le focus est atteint par `Tab`, jamais par `focus()` : Chromium ne pose `:focus-visible`
		// que sur un focus réellement atteint au clavier (§8).
		await page.keyboard.press('Tab')
		for (
			let pas = 0;
			pas < 40 && !(await entree.evaluate((n) => n === document.activeElement));
			pas++
		) {
			await page.keyboard.press('Tab')
		}
		await expect(entree).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`${PILOTAGE}$`))
		// L'entrée courante se signale par `aria-current`, pas seulement par la couleur (§1).
		await expect(entree).toHaveAttribute('aria-current', 'page')
	})

	test('S8 — captures aux quatre paliers, page jamais défilante horizontalement (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(PILOTAGE)
			await expect(ligneNoeud(page, 'EUR', 'Négociation')).toHaveCount(1)
			// « La page ne défile jamais horizontalement » (§7) : les tableaux débordent dans LEUR
			// conteneur, qui porte `.indique-debordement-x` (§12.6).
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal de page à ${palier.nom}`).toBeLessThanOrEqual(
				0,
			)
			await capturer(page, `pilotage-${palier.nom}`, UNITE)
		}
		// LA CONSOLE DOIT RESTER VIERGE (`docs/CloudWorker.md` §3) : la liste vide est le verdict.
		autoriserErreursConsole(page, [])
	})
	// -------------------------------------------------------------------------------------------
	// TRANCHE 3 b — le sélecteur de portée. Ces scénarios exercent ce qu'aucune preuve unitaire ne
	// peut poser : la SECONDE lecture contre la vraie RLS, et l'adresse contre le vrai routeur.
	// -------------------------------------------------------------------------------------------

	test('S9 — le sélecteur offre les six channels du seed, groupés par track (§5.48 bis)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toBeEnabled()

		const groupes = selecteur.locator('optgroup')
		// QUATRE GROUPES POUR CINQ TRACKS : `pipeline-2024` n'a aucun channel, et un track sans
		// channel n'a rien à mesurer (§5.48 bis).
		await expect(groupes).toHaveCount(4)
		// L'ORDRE DES TRACKS EST `tracks.position`, ET C'EST CE QUE CETTE PREUVE A PAYÉ. Un tri
		// global des channels par `position` — numérotée PAR TRACK — les entrelaçait, et rendait
		// « Legacy 2023, Formation, Conseil & IA, Studio web ». L'intitulé est une DONNÉE (§10).
		//
		// L'ASSERTION PORTE SUR LA LISTE ENTIÈRE, ET NON SUR `toHaveAttribute` d'un locator
		// multiple : ce dernier viole le mode strict de Playwright et rend un échec qui ne dit rien
		// du produit — le défaut exact que la tranche 3 a avait déjà payé, ici pour la deuxième
		// fois. Écrite ainsi, elle dit davantage : l'ordre, et pas seulement la présence.
		expect(await groupes.evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('label')))).toEqual([
			'Conseil & IA',
			'Studio web',
			'Formation',
			'Legacy 2023',
		])
		// M9, MESURÉ : quatre tracks offrables, six channels, plus l'option de tête et les quatre
		// « Tout le track » — onze options. `appels-offres` est archivé, `annexes-2023` en corbeille.
		await expect(selecteur.locator('option')).toHaveCount(11)
		await expect(selecteur.getByRole('option', { name: /Appels d’offres/ })).toHaveCount(0)
		await expect(selecteur.getByRole('option', { name: /Annexes 2023/ })).toHaveCount(0)
		// CHAQUE OPTION NOMME SON TRACK — défaut trouvé en regardant `pilotage-portee-xl-1440.jpg` :
		// un `select` FERMÉ ne rend que le texte de l'option, et l'intitulé du groupe y est
		// invisible. « Tout le track » s'y lisait sans dire lequel.
		await expect(
			selecteur.getByRole('option', { name: 'Studio web — tout le track' }),
		).toHaveCount(1)
		await expect(
			selecteur.getByRole('option', { name: 'Studio web — Refonte de site' }),
		).toHaveCount(1)
		// Le défaut est l'espace de travail, et il ne s'écrit pas dans l'adresse.
		await expect(selecteur).toHaveValue('')
		await expect(page).toHaveURL(new RegExp(`${PILOTAGE}$`))
		autoriserErreursConsole(page, [])
	})

	test('S10 — CHOISIR UN CHANNEL ÉCRIT LES DEUX CLÉS ET RESTREINT LES NOMBRES', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PILOTAGE)
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toBeEnabled()

		await selecteur.selectOption('legacy-2023/dossiers-2023')

		// M11, MESURÉ : `dossiers-2023` ne porte qu'UNE affaire active, « Reprise du dossier
		// Marchand », seule affaire du track à `negociation`. Son pondéré vaut donc exactement
		// 22 000,00 × 30 % = 6 600,00 — la surcharge de probabilité que le seed pose au niveau de
		// l'affaire (§9). Un `coalesce` écrit à l'envers rendrait 11 000,00.
		await expect(ligneNoeud(page, 'EUR', 'Négociation')).toHaveCount(1)
		await expect(entonnoirDe(page, 'EUR').getByRole('row')).toHaveCount(2)
		expect(chiffresDe((await previsionnelDe(page, 'EUR').innerText()) ?? '')).toBe(660000)

		// L'ADRESSE PORTE LES DEUX CLÉS, ET C'EST M8 : un slug de channel n'est unique que dans son
		// track, et `?channel=` seul ne désignerait rien.
		await expect(page).toHaveURL(/\?track=legacy-2023&channel=dossiers-2023$/)
		// La phrase de portée NOMME la portée, et le nom est une donnée.
		await expect(page.getByTestId('pilotage-portee')).toContainText('Dossiers 2023')
		autoriserErreursConsole(page, [])
	})

	test('S11 — L’ADRESSE SEULE SUFFIT, et le choix ne s’empile pas dans l’historique', async ({
		page,
	}) => {
		await connecter(page)
		// UNE ADRESSE PARTAGÉE OUVRE DIRECTEMENT SA PORTÉE : c'est le point d'une portée qui vit
		// dans la chaîne de requête plutôt que dans un état d'écran.
		await page.goto(`${PILOTAGE}?track=legacy-2023&channel=dossiers-2023`)
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toHaveValue('legacy-2023/dossiers-2023')
		await expect(entonnoirDe(page, 'EUR').getByRole('row')).toHaveCount(2)

		// LE CHOIX REMPLACE L'ENTRÉE D'HISTORIQUE (§5.48 bis) : trois essais de portée ne doivent
		// pas coûter trois retours arrière pour quitter l'écran.
		await selecteur.selectOption('studio-web')
		await expect(page).toHaveURL(/\?track=studio-web$/)
		await selecteur.selectOption('')
		await expect(page).toHaveURL(new RegExp(`${PILOTAGE}$`))
		await page.goBack()
		// Le retour arrière quitte l'écran plutôt que de rejouer les portées essayées.
		await expect(page).not.toHaveURL(new RegExp(PILOTAGE))
		autoriserErreursConsole(page, [])
	})

	test('S12 — UNE ADRESSE INEXPLOITABLE REPLIE SANS ERREUR, et le sélecteur le dit', async ({
		page,
	}) => {
		await connecter(page)

		// `?channel=` SEUL ne désigne rien — M8. L'écran rend l'espace de travail entier, et le
		// sélecteur affiche la portée RÉELLEMENT appliquée.
		await page.goto(`${PILOTAGE}?channel=dossiers-2023`)
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toHaveValue('')
		await expect(ligneNoeud(page, 'EUR', 'Livré')).toHaveCount(1)

		// Un track inconnu replie de même, et l'écran n'écrit AUCUNE erreur : « ce track n'existe
		// pas » renseignerait par la bande sur ce que la RLS ferme (§5.48).
		await page.goto(`${PILOTAGE}?track=inexistant-2026`)
		await expect(selecteur).toHaveValue('')
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)

		// Un channel cherché dans le MAUVAIS track replie sur ce track, jamais sur l'homonyme d'un
		// autre : `prospection` existe, mais dans `conseil-ia`.
		await page.goto(`${PILOTAGE}?track=studio-web&channel=prospection`)
		await expect(selecteur).toHaveValue('studio-web')
		autoriserErreursConsole(page, [])
	})

	test('S13 — LA PORTÉE NE DIVULGUE RIEN : la lectrice ne se voit pas offrir « Grands comptes »', async ({
		page,
	}) => {
		// LE SÉLECTEUR N'EST PAS UN CONTRÔLE D'AUTORISATION (`CLAUDE.md` §10) : la liste est celle
		// que la RLS de `channels` consent, et forcer la portée dans l'adresse ne rend rien de plus
		// — l'entonnoir est calculé APRÈS la RLS (§5.3). Les deux moitiés sont éprouvées ici.
		await connecter(page, VIEWER)
		await page.goto(PILOTAGE)
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toBeEnabled()
		await expect(selecteur.getByRole('option', { name: /Grands comptes/ })).toHaveCount(0)
		// `prospection` lui est ROUVERT par `channel_members` (M7) : la liste suit la RLS, elle ne
		// la rejoue pas.
		await expect(
			selecteur.getByRole('option', { name: 'Conseil & IA — Prospection' }),
		).toHaveCount(1)

		// L'ADRESSE FORCÉE NE LUI REND RIEN DE PLUS, et le repli est celui du §8 bis.2 : le track
		// `conseil-ia` lui est lisible, le channel `grands-comptes` ne l'est pas, donc la portée
		// retombe sur SON TRACK — le repli garde ce qui a été compris et abandonne le reste.
		//
		// CE N'EST PAS UNE DIVULGATION : le repli ne dit pas si `grands-comptes` existe, seulement
		// qu'il n'est pas dans la liste qu'elle peut choisir — ce que le sélecteur affichait déjà.
		// Et l'entonnoir rendu reste celui que la RLS lui consent : `Livré`, que `grands-comptes`
		// porte pour l'administratrice, n'y figure pas.
		await page.goto(`${PILOTAGE}?track=conseil-ia&channel=grands-comptes`)
		await expect(selecteur).toHaveValue('conseil-ia')
		await expect(ligneNoeud(page, 'EUR', 'Livré')).toHaveCount(0)
		autoriserErreursConsole(page, [])
	})

	test('S14 — captures du sélecteur aux quatre paliers, page jamais défilante (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`${PILOTAGE}?track=studio-web`)
			await expect(page.getByTestId('pilotage-selecteur-portee')).toHaveValue('studio-web')
			await expect(ligneNoeud(page, 'EUR', 'Négociation')).toHaveCount(1)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal de page à ${palier.nom}`).toBeLessThanOrEqual(
				0,
			)
			await capturer(page, `pilotage-portee-${palier.nom}`, UNITE)
		}
		autoriserErreursConsole(page, [])
	})
})
