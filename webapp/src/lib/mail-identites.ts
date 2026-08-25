// @spec CRM-089 (docs/BACKLOG.md) — configuration des identités sortantes SMTP
// @spec docs/SPEC-mail-subsystem.md §22.3 (ce que l'écran lit), §22.4 (la clé est un TRIPLET),
//       §22.5 (les champs du formulaire), §22.6 (un mot de passe vide est OMIS), §22.7 (le
//       contrat mesuré), §22.8 (dictionnaire fermé des refus, et son repli nommé)
// @spec CRM-063 (docs/BACKLOG.md), tranche 3 — la signature d'une identité sortante
// @spec docs/SPEC-modeles-emails.md §10.4 (l'effacement : omis conserve, vide efface), §10.6 (le
//       champ, et le seul écart au §5.35)
// @spec docs/DESIGN_SYSTEM.md §5.35 (la surface) ; docs/SPEC-permissions-rls.md §7 (refus n° 6)
// @spec docs/INCONSISTENCY_REPORT.md INC-193 (le corps d'un refus divulgue `secret_id`)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE et n'ajoute aucune fonction : il lit
// `mail_outbound_identities` sous la RLS posée par `CRM-053` (migration 0023) et écrit par
// `public.upsert_mail_outbound_identity`, seul chemin d'écriture de cette table — dans la
// signature que la migration `0033` fixe (décision 347).
//
// IL NE REND JAMAIS LE MESSAGE DU SERVEUR, pour la raison exacte du module jumeau
// (`mail-comptes.ts`) : le champ `details` d'un refus de contrainte contient la ligne fautive
// ENTIÈRE, `secret_id` compris — mesuré, INC-193. Un refus est **classé** en une issue du
// dictionnaire fermé ci-dessous, et rien du serveur n'atteint l'écran.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit — §22.3
// ---------------------------------------------------------------------------------------------

/** Une identité sortante telle que l'écran de configuration a besoin de la connaître — §22.3. */
export type IdentiteSortante = Pick<
	Database['public']['Tables']['mail_outbound_identities']['Row'],
	| 'id'
	| 'label'
	| 'owner_id'
	| 'smtp_host'
	| 'smtp_port'
	| 'smtp_security'
	| 'smtp_username'
	| 'from_address'
	| 'from_name'
	| 'signature_text'
	| 'is_default'
	| 'status'
	| 'last_error'
	| 'last_checked_at'
>

/**
 * Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise.
 *
 * `secret_id` en est ABSENTE, et la mesure est plus dure encore que pour les comptes entrants : la
 * citer rend `403 / 42501 permission denied for table mail_outbound_identities` **y compris pour
 * l'administratrice** (§22.7). Une requête qui la nommerait ferait échouer la lecture entière de
 * l'écran pour tout le monde.
 *
 * `daily_quota` en est absente : l'écran ne l'affiche pas plus qu'il ne l'écrit (§22.1). Ne pas
 * lire ce qu'on ne montre pas est la même discipline que ne pas envoyer ce qu'on ne modifie pas.
 *
 * `signature_text` Y EST ENTRÉE AVEC `CRM-063` TRANCHE 3, et la RÉCIPROQUE de cette discipline
 * l'impose : l'écran ne peut pas proposer de MODIFIER une signature sans montrer celle qui est
 * enregistrée. Elle n'y était pas tant qu'elle s'appelait `signature_html` et qu'aucun champ ne
 * l'éditait — le §22.1 refusait le champ parce que la colonne était INEFFAÇABLE, ce que le §10.4
 * a réparé.
 */
const COLONNES_IDENTITE = 'id, label, owner_id' as const
const COLONNES_CONNEXION = 'smtp_host, smtp_port, smtp_security, smtp_username' as const
const COLONNES_EXPEDITION = 'from_address, from_name, signature_text, is_default' as const
const COLONNES_ETAT = 'status, last_error, last_checked_at' as const

// LA COMPOSITION EST UN GABARIT `as const`, ET NON UNE CONCATÉNATION : `supabase-js` type la
// réponse à partir du **littéral** passé à `select`, et un `'a' + 'b'` élargit le type à `string`,
// ce qui ferait retomber la ligne rendue sur `GenericStringError`. Même raison qu'au module jumeau.
export const COLONNES_IDENTITE_SORTANTE =
	`${COLONNES_IDENTITE}, ${COLONNES_CONNEXION}, ${COLONNES_EXPEDITION}, ${COLONNES_ETAT}` as const

/**
 * Une identité porte-t-elle une signature ? — `CRM-063` §10.6.
 *
 * LE TEST EST CELUI DE LA BASE, ET NON `!== null` : la migration 58 ramène le vide et le blanc à
 * `null` à l'écriture (§10.4), mais une donnée posée par une autre voie ne doit pas allumer une
 * pilule qui promettrait une signature que le destinataire ne verra pas — `app.mail_corps_signe`
 * rend le corps INCHANGÉ sur une signature blanche. L'écran dit donc la même chose que la garde.
 */
export function signatureRenseignee(identite: IdentiteSortante): boolean {
	return (identite.signature_text ?? '').trim() !== ''
}

/**
 * Les identités sortantes visibles par l'appelant, triées par adresse d'expédition.
 *
 * LE TRI SUIT LA TÊTE DE LIGNE, et non le libellé comme au §5.34 : l'adresse est la donnée qui
 * distingue deux identités d'une même personne, le libellé pouvant être identique (§5.35).
 *
 * La RLS de `0023` fait tout le tri des DROITS (§14.3), mesuré §22.3 : administratrice — les deux
 * identités du workspace ; Driss — la sienne ; Farida — **zéro ligne**, `200`, et ce n'est pas un
 * refus.
 */
export async function lireIdentitesSortantes(
	client: ClientCrm,
): Promise<EtatAsync<readonly IdentiteSortante[]>> {
	try {
		const reponse = await client
			.from('mail_outbound_identities')
			.select(COLONNES_IDENTITE_SORTANTE)
			.order('from_address')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les vocabulaires fermés de la table — migration 0023
// ---------------------------------------------------------------------------------------------

/** Les quatre valeurs que la contrainte `mail_outbound_identities_statut` admet (§14.2). */
export const ETATS_IDENTITE_SORTANTE = ['pending', 'ok', 'error', 'disabled'] as const

export type EtatIdentiteSortante = (typeof ETATS_IDENTITE_SORTANTE)[number]

/**
 * Un cinquième état serait un défaut de la contrainte, pas un texte à deviner côté client.
 *
 * La pilule est alors **absente** plutôt que remplie du code brut — règle du §5.14, tenue par le
 * §5.34 et reprise par le §5.35.
 */
export function estEtatIdentiteConnu(valeur: string): valeur is EtatIdentiteSortante {
	return (ETATS_IDENTITE_SORTANTE as readonly string[]).includes(valeur)
}

/** Les trois modes de la contrainte `mail_outbound_identities_securite` (§22.5). */
export const MODES_SECURITE_SORTANTE = ['ssl', 'starttls', 'none'] as const

export type ModeSecuriteSortante = (typeof MODES_SECURITE_SORTANTE)[number]

export function estModeSecuriteSortanteConnu(valeur: string): valeur is ModeSecuriteSortante {
	return (MODES_SECURITE_SORTANTE as readonly string[]).includes(valeur)
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran écrit — §22.5, §22.6
// ---------------------------------------------------------------------------------------------

/**
 * La saisie du formulaire, telle que le composant la porte.
 *
 * `port` est une CHAÎNE et non un nombre : c'est ce qu'un `input` rend, et la convertir dans le
 * composant y ferait naître une garde de saisie que le §5.3 ter interdit. La conversion vit ici, et
 * une saisie non entière part telle quelle vers la base, qui tranche (§22.5).
 */
export type SaisieIdentiteSortante = {
	readonly idWorkspace: string
	/** `null` désigne l'identité de SERVICE du workspace ; sinon, celle de ce propriétaire. */
	readonly idProprietaire: string | null
	readonly libelle: string
	readonly hote: string
	readonly port: string
	readonly securite: string
	readonly identifiant: string
	/**
	 * L'adresse d'expédition, et elle fait partie de la CLÉ (§22.4).
	 *
	 * La modifier sur une identité existante n'en change pas l'adresse : elle en déclare une
	 * SECONDE, mesuré. L'écran le nomme par un texte d'aide, il ne l'empêche pas.
	 */
	readonly adresseExpedition: string
	/** Vide = le nom d'expéditeur est EFFACÉ, et le paramètre est envoyé vide (§22.5). */
	readonly nomExpediteur: string
	/**
	 * La signature ajoutée à la fin de chaque message expédié depuis cette identité.
	 *
	 * Vide = la signature est EFFACÉE, exactement comme le nom d'expéditeur et pour la même raison
	 * mesurée : le paramètre est TOUJOURS envoyé, et la fonction ramène le vide à `null` (§10.4).
	 * La borne de deux mille caractères vit en base, et c'est elle qui refuse.
	 */
	readonly signature: string
	readonly parDefaut: boolean
	/** Vide = le mot de passe enregistré est CONSERVÉ, et le paramètre n'est pas envoyé (§22.6). */
	readonly motDePasse: string
}

/**
 * Les issues de l'enregistrement — dictionnaire fermé du §22.8.
 *
 * Chacune correspond à une réponse RÉELLEMENT mesurée le 2026-08-21 (§22.7), jamais à une
 * hypothèse. `inconnu` est le **repli nommé** : nommer « je ne sais pas » est une réponse, la
 * déguiser en une cause précise n'en est pas une.
 */
export type IssueEnregistrementIdentite =
	/** `200` : la fonction rend l'identifiant de l'identité écrite. */
	| 'enregistre'
	/** `403`, `forbidden` : l'identité visée n'appartient pas à l'appelant, et il n'est pas admin. */
	| 'refus'
	/** `401`, ou `not_authenticated` : la session n'existe plus. */
	| 'session-expiree'
	/** `23514`, `password_required` : une identité NEUVE sans mot de passe est refusée. */
	| 'mot-de-passe-requis'
	/** `23514`, contrainte `mail_outbound_identities_label_borne` — 120 caractères, non 200. */
	| 'libelle-invalide'
	/** `23514`, contrainte `mail_outbound_identities_host_borne`. */
	| 'hote-invalide'
	/** `23514` sur la borne du port, `23502` sur son absence, `22P02` sur une saisie non entière. */
	| 'port-invalide'
	/** `23514`, contrainte `mail_outbound_identities_securite`. */
	| 'securite-invalide'
	/** `23514`, contrainte `mail_outbound_identities_username_borne`. */
	| 'identifiant-invalide'
	/** `23514`, contrainte `mail_outbound_identities_from_address` — 3 à 320, et la forme `x@y.z`. */
	| 'adresse-invalide'
	/** `23514`, `owner_not_member` : le propriétaire n'est pas membre du workspace. */
	| 'proprietaire-non-membre'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir, et ne recopie pas le serveur. */
	| 'inconnu'

/**
 * Classe une réponse d'`upsert_mail_outbound_identity` en une issue du dictionnaire fermé.
 *
 * ON CLASSE SUR DES IDENTIFIANTS STABLES, JAMAIS SUR DE LA PROSE — les refus levés par la fonction
 * (`forbidden`, `not_authenticated`, `password_required`, `owner_not_member`) arrivent tels quels,
 * et ceux levés par la base portent le **nom de la contrainte**, identifiant du schéma versionné
 * par la migration `0023`. Le message n'est ni rendu, ni journalisé : il entre ici, il en sort une
 * issue.
 *
 * LES NOMS DE CONTRAINTE SONT CEUX DE LA TABLE SORTANTE, jamais ceux de la table entrante : deux
 * jeux distincts, aux bornes distinctes (120 contre 200 caractères pour le libellé). Les confondre
 * ferait retomber chaque refus sur le repli « inconnu » sans qu'aucune preuve simulée ne le voie —
 * c'est précisément ce que le harnais dédié relit en base.
 */
export function classerEnregistrementIdentite(
	statutHttp: number | undefined,
	message: string | null,
): IssueEnregistrementIdentite {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message === null) {
		return statutHttp >= 200 && statutHttp < 300 ? 'enregistre' : 'inconnu'
	}
	if (message === 'forbidden') return 'refus'
	if (message === 'not_authenticated') return 'session-expiree'
	if (message === 'password_required') return 'mot-de-passe-requis'
	if (message === 'owner_not_member') return 'proprietaire-non-membre'
	if (message.includes('mail_outbound_identities_label_borne')) return 'libelle-invalide'
	if (message.includes('mail_outbound_identities_host_borne')) return 'hote-invalide'
	if (message.includes('mail_outbound_identities_port_borne')) return 'port-invalide'
	if (message.includes('mail_outbound_identities_securite')) return 'securite-invalide'
	if (message.includes('mail_outbound_identities_username_borne')) return 'identifiant-invalide'
	if (message.includes('mail_outbound_identities_from_address')) return 'adresse-invalide'
	// Le port absent (`23502`, message nommant la colonne) et le port non entier (`22P02`, message
	// ne nommant que le TYPE) sont deux refus de la MÊME saisie, mesurés §22.7. Les distinguer à
	// l'écran ferait deux phrases pour un seul champ à corriger.
	//
	// L'ATTRIBUTION EST ENCORE PLUS ÉTROITE QU'AU §21.7 : `p_smtp_port` est le SEUL entier que ce
	// module envoie, `p_daily_quota` n'étant jamais transmis (§22.1). C'est une propriété de
	// l'appel, pas une devinette sur la prose du serveur.
	if (message.includes('smtp_port')) return 'port-invalide'
	if (message.includes('invalid input syntax for type integer')) return 'port-invalide'
	// Un appelant sans session reçoit `permission denied for function …` sous `401` — mesuré : le
	// `GRANT EXECUTE` de `0023` ne va pas à `anon`.
	if (statutHttp === 401) return 'session-expiree'
	return 'inconnu'
}

export type ResultatEnregistrementIdentite =
	| { readonly issue: 'enregistre'; readonly idIdentite: string }
	| { readonly issue: Exclude<IssueEnregistrementIdentite, 'enregistre'> }

/**
 * Les arguments réellement envoyés à la fonction, calculés depuis la saisie.
 *
 * TROIS RÈGLES, ET DEUX D'ENTRE ELLES SONT OPPOSÉES — elles sont mesurées, non déduites (§22.7) :
 *
 * - **`p_password` est OMIS lorsque le champ est vide** (§22.6), jamais envoyé vide : un appel sans
 *   ce paramètre conserve le secret enregistré, `secret_id` relu identique avant et après ;
 * - **`p_from_name` est TOUJOURS envoyé, y compris vide** (§22.5) : la fonction applique
 *   `coalesce(p_from_name, i.from_name)`, si bien qu'omettre rendrait un nom d'expéditeur
 *   INEFFAÇABLE, tandis qu'une chaîne vide est une valeur et l'écrase. Mesuré dans les deux sens ;
 * - **`p_owner_id` est OMIS pour l'identité de service**, et vaut alors son défaut `null` (§22.5).
 *
 * `p_daily_quota` n'est JAMAIS envoyé : son `coalesce` le rend ineffaçable, et un champ d'écran
 * qui ne sait pas revenir en arrière est un piège (§22.1).
 *
 * **`p_signature_text` EST TOUJOURS ENVOYÉ, y compris vide, ET C'EST UN CHANGEMENT DE RÈGLE**
 * (`CRM-063` tranche 3, §10.4). Il rejoint `p_from_name` et quitte la famille de `p_daily_quota` :
 * la migration 58 a remplacé son `coalesce` par trois états — omis conserve, vide EFFACE, rempli
 * écrit —, si bien que le champ sait désormais revenir en arrière. C'est précisément la réparation
 * qui autorise le §10.6 à ouvrir le champ que le §22.1 refusait.
 */
export function argumentsEnregistrementIdentite(
	saisie: SaisieIdentiteSortante,
): Database['public']['Functions']['upsert_mail_outbound_identity']['Args'] {
	const arguments_: Record<string, unknown> = {
		p_workspace_id: saisie.idWorkspace,
		p_label: saisie.libelle,
		p_smtp_host: saisie.hote,
		// `Number.parseInt` rend `NaN` sur une saisie vide ou non numérique, que la sérialisation
		// JSON écrit `null` : la base refuse alors en `23502`, et c'est bien elle qui tranche
		// (§22.5). Aucune garde de saisie ne double une contrainte de la base.
		p_smtp_port: Number.parseInt(saisie.port, 10),
		p_smtp_security: saisie.securite,
		p_smtp_username: saisie.identifiant,
		p_from_address: saisie.adresseExpedition,
		p_from_name: saisie.nomExpediteur,
		p_signature_text: saisie.signature,
		p_is_default: saisie.parDefaut,
	}
	if (saisie.idProprietaire !== null) arguments_['p_owner_id'] = saisie.idProprietaire
	if (saisie.motDePasse !== '') arguments_['p_password'] = saisie.motDePasse
	return arguments_ as Database['public']['Functions']['upsert_mail_outbound_identity']['Args']
}

/**
 * Écrit une identité sortante — déclaration ou modification, selon que le TRIPLET
 * `(workspace_id, owner_id, from_address)` existe déjà (§22.4).
 *
 * La valeur rendue est l'identifiant de l'IDENTITÉ, jamais celui du secret. Un succès sans
 * identifiant exploitable retombe sur `inconnu` plutôt que sur un succès inventé : l'écran
 * n'annonce jamais un enregistrement que le serveur n'a pas confirmé.
 */
export async function enregistrerIdentiteSortante(
	client: ClientCrm,
	saisie: SaisieIdentiteSortante,
): Promise<ResultatEnregistrementIdentite> {
	try {
		const reponse = await client.rpc(
			'upsert_mail_outbound_identity',
			argumentsEnregistrementIdentite(saisie),
		)
		const issue = classerEnregistrementIdentite(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
		if (issue !== 'enregistre') return { issue }
		if (typeof reponse.data !== 'string' || reponse.data === '') return { issue: 'inconnu' }
		return { issue, idIdentite: reponse.data }
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		void cause
		return { issue: 'reseau' }
	}
}

/**
 * La saisie qui préremplit le formulaire pour une identité donnée — §22.5.
 *
 * **Le mot de passe est TOUJOURS vide**, quelle que soit l'identité : il n'est pas lisible, et une
 * valeur de substitution affirmerait une longueur que l'écran n'a pas (§5.35, §5.34).
 *
 * Une identité qui n'existe pas encore rend une saisie **vide, `parDefaut` COCHÉE** : c'est le
 * défaut de la fonction (`coalesce(p_is_default, true)`), et montrer autre chose ferait mentir le
 * formulaire sur ce que l'enregistrement va faire (§5.35).
 */
export function saisieDepuisIdentite(
	idWorkspace: string,
	idProprietaire: string | null,
	identite: IdentiteSortante | undefined,
): SaisieIdentiteSortante {
	if (identite === undefined) {
		return {
			idWorkspace,
			idProprietaire,
			libelle: '',
			hote: '',
			port: '',
			securite: 'none',
			identifiant: '',
			adresseExpedition: '',
			nomExpediteur: '',
			signature: '',
			parDefaut: true,
			motDePasse: '',
		}
	}
	return {
		idWorkspace,
		idProprietaire,
		libelle: identite.label,
		hote: identite.smtp_host,
		port: String(identite.smtp_port),
		securite: identite.smtp_security,
		identifiant: identite.smtp_username,
		adresseExpedition: identite.from_address,
		// `from_name` est nullable en base ; le formulaire porte une chaîne, et une absence se saisit
		// comme un champ vide — qui, envoyé, laissera la colonne vide (§22.5).
		nomExpediteur: identite.from_name ?? '',
		// `signature_text` est nullable en base ; le formulaire porte une chaîne, et une absence se
		// saisit comme un champ vide — qui, envoyé, effacera la colonne (§10.4).
		signature: identite.signature_text ?? '',
		parDefaut: identite.is_default,
		motDePasse: '',
	}
}

/**
 * L'identité désignée par un choix du sélecteur, parmi celles que l'appelant LIT.
 *
 * ELLE SE CHERCHE PAR SON IDENTIFIANT, et non par son propriétaire comme au §21 : une personne peut
 * porter plusieurs identités (§22.4), si bien que `owner_id` ne désigne plus une ligne unique.
 *
 * `undefined` signifie « le sélecteur vise une déclaration » — l'une des deux entrées neuves —, et
 * se rend par un formulaire vide.
 */
export function identiteDe(
	identites: readonly IdentiteSortante[],
	idIdentite: string,
): IdentiteSortante | undefined {
	return identites.find((identite) => identite.id === idIdentite)
}

/**
 * Le texte rendu pour une identité : `Nom <adresse>` si le nom existe, l'adresse seule sinon.
 *
 * C'est la forme dans laquelle un DESTINATAIRE lira l'expéditeur (§5.35), et c'est pourquoi les
 * deux données ne se rendent jamais sur deux colonnes séparées. Un nom absent — `null` en base, ou
 * la chaîne vide qu'un effacement laisse — ne produit ni tiret ni valeur inventée : la règle de la
 * cellule vide du §5.9.
 */
export function expediteurLisible(identite: IdentiteSortante): string {
	const nom = identite.from_name?.trim() ?? ''
	return nom === '' ? identite.from_address : `${nom} <${identite.from_address}>`
}
