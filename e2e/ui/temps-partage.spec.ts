// @verifies CRM-111 (docs/BACKLOG.md) — tranche T4.2 : la saisie partagée dans le rapport de temps et sous la série
//           « Personnel » du track, à l'écran
// @verifies docs/DESIGN_SYSTEM.md §5.54 (« La saisie partagée » : pilule neutre de la forme de « partielle », §5.60 ;
//           mention sous le tableau ; rien dans « Temps passé »), docs/SPEC-temps.md §7.3, §7.5,
//           docs/SPEC-rattachements.md §6 ; CLAUDE.md §15, §16
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service, que l'administratrice rattache à
// `grands-comptes` (track « Conseil & IA ») par `attach_card`, puis à `maintenance` (même track que `refonte`). Les
// saisies portent sur mai 2099, hors de toute fenêtre du seed ; tout est retiré après chaque scénario.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { posterAffaire } from '../affaire'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-111'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const W = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const TITRE = 'Portail partagé des adhérents'
const PARTAGE = /^Saisie partagée : cette affaire est rattachée à plusieurs channels/

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const service = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=minimal' })

test.use({ viewport: { width: 1440, height: 900 } })

let affaire = ''

async function poser(requete: APIRequestContext, channels: readonly string[]): Promise<void> {
	affaire = randomUUID()
	const pose = await posterAffaire(requete, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_INITIALE, title: TITRE },
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const jeton = await jetonDe(ADMIN)
	for (const channel of channels) {
		const rattache = await requete.post(rest('rpc/attach_card'), {
			headers: enTetesAuthentifies(jeton),
			data: { p_card: affaire, p_channel: channel },
		})
		expect(rattache.status(), await rattache.text()).toBe(200)
	}
	const saisies = await requete.post(rest('saisies_temps'), {
		headers: service(),
		data: [
			{ workspace_id: W, profile_id: CAMILLE, jour: '2099-05-04', minutes: 210, card_id: affaire },
			{ workspace_id: W, profile_id: FARIDA, jour: '2099-05-04', minutes: 105, card_id: affaire },
		],
	})
	expect(saisies.status(), await saisies.text()).toBe(201)
}

test.afterEach(async ({ request }) => {
	if (affaire === '') return
	await request.delete(rest(`saisies_temps?card_id=eq.${affaire}`), { headers: enTetesService() })
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
	affaire = ''
})

test('l’administratrice lit l’affaire sous ses deux channels, marquée « partagée », le total compté une fois', async ({ page, request }) => {
	await poser(request, [GRANDS_COMPTES])
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/temps?onglet=rapport&mois=2099-05')
	await expect(page.getByTestId('temps-rapport')).toBeVisible()

	const lignes = page.getByTestId('temps-rapport-ligne').filter({ hasText: TITRE })
	await expect(lignes).toHaveCount(2)
	for (const ligne of await lignes.all()) {
		await expect(ligne.getByRole('img', { name: PARTAGE })).toBeVisible()
		await expect(ligne).toContainText('3 h 30')
	}
	// Deux lignes de même nom : chacune nomme son chemin (défaut vu sur la première capture, §5.54).
	await expect(page.getByTestId('temps-partagee-chemin')).toHaveText(['Conseil & IA › Grands comptes', 'Studio web › Refonte de site'])
	// Une seule saisie de 3 h 30, montrée deux fois : le total la compte une fois.
	await expect(page.getByTestId('temps-rapport-total')).toHaveText('3 h 30')
	await expect(page.getByTestId('temps-partagee-mention')).toHaveText(
		'Une saisie sur une affaire rattachée à plusieurs channels paraît sous chacun ; le total ne la compte qu’une fois.',
	)
	// La pilule est moulée sur son mot, jamais la cellule entière (§5.31), et le mot ne se coupe pas.
	const pilule = await lignes.first().getByTestId('temps-partagee').boundingBox()
	const cellule = await lignes.first().getByRole('rowheader').boundingBox()
	expect(pilule!.width).toBeLessThan(cellule!.width)
	expect(pilule!.height).toBeLessThan(24)
	await capturer(page, 'temps-rapport-partage-xl-1440', UNITE)

	// Palier 390 : le tableau défile dans son conteneur, la page jamais ; la pilule tient sur une ligne.
	// Le palier se prend à l'ouverture de l'écran : redimensionnée sur place, la coquille gardait le tiroir ouvert
	// par-dessus le rapport (vu sur la capture).
	await page.setViewportSize({ width: 390, height: 844 })
	await page.reload()
	await expect(lignes).toHaveCount(2)
	await expect(page.getByRole('dialog')).toHaveCount(0)
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
	expect((await lignes.first().getByTestId('temps-partagee').boundingBox())!.height).toBeLessThan(24)
	await capturer(page, 'temps-rapport-partage-sm-390', UNITE)
})

test('la lectrice, fermée à « Conseil & IA », lit sa saisie sous le seul channel qu’elle lit, sans marque ni mention', async ({ page, request }) => {
	await poser(request, [GRANDS_COMPTES])
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto('/temps?onglet=rapport&mois=2099-05')
	const lignes = page.getByTestId('temps-rapport-ligne').filter({ hasText: TITRE })
	await expect(lignes).toHaveCount(1)
	await expect(lignes.first()).toContainText('1 h 45')
	await expect(page.getByTestId('temps-partagee')).toHaveCount(0)
	await expect(page.getByTestId('temps-partagee-mention')).toHaveCount(0)
	await expect(page.getByText('Grands comptes')).toHaveCount(0)
	await capturer(page, 'temps-rapport-partage-lectrice-xl-1440', UNITE)
})

test('la série « Personnel » du track : la mention quand la saisie paraît sous deux de ses channels', async ({ page, request }) => {
	await poser(request, [MAINTENANCE])
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/couts?mois=2099-05')
	const bloc = page.getByTestId('personnel-track')
	await expect(bloc).toBeVisible()
	// Camille 3 h 30 et Farida 1 h 45, chacune sous « Refonte de site » et sous « Maintenance » ; le total, une fois.
	await expect(bloc.getByTestId('personnel-ligne').filter({ hasText: 'Refonte de site' })).toContainText('5 h 15')
	await expect(bloc.getByTestId('personnel-ligne').filter({ hasText: 'Maintenance' })).toContainText('5 h 15')
	await expect(bloc.getByTestId('personnel-total')).toHaveText('5 h 15')
	await expect(bloc.getByTestId('temps-partagee-mention')).toBeVisible()
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'personnel-track-partage-xl-1440', UNITE)
})
