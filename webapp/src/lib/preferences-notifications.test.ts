// @verifies CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences
// @verifies docs/SPEC-notifications.md §42.1 (il n'y a qu'un canal, et la liste des types est
//           fermée), §43.4 (l'absence de ligne vaut consentement), §46.3 (la RPC, unique chemin
//           d'écriture, ses trois refus nommés, et l'état qu'elle rend), §47 (le contrat d'API),
//           §49 (preuves unitaires attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.45 (la case ne se coche qu'après la réponse)
//
// Ces tests portent sur la LOGIQUE, sans navigateur ni pile : c'est ce que la séparation du module
// rend possible. La pile réelle est éprouvée par `e2e/api/preferences-notifications.spec.ts`, et
// la règle en base par `supabase/tests/0064_preferences_notifications.test.sql`.

import { describe, expect, it } from 'vitest'
import {
	appliquerPreferences,
	classerRefusPreference,
	ecrirePreferenceNotification,
	estTypePreference,
	lirePreferencesNotifications,
	SYMBOLE_SANS_SESSION,
	SYMBOLE_TYPE_INCONNU,
	SYMBOLE_VALEUR_ABSENTE,
	TYPES_PREFERENCE,
} from './preferences-notifications'
import type { ClientCrm } from './supabase'

/** Un double de `client.from(…).select(…)`, qui retient les colonnes demandées. */
function clientLecture(reponse: {
	data?: readonly { type: string; in_app: boolean }[] | null
	error: { message: string } | null
	status: number
}) {
	const appel: { table?: string; colonnes?: string } = {}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return Promise.resolve(reponse)
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** Un double de `client.rpc`, qui retient l'appel émis. */
function clientRpc(reponse: {
	data?: { type: string; in_app: boolean } | null
	error: { message: string; code?: string } | null
	status: number
}) {
	const appel: { nom?: string; arguments?: Record<string, unknown> } = {}
	const client = {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appel.nom = nom
			appel.arguments = args
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('la liste des types (§42.1)', () => {
	// ELLE EST FERMÉE, ET C'EST LE MIROIR DU `check` DE LA MIGRATION. Trois endroits portent la
	// même valeur — la table `notifications`, la table `notification_preferences`, et cette
	// constante —, et un écart entre eux rendrait une case que la base refuse.
	it('ne contient QUE « mention », comme le `check` fermé de la base', () => {
		expect(TYPES_PREFERENCE).toEqual(['mention'])
	})

	it('reconnaît « mention » et rejette tout le reste', () => {
		expect(estTypePreference('mention')).toBe(true)
		expect(estTypePreference('echeance')).toBe(false)
		expect(estTypePreference('')).toBe(false)
	})
})

describe('le défaut « je reçois » (§43.4)', () => {
	// C'EST LA MOITIÉ DU §43.4 QUI VIT DANS L'ÉCRAN, et l'autre moitié est le `coalesce` de
	// `app.notification_consentie`, tenue par la suite pgTAP. Les deux doivent dire la même chose ;
	// c'est pourquoi elles sont éprouvées séparément plutôt que supposées d'accord.
	it('rend une case COCHÉE quand AUCUNE ligne n’existe', () => {
		expect(appliquerPreferences([])).toEqual([{ type: 'mention', recevoirDansApplication: true }])
	})

	it('rend une case DÉCOCHÉE quand la ligne dit faux', () => {
		expect(appliquerPreferences([{ type: 'mention', in_app: false }])).toEqual([
			{ type: 'mention', recevoirDansApplication: false },
		])
	})

	// UN TYPE INCONNU NE PEUT VENIR QUE D'UNE BASE EN AVANCE SUR CETTE VERSION. Lui fabriquer une
	// case sans libellé afficherait un réglage que personne ne sait nommer.
	it('IGNORE un type que l’application ne connaît pas, au lieu de lui fabriquer une case', () => {
		const rendu = appliquerPreferences([
			{ type: 'mention', in_app: false },
			{ type: 'echeance', in_app: false },
		])
		expect(rendu).toHaveLength(1)
		expect(rendu[0]?.type).toBe('mention')
	})
})

describe('la lecture des préférences (§46.1)', () => {
	// ELLE NE FILTRE PAS PAR `profile_id`, et ce n'est pas un oubli : la politique l'exige déjà.
	// Un filtre client serait une seconde écriture de la règle, et une écriture PLUS FAIBLE — il
	// ne refuse rien.
	it('lit la table SANS filtrer par profil : c’est la politique qui le fait', async () => {
		const { client, appel } = clientLecture({ data: [], error: null, status: 200 })
		await lirePreferencesNotifications(client)

		expect(appel.table).toBe('notification_preferences')
		expect(appel.colonnes).toBe('type, in_app')
	})

	// SANS SESSION, LA LECTURE REND ZÉRO LIGNE, JAMAIS UNE ERREUR (§46.1, ligne *j*). L'écran rend
	// alors le défaut, ce qui est exact et sans conséquence : un anonyme ne reçoit rien.
	it('rend le DÉFAUT sur une réponse vide, jamais un état d’erreur', async () => {
		const { client } = clientLecture({ data: [], error: null, status: 200 })
		const etat = await lirePreferencesNotifications(client)

		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') throw new Error('état inattendu')
		expect(etat.donnees).toEqual([{ type: 'mention', recevoirDansApplication: true }])
	})

	it('rend un état d’ERREUR quand la requête échoue', async () => {
		const { client } = clientLecture({ error: { message: 'boom' }, status: 500 })
		const etat = await lirePreferencesNotifications(client)
		expect(etat.statut).toBe('erreur')
	})
})

describe('l’écriture d’une préférence (§46.3)', () => {
	// LE DESTINATAIRE N'EST PAS UN PARAMÈTRE, ET C'EST LA BASE QUI LE DÉCIDE. Ce test fige la
	// charge émise : le jour où quelqu'un ajouterait un `p_profile_id` « pour rendre la RPC
	// réutilisable », il rendrait possible d'écrire pour autrui, et ce test le verrait.
	it('appelle la RPC avec le TYPE et la VALEUR, et rien d’autre — aucun destinataire', async () => {
		const { client, appel } = clientRpc({
			data: { type: 'mention', in_app: false },
			error: null,
			status: 200,
		})
		await ecrirePreferenceNotification(client, 'mention', false)

		expect(appel.nom).toBe('definir_preference_notification')
		expect(appel.arguments).toEqual({ p_type: 'mention', p_in_app: false })
	})

	// ELLE REND L'ÉTAT RETENU PAR LA BASE, JAMAIS CELUI QUI A ÉTÉ DEMANDÉ (§5.45). Les deux
	// coïncident aujourd'hui — et c'est précisément pour cela qu'il faut le prouver : un module
	// qui renverrait la valeur demandée passerait tous les cas nominaux et afficherait, le jour
	// où la base trancherait autrement, un état qui n'existe pas.
	it('rend l’état que la BASE a retenu, même s’il diffère de celui demandé', async () => {
		const { client } = clientRpc({
			data: { type: 'mention', in_app: true },
			error: null,
			status: 200,
		})
		const issue = await ecrirePreferenceNotification(client, 'mention', false)

		expect(issue.statut).toBe('ecrite')
		if (issue.statut !== 'ecrite') throw new Error('issue inattendue')
		expect(issue.preference.recevoirDansApplication).toBe(true)
	})

	it('rend un REFUS nommé quand la base ne connaît pas le type', async () => {
		const { client } = clientRpc({
			error: { message: SYMBOLE_TYPE_INCONNU, code: 'P0001' },
			status: 400,
		})
		const issue = await ecrirePreferenceNotification(client, 'mention', false)

		expect(issue.statut).toBe('refus')
		if (issue.statut !== 'refus') throw new Error('issue inattendue')
		expect(issue.nature).toBe('type-inconnu')
		expect(issue.type).toBe('mention')
	})

	// UNE RÉPONSE SANS LIGNE NE PEUT PAS ARRIVER — la RPC rend `returning *` ou lève. Supposer la
	// ligne présente afficherait, en cas de surprise, une case dont l'état vient de nulle part.
	it('refuse une réponse SANS LIGNE plutôt que de deviner l’état', async () => {
		const { client } = clientRpc({ data: null, error: null, status: 200 })
		const issue = await ecrirePreferenceNotification(client, 'mention', true)

		expect(issue.statut).toBe('refus')
		if (issue.statut !== 'refus') throw new Error('issue inattendue')
		expect(issue.nature).toBe('unknown')
	})
})

describe('la classification des refus (§46.3)', () => {
	// LES TROIS SYMBOLES NE DEMANDENT PAS LE MÊME GESTE : mettre l'application à jour, se
	// reconnecter, ou signaler un défaut. Les confondre rendrait un message faux.
	it('distingue les trois refus nommés de la RPC', () => {
		expect(classerRefusPreference(400, 'P0001', SYMBOLE_TYPE_INCONNU).nature).toBe('type-inconnu')
		expect(classerRefusPreference(400, 'P0001', SYMBOLE_SANS_SESSION).nature).toBe('sans-session')
		expect(classerRefusPreference(400, 'P0001', SYMBOLE_VALEUR_ABSENTE).nature).toBe('valeur-absente')
	})

	// UN CODE INCONNU RESTE INCONNU. Ramener tout `P0001` à la cause la plus fréquente serait la
	// valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
	it('ne devine RIEN d’un `P0001` qu’il ne connaît pas', () => {
		expect(classerRefusPreference(400, 'P0001', 'symbole_futur').nature).toBe('unknown')
	})

	// C'EST LE REFUS DE L'ANONYME, ligne *k* du contrat : `401 / 42501`, un refus de PRIVILÈGE.
	it('classe `401` et `403` en refus d’accès', () => {
		expect(classerRefusPreference(401, '42501', 'permission denied').nature).toBe('forbidden')
		expect(classerRefusPreference(403, '42501', 'permission denied').nature).toBe('forbidden')
	})

	it('classe l’absence de statut en défaut de réseau', () => {
		expect(classerRefusPreference(undefined, undefined, 'fetch failed').nature).toBe('network')
	})
})
