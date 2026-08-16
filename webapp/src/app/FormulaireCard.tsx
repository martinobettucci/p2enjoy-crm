// @spec CRM-037 (docs/BACKLOG.md) — rendu du formulaire conditionnel d'une card, et sa saisie
// @spec docs/SPEC-form-composer.md §4.2 (trois destinations), §4.4 (champ exigé),
//       §4.5 (erreurs et accessibilité), §4 bis.1 (ce que le geste est), §4 bis.2 (un champ, une
//       écriture), §4 bis.3 (le moment de l'écriture), §4 bis.4 (normalisation),
//       §4 bis.5 (vider), §4 bis.6 (les quatre états), §4 bis.7 (dictionnaire fermé des refus),
//       §4 bis.8 (mise à jour en place), §4 bis.9 (accessibilité)
// @spec docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §5.7 bis (case à cocher et valeurs en
//       lecture seule), §5.7 ter (champ qui s'enregistre pour lui-même), §5.8 (états),
//       §8 (accessibilité), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// Ce composant **ne compose rien** : il rend un `ModeleFormulaire` déjà résolu par
// `webapp/src/lib/formulaire.ts`. La séparation est ce qui rend la règle du §4.1 vérifiable sans
// navigateur, et ce qui empêche une règle de visibilité de se retrouver écrite dans du JSX.
//
// L'ÉCRITURE EST LIVRÉE DEPUIS LE 2026-08-16 — décision 334, INC-088. Le bandeau « Consultation
// seule » a disparu avec elle, comme le §4.7 l'annonçait. Il n'y a **aucun bouton d'enregistrement**
// : chaque champ écrit sa propre valeur dès qu'elle est arrêtée (§4 bis.2), ce qui est le seul moyen
// d'attribuer un refus au champ qui l'a causé — un lot est une transaction, et un champ invalide y
// ferait échouer tous les autres.
//
// Les champs de la **section repliée** restent en lecture seule : le §4.2 les y range précisément
// parce que l'étape courante ne les demande pas (§4 bis.1).
//
// LA REPRISE D'UN DÉPLACEMENT REFUSÉ EST LIVRÉE DEPUIS LE 2026-08-16 — §4 ter. Les champs que la
// garde a nommés arrivent par l'adresse, sont rendus SAISISSABLES même si leur règle les cache à
// l'étape courante (§4 ter.4), portent leur propre mention et leur liseré, et le premier prend le
// focus. Ce composant ne décide toujours rien : c'est `composerFormulaire` qui a résolu tout cela.

import { ArrowRightLeft, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type CleTraduction } from '../i18n'
import {
	appliquerEcriture,
	ecrireValeur,
	memeValeur,
	normaliserSaisie,
	type ChampResolu,
	type ModeleFormulaire,
	type NatureRefusValeur,
} from '../lib/formulaire'
import type { Json } from '../lib/database.types'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/** Classes communes à tous les contrôles : 40 px de haut, bordure, focus `brand` (§5.7). */
const CLASSES_CONTROLE = [
	'w-full min-h-[var(--size-target)] px-3 py-2',
	'rounded-sm border border-border bg-surface text-base text-text',
	'disabled:bg-hover disabled:text-text-2 disabled:cursor-not-allowed',
].join(' ')

/**
 * Les quatre messages de refus, indexés par la nature classée hors du JSX (§4 bis.7).
 *
 * DICTIONNAIRE FERMÉ, jamais le message du serveur : c'est la règle déjà tenue par les refus de
 * `CRM-075` et de `CRM-077`. Un texte d'API n'est pas un texte pour un humain, et le rendre tel quel
 * exposerait le détail de la pile à l'utilisateur (`CLAUDE.md` §20).
 */
const MESSAGES_REFUS_VALEUR: Readonly<Record<NatureRefusValeur, CleTraduction>> = {
	invalid: 'form.save.refus.invalid',
	forbidden: 'form.save.refus.forbidden',
	network: 'form.save.refus.network',
	unknown: 'form.save.refus.unknown',
}

/**
 * Le bloc d'un champ exigé par le déplacement demandé — docs/DESIGN_SYSTEM.md §5.7 quater.
 *
 * `--color-brand` et non `--color-danger` : le champ est **demandé**, il n'est pas **fautif**. La
 * teinte de danger appartient à l'erreur de saisie (§5.7) et au refus d'écriture (§5.7 ter) ;
 * l'employer ici dirait que la valeur est mauvaise là où elle est seulement absente.
 */
const CLASSES_EXIGE = 'border-l-[3px] border-brand bg-surface rounded-sm p-3'

/** Les quatre états d'un champ du §4 bis.6. */
type EtatEcriture =
	| { readonly phase: 'inactif' }
	| { readonly phase: 'envoi' }
	| { readonly phase: 'enregistre' }
	| { readonly phase: 'refus'; readonly nature: NatureRefusValeur }

const INACTIF: EtatEcriture = { phase: 'inactif' }

// Les deux graduations de la mention d'état (docs/DESIGN_SYSTEM.md §5.7 ter), nommées HORS du JSX.
// Le contrôle de classes du harnais relève les chaînes citées dans un attribut `className` : une
// condition écrite là y ferait passer une valeur de phase pour une classe absente du CSS produit.
const CLASSES_ETAT_ENVOI = 'text-sm text-text-3'
const CLASSES_ETAT_CONFIRME = 'flex items-center gap-1 text-sm text-success' 

export type ProprietesFormulaireCard = {
	readonly modele: ModeleFormulaire
	readonly idCard: string
	readonly idWorkflow: string
	readonly idWorkspace: string
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

export function FormulaireCard({
	modele: modeleCharge,
	idCard,
	idWorkflow,
	idWorkspace,
	client = clientCrm,
}: ProprietesFormulaireCard) {
	// Le modèle vit ici pendant la visite : une écriture confirmée le met à jour **en place**
	// (§4 bis.8), sans rejouer les cinq requêtes du chargement ni faire clignoter la colonne. Il est
	// resynchronisé dès que la fiche recharge — c'est alors la base qui a raison, pas l'écran.
	const [modele, setModele] = useState(modeleCharge)
	useEffect(() => setModele(modeleCharge), [modeleCharge])

	const [etats, setEtats] = useState<Readonly<Record<string, EtatEcriture>>>({})

	// LE DÉFILEMENT ET LE FOCUS DU §4 ter.6, et ils ne se produisent QU'UNE FOIS PAR DEMANDE.
	//
	// La signature est la liste des clés RETENUES : deux adresses qui désignent les mêmes champs
	// existants sont la même demande, et une clé inconnue ne doit pas rejouer le geste (§4 ter.7).
	// Sans ce garde-fou, chaque rendu — donc chaque frappe enregistrée — reprendrait le focus à
	// celui qui saisit.
	const demandeHonoree = useRef<string | null>(null)
	const signature = modele.clesExigeesRetenues.join(',')
	useEffect(() => {
		if (signature === '') return
		if (demandeHonoree.current === signature) return
		demandeHonoree.current = signature
		const premiere = modele.clesExigeesRetenues[0]
		if (premiere === undefined) return
		const controle = document.getElementById(`champ-${premiere}`)
		if (controle === null) return
		// Le focus AVANT le défilement : le §4 ter.6 pose que faire défiler sans déplacer le focus
		// laisserait l'utilisateur au clavier en tête de page. Le navigateur amène déjà l'élément
		// focalisé à l'écran ; le défilement explicite ne fait que le CENTRER, ce qui montre le
		// libellé et la mention au-dessus du contrôle plutôt que le contrôle seul en bord de fenêtre.
		controle.focus()
		// `prefers-reduced-motion` respecté (docs/DESIGN_SYSTEM.md §6). `matchMedia` peut manquer
		// hors navigateur : son absence vaut « aucune préférence », jamais une erreur.
		const sobre = typeof window.matchMedia === 'function'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false
		// GARDE DE CAPACITÉ, ET NON MASQUAGE D'ERREUR (CLAUDE.md §18) : `scrollIntoView` n'est pas
		// implémentée par jsdom, où les preuves de composant s'exécutent — MESURÉ, son appel y lève.
		// Le focus posé juste au-dessus amène DÉJÀ l'élément à l'écran dans un vrai navigateur ; ce
		// que cette ligne ajoute est le CENTRAGE, et son absence en test ne cache aucun défaut du
		// produit. Le défilement réel est éprouvé par `e2e/ui/formulaire.spec.ts`, sur Chromium.
		if (typeof controle.scrollIntoView === 'function') {
			controle.scrollIntoView({ block: 'center', behavior: sobre ? 'auto' : 'smooth' })
		}
	}, [signature, modele.clesExigeesRetenues])

	const enregistrer = useCallback(
		async (resolu: ChampResolu, valeur: Json) => {
			if (client === null) return
			const id = resolu.champ.id
			setEtats((precedents) => ({ ...precedents, [id]: { phase: 'envoi' } }))
			const resultat = await ecrireValeur(client, {
				idCard,
				idChamp: id,
				idWorkflow,
				idWorkspace,
				valeur,
			})
			if (resultat.statut === 'enregistree') {
				setModele((precedent) => appliquerEcriture(precedent, id, valeur))
				setEtats((precedents) => ({ ...precedents, [id]: { phase: 'enregistre' } }))
				return
			}
			setEtats((precedents) => ({
				...precedents,
				[id]: { phase: 'refus', nature: resultat.refus.nature },
			}))
		},
		[client, idCard, idWorkflow, idWorkspace],
	)

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

			{modele.champs.length === 0 ? (
				<p data-testid="formulaire-vide" className="text-sm text-text-2">
					{t('form.empty')}
				</p>
			) : (
				<div className="flex flex-col gap-4">
					{modele.champs.map((resolu) => (
						<ChampSaisie
							key={resolu.champ.id}
							resolu={resolu}
							etape={modele.etape.label}
							etat={etats[resolu.champ.id] ?? INACTIF}
							ecrituresPossibles={client !== null}
							onEnregistrer={enregistrer}
						/>
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
 * résout donc vers son contrôle, et `aria-describedby` vers l'aide, l'alerte d'exigence, l'état
 * d'écriture et le refus, sans qu'aucun identifiant ne soit tiré au hasard d'un rendu à l'autre.
 *
 * LA SAISIE VIT ICI, PAS DANS LE MODÈLE. Un refus laisse la saisie à l'écran avec son explication
 * (§4 bis.6) : la rejeter effacerait un travail sans le dire, ce que `CLAUDE.md` §18 interdit. La
 * valeur **connue de la base** ne bouge, elle, que sur confirmation du serveur.
 */
function ChampSaisie({
	resolu,
	etape,
	etat,
	ecrituresPossibles,
	onEnregistrer,
}: {
	readonly resolu: ChampResolu
	readonly etape: string
	readonly etat: EtatEcriture
	readonly ecrituresPossibles: boolean
	readonly onEnregistrer: (resolu: ChampResolu, valeur: Json) => Promise<void>
}) {
	const { champ, visibilite, manquant, exigeParDeplacement } = resolu
	const idControle = `champ-${champ.key}`
	const idAide = `${idControle}-aide`
	const idAlerte = `${idControle}-alerte`
	const idEtat = `${idControle}-etat`
	const idRefus = `${idControle}-refus`
	const idExige = `${idControle}-exige`

	const enRefus = etat.phase === 'refus'
	const confirme = etat.phase === 'enregistre'
	const annonce = etat.phase === 'envoi' || confirme
	const decrit = [
		champ.help_text === null ? '' : idAide,
		exigeParDeplacement ? idExige : '',
		manquant ? idAlerte : '',
		annonce ? idEtat : '',
		enRefus ? idRefus : '',
	].filter((identifiant) => identifiant !== '')

	// Une écriture n'est émise que si la valeur a **changé** (§4 bis.3) : reprendre le focus sans
	// rien modifier ne doit produire ni requête, ni événement de fil.
	const proposer = useCallback(
		(saisie: string | boolean | readonly string[]) => {
			const valeur = normaliserSaisie(champ.type, saisie)
			if (memeValeur(resolu.valeur, valeur)) return
			void onEnregistrer(resolu, valeur)
		},
		[champ.type, onEnregistrer, resolu],
	)

	return (
		<div
			data-testid={`champ-${champ.key}`}
			{...(exigeParDeplacement ? { 'data-exige': 'true' } : {})}
			className={['flex flex-col gap-1', exigeParDeplacement ? CLASSES_EXIGE : ''].join(' ').trim()}
		>
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

			{/* La mention du §4 ter.5. Elle S'AJOUTE à celle du §4.4 plutôt que de la remplacer : un
			    champ peut être obligatoire à l'étape courante ET exigé par le déplacement demandé,
			    et les deux phrases sont vraies — c'est le précédent du §4 bis.9. L'étape de
			    DESTINATION n'est pas nommée : l'adresse ne la porte pas (§4 ter.9). */}
			{exigeParDeplacement ? (
				<p
					id={idExige}
					data-testid={`exige-${champ.key}`}
					className="flex items-center gap-1 text-sm text-brand"
				>
					<ArrowRightLeft aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
					<span>{t('form.demanded')}</span>
				</p>
			) : null}

			<Controle
				id={idControle}
				resolu={resolu}
				invalide={manquant || enRefus}
				ecrituresPossibles={ecrituresPossibles}
				onProposer={proposer}
				{...(decrit.length === 0 ? {} : { decritPar: decrit.join(' ') })}
			/>

			{champ.help_text === null ? null : (
				<p id={idAide} className="text-sm text-text-3">
					{champ.help_text}
				</p>
			)}

			{/* L'état d'écriture se lit SOUS le champ, à la place du texte d'aide
			    (docs/DESIGN_SYSTEM.md §5.7 ter) : un état d'enregistrement se lit près de ce qu'il
			    concerne. La confirmation REMPLACE l'envoi, elle ne s'y ajoute pas. */}
			{annonce ? (
				<p
					id={idEtat}
					role="status"
					data-testid={`etat-${champ.key}`}
					className={confirme ? CLASSES_ETAT_CONFIRME : CLASSES_ETAT_ENVOI}
				>
					{confirme ? (
						<>
							<CircleCheck aria-hidden="true" size={14} strokeWidth={2} />
							<span>{t('form.save.saved')}</span>
						</>
					) : (
						t('form.save.saving')
					)}
				</p>
			) : null}

			{/* L'alerte de valeur manquante et celle du refus COEXISTENT (§4 bis.9) : elles disent deux
			    choses différentes, et `aria-describedby` cite les deux. */}
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

			{enRefus ? (
				<p
					id={idRefus}
					role="alert"
					data-testid={`refus-${champ.key}`}
					className="flex items-center gap-1 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					<TriangleAlert aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
					<span>{t(MESSAGES_REFUS_VALEUR[etat.nature])}</span>
				</p>
			) : null}
		</div>
	)
}

/**
 * Le contrôle lui-même, choisi d'après le type du champ (§2.3).
 *
 * LE CONTRÔLE N'EST JAMAIS DÉSACTIVÉ PENDANT L'ENVOI (§4 bis.6) : un contrôle désactivé perd le
 * focus du clavier, ce que `docs/DESIGN_SYSTEM.md` §5.13 interdit, et l'`upsert` rend toute écriture
 * suivante indifférente à l'état de la précédente. Il ne l'est pas davantage selon le rôle : la
 * règle vit dans la politique RLS, et une interface qui déciderait à sa place ferait passer une
 * décision de la base pour une décision d'écran (`CLAUDE.md` §10, §4 bis.7).
 *
 * Le seul cas désactivé est l'**absence de client configuré**, où il n'existe aucune destination
 * pour l'écriture ; l'application entière rend alors déjà l'écran de configuration manquante.
 *
 * Les types que `CRM-036` ne résout pas — `user`, `contact`, `file` (INC-053) — tombent dans le
 * défaut et se saisissent en texte brut : afficher un nom que le produit ne sait pas obtenir serait
 * une invention.
 */
function Controle({
	id,
	resolu,
	invalide,
	ecrituresPossibles,
	onProposer,
	decritPar,
}: {
	readonly id: string
	readonly resolu: ChampResolu
	readonly invalide: boolean
	readonly ecrituresPossibles: boolean
	readonly onProposer: (saisie: string | boolean | readonly string[]) => void
	readonly decritPar?: string
}) {
	const { champ, valeur } = resolu
	const commun = {
		id,
		disabled: !ecrituresPossibles,
		'aria-invalid': invalide,
		...(decritPar === undefined ? {} : { 'aria-describedby': decritPar }),
	}

	if (champ.type === 'checkbox') {
		// La case occupe une ligne de hauteur `--size-target` : docs/DESIGN_SYSTEM.md §8 exige des
		// cibles interactives d'au moins 40 px, et une case de 16 px isolée n'en est pas une. La
		// case elle-même reste à 24 px — l'agrandir la ferait passer pour un champ —, et son libellé
		// lui sert de cible étendue par son `for` (§5.7 bis).
		//
		// L'écriture part au CHANGEMENT : une case n'a pas d'état intermédiaire (§4 bis.3).
		return (
			<span className="flex items-center min-h-[var(--size-target)]">
				<input
					{...commun}
					type="checkbox"
					defaultChecked={valeur === true}
					onChange={(evenement) => onProposer(evenement.currentTarget.checked)}
					className="size-6 rounded-sm border border-border disabled:cursor-not-allowed"
				/>
			</span>
		)
	}

	if (champ.type === 'textarea') {
		return (
			<textarea
				{...commun}
				rows={3}
				defaultValue={enTexte(valeur)}
				onBlur={(evenement) => onProposer(evenement.currentTarget.value)}
				className={CLASSES_CONTROLE}
			/>
		)
	}

	if (champ.type === 'select' || champ.type === 'multiselect') {
		const multiple = champ.type === 'multiselect'
		return (
			<select
				{...commun}
				defaultValue={multiple ? cles(valeur) : enTexte(valeur)}
				multiple={multiple}
				onChange={(evenement) =>
					onProposer(
						multiple
							? [...evenement.currentTarget.selectedOptions].map((option) => option.value)
							: evenement.currentTarget.value,
					)
				}
				className={CLASSES_CONTROLE}
			>
				{/* Une option vide en tête : sans elle, un `select` non renseigné afficherait le
				    premier choix comme s'il avait été choisi. Elle est aussi le moyen de **vider**
				    un champ à choix (§4 bis.5). Une liste multiple n'en a pas besoin : y ne rien
				    retenir suffit, et une option vide y serait une valeur de plus à décocher. */}
				{multiple ? null : <option value="">{t('form.select.none')}</option>}
				{choix(champ.options).map((entree) => (
					<option key={entree.key} value={entree.key}>
						{entree.label}
					</option>
				))}
			</select>
		)
	}

	// L'écriture part à la PERTE DU FOCUS (§4 bis.3) : écrire à chaque caractère produirait une
	// requête par touche, donc un événement `field_changed` par touche dans le fil de `CRM-044`.
	return (
		<input
			{...commun}
			type={typeHtml(champ.type)}
			defaultValue={enTexte(valeur)}
			onBlur={(evenement) => onProposer(evenement.currentTarget.value)}
			className={CLASSES_CONTROLE}
		/>
	)
}

/** Section repliée « Informations d'autres étapes » (§4.2), en lecture seule (§4 bis.1). */
function SectionAutresEtapes({ champs }: { readonly champs: readonly ChampResolu[] }) {
	if (champs.length === 0) return null
	return (
		<details data-testid="autres-etapes" className="rounded-sm border border-border bg-surface">
			<summary className="min-h-[var(--size-target)] flex items-center px-3 py-2 text-sm text-text-2 cursor-pointer">
				{t('form.other.summary')}
			</summary>
			<p className="flex items-start gap-2 px-3 pt-2 text-sm text-text-3">
				<Info aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
				<span>{t('form.other.readonly')}</span>
			</p>
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
 * Les clés retenues par une liste multiple, telles que `defaultValue` les attend.
 *
 * Une valeur qui ne serait pas un tableau de chaînes ne retient rien : le §2.4 confie au rendu la
 * vérification que la base ne peut pas porter, et une clé qui n'est pas une chaîne ne désigne aucune
 * option.
 */
function cles(valeur: unknown): readonly string[] {
	if (!Array.isArray(valeur)) return []
	return valeur.filter((entree): entree is string => typeof entree === 'string')
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
