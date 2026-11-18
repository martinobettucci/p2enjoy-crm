// @spec CRM-156 (docs/BACKLOG.md) — tranche T3 : l'écran de la sélection dans l'inbox — la case d'un fil, la rangée d'action
//       et « Tout sélectionner », la barre d'actions groupées, la confirmation de chaque action avec son argument, la jauge
//       des paquets et le compte rendu des faits et des refus
// @spec docs/DESIGN_SYSTEM.md §5.109 ; docs/SPEC-mail-subsystem.md §32.3 à §32.6 ; docs/JOURNAL.md décisions 944, 946 et
//       949 ; docs/DESIGN_SYSTEM.md §5.59 (une option refusée par une capacité), §5.94 (le sélecteur d'affaire réemployé),
//       §5.3 septies (le panneau d'échéance réemployé), §5.29 (la jauge), §5.13 (dans le flux, le focus)
// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : la ligne du filtre par expéditeur et son vide ; l'option « Transférer à un
//       membre » et son `select` ; « Bloquer l'expéditeur » sous le seul filtre expéditeur, sa double confirmation et son
//       bilan ; « Créer des contacts », la liste à vérifier et son compte rendu
// @spec docs/DESIGN_SYSTEM.md §5.109 bis ; docs/SPEC-mail-subsystem.md §32.7 à §32.10 ; docs/JOURNAL.md décisions 945 et
//       947 ; docs/DESIGN_SYSTEM.md §5.77 (les mots de l'import repris)
//
// AUCUN DROIT N'EST APPLIQUÉ ICI : la base calcule la portée parmi ce que la personne voit et passe chaque message par sa
// fonction unitaire (`CLAUDE.md` §10). Une capacité refusée éteint une option avec son mot ; tout le reste se dit dans le
// compte rendu.

import { useEffect, useId, useRef, useState } from 'react'
import { ArchiveRestore, CheckCheck, ShieldBan, Trash2, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { EtatVide } from '../components/ui/States'
import { CLE_PRESET_SOMMEIL } from '../components/ui/Sommeil'
import { t, type CleTraduction } from '../i18n'
import type { Capacite } from '../lib/capacites'
import {
	appliquerParPaquets,
	compterPortee,
	nombreRefus,
	type ActionGroupee,
	type ComptePortee,
	type CompteRendu,
	type PorteeGroupee,
} from '../lib/actions-groupees'
import type { EtatAsync } from '../lib/async'
import type { Candidate } from '../lib/candidats-classement'
import { ECHEANCES_USUELLES, echeanceSaisie, echeanceUsuelle } from '../lib/sommeil-card'
import { clientCrm } from '../lib/supabase'
import type { CataloguePastilles } from './PastillesInbox'
import { SelecteurClassement, lecteurBase } from './SelecteurClassement'
import { SelectMembre } from './TransfertInbox'
import {
	bloquerExpediteur,
	compterImpactBlocage,
	creerContacts,
	lireExpediteursInconnus,
	type ExpediteurInconnu,
	type IssueContact,
} from '../lib/transferts-inbox'

/** Les options du `select` « Action » (§5.109). */
export type ChoixAction =
	| 'mark_read'
	| 'mark_unread'
	| 'classify'
	| 'unclassify'
	| 'label_on'
	| 'label_off'
	| 'reevaluate'
	| 'snooze'
	| 'wake'
	| 'delete_here'
	| 'delete_everywhere'
	| 'restore'
	| 'transfer'
	| 'contacts'

const LIBELLE_OPTION: Readonly<Record<ChoixAction, CleTraduction>> = {
	mark_read: 'inbox.bulk.option.mark_read',
	mark_unread: 'inbox.bulk.option.mark_unread',
	classify: 'inbox.bulk.option.classify',
	unclassify: 'inbox.bulk.option.unclassify',
	label_on: 'inbox.bulk.option.label_on',
	label_off: 'inbox.bulk.option.label_off',
	reevaluate: 'inbox.bulk.option.reevaluate',
	snooze: 'inbox.bulk.option.snooze',
	wake: 'inbox.bulk.option.wake',
	delete_here: 'inbox.bulk.option.delete_here',
	delete_everywhere: 'inbox.bulk.option.delete_everywhere',
	restore: 'inbox.bulk.option.restore',
	transfer: 'inbox.bulk.option.transfer',
	contacts: 'inbox.bulk.option.contacts',
}

/** « Créer des contacts » n'a pas de question : sa liste à vérifier remplace la confirmation (§5.109 bis). */
const QUESTION: Readonly<Record<Exclude<ChoixAction, 'contacts'>, CleTraduction>> = {
	mark_read: 'inbox.bulk.question.mark_read',
	mark_unread: 'inbox.bulk.question.mark_unread',
	classify: 'inbox.bulk.question.classify',
	unclassify: 'inbox.bulk.question.unclassify',
	label_on: 'inbox.bulk.question.label_on',
	label_off: 'inbox.bulk.question.label_off',
	reevaluate: 'inbox.bulk.question.reevaluate',
	snooze: 'inbox.bulk.question.snooze',
	wake: 'inbox.bulk.question.wake',
	delete_here: 'inbox.bulk.question.delete_here',
	delete_everywhere: 'inbox.bulk.question.delete_everywhere',
	restore: 'inbox.bulk.question.restore',
	transfer: 'inbox.bulk.question.transfer',
}

/** Les refus nommés de la base (§32.5), traduits par le dictionnaire de l'action unitaire, au pluriel (§32.6). */
const MOTIF_REFUS: Readonly<Record<string, CleTraduction>> = {
	forbidden: 'inbox.bulk.refus.forbidden',
	message_not_found: 'inbox.bulk.refus.message_not_found',
	card_not_available: 'inbox.bulk.refus.card_not_available',
	no_writable_mailbox: 'inbox.bulk.refus.no_writable_mailbox',
	label_not_found: 'inbox.bulk.refus.label_not_found',
	label_archived: 'inbox.bulk.refus.label_archived',
	outbound_message: 'inbox.bulk.refus.outbound_message',
	thread_not_found: 'inbox.bulk.refus.thread_not_found',
	snooze_date_in_past: 'inbox.bulk.refus.snooze_date_in_past',
	snooze_date_required: 'inbox.bulk.refus.snooze_date_required',
	recipient_not_member: 'inbox.bulk.refus.recipient_not_member',
	self_transfer: 'inbox.bulk.refus.self_transfer',
}

/** Les groupes du `select` et leur ordre (§5.109). */
const GROUPES: readonly { readonly titre: CleTraduction; readonly options: readonly ChoixAction[] }[] = [
	{ titre: 'inbox.bulk.groupe.lecture', options: ['mark_read', 'mark_unread'] },
	{ titre: 'inbox.bulk.groupe.classement', options: ['classify', 'unclassify'] },
	{ titre: 'inbox.bulk.groupe.pastilles', options: ['label_on', 'label_off', 'reevaluate'] },
	{ titre: 'inbox.bulk.groupe.sommeil', options: ['snooze', 'wake'] },
	// `CRM-156` T4 (§5.109 bis) : le geste qui partage, puis celui qui crée, avant ceux qui retirent.
	{ titre: 'inbox.bulk.groupe.partage', options: ['transfer'] },
	{ titre: 'inbox.bulk.groupe.contacts', options: ['contacts'] },
	{ titre: 'inbox.bulk.groupe.suppression', options: ['delete_here', 'delete_everywhere'] },
]

/** Les actions qui suivent la capacité d'ÉDITER l'espace (§5.103, décision 926 ; §5.109 bis pour le transfert et les contacts). */
const SUIT_L_EDITION: ReadonlySet<ChoixAction> = new Set(['label_on', 'label_off', 'reevaluate', 'transfer', 'contacts'])

/** Le nombre de fils et de messages, accordé par clé (§10). */
export function textePortee(compte: ComptePortee): string {
	const fils = compte.fils === 1 ? t('inbox.bulk.fils.un') : t('inbox.bulk.fils.plusieurs', { n: String(compte.fils) })
	const messages =
		compte.messages === 1 ? t('inbox.bulk.messages.un') : t('inbox.bulk.messages.plusieurs', { n: String(compte.messages) })
	return t('inbox.bulk.portee', { fils, messages })
}

const texteMessages = (n: number): string =>
	n === 1 ? t('inbox.bulk.messages.un') : t('inbox.bulk.messages.plusieurs', { n: String(n) })
const texteFils = (n: number): string => (n === 1 ? t('inbox.bulk.fils.un') : t('inbox.bulk.fils.plusieurs', { n: String(n) }))

// =================================================================================================
// Le filtre par expéditeur — §5.109 bis (`CRM-156` T4)
// =================================================================================================

/** La ligne qui montre le filtre par expéditeur et le retire, sous les filtres rapides (§5.109 bis). */
export function FiltreExpediteur({ adresse, onRetirer }: { readonly adresse: string; readonly onRetirer: () => void }) {
	return (
		<div
			className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border"
			data-testid="inbox-filtre-expediteur"
		>
			<span className="text-sm text-text-2">{t('inbox.sender.label')}</span>
			<code className="text-sm break-all">{adresse}</code>
			<Button variante="discret" taille="compacte" data-testid="inbox-filtre-expediteur-retirer" onClick={onRetirer}>
				<X aria-hidden="true" size={16} />
				{t('inbox.sender.remove')}
			</Button>
		</div>
	)
}

/** Le vide sous le filtre par expéditeur, qui le nomme et porte le geste qui le retire (§5.51). */
export function VideExpediteur({ adresse, onRetirer }: { readonly adresse: string; readonly onRetirer: () => void }) {
	return (
		<EtatVide
			titre={t('inbox.sender.empty', { adresse })}
			corps=""
			action={
				<Button taille="compacte" data-testid="inbox-filtre-expediteur-vide" onClick={onRetirer}>
					{t('inbox.sender.remove')}
				</Button>
			}
		/>
	)
}

// =================================================================================================
// La case d'un fil — §5.109
// =================================================================================================

/** La case d'un fil (ou d'un message dans la corbeille), hors du bouton de la ligne (§5.106, §5.109). */
export function CaseSelection({
	cochee,
	onBasculer,
	libelle,
}: {
	readonly cochee: boolean
	readonly onBasculer: () => void
	readonly libelle: string
}) {
	return (
		<span className="flex shrink-0 items-center justify-center w-[var(--size-target)] self-stretch">
			<input
				type="checkbox"
				className="size-6 accent-brand"
				checked={cochee}
				onChange={onBasculer}
				aria-label={libelle}
				data-testid="inbox-case-fil"
			/>
		</span>
	)
}

// =================================================================================================
// La rangée, la barre, la confirmation, le compte rendu — §5.109
// =================================================================================================

export type SelectionGroupee =
	| { readonly genre: 'aucune' }
	| { readonly genre: 'fils'; readonly nombre: number }
	| { readonly genre: 'tout' }

export function ActionsGroupees({
	nonLusAffiches,
	onToutMarquer,
	filtreExplicite,
	selection,
	onToutSelectionner,
	onDeselectionner,
	portee,
	dansUneAffaire,
	dansLaCorbeille = false,
	edition,
	catalogue,
	idEspace,
	ancre,
	retention,
	onTermine,
	idMoi = null,
	administration = 'inconnue',
	onBloque,
}: {
	/** `CRM-156` T4 (§5.109 bis) : la personne, exceptée des membres à qui transférer. */
	readonly idMoi?: string | null
	/** `CRM-156` T4 : la capacité d'administrer l'espace (§5.59) — elle seule rend « Bloquer l'expéditeur ». */
	readonly administration?: Capacite
	/** `CRM-156` T4 : l'expéditeur est bloqué ; l'appelant retire le filtre, relit la liste et rend le bilan. */
	readonly onBloque?: (adresse: string, corbeille: number) => void
	/** « Tout marquer comme lu » (§5.4 quinquies), gardé dans la rangée ; vide dans la corbeille. */
	readonly nonLusAffiches: readonly string[]
	readonly onToutMarquer: (ids: readonly string[]) => void
	/** Un filtre explicite est-il appliqué ? (§32.3) — il ouvre « Tout sélectionner ». */
	readonly filtreExplicite: boolean
	readonly selection: SelectionGroupee
	readonly onToutSelectionner: () => void
	readonly onDeselectionner: () => void
	/** La portée de la sélection courante. */
	readonly portee: PorteeGroupee
	/** Le dossier est celui d'une affaire : « Retirer de l'affaire » y est offert. */
	readonly dansUneAffaire: boolean
	readonly dansLaCorbeille?: boolean
	readonly edition: Capacite
	readonly catalogue: CataloguePastilles
	readonly idEspace: string | null
	/** Le message qui ancre le sélecteur d'affaire (§5.94) : le dernier message du premier fil visible. */
	readonly ancre: { readonly messageId: string; readonly expediteur: string } | null
	/** La rétention de la corbeille, lue en base (§29.6) ; `null` si elle n'a pas pu l'être. */
	readonly retention: number | null
	/** Après l'issue : la sélection est vidée, la liste et l'arborescence relues. */
	readonly onTermine: () => void
}) {
	const [choix, setChoix] = useState<ChoixAction | ''>('')
	const [ouverte, setOuverte] = useState<ChoixAction | null>(null)
	const [compteRendu, setCompteRendu] = useState<
		| { readonly genre: 'action'; readonly action: ChoixAction; readonly compte: CompteRendu }
		| { readonly genre: 'contacts'; readonly issues: readonly IssueContact[] }
		| null
	>(null)
	const [blocage, setBlocage] = useState(false)
	const refBloquer = useRef<HTMLButtonElement | null>(null)
	const refSelect = useRef<HTMLSelectElement | null>(null)
	const refRestaurer = useRef<HTMLButtonElement | null>(null)
	const refTitreCompteRendu = useRef<HTMLHeadingElement | null>(null)
	const idSelect = useId()
	const [compteTout, setCompteTout] = useState<EtatAsync<ComptePortee> | null>(null)

	// « TOUT LE FILTRE » DIT SON NOMBRE, LU EN BASE (§32.4) — jamais un compte de la page.
	const cleTout = selection.genre === 'tout' ? JSON.stringify(portee) : null
	useEffect(() => {
		if (cleTout === null) {
			setCompteTout(null)
			return
		}
		let vivant = true
		setCompteTout({ statut: 'chargement' })
		void compterPortee(clientCrm, portee).then((lu) => {
			if (vivant) setCompteTout(lu)
		})
		return () => {
			vivant = false
		}
		// La clé porte la portée entière : la relire à chaque rendu relancerait le comptage sans fin.
	}, [cleTout])

	// LE RETOUR DU FOCUS EST DIFFÉRÉ D'UN TOUR DE RENDU (§5.25, §5.29) : pendant la confirmation, le `select` est désactivé,
	// et un élément désactivé refuse le focus — appelé depuis « Annuler », il retombait sur le document (trouvé par la preuve
	// unitaire). Un drapeau, puis un effet ; aucune temporisation (`CLAUDE.md` §18).
	const [rendreFocus, setRendreFocus] = useState(false)
	useEffect(() => {
		if (!rendreFocus || ouverte !== null) return
		setRendreFocus(false)
		if (refSelect.current !== null) refSelect.current.focus()
		else refRestaurer.current?.focus()
	}, [rendreFocus, ouverte])

	// Le titre du compte rendu prend le focus : la barre qui le portait vient de disparaître (§5.13).
	useEffect(() => {
		if (compteRendu !== null) refTitreCompteRendu.current?.focus()
	}, [compteRendu])

	const avecSelection = selection.genre !== 'aucune'
	const options = dansLaCorbeille
		? [{ titre: 'inbox.bulk.groupe.suppression' as CleTraduction, options: ['restore'] as readonly ChoixAction[] }]
		: GROUPES.map((groupe) => ({
				...groupe,
				options: groupe.options.filter((option) => option !== 'unclassify' || dansUneAffaire),
			}))
	const refusee = (option: ChoixAction) => SUIT_L_EDITION.has(option) && edition === 'refusee'

	// `CRM-156` T4 (§5.109 bis) — « BLOQUER L'EXPÉDITEUR » N'EXISTE QUE SOUS LE SEUL FILTRE EXPÉDITEUR, et quand la base
	// consent l'administration de l'espace : un geste qui vise l'expéditeur du filtre n'a pas d'objet sans lui.
	const adresseBloquable =
		!dansLaCorbeille &&
		idEspace !== null &&
		administration === 'permise' &&
		portee.expediteur !== null &&
		portee.expediteur.trim() !== '' &&
		portee.pastilles.length === 0 &&
		!portee.seulementMoi
			? portee.expediteur.trim()
			: null
	const commandeBloquer =
		adresseBloquable === null ? null : (
			<Button
				ref={refBloquer}
				variante="discret"
				taille="compacte"
				className="ml-auto"
				data-testid="inbox-bloquer-expediteur"
				disabled={blocage || ouverte !== null}
				onClick={() => {
					setCompteRendu(null)
					setBlocage(true)
				}}
			>
				<ShieldBan aria-hidden="true" size={16} />
				{t('inbox.block.command')}
			</Button>
		)

	const rangeeVisible =
		avecSelection ||
		ouverte !== null ||
		adresseBloquable !== null ||
		(!dansLaCorbeille && (filtreExplicite || nonLusAffiches.length > 0))

	return (
		<>
			{rangeeVisible ? (
				<div
					className="flex flex-wrap items-center gap-2 px-3 py-1 border-b border-border"
					data-testid="inbox-rangee-action"
				>
					{avecSelection ? (
						<>
							<p role="status" className="text-sm font-medium text-ink" data-testid="inbox-selection-compte">
								{selection.genre === 'fils'
									? dansLaCorbeille
										? selection.nombre === 1
											? t('inbox.bulk.compte.messages.un')
											: t('inbox.bulk.compte.messages.plusieurs', { n: String(selection.nombre) })
										: selection.nombre === 1
											? t('inbox.bulk.compte.un')
											: t('inbox.bulk.compte.plusieurs', { n: String(selection.nombre) })
									: compteTout === null || compteTout.statut === 'chargement'
										? t('inbox.bulk.comptage')
										: compteTout.statut === 'erreur'
											? t('inbox.bulk.compte.toutSansNombre')
											: t('inbox.bulk.compte.tout', { portee: textePortee(compteTout.donnees) })}
							</p>
							<Button
								variante="discret"
								taille="compacte"
								data-testid="inbox-deselectionner"
								onClick={() => {
									setOuverte(null)
									setChoix('')
									onDeselectionner()
								}}
							>
								{t('inbox.bulk.deselect')}
							</Button>
							{dansLaCorbeille ? (
								// DANS LA CORBEILLE, UNE SEULE ACTION, « Restaurer » (§5.109, §5.102) : un bouton, pas un `select` d'une option.
								<Button
									variante="secondaire"
									taille="compacte"
									data-testid="inbox-corbeille-restaurer-selection"
									ref={refRestaurer}
									disabled={ouverte !== null}
									onClick={() => {
										setCompteRendu(null)
										setOuverte('restore')
									}}
								>
									<ArchiveRestore aria-hidden="true" size={16} />
									{t('inbox.bulk.option.restore')}
								</Button>
							) : (
							<div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
								<label htmlFor={idSelect} className="text-sm text-text-2">
									{t('inbox.bulk.action.label')}
								</label>
								<select
									id={idSelect}
									ref={refSelect}
									data-testid="inbox-action-groupee"
									className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm w-full md:w-auto"
									value={choix}
									disabled={ouverte !== null}
									onChange={(evenement) => setChoix(evenement.target.value as ChoixAction | '')}
								>
									<option value="">{t('inbox.bulk.action.vide')}</option>
									{options.map((groupe) => (
										<optgroup key={groupe.titre} label={t(groupe.titre)}>
											{groupe.options.map((option) => (
												<option key={option} value={option} disabled={refusee(option)}>
													{refusee(option)
														? t('inbox.bulk.option.nonPermis', { action: t(LIBELLE_OPTION[option]) })
														: t(LIBELLE_OPTION[option])}
												</option>
											))}
										</optgroup>
									))}
								</select>
								<Button
									variante="secondaire"
									taille="compacte"
									data-testid="inbox-action-continuer"
									disabled={choix === '' || ouverte !== null}
									onClick={() => {
										if (choix === '') return
										setCompteRendu(null)
										setOuverte(choix)
									}}
								>
									{t('inbox.bulk.continuer')}
								</Button>
							</div>
							)}
							{commandeBloquer}
						</>
					) : (
						<>
							{filtreExplicite && !dansLaCorbeille ? (
								<Button
									variante="discret"
									taille="compacte"
									data-testid="inbox-tout-selectionner"
									onClick={() => {
										setCompteRendu(null)
										onToutSelectionner()
									}}
								>
									{t('inbox.bulk.selectAll')}
								</Button>
							) : null}
							{nonLusAffiches.length > 0 ? (
								<Button
									variante="discret"
									taille="compacte"
									className="ml-auto"
									data-testid="inbox-tout-marquer-lu"
									onClick={() => onToutMarquer(nonLusAffiches)}
								>
									<CheckCheck aria-hidden="true" size={16} />
									{t('inbox.read.markAll')}
								</Button>
							) : null}
							{commandeBloquer}
						</>
					)}
				</div>
			) : null}
			{blocage && adresseBloquable !== null && idEspace !== null ? (
				<BlocageExpediteur
					idEspace={idEspace}
					adresse={adresseBloquable}
					onAnnuler={() => {
						setBlocage(false)
						requestAnimationFrame(() => refBloquer.current?.focus())
					}}
					onIssue={(corbeille) => {
						setBlocage(false)
						onBloque?.(adresseBloquable, corbeille)
					}}
				/>
			) : null}
			{ouverte === 'contacts' ? (
				<ContactsAVerifier
					portee={portee}
					onAnnuler={() => {
						setOuverte(null)
						setRendreFocus(true)
					}}
					onIssue={(issues) => {
						setOuverte(null)
						setChoix('')
						setCompteRendu({ genre: 'contacts', issues })
						onTermine()
					}}
				/>
			) : ouverte !== null ? (
				<ConfirmationGroupee
					action={ouverte}
					idMoi={idMoi}
					portee={portee}
					catalogue={catalogue}
					idEspace={idEspace}
					ancre={ancre}
					retention={retention}
					onAnnuler={() => {
						setOuverte(null)
						setRendreFocus(true)
					}}
					onIssue={(compte) => {
						setOuverte(null)
						setChoix('')
						setCompteRendu({ genre: 'action', action: ouverte, compte })
						onTermine()
					}}
				/>
			) : null}
			{compteRendu?.genre === 'action' ? (
				<BlocCompteRendu
					action={compteRendu.action}
					compte={compteRendu.compte}
					refTitre={refTitreCompteRendu}
					onFermer={() => setCompteRendu(null)}
				/>
			) : compteRendu?.genre === 'contacts' ? (
				<BilanContacts issues={compteRendu.issues} refTitre={refTitreCompteRendu} onFermer={() => setCompteRendu(null)} />
			) : null}
		</>
	)
}

/** L'action de la base, construite de l'option et de l'argument choisi. */
function actionDe(
	choix: ChoixAction,
	argument: {
		readonly affaire: Candidate | null
		readonly pastille: string
		readonly jusqua: string | null
		readonly destinataire: string
	},
): ActionGroupee | null {
	switch (choix) {
		case 'mark_read':
		case 'mark_unread':
		case 'unclassify':
		case 'wake':
		case 'restore':
			return { genre: choix }
		case 'reevaluate':
			return { genre: 'request_label_evaluation' }
		case 'classify':
			return argument.affaire === null ? null : { genre: 'classify', cardId: argument.affaire.id }
		case 'label_on':
		case 'label_off':
			return argument.pastille === '' ? null : { genre: 'set_label', pastille: argument.pastille, posee: choix === 'label_on' }
		case 'snooze':
			return argument.jusqua === null ? null : { genre: 'snooze', jusqua: argument.jusqua }
		case 'delete_here':
			return { genre: 'delete', partout: false }
		case 'delete_everywhere':
			return { genre: 'delete', partout: true }
		case 'transfer':
			return argument.destinataire === '' ? null : { genre: 'transfer', destinataire: argument.destinataire }
		case 'contacts':
			return null
	}
}

function ConfirmationGroupee({
	action,
	idMoi,
	portee,
	catalogue,
	idEspace,
	ancre,
	retention,
	onAnnuler,
	onIssue,
}: {
	readonly action: Exclude<ChoixAction, 'contacts'>
	readonly idMoi: string | null
	readonly portee: PorteeGroupee
	readonly catalogue: CataloguePastilles
	readonly idEspace: string | null
	readonly ancre: { readonly messageId: string; readonly expediteur: string } | null
	readonly retention: number | null
	readonly onAnnuler: () => void
	readonly onIssue: (compte: CompteRendu) => void
}) {
	const [compte, setCompte] = useState<EtatAsync<ComptePortee>>({ statut: 'chargement' })
	const [essai, setEssai] = useState(0)
	const [affaire, setAffaire] = useState<Candidate | null>(null)
	const [pastille, setPastille] = useState('')
	const [destinataire, setDestinataire] = useState('')
	const [jusqua, setJusqua] = useState<string | null>(null)
	const [usuelle, setUsuelle] = useState<string | null>(null)
	const [saisie, setSaisie] = useState('')
	const [enCours, setEnCours] = useState<CompteRendu | null>(null)
	const refPremier = useRef<HTMLElement | null>(null)
	const refChamp = useRef<HTMLInputElement | null>(null)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idTitre = useId()
	const idPastille = useId()
	const idEcheance = useId()

	useEffect(() => {
		let vivant = true
		setCompte({ statut: 'chargement' })
		void compterPortee(clientCrm, portee).then((lu) => {
			if (vivant) setCompte(lu)
		})
		return () => {
			vivant = false
		}
		// La portée ne change pas pendant que la confirmation est ouverte : la sélection est figée par l'ouverture.
	}, [essai])

	// LE FOCUS ENTRE sur le premier contrôle de l'argument, à défaut sur « Annuler » (§5.109, §5.13).
	useEffect(() => {
		if (action === 'classify') refChamp.current?.focus()
		else if (action === 'transfer') return // le `select` « Membre » prend le focus dès que les membres sont lus
		else if (refPremier.current !== null) refPremier.current.focus()
		else refAnnuler.current?.focus()
	}, [action])

	const destructif = action === 'delete_here' || action === 'delete_everywhere'
	const actionPrete = actionDe(action, { affaire, pastille, jusqua, destinataire })
	const vol = enCours !== null
	const comptePret = compte.statut === 'pret' ? compte.donnees : null

	const pastillesProposees = [...catalogue.values()]
		.filter((p) => idEspace === null || p.idEspace === idEspace)
		.filter((p) => action === 'label_off' || !p.archivee)
		.sort((a, b) => Number(a.archivee) - Number(b.archivee) || a.nom.localeCompare(b.nom, 'fr'))

	const confirmer = () => {
		if (actionPrete === null || comptePret === null || vol) return
		setEnCours({ fils: 0, messages: 0, faits: 0, refus: {}, interruption: null })
		void appliquerParPaquets(clientCrm, portee, actionPrete, (courant) => setEnCours(courant)).then(onIssue)
	}

	const consequence =
		action === 'delete_here'
			? retention === null
				? t('inbox.bulk.consequence.delete_here.sansDuree')
				: t('inbox.bulk.consequence.delete_here', { n: String(retention) })
			: action === 'delete_everywhere'
				? retention === null
					? t('inbox.bulk.consequence.delete_everywhere.sansDuree')
					: t('inbox.bulk.consequence.delete_everywhere', { n: String(retention) })
				: action === 'unclassify'
					? t('inbox.bulk.consequence.unclassify')
					: action === 'snooze' || action === 'wake'
						? t('inbox.bulk.consequence.sommeil')
						: null

	return (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="inbox-confirmation-groupee"
			className="mx-3 my-2 rounded-sm border border-border p-3 flex flex-col gap-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !vol) {
					evenement.stopPropagation()
					onAnnuler()
				}
			}}
		>
			<p id={idTitre} className="font-medium text-ink">
				{comptePret === null
					? t(LIBELLE_OPTION[action])
					: t(QUESTION[action], { portee: textePortee(comptePret) })}
			</p>
			{compte.statut === 'chargement' ? (
				<p role="status" className="text-sm text-text-2">
					{t('inbox.bulk.comptage')}
				</p>
			) : null}
			{compte.statut === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					<span>{t('inbox.bulk.comptage.erreur')}</span>
					<Button variante="discret" taille="compacte" onClick={() => setEssai((n) => n + 1)}>
						{t('inbox.bulk.reessayer')}
					</Button>
				</div>
			) : null}
			{consequence !== null ? <p className="text-sm text-text-2">{consequence}</p> : null}

			{action === 'classify' ? (
				ancre === null ? (
					<p className="text-sm text-text-2">{t('inbox.bulk.classify.sansAncre')}</p>
				) : (
					<SelecteurClassement
						messageId={ancre.messageId}
						expediteur={ancre.expediteur}
						choix={affaire}
						onChoisir={setAffaire}
						onEchap={onAnnuler}
						champ={refChamp}
						lire={lecteurBase(clientCrm)}
						connuesInitial={portee.expediteur !== null}
					/>
				)
			) : null}

			{action === 'label_on' || action === 'label_off' ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={idPastille} className="text-sm text-text-2">
						{t('inbox.bulk.pastille.label')}
					</label>
					<select
						id={idPastille}
						ref={(element) => {
							refPremier.current = element
						}}
						data-testid="inbox-groupe-pastille"
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm max-w-[40ch]"
						value={pastille}
						disabled={vol}
						onChange={(evenement) => setPastille(evenement.target.value)}
					>
						<option value="">{t('inbox.bulk.pastille.vide')}</option>
						{pastillesProposees.map((p) => (
							<option key={p.id} value={p.id}>
								{p.archivee ? t('inbox.bulk.pastille.archivee', { nom: p.nom }) : p.nom}
							</option>
						))}
					</select>
				</div>
			) : null}

			{action === 'transfer' ? (
				<SelectMembre
					idEspace={idEspace}
					idMoi={idMoi}
					valeur={destinataire}
					onChange={setDestinataire}
					desactive={vol}
					focusAuChargement
				/>
			) : null}

			{action === 'snooze' ? (
				<fieldset className="flex flex-col gap-2" disabled={vol}>
					<legend className="text-sm text-text-2 mb-1">{t('card.sleep.legend')}</legend>
					<div className="flex flex-wrap gap-2">
						{ECHEANCES_USUELLES.map((echeance, rang) => (
							<Button
								key={echeance.cle}
								variante="discret"
								taille="compacte"
								aria-pressed={usuelle === echeance.cle}
								ref={
									rang === 0
										? (element: HTMLButtonElement | null) => {
												refPremier.current = element
											}
										: undefined
								}
								onClick={() => {
									setUsuelle(echeance.cle)
									setSaisie('')
									setJusqua(echeanceUsuelle(echeance.jours))
								}}
							>
								{t(CLE_PRESET_SOMMEIL[echeance.cle])}
							</Button>
						))}
					</div>
					<label htmlFor={idEcheance} className="text-sm text-text-2">
						{t('card.sleep.custom')}
					</label>
					<input
						id={idEcheance}
						type="datetime-local"
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm max-w-[28ch]"
						value={saisie}
						onChange={(evenement) => {
							setSaisie(evenement.target.value)
							setUsuelle(null)
							setJusqua(echeanceSaisie(evenement.target.value))
						}}
					/>
				</fieldset>
			) : null}

			{vol ? (
				<div className="flex flex-col gap-1">
					<div aria-hidden="true" className="h-[6px] w-full rounded-full bg-brand-soft overflow-hidden">
						<div
							className="h-full bg-brand"
							style={{
								width: `${comptePret === null || comptePret.messages === 0 ? 0 : Math.min(100, Math.round((enCours.messages / comptePret.messages) * 100))}%`,
							}}
						/>
					</div>
					<p role="status" className="text-sm text-text-2 tabular-nums" data-testid="inbox-groupe-progression">
						{t('inbox.bulk.progression', {
							traites: String(enCours.messages),
							total: String(comptePret?.messages ?? enCours.messages),
						})}
					</p>
				</div>
			) : null}

			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" disabled={vol} onClick={onAnnuler}>
					{t('inbox.bulk.annuler')}
				</Button>
				<Button
					variante={destructif ? 'destructif' : 'primaire'}
					taille="compacte"
					data-testid="inbox-groupe-confirmer"
					aria-busy={vol}
					disabled={vol || actionPrete === null || comptePret === null || comptePret.messages === 0}
					onClick={confirmer}
				>
					{destructif ? <Trash2 aria-hidden="true" size={16} /> : null}
					{vol ? t('inbox.bulk.traitement') : t(LIBELLE_OPTION[action])}
				</Button>
			</div>
			{comptePret !== null && comptePret.messages === 0 ? (
				<p className="text-sm text-text-2">{t('inbox.bulk.rien')}</p>
			) : null}
		</div>
	)
}

function BlocCompteRendu({
	action,
	compte,
	refTitre,
	onFermer,
}: {
	readonly action: ChoixAction
	readonly compte: CompteRendu
	readonly refTitre: React.RefObject<HTMLHeadingElement | null>
	readonly onFermer: () => void
}) {
	const refus = nombreRefus(compte)
	const parFil = action === 'snooze' || action === 'wake'
	const interrompu = compte.interruption !== null
	return (
		<div
			role={interrompu ? 'alert' : 'status'}
			data-testid="inbox-compte-rendu"
			className={[
				'mx-3 my-2 rounded-sm p-3 flex flex-col gap-1 text-sm',
				interrompu ? 'bg-danger-soft text-danger-on-soft' : 'border border-border text-ink',
			].join(' ')}
		>
			<h3 ref={refTitre} tabIndex={-1} className="font-medium">
				{t(LIBELLE_OPTION[action])}
			</h3>
			{interrompu ? (
				<p>{t('inbox.bulk.interrompu', { traites: texteMessages(compte.messages) })}</p>
			) : (
				<p data-testid="inbox-compte-rendu-fait">
					{t('inbox.bulk.fait', { quantite: parFil ? texteFils(compte.faits) : texteMessages(compte.faits) })}
				</p>
			)}
			{refus > 0 ? (
				<>
					<p>{t('inbox.bulk.refuses', { n: String(refus) })}</p>
					<ul className="list-disc pl-6 text-text-2" data-testid="inbox-compte-rendu-refus">
						{Object.entries(compte.refus).map(([code, nombre]) => (
							<li key={code}>
								{t('inbox.bulk.refus.ligne', {
									n: String(nombre),
									motif: t(MOTIF_REFUS[code] ?? 'inbox.bulk.refus.unknown'),
								})}
							</li>
						))}
					</ul>
				</>
			) : null}
			<div>
				<Button variante="discret" taille="compacte" onClick={onFermer}>
					{t('inbox.bulk.fermer')}
				</Button>
			</div>
		</div>
	)
}

// =================================================================================================
// Bloquer l'expéditeur — §5.109 bis (`CRM-156` T4, §32.8)
// =================================================================================================

/** Le nombre accordé par clé (§10) : 0, 1, ou plusieurs. */
const accord = (n: number, cles: readonly [CleTraduction, CleTraduction, CleTraduction]): string =>
	n === 0 ? t(cles[0]) : n === 1 ? t(cles[1]) : t(cles[2], { n: String(n) })

/**
 * La double confirmation du blocage, dans le flux sous la rangée (§5.13) : le premier bloc dit ce qui ira à la corbeille,
 * nombre lu en base ; le second confirme, destructif. Le focus entre sur « Annuler » à chaque étape.
 */
function BlocageExpediteur({
	idEspace,
	adresse,
	onAnnuler,
	onIssue,
}: {
	readonly idEspace: string
	readonly adresse: string
	readonly onAnnuler: () => void
	readonly onIssue: (corbeille: number) => void
}) {
	const [etape, setEtape] = useState<1 | 2>(1)
	const [impact, setImpact] = useState<EtatAsync<number>>({ statut: 'chargement' })
	const [essai, setEssai] = useState(0)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idTitre = useId()

	useEffect(() => {
		let vivant = true
		setImpact({ statut: 'chargement' })
		void compterImpactBlocage(clientCrm, idEspace, adresse).then((lu) => {
			if (vivant) setImpact(lu)
		})
		return () => {
			vivant = false
		}
	}, [idEspace, adresse, essai])

	useEffect(() => {
		refAnnuler.current?.focus()
	}, [etape])

	const bloquer = async () => {
		if (enVol) return
		setEnVol(true)
		setRefus(null)
		const issue = await bloquerExpediteur(clientCrm, idEspace, adresse)
		setEnVol(false)
		if ('corbeille' in issue) {
			onIssue(issue.corbeille)
			return
		}
		setRefus(
			issue.detail.includes('invalid_address')
				? 'inbox.block.refus.invalid'
				: issue.nature === 'forbidden' || issue.detail.includes('forbidden')
					? 'inbox.block.refus.forbidden'
					: issue.nature === 'network'
						? 'inbox.block.refus.reseau'
						: 'inbox.block.refus.inconnu',
		)
	}

	return (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="inbox-blocage"
			className="mx-3 my-2 rounded-sm border border-border p-3 flex flex-col gap-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !enVol) {
					evenement.stopPropagation()
					onAnnuler()
				}
			}}
		>
			<p id={idTitre} className="font-medium text-ink break-words">
				{etape === 1 ? t('inbox.block.question', { adresse }) : t('inbox.block.confirmQuestion', { adresse })}
			</p>
			{etape === 1 ? (
				impact.statut === 'chargement' ? (
					<p role="status" className="text-sm text-text-2">
						{t('inbox.block.impact.loading')}
					</p>
				) : impact.statut === 'erreur' ? (
					<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
						<span>{t('inbox.block.impact.error')}</span>
						<Button variante="discret" taille="compacte" onClick={() => setEssai((n) => n + 1)}>
							{t('inbox.bulk.reessayer')}
						</Button>
					</div>
				) : (
					<p className="text-sm text-text-2" data-testid="inbox-blocage-impact">
						{accord(impact.donnees, ['inbox.block.impact.0', 'inbox.block.impact.1', 'inbox.block.impact.n'])}
					</p>
				)
			) : null}
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger" data-testid="inbox-blocage-refus">
					{t(refus)}
				</p>
			) : null}
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" disabled={enVol} onClick={onAnnuler}>
					{t('inbox.block.cancel')}
				</Button>
				{etape === 1 ? (
					<Button
						variante="secondaire"
						taille="compacte"
						data-testid="inbox-blocage-continuer"
						disabled={impact.statut !== 'pret'}
						onClick={() => setEtape(2)}
					>
						{t('inbox.block.continue')}
					</Button>
				) : (
					<Button
						variante="destructif"
						taille="compacte"
						data-testid="inbox-blocage-confirmer"
						disabled={enVol}
						aria-busy={enVol || undefined}
						onClick={() => void bloquer()}
					>
						<ShieldBan aria-hidden="true" size={16} />
						{enVol ? t('inbox.block.busy') : t('inbox.block.confirm', { adresse })}
					</Button>
				)}
			</div>
		</div>
	)
}

/**
 * Le bilan du blocage, titré « Bloquer l'expéditeur » (§5.109 bis). Rendu par la liste, hors de la rangée : le filtre est
 * retiré et la liste relue, et la rangée qui portait la commande n'existe plus.
 */
export function BilanBlocage({ corbeille, onFermer }: { readonly corbeille: number; readonly onFermer: () => void }) {
	const refTitre = useRef<HTMLHeadingElement | null>(null)
	useEffect(() => {
		refTitre.current?.focus()
	}, [])
	return (
		<div role="status" data-testid="inbox-bilan-blocage" className="mx-3 my-2 rounded-sm border border-border p-3 flex flex-col gap-1 text-sm text-ink">
			<h3 ref={refTitre} tabIndex={-1} className="font-medium">
				{t('inbox.block.command')}
			</h3>
			<p data-testid="inbox-bilan-blocage-fait">
				{accord(corbeille, ['inbox.block.done.0', 'inbox.block.done.1', 'inbox.block.done.n'])}
			</p>
			<div>
				<Button variante="discret" taille="compacte" onClick={onFermer}>
					{t('inbox.bulk.fermer')}
				</Button>
			</div>
		</div>
	)
}

// =================================================================================================
// Créer des contacts — §5.109 bis (`CRM-156` T4, §32.10)
// =================================================================================================

type LigneContact = { readonly cochee: boolean; readonly nom: string; readonly organisation: string }

/** La liste à vérifier, qui remplace la confirmation : une ligne par expéditeur inconnu, cochée, préremplie. */
function ContactsAVerifier({
	portee,
	onAnnuler,
	onIssue,
}: {
	readonly portee: PorteeGroupee
	readonly onAnnuler: () => void
	readonly onIssue: (issues: readonly IssueContact[]) => void
}) {
	const [inconnus, setInconnus] = useState<EtatAsync<readonly ExpediteurInconnu[]>>({ statut: 'chargement' })
	const [essai, setEssai] = useState(0)
	const [lignes, setLignes] = useState<ReadonlyMap<string, LigneContact>>(new Map())
	const [enVol, setEnVol] = useState(false)
	const [panne, setPanne] = useState(false)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const refPremiere = useRef<HTMLInputElement | null>(null)
	const idLegende = useId()
	const idAide = useId()

	useEffect(() => {
		let vivant = true
		setInconnus({ statut: 'chargement' })
		void lireExpediteursInconnus(clientCrm, portee).then((lu) => {
			if (!vivant) return
			setInconnus(lu)
			if (lu.statut === 'pret')
				setLignes(
					new Map(
						lu.donnees.map((inconnu) => [
							cleContact(inconnu),
							{ cochee: true, nom: inconnu.nom, organisation: inconnu.organisation ?? '' },
						]),
					),
				)
		})
		return () => {
			vivant = false
		}
		// La portée est figée par l'ouverture, comme pour la confirmation.
	}, [essai])

	// LE FOCUS ENTRE sur la première case, à défaut sur « Annuler » (§5.13).
	const pret = inconnus.statut === 'pret'
	useEffect(() => {
		if (!pret) return
		if (refPremiere.current !== null) refPremiere.current.focus()
		else refAnnuler.current?.focus()
	}, [pret])

	const modifier = (cle: string, changement: Partial<LigneContact>) =>
		setLignes((avant) => {
			const ligne = avant.get(cle)
			return ligne === undefined ? avant : new Map(avant).set(cle, { ...ligne, ...changement })
		})

	const liste = inconnus.statut === 'pret' ? inconnus.donnees : []
	const cochees = liste.filter((inconnu) => lignes.get(cleContact(inconnu))?.cochee === true)

	const creer = async () => {
		if (cochees.length === 0 || enVol) return
		setEnVol(true)
		setPanne(false)
		const issue = await creerContacts(
			clientCrm,
			cochees.map((inconnu) => {
				const ligne = lignes.get(cleContact(inconnu))
				return {
					idEspace: inconnu.idEspace,
					adresse: inconnu.adresse,
					nom: ligne?.nom ?? inconnu.nom,
					organisation: ligne?.organisation ?? '',
				}
			}),
		)
		setEnVol(false)
		if ('nature' in issue) {
			setPanne(true)
			return
		}
		onIssue(issue)
	}

	return (
		<div
			data-testid="inbox-contacts-verifier"
			className="mx-3 my-2 rounded-sm border border-border p-3 flex flex-col gap-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !enVol) {
					evenement.stopPropagation()
					onAnnuler()
				}
			}}
		>
			{inconnus.statut === 'chargement' ? (
				<p role="status" className="text-sm text-text-2">
					{t('inbox.contacts.loading')}
				</p>
			) : inconnus.statut === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					<span>{t('inbox.contacts.error')}</span>
					<Button variante="discret" taille="compacte" onClick={() => setEssai((n) => n + 1)}>
						{t('inbox.bulk.reessayer')}
					</Button>
				</div>
			) : liste.length === 0 ? (
				<p className="text-sm text-ink" data-testid="inbox-contacts-aucun">
					{t('inbox.contacts.none')}
				</p>
			) : (
				<fieldset className="flex flex-col gap-3" disabled={enVol} aria-describedby={idAide}>
					<legend id={idLegende} className="font-medium text-ink mb-1">
						{t('inbox.contacts.legend')}
					</legend>
					<p id={idAide} className="text-sm text-text-2">
						{t('inbox.contacts.organization.help')}
					</p>
					<ul className="flex flex-col gap-3">
						{liste.map((inconnu, rang) => {
							const cle = cleContact(inconnu)
							const ligne = lignes.get(cle) ?? { cochee: false, nom: '', organisation: '' }
							return (
								<li key={cle} className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0" data-testid="inbox-contact-ligne">
									{/* LA CASE RESTE À CÔTÉ DE L'ADRESSE (défaut vu en capture, colonne de liste étroite) : l'adresse et son
									    nombre de mails se replient dans leur propre colonne, jamais sous la case. */}
									<div className="flex items-start gap-2">
										<input
											type="checkbox"
											className="size-6 shrink-0 accent-brand"
											ref={rang === 0 ? refPremiere : undefined}
											checked={ligne.cochee}
											aria-label={t('inbox.contacts.case', { adresse: inconnu.adresse })}
											onChange={() => modifier(cle, { cochee: !ligne.cochee })}
										/>
										<span className="flex min-w-0 flex-col">
											<code className="text-sm break-all">{inconnu.adresse}</code>
											<span className="text-[13px] text-text-2">
												{inconnu.mails === 1
													? t('inbox.contacts.mails.1')
													: t('inbox.contacts.mails.n', { n: String(inconnu.mails) })}
											</span>
										</span>
									</div>
									<div className="flex flex-col md:flex-row gap-2">
										<ChampContact
											libelle={t('inbox.contacts.name')}
											valeur={ligne.nom}
											onChange={(nom) => modifier(cle, { nom })}
											testid="inbox-contact-nom"
										/>
										<ChampContact
											libelle={t('inbox.contacts.organization')}
											valeur={ligne.organisation}
											onChange={(organisation) => modifier(cle, { organisation })}
											testid="inbox-contact-organisation"
										/>
									</div>
								</li>
							)
						})}
					</ul>
				</fieldset>
			)}
			{panne ? (
				<p role="alert" className="text-sm text-danger" data-testid="inbox-contacts-panne">
					{t('inbox.contacts.panne')}
				</p>
			) : null}
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" disabled={enVol} onClick={onAnnuler}>
					{t('inbox.bulk.annuler')}
				</Button>
				{liste.length > 0 ? (
					<Button
						variante="primaire"
						taille="compacte"
						data-testid="inbox-contacts-creer"
						disabled={cochees.length === 0 || enVol}
						aria-busy={enVol || undefined}
						onClick={() => void creer()}
					>
						{enVol
							? t('inbox.contacts.busy')
							: cochees.length === 0
								? t('inbox.contacts.create.0')
								: cochees.length === 1
									? t('inbox.contacts.create.1')
									: t('inbox.contacts.create.n', { n: String(cochees.length) })}
					</Button>
				) : null}
			</div>
		</div>
	)
}

const cleContact = (inconnu: ExpediteurInconnu): string => `${inconnu.idEspace}|${inconnu.adresse}`

function ChampContact({
	libelle,
	valeur,
	onChange,
	testid,
}: {
	readonly libelle: string
	readonly valeur: string
	readonly onChange: (valeur: string) => void
	readonly testid: string
}) {
	const id = useId()
	return (
		<div className="flex flex-col gap-1 flex-1 min-w-0">
			<label htmlFor={id} className="text-sm text-text-2">
				{libelle}
			</label>
			<input
				id={id}
				type="text"
				data-testid={testid}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm w-full"
				value={valeur}
				onChange={(evenement) => onChange(evenement.target.value)}
			/>
		</div>
	)
}

/** Les motifs de refus de l'import (§5.77), repris tels quels. */
const MOTIF_CONTACT: Readonly<Record<string, CleTraduction>> = {
	duplicate_email: 'import.motif.duplicate_email',
	duplicate_organization: 'import.motif.duplicate_organization',
	name_required: 'import.motif.name_required',
	invalid_email: 'import.motif.invalid_email',
	invalid_domain: 'import.motif.invalid_domain',
	invalid_website: 'import.motif.invalid_website',
	forbidden: 'import.motif.forbidden',
}

/** Le compte rendu de la création, avec les mots de l'import (§5.77) : créés, ignorés, refusés, puis chaque refus. */
function BilanContacts({
	issues,
	refTitre,
	onFermer,
}: {
	readonly issues: readonly IssueContact[]
	readonly refTitre: React.RefObject<HTMLHeadingElement | null>
	readonly onFermer: () => void
}) {
	const nombre = (issue: IssueContact['issue']) => issues.filter((ligne) => ligne.issue === issue).length
	const crees = nombre('created')
	const ignores = nombre('skipped')
	const refuses = issues.filter((ligne) => ligne.issue === 'refused')
	const plur = (n: number, un: CleTraduction, plusieurs: CleTraduction) => (n === 1 ? t(un) : t(plusieurs, { n: String(n) }))
	return (
		<div role="status" data-testid="inbox-compte-rendu" className="mx-3 my-2 rounded-sm border border-border p-3 flex flex-col gap-1 text-sm text-ink">
			<h3 ref={refTitre} tabIndex={-1} className="font-medium">
				{t('inbox.bulk.option.contacts')}
			</h3>
			<p data-testid="inbox-compte-rendu-fait">
				{t('inbox.contacts.bilan', {
					crees: plur(crees, 'inbox.contacts.bilan.crees.1', 'inbox.contacts.bilan.crees.n'),
					ignores: plur(ignores, 'inbox.contacts.bilan.ignores.1', 'inbox.contacts.bilan.ignores.n'),
					refuses: plur(refuses.length, 'inbox.contacts.bilan.refuses.1', 'inbox.contacts.bilan.refuses.n'),
				})}
			</p>
			{refuses.length > 0 ? (
				<ul className="list-disc pl-6 text-text-2" data-testid="inbox-compte-rendu-refus">
					{refuses.map((ligne) => (
						<li key={ligne.adresse}>
							{t('inbox.contacts.refus.ligne', {
								adresse: ligne.adresse,
								motif: t((ligne.code !== null ? MOTIF_CONTACT[ligne.code] : undefined) ?? 'import.motif.unknown'),
							})}
						</li>
					))}
				</ul>
			) : null}
			<div>
				<Button variante="discret" taille="compacte" onClick={onFermer}>
					{t('inbox.bulk.fermer')}
				</Button>
			</div>
		</div>
	)
}
