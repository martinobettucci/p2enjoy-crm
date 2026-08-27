// @spec CRM-057 (docs/BACKLOG.md) — inbox globale : arborescence, liste, message, classement
// @spec docs/SPEC-mail-subsystem.md §18.1 (qui voit quoi), §18.3 (les trois panneaux), §18.4 (le
//       HTML d'un expéditeur ne s'affiche jamais), §18.5 (la pièce jointe saine), §18.6 (le
//       message dans la card)
// @spec docs/DESIGN_SYSTEM.md §5.4 (inbox), §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 e : les trois colonnes du fil et la lecture des fils
//       endormis, docs/SPEC-cards.md §16.15.3
// @spec CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis : la SURFACE de la suggestion,
//       docs/SPEC-contacts.md §8.8.3 (ce que l'écran lit), §8.8.4 (les quatre états)
// @spec docs/JOURNAL.md décision 327, décision 481
//
// Ce module ne rend rien : il **lit, réduit et classe**. La séparation est ce qui rend la
// réduction du HTML, la construction de l'arbre et la classification des refus vérifiables
// **sans navigateur**.
//
// AUCUNE DE CES FONCTIONS N'APPLIQUE UN DROIT : la visibilité est tenue par la RLS (§18.1), et une
// requête qui ne rapporte rien est un refus déjà appliqué, non une erreur.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import { cleFil, lireFilsEndormis, type FilsEndormis } from './sommeil-fil'
import type { ClientCrm } from './supabase'

/**
 * Un client absent n'est pas une panne réseau : c'est une configuration incomplète, et la nommer
 * ainsi évite de proposer un « réessayer » qui ne peut rien changer (docs/SPEC-webapp.md §6.4).
 */
const CONFIGURATION_ABSENTE = { nature: 'unknown', detail: 'configuration_absente' } as const

/**
 * Colonnes réellement demandées pour la LISTE — et `body_html` n'en fait toujours pas partie.
 *
 * Une liste affiche un expéditeur, un objet et une date. Rapporter le corps de chaque message pour
 * n'en montrer aucun multiplierait le poids de la réponse par la taille des courriers.
 *
 * TROIS COLONNES AJOUTÉES PAR LA TRANCHE 2 e (docs/SPEC-cards.md §16.15.3), et chacune est
 * NÉCESSAIRE : sans `references_ids` et `rfc822_message_id`, aucune clé de fil ne se calcule — la
 * décision du §16.14.2 laisse cette clé hors des colonnes de la table ; sans `workspace_id`, cette
 * clé ne se rattache à aucun workspace, et la mesure 5 du §16.14.1 interdit de l'ignorer.
 */
// UNE SEULE CHAÎNE LITTÉRALE, JAMAIS UNE CONCATÉNATION : `supabase-js` infère le type des lignes
// rendues à partir du littéral lui-même, et un `+` le réduit à `string` — la réponse devient alors
// `GenericStringError` et tout appelant cesse de compiler. Mesuré en ajoutant les trois colonnes.
export const COLONNES_LISTE =
	'id, workspace_id, card_id, classification, subject, from_address, from_name, received_at, references_ids, rfc822_message_id'

/**
 * Colonnes du panneau de lecture. Le corps y est demandé, puisqu'il y est montré.
 *
 * `suggested_card_id` REJOINT CETTE LISTE ET NON `COLONNES_LISTE` (docs/SPEC-contacts.md §8.8.3) :
 * la liste ne montre aucune suggestion — le §5.4 bis du design system y tient une densité que la
 * sous-tranche 2 bis ne défait pas —, et rapporter la colonne pour cinquante messages afin de n'en
 * afficher aucun contredirait le motif écrit en tête de `COLONNES_LISTE`.
 *
 * `suggested_at` N'EST PAS DEMANDÉE, et c'est une règle, pas un oubli : l'écran ne l'affiche nulle
 * part (§8.8.5), et demander une colonne qu'aucune surface ne rend laisserait croire qu'elle sert.
 */
export const COLONNES_MESSAGE = `${COLONNES_LISTE}, to_addresses, cc_addresses, body_text, body_html, sent_at, suggested_card_id`

type LigneMessage = Database['public']['Tables']['mail_messages']['Row']

export type MessageListe = {
	readonly id: string
	/** Le workspace du message : la moitié de la clé d'un fil (docs/SPEC-cards.md §16.15.3). */
	readonly workspaceId: string
	/** La racine RFC 5322 du fil, calculée par `cleFil` — une définition, deux langages (§16.15.2). */
	readonly cleFil: string
	readonly cardId: string | null
	readonly classement: LigneMessage['classification']
	readonly objet: string
	readonly expediteur: string
	/** L'adresse SEULE — le libellé porte « Nom <adresse> », qu'un champ « À » ne saurait pas lire. */
	readonly expediteurAdresse: string
	readonly recuLe: string
}

export type PieceJointe = {
	readonly id: string
	readonly nom: string
	readonly type: string
	readonly taille: number
	readonly chemin: string
	readonly statutAnalyse: Database['public']['Tables']['mail_attachments']['Row']['av_status']
}

export type MessageComplet = MessageListe & {
	readonly destinataires: readonly string[]
	readonly copies: readonly string[]
	readonly corps: string
	/** Vrai lorsque le corps affiché a été RÉDUIT depuis du HTML (§18.4) : l'écran le dit. */
	readonly corpsReduitDepuisHtml: boolean
	readonly pieces: readonly PieceJointe[]
	/**
	 * L'affaire SUGGÉRÉE par la règle 3 du classement (docs/SPEC-contacts.md §8.1, §8.8).
	 *
	 * C'est un INDICE, jamais un fait : la colonne ne vit que sur un message non classé, et elle
	 * n'accorde aucun droit. Nulle lorsque la règle 3 ne s'est pas déclenchée — le cas ordinaire.
	 */
	readonly suggestionCardId: string | null
}

/** Objet de repli, jamais une chaîne vide : une ligne sans intitulé serait un trou dans la liste. */
export const OBJET_ABSENT = '(sans objet)'

const nomAffiche = (adresse: string, nom: string | null): string =>
	nom !== null && nom.trim() !== '' ? `${nom.trim()} <${adresse}>` : adresse

/** Projette une ligne de la base en une ligne de liste. */
export function projeterMessage(ligne: Pick<
	LigneMessage,
	| 'id'
	| 'workspace_id'
	| 'card_id'
	| 'classification'
	| 'subject'
	| 'from_address'
	| 'from_name'
	| 'received_at'
	| 'references_ids'
	| 'rfc822_message_id'
>): MessageListe {
	return {
		id: ligne.id,
		workspaceId: ligne.workspace_id,
		// LA CLÉ EST CALCULÉE ICI, UNE SEULE FOIS PAR MESSAGE : la recalculer à chaque rendu de
		// ligne exposerait deux définitions au même endroit, et le §16.15.2 n'en veut qu'une.
		cleFil: cleFil(ligne.references_ids, ligne.rfc822_message_id),
		cardId: ligne.card_id,
		classement: ligne.classification,
		objet: ligne.subject !== null && ligne.subject.trim() !== '' ? ligne.subject : OBJET_ABSENT,
		expediteur: nomAffiche(ligne.from_address, ligne.from_name),
		expediteurAdresse: ligne.from_address,
		recuLe: ligne.received_at,
	}
}

// =================================================================================================
// La réduction du HTML en texte — §18.4
// =================================================================================================
//
// LE HTML D'UN EXPÉDITEUR N'EST JAMAIS INJECTÉ DANS LE DOM, et ce n'est pas une limitation
// temporaire : ce serait lui accorder l'exécution de scripts, le chargement d'images distantes —
// donc le pistage à l'ouverture — et la réécriture de l'écran autour de son propre message.
//
// LA RÉDUCTION N'EST PAS UN ASSAINISSEMENT. Elle ne prétend pas rendre du HTML sûr ; elle le
// remplace par du texte. La différence est essentielle : un assainisseur qui laisse passer une
// balise a un défaut, une réduction qui laisse passer une balise produit du texte inesthétique.

const ENTITES: ReadonlyArray<readonly [RegExp, string]> = [
	[/&nbsp;/gi, ' '],
	[/&amp;/gi, '&'],
	[/&lt;/gi, '<'],
	[/&gt;/gi, '>'],
	[/&quot;/gi, '"'],
	[/&#0*39;|&apos;/gi, "'"],
]

/**
 * Les deux retraits qui portent la garantie du §18.4, NOMMÉS plutôt qu'écrits en ligne.
 *
 * Ce ne sont pas des constantes de confort : un harnais doit pouvoir les neutraliser une par une
 * pour vérifier que la preuve les voit tomber. Une expression noyée dans une chaîne d'appels ne
 * se dégrade pas proprement, et une dégradation qui ne s'applique pas rend un contrôle vert pour
 * la mauvaise raison.
 */
const SCRIPTS_ET_STYLES = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi
const BALISES = /<[^>]+>/g

/**
 * Réduit un corps HTML en texte lisible.
 *
 * Les contenus de `<script>` et `<style>` sont retirés **avec leur balise** : les laisser
 * produirait du code source au milieu d'un courrier. Les balises de bloc deviennent des retours à
 * la ligne, faute de quoi un message entier arriverait sur une seule ligne.
 */
export function reduireHtmlEnTexte(html: string): string {
	let texte = html
		.replace(SCRIPTS_ET_STYLES, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, '\n')
		.replace(BALISES, '')
	for (const [motif, remplacement] of ENTITES) texte = texte.replace(motif, remplacement)
	return texte
		.split('\n')
		.map((ligne) => ligne.replace(/[ \t ]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/**
 * Le corps à afficher, et d'où il vient.
 *
 * `body_text` est préféré **quand il existe et n'est pas vide** : c'est le texte que l'expéditeur a
 * lui-même composé, et le réduire depuis le HTML donnerait un résultat moins fidèle.
 */
export function corpsAffichable(
	texte: string | null,
	html: string | null,
): { readonly corps: string; readonly reduitDepuisHtml: boolean } {
	if (texte !== null && texte.trim() !== '') return { corps: texte.trim(), reduitDepuisHtml: false }
	if (html !== null && html.trim() !== '') {
		return { corps: reduireHtmlEnTexte(html), reduitDepuisHtml: true }
	}
	return { corps: '', reduitDepuisHtml: false }
}

// =================================================================================================
// L'arborescence — §18.3
// =================================================================================================

export type NoeudCard = {
	readonly id: string
	readonly titre: string
	readonly nombre: number
}

export type NoeudChannel = {
	readonly id: string
	readonly nom: string
	readonly nombre: number
	readonly cards: readonly NoeudCard[]
}

export type NoeudTrack = {
	readonly id: string
	readonly nom: string
	readonly nombre: number
	readonly channels: readonly NoeudChannel[]
}

export type ArbreInbox = {
	readonly nonClasses: number
	readonly tracks: readonly NoeudTrack[]
}

type LigneArbre = Database['public']['Functions']['inbox_arborescence']['Returns'][number]

/**
 * Construit l'arbre depuis les lignes plates rendues par la base.
 *
 * LES CUMULS SONT CALCULÉS ICI, ET NON DEMANDÉS À LA BASE : un track affiche la somme de ses
 * channels, un channel celle de ses cards. Les demander séparément multiplierait les agrégats pour
 * une addition que le client sait faire sur des données qu'il tient déjà.
 *
 * L'ORDRE VIENT DE LA BASE et n'est pas retrié ici : la fonction ordonne par nom de track, de
 * channel puis de card, et refaire ce tri côté client ferait diverger deux définitions du même
 * ordre.
 */
export function construireArbre(lignes: readonly LigneArbre[]): ArbreInbox {
	let nonClasses = 0
	const tracks: Array<{ id: string; nom: string; nombre: number; channels: NoeudChannel[] }> = []

	for (const ligne of lignes) {
		if (ligne.card_id === null || ligne.channel_id === null || ligne.track_id === null) {
			nonClasses = Number(ligne.nombre)
			continue
		}
		const nombre = Number(ligne.nombre)
		let track = tracks.find((candidat) => candidat.id === ligne.track_id)
		if (track === undefined) {
			track = { id: ligne.track_id, nom: ligne.track_name ?? '', nombre: 0, channels: [] }
			tracks.push(track)
		}
		track.nombre += nombre
		let channel = track.channels.find((candidat) => candidat.id === ligne.channel_id) as
			| { id: string; nom: string; nombre: number; cards: NoeudCard[] }
			| undefined
		if (channel === undefined) {
			channel = { id: ligne.channel_id, nom: ligne.channel_name ?? '', nombre: 0, cards: [] }
			track.channels.push(channel as NoeudChannel)
		}
		channel.nombre += nombre
		channel.cards.push({ id: ligne.card_id, titre: ligne.card_title ?? '', nombre })
	}

	return { nonClasses, tracks }
}

/** Ce que le premier panneau désigne. `null` : rien n'est encore choisi, et c'est un état normal. */
export type Selection = { readonly genre: 'non-classes' } | { readonly genre: 'card'; readonly cardId: string }

export const MEME_SELECTION = (a: Selection | null, b: Selection | null): boolean => {
	if (a === null || b === null) return a === b
	if (a.genre !== b.genre) return false
	return a.genre !== 'card' || b.genre !== 'card' || a.cardId === b.cardId
}

// =================================================================================================
// Les lectures
// =================================================================================================

/**
 * Nombre maximal de messages rapportés par la liste.
 *
 * BORNE EXPLICITE PLUTÔT QUE LIMITE IMPLICITE : PostgREST en impose déjà une, et s'y fier laisserait
 * l'écran dépendre d'une configuration de serveur. L'écran DIT quand il tronque (`CLAUDE.md` §21).
 */
export const MESSAGES_PAR_PAGE = 50

export type PageMessages = {
	readonly messages: readonly MessageListe[]
	/** Vrai lorsque la page est pleine : d'autres messages existent, et l'écran le dit. */
	readonly tronquee: boolean
}

/**
 * Le dossier où un message se trouve — l'amorce du paramètre `?message=` (§15).
 *
 * @spec CRM-065 (docs/BACKLOG.md) — sous-tranche 2c : l'inbox adressable
 * @spec docs/SPEC-recherche.md §15 (ce que 2c livre), M16 (un message porte son affaire quand il
 *       est classé, et rien quand il ne l'est pas)
 *
 * ELLE NE LIT QUE DEUX COLONNES, et jamais le message entier : l'écran le relira de toute façon par
 * `useMessage` une fois la sélection posée. Demander ici le corps et les adresses ferait rapporter
 * deux fois le même courrier pour n'en employer qu'un identifiant.
 *
 * UN IDENTIFIANT INCONNU, UN IDENTIFIANT MAL FORMÉ ET UN MESSAGE QUE LA RLS FERME RENDENT TOUS
 * `null`, ET C'EST LA RÈGLE DE DISCRÉTION (docs/SPEC-permissions-rls.md §7) : un refus ne se
 * distingue pas d'une absence. L'appelant ouvre alors l'inbox sans sélection, comme si le paramètre
 * n'avait pas été écrit — jamais une erreur, qui apprendrait à l'utilisateur qu'un message existe
 * là où il n'a pas le droit de le savoir.
 *
 * L'ERREUR DE TRANSPORT REND `null` ELLE AUSSI, et ce n'est pas un `catch` vide : la valeur est la
 * même que celle d'une absence parce que la CONSÉQUENCE est la même — on arrive sur sa boîte. Un
 * bandeau d'erreur pour une amorce que l'utilisateur n'a pas demandée serait un bruit, et l'écran
 * porte déjà les siens pour l'arbre, la liste et le message.
 */
export async function lireDossierDuMessage(
	client: ClientCrm | null,
	id: string,
): Promise<Selection | null> {
	if (client === null) return null
	try {
		const reponse = await client.from('mail_messages').select('id, card_id').eq('id', id).limit(1)
		if (reponse.error !== null) return null
		const ligne = reponse.data[0]
		if (ligne === undefined) return null
		// M16 : `card_id` est nul tant que le message n'est pas classé, et le seed porte les deux cas.
		// Une amorce qui ne vaudrait que pour les messages classés laisserait la moitié de la famille
		// `message` de la palette sans dossier.
		return ligne.card_id === null
			? { genre: 'non-classes' }
			: { genre: 'card', cardId: ligne.card_id }
	} catch {
		return null
	}
}

/** Lit l'arborescence des dossiers, avec les compteurs de l'appelant. */
export async function lireArborescence(client: ClientCrm | null): Promise<EtatAsync<ArbreInbox>> {
	if (client === null) return enErreur(CONFIGURATION_ABSENTE)
	try {
		const reponse = await client.rpc('inbox_arborescence')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(construireArbre(reponse.data ?? []))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Lit les messages d'un dossier, du plus récent au plus ancien. */
export async function lireMessages(
	client: ClientCrm | null,
	selection: Selection,
): Promise<EtatAsync<PageMessages>> {
	if (client === null) return enErreur(CONFIGURATION_ABSENTE)
	try {
		const base = client.from('mail_messages').select(COLONNES_LISTE)
		const filtree =
			selection.genre === 'non-classes' ? base.is('card_id', null) : base.eq('card_id', selection.cardId)
		// L'ordre est TOTAL, terminé par `id` : deux messages reçus dans la même milliseconde
		// suffisent à rendre l'affichage instable d'un rechargement à l'autre (décision 185).
		const reponse = await filtree
			.order('received_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(MESSAGES_PAR_PAGE)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const messages = reponse.data.map(projeterMessage)
		return pret({ messages, tronquee: messages.length === MESSAGES_PAR_PAGE })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Lit un message et ses pièces jointes. */
export async function lireMessage(client: ClientCrm | null, id: string): Promise<EtatAsync<MessageComplet>> {
	if (client === null) return enErreur(CONFIGURATION_ABSENTE)
	try {
		const reponse = await client.from('mail_messages').select(COLONNES_MESSAGE).eq('id', id).limit(1)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const ligne = reponse.data[0]
		// AUCUNE LIGNE N'EST UN REFUS DÉJÀ APPLIQUÉ, non une erreur (docs/SPEC-webapp.md §6.3) :
		// la RLS rend `200` et zéro ligne. L'écran doit montrer un vide, pas une panne.
		if (ligne === undefined) return enErreur({ nature: 'forbidden', detail: 'message_invisible' })

		const pieces = await client
			.from('mail_attachments')
			.select('id, filename, mime_type, size_bytes, storage_path, av_status')
			.eq('message_id', id)
			.order('filename')
		if (pieces.error !== null) return enErreur(classerErreur(pieces.status, pieces.error.message))

		const { corps, reduitDepuisHtml } = corpsAffichable(ligne.body_text, ligne.body_html)
		return pret({
			...projeterMessage(ligne),
			destinataires: ligne.to_addresses,
			copies: ligne.cc_addresses,
			corps,
			corpsReduitDepuisHtml: reduitDepuisHtml,
			suggestionCardId: ligne.suggested_card_id,
			pieces: pieces.data.map((piece) => ({
				id: piece.id,
				nom: piece.filename,
				type: piece.mime_type,
				taille: piece.size_bytes,
				chemin: piece.storage_path,
				statutAnalyse: piece.av_status,
			})),
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les messages classés dans une card, par identifiant — pour la timeline (§18.6).
 *
 * Un événement `mail_received` porte un `message_id` dans sa charge utile ; la timeline y adjoint
 * l'objet et l'expéditeur. Un message absent de cette table — parce qu'il n'est pas lisible — laisse
 * l'événement s'afficher sans détail : la mémoire ne ment pas, elle se tait.
 */
export async function lireMessagesDeCard(
	client: ClientCrm | null,
	idCard: string,
): Promise<ReadonlyMap<string, MessageListe>> {
	if (client === null) return new Map()
	try {
		const reponse = await client.from('mail_messages').select(COLONNES_LISTE).eq('card_id', idCard)
		if (reponse.error !== null) return new Map()
		return new Map(reponse.data.map((ligne) => [ligne.id, projeterMessage(ligne)]))
	} catch {
		return new Map()
	}
}

// =================================================================================================
// Le classement, et ses refus
// =================================================================================================

export type NatureRefusClassement =
	/** `42501` : l'un des deux droits manque — voir le message, ou écrire dans la card (§18.2). */
	| 'forbidden'
	/** `23514` `card_not_available` : la card est archivée, en corbeille, ou d'un autre workspace. */
	| 'card_indisponible'
	| 'network'
	| 'unknown'

export type RefusClassement = { readonly nature: NatureRefusClassement; readonly detail: string }

/**
 * Classe le refus d'un classement.
 *
 * Les deux refus de droit — message invisible et card non modifiable — partagent volontairement le
 * même code et le même message : les distinguer renseignerait l'appelant sur l'existence d'un
 * message qu'il n'a pas le droit de voir (`docs/SPEC-permissions-rls.md` §7).
 */
export function classerRefusClassement(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusClassement {
	if (code === '23514') return { nature: 'card_indisponible', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/** Classe un message dans une card. Rend `null` en cas de succès, le refus sinon. */
export async function classerMessage(
	client: ClientCrm | null,
	idMessage: string,
	idCard: string,
): Promise<RefusClassement | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.rpc('classify_message', {
			p_message_id: idMessage,
			p_card_id: idCard,
		})
		if (reponse.error !== null) {
			return classerRefusClassement(reponse.status, reponse.error.code, reponse.error.message)
		}
		return null
	} catch (cause) {
		return classerRefusClassement(undefined, undefined, cause instanceof Error ? cause.message : String(cause))
	}
}

/**
 * Une URL de téléchargement, valable quelques minutes.
 *
 * ELLE N'EST DEMANDÉE QUE POUR UNE PIÈCE `clean`, et le serveur refuserait les autres de toute
 * façon (§18.5). L'écran n'affiche pas de bouton grisé : un bouton qui promet ce que le serveur
 * refusera est pire qu'un bouton absent (docs/DESIGN_SYSTEM.md §5.4).
 */
export const VALIDITE_LIEN_SECONDES = 300

export async function urlPieceJointe(client: ClientCrm | null, chemin: string): Promise<string | null> {
	if (client === null) return null
	try {
		const reponse = await client.storage
			.from('mail-attachments')
			.createSignedUrl(chemin, VALIDITE_LIEN_SECONDES)
		if (reponse.error !== null || reponse.data === null) return null
		return reponse.data.signedUrl
	} catch {
		return null
	}
}

// =================================================================================================
// Les hooks — même contrat de relecture que le fil de commentaires (CRM-043)
// =================================================================================================

type Relecture<T> = {
	readonly etat: EtatAsync<T>
	readonly recharger: () => void
	readonly reprendre: () => void
}

/**
 * Charge une valeur et sait la relire.
 *
 * LE RANG EST PRIS PAR LECTURE, ET NON PAR ABONNEMENT : deux lectures lancées coup sur coup
 * peuvent revenir dans le désordre, et la plus ancienne écraserait alors la plus récente — défaut
 * mesuré sur le fil de commentaires, où un commentaire supprimé réapparaissait une fois sur trois.
 *
 * L'ÉTAT DE CHARGEMENT N'EST POSÉ QUE S'IL N'Y A RIEN À MONTRER : une relecture qui viderait
 * l'écran le temps de sa réponse ferait clignoter la liste à chaque classement.
 */
function useLecture<T>(charger: () => Promise<EtatAsync<T>>, cles: readonly unknown[]): Relecture<T> {
	const [etat, setEtat] = useState<EtatAsync<T>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)
	const relecture = useRef<() => void>(() => {})
	const chargerRef = useRef(charger)
	chargerRef.current = charger

	useEffect(() => {
		++courant.current
		setEtat(enChargement)
		const lire = () => {
			const rang = ++courant.current
			setEtat((precedent) => (precedent.statut === 'pret' ? precedent : enChargement()))
			void (async () => {
				const resultat = await chargerRef.current()
				if (rang !== courant.current) return
				setEtat(resultat)
			})()
		}
		relecture.current = lire
		lire()
		return () => {
			++courant.current
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...cles, tentative])

	const recharger = useCallback(() => {
		relecture.current()
	}, [])
	const reprendre = useCallback(() => {
		setTentative((precedent) => precedent + 1)
	}, [])
	return { etat, recharger, reprendre }
}

export function useArborescence(client: ClientCrm | null): Relecture<ArbreInbox> {
	return useLecture(() => lireArborescence(client), [client])
}

export function useMessages(client: ClientCrm | null, selection: Selection | null): Relecture<PageMessages> {
	const cle = selection === null ? '' : selection.genre === 'card' ? selection.cardId : 'non-classes'
	return useLecture(
		async () => (selection === null ? pret({ messages: [], tronquee: false }) : lireMessages(client, selection)),
		[client, cle],
	)
}

export function useMessage(client: ClientCrm | null, id: string | null): Relecture<MessageComplet | null> {
	return useLecture(async () => (id === null ? pret(null) : lireMessage(client, id)), [client, id])
}

/**
 * Les fils endormis, relus par le MÊME contrat que le reste de l'écran (docs/SPEC-cards.md §16.15.3).
 *
 * UNE SEULE LECTURE PAR CHARGEMENT, non une par message : la table ne porte que les gestes, jamais
 * les messages, et son volume est celui des fils endormis.
 *
 * ELLE N'A PAS D'ÉTAT D'ERREUR PROPRE, et c'est délibéré : `lireFilsEndormis` rend une table vide
 * lorsqu'elle échoue, donc un fil dont l'état est inconnu s'affiche comme éveillé — l'état par
 * défaut, et le moins surprenant. Ajouter ici un second bandeau d'erreur ferait deux messages pour
 * une seule liste, alors que celle des messages porte déjà le sien.
 */
export function useFilsEndormis(client: ClientCrm | null): Relecture<FilsEndormis> {
	return useLecture(async () => pret(await lireFilsEndormis(client)), [client])
}

// =================================================================================================
// Les affaires proposées au classement
// =================================================================================================

export type CardClassable = {
	readonly id: string
	readonly titre: string
	readonly chemin: string
}

/**
 * Les affaires que l'écran propose comme destination.
 *
 * ELLE LIT LE DROIT DE **LECTURE**, ET LE DIT : la RLS de `cards` gouverne la lecture, et rien
 * dans PostgREST ne permet de demander « celles où je peux écrire » sans une fonction dédiée. Une
 * affaire proposée peut donc être refusée par `classify_message`, et ce refus est présenté tel
 * quel. Filtrer ici sur une supposition serait pire : l'écran cacherait des affaires légitimes
 * sans jamais l'avouer.
 *
 * Les affaires archivées et en corbeille sont exclues — la base les refuse (`card_not_available`),
 * et les proposer serait promettre un refus.
 */
export async function lireCardsClassables(client: ClientCrm | null): Promise<readonly CardClassable[]> {
	if (client === null) return []
	try {
		// TROIS LECTURES PLUTÔT QU'UNE JOINTURE EMBARQUÉE, ET C'EST MESURÉ : les clés étrangères de
		// `cards` vers `channels` et de `channels` vers `tracks` sont **composites**
		// (`cards_channel_id_workspace_id_fkey`), et l'imbrication PostgREST ne les résout pas par
		// le seul nom de colonne. Trois lectures de tables déjà cloisonnées par la RLS coûtent
		// moins qu'une jointure qui échouerait à l'exécution.
		const [cards, channels, tracks] = await Promise.all([
			client
				.from('cards')
				.select('id, title, channel_id')
				.is('archived_at', null)
				.is('deleted_at', null)
				.order('title')
				.limit(CARDS_CLASSABLES_MAX),
			client.from('channels').select('id, name, track_id'),
			client.from('tracks').select('id, name'),
		])
		if (cards.error !== null || channels.error !== null || tracks.error !== null) return []

		const nomChannel = new Map(channels.data.map((ligne) => [ligne.id, ligne]))
		const nomTrack = new Map(tracks.data.map((ligne) => [ligne.id, ligne.name]))
		return cards.data.map((ligne) => {
			const channel = nomChannel.get(ligne.channel_id)
			const track = channel === undefined ? undefined : nomTrack.get(channel.track_id)
			return {
				id: ligne.id,
				titre: ligne.title,
				chemin: [track, channel?.name].filter((morceau) => morceau !== undefined).join(' \u203a '),
			}
		})
	} catch {
		return []
	}
}

/**
 * Borne du sélecteur d'affaires.
 *
 * Une liste déroulante de plusieurs milliers d'entrées n'est plus un choix, c'est un labyrinthe.
 * La borne est explicite plutôt que laissée à PostgREST (`CLAUDE.md` §21) ; au-delà, c'est une
 * recherche qu'il faudra livrer, pas une liste plus longue.
 */
export const CARDS_CLASSABLES_MAX = 200

/**
 * L'affaire d'un message classé, et son adresse dans l'application.
 *
 * LA PILULE MÈNE QUELQUE PART (docs/DESIGN_SYSTEM.md §5.4), et l'adresse d'une card exige les
 * SLUGS de son track et de son channel — `/tracks/:track/:channel/cards/:id`. Ni la liste ni
 * l'arborescence ne les portent : elles nomment, elles n'adressent pas.
 *
 * Rend `null` lorsque la card n'est pas lisible : la pilule disparaît alors, plutôt que de mener à
 * un écran « affaire introuvable » que l'utilisateur croirait cassé.
 */
export async function lireCheminCard(
	client: ClientCrm | null,
	idCard: string,
): Promise<{ readonly titre: string; readonly adresse: string } | null> {
	if (client === null) return null
	try {
		const card = await client.from('cards').select('id, title, channel_id').eq('id', idCard).limit(1)
		const ligneCard = card.error === null ? card.data[0] : undefined
		if (ligneCard === undefined) return null
		const channel = await client
			.from('channels')
			.select('slug, track_id')
			.eq('id', ligneCard.channel_id)
			.limit(1)
		const ligneChannel = channel.error === null ? channel.data[0] : undefined
		if (ligneChannel === undefined) return null
		const track = await client.from('tracks').select('slug').eq('id', ligneChannel.track_id).limit(1)
		const ligneTrack = track.error === null ? track.data[0] : undefined
		if (ligneTrack === undefined) return null
		return {
			titre: ligneCard.title,
			adresse: `/tracks/${ligneTrack.slug}/${ligneChannel.slug}/cards/${idCard}`,
		}
	} catch {
		return null
	}
}
