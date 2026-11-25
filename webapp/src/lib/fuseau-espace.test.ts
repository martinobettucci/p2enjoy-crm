// @verifies INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.a : la couche du fuseau de l'espace — la
//           requête de lecture, l'écriture par la fonction (jamais un `update`), le classement fermé des refus, le regroupement
//           par région des fuseaux du navigateur (le fuseau courant toujours présent), l'heure et l'écart d'un fuseau
// @verifies docs/SPEC-modeles-emails.md §8.6 bis, §8.6 ter ; docs/DESIGN_SYSTEM.md §5.117

import { describe, expect, it } from 'vitest'
import {
	classerRefusFuseau,
	COLONNES_FUSEAU,
	decalageDuFuseau,
	ecartAvecNavigateur,
	FUSEAU_PAR_DEFAUT,
	formaterEcart,
	fuseauDuNavigateur,
	fuseauxDuNavigateur,
	grouperFuseaux,
	heureDansFuseau,
	lireFuseauEspace,
	reglerFuseauEspace,
} from './fuseau-espace'
import type { ClientCrm } from './supabase'

type Appel = { table?: string; fonction?: string; arguments?: unknown; etapes: [string, unknown[]][] }

function espion(reponse: unknown, jette = false) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, etapes: [] }
			appels.push(appel)
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'update']) {
				maillon[methode] = (...args: unknown[]) => {
					appel.etapes.push([methode, args])
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown, rejeter: (e: unknown) => unknown) =>
				jette ? rejeter(new Error('réseau')) : resoudre(reponse)
			return maillon
		},
		rpc: (fonction: string, arguments_: unknown) => {
			appels.push({ fonction, arguments: arguments_, etapes: [] })
			return jette ? Promise.reject(new Error('réseau')) : Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const ESPACE = '5eed0000-0000-4000-8000-000000000001'

describe('lireFuseauEspace — une requête, sous la RLS', () => {
	it('demande les deux colonnes de l’espace de l’adresse, et rend son fuseau', async () => {
		const { client, appels } = espion({ data: [{ id: ESPACE, timezone: 'America/Montreal' }], error: null, status: 200 })
		const lu = await lireFuseauEspace(client, ESPACE)
		expect(lu).toEqual({ statut: 'pret', donnees: 'America/Montreal' })
		expect(appels).toHaveLength(1)
		expect(appels[0]?.table).toBe('workspaces')
		expect(appels[0]?.etapes).toEqual([
			['select', [COLONNES_FUSEAU]],
			['eq', ['id', ESPACE]],
		])
		expect(COLONNES_FUSEAU).toBe('id, timezone')
	})

	it('un espace que la RLS masque est une ERREUR, jamais un fuseau deviné', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const lu = await lireFuseauEspace(client, ESPACE)
		expect(lu.statut).toBe('erreur')
	})

	it('classe une erreur de la base et une panne réseau', async () => {
		const refus = await lireFuseauEspace(espion({ data: null, error: { message: 'x' }, status: 403 }).client, ESPACE)
		expect(refus).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
		const panne = await lireFuseauEspace(espion(null, true).client, ESPACE)
		expect(panne).toMatchObject({ statut: 'erreur', erreur: { nature: 'network' } })
	})
})

describe('reglerFuseauEspace — par la fonction, jamais par un update', () => {
	it('appelle workspace_set_timezone avec l’espace et le fuseau, et rien d’autre', async () => {
		const { client, appels } = espion({ data: null, error: null, status: 204 })
		expect(await reglerFuseauEspace(client, ESPACE, 'Europe/Lisbon')).toEqual({ statut: 'applique' })
		expect(appels).toEqual([
			{ fonction: 'workspace_set_timezone', arguments: { p_workspace_id: ESPACE, p_timezone: 'Europe/Lisbon' }, etapes: [] },
		])
	})

	it('traduit les deux refus de la base par leur code, et la panne par sa nature', async () => {
		const interdit = await reglerFuseauEspace(
			espion({ data: null, error: { code: '42501', message: 'forbidden' }, status: 403 }).client,
			ESPACE,
			'UTC',
		)
		expect(interdit).toEqual({ statut: 'refus', nature: 'forbidden' })
		const inconnu = await reglerFuseauEspace(
			espion({ data: null, error: { code: '22023', message: 'invalid_timezone' }, status: 400 }).client,
			ESPACE,
			'Mars/Phobos',
		)
		expect(inconnu).toEqual({ statut: 'refus', nature: 'fuseau-inconnu' })
		const panne = await reglerFuseauEspace(espion(null, true).client, ESPACE, 'UTC')
		expect(panne).toEqual({ statut: 'refus', nature: 'network' })
	})
})

describe('classerRefusFuseau — sur le code, jamais sur la phrase', () => {
	it('range chaque cas', () => {
		expect(classerRefusFuseau(403, '42501')).toBe('forbidden')
		expect(classerRefusFuseau(401, undefined)).toBe('forbidden')
		expect(classerRefusFuseau(400, '22023')).toBe('fuseau-inconnu')
		expect(classerRefusFuseau(undefined, undefined)).toBe('network')
		expect(classerRefusFuseau(0, undefined)).toBe('network')
		expect(classerRefusFuseau(500, 'XX000')).toBe('unknown')
	})
})

describe('grouperFuseaux — par région, le fuseau courant toujours là', () => {
	const noms = ['Europe/Paris', 'America/Montreal', 'Europe/Lisbon', 'Asia/Tokyo', 'America/Argentina/Buenos_Aires']

	it('range les régions dans l’ordre de la liste fermée, et leurs fuseaux par nom', () => {
		const groupes = grouperFuseaux(noms, 'Europe/Paris')
		expect(groupes.map((g) => g.region)).toEqual(['America', 'Asia', 'Europe', null])
		expect(groupes[0]?.fuseaux).toEqual(['America/Argentina/Buenos_Aires', 'America/Montreal'])
		expect(groupes[2]?.fuseaux).toEqual(['Europe/Lisbon', 'Europe/Paris'])
	})

	it('met UTC hors de toute région, une seule fois', () => {
		const groupes = grouperFuseaux([...noms, 'UTC'], 'Europe/Paris')
		expect(groupes.at(-1)).toEqual({ region: null, fuseaux: ['UTC'] })
	})

	it('garde le fuseau COURANT même absent de la liste du navigateur', () => {
		const groupes = grouperFuseaux(['Europe/Paris'], 'Pacific/Kiritimati')
		expect(groupes.flatMap((g) => g.fuseaux)).toContain('Pacific/Kiritimati')
		expect(groupes.find((g) => g.region === 'Pacific')?.fuseaux).toEqual(['Pacific/Kiritimati'])
	})

	it('range une région inconnue dans le groupe sans région, sans rien perdre', () => {
		const groupes = grouperFuseaux(['Mars/Phobos', 'Europe/Paris'], 'Europe/Paris')
		expect(groupes.at(-1)?.fuseaux).toEqual(['Mars/Phobos', 'UTC'])
	})

	it('sans liste du navigateur, ne rend que le fuseau courant et UTC : aucune liste n’est inventée', () => {
		const groupes = grouperFuseaux([], FUSEAU_PAR_DEFAUT)
		expect(groupes.flatMap((g) => g.fuseaux).sort()).toEqual(['Europe/Paris', 'UTC'])
	})
})

describe('fuseauxDuNavigateur', () => {
	it('rend les noms IANA de la plateforme, sans les recopier', () => {
		const noms = fuseauxDuNavigateur()
		expect(noms).toContain('Europe/Paris')
		expect(noms).toContain('America/Toronto')
	})

	it('ne liste QUE les noms canoniques : « America/Montreal », celui du seed, y est un alias absent — d’où le fuseau courant toujours proposé', () => {
		// Mesuré le 2026-11-25 : `Intl.supportedValuesOf('timeZone')` rend `America/Toronto`, jamais l'alias `America/Montreal` que la base
		// accepte et que « Studio Lumen » porte. Sans l'option courante, le champ afficherait un autre fuseau comme choisi.
		expect(fuseauxDuNavigateur()).not.toContain('America/Montreal')
		const groupes = grouperFuseaux(fuseauxDuNavigateur(), 'America/Montreal')
		expect(groupes.flatMap((g) => g.fuseaux)).toContain('America/Montreal')
	})
})

describe('heureDansFuseau, decalageDuFuseau — l’heure d’été et d’hiver', () => {
	const ete = new Date('2026-07-15T09:00:00Z')
	const hiver = new Date('2026-01-15T09:00:00Z')

	it('lit l’heure de l’instant dans le fuseau', () => {
		expect(heureDansFuseau(ete, 'Europe/Paris')).toBe('11:00')
		expect(heureDansFuseau(hiver, 'Europe/Paris')).toBe('10:00')
		expect(heureDansFuseau(ete, 'America/Montreal')).toBe('05:00')
		expect(heureDansFuseau(ete, 'UTC')).toBe('09:00')
	})

	it('rend le décalage à l’UTC en minutes, heure d’été comprise', () => {
		expect(decalageDuFuseau(ete, 'Europe/Paris')).toBe(120)
		expect(decalageDuFuseau(hiver, 'Europe/Paris')).toBe(60)
		expect(decalageDuFuseau(ete, 'America/Montreal')).toBe(-240)
		expect(decalageDuFuseau(hiver, 'America/Montreal')).toBe(-300)
		expect(decalageDuFuseau(ete, 'Asia/Kolkata')).toBe(330)
	})

	it('ne rend RIEN pour un nom que le navigateur ne sait pas formater : jamais une heure inventée', () => {
		expect(heureDansFuseau(ete, 'Mars/Phobos')).toBeNull()
		expect(decalageDuFuseau(ete, 'Mars/Phobos')).toBeNull()
	})
})

describe('ecartAvecNavigateur', () => {
	/** Un instant dont le navigateur est à Paris en été (UTC+2), quel que soit le fuseau de la machine qui joue le test. */
	class InstantParis extends Date {
		override getTimezoneOffset(): number {
			return -120
		}
	}
	const ete = new InstantParis('2026-07-15T09:00:00Z')

	it('est positif quand le fuseau est en avance sur le navigateur, négatif sinon, nul à l’identique', () => {
		expect(ecartAvecNavigateur(ete, 'Europe/Paris')).toBe(0)
		expect(ecartAvecNavigateur(ete, 'Asia/Tokyo')).toBe(420)
		expect(ecartAvecNavigateur(ete, 'America/Montreal')).toBe(-360)
	})

	it('ne rend rien pour un nom illisible', () => {
		expect(ecartAvecNavigateur(ete, 'Mars/Phobos')).toBeNull()
	})
})

describe('formaterEcart — la donnée technique de l’écart', () => {
	it('écrit le signe, les heures et les minutes, avec le vrai signe moins', () => {
		expect(formaterEcart(60)).toBe('+1 h')
		expect(formaterEcart(-300)).toBe('−5 h')
		expect(formaterEcart(330)).toBe('+5 h 30')
		expect(formaterEcart(-570)).toBe('−9 h 30')
		expect(formaterEcart(45)).toBe('+45 min')
		expect(formaterEcart(0)).toBe('+0 min')
	})
})

describe('fuseauDuNavigateur', () => {
	it('rend un nom de fuseau, que la plateforme sait lire', () => {
		const nom = fuseauDuNavigateur()
		expect(nom).not.toBeNull()
		expect(heureDansFuseau(new Date(), nom as string)).toMatch(/^\d\d:\d\d$/)
	})
})
