// @verifies CRM-112 (docs/BACKLOG.md) — tranche T6 : la recherche globale par les champs de l'affaire, hors interface
// @verifies docs/SPEC-champs-communs.md §10 (précision T6 : texte et libellé des choix cherchables, l'extrait qui nomme le
//           champ, les droits de l'affaire) ; docs/SPEC-recherche.md §6.3, §6.5 ; docs/JOURNAL.md décisions 844 et 848 ;
//           CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// CE FICHIER ÉCRIT : il pose deux champs de l'affaire aux clés `tst-t6-api-*` et leurs valeurs sur l'affaire `…00c1`
// (« Refonte du site vitrine », channel « Grands comptes », que la lectrice ne lit pas), par la clé de service, et les
// efface en `afterAll` — les valeurs partent avec les champs (`on delete cascade`). LES DEUX ÉVÉNEMENTS `field_changed`
// QUE CES ÉCRITURES PORTENT AU FIL RESTENT : le fil est un journal immuable, qu'aucun client n'efface (`0016` §6.2), comme
// pour `e2e/api/champs-communs.spec.ts`. Ils nomment un champ effacé, que le fil ne sait plus nommer (§5.89).

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const RPC = `${URL_API}/rest/v1/rpc/recherche_globale`

type Ligne = { objet: string; id: string; titre: string | null; extrait: string | null }

const champs: string[] = []

async function chercher(request: import('@playwright/test').APIRequestContext, jeton: string, terme: string) {
	const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jeton), data: { p_terme: terme, p_limite: 20 } })
	expect(reponse.status(), terme).toBe(200)
	return (await reponse.json()) as Ligne[]
}

test.describe.configure({ mode: 'serial' })

test.describe('recherche_globale — une affaire trouvée par un champ de l’affaire', () => {
	test.beforeAll(async ({ request }) => {
		const creation = await request.post(`${URL_API}/rest/v1/card_common_fields`, {
			headers: { ...enTetesService(), prefer: 'return=representation' },
			data: [
				{ workspace_id: ESPACE, key: 'tst-t6-api-siret', label: 'SIRET', type: 'text', options: {} },
				{
					workspace_id: ESPACE,
					key: 'tst-t6-api-secteur',
					label: 'Secteur',
					type: 'select',
					options: { choices: [{ key: 'btp', label: 'Bâtiment' }] },
				},
			],
		})
		expect(creation.status()).toBe(201)
		const [siret, secteur] = (await creation.json()) as { id: string }[]
		champs.push(siret!.id, secteur!.id)
		const valeurs = await request.post(`${URL_API}/rest/v1/card_common_field_values`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: [
				{ card_id: AFFAIRE, field_id: siret!.id, workspace_id: ESPACE, value: 'Zorglub 552 100 554' },
				{ card_id: AFFAIRE, field_id: secteur!.id, workspace_id: ESPACE, value: 'btp' },
			],
		})
		expect(valeurs.status()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		if (champs.length > 0) {
			const effacement = await request.delete(`${URL_API}/rest/v1/card_common_fields?id=in.(${champs.join(',')})`, {
				headers: enTetesService(),
			})
			expect(effacement.status()).toBe(204)
		}
	})

	test('l’administratrice trouve l’affaire par le texte d’un champ, et l’extrait nomme le champ', async ({ request }) => {
		const lignes = await chercher(request, await jetonDe('admin@p2enjoy.test'), 'zorglub')
		expect(lignes).toEqual([
			expect.objectContaining({ objet: 'affaire', id: AFFAIRE, extrait: 'SIRET : Zorglub 552 100 554' }),
		])
	})

	test('un choix se trouve par son libellé, désaccentué, jamais par sa clé', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const parLibelle = await chercher(request, jeton, 'batiment')
		expect(parLibelle.find((l) => l.id === AFFAIRE)?.extrait).toBe('Secteur : Bâtiment')
		expect((await chercher(request, jeton, 'btp')).some((l) => l.id === AFFAIRE)).toBe(false)
	})

	test('la lectrice, qui ne lit pas l’affaire, ne la trouve pas par son champ : 200 et zéro ligne', async ({ request }) => {
		expect(await chercher(request, await jetonDe('viewer@p2enjoy.test'), 'zorglub')).toEqual([])
	})

	test('une affaire trouvée par son titre seulement garde un extrait nul', async ({ request }) => {
		const lignes = await chercher(request, await jetonDe('admin@p2enjoy.test'), 'vitrine')
		expect(lignes.find((l) => l.objet === 'affaire' && l.id === AFFAIRE)?.extrait).toBeNull()
	})

	test('le libellé d’un choix renommé est cherchable aussitôt : la base recalcule les valeurs', async ({ request }) => {
		const renommage = await request.patch(`${URL_API}/rest/v1/card_common_fields?id=eq.${champs[1]}`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { options: { choices: [{ key: 'btp', label: 'Construction' }] } },
		})
		expect(renommage.status()).toBe(204)
		const jeton = await jetonDe('admin@p2enjoy.test')
		expect((await chercher(request, jeton, 'construction')).find((l) => l.id === AFFAIRE)?.extrait).toBe(
			'Secteur : Construction',
		)
		expect((await chercher(request, jeton, 'batiment')).some((l) => l.id === AFFAIRE)).toBe(false)
	})
})
