// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
// @verifies docs/SPEC-modeles-emails.md §9.2 (les colonnes demandées, et celles qui ne le sont
//           jamais), §9.3 (le guichet et l'insertion d'un trou à la position du curseur), §9.5
//           (les trois sources et leurs libellés), §9.6 (zéro ligne n'est pas une erreur), §9.8
//           (dictionnaire fermé des refus et repli nommé)
// @verifies docs/SPEC-modeles-emails.md §2.5 (ce que la base refuse), §2.7 (contrat d'API mesuré)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
// @verifies CRM-124 (docs/BACKLOG.md) T2 — docs/SPEC-modeles-emails.md §9.5 (révision `CRM-124`,
//           décision 806) : le contact présélectionné après le choix d'une affaire
// @verifies CRM-125 (docs/BACKLOG.md) T3 — docs/SPEC-modeles-emails.md §14.2 : l'appel de l'aperçu sur le jeu
//           d'exemple, zéro ligne rendu `null`, l'erreur classée
// @verifies CRM-111 (docs/BACKLOG.md) T6.2 — docs/SPEC-modeles-emails.md §15.2, §15.4 : le rattachement passé au rendu
//           (absent quand rien n'est choisi), la lecture des rattachements d'une affaire dans l'ordre de la base
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue. Trois
// exigences sont portées par l'appel lui-même et qu'aucune assertion sur le résultat
// n'attraperait : `workspace_id` n'est envoyé QU'À LA CRÉATION, toute écriture relit sa ligne par
// `select()`, et la chaîne vide d'un sélecteur part en `null` vers la fonction de rendu.
//
// Les noms de contrainte employés ici sont ceux que la migration `0055` pose et que
// `e2e/api/modeles-emails.spec.ts` MESURE dans le message rendu par PostgREST : aucun n'est
// inventé pour la commodité du test.

import { describe, expect, it } from 'vitest'
import {
	classerEcritureModele,
	COLONNES_AFFAIRE_PREVISUALISATION,
	contactApresChoixAffaire,
	COLONNES_MODELE_EMAIL,
	corpsEcritureModele,
	enregistrerModeleEmail,
	insererTrou,
	libelleContactPrevisualisation,
	libelleIdentitePrevisualisation,
	lireModelesEmails,
	lireRattachementsPrevisualisation,
	lireVariablesModele,
	rendreApercuExemple,
	rendreModeleEmail,
	supprimerModeleEmail,
	trouDe,
	type SaisieModeleEmail,
} from './modeles-emails'
import type { ClientCrm } from './supabase'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const MODELE = '7e11a7e0-0000-4000-8000-000000000001'

const SAISIE_CREATION: SaisieModeleEmail = {
	idWorkspace: WORKSPACE,
	idModele: null,
	nom: 'Relance sans réponse',
	objet: 'Où en est {{card.title}} ?',
	corps: 'Bonjour {{contact.full_name}},',
}

const SAISIE_MODIFICATION: SaisieModeleEmail = { ...SAISIE_CREATION, idModele: MODELE }

const LIGNE = {
	id: MODELE,
	workspace_id: WORKSPACE,
	name: 'Relance sans réponse',
	subject: 'Où en est {{card.title}} ?',
	body_text: 'Bonjour {{contact.full_name}},',
}

type Reponse = { data: unknown; error: { message: string } | null; status: number }

function espionLecture(reponse: Reponse): {
	client: ClientCrm
	appel: { table?: string; colonnes?: string; tri?: string }
} {
	const appel: { table?: string; colonnes?: string; tri?: string } = {}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return {
						order: (colonne: string) => {
							appel.tri = colonne
							return Promise.resolve(reponse)
						},
					}
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

/** Un faux client d'écriture, qui retient le verbe employé, le corps envoyé et le filtre posé. */
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

describe('lecture des modèles — §9.2', () => {
	it('demande les cinq colonnes utiles, triées par nom', async () => {
		const { client, appel } = espionLecture({ data: [LIGNE], error: null, status: 200 })
		const etat = await lireModelesEmails(client)

		expect(appel.table).toBe('mail_templates')
		expect(appel.colonnes).toBe(COLONNES_MODELE_EMAIL)
		// LE TRI SUIT LA TÊTE DE LIGNE (§9.4) : le nom est la clé, unique par workspace.
		expect(appel.tri).toBe('name')
		expect(etat.statut).toBe('pret')
	})

	// `created_by` EST UNE TRACE, JAMAIS UN DROIT (§2.2) : aucune politique ne la lit, et l'écran ne
	// la montre pas. La demander donnerait à croire qu'elle décide de quelque chose.
	it('ne demande JAMAIS `created_by`, ni les horodatages', () => {
		expect(COLONNES_MODELE_EMAIL).not.toContain('created_by')
		expect(COLONNES_MODELE_EMAIL).not.toContain('created_at')
		expect(COLONNES_MODELE_EMAIL).not.toContain('updated_at')
	})

	it('rend un état d’erreur classé, jamais une liste vide, quand la requête échoue', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await lireModelesEmails(client)).statut).toBe('erreur')
	})

	it('rend un état d’erreur quand le transport relance plutôt que de rendre', async () => {
		const client = {
			from: () => {
				throw new Error('transport coupé')
			},
		} as unknown as ClientCrm
		expect((await lireModelesEmails(client)).statut).toBe('erreur')
	})

	it('demande deux colonnes seulement pour le sélecteur d’affaires — §9.5', () => {
		expect(COLONNES_AFFAIRE_PREVISUALISATION).toBe('id, title')
	})
})

describe('le guichet des variables — §9.3', () => {
	it('appelle la fonction publique, jamais une liste écrite dans l’écran', async () => {
		const { client, appel } = espionRpc({
			data: ['card.amount', 'card.title'],
			error: null,
			status: 200,
		})
		const etat = await lireVariablesModele(client)

		expect(appel.fonction).toBe('mail_template_variables')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual(['card.amount', 'card.title'])
	})

	// Un cache de schéma PostgREST périmé rend `null` là où la fonction rend un tableau. Une palette
	// vide est alors le seul repli honnête ; un `.map` sur `null` ferait planter la fiche entière.
	it('rend une liste vide, jamais `null`, quand la réponse est nulle', async () => {
		const { client } = espionRpc({ data: null, error: null, status: 200 })
		const etat = await lireVariablesModele(client)
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual([])
	})

	it('rend un état d’erreur classé quand le guichet refuse — le `401` de l’anonyme', async () => {
		const { client } = espionRpc({
			data: null,
			error: { message: 'permission denied for function mail_template_variables' },
			status: 401,
		})
		const etat = await lireVariablesModele(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})
})

describe('le corps envoyé — §9.8', () => {
	// `workspace_id` N'EST ENVOYÉ QU'À LA CRÉATION : le renvoyer sur un `PATCH` proposerait de
	// déplacer un modèle d'un workspace à l'autre, geste qu'aucune spécification ne prend.
	it('porte `workspace_id` à la création', () => {
		expect(corpsEcritureModele(SAISIE_CREATION)).toEqual({
			workspace_id: WORKSPACE,
			name: 'Relance sans réponse',
			subject: 'Où en est {{card.title}} ?',
			body_text: 'Bonjour {{contact.full_name}},',
		})
	})

	it('ne porte PAS `workspace_id` à la modification', () => {
		expect(corpsEcritureModele(SAISIE_MODIFICATION)).not.toHaveProperty('workspace_id')
	})

	// AUCUN `trim` ICI : `app.btrim_blancs` est appliqué par les contraintes de la base, et
	// normaliser dans le client doublerait une règle de la base (§5.3 ter).
	it('envoie les textes TELS QUELS, blancs de bord compris', () => {
		const corps = corpsEcritureModele({ ...SAISIE_CREATION, nom: '  Relance  ' })
		expect(corps['name']).toBe('  Relance  ')
	})
})

describe('le classement des refus — §9.8', () => {
	// L'ORDRE DES TESTS COMPTE : `mail_templates_subject_variables` contient
	// `mail_templates_subject`, si bien qu'un test de borne posé d'abord capturerait un refus de
	// variable et poserait le message sous le mauvais champ.
	it('distingue la variable inconnue de l’OBJET de celle du CORPS', () => {
		expect(
			classerEcritureModele(
				400,
				'new row for relation "mail_templates" violates check constraint "mail_templates_subject_variables"',
			),
		).toBe('variable-inconnue-objet')
		expect(
			classerEcritureModele(
				400,
				'new row for relation "mail_templates" violates check constraint "mail_templates_body_variables"',
			),
		).toBe('variable-inconnue-corps')
	})

	it('ne confond PAS la borne de l’objet avec sa contrainte de variables', () => {
		expect(
			classerEcritureModele(
				400,
				'new row for relation "mail_templates" violates check constraint "mail_templates_subject_borne"',
			),
		).toBe('objet-borne')
	})

	it('classe les trois autres bornes et l’unicité du nom', () => {
		expect(classerEcritureModele(400, 'violates check constraint "mail_templates_name_borne"')).toBe(
			'nom-borne',
		)
		expect(classerEcritureModele(400, 'violates check constraint "mail_templates_body_borne"')).toBe(
			'corps-borne',
		)
		expect(
			classerEcritureModele(
				409,
				'duplicate key value violates unique constraint "mail_templates_workspace_name_key"',
			),
		).toBe('nom-pris')
	})

	it('classe le `403` de la lectrice et le `401` de la session expirée', () => {
		expect(classerEcritureModele(403, 'permission denied for table mail_templates')).toBe('refus')
		expect(classerEcritureModele(401, 'JWT expired')).toBe('session-expiree')
	})

	// `reseau` est la réponse à « aucune réponse », et il se distingue d'`inconnu` : réessayer a un
	// sens dans un cas et pas dans l'autre.
	it('classe l’absence de réponse en `reseau`, et le reste en repli NOMMÉ', () => {
		expect(classerEcritureModele(undefined, 'fetch failed')).toBe('reseau')
		expect(classerEcritureModele(0, 'fetch failed')).toBe('reseau')
		expect(classerEcritureModele(500, 'une prose que personne ne connaît')).toBe('inconnu')
	})

	it('classe un succès sans message en `enregistre`', () => {
		expect(classerEcritureModele(201, null)).toBe('enregistre')
		expect(classerEcritureModele(200, null)).toBe('enregistre')
		expect(classerEcritureModele(500, null)).toBe('inconnu')
	})
})

describe('l’écriture, et la relecture qui la prouve — §9.8', () => {
	it('crée par `insert` et RELIT la ligne', async () => {
		const { client, appel } = espionEcriture({ data: [LIGNE], error: null, status: 201 })
		const resultat = await enregistrerModeleEmail(client, SAISIE_CREATION)

		expect(appel.verbe).toBe('insert')
		expect(appel.colonnes).toBe(COLONNES_MODELE_EMAIL)
		expect(resultat.issue).toBe('enregistre')
	})

	it('modifie par `update` filtré sur l’identifiant, et RELIT la ligne', async () => {
		const { client, appel } = espionEcriture({ data: [LIGNE], error: null, status: 200 })
		await enregistrerModeleEmail(client, SAISIE_MODIFICATION)

		expect(appel.verbe).toBe('update')
		expect(appel.filtre).toBe(MODELE)
		expect(appel.colonnes).toBe(COLONNES_MODELE_EMAIL)
	})

	// ZÉRO LIGNE N'EST PAS UN SUCCÈS, et c'est la mesure du §2.7 ligne 7 : la lectrice reçoit `200`
	// et `[]`, la base ne levant AUCUNE erreur. Sans cette issue, l'écran annoncerait un
	// enregistrement qui n'a pas eu lieu.
	it('rend `zero-ligne` quand la politique laisse passer sans rien écrire', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect((await enregistrerModeleEmail(client, SAISIE_MODIFICATION)).issue).toBe('zero-ligne')
	})

	it('rend `reseau` quand le transport relance plutôt que de rendre', async () => {
		const client = {
			from: () => {
				throw new Error('transport coupé')
			},
		} as unknown as ClientCrm
		expect((await enregistrerModeleEmail(client, SAISIE_CREATION)).issue).toBe('reseau')
	})
})

describe('la suppression, et son zéro-ligne — §9.7', () => {
	it('supprime par `delete` filtré, et relit les lignes supprimées', async () => {
		const { client, appel } = espionEcriture({ data: [{ id: MODELE }], error: null, status: 200 })
		const issue = await supprimerModeleEmail(client, MODELE)

		expect(appel.verbe).toBe('delete')
		expect(appel.filtre).toBe(MODELE)
		expect(issue).toBe('supprime')
	})

	// LE SILENCE DE LA CLAUSE `using` : MESURÉ au §2.7 ligne 8, la lectrice reçoit `204` et la ligne
	// est TOUJOURS LÀ. Sans relecture, l'écran annoncerait une suppression que la base a refusée.
	it('rend `zero-ligne` quand la ligne n’a pas été supprimée', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		expect(await supprimerModeleEmail(client, MODELE)).toBe('zero-ligne')
	})

	it('rend `refus` sur un `403`, et le repli nommé sur le reste', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { message: 'permission denied' },
			status: 403,
		})
		expect(await supprimerModeleEmail(client, MODELE)).toBe('refus')

		const autre = espionEcriture({ data: null, error: { message: 'boom' }, status: 500 })
		expect(await supprimerModeleEmail(autre.client, MODELE)).toBe('inconnu')
	})
})

describe('le rendu, et son zéro-ligne — §9.5, §9.6', () => {
	it('envoie les quatre paramètres, et convertit la chaîne vide en `null`', async () => {
		const { client, appel } = espionRpc({ data: [], error: null, status: 200 })
		await rendreModeleEmail(client, {
			idModele: MODELE,
			idAffaire: 'affaire-1',
			idContact: '',
			idIdentite: '',
		})

		expect(appel.fonction).toBe('rendre_modele_email')
		expect(appel.arguments).toEqual({
			p_template_id: MODELE,
			p_card_id: 'affaire-1',
			// AUCUN CHOIX N'EST DEVINÉ : un contact nul fait trois trous NOMMÉS, une identité nulle
			// en fait deux (§8.5). L'écran ne choisit ni l'un ni l'autre à la place du rédacteur.
			p_contact_id: null,
			p_identity_id: null,
		})
	})

	// UNE AFFAIRE NON CHOISIE N'EST PAS TRAITÉE À PART : la chaîne vide part en `null`, la fonction
	// rend zéro ligne, et l'écran affiche la même phrase que pour une affaire masquée.
	it('envoie `null` pour une affaire non choisie, sans garde côté client', async () => {
		const { client, appel } = espionRpc({ data: [], error: null, status: 200 })
		await rendreModeleEmail(client, {
			idModele: MODELE,
			idAffaire: '',
			idContact: '',
			idIdentite: '',
		})
		expect((appel.arguments ?? {})['p_card_id']).toBeNull()
	})

	// ZÉRO LIGNE N'EST PAS UNE ERREUR (§8.3) : un identifiant inconnu et un identifiant masqué
	// rendent la MÊME chose, et c'est la seule façon de ne rien révéler.
	it('rend `pret(null)` sur zéro ligne, jamais un état d’erreur', async () => {
		const { client } = espionRpc({ data: [], error: null, status: 200 })
		const etat = await rendreModeleEmail(client, {
			idModele: MODELE,
			idAffaire: 'affaire-1',
			idContact: '',
			idIdentite: '',
		})
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toBeNull()
	})

	it('rend les trois colonnes, et une liste vide quand l’inventaire est absent', async () => {
		const { client } = espionRpc({
			data: [{ subject: 'Où en est X ?', body_text: 'Bonjour,', variables_nulles: undefined }],
			error: null,
			status: 200,
		})
		const etat = await rendreModeleEmail(client, {
			idModele: MODELE,
			idAffaire: 'affaire-1',
			idContact: '',
			idIdentite: '',
		})
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret' && etat.donnees !== null) {
			expect(etat.donnees.subject).toBe('Où en est X ?')
			expect(etat.donnees.variables_nulles).toEqual([])
		}
	})

	it('rend un état d’erreur classé sur le `401` de l’anonyme', async () => {
		const { client } = espionRpc({
			data: null,
			error: { message: 'permission denied for function rendre_modele_email' },
			status: 401,
		})
		const etat = await rendreModeleEmail(client, {
			idModele: MODELE,
			idAffaire: 'affaire-1',
			idContact: '',
			idIdentite: '',
		})
		expect(etat.statut).toBe('erreur')
	})
})

describe('l’insertion d’un trou à la position du curseur — §9.3', () => {
	it('écrit la graphie EXACTE que la base accepte', () => {
		expect(trouDe('card.title')).toBe('{{card.title}}')
	})

	it('insère au milieu du texte, et rend le curseur APRÈS le trou', () => {
		// La position 8 est celle qui SUIT l'espace de « Bonjour  » : le trou s'insère entre l'espace
		// et la virgule, exactement là où le curseur clignotait.
		const resultat = insererTrou('Bonjour , comment allez-vous ?', 8, 8, 'contact.full_name')
		expect(resultat.texte).toBe('Bonjour {{contact.full_name}}, comment allez-vous ?')
		expect(resultat.curseur).toBe(8 + '{{contact.full_name}}'.length)
	})

	// UNE SÉLECTION EST REMPLACÉE, elle n'est pas doublée : `debut` et `fin` sont les deux bornes
	// que l'élément rend, et elles diffèrent dès qu'un texte est sélectionné.
	it('REMPLACE une sélection plutôt que de la doubler', () => {
		const resultat = insererTrou('Bonjour NOM,', 8, 11, 'contact.full_name')
		expect(resultat.texte).toBe('Bonjour {{contact.full_name}},')
	})

	// Une position hors bornes — qu'un champ jamais visité peut rendre — est ramenée à la fin du
	// texte plutôt que de produire un `slice` silencieusement faux.
	it('ramène une position hors bornes à la fin du texte', () => {
		expect(insererTrou('Bonjour', 999, 999, 'card.title').texte).toBe('Bonjour{{card.title}}')
		expect(insererTrou('Bonjour', -5, -5, 'card.title').texte).toBe('{{card.title}}Bonjour')
		expect(insererTrou('Bonjour', Number.NaN, Number.NaN, 'card.title').texte).toBe(
			'Bonjour{{card.title}}',
		)
	})

	it('insère dans un texte vide', () => {
		expect(insererTrou('', 0, 0, 'card.title')).toEqual({
			texte: '{{card.title}}',
			curseur: '{{card.title}}'.length,
		})
	})
})

describe('les libellés des sélecteurs — §9.5', () => {
	// LA FORME DU §5.35, et pour son motif : deux identités d'une même personne peuvent porter le
	// même libellé, et l'adresse est leur clé.
	it('nomme une identité par son libellé suivi de son adresse', () => {
		expect(
			libelleIdentitePrevisualisation({
				label: 'Envoi de Driss Lemoine',
				from_address: 'contact@p2enjoy.test',
			}),
		).toBe('Envoi de Driss Lemoine — contact@p2enjoy.test')
	})

	it('nomme un contact par son nom, et son adresse quand elle existe', () => {
		expect(
			libelleContactPrevisualisation({ full_name: 'Léo Marchand', email: 'leo@sogexia.example' }),
		).toBe('Léo Marchand — leo@sogexia.example')
	})

	// UN CONTACT SANS ADRESSE NE PRODUIT NI TIRET NI VALEUR INVENTÉE : la règle de la cellule vide
	// du §5.9. Une adresse faite de blancs est traitée comme absente, et non rendue telle quelle.
	it('rend le seul nom quand l’adresse est absente ou faite de blancs', () => {
		expect(libelleContactPrevisualisation({ full_name: 'Léo Marchand', email: null })).toBe(
			'Léo Marchand',
		)
		expect(libelleContactPrevisualisation({ full_name: 'Léo Marchand', email: '   ' })).toBe(
			'Léo Marchand',
		)
	})
})

describe('contactApresChoixAffaire — CRM-124, §9.5', () => {
	const LEO = '5eed0000-0000-4000-8000-000000000091'
	const DUPONT = '5eed0000-0000-4000-8000-000000000092'
	const AUTRE = '5eed0000-0000-4000-8000-000000000093'
	const PROPOSES = new Set([LEO, DUPONT, AUTRE])

	it('présélectionne l’unique contact rattaché quand le contact est vide', () => {
		expect(
			contactApresChoixAffaire({
				rattaches: [{ contactId: LEO }],
				idsProposes: PROPOSES,
				idContactCourant: '',
				idPreselectionPrecedente: '',
			}),
		).toEqual({ idContact: LEO, idPreselection: LEO })
	})

	// CHOISIR ENTRE PLUSIEURS SERAIT DEVINER : ni le premier du tri, ni aucun autre.
	it('ne présélectionne rien quand l’affaire porte plusieurs contacts, ou aucun', () => {
		for (const rattaches of [[{ contactId: LEO }, { contactId: DUPONT }], []]) {
			expect(
				contactApresChoixAffaire({
					rattaches,
					idsProposes: PROPOSES,
					idContactCourant: '',
					idPreselectionPrecedente: '',
				}),
			).toEqual({ idContact: '', idPreselection: '' })
		}
	})

	it('remplace la présélection précédente par celle de la nouvelle affaire', () => {
		expect(
			contactApresChoixAffaire({
				rattaches: [{ contactId: DUPONT }],
				idsProposes: PROPOSES,
				idContactCourant: LEO,
				idPreselectionPrecedente: LEO,
			}),
		).toEqual({ idContact: DUPONT, idPreselection: DUPONT })
	})

	// UNE PRÉSÉLECTION QUE LA NOUVELLE AFFAIRE NE JUSTIFIE PLUS EST RETIRÉE : la laisser ferait
	// rendre le texte d'une affaire avec le contact d'une autre, sans que personne l'ait choisi.
	it('retire la présélection précédente quand la nouvelle affaire n’en justifie aucune', () => {
		expect(
			contactApresChoixAffaire({
				rattaches: [{ contactId: LEO }, { contactId: DUPONT }],
				idsProposes: PROPOSES,
				idContactCourant: LEO,
				idPreselectionPrecedente: LEO,
			}),
		).toEqual({ idContact: '', idPreselection: '' })
	})

	it('ne remplace jamais un choix manuel', () => {
		for (const rattaches of [[{ contactId: DUPONT }], [], null]) {
			expect(
				contactApresChoixAffaire({
					rattaches,
					idsProposes: PROPOSES,
					idContactCourant: AUTRE,
					idPreselectionPrecedente: LEO,
				}),
			).toEqual({ idContact: AUTRE, idPreselection: '' })
		}
	})

	// UN ÉCHEC DE LECTURE NE PRÉSÉLECTIONNE RIEN, et ne laisse pas la présélection d'une autre affaire.
	it('traite un échec de lecture comme une affaire sans rattachement', () => {
		expect(
			contactApresChoixAffaire({
				rattaches: null,
				idsProposes: PROPOSES,
				idContactCourant: LEO,
				idPreselectionPrecedente: LEO,
			}),
		).toEqual({ idContact: '', idPreselection: '' })
	})

	// LA BASE REÇOIT L'IDENTIFIANT AFFICHÉ : un contact absent du sélecteur n'est pas présélectionné,
	// sinon le sélecteur montrerait « Aucun contact » et le rendu en recevrait un.
	it('ne présélectionne pas un contact que le sélecteur ne propose pas', () => {
		expect(
			contactApresChoixAffaire({
				rattaches: [{ contactId: LEO }],
				idsProposes: new Set<string>(),
				idContactCourant: '',
				idPreselectionPrecedente: '',
			}),
		).toEqual({ idContact: '', idPreselection: '' })
	})
})

describe('rendreApercuExemple — CRM-125, §14.2', () => {
	function client(reponse: { data: unknown; error: unknown; status: number }) {
		const appels: { nom: string; args: unknown }[] = []
		const faux = {
			rpc: (nom: string, args: unknown) => {
				appels.push({ nom, args })
				return Promise.resolve(reponse)
			},
		} as unknown as ClientCrm
		return { faux, appels }
	}

	it('appelle la fonction avec le seul modèle, et rend la ligne', async () => {
		const ligne = { subject: 'Objet', body_text: 'Corps', signature_text: 'Sig', identity_is_sample: false }
		const { faux, appels } = client({ data: [ligne], error: null, status: 200 })
		expect(await rendreApercuExemple(faux, MODELE)).toEqual({ statut: 'pret', donnees: ligne })
		expect(appels).toEqual([{ nom: 'render_mail_template_sample', args: { p_template_id: MODELE } }])
	})

	it('zéro ligne n’est pas une erreur : le modèle n’est plus lisible', async () => {
		const { faux } = client({ data: [], error: null, status: 200 })
		expect(await rendreApercuExemple(faux, MODELE)).toEqual({ statut: 'pret', donnees: null })
	})

	it('une signature absente vaut null, et un refus est classé', async () => {
		const { faux } = client({ data: [{ subject: 'O', body_text: 'C', identity_is_sample: true }], error: null, status: 200 })
		const rendu = await rendreApercuExemple(faux, MODELE)
		expect(rendu.statut === 'pret' && rendu.donnees?.signature_text).toBeNull()
		const enPanne = client({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await rendreApercuExemple(enPanne.faux, MODELE)).statut).toBe('erreur')
	})
})

describe('le rattachement de la prévisualisation — §15.2, §15.4 (CRM-111 T6.2)', () => {
	it('passe le rattachement choisi en `p_placement_id`', async () => {
		const { client, appel } = espionRpc({ data: [], error: null, status: 200 })
		await rendreModeleEmail(client, { idModele: MODELE, idAffaire: 'affaire-1', idContact: '', idIdentite: '', idRattachement: 'p-2' })
		expect(appel.arguments).toMatchObject({ p_card_id: 'affaire-1', p_placement_id: 'p-2' })
	})

	it('n’envoie aucun `p_placement_id` quand rien n’est choisi : le défaut de la base rend le plus ancien', async () => {
		for (const idRattachement of [undefined, '']) {
			const { client, appel } = espionRpc({ data: [], error: null, status: 200 })
			await rendreModeleEmail(client, { idModele: MODELE, idAffaire: 'affaire-1', idContact: '', idIdentite: '', idRattachement })
			expect(appel.arguments).not.toHaveProperty('p_placement_id')
		}
	})

	/** Un faux client qui retient le filtre et les tris posés sur `card_placements`. */
	function espionRattachements(reponse: Reponse) {
		const appel: { table?: string; colonnes?: string; filtre?: [string, string]; tris: string[] } = { tris: [] }
		const maillon: Record<string, unknown> = {}
		maillon.select = (colonnes: string) => ((appel.colonnes = colonnes), maillon)
		maillon.eq = (colonne: string, valeur: string) => ((appel.filtre = [colonne, valeur]), maillon)
		maillon.order = (colonne: string) => (appel.tris.push(colonne), maillon)
		maillon.then = (resoudre: (r: Reponse) => unknown) => resoudre(reponse)
		const client = { from: (table: string) => ((appel.table = table), maillon) } as unknown as ClientCrm
		return { client, appel }
	}

	it('lit les rattachements de l’affaire, du plus ancien au plus récent, et les nomme par leur track et leur channel', async () => {
		const { client, appel } = espionRattachements({
			data: [
				{ id: 'p-1', channels: { name: 'Refonte de site', tracks: { name: 'Studio web' } } },
				{ id: 'p-2', channels: { name: 'Grands comptes', tracks: { name: 'Conseil & IA' } } },
			],
			error: null,
			status: 200,
		})
		const etat = await lireRattachementsPrevisualisation(client, 'affaire-1')
		expect(appel.table).toBe('card_placements')
		expect(appel.filtre).toEqual(['card_id', 'affaire-1'])
		expect(appel.tris).toEqual(['created_at', 'id'])
		expect(etat).toEqual({
			statut: 'pret',
			donnees: [
				{ id: 'p-1', track: 'Studio web', channel: 'Refonte de site' },
				{ id: 'p-2', track: 'Conseil & IA', channel: 'Grands comptes' },
			],
		})
	})

	it('classe une erreur de lecture, sans rien rendre', async () => {
		const { client } = espionRattachements({ data: null, error: { message: 'permission denied' }, status: 403 })
		const etat = await lireRattachementsPrevisualisation(client, 'affaire-1')
		expect(etat.statut).toBe('erreur')
	})
})
