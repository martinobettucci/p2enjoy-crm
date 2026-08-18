// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4e :
//       la création d'un contact depuis le carnet
// @spec docs/SPEC-contacts.md §14.1 (les cinq champs), §14.2 (dans le FLUX du document, jamais
//       une modale), §14.3 (ce que l'écriture envoie), §14.4 (dictionnaire FERMÉ des cinq refus),
//       §14.5 (contrat de comportement, cas a à l), §14.6 (aucun droit calculé par l'écran)
// @spec docs/DESIGN_SYSTEM.md §5.23 (ce formulaire), §5.21 (le patron dont il hérite : formulaire
//       dans le flux, refus qui n'efface pas la saisie, focus entrant puis rendu),
//       §5.7 (contrôles), §5.8 (états systématiques), §10 (aucun message serveur affiché tel quel)
//
// L'ÉCRAN NE CALCULE AUCUN DROIT (§14.6) : la lectrice voit le geste, ouvre le formulaire, envoie,
// et reçoit le refus TRADUIT — mesuré `403` / `42501`. Une commande grisée selon le rôle ferait
// passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).
//
// UN REFUS N'EFFACE JAMAIS LA SAISIE (§14.4) : la personne corrige et renvoie. Le message vit
// SOUS le formulaire, près de ce qui l'a causé.

import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	creerContact,
	type ContactDuCarnet,
	type OrganisationChoisissable,
	type RefusCreationContact,
	type SaisieContact,
} from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'

/** La saisie vide : les cinq champs du §14.1, tous en chaîne — le module normalise (§14.3). */
const SAISIE_VIDE: SaisieContact = {
	nom: '',
	idOrganisation: '',
	fonction: '',
	email: '',
	telephone: '',
}

/**
 * Les cinq natures de refus, traduites par un dictionnaire FERMÉ (§14.4).
 *
 * Une nature nouvelle ne peut pas apparaître sans que ce tableau ne soit complété : le type
 * `RefusCreationContact['nature']` l'y oblige, et c'est le point d'un dictionnaire fermé.
 */
const CLES_REFUS: Record<RefusCreationContact['nature'], CleTraduction> = {
	interdit: 'contacts.creation.refus.interdit',
	doublon: 'contacts.creation.refus.doublon',
	'organisation-inconnue': 'contacts.creation.refus.organisation',
	'saisie-invalide': 'contacts.creation.refus.saisie',
	indisponible: 'contacts.creation.refus.indisponible',
}

const CLASSES_CHAMP =
	'h-[var(--size-target)] w-full rounded-md border border-border bg-surface px-3 text-text-1'

export type ProprietesFormulaireCreationContact = {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly organisations: EtatAsync<readonly OrganisationChoisissable[]>
	readonly onRelireOrganisations: () => void
	readonly onCree: (contact: ContactDuCarnet) => void
	readonly onFermer: () => void
}

/**
 * Le formulaire de création, monté dans le FLUX du document au-dessus du tableau (§14.2).
 *
 * LE FOCUS ENTRE sur le champ du nom (§14.5 cas b) et il est RENDU à la commande d'ouverture par
 * le carnet à la fermeture (cas c) : un formulaire qui s'ouvre sans prendre le focus oblige à le
 * chercher au clavier, et un formulaire qui se referme sans le rendre le perd sur le document.
 */
export function FormulaireCreationContact({
	client,
	idWorkspace,
	organisations,
	onRelireOrganisations,
	onCree,
	onFermer,
}: ProprietesFormulaireCreationContact) {
	const [saisie, setSaisie] = useState<SaisieContact>(SAISIE_VIDE)
	const [refus, setRefus] = useState<RefusCreationContact | null>(null)
	const [nomManquant, setNomManquant] = useState(false)
	const [envoiEnCours, setEnvoiEnCours] = useState(false)
	const champNom = useRef<HTMLInputElement | null>(null)
	const idNom = useId()
	const idOrganisation = useId()
	const idFonction = useId()
	const idEmail = useId()
	const idTelephone = useId()
	const idErreurNom = useId()

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	const modifier = (champ: keyof SaisieContact, valeur: string) => {
		setSaisie((precedente) => ({ ...precedente, [champ]: valeur }))
	}

	const envoyer = async (evenement: React.FormEvent) => {
		evenement.preventDefault()
		// L'ENVOI NE PART QU'UNE FOIS (§14.5 cas j) : un second déclenchement pendant l'aller-retour
		// créerait deux contacts, la base n'ayant aucune unicité sur le seul nom.
		if (envoiEnCours) return
		// LE SEUL CONTRÔLE D'ÉCRAN, et il ne remplace aucune règle (§14.5 cas d) : la base refuse
		// déjà un nom blanc en `400` / `23514`. L'écran l'anticipe pour ne pas faire payer un
		// aller-retour à une faute évidente, et traduit quand même le refus serveur s'il survient.
		if (saisie.nom.trim() === '') {
			setNomManquant(true)
			setRefus(null)
			champNom.current?.focus()
			return
		}
		setNomManquant(false)
		setRefus(null)
		setEnvoiEnCours(true)
		const resultat = await creerContact(client, { idWorkspace, saisie })
		setEnvoiEnCours(false)
		if (resultat.statut === 'refus') {
			// LA SAISIE EST CONSERVÉE (§14.4) : elle est ce qu'il faut corriger.
			setRefus(resultat.refus)
			return
		}
		setSaisie(SAISIE_VIDE)
		onCree(resultat.contact)
	}

	const listeIndisponible = organisations.statut !== 'pret'
	const listeVide = organisations.statut === 'pret' && organisations.donnees.length === 0

	return (
		<form
			data-testid="formulaire-creation-contact"
			aria-label={t('contacts.creation.title')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				void envoyer(evenement)
			}}
		>
			<div className="flex flex-col gap-1">
				<label htmlFor={idNom} className="text-sm text-text-2">
					{t('contacts.creation.name')}
				</label>
				<input
					id={idNom}
					ref={champNom}
					data-testid="champ-nom-contact"
					className={CLASSES_CHAMP}
					value={saisie.nom}
					required
					aria-invalid={nomManquant}
					aria-describedby={nomManquant ? idErreurNom : undefined}
					onChange={(evenement) => modifier('nom', evenement.target.value)}
				/>
				{nomManquant ? (
					<p id={idErreurNom} role="alert" className="text-sm text-danger">
						{t('contacts.creation.nameRequired')}
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={idOrganisation} className="text-sm text-text-2">
					{t('contacts.creation.organization')}
				</label>
				{/*
				  LES CAS k ET l DU §14.5 sont ceux du sélecteur de la sous-tranche 4d (§13.5 cas h
				  et i), et ils sont repris sans les réécrire : une liste illisible DÉSACTIVE le
				  contrôle et offre une action de reprise — il n'y a rien à choisir, et un `select`
				  vide mais actif serait une commande morte ; une liste vide n'offre que l'option
				  vide et le dit, SANS action, aucune surface ne créant d'organisation (§14.7).
				*/}
				<select
					id={idOrganisation}
					data-testid="champ-organisation-contact"
					className={CLASSES_CHAMP}
					value={saisie.idOrganisation}
					disabled={listeIndisponible}
					aria-busy={organisations.statut === 'chargement'}
					onChange={(evenement) => modifier('idOrganisation', evenement.target.value)}
				>
					{organisations.statut === 'chargement' ? (
						<option value="">{t('contacts.creation.organization.loading')}</option>
					) : (
						<>
							<option value="">{t('contacts.creation.organization.none')}</option>
							{organisations.statut === 'pret'
								? organisations.donnees.map((organisation) => (
										<option key={organisation.id} value={organisation.id}>
											{organisation.name}
										</option>
									))
								: null}
						</>
					)}
				</select>
				{organisations.statut === 'erreur' ? (
					<p className="flex items-center gap-2 text-sm text-danger">
						{t('contacts.creation.organization.error')}
						<button
							type="button"
							data-testid="relire-organisations"
							className="min-h-[var(--size-target)] text-brand hover:underline"
							onClick={onRelireOrganisations}
						>
							{t('contacts.creation.organization.retry')}
						</button>
					</p>
				) : null}
				{listeVide ? (
					<p className="text-sm text-text-2">{t('contacts.creation.organization.empty')}</p>
				) : null}
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={idFonction} className="text-sm text-text-2">
					{t('contacts.creation.role')}
				</label>
				<input
					id={idFonction}
					data-testid="champ-fonction-contact"
					className={CLASSES_CHAMP}
					value={saisie.fonction}
					onChange={(evenement) => modifier('fonction', evenement.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={idEmail} className="text-sm text-text-2">
					{t('contacts.creation.email')}
				</label>
				<input
					id={idEmail}
					type="email"
					data-testid="champ-email-contact"
					className={CLASSES_CHAMP}
					value={saisie.email}
					onChange={(evenement) => modifier('email', evenement.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor={idTelephone} className="text-sm text-text-2">
					{t('contacts.creation.phone')}
				</label>
				<input
					id={idTelephone}
					data-testid="champ-telephone-contact"
					className={CLASSES_CHAMP}
					value={saisie.telephone}
					onChange={(evenement) => modifier('telephone', evenement.target.value)}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<button
					type="submit"
					data-testid="envoyer-creation-contact"
					aria-busy={envoiEnCours}
					className="min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface"
				>
					{t('contacts.creation.submit')}
				</button>
				<button
					type="button"
					data-testid="annuler-creation-contact"
					className="min-h-[var(--size-target)] rounded-md border border-border px-4"
					onClick={onFermer}
				>
					{t('contacts.creation.cancel')}
				</button>
			</div>

			{refus === null ? null : (
				<p role="alert" data-testid="refus-creation-contact" className="text-sm text-danger">
					{t(CLES_REFUS[refus.nature])}
				</p>
			)}
		</form>
	)
}

/** L'état initial de la liste des organisations, exporté pour le carnet et ses tests. */
export const ORGANISATIONS_EN_CHARGEMENT: EtatAsync<readonly OrganisationChoisissable[]> =
	enChargement()
