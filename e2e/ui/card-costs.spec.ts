// @verifies CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire, TRANCHE 2 : parcours
//           d'interface de la section « Coûts » de la fiche d'affaire
// @verifies docs/SPEC-costs.md §2.3 (« nul n'est pas zéro », la devise vient du budget, un budget
//           clôturé n'accepte aucune ligne neuve mais son réel reste saisissable), §3.1 (la double
//           condition de lecture, par le cas qui la motive), §3.2 (qui écrit une ligne),
//           §4.4 (« n lignes sans coût réel saisi »), §4.6 (la liste, l'ajout, la modification, la
//           suppression, le sélecteur de budget et le SECOND sélecteur d'occurrence), §4.7 (états)
// @verifies docs/DESIGN_SYSTEM.md §5.3 (la section vit dans la colonne gauche), §5.9 (le patron de
//           tableau), §5.13 (commandes désactivées jamais masquées, formulaire et confirmation dans
//           le flux du document, focus entrant dans le premier champ), §7 (paliers), §8
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// LES GESTES SONT ÉPROUVÉS SUR DE VRAIS CLICS ET DE VRAIES FRAPPES, jamais par appel d'une fonction
// interne, et le parcours clavier atteint son focus par `Tab` — Chromium ne pose `:focus-visible`
// que sur un focus réellement atteint au clavier, et une capture prise après un `focus()`
// programmatique montrerait un champ sans anneau (`docs/DESIGN_SYSTEM.md` §8).
//
// LE SEED EST RENDU INTACT, ET C'EST UNE CONTRAINTE DURE. `apply-seed.sh` compte les lignes de
// `card_costs` — QUATRE — et `supabase/tests/0049_card_costs.test.sql` s'appuie sur ce compte. Les
// scénarios d'écriture posent donc des lignes sous des libellés préfixés `E2E Cout`, et les
// RETIRENT par la clé de service dans un épilogue qui s'exécute quel que soit leur point d'échec —
// règle de la décision 362 (INC-091, INC-099). La purge d'entrée protège du résidu qu'une exécution
// tuée avant son `finally` laisserait derrière elle.
//
// POURQUOI LA PURGE FILTRE PAR `label` ET NON PAR `id`. C'est le défaut mesuré à la décision 473,
// et il ne se refait pas : `id=like.…` ne supprime AUCUNE ligne — `id` est de type `uuid`, pour
// lequel PostgreSQL n'offre aucun opérateur `LIKE` —, et PostgREST rend une erreur qu'un `afterAll`
// silencieux ignorerait. Le filtre porte sur une colonne `text`, et l'épilogue échoue bruyamment.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import type { APIRequestContext, Locator } from '@playwright/test'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-085'
const ADMIN = 'admin@p2enjoy.test'
/**
 * La lectrice : elle LIT l'affaire « Formation Data & IA » — son track lui est ouvert — et ne lit
 * AUCUNE de ses lignes, dont le budget vit sur un track qui lui est fermé. C'est le cas exact que
 * la double condition du §3.1 existe pour traiter, et le seul qui la distingue d'une condition
 * simple sur la card.
 */
const VIEWER = 'viewer@p2enjoy.test'

/**
 * « Refonte intranet Ville de Lyon » — le cas du responsable, mot pour mot (§1) : deux lignes de
 * nature différente, « Publicité — estimé 100, réel INCONNU » et « Production — estimé 350,
 * réel 375 ». La première est rattachée à un budget RÉCURRENT dans son occurrence « Février 2026»,
 * la seconde à « Salon du web 2025 », CLÔTURÉ.
 */
const AFFAIRE = {
	adresse: '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4',
	titre: 'Refonte intranet Ville de Lyon',
}

/**
 * « Formation Data & IA — promo 2026 » : l'affaire que la lectrice voit, dont elle ne voit aucune
 * ligne. Son unique ligne est rattachée à « Prospection sortante », sur « Conseil & IA ».
 */
const AFFAIRE_BUDGET_FERME = {
	adresse: '/tracks/formation/inter-entreprises/cards/5eed0000-0000-4000-8000-0000000000c7',
}

const BUDGET_RECURRENT = 'Publicité 2026'
const BUDGET_CLOTURE = 'Salon du web 2025'
const OCCURRENCE_OUVERTE = 'Février 2026'
const OCCURRENCE_CLOSE = 'Janvier 2026'

const PREFIXE = 'E2E Cout'
const CHEMIN_COUTS = `${URL_API}/rest/v1/card_costs`

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre la fiche et rend la section « Coûts ». */
async function ouvrirSectionCouts(page: Page, adresse = AFFAIRE.adresse): Promise<Locator> {
	await page.goto(adresse)
	const section = page.getByTestId('bloc-couts-card')
	await expect(section).toBeVisible()
	return section
}

/**
 * Retire toute ligne d'essai, par la clé de service.
 *
 * Le filtre porte sur `label`, colonne de type `text` : voir l'en-tête. `Prefer: count=exact` rend
 * le nombre de lignes touchées, et le contrôle du statut fait ÉCHOUER bruyamment une purge qui
 * n'aurait pas abouti — une purge complaisante est ce que la décision 473 a payé.
 */
async function purger(request: APIRequestContext): Promise<void> {
	const reponse = await request.delete(`${CHEMIN_COUTS}?label=like.${encodeURIComponent(`${PREFIXE}%`)}`, {
		headers: enTetesService(),
	})
	expect(reponse.status(), 'la purge des lignes d’essai doit aboutir').toBeLessThan(300)
}

test.beforeEach(async ({ request }) => {
	await purger(request)
})

test.afterEach(async ({ request }) => {
	await purger(request)
})

// -------------------------------------------------------------------------------------------
// S1. Ce que la section rend du seed
// -------------------------------------------------------------------------------------------

test.describe('la section « Coûts » de la fiche (docs/SPEC-costs.md §4.6)', () => {
	test('elle rend les DEUX lignes de l’affaire, avec leur budget et leur occurrence', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await expect(section.getByRole('heading', { name: 'Coûts' })).toBeVisible()

		const lignes = section.getByTestId('ligne-cout')
		await expect(lignes).toHaveCount(2)

		// « Publicité » : budget RÉCURRENT, donc la colonne d'occurrence est renseignée.
		const publicite = section.getByRole('row', { name: /Publicité/ })
		await expect(publicite).toContainText(BUDGET_RECURRENT)
		await expect(publicite).toContainText(OCCURRENCE_OUVERTE)
		await expect(publicite).toContainText('100.00')

		// « Production » : budget SIMPLE, donc la cellule d'occurrence reste VIDE — le §5.9 la
		// réserve à une donnée qui n'existe pas pour cette ligne, et un budget non récurrent n'a
		// aucune occurrence par construction.
		const production = section.getByRole('row', { name: /Production/ })
		await expect(production).toContainText(BUDGET_CLOTURE)
		await expect(production).not.toContainText(OCCURRENCE_OUVERTE)
		await expect(production).toContainText('350.00')
		await expect(production).toContainText('375.00')
	})

	test('un réel inconnu n’est JAMAIS rendu « 0.00 » — nul n’est pas zéro (§2.3)', async ({
		page,
	}) => {
		// C'est la principale façon dont cet écran mentirait : afficher un zéro là où personne n'a
		// mesuré ferait lire un retard de saisie comme une dépense nulle constatée.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		const publicite = section.getByRole('row', { name: /Publicité/ })
		const cellule = publicite.getByTestId('cout-cellule-reel')
		await expect(cellule).toContainText('—')
		await expect(cellule).not.toContainText('0.00')
		// L'équivalent lisible existe pour le lecteur d'écran : un tiret seul ne dit rien (§8).
		await expect(cellule).toContainText('Coût réel non saisi')
	})

	test('le budget clôturé porte sa pilule, et c’est un MOT et non une teinte (§1)', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		const production = section.getByRole('row', { name: /Production/ })
		await expect(production.getByTestId('cout-pilule-cloture')).toHaveText('clôturé')
	})

	test('les totaux comptent l’estimé, le réel, et DISENT ce que le réel ne dit pas (§4.4)', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		const totaux = section.getByTestId('couts-totaux')
		// 100 + 350 estimés ; 375 de réel, parce que le réel inconnu de « Publicité » NE COMPTE PAS.
		await expect(totaux).toContainText('estimé 450.00')
		await expect(totaux).toContainText('réel 375.00')
		// Sans cette mention, 375 sur 450 se lirait comme une économie.
		await expect(section.getByTestId('couts-sans-reel')).toContainText('1 ligne(s) sans coût réel')
		await expect(section.getByTestId('couts-sans-reel')).toContainText('100.00 EUR')
	})
})

// -------------------------------------------------------------------------------------------
// S2. La double condition de lecture, par le cas qui la motive (§3.1)
// -------------------------------------------------------------------------------------------

test.describe('la double condition de lecture (docs/SPEC-costs.md §3.1)', () => {
	test('la lectrice voit l’affaire et AUCUNE de ses lignes, dont le budget lui est fermé', async ({
		page,
	}) => {
		// Sans ce scénario, une régression qui retirerait `app.can_read_budget` de la politique
		// passerait inaperçue : la condition sur la card seule rendrait la ligne, et l'écran
		// divulguerait le nom et le montant d'un budget interdit.
		await connecter(page, VIEWER)
		const section = await ouvrirSectionCouts(page, AFFAIRE_BUDGET_FERME.adresse)
		await expect(section.getByTestId('ligne-cout')).toHaveCount(0)
		await expect(section.getByTestId('couts-vide')).toBeVisible()
		// Et aucun total n'est rendu : un total calculé sur zéro ligne afficherait « estimé 0.00 »,
		// ce qui affirmerait que cette affaire n'a rien coûté.
		await expect(section.getByTestId('couts-totaux')).toHaveCount(0)
	})
})

// -------------------------------------------------------------------------------------------
// S3. Le sélecteur de budget, et le SECOND sélecteur d'occurrence — le cœur du §4.6
// -------------------------------------------------------------------------------------------

test.describe('les deux sélecteurs (docs/SPEC-costs.md §4.6, §4.7)', () => {
	test('le sélecteur ne propose que les budgets OUVERTS du track de la card', async ({ page }) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()

		const selecteur = section.getByTestId('cout-selecteur-budget')
		await expect(selecteur).toBeVisible()
		const options = await selecteur.locator('option').allTextContents()

		// « Publicité 2026 » est ouvert et récurrent, avec une occurrence ouverte : il est proposé.
		expect(options.join('\n')).toContain(BUDGET_RECURRENT)
		// « Salon du web 2025 » est CLÔTURÉ : il ne l'est pas.
		expect(options.join('\n')).not.toContain(BUDGET_CLOTURE)
		// « Prospection sortante » et « Suisse romande » vivent sur d'AUTRES tracks : la base les
		// accepterait — le §3.1 nomme le rattachement croisé —, mais le sélecteur ne les propose pas.
		expect(options.join('\n')).not.toContain('Prospection sortante')
		expect(options.join('\n')).not.toContain('Suisse romande')
	})

	test('le second sélecteur APPARAÎT sur un budget récurrent, et devient obligatoire', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')

		// Tant qu'aucun budget n'est choisi, il n'y a pas d'occurrence à choisir.
		await expect(formulaire.getByTestId('cout-selecteur-occurrence')).toHaveCount(0)

		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		const occurrence = formulaire.getByTestId('cout-selecteur-occurrence')
		await expect(occurrence).toBeVisible()

		// Il ne propose que les occurrences OUVERTES : « Janvier 2026 » est clôturée.
		const options = await occurrence.locator('option').allTextContents()
		expect(options.join('\n')).toContain(OCCURRENCE_OUVERTE)
		expect(options.join('\n')).not.toContain(OCCURRENCE_CLOSE)

		// OBLIGATOIRE : le formulaire refuse de partir tant qu'aucune occurrence n'est choisie, même
		// tous les autres champs remplis. Le trigger de `0051` le refuserait de toute façon ; l'écran
		// n'offre pas un geste dont la réponse est connue d'avance.
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} occurrence`)
		await formulaire.getByLabel('Coût estimé').fill('42')
		await expect(formulaire.getByRole('button', { name: 'Ajouter' })).toBeDisabled()

		await occurrence.selectOption({ label: OCCURRENCE_OUVERTE })
		await expect(formulaire.getByRole('button', { name: 'Ajouter' })).toBeEnabled()
	})

	test('changer de budget OUBLIE l’occurrence choisie', async ({ page }) => {
		// Conservée, elle partirait avec un budget auquel elle n'appartient pas, et le trigger
		// rendrait « cette occurrence appartient à un autre budget » — un refus que l'utilisateur
		// n'a pas provoqué.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')

		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await expect(formulaire.getByTestId('cout-selecteur-occurrence')).toHaveValue(/.+/)

		// Retour à « aucun budget » : le second sélecteur disparaît avec son choix.
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: 'Choisir un budget' })
		await expect(formulaire.getByTestId('cout-selecteur-occurrence')).toHaveCount(0)
	})
})

// -------------------------------------------------------------------------------------------
// S4. Les trois écritures, au clavier et à la souris
// -------------------------------------------------------------------------------------------

test.describe('ajouter, modifier, supprimer une dépense (docs/SPEC-costs.md §4.6)', () => {
	test('une dépense est ajoutée SANS réel, et la mention du §4.4 la compte aussitôt', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')

		// Le focus entre dans le PREMIER champ à l'ouverture (§5.13) : il n'est pas posé ici, il est
		// constaté.
		await expect(formulaire.getByLabel('Nature de la dépense')).toBeFocused()

		await page.keyboard.type(`${PREFIXE} ajout`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('60')
		// Le réel est laissé VIDE : c'est l'état normal d'une dépense en cours (§2.3).
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()

		await expect(formulaire).toBeHidden()
		const ajoutee = section.getByRole('row', { name: new RegExp(`${PREFIXE} ajout`) })
		await expect(ajoutee).toBeVisible()
		await expect(ajoutee.getByTestId('cout-cellule-reel')).toContainText('—')

		// Le total et la mention ont suivi : 450 + 60 estimés, et DEUX lignes en attente.
		await expect(section.getByTestId('couts-totaux')).toContainText('estimé 510.00')
		await expect(section.getByTestId('couts-sans-reel')).toContainText('2 ligne(s) sans coût réel')
	})

	test('saisir 0 comme réel retire la ligne de l’attente — zéro est une valeur', async ({ page }) => {
		// « Zéro est une valeur, pas un vide » (§4.8) : saisir 0 dit « finalement rien dépensé »,
		// laisser vide dit « on ne sait pas encore ». La distinction se voit ici sur le compte.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} zero`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('80')
		await formulaire.getByTestId('cout-champ-reel').fill('0')
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()

		const ajoutee = section.getByRole('row', { name: new RegExp(`${PREFIXE} zero`) })
		await expect(ajoutee.getByTestId('cout-cellule-reel')).toContainText('0.00')
		// Le compte des lignes en attente n'a PAS bougé : la ligne à zéro est saisie.
		await expect(section.getByTestId('couts-sans-reel')).toContainText('1 ligne(s) sans coût réel')
	})

	test('une dépense est modifiée, et son réel saisi après coup', async ({ page }) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		let formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} modif`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('60')
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()
		await expect(section.getByRole('row', { name: new RegExp(`${PREFIXE} modif`) })).toBeVisible()

		await section.getByRole('button', { name: `Modifier la dépense ${PREFIXE} modif` }).click()
		formulaire = section.getByTestId('formulaire-cout')
		// Le formulaire s'ouvre SUR la valeur existante : il modifie, il ne recommence pas.
		await expect(formulaire.getByLabel('Coût estimé')).toHaveValue('60')
		await formulaire.getByTestId('cout-champ-reel').fill('58.50')
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()

		const modifiee = section.getByRole('row', { name: new RegExp(`${PREFIXE} modif`) })
		await expect(modifiee.getByTestId('cout-cellule-reel')).toContainText('58.50')
		// La ligne a quitté l'attente, et la mention le dit.
		await expect(section.getByTestId('couts-sans-reel')).toContainText('1 ligne(s) sans coût réel')
	})

	test('une dépense est supprimée, après une confirmation dans le flux du document', async ({
		page,
	}) => {
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} suppr`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('12')
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()
		await expect(section.getByRole('row', { name: new RegExp(`${PREFIXE} suppr`) })).toBeVisible()

		await section.getByRole('button', { name: `Supprimer la dépense ${PREFIXE} suppr` }).click()
		const confirmation = section.getByTestId('confirmation-suppression-cout')
		// Dans le FLUX, jamais en modale (§5.13) — et le focus entre sur son premier bouton.
		await expect(confirmation).toBeVisible()
		await expect(confirmation.getByRole('button', { name: 'Supprimer' })).toBeFocused()
		await expect(confirmation).toContainText(`${PREFIXE} suppr`)
		await confirmation.getByRole('button', { name: 'Supprimer' }).click()

		await expect(section.getByRole('row', { name: new RegExp(`${PREFIXE} suppr`) })).toHaveCount(0)
		// Le seed est intact : les deux lignes d'origine sont là.
		await expect(section.getByTestId('ligne-cout')).toHaveCount(2)
	})

	test('le parcours complet se mène AU CLAVIER SEUL', async ({ page }) => {
		// `docs/DESIGN_SYSTEM.md` §8 et `CLAUDE.md` §22 : une interface visuellement correcte mais
		// inutilisable au clavier n'est pas terminée. Le focus est atteint par `Tab`, jamais par
		// `focus()`.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		const commande = section.getByRole('button', { name: 'Ajouter une dépense' })
		await commande.scrollIntoViewIfNeeded()
		await tabVers(page, commande)
		await page.keyboard.press('Enter')

		const formulaire = section.getByTestId('formulaire-cout')
		await expect(formulaire.getByLabel('Nature de la dépense')).toBeFocused()
		await page.keyboard.type(`${PREFIXE} clavier`)
		await page.keyboard.press('Tab')
		// Le sélecteur de budget est atteint : il est choisi au clavier, par son libellé.
		await expect(formulaire.getByTestId('cout-selecteur-budget')).toBeFocused()
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('7')
		await tabVers(page, formulaire.getByRole('button', { name: 'Ajouter' }))
		await page.keyboard.press('Enter')

		await expect(section.getByRole('row', { name: new RegExp(`${PREFIXE} clavier`) })).toBeVisible()
	})
})

// -------------------------------------------------------------------------------------------
// S5. La ligne d'un budget clôturé — la frontière exacte du §2.3
// -------------------------------------------------------------------------------------------

test.describe('une ligne rattachée à un budget clôturé (docs/SPEC-costs.md §2.3)', () => {
	test('sa suppression est ÉTEINTE AVEC SON MOTIF, jamais masquée (§5.13)', async ({ page }) => {
		// Ce n'est pas un droit de l'utilisateur : la politique de suppression exige
		// `app.budget_est_ouvert`, et refuse ce geste à TOUT LE MONDE sur un budget clos. Masquer la
		// commande ferait passer une décision de la base pour une décision d'écran.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		const commande = section.getByRole('button', { name: 'Supprimer la dépense Production' })
		await expect(commande).toBeVisible()
		await expect(commande).toBeDisabled()
		await expect(commande).toHaveAttribute('title', /clôturés/)
	})

	test('sa MODIFICATION reste ouverte : on clôt une campagne PUIS les factures arrivent', async ({
		page,
	}) => {
		// C'est la frontière que le §2.3 tranche, et elle ne se devine pas : `actual_cost` et `label`
		// oui, `budget_id` et `occurrence_id` non. Interdire la saisie du réel obligerait à rouvrir
		// le budget, ou à renoncer à la seule donnée qui rend la comparaison honnête.
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Modifier la dépense Production' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await expect(formulaire).toBeVisible()

		// LE BUDGET CLÔTURÉ EST PRÉSENT DANS LE SÉLECTEUR — sans lui, celui-ci retomberait sur
		// « aucun budget » et le formulaire refuserait de partir, rendant la ligne inmodifiable.
		const options = await formulaire.getByTestId('cout-selecteur-budget').locator('option').allTextContents()
		expect(options.join('\n')).toContain(BUDGET_CLOTURE)

		await formulaire.getByTestId('cout-champ-reel').fill('380')
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(formulaire).toBeHidden()
		const production = section.getByRole('row', { name: /Production/ })
		await expect(production.getByTestId('cout-cellule-reel')).toContainText('380.00')

		// LE SEED EST RENDU INTACT : la valeur d'origine est remise par le même geste d'écran.
		await section.getByRole('button', { name: 'Modifier la dépense Production' }).click()
		const retour = section.getByTestId('formulaire-cout')
		await retour.getByTestId('cout-champ-reel').fill('375')
		await retour.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(section.getByRole('row', { name: /Production/ }).getByTestId('cout-cellule-reel')).toContainText(
			'375.00',
		)
	})
})

// -------------------------------------------------------------------------------------------
// S6. Le refus d'écriture, sur les vrais droits (§3.2)
// -------------------------------------------------------------------------------------------

test.describe('la lecture seule (docs/SPEC-costs.md §3.2, §4.7)', () => {
	test('la lectrice se voit refuser l’ajout, et l’écran NOMME le refus', async ({ page }) => {
		// La commande n'est pas masquée sur la foi d'un rôle : l'écriture PART, et le refus du
		// backend est traduit.
		await connecter(page, VIEWER)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} refus`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('9')
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()

		const refus = formulaire.getByTestId('cout-refus')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText('droit')
		// Aucune ligne n'a été ajoutée.
		await expect(section.getByRole('row', { name: new RegExp(`${PREFIXE} refus`) })).toHaveCount(0)

		// LE `403` QUE CE SCÉNARIO PROVOQUE est un chargement de ressource en échec, que Chromium
		// journalise, et l'écran vient d'en rendre le refus lisible à l'utilisateur. Il est consommé
		// NOMMÉMENT — statut, nombre et ordre exacts —, jamais filtré globalement, de sorte qu'un
		// second refus inattendu ferait toujours rougir le verdict final.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
	})
})

// -------------------------------------------------------------------------------------------
// S7. Paliers et captures — CLAUDE.md §16
// -------------------------------------------------------------------------------------------

test.describe('paliers responsive', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la section reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			const section = await ouvrirSectionCouts(page)
			await expect(section.getByTestId('tableau-couts')).toBeVisible()

			// La PAGE ne défile pas horizontalement : le débordement appartient au conteneur du
			// tableau, qui l'indique (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await section.scrollIntoViewIfNeeded()
			await capturer(page, `couts-${palier.nom}`, UNITE)
		})
	}

	test('le formulaire, avec son second sélecteur, est capturé', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await expect(formulaire.getByTestId('cout-selecteur-occurrence')).toBeVisible()
		await formulaire.scrollIntoViewIfNeeded()
		await capturer(page, 'couts-formulaire-occurrence', UNITE)
	})

	test('la confirmation de suppression est capturée, dans le flux', async ({ page, request }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const section = await ouvrirSectionCouts(page)
		await section.getByRole('button', { name: 'Ajouter une dépense' }).click()
		const formulaire = section.getByTestId('formulaire-cout')
		await formulaire.getByLabel('Nature de la dépense').fill(`${PREFIXE} capture`)
		await formulaire.getByTestId('cout-selecteur-budget').selectOption({ label: `${BUDGET_RECURRENT} (EUR)` })
		await formulaire.getByTestId('cout-selecteur-occurrence').selectOption({ label: OCCURRENCE_OUVERTE })
		await formulaire.getByLabel('Coût estimé').fill('30')
		await formulaire.getByRole('button', { name: 'Ajouter' }).click()

		await section.getByRole('button', { name: `Supprimer la dépense ${PREFIXE} capture` }).click()
		const confirmation = section.getByTestId('confirmation-suppression-cout')
		await expect(confirmation).toBeVisible()
		await confirmation.scrollIntoViewIfNeeded()
		await capturer(page, 'couts-confirmation-suppression', UNITE)
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await purger(request)
	})
})

/**
 * Avance le focus par `Tab` jusqu'à ce que `cible` devienne l'élément actif, ou échoue en le
 * nommant. Jamais de `focus()` programmatique — voir l'en-tête.
 */
async function tabVers(page: Page, cible: Locator, max = 160): Promise<void> {
	for (let tentative = 0; tentative < max; tentative++) {
		if (
			await cible
				.evaluate((element: Element) => element === document.activeElement)
				.catch(() => false)
		) {
			return
		}
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}
