// @spec CRM-088 (docs/BACKLOG.md) — configuration des comptes entrants IMAP
// @spec docs/SPEC-mail-subsystem.md §21.3 (ce que l'écran lit), §21.4 (les champs du formulaire),
//       §21.5 (un mot de passe vide est OMIS), §21.6 (le contrat mesuré), §21.7 (dictionnaire
//       fermé des refus, et son repli nommé)
// @spec docs/DESIGN_SYSTEM.md §5.34 (la surface) ; docs/SPEC-permissions-rls.md §7 (refus n° 6)
// @spec docs/INCONSISTENCY_REPORT.md INC-193 (le corps d'un refus divulgue `secret_id`)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE, et il n'ajoute aucune fonction : il lit
// `mail_inbound_accounts` sous la RLS posée par `CRM-052` (migration 0022) et écrit par
// `public.upsert_mail_inbound_account`, seul chemin d'écriture de cette table (§13.3).
//
// IL NE REND JAMAIS LE MESSAGE DU SERVEUR. Un refus est **classé** en une issue du dictionnaire
// fermé ci-dessous, que l'écran traduit ; le corps d'erreur de PostgREST n'atteint donc aucune
// surface. Ce n'est pas une précaution de style : le champ `details` d'un refus de contrainte
// contient la ligne fautive ENTIÈRE, `secret_id` compris — mesuré, INC-193.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit — §21.3
// ---------------------------------------------------------------------------------------------

/** Un compte entrant tel que l'écran de configuration a besoin de le connaître — §21.3. */
export type CompteEntrant = Pick<
	Database['public']['Tables']['mail_inbound_accounts']['Row'],
	| 'id'
	| 'label'
	| 'owner_id'
	| 'imap_host'
	| 'imap_port'
	| 'imap_security'
	| 'imap_username'
	| 'status'
	| 'last_error'
	| 'last_checked_at'
>

/**
 * Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise.
 *
 * `secret_id` en est ABSENTE, et ce n'est pas un oubli : la demander rend `403 / 42501` pour tout
 * appelant `authenticated` — preuve de refus n° 6, §13.4 —, si bien qu'une requête qui la citerait
 * ferait échouer la lecture entière de l'écran. Les trois paramètres d'ingestion en sont absents
 * aussi : l'écran ne les affiche ni ne les écrit (§21.1).
 */
const COLONNES_IDENTITE = 'id, label, owner_id' as const
const COLONNES_CONNEXION = 'imap_host, imap_port, imap_security, imap_username' as const
const COLONNES_ETAT = 'status, last_error, last_checked_at' as const

// LA COMPOSITION EST UN GABARIT `as const`, ET NON UNE CONCATÉNATION : `supabase-js` type la
// réponse à partir du **littéral** passé à `select`, et un `'a' + 'b'` élargit le type à `string`,
// ce qui ferait retomber la ligne rendue sur `GenericStringError`. Le gabarit conserve le type
// littéral, donc la vérification des colonnes par le compilateur — sans aucune conversion de type.
export const COLONNES_COMPTE_ENTRANT =
	`${COLONNES_IDENTITE}, ${COLONNES_CONNEXION}, ${COLONNES_ETAT}` as const

/**
 * Les comptes entrants visibles par l'appelant, triés par boîte.
 *
 * La RLS de `0022` fait tout le tri (§13.4) : administratrice — les trois comptes du workspace ;
 * membre ordinaire — le sien s'il en a un ; membre sans boîte — **zéro ligne**, `200`, et ce n'est
 * pas un refus (mesuré §21.6).
 */
export async function lireComptesEntrants(
	client: ClientCrm,
): Promise<EtatAsync<readonly CompteEntrant[]>> {
	try {
		const reponse = await client
			.from('mail_inbound_accounts')
			.select(COLONNES_COMPTE_ENTRANT)
			.order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Le vocabulaire fermé des états d'une boîte — `mail_inbound_accounts_statut` (migration 0022)
// ---------------------------------------------------------------------------------------------

/** Les quatre valeurs que la contrainte `mail_inbound_accounts_statut` admet (§13.2). */
export const ETATS_COMPTE_ENTRANT = ['pending', 'ok', 'error', 'disabled'] as const

export type EtatCompteEntrant = (typeof ETATS_COMPTE_ENTRANT)[number]

/**
 * Un cinquième état serait un défaut de la contrainte, pas un texte à deviner côté client.
 *
 * La pilule est alors **absente** plutôt que remplie du code brut — la règle du §5.14 pour un code
 * d'incident inconnu, reprise sans changement (`docs/DESIGN_SYSTEM.md` §5.34).
 */
export function estEtatCompteConnu(valeur: string): valeur is EtatCompteEntrant {
	return (ETATS_COMPTE_ENTRANT as readonly string[]).includes(valeur)
}

/** Les trois modes de la contrainte `mail_inbound_accounts_securite` (§21.4). */
export const MODES_SECURITE = ['ssl', 'starttls', 'none'] as const

export type ModeSecurite = (typeof MODES_SECURITE)[number]

export function estModeSecuriteConnu(valeur: string): valeur is ModeSecurite {
	return (MODES_SECURITE as readonly string[]).includes(valeur)
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran écrit — §21.4, §21.5
// ---------------------------------------------------------------------------------------------

/**
 * La saisie du formulaire, telle que le composant la porte.
 *
 * `port` est une CHAÎNE et non un nombre : c'est ce qu'un `input` rend, et la convertir dans le
 * composant y ferait naître une garde de saisie que le §5.3 ter interdit. La conversion vit ici,
 * et une saisie non entière part telle quelle vers la base, qui tranche (§21.4).
 */
export type SaisieCompteEntrant = {
	readonly idWorkspace: string
	/** `null` désigne la boîte système du workspace ; sinon, la boîte personnelle de cet identifiant. */
	readonly idProprietaire: string | null
	readonly libelle: string
	readonly hote: string
	readonly port: string
	readonly securite: string
	readonly identifiant: string
	/** Vide = le mot de passe enregistré est CONSERVÉ, et le paramètre n'est pas envoyé (§21.5). */
	readonly motDePasse: string
}

/**
 * Les issues de l'enregistrement — dictionnaire fermé du §21.7.
 *
 * Chacune correspond à une réponse RÉELLEMENT mesurée le 2026-08-20 (§21.6), jamais à une
 * hypothèse. `inconnu` est le **repli nommé** du §13.7 transposé : nommer « je ne sais pas » est
 * une réponse, la déguiser en une cause précise n'en est pas une.
 */
export type IssueEnregistrement =
	/** `200` : la fonction rend l'identifiant du compte écrit. */
	| 'enregistre'
	/** `403`, `forbidden` : la boîte visée n'appartient pas à l'appelant, et il n'est pas admin. */
	| 'refus'
	/** `401`, ou `not_authenticated` : la session n'existe plus. */
	| 'session-expiree'
	/** `23514`, `password_required` : un compte NEUF sans mot de passe est refusé. */
	| 'mot-de-passe-requis'
	/** `23514`, contrainte `mail_inbound_accounts_label_borne`. */
	| 'libelle-invalide'
	/** `23514`, contrainte `mail_inbound_accounts_host_borne`. */
	| 'hote-invalide'
	/** `23514` sur la borne du port, `23502` sur son absence, `22P02` sur une saisie non entière. */
	| 'port-invalide'
	/** `23514`, contrainte `mail_inbound_accounts_securite`. */
	| 'securite-invalide'
	/** `23514`, contrainte `mail_inbound_accounts_username_borne`. */
	| 'identifiant-invalide'
	/** `23514`, `owner_not_member` : le propriétaire n'est pas membre du workspace. */
	| 'proprietaire-non-membre'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir, et ne recopie pas le serveur. */
	| 'inconnu'

/**
 * Classe une réponse d'`upsert_mail_inbound_account` en une issue du dictionnaire fermé.
 *
 * ON CLASSE SUR DES IDENTIFIANTS STABLES, JAMAIS SUR DE LA PROSE. Deux familles cohabitent, et
 * elles ont la même nature contractuelle :
 *
 * - les refus levés par la fonction elle-même — `forbidden`, `not_authenticated`,
 *   `password_required`, `owner_not_member` — arrivent **tels quels** dans `message`, comme les
 *   quatre refus de `snooze_card` (`sommeil-card.ts`) ;
 * - les refus levés par la BASE portent le **nom de la contrainte** dans le message de PostgreSQL.
 *   Ce nom est un identifiant du schéma, versionné par la migration `0022` : il ne dépend ni de la
 *   locale ni de la version du serveur, contrairement à la phrase qui l'entoure.
 *
 * Le message n'est ni rendu, ni journalisé : il entre ici et il en ressort une issue.
 */
export function classerEnregistrement(
	statutHttp: number | undefined,
	message: string | null,
): IssueEnregistrement {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message === null) {
		return statutHttp >= 200 && statutHttp < 300 ? 'enregistre' : 'inconnu'
	}
	if (message === 'forbidden') return 'refus'
	if (message === 'not_authenticated') return 'session-expiree'
	if (message === 'password_required') return 'mot-de-passe-requis'
	if (message === 'owner_not_member') return 'proprietaire-non-membre'
	if (message.includes('mail_inbound_accounts_label_borne')) return 'libelle-invalide'
	if (message.includes('mail_inbound_accounts_host_borne')) return 'hote-invalide'
	if (message.includes('mail_inbound_accounts_port_borne')) return 'port-invalide'
	if (message.includes('mail_inbound_accounts_securite')) return 'securite-invalide'
	if (message.includes('mail_inbound_accounts_username_borne')) return 'identifiant-invalide'
	// Le port absent (`23502`) et le port non entier (`22P02`) sont deux refus de la MÊME saisie,
	// mesurés §21.6. Les distinguer à l'écran ferait deux phrases pour un seul champ à corriger.
	if (message.includes('imap_port')) return 'port-invalide'
	// Un appelant sans session reçoit `permission denied for function …` sous `401` — mesuré : le
	// `GRANT EXECUTE` de `0022` ne va pas à `anon`.
	if (statutHttp === 401) return 'session-expiree'
	return 'inconnu'
}

export type ResultatEnregistrement =
	| { readonly issue: 'enregistre'; readonly idCompte: string }
	| { readonly issue: Exclude<IssueEnregistrement, 'enregistre'> }

/**
 * Les arguments réellement envoyés à la fonction, calculés depuis la saisie.
 *
 * Exportée pour que les preuves puissent constater les deux règles qui comptent, sans passer par
 * un client simulé :
 *
 * - **`p_password` est OMIS lorsque le champ est vide** (§21.5), jamais envoyé vide : mesuré, un
 *   appel sans ce paramètre conserve le secret enregistré, tandis qu'une chaîne vide serait
 *   ignorée par `btrim(p_password) <> ''` — donc au mieux inutile, au pire trompeuse à la lecture ;
 * - **`p_owner_id` est OMIS pour la boîte système**, et vaut alors son défaut `null` (§21.4).
 *
 * Les trois paramètres d'ingestion ne sont JAMAIS envoyés : `upsert_mail_inbound_account` applique
 * `coalesce(p_x, a.x)` sur chacun, si bien que les omettre laisse la valeur en place (§21.1).
 */
export function argumentsEnregistrement(
	saisie: SaisieCompteEntrant,
): Database['public']['Functions']['upsert_mail_inbound_account']['Args'] {
	const arguments_: Record<string, unknown> = {
		p_workspace_id: saisie.idWorkspace,
		p_label: saisie.libelle,
		p_imap_host: saisie.hote,
		// `Number.parseInt` rend `NaN` sur une saisie vide ou non numérique, que la sérialisation
		// JSON écrit `null` : la base refuse alors en `23502`, et c'est bien elle qui tranche
		// (§21.4). Aucune garde de saisie ne double une contrainte de la base.
		p_imap_port: Number.parseInt(saisie.port, 10),
		p_imap_security: saisie.securite,
		p_imap_username: saisie.identifiant,
	}
	if (saisie.idProprietaire !== null) arguments_['p_owner_id'] = saisie.idProprietaire
	if (saisie.motDePasse !== '') arguments_['p_password'] = saisie.motDePasse
	return arguments_ as Database['public']['Functions']['upsert_mail_inbound_account']['Args']
}

/**
 * Écrit une boîte entrante — création ou modification, selon que le couple
 * `(workspace_id, owner_id)` existe déjà (§13.2, la fonction est un `upsert`).
 *
 * La valeur rendue est l'identifiant du COMPTE, jamais celui du secret (§13.3, mesuré par
 * `e2e/api/comptes-entrants.spec.ts`). Un succès sans identifiant exploitable retombe sur
 * `inconnu` plutôt que sur un succès inventé : l'écran n'annonce jamais un enregistrement que le
 * serveur n'a pas confirmé.
 */
export async function enregistrerCompteEntrant(
	client: ClientCrm,
	saisie: SaisieCompteEntrant,
): Promise<ResultatEnregistrement> {
	try {
		const reponse = await client.rpc('upsert_mail_inbound_account', argumentsEnregistrement(saisie))
		const issue = classerEnregistrement(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
		if (issue !== 'enregistre') return { issue }
		if (typeof reponse.data !== 'string' || reponse.data === '') return { issue: 'inconnu' }
		return { issue, idCompte: reponse.data }
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		void cause
		return { issue: 'reseau' }
	}
}

/**
 * La saisie qui préremplit le formulaire pour une boîte donnée — §21.4.
 *
 * **Le mot de passe est TOUJOURS vide**, quelle que soit la boîte : il n'est pas lisible, et une
 * valeur de substitution affirmerait une longueur que l'écran n'a pas (`docs/DESIGN_SYSTEM.md`
 * §5.34).
 *
 * Une boîte encore inexistante rend une saisie **vide**, et non les valeurs d'une autre boîte :
 * préremplir une création avec la configuration d'une voisine écrirait quelque chose que personne
 * n'a saisi.
 */
export function saisieDepuisCompte(
	idWorkspace: string,
	idProprietaire: string | null,
	compte: CompteEntrant | undefined,
): SaisieCompteEntrant {
	if (compte === undefined) {
		return {
			idWorkspace,
			idProprietaire,
			libelle: '',
			hote: '',
			port: '',
			securite: 'none',
			identifiant: '',
			motDePasse: '',
		}
	}
	return {
		idWorkspace,
		idProprietaire,
		libelle: compte.label,
		hote: compte.imap_host,
		port: String(compte.imap_port),
		securite: compte.imap_security,
		identifiant: compte.imap_username,
		motDePasse: '',
	}
}

/**
 * La boîte visée par un choix du sélecteur, parmi celles que l'appelant LIT.
 *
 * `undefined` signifie « elle n'existe pas encore, ou l'appelant ne la voit pas » — et les deux
 * cas se rendent de la même façon : un formulaire vide qui créera. L'écran ne les distingue pas,
 * parce que la base ne les distingue pas non plus pour lui (§13.4).
 */
export function compteDe(
	comptes: readonly CompteEntrant[],
	idProprietaire: string | null,
): CompteEntrant | undefined {
	return comptes.find((compte) => compte.owner_id === idProprietaire)
}
