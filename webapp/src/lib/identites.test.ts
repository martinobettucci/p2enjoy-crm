// @verifies CRM-022 (docs/BACKLOG.md) — profil courant, URLs d'avatar et replis sûrs
// @verifies docs/SPEC-identite.md §3.1, §4 et §7

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	COLONNES_PROFIL_AFFICHE,
	initialesDe,
	lireProfilCourant,
	urlAvatarSure,
} from './identites'

function clientProfil(reponse: {
	readonly data: { readonly id: string; readonly full_name: string; readonly avatar_url: string | null } | null
	readonly error: { readonly message: string } | null
	readonly status: number
}) {
	const appels: { table?: string; colonnes?: string; egalite?: readonly [string, string]; uniques: number } = {
		uniques: 0,
	}
	const chaine = {
		select: (colonnes: string) => {
			appels.colonnes = colonnes
			return chaine
		},
		eq: (colonne: string, valeur: string) => {
			appels.egalite = [colonne, valeur]
			return chaine
		},
		maybeSingle: async () => {
			appels.uniques += 1
			return reponse
		},
	}
	const client = {
		from: (table: string) => {
			appels.table = table
			return chaine
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('lecture du profil courant', () => {
	it('ne demande que le profil de la session et ses trois colonnes affichées', async () => {
		const profil = {
			id: 'profil-1',
			full_name: 'Camille Aubert',
			avatar_url: '/avatars/camille-aubert.svg',
		}
		const { client, appels } = clientProfil({ data: profil, error: null, status: 200 })

		await expect(lireProfilCourant(client, profil.id)).resolves.toEqual({
			statut: 'pret',
			donnees: profil,
		})
		expect(appels).toEqual({
			table: 'profiles',
			colonnes: COLONNES_PROFIL_AFFICHE,
			egalite: ['id', 'profil-1'],
			uniques: 1,
		})
	})

	it('distingue un profil absent d’un refus du backend', async () => {
		const absent = clientProfil({ data: null, error: null, status: 200 })
		await expect(lireProfilCourant(absent.client, 'profil-absent')).resolves.toEqual({
			statut: 'pret',
			donnees: null,
		})

		const refuse = clientProfil({ data: null, error: { message: 'interdit' }, status: 403 })
		await expect(lireProfilCourant(refuse.client, 'profil-1')).resolves.toEqual({
			statut: 'erreur',
			erreur: { nature: 'forbidden', detail: 'interdit' },
		})
	})

	it('classe une rupture de transport sans la transformer en profil vide', async () => {
		const client = { from: () => { throw new Error('hors ligne') } } as unknown as ClientCrm
		await expect(lireProfilCourant(client, 'profil-1')).resolves.toEqual({
			statut: 'erreur',
			erreur: { nature: 'network', detail: 'hors ligne' },
		})
	})
})

describe('présentation sûre d’une identité', () => {
	it.each([
		['/avatars/camille-aubert.svg', '/avatars/camille-aubert.svg'],
		['https://cdn.example.test/avatar.png', 'https://cdn.example.test/avatar.png'],
		['http://cdn.example.test/avatar.png', null],
		['//cdn.example.test/avatar.png', null],
		['javascript:alert(1)', null],
		['https://%', null],
		[null, null],
	] as const)('borne l’URL d’avatar %s', (entree, attendu) => {
		expect(urlAvatarSure(entree)).toBe(attendu)
	})

	it('refuse aussi une URL qui dépasse la borne de la base', () => {
		expect(urlAvatarSure(`/${'a'.repeat(2048)}`)).toBeNull()
	})

	it.each([
		['Camille Aubert', 'CA'],
		['  Driss   Lemoine  ', 'DL'],
		['Farida', 'F'],
		['Élodie du Pré', 'ÉP'],
		['', '?'],
		['🦊 Martin', '🦊M'],
	] as const)('calcule les initiales de « %s »', (nom, attendu) => {
		expect(initialesDe(nom)).toBe(attendu)
	})
})
