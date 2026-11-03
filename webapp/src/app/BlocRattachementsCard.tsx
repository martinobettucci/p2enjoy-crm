// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.2 : le bloc « Rattachements » de la fiche — une ligne par rattachement
//       lisible, celui de la fiche marqué, les autres en liens vers leur adresse, archiver et désarchiver
// @spec docs/SPEC-rattachements.md §5 (archiver, désarchiver), §8.1 (décision 823) ; docs/DESIGN_SYSTEM.md §5.82, §5.3 bis
//       (« Aucun responsable », la pilule « Archivé »), §5.3 quater (la pastille de sommeil), §5.54 (le chemin)
//
// LE BLOC NE DÉCIDE D'AUCUN DROIT. La base dit, par `channels.ecriture_permise`, quels channels l'appelant écrit : la
// commande d'un channel refusé est éteinte avec le motif du bloc (§5.59), et la politique `card_placements_update` reste
// la règle — un refus qui survient malgré tout se dit dans la ligne. Un succès fait relire la fiche en place : l'en-tête
// et le bloc disent alors le même état, sans écran de chargement intermédiaire.
// @spec docs/DESIGN_SYSTEM.md §5.59 (la commande refusée par une capacité de la base, un motif par bloc) ;
//       docs/SPEC-droits-interface.md §2 à §4

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Archive, ArchiveRestore, Moon } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { enChargement, type EtatAsync } from '../lib/async'
import { capaciteDansLEtat, lireEcrituresPermises, motifVisible, proprietesCommande, type Capacite } from '../lib/capacites'
import { t } from '../i18n'
import { archiverRattachement, type IssueArchivage } from '../lib/bloc-rattachements'
import { formaterMontant } from '../lib/entete-card'
import type { RattachementDuBloc } from '../lib/formulaire'
import { estEnSommeil, formaterEcheanceSommeil } from '../lib/sommeil-card'
import { clientCrm, type ClientCrm } from '../lib/supabase'

export function BlocRattachementsCard({
	idCard,
	devise,
	rattachements,
	onChange,
	client = clientCrm,
	maintenant = () => new Date(),
}: {
	readonly idCard: string
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
		</section>
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
