// @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première, deuxième,
//       troisième, quatrième et cinquième tranches
// @spec docs/SPEC-workflow-engine.md §7 bis.2 (adresse), §7 bis.3 (les trois lectures),
//       §7 bis.4 (les six gestes), §7 bis.5 (validation de forme), §7 bis.6 (états,
//       accessibilité, responsive), §2.5 (`0` n'est pas `NULL`), §3.3 (contraintes), §3.5
//       (l'étape initiale)
// @spec docs/SPEC-workflow-engine.md §7 bis.9 (deuxième tranche : les arêtes), §7 bis.9.1
//       (lecture 4 et l'ordre composé), §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix
//       offerts), §7 bis.9.4 (validation de forme), §7 bis.9.6 (états et disposition),
//       §3.4 (modèle des arêtes)
// @spec docs/SPEC-workflow-engine.md §7 bis.10 (troisième tranche : les champs de formulaire),
//       §7 bis.10.1 (lecture 5, archivés compris), §7 bis.10.2 (les cinq gestes),
//       §7 bis.10.3 (clé et type non modifiables), §7 bis.10.4 (validation de forme),
//       §7 bis.10.5 (les refus), §7 bis.10.6 (états et disposition)
// @spec docs/SPEC-workflow-engine.md §7 bis.11 (quatrième tranche : la grille champ × étape),
//       §7 bis.11.1 (lecture 6), §7 bis.11.2 (la composition et les champs archivés écartés),
//       §7 bis.11.3 (les deux gestes), §7 bis.11.4 (les quatre états d'une case),
//       §7 bis.11.5 (les refus), §7 bis.11.6 (états, accessibilité et responsive)
// @spec docs/SPEC-workflow-engine.md §7 bis.12 (cinquième tranche : les exigences de transition),
//       §7 bis.12.1 (lecture 7 et sa jointure), §7 bis.12.2 (l'union effective et ses origines),
//       §7 bis.12.3 (les deux gestes, et pourquoi le premier n'est pas un `upsert`),
//       §7 bis.12.4 (ce que l'écran refuse de proposer), §7 bis.12.5 (les refus),
//       §7 bis.12.6 (états, accessibilité et responsive)
// @spec docs/SPEC-transition-required-fields.md §1 (l'union des deux ensembles), §2 (la table à
//       deux colonnes), §4 (autorisations), §5.1 (la sixième garde de `move_card`)
// @spec docs/SPEC-form-composer.md §2.3 (les quinze types), §2.4 (`options`), §2.5 (clé durable),
//       §2.6 (ordre), §2.7 (aucun privilège `DELETE` : l'archivage tient lieu de retrait),
//       §3.1 (les trois visibilités, et l'absence de règle qui vaut `visible`),
//       §5 (l'édition du formulaire en un seul écran)
// @spec docs/DESIGN_SYSTEM.md §5.9 (tableau de données : sémantique jamais simulée), §7 (paliers,
//       et le tableau qui défile dans son propre conteneur)
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
	Archive,
	ArchiveRestore,
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
import type { CleTraduction } from '../i18n/fr'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import {
	calculerDeplacement,
	deplacementPossible,
	type Ordonnable,
	type Sens,
} from '../lib/administration-arborescence'
import {
	TYPES_CHAMP,
	aideChampConforme,
	ajouterEtape,
	ancienneteConforme,
	archiverChamp,
	arriveesPossibles,
	choixDuChamp,
	cleChampConforme,
	composerOptions,
	declarerChamp,
	deplacerChamp,
	deviseConforme,
	deviseDuChamp,
	estTypeAChoix,
	estTypeMonetaire,
	libelleChampConforme,
	lireChamps,
	modifierChamp,
	refusDesChoix,
	type RefusChoix,
	VISIBILITES,
	composerGrille,
	lireRegles,
	reglerVisibilite,
	rendreAuDefaut,
	type EtatCase,
	type LigneGrille,
	type RefusRegle,
	type RegleAdministrable,
	type ResultatRegle,
	type Visibilite,
	champsLiables,
	exigencesEffectives,
	exigencesSansEffet,
	exigerChamp,
	lireExigences,
	retirerExigence,
	type ExigenceAdministrable,
	type ExigenceEffective,
	type OrigineExigence,
	type RefusExigence,
	type ResultatExigence,
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
	type ChampAdministrable,
	type ChoixChamp,
	type EtapeAdministrable,
	type NoeudAjoutable,
	type RefusChamp,
	type RefusEtape,
	type RefusTransition,
	type ResultatChamp,
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
 * Traduit un refus d'écriture sur un champ (§7 bis.10.5).
 *
 * Le `23514` recouvre ici **six** `CHECK` — clé, libellé, aide, type, `options` objet, options du
 * type —, et son message les nomme plutôt que d'en deviner un : l'écran ne sait pas lequel a
 * déclenché, et prétendre le savoir désignerait souvent le mauvais champ.
 */
function texteRefusChamp(refus: RefusChamp): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.workflows.refus.forbidden')
		case 'cle-deja-prise':
			return t('admin.workflows.refus.champ.cle-deja-prise')
		case 'reference-absente':
			return t('admin.workflows.refus.champ.reference-absente')
		case 'forme-refusee':
			return t('admin.workflows.refus.champ.forme-refusee')
		case 'network':
			return t('admin.workflows.refus.network')
		case 'unknown':
			return t('admin.workflows.refus.unknown')
	}
}

/**
 * Le refus d'une règle de visibilité — §7 bis.11.5.
 *
 * DEUX NATURES DE MOINS que pour un champ, et c'est mesuré : `23505` ne peut pas naître de l'écran,
 * qui règle une case par un `upsert` (§7 bis.11.3), et aucun `23503` ne peut vouloir dire
 * « occupé » puisqu'aucune ligne n'en retient une autre. `unknown` recouvre donc le premier, avec
 * son message générique.
 */
function texteRefusRegle(refus: RefusRegle): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.workflows.refus.forbidden')
		case 'reference-absente':
			return t('admin.workflows.refus.regle.reference-absente')
		case 'forme-refusee':
			return t('admin.workflows.refus.regle.forme-refusee')
		case 'network':
			return t('admin.workflows.refus.network')
		case 'unknown':
			return t('admin.workflows.refus.unknown')
	}
}

/**
 * Le refus d'une exigence de transition — §7 bis.12.5.
 *
 * `23505` A ICI UN TEXTE PROPRE, à l'inverse exact de la règle de visibilité juste au-dessus : la
 * grille règle ses cases par `upsert`, ce bloc ne le peut pas — MESURÉ, `403`/`42501` faute du
 * privilège `UPDATE` que `CRM-018` n'accorde délibérément pas (§7 bis.12.3). Le `23505` est donc
 * l'issue normale d'une course entre deux administrateurs, et le message le dit.
 */
function texteRefusExigence(refus: RefusExigence): string {
	switch (refus.nature) {
		case 'deja-exige':
			return t('admin.workflows.refus.exigence.deja-exige')
		case 'reference-absente':
			return t('admin.workflows.refus.exigence.reference-absente')
		case 'workflow-different':
			return t('admin.workflows.refus.exigence.workflow-different')
		case 'forbidden':
			return t('admin.workflows.refus.forbidden')
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
	| { readonly type: 'champ-declaration' }
	| { readonly type: 'champ-edition'; readonly idChamp: string }
	| { readonly type: 'champ-archivage'; readonly idChamp: string }
	| { readonly type: 'exigence-ajout'; readonly idTransition: string }
	| {
			readonly type: 'exigence-retrait'
			readonly idTransition: string
			readonly idChamp: string
	  }

const AUCUNE: Ouverture = { type: 'aucune' }

type ActionEtape = () => Promise<ResultatEtape>
type ActionTransition = () => Promise<ResultatTransition>
type ActionChamp = () => Promise<ResultatChamp>
type ActionRegle = () => Promise<ResultatRegle>
type ActionExigence = () => Promise<ResultatExigence>

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

	// Ouvrir un formulaire déplace le focus dans son premier champ (docs/DESIGN_SYSTEM.md §5.13),
	// comme le formulaire de surcharge et le sélecteur d'ajout.
	useEffect(() => {
		premier.current?.focus()
	}, [])

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
// Les champs du formulaire — §7 bis.10
// ---------------------------------------------------------------------------------------------

/**
 * Libellé traduit d'un type de champ (§2.3 du composeur).
 *
 * La table est ÉCRITE, non composée par interpolation : `t` n'accepte que des clés déclarées, et
 * une clé fabriquée à l'exécution ferait perdre la garantie de la décision 43 — une clé inconnue
 * doit être une erreur de compilation. Le repli sur la valeur brute reste nécessaire : `type` est
 * un `text` en base, et rien n'empêche une écriture d'API d'y poser un quinzième type de demain.
 */
const LIBELLES_TYPE: Readonly<Record<string, CleTraduction>> = {
	text: 'admin.workflows.fields.type.text',
	textarea: 'admin.workflows.fields.type.textarea',
	number: 'admin.workflows.fields.type.number',
	money: 'admin.workflows.fields.type.money',
	date: 'admin.workflows.fields.type.date',
	datetime: 'admin.workflows.fields.type.datetime',
	select: 'admin.workflows.fields.type.select',
	multiselect: 'admin.workflows.fields.type.multiselect',
	checkbox: 'admin.workflows.fields.type.checkbox',
	url: 'admin.workflows.fields.type.url',
	email: 'admin.workflows.fields.type.email',
	phone: 'admin.workflows.fields.type.phone',
	user: 'admin.workflows.fields.type.user',
	contact: 'admin.workflows.fields.type.contact',
	file: 'admin.workflows.fields.type.file',
}

function libelleType(type: string): string {
	const cle = LIBELLES_TYPE[type]
	return cle === undefined ? type : t(cle)
}

/** Les quatre refus de `refusDesChoix`, chacun avec sa clé déclarée — même motif que ci-dessus. */
const MESSAGES_REFUS_CHOIX: Readonly<Record<Exclude<RefusChoix, null>, CleTraduction>> = {
	'aucun-choix': 'admin.workflows.fields.form.choices.invalid.aucun-choix',
	'cle-vide': 'admin.workflows.fields.form.choices.invalid.cle-vide',
	'libelle-vide': 'admin.workflows.fields.form.choices.invalid.libelle-vide',
	'cle-dupliquee': 'admin.workflows.fields.form.choices.invalid.cle-dupliquee',
}

/**
 * Éditeur de la liste de choix d'un `select` ou d'un `multiselect`.
 *
 * IL EXISTE PARCE QUE LA BASE NE TIENT PAS CETTE RÈGLE. Le §2.4 du composeur ne garantit qu'un
 * tableau `choices` non vide ; la forme `{key, label}` et l'unicité des clés ne sont tenues que
 * par l'écran, et c'est mesuré — deux choix de même clé sont acceptés en `201`. La saisie est donc
 * structurée en deux colonnes plutôt que libre : un JSON à écrire à la main rendrait la faute
 * probable là où elle n'est rattrapée par personne.
 */
function EditeurChoix({
	prefixe,
	choix,
	onChange,
	erreur,
	enCours,
}: {
	readonly prefixe: string
	readonly choix: readonly ChoixChamp[]
	readonly onChange: (choix: readonly ChoixChamp[]) => void
	readonly erreur?: string
	readonly enCours: boolean
}) {
	const idErreur = `${prefixe}-choix-erreur`
	return (
		<fieldset className="flex flex-col gap-2 rounded-sm border border-border p-3" data-testid="editeur-choix">
			<legend className="text-sm text-text-2">{t('admin.workflows.fields.form.choices')}</legend>
			<span className="text-sm text-text-3">{t('admin.workflows.fields.form.choices.help')}</span>
			<ul className="flex flex-col gap-2">
				{choix.map((entree, rang) => (
					// Le rang est la seule identité disponible : deux entrées peuvent porter la même clé
					// le temps d'une frappe, et c'est précisément l'état que le contrôle d'unicité doit
					// pouvoir signaler sans que la liste se réordonne sous les doigts.
					<li key={rang} className="flex flex-wrap items-end gap-2">
						<div className="flex flex-col gap-1">
							<label htmlFor={`${prefixe}-choix-cle-${rang}`} className="text-sm text-text-2">
								{t('admin.workflows.fields.form.choices.key')}
							</label>
							<input
								id={`${prefixe}-choix-cle-${rang}`}
								value={entree.key}
								onChange={(evenement) =>
									onChange(
										choix.map((autre, index) =>
											index === rang ? { ...autre, key: evenement.target.value } : autre,
										),
									)
								}
								className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
							/>
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor={`${prefixe}-choix-libelle-${rang}`} className="text-sm text-text-2">
								{t('admin.workflows.fields.form.choices.label')}
							</label>
							<input
								id={`${prefixe}-choix-libelle-${rang}`}
								value={entree.label}
								onChange={(evenement) =>
									onChange(
										choix.map((autre, index) =>
											index === rang ? { ...autre, label: evenement.target.value } : autre,
										),
									)
								}
								className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
							/>
						</div>
						<Button
							taille="compacte"
							disabled={enCours}
							aria-label={t('admin.workflows.fields.form.choices.remove', {
								nom: entree.label.trim() === '' ? entree.key : entree.label,
							})}
							onClick={() => onChange(choix.filter((_, index) => index !== rang))}
						>
							<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
						</Button>
					</li>
				))}
			</ul>
			<div className="flex">
				<Button
					variante="secondaire"
					taille="compacte"
					disabled={enCours}
					onClick={() => onChange([...choix, { key: '', label: '' }])}
				>
					<Plus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.workflows.fields.form.choices.add')}
				</Button>
			</div>
			{erreur === undefined ? null : (
				<span id={idErreur} role="alert" className="text-sm text-danger-on-soft">
					{erreur}
				</span>
			)}
		</fieldset>
	)
}

type SaisieChamp = {
	readonly cle: string
	readonly libelle: string
	readonly type: string
	readonly aide: string
	readonly choix: readonly ChoixChamp[]
	readonly devise: string
}

/** La saisie d'édition repart du champ tel qu'il est, options comprises. */
function saisieDepuisChamp(champ: ChampAdministrable): SaisieChamp {
	return {
		cle: champ.key,
		libelle: champ.label,
		type: champ.type,
		aide: champ.help_text ?? '',
		choix: choixDuChamp(champ),
		devise: deviseDuChamp(champ),
	}
}

/**
 * Formulaire d'un champ — déclaration ET édition, le même.
 *
 * LA CLÉ ET LE TYPE SONT SAISIS À LA DÉCLARATION, PUIS AFFICHÉS EN LECTURE SEULE. Les deux motifs
 * sont mesurés au §7 bis.10.3, et l'écran les DIT plutôt que de désactiver deux champs sans
 * explication : une clé renommée réécrit rétroactivement ce que les exports désignent, et un type
 * changé laisse en base des valeurs que le produit refuse ensuite de réécrire — la conversion
 * appartient au plan de remappage de `CRM-078`.
 */
function FormulaireChamp({
	champ,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly champ: ChampAdministrable | null
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieChamp) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState<SaisieChamp>(() =>
		champ === null
			? { cle: '', libelle: '', type: 'text', aide: '', choix: [], devise: 'EUR' }
			: saisieDepuisChamp(champ),
	)
	const premierChamp = useRef<HTMLInputElement>(null)
	const premierLibelle = useRef<HTMLInputElement>(null)

	// Le focus entre dans le premier champ RÉELLEMENT modifiable : la clé à la déclaration, le
	// libellé à l'édition où la clé n'est plus qu'un texte (docs/DESIGN_SYSTEM.md §5.13).
	useEffect(() => {
		if (champ === null) premierChamp.current?.focus()
		else premierLibelle.current?.focus()
	}, [champ])

	const cleInvalide = saisie.cle !== '' && !cleChampConforme(saisie.cle)
	const libelleInvalide = saisie.libelle !== '' && !libelleChampConforme(saisie.libelle)
	const aideInvalide = !aideChampConforme(saisie.aide)
	const aChoix = estTypeAChoix(saisie.type)
	const monetaire = estTypeMonetaire(saisie.type)
	const refusChoix = aChoix ? refusDesChoix(saisie.choix) : null
	const deviseInvalide = monetaire && !deviseConforme(saisie.devise)
	const complet =
		saisie.cle !== '' &&
		!cleInvalide &&
		saisie.libelle.trim() !== '' &&
		!libelleInvalide &&
		!aideInvalide &&
		refusChoix === null &&
		!deviseInvalide

	return (
		<form
			data-testid="formulaire-champ"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h4 className="font-medium">
				{champ === null
					? t('admin.workflows.fields.form.declare')
					: t('admin.workflows.fields.form.edit', { nom: champ.label })}
			</h4>

			{champ === null ? (
				<ChampSurcharge
					id={`${prefixe}-cle`}
					libelle={t('admin.workflows.fields.form.key')}
					valeur={saisie.cle}
					onChange={(cle) => setSaisie((precedente) => ({ ...precedente, cle }))}
					aide={t('admin.workflows.fields.form.key.help')}
					refInterne={premierChamp}
					{...(cleInvalide ? { erreur: t('admin.workflows.fields.form.key.invalid') } : {})}
				/>
			) : (
				<p className="text-sm text-text-2" data-testid="champ-cle-figee">
					{t('admin.workflows.fields.form.key.frozen', { cle: champ.key })}
				</p>
			)}

			<ChampSurcharge
				id={`${prefixe}-libelle`}
				libelle={t('admin.workflows.fields.form.label')}
				valeur={saisie.libelle}
				onChange={(libelle) => setSaisie((precedente) => ({ ...precedente, libelle }))}
				aide={t('admin.workflows.fields.form.label.help')}
				refInterne={premierLibelle}
				{...(libelleInvalide ? { erreur: t('admin.workflows.fields.form.label.invalid') } : {})}
			/>

			{champ === null ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={`${prefixe}-type`} className="text-sm text-text-2">
						{t('admin.workflows.fields.form.type')}
					</label>
					<select
						id={`${prefixe}-type`}
						value={saisie.type}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, type: evenement.target.value }))
						}
						aria-describedby={`${prefixe}-type-aide`}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					>
						{TYPES_CHAMP.map((type) => (
							<option key={type} value={type}>
								{libelleType(type)}
							</option>
						))}
					</select>
					<span id={`${prefixe}-type-aide`} className="text-sm text-text-3">
						{t('admin.workflows.fields.form.type.help')}
					</span>
				</div>
			) : (
				<p className="text-sm text-text-2" data-testid="champ-type-fige">
					{t('admin.workflows.fields.form.type.frozen', { type: libelleType(champ.type) })}
				</p>
			)}

			{aChoix ? (
				<EditeurChoix
					prefixe={prefixe}
					choix={saisie.choix}
					enCours={enCours}
					onChange={(choix) => setSaisie((precedente) => ({ ...precedente, choix }))}
					{...(refusChoix === null ? {} : { erreur: t(MESSAGES_REFUS_CHOIX[refusChoix]) })}
				/>
			) : null}

			{monetaire ? (
				<ChampSurcharge
					id={`${prefixe}-devise`}
					libelle={t('admin.workflows.fields.form.currency')}
					valeur={saisie.devise}
					onChange={(devise) => setSaisie((precedente) => ({ ...precedente, devise }))}
					aide={t('admin.workflows.fields.form.currency.help')}
					{...(deviseInvalide ? { erreur: t('admin.workflows.fields.form.currency.invalid') } : {})}
				/>
			) : null}

			<ChampSurcharge
				id={`${prefixe}-aide`}
				libelle={t('admin.workflows.fields.form.help')}
				valeur={saisie.aide}
				onChange={(aide) => setSaisie((precedente) => ({ ...precedente, aide }))}
				aide={t('admin.workflows.fields.form.help.help')}
				{...(aideInvalide ? { erreur: t('admin.workflows.fields.form.help.invalid') } : {})}
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

/** Une ligne de champ : ce qu'il est, et les quatre commandes qui le gouvernent. */
function LigneChamp({
	champ,
	liste,
	enCours,
	onDeplacer,
	onOuvrirEdition,
	onOuvrirArchivage,
	onRestaurer,
}: {
	readonly champ: ChampAdministrable
	readonly liste: readonly Ordonnable[]
	readonly enCours: boolean
	readonly onDeplacer: (sens: Sens) => void
	readonly onOuvrirEdition: () => void
	readonly onOuvrirArchivage: () => void
	readonly onRestaurer: () => void
}) {
	const archive = champ.archived_at !== null
	return (
		<div
			data-testid="ligne-champ"
			className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)]"
		>
			<span className="font-medium">{champ.label}</span>
			<code className="rounded-sm bg-hover px-2 py-[2px] text-sm text-text-2">{champ.key}</code>
			<span className="text-sm text-text-2" data-testid="champ-type">
				{libelleType(champ.type)}
			</span>
			{/* Un champ archivé est NOMMÉ, jamais seulement grisé : la couleur seule ne dit rien
			    (docs/DESIGN_SYSTEM.md §1), et l'archivage est le seul retrait du produit. */}
			{archive ? (
				<span
					data-testid="champ-archive"
					className="flex items-center gap-1 rounded-sm bg-accent-soft text-accent-on-soft px-2 py-[2px] text-sm"
				>
					<Archive aria-hidden="true" size={14} strokeWidth={2} />
					{t('admin.workflows.fields.archived')}
				</span>
			) : null}
			{champ.help_text === null ? null : (
				<span className="text-sm text-text-3" data-testid="champ-aide">
					{champ.help_text}
				</span>
			)}
			<div className="ml-auto flex items-center gap-1">
				<Button
					taille="compacte"
					disabled={enCours || !deplacementPossible(liste, champ.id, 'monter')}
					aria-label={t('admin.action.up', { nom: champ.label })}
					onClick={() => onDeplacer('monter')}
				>
					<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours || !deplacementPossible(liste, champ.id, 'descendre')}
					aria-label={t('admin.action.down', { nom: champ.label })}
					onClick={() => onDeplacer('descendre')}
				>
					<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					taille="compacte"
					disabled={enCours}
					aria-label={t('admin.workflows.fields.action.edit', { nom: champ.label })}
					onClick={onOuvrirEdition}
				>
					<Pencil aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				{archive ? (
					<Button
						taille="compacte"
						disabled={enCours}
						aria-label={t('admin.workflows.fields.action.restore', { nom: champ.label })}
						onClick={onRestaurer}
					>
						<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} />
					</Button>
				) : (
					<Button
						taille="compacte"
						disabled={enCours}
						aria-label={t('admin.workflows.fields.action.archive', { nom: champ.label })}
						onClick={onOuvrirArchivage}
					>
						<Archive aria-hidden="true" size={16} strokeWidth={2} />
					</Button>
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// La grille champ × étape — §7 bis.11
// ---------------------------------------------------------------------------------------------

/** Les quatre états d'une case, dans l'ordre où la liste déroulante les propose (§7 bis.11.4). */
const ETATS_CASE: readonly EtatCase[] = ['defaut', ...VISIBILITES]

const LIBELLES_ETAT: Readonly<Record<EtatCase, CleTraduction>> = {
	defaut: 'admin.workflows.rules.state.defaut',
	hidden: 'admin.workflows.rules.state.hidden',
	visible: 'admin.workflows.rules.state.visible',
	required: 'admin.workflows.rules.state.required',
}

/**
 * Une case de la grille.
 *
 * LE LIBELLÉ ACCESSIBLE NOMME LE CHAMP **ET** L'ÉTAPE, jamais « visibilité » seul : sept colonnes de
 * listes anonymes seraient indéchiffrables à la voix, et l'en-tête de colonne ne suffit pas — un
 * lecteur d'écran l'annonce à l'entrée dans la cellule, pas au moment où le contrôle prend le focus
 * (docs/DESIGN_SYSTEM.md §5.9, §8).
 *
 * LE RÉGLAGE PART AU CHANGEMENT, sans bouton d'enregistrement. Une case est une ligne entière de la
 * base — la clé primaire est le couple (§3.2 du composeur) —, donc chaque changement est déjà
 * atomique et il n'existe aucune saisie partielle à annuler. Un bouton par case ajouterait
 * quarante-deux commandes à un tableau qui en compte déjà quarante-deux.
 */
function CaseVisibilite({
	champ,
	etape,
	etat,
	enCours,
	onRegler,
}: {
	readonly champ: ChampAdministrable
	readonly etape: EtapeAdministrable
	readonly etat: EtatCase
	readonly enCours: boolean
	readonly onRegler: (etat: EtatCase) => void
}) {
	return (
		<select
			data-testid="case-visibilite"
			data-champ={champ.key}
			data-etape={etape.id}
			value={etat}
			disabled={enCours}
			aria-label={t('admin.workflows.rules.cell.aria', {
				champ: champ.label,
				etape: libelleEtape(etape),
			})}
			onChange={(evenement) => onRegler(evenement.target.value as EtatCase)}
			// La largeur minimale n'est pas cosmétique : sans elle, la case se rétrécit à la largeur de
			// l'en-tête de sa colonne et son état devient illisible — « Par dé… », « Aff… » —, ce qui
			// est précisément l'information que la grille existe pour montrer. Mesuré à la capture du
			// 2026-08-15. Le tableau s'élargit donc, et défile dans son conteneur (§7 bis.11.6).
			className="min-h-[var(--size-target)] w-full min-w-[8.5rem] rounded-sm border border-border bg-surface px-2"
		>
			{ETATS_CASE.map((valeur) => (
				<option key={valeur} value={valeur}>
					{t(LIBELLES_ETAT[valeur])}
				</option>
			))}
		</select>
	)
}

/**
 * Le tableau des règles de visibilité.
 *
 * C'EST UN VRAI `table`, avec ses deux niveaux d'en-tête — `th scope="col"` pour les étapes,
 * `th scope="row"` pour les champs. Le §5.9 du design system l'impose et le motif vaut ici plus
 * qu'ailleurs : une grille de `div` priverait un lecteur d'écran de l'en-tête rappelé à chaque
 * cellule, c'est-à-dire de la seule façon de savoir de quel couple on parle.
 *
 * IL DÉFILE DANS SON PROPRE CONTENEUR (§7 du design system) : sept étapes ne tiennent pas sous
 * 768 px, et la page ne défile jamais horizontalement.
 */
function GrilleVisibilites({
	grille,
	enCours,
	onRegler,
}: {
	readonly grille: readonly LigneGrille[]
	readonly enCours: boolean
	readonly onRegler: (champ: ChampAdministrable, etape: EtapeAdministrable, etat: EtatCase) => void
}) {
	const etapes = grille[0]?.cases.map((cellule) => cellule.etape) ?? []
	return (
		<div className="overflow-x-auto rounded-lg border border-border bg-surface">
			<table data-testid="grille-visibilites" className="w-full border-collapse text-sm">
				<thead>
					<tr>
						<th
							scope="col"
							className="sticky left-0 bg-surface px-3 py-2 text-left font-medium text-text-2 border-b border-border"
						>
							{t('admin.workflows.rules.column.field')}
						</th>
						{etapes.map((etape) => (
							<th
								key={etape.id}
								scope="col"
								className="px-3 py-2 text-left font-medium text-text-2 border-b border-border whitespace-nowrap"
							>
								{libelleEtape(etape)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{grille.map((ligne) => (
						<tr key={ligne.champ.id} data-testid="ligne-grille">
							<th
								scope="row"
								className="sticky left-0 bg-surface px-3 py-2 text-left font-normal border-b border-border whitespace-nowrap"
							>
								{ligne.champ.label}
							</th>
							{ligne.cases.map((cellule) => (
								<td key={cellule.etape.id} className="px-2 py-2 border-b border-border">
									<CaseVisibilite
										champ={ligne.champ}
										etape={cellule.etape}
										etat={cellule.etat}
										enCours={enCours}
										onRegler={(etat) => onRegler(ligne.champ, cellule.etape, etat)}
									/>
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}


// ---------------------------------------------------------------------------------------------
// Les exigences propres à une transition — §7 bis.12
// ---------------------------------------------------------------------------------------------

const LIBELLES_ORIGINE: Readonly<Record<OrigineExigence, CleTraduction>> = {
	regle: 'admin.workflows.requirements.origin.regle',
	transition: 'admin.workflows.requirements.origin.transition',
	'les-deux': 'admin.workflows.requirements.origin.les-deux',
}

/**
 * Une exigence effective, avec son origine.
 *
 * LA COMMANDE DE RETRAIT N'EST OFFERTE QUE SUR CE QUE CE BLOC ÉCRIT. Une exigence venue de la règle
 * de l'étape d'arrivée se modifie dans la grille (§7 bis.11), et un bouton qui prétendrait la
 * retirer ici enverrait un `DELETE` sur une ligne qui n'existe pas : `200`, zéro ligne, et une
 * exigence toujours imposée par `move_card`. L'écran renvoie donc à la grille en une phrase, ce qui
 * est la seule réponse vraie.
 *
 * `les-deux` GARDE SA COMMANDE : la liaison existe bel et bien et se retire, même si la règle
 * continuera d'exiger le champ. Le libellé accessible nomme le champ ET la transition, faute de
 * quoi une page portant onze arêtes offrirait des commandes indiscernables à la voix.
 *
 * LA PHRASE QUI RENVOIE À LA GRILLE N'EST PAS ICI, ET C'EST UNE CORRECTION MESURÉE À LA CAPTURE du
 * 2026-08-15 : répétée sous chaque ligne, elle apparaissait trois fois d'affilée sous
 * « Négociation vers Signature », et occupait sous 390 px deux lignes par exigence — davantage que
 * les noms de champs qu'elle accompagnait. Elle est rendue UNE fois par transition, sous la liste.
 */
function LigneExigence({
	exigence,
	nomTransition,
	enCours,
	onOuvrirRetrait,
}: {
	readonly exigence: ExigenceEffective
	readonly nomTransition: string
	readonly enCours: boolean
	readonly onOuvrirRetrait: () => void
}) {
	const retirable = exigence.origine !== 'regle'
	return (
		<div
			data-testid="ligne-exigence"
			data-champ={exigence.champ.key}
			data-origine={exigence.origine}
			className="flex flex-wrap items-center gap-2"
		>
			<span>{exigence.champ.label}</span>
			<code className="rounded-sm bg-hover px-1 text-sm text-text-2">{exigence.champ.key}</code>
			<span className="text-sm text-text-2">{t(LIBELLES_ORIGINE[exigence.origine])}</span>
			{retirable ? (
				<button
					type="button"
					disabled={enCours}
					onClick={onOuvrirRetrait}
					aria-label={t('admin.workflows.requirements.remove.aria', {
						champ: exigence.champ.label,
						transition: nomTransition,
					})}
					className="inline-flex items-center gap-1 min-h-[var(--size-target)] rounded-sm px-2 text-sm hover:bg-hover disabled:opacity-70"
				>
					<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
					<span>{t('admin.workflows.requirements.remove.confirm.action')}</span>
				</button>
			) : null}
		</div>
	)
}

/**
 * Formulaire d'ajout d'une exigence : UNE seule liste.
 *
 * La transition est déjà connue par la ligne qui l'ouvre ; la redemander dans une seconde liste
 * ferait choisir deux fois ce que l'administrateur vient de désigner d'un clic.
 *
 * LA LISTE NE CONTIENT QUE DES CHOIX ACCEPTABLES (§7 bis.12.4) — ni champ archivé, dont la liaison
 * n'aurait aucun effet, ni champ déjà lié, dont le refus est connu d'avance. Un champ déjà exigé par
 * la règle de l'étape d'arrivée y reste, avec une phrase qui dit ce que la liaison ajoute : rien
 * tant que la règle ne change pas.
 */
function FormulaireExigence({
	champs,
	dejaParRegle,
	nomTransition,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly champs: readonly ChampAdministrable[]
	readonly dejaParRegle: ReadonlySet<string>
	readonly nomTransition: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (idChamp: string) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const premier = useRef<HTMLSelectElement>(null)
	const [idChamp, setIdChamp] = useState(() => champs[0]?.id ?? '')

	useEffect(() => {
		premier.current?.focus()
	}, [])

	const retenu = champs.some((champ) => champ.id === idChamp) ? idChamp : (champs[0]?.id ?? '')

	return (
		<form
			data-testid="formulaire-exigence"
			aria-label={t('admin.workflows.requirements.add.aria', { transition: nomTransition })}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (retenu !== '' && !enCours) onValider(retenu)
			}}
		>
			{champs.length === 0 ? (
				<p role="status" data-testid="exigences-choix-epuises" className="text-sm text-text-2">
					{t('admin.workflows.requirements.add.none')}
				</p>
			) : (
				<div className="flex flex-col gap-1">
					<label htmlFor={`${prefixe}-champ`} className="text-sm text-text-2">
						{t('admin.workflows.requirements.add.field')}
					</label>
					<select
						id={`${prefixe}-champ`}
						ref={premier}
						value={retenu}
						onChange={(evenement) => setIdChamp(evenement.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					>
						{champs.map((champ) => (
							<option key={champ.id} value={champ.id}>
								{champ.label}
							</option>
						))}
					</select>
					{dejaParRegle.has(retenu) ? (
						<p data-testid="exigence-deja-par-regle" className="text-sm text-text-2">
							{t('admin.workflows.requirements.add.alreadyByRule')}
						</p>
					) : null}
				</div>
			)}
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={champs.length === 0 || enCours}>
					{t('admin.workflows.requirements.add.submit')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
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
	const [champs, setChamps] = useState<EtatAsync<readonly ChampAdministrable[]>>(enChargement)
	const [regles, setRegles] = useState<EtatAsync<readonly RegleAdministrable[]>>(enChargement)
	const [exigences, setExigences] =
		useState<EtatAsync<readonly ExigenceAdministrable[]>>(enChargement)
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
			// Les champs partent avec les étapes et les arêtes, par le §7 bis.10.1, les règles avec eux
			// par le §7 bis.11.1, et les exigences par le §7 bis.12.1 : les cinq décrivent le même
			// workflow, une règle n'a de sens qu'entre un champ et une étape du MÊME instant, une
			// exigence qu'entre une arête et un champ du même instant, et toute écriture les rejoue
			// toutes.
			const [lues, arretes, formulaire, visibilites, exigees] = await Promise.all([
				lireEtapes(client, idWorkflow),
				lireTransitions(client, idWorkflow),
				lireChamps(client, idWorkflow),
				lireRegles(client, idWorkflow),
				lireExigences(client, idWorkflow),
			])
			setEtapes(lues)
			setTransitions(arretes)
			setChamps(formulaire)
			setRegles(visibilites)
			setExigences(exigees)
		},
		[client],
	)

	useEffect(() => {
		if (client === null || idChoisi === null) return
		setEtapes(enChargement)
		setTransitions(enChargement)
		setChamps(enChargement)
		setRegles(enChargement)
		setExigences(enChargement)
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

	/**
	 * Jumelle des deux précédentes pour les champs.
	 *
	 * Trois enveloppes pour trois vocabulaires de refus, et non une enveloppe générique : le
	 * `23505` d'un champ dit « cette clé est déjà prise », celui d'une étape « ce nœud est déjà
	 * employé », celui d'une arête « cette transition existe ». Les confondre afficherait un message
	 * exact sur un objet qui n'est pas celui que l'administrateur vient de toucher.
	 */
	const executerChampFormulaire = useCallback(
		async (action: ActionChamp, message: string) => {
			if (idChoisi === null) return
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') {
					setRefus(texteRefusChamp(resultat.refus))
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
	 * Jumelle des trois précédentes pour les règles de visibilité.
	 *
	 * Une quatrième enveloppe, et non une générique : le vocabulaire du refus est le seul point où
	 * les quatre blocs diffèrent, et c'est exactement ce qu'il ne faut pas confondre (§7 bis.11.5).
	 *
	 * ELLE NE FERME AUCUNE OUVERTURE, à la différence des trois autres : régler une case n'ouvre
	 * rien, et fermer un formulaire de champ resté ouvert ailleurs ferait disparaître une saisie que
	 * l'administrateur n'a pas abandonnée.
	 */
	const executerRegleVisibilite = useCallback(
		async (action: ActionRegle, message: string) => {
			if (idChoisi === null) return
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') {
					setRefus(texteRefusRegle(resultat.refus))
					return
				}
				if (resultat.statut === 'sans-effet') {
					setRefus(t('admin.workflows.refus.sans-effet'))
					return
				}
				setRefus(null)
				setAnnonce(message)
				await rechargerGraphe(idChoisi)
			} finally {
				setEnCours(false)
			}
		},
		[idChoisi, rechargerGraphe],
	)

	/**
	 * Jumelle des quatre précédentes pour les exigences de transition.
	 *
	 * Une cinquième enveloppe, pour la raison des quatre autres : le `23505` d'une exigence dit
	 * « ce champ est déjà exigé », celui d'un champ « cette clé est déjà prise », celui d'une arête
	 * « cette transition existe ». Les confondre afficherait un message exact sur un objet que
	 * l'administrateur n'a pas touché.
	 */
	const executerExigenceTransition = useCallback(
		async (action: ActionExigence, message: string) => {
			if (idChoisi === null) return
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') {
					setRefus(texteRefusExigence(resultat.refus))
					// UN `23505` RECHARGE QUAND MÊME, et c'est le §7 bis.12.3 appliqué : l'état voulu
					// par l'administrateur est précisément celui que la base porte déjà, et le laisser
					// à l'écran sans la ligne qui l'explique donnerait un refus incompréhensible.
					if (resultat.refus.nature === 'deja-exige') await rechargerGraphe(idChoisi)
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
	 * Règle une case, ou la rend au défaut.
	 *
	 * LES DEUX GESTES SONT DERRIÈRE LE MÊME CONTRÔLE parce qu'ils répondent à la même question — que
	 * montre ce champ à cette étape ? —, et le §7 bis.11.3 les sépare à l'écriture : trois valeurs
	 * partent en `upsert`, le défaut part en suppression.
	 */
	const reglerLaCase = useCallback(
		(
			idWorkflow: string,
			idWorkspace: string,
			champ: ChampAdministrable,
			etape: EtapeAdministrable,
			etat: EtatCase,
		) => {
			if (client === null) return
			if (etat === 'defaut') {
				void executerRegleVisibilite(
					() => rendreAuDefaut(client, champ.id, etape.id),
					t('live.workflows.rule.reset'),
				)
				return
			}
			void executerRegleVisibilite(
				() =>
					reglerVisibilite(client, {
						idChamp: champ.id,
						idEtape: etape.id,
						idWorkflow,
						idWorkspace,
						visibilite: etat as Visibilite,
					}),
				t('live.workflows.rule.set'),
			)
		},
		[client, executerRegleVisibilite],
	)

	/** Déplace un champ dans le formulaire — même ordonnancement que les étapes (`CRM-075`). */
	const deplacerLeChamp = useCallback(
		(liste: readonly ChampAdministrable[], idChamp: string, sens: Sens) => {
			if (client === null) return
			const calcul = calculerDeplacement(liste, idChamp, sens)
			if (calcul.statut !== 'calcule') {
				setRefus(t('admin.move.impossible'))
				return
			}
			void executerChampFormulaire(
				() => deplacerChamp(client, idChamp, calcul.position),
				t('live.workflows.field.moved'),
			)
		},
		[client, executerChampFormulaire],
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

										{/* Les champs, TROISIÈME bloc et dans la même colonne : on ne dessine pas le
										    formulaire d'un workflow avant d'en avoir posé les étapes et les chemins
										    (§7 bis.10.6). */}
										<section
											aria-label={t('admin.workflows.fields.aria', { workflow: choisi.name })}
											className="flex flex-col gap-3"
										>
											<div className="flex flex-col gap-1">
												<h3 className="font-medium">{t('admin.workflows.fields.title')}</h3>
												<p className="text-sm text-text-2">{t('admin.workflows.fields.intro')}</p>
											</div>
											{champs.statut === 'chargement' ? (
												<SkeletonListe lignes={3} libelle={t('admin.workflows.fields.loading')} />
											) : null}
											{champs.statut === 'erreur' ? (
												<EtatErreur
													titre={t('admin.workflows.fields.error')}
													corps={t('admin.workflows.error.body')}
													libelleReprise={t('admin.tree.error.retry')}
													onReprise={() => void rechargerGraphe(choisi.id)}
												/>
											) : null}
											{champs.statut === 'pret' ? (
												<>
													{champs.donnees.length === 0 ? (
														<EtatVide
															titre={t('admin.workflows.fields.empty')}
															corps={t('admin.workflows.fields.empty.hint')}
														/>
													) : (
														<ol
															data-testid="liste-champs"
															className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
														>
															{champs.donnees.map((champ) => (
																<li key={champ.id} className="flex flex-col gap-2">
																	<LigneChamp
																		champ={champ}
																		liste={champs.donnees}
																		enCours={enCours}
																		onDeplacer={(sens) =>
																			deplacerLeChamp(champs.donnees, champ.id, sens)
																		}
																		onOuvrirEdition={() => {
																			setRefus(null)
																			setOuverture({ type: 'champ-edition', idChamp: champ.id })
																		}}
																		onOuvrirArchivage={() => {
																			setRefus(null)
																			setOuverture({ type: 'champ-archivage', idChamp: champ.id })
																		}}
																		onRestaurer={() =>
																			void executerChampFormulaire(
																				() => archiverChamp(client, champ.id, null),
																				t('live.workflows.field.restored'),
																			)
																		}
																	/>
																	{ouverture.type === 'champ-edition' && ouverture.idChamp === champ.id ? (
																		<FormulaireChamp
																			champ={champ}
																			refus={refus}
																			enCours={enCours}
																			onValider={(saisie) =>
																				void executerChampFormulaire(
																					() =>
																						modifierChamp(
																							client,
																							champ.id,
																							saisie.libelle.trim(),
																							saisie.aide.trim() === '' ? null : saisie.aide.trim(),
																							composerOptions(saisie.type, saisie.choix, saisie.devise),
																						),
																					t('live.workflows.field.updated'),
																				)
																			}
																			onAnnuler={() => {
																				setRefus(null)
																				setOuverture(AUCUNE)
																			}}
																		/>
																	) : null}
																	{ouverture.type === 'champ-archivage' && ouverture.idChamp === champ.id ? (
																		<ConfirmationRetrait
																			marqueur="confirmation-archivage-champ"
																			titre={t('admin.workflows.fields.archive.confirm', {
																				nom: champ.label,
																			})}
																			corps={t('admin.workflows.fields.archive.confirm.body')}
																			libelleAction={t('admin.workflows.fields.archive.confirm.action')}
																			refus={refus}
																			enCours={enCours}
																			onConfirmer={() =>
																				void executerChampFormulaire(
																					// L'instant vient du client : PostgREST écrit ce qu'on lui
																					// envoie, et c'est celui que l'écran affichera.
																					() =>
																						archiverChamp(client, champ.id, new Date().toISOString()),
																					t('live.workflows.field.archived'),
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
													)}
													{ouverture.type === 'champ-declaration' ? (
														<FormulaireChamp
															champ={null}
															refus={refus}
															enCours={enCours}
															onValider={(saisie) =>
																void executerChampFormulaire(
																	() =>
																		declarerChamp(client, {
																			idWorkflow: choisi.id,
																			idWorkspace: choisi.workspace_id,
																			cle: saisie.cle.trim(),
																			libelle: saisie.libelle.trim(),
																			type: saisie.type,
																			aide: saisie.aide.trim() === '' ? null : saisie.aide.trim(),
																			options: composerOptions(saisie.type, saisie.choix, saisie.devise),
																		}),
																	t('live.workflows.field.declared'),
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
																	setOuverture({ type: 'champ-declaration' })
																}}
															>
																<Plus aria-hidden="true" size={16} strokeWidth={2} />
																{t('admin.workflows.fields.action.declare')}
															</Button>
														</div>
													)}
												</>
											) : null}
										</section>

										{/* Les règles de visibilité, QUATRIÈME bloc et dans la même colonne : on ne règle
										    pas la visibilité de champs qu'on n'a pas déclarés (§7 bis.11.6). */}
										<section
											aria-label={t('admin.workflows.rules.aria', { workflow: choisi.name })}
											className="flex flex-col gap-3"
										>
											<div className="flex flex-col gap-1">
												<h3 className="font-medium">{t('admin.workflows.rules.title')}</h3>
												<p className="text-sm text-text-2">{t('admin.workflows.rules.intro')}</p>
											</div>
											{regles.statut === 'chargement' ? (
												<SkeletonListe lignes={3} libelle={t('admin.workflows.rules.loading')} />
											) : null}
											{regles.statut === 'erreur' ? (
												<EtatErreur
													titre={t('admin.workflows.rules.error')}
													corps={t('admin.workflows.error.body')}
													libelleReprise={t('admin.tree.error.retry')}
													onReprise={() => void rechargerGraphe(choisi.id)}
												/>
											) : null}
											{regles.statut === 'pret' && champs.statut === 'pret' ? (
												(() => {
													// La grille se compose ici, une seule fois par rendu : les trois listes
													// viennent du même instant (§7 bis.11.1), et la recomposer par cellule
													// referait quarante-deux fois le même index.
													const grille = composerGrille(champs.donnees, etapes.donnees, regles.donnees)
													const archives = champs.donnees.filter(
														(champ) => champ.archived_at !== null,
													).length
													if (grille.length === 0 || etapes.donnees.length === 0) {
														return (
															<p role="status" data-testid="grille-impossible" className="text-sm text-text-2">
																{grille.length === 0
																	? t('admin.workflows.rules.noFields')
																	: t('admin.workflows.rules.noSteps')}
															</p>
														)
													}
													return (
														<>
															<GrilleVisibilites
																grille={grille}
																enCours={enCours}
																onRegler={(champ, etape, etat) =>
																	reglerLaCase(choisi.id, choisi.workspace_id, champ, etape, etat)
																}
															/>
															{/* Le défaut et « Affiché » produisent le MÊME formulaire : le taire
															    laisserait chercher une différence de comportement qui n'existe
															    pas (§7 bis.11.4). */}
															<p className="text-sm text-text-2" data-testid="grille-note-defaut">
																{t('admin.workflows.rules.note.default')}
															</p>
															{archives > 0 ? (
																<p className="text-sm text-text-2" data-testid="grille-note-archives">
																	{archives === 1
																		? t('admin.workflows.rules.note.archived.one')
																		: t('admin.workflows.rules.note.archived.many', {
																				nombre: String(archives),
																			})}
																</p>
															) : null}
														</>
													)
												})()
											) : null}
										</section>

										{/* Les exigences de transition, CINQUIÈME bloc et dans la même colonne : on
										    n'ajoute pas d'exigence propre à une arête avant d'avoir vu ce que les
										    règles exigent déjà (§7 bis.12.6). */}
										<section
											aria-label={t('admin.workflows.requirements.aria', { workflow: choisi.name })}
											className="flex flex-col gap-3"
										>
											<div className="flex flex-col gap-1">
												<h3 className="font-medium">{t('admin.workflows.requirements.title')}</h3>
												<p className="text-sm text-text-2">
													{t('admin.workflows.requirements.intro')}
												</p>
											</div>
											{exigences.statut === 'chargement' ? (
												<SkeletonListe
													lignes={3}
													libelle={t('admin.workflows.requirements.loading')}
												/>
											) : null}
											{exigences.statut === 'erreur' ? (
												<EtatErreur
													titre={t('admin.workflows.requirements.error')}
													corps={t('admin.workflows.error.body')}
													libelleReprise={t('admin.tree.error.retry')}
													onReprise={() => void rechargerGraphe(choisi.id)}
												/>
											) : null}
											{exigences.statut === 'pret' &&
											champs.statut === 'pret' &&
											regles.statut === 'pret' &&
											transitions.statut === 'pret' ? (
												transitions.donnees.length === 0 ? (
													<p
														role="status"
														data-testid="exigences-sans-transition"
														className="text-sm text-text-2"
													>
														{t('admin.workflows.requirements.noTransitions')}
													</p>
												) : champs.donnees.every((champ) => champ.archived_at !== null) ? (
													<p
														role="status"
														data-testid="exigences-sans-champ"
														className="text-sm text-text-2"
													>
														{t('admin.workflows.requirements.noFields')}
													</p>
												) : (
													<ol
														data-testid="liste-exigences"
														className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
													>
														{/* Les arêtes sont parcourues dans l'ordre du graphe, celui du bloc
														    des transitions : l'administrateur retrouve chaque arête à la
														    place où il vient de la lire (§7 bis.12.6). */}
														{grouperTransitions(etapes.donnees, transitions.donnees).flatMap(
															(groupe) =>
																groupe.sorties.map((sortie) => {
																	const arrivee =
																		etapes.donnees.find(
																			(etape) => etape.id === sortie.to_step_id,
																		) ?? null
																	const nomArrivee =
																		arrivee === null
																			? sortie.to_step_id
																			: libelleEtape(arrivee)
																	// Le nom complet « départ vers arrivée » plutôt que le seul
																	// libellé de l'arête : cinq arêtes du seed s'appellent toutes
																	// « Marquer perdu », et un titre qui ne les distinguerait pas
																	// rendrait le bloc illisible.
																	const nomTransition = t(
																		'admin.workflows.transitions.form.edit',
																		{
																			depart: libelleEtape(groupe.etape),
																			arrivee: nomArrivee,
																		},
																	)
																	const effectives = exigencesEffectives(
																		sortie,
																		champs.donnees,
																		regles.donnees,
																		exigences.donnees,
																	)
																	const sansEffet = exigencesSansEffet(
																		sortie,
																		champs.donnees,
																		exigences.donnees,
																	)
																	const liables = champsLiables(
																		sortie,
																		champs.donnees,
																		exigences.donnees,
																	)
																	const parRegle = new Set(
																		effectives
																			.filter((item) => item.origine !== 'transition')
																			.map((item) => item.champ.id),
																	)
																	return (
																		<li
																			key={sortie.id}
																			data-testid="transition-exigences"
																			data-transition={sortie.id}
																			className="flex flex-col gap-2"
																		>
																			<span className="font-medium">{nomTransition}</span>
																			{effectives.length === 0 ? (
																				<span
																					data-testid="transition-sans-exigence"
																					className="text-sm text-text-2"
																				>
																					{t('admin.workflows.requirements.none')}
																				</span>
																			) : (
																				<ul className="flex flex-col gap-1 pl-4">
																					{effectives.map((item) => (
																						<li key={item.champ.id}>
																							<LigneExigence
																								exigence={item}
																								nomTransition={nomTransition}
																								enCours={enCours}
																								onOuvrirRetrait={() => {
																									setRefus(null)
																									setOuverture({
																										type: 'exigence-retrait',
																										idTransition: sortie.id,
																										idChamp: item.champ.id,
																									})
																								}}
																							/>
																						</li>
																					))}
																				</ul>
																			)}
																			{/* La phrase qui renvoie à la grille est rendue UNE fois par
																			    transition, et non sous chaque ligne : la capture du
																			    2026-08-15 la montrait trois fois d'affilée sous une même
																			    arête, et deux lignes par exigence sous 390 px. */}
																			{effectives.some(
																				(item) => item.origine !== 'transition',
																			) ? (
																				<p
																					data-testid="exigences-note-regle"
																					className="text-sm text-text-3"
																				>
																					{t('admin.workflows.requirements.origin.hint')}
																				</p>
																			) : null}
																			{/* Une liaison vers un champ archivé n'a aucun effet, et le
																			    taire laisserait croire à une exigence qui s'applique
																			    (§7 bis.12.4). */}
																			{sansEffet.length > 0 ? (
																				<p
																					data-testid="exigences-sans-effet"
																					className="text-sm text-text-2"
																				>
																					{sansEffet.length === 1
																						? t('admin.workflows.requirements.void.one')
																						: t('admin.workflows.requirements.void.many', {
																								nombre: String(sansEffet.length),
																							})}
																				</p>
																			) : null}
																			{ouverture.type === 'exigence-retrait' &&
																			ouverture.idTransition === sortie.id ? (
																				<ConfirmationRetrait
																					marqueur="confirmation-retrait-exigence"
																					titre={t(
																						'admin.workflows.requirements.remove.confirm',
																						{
																							champ:
																								champs.donnees.find(
																									(champ) =>
																										champ.id === ouverture.idChamp,
																								)?.label ?? ouverture.idChamp,
																							transition: nomTransition,
																						},
																					)}
																					corps={t(
																						'admin.workflows.requirements.remove.confirm.body',
																					)}
																					libelleAction={t(
																						'admin.workflows.requirements.remove.confirm.action',
																					)}
																					refus={refus}
																					enCours={enCours}
																					onConfirmer={() =>
																						void executerExigenceTransition(
																							() =>
																								retirerExigence(
																									client,
																									sortie.id,
																									ouverture.type === 'exigence-retrait'
																										? ouverture.idChamp
																										: '',
																								),
																							t('live.workflows.requirement.removed'),
																						)
																					}
																					onAnnuler={() => {
																						setRefus(null)
																						setOuverture(AUCUNE)
																					}}
																				/>
																			) : null}
																			{ouverture.type === 'exigence-ajout' &&
																			ouverture.idTransition === sortie.id ? (
																				<FormulaireExigence
																					champs={liables}
																					dejaParRegle={parRegle}
																					nomTransition={nomTransition}
																					refus={refus}
																					enCours={enCours}
																					onValider={(idChamp) =>
																						void executerExigenceTransition(
																							() => exigerChamp(client, sortie.id, idChamp),
																							t('live.workflows.requirement.added'),
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
																						variante="secondaire"
																						disabled={enCours}
																						onClick={() => {
																							setRefus(null)
																							setOuverture({
																								type: 'exigence-ajout',
																								idTransition: sortie.id,
																							})
																						}}
																					>
																						<Plus
																							aria-hidden="true"
																							size={16}
																							strokeWidth={2}
																						/>
																						{t('admin.workflows.requirements.action.add')}
																					</Button>
																				</div>
																			)}
																		</li>
																	)
																}),
														)}
													</ol>
												)
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
