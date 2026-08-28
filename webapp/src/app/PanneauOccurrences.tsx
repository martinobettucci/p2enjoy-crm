// @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3c : la sous-surface
//       de gestion des occurrences d'un budget récurrent
// @spec docs/SPEC-costs.md §2.2 (ce qu'est une occurrence), §3.2 (qui écrit), §4.1 bis (cette
//       sous-surface : ce qu'elle montre, les cinq gestes, ce que l'écriture envoie, le dictionnaire
//       fermé des refus, et les mesures qui la décident)
// @spec docs/DESIGN_SYSTEM.md §5.47 (la forme de cette sous-surface), §5.13 (le bloc qui
//       l'accueille : boutons discrets toujours visibles, formulaires et confirmations dans le flux
//       du document, focus entrant dans le premier champ, alerte de refus dans le bloc concerné),
//       §5.9 (hauteurs et séparateurs), §5.7 (champs), §5.8 (états), §8 (accessibilité),
//       §9 (icônes Lucide), §10 (aucun texte en dur)
//
// POURQUOI UNE LISTE `ul`/`li` ICI, ALORS QUE LES BUDGETS SONT UN TABLEAU. Le §5.47 le pose, et le
// §5.13 le motive : imbriquer une table dans la surface d'une autre donnerait deux grilles de
// colonnes désalignées, que l'œil lit comme un défaut de rendu.
//
// AUCUN DROIT N'EST CALCULÉ ICI, règle héritée du bloc hôte : les commandes sont rendues pour tout
// le monde, l'écriture part, et le refus du backend est traduit. Une commande masquée sur la foi
// d'un rôle lu au chargement cacherait un geste **permis** le jour où ce rôle a changé depuis
// (`CLAUDE.md` §10).

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Lock, LockOpen, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	cloturerOccurrence,
	creerOccurrence,
	libelleOccurrenceConforme,
	lireBornePeriode,
	lireEnveloppeOccurrence,
	lireOccurrences,
	modifierOccurrence,
	retirerOccurrence,
	type OccurrenceAdministrable,
	type RefusOccurrence,
	type ResultatOccurrence,
} from '../lib/occurrences'
import type { ClientCrm } from '../lib/supabase'

/** Traduit un refus d'occurrence en un texte destiné à l'utilisateur — dictionnaire du §4.1 bis.4. */
export function texteRefusOccurrence(refus: RefusOccurrence): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.occurrences.refus.forbidden')
		case 'libelle-pris':
			return t('admin.occurrences.refus.libelle-pris')
		case 'libelle-vide':
			return t('admin.occurrences.refus.libelle-vide')
		case 'budget-non-recurrent':
			return t('admin.occurrences.refus.budget-non-recurrent')
		case 'occurrence-referencee':
			return t('admin.occurrences.refus.occurrence-referencee')
		case 'reference-absente':
			return t('admin.occurrences.refus.reference-absente')
		case 'network':
			return t('admin.occurrences.refus.network')
		case 'unknown':
			return t('admin.occurrences.refus.unknown')
	}
}

/** Alerte de refus, placée **dans** la surface concernée et non en tête de bloc (§5.13). */
function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="occurrence-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

// ---------------------------------------------------------------------------------------------
// Formulaire d'une occurrence
// ---------------------------------------------------------------------------------------------

export type SaisieOccurrence = {
	readonly libelle: string
	/** Saisies BRUTES : des champs texte, lus par `lireBornePeriode` et `lireEnveloppeOccurrence`. */
	readonly debut: string
	readonly fin: string
	readonly enveloppe: string
}

function FormulaireOccurrence({
	titre,
	initial,
	creation,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly titre: string
	readonly initial: SaisieOccurrence
	readonly creation: boolean
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieOccurrence) => void
	readonly onAnnuler: () => void
}) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	const premier = useRef<HTMLInputElement>(null)

	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const enveloppe = lireEnveloppeOccurrence(saisie.enveloppe)
	const complet = libelleOccurrenceConforme(saisie.libelle) && enveloppe.statut !== 'illisible'

	return (
		<form
			data-testid="formulaire-occurrence"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h5 className="font-medium">{titre}</h5>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-libelle`} className="text-sm text-text-2">
					{t('admin.occurrences.form.label')}
				</label>
				<input
					id={`${prefixe}-libelle`}
					ref={premier}
					value={saisie.libelle}
					aria-describedby={`${prefixe}-libelle-aide`}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, libelle: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
				<span id={`${prefixe}-libelle-aide`} className="text-sm text-text-3">
					{t('admin.occurrences.form.label.help')}
				</span>
			</div>
			{/*
			 * Les deux bornes sont FACULTATIVES et purement descriptives (§2.2) : elles servent à
			 * ordonner et à libeller, et aucune ligne de coût n'est refusée parce que sa date en
			 * sortirait. Aucune cohérence n'est donc exigée entre elles — l'imposer ici poserait une
			 * règle métier que la base ignore.
			 */}
			<div className="flex flex-wrap gap-3">
				<div className="flex flex-col gap-1 min-w-0">
					<label htmlFor={`${prefixe}-debut`} className="text-sm text-text-2">
						{t('admin.occurrences.form.start')}
					</label>
					<input
						id={`${prefixe}-debut`}
						type="date"
						value={saisie.debut}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, debut: evenement.target.value }))
						}
						className="min-h-[var(--size-target)] max-w-full rounded-sm border border-border bg-surface px-3"
					/>
				</div>
				<div className="flex flex-col gap-1 min-w-0">
					<label htmlFor={`${prefixe}-fin`} className="text-sm text-text-2">
						{t('admin.occurrences.form.end')}
					</label>
					<input
						id={`${prefixe}-fin`}
						type="date"
						value={saisie.fin}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, fin: evenement.target.value }))
						}
						className="min-h-[var(--size-target)] max-w-full rounded-sm border border-border bg-surface px-3"
					/>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-enveloppe`} className="text-sm text-text-2">
					{t('admin.occurrences.form.planned')}
				</label>
				<input
					id={`${prefixe}-enveloppe`}
					value={saisie.enveloppe}
					// `inputMode` et non `type="number"`, pour la raison déjà mesurée au formulaire de
					// budget : un champ numérique natif avale silencieusement une saisie qu'il juge
					// invalide, si bien que le cas « illisible » ne serait jamais atteint.
					inputMode="decimal"
					aria-describedby={
						enveloppe.statut === 'illisible'
							? `${prefixe}-enveloppe-erreur`
							: `${prefixe}-enveloppe-aide`
					}
					aria-invalid={enveloppe.statut === 'illisible' ? true : undefined}
					onChange={(evenement) =>
						setSaisie((precedente) => ({ ...precedente, enveloppe: evenement.target.value }))
					}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
				<span id={`${prefixe}-enveloppe-aide`} className="text-sm text-text-3">
					{t('admin.occurrences.form.planned.help')}
				</span>
				{enveloppe.statut === 'illisible' ? (
					<span
						id={`${prefixe}-enveloppe-erreur`}
						role="alert"
						className="text-sm text-danger-on-soft"
					>
						{t('admin.occurrences.form.planned.invalid')}
					</span>
				) : null}
			</div>
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
// Confirmation de retrait — dans le flux du document, jamais une modale (§5.13)
// ---------------------------------------------------------------------------------------------

/**
 * Confirmation du RETRAIT d'une occurrence.
 *
 * SEUL LE RETRAIT EN PORTE UNE, et c'est le §4.1 bis.3 : la clôture et la réouverture se défont d'un
 * clic — mesure M7/M8 —, et le §5.13 réserve la confirmation dans le flux à ce qui ne se défait pas
 * ainsi. En poser une sur la clôture aurait fait passer un geste réversible pour un geste grave.
 *
 * ELLE N'EMPÊCHE RIEN NON PLUS : la borne du retrait est celle de la base — la clé étrangère de
 * `card_costs`, mesure M11 —, et le bouton n'est donc jamais éteint par ce que la confirmation
 * annonce. Éteindre ici donnerait à un texte la valeur d'une autorisation.
 */
function ConfirmationRetrait({
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
			data-testid="confirmation-retrait-occurrence"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 max-w-[72ch]"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('admin.occurrences.remove.body')}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button ref={premier} variante="destructif" disabled={enCours} onClick={onConfirmer}>
					{t('admin.occurrences.remove.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Le panneau
// ---------------------------------------------------------------------------------------------

/** Ce qui est ouvert dans le panneau, et il n'y en a qu'un à la fois (§5.47). */
type OuvertureOccurrence =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation' }
	| { readonly type: 'edition'; readonly id: string }
	| { readonly type: 'retrait'; readonly id: string }

const AUCUNE: OuvertureOccurrence = { type: 'aucune' }

/** Rend une date `date` telle que la base la porte, ou rien du tout. */
function rendrePeriode(occurrence: OccurrenceAdministrable): string | null {
	const { period_start: debut, period_end: fin } = occurrence
	if (debut === null && fin === null) return null
	if (debut !== null && fin !== null) return t('admin.occurrences.period.range', { debut, fin })
	if (debut !== null) return t('admin.occurrences.period.from', { debut })
	return t('admin.occurrences.period.until', { fin: fin as string })
}

export type ProprietesPanneauOccurrences = {
	readonly client: ClientCrm
	readonly idBudget: string
	readonly nomBudget: string
	/** Annonce un changement dans la région live de l'écran hôte. */
	readonly onAnnonce: (message: string) => void
	/**
	 * Prévient le bloc hôte qu'un compte d'occurrences a pu changer, pour qu'il relise sa cellule.
	 * Sans cela, ouvrir une occurrence laisserait la colonne du §4.1 afficher l'ancien nombre —
	 * l'écran dirait alors deux choses contradictoires au même instant.
	 */
	readonly onComptesPerimes: () => void
}

/**
 * La liste des occurrences d'un budget récurrent, et ses cinq gestes.
 *
 * ELLE PORTE SON PROPRE ÉTAT, pour la raison qui vaut déjà pour `BlocBudgetsTrack` : elle est montée
 * au dépliage et démontée au repliage, donc son état ne survit pas plus longtemps que celui qu'elle
 * remplacerait, et l'union `Ouverture` du bloc hôte n'aurait gagné que trois membres dont aucune
 * autre ligne n'a l'usage.
 */
export function PanneauOccurrences({
	client,
	idBudget,
	nomBudget,
	onAnnonce,
	onComptesPerimes,
}: ProprietesPanneauOccurrences) {
	const [occurrences, setOccurrences] =
		useState<EtatAsync<readonly OccurrenceAdministrable[]>>(enChargement)
	const [ouverture, setOuverture] = useState<OuvertureOccurrence>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [tentative, setTentative] = useState(0)

	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente.
	const courant = useRef(0)

	/**
	 * LA SOUS-SURFACE SE RAMÈNE DANS LE CADRE À SON OUVERTURE, ET C'EST UN DÉFAUT TROUVÉ PAR L'ŒIL.
	 *
	 * MESURÉ à 390 px : la commande de dépliage vit dans la cellule des occurrences, tout à droite
	 * d'une table plus large que la fenêtre. La cliquer fait défiler horizontalement le conteneur de
	 * l'écran pour l'amener sous le doigt — comportement normal du navigateur —, et la sous-surface,
	 * rendue SOUS la table dans ce même conteneur, naissait donc décalée à gauche hors du cadre : la
	 * capture montrait période, montant et état SANS le libellé, c'est-à-dire tout sauf la donnée qui
	 * nomme la ligne.
	 *
	 * `inline: 'start'` ramène le BORD GAUCHE du panneau au bord gauche du conteneur, sans déplacer
	 * verticalement ce que l'utilisateur regarde. C'est le pendant de la règle du §5.13 sur le focus :
	 * ouvrir une surface, c'est la rendre atteignable, pas seulement la monter dans le document.
	 *
	 * `'nearest'` NE SUFFISAIT PAS, et la mesure le dit : le conteneur qui défile est celui de
	 * l'arborescence, dont la boîte de contenu vaut 846 px là où la fenêtre en montre 358. Le panneau
	 * y est donc PLUS LARGE que la zone visible, et `'nearest'` juge alors qu'il est déjà en vue —
	 * il couvre tout le cadre. Il restait décalé de 266 px vers la gauche, libellés hors champ.
	 */
	const racine = useRef<HTMLElement>(null)
	useEffect(() => {
		const element = racine.current
		// GARDE DE CAPACITÉ, ET NON MASQUAGE D'ERREUR (`CLAUDE.md` §18), même geste et même motif
		// qu'à `FormulaireCard.tsx` : `scrollIntoView` n'est pas implémentée par jsdom, où les
		// preuves de composant s'exécutent — MESURÉ, son appel y lève. Ce que cette ligne ajoute est
		// le CADRAGE, et son absence en test ne cache aucun défaut du produit ; le défilement réel
		// est éprouvé par `e2e/ui/occurrences.spec.ts` sur Chromium, aux quatre paliers.
		if (element !== null && typeof element.scrollIntoView === 'function') {
			element.scrollIntoView({ block: 'nearest', inline: 'start' })
		}
	}, [])

	useEffect(() => {
		const rang = ++courant.current
		setOccurrences(enChargement())
		void (async () => {
			const lues = await lireOccurrences(client, idBudget)
			if (rang === courant.current) setOccurrences(lues)
		})()
	}, [client, idBudget, tentative])

	/** Ferme la surface ouverte, oublie le refus, et relit depuis le serveur. */
	const apres = useCallback(
		(resultat: ResultatOccurrence, message: string) => {
			if (resultat.statut === 'refus') {
				setRefus(texteRefusOccurrence(resultat.refus))
				return
			}
			// « Sans effet » n'est ni un succès ni une erreur, et il est DIT (§4.1 bis.3) : la clause
			// `USING` de la politique a filtré, le droit d'écriture étant retombé depuis le
			// chargement. Le présenter comme un succès ferait croire à une écriture qui n'a pas eu
			// lieu.
			if (resultat.statut === 'sans-effet') {
				setRefus(t('admin.occurrences.refus.sans-effet'))
				return
			}
			setRefus(null)
			setOuverture(AUCUNE)
			onAnnonce(message)
			setTentative((precedente) => precedente + 1)
			onComptesPerimes()
		},
		[onAnnonce, onComptesPerimes],
	)

	/** Enveloppe commune : une seule écriture à la fois, et l'état « en cours » ne fuit jamais. */
	const executer = useCallback(
		async (action: () => Promise<ResultatOccurrence>, message: string) => {
			setEnCours(true)
			try {
				apres(await action(), message)
			} finally {
				setEnCours(false)
			}
		},
		[apres],
	)

	const visee = (id: string) =>
		occurrences.statut === 'pret'
			? (occurrences.donnees.find((occurrence) => occurrence.id === id) ?? null)
			: null

	return (
		<section
			ref={racine}
			data-testid="panneau-occurrences"
			aria-label={t('admin.occurrences.aria', { budget: nomBudget })}
			className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
		>
			{/*
			 * Le budget est NOMMÉ en tête (§5.47) : la sous-surface vit sous la table, détachée de la
			 * ligne qui l'a ouverte, et un panneau anonyme sous une table de dix budgets ferait
			 * remonter l'œil chercher lequel est déplié.
			 */}
			<h5 className="font-medium">{t('admin.occurrences.title', { budget: nomBudget })}</h5>

			{/*
			 * Un refus qui n'appartient à AUCUNE surface — celui d'une clôture ou d'une réouverture,
			 * lancées depuis une ligne — est affiché ici. Sans ce rendu, `setRefus` serait appelé,
			 * correct, et invisible (`CLAUDE.md` §18).
			 */}
			{refus !== null && ouverture.type === 'aucune' ? <AlerteRefus message={refus} /> : null}

			{occurrences.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			) : null}

			{occurrences.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger-on-soft">
					{t('admin.occurrences.error')}
				</p>
			) : null}

			{/*
			 * « Aucune occurrence » n'est PAS un état vide en défaut (§5.47) : c'est l'invitation au
			 * seul geste qui vaille, et la commande d'ouverture reste offerte dans les quatre états.
			 */}
			{occurrences.statut === 'pret' && occurrences.donnees.length === 0 ? (
				<p data-testid="occurrences-vide" className="text-sm text-text-3">
					{t('admin.occurrences.empty')}
				</p>
			) : null}

			{occurrences.statut === 'pret' && occurrences.donnees.length > 0 ? (
				<ul data-testid="liste-occurrences" className="flex flex-col">
					{occurrences.donnees.map((occurrence) => {
						const close = occurrence.closed_at !== null
						const periode = rendrePeriode(occurrence)
						return (
							/*
							 * LE LIBELLÉ OCCUPE SA PROPRE LIGNE SOUS `md`, ET C'EST UN DÉFAUT TROUVÉ PAR
							 * L'ŒIL, PAS PAR UNE ASSERTION. À 390 px, la ligne — libellé, période,
							 * enveloppe, état, trois commandes — dépassait la largeur de la fenêtre et
							 * poussait le conteneur de l'écran à défiler horizontalement : la capture
							 * montrait « du 2026-02-01 au 2026-02-28 2500 Ouverte » SANS le libellé,
							 * c'est-à-dire tout sauf la donnée qui nomme la ligne. La ligne de base du
							 * §2.4 l'établit comme NÔTRE : la capture des budgets au même palier, prise
							 * avant cette tranche, ne défile pas. Aucune assertion ne l'attrapait — celle
							 * du palier porte sur la PAGE, et c'est un conteneur interne qui défilait.
							 */
							<li
								key={occurrence.id}
								data-testid="ligne-occurrence"
								className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border last:border-b-0 hover:bg-hover min-h-[var(--size-target)] px-2 py-1"
							>
								<span className="font-normal min-w-0 basis-full md:basis-auto md:grow">
									{occurrence.label}
								</span>
								{/* Cellule VIDE quand aucune borne n'est posée : les deux sont facultatives
								    (§2.2), et un tiret y serait une donnée que personne n'a saisie. */}
								<span data-testid="occurrence-periode" className="text-sm text-text-2 min-w-0">
									{periode}
								</span>
								{/*
								 * L'ENVELOPPE PORTE UN LIBELLÉ ACCESSIBLE, second constat de la même
								 * observation : dans une `ul` sans en-têtes de colonne, « 2500 » nu ne dit
								 * pas de quoi il est le nombre — là où la table des budgets a une colonne
								 * « Enveloppe » pour le dire. Le texte reste visuellement le seul montant.
								 */}
								<span
									data-testid="occurrence-enveloppe"
									className="text-sm text-text-2 whitespace-nowrap"
								>
									{occurrence.planned_amount === null ? null : (
										<>
											<span className="sr-only">
												{t('admin.occurrences.form.planned')}
											</span>
											{String(occurrence.planned_amount)}
										</>
									)}
								</span>
								{/* L'état est un MOT, pas une teinte (§1, §5.47) : une ligne close grisée se
								    lirait comme une panne d'affichage. */}
								<span data-testid="occurrence-etat" className="text-sm text-text-2">
									{close
										? t('admin.occurrences.state.closed')
										: t('admin.occurrences.state.open')}
								</span>
								<span className="flex items-center gap-1">
									<Button
										taille="compacte"
										variante="discret"
										onClick={() => {
											setRefus(null)
											setOuverture({ type: 'edition', id: occurrence.id })
										}}
										aria-label={t('admin.occurrences.action.edit', {
											nom: occurrence.label,
										})}
									>
										<Pencil aria-hidden="true" size={16} strokeWidth={2} />
									</Button>
									{/*
									 * Clôturer et rouvrir sont DEUX ICÔNES DIFFÉRENTES, jamais la même
									 * retournée — le §5.13 a déjà tranché ce cas pour l'archivage, et le
									 * §5.47 le reprend. Aucune des deux ne porte de confirmation : elles se
									 * défont d'un clic (mesures M7 et M8).
									 */}
									{close ? (
										<Button
											taille="compacte"
											variante="discret"
											onClick={() => {
												setRefus(null)
												void executer(
													() => cloturerOccurrence(client, occurrence.id, false),
													t('live.admin.occurrence.reopened'),
												)
											}}
											aria-label={t('admin.occurrences.action.reopen', {
												nom: occurrence.label,
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
												void executer(
													() => cloturerOccurrence(client, occurrence.id, true),
													t('live.admin.occurrence.closed'),
												)
											}}
											aria-label={t('admin.occurrences.action.close', {
												nom: occurrence.label,
											})}
										>
											<Lock aria-hidden="true" size={16} strokeWidth={2} />
										</Button>
									)}
									<Button
										taille="compacte"
										variante="discret"
										onClick={() => {
											setRefus(null)
											setOuverture({ type: 'retrait', id: occurrence.id })
										}}
										aria-label={t('admin.occurrences.action.remove', {
											nom: occurrence.label,
										})}
									>
										<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
									</Button>
								</span>
							</li>
						)
					})}
				</ul>
			) : null}

			{/*
			 * Les surfaces vivent SOUS la liste, comme les trois du bloc hôte vivent sous sa table
			 * (§5.47) : deux placements pour un même type de surface dans un même bloc feraient
			 * chercher au mauvais endroit.
			 */}
			{ouverture.type === 'edition'
				? (() => {
						const occurrence = visee(ouverture.id)
						if (occurrence === null) return null
						return (
							<FormulaireOccurrence
								titre={t('admin.occurrences.form.edit')}
								creation={false}
								initial={{
									libelle: occurrence.label,
									debut: occurrence.period_start ?? '',
									fin: occurrence.period_end ?? '',
									enveloppe:
										occurrence.planned_amount === null
											? ''
											: String(occurrence.planned_amount),
								}}
								refus={refus}
								enCours={enCours}
								onAnnuler={() => {
									setRefus(null)
									setOuverture(AUCUNE)
								}}
								onValider={(saisie) => {
									const enveloppe = lireEnveloppeOccurrence(saisie.enveloppe)
									if (enveloppe.statut === 'illisible') return
									void executer(
										() =>
											modifierOccurrence(client, occurrence.id, {
												libelle: saisie.libelle,
												debut: lireBornePeriode(saisie.debut),
												fin: lireBornePeriode(saisie.fin),
												enveloppe:
													enveloppe.statut === 'absente' ? null : enveloppe.montant,
											}),
										t('live.admin.occurrence.updated'),
									)
								}}
							/>
						)
					})()
				: null}

			{ouverture.type === 'retrait'
				? (() => {
						const occurrence = visee(ouverture.id)
						if (occurrence === null) return null
						return (
							<ConfirmationRetrait
								question={t('admin.occurrences.remove.confirm', { nom: occurrence.label })}
								refus={refus}
								enCours={enCours}
								onAnnuler={() => {
									setRefus(null)
									setOuverture(AUCUNE)
								}}
								onConfirmer={() =>
									void executer(
										() => retirerOccurrence(client, occurrence.id),
										t('live.admin.occurrence.removed'),
									)
								}
							/>
						)
					})()
				: null}

			{ouverture.type === 'creation' ? (
				<FormulaireOccurrence
					titre={t('admin.occurrences.form.create')}
					creation
					initial={{ libelle: '', debut: '', fin: '', enveloppe: '' }}
					refus={refus}
					enCours={enCours}
					onAnnuler={() => {
						setRefus(null)
						setOuverture(AUCUNE)
					}}
					onValider={(saisie) => {
						const enveloppe = lireEnveloppeOccurrence(saisie.enveloppe)
						if (enveloppe.statut === 'illisible') return
						void executer(
							() =>
								creerOccurrence(client, {
									idBudget,
									libelle: saisie.libelle,
									debut: lireBornePeriode(saisie.debut),
									fin: lireBornePeriode(saisie.fin),
									enveloppe: enveloppe.statut === 'absente' ? null : enveloppe.montant,
								}),
							t('live.admin.occurrence.created'),
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
					{t('admin.occurrences.action.new')}
				</Button>
			)}
		</section>
	)
}
