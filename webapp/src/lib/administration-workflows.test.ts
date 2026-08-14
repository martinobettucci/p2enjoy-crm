// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première et deuxième
//           tranches
// @verifies docs/SPEC-workflow-engine.md §7 bis.3 (les trois lectures, leurs filtres et leur ordre),
//           §7 bis.4 (les six gestes et ce que la base garantit), §7 bis.5 (validation de forme),
//           §7 bis.8 (preuves attendues, niveau unitaire), §7 bis.9 (deuxième tranche : les arêtes,
//           leur groupement, leurs choix offerts et leurs refus), §3.4 (modèle des arêtes)
// @verifies docs/SPEC-workflow-engine.md §2.5 (`0` n'est pas `NULL`), §3.3 (modèle `workflow_steps`,
//           unicité `(workflow_id, node_id)`, surcharges facultatives), §3.5 (l'étape initiale)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue, comme celui de
// `CRM-075`. Motif : trois exigences de la spécification sont portées par la requête elle-même — le
// filtre des nœuds archivés, l'ordre des étapes, et l'embarquement du nœud — et un test qui
// n'observerait que la réponse les laisserait disparaître sans bruit.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_ETAPE_ADMIN,
	COLONNES_NOEUD_AJOUTABLE,
	COLONNES_WORKFLOW_ADMIN,
	ajouterEtape,
	ancienneteConforme,
	classerRefusEtape,
	deplacerEtape,
	designerEtapeInitiale,
	libelleEtape,
	libelleSurchargeConforme,
	lireCatalogueActif,
	lireEtapes,
	lireWorkflowsAdministrables,
	noeudsAjoutables,
	probabiliteConforme,
	retirerEtape,
	surchargerEtape,
	COLONNES_TRANSITION_ADMIN,
	arriveesPossibles,
	classerRefusTransition,
	declarerTransition,
	grouperTransitions,
	libelleTransitionConforme,
	lireTransitions,
	modifierTransition,
	retirerTransition,
	type EtapeAdministrable,
	type NoeudAjoutable,
	type TransitionAdministrable,
} from './administration-workflows'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Clients espions — même patron que `administration-arborescence.test.ts`
// ---------------------------------------------------------------------------------------------

type AppelLecture = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	tris: [string, unknown?][]
}

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

function espionLecture(reponse: Reponse): { client: ClientCrm; appel: AppelLecture } {
	const appel: AppelLecture = { filtres: [], tris: [] }
	const chaine = {
		is: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		order: (colonne: string, options?: unknown) => {
			appel.tris.push([colonne, options])
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

type Ecriture = {
	table?: string
	verbe?: 'insert' | 'update' | 'delete'
	charge?: Record<string, unknown>
	filtres: [string, unknown][]
	colonnesRendues?: string
}

/**
 * Client factice qui enregistre **toutes** les écritures, et non la dernière.
 *
 * C'est nécessaire pour `designerEtapeInitiale`, qui en émet deux : un test qui n'observerait que
 * la seconde ne verrait pas l'extinction, c'est-à-dire précisément la moitié du geste que le §3.5
 * rend obligatoire.
 */
function espionEcritures(reponses: readonly Reponse[]): { client: ClientCrm; appels: Ecriture[] } {
	const appels: Ecriture[] = []
	let rang = 0
	const nouvelle = (): Ecriture => {
		const appel: Ecriture = { filtres: [] }
		appels.push(appel)
		return appel
	}
	const chaineDe = (appel: Ecriture) => {
		const chaine = {
			eq: (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			},
			select: (colonnes: string) => {
				appel.colonnesRendues = colonnes
				return chaine
			},
			then: (resoudre: (valeur: Reponse) => unknown) => {
				const reponse = reponses[Math.min(rang, reponses.length - 1)] as Reponse
				rang += 1
				return Promise.resolve(reponse).then(resoudre)
			},
		}
		return chaine
	}
	const client = {
		from: (table: string) => {
			const appel = nouvelle()
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.verbe = 'insert'
					appel.charge = charge
					return chaineDe(appel)
				},
				update: (charge: Record<string, unknown>) => {
					appel.verbe = 'update'
					appel.charge = charge
					return chaineDe(appel)
				},
				delete: () => {
					appel.verbe = 'delete'
					return chaineDe(appel)
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const OK: Reponse = { data: [{ id: 'x' }], error: null, status: 200 }
const ZERO_LIGNE: Reponse = { data: [], error: null, status: 200 }

function etape(partiel: Partial<EtapeAdministrable> & { id: string; node_id: string }): EtapeAdministrable {
	return {
		workflow_id: 'w1',
		workspace_id: 'ws1',
		position: 1,
		label_override: null,
		probability_override: null,
		stale_after_days: null,
		is_initial: false,
		node: null,
		...partiel,
	}
}

function noeud(id: string, label: string): NoeudAjoutable {
	return {
		id,
		key: label.toLowerCase(),
		label,
		kind: 'open',
		color: 'neutral',
		position: 1,
		default_probability: null,
		default_stale_after_days: null,
	}
}

// ---------------------------------------------------------------------------------------------
// Les trois lectures — §7 bis.3
// ---------------------------------------------------------------------------------------------

describe('les lectures de l’éditeur (§7 bis.3)', () => {
	it('les workflows sont demandés sans filtre de workspace, le défaut en tête', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireWorkflowsAdministrables(client, false)
		expect(appel.table).toBe('workflows')
		expect(appel.colonnes).toBe(COLONNES_WORKFLOW_ADMIN)
		// Aucun `workspace_id` : la RLS borne déjà, et l'ajouter ferait croire que l'interface protège.
		expect(appel.filtres.map(([colonne]) => colonne)).toEqual(['archived_at'])
		expect(appel.tris).toEqual([['is_default', { ascending: false }], ['name', undefined]])
	})

	it('la case « voir les archivés » retire le filtre, elle ne le déplace pas dans le navigateur', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireWorkflowsAdministrables(client, true)
		expect(appel.filtres).toEqual([])
	})

	it('les étapes sont filtrées par workflow, ordonnées par position, et embarquent leur nœud', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireEtapes(client, 'w1')
		expect(appel.table).toBe('workflow_steps')
		expect(appel.filtres).toEqual([['workflow_id', 'w1']])
		expect(appel.tris).toEqual([['position', undefined]])
		// L'embarquement est nommé par la clé étrangère composite : sans elle, PostgREST refuse.
		expect(COLONNES_ETAPE_ADMIN).toContain('workflow_steps_node_id_workspace_id_fkey')
	})

	it('le catalogue exclut les nœuds archivés CÔTÉ SERVEUR (§2.6)', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireCatalogueActif(client)
		expect(appel.table).toBe('workflow_nodes_catalog')
		expect(appel.colonnes).toBe(COLONNES_NOEUD_AJOUTABLE)
		expect(appel.filtres).toEqual([['archived_at', null]])
		expect(appel.tris).toEqual([['position', undefined], ['label', undefined]])
	})

	it('un refus de lecture devient un état d’erreur classé, jamais une liste vide', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'refusé' }, status: 403 })
		const etat = await lireEtapes(client, 'w1')
		expect(etat.statut).toBe('erreur')
	})
})

// ---------------------------------------------------------------------------------------------
// Composition — §7 bis.3 et §3.3
// ---------------------------------------------------------------------------------------------

describe('le libellé d’une étape (§3.3)', () => {
	const NOEUD = {
		id: 'n1',
		key: 'prospection',
		label: 'Prospection',
		kind: 'open',
		color: 'neutral',
		default_probability: null,
		default_stale_after_days: null,
	}

	it('prend la surcharge lorsqu’elle existe', () => {
		expect(libelleEtape(etape({ id: 'e1', node_id: 'n1', label_override: 'Qualification', node: NOEUD }))).toBe(
			'Qualification',
		)
	})

	it('prend le libellé du catalogue lorsque la surcharge est absente', () => {
		expect(libelleEtape(etape({ id: 'e1', node_id: 'n1', node: NOEUD }))).toBe('Prospection')
	})

	// Une surcharge blanche ne peut pas venir de la base — le `CHECK` du §3.3 la refuse —, mais un
	// état local d'édition la produit avant l'envoi. Le repli vaut mieux qu'une étape sans nom.
	it('se replie sur le catalogue si la surcharge est blanche', () => {
		expect(libelleEtape(etape({ id: 'e1', node_id: 'n1', label_override: '   ', node: NOEUD }))).toBe(
			'Prospection',
		)
	})

	it('nomme la clé, puis l’identifiant, lorsque le nœud n’a pas été rendu', () => {
		expect(libelleEtape(etape({ id: 'e1', node_id: 'n1' }))).toBe('n1')
	})
})

describe('les nœuds ajoutables (§7 bis.4, unicité `(workflow_id, node_id)`)', () => {
	const CATALOGUE = [noeud('n1', 'Prospection'), noeud('n2', 'Devis'), noeud('n3', 'Gagné')]

	it('retire du choix les nœuds qu’une étape emploie déjà', () => {
		const restants = noeudsAjoutables(CATALOGUE, [etape({ id: 'e1', node_id: 'n2' })])
		expect(restants.map((n) => n.id)).toEqual(['n1', 'n3'])
	})

	it('rend le catalogue entier lorsque le workflow n’a aucune étape', () => {
		expect(noeudsAjoutables(CATALOGUE, [])).toHaveLength(3)
	})

	it('rend une liste vide lorsque tout le catalogue est employé', () => {
		const toutes = CATALOGUE.map((n, index) => etape({ id: `e${index}`, node_id: n.id }))
		expect(noeudsAjoutables(CATALOGUE, toutes)).toEqual([])
	})
})

// ---------------------------------------------------------------------------------------------
// Validation de forme — §7 bis.5, et le `0` du §2.5
// ---------------------------------------------------------------------------------------------

describe('la validation de forme (§7 bis.5)', () => {
	it('refuse une surcharge de libellé blanche, accepte le reste', () => {
		expect(libelleSurchargeConforme('')).toBe(false)
		expect(libelleSurchargeConforme('   ')).toBe(false)
		expect(libelleSurchargeConforme(' Devis ')).toBe(true)
	})

	// LE CŒUR DU §2.5 : `0` est une probabilité valide. Une garde écrite `if (!probabilite)` la
	// confondrait avec l'absence de surcharge et ferait disparaître une saisie légitime.
	it('accepte `0` et `100` comme probabilités, et rien au-delà des bornes', () => {
		expect(probabiliteConforme(0)).toBe(true)
		expect(probabiliteConforme(100)).toBe(true)
		expect(probabiliteConforme(-0.01)).toBe(false)
		expect(probabiliteConforme(100.01)).toBe(false)
		expect(probabiliteConforme(Number.NaN)).toBe(false)
		expect(probabiliteConforme(Number.POSITIVE_INFINITY)).toBe(false)
	})

	it('exige une ancienneté entière et strictement positive — `0` n’y est PAS valide', () => {
		expect(ancienneteConforme(1)).toBe(true)
		expect(ancienneteConforme(0)).toBe(false)
		expect(ancienneteConforme(-3)).toBe(false)
		expect(ancienneteConforme(2.5)).toBe(false)
	})
})

// ---------------------------------------------------------------------------------------------
// Les refus — §7 bis.4
// ---------------------------------------------------------------------------------------------

describe('le classement des refus (§7 bis.4)', () => {
	it('lit `23505` comme le nœud déjà employé, jamais comme un slug pris', () => {
		expect(classerRefusEtape(409, '23505', 'duplicate', 'ajout').nature).toBe('noeud-deja-employe')
	})

	// LA SEULE SUBTILITÉ DE CETTE FONCTION : le même code SQL dit deux choses opposées.
	it('lit `23503` comme une étape occupée SUR UN RETRAIT, et comme une référence absente sinon', () => {
		expect(classerRefusEtape(409, '23503', 'fk', 'retrait').nature).toBe('etape-occupee')
		expect(classerRefusEtape(409, '23503', 'fk', 'ajout').nature).toBe('reference-absente')
	})

	it('lit `23514` comme un refus de forme', () => {
		expect(classerRefusEtape(400, '23514', 'check', 'surcharge').nature).toBe('forme-refusee')
	})

	it('lit `401` et `403` comme un refus de droit, sans code SQL', () => {
		expect(classerRefusEtape(403, undefined, 'denied', 'surcharge').nature).toBe('forbidden')
		expect(classerRefusEtape(401, undefined, 'denied', 'retrait').nature).toBe('forbidden')
	})

	it('lit l’absence de statut comme un défaut de réseau', () => {
		expect(classerRefusEtape(undefined, undefined, 'offline', 'ajout').nature).toBe('network')
	})
})

// ---------------------------------------------------------------------------------------------
// Les six écritures — §7 bis.4
// ---------------------------------------------------------------------------------------------

describe('les écritures de l’éditeur (§7 bis.4)', () => {
	it('l’ajout envoie `position: null` et AUCUNE surcharge (§2.5, §3.3)', async () => {
		const { client, appels } = espionEcritures([OK])
		const resultat = await ajouterEtape(client, { idWorkflow: 'w1', idWorkspace: 'ws1', idNoeud: 'n1' })
		expect(resultat.statut).toBe('applique')
		const appel = appels[0]
		expect(appel?.table).toBe('workflow_steps')
		expect(appel?.verbe).toBe('insert')
		expect(appel?.charge).toEqual({
			workflow_id: 'w1',
			workspace_id: 'ws1',
			node_id: 'n1',
			position: null,
		})
		// Recopier `default_probability` dans `probability_override` figerait la valeur du jour et
		// romprait le lien avec le catalogue, sans que rien à l'écran ne le montre.
		expect(Object.keys(appel?.charge ?? {})).not.toContain('probability_override')
	})

	it('le déplacement n’écrit QUE la position, sur la seule étape déplacée', async () => {
		const { client, appels } = espionEcritures([OK])
		await deplacerEtape(client, 'e1', 1.5)
		expect(appels[0]?.charge).toEqual({ position: 1.5 })
		expect(appels[0]?.filtres).toEqual([['id', 'e1']])
	})

	// `null` EST ENVOYÉ, PAS OMIS : c'est ainsi qu'une surcharge se retire (§2.5).
	it('la surcharge envoie les trois colonnes, `null` compris', async () => {
		const { client, appels } = espionEcritures([OK])
		await surchargerEtape(client, 'e1', { libelle: 'Devis', probabilite: 0, anciennete: null })
		expect(appels[0]?.charge).toEqual({
			label_override: 'Devis',
			probability_override: 0,
			stale_after_days: null,
		})
	})

	it('désigner l’étape initiale ÉTEINT d’abord, allume ensuite (§3.5)', async () => {
		const { client, appels } = espionEcritures([OK, OK])
		const resultat = await designerEtapeInitiale(client, 'w1', 'e2')
		expect(resultat.statut).toBe('applique')
		expect(appels).toHaveLength(2)
		// L'ordre est le contrat : l'inverse heurterait l'index unique partiel le temps d'une écriture.
		expect(appels[0]?.charge).toEqual({ is_initial: false })
		expect(appels[0]?.filtres).toEqual([['workflow_id', 'w1'], ['is_initial', true]])
		expect(appels[1]?.charge).toEqual({ is_initial: true })
		expect(appels[1]?.filtres).toEqual([['id', 'e2']])
	})

	it('une extinction sans effet n’empêche pas l’allumage : aucune étape n’était initiale', async () => {
		const { client, appels } = espionEcritures([ZERO_LIGNE, OK])
		const resultat = await designerEtapeInitiale(client, 'w1', 'e2')
		expect(resultat.statut).toBe('applique')
		expect(appels).toHaveLength(2)
	})

	it('un refus à l’extinction arrête le geste avant d’allumer', async () => {
		const { client, appels } = espionEcritures([{ data: null, error: { message: 'nope' }, status: 403 }])
		const resultat = await designerEtapeInitiale(client, 'w1', 'e2')
		expect(resultat.statut).toBe('refus')
		expect(appels).toHaveLength(1)
	})

	it('le retrait supprime, et traduit le `23503` du `on delete restrict`', async () => {
		const { client, appels } = espionEcritures([
			{ data: null, error: { message: 'violates foreign key', code: '23503' }, status: 409 },
		])
		const resultat = await retirerEtape(client, 'e1')
		expect(appels[0]?.verbe).toBe('delete')
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'etape-occupee', detail: 'violates foreign key' },
		})
	})

	// `200` et zéro ligne n'est ni un succès ni une erreur : c'est le `USING` de la politique qui a
	// filtré la ligne avant la mise à jour, et l'écran doit le dire.
	it('rend `sans-effet` sur `200` et zéro ligne, jamais `applique`', async () => {
		const { client } = espionEcritures([ZERO_LIGNE])
		expect((await deplacerEtape(client, 'e1', 2)).statut).toBe('sans-effet')
	})
})

// =============================================================================================
// DEUXIÈME TRANCHE — les arêtes du graphe
// @verifies docs/SPEC-workflow-engine.md §7 bis.9.1 (lecture 4 et l'ordre composé),
//           §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix offerts),
//           §7 bis.9.4 (validation de forme), §7 bis.9.5 (les refus),
//           §7 bis.9.7 (preuves attendues, niveau unitaire), §3.4 (modèle des arêtes)
// =============================================================================================

function transition(
	partiel: Partial<TransitionAdministrable> & { id: string; from_step_id: string; to_step_id: string },
): TransitionAdministrable {
	return {
		workflow_id: 'w1',
		workspace_id: 'ws1',
		label: null,
		require_comment: false,
		...partiel,
	}
}

describe('la lecture des arêtes (§7 bis.9.1)', () => {
	it('les arêtes sont filtrées par workflow et ordonnées de façon stable', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireTransitions(client, 'w1')
		expect(appel.table).toBe('workflow_transitions')
		expect(appel.colonnes).toBe(COLONNES_TRANSITION_ADMIN)
		expect(appel.filtres).toEqual([['workflow_id', 'w1']])
		// L'ordre demandé est celui des identifiants : la table ne porte pas la position des
		// étapes, et l'ordre du graphe est composé par `grouperTransitions`.
		expect(appel.tris).toEqual([
			['from_step_id', undefined],
			['to_step_id', undefined],
		])
	})

	it('une erreur de lecture est classée, jamais levée', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		const etat = await lireTransitions(client, 'w1')
		expect(etat.statut).toBe('erreur')
	})
})

describe('le groupement des arêtes par départ (§7 bis.9.1)', () => {
	const e1 = etape({ id: 'e1', node_id: 'n1', position: 1 })
	const e2 = etape({ id: 'e2', node_id: 'n2', position: 2 })
	const e3 = etape({ id: 'e3', node_id: 'n3', position: 3 })

	it('suit l’ordre des étapes, pas celui des arêtes reçues', () => {
		const groupes = grouperTransitions(
			[e1, e2, e3],
			[transition({ id: 't1', from_step_id: 'e3', to_step_id: 'e1' })],
		)
		expect(groupes.map((groupe) => groupe.etape.id)).toEqual(['e1', 'e2', 'e3'])
	})

	// Le §3.9 en livre deux, et un graphe qui masquerait ses culs-de-sac cacherait précisément ce
	// qu'un administrateur cherche.
	it('une étape sans sortie garde son groupe, vide', () => {
		const groupes = grouperTransitions([e1, e2], [])
		expect(groupes.map((groupe) => groupe.sorties.length)).toEqual([0, 0])
	})

	it('les sorties d’une étape suivent l’ordre du graphe de leur arrivée', () => {
		const groupes = grouperTransitions(
			[e1, e2, e3],
			[
				transition({ id: 'vers-e3', from_step_id: 'e1', to_step_id: 'e3' }),
				transition({ id: 'vers-e2', from_step_id: 'e1', to_step_id: 'e2' }),
			],
		)
		expect(groupes[0]?.sorties.map((sortie) => sortie.id)).toEqual(['vers-e2', 'vers-e3'])
	})

	// Une étape retirée par un autre administrateur entre les deux lectures : la base a déjà
	// supprimé l'arête en cascade, l'écran ne montre pas un fantôme jusqu'au rechargement.
	it('une arête dont le départ a disparu n’est rattachée à personne', () => {
		const groupes = grouperTransitions(
			[e1, e2],
			[transition({ id: 'orpheline', from_step_id: 'disparue', to_step_id: 'e2' })],
		)
		expect(groupes.flatMap((groupe) => groupe.sorties)).toEqual([])
	})
})

describe('les arrivées déclarables (§7 bis.9.3)', () => {
	const e1 = etape({ id: 'e1', node_id: 'n1', position: 1 })
	const e2 = etape({ id: 'e2', node_id: 'n2', position: 2 })
	const e3 = etape({ id: 'e3', node_id: 'n3', position: 3 })

	it('retire le départ lui-même, que le `CHECK` refuserait', () => {
		const possibles = arriveesPossibles([e1, e2, e3], [], 'e1')
		expect(possibles.map((etape) => etape.id)).toEqual(['e2', 'e3'])
	})

	it('retire les arrivées déjà déclarées depuis ce départ, que l’unicité refuserait', () => {
		const possibles = arriveesPossibles(
			[e1, e2, e3],
			[transition({ id: 't1', from_step_id: 'e1', to_step_id: 'e2' })],
			'e1',
		)
		expect(possibles.map((etape) => etape.id)).toEqual(['e3'])
	})

	// L'unicité porte sur le TRIPLET : une arête `e2 → e3` ne retire pas `e3` des arrivées de `e1`.
	it('ne retire pas une arrivée déclarée depuis une AUTRE étape', () => {
		const possibles = arriveesPossibles(
			[e1, e2, e3],
			[transition({ id: 't1', from_step_id: 'e2', to_step_id: 'e3' })],
			'e1',
		)
		expect(possibles.map((etape) => etape.id)).toEqual(['e2', 'e3'])
	})

	it('rend une liste vide lorsque toutes les arrivées sont déclarées', () => {
		const possibles = arriveesPossibles(
			[e1, e2],
			[transition({ id: 't1', from_step_id: 'e1', to_step_id: 'e2' })],
			'e1',
		)
		expect(possibles).toEqual([])
	})
})

describe('la validation de forme d’une arête (§7 bis.9.4)', () => {
	it('un libellé fourni blanc est refusé', () => {
		expect(libelleTransitionConforme('   ')).toBe(false)
		expect(libelleTransitionConforme('')).toBe(false)
	})

	it('un libellé fourni non blanc est accepté', () => {
		expect(libelleTransitionConforme('Qualifier')).toBe(true)
	})
})

describe('la classification des refus d’arête (§7 bis.9.5)', () => {
	it('`23505` est l’arête déjà déclarée, jamais un slug pris', () => {
		expect(classerRefusTransition(409, '23505', 'duplicate key').nature).toBe('arete-deja-declaree')
	})

	// Rien ne retient une arête : aucune colonne de `cards` ne désigne une transition, donc aucun
	// retrait ne peut être refusé pour occupation — contrairement au `23503` d'une étape.
	it('`23503` est toujours une extrémité absente, jamais une arête « occupée »', () => {
		expect(classerRefusTransition(409, '23503', 'is not present in table').nature).toBe(
			'reference-absente',
		)
	})

	it('les deux `CHECK` du §3.4 rendent le même `forme-refusee`', () => {
		expect(classerRefusTransition(400, '23514', 'workflow_transitions_distinct_check').nature).toBe(
			'forme-refusee',
		)
		expect(classerRefusTransition(400, '23514', 'workflow_transitions_label_check').nature).toBe(
			'forme-refusee',
		)
	})

	it('le refus de la politique et l’absence de réseau restent distincts', () => {
		expect(classerRefusTransition(403, undefined, 'denied').nature).toBe('forbidden')
		expect(classerRefusTransition(undefined, undefined, 'offline').nature).toBe('network')
		expect(classerRefusTransition(500, undefined, 'boom').nature).toBe('unknown')
	})
})

describe('les trois écritures d’arête (§7 bis.9.2)', () => {
	it('la déclaration envoie les deux extrémités, le libellé et le motif exigé', async () => {
		const { client, appels } = espionEcritures([OK])
		const resultat = await declarerTransition(client, {
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			idDepart: 'e1',
			idArrivee: 'e2',
			libelle: 'Qualifier',
			motifExige: true,
		})
		expect(resultat.statut).toBe('applique')
		expect(appels[0]?.table).toBe('workflow_transitions')
		expect(appels[0]?.verbe).toBe('insert')
		expect(appels[0]?.charge).toEqual({
			workflow_id: 'w1',
			workspace_id: 'ws1',
			from_step_id: 'e1',
			to_step_id: 'e2',
			label: 'Qualifier',
			require_comment: true,
		})
		// Sans `select()`, « zéro ligne touchée » serait indistinguable d'un succès.
		expect(appels[0]?.colonnesRendues).toBe('id')
	})

	// `''` heurterait le `CHECK` du §3.4 ; omettre la clé rendrait le retrait impossible.
	it('un libellé absent est envoyé à `null`, pas omis ni vidé en chaîne', async () => {
		const { client, appels } = espionEcritures([OK])
		await declarerTransition(client, {
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			idDepart: 'e1',
			idArrivee: 'e2',
			libelle: null,
			motifExige: false,
		})
		expect(appels[0]?.charge).toHaveProperty('label', null)
	})

	it('la modification n’écrit que le libellé et le motif, jamais une extrémité', async () => {
		const { client, appels } = espionEcritures([OK])
		await modifierTransition(client, 't1', null, true)
		expect(appels[0]?.verbe).toBe('update')
		expect(appels[0]?.charge).toEqual({ label: null, require_comment: true })
		expect(appels[0]?.filtres).toEqual([['id', 't1']])
	})

	it('le retrait supprime sur l’identifiant de l’arête', async () => {
		const { client, appels } = espionEcritures([OK])
		expect((await retirerTransition(client, 't1')).statut).toBe('applique')
		expect(appels[0]?.verbe).toBe('delete')
		expect(appels[0]?.filtres).toEqual([['id', 't1']])
	})

	it('une déclaration refusée par l’unicité est traduite, pas levée', async () => {
		const { client } = espionEcritures([
			{ data: null, error: { message: 'duplicate key value', code: '23505' }, status: 409 },
		])
		const resultat = await declarerTransition(client, {
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			idDepart: 'e1',
			idArrivee: 'e2',
			libelle: null,
			motifExige: false,
		})
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'arete-deja-declaree', detail: 'duplicate key value' },
		})
	})

	it('rend `sans-effet` sur `200` et zéro ligne, ici aussi', async () => {
		const { client } = espionEcritures([ZERO_LIGNE])
		expect((await modifierTransition(client, 't1', 'Perdre', false)).statut).toBe('sans-effet')
	})
})
