// @verifies CRM-030 (docs/BACKLOG.md) — administration du catalogue : lecture, écritures, refus
// @verifies docs/SPEC-workflow-engine.md §2 bis.3 (la lecture unique, archivés compris),
//           §2 bis.4 (les quatre gestes), §2 bis.5 (les cinq refus mesurés), §2 bis.6 (validation
//           de forme), §2 bis.9 (ligne « Unitaire »)
// @verifies docs/SPEC-workflow-engine.md §2 ter.1 (une colonne, une ligne), §2 ter.2 (le calcul),
//           §2 ter.3 (les archivés comptés comme voisines), §2 ter.4 (le contrat mesuré),
//           §2 ter.5 (les refus), §2 ter.6 (positions indistinctes), §2 ter.7 (ligne « Unitaire »)
// @verifies docs/SPEC-workflow-engine.md §2.3 (la clé stable), §2.4 (position attribuée),
//           §2.5 (`0` n'est pas `NULL`), §2.6 (la garde d'archivage)
// @verifies CLAUDE.md §10 (l'écran n'anticipe aucun refus), §18 (aucune valeur par défaut trompeuse)
//
// DEUX ASSERTIONS SONT ÉCRITES « EN NÉGATIF », et ce sont les plus utiles : la lecture n'émet
// AUCUN filtre — ni sur `workspace_id`, que la RLS borne déjà, ni sur `archived_at`, dont
// l'absence est ce qui rend le désarchivage atteignable (§2 bis.3). Une régression qui ajouterait
// l'un ou l'autre par symétrie avec `lireCatalogueActif` ferait disparaître les nœuds archivés de
// l'écran d'où on les rétablit, et rien d'autre ne le dirait.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_NOEUD,
	JETON_NOEUD_OCCUPE,
	archiverNoeud,
	classerRefusCatalogue,
	compterAffairesOccupantes,
	creerNoeud,
	deplacerNoeud,
	lireCatalogueAdministrable,
	lireSaisieNumerique,
	modifierNoeud,
	probabiliteConforme,
	seuilRelanceConforme,
	valeurNumeriqueEnvoyee,
} from './administration-catalogue'
import { calculerDeplacement } from './administration-arborescence'
import type { ClientCrm } from './supabase'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const NOEUD = '5eed0000-0000-4000-8000-000000000041'

type Reponse = { data: unknown[] | null; error: { code?: string; message: string } | null; status: number }

type Appel = {
	table: string
	verbe: 'select' | 'insert' | 'update'
	colonnes?: string
	charge?: Record<string, unknown>
	filtres: [string, string, unknown][]
	ordres: [string, unknown][]
}

/**
 * Transport espion : il enregistre chaque appel — table, verbe, charge, filtres et ordres — et rend
 * la réponse fournie. La chaîne est **thenable**, comme `supabase-js` le permet.
 */
/**
 * Le premier appel enregistré, ou un échec qui le NOMME.
 *
 * `appels[0]!` passerait le typage sans rien dire le jour où aucun appel n'est émis — c'est-à-dire
 * exactement le défaut qu'une preuve de requête doit attraper. L'accès explicite échoue avec une
 * phrase lisible plutôt qu'un `Cannot read properties of undefined`.
 */
function premierAppel(appels: readonly Appel[]): Appel {
	const appel = appels[0]
	if (appel === undefined) throw new Error('aucune requête émise')
	return appel
}

function espion(reponse: Reponse): { client: ClientCrm; appels: Appel[] } {
	const appels: Appel[] = []
	const chainePour = (appel: Appel) => {
		const chaine = {
			eq: (colonne: string, valeur: unknown) => {
				appel.filtres.push(['eq', colonne, valeur])
				return chaine
			},
			is: (colonne: string, valeur: unknown) => {
				appel.filtres.push(['is', colonne, valeur])
				return chaine
			},
			order: (colonne: string, options: unknown) => {
				appel.ordres.push([colonne, options])
				return chaine
			},
			select: (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			},
			then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
		}
		return chaine
	}
	const client = {
		from: (table: string) => ({
			select: (colonnes: string) => {
				const appel: Appel = { table, verbe: 'select', colonnes, filtres: [], ordres: [] }
				appels.push(appel)
				return chainePour(appel)
			},
			insert: (charge: Record<string, unknown>) => {
				const appel: Appel = { table, verbe: 'insert', charge, filtres: [], ordres: [] }
				appels.push(appel)
				return chainePour(appel)
			},
			update: (charge: Record<string, unknown>) => {
				const appel: Appel = { table, verbe: 'update', charge, filtres: [], ordres: [] }
				appels.push(appel)
				return chainePour(appel)
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

// ---------------------------------------------------------------------------------------------
// La lecture — §2 bis.3
// ---------------------------------------------------------------------------------------------

describe('lireCatalogueAdministrable', () => {
	it('lit la table entière, ordonnée par position puis libellé, SANS aucun filtre (§2 bis.3)', async () => {
		const { client, appels } = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		const resultat = await lireCatalogueAdministrable(client)

		expect(appels).toHaveLength(1)
		expect(premierAppel(appels)).toMatchObject({
			table: 'workflow_nodes_catalog',
			colonnes: COLONNES_NOEUD,
		})
		// AUCUN filtre : ni `workspace_id` — la RLS le borne (§2.7) —, ni `archived_at` — les nœuds
		// archivés doivent apparaître, sinon leur rétablissement serait introuvable.
		expect(premierAppel(appels).filtres).toEqual([])
		expect(premierAppel(appels).ordres).toEqual([
			['position', { ascending: true }],
			['label', { ascending: true }],
		])
		expect(resultat.statut).toBe('pret')
	})

	it('demande `archived_at`, sans quoi la pilule « Archivé » ne pourrait pas être rendue', () => {
		expect(COLONNES_NOEUD).toContain('archived_at')
	})

	it('rend une erreur classée plutôt que de lever (docs/SPEC-webapp.md §6.4)', async () => {
		const { client } = espion({ data: null, error: { message: 'coupure' }, status: 500 })
		const resultat = await lireCatalogueAdministrable(client)
		expect(resultat.statut).toBe('erreur')
	})
})

// ---------------------------------------------------------------------------------------------
// La saisie numérique — §2.5, `0` n'est pas `NULL`
// ---------------------------------------------------------------------------------------------

describe('lireSaisieNumerique', () => {
	it('distingue le vide du zéro : la règle du §2.5, qu\'un `Number("")` détruirait', () => {
		expect(lireSaisieNumerique('')).toEqual({ statut: 'vide' })
		expect(lireSaisieNumerique('   ')).toEqual({ statut: 'vide' })
		expect(lireSaisieNumerique('0')).toEqual({ statut: 'valeur', valeur: 0 })
		expect(Number('')).toBe(0) // le piège, nommé plutôt que sous-entendu
	})

	it('nomme une saisie illisible au lieu de la rendre `NaN`', () => {
		expect(lireSaisieNumerique('douze')).toEqual({ statut: 'illisible' })
	})
})

describe('valeurNumeriqueEnvoyee', () => {
	it('envoie `null` pour un champ vide, et `0` pour un zéro réellement saisi (§2.5)', () => {
		expect(valeurNumeriqueEnvoyee(lireSaisieNumerique(''))).toBeNull()
		expect(valeurNumeriqueEnvoyee(lireSaisieNumerique('0'))).toBe(0)
		expect(valeurNumeriqueEnvoyee(lireSaisieNumerique('douze'))).toBeNull()
	})
})

describe('probabiliteConforme', () => {
	it('accepte les bornes, refuse au-delà — la contrainte `0 ≤ x ≤ 100` (§2.5)', () => {
		expect(probabiliteConforme(lireSaisieNumerique('0'))).toBe(true)
		expect(probabiliteConforme(lireSaisieNumerique('100'))).toBe(true)
		expect(probabiliteConforme(lireSaisieNumerique('100.01'))).toBe(false)
		expect(probabiliteConforme(lireSaisieNumerique('-0.01'))).toBe(false)
	})

	it('accepte le vide : le champ est facultatif, et « ne se prononce pas » est une valeur du produit', () => {
		expect(probabiliteConforme(lireSaisieNumerique(''))).toBe(true)
	})
})

describe('seuilRelanceConforme', () => {
	it('exige un entier strictement positif — `x > 0`, et la colonne est un `integer` (§2.5)', () => {
		expect(seuilRelanceConforme(lireSaisieNumerique('1'))).toBe(true)
		expect(seuilRelanceConforme(lireSaisieNumerique('0'))).toBe(false)
		expect(seuilRelanceConforme(lireSaisieNumerique('-3'))).toBe(false)
		expect(seuilRelanceConforme(lireSaisieNumerique('1.5'))).toBe(false)
		expect(seuilRelanceConforme(lireSaisieNumerique(''))).toBe(true)
	})
})

// ---------------------------------------------------------------------------------------------
// Les refus — §2 bis.5
// ---------------------------------------------------------------------------------------------

describe('classerRefusCatalogue', () => {
	/**
	 * LA DISTINCTION QUE CE FICHIER EXISTE POUR TENIR. Les deux refus portent `42501` et `403` ; les
	 * confondre ferait lire un refus RATTRAPABLE — déplacez les affaires — comme un refus de droit,
	 * contre lequel l'utilisateur ne peut rien.
	 */
	it('sépare la garde d\'archivage du refus de la RLS, à SQLSTATE identique (§2 bis.5)', () => {
		const occupe = classerRefusCatalogue(
			403,
			'42501',
			`${JETON_NOEUD_OCCUPE} : 4 card(s) active(s) se trouvent encore sur ce nœud`,
		)
		expect(occupe).toEqual({
			nature: 'noeud-occupe',
			detail: `${JETON_NOEUD_OCCUPE} : 4 card(s) active(s) se trouvent encore sur ce nœud`,
			affairesActives: 4,
		})

		const rls = classerRefusCatalogue(
			403,
			'42501',
			'new row violates row-level security policy for table "workflow_nodes_catalog"',
		)
		expect(rls.nature).toBe('forbidden')
		expect(rls.affairesActives).toBeNull()
	})

	it('classe la clé prise, la forme refusée et la référence absente sur leur SQLSTATE', () => {
		expect(
			classerRefusCatalogue(409, '23505', 'duplicate key value violates unique constraint').nature,
		).toBe('cle-prise')
		expect(
			classerRefusCatalogue(400, '23514', 'violates check constraint "…_key_check"').nature,
		).toBe('forme-refusee')
		expect(classerRefusCatalogue(409, '23503', 'violates foreign key constraint').nature).toBe(
			'reference-absente',
		)
	})

	it('classe une coupure de transport en `network`, jamais en refus de droit', () => {
		expect(classerRefusCatalogue(undefined, undefined, 'Failed to fetch').nature).toBe('network')
	})
})

describe('compterAffairesOccupantes', () => {
	it('lit le nombre porté par le message mesuré le 2026-08-16', () => {
		expect(
			compterAffairesOccupantes(`${JETON_NOEUD_OCCUPE} : 4 card(s) active(s) se trouvent encore`),
		).toBe(4)
	})

	/**
	 * UN COMPTE ABSENT NE DEVIENT PAS ZÉRO. « 0 affaire occupe ce nœud » serait la contradiction
	 * exacte du refus qu'on est en train d'afficher — la « valeur par défaut trompeuse » de
	 * `CLAUDE.md` §18.
	 */
	it('rend `null` quand le message ne porte aucun nombre, jamais `0`', () => {
		expect(compterAffairesOccupantes(`${JETON_NOEUD_OCCUPE} : des affaires occupent ce nœud`)).toBeNull()
		expect(compterAffairesOccupantes('autre chose')).toBeNull()
	})
})

// ---------------------------------------------------------------------------------------------
// Les écritures — §2 bis.4
// ---------------------------------------------------------------------------------------------

describe('creerNoeud', () => {
	it('envoie `position: null` : le trigger place le nœud en fin de liste (§2.4)', async () => {
		const { client, appels } = espion({ data: [{ id: NOEUD }], error: null, status: 201 })
		const resultat = await creerNoeud(client, {
			idWorkspace: WORKSPACE,
			cle: '  relance-longue  ',
			libelle: '  Relance longue  ',
			type: 'open',
			couleur: 'accent',
			probabilite: lireSaisieNumerique('20'),
			seuilRelance: lireSaisieNumerique(''),
		})

		expect(resultat).toEqual({ statut: 'applique' })
		expect(premierAppel(appels)).toMatchObject({ table: 'workflow_nodes_catalog', verbe: 'insert' })
		expect(premierAppel(appels).charge).toEqual({
			workspace_id: WORKSPACE,
			// Les blancs de bord sont retirés : `key_check` refuserait la clé, et `label_check`
			// accepterait un libellé à espaces que personne n'a voulu.
			key: 'relance-longue',
			label: 'Relance longue',
			kind: 'open',
			color: 'accent',
			default_probability: 20,
			// Le champ laissé vide vaut `NULL`, jamais `0` (§2.5).
			default_stale_after_days: null,
			position: null,
		})
	})

	it('rend `refus` avec sa nature plutôt que de lever, sur une clé déjà prise', async () => {
		const { client } = espion({
			data: null,
			error: { code: '23505', message: 'duplicate key value violates unique constraint' },
			status: 409,
		})
		const resultat = await creerNoeud(client, {
			idWorkspace: WORKSPACE,
			cle: 'perdu',
			libelle: 'Doublon',
			type: 'open',
			couleur: 'neutral',
			probabilite: lireSaisieNumerique(''),
			seuilRelance: lireSaisieNumerique(''),
		})
		expect(resultat).toMatchObject({ statut: 'refus', refus: { nature: 'cle-prise' } })
	})
})

describe('modifierNoeud', () => {
	it("n'écrit JAMAIS `key` : la clé fonde la comparabilité analytique (§2.1)", async () => {
		const { client, appels } = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		await modifierNoeud(client, NOEUD, {
			libelle: 'Prospection',
			type: 'open',
			couleur: 'neutral',
			probabilite: lireSaisieNumerique('10'),
			seuilRelance: lireSaisieNumerique('14'),
		})

		expect(premierAppel(appels)).toMatchObject({ table: 'workflow_nodes_catalog', verbe: 'update' })
		expect(premierAppel(appels).charge).not.toHaveProperty('key')
		expect(premierAppel(appels).charge).toEqual({
			label: 'Prospection',
			kind: 'open',
			color: 'neutral',
			default_probability: 10,
			default_stale_after_days: 14,
		})
		expect(premierAppel(appels).filtres).toEqual([['eq', 'id', NOEUD]])
	})

	/**
	 * `200` ET ZÉRO LIGNE N'EST PAS UN SUCCÈS (§2 bis.5, dernière ligne). MESURÉ sur cette table
	 * avec le jeton du viewer : le `USING` de la politique filtre la ligne, et une preuve qui se
	 * contenterait de l'absence d'erreur conclurait que l'écriture a réussi.
	 */
	it('rend `sans-effet` quand la politique a filtré la ligne', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await modifierNoeud(client, NOEUD, {
			libelle: 'Piraté',
			type: 'open',
			couleur: 'neutral',
			probabilite: lireSaisieNumerique(''),
			seuilRelance: lireSaisieNumerique(''),
		})
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})
})

describe('archiverNoeud', () => {
	it('écrit un horodatage pour archiver, et `null` pour rétablir', async () => {
		const archivage = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		await archiverNoeud(archivage.client, NOEUD, true)
		expect(typeof premierAppel(archivage.appels).charge?.archived_at).toBe('string')

		const retablissement = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		await archiverNoeud(retablissement.client, NOEUD, false)
		expect(premierAppel(retablissement.appels).charge).toEqual({ archived_at: null })
	})

	it('remonte la garde du §2.6 avec son compte, sans la confondre avec un refus de droit', async () => {
		const { client } = espion({
			data: null,
			error: {
				code: '42501',
				message: `${JETON_NOEUD_OCCUPE} : 4 card(s) active(s) se trouvent encore sur ce nœud`,
			},
			status: 403,
		})
		const resultat = await archiverNoeud(client, NOEUD, true)
		expect(resultat).toMatchObject({
			statut: 'refus',
			refus: { nature: 'noeud-occupe', affairesActives: 4 },
		})
	})
})

// ---------------------------------------------------------------------------------------------
// Le réordonnancement — §2 ter
// ---------------------------------------------------------------------------------------------

/**
 * Le catalogue tel que le seed le pose, réduit aux deux colonnes dont le calcul a besoin, et
 * ARCHIVÉS COMPRIS (§2 ter.3) : `qualification` porte la position `8`, comme en base.
 *
 * Les positions sont entières et distinctes, donc tout déplacement a un milieu strict — c'est la
 * ligne « Seed » du §2 ter.7, vérifiée ici plutôt que supposée.
 */
const CATALOGUE_SEED = [
	{ id: 'n1', position: 1 },
	{ id: 'n2', position: 2 },
	{ id: 'n3', position: 3 },
	{ id: 'n8-archive', position: 8 },
] as const

describe('deplacerNoeud', () => {
	it("n'écrit QUE `position`, sur UNE seule ligne (§2 ter.1)", async () => {
		const { client, appels } = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		const resultat = await deplacerNoeud(client, NOEUD, 1.5)

		expect(appels).toHaveLength(1)
		// La charge est comparée en ÉGALITÉ, pas en `toMatchObject` : c'est la seule forme qui
		// attrape une colonne ajoutée par mégarde. Réécrire `label` ou `archived_at` au passage d'un
		// déplacement changerait la donnée sans que personne ne l'ait demandé.
		expect(premierAppel(appels).charge).toEqual({ position: 1.5 })
		expect(premierAppel(appels).verbe).toBe('update')
		expect(premierAppel(appels).filtres).toEqual([['eq', 'id', NOEUD]])
		expect(resultat).toEqual({ statut: 'applique' })
	})

	it('conserve la fraction que le calcul a produite — `numeric` ne l’arrondit pas (§2 ter.4 a)', async () => {
		const { client, appels } = espion({ data: [{ id: NOEUD }], error: null, status: 200 })
		await deplacerNoeud(client, NOEUD, 2.5)
		expect(premierAppel(appels).charge).toEqual({ position: 2.5 })
	})

	it('rend `sans-effet` sur `200` et zéro ligne — le refus du `viewer` (§2 ter.4 c)', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await deplacerNoeud(client, NOEUD, 3)).toEqual({ statut: 'sans-effet' })
	})

	it('classe un `42501` de la RLS en `forbidden`, jamais en nœud occupé (§2 ter.5)', async () => {
		const { client } = espion({
			data: null,
			error: { code: '42501', message: 'new row violates row-level security policy' },
			status: 403,
		})
		expect(await deplacerNoeud(client, NOEUD, 3)).toMatchObject({
			statut: 'refus',
			refus: { nature: 'forbidden' },
		})
	})
})

describe('calculerDeplacement sur le catalogue — §2 ter.2 et §2 ter.3', () => {
	it('monte un nœud du milieu entre les deux positions qui le précèdent', () => {
		expect(calculerDeplacement(CATALOGUE_SEED, 'n3', 'monter')).toEqual({
			statut: 'calcule',
			position: 1.5,
		})
	})

	it('descend un nœud en prenant une position entre la suivante et l’après-suivante', () => {
		expect(calculerDeplacement(CATALOGUE_SEED, 'n1', 'descendre')).toEqual({
			statut: 'calcule',
			position: 2.5,
		})
	})

	it('refuse de monter la première ligne, et de descendre la dernière (§2 ter.2, extrémités)', () => {
		expect(calculerDeplacement(CATALOGUE_SEED, 'n1', 'monter')).toEqual({
			statut: 'impossible',
			cause: 'extremite',
		})
		expect(calculerDeplacement(CATALOGUE_SEED, 'n8-archive', 'descendre')).toEqual({
			statut: 'impossible',
			cause: 'extremite',
		})
	})

	it('COMPTE LE NŒUD ARCHIVÉ COMME VOISINE (§2 ter.3)', () => {
		// `n2` descend d'un cran : sa borne haute est la position de l'ARCHIVÉ, `8`, et le milieu vaut
		// `5.5`. Sur une liste privée de l'archivé, `n2` serait l'avant-dernière et la même commande
		// rendrait `4` — `n3` étant alors la dernière. Les deux valeurs sont légitimes ; une seule
		// correspond à la liste que l'administrateur a sous les yeux.
		expect(calculerDeplacement(CATALOGUE_SEED, 'n2', 'descendre')).toEqual({
			statut: 'calcule',
			position: 5.5,
		})
		// Et `n3` est la DERNIÈRE ligne active sans l'être dans la liste affichée : elle descend
		// encore, en queue, sur `suivante + 1`. Sans l'archivé dans la liste, elle rendrait
		// `extremite` — la ligne visible à l'écran serait franchie sans un mot, ou pas franchissable.
		expect(calculerDeplacement(CATALOGUE_SEED, 'n3', 'descendre')).toEqual({
			statut: 'calcule',
			position: 9,
		})
	})

	it('nomme `positions-indistinctes` quand deux voisines partagent une position (§2 ter.6)', () => {
		// Deux administrateurs qui déplacent en même temps produisent ce cas, et le §2 bis.3 départage
		// alors sur `label`. Le geste suivant ne doit pas écrire une valeur qui ne changerait rien.
		const egales = [
			{ id: 'a', position: 4 },
			{ id: 'b', position: 4 },
			{ id: 'c', position: 4 },
			{ id: 'd', position: 9 },
		] as const
		expect(calculerDeplacement(egales, 'c', 'monter')).toEqual({
			statut: 'impossible',
			cause: 'positions-indistinctes',
		})
	})
})
