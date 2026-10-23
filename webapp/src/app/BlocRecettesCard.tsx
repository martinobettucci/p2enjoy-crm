// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : le bloc « Recettes » de la fiche d'une affaire
// @spec docs/SPEC-recettes.md §2.1 (une ligne : nature, prévu, réel dérivé, soldée), §2.3 (« nul n'est pas zéro »), §2.4
//       (la devise est celle de l'affaire), §3 (écrire : celui qui écrit l'affaire), §6.1 (ce bloc), §6.5 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.60 (avant « Coûts » ; la table de `BlocCoutsCard` moins budget et occurrence ; la devise
//       nommée dans l'en-tête des montants), §5.31 bis (réels dépliés sous la table, case « Soldé »), §5.13
//       (formulaires et confirmation dans le flux), §5.59 (commandes éteintes avec le motif de la fiche), §8, §10
//
// AUCUN DROIT N'EST CALCULÉ ICI : les commandes suivent la capacité d'écrire l'affaire, rendue par la base
// (`useRefus`, `CRM-093`), et tout refus reçu est traduit dans le bloc.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { useRefus } from '../components/ui/RefusCommandes'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { libelleCoutConforme, lireMontant } from '../lib/card-costs'
import {
	creerLigneRecette,
	lireRecettesCard,
	modifierLigneRecette,
	supprimerLigneRecette,
	totaliserRecettes,
	type LigneRecette,
	type RefusRecette,
	type ResultatRecette,
} from '../lib/card-revenues'
import type { ClientCrm } from '../lib/supabase'
import { ReelsLigne } from './ReelsLigne'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3'
const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'
// `min-w-0` et `[contain:paint]` : les deux gardes mesurées sur la section des coûts à 390 px (`BlocCoutsCard`).
const CLASSES_SECTION = 'flex flex-col gap-3 border-t border-border pt-4 min-w-0'
const CLASSES_CONTENEUR_TABLE = 'overflow-x-auto indique-debordement-x [contain:paint]'

const rendreMontant = (montant: number): string => montant.toFixed(2)

/** Traduit un refus d'écriture d'une ligne de recette. */
export function texteRefusRecette(refus: RefusRecette): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('card.revenues.refus.forbidden')
		case 'forme-refusee':
			return t('card.revenues.refus.forme-refusee')
		case 'montant-hors-echelle':
			return t('card.revenues.refus.montant-hors-echelle')
		case 'reference-absente':
			return t('card.revenues.refus.reference-absente')
		case 'network':
			return t('card.revenues.refus.network')
		case 'unknown':
			return t('card.revenues.refus.unknown')
	}
}

function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="recette-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

type SaisieRecette = { readonly libelle: string; readonly prevu: string }

function FormulaireRecette({
	titre,
	initial,
	creation,
	devise,
	refus,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly titre: string
	readonly initial: SaisieRecette
	readonly creation: boolean
	readonly devise: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieRecette) => void
	readonly onAnnuler: () => void
}) {
	const droit = useRefus()
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	const premier = useRef<HTMLInputElement>(null)
	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])
	const prevu = lireMontant(saisie.prevu)
	// Le prévu est OBLIGATOIRE (§2.1) : `absent` n'est pas une issue acceptable pour ce champ.
	const complet = libelleCoutConforme(saisie.libelle) && prevu.statut === 'lu'

	return (
		<form
			data-testid="formulaire-recette"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<h4 className="font-medium">{titre}</h4>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-libelle`} className="text-sm text-text-2">
					{t('card.revenues.form.label')}
				</label>
				<input
					id={`${prefixe}-libelle`}
					ref={premier}
					value={saisie.libelle}
					aria-describedby={`${prefixe}-libelle-aide`}
					onChange={(e) => setSaisie((p) => ({ ...p, libelle: e.target.value }))}
					className={CLASSES_CHAMP}
				/>
				<span id={`${prefixe}-libelle-aide`} className="text-sm text-text-3">
					{t('card.revenues.form.label.help')}
				</span>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-prevu`} className="text-sm text-text-2">
					{t('card.revenues.form.estimated', { devise })}
				</label>
				<input
					id={`${prefixe}-prevu`}
					value={saisie.prevu}
					// `inputMode` et non `type="number"` : un champ numérique natif avale la saisie qu'il juge invalide, et
					// `lireMontant` ne verrait jamais le cas qu'elle existe pour nommer (même raison que les coûts).
					inputMode="decimal"
					aria-describedby={prevu.statut === 'invalide' ? `${prefixe}-prevu-erreur` : `${prefixe}-prevu-aide`}
					aria-invalid={prevu.statut === 'invalide' ? true : undefined}
					onChange={(e) => setSaisie((p) => ({ ...p, prevu: e.target.value }))}
					className={CLASSES_CHAMP}
				/>
				<span id={`${prefixe}-prevu-aide`} className="text-sm text-text-3">
					{t('card.revenues.form.estimated.help')}
				</span>
				{prevu.statut === 'invalide' ? (
					<span id={`${prefixe}-prevu-erreur`} role="alert" className="text-sm text-danger-on-soft">
						{t('card.costs.form.amount.invalid')}
					</span>
				) : null}
			</div>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button {...droit} type="submit" variante="primaire" disabled={droit.disabled === true || !complet || enCours}>
					{creation ? t('card.revenues.action.add') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

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
	const droit = useRefus()
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div data-testid="confirmation-suppression-recette" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{t('card.revenues.delete.body')}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button {...droit} ref={premier} variante="destructif" disabled={droit.disabled === true || enCours} onClick={onConfirmer}>
					{t('card.revenues.delete.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}

type Ouverture =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation' }
	| { readonly type: 'edition'; readonly id: string }
	| { readonly type: 'suppression'; readonly id: string }
	| { readonly type: 'reels'; readonly id: string }

const AUCUNE: Ouverture = { type: 'aucune' }

/**
 * Le bloc « Recettes » de la fiche — `docs/SPEC-recettes.md` §6.1. Un seul élément ouvert à la fois, sous la table ;
 * la liste relue après chaque écriture, jamais complétée localement.
 */
export function BlocRecettesCard({
	client,
	idCard,
	titreCard,
	devise,
	onChange,
}: {
	/** `null` lorsque la configuration manque : le bloc ne rend rien (même règle que `BlocCoutsCard`). */
	readonly client: ClientCrm | null
	readonly idCard: string
	readonly titreCard: string
	/** La devise de l'affaire, qui est celle de ses recettes (§2.4). */
	readonly devise: string
	/** Après chaque écriture acceptée : la fiche relit la rentabilité, qui en dépend. */
	readonly onChange?: () => void
}) {
	const droit = useRefus()
	const [lignes, setLignes] = useState<EtatAsync<readonly LigneRecette[]>>(enChargement)
	const [ouverture, setOuverture] = useState<Ouverture>(AUCUNE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [tentative, setTentative] = useState(0)
	const [annonce, setAnnonce] = useState<string | null>(null)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setLignes(enChargement())
		void lireRecettesCard(client, idCard).then((lues) => {
			if (rang === courant.current) setLignes(lues)
		})
	}, [client, idCard, tentative])

	const relire = useCallback(
		(message: string) => {
			setAnnonce(message)
			setTentative((n) => n + 1)
			onChange?.()
		},
		[onChange],
	)

	const executer = useCallback(
		async (action: () => Promise<ResultatRecette>, message: string) => {
			setEnCours(true)
			try {
				const resultat = await action()
				if (resultat.statut === 'refus') setRefus(texteRefusRecette(resultat.refus))
				else if (resultat.statut === 'sans-effet') setRefus(t('card.revenues.refus.sans-effet'))
				else {
					setRefus(null)
					setOuverture(AUCUNE)
					relire(message)
				}
			} finally {
				setEnCours(false)
			}
		},
		[relire],
	)

	if (client === null) return null
	const fermer = () => {
		setRefus(null)
		setOuverture(AUCUNE)
	}

	return (
		<section data-testid="bloc-recettes-card" aria-labelledby="recettes-card-titre" className={CLASSES_SECTION}>
			<h2 id="recettes-card-titre" className="text-h3 font-medium">
				{t('card.revenues.title')}
			</h2>
			<p role="status" aria-live="polite" className="sr-only">
				{annonce ?? ''}
			</p>
			{refus !== null && ouverture.type === 'aucune' ? <AlerteRefus message={refus} /> : null}

			{lignes.statut === 'chargement' ? <SkeletonListe lignes={2} libelle={t('state.loading.aria')} /> : null}
			{lignes.statut === 'erreur' ? (
				<div className="flex flex-col items-start gap-2">
					<p role="alert" data-testid="recettes-erreur" className="text-sm text-danger-on-soft">
						{t('card.revenues.error')}
					</p>
					<Button taille="compacte" variante="secondaire" onClick={() => setTentative((n) => n + 1)}>
						{t('card.revenues.error.retry')}
					</Button>
				</div>
			) : null}
			{lignes.statut === 'pret' && lignes.donnees.length === 0 ? (
				<p data-testid="recettes-vide" className="text-sm text-text-3">
					{t('card.revenues.empty')}
				</p>
			) : null}

			{lignes.statut === 'pret' && lignes.donnees.length > 0 ? (
				<>
					<div className={CLASSES_CONTENEUR_TABLE}>
						<table data-testid="tableau-recettes" className="w-full border-collapse">
							<caption className="sr-only">{t('card.revenues.aria', { titre: titreCard })}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className={CLASSES_ENTETE}>
										{t('card.revenues.column.label')}
									</th>
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
										{t('card.revenues.column.estimated', { devise })}
									</th>
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
										{t('card.revenues.column.actual', { devise })}
									</th>
									<th scope="col" className={CLASSES_ENTETE}>
										{t('card.costs.column.actions')}
									</th>
								</tr>
							</thead>
							<tbody>
								{lignes.donnees.map((ligne) => {
									const deplie = ouverture.type === 'reels' && ouverture.id === ligne.id
									return (
										<tr key={ligne.id} data-testid="ligne-recette" className="border-b border-border last:border-b-0 hover:bg-hover">
											<th scope="row" className={`${CLASSES_CELLULE} font-normal text-left`}>
												{ligne.label}
											</th>
											<td className={`${CLASSES_CELLULE} text-right whitespace-nowrap tabular-nums`}>
												{rendreMontant(ligne.estimated_amount)}
											</td>
											{/* LA RECETTE RÉELLE INCONNUE N'EST PAS ZÉRO (§2.3) : un tiret et son équivalent lisible. */}
											<td data-testid="recette-cellule-reel" className={`${CLASSES_CELLULE} text-right whitespace-nowrap tabular-nums`}>
												{ligne.actual_amount === null ? (
													<span title={t('card.revenues.actual.unknown')}>
														<span aria-hidden="true">—</span>
														<span className="sr-only">{t('card.revenues.actual.unknown')}</span>
													</span>
												) : (
													rendreMontant(ligne.actual_amount)
												)}
												{ligne.settled_at !== null ? (
													<span data-testid="recette-pilule-soldee" className="ml-2 rounded-sm bg-bg px-2 py-[2px] text-sm text-text-2">
														{t('costs.actuals.settled.pill')}
													</span>
												) : null}
											</td>
											<td className={CLASSES_CELLULE}>
												<span className="flex items-center gap-1">
													<Button
														taille="compacte"
														variante="discret"
														aria-expanded={deplie}
														onClick={() => {
															setRefus(null)
															setOuverture(deplie ? AUCUNE : { type: 'reels', id: ligne.id })
														}}
														aria-label={t('costs.actuals.toggle', { nom: ligne.label })}
														data-testid="recette-reels-bascule"
													>
														{deplie ? (
															<ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
														) : (
															<ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
														)}
													</Button>
													<Button
														{...droit}
														taille="compacte"
														variante="discret"
														onClick={() => {
															setRefus(null)
															setOuverture({ type: 'edition', id: ligne.id })
														}}
														aria-label={t('card.revenues.action.edit', { nom: ligne.label })}
													>
														<Pencil aria-hidden="true" size={16} strokeWidth={2} />
													</Button>
													<Button
														{...droit}
														taille="compacte"
														variante="discret"
														onClick={() => {
															setRefus(null)
															setOuverture({ type: 'suppression', id: ligne.id })
														}}
														aria-label={t('card.revenues.action.delete', { nom: ligne.label })}
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
					<PiedRecettes lignes={lignes.donnees} devise={devise} />
				</>
			) : null}

			{ouverture.type === 'edition' && lignes.statut === 'pret'
				? lignes.donnees
						.filter((l) => l.id === ouverture.id)
						.map((ligne) => (
							<FormulaireRecette
								key={ligne.id}
								titre={t('card.revenues.form.edit')}
								creation={false}
								devise={devise}
								initial={{ libelle: ligne.label, prevu: String(ligne.estimated_amount) }}
								refus={refus}
								enCours={enCours}
								onAnnuler={fermer}
								onValider={(saisie) => {
									const prevu = lireMontant(saisie.prevu)
									if (prevu.statut !== 'lu') return
									void executer(
										() => modifierLigneRecette(client, ligne.id, { libelle: saisie.libelle, prevu: prevu.montant }),
										t('live.card.revenue.updated'),
									)
								}}
							/>
						))
				: null}

			{ouverture.type === 'reels' && lignes.statut === 'pret'
				? lignes.donnees
						.filter((l) => l.id === ouverture.id)
						.map((ligne) => (
							<ReelsLigne
								key={ligne.id}
								client={client}
								sorte="recette"
								idLigne={ligne.id}
								nature={ligne.label}
								devise={devise}
								soldee={ligne.settled_at !== null}
								onChange={(message) => relire(message)}
							/>
						))
				: null}

			{ouverture.type === 'suppression' && lignes.statut === 'pret'
				? lignes.donnees
						.filter((l) => l.id === ouverture.id)
						.map((ligne) => (
							<ConfirmationSuppression
								key={ligne.id}
								question={t('card.revenues.delete.confirm', { nom: ligne.label })}
								refus={refus}
								enCours={enCours}
								onAnnuler={fermer}
								onConfirmer={() =>
									void executer(() => supprimerLigneRecette(client, ligne.id), t('live.card.revenue.deleted'))
								}
							/>
						))
				: null}

			{ouverture.type === 'creation' ? (
				<FormulaireRecette
					titre={t('card.revenues.form.create')}
					creation
					devise={devise}
					initial={{ libelle: '', prevu: '' }}
					refus={refus}
					enCours={enCours}
					onAnnuler={fermer}
					onValider={(saisie) => {
						const prevu = lireMontant(saisie.prevu)
						if (prevu.statut !== 'lu') return
						void executer(
							() => creerLigneRecette(client, idCard, { libelle: saisie.libelle, prevu: prevu.montant }),
							t('live.card.revenue.created'),
						)
					}}
				/>
			) : (
				<div>
					<Button
						{...droit}
						taille="compacte"
						variante="secondaire"
						onClick={() => {
							setRefus(null)
							setOuverture({ type: 'creation' })
						}}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('card.revenues.action.new')}
					</Button>
				</div>
			)}
		</section>
	)
}

/** Le pied : prévu, réel connu, et la mention des réels manquants quand il y en a (§6.1). */
function PiedRecettes({ lignes, devise }: { readonly lignes: readonly LigneRecette[]; readonly devise: string }) {
	const total = totaliserRecettes(lignes)
	return (
		<div data-testid="recettes-totaux" className="flex flex-col gap-1 border-t border-border pt-3">
			<p className="text-sm">
				{t('card.revenues.total', { devise, prevu: rendreMontant(total.prevu), reel: rendreMontant(total.reel) })}
			</p>
			{total.sansReel > 0 ? (
				<p data-testid="recettes-sans-reel" className="text-sm text-text-2">
					{t(total.sansReel === 1 ? 'card.revenues.pending.one' : 'card.revenues.pending.many', {
						nombre: String(total.sansReel),
						prevu: rendreMontant(total.prevuSansReel),
						devise,
					})}
				</p>
			) : null}
		</div>
	)
}
