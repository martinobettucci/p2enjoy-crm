// @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première et deuxième
//       tranches
// @spec docs/SPEC-workflow-engine.md §7 bis.2 (adresse), §7 bis.3 (les trois lectures),
//       §7 bis.4 (les six gestes), §7 bis.5 (validation de forme), §7 bis.6 (états,
//       accessibilité, responsive), §2.5 (`0` n'est pas `NULL`), §3.3 (contraintes), §3.5
//       (l'étape initiale)
// @spec docs/SPEC-workflow-engine.md §7 bis.9 (deuxième tranche : les arêtes), §7 bis.9.1
//       (lecture 4 et l'ordre composé), §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix
//       offerts), §7 bis.9.4 (validation de forme), §7 bis.9.6 (états et disposition),
//       §3.4 (modèle des arêtes)
// @spec docs/DESIGN_SYSTEM.md §5.7 (champs), §5.7 bis (case à cocher), §5.8 (états), §6
//       (confirmation), §8 (accessibilité), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// AUCUN DROIT N'EST CALCULÉ ICI — la règle de `CRM-075`, reprise mot pour mot. Les commandes sont
// rendues pour tout le monde ; l'écriture part, et le refus du backend est traduit. Une commande
// masquée sur la foi d'un rôle lu au chargement cacherait un geste permis le jour où ce rôle a
// changé depuis — là où une commande refusée montre le refus réel.
//
// Le seul filtre que l'écran applique seul est celui des nœuds déjà employés dans le sélecteur
// d'ajout : l'unicité `(workflow_id, node_id)` refuserait l'insertion de toute façon, et il évite
// d'offrir un choix dont on sait qu'il sera refusé — une aide d'interface, pas une garde.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Flag,
	MessageSquare,
	Pencil,
	Plus,
	Trash2,
	TriangleAlert,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import {
	calculerDeplacement,
	deplacementPossible,
	type Ordonnable,
	type Sens,
} from '../lib/administration-arborescence'
import {
	ajouterEtape,
	ancienneteConforme,
	arriveesPossibles,
	declarerTransition,
	deplacerEtape,
	designerEtapeInitiale,
	grouperTransitions,
	libelleEtape,
	libelleSurchargeConforme,
	libelleTransitionConforme,
	lireCatalogueActif,
	lireEtapes,
	lireTransitions,
	lireWorkflowsAdministrables,
	modifierTransition,
	noeudsAjoutables,
	probabiliteConforme,
	retirerEtape,
	retirerTransition,
	surchargerEtape,
	type EtapeAdministrable,
	type NoeudAjoutable,
	type RefusEtape,
	type RefusTransition,
	type ResultatEtape,
	type ResultatTransition,
	type TransitionAdministrable,
	type WorkflowAdministrable,
} from '../lib/administration-workflows'
import { clientCrm, type ClientCrm } from '../lib/supabase'

// ---------------------------------------------------------------------------------------------
// Refus et ouvertures
// ---------------------------------------------------------------------------------------------

/** Traduit un refus, ou l'absence d'effet, en un texte destiné à l'utilisateur. */
function texteRefus(refus: RefusEtape): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.workflows.refus.forbidden')
		case 'noeud-deja-employe':
			return t('admin.workflows.refus.noeud-deja-employe')
		case 'etape-occupee':
			return t('admin.workflows.refus.etape-occupee')
		case 'reference-absente':
			return t('admin.workflows.refus.reference-absente')
		case 'forme-refusee':
			return t('admin.workflows.refus.forme-refusee')
		case 'network':
			return t('admin.workflows.refus.network')
		case 'unknown':
			return t('admin.workflows.refus.unknown')
	}
}

/**
 * Traduit un refus d'écriture sur une **arête**.
 *
 * DEUX NATURES ONT LEUR PROPRE TEXTE ICI, et c'est le §7 bis.9.5 appliqué : `reference-absente`
 * parle de deux étapes et non d'un nœud, et `forme-refusee` nomme les deux `CHECK` du §3.4 —
 * réflexivité et libellé blanc — plutôt que la probabilité et le seuil, qui n'existent pas sur une
 * arête. Réutiliser les textes des étapes aurait décrit à l'administrateur un refus qu'il n'a pas
 * provoqué.
 */
function texteRefusTransition(refus: RefusTransition): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.workflows.refus.forbidden')
		case 'arete-deja-declaree':
			return t('admin.workflows.refus.arete-deja-declaree')
		case 'reference-absente':
			return t('admin.workflows.refus.transition.reference-absente')
		case 'forme-refusee':
			return t('admin.workflows.refus.transition.forme-refusee')
		case 'network':
			return t('admin.workflows.refus.network')
		case 'unknown':
			return t('admin.workflows.refus.unknown')
	}
}

/**
 * Ce qui est ouvert, et il n'y en a qu'un à la fois — le patron de `CRM-075` : un seul formulaire
 * ouvert évite la question qu'aucune spécification ne tranche, celle d'une saisie non enregistrée
 * quand une seconde s'ouvre. Les trois ouvertures d'arête entrent dans la MÊME variable que celles
 * des étapes, pour que la règle reste vraie d'un bloc à l'autre : ouvrir une transition ferme un
 * formulaire de surcharge, et réciproquement.
 */
type Ouverture =
	| { readonly type: 'aucune' }
	| { readonly type: 'ajout' }
	| { readonly type: 'surcharge'; readonly idEtape: string }
	| { readonly type: 'retrait'; readonly idEtape: string }
	| { readonly type: 'transition-declaration' }
	| { readonly type: 'transition-edition'; readonly idTransition: string }
	| { readonly type: 'transition-retrait'; readonly idTransition: string }

const AUCUNE: Ouverture = { type: 'aucune' }

type ActionEtape = () => Promise<ResultatEtape>
type ActionTransition = () => Promise<ResultatTransition>

/**
 * Alerte de refus, placée dans le bloc concerné et non en tête d'écran, pour que le refus soit lu
 * près du geste qui l'a causé (docs/DESIGN_SYSTEM.md §5.13).
 */
function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="workflows-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

// ---------------------------------------------------------------------------------------------
// Formulaire de surcharge — §7 bis.4, §7 bis.5
// ---------------------------------------------------------------------------------------------

type SaisieSurcharge = {
	readonly libelle: string
	readonly probabilite: string
	readonly anciennete: string
}

/**
 * La saisie repart des surcharges PORTÉES par l'étape, jamais des valeurs du catalogue : un champ
 * vide veut dire « prendre la valeur du catalogue » (§2.5), et pré-remplir avec elle transformerait
 * chaque enregistrement en surcharge involontaire qui figerait la valeur du jour.
 */
function saisieDepuis(etape: EtapeAdministrable): SaisieSurcharge {
	return {
		libelle: etape.label_override ?? '',
		probabilite: etape.probability_override === null ? '' : String(etape.probability_override),
		anciennete: etape.stale_after_days === null ? '' : String(etape.stale_after_days),
	}
}

/** `''` redevient `null` — le retrait d'une surcharge est une valeur envoyée, pas un champ omis. */
function versSurcharge(saisie: SaisieSurcharge): {
	readonly libelle: string | null
	readonly probabilite: number | null
	readonly anciennete: number | null
} {
	return {
		libelle: saisie.libelle.trim() === '' ? null : saisie.libelle.trim(),
		probabilite: saisie.probabilite.trim() === '' ? null : Number(saisie.probabilite),
		anciennete: saisie.anciennete.trim() === '' ? null : Number(saisie.anciennete),
	}
}

type ProprietesChampSurcharge = {
	readonly id: string
	readonly libelle: string
	readonly valeur: string
	readonly onChange: (valeur: string) => void
	readonly aide: string
	readonly erreur?: string
	readonly refInterne?: React.Ref<HTMLInputElement>
}

/** Champ texte du §5.7 : libellé au-dessus, aide et erreur associées par `aria-describedby`. */
function ChampSurcharge({
	id,
	libelle,
	valeur,
	onChange,
	aide,
	erreur,
	refInterne,
}: ProprietesChampSurcharge) {
	const idAide = `${id}-aide`
	const idErreur = `${id}-erreur`
	const decrit = [idAide, erreur === undefined ? null : idErreur]
		.filter((identifiant): identifiant is string => identifiant !== null)
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
				onChange={(evenement) => onChange(evenement.target.value)}
				aria-describedby={decrit}
				aria-invalid={erreur === undefined ? undefined : true}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
			/>
			<span id={idAide} className="text-sm text-text-3">
				{aide}
			</span>
			{erreur === undefined ? null : (
				<span id={idErreur} role="alert" className="text-sm text-danger-on-soft">
					{erreur}
				</span>
			)}
		</div>
	)
}

type ProprietesFormulaireSurcharge = {
	readonly etape: EtapeAdministrable
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieSurcharge) => void
	readonly onAnnuler: () => void
}

function FormulaireSurcharge({
	etape,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: ProprietesFormulaireSurcharge) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(() => saisieDepuis(etape))
	const premier = useRef<HTMLInputElement>(null)

	// Ouvrir un formulaire déplace le focus dans son premier champ (docs/DESIGN_SYSTEM.md §5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	// Un champ vide est valide : il veut dire « prendre la valeur du catalogue ». La validation ne
	// porte que sur une valeur réellement saisie (§7 bis.5).
	const probabiliteInvalide =
		saisie.probabilite.trim() !== '' && !probabiliteConforme(Number(saisie.probabilite))
	const ancienneteInvalide =
		saisie.anciennete.trim() !== '' && !ancienneteConforme(Number(saisie.anciennete))
	const libelleInvalide = saisie.libelle !== '' && !libelleSurchargeConforme(saisie.libelle)
	const complet = !probabiliteInvalide && !ancienneteInvalide && !libelleInvalide

	return (
		<form
			data-testid="formulaire-surcharge"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h4 className="font-medium">
				{t('admin.workflows.form.override', { nom: libelleEtape(etape) })}
			</h4>
			<ChampSurcharge
				id={`${prefixe}-libelle`}
				libelle={t('admin.workflows.form.label')}
				valeur={saisie.libelle}
				onChange={(libelle) => setSaisie((precedente) => ({ ...precedente, libelle }))}
				aide={t('admin.workflows.form.label.help')}
				refInterne={premier}
			/>
			<ChampSurcharge
				id={`${prefixe}-probabilite`}
				libelle={t('admin.workflows.form.probability')}
				valeur={saisie.probabilite}
				onChange={(probabilite) => setSaisie((precedente) => ({ ...precedente, probabilite }))}
				aide={t('admin.workflows.form.probability.help')}
				{...(probabiliteInvalide
					? { erreur: t('admin.workflows.form.probability.invalid') }
					: {})}
			/>
			<ChampSurcharge
				id={`${prefixe}-anciennete`}
				libelle={t('admin.workflows.form.stale')}
				valeur={saisie.anciennete}
				onChange={(anciennete) => setSaisie((precedente) => ({ ...precedente, anciennete }))}
				aide={t('admin.workflows.form.stale.help')}
				{...(ancienneteInvalide ? { erreur: t('admin.workflows.form.stale.invalid') } : {})}
			/>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Confirmation de retrait — dans le flux du document, jamais une modale
// ---------------------------------------------------------------------------------------------

/**
 * Les textes sont REÇUS et non écrits ici : la confirmation sert deux retraits — une étape et une
 * arête — dont les conséquences n'ont rien de commun. Une étape occupée par des cards peut être
 * refusée par la base ; une arête ne l'est jamais (§7 bis.9.2), et promettre le même obstacle dans
 * les deux cas décrirait une règle qui n'existe pas.
 */
function ConfirmationRetrait({
	titre,
	corps,
	libelleAction,
	marqueur,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly titre: string
	readonly corps: string
	readonly libelleAction: string
	readonly marqueur: string
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
			data-testid={marqueur}
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{titre}</p>
			<p className="text-sm text-text-2">{corps}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<button
					ref={premier}
					type="button"
					disabled={enCours}
					onClick={onConfirmer}
					className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] rounded-sm px-4 font-medium bg-danger text-white hover:opacity-90 disabled:opacity-70"
				>
					{libelleAction}
				</button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Sélecteur d'ajout — §7 bis.3 lecture 3, §7 bis.4 premier geste
// ---------------------------------------------------------------------------------------------

function SelecteurAjout({
	catalogue,
	etapes,
	refus,
	enCours,
	onAjouter,
	onAnnuler,
}: {
	readonly catalogue: EtatAsync<readonly NoeudAjoutable[]>
	readonly etapes: readonly EtapeAdministrable[]
	readonly refus: string | null
	readonly enCours: boolean
	readonly onAjouter: (noeud: NoeudAjoutable) => void
	readonly onAnnuler: () => void
}) {
	return (
		<div
			data-testid="selecteur-ajout"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<h4 className="font-medium">{t('admin.workflows.catalogue.title')}</h4>
			{refus === null ? null : <AlerteRefus message={refus} />}
			{catalogue.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('admin.workflows.catalogue.loading')} />
			) : null}
			{catalogue.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger-on-soft">
					{t('admin.workflows.catalogue.error')}
				</p>
			) : null}
			{catalogue.statut === 'pret'
				? (() => {
						const restants = noeudsAjoutables(catalogue.donnees, etapes)
						if (restants.length === 0) {
							return <p className="text-sm text-text-2">{t('admin.workflows.catalogue.empty')}</p>
						}
						return (
							<ul className="flex flex-col gap-1">
								{restants.map((noeud) => (
									<li key={noeud.id}>
										<button
											type="button"
											disabled={enCours}
											onClick={() => onAjouter(noeud)}
											aria-label={t('admin.workflows.action.addNode', { nom: noeud.label })}
											className="flex w-full items-center gap-2 min-h-[var(--size-target)] rounded-sm px-3 text-left hover:bg-hover disabled:opacity-70"
										>
											<Plus aria-hidden="true" size={16} strokeWidth={2} />
											<span>{noeud.label}</span>
											<span className="text-sm text-text-3">{noeud.key}</span>
										</button>
									</li>
								))}
							</ul>
						)
					})()
				: null}
			<div className="flex">
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Une ligne d'étape
// ---------------------------------------------------------------------------------------------

function LigneEtape({
	etape,
	liste,
	enCours,
	onDeplacer,
	onOuvrirSurcharge,
	onDesignerInitiale,
	onOuvrirRetrait,
}: {
	readonly etape: EtapeAdministrable
	readonly liste: readonly Ordonnable[]
	readonly enCours: boolean
	readonly onDeplacer: (sens: Sens) => void
	readonly onOuvrirSurcharge: () => void
	readonly onDesignerInitiale: () => void
	readonly onOuvrirRetrait: () => void
}) {
	const nom = libelleEtape(etape)
	const surcharge = etape.label_override !== null && etape.label_override.trim() !== ''
	return (
		<div className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)]" data-testid="ligne-etape">
			<span className="font-medium">{nom}</span>
			{etape.is_initial ? (
				<span className="rounded-sm bg-brand-soft text-brand-on-soft px-2 py-[2px] text-sm">
					{t('admin.workflows.initial')}
				</span>
			) : null}
			{surcharge ? (
				<span
					className="text-sm text-text-3"
					title={t('admin.workflows.fromCatalog', { libelle: etape.node?.label ?? etape.node_id })}
				>
					{t('admin.workflows.overridden')}
				</span>
			) : null}
			<span className="text-sm text-text-2" data-testid="etape-probabilite">
				{etape.probability_override === null
					? t('admin.workflows.probability.default')
					: t('admin.workflows.probability', { valeur: String(etape.probability_override) })}
			</span>
			<span className="text-sm text-text-2" data-testid="etape-relance">
				{etape.stale_after_days === null
					? t('admin.workflows.stale.default')
					: t('admin.workflows.stale', { valeur: String(etape.stale_after_days) })}
			</span>
			<div className="ml-auto flex items-center gap-1">
				<Button
					taille="compacte"
					disabled={enCours || !deplacementPossible(liste, etape.id, 'monter')}
					aria-label={t('admin.action.up', { nom })}
					onClick={() => onDeplacer('monter')}
				>
					<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours || !deplacementPossible(liste, etape.id, 'descendre')}
					aria-label={t('admin.action.down', { nom })}
					onClick={() => onDeplacer('descendre')}
				>
					<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours}
					aria-label={t('admin.workflows.action.override', { nom })}
					onClick={onOuvrirSurcharge}
				>
					<Pencil aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours || etape.is_initial}
					aria-label={t('admin.workflows.action.setInitial', { nom })}
					onClick={onDesignerInitiale}
				>
					<Flag aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours}
					aria-label={t('admin.workflows.action.remove', { nom })}
					onClick={onOuvrirRetrait}
				>
					<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Les arêtes du graphe — §7 bis.9
// ---------------------------------------------------------------------------------------------

/**
 * Case à cocher du §5.7 bis : une ligne de hauteur `--size-target`, la case à 24 px, le libellé
 * servant de cible étendue par son `for`.
 */
function CaseMotif({
	id,
	valeur,
	onChange,
}: {
	readonly id: string
	readonly valeur: boolean
	readonly onChange: (valeur: boolean) => void
}) {
	const idAide = `${id}-aide`
	return (
		<div className="flex flex-col gap-1">
			<span className="flex items-center gap-2 min-h-[var(--size-target)]">
				<input
					id={id}
					type="checkbox"
					checked={valeur}
					onChange={(evenement) => onChange(evenement.target.checked)}
					aria-describedby={idAide}
					className="size-6 rounded-sm border border-border"
				/>
				<label htmlFor={id} className="text-sm text-text-2">
					{t('admin.workflows.transitions.form.requireComment')}
				</label>
			</span>
			<span id={idAide} className="text-sm text-text-3">
				{t('admin.workflows.transitions.form.requireComment.help')}
			</span>
		</div>
	)
}

type SaisieTransition = {
	readonly idDepart: string
	readonly idArrivee: string
	readonly libelle: string
	readonly motifExige: boolean
}

/**
 * Formulaire de déclaration d'une arête.
 *
 * LES DEUX LISTES SONT LIÉES : changer le départ recalcule les arrivées possibles, et l'arrivée
 * choisie est abandonnée si elle n'en fait plus partie. Conserver une arrivée devenue impossible
 * enverrait une écriture dont on connaît le refus — exactement ce que le §7 bis.9.3 évite.
 */
function FormulaireDeclarationTransition({
	etapes,
	transitions,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly etapes: readonly EtapeAdministrable[]
	readonly transitions: readonly TransitionAdministrable[]
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieTransition) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const premier = useRef<HTMLSelectElement>(null)
	const [idDepart, setIdDepart] = useState(() => etapes[0]?.id ?? '')
	const [libelle, setLibelle] = useState('')
	const [motifExige, setMotifExige] = useState(false)

	useEffect(() => {
		premier.current?.focus()
	}, [])

	const possibles = arriveesPossibles(etapes, transitions, idDepart)
	const [idArrivee, setIdArrivee] = useState(() => possibles[0]?.id ?? '')
	const arriveeRetenue = possibles.some((etape) => etape.id === idArrivee)
		? idArrivee
		: (possibles[0]?.id ?? '')

	const libelleInvalide = libelle !== '' && !libelleTransitionConforme(libelle)
	const complet = arriveeRetenue !== '' && !libelleInvalide

	return (
		<form
			data-testid="formulaire-transition"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) {
					onValider({ idDepart, idArrivee: arriveeRetenue, libelle, motifExige })
				}
			}}
		>
			<h4 className="font-medium">{t('admin.workflows.transitions.form.declare')}</h4>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-depart`} className="text-sm text-text-2">
					{t('admin.workflows.transitions.form.from')}
				</label>
				<select
					id={`${prefixe}-depart`}
					ref={premier}
					value={idDepart}
					onChange={(evenement) => setIdDepart(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				>
					{etapes.map((etape) => (
						<option key={etape.id} value={etape.id}>
							{libelleEtape(etape)}
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-arrivee`} className="text-sm text-text-2">
					{t('admin.workflows.transitions.form.to')}
				</label>
				{possibles.length === 0 ? (
					<p role="status" data-testid="arrivees-epuisees" className="text-sm text-text-2">
						{t('admin.workflows.transitions.form.to.empty')}
					</p>
				) : (
					<select
						id={`${prefixe}-arrivee`}
						value={arriveeRetenue}
						onChange={(evenement) => setIdArrivee(evenement.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					>
						{possibles.map((etape) => (
							<option key={etape.id} value={etape.id}>
								{libelleEtape(etape)}
							</option>
						))}
					</select>
				)}
			</div>
			<ChampSurcharge
				id={`${prefixe}-libelle`}
				libelle={t('admin.workflows.transitions.form.label')}
				valeur={libelle}
				onChange={setLibelle}
				aide={t('admin.workflows.transitions.form.label.help')}
				{...(libelleInvalide ? { erreur: t('admin.workflows.transitions.form.label.invalid') } : {})}
			/>
			<CaseMotif id={`${prefixe}-motif`} valeur={motifExige} onChange={setMotifExige} />
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

/**
 * Formulaire d'édition d'une arête : le libellé et le motif, jamais les extrémités.
 *
 * Changer une extrémité ferait d'une arête une autre arête. L'écran fait donc déclarer puis
 * retirer, deux gestes visibles, plutôt que de transformer silencieusement une porte en une autre.
 */
function FormulaireEditionTransition({
	transition,
	depart,
	arrivee,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly transition: TransitionAdministrable
	readonly depart: string
	readonly arrivee: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (libelle: string, motifExige: boolean) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const premier = useRef<HTMLInputElement>(null)
	// La saisie repart de ce que l'arête PORTE : un libellé absent reste absent, et le pré-remplir
	// avec le libellé de l'arrivée figerait une valeur que le §3.4 veut calculée à l'affichage.
	const [libelle, setLibelle] = useState(transition.label ?? '')
	const [motifExige, setMotifExige] = useState(transition.require_comment)

	const libelleInvalide = libelle !== '' && !libelleTransitionConforme(libelle)

	return (
		<form
			data-testid="formulaire-transition-edition"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (!libelleInvalide && !enCours) onValider(libelle, motifExige)
			}}
		>
			<h4 className="font-medium">
				{t('admin.workflows.transitions.form.edit', { depart, arrivee })}
			</h4>
			<ChampSurcharge
				id={`${prefixe}-libelle`}
				libelle={t('admin.workflows.transitions.form.label')}
				valeur={libelle}
				onChange={setLibelle}
				aide={t('admin.workflows.transitions.form.label.help')}
				refInterne={premier}
				{...(libelleInvalide ? { erreur: t('admin.workflows.transitions.form.label.invalid') } : {})}
			/>
			<CaseMotif id={`${prefixe}-motif`} valeur={motifExige} onChange={setMotifExige} />
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={libelleInvalide || enCours}>
					{t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

/** Une arête dans la liste des sorties d'une étape. */
function LigneTransition({
	transition,
	depart,
	arrivee,
	enCours,
	onOuvrirEdition,
	onOuvrirRetrait,
}: {
	readonly transition: TransitionAdministrable
	readonly depart: string
	readonly arrivee: string
	readonly enCours: boolean
	readonly onOuvrirEdition: () => void
	readonly onOuvrirRetrait: () => void
}) {
	return (
		<div
			data-testid="ligne-transition"
			className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)]"
		>
			<ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="text-text-3" />
			<span>{t('admin.workflows.transitions.toward', { arrivee })}</span>
			<span className="text-sm text-text-2" data-testid="transition-libelle">
				{transition.label === null
					? t('admin.workflows.transitions.label.default')
					: transition.label}
			</span>
			{transition.require_comment ? (
				<span
					data-testid="transition-motif"
					className="flex items-center gap-1 rounded-sm bg-accent-soft text-accent-on-soft px-2 py-[2px] text-sm"
				>
					<MessageSquare aria-hidden="true" size={14} strokeWidth={2} />
					{t('admin.workflows.transitions.requireComment')}
				</span>
			) : null}
			<div className="ml-auto flex items-center gap-1">
				<Button
					taille="compacte"
					disabled={enCours}
					aria-label={t('admin.workflows.transitions.action.edit', { depart, arrivee })}
					onClick={onOuvrirEdition}
				>
					<Pencil aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours}
					aria-label={t('admin.workflows.transitions.action.remove', { depart, arrivee })}
					onClick={onOuvrirRetrait}
				>
					<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------------------------

export type ProprietesAdministrationWorkflows = {
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

export function AdministrationWorkflows({
	client = clientCrm,
}: ProprietesAdministrationWorkflows = {}) {
	const [workflows, setWorkflows] = useState<EtatAsync<readonly WorkflowAdministrable[]>>(enChargement)
	const [idChoisi, setIdChoisi] = useState<string | null>(null)
	const [etapes, setEtapes] = useState<EtatAsync<readonly EtapeAdministrable[]>>(enChargement)
	const [transitions, setTransitions] =
		useState<EtatAsync<readonly TransitionAdministrable[]>>(enChargement)
	const [catalogue, setCatalogue] = useState<EtatAsync<readonly NoeudAjoutable[]>>(enChargement)
	const [ouverture, setOuverture] = useState<Ouverture>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const [tentative, setTentative] = useState(0)

	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — le patron de `CRM-075`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setWorkflows(enChargement)
		void (async () => {
			const lus = await lireWorkflowsAdministrables(client, false)
			if (rang !== courant.current) return
			setWorkflows(lus)
			// Le premier workflow — le défaut, par l'ordre de la requête — est choisi d'office :
			// un écran qui s'ouvre sur « choisissez » quand un seul choix existe ferait un clic
			// de trop, et le seed comme la production ont toujours un workflow par défaut.
			if (lus.statut === 'pret') {
				const premier = lus.donnees[0]
				setIdChoisi((choisi) => choisi ?? premier?.id ?? null)
			}
		})()
	}, [client, tentative])

	/**
	 * Les étapes ET les arêtes, ensemble.
	 *
	 * Le §7 bis.9.1 le pose : un graphe dont on montrerait les nœuds sans les arêtes serait à
	 * moitié faux, et l'administrateur n'a pas à demander la seconde moitié. Les deux lectures
	 * partent en parallèle — elles ne dépendent pas l'une de l'autre —, et toute écriture des deux
	 * blocs les rejoue toutes les deux : retirer une étape emporte ses arêtes en cascade (§3.4), et
	 * ne recharger que les étapes laisserait des arêtes fantômes à l'écran.
	 */
	const rechargerGraphe = useCallback(
		async (idWorkflow: string) => {
			if (client === null) return
			const [lues, arretes] = await Promise.all([
				lireEtapes(client, idWorkflow),
				lireTransitions(client, idWorkflow),
			])
			setEtapes(lues)
			setTransitions(arretes)
		},
		[client],
	)

	useEffect(() => {
		if (client === null || idChoisi === null) return
		setEtapes(enChargement)
		setTransitions(enChargement)
		void rechargerGraphe(idChoisi)
	}, [client, idChoisi, rechargerGraphe])

	// Le catalogue n'est lu qu'à l'ouverture du sélecteur (§7 bis.3, lecture 3).
	useEffect(() => {
		if (client === null || ouverture.type !== 'ajout') return
		setCatalogue(enChargement)
		void (async () => {
			setCatalogue(await lireCatalogueActif(client))
		})()
	}, [client, ouverture.type])

	/** Exécute une écriture, traduit son issue, recharge les étapes et annonce le succès. */
	const executer = useCallback(
		async (action: ActionEtape, message: string) => {
			if (idChoisi === null) return
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') {
					setRefus(texteRefus(resultat.refus))
					return
				}
				if (resultat.statut === 'sans-effet') {
					setRefus(t('admin.workflows.refus.sans-effet'))
					return
				}
				setRefus(null)
				setOuverture(AUCUNE)
				setAnnonce(message)
				await rechargerGraphe(idChoisi)
			} finally {
				setEnCours(false)
			}
		},
		[idChoisi, rechargerGraphe],
	)

	/**
	 * Jumelle de `executer` pour les arêtes.
	 *
	 * Les deux ne diffèrent que par le **vocabulaire du refus** — `RefusEtape` contre
	 * `RefusTransition` —, et c'est précisément ce qu'il ne faut pas confondre : le §7 bis.9.5 donne
	 * au `23503` et au `23505` un autre sens ici. Une enveloppe générique sur le type du refus
	 * aurait économisé dix lignes en rendant possible l'affichage du mauvais message.
	 */
	const executerArete = useCallback(
		async (action: ActionTransition, message: string) => {
			if (idChoisi === null) return
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') {
					setRefus(texteRefusTransition(resultat.refus))
					return
				}
				if (resultat.statut === 'sans-effet') {
					setRefus(t('admin.workflows.refus.sans-effet'))
					return
				}
				setRefus(null)
				setOuverture(AUCUNE)
				setAnnonce(message)
				await rechargerGraphe(idChoisi)
			} finally {
				setEnCours(false)
			}
		},
		[idChoisi, rechargerGraphe],
	)

	const deplacer = useCallback(
		(liste: readonly EtapeAdministrable[], idEtape: string, sens: Sens) => {
			if (client === null) return
			const calcul = calculerDeplacement(liste, idEtape, sens)
			if (calcul.statut !== 'calcule') {
				// L'écran NOMME le refus au lieu d'écrire une valeur sans effet (CRM-075 §6.2).
				setRefus(t('admin.move.impossible'))
				return
			}
			void executer(
				() => deplacerEtape(client, idEtape, calcul.position),
				t('live.workflows.moved'),
			)
		},
		[client, executer],
	)

	// Un client absent est déjà traité par la coquille (`AppShell`, `EtatConfiguration`) : cet
	// écran n'est jamais rendu sans client, et ses effets se contentent de ne rien lancer.
	if (client === null) return null

	const choisi =
		workflows.statut === 'pret'
			? (workflows.donnees.find((workflow) => workflow.id === idChoisi) ?? null)
			: null

	return (
		<section aria-label={t('admin.workflows.aria')} className="flex flex-col gap-4">
			<LiveRegion libelle={t('live.admin.aria')} message={annonce} />

			{workflows.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : null}

			{workflows.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.workflows.error.title')}
					corps={t('admin.workflows.error.body')}
					libelleReprise={t('admin.tree.error.retry')}
					onReprise={() => setTentative((precedente) => precedente + 1)}
				/>
			) : null}

			{workflows.statut === 'pret' && workflows.donnees.length === 0 ? (
				<EtatVide
					titre={t('admin.workflows.empty.title')}
					corps={t('admin.workflows.empty.body')}
				/>
			) : null}

			{workflows.statut === 'pret' && workflows.donnees.length > 0 ? (
				<div className="flex flex-col gap-4 lg:flex-row lg:items-start">
					<nav aria-label={t('admin.workflows.list.aria')} className="lg:w-[280px] lg:shrink-0">
						<ul className="flex flex-col rounded-lg border border-border bg-surface">
							{workflows.donnees.map((workflow) => (
								<li key={workflow.id}>
									<button
										type="button"
										onClick={() => setIdChoisi(workflow.id)}
										aria-current={workflow.id === idChoisi ? 'true' : undefined}
										className={[
											'flex w-full flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] text-left rounded-lg',
											workflow.id === idChoisi ? 'bg-brand-soft' : 'hover:bg-hover',
										].join(' ')}
									>
										<span className="font-medium">{workflow.name}</span>
										<span className="flex gap-2 text-sm text-text-2">
											<span>
												{workflow.scope === 'global'
													? t('admin.workflows.scope.global')
													: t('admin.workflows.scope.track')}
											</span>
											{workflow.is_default ? <span>{t('admin.workflows.default')}</span> : null}
										</span>
									</button>
								</li>
							))}
						</ul>
					</nav>

					<div className="flex min-w-0 flex-1 flex-col gap-3">
						{choisi === null ? (
							<EtatVide
								titre={t('admin.workflows.choose.title')}
								corps={t('admin.workflows.choose.body')}
							/>
						) : (
							<section
								aria-label={t('admin.workflows.steps.aria', { workflow: choisi.name })}
								className="flex flex-col gap-3"
							>
								{etapes.statut === 'chargement' ? (
									<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
								) : null}
								{etapes.statut === 'erreur' ? (
									<EtatErreur
										titre={t('admin.workflows.steps.error')}
										corps={t('admin.workflows.error.body')}
										libelleReprise={t('admin.tree.error.retry')}
										onReprise={() => void rechargerGraphe(choisi.id)}
									/>
								) : null}
								{etapes.statut === 'pret' ? (
									<>
										{etapes.donnees.length === 0 ? (
											<EtatVide
												titre={t('admin.workflows.steps.empty')}
												corps={t('admin.workflows.steps.empty.hint')}
											/>
										) : (
											<>
												{etapes.donnees.some((etape) => etape.is_initial) ? null : (
													<p
														role="status"
														data-testid="alerte-sans-initiale"
														className="flex items-start gap-2 rounded-sm bg-accent-soft text-accent-on-soft px-3 py-2 text-sm"
													>
														<TriangleAlert
															aria-hidden="true"
															size={16}
															strokeWidth={2}
															className="shrink-0 mt-[2px]"
														/>
														<span>{t('admin.workflows.initial.none')}</span>
													</p>
												)}
												<ol
												data-testid="liste-etapes"
												className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
											>
													{etapes.donnees.map((etape) => (
														<li key={etape.id} className="flex flex-col gap-2">
															<LigneEtape
																etape={etape}
																liste={etapes.donnees}
																enCours={enCours}
																onDeplacer={(sens) => deplacer(etapes.donnees, etape.id, sens)}
																onOuvrirSurcharge={() => {
																	setRefus(null)
																	setOuverture({ type: 'surcharge', idEtape: etape.id })
																}}
																onDesignerInitiale={() =>
																	void executer(
																		() => designerEtapeInitiale(client, choisi.id, etape.id),
																		t('live.workflows.initial'),
																	)
																}
																onOuvrirRetrait={() => {
																	setRefus(null)
																	setOuverture({ type: 'retrait', idEtape: etape.id })
																}}
															/>
															{ouverture.type === 'surcharge' && ouverture.idEtape === etape.id ? (
																<FormulaireSurcharge
																	etape={etape}
																	refus={refus}
																	enCours={enCours}
																	onValider={(saisie) =>
																		void executer(
																			() => surchargerEtape(client, etape.id, versSurcharge(saisie)),
																			t('live.workflows.overridden'),
																		)
																	}
																	onAnnuler={() => {
																		setRefus(null)
																		setOuverture(AUCUNE)
																	}}
																/>
															) : null}
															{ouverture.type === 'retrait' && ouverture.idEtape === etape.id ? (
																<ConfirmationRetrait
																	marqueur="confirmation-retrait"
																	titre={t('admin.workflows.remove.confirm', {
																		nom: libelleEtape(etape),
																	})}
																	corps={t('admin.workflows.remove.confirm.body')}
																	libelleAction={t('admin.workflows.remove.confirm.action')}
																	refus={refus}
																	enCours={enCours}
																	onConfirmer={() =>
																		void executer(
																			() => retirerEtape(client, etape.id),
																			t('live.workflows.removed'),
																		)
																	}
																	onAnnuler={() => {
																		setRefus(null)
																		setOuverture(AUCUNE)
																	}}
																/>
															) : null}
														</li>
													))}
												</ol>
											</>
										)}
										{ouverture.type === 'ajout' ? (
											<SelecteurAjout
												catalogue={catalogue}
												etapes={etapes.donnees}
												refus={refus}
												enCours={enCours}
												onAjouter={(noeud) =>
													void executer(
														() =>
															ajouterEtape(client, {
																idWorkflow: choisi.id,
																idWorkspace: choisi.workspace_id,
																idNoeud: noeud.id,
															}),
														t('live.workflows.added'),
													)
												}
												onAnnuler={() => {
													setRefus(null)
													setOuverture(AUCUNE)
												}}
											/>
										) : (
											<div className="flex">
												<Button
													variante="primaire"
													disabled={enCours}
													onClick={() => {
														setRefus(null)
														setOuverture({ type: 'ajout' })
													}}
												>
													<Plus aria-hidden="true" size={16} strokeWidth={2} />
													{t('admin.workflows.action.add')}
												</Button>
											</div>
										)}
										{/* Un refus hors formulaire — déplacement, désignation — s'affiche ici,
										    près de la liste qui l'a causé. */}
										{refus !== null && ouverture.type === 'aucune' ? (
											<AlerteRefus message={refus} />
										) : null}

										{/* Les arêtes, SOUS les étapes et dans la même colonne : elles décrivent le même
										    workflow et se lisent après ses étapes (§7 bis.9.6). */}
										<section
											aria-label={t('admin.workflows.transitions.aria', { workflow: choisi.name })}
											className="flex flex-col gap-3"
										>
											<div className="flex flex-col gap-1">
												<h3 className="font-medium">{t('admin.workflows.transitions.title')}</h3>
												<p className="text-sm text-text-2">{t('admin.workflows.transitions.intro')}</p>
											</div>
											{transitions.statut === 'chargement' ? (
												<SkeletonListe lignes={3} libelle={t('admin.workflows.transitions.loading')} />
											) : null}
											{transitions.statut === 'erreur' ? (
												<EtatErreur
													titre={t('admin.workflows.transitions.error')}
													corps={t('admin.workflows.error.body')}
													libelleReprise={t('admin.tree.error.retry')}
													onReprise={() => void rechargerGraphe(choisi.id)}
												/>
											) : null}
											{/* Une transition relie DEUX étapes : sous ce seuil, le formulaire aurait deux
											    listes inutilisables, et l'écran le dit plutôt que de l'offrir (§7 bis.9.3). */}
											{transitions.statut === 'pret' && etapes.donnees.length < 2 ? (
												<p role="status" data-testid="transitions-trop-peu-etapes" className="text-sm text-text-2">
													{t('admin.workflows.transitions.tooFewSteps')}
												</p>
											) : null}
											{transitions.statut === 'pret' && etapes.donnees.length >= 2 ? (
												<>
													<ol
														data-testid="groupes-transitions"
														className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
													>
														{grouperTransitions(etapes.donnees, transitions.donnees).map((groupe) => (
															<li key={groupe.etape.id} className="flex flex-col gap-1">
																<span className="font-medium">{libelleEtape(groupe.etape)}</span>
																{groupe.sorties.length === 0 ? (
																	<span data-testid="etape-sans-sortie" className="text-sm text-text-2">
																		{t('admin.workflows.transitions.none')}
																	</span>
																) : (
																	<ul className="flex flex-col gap-1 pl-4">
																		{groupe.sorties.map((sortie) => {
																			const arrivee =
																				etapes.donnees.find((etape) => etape.id === sortie.to_step_id) ?? null
																			// L'arrivée est introuvable si une étape a disparu entre les deux
																			// lectures : son identifiant vaut mieux qu'une ligne sans nom.
																			const nomArrivee = arrivee === null ? sortie.to_step_id : libelleEtape(arrivee)
																			const nomDepart = libelleEtape(groupe.etape)
																			return (
																				<li key={sortie.id} className="flex flex-col gap-2">
																					<LigneTransition
																						transition={sortie}
																						depart={nomDepart}
																						arrivee={nomArrivee}
																						enCours={enCours}
																						onOuvrirEdition={() => {
																							setRefus(null)
																							setOuverture({ type: 'transition-edition', idTransition: sortie.id })
																						}}
																						onOuvrirRetrait={() => {
																							setRefus(null)
																							setOuverture({ type: 'transition-retrait', idTransition: sortie.id })
																						}}
																					/>
																					{ouverture.type === 'transition-edition' &&
																					ouverture.idTransition === sortie.id ? (
																						<FormulaireEditionTransition
																							transition={sortie}
																							depart={nomDepart}
																							arrivee={nomArrivee}
																							refus={refus}
																							enCours={enCours}
																							onValider={(libelle, motifExige) =>
																								void executerArete(
																									() =>
																										modifierTransition(
																											client,
																											sortie.id,
																											libelle.trim() === '' ? null : libelle.trim(),
																											motifExige,
																										),
																									t('live.workflows.transition.updated'),
																								)
																							}
																							onAnnuler={() => {
																								setRefus(null)
																								setOuverture(AUCUNE)
																							}}
																						/>
																					) : null}
																					{ouverture.type === 'transition-retrait' &&
																					ouverture.idTransition === sortie.id ? (
																						<ConfirmationRetrait
																							marqueur="confirmation-retrait-transition"
																							titre={t('admin.workflows.transitions.remove.confirm', {
																								depart: nomDepart,
																								arrivee: nomArrivee,
																							})}
																							corps={t('admin.workflows.transitions.remove.confirm.body')}
																							libelleAction={t('admin.workflows.transitions.remove.confirm.action')}
																							refus={refus}
																							enCours={enCours}
																							onConfirmer={() =>
																								void executerArete(
																									() => retirerTransition(client, sortie.id),
																									t('live.workflows.transition.removed'),
																								)
																							}
																							onAnnuler={() => {
																								setRefus(null)
																								setOuverture(AUCUNE)
																							}}
																						/>
																					) : null}
																				</li>
																			)
																		})}
																	</ul>
																)}
															</li>
														))}
													</ol>
													{ouverture.type === 'transition-declaration' ? (
														<FormulaireDeclarationTransition
															etapes={etapes.donnees}
															transitions={transitions.donnees}
															refus={refus}
															enCours={enCours}
															onValider={(saisie) =>
																void executerArete(
																	() =>
																		declarerTransition(client, {
																			idWorkflow: choisi.id,
																			idWorkspace: choisi.workspace_id,
																			idDepart: saisie.idDepart,
																			idArrivee: saisie.idArrivee,
																			libelle: saisie.libelle.trim() === '' ? null : saisie.libelle.trim(),
																			motifExige: saisie.motifExige,
																		}),
																	t('live.workflows.transition.declared'),
																)
															}
															onAnnuler={() => {
																setRefus(null)
																setOuverture(AUCUNE)
															}}
														/>
													) : (
														<div className="flex">
															<Button
																variante="primaire"
																disabled={enCours}
																onClick={() => {
																	setRefus(null)
																	setOuverture({ type: 'transition-declaration' })
																}}
															>
																<Plus aria-hidden="true" size={16} strokeWidth={2} />
																{t('admin.workflows.transitions.action.declare')}
															</Button>
														</div>
													)}
												</>
											) : null}
										</section>
									</>
								) : null}
							</section>
						)}
					</div>
				</div>
			) : null}
		</section>
	)
}
