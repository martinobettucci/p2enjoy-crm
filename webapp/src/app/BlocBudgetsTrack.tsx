// @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 2 : l'écran
//       d'administration des budgets d'un track
// @spec docs/SPEC-costs.md §2.1 (ce qu'est un budget), §3.2 (qui écrit), §4.1 (cette surface),
//       §4.7 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.9 (le patron de tableau), §5.13 (la surface qui l'accueille :
//       boutons discrets toujours visibles, commandes désactivées jamais masquées, formulaires et
//       confirmations dans le flux du document, focus entrant dans le premier champ, alerte de refus
//       dans le bloc concerné), §5.5 (boutons), §5.7 (champs), §5.8 (états), §8 (accessibilité),
//       §9 (icônes Lucide), §10 (aucun texte en dur)
//
// POURQUOI UN TABLEAU ICI, ALORS QUE L'ARBORESCENCE EST UNE LISTE IMBRIQUÉE. Le §5.13 réserve la
// liste `ul`/`li` au cas où les niveaux ne portent PAS les mêmes colonnes — un track a une couleur,
// un channel un workflow. Ici toutes les lignes sont des budgets et portent exactement les mêmes
// attributs : nom, devise, enveloppe, récurrence, occurrences, état. C'est donc le §5.9 qui
// s'applique, comme pour le tableau des comptes de `CRM-059`, et le §4.1 écrit d'ailleurs
// « Table des budgets du track ».
//
// AUCUN DROIT N'EST CALCULÉ ICI, règle héritée de `AdministrationArborescence.tsx` : les commandes
// sont rendues pour tout le monde, l'écriture part, et le refus du backend est traduit. Une commande
// masquée sur la foi d'un rôle lu au chargement cacherait un geste **permis** le jour où ce rôle a
// changé depuis.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Lock, LockOpen, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import { compterLignesSansReel } from '../lib/card-costs'
import { calculerDeplacement, type Ordonnable, type Sens } from '../lib/administration-arborescence'
import {
	cloturerBudget,
	compterOccurrencesOuvertes,
	creerBudget,
	deplacerBudget,
	deviseConforme,
	lireBudgetsAdministrables,
	lireEnveloppe,
	lireSeuilAnciennete,
	modifierBudget,
	nomBudgetConforme,
	type BudgetAdministrable,
	type RefusBudget,
	type ResultatBudget,
} from '../lib/budgets'
import { PanneauOccurrences } from './PanneauOccurrences'
import type { ClientCrm } from '../lib/supabase'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3'

/** Traduit un refus de budget en un texte destiné à l'utilisateur. */
export function texteRefusBudget(refus: RefusBudget): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.budgets.refus.forbidden')
		case 'nom-pris':
			return t('admin.budgets.refus.nom-pris')
		case 'forme-refusee':
			return t('admin.budgets.refus.forme-refusee')
		case 'recurrence-occupee':
			return t('admin.budgets.refus.recurrence-occupee')
		case 'reference-absente':
			return t('admin.budgets.refus.reference-absente')
		case 'network':
			return t('admin.budgets.refus.network')
		case 'unknown':
			return t('admin.budgets.refus.unknown')
	}
}

/** Alerte de refus, placée **dans** le bloc concerné et non en tête d'écran (§5.13). */
function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="budget-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

// ---------------------------------------------------------------------------------------------
// Formulaire d'un budget
// ---------------------------------------------------------------------------------------------

export type SaisieBudget = {
	readonly nom: string
	readonly devise: string
	/** Saisie BRUTE de l'enveloppe : un champ texte, lu par `lireEnveloppe`. */
	readonly enveloppe: string
	readonly recurrent: boolean
	/** Saisie BRUTE du seuil d'ancienneté, lue par `lireSeuilAnciennete` (§2.1 bis). */
	readonly seuil: string
}

function FormulaireBudget({
	titre,
	initial,
	creation,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly titre: string
	readonly initial: SaisieBudget
	readonly creation: boolean
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieBudget) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	const premier = useRef<HTMLInputElement>(null)

	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const deviseMalformee = saisie.devise !== '' && !deviseConforme(saisie.devise)
	const enveloppe = lireEnveloppe(saisie.enveloppe)
	const seuil = lireSeuilAnciennete(saisie.seuil)
	const complet =
		nomBudgetConforme(saisie.nom) &&
		deviseConforme(saisie.devise) &&
		enveloppe.statut !== 'invalide' &&
		seuil.statut !== 'invalide'

	return (
		<form
			data-testid="formulaire-budget"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h4 className="font-medium">{titre}</h4>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-nom`} className="text-sm text-text-2">
					{t('admin.budgets.form.name')}
				</label>
				<input
					id={`${prefixe}-nom`}
					ref={premier}
					value={saisie.nom}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, nom: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-devise`} className="text-sm text-text-2">
					{t('admin.budgets.form.currency')}
				</label>
				<input
					id={`${prefixe}-devise`}
					value={saisie.devise}
					aria-describedby={
						deviseMalformee ? `${prefixe}-devise-erreur` : `${prefixe}-devise-aide`
					}
					aria-invalid={deviseMalformee ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, devise: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
				<span id={`${prefixe}-devise-aide`} className="text-sm text-text-3">
					{t('admin.budgets.form.currency.help')}
				</span>
				{deviseMalformee ? (
					<span id={`${prefixe}-devise-erreur`} role="alert" className="text-sm text-danger-on-soft">
						{t('admin.budgets.form.currency.invalid')}
					</span>
				) : null}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-enveloppe`} className="text-sm text-text-2">
					{t('admin.budgets.form.planned')}
				</label>
				<input
					id={`${prefixe}-enveloppe`}
					value={saisie.enveloppe}
					// `inputMode` et non `type="number"` : un champ numérique natif laisse le navigateur
					// décider du séparateur décimal et **avale silencieusement** une saisie qu'il juge
					// invalide, si bien que `lireEnveloppe` ne verrait jamais le cas `invalide` qu'elle
					// existe pour nommer.
					inputMode="decimal"
					aria-describedby={
						enveloppe.statut === 'invalide'
							? `${prefixe}-enveloppe-erreur`
							: `${prefixe}-enveloppe-aide`
					}
					aria-invalid={enveloppe.statut === 'invalide' ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, enveloppe: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
				<span id={`${prefixe}-enveloppe-aide`} className="text-sm text-text-3">
					{t('admin.budgets.form.planned.help')}
				</span>
				{enveloppe.statut === 'invalide' ? (
					<span
						id={`${prefixe}-enveloppe-erreur`}
						role="alert"
						className="text-sm text-danger-on-soft"
					>
						{t('admin.budgets.form.planned.invalid')}
					</span>
				) : null}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-seuil`} className="text-sm text-text-2">
					{t('admin.budgets.form.stale')}
				</label>
				<input
					id={`${prefixe}-seuil`}
					value={saisie.seuil}
					// `inputMode` ET NON `type="number"`, POUR LA RAISON DÉJÀ MESURÉE SUR L'ENVELOPPE
					// juste au-dessus : un champ numérique natif avale silencieusement une saisie qu'il
					// juge invalide, si bien que `lireSeuilAnciennete` ne verrait jamais le cas
					// `invalide` qu'elle existe pour nommer — ni « 0 », ni « 2,5 ». La spécification
					// écrite avant le code annonçait `type="number" min="1"` ; elle est RÉVISÉE PAR
					// LIVRAISON sur ce point (§4.1), et le motif est celui de la ligne d'à côté.
					inputMode="numeric"
					aria-describedby={
						seuil.statut === 'invalide' ? `${prefixe}-seuil-erreur` : `${prefixe}-seuil-aide`
					}
					aria-invalid={seuil.statut === 'invalide' ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, seuil: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
				<span id={`${prefixe}-seuil-aide`} className="text-sm text-text-3">
					{t('admin.budgets.form.stale.help')}
				</span>
				{seuil.statut === 'invalide' ? (
					<span id={`${prefixe}-seuil-erreur`} role="alert" className="text-sm text-danger-on-soft">
						{t('admin.budgets.form.stale.invalid')}
					</span>
				) : null}
			</div>
			<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
				<input
					type="checkbox"
					checked={saisie.recurrent}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, recurrent: evenement.target.checked }))
					}
					className="size-6 rounded-sm border border-border"
				/>
				{t('admin.budgets.form.recurrent')}
			</label>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{creation ? t('admin.action.create') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Confirmation de clôture — dans le flux du document, jamais une modale (§5.13)
// ---------------------------------------------------------------------------------------------

/**
 * Confirmation de la clôture d'un budget.
 *
 * ELLE N'EMPÊCHE RIEN, et c'est le §4.1 : « la clôture n'est pas empêchée — c'est une décision de
 * gestion —, mais elle n'est pas silencieuse ». Le bouton de confirmation n'est donc jamais éteint
 * par ce qu'elle annonce.
 *
 * LE DÉCOMPTE EST DÉSORMAIS MESURÉ, ET C'ÉTAIT LE RESTE DE `CRM-084`. Le §4.1 demande que la
 * confirmation COMPTE les lignes sans coût réel — « ce budget porte n lignes sans coût réel ; elles
 * resteront saisissables après la clôture ». Ce compte se lit dans `card_costs`, table que
 * `CRM-085` tranche 1 a livrée ; jusque-là la confirmation disait que rien n'était à saisir, faute
 * de table à interroger. Elle interroge maintenant, et distingue TROIS états : en cours de mesure,
 * mesuré — zéro compris —, et non mesurable. Le troisième NOMME l'échec de la lecture plutôt que de
 * le taire sous un « 0 » qui serait un mensonge tranquille (`CLAUDE.md` §18).
 *
 * ELLE N'EMPÊCHE TOUJOURS RIEN, ET C'EST LA MOITIÉ DE LA RÈGLE : le bouton n'est éteint ni pendant
 * la mesure, ni par son résultat. Attendre le compte pour permettre la clôture ferait d'un avis une
 * autorisation, ce que le §4.1 refuse explicitement.
 */
function ConfirmationCloture({
	client,
	idBudget,
	question,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly client: ClientCrm
	readonly idBudget: string
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

	// Le décompte du §4.1, lu à l'OUVERTURE de la confirmation et pour ce budget seul. Il n'est pas
	// chargé avec la table : une table de dix budgets émettrait dix requêtes pour une phrase que
	// personne ne lit tant qu'il n'a pas demandé à clôturer.
	const [sansReel, setSansReel] = useState<EtatAsync<number>>(enChargement)
	useEffect(() => {
		let vivant = true
		void (async () => {
			const compte = await compterLignesSansReel(client, idBudget)
			if (vivant) setSansReel(compte)
		})()
		return () => {
			vivant = false
		}
	}, [client, idBudget])

	return (
		<div
			data-testid="confirmation-cloture-budget"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 max-w-[72ch]"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('admin.budgets.close.body')}</p>
			<p data-testid="cloture-sans-reel" className="text-sm text-text-2">
				{sansReel.statut === 'chargement'
					? t('admin.budgets.close.pending.loading')
					: sansReel.statut === 'erreur'
						? t('admin.budgets.close.pending.failed')
						: sansReel.donnees === 0
							? t('admin.budgets.close.pending.none')
							: t('admin.budgets.close.pending.some', { nombre: String(sansReel.donnees) })}
			</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button ref={premier} variante="destructif" disabled={enCours} onClick={onConfirmer}>
					{t('admin.budgets.close.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Le bloc
// ---------------------------------------------------------------------------------------------

/** Ce qui est ouvert, et il n'y en a qu'un à la fois — même règle que l'arborescence. */
type OuvertureBudget =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation' }
	| { readonly type: 'edition'; readonly id: string }
	| { readonly type: 'cloture'; readonly id: string }
	/**
	 * La sous-surface des occurrences du budget déplié (`docs/SPEC-costs.md` §4.1 bis).
	 *
	 * C'est un CINQUIÈME MEMBRE de cette union, et non un second état concurrent : le §5.47 exige
	 * qu'un seul élément soit ouvert à la fois dans ce bloc, occurrences comprises. Deux états
	 * parallèles laisseraient un formulaire de budget et une liste d'occurrences ouverts sur la même
	 * ligne, et le focus sauterait de l'un à l'autre sans que rien ne le dise.
	 */
	| { readonly type: 'occurrences'; readonly id: string }

const AUCUNE: OuvertureBudget = { type: 'aucune' }

export type ProprietesBlocBudgets = {
	readonly client: ClientCrm
	readonly idTrack: string
	readonly nomTrack: string
	/** Annonce un changement dans la région live de l'écran hôte (§8). */
	readonly onAnnonce: (message: string) => void
}

/**
 * La table des budgets d'un track, sous sa ligne dépliée.
 *
 * ELLE PORTE SON PROPRE ÉTAT, contrairement aux channels dont l'arborescence tient la liste : les
 * budgets n'ont aucun geste partagé avec les tracks et les channels — ni archivage, ni corbeille, ni
 * slug —, et les faire passer par l'union `Ouverture` de l'écran hôte y aurait ajouté quatre membres
 * dont aucune autre ligne n'a l'usage. Le bloc est monté au dépliage et démonté au repliage, donc
 * son état ne survit pas plus longtemps que celui qu'il remplacerait.
 */
export function BlocBudgetsTrack({ client, idTrack, nomTrack, onAnnonce }: ProprietesBlocBudgets) {
	const [inclureClotures, setInclureClotures] = useState(false)
	const [budgets, setBudgets] = useState<EtatAsync<readonly BudgetAdministrable[]>>(enChargement)
	const [occurrences, setOccurrences] = useState<EtatAsync<Readonly<Record<string, number>>>>(
		enChargement,
	)
	const [ouverture, setOuverture] = useState<OuvertureBudget>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [tentative, setTentative] = useState(0)

	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — l'interrupteur des clôturés change la
	// requête.
	const courant = useRef(0)

	/**
	 * Rafraîchissement du SEUL compte d'occurrences, sans relire la table des budgets.
	 *
	 * IL EST DISTINCT DE `tentative`, ET C'EST UN DÉFAUT ÉVITÉ PLUTÔT QU'UNE OPTIMISATION. Passer
	 * par `tentative` remettrait `budgets` en chargement, et la sous-surface des occurrences — qui
	 * n'est rendue que lorsque la table est prête — serait DÉMONTÉE à chaque écriture : la liste
	 * repartirait de zéro et le formulaire ouvert disparaîtrait sous les doigts. Le compte se relit
	 * donc seul.
	 */
	const [tentativeComptes, setTentativeComptes] = useState(0)
	const courantComptes = useRef(0)
	const budgetsCourants = useRef<readonly BudgetAdministrable[]>([])
	if (budgets.statut === 'pret') budgetsCourants.current = budgets.donnees

	useEffect(() => {
		// Le premier comptage appartient à l'effet principal, qui connaît déjà la liste qu'il vient
		// de lire ; celui-ci ne sert qu'aux rafraîchissements demandés par la sous-surface.
		if (tentativeComptes === 0) return
		const rang = ++courantComptes.current
		void (async () => {
			const recurrents = budgetsCourants.current
				.filter((budget) => budget.is_recurrent)
				.map((budget) => budget.id)
			const comptes = await compterOccurrencesOuvertes(client, recurrents)
			if (rang === courantComptes.current) setOccurrences(comptes)
		})()
	}, [client, tentativeComptes])

	useEffect(() => {
		const rang = ++courant.current
		setBudgets(enChargement())
		setOccurrences(enChargement())
		void (async () => {
			const lus = await lireBudgetsAdministrables(client, idTrack, inclureClotures)
			if (rang !== courant.current) return
			setBudgets(lus)
			if (lus.statut !== 'pret') return
			// Le compte des occurrences ne porte que sur les budgets RÉCURRENTS : un budget simple
			// n'en a aucune par construction (trigger de `0050`), et l'interroger pour lui ferait
			// transiter une question dont la réponse est écrite dans le schéma.
			const recurrents = lus.donnees.filter((budget) => budget.is_recurrent).map((b) => b.id)
			const comptes = await compterOccurrencesOuvertes(client, recurrents)
			if (rang !== courant.current) return
			setOccurrences(comptes)
		})()
	}, [client, idTrack, inclureClotures, tentative])

	/** Ferme le formulaire, oublie le refus, et relit depuis le serveur. */
	const apres = useCallback(
		(resultat: ResultatBudget, message: string) => {
			if (resultat.statut === 'refus') {
				setRefus(texteRefusBudget(resultat.refus))
				return
			}
			if (resultat.statut === 'sans-effet') {
				setRefus(t('admin.budgets.refus.sans-effet'))
				return
			}
			setRefus(null)
			setOuverture(AUCUNE)
			onAnnonce(message)
			setTentative((precedente) => precedente + 1)
		},
		[onAnnonce],
	)

	/** Enveloppe commune : une seule écriture à la fois, et l'état « en cours » ne fuit jamais. */
	const executer = useCallback(
		async (action: () => Promise<ResultatBudget>, message: string) => {
			setEnCours(true)
			try {
				apres(await action(), message)
			} finally {
				setEnCours(false)
			}
		},
		[apres],
	)

	const deplacer = useCallback(
		(liste: readonly Ordonnable[], id: string, sens: Sens) => {
			const calcul = calculerDeplacement(liste, id, sens)
			if (calcul.statut !== 'calcule') {
				// L'écran NOMME le refus au lieu d'écrire une valeur sans effet — même règle que le
				// réordonnancement de l'arborescence.
				setRefus(t('admin.move.impossible'))
				return
			}
			void executer(() => deplacerBudget(client, id, calcul.position), t('live.admin.budget.updated'))
		},
		[client, executer],
	)

	const rendreOccurrences = (budget: BudgetAdministrable) => {
		// Cellule VIDE pour un budget simple : le §5.9 la réserve à une donnée qui n'existe pas pour
		// cette ligne, et c'est exactement le cas — un budget non récurrent ne porte AUCUNE
		// occurrence, le trigger de `0050` le garantit. Écrire « 0 » y dirait « aucune occurrence
		// ouverte parmi les siennes », ce qui laisserait croire qu'il pourrait en avoir.
		if (!budget.is_recurrent) return null
		if (occurrences.statut === 'chargement') return t('admin.budgets.occurrences.loading')
		if (occurrences.statut === 'erreur') return t('admin.budgets.occurrences.failed')
		return String(occurrences.donnees[budget.id] ?? 0)
	}

	return (
		<section
			data-testid="bloc-budgets"
			aria-label={t('admin.budgets.aria', { track: nomTrack })}
			className="flex flex-col gap-2"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="font-medium">{t('admin.budgets.title')}</h4>
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						data-testid="budgets-afficher-clotures"
						checked={inclureClotures}
						onChange={(evenement) => setInclureClotures(evenement.target.checked)}
						className="size-6 rounded-sm border border-border"
					/>
					{t('admin.budgets.showClosed')}
				</label>
			</div>

			{/*
			 * Un refus qui n'appartient à AUCUN formulaire — celui d'un déplacement impossible, ou
			 * d'une écriture lancée depuis une ligne — est affiché ici. Sans ce rendu, `setRefus`
			 * serait appelé, correct, et invisible (`CLAUDE.md` §18).
			 */}
			{refus !== null && ouverture.type === 'aucune' ? <AlerteRefus message={refus} /> : null}

			{budgets.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			) : null}

			{budgets.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger-on-soft">
					{t('admin.budgets.error')}
				</p>
			) : null}

			{budgets.statut === 'pret' && budgets.donnees.length === 0 ? (
				<p data-testid="budgets-vide" className="text-sm text-text-3">
					{t('admin.budgets.empty')}
				</p>
			) : null}

			{budgets.statut === 'pret' && budgets.donnees.length > 0 ? (
				// Même correctif de débordement que les listes de l'arborescence (§12.6) : conteneur
				// dédié plutôt que de s'en remettre à l'`overflow-x-auto` non indiqué de `<main>`.
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-budgets" className="w-full border-collapse min-w-max">
						<caption className="sr-only">{t('admin.budgets.aria', { track: nomTrack })}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.budgets.column.name')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.budgets.column.currency')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('admin.budgets.column.planned')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.budgets.column.recurrent')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('admin.budgets.column.occurrences')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.budgets.column.state')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.budgets.column.actions')}
								</th>
							</tr>
						</thead>
						<tbody>
							{budgets.donnees.map((budget) => {
								const clos = budget.closed_at !== null
								const peutMonter = calculerDeplacement(budgets.donnees, budget.id, 'monter')
								const peutDescendre = calculerDeplacement(
									budgets.donnees,
									budget.id,
									'descendre',
								)
								return (
									<tr
										key={budget.id}
										data-testid="ligne-budget"
										className="border-b border-border last:border-b-0 hover:bg-hover"
									>
										<th scope="row" className={`${CLASSES_CELLULE} font-normal text-left`}>
											{budget.name}
										</th>
										<td className={CLASSES_CELLULE}>
											<code>{budget.currency}</code>
										</td>
										{/* Cellule VIDE lorsque l'enveloppe n'est pas décidée : elle est
										    facultative (§2.1), et un « 0 » y serait une décision que
										    personne n'a prise. */}
										<td className={`${CLASSES_CELLULE} text-right whitespace-nowrap`}>
											{budget.planned_amount === null ? null : String(budget.planned_amount)}
										</td>
										<td className={CLASSES_CELLULE}>
											{budget.is_recurrent
												? t('admin.budgets.recurrent.yes')
												: t('admin.budgets.recurrent.no')}
										</td>
										{/*
										 * La cellule qui COMPTE les occurrences est aussi celle qui les
										 * ouvre (§5.47) : c'est le geste le plus court, et il ne crée
										 * aucune notion nouvelle. Sur un budget NON RÉCURRENT elle reste
										 * un texte inerte — le trigger de `0050` refuse toute occurrence
										 * sur un tel budget, et offrir la commande mènerait à un refus
										 * garanti.
										 */}
										<td
											data-testid="cellule-occurrences"
											className={`${CLASSES_CELLULE} text-right`}
										>
											{budget.is_recurrent ? (
												<button
													type="button"
													data-testid="deplier-occurrences"
													aria-expanded={
														ouverture.type === 'occurrences' && ouverture.id === budget.id
													}
													aria-label={t('admin.occurrences.toggle', {
														nom: budget.name,
														nombre: rendreOccurrences(budget) ?? '',
													})}
													onClick={() => {
														setRefus(null)
														setOuverture((precedente) =>
															precedente.type === 'occurrences' &&
															precedente.id === budget.id
																? AUCUNE
																: { type: 'occurrences', id: budget.id },
														)
													}}
													className="min-h-[var(--size-target)] w-full text-right underline underline-offset-2 rounded-sm"
												>
													{rendreOccurrences(budget)}
												</button>
											) : (
												rendreOccurrences(budget)
											)}
										</td>
										{/* L'état est un MOT, pas une teinte (§1) : un budget clôturé grisé se
										    lirait comme une panne d'affichage. */}
										<td className={CLASSES_CELLULE}>
											{clos
												? t('admin.budgets.state.closed')
												: t('admin.budgets.state.open')}
										</td>
										<td className={CLASSES_CELLULE}>
											<span className="flex items-center gap-1">
												<Button
													taille="compacte"
													variante="discret"
													disabled={peutMonter.statut !== 'calcule'}
													onClick={() => deplacer(budgets.donnees, budget.id, 'monter')}
													aria-label={t('admin.action.up', { nom: budget.name })}
													title={
														peutMonter.statut === 'calcule'
															? undefined
															: peutMonter.cause === 'extremite'
																? t('admin.move.disabled.top')
																: t('admin.move.impossible')
													}
												>
													<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
												</Button>
												<Button
													taille="compacte"
													variante="discret"
													disabled={peutDescendre.statut !== 'calcule'}
													onClick={() =>
														deplacer(budgets.donnees, budget.id, 'descendre')
													}
													aria-label={t('admin.action.down', { nom: budget.name })}
													title={
														peutDescendre.statut === 'calcule'
															? undefined
															: peutDescendre.cause === 'extremite'
																? t('admin.move.disabled.bottom')
																: t('admin.move.impossible')
													}
												>
													<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
												</Button>
												<Button
													taille="compacte"
													variante="discret"
													onClick={() => {
														setRefus(null)
														setOuverture({ type: 'edition', id: budget.id })
													}}
													aria-label={t('admin.budgets.action.rename', {
														nom: budget.name,
													})}
												>
													<Pencil aria-hidden="true" size={16} strokeWidth={2} />
												</Button>
												{/*
												 * Clôturer et rouvrir sont DEUX ICÔNES DIFFÉRENTES, jamais
												 * la même retournée : le §5.13 a déjà tranché ce cas pour
												 * l'archivage, et une icône commune dirait que les deux
												 * états sont un seul geste à bascule silencieux. La
												 * réouverture, elle, n'a pas de confirmation — elle ne
												 * fige rien, et son seul refus possible (`23505`, nom
												 * repris) est traduit à sa réception.
												 */}
												{clos ? (
													<Button
														taille="compacte"
														variante="discret"
														onClick={() => {
															setRefus(null)
															void executer(
																() => cloturerBudget(client, budget.id, false),
																t('live.admin.budget.reopened'),
															)
														}}
														aria-label={t('admin.budgets.action.reopen', {
															nom: budget.name,
														})}
													>
														<LockOpen aria-hidden="true" size={16} strokeWidth={2} />
													</Button>
												) : (
													<Button
														taille="compacte"
														variante="discret"
														onClick={() => {
															setRefus(null)
															setOuverture({ type: 'cloture', id: budget.id })
														}}
														aria-label={t('admin.budgets.action.close', {
															nom: budget.name,
														})}
													>
														<Lock aria-hidden="true" size={16} strokeWidth={2} />
													</Button>
												)}
											</span>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			) : null}

			{/*
			 * La sous-surface des occurrences vit SOUS la table, comme les trois autres surfaces de ce
			 * bloc (`docs/DESIGN_SYSTEM.md` §5.47) : deux placements pour un même type de surface
			 * dans un même bloc feraient chercher au mauvais endroit. Elle nomme donc le budget dont
			 * elle parle, étant détachée de la ligne qui l'a ouverte.
			 */}
			{ouverture.type === 'occurrences' && budgets.statut === 'pret'
				? budgets.donnees
						.filter((budget) => budget.id === ouverture.id)
						.map((budget) => (
							<PanneauOccurrences
								key={budget.id}
								client={client}
								idBudget={budget.id}
								nomBudget={budget.name}
								onAnnonce={onAnnonce}
								// Ouvrir ou clôturer une occurrence change le nombre que la colonne du
								// §4.1 affiche. Sans cette relecture, l'écran dirait deux choses
								// contradictoires au même instant.
								onComptesPerimes={() => setTentativeComptes((precedente) => precedente + 1)}
							/>
						))
				: null}

			{/*
			 * Les formulaires vivent SOUS la table et non dans une cellule : un `form` inséré dans un
			 * `tr` casserait le modèle de tableau, et un `td` qui s'étend sur sept colonnes ferait
			 * sauter l'alignement que le §5.9 existe pour tenir.
			 */}
			{ouverture.type === 'edition'
				? budgets.statut === 'pret'
					? budgets.donnees
							.filter((budget) => budget.id === ouverture.id)
							.map((budget) => (
								<FormulaireBudget
									key={budget.id}
									titre={t('admin.budgets.form.edit')}
									creation={false}
									initial={{
										nom: budget.name,
										devise: budget.currency,
										enveloppe:
											budget.planned_amount === null ? '' : String(budget.planned_amount),
										recurrent: budget.is_recurrent,
										// LE CHAMP EST PRÉ-REMPLI AVEC LA VALEUR COURANTE, et le vide y
										// signifie « aucun seuil décidé » — jamais « ne touche pas ». Un
										// formulaire qui rouvrirait vide sur un seuil posé l'effacerait au
										// premier enregistrement, l'envoi portant TOUJOURS la colonne.
										seuil:
											budget.stale_after_days === null ? '' : String(budget.stale_after_days),
									}}
									refus={refus}
									enCours={enCours}
									onAnnuler={() => {
										setRefus(null)
										setOuverture(AUCUNE)
									}}
									onValider={(saisie) => {
										const enveloppe = lireEnveloppe(saisie.enveloppe)
										const seuil = lireSeuilAnciennete(saisie.seuil)
										if (enveloppe.statut === 'invalide' || seuil.statut === 'invalide') return
										void executer(
											() =>
												modifierBudget(client, budget.id, {
													nom: saisie.nom,
													devise: saisie.devise,
													enveloppe:
														enveloppe.statut === 'absente' ? null : enveloppe.montant,
													recurrent: saisie.recurrent,
													seuilAnciennete: seuil.statut === 'absent' ? null : seuil.jours,
												}),
											t('live.admin.budget.updated'),
										)
									}}
								/>
							))
					: null
				: null}

			{ouverture.type === 'cloture' && budgets.statut === 'pret'
				? budgets.donnees
						.filter((budget) => budget.id === ouverture.id)
						.map((budget) => (
							<ConfirmationCloture
								key={budget.id}
								client={client}
								idBudget={budget.id}
								question={t('admin.budgets.close.confirm', { nom: budget.name })}
								refus={refus}
								enCours={enCours}
								onAnnuler={() => {
									setRefus(null)
									setOuverture(AUCUNE)
								}}
								onConfirmer={() =>
									void executer(
										() => cloturerBudget(client, budget.id, true),
										t('live.admin.budget.closed'),
									)
								}
							/>
						))
				: null}

			{ouverture.type === 'creation' ? (
				<FormulaireBudget
					titre={t('admin.budgets.form.create')}
					creation
					initial={{ nom: '', devise: 'EUR', enveloppe: '', recurrent: false, seuil: '' }}
					refus={refus}
					enCours={enCours}
					onAnnuler={() => {
						setRefus(null)
						setOuverture(AUCUNE)
					}}
					onValider={(saisie) => {
						const enveloppe = lireEnveloppe(saisie.enveloppe)
						const seuil = lireSeuilAnciennete(saisie.seuil)
						if (enveloppe.statut === 'invalide' || seuil.statut === 'invalide') return
						void executer(
							() =>
								creerBudget(client, {
									idTrack,
									nom: saisie.nom,
									devise: saisie.devise,
									enveloppe: enveloppe.statut === 'absente' ? null : enveloppe.montant,
									recurrent: saisie.recurrent,
									seuilAnciennete: seuil.statut === 'absent' ? null : seuil.jours,
								}),
							t('live.admin.budget.created'),
						)
					}}
				/>
			) : (
				<Button
					taille="compacte"
					variante="secondaire"
					onClick={() => {
						setRefus(null)
						setOuverture({ type: 'creation' })
					}}
				>
					<Plus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.budgets.action.new')}
				</Button>
			)}
		</section>
	)
}
