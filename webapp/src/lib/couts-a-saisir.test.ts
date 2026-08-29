// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6a : le socle de données de
//           l'onglet « À saisir »
// @verifies docs/SPEC-costs.md §4.8 (ce que l'onglet liste — budgets et occurrences clôturés
//           COMPRIS —, l'ordre du plus ancien au plus récent, la pilule « clôturé », ce que
//           l'appelant ne peut pas écrire, le compteur, « zéro est une valeur, pas un vide »),
//           §4.8.1 (le droit d'écriture est rendu par la base ; l'ancienneté se mesure sur
//           `created_at` ; la saisie n'envoie qu'`actual_cost` ; les trois issues),
//           §4.8.2 (la portée du badge), §2.3 (« nul n'est pas zéro »), §3.1 (double condition de
//           lecture), §3.2 (écriture)
// @verifies docs/SCHEMA.md §9 bis.8 (`public.reel_saisissable`, colonne calculée)
// @verifies docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série des coûts réels)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE autant que la valeur rendue, comme
// `couts-ecrans.test.ts` et `card-costs.test.ts`. Quatre exigences du §4.8 sont portées par la
// requête elle-même — le filtre `actual_cost is null`, l'ABSENCE de tout filtre de clôture, l'ordre
// `created_at` puis `label`, et le filtre de portée sur la ressource embarquée — et un test qui
// n'observerait que la réponse les laisserait disparaître sans bruit. L'absence d'un filtre est
// d'ailleurs la plus fragile des quatre : rien ne signalerait qu'un `closed_at is null` a été ajouté
// par mimétisme avec `lireHistogrammeTrack`, et l'onglet perdrait sa raison d'être en silence.
//
// LE SECOND TEST LE PLUS IMPORTANT EST CELUI DU REPLI DU DROIT. `reel_saisissable` est une colonne
// de la RÉPONSE, pas un champ calculé ici : une réponse amputée, un cache de schéma PostgREST périmé
// ou une jointure malformée la rendent absente, et le repli doit alors être le REFUS. Un module qui
// replierait vers « saisissable » afficherait des champs dont chaque envoi serait refusé.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_LIGNE_A_SAISIR,
	ancienneteEnJours,
	ancienneteEnRetard,
	classerRefusSaisie,
	compterEnAttente,
	enregistrerReel,
	estClos,
	estSaisissable,
	lireLignesASaisir,
	type LigneASaisir,
} from './couts-a-saisir'
import type { ClientCrm } from './supabase'

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}

type Appel = {
	table?: string
	colonnes?: string
	action?: 'select' | 'update'
	charge?: unknown
	filtres: [string, unknown][]
	tris: string[]
}

/**
 * Client factice qui **enregistre** chaque requête construite, puis rend les réponses en séquence.
 *
 * Repris de `couts-ecrans.test.ts` et étendu à `update`, que ce module émet et que l'autre n'émet
 * pas. Il n'est pas importé de là : un harnais de test partagé entre deux fichiers ferait qu'une
 * évolution demandée par l'un casserait les preuves de l'autre, et ces deux modules n'ont pas la
 * même surface d'appel.
 */
function espion(reponses: readonly Reponse[]): { client: ClientCrm; appels: Appel[] } {
	const appels: Appel[] = []
	let rang = 0
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, filtres: [], tris: [] }
			appels.push(appel)
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			const enregistrer = (nom: 'is' | 'eq' | 'in') => (colonne: string, valeur: unknown) => {
				appel.filtres.push([`${nom}:${colonne}`, valeur])
				return chaine
			}
			chaine.is = enregistrer('is')
			chaine.eq = enregistrer('eq')
			chaine.in = enregistrer('in')
			chaine.order = (colonne: string) => {
				appel.tris.push(colonne)
				return chaine
			}
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			}
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return {
				select: (colonnes: string) => {
					appel.action = 'select'
					appel.colonnes = colonnes
					return chaine
				},
				update: (charge: unknown) => {
					appel.action = 'update'
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

/** Une ligne rendue par la lecture, dans sa forme complète, que chaque test spécialise. */
const ligne = (reste: Partial<LigneASaisir> = {}): LigneASaisir => ({
	id: 'l1',
	label: 'Publicité',
	estimated_cost: 100,
	created_at: '2026-08-01T10:00:00Z',
	reel_saisissable: true,
	budgets: {
		id: 'b1',
		name: 'Publicité 2026',
		currency: 'EUR',
		is_recurrent: true,
		closed_at: null,
		// LE DÉFAUT DE LA FIXTURE EST « AUCUN SEUIL », et c'est le choix qui rend les autres tests
		// insensibles à l'arbitrage d'INC-183 : sans seuil, aucune ligne n'est en retard, et rien de
		// ce qu'ils mesurent ne dépend d'une teinte. Les tests du seuil le posent explicitement.
		stale_after_days: null,
	},
	budget_occurrences: { id: 'o1', label: 'Février 2026', closed_at: null },
	cards: {
		id: 'c1',
		title: 'Refonte intranet',
		archived_at: null,
		channels: { slug: 'projets', tracks: { id: 't1', slug: 'studio-web', name: 'Studio web' } },
	},
	...reste,
})

describe('lireLignesASaisir — la requête émise', () => {
	it('filtre `actual_cost is null` côté serveur et n’ajoute AUCUN filtre de clôture', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])

		await lireLignesASaisir(client, { genre: 'workspace' })

		expect(appels).toHaveLength(1)
		expect(appels[0]?.table).toBe('card_costs')
		expect(appels[0]?.filtres).toContainEqual(['is:actual_cost', null])
		// LA PREUVE CENTRALE DE CE FICHIER, et elle porte sur une ABSENCE. Le §4.8 liste « y compris
		// celles des budgets et occurrences clôturés : c'est précisément après la clôture que les
		// factures arrivent, et les exclure viderait l'onglet de son usage ». Un `closed_at is null`
		// ajouté par mimétisme avec `lireHistogrammeTrack` — qui, lui, DOIT le poser — retirerait
		// silencieusement la raison d'être de l'onglet.
		expect(appels[0]?.filtres.map(([cle]) => cle)).not.toContain('is:closed_at')
		expect(appels[0]?.filtres.map(([cle]) => cle)).not.toContain('is:budgets.closed_at')
	})

	it('ordonne du plus ancien au plus récent, puis par libellé', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])

		await lireLignesASaisir(client, { genre: 'workspace' })

		// « du plus ancien au plus récent — celui qui attend depuis le plus longtemps est celui qu'on
		// oublie » (§4.8). Le second critère départage deux lignes créées dans la même transaction :
		// sans lui, l'ordre rendu dépendrait du plan d'exécution et le tableau se réordonnerait d'un
		// chargement à l'autre, sous les doigts de qui saisit.
		expect(appels[0]?.tris).toEqual(['created_at', 'label'])
	})

	it('demande la colonne calculée du droit d’écriture, et les deux jointures nommées', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])

		await lireLignesASaisir(client, { genre: 'workspace' })

		expect(appels[0]?.colonnes).toBe(COLONNES_LIGNE_A_SAISIR)
		// Sans cette colonne, le §4.8 serait inapplicable : l'écran ne saurait pas quelles lignes
		// rendre en lecture seule AVANT de rendre le champ (§4.8.1).
		expect(COLONNES_LIGNE_A_SAISIR).toContain('reel_saisissable')
		// `budgets!inner` : PostgREST n'applique un filtre sur une ressource embarquée que si la
		// jointure est déclarée `inner`. En jointure externe, la portée « track » ne filtrerait rien.
		expect(COLONNES_LIGNE_A_SAISIR).toContain('budgets!inner(')
		// La clé étrangère est NOMMÉE : `cards` porte deux clés composites vers `channels`, et un
		// `channels(...)` nu rend `PGRST201` sur la requête entière.
		expect(COLONNES_LIGNE_A_SAISIR).toContain('channels!cards_channel_id_workspace_id_fkey')
	})

	it('borne la portée « track » sur la ressource embarquée, et rien d’autre', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])

		await lireLignesASaisir(client, { genre: 'track', idTrack: 't1' })

		expect(appels[0]?.filtres).toContainEqual(['eq:budgets.track_id', 't1'])
		// Le filtre porte sur le track du BUDGET, jamais sur celui de l'affaire : le §3.1 autorise le
		// rattachement croisé — une card d'un track, un budget d'un autre —, et le §4.8 borne l'onglet
		// aux « budgets du track ». Filtrer sur l'affaire ferait disparaître de l'écran de coûts d'un
		// track une dépense pourtant imputée à l'un de ses budgets.
		expect(appels[0]?.filtres.map(([cle]) => cle)).not.toContain('eq:cards.channels.tracks.id')
	})

	it('n’ajoute AUCUN filtre de track en portée « workspace », la RLS bornant déjà la lecture', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])

		await lireLignesASaisir(client, { genre: 'workspace' })

		// Y ajouter un `in` sur les tracks lisibles referait le travail de la base en moins bien : la
		// liste serait mesurée à un instant, la RLS à un autre, et l'écart se lirait comme une ligne
		// manquante (§4.8.1).
		expect(appels[0]?.filtres).toEqual([['is:actual_cost', null]])
	})
})

describe('lireLignesASaisir — ce qu’elle rend', () => {
	it('rend les lignes telles que la réponse les porte, sans rien recalculer', async () => {
		const attendue = ligne()
		const { client } = espion([{ data: [attendue], error: null, status: 200 }])

		const etat = await lireLignesASaisir(client, { genre: 'workspace' })

		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees).toEqual([attendue])
	})

	it('classe un refus d’autorisation en `forbidden` plutôt qu’en liste vide', async () => {
		const { client } = espion([
			{ data: null, error: { message: 'permission denied' }, status: 403 },
		])

		const etat = await lireLignesASaisir(client, { genre: 'workspace' })

		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') return
		// Une liste vide et un refus ne se rendent pas de la même façon : « Tous les coûts réels sont
		// saisis » est une bonne nouvelle (§4.8, états), et l'écrire sur un refus serait une valeur
		// par défaut trompeuse.
		expect(etat.erreur.nature).toBe('forbidden')
	})

	it('ne lève jamais : une exception du client devient un état d’erreur', async () => {
		const client = {
			from: () => {
				throw new Error('socket fermé')
			},
		} as unknown as ClientCrm

		const etat = await lireLignesASaisir(client, { genre: 'workspace' })

		expect(etat.statut).toBe('erreur')
	})
})

describe('estSaisissable — le repli d’un droit se fait vers le refus', () => {
	it('rend vrai sur `true`, et faux sur tout le reste', () => {
		expect(estSaisissable(ligne({ reel_saisissable: true }))).toBe(true)
		expect(estSaisissable(ligne({ reel_saisissable: false }))).toBe(false)
		expect(estSaisissable(ligne({ reel_saisissable: null }))).toBe(false)
	})

	it('rend FAUX lorsque la colonne calculée est absente de la réponse', () => {
		// Le cas réel : un cache de schéma PostgREST périmé après la migration 52 rend la colonne
		// absente, pas nulle. Une écriture `!== false` l'aurait alors rendue SAISISSABLE, et l'onglet
		// aurait offert des champs dont chaque envoi serait refusé.
		const sansColonne = { ...ligne() } as Record<string, unknown>
		delete sansColonne.reel_saisissable
		expect(estSaisissable(sansColonne as unknown as LigneASaisir)).toBe(false)
	})
})

describe('estClos — une seule pilule pour deux causes', () => {
	it('rend faux sur un budget et une occurrence ouverts', () => {
		expect(estClos(ligne())).toBe(false)
	})

	it('rend vrai lorsque le BUDGET est clos', () => {
		expect(
			estClos(ligne({ budgets: { ...ligne().budgets!, closed_at: '2026-06-30T17:00:00Z' } })),
		).toBe(true)
	})

	it('rend vrai lorsque seule l’OCCURRENCE est close, dans un budget ouvert', () => {
		// C'est le cas du seed — « Janvier 2026 » clôturée sous « Publicité 2026 » ouvert. Sans cette
		// règle, l'utilisateur chercherait en vain ce qui, dans un budget ouvert, fait paraître la
		// ligne ici.
		expect(
			estClos(
				ligne({ budget_occurrences: { id: 'o1', label: 'Janvier 2026', closed_at: '2026-02-05Z' } }),
			),
		).toBe(true)
	})

	it('rend faux — et non vrai — lorsque la relation est ABSENTE', () => {
		// Le repli d'un fait inconnu est de ne rien affirmer : une pilule « clôturé » posée sur une
		// ligne dont on ne sait rien affirmerait une clôture qui n'a peut-être pas eu lieu.
		expect(estClos(ligne({ budgets: null, budget_occurrences: null }))).toBe(false)
	})
})

describe('ancienneteEnJours — mesurée sur `created_at`', () => {
	const maintenant = new Date('2026-08-20T10:00:00Z')

	it('compte les jours révolus depuis la création', () => {
		expect(ancienneteEnJours(ligne({ created_at: '2026-08-08T10:00:00Z' }), maintenant)).toBe(12)
	})

	it('rend 0 le jour même, et non 1', () => {
		expect(ancienneteEnJours(ligne({ created_at: '2026-08-20T01:00:00Z' }), maintenant)).toBe(0)
	})

	it('rend 0 — jamais un nombre négatif — sur une date FUTURE', () => {
		// Une horloge qui dérive, pas une dépense qui n'attend pas encore. « -3 jours » se lirait
		// comme une donnée fausse ; « 0 jour » se lit comme une dépense d'aujourd'hui.
		expect(ancienneteEnJours(ligne({ created_at: '2026-08-23T10:00:00Z' }), maintenant)).toBe(0)
	})

	it('rend `null` — jamais 0 — sur une date illisible', () => {
		// « 0 jour » sur une date qu'on n'a pas su lire serait la valeur par défaut trompeuse que
		// `CLAUDE.md` §18 interdit : l'écran rendra une cellule vide (§5.9).
		expect(ancienneteEnJours(ligne({ created_at: 'pas une date' }), maintenant)).toBeNull()
	})

	it('n’emploie PAS `updated_at` : renommer une ligne ne la rajeunit pas', () => {
		// La ligne ne porte même pas `updated_at` dans son type : la preuve est structurelle autant
		// que comportementale, et c'est voulu (§4.8.1).
		const avecMaj = { ...ligne({ created_at: '2026-08-08T10:00:00Z' }), updated_at: maintenant }
		expect(ancienneteEnJours(avecMaj as unknown as LigneASaisir, maintenant)).toBe(12)
	})
})

describe('ancienneteEnRetard — le seuil est une DONNÉE du budget (§2.1 bis, INC-183)', () => {
	const maintenant = new Date('2026-08-20T10:00:00Z')

	/** Une ligne née il y a `jours` jours, sur un budget dont le seuil est `seuil`. */
	const avecSeuil = (jours: number, seuil: number | null) =>
		ligne({
			created_at: new Date(maintenant.getTime() - jours * 86_400_000).toISOString(),
			budgets: {
				id: 'b1',
				name: 'Publicité 2026',
				currency: 'EUR',
				is_recurrent: true,
				closed_at: null,
				stale_after_days: seuil,
			},
		})

	it('AUCUN SEUIL ne devient jamais un seuil par défaut, fût-ce à mille jours', () => {
		// C'est la règle de `seuilEffectif` de `carte-figee.ts` (`docs/SPEC-relances.md` §2.2),
		// transposée : l'étape `Livré` du seed n'a pas de seuil et ses affaires ne sont jamais
		// figées. Colorer par précaution ferait crier l'écran sur une décision que personne n'a
		// prise, et c'est précisément l'issue n° 1 qu'INC-183 a écartée.
		expect(ancienneteEnRetard(avecSeuil(1000, null), maintenant)).toBe(false)
	})

	it('un budget ABSENT de la réponse n’est pas en retard non plus', () => {
		// Une réponse amputée ne doit pas teindre la table : le repli d'un fait inconnu est de ne
		// rien affirmer, comme pour la pilule « clôturé ».
		expect(ancienneteEnRetard(ligne({ budgets: null }), maintenant)).toBe(false)
	})

	it('LA COMPARAISON EST STRICTE : trente jours sur un seuil de trente n’est PAS en retard', () => {
		// « Au delà d'un seuil » (§5.31), et la borne large de la pastille d'une card
		// (`docs/SPEC-relances.md` §2.5). Deux signaux de même forme ne peuvent pas se lire à deux
		// bornes différentes. Un `>=` ici ferait rougir cette assertion, et c'est le point.
		expect(ancienneteEnRetard(avecSeuil(30, 30), maintenant)).toBe(false)
		expect(ancienneteEnRetard(avecSeuil(31, 30), maintenant)).toBe(true)
	})

	it('une ligne du jour n’est pas en retard, même sur un seuil de 1', () => {
		expect(ancienneteEnRetard(avecSeuil(0, 1), maintenant)).toBe(false)
	})

	it('une ANCIENNETÉ ILLISIBLE n’est jamais en retard — la cellule sera vide, pas rouge', () => {
		// Colorer une cellule vide affirmerait un retard sur une durée qu'on n'a pas su calculer.
		expect(
			ancienneteEnRetard(
				ligne({
					created_at: 'pas une date',
					budgets: {
						id: 'b1',
						name: 'Publicité 2026',
						currency: 'EUR',
						is_recurrent: true,
						closed_at: null,
						stale_after_days: 1,
					},
				}),
				maintenant,
			),
		).toBe(false)
	})

	it('un seuil NUL ou NÉGATIF rendu par la base est ignoré, pas appliqué', () => {
		// `budgets_stale_check` les refuse, mais une réponse amputée ou un contournement de la
		// contrainte ne doit pas transformer toute la table en rouge. La garde ne coûte rien.
		expect(ancienneteEnRetard(avecSeuil(5, 0), maintenant)).toBe(false)
		expect(ancienneteEnRetard(avecSeuil(5, -3), maintenant)).toBe(false)
	})

	it('LE SEUIL EST DEMANDÉ DANS LA LECTURE, sans quoi il vaudrait toujours `undefined`', () => {
		// Une preuve de comportement seule ne verrait pas ce défaut : le module rendrait `false`
		// partout, ce qui est exactement le comportement d'avant la tranche. C'est la REQUÊTE ÉMISE
		// qui le trahit.
		expect(COLONNES_LIGNE_A_SAISIR).toContain('stale_after_days')
	})
})

describe('compterEnAttente — le badge compte ce que le tableau liste', () => {
	it('compte toutes les lignes rendues, saisissables ou non', () => {
		// Les exclure ferait diverger le badge du tableau, et écrirait « 0 » à une lectrice qui a
		// pourtant des lignes sous les yeux (§4.8, « jamais masquées »).
		const lignes = [ligne(), ligne({ id: 'l2', reel_saisissable: false })]
		expect(compterEnAttente(lignes)).toBe(2)
	})

	it('compte aussi les lignes des budgets clos — l’écart d’INC-182, assumé et mesuré', () => {
		// C'est le jeu du seed : « Publicité » sur un budget ouvert, « Impression plaquettes » sur
		// « Salon du web 2025 » clos. La mention du §4.4 sous l'histogramme en compte UNE — le §4.2
		// exclut les budgets clos —, le badge en compte DEUX. Le §4.8 affirme les deux nombres égaux ;
		// ils ne le sont pas, l'écart est consigné à INC-182, et cette preuve le FIGE plutôt que de le
		// laisser dériver au premier refactoring.
		const lignes = [
			ligne(),
			ligne({
				id: 'l2',
				label: 'Impression plaquettes',
				budgets: {
					id: 'b2',
					name: 'Salon du web 2025',
					currency: 'EUR',
					is_recurrent: false,
					closed_at: '2026-06-30T17:00:00Z',
					stale_after_days: null,
				},
				budget_occurrences: null,
			}),
		]
		expect(compterEnAttente(lignes)).toBe(2)
		expect(lignes.filter(estClos)).toHaveLength(1)
	})

	it('rend 0 sur une liste vide — l’état « tous les coûts réels sont saisis »', () => {
		expect(compterEnAttente([])).toBe(0)
	})
})

describe('classerRefusSaisie — le code PostgreSQL d’abord, le statut ensuite', () => {
	it('range un débordement d’échelle sur son propre code, jamais en `unknown`', () => {
		// `actual_cost` est un `numeric(14,2)` : une saisie trop grande est refusée par la base, et
		// « une erreur est survenue » ferait chercher une panne là où un montant est trop grand.
		expect(classerRefusSaisie(400, '22003', 'numeric field overflow').nature).toBe(
			'montant-hors-echelle',
		)
	})

	it('range un `42501` remonté en 403 sur son CODE, pas sur son statut', () => {
		expect(classerRefusSaisie(403, undefined, 'permission denied').nature).toBe('forbidden')
		expect(classerRefusSaisie(400, '23503', 'foreign key').nature).toBe('reference-absente')
		expect(classerRefusSaisie(400, '23514', 'check').nature).toBe('forme-refusee')
	})

	it('range une absence de statut en `network`, jamais en `unknown`', () => {
		expect(classerRefusSaisie(undefined, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusSaisie(0, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusSaisie(500, undefined, 'boom').nature).toBe('unknown')
	})
})

describe('enregistrerReel — ce que la saisie envoie, et les trois issues', () => {
	it('n’envoie QUE `actual_cost`, et accompagne l’écriture d’un `select`', async () => {
		const { client, appels } = espion([{ data: [{ actual_cost: 376 }], error: null, status: 200 }])

		await enregistrerReel(client, 'l1', 376)

		expect(appels[0]?.action).toBe('update')
		// LA PREUVE DU §4.8.1. `modifierLigneCout` renvoie les cinq attributs ; ici le rattachement
		// n'est PAS envoyé, ce qui met la saisie hors d'atteinte du trigger de rattachement — et hors
		// d'atteinte de son évolution future.
		expect(appels[0]?.charge).toEqual({ actual_cost: 376 })
		expect(appels[0]?.filtres).toContainEqual(['eq:id', 'l1'])
		// Sans le `select`, PostgREST ne rend aucun corps et « zéro ligne touchée » serait
		// indistinguable d'un succès.
		expect(appels[0]?.colonnes).toBe('actual_cost')
	})

	it('rend la valeur RETENUE par la base, jamais celle qui a été tapée', async () => {
		// `numeric(14,2)` arrondit : c'est la valeur enregistrée que le §4.8 demande d'afficher sur la
		// ligne marquée « enregistré ».
		const { client } = espion([{ data: [{ actual_cost: 376.13 }], error: null, status: 200 }])

		const resultat = await enregistrerReel(client, 'l1', 376.129)

		expect(resultat).toEqual({ statut: 'applique', reel: 376.13 })
	})

	it('accepte ZÉRO, qui est une valeur et retire la ligne de l’attente', async () => {
		const { client, appels } = espion([{ data: [{ actual_cost: 0 }], error: null, status: 200 }])

		const resultat = await enregistrerReel(client, 'l1', 0)

		// « Zéro est une valeur, pas un vide » (§4.8). Une garde `if (!reel)` aurait ici refusé la
		// seule saisie qui dit « finalement rien dépensé ».
		expect(appels[0]?.charge).toEqual({ actual_cost: 0 })
		expect(resultat).toEqual({ statut: 'applique', reel: 0 })
	})

	it('accepte un montant NÉGATIF : un avoir est un coût légitime', async () => {
		const { client, appels } = espion([{ data: [{ actual_cost: -50 }], error: null, status: 200 }])

		const resultat = await enregistrerReel(client, 'l1', -50)

		// §2.1 : aucune contrainte de signe. Une garde d'interface poserait une règle de produit que
		// personne n'a prise (`CLAUDE.md` §10).
		expect(appels[0]?.charge).toEqual({ actual_cost: -50 })
		expect(resultat).toEqual({ statut: 'applique', reel: -50 })
	})

	it('rend `sans-effet` sur `200` et ZÉRO ligne, jamais un succès', async () => {
		const { client } = espion([{ data: [], error: null, status: 200 }])

		// C'est ce que rend la clause `USING` de `card_costs_modification` lorsque le droit d'écriture
		// est retombé depuis le chargement. Annoncer « Enregistré » serait la simulation de succès que
		// `CLAUDE.md` §18 interdit.
		expect(await enregistrerReel(client, 'l1', 10)).toEqual({ statut: 'sans-effet' })
	})

	it('rend `sans-effet` — jamais un succès replié sur la saisie — si la réponse n’a pas de montant', async () => {
		const { client } = espion([{ data: [{ actual_cost: null }], error: null, status: 200 }])

		// Un `?? reel` masquerait une réponse malformée derrière la saisie de l'utilisateur et ferait
		// croire enregistré ce qui ne l'est peut-être pas. Dire moins que mentir.
		expect(await enregistrerReel(client, 'l1', 10)).toEqual({ statut: 'sans-effet' })
	})

	it('classe un refus, et ne lève jamais', async () => {
		const { client } = espion([
			{ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 },
		])

		const resultat = await enregistrerReel(client, 'l1', 10)

		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('forbidden')
	})

	it('transforme une exception du client en refus `network`', async () => {
		const client = {
			from: () => {
				throw new Error('socket fermé')
			},
		} as unknown as ClientCrm

		const resultat = await enregistrerReel(client, 'l1', 10)

		expect(resultat.statut).toBe('refus')
		if (resultat.statut !== 'refus') return
		expect(resultat.refus.nature).toBe('network')
	})
})
