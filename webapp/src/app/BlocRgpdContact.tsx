// @spec CRM-072 (docs/BACKLOG.md) — tranche T3 : la zone « Données personnelles (RGPD) » de la fiche d'un contact
// @spec docs/SPEC-audit.md §7.1 (l'export, téléchargé, jamais stocké), §7.2 (l'anonymisation confirmée par le nom retapé,
//       messages intacts), §9 (les deux gestes) ; docs/DESIGN_SYSTEM.md §5.67 (zone en bas de fiche, confirmation dans le
//       flux, bouton destructif éteint tant que la saisie diffère, anonymiser absent une fois fait, refus traduits), §5.59
//       (commandes éteintes par la capacité d'administrer, citant le motif), §5.40 (commande montée et désactivée pendant sa
//       confirmation, focus rendu) ; docs/JOURNAL.md décisions 725, 726 et 732
// @spec CLAUDE.md §10 — l'écran n'éteint que ce que la base refuse ; les deux fonctions sont gardées en base

import { FileDown, UserRoundX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { t, type CleTraduction } from '../i18n'
import { motifVisible, proprietesCommande, type Capacite } from '../lib/capacites'
import {
	anonymiserContact,
	contenuFichierExport,
	exporterContact,
	nomFichierExport,
	type MotifRefusRgpd,
} from '../lib/rgpd'
import type { ClientCrm } from '../lib/supabase'

const ID_MOTIF_RGPD = 'rgpd-contact-motif'

const REFUS: Readonly<Record<MotifRefusRgpd, CleTraduction>> = {
	reserve: 'contact.rgpd.refused.reserved',
	introuvable: 'contact.rgpd.refused.notFound',
	confirmation: 'contact.rgpd.refused.confirmation',
	'deja-anonymise': 'contact.rgpd.refused.alreadyAnonymized',
	reseau: 'contact.rgpd.refused.network',
	inconnu: 'contact.rgpd.refused.unknown',
}

type Ton = 'succes' | 'refus'
type Message = { readonly ton: Ton; readonly texte: string } | null

/**
 * Les classes d'un message, par ton. Une table `CLASSES_*` plutôt qu'une comparaison dans `className` : le contrôle des
 * classes engendrées (`scripts/lib/classes-css.mjs`) lit chaque littéral d'un `className`, et y aurait pris `'succes'`
 * pour une classe.
 */
const CLASSES_MESSAGE: Readonly<Record<Ton, string>> = {
	succes: 'text-sm text-success-on-soft',
	refus: 'rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft',
}

/** Une date courte, au format des autres écrans du produit. */
export function formaterJour(horodatage: string): string {
	const date = new Date(horodatage)
	return Number.isNaN(date.getTime()) ? horodatage : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date)
}

/** Proposer un fichier au téléchargement, dans le navigateur, sans le stocker nulle part. */
function telecharger(nom: string, contenu: string): void {
	const url = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }))
	const lien = document.createElement('a')
	lien.href = url
	lien.download = nom
	lien.click()
	URL.revokeObjectURL(url)
}

export type ProprietesBlocRgpdContact = {
	readonly client: ClientCrm
	readonly idContact: string
	readonly nom: string
	/** La date d'anonymisation, ou `null` pour un contact qui ne l'est pas. */
	readonly anonymiseLe: string | null
	/** La capacité d'administrer l'espace, rendue par la base (§5.59). */
	readonly administration: Capacite
	/** Après une anonymisation réussie : la fiche se relit. */
	readonly onAnonymise: () => void
	/** Le téléchargement, remplaçable par une preuve. */
	readonly proposerFichier?: (nom: string, contenu: string) => void
}

export function BlocRgpdContact({
	client,
	idContact,
	nom,
	anonymiseLe,
	administration,
	onAnonymise,
	proposerFichier = telecharger,
}: ProprietesBlocRgpdContact) {
	const [exportEnCours, setExportEnCours] = useState(false)
	const [confirmationOuverte, setConfirmationOuverte] = useState(false)
	const [saisie, setSaisie] = useState('')
	const [anonymisationEnCours, setAnonymisationEnCours] = useState(false)
	const [message, setMessage] = useState<Message>(null)
	const [rendreFocus, setRendreFocus] = useState(false)
	const commandeAnonymiser = useRef<HTMLButtonElement>(null)
	const champConfirmation = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (confirmationOuverte) champConfirmation.current?.focus()
	}, [confirmationOuverte])

	// La commande reste montée et désactivée pendant sa confirmation (§5.40) : le focus lui revient une fois réactivée,
	// au rendu suivant — un bouton désactivé refuse le focus. Aucune temporisation.
	useEffect(() => {
		if (!rendreFocus || confirmationOuverte) return
		commandeAnonymiser.current?.focus()
		setRendreFocus(false)
	}, [rendreFocus, confirmationOuverte])

	const exporter = async () => {
		setExportEnCours(true)
		setMessage(null)
		const issue = await exporterContact(client, idContact)
		setExportEnCours(false)
		if (!issue.ok) {
			setMessage({ ton: 'refus', texte: t(REFUS[issue.motif]) })
			return
		}
		const fichier = nomFichierExport(idContact, new Date())
		proposerFichier(fichier, contenuFichierExport(issue.donnees))
		setMessage({ ton: 'succes', texte: t('contact.rgpd.export.done', { fichier }) })
	}

	const fermerConfirmation = () => {
		setConfirmationOuverte(false)
		setSaisie('')
		setRendreFocus(true)
	}

	const anonymiser = async () => {
		setAnonymisationEnCours(true)
		const issue = await anonymiserContact(client, idContact, saisie)
		setAnonymisationEnCours(false)
		if (!issue.ok) {
			setMessage({ ton: 'refus', texte: t(REFUS[issue.motif]) })
			return
		}
		setConfirmationOuverte(false)
		setSaisie('')
		setMessage({ ton: 'succes', texte: t('contact.rgpd.anonymize.done') })
		onAnonymise()
	}

	return (
		<section
			aria-labelledby="titre-rgpd-contact"
			data-testid="zone-rgpd-contact"
			className="flex flex-col gap-3 border-t border-border pt-6"
		>
			<h2 id="titre-rgpd-contact" className="text-h3">
				{t('contact.rgpd.title')}
			</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('contact.rgpd.intro')}</p>
			{motifVisible(administration) ? (
				<MotifLectureSeule id={ID_MOTIF_RGPD} data-testid="motif-rgpd-contact">
					{t('rights.readonly.administration')}
				</MotifLectureSeule>
			) : null}
			<div className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap">
				<Button
					variante="secondaire"
					data-testid="exporter-contact"
					onClick={() => void exporter()}
					{...proprietesCommande(administration, ID_MOTIF_RGPD, exportEnCours)}
				>
					<FileDown aria-hidden="true" size={16} />
					{exportEnCours ? t('contact.rgpd.export.loading') : t('contact.rgpd.export')}
				</Button>
				{anonymiseLe === null ? (
					<Button
						ref={commandeAnonymiser}
						variante="secondaire"
						data-testid="anonymiser-contact"
						aria-expanded={confirmationOuverte}
						onClick={() => {
							setMessage(null)
							setConfirmationOuverte(true)
						}}
						{...proprietesCommande(administration, ID_MOTIF_RGPD, confirmationOuverte)}
					>
						<UserRoundX aria-hidden="true" size={16} />
						{t('contact.rgpd.anonymize')}
					</Button>
				) : null}
			</div>
			{anonymiseLe !== null ? (
				<p data-testid="contact-deja-anonymise" className="text-sm text-text-2">
					{t('contact.rgpd.anonymized.since', { date: formaterJour(anonymiseLe) })}
				</p>
			) : null}
			{confirmationOuverte ? (
				<div
					data-testid="confirmation-anonymisation"
					className="flex max-w-[72ch] flex-col gap-3 rounded-lg border border-border bg-surface p-4"
					onKeyDown={(e) => {
						if (e.key === 'Escape') fermerConfirmation()
					}}
				>
					<p className="font-medium">{t('contact.rgpd.anonymize.question', { nom })}</p>
					<p className="text-sm text-text-2">{t('contact.rgpd.anonymize.effect')}</p>
					<label className="flex w-full flex-col gap-1 text-sm text-text-2 md:max-w-[40ch]">
						{t('contact.rgpd.anonymize.label')}
						<input
							ref={champConfirmation}
							value={saisie}
							onChange={(e) => setSaisie(e.target.value)}
							aria-describedby="aide-anonymisation"
							className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
						/>
					</label>
					<p id="aide-anonymisation" className="text-sm text-text-3">
						{t('contact.rgpd.anonymize.help', { nom })}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variante="destructif"
							data-testid="confirmer-anonymisation"
							disabled={saisie !== nom || anonymisationEnCours}
							onClick={() => void anonymiser()}
						>
							{anonymisationEnCours ? t('contact.rgpd.anonymize.loading') : t('contact.rgpd.anonymize.confirm')}
						</Button>
						<Button variante="secondaire" onClick={fermerConfirmation}>
							{t('contact.rgpd.anonymize.cancel')}
						</Button>
					</div>
				</div>
			) : null}
			{message === null ? null : (
				<p
					role={message.ton === 'succes' ? 'status' : 'alert'}
					data-testid="message-rgpd-contact"
					className={CLASSES_MESSAGE[message.ton]}
				>
					{message.texte}
				</p>
			)}
		</section>
	)
}
