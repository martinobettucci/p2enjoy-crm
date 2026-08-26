// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 4, SOUS-TRANCHE 4c : L'ÉCRAN
// @verifies docs/SPEC-modeles-emails.md §13.5 (la liste et son compte de paliers), §13.5 bis
//           (l'embarquement AMBIGU, mesuré, et la relation nommée), §13.6 (la fiche, le rang du
//           palier ajouté, le déplacement), §13.7 (dictionnaire fermé des refus et repli nommé),
//           §13.8 (l'armement et son dictionnaire), §13.3 (les trois refus de la RPC)
// @verifies docs/SPEC-modeles-emails.md §11.5 (ce que la base refuse), §11.8 et §12.11 et §13.10
//           (les contrats d'API mesurés dont ce fichier reprend les messages)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue. Quatre
// exigences sont portées par l'appel lui-même et qu'aucune assertion sur le résultat
// n'attraperait : les deux compositions NOMMENT leur relation (§13.5 bis), `workspace_id` n'est
// envoyé qu'à la création, toute écriture relit sa ligne par `select()`, et le réordonnancement
// envoie l'ordre COMPLET.
//
// LES NOMS DE CONTRAINTE ET LES MESSAGES DE REFUS EMPLOYÉS ICI SONT MESURÉS, JAMAIS INVENTÉS : ils
// viennent des sondes du §13.1 et des trois suites d'API — `sequences-relance.spec.ts`,
// `armement-sequences.spec.ts` et `reordonnancement-paliers.spec.ts`. Un test qui inventerait un
// nom de contrainte prouverait que la fonction sait lire ce test, pas ce que la base rend.

import { describe, expect, it } from 'vitest'
import {
	ajouterPalier,
	armerSequence,
	classerArmement,
	classerEcritureSequence,
	COLONNES_INSCRIPTION,
	COLONNES_PALIER,
	COLONNES_SEQUENCE,
	compterPaliers,
	corpsEcriturePalier,
	corpsEcritureSequence,
	enregistrerSequence,
	interrompreSequence,
	libellePalier,
	lireInscriptionActive,
	lirePaliers,
	lireSequences,
	ordreApresDeplacement,
	rangSuivant,
	reordonnerPaliers,
	retirerPalier,
	supprimerSequence,
	type SaisiePalier,
	type SaisieSequence,
} from './sequences-relance'
import type { ClientCrm } from './supabase'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const SEQUENCE = '5e900000-0000-4000-8000-000000000001'
const PALIER_1 = '5e900000-0000-4000-8000-0000000000a1'
const PALIER_2 = '5e900000-0000-4000-8000-0000000000a2'
const PALIER_3 = '5e900000-0000-4000-8000-0000000000a3'

const TROIS_PALIERS = [
	{ id: PALIER_1, position: 1 },
	{ id: PALIER_2, position: 2 },
	{ id: PALIER_3, position: 3 },
]

type Reponse = { data: unknown; error: { message: string } | null; status: number }

/** Un faux client de lecture, qui retient la table, la composition, les filtres et le tri. */
function espionLecture(reponse: Reponse): {
	client: ClientCrm
	appel: {
		table?: string
		colonnes?: string
		filtres: [string, string][]
		tri?: string
		limite?: number
	}
} {
	const appel: {
		table?: string
		colonnes?: string
		filtres: [string, string][]
		tri?: string
		limite?: number
	} = { filtres: [] }
	const chaine = {
		eq: (colonne: string, valeur: string) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		order: (colonne: string) => {
			appel.tri = colonne
			return Promise.resolve(reponse) as never
		},
		limit: (nombre: number) => {
			appel.limite = nombre
			return Promise.resolve(reponse) as never
		},
		then: (resoudre: (valeur: Reponse) => unknown) => resoudre(reponse),
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

function espionRpc(reponse: Reponse): {
	client: ClientCrm
	appel: { fonction?: string; arguments?: Record<string, unknown> }
} {
	const appel: { fonction?: string; arguments?: Record<string, unknown> } = {}
	const client = {
		rpc: (fonction: string, arguments_?: Record<string, unknown>) => {
			appel.fonction = fonction
			appel.arguments = arguments_
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** Un faux client d'écriture, qui retient le verbe, le corps, le filtre et la relecture. */
function espionEcriture(reponse: Reponse): {
	client: ClientCrm
	appel: {
		verbe?: 'insert' | 'update' | 'delete'
		corps?: Record<string, unknown>
		filtre?: string
		colonnes?: string
	}
} {
	const appel: {
		verbe?: 'insert' | 'update' | 'delete'
		corps?: Record<string, unknown>
		filtre?: string
		colonnes?: string
	} = {}
	const sansFiltre = {
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return Promise.resolve(reponse)
		},
	}
	const avecFiltre = {
		eq: (_colonne: string, valeur: string) => {
			appel.filtre = valeur
			return sansFiltre
		},
	}
	const client = {
		from: () => ({
			insert: (corps: Record<string, unknown>) => {
				appel.verbe = 'insert'
				appel.corps = corps
				return sansFiltre
			},
			update: (corps: Record<string, unknown>) => {
				appel.verbe = 'update'
				appel.corps = corps
				return avecFiltre
			},
			delete: () => {
				appel.verbe = 'delete'
				return avecFiltre
			},
		}),
	} as unknown as ClientCrm
	return { client, appel }
}

describe('lecture des séquences — §13.5, §13.5 bis', () => {
	it('demande le comptage embarqué en NOMMANT la relation, et trie par nom', async () => {
		const { client, appel } = espionLecture({
			data: [
				{
					id: SEQUENCE,
					workspace_id: WORKSPACE,
					name: 'Relance en trois temps',
					mail_sequence_steps: [{ count: 3 }],
				},
			],
			error: null,
			status: 200,
		})
		const etat = await lireSequences(client)

		expect(appel.table).toBe('mail_sequences')
		expect(appel.colonnes).toBe(COLONNES_SEQUENCE)
		expect(appel.tri).toBe('name')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees[0]?.paliers).toBe(3)
	})

	// L'ASSERTION QUI PORTE LA MESURE DU §13.5 bis. Sans le nom de la clé, PostgREST rend `300` /
	// `PGRST201` — les deux clés étrangères du §11.5 point n le rendant ambigu —, et l'écran
	// classerait ce code dans son repli `inconnu` sur une liste parfaitement saine.
	it('NOMME la clé étrangère SIMPLE, et non la composite', () => {
		expect(COLONNES_SEQUENCE).toContain('!mail_sequence_steps_sequence_id_fkey')
		expect(COLONNES_SEQUENCE).not.toContain('mail_sequence_steps_sequence_workspace_fkey')
		expect(COLONNES_PALIER).toContain('!mail_sequence_steps_template_id_fkey')
		expect(COLONNES_PALIER).not.toContain('mail_sequence_steps_template_workspace_fkey')
	})

	// `created_by` EST UNE TRACE, JAMAIS UN DROIT (§11.3), et la liste ne porte aucune date (§5.41).
	it('ne demande JAMAIS `created_by`, ni les horodatages', () => {
		expect(COLONNES_SEQUENCE).not.toContain('created_by')
		expect(COLONNES_SEQUENCE).not.toContain('created_at')
		expect(COLONNES_SEQUENCE).not.toContain('updated_at')
	})

	it('rend un état d’erreur classé quand la requête échoue', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await lireSequences(client)).statut).toBe('erreur')
	})
})

describe('le compte de paliers — §13.5', () => {
	it('lit le compte que PostgREST rend dans son tableau d’un objet', () => {
		expect(compterPaliers([{ count: 3 }])).toBe(3)
	})

	// UN CACHE DE SCHÉMA PÉRIMÉ REND L'EMBARQUEMENT ABSENT, et `[0].count` sur `undefined` ferait
	// planter l'écran. Zéro est le repli JUSTE : une séquence dont on ne sait pas compter les
	// paliers n'en a aucun de prouvé.
	it('rend ZÉRO plutôt que de planter quand l’embarquement manque', () => {
		expect(compterPaliers(null)).toBe(0)
		expect(compterPaliers([])).toBe(0)
	})
})

describe('lecture des paliers — §13.6', () => {
	it('filtre sur la séquence et trie par POSITION, qui EST l’ordre', async () => {
		const { client, appel } = espionLecture({
			data: [
				{
					id: PALIER_1,
					position: 1,
					delai_jours: 3,
					template_id: 'modele-1',
					mail_templates: { name: 'Relance sans réponse' },
				},
			],
			error: null,
			status: 200,
		})
		const etat = await lirePaliers(client, SEQUENCE)

		expect(appel.table).toBe('mail_sequence_steps')
		expect(appel.filtres).toEqual([['sequence_id', SEQUENCE]])
		expect(appel.tri).toBe('position')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees[0]?.modele).toBe('Relance sans réponse')
	})

	it('rend `null` pour un modèle que l’embarquement n’a pas rendu, jamais un tiret', async () => {
		const { client } = espionLecture({
			data: [
				{ id: PALIER_1, position: 1, delai_jours: 3, template_id: 'm', mail_templates: null },
			],
			error: null,
			status: 200,
		})
		const etat = await lirePaliers(client, SEQUENCE)
		if (etat.statut === 'pret') expect(etat.donnees[0]?.modele).toBeNull()
	})
})

describe('le dictionnaire fermé des refus de l’écran des séquences — §13.7', () => {
	// CHAQUE LIGNE EST UN MESSAGE MESURÉ, repris des sondes du §13.1 telles que PostgREST les rend.
	it.each([
		[400, 'new row for relation "mail_sequences" violates check constraint "mail_sequences_name_borne"', 'nom-borne'],
		[409, 'duplicate key value violates unique constraint "mail_sequences_workspace_name_key"', 'nom-pris'],
		[400, 'new row for relation "mail_sequence_steps" violates check constraint "mail_sequence_steps_delai_borne"', 'delai-borne'],
		[400, 'new row for relation "mail_sequence_steps" violates check constraint "mail_sequence_steps_position_borne"', 'position-borne'],
		[409, 'duplicate key value violates unique constraint "mail_sequence_steps_sequence_position_key"', 'position-prise'],
		[409, 'violates foreign key constraint "mail_sequence_steps_template_id_fkey"', 'modele-introuvable'],
		[409, 'violates foreign key constraint "card_sequence_enrollments_sequence_fk"', 'sequence-armee'],
		[400, 'paliers_requis', 'ordre-invalide'],
		[400, 'paliers_dupliques', 'ordre-invalide'],
		[400, 'paliers_incomplets', 'ordre-invalide'],
		[403, 'permission denied for table mail_sequences', 'refus'],
		[401, 'JWT expired', 'session-expiree'],
	])('classe %i / %s en « %s »', (statut, message, attendu) => {
		expect(classerEcritureSequence(statut as number, message as string)).toBe(attendu)
	})

	it('classe l’absence de réponse en « reseau », et un statut `0` aussi', () => {
		expect(classerEcritureSequence(undefined, null)).toBe('reseau')
		expect(classerEcritureSequence(0, 'peu importe')).toBe('reseau')
	})

	it('classe un succès sans message en « enregistre »', () => {
		expect(classerEcritureSequence(201, null)).toBe('enregistre')
		expect(classerEcritureSequence(200, null)).toBe('enregistre')
	})

	// LE REPLI EST NOMMÉ : nommer « je ne sais pas » est une réponse, la déguiser en une cause
	// précise n'en est pas une (§13.7).
	it('classe tout le reste en « inconnu », et ne recopie jamais le serveur', () => {
		expect(classerEcritureSequence(500, 'un message que personne n’a prévu')).toBe('inconnu')
		expect(classerEcritureSequence(418, null)).toBe('inconnu')
	})

	// L'ORDRE DES TESTS A ÉTÉ VÉRIFIÉ, PAS SUPPOSÉ : `mail_sequences` n'est pas un préfixe de
	// `mail_sequence_steps`, et les deux familles ne se capturent donc pas l'une l'autre. C'est le
	// piège inverse de celui que le §9.8 a payé sur `mail_templates_subject_*`.
	it('ne confond PAS les contraintes des deux tables', () => {
		expect(classerEcritureSequence(400, 'mail_sequence_steps_delai_borne')).toBe('delai-borne')
		expect(classerEcritureSequence(400, 'mail_sequences_name_borne')).toBe('nom-borne')
	})
})

describe('écriture d’une séquence — §13.6', () => {
	const CREATION: SaisieSequence = { idWorkspace: WORKSPACE, idSequence: null, nom: 'Cadence A' }
	const MODIFICATION: SaisieSequence = { ...CREATION, idSequence: SEQUENCE }

	// `workspace_id` N'EST ENVOYÉ QU'À LA CRÉATION : le renvoyer sur un `PATCH` proposerait de
	// déplacer une séquence d'un workspace à l'autre, et la clause `with check` refuserait par zéro
	// ligne — un refus qui se lirait comme un défaut.
	it('envoie `workspace_id` à la création, et JAMAIS à la modification', () => {
		expect(corpsEcritureSequence(CREATION)).toEqual({ name: 'Cadence A', workspace_id: WORKSPACE })
		expect(corpsEcritureSequence(MODIFICATION)).toEqual({ name: 'Cadence A' })
	})

	// LE NOM PART TEL QUEL : `app.btrim_blancs` est appliqué par la contrainte (§11.3), et
	// normaliser ici doublerait une règle de la base (§5.3 ter).
	it('n’applique AUCUN `trim` : la normalisation vit dans la base', () => {
		expect(corpsEcritureSequence({ ...CREATION, nom: '  Cadence A  ' })['name']).toBe(
			'  Cadence A  ',
		)
	})

	it('insère à la création et RELIT la ligne', async () => {
		const { client, appel } = espionEcriture({
			data: [{ id: SEQUENCE, name: 'Cadence A' }],
			error: null,
			status: 201,
		})
		const resultat = await enregistrerSequence(client, CREATION)

		expect(appel.verbe).toBe('insert')
		expect(appel.colonnes).toBe('id, name')
		expect(resultat.issue).toBe('enregistre')
	})

	it('met à jour sur filtre et RELIT la ligne', async () => {
		const { client, appel } = espionEcriture({
			data: [{ id: SEQUENCE, name: 'Cadence A' }],
			error: null,
			status: 200,
		})
		await enregistrerSequence(client, MODIFICATION)

		expect(appel.verbe).toBe('update')
		expect(appel.filtre).toBe(SEQUENCE)
	})

	// ZÉRO LIGNE N'EST PAS UN SUCCÈS. C'est le refus silencieux de la politique, MESURÉ sur la
	// lectrice (§11.8 ligne 8), et l'écran le nomme plutôt que de le confondre.
	it('rend « zero-ligne » sur un `PATCH` que la politique a laissé passer sans rien écrire', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect((await enregistrerSequence(client, MODIFICATION)).issue).toBe('zero-ligne')
	})

	it('rend « reseau » quand le transport relance plutôt que de rendre', async () => {
		const client = {
			from: () => {
				throw new Error('transport coupé')
			},
		} as unknown as ClientCrm
		expect((await enregistrerSequence(client, CREATION)).issue).toBe('reseau')
	})
})

describe('suppression d’une séquence — §13.6', () => {
	it('supprime sur filtre et RELIT les lignes parties', async () => {
		const { client, appel } = espionEcriture({ data: [{ id: SEQUENCE }], error: null, status: 200 })
		expect(await supprimerSequence(client, SEQUENCE)).toBe('supprime')
		expect(appel.verbe).toBe('delete')
		expect(appel.colonnes).toBe('id')
	})

	// MESURÉ AU §11.8 LIGNE 9 : la lectrice qui confirme reçoit `204` et la ligne est TOUJOURS LÀ.
	it('rend « zero-ligne » quand la base n’a rien supprimé sans lever d’erreur', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect(await supprimerSequence(client, SEQUENCE)).toBe('zero-ligne')
	})

	// LA RÈGLE QUE LA CONFIRMATION NE PEUT PAS PROMETTRE (§13.6) : une séquence ARMÉE ne se supprime
	// pas, et le refus est traduit plutôt que rangé dans `inconnu`.
	it('rend « sequence-armee » sur le `on delete restrict` d’une inscription', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'violates foreign key constraint "card_sequence_enrollments_sequence_fk"' },
			status: 409,
		})
		expect(await supprimerSequence(client, SEQUENCE)).toBe('sequence-armee')
	})
})

describe('le rang du palier ajouté, et le déplacement — §13.6', () => {
	// AUCUNE REQUÊTE DE PLUS : le rang est calculé depuis la donnée DÉJÀ LUE.
	it('donne au palier ajouté le rang suivant, calculé depuis la liste affichée', () => {
		expect(rangSuivant(TROIS_PALIERS)).toBe(4)
	})

	it('donne le rang 1 sur une séquence vide — la borne basse de la contrainte', () => {
		expect(rangSuivant([])).toBe(1)
	})

	// UNE LISTE DÉSORDONNÉE OU TROUÉE NE DOIT PAS PRODUIRE UN RANG DÉJÀ PRIS : le maximum, et non
	// la longueur. Une cadence dont un palier du milieu a été retiré porte 1 et 3.
	it('emploie le MAXIMUM et non la longueur, sur une cadence trouée', () => {
		expect(rangSuivant([{ position: 1 }, { position: 3 }])).toBe(4)
	})

	it('monte un palier d’un cran, et rend l’ordre COMPLET', () => {
		expect(ordreApresDeplacement(TROIS_PALIERS, PALIER_2, 'monter')).toEqual([
			PALIER_2,
			PALIER_1,
			PALIER_3,
		])
	})

	it('descend un palier d’un cran, et rend l’ordre COMPLET', () => {
		expect(ordreApresDeplacement(TROIS_PALIERS, PALIER_2, 'descendre')).toEqual([
			PALIER_1,
			PALIER_3,
			PALIER_2,
		])
	})

	// LE REPLI HORS BORNES EST LA SECONDE GARDE : les commandes correspondantes sont montées et
	// DÉSACTIVÉES par l'écran (§5.41), mais l'écran peut être contourné et la base ne doit pas
	// recevoir un ordre absurde.
	it('rend l’ordre INCHANGÉ plutôt qu’une exception, hors bornes', () => {
		expect(ordreApresDeplacement(TROIS_PALIERS, PALIER_1, 'monter')).toEqual([
			PALIER_1,
			PALIER_2,
			PALIER_3,
		])
		expect(ordreApresDeplacement(TROIS_PALIERS, PALIER_3, 'descendre')).toEqual([
			PALIER_1,
			PALIER_2,
			PALIER_3,
		])
	})

	it('rend l’ordre inchangé pour un palier qui n’est pas dans la liste', () => {
		expect(ordreApresDeplacement(TROIS_PALIERS, 'inconnu', 'monter')).toEqual([
			PALIER_1,
			PALIER_2,
			PALIER_3,
		])
	})
})

describe('ajout et retrait d’un palier — §13.6', () => {
	const SAISIE: SaisiePalier = {
		idWorkspace: WORKSPACE,
		idSequence: SEQUENCE,
		idModele: 'modele-1',
		delai: '5',
	}

	it('compose le corps du palier avec la position que l’appelant a calculée', () => {
		expect(corpsEcriturePalier(SAISIE, 4)).toEqual({
			workspace_id: WORKSPACE,
			sequence_id: SEQUENCE,
			position: 4,
			delai_jours: 5,
			template_id: 'modele-1',
		})
	})

	// LE DÉLAI N'EST PAS CORRIGÉ : poser ici un repli à `1` ferait enregistrer un délai que personne
	// n'a saisi (§5.3 ter, `CLAUDE.md` §18). La garde vit dans la base.
	//
	// CE TEST A TROUVÉ UNE AFFIRMATION FAUSSE DANS LE COMMENTAIRE DU MODULE, qui annonçait `NaN` :
	// `Number('')` rend `0`. Le résultat est le bon, et même MEILLEUR — `0` heurte
	// `mail_sequence_steps_delai_borne`, dont le refus porte un nom que l'écran traduit, là où `NaN`
	// serait sérialisé en `null` et retomberait dans le repli `inconnu`.
	it('laisse un délai vide partir en `0`, que la borne de la base refuse en le NOMMANT', () => {
		expect(corpsEcriturePalier({ ...SAISIE, delai: '' }, 1)['delai_jours']).toBe(0)
		expect(
			classerEcritureSequence(
				400,
				'new row for relation "mail_sequence_steps" violates check constraint "mail_sequence_steps_delai_borne"',
			),
		).toBe('delai-borne')
	})

	it('insère le palier et relit son identifiant', async () => {
		const { client, appel } = espionEcriture({ data: [{ id: PALIER_1 }], error: null, status: 201 })
		expect(await ajouterPalier(client, SAISIE, 4)).toBe('enregistre')
		expect(appel.verbe).toBe('insert')
	})

	it('rend « position-prise » quand deux onglets proposent le même rang', async () => {
		const { client } = espionEcriture({
			data: null,
			error: {
				message: 'duplicate key value violates unique constraint "mail_sequence_steps_sequence_position_key"',
			},
			status: 409,
		})
		expect(await ajouterPalier(client, SAISIE, 2)).toBe('position-prise')
	})

	it('retire un palier et RELIT la ligne partie', async () => {
		const { client, appel } = espionEcriture({ data: [{ id: PALIER_1 }], error: null, status: 200 })
		expect(await retirerPalier(client, PALIER_1)).toBe('enregistre')
		expect(appel.verbe).toBe('delete')
	})

	it('rend « zero-ligne » quand le retrait n’a rien retiré', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect(await retirerPalier(client, PALIER_1)).toBe('zero-ligne')
	})
})

describe('le réordonnancement — §13.3, §13.10', () => {
	it('appelle la RPC avec l’ordre COMPLET, sous les noms d’arguments de la migration', async () => {
		const { client, appel } = espionRpc({ data: 3, error: null, status: 200 })
		expect(await reordonnerPaliers(client, SEQUENCE, [PALIER_3, PALIER_1, PALIER_2])).toBe(
			'reordonne',
		)
		expect(appel.fonction).toBe('reordonner_paliers_sequence')
		expect(appel.arguments).toEqual({
			p_sequence_id: SEQUENCE,
			p_paliers: [PALIER_3, PALIER_1, PALIER_2],
		})
	})

	// L'ASSERTION LA PLUS IMPORTANTE DE CE BLOC. MESURÉ au §13.10 ligne 4 : la lectrice reçoit
	// `200` et `0`. Un `200` lu comme un succès annoncerait un réordonnancement qui n'a pas eu lieu.
	it('rend « zero-ligne » sur un `200` portant `0` — un succès HTTP, un refus métier', async () => {
		const { client } = espionRpc({ data: 0, error: null, status: 200 })
		expect(await reordonnerPaliers(client, SEQUENCE, [PALIER_1])).toBe('zero-ligne')
	})

	it('fond les trois refus de la RPC en une seule issue : le geste à poser est le même', async () => {
		for (const message of ['paliers_requis', 'paliers_dupliques', 'paliers_incomplets']) {
			const { client } = espionRpc({ data: null, error: { message }, status: 400 })
			expect(await reordonnerPaliers(client, SEQUENCE, [])).toBe('ordre-invalide')
		}
	})

	it('rend « session-expiree » sur un `401`', async () => {
		const { client } = espionRpc({ data: null, error: { message: 'JWT expired' }, status: 401 })
		expect(await reordonnerPaliers(client, SEQUENCE, [PALIER_1])).toBe('session-expiree')
	})
})

describe('le dictionnaire fermé de l’armement — §13.8', () => {
	// LES HUIT REFUS DE `armer_sequence_relance` LÈVENT UN `message` QUI EST UN NOM, versionné par
	// la migration `0060` et mesuré par `e2e/api/armement-sequences.spec.ts`.
	it.each([
		[409, 'enrollment_exists', 'deja-armee'],
		[400, 'card_not_stalled', 'non-figee'],
		[400, 'sequence_empty', 'sequence-vide'],
		[400, 'sequence_not_available', 'sequence-indisponible'],
		[400, 'card_not_available', 'adresse-absente'],
		[403, 'identity_not_available', 'identite-refusee'],
		[403, 'forbidden', 'refus'],
		[401, 'JWT expired', 'session-expiree'],
	])('classe %i / %s en « %s »', (statut, message, attendu) => {
		expect(classerArmement(statut as number, message as string)).toBe(attendu)
	})

	// `identity_not_available` EST DISTINGUÉ DE `forbidden`, ET CE N'EST PAS UN RAFFINEMENT : les
	// deux rendent `403` / `42501`, mais ils demandent deux gestes différents — choisir une autre
	// adresse, ou demander un droit.
	it('DISTINGUE les deux refus qui rendent tous deux `403`', () => {
		expect(classerArmement(403, 'identity_not_available')).not.toBe(
			classerArmement(403, 'forbidden'),
		)
	})

	// `card_not_available` CONTIENT `card_not_`, COMME `card_not_stalled` : l'ordre des tests les
	// sépare, et cette assertion le tient.
	it('ne confond PAS `card_not_stalled` et `card_not_available`', () => {
		expect(classerArmement(400, 'card_not_stalled')).toBe('non-figee')
		expect(classerArmement(400, 'card_not_available')).toBe('adresse-absente')
	})

	it('classe un succès en « arme », l’absence de réponse en « reseau », le reste en « inconnu »', () => {
		expect(classerArmement(200, null)).toBe('arme')
		expect(classerArmement(undefined, null)).toBe('reseau')
		expect(classerArmement(500, 'un message imprévu')).toBe('inconnu')
	})
})

describe('armement et interruption — §13.8', () => {
	it('appelle la RPC d’armement sous les noms d’arguments de la migration', async () => {
		const { client, appel } = espionRpc({ data: 'inscription-1', error: null, status: 200 })
		expect(await armerSequence(client, 'card-1', SEQUENCE, 'identite-1')).toBe('arme')
		expect(appel.fonction).toBe('armer_sequence_relance')
		expect(appel.arguments).toEqual({
			p_card_id: 'card-1',
			p_sequence_id: SEQUENCE,
			p_identity_id: 'identite-1',
		})
	})

	it('rend « non-figee » quand la base refuse une affaire qui n’a pas dépassé son seuil', async () => {
		const { client } = espionRpc({
			data: null,
			error: { message: 'card_not_stalled' },
			status: 400,
		})
		expect(await armerSequence(client, 'card-1', SEQUENCE, 'identite-1')).toBe('non-figee')
	})

	it('appelle la RPC d’interruption sous le nom d’argument de la migration', async () => {
		const { client, appel } = espionRpc({ data: null, error: null, status: 204 })
		expect(await interrompreSequence(client, 'inscription-1')).toBe('interrompue')
		expect(appel.fonction).toBe('interrompre_sequence_relance')
		expect(appel.arguments).toEqual({ p_enrollment_id: 'inscription-1' })
	})

	it('rend « refus » quand l’appelant ne peut pas écrire l’affaire', async () => {
		const { client } = espionRpc({ data: null, error: { message: 'forbidden' }, status: 403 })
		expect(await interrompreSequence(client, 'inscription-1')).toBe('refus')
	})
})

describe('lecture de l’inscription active — §13.8', () => {
	it('filtre sur l’affaire ET sur `active`, et se borne à UNE ligne', async () => {
		const { client, appel } = espionLecture({
			data: [
				{
					id: 'inscription-1',
					armed_at: '2026-08-26T04:00:00+00:00',
					last_position: null,
					last_sent_at: null,
					mail_sequences: { name: 'Relance en trois temps' },
					mail_outbound_identities: {
						label: 'Identité de service',
						from_address: 'systeme@crm.p2enjoy.test',
					},
				},
			],
			error: null,
			status: 200,
		})
		const etat = await lireInscriptionActive(client, 'card-1')

		expect(appel.table).toBe('card_sequence_enrollments')
		expect(appel.colonnes).toBe(COLONNES_INSCRIPTION)
		expect(appel.filtres).toEqual([
			['card_id', 'card-1'],
			['status', 'active'],
		])
		expect(appel.limite).toBe(1)
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') {
			expect(etat.donnees?.sequence).toBe('Relance en trois temps')
			expect(etat.donnees?.adresse).toBe('systeme@crm.p2enjoy.test')
		}
	})

	// AUCUNE INSCRIPTION ACTIVE N'EST L'ÉTAT ORDINAIRE, ET NON UNE ERREUR : le seed n'arme rien
	// (§12.12, §13.11), et le bloc de la fiche s'ouvre donc toujours sur son geste.
	it('rend `null` — et non une erreur — quand aucune inscription n’est active', async () => {
		const { client } = espionLecture({ data: [], error: null, status: 200 })
		const etat = await lireInscriptionActive(client, 'card-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toBeNull()
	})
})

describe('le libellé d’un palier — §13.6', () => {
	// LE `J+` DIT UN DÉLAI RELATIF SANS MENTIR (§11.4) : un décalage absolu serait dérivable, mais
	// il ferait lire une date que la cadence ne garantit pas — elle GLISSE sur l'envoi réel (§12.5).
	it('rend « J+3 · nom du modèle »', () => {
		expect(
			libellePalier({
				id: PALIER_1,
				position: 1,
				delai_jours: 3,
				template_id: 'm',
				modele: 'Relance sans réponse',
			}),
		).toBe('J+3 · Relance sans réponse')
	})

	// RÈGLE DE LA CELLULE VIDE DU §5.9 : ni tiret, ni « non renseigné ».
	it('rend le seul délai, sans tiret, quand le nom du modèle manque', () => {
		expect(
			libellePalier({ id: PALIER_1, position: 1, delai_jours: 3, template_id: 'm', modele: null }),
		).toBe('J+3')
	})
})
