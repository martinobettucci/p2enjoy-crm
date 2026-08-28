// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la géométrie ;
//           tranche 2b-1 : le contenu ; tranche 2b-2a : le lien vers un channel ;
//           tranche 2b-2b : les flèches — le tracé et la correction de sa direction ;
//           tranche 2b-2c : les suppressions — une flèche, un bloc ;
//           tranche 2c : les tableaux — créer, renommer, réordonner, archiver
// @verifies docs/SPEC-goals.md §2.1 (le tableau : nom unique par workspace après normalisation,
//           `position` attribuée par TRIGGER lorsqu'elle est omise, l'archivage tient lieu de
//           suppression)
// @verifies docs/SPEC-goals.md §3 (poser un bloc — la position vient du GESTE ; déplacer et
//           redimensionner — persiste `pos_x`, `pos_y`, `width`, `height` ; tracer une flèche avec
//           le choix de sa direction, modifiable ensuite ; supprimer une flèche, supprimer un bloc
//           — la suppression d'un bloc emporte ses flèches par CASCADE), §2.2 (colonnes),
//           §2.3 (trois directions jamais normalisées en deux ; unicité de la paire ;
//           `on delete cascade` des deux extrémités), §2.4 (`board_id` gardé par un trigger),
//           §4.2 (l'écriture est décidée par la base, jamais par l'écran ; une flèche exige le
//           droit d'écrire les DEUX blocs qu'elle relie)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus filtré par `using` est zéro ligne, pas une
//           erreur)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (gestes de géométrie du canevas)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue. Deux
// exigences de la spécification ne vivent que dans la requête, et aucune assertion de valeur ne
// les attraperait :
//
//   * un déplacement n'envoie PAS de taille, et un redimensionnement n'envoie PAS de position —
//     écrire les quatre colonnes à chaque geste écraserait celles qu'un collègue vient de changer ;
//   * un bloc neuf n'envoie AUCUN `channel_id` : poser un lien exige `app.can_write_channel`
//     (§4.2), c'est un geste distinct.
//
// La troisième issue — `200` avec zéro ligne, produite par la clause `using` — est éprouvée
// CONTRE SON SUCCÈS : une implémentation qui rendrait « enregistrée » sur une réponse vide
// passerait tous les autres cas de ce fichier.

import { describe, expect, it } from 'vitest'
import {
	CODE_INTERDIT,
	CODE_SAISIE_INVALIDE,
	COULEURS_BLOC,
	PAS_CLAVIER,
	PAS_CLAVIER_FIN,
	REMPLISSAGE_MAXIMAL,
	REMPLISSAGE_MINIMAL,
	TAILLE_BLOC_MINIMALE,
	TAILLE_BLOC_NEUF,
	blocDepuisLigne,
	bornerCoordonnee,
	bornerDimension,
	bornerRemplissage,
	changerDirectionFleche,
	classerRefusBloc,
	classerRefusFleche,
	CODE_DOUBLON,
	ecrireContenuBloc,
	ecrireGeometrieBloc,
	grouperChannelsParTrack,
	lierBlocAChannel,
	lireChannelsLiables,
	poserBloc,
	supprimerBloc,
	supprimerFleche,
	tracerFleche,
	archiverTableau,
	desarchiverTableau,
	classerRefusTableau,
	creerTableau,
	deplacerTableau,
	renommerTableau,
} from './objectifs-ecriture'
import { calculerDeplacement, deplacementPossible } from './administration-arborescence'
import { COLONNES_BLOC, COLONNES_FLECHE, COLONNES_TABLEAU } from './objectifs'
import type { ClientCrm } from './supabase'

const ID_TABLEAU = '5eed0000-0000-4000-8000-0000000000b1'
const ID_BLOC = '5eed0000-0000-4000-8000-0000000000b2'

/** Une ligne telle que PostgREST la rend, avec l'imbrication du channel. */
function ligneRendue(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ID_BLOC,
		title: 'Nouvel objectif',
		body: null,
		fill_percent: 0,
		channel_id: null,
		pos_x: 120,
		pos_y: 64,
		width: TAILLE_BLOC_NEUF.largeur,
		height: TAILLE_BLOC_NEUF.hauteur,
		color: 'brand',
		channels: null,
		...surcharge,
	}
}

type AppelEcriture = {
	table?: string
	operation?: 'insert' | 'update' | 'delete'
	charge?: Record<string, unknown>
	filtres: string[]
	colonnes?: string
}

function espion(reponse: {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelEcriture } {
	const appel: AppelEcriture = { filtres: [] }
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push(`eq(${colonne},${String(valeur)})`)
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return chaine
		},
		then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
		single: () =>
			Promise.resolve({
				...reponse,
				data: reponse.data === null ? null : (reponse.data[0] ?? null),
			}),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.operation = 'insert'
					appel.charge = charge
					return chaine
				},
				update: (charge: Record<string, unknown>) => {
					appel.operation = 'update'
					appel.charge = charge
					return chaine
				},
				// UNE SUPPRESSION NE PORTE AUCUNE CHARGE, et l'espion le rend visible : `charge`
				// reste indéfinie, ce qui permet d'éprouver qu'aucune flèche n'est nommée avant le
				// bloc — la cascade vit en base (docs/SPEC-goals.md §2.3).
				delete: () => {
					appel.operation = 'delete'
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('bornes du geste', () => {
	it('ramène une coordonnée négative à l’origine du canevas', () => {
		// Un bloc posé hors de l'étendue serait rendu en dehors de la surface défilable, donc
		// inatteignable à la souris COMME au clavier.
		expect(bornerCoordonnee(-40)).toBe(0)
		expect(bornerCoordonnee(0)).toBe(0)
	})

	it('arrondit à l’unité : un demi-pixel de canevas n’est pas une position', () => {
		expect(bornerCoordonnee(17.6)).toBe(18)
	})

	it('tient la taille minimale du GESTE, sans jamais la descendre', () => {
		expect(bornerDimension(10, TAILLE_BLOC_MINIMALE.largeur)).toBe(TAILLE_BLOC_MINIMALE.largeur)
		expect(bornerDimension(300, TAILLE_BLOC_MINIMALE.largeur)).toBe(300)
	})

	it('propose deux pas clavier distincts, sans quoi le clavier n’atteindrait pas ce que la souris atteint', () => {
		expect(PAS_CLAVIER).toBeGreaterThan(PAS_CLAVIER_FIN)
		expect(PAS_CLAVIER_FIN).toBe(1)
	})
})

describe('classerRefusBloc', () => {
	it('classe une contrainte de forme sur son CODE, avant tout statut', () => {
		expect(classerRefusBloc(400, CODE_SAISIE_INVALIDE, 'titre vide').nature).toBe('saisie-invalide')
	})

	it('classe le refus d’une politique sur son code, y compris derrière un statut inattendu', () => {
		expect(classerRefusBloc(400, CODE_INTERDIT, 'row-level security').nature).toBe('interdit')
	})

	it('classe un 403 sans code comme un interdit', () => {
		expect(classerRefusBloc(403, undefined, 'forbidden').nature).toBe('interdit')
	})

	it('replie tout le reste sur « indisponible » plutôt que d’inventer une cause', () => {
		expect(classerRefusBloc(500, undefined, 'boom').nature).toBe('indisponible')
		expect(classerRefusBloc(undefined, undefined, 'réseau').nature).toBe('indisponible')
	})

	it('conserve le détail pour le diagnostic, jamais pour l’écran', () => {
		expect(classerRefusBloc(500, undefined, 'boom').detail).toBe('boom')
	})
})

describe('blocDepuisLigne', () => {
	it('retire l’imbrication de la ligne et la traduit en destination', () => {
		const bloc = blocDepuisLigne(
			ligneRendue({
				channel_id: 'c1',
				channels: {
					id: 'c1',
					name: 'Refonte de site',
					slug: 'refonte',
					deleted_at: null,
					tracks: { name: 'Studio web', slug: 'studio-web', deleted_at: null },
				},
			}),
		)
		expect(bloc.destination?.nom).toBe('Refonte de site')
		expect(bloc.destination?.track?.slug).toBe('studio-web')
		// La clé brute de PostgREST ne doit jamais fuir vers l'écran.
		expect(Object.keys(bloc)).not.toContain('channels')
	})
})

describe('poserBloc', () => {
	it('envoie la position DU GESTE, la taille d’un bloc neuf, et AUCUN channel', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 201 })
		const resultat = await poserBloc(client, {
			idTableau: ID_TABLEAU,
			x: 120.4,
			y: 64,
			titre: '  Nouvel objectif  ',
		})

		expect(appel.table).toBe('goal_blocks')
		expect(appel.operation).toBe('insert')
		expect(appel.charge).toEqual({
			board_id: ID_TABLEAU,
			title: 'Nouvel objectif',
			pos_x: 120,
			pos_y: 64,
			width: TAILLE_BLOC_NEUF.largeur,
			height: TAILLE_BLOC_NEUF.hauteur,
		})
		// §4.2 : poser un lien exige `app.can_write_channel`, c'est un geste distinct.
		expect(appel.charge).not.toHaveProperty('channel_id')
		// §1 : rien n'est dérivé, `fill_percent` n'est même pas envoyé — la base pose son défaut.
		expect(appel.charge).not.toHaveProperty('fill_percent')
		expect(appel.colonnes).toBe(COLONNES_BLOC)
		expect(resultat.statut).toBe('cree')
	})

	it('borne la position à l’origine plutôt que de poser un bloc hors du canevas', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 201 })
		await poserBloc(client, { idTableau: ID_TABLEAU, x: -12, y: -3, titre: 'x' })
		expect(appel.charge?.pos_x).toBe(0)
		expect(appel.charge?.pos_y).toBe(0)
	})

	it('traduit un refus de politique sans jamais rendre le message du serveur', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'new row violates row-level security policy', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await poserBloc(client, { idTableau: ID_TABLEAU, x: 0, y: 0, titre: 'x' })
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'interdit', detail: 'new row violates row-level security policy' },
		})
	})
})

describe('ecrireGeometrieBloc', () => {
	it('un DÉPLACEMENT n’envoie que la position — jamais la taille', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { x: 40, y: 80 })

		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ pos_x: 40, pos_y: 80 })
		expect(appel.filtres).toEqual([`eq(id,${ID_BLOC})`])
	})

	it('un REDIMENSIONNEMENT n’envoie que la taille — jamais la position', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 300, hauteur: 200 })
		expect(appel.charge).toEqual({ width: 300, height: 200 })
	})

	it('borne la taille envoyée au minimum du geste', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 4, hauteur: 4 })
		expect(appel.charge).toEqual({
			width: TAILLE_BLOC_MINIMALE.largeur,
			height: TAILLE_BLOC_MINIMALE.hauteur,
		})
	})

	it('demande la ligne rendue, sans quoi « zéro ligne » serait indistinguable d’un succès', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { x: 1, y: 1 })
		expect(appel.colonnes).toBe(COLONNES_BLOC)
	})

	it('rend « sans-effet » sur une réponse aboutie de ZÉRO ligne, jamais un succès', async () => {
		// C'est la troisième issue, et elle est STRUCTURELLE : la clause `using` d'une politique
		// rend la ligne invisible à l'écriture, si bien que le serveur répond 200 sans erreur.
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 1, y: 1 })
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})

	it('rend la ligne du serveur sur un succès, pour que l’écran n’ait pas à relire', async () => {
		const { client } = espion({ data: [ligneRendue({ pos_x: 40, pos_y: 80 })], error: null, status: 200 })
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 40, y: 80 })
		expect(resultat.statut).toBe('enregistree')
		if (resultat.statut !== 'enregistree') return
		expect(resultat.bloc.pos_x).toBe(40)
		expect(resultat.bloc.pos_y).toBe(80)
	})

	it('traduit une contrainte de forme violée en refus, et ne lève jamais', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'violates check constraint', code: CODE_SAISIE_INVALIDE },
			status: 400,
		})
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 300 })
		expect(resultat.statut).toBe('refus')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 1 })
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'indisponible', detail: 'réseau coupé' },
		})
	})
})

// --- TRANCHE 2b-1 : LE CONTENU ------------------------------------------------------------
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-1 : le contenu
// @verifies docs/SPEC-goals.md §3 (saisir titre, corps, couleur ; régler le remplissage —
//           curseur ET champ numérique écrivant la MÊME valeur), §2.2 (bornes des colonnes),
//           §1 (le remplissage est SAISI, jamais calculé)
// @verifies docs/DESIGN_SYSTEM.md §5.7 ter (un champ s'enregistre pour lui-même), §5.29 (fiche)
//
// COMME POUR LA GÉOMÉTRIE, CE SONT LES COLONNES ENVOYÉES QUI SONT ÉPROUVÉES, et pas seulement la
// valeur rendue : un champ qui renverrait les quatre colonnes à chaque saisie écraserait ce qu'un
// collègue vient d'écrire dans un autre champ du même bloc.

describe('bornerRemplissage', () => {
	it('rend un ENTIER : `fill_percent` est un smallint, et une décimale suggérerait un calcul', () => {
		expect(bornerRemplissage(60.4)).toBe(60)
		expect(bornerRemplissage('60,5'.replace(',', '.'))).toBe(61)
	})

	it('borne aux deux extrémités de `goal_blocks_fill_percent_check`', () => {
		expect(bornerRemplissage(-10)).toBe(REMPLISSAGE_MINIMAL)
		expect(bornerRemplissage(140)).toBe(REMPLISSAGE_MAXIMAL)
	})

	it('rend `null` sur une saisie illisible, JAMAIS zéro', () => {
		// Zéro est une valeur — « finalement rien fait » —, et l'écrire à la place d'un champ vidé
		// serait la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
		expect(bornerRemplissage('')).toBeNull()
		expect(bornerRemplissage('   ')).toBeNull()
		expect(bornerRemplissage('soixante')).toBeNull()
		expect(bornerRemplissage(Number.NaN)).toBeNull()
		expect(bornerRemplissage(0)).toBe(0)
	})
})

describe('ecrireContenuBloc', () => {
	it('n’envoie QUE le champ saisi : un titre ne réécrit ni le corps, ni la couleur, ni le remplissage', async () => {
		const { client, appel } = espion({ data: [ligneRendue({ title: 'Doubler le MRR' })], error: null, status: 200 })
		await ecrireContenuBloc(client, ID_BLOC, { titre: 'Doubler le MRR' })
		expect(appel.operation).toBe('update')
		expect(appel.table).toBe('goal_blocks')
		expect(Object.keys(appel.charge ?? {})).toEqual(['title'])
		expect(appel.filtres).toEqual([`eq(id,${ID_BLOC})`])
		expect(appel.colonnes).toBe(COLONNES_BLOC)
	})

	it('débarrasse le titre de ses espaces de bord, comme à la pose', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireContenuBloc(client, ID_BLOC, { titre: '  Doubler le MRR  ' })
		expect(appel.charge?.title).toBe('Doubler le MRR')
	})

	it('N’ANTICIPE PAS le refus d’un titre vide : il part, et c’est la base qui refuse', async () => {
		// `CLAUDE.md` §10 — la règle réelle vit dans `goal_blocks_titre_check`. La filtrer ici
		// ferait diverger l'écran de la base au premier changement de contrainte.
		const { client, appel } = espion({
			data: null,
			error: { message: 'violates check constraint', code: CODE_SAISIE_INVALIDE },
			status: 400,
		})
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { titre: '   ' })
		expect(appel.charge?.title).toBe('')
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('saisie-invalide')
	})

	it('ramène un corps vidé à `null`, pour que « pas de corps » n’ait qu’une seule représentation', async () => {
		const { client, appel } = espion({ data: [ligneRendue({ body: null })], error: null, status: 200 })
		await ecrireContenuBloc(client, ID_BLOC, { corps: '   ' })
		expect(appel.charge?.body).toBeNull()
	})

	it('envoie la couleur TELLE QUELLE : une valeur hors énumération est refusée par la base', async () => {
		const { client, appel } = espion({
			data: null,
			error: { message: 'violates check constraint', code: CODE_SAISIE_INVALIDE },
			status: 400,
		})
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { couleur: 'fuchsia' })
		expect(appel.charge?.color).toBe('fuchsia')
		expect(resultat.statut).toBe('refus')
	})

	it('rend la ligne du serveur, destination traduite comprise', async () => {
		const { client } = espion({
			data: [ligneRendue({ fill_percent: 60, color: 'success' })],
			error: null,
			status: 200,
		})
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { remplissage: 60 })
		expect(resultat.statut).toBe('enregistree')
		if (resultat.statut !== 'enregistree') return
		expect(resultat.bloc.fill_percent).toBe(60)
		expect(resultat.bloc.color).toBe('success')
		expect(resultat.bloc.destination).toBeNull()
	})

	it('rend « sans-effet » sur zéro ligne — le silence de la clause `using`, ni succès ni erreur', async () => {
		// Éprouvé CONTRE SON SUCCÈS : une implémentation qui annoncerait « enregistrée » sur une
		// réponse vide passerait tous les autres cas de ce bloc.
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { titre: 'Doubler le MRR' })
		expect(resultat.statut).toBe('sans-effet')
	})

	it('traduit un refus de politique en `interdit`', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { couleur: 'danger' })
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await ecrireContenuBloc(client, ID_BLOC, { titre: 'Doubler le MRR' })
		expect(resultat.statut).toBe('refus')
	})

	it('offre les cinq couleurs de jeton du §2.2, et rien d’autre', async () => {
		expect([...COULEURS_BLOC]).toEqual(['brand', 'success', 'accent', 'danger', 'neutral'])
	})
})

// --- Tranche 2b-2a : le LIEN d'un bloc vers un channel -------------------------------------
// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2b-2a : lier un bloc à un
//           channel, et retirer ce lien
// @verifies docs/SPEC-goals.md §3 (sélecteur des channels LISIBLES par l'appelant, groupés par
//           track ; retirer le lien remet `channel_id` à nul), §4.2 (poser le lien exige
//           `app.can_write_channel`, le retirer non — l'écran n'anticipe NI l'un NI l'autre),
//           §2.2 (`channel_id` facultatif)

/** Espion de LECTURE : la chaîne du sélecteur emploie `is` et `order`, que l'espion d'écriture ignore. */
function espionLecture(reponse: {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: { table?: string; colonnes?: string; filtres: string[] } } {
	const appel: { table?: string; colonnes?: string; filtres: string[] } = { filtres: [] }
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push(`eq(${colonne},${String(valeur)})`)
			return chaine
		},
		is: (colonne: string, valeur: unknown) => {
			appel.filtres.push(`is(${colonne},${String(valeur)})`)
			return chaine
		},
		order: (colonne: string) => {
			appel.filtres.push(`order(${colonne})`)
			return chaine
		},
		then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
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

const ID_WORKSPACE = '5eed0000-0000-4000-8000-0000000000a1'
const ID_CHANNEL = '5eed0000-0000-4000-8000-0000000000c1'

describe('lireChannelsLiables', () => {
	it('écarte les channels ARCHIVÉS et ceux de la CORBEILLE, côté serveur', async () => {
		// Une destination en corbeille rendrait immédiatement l'état « lien perdu » du §5.4 : la
		// proposer reviendrait à offrir un lien qui naît cassé. Le filtre est dans la requête, et
		// non dans un tri d'écran qui ferait transiter des lignes jamais montrées.
		const { client, appel } = espionLecture({ data: [], error: null, status: 200 })
		await lireChannelsLiables(client, ID_WORKSPACE)
		expect(appel.table).toBe('channels')
		expect(appel.filtres).toContain(`eq(workspace_id,${ID_WORKSPACE})`)
		expect(appel.filtres).toContain('is(archived_at,null)')
		expect(appel.filtres).toContain('is(deleted_at,null)')
	})

	it('traduit l’imbrication du track, qu’elle soit objet ou tableau d’un élément', async () => {
		const { client } = espionLecture({
			data: [
				{ id: ID_CHANNEL, name: 'Refonte', tracks: { id: 'tr-1', name: 'Studio web' } },
				{ id: 'ch-2', name: 'Audit', tracks: [{ id: 'tr-1', name: 'Studio web' }] },
			],
			error: null,
			status: 200,
		})
		const etat = await lireChannelsLiables(client, ID_WORKSPACE)
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees[0]).toEqual({ id: ID_CHANNEL, nom: 'Refonte', track: { id: 'tr-1', nom: 'Studio web' } })
		expect(etat.donnees[1]?.track).toEqual({ id: 'tr-1', nom: 'Studio web' })
	})

	it('garde le channel dont le TRACK n’est pas rendu, sans lui inventer de parent', async () => {
		// L'appelant lit ce channel : il a donc le droit de le viser. Le faire disparaître du
		// sélecteur parce que son parent n'est pas lisible lui retirerait une destination légitime
		// sans jamais le dire.
		const { client } = espionLecture({
			data: [{ id: ID_CHANNEL, name: 'Refonte', tracks: null }],
			error: null,
			status: 200,
		})
		const etat = await lireChannelsLiables(client, ID_WORKSPACE)
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees[0]?.track).toBeNull()
	})

	it('rend une erreur plutôt que de lever, et ne rend jamais une liste vide à sa place', async () => {
		// Éprouvé CONTRE SON SUCCÈS : une implémentation qui rendrait `pret([])` sur une erreur
		// ferait dire au sélecteur « aucun channel à viser », ce qui est un mensonge.
		const { client } = espionLecture({ data: null, error: { message: 'coupure' }, status: 500 })
		const etat = await lireChannelsLiables(client, ID_WORKSPACE)
		expect(etat.statut).toBe('erreur')
	})
})

describe('grouperChannelsParTrack', () => {
	const studio = { id: 'tr-1', nom: 'Studio web' }
	const grands = { id: 'tr-2', nom: 'Grands comptes' }

	it('groupe par track en conservant l’ordre du SERVEUR, sans retrier', () => {
		// La requête ordonne déjà par `position` puis par nom ; rejouer ce tri ici le ferait
		// diverger le jour où la requête changera.
		const groupes = grouperChannelsParTrack([
			{ id: 'c1', nom: 'Refonte', track: studio },
			{ id: 'c2', nom: 'Appel d’offres', track: grands },
			{ id: 'c3', nom: 'Audit', track: studio },
		])
		expect(groupes.map((groupe) => groupe.nomTrack)).toEqual(['Studio web', 'Grands comptes'])
		expect(groupes[0]?.channels.map((channel) => channel.nom)).toEqual(['Refonte', 'Audit'])
		expect(groupes[1]?.channels.map((channel) => channel.nom)).toEqual(['Appel d’offres'])
	})

	it('range les channels SANS track dans un groupe anonyme, placé en dernier', () => {
		const groupes = grouperChannelsParTrack([
			{ id: 'c1', nom: 'Orphelin', track: null },
			{ id: 'c2', nom: 'Refonte', track: studio },
		])
		expect(groupes.map((groupe) => groupe.nomTrack)).toEqual(['Studio web', null])
		expect(groupes[1]?.channels.map((channel) => channel.nom)).toEqual(['Orphelin'])
	})

	it('ne perd aucun channel', () => {
		const channels = [
			{ id: 'c1', nom: 'Refonte', track: studio },
			{ id: 'c2', nom: 'Orphelin', track: null },
			{ id: 'c3', nom: 'Appel d’offres', track: grands },
		]
		const groupes = grouperChannelsParTrack(channels)
		expect(groupes.flatMap((groupe) => groupe.channels)).toHaveLength(channels.length)
	})

	it('rend une liste vide sur une entrée vide, jamais un groupe fantôme', () => {
		expect(grouperChannelsParTrack([])).toEqual([])
	})
})

describe('lierBlocAChannel', () => {
	it('n’envoie QUE `channel_id`, jamais les colonnes de contenu ou de géométrie', async () => {
		// C'est la règle que les tranches 2a et 2b-1 ont posée deux fois : renvoyer les colonnes
		// voisines écraserait ce qu'un collègue vient d'y écrire.
		const { client, appel } = espion({ data: [ligneRendue({ channel_id: ID_CHANNEL })], error: null, status: 200 })
		await lierBlocAChannel(client, ID_BLOC, ID_CHANNEL)
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ channel_id: ID_CHANNEL })
		expect(appel.filtres).toContain(`eq(id,${ID_BLOC})`)
		expect(appel.colonnes).toBe(COLONNES_BLOC)
	})

	it('retire le lien en envoyant `null`, et non en omettant la colonne', async () => {
		// Omettre la colonne n'écrirait RIEN : le lien resterait en place, et l'écran annoncerait
		// pourtant un retrait — la simulation de succès que `CLAUDE.md` §18 interdit.
		const { client, appel } = espion({ data: [ligneRendue({ channel_id: null })], error: null, status: 200 })
		const resultat = await lierBlocAChannel(client, ID_BLOC, null)
		expect(appel.charge).toEqual({ channel_id: null })
		expect(resultat.statut).toBe('enregistree')
	})

	it('rend la ligne du serveur avec sa destination TRADUITE', async () => {
		const { client } = espion({
			data: [
				ligneRendue({
					channel_id: ID_CHANNEL,
					channels: {
						id: ID_CHANNEL,
						name: 'Refonte',
						slug: 'refonte',
						deleted_at: null,
						tracks: { name: 'Studio web', slug: 'studio-web', deleted_at: null },
					},
				}),
			],
			error: null,
			status: 200,
		})
		const resultat = await lierBlocAChannel(client, ID_BLOC, ID_CHANNEL)
		expect(resultat.statut).toBe('enregistree')
		if (resultat.statut !== 'enregistree') return
		expect(resultat.bloc.destination?.nom).toBe('Refonte')
		expect(resultat.bloc.destination?.track?.nom).toBe('Studio web')
	})

	it('traduit en `interdit` le refus de `app.can_write_channel`, sans jamais l’anticiper', async () => {
		// §4.2 : poser un lien exige l'écriture sur la DESTINATION. Cette règle vit dans la clause
		// `with check` de la politique ; le module envoie et traduit.
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await lierBlocAChannel(client, ID_BLOC, ID_CHANNEL)
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})

	it('rend « sans-effet » sur zéro ligne — le silence de la clause `using`', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await lierBlocAChannel(client, ID_BLOC, ID_CHANNEL)
		expect(resultat.statut).toBe('sans-effet')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await lierBlocAChannel(client, ID_BLOC, ID_CHANNEL)
		expect(resultat.statut).toBe('refus')
	})
})

// -------------------------------------------------------------------------------------------------
// Tranche 2b-2b — les flèches
// -------------------------------------------------------------------------------------------------

const ID_SOURCE = '5eed0000-0000-4000-8000-0000000000c1'
const ID_CIBLE = '5eed0000-0000-4000-8000-0000000000c2'
const ID_FLECHE = '5eed0000-0000-4000-8000-0000000000c3'

/** Une flèche telle que PostgREST la rend. */
function ligneFleche(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ID_FLECHE,
		source_block_id: ID_SOURCE,
		target_block_id: ID_CIBLE,
		direction: 'forward',
		label: null,
		...surcharge,
	}
}

describe('classerRefusFleche', () => {
	it('donne au doublon SA nature, et non celle d’une saisie invalide', () => {
		// §2.3 : « changer la direction d'une flèche existante est une modification, pas un
		// ajout ». Le geste qui suit ce refus n'est donc pas de réessayer, et un texte générique
		// enverrait retenter indéfiniment le même geste.
		expect(classerRefusFleche(409, CODE_DOUBLON, 'duplicate key').nature).toBe('doublon')
	})

	it('classe la boucle et le trigger de tableau en `saisie-invalide`, tous deux en `23514`', () => {
		expect(classerRefusFleche(400, CODE_SAISIE_INVALIDE, 'goal_links_boucle_check').nature).toBe('saisie-invalide')
	})

	it('classe le refus de politique en `interdit`, par le CODE avant le statut', () => {
		expect(classerRefusFleche(200, CODE_INTERDIT, 'row-level security').nature).toBe('interdit')
	})

	it('garde le doublon quand un statut d’interdiction l’accompagne — L’ORDRE est la règle', () => {
		// AJOUTÉ PARCE QUE LE HARNAIS L'A TROUVÉ MANQUANT (`scripts/verify-objectifs-canevas.sh`,
		// dégradation « le statut HTTP est classé avant le code PostgreSQL ») : la suite pinçait
		// bien l'ordre pour `42501`, jamais pour `23505`. Remonter la branche HTTP au-dessus du
		// doublon ne rendait donc AUCUNE preuve rouge, alors que la règle du module est écrite
		// « le code PostgreSQL D'ABORD, le statut HTTP ensuite ».
		//
		// La paire est délibérément CONTRADICTOIRE — c'est le seul montage où l'ordre devienne
		// observable, et c'est l'idiome déjà employé par le scénario ci-dessus, qui associe un
		// `200` à un code d'erreur pour la même raison. Ce que la preuve défend n'est pas une
		// réponse que PostgREST émettrait telle quelle, c'est la PRÉCÉDENCE du classifieur : deux
		// causes qui appellent des gestes opposés — corriger la flèche déjà tracée, ou renoncer —
		// peuvent partager un statut, jamais un code (§2.3).
		expect(classerRefusFleche(403, CODE_DOUBLON, 'duplicate key').nature).toBe('doublon')
	})

	it('retombe sur `indisponible` quand rien ne se reconnaît', () => {
		expect(classerRefusFleche(500, undefined, 'boom').nature).toBe('indisponible')
	})
})

describe('tracerFleche', () => {
	it('envoie `board_id` avec les deux blocs, la garde restant au trigger de la base', async () => {
		// §2.4 : la colonne est `not null` et un trigger `security definer` refuse une flèche dont
		// un bloc n'appartient pas à ce tableau. La déduire ici ferait de l'écran la garde.
		const { client, appel } = espion({ data: [ligneFleche()], error: null, status: 200 })
		await tracerFleche(client, {
			idTableau: ID_TABLEAU,
			idSource: ID_SOURCE,
			idCible: ID_CIBLE,
			direction: 'forward',
		})
		expect(appel.table).toBe('goal_links')
		expect(appel.operation).toBe('insert')
		expect(appel.charge).toEqual({
			board_id: ID_TABLEAU,
			source_block_id: ID_SOURCE,
			target_block_id: ID_CIBLE,
			direction: 'forward',
		})
		expect(appel.colonnes).toBe(COLONNES_FLECHE)
	})

	it('envoie `backward` TEL QUEL, sans l’inverser en `forward` aux extrémités échangées', async () => {
		// §2.3 : normaliser en deux directions ferait « sauter » la flèche au rechargement, dans
		// l'autre sens que celui où elle a été tracée.
		const { client, appel } = espion({ data: [ligneFleche({ direction: 'backward' })], error: null, status: 200 })
		await tracerFleche(client, {
			idTableau: ID_TABLEAU,
			idSource: ID_SOURCE,
			idCible: ID_CIBLE,
			direction: 'backward',
		})
		expect(appel.charge).toEqual({
			board_id: ID_TABLEAU,
			source_block_id: ID_SOURCE,
			target_block_id: ID_CIBLE,
			direction: 'backward',
		})
	})

	it('traduit le doublon plutôt que de l’anticiper', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'duplicate key value', code: CODE_DOUBLON },
			status: 409,
		})
		const resultat = await tracerFleche(client, {
			idTableau: ID_TABLEAU,
			idSource: ID_SOURCE,
			idCible: ID_CIBLE,
			direction: 'both',
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('doublon')
	})

	it('rend la flèche du serveur, direction normalisée', async () => {
		const { client } = espion({ data: [ligneFleche({ direction: 'inconnue' })], error: null, status: 200 })
		const resultat = await tracerFleche(client, {
			idTableau: ID_TABLEAU,
			idSource: ID_SOURCE,
			idCible: ID_CIBLE,
			direction: 'forward',
		})
		expect(resultat.statut).toBe('tracee')
		if (resultat.statut !== 'tracee') return
		expect(resultat.fleche.direction).toBe('forward')
		expect(resultat.fleche.source_block_id).toBe(ID_SOURCE)
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await tracerFleche(client, {
			idTableau: ID_TABLEAU,
			idSource: ID_SOURCE,
			idCible: ID_CIBLE,
			direction: 'forward',
		})
		expect(resultat.statut).toBe('refus')
	})
})

describe('changerDirectionFleche', () => {
	it('n’envoie QUE la direction, et filtre sur la flèche', async () => {
		const { client, appel } = espion({ data: [ligneFleche({ direction: 'both' })], error: null, status: 200 })
		await changerDirectionFleche(client, ID_FLECHE, 'both')
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ direction: 'both' })
		expect(appel.filtres).toContain(`eq(id,${ID_FLECHE})`)
		expect(appel.colonnes).toBe(COLONNES_FLECHE)
	})

	it('rend « sans-effet » sur zéro ligne — l’appelant n’écrit pas l’un des deux blocs', async () => {
		// Éprouvé CONTRE son succès : une implémentation qui rendrait « enregistrée » sur une
		// réponse vide passerait tous les autres cas de ce bloc.
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await changerDirectionFleche(client, ID_FLECHE, 'both')
		expect(resultat.statut).toBe('sans-effet')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await changerDirectionFleche(client, ID_FLECHE, 'forward')
		expect(resultat.statut).toBe('refus')
	})
})

// -------------------------------------------------------------------------------------------------
// Tranche 2b-2c — les suppressions
// -------------------------------------------------------------------------------------------------

describe('supprimerBloc', () => {
	it('supprime la ligne du bloc et DEMANDE ce que le serveur a retiré', async () => {
		// `.select('id')` est ce qui donne son existence à l'issue « sans-effet » : sans lui,
		// PostgREST ne rend aucun corps et le silence de la clause `using` serait indistinguable
		// d'une suppression réussie.
		const { client, appel } = espion({ data: [{ id: ID_BLOC }], error: null, status: 200 })
		const resultat = await supprimerBloc(client, ID_BLOC)
		expect(appel.table).toBe('goal_blocks')
		expect(appel.operation).toBe('delete')
		expect(appel.filtres).toContain(`eq(id,${ID_BLOC})`)
		expect(appel.colonnes).toBe('id')
		expect(resultat.statut).toBe('supprime')
	})

	it('NE NOMME AUCUNE FLÈCHE : la cascade vit en base', async () => {
		// §2.3 : `source_block_id` et `target_block_id` sont `on delete cascade`. Retirer les
		// flèches une à une avant le bloc ferait de l'écran la garde d'une règle du schéma, et
		// laisserait un état incohérent si la seconde requête échouait.
		const { client, appel } = espion({ data: [{ id: ID_BLOC }], error: null, status: 200 })
		await supprimerBloc(client, ID_BLOC)
		expect(appel.table).toBe('goal_blocks')
		expect(appel.charge).toBeUndefined()
	})

	it('rend « sans-effet » sur zéro ligne, et surtout pas « supprimé »', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await supprimerBloc(client, ID_BLOC)
		expect(resultat.statut).toBe('sans-effet')
	})

	it('traduit le refus de politique en `interdit`', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await supprimerBloc(client, ID_BLOC)
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await supprimerBloc(client, ID_BLOC)
		expect(resultat.statut).toBe('refus')
	})
})

describe('supprimerFleche', () => {
	it('supprime la ligne de la flèche, et ne touche à aucun bloc', async () => {
		const { client, appel } = espion({ data: [{ id: ID_FLECHE }], error: null, status: 200 })
		const resultat = await supprimerFleche(client, ID_FLECHE)
		expect(appel.table).toBe('goal_links')
		expect(appel.operation).toBe('delete')
		expect(appel.filtres).toContain(`eq(id,${ID_FLECHE})`)
		expect(appel.colonnes).toBe('id')
		expect(resultat.statut).toBe('supprimee')
	})

	it('rend « sans-effet » sur zéro ligne — l’appelant n’écrit pas les deux blocs reliés', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await supprimerFleche(client, ID_FLECHE)
		expect(resultat.statut).toBe('sans-effet')
	})

	it('emprunte le dictionnaire des FLÈCHES pour son refus, jamais celui des blocs', async () => {
		// §4.2 : la politique porte sur le droit d'écrire les DEUX blocs reliés, et un refus
		// formulé comme celui d'un bloc ferait chercher le problème du mauvais côté.
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await supprimerFleche(client, ID_FLECHE)
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await supprimerFleche(client, ID_FLECHE)
		expect(resultat.statut).toBe('refus')
	})
})

// =================================================================================================
// TRANCHE 2c — LES TABLEAUX
// =================================================================================================
//
// TROIS EXIGENCES NE VIVENT QUE DANS LA REQUÊTE ÉMISE, et aucune assertion de valeur ne les
// attraperait :
//
//   * la création envoie `position` à `null` — la LAISSER au trigger, jamais la calculer ici ;
//   * un renommage n'envoie QUE les champs touchés : renvoyer les deux écraserait ce qu'un
//     collègue vient d'écrire dans l'autre ;
//   * l'archivage écrit `archived_at`, et jamais un `delete` — un tableau CONTIENT le travail.

describe('creerTableau', () => {
	it('laisse le trigger placer le tableau : `position` part à null, jamais calculée', async () => {
		// §2.1 : « attribuée par trigger si omise ». Un `max + 1` calculé ici recopierait le
		// trigger en moins fiable, et ajouterait une course entre deux utilisateurs.
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Trimestre', description: null, position: 3 }],
			error: null,
			status: 201,
		})
		const resultat = await creerTableau(client, {
			idWorkspace: ID_WORKSPACE,
			nom: 'Trimestre',
			description: '',
		})
		expect(appel.table).toBe('goal_boards')
		expect(appel.operation).toBe('insert')
		expect(appel.charge?.position).toBeNull()
		expect(appel.charge?.workspace_id).toBe(ID_WORKSPACE)
		expect(appel.colonnes).toBe(COLONNES_TABLEAU)
		expect(resultat.statut).toBe('cree')
	})

	it('retire les espaces de bord du nom, et rend une description vide à `null`', async () => {
		// Deux représentations du néant dans la même colonne rendraient « pas de description »
		// indistinguable d'« une description vide » à la relecture.
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Trimestre', description: null, position: 1 }],
			error: null,
			status: 201,
		})
		await creerTableau(client, { idWorkspace: ID_WORKSPACE, nom: '  Trimestre  ', description: '   ' })
		expect(appel.charge?.name).toBe('Trimestre')
		expect(appel.charge?.description).toBeNull()
	})

	it('envoie un nom VIDE plutôt que de le refuser lui-même', async () => {
		// `CLAUDE.md` §10 : la règle est `goal_boards_name_check`, jamais l'écran. Une garde ici
		// ferait diverger l'interface de la contrainte au premier changement de celle-ci.
		const { client, appel } = espion({
			data: null,
			error: { message: 'goal_boards_name_check', code: CODE_SAISIE_INVALIDE },
			status: 400,
		})
		const resultat = await creerTableau(client, { idWorkspace: ID_WORKSPACE, nom: '   ', description: '' })
		expect(appel.operation).toBe('insert')
		expect(appel.charge?.name).toBe('')
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('saisie-invalide')
	})

	it('traduit le doublon de nom en `doublon`, et non en refus de droit', async () => {
		// §2.1 : l'unicité porte sur `(workspace_id, app.btrim_blancs(name))`. Le geste à faire
		// après ce refus — choisir un autre nom — n'est pas celui qu'appelle un refus de droit.
		const { client } = espion({
			data: null,
			error: { message: 'goal_boards_workspace_name_key', code: CODE_DOUBLON },
			status: 409,
		})
		const resultat = await creerTableau(client, { idWorkspace: ID_WORKSPACE, nom: 'Trimestre', description: '' })
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('doublon')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await creerTableau(client, { idWorkspace: ID_WORKSPACE, nom: 'Trimestre', description: '' })
		expect(resultat.statut).toBe('refus')
	})
})

describe('renommerTableau', () => {
	it('n’envoie QUE les champs touchés — un renommage seul ne réécrit pas la description', async () => {
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Semestre', description: 'inchangée', position: 1 }],
			error: null,
			status: 200,
		})
		const resultat = await renommerTableau(client, ID_TABLEAU, { nom: 'Semestre' })
		expect(appel.table).toBe('goal_boards')
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ name: 'Semestre' })
		expect(appel.filtres).toContain(`eq(id,${ID_TABLEAU})`)
		expect(resultat.statut).toBe('enregistree')
	})

	it('ramène une description vidée à `null`, comme à la création', async () => {
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Semestre', description: null, position: 1 }],
			error: null,
			status: 200,
		})
		await renommerTableau(client, ID_TABLEAU, { description: '  ' })
		expect(appel.charge).toEqual({ description: null })
	})

	it('rend « sans-effet » sur zéro ligne — la clause `using` a filtré la ligne', async () => {
		// ÉPROUVÉ CONTRE SON SUCCÈS : une implémentation qui rendrait « enregistrée » sur une
		// réponse vide passerait tous les autres cas de ce fichier.
		const { client } = espion({ data: [], error: null, status: 200 })
		const sansEffet = await renommerTableau(client, ID_TABLEAU, { nom: 'Semestre' })
		expect(sansEffet.statut).toBe('sans-effet')
		const { client: autre } = espion({
			data: [{ id: ID_TABLEAU, name: 'Semestre', description: null, position: 1 }],
			error: null,
			status: 200,
		})
		expect((await renommerTableau(autre, ID_TABLEAU, { nom: 'Semestre' })).statut).toBe('enregistree')
	})
})

describe('deplacerTableau', () => {
	it('écrit UNE position, et rien d’autre : jamais une permutation de deux lignes', async () => {
		// §2.1 : `position` est un `numeric` précisément pour que le milieu de deux voisines
		// suffise. Deux `update` non atomiques laisseraient la liste dans un état voulu par
		// personne si le second échouait.
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Trimestre', description: null, position: 1.5 }],
			error: null,
			status: 200,
		})
		const resultat = await deplacerTableau(client, ID_TABLEAU, 1.5)
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ position: 1.5 })
		expect(resultat.statut).toBe('enregistree')
	})

	it('réemploie l’arithmétique des tracks plutôt que d’en recopier une seconde', () => {
		// La preuve porte sur le CONTRAT réellement partagé : le milieu de deux voisines, et le
		// refus motivé quand ce milieu n'existe pas. Une copie divergerait au premier ajustement.
		const liste = [
			{ id: 'a', position: 1 },
			{ id: 'b', position: 2 },
			{ id: 'c', position: 3 },
		]
		expect(calculerDeplacement(liste, 'c', 'monter')).toEqual({ statut: 'calcule', position: 1.5 })
		expect(calculerDeplacement(liste, 'a', 'monter').statut).toBe('impossible')
		expect(deplacementPossible(liste, 'c', 'descendre')).toBe(false)
	})
})

describe('archiverTableau', () => {
	it('écrit `archived_at` — un tableau s’ARCHIVE, il ne se supprime pas', async () => {
		// §2.1 et §3 : « un bloc ne porte aucune donnée métier […] Le tableau, lui, s'archive : il
		// contient le travail. » L'opération est donc un `update`, jamais un `delete`, quand bien
		// même la politique de suppression de la table l'autoriserait.
		const { client, appel } = espion({
			data: [{ id: ID_TABLEAU, name: 'Trimestre', description: null, position: 1 }],
			error: null,
			status: 200,
		})
		const resultat = await archiverTableau(client, ID_TABLEAU, () => '2026-08-19T10:00:00.000Z')
		expect(appel.table).toBe('goal_boards')
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ archived_at: '2026-08-19T10:00:00.000Z' })
		expect(resultat.statut).toBe('enregistree')
	})

	it('rend « sans-effet » sur zéro ligne — la lectrice ne voit pas la ligne à l’écriture', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect((await archiverTableau(client, ID_TABLEAU)).statut).toBe('sans-effet')
	})

	it('traduit le refus d’une politique en `interdit`', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await archiverTableau(client, ID_TABLEAU)
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})
})

// @verifies CRM-083 (docs/BACKLOG.md) — tranche 2 h, la reprise d'un tableau archivé
// @verifies docs/SPEC-goals.md §5.6.1 mesures 4, 5 et 6 ; §5.6.2 lignes g et h
describe('desarchiverTableau', () => {
	it('REND `archived_at` À NULL, et n’envoie rien d’autre', async () => {
		// LA CHARGE EXACTE EST LE CONTRAT, pas seulement l'issue rendue : c'est la seule façon de
		// voir que le geste ne touche NI la position NI le nom. La mesure 5 du §5.6.1 établit que la
		// position est conservée par le désarchivage ; un `position: 0` glissé ici la perdrait sans
		// qu'aucune assertion d'issue ne s'en aperçoive.
		const { client, appel } = espion({
			data: [
				{ id: ID_TABLEAU, name: 'Trimestre', description: null, position: 2, archived_at: null },
			],
			error: null,
			status: 200,
		})
		const resultat = await desarchiverTableau(client, ID_TABLEAU)
		expect(appel.table).toBe('goal_boards')
		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ archived_at: null })
		expect(resultat.statut).toBe('enregistree')
	})

	it('rend « sans-effet » sur zéro ligne — c’est le refus MESURÉ de la lectrice, jamais un 403', async () => {
		// §5.6.1, mesure 4 : `goal_boards_maj_membre_ecrivant` refuse par sa clause `using`, donc
		// PostgREST rend `200` et un corps VIDE. Attendre un `403` ici figerait un comportement que
		// la pile ne produit pas, et la preuve serait verte sans rien prouver.
		const { client } = espion({ data: [], error: null, status: 200 })
		expect((await desarchiverTableau(client, ID_TABLEAU)).statut).toBe('sans-effet')
	})

	it('traduit le refus d’une politique en `interdit`', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'row-level security', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await desarchiverTableau(client, ID_TABLEAU)
		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('interdit')
	})

	it('est l’INVERSE EXACT d’archiverTableau — même table, même opération, colonne rendue', async () => {
		// Ce que cette assertion attrape et qu'aucune autre n'attraperait : une divergence entre les
		// deux gestes. Si l'un passait un jour par une RPC et l'autre par un `update`, ou si l'un
		// visait une autre table, les deux blocs ci-dessus resteraient verts séparément.
		const pose = espion({ data: [{ id: ID_TABLEAU }], error: null, status: 200 })
		await archiverTableau(pose.client, ID_TABLEAU, () => '2026-08-28T00:00:00.000Z')
		const reprise = espion({ data: [{ id: ID_TABLEAU }], error: null, status: 200 })
		await desarchiverTableau(reprise.client, ID_TABLEAU)

		expect(reprise.appel.table).toBe(pose.appel.table)
		expect(reprise.appel.operation).toBe(pose.appel.operation)
		expect(Object.keys(reprise.appel.charge as object)).toEqual(
			Object.keys(pose.appel.charge as object),
		)
		expect((pose.appel.charge as { archived_at: string | null }).archived_at).not.toBeNull()
		expect((reprise.appel.charge as { archived_at: string | null }).archived_at).toBeNull()
	})
})

describe('classerRefusTableau', () => {
	it('classe sur le CODE avant le statut, et le doublon avant tout', () => {
		expect(classerRefusTableau(409, CODE_DOUBLON, 'nom pris').nature).toBe('doublon')
		expect(classerRefusTableau(400, CODE_SAISIE_INVALIDE, 'nom vide').nature).toBe('saisie-invalide')
		expect(classerRefusTableau(400, CODE_INTERDIT, 'rls').nature).toBe('interdit')
		expect(classerRefusTableau(403, undefined, 'forbidden').nature).toBe('interdit')
		expect(classerRefusTableau(500, undefined, 'boom').nature).toBe('indisponible')
	})
})
