// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : la fiche d'un espace — identité, membres, attentes, suppression
// @spec docs/SPEC-plateforme.md §6.2 à §6.4 (fonctions), §7.3 (fiche), §7.4 (suppression), §7.5 (états et refus) ;
//       docs/DESIGN_SYSTEM.md §5.56, §5.9 (tableaux), §5.13 (formulaires et confirmations dans le flux), §5.20 (`dl`),
//       §5.27 (confirmation sur une ligne à elle), §5.28 (un seul bloc ouvert), §5.40 (commande montée et désactivée),
//       §5.41 (retrait sans confirmation de ce qu'un formulaire repose), §5.7 ter (le rôle écrit au choix)
// @spec CLAUDE.md §10 — aucun droit calculé : chaque geste est envoyé, et son refus traduit
//
// LA FICHE EST RELUE APRÈS CHAQUE ÉCRITURE, JAMAIS COMPLÉTÉE LOCALEMENT (§5.21), et la relecture garde à l'écran ce
// qu'elle relit (§5.29 tranche 2 c) : le squelette n'appartient qu'au premier chargement.

import { PencilLine, Trash2, TriangleAlert, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { ErreurDonnees } from '../lib/async'
import {
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
import { CLES_APPARTENANCES, CLES_ATTENTES, compter, texteRefus } from './presentation-plateforme'
import { RecherchePersonne } from './RecherchePersonne'
import { BlocAttentes } from './BlocAttentes'
import {
	BlocMessage,
	CLASSES_CHAMP,
	Champ,
	SelectRole,
	TableauMembres,
	useRetourFocus,
	type Message,
} from './TableauMembres'
import type { EtatNavigationEspaces } from './PlateformeEspaces'

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
			<BlocAttentes
				attentes={attentes.map((attente) => ({ ...attente, enSuspens: attenteEnSuspens(attente, espace.administrateurs) }))}
				niveauTitre="h2"
				roleParDefaut={espace.administrateurs === 0 ? 'admin' : 'viewer'}
				ouvert={ouverture?.type === 'inviter'}
				onOuvrir={() => ouvrir({ type: 'inviter' })}
				onFermer={() => setOuverture(null)}
				message={messageAttentes}
				onMessage={(message) => {
					setMessageAttentes(message)
					relire()
				}}
				inscrire={async (email, role) => {
					const issue = await inviter(client, espace.id, email, role)
					return issue.statut === 'refus'
						? { ok: false, refus: texteRefus(issue.refus) }
						: { ok: true, message: { ton: 'succes', texte: t('platform.attentes.inscrite', { email: email.trim().toLowerCase() }) } }
				}}
				retirer={async (attente) =>
					issueEnMessage(await retirerAttente(client, espace.id, attente.email), t('platform.attentes.retiree', { email: attente.email }))
				}
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
				<TableauMembres
					membres={membres.map((membre) => ({ ...membre, role: membre.role ?? 'viewer' }))}
					nomEspace={espace.nom}
					colonneSuperadmin
					idConfirmation={ouverture?.type === 'retirer-membre' ? ouverture.idUtilisateur : null}
					onDemanderRetrait={(membre) => onOuvrir({ type: 'retirer-membre', idUtilisateur: membre.idUtilisateur })}
					onFermer={onFermer}
					changerRole={async (membre, role) =>
						issueEnMessage(
							await poserMembre(client, espace.id, membre.idUtilisateur, role),
							t('platform.membres.roleChange', { nom: membre.nom }),
						)
					}
					retirer={async (membre) =>
						issueEnMessage(
							await retirerMembre(client, espace.id, membre.idUtilisateur),
							t('platform.membres.retire', { nom: membre.nom }),
						)
					}
					onMessage={onIssue}
				/>
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
