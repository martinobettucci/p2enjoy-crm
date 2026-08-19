// @verifies CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire, TRANCHE 2 : ce que la
//           section « Coûts » de la fiche lit et écrit
// @verifies docs/SPEC-costs.md §2.3 (`actual_cost` nul n'est PAS zéro, aucune contrainte de signe,
//           la devise vient du budget), §3.1 (la double condition de lecture, du côté client :
//           l'écran n'ajoute aucun filtre qui la contournerait), §4.4 (« n lignes sans coût réel
//           saisi, pour m € de prévisionnel »), §4.6 (le sélecteur ne propose que les budgets
//           ouverts et lisibles du track), §4.7 (un budget récurrent sans occurrence ouverte n'est
//           pas proposé)
// @verifies supabase/migrations/0051_card_costs.sql §2 (les messages du trigger, sur lesquels les
//           refus sont classés)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE autant que la valeur rendue, comme
// `budgets.test.ts` : trois exigences de la spécification sont portées par la requête elle-même —
// le filtre par track, le filtre des budgets clôturés, l'ordre — et un test qui n'observerait que
// la réponse les laisserait disparaître sans bruit.
//
// LE DERNIER TEST LIT LA MIGRATION SUR LE DISQUE, et c'est le seul moyen d'empêcher la dérive
// silencieuse que l'inspection de texte de `classerRefusCout` rend possible : un message reformulé
// dans `0051` sans être reporté ici rangerait le refus du trigger sous « vérifiez la nature de la
// dépense ».

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
	COLONNES_LIGNE_COUT,
	DEVISE_INCONNUE,
	FRAGMENTS_REFUS_COUT,
	calculerTotaux,
	classerRefusCout,
	compterLignesSansReel,
	creerLigneCout,
	libelleCoutConforme,
	lireBudgetsRattachables,
	lireCoutsCard,
	lireMontant,
	lireTrackDeLaCard,
	modifierLigneCout,
	supprimerLigneCout,
	type LigneCout,
} from './card-costs'
import type { ClientCrm } from './supabase'

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
	count?: number
}

type AppelLecture = {
	table?: string
	colonnes?: string
	options?: unknown
	filtres: [string, unknown][]
	tris: [string, unknown?][]
}

/** Client factice qui **enregistre** la requête de lecture construite, puis rend la réponse voulue. */
function espionLecture(reponse: Reponse): { client: ClientCrm; appels: AppelLecture[] } {
	const appels: AppelLecture[] = []
	const client = {
		from: (table: string) => {
			const appel: AppelLecture = { table, filtres: [], tris: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			const enregistrer = (nom: 'is' | 'eq' | 'in') => (colonne: string, valeur: unknown) => {
				appel.filtres.push([`${nom}:${colonne}`, valeur])
				return chaine
			}
			chaine.is = enregistrer('is')
			chaine.eq = enregistrer('eq')
			chaine.in = enregistrer('in')
			chaine.order = (colonne: string, options?: unknown) => {
				appel.tris.push([colonne, options])
				return chaine
			}
			chaine.maybeSingle = () => Promise.resolve(reponse)
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return {
				select: (colonnes: string, options?: unknown) => {
					appel.colonnes = colonnes
					appel.options = options
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

/** Client dont chaque `from` rend une réponse différente, dans l'ordre des appels. */
function espionSequence(reponses: readonly Reponse[]): { client: ClientCrm; appels: AppelLecture[] } {
	const appels: AppelLecture[] = []
	let rang = 0
	const client = {
		from: (table: string) => {
			const appel: AppelLecture = { table, filtres: [], tris: [] }
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
			chaine.order = (colonne: string, options?: unknown) => {
				appel.tris.push([colonne, options])
				return chaine
			}
			chaine.maybeSingle = () => Promise.resolve(reponse)
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return {
				select: (colonnes: string, options?: unknown) => {
					appel.colonnes = colonnes
					appel.options = options
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

type AppelEcriture = {
	table?: string
	verbe?: 'insert' | 'update' | 'delete'
	charge?: Record<string, unknown>
	filtres: [string, unknown][]
	colonnesRendues?: string
}

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
				delete: () => {
					appel.verbe = 'delete'
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
	for (const methode of ['is', 'eq', 'in', 'order', 'select', 'then', 'maybeSingle'])
		chaine[methode] = exploser
	return {
		from: () => ({
			select: () => chaine,
			insert: () => chaine,
			update: () => chaine,
			delete: () => chaine,
		}),
	} as unknown as ClientCrm
}

const vide: Reponse = { data: [], error: null, status: 200 }
const applique: Reponse = { data: [{ id: 'l1' }], error: null, status: 200 }

/** Une ligne minimale, dont chaque test ne surcharge que ce qu'il éprouve. */
function ligne(surcharge: Partial<LigneCout> = {}): LigneCout {
	return {
		id: 'l1',
		card_id: 'card-1',
		budget_id: 'b1',
		occurrence_id: null,
		label: 'Publicité',
		estimated_cost: 100,
		actual_cost: null,
		budgets: { id: 'b1', name: 'Publicité 2026', currency: 'EUR', is_recurrent: false, closed_at: null },
		budget_occurrences: null,
		...surcharge,
	}
}

// ---------------------------------------------------------------------------------------------
// Lecture des lignes
// ---------------------------------------------------------------------------------------------

describe('lireCoutsCard', () => {
	it('filtre par affaire, embarque le budget et l’occurrence, et ordonne par ancienneté', async () => {
		const { client, appels } = espionLecture(vide)
		await lireCoutsCard(client, 'card-1')
		expect(appels[0]?.table).toBe('card_costs')
		expect(appels[0]?.colonnes).toBe(COLONNES_LIGNE_COUT)
		expect(appels[0]?.filtres).toEqual([['eq:card_id', 'card-1']])
		expect(appels[0]?.tris).toEqual([
			['created_at', undefined],
			['label', undefined],
		])
	})

	it('embarque la devise du BUDGET et jamais celle de la card (§2.3)', () => {
		// La colonne de devise n'existe pas sur `card_costs` : la demander viendrait forcément du
		// budget embarqué. Ce contrôle protège la seule chose qui empêche un total d'additionner
		// deux monnaies.
		expect(COLONNES_LIGNE_COUT).toContain('budgets(')
		expect(COLONNES_LIGNE_COUT).toContain('currency')
		expect(COLONNES_LIGNE_COUT).not.toMatch(/\bcards\(/)
	})

	it('n’ajoute AUCUN filtre de budget : la double condition est tenue par la RLS (§3.1)', async () => {
		// Un filtre client sur le budget donnerait l'illusion du cloisonnement et le déplacerait dans
		// l'interface, où il ne vaut rien (`CLAUDE.md` §10). La seule condition envoyée est l'affaire.
		const { client, appels } = espionLecture(vide)
		await lireCoutsCard(client, 'card-1')
		expect(appels[0]?.filtres.map(([nom]) => nom)).toEqual(['eq:card_id'])
	})

	it('classe un refus de lecture plutôt que de lever', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'refus' }, status: 403 })
		const etat = await lireCoutsCard(client, 'card-1')
		expect(etat.statut).toBe('erreur')
	})

	it('classe une exception de transport en erreur', async () => {
		const etat = await lireCoutsCard(clientQuiLeve(new Error('coupure')), 'card-1')
		expect(etat).toMatchObject({ statut: 'erreur' })
	})
})

describe('lireTrackDeLaCard', () => {
	it('lit le track depuis le CHANNEL de l’affaire, jamais depuis l’adresse (INC-065)', async () => {
		const { client, appels } = espionLecture({
			data: [],
			error: null,
			status: 200,
		})
		// `maybeSingle` rend l'objet lui-même ; l'espion rend la réponse telle quelle, et la donnée
		// est ici un tableau vide — ce qui n'est pas un objet portant `channels`, donc `null`.
		const etat = await lireTrackDeLaCard(client, 'card-1')
		expect(appels[0]?.table).toBe('cards')
		// La relation est NOMMÉE par sa clé étrangère : `cards` en porte deux vers `channels`, et un
		// `channels(…)` nu rend `PGRST201`. Ce contrôle empêche la régression de revenir en silence.
		expect(appels[0]?.colonnes).toContain('channels!cards_channel_id_workspace_id_fkey(track_id)')
		expect(appels[0]?.filtres).toEqual([['eq:id', 'card-1']])
		expect(etat).toMatchObject({ statut: 'pret' })
	})

	it('rend `null` quand la card est refusée par la RLS, et non une erreur', async () => {
		// Zéro ligne n'est pas une erreur : `single` en aurait fait un `PGRST116` classé « inconnu »,
		// et l'écran aurait annoncé une panne là où il n'y a qu'un refus déjà rendu ailleurs.
		const { client } = espionLecture({ data: null, error: null, status: 200 })
		const etat = await lireTrackDeLaCard(client, 'card-1')
		expect(etat).toEqual({ statut: 'pret', donnees: null })
	})
})

// ---------------------------------------------------------------------------------------------
// Les budgets rattachables — §4.6 et §4.7
// ---------------------------------------------------------------------------------------------

describe('lireBudgetsRattachables', () => {
	it('filtre par track ET par clôture, côté serveur, et ordonne par position', async () => {
		const { client, appels } = espionSequence([vide])
		await lireBudgetsRattachables(client, 'track-1')
		expect(appels[0]?.table).toBe('budgets')
		expect(appels[0]?.filtres).toEqual([
			['eq:track_id', 'track-1'],
			['is:closed_at', null],
		])
		expect(appels[0]?.tris).toEqual([
			['position', undefined],
			['name', undefined],
		])
	})

	it('n’émet AUCUNE requête d’occurrences quand aucun budget n’est récurrent', async () => {
		const { client, appels } = espionSequence([
			{
				data: [{ id: 'b1', name: 'Salon', currency: 'EUR', is_recurrent: false, position: 1 }],
				error: null,
				status: 200,
			},
		])
		const etat = await lireBudgetsRattachables(client, 'track-1')
		expect(appels).toHaveLength(1)
		expect(etat).toMatchObject({ statut: 'pret' })
		if (etat.statut === 'pret') expect(etat.donnees).toHaveLength(1)
	})

	it('ne propose PAS un budget récurrent sans occurrence ouverte (§4.7)', async () => {
		const { client } = espionSequence([
			{
				data: [
					{ id: 'b1', name: 'Publicité 2026', currency: 'EUR', is_recurrent: true, position: 1 },
					{ id: 'b2', name: 'Salon', currency: 'EUR', is_recurrent: false, position: 2 },
				],
				error: null,
				status: 200,
			},
			// Aucune occurrence ouverte : `b1` n'est pas rattachable, le trigger de `0051` exigerait
			// une occurrence qu'il n'a pas.
			{ data: [], error: null, status: 200 },
		])
		const etat = await lireBudgetsRattachables(client, 'track-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees.map((budget) => budget.id)).toEqual(['b2'])
	})

	it('rattache à chaque budget récurrent SES occurrences ouvertes, en une seule requête', async () => {
		const { client, appels } = espionSequence([
			{
				data: [
					{ id: 'b1', name: 'Publicité 2026', currency: 'EUR', is_recurrent: true, position: 1 },
					{ id: 'b3', name: 'Régie', currency: 'CHF', is_recurrent: true, position: 2 },
				],
				error: null,
				status: 200,
			},
			{
				data: [
					{ id: 'o1', budget_id: 'b1', label: 'Février 2026', closed_at: null, period_start: null },
					{ id: 'o2', budget_id: 'b3', label: 'T1', closed_at: null, period_start: null },
					{ id: 'o3', budget_id: 'b1', label: 'Mars 2026', closed_at: null, period_start: null },
				],
				error: null,
				status: 200,
			},
		])
		const etat = await lireBudgetsRattachables(client, 'track-1')
		expect(appels).toHaveLength(2)
		expect(appels[1]?.filtres).toEqual([
			['in:budget_id', ['b1', 'b3']],
			['is:closed_at', null],
		])
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees[0]?.occurrences.map((o) => o.id)).toEqual(['o1', 'o3'])
		expect(etat.donnees[1]?.occurrences.map((o) => o.id)).toEqual(['o2'])
	})

	it('remonte l’erreur de la seconde requête plutôt que de rendre des budgets sans occurrence', async () => {
		// Rendre la liste malgré l'échec proposerait des budgets récurrents dont le second sélecteur
		// serait vide : l'utilisateur choisirait, puis se verrait refuser sans comprendre.
		const { client } = espionSequence([
			{
				data: [{ id: 'b1', name: 'Publicité', currency: 'EUR', is_recurrent: true, position: 1 }],
				error: null,
				status: 200,
			},
			{ data: null, error: { message: 'refus' }, status: 403 },
		])
		const etat = await lireBudgetsRattachables(client, 'track-1')
		expect(etat.statut).toBe('erreur')
	})
})

// ---------------------------------------------------------------------------------------------
// Les totaux — §4.4 et §4.6
// ---------------------------------------------------------------------------------------------

describe('calculerTotaux', () => {
	it('n’ajoute PAS un réel inconnu au réel : nul n’est pas zéro (§2.3)', () => {
		// Le cas du responsable, mot pour mot : « Publicité — estimé 100, réel inconnu » et
		// « Production — estimé 350, réel 375 ».
		const totaux = calculerTotaux([
			ligne({ id: 'l1', label: 'Publicité', estimated_cost: 100, actual_cost: null }),
			ligne({ id: 'l2', label: 'Production', estimated_cost: 350, actual_cost: 375 }),
		])
		expect(totaux).toEqual([
			{ devise: 'EUR', estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100 },
		])
	})

	it('compte les lignes sans réel ET leur prévisionnel, comme le §4.4 l’exige', () => {
		const totaux = calculerTotaux([
			ligne({ id: 'l1', estimated_cost: 100, actual_cost: null }),
			ligne({ id: 'l2', estimated_cost: 40, actual_cost: null }),
			ligne({ id: 'l3', estimated_cost: 10, actual_cost: 10 }),
		])
		expect(totaux[0]).toMatchObject({ sansReel: 2, estimeSansReel: 140 })
	})

	it('distingue un réel à ZÉRO d’un réel inconnu', () => {
		// « Zéro est une valeur, pas un vide » (§4.8) : une ligne à 0 est saisie, elle ne compte donc
		// pas parmi les lignes en attente.
		const totaux = calculerTotaux([ligne({ estimated_cost: 100, actual_cost: 0 })])
		expect(totaux[0]).toMatchObject({ reel: 0, sansReel: 0, estimeSansReel: 0 })
	})

	it('ne mélange JAMAIS deux devises dans un même total (§4.5)', () => {
		const totaux = calculerTotaux([
			ligne({ id: 'l1', estimated_cost: 100, actual_cost: 90 }),
			ligne({
				id: 'l2',
				estimated_cost: 200,
				actual_cost: 180,
				budgets: { id: 'b2', name: 'Suisse', currency: 'CHF', is_recurrent: false, closed_at: null },
			}),
		])
		expect(totaux).toHaveLength(2)
		expect(totaux.map((total) => total.devise)).toEqual(['EUR', 'CHF'])
		expect(totaux[1]).toMatchObject({ estime: 200, reel: 180 })
	})

	it('accepte les montants négatifs — avoir, remise, remboursement (§2.3)', () => {
		const totaux = calculerTotaux([
			ligne({ id: 'l1', estimated_cost: 100, actual_cost: 100 }),
			ligne({ id: 'l2', estimated_cost: -30, actual_cost: -30 }),
		])
		expect(totaux[0]).toMatchObject({ estime: 70, reel: 70 })
	})

	it('compte une ligne dont le budget n’est pas rendu sous une devise inconnue plutôt que de la taire', () => {
		// La taire ferait un total silencieusement incomplet, ce qui est exactement le défaut que ce
		// groupement existe pour éviter.
		const totaux = calculerTotaux([ligne({ budgets: null, estimated_cost: 12 })])
		expect(totaux).toEqual([
			{ devise: DEVISE_INCONNUE, estime: 12, reel: 0, sansReel: 1, estimeSansReel: 12 },
		])
	})

	it('rend une liste vide sans ligne, et non un total à zéro', () => {
		// Un total à zéro affirmerait « cette affaire a coûté 0 » ; l'absence de ligne dit « on n'en
		// sait rien », et l'état vide du §4.7 s'en charge.
		expect(calculerTotaux([])).toEqual([])
	})
})

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

describe('libelleCoutConforme', () => {
	it('refuse le vide et les blancs seuls, comme `app.btrim_blancs` en base', () => {
		expect(libelleCoutConforme('')).toBe(false)
		expect(libelleCoutConforme('   ')).toBe(false)
		expect(libelleCoutConforme('Publicité')).toBe(true)
	})
})

describe('lireMontant', () => {
	it('distingue absent, lu et invalide', () => {
		expect(lireMontant('')).toEqual({ statut: 'absent' })
		expect(lireMontant('   ')).toEqual({ statut: 'absent' })
		expect(lireMontant('350.75')).toEqual({ statut: 'lu', montant: 350.75 })
		expect(lireMontant('abc')).toEqual({ statut: 'invalide' })
	})

	it('refuse une queue non numérique, là où `parseFloat` l’ignorerait', () => {
		// `parseFloat('12abc')` rend 12 : accepter cette saisie enregistrerait un montant que
		// personne n'a voulu.
		expect(lireMontant('12abc')).toEqual({ statut: 'invalide' })
	})

	it('accepte un montant négatif et un zéro', () => {
		expect(lireMontant('-30')).toEqual({ statut: 'lu', montant: -30 })
		expect(lireMontant('0')).toEqual({ statut: 'lu', montant: 0 })
	})
})

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

describe('classerRefusCout', () => {
	it('classe sur le code PostgreSQL AVANT le statut HTTP', () => {
		// Un `CHECK` remonte avec un statut d'erreur ; classer par le statut d'abord dirait « vous
		// n'avez pas le droit » là où c'est l'occurrence qui manque.
		expect(
			classerRefusCout(400, '23514', 'ce budget est récurrent : une ligne de coût doit citer une occurrence'),
		).toMatchObject({ nature: 'occurrence-exigee' })
	})

	it('sépare les quatre refus du trigger, qui appellent quatre gestes différents', () => {
		expect(classerRefusCout(400, '23514', '… doit citer une occurrence …').nature).toBe(
			'occurrence-exigee',
		)
		expect(classerRefusCout(400, '23514', '… ne cite aucune occurrence …').nature).toBe(
			'occurrence-interdite',
		)
		expect(classerRefusCout(400, '23514', 'cette occurrence appartient à un autre budget').nature).toBe(
			'occurrence-etrangere',
		)
		expect(classerRefusCout(400, '23514', 'ce budget est clôturé : …').nature).toBe(
			'rattachement-clos',
		)
	})

	it('range les QUATRE messages de clôture sous un seul refus', () => {
		// Ils appellent le même geste — recharger, le cadre a changé — et les séparer inventerait une
		// nuance que l'utilisateur ne peut pas exploiter.
		for (const message of [
			"ce budget est clôturé : il n'accepte aucun rattachement",
			"cette occurrence est clôturée : elle n'accepte aucun rattachement",
			'cette ligne est rattachée à un budget clôturé : son rattachement ne change plus',
			'cette ligne est rattachée à une occurrence clôturée : son rattachement ne change plus',
		]) {
			expect(classerRefusCout(400, '23514', message).nature).toBe('rattachement-clos')
		}
	})

	it('range un `23514` inconnu sous « forme refusée », jamais sous une clôture', () => {
		expect(classerRefusCout(400, '23514', 'violates check constraint').nature).toBe('forme-refusee')
	})

	it('classe la clé étrangère, le refus d’autorisation, la coupure et l’inconnu', () => {
		expect(classerRefusCout(409, '23503', 'fk').nature).toBe('reference-absente')
		expect(classerRefusCout(403, '42501', 'rls').nature).toBe('forbidden')
		expect(classerRefusCout(401, undefined, 'jwt').nature).toBe('forbidden')
		expect(classerRefusCout(undefined, undefined, 'coupure').nature).toBe('network')
		expect(classerRefusCout(500, undefined, 'boum').nature).toBe('unknown')
	})

	it('les fragments inspectés se trouvent RÉELLEMENT dans la migration 0051', () => {
		// C'est le contrôle qui empêche la dérive : le trigger et les `CHECK` partagent le SQLSTATE
		// `23514`, et rien d'autre que le message ne les sépare. Un message reformulé en base sans
		// être reporté ici rangerait le refus du trigger sous « vérifiez la nature de la dépense ».
		const migration = readFileSync('supabase/migrations/0051_card_costs.sql', 'utf8')
		for (const [fragment] of FRAGMENTS_REFUS_COUT) {
			expect(migration, `fragment absent de la migration : ${fragment}`).toContain(fragment)
		}
	})
})

// ---------------------------------------------------------------------------------------------
// Les écritures
// ---------------------------------------------------------------------------------------------

describe('creerLigneCout', () => {
	it('envoie l’affaire, le rattachement et les deux montants, et n’envoie PAS `created_by`', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerLigneCout(client, 'card-1', {
			idBudget: 'b1',
			idOccurrence: 'o1',
			libelle: 'Publicité',
			estime: 100,
			reel: null,
		})
		expect(appel.table).toBe('card_costs')
		expect(appel.verbe).toBe('insert')
		expect(appel.charge).toEqual({
			card_id: 'card-1',
			budget_id: 'b1',
			occurrence_id: 'o1',
			label: 'Publicité',
			estimated_cost: 100,
			actual_cost: null,
		})
		// `created_by` est une TRACE posée par la base, jamais un droit : l'envoyer laisserait croire
		// que l'auteur se choisit.
		expect(appel.charge).not.toHaveProperty('created_by')
	})

	it('envoie `null` et JAMAIS `0` pour un réel inconnu (§2.3)', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerLigneCout(client, 'card-1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'Production',
			estime: 350,
			reel: null,
		})
		expect(appel.charge?.actual_cost).toBeNull()
		expect(appel.charge?.actual_cost).not.toBe(0)
	})

	it('envoie `0` quand l’utilisateur a saisi zéro — c’est une valeur, pas un vide', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerLigneCout(client, 'card-1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'Production',
			estime: 350,
			reel: 0,
		})
		expect(appel.charge?.actual_cost).toBe(0)
	})

	it('demande `select` pour distinguer « zéro ligne touchée » d’un succès', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerLigneCout(client, 'card-1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'x',
			estime: 1,
			reel: null,
		})
		expect(appel.colonnesRendues).toBe('id')
	})

	it('rend « refus » avec la nature classée', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: '… doit citer une occurrence …', code: '23514' },
			status: 400,
		})
		const resultat = await creerLigneCout(client, 'card-1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'x',
			estime: 1,
			reel: null,
		})
		expect(resultat).toMatchObject({ statut: 'refus', refus: { nature: 'occurrence-exigee' } })
	})
})

describe('modifierLigneCout', () => {
	it('cible la ligne et réenvoie le rattachement tel quel', async () => {
		const { client, appel } = espionEcriture(applique)
		await modifierLigneCout(client, 'l1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'Production',
			estime: 350,
			reel: 375,
		})
		expect(appel.verbe).toBe('update')
		expect(appel.filtres).toEqual([['id', 'l1']])
		expect(appel.charge).toMatchObject({ budget_id: 'b1', actual_cost: 375 })
	})

	it('rend « sans-effet » quand la politique filtre par son `USING`', async () => {
		// `200` et zéro ligne : ni un succès, ni une erreur. Sans le `select`, ce cas serait
		// indistinguable d'une modification appliquée.
		const { client } = espionEcriture(vide)
		const resultat = await modifierLigneCout(client, 'l1', {
			idBudget: 'b1',
			idOccurrence: null,
			libelle: 'x',
			estime: 1,
			reel: null,
		})
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})
})

describe('supprimerLigneCout', () => {
	it('supprime par identifiant et demande `select`', async () => {
		const { client, appel } = espionEcriture(applique)
		await supprimerLigneCout(client, 'l1')
		expect(appel.verbe).toBe('delete')
		expect(appel.filtres).toEqual([['id', 'l1']])
		expect(appel.colonnesRendues).toBe('id')
	})

	it('rend « sans-effet » sur un budget clôturé — le `USING` filtre, il ne lève pas', async () => {
		// MESURÉ à la décision 473 : aucun trigger ne garde le `DELETE`, la politique exige
		// `app.budget_est_ouvert` dans son `USING`, et PostgREST rend `200 []`.
		const { client } = espionEcriture(vide)
		expect(await supprimerLigneCout(client, 'l1')).toEqual({ statut: 'sans-effet' })
	})

	it('classe une exception de transport en refus réseau', async () => {
		const resultat = await supprimerLigneCout(clientQuiLeve(new Error('coupure')), 'l1')
		expect(resultat).toMatchObject({ statut: 'refus', refus: { nature: 'network' } })
	})
})

// ---------------------------------------------------------------------------------------------
// Le décompte du §4.1 — le reste de `CRM-084`
// ---------------------------------------------------------------------------------------------

describe('compterLignesSansReel', () => {
	it('compte sans rapporter les lignes, et filtre sur le budget et le réel nul', async () => {
		const { client, appels } = espionLecture({ data: null, error: null, status: 200, count: 3 })
		const etat = await compterLignesSansReel(client, 'b1')
		expect(appels[0]?.table).toBe('card_costs')
		expect(appels[0]?.options).toEqual({ count: 'exact', head: true })
		expect(appels[0]?.filtres).toEqual([
			['eq:budget_id', 'b1'],
			['is:actual_cost', null],
		])
		expect(etat).toEqual({ statut: 'pret', donnees: 3 })
	})

	it('rend zéro quand PostgREST n’a rendu aucun compte, et non `null`', async () => {
		const { client } = espionLecture({ data: null, error: null, status: 200 })
		expect(await compterLignesSansReel(client, 'b1')).toEqual({ statut: 'pret', donnees: 0 })
	})

	it('rend une erreur plutôt qu’un zéro quand la lecture échoue', async () => {
		// Un zéro rendu sur un échec dirait « rien à saisir » : la valeur par défaut trompeuse de
		// `CLAUDE.md` §18, sur la phrase même qui existe pour éviter une clôture aveugle.
		const { client } = espionLecture({ data: null, error: { message: 'refus' }, status: 403 })
		expect((await compterLignesSansReel(client, 'b1')).statut).toBe('erreur')
	})
})
