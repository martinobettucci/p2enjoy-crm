// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.2 : le bloc « Rattachements » de la fiche — une ligne par rattachement
//       lisible, celui de la fiche marqué, les autres en liens vers leur adresse, archiver et désarchiver
// @spec docs/SPEC-rattachements.md §5 (archiver, désarchiver), §8.1 (décision 823) ; docs/DESIGN_SYSTEM.md §5.82, §5.3 bis
//       (« Aucun responsable », la pilule « Archivé »), §5.3 quater (la pastille de sommeil), §5.54 (le chemin)
//
// LE BLOC NE DÉCIDE D'AUCUN DROIT. La base dit, par `channels.ecriture_permise`, quels channels l'appelant écrit : la
// commande d'un channel refusé est éteinte avec le motif du bloc (§5.59), et la politique `card_placements_update` reste
// la règle — un refus qui survient malgré tout se dit dans la ligne. Un succès fait relire la fiche en place : l'en-tête
// et le bloc disent alors le même état, sans écran de chargement intermédiaire.
// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.3 : « Rattacher à un channel », replié en formulaire sous la liste ; le
//       succès ouvre la fiche du nouveau rattachement (docs/SPEC-rattachements.md §5 ; docs/DESIGN_SYSTEM.md §5.83)
// @spec docs/DESIGN_SYSTEM.md §5.59 (la commande refusée par une capacité de la base, un motif par bloc) ;
//       docs/SPEC-droits-interface.md §2 à §4

import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Archive, ArchiveRestore, Moon, Plus, TriangleAlert } from 'lucide-react'
import { useRefus } from '../components/ui/RefusCommandes'
import { CHEMIN_ADMIN_WORKFLOWS } from './chemins'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { enChargement, type EtatAsync } from '../lib/async'
import { capaciteDansLEtat, lireEcrituresPermises, motifVisible, proprietesCommande, type Capacite } from '../lib/capacites'
import { t } from '../i18n'
import {
	archiverRattachement,
	lireChannelsRattachables,
	rattacherAffaire,
	type ChannelRattachable,
	type IssueArchivage,
	type RefusRattachement,
} from '../lib/bloc-rattachements'
import { formaterMontant } from '../lib/entete-card'
import type { RattachementDuBloc } from '../lib/formulaire'
import { estEnSommeil, formaterEcheanceSommeil } from '../lib/sommeil-card'
import { clientCrm, type ClientCrm } from '../lib/supabase'

export function BlocRattachementsCard({
	idCard,
	idWorkspace,
	devise,
	rattachements,
	onChange,
	client = clientCrm,
	maintenant = () => new Date(),
}: {
	readonly idCard: string
	readonly idWorkspace: string
	readonly devise: string
	readonly rattachements: readonly RattachementDuBloc[]
	/** Un archivage a réussi : la fiche se relit en place. */
	readonly onChange: () => void
	readonly client?: ClientCrm | null
	readonly maintenant?: () => Date
}) {
	// UNE REQUÊTE POUR TOUTES LES LIGNES (§5.59) : les channels des rattachements, relus si la liste change.
	const idsChannels = rattachements.map((rattachement) => rattachement.idChannel)
	const cle = idsChannels.join(',')
	const [capacites, setCapacites] = useState<EtatAsync<Readonly<Record<string, boolean>>>>(enChargement)
	useEffect(() => {
		if (client === null) return
		let vivant = true
		setCapacites(enChargement())
		void lireEcrituresPermises(client, 'channels', cle === '' ? [] : cle.split(',')).then((etat) => {
			if (vivant) setCapacites(etat)
		})
		return () => {
			vivant = false
		}
	}, [client, cle])
	const capaciteDe = (idChannel: string): Capacite => (client === null ? 'inconnue' : capaciteDansLEtat(capacites, idChannel))
	const unRefus = idsChannels.some((idChannel) => motifVisible(capaciteDe(idChannel)))

	return (
		<section
			data-testid="bloc-rattachements"
			aria-labelledby="bloc-rattachements-titre"
			className="flex flex-col gap-3 border-t border-border pt-4"
		>
			<h2 id="bloc-rattachements-titre" className="text-h3">
				{t('cardPlacements.title')}
			</h2>
			{unRefus ? <MotifLectureSeule id={ID_MOTIF_RATTACHEMENTS}>{t('rights.readonly.placements')}</MotifLectureSeule> : null}
			<ul className="flex flex-col divide-y divide-border">
				{rattachements.map((rattachement) => (
					<LigneRattachement
						key={rattachement.id}
						idCard={idCard}
						devise={devise}
						capacite={capaciteDe(rattachement.idChannel)}
						rattachement={rattachement}
						onChange={onChange}
						client={client}
						maintenant={maintenant}
					/>
				))}
			</ul>
			<Rattacher
				idCard={idCard}
				idWorkspace={idWorkspace}
				exclus={idsChannels}
				client={client}
			/>
		</section>
	)
}

const CLASSES_CHAMP = 'min-h-[var(--size-target)] px-3 rounded-sm max-w-full border border-border bg-surface text-ink'
const CLES_REFUS: Readonly<Record<RefusRattachement, Parameters<typeof t>[0]>> = {
	'channel-introuvable': 'cardPlacements.attach.refused.channel',
	'channel-ferme': 'cardPlacements.attach.refused.closed',
	interdit: 'cardPlacements.attach.refused.forbidden',
	'deja-rattachee': 'cardPlacements.attach.refused.already',
	'sans-etape-initiale': 'cardPlacements.attach.refused.initial',
	'affaire-introuvable': 'cardPlacements.attach.refused.card',
	reseau: 'cardPlacements.attach.refused.network',
}

/**
 * « Rattacher à un channel » (§5.83) : la commande, repliée en formulaire dans le flux. La liste des channels est une
 * commodité ; `attach_card` tient la règle, et son refus est traduit sous le champ, le choix conservé.
 */
function Rattacher({
	idCard,
	idWorkspace,
	exclus,
	client,
}: {
	readonly idCard: string
	readonly idWorkspace: string
	readonly exclus: readonly string[]
	readonly client: ClientCrm | null
}) {
	const droit = useRefus()
	const naviguer = useNavigate()
	const [ouvert, setOuvert] = useState(false)
	const [offerts, setOfferts] = useState<readonly ChannelRattachable[] | null>(null)
	const [choix, setChoix] = useState('')
	const [refus, setRefus] = useState<RefusRattachement | null>(null)
	const [enVol, setEnVol] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	const champ = useRef<HTMLSelectElement>(null)
	const annuler = useRef<HTMLButtonElement>(null)
	const rendreLeFocus = useRef(false)
	const idChamp = useId()
	const idRefus = useId()

	useEffect(() => {
		if (!ouvert || client === null) return
		let vivant = true
		void lireChannelsRattachables(client, idWorkspace, new Set(exclus)).then((etat) => {
			// UN ÉCHEC DE LECTURE N'EMPÊCHE RIEN : la liste reste vide, et la phrase le dit (§5.83).
			if (vivant) setOfferts(etat.statut === 'pret' ? etat.donnees : [])
		})
		return () => {
			vivant = false
		}
		// La liste se relit à chaque ouverture ; `exclus` est stable entre deux relectures de la fiche.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ouvert, client, idWorkspace])

	useEffect(() => {
		// Le focus entre dans le formulaire (§5.23) : le champ, ou « Annuler » quand aucun channel n'est offert.
		if (ouvert && offerts !== null) (offerts.length === 0 ? annuler.current : champ.current)?.focus()
	}, [ouvert, offerts])
	useEffect(() => {
		if (ouvert || !rendreLeFocus.current) return
		rendreLeFocus.current = false
		commande.current?.focus()
	}, [ouvert])

	const fermer = () => {
		rendreLeFocus.current = true
		setOuvert(false)
		setOfferts(null)
		setChoix('')
		setRefus(null)
	}

	const envoyer = async () => {
		if (client === null || enVol) return
		setEnVol(true)
		const issue = await rattacherAffaire(client, idCard, choix)
		setEnVol(false)
		if (!issue.ok) {
			setRefus(issue.refus)
			return
		}
		const cible = offerts?.find((offert) => offert.id === choix)
		// LE SUCCÈS OUVRE LA FICHE DU NOUVEAU RATTACHEMENT (§5.83) : c'est là qu'on règle son étape et son responsable.
		if (cible !== undefined) naviguer(`/tracks/${cible.slugTrack}/${cible.slugChannel}/cards/${idCard}`)
	}

	if (!ouvert) {
		return (
			<Button
				ref={commande}
				variante="secondaire"
				taille="compacte"
				data-testid="ouvrir-rattacher"
				className="self-start"
				{...droit}
				onClick={() => setOuvert(true)}
			>
				<Plus aria-hidden="true" className="size-4" />
				{t('cardPlacements.attach')}
			</Button>
		)
	}

	return (
		<form
			data-testid="formulaire-rattacher"
			className="flex flex-col gap-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') fermer()
			}}
		>
			{offerts === null ? null : offerts.length === 0 ? (
				<p data-testid="aucun-channel-rattachable" className="text-sm text-text-2">
					{t('cardPlacements.attach.none')}
				</p>
			) : (
				<label htmlFor={idChamp} className="flex flex-col gap-1 text-sm text-text-2 min-w-0 max-w-[48ch]">
					{t('cardPlacements.attach.channel')}
					<select
						id={idChamp}
						ref={champ}
						data-testid="champ-channel-rattacher"
						value={choix}
						onChange={(evenement) => {
							setChoix(evenement.target.value)
							setRefus(null)
						}}
						{...(refus === null ? {} : { 'aria-describedby': idRefus, 'aria-invalid': true })}
						className={CLASSES_CHAMP}
					>
						<option value="">{t('cardPlacements.attach.channel.none')}</option>
						{offerts.map((offert) => (
							<option key={offert.id} value={offert.id}>
								{t('cardPlacements.path', { track: offert.track, channel: offert.channel })}
							</option>
						))}
					</select>
				</label>
			)}
			{refus === null ? null : (
				<div
					id={idRefus}
					role="alert"
					data-testid="refus-rattacher"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<div className="flex flex-col gap-2 min-w-0">
						<p>{t(CLES_REFUS[refus])}</p>
						{refus !== 'sans-etape-initiale' ? null : (
							<Link
								to={CHEMIN_ADMIN_WORKFLOWS}
								className="inline-flex items-center self-start min-h-[var(--size-target)] px-4 rounded-sm bg-surface text-ink border border-border font-medium hover:bg-hover"
							>
								{t('affaire.creation.refus.initiale.lien')}
							</Link>
						)}
					</div>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{offerts === null || offerts.length === 0 ? null : (
					<Button type="submit" variante="primaire" data-testid="envoyer-rattacher" aria-busy={enVol}>
						{t('cardPlacements.attach.submit')}
					</Button>
				)}
				<Button ref={annuler} type="button" variante="secondaire" data-testid="annuler-rattacher" onClick={fermer}>
					{t('cardPlacements.attach.cancel')}
				</Button>
			</div>
		</form>
	)
}

const ID_MOTIF_RATTACHEMENTS = 'motif-rattachements'

function LigneRattachement({
	idCard,
	devise,
	capacite,
	rattachement,
	onChange,
	client,
	maintenant,
}: {
	readonly idCard: string
	readonly devise: string
	readonly capacite: Capacite
	readonly rattachement: RattachementDuBloc
	readonly onChange: () => void
	readonly client: ClientCrm | null
	readonly maintenant: () => Date
}) {
	const [enVol, setEnVol] = useState(false)
	const [issue, setIssue] = useState<IssueArchivage | null>(null)
	const chemin = t('cardPlacements.path', { track: rattachement.track, channel: rattachement.channel })
	const archive = rattachement.archivedAt !== null

	const basculer = async () => {
		if (client === null || enVol) return
		setEnVol(true)
		const resultat = await archiverRattachement(client, rattachement.id, !archive)
		setEnVol(false)
		setIssue(resultat === 'enregistree' ? null : resultat)
		if (resultat === 'enregistree') onChange()
	}

	return (
		<li
			data-testid="ligne-rattachement"
			data-rattachement={rattachement.id}
			{...(rattachement.courant ? { 'aria-current': 'page' as const } : {})}
			className="flex flex-col gap-2 py-3"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				{rattachement.courant ? (
					<span className="text-sm text-ink">
						{chemin}{' '}
						<span className="text-sm text-text-2">{t('cardPlacements.current')}</span>
					</span>
				) : (
					<Link
						to={`/tracks/${rattachement.slugTrack}/${rattachement.slugChannel}/cards/${idCard}`}
						className="text-sm text-brand underline-offset-2 hover:underline"
					>
						{chemin}
					</Link>
				)}
				{/* LA LIGNE DE LA FICHE NE RÉPÈTE RIEN DE L'EN-TÊTE (§5.82) : une copie qu'il modifie resterait périmée. */}
				{rattachement.courant ? null : <Details rattachement={rattachement} devise={devise} maintenant={maintenant} />}
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="basculer-archivage-rattachement"
					// JAMAIS `disabled` pendant le vol : un bouton désactivé perd le focus, que la relecture en place doit
					// laisser sur la commande (§5.82). Le gestionnaire ignore un second clic tant que le premier vole.
					aria-busy={enVol}
					{...proprietesCommande(capacite, ID_MOTIF_RATTACHEMENTS)}
					onClick={() => void basculer()}
					className="ml-auto"
				>
					{archive ? <ArchiveRestore aria-hidden="true" className="size-4" /> : <Archive aria-hidden="true" className="size-4" />}
					{t(archive ? 'cardPlacements.unarchive' : 'cardPlacements.archive')}
					<span className="sr-only">{chemin}</span>
				</Button>
			</div>
			{issue === null ? null : (
				<p role="alert" data-testid="refus-archivage-rattachement" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{t(issue === 'reseau' ? 'cardPlacements.archive.network' : 'cardPlacements.archive.refused')}
				</p>
			)}
		</li>
	)
}

/** L'étape, le responsable, le montant et les pilules d'un AUTRE rattachement (§5.82). */
function Details({
	rattachement,
	devise,
	maintenant,
}: {
	readonly rattachement: RattachementDuBloc
	readonly devise: string
	readonly maintenant: () => Date
}) {
	const montant = formaterMontant({ amount: rattachement.montant, currency: devise })
	const echeance = estEnSommeil(rattachement.snoozedUntil, maintenant()) ? formaterEcheanceSommeil(rattachement.snoozedUntil) : null
	const segments = [
		rattachement.etape,
		rattachement.responsable ?? t('card.header.owner.none'),
	].filter((segment): segment is string => segment !== null)
	return (
		<>
			<span className="text-sm text-text-2">
				{segments.join(' · ')}
				{montant === null ? null : (
					<>
						{' · '}
						<code>{montant.montant}</code> <span>{montant.devise}</span>
					</>
				)}
			</span>
			{rattachement.archivedAt === null ? null : (
				<span
					data-testid="rattachement-archive"
					className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-on-soft px-3 py-1 text-sm"
				>
					<Archive aria-hidden="true" className="size-4" />
					{t('card.header.archived')}
				</span>
			)}
			{echeance === null ? null : (
				<span
					data-testid="rattachement-sommeil"
					className="inline-flex items-center gap-1 rounded-full bg-brand-soft text-brand px-3 py-1 text-sm"
				>
					<Moon aria-hidden="true" className="size-4" />
					{t('card.sleep.badge', { echeance })}
				</span>
			)}
		</>
	)
}
