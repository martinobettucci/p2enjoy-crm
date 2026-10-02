// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : le contrat du serveur réel, contrôle FACULTATIF
// @verifies docs/SPEC-ia.md §8 (« un contrôle de contrat facultatif contre le serveur réel vérifie que le
//           simulateur ne s'en écarte pas ; il n'entre dans aucune campagne par défaut »), §11.1 (flux,
//           battement sous le délai de lecture de Kong)
//
// IGNORÉ PAR DÉFAUT : il appelle le serveur Ollama de LeLabs — distant, lent, non déterministe —, ce
// qu'aucune campagne ne fait (docs/SPEC-ia.md §8). Il ne s'exécute que sur demande explicite :
//
//   IA_SERVEUR_REEL=1 npm run e2e:api -- e2e/api/ia-reel.spec.ts
//
// Il vérifie la FORME, jamais le contenu : la même que celle que le simulateur rend.

import { expect, test } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DEMANDE = 'Sonde 097 réelle — une agence web qui vend des refontes de site, du premier contact au devis signé'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.skip(process.env['IA_SERVEUR_REEL'] !== '1', 'contrôle facultatif contre le serveur réel : IA_SERVEUR_REEL=1')

test('le serveur réel rend, par le flux, une révision de même forme que le simulateur', async ({ request }) => {
	test.setTimeout(180_000)
	try {
		const reponse = await request.post(`${URL_API}/functions/v1/ia/suggestions`, {
			headers: enTetesAuthentifies(await jetonDe(COMPTES_SEED[0].adresse)),
			data: { workspace_id: ESPACE, portee: 'workflow', demande: DEMANDE },
			timeout: 170_000,
		})
		expect(reponse.status()).toBe(202)
		const lignes = (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
		const id = lignes[0]?.suggestion_id as string
		expect(id).toMatch(/^[0-9a-f-]{36}$/)
		expect(lignes.at(-1)).toMatchObject({ issue: 'revision' })

		const lues = await request.get(
			rest(`suggestions_ia_revisions?suggestion_id=eq.${id}&select=origine,modele,jetons_entree,jetons_sortie,duree_ms,proposition,defauts`),
			{ headers: enTetesService() },
		)
		const [revision] = (await lues.json()) as Record<string, unknown>[]
		expect(revision).toMatchObject({ origine: 'ia', modele: 'gemma4:e2b' })
		expect(revision?.jetons_sortie as number).toBeGreaterThan(0)
		const proposition = revision?.proposition as Record<string, unknown>
		expect(proposition.version).toBe(1)
		for (const liste of ['noeuds', 'etapes', 'transitions', 'champs', 'regles', 'exigences']) {
			expect(Array.isArray(proposition[liste]), liste).toBe(true)
		}
		// Une génération de plus de 15 s a dû battre au moins une fois (docs/SPEC-ia.md §11.1).
		if ((revision?.duree_ms as number) > 15_000) {
			expect(lignes.some((l) => l.attente === true)).toBe(true)
		}
		test.info().annotations.push({
			type: 'mesure',
			description: `durée ${revision?.duree_ms} ms, jetons ${revision?.jetons_entree}/${revision?.jetons_sortie}, défauts ${(revision?.defauts as unknown[]).length}`,
		})
	} finally {
		await request.delete(rest(`suggestions_ia?demande=eq.${encodeURIComponent(DEMANDE)}`), { headers: enTetesService() })
	}
})
