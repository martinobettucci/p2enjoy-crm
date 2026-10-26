// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — les commandes d'écriture lisent le refus de la fiche quand la base refuse
//       l'écriture sur l'affaire (docs/SPEC-droits-interface.md §2.1, §3 ; docs/DESIGN_SYSTEM.md §5.59)
// @spec CRM-058 (docs/BACKLOG.md) — composer et répondre, par le même chemin
// @spec docs/SPEC-mail-subsystem.md §19.6 (le même chemin de code depuis la card et depuis
//       l'inbox), §19.4 (les refus tels que l'écran doit les présenter)
// @spec docs/DESIGN_SYSTEM.md §5.5 (boutons), §5.8 (états), §10 (clavier, labels)
// @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : « Ajouter Cci », « Joindre des fichiers », le dépôt immédiat, le retrait,
//       les plafonds écrits, les refus nommés — docs/SPEC-mail-subsystem.md §19 bis.2, §19 bis.5 ;
//       docs/DESIGN_SYSTEM.md §5.4 sexies ; décisions 719 et 720
//
// UN SEUL COMPOSANT POUR LES DEUX ORIGINES, et c'est le §19.6 qui l'exige : « le même chemin de
// code, seule la card sélectionnée diffère ». Deux formulaires jumeaux auraient divergé au premier
// correctif — l'un porterait la garde, l'autre l'aurait oubliée.
//
// L'ÉCRAN N'OUVRE AUCUNE CONNEXION : il met en file. Ce qu'il annonce, c'est « votre message part
// », jamais « votre message est arrivé » — le worker n'a pas encore parlé.

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import {
	PIECES_MAX,
	PIECES_OCTETS_MAX,
	cheminDeDepot,
	decouperDestinataires,
	depassementPlafond,
	deposerPiece,
	lireIdentitesDisponibles,
	mettreEnFile,
	retirerPiece,
	tailleLisible,
	type IdentiteEnvoi,
	type NatureRefusEnvoi,
} from '../lib/envoi'
import { clientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'
import { useRefus } from '../components/ui/RefusCommandes'

/** Les cinq refus possibles, nommés LITTÉRALEMENT — une clé composée échappe au contrôle des
 *  clés mortes, défaut mesuré sur l'inbox de `CRM-057`. */
const LIBELLE_REFUS: Readonly<Record<NatureRefusEnvoi, CleTraduction>> = {
	forbidden: 'envoi.refus.forbidden',
	invalide: 'envoi.refus.invalide',
	quota: 'envoi.refus.quota',
	piece_indisponible: 'envoi.refus.piece',
	pieces_plafond: 'envoi.refus.plafond',
	network: 'envoi.refus.network',
	unknown: 'envoi.refus.unknown',
}

/** Un fichier joint, du choix à la mise en file. `chemin` est nul tant que le dépôt n'a pas abouti. */
type PieceJointe = {
	readonly cle: string
	readonly nom: string
	readonly taille: number
	readonly chemin: string | null
	readonly etat: 'depot' | 'pret' | 'refuse'
}

export type ProprietesFormulaireEnvoi = {
	readonly idCard: string
	/** Destinataire pré-rempli — l'expéditeur du message auquel on répond. */
	readonly destinataire?: string
	readonly objet?: string
	/** Message auquel on répond : il porte le fil, et le worker en tirera `In-Reply-To`. */
	readonly repondA?: string
	readonly onEnvoye?: () => void
}

export function FormulaireEnvoi({
	idCard,
	destinataire = '',
	objet = '',
	repondA,
	onEnvoye,
}: ProprietesFormulaireEnvoi) {
	const droit = useRefus()
	const [ouvert, setOuvert] = useState(false)
	const [identites, setIdentites] = useState<readonly IdentiteEnvoi[]>([])
	const [identite, setIdentite] = useState('')
	const [a, setA] = useState(destinataire)
	const [sujet, setSujet] = useState(objet)
	const [corps, setCorps] = useState('')
	const [cciVisible, setCciVisible] = useState(false)
	const [cci, setCci] = useState('')
	const [pieces, setPieces] = useState<readonly PieceJointe[]>([])
	const [survol, setSurvol] = useState(false)
	const [idEspace, setIdEspace] = useState<string | null>(null)
	const champCci = useRef<HTMLInputElement | null>(null)
	const selecteurFichiers = useRef<HTMLInputElement | null>(null)
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const premierChamp = useRef<HTMLSelectElement | null>(null)
	const authentification = useAuthentification()
	const idUtilisateur =
		authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null

	// L'ESPACE DE L'AFFAIRE, premier segment du chemin de dépôt (§19 bis.2 point 5) : la politique de stockage ne laisse
	// déposer que dans un espace dont on est membre, et la file vérifie que la pièce est de l'espace de l'affaire.
	useEffect(() => {
		if (!ouvert || clientCrm === null) return
		let vivant = true
		void (async () => {
			try {
				const reponse = await clientCrm.from('cards').select('workspace_id').eq('id', idCard).limit(1)
				if (vivant && reponse.error === null) setIdEspace(reponse.data[0]?.workspace_id ?? null)
			} catch {
				// SANS ESPACE, « Joindre des fichiers » reste offert et le dépôt est refusé sur sa ligne : le refus est dit.
			}
		})()
		return () => {
			vivant = false
		}
	}, [idCard, ouvert])

	useEffect(() => {
		if (cciVisible) champCci.current?.focus()
	}, [cciVisible])

	const joindre = useCallback(
		(fichiers: readonly File[]) => {
			for (const fichier of fichiers) {
				const cle = crypto.randomUUID()
				setPieces((precedentes) => [
					...precedentes,
					{ cle, nom: fichier.name, taille: fichier.size, chemin: null, etat: 'depot' },
				])
				void (async () => {
					const chemin =
						idEspace !== null && idUtilisateur !== null
							? cheminDeDepot(idEspace, idUtilisateur, fichier.name, crypto.randomUUID())
							: null
					const erreur = chemin === null ? { nature: 'forbidden' } : await deposerPiece(clientCrm, chemin, fichier)
					setPieces((precedentes) =>
						precedentes.map((piece) =>
							piece.cle !== cle
								? piece
								: erreur === null
									? { ...piece, chemin, etat: 'pret' }
									: { ...piece, etat: 'refuse' },
						),
					)
				})()
			}
		},
		[idEspace, idUtilisateur],
	)

	const retirer = useCallback((cle: string) => {
		setPieces((precedentes) => {
			const piece = precedentes.find((candidate) => candidate.cle === cle)
			if (piece?.chemin) void retirerPiece(clientCrm, piece.chemin)
			return precedentes.filter((candidate) => candidate.cle !== cle)
		})
	}, [])

	const annuler = useCallback(() => {
		// UN FORMULAIRE ANNULÉ RETIRE SES DÉPÔTS : la purge des 24 heures ne rattrape que ce qu'un onglet fermé a laissé.
		for (const piece of pieces) if (piece.chemin) void retirerPiece(clientCrm, piece.chemin)
		setPieces([])
		setOuvert(false)
	}, [pieces])

	useEffect(() => {
		if (!ouvert) return
		let vivant = true
		void (async () => {
			const lues = await lireIdentitesDisponibles(clientCrm, idUtilisateur)
			if (!vivant) return
			setIdentites(lues)
			setIdentite((precedent) => (precedent === '' ? (lues[0]?.id ?? '') : precedent))
		})()
		return () => {
			vivant = false
		}
	}, [idUtilisateur, ouvert])

	// LE FOCUS SUIT L'OUVERTURE : sans cela, le clavier resterait sur un bouton qui vient de
	// disparaître et repartirait du début du document (docs/DESIGN_SYSTEM.md §10).
	useEffect(() => {
		if (ouvert) premierChamp.current?.focus()
	}, [ouvert, identites])

	const soumettre = useCallback(
		async (evenement: FormEvent) => {
			evenement.preventDefault()
			const destinataires = decouperDestinataires(a)
			if (identite === '' || destinataires.length === 0 || corps.trim() === '') {
				// L'ÉCRAN DIT CE QUI MANQUE plutôt que d'envoyer un message que la garde refusera :
				// le refus serveur existe et reste la règle, mais faire l'aller-retour pour une
				// saisie incomplète ferait attendre l'utilisateur pour rien.
				setRefus(t('envoi.refus.incomplet'))
				return
			}
			setEnvoi(true)
			const echec = await mettreEnFile(clientCrm, {
				idCard,
				idIdentite: identite,
				destinataires,
				objet: sujet,
				corps,
				...(repondA === undefined ? {} : { repondA }),
				copiesCachees: decouperDestinataires(cci),
				pieces: pieces.flatMap((piece) => (piece.etat === 'pret' && piece.chemin !== null ? [piece.chemin] : [])),
			})
			setEnvoi(false)
			if (echec !== null) {
				// LE TEXTE SAISI EST CONSERVÉ : un refus ne doit jamais faire perdre ce qu'on a
				// écrit (docs/DESIGN_SYSTEM.md §5.10, même règle que le fil de commentaires).
				setRefus(t(LIBELLE_REFUS[echec.nature]))
				return
			}
			setRefus(null)
			setCorps('')
			setCci('')
			setCciVisible(false)
			// LES DÉPÔTS APPARTIENNENT DÉSORMAIS À L'ENVOI : ils ne sont pas retirés, la file les cite.
			setPieces([])
			setOuvert(false)
			// « MIS EN FILE », ET NON « ENVOYÉ » : le worker n'a pas encore parlé, et annoncer une
			// remise qui n'a pas eu lieu serait une simulation de succès (`CLAUDE.md` §18).
			setAnnonce(t('envoi.file'))
			onEnvoye?.()
		},
		[a, cci, corps, idCard, identite, onEnvoye, pieces, repondA, sujet],
	)

	const plafond = depassementPlafond(pieces.map((piece) => piece.taille))
	const depotEnCours = pieces.some((piece) => piece.etat === 'depot')
	const totalOctets = pieces.reduce((somme, piece) => somme + piece.taille, 0)
	const motifBlocage =
		plafond === 'nombre'
			? t('envoi.pieces.plafond.nombre', { max: String(PIECES_MAX) })
			: plafond === 'taille'
				? t('envoi.pieces.plafond.taille', { max: tailleLisible(PIECES_OCTETS_MAX) })
				: depotEnCours
					? t('envoi.pieces.attente')
					: null

	if (!ouvert) {
		return (
			<div className="flex flex-col gap-1">
				<Button {...droit} variante="secondaire" onClick={() => setOuvert(true)} data-testid="envoi-ouvrir">
					{repondA === undefined ? t('envoi.open') : t('envoi.reply')}
				</Button>
				{/* UNE RÉGION VIVE DE PLUS, ET C'EST VOULU : la coquille en porte déjà une, la
				    discussion aussi, et une annonce noyée dans celle d'un autre écran ne se
				    distingue pas. `aria-label` la nomme pour que les trois restent lisibles. */}
				{annonce === '' ? null : (
					<p
						role="status"
						aria-label={t('envoi.file.aria')}
						data-testid="envoi-confirmation"
						className="text-sm text-success"
					>
						{annonce}
					</p>
				)}
			</div>
		)
	}

	return (
		<form
			className={[
				'flex flex-col gap-2 rounded-sm',
				// LE GLISSER-DÉPOSER EST SIGNALÉ PAR LA BORDURE DE MARQUE, pendant le survol d'un fichier seulement (§5.4 sexies).
				survol ? 'outline-2 outline-dashed outline-brand' : '',
			].join(' ')}
			onSubmit={(evenement) => void soumettre(evenement)}
			onDragOver={(evenement: DragEvent) => {
				if (!evenement.dataTransfer.types.includes('Files')) return
				evenement.preventDefault()
				setSurvol(true)
			}}
			onDragLeave={() => setSurvol(false)}
			onDrop={(evenement: DragEvent) => {
				if (evenement.dataTransfer.files.length === 0) return
				evenement.preventDefault()
				setSurvol(false)
				joindre(Array.from(evenement.dataTransfer.files))
			}}
			data-testid="envoi-formulaire"
		>
			<label htmlFor="envoi-identite" className="text-sm text-text-2">
				{t('envoi.identity')}
			</label>
			{identites.length === 0 ? (
				<p className="text-sm text-text-3">{t('envoi.identity.empty')}</p>
			) : (
				<select
					id="envoi-identite"
					ref={premierChamp}
					value={identite}
					onChange={(evenement) => setIdentite(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 focus-visible:outline-2 focus-visible:outline-brand"
				>
					{identites.map((candidate) => (
						<option key={candidate.id} value={candidate.id}>
							{candidate.libelle} — {candidate.adresse}
						</option>
					))}
				</select>
			)}

			<label htmlFor="envoi-a" className="text-sm text-text-2">
				{t('envoi.to')}
			</label>
			<input
				id="envoi-a"
				type="text"
				value={a}
				onChange={(evenement) => setA(evenement.target.value)}
				placeholder={t('envoi.to.placeholder')}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 focus-visible:outline-2 focus-visible:outline-brand"
			/>

			{/* LA COPIE CACHÉE SE RÉVÈLE PAR UN LIEN DISCRET, et ne se replie plus une fois ouverte (§5.4 sexies) : un geste
			    rare ne doit pas alourdir chaque envoi. */}
			{cciVisible ? (
				<>
					<label htmlFor="envoi-cci" className="text-sm text-text-2">
						{t('envoi.bcc')}
					</label>
					<input
						id="envoi-cci"
						ref={champCci}
						type="text"
						value={cci}
						onChange={(evenement) => setCci(evenement.target.value)}
						placeholder={t('envoi.to.placeholder')}
						aria-describedby="envoi-cci-aide"
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 focus-visible:outline-2 focus-visible:outline-brand"
					/>
					<p id="envoi-cci-aide" className="text-sm text-text-3">
						{t('envoi.bcc.hint')}
					</p>
				</>
			) : (
				<button
					type="button"
					data-testid="envoi-ajouter-cci"
					onClick={() => setCciVisible(true)}
					className="self-start min-h-[var(--size-target)] text-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand rounded-sm"
				>
					{t('envoi.bcc.add')}
				</button>
			)}

			<label htmlFor="envoi-objet" className="text-sm text-text-2">
				{t('envoi.subject')}
			</label>
			<input
				id="envoi-objet"
				type="text"
				value={sujet}
				onChange={(evenement) => setSujet(evenement.target.value)}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 focus-visible:outline-2 focus-visible:outline-brand"
			/>

			<label htmlFor="envoi-corps" className="text-sm text-text-2">
				{t('envoi.body')}
			</label>
			<textarea
				id="envoi-corps"
				value={corps}
				rows={5}
				onChange={(evenement) => setCorps(evenement.target.value)}
				className="rounded-sm border border-border bg-surface p-2 focus-visible:outline-2 focus-visible:outline-brand"
			/>

			<div className="flex flex-col gap-1">
				<input
					ref={selecteurFichiers}
					type="file"
					multiple
					hidden
					data-testid="envoi-fichiers"
					onChange={(evenement) => {
						joindre(Array.from(evenement.target.files ?? []))
						// Le même fichier doit pouvoir être rechoisi après un retrait.
						evenement.target.value = ''
					}}
				/>
				<Button
					variante="secondaire"
					taille="compacte"
					className="self-start"
					data-testid="envoi-joindre"
					onClick={() => selecteurFichiers.current?.click()}
				>
					<Paperclip aria-hidden="true" size={16} />
					{t('envoi.attach')}
				</Button>
				{pieces.length === 0 ? null : (
					<ul aria-label={t('envoi.pieces.aria')} className="flex flex-col">
						{pieces.map((piece) => (
							<li
								key={piece.cle}
								data-testid="envoi-piece"
								data-etat={piece.etat}
								className="flex items-center gap-2 border-b border-border min-w-0"
							>
								<span className="truncate min-w-0 flex-1 text-sm">{piece.nom}</span>
								<span className="shrink-0 text-sm text-text-3 tabular-nums">{tailleLisible(piece.taille)}</span>
								{piece.etat === 'depot' ? (
									<span className="shrink-0 text-sm text-text-3">{t('envoi.pieces.depot')}</span>
								) : null}
								{piece.etat === 'refuse' ? (
									<span role="alert" className="shrink-0 text-sm text-danger">
										{t('envoi.pieces.refuse')}
									</span>
								) : null}
								<button
									type="button"
									onClick={() => retirer(piece.cle)}
									aria-label={t('envoi.pieces.retirer', { nom: piece.nom })}
									title={t('envoi.pieces.retirer', { nom: piece.nom })}
									className="shrink-0 inline-flex items-center justify-center size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
								>
									<X aria-hidden="true" size={16} />
								</button>
							</li>
						))}
					</ul>
				)}
				{pieces.length === 0 ? null : (
					<p data-testid="envoi-pieces-total" className="text-sm text-text-3 tabular-nums">
						{pieces.length === 1
							? t('envoi.pieces.total.one', {
									taille: tailleLisible(totalOctets),
									max: tailleLisible(PIECES_OCTETS_MAX),
								})
							: t('envoi.pieces.total.many', {
									n: String(pieces.length),
									taille: tailleLisible(totalOctets),
									max: tailleLisible(PIECES_OCTETS_MAX),
								})}
					</p>
				)}
			</div>

			{refus === null ? null : (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			)}
			{motifBlocage === null ? null : (
				<p id="envoi-blocage" className="text-sm text-text-2">
					{motifBlocage}
				</p>
			)}

			<div className="flex gap-2">
				<Button
					{...droit}
					variante="primaire"
					type="submit"
					disabled={droit.disabled === true || envoi || motifBlocage !== null}
					// LE MOTIF DE REFUS DE LA FICHE (§5.59) EST GARDÉ, et celui du blocage s'y ajoute : écraser le premier
					// laisserait un bouton éteint sans dire pourquoi.
					aria-describedby={
						[droit['aria-describedby'], motifBlocage === null ? undefined : 'envoi-blocage']
							.filter((id) => id !== undefined)
							.join(' ') || undefined
					}
					data-testid="envoi-valider"
				>
					{envoi ? t('envoi.sending') : t('envoi.submit')}
				</Button>
				<Button variante="secondaire" onClick={annuler}>
					{t('envoi.cancel')}
				</Button>
			</div>
			{/* L'ADRESSE DE RETOUR EST DITE, parce qu'elle n'est pas celle de l'expéditeur : les
			    réponses reviendront dans l'affaire, et l'utilisateur doit le savoir (§5). */}
			<p className="text-sm text-text-3">{t('envoi.replyto.hint')}</p>
		</form>
	)
}
