// @spec CRM-079 (docs/BACKLOG.md) — guide de démarrage : la mesure des étapes
// @spec docs/SPEC-onboarding.md §2 (la progression est une mesure, jamais un drapeau),
//       §3 (les étapes et leurs filtres), §3.1 (ce qui a été mesuré), §3.2 (des comptages
//       indépendants, une seule décision), §6.2 (les trois états d'une étape)
// @spec CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 (six étapes, le workflow
//       avant le channel), §10.3 (le geste « Créer le workflow de départ », et le signal qui fait se
//       relire les écrans ouverts) ; docs/SPEC-workflow-engine.md §7 quater ; docs/JOURNAL.md décisions
//       606 et 607
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/DESIGN_SYSTEM.md §5.17
// @spec CRM-095 (docs/BACKLOG.md) tranche T3 — docs/SPEC-onboarding.md §10.7, docs/SPEC-cards.md §18.4 :
//       l'étape « affaire » mène au board du premier channel lisible et vivant, lu avec chaque mesure
// @spec CRM-129 (docs/BACKLOG.md) — docs/SPEC-onboarding.md §4.2 (précision du 2026-11-06), décision 859 : le compte
//       de l'étape « channel » décide de ce que l'accueil dit (`presenceChannels`)
// @spec CRM-131 (docs/BACKLOG.md) — docs/SPEC-channels.md §5.5, décisions 868 et 876 (INC-350) : la présence des channels
//       lue à part pour la barre d'onglets hors d'un track, par une ligne au plus et sans comptage du guide
//       (`lirePresenceChannels`, `useMesureChannels`) ; `presenceMesuree` lit le compte de l'accueil
// @spec CRM-001 (docs/BACKLOG.md) tranche INC-299, docs/DAT.md §3.5 bis (décision 700) — un compte est un `GET … limit=0`, jamais un `HEAD`
// @spec CRM-157 (docs/BACKLOG.md) — tranche T3 : la messagerie en trois étapes, mesurées dans l'ESPACE COURANT — la boîte
//       système testée, le domaine des adresses d'affaire, l'identité d'envoi de la personne — et ce que l'étape du domaine
//       doit savoir pour mener au réglage : l'identifiant court de l'espace et le drapeau du super-administrateur
//       (docs/SPEC-onboarding.md §11 ; docs/DESIGN_SYSTEM.md §5.110 ; décisions 951 et 953)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Chaque table est comptée sous la politique qui la
// régit déjà — `tracks` (CRM-020), `channels` (CRM-021), `cards` (CRM-040), `workspaces` (CRM-022),
// `mail_inbound_accounts` (CRM-052). Rien n'est recalculé ni élargi ici.
//
// Conséquence MESURÉE le 2026-08-15 et assumée (docs/SPEC-onboarding.md §3.1) : un comptage n'est
// pas un inventaire, c'est ce que l'appelant peut voir. Le `viewer` seedé compte 5 channels et
// 9 affaires là où la base en porte 6 et 14. L'écran écrit donc ce que l'appelant voit, jamais ce
// qui existe.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'
import { LIMITE_COMPTE, OPTIONS_COMPTE } from './compter'
import { lireEstSuperadmin } from './plateforme'

/**
 * Les tables interrogeables, telles que le SCHÉMA les déclare — jamais une chaîne libre. Une table
 * inexistante glissée dans `FILTRES_ETAPES_DEMARRAGE` ne compile pas : c'est la garde que
 * `docs/SPEC-webapp.md` §14.1 attend des types générés par `CRM-006`.
 */
type TableLisible = keyof Database['public']['Tables']

/**
 * Les six étapes, dans l'ordre où elles se lisent (docs/SPEC-onboarding.md §3, §10.1). Le workflow
 * précède le channel depuis `CRM-094` : un channel en exige un, et un espace neuf n'en a aucun.
 */
export const CLES_ETAPES_DEMARRAGE = [
	'espace',
	'track',
	'workflow',
	'channel',
	'affaire',
	// `CRM-157` (§11.1) : la messagerie en trois étapes, à la place de « Raccorder une boîte de réception ».
	'boite-systeme',
	'domaine',
	'identite',
] as const

export type CleEtapeDemarrage = (typeof CLES_ETAPES_DEMARRAGE)[number]

/**
 * Une étape mesurée. `compte` est ce que l'appelant voit ; l'étape est accomplie dès la première
 * ligne. On conserve le compte plutôt qu'un booléen : c'est la donnée mesurée, et un booléen
 * calculé ici obligerait à remesurer pour répondre à « combien ».
 */
export type EtapeDemarrage = {
	readonly cle: CleEtapeDemarrage
	readonly compte: number
}

export type ProgressionDemarrage = {
	/** Un état par étape : quatre mesures abouties et une refusée doivent laisser lire les quatre. */
	readonly etapes: readonly EtatAsync<EtapeDemarrage>[]
	/**
	 * L'adresse du board où créer la première affaire (`CRM-095`, docs/SPEC-onboarding.md §10.7) : celui
	 * du premier channel lisible et vivant — premier track par position, puis premier channel. `null`
	 * sans channel, ou quand la lecture échoue : l'étape mène alors à l'arborescence, comme avant.
	 */
	readonly boardAffaire: string | null
	/** `CRM-157` (§11.1) : l'identifiant court de l'espace courant, pour le lien du domaine ; `null` sans lecture. */
	readonly slugEspace: string | null
	/** `CRM-157` : la base dit-elle la personne super-administratrice ? Une aide d'affichage, jamais un droit. */
	readonly superadmin: boolean
}

/**
 * Ce que la mesure des trois étapes de la messagerie doit savoir (`CRM-157`, §11.1) : l'espace courant — celui du
 * sélecteur d'espace — et la personne. Sans l'un ou l'autre, ces étapes ne posent aucune question : il n'y a rien à régler.
 */
export type ContexteMesure = { readonly idEspace: string | null; readonly idUtilisateur: string | null }

const SANS_CONTEXTE: ContexteMesure = { idEspace: null, idUtilisateur: null }

/**
 * Les filtres de chaque comptage, **repris des lectures existantes** et non réinventés :
 * `webapp/src/lib/tracks.ts` pose déjà qu'un track archivé est masqué et qu'un track en corbeille
 * est retiré. Une étape qui compterait un objet en corbeille se dirait accomplie par un objet que
 * l'écran ne montre nulle part (docs/SPEC-onboarding.md §3).
 *
 * Exportée pour que le test unitaire vérifie la requête réellement émise, comme `COLONNES_TRACK`.
 */
export type FiltreEtape = {
	readonly table: TableLisible
	readonly nuls: readonly string[]
	/** `CRM-157` : des colonnes non nulles (le domaine). */
	readonly nonNuls?: readonly string[]
	/** `CRM-157` : des égalités fixes (`status = 'ok'`). */
	readonly egalites?: Readonly<Record<string, string>>
	/** `CRM-157` : la colonne égale à l'espace courant. */
	readonly espace?: string
	/** `CRM-157` : la colonne égale à la personne. */
	readonly proprietaire?: string
}

export const FILTRES_ETAPES_DEMARRAGE: Readonly<Record<CleEtapeDemarrage, FiltreEtape>> = {
	espace: { table: 'workspaces', nuls: [] },
	track: { table: 'tracks', nuls: ['archived_at', 'deleted_at'] },
	// Un workflow s'archive et n'a pas de corbeille ; archivé, aucun channel ne peut plus le choisir.
	workflow: { table: 'workflows', nuls: ['archived_at'] },
	channel: { table: 'channels', nuls: ['archived_at', 'deleted_at'] },
	affaire: { table: 'cards', nuls: ['deleted_at'] },
	// `CRM-157` (§11.1) : la boîte SYSTÈME (sans propriétaire) de l'espace courant, testée avec succès.
	'boite-systeme': { table: 'mail_inbound_accounts', nuls: ['owner_id'], egalites: { status: 'ok' }, espace: 'workspace_id' },
	// L'espace courant a un domaine d'adresses d'affaire.
	domaine: { table: 'workspaces', nuls: [], nonNuls: ['inbound_domain'], espace: 'id' },
	// L'identité d'envoi DE LA PERSONNE dans l'espace courant, testée avec succès (décision 953).
	identite: {
		table: 'mail_outbound_identities',
		nuls: [],
		egalites: { status: 'ok' },
		espace: 'workspace_id',
		proprietaire: 'owner_id',
	},
}

/**
 * Compte une étape, par `compter.ts` : l'écran affiche un état, pas une liste — rapporter les lignes
 * ferait transiter une charge utile que rien ne rend.
 *
 * Une réponse aboutie dont le `count` est absent est un **contrat rompu**, pas une absence : elle
 * est rendue en erreur, exactement comme `lireCompteursFileSortante` (`mail-etat.ts`). Un zéro
 * inventé ici afficherait « à faire » sur une étape peut-être accomplie — la valeur par défaut
 * trompeuse que `CLAUDE.md` §18 interdit.
 */
export async function mesurerEtape(
	client: ClientCrm,
	cle: CleEtapeDemarrage,
	contexte: ContexteMesure = SANS_CONTEXTE,
): Promise<EtatAsync<EtapeDemarrage>> {
	const filtre = FILTRES_ETAPES_DEMARRAGE[cle]
	// `CRM-157` (§11.1) : SANS ESPACE COURANT OU SANS PERSONNE, aucune question — il n'y a rien à régler, l'étape est à
	// faire. Ce zéro n'est pas inventé : aucun espace, aucune boîte, aucun domaine.
	if ((filtre.espace !== undefined && contexte.idEspace === null) || (filtre.proprietaire !== undefined && contexte.idUtilisateur === null)) {
		return pret({ cle, compte: 0 })
	}
	try {
		let requete = client.from(filtre.table).select('id', OPTIONS_COMPTE)
		for (const colonne of filtre.nuls) {
			requete = requete.is(colonne, null)
		}
		for (const colonne of filtre.nonNuls ?? []) {
			requete = requete.not(colonne, 'is', null)
		}
		for (const [colonne, valeur] of Object.entries(filtre.egalites ?? {})) {
			requete = requete.eq(colonne, valeur)
		}
		if (filtre.espace !== undefined && contexte.idEspace !== null) requete = requete.eq(filtre.espace, contexte.idEspace)
		if (filtre.proprietaire !== undefined && contexte.idUtilisateur !== null) {
			requete = requete.eq(filtre.proprietaire, contexte.idUtilisateur)
		}
		const reponse = await requete.limit(LIMITE_COMPTE)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		if (reponse.count === null) {
			return enErreur(classerErreur(undefined, 'count absent alors que la réponse a abouti'))
		}
		return pret({ cle, compte: reponse.count })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les mesures, émises **en parallèle** et rendues indépendantes (docs/SPEC-onboarding.md §3.2).
 *
 * Aucune n'est conditionnée à la précédente : subordonner la mesure d'un channel à l'existence d'un
 * track ferait passer un refus de lecture pour une absence, et l'écran n'aurait plus rien à dire de
 * l'étape qu'il n'a pas mesurée.
 */
export async function mesurerDemarrage(
	client: ClientCrm,
	contexte: ContexteMesure = SANS_CONTEXTE,
): Promise<ProgressionDemarrage> {
	const [base, messagerie] = await Promise.all([mesurerBase(client), mesurerMessagerie(client, contexte)])
	return { etapes: [...base.etapes, ...messagerie.etapes], boardAffaire: base.boardAffaire, slugEspace: messagerie.slugEspace, superadmin: base.superadmin }
}

/** `CRM-157` : les étapes qui ne dépendent pas de l'espace courant — de « espace » à « affaire ». */
export const CLES_BASE: readonly CleEtapeDemarrage[] = CLES_ETAPES_DEMARRAGE.filter(
	(cle) => FILTRES_ETAPES_DEMARRAGE[cle].espace === undefined,
)
/** `CRM-157` : les trois étapes de la messagerie, mesurées dans l'espace courant (§11.1). */
export const CLES_MESSAGERIE: readonly CleEtapeDemarrage[] = CLES_ETAPES_DEMARRAGE.filter(
	(cle) => FILTRES_ETAPES_DEMARRAGE[cle].espace !== undefined,
)

type MesureBase = {
	readonly etapes: readonly EtatAsync<EtapeDemarrage>[]
	readonly boardAffaire: string | null
	readonly superadmin: boolean
}
type MesureMessagerie = { readonly etapes: readonly EtatAsync<EtapeDemarrage>[]; readonly slugEspace: string | null }

/**
 * `CRM-157` : la mesure se fait en DEUX moitiés. L'arrivée de l'espace courant ne refait que la seconde : sans cela, les
 * cinq premiers comptages repartaient une seconde fois à chaque chargement (vu par `e2e/ui/demarrage.spec.ts`).
 */
export async function mesurerBase(client: ClientCrm): Promise<MesureBase> {
	const [etapes, boardAffaire, superadmin] = await Promise.all([
		Promise.all(CLES_BASE.map((cle) => mesurerEtape(client, cle))),
		lireBoardAffaire(client),
		lireEstSuperadmin(client).then((etat) => etat.statut === 'pret' && etat.donnees),
	])
	return { etapes, boardAffaire, superadmin }
}

export async function mesurerMessagerie(client: ClientCrm, contexte: ContexteMesure): Promise<MesureMessagerie> {
	const [etapes, slugEspace] = await Promise.all([
		Promise.all(CLES_MESSAGERIE.map((cle) => mesurerEtape(client, cle, contexte))),
		lireSlugEspace(client, contexte.idEspace),
	])
	return { etapes, slugEspace }
}

/** L'identifiant court de l'espace courant (`CRM-157`) : un échec rend `null`, et l'étape garde son texte sans lien. */
export async function lireSlugEspace(client: ClientCrm, idEspace: string | null): Promise<string | null> {
	if (idEspace === null) return null
	try {
		const reponse = await client.from('workspaces').select('slug').eq('id', idEspace).limit(1)
		if (reponse.error !== null) return null
		return reponse.data?.[0]?.slug ?? null
	} catch {
		return null
	}
}

/**
 * Les colonnes de la lecture de la destination : le slug du channel et celui de son track.
 * `!inner` : un channel dont le track n'est pas lisible — ou pas vivant — n'est pas une destination.
 *
 * `position` ET `name` DU TRACK SONT DEMANDÉS, ET CE N'EST PAS POUR LES RENDRE. MESURÉ contre la pile
 * réelle le 2026-09-29 par `e2e/ui/nouvelle-affaire.spec.ts` : PostgREST ne trie sur une colonne d'une
 * ressource embarquée que si elle est sélectionnée — sans elles, `order=tracks(position)` rend `400`,
 * « column channels_tracks_1.position does not exist », et l'étape retombait en silence sur
 * l'arborescence.
 */
export const COLONNES_BOARD_AFFAIRE = 'slug, tracks!inner(slug, position, name)'

/**
 * Le board du premier channel lisible et vivant (`CRM-095`, docs/SPEC-onboarding.md §10.7).
 *
 * UNE SEULE LIGNE, DANS L'ORDRE DE LA BARRE LATÉRALE PUIS DE LA BARRE D'ONGLETS : track par position puis
 * nom (`tracks.ts`), channel par position puis nom (`channels.ts`). La position d'un channel est
 * numérotée PAR TRACK (docs/DESIGN_SYSTEM.md §5.48 bis) : trier sur elle seule entrelacerait les tracks,
 * d'où le tri d'abord sur le track embarqué.
 *
 * Sous la RLS de l'appelant, comme les comptages : la destination est un channel qu'il VOIT. Un échec
 * n'est pas une erreur de l'étape — l'étape est mesurée par ailleurs —, il laisse le lien d'avant.
 */
export async function lireBoardAffaire(client: ClientCrm): Promise<string | null> {
	try {
		const reponse = await client
			.from('channels')
			.select(COLONNES_BOARD_AFFAIRE)
			.is('archived_at', null)
			.is('deleted_at', null)
			.is('tracks.archived_at', null)
			.is('tracks.deleted_at', null)
			.order('tracks(position)')
			.order('tracks(name)')
			.order('position')
			.order('name')
			.limit(1)
		if (reponse.error !== null) return null
		const premier = reponse.data?.[0]
		const slugTrack = premier?.tracks?.slug
		if (premier === undefined || typeof slugTrack !== 'string') return null
		return `/tracks/${slugTrack}/${premier.slug}`
	} catch {
		return null
	}
}

/** Une étape est accomplie dès la première ligne visible — docs/SPEC-onboarding.md §6.2. */
export function estAccomplie(etat: EtatAsync<EtapeDemarrage>): boolean {
	return etat.statut === 'pret' && etat.donnees.compte >= 1
}

/**
 * Le compte des étapes accomplies, et le total. Une étape en erreur n'est **pas** comptée comme
 * accomplie ni retirée du total : elle reste une étape du parcours, simplement non vérifiée.
 */
export function compterAccomplies(progression: ProgressionDemarrage): {
	readonly accomplies: number
	readonly total: number
} {
	return {
		accomplies: progression.etapes.filter(estAccomplie).length,
		total: progression.etapes.length,
	}
}

/**
 * Vrai lorsqu'il reste au moins une étape à faire — et donc que `/` doit rendre le guide plutôt que
 * son état vide (docs/SPEC-onboarding.md §4.2).
 *
 * Une étape **non mesurable** compte comme restant à faire : le guide ne peut pas se retirer en
 * affirmant un accomplissement qu'il n'a pas constaté.
 */
export function resteUneEtape(progression: ProgressionDemarrage): boolean {
	return progression.etapes.some((etat) => !estAccomplie(etat))
}

/**
 * Ce que l'accueil peut dire des channels lisibles (`CRM-129`, docs/SPEC-onboarding.md §4.2, décision 859).
 * La présence n'est pas une requête de plus : c'est le compte de l'étape « channel », déjà mesuré sous la
 * RLS de l'appelant. `inconnu` quand cette mesure a échoué : l'accueil ne prétend alors ni absence ni
 * présence.
 */
export type PresenceChannels = 'aucun' | 'present' | 'inconnu' | 'chargement'

export function presenceChannels(progression: ProgressionDemarrage): PresenceChannels {
	return presenceMesuree(progression.etapes[CLES_ETAPES_DEMARRAGE.indexOf('channel')])
}

/** La lecture d'une mesure de l'étape « channel » : celle de l'accueil (`CRM-129`). */
export function presenceMesuree(etat: EtatAsync<EtapeDemarrage> | undefined): PresenceChannels {
	if (etat === undefined || etat.statut === 'erreur') return 'inconnu'
	if (etat.statut === 'chargement') return 'chargement'
	return etat.donnees.compte >= 1 ? 'present' : 'aucun'
}

/**
 * La présence de channels lisibles, lue À PART de la progression du guide (`CRM-131`, docs/SPEC-channels.md §5.5,
 * décision 876) : la coquille en a besoin hors d'un track, où elle ne lit aucun channel.
 *
 * Ce N'EST PAS un comptage du guide (INC-350) : `CRM-094` (docs/SPEC-onboarding.md §10.2) n'en émet aucun pour qui ne
 * voit pas la pastille, et la barre se rend à tous les rôles. La lecture rapporte donc **au plus une ligne**, sans
 * `count=exact`, avec les filtres de l'étape « channel » (`FILTRES_ETAPES_DEMARRAGE.channel`) : une seule définition de
 * « channel vivant », sous la RLS de l'appelant.
 *
 * Une réponse aboutie sans données est un contrat rompu : « inconnu », jamais « aucun » (`CLAUDE.md` §18).
 */
export async function lirePresenceChannels(client: ClientCrm): Promise<PresenceChannels> {
	const filtre = FILTRES_ETAPES_DEMARRAGE.channel
	try {
		let requete = client.from(filtre.table).select('id')
		for (const colonne of filtre.nuls) {
			requete = requete.is(colonne, null)
		}
		const reponse = await requete.limit(1)
		if (reponse.error !== null || reponse.data === null) return 'inconnu'
		return reponse.data.length >= 1 ? 'present' : 'aucun'
	} catch {
		// Une panne réseau : la barre rend le texte neutre, qui ne prétend ni absence ni présence (§5.5).
		return 'inconnu'
	}
}

/**
 * La présence lue par `lirePresenceChannels`, pour la barre d'onglets hors d'un track.
 *
 * `client` nul : aucune lecture n'est émise (hors session, ou sur une route de track) et la présence reste
 * « chargement ». Elle est relue à chaque fois que `client` redevient non nul : à chaque entrée sur une route
 * transverse.
 */
export function useMesureChannels(client: ClientCrm | null): PresenceChannels {
	const [presence, setPresence] = useState<PresenceChannels>('chargement')
	useEffect(() => {
		if (client === null) {
			setPresence('chargement')
			return
		}
		let actif = true
		void lirePresenceChannels(client).then((lue) => {
			if (actif) setPresence(lue)
		})
		return () => {
			actif = false
		}
	}, [client])
	return presence
}

/** Vrai tant qu'une mesure est en vol : `/` rend alors les squelettes, jamais l'état vide (§4.2). */
export function mesureEnCours(progression: ProgressionDemarrage): boolean {
	return progression.etapes.some((etat) => etat.statut === 'chargement')
}

/** État initial : un chargement par étape. Il évite un rendu où `etapes` serait vide, donc « accompli ». */
export const PROGRESSION_INITIALE: ProgressionDemarrage = {
	etapes: CLES_ETAPES_DEMARRAGE.map(() => enChargement<EtapeDemarrage>()),
	boardAffaire: null,
	slugEspace: null,
	superadmin: false,
}

/**
 * Charge la progression et expose un rechargement **réel** : la reprise proposée par une ligne en
 * erreur relance toutes les mesures, elle ne recharge pas la page (docs/SPEC-webapp.md §7).
 *
 * Même garde que `useTracks` contre les réponses périmées : une réponse arrivée après le démontage
 * n'écrit pas, et une réponse plus ancienne n'écrase pas une plus récente.
 */
export function useDemarrage(
	client: ClientCrm | null,
	/** `CRM-157` : `null` tant que l'espace courant n'est pas lu — la messagerie reste alors en chargement (§11.1). */
	contexte: ContexteMesure | null = SANS_CONTEXTE,
): {
	readonly progression: ProgressionDemarrage
	readonly recharger: () => void
} {
	const [base, setBase] = useState<MesureBase | null>(null)
	const [messagerie, setMessagerie] = useState<MesureMessagerie | null>(null)
	const [tentative, setTentative] = useState(0)
	const courantBase = useRef(0)
	const courantMessagerie = useRef(0)
	const connu = contexte !== null
	const idEspace = contexte?.idEspace ?? null
	const idUtilisateur = contexte?.idUtilisateur ?? null

	useEffect(() => {
		if (client === null) return
		const rang = ++courantBase.current
		setBase(null)
		void mesurerBase(client).then((resultat) => {
			if (rang === courantBase.current) setBase(resultat)
		})
	}, [client, tentative])

	// `CRM-157` : l'espace courant et la personne ne refont que la seconde moitié ; inconnus, rien n'est affirmé.
	useEffect(() => {
		const rang = ++courantMessagerie.current
		setMessagerie(null)
		if (client === null || !connu) return
		void mesurerMessagerie(client, { idEspace, idUtilisateur }).then((resultat) => {
			if (rang === courantMessagerie.current) setMessagerie(resultat)
		})
	}, [client, tentative, connu, idEspace, idUtilisateur])

	// Une progression STABLE d'un rendu à l'autre : les écrans qui la gardent en mémoire (le guide flottant) la comparent.
	const progression = useMemo<ProgressionDemarrage>(
		() => ({
			etapes: [
				...(base?.etapes ?? CLES_BASE.map(() => enChargement<EtapeDemarrage>())),
				...(messagerie?.etapes ?? CLES_MESSAGERIE.map(() => enChargement<EtapeDemarrage>())),
			],
			boardAffaire: base?.boardAffaire ?? null,
			slugEspace: messagerie?.slugEspace ?? null,
			superadmin: base?.superadmin ?? false,
		}),
		[base, messagerie],
	)

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { progression, recharger }
}

// ---------------------------------------------------------------------------------------------
// Le workflow de départ — `CRM-094` (docs/SPEC-workflow-engine.md §7 quater)
// ---------------------------------------------------------------------------------------------

/**
 * L'issue du geste, et chacune se dit sur la ligne de l'étape (docs/SPEC-onboarding.md §10.3).
 *
 * Le refus est lu sur le `code` SQL, jamais sur une phrase — sauf la clé du nœud archivé, que seule
 * la phrase porte et que l'écran doit nommer pour dire QUOI restaurer.
 */
export type IssueWorkflowDepart =
	| { readonly ok: true }
	| { readonly ok: false; readonly raison: 'existant' }
	| { readonly ok: false; readonly raison: 'reserve' | 'panne' }
	| { readonly ok: false; readonly raison: 'noeud-archive'; readonly cle: string }

const MOTIF_NOEUD_ARCHIVE = /^noeud archive : ([a-z0-9-]+)$/

/**
 * L'événement d'interface émis quand la base porte un workflow que les écrans ouverts ignorent
 * peut-être (docs/SPEC-onboarding.md §10.3, « les écrans ouverts se relisent »).
 *
 * Le geste se fait depuis le panneau flottant, PAR-DESSUS l'écran courant — l'éditeur de workflows, le
 * catalogue, l'arborescence et son formulaire de channel. Ces écrans ont lu à leur montage : sans ce
 * signal, ils continueraient d'affirmer qu'aucun workflow n'existe sous l'étape qui vient de passer à
 * « Fait ». Chacun se relit lui-même, sans être remonté : une saisie en cours survit.
 */
export const EVENEMENT_WORKFLOW_DEPART = 'p2enjoy:workflow-de-depart'

/** Abonne un écran au signal ; `relire` doit être stable (`useCallback`), comme toute dépendance d'effet. */
export function useApresWorkflowDeDepart(relire: () => void): void {
	useEffect(() => {
		globalThis.addEventListener(EVENEMENT_WORKFLOW_DEPART, relire)
		return () => globalThis.removeEventListener(EVENEMENT_WORKFLOW_DEPART, relire)
	}, [relire])
}

/**
 * Pose le workflow de départ de l'espace. Ne lève jamais.
 *
 * Aucune règle n'est jugée ici : la base décide, et `SECURITY INVOKER` y fait jouer la RLS des tables
 * écrites (`CLAUDE.md` §10). Une panne n'est jamais présentée comme un succès (`CLAUDE.md` §18).
 *
 * Le signal part sur un succès ET sur `existant` : dans les deux cas, la base porte un workflow que
 * l'écran ouvert sous le panneau n'a peut-être pas lu — posé à l'instant, ou par un collègue.
 */
export async function creerWorkflowDeDepart(client: ClientCrm, idWorkspace: string): Promise<IssueWorkflowDepart> {
	const issue = await appelerWorkflowDeDepart(client, idWorkspace)
	if (issue.ok || issue.raison === 'existant') globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
	return issue
}

async function appelerWorkflowDeDepart(client: ClientCrm, idWorkspace: string): Promise<IssueWorkflowDepart> {
	try {
		const reponse = await client.rpc('creer_workflow_de_depart', { p_workspace: idWorkspace })
		if (reponse.error === null) return { ok: true }
		if (reponse.error.code === '42501') return { ok: false, raison: 'reserve' }
		if (reponse.error.code === 'P0001') {
			if (reponse.error.message === 'workflow existant') return { ok: false, raison: 'existant' }
			const archive = MOTIF_NOEUD_ARCHIVE.exec(reponse.error.message)
			if (archive?.[1] !== undefined) return { ok: false, raison: 'noeud-archive', cle: archive[1] }
		}
		return { ok: false, raison: 'panne' }
	} catch {
		return { ok: false, raison: 'panne' }
	}
}

