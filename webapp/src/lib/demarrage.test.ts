// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : la mesure des cinq étapes
// @verifies docs/SPEC-onboarding.md §2 (la progression est une mesure, jamais un drapeau),
//           §3 (les cinq étapes et leurs filtres), §3.2 (cinq comptages indépendants),
//           §6.2 (les trois états d'une étape)
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les filtres `archived_at`/`deleted_at` du §3 sont une exigence de la
// spécification portée par la requête elle-même. Une étape qui compterait un objet en corbeille se
// dirait accomplie par un objet que l'écran ne montre nulle part.

import { describe, expect, it } from 'vitest'
import {
	CLES_ETAPES_DEMARRAGE,
	FILTRES_ETAPES_DEMARRAGE,
	compterAccomplies,
	estAccomplie,
	mesureEnCours,
	mesurerDemarrage,
	mesurerEtape,
	PROGRESSION_INITIALE,
	resteUneEtape,
	type EtapeDemarrage,
} from './demarrage'
import { enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }

type Appel = {
	readonly table: string
	readonly colonnes: string
	readonly options: unknown
	readonly nuls: [string, unknown][]
}

/**
 * Client espion : il enregistre chaque requête émise, et rend la réponse associée à la table.
 * Une table absente de `reponses` fait échouer le test plutôt que de rendre un défaut silencieux.
 */
function espion(reponses: Readonly<Record<string, ReponseCompte>>): {
	client: ClientCrm
	appels: Appel[]
} {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => ({
			select: (colonnes: string, options?: unknown) => {
				const nuls: [string, unknown][] = []
				const reponse = reponses[table]
				if (reponse === undefined) throw new Error(`table non attendue : ${table}`)
				appels.push({ table, colonnes, options, nuls })
				const chaine = {
					is: (colonne: string, valeur: unknown) => {
						nuls.push([colonne, valeur])
						return chaine
					},
					then: (resoudre: (valeur: ReponseCompte) => unknown) =>
						Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

const ok = (count: number): ReponseCompte => ({ count, error: null, status: 200 })

const TOUTES_VIDES: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(0),
	tracks: ok(0),
	channels: ok(0),
	cards: ok(0),
	mail_inbound_accounts: ok(0),
}

describe('les cinq étapes et leurs filtres — docs/SPEC-onboarding.md §3', () => {
	it('déclare exactement cinq étapes, dans l’ordre où elles se lisent', () => {
		expect(CLES_ETAPES_DEMARRAGE).toEqual(['espace', 'track', 'channel', 'affaire', 'messagerie'])
	})

	it('interroge la table attendue pour chaque étape', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		expect(appels.map((appel) => appel.table)).toEqual([
			'workspaces',
			'tracks',
			'channels',
			'cards',
			'mail_inbound_accounts',
		])
	})

	it('compte sans rapporter les lignes : `head` et `count` exact', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		for (const appel of appels) {
			expect(appel.options).toEqual({ count: 'exact', head: true })
		}
	})

	it('masque l’archivé ET le mis en corbeille sur les tracks et les channels', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		const parTable = new Map(appels.map((appel) => [appel.table, appel.nuls]))
		expect(parTable.get('tracks')).toEqual([
			['archived_at', null],
			['deleted_at', null],
		])
		expect(parTable.get('channels')).toEqual([
			['archived_at', null],
			['deleted_at', null],
		])
	})

	it('retire l’affaire en corbeille, et n’invente aucun filtre d’archivage pour elle', async () => {
		// `cards` ne porte pas de colonne `archived_at` : lui en demander une serait une règle
		// inventée ici, et la requête échouerait contre la vraie base.
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		const cards = appels.find((appel) => appel.table === 'cards')
		expect(cards?.nuls).toEqual([['deleted_at', null]])
	})

	it('n’applique aucun filtre aux deux tables qui n’en portent pas', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		expect(appels.find((appel) => appel.table === 'workspaces')?.nuls).toEqual([])
		expect(appels.find((appel) => appel.table === 'mail_inbound_accounts')?.nuls).toEqual([])
	})

	it('déclare ses tables par le schéma, et le §3 les épingle', () => {
		expect(FILTRES_ETAPES_DEMARRAGE.messagerie.table).toBe('mail_inbound_accounts')
		expect(FILTRES_ETAPES_DEMARRAGE.affaire.table).toBe('cards')
	})
})

describe('ce qu’une réponse produit — docs/SPEC-onboarding.md §3.2 et §6.2', () => {
	it('rend le compte mesuré, sans le convertir en booléen', async () => {
		const { client } = espion({ ...TOUTES_VIDES, tracks: ok(3) })
		const etat = await mesurerEtape(client, 'track')
		expect(etat).toEqual({ statut: 'pret', donnees: { cle: 'track', compte: 3 } })
	})

	it('rend une ERREUR — jamais un zéro — lorsque le `count` est absent', async () => {
		// Un zéro inventé afficherait « à faire » sur une étape peut-être accomplie : c'est la
		// valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
		const { client } = espion({
			...TOUTES_VIDES,
			tracks: { count: null, error: null, status: 200 },
		})
		const etat = await mesurerEtape(client, 'track')
		expect(etat.statut).toBe('erreur')
	})

	it('classe un refus sur le CODE HTTP, comme le contrat asynchrone l’exige', async () => {
		// MESURÉ le 2026-08-15 : `mail_inbound_accounts` répond 401 à la clé anonyme, là où les
		// quatre autres tables rendent 200 et zéro ligne (docs/SPEC-onboarding.md §3.1, fait 3).
		const { client } = espion({
			...TOUTES_VIDES,
			mail_inbound_accounts: { count: null, error: { message: 'refus' }, status: 401 },
		})
		const etat = await mesurerEtape(client, 'messagerie')
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('forbidden')
	})

	it('rend une panne de transport plutôt que de laisser remonter l’exception', async () => {
		const client = {
			from: () => ({
				select: () => ({
					then: () => {
						throw new Error('transport injoignable')
					},
				}),
			}),
		} as unknown as ClientCrm
		const etat = await mesurerEtape(client, 'espace')
		expect(etat.statut === 'erreur' && etat.erreur.nature).toBe('network')
	})

	it('rend les cinq états indépendants : une mesure refusée n’efface pas les quatre autres', async () => {
		const { client } = espion({
			workspaces: ok(1),
			tracks: ok(3),
			channels: ok(6),
			cards: ok(14),
			mail_inbound_accounts: { count: null, error: { message: 'refus' }, status: 401 },
		})
		const progression = await mesurerDemarrage(client)
		expect(progression.etapes.map((etat) => etat.statut)).toEqual([
			'pret',
			'pret',
			'pret',
			'pret',
			'erreur',
		])
	})
})

describe('les trois états d’une étape, et la décision de l’accueil', () => {
	const accomplie = pret<EtapeDemarrage>({ cle: 'track', compte: 1 })
	const aFaire = pret<EtapeDemarrage>({ cle: 'track', compte: 0 })
	const nonMesurable = enErreur<EtapeDemarrage>({ nature: 'network', detail: 'panne' })

	it('une étape est accomplie dès la première ligne VISIBLE', () => {
		expect(estAccomplie(accomplie)).toBe(true)
		expect(estAccomplie(aFaire)).toBe(false)
	})

	it('une étape non mesurable n’est jamais comptée comme accomplie', () => {
		expect(estAccomplie(nonMesurable)).toBe(false)
		expect(estAccomplie(enChargement<EtapeDemarrage>())).toBe(false)
	})

	it('compte les accomplies sans retirer du total celles qui ont échoué', () => {
		const progression = { etapes: [accomplie, accomplie, aFaire, nonMesurable, aFaire] }
		expect(compterAccomplies(progression)).toEqual({ accomplies: 2, total: 5 })
	})

	it('une étape non mesurable maintient le guide : le guide ne se retire pas sur une supposition', () => {
		const progression = { etapes: [accomplie, accomplie, accomplie, accomplie, nonMesurable] }
		expect(resteUneEtape(progression)).toBe(true)
	})

	it('cinq étapes accomplies retirent le guide de l’accueil', () => {
		const progression = { etapes: Array.from({ length: 5 }, () => accomplie) }
		expect(resteUneEtape(progression)).toBe(false)
	})

	it('l’état initial est CHARGEMENT sur les cinq étapes, jamais un accompli par défaut', () => {
		// Sans cet état, un rendu où `etapes` serait vide passerait pour « tout accompli » et
		// l'accueil afficherait « aucun board » à qui en a (docs/SPEC-onboarding.md §4.2).
		expect(PROGRESSION_INITIALE.etapes).toHaveLength(5)
		expect(mesureEnCours(PROGRESSION_INITIALE)).toBe(true)
		expect(resteUneEtape(PROGRESSION_INITIALE)).toBe(true)
	})

	it('la mesure cesse d’être en cours dès que les cinq états sont rendus', () => {
		const rendus: readonly EtatAsync<EtapeDemarrage>[] = [
			accomplie,
			aFaire,
			nonMesurable,
			accomplie,
			aFaire,
		]
		expect(mesureEnCours({ etapes: rendus })).toBe(false)
	})
})
