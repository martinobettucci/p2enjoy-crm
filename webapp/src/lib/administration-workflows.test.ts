// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première, deuxième,
//           troisième, quatrième et cinquième tranches
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
	COLONNES_TRACK_AFFECTABLE,
	COLONNES_TRANSITION_ADMIN,
	creationWorkflowConforme,
	creerWorkflow,
	lireTracksAffectables,
	arriveesPossibles,
	classerRefusTransition,
	declarerTransition,
	grouperTransitions,
	libelleTransitionConforme,
	lireTransitions,
	modifierTransition,
	retirerTransition,
	COLONNES_CHAMP_ADMIN,
	archiverChamp,
	aideChampConforme,
	choixDuChamp,
	classerRefusChamp,
	cleChampConforme,
	composerOptions,
	declarerChamp,
	deplacerChamp,
	deviseConforme,
	deviseDuChamp,
	libelleChampConforme,
	lireChamps,
	modifierChamp,
	refusDesChoix,
	COLONNES_REGLE_ADMIN,
	classerRefusRegle,
	composerGrille,
	lireRegles,
	reglerVisibilite,
	rendreAuDefaut,
	COLONNES_EXIGENCE_ADMIN,
	champsLiables,
	classerRefusExigence,
	exigencesEffectives,
	exigencesSansEffet,
	exigerChamp,
	lireExigences,
	retirerExigence,
	type ChampAdministrable,
	type EtapeAdministrable,
	type NoeudAjoutable,
	type ExigenceAdministrable,
	type RegleAdministrable,
	type TransitionAdministrable,
	previsualiserExigence,
	composerMessageEffets,
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
	verbe?: 'insert' | 'update' | 'delete' | 'upsert'
	charge?: Record<string, unknown>
	/** Les options d'un `upsert` — `onConflict` en porte le couple d'unicité (§7 bis.11.3). */
	options?: Record<string, unknown>
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
				upsert: (charge: Record<string, unknown>, options?: Record<string, unknown>) => {
					appel.verbe = 'upsert'
					appel.charge = charge
					appel.options = options
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

// =============================================================================================
// TROISIÈME TRANCHE — les champs du formulaire
// @verifies docs/SPEC-workflow-engine.md §7 bis.10 (l'édition des champs), §7 bis.10.1 (lecture 5
//           et les champs archivés rapportés), §7 bis.10.2 (les cinq gestes), §7 bis.10.3 (clé et
//           type non modifiables), §7 bis.10.4 (validation de forme, dont l'unicité des clés de
//           choix que la base n'assure pas), §7 bis.10.5 (les refus), §7 bis.10.8 (preuves)
// @verifies docs/SPEC-form-composer.md §2.2 (modèle), §2.3 (types), §2.4 (options), §2.6 (ordre)
// =============================================================================================

function champ(partiel: Partial<ChampAdministrable> & { id: string; key: string }): ChampAdministrable {
	return {
		workflow_id: 'w1',
		workspace_id: 'ws1',
		label: 'Un champ',
		type: 'text',
		options: {},
		help_text: null,
		position: 1,
		archived_at: null,
		...partiel,
	}
}

describe('la lecture des champs (§7 bis.10.1)', () => {
	it('demande les champs d’un workflow dans l’ordre des positions', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireChamps(client, 'w1')
		expect(appel.table).toBe('form_fields')
		expect(appel.colonnes).toBe(COLONNES_CHAMP_ADMIN)
		expect(appel.filtres).toEqual([['workflow_id', 'w1']])
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['position'])
	})

	it('N’EXCLUT PAS les champs archivés, à la différence du catalogue', async () => {
		// Le contraste est la preuve : `lireCatalogueActif` pose `archived_at is null` côté serveur,
		// cette lecture-ci ne le pose pas. Un champ archivé est le seul « retiré » que le produit
		// connaisse — `DELETE` rend `403`/`42501` —, et le masquer rendrait la restauration
		// inatteignable (§7 bis.10.1).
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireChamps(client, 'w1')
		expect(appel.filtres.map(([colonne]) => colonne)).not.toContain('archived_at')
	})

	it('rend les champs archivés tels que la base les sert', async () => {
		const archive = champ({ id: 'c7', key: 'budget-previsionnel', archived_at: '2026-03-15T09:00:00Z' })
		const { client } = espionLecture({ data: [archive], error: null, status: 200 })
		const etat = await lireChamps(client, 'w1')
		expect(etat.statut).toBe('pret')
		expect(etat.statut === 'pret' ? etat.donnees.map((ligne) => ligne.key) : []).toEqual([
			'budget-previsionnel',
		])
	})

	it('classe une erreur de lecture plutôt que de la lever', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'coupure' }, status: 0 })
		expect((await lireChamps(client, 'w1')).statut).toBe('erreur')
	})
})

describe('les options d’un champ (§2.4)', () => {
	it('lit les choix d’un `select`, et écarte les entrées sans clé', () => {
		const avecChoix = champ({
			id: 'c2',
			key: 'source',
			type: 'select',
			options: {
				choices: [
					{ key: 'salon', label: 'Salon' },
					{ label: 'Sans clé' },
					{ key: '   ', label: 'Clé blanche' },
					{ key: 'site', label: 'Site web' },
				],
			},
		})
		expect(choixDuChamp(avecChoix)).toEqual([
			{ key: 'salon', label: 'Salon' },
			{ key: 'site', label: 'Site web' },
		])
	})

	it('replie le libellé manquant sur la clé plutôt que de rendre une entrée à moitié', () => {
		const partiel = champ({ id: 'c2', key: 'source', type: 'select', options: { choices: [{ key: 'salon' }] } })
		expect(choixDuChamp(partiel)).toEqual([{ key: 'salon', label: 'salon' }])
	})

	it('rend une liste vide si `options` n’est pas un objet, ou ne porte pas de tableau', () => {
		expect(choixDuChamp(champ({ id: 'c1', key: 'a', options: null }))).toEqual([])
		expect(choixDuChamp(champ({ id: 'c1', key: 'a', options: [1, 2] }))).toEqual([])
		expect(choixDuChamp(champ({ id: 'c1', key: 'a', options: { choices: 'salon' } }))).toEqual([])
	})

	it('lit la devise d’un champ `money`, et rend la chaîne vide si elle manque', () => {
		expect(deviseDuChamp(champ({ id: 'c1', key: 'budget', type: 'money', options: { currency: 'EUR' } }))).toBe(
			'EUR',
		)
		expect(deviseDuChamp(champ({ id: 'c1', key: 'budget', type: 'money', options: {} }))).toBe('')
	})

	it('compose `options` selon le type, et n’y laisse rien d’étranger', () => {
		expect(composerOptions('select', [{ key: ' salon ', label: ' Salon ' }], 'EUR')).toEqual({
			choices: [{ key: 'salon', label: 'Salon' }],
		})
		expect(composerOptions('money', [{ key: 'salon', label: 'Salon' }], ' eur ')).toEqual({
			currency: 'EUR',
		})
		// Un type sans exigence reçoit `{}` — envoyé, jamais omis : un `PATCH` qui omettrait la clé
		// laisserait en place les `choices` d'une écriture antérieure.
		expect(composerOptions('text', [{ key: 'salon', label: 'Salon' }], 'EUR')).toEqual({})
	})
})

describe('la validation de forme des champs (§7 bis.10.4)', () => {
	it('accepte une clé conforme et refuse les formes que `form_fields_key_check` refuse', () => {
		expect(cleChampConforme('budget')).toBe(true)
		expect(cleChampConforme('date-signature-prevue')).toBe(true)
		expect(cleChampConforme('Budget')).toBe(false)
		expect(cleChampConforme('budget_prev')).toBe(false)
		expect(cleChampConforme('budget--prev')).toBe(false)
		expect(cleChampConforme('-budget')).toBe(false)
		expect(cleChampConforme('budget-')).toBe(false)
		expect(cleChampConforme('')).toBe(false)
	})

	it('refuse un libellé blanc, et une aide blanche fournie — mais accepte l’aide absente', () => {
		expect(libelleChampConforme('Budget estimé')).toBe(true)
		expect(libelleChampConforme('   ')).toBe(false)
		expect(aideChampConforme('')).toBe(true)
		expect(aideChampConforme('Montant hors taxes.')).toBe(true)
		expect(aideChampConforme('   ')).toBe(false)
	})

	it('exige trois majuscules pour la devise, en normalisant la casse et les espaces', () => {
		expect(deviseConforme('EUR')).toBe(true)
		expect(deviseConforme(' eur ')).toBe(true)
		expect(deviseConforme('EU')).toBe(false)
		expect(deviseConforme('EURO')).toBe(false)
		expect(deviseConforme('')).toBe(false)
	})

	it('TIENT L’UNICITÉ DES CLÉS DE CHOIX, QUE LA BASE N’ASSURE PAS', () => {
		// MESURÉ le 2026-08-14 : un `select` portant deux choix de clé `a` est accepté en `201` par
		// la base — un `CHECK` ne déplie pas un tableau `jsonb` (§2.4). Ce contrôle est donc la seule
		// garantie du produit, et non un aller-retour économisé.
		expect(refusDesChoix([{ key: 'a', label: 'A' }, { key: 'a', label: 'Autre A' }])).toBe('cle-dupliquee')
	})

	it('refuse une liste vide, une clé blanche et un libellé blanc, et accepte une liste conforme', () => {
		expect(refusDesChoix([])).toBe('aucun-choix')
		expect(refusDesChoix([{ key: '  ', label: 'A' }])).toBe('cle-vide')
		expect(refusDesChoix([{ key: 'a', label: '  ' }])).toBe('libelle-vide')
		expect(refusDesChoix([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }])).toBe(null)
	})
})

describe('les écritures sur un champ (§7 bis.10.2)', () => {
	it('OMET `position` à la déclaration : le trigger la calcule en fin de formulaire', async () => {
		const { client, appels } = espionEcritures([OK])
		await declarerChamp(client, {
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			cle: 'delai-reponse',
			libelle: 'Délai de réponse',
			type: 'number',
			aide: null,
			options: {},
		})
		expect(appels[0]?.table).toBe('form_fields')
		expect(appels[0]?.verbe).toBe('insert')
		expect(appels[0]?.charge).toEqual({
			workflow_id: 'w1',
			workspace_id: 'ws1',
			key: 'delai-reponse',
			label: 'Délai de réponse',
			type: 'number',
			help_text: null,
			options: {},
		})
		expect(Object.keys(appels[0]?.charge ?? {})).not.toContain('position')
	})

	it('la modification n’écrit NI la clé NI le type', async () => {
		// §7 bis.10.3 : la base accepte de modifier les deux — mesuré `200` —, et l'écran ne le fait
		// pas. La clé est l'identifiant durable des exports ; le type laisserait en base des valeurs
		// que le produit refuse ensuite de réécrire.
		const { client, appels } = espionEcritures([OK])
		await modifierChamp(client, 'c1', 'Budget estimé', 'Montant HT.', { currency: 'EUR' })
		expect(appels[0]?.verbe).toBe('update')
		expect(appels[0]?.charge).toEqual({
			label: 'Budget estimé',
			help_text: 'Montant HT.',
			options: { currency: 'EUR' },
		})
		expect(Object.keys(appels[0]?.charge ?? {})).not.toContain('key')
		expect(Object.keys(appels[0]?.charge ?? {})).not.toContain('type')
		expect(appels[0]?.filtres).toEqual([['id', 'c1']])
	})

	it('l’aide vidée est envoyée à `null`, jamais omise', async () => {
		const { client, appels } = espionEcritures([OK])
		await modifierChamp(client, 'c1', 'Budget estimé', null, {})
		expect(appels[0]?.charge).toEqual({ label: 'Budget estimé', help_text: null, options: {} })
	})

	it('le déplacement n’écrit que la position calculée', async () => {
		const { client, appels } = espionEcritures([OK])
		await deplacerChamp(client, 'c1', 2.5)
		expect(appels[0]?.charge).toEqual({ position: 2.5 })
		expect(appels[0]?.filtres).toEqual([['id', 'c1']])
	})

	it('l’archivage écrit un instant, la restauration écrit `null` — même écriture', async () => {
		const { client, appels } = espionEcritures([OK, OK])
		await archiverChamp(client, 'c1', '2026-08-14T10:00:00.000Z')
		await archiverChamp(client, 'c1', null)
		expect(appels[0]?.charge).toEqual({ archived_at: '2026-08-14T10:00:00.000Z' })
		expect(appels[1]?.charge).toEqual({ archived_at: null })
		// Aucun `delete` n'est jamais émis : le privilège n'existe pas (§2.7, mesuré `403`/`42501`).
		expect(appels.map((appel) => appel.verbe)).toEqual(['update', 'update'])
	})
})

describe('les refus d’écriture d’un champ (§7 bis.10.5)', () => {
	it('traduit `23505` en clé déjà prise dans ce workflow', () => {
		expect(classerRefusChamp(409, '23505', 'duplicate key value')).toEqual({
			nature: 'cle-deja-prise',
			detail: 'duplicate key value',
		})
	})

	it('traduit les six `CHECK` en une seule nature de forme', () => {
		for (const message of [
			'violates check constraint "form_fields_key_check"',
			'violates check constraint "form_fields_label_check"',
			'violates check constraint "form_fields_help_text_check"',
			'violates check constraint "form_fields_type_check"',
			'violates check constraint "form_fields_options_objet_check"',
			'violates check constraint "form_fields_choices_check"',
		]) {
			expect(classerRefusChamp(400, '23514', message).nature).toBe('forme-refusee')
		}
	})

	it('traduit `42501` en refus d’autorisation, et `23503` en référence absente', () => {
		expect(classerRefusChamp(403, '42501', 'permission denied').nature).toBe('forbidden')
		expect(classerRefusChamp(409, '23503', 'foreign key').nature).toBe('reference-absente')
	})

	it('rend `sans-effet` sur `200` et zéro ligne — le `USING` d’un non-administrateur', async () => {
		// MESURÉ : `PATCH /form_fields` avec le jeton du `business_developer` rend `200` et `[]`.
		const { client } = espionEcritures([ZERO_LIGNE])
		expect((await modifierChamp(client, 'c1', 'Tentative', null, {})).statut).toBe('sans-effet')
	})

	it('classe une coupure réseau plutôt que de lever', async () => {
		const client = {
			from: () => ({
				update: () => ({
					eq: () => ({
						select: () => {
							throw new Error('coupure')
						},
					}),
				}),
			}),
		} as unknown as ClientCrm
		const resultat = await archiverChamp(client, 'c1', null)
		expect(resultat.statut).toBe('refus')
	})
})

// =============================================================================================
// QUATRIÈME TRANCHE — la grille champ × étape des règles de visibilité
// @verifies docs/SPEC-workflow-engine.md §7 bis.11.1 (lecture 6), §7 bis.11.2 (la composition),
//           §7 bis.11.3 (les deux gestes et l'`upsert`), §7 bis.11.4 (les quatre états),
//           §7 bis.11.5 (les refus), §7 bis.11.8 (preuves attendues)
// @verifies docs/SPEC-form-composer.md §3.1 (l'absence de règle vaut `visible`), §3.2 (la clé
//           primaire `(field_id, step_id)`), §5 (un champ archivé n'est dans aucun formulaire)
// =============================================================================================

function regle(idChamp: string, idEtape: string, visibilite: string): RegleAdministrable {
	return { field_id: idChamp, step_id: idEtape, visibility: visibilite }
}

describe('la lecture des règles de visibilité (§7 bis.11.1)', () => {
	it('demande les règles d’un workflow, ordonnées par identifiants', async () => {
		// L'ordre des identifiants est assumé : la table ne porte ni la position d'un champ ni celle
		// d'une étape (§7 bis.11.1). La grille n'est jamais parcourue dans cet ordre — elle est
		// indexée par le couple —, mais un ordre stable évite deux réponses différentes.
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireRegles(client, 'w1')
		expect(appel.table).toBe('form_field_rules')
		expect(appel.colonnes).toBe(COLONNES_REGLE_ADMIN)
		expect(appel.filtres).toEqual([['workflow_id', 'w1']])
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['field_id', 'step_id'])
	})

	it('rend une erreur classée plutôt que de lever', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await lireRegles(client, 'w1')).statut).toBe('erreur')
	})
})

describe('la composition de la grille (§7 bis.11.2)', () => {
	const c1 = champ({ id: 'c1', key: 'budget', position: 1 })
	const c2 = champ({ id: 'c2', key: 'source', position: 2 })
	const e1 = etape({ id: 'e1', node_id: 'n1', position: 1 })
	const e2 = etape({ id: 'e2', node_id: 'n2', position: 2 })

	it('NE PART PAS DES RÈGLES : toute case sans règle vaut le défaut', () => {
		// MESURÉ sur le seed le 2026-08-15 : quinze règles pour six champs actifs × sept étapes, soit
		// vingt-sept couples sans règle. Une composition partant des règles perdrait les deux tiers
		// de la grille (§3.1 du composeur, §7 bis.11.2).
		const grille = composerGrille([c1, c2], [e1, e2], [regle('c1', 'e2', 'required')])
		expect(grille.map((ligne) => ligne.cases.map((cellule) => cellule.etat))).toEqual([
			['defaut', 'required'],
			['defaut', 'defaut'],
		])
	})

	it('rend une case par étape, dans l’ordre du graphe, et une ligne par champ, dans l’ordre des positions', () => {
		const grille = composerGrille([c1, c2], [e1, e2], [])
		expect(grille.map((ligne) => ligne.champ.id)).toEqual(['c1', 'c2'])
		expect(grille[0]?.cases.map((cellule) => cellule.etape.id)).toEqual(['e1', 'e2'])
	})

	it('porte les trois visibilités telles quelles, `visible` explicite compris', () => {
		// Le §7 bis.11.4 : `visible` n'est PAS replié sur le défaut. Le seed en pose deux, et les
		// afficher comme des absences les ferait supprimer au premier réglage voisin.
		const grille = composerGrille(
			[c1],
			[e1, e2],
			[regle('c1', 'e1', 'visible'), regle('c1', 'e2', 'hidden')],
		)
		expect(grille[0]?.cases.map((cellule) => cellule.etat)).toEqual(['visible', 'hidden'])
	})

	it('ÉCARTE LES CHAMPS ARCHIVÉS DES LIGNES, sans toucher à leurs règles', () => {
		// La liste des champs les rapporte pour permettre la restauration (§7 bis.10.1) ; la grille
		// les écarte parce qu'un champ archivé n'apparaît dans aucun formulaire (§5 du composeur).
		// MESURÉ : la base accepte pourtant une règle sur un champ archivé — `201`.
		const archive = champ({ id: 'c3', key: 'budget-previsionnel', archived_at: '2026-08-01T00:00:00Z' })
		const grille = composerGrille([c1, archive], [e1], [regle('c3', 'e1', 'required')])
		expect(grille.map((ligne) => ligne.champ.id)).toEqual(['c1'])
	})

	it('ignore une règle orpheline plutôt que de fabriquer une case', () => {
		// Son champ ou son étape a disparu entre deux lectures ; la base l'a déjà emportée en cascade
		// (§3.3 du composeur), et aucune case ne peut l'accueillir.
		const grille = composerGrille([c1], [e1], [regle('disparu', 'e1', 'hidden'), regle('c1', 'disparue', 'hidden')])
		expect(grille[0]?.cases.map((cellule) => cellule.etat)).toEqual(['defaut'])
	})

	it('rend une grille vide sans champ actif, et des lignes sans case sans étape', () => {
		expect(composerGrille([], [e1], [])).toEqual([])
		expect(composerGrille([c1], [], [])[0]?.cases).toEqual([])
	})
})

describe('les deux écritures d’une case (§7 bis.11.3)', () => {
	it('RÈGLE PAR UN `upsert`, jamais par un choix entre insertion et modification', async () => {
		// MESURÉ le 2026-08-15 : `POST` d'un couple absent rend `201` ; le même `POST` avec
		// `resolution=merge-duplicates` rend `200` sur un couple existant ; SANS cette résolution il
		// rend `409` / `23505` sur `form_field_rules_pkey`. Un écran qui choisirait d'après ce qu'il a
		// lu prendrait ce `409` dès qu'un autre administrateur a réglé la même case entre-temps.
		const { client, appels } = espionEcritures([OK])
		await reglerVisibilite(client, {
			idChamp: 'c1',
			idEtape: 'e1',
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			visibilite: 'required',
		})
		expect(appels[0]?.table).toBe('form_field_rules')
		expect(appels[0]?.verbe).toBe('upsert')
		expect(appels[0]?.charge).toEqual({
			field_id: 'c1',
			step_id: 'e1',
			workflow_id: 'w1',
			workspace_id: 'ws1',
			visibility: 'required',
		})
		expect(appels[0]?.options).toEqual({ onConflict: 'field_id,step_id' })
	})

	it('rend au défaut par un `DELETE` sur le couple, et par rien d’autre', async () => {
		// C'est le SEUL `delete` de cet éditeur de formulaire : un champ ne se supprime pas (§2.7 du
		// composeur, `403`/`42501` mesuré), une règle si (décision 96).
		const { client, appels } = espionEcritures([OK])
		await rendreAuDefaut(client, 'c1', 'e1')
		expect(appels[0]?.table).toBe('form_field_rules')
		expect(appels[0]?.verbe).toBe('delete')
		expect(appels[0]?.filtres).toEqual([
			['field_id', 'c1'],
			['step_id', 'e1'],
		])
	})

	it('les deux écritures demandent des lignes en retour, pour que `sans-effet` existe', async () => {
		const { client, appels } = espionEcritures([OK, OK])
		await reglerVisibilite(client, {
			idChamp: 'c1',
			idEtape: 'e1',
			idWorkflow: 'w1',
			idWorkspace: 'ws1',
			visibilite: 'hidden',
		})
		await rendreAuDefaut(client, 'c1', 'e1')
		expect(appels.map((appel) => appel.colonnesRendues)).toEqual(['field_id', 'field_id'])
	})
})

describe('les refus d’écriture d’une règle (§7 bis.11.5)', () => {
	it('traduit le `CHECK` de visibilité en refus de forme', () => {
		// MESURÉ : `PATCH {"visibility":"peut-etre"}` rend `400` / `23514`,
		// `form_field_rules_visibility_check`. C'est la seule cause possible de ce code ici.
		expect(
			classerRefusRegle(400, '23514', 'violates check constraint "form_field_rules_visibility_check"')
				.nature,
		).toBe('forme-refusee')
	})

	it('traduit `23503` en référence absente, et `42501` en refus d’autorisation', () => {
		// MESURÉ : un couple croisant deux workflows rend `409` / `23503` sur
		// `form_field_rules_step_id_workflow_id_fkey` ; le `business_developer` reçoit `403`/`42501`.
		expect(classerRefusRegle(409, '23503', 'form_field_rules_step_id_workflow_id_fkey').nature).toBe(
			'reference-absente',
		)
		expect(classerRefusRegle(403, '42501', 'row-level security policy').nature).toBe('forbidden')
	})

	it('NE DONNE PAS DE NATURE MÉTIER À `23505`, que l’écran ne peut pas provoquer', () => {
		// L'`upsert` du §7 bis.11.3 le rend inatteignable ; lui donner un message ferait croire à une
		// règle de plus. Son détail reste lisible.
		expect(classerRefusRegle(409, '23505', 'form_field_rules_pkey')).toEqual({
			nature: 'unknown',
			detail: 'form_field_rules_pkey',
		})
	})

	it('rend `sans-effet` sur `200` et zéro ligne, en réglage COMME en retour au défaut', async () => {
		// MESURÉ avec le jeton réel du `business_developer` : `200` et `[]` en `PATCH` comme en
		// `DELETE`, la règle seedée restant intacte. C'est le cas le plus fréquent, pas un cas limite.
		const { client } = espionEcritures([ZERO_LIGNE, ZERO_LIGNE])
		expect(
			(
				await reglerVisibilite(client, {
					idChamp: 'c1',
					idEtape: 'e1',
					idWorkflow: 'w1',
					idWorkspace: 'ws1',
					visibilite: 'hidden',
				})
			).statut,
		).toBe('sans-effet')
		expect((await rendreAuDefaut(client, 'c1', 'e1')).statut).toBe('sans-effet')
	})

	it('classe une coupure réseau plutôt que de lever', async () => {
		const client = {
			from: () => ({
				delete: () => ({
					eq: () => ({
						eq: () => ({
							select: () => {
								throw new Error('coupure')
							},
						}),
					}),
				}),
			}),
		} as unknown as ClientCrm
		expect((await rendreAuDefaut(client, 'c1', 'e1')).statut).toBe('refus')
	})
})

// =============================================================================================
// CINQUIÈME TRANCHE — les exigences propres à une transition
// @verifies CRM-076 (docs/BACKLOG.md) — cinquième tranche
// @verifies docs/SPEC-workflow-engine.md §7 bis.12.1 (lecture 7 et sa jointure interne),
//           §7 bis.12.2 (l'union des exigences effectives et leurs origines),
//           §7 bis.12.3 (les deux gestes, et pourquoi le premier n'est PAS un `upsert`),
//           §7 bis.12.4 (ce que l'écran refuse de proposer), §7 bis.12.5 (les refus),
//           §7 bis.12.8 (preuves attendues)
// @verifies docs/SPEC-transition-required-fields.md §1 (l'union des deux ensembles),
//           §2 (la table à deux colonnes, aucune valeur mutable), §5.1 (la sixième garde)
// =============================================================================================

function exigence(idTransition: string, idChamp: string): ExigenceAdministrable {
	return { transition_id: idTransition, field_id: idChamp }
}

describe('la lecture des exigences de transition (§7 bis.12.1)', () => {
	it('filtre par le workflow À TRAVERS une jointure interne, faute de colonne locale', async () => {
		// La table n'a que deux colonnes (`docs/SPEC-transition-required-fields.md` §2) : aucun
		// `workflow_id` n'y est dénormalisé. MESURÉ le 2026-08-15 : sans ce filtre, la lecture rend
		// les DEUX liaisons du seed — la globale et la dérivée —, donc l'écran d'un workflow
		// afficherait les exigences d'un autre.
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireExigences(client, 'w1')
		expect(appel.table).toBe('workflow_transition_required_fields')
		expect(appel.colonnes).toContain(COLONNES_EXIGENCE_ADMIN)
		expect(appel.colonnes).toContain('workflow_transitions!inner')
		expect(appel.filtres).toEqual([['transition.workflow_id', 'w1']])
		expect(appel.tris).toEqual([
			['transition_id', undefined],
			['field_id', undefined],
		])
	})

	it('écarte la jointure du résultat : elle sert à filtrer, pas à être rendue', async () => {
		const { client } = espionLecture({
			data: [{ transition_id: 't1', field_id: 'c1', transition: { workflow_id: 'w1' } }],
			error: null,
			status: 200,
		})
		const lues = await lireExigences(client, 'w1')
		expect(lues.statut).toBe('pret')
		if (lues.statut !== 'pret') return
		expect(lues.donnees).toEqual([{ transition_id: 't1', field_id: 'c1' }])
	})

	it('rend une erreur classée plutôt que de lever', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boum' }, status: 500 })
		expect((await lireExigences(client, 'w1')).statut).toBe('erreur')
	})
})

describe('les exigences EFFECTIVES d’une arête (§7 bis.12.2)', () => {
	const budget = champ({ id: 'c1', key: 'budget', label: 'Budget', position: 1 })
	const source = champ({ id: 'c2', key: 'source', label: 'Origine', position: 2 })
	const lien = champ({ id: 'c3', key: 'lien', label: 'Lien', position: 3 })
	const archive = champ({ id: 'c4', key: 'vieux', label: 'Ancien', position: 4, archived_at: '2026-01-01' })
	const arete = transition({ id: 't1', from_step_id: 'e1', to_step_id: 'e2' })

	it('réunit les DEUX ensembles de la sixième garde, pas la seule table de liaison', () => {
		// `move_card` exige l'union des champs `required` à l'étape d'ARRIVÉE et des champs liés à
		// la transition (`docs/SPEC-transition-required-fields.md` §1 et §5.1). N'afficher que la
		// table écrirait « aucune exigence » là où la règle en impose déjà.
		const effectives = exigencesEffectives(
			arete,
			[budget, source, lien],
			[regle('c1', 'e2', 'required')],
			[exigence('t1', 'c3')],
		)
		expect(effectives.map((item) => [item.champ.id, item.origine])).toEqual([
			['c1', 'regle'],
			['c3', 'transition'],
		])
	})

	it('nomme `les-deux` le champ que la règle ET la liaison exigent', () => {
		const effectives = exigencesEffectives(
			arete,
			[budget],
			[regle('c1', 'e2', 'required')],
			[exigence('t1', 'c1')],
		)
		expect(effectives).toEqual([{ champ: budget, origine: 'les-deux' }])
	})

	it('ne lit la règle qu’à l’étape d’ARRIVÉE, jamais à celle de départ', () => {
		// Une règle `required` au départ n'exige rien pour franchir l'arête : la garde interroge
		// `r.step_id = v_cible`. Confondre les deux exigerait un champ que la base n'exige pas.
		expect(exigencesEffectives(arete, [budget], [regle('c1', 'e1', 'required')], [])).toEqual([])
	})

	it('ignore les visibilités qui n’exigent rien', () => {
		expect(
			exigencesEffectives(arete, [budget, source], [regle('c1', 'e2', 'hidden'), regle('c2', 'e2', 'visible')], []),
		).toEqual([])
	})

	it('ignore la liaison d’une AUTRE arête', () => {
		expect(exigencesEffectives(arete, [lien], [], [exigence('t2', 'c3')])).toEqual([])
	})

	it('écarte les champs archivés, comme la garde elle-même', () => {
		// MESURÉ le 2026-08-15 : la base ACCEPTE une liaison vers un champ archivé (`201`), mais
		// `move_card` filtre `f.archived_at is null` : elle ne produit aucun effet.
		expect(
			exigencesEffectives(arete, [archive], [regle('c4', 'e2', 'required')], [exigence('t1', 'c4')]),
		).toEqual([])
	})

	it('rend les exigences dans l’ordre des champs, seul ordre déjà sous les yeux', () => {
		const effectives = exigencesEffectives(
			arete,
			[budget, source, lien],
			[regle('c3', 'e2', 'required')],
			[exigence('t1', 'c2'), exigence('t1', 'c1')],
		)
		expect(effectives.map((item) => item.champ.id)).toEqual(['c1', 'c2', 'c3'])
	})
})

describe('les liaisons SANS EFFET et les champs liables (§7 bis.12.4)', () => {
	const actif = champ({ id: 'c1', key: 'budget', position: 1 })
	const archive = champ({ id: 'c4', key: 'vieux', position: 4, archived_at: '2026-01-01' })
	const arete = transition({ id: 't1', from_step_id: 'e1', to_step_id: 'e2' })

	it('nomme la liaison vers un champ archivé plutôt que de la taire', () => {
		expect(exigencesSansEffet(arete, [actif, archive], [exigence('t1', 'c4')])).toEqual([archive])
	})

	it('ne nomme rien lorsque le champ archivé n’est pas lié à CETTE arête', () => {
		expect(exigencesSansEffet(arete, [actif, archive], [exigence('t2', 'c4')])).toEqual([])
	})

	it('ne propose ni un champ archivé ni un champ déjà lié', () => {
		// Le premier produirait une liaison sans effet, le second serait refusé en `23505` — les
		// deux mesurés. Proposer un choix dont on connaît le refus est une faute d'écran.
		const autre = champ({ id: 'c2', key: 'source', position: 2 })
		expect(champsLiables(arete, [actif, autre, archive], [exigence('t1', 'c1')])).toEqual([autre])
	})

	it('propose encore un champ déjà exigé par la règle de l’étape d’arrivée', () => {
		// La règle peut changer ; la liaison est un engagement propre à ce chemin, et la base
		// accepte les deux. L'écran dit ce que la liaison ajoute plutôt que de trancher.
		expect(champsLiables(arete, [actif], []).map((item) => item.id)).toEqual(['c1'])
	})
})

describe('les deux écritures d’une exigence (§7 bis.12.3)', () => {
	it('exige un champ par un `insert` SIMPLE, sans aucune résolution de conflit', async () => {
		// MESURÉ le 2026-08-15 : `Prefer: resolution=merge-duplicates` rend `403`/`42501` avec
		// l'indice « GRANT UPDATE … », et `PATCH` le même. `CRM-018` n'accorde délibérément que
		// `insert` et `delete` (sa spécification §2 : aucune valeur mutable). L'`upsert` de la
		// quatrième tranche est donc IMPOSSIBLE ici, et l'emprunter produirait un `403`
		// incompréhensible sur le geste le plus courant du bloc.
		const { client, appels } = espionEcritures([OK])
		await exigerChamp(client, 't1', 'c1')
		expect(appels[0]?.table).toBe('workflow_transition_required_fields')
		expect(appels[0]?.verbe).toBe('insert')
		expect(appels[0]?.options).toBeUndefined()
		expect(appels[0]?.charge).toEqual({ transition_id: 't1', field_id: 'c1' })
	})

	it('n’envoie NI `workflow_id` NI `workspace_id` : la table n’en a pas', async () => {
		const { client, appels } = espionEcritures([OK])
		await exigerChamp(client, 't1', 'c1')
		expect(Object.keys(appels[0]?.charge ?? {})).toEqual(['transition_id', 'field_id'])
	})

	it('retire une exigence par le couple complet, jamais par la seule transition', async () => {
		// Filtrer sur la seule transition retirerait TOUTES ses exigences en un clic destiné à une.
		const { client, appels } = espionEcritures([OK])
		await retirerExigence(client, 't1', 'c1')
		expect(appels[0]?.verbe).toBe('delete')
		expect(appels[0]?.filtres).toEqual([
			['transition_id', 't1'],
			['field_id', 'c1'],
		])
		expect(appels[0]?.colonnesRendues).toBe('field_id')
	})

	it('rend `sans-effet` sur `200` et zéro ligne, sans prétendre en connaître la cause', async () => {
		// MESURÉ : `200` et `[]` pour le `business_developer` sur la liaison seedée — relue intacte —
		// ET pour l'administratrice sur un couple inexistant. Les deux sont indiscernables.
		const { client } = espionEcritures([ZERO_LIGNE])
		expect((await retirerExigence(client, 't1', 'c1')).statut).toBe('sans-effet')
	})

	it('classe une coupure réseau plutôt que de lever', async () => {
		const client = {
			from: () => ({
				insert: () => ({
					select: () => {
						throw new Error('coupure')
					},
				}),
			}),
		} as unknown as ClientCrm
		expect((await exigerChamp(client, 't1', 'c1')).statut).toBe('refus')
	})
})

describe('les refus d’écriture d’une exigence (§7 bis.12.5)', () => {
	it('traduit `23505` en « déjà exigé », refus métier lisible et non générique', () => {
		// L'inverse exact du §7 bis.11.5, où ce code ne pouvait pas apparaître : ici l'`upsert` est
		// refusé par la base, donc le `23505` est l'issue NORMALE d'une course entre deux
		// administrateurs, et l'état voulu est déjà celui que la base porte.
		expect(classerRefusExigence(409, '23505', 'duplicate key value')).toEqual({
			nature: 'deja-exige',
			detail: 'duplicate key value',
		})
	})

	it('traduit `23514` en workflows différents — ici son unique cause', () => {
		// La table à deux colonnes ne porte AUCUN `CHECK` de valeur : seuls les trois triggers de
		// cohérence peuvent produire ce code. MESURÉ : `400` / `required_field_workflow_mismatch`.
		expect(classerRefusExigence(400, '23514', 'required_field_workflow_mismatch').nature).toBe(
			'workflow-different',
		)
	})

	it('ne laisse JAMAIS passer « forme refusée » sur une table sans valeur à mettre en forme', () => {
		// Le classement générique cherche le nom `workflow_hors_track`, qui appartient à une autre
		// contrainte : sans ce repli, un `23514` d'un nom inattendu afficherait « la forme est
		// refusée » là où aucune forme n'est en cause.
		expect(classerRefusExigence(400, '23514', 'un nom de contrainte inattendu').nature).toBe(
			'workflow-different',
		)
	})

	it('traduit `23503` en référence absente et `42501` en refus d’autorisation', () => {
		expect(classerRefusExigence(409, '23503', 'foreign key').nature).toBe('reference-absente')
		expect(
			classerRefusExigence(403, '42501', 'new row violates row-level security policy').nature,
		).toBe('forbidden')
	})

	it('classe une coupure réseau sans jamais la confondre avec un refus métier', () => {
		expect(classerRefusExigence(undefined, undefined, 'Failed to fetch').nature).toBe('network')
	})
})

// ---------------------------------------------------------------------------------------------
// La prévisualisation des effets — §7 bis.13
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-076 (docs/BACKLOG.md) — sixième tranche : la prévisualisation des effets
// @verifies docs/SPEC-workflow-engine.md §7 bis.13.3 (contrat de l'appel), §7 bis.13.4 (ce que
//           l'écran en fait, dont « zéro se dit en toutes lettres » et le repli sur échec)
//
// CE QUI EST PROUVÉ ICI EST LA MISE EN FORME, PAS LE COMPTE. Le compte appartient à la base et sa
// justesse est prouvée par `supabase/tests/0034_previsualisation_exigence.test.sql`, contre le vrai
// seed et contre `move_card`. Le doubler ici par un faux client reviendrait à prouver l'arithmétique
// de la doublure.

describe('la prévisualisation des effets (§7 bis.13)', () => {
	/** Doublure minimale : rend ce qu'on lui donne, et retient les paramètres reçus. */
	function clientPrevisualisation(
		reponse: { data: unknown; error: unknown; status?: number },
		recu?: { params?: Record<string, unknown>; nom?: string },
	): ClientCrm {
		return {
			rpc: (nom: string, params: Record<string, unknown>) => {
				if (recu !== undefined) {
					recu.nom = nom
					recu.params = params
				}
				return Promise.resolve(reponse)
			},
		} as unknown as ClientCrm
	}

	it('appelle `previsualiser_exigence` avec la SEULE cible fournie — une étape', async () => {
		// §7 bis.13.3 : deux cibles lèvent `previsualisation_cible`. Le module ne doit donc jamais
		// envoyer `p_transition_id` lorsqu'il vise une étape, fût-ce à `null` explicite.
		const recu: { params?: Record<string, unknown>; nom?: string } = {}
		await previsualiserExigence(
			clientPrevisualisation({ data: [{ sur_place: 4, a_l_entree: 0 }], error: null }, recu),
			'champ-1',
			{ genre: 'etape', idEtape: 'etape-1' },
		)
		expect(recu.nom).toBe('previsualiser_exigence')
		expect(recu.params).toEqual({ p_field_id: 'champ-1', p_step_id: 'etape-1' })
		expect(Object.keys(recu.params ?? {})).not.toContain('p_transition_id')
	})

	it('appelle `previsualiser_exigence` avec la SEULE cible fournie — une transition', async () => {
		const recu: { params?: Record<string, unknown>; nom?: string } = {}
		await previsualiserExigence(
			clientPrevisualisation({ data: [{ sur_place: 0, a_l_entree: 4 }], error: null }, recu),
			'champ-1',
			{ genre: 'transition', idTransition: 'arete-1' },
		)
		expect(recu.params).toEqual({ p_field_id: 'champ-1', p_transition_id: 'arete-1' })
		expect(Object.keys(recu.params ?? {})).not.toContain('p_step_id')
	})

	it('rend les deux nombres tels que la base les a comptés', async () => {
		const resultat = await previsualiserExigence(
			clientPrevisualisation({ data: [{ sur_place: 1, a_l_entree: 8 }], error: null }),
			'champ-1',
			{ genre: 'etape', idEtape: 'perdu' },
		)
		expect(resultat).toEqual({ statut: 'mesure', effets: { surPlace: 1, aLEntree: 8 } })
	})

	it('rend `indisponible` sur un refus, et NE PRÉTEND JAMAIS zéro', async () => {
		// La distinction est la raison d'être du type : un zéro inventé aurait rassuré à tort sur un
		// geste qui bloque des affaires (§7 bis.13.4).
		const resultat = await previsualiserExigence(
			clientPrevisualisation({ data: null, error: { message: 'refus' }, status: 403 }),
			'champ-1',
			{ genre: 'etape', idEtape: 'etape-1' },
		)
		expect(resultat).toEqual({ statut: 'indisponible' })
	})

	it('rend `indisponible` sur une réponse vide — contrat rompu, pas un zéro', async () => {
		const resultat = await previsualiserExigence(
			clientPrevisualisation({ data: [], error: null }),
			'champ-1',
			{ genre: 'etape', idEtape: 'etape-1' },
		)
		expect(resultat).toEqual({ statut: 'indisponible' })
	})

	it('rend `indisponible` sur une coupure réseau, sans laisser fuir l’exception', async () => {
		const client = {
			rpc: () => {
				throw new Error('coupure')
			},
		} as unknown as ClientCrm
		expect(await previsualiserExigence(client, 'champ-1', { genre: 'etape', idEtape: 'e1' })).toEqual(
			{ statut: 'indisponible' },
		)
	})

	it('rend `indisponible` sans client configuré, et n’appelle rien', async () => {
		expect(await previsualiserExigence(null, 'champ-1', { genre: 'etape', idEtape: 'e1' })).toEqual({
			statut: 'indisponible',
		})
	})

	it('compose les CINQ messages, dont « aucun effet » qui est une phrase et non un silence', () => {
		expect(composerMessageEffets({ statut: 'indisponible' })).toEqual({ cle: 'indisponible' })
		expect(
			composerMessageEffets({ statut: 'mesure', effets: { surPlace: 0, aLEntree: 0 } }),
		).toEqual({ cle: 'aucun-effet' })
		// `Prospection` mesuré : 4 sur place, 0 à l'entrée — aucune arête ne mène à l'étape initiale.
		expect(
			composerMessageEffets({ statut: 'mesure', effets: { surPlace: 4, aLEntree: 0 } }),
		).toEqual({ cle: 'sur-place', surPlace: 4 })
		// `Signature` mesuré : l'inverse exact.
		expect(
			composerMessageEffets({ statut: 'mesure', effets: { surPlace: 0, aLEntree: 1 } }),
		).toEqual({ cle: 'a-l-entree', aLEntree: 1 })
		// `Perdu` mesuré : les deux à la fois.
		expect(
			composerMessageEffets({ statut: 'mesure', effets: { surPlace: 1, aLEntree: 8 } }),
		).toEqual({ cle: 'les-deux', surPlace: 1, aLEntree: 8 })
	})
})

// ---------------------------------------------------------------------------------------------
// La création d'un workflow — CRM-031, docs/SPEC-workflow-engine.md §3 bis
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-031 (docs/BACKLOG.md) — création d'un workflow depuis l'éditeur d'administration
// @verifies docs/SPEC-workflow-engine.md §3 bis.3 (la quatrième lecture et ses filtres),
//           §3 bis.4 (validation de forme, ses deux conditions), §3 bis.5 (la correspondance des
//           refus mesurés), §3 bis.8 (preuves attendues, niveau unitaire), §3.2 (cohérence de
//           portée `scope` / `track_id`, et `is_default` au plus un par workspace)

describe('la lecture des tracks affectables (§3 bis.3, lecture 4)', () => {
	it('demande deux colonnes, écarte les archivés, trie par position, et NE filtre PAS le workspace', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireTracksAffectables(client)
		expect(appel.table).toBe('tracks')
		expect(appel.colonnes).toBe(COLONNES_TRACK_AFFECTABLE)
		expect(appel.filtres).toEqual([['archived_at', null]])
		expect(appel.tris).toEqual([['position', undefined]])
		// Le filtre de workspace est celui de la RLS. L'écrire ici laisserait croire que
		// l'interface protège quelque chose — `CLAUDE.md` §10.
		expect(appel.filtres.some(([colonne]) => colonne === 'workspace_id')).toBe(false)
	})

	it('une erreur de lecture est rendue classée, jamais levée', async () => {
		const { client } = espionLecture({
			data: null,
			error: { message: 'indisponible' },
			status: 503,
		})
		const etat = await lireTracksAffectables(client)
		expect(etat.statut).toBe('erreur')
	})
})

describe('la validation de forme de la création (§3 bis.4)', () => {
	const base = { idWorkspace: 'ws1', nom: 'Cycle neuf', portee: 'global', idTrack: null } as const

	it('un nom renseigné et une portée globale suffisent', () => {
		expect(creationWorkflowConforme(base)).toBe(true)
	})

	it('un nom vide ou entièrement blanc est refusé — `workflows_name_check` teste `btrim`', () => {
		expect(creationWorkflowConforme({ ...base, nom: '' })).toBe(false)
		expect(creationWorkflowConforme({ ...base, nom: '   ' })).toBe(false)
	})

	it('la portée `track` sans track choisi est refusée, avec track elle passe', () => {
		expect(creationWorkflowConforme({ ...base, portee: 'track', idTrack: null })).toBe(false)
		expect(creationWorkflowConforme({ ...base, portee: 'track', idTrack: 't1' })).toBe(true)
	})

	it('un track choisi sous la portée globale ne rend PAS la saisie non conforme', () => {
		// La forme reste valide : c'est `creerWorkflow` qui écarte le track, et non la validation.
		// Les confondre ferait de l'oubli du track une condition d'envoi, alors qu'il est une
		// normalisation — voir le test suivant.
		expect(creationWorkflowConforme({ ...base, idTrack: 't1' })).toBe(true)
	})
})

describe('l’écriture de création (§3 bis.1, §3.2)', () => {
	it('insère dans `workflows`, `trim`e le nom, et rend l’identifiant créé', async () => {
		const { client, appels } = espionEcritures([{ data: [{ id: 'w-neuf' }], error: null, status: 201 }])
		const resultat = await creerWorkflow(client, {
			idWorkspace: 'ws1',
			nom: '  Cycle neuf  ',
			portee: 'global',
			idTrack: null,
		})
		const appel = appels[0]
		expect(appel?.table).toBe('workflows')
		expect(appel?.verbe).toBe('insert')
		expect(appel?.charge).toEqual({
			workspace_id: 'ws1',
			name: 'Cycle neuf',
			scope: 'global',
			track_id: null,
		})
		expect(appel?.colonnesRendues).toBe('id')
		expect(resultat).toEqual({ statut: 'applique', id: 'w-neuf' })
	})

	it('`is_default` n’est JAMAIS envoyé — il échouerait en 23505 sur tout workspace ayant son défaut', async () => {
		const { client, appels } = espionEcritures([{ data: [{ id: 'w' }], error: null, status: 201 }])
		await creerWorkflow(client, {
			idWorkspace: 'ws1',
			nom: 'Cycle neuf',
			portee: 'global',
			idTrack: null,
		})
		expect(Object.keys(appels[0]?.charge ?? {})).not.toContain('is_default')
	})

	it('la portée `track` envoie le track choisi', async () => {
		const { client, appels } = espionEcritures([{ data: [{ id: 'w' }], error: null, status: 201 }])
		await creerWorkflow(client, {
			idWorkspace: 'ws1',
			nom: 'Cycle du track',
			portee: 'track',
			idTrack: 't1',
		})
		expect(appels[0]?.charge).toMatchObject({ scope: 'track', track_id: 't1' })
	})

	it('la portée `global` FORCE `track_id` à null, même si un track résiduel est fourni', async () => {
		// C'est la mesure du §3 bis.5 : `scope = 'global'` avec un `track_id` rend `400` / `23514`
		// sur `workflows_scope_track_check`. L'écran oublie déjà le track à la bascule ; le module
		// ne s'y fie pas, parce qu'un état d'interface n'est pas un contrat.
		const { client, appels } = espionEcritures([{ data: [{ id: 'w' }], error: null, status: 201 }])
		await creerWorkflow(client, {
			idWorkspace: 'ws1',
			nom: 'Cycle neuf',
			portee: 'global',
			idTrack: 't1',
		})
		expect(appels[0]?.charge).toMatchObject({ scope: 'global', track_id: null })
	})

	it('zéro ligne écrite rend `sans-effet`, et non un succès', async () => {
		const { client } = espionEcritures([ZERO_LIGNE])
		const resultat = await creerWorkflow(client, {
			idWorkspace: 'ws1',
			nom: 'Cycle neuf',
			portee: 'global',
			idTrack: null,
		})
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})

	it('les trois refus mesurés au §3 bis.5 sont classés par leur code SQL', async () => {
		const cas = [
			{ code: '42501', statut: 403, attendu: 'forbidden' },
			{ code: '23514', statut: 400, attendu: 'forme-refusee' },
			{ code: '23503', statut: 409, attendu: 'reference-absente' },
		] as const
		for (const { code, statut, attendu } of cas) {
			const { client } = espionEcritures([
				{ data: null, error: { code, message: `refus ${code}` }, status: statut },
			])
			const resultat = await creerWorkflow(client, {
				idWorkspace: 'ws1',
				nom: 'Cycle neuf',
				portee: 'global',
				idTrack: null,
			})
			expect(resultat).toEqual({
				statut: 'refus',
				refus: { nature: attendu, detail: `refus ${code}` },
			})
		}
	})
})
