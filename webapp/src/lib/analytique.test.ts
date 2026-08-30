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
	COLONNES_CATALOGUE,
	absences,
	lireEntonnoir,
	lireNoeudsCatalogue,
	noeudsSansAffaire,
	previsionnel,
	grouperParDevise,
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

describe('grouperParDevise — un tableau par devise (§5.48 du design system)', () => {
	it('sépare les deux devises du jeu de démonstration, et les classe par code', () => {
		// Le seed porte huit lignes repliées sur DEUX devises : six en euros, deux en francs. Le
		// groupement rend donc deux tableaux, `CHF` avant `EUR` — l'ordre du code, celui que
		// `previsionnel` retient déjà.
		const groupes = grouperParDevise(replier(SEED))
		expect(groupes.map((g) => g.devise)).toEqual(['CHF', 'EUR'])
		expect(groupes[0]?.noeuds).toHaveLength(2)
		expect(groupes[1]?.noeuds).toHaveLength(6)
	})

	it('PRÉSERVE l’ordre du catalogue à l’intérieur d’un groupe, il ne le rejoue pas', () => {
		// Un entonnoir est un CHEMIN (§5.48) : le reclasser par montant en ferait un palmarès, où
		// « Perdu » remonterait au-dessus de « Prospection ». `replier` a déjà trié par
		// `node_position` ; ce groupement ne fait que filtrer, et un second tri ici divergerait du
		// premier au premier changement de l'un.
		const euros = grouperParDevise(replier(SEED)).find((g) => g.devise === 'EUR')
		expect(euros?.noeuds.map((n) => n.cle)).toEqual([
			'prospection',
			'relance',
			'negociation',
			'realisation',
			'livre',
			'perdu',
		])
	})

	it('n’INVENTE aucun nœud dans une devise qui ne le peuple pas', () => {
		// `Négociation` n'existe qu'en euros sur le seed. Rendre `Négociation / CHF / 0` inventerait
		// une devise à un nœud qu'aucune affaire n'y porte — ce que le §5.1 interdit déjà à la
		// fonction elle-même.
		const francs = grouperParDevise(replier(SEED)).find((g) => g.devise === 'CHF')
		expect(francs?.noeuds.map((n) => n.cle)).toEqual(['relance', 'signature'])
	})

	it('un entonnoir vide rend AUCUN groupe, jamais un groupe vide', () => {
		expect(grouperParDevise([])).toEqual([])
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

// @verifies CRM-066 — TRANCHE 3 c : les nœuds du catalogue sans affaire, NOMMÉS
// @verifies docs/SPEC-analytique.md §8 bis.5 (la forme tranchée : un nom, jamais un zéro),
//           §5.1 (révisé sur place : « nomme » remplace « affiche zéro »), §11.2
describe('noeudsSansAffaire — le trou de l’entonnoir, nommé et non chiffré (§8 bis.5)', () => {
	const noeud = (id: string, cle: string, libelle: string, position: number) => ({
		id,
		cle,
		libelle,
		genre: 'open' as const,
		position,
	})

	const CATALOGUE = [
		noeud('n1', 'prospection', 'Prospection', 1),
		noeud('n3', 'negociation', 'Négociation', 3),
		noeud('n8', 'qualification', 'Qualification', 8),
	]

	it('rend les nœuds qu’aucune ligne ne peuple, dans l’ordre du CATALOGUE', () => {
		// LA FIXTURE EST CE QUE LA LECTURE REND, jamais ce que la table contient : `lireNoeudsCatalogue`
		// écarte les archivés côté serveur. Sur le seed, le seul nœud vide de l'espace de travail est
		// précisément l'archivé — c'est la portée RESTREINTE qui exerce vraiment cette fonction
		// (§8 bis.5), et `Pilotage.test.tsx` l'éprouve.
		const vides = noeudsSansAffaire(CATALOGUE, [
			ligne({ node_id: 'n1' }),
			ligne({ node_id: 'n3' }),
		])
		expect(vides.map((n) => n.cle)).toEqual(['qualification'])
	})

	it('L’ORDRE EST CELUI DU CATALOGUE, et c’est lui qui dit OÙ est le trou', () => {
		// L'entonnoir est un CHEMIN : reclasser ces nœuds autrement retirerait l'information même
		// que la mention porte.
		expect(noeudsSansAffaire(CATALOGUE, []).map((n) => n.position)).toEqual([1, 3, 8])
	})

	it('LA COMPARAISON SE FAIT SUR `node_id`, jamais sur la clé ni sur le libellé', () => {
		// C'est l'identifiant que la fonction rend : comparer ce que la base a joint plutôt qu'un
		// libellé recomposé est ce qui rend l'égalité STRUCTURELLE. Ici la clé coïncide mais
		// l'identifiant non — la ligne ne peuple donc rien.
		const vides = noeudsSansAffaire(CATALOGUE, [ligne({ node_id: 'autre', node_key: 'prospection' })])
		expect(vides.map((n) => n.cle)).toEqual(['prospection', 'negociation', 'qualification'])
	})

	it('un catalogue entièrement peuplé ne rend AUCUN nœud', () => {
		const vides = noeudsSansAffaire(CATALOGUE, [
			ligne({ node_id: 'n1' }),
			ligne({ node_id: 'n3' }),
			ligne({ node_id: 'n8' }),
		])
		expect(vides).toEqual([])
	})

	it('LA MÊME DEVISE N’ENTRE PAS EN JEU, et c’est le point de l’arbitrage', () => {
		// Un nœud peuplé en EUR seulement N'EST PAS vide : le rendre « vide en CHF » lui inventerait
		// une devise qu'aucune affaire n'y porte, ce que le §5.1 interdit déjà à la fonction. Le
		// compte porte sur des AFFAIRES, pas sur de l'argent.
		const vides = noeudsSansAffaire(CATALOGUE, [
			ligne({ node_id: 'n1', currency: 'EUR' }),
			ligne({ node_id: 'n3', currency: 'CHF' }),
		])
		expect(vides.map((n) => n.cle)).toEqual(['qualification'])
	})

	it('un catalogue vide ne rend rien, et non une exception', () => {
		expect(noeudsSansAffaire([], [ligne({})])).toEqual([])
	})
})

describe('lireNoeudsCatalogue — la troisième lecture, et ce qu’elle écarte (§8 bis.5)', () => {
	const clientDouble = (reponse: {
		data?: unknown[]
		error?: { message: string } | null
		status?: number
	}) => {
		const requete = {
			select: vi.fn(() => requete),
			eq: vi.fn(() => requete),
			is: vi.fn(() => requete),
			order: vi.fn(() => requete),
			then: (resoudre: (valeur: unknown) => unknown) =>
				Promise.resolve({
					data: reponse.data ?? [],
					error: reponse.error ?? null,
					status: reponse.status ?? 200,
				}).then(resoudre),
		}
		const client = { from: vi.fn(() => requete) } as unknown as ClientCrm
		return { client, requete }
	}

	it('interroge le catalogue de l’espace de travail, dans l’ordre de `position`', async () => {
		const { client, requete } = clientDouble({ data: [] })
		await lireNoeudsCatalogue(client, 'ws-1')
		expect(client.from).toHaveBeenCalledWith('workflow_nodes_catalog')
		expect(requete.select).toHaveBeenCalledWith(COLONNES_CATALOGUE)
		expect(requete.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(requete.order).toHaveBeenNthCalledWith(1, 'position')
	})

	it('ÉCARTE LES NŒUDS ARCHIVÉS — un nœud retiré n’est plus une étape du chemin', async () => {
		// Le nommer « sans affaire » inviterait à y en mettre une.
		const { client, requete } = clientDouble({ data: [] })
		await lireNoeudsCatalogue(client, 'ws-1')
		expect(requete.is).toHaveBeenCalledWith('archived_at', null)
	})

	it('projette les colonnes de la base sur les noms du module', async () => {
		const { client } = clientDouble({
			data: [{ id: 'n8', key: 'qualification', label: 'Qualification', kind: 'open', position: 8 }],
		})
		const etat = await lireNoeudsCatalogue(client, 'ws-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') {
			expect(etat.donnees[0]).toEqual({
				id: 'n8',
				cle: 'qualification',
				libelle: 'Qualification',
				genre: 'open',
				position: 8,
			})
		}
	})

	it('une erreur est classée, jamais levée — son échec ne casse pas l’écran', async () => {
		const { client } = clientDouble({ error: { message: 'boom' }, status: 500 })
		const etat = await lireNoeudsCatalogue(client, 'ws-1')
		expect(etat.statut).toBe('erreur')
	})
})
