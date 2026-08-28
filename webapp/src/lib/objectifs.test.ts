// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 ; et TRANCHE 3 pour
//           `ecritureConsentie`, la lecture de la capacité que la base consent
// @verifies docs/SPEC-goals.md §5.7.4 (contrat de l'état de lecture seule, lignes b, c et e)
// @verifies docs/SPEC-goals.md §4.1 (le bloc masqué n'arrive pas, ses flèches restent),
//           §5.3 (flèches tracées entre les BORDS), §5.4 (états), §5.5 (équivalent textuel),
//           §2.3 (les TROIS directions, jamais normalisées en deux)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (flèche pointillée sans libellé quand une extrémité manque)
//
// CE FICHIER ÉPROUVE LA RÈGLE, PAS L'IMPLÉMENTATION. Le cas central est celui que la RLS produit
// et que rien d'autre ne produit : une flèche dont l'un des deux blocs n'a PAS été rendu à
// l'appelant. Il est éprouvé CONTRE SON SUCCÈS — une composition qui se contenterait de jeter ces
// flèches passerait tous les autres tests de ce fichier.

import { describe, expect, it } from 'vitest'
import {
	composerDiagramme,
	destinationDepuisEmbarque,
	ecritureConsentie,
	etendueCanevas,
	lienOuvrable,
	lienPerdu,
	listeTextuelleDiagramme,
	normaliserDirection,
	ordreTabulation,
	pointDeBord,
	type BlocObjectif,
	type FlecheObjectif,
} from './objectifs'

function bloc(surcharge: Partial<BlocObjectif> & { id: string }): BlocObjectif {
	return {
		title: `Bloc ${surcharge.id}`,
		body: null,
		fill_percent: 0,
		channel_id: null,
		pos_x: 0,
		pos_y: 0,
		width: 200,
		height: 100,
		color: 'brand',
		destination: null,
		...surcharge,
	}
}

function fleche(surcharge: Partial<FlecheObjectif> & { id: string }): FlecheObjectif {
	return {
		source_block_id: 'a',
		target_block_id: 'b',
		label: null,
		direction: 'forward',
		...surcharge,
	}
}

describe('normaliserDirection', () => {
	it('conserve les TROIS directions du §2.3', () => {
		expect(normaliserDirection('forward')).toBe('forward')
		expect(normaliserDirection('backward')).toBe('backward')
		expect(normaliserDirection('both')).toBe('both')
	})

	it('ramène une valeur inconnue à « forward » plutôt que de jeter la flèche', () => {
		// Une direction inconnue en base est une anomalie de donnée, pas une raison de faire
		// disparaître un trait que l'utilisateur a tracé.
		expect(normaliserDirection('diagonal')).toBe('forward')
	})
})

describe('destinationDepuisEmbarque', () => {
	it('lit la forme OBJET rendue par PostgREST, mesurée sur la pile seedée', () => {
		const destination = destinationDepuisEmbarque({
			id: 'c1',
			name: 'Refonte de site',
			slug: 'refonte',
			deleted_at: null,
			tracks: { name: 'Studio web', slug: 'studio-web', deleted_at: null },
		})
		expect(destination).toEqual({
			id: 'c1',
			nom: 'Refonte de site',
			slug: 'refonte',
			supprime: false,
			track: { nom: 'Studio web', slug: 'studio-web', supprime: false },
		})
	})

	it('accepte aussi la forme TABLEAU, plutôt que de la supposer impossible', () => {
		const destination = destinationDepuisEmbarque([
			{ id: 'c1', name: 'N', slug: 's', deleted_at: null, tracks: [{ name: 'T', slug: 't', deleted_at: null }] },
		])
		expect(destination?.track?.slug).toBe('t')
	})

	it('rend null quand rien n’est embarqué', () => {
		expect(destinationDepuisEmbarque(null)).toBeNull()
		expect(destinationDepuisEmbarque(undefined)).toBeNull()
	})
})

describe('lienOuvrable et lienPerdu — §5.4', () => {
	const destinationVivante = {
		id: 'c1',
		nom: 'Refonte',
		slug: 'refonte',
		supprime: false,
		track: { nom: 'Studio', slug: 'studio', supprime: false },
	}

	it('un bloc lié à une destination vivante est ouvrable, et n’affiche pas « lien perdu »', () => {
		const cible = bloc({ id: 'a', channel_id: 'c1', destination: destinationVivante })
		expect(lienOuvrable(cible)).toBe(true)
		expect(lienPerdu(cible)).toBe(false)
	})

	it('une destination partie à la corbeille rend « lien perdu » et NON une pilule morte', () => {
		// `app.can_read_channel` ne regarde pas `deleted_at` (migration 0010) : le bloc reste
		// rendu, et l'écran ne doit pas proposer d'aller à une adresse qui n'existe plus.
		const cible = bloc({
			id: 'a',
			channel_id: 'c1',
			destination: { ...destinationVivante, supprime: true },
		})
		expect(lienOuvrable(cible)).toBe(false)
		expect(lienPerdu(cible)).toBe(true)
	})

	it('un track parti à la corbeille rend aussi « lien perdu » — l’adresse a DEUX segments', () => {
		const cible = bloc({
			id: 'a',
			channel_id: 'c1',
			destination: { ...destinationVivante, track: { nom: 'S', slug: 's', supprime: true } },
		})
		expect(lienPerdu(cible)).toBe(true)
	})

	it('un bloc JAMAIS lié n’affiche pas « lien perdu »', () => {
		expect(lienPerdu(bloc({ id: 'a' }))).toBe(false)
	})
})

describe('pointDeBord — §5.3, les flèches partent des BORDS', () => {
	it('coupe le bord vertical quand la cible est à droite', () => {
		const source = bloc({ id: 'a', pos_x: 0, pos_y: 0, width: 200, height: 100 })
		expect(pointDeBord(source, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 })
	})

	it('coupe le bord horizontal quand la cible est au-dessous', () => {
		const source = bloc({ id: 'a', pos_x: 0, pos_y: 0, width: 200, height: 100 })
		expect(pointDeBord(source, { x: 100, y: 400 })).toEqual({ x: 100, y: 100 })
	})

	it('rend le centre plutôt qu’une division par zéro pour deux blocs superposés', () => {
		const source = bloc({ id: 'a', pos_x: 0, pos_y: 0, width: 200, height: 100 })
		expect(pointDeBord(source, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 })
	})
})

describe('composerDiagramme — le cas que la RLS produit', () => {
	const gauche = bloc({ id: 'a', pos_x: 0, pos_y: 0, width: 200, height: 100 })
	const droite = bloc({ id: 'b', pos_x: 400, pos_y: 0, width: 200, height: 100 })

	it('trace un trait plein entre les deux bords, et porte son libellé', () => {
		const [trait] = composerDiagramme([gauche, droite], [fleche({ id: 'f1', label: 'nourrit' })])
		expect(trait?.orpheline).toBe(false)
		expect(trait?.depart).toEqual({ x: 200, y: 50 })
		expect(trait?.arrivee).toEqual({ x: 400, y: 50 })
		expect(trait?.libelle).toBe('nourrit')
		expect(trait?.milieu).toEqual({ x: 300, y: 50 })
	})

	it('CONSERVE la flèche dont la CIBLE n’est pas rendue, en moignon SANS libellé', () => {
		// C'est l'état « pointillés vers le vide » du §5.4. Une implémentation qui jetterait la
		// flèche passerait tous les autres tests de ce fichier : c'est l'assertion qui la débusque.
		const traces = composerDiagramme([gauche], [fleche({ id: 'f1', label: 'nourrit' })])
		expect(traces).toHaveLength(1)
		expect(traces[0]?.orpheline).toBe(true)
		expect(traces[0]?.libelle).toBeNull()
		expect(traces[0]?.depart).toEqual({ x: 200, y: 50 })
	})

	it('CONSERVE la flèche dont la SOURCE n’est pas rendue — c’est le cas du seed', () => {
		const traces = composerDiagramme([droite], [fleche({ id: 'f1', source_block_id: 'a', target_block_id: 'b' })])
		expect(traces).toHaveLength(1)
		expect(traces[0]?.orpheline).toBe(true)
		expect(traces[0]?.arrivee.x).toBe(400)
	})

	it('ne trace RIEN quand aucune des deux extrémités n’est rendue', () => {
		// Un trait flottant sans origine ni destination ne dit rien, et révèle seulement qu'il
		// manque quelque chose — ce que le §4.1 interdit à l'écran de faire.
		expect(composerDiagramme([], [fleche({ id: 'f1' })])).toHaveLength(0)
	})

	it('conserve la direction de chaque flèche, sans la normaliser', () => {
		const traces = composerDiagramme(
			[gauche, droite],
			[fleche({ id: 'f1', direction: 'both' }), fleche({ id: 'f2', direction: 'backward' })],
		)
		expect(traces.map((trait) => trait.direction)).toEqual(['both', 'backward'])
	})
})

describe('listeTextuelleDiagramme — §5.5', () => {
	const gauche = bloc({ id: 'a', title: 'A' })
	const droite = bloc({ id: 'b', title: 'B', pos_x: 400 })

	it('rend les trois symboles, un par direction', () => {
		const lignes = listeTextuelleDiagramme(
			[gauche, droite],
			[
				fleche({ id: 'f1', direction: 'forward' }),
				fleche({ id: 'f2', direction: 'backward' }),
				fleche({ id: 'f3', direction: 'both' }),
			],
		)
		expect(lignes.map((ligne) => ligne.symbole)).toEqual(['→', '←', '↔'])
		expect(lignes[0]).toMatchObject({ source: 'A', cible: 'B' })
	})

	it('NE NOMME PAS le bloc absent : l’extrémité manquante reste vide', () => {
		// L'écran ne nomme jamais ce qu'il cache (§4.1). Écrire ici « bloc masqué » ferait dire au
		// texte ce que le dessin s'interdit de dire.
		const lignes = listeTextuelleDiagramme([gauche], [fleche({ id: 'f1' })])
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.source).toBe('A')
		expect(lignes[0]?.cible).toBe('')
	})

	it('omet la ligne dont les deux extrémités manquent, comme le tracé', () => {
		expect(listeTextuelleDiagramme([], [fleche({ id: 'f1' })])).toHaveLength(0)
	})
})

describe('ordreTabulation — §5.5, « dans l’ordre de leur position »', () => {
	it('ordonne de haut en bas, puis de gauche à droite', () => {
		const blocs = [
			bloc({ id: 'basGauche', pos_x: 40, pos_y: 240 }),
			bloc({ id: 'hautDroite', pos_x: 680, pos_y: 40 }),
			bloc({ id: 'hautGauche', pos_x: 40, pos_y: 40 }),
		]
		expect(ordreTabulation(blocs).map((cible) => cible.id)).toEqual([
			'hautGauche',
			'hautDroite',
			'basGauche',
		])
	})

	it('départage deux blocs exactement superposés par leur identifiant', () => {
		// Sans ce départage, l'ordre de tabulation dépendrait de celui du serveur et changerait
		// d'un chargement à l'autre — un piège classique pour la navigation clavier.
		const blocs = [bloc({ id: 'z' }), bloc({ id: 'a' })]
		expect(ordreTabulation(blocs).map((cible) => cible.id)).toEqual(['a', 'z'])
	})

	it('ne modifie pas le tableau reçu', () => {
		const blocs = [bloc({ id: 'z' }), bloc({ id: 'a' })]
		ordreTabulation(blocs)
		expect(blocs.map((cible) => cible.id)).toEqual(['z', 'a'])
	})
})

describe('etendueCanevas', () => {
	it('couvre le bloc le plus éloigné ET la marge des moignons', () => {
		// Une étendue calculée sur les seuls blocs couperait les flèches vers le vide.
		const etendue = etendueCanevas([bloc({ id: 'a', pos_x: 680, pos_y: 240, width: 260, height: 140 })])
		expect(etendue.largeur).toBeGreaterThan(680 + 260)
		expect(etendue.hauteur).toBeGreaterThan(240 + 140)
	})

	it('rend une surface non nulle pour un tableau vide', () => {
		const etendue = etendueCanevas([])
		expect(etendue.largeur).toBeGreaterThan(0)
		expect(etendue.hauteur).toBeGreaterThan(0)
	})
})

describe('ecritureConsentie — la capacité vient de la BASE, et son absence FERME', () => {
	// @verifies docs/SPEC-goals.md §5.7.4, lignes b et c ; docs/SCHEMA.md §9 bis.8 bis.
	//
	// CE QUE CES SCÉNARIOS PROTÈGENT. La colonne `ecriture_permise` est calculée par la base
	// (migration 71), et l'écran s'en sert pour ÉTEINDRE des commandes. Le sens du défaut n'est donc
	// pas indifférent : lire une valeur manquante comme « oui » rendrait des commandes dont chaque
	// envoi serait refusé — exactement l'état que la tranche 3 supprime —, et le ferait
	// silencieusement, sur une pile dont le cache de schéma n'aurait pas été rechargé ou dont la
	// migration ne serait pas appliquée.
	const tableau = (valeur: boolean | null | undefined) =>
		({
			id: 'b1',
			name: 'Objectifs',
			description: null,
			position: 1,
			archived_at: null,
			ecriture_permise: valeur,
		}) as unknown as Parameters<typeof ecritureConsentie>[0]

	it('rend vrai quand la base consent l’écriture', () => {
		expect(ecritureConsentie(tableau(true))).toBe(true)
	})

	it('rend faux quand la base la refuse', () => {
		expect(ecritureConsentie(tableau(false))).toBe(false)
	})

	it('rend faux sur `null` — un type ne garantit jamais une valeur (§5.7.4, ligne c)', () => {
		expect(ecritureConsentie(tableau(null))).toBe(false)
	})

	it('rend faux sur une colonne ABSENTE — cache de schéma non rechargé, migration non appliquée', () => {
		expect(ecritureConsentie(tableau(undefined))).toBe(false)
	})

	it('rend faux sur `null` de tableau — aucun tableau n’est écrivable', () => {
		expect(ecritureConsentie(null)).toBe(false)
	})

	it('n’accepte AUCUNE valeur véridique autre que `true`', () => {
		// La comparaison est stricte, et ce scénario est ce qui l'empêche de redevenir un
		// `!!valeur` : PostgREST rendrait la chaîne « true » sur une lecture mal typée, et
		// `Boolean('false')` vaut `true` — un défaut qui ouvrirait l'écriture à qui ne l'a pas.
		expect(ecritureConsentie(tableau('true' as unknown as boolean))).toBe(false)
	})
})
