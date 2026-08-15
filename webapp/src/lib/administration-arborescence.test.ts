// @verifies CRM-075 (docs/BACKLOG.md) — administration des tracks et des channels
// @verifies CRM-077 (docs/BACKLOG.md) — corbeille, septième tranche : le geste de mise à la
//           corbeille d'un track et d'un channel, et le filtre que l'administration n'avait pas
// @verifies docs/SPEC-corbeille.md §3.1 (les deux états sont indépendants), §4 bis.2 (le filtre
//           ajouté, séparé de celui de l'archivage), §4 bis.4 (la charge ne porte que `deleted_at`),
//           §4 bis.5 (les trois issues)
// @verifies docs/SPEC-administration-arborescence.md §5.1 (proposition de slug), §6.2 (une seule
//           écriture par déplacement, dégénérescences), §6.4 (voir les archivés), §7.2 (workflows
//           affectables), §8 (validation de forme), §9 (classement des refus, `200`-zéro-ligne)
// @verifies docs/SPEC-tracks.md §3 (ordre, trigger de position), §4 (archivage)
// @verifies docs/SPEC-channels.md §3 (ordre par track), §2.4 (clé composite)
// @verifies docs/SPEC-workflow-engine.md §4.12 (contrainte d'affectation)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue. Motif : trois
// exigences de la spécification sont portées par la requête elle-même — le filtre des archivés,
// l'ordre, et le filtre des workflows affectables — et un test qui n'observerait que la réponse les
// laisserait disparaître sans bruit. C'est la règle déjà tenue par `tracks.test.ts`.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_CHANNEL_ADMIN,
	COLONNES_TRACK_ADMIN,
	COLONNES_WORKFLOW_AFFECTABLE,
	MOTIF_SLUG,
	archiverChannel,
	archiverTrack,
	calculerDeplacement,
	classerRefusEcriture,
	creerChannel,
	creerTrack,
	deplacerTrack,
	deplacementPossible,
	filtreWorkflowsAffectables,
	lireChannelsAdministrables,
	lireTracksAdministrables,
	lireWorkflowsAffectables,
	mettreChannelALaCorbeille,
	mettreTrackALaCorbeille,
	modifierChannel,
	modifierTrack,
	nomConforme,
	positionAvant,
	positionEntre,
	proposerSlug,
	slugConforme,
	type Ordonnable,
} from './administration-arborescence'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Clients espions
// ---------------------------------------------------------------------------------------------

type AppelLecture = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	ou?: string
	tris: [string, unknown?][]
}

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

/** Client factice qui **enregistre** la requête de lecture construite, puis rend la réponse voulue. */
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
		or: (expression: string) => {
			appel.ou = expression
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

type AppelEcriture = {
	table?: string
	verbe?: 'insert' | 'update'
	charge?: Record<string, unknown>
	filtres: [string, unknown][]
	colonnesRendues?: string
}

/** Client factice qui enregistre l'écriture construite. */
function espionEcriture(reponse: Reponse): { client: ClientCrm; appel: AppelEcriture } {
	const appel: AppelEcriture = { filtres: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnesRendues = colonnes
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.verbe = 'insert'
					appel.charge = charge
					return chaine
				},
				update: (charge: Record<string, unknown>) => {
					appel.verbe = 'update'
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** Client dont le transport échoue par une exception, comme `supabase-js` peut le faire. */
function clientQuiLeve(cause: unknown): ClientCrm {
	const exploser = () => {
		throw cause
	}
	const chaine: Record<string, unknown> = {}
	for (const methode of ['is', 'eq', 'or', 'order', 'select', 'then']) chaine[methode] = exploser
	return {
		from: () => ({ select: () => chaine, insert: () => chaine, update: () => chaine }),
	} as unknown as ClientCrm
}

const OK: Reponse = { data: [{ id: 'x' }], error: null, status: 200 }
const ZERO_LIGNE: Reponse = { data: [], error: null, status: 200 }

// ---------------------------------------------------------------------------------------------
// §6.2 — Réordonnancement
// ---------------------------------------------------------------------------------------------

/** Quatre lignes bien ordonnées, comme le seed les produit. */
const LISTE: readonly Ordonnable[] = [
	{ id: 'a', position: 1 },
	{ id: 'b', position: 2 },
	{ id: 'c', position: 3 },
	{ id: 'd', position: 4 },
]

describe('calculerDeplacement — une seule écriture, jamais une permutation (§6.2)', () => {
	it('place la ligne montée au milieu des deux qui la précéderont', () => {
		// `c` passe avant `b` : il se range entre `a` (1) et `b` (2).
		expect(calculerDeplacement(LISTE, 'c', 'monter')).toEqual({ statut: 'calcule', position: 1.5 })
	})

	it('place la ligne descendue au milieu des deux qui la suivront', () => {
		// `b` passe après `c` : il se range entre `c` (3) et `d` (4).
		expect(calculerDeplacement(LISTE, 'b', 'descendre')).toEqual({ statut: 'calcule', position: 3.5 })
	})

	it('divise par deux pour prendre la tête de la liste', () => {
		expect(calculerDeplacement(LISTE, 'b', 'monter')).toEqual({ statut: 'calcule', position: 0.5 })
	})

	it("reprend l'incrément du trigger pour prendre la queue de la liste", () => {
		expect(calculerDeplacement(LISTE, 'c', 'descendre')).toEqual({ statut: 'calcule', position: 5 })
	})

	it('refuse les deux extrémités', () => {
		expect(calculerDeplacement(LISTE, 'a', 'monter')).toEqual({
			statut: 'impossible',
			cause: 'extremite',
		})
		expect(calculerDeplacement(LISTE, 'd', 'descendre')).toEqual({
			statut: 'impossible',
			cause: 'extremite',
		})
	})

	it("refuse un identifiant absent de la liste plutôt que d'écrire au hasard", () => {
		expect(calculerDeplacement(LISTE, 'inconnu', 'monter')).toEqual({
			statut: 'impossible',
			cause: 'extremite',
		})
	})

	it('refuse un déplacement dans une liste d’une seule ligne', () => {
		const seule: readonly Ordonnable[] = [{ id: 'a', position: 1 }]
		expect(calculerDeplacement(seule, 'a', 'monter').statut).toBe('impossible')
		expect(calculerDeplacement(seule, 'a', 'descendre').statut).toBe('impossible')
	})

	// La base autorise deux positions égales ; l'ordre se départage alors par le nom
	// (docs/SPEC-tracks.md §3). Leur milieu leur étant égal, l'écriture ne changerait rien.
	it('refuse quand les deux voisines portent la même position, au lieu d’écrire sans effet', () => {
		const egales: readonly Ordonnable[] = [
			{ id: 'a', position: 2 },
			{ id: 'b', position: 2 },
			{ id: 'c', position: 3 },
		]
		expect(calculerDeplacement(egales, 'c', 'monter')).toEqual({
			statut: 'impossible',
			cause: 'positions-indistinctes',
		})
	})

	it('refuse de passer avant une première position nulle ou négative', () => {
		// `0 / 2` vaut `0` : la ligne ne passerait pas devant.
		expect(calculerDeplacement([{ id: 'a', position: 0 }, { id: 'b', position: 1 }], 'b', 'monter')).toEqual(
			{ statut: 'impossible', cause: 'positions-indistinctes' },
		)
		expect(calculerDeplacement([{ id: 'a', position: -4 }, { id: 'b', position: 1 }], 'b', 'monter')).toEqual(
			{ statut: 'impossible', cause: 'positions-indistinctes' },
		)
	})

	it("refuse quand la précision flottante s'épuise, bornes pourtant distinctes (§11 limite 3)", () => {
		// Deux flottants consécutifs : leur milieu est égal à l'une des bornes.
		const suivant = 1 + Number.EPSILON
		expect(positionEntre(1, suivant)).toEqual({
			statut: 'impossible',
			cause: 'positions-indistinctes',
		})
		// La garde porte donc bien sur le RÉSULTAT et non sur l'égalité des entrées.
		expect(1 === suivant).toBe(false)
	})

	it('positionAvant et positionEntre rendent des bornes strictes', () => {
		expect(positionAvant(4)).toEqual({ statut: 'calcule', position: 2 })
		expect(positionAvant(0).statut).toBe('impossible')
		expect(positionEntre(1, 2)).toEqual({ statut: 'calcule', position: 1.5 })
		expect(positionEntre(2, 2).statut).toBe('impossible')
	})

	it('deplacementPossible sert à désactiver une commande, pas à la masquer', () => {
		expect(deplacementPossible(LISTE, 'a', 'monter')).toBe(false)
		expect(deplacementPossible(LISTE, 'a', 'descendre')).toBe(true)
		expect(deplacementPossible(LISTE, 'd', 'descendre')).toBe(false)
	})

	it('un déplacement calculé se range bien où il est annoncé, une fois la liste retriée', () => {
		// Preuve d'ensemble : le calcul n'est pas seulement « un nombre entre deux », il produit
		// l'ORDRE attendu. Sans elle, une inversion des bornes passerait les tests ci-dessus.
		const resultat = calculerDeplacement(LISTE, 'c', 'monter')
		expect(resultat.statut).toBe('calcule')
		if (resultat.statut !== 'calcule') return
		const apres = LISTE.map((ligne) => (ligne.id === 'c' ? { ...ligne, position: resultat.position } : ligne))
			.slice()
			.sort((gauche, droite) => gauche.position - droite.position)
			.map((ligne) => ligne.id)
		expect(apres).toEqual(['a', 'c', 'b', 'd'])
	})
})

// ---------------------------------------------------------------------------------------------
// §8 — Validation de forme
// ---------------------------------------------------------------------------------------------

describe('validation de forme (§8)', () => {
	it('le motif du slug est celui de la contrainte de la base, à la lettre', () => {
		// Recopié depuis `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`. Si la migration change, cette
		// assertion doit devenir rouge — c'est tout son objet.
		expect(MOTIF_SLUG.source).toBe('^[a-z0-9]+(-[a-z0-9]+)*$')
	})

	it('accepte ce que la base accepte', () => {
		for (const slug of ['a', 'conseil-ia', 'pipeline-2024', 'x1-y2-z3']) {
			expect(slugConforme(slug)).toBe(true)
		}
	})

	it('refuse ce que la base refuse', () => {
		for (const slug of ['', '-a', 'a-', 'a--b', 'Conseil', 'conseil ia', 'conseil_ia', 'été']) {
			expect(slugConforme(slug)).toBe(false)
		}
	})

	it('nomConforme reprend `btrim(name) <> \'\'`', () => {
		expect(nomConforme('Conseil')).toBe(true)
		expect(nomConforme('')).toBe(false)
		expect(nomConforme('   ')).toBe(false)
		expect(nomConforme('\t\n ')).toBe(false)
	})
})

describe('proposerSlug — commodité, jamais garantie (§5.1)', () => {
	it('translittère les diacritiques latines et met en minuscules', () => {
		expect(proposerSlug('Conseil & IA')).toBe('conseil-ia')
		expect(proposerSlug('Réseau Éducatif')).toBe('reseau-educatif')
		expect(proposerSlug('Pipeline 2024')).toBe('pipeline-2024')
	})

	it('réduit toute suite de séparateurs à un tiret unique et élague les bords', () => {
		expect(proposerSlug('  --  Grands   comptes !! ')).toBe('grands-comptes')
	})

	it('rend une proposition VIDE lorsque rien n’est exploitable, sans inventer de slug', () => {
		// L'écran laisse alors le champ à remplir : un `track-1` silencieux serait un choix que
		// l'utilisateur n'a pas fait.
		expect(proposerSlug('???')).toBe('')
		expect(proposerSlug('   ')).toBe('')
		expect(proposerSlug('日本語')).toBe('')
	})

	it('ne propose jamais un slug que la base refuserait', () => {
		for (const nom of ['Conseil & IA', '  --  Grands   comptes !! ', 'Réseau', 'A1']) {
			const propose = proposerSlug(nom)
			expect(propose === '' || slugConforme(propose)).toBe(true)
		}
	})
})

// ---------------------------------------------------------------------------------------------
// §9 — Classement des refus
// ---------------------------------------------------------------------------------------------

describe('classerRefusEcriture — sur le code, jamais sur la phrase (§9)', () => {
	it('range le refus de la politique d’écriture', () => {
		expect(classerRefusEcriture(403, '42501', 'new row violates row-level security policy').nature).toBe(
			'forbidden',
		)
		expect(classerRefusEcriture(401, undefined, 'JWT expired').nature).toBe('forbidden')
	})

	it('range l’unicité du slug à part : elle appelle un autre geste que le refus de droit', () => {
		expect(classerRefusEcriture(409, '23505', 'duplicate key value').nature).toBe('slug-pris')
	})

	it('sépare les deux refus qui partagent le SQLSTATE 23514 par le NOM de la contrainte', () => {
		// Le partage est délibéré (docs/SPEC-workflow-engine.md §4.12.3) : seul le nom les distingue.
		expect(
			classerRefusEcriture(400, '23514', 'workflow_hors_track: le workflow ne suit pas ce track')
				.nature,
		).toBe('workflow-hors-track')
		expect(classerRefusEcriture(400, '23514', 'violates check constraint "channels_name_check"').nature).toBe(
			'forme-refusee',
		)
	})

	it('range la clé étrangère composite', () => {
		expect(
			classerRefusEcriture(409, '23503', 'violates foreign key constraint "channels_track_id_workspace_id_fkey"')
				.nature,
		).toBe('reference-absente')
	})

	it('distingue une panne de transport d’un refus', () => {
		expect(classerRefusEcriture(undefined, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusEcriture(0, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusEcriture(500, undefined, 'boom').nature).toBe('unknown')
	})

	it('le code PostgreSQL prime sur le code HTTP', () => {
		// PostgREST rend `403` sur un `23505` dans certaines configurations : c'est bien le slug qui
		// est en cause, et dire « vous n'avez pas le droit » enverrait l'utilisateur au mauvais geste.
		expect(classerRefusEcriture(403, '23505', 'duplicate key value').nature).toBe('slug-pris')
	})

	it('conserve le détail technique pour le diagnostic, sans jamais l’afficher tel quel', () => {
		expect(classerRefusEcriture(403, '42501', 'détail brut').detail).toBe('détail brut')
	})
})

// ---------------------------------------------------------------------------------------------
// Lectures — la requête émise
// ---------------------------------------------------------------------------------------------

describe('lireTracksAdministrables (§6.4)', () => {
	// LES DEUX ATTENTES DE FILTRES SONT RÉVISÉES PAR `CRM-077`, septième tranche, et aucune n'est
	// relâchée : `deleted_at=is.null` s'AJOUTE à ce qu'elles figeaient. Motif MESURÉ le 2026-08-15 et
	// écrit au §4 bis.2 de `docs/SPEC-corbeille.md` — cette lecture rendait quatre tracks, dont
	// `Legacy 2023` en corbeille, la troisième tranche n'ayant pas filtré l'administration. La
	// seconde attente est celle qui compte : elle exige que la case « Afficher les archivés » retire
	// le filtre d'archivage ET CONSERVE celui de corbeille, les deux états étant indépendants (§3.1).
	it('filtre les archivés ET la corbeille CÔTÉ SERVEUR, et ordonne comme la barre latérale', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireTracksAdministrables(client, false)
		expect(appel.table).toBe('tracks')
		expect(appel.colonnes).toBe(COLONNES_TRACK_ADMIN)
		expect(appel.filtres).toEqual([
			['deleted_at', null],
			['archived_at', null],
		])
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['position', 'name'])
	})

	it('retire le filtre d’archivage — et lui seul — quand la case est cochée : la corbeille reste exclue', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireTracksAdministrables(client, true)
		expect(appel.filtres).toEqual([['deleted_at', null]])
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['position', 'name'])
	})

	it('classe un échec sur le code HTTP reçu', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'nope' }, status: 403 })
		const etat = await lireTracksAdministrables(client, false)
		expect(etat).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'nope' } })
	})

	it('rend une exception de transport comme un état d’erreur, jamais comme un rejet', async () => {
		const etat = await lireTracksAdministrables(clientQuiLeve(new Error('coupure')), false)
		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') return
		expect(etat.erreur.nature).toBe('network')
	})
})

describe('lireChannelsAdministrables (§3.2, §7.1)', () => {
	// Mêmes révisions, même motif : cette lecture rendait `Annexes 2023`, en corbeille (§4 bis.2).
	it('filtre sur le track ET la corbeille CÔTÉ SERVEUR : rien d’autre ne transite', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireChannelsAdministrables(client, 't-1', false)
		expect(appel.table).toBe('channels')
		expect(appel.colonnes).toBe(COLONNES_CHANNEL_ADMIN)
		expect(appel.filtres).toEqual([
			['track_id', 't-1'],
			['deleted_at', null],
			['archived_at', null],
		])
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['position', 'name'])
	})

	it('conserve les filtres de track et de corbeille quand les archivés sont demandés', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireChannelsAdministrables(client, 't-1', true)
		expect(appel.filtres).toEqual([
			['track_id', 't-1'],
			['deleted_at', null],
		])
	})
})

describe('lireWorkflowsAffectables (§7.2)', () => {
	it('exprime la règle du §4.12.2 dans le filtre, et non dans un tri en mémoire', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireWorkflowsAffectables(client, 'ws-1', 't-1')
		expect(appel.table).toBe('workflows')
		expect(appel.colonnes).toBe(COLONNES_WORKFLOW_AFFECTABLE)
		expect(appel.filtres).toEqual([['workspace_id', 'ws-1']])
		expect(appel.ou).toBe('scope.eq.global,and(scope.eq.track,track_id.eq.t-1)')
	})

	it('le filtre nomme exactement les deux cas autorisés, et aucun autre', () => {
		const filtre = filtreWorkflowsAffectables('t-9')
		expect(filtre).toBe('scope.eq.global,and(scope.eq.track,track_id.eq.t-9)')

		// Ce qui doit être tenu, et que l'égalité ci-dessus ne dit pas à elle seule : la portée
		// `track` n'apparaît JAMAIS sans être appariée au `track_id` du track ouvert. Un tel
		// disjoint laisserait passer le workflow `track` d'un AUTRE track, que le trigger
		// refuserait ensuite en `23514` — l'écran proposerait alors un choix voué au refus.
		const occurrences = [...filtre.matchAll(/scope\.eq\.track/g)]
		expect(occurrences).toHaveLength(1)
		for (const occurrence of occurrences) {
			expect(filtre.slice(occurrence.index)).toMatch(/^scope\.eq\.track,track_id\.eq\.t-9\)/)
		}
	})

	it('rend le workflow par défaut en tête, sans le présélectionner pour autant', async () => {
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireWorkflowsAffectables(client, 'ws-1', 't-1')
		expect(appel.tris).toEqual([
			['is_default', { ascending: false }],
			['name', undefined],
		])
	})
})

// ---------------------------------------------------------------------------------------------
// Écritures — la charge émise
// ---------------------------------------------------------------------------------------------

describe('creerTrack (§5.1)', () => {
	it('omet la position en l’envoyant à null, pour que le trigger la place en fin de liste', async () => {
		const { client, appel } = espionEcriture(OK)
		await creerTrack(client, {
			idWorkspace: 'ws-1',
			nom: 'Conseil & IA',
			slug: 'conseil-ia',
			couleur: 'brand',
			icone: 'sparkles',
			description: 'Prestations de conseil',
		})
		expect(appel.table).toBe('tracks')
		expect(appel.verbe).toBe('insert')
		expect(appel.charge).toEqual({
			workspace_id: 'ws-1',
			name: 'Conseil & IA',
			slug: 'conseil-ia',
			color: 'brand',
			icon: 'sparkles',
			description: 'Prestations de conseil',
			position: null,
		})
	})

	it('envoie une description vide à null, l’absence n’étant pas une chaîne vide', async () => {
		const { client, appel } = espionEcriture(OK)
		await creerTrack(client, {
			idWorkspace: 'ws-1',
			nom: 'X',
			slug: 'x',
			couleur: 'neutral',
			icone: 'folder',
			description: '   ',
		})
		expect(appel.charge?.description).toBeNull()
	})

	it('demande un corps en retour, sans quoi « zéro ligne » serait indistinguable d’un succès', async () => {
		const { client, appel } = espionEcriture(OK)
		await creerTrack(client, {
			idWorkspace: 'ws-1',
			nom: 'X',
			slug: 'x',
			couleur: 'neutral',
			icone: 'folder',
			description: '',
		})
		expect(appel.colonnesRendues).toBe('id')
	})

	it('traduit le refus de la politique d’écriture', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'row-level security', code: '42501' },
			status: 403,
		})
		const resultat = await creerTrack(client, {
			idWorkspace: 'ws-1',
			nom: 'X',
			slug: 'x',
			couleur: 'neutral',
			icone: 'folder',
			description: '',
		})
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'forbidden', detail: 'row-level security' },
		})
	})
})

describe('modifierTrack (§5.2, §5.3)', () => {
	it('modifie le nom, la couleur, l’icône et la description — et JAMAIS le slug', async () => {
		const { client, appel } = espionEcriture(OK)
		await modifierTrack(client, 't-1', {
			nom: 'Conseil',
			couleur: 'success',
			icone: 'folder',
			description: 'x',
		})
		expect(appel.verbe).toBe('update')
		expect(appel.charge).toEqual({
			name: 'Conseil',
			color: 'success',
			icon: 'folder',
			description: 'x',
		})
		// La base accepterait un `slug` : c'est l'écran qui ne l'expose pas (§5.3).
		expect(Object.keys(appel.charge ?? {})).not.toContain('slug')
		expect(appel.filtres).toEqual([['id', 't-1']])
	})

	it('traite le `200` à zéro ligne comme « sans effet », ni succès ni erreur', async () => {
		// Le `USING` de la politique a filtré la ligne : afficher un succès montrerait une
		// modification qui n'a pas eu lieu (§9, règle 2).
		const { client } = espionEcriture(ZERO_LIGNE)
		const resultat = await modifierTrack(client, 't-1', {
			nom: 'X',
			couleur: 'neutral',
			icone: 'folder',
			description: '',
		})
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})
})

describe('deplacerTrack et archiverTrack (§6)', () => {
	it('n’écrit QUE la position, sur une seule ligne', async () => {
		const { client, appel } = espionEcriture(OK)
		await deplacerTrack(client, 't-1', 1.5)
		expect(appel.charge).toEqual({ position: 1.5 })
		expect(appel.filtres).toEqual([['id', 't-1']])
	})

	it('archive en horodatant, désarchive en remettant null', async () => {
		const fige = () => '2026-08-11T12:00:00.000Z'
		const archive = espionEcriture(OK)
		await archiverTrack(archive.client, 't-1', true, fige)
		expect(archive.appel.charge).toEqual({ archived_at: '2026-08-11T12:00:00.000Z' })

		const desarchive = espionEcriture(OK)
		await archiverTrack(desarchive.client, 't-1', false, fige)
		expect(desarchive.appel.charge).toEqual({ archived_at: null })
	})
})

describe('creerChannel et modifierChannel (§7)', () => {
	it('envoie le workspace DU TRACK et le workflow choisi, jamais un défaut implicite', async () => {
		const { client, appel } = espionEcriture(OK)
		await creerChannel(client, {
			idWorkspace: 'ws-1',
			idTrack: 't-1',
			idWorkflow: 'wf-1',
			nom: 'Prospection',
			slug: 'prospection',
			description: '',
		})
		expect(appel.table).toBe('channels')
		expect(appel.charge).toEqual({
			workspace_id: 'ws-1',
			track_id: 't-1',
			workflow_id: 'wf-1',
			name: 'Prospection',
			slug: 'prospection',
			description: null,
			position: null,
		})
	})

	it('traduit le refus du trigger d’affectation en un message qui lui est propre', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'workflow_hors_track', code: '23514' },
			status: 400,
		})
		const resultat = await creerChannel(client, {
			idWorkspace: 'ws-1',
			idTrack: 't-1',
			idWorkflow: 'wf-autre',
			nom: 'X',
			slug: 'x',
			description: '',
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('workflow-hors-track')
	})

	it('traduit la clé étrangère composite en « référence absente »', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'channels_track_id_workspace_id_fkey', code: '23503' },
			status: 409,
		})
		const resultat = await creerChannel(client, {
			idWorkspace: 'ws-autre',
			idTrack: 't-1',
			idWorkflow: 'wf-1',
			nom: 'X',
			slug: 'x',
			description: '',
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('reference-absente')
	})

	it('change le workflow d’un channel existant, ce que l’énoncé de CRM-075 demande', async () => {
		const { client, appel } = espionEcriture(OK)
		await modifierChannel(client, 'c-1', { nom: 'X', description: '', idWorkflow: 'wf-2' })
		expect(appel.charge).toEqual({ name: 'X', description: null, workflow_id: 'wf-2' })
	})

	it('archive un channel comme un track', async () => {
		const { client, appel } = espionEcriture(OK)
		await archiverChannel(client, 'c-1', true, () => '2026-08-11T12:00:00.000Z')
		expect(appel.table).toBe('channels')
		expect(appel.charge).toEqual({ archived_at: '2026-08-11T12:00:00.000Z' })
	})
})

describe('aucune écriture ne lève', () => {
	it('rend une exception de transport comme un refus classé', async () => {
		const resultat = await creerTrack(clientQuiLeve(new Error('coupure')), {
			idWorkspace: 'ws-1',
			nom: 'X',
			slug: 'x',
			couleur: 'neutral',
			icone: 'folder',
			description: '',
		})
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'network', detail: 'coupure' },
		})
	})
})

describe('mettreTrackALaCorbeille et mettreChannelALaCorbeille (CRM-077, §4 bis)', () => {
	it('écrit `deleted_at` sur le SEUL objet visé, et demande la ligne en retour', async () => {
		const { client, appel } = espionEcriture(OK)
		await mettreTrackALaCorbeille(client, 't-1', () => '2026-08-15T10:00:00.000Z')
		expect(appel.table).toBe('tracks')
		expect(appel.verbe).toBe('update')
		expect(appel.filtres).toEqual([['id', 't-1']])
		expect(appel.colonnesRendues).toBe('id')
	})

	// LA CHARGE EST FIGÉE À UNE SEULE CLÉ, et c'est la moitié utile de ce fichier pour ce geste :
	// `deleted_by` est fermée au client par le privilège de colonne de `0037`, et l'ajouter ferait
	// refuser TOUTE l'écriture en `42501` (§4 bis.5). `archived_at` n'y est pas non plus — les deux
	// états sont indépendants (§3.1), et retirer un objet ne l'archive pas au passage.
	it('n’envoie QUE `deleted_at` : ni l’audit, fermé au client, ni l’archivage', async () => {
		const { client, appel } = espionEcriture(OK)
		await mettreTrackALaCorbeille(client, 't-1', () => '2026-08-15T10:00:00.000Z')
		expect(appel.charge).toEqual({ deleted_at: '2026-08-15T10:00:00.000Z' })
	})

	it('met un channel à la corbeille sur le même patron', async () => {
		const { client, appel } = espionEcriture(OK)
		await mettreChannelALaCorbeille(client, 'c-1', () => '2026-08-15T10:00:00.000Z')
		expect(appel.table).toBe('channels')
		expect(appel.charge).toEqual({ deleted_at: '2026-08-15T10:00:00.000Z' })
		expect(appel.filtres).toEqual([['id', 'c-1']])
	})

	// MESURÉ le 2026-08-15 : le business developer et la lectrice reçoivent `200` et `[]`, la clause
	// `USING` de `tracks_maj_admin` filtrant la ligne avant la mise à jour (décision 70). Ce n'est ni
	// un succès ni une erreur, et le confondre avec un succès annoncerait un retrait qui n'a pas eu
	// lieu — le défaut que `ResultatEcriture` traite déjà pour les autres gestes de cet écran.
	it('rend `sans-effet` sur `200` et zéro ligne : le refus de DROIT ne lève aucune erreur', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect(await mettreTrackALaCorbeille(client, 't-1')).toEqual({ statut: 'sans-effet' })
	})

	it('classe un refus de transport plutôt que de laisser une exception remonter', async () => {
		const resultat = await mettreChannelALaCorbeille(clientQuiLeve(new Error('coupure')), 'c-1')
		expect(resultat).toEqual({ statut: 'refus', refus: { nature: 'network', detail: 'coupure' } })
	})
})
