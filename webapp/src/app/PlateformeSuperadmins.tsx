// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : les superadministrateurs en base, l'octroi et le retrait du drapeau
// @spec docs/SPEC-plateforme.md §2 (les deux sources du drapeau), §6.5 (`plateforme_superadmins`,
//       `plateforme_poser_superadmin`, dernier superadministrateur), §10 (les porteurs d'`admin` LeLabs ne sont pas
//       listés) ; docs/DESIGN_SYSTEM.md §5.56, §5.9, §5.16 (« Amorçage » est un fait à nommer), §5.27
// @spec CLAUDE.md §10 — le dernier superadministrateur est gardé par la base ; l'écran traduit son refus

import { ShieldMinus, ShieldPlus } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireSuperadmins, poserSuperadmin, type RefusPlateforme, type SuperadminPlateforme } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { formaterDate, texteRefus } from './presentation-plateforme'
import { RecherchePersonne } from './RecherchePersonne'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_DATE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'

type Message = { readonly ton: 'succes' | 'refus'; readonly texte: string } | null
type Ouverture = { readonly type: 'accorder' } | { readonly type: 'retirer'; readonly sub: string } | null

export function PlateformeSuperadmins({ client }: { readonly client: ClientCrm }) {
	const [etat, setEtat] = useState<EtatAsync<readonly SuperadminPlateforme[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [message, setMessage] = useState<Message>(null)
	const commandeAccorder = useRef<HTMLButtonElement>(null)
	const rendreFocus = useRef(false)

	useEffect(() => {
		let vivant = true
		void lireSuperadmins(client).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	useEffect(() => {
		if (ouverture === null && rendreFocus.current) {
			rendreFocus.current = false
			commandeAccorder.current?.focus()
		}
	}, [ouverture])

	const relire = useCallback(() => setTentative((n) => n + 1), [])
	const ouvrir = (suivante: Ouverture) => {
		setOuverture(suivante)
		setMessage(null)
	}

	if (etat.statut === 'chargement') return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.superadmins.erreur.title')}
				corps={t('platform.superadmins.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={relire}
			/>
		)
	}

	const retirer = async (superadmin: SuperadminPlateforme) => {
		const issue = await poserSuperadmin(client, superadmin.sub, false)
		setOuverture(null)
		setMessage(
			issue.statut === 'ok'
				? { ton: 'succes', texte: t('platform.superadmins.retire', { nom: superadmin.nom }) }
				: { ton: 'refus', texte: texteRefus(issue.refus) },
		)
		relire()
	}

	return (
		<section aria-labelledby="titre-superadmins" className="flex flex-col gap-4">
			<h2 id="titre-superadmins" className="text-h2">
				{t('platform.superadmins.titre')}
			</h2>
			<p className="text-text-2">{t('platform.superadmins.lelabs')}</p>
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-superadmins" className="w-full border-collapse">
					<caption className="sr-only">{t('platform.superadmins.titre')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.nom')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.superadmins.colonne.accordePar')}</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.colonne.depuis')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.colonne.commandes')}</th>
						</tr>
					</thead>
					<tbody>
						{etat.donnees.map((superadmin) => (
							<LigneSuperadmin
								key={superadmin.sub}
								superadmin={superadmin}
								confirmation={ouverture?.type === 'retirer' && ouverture.sub === superadmin.sub}
								onRetirer={() => ouvrir({ type: 'retirer', sub: superadmin.sub })}
								onAnnuler={() => setOuverture(null)}
								onConfirmer={() => retirer(superadmin)}
							/>
						))}
					</tbody>
				</table>
			</div>
			{message !== null &&
				(message.ton === 'succes' ? (
					<p role="status" data-testid="message-superadmins" className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm">
						{message.texte}
					</p>
				) : (
					<p role="alert" data-testid="message-superadmins" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
						{message.texte}
					</p>
				))}
			{ouverture?.type === 'accorder' ? (
				<FormulaireAccorder
					client={client}
					exclus={new Set(etat.donnees.map((superadmin) => superadmin.sub))}
					onFermer={() => {
						rendreFocus.current = true
						setOuverture(null)
					}}
					onAccorde={(nom) => {
						setOuverture(null)
						setMessage({ ton: 'succes', texte: t('platform.superadmins.accorde', { nom }) })
						relire()
					}}
				/>
			) : (
				<div>
					<Button ref={commandeAccorder} onClick={() => ouvrir({ type: 'accorder' })} data-testid="accorder-superadmin">
						<ShieldPlus aria-hidden="true" size={18} />
						{t('platform.superadmins.accorder')}
					</Button>
				</div>
			)}
		</section>
	)
}

function LigneSuperadmin({
	superadmin,
	confirmation,
	onRetirer,
	onAnnuler,
	onConfirmer,
}: {
	readonly superadmin: SuperadminPlateforme
	readonly confirmation: boolean
	readonly onRetirer: () => void
	readonly onAnnuler: () => void
	readonly onConfirmer: () => Promise<void>
}) {
	const commande = useRef<HTMLButtonElement>(null)
	const [envoi, setEnvoi] = useState(false)
	// La commande est désactivée pendant sa confirmation : le focus lui est rendu une fois réactivée (§5.29 2 b-2 c).
	const rendreFocus = useRef(false)
	useEffect(() => {
		if (!confirmation && rendreFocus.current) {
			rendreFocus.current = false
			commande.current?.focus()
		}
	}, [confirmation])
	const annuler = () => {
		rendreFocus.current = true
		onAnnuler()
	}
	return (
		<Fragment>
			<tr data-testid="ligne-superadmin" data-sub={superadmin.sub} className="border-b border-border hover:bg-hover">
				<td className={CLASSES_CELLULE} title={superadmin.nom}>{superadmin.nom}</td>
				{/* Un drapeau amorcé n'a pas d'auteur : c'est un fait à nommer, pas une cellule vide (§5.16). */}
				<td className={CLASSES_CELLULE}>{superadmin.accordePar ?? t('platform.amorcage')}</td>
				<td className={CLASSES_DATE}>{formaterDate(superadmin.accordeLe)}</td>
				<td className="h-[var(--size-target)] px-3 whitespace-nowrap">
					<Button
						ref={commande}
						variante="discret"
						taille="compacte"
						disabled={confirmation}
						onClick={onRetirer}
						aria-label={t('platform.superadmins.retirer.aria', { nom: superadmin.nom })}
					>
						<ShieldMinus aria-hidden="true" size={16} />
						{t('platform.superadmins.retirer')}
					</Button>
				</td>
			</tr>
			{confirmation && (
				<tr>
					<td colSpan={4} className="p-0">
						<div
							role="group"
							aria-labelledby={`question-superadmin-${superadmin.sub}`}
							onKeyDown={(e) => e.key === 'Escape' && annuler()}
							className="sticky left-0 max-w-[calc(100vw-32px)] flex flex-col gap-3 bg-surface border-b border-border p-4"
						>
							<p id={`question-superadmin-${superadmin.sub}`} className="font-medium">
								{t('platform.superadmins.confirmation', { nom: superadmin.nom })}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variante="destructif"
									autoFocus
									disabled={envoi}
									onClick={() => {
										setEnvoi(true)
										void onConfirmer().finally(() => setEnvoi(false))
									}}
								>
									{envoi ? t('platform.envoi') : t('platform.superadmins.retirer.confirmer')}
								</Button>
								<Button onClick={annuler}>{t('platform.annuler')}</Button>
							</div>
						</div>
					</td>
				</tr>
			)}
		</Fragment>
	)
}

function FormulaireAccorder({
	client,
	exclus,
	onFermer,
	onAccorde,
}: {
	readonly client: ClientCrm
	readonly exclus: ReadonlySet<string>
	readonly onFermer: () => void
	readonly onAccorde: (nom: string) => void
}) {
	const [choix, setChoix] = useState('')
	const [nom, setNom] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const champ = useRef<HTMLInputElement>(null)
	useEffect(() => champ.current?.focus(), [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await poserSuperadmin(client, choix, true)
		setEnvoi(false)
		if (issue.statut === 'refus') setRefus(issue.refus)
		else onAccorde(nom)
	}

	return (
		<form
			onSubmit={(e) => void soumettre(e)}
			onKeyDown={(e) => e.key === 'Escape' && onFermer()}
			aria-label={t('platform.superadmins.accorder')}
			data-testid="formulaire-superadmin"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<RecherchePersonne
				client={client}
				exclus={exclus}
				choix={choix}
				onChoix={(id, libelle) => {
					setChoix(id)
					setNom(libelle)
				}}
				aide={t('platform.superadmins.recherche.aide')}
				refChamp={champ}
			/>
			{refus !== null && (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{texteRefus(refus)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi || choix === ''}>
					{envoi ? t('platform.envoi') : t('platform.superadmins.accorder.confirmer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}
