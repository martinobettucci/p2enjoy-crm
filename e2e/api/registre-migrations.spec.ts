// @verifies CRM-096 (docs/BACKLOG.md) — tranche T1 : le registre des migrations est fermé à l'API
// @verifies docs/SCHEMA.md §8 (`app.migrations_appliquees` : aucun rôle de l'API n'y accède) ;
//           docs/DAT.md §3.2 bis ; docs/JOURNAL.md décision 616
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors
//           interface, avec les jetons réels)
//
// Le registre dit quelles migrations porte la base : cela ne regarde aucun client. Ce fichier le prouve
// par la passerelle réelle, avec les trois appelants que l'API connaît — l'anonyme, l'administratrice du
// seed connectée par LeLabs, la clé de service — et par les deux chemins qu'un client peut tenter : le
// nom de la table dans le schéma exposé, puis le schéma `app` demandé explicitement. Que la table EXISTE
// est établi par pgTAP (`supabase/tests/0076_registre_migrations.test.sql`, assertion 1) : ces refus ne
// sont donc pas ceux d'une table absente.

import { expect, test } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const LECTURE = rest('migrations_appliquees?select=fichier,empreinte&limit=1')

const LIGNE = {
	fichier: '9990_sonde_api.sql',
	empreinte: 'a1'.repeat(32),
	mode: 'application',
}

async function appelants(): Promise<[string, Record<string, string>][]> {
	return [
		['anonyme', enTetesAnonymes()],
		['administratrice', enTetesAuthentifies(await jetonDe(ADMIN.adresse))],
		['clé de service', enTetesService()],
	]
}

test.describe('Le registre des migrations, fermé à l’API (docs/SCHEMA.md §8)', () => {
	test('par le schéma exposé, la table n’existe pour personne : 404, PGRST205', async ({ request }) => {
		for (const [nom, enTetes] of await appelants()) {
			const reponse = await request.get(LECTURE, { headers: enTetes })
			expect(reponse.status(), `${nom} : ${await reponse.text()}`).toBe(404)
			expect(((await reponse.json()) as { code: string }).code, nom).toBe('PGRST205')
		}
	})

	test('le schéma `app` demandé explicitement est refusé, en lecture comme en écriture : 406, PGRST106', async ({
		request,
	}) => {
		for (const [nom, enTetes] of await appelants()) {
			const lecture = await request.get(LECTURE, { headers: { ...enTetes, 'Accept-Profile': 'app' } })
			expect(lecture.status(), `${nom} lit : ${await lecture.text()}`).toBe(406)
			expect(((await lecture.json()) as { code: string }).code, nom).toBe('PGRST106')

			const ecriture = await request.post(rest('migrations_appliquees'), {
				headers: { ...enTetes, 'Content-Profile': 'app', Prefer: 'return=minimal' },
				data: LIGNE,
			})
			expect(ecriture.status(), `${nom} inscrit : ${await ecriture.text()}`).toBe(406)
			expect(((await ecriture.json()) as { code: string }).code, nom).toBe('PGRST106')
		}
	})
})
