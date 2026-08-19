// @verifies CRM-086 (docs/BACKLOG.md) — la barre d'onglets porte une entrée transverse de track
// @verifies CRM-012 (docs/BACKLOG.md) — droits fins par track et channel, vus à l'écran
// @verifies docs/SPEC-permissions-rls.md §3.3 à §3.5 (« le plus spécifique gagne »), §4.1, §4.2
// @verifies docs/SPEC-tracks.md §7 (ce que la barre latérale lit) ; docs/SPEC-channels.md §5
// @verifies docs/DESIGN_SYSTEM.md §7 (paliers), §8 (clavier) ; CLAUDE.md §16 (vérification visuelle)
//
// CE QUE CES SCÉNARIOS PROUVENT.
//
// `CRM-012` était livrée et prouvée en base et par l'API, mais elle butait sur INC-021 : sans
// écran de connexion, la webapp restait un appelant anonyme, à qui un droit fin est invisible
// puisqu'il n'a déjà aucun accès. INC-021 est close depuis `CRM-009`, et la preuve manquante
// devient possible : deux personnes réelles se connectent, au clavier et à la souris, et voient
// **deux barres latérales différentes** produites par la même base et le même build.
//
// La matrice est celle du seed, et elle n'est pas fabriquée pour l'occasion :
//
//   Camille Aubert  administratrice  track « Conseil & IA » : access = none
//   Farida Nowak    lectrice         track « Conseil & IA » : access = none
//                                    channel « Prospection » : access = member
//
// Camille voit tout — « un administrateur n'est jamais restreint ».
//
// CE QUI A CHANGÉ, ET POURQUOI CES SCÉNARIOS SONT RÉVISÉS PLUTÔT QUE SUPPRIMÉS.
//
// Ils prouvaient que Farida NE VOIT PAS « Conseil & IA ». C'était vrai, et c'était le défaut :
// son `channel_members.access = 'member'` sur « Prospection » rouvrait bien le channel — le
// backend le rendait, une assertion pgTAP et la ligne f du §4.2 le prouvaient — mais la barre
// d'onglets ne liste les channels qu'une fois un track ouvert (`docs/SPEC-channels.md` §5.1).
// Aucun geste ne menait donc au channel consenti, et l'adresse saisie à la main rendait
// « Track introuvable ». Un droit accordé qui n'a pas de chemin n'est pas un droit : INC-085 et
// INC-075, tranchées par la décision 333.
//
// Ces scénarios prouvent désormais le contraire, et c'est exactement ce que le §3.3 bis demande
// de montrer : « Conseil & IA » EST rendu à Farida, avec son SEUL onglet « Prospection ».
//
// CE QU'ILS NE PROUVENT PAS. Ils ne rejouent pas la matrice complète : c'est l'objet de
// `supabase/tests/0011_droits_fins.test.sql` (71 assertions) et de `e2e/api/droits-fins.spec.ts`
// (15 scénarios), qui l'éprouvent hors interface, comme `CLAUDE.md` §10 l'exige. Ce fichier
// prouve que l'écran **obéit** à cette matrice, pas qu'elle est complète.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const RESTREINT = 'Conseil & IA'

/** Le channel que `channel_members.access = 'member'` rouvre à Farida sous ce track fermé. */
const CONSENTI = 'Prospection'

// Les deux autres channels du même track. « Grands comptes » est actif et qu'aucun droit fin ne
// rouvre : il est fermé par la politique. « Appels d'offres » est archivé dans le seed, donc absent
// pour une raison DIFFÉRENTE — la barre d'onglets ne liste que les channels actifs. Les deux sont
// vérifiés ensemble parce que l'onglet ne doit apparaître ni dans un cas ni dans l'autre, mais la
// distinction est nommée ici pour qu'une preuve ne passe jamais pour deux règles.
const FERMES_DU_TRACK = ['Grands comptes', "Appels d'offres"] as const

// « Pipeline 2024 » n'y figure pas, et ce n'est pas un oubli : le track est archivé dans le seed,
// et la barre latérale n'affiche que les tracks actifs (docs/SPEC-tracks.md §7). Le confondre avec
// un track fermé par un droit fin ferait passer une preuve pour deux règles différentes.
const VISIBLES_DE_TOUS = ['Studio web', 'Formation'] as const

/** Connexion réelle, au clavier seul : aucune session n'est injectée. */
async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

function tracksDeLaBarre(page: Page) {
	return page.getByTestId('barre-laterale').getByRole('link')
}

test('Farida voit le track fermé, parce qu’un de ses channels lui est rouvert', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'viewer@p2enjoy.test')

	// Le track fermé est PRÉSENT dans la barre. Ce n'est pas un relâchement d'interface : le
	// backend le rend désormais, parce que « le plus spécifique gagne » est devenu transitif.
	await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(1)
	for (const visible of VISIBLES_DE_TOUS) {
		await expect(tracksDeLaBarre(page).filter({ hasText: visible })).toHaveCount(1)
	}

	await capturer(page, 'droits-fins-lectrice-1440', 'CRM-012')
})

test('…et son ouverture n’expose que l’onglet consenti, à la souris', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'viewer@p2enjoy.test')

	// LE GESTE QUI MANQUAIT, et qui est tout l'objet de l'arbitrage : Farida ATTEINT son channel
	// en cliquant, sans connaître d'adresse. C'est ce chemin, et non la règle backend, qui
	// n'existait pas.
	await tracksDeLaBarre(page).filter({ hasText: RESTREINT }).click()

	// ASSERTION RÉVISÉE PAR `CRM-086`, NON AFFAIBLIE (mécanisme de la décision 51). Elle comptait
	// TOUS les liens de la barre d'onglets, et `1` valait alors « un seul channel ». La barre porte
	// depuis les **entrées transverses du track** — « Coûts » (`docs/DESIGN_SYSTEM.md` §4 et §12.1)
	// —, qui ne sont pas des channels : le compte global ne mesure donc plus ce que ce scénario
	// protège. Il porte désormais sur les onglets de CHANNEL, et la deuxième assertion nomme
	// explicitement ce que la barre a le droit de porter en plus — ce que « rien de plus » voulait
	// dire, écrit au lieu d'être déduit d'un nombre.
	const onglets = page.getByTestId('onglet-channel')
	await expect(onglets).toHaveCount(1)
	await expect(onglets.first()).toHaveText(CONSENTI)

	// « Et rien de plus » : la barre entière ne porte que cet onglet et l'entrée transverse du
	// track. Un troisième lien serait une régression, et cette assertion la verrait.
	const tousLesLiens = page.getByTestId('barre-onglets').getByRole('link')
	await expect(tousLesLiens).toHaveCount(2)
	await expect(page.getByTestId('onglet-couts-track')).toHaveCount(1)

	// Les deux autres channels du track restent fermés : l'élargissement de la politique de
	// `tracks` ne déteint pas sur celle des `channels` (§3.3 bis, deuxième tiret). Un track
	// réapparu avec un seul onglet est une information exacte, pas une anomalie d'affichage.
	for (const ferme of FERMES_DU_TRACK) {
		await expect(tousLesLiens.filter({ hasText: ferme })).toHaveCount(0)
	}

	await capturer(page, 'droits-fins-lectrice-track-rouvert-1440', 'CRM-012')
})

test('Camille porte le même refus et voit pourtant tout : un administrateur n’est jamais restreint', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'admin@p2enjoy.test')

	// La ligne `access = none` de Camille existe bel et bien dans le seed : c'est ce qui rend
	// cette capture démonstrative plutôt que tautologique.
	await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(1)
	for (const visible of VISIBLES_DE_TOUS) {
		await expect(tracksDeLaBarre(page).filter({ hasText: visible })).toHaveCount(1)
	}

	await capturer(page, 'droits-fins-administratrice-1440', 'CRM-012')
})

test('l’adresse directe du track rend la même chose que le clic, et rien de plus', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'viewer@p2enjoy.test')

	// Ce scénario mesurait « Track introuvable » : c'était le symptôme le plus net d'INC-085, un
	// droit accordé que même l'adresse exacte n'atteignait pas. Il mesure désormais que les deux
	// chemins — le clic et l'adresse — mènent au même endroit, sans qu'aucun n'ouvre davantage.
	await page.goto('/tracks/conseil-ia')

	await expect(page.getByText('Track introuvable')).toHaveCount(0)

	// Même révision qu'au scénario précédent, et pour son motif exact : la barre porte depuis
	// `CRM-086` une entrée transverse qui n'est pas un channel. Le compte des CHANNELS est ce que
	// « rien de plus » protège ; le compte total est vérifié à part, pour que la révision ne
	// desserre rien.
	const onglets = page.getByTestId('onglet-channel')
	await expect(onglets).toHaveCount(1)
	await expect(onglets.first()).toHaveText(CONSENTI)
	await expect(page.getByTestId('barre-onglets').getByRole('link')).toHaveCount(2)
	await expect(page.getByTestId('onglet-couts-track')).toHaveCount(1)

	// L'adresse d'un channel FERMÉ du même track, elle, reste refusée : atteindre le track ne
	// contourne pas la politique des channels.
	//
	// MESURÉ, ET CE N'EST PAS CE QU'ON ATTENDRAIT : l'écran ne dit pas « channel introuvable »,
	// il rend le MÊME état vide que « choisissez un channel ». C'est délibéré et documenté
	// (`webapp/src/app/RouteTrack.tsx`, docs/SPEC-permissions-rls.md §7) — distinguer les deux
	// renseignerait sur l'existence d'un channel refusé. La preuve vérifie donc les deux moitiés
	// de cette règle : l'écran neutre est rendu, et le nom du channel fermé n'apparaît nulle part.
	await page.goto('/tracks/conseil-ia/grands-comptes')
	await expect(page.getByText('Choisissez un channel')).toBeVisible()
	await expect(page.getByText('Grands comptes')).toHaveCount(0)

	await capturer(page, 'droits-fins-adresse-directe-1440', 'CRM-012')
})

// Un palier par scénario, chacun sur une page neuve : la taille est posée AVANT le premier rendu,
// comme pour une personne qui ouvre l'application sur son écran. Redimensionner une page déjà
// rendue éprouverait un `resize`, pas un palier.
test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la lectrice voit le track rouvert par son channel`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, 'viewer@p2enjoy.test')

			// Sous 1024 px la barre est un tiroir : il faut l'ouvrir pour la voir.
			if (palier.largeur < 1024) {
				await page.getByTestId('ouvrir-tiroir').click()
				await expect(page.getByTestId('barre-laterale')).toBeInViewport({ ratio: 0.99 })
			}

			await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(1)
			await expect(tracksDeLaBarre(page).filter({ hasText: 'Studio web' })).toHaveCount(1)

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)

			await capturer(page, `droits-fins-lectrice-${palier.nom}`, 'CRM-012')
		})
	}
})
