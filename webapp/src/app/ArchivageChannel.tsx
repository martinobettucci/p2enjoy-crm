// @spec CRM-134 (docs/BACKLOG.md) tranche T1 — archiver un channel depuis sa vue, et le panneau « Channels archivés de
//       ce track » qui les désarchive
// @spec docs/SPEC-channels.md §11.2 (la commande sur la barre d'outils du channel, la confirmation dans le flux,
//       l'écriture de Réglages et ses trois issues), §11.3 (le panneau, désarchiver sans confirmation), §11.4 (les
//       commandes éteintes avec leur motif ; la base refuse de toute façon) ; docs/DESIGN_SYSTEM.md §5.101, §5.13, §5.29
//       bis, §5.59, §5.68, §5.84 ; docs/SPEC-droits-interface.md §2 ; décisions 871 et 919 ; CLAUDE.md §10 — rien
//       n'est décidé ici : la capacité vient de la base, et la politique de `channels` refuse l'écriture
//
// L'ÉCRITURE EST CELLE DE RÉGLAGES, `archiverChannel`, et la confirmation est la sienne, partagée : le même geste a la
// même forme dans les deux écrans (décision 919). Ce qui change est l'endroit, et ce que la vue fait après.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { t } from '../i18n'
import { archiverChannel, type ResultatEcriture } from '../lib/administration-arborescence'
import { ID_PANNEAU_ARCHIVES } from '../lib/archives-channels'
import type { Channel } from '../lib/channels'
import type { ClientCrm } from '../lib/supabase'
import { ConfirmationArchivage } from './ConfirmationArchivage'
import { useContexteEspace } from './ContexteEspace'
import { AlerteRefus, texteRefus } from './ElementsFormulaireAdmin'
import { classesPastille } from './presentation-tracks'

/** Le motif de la commande éteinte de la barre d'outils, porté par une description accessible (§5.59). */
const ID_MOTIF_ARCHIVER = 'archiver-channel-lecture-seule'
/** Le motif du panneau, rendu une fois en tête et cité par chaque « Désarchiver » (§5.59). */
const ID_MOTIF_PANNEAU = 'panneau-archives-lecture-seule'

/** Le texte d'une écriture qui n'a pas abouti ; `null` pour une réussite. */
function texteIssue(resultat: ResultatEcriture): string | null {
	if (resultat.statut === 'refus') return texteRefus(resultat.refus)
	if (resultat.statut === 'sans-effet') return t('admin.refus.sans-effet')
	return null
}

/**
 * La capacité d'administrer l'espace, telle que la base la rend (§5.59) : `eteinte` pendant sa lecture comme sur un
 * refus — la commande « Nouveau channel » fait de même —, et le motif n'est dit que sur un refus établi.
 */
function useAdministration(): { readonly eteinte: boolean; readonly refusee: boolean } {
	const { capacites } = useContexteEspace()
	const refusee = capacites.administration === 'refusee'
	return { eteinte: refusee || capacites.administration === 'en-lecture', refusee }
}

/**
 * La barre d'outils du channel ouvert : la bascule « Tableau / Liste » (`children`) à gauche, « Archiver le channel » à
 * droite ; la confirmation dessous, dans le flux, au-dessus du board ou de la liste (§11.2).
 */
export function BarreOutilsChannel({
	client,
	channel,
	onArchive,
	children,
}: {
	readonly client: ClientCrm
	readonly channel: Channel
	/** Appelée après la réussite seule : la route relit, change de vue, annonce et pose le focus. */
	readonly onArchive: (channel: Channel) => void
	readonly children: ReactNode
}) {
	const { eteinte, refusee } = useAdministration()
	const [ouverte, setOuverte] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	// Le focus revient à la commande APRÈS le rendu qui referme la confirmation : avant, elle n'est pas encore là.
	const commande = useRef<HTMLButtonElement>(null)
	const [rendreFocus, setRendreFocus] = useState(false)
	useEffect(() => {
		if (!rendreFocus) return
		commande.current?.focus()
		setRendreFocus(false)
	}, [rendreFocus])

	const fermer = () => {
		setOuverte(false)
		setRefus(null)
		setRendreFocus(true)
	}
	const confirmer = async () => {
		setEnCours(true)
		try {
			const texte = texteIssue(await archiverChannel(client, channel.id, true))
			if (texte !== null) {
				// La confirmation reste ouverte, le refus écrit dedans (§11.2).
				setRefus(texte)
				return
			}
			setOuverte(false)
			setRefus(null)
			onArchive(channel)
		} finally {
			setEnCours(false)
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				{children}
				{/* `relative` confine le motif `sr-only` (positionné en absolu), comme pour « Nouveau channel ». */}
				<span className="relative">
					<Button
						ref={commande}
						taille="compacte"
						data-testid="commande-archiver-channel"
						disabled={eteinte || ouverte}
						{...(refusee ? { 'aria-describedby': ID_MOTIF_ARCHIVER, title: t('rights.readonly.administration') } : {})}
						onClick={() => setOuverte(true)}
					>
						<Archive aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
						{t('channel.archive.action')}
					</Button>
					{refusee ? (
						<span id={ID_MOTIF_ARCHIVER} className="sr-only">
							{t('rights.readonly.administration')}
						</span>
					) : null}
				</span>
			</div>
			{ouverte ? (
				<ConfirmationArchivage
					question={t('admin.archive.confirm.channel', { nom: channel.name })}
					corps={t('channel.archive.confirm.body')}
					refus={refus}
					enCours={enCours}
					fermerParEchap
					onAnnuler={fermer}
					onConfirmer={() => void confirmer()}
				/>
			) : null}
		</div>
	)
}

/**
 * « Channels archivés de ce track » — le panneau que le groupe de la barre déplie, en tête de la zone principale
 * (§11.3). Les noms ne sont pas des liens (décision 919) ; « Désarchiver » n'a pas de confirmation (§5.29 bis).
 */
export function PanneauArchives({
	client,
	archives,
	onDesarchive,
}: {
	readonly client: ClientCrm
	readonly archives: readonly Channel[]
	/** Appelée après la réussite seule, avec la liste du panneau telle qu'elle était : la route relit et pose le focus. */
	readonly onDesarchive: (channel: Channel, archivesAvant: readonly Channel[]) => void
}) {
	const { eteinte, refusee } = useAdministration()
	return (
		<section
			id={ID_PANNEAU_ARCHIVES}
			aria-labelledby={`${ID_PANNEAU_ARCHIVES}-titre`}
			data-testid="panneau-archives"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			<h2 id={`${ID_PANNEAU_ARCHIVES}-titre`} className="text-h3">
				{t('channel.archives.title')}
			</h2>
			{refusee ? (
				<MotifLectureSeule id={ID_MOTIF_PANNEAU}>{t('rights.readonly.administration')}</MotifLectureSeule>
			) : null}
			<ul className="flex flex-col">
				{archives.map((channel) => (
					<LigneArchive
						key={channel.id}
						client={client}
						channel={channel}
						eteinte={eteinte}
						refusee={refusee}
						onDesarchive={() => onDesarchive(channel, archives)}
					/>
				))}
			</ul>
		</section>
	)
}

function LigneArchive({
	client,
	channel,
	eteinte,
	refusee,
	onDesarchive,
}: {
	readonly client: ClientCrm
	readonly channel: Channel
	readonly eteinte: boolean
	readonly refusee: boolean
	readonly onDesarchive: () => void
}) {
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const desarchiver = async () => {
		setEnCours(true)
		try {
			const texte = texteIssue(await archiverChannel(client, channel.id, false))
			setRefus(texte)
			if (texte === null) onDesarchive()
		} finally {
			setEnCours(false)
		}
	}
	return (
		<li data-testid="ligne-channel-archive" data-id={channel.id} className="flex flex-col gap-2 border-b border-border last:border-b-0 py-2">
			<div className="flex items-center gap-3 min-h-[var(--size-target)]">
				<span className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 flex-1">
					<span className="inline-flex items-center min-w-0">
						{/* La pastille du §5.68 : la couleur accompagne le nom, elle ne le remplace pas. */}
						<span
							aria-hidden="true"
							className={`mr-[6px] size-2 shrink-0 rounded-full ${classesPastille(channel.color)}`}
						/>
						<span className="break-words min-w-0">{channel.name}</span>
					</span>
					{/* La mention est TEXTUELLE, jamais une teinte seule (§5.13). */}
					<span className="text-sm text-text-2">{t('admin.tree.archived')}</span>
				</span>
				<Button
					taille="compacte"
					className="shrink-0"
					data-testid="desarchiver-channel"
					data-id={channel.id}
					aria-label={t('channel.archives.unarchive.aria', { nom: channel.name })}
					disabled={eteinte || enCours}
					{...(refusee ? { 'aria-describedby': ID_MOTIF_PANNEAU } : {})}
					onClick={() => void desarchiver()}
				>
					<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
					{t('channel.archives.unarchive')}
				</Button>
			</div>
			{refus === null ? null : <AlerteRefus message={refus} />}
		</li>
	)
}
