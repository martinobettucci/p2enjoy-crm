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
//
// LES CINQ CHAMPS VIVENT DÉSORMAIS DANS `ChampsContact` (§16.2), PARTAGÉS avec le formulaire de
// modification de la sous-tranche 4g. Le comportement de ce formulaire est INCHANGÉ, et la preuve
// en est que `Carnet.test.tsx` reste vert sans être modifié. Ce qui reste ici est ce que la
// création seule décide : ce qu'elle envoie, et les cinq refus qu'elle traduit.

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import { enChargement, type EtatAsync } from '../lib/async'
import { ChampsContact } from './ChampsContact'
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

	return (
		<form
			data-testid="formulaire-creation-contact"
			aria-label={t('contacts.creation.title')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				void envoyer(evenement)
			}}
		>
			<ChampsContact
				saisie={saisie}
				onModifier={modifier}
				nomManquant={nomManquant}
				champNom={champNom}
				organisations={organisations}
				onRelireOrganisations={onRelireOrganisations}
			/>

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
