// @verifies CRM-105 (docs/BACKLOG.md) — les quatre lectures rendent la description, sur la pile réelle
// @verifies docs/SPEC-tracks.md §7, docs/SPEC-channels.md §5, docs/SPEC-workflow-engine.md §7.2,
//           docs/SPEC-cards.md §12.3 (la colonne rejoint la lecture déjà émise) ; docs/SPEC-seed.md §20
//           (ce que le seed décrit, et ce qu'il laisse sans description) ; docs/DESIGN_SYSTEM.md §5.58
// @verifies CLAUDE.md §10 (la lecture se prouve hors interface, avec le jeton réel du profil)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : D3 et D4 lisent les requêtes du board et de la liste, parties des
//           rattachements
//
// Les cards sont lues avec les colonnes EXACTES du produit (`colonnes-board.ts`, `colonnes-liste.ts`, que
// ce projet peut importer). Les tracks et les channels ne le peuvent pas : leurs constantes vivent dans des
// modules qui importent le client Supabase de l'application (`tsconfig.tools.json`, décision 177). Leur
// liste de colonnes est éprouvée par `webapp/src/lib/tracks.test.ts` et `channels.test.ts` ; ici, c'est la
// colonne elle-même qui est lue sous la RLS, avec le jeton de la LECTRICE — le profil le plus restreint
// qui voit ces objets.

import { expect, test } from '@playwright/test'
import { enTetesAuthentifies, jetonDe } from './jetons'
import { COLONNES_RATTACHEMENT_BOARD } from '../../webapp/src/lib/colonnes-board'
import { COLONNES_RATTACHEMENT_LISTE } from '../../webapp/src/lib/colonnes-liste'

const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CHANNEL_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const CARD_DECRITE = '5eed0000-0000-4000-8000-0000000000c2'
const CARD_NUE = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_LONGUE = '5eed0000-0000-4000-8000-00000000d002'

type Decrit = { id: string; slug?: string; description: string | null }

let jetonAdmin: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test('D1 — la barre latérale lit la description d’un track décrit, et `null` pour un track nu', async ({
	request,
}) => {
	const reponse = await request.get('/rest/v1/tracks?select=id,slug,description&slug=in.(studio-web,formation)', {
		headers: enTetesAuthentifies(jetonViewer),
	})
	expect(reponse.status()).toBe(200)
	const parSlug = new Map(((await reponse.json()) as Decrit[]).map((ligne) => [ligne.slug, ligne.description]))
	expect(parSlug.get('studio-web')).toBe("Conception, développement et maintenance de sites et d'applications web.")
	expect(parSlug.get('formation')).toBeNull()
})

test('D2 — la barre d’onglets lit la description d’un channel décrit, et `null` pour un channel nu', async ({
	request,
}) => {
	const reponse = await request.get(
		'/rest/v1/channels?select=id,slug,description&slug=in.(maintenance,refonte)',
		{ headers: enTetesAuthentifies(jetonAdmin) },
	)
	expect(reponse.status()).toBe(200)
	const parSlug = new Map(((await reponse.json()) as Decrit[]).map((ligne) => [ligne.slug, ligne.description]))
	expect(parSlug.get('maintenance')).toContain('Contrats récurrents de support')
	expect(parSlug.get('refonte')).toBeNull()
})

test('D3 — le board lit la description par ses propres colonnes, retour à la ligne compris', async ({
	request,
}) => {
	const reponse = await request.get(
		// `CRM-111` T2.4.1 : le board lit les rattachements du channel ; la description vient de l'affaire plongée.
		`/rest/v1/card_placements?select=${encodeURIComponent(COLONNES_RATTACHEMENT_BOARD)}&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&archived_at=is.null&affaire.deleted_at=is.null`,
		{ headers: enTetesAuthentifies(jetonAdmin) },
	)
	expect(reponse.status()).toBe(200)
	const parId = new Map(
		((await reponse.json()) as { affaire: Decrit }[]).map(({ affaire }) => [affaire.id, affaire.description]),
	)
	const decrite = parId.get(CARD_DECRITE)
	expect(decrite).toContain('\n')
	expect(decrite?.split('\n')).toHaveLength(2)
	// Une colonne nulle est RENDUE nulle, pas omise : `null` et absente ne se distinguent pas à l'œil.
	expect(parId.has(CARD_NUE)).toBe(true)
	expect(parId.get(CARD_NUE)).toBeNull()
})

test('D4 — la vue liste lit la description par ses propres colonnes, donnée longue comprise', async ({
	request,
}) => {
	const reponse = await request.get(
		// `CRM-111` T2.4.1 : la page lit les rattachements du channel ; la description vient de l'affaire plongée.
		`/rest/v1/card_placements?select=${encodeURIComponent(COLONNES_RATTACHEMENT_LISTE)}&channel_id=eq.${CHANNEL_MAINTENANCE}&archived_at=is.null&affaire.deleted_at=is.null&card_id=eq.${CARD_LONGUE}`,
		{ headers: enTetesAuthentifies(jetonViewer) },
	)
	expect(reponse.status()).toBe(200)
	const [ligne] = ((await reponse.json()) as { affaire: Decrit }[]).map(({ affaire }) => affaire)
	expect(ligne?.description?.length ?? 0).toBeGreaterThan(500)
	expect(ligne?.description?.split('\n\n')).toHaveLength(3)
})
