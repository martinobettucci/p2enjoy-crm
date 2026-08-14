// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première tranche
// @verifies docs/SPEC-workflow-engine.md §7 bis.3 (les trois lectures, leurs filtres et leur ordre),
//           §7 bis.4 (les six gestes et ce que la base garantit), §7 bis.5 (validation de forme),
//           §7 bis.8 (preuves attendues, niveau unitaire)
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
	type EtapeAdministrable,
	type NoeudAjoutable,
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
