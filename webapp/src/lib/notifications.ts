// @spec CRM-064 (docs/BACKLOG.md) — tranche 3a : la surface de réception
// @spec docs/SPEC-notifications.md §24 (le modèle de lecture), §25 (le temps réel et ses deux
//       règles d'abonnement), §26.1 (le compteur), §26.2 (l'ordre), §26.3 (aucune copie),
//       §26.4 (le geste de lecture et ses trois issues), §26.5 (la borne), §26.7 (les états)
// @spec docs/SPEC-notifications.md §13.4 (la charge utile ne porte aucun contenu),
//       §14.4 (une notification survit au retrait de sa mention), §16.1 (la politique de lecture)
// @spec docs/DESIGN_SYSTEM.md §5.43 (la cloche et le panneau), §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec docs/JOURNAL.md décisions 195 (le temps réel mesuré), 201 (le flux déclenche la lecture,
//       il ne la remplace pas), 315 (le rang est pris par lecture)
//
// Ce module ne rend rien : il **lit, écrit et écoute**. La séparation est ce qui rend l'ordre de la
// boîte, l'appariement des trois cas de ligne, la borne de lecture et la classification des issues
// vérifiables **sans navigateur**.
//
// DEUX REQUÊTES, ET DEUX SEULEMENT (§24.1). Le `payload` n'est pas une clé étrangère — le §13.4
// refuse toute copie de contenu —, donc PostgREST ne peut pas embarquer le commentaire. La lecture
// groupée par `id=in.(…)` est la réponse la moins chère que la pile sache rendre, et **MESURÉ**
// (§21, M8) elle rapporte tous les commentaires cités d'une page en **une** requête, auteur
// embarqué. C'est la mesure qui a corrigé l'estimation « une lecture par notification affichée »
// du §13.4 : le coût réel est de deux requêtes pour la liste entière, non de `N + 1`.
//
// LE MODULE NE BIFURQUE JAMAIS SUR UN RÔLE (`CLAUDE.md` §10). La seule ligne qu'il rend est déjà
// celle de l'appelant : `notifications_lecture` exige `recipient_id = auth.uid()`. Sans session, la
// lecture rend `200` et zéro ligne — l'état vide ordinaire du §5.8, jamais un refus à mettre en
// scène.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import {
	BORNE_LISTE,
	COLONNES_COMMENTAIRE_MENTION,
	COLONNES_NOTIFICATION,
	filtreCanalNotifications,
	nomCanalNotifications,
} from './colonnes-notifications'
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'

export {
	BORNE_COMPTEUR,
	BORNE_LISTE,
	COLONNES_COMMENTAIRE_MENTION,
	COLONNES_NOTIFICATION,
	filtreCanalNotifications,
	formaterCompteur,
	nomCanalNotifications,
} from './colonnes-notifications'

/** Une notification telle que la requête 1 la rend, avant appariement. */
export type LigneNotificationLue = {
	readonly id: string
	readonly type: string
	readonly read_at: string | null
	readonly created_at: string
	readonly subject_card_id: string | null
	/**
	 * La charge utile, qui ne porte **que de quoi désigner** (§13.4). Elle est lue comme un objet
	 * d'inconnues plutôt que typée : c'est un `jsonb`, et le type généré ne dit rien de sa forme.
	 * Un `comment_id` absent ou mal formé ne doit pas faire échouer la lecture, il doit produire la
	 * ligne dégradée du §24.3.
	 */
	readonly payload: Readonly<Record<string, unknown>> | null
	readonly cards: {
		readonly id: string
		readonly title: string
		readonly channels: {
			readonly slug: string
			readonly name: string
			readonly tracks: { readonly slug: string; readonly name: string } | null
		} | null
	} | null
}

/** Un commentaire cité, tel que la requête 2 le rend. */
export type LigneCommentaireCite = {
	readonly id: string
	readonly body: string
	readonly deleted_at: string | null
	readonly author_id: string | null
	readonly auteur: ProfilAffiche | null
}

/** Une notification telle que le panneau la rend (§24.3, §5.43 du design system). */
export type NotificationAffichee = {
	readonly id: string
	readonly lue: boolean
	readonly date: string
	/** Le titre de l'affaire, toujours présent — voir `apparier` pour pourquoi. */
	readonly titreAffaire: string | null
	/** L'adresse de la fiche, ou `null` lorsque les slugs manquent. */
	readonly adresse: string | null
	readonly adresseChannel: string | null
	readonly nomTrack: string | null
	readonly nomChannel: string | null
	/** L'auteur du propos, ou `null` sur la ligne dégradée du §24.3. */
	readonly auteur: ProfilAffiche | null
	/** Le propos, ou `null` sur la ligne dégradée. Jamais une chaîne vide. */
	readonly extrait: string | null
}

/**
 * L'identifiant du commentaire cité par une charge utile, ou `null`.
 *
 * ELLE NE FAIT CONFIANCE À RIEN. `payload` est un `jsonb` dont la forme n'est garantie par aucune
 * contrainte : le trigger du §14.5 y écrit `comment_id` et `author_id`, mais une charge utile
 * amputée — par une migration future, par une écriture de service — ne doit pas faire échouer la
 * page entière. Elle produit alors la ligne dégradée du §24.3, exactement comme un `payload` amputé
 * ne rend aucun détail dans le fil (`docs/DESIGN_SYSTEM.md` §5.38).
 */
export function idCommentaireCite(
	payload: LigneNotificationLue['payload'],
): string | null {
	const brut = payload?.['comment_id']
	return typeof brut === 'string' && brut.length > 0 ? brut : null
}

/**
 * L'adresse du dossier d'une affaire, ou `null` lorsque ses slugs manquent.
 *
 * Elle est calculée ICI et non recomposée dans l'écran : les deux adresses partagent leur préfixe,
 * et deux compositions divergeraient au premier changement de route — le procédé de `ma-journee.ts`
 * et d'`affaires-figees.ts` (décision 167).
 */
export function adresseChannelNotification(card: LigneNotificationLue['cards']): string | null {
	const slugChannel = card?.channels?.slug
	const slugTrack = card?.channels?.tracks?.slug
	if (slugChannel === undefined || slugTrack === undefined) return null
	return `/tracks/${slugTrack}/${slugChannel}`
}

/**
 * Apparie une notification avec le commentaire que la seconde lecture en a rapporté.
 *
 * TROIS CAS, ET LE TROISIÈME EST IMPOSSIBLE (§24.3).
 *
 * 1. **complet** — l'affaire, le propos et son auteur ;
 * 2. **commentaire illisible ou détruit** — l'affaire, la date et le lien, sans auteur ni extrait.
 *    Ce cas ARRIVE RÉELLEMENT : le §14.4 conserve la notification quand la mention est retirée, et
 *    le §13.4 rappelle qu'une suppression de commentaire **vide réellement le corps**. La ligne ne
 *    dit **ni** que le propos a été supprimé **ni** qu'il est illisible : les deux causes sont
 *    indistinguables, et les nommer divulguerait ce que la seconde cache ;
 * 3. **affaire illisible** — NE PEUT PAS ARRIVER, et c'est une propriété de la politique, pas une
 *    chance : `notifications_lecture` exige `app.can_read_card(subject_card_id)`, donc une
 *    notification dont l'affaire se ferme **sort de la liste entière**. Aucun repli n'est écrit
 *    pour cet état — en écrire un enseignerait qu'il peut arriver.
 *
 * `titreAffaire` reste néanmoins déclaré `null`able, parce que la colonne `subject_card_id` l'est
 * (§13.5) : une notification qui ne parle d'aucune affaire est lisible par son seul destinataire, et
 * c'est le §16.1 qui le décide. Aucune n'existe aujourd'hui ; le type ne prétend pas le contraire.
 */
export function apparier(
	ligne: LigneNotificationLue,
	commentaires: ReadonlyMap<string, LigneCommentaireCite>,
): NotificationAffichee {
	const base = adresseChannelNotification(ligne.cards)
	const idCommentaire = idCommentaireCite(ligne.payload)
	const commentaire = idCommentaire === null ? undefined : commentaires.get(idCommentaire)
	// UN COMMENTAIRE SUPPRIMÉ EST TRAITÉ COMME UN COMMENTAIRE ABSENT, et ce n'est pas un
	// raccourci : la base a réellement vidé son corps (§13.4), si bien qu'un extrait rendu depuis
	// une pierre tombale serait une chaîne vide. Le distinguer par un texte — « propos retiré » —
	// dirait à l'écran ce que le §24.3 refuse de dire.
	const lisible = commentaire !== undefined && commentaire.deleted_at === null
	const corps = lisible ? commentaire.body : ''
	return {
		id: ligne.id,
		lue: ligne.read_at !== null,
		date: ligne.created_at,
		titreAffaire: ligne.cards?.title ?? null,
		adresse:
			base === null || ligne.subject_card_id === null
				? null
				: `${base}/cards/${ligne.subject_card_id}`,
		adresseChannel: base,
		nomTrack: ligne.cards?.channels?.tracks?.name ?? null,
		nomChannel: ligne.cards?.channels?.name ?? null,
		auteur: lisible ? commentaire.auteur : null,
		extrait: corps.length > 0 ? corps : null,
	}
}

/** Ce que le panneau reçoit d'une lecture : les lignes, et le compte de non-lues du serveur. */
export type BoiteLue = {
	readonly notifications: readonly NotificationAffichee[]
	/**
	 * Le compte de **toutes** les non-lues, jamais celui des seules lignes rendues (§26.5).
	 *
	 * Un compteur qui s'arrêterait à `BORNE_LISTE` mentirait sur ce qui reste à lire, et c'est
	 * précisément ce qu'une cloche existe pour dire. `null` lorsque le serveur ne l'a pas rendu :
	 * l'écran n'affiche alors **aucun** compteur plutôt qu'un zéro qu'il n'a pas mesuré (§26.1).
	 */
	readonly nonLues: number | null
	/** Vrai lorsque la lecture a atteint sa borne : le panneau le dit en toutes lettres (§26.5). */
	readonly tronquee: boolean
}

/**
 * Lit la boîte de l'appelant, en DEUX requêtes (§24.1).
 *
 * L'ORDRE EST LE PLUS RÉCENT EN HAUT, ET C'EST L'INVERSE DU FIL DE COMMENTAIRES (§26.2). L'écart
 * est **voulu** : une conversation se lit dans le sens où elle s'est tenue, une boîte de réception
 * se lit en commençant par ce qui vient d'arriver. Les non-lues **ne remontent pas** — un second
 * critère de tri ferait sauter une ligne au moment précis où on vient de la marquer.
 *
 * AUCUNE SECONDE REQUÊTE QUAND LA PREMIÈRE EST VIDE, ni quand aucune ligne ne cite de commentaire :
 * demander `id=in.()` serait une requête dont on connaît déjà la réponse.
 *
 * LA SECONDE LECTURE N'EST PAS BLOQUANTE, et c'est la décision d'`affaires-figees.ts` reprise pour
 * son motif exact : son échec ne doit pas effacer une boîte que la première a déjà rendue. L'écran
 * vaut mieux dégradé — l'affaire, la date et le lien — que remplacé par une erreur. C'est le sort
 * d'un commentaire absent de cette lecture (§24.3, cas 2), généralisé à tous.
 *
 * LE COMPTE DE NON-LUES VIENT DU SERVEUR, jamais des lignes rendues : `count: 'exact'` sur une
 * requête `head` porte le nombre **dans l'en-tête**, et aucune ligne ne traverse le réseau (§21,
 * M4). Son échec ne fait pas échouer la boîte non plus — le panneau reste lisible sans compteur.
 */
export async function lireBoite(client: ClientCrm): Promise<EtatAsync<BoiteLue>> {
	try {
		const reponse = await client
			.from('notifications')
			.select(COLONNES_NOTIFICATION)
			.order('created_at', { ascending: false })
			.limit(BORNE_LISTE)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		// Le type généré décrit ce que la base PEUT rendre, jamais ce que cette lecture-ci demande
		// (`docs/SPEC-types.md` §4) : le passage par `unknown` est celui que le dépôt emploie pour
		// toute réponse PostgREST projetée.
		const lignes = (reponse.data ?? []) as unknown as readonly LigneNotificationLue[]

		const idsCites = [
			...new Set(
				lignes
					.map((ligne) => idCommentaireCite(ligne.payload))
					.filter((identifiant): identifiant is string => identifiant !== null),
			),
		]
		const commentaires = new Map<string, LigneCommentaireCite>()
		if (idsCites.length > 0) {
			const cites = await client
				.from('card_comments')
				.select(COLONNES_COMMENTAIRE_MENTION)
				.in('id', idsCites)
			if (cites.error === null) {
				for (const commentaire of (cites.data ?? []) as unknown as readonly LigneCommentaireCite[]) {
					commentaires.set(commentaire.id, commentaire)
				}
			}
		}

		return pret({
			notifications: lignes.map((ligne) => apparier(ligne, commentaires)),
			nonLues: await compterNonLues(client),
			tronquee: lignes.length >= BORNE_LISTE,
		})
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}

/**
 * Compte les non-lues, sans ramener une seule ligne (§21, M4 ; §26.1).
 *
 * C'est la lecture que la cloche **fermée** fait le plus souvent, et la moins chère que la pile
 * sache rendre : `head: true` avec `count: 'exact'` porte le nombre dans l'en-tête `Content-Range`.
 *
 * `null` EN CAS D'ÉCHEC, ET C'EST UNE DÉCISION. Un compteur qui retomberait à zéro sur une panne
 * affirmerait que tout est lu alors que rien n'a été mesuré — la valeur par défaut trompeuse que
 * `CLAUDE.md` §18 interdit. L'écran n'affiche alors **aucune** pastille (§26.1).
 */
export async function compterNonLues(client: ClientCrm): Promise<number | null> {
	try {
		const reponse = await client
			.from('notifications')
			.select('id', { count: 'exact', head: true })
			.is('read_at', null)
		if (reponse.error !== null) return null
		return reponse.count ?? null
	} catch {
		return null
	}
}

/**
 * Les trois issues d'un marquage (§26.4).
 *
 * `sans-effet` n'est **ni** un succès **ni** une erreur : la clause `USING` de
 * `notifications_marquage` filtre en silence, et le serveur rend `204` sans avoir rien changé
 * (ligne *i* du §17, mesurée). Le confondre avec l'un ou l'autre ferait croire à un effet qui n'a
 * pas eu lieu — la règle des §5.25, §5.27, §5.28 et §5.40 de `docs/DESIGN_SYSTEM.md`.
 */
export type IssueMarquage =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly detail: string }

/**
 * Marque une notification lue, ou la remet de côté (§15.1, §26.4).
 *
 * LES DEUX SENS, PARCE QU'UN ÉTAT À DEUX VALEURS QU'ON NE PEUT PARCOURIR QUE DANS UN SENS N'EST PAS
 * UN ÉTAT, C'EST UN COMPTEUR. On ouvre une notification par mégarde, et une boîte dont on ne peut
 * pas remettre un message de côté n'est pas une boîte.
 *
 * LA DATE ENVOYÉE N'A AUCUNE IMPORTANCE, et c'est mesuré (§21, M10) : un trigger `BEFORE UPDATE`
 * remplace toute valeur non nulle par `now()`. Elle est envoyée parce que la colonne est typée, et
 * la preuve d'API mesure précisément qu'elle est ignorée. `null` reste `null` (M11) — c'est le
 * « marquer non lu ».
 *
 * LE GESTE DEMANDE SA LIGNE EN RETOUR, et c'est ce qui distingue les deux premières issues : un
 * `PATCH` filtré rend zéro ligne. Sans `select()`, PostgREST rend `204` dans les deux cas et
 * l'écran ne saurait pas lequel.
 */
export async function marquerNotification(
	client: ClientCrm,
	idNotification: string,
	lue: boolean,
): Promise<IssueMarquage> {
	try {
		const reponse = await client
			.from('notifications')
			.update({ read_at: lue ? new Date().toISOString() : null })
			.eq('id', idNotification)
			.select('id')
		if (reponse.error !== null) {
			return { statut: 'refus', detail: reponse.error.message }
		}
		return (reponse.data ?? []).length === 0 ? { statut: 'sans-effet' } : { statut: 'applique' }
	} catch (cause) {
		return { statut: 'refus', detail: cause instanceof Error ? cause.message : String(cause) }
	}
}

/**
 * La boîte de l'appelant, tenue à jour.
 *
 * LES DEUX RÈGLES DE `CRM-043` SONT REPRISES SANS CHANGEMENT (§25.2), et les recopier autrement en
 * ferait diverger une.
 *
 * 1. **La lecture est déclenchée par l'abonnement, jamais avant** (décision 195). Charger puis
 *    s'abonner laisserait une fenêtre dont la largeur n'est connue de personne ; s'abonner puis
 *    charger la referme, au prix d'une lecture. `SUBSCRIBED`, `CHANNEL_ERROR` et `TIMED_OUT`
 *    déclenchent tous les trois la lecture : une cloche muette serait pire qu'une cloche qui ne se
 *    met pas à jour toute seule — et l'utilisateur garde l'action de rechargement.
 *
 * 2. **Le flux DÉCLENCHE la lecture, il ne la remplace pas** (décision 201). Un événement ne porte
 *    pas la boîte : il dit qu'elle a changé. C'est une requête de plus par événement, et c'est le
 *    prix de trois choses qu'aucune fusion locale ne donnerait — l'ordre total est celui du
 *    serveur, un événement perdu ou dupliqué ne laisse aucune trace, et la lecture applique la
 *    **RLS courante** plutôt que celle du moment de l'abonnement.
 *
 * AUCUN ABONNEMENT SANS SESSION (§25.3) : un anonyme n'a aucune notification, et ouvrir un canal
 * pour ne rien recevoir coûterait une connexion permanente à chaque visiteur de l'écran de
 * connexion. Le hook rend alors un état **prêt et vide**, jamais un chargement perpétuel.
 */
export function useNotifications(
	client: ClientCrm | null,
	idProfil: string | null,
): {
	readonly etat: EtatAsync<BoiteLue>
	readonly recharger: () => void
	readonly reprendre: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<BoiteLue>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — l'identifiant change d'une session à
	// l'autre.
	const courant = useRef(0)
	// La relecture silencieuse traverse ce relais, et non la liste de dépendances de l'effet
	// (décision 315). L'effet POSSÈDE l'abonnement ; le relais ne fait que rejouer la lecture.
	const relecture = useRef<() => void>(() => {})

	useEffect(() => {
		++courant.current
		if (client === null || idProfil === null) {
			// SANS SESSION, L'ÉTAT EST PRÊT ET VIDE, jamais un chargement qui n'aboutira pas. La
			// cloche n'est pas rendue dans ce cas (§26.7), et un état de chargement perpétuel ferait
			// croire à une lecture en vol.
			relecture.current = () => {}
			setEtat(pret({ notifications: [], nonLues: null, tronquee: false }))
			return
		}
		setEtat(enChargement)

		const charger = () => {
			// LE RANG EST PRIS PAR LECTURE, ET NON PAR ABONNEMENT (décision 315). Deux lectures
			// peuvent être en vol en même temps — un événement du temps réel et le geste qui l'a
			// provoqué se croisent —, et rien ne garantit qu'elles reviennent dans l'ordre.
			const rang = ++courant.current
			// LA BOÎTE N'EST JAMAIS VIDÉE POUR ÊTRE RELUE. Repasser par `enChargement` ferait
			// disparaître la liste le temps d'un aller-retour, et cette disparition a été VUE sur une
			// capture à `CRM-043` (décision 315). L'état de chargement reste dû tant qu'aucune donnée
			// n'est affichable — première lecture, changement de session, reprise après erreur.
			setEtat((precedent) => (precedent.statut === 'pret' ? precedent : enChargement()))
			void (async () => {
				const resultat = await lireBoite(client)
				if (rang !== courant.current) return
				setEtat(resultat)
			})()
		}
		relecture.current = charger

		const canal = client
			.channel(nomCanalNotifications(idProfil))
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'notifications',
					filter: filtreCanalNotifications(idProfil),
				},
				charger,
			)
			.subscribe((statut) => {
				if (statut === 'SUBSCRIBED' || statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT') {
					charger()
				}
			})

		return () => {
			void client.removeChannel(canal)
		}
	}, [client, idProfil, tentative])

	/**
	 * Relit la boîte **sans défaire l'abonnement ni vider l'écran**.
	 *
	 * C'est le geste ordinaire : après un marquage, et à chaque événement du temps réel. Il ne
	 * touche pas au canal — le recréer à chaque écriture ferait payer une reconnexion pour une
	 * relecture, et laisserait une fenêtre sans abonnement à l'instant précis où la boîte change.
	 */
	const recharger = useCallback(() => {
		relecture.current()
	}, [])

	/**
	 * Reprise explicite, offerte à l'utilisateur quand la boîte est en erreur.
	 *
	 * Elle refait TOUT : l'abonnement comme la lecture. Une erreur peut venir du canal autant que
	 * de la requête — `CHANNEL_ERROR` charge la boîte mais la laisse sans mise à jour automatique
	 * —, et une reprise qui ne rejouerait que la lecture laisserait ce défaut en place sans que
	 * rien ne le dise.
	 */
	const reprendre = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger, reprendre }
}
