// @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.c : la partie commune de la fiche sur la pile réelle — le refus d'un
//           déplacement qui nomme un champ commun par son libellé, la reprise vers la fiche où il est demandé et prend le
//           focus, la saisie relue en base, le second déplacement qui passe ; l'archivé valué en lecture ; la lectrice
//           refusée par la base ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §5 et §7 (précision T3.c) ; docs/DESIGN_SYSTEM.md §5.88, §5.7 quater, §7
// @verifies CLAUDE.md §10 (le refus prouvé avec le jeton réel de la lectrice), §15, §16 (captures observées)
//
// Les champs de sonde portent le préfixe `sonde-112-fc` ; l'affaire de sonde est posée à « Prospection », d'où la transition
// « Relancer » (`…0071`) mène à « Relance ». La clé de service fait EXISTER le support ; chaque geste passe par la session
// réelle. Après chaque scénario, elle retire l'affaire, l'exigence et les champs — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	connecterAvecLeLabs,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const RELANCE = '5eed0000-0000-4000-8000-000000000062'
const TRANSITION = '5eed0000-0000-4000-8000-000000000071'
const BOARD = '/tracks/conseil-ia/grands-comptes'
const CLE = 'sonde-112-fc'
const CLE_ARCHIVE = 'sonde-112-fc-ancien'
const LIBELLE = 'SIRET (sonde fiche)'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	const cards = await lireService<{ id: string }>(request, `cards?select=id&title=like.${encodeURIComponent('tst-crm112-fc*')}`)
	for (const { id } of cards) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	const champs = await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${CLE}*`)
	for (const { id } of champs) {
		await request.delete(rest(`workflow_transition_required_common_fields?common_field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${CLE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

type Sonde = { readonly idCard: string; readonly titre: string; readonly idChamp: string }

/**
 * Le support : une affaire à « Prospection » ; un champ commun exigé par « Relancer » ; un champ archivé qui porte une
 * valeur sur l'affaire. Les champs et l'exigence sont posés par l'administratrice ; l'affaire et la valeur archivée, par
 * la clé de service — aucun écran ne les pose dans ce scénario.
 */
async function poser(request: APIRequestContext): Promise<Sonde> {
	const idCard = randomUUID()
	const titre = `tst-crm112-fc ${idCard.slice(0, 8)}`
	const creation = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: titre },
	})
	expect(creation.status(), await creation.text()).toBe(201)
	const admin = { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' }
	const champs = await request.post(rest('card_common_fields'), {
		headers: admin,
		data: [
			{ workspace_id: ESPACE, key: CLE, label: LIBELLE, type: 'text' },
			{ workspace_id: ESPACE, key: CLE_ARCHIVE, label: 'Ancien code (sonde fiche)', type: 'text' },
		],
	})
	expect(champs.status(), await champs.text()).toBe(201)
	const [champ, ancien] = (await champs.json()) as { id: string }[]
	const valeur = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: { card_id: idCard, field_id: ancien?.id, workspace_id: ESPACE, value: 'A-42' },
	})
	expect(valeur.status(), await valeur.text()).toBe(201)
	const archive = await request.patch(rest(`card_common_fields?id=eq.${ancien?.id}`), {
		headers: admin,
		data: { archived_at: new Date().toISOString() },
	})
	expect(archive.status(), await archive.text()).toBe(200)
	const exigence = await request.post(rest('workflow_transition_required_common_fields'), {
		headers: admin,
		data: { transition_id: TRANSITION, common_field_id: champ?.id },
	})
	expect(exigence.status(), await exigence.text()).toBe(201)
	return { idCard, titre, idChamp: champ?.id ?? '' }
}

const carte = (page: Page, idCard: string) => page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)

async function relancer(page: Page, sonde: Sonde): Promise<void> {
	await carte(page, sonde.idCard).getByRole('button', { name: `Actions ${sonde.titre}` }).click()
	await carte(page, sonde.idCard).getByRole('button', { name: 'Relancer' }).click()
}

test.describe('La partie commune de la fiche (docs/DESIGN_SYSTEM.md §5.88)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('refus nommé, reprise vers la fiche, saisie relue en base, second déplacement qui passe', async ({ page, request }) => {
		const sonde = await poser(request)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(BOARD)
		await expect(carte(page, sonde.idCard)).toBeVisible()

		// Le refus de la garde nomme le champ commun par son LIBELLÉ ; la clé part dans l'adresse.
		await relancer(page, sonde)
		await expect(page.getByTestId('refus-deplacement')).toHaveAttribute('data-cle', 'missing_required_fields')
		await expect(page.getByTestId('champs-manquants')).toContainText(LIBELLE)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'fiche-communs-refus-xl-1440', UNITE)

		await page.getByTestId('reprendre-saisie').click()
		await expect(page).toHaveURL(new RegExp(`/cards/${sonde.idCard}\\?exiges=${CLE}$`))
		const bloc = page.getByTestId('bloc-champs-communs')
		await expect(bloc.getByRole('heading', { level: 2, name: 'Champs de l’affaire' })).toBeVisible()
		const controle = page.locator(`#commun-${CLE}`)
		await expect(controle).toBeFocused()
		await expect(bloc.locator('[data-exige="true"]')).toHaveCount(1)
		// L'archivé qui porte une valeur reste lisible, marqué.
		await expect(bloc.getByTestId(`commun-archive-${CLE_ARCHIVE}`)).toContainText('A-42')
		await expect(bloc.getByTestId(`commun-archive-${CLE_ARCHIVE}`)).toContainText('Archivé')
		await capturer(page, 'fiche-communs-demande-xl-1440', UNITE)

		// La saisie, au clavier : elle s'enregistre seule à la sortie du champ.
		await page.keyboard.type('12345678900011')
		await page.keyboard.press('Tab')
		await expect
			.poll(async () =>
				(await lireService<{ value: unknown }>(request, `card_common_field_values?select=value&card_id=eq.${sonde.idCard}&field_id=eq.${sonde.idChamp}`)).map((v) => v.value),
			)
			.toEqual(['12345678900011'])

		// Le second déplacement passe : la base porte la nouvelle étape.
		await page.goto(BOARD)
		await relancer(page, sonde)
		await expect.poll(async () => (await lireService<{ current_step_id: string }>(request, `card_placements?select=current_step_id&card_id=eq.${sonde.idCard}`))[0]?.current_step_id).toBe(RELANCE)
	})

	test('la lectrice ne peut pas écrire une valeur commune : la base refuse l’écriture directe', async ({ request }) => {
		const sonde = await poser(request)
		const reponse = await request.post(rest('card_common_field_values'), {
			headers: enTetesAuthentifies(await jetonDe(LECTRICE)),
			data: { card_id: sonde.idCard, field_id: sonde.idChamp, workspace_id: ESPACE, value: 'pirate' },
		})
		expect(reponse.status(), 'la RLS refuse la valeur à la lectrice').toBe(403)
		expect(await lireService(request, `card_common_field_values?select=value&card_id=eq.${sonde.idCard}&field_id=eq.${sonde.idChamp}`)).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : le bloc dans le cadre, sans défilement de côté`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const sonde = await poser(request)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(`${BOARD}/cards/${sonde.idCard}`)
			const bloc = page.getByTestId('bloc-champs-communs')
			await bloc.scrollIntoViewIfNeeded()
			const cadre = await bloc.boundingBox()
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `fiche-communs-${palier.nom}`, UNITE)
		})
	}
})
