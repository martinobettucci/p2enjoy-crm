// @spec CRM-161 (docs/BACKLOG.md) tranche T2.c — un choix fait pour un objet d'un espace ne lit que cet espace
//       (docs/SPEC-espace-courant.md §15.4 bis, « Les sélecteurs liés à un espace » ; décision 975)
// @spec CRM-058 (docs/BACKLOG.md) — composer et répondre depuis l'écran
// @spec docs/SPEC-mail-subsystem.md §19.4 (les six refus), §19.6 (le même chemin de code)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états systématiques) ; docs/SPEC-webapp.md §6.4
// @spec docs/JOURNAL.md décision 330
// @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : la copie cachée, les pièces déposées puis citées par la file, les
//       plafonds, les refus nommés — docs/SPEC-mail-subsystem.md §19 bis.2, §19 bis.3, §19 bis.5 ;
//       docs/DESIGN_SYSTEM.md §5.4 sexies ; décisions 719 et 720
// @spec INC-335 (docs/BACKLOG.md, correctif de la décision 805, T2) — les identités empruntables sont les siennes, et
//       elles seules ; la présélection prend son identité par défaut — docs/SPEC-mail-subsystem.md §14.2, §19.4, §22.14 ;
//       au bloc d'armement, seulement pour le responsable du rattachement — décision 803, docs/SPEC-rattachements.md §7
//
// L'INTERFACE N'OUVRE JAMAIS DE CONNEXION SMTP (§5) : elle met en file, et le worker envoie. Ce
// module ne fait donc qu'appeler la garde et classer ses refus — six, dont chacun demande à
// l'utilisateur un geste différent.

// @spec CRM-157 (docs/BACKLOG.md) — tranche T2 : les refus d'envoi dits en clair — le domaine absent, l'affaire
//       indisponible, le destinataire, le corps, reconnus À LEUR NOM — et la lecture du domaine de l'espace de l'affaire,
//       qui prévient avant qu'on rédige (docs/SPEC-mail-subsystem.md §33.3, §33.4 ; décisions 951 et 953)
import { classerErreur, type ErreurDonnees } from './async'
import type { ClientCrm } from './supabase'

export type IdentiteEnvoi = {
	readonly id: string
	readonly libelle: string
	readonly adresse: string
	/** L'identité par défaut de la personne, choisie dans les réglages (§14.2) : celle que l'envoi présélectionne. */
	readonly parDefaut: boolean
}

/**
 * Les identités que l'appelant peut EMPLOYER — et c'est plus étroit que ce qu'il peut LIRE.
 *
 * MESURÉ, ET CE N'ÉTAIT PAS CE QUE JE CROYAIS : la RLS de `mail_outbound_identities` ouvre la
 * lecture aux administrateurs sur TOUTES les identités du workspace, y compris les identités
 * personnelles de leurs collègues — c'est une règle de supervision, pas d'usage. Une liste qui s'en
 * remettrait à elle proposerait donc à une administratrice d'expédier au nom d'un collègue, et la
 * garde refuserait au premier envoi (`identity_not_available`). Proposer une action qui échouera
 * est pire que ne pas la proposer.
 *
 * LES SIENNES, ET ELLES SEULES, depuis la décision 805 (INC-335) : l'identité de SERVICE ne sert plus qu'aux envois
 * automatiques, et la garde la refuse à tous, administrateur compris. Elle sortait auparavant de ce filtre pour les
 * administrateurs, et pouvait même être présélectionnée pour leurs propres messages.
 *
 * LE FILTRE EST UNE AIDE D'INTERFACE, JAMAIS LA RÈGLE (`CLAUDE.md` §10) : la règle reste dans la
 * garde, qui refuse de toute façon. C'est pourquoi il est écrit ici, en clair, plutôt que caché
 * dans une requête.
 */
export async function lireIdentitesDisponibles(
	client: ClientCrm | null,
	idUtilisateur: string | null,
	/** `CRM-161` T2.c (§15.4 bis, décision 975) : celles de l'espace de l'affaire seul ; omis, tout ce que la RLS rend. */
	idWorkspace?: string,
): Promise<readonly IdentiteEnvoi[]> {
	if (client === null) return []
	try {
		const toutes = client.from('mail_outbound_identities').select('id, label, from_address, owner_id, is_default')
		const reponse = await (idWorkspace === undefined ? toutes : toutes.eq('workspace_id', idWorkspace)).order('label')
		if (reponse.error !== null) return []
		return reponse.data
			.filter((ligne) => idUtilisateur !== null && ligne.owner_id === idUtilisateur)
			.map((ligne) => ({
				id: ligne.id,
				libelle: ligne.label,
				adresse: ligne.from_address,
				parDefaut: ligne.is_default,
			}))
	} catch {
		return []
	}
}

/**
 * L'identité que l'envoi présélectionne — décision 805 (§19.4, §22.14) : celle que la personne a choisie par défaut dans
 * ses réglages ; à défaut, son unique identité ; sinon aucune (`''`), et elle choisit. Jamais la première venue d'un tri
 * par libellé, qui pouvait désigner une identité que personne n'avait choisie.
 */
export function identiteAPreselectionner(identites: readonly IdentiteEnvoi[]): string {
	const parDefaut = identites.find((identite) => identite.parDefaut)
	if (parDefaut !== undefined) return parDefaut.id
	return identites.length === 1 ? identites[0]!.id : ''
}

/**
 * L'identité que le bloc d'armement d'une cadence présélectionne — décision 803 (INC-315), précisée par la décision 805 :
 * quand la personne qui arme est le RESPONSABLE du rattachement armé, la même règle que l'envoi (son identité par défaut,
 * à défaut l'unique) ; sinon rien, et elle choisit. Un responsable inconnu (`null`) ne présélectionne rien.
 */
export function identiteArmementAPreselectionner(
	identites: readonly IdentiteEnvoi[],
	idUtilisateur: string | null,
	idResponsable: string | null,
): string {
	if (idUtilisateur === null || idResponsable === null || idUtilisateur !== idResponsable) return ''
	return identiteAPreselectionner(identites)
}

export type NatureRefusEnvoi =
	/** `42501` : ni le droit d'écrire sur l'affaire, ni le droit d'emprunter cette identité. */
	| 'forbidden'
	/** `CRM-157` — `workspace_reply_domain_missing` : l'espace n'a pas de domaine d'adresses d'affaire. */
	| 'domaine_absent'
	/** `CRM-157` — `card_not_available` : l'affaire en corbeille, sans channel actif, ou d'un autre espace que l'identité. */
	| 'affaire_indisponible'
	/** `CRM-157` — `recipient_required`. */
	| 'destinataire_requis'
	/** `CRM-157` — `body_required`. */
	| 'corps_requis'
	/** Un autre `23514`, que l'écran ne sait pas nommer : dit sans prétendre une cause. */
	| 'invalide'
	/** `23505` : le quota journalier de l'identité est atteint. */
	| 'quota'
	/** `attachment_not_available` : une pièce absente, ou qui n'est pas celle de l'appelant (§19 bis.3). */
	| 'piece_indisponible'
	/** `too_many_attachments` ou `attachments_too_large` : un plafond du §19 bis.2 point 4. */
	| 'pieces_plafond'
	| 'network'
	| 'unknown'

export type RefusEnvoi = { readonly nature: NatureRefusEnvoi; readonly detail: string }

/** Les refus `23514` que l'écran nomme (`CRM-157`, §33.3) — un dictionnaire fermé ; le reste est « invalide ». */
const NATURES_23514: Readonly<Record<string, NatureRefusEnvoi>> = {
	workspace_reply_domain_missing: 'domaine_absent',
	card_not_available: 'affaire_indisponible',
	recipient_required: 'destinataire_requis',
	body_required: 'corps_requis',
}

/**
 * Le domaine de l'espace d'une affaire (`CRM-157`, §33.4), lu à l'ouverture du formulaire, sous la RLS de l'appelant :
 * `present`, `absent` (l'envoi est impossible : le formulaire prévient et éteint « Envoyer »), ou `inconnu` — la lecture
 * a échoué, et rien n'est éteint : la base refusera, et le refus nommé sera dit (§5.59).
 */
export type DomaineDeLAffaire = {
	readonly statut: 'present' | 'absent' | 'inconnu'
	/** L'espace de l'affaire, dès que la ligne est lue — les pièces jointes en ont besoin, domaine lisible ou non. */
	readonly idEspace: string | null
	/** Son identifiant court, pour le lien du super-administrateur ; `null` quand l'espace n'a pas pu être lu. */
	readonly slugEspace: string | null
}

/** Les colonnes de la lecture : l'espace de l'affaire, son identifiant court et son domaine. Exportées pour la preuve. */
export const COLONNES_DOMAINE_AFFAIRE = 'workspace_id, workspaces(slug, inbound_domain)'

export async function lireDomaineDeLAffaire(client: ClientCrm | null, idCard: string): Promise<DomaineDeLAffaire> {
	const inconnu: DomaineDeLAffaire = { statut: 'inconnu', idEspace: null, slugEspace: null }
	if (client === null) return inconnu
	try {
		const reponse = await client.from('cards').select(COLONNES_DOMAINE_AFFAIRE).eq('id', idCard).limit(1)
		if (reponse.error !== null) return inconnu
		const ligne = reponse.data?.[0]
		if (ligne === undefined) return inconnu
		const espace = ligne.workspaces
		// L'ESPACE EMBARQUÉ ILLISIBLE N'EST PAS UNE ABSENCE DE DOMAINE : « inconnu », qui n'éteint rien (§5.59).
		if (espace === null || espace === undefined) return { statut: 'inconnu', idEspace: ligne.workspace_id, slugEspace: null }
		const domaine = typeof espace.inbound_domain === 'string' ? espace.inbound_domain.trim() : ''
		return { statut: domaine === '' ? 'absent' : 'present', idEspace: ligne.workspace_id, slugEspace: espace.slug }
	} catch {
		return inconnu
	}
}

/**
 * Classe le refus d'une mise en file.
 *
 * LE QUOTA EST DISTINGUÉ DU RESTE, et ce n'est pas un raffinement : « vous ne pouvez pas écrire au
 * nom de cette affaire » et « cette identité a atteint son plafond du jour » demandent deux gestes
 * différents — demander un droit, ou attendre demain. Les confondre sous « une erreur est
 * survenue » serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusEnvoi(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusEnvoi {
	if (code === '23505') return { nature: 'quota', detail }
	// LES TROIS REFUS DES PIÈCES PORTENT `23514` COMME UNE AFFAIRE FERMÉE, et demandent un autre geste : retirer un fichier
	// plutôt que changer d'affaire. Le message de la base les distingue (§19 bis.3).
	if (detail === 'attachment_not_available') return { nature: 'piece_indisponible', detail }
	if (detail === 'too_many_attachments' || detail === 'attachments_too_large') {
		return { nature: 'pieces_plafond', detail }
	}
	// `CRM-157` (§33.3) : LES REFUS DE FORME SONT RECONNUS À LEUR NOM, écrit dans la migration et vérifié par pgTAP —
	// jamais une phrase. Les ranger tous sous « invalide » faisait dire « affaire indisponible » à un espace sans domaine.
	if (code === '23514') {
		const nature = NATURES_23514[detail]
		return { nature: nature ?? 'invalide', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

export type Brouillon = {
	readonly idCard: string
	readonly idIdentite: string
	readonly destinataires: readonly string[]
	readonly objet: string
	readonly corps: string
	/** Identifiant du message auquel on répond — absent pour un message initial. */
	readonly repondA?: string
	/** La copie cachée : remise par l'enveloppe, jamais montrée aux destinataires (§19 bis.2 point 1). */
	readonly copiesCachees?: readonly string[]
	/** Les CHEMINS des pièces déjà déposées dans `mail-outbound-attachments` (§19 bis.2 point 5). */
	readonly pieces?: readonly string[]
}

/**
 * Sépare une saisie de destinataires en adresses.
 *
 * LA VIRGULE ET LE POINT-VIRGULE SONT ACCEPTÉS tous les deux : les deux séparateurs coexistent
 * dans les clients de messagerie, et refuser l'un obligerait l'utilisateur à savoir lequel ce
 * produit attend.
 */
export function decouperDestinataires(saisie: string): readonly string[] {
	return saisie
		.split(/[,;]/)
		.map((morceau) => morceau.trim())
		.filter((morceau) => morceau !== '')
}

/** Met un message en file. Rend `null` en cas de succès, le refus sinon. */
export async function mettreEnFile(
	client: ClientCrm | null,
	brouillon: Brouillon,
): Promise<RefusEnvoi | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.rpc('queue_outbound_email', {
			p_card_id: brouillon.idCard,
			p_identity_id: brouillon.idIdentite,
			p_to: [...brouillon.destinataires],
			p_subject: brouillon.objet,
			p_body_text: brouillon.corps,
			...(brouillon.repondA === undefined ? {} : { p_in_reply_to_message_id: brouillon.repondA }),
			p_bcc: [...(brouillon.copiesCachees ?? [])],
			p_attachments: [...(brouillon.pieces ?? [])],
		})
		if (reponse.error !== null) {
			return classerRefusEnvoi(reponse.status, reponse.error.code, reponse.error.message)
		}
		return null
	} catch (cause) {
		const erreur: ErreurDonnees = classerErreur(
			undefined,
			cause instanceof Error ? cause.message : String(cause),
		)
		return { nature: 'network', detail: erreur.detail }
	}
}

/**
 * L'objet d'une réponse, préfixé une seule fois.
 *
 * `Re: Re: Re:` est le symptôme d'un produit qui empile sans regarder : le préfixe est ajouté s'il
 * manque, et laissé tel quel sinon.
 */
export function objetDeReponse(objet: string): string {
	return /^re\s*:/i.test(objet.trim()) ? objet.trim() : `Re: ${objet.trim()}`
}

// =================================================================================================
// Les pièces jointes — CRM-058 tranche 2, §19 bis.2 points 4 et 5
// =================================================================================================

/** Le bucket privé des pièces à envoyer — la migration 106 le crée. */
export const BUCKET_PIECES = 'mail-outbound-attachments'
/** Les plafonds du §19 bis.2 point 4 — la base les tient aussi, et c'est elle la règle. */
export const PIECES_MAX = 10
export const PIECES_OCTETS_MAX = 10 * 1024 * 1024

/**
 * Le nom d'un fichier tel que la clé de stockage l'accepte.
 *
 * MESURÉ : l'API de stockage refuse une clé portant un caractère accentué (« Invalid key »). Le nom est donc
 * translittéré — « Proposition révisée.pdf » devient « Proposition revisee.pdf » —, et tout autre caractère hors de
 * l'alphabet accepté devient `_`. Le nom de la pièce reçue par le destinataire est celui-là : l'écart est écrit dans le
 * manuel plutôt que caché.
 */
export function nomDeDepot(nom: string): string {
	const translittere = nom
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9 ._()+,=@&$!'-]/g, '_')
		.trim()
	return translittere === '' || /^\.+$/.test(translittere) ? 'piece' : translittere.slice(0, 200)
}

/** Le chemin de dépôt : `<espace>/<personne>/<uuid>/<nom>` — la seule forme que la politique de stockage accepte. */
export function cheminDeDepot(idEspace: string, idPersonne: string, nom: string, aleatoire: string): string {
	return `${idEspace}/${idPersonne}/${aleatoire}/${nomDeDepot(nom)}`
}

export type DepassementPlafond = 'nombre' | 'taille'

/** Le plafond dépassé par une liste de fichiers, ou `null`. Une aide d'interface : la base refuse de toute façon. */
export function depassementPlafond(tailles: readonly number[]): DepassementPlafond | null {
	if (tailles.length > PIECES_MAX) return 'nombre'
	if (tailles.reduce((somme, taille) => somme + taille, 0) > PIECES_OCTETS_MAX) return 'taille'
	return null
}

/** Une taille lisible, en français : « 980 o », « 3,4 Ko », « 2,1 Mo ». */
export function tailleLisible(octets: number): string {
	if (octets < 1024) return `${octets} o`
	const unites = ['Ko', 'Mo'] as const
	let valeur = octets / 1024
	let rang = 0
	while (valeur >= 1024 && rang < unites.length - 1) {
		valeur /= 1024
		rang += 1
	}
	return `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${unites[rang]}`
}

/** Dépose un fichier. Rend `null` en cas de succès, l'erreur classée sinon — le formulaire la montre sur la ligne. */
export async function deposerPiece(
	client: ClientCrm | null,
	chemin: string,
	fichier: Blob,
): Promise<ErreurDonnees | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.storage.from(BUCKET_PIECES).upload(chemin, fichier, {
			contentType: fichier.type === '' ? 'application/octet-stream' : fichier.type,
			upsert: false,
		})
		return reponse.error === null ? null : classerErreur(403, reponse.error.message)
	} catch (cause) {
		return classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))
	}
}

/**
 * Retire un dépôt que le formulaire abandonne. Un échec n'est pas dit : le dépôt sera effacé par la purge des dépôts
 * abandonnés après 24 heures (§19 bis.2 point 8), et il n'a jamais été mis en file.
 */
export async function retirerPiece(client: ClientCrm | null, chemin: string): Promise<void> {
	if (client === null) return
	try {
		await client.storage.from(BUCKET_PIECES).remove([chemin])
	} catch {
		// LA PURGE RATTRAPE : voir le commentaire de la fonction.
	}
}
