// @verifies CRM-095 (docs/BACKLOG.md) — tranche T2 : l'appel de l'écran au geste serveur de création
// @verifies docs/SPEC-cards.md §18.2 (les refus nommés de `public.creer_affaire`), §18.3 (l'écran les
//           traduit ; un succès rend l'identifiant qui ouvre la fiche) ; docs/SPEC-webapp.md §6.4
//
// Ce fichier éprouve l'appel RÉELLEMENT émis — le nom de la fonction et ses deux paramètres — et la
// correspondance de chaque réponse de la base, telle que `e2e/api/creer-affaire.spec.ts` et la suite
// pgTAP `0075` les mesurent sur la pile réelle.

import { describe, expect, it } from 'vitest'
import { creerAffaire } from './creer-affaire'
import type { ClientCrm } from './supabase'

type Reponse = {
	readonly data: unknown
	readonly error: { readonly code: string; readonly message: string } | null
}

const ID_CARD = '0c950000-0000-4000-8000-0000000000aa'

/** Client espion : il enregistre chaque appel `rpc` et rend la réponse donnée. */
function client(reponse: Reponse | Error): { client: ClientCrm; appels: [string, unknown][] } {
	const appels: [string, unknown][] = []
	const faux = {
		rpc: (nom: string, args: unknown) => {
			appels.push([nom, args])
			return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

describe('creerAffaire — ce que l’écran envoie (docs/SPEC-cards.md §18.2)', () => {
	it('appelle `creer_affaire` avec le channel et le titre TEL QU’IL A ÉTÉ SAISI', async () => {
		const { client: c, appels } = client({ data: ID_CARD, error: null })
		expect(await creerAffaire(c, 'ch-1', '  Refonte du site  ')).toEqual({ ok: true, idCard: ID_CARD })
		// Le titre n'est pas ramené ici : la fonction le fait, et deux règles pour une donnée divergeraient.
		expect(appels).toEqual([['creer_affaire', { p_channel: 'ch-1', p_titre: '  Refonte du site  ' }]])
	})

	it('une réponse `200` sans identifiant lisible est une panne, jamais un succès', async () => {
		expect(await creerAffaire(client({ data: null, error: null }).client, 'ch-1', 'A')).toEqual({
			ok: false,
			refus: 'panne',
		})
		expect(await creerAffaire(client({ data: 'pas-un-uuid', error: null }).client, 'ch-1', 'A')).toEqual({
			ok: false,
			refus: 'panne',
		})
	})

	it('sans client — la pile n’est pas configurée —, rien n’est envoyé et l’issue est une panne', async () => {
		expect(await creerAffaire(null, 'ch-1', 'A')).toEqual({ ok: false, refus: 'panne' })
	})
})

describe('creerAffaire — les refus, lus sur le code (docs/SPEC-cards.md §18.2, §18.3)', () => {
	it('`42501` : l’écriture du channel est refusée', async () => {
		const { client: c } = client({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
		expect(await creerAffaire(c, 'ch-1', 'A')).toEqual({ ok: false, refus: 'interdit' })
	})

	it('`P0002` : un channel devenu illisible se dit comme un refus, sans rien divulguer', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0002', message: 'channel introuvable' } })
		expect(await creerAffaire(c, 'ch-1', 'A')).toEqual({ ok: false, refus: 'interdit' })
	})

	it('`P0001` « channel ferme » : archivé ou à la corbeille', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0001', message: 'channel ferme' } })
		expect(await creerAffaire(c, 'ch-1', 'A')).toEqual({ ok: false, refus: 'channel-ferme' })
	})

	it('`P0001` « aucune etape initiale » : le workflow n’en désigne aucune', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0001', message: 'aucune etape initiale' } })
		expect(await creerAffaire(c, 'ch-1', 'A')).toEqual({ ok: false, refus: 'sans-etape-initiale' })
	})

	it('un `P0001` d’un autre message n’est pas deviné : c’est une panne', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0001', message: 'autre chose' } })
		expect(await creerAffaire(c, 'ch-1', 'A')).toEqual({ ok: false, refus: 'panne' })
	})

	it('un code inattendu, une erreur réseau ou une exception sont des pannes', async () => {
		expect(await creerAffaire(client({ data: null, error: { code: '23514', message: 'check' } }).client, 'ch-1', 'A')).toEqual({
			ok: false,
			refus: 'panne',
		})
		expect(await creerAffaire(client({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }).client, 'ch-1', 'A')).toEqual({
			ok: false,
			refus: 'panne',
		})
		expect(await creerAffaire(client(new Error('coupure')).client, 'ch-1', 'A')).toEqual({ ok: false, refus: 'panne' })
	})
})
