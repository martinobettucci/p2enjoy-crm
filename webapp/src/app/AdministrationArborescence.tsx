// @spec CRM-075 (docs/BACKLOG.md) — écran d'administration des tracks et des channels
// @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration, septième tranche : le GESTE de mise
//       à la corbeille d'un track et d'un channel, et sa confirmation portant l'énumération
// @spec docs/SPEC-corbeille.md §4 bis.1 (où le geste vit), §4 bis.3 (ce que la confirmation dit et
//       ses quatre états de compte), §4 bis.5 (les trois issues), §4 bis.6 (ce qu'il ne fait pas)
// @spec docs/SPEC-administration-arborescence.md §3.2 (composition), §4 (les états), §5 (créer et
//       renommer), §6 (réordonner et archiver), §7 (les channels), §8 (validation de forme),
//       §9 (les refus), §10 (ce que voit un non-administrateur)
// @spec docs/DESIGN_SYSTEM.md §5.13 (cette surface), §5.7 (champs), §5.8 (états), §6
//       (confirmation), §8 (accessibilité), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// AUCUN DROIT N'EST CALCULÉ ICI, et c'est la règle qui gouverne tout le fichier. Les commandes sont
// rendues pour tout le monde ; l'écriture part, et le refus du backend est traduit (§10). Une
// commande masquée sur la foi d'un rôle lu au chargement cacherait un geste **permis** le jour où ce
// rôle a changé depuis — là où une commande refusée montre le refus réel.
//
// La seule chose que l'écran décide seul est le **calcul d'une position** (§6.2), qui est de
// l'arithmétique et non une règle : lorsqu'il ne sait pas produire une position distincte, il le dit
// au lieu d'écrire une valeur sans effet.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
	Archive,
	ArchiveRestore,
	ChevronDown,
	ChevronRight,
	Pencil,
	Plus,
	Trash2,
	TriangleAlert,
	ArrowDown,
	ArrowUp,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import {
	archiverChannel,
	archiverTrack,
	calculerDeplacement,
	creerChannel,
	creerTrack,
	deplacerChannel,
	deplacerTrack,
	lireChannelsAdministrables,
	lireTracksAdministrables,
	lireWorkflowsAffectables,
	mettreChannelALaCorbeille,
	mettreTrackALaCorbeille,
	modifierChannel,
	modifierTrack,
	nomConforme,
	proposerSlug,
	slugConforme,
	type ChannelAdministrable,
	type Ordonnable,
	type RefusEcriture,
	type ResultatEcriture,
	type Sens,
	type TrackAdministrable,
	type WorkflowAffectable,
} from '../lib/administration-arborescence'
import {
	composerEnumeration,
	compterEnfantsInaccessibles,
	type CibleEnumeration,
} from '../lib/corbeille'
import { classesPilule, iconeTrack, NOMS_ICONES } from './presentation-tracks'
import { texteLigneEnumeration, type EtatEnumeration } from './presentation-corbeille'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { lireWorkspaces } from '../lib/workspaces'

const COULEURS: readonly string[] = ['brand', 'success', 'accent', 'danger', 'neutral']

/**
 * Ce qui est ouvert, et il n'y en a qu'un à la fois.
 *
 * Un seul formulaire ouvert évite la question qu'aucune spécification ne tranche : que devient une
 * saisie non enregistrée quand une seconde s'ouvre ? En n'en autorisant qu'une, elle ne se pose pas.
 */
type Ouverture =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation-track' }
	| { readonly type: 'edition-track'; readonly id: string }
	| { readonly type: 'archivage-track'; readonly id: string }
	| { readonly type: 'corbeille-track'; readonly id: string }
	| { readonly type: 'creation-channel'; readonly idTrack: string }
	| { readonly type: 'edition-channel'; readonly id: string; readonly idTrack: string }
	| { readonly type: 'archivage-channel'; readonly id: string; readonly idTrack: string }
	| { readonly type: 'corbeille-channel'; readonly id: string; readonly idTrack: string }

const AUCUNE: Ouverture = { type: 'aucune' }

/**
 * Une écriture à exécuter, telle que `executer` la reçoit.
 *
 * ÉCRITE EN FLÈCHE, DE NOUVEAU. Elle avait été déclarée en signature d'appel parce que le contrôle
 * « aucun texte visible en dur » de `i18n.test.ts` cherchait un nœud JSX entre deux chevrons sur une
 * même ligne, et que `=> Promise<ResultatEcriture>` en présentait exactement la forme. Le contrôle
 * avait raison de se déclencher — une expression régulière ne peut pas distinguer les deux —, et le
 * contourner par une exception aurait affaibli une garde pour une gêne d'écriture.
 *
 * Le contrôle lit désormais l'arbre syntaxique, où une signature générique n'est pas un texte
 * (INC-070, close ; `docs/JOURNAL.md` décisions 296 et 381). La contrainte disparue, la forme
 * courante reprend sa place.
 */
type ActionEcriture = () => Promise<ResultatEcriture>

/** Traduit un refus, ou l'absence d'effet, en un texte destiné à l'utilisateur (§9). */
function texteRefus(refus: RefusEcriture): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.refus.forbidden')
		case 'slug-pris':
			return t('admin.refus.slug-pris')
		case 'workflow-hors-track':
			return t('admin.refus.workflow-hors-track')
		case 'forme-refusee':
			return t('admin.refus.forme-refusee')
		case 'reference-absente':
			return t('admin.refus.reference-absente')
		case 'network':
			return t('admin.refus.network')
		case 'unknown':
			return t('admin.refus.unknown')
	}
}

/**
 * Alerte de refus, placée **dans** le formulaire concerné et non en tête d'écran, pour que le refus
 * soit lu près du champ qui l'a causé (docs/DESIGN_SYSTEM.md §5.13).
 */
function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="admin-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

type ProprietesChamp = {
	readonly id: string
	readonly libelle: string
	readonly valeur: string
	readonly onChange: (valeur: string) => void
	readonly aide?: string
	readonly erreur?: string
	readonly refInterne?: React.Ref<HTMLInputElement>
	readonly desactive?: boolean
}

/** Champ texte du §5.7 : libellé au-dessus, aide et erreur associées par `aria-describedby`. */
function ChampTexte({
	id,
	libelle,
	valeur,
	onChange,
	aide,
	erreur,
	refInterne,
	desactive = false,
}: ProprietesChamp) {
	const idAide = `${id}-aide`
	const idErreur = `${id}-erreur`
	const decrit = [aide === undefined ? null : idAide, erreur === undefined ? null : idErreur]
		.filter((valeur): valeur is string => valeur !== null)
		.join(' ')
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-text-2">
				{libelle}
			</label>
			<input
				id={id}
				ref={refInterne}
				value={valeur}
				disabled={desactive}
				onChange={(evenement) => onChange(evenement.target.value)}
				aria-describedby={decrit === '' ? undefined : decrit}
				aria-invalid={erreur === undefined ? undefined : true}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 disabled:opacity-70"
			/>
			{aide === undefined ? null : (
				<span id={idAide} className="text-sm text-text-3">
					{aide}
				</span>
			)}
			{erreur === undefined ? null : (
				<span id={idErreur} role="alert" className="text-sm text-danger-on-soft">
					{erreur}
				</span>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Formulaire d'un track
// ---------------------------------------------------------------------------------------------

type SaisieTrack = {
	readonly nom: string
	readonly slug: string
	readonly couleur: string
	readonly icone: string
	readonly description: string
}

type ProprietesFormulaireTrack = {
	readonly titre: string
	readonly initial: SaisieTrack
	/** À la création seule : le slug est saisissable, et proposé depuis le nom (§5.1, §5.3). */
	readonly slugModifiable: boolean
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieTrack) => void
	readonly onAnnuler: () => void
}

function FormulaireTrack({
	titre,
	initial,
	slugModifiable,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: ProprietesFormulaireTrack) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	// La proposition de slug cesse dès que l'utilisateur a touché le champ, sans quoi elle
	// écraserait sa saisie à la frappe suivante dans le nom (§5.1).
	const [slugTouche, setSlugTouche] = useState(false)
	const premier = useRef<HTMLInputElement>(null)

	// Ouvrir un formulaire déplace le focus dans son premier champ (docs/DESIGN_SYSTEM.md §5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const slugMalforme = saisie.slug !== '' && !slugConforme(saisie.slug)
	const complet = nomConforme(saisie.nom) && saisie.slug !== '' && !slugMalforme

	return (
		<form
			data-testid="formulaire-track"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h3 className="text-h3">{titre}</h3>
			<ChampTexte
				id={`${prefixe}-nom`}
				libelle={t('admin.form.name')}
				valeur={saisie.nom}
				refInterne={premier}
				onChange={(nom) =>
					setSaisie((precedente) => ({
						...precedente,
						nom,
						slug:
							slugModifiable && !slugTouche ? proposerSlug(nom) : precedente.slug,
					}))
				}
			/>
			<ChampTexte
				id={`${prefixe}-slug`}
				libelle={t('admin.form.slug')}
				valeur={saisie.slug}
				desactive={!slugModifiable}
				aide={slugModifiable ? t('admin.form.slug.help') : t('admin.form.slug.locked')}
				{...(slugMalforme ? { erreur: t('admin.form.slug.invalid') } : {})}
				onChange={(slug) => {
					setSlugTouche(true)
					setSaisie((precedente) => ({ ...precedente, slug }))
				}}
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-couleur`} className="text-sm text-text-2">
					{t('admin.form.color')}
				</label>
				<select
					id={`${prefixe}-couleur`}
					value={saisie.couleur}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, couleur: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				>
					{COULEURS.map((couleur) => (
						<option key={couleur} value={couleur}>
							{couleur}
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-icone`} className="text-sm text-text-2">
					{t('admin.form.icon')}
				</label>
				<select
					id={`${prefixe}-icone`}
					value={saisie.icone}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, icone: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				>
					{NOMS_ICONES.map((nom) => (
						<option key={nom} value={nom}>
							{nom}
						</option>
					))}
				</select>
			</div>
			<ChampTexte
				id={`${prefixe}-description`}
				libelle={t('admin.form.description')}
				valeur={saisie.description}
				onChange={(description) => setSaisie((precedente) => ({ ...precedente, description }))}
			/>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{slugModifiable ? t('admin.action.create') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Formulaire d'un channel
// ---------------------------------------------------------------------------------------------

type SaisieChannel = {
	readonly nom: string
	readonly slug: string
	readonly description: string
	readonly idWorkflow: string
}

type ProprietesFormulaireChannel = {
	readonly titre: string
	readonly initial: SaisieChannel
	readonly slugModifiable: boolean
	readonly workflows: EtatAsync<readonly WorkflowAffectable[]>
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieChannel) => void
	readonly onAnnuler: () => void
}

function FormulaireChannel({
	titre,
	initial,
	slugModifiable,
	workflows,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: ProprietesFormulaireChannel) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	const [slugTouche, setSlugTouche] = useState(false)
	const premier = useRef<HTMLInputElement>(null)

	useEffect(() => {
		premier.current?.focus()
	}, [])

	const slugMalforme = saisie.slug !== '' && !slugConforme(saisie.slug)
	// Un workflow est OBLIGATOIRE (docs/SPEC-workflow-engine.md §4.12.5). Le bouton reste désactivé
	// tant qu'aucun n'est choisi : ce n'est pas un droit calculé, c'est un champ requis dont
	// l'absence est refusée par la contrainte `NOT NULL`.
	const complet =
		nomConforme(saisie.nom) && saisie.slug !== '' && !slugMalforme && saisie.idWorkflow !== ''

	const aucunWorkflow = workflows.statut === 'pret' && workflows.donnees.length === 0

	return (
		<form
			data-testid="formulaire-channel"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h3 className="text-h3">{titre}</h3>
			<ChampTexte
				id={`${prefixe}-nom`}
				libelle={t('admin.form.name')}
				valeur={saisie.nom}
				refInterne={premier}
				onChange={(nom) =>
					setSaisie((precedente) => ({
						...precedente,
						nom,
						slug: slugModifiable && !slugTouche ? proposerSlug(nom) : precedente.slug,
					}))
				}
			/>
			<ChampTexte
				id={`${prefixe}-slug`}
				libelle={t('admin.form.slug')}
				valeur={saisie.slug}
				desactive={!slugModifiable}
				aide={slugModifiable ? t('admin.form.slug.help') : t('admin.form.slug.locked')}
				{...(slugMalforme ? { erreur: t('admin.form.slug.invalid') } : {})}
				onChange={(slug) => {
					setSlugTouche(true)
					setSaisie((precedente) => ({ ...precedente, slug }))
				}}
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-workflow`} className="text-sm text-text-2">
					{t('admin.form.workflow')}
				</label>
				{workflows.statut === 'chargement' ? (
					<span className="text-sm text-text-3">{t('admin.form.workflow.loading')}</span>
				) : null}
				{aucunWorkflow ? (
					// État vide, et non un contrôle d'accès : il n'y a rien à choisir.
					<p data-testid="admin-sans-workflow" className="text-sm text-text-3">
						{t('admin.form.workflow.none')}
					</p>
				) : null}
				{workflows.statut === 'pret' && workflows.donnees.length > 0 ? (
					<select
						id={`${prefixe}-workflow`}
						value={saisie.idWorkflow}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, idWorkflow: evenement.target.value }))
						}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					>
						{/* Aucun défaut n'est présélectionné : « le défaut silencieux transformerait une
						    omission du client en un choix qu'il n'a pas fait » (§4.12.5). */}
						<option value="">{t('admin.form.workflow.choose')}</option>
						{workflows.donnees.map((workflow) => (
							<option key={workflow.id} value={workflow.id}>
								{workflow.is_default
									? t('admin.form.workflow.default', { nom: workflow.name })
									: workflow.name}
							</option>
						))}
					</select>
				) : null}
			</div>
			<ChampTexte
				id={`${prefixe}-description`}
				libelle={t('admin.form.description')}
				valeur={saisie.description}
				onChange={(description) => setSaisie((precedente) => ({ ...precedente, description }))}
			/>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{slugModifiable ? t('admin.action.create') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Confirmation d'archivage — dans le flux du document, jamais une modale (§3.2)
// ---------------------------------------------------------------------------------------------

function ConfirmationArchivage({
	question,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly question: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-archivage"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('admin.archive.confirm.body')}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<button
					ref={premier}
					type="button"
					disabled={enCours}
					onClick={onConfirmer}
					className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] rounded-sm px-4 font-medium bg-danger text-white hover:opacity-90 disabled:opacity-70"
				>
					{t('admin.archive.confirm.action')}
				</button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Confirmation de mise à la corbeille — CRM-077, docs/SPEC-corbeille.md §4 bis.3
// ---------------------------------------------------------------------------------------------

/**
 * Les lignes de l'énumération, dans les quatre états que le §4 bis.3 distingue.
 *
 * AUCUN DES QUATRE N'ÉTEINT LA COMMANDE, et c'est la règle du chapitre : l'énumération est une
 * information, pas une garde. La refuser en bloquant donnerait à un compte la valeur d'une
 * autorisation, alors que le §3.5 interdit de le présenter comme une garantie d'exhaustivité — et le
 * geste est réversible, l'écran de corbeille étant là pour cela.
 *
 * Le seul affichage exclu est un ZÉRO PROVISOIRE pendant l'attente : il dirait « rien ne sera
 * perdu » sur une mesure qui n'est pas revenue (`docs/DESIGN_SYSTEM.md` §5.15).
 */
function EnumerationConfirmation({ enumeration }: { readonly enumeration: EtatEnumeration }) {
	if (enumeration.statut === 'chargement') {
		return <p className="text-sm text-text-3">{t('admin.trash.holds.loading')}</p>
	}
	if (enumeration.statut === 'echec') {
		return <p className="text-sm text-text-3">{t('admin.trash.holds.failed')}</p>
	}
	if (enumeration.lignes.length === 0) {
		return <p className="text-sm text-text-2">{t('admin.trash.confirm.holds.none')}</p>
	}
	return (
		<div className="flex flex-col gap-1">
			<p className="text-sm text-text-2">{t('admin.trash.confirm.holds')}</p>
			<ul className="list-disc pl-5 text-sm text-text-2">
				{enumeration.lignes.map((ligne) => (
					<li key={ligne.type}>{texteLigneEnumeration(ligne)}</li>
				))}
			</ul>
		</div>
	)
}

/**
 * Confirmation du geste, dans le flux du document comme celle de l'archivage (§3.2 de
 * `docs/SPEC-administration-arborescence.md`) — jamais une modale.
 *
 * Elle est un COMPOSANT DISTINCT de `ConfirmationArchivage`, et non une variante paramétrée : elle
 * porte l'énumération, sa question et son corps disent autre chose, et les deux états sont
 * indépendants (§3.1). Les fondre aurait laissé croire qu'un objet retiré est un objet archivé.
 */
function ConfirmationCorbeille({
	question,
	enumeration,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly question: string
	readonly enumeration: EtatEnumeration
	readonly refus: string | null
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-corbeille"
			// `max-w-[72ch]` N'EST PAS UNE PRÉFÉRENCE DE MISE EN PAGE, c'est un correctif trouvé en
			// REGARDANT une capture (`CLAUDE.md` §16). La liste des tracks porte `min-w-max` pour son
			// débordement horizontal (§12.6), si bien qu'un paragraphe placé dedans ne se replie
			// JAMAIS : le corps de cette confirmation, plus long que celui de l'archivage, élargissait
			// le conteneur et sortait du champ. La borne rend au texte son repli sans toucher au
			// conteneur, dont le débordement sert aux lignes de commandes.
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 max-w-[72ch]"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('admin.trash.confirm.body')}</p>
			<EnumerationConfirmation enumeration={enumeration} />
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<button
					ref={premier}
					type="button"
					disabled={enCours}
					onClick={onConfirmer}
					className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] rounded-sm px-4 font-medium bg-danger text-white hover:opacity-90 disabled:opacity-70"
				>
					{t('admin.trash.confirm.action')}
				</button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Groupe de commandes d'une ligne
// ---------------------------------------------------------------------------------------------

type ProprietesCommandes = {
	readonly nom: string
	readonly liste: readonly Ordonnable[]
	readonly id: string
	readonly archive: boolean
	readonly onDeplacer: (sens: Sens) => void
	readonly onModifier: () => void
	readonly onArchiver: () => void
	readonly onCorbeille: () => void
}

/**
 * Les commandes d'une ligne — toujours visibles, jamais au survol seul, et **jamais masquées** sur
 * la foi d'un rôle (docs/DESIGN_SYSTEM.md §5.13, et §10 de la spécification).
 *
 * Une ligne archivée n'en garde qu'une : renommer ou réordonner un objet masqué n'a pas d'effet
 * observable (§6.4).
 */
function CommandesLigne({
	nom,
	liste,
	id,
	archive,
	onDeplacer,
	onModifier,
	onArchiver,
	onCorbeille,
}: ProprietesCommandes) {
	/**
	 * La mise à la corbeille, offerte sur TOUTE ligne — archivée comprise.
	 *
	 * Les deux états sont indépendants (`docs/SPEC-corbeille.md` §3.1) : un objet archivé se retire,
	 * et il reste archivé quand on le restaure. C'est le motif même qui retire les trois autres
	 * commandes d'une ligne archivée qui impose de garder celle-ci — renommer ou réordonner un objet
	 * masqué n'a « aucun effet observable » (§6.4), alors que le retirer en a un : il quitte cet
	 * écran pour la corbeille.
	 */
	const commandeCorbeille = (
		<Button
			taille="compacte"
			variante="discret"
			onClick={onCorbeille}
			aria-label={t('admin.action.trash', { nom })}
		>
			<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
		</Button>
	)

	if (archive) {
		return (
			<>
				<Button
					taille="compacte"
					variante="discret"
					onClick={onArchiver}
					aria-label={t('admin.action.unarchive', { nom })}
				>
					<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				{commandeCorbeille}
			</>
		)
	}

	const peutMonter = calculerDeplacement(liste, id, 'monter')
	const peutDescendre = calculerDeplacement(liste, id, 'descendre')

	/**
	 * Pourquoi la commande est indisponible — `docs/DESIGN_SYSTEM.md` §8 : « les états désactivés
	 * restent lisibles et **expliquent pourquoi** l'action est indisponible ».
	 *
	 * Les deux causes appellent deux phrases différentes, et les confondre serait un message faux :
	 * une ligne dont les voisines portent la même position n'est PAS « déjà en tête de liste ».
	 * Défaut trouvé par la preuve, qui cliquait une commande désactivée en attendant une alerte —
	 * l'infobulle mentait, et rien ne le signalait.
	 */
	const explication = (deplacement: typeof peutMonter, extremite: string): string | undefined => {
		if (deplacement.statut === 'calcule') return undefined
		return deplacement.cause === 'extremite' ? extremite : t('admin.move.impossible')
	}

	return (
		<>
			<Button
				taille="compacte"
				variante="discret"
				disabled={peutMonter.statut !== 'calcule'}
				onClick={() => onDeplacer('monter')}
				aria-label={t('admin.action.up', { nom })}
				title={explication(peutMonter, t('admin.move.disabled.top'))}
			>
				<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
			</Button>
			<Button
				taille="compacte"
				variante="discret"
				disabled={peutDescendre.statut !== 'calcule'}
				onClick={() => onDeplacer('descendre')}
				aria-label={t('admin.action.down', { nom })}
				title={explication(peutDescendre, t('admin.move.disabled.bottom'))}
			>
				<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
			</Button>
			<Button
				taille="compacte"
				variante="discret"
				onClick={onModifier}
				aria-label={t('admin.action.rename', { nom })}
			>
				<Pencil aria-hidden="true" size={16} strokeWidth={2} />
			</Button>
			<Button
				taille="compacte"
				variante="discret"
				onClick={onArchiver}
				aria-label={t('admin.action.archive', { nom })}
			>
				<Archive aria-hidden="true" size={16} strokeWidth={2} />
			</Button>
			{commandeCorbeille}
		</>
	)
}

/** Mention textuelle d'un objet archivé — jamais une teinte seule (docs/DESIGN_SYSTEM.md §5.13). */
function MentionArchive() {
	return <span className="text-sm text-text-2">{t('admin.tree.archived')}</span>
}

// ---------------------------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------------------------

export type ProprietesAdministration = {
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

export function AdministrationArborescence({ client = clientCrm }: ProprietesAdministration = {}) {
	const [inclureArchives, setInclureArchives] = useState(false)
	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [tracks, setTracks] = useState<EtatAsync<readonly TrackAdministrable[]>>(enChargement)
	const [deplies, setDeplies] = useState<readonly string[]>([])
	const [channels, setChannels] = useState<
		Readonly<Record<string, EtatAsync<readonly ChannelAdministrable[]>>>
	>({})
	const [workflows, setWorkflows] = useState<EtatAsync<readonly WorkflowAffectable[]>>(enChargement)
	const [ouverture, setOuverture] = useState<Ouverture>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const [tentative, setTentative] = useState(0)
	/**
	 * L'énumération de la confirmation ouverte, et il n'y en a qu'une : `Ouverture` n'autorise qu'un
	 * formulaire à la fois, donc un seul état suffit et aucune clé n'est à tenir à jour.
	 */
	const [enumeration, setEnumeration] = useState<EtatEnumeration>({ statut: 'chargement' })

	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — la case des archivés change la requête.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setTracks(enChargement)
		void (async () => {
			const espaces = await lireWorkspaces(client)
			if (rang !== courant.current) return
			// Le cas est traité par `statut === 'erreur'` et non par `!== 'pret'` : le troisième
			// membre du type somme est `chargement`, qu'une fonction résolue ne rend jamais, et
			// l'écarter par la négative empêcherait le compilateur de nommer la branche.
			if (espaces.statut === 'erreur') {
				setTracks({ statut: 'erreur', erreur: espaces.erreur })
				return
			}
			if (espaces.statut !== 'pret') return
			const premier = espaces.donnees[0]
			setIdWorkspace(premier?.id ?? null)
			const lus = await lireTracksAdministrables(client, inclureArchives)
			if (rang !== courant.current) return
			setTracks(lus)
		})()
	}, [client, inclureArchives, tentative])

	/**
	 * Recharge les channels d'UN track avec le filtre d'archives PASSÉ EN PARAMÈTRE, plutôt que lu
	 * depuis l'état `inclureArchives` — nécessaire pour que le bascule de la case « Afficher les
	 * archivés » (§6.4) puisse recharger un track déjà déplié avec la valeur qu'il vient de choisir,
	 * sans attendre le rendu suivant : `setInclureArchives` est asynchrone, et un appel qui lirait
	 * l'état capturerait encore l'ancienne valeur au moment où il s'exécute.
	 */
	const rechargerChannelsAvec = useCallback(
		async (idTrack: string, inclure: boolean) => {
			if (client === null) return
			const lus = await lireChannelsAdministrables(client, idTrack, inclure)
			setChannels((precedents) => ({ ...precedents, [idTrack]: lus }))
		},
		[client],
	)

	const rechargerChannels = useCallback(
		(idTrack: string) => rechargerChannelsAvec(idTrack, inclureArchives),
		[rechargerChannelsAvec, inclureArchives],
	)

	const basculerDepli = useCallback(
		(idTrack: string) => {
			setDeplies((precedents) => {
				if (precedents.includes(idTrack)) return precedents.filter((id) => id !== idTrack)
				// Les channels ne sont chargés qu'au dépliage (§3.2).
				setChannels((etat) => ({ ...etat, [idTrack]: enChargement() }))
				void rechargerChannels(idTrack)
				return [...precedents, idTrack]
			})
		},
		[rechargerChannels],
	)

	/**
	 * Bascule la case « Afficher les archivés » ET recharge les channels de tout track déjà déplié
	 * avec la nouvelle valeur.
	 *
	 * DÉFAUT RÉEL TROUVÉ PAR LA PREUVE E2E, PAS À LA LECTURE : sans ce geste, un channel archivé
	 * pendant qu'un track est ouvert disparaissait de la liste chargée en mémoire — filtrée par
	 * `lireChannelsAdministrables` au moment de l'archivage, qui relit avec le filtre ALORS actif
	 * (§9, dernière règle) —, et cocher la case ensuite ne rechargeait QUE la liste des tracks : rien
	 * ne reliait le bascule de la case aux channels déjà en mémoire. Un utilisateur qui archivait un
	 * channel puis cochait la case pour le retrouver ne le voyait jamais, exactement l'erreur
	 * masquée que `CLAUDE.md` §18 proscrit.
	 */
	const basculerAfficherArchives = useCallback(
		(inclure: boolean) => {
			setInclureArchives(inclure)
			for (const idTrack of deplies) {
				setChannels((etat) => ({ ...etat, [idTrack]: enChargement() }))
				void rechargerChannelsAvec(idTrack, inclure)
			}
		},
		[deplies, rechargerChannelsAvec],
	)

	/** Ferme le formulaire, oublie le refus, et relit depuis le serveur (§9, dernière règle). */
	const apres = useCallback(
		async (resultat: ResultatEcriture, message: string, idTrack?: string) => {
			if (resultat.statut === 'refus') {
				setRefus(texteRefus(resultat.refus))
				return
			}
			if (resultat.statut === 'sans-effet') {
				setRefus(t('admin.refus.sans-effet'))
				return
			}
			setRefus(null)
			setOuverture(AUCUNE)
			setAnnonce(message)
			setTentative((precedente) => precedente + 1)
			if (idTrack !== undefined) await rechargerChannels(idTrack)
		},
		[rechargerChannels],
	)

	/** Enveloppe commune : une seule écriture à la fois, et l'état « en cours » ne fuit jamais. */
	const executer = useCallback(
		async (action: ActionEcriture, message: string, idTrack?: string) => {
			setEnCours(true)
			try {
				await apres(await action(), message, idTrack)
			} finally {
				setEnCours(false)
			}
		},
		[apres],
	)

	/**
	 * Ouvre la confirmation de mise à la corbeille ET lance l'énumération (§4 bis.3).
	 *
	 * Le compte est demandé À L'OUVERTURE, pas au chargement de la liste : il coûte deux requêtes par
	 * track et une par channel (§4.4), et la plupart des lignes ne seront jamais retirées. Un refus de
	 * lecture ne se distingue pas ici d'un compte nul, et c'est voulu — `compterEnfantsInaccessibles`
	 * rend ce que l'APPELANT peut lire (§3.5), jamais une garantie d'exhaustivité.
	 */
	const ouvrirCorbeille = useCallback(
		(cible: CibleEnumeration, prochaine: Ouverture) => {
			setRefus(null)
			setOuverture(prochaine)
			setEnumeration({ statut: 'chargement' })
			if (client === null) return
			void compterEnfantsInaccessibles(client, cible).then((compte) => {
				setEnumeration(
					compte.statut === 'pret'
						? { statut: 'pret', lignes: composerEnumeration(compte.donnees) }
						: { statut: 'echec' },
				)
			})
		},
		[client],
	)

	const deplacer = useCallback(
		(liste: readonly Ordonnable[], id: string, sens: Sens, estChannel: boolean, idTrack?: string) => {
			if (client === null) return
			const calcul = calculerDeplacement(liste, id, sens)
			if (calcul.statut !== 'calcule') {
				// L'écran NOMME le refus au lieu d'écrire une valeur sans effet (§6.2).
				setRefus(t('admin.move.impossible'))
				return
			}
			void executer(
				() =>
					estChannel
						? deplacerChannel(client, id, calcul.position)
						: deplacerTrack(client, id, calcul.position),
				t('live.admin.moved'),
				idTrack,
			)
		},
		[client, executer],
	)

	const ouvrirCreationChannel = useCallback(
		(track: TrackAdministrable) => {
			setRefus(null)
			setOuverture({ type: 'creation-channel', idTrack: track.id })
			if (client === null) return
			setWorkflows(enChargement())
			void lireWorkflowsAffectables(client, track.workspace_id, track.id).then(setWorkflows)
		},
		[client],
	)

	if (client === null || (tracks.statut === 'pret' && idWorkspace === null)) {
		return (
			<EtatVide titre={t('admin.tree.noWorkspace.title')} corps={t('admin.tree.noWorkspace.body')} />
		)
	}

	if (tracks.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (tracks.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.tree.error.title')}
				corps={t('admin.tree.error.body')}
				libelleReprise={t('admin.tree.error.retry')}
				onReprise={() => setTentative((precedente) => precedente + 1)}
			/>
		)
	}

	const liste = tracks.donnees

	return (
		<section aria-label={t('admin.tree.aria')} className="flex flex-col gap-4">
			<LiveRegion message={annonce} libelle={t('live.admin.aria')} />

			<div className="flex flex-wrap items-center justify-between gap-2">
				<Button
					variante="primaire"
					onClick={() => {
						setRefus(null)
						setOuverture({ type: 'creation-track' })
					}}
				>
					<Plus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.action.newTrack')}
				</Button>
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						checked={inclureArchives}
						onChange={(evenement) => basculerAfficherArchives(evenement.target.checked)}
						className="size-6 rounded-sm border border-border"
					/>
					{t('admin.tree.showArchived')}
				</label>
			</div>

			{/*
			 * Un refus qui n'appartient à AUCUN formulaire — celui d'un déplacement impossible
			 * (§6.2), ou d'un archivage lancé depuis une ligne — est affiché ici.
			 *
			 * Défaut réel, trouvé par la preuve et non à la lecture : `setRefus` était appelé pour
			 * un déplacement refusé, mais l'alerte n'était rendue que DANS les formulaires. Le
			 * refus était donc calculé, correct, et invisible — exactement l'erreur masquée que
			 * `CLAUDE.md` §18 proscrit.
			 */}
			{refus !== null && ouverture.type === 'aucune' ? <AlerteRefus message={refus} /> : null}

			{ouverture.type === 'creation-track' ? (
				<FormulaireTrack
					titre={t('admin.form.track.create')}
					initial={{ nom: '', slug: '', couleur: 'neutral', icone: 'folder', description: '' }}
					slugModifiable
					refus={refus}
					enCours={enCours}
					onAnnuler={() => {
						setRefus(null)
						setOuverture(AUCUNE)
					}}
					onValider={(saisie) => {
						if (idWorkspace === null) return
						void executer(
							() =>
								creerTrack(client, {
									idWorkspace,
									nom: saisie.nom,
									slug: saisie.slug,
									couleur: saisie.couleur,
									icone: saisie.icone,
									description: saisie.description,
								}),
							t('live.admin.created'),
						)
					}}
				/>
			) : null}

			{liste.length === 0 ? (
				<EtatVide titre={t('admin.tree.empty.title')} corps={t('admin.tree.empty.body')} />
			) : (
				// DÉFAUT RÉEL TROUVÉ EN REGARDANT UNE CAPTURE À 390 PX (CLAUDE.md §16), PAS EN LISANT
				// UN TEST — même mode de défaillance que la décision `docs/DESIGN_SYSTEM.md` §12.6 :
				// le groupe de commandes d'une ligne au nom long (« Formation ») déborde de la
				// largeur de la liste, et `<main>` (`AppShell.tsx`) porte son propre `overflow-x-auto`
				// SANS l'indication — le bouton « Archiver » disparaissait au bord, sans qu'aucun
				// dégradé ne signale qu'il y avait plus à voir. Le conteneur ci-dessous reprend
				// exactement le patron déjà posé pour la barre d'onglets, le board, la vue liste et
				// le tableau de `CRM-059`.
				<div className="overflow-x-auto indique-debordement-x">
					<ul className="flex flex-col rounded-lg border border-border bg-surface min-w-max">
					{liste.map((track) => {
						const archive = track.archived_at !== null
						const deplie = deplies.includes(track.id)
						const Icone = iconeTrack(track.icon)
						return (
							<li key={track.id} className="border-b border-border last:border-b-0">
								<div className="flex items-center gap-2 px-3 min-h-[var(--size-target)] hover:bg-hover">
									<button
										type="button"
										aria-expanded={deplie}
										onClick={() => basculerDepli(track.id)}
										aria-label={
											deplie
												? t('admin.action.collapse', { nom: track.name })
												: t('admin.action.expand', { nom: track.name })
										}
										// `size-10` n'existe PAS : 40 px n'est pas dans l'échelle du §3, et la classe ne serait
						// pas engendrée du tout — silencieusement (docs/DESIGN_SYSTEM.md §11). Le contrôle
						// `scripts/lib/classes-css.mjs` l'a attrapée. La cible de 40 px vient du jeton.
						className="inline-flex items-center justify-center min-h-[var(--size-target)] px-2 rounded-sm hover:bg-hover"
									>
										{deplie ? (
											<ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
										) : (
											<ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
										)}
									</button>
									<span
										className={[
											'inline-flex items-center gap-2 rounded-full px-3 min-h-[var(--size-target)]',
											classesPilule(track.color),
										].join(' ')}
									>
										<Icone aria-hidden="true" size={16} strokeWidth={2} />
										{track.name}
									</span>
									<code className="text-sm text-text-3">{track.slug}</code>
									{archive ? <MentionArchive /> : null}
									<span className="ml-auto flex items-center gap-1">
										<CommandesLigne
											nom={track.name}
											liste={liste}
											id={track.id}
											archive={archive}
											onDeplacer={(sens) => deplacer(liste, track.id, sens, false)}
											onModifier={() => {
												setRefus(null)
												setOuverture({ type: 'edition-track', id: track.id })
											}}
											onArchiver={() => {
												setRefus(null)
												if (archive) {
													void executer(
														() => archiverTrack(client, track.id, false),
														t('live.admin.unarchived'),
													)
													return
												}
												setOuverture({ type: 'archivage-track', id: track.id })
											}}
											onCorbeille={() =>
												ouvrirCorbeille({ type: 'track', id: track.id }, {
													type: 'corbeille-track',
													id: track.id,
												})
											}
										/>
									</span>
								</div>

								{ouverture.type === 'edition-track' && ouverture.id === track.id ? (
									<div className="px-3 pb-3">
										<FormulaireTrack
											titre={t('admin.form.track.edit')}
											initial={{
												nom: track.name,
												slug: track.slug,
												couleur: track.color,
												icone: track.icon,
												description: track.description ?? '',
											}}
											slugModifiable={false}
											refus={refus}
											enCours={enCours}
											onAnnuler={() => {
												setRefus(null)
												setOuverture(AUCUNE)
											}}
											onValider={(saisie) =>
												void executer(
													() =>
														modifierTrack(client, track.id, {
															nom: saisie.nom,
															couleur: saisie.couleur,
															icone: saisie.icone,
															description: saisie.description,
														}),
													t('live.admin.updated'),
												)
											}
										/>
									</div>
								) : null}

								{ouverture.type === 'archivage-track' && ouverture.id === track.id ? (
									<div className="px-3 pb-3">
										<ConfirmationArchivage
											question={t('admin.archive.confirm.track', { nom: track.name })}
											refus={refus}
											enCours={enCours}
											onAnnuler={() => {
												setRefus(null)
												setOuverture(AUCUNE)
											}}
											onConfirmer={() =>
												void executer(
													() => archiverTrack(client, track.id, true),
													t('live.admin.archived'),
												)
											}
										/>
									</div>
								) : null}

								{ouverture.type === 'corbeille-track' && ouverture.id === track.id ? (
									<div className="px-3 pb-3">
										<ConfirmationCorbeille
											question={t('admin.trash.confirm.track', { nom: track.name })}
											enumeration={enumeration}
											refus={refus}
											enCours={enCours}
											onAnnuler={() => {
												setRefus(null)
												setOuverture(AUCUNE)
											}}
											onConfirmer={() =>
												void executer(
													() => mettreTrackALaCorbeille(client, track.id),
													t('live.admin.trashed'),
												)
											}
										/>
									</div>
								) : null}

								{deplie ? (
									<ListeChannels
										track={track}
										etat={channels[track.id] ?? enChargement()}
										ouverture={ouverture}
										refus={refus}
										enCours={enCours}
										workflows={workflows}
										onCreer={() => ouvrirCreationChannel(track)}
										onAnnuler={() => {
											setRefus(null)
											setOuverture(AUCUNE)
										}}
										onValiderCreation={(saisie) =>
											void executer(
												() =>
													creerChannel(client, {
														idWorkspace: track.workspace_id,
														idTrack: track.id,
														idWorkflow: saisie.idWorkflow,
														nom: saisie.nom,
														slug: saisie.slug,
														description: saisie.description,
													}),
												t('live.admin.created'),
												track.id,
											)
										}
										onValiderEdition={(id, saisie) =>
											void executer(
												() =>
													modifierChannel(client, id, {
														nom: saisie.nom,
														description: saisie.description,
														idWorkflow: saisie.idWorkflow,
													}),
												t('live.admin.updated'),
												track.id,
											)
										}
										onOuvrirEdition={(channel) => {
											setRefus(null)
											setOuverture({
												type: 'edition-channel',
												id: channel.id,
												idTrack: track.id,
											})
											if (client === null) return
											setWorkflows(enChargement())
											void lireWorkflowsAffectables(
												client,
												track.workspace_id,
												track.id,
											).then(setWorkflows)
										}}
										onDeplacer={(listeChannels, id, sens) =>
											deplacer(listeChannels, id, sens, true, track.id)
										}
										onArchiver={(channel) => {
											setRefus(null)
											if (channel.archived_at !== null) {
												void executer(
													() => archiverChannel(client, channel.id, false),
													t('live.admin.unarchived'),
													track.id,
												)
												return
											}
											setOuverture({
												type: 'archivage-channel',
												id: channel.id,
												idTrack: track.id,
											})
										}}
										onConfirmerArchivage={(channel) =>
											void executer(
												() => archiverChannel(client, channel.id, true),
												t('live.admin.archived'),
												track.id,
											)
										}
										enumeration={enumeration}
										onCorbeille={(channel) =>
											ouvrirCorbeille({ type: 'channel', id: channel.id }, {
												type: 'corbeille-channel',
												id: channel.id,
												idTrack: track.id,
											})
										}
										onConfirmerCorbeille={(channel) =>
											void executer(
												() => mettreChannelALaCorbeille(client, channel.id),
												t('live.admin.trashed'),
												track.id,
											)
										}
									/>
								) : null}
							</li>
						)
					})}
					</ul>
				</div>
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------------------------
// Les channels d'un track déplié
// ---------------------------------------------------------------------------------------------

type ProprietesListeChannels = {
	readonly track: TrackAdministrable
	readonly etat: EtatAsync<readonly ChannelAdministrable[]>
	readonly ouverture: Ouverture
	readonly refus: string | null
	readonly enCours: boolean
	readonly workflows: EtatAsync<readonly WorkflowAffectable[]>
	readonly onCreer: () => void
	readonly onAnnuler: () => void
	readonly onValiderCreation: (saisie: SaisieChannel) => void
	readonly onValiderEdition: (id: string, saisie: SaisieChannel) => void
	readonly onOuvrirEdition: (channel: ChannelAdministrable) => void
	readonly onDeplacer: (liste: readonly Ordonnable[], id: string, sens: Sens) => void
	readonly onArchiver: (channel: ChannelAdministrable) => void
	readonly onConfirmerArchivage: (channel: ChannelAdministrable) => void
	/** L'énumération de la confirmation ouverte, s'il y en a une : une seule à la fois (§4 bis.3). */
	readonly enumeration: EtatEnumeration
	readonly onCorbeille: (channel: ChannelAdministrable) => void
	readonly onConfirmerCorbeille: (channel: ChannelAdministrable) => void
}

function ListeChannels({
	track,
	etat,
	ouverture,
	refus,
	enCours,
	workflows,
	onCreer,
	onAnnuler,
	onValiderCreation,
	onValiderEdition,
	onOuvrirEdition,
	onDeplacer,
	onArchiver,
	onConfirmerArchivage,
	enumeration,
	onCorbeille,
	onConfirmerCorbeille,
}: ProprietesListeChannels) {
	if (etat.statut === 'chargement') {
		return (
			<div className="pl-12 pr-3 pb-3">
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	if (etat.statut === 'erreur') {
		return (
			<p role="alert" className="pl-12 pr-3 pb-3 text-sm text-danger-on-soft">
				{t('admin.tree.channels.error')}
			</p>
		)
	}

	const liste = etat.donnees

	return (
		<div className="pl-12 pr-3 pb-3 flex flex-col gap-2">
			{/* Même correctif que la liste des tracks ci-dessus : conteneur dédié plutôt que de
			 * s'en remettre à l'`overflow-x-auto` non indiqué de `<main>` (§12.6). */}
			<div className="overflow-x-auto indique-debordement-x">
			<ul aria-label={t('admin.tree.channels.aria', { track: track.name })} className="flex flex-col min-w-max">
				{liste.length === 0 ? (
					<li className="text-sm text-text-3 py-2">{t('admin.tree.channels.empty')}</li>
				) : null}
				{liste.map((channel) => {
					const archive = channel.archived_at !== null
					return (
						<li key={channel.id} className="flex flex-col">
							<div className="flex items-center gap-2 min-h-[var(--size-target)] hover:bg-hover rounded-sm px-2">
								<span>{channel.name}</span>
								<code className="text-sm text-text-3">{channel.slug}</code>
								{archive ? <MentionArchive /> : null}
								<span className="ml-auto flex items-center gap-1">
									<CommandesLigne
										nom={channel.name}
										liste={liste}
										id={channel.id}
										archive={archive}
										onDeplacer={(sens) => onDeplacer(liste, channel.id, sens)}
										onModifier={() => onOuvrirEdition(channel)}
										onArchiver={() => onArchiver(channel)}
										onCorbeille={() => onCorbeille(channel)}
									/>
								</span>
							</div>
							{ouverture.type === 'edition-channel' && ouverture.id === channel.id ? (
								<FormulaireChannel
									titre={t('admin.form.channel.edit')}
									initial={{
										nom: channel.name,
										slug: channel.slug,
										description: channel.description ?? '',
										idWorkflow: channel.workflow_id,
									}}
									slugModifiable={false}
									workflows={workflows}
									refus={refus}
									enCours={enCours}
									onAnnuler={onAnnuler}
									onValider={(saisie) => onValiderEdition(channel.id, saisie)}
								/>
							) : null}
							{ouverture.type === 'archivage-channel' && ouverture.id === channel.id ? (
								<ConfirmationArchivage
									question={t('admin.archive.confirm.channel', { nom: channel.name })}
									refus={refus}
									enCours={enCours}
									onAnnuler={onAnnuler}
									onConfirmer={() => onConfirmerArchivage(channel)}
								/>
							) : null}
							{ouverture.type === 'corbeille-channel' && ouverture.id === channel.id ? (
								<ConfirmationCorbeille
									question={t('admin.trash.confirm.channel', { nom: channel.name })}
									enumeration={enumeration}
									refus={refus}
									enCours={enCours}
									onAnnuler={onAnnuler}
									onConfirmer={() => onConfirmerCorbeille(channel)}
								/>
							) : null}
						</li>
					)
				})}
			</ul>
			</div>

			{ouverture.type === 'creation-channel' && ouverture.idTrack === track.id ? (
				<FormulaireChannel
					titre={t('admin.form.channel.create')}
					initial={{ nom: '', slug: '', description: '', idWorkflow: '' }}
					slugModifiable
					workflows={workflows}
					refus={refus}
					enCours={enCours}
					onAnnuler={onAnnuler}
					onValider={onValiderCreation}
				/>
			) : (
				<Button taille="compacte" variante="secondaire" onClick={onCreer}>
					<Plus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.action.newChannel')}
				</Button>
			)}
		</div>
	)
}
