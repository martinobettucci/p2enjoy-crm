// @verifies CRM-041 (docs/BACKLOG.md) — composition du board et classification des refus
// @verifies CRM-022 (docs/BACKLOG.md) — relation responsable embarquée
// @verifies docs/SPEC-workflow-engine.md §7.2 (les quatre lectures), §7.3 (composition des
//           colonnes), §7.4 (ancienneté), §7.5 (transitions atteignables), §7.9 (optimisme et
//           retour arrière), §7.10 (les sept refus), §5.2 (valeur de retour de `move_card`)
// @verifies docs/SPEC-cards.md §2.6 (ordre dans une colonne), §5 (« active »)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue. Motif, repris
// de `channels.test.ts` : plusieurs exigences du §7.2 sont portées par la requête elle-même — la
// jointure embarquée vers le catalogue, les deux filtres d'exclusion des cards, l'ordre — et un
// test qui n'observerait que la réponse les laisserait disparaître sans bruit.
//
// La composition, elle, est éprouvée **sans navigateur** : c'est tout l'objet de la séparation
// entre `board.ts` et `Board.tsx`.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_CARD_BOARD,
	COLONNES_CHAMP_LIBELLE,
	COLONNES_ETAPE,
	COLONNES_TRANSITION,
	MESSAGES_REFUS,
	REFUS_ANONYME,
	appliquerDeplacement,
	classerRefus,
	composerBoard,
	couleurNoeud,
	cumulerMontants,
	deplacerCard,
	evaluerAnciennete,
	indexerTransitions,
	lireCards,
	lireEtapes,
	lireLibellesChamps,
	lireTransitions,
	remplacerCard,
	resoudreEtape,
	type CardBoard,
	type EtapeBoard,
	type EtapeLue,
	type TransitionLue,
} from './board'
import type { ClientCrm } from './supabase'

// --- Jeu d'essai, calqué sur le seed réellement mesuré -------------------------------------

/** Les sept étapes du workflow standard, telles que la base les rend (mesuré le 2026-08-05). */
const ETAPES: readonly EtapeBoard[] = [
	{ id: 's1', position: 1, libelle: 'Prospection', couleur: 'neutral', kind: 'open', seuilJours: 14 },
	{ id: 's2', position: 2, libelle: 'Relance', couleur: 'accent', kind: 'open', seuilJours: 7 },
	{ id: 's3', position: 3, libelle: 'Négociation', couleur: 'brand', kind: 'open', seuilJours: 5 },
	{ id: 's4', position: 4, libelle: 'Signature', couleur: 'brand', kind: 'open', seuilJours: 7 },
	{ id: 's7', position: 7, libelle: 'Perdu', couleur: 'danger', kind: 'lost', seuilJours: null },
]

const MAINTENANT = new Date('2026-08-05T12:00:00.000Z')

function card(partiel: Partial<CardBoard> & Pick<CardBoard, 'id' | 'current_step_id'>): CardBoard {
	return {
		title: partiel.id,
		position: 1,
		amount: null,
		currency: 'EUR',
		next_action: null,
		entered_step_at: MAINTENANT.toISOString(),
		// Défaut du jeu d'essai : une affaire qui n'a jamais dormi (`CRM-081` tranche 2 b).
		snoozed_until: null,
		email_local_part: 'c-00000000',
		owner_id: null,
		responsable: null,
		...partiel,
	}
}

const TRANSITIONS: readonly TransitionLue[] = [
	{ id: 't1', from_step_id: 's1', to_step_id: 's2', label: 'Relancer', require_comment: false },
	{ id: 't2', from_step_id: 's1', to_step_id: 's7', label: 'Marquer perdu', require_comment: true },
	{ id: 't3', from_step_id: 's2', to_step_id: 's3', label: null, require_comment: false },
]

// --- Composition (§7.3) ---------------------------------------------------------------------

describe('composition des colonnes (docs/SPEC-workflow-engine.md §7.3)', () => {
	it('produit une colonne par étape, y compris les étapes sans card', () => {
		const modele = composerBoard({
			etapes: ETAPES,
			cards: [card({ id: 'c1', current_step_id: 's2' })],
			transitions: TRANSITIONS,
			maintenant: MAINTENANT,
		})
		expect(modele.colonnes).toHaveLength(5)
		expect(modele.colonnes.map((colonne) => colonne.cartes.length)).toEqual([0, 1, 0, 0, 0])
	})

	// La règle qui distingue une composition partant des étapes d'une composition partant des
	// cards. Un groupement par étape produirait UNE colonne ici, et perdrait les quatre autres.
	it('ne perd aucune colonne quand aucune card n’occupe le board', () => {
		const modele = composerBoard({
			etapes: ETAPES,
			cards: [],
			transitions: TRANSITIONS,
			maintenant: MAINTENANT,
		})
		expect(modele.colonnes).toHaveLength(5)
		expect(modele.nombreCards).toBe(0)
	})

	it('ordonne les colonnes par position, quel que soit l’ordre reçu', () => {
		const melangees = [...ETAPES].reverse()
		const modele = composerBoard({
			etapes: melangees,
			cards: [],
			transitions: [],
			maintenant: MAINTENANT,
		})
		expect(modele.colonnes.map((colonne) => colonne.etape.position)).toEqual([1, 2, 3, 4, 7])
	})

	it('ordonne les cards par position, puis par titre à position égale', () => {
		const modele = composerBoard({
			etapes: ETAPES,
			cards: [
				card({ id: 'c-b', current_step_id: 's1', position: 2, title: 'Bêta' }),
				card({ id: 'c-z', current_step_id: 's1', position: 1, title: 'Zoulou' }),
				card({ id: 'c-a', current_step_id: 's1', position: 2, title: 'Alpha' }),
			],
			transitions: [],
			maintenant: MAINTENANT,
		})
		expect(modele.colonnes[0]?.cartes.map((carte) => carte.card.title)).toEqual([
			'Zoulou',
			'Alpha',
			'Bêta',
		])
	})

	// Une card désignant une étape absente des colonnes n'est comptée nulle part : le board ne
	// peut pas la placer, et l'inventer dans une colonne de repli serait un mensonge.
	it('ne compte pas une card dont l’étape n’est pas une colonne du board', () => {
		const modele = composerBoard({
			etapes: ETAPES,
			cards: [card({ id: 'c1', current_step_id: 'etape-d-un-autre-workflow' })],
			transitions: [],
			maintenant: MAINTENANT,
		})
		expect(modele.nombreCards).toBe(0)
		expect(modele.colonnes.every((colonne) => colonne.cartes.length === 0)).toBe(true)
	})
})

describe('cumul de montants d’une colonne (§7.3)', () => {
	it('additionne les montants d’une même devise', () => {
		expect(
			cumulerMontants([
				card({ id: 'a', current_step_id: 's1', amount: 48000, currency: 'EUR' }),
				card({ id: 'b', current_step_id: 's1', amount: 125000, currency: 'EUR' }),
			]),
		).toEqual({ montant: 173000, devise: 'EUR' })
	})

	it('ignore les cards sans montant plutôt que de les compter pour zéro', () => {
		expect(
			cumulerMontants([
				card({ id: 'a', current_step_id: 's1', amount: null }),
				card({ id: 'b', current_step_id: 's1', amount: 9600, currency: 'EUR' }),
			]),
		).toEqual({ montant: 9600, devise: 'EUR' })
	})

	it('rend `null` quand aucune card ne porte de montant, et jamais zéro', () => {
		expect(cumulerMontants([card({ id: 'a', current_step_id: 's1', amount: null })])).toBeNull()
	})

	// MESURÉ : `EUR` et `CHF` vivent sur des channels distincts du seed. Cette règle n'est donc
	// tenue par aucune donnée permanente — elle l'est ici.
	it('refuse d’additionner deux devises, et n’affiche alors aucun cumul', () => {
		expect(
			cumulerMontants([
				card({ id: 'a', current_step_id: 's1', amount: 28000, currency: 'CHF' }),
				card({ id: 'b', current_step_id: 's1', amount: 15500, currency: 'EUR' }),
			]),
		).toBeNull()
	})
})

describe('ancienneté dans l’étape (§7.4)', () => {
	const ilYA = (jours: number) =>
		new Date(MAINTENANT.getTime() - jours * 24 * 60 * 60 * 1000).toISOString()

	it('ne rend aucun seuil quand ni l’étape ni son nœud n’en posent', () => {
		const carte = evaluerAnciennete(
			card({ id: 'a', current_step_id: 's7', entered_step_at: ilYA(400) }),
			null,
			MAINTENANT,
		)
		expect(carte.seuilJours).toBeNull()
		expect(carte.ancienneteDepassee).toBe(false)
	})

	it('reste en deçà du seuil', () => {
		const carte = evaluerAnciennete(
			card({ id: 'a', current_step_id: 's2', entered_step_at: ilYA(6) }),
			7,
			MAINTENANT,
		)
		expect(carte.joursDansEtape).toBe(6)
		expect(carte.ancienneteDepassee).toBe(false)
	})

	it('bascule à l’atteinte du seuil, et non seulement au-delà', () => {
		const carte = evaluerAnciennete(
			card({ id: 'a', current_step_id: 's2', entered_step_at: ilYA(7) }),
			7,
			MAINTENANT,
		)
		expect(carte.ancienneteDepassee).toBe(true)
	})

	// Le seed pose `entered_step_at` à `now()` : toutes ses cards sont à zéro jour. La bascule
	// n'est donc démontrable par aucune donnée permanente (§7.4) — d'où ce test.
	it('rend zéro jour pour une card qui vient d’entrer, comme le seed en produit', () => {
		const carte = evaluerAnciennete(card({ id: 'a', current_step_id: 's1' }), 14, MAINTENANT)
		expect(carte.joursDansEtape).toBe(0)
		expect(carte.ancienneteDepassee).toBe(false)
	})
})

describe('transitions atteignables (§7.5)', () => {
	it('indexe les transitions par étape de départ', () => {
		const index = indexerTransitions(ETAPES, TRANSITIONS)
		expect(index.get('s1')?.map((transition) => transition.id)).toEqual(['t1', 't2'])
		expect(index.get('s2')?.map((transition) => transition.id)).toEqual(['t3'])
		expect(index.get('s3')).toBeUndefined()
	})

	// MESURÉ : `workflow_transitions` ne porte aucune colonne `position`. L'ordre du menu est
	// celui de l'étape cible — un ordre alphabétique ferait passer « Marquer perdu » en premier.
	it('ordonne le menu par position de l’étape cible, non par libellé', () => {
		const index = indexerTransitions(ETAPES, [
			{ id: 't2', from_step_id: 's1', to_step_id: 's7', label: 'Marquer perdu', require_comment: true },
			{ id: 't1', from_step_id: 's1', to_step_id: 's2', label: 'Relancer', require_comment: false },
		])
		expect(index.get('s1')?.map((transition) => transition.versEtape.position)).toEqual([2, 7])
	})

	it('ignore une transition dont l’étape cible n’est pas une colonne', () => {
		const index = indexerTransitions(ETAPES, [
			{ id: 'tx', from_step_id: 's1', to_step_id: 'ailleurs', label: null, require_comment: false },
		])
		expect(index.get('s1')).toBeUndefined()
	})

	it('conserve l’absence de libellé plutôt que d’inventer un texte', () => {
		const index = indexerTransitions(ETAPES, TRANSITIONS)
		expect(index.get('s2')?.[0]?.libelle).toBeNull()
	})

	it('rapporte l’exigence de commentaire, qui décide du geste (§7.8)', () => {
		const index = indexerTransitions(ETAPES, TRANSITIONS)
		expect(index.get('s1')?.map((transition) => transition.requiertCommentaire)).toEqual([false, true])
	})
})

describe('résolution d’une étape lue (§7.2)', () => {
	const lue = (partiel: Partial<EtapeLue>): EtapeLue => ({
		id: 's1',
		position: 1,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Réalisation',
			color: 'success',
			kind: 'open',
			default_stale_after_days: 30,
		},
		...partiel,
	})

	it('emploie le libellé du nœud en l’absence de surcharge', () => {
		expect(resoudreEtape(lue({})).libelle).toBe('Réalisation')
	})

	it('préfère la surcharge de l’étape, comme le seed en pose une', () => {
		expect(resoudreEtape(lue({ label_override: 'Réalisation en cours' })).libelle).toBe(
			'Réalisation en cours',
		)
	})

	it('préfère le seuil de l’étape à celui de son nœud', () => {
		expect(resoudreEtape(lue({ stale_after_days: 5 })).seuilJours).toBe(5)
	})

	it('se replie sur le seuil du nœud', () => {
		expect(resoudreEtape(lue({})).seuilJours).toBe(30)
	})

	// La politique de lecture du catalogue est distincte de celle des étapes : rien ne garantit
	// que les deux consentent la même chose au même appelant.
	it('survit à un nœud non consenti, sans inventer de libellé', () => {
		const etape = resoudreEtape(lue({ workflow_nodes_catalog: null }))
		expect(etape.libelle).toBe('')
		expect(etape.couleur).toBe('neutral')
		expect(etape.seuilJours).toBeNull()
	})

	it('se replie sur `neutral` pour une couleur que le produit ne connaît pas', () => {
		expect(couleurNoeud('fuchsia')).toBe('neutral')
		expect(couleurNoeud(null)).toBe('neutral')
		expect(couleurNoeud('danger')).toBe('danger')
	})
})

// --- Les sept refus (§7.10) -----------------------------------------------------------------

describe('classification des refus de `move_card` (§7.10)', () => {
	const LIBELLES = new Map([['lien-proposition', 'Lien vers la proposition']])

	it('reconnaît les six jetons de la garde', () => {
		for (const message of MESSAGES_REFUS) {
			expect(classerRefus(message, null, LIBELLES).cle).toBe(message)
		}
	})

	// MESURÉ contre la pile réelle : `details` porte les CLÉS, séparées par « , ».
	it('résout les clés du `DETAIL` en libellés de champs', () => {
		const refus = classerRefus('missing_required_fields', 'lien-proposition', LIBELLES)
		expect(refus.champsManquants).toEqual(['Lien vers la proposition'])
	})

	it('résout plusieurs clés, dans l’ordre du `DETAIL`', () => {
		const refus = classerRefus(
			'missing_required_fields',
			'lien-proposition, budget',
			new Map([
				['budget', 'Budget estimé'],
				['lien-proposition', 'Lien vers la proposition'],
			]),
		)
		expect(refus.champsManquants).toEqual(['Lien vers la proposition', 'Budget estimé'])
	})

	// Une clé sans libellé reste la clé : moins lisible qu'un libellé, mais vraie (§7.10).
	it('conserve la clé brute quand aucun libellé n’est connu', () => {
		expect(
			classerRefus('missing_required_fields', 'champ-supprime', new Map()).champsManquants,
		).toEqual(['champ-supprime'])
	})

	it('reconnaît le refus de privilège par son SQLSTATE, non par son texte', () => {
		const refus = classerRefus('permission denied for function move_card', null, LIBELLES, '42501')
		expect(refus.cle).toBe(REFUS_ANONYME)
	})

	// La règle qui interdit d'absorber un refus : `CLAUDE.md` §18.
	it('n’absorbe pas un message inconnu, et conserve le message brut', () => {
		const refus = classerRefus('quelque_chose_de_neuf', null, LIBELLES, 'P0001')
		expect(refus.cle).toBeNull()
		expect(refus.brut).toBe('quelque_chose_de_neuf')
	})
})

// --- Optimisme et retour arrière (§7.9) ------------------------------------------------------

describe('déplacement optimiste (§7.9)', () => {
	const CARDS: readonly CardBoard[] = [
		card({ id: 'c1', current_step_id: 's1', position: 1 }),
		card({ id: 'c2', current_step_id: 's2', position: 1 }),
		card({ id: 'c3', current_step_id: 's2', position: 2 }),
	]

	it('place la card en fin de colonne d’arrivée', () => {
		const apres = appliquerDeplacement(CARDS, 'c1', 's2')
		const deplacee = apres.find((c) => c.id === 'c1')
		expect(deplacee?.current_step_id).toBe('s2')
		expect(deplacee?.position).toBe(3)
	})

	it('place en première position dans une colonne vide', () => {
		expect(appliquerDeplacement(CARDS, 'c1', 's3').find((c) => c.id === 'c1')?.position).toBe(1)
	})

	it('ne modifie aucune autre card', () => {
		const apres = appliquerDeplacement(CARDS, 'c1', 's2')
		expect(apres.filter((c) => c.id !== 'c1')).toEqual(CARDS.filter((c) => c.id !== 'c1'))
	})

	// La ligne rendue REMPLACE la card, elle ne la complète pas : recopier une position que la
	// base n'a pas attribuée afficherait un rang faux (§7.9).
	it('remplace entièrement la card par la ligne rendue par `move_card`', () => {
		const ligne = card({ id: 'c1', current_step_id: 's2', position: 42, title: 'Titre du serveur' })
		const apres = remplacerCard(CARDS, ligne)
		expect(apres.find((c) => c.id === 'c1')).toEqual(ligne)
	})
})

// --- Les quatre lectures (§7.2) --------------------------------------------------------------

type Appel = {
	table?: string
	colonnes?: string
	egalites: [string, unknown][]
	nuls: string[]
	tris: string[]
}

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/** Client factice qui **enregistre** la requête construite, puis rend la réponse voulue. */
function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { egalites: [], nuls: [], tris: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
			return chaine
		},
		is: (colonne: string) => {
			appel.nuls.push(colonne)
			return chaine
		},
		order: (colonne: string) => {
			appel.tris.push(colonne)
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

const OK: Reponse = { data: [], error: null, status: 200 }

describe('les quatre lectures du board (§7.2)', () => {
	it('demande les étapes du workflow, avec leur nœud embarqué et dans l’ordre', async () => {
		const { client, appel } = clientEspion(OK)
		await lireEtapes(client, 'wf-1')
		expect(appel.table).toBe('workflow_steps')
		expect(appel.colonnes).toBe(COLONNES_ETAPE)
		expect(appel.colonnes).toContain('workflow_nodes_catalog(')
		expect(appel.egalites).toEqual([['workflow_id', 'wf-1']])
		expect(appel.tris).toEqual(['position'])
	})

	it('demande les transitions du workflow', async () => {
		const { client, appel } = clientEspion(OK)
		await lireTransitions(client, 'wf-1')
		expect(appel.table).toBe('workflow_transitions')
		expect(appel.colonnes).toBe(COLONNES_TRANSITION)
		expect(appel.egalites).toEqual([['workflow_id', 'wf-1']])
	})

	// Les deux exclusions sont CÔTÉ SERVEUR : c'est la définition d'« active » de
	// docs/SPEC-cards.md §5, la même qu'emploie la première vérification de `move_card`.
	it('demande les cards actives du channel, archivées et corbeille exclues côté serveur', async () => {
		const { client, appel } = clientEspion(OK)
		await lireCards(client, 'ch-1')
		expect(appel.table).toBe('cards')
		expect(appel.colonnes).toBe(COLONNES_CARD_BOARD)
		expect(appel.colonnes).toContain('responsable:profiles!cards_owner_id_fkey')
		expect(appel.egalites).toEqual([['channel_id', 'ch-1']])
		expect(appel.nuls).toEqual(['archived_at', 'deleted_at'])
		expect(appel.tris).toEqual(['position', 'title'])
	})

	it('demande les libellés des champs du workflow, et rien de plus', async () => {
		const { client, appel } = clientEspion(OK)
		await lireLibellesChamps(client, 'wf-1')
		expect(appel.table).toBe('form_fields')
		expect(appel.colonnes).toBe(COLONNES_CHAMP_LIBELLE)
	})

	it('rend un état d’erreur quand le backend répond en erreur', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'boum' }, status: 500 })
		const resultat = await lireCards(client, 'ch-1')
		expect(resultat.statut).toBe('erreur')
	})

	// Un refus de lecture par RLS rend `200` et zéro ligne : c'est un état VIDE, jamais une
	// erreur (docs/SPEC-permissions-rls.md §7). C'est ce que l'anonyme obtient, mesuré.
	it('rend un état prêt et vide sur le refus par défaut, jamais une erreur', async () => {
		const { client } = clientEspion(OK)
		const resultat = await lireCards(client, 'ch-1')
		expect(resultat).toEqual({ statut: 'pret', donnees: [] })
	})
})

describe('appel de la garde `move_card` (§5.2, §7.9)', () => {
	function clientRpc(reponse: {
		data: unknown
		error: { message: string; details: string | null; code: string | null } | null
	}): { client: ClientCrm; appels: { nom: string; arguments: Record<string, unknown> }[] } {
		const appels: { nom: string; arguments: Record<string, unknown> }[] = []
		const client = {
			rpc: (nom: string, args: Record<string, unknown>) => {
				appels.push({ nom, arguments: args })
				return Promise.resolve(reponse)
			},
		} as unknown as ClientCrm
		return { client, appels }
	}

	it('appelle `move_card`, et n’écrit jamais `current_step_id` directement', async () => {
		const ligne = card({ id: 'c1', current_step_id: 's2' })
		const { client, appels } = clientRpc({ data: ligne, error: null })
		const resultat = await deplacerCard(client, 'c1', 's2', null, new Map())
		expect(appels).toEqual([{ nom: 'move_card', arguments: { card_id: 'c1', to_step_id: 's2' } }])
		expect(resultat).toEqual({ statut: 'ok', card: ligne })
	})

	it('transmet le commentaire lorsqu’il est fourni, et l’omet sinon', async () => {
		const { client, appels } = clientRpc({ data: card({ id: 'c1', current_step_id: 's7' }), error: null })
		await deplacerCard(client, 'c1', 's7', 'Budget insuffisant', new Map())
		expect(appels[0]?.arguments['comment']).toBe('Budget insuffisant')
	})

	it('classe le refus au lieu de le laisser filer', async () => {
		const { client } = clientRpc({
			data: null,
			error: { message: 'transition_not_allowed', details: null, code: 'P0001' },
		})
		const resultat = await deplacerCard(client, 'c1', 's3', null, new Map())
		// GARDE-FOU RÉVISÉ, et le motif est écrit ici plutôt que dans un message de commit.
		// `RefusDeplacement` porte depuis la reprise d'un déplacement refusé une seconde liste,
		// `clesManquantes` — les clés que le `DETAIL` transporte réellement, dont l'adresse de la
		// fiche a besoin (docs/SPEC-form-composer.md §4 ter.3). L'assertion exhaustive a donc échoué
		// **comme elle le devait** : elle fige la forme entière du refus, et cette forme a changé.
		// Elle n'est pas relâchée en `toMatchObject` — c'est précisément son exhaustivité qui la
		// rend utile —, elle est mise à jour. Le refus vérifié ici n'étant pas
		// `missing_required_fields`, les deux listes sont vides, et cela dit quelque chose : aucun
		// autre refus ne transporte de champs.
		expect(resultat).toEqual({
			statut: 'refus',
			refus: {
				cle: 'transition_not_allowed',
				champsManquants: [],
				clesManquantes: [],
				brut: 'transition_not_allowed',
			},
		})
	})
})

// --- Le filtre du sommeil à la composition (`CRM-081` tranche 2 b) -----------------------------
//
// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 b : le board masque, marque et compte
// @verifies docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.12.1 (le prédicat
//           d'exclusion), §16.12.3 (le board filtre à la COMPOSITION, et pourquoi),
//           §16.12.6 (le compte des masquées, sans requête supplémentaire),
//           §16.12.8 (le compteur et le cumul portent sur les cartes RENDUES)

describe('le filtre du sommeil à la composition (§16.12.3)', () => {
	/** Une échéance à `jours` de l'instant du jeu d'essai. Jamais une date figée : voir §16.11.1. */
	function echeance(jours: number): string {
		return new Date(MAINTENANT.getTime() + jours * 24 * 60 * 60 * 1000).toISOString()
	}

	const EVEILLEE = card({ id: 'eveillee', current_step_id: 's2' })
	const ENDORMIE = card({ id: 'endormie', current_step_id: 's2', snoozed_until: echeance(10) })
	const ECHUE = card({ id: 'echue', current_step_id: 's2', snoozed_until: echeance(-2) })

	function composer(cards: readonly CardBoard[], modeSommeil?: 'masquees' | 'visibles') {
		return composerBoard({
			etapes: ETAPES,
			cards,
			transitions: TRANSITIONS,
			maintenant: MAINTENANT,
			...(modeSommeil === undefined ? {} : { modeSommeil }),
		})
	}

	// LE DÉFAUT MASQUE, et c'est la Definition of Done de `CRM-081` : « sort des vues par défaut ».
	// Le mode n'est même pas passé ici — c'est le défaut du module qui doit masquer.
	it('masque les affaires en sommeil sans qu’on le lui demande', () => {
		const modele = composer([EVEILLEE, ENDORMIE])
		expect(modele.colonnes[1]?.cartes.map((carte) => carte.card.id)).toEqual(['eveillee'])
	})

	// L'ordre attendu est celui du §2.6 — `position` puis départage —, et NON l'ordre du tableau
	// d'entrée : le filtre ne fait que retirer des lignes, le tri de la colonne reste le sien. Les
	// deux fixtures partagent la position 1, d'où le départage qui place « endormie » avant
	// « eveillee ». Écrit ainsi plutôt qu'en ensemble : c'est la propriété du §2.6, et un `Set`
	// laisserait passer une bascule qui réordonnerait la colonne.
	it('les ramène toutes en mode « visibles », dans l’ordre de la colonne', () => {
		const modele = composer([EVEILLEE, ENDORMIE], 'visibles')
		expect(modele.colonnes[1]?.cartes.map((carte) => carte.card.id)).toEqual(['endormie', 'eveillee'])
	})

	// UNE ÉCHÉANCE ÉCHUE N'EST PAS UN SOMMEIL (§16.11.1) : l'affaire reste visible partout, sans
	// bascule et sans marque. C'est le côté du prédicat qu'une fixture de date figée cesserait
	// d'éprouver au bout de quelques semaines — d'où l'instant injecté.
	it('ne masque PAS une affaire dont l’échéance est passée, et ne la marque pas non plus', () => {
		const modele = composer([ECHUE])
		const carte = modele.colonnes[1]?.cartes[0]
		expect(carte?.card.id).toBe('echue')
		expect(carte?.enSommeil).toBe(false)
	})

	// L'instant EXACT n'est pas un sommeil : le prédicat est « strictement postérieure ».
	it('ne masque pas une affaire dont l’échéance est l’instant même', () => {
		const pile = card({ id: 'pile', current_step_id: 's2', snoozed_until: MAINTENANT.toISOString() })
		expect(composer([pile]).colonnes[1]?.cartes).toHaveLength(1)
	})

	it('marque d’un `enSommeil` vrai la carte endormie qu’il rend visible', () => {
		const modele = composer([ENDORMIE], 'visibles')
		expect(modele.colonnes[1]?.cartes[0]?.enSommeil).toBe(true)
	})

	// Le prédicat de la marque emploie l'instant du FILTRE (§16.12.3) : une carte rendue par l'un est
	// nécessairement marquée par l'autre, et aucun second `new Date()` ne peut les désaccorder.
	it('rend, en mode visible, une carte marquée pour chaque carte que le mode masqué écarte', () => {
		const toutes = [EVEILLEE, ENDORMIE, ECHUE]
		const masque = composer(toutes)
		const visible = composer(toutes, 'visibles')
		const marquees = visible.colonnes.flatMap((colonne) =>
			colonne.cartes.filter((carte) => carte.enSommeil).map((carte) => carte.card.id),
		)
		const rendues = masque.colonnes.flatMap((colonne) => colonne.cartes.map((carte) => carte.card.id))
		expect(marquees).toEqual(['endormie'])
		expect(rendues).not.toContain('endormie')
	})

	// Une échéance illisible n'est pas un sommeil : la carte reste rendue plutôt que d'être masquée
	// par une comparaison avec `NaN`, qui serait fausse de toute façon.
	it('ne masque pas une affaire dont l’échéance est illisible', () => {
		const cassee = card({ id: 'cassee', current_step_id: 's2', snoozed_until: 'pas-une-date' })
		const modele = composer([cassee])
		expect(modele.colonnes[1]?.cartes).toHaveLength(1)
		expect(modele.colonnes[1]?.cartes[0]?.enSommeil).toBe(false)
	})
})

describe('le compte des masquées et les compteurs (§16.12.6, §16.12.8)', () => {
	function echeance(jours: number): string {
		return new Date(MAINTENANT.getTime() + jours * 24 * 60 * 60 * 1000).toISOString()
	}

	const ENDORMIE = card({ id: 'endormie', current_step_id: 's2', snoozed_until: echeance(10) })

	function composer(cards: readonly CardBoard[], modeSommeil: 'masquees' | 'visibles') {
		return composerBoard({ etapes: ETAPES, cards, transitions: TRANSITIONS, maintenant: MAINTENANT, modeSommeil })
	}

	// C'EST CE COMPTE QUI PERMET À L'ÉTAT VIDE DE NE PAS MENTIR (§16.12.6) : « toutes les affaires de
	// ce channel sont en sommeil » plutôt que « aucune affaire », et sans une requête de plus.
	it('compte les masquées, ce qui rend l’état vide véridique sans seconde requête', () => {
		const modele = composer([ENDORMIE], 'masquees')
		expect(modele.nombreCards).toBe(0)
		expect(modele.nombreEnSommeilMasquees).toBe(1)
	})

	it('ne compte aucune masquée en mode « visibles » : rien n’y est masqué', () => {
		const modele = composer([ENDORMIE], 'visibles')
		expect(modele.nombreCards).toBe(1)
		expect(modele.nombreEnSommeilMasquees).toBe(0)
	})

	it('distingue un channel réellement vide d’un channel dont tout dort', () => {
		expect(composer([], 'masquees').nombreEnSommeilMasquees).toBe(0)
		expect(composer([ENDORMIE], 'masquees').nombreEnSommeilMasquees).toBe(1)
	})

	// Le compteur d'une colonne annonce ce qu'elle MONTRE : un compteur incluant les masquées
	// désignerait des cartes introuvables à l'œil (§16.12.8).
	it('borne le compteur d’une colonne aux cartes rendues', () => {
		const cards = [card({ id: 'eveillee', current_step_id: 's2' }), ENDORMIE]
		expect(composer(cards, 'masquees').colonnes[1]?.cartes).toHaveLength(1)
		expect(composer(cards, 'visibles').colonnes[1]?.cartes).toHaveLength(2)
	})

	// Le cumul suit la même règle : il porte sur les cartes rendues, sans quoi une colonne
	// annoncerait un montant que ses cartes visibles ne totalisent pas.
	it('exclut du cumul le montant d’une affaire masquée', () => {
		const cards = [
			card({ id: 'eveillee', current_step_id: 's2', amount: 1000 }),
			card({ id: 'dort', current_step_id: 's2', amount: 4000, snoozed_until: echeance(10) }),
		]
		expect(composer(cards, 'masquees').colonnes[1]?.cumul?.montant).toBe(1000)
		expect(composer(cards, 'visibles').colonnes[1]?.cumul?.montant).toBe(5000)
	})

	// La colonne doit être RAPPORTÉE par la requête, sans quoi ni le filtre ni la marque ne seraient
	// possibles : le board lit toutes ses cards en une fois (§7.2).
	it('demande `snoozed_until` dans les colonnes lues', () => {
		expect(COLONNES_CARD_BOARD).toContain('snoozed_until')
	})
})
