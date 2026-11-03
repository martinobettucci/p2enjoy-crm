// @spec CRM-076 (docs/BACKLOG.md) — les éléments de l'éditeur de formulaire des workflows : la ligne d'un champ, son
//       formulaire de déclaration et d'édition, l'éditeur de choix, le champ texte, l'alerte de refus, la confirmation
//       de retrait ; docs/SPEC-workflow-engine.md §7 bis.9 et §7 bis.10 ; docs/DESIGN_SYSTEM.md §5.7, §5.13, §5.15
// @spec CRM-112 (docs/BACKLOG.md) tranche T3.a — docs/SPEC-champs-communs.md §7 (Réglages ▸ « Champs de l'affaire »
//       « réemploie les éléments de l'éditeur de formulaire des workflows ») ; docs/DESIGN_SYSTEM.md §5.86 : ces éléments
//       quittent `AdministrationWorkflows.tsx` SANS CHANGER LEUR RENDU, pour que les deux écrans qui déclarent un champ
//       le déclarent de la même façon. Un champ commun a les colonnes d'un champ de workflow, moins le workflow : les
//       éléments ne lisent que `ChampDeclarable`. La confirmation de retrait reçoit, après son refus, une suite
//       facultative — le lien qui lève le refus.
// @spec CRM-112 tranche T4.a — docs/DESIGN_SYSTEM.md §5.91 : la case « Afficher dans la liste des affaires » du formulaire,
//       offerte aux seuls champs communs (`caseListe`), et la pilule « Dans la liste » de la ligne

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useRefus } from '../components/ui/RefusCommandes'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import { deplacementPossible, type Ordonnable, type Sens } from '../lib/administration-arborescence'
import {
	TYPES_CHAMP,
	aideChampConforme,
	choixDuChamp,
	cleChampConforme,
	deviseConforme,
	deviseDuChamp,
	estTypeAChoix,
	estTypeMonetaire,
	libelleChampConforme,
	refusDesChoix,
	type ChampDeclarable,
	type ChoixChamp,
	type RefusChoix,
} from '../lib/administration-workflows'

/**
 * Alerte de refus, placée dans le bloc concerné et non en tête d'écran, pour que le refus soit lu
 * près du geste qui l'a causé (docs/DESIGN_SYSTEM.md §5.13).
 */
export function AlerteRefus({ message }: { readonly message: string }) {
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

export type ProprietesChampSurcharge = {
	readonly id: string
	readonly libelle: string
	readonly valeur: string
	readonly onChange: (valeur: string) => void
	readonly aide: string
	readonly erreur?: string
	readonly refInterne?: React.Ref<HTMLInputElement>
}

/** Champ texte du §5.7 : libellé au-dessus, aide et erreur associées par `aria-describedby`. */
export function ChampSurcharge({
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

// ---------------------------------------------------------------------------------------------
// Confirmation de retrait — dans le flux du document, jamais une modale
// ---------------------------------------------------------------------------------------------

/**
 * Les textes sont REÇUS et non écrits ici : la confirmation sert deux retraits — une étape et une
 * arête — dont les conséquences n'ont rien de commun. Une étape occupée par des cards peut être
 * refusée par la base ; une arête ne l'est jamais (§7 bis.9.2), et promettre le même obstacle dans
 * les deux cas décrirait une règle qui n'existe pas.
 */
export function ConfirmationRetrait({
	titre,
	corps,
	libelleAction,
	marqueur,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
	suiteRefus,
}: {
	readonly titre: string
	readonly corps: string
	readonly libelleAction: string
	readonly marqueur: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
	/** Ce qui suit le refus — le lien vers le geste qui le lève (docs/DESIGN_SYSTEM.md §5.86, §5.29 bis). */
	readonly suiteRefus?: ReactNode
}) {
	const droit = useRefus()
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
			{refus === null ? null : suiteRefus}
			<div className="flex gap-2">
				<button {...droit}
					ref={premier}
					type="button"
					disabled={droit.disabled === true || (enCours)}
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

export function libelleType(type: string): string {
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
export function EditeurChoix({
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
	const droit = useRefus()
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
						<Button {...droit}
							taille="compacte"
							disabled={droit.disabled === true || (enCours)}
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
				<Button {...droit}
					variante="secondaire"
					taille="compacte"
					disabled={droit.disabled === true || (enCours)}
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

export type SaisieChamp = {
	readonly cle: string
	readonly libelle: string
	readonly type: string
	readonly aide: string
	readonly choix: readonly ChoixChamp[]
	readonly devise: string
	/** `CRM-112` T4.a : le champ commun est une colonne de la vue liste (§5.91). Sans objet pour un champ de workflow. */
	readonly liste: boolean
}

/** `CRM-112` T4.a (§5.91) : les types dont la valeur est un identifiant ne s'affichent pas en colonne. */
export const TYPES_HORS_COLONNE: readonly string[] = ['user', 'contact', 'file']

/** La saisie d'édition repart du champ tel qu'il est, options comprises. */
export function saisieDepuisChamp(champ: ChampDeclarable): SaisieChamp {
	return {
		cle: champ.key,
		libelle: champ.label,
		type: champ.type,
		aide: champ.help_text ?? '',
		choix: choixDuChamp(champ),
		devise: deviseDuChamp(champ),
		liste: (champ as { readonly is_listed?: boolean }).is_listed === true,
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
export function FormulaireChamp({
	champ,
	refus,
	enCours,
	onValider,
	onAnnuler,
	caseListe = false,
}: {
	readonly champ: ChampDeclarable | null
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieChamp) => void
	readonly onAnnuler: () => void
	/** `CRM-112` T4.a (§5.91) : la case « Afficher dans la liste des affaires », offerte aux seuls champs communs. */
	readonly caseListe?: boolean
}) {
	const droit = useRefus()
	const prefixe = useId()
	const [saisie, setSaisie] = useState<SaisieChamp>(() =>
		champ === null
			? { cle: '', libelle: '', type: 'text', aide: '', choix: [], devise: 'EUR', liste: false }
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

			{caseListe ? (
				<div className="flex flex-col gap-1">
					<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
						<input
							type="checkbox"
							className="size-6 accent-[var(--color-brand)]"
							checked={saisie.liste && !TYPES_HORS_COLONNE.includes(saisie.type)}
							disabled={TYPES_HORS_COLONNE.includes(saisie.type)}
							aria-describedby={`${prefixe}-liste-aide`}
							onChange={(evenement) => setSaisie((precedente) => ({ ...precedente, liste: evenement.target.checked }))}
						/>
						{t('admin.commonFields.form.listed')}
					</label>
					<span id={`${prefixe}-liste-aide`} className="text-sm text-text-2">
						{TYPES_HORS_COLONNE.includes(saisie.type)
							? t('admin.commonFields.form.listed.unavailable')
							: t('admin.commonFields.form.listed.help')}
					</span>
				</div>
			) : null}

			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button {...droit} type="submit" variante="primaire" disabled={droit.disabled === true || !complet || enCours}>
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
export function LigneChamp({
	champ,
	liste,
	enCours,
	onDeplacer,
	onOuvrirEdition,
	onOuvrirArchivage,
	onRestaurer,
}: {
	readonly champ: ChampDeclarable
	readonly liste: readonly Ordonnable[]
	readonly enCours: boolean
	readonly onDeplacer: (sens: Sens) => void
	readonly onOuvrirEdition: () => void
	readonly onOuvrirArchivage: () => void
	readonly onRestaurer: () => void
}) {
	const droit = useRefus()
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
			{/* `CRM-112` T4.a (§5.91) : un champ commun listé le dit sur sa ligne. */}
			{(champ as { readonly is_listed?: boolean }).is_listed === true && !TYPES_HORS_COLONNE.includes(champ.type) ? (
				<span data-testid="champ-dans-la-liste" className="rounded-full bg-hover px-2 text-xs text-text-2">
					{t('admin.commonFields.listed.pill')}
				</span>
			) : null}
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
				<Button {...droit}
					taille="compacte"
					disabled={droit.disabled === true || (enCours || !deplacementPossible(liste, champ.id, 'monter'))}
					aria-label={t('admin.action.up', { nom: champ.label })}
					onClick={() => onDeplacer('monter')}
				>
					<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button {...droit}
					taille="compacte"
					disabled={droit.disabled === true || (enCours || !deplacementPossible(liste, champ.id, 'descendre'))}
					aria-label={t('admin.action.down', { nom: champ.label })}
					onClick={() => onDeplacer('descendre')}
				>
					<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button {...droit}
					taille="compacte"
					disabled={droit.disabled === true || (enCours)}
					aria-label={t('admin.workflows.fields.action.edit', { nom: champ.label })}
					onClick={onOuvrirEdition}
				>
					<Pencil aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				{archive ? (
					<Button {...droit}
						taille="compacte"
						disabled={droit.disabled === true || (enCours)}
						aria-label={t('admin.workflows.fields.action.restore', { nom: champ.label })}
						onClick={onRestaurer}
					>
						<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} />
					</Button>
				) : (
					<Button {...droit}
						taille="compacte"
						disabled={droit.disabled === true || (enCours)}
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
