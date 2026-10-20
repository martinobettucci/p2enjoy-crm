// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : la fiche d'un espace — identité, membres, attentes, suppression
// @spec docs/SPEC-plateforme.md §6.2 à §6.4 (fonctions), §7.3 (fiche), §7.4 (suppression), §7.5 (états et refus) ;
//       docs/DESIGN_SYSTEM.md §5.56, §5.9 (tableaux), §5.13 (formulaires et confirmations dans le flux), §5.20 (`dl`),
//       §5.27 (confirmation sur une ligne à elle), §5.28 (un seul bloc ouvert), §5.40 (commande montée et désactivée),
//       §5.41 (retrait sans confirmation de ce qu'un formulaire repose), §5.7 ter (le rôle écrit au choix)
// @spec CLAUDE.md §10 — aucun droit calculé : chaque geste est envoyé, et son refus traduit
//
// LA FICHE EST RELUE APRÈS CHAQUE ÉCRITURE, JAMAIS COMPLÉTÉE LOCALEMENT (§5.21), et la relecture garde à l'écran ce
// qu'elle relit (§5.29 tranche 2 c) : le squelette n'appartient qu'au premier chargement.

import { MailMinus, MailPlus, PencilLine, Trash2, TriangleAlert, UserMinus, UserPlus } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { ErreurDonnees } from '../lib/async'
import {
	ROLES_ESPACE,
	attenteEnSuspens,
	confirmationSuppressionValide,
	inviter,
	lireAttentes,
	lireEspaces,
	lireMembres,
	modifierEspace,
	poserMembre,
	retirerAttente,
	retirerMembre,
	supprimerEspace,
	type AttentePlateforme,
	type EspacePlateforme,
	type Issue,
	type MembrePlateforme,
	type RefusPlateforme,
	type RoleEspace,
} from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_PLATEFORME_ESPACES } from './chemins'
import { CLES_APPARTENANCES, CLES_ATTENTES, compter, formaterDate, libelleRole, texteRefus } from './presentation-plateforme'
import { RecherchePersonne } from './RecherchePersonne'
import type { EtatNavigationEspaces } from './PlateformeEspaces'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_DATE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'
const CLASSES_COMMANDES = 'h-[var(--size-target)] px-3 whitespace-nowrap'
const CLASSES_CHAMP =
	'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'

type Fiche = {
	readonly espace: EspacePlateforme
	readonly membres: readonly MembrePlateforme[]
	readonly attentes: readonly AttentePlateforme[]
}

type EtatFiche =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'introuvable' }
	| { readonly statut: 'erreur'; readonly erreur: ErreurDonnees }
	| { readonly statut: 'pret'; readonly fiche: Fiche }

/** Le seul bloc ouvert de la fiche (§5.28) : un formulaire, ou une confirmation. */
type Ouverture =
	| { readonly type: 'modifier' }
	| { readonly type: 'ajouter-membre' }
	| { readonly type: 'retirer-membre'; readonly idUtilisateur: string }
	| { readonly type: 'inviter' }
	| { readonly type: 'supprimer' }
	| null

/** Un message de bloc : une issue lue sous le tableau, `status` ou `alert` (§5.27). */
type Message = { readonly ton: 'succes' | 'refus'; readonly texte: string } | null

async function lireFiche(client: ClientCrm, slug: string): Promise<EtatFiche> {
	const espaces = await lireEspaces(client)
	if (espaces.statut === 'erreur') return espaces
	if (espaces.statut !== 'pret') return { statut: 'chargement' }
	const espace = espaces.donnees.find((candidat) => candidat.slug === slug)
	if (espace === undefined) return { statut: 'introuvable' }
	const [membres, attentes] = await Promise.all([lireMembres(client, espace.id), lireAttentes(client, espace.id)])
	if (membres.statut === 'erreur') return membres
	if (attentes.statut === 'erreur') return attentes
	if (membres.statut !== 'pret' || attentes.statut !== 'pret') return { statut: 'chargement' }
	return { statut: 'pret', fiche: { espace, membres: membres.donnees, attentes: attentes.donnees } }
}

export function PlateformeEspace({ client }: { readonly client: ClientCrm }) {
	const { slug = '' } = useParams()
	const [etat, setEtat] = useState<EtatFiche>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [messageMembres, setMessageMembres] = useState<Message>(null)
	const [messageAttentes, setMessageAttentes] = useState<Message>(null)
	const [messageIdentite, setMessageIdentite] = useState<Message>(null)

	useEffect(() => {
		let vivant = true
		void lireFiche(client, slug).then((resultat) => {
			if (vivant) setEtat((precedent) => (resultat.statut === 'chargement' && precedent.statut === 'pret' ? precedent : resultat))
		})
		return () => {
			vivant = false
		}
	}, [client, slug, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	if (etat.statut === 'chargement') return <SkeletonListe lignes={6} libelle={t('state.loading.aria')} />
	if (etat.statut === 'introuvable') {
		return (
			<EtatVide
				titre={t('platform.espace.introuvable.title')}
				corps={t('platform.espace.introuvable.body')}
				action={
					<Link to={CHEMIN_PLATEFORME_ESPACES} className="inline-flex items-center min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white font-medium">
						{t('platform.espace.retourListe')}
					</Link>
				}
			/>
		)
	}
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.espace.erreur.title')}
				corps={t('platform.espace.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={relire}
			/>
		)
	}

	const { espace, membres, attentes } = etat.fiche
	const ouvrir = (suivante: Ouverture) => {
		setOuverture(suivante)
		setMessageMembres(null)
		setMessageAttentes(null)
		setMessageIdentite(null)
	}

	return (
		<article aria-labelledby="titre-espace" className="flex flex-col gap-8" data-testid="fiche-espace" data-slug={espace.slug}>
			<Identite
				client={client}
				espace={espace}
				ouvert={ouverture?.type === 'modifier'}
				onOuvrir={() => ouvrir({ type: 'modifier' })}
				onFermer={() => setOuverture(null)}
				onModifie={() => {
					setOuverture(null)
					setMessageIdentite({ ton: 'succes', texte: t('platform.espace.modifie') })
					relire()
				}}
				message={messageIdentite}
			/>
			<Membres
				client={client}
				espace={espace}
				membres={membres}
				ouverture={ouverture}
				onOuvrir={ouvrir}
				onFermer={() => setOuverture(null)}
				message={messageMembres}
				onIssue={(message) => {
					setMessageMembres(message)
					relire()
				}}
			/>
			<Attentes
				client={client}
				espace={espace}
				attentes={attentes}
				ouvert={ouverture?.type === 'inviter'}
				onOuvrir={() => ouvrir({ type: 'inviter' })}
				onFermer={() => setOuverture(null)}
				message={messageAttentes}
				onIssue={(message) => {
					setMessageAttentes(message)
					relire()
				}}
			/>
			<ZoneDanger
				client={client}
				espace={espace}
				membres={membres.length}
				attentes={attentes.length}
				ouvert={ouverture?.type === 'supprimer'}
				onOuvrir={() => ouvrir({ type: 'supprimer' })}
				onFermer={() => setOuverture(null)}
			/>
		</article>
	)
}

function BlocMessage({ message, testId }: { readonly message: Message; readonly testId: string }) {
	if (message === null) return null
	return message.ton === 'succes' ? (
		<p role="status" data-testid={testId} className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm">
			{message.texte}
		</p>
	) : (
		<p role="alert" data-testid={testId} className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
			{message.texte}
		</p>
	)
}

/** Le focus revient à la commande qui a ouvert, un tour de rendu plus tard si elle a été démontée (§5.25). */
function useRetourFocus(ouvert: boolean) {
	const commande = useRef<HTMLButtonElement>(null)
	const rendre = useRef(false)
	useEffect(() => {
		if (!ouvert && rendre.current) {
			rendre.current = false
			commande.current?.focus()
		}
	}, [ouvert])
	return { commande, demander: () => (rendre.current = true) }
}

// --- Identité ----------------------------------------------------------------------------------------------------

function Identite({
	client,
	espace,
	ouvert,
	onOuvrir,
	onFermer,
	onModifie,
	message,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly ouvert: boolean
	readonly onOuvrir: () => void
	readonly onFermer: () => void
	readonly onModifie: () => void
	readonly message: Message
}) {
	const focus = useRetourFocus(ouvert)
	const fermer = () => {
		focus.demander()
		onFermer()
	}
	return (
		<section aria-labelledby="titre-espace" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="titre-espace" className="text-h2">
					{espace.nom}
				</h2>
				{!ouvert && (
					<Button ref={focus.commande} taille="compacte" onClick={onOuvrir} aria-expanded={false} aria-label={t('platform.espace.modifier.aria', { nom: espace.nom })}>
						<PencilLine aria-hidden="true" size={16} />
						{t('platform.espace.modifier')}
					</Button>
				)}
			</div>
			<dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
				<div className="flex flex-col">
					<dt className="text-sm text-text-2">{t('platform.espaces.colonne.slug')}</dt>
					<dd>
						<code>{espace.slug}</code>
					</dd>
				</div>
				<div className="flex flex-col">
					<dt className="text-sm text-text-2">{t('platform.espaces.colonne.domaine')}</dt>
					<dd>{espace.domaineEntrant === null ? t('platform.espace.aucunDomaine') : <code>{espace.domaineEntrant}</code>}</dd>
				</div>
			</dl>
			{espace.administrateurs === 0 && (
				<p role="status" data-testid="bandeau-sans-admin" className="flex items-start gap-2 rounded-sm bg-accent-soft text-accent-on-soft px-3 py-2 text-sm">
					<TriangleAlert aria-hidden="true" size={16} className="shrink-0 mt-[2px]" />
					{t('platform.espace.sansAdministrateur')}
				</p>
			)}
			{ouvert && <FormulaireIdentite client={client} espace={espace} onFermer={fermer} onModifie={onModifie} />}
			<BlocMessage message={message} testId="message-identite" />
		</section>
	)
}

function FormulaireIdentite({
	client,
	espace,
	onFermer,
	onModifie,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly onFermer: () => void
	readonly onModifie: () => void
}) {
	const [nom, setNom] = useState(espace.nom)
	const [domaine, setDomaine] = useState(espace.domaineEntrant ?? '')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const premier = useRef<HTMLInputElement>(null)
	useEffect(() => premier.current?.focus(), [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await modifierEspace(client, espace.id, nom, domaine)
		setEnvoi(false)
		if (issue.statut === 'refus') setRefus(issue.refus)
		else onModifie()
	}

	return (
		<form
			onSubmit={(e) => void soumettre(e)}
			onKeyDown={(e) => e.key === 'Escape' && onFermer()}
			aria-label={t('platform.espace.modifier.aria', { nom: espace.nom })}
			data-testid="formulaire-identite"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<Champ id="identite-nom" libelle={t('platform.espaces.champ.nom')}>
				<input ref={premier} id="identite-nom" value={nom} onChange={(e) => setNom(e.target.value)} className={CLASSES_CHAMP} />
			</Champ>
			<Champ id="identite-domaine" libelle={t('platform.espaces.champ.domaine')} aide={t('platform.espaces.champ.domaine.aide')}>
				<input
					id="identite-domaine"
					value={domaine}
					onChange={(e) => setDomaine(e.target.value)}
					aria-describedby="identite-domaine-aide"
					className={`${CLASSES_CHAMP} font-mono`}
				/>
			</Champ>
			{/* Une valeur qui ne se modifie plus se rend en PHRASE, jamais en champ désactivé (§5.15). */}
			<p className="text-sm text-text-2">{t('platform.espace.slugFixe', { slug: espace.slug })}</p>
			{refus !== null && (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{texteRefus(refus)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi}>
					{envoi ? t('platform.envoi') : t('platform.enregistrer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}

function Champ({ id, libelle, aide, children }: { readonly id: string; readonly libelle: string; readonly aide?: string; readonly children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-text-2">
				{libelle}
			</label>
			{children}
			{aide !== undefined && (
				<p id={`${id}-aide`} className="text-sm text-text-3">
					{aide}
				</p>
			)}
		</div>
	)
}

function SelectRole({ id, valeur, onChange, libelle }: { readonly id: string; readonly valeur: RoleEspace; readonly onChange: (role: RoleEspace) => void; readonly libelle?: string }) {
	return (
		<select
			id={id}
			value={valeur}
			aria-label={libelle}
			onChange={(e) => onChange(e.target.value as RoleEspace)}
			className={CLASSES_CHAMP}
		>
			{ROLES_ESPACE.map((role) => (
				<option key={role} value={role}>
					{libelleRole(role)}
				</option>
			))}
		</select>
	)
}

// --- Membres -----------------------------------------------------------------------------------------------------

function Membres({
	client,
	espace,
	membres,
	ouverture,
	onOuvrir,
	onFermer,
	message,
	onIssue,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly membres: readonly MembrePlateforme[]
	readonly ouverture: Ouverture
	readonly onOuvrir: (ouverture: Ouverture) => void
	readonly onFermer: () => void
	readonly message: Message
	readonly onIssue: (message: Message) => void
}) {
	const formulaireOuvert = ouverture?.type === 'ajouter-membre'
	const focus = useRetourFocus(formulaireOuvert)
	const [roleEnVol, setRoleEnVol] = useState<Readonly<Record<string, RoleEspace>>>({})

	const changerRole = async (membre: MembrePlateforme, role: RoleEspace) => {
		setRoleEnVol((precedent) => ({ ...precedent, [membre.idUtilisateur]: role }))
		const issue = await poserMembre(client, espace.id, membre.idUtilisateur, role)
		setRoleEnVol((precedent) => {
			const suivant = { ...precedent }
			delete suivant[membre.idUtilisateur]
			return suivant
		})
		onIssue(issueEnMessage(issue, t('platform.membres.roleChange', { nom: membre.nom })))
	}

	return (
		<section aria-labelledby="titre-membres" className="flex flex-col gap-4">
			<h2 id="titre-membres" className="text-h3">
				{t('platform.membres.titre')}
			</h2>
			{membres.length === 0 ? (
				<p className="text-text-2" data-testid="membres-vide">
					{t('platform.membres.vide')}
				</p>
			) : (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-membres" className="w-full border-collapse">
						<caption className="sr-only">{t('platform.membres.titre')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.nom')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.role')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.superadmin')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.colonne.depuis')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.colonne.commandes')}</th>
							</tr>
						</thead>
						<tbody>
							{membres.map((membre) => {
								const confirmation = ouverture?.type === 'retirer-membre' && ouverture.idUtilisateur === membre.idUtilisateur
								return (
									<LigneMembre
										key={membre.idUtilisateur}
										client={client}
										espace={espace}
										membre={membre}
										role={roleEnVol[membre.idUtilisateur] ?? membre.role ?? 'viewer'}
										confirmation={confirmation}
										onChangerRole={(role) => void changerRole(membre, role)}
										onRetirer={() => onOuvrir({ type: 'retirer-membre', idUtilisateur: membre.idUtilisateur })}
										onAnnuler={onFermer}
										onIssue={(issue) => {
											onFermer()
											onIssue(issue)
										}}
									/>
								)
							})}
						</tbody>
					</table>
				</div>
			)}
			<BlocMessage message={message} testId="message-membres" />
			{formulaireOuvert ? (
				<FormulaireMembre
					client={client}
					espace={espace}
					exclus={new Set(membres.map((membre) => membre.idUtilisateur))}
					onFermer={() => {
						focus.demander()
						onFermer()
					}}
					onAjoute={(nom) => {
						onFermer()
						onIssue({ ton: 'succes', texte: t('platform.membres.ajoute', { nom }) })
					}}
				/>
			) : (
				<div>
					<Button ref={focus.commande} onClick={() => onOuvrir({ type: 'ajouter-membre' })} data-testid="ajouter-membre">
						<UserPlus aria-hidden="true" size={18} />
						{t('platform.membres.ajouter')}
					</Button>
				</div>
			)}
		</section>
	)
}

function issueEnMessage(issue: Issue<unknown>, succes: string): Message {
	return issue.statut === 'ok' ? { ton: 'succes', texte: succes } : { ton: 'refus', texte: texteRefus(issue.refus) }
}

function LigneMembre({
	client,
	espace,
	membre,
	role,
	confirmation,
	onChangerRole,
	onRetirer,
	onAnnuler,
	onIssue,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly membre: MembrePlateforme
	readonly role: RoleEspace
	readonly confirmation: boolean
	readonly onChangerRole: (role: RoleEspace) => void
	readonly onRetirer: () => void
	readonly onAnnuler: () => void
	readonly onIssue: (message: Message) => void
}) {
	const commande = useRef<HTMLButtonElement>(null)
	const [envoi, setEnvoi] = useState(false)
	// La commande reste montée mais DÉSACTIVÉE pendant sa confirmation, et un bouton désactivé refuse le focus : il lui
	// est rendu un tour de rendu plus tard, une fois réactivé — un drapeau, puis un effet (§5.29 tranche 2 b-2 c).
	const rendreFocus = useRef(false)
	useEffect(() => {
		if (!confirmation && rendreFocus.current) {
			rendreFocus.current = false
			commande.current?.focus()
		}
	}, [confirmation])
	const annuler = () => {
		rendreFocus.current = true
		onAnnuler()
	}
	const retirer = async () => {
		setEnvoi(true)
		const issue = await retirerMembre(client, espace.id, membre.idUtilisateur)
		setEnvoi(false)
		onIssue(issueEnMessage(issue, t('platform.membres.retire', { nom: membre.nom })))
	}
	return (
		<Fragment>
			<tr data-testid="ligne-membre" data-membre={membre.idUtilisateur} className="border-b border-border hover:bg-hover">
				<td className={CLASSES_CELLULE} title={membre.nom}>{membre.nom}</td>
				<td className={CLASSES_CELLULE}>
					<SelectRole
						id={`role-${membre.idUtilisateur}`}
						valeur={role}
						libelle={t('platform.membres.role.aria', { nom: membre.nom })}
						onChange={onChangerRole}
					/>
				</td>
				<td className={CLASSES_CELLULE}>{membre.superadmin && <Badge ton="brand">{t('platform.membres.superadmin')}</Badge>}</td>
				<td className={CLASSES_DATE}>{formaterDate(membre.depuis)}</td>
				<td className={CLASSES_COMMANDES}>
					{/* La commande reste montée, désactivée pendant sa confirmation : le focus lui revient sans attente (§5.27). */}
					<Button
						ref={commande}
						variante="discret"
						taille="compacte"
						disabled={confirmation}
						onClick={onRetirer}
						aria-label={t('platform.membres.retirer.aria', { nom: membre.nom })}
					>
						<UserMinus aria-hidden="true" size={16} />
						{t('platform.membres.retirer')}
					</Button>
				</td>
			</tr>
			{confirmation && (
				<tr>
					<td colSpan={5} className="p-0">
						<div
							role="group"
							aria-labelledby={`confirmation-membre-${membre.idUtilisateur}`}
							onKeyDown={(e) => {
								if (e.key === 'Escape') annuler()
							}}
							className="sticky left-0 max-w-[calc(100vw-32px)] flex flex-col gap-3 bg-surface border-b border-border p-4"
						>
							<p id={`confirmation-membre-${membre.idUtilisateur}`} className="font-medium">
								{t('platform.membres.confirmation', { nom: membre.nom, espace: espace.nom })}
							</p>
							<p className="text-sm text-text-2">{t('platform.membres.confirmation.consequence')}</p>
							<div className="flex flex-wrap gap-2">
								<Button variante="destructif" disabled={envoi} onClick={() => void retirer()} autoFocus>
									{envoi ? t('platform.envoi') : t('platform.membres.retirer.confirmer')}
								</Button>
								<Button onClick={annuler}>{t('platform.annuler')}</Button>
							</div>
						</div>
					</td>
				</tr>
			)}
		</Fragment>
	)
}

function FormulaireMembre({
	client,
	espace,
	exclus,
	onFermer,
	onAjoute,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly exclus: ReadonlySet<string>
	readonly onFermer: () => void
	readonly onAjoute: (nom: string) => void
}) {
	const [choix, setChoix] = useState('')
	const [nomChoisi, setNomChoisi] = useState('')
	const [role, setRole] = useState<RoleEspace>(espace.administrateurs === 0 ? 'admin' : 'viewer')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const champ = useRef<HTMLInputElement>(null)
	useEffect(() => champ.current?.focus(), [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await poserMembre(client, espace.id, choix, role)
		setEnvoi(false)
		if (issue.statut === 'refus') {
			setRefus(issue.refus)
			return
		}
		onAjoute(nomChoisi)
	}

	return (
		<form
			onSubmit={(e) => void soumettre(e)}
			onKeyDown={(e) => e.key === 'Escape' && onFermer()}
			aria-label={t('platform.membres.ajouter')}
			data-testid="formulaire-membre"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<RecherchePersonne client={client} exclus={exclus} choix={choix}
				onChoix={(id, nom) => {
					setChoix(id)
					setNomChoisi(nom)
				}}
				aide={t('platform.membres.recherche.aide')} refChamp={champ} />
			<Champ id="membre-role" libelle={t('platform.membres.colonne.role')}>
				<SelectRole id="membre-role" valeur={role} onChange={setRole} />
			</Champ>
			{refus !== null && (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{texteRefus(refus)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi || choix === ''}>
					{envoi ? t('platform.envoi') : t('platform.membres.ajouter.confirmer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}

// --- Attentes ----------------------------------------------------------------------------------------------------

function Attentes({
	client,
	espace,
	attentes,
	ouvert,
	onOuvrir,
	onFermer,
	message,
	onIssue,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly attentes: readonly AttentePlateforme[]
	readonly ouvert: boolean
	readonly onOuvrir: () => void
	readonly onFermer: () => void
	readonly message: Message
	readonly onIssue: (message: Message) => void
}) {
	const focus = useRetourFocus(ouvert)
	const [enVol, setEnVol] = useState<string | null>(null)

	// Retirer une attente n'a pas de confirmation : rien n'est détruit qu'un formulaire de deux champs ne repose
	// (§5.41, §5.56).
	const retirer = async (attente: AttentePlateforme) => {
		setEnVol(attente.email)
		const issue = await retirerAttente(client, espace.id, attente.email)
		setEnVol(null)
		onIssue(issueEnMessage(issue, t('platform.attentes.retiree', { email: attente.email })))
	}

	return (
		<section aria-labelledby="titre-attentes" className="flex flex-col gap-4">
			<h2 id="titre-attentes" className="text-h3">
				{t('platform.attentes.titre')}
			</h2>
			{attentes.length === 0 ? (
				<p className="text-text-2" data-testid="attentes-vide">
					{t('platform.attentes.vide')}
				</p>
			) : (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-attentes" className="w-full border-collapse">
						<caption className="sr-only">{t('platform.attentes.titre')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.adresse')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.role')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.invitePar')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.colonne.depuis')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.colonne.commandes')}</th>
							</tr>
						</thead>
						<tbody>
							{attentes.map((attente) => (
								<tr key={attente.email} data-testid="ligne-attente" data-email={attente.email} className="border-b border-border hover:bg-hover">
									<td className={CLASSES_CELLULE} title={attente.email}>
										<code>{attente.email}</code>
									</td>
									<td className={`${CLASSES_CELLULE} max-w-none`}>
										<span className="inline-flex items-center gap-2">
											{libelleRole(attente.role)}
											{attenteEnSuspens(attente, espace.administrateurs) && (
												<span aria-label={t('platform.attentes.enSuspens.aria')} role="img">
													<Badge ton="accent">{t('platform.attentes.enSuspens')}</Badge>
												</span>
											)}
										</span>
									</td>
									<td className={CLASSES_CELLULE}>{attente.invitePar ?? t('platform.auteurInconnu')}</td>
									<td className={CLASSES_DATE}>{formaterDate(attente.depuis)}</td>
									<td className={CLASSES_COMMANDES}>
										<Button
											variante="discret"
											taille="compacte"
											disabled={enVol === attente.email}
											onClick={() => void retirer(attente)}
											aria-label={t('platform.attentes.retirer.aria', { email: attente.email })}
										>
											<MailMinus aria-hidden="true" size={16} />
											{enVol === attente.email ? t('platform.envoi') : t('platform.attentes.retirer')}
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<BlocMessage message={message} testId="message-attentes" />
			{ouvert ? (
				<FormulaireAttente
					client={client}
					espace={espace}
					onFermer={() => {
						focus.demander()
						onFermer()
					}}
					onInscrite={(email) => {
						onFermer()
						onIssue({ ton: 'succes', texte: t('platform.attentes.inscrite', { email }) })
					}}
				/>
			) : (
				<div>
					<Button ref={focus.commande} onClick={onOuvrir} data-testid="inscrire-attente">
						<MailPlus aria-hidden="true" size={18} />
						{t('platform.attentes.inscrire')}
					</Button>
				</div>
			)}
		</section>
	)
}

function FormulaireAttente({
	client,
	espace,
	onFermer,
	onInscrite,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly onFermer: () => void
	readonly onInscrite: (email: string) => void
}) {
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<RoleEspace>(espace.administrateurs === 0 ? 'admin' : 'viewer')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const premier = useRef<HTMLInputElement>(null)
	useEffect(() => premier.current?.focus(), [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await inviter(client, espace.id, email, role)
		setEnvoi(false)
		if (issue.statut === 'refus') setRefus(issue.refus)
		else onInscrite(email.trim().toLowerCase())
	}

	return (
		<form
			onSubmit={(e) => void soumettre(e)}
			onKeyDown={(e) => e.key === 'Escape' && onFermer()}
			aria-label={t('platform.attentes.inscrire')}
			data-testid="formulaire-attente"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<Champ id="attente-email" libelle={t('platform.attentes.colonne.adresse')} aide={t('platform.attentes.aide')}>
				<input
					ref={premier}
					id="attente-email"
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					aria-describedby="attente-email-aide"
					className={`${CLASSES_CHAMP} font-mono`}
				/>
			</Champ>
			<Champ id="attente-role" libelle={t('platform.attentes.colonne.role')}>
				<SelectRole id="attente-role" valeur={role} onChange={setRole} />
			</Champ>
			{refus !== null && (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{texteRefus(refus)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi || email.trim() === ''}>
					{envoi ? t('platform.envoi') : t('platform.attentes.inscrire.confirmer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}

// --- Zone de danger ------------------------------------------------------------------------------------------------

function ZoneDanger({
	client,
	espace,
	membres,
	attentes,
	ouvert,
	onOuvrir,
	onFermer,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly membres: number
	readonly attentes: number
	readonly ouvert: boolean
	readonly onOuvrir: () => void
	readonly onFermer: () => void
}) {
	const commande = useRef<HTMLButtonElement>(null)
	const [saisie, setSaisie] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const navigate = useNavigate()
	// Même remède que pour la ligne d'un membre : la commande est désactivée tant que la confirmation est ouverte.
	const rendreFocus = useRef(false)
	useEffect(() => {
		if (!ouvert && rendreFocus.current) {
			rendreFocus.current = false
			commande.current?.focus()
		}
	}, [ouvert])

	const annuler = () => {
		setSaisie('')
		setRefus(null)
		rendreFocus.current = true
		onFermer()
	}

	const supprimer = async () => {
		setEnvoi(true)
		setRefus(null)
		const issue = await supprimerEspace(client, espace.id, saisie)
		setEnvoi(false)
		if (issue.statut === 'refus') {
			setRefus(issue.refus)
			return
		}
		// La fiche d'un espace supprimé n'a plus de sujet : le succès se lit sur la liste (§5.56, §5.40).
		const etat: EtatNavigationEspaces = { espaceSupprime: espace.nom }
		void navigate(CHEMIN_PLATEFORME_ESPACES, { state: etat })
	}

	return (
		<section aria-labelledby="titre-danger" className="flex flex-col gap-4 border-t border-border pt-6">
			<h2 id="titre-danger" className="text-h3">
				{t('platform.danger.titre')}
			</h2>
			<div>
				<Button ref={commande} taille="compacte" disabled={ouvert} onClick={onOuvrir} data-testid="supprimer-espace">
					<Trash2 aria-hidden="true" size={16} />
					{t('platform.danger.supprimer')}
				</Button>
			</div>
			{ouvert && (
				<div
					role="group"
					aria-labelledby="question-suppression"
					onKeyDown={(e) => e.key === 'Escape' && annuler()}
					data-testid="confirmation-suppression"
					className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
				>
					<p id="question-suppression" className="font-medium">
						{t('platform.danger.question', { nom: espace.nom })}
					</p>
					<p className="text-sm text-text-2">{t('platform.danger.emporte', { membres: compter(membres, CLES_APPARTENANCES), attentes: compter(attentes, CLES_ATTENTES) })}</p>
					<p className="text-sm text-text-2">{t('platform.danger.definitif')}</p>
					<Champ id="confirmation-slug" libelle={t('platform.danger.saisie', { slug: espace.slug })}>
						<input
							id="confirmation-slug"
							value={saisie}
							autoFocus
							autoComplete="off"
							onChange={(e) => setSaisie(e.target.value)}
							className={`${CLASSES_CHAMP} font-mono`}
						/>
					</Champ>
					{refus !== null && (
						<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
							{texteRefus(refus)}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						{/* Éteint tant que la saisie diffère : l'état de la confirmation, jamais un droit (§5.56). */}
						<Button variante="destructif" disabled={envoi || !confirmationSuppressionValide(saisie, espace.slug)} onClick={() => void supprimer()}>
							{envoi ? t('platform.envoi') : t('platform.danger.confirmer')}
						</Button>
						<Button onClick={annuler}>{t('platform.annuler')}</Button>
					</div>
				</div>
			)}
		</section>
	)
}
