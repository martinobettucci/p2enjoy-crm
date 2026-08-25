// @spec CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire, TRANCHE 2 : la section « Coûts »
//       de la fiche d'affaire
// @spec docs/SPEC-costs.md §2.3 (ce qu'est une ligne, et « nul n'est pas zéro »), §3.2 (qui écrit),
//       §4.4 (la mention du réel inconnu), §4.6 (cette section), §4.7 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.3 (la colonne gauche de la fiche, et ce qu'elle accueille),
//       §5.9 (le patron de tableau), §5.5 (boutons), §5.7 (champs), §5.8 (états),
//       §8 (accessibilité), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// POURQUOI UN TABLEAU, ET NON UNE LISTE. Le §5.13 réserve la liste `ul`/`li` aux niveaux qui ne
// portent PAS les mêmes colonnes. Ici toutes les lignes sont des lignes de coût et portent
// exactement les mêmes attributs — nature, budget, occurrence, estimé, réel. C'est donc le §5.9 qui
// s'applique, comme pour la table des budgets de `CRM-084`, avec `th scope="row"` sur la nature.
//
// AUCUN DROIT N'EST CALCULÉ ICI, règle héritée de `AdministrationArborescence.tsx` et de
// `BlocBudgetsTrack.tsx` : les commandes sont rendues pour tout le monde, l'écriture part, et le
// refus du backend est traduit. Une commande masquée sur la foi d'un rôle lu au chargement cacherait
// un geste **permis** le jour où ce rôle a changé depuis.
//
// LA SEULE EXCEPTION EST LA LIGNE D'UN BUDGET CLÔTURÉ, ET ELLE N'EST PAS UN DROIT. Sa suppression et
// son changement de rattachement sont refusés par la base elle-même — politique et trigger de
// `0051` —, quel que soit l'appelant : ce n'est pas « qui vous êtes » mais « ce qu'est cet objet ».
// La commande est donc rendue DÉSACTIVÉE avec son motif, jamais masquée (§5.13), et sa modification
// reste ouverte parce que le §2.3 la veut ouverte : « on clôt une campagne PUIS les factures
// arrivent ».

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	calculerTotaux,
	creerLigneCout,
	libelleCoutConforme,
	lireBudgetsRattachables,
	lireCoutsCard,
	lireMontant,
	lireTrackDeLaCard,
	modifierLigneCout,
	supprimerLigneCout,
	type BudgetRattachable,
	type LigneCout,
	type RefusCout,
	type ResultatCout,
} from '../lib/card-costs'
import type { ClientCrm } from '../lib/supabase'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3'
const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'

/**
 * Les classes de la section — et `min-w-0` N'EST PAS DÉCORATIF, C'EST MESURÉ À 390 px.
 *
 * La section est un enfant flex de la colonne gauche de la fiche, et un enfant flex a
 * `min-width: auto` : sans cette classe, la section s'élargit pour contenir sa table, le conteneur
 * `overflow-x-auto` ne peut donc plus rétrécir, et c'est la PAGE ENTIÈRE qui défile horizontalement
 * — exactement ce que le §12.6 interdit. La colonne hôte porte déjà `min-w-0`, mais un parent ne le
 * transmet pas à ses enfants.
 */
const CLASSES_SECTION = 'flex flex-col gap-3 border-t border-border pt-4 min-w-0'

/**
 * Le conteneur de défilement de la table — et `[contain:paint]` N'EST PAS DÉCORATIF, C'EST MESURÉ.
 *
 * À 390 px, la largeur minimale intrinsèque de la table (541 px) dépasse celle de son conteneur
 * (326 px, imposée par la colonne de la fiche). MESURÉ dans Chromium : cette largeur **traverse**
 * l'`overflow-x: auto` du conteneur et remonte jusqu'à la racine —
 * `document.documentElement.scrollWidth` rend alors 664 pour 390 de viewport, et `window.scrollTo`
 * déplace réellement la page de **274 px** malgré l'`overflow-x: hidden` de `html`. Ce n'est donc
 * pas un artefact de mesure : c'est un défilement horizontal fantôme, celui que le §12.6 interdit,
 * et sur mobile la pression du doigt le rend atteignable.
 *
 * `contain: paint` dit ce que l'`overflow` promettait déjà — rien de ce qui est ici ne peint hors de
 * cette boîte —, et la propagation cesse. Les ombres de défilement de `indique-debordement-x` sont
 * des fonds du conteneur lui-même : elles ne sont pas affectées.
 *
 * La table des budgets de `CRM-084` n'a pas ce défaut pour une raison précise, et non par chance :
 * son conteneur n'est pas contraint — il fait la largeur de la table — et c'est `<main>` qui écrête.
 * Le cas n'apparaît que lorsqu'un conteneur PLUS ÉTROIT que la table doit la faire défiler.
 */
const CLASSES_CONTENEUR_TABLE = 'overflow-x-auto indique-debordement-x [contain:paint]'

/**
 * La table — SANS `min-w-max`, et c'est un ÉCART ASSUMÉ avec la table des budgets de `CRM-084`.
 *
 * Celle-ci vit dans une page pleine largeur ; la section des coûts vit dans la colonne gauche de la
 * fiche, plafonnée à `72ch` (docs/DESIGN_SYSTEM.md §5.3). OBSERVÉ sur la capture à 1440 : avec
 * `min-w-max`, la largeur intrinsèque de six colonnes dépasse celle de la colonne, et la commande de
 * suppression sort du cadre **dès le palier le plus large** — l'utilisateur doit faire défiler pour
 * atteindre un bouton, sur un écran qui n'a aucun problème de place.
 *
 * Sans cette classe, la table occupe la largeur disponible et n'en réclame pas davantage : elle
 * tient entière aux trois paliers larges, et ne défile qu'à 390 px, où le défilement est légitime et
 * signalé par les ombres du conteneur.
 */
const CLASSES_TABLE = 'w-full border-collapse'

/** Traduit un refus de ligne de coût en un texte destiné à l'utilisateur. */
export function texteRefusCout(refus: RefusCout): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('card.costs.refus.forbidden')
		case 'occurrence-exigee':
			return t('card.costs.refus.occurrence-exigee')
		case 'occurrence-interdite':
			return t('card.costs.refus.occurrence-interdite')
		case 'occurrence-etrangere':
			return t('card.costs.refus.occurrence-etrangere')
		case 'rattachement-clos':
			return t('card.costs.refus.rattachement-clos')
		case 'forme-refusee':
			return t('card.costs.refus.forme-refusee')
		case 'reference-absente':
			return t('card.costs.refus.reference-absente')
		case 'network':
			return t('card.costs.refus.network')
		case 'unknown':
			return t('card.costs.refus.unknown')
	}
}

/** Alerte de refus, placée **dans** le bloc concerné et non en tête d'écran (§5.13). */
function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="cout-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

/**
 * Un montant, tel que la table le rend.
 *
 * `toFixed(2)` et non le nombre brut : `estimated_cost` est un `numeric(14,2)`, et rendre `100` là
 * où la base porte `100.00` ferait lire deux formats différents dans la même colonne selon que le
 * réel a été saisi rond ou non. La devise n'est PAS accolée ici — elle est celle du budget, portée
 * par sa propre colonne (§2.3), et la répéter par ligne ferait croire qu'elle varie librement.
 */
const rendreMontant = (montant: number): string => montant.toFixed(2)

// ---------------------------------------------------------------------------------------------
// Le formulaire d'une ligne
// ---------------------------------------------------------------------------------------------

export type SaisieCout = {
	readonly idBudget: string
	readonly idOccurrence: string
	readonly libelle: string
	/** Saisies BRUTES : des champs texte, lus par `lireMontant`. */
	readonly estime: string
	readonly reel: string
}

/**
 * Le formulaire d'ajout et de modification.
 *
 * LE SECOND SÉLECTEUR N'EXISTE QUE SI LE BUDGET CHOISI EST RÉCURRENT (§4.6), et il devient alors
 * OBLIGATOIRE : c'est le trigger de `0051` qui le tient, et le formulaire ne fait que refuser de
 * partir avec un choix dont la réponse est connue d'avance. Il n'est pas rendu désactivé : un
 * sélecteur éteint dirait « il existe une occurrence, vous n'y avez pas droit », alors qu'un budget
 * simple n'en a AUCUNE par construction.
 *
 * L'OCCURRENCE EST OUBLIÉE QUAND LE BUDGET CHANGE, et c'est un défaut évité plutôt qu'un détail :
 * conservée, elle partirait avec un budget auquel elle n'appartient pas, et le trigger rendrait
 * « cette occurrence appartient à un autre budget » — un refus que l'utilisateur n'a pas provoqué.
 */
function FormulaireCout({
	titre,
	initial,
	creation,
	budgets,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly titre: string
	readonly initial: SaisieCout
	readonly creation: boolean
	readonly budgets: readonly BudgetRattachable[]
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieCout) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	const premier = useRef<HTMLInputElement>(null)

	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const budget = budgets.find((candidat) => candidat.id === saisie.idBudget) ?? null
	const occurrenceExigee = budget?.is_recurrent === true
	const estime = lireMontant(saisie.estime)
	const reel = lireMontant(saisie.reel)
	const complet =
		libelleCoutConforme(saisie.libelle) &&
		budget !== null &&
		// L'estimé est OBLIGATOIRE (§2.3) : `absent` n'est pas une issue acceptable pour ce champ-là,
		// à la différence du réel.
		estime.statut === 'lu' &&
		reel.statut !== 'invalide' &&
		(!occurrenceExigee || saisie.idOccurrence !== '')

	return (
		<form
			data-testid="formulaire-cout"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h4 className="font-medium">{titre}</h4>

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-libelle`} className="text-sm text-text-2">
					{t('card.costs.form.label')}
				</label>
				<input
					id={`${prefixe}-libelle`}
					ref={premier}
					value={saisie.libelle}
					aria-describedby={`${prefixe}-libelle-aide`}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, libelle: evenement.target.value }))
					}
					className={CLASSES_CHAMP}
				/>
				<span id={`${prefixe}-libelle-aide`} className="text-sm text-text-3">
					{t('card.costs.form.label.help')}
				</span>
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-budget`} className="text-sm text-text-2">
					{t('card.costs.form.budget')}
				</label>
				<select
					id={`${prefixe}-budget`}
					data-testid="cout-selecteur-budget"
					value={saisie.idBudget}
					onChange={(evenement) =>
						// L'occurrence est remise à vide EN MÊME TEMPS que le budget change : voir l'en-tête
						// du composant.
						setSaisie((precedente) => ({
							...precedente,
							idBudget: evenement.target.value,
							idOccurrence: '',
						}))
					}
					className={CLASSES_CHAMP}
				>
					<option value="">{t('card.costs.form.budget.none')}</option>
					{budgets.map((candidat) => (
						<option key={candidat.id} value={candidat.id}>
							{t('card.costs.form.budget.option', {
								nom: candidat.name,
								devise: candidat.currency,
							})}
						</option>
					))}
				</select>
			</div>

			{occurrenceExigee && budget !== null ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={`${prefixe}-occurrence`} className="text-sm text-text-2">
						{t('card.costs.form.occurrence')}
					</label>
					<select
						id={`${prefixe}-occurrence`}
						data-testid="cout-selecteur-occurrence"
						value={saisie.idOccurrence}
						aria-describedby={`${prefixe}-occurrence-aide`}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, idOccurrence: evenement.target.value }))
						}
						className={CLASSES_CHAMP}
					>
						<option value="">{t('card.costs.form.occurrence.none')}</option>
						{budget.occurrences.map((occurrence) => (
							<option key={occurrence.id} value={occurrence.id}>
								{occurrence.label}
							</option>
						))}
					</select>
					<span id={`${prefixe}-occurrence-aide`} className="text-sm text-text-3">
						{t('card.costs.form.occurrence.help')}
					</span>
				</div>
			) : null}

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-estime`} className="text-sm text-text-2">
					{t('card.costs.form.estimated')}
				</label>
				<input
					id={`${prefixe}-estime`}
					value={saisie.estime}
					// `inputMode` et non `type="number"` : un champ numérique natif laisse le navigateur
					// décider du séparateur décimal et **avale silencieusement** une saisie qu'il juge
					// invalide, si bien que `lireMontant` ne verrait jamais le cas `invalide` qu'elle existe
					// pour nommer. Même raison que l'enveloppe d'un budget.
					inputMode="decimal"
					aria-describedby={
						estime.statut === 'invalide' ? `${prefixe}-estime-erreur` : `${prefixe}-estime-aide`
					}
					aria-invalid={estime.statut === 'invalide' ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, estime: evenement.target.value }))
					}
					className={CLASSES_CHAMP}
				/>
				<span id={`${prefixe}-estime-aide`} className="text-sm text-text-3">
					{t('card.costs.form.estimated.help')}
				</span>
				{estime.statut === 'invalide' ? (
					<span id={`${prefixe}-estime-erreur`} role="alert" className="text-sm text-danger-on-soft">
						{t('card.costs.form.amount.invalid')}
					</span>
				) : null}
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-reel`} className="text-sm text-text-2">
					{t('card.costs.form.actual')}
				</label>
				<input
					id={`${prefixe}-reel`}
					data-testid="cout-champ-reel"
					value={saisie.reel}
					inputMode="decimal"
					aria-describedby={
						reel.statut === 'invalide' ? `${prefixe}-reel-erreur` : `${prefixe}-reel-aide`
					}
					aria-invalid={reel.statut === 'invalide' ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, reel: evenement.target.value }))
					}
					className={CLASSES_CHAMP}
				/>
				{/* LA DISTINCTION EST ÉCRITE, PAS SUPPOSÉE COMPRISE (§2.3, §4.8) : un champ vide laisse
				    le réel inconnu, un `0` saisi dit « rien dépensé ». C'est la seule façon dont
				    l'utilisateur peut savoir que les deux ne sont pas la même chose. */}
				<span id={`${prefixe}-reel-aide`} className="text-sm text-text-3">
					{t('card.costs.form.actual.help')}
				</span>
				{reel.statut === 'invalide' ? (
					<span id={`${prefixe}-reel-erreur`} role="alert" className="text-sm text-danger-on-soft">
						{t('card.costs.form.amount.invalid')}
					</span>
				) : null}
			</div>

			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{creation ? t('card.costs.action.add') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// La confirmation de suppression — dans le flux du document, jamais une modale (§5.13)
// ---------------------------------------------------------------------------------------------

function ConfirmationSuppression({
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
			data-testid="confirmation-suppression-cout"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('card.costs.delete.body')}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button ref={premier} variante="destructif" disabled={enCours} onClick={onConfirmer}>
					{t('card.costs.delete.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Les totaux — §4.4 et §4.6
// ---------------------------------------------------------------------------------------------

/**
 * Le pied de la section : estimé, réel, et ce que le réel ne dit pas.
 *
 * LA MENTION DU §4.4 N'EST PAS FACULTATIVE quand des réels manquent : « sans cette mention, un réel
 * bas se lirait comme une économie alors qu'il n'est qu'une saisie en retard — c'est la principale
 * façon dont un tel écran ment ». Elle est absente, et seulement absente, quand tous les réels sont
 * saisis.
 */
function TotauxCouts({ lignes }: { readonly lignes: readonly LigneCout[] }) {
	const totaux = calculerTotaux(lignes)
	return (
		<div data-testid="couts-totaux" className="flex flex-col gap-1 border-t border-border pt-3">
			{totaux.map((total) => (
				<div key={total.devise} className="flex flex-col gap-1">
					<p className="text-sm">
						{t('card.costs.total', {
							devise: total.devise,
							estime: rendreMontant(total.estime),
							reel: rendreMontant(total.reel),
						})}
					</p>
					{total.sansReel > 0 ? (
						<p data-testid="couts-sans-reel" className="text-sm text-text-2">
							{t('card.costs.pending', {
								nombre: String(total.sansReel),
								estime: rendreMontant(total.estimeSansReel),
								devise: total.devise,
							})}
						</p>
					) : null}
				</div>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// La section
// ---------------------------------------------------------------------------------------------

/** Ce qui est ouvert, et il n'y en a qu'un à la fois — même règle que la table des budgets. */
type OuvertureCout =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation' }
	| { readonly type: 'edition'; readonly id: string }
	| { readonly type: 'suppression'; readonly id: string }

const AUCUNE: OuvertureCout = { type: 'aucune' }

/**
 * La section « Coûts » de la fiche d'affaire — `docs/SPEC-costs.md` §4.6.
 *
 * TROIS LECTURES, ET ELLES SONT INDÉPENDANTES. Les lignes d'un côté ; le track de la card puis les
 * budgets rattachables de l'autre. Les secondes n'alimentent que le FORMULAIRE : les faire échouer
 * ensemble ferait disparaître la liste des lignes chaque fois qu'un budget ne se charge pas, alors
 * que lire ses dépenses et en ajouter une sont deux gestes distincts. C'est la leçon déjà tirée sur
 * `BlocBudgetsTrack`, où les budgets et le compte de leurs occurrences se chargent séparément.
 */
export function BlocCoutsCard({
	client,
	idCard,
	titreCard,
}: {
	/**
	 * Le client réel, ou `null` lorsque la configuration manque.
	 *
	 * `null` N'EST PAS UNE BRANCHE MORTE À IGNORER : `clientCrm` est nullable, et `AppShell` rend
	 * déjà l'écran de configuration manquante dans ce cas — cette section n'est donc pas atteignable
	 * en production avec un client nul. Elle ne rend rien plutôt que d'afficher une table vide et des
	 * commandes qui n'auraient nulle part où écrire (docs/DESIGN_SYSTEM.md §5.10), même règle que
	 * `BlocCorbeilleCard` sur la même fiche.
	 */
	readonly client: ClientCrm | null
	readonly idCard: string
	/** Nomme la section dans son étiquette accessible, comme le track nomme la table des budgets. */
	readonly titreCard: string
}) {
	const [lignes, setLignes] = useState<EtatAsync<readonly LigneCout[]>>(enChargement)
	const [budgets, setBudgets] = useState<EtatAsync<readonly BudgetRattachable[]>>(enChargement)
	const [ouverture, setOuverture] = useState<OuvertureCout>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [tentative, setTentative] = useState(0)
	const [annonce, setAnnonce] = useState<string | null>(null)

	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente.
	const courant = useRef(0)

	useEffect(() => {
		// La garde vit DANS l'effet et non avant lui : l'ordre des hooks ne dépend jamais de l'état
		// (React), et le rendu s'arrête plus bas sur la même condition.
		if (client === null) return
		const rang = ++courant.current
		setLignes(enChargement())
		setBudgets(enChargement())
		void (async () => {
			const lues = await lireCoutsCard(client, idCard)
			if (rang !== courant.current) return
			setLignes(lues)
		})()
		void (async () => {
			const track = await lireTrackDeLaCard(client, idCard)
			if (rang !== courant.current) return
			if (track.statut === 'erreur') {
				setBudgets(enErreur(track.erreur))
				return
			}
			// Une card sans track lisible n'a aucun budget à proposer, et ce n'est PAS une erreur :
			// c'est une liste vide, que l'état « aucun budget » du §4.7 rend déjà. `lireTrackDeLaCard`
			// ne rend jamais `chargement` — le repli couvre donc un état inatteignable, et le couvrir
			// par une liste vide vaut mieux que par une erreur qui mentirait sur sa cause.
			const idTrack = track.statut === 'pret' ? track.donnees : null
			if (idTrack === null) {
				setBudgets(pret([]))
				return
			}
			const rattachables = await lireBudgetsRattachables(client, idTrack)
			if (rang !== courant.current) return
			setBudgets(rattachables)
		})()
	}, [client, idCard, tentative])

	/** Ferme le formulaire, oublie le refus, et relit depuis le serveur. */
	const apres = useCallback((resultat: ResultatCout, message: string) => {
		if (resultat.statut === 'refus') {
			setRefus(texteRefusCout(resultat.refus))
			return
		}
		if (resultat.statut === 'sans-effet') {
			setRefus(t('card.costs.refus.sans-effet'))
			return
		}
		setRefus(null)
		setOuverture(AUCUNE)
		setAnnonce(message)
		setTentative((precedente) => precedente + 1)
	}, [])

	/** Enveloppe commune : une seule écriture à la fois, et l'état « en cours » ne fuit jamais. */
	const executer = useCallback(
		async (action: () => Promise<ResultatCout>, message: string) => {
			setEnCours(true)
			try {
				apres(await action(), message)
			} finally {
				setEnCours(false)
			}
		},
		[apres],
	)

	const listeBudgets = budgets.statut === 'pret' ? budgets.donnees : []

	// Voir la propriété `client` : sans configuration, l'application entière rend déjà l'écran de
	// configuration manquante, et une section sans client où écrire serait une section morte.
	if (client === null) return null

	return (
		<section
			data-testid="bloc-couts-card"
			aria-labelledby="couts-card-titre"
			className={CLASSES_SECTION}
		>
			<h2 id="couts-card-titre" className="text-h3 font-medium">
				{t('card.costs.title')}
			</h2>
			<p className="sr-only">{t('card.costs.aria', { titre: titreCard })}</p>

			{/* La région live annonce le résultat d'un geste sans voler le focus (§8). */}
			<p role="status" aria-live="polite" className="sr-only">
				{annonce ?? ''}
			</p>

			{/*
			 * Un refus qui n'appartient à AUCUN formulaire est affiché ici. Sans ce rendu, `setRefus`
			 * serait appelé, correct, et invisible (`CLAUDE.md` §18).
			 */}
			{refus !== null && ouverture.type === 'aucune' ? <AlerteRefus message={refus} /> : null}

			{lignes.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			) : null}

			{lignes.statut === 'erreur' ? (
				<p role="alert" data-testid="couts-erreur" className="text-sm text-danger-on-soft">
					{t('card.costs.error')}
				</p>
			) : null}

			{lignes.statut === 'pret' && lignes.donnees.length === 0 ? (
				<p data-testid="couts-vide" className="text-sm text-text-3">
					{t('card.costs.empty')}
				</p>
			) : null}

			{lignes.statut === 'pret' && lignes.donnees.length > 0 ? (
				// Même correctif de débordement que les autres tables du produit (§12.6) : conteneur
				// dédié plutôt que de s'en remettre à l'`overflow-x-auto` non indiqué de `<main>`.
				<div className={CLASSES_CONTENEUR_TABLE}>
					<table data-testid="tableau-couts" className={CLASSES_TABLE}>
						<caption className="sr-only">{t('card.costs.aria', { titre: titreCard })}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>
									{t('card.costs.column.label')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('card.costs.column.budget')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('card.costs.column.occurrence')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('card.costs.column.estimated')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('card.costs.column.actual')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('card.costs.column.actions')}
								</th>
							</tr>
						</thead>
						<tbody>
							{lignes.donnees.map((ligne) => {
								const clos = ligne.budgets?.closed_at != null
								const occurrenceClose = ligne.budget_occurrences?.closed_at != null
								// Le rattachement est FIGÉ dès qu'une de ses deux bornes est close (§2.3) :
								// c'est le trigger qui le tient, et l'écran n'offre donc pas un geste dont
								// le refus est certain. Il l'éteint AVEC SON MOTIF (§5.13), jamais en le
								// masquant.
								const rattachementFige = clos || occurrenceClose
								return (
									<tr
										key={ligne.id}
										data-testid="ligne-cout"
										className="border-b border-border last:border-b-0 hover:bg-hover"
									>
										<th scope="row" className={`${CLASSES_CELLULE} font-normal text-left`}>
											{ligne.label}
										</th>
										<td className={CLASSES_CELLULE}>
											<span className="flex items-center gap-2">
												{/* Le budget peut manquer si PostgREST n'a pas rendu la relation ;
												    l'écran le dit plutôt que d'afficher une cellule vide qui se
												    lirait comme « aucun budget », ce qui est impossible. */}
												<span>{ligne.budgets?.name ?? t('card.costs.budget.unknown')}</span>
												<code className="text-sm text-text-2">
													{ligne.budgets?.currency ?? ''}
												</code>
												{/* La pilule est un MOT, pas une teinte (§1) : un budget clôturé
												    seulement grisé se lirait comme une panne d'affichage. */}
												{clos ? (
													<span
														data-testid="cout-pilule-cloture"
														// `py-[2px]`, JAMAIS `py-0.5` : l'échelle du §3 est
														// CLOSE et ne porte pas de demi-pas — la classe n'était
														// pas engendrée, et la pilule rendait son rembourrage
														// par défaut (INC-204).
														className="rounded-sm bg-bg px-2 py-[2px] text-sm text-text-2"
													>
														{t('card.costs.budget.closed')}
													</span>
												) : null}
											</span>
										</td>
										{/* Cellule VIDE pour un budget simple : le §5.9 la réserve à une donnée
										    qui n'existe pas pour cette ligne, et c'est exactement le cas — un
										    budget non récurrent ne porte AUCUNE occurrence (§2.2). */}
										<td className={CLASSES_CELLULE}>{ligne.budget_occurrences?.label ?? null}</td>
										<td className={`${CLASSES_CELLULE} text-right whitespace-nowrap`}>
											{rendreMontant(ligne.estimated_cost)}
										</td>
										{/* LE RÉEL INCONNU N'EST PAS ZÉRO (§2.3) : la cellule porte un tiret cadratin
										    et son équivalent lisible, jamais « 0.00 » — qui dirait « rien
										    dépensé », c'est-à-dire une mesure que personne n'a faite. */}
										<td
											data-testid="cout-cellule-reel"
											className={`${CLASSES_CELLULE} text-right whitespace-nowrap`}
										>
											{ligne.actual_cost === null ? (
												<span title={t('card.costs.actual.unknown')}>
													<span aria-hidden="true">—</span>
													<span className="sr-only">{t('card.costs.actual.unknown')}</span>
												</span>
											) : (
												rendreMontant(ligne.actual_cost)
											)}
										</td>
										<td className={CLASSES_CELLULE}>
											<span className="flex items-center gap-1">
												<Button
													taille="compacte"
													variante="discret"
													onClick={() => {
														setRefus(null)
														setOuverture({ type: 'edition', id: ligne.id })
													}}
													aria-label={t('card.costs.action.edit', { nom: ligne.label })}
												>
													<Pencil aria-hidden="true" size={16} strokeWidth={2} />
												</Button>
												<Button
													taille="compacte"
													variante="discret"
													disabled={rattachementFige}
													title={rattachementFige ? t('card.costs.delete.closed') : undefined}
													onClick={() => {
														setRefus(null)
														setOuverture({ type: 'suppression', id: ligne.id })
													}}
													aria-label={t('card.costs.action.delete', { nom: ligne.label })}
												>
													<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
												</Button>
											</span>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			) : null}

			{lignes.statut === 'pret' && lignes.donnees.length > 0 ? (
				<TotauxCouts lignes={lignes.donnees} />
			) : null}

			{/*
			 * Les formulaires vivent SOUS la table et non dans une cellule : un `form` inséré dans un
			 * `tr` casserait le modèle de tableau, et un `td` qui s'étend sur six colonnes ferait sauter
			 * l'alignement que le §5.9 existe pour tenir.
			 */}
			{ouverture.type === 'edition' && lignes.statut === 'pret'
				? lignes.donnees
						.filter((ligne) => ligne.id === ouverture.id)
						.map((ligne) => (
							<FormulaireCout
								key={ligne.id}
								titre={t('card.costs.form.edit')}
								creation={false}
								budgets={budgetsPourEdition(listeBudgets, ligne)}
								initial={{
									idBudget: ligne.budget_id,
									idOccurrence: ligne.occurrence_id ?? '',
									libelle: ligne.label,
									estime: String(ligne.estimated_cost),
									reel: ligne.actual_cost === null ? '' : String(ligne.actual_cost),
								}}
								refus={refus}
								enCours={enCours}
								onAnnuler={() => {
									setRefus(null)
									setOuverture(AUCUNE)
								}}
								onValider={(saisie) => {
									const estime = lireMontant(saisie.estime)
									const reel = lireMontant(saisie.reel)
									if (estime.statut !== 'lu' || reel.statut === 'invalide') return
									void executer(
										() =>
											modifierLigneCout(client, ligne.id, {
												idBudget: saisie.idBudget,
												idOccurrence: saisie.idOccurrence === '' ? null : saisie.idOccurrence,
												libelle: saisie.libelle,
												estime: estime.montant,
												reel: reel.statut === 'absent' ? null : reel.montant,
											}),
										t('live.card.cost.updated'),
									)
								}}
							/>
						))
				: null}

			{ouverture.type === 'suppression' && lignes.statut === 'pret'
				? lignes.donnees
						.filter((ligne) => ligne.id === ouverture.id)
						.map((ligne) => (
							<ConfirmationSuppression
								key={ligne.id}
								question={t('card.costs.delete.confirm', { nom: ligne.label })}
								refus={refus}
								enCours={enCours}
								onAnnuler={() => {
									setRefus(null)
									setOuverture(AUCUNE)
								}}
								onConfirmer={() =>
									void executer(
										() => supprimerLigneCout(client, ligne.id),
										t('live.card.cost.deleted'),
									)
								}
							/>
						))
				: null}

			{ouverture.type === 'creation' ? (
				<FormulaireCout
					titre={t('card.costs.form.create')}
					creation
					budgets={listeBudgets}
					initial={{ idBudget: '', idOccurrence: '', libelle: '', estime: '', reel: '' }}
					refus={refus}
					enCours={enCours}
					onAnnuler={() => {
						setRefus(null)
						setOuverture(AUCUNE)
					}}
					onValider={(saisie) => {
						const estime = lireMontant(saisie.estime)
						const reel = lireMontant(saisie.reel)
						if (estime.statut !== 'lu' || reel.statut === 'invalide') return
						void executer(
							() =>
								creerLigneCout(client, idCard, {
									idBudget: saisie.idBudget,
									idOccurrence: saisie.idOccurrence === '' ? null : saisie.idOccurrence,
									libelle: saisie.libelle,
									estime: estime.montant,
									reel: reel.statut === 'absent' ? null : reel.montant,
								}),
							t('live.card.cost.created'),
						)
					}}
				/>
			) : (
				<div className="flex flex-col gap-2">
					{/*
					 * L'ÉTAT « AUCUN BUDGET » DU §4.7, dit AVANT la commande et non à sa place : la
					 * commande reste rendue, parce qu'aucun droit n'est calculé ici et qu'un budget peut
					 * avoir été ouvert depuis le chargement. La phrase explique ce que le formulaire
					 * proposera — rien — plutôt que de laisser découvrir un sélecteur vide.
					 */}
					{budgets.statut === 'pret' && budgets.donnees.length === 0 ? (
						<p data-testid="couts-aucun-budget" className="text-sm text-text-3">
							{t('card.costs.nobudget')}
						</p>
					) : null}
					{budgets.statut === 'erreur' ? (
						<p role="alert" data-testid="couts-budgets-erreur" className="text-sm text-danger-on-soft">
							{t('card.costs.budgets.error')}
						</p>
					) : null}
					<div>
						<Button
							taille="compacte"
							variante="secondaire"
							onClick={() => {
								setRefus(null)
								setOuverture({ type: 'creation' })
							}}
						>
							<Plus aria-hidden="true" size={16} strokeWidth={2} />
							{t('card.costs.action.new')}
						</Button>
					</div>
				</div>
			)}
		</section>
	)
}

/**
 * Les budgets proposés à la MODIFICATION d'une ligne existante.
 *
 * CE N'EST PAS LA MÊME LISTE QU'À LA CRÉATION, et l'écart est le point que la lecture rapide manque.
 * Le sélecteur ne propose que les budgets ouverts (§4.6) ; or une ligne peut vivre sur un budget
 * CLÔTURÉ depuis — le seed en pose une —, et sa modification reste permise, seul son rattachement
 * étant figé (§2.3). Sans son budget actuel dans la liste, le sélecteur retomberait sur « aucun
 * budget » et le formulaire refuserait de partir : l'utilisateur ne pourrait plus saisir le réel
 * d'une facture arrivée après la clôture, c'est-à-dire précisément le cas que le §2.3 protège.
 *
 * Le budget clos est donc ajouté, en tête et sans occurrence à choisir : le second sélecteur n'a
 * rien à proposer sur un budget clos, et l'occurrence déjà rattachée est réenvoyée telle quelle.
 */
export function budgetsPourEdition(
	ouverts: readonly BudgetRattachable[],
	ligne: LigneCout,
): readonly BudgetRattachable[] {
	if (ouverts.some((budget) => budget.id === ligne.budget_id)) return ouverts
	const actuel = ligne.budgets
	if (actuel === null) return ouverts
	return [
		{
			id: actuel.id,
			name: actuel.name,
			currency: actuel.currency,
			// `is_recurrent` est repris tel quel : rendu faux, le formulaire cesserait d'exiger
			// l'occurrence et enverrait `null` sur un budget récurrent, que le trigger refuserait.
			is_recurrent: actuel.is_recurrent,
			occurrences:
				ligne.budget_occurrences === null
					? []
					: [
							{
								id: ligne.budget_occurrences.id,
								label: ligne.budget_occurrences.label,
								closed_at: ligne.budget_occurrences.closed_at,
							},
						],
		},
		...ouverts,
	]
}
