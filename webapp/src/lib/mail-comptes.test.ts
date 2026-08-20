// @verifies CRM-088 (docs/BACKLOG.md) — configuration des comptes entrants IMAP
// @verifies docs/SPEC-mail-subsystem.md §21.3 (les colonnes demandées, et celle qui ne l'est
//           jamais), §21.4 (ce que le formulaire envoie), §21.5 (un mot de passe vide est OMIS),
//           §21.6 (les réponses mesurées), §21.7 (dictionnaire fermé des refus et repli nommé)
// @verifies docs/SPEC-permissions-rls.md §7, preuve de refus n° 6 (`secret_id` jamais demandée)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue : « le mot de
// passe vide est omis » et « `secret_id` n'est jamais demandée » sont deux exigences portées par
// l'appel lui-même, qu'aucune assertion sur le résultat n'attraperait.
//
// Les codes et messages employés ici sont ceux MESURÉS le 2026-08-20 sur la pile réelle et
// consignés au §21.6 : aucun n'est inventé pour la commodité du test.

import { describe, expect, it } from 'vitest'
import {
	argumentsEnregistrement,
	classerEnregistrement,
	compteDe,
	COLONNES_COMPTE_ENTRANT,
	enregistrerCompteEntrant,
	estEtatCompteConnu,
	estModeSecuriteConnu,
	lireComptesEntrants,
	saisieDepuisCompte,
	type CompteEntrant,
	type SaisieCompteEntrant,
} from './mail-comptes'
import type { ClientCrm } from './supabase'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'

const SAISIE: SaisieCompteEntrant = {
	idWorkspace: WORKSPACE,
	idProprietaire: CAMILLE,
	libelle: 'Boîte de Camille Aubert',
	hote: 'stalwart',
	port: '143',
	securite: 'none',
	identifiant: 'admin@p2enjoy.test',
	motDePasse: '',
}

const COMPTE: CompteEntrant = {
	id: 'aaaa0000-0000-4000-8000-000000000001',
	label: 'Boîte de Camille Aubert',
	owner_id: CAMILLE,
	imap_host: 'stalwart',
	imap_port: 143,
	imap_security: 'none',
	imap_username: 'admin@p2enjoy.test',
	status: 'pending',
	last_error: null,
	last_checked_at: null,
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
		rpc: (fonction: string, arguments_: Record<string, unknown>) => {
			appel.fonction = fonction
			appel.arguments = arguments_
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('lecture des comptes entrants — §21.3', () => {
	it('demande les dix colonnes utiles, triées par boîte', async () => {
		const { client, appel } = espionLecture({ data: [COMPTE], error: null, status: 200 })
		const etat = await lireComptesEntrants(client)

		expect(appel.table).toBe('mail_inbound_accounts')
		expect(appel.colonnes).toBe(COLONNES_COMPTE_ENTRANT)
		expect(appel.tri).toBe('label')
		expect(etat.statut).toBe('pret')
	})

	// PREUVE DE REFUS N° 6, côté client : la colonne révoquée n'est jamais demandée. Sans cette
	// assertion, l'ajouter par mégarde ferait échouer la lecture ENTIÈRE de l'écran en `403`, et
	// pour tout le monde — l'écran ne montrerait plus rien.
	it('ne demande JAMAIS `secret_id`, ni les trois paramètres d’ingestion', () => {
		expect(COLONNES_COMPTE_ENTRANT).not.toContain('secret_id')
		expect(COLONNES_COMPTE_ENTRANT).not.toContain('watch_folders')
		expect(COLONNES_COMPTE_ENTRANT).not.toContain('folder_style')
		expect(COLONNES_COMPTE_ENTRANT).not.toContain('backfill_months')
	})

	it('rend un état d’erreur classé, jamais une liste vide, quand la requête échoue', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		const etat = await lireComptesEntrants(client)

		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') return
		expect(etat.erreur.nature).toBe('unknown')
	})

	it('une lectrice sans boîte rend une liste VIDE, et ce n’est pas une erreur — mesuré §21.6', async () => {
		const { client } = espionLecture({ data: [], error: null, status: 200 })
		const etat = await lireComptesEntrants(client)

		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees).toHaveLength(0)
	})
})

describe('ce que le formulaire envoie — §21.4, §21.5', () => {
	it('OMET `p_password` quand le champ est vide : le secret enregistré est conservé', () => {
		const arguments_ = argumentsEnregistrement(SAISIE) as Record<string, unknown>

		expect(Object.hasOwn(arguments_, 'p_password')).toBe(false)
		expect(arguments_['p_label']).toBe('Boîte de Camille Aubert')
		expect(arguments_['p_imap_port']).toBe(143)
	})

	it('envoie `p_password` dès que le champ porte une valeur', () => {
		const arguments_ = argumentsEnregistrement({
			...SAISIE,
			motDePasse: 'nouveau',
		}) as Record<string, unknown>

		expect(arguments_['p_password']).toBe('nouveau')
	})

	it('OMET `p_owner_id` pour la boîte système, qui vaut alors son défaut nul', () => {
		const arguments_ = argumentsEnregistrement({
			...SAISIE,
			idProprietaire: null,
		}) as Record<string, unknown>

		expect(Object.hasOwn(arguments_, 'p_owner_id')).toBe(false)
	})

	// Aucune garde de saisie ne double une contrainte de la base (§21.4) : un port vide PART, et
	// c'est `23502` qui le refuse. Une validation locale masquerait la disparition de la contrainte.
	it('n’écarte pas une saisie de port vide : elle part, et la base tranche', () => {
		const arguments_ = argumentsEnregistrement({ ...SAISIE, port: '' }) as Record<string, unknown>

		expect(Number.isNaN(arguments_['p_imap_port'])).toBe(true)
		expect(JSON.parse(JSON.stringify(arguments_))['p_imap_port']).toBeNull()
	})

	it('n’envoie JAMAIS les trois paramètres d’ingestion, que la fonction laisse alors en place', () => {
		const arguments_ = argumentsEnregistrement(SAISIE) as Record<string, unknown>

		expect(Object.hasOwn(arguments_, 'p_watch_folders')).toBe(false)
		expect(Object.hasOwn(arguments_, 'p_folder_style')).toBe(false)
		expect(Object.hasOwn(arguments_, 'p_backfill_months')).toBe(false)
	})
})

describe('dictionnaire fermé des refus — §21.7', () => {
	it.each([
		['forbidden', 403, 'refus'],
		['not_authenticated', 400, 'session-expiree'],
		['password_required', 400, 'mot-de-passe-requis'],
		['owner_not_member', 400, 'proprietaire-non-membre'],
	])('classe le refus applicatif « %s »', (message, statut, attendu) => {
		expect(classerEnregistrement(statut, message)).toBe(attendu)
	})

	// Les messages ci-dessous sont ceux de PostgreSQL, RECOPIÉS de la mesure du §21.6 : c'est le
	// nom de la contrainte qui est l'identifiant stable, jamais la phrase qui l'entoure.
	it.each([
		[
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_label_borne"',
			'libelle-invalide',
		],
		[
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_host_borne"',
			'hote-invalide',
		],
		[
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_port_borne"',
			'port-invalide',
		],
		[
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_securite"',
			'securite-invalide',
		],
		[
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_username_borne"',
			'identifiant-invalide',
		],
		['null value in column "imap_port" of relation "mail_inbound_accounts" violates not-null constraint', 'port-invalide'],
		['invalid input syntax for type integer: "abc"', 'port-invalide'],
	])('classe le refus de la base porté par « %s »', (message, attendu) => {
		expect(classerEnregistrement(400, message)).toBe(attendu)
	})

	it('classe l’appel sans session en session expirée — mesuré `401`', () => {
		expect(
			classerEnregistrement(401, 'permission denied for function upsert_mail_inbound_account'),
		).toBe('session-expiree')
	})

	it('a un REPLI NOMMÉ : une cause inconnue ne devient jamais une cause précise', () => {
		expect(classerEnregistrement(400, 'quelque chose que personne n’a prévu')).toBe('inconnu')
	})

	it('distingue une panne de transport d’un refus', () => {
		expect(classerEnregistrement(undefined, null)).toBe('reseau')
		expect(classerEnregistrement(0, 'peu importe')).toBe('reseau')
	})
})

describe('enregistrement — §21.4', () => {
	it('appelle la seule fonction d’écriture et rend l’identifiant du COMPTE', async () => {
		const { client, appel } = espionRpc({ data: COMPTE.id, error: null, status: 200 })
		const resultat = await enregistrerCompteEntrant(client, SAISIE)

		expect(appel.fonction).toBe('upsert_mail_inbound_account')
		expect(resultat.issue).toBe('enregistre')
		if (resultat.issue !== 'enregistre') return
		expect(resultat.idCompte).toBe(COMPTE.id)
	})

	// Un succès sans identifiant exploitable n'est pas un succès : l'écran n'annonce jamais un
	// enregistrement que le serveur n'a pas confirmé (§21.4).
	it('retombe sur `inconnu` si un `200` ne porte aucun identifiant', async () => {
		const { client } = espionRpc({ data: null, error: null, status: 200 })

		expect((await enregistrerCompteEntrant(client, SAISIE)).issue).toBe('inconnu')
	})

	it('rend l’issue « refus » sur le `403 forbidden` mesuré', async () => {
		const { client } = espionRpc({ data: null, error: { message: 'forbidden' }, status: 403 })

		expect((await enregistrerCompteEntrant(client, SAISIE)).issue).toBe('refus')
	})
})

describe('préremplissage — §21.4, §21.5', () => {
	it('préremplit depuis la boîte existante, mot de passe TOUJOURS vide', () => {
		const saisie = saisieDepuisCompte(WORKSPACE, CAMILLE, COMPTE)

		expect(saisie.libelle).toBe(COMPTE.label)
		expect(saisie.port).toBe('143')
		expect(saisie.identifiant).toBe(COMPTE.imap_username)
		expect(saisie.motDePasse).toBe('')
	})

	it('rend une saisie VIDE pour une boîte qui n’existe pas encore', () => {
		const saisie = saisieDepuisCompte(WORKSPACE, null, undefined)

		expect(saisie.libelle).toBe('')
		expect(saisie.hote).toBe('')
		expect(saisie.port).toBe('')
		expect(saisie.idProprietaire).toBeNull()
	})

	it('retrouve la boîte système par son propriétaire nul', () => {
		const systeme: CompteEntrant = { ...COMPTE, id: 'autre', owner_id: null }

		expect(compteDe([COMPTE, systeme], null)?.id).toBe('autre')
		expect(compteDe([COMPTE, systeme], CAMILLE)?.id).toBe(COMPTE.id)
		expect(compteDe([COMPTE], null)).toBeUndefined()
	})
})

describe('vocabulaires fermés de la base', () => {
	it('reconnaît les quatre états, et rejette un cinquième', () => {
		expect(estEtatCompteConnu('pending')).toBe(true)
		expect(estEtatCompteConnu('ok')).toBe(true)
		expect(estEtatCompteConnu('error')).toBe(true)
		expect(estEtatCompteConnu('disabled')).toBe(true)
		expect(estEtatCompteConnu('inventé')).toBe(false)
	})

	it('reconnaît les trois modes de sécurité, et rejette un quatrième', () => {
		expect(estModeSecuriteConnu('ssl')).toBe(true)
		expect(estModeSecuriteConnu('starttls')).toBe(true)
		expect(estModeSecuriteConnu('none')).toBe(true)
		expect(estModeSecuriteConnu('bogus')).toBe(false)
	})
})
