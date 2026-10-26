// @spec CRM-077 (docs/BACKLOG.md), onzième tranche (INC-316) — le panneau de réaffectation des dépenses qui bloquent
//       l'effacement d'un track en corbeille
// @spec docs/SPEC-corbeille.md §9.1 (les dépenses bloquantes, lues par la base), §9.2 (la réaffectation, ses refus),
//       §9.3 (le panneau, « Rouvrir le budget ») ; docs/DESIGN_SYSTEM.md §5.16 (cette surface), §5.27 (le bloc en ligne de
//       tableau), §5.22 (le `select` et son option vide), §5.47 (la réouverture) ; décisions 741 à 743
// @spec CLAUDE.md §10 — l'écran n'offre que des cibles que la base accepterait ; elle reste seule juge
//
// LE PANNEAU RELIT, IL NE CORRIGE JAMAIS EN MÉMOIRE. Après chaque geste — réaffecter, rouvrir —, la liste des dépenses
// bloquantes est relue : c'est la base qui dit ce qui bloque encore, et une liste amputée localement mentirait dès qu'un
// geste aurait été refusé en silence.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LockOpen } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { cloturerBudget } from '../lib/budgets'
import {
	filtrerBudgetsCibles,
	lireBudgetsCibles,
	lireDepensesBloquantes,
	reaffecterDepense,
	type BudgetCible,
	type DepenseBloquante,
	type NatureRefusReaffectation,
} from '../lib/corbeille'
import { cloturerOccurrence, lireOccurrences, type OccurrenceAdministrable } from '../lib/occurrences'
import type { ClientCrm } from '../lib/supabase'

/** Un texte par refus nommé (§9.2) ; le message du serveur n'atteint jamais l'écran. */
const CLES_REFUS: Readonly<Record<NatureRefusReaffectation, CleTraduction>> = {
	reserve: 'admin.trash.reassign.refus.reserve',
	introuvable: 'admin.trash.reassign.refus.introuvable',
	'non-bloquante': 'admin.trash.reassign.refus.nonBloquante',
	'meme-track': 'admin.trash.reassign.refus.memeTrack',
	'track-en-corbeille': 'admin.trash.reassign.refus.trackEnCorbeille',
	devise: 'admin.trash.reassign.refus.devise',
	regle: 'admin.trash.reassign.refus.regle',
	reseau: 'admin.trash.reassign.refus.reseau',
	inconnu: 'admin.trash.reassign.refus.inconnu',
}

/** Le choix en cours d'une ligne : un budget, et son occurrence quand il est récurrent. */
type Choix = { readonly budget: string; readonly occurrence: string }

const montant = (valeur: number): string =>
	new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valeur)

export type ProprietesPanneauReaffectation = {
	readonly client: ClientCrm
	readonly idTrack: string
	readonly nomTrack: string
	/** Les tracks en corbeille, lus par l'écran : leurs budgets ne sont jamais offerts (§9.3). */
	readonly tracksEnCorbeille: ReadonlySet<string>
	readonly onFermer: () => void
	/** Plus rien ne bloque : l'écran referme le panneau et le dit (§5.16). */
	readonly onDebloque: () => void
}

export function PanneauReaffectation({
	client,
	idTrack,
	nomTrack,
	tracksEnCorbeille,
	onFermer,
	onDebloque,
}: ProprietesPanneauReaffectation) {
	const [depenses, setDepenses] = useState<EtatAsync<readonly DepenseBloquante[]>>(enChargement)
	const [budgets, setBudgets] = useState<EtatAsync<readonly BudgetCible[]>>(enChargement)
	const [occurrences, setOccurrences] = useState<Readonly<Record<string, EtatAsync<readonly OccurrenceAdministrable[]>>>>({})
	const [choix, setChoix] = useState<Readonly<Record<string, Choix>>>({})
	const [enCours, setEnCours] = useState<string | null>(null)
	const [refus, setRefus] = useState<Readonly<Record<string, string>>>({})
	const [annonce, setAnnonce] = useState<string | null>(null)
	const titre = useRef<HTMLHeadingElement>(null)
	const courant = useRef(0)

	const relire = useCallback(async () => {
		const rang = ++courant.current
		const lues = await lireDepensesBloquantes(client, idTrack)
		if (rang !== courant.current) return
		if (lues.statut === 'pret' && lues.donnees.length === 0) {
			onDebloque()
			return
		}
		setDepenses(lues)
	}, [client, idTrack, onDebloque])

	useEffect(() => {
		titre.current?.focus()
		void relire()
		void lireBudgetsCibles(client).then(setBudgets)
	}, [client, relire])

	// Les occurrences ouvertes d'un budget récurrent, lues au premier choix de ce budget.
	const chargerOccurrences = useCallback(
		(idBudget: string) => {
			if (occurrences[idBudget] !== undefined) return
			setOccurrences((avant) => ({ ...avant, [idBudget]: enChargement() }))
			void lireOccurrences(client, idBudget).then((lues) => {
				setOccurrences((avant) => ({
					...avant,
					[idBudget]:
						lues.statut === 'pret'
							? pret(lues.donnees.filter((occurrence) => occurrence.closed_at === null))
							: lues.statut === 'erreur'
								? enErreur(lues.erreur)
								: lues,
				}))
			})
		},
		[client, occurrences],
	)

	const choisirBudget = (depense: DepenseBloquante, idBudget: string) => {
		setChoix((avant) => ({ ...avant, [depense.id]: { budget: idBudget, occurrence: '' } }))
		const budget = budgets.statut === 'pret' ? budgets.donnees.find((b) => b.id === idBudget) : undefined
		if (budget?.recurrent === true) chargerOccurrences(idBudget)
	}

	const reaffecter = async (depense: DepenseBloquante, budget: BudgetCible) => {
		const choisi = choix[depense.id]
		if (choisi === undefined) return
		setEnCours(depense.id)
		setAnnonce(null)
		setRefus((avant) => ({ ...avant, [depense.id]: '' }))
		const resultat = await reaffecterDepense(
			client,
			depense.id,
			choisi.budget,
			budget.recurrent ? choisi.occurrence : null,
		)
		setEnCours(null)
		if (resultat.statut === 'refus') {
			setRefus((avant) => ({ ...avant, [depense.id]: t(CLES_REFUS[resultat.nature]) }))
			return
		}
		setAnnonce(t('admin.trash.reassign.done', { budget: budget.nom }))
		await relire()
	}

	const rouvrir = async (depense: DepenseBloquante) => {
		setEnCours(depense.id)
		setAnnonce(null)
		setRefus((avant) => ({ ...avant, [depense.id]: '' }))
		// L'occurrence d'abord quand c'est elle qui est close : le budget peut être ouvert, et rouvrir le mauvais objet
		// ne débloquerait rien.
		const resultat =
			depense.occurrenceClose && depense.idOccurrence !== null && !depense.budgetClos
				? await cloturerOccurrence(client, depense.idOccurrence, false)
				: await cloturerBudget(client, depense.idBudget, false)
		setEnCours(null)
		if (resultat.statut === 'applique') {
			setAnnonce(t('admin.trash.reassign.reopened'))
		} else {
			setRefus((avant) => ({
				...avant,
				[depense.id]:
					resultat.statut === 'sans-effet'
						? t('admin.trash.reassign.reopen.sansEffet')
						: t('admin.trash.reassign.reopen.refus'),
			}))
		}
		await relire()
	}

	const auClavier = (evenement: KeyboardEvent<HTMLDivElement>) => {
		if (evenement.key === 'Escape') {
			evenement.stopPropagation()
			onFermer()
		}
	}

	return (
		<div
			data-testid="panneau-reaffectation"
			onKeyDown={auClavier}
			className="sticky left-0 max-w-[calc(100vw-2rem)] flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			<h3 ref={titre} tabIndex={-1} className="text-base font-medium text-ink">
				{t('admin.trash.reassign.title', { track: nomTrack })}
			</h3>
			<p className="text-[13px] text-text-2">{t('admin.trash.reassign.why')}</p>

			{annonce !== null && (
				<p role="status" data-testid="reaffectation-annonce" className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success-on-soft">
					{annonce}
				</p>
			)}

			{depenses.statut === 'chargement' && <p className="text-sm text-text-3">{t('admin.trash.reassign.loading')}</p>}
			{depenses.statut === 'erreur' && (
				<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t('admin.trash.reassign.error')}
				</p>
			)}
			{depenses.statut === 'pret' && (
				<ul className="flex flex-col">
					{depenses.donnees.map((depense) => {
						const clos = depense.budgetClos || depense.occurrenceClose
						const offerts =
							budgets.statut === 'pret' ? filtrerBudgetsCibles(budgets.donnees, depense, tracksEnCorbeille) : []
						const choisi = choix[depense.id]
						const budgetChoisi = offerts.find((budget) => budget.id === choisi?.budget)
						const occurrencesDuBudget = budgetChoisi?.recurrent === true ? occurrences[budgetChoisi.id] : undefined
						const pretAEnvoyer =
							budgetChoisi !== undefined && (!budgetChoisi.recurrent || (choisi?.occurrence ?? '') !== '')
						const vol = enCours === depense.id
						const idBudget = `reaffecter-budget-${depense.id}`
						const idOccurrence = `reaffecter-occurrence-${depense.id}`
						return (
							<li
								key={depense.id}
								data-testid="depense-bloquante"
								data-depense={depense.id}
								className="flex flex-col gap-2 border-b border-border py-3"
							>
								<p className="text-sm text-ink">
									<span className="font-medium">{depense.titreAffaire}</span>
									<span className="text-text-2"> · {depense.libelle} · </span>
									<code className="tabular-nums">{montant(depense.estime)}</code>{' '}
									<code className="text-text-2">{depense.devise}</code>
								</p>
								<p className="text-[13px] text-text-2">
									{t('admin.trash.reassign.current', { budget: depense.nomBudget })}
								</p>
								{clos ? (
									<div className="flex flex-wrap items-center gap-2">
										<p className="text-[13px] text-text-2">
											{depense.budgetClos ? t('admin.trash.reassign.closed') : t('admin.trash.reassign.occurrenceClosed')}
										</p>
										<Button taille="compacte" disabled={vol} onClick={() => void rouvrir(depense)}>
											<LockOpen aria-hidden="true" className="size-4" />
											{depense.budgetClos
												? t('admin.trash.reassign.reopenBudget')
												: t('admin.trash.reassign.reopenOccurrence')}
										</Button>
									</div>
								) : (
									<div className="flex flex-wrap items-end gap-3">
										<label htmlFor={idBudget} className="flex flex-col gap-1 text-[13px] text-text-2">
											{t('admin.trash.reassign.target')}
											<select
												id={idBudget}
												value={choisi?.budget ?? ''}
												disabled={budgets.statut !== 'pret' || vol}
												aria-busy={budgets.statut === 'chargement' ? true : undefined}
												onChange={(evenement) => choisirBudget(depense, evenement.target.value)}
												className="h-[var(--size-target)] max-w-[40ch] rounded-sm border border-border bg-surface px-2 text-sm text-ink"
											>
												<option value="">{t('admin.trash.reassign.target.empty')}</option>
												{grouperParTrack(offerts).map(([nomGroupe, groupe]) => (
													<optgroup key={nomGroupe} label={nomGroupe}>
														{groupe.map((budget) => (
															<option key={budget.id} value={budget.id}>
																{t('admin.trash.reassign.target.option', { track: budget.nomTrack, budget: budget.nom })}
															</option>
														))}
													</optgroup>
												))}
											</select>
										</label>
										{budgetChoisi?.recurrent === true && (
											<label htmlFor={idOccurrence} className="flex flex-col gap-1 text-[13px] text-text-2">
												{t('admin.trash.reassign.occurrence')}
												<select
													id={idOccurrence}
													value={choisi?.occurrence ?? ''}
													disabled={occurrencesDuBudget?.statut !== 'pret' || vol}
													onChange={(evenement) =>
														setChoix((avant) => ({
															...avant,
															[depense.id]: { budget: budgetChoisi.id, occurrence: evenement.target.value },
														}))
													}
													className="h-[var(--size-target)] max-w-[30ch] rounded-sm border border-border bg-surface px-2 text-sm text-ink"
												>
													<option value="">{t('admin.trash.reassign.occurrence.empty')}</option>
													{occurrencesDuBudget?.statut === 'pret' &&
														occurrencesDuBudget.donnees.map((occurrence) => (
															<option key={occurrence.id} value={occurrence.id}>
																{occurrence.label}
															</option>
														))}
												</select>
											</label>
										)}
										<Button
											variante="primaire"
											taille="compacte"
											disabled={!pretAEnvoyer || vol}
											onClick={() => budgetChoisi !== undefined && void reaffecter(depense, budgetChoisi)}
										>
											{vol ? t('admin.trash.reassign.running') : t('admin.trash.reassign.submit')}
										</Button>
									</div>
								)}
								{budgets.statut === 'pret' && !clos && offerts.length === 0 && (
									<p className="text-[13px] text-text-2">{t('admin.trash.reassign.noTarget', { devise: depense.devise })}</p>
								)}
								{(refus[depense.id] ?? '') !== '' && (
									<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
										{refus[depense.id]}
									</p>
								)}
							</li>
						)
					})}
				</ul>
			)}
			{budgets.statut === 'erreur' && (
				<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t('admin.trash.reassign.budgetsError')}
				</p>
			)}

			<div>
				<Button taille="compacte" onClick={onFermer}>
					{t('admin.trash.reassign.close')}
				</Button>
			</div>
		</div>
	)
}

/** Les budgets groupés par track, dans l'ordre du serveur (§5.29 : l'ordre n'est jamais retrié à l'écran). */
function grouperParTrack(budgets: readonly BudgetCible[]): readonly [string, readonly BudgetCible[]][] {
	const groupes = new Map<string, BudgetCible[]>()
	for (const budget of budgets) {
		const groupe = groupes.get(budget.nomTrack) ?? []
		groupe.push(budget)
		groupes.set(budget.nomTrack, groupe)
	}
	return [...groupes.entries()]
}
