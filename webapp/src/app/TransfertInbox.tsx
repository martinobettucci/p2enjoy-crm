// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : le transfert d'un mail à un membre, côté écran — la commande « Transférer »
//       du message ouvert et son bloc, le `select` « Membre » partagé avec la barre groupée, les transferts lus sous la
//       ligne des pastilles et leur retrait
// @spec docs/DESIGN_SYSTEM.md §5.109 bis (« LE TRANSFERT ») ; docs/SPEC-mail-subsystem.md §32.7 ; docs/JOURNAL.md décisions
//       945 et 947 ; docs/DESIGN_SYSTEM.md §5.102 (la rangée), §5.103 (les blocs qui s'excluent), §5.59 (la capacité),
//       §5.22 (l'option vide), §5.10 (« Compte supprimé »), §5.13 (dans le flux, le focus)
//
// AUCUN DROIT N'EST APPLIQUÉ ICI (`CLAUDE.md` §10) : la base refuse le transfert à qui ne peut pas éditer, à un non-membre,
// à soi-même, et ne laisse retirer un transfert qu'à son auteur et à son destinataire. L'écran éteint la commande quand la
// capacité est refusée, et ne rend « Retirer » que sur les lignes dont la donnée lue nomme la personne.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Forward, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { classerErreur, enErreur, type EtatAsync } from '../lib/async'
import type { Capacite } from '../lib/capacites'
import { lireMembresAffectables, type MembreAffectable } from '../lib/entete-card'
import { clientCrm } from '../lib/supabase'
import {
	lireTransferts,
	retirerTransfert,
	transfererMessage,
	type RefusTransfert,
	type TransfertLu,
} from '../lib/transferts-inbox'

const REFUS: Readonly<Record<RefusTransfert, CleTraduction>> = {
	introuvable: 'inbox.transfer.refus.introuvable',
	interdit: 'inbox.transfer.refus.interdit',
	pas_membre: 'inbox.transfer.refus.pas_membre',
	soi_meme: 'inbox.transfer.refus.soi_meme',
	reseau: 'inbox.transfer.refus.reseau',
	inconnu: 'inbox.transfer.refus.inconnu',
}

const dateTechnique = (iso: string): string =>
	new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const MARQUE_DATE = '\u2063'

/**
 * Une phrase traduite dont la date est une DONNÉE TECHNIQUE (§2 : monospace, chiffres tabulaires). La phrase reste UNE clé —
 * jamais deux morceaux concaténés (`CLAUDE.md` §23) : la date y entre par une marque invisible, remplacée par un `<time>`.
 */
export function phraseDatee(texte: (date: string) => string, iso: string): ReactNode {
	const [avant, apres] = texte(MARQUE_DATE).split(MARQUE_DATE)
	return (
		<>
			{avant}
			<time dateTime={iso} className="font-mono tabular-nums">
				{dateTechnique(iso)}
			</time>
			{apres ?? ''}
		</>
	)
}

// =================================================================================================
// Le `select` « Membre » — le bloc du message ouvert et la confirmation groupée (§5.109 bis)
// =================================================================================================

/** Les membres de l'espace, par nom, la personne exceptée ; option vide en tête (§5.22). */
export function SelectMembre({
	idEspace,
	idMoi,
	valeur,
	onChange,
	refSelect,
	desactive = false,
	focusAuChargement = false,
}: {
	readonly idEspace: string | null
	readonly idMoi: string | null
	readonly valeur: string
	readonly onChange: (id: string) => void
	readonly refSelect?: RefObject<HTMLSelectElement | null>
	readonly desactive?: boolean
	/** Le focus entre sur le `select` dès que les membres sont lus : désactivé pendant la lecture, il le refusait. */
	readonly focusAuChargement?: boolean
}) {
	const [membres, setMembres] = useState<EtatAsync<readonly MembreAffectable[]>>({ statut: 'chargement' })
	const idChamp = useId()
	const refInterne = useRef<HTMLSelectElement | null>(null)
	const pret = membres.statut === 'pret'
	useEffect(() => {
		if (pret && focusAuChargement) refInterne.current?.focus()
		// eslint-disable-next-line react-hooks/exhaustive-deps -- une fois, quand la liste arrive
	}, [pret])
	useEffect(() => {
		if (idEspace === null || clientCrm === null) {
			setMembres(enErreur(classerErreur(undefined, 'espace absent')))
			return
		}
		let vivant = true
		void lireMembresAffectables(clientCrm, idEspace).then((lu) => {
			if (vivant) setMembres(lu)
		})
		return () => {
			vivant = false
		}
	}, [idEspace])
	const autres = membres.statut === 'pret' ? membres.donnees.filter((membre) => membre.id !== idMoi) : []
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={idChamp} className="text-sm text-text-2">
				{t('inbox.transfer.member')}
			</label>
			<select
				id={idChamp}
				ref={(element) => {
					refInterne.current = element
					if (refSelect !== undefined) refSelect.current = element
				}}
				data-testid="inbox-transfert-membre"
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm w-full md:max-w-[40ch]"
				value={valeur}
				disabled={desactive || membres.statut !== 'pret'}
				onChange={(evenement) => onChange(evenement.target.value)}
			>
				<option value="">{t('inbox.transfer.member.empty')}</option>
				{autres.map((membre) => (
					<option key={membre.id} value={membre.id}>
						{membre.nom}
					</option>
				))}
			</select>
			{membres.statut === 'chargement' ? (
				<p role="status" className="text-sm text-text-2">
					{t('inbox.transfer.members.loading')}
				</p>
			) : membres.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger">
					{t('inbox.transfer.members.error')}
				</p>
			) : autres.length === 0 ? (
				<p className="text-sm text-text-2">{t('inbox.transfer.members.none')}</p>
			) : null}
		</div>
	)
}

// =================================================================================================
// Le transfert du message ouvert — §5.109 bis
// =================================================================================================

/** Ce que le message ouvert reçoit : la commande, le bloc, la liste, et l'exclusion avec les autres blocs (§5.103). */
export type ProprietesTransfert = {
	/** « Transférer », à placer après « Pastilles », avant les suppressions. */
	readonly commande: ReactNode
	/** Le bloc « Transférer ce message », dans le flux sous la rangée ; `null` fermé. */
	readonly panneau: ReactNode
	/** Les transferts du message, sous la ligne des pastilles ; `null` s'il n'y en a aucun. */
	readonly liste: ReactNode
	/** Change à chaque ouverture du bloc : le panneau « Pastilles » et la confirmation de suppression se referment. */
	readonly refermerAutres: number
	/** Un autre bloc s'ouvre : celui-ci se referme. */
	readonly fermer: () => void
}

/**
 * Le transfert du message ouvert. Monté avec la clé du message : tout se referme d'un message à l'autre. La commande, le
 * bloc et la liste vivent à trois endroits de l'en-tête ; l'appelant les place (`enfants`).
 */
export function TransfertDuMessage({
	idMessage,
	idEspace,
	idMoi,
	edition,
	onAnnonce,
	enfants,
}: {
	readonly idMessage: string
	readonly idEspace: string
	readonly idMoi: string | null
	/** La capacité d'éditer l'espace (§5.59) : une aide d'interface ; la base tranche. */
	readonly edition: Capacite
	readonly onAnnonce: (texte: string) => void
	readonly enfants: (proprietes: ProprietesTransfert) => ReactNode
}) {
	const [transferts, setTransferts] = useState<EtatAsync<readonly TransfertLu[]>>({ statut: 'chargement' })
	const [ouvert, setOuvert] = useState(false)
	const [refermerAutres, setRefermerAutres] = useState(0)
	const [membre, setMembre] = useState('')
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<RefusTransfert | null>(null)
	const [retrait, setRetrait] = useState<{ readonly id: string; readonly refus: RefusTransfert | null } | null>(null)
	const refCommande = useRef<HTMLButtonElement | null>(null)
	const refSelect = useRef<HTMLSelectElement | null>(null)
	const idTitre = useId()
	const permise = edition === 'permise'

	const relire = useCallback(async () => {
		setTransferts(await lireTransferts(clientCrm, idMessage))
	}, [idMessage])

	useEffect(() => {
		void relire()
	}, [relire])

	const fermer = useCallback(() => {
		setOuvert(false)
		setMembre('')
		setRefus(null)
	}, [])

	const fermerEtRendre = () => {
		fermer()
		requestAnimationFrame(() => refCommande.current?.focus())
	}

	const transferer = async () => {
		if (membre === '' || enVol) return
		setEnVol(true)
		setRefus(null)
		const issue = await transfererMessage(clientCrm, idMessage, membre)
		setEnVol(false)
		if (issue !== null) {
			setRefus(issue)
			return
		}
		const nom = refSelect.current?.selectedOptions[0]?.textContent ?? ''
		onAnnonce(t('inbox.transfer.done', { membre: nom }))
		fermerEtRendre()
		await relire()
	}

	const retirer = async (ligne: TransfertLu) => {
		setRetrait({ id: ligne.destinataireId, refus: null })
		const issue = await retirerTransfert(clientCrm, idMessage, ligne.destinataireId)
		if (issue !== null) {
			setRetrait({ id: ligne.destinataireId, refus: issue })
			return
		}
		setRetrait(null)
		onAnnonce(t('inbox.transfer.removed'))
		await relire()
	}

	const commande = (
		<Button
			ref={refCommande}
			taille="compacte"
			data-testid="inbox-transferer"
			disabled={!permise}
			aria-expanded={ouvert}
			onClick={() => {
				if (ouvert) {
					fermerEtRendre()
					return
				}
				setOuvert(true)
				setRefermerAutres((n) => n + 1)
			}}
		>
			<Forward aria-hidden="true" size={16} />
			{t('inbox.transfer.command')}
		</Button>
	)

	const panneau = ouvert ? (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="inbox-transfert-bloc"
			className="rounded-sm border border-border p-3 flex flex-col gap-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !enVol) {
					evenement.stopPropagation()
					fermerEtRendre()
				}
			}}
		>
			<p id={idTitre} className="font-medium text-ink">
				{t('inbox.transfer.group')}
			</p>
			<SelectMembre
				idEspace={idEspace}
				idMoi={idMoi}
				valeur={membre}
				onChange={setMembre}
				refSelect={refSelect}
				desactive={enVol}
				focusAuChargement
			/>
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger" data-testid="inbox-transfert-refus">
					{t(REFUS[refus])}
				</p>
			) : null}
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button variante="secondaire" taille="compacte" disabled={enVol} onClick={fermerEtRendre}>
					{t('inbox.transfer.cancel')}
				</Button>
				<Button
					variante="primaire"
					taille="compacte"
					data-testid="inbox-transfert-confirmer"
					disabled={membre === '' || enVol}
					aria-busy={enVol || undefined}
					onClick={() => void transferer()}
				>
					<Forward aria-hidden="true" size={16} />
					{t('inbox.transfer.confirm')}
				</Button>
			</div>
		</div>
	) : null

	const lignes = transferts.statut === 'pret' ? transferts.donnees : []
	const liste =
		transferts.statut === 'erreur' ? (
			<p className="text-sm text-danger" data-testid="inbox-transferts-erreur">
				{t('inbox.transfer.error.read')}
			</p>
		) : lignes.length > 0 ? (
			<ul className="flex flex-col gap-1" data-testid="inbox-transferts">
				{lignes.map((ligne) => {
					const nomMembre = ligne.destinataireNom ?? t('inbox.transfer.deleted')
					const peutRetirer = idMoi !== null && (ligne.auteurId === idMoi || ligne.destinataireId === idMoi)
					const refusLigne = retrait?.id === ligne.destinataireId ? retrait.refus : null
					return (
						<li key={ligne.destinataireId} className="flex flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
								<span>
									{phraseDatee(
										(date) =>
											t('inbox.transfer.line', {
												membre: nomMembre,
												auteur: ligne.auteurNom ?? t('inbox.transfer.deleted'),
												date,
											}),
										ligne.le,
									)}
								</span>
								{peutRetirer ? (
									<Button
										variante="discret"
										taille="compacte"
										data-testid="inbox-transfert-retirer"
										aria-label={t('inbox.transfer.remove.label', { membre: nomMembre })}
										disabled={retrait?.id === ligne.destinataireId && retrait.refus === null}
										onClick={() => void retirer(ligne)}
									>
										<X aria-hidden="true" size={16} />
										{t('inbox.transfer.remove')}
									</Button>
								) : null}
							</div>
							{refusLigne !== null ? (
								<p role="alert" className="text-sm text-danger" data-testid="inbox-transfert-retrait-refus">
									{t(REFUS[refusLigne])}
								</p>
							) : null}
						</li>
					)
				})}
			</ul>
		) : null

	return <>{enfants({ commande, panneau, liste, refermerAutres, fermer })}</>
}
