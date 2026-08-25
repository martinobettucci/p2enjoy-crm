// @verifies CRM-089 (docs/BACKLOG.md) — configuration des identités sortantes SMTP
// @verifies docs/SPEC-mail-subsystem.md §22.3 (les colonnes demandées, et les trois qui ne le sont
//           jamais), §22.4 (la clé est un TRIPLET), §22.5 (ce que le formulaire envoie, et les
//           deux règles opposées), §22.6 (un mot de passe vide est OMIS), §22.7 (les réponses
//           mesurées), §22.8 (dictionnaire fermé des refus et repli nommé)
// @verifies docs/SPEC-permissions-rls.md §7, preuve de refus n° 6 (`secret_id` jamais demandée)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue : « le mot de
// passe vide est omis », « le nom d'expéditeur vide est ENVOYÉ » et « `secret_id` n'est jamais
// demandée » sont trois exigences portées par l'appel lui-même, qu'aucune assertion sur le
// résultat n'attraperait.
//
// Les codes et messages employés ici sont ceux MESURÉS le 2026-08-21 sur la pile réelle et
// consignés au §22.7 : aucun n'est inventé pour la commodité du test.

import { describe, expect, it } from 'vitest'
import {
	argumentsEnregistrementIdentite,
	classerEnregistrementIdentite,
	COLONNES_IDENTITE_SORTANTE,
	enregistrerIdentiteSortante,
	estEtatIdentiteConnu,
	estModeSecuriteSortanteConnu,
	expediteurLisible,
	identiteDe,
	lireIdentitesSortantes,
	saisieDepuisIdentite,
	signatureRenseignee,
	type IdentiteSortante,
	type SaisieIdentiteSortante,
} from './mail-identites'
import type { ClientCrm } from './supabase'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

const SAISIE: SaisieIdentiteSortante = {
	idWorkspace: WORKSPACE,
	idProprietaire: DRISS,
	libelle: 'Envoi de Driss Lemoine',
	hote: 'stalwart',
	port: '587',
	securite: 'none',
	identifiant: 'bizdev@p2enjoy.test',
	adresseExpedition: 'contact@p2enjoy.test',
	nomExpediteur: '',
	signature: '',
	parDefaut: true,
	motDePasse: '',
}

const IDENTITE: IdentiteSortante = {
	id: 'bbbb0000-0000-4000-8000-000000000001',
	label: 'Envoi de Driss Lemoine',
	owner_id: DRISS,
	smtp_host: 'stalwart',
	smtp_port: 587,
	smtp_security: 'none',
	smtp_username: 'bizdev@p2enjoy.test',
	from_address: 'contact@p2enjoy.test',
	from_name: null,
	signature_text: null,
	is_default: true,
	status: 'pending',
	last_error: null,
	last_checked_at: null,
}

const IDENTITE_SERVICE: IdentiteSortante = {
	...IDENTITE,
	id: 'bbbb0000-0000-4000-8000-000000000002',
	label: 'Identité de service',
	owner_id: null,
	from_address: 'systeme@crm.p2enjoy.test',
	from_name: 'Service CRM',
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

describe('lecture des identités sortantes — §22.3', () => {
	it('demande les treize colonnes utiles, triées par adresse d’expédition', async () => {
		const { client, appel } = espionLecture({ data: [IDENTITE], error: null, status: 200 })
		const etat = await lireIdentitesSortantes(client)

		expect(appel.table).toBe('mail_outbound_identities')
		expect(appel.colonnes).toBe(COLONNES_IDENTITE_SORTANTE)
		// LE TRI SUIT LA TÊTE DE LIGNE, et non le libellé comme au §5.34 : deux identités d'une même
		// personne peuvent porter le même libellé, jamais la même adresse.
		expect(appel.tri).toBe('from_address')
		expect(etat.statut).toBe('pret')
	})

	// PREUVE DE REFUS N° 6, côté client, et la mesure est plus dure que pour les comptes entrants :
	// citer `secret_id` rend `403` même à l'ADMINISTRATRICE (§22.7). Sans cette assertion,
	// l'ajouter par mégarde ferait échouer la lecture ENTIÈRE de l'écran, pour tout le monde.
	//
	// ASSERTION RÉVISÉE PAR `CRM-063` TRANCHE 3, et le motif est un CHANGEMENT DE RÈGLE, jamais un
	// contournement (`docs/CloudWorker.md` §3.1). Elle exigeait aussi l'absence de la signature,
	// parce que le §22.1 refusait le champ — la colonne étant alors INEFFAÇABLE. Le §10.4 a réparé
	// l'effacement, le §10.6 ouvre le champ, et la RÉCIPROQUE de la discipline s'applique : l'écran
	// ne peut pas proposer de modifier une signature sans montrer celle qui est enregistrée. La
	// colonne est donc désormais LUE, et l'assertion qui l'interdisait est remplacée par celle qui
	// l'exige, plus bas.
	it('ne demande JAMAIS `secret_id`, ni le quota', () => {
		expect(COLONNES_IDENTITE_SORTANTE).not.toContain('secret_id')
		expect(COLONNES_IDENTITE_SORTANTE).not.toContain('daily_quota')
	})

	it('demande bien les colonnes que l’écran affiche', () => {
		for (const colonne of [
			'from_address',
			'from_name',
			// `CRM-063` §10.6 — la signature est LUE : le champ la prérempli, et la liste allume sa
			// pilule d'après elle.
			'signature_text',
			'is_default',
			'smtp_host',
			'smtp_port',
			'smtp_security',
			'smtp_username',
			'status',
		]) {
			expect(COLONNES_IDENTITE_SORTANTE).toContain(colonne)
		}
	})

	it('rend un état d’erreur classé, jamais une liste vide, quand la requête échoue', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'boom' }, status: 500 })
		const etat = await lireIdentitesSortantes(client)
		expect(etat.statut).toBe('erreur')
	})

	it('rend un état d’erreur quand le transport relance plutôt que de rendre', async () => {
		const client = {
			from: () => {
				throw new Error('transport coupé')
			},
		} as unknown as ClientCrm
		const etat = await lireIdentitesSortantes(client)
		expect(etat.statut).toBe('erreur')
	})
})

describe('les arguments envoyés — §22.5, §22.6', () => {
	// LA RÈGLE DU MOT DE PASSE : omis quand il est vide. Mesuré §22.7 — un appel sans ce paramètre
	// laisse `secret_id` inchangé, tandis qu'une chaîne vide serait ignorée par `btrim(…) <> ''`,
	// donc au mieux inutile et au pire trompeuse à la lecture.
	it('OMET `p_password` quand le champ est vide', () => {
		const arguments_ = argumentsEnregistrementIdentite(SAISIE) as Record<string, unknown>
		expect('p_password' in arguments_).toBe(false)
	})

	it('envoie `p_password` dès que le champ porte une valeur', () => {
		const arguments_ = argumentsEnregistrementIdentite({
			...SAISIE,
			motDePasse: 'MotDePasseDev2026',
		}) as Record<string, unknown>
		expect(arguments_['p_password']).toBe('MotDePasseDev2026')
	})

	// LA RÈGLE OPPOSÉE, ET C'EST TOUT L'INTÉRÊT DE CETTE ASSERTION : `p_from_name` est sous
	// `coalesce(p_from_name, i.from_name)`. L'omettre rendrait un nom d'expéditeur INEFFAÇABLE, ce
	// qu'aucune assertion sur le résultat ne verrait. Mesuré dans les deux sens §22.7.
	it('envoie TOUJOURS `p_from_name`, y compris vide — sans quoi un nom serait ineffaçable', () => {
		const vide = argumentsEnregistrementIdentite(SAISIE) as Record<string, unknown>
		expect('p_from_name' in vide).toBe(true)
		expect(vide['p_from_name']).toBe('')

		const rempli = argumentsEnregistrementIdentite({
			...SAISIE,
			nomExpediteur: 'Driss Lemoine',
		}) as Record<string, unknown>
		expect(rempli['p_from_name']).toBe('Driss Lemoine')
	})

	// Son `coalesce` le rend ineffaçable : un champ d'écran qui ne sait pas revenir en arrière est
	// un piège, et l'écran ne l'envoie donc jamais (§22.1).
	//
	// ASSERTION RÉVISÉE PAR `CRM-063` TRANCHE 3 : elle couvrait aussi la signature, qui a QUITTÉ
	// cette famille. La migration 58 a remplacé son `coalesce` par trois états — omis conserve,
	// vide EFFACE, rempli écrit (§10.4) —, si bien que le champ sait revenir en arrière. Le quota,
	// lui, n'a pas bougé.
	it('n’envoie JAMAIS `p_daily_quota`', () => {
		const arguments_ = argumentsEnregistrementIdentite({
			...SAISIE,
			motDePasse: 'x',
		}) as Record<string, unknown>
		expect('p_daily_quota' in arguments_).toBe(false)
	})

	// LA CONTRE-ÉPREUVE DE LA RÈGLE PRÉCÉDENTE, et elle est indispensable : « toujours envoyé, y
	// compris vide » ne se prouve que sur le cas VIDE. Envoyé vide, il EFFACE (§10.4) ; omis, il
	// laisserait la signature en place et le champ vidé n'aurait aucun effet — le piège exact que
	// le §22.1 dénonçait pour le quota.
	it('envoie TOUJOURS `p_signature_text`, y compris vide, comme `p_from_name`', () => {
		const vide = argumentsEnregistrementIdentite({
			...SAISIE,
			signature: '',
		}) as Record<string, unknown>
		expect('p_signature_text' in vide).toBe(true)
		expect(vide['p_signature_text']).toBe('')

		const remplie = argumentsEnregistrementIdentite({
			...SAISIE,
			signature: 'Driss Lemoine\nP2Enjoy',
		}) as Record<string, unknown>
		expect(remplie['p_signature_text']).toBe('Driss Lemoine\nP2Enjoy')
	})

	// LA PILULE DIT LA MÊME CHOSE QUE LA GARDE, et c'est le seul montage juste : une signature
	// entièrement blanche rend le corps INCHANGÉ (`app.mail_corps_signe`, §10.3). Une pilule allumée
	// sur `!== null` promettrait alors une signature que le destinataire ne verra jamais.
	it('n’allume la pilule de signature que sur une signature RÉELLE', () => {
		expect(signatureRenseignee({ ...IDENTITE, signature_text: null })).toBe(false)
		expect(signatureRenseignee({ ...IDENTITE, signature_text: '' })).toBe(false)
		expect(signatureRenseignee({ ...IDENTITE, signature_text: '  \n ' })).toBe(false)
		expect(signatureRenseignee({ ...IDENTITE, signature_text: 'Driss Lemoine' })).toBe(true)
	})

	it('OMET `p_owner_id` pour l’identité de service, et l’envoie sinon', () => {
		const service = argumentsEnregistrementIdentite({
			...SAISIE,
			idProprietaire: null,
		}) as Record<string, unknown>
		expect('p_owner_id' in service).toBe(false)

		const personnelle = argumentsEnregistrementIdentite(SAISIE) as Record<string, unknown>
		expect(personnelle['p_owner_id']).toBe(DRISS)
	})

	it('envoie `p_is_default` tel que la case le porte', () => {
		const coche = argumentsEnregistrementIdentite(SAISIE) as Record<string, unknown>
		expect(coche['p_is_default']).toBe(true)

		const decoche = argumentsEnregistrementIdentite({
			...SAISIE,
			parDefaut: false,
		}) as Record<string, unknown>
		expect(decoche['p_is_default']).toBe(false)
	})

	// AUCUNE GARDE DE SAISIE NE DOUBLE UNE CONTRAINTE DE LA BASE (§5.3 ter) : une saisie non
	// numérique part telle quelle, `NaN` étant sérialisé `null`, et la base refuse en `23502`.
	it('laisse partir une saisie de port non numérique, pour que la base tranche', () => {
		const arguments_ = argumentsEnregistrementIdentite({
			...SAISIE,
			port: 'abc',
		}) as Record<string, unknown>
		expect(Number.isNaN(arguments_['p_smtp_port'])).toBe(true)
	})

	it('laisse partir une adresse d’expédition non conforme, pour que la base tranche', () => {
		const arguments_ = argumentsEnregistrementIdentite({
			...SAISIE,
			adresseExpedition: 'pas-une-adresse',
		}) as Record<string, unknown>
		expect(arguments_['p_from_address']).toBe('pas-une-adresse')
	})
})

describe('classement des refus — dictionnaire fermé du §22.8', () => {
	// Chaque ligne ci-dessous est une réponse MESURÉE le 2026-08-21 (§22.7).
	const MESURES: ReadonlyArray<readonly [number, string | null, string]> = [
		[200, null, 'enregistre'],
		[403, 'forbidden', 'refus'],
		[401, 'permission denied for function upsert_mail_outbound_identity', 'session-expiree'],
		[403, 'not_authenticated', 'session-expiree'],
		[400, 'password_required', 'mot-de-passe-requis'],
		[400, 'owner_not_member', 'proprietaire-non-membre'],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_label_borne"',
			'libelle-invalide',
		],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_host_borne"',
			'hote-invalide',
		],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_port_borne"',
			'port-invalide',
		],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_securite"',
			'securite-invalide',
		],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_username_borne"',
			'identifiant-invalide',
		],
		[
			400,
			'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_from_address"',
			'adresse-invalide',
		],
		[
			400,
			'null value in column "smtp_port" of relation "mail_outbound_identities" violates not-null constraint',
			'port-invalide',
		],
		[400, 'invalid input syntax for type integer: "abc"', 'port-invalide'],
	]

	for (const [statut, message, issue] of MESURES) {
		it(`classe « ${message ?? 'aucun message'} » en « ${issue} »`, () => {
			expect(classerEnregistrementIdentite(statut, message)).toBe(issue)
		})
	}

	// LE REPLI NOMMÉ : nommer « je ne sais pas » est une réponse ; recopier le corps du serveur
	// publierait `secret_id` (INC-193).
	it('retombe sur le repli nommé plutôt que d’inventer une cause', () => {
		expect(classerEnregistrementIdentite(400, 'quelque chose de tout à fait inattendu')).toBe(
			'inconnu',
		)
	})

	it('classe une absence de réponse en « reseau », jamais en refus', () => {
		expect(classerEnregistrementIdentite(undefined, null)).toBe('reseau')
		expect(classerEnregistrementIdentite(0, null)).toBe('reseau')
	})

	// LES NOMS DE CONTRAINTE SONT CEUX DE LA TABLE SORTANTE : ceux de la table entrante ne doivent
	// RIEN classer ici, sans quoi une confusion entre les deux modules passerait inaperçue — et le
	// message afficherait 200 caractères là où la base en accepte 120.
	it('ne classe PAS les contraintes des comptes entrants, qui sont un autre jeu', () => {
		expect(
			classerEnregistrementIdentite(400, 'violates check constraint "mail_inbound_accounts_label_borne"'),
		).toBe('inconnu')
		expect(
			classerEnregistrementIdentite(400, 'violates check constraint "mail_inbound_accounts_securite"'),
		).toBe('inconnu')
	})
})

describe('enregistrement — §22.7', () => {
	it('appelle la fonction d’écriture et rend l’identifiant de l’identité', async () => {
		const { client, appel } = espionRpc({
			data: 'bbbb0000-0000-4000-8000-000000000009',
			error: null,
			status: 200,
		})
		const resultat = await enregistrerIdentiteSortante(client, SAISIE)

		expect(appel.fonction).toBe('upsert_mail_outbound_identity')
		expect(resultat).toEqual({
			issue: 'enregistre',
			idIdentite: 'bbbb0000-0000-4000-8000-000000000009',
		})
	})

	// L'écran n'annonce jamais un enregistrement que le serveur n'a pas confirmé.
	it('retombe sur « inconnu » quand un succès ne porte aucun identifiant exploitable', async () => {
		const { client } = espionRpc({ data: null, error: null, status: 200 })
		expect(await enregistrerIdentiteSortante(client, SAISIE)).toEqual({ issue: 'inconnu' })
	})

	it('rend « refus » sur le 403 mesuré, sans jamais rendre le message du serveur', async () => {
		const { client } = espionRpc({ data: null, error: { message: 'forbidden' }, status: 403 })
		const resultat = await enregistrerIdentiteSortante(client, SAISIE)
		expect(resultat).toEqual({ issue: 'refus' })
		expect(JSON.stringify(resultat)).not.toContain('forbidden')
	})

	it('rend « reseau » quand le transport relance plutôt que de rendre', async () => {
		const client = {
			rpc: () => {
				throw new Error('transport coupé')
			},
		} as unknown as ClientCrm
		expect(await enregistrerIdentiteSortante(client, SAISIE)).toEqual({ issue: 'reseau' })
	})
})

describe('préremplissage du formulaire — §22.5', () => {
	it('reprend les valeurs courantes, et laisse le mot de passe VIDE', () => {
		const saisie = saisieDepuisIdentite(WORKSPACE, DRISS, IDENTITE)
		expect(saisie.libelle).toBe('Envoi de Driss Lemoine')
		expect(saisie.adresseExpedition).toBe('contact@p2enjoy.test')
		expect(saisie.port).toBe('587')
		expect(saisie.parDefaut).toBe(true)
		expect(saisie.motDePasse).toBe('')
	})

	it('rend une chaîne vide pour un nom d’expéditeur absent, jamais « null »', () => {
		expect(saisieDepuisIdentite(WORKSPACE, DRISS, IDENTITE).nomExpediteur).toBe('')
		expect(saisieDepuisIdentite(WORKSPACE, null, IDENTITE_SERVICE).nomExpediteur).toBe(
			'Service CRM',
		)
	})

	// LA CASE EST COCHÉE SUR UNE DÉCLARATION, parce que c'est le défaut de la fonction
	// (`coalesce(p_is_default, true)`) : montrer autre chose ferait mentir le formulaire.
	it('vide les champs sur une déclaration, mais COCHE « par défaut »', () => {
		const saisie = saisieDepuisIdentite(WORKSPACE, DRISS, undefined)
		expect(saisie.libelle).toBe('')
		expect(saisie.adresseExpedition).toBe('')
		expect(saisie.port).toBe('')
		expect(saisie.motDePasse).toBe('')
		expect(saisie.parDefaut).toBe(true)
	})
})

describe('recherche d’une identité — §22.4', () => {
	// ELLE SE CHERCHE PAR SON IDENTIFIANT, et non par son propriétaire comme au §21 : une personne
	// peut porter PLUSIEURS identités, si bien qu'`owner_id` ne désigne plus une ligne unique.
	it('retrouve une identité par son identifiant, deux identités partageant un propriétaire', () => {
		const seconde: IdentiteSortante = {
			...IDENTITE,
			id: 'bbbb0000-0000-4000-8000-000000000003',
			from_address: 'devis@p2enjoy.test',
			is_default: false,
		}
		const liste = [IDENTITE, seconde]
		expect(identiteDe(liste, seconde.id)?.from_address).toBe('devis@p2enjoy.test')
		expect(identiteDe(liste, IDENTITE.id)?.from_address).toBe('contact@p2enjoy.test')
	})

	it('rend `undefined` sur une valeur de déclaration, ce qui vaut « formulaire vide »', () => {
		expect(identiteDe([IDENTITE], 'nouvelle-personnelle')).toBeUndefined()
		expect(identiteDe([IDENTITE], 'nouvelle-service')).toBeUndefined()
	})
})

describe('l’expéditeur lisible — §5.35', () => {
	it('rend « Nom <adresse> » quand le nom existe', () => {
		expect(expediteurLisible(IDENTITE_SERVICE)).toBe('Service CRM <systeme@crm.p2enjoy.test>')
	})

	// La règle de la cellule vide du §5.9 : ni tiret, ni valeur inventée, ni chevrons orphelins.
	it('rend l’adresse SEULE quand le nom est absent ou vide', () => {
		expect(expediteurLisible(IDENTITE)).toBe('contact@p2enjoy.test')
		expect(expediteurLisible({ ...IDENTITE, from_name: '   ' })).toBe('contact@p2enjoy.test')
	})
})

describe('les vocabulaires fermés de la table', () => {
	it('reconnaît les quatre états de la contrainte, et rien d’autre', () => {
		for (const etat of ['pending', 'ok', 'error', 'disabled']) {
			expect(estEtatIdentiteConnu(etat)).toBe(true)
		}
		// Un cinquième état serait un défaut de la contrainte, pas un texte à deviner : la pilule
		// est alors absente, jamais remplie du code brut (§5.35).
		expect(estEtatIdentiteConnu('quarantined')).toBe(false)
	})

	it('reconnaît les trois modes de sécurité, et rien d’autre', () => {
		for (const mode of ['ssl', 'starttls', 'none']) {
			expect(estModeSecuriteSortanteConnu(mode)).toBe(true)
		}
		expect(estModeSecuriteSortanteConnu('bogus')).toBe(false)
	})
})
