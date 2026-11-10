// @verifies CRM-135 (docs/BACKLOG.md) — la relève en échec s'écrit sur la boîte, la relève réussie la rend `ok`, et la veille
//           ne lit pas une boîte désactivée ; l'intégration contre la vraie base et le vrai service
// @verifies docs/SPEC-mail-subsystem.md §24.3 (l'échec et le succès écrits, `last_checked_at` intacte), §24.5 (`disabled`),
//           §24.7 (preuve d'intégration) ; docs/SCHEMA.md « Migration `0170` » ; INC-349 ; docs/JOURNAL.md décisions 873,
//           874 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// Le refus est RÉEL : un mauvais mot de passe posé par le vrai chemin d'écriture, puis une vraie session IMAP que le
// Stalwart de développement refuse. La veille de fond tourne pendant la preuve et peut relever la même boîte : elle écrit
// alors le même constat, et la preuve se juge sur l'état (§12.6, règle 1), jamais sur l'ordre des relèves.

import { expect, test } from '@playwright/test'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { changerMotDePasse, comptesAVeiller, lireBoite, poserStatut, relever } from '../releve'

const BIZDEV = 'bizdev@p2enjoy.test'
const FILTRE_DRISS = 'owner_id=eq.5eed0000-0000-4000-8000-000000000012'

test.describe.configure({ mode: 'serial' })

test('un mot de passe refusé écrit `error` et `auth_failed` sans toucher `last_checked_at` ; le bon remis, la relève rend `ok`', async () => {
	test.setTimeout(240_000)
	const avant = await lireBoite(FILTRE_DRISS)
	try {
		await changerMotDePasse(avant, BIZDEV, 'ce-mot-de-passe-est-faux')
		expect(relever(avant.id), 'la relève refusée rend 502').toBe(502)

		const echouee = await lireBoite(FILTRE_DRISS)
		expect(echouee).toMatchObject({ status: 'error', last_error: 'auth_failed' })
		expect(echouee.last_checked_at, 'la garde de 30 s du test ne se lit pas sur une relève').toBe(avant.last_checked_at)
		expect(echouee.last_sync_at, 'la dernière relève RÉUSSIE reste la précédente').toBe(avant.last_sync_at)
	} finally {
		// LA REMISE EN ÉTAT par le véritable parcours (§24.6) : le bon mot de passe, puis une vraie relève.
		await changerMotDePasse(avant, BIZDEV, MOT_DE_PASSE_SEED)
	}
	expect(relever(avant.id), 'la relève avec le bon mot de passe va au bout').toBe(200)
	const rendue = await lireBoite(FILTRE_DRISS)
	expect(rendue).toMatchObject({ status: 'ok', last_error: null })
	expect(rendue.last_sync_at).not.toBeNull()
})

test('la veille ne lit pas une boîte désactivée, et la relit une fois réactivée', async () => {
	const avant = await lireBoite(FILTRE_DRISS)
	expect(comptesAVeiller()).toContain(avant.id)
	try {
		await poserStatut(avant.id, 'disabled', null)
		expect(comptesAVeiller()).not.toContain(avant.id)
	} finally {
		await poserStatut(avant.id, avant.status, avant.last_error)
	}
	expect(comptesAVeiller()).toContain(avant.id)
})
