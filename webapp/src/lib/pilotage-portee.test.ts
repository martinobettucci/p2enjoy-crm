// @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//           TRANCHE 3 b : le sélecteur de portée de l'écran `/pilotage`
// @verifies docs/SPEC-analytique.md §8 bis.2 (l'adresse porte DEUX clés, et M8 l'impose ; le défaut
//           ne s'écrit pas ; une valeur qui ne se résout pas replie SANS erreur),
//           §8 bis.4 (la seconde lecture, l'ordre du serveur, la limite du track illisible),
//           §5.2 (la portée n'est pas un paramètre du serveur)
// @verifies docs/DESIGN_SYSTEM.md §5.48 bis (l'ordre des options, la portée réellement appliquée)
//
// LA FIXTURE EST L'ARBORESCENCE RÉELLE DU JEU DE DÉMONSTRATION (`docs/SPEC-analytique.md` M9) :
// quatre tracks, six channels offrables — `appels-offres` est archivé et `annexes-2023` en
// corbeille, tous deux écartés par la requête. Une divergence entre ce fichier et la pile se voit
// donc, au lieu de se cacher derrière des valeurs inventées pour l'occasion.

import { describe, expect, it, vi } from 'vitest'
import {
	CLE_URL_CHANNEL,
	CLE_URL_TRACK,
	COLONNES_PORTEE,
	ecrirePorteeUrl,
	grouperPortees,
	lirePorteeUrl,
	lirePorteesOffrables,
	nommerPortee,
	porteeAnalytique,
	porteeDepuisOption,
	resoudrePorteeUrl,
	valeurOption,
	type TrackPortee,
} from './pilotage-portee'
import type { ClientCrm } from './supabase'

/** L'arborescence du seed, telle que `lirePorteesOffrables` la rend. */
const ARBRE: readonly TrackPortee[] = [
	{
		id: 'tr-conseil',
		slug: 'conseil-ia',
		nom: 'Conseil & IA',
		channels: [
			{ id: 'ch-prospection', slug: 'prospection', nom: 'Prospection' },
			{ id: 'ch-grands-comptes', slug: 'grands-comptes', nom: 'Grands comptes' },
		],
	},
	{
		id: 'tr-studio',
		slug: 'studio-web',
		nom: 'Studio web',
		channels: [
			{ id: 'ch-refonte', slug: 'refonte', nom: 'Refonte de site' },
			{ id: 'ch-maintenance', slug: 'maintenance', nom: 'Maintenance' },
		],
	},
	{
		id: 'tr-formation',
		slug: 'formation',
		nom: 'Formation',
		channels: [{ id: 'ch-inter', slug: 'inter-entreprises', nom: 'Inter-entreprises' }],
	},
	{
		id: 'tr-legacy',
		slug: 'legacy-2023',
		nom: 'Legacy 2023',
		channels: [{ id: 'ch-dossiers', slug: 'dossiers-2023', nom: 'Dossiers 2023' }],
	},
]

describe('lirePorteeUrl — deux clés, et `channel` seul ne désigne rien (§8 bis.2)', () => {
	it('une adresse nue est la portée workspace', () => {
		expect(lirePorteeUrl(null, null)).toEqual({ type: 'workspace' })
	})

	it('`track` seul est une portée de track', () => {
		expect(lirePorteeUrl('studio-web', null)).toEqual({ type: 'track', track: 'studio-web' })
	})

	it('`track` et `channel` ensemble sont une portée de channel', () => {
		expect(lirePorteeUrl('studio-web', 'refonte')).toEqual({
			type: 'channel',
			track: 'studio-web',
			channel: 'refonte',
		})
	})

	it('`channel` SANS `track` ne désigne rien, et c’est M8', () => {
		// `channels_track_id_slug_key` est `UNIQUE (track_id, slug)` : sans son track, un slug de
		// channel est ambigu. Deviner lequel des deux homonymes l'appelant visait montrerait un
		// portefeuille pour un autre — le repli est donc le workspace, jamais une supposition.
		expect(lirePorteeUrl(null, 'prospection')).toEqual({ type: 'workspace' })
	})

	it('une valeur vide est une absence, pas un slug', () => {
		expect(lirePorteeUrl('', null)).toEqual({ type: 'workspace' })
		expect(lirePorteeUrl('studio-web', '')).toEqual({ type: 'track', track: 'studio-web' })
	})
})

describe('ecrirePorteeUrl — le défaut ne s’écrit JAMAIS dans l’adresse (§8 bis.2)', () => {
	it('la portée workspace n’écrit aucun paramètre', () => {
		// `/pilotage` nu EST la portée workspace : la vue par défaut doit rester l'adresse la plus
		// courte, règle que `?qui=tous` de `/ma-journee` tient déjà.
		expect(ecrirePorteeUrl({ type: 'workspace' })).toEqual({})
	})

	it('une portée de track n’écrit que sa clé', () => {
		expect(ecrirePorteeUrl({ type: 'track', track: 'studio-web' })).toEqual({
			[CLE_URL_TRACK]: 'studio-web',
		})
	})

	it('une portée de channel écrit les DEUX clés', () => {
		expect(ecrirePorteeUrl({ type: 'channel', track: 'studio-web', channel: 'refonte' })).toEqual({
			[CLE_URL_TRACK]: 'studio-web',
			[CLE_URL_CHANNEL]: 'refonte',
		})
	})

	it('lire puis écrire rend l’adresse d’origine', () => {
		for (const [track, channel] of [
			[null, null],
			['studio-web', null],
			['studio-web', 'refonte'],
		] as const) {
			const ecrit = ecrirePorteeUrl(lirePorteeUrl(track, channel))
			expect(ecrit[CLE_URL_TRACK] ?? null).toBe(track)
			expect(ecrit[CLE_URL_CHANNEL] ?? null).toBe(channel)
		}
	})
})

describe('resoudrePorteeUrl — ce que l’écran applique VRAIMENT (§8 bis.2)', () => {
	it('une portée présente dans l’arbre est rendue telle quelle', () => {
		expect(resoudrePorteeUrl({ type: 'track', track: 'studio-web' }, ARBRE)).toEqual({
			type: 'track',
			track: 'studio-web',
		})
		expect(
			resoudrePorteeUrl({ type: 'channel', track: 'studio-web', channel: 'refonte' }, ARBRE),
		).toEqual({ type: 'channel', track: 'studio-web', channel: 'refonte' })
	})

	it('un track inconnu ou fermé replie sur le workspace, SANS erreur', () => {
		// Une adresse tapée à la main n'est pas une panne, et « ce track n'existe pas »
		// renseignerait par la bande sur ce que la RLS ferme.
		expect(resoudrePorteeUrl({ type: 'track', track: 'inexistant' }, ARBRE)).toEqual({
			type: 'workspace',
		})
	})

	it('un channel inconnu replie sur SON TRACK, et non sur le workspace', () => {
		// Le track, lui, est bien lisible : le repli garde donc ce qui a été compris et n'abandonne
		// que ce qui ne l'a pas été.
		expect(
			resoudrePorteeUrl({ type: 'channel', track: 'studio-web', channel: 'inexistant' }, ARBRE),
		).toEqual({ type: 'track', track: 'studio-web' })
	})

	it('un channel cherché dans le MAUVAIS track n’est pas trouvé — M8', () => {
		// `prospection` existe, mais dans `conseil-ia`. Le chercher dans tout l'arbre rendrait le
		// premier homonyme, c'est-à-dire le portefeuille d'un autre track.
		expect(
			resoudrePorteeUrl({ type: 'channel', track: 'studio-web', channel: 'prospection' }, ARBRE),
		).toEqual({ type: 'track', track: 'studio-web' })
	})

	it('un arbre vide replie tout sur le workspace', () => {
		expect(resoudrePorteeUrl({ type: 'channel', track: 'studio-web', channel: 'refonte' }, [])).toEqual(
			{ type: 'workspace' },
		)
	})
})

describe('porteeAnalytique — des slugs vers les identifiants que la fonction rend', () => {
	it('traduit les trois rangs', () => {
		expect(porteeAnalytique({ type: 'workspace' }, ARBRE)).toEqual({ type: 'workspace' })
		expect(porteeAnalytique({ type: 'track', track: 'legacy-2023' }, ARBRE)).toEqual({
			type: 'track',
			id: 'tr-legacy',
		})
		expect(
			porteeAnalytique({ type: 'channel', track: 'legacy-2023', channel: 'dossiers-2023' }, ARBRE),
		).toEqual({ type: 'channel', id: 'ch-dossiers' })
	})

	it('ne lève jamais sur une portée que l’arbre ne porte pas', () => {
		expect(porteeAnalytique({ type: 'track', track: 'inexistant' }, ARBRE)).toEqual({
			type: 'workspace',
		})
		expect(
			porteeAnalytique({ type: 'channel', track: 'studio-web', channel: 'inexistant' }, ARBRE),
		).toEqual({ type: 'track', id: 'tr-studio' })
	})
})

describe('valeurOption et porteeDepuisOption — la valeur du `select` n’est pas l’adresse', () => {
	it('les trois rangs font l’aller-retour', () => {
		for (const portee of [
			{ type: 'workspace' },
			{ type: 'track', track: 'studio-web' },
			{ type: 'channel', track: 'studio-web', channel: 'refonte' },
		] as const) {
			expect(porteeDepuisOption(valeurOption(portee))).toEqual(portee)
		}
	})

	it('la portée workspace est la chaîne vide, valeur naturelle de l’option de tête', () => {
		expect(valeurOption({ type: 'workspace' })).toBe('')
	})

	it('une valeur inconnue replie sur le workspace plutôt que de lever', () => {
		expect(porteeDepuisOption('')).toEqual({ type: 'workspace' })
	})

	it('deux channels homonymes de deux tracks ont des valeurs DISTINCTES — M8', () => {
		expect(valeurOption({ type: 'channel', track: 'conseil-ia', channel: 'prospection' })).not.toBe(
			valeurOption({ type: 'channel', track: 'studio-web', channel: 'prospection' }),
		)
	})
})

describe('nommerPortee — le nom vient de l’ARBRE, jamais du slug', () => {
	it('rend le nom du track et celui du channel', () => {
		expect(nommerPortee({ type: 'track', track: 'legacy-2023' }, ARBRE)).toBe('Legacy 2023')
		expect(
			nommerPortee({ type: 'channel', track: 'legacy-2023', channel: 'dossiers-2023' }, ARBRE),
		).toBe('Dossiers 2023')
	})

	it('la portée workspace n’a pas de nom de donnée', () => {
		// Elle porte sa propre phrase, qui est une traduction et non une donnée.
		expect(nommerPortee({ type: 'workspace' }, ARBRE)).toBeNull()
	})

	it('une portée absente de l’arbre ne rend aucun nom inventé', () => {
		expect(nommerPortee({ type: 'track', track: 'inexistant' }, ARBRE)).toBeNull()
	})
})

describe('grouperPortees — l’ordre du serveur, et la limite du track illisible (§8 bis.4)', () => {
	const brut = (
		id: string,
		slug: string,
		name: string,
		track: { id: string; slug: string; name: string } | null,
	) => ({ id, slug, name, tracks: track })

	it('groupe par track, dans l’ordre de première apparition', () => {
		const groupes = grouperPortees([
			brut('c1', 'prospection', 'Prospection', { id: 't1', slug: 'conseil-ia', name: 'Conseil & IA' }),
			brut('c2', 'refonte', 'Refonte de site', { id: 't2', slug: 'studio-web', name: 'Studio web' }),
			brut('c3', 'grands-comptes', 'Grands comptes', {
				id: 't1',
				slug: 'conseil-ia',
				name: 'Conseil & IA',
			}),
		])
		expect(groupes.map((groupe) => groupe.slug)).toEqual(['conseil-ia', 'studio-web'])
		expect(groupes[0]?.channels.map((channel) => channel.slug)).toEqual([
			'prospection',
			'grands-comptes',
		])
	})

	it('accepte l’imbriqué en objet comme en tableau — les deux formes de PostgREST', () => {
		const enTableau = grouperPortees([
			{
				id: 'c1',
				slug: 'refonte',
				name: 'Refonte de site',
				tracks: [{ id: 't2', slug: 'studio-web', name: 'Studio web' }],
			},
		])
		expect(enTableau).toHaveLength(1)
		expect(enTableau[0]?.slug).toBe('studio-web')
	})

	it('un channel dont le TRACK n’est pas lisible est écarté, et la limite est nommée', () => {
		// L'adresse d'une portée channel exige le slug de son track (M8) ; sans track lisible, il
		// n'y a pas d'adresse à écrire, et une option qu'aucune adresse ne peut porter serait une
		// commande morte. L'écart est écrit au §8 bis.4 plutôt que tu.
		const groupes = grouperPortees([
			brut('c1', 'refonte', 'Refonte de site', { id: 't2', slug: 'studio-web', name: 'Studio web' }),
			brut('c2', 'orphelin', 'Orphelin', null),
		])
		expect(groupes).toHaveLength(1)
		expect(groupes[0]?.channels.map((channel) => channel.slug)).toEqual(['refonte'])
	})

	it('aucune ligne rend aucun groupe, et non une exception', () => {
		expect(grouperPortees([])).toEqual([])
	})
})

describe('lirePorteesOffrables — une requête, et ce qu’elle écarte (§8 bis.4)', () => {
	const clientDouble = (reponse: {
		data?: unknown[]
		error?: { message: string } | null
		status?: number
	}) => {
		const requete = {
			select: vi.fn(() => requete),
			eq: vi.fn(() => requete),
			is: vi.fn(() => requete),
			order: vi.fn(() => requete),
			then: (resoudre: (valeur: unknown) => unknown) =>
				Promise.resolve({
					data: reponse.data ?? [],
					error: reponse.error ?? null,
					status: reponse.status ?? 200,
				}).then(resoudre),
		}
		const client = { from: vi.fn(() => requete) } as unknown as ClientCrm
		return { client, requete }
	}

	it('interroge `channels`, avec son track imbriqué, borné au workspace', async () => {
		const { client, requete } = clientDouble({ data: [] })
		await lirePorteesOffrables(client, 'ws-1')
		expect(client.from).toHaveBeenCalledTimes(1)
		expect(client.from).toHaveBeenCalledWith('channels')
		expect(requete.select).toHaveBeenCalledWith(COLONNES_PORTEE)
		expect(requete.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
	})

	it('écarte les archivés et ceux de la corbeille — M9', () => {
		// `appels-offres` est archivé, `annexes-2023` est en corbeille : ni l'un ni l'autre ne porte
		// d'affaire active à mesurer, et les offrir offrirait un entonnoir vide par construction.
		const { client, requete } = clientDouble({ data: [] })
		return lirePorteesOffrables(client, 'ws-1').then(() => {
			expect(requete.is).toHaveBeenCalledWith('archived_at', null)
			expect(requete.is).toHaveBeenCalledWith('deleted_at', null)
		})
	})

	it('demande l’ordre du serveur — `position` puis `name`', async () => {
		const { client, requete } = clientDouble({ data: [] })
		await lirePorteesOffrables(client, 'ws-1')
		expect(requete.order).toHaveBeenNthCalledWith(1, 'position')
		expect(requete.order).toHaveBeenNthCalledWith(2, 'name')
	})

	it('une erreur est classée, jamais levée', async () => {
		const { client } = clientDouble({ error: { message: 'permission denied' }, status: 403 })
		const etat = await lirePorteesOffrables(client, 'ws-1')
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})

	it('une réponse sans donnée rend un état PRÊT et vide', async () => {
		const { client } = clientDouble({ data: undefined })
		const etat = await lirePorteesOffrables(client, 'ws-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual([])
	})
})
