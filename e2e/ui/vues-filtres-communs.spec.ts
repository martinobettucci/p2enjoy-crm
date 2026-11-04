// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.d.2 : une vue sauvegardée retient les filtres de champ (relus en base sous
//           leur forme structurée), les rouvre, dit « Filtres modifiés » quand ils s'en écartent ; l'export CSV les applique ;
//           le panneau ne dit plus le contraire
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.d) ; docs/SPEC-vues-import-export.md §2.2 ; docs/DESIGN_SYSTEM.md
//           §5.92, §5.75 ; docs/JOURNAL.md décisions 837 et 838 ; CLAUDE.md §15, §16
//
// Les champs de sonde portent le préfixe `sonde-112-vf`, les affaires le titre `tst-crm112-vf`, les vues le nom
// `tst-crm112-vf` ; la clé de service les pose dans « Grands comptes » et les retire après chaque scénario — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const LISTE = '/tracks/conseil-ia/grands-comptes/liste'
const PREFIXE = 'sonde-112-vf'
const TITRE = 'tst-crm112-vf'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`saved_views?name=like.${TITRE}*`), { headers: enTetesService() })
	for (const { id } of await lireService<{ id: string }>(request, `cards?select=id&title=like.${TITRE}*`)) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `saved_views?select=id&name=like.${TITRE}*`)).toEqual([])
	expect(await lireService(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** Un champ « Secteur » ; deux affaires de sonde, A en BTP, B en Santé. */
async function poser(request: APIRequestContext): Promise<{ readonly A: string; readonly B: string }> {
	const reponse = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			key: `${PREFIXE}-secteur`,
			label: 'Secteur (sonde vues)',
			type: 'select',
			options: { choices: [{ key: 'btp', label: 'BTP' }, { key: 'sante', label: 'Santé' }] },
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [champ] = (await reponse.json()) as { id: string }[]
	const affaires = { A: randomUUID(), B: randomUUID() }
	for (const [lettre, idCard] of Object.entries(affaires)) {
		const creation = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: `${TITRE} ${lettre}` },
		})
		expect(creation.status(), await creation.text()).toBe(201)
	}
	const valeurs = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: [
			{ card_id: affaires.A, field_id: champ?.id, workspace_id: ESPACE, value: 'btp' },
			{ card_id: affaires.B, field_id: champ?.id, workspace_id: ESPACE, value: 'sante' },
		],
	})
	expect(valeurs.status(), await valeurs.text()).toBe(201)
	return affaires
}

test.use({ viewport: { width: 1440, height: 1000 } })

test('une vue retient le filtre de champ, le rouvre, dit l’écart ; l’export l’applique', async ({ page, request }) => {
	const affaires = await poser(request)
	await connecterAvecLeLabs(page, ADMIN)
	// Le filtre « BTP », posé par l'adresse comme le panneau l'écrirait.
	await page.goto(`${LISTE}?c.${PREFIXE}-secteur=btp`)
	await expect(page.getByTestId('ouvrir-filtres-communs')).toHaveText('Champs de l’affaire (1)')
	await page.getByTestId('ouvrir-filtres-communs').click()
	await expect(page.getByText(/ne retiennent pas encore ces filtres/)).toHaveCount(0)
	await page.getByTestId('fermer-filtres-communs').click()

	// Enregistrer la vue : la base garde la forme structurée.
	await page.getByTestId('vue-enregistrer').click()
	const panneau = page.getByTestId('panneau-vue')
	await panneau.getByLabel('Nom de la vue').fill(`${TITRE} BTP`)
	await panneau.getByTestId('panneau-vue-valider').click()
	await expect(panneau).toHaveCount(0)
	await expect
		.poll(async () => (await lireService<{ filters: unknown }>(request, `saved_views?select=filters&name=eq.${encodeURIComponent(`${TITRE} BTP`)}`))[0]?.filters)
		.toEqual({ common_fields: { [`${PREFIXE}-secteur`]: { any_of: ['btp'] } } })

	// Rouvrir la vue depuis la liste nue : le filtre de champ revient.
	await page.goto(LISTE)
	await page.getByRole('combobox', { name: 'Vue', exact: true }).selectOption({ label: `${TITRE} BTP` })
	await expect(page).toHaveURL(new RegExp(`c\\.${PREFIXE}-secteur=btp`))
	await expect(page.getByTestId('vue-ecart')).toHaveCount(0)
	await expect
		.poll(async () => (await page.getByTestId('ligne-card').getByRole('link').allTextContents()).filter((t) => t.startsWith(TITRE)))
		.toEqual([`${TITRE} A`])

	// L'export applique le filtre : les seules affaires du channel en BTP — l'affaire A.
	const attente = page.waitForEvent('download')
	await page.getByTestId('exporter-affaires').click()
	const contenu = await readFile(await (await attente).path(), 'utf8')
	const titres = contenu.slice(1).split('\r\n').filter((r) => r !== '').slice(1).map((r) => r.split(';')[1])
	expect(titres).toEqual([`${TITRE} A`])
	expect(contenu).toContain(affaires.A)

	// Changer le filtre de champ : la vue reste nommée, l'écart est dit.
	await page.getByTestId('ouvrir-filtres-communs').click()
	await page.getByTestId('panneau-filtres-communs').getByLabel('Santé').check()
	await page.getByTestId('appliquer-filtres-communs').click()
	await expect(page.getByTestId('vue-ecart')).toHaveText('Filtres modifiés depuis la vue')
	await capturer(page, 'vues-filtres-communs-ecart-xl-1440', UNITE)
})
