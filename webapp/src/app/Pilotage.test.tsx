// @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//           TRANCHE 3 a : le MONTAGE de l'écran `/pilotage`
// @verifies docs/SPEC-analytique.md §7.1 (le taux porte son nom entier ; zéro décidée rend une
//           phrase et jamais « 0 % »), §7.2 (prévisionnel par devise, terminaux exclus),
//           §7.3 (les trois mentions obligatoires), §5.3 (le total est calculé APRÈS la RLS : une
//           réponse amputée rend un total amputé, sans compensation), §5.4 (l'anonyme est refusé
//           par le privilège, donc `401` et jamais zéro ligne), §8 (la portée workspace),
//           §11.2 (aucune addition de deux devises)
// @verifies docs/DESIGN_SYSTEM.md §5.48 (cet écran), §5.9 (le tableau et son `th scope="row"`),
//           §5.20 (la liste de définitions), §5.33 (le titre de devise conditionnel),
//           §5.8 (les états), §10 (aucun texte en dur, accord par clé)
//
// CE FICHIER ÉPROUVE L'ÉCRAN, PAS LE REPLI. `analytique.test.ts` couvre déjà la restriction de
// portée, le repli par nœud et par devise, les deux grandeurs dérivées et les deux compteurs
// d'absence ; les répéter ici les ferait diverger. Ce qui est éprouvé ici est ce que le MONTAGE
// ajoute : les cinq issues, la forme du tableau, le titre de devise conditionnel, les mentions
// obligatoires et la phrase de portée.
//
// LA PROPRIÉTÉ DU §5.3 EST ÉPROUVÉE PAR LA RÉPONSE, ET NON PAR UN RÔLE — la règle que
// `CoutsWorkspace.test.tsx` a déjà posée : une preuve unitaire ne peut pas poser une RLS, mais elle
// peut poser ce que la RLS PRODUIT et vérifier que l'écran rend alors des nombres plus petits, sans
// compenser ni signaler un manque qu'il ne connaît pas. C'est `e2e/ui/pilotage.spec.ts` qui exerce
// la RLS réelle avec deux profils.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pilotage } from './Pilotage'
import { fr } from '../i18n/fr'
import type { LigneEntonnoirLue } from '../lib/analytique'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

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

/**
 * Le jeu de démonstration replié — `docs/SPEC-analytique.md` M6, valeurs MESURÉES le 2026-08-30.
 *
 * Les mêmes nombres que la pile rend : 381 042,50 EUR et 34 600,00 CHF de prévisionnel, sept
 * gagnées contre une perdue. Une divergence entre ce fichier et la mesure se voit, au lieu de se
 * cacher derrière des valeurs inventées pour l'occasion.
 */
const SEED: readonly LigneEntonnoirLue[] = [
	ligne({ affaires: 11, affaires_sans_montant: 1, montant: 294200, montant_pondere: 29420 }),
	ligne({
		node_id: 'n2',
		node_key: 'relance',
		node_label: 'Relance',
		node_position: 2,
		currency: 'CHF',
		affaires: 1,
		montant: 47000,
		montant_pondere: 9400,
	}),
	ligne({
		node_id: 'n2',
		node_key: 'relance',
		node_label: 'Relance',
		node_position: 2,
		affaires: 8,
		montant: 284350,
		montant_pondere: 56870,
	}),
	ligne({
		node_id: 'n3',
		node_key: 'negociation',
		node_label: 'Négociation',
		node_position: 3,
		affaires: 9,
		montant: 366850,
		montant_pondere: 230752.5,
	}),
	ligne({
		node_id: 'n4',
		node_key: 'signature',
		node_label: 'Signature',
		node_position: 4,
		currency: 'CHF',
		affaires: 1,
		montant: 28000,
		montant_pondere: 25200,
	}),
	ligne({
		node_id: 'n5',
		node_key: 'realisation',
		node_label: 'Réalisation',
		node_position: 5,
		affaires: 1,
		montant: 64000,
		montant_pondere: 64000,
	}),
	ligne({
		node_id: 'n6',
		node_key: 'livre',
		node_label: 'Livré',
		node_kind: 'won',
		node_position: 6,
		affaires: 7,
		montant: 311000,
		montant_pondere: 311000,
	}),
	ligne({
		node_id: 'n7',
		node_key: 'perdu',
		node_label: 'Perdu',
		node_kind: 'lost',
		node_position: 7,
		affaires: 1,
		montant: 31000,
		montant_pondere: 0,
	}),
]

/**
 * Le montant tel que l'écran le rend.
 *
 * LE SÉPARATEUR DE MILLIERS DE `fr-FR` EST UNE ESPACE FINE INSÉCABLE (U+202F), et non l'espace
 * ordinaire : écrire `'381 042,50'` à la main dans une assertion la fait échouer sur un caractère
 * que personne ne voit, et invite à « corriger » l'écran. La valeur attendue est donc composée par
 * la MÊME API que le rendu. Ce que l'assertion éprouve n'est pas le format — c'est le NOMBRE, et
 * c'est lui qui change quand la lecture change.
 */
const montantAttendu = (valeur: number) =>
	new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
		valeur,
	)

/** Un client dont la RPC rend ce qu'on lui donne. */
function clientQuiRend(reponse: {
	data?: unknown
	error?: { message: string } | null
	status?: number
}): ClientCrm {
	return {
		rpc: vi.fn(() =>
			Promise.resolve({
				data: reponse.data ?? [],
				error: reponse.error ?? null,
				status: reponse.status ?? 200,
			}),
		),
	} as unknown as ClientCrm
}

/** Le tableau d'une devise, désigné par le nom accessible de sa région (§5.48). */
const tableauDe = (devise: string) =>
	screen.getByRole('region', {
		name: fr['pilotage.funnel.currency'].replace('{devise}', devise),
	})

describe('Pilotage — les deux grandeurs dérivées (§7.1, §7.2)', () => {
	it('rend le prévisionnel PAR DEVISE, et aucun total toutes devises confondues', async () => {
		// §11.2 : aucun taux de change n'existe dans le dépôt, et un total « toutes devises » serait
		// un nombre que personne n'a arbitré. Les nœuds terminaux en sont exclus — 311 000 de
		// « Livré » n'y figure pas —, et c'est le §7.2.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		const previsionnel = await screen.findByTestId('pilotage-previsionnel')
		const devises = within(previsionnel).getAllByTestId('pilotage-previsionnel-devise')
		expect(devises.map((d) => d.getAttribute('data-devise'))).toEqual(['CHF', 'EUR'])
		expect(devises[0]?.textContent).toContain(montantAttendu(34600))
		expect(devises[1]?.textContent).toContain(montantAttendu(381042.5))
		// Le total qu'une addition naïve produirait — 415 642,50 — n'est écrit nulle part.
		expect(previsionnel.textContent).not.toContain('415')
	})

	it('LE CODE DEVISE OCCUPE SON PROPRE ÉLÉMENT, jamais un nœud accolé au nombre', async () => {
		// Défaut « Discussion1 » du §5.11 : un nœud de texte nu devient un élément flex anonyme que
		// `gap` ne sépare pas, et la capture rendait « 381 042,50EUR ».
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		const devises = await screen.findAllByTestId('pilotage-previsionnel-devise')
		const enfants = [...(devises[1]?.children ?? [])].map((n) => n.textContent)
		expect(enfants).toEqual([montantAttendu(381042.5), 'EUR'])
	})

	it('le taux porte SON NOM ENTIER, et son numérateur avec son dénominateur', async () => {
		// « Taux de conversion des affaires DÉCIDÉES », jamais « taux de conversion » tout court : le
		// nom est la moitié de la règle (§7.1). Et un pourcentage nu ne dit pas sur combien il porte.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		expect(await screen.findByText(fr['pilotage.rate.term'])).toBeTruthy()
		const taux = screen.getByTestId('pilotage-taux')
		expect(taux.textContent).toContain('87,5')
		expect(screen.getByTestId('pilotage-taux-detail').textContent).toBe(
			'7 gagnées sur 8 décidées',
		)
	})

	it('ZÉRO AFFAIRE DÉCIDÉE REND UNE PHRASE, JAMAIS « 0 % »', async () => {
		// Un taux de 0 % dit « tout a été perdu » ; l'absence de toute décision ne dit rien (§7.1).
		// La distinction est portée par le type — `taux` vaut `null` —, et l'écran doit la rendre.
		const ouvertes = SEED.filter((l) => l.node_kind === 'open')
		render(<Pilotage client={clientQuiRend({ data: ouvertes })} />)
		const taux = await screen.findByTestId('pilotage-taux')
		expect(taux.textContent).toBe(fr['pilotage.rate.unknown'])
		expect(taux.textContent).not.toContain('%')
		expect(screen.queryByTestId('pilotage-taux-detail')).toBeNull()
	})

	it('AUCUNE AFFAIRE OUVERTE REND UNE PHRASE, JAMAIS « 0,00 »', async () => {
		// Symétrique du cas ci-dessus, et pour son motif : un zéro se lirait comme une prévision
		// nulle au lieu d'une absence de prévision.
		const closes = SEED.filter((l) => l.node_kind !== 'open')
		render(<Pilotage client={clientQuiRend({ data: closes })} />)
		const previsionnel = await screen.findByTestId('pilotage-previsionnel')
		expect(previsionnel.textContent).toBe(fr['pilotage.forecast.none'])
	})

	it('l’accord se fait par CLÉ, jamais par un gabarit paramétré (§10)', async () => {
		// « 1 gagnées sur 2 décidées » serait faux. Une seule gagnée, une clé distincte.
		const uneGagnee = [
			ligne({ node_id: 'n6', node_key: 'livre', node_kind: 'won', node_position: 6, affaires: 1 }),
			ligne({ node_id: 'n7', node_key: 'perdu', node_kind: 'lost', node_position: 7, affaires: 1 }),
		]
		render(<Pilotage client={clientQuiRend({ data: uneGagnee })} />)
		expect((await screen.findByTestId('pilotage-taux-detail')).textContent).toBe(
			'1 gagnée sur 2 décidées',
		)
	})
})

describe('Pilotage — l’entonnoir (§5.48)', () => {
	it('rend UN TABLEAU PAR DEVISE, et n’en mêle jamais deux', async () => {
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		expect(screen.getAllByRole('table')).toHaveLength(2)
		expect(tableauDe('CHF')).toBeTruthy()
		expect(tableauDe('EUR')).toBeTruthy()
	})

	it('LE TITRE DE DEVISE EST VISIBLE dès qu’il y en a plusieurs (§5.33)', async () => {
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		expect(await screen.findByRole('heading', { name: 'Entonnoir en EUR' })).toBeTruthy()
		expect(screen.getByRole('heading', { name: 'Entonnoir en CHF' })).toBeTruthy()
	})

	it('LE TITRE DE DEVISE EST ABSENT sur une devise unique — le cas attendu', async () => {
		// « s'il n'y en a qu'une, l'utilisateur ne voit rien de cette mécanique » (§5.33) : un titre
		// permanent serait du bruit à chaque ouverture. Le nom ACCESSIBLE de la région, lui, reste.
		const euros = SEED.filter((l) => l.currency === 'EUR')
		render(<Pilotage client={clientQuiRend({ data: euros })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		expect(screen.queryByRole('heading', { name: 'Entonnoir en EUR' })).toBeNull()
		expect(tableauDe('EUR')).toBeTruthy()
	})

	it('L’ORDRE DES LIGNES EST CELUI DU CATALOGUE, jamais un classement par montant', async () => {
		// Un entonnoir est un CHEMIN (§5.48) : trié par montant, « Livré » — 311 000 — remonterait
		// au-dessus de « Prospection », et l'écran deviendrait un palmarès.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		const euros = within(tableauDe('EUR')).getAllByTestId('pilotage-ligne')
		expect(euros.map((l) => l.getAttribute('data-noeud'))).toEqual([
			'prospection',
			'relance',
			'negociation',
			'realisation',
			'livre',
			'perdu',
		])
	})

	it('LE GENRE EST UN MOT, et ce sont les mots exacts du §5.18', async () => {
		// C'est lui, et lui seul, qui dit pourquoi « Livré » ne figure pas dans le prévisionnel.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		const euros = within(tableauDe('EUR')).getAllByTestId('pilotage-ligne')
		const genres = euros.map((l) => within(l).getByTestId('pilotage-genre').textContent)
		expect(genres).toEqual([
			fr['admin.catalog.kind.open'],
			fr['admin.catalog.kind.open'],
			fr['admin.catalog.kind.open'],
			fr['admin.catalog.kind.open'],
			fr['admin.catalog.kind.won'],
			fr['admin.catalog.kind.lost'],
		])
	})

	it('le libellé du nœud est un `th scope="row"`, jamais une cellule ordinaire (§5.9)', async () => {
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		const premiere = within(tableauDe('EUR')).getAllByTestId('pilotage-ligne')[0]!
		const entete = within(premiere).getByRole('rowheader')
		expect(entete.textContent).toBe('Prospection')
		expect(entete.getAttribute('scope')).toBe('row')
		// ALIGNÉ À GAUCHE EXPLICITEMENT : un `th` est centré par défaut, et l'alignement s'écrit sur
		// la cellule — la règle générale que le §5.30 a payée en regardant une capture.
		expect(entete.className).toContain('text-left')
	})

	it('AUCUN LIEN, et l’absence est assumée (§5.48)', async () => {
		// C'est l'écart avec le §5.33, dont chaque libellé de track mène à ses coûts : un NŒUD n'est
		// pas adressable, et un lien vers une adresse inexistante serait une commande morte.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		expect(screen.queryAllByRole('link')).toHaveLength(0)
	})

	it('AUCUNE COMMANDE D’ÉCRITURE, et aucune colonne triable', async () => {
		// L'écran MESURE, il n'agit pas (§5.48) ; et un tri ferait de l'entonnoir un palmarès. La
		// seule cible interactive de l'écran est la reprise de l'état d'erreur, éprouvée plus bas.
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		expect(screen.queryAllByRole('button')).toHaveLength(0)
		expect(screen.queryAllByRole('columnheader', { name: /trier/i })).toHaveLength(0)
	})
})

describe('Pilotage — les mentions obligatoires du §7.3', () => {
	it('écrit « n affaires sans montant » dès que le compte est non nul', async () => {
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		expect((await screen.findByTestId('pilotage-sans-montant')).textContent).toBe(
			'1 affaire sans montant renseigné.',
		)
	})

	it('n’écrit RIEN quand le compte est nul — « 0 affaire sans montant » ne dit rien', async () => {
		const complet = SEED.map((l) => ({ ...l, affaires_sans_montant: 0 }))
		render(<Pilotage client={clientQuiRend({ data: complet })} />)
		await screen.findAllByTestId('pilotage-entonnoir')
		expect(screen.queryByTestId('pilotage-sans-montant')).toBeNull()
	})

	it('les mentions TRAVERSENT les devises — ce sont des affaires, pas de l’argent', async () => {
		const melange = [
			ligne({ currency: 'EUR', affaires_sans_probabilite: 2 }),
			ligne({ currency: 'CHF', affaires_sans_probabilite: 3 }),
		]
		render(<Pilotage client={clientQuiRend({ data: melange })} />)
		expect((await screen.findByTestId('pilotage-sans-probabilite')).textContent).toBe(
			'5 affaires sans probabilité renseignée.',
		)
	})

	it('LA PORTÉE EST ÉCRITE, et sans elle l’écart entre deux profils se lirait comme une erreur', async () => {
		render(<Pilotage client={clientQuiRend({ data: SEED })} />)
		expect((await screen.findByTestId('pilotage-portee')).textContent).toBe(fr['pilotage.scope'])
	})
})

describe('Pilotage — les états (§5.8, §5.48)', () => {
	it('LE REFUS N’EST PAS DÉGUISÉ EN VIDE : un `401` rend le refus, jamais « aucune affaire »', async () => {
		// La fonction est refusée à l'anonyme PAR LE PRIVILÈGE (§5.4). Masquer ce `401` en « aucune
		// affaire » ferait lire une absence de DROIT comme un portefeuille vide.
		render(
			<Pilotage
				client={clientQuiRend({ error: { message: 'permission denied' }, status: 401 })}
			/>,
		)
		expect(await screen.findByTestId('etat-refus')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['pilotage.forbidden.title'])
		expect(screen.queryByTestId('etat-vide')).toBeNull()
	})

	it('une panne réseau rend l’erreur AVEC sa reprise, et la reprise relit réellement', async () => {
		const client = {
			rpc: vi
				.fn()
				.mockRejectedValueOnce(new Error('fetch failed'))
				.mockResolvedValue({ data: SEED, error: null, status: 200 }),
		} as unknown as ClientCrm
		render(<Pilotage client={client} />)
		const reprise = await screen.findByRole('button', { name: fr['state.error.retry'] })
		reprise.click()
		await waitFor(() => expect(screen.getAllByTestId('pilotage-entonnoir').length).toBe(2))
		expect(client.rpc).toHaveBeenCalledTimes(2)
	})

	it('UN ENTONNOIR VIDE REND L’ÉTAT VIDE, SANS AUCUNE ACTION', async () => {
		// L'écart au §5.8 que la corbeille, le carnet et les affaires figées prennent déjà : une
		// affaire se crée depuis un board, que cet écran ne connaît pas.
		render(<Pilotage client={clientQuiRend({ data: [] })} />)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['pilotage.empty.title'])
		expect(screen.queryAllByRole('button')).toHaveLength(0)
		expect(screen.queryAllByRole('link')).toHaveLength(0)
		// La phrase de portée n'est PAS rendue sur l'état vide : il n'y a aucun nombre à qualifier.
		expect(screen.queryByTestId('pilotage-portee')).toBeNull()
	})

	it('AUCUN CLIENT EST UN ÉTAT, PAS UNE ATTENTE', async () => {
		render(<Pilotage client={null} />)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['pilotage.noworkspace.title'])
	})
})

describe('Pilotage — le total suit la LECTURE, et l’écran ne compense rien (§5.3)', () => {
	it('une réponse amputée rend des nombres plus petits, sans mention de ce qui manque', async () => {
		// Ce que la RLS PRODUIT pour la lectrice, mesuré : trois lignes repliées diffèrent —
		// `prospection` 11 → 10, `relance` 8 → 6, `livre` 7 → 6 —, et son prévisionnel vaut
		// 344 892,50 contre 381 042,50. L'écran rend ce que le backend consent, il ne complète pas.
		const lectrice = SEED.map((l) => {
			if (l.currency !== 'EUR') return l
			if (l.node_key === 'prospection') return { ...l, affaires: 10, montant_pondere: 26670 }
			if (l.node_key === 'relance') return { ...l, affaires: 6, montant_pondere: 47390 }
			if (l.node_key === 'livre') return { ...l, affaires: 6, montant_pondere: 261000 }
			return l
		})
		render(<Pilotage client={clientQuiRend({ data: lectrice })} />)
		const devises = await screen.findAllByTestId('pilotage-previsionnel-devise')
		// 26 670 + 47 390 + 230 752,50 + 64 000 = 368 812,50 : plus petit, et calculé sur ce qui a
		// été rendu. Le franc, lui, ne bouge pas — aucune des affaires manquantes n'est en francs.
		expect(devises[1]?.textContent).toContain(montantAttendu(368812.5))
		expect(devises[0]?.textContent).toContain(montantAttendu(34600))
		// L'ÉCRAN NE NOMME JAMAIS CE QU'IL NE MONTRE PAS : aucune phrase ne dit qu'une affaire est
		// masquée, et les divulguer par la bande est ce que le §5.48 interdit.
		expect(screen.queryByText(/masqué/i)).toBeNull()
	})
})
