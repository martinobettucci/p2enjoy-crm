// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — les commandes d'écriture lisent le refus de la fiche quand la base refuse
//       l'écriture sur l'affaire (docs/SPEC-droits-interface.md §2.1, §3 ; docs/DESIGN_SYSTEM.md §5.59)
// @spec CRM-099 (docs/BACKLOG.md) — tranche T2 : les réels d'une ligne de coût dans la fiche d'une affaire, et la
//       case « Soldé »
// @spec docs/SPEC-costs.md §2.3 bis (plusieurs réels ; montant, date du jour par défaut, libellé facultatif ; une
//       ligne soldée est figée, décocher la rouvre ; soldée sans réel, elle vaut zéro), §4.6 ;
//       docs/DESIGN_SYSTEM.md §5.31 bis (dépli, liste date · libellé · montant, `Pencil` et `Trash2`, case « Soldé »
//       de 24 px, pilule « Soldé », gestes désactivés et lisibles sur une ligne soldée), §5.13 (confirmation), §8
//
// La base tient la somme, le zéro et le refus d'écrire sur une ligne soldée. L'écran éteint les gestes d'une ligne
// soldée AVEC LEUR MOTIF — une aide, la base refusant de toute façon — et dit tout refus qu'elle rend.

import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireMontant } from '../lib/card-costs'
import {
	ajouterReel,
	lireReels,
	modifierReel,
	solderLigne,
	supprimerReel,
	type MotifRefusReel,
	type Reel,
	type SaisieReel,
} from '../lib/reels-ligne'
import type { ClientCrm } from '../lib/supabase'
import { jourLocal } from '../lib/temps'
import { useRefus } from '../components/ui/RefusCommandes'

const REFUS: Readonly<Record<MotifRefusReel, CleTraduction>> = {
	soldee: 'costs.actuals.refused.settled',
	forme: 'costs.actuals.refused.shape',
	'montant-hors-echelle': 'costs.actuals.refused.scale',
	droit: 'costs.actuals.refused.forbidden',
	reseau: 'costs.actuals.refused.network',
	inconnu: 'costs.actuals.refused.unknown',
}

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const FORMAT_MONTANT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const dateEnMots = (iso: string) => FORMAT_DATE.format(new Date(`${iso}T00:00:00Z`))

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text'

export type ProprietesReelsLigne = {
	readonly client: ClientCrm
	readonly idLigne: string
	readonly nature: string
	readonly devise: string
	readonly soldee: boolean
	/** Après chaque geste réussi : la fiche relit ses lignes, dont le réel a été recalculé par la base. */
	readonly onChange: (annonce: string) => void
	readonly aujourdhui?: string
}

export function ReelsLigne({ client, idLigne, nature, devise, soldee, onChange, aujourdhui = jourLocal(new Date()) }: ProprietesReelsLigne) {
	const droit = useRefus()
	const [reels, setReels] = useState<EtatAsync<readonly Reel[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [enEdition, setEnEdition] = useState<string | null>(null)
	const [aRetirer, setARetirer] = useState<Reel | null>(null)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	// LA CASE BASCULE AU CLIC, sans attendre la réponse : une case qui ne change pas sous le doigt se lit comme
	// cassée. Elle revient en arrière si la base refuse, et rend la main à la propriété dès que la fiche relue l'a
	// rejointe.
	const [coche, setCoche] = useState<boolean | null>(null)
	useEffect(() => {
		if (coche !== null && coche === soldee) setCoche(null)
	}, [coche, soldee])
	const idMotif = useId()

	useEffect(() => {
		let courant = true
		setReels(enChargement)
		void lireReels(client, idLigne).then((etat) => {
			if (courant) setReels(etat)
		})
		return () => {
			courant = false
		}
	}, [client, idLigne, tentative])

	const apres = (annonce: string) => {
		setRefus(null)
		setEnEdition(null)
		setARetirer(null)
		setTentative((n) => n + 1)
		onChange(annonce)
	}

	const geste = async (action: () => Promise<{ readonly ok: boolean; readonly motif?: MotifRefusReel }>, annonce: string) => {
		setEnCours(true)
		const issue = await action()
		setEnCours(false)
		if (issue.ok) apres(annonce)
		else setRefus(REFUS[issue.motif ?? 'inconnu'])
	}

	const montant = (valeur: number) => t('costs.actuals.amount', { montant: FORMAT_MONTANT.format(valeur), devise })

	return (
		<div className="flex flex-col gap-3 rounded-md bg-bg p-3" data-testid="reels-ligne">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="text-sm font-medium">{t('costs.actuals.title', { nature })}</h4>
				<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
					<input {...droit}
						type="checkbox"
						checked={coche ?? soldee}
						disabled={droit.disabled === true || (enCours)}
						onChange={(e) => {
							const voulu = e.target.checked
							setCoche(voulu)
							void (async () => {
								setEnCours(true)
								const issue = await solderLigne(client, idLigne, voulu)
								setEnCours(false)
								if (issue.ok) apres(t(voulu ? 'costs.actuals.settled.done' : 'costs.actuals.settled.undone', { nature }))
								else {
									setCoche(null)
									setRefus(REFUS[issue.motif])
								}
							})()
						}}
						aria-label={t('costs.actuals.settle.aria', { nature })}
						data-testid="reels-solde"
						className="size-6 accent-[var(--color-brand)]"
					/>
					{t('costs.actuals.settle')}
				</label>
			</div>

			{soldee ? (
				<p id={idMotif} className="text-sm text-text-2" data-testid="reels-motif-solde">
					{t('costs.actuals.settled.reason')}
				</p>
			) : null}

			{refus !== null ? (
				<p role="alert" className="text-sm text-danger-on-soft">
					{t(refus)}
				</p>
			) : null}

			{reels.statut === 'chargement' ? (
				<p className="text-sm text-text-2">{t('state.loading.aria')}</p>
			) : reels.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger-on-soft">
					{t('costs.actuals.error')}
				</p>
			) : reels.donnees.length === 0 ? (
				<p className="text-sm text-text-2">{soldee ? t('costs.actuals.none.settled') : t('costs.actuals.none')}</p>
			) : (
				<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
					{reels.donnees.map((reel) =>
						enEdition === reel.id ? (
							<li key={reel.id} className="p-2">
								<FormulaireReel
									initial={{ montant: String(reel.amount), date: reel.spent_on, libelle: reel.label ?? '' }}
									aujourdhui={aujourdhui}
									libelleAction={t('costs.actuals.save')}
									enCours={enCours}
									onValider={(saisie) => void geste(() => modifierReel(client, reel.id, saisie), t('costs.actuals.updated', { nature }))}
									onAnnuler={() => setEnEdition(null)}
								/>
							</li>
						) : (
							<li key={reel.id} className="flex min-h-[var(--size-target)] flex-wrap items-center gap-3 px-3 py-1" data-testid="reel">
								<span className="text-sm text-text-2 tabular-nums">{dateEnMots(reel.spent_on)}</span>
								<span className={`min-w-0 flex-1 text-sm ${reel.label === null ? 'text-text-2' : ''}`}>
									{reel.label ?? t('costs.actuals.nolabel')}
								</span>
								<span className="whitespace-nowrap text-sm tabular-nums">{montant(reel.amount)}</span>
								<span className="flex gap-1">
									<Button {...droit}
										variante="discret"
										taille="compacte"
										disabled={droit.disabled === true || (soldee || enCours)}
										aria-label={t('costs.actuals.edit.aria', { date: dateEnMots(reel.spent_on) })}
										{...(soldee ? { 'aria-describedby': idMotif, title: t('costs.actuals.settled.reason') } : {})}
										onClick={() => setEnEdition(reel.id)}
									>
										<Pencil aria-hidden="true" size={16} />
									</Button>
									<Button {...droit}
										variante="discret"
										taille="compacte"
										disabled={droit.disabled === true || (soldee || enCours)}
										aria-label={t('costs.actuals.delete.aria', { date: dateEnMots(reel.spent_on) })}
										{...(soldee ? { 'aria-describedby': idMotif, title: t('costs.actuals.settled.reason') } : {})}
										onClick={() => setARetirer(reel)}
									>
										<Trash2 aria-hidden="true" size={16} />
									</Button>
								</span>
							</li>
						),
					)}
				</ul>
			)}

			{aRetirer !== null ? (
				<Confirmation
					question={t('costs.actuals.delete.confirm', { montant: montant(aRetirer.amount), date: dateEnMots(aRetirer.spent_on) })}
					onConfirmer={() => void geste(() => supprimerReel(client, aRetirer.id), t('costs.actuals.deleted', { nature }))}
					onAnnuler={() => setARetirer(null)}
				/>
			) : null}

			{!soldee ? (
				<FormulaireReel
					initial={{ montant: '', date: aujourdhui, libelle: '' }}
					aujourdhui={aujourdhui}
					libelleAction={t('costs.actuals.add')}
					enCours={enCours}
					onValider={(saisie) => void geste(() => ajouterReel(client, idLigne, saisie), t('costs.actuals.added', { nature }))}
				/>
			) : null}
		</div>
	)
}

type ChampsReel = { readonly montant: string; readonly date: string; readonly libelle: string }

function FormulaireReel({
	initial,
	aujourdhui,
	libelleAction,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly initial: ChampsReel
	readonly aujourdhui: string
	readonly libelleAction: string
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieReel) => void
	readonly onAnnuler?: () => void
}) {
	const droit = useRefus()
	const [champs, setChamps] = useState(initial)
	const [invalide, setInvalide] = useState(false)
	const idErreur = useId()

	const envoyer = (e: FormEvent) => {
		e.preventDefault()
		const lu = lireMontant(champs.montant)
		if (lu.statut !== 'lu') {
			setInvalide(true)
			return
		}
		setInvalide(false)
		onValider({ montant: lu.montant, date: champs.date === '' ? null : champs.date, libelle: champs.libelle })
		if (onAnnuler === undefined) setChamps({ montant: '', date: aujourdhui, libelle: '' })
	}

	return (
		<form onSubmit={envoyer} className="flex flex-wrap items-end gap-2" data-testid="reels-formulaire">
			<label className="flex flex-col gap-1 text-sm text-text-2">
				{t('costs.actuals.form.amount')}
				<input
					inputMode="decimal"
					value={champs.montant}
					onChange={(e) => setChamps((c) => ({ ...c, montant: e.target.value }))}
					aria-invalid={invalide ? true : undefined}
					{...(invalide ? { 'aria-describedby': idErreur } : {})}
					className={`${CLASSES_CHAMP} w-[12ch] text-right tabular-nums`}
				/>
			</label>
			<label className="flex flex-col gap-1 text-sm text-text-2">
				{t('costs.actuals.form.date')}
				<input
					type="date"
					value={champs.date}
					onChange={(e) => setChamps((c) => ({ ...c, date: e.target.value }))}
					className={CLASSES_CHAMP}
				/>
			</label>
			<label className="flex min-w-0 flex-1 basis-[12rem] flex-col gap-1 text-sm text-text-2">
				{t('costs.actuals.form.label')}
				<input
					value={champs.libelle}
					onChange={(e) => setChamps((c) => ({ ...c, libelle: e.target.value }))}
					placeholder={t('costs.actuals.form.label.placeholder')}
					className={CLASSES_CHAMP}
				/>
			</label>
			<Button {...droit} type="submit" variante="secondaire" taille="compacte" disabled={enCours}>
				{libelleAction}
			</Button>
			{onAnnuler !== undefined ? (
				<Button type="button" variante="discret" taille="compacte" onClick={onAnnuler}>
					{t('costs.actuals.cancel')}
				</Button>
			) : null}
			{invalide ? (
				<p id={idErreur} role="alert" className="basis-full text-sm text-danger-on-soft">
					{t('card.costs.form.amount.invalid')}
				</p>
			) : null}
		</form>
	)
}

function Confirmation({ question, onConfirmer, onAnnuler }: { readonly question: string; readonly onConfirmer: () => void; readonly onAnnuler: () => void }) {
	const action = useRef<HTMLButtonElement | null>(null)
	// Le focus entre sur le bouton d'action — patron du §5.29.
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" data-testid="reels-confirmation">
			<p className="text-sm font-medium">{question}</p>
			<div className="flex gap-2">
				<Button ref={action} variante="destructif" taille="compacte" onClick={onConfirmer}>
					{t('costs.actuals.delete.action')}
				</Button>
				<Button variante="secondaire" taille="compacte" onClick={onAnnuler}>
					{t('costs.actuals.cancel')}
				</Button>
			</div>
		</div>
	)
}
