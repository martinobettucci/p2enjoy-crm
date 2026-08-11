// @spec CRM-058 (docs/BACKLOG.md) — composer et répondre, par le même chemin
// @spec docs/SPEC-mail-subsystem.md §19.6 (le même chemin de code depuis la card et depuis
//       l'inbox), §19.4 (les refus tels que l'écran doit les présenter)
// @spec docs/DESIGN_SYSTEM.md §5.5 (boutons), §5.8 (états), §10 (clavier, labels)
//
// UN SEUL COMPOSANT POUR LES DEUX ORIGINES, et c'est le §19.6 qui l'exige : « le même chemin de
// code, seule la card sélectionnée diffère ». Deux formulaires jumeaux auraient divergé au premier
// correctif — l'un porterait la garde, l'autre l'aurait oubliée.
//
// L'ÉCRAN N'OUVRE AUCUNE CONNEXION : il met en file. Ce qu'il annonce, c'est « votre message part
// », jamais « votre message est arrivé » — le worker n'a pas encore parlé.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import {
	decouperDestinataires,
	lireIdentitesDisponibles,
	mettreEnFile,
	type IdentiteEnvoi,
	type NatureRefusEnvoi,
} from '../lib/envoi'
import { clientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/** Les cinq refus possibles, nommés LITTÉRALEMENT — une clé composée échappe au contrôle des
 *  clés mortes, défaut mesuré sur l'inbox de `CRM-057`. */
const LIBELLE_REFUS: Readonly<Record<NatureRefusEnvoi, CleTraduction>> = {
	forbidden: 'envoi.refus.forbidden',
	invalide: 'envoi.refus.invalide',
	quota: 'envoi.refus.quota',
	network: 'envoi.refus.network',
	unknown: 'envoi.refus.unknown',
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
	const [ouvert, setOuvert] = useState(false)
	const [identites, setIdentites] = useState<readonly IdentiteEnvoi[]>([])
	const [identite, setIdentite] = useState('')
	const [a, setA] = useState(destinataire)
	const [sujet, setSujet] = useState(objet)
	const [corps, setCorps] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const premierChamp = useRef<HTMLSelectElement | null>(null)
	const authentification = useAuthentification()
	const idUtilisateur =
		authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null

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
			setOuvert(false)
			// « MIS EN FILE », ET NON « ENVOYÉ » : le worker n'a pas encore parlé, et annoncer une
			// remise qui n'a pas eu lieu serait une simulation de succès (`CLAUDE.md` §18).
			setAnnonce(t('envoi.file'))
			onEnvoye?.()
		},
		[a, corps, idCard, identite, onEnvoye, repondA, sujet],
	)

	if (!ouvert) {
		return (
			<div className="flex flex-col gap-1">
				<Button variante="secondaire" onClick={() => setOuvert(true)} data-testid="envoi-ouvrir">
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
			className="flex flex-col gap-2"
			onSubmit={(evenement) => void soumettre(evenement)}
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

			{refus === null ? null : (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			)}

			<div className="flex gap-2">
				<Button variante="primaire" type="submit" disabled={envoi} data-testid="envoi-valider">
					{envoi ? t('envoi.sending') : t('envoi.submit')}
				</Button>
				<Button variante="secondaire" onClick={() => setOuvert(false)}>
					{t('envoi.cancel')}
				</Button>
			</div>
			{/* L'ADRESSE DE RETOUR EST DITE, parce qu'elle n'est pas celle de l'expéditeur : les
			    réponses reviendront dans l'affaire, et l'utilisateur doit le savoir (§5). */}
			<p className="text-sm text-text-3">{t('envoi.replyto.hint')}</p>
		</form>
	)
}
