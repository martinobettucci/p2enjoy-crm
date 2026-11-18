// @verifies CRM-154 (docs/BACKLOG.md) — tranche T3 : l'ordre après une pose ou un déplacement, la disponibilité par le
//           seul rang, l'adresse `?track=`, le classement des refus de `reorder_channels` et l'appel
// @verifies docs/SPEC-administration-arborescence.md §15.2 (un ordre, pas des positions ; les refus), §15.3

import { describe, expect, it } from 'vitest'
import {
	cheminReorganiser,
	classerRefusReorganisation,
	deplacementParOrdre,
	lireTrackDemande,
	ordreApresDeplacement,
	ordreApresPose,
	reorganiserChannels,
	sansTrackDemande,
} from './reorganisation-channels'
import type { ClientCrm } from './supabase'

const IDS = ['a', 'b', 'c', 'd'] as const
const UUID = '5eed0000-0000-4000-8000-000000000021'

describe('l’ordre après une pose (§15.4)', () => {
	it('pose un channel à un autre rang, les autres glissant d’un cran', () => {
		expect(ordreApresPose(IDS, 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
		expect(ordreApresPose(IDS, 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
		expect(ordreApresPose(IDS, 'b', 3)).toEqual(['a', 'c', 'd', 'b'])
	})

	it('rend null quand rien ne change : posé à sa place, ou channel absent', () => {
		expect(ordreApresPose(IDS, 'b', 1)).toBeNull()
		expect(ordreApresPose(IDS, 'z', 0)).toBeNull()
	})

	it('ramène une cible hors bornes aux extrémités', () => {
		expect(ordreApresPose(IDS, 'b', 99)).toEqual(['a', 'c', 'd', 'b'])
		expect(ordreApresPose(IDS, 'c', -5)).toEqual(['c', 'a', 'b', 'd'])
		expect(ordreApresPose(IDS, 'a', -1)).toBeNull()
	})
})

describe('« Monter » et « Descendre » d’un channel (§15.3)', () => {
	it('déplace d’un cran, et rend null à l’extrémité visée', () => {
		expect(ordreApresDeplacement(IDS, 'c', 'monter')).toEqual(['a', 'c', 'b', 'd'])
		expect(ordreApresDeplacement(IDS, 'c', 'descendre')).toEqual(['a', 'b', 'd', 'c'])
		expect(ordreApresDeplacement(IDS, 'a', 'monter')).toBeNull()
		expect(ordreApresDeplacement(IDS, 'd', 'descendre')).toBeNull()
	})

	it('la disponibilité ne dépend que du rang : des positions égales ou nulles ne l’éteignent plus', () => {
		const egales = IDS.map((id) => ({ id, position: 0 }))
		expect(deplacementParOrdre(egales, 'b', 'monter')).toEqual({ statut: 'calcule', position: 1 })
		expect(deplacementParOrdre(egales, 'b', 'descendre')).toEqual({ statut: 'calcule', position: 3 })
		expect(deplacementParOrdre(egales, 'a', 'monter')).toEqual({ statut: 'impossible', cause: 'extremite' })
		expect(deplacementParOrdre(egales, 'd', 'descendre')).toEqual({ statut: 'impossible', cause: 'extremite' })
	})
})

describe('l’adresse `?track=` (§15.3)', () => {
	it('ne croit qu’un uuid, et le rend en minuscules', () => {
		expect(lireTrackDemande(new URLSearchParams({ track: UUID }))).toBe(UUID)
		expect(lireTrackDemande(new URLSearchParams({ track: UUID.toUpperCase() }))).toBe(UUID)
		expect(lireTrackDemande(new URLSearchParams({ track: 't-1' }))).toBeNull()
		expect(lireTrackDemande(new URLSearchParams({ track: `${UUID}/../x` }))).toBeNull()
		expect(lireTrackDemande(new URLSearchParams())).toBeNull()
	})

	it('le paramètre se retire sans toucher aux autres', () => {
		expect(sansTrackDemande(new URLSearchParams({ track: UUID, autre: '1' })).toString()).toBe('autre=1')
	})

	it('le lien « Réorganiser » ouvre l’arborescence sur le track', () => {
		expect(cheminReorganiser(UUID)).toBe(`/reglages/arborescence?track=${UUID}`)
	})
})

describe('les refus de `reorder_channels` (§15.2)', () => {
	it('`channel_order_incomplete` est l’ordre périmé, reconnu à son nom', () => {
		expect(classerRefusReorganisation(400, '23514', 'channel_order_incomplete').nature).toBe('ordre-perime')
	})

	it('`42501` par la route est le refus d’administration', () => {
		expect(classerRefusReorganisation(403, '42501', 'channel_reorder_forbidden').nature).toBe('forbidden')
	})

	it('les autres `23514` restent un refus de forme, une panne reste une panne', () => {
		expect(classerRefusReorganisation(400, '23514', 'channel_order_duplicated').nature).toBe('forme-refusee')
		expect(classerRefusReorganisation(undefined, undefined, 'Failed to fetch').nature).toBe('network')
	})
})

describe('l’appel (§15.2)', () => {
	const client = (reponse: unknown, appels: unknown[] = []) =>
		({
			rpc: (fonction: string, charge: unknown) => {
				appels.push([fonction, charge])
				return Promise.resolve(reponse)
			},
		}) as unknown as ClientCrm

	it('envoie le track et l’ordre entier, et rend « appliqué »', async () => {
		const appels: unknown[] = []
		const resultat = await reorganiserChannels(client({ data: 3, error: null, status: 200 }, appels), UUID, ['c', 'a', 'b'])
		expect(resultat).toEqual({ statut: 'applique' })
		expect(appels).toEqual([['reorder_channels', { p_track_id: UUID, p_channel_ids: ['c', 'a', 'b'] }]])
	})

	it('rend un refus classé, et ne lève jamais', async () => {
		const refus = await reorganiserChannels(
			client({ data: null, error: { message: 'channel_order_incomplete', code: '23514' }, status: 400 }),
			UUID,
			['a'],
		)
		expect(refus).toEqual({ statut: 'refus', refus: { nature: 'ordre-perime', detail: 'channel_order_incomplete' } })
		const qui_leve = { rpc: () => Promise.reject(new Error('Failed to fetch')) } as unknown as ClientCrm
		expect((await reorganiserChannels(qui_leve, UUID, ['a'])).statut).toBe('refus')
	})
})
