// @spec CRM-095 (docs/BACKLOG.md) — tranche T2 : « Nouvelle affaire », sur le board et dans la vue liste
// @spec docs/SPEC-cards.md §18.1 (les arbitrages : le board, le titre seul, la fiche qui s'ouvre),
//       §18.3 (l'écran : bouton, formulaire dans le flux, refus, succès) ; docs/JOURNAL.md décision 609
// @spec docs/DESIGN_SYSTEM.md §5.50 (Nouvelle affaire), §5.2 (l'action de la colonne initiale vide),
//       §5.13 (formulaire dans le flux, focus entrant puis rendu), §5.25 (retour du focus différé d'un
//       tour de rendu), §5.7 (champ, refus `role="alert"`), §8 (états désactivés lisibles), §9 (`Plus`)
//
// UN SEUL GESTE, TROIS POINTS D'ENTRÉE, ET CE MODULE LES PORTE TOUS LES TROIS : la commande de la barre du
// board, celle de la barre de filtres de la vue liste, et l'action de la colonne initiale vide. Deux
// implémentations du même formulaire divergeraient au premier ajustement.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT (§18.3) : la commande est rendue à tous les rôles, la base refuse ce que
// l'appelant ne peut pas écrire, et le refus est traduit dans le formulaire (CLAUDE.md §10).

import { Plus, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { creerAffaire, type RefusCreationAffaire } from '../lib/creer-affaire'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_WORKFLOWS } from './chemins'

/** Qui a ouvert le formulaire : c'est à lui que le focus revient (docs/DESIGN_SYSTEM.md §5.13). */
export type OrigineCreation = 'barre' | 'colonne'

/**
 * L'état partagé entre les commandes et le formulaire.
 *
 * Il vit chez l'écran qui les place — le board, la zone de la vue liste — parce que la commande et le
 * formulaire n'ont pas la même place dans le document : la commande dans une barre, le formulaire sous
 * elle (§5.50).
 */
export type CreationAffaire = {
	readonly ouvert: boolean
	readonly ouvrir: (origine: OrigineCreation) => void
	readonly fermer: () => void
	readonly refBarre: RefObject<HTMLButtonElement | null>
	readonly refColonne: RefObject<HTMLButtonElement | null>
}

/**
 * La commande et le formulaire S'EXCLUENT (§5.50, §5.23) : la commande est démontée pendant la saisie.
 *
 * LE RETOUR DU FOCUS EST DONC DIFFÉRÉ D'UN TOUR DE RENDU — le remède du §5.25, un drapeau puis un effet.
 * Appelé depuis le gestionnaire de fermeture, `focus()` viserait une commande qui n'est pas encore
 * remontée, et le focus retomberait sur le document. Aucune temporisation (CLAUDE.md §18).
 */
export function useCreationAffaire(): CreationAffaire {
	const [ouvert, setOuvert] = useState(false)
	const [rendreFocus, setRendreFocus] = useState(false)
	const origine = useRef<OrigineCreation>('barre')
	const refBarre = useRef<HTMLButtonElement | null>(null)
	const refColonne = useRef<HTMLButtonElement | null>(null)

	useEffect(() => {
		if (!rendreFocus) return
		setRendreFocus(false)
		// La colonne peut ne plus être vide — une affaire créée entre-temps par un collègue, relue — et
		// son action n'existe alors plus : le focus revient à la commande de la barre, toujours rendue.
		const cible = origine.current === 'colonne' ? (refColonne.current ?? refBarre.current) : refBarre.current
		cible?.focus()
	}, [rendreFocus])

	const ouvrir = useCallback((depuis: OrigineCreation) => {
		origine.current = depuis
		setOuvert(true)
	}, [])

	const fermer = useCallback(() => {
		setOuvert(false)
		setRendreFocus(true)
	}, [])

	return { ouvert, ouvrir, fermer, refBarre, refColonne }
}

/** La commande « Nouvelle affaire », primaire, en tête de sa barre (§5.50). Absente pendant la saisie. */
export function CommandeNouvelleAffaire({ creation }: { readonly creation: CreationAffaire }) {
	if (creation.ouvert) return null
	return (
		<Button
			ref={creation.refBarre}
			variante="primaire"
			data-testid="nouvelle-affaire"
			onClick={() => creation.ouvrir('barre')}
		>
			<Plus aria-hidden="true" size={16} strokeWidth={2} />
			{t('affaire.creation.commande')}
		</Button>
	)
}

/**
 * L'action de la colonne de l'étape INITIALE, quand elle est vide (§5.2).
 *
 * Secondaire : la barre porte déjà la commande primaire du même geste, et deux primaires sur un écran ne
 * diraient plus lequel est le chemin principal (§5.5). Absente pendant la saisie, comme la commande.
 */
export function ActionColonneInitiale({ creation }: { readonly creation: CreationAffaire }) {
	if (creation.ouvert) return null
	return (
		<Button
			ref={creation.refColonne}
			variante="secondaire"
			className="self-start"
			data-testid="creer-affaire-colonne"
			onClick={() => creation.ouvrir('colonne')}
		>
			<Plus aria-hidden="true" size={16} strokeWidth={2} />
			{t('affaire.creation.colonne')}
		</Button>
	)
}

/** Les quatre refus, par un dictionnaire FERMÉ : un refus nouveau ne compile pas sans son texte. */
const CLES_REFUS: Readonly<Record<RefusCreationAffaire, CleTraduction>> = {
	'channel-ferme': 'affaire.creation.refus.ferme',
	'sans-etape-initiale': 'affaire.creation.refus.initiale',
	interdit: 'affaire.creation.refus.interdit',
	panne: 'affaire.creation.refus.panne',
}

/**
 * Le lien du refus « aucune étape initiale » — variante SECONDAIRE du §5.5, portée par un lien.
 *
 * Même motif que la reprise du bandeau de refus du board (`Board.tsx`) : les couleurs sont posées, sans
 * quoi le lien hériterait de `--color-danger-on-soft` et se lirait comme une partie du message plutôt que
 * comme le geste qui lève le refus (§5.29 bis).
 */
const CLASSES_LIEN_REFUS = [
	'inline-flex items-center justify-center self-start',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-surface text-ink border border-border font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
].join(' ')

export type ProprietesFormulaireNouvelleAffaire = {
	readonly creation: CreationAffaire
	readonly client: ClientCrm | null
	readonly idChannel: string
	readonly slugTrack: string
	readonly slugChannel: string
}

/**
 * Le formulaire, DANS LE FLUX, sous la barre qui l'a ouvert — aucune modale (§5.50, §5.13).
 *
 * Un champ, deux commandes. Le succès OUVRE LA FICHE de l'affaire (§18.1) : c'est elle qui porte la suite
 * — montant, responsable, échéance —, le titre seul suffisant à faire naître l'affaire.
 */
export function FormulaireNouvelleAffaire({
	creation,
	client,
	idChannel,
	slugTrack,
	slugChannel,
}: ProprietesFormulaireNouvelleAffaire) {
	const naviguer = useNavigate()
	const idChamp = useId()
	const idRefus = useId()
	const [titre, setTitre] = useState('')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<RefusCreationAffaire | null>(null)
	const champ = useRef<HTMLInputElement | null>(null)

	// LE FOCUS ENTRE DANS LE CHAMP à l'ouverture (§5.13) : un formulaire qu'il faudrait chercher au
	// clavier après l'avoir ouvert n'est pas le geste que la commande promettait.
	useEffect(() => {
		champ.current?.focus()
	}, [])

	// UN CHAMP REQUIS, NON UN DROIT CALCULÉ (§5.50) : « Créer » reste éteint tant que le titre est blanc,
	// comme le nom d'un channel. La base refuserait de toute façon (`23514`) ; l'écran n'envoie pas une
	// faute évidente.
	const blanc = titre.trim() === ''

	const fermer = () => {
		// UNE ÉCRITURE EN VOL N'EST PAS ANNULÉE (§5.50) : ni « Annuler » ni `Échap` n'agissent pendant
		// l'envoi — l'affaire naît ou le refus s'écrit, et l'écran le dit.
		if (enCours) return
		creation.fermer()
	}

	const envoyer = async () => {
		if (blanc || enCours) return
		setRefus(null)
		setEnCours(true)
		const issue = await creerAffaire(client, idChannel, titre)
		if (issue.ok) {
			naviguer(`/tracks/${slugTrack}/${slugChannel}/cards/${issue.idCard}`)
			return
		}
		setEnCours(false)
		// LA SAISIE EST CONSERVÉE (§5.7 ter) et le focus revient au champ : « Créer », éteint pendant
		// l'envoi, a perdu le focus si c'est lui qu'on avait actionné.
		setRefus(issue.refus)
		champ.current?.focus()
	}

	return (
		<form
			data-testid="formulaire-nouvelle-affaire"
			aria-label={t('affaire.creation.aria')}
			className="flex flex-col gap-3 bg-surface border border-border rounded-lg p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				// Le formulaire consomme sa touche : une surface voisine qui écoute `Échap` — le guide
				// flottant — ne doit pas se refermer avec lui.
				evenement.preventDefault()
				evenement.stopPropagation()
				fermer()
			}}
		>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={idChamp} className="text-sm text-text-2">
					{t('affaire.creation.titre')}
				</label>
				<input
					id={idChamp}
					ref={champ}
					data-testid="champ-titre-affaire"
					type="text"
					autoComplete="off"
					value={titre}
					onChange={(evenement) => setTitre(evenement.target.value)}
					{...(refus === null ? {} : { 'aria-describedby': idRefus })}
					className="min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base"
				/>
			</div>

			{refus === null ? null : (
				<div
					id={idRefus}
					role="alert"
					data-testid="refus-nouvelle-affaire"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<div className="flex flex-col gap-2 min-w-0">
						<p>{t(CLES_REFUS[refus])}</p>
						{/* UN REFUS NOMME LE GESTE QUI LE LÈVE (§5.29 bis) : l'étape initiale se désigne dans
						    l'éditeur de workflows. Un lien et non un bouton : il change d'adresse (§12.1). */}
						{refus !== 'sans-etape-initiale' ? null : (
							<Link to={CHEMIN_ADMIN_WORKFLOWS} data-testid="lien-editeur-workflows" className={CLASSES_LIEN_REFUS}>
								{t('affaire.creation.refus.initiale.lien')}
							</Link>
						)}
					</div>
				</div>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button variante="primaire" type="submit" disabled={blanc || enCours} data-testid="creer-affaire">
					{t(enCours ? 'affaire.creation.encours' : 'affaire.creation.creer')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="annuler-nouvelle-affaire" onClick={fermer}>
					{t('affaire.creation.annuler')}
				</Button>
			</div>
		</form>
	)
}
