// @spec CRM-064 (docs/BACKLOG.md) — tranche 3a : la cloche, son compteur et le panneau
// @spec docs/DESIGN_SYSTEM.md §5.43 (cette surface), §5.18 (liste plate), §5.29 (pilule de
//       channel), §5.10 (avatar 24 px et date absolue), §5.1 (le liseré), §5.5 (variantes),
//       §5.8 (états systématiques), §5.13 (le focus), §8 (accessibilité), §9 (icônes), §10
// @spec docs/SPEC-notifications.md §23 (où la surface vit), §26 (ce que l'écran rend)
//
// LA CLOCHE VIT DANS L'EN-TÊTE, ET CE N'EST PAS UNE DESTINATION. Le §4 du design system range dans
// la barre latérale les surfaces où l'on va **travailler** ; une boîte de notifications n'en est
// pas une — on y jette un œil, on suit un lien, on revient à ce qu'on faisait. C'est un **état de
// l'utilisateur courant**, au même titre que son identité de session, qui vit déjà là (§5.12).
//
// AUCUNE MODALE (§23.2). Le §5 du design system n'en déclare aucune, et `CRM-043` puis `CRM-075`
// l'ont tranché deux fois : une surface qui recouvre l'écran demanderait un piège de focus, une
// gestion d'`Échap` et le voile `--color-veil`, trois mécanismes qu'aucune unité n'a spécifiés.
//
// AUCUNE ROUTE NON PLUS, et c'est l'écart avec le carnet (§5.19) et « Ma journée » (§5.36) : une
// route ferait perdre l'écran courant à chaque coup d'œil, et obligerait à revenir.

import { Bell, Mail, MailOpen, SquareArrowOutUpRight } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../components/ui/Avatar'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import {
	formaterCompteur,
	marquerNotification,
	useNotifications,
	type NotificationAffichee,
} from '../lib/notifications'
import { clientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/**
 * Le nombre de caractères d'extrait rendus sur une ligne.
 *
 * BORNÉ À L'AFFICHAGE, JAMAIS À LA LECTURE (§26.3). La requête rapporte le corps entier ; borner au
 * serveur exigerait une vue ou une fonction, donc une **seconde** écriture de ce que l'écran
 * montre, pour économiser des octets que personne n'a mesurés (`CLAUDE.md` §21).
 */
const LONGUEUR_EXTRAIT = 140

/**
 * La cloche et son panneau.
 *
 * SANS SESSION, RIEN N'EST RENDU (§26.7). C'est l'écart avec le reste de l'en-tête, qui rend « Se
 * connecter » à sa place (§5.12) : une cloche offerte à un anonyme annoncerait une boîte qu'aucune
 * session ne peut remplir, et son compteur serait un zéro permanent — la commande morte que le
 * §5.10 proscrit.
 */
export function ClocheNotifications() {
	const { etat: etatSession } = useAuthentification()
	const idProfil = etatSession.statut === 'authentifie' ? etatSession.utilisateur.id : null
	const { etat, recharger, reprendre } = useNotifications(clientCrm, idProfil)
	const [ouvert, setOuvert] = useState(false)
	const [message, setMessage] = useState<'sans-effet' | 'refus' | null>(null)
	const idPanneau = useId()
	const ancre = useRef<HTMLDivElement | null>(null)
	const cloche = useRef<HTMLButtonElement | null>(null)
	const panneau = useRef<HTMLDivElement | null>(null)

	const fermer = useCallback(() => {
		setOuvert(false)
		// LE RETOUR DU FOCUS N'EST PAS DIFFÉRÉ, et c'est écrit pour qu'on ne recopie pas le remède
		// du §5.25 sans son motif : là-bas la commande est DÉMONTÉE pendant l'ouverture et sa
		// référence vaut `null` ; ici la cloche reste montée — elle est l'ancre du panneau et porte
		// son `aria-expanded` (§5.43). Aucune temporisation (`CLAUDE.md` §18).
		cloche.current?.focus()
	}, [])

	// `Échap` referme depuis n'importe lequel des contrôles du panneau, et rend le focus à la
	// cloche — la règle du §5.29 tranche 2 g, reprise sans changement.
	useEffect(() => {
		if (!ouvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key === 'Escape') fermer()
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [ouvert, fermer])

	// UN CLIC HORS DU PANNEAU LE REFERME, et il ne rend PAS le focus : le pointeur l'a déjà déplacé
	// ailleurs, et le ramener à la cloche volerait le focus à ce que l'utilisateur vient de viser.
	// C'est la distinction que le §5.13 fait entre fermer et annuler.
	useEffect(() => {
		if (!ouvert) return
		const surClic = (evenement: MouseEvent) => {
			const cible = evenement.target
			if (cible instanceof Node && ancre.current?.contains(cible) === true) return
			setOuvert(false)
		}
		globalThis.addEventListener('mousedown', surClic)
		return () => globalThis.removeEventListener('mousedown', surClic)
	}, [ouvert])

	// LE FOCUS ENTRE DANS LE PANNEAU À L'OUVERTURE (§5.13). Sans cela, ouvrir au clavier laisserait
	// le focus sur la cloche, et le premier `Tab` sortirait de l'en-tête sans jamais traverser la
	// liste — le défaut que la preuve clavier a trouvé deux fois au §5.10.
	useEffect(() => {
		if (!ouvert) return
		panneau.current?.focus()
	}, [ouvert])

	if (idProfil === null) return null

	const boite = etat.statut === 'pret' ? etat.donnees : null
	const nonLues = boite?.nonLues ?? null
	const pastille = nonLues === null ? null : formaterCompteur(nonLues)

	const marquer = async (notification: NotificationAffichee) => {
		if (clientCrm === null) return
		setMessage(null)
		const issue = await marquerNotification(clientCrm, notification.id, !notification.lue)
		// LES TROIS ISSUES, ET LA TROISIÈME EST DITE (§26.4). Un `PATCH` filtré par la clause
		// `USING` rend `204` sans erreur : l'écran écrit qu'aucune notification n'a été modifiée,
		// RELIT, et n'affirme ni le refus ni la disparition — les deux sont indistinguables.
		if (issue.statut === 'sans-effet') setMessage('sans-effet')
		else if (issue.statut === 'refus') setMessage('refus')
		// LA LIGNE NE CHANGE QU'APRÈS LA RÉPONSE DU SERVEUR : le marquage n'est pas optimiste
		// (§26.4, §5.43). Il change aussi le COMPTEUR, visible ailleurs sur l'écran, et une
		// annulation ferait clignoter deux endroits à la fois.
		recharger()
	}

	return (
		// LE CONTENEUR N'EST PAS `relative`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE
		// (`CLAUDE.md` §16, capture `notifications-panneau-sm-390.jpg`). Ancré sur la cloche, le
		// panneau alignait son bord DROIT sous elle : à 390 px, sa largeur le faisait sortir de
		// l'écran par la GAUCHE. Le repère de positionnement est donc l'EN-TÊTE, qui occupe toute la
		// largeur — voir le panneau ci-dessous. `ancre` ne sert plus qu'à reconnaître un clic intérieur.
		<div ref={ancre} className="shrink-0">
			<button
				ref={cloche}
				type="button"
				data-testid="cloche-notifications"
				aria-expanded={ouvert}
				aria-controls={idPanneau}
				aria-label={libelleCloche(nonLues)}
				onClick={() => {
					setMessage(null)
					setOuvert((precedent) => !precedent)
				}}
				className={[
					'relative inline-flex items-center justify-center shrink-0',
					'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
					'transition-colors duration-[var(--transition-duration-fast)]',
				].join(' ')}
			>
				<Bell aria-hidden="true" size={20} />
				{/*
				  LE COMPTEUR EST ABSENT TANT QU'IL N'EST PAS CONNU, ET ABSENT À ZÉRO (§26.1) — la
				  règle du §5.31 pour le badge de l'onglet « À saisir ». Un « 0 » pendant la lecture
				  affirmerait que tout est lu alors que rien n'a été lu.

				  TEINTE DE MARQUE, JAMAIS DE DANGER : une mention n'est pas une erreur (§5.43).
				  Il est `aria-hidden` parce que le nom accessible de la cloche porte déjà le compte
				  EXACT — l'annoncer deux fois, dont une sous sa forme tronquée, dirait deux nombres.
				*/}
				{pastille === null ? null : (
					<span
						aria-hidden="true"
						data-testid="compteur-notifications"
						className="absolute top-1 right-1 min-w-4 px-1 rounded-full bg-brand text-white text-xs tabular-nums leading-tight text-center"
					>
						{pastille}
					</span>
				)}
			</button>

			{ouvert ? (
				<div
					ref={panneau}
					id={idPanneau}
					tabIndex={-1}
					role="region"
					aria-label={t('notifications.panel.aria')}
					data-testid="panneau-notifications"
					className={[
						// LE PANNEAU EST ANCRÉ À L'EN-TÊTE, QUI OCCUPE TOUTE LA LARGEUR, et non à la
						// cloche. Sous `md` il s'étend d'un bord à l'autre de la fenêtre, moins la
						// marge ; à partir de `md` il retrouve sa colonne de `40ch` alignée à droite.
						// C'est ce qui l'empêche de sortir de l'écran d'un côté ou de l'autre (§5.43,
						// §7). `md` et jamais `sm`, qui est un variant inconnu que Tailwind supprime
						// en silence (§11).
						'absolute top-full z-40 mt-2',
						'left-4 right-4 md:left-auto md:right-4 md:w-[40ch]',
						'max-h-[70vh] overflow-y-auto',
						'bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)]',
					].join(' ')}
				>
					<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
						<h2 className="text-h3">{t('notifications.panel.title')}</h2>
						<button
							type="button"
							onClick={fermer}
							data-testid="fermer-notifications"
							className="inline-flex items-center justify-center min-h-[var(--size-target)] px-2 rounded-sm text-sm text-brand font-medium hover:bg-hover"
						>
							{t('notifications.panel.close')}
						</button>
					</div>

					<CorpsPanneau
						etat={etat}
						onReprendre={reprendre}
						onMarquer={(notification) => {
							void marquer(notification)
						}}
					/>

					{/*
					  LE MESSAGE D'UN GESTE VIT SOUS LA LISTE, jamais en tête du panneau (§5.13,
					  §5.21), et il SURVIT À LA RELECTURE : la relecture ne le remet pas à vide, et
					  c'est ce qui permet à « sans effet » de dire ET de relire à la fois.
					*/}
					{message === null ? null : (
						<p
							role="alert"
							data-testid="message-marquage"
							className="px-3 py-2 text-sm text-danger-on-soft bg-danger-soft"
						>
							{message === 'sans-effet'
								? t('notifications.mark.noEffect')
								: t('notifications.mark.error')}
						</p>
					)}
				</div>
			) : null}
		</div>
	)
}

/**
 * Le nom accessible de la cloche, qui porte le compte EXACT (§26.1, §5.43).
 *
 * L'ACCORD SE FAIT PAR CLÉ, jamais par un gabarit paramétré : « 1 notifications » est faux (§10).
 * Un compte inconnu — la lecture est en vol, ou le compteur a échoué — rend le libellé nu plutôt
 * qu'un zéro : affirmer « aucune non lue » sans avoir mesuré serait la valeur par défaut trompeuse
 * que `CLAUDE.md` §18 interdit.
 */
export function libelleCloche(nonLues: number | null): string {
	if (nonLues === null) return t('notifications.bell.unknown')
	if (nonLues <= 0) return t('notifications.bell.none')
	if (nonLues === 1) return t('notifications.bell.one')
	return t('notifications.bell.many', { compte: String(nonLues) })
}

/** L'extrait rendu sur une ligne, borné à l'affichage (§26.3). */
export function extraitBorne(corps: string): string {
	const propre = corps.trim()
	if (propre.length <= LONGUEUR_EXTRAIT) return propre
	return `${propre.slice(0, LONGUEUR_EXTRAIT).trimEnd()}…`
}

/**
 * Date absolue, en français, sans bibliothèque.
 *
 * C'est `formaterDate` du panneau de fil, réemployée dans sa forme : une date relative — « il y a
 * 3 heures » — exigerait de se rafraîchir pour ne pas mentir, et le §5.10 demande une date absolue.
 * Une valeur illisible n'est pas remplacée par une date inventée : elle est rendue telle quelle, ce
 * qui se voit.
 */
export function formaterDateNotification(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function CorpsPanneau({
	etat,
	onReprendre,
	onMarquer,
}: {
	readonly etat: ReturnType<typeof useNotifications>['etat']
	readonly onReprendre: () => void
	readonly onMarquer: (notification: NotificationAffichee) => void
}) {
	if (etat.statut === 'chargement') {
		return (
			<div className="p-3">
				<SkeletonListe lignes={3} libelle={t('notifications.loading')} />
			</div>
		)
	}
	if (etat.statut === 'erreur') {
		return (
			<div className="p-3">
				<EtatErreur
					titre={t('notifications.error.title')}
					corps={t('notifications.error.body')}
					libelleReprise={t('notifications.error.retry')}
					onReprise={onReprendre}
				/>
			</div>
		)
	}
	if (etat.donnees.notifications.length === 0) {
		// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION, et son message dit que l'état est SAIN (§26.7) —
		// l'écart au §5.8 que la corbeille (§5.16), le carnet (§5.19) et les affaires figées
		// (§5.37) prennent déjà. Il n'y a rien à faire d'une boîte vide.
		return (
			<div data-testid="notifications-vide" className="p-4 text-sm text-text-2">
				<p className="font-medium text-ink">{t('notifications.empty')}</p>
				<p className="mt-1">{t('notifications.empty.body')}</p>
			</div>
		)
	}
	return (
		<>
			<ul data-testid="liste-notifications">
				{etat.donnees.notifications.map((notification) => (
					<LigneNotification
						key={notification.id}
						notification={notification}
						onMarquer={() => onMarquer(notification)}
					/>
				))}
			</ul>
			{/*
			  LA TRONCATURE EST ÉCRITE, jamais laissée à deviner (§26.5, §5.43) : une liste bornée
			  qui se tairait se lirait comme une boîte complète. C'est la règle du §5.15 pour le plan
			  de remappage — « 3 affaires listées sur 13 » s'écrit en toutes lettres.
			*/}
			{etat.donnees.tronquee ? (
				<p data-testid="notifications-tronquee" className="px-3 py-2 text-xs text-text-3">
					{t('notifications.truncated', { compte: String(etat.donnees.notifications.length) })}
				</p>
			) : null}
		</>
	)
}

function LigneNotification({
	notification,
	onMarquer,
}: {
	readonly notification: NotificationAffichee
	readonly onMarquer: () => void
}) {
	const auteur = notification.auteur
	return (
		<li
			data-testid="notification"
			data-lue={notification.lue ? 'oui' : 'non'}
			className={[
				'flex flex-col gap-1 px-3 py-2 border-b border-border last:border-b-0 hover:bg-hover',
				// L'ÉTAT DE LECTURE SE REND PAR LA FORME, JAMAIS PAR LA PLACE (§26.2, §5.43). Le
				// liseré est celui de la carte de board (§5.1) tourné d'un quart de tour, celui-là
				// même que le §5.7 quater emploie : aucun jeton n'est ajouté. Le §1 est tenu par un
				// MOT — le nom accessible du bouton de marquage dit lequel des deux gestes il porte.
				notification.lue ? 'border-l-[3px] border-l-transparent' : 'border-l-[3px] border-l-brand',
			].join(' ')}
		>
			<div className="flex items-start gap-2 min-w-0">
				{auteur === null ? null : (
					<span className="shrink-0">
						<Avatar profil={auteur} taille={24} decoratif />
					</span>
				)}
				{/*
				  LA PHRASE SE REPLIE, ELLE NE SE TRONQUE PAS, et c'est le second défaut trouvé sur la
				  même capture : « Camille Aubert vous a ment… » coupait le nom de la personne qui
				  vous écrit, c'est-à-dire l'information même de la ligne. Une liste plate répond au
				  manque de place en gagnant de la hauteur (§5.21, §5.37) ; l'ellipse du §5.9 est la
				  règle d'un TABLEAU, qui se balaye en diagonale.
				*/}
				<span
					className={[
						'min-w-0 flex-1 break-words text-sm',
						notification.lue ? 'text-text-2' : 'text-ink font-medium',
					].join(' ')}
				>
					{auteur === null
						? t('notifications.mention.anonymous')
						: t('notifications.mention.author', { auteur: auteur.full_name })}
				</span>
				<time
					dateTime={notification.date}
					className="ml-auto shrink-0 font-mono text-xs tabular-nums text-text-3 leading-normal"
				>
					{formaterDateNotification(notification.date)}
				</time>
			</div>

			{/*
			  UNE LIGNE DONT LE COMMENTAIRE N'EST PLUS LISIBLE GARDE SA PLACE, SANS AUTEUR NI EXTRAIT
			  (§24.3). Elle ne dit NI que le propos a été supprimé NI qu'il est illisible : les deux
			  causes sont indistinguables, et les nommer divulguerait ce que la seconde cache.
			*/}
			{notification.extrait === null ? null : (
				<p data-testid="notification-extrait" className="text-sm text-text-2 break-words">
					{extraitBorne(notification.extrait)}
				</p>
			)}

			{/*
			  LE TITRE DE L'AFFAIRE OCCUPE SA PROPRE LIGNE, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT
			  UNE CAPTURE (`CLAUDE.md` §16, `notifications-panneau-xl-1440.jpg`). Posé d'abord sur la
			  même ligne que la pilule et le bouton, il se rendait « Refonte d… » dans une colonne de
			  `40ch` où la pilule, `shrink-0`, prenait toute la place : le lien ne nommait plus
			  l'affaire qu'il ouvre. C'est le repli d'une liste plate (§5.21, §5.37) — la réponse au
			  manque de place est de gagner de la hauteur, jamais de tronquer une donnée.

			  LE LIEN, jamais la ligne entière : la cible du clic doit être la cible annoncée (§5.9,
			  §5.13). Sans adresse lisible, aucun lien n'est rendu — un lien vers une adresse
			  incomplète mènerait à un écran que l'utilisateur croirait cassé (§5.32).
			*/}
			{notification.titreAffaire === null ? null : notification.adresse === null ? (
				<span className="block truncate text-sm text-text-2" title={notification.titreAffaire}>
					{notification.titreAffaire}
				</span>
			) : (
				<Link
					to={notification.adresse}
					data-testid="notification-lien"
					title={notification.titreAffaire}
					aria-label={t('notifications.item.open', { affaire: notification.titreAffaire })}
					className="block truncate text-sm text-brand font-medium hover:underline"
				>
					{notification.titreAffaire}
				</Link>
			)}

			<div className="flex items-center gap-2 min-w-0">
				{/*
				  LA PILULE « Track › Channel » EST CELLE DU §5.29, réemployée sans copie — c'est la
				  même donnée, elle doit se reconnaître d'un écran à l'autre. Sans destination
				  lisible, aucune pilule : l'écran ne nomme jamais ce qu'il ne peut pas ouvrir.
				*/}
				{notification.nomTrack === null ||
				notification.nomChannel === null ||
				notification.adresseChannel === null ? null : (
					<Link
						to={notification.adresseChannel}
						data-testid="notification-pilule"
						aria-label={t('today.pill.open', {
							track: notification.nomTrack,
							channel: notification.nomChannel,
						})}
						className="shrink-0 inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-full bg-brand-soft text-brand text-xs truncate hover:bg-brand-soft-strong"
					>
						<SquareArrowOutUpRight aria-hidden="true" size={12} strokeWidth={2} />
						<span className="truncate">
							{t('goals.block.pill', {
								track: notification.nomTrack,
								channel: notification.nomChannel,
							})}
						</span>
					</Link>
				)}

				{/*
				  LE MARQUAGE EST SON PROPRE BOUTON (§26.4, §5.43). Le clic sur le lien ne marque
				  rien : suivre un lien et marquer lu sont deux gestes, et les fondre ferait
				  disparaître du compteur une notification qu'on a effleurée en visant autre chose.

				  DEUX VISAGES, UN SEUL RENDU À LA FOIS — le patron du §5.15 pour `Archive` /
				  `ArchiveRestore`. La commande n'est JAMAIS éteinte d'avance (§5.3, §5.13, §5.16,
				  §5.21, §5.27, sans exception).
				*/}
				<button
					type="button"
					onClick={onMarquer}
					data-testid="marquer-notification"
					title={
						notification.lue
							? t('notifications.item.markUnread')
							: t('notifications.item.markRead')
					}
					aria-label={
						notification.lue
							? t('notifications.item.markUnread')
							: t('notifications.item.markRead')
					}
					className="ml-auto shrink-0 inline-flex items-center justify-center size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover"
				>
					{notification.lue ? (
						<Mail aria-hidden="true" size={16} />
					) : (
						<MailOpen aria-hidden="true" size={16} />
					)}
				</button>
			</div>
		</li>
	)
}
