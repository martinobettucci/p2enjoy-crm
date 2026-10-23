// @spec CRM-067 (docs/BACKLOG.md) — tranche T2 : le bloc « Activités » de la fiche d'une affaire — lire, consigner,
//       corriger, retirer
// @spec docs/SPEC-activites.md §4 (ce qu'on en voit), §5 (états et refus), §3 (les droits d'un commentaire : l'auteur
//       corrige, l'auteur ou un administrateur retire)
// @spec docs/DESIGN_SYSTEM.md §5.63 (ce bloc), §5.21 (la forme d'un bloc de colonne gauche), §5.13 (formulaire et
//       confirmation dans le flux, focus), §5.10 (pierre tombale, modération, texte brut), §5.59 (commandes éteintes avec
//       le motif de la fiche), §5.8 (états), §5.7 bis (cases de 24 px), §8 (accessibilité), §9 (icônes Lucide)
// @spec docs/JOURNAL.md décision 651 (la commande en tête du bloc)
// @spec CLAUDE.md §10 — comparer l'auteur à la session et lire le rôle ne sert qu'à ne pas offrir une commande morte ;
//       les politiques de `card_activities` décident, et un refus malgré tout est dit
//
// UN SEUL ÉLÉMENT OUVERT À LA FOIS DANS LE BLOC (§5.28) : le formulaire d'ajout, la correction d'une ligne ou la
// confirmation d'un retrait. En ouvrir un ferme le précédent, et le focus revient à la commande qui l'avait ouvert.

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { useRefus } from '../components/ui/RefusCommandes'
import { t, type CleTraduction } from '../i18n'
import {
	DUREE_MAX,
	DUREE_MIN,
	LONGUEUR_MAX_COMPTE_RENDU,
	LONGUEUR_MAX_SUJET,
	TYPES_ACTIVITE,
	consignerActivite,
	corrigerActivite,
	depuisChampLocal,
	lireActivites,
	lireDuree,
	retirerActivite,
	versChampLocal,
	type ActiviteAffichee,
	type IssueActivite,
	type NatureRefusActivite,
	type ParticipantAffiche,
	type TypeActivite,
} from '../lib/activites'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireContactsDeLAffaire } from '../lib/contacts'
import { lireMembresEspace } from '../lib/membres-espace'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import {
	PASTILLE_ACTIVITE,
	PASTILLE_ACTIVITE_RETIREE,
	PRESENTATION_ACTIVITE,
	formaterDateActivite,
} from './presentationActivites'

/** Le dictionnaire FERMÉ des refus (docs/SPEC-activites.md §5) : jamais le message du serveur. */
export const MESSAGES_REFUS_ACTIVITE: Readonly<Record<NatureRefusActivite, CleTraduction>> = {
	future: 'activities.refus.future',
	sujet: 'activities.refus.sujet',
	duree: 'activities.refus.duree',
	'compte-rendu': 'activities.refus.compte-rendu',
	participant: 'activities.refus.participant',
	retiree: 'activities.refus.retiree',
	moderation: 'activities.refus.moderation',
	forbidden: 'activities.refus.forbidden',
	'sans-effet': 'activities.refus.sans-effet',
	network: 'activities.refus.network',
	unknown: 'activities.refus.unknown',
}

const CLE_REFUS_DATE: CleTraduction = 'activities.refus.date'

/** Les textes des deux groupes de participants, nommés hors du JSX pour le contrôle des clés mortes. */
const CLES_GROUPE_CONTACTS = {
	vide: 'activities.form.participants.noContact',
	erreur: 'activities.form.participants.contactsError',
} as const satisfies Record<string, CleTraduction>
const CLES_GROUPE_MEMBRES = {
	vide: 'activities.form.participants.noMember',
	erreur: 'activities.form.participants.membersError',
} as const satisfies Record<string, CleTraduction>

/** Classes d'un champ, celles du §5.7 : 40 px de haut, bordure, fond de surface, anneau de focus. */
const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')

const CLASSES_PASTILLE = 'flex size-[1.75rem] shrink-0 items-center justify-center rounded-md'

/** Ce qui est ouvert dans le bloc, au plus une chose (§5.28). */
type Ouverture =
	| { readonly genre: 'ajout' }
	| { readonly genre: 'correction'; readonly id: string }
	| { readonly genre: 'retrait'; readonly id: string }
	| null

/** Les participants proposés par le formulaire, lus à sa première ouverture. */
type Personne = { readonly id: string; readonly nom: string }
type Proposes = {
	readonly contacts: EtatAsync<readonly Personne[]>
	readonly membres: EtatAsync<readonly Personne[]>
}

export type ProprietesBlocActivitesCard = {
	readonly idCard: string
	readonly idWorkspace: string
	/** L'identifiant de session : il décide quelles commandes sont OFFERTES, jamais lesquelles sont permises. */
	readonly idUtilisateur: string | null
	/** Vrai si l'appelant administre l'espace : il décide si « Retirer » est offert sur l'activité d'un tiers. */
	readonly estAdminWorkspace: boolean
	/** Appelé après chaque écriture appliquée, pour que le fil relise sa troisième source (§5.63). */
	readonly onChange?: () => void
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

export function BlocActivitesCard({
	idCard,
	idWorkspace,
	idUtilisateur,
	estAdminWorkspace,
	onChange,
	client = clientCrm,
}: ProprietesBlocActivitesCard) {
	const droit = useRefus()
	const [etat, setEtat] = useState<EtatAsync<readonly ActiviteAffichee[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [annonce, setAnnonce] = useState('')
	// Le message d'un geste vit dans le BLOC et non dans la ligne : une relecture peut faire disparaître la ligne
	// visée, et le message doit lui survivre (§5.21, leçon de `BlocContactsCard`).
	const [message, setMessage] = useState<string | null>(null)
	const [proposes, setProposes] = useState<Proposes | null>(null)
	const section = useRef<HTMLElement>(null)
	// La commande à qui rendre le focus, par son attribut `data-retour` : la commande est DÉMONTÉE tant que son
	// formulaire est ouvert, et le focus ne peut lui revenir qu'au rendu suivant (§5.25).
	const [retour, setRetour] = useState<string | null>(null)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		void (async () => {
			const resultat = await lireActivites(client, idCard)
			if (rang !== courant.current) return
			// LA LISTE RESTE À L'ÉCRAN PENDANT UNE RELECTURE : le squelette est réservé au premier chargement (§5.29
			// tranche 2 c). Une relecture en échec, elle, se dit.
			setEtat(resultat)
		})()
	}, [client, idCard, tentative])

	useEffect(() => {
		if (retour === null) return
		section.current?.querySelector<HTMLElement>(`[data-retour="${retour}"]`)?.focus()
		setRetour(null)
	}, [retour, ouverture])

	// LES PARTICIPANTS POSSIBLES SONT LUS À LA PREMIÈRE OUVERTURE D'UN FORMULAIRE, jamais au chargement de la fiche : la
	// plupart des visites ne consignent rien. Les deux lectures partent ensemble et échouent séparément (§5.63).
	useEffect(() => {
		if (client === null || proposes !== null) return
		if (ouverture === null || ouverture.genre === 'retrait') return
		setProposes({ contacts: enChargement(), membres: enChargement() })
		void (async () => {
			const [contacts, membres] = await Promise.all([
				lireContactsDeLAffaire(client, idCard),
				lireMembresEspace(client, idWorkspace),
			])
			setProposes({
				contacts:
					contacts.statut === 'pret'
						? { statut: 'pret', donnees: contacts.donnees.map((c) => ({ id: c.contactId, nom: c.nom })) }
						: contacts,
				membres:
					membres.statut === 'pret'
						? {
								statut: 'pret',
								donnees: membres.donnees.flatMap((m) =>
									m.nom === null ? [] : [{ id: m.idUtilisateur, nom: m.nom }],
								),
							}
						: membres,
			})
		})()
	}, [client, idCard, idWorkspace, ouverture, proposes])

	const ouvrir = useCallback((suivante: Ouverture) => {
		setMessage(null)
		setOuverture(suivante)
	}, [])

	const fermer = useCallback((cleRetour: string) => {
		setOuverture(null)
		setRetour(cleRetour)
	}, [])

	/** Applique l'issue d'une écriture : annonce, message, relecture du bloc et du fil. */
	const conclure = useCallback(
		(issue: IssueActivite, cleAnnonce: CleTraduction, cleRetour: string): NatureRefusActivite | null => {
			if (issue.statut === 'refus') {
				if (issue.nature !== 'sans-effet' && issue.nature !== 'retiree') return issue.nature
				// La ligne a changé sous nos pieds : on le dit SOUS LA LISTE et on relit, comme pour un commentaire. Le
				// formulaire se ferme — il ne reste rien à corriger dedans.
				setOuverture(null)
				setRetour(cleRetour)
				setMessage(t(MESSAGES_REFUS_ACTIVITE[issue.nature]))
				setTentative((n) => n + 1)
				return null
			}
			setOuverture(null)
			setRetour(cleRetour)
			setAnnonce(t(cleAnnonce))
			setMessage(
				issue.participantsRefuses === 0
					? null
					: [
							issue.participantsRefuses === 1
								? t('activities.participants.partial.one')
								: t('activities.participants.partial.many', { nombre: String(issue.participantsRefuses) }),
							t(MESSAGES_REFUS_ACTIVITE[issue.natureParticipants ?? 'unknown']),
						].join(' '),
			)
			setTentative((n) => n + 1)
			onChange?.()
			return null
		},
		[onChange],
	)

	if (client === null) return null

	return (
		<section
			ref={section}
			data-testid="bloc-activites-card"
			aria-labelledby="bloc-activites-titre"
			className="flex flex-col gap-3 border-t border-border pt-4"
		>
			<h2 id="bloc-activites-titre" className="text-h3">
				{t('activities.title')}
			</h2>
			<LiveRegion libelle={t('activities.live.aria')} message={annonce} />

			{ouverture?.genre === 'ajout' ? (
				<FormulaireActivite
					titre={t('activities.form.new')}
					libelleEnvoi={t('activities.form.submit.new')}
					initiale={null}
					proposes={proposes}
					onAnnuler={() => fermer('ajout')}
					onEnvoyer={async (saisie) =>
						conclure(await consignerActivite(client, idCard, saisie), 'activities.live.created', 'ajout')
					}
				/>
			) : (
				<div>
					<Button
						{...droit}
						data-retour="ajout"
						data-testid="consigner-activite"
						onClick={() => ouvrir({ genre: 'ajout' })}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('activities.add')}
					</Button>
				</div>
			)}

			{etat.statut === 'chargement' ? <SkeletonListe lignes={2} libelle={t('state.loading.aria')} /> : null}

			{etat.statut === 'erreur' ? (
				<div className="flex flex-col items-start gap-2" data-testid="erreur-activites">
					<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
						{t('activities.error.body')}
					</p>
					<Button taille="compacte" onClick={() => setTentative((n) => n + 1)}>
						{t('activities.error.retry')}
					</Button>
				</div>
			) : null}

			{etat.statut === 'pret' && etat.donnees.length === 0 ? (
				<p data-testid="activites-vide" className="text-text-2">
					{t('activities.empty')}
				</p>
			) : null}

			{etat.statut === 'pret' && etat.donnees.length > 0 ? (
				<ul data-testid="liste-activites" aria-label={t('activities.list.aria')} className="flex flex-col">
					{etat.donnees.map((activite) => (
						<LigneActivite
							key={activite.id}
							activite={activite}
							estAuteur={idUtilisateur !== null && activite.auteurId === idUtilisateur}
							estAdminWorkspace={estAdminWorkspace}
							ouverture={ouverture}
							proposes={proposes}
							onOuvrir={ouvrir}
							onFermer={fermer}
							onCorriger={async (saisie) =>
								conclure(
									await corrigerActivite(client, activite, saisie),
									'activities.live.edited',
									`corriger:${activite.id}`,
								)
							}
							onRetirer={async () =>
								conclure(
									await retirerActivite(client, activite.id),
									'activities.live.retired',
									'ajout',
								)
							}
						/>
					))}
				</ul>
			) : null}

			{message === null ? null : (
				<p
					role="alert"
					data-testid="message-activites"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{message}
				</p>
			)}
		</section>
	)
}

/** Les noms des participants, ceux que la base ne rend pas lisibles étant tus (§5.63 : jamais un identifiant). */
const nomsParticipants = (activite: ActiviteAffichee): readonly string[] =>
	[...activite.contacts, ...activite.membres].flatMap((p) => (p.nom === null ? [] : [p.nom]))

function LigneActivite({
	activite,
	estAuteur,
	estAdminWorkspace,
	ouverture,
	proposes,
	onOuvrir,
	onFermer,
	onCorriger,
	onRetirer,
}: {
	readonly activite: ActiviteAffichee
	readonly estAuteur: boolean
	readonly estAdminWorkspace: boolean
	readonly ouverture: Ouverture
	readonly proposes: Proposes | null
	readonly onOuvrir: (ouverture: Ouverture) => void
	readonly onFermer: (cleRetour: string) => void
	readonly onCorriger: (saisie: SaisieFormulaire) => Promise<NatureRefusActivite | null>
	readonly onRetirer: () => Promise<NatureRefusActivite | null>
}) {
	const droit = useRefus()
	const presentation = PRESENTATION_ACTIVITE[activite.type]
	const Icone = presentation.icone
	const enCorrection = ouverture?.genre === 'correction' && ouverture.id === activite.id
	const enRetrait = ouverture?.genre === 'retrait' && ouverture.id === activite.id
	// LA FORME PORTE LA RÈGLE DE LA BASE (§5.10, §5.63) : l'auteur corrige et retire ; un administrateur retire
	// l'activité d'un tiers, sans la corriger. Une pierre tombale n'offre rien.
	const correctionOfferte = estAuteur && !activite.retiree
	const retraitOffert = (estAuteur || estAdminWorkspace) && !activite.retiree
	const parModeration = !estAuteur

	if (activite.retiree) {
		return (
			<li data-testid="ligne-activite" data-activite={activite.id} className="flex items-start gap-3 border-b border-border py-2 last:border-b-0">
				<span aria-hidden="true" className={`${CLASSES_PASTILLE} ${PASTILLE_ACTIVITE_RETIREE}`}>
					<Icone size={16} strokeWidth={2} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="italic text-text-2" data-testid="activite-retiree">
						{activite.retireeParModeration ? t('activities.retired.moderation') : t('activities.retired')}
					</p>
					<p className="text-sm text-text-2">
						<time dateTime={activite.survenueLe}>{formaterDateActivite(activite.survenueLe)}</time>
					</p>
				</div>
			</li>
		)
	}

	if (enCorrection) {
		return (
			<li data-testid="ligne-activite" data-activite={activite.id} className="border-b border-border py-2 last:border-b-0">
				<FormulaireActivite
					titre={t('activities.form.edit')}
					libelleEnvoi={t('activities.form.submit.edit')}
					initiale={activite}
					proposes={proposes}
					onAnnuler={() => onFermer(`corriger:${activite.id}`)}
					onEnvoyer={onCorriger}
				/>
			</li>
		)
	}

	const noms = nomsParticipants(activite)
	const nomAuteur =
		activite.auteurId === null ? t('activities.author.deleted') : (activite.auteur?.full_name ?? null)

	return (
		<li
			data-testid="ligne-activite"
			data-activite={activite.id}
			className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0"
		>
			<div className="flex items-start gap-3">
				<span aria-hidden="true" className={`${CLASSES_PASTILLE} ${PASTILLE_ACTIVITE}`}>
					<Icone size={16} strokeWidth={2} />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="font-medium text-ink break-words" data-testid="sujet-activite">
						{activite.sujet}
					</p>
					<p className="text-sm text-text-2">
						<span data-testid="type-activite">{t(presentation.cle)}</span>
						<span className="before:content-['·'] before:mx-1">
							<time dateTime={activite.survenueLe}>{formaterDateActivite(activite.survenueLe)}</time>
						</span>
						{activite.dureeMinutes === null ? null : (
							<span className="before:content-['·'] before:mx-1 tabular-nums">
								{t('activities.duration', { minutes: String(activite.dureeMinutes) })}
							</span>
						)}
						{nomAuteur === null ? null : (
							<span className="before:content-['·'] before:mx-1">{t('activities.author', { nom: nomAuteur })}</span>
						)}
						{activite.modifieLe === null ? null : (
							<span
								className="before:content-['·'] before:mx-1"
								title={t('activities.edited.title', { date: formaterDateActivite(activite.modifieLe) })}
							>
								{t('activities.edited')}
							</span>
						)}
					</p>
					{noms.length === 0 ? null : (
						<p className="text-sm text-ink" data-testid="participants-activite">
							{t('activities.with', { noms: noms.join(', ') })}
						</p>
					)}
					{activite.compteRendu === null ? null : (
						<details className="text-sm">
							<summary className="inline-flex min-h-[var(--size-target)] cursor-pointer items-center text-brand focus:outline-none focus:ring-2 focus:ring-brand rounded-sm">
								{t('activities.body')}
							</summary>
							<p className="whitespace-pre-wrap break-words text-ink" data-testid="compte-rendu-activite">
								{activite.compteRendu}
							</p>
						</details>
					)}
				</div>
			</div>
			{enRetrait ? (
				<ConfirmationRetrait
					sujet={activite.sujet}
					parModeration={parModeration}
					nomAuteur={nomAuteur}
					onConfirmer={onRetirer}
					onAnnuler={() => onFermer(`retirer:${activite.id}`)}
				/>
			) : correctionOfferte || retraitOffert ? (
				<div className="flex flex-wrap justify-end gap-1" data-testid="actions-activite">
					{correctionOfferte ? (
						<Button
							{...droit}
							variante="discret"
							taille="compacte"
							data-retour={`corriger:${activite.id}`}
							aria-label={t('activities.action.edit.aria', { sujet: activite.sujet })}
							onClick={() => onOuvrir({ genre: 'correction', id: activite.id })}
						>
							{t('activities.action.edit')}
						</Button>
					) : null}
					{retraitOffert ? (
						<Button
							{...droit}
							variante="discret"
							taille="compacte"
							data-retour={`retirer:${activite.id}`}
							aria-label={t('activities.action.retire.aria', { sujet: activite.sujet })}
							onClick={() => onOuvrir({ genre: 'retrait', id: activite.id })}
						>
							{t('activities.action.retire')}
						</Button>
					) : null}
				</div>
			) : null}
		</li>
	)
}

/** La confirmation du retrait, sur la ligne et dans le flux ; le texte d'un modérateur est distinct (§5.10, §5.63). */
function ConfirmationRetrait({
	sujet,
	parModeration,
	nomAuteur,
	onConfirmer,
	onAnnuler,
}: {
	readonly sujet: string
	readonly parModeration: boolean
	readonly nomAuteur: string | null
	readonly onConfirmer: () => Promise<NatureRefusActivite | null>
	readonly onAnnuler: () => void
}) {
	const droit = useRefus()
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusActivite | null>(null)
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-retrait-activite"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<p className="font-medium break-words">{t('activities.retire.title', { sujet })}</p>
			<p className="text-sm text-text-2">
				{parModeration
					? t('activities.retire.body.moderation', { nom: nomAuteur ?? t('activities.author.deleted') })
					: t('activities.retire.body')}
			</p>
			{refus === null ? null : (
				<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t(MESSAGES_REFUS_ACTIVITE[refus])}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					{...droit}
					ref={premier}
					variante="destructif"
					disabled={droit.disabled === true || enCours}
					data-testid="confirmer-retrait-activite"
					onClick={() => {
						setEnCours(true)
						setRefus(null)
						// `null` : le geste a porté, ou le bloc l'a dit sous la liste ; la confirmation est alors démontée.
						void onConfirmer().then((nature) => {
							if (nature === null) return
							setEnCours(false)
							setRefus(nature)
						})
					}}
				>
					{enCours ? t('activities.retire.pending') : t('activities.retire.confirm')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('activities.retire.cancel')}
				</Button>
			</div>
		</div>
	)
}

/** Ce que le formulaire remonte : une saisie déjà convertie pour `lib/activites`. */
export type SaisieFormulaire = Parameters<typeof consignerActivite>[2]

/**
 * Le formulaire, commun à l'ajout et à la correction (§5.63).
 *
 * `onEnvoyer` rend `null` quand l'écriture a porté, ou quand le bloc a dit l'issue sous la liste (« sans effet »,
 * « retirée ») : le formulaire est alors démonté. Toute autre nature le laisse ouvert, la saisie conservée et le motif
 * écrit dedans (§5.7 ter).
 */
function FormulaireActivite({
	titre,
	libelleEnvoi,
	initiale,
	proposes,
	onAnnuler,
	onEnvoyer,
}: {
	readonly titre: string
	readonly libelleEnvoi: string
	readonly initiale: ActiviteAffichee | null
	readonly proposes: Proposes | null
	readonly onAnnuler: () => void
	readonly onEnvoyer: (saisie: SaisieFormulaire) => Promise<NatureRefusActivite | null>
}) {
	const droit = useRefus()
	const prefixe = initiale === null ? 'activite-nouvelle' : `activite-${initiale.id}`
	const [type, setType] = useState<TypeActivite>(initiale?.type ?? 'call')
	const champDateInitial = useRef(versChampLocal(initiale?.survenueLe ?? new Date().toISOString()))
	const [date, setDate] = useState(champDateInitial.current)
	const [duree, setDuree] = useState(initiale?.dureeMinutes === null || initiale === null ? '' : String(initiale.dureeMinutes))
	const [sujet, setSujet] = useState(initiale?.sujet ?? '')
	const [compteRendu, setCompteRendu] = useState(initiale?.compteRendu ?? '')
	const [contacts, setContacts] = useState<ReadonlySet<string>>(
		() => new Set(initiale?.contacts.map((p) => p.id) ?? []),
	)
	const [membres, setMembres] = useState<ReadonlySet<string>>(() => new Set(initiale?.membres.map((p) => p.id) ?? []))
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const premierChamp = useRef<HTMLInputElement>(null)
	const boutonEnvoi = useRef<HTMLButtonElement>(null)
	// Le `max` du champ de date : une aide, jamais la règle — la base juge, avec sa tolérance (§2).
	const [maintenant] = useState(() => versChampLocal(new Date().toISOString()))

	useEffect(() => {
		premierChamp.current?.focus()
	}, [])

	// APRÈS UN REFUS, LE FOCUS REVIENT AU BOUTON D'ENVOI, une fois réactivé (§5.63). Désactivé pendant le vol, il avait
	// perdu le focus au profit du `body` : `Échap` ne refermait plus rien, et le clavier repartait du haut de la page.
	// Défaut trouvé par `e2e/ui/activites.spec.ts` — jsdom ne retire pas le focus d'un bouton désactivé, et la preuve
	// unitaire ne pouvait pas le voir.
	useEffect(() => {
		if (!enVol && refus !== null) boutonEnvoi.current?.focus()
	}, [enVol, refus])

	const envoyer = async () => {
		const dureeLue = lireDuree(duree)
		if (!dureeLue.ok) {
			setRefus(MESSAGES_REFUS_ACTIVITE.duree)
			return
		}
		// UNE DATE INCHANGÉE EST RENVOYÉE TELLE QUE LA BASE LA PORTE : le champ arrondit à la minute, et réécrire
		// l'instant arrondi marquerait « modifiée » une activité dont on n'a corrigé que les participants.
		const survenueLe =
			initiale !== null && date === champDateInitial.current ? initiale.survenueLe : depuisChampLocal(date)
		if (survenueLe === null) {
			setRefus(CLE_REFUS_DATE)
			return
		}
		setEnVol(true)
		setRefus(null)
		const nature = await onEnvoyer({
			type,
			survenueLe,
			dureeMinutes: dureeLue.valeur,
			sujet,
			compteRendu,
			contacts: [...contacts],
			membres: [...membres],
		})
		if (nature === null) return
		setEnVol(false)
		setRefus(MESSAGES_REFUS_ACTIVITE[nature])
	}

	const echap = (evenement: KeyboardEvent<HTMLElement>) => {
		if (evenement.key === 'Escape') onAnnuler()
	}

	return (
		// `noValidate` : LES REFUS SE DISENT DANS LE FORMULAIRE, PAR LE DICTIONNAIRE (§5.63, §5.7 ter), jamais par la bulle
		// du navigateur, qui parle une autre langue que l'écran et disparaît d'elle-même. `required`, `min` et `max`
		// restent : ils disent au lecteur d'écran ce qui est attendu, et la base reste seule juge.
		<form
			noValidate
			data-testid="formulaire-activite"
			aria-labelledby={`${prefixe}-titre`}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onKeyDown={echap}
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
		>
			<h3 id={`${prefixe}-titre`} className="font-medium text-ink">
				{titre}
			</h3>

			<fieldset className="flex flex-col gap-1">
				<legend className="text-sm text-text-2">{t('activities.form.type')}</legend>
				<div className="flex flex-wrap gap-x-4">
					{TYPES_ACTIVITE.map((valeur, rang) => {
						const Icone = PRESENTATION_ACTIVITE[valeur].icone
						return (
							<label key={valeur} className="inline-flex min-h-[var(--size-target)] items-center gap-2">
								<input
									ref={rang === 0 ? premierChamp : undefined}
									type="radio"
									name={`${prefixe}-type`}
									value={valeur}
									checked={type === valeur}
									onChange={() => setType(valeur)}
									className="size-6 accent-[var(--color-brand)]"
								/>
								<Icone aria-hidden="true" size={16} strokeWidth={2} className="text-brand" />
								<span>{t(PRESENTATION_ACTIVITE[valeur].cle)}</span>
							</label>
						)
					})}
				</div>
			</fieldset>

			<div className="grid gap-3 md:grid-cols-2">
				<div className="flex flex-col gap-1">
					<label htmlFor={`${prefixe}-date`} className="text-sm text-text-2">
						{t('activities.form.date')}
					</label>
					<input
						id={`${prefixe}-date`}
						type="datetime-local"
						required
						max={maintenant}
						value={date}
						onChange={(evenement) => setDate(evenement.target.value)}
						className={CLASSES_CONTROLE}
						data-testid="champ-date-activite"
					/>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={`${prefixe}-duree`} className="text-sm text-text-2">
						{t('activities.form.duration')}
					</label>
					<input
						id={`${prefixe}-duree`}
						type="number"
						inputMode="numeric"
						min={DUREE_MIN}
						max={DUREE_MAX}
						step={1}
						value={duree}
						onChange={(evenement) => setDuree(evenement.target.value)}
						aria-describedby={`${prefixe}-duree-aide`}
						className={`${CLASSES_CONTROLE} tabular-nums`}
						data-testid="champ-duree-activite"
					/>
				</div>
			</div>
			<p id={`${prefixe}-duree-aide`} className="text-sm text-text-2">
				{t('activities.form.duration.help')}
			</p>

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-sujet`} className="text-sm text-text-2">
					{t('activities.form.subject')}
				</label>
				<input
					id={`${prefixe}-sujet`}
					type="text"
					required
					maxLength={LONGUEUR_MAX_SUJET}
					value={sujet}
					onChange={(evenement) => setSujet(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-sujet-activite"
				/>
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-compte-rendu`} className="text-sm text-text-2">
					{t('activities.form.body')}
				</label>
				<textarea
					id={`${prefixe}-compte-rendu`}
					rows={4}
					maxLength={LONGUEUR_MAX_COMPTE_RENDU}
					value={compteRendu}
					onChange={(evenement) => setCompteRendu(evenement.target.value)}
					className={`${CLASSES_CONTROLE} py-2`}
					data-testid="champ-compte-rendu-activite"
				/>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="text-sm text-text-2">{t('activities.form.participants')}</legend>
				<GroupeParticipants
					legende={t('activities.form.participants.contacts')}
					etat={proposes?.contacts ?? enChargement()}
					cleVide={CLES_GROUPE_CONTACTS.vide}
					cleErreur={CLES_GROUPE_CONTACTS.erreur}
					initiaux={initiale?.contacts ?? []}
					choisis={contacts}
					onChoisis={setContacts}
					prefixe={`${prefixe}-contact`}
				/>
				<GroupeParticipants
					legende={t('activities.form.participants.members')}
					etat={proposes?.membres ?? enChargement()}
					cleVide={CLES_GROUPE_MEMBRES.vide}
					cleErreur={CLES_GROUPE_MEMBRES.erreur}
					initiaux={initiale?.membres ?? []}
					choisis={membres}
					onChoisis={setMembres}
					prefixe={`${prefixe}-membre`}
				/>
			</fieldset>

			{refus === null ? null : (
				<p role="alert" data-testid="refus-activite" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t(refus)}
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				<Button
					{...droit}
					ref={boutonEnvoi}
					type="submit"
					variante="primaire"
					disabled={droit.disabled === true || enVol || sujet.trim() === ''}
					data-testid="envoyer-activite"
				>
					{enVol ? t('activities.form.pending') : libelleEnvoi}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('activities.form.cancel')}
				</Button>
			</div>
		</form>
	)
}

/**
 * Un groupe de cases de participants.
 *
 * UN PARTICIPANT DÉJÀ POSÉ QUE LA LISTE NE PROPOSE PLUS — contact détaché de l'affaire depuis — reste offert, coché, et
 * nommé : sans sa case, la correction ne pourrait pas le retirer. Un participant dont la base ne rend pas le nom n'a pas
 * de case, faute de quoi le nommer (§5.63).
 */
function GroupeParticipants({
	legende,
	etat,
	cleVide,
	cleErreur,
	initiaux,
	choisis,
	onChoisis,
	prefixe,
}: {
	readonly legende: string
	readonly etat: EtatAsync<readonly Personne[]>
	readonly cleVide: CleTraduction
	readonly cleErreur: CleTraduction
	readonly initiaux: readonly ParticipantAffiche[]
	readonly choisis: ReadonlySet<string>
	readonly onChoisis: (suivants: ReadonlySet<string>) => void
	readonly prefixe: string
}) {
	const basculer = (id: string) => {
		const suivants = new Set(choisis)
		if (suivants.has(id)) suivants.delete(id)
		else suivants.add(id)
		onChoisis(suivants)
	}
	const proposes = etat.statut === 'pret' ? etat.donnees : []
	const connus = new Set(proposes.map((p) => p.id))
	const personnes: readonly Personne[] = [
		...proposes,
		...initiaux.flatMap((p) => (p.nom === null || connus.has(p.id) ? [] : [{ id: p.id, nom: p.nom }])),
	]
	return (
		<fieldset className="flex flex-col gap-1">
			<legend className="text-sm font-medium text-ink">{legende}</legend>
			{etat.statut === 'chargement' ? (
				<p className="text-sm text-text-2" aria-busy="true">
					{t('activities.form.participants.loading')}
				</p>
			) : null}
			{etat.statut === 'erreur' ? <p className="text-sm text-text-2">{t(cleErreur)}</p> : null}
			{etat.statut === 'pret' && personnes.length === 0 ? <p className="text-sm text-text-2">{t(cleVide)}</p> : null}
			{personnes.length > 0 ? (
				<div className="grid md:grid-cols-2 gap-x-4">
					{personnes.map((personne) => (
						<label key={personne.id} className="inline-flex min-h-[var(--size-target)] items-center gap-2 min-w-0">
							<input
								id={`${prefixe}-${personne.id}`}
								type="checkbox"
								checked={choisis.has(personne.id)}
								onChange={() => basculer(personne.id)}
								className="size-6 shrink-0 accent-[var(--color-brand)]"
							/>
							<span className="break-words">{personne.nom}</span>
						</label>
					))}
				</div>
			) : null}
		</fieldset>
	)
}
