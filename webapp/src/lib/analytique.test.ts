// @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//           TRANCHE 2 b : le repli et les deux grandeurs dérivées
// @verifies docs/SPEC-analytique.md §5.2 (les trois portées se déduisent par sommation),
//           §5.5 (une ligne n'existe que si elle est peuplée), §7.1 (taux des affaires DÉCIDÉES, et
//           l'INCONNU quand il n'y en a aucune), §7.2 (prévisionnel par devise, terminaux exclus),
//           §7.3 (les deux compteurs d'absence), §11.2 (aucune addition de deux devises)
// @verifies docs/SCHEMA.md §9 bis.11 (les quatorze colonnes rendues)
//
// Ces tests portent sur la LOGIQUE, sans navigateur ni pile : c'est ce que la séparation du module
// rend possible. La règle elle-même — probabilité effective, exclusions, montant pondéré — est
// éprouvée en base par `supabase/tests/0068_entonnoir_conversion.test.sql`, et par la vraie route
// dans `e2e/api/analytique.spec.ts`. Rien n'est doublé ici : ce fichier éprouve ce que le SERVEUR NE
// FAIT PAS.
//
// LA FIXTURE REPRODUIT LE JEU DE DÉMONSTRATION RÉEL, replié par nœud et par devise
// (`docs/SPEC-analytique.md` M6). Les nombres attendus sont donc les MÊMES que ceux que la pile rend
// — 333 715,00 EUR, 34 600,00 CHF, sept gagnées contre une perdue —, et une divergence entre ce
// fichier et la mesure se voit au lieu de se cacher derrière des valeurs inventées pour l'occasion.

import { describe, expect, it, vi } from 'vitest'
import {
	absences,
	lireEntonnoir,
	previsionnel,
	replier,
	restreindre,
	tauxConversion,
	type LigneEntonnoirLue,
} from './analytique'
import type { ClientCrm } from './supabase'

/** Une ligne de l'entonnoir, telle que `public.entonnoir_conversion()` la rend. */
const ligne = (partiel: Partial<LigneEntonnoirLue>): LigneEntonnoirLue => ({
	workspace_id: 'ws1',
	track_id: 'tr1',
	channel_id: 'ch1',
	node_id: 'n1',
	node_key: 'prospection',
	node_label: 'Prospection',
	node_kind: 'open',
	node_position: 1,
	currency: 'EUR',
	affaires: 1,
	affaires_sans_montant: 0,
	affaires_sans_probabilite: 0,
	montant: 1000,
	montant_pondere: 100,
	...partiel,
})

const NOEUDS = {
	prospection: { node_id: 'n1', node_key: 'prospection', node_label: 'Prospection', node_kind: 'open', node_position: 1 },
	relance: { node_id: 'n2', node_key: 'relance', node_label: 'Relance', node_kind: 'open', node_position: 2 },
	negociation: { node_id: 'n3', node_key: 'negociation', node_label: 'Négociation', node_kind: 'open', node_position: 3 },
	signature: { node_id: 'n4', node_key: 'signature', node_label: 'Signature', node_kind: 'open', node_position: 4 },
	realisation: { node_id: 'n5', node_key: 'realisation', node_label: 'Réalisation', node_kind: 'open', node_position: 5 },
	livre: { node_id: 'n6', node_key: 'livre', node_label: 'Livré', node_kind: 'won', node_position: 6 },
	perdu: { node_id: 'n7', node_key: 'perdu', node_label: 'Perdu', node_kind: 'lost', node_position: 7 },
} as const

/** Le jeu de démonstration replié — `docs/SPEC-analytique.md` M6, valeurs MESURÉES le 2026-08-30. */
const SEED: readonly LigneEntonnoirLue[] = [
	ligne({ ...NOEUDS.prospection, currency: 'EUR', affaires: 11, affaires_sans_montant: 1, montant: 294200, montant_pondere: 29420 }),
	ligne({ ...NOEUDS.relance, currency: 'CHF', affaires: 1, montant: 47000, montant_pondere: 9400 }),
	ligne({ ...NOEUDS.relance, currency: 'EUR', affaires: 8, montant: 284350, montant_pondere: 56870 }),
	ligne({ ...NOEUDS.negociation, currency: 'EUR', affaires: 9, montant: 366850, montant_pondere: 183425 }),
	ligne({ ...NOEUDS.signature, currency: 'CHF', affaires: 1, montant: 28000, montant_pondere: 25200 }),
	ligne({ ...NOEUDS.realisation, currency: 'EUR', affaires: 1, montant: 64000, montant_pondere: 64000 }),
	ligne({ ...NOEUDS.livre, currency: 'EUR', affaires: 7, montant: 311000, montant_pondere: 311000 }),
	ligne({ ...NOEUDS.perdu, currency: 'EUR', affaires: 1, montant: 31000, montant_pondere: 0 }),
]

describe('restreindre — les trois portées, par sommation (§5.2)', () => {
	const lignes = [
		ligne({ track_id: 'trA', channel_id: 'chA' }),
		ligne({ track_id: 'trA', channel_id: 'chB' }),
		ligne({ track_id: 'trB', channel_id: 'chC' }),
	]

	it('le workspace rend TOUTES les lignes, sans en recopier aucune', () => {
		expect(restreindre(lignes, { type: 'workspace' })).toEqual(lignes)
	})

	it('un track rend les lignes de SES channels, et pas celles d’un autre track', () => {
		expect(restreindre(lignes, { type: 'track', id: 'trA' }).map((l) => l.channel_id)).toEqual([
			'chA',
			'chB',
		])
	})

	it('un channel rend la sienne', () => {
		expect(restreindre(lignes, { type: 'channel', id: 'chC' }).map((l) => l.track_id)).toEqual([
			'trB',
		])
	})

	it('une portée sans aucune ligne rend le vide, jamais tout', () => {
		// Un filtre qui rendrait `lignes` sur un identifiant inconnu ferait afficher le portefeuille
		// entier sous le titre d'un track — la valeur par défaut trompeuse que `CLAUDE.md` §18
		// interdit.
		expect(restreindre(lignes, { type: 'track', id: 'inexistant' })).toEqual([])
	})
})

describe('replier — par nœud ET par devise (§5.1, §11.2)', () => {
	it('fusionne deux channels au même nœud et dans la même devise', () => {
		const replie = replier([
			ligne({ channel_id: 'chA', affaires: 3, montant: 300, montant_pondere: 30 }),
			ligne({ channel_id: 'chB', affaires: 2, montant: 200, montant_pondere: 20 }),
		])
		expect(replie).toHaveLength(1)
		expect(replie[0]?.affaires).toBe(5)
		expect(replie[0]?.montant).toBe(500)
		expect(replie[0]?.montantPondere).toBe(50)
	})

	it('NE fusionne PAS deux devises au même nœud — les additionner exigerait un taux de change', () => {
		const replie = replier([
			ligne({ currency: 'EUR', affaires: 3, montant: 300 }),
			ligne({ currency: 'CHF', affaires: 2, montant: 200 }),
		])
		expect(replie).toHaveLength(2)
		expect(replie.map((n) => n.devise)).toEqual(['CHF', 'EUR'])
	})

	it('range par POSITION du catalogue, puis par devise — jamais par ordre d’arrivée', () => {
		// L'ordre d'arrivée ne survit pas à une restriction de portée : la position vient du
		// catalogue, donc de la même autorité que l'ordre du board.
		const replie = replier([...SEED].reverse())
		expect(replie.map((n) => `${n.cle}/${n.devise}`)).toEqual([
			'prospection/EUR',
			'relance/CHF',
			'relance/EUR',
			'negociation/EUR',
			'signature/CHF',
			'realisation/EUR',
			'livre/EUR',
			'perdu/EUR',
		])
	})

	it('cumule les DEUX compteurs d’absence, que l’écran doit dire (§7.3)', () => {
		const replie = replier([
			ligne({ channel_id: 'chA', affaires: 2, affaires_sans_montant: 1, affaires_sans_probabilite: 2 }),
			ligne({ channel_id: 'chB', affaires: 3, affaires_sans_montant: 2, affaires_sans_probabilite: 0 }),
		])
		expect(replie[0]?.affairesSansMontant).toBe(3)
		expect(replie[0]?.affairesSansProbabilite).toBe(2)
	})

	it('retient le genre du nœud, dont dépendent les deux grandeurs dérivées', () => {
		const replie = replier(SEED)
		expect(replie.find((n) => n.cle === 'livre')?.genre).toBe('won')
		expect(replie.find((n) => n.cle === 'perdu')?.genre).toBe('lost')
		expect(replie.find((n) => n.cle === 'realisation')?.genre).toBe('open')
	})

	it('additionne au CENTIME, sans poussière binaire', () => {
		const replie = replier([
			ligne({ channel_id: 'chA', montant: 0.1, montant_pondere: 0.1 }),
			ligne({ channel_id: 'chB', montant: 0.2, montant_pondere: 0.2 }),
		])
		expect(replie[0]?.montant).toBe(0.3)
		expect(replie[0]?.montantPondere).toBe(0.3)
	})

	it('rend le vide sur une entrée vide, et non une barre à zéro', () => {
		expect(replier([])).toEqual([])
	})
})

describe('previsionnel — les seules affaires OUVERTES, par devise (§7.2)', () => {
	it('rend les deux totaux mesurés sur le jeu de démonstration', () => {
		expect(previsionnel(SEED)).toEqual([
			{ devise: 'CHF', montant: 34600 },
			{ devise: 'EUR', montant: 333715 },
		])
	})

	it('EXCLUT les nœuds terminaux — une affaire gagnée n’est plus une prévision', () => {
		// Le contrôle porte sur le nombre : 333 715,00 vaut la somme des seules lignes `open`, et
		// inclure « Livré » y ajouterait 311 000,00. Un test qui ne vérifierait que « le total est
		// positif » resterait vert sur cette régression.
		const avecTerminaux = SEED.filter((l) => l.currency === 'EUR').reduce(
			(somme, l) => somme + l.montant_pondere,
			0,
		)
		expect(avecTerminaux).toBe(644715)
		expect(previsionnel(SEED).find((p) => p.devise === 'EUR')?.montant).toBe(333715)
	})

	it('n’invente AUCUNE devise dont toutes les affaires sont closes', () => {
		// « CHF : 0,00 » se lirait comme une prévision nulle au lieu d'une absence de prévision.
		const closes = [
			ligne({ ...NOEUDS.livre, currency: 'CHF', montant_pondere: 5000 }),
			ligne({ ...NOEUDS.prospection, currency: 'EUR', montant_pondere: 100 }),
		]
		expect(previsionnel(closes)).toEqual([{ devise: 'EUR', montant: 100 }])
	})

	it('rend le vide quand rien n’est ouvert', () => {
		expect(previsionnel([ligne({ ...NOEUDS.perdu, montant_pondere: 0 })])).toEqual([])
	})
})

describe('tauxConversion — les affaires DÉCIDÉES, et l’inconnu (§7.1)', () => {
	it('rend sept gagnées contre une perdue sur le jeu de démonstration, soit 87,5 %', () => {
		expect(tauxConversion(SEED)).toEqual({
			gagnees: 7,
			perdues: 1,
			decidees: 8,
			taux: 0.875,
		})
	})

	it('AUCUNE affaire décidée rend INCONNU, et jamais 0 %', () => {
		// Un taux de 0 % dit « tout a été perdu » ; l'absence de toute décision ne dit rien. C'est la
		// distinction que l'écran doit rendre, et la porter dans le type est ce qui empêche un
		// `?? 0` de l'effacer.
		const ouvertes = SEED.filter((l) => l.node_kind === 'open')
		expect(tauxConversion(ouvertes)).toEqual({
			gagnees: 0,
			perdues: 0,
			decidees: 0,
			taux: null,
		})
	})

	it('rend 0 % quand tout est PERDU — ce cas-là est un vrai zéro', () => {
		expect(tauxConversion([ligne({ ...NOEUDS.perdu, affaires: 4 })]).taux).toBe(0)
	})

	it('rend 100 % quand tout est gagné', () => {
		expect(tauxConversion([ligne({ ...NOEUDS.livre, affaires: 3 })]).taux).toBe(1)
	})

	it('compte les affaires À TRAVERS les devises — ce sont des affaires, pas des montants', () => {
		// C'est la seule grandeur du module qui traverse les devises, et elle le peut précisément
		// parce qu'elle n'additionne aucun argent.
		const deuxDevises = [
			ligne({ ...NOEUDS.livre, currency: 'EUR', affaires: 2 }),
			ligne({ ...NOEUDS.livre, currency: 'CHF', affaires: 1 }),
			ligne({ ...NOEUDS.perdu, currency: 'CHF', affaires: 1 }),
		]
		expect(tauxConversion(deuxDevises)).toEqual({
			gagnees: 3,
			perdues: 1,
			decidees: 4,
			taux: 0.75,
		})
	})
})

describe('absences — ce qu’un total ne dit pas (§7.3)', () => {
	it('somme les deux compteurs sur la portée affichée', () => {
		expect(absences(SEED)).toEqual({ sansMontant: 1, sansProbabilite: 0 })
	})

	it('les compte APRÈS restriction de portée, jamais sur le workspace entier', () => {
		const lignes = [
			ligne({ track_id: 'trA', affaires_sans_montant: 5 }),
			ligne({ track_id: 'trB', affaires_sans_montant: 2 }),
		]
		expect(absences(restreindre(lignes, { type: 'track', id: 'trB' })).sansMontant).toBe(2)
	})
})

describe('lireEntonnoir — une seule requête, et un refus qui reste un refus', () => {
	const clientDouble = (reponse: {
		data?: unknown
		error?: { message: string } | null
		status?: number
	}): ClientCrm =>
		({
			rpc: vi.fn(() =>
				Promise.resolve({
					data: reponse.data ?? [],
					error: reponse.error ?? null,
					status: reponse.status ?? 200,
				}),
			),
		}) as unknown as ClientCrm

	it('appelle `entonnoir_conversion`, et rien d’autre', async () => {
		const client = clientDouble({ data: SEED })
		const etat = await lireEntonnoir(client)
		// UNE SEULE requête : la fonction rend le grain le plus fin, et les trois portées s'en
		// déduisent par sommation (§5.2). Un appel par track serait la régression que ce contrôle
		// empêche.
		expect(client.rpc).toHaveBeenCalledTimes(1)
		expect(client.rpc).toHaveBeenCalledWith('entonnoir_conversion')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toHaveLength(8)
	})

	it('un `401` reste un REFUS, jamais un état vide', async () => {
		// La fonction est refusée à `anon` par le PRIVILÈGE : déguiser ce refus en « aucune affaire »
		// ferait lire une absence de droit comme un portefeuille vide.
		const etat = await lireEntonnoir(
			clientDouble({ error: { message: 'permission denied' }, status: 401 }),
		)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})

	it('une panne réseau est classée comme telle, et non comme un refus', async () => {
		const client = {
			rpc: vi.fn(() => Promise.reject(new Error('fetch failed'))),
		} as unknown as ClientCrm
		const etat = await lireEntonnoir(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('network')
	})

	it('une réponse sans donnée rend un état PRÊT et vide, non une erreur', async () => {
		const etat = await lireEntonnoir(clientDouble({ data: null }))
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual([])
	})
})
