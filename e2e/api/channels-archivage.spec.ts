// @verifies CRM-134 (docs/BACKLOG.md) tranche T1 — archiver et désarchiver un channel depuis sa vue : l'écriture de
//           Réglages, sous les jetons réels, et ce que la barre lit
// @verifies docs/SPEC-channels.md §11.1 (la lecture de la barre rapporte les archivés du track, la corbeille écartée),
//           §11.2 et §11.3 (archiver, désarchiver : un `PATCH` d'`archived_at`), §11.4 (droits inchangés : seule
//           l'administratrice écrit ; tout membre qui lit le track voit les archivés), §6.1 ; CLAUDE.md §10 (la règle se
//           prouve hors interface, avec le jeton réel de chaque profil)
//
// Un `PATCH` que la politique écarte ne rend pas d'erreur : PostgREST répond `200` avec un tableau VIDE. Ce sont le
// nombre de lignes rendues, puis la RELECTURE par la clé de service, qui prouvent le refus — jamais le seul statut.
//
// LA SONDE EST UN CHANNEL PROPRE À CE FICHIER, créé par la clé de service dans « Formation » et retiré en fin de fichier
// quoi qu'il arrive : archiver un channel du seed ferait disparaître un onglet sous les preuves d'écran qui tournent en
// même temps.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'
/** La lecture de la barre d'onglets, telle que `lireChannels` l'émet depuis `CRM-134` (§11.1). */
const LECTURE_BARRE = `/rest/v1/channels?select=id,name,slug,position,workflow_id,description,color,archived_at&track_id=eq.${TRACK_FORMATION}&deleted_at=is.null&order=position,name`

test.describe.configure({ mode: 'serial' })

let idSonde = ''
let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
	const suffixe = Date.now().toString(36)
	const reponse = await request.post('/rest/v1/channels', {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE_SEED,
			track_id: TRACK_FORMATION,
			workflow_id: WORKFLOW_SEED,
			name: `Sonde archivage ${suffixe}`,
			slug: `sonde-archivage-${suffixe}`,
			position: 999,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	idSonde = ((await reponse.json()) as { id: string }[])[0]!.id
})

test.afterAll(async ({ request }) => {
	if (idSonde === '') return
	const reponse = await request.delete(`/rest/v1/channels?id=eq.${idSonde}`, { headers: enTetesService() })
	expect(reponse.status(), 'la sonde est retirée').toBe(204)
})

async function archivage(request: APIRequestContext): Promise<string | null> {
	const reponse = await request.get(`/rest/v1/channels?id=eq.${idSonde}&select=archived_at`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as { archived_at: string | null }[]
	expect(lignes).toHaveLength(1)
	return lignes[0]!.archived_at
}

async function ecrire(request: APIRequestContext, jeton: string, archive: boolean) {
	return request.patch(`/rest/v1/channels?id=eq.${idSonde}&select=id`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: { archived_at: archive ? new Date().toISOString() : null },
	})
}

test('A1 — l’administratrice archive le channel : une ligne rendue, `archived_at` relu', async ({ request }) => {
	const reponse = await ecrire(request, jetonAdmin, true)
	expect(reponse.status()).toBe(200)
	expect((await reponse.json()) as unknown[]).toEqual([{ id: idSonde }])
	expect(await archivage(request)).not.toBeNull()
})

for (const [profil, jeton] of [
	['le business developer', () => jetonBizdev],
	['la lectrice', () => jetonViewer],
] as const) {
	test(`A2 — ${profil} ne DÉSARCHIVE pas : aucune ligne rendue, la ligne relue inchangée`, async ({ request }) => {
		const avant = await archivage(request)
		const reponse = await ecrire(request, jeton(), false)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
		expect(await archivage(request)).toBe(avant)
	})
}

test('A3 — la lecture de la barre rend l’archivé, sous le jeton de l’administratrice comme sous celui de la lectrice', async ({
	request,
}) => {
	for (const jeton of [jetonAdmin, jetonViewer]) {
		const reponse = await request.get(LECTURE_BARRE, { headers: enTetesAuthentifies(jeton) })
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as { id: string; archived_at: string | null }[]
		const sonde = lignes.find((ligne) => ligne.id === idSonde)
		expect(sonde, 'l’archivé est rapporté par la lecture de la barre').toBeDefined()
		expect(sonde!.archived_at).not.toBeNull()
		// Les channels actifs du track y sont aussi : une seule lecture pour les onglets et le groupe.
		expect(lignes.some((ligne) => ligne.archived_at === null)).toBe(true)
	}
})

test('A4 — l’administratrice désarchive : une ligne rendue, `archived_at` relu NUL', async ({ request }) => {
	const reponse = await ecrire(request, jetonAdmin, false)
	expect(reponse.status()).toBe(200)
	expect((await reponse.json()) as unknown[]).toEqual([{ id: idSonde }])
	expect(await archivage(request)).toBeNull()
})

for (const [profil, jeton] of [
	['le business developer', () => jetonBizdev],
	['la lectrice', () => jetonViewer],
] as const) {
	test(`A5 — ${profil} n’ARCHIVE pas : aucune ligne rendue, la ligne relue toujours active`, async ({ request }) => {
		const reponse = await ecrire(request, jeton(), true)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
		expect(await archivage(request)).toBeNull()
	})
}

test('A6 — un channel à la corbeille n’est PAS rapporté par la lecture de la barre, archivé ou non', async ({ request }) => {
	const corbeille = await request.patch(`/rest/v1/channels?id=eq.${idSonde}`, {
		headers: enTetesService(),
		data: { deleted_at: new Date().toISOString(), archived_at: new Date().toISOString() },
	})
	expect(corbeille.status()).toBe(204)
	const reponse = await request.get(LECTURE_BARRE, { headers: enTetesAuthentifies(jetonAdmin) })
	const lignes = (await reponse.json()) as { id: string }[]
	expect(lignes.some((ligne) => ligne.id === idSonde)).toBe(false)
})
