// @spec CRM-037 (docs/BACKLOG.md) — rendu du formulaire conditionnel d'une card
// @spec docs/SPEC-form-composer.md §4.2 (trois destinations), §4.4 (champ exigé),
//       §4.5 (erreurs et accessibilité), §4.7 (aucune écriture)
// @spec docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §5.8 (états), §8 (accessibilité),
//       §9 (icônes Lucide), §10 (aucun texte en dur)
//
// Ce composant **ne compose rien** : il rend un `ModeleFormulaire` déjà résolu par
// `webapp/src/lib/formulaire.ts`. La séparation est ce qui rend la règle du §4.1 vérifiable sans
// navigateur, et ce qui empêche une règle de visibilité de se retrouver écrite dans du JSX.
//
// **Aucune écriture n'est possible** : le chemin d'enregistrement depuis la fiche n'est pas livré.
// Les contrôles sont donc rendus indisponibles, restent **lisibles**, et l'écran **dit pourquoi**
// — ce que docs/DESIGN_SYSTEM.md §8 exige d'un état désactivé. Un
// formulaire où l'on saisirait sans pouvoir enregistrer serait un piège ; un formulaire qui
// n'affiche rien serait une perte d'information (§4.7).

import { Info, TriangleAlert } from 'lucide-react'
import { t } from '../i18n'
import type { ChampResolu, ModeleFormulaire } from '../lib/formulaire'

/** Classes communes à tous les contrôles : 40 px de haut, bordure, focus `brand` (§5.7). */
const CLASSES_CONTROLE = [
	'w-full min-h-[var(--size-target)] px-3 py-2',
	'rounded-sm border border-border bg-surface text-base text-text',
	'disabled:bg-hover disabled:text-text-2 disabled:cursor-not-allowed',
].join(' ')

export type ProprietesFormulaireCard = {
	readonly modele: ModeleFormulaire
}

export function FormulaireCard({ modele }: ProprietesFormulaireCard) {
	return (
		<section aria-labelledby="formulaire-titre" data-testid="formulaire-card" className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<h2 id="formulaire-titre" className="text-h3">
					{t('form.title')}
				</h2>
				<p className="text-sm text-text-2">
					{t('form.step.prefix')} {modele.etape.label}
				</p>
			</header>

			<p
				data-testid="formulaire-lecture-seule"
				className="flex items-start gap-2 rounded-sm bg-brand-soft px-3 py-2 text-sm text-brand-on-soft"
			>
				<Info aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
				<span>{t('form.readonly')}</span>
			</p>

			{modele.champs.length === 0 ? (
				<p data-testid="formulaire-vide" className="text-sm text-text-2">
					{t('form.empty')}
				</p>
			) : (
				<div className="flex flex-col gap-4">
					{modele.champs.map((resolu) => (
						<ChampSaisie key={resolu.champ.id} resolu={resolu} etape={modele.etape.label} />
					))}
				</div>
			)}

			<SectionAutresEtapes champs={modele.autresEtapes} />
		</section>
	)
}

/**
 * Un champ du formulaire de l'étape.
 *
 * Les identifiants sont dérivés de la **clé** du champ, stable par workflow (§2.5) : le libellé
 * résout donc vers son contrôle, et `aria-describedby` vers l'aide et l'alerte, sans qu'aucun
 * identifiant ne soit tiré au hasard d'un rendu à l'autre.
 */
function ChampSaisie({ resolu, etape }: { readonly resolu: ChampResolu; readonly etape: string }) {
	const { champ, visibilite, manquant } = resolu
	const idControle = `champ-${champ.key}`
	const idAide = `${idControle}-aide`
	const idAlerte = `${idControle}-alerte`
	const decrit = [champ.help_text === null ? '' : idAide, manquant ? idAlerte : ''].filter(
		(identifiant) => identifiant !== '',
	)

	return (
		<div data-testid={`champ-${champ.key}`} className="flex flex-col gap-1">
			<label htmlFor={idControle} className="text-sm text-text-2">
				{champ.label}
				{visibilite === 'required' ? (
					<>
						{/* L'astérisque est décoratif : l'information qu'il porte est donnée en toutes
						    lettres juste après, faute de quoi elle reposerait sur un seul caractère
						    (docs/DESIGN_SYSTEM.md §8). */}
						<span aria-hidden="true" className="text-danger">
							{' *'}
						</span>
						<span className="sr-only">{` ${t('form.required.sr')}`}</span>
					</>
				) : null}
			</label>

			{visibilite === 'required' ? (
				<p data-testid={`requis-${champ.key}`} className="text-sm text-text-3">
					{t('form.required.reason')} {etape}
				</p>
			) : null}

			<Controle
				id={idControle}
				resolu={resolu}
				{...(decrit.length === 0 ? {} : { decritPar: decrit.join(' ') })}
			/>

			{champ.help_text === null ? null : (
				<p id={idAide} className="text-sm text-text-3">
					{champ.help_text}
				</p>
			)}

			{manquant ? (
				<p
					id={idAlerte}
					role="alert"
					data-testid={`alerte-${champ.key}`}
					className="flex items-center gap-1 text-sm text-danger-on-soft"
				>
					<TriangleAlert aria-hidden="true" size={14} strokeWidth={2} />
					<span>{t('form.missing')}</span>
				</p>
			) : null}
		</div>
	)
}

/**
 * Le contrôle lui-même, choisi d'après le type du champ (§2.3).
 *
 * Tous sont `disabled` : le §4.7 pose qu'aucune écriture n'est livrée. `defaultValue` et non
 * `value` : un contrôle désactivé ne changera pas, et React réclamerait un `onChange` pour un
 * `value` qu'aucun geste ne peut modifier.
 *
 * Les types que `CRM-036` ne résout pas — `user`, `contact`, `file` (INC-053) — tombent dans le
 * défaut et affichent leur valeur **brute** : afficher un nom que le produit ne sait pas obtenir
 * serait une invention.
 */
function Controle({
	id,
	resolu,
	decritPar,
}: {
	readonly id: string
	readonly resolu: ChampResolu
	readonly decritPar?: string
}) {
	const { champ, valeur, manquant } = resolu
	const commun = {
		id,
		disabled: true,
		'aria-invalid': manquant,
		...(decritPar === undefined ? {} : { 'aria-describedby': decritPar }),
	}

	if (champ.type === 'checkbox') {
		// La case occupe une ligne de hauteur `--size-target` : docs/DESIGN_SYSTEM.md §8 exige des
		// cibles interactives d'au moins 40 px, et une case de 16 px isolée n'en est pas une. La
		// case elle-même reste à 24 px — l'agrandir démesurément la ferait passer pour un champ —,
		// et son libellé lui sert de cible étendue par son `for` (§5.7 bis).
		return (
			<span className="flex items-center min-h-[var(--size-target)]">
				<input
					{...commun}
					type="checkbox"
					defaultChecked={valeur === true}
					className="size-6 rounded-sm border border-border disabled:cursor-not-allowed"
				/>
			</span>
		)
	}

	if (champ.type === 'textarea') {
		return (
			<textarea {...commun} rows={3} defaultValue={enTexte(valeur)} className={CLASSES_CONTROLE} />
		)
	}

	if (champ.type === 'select' || champ.type === 'multiselect') {
		return (
			<select
				{...commun}
				defaultValue={enTexte(valeur)}
				multiple={champ.type === 'multiselect'}
				className={CLASSES_CONTROLE}
			>
				{/* Une option vide en tête : sans elle, un `select` non renseigné afficherait le
				    premier choix comme s'il avait été choisi. */}
				<option value="">{t('form.select.none')}</option>
				{choix(champ.options).map((entree) => (
					<option key={entree.key} value={entree.key}>
						{entree.label}
					</option>
				))}
			</select>
		)
	}

	return (
		<input
			{...commun}
			type={typeHtml(champ.type)}
			defaultValue={enTexte(valeur)}
			className={CLASSES_CONTROLE}
		/>
	)
}

/** Section repliée « Informations d'autres étapes » (§4.2), en lecture seule. */
function SectionAutresEtapes({ champs }: { readonly champs: readonly ChampResolu[] }) {
	if (champs.length === 0) return null
	return (
		<details data-testid="autres-etapes" className="rounded-sm border border-border bg-surface">
			<summary className="min-h-[var(--size-target)] flex items-center px-3 py-2 text-sm text-text-2 cursor-pointer">
				{t('form.other.summary')}
			</summary>
			<dl className="flex flex-col gap-2 px-3 py-2">
				{champs.map((resolu) => (
					<div key={resolu.champ.id} data-testid={`autre-${resolu.champ.key}`} className="flex flex-col">
						<dt className="text-sm text-text-2">{resolu.champ.label}</dt>
						<dd className="text-base text-text">
							{/* Montants, dates et horodatages sont des **données techniques** : monospace
							    et chiffres tabulaires (docs/DESIGN_SYSTEM.md §2). La règle vit déjà dans
							    `app.css`, sur `code` : la porter par une classe la dupliquerait. */}
							{estTechnique(resolu.champ.type) ? (
								<code>{enTexte(resolu.valeur)}</code>
							) : (
								enTexte(resolu.valeur)
							)}
						</dd>
					</div>
				))}
			</dl>
		</details>
	)
}

/**
 * Le type HTML du contrôle, dérivé du type du champ (§2.3).
 *
 * `money` reste un `number` : la devise vit dans `options.currency` et n'a pas de type HTML.
 * Tout type inconnu du backend — la colonne est un `text`, et un type ne garantit jamais une
 * valeur (`docs/SPEC-types.md`) — se replie sur `text`, qui affiche la valeur telle quelle.
 */
function typeHtml(type: string): string {
	if (type === 'number' || type === 'money') return 'number'
	if (type === 'date') return 'date'
	if (type === 'datetime') return 'datetime-local'
	if (type === 'url') return 'url'
	if (type === 'email') return 'email'
	if (type === 'phone') return 'tel'
	return 'text'
}

/**
 * Les types dont la **valeur** est une donnée technique au sens de `docs/DESIGN_SYSTEM.md` §2 —
 * montants, dates, horodatages —, et qui se rendent donc en monospace à chiffres tabulaires.
 *
 * `url` en est absent : une adresse est lue, pas comparée colonne par colonne, et la monospace y
 * nuirait plus qu'elle n'aiderait.
 */
function estTechnique(type: string): boolean {
	return type === 'number' || type === 'money' || type === 'date' || type === 'datetime'
}

/**
 * Rendu textuel d'une valeur `jsonb`.
 *
 * Une chaîne est rendue telle quelle plutôt qu'entre guillemets : `JSON.stringify` produirait
 * `"Salon"` là où l'utilisateur a saisi `Salon`. Les autres formes passent par `JSON.stringify`,
 * qui est la seule représentation fidèle d'un objet ou d'un tableau.
 */
function enTexte(valeur: unknown): string {
	if (valeur === undefined || valeur === null) return ''
	if (typeof valeur === 'string') return valeur
	if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
	return JSON.stringify(valeur)
}

/**
 * Les choix d'un `select`, tels que `options.choices` les porte (§2.4).
 *
 * La base ne contraint **pas** la forme de chaque entrée — un `CHECK` ne peut porter aucune
 * sous-requête —, et le §2.4 confie cette vérification au rendu. Une entrée qui n'est pas un
 * objet portant `key` et `label` en chaînes est donc **écartée**, plutôt que rendue en `[object
 * Object]`.
 */
function choix(options: unknown): readonly { key: string; label: string }[] {
	if (typeof options !== 'object' || options === null) return []
	const brut = (options as { choices?: unknown }).choices
	if (!Array.isArray(brut)) return []
	const retenus: { key: string; label: string }[] = []
	for (const entree of brut) {
		if (typeof entree !== 'object' || entree === null) continue
		const { key, label } = entree as { key?: unknown; label?: unknown }
		if (typeof key === 'string' && typeof label === 'string') retenus.push({ key, label })
	}
	return retenus
}
