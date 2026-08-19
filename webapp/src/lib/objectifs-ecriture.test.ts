// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la géométrie
// @verifies docs/SPEC-goals.md §3 (poser un bloc — la position vient du GESTE ; déplacer et
//           redimensionner — persiste `pos_x`, `pos_y`, `width`, `height`), §2.2 (colonnes),
//           §4.2 (l'écriture est décidée par la base, jamais par l'écran)
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
	classerRefusBloc,
	ecrireContenuBloc,
	ecrireGeometrieBloc,
	grouperChannelsParTrack,
	lierBlocAChannel,
	lireChannelsLiables,
	poserBloc,
} from './objectifs-ecriture'
import { COLONNES_BLOC } from './objectifs'
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
	operation?: 'insert' | 'update'
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
