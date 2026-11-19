// @verifies CRM-157 (docs/BACKLOG.md) — tranche T3 : huit étapes ; la boîte système testée, le domaine, l'identité de la
//           personne, mesurés dans l'espace courant ; sans contexte, aucune question ; l'identifiant court de l'espace
//           et le drapeau du super-administrateur lus avec la mesure (docs/SPEC-onboarding.md §11.1)
// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : la mesure des étapes
// @verifies docs/SPEC-onboarding.md §2 (la progression est une mesure, jamais un drapeau),
//           §3 (les étapes et leurs filtres), §3.2 (comptages indépendants),
//           §6.2 (les trois états d'une étape)
// @verifies CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 (six étapes, le workflow
//           avant le channel), §10.3 (le geste, ses issues, et le signal aux écrans ouverts) ;
//           docs/SPEC-workflow-engine.md §7 quater
// @verifies CRM-095 (docs/BACKLOG.md) tranche T3 — docs/SPEC-onboarding.md §10.7 : la destination de
//           l'étape « affaire », le premier channel vivant, lue avec chaque mesure
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les filtres `archived_at`/`deleted_at` du §3 sont une exigence de la
// spécification portée par la requête elle-même. Une étape qui compterait un objet en corbeille se
// dirait accomplie par un objet que l'écran ne montre nulle part.
// @verifies CRM-129 (docs/BACKLOG.md) — `presenceChannels` : le compte de l'étape « channel » décide de ce que
//           l'accueil dit ; docs/SPEC-onboarding.md §4.2 (précision du 2026-11-06), décision 859
// @verifies CRM-131 (docs/BACKLOG.md) — `lirePresenceChannels`, `useMesureChannels` : la présence lue à part hors d'un
//           track, une ligne au plus et jamais un comptage du guide, jamais sans client ; docs/SPEC-channels.md §5.5,
//           décisions 868 et 876 (INC-350) ; docs/SPEC-onboarding.md §10.2 (aucun comptage du guide sans la pastille)
// @verifies CRM-001 tranche INC-299, docs/DAT.md §3.5 bis (décision 700) — un compte est un `GET … limit=0`, jamais un `HEAD`

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	CLES_ETAPES_DEMARRAGE,
	COLONNES_BOARD_AFFAIRE,
	EVENEMENT_WORKFLOW_DEPART,
	FILTRES_ETAPES_DEMARRAGE,
	compterAccomplies,
	creerWorkflowDeDepart,
	estAccomplie,
	lirePresenceChannels,
	mesureEnCours,
	mesurerDemarrage,
	mesurerEtape,
	presenceChannels,
	presenceMesuree,
	useMesureChannels,
	PROGRESSION_INITIALE,
	lireSlugEspace,
	resteUneEtape,
	useApresWorkflowDeDepart,
	useDemarrage,
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
	/** `CRM-157` : les colonnes non nulles et les égalités du comptage. */
	readonly nonNuls: string[]
	readonly egalites: [string, unknown][]
	/** Borne `limit` du comptage : `LIMITE_COMPTE` (`compter.ts`). */
	limite: number | null
}

/** La lecture de la destination de l'étape « affaire » (`CRM-095`), notée à part des comptages. */
type Lecture = {
	readonly table: string
	readonly colonnes: string
	readonly nuls: [string, unknown][]
	readonly tris: string[]
	limite: number | null
}

type ReponseLignes = { data: unknown[] | null; error: { message: string } | null; status: number }

const AUCUN_CHANNEL: ReponseLignes = { data: [], error: null, status: 200 }

/**
 * Client espion : il enregistre chaque requête émise, et rend la réponse associée à la table.
 * Une table absente de `reponses` fait échouer le test plutôt que de rendre un défaut silencieux.
 *
 * Depuis `CRM-095`, la mesure lit AUSSI une ligne — la destination de l'étape « affaire » : sans options
 * de comptage, elle est notée dans `lectures` et reçoit `destination`. `appels` ne porte que les six
 * comptages, dont les preuves ci-dessous gardent ainsi leur sens exact.
 */
function espion(
	reponses: Readonly<Record<string, ReponseCompte>>,
	destination: ReponseLignes = AUCUN_CHANNEL,
): {
	client: ClientCrm
	appels: Appel[]
	lectures: Lecture[]
} {
	const appels: Appel[] = []
	const lectures: Lecture[] = []
	const client = {
		from: (table: string) => ({
			select: (colonnes: string, options?: unknown) => {
				if (options === undefined) {
					const lecture: Lecture = { table, colonnes, nuls: [], tris: [], limite: null }
					lectures.push(lecture)
					const lignes = {
						is: (colonne: string, valeur: unknown) => {
							lecture.nuls.push([colonne, valeur])
							return lignes
						},
						eq: () => lignes,
						order: (colonne: string) => {
							lecture.tris.push(colonne)
							return lignes
						},
						limit: (nombre: number) => {
							lecture.limite = nombre
							return lignes
						},
						then: (resoudre: (valeur: ReponseLignes) => unknown) => Promise.resolve(destination).then(resoudre),
					}
					return lignes
				}
				const nuls: [string, unknown][] = []
				const reponse = reponses[table]
				if (reponse === undefined) throw new Error(`table non attendue : ${table}`)
				const appel: Appel = { table, colonnes, options, nuls, nonNuls: [], egalites: [], limite: null }
				appels.push(appel)
				const chaine = {
					is: (colonne: string, valeur: unknown) => {
						nuls.push([colonne, valeur])
						return chaine
					},
					not: (colonne: string) => {
						appel.nonNuls.push(colonne)
						return chaine
					},
					eq: (colonne: string, valeur: unknown) => {
						appel.egalites.push([colonne, valeur])
						return chaine
					},
					limit: (nombre: number) => {
						appel.limite = nombre
						return chaine
					},
					then: (resoudre: (valeur: ReponseCompte) => unknown) =>
						Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels, lectures }
}

const ok = (count: number): ReponseCompte => ({ count, error: null, status: 200 })

const TOUTES_VIDES: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(0),
	tracks: ok(0),
	workflows: ok(0),
	channels: ok(0),
	cards: ok(0),
	mail_inbound_accounts: ok(0),
	mail_outbound_identities: ok(0),
}

/** `CRM-157` : l'espace courant et la personne, sans lesquels les trois étapes de la messagerie ne posent aucune question. */
const CONTEXTE = { idEspace: 'w-1', idUtilisateur: 'u-1' } as const

describe('les six étapes et leurs filtres — docs/SPEC-onboarding.md §3 et §10.1', () => {
	// RÉVISÉ par `CRM-157` (2026-11-19, docs/SPEC-onboarding.md §11.1) : huit étapes — la messagerie en trois.
	it('déclare exactement huit étapes, le workflow AVANT le channel, la messagerie en trois', () => {
		// `CRM-094` : un channel exige un workflow ; dans un espace neuf, aucun n'existe (décision 606).
		expect(CLES_ETAPES_DEMARRAGE).toEqual([
			'espace',
			'track',
			'workflow',
			'channel',
			'affaire',
			'boite-systeme',
			'domaine',
			'identite',
		])
	})

	it('interroge la table attendue pour chaque étape, dans l’espace courant', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client, CONTEXTE)
		expect(appels.map((appel) => appel.table)).toEqual([
			'workspaces',
			'tracks',
			'workflows',
			'channels',
			'cards',
			'mail_inbound_accounts',
			'workspaces',
			'mail_outbound_identities',
		])
	})

	it('CRM-157 : sans espace courant ni personne, la messagerie ne pose aucune question — trois étapes à faire', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		const progression = await mesurerDemarrage(client)
		expect(appels.map((appel) => appel.table)).toEqual(['workspaces', 'tracks', 'workflows', 'channels', 'cards'])
		expect(progression.etapes.slice(5)).toEqual([
			pret({ cle: 'boite-systeme', compte: 0 }),
			pret({ cle: 'domaine', compte: 0 }),
			pret({ cle: 'identite', compte: 0 }),
		])
	})

	it('CRM-157 : la boîte SYSTÈME testée, le domaine non nul, l’identité DE LA PERSONNE testée, dans l’espace courant', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client, CONTEXTE)
		const [boite, domaine, identite] = appels.slice(5)
		expect(boite).toMatchObject({ nuls: [['owner_id', null]], egalites: [['status', 'ok'], ['workspace_id', 'w-1']] })
		expect(domaine).toMatchObject({ nonNuls: ['inbound_domain'], egalites: [['id', 'w-1']] })
		expect(identite).toMatchObject({
			nuls: [],
			egalites: [
				['status', 'ok'],
				['workspace_id', 'w-1'],
				['owner_id', 'u-1'],
			],
		})
	})

	// RÉVISÉ par `CRM-001`, INC-299 (décision 700) : un compte est un `GET` borné à zéro ligne, plus un
	// `HEAD` — PostgREST ferme sans l'annoncer la connexion d'un `HEAD`, et Kong la réutilisait (`502`).
	it('compte sans rapporter les lignes : `count` exact et `limit(0)`, jamais `head`', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		for (const appel of appels) {
			expect(appel.options).toEqual({ count: 'exact' })
			expect(appel.limite).toBe(0)
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

	it('ne compte que les workflows VIVANTS, sans filtre de corbeille qu’ils ne portent pas', async () => {
		// `workflows` s'archive et n'a pas de corbeille : un workflow archivé ne rend pas l'étape
		// accomplie, puisque aucun channel ne peut plus le choisir.
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		expect(appels.find((appel) => appel.table === 'workflows')?.nuls).toEqual([['archived_at', null]])
	})

	it('retire l’affaire en corbeille, et n’invente aucun filtre d’archivage pour elle', async () => {
		// `cards` ne porte pas de colonne `archived_at` : lui en demander une serait une règle
		// inventée ici, et la requête échouerait contre la vraie base.
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		const cards = appels.find((appel) => appel.table === 'cards')
		expect(cards?.nuls).toEqual([['deleted_at', null]])
	})

	// RÉVISÉ par `CRM-157` : l'étape « espace » reste sans filtre ; la boîte entrante, devenue la boîte SYSTÈME de l'espace
	// courant, en porte désormais (preuve ci-dessus).
	it('n’applique aucun filtre à l’étape « espace »', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		expect(appels.find((appel) => appel.table === 'workspaces')).toMatchObject({ nuls: [], nonNuls: [], egalites: [] })
	})

	it('déclare ses tables par le schéma, et le §3 les épingle', () => {
		expect(FILTRES_ETAPES_DEMARRAGE['boite-systeme'].table).toBe('mail_inbound_accounts')
		expect(FILTRES_ETAPES_DEMARRAGE.identite.table).toBe('mail_outbound_identities')
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
		const etat = await mesurerEtape(client, 'boite-systeme', CONTEXTE)
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

	it('rend les huit états indépendants : une mesure refusée n’efface pas les sept autres', async () => {
		const { client } = espion({
			workspaces: ok(1),
			tracks: ok(3),
			workflows: ok(2),
			channels: ok(6),
			cards: ok(14),
			mail_inbound_accounts: { count: null, error: { message: 'refus' }, status: 401 },
			mail_outbound_identities: ok(1),
		})
		const progression = await mesurerDemarrage(client, CONTEXTE)
		expect(progression.etapes.map((etat) => etat.statut)).toEqual([
			'pret',
			'pret',
			'pret',
			'pret',
			'pret',
			'erreur',
			'pret',
			'pret',
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
		const progression = { etapes: [accomplie, accomplie, aFaire, nonMesurable, aFaire], boardAffaire: null, slugEspace: null, superadmin: false }
		expect(compterAccomplies(progression)).toEqual({ accomplies: 2, total: 5 })
	})

	it('une étape non mesurable maintient le guide : le guide ne se retire pas sur une supposition', () => {
		const progression = { etapes: [accomplie, accomplie, accomplie, accomplie, nonMesurable], boardAffaire: null, slugEspace: null, superadmin: false }
		expect(resteUneEtape(progression)).toBe(true)
	})

	it('huit étapes accomplies retirent le guide de l’accueil', () => {
		const progression = { etapes: Array.from({ length: 8 }, () => accomplie), boardAffaire: null, slugEspace: null, superadmin: false }
		expect(resteUneEtape(progression)).toBe(false)
	})

	it('l’état initial est CHARGEMENT sur les huit étapes, jamais un accompli par défaut', () => {
		// Sans cet état, un rendu où `etapes` serait vide passerait pour « tout accompli » et
		// l'accueil afficherait « aucun board » à qui en a (docs/SPEC-onboarding.md §4.2).
		expect(PROGRESSION_INITIALE.etapes).toHaveLength(8)
		expect(PROGRESSION_INITIALE.boardAffaire).toBeNull()
		expect(mesureEnCours(PROGRESSION_INITIALE)).toBe(true)
		expect(resteUneEtape(PROGRESSION_INITIALE)).toBe(true)
	})

	it('la mesure cesse d’être en cours dès que tous les états sont rendus', () => {
		const rendus: readonly EtatAsync<EtapeDemarrage>[] = [
			accomplie,
			aFaire,
			nonMesurable,
			accomplie,
			aFaire,
		]
		expect(mesureEnCours({ etapes: rendus, boardAffaire: null, slugEspace: null, superadmin: false })).toBe(false)
	})
})

describe('la présence de channels lisibles — CRM-129, docs/SPEC-onboarding.md §4.2', () => {
	/** Une progression dont seule l'étape « channel » varie : les cinq autres sont accomplies. */
	function avecChannel(etat: EtatAsync<EtapeDemarrage>) {
		return {
			etapes: CLES_ETAPES_DEMARRAGE.map((cle) => (cle === 'channel' ? etat : pret<EtapeDemarrage>({ cle, compte: 1 }))),
			boardAffaire: null,
			slugEspace: null,
			superadmin: false,
		}
	}

	it('zéro channel lisible : « aucun », le seul cas où l’état vide dit vrai', () => {
		expect(presenceChannels(avecChannel(pret({ cle: 'channel', compte: 0 })))).toBe('aucun')
	})

	it('au moins un channel lisible : « présent »', () => {
		expect(presenceChannels(avecChannel(pret({ cle: 'channel', compte: 1 })))).toBe('present')
		expect(presenceChannels(avecChannel(pret({ cle: 'channel', compte: 6 })))).toBe('present')
	})

	it('la mesure en échec : « inconnu », jamais « aucun »', () => {
		expect(presenceChannels(avecChannel(enErreur({ nature: 'forbidden', detail: 'refus' })))).toBe('inconnu')
		expect(presenceChannels(avecChannel(enErreur({ nature: 'network', detail: 'panne' })))).toBe('inconnu')
	})

	it('la mesure en vol : « chargement », jamais « aucun »', () => {
		expect(presenceChannels(PROGRESSION_INITIALE)).toBe('chargement')
	})

	it('lit l’étape « channel » par sa place, et non une autre étape à zéro', () => {
		const progression = {
			etapes: CLES_ETAPES_DEMARRAGE.map((cle) => pret<EtapeDemarrage>({ cle, compte: cle === 'channel' ? 2 : 0 })),
			boardAffaire: null,
			slugEspace: null,
			superadmin: false,
		}
		expect(presenceChannels(progression)).toBe('present')
	})
})

describe('la présence lue à part pour la barre d’onglets — CRM-131, docs/SPEC-channels.md §5.5, décision 876', () => {
	// Démonter chaque crochet : une lecture résolue après la fin du fichier ferait travailler React sans `window`.
	afterEach(cleanup)

	type Reponse = { data: { id: string }[] | null; error: { message: string } | null; status: number }
	function clientEspion(reponse: Reponse | Error) {
		const tables: string[] = []
		const nuls: string[] = []
		const selections: unknown[][] = []
		const limites: number[] = []
		const client = {
			from: (table: string) => {
				tables.push(table)
				const chaine = {
					is: (colonne: string) => {
						nuls.push(colonne)
						return chaine
					},
					limit: (n: number) => {
						limites.push(n)
						return chaine
					},
					then: (resoudre: (valeur: Reponse) => unknown, rejeter: (cause: unknown) => unknown) =>
						(reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse)).then(resoudre, rejeter),
				}
				return {
					select: (...args: unknown[]) => {
						selections.push(args)
						return chaine
					},
				}
			},
		} as unknown as ClientCrm
		return { client, tables, nuls, selections, limites }
	}
	const UNE_LIGNE: Reponse = { data: [{ id: 'c-1' }], error: null, status: 200 }

	it('lit AU PLUS UNE ligne des channels vivants, sans comptage : ce n’est pas une mesure du guide (INC-350)', async () => {
		const espion = clientEspion(UNE_LIGNE)
		expect(await lirePresenceChannels(espion.client)).toBe('present')
		expect(espion.tables).toEqual(['channels'])
		expect(espion.nuls).toEqual([...FILTRES_ETAPES_DEMARRAGE.channel.nuls])
		expect(espion.limites).toEqual([1])
		// Aucune option `count` : la requête ne porte pas `Prefer: count=exact`, la forme d'un comptage du guide.
		expect(espion.selections).toEqual([['id']])
	})

	it('aucune ligne : « aucun » ; un refus, des données absentes ou une panne : « inconnu », jamais « aucun »', async () => {
		expect(await lirePresenceChannels(clientEspion({ data: [], error: null, status: 200 }).client)).toBe('aucun')
		expect(await lirePresenceChannels(clientEspion({ data: null, error: { message: 'refus' }, status: 403 }).client)).toBe(
			'inconnu',
		)
		expect(await lirePresenceChannels(clientEspion({ data: null, error: null, status: 200 }).client)).toBe('inconnu')
		expect(await lirePresenceChannels(clientEspion(new Error('réseau')).client)).toBe('inconnu')
	})

	it('sans client, n’émet AUCUNE lecture et reste « chargement »', async () => {
		const { result } = renderHook(() => useMesureChannels(null))
		await Promise.resolve()
		expect(result.current).toBe('chargement')
	})

	it('le crochet rend la présence lue', async () => {
		const present = renderHook(() => useMesureChannels(clientEspion(UNE_LIGNE).client))
		await waitFor(() => expect(present.result.current).toBe('present'))
		const aucun = renderHook(() => useMesureChannels(clientEspion({ data: [], error: null, status: 200 }).client))
		await waitFor(() => expect(aucun.result.current).toBe('aucun'))
		const panne = renderHook(() =>
			useMesureChannels(clientEspion({ data: null, error: { message: 'panne' }, status: 500 }).client),
		)
		await waitFor(() => expect(panne.result.current).toBe('inconnu'))
	})

	it('relit quand le client revient : à chaque entrée sur une route transverse', async () => {
		const espion = clientEspion(UNE_LIGNE)
		const { result, rerender } = renderHook(({ client }: { client: ClientCrm | null }) => useMesureChannels(client), {
			initialProps: { client: espion.client as ClientCrm | null },
		})
		await waitFor(() => expect(result.current).toBe('present'))
		rerender({ client: null })
		expect(result.current).toBe('chargement')
		rerender({ client: espion.client })
		await waitFor(() => expect(result.current).toBe('present'))
		expect(espion.tables).toHaveLength(2)
	})

	it('presenceMesuree lit une mesure absente comme « inconnu »', () => {
		expect(presenceMesuree(undefined)).toBe('inconnu')
	})
})

describe('le workflow de départ — docs/SPEC-workflow-engine.md §7 quater, SPEC-onboarding §10.3', () => {
	type ReponseRpc = { data: unknown; error: { code?: string; message: string } | null; status: number }
	function client(reponse: ReponseRpc | Error): { client: ClientCrm; appels: [string, unknown][] } {
		const appels: [string, unknown][] = []
		return {
			appels,
			client: {
				rpc: async (fonction: string, args: unknown) => {
					appels.push([fonction, args])
					if (reponse instanceof Error) throw reponse
					return reponse
				},
			} as unknown as ClientCrm,
		}
	}

	it('appelle la fonction du §7 quater avec l’espace courant, et rend le succès', async () => {
		const { client: c, appels } = client({ data: 'e0940000-0000-4000-8000-0000000000c9', error: null, status: 200 })
		expect(await creerWorkflowDeDepart(c, 'e0940000-0000-4000-8000-0000000000c1')).toEqual({ ok: true })
		expect(appels).toEqual([['creer_workflow_de_depart', { p_workspace: 'e0940000-0000-4000-8000-0000000000c1' }]])
	})

	it('nomme le refus d’un non-administrateur, lu sur le code et non sur le texte', async () => {
		const { client: c } = client({ data: null, error: { code: '42501', message: 'reserve aux administrateurs' }, status: 403 })
		expect(await creerWorkflowDeDepart(c, 'x')).toEqual({ ok: false, raison: 'reserve' })
	})

	it('nomme un workflow déjà présent', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0001', message: 'workflow existant' }, status: 400 })
		expect(await creerWorkflowDeDepart(c, 'x')).toEqual({ ok: false, raison: 'existant' })
	})

	it('nomme le nœud archivé, clé comprise, pour que l’écran dise lequel restaurer', async () => {
		const { client: c } = client({ data: null, error: { code: 'P0001', message: 'noeud archive : perdu' }, status: 400 })
		expect(await creerWorkflowDeDepart(c, 'x')).toEqual({ ok: false, raison: 'noeud-archive', cle: 'perdu' })
	})

	it('rend une panne — jamais un succès supposé — sur tout autre échec, transport compris', async () => {
		const { client: c } = client({ data: null, error: { code: '57014', message: 'annulée' }, status: 500 })
		expect(await creerWorkflowDeDepart(c, 'x')).toEqual({ ok: false, raison: 'panne' })
		const { client: d } = client(new Error('transport injoignable'))
		expect(await creerWorkflowDeDepart(d, 'x')).toEqual({ ok: false, raison: 'panne' })
	})

	describe('le signal aux écrans ouverts — §10.3, « les écrans ouverts se relisent »', () => {
		let recus = 0
		const compter = () => {
			recus += 1
		}
		beforeEach(() => {
			recus = 0
			globalThis.addEventListener(EVENEMENT_WORKFLOW_DEPART, compter)
		})
		afterEach(() => globalThis.removeEventListener(EVENEMENT_WORKFLOW_DEPART, compter))

		it('part sur un succès : la base porte un workflow que l’écran sous le panneau n’a pas lu', async () => {
			const { client: c } = client({ data: 'wf', error: null, status: 200 })
			await creerWorkflowDeDepart(c, 'x')
			expect(recus).toBe(1)
		})

		it('part aussi sur « existant » : un collègue l’a posé, et l’écran ouvert l’ignore peut-être', async () => {
			const { client: c } = client({ data: null, error: { code: 'P0001', message: 'workflow existant' }, status: 400 })
			await creerWorkflowDeDepart(c, 'x')
			expect(recus).toBe(1)
		})

		it('ne part PAS sur un refus ni sur une panne : rien n’a changé en base', async () => {
			for (const reponse of [
				{ data: null, error: { code: '42501', message: 'reserve aux administrateurs' }, status: 403 },
				{ data: null, error: { code: 'P0001', message: 'noeud archive : perdu' }, status: 400 },
				{ data: null, error: { code: '57014', message: 'annulée' }, status: 500 },
				new Error('transport injoignable'),
			]) {
				await creerWorkflowDeDepart(client(reponse).client, 'x')
			}
			expect(recus).toBe(0)
		})

		it('l’abonnement d’un écran reçoit le signal, et le lâche à son démontage', () => {
			let relectures = 0
			const relire = () => {
				relectures += 1
			}
			const { unmount } = renderHook(() => useApresWorkflowDeDepart(relire))
			globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
			expect(relectures).toBe(1)
			unmount()
			globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
			expect(relectures).toBe(1)
		})
	})
})

describe('la destination de l’étape « affaire » — CRM-095, docs/SPEC-onboarding.md §10.7', () => {
	it('lit UNE ligne : le premier channel vivant, dont le track est vivant, trié par track puis par channel', async () => {
		const { client, lectures } = espion(TOUTES_VIDES)
		await mesurerDemarrage(client)
		expect(lectures).toEqual([
			{
				table: 'channels',
				colonnes: COLONNES_BOARD_AFFAIRE,
				nuls: [
					['archived_at', null],
					['deleted_at', null],
					['tracks.archived_at', null],
					['tracks.deleted_at', null],
				],
				// La position d'un channel est numérotée PAR TRACK : le track d'abord, sans quoi les tracks
				// s'entrelacent (docs/DESIGN_SYSTEM.md §5.48 bis).
				tris: ['tracks(position)', 'tracks(name)', 'position', 'name'],
				limite: 1,
			},
		])
		// `!inner` : un channel dont le track n'est pas lisible n'est pas une destination. Et le tri sur le
		// track EXIGE ses colonnes dans l'embarqué : sans elles, PostgREST rend `400` (mesuré, pile réelle).
		expect(COLONNES_BOARD_AFFAIRE).toBe('slug, tracks!inner(slug, position, name)')
	})

	it('rend l’adresse du board de ce channel', async () => {
		const { client } = espion(TOUTES_VIDES, {
			data: [{ slug: 'premier-channel', tracks: { slug: 'premier-track' } }],
			error: null,
			status: 200,
		})
		expect((await mesurerDemarrage(client)).boardAffaire).toBe('/tracks/premier-track/premier-channel')
	})

	it('sans channel, ou quand la lecture échoue, aucune destination : l’étape garde son lien d’avant', async () => {
		expect((await mesurerDemarrage(espion(TOUTES_VIDES).client)).boardAffaire).toBeNull()
		const refus = espion(TOUTES_VIDES, { data: null, error: { message: 'panne' }, status: 500 })
		const progression = await mesurerDemarrage(refus.client)
		expect(progression.boardAffaire).toBeNull()
		// L'échec de la destination n'est pas celui d'une étape : les six mesures restent lues.
		expect(progression.etapes.every((etat) => etat.statut === 'pret')).toBe(true)
	})
})

// @verifies CRM-157 (docs/BACKLOG.md) — tranche T3 : ce que l'étape du domaine doit savoir pour mener au réglage
describe('l’identifiant court de l’espace et le drapeau du super-administrateur (CRM-157, §11.1)', () => {
	it('lit l’identifiant court de l’espace courant ; sans espace ou en échec, `null`', async () => {
		const lu: unknown[] = []
		const client = {
			from: (table: string) => ({
				select: (colonnes: string) => ({
					eq: (colonne: string, valeur: string) => ({
						limit: () => {
							lu.push([table, colonnes, colonne, valeur])
							return Promise.resolve({ data: [{ slug: 'crm' }], error: null })
						},
					}),
				}),
			}),
		} as unknown as ClientCrm
		expect(await lireSlugEspace(client, 'w-1')).toBe('crm')
		expect(lu).toEqual([['workspaces', 'slug', 'id', 'w-1']])
		expect(await lireSlugEspace(client, null)).toBeNull()
		const enPanne = { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) } as unknown as ClientCrm
		expect(await lireSlugEspace(enPanne, 'w-1')).toBeNull()
	})

	it('la mesure rend le drapeau que la base dit, et `false` quand elle ne le dit pas', async () => {
		const { client } = espion(TOUTES_VIDES)
		const sans = await mesurerDemarrage(client)
		expect(sans.superadmin).toBe(false)
		const avecRpc = { ...client, rpc: () => Promise.resolve({ data: true, error: null, status: 200 }) } as unknown as ClientCrm
		expect((await mesurerDemarrage(avecRpc)).superadmin).toBe(true)
	})
})

// @verifies CRM-157 (docs/BACKLOG.md) — tranche T3 : la mesure en deux moitiés — l'arrivée de l'espace courant ne refait que
//           la messagerie ; un espace encore en lecture laisse la messagerie en chargement (docs/SPEC-onboarding.md §11.1)
describe('la mesure en deux moitiés (CRM-157)', () => {
	it('changer d’espace courant ne refait que la messagerie : les cinq premiers comptages ne repartent pas', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		const { result, rerender } = renderHook(({ contexte }) => useDemarrage(client, contexte), {
			initialProps: { contexte: { idEspace: 'w-1', idUtilisateur: 'u-1' } as { idEspace: string; idUtilisateur: string } | null },
		})
		await waitFor(() => expect(mesureEnCours(result.current.progression)).toBe(false))
		const tracksAvant = appels.filter((appel) => appel.table === 'tracks').length
		rerender({ contexte: { idEspace: 'w-2', idUtilisateur: 'u-1' } })
		await waitFor(() => expect(appels.filter((appel) => appel.table === 'mail_outbound_identities')).toHaveLength(2))
		expect(appels.filter((appel) => appel.table === 'tracks')).toHaveLength(tracksAvant)
	})

	it('un espace encore en lecture (`null`) laisse la messagerie EN CHARGEMENT : rien n’est affirmé', async () => {
		const { client, appels } = espion(TOUTES_VIDES)
		const { result } = renderHook(() => useDemarrage(client, null))
		await waitFor(() => expect(result.current.progression.etapes[4]?.statut).toBe('pret'))
		expect(result.current.progression.etapes.slice(5).map((etat) => etat.statut)).toEqual(['chargement', 'chargement', 'chargement'])
		expect(mesureEnCours(result.current.progression)).toBe(true)
		expect(appels.some((appel) => appel.table === 'mail_inbound_accounts')).toBe(false)
	})
})

