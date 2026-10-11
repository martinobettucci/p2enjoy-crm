// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ « Coût du personnel »
// @spec docs/SPEC-temps.md §3.1 (versions immuables ; pas de date passée sauf pour la première ; seule une version
//       programmée se retire), §5.2 (administrateurs seuls, règle tenue en base), §7.4 (la liste des personnes, le coût
//       en vigueur, la prochaine version, l'ajout, l'historique, le retrait d'une version programmée) ;
//       docs/DESIGN_SYSTEM.md §5.54 (une carte par personne), §5.13 (confirmation en ligne), §5.7, §5.8, §8
//
// L'écran reflète les règles sans les tenir : la date minimale du formulaire et l'absence de corbeille sur une version
// en vigueur sont des aides, la base refuse de toute façon et l'écran dit son refus.

import { History, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	creerVersion,
	estProgrammee,
	lirePersonnes,
	lireVersions,
	prochaineVersion,
	supprimerVersion,
	versionEnVigueur,
	type MotifRefusVersion,
	type Personne,
	type VersionCout,
} from '../lib/cout-personnel'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { jourLocal } from '../lib/temps'
import { useContexteEspace } from './ContexteEspace'

const FORMAT_MONTANT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateEnMots = (iso: string) => FORMAT_DATE.format(new Date(`${iso}T00:00:00Z`))
const coutEnMots = (v: VersionCout) => t('staffCost.perQuarter', { montant: FORMAT_MONTANT.format(v.cout_quart), devise: v.devise })

const REFUS: Readonly<Record<MotifRefusVersion, CleTraduction>> = {
	retroactive: 'staffCost.refused.retroactive',
	'en-vigueur': 'staffCost.refused.inForce',
	doublon: 'staffCost.refused.duplicate',
	'hors-espace': 'staffCost.refused.outside',
	forme: 'staffCost.refused.shape',
	droit: 'staffCost.refused.forbidden',
	reseau: 'staffCost.refused.network',
	inconnu: 'staffCost.refused.unknown',
}

type Donnees = { readonly personnes: readonly Personne[]; readonly versions: readonly VersionCout[] }

export type ProprietesReglagesCoutPersonnel = { readonly client?: ClientCrm | null; readonly aujourdhui?: string }

export function ReglagesCoutPersonnel({ client = clientCrm, aujourdhui = jourLocal(new Date()) }: ProprietesReglagesCoutPersonnel = {}) {
	const { idWorkspace, estAdmin } = useContexteEspace()
	const [etat, setEtat] = useState<EtatAsync<Donnees>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [annonce, setAnnonce] = useState('')

	useEffect(() => {
		if (client === null || idWorkspace === null || !estAdmin) return
		let courant = true
		setEtat(enChargement)
		void Promise.all([lirePersonnes(client, idWorkspace), lireVersions(client, idWorkspace)]).then(([personnes, versions]) => {
			if (!courant) return
			if (personnes.statut !== 'pret') return setEtat(personnes)
			if (versions.statut !== 'pret') return setEtat(versions)
			setEtat({ statut: 'pret', donnees: { personnes: personnes.donnees, versions: versions.donnees } })
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, estAdmin, tentative])

	const recharger = useCallback(() => setTentative((n) => n + 1), [])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('staffCost.noworkspace.body')} />
	}
	if (!estAdmin) {
		return <EtatRefus titre={t('staffCost.forbidden.title')} corps={t('staffCost.forbidden.body')} />
	}

	return (
		<div className="flex max-w-[960px] flex-col gap-4" data-testid="cout-personnel">
			<h2 className="text-h3">{t('staffCost.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('staffCost.intro')}</p>
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<EtatErreur
					titre={t('state.error.title')}
					corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={recharger}
				/>
			) : etat.donnees.personnes.length === 0 ? (
				<EtatVide titre={t('staffCost.empty.title')} corps={t('staffCost.empty.body')} />
			) : (
				<ul className="flex flex-col gap-3">
					{etat.donnees.personnes.map((personne) => (
						<CartePersonne
							key={personne.id}
							client={client}
							idWorkspace={idWorkspace}
							personne={personne}
							versions={etat.donnees.versions.filter((v) => v.profile_id === personne.id)}
							aujourdhui={aujourdhui}
							onChange={(message) => {
								setAnnonce(message)
								recharger()
							}}
						/>
					))}
				</ul>
			)}
			<LiveRegion libelle={t('staffCost.live.aria')} message={annonce} />
		</div>
	)
}

function CartePersonne({
	client,
	idWorkspace,
	personne,
	versions,
	aujourdhui,
	onChange,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly personne: Personne
	readonly versions: readonly VersionCout[]
	readonly aujourdhui: string
	readonly onChange: (annonce: string) => void
}) {
	const [formulaire, setFormulaire] = useState(false)
	const [historique, setHistorique] = useState(false)
	const [aRetirer, setARetirer] = useState<VersionCout | null>(null)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const idHistorique = useId()
	const enVigueur = versionEnVigueur(versions, aujourdhui)
	const prochaine = prochaineVersion(versions, aujourdhui)

	const retirer = async (version: VersionCout) => {
		const issue = await supprimerVersion(client, version.id)
		setARetirer(null)
		if (issue.ok) onChange(t('staffCost.deleted', { nom: personne.nom }))
		else setRefus(REFUS[issue.motif])
	}

	return (
		<li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" data-testid="cout-personne" data-personne={personne.id}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium">{personne.nom}</h3>
					<p className="tabular-nums" data-testid="cout-en-vigueur">
						{enVigueur === null ? t('staffCost.none') : coutEnMots(enVigueur)}
					</p>
					{prochaine !== null ? (
						<p className="text-sm text-text-2" data-testid="cout-prochain">
							{t('staffCost.next', { cout: coutEnMots(prochaine), date: dateEnMots(prochaine.date_effet) })}
						</p>
					) : null}
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variante="secondaire" taille="compacte" onClick={() => setFormulaire((v) => !v)} aria-expanded={formulaire}>
						<Plus aria-hidden="true" size={16} />
						{t('staffCost.add')}
					</Button>
					{versions.length > 0 ? (
						<Button
							variante="secondaire"
							taille="compacte"
							onClick={() => setHistorique((v) => !v)}
							aria-expanded={historique}
							aria-controls={idHistorique}
						>
							<History aria-hidden="true" size={16} />
							{t('staffCost.history')}
						</Button>
					) : null}
				</div>
			</div>

			{refus !== null ? (
				<p role="alert" className="text-sm text-danger">
					{t(refus)}
				</p>
			) : null}

			{formulaire ? (
				<FormulaireVersion
					client={client}
					idWorkspace={idWorkspace}
					personne={personne}
					premiere={versions.length === 0}
					aujourdhui={aujourdhui}
					onCree={() => {
						setFormulaire(false)
						setRefus(null)
						onChange(t('staffCost.created', { nom: personne.nom }))
					}}
					onAnnuler={() => setFormulaire(false)}
				/>
			) : null}

			{historique ? (
				<ul id={idHistorique} className="flex flex-col divide-y divide-border rounded-md border border-border" data-testid="cout-historique">
					{versions.map((version) => (
						<li key={version.id} className="flex min-h-[var(--size-target)] flex-wrap items-center gap-3 px-3 py-2">
							<span className="min-w-0 flex-1 tabular-nums">
								{t('staffCost.from', { cout: coutEnMots(version), date: dateEnMots(version.date_effet) })}
							</span>
							{estProgrammee(version, aujourdhui) ? (
								<Button
									variante="discret"
									taille="compacte"
									aria-label={t('staffCost.delete.aria', { date: dateEnMots(version.date_effet) })}
									onClick={() => setARetirer(version)}
								>
									<Trash2 aria-hidden="true" size={16} />
								</Button>
							) : (
								<span className="text-[13px] text-text-2">
									{version === enVigueur ? t('staffCost.inForce') : t('staffCost.past')}
								</span>
							)}
						</li>
					))}
				</ul>
			) : null}

			{aRetirer !== null ? (
				<ConfirmationRetrait
					version={aRetirer}
					nom={personne.nom}
					onConfirmer={() => void retirer(aRetirer)}
					onAnnuler={() => setARetirer(null)}
				/>
			) : null}
		</li>
	)
}

function FormulaireVersion({
	client,
	idWorkspace,
	personne,
	premiere,
	aujourdhui,
	onCree,
	onAnnuler,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly personne: Personne
	readonly premiere: boolean
	readonly aujourdhui: string
	readonly onCree: () => void
	readonly onAnnuler: () => void
}) {
	const [cout, setCout] = useState('')
	const [devise, setDevise] = useState('EUR')
	const [date, setDate] = useState(aujourdhui)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const premierChamp = useRef<HTMLInputElement>(null)
	useEffect(() => {
		premierChamp.current?.focus()
	}, [])

	const envoyer = async (e: FormEvent) => {
		e.preventDefault()
		const valeur = Number(cout.trim().replace(',', '.'))
		if (cout.trim() === '' || !Number.isFinite(valeur)) return setRefus('staffCost.invalid.amount')
		setEnCours(true)
		const issue = await creerVersion(client, {
			idWorkspace,
			idPersonne: personne.id,
			dateEffet: date,
			coutQuart: valeur,
			devise: devise.trim().toUpperCase(),
		})
		setEnCours(false)
		if (issue.ok) onCree()
		else setRefus(REFUS[issue.motif])
	}

	return (
		<form onSubmit={(e) => void envoyer(e)} className="flex flex-wrap items-end gap-3 rounded-md bg-hover p-3" data-testid="cout-formulaire">
			<label className="flex flex-col gap-1 text-sm">
				{t('staffCost.form.amount')}
				<input
					ref={premierChamp}
					inputMode="decimal"
					value={cout}
					onChange={(e) => setCout(e.target.value)}
					className="min-h-[var(--size-target)] w-[12ch] rounded-sm border border-border bg-surface px-3 text-right tabular-nums"
				/>
			</label>
			<label className="flex flex-col gap-1 text-sm">
				{t('staffCost.form.currency')}
				<input
					value={devise}
					maxLength={3}
					onChange={(e) => setDevise(e.target.value)}
					className="min-h-[var(--size-target)] w-[8ch] rounded-sm border border-border bg-surface px-3 uppercase"
				/>
			</label>
			<label className="flex flex-col gap-1 text-sm">
				{t('staffCost.form.date')}
				<input
					type="date"
					value={date}
					{...(premiere ? {} : { min: aujourdhui })}
					onChange={(e) => setDate(e.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
				/>
			</label>
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" taille="compacte" disabled={enCours}>
					{t('staffCost.form.submit')}
				</Button>
				<Button type="button" variante="secondaire" taille="compacte" onClick={onAnnuler}>
					{t('staffCost.form.cancel')}
				</Button>
			</div>
			<p className="basis-full text-[13px] text-text-2">{premiere ? t('staffCost.form.firstHint') : t('staffCost.form.hint')}</p>
			{refus !== null ? (
				<p role="alert" className="basis-full text-sm text-danger">
					{t(refus)}
				</p>
			) : null}
		</form>
	)
}

function ConfirmationRetrait({
	version,
	nom,
	onConfirmer,
	onAnnuler,
}: {
	readonly version: VersionCout
	readonly nom: string
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const action = useRef<HTMLButtonElement | null>(null)
	// Le focus entre sur le bouton d'action — patron du §5.29.
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4" data-testid="cout-confirmation">
			<p className="font-medium">
				{t('staffCost.delete.confirm', { cout: coutEnMots(version), date: dateEnMots(version.date_effet), nom })}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button ref={action} variante="destructif" taille="compacte" onClick={onConfirmer}>
					{t('staffCost.delete.action')}
				</Button>
				<Button variante="secondaire" taille="compacte" onClick={onAnnuler}>
					{t('staffCost.form.cancel')}
				</Button>
			</div>
		</div>
	)
}
