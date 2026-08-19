// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4g :
//       la modification d'un contact depuis sa fiche
// @spec docs/SPEC-contacts.md §16.1 (les cinq champs PRÉREMPLIS), §16.2 (dans le FLUX de la fiche,
//       jamais une modale ; les champs partagés), §16.3 (ce que l'écriture envoie),
//       §16.4 (dictionnaire FERMÉ des six refus), §16.6 (aucun droit calculé par l'écran),
//       §16.9 (contrat de comportement, cas a à r)
// @spec docs/DESIGN_SYSTEM.md §5.25 (ce formulaire), §5.21 (le patron dont il hérite),
//       §5.7 (contrôles), §5.8 (états systématiques), §10 (aucun message serveur affiché tel quel)
//
// L'ÉCRAN NE CALCULE AUCUN DROIT (§16.6) : la lectrice voit le geste, ouvre le formulaire, envoie,
// et reçoit le message TRADUIT. Une commande grisée selon le rôle ferait passer une décision de la
// base pour une décision d'écran (`CLAUDE.md` §10).
//
// LA DIFFÉRENCE AVEC 4e EST RÉELLE ET ASSUMÉE (§16.6) : à la création, la lectrice reçoit un refus
// qui DIT qu'il en est un — `403` / `42501`. Ici elle reçoit `sans-effet`, qui dit que rien n'a
// changé sans affirmer pourquoi, parce que c'est tout ce que le serveur permet de dire : la clause
// `USING` de la politique de mise à jour rend la ligne invisible, et PostgREST rend `200` et `[]`.
//
// UN REFUS N'EFFACE JAMAIS LA SAISIE (§16.4) : la personne corrige et renvoie.

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import type { EtatAsync } from '../lib/async'
import {
	modifierContact,
	type ContactDuCarnet,
	type OrganisationChoisissable,
	type RefusModificationContact,
	type SaisieContact,
} from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'
import { ChampsContact } from './ChampsContact'

/**
 * Les SIX natures de refus, traduites par un dictionnaire FERMÉ (§16.4).
 *
 * Une nature nouvelle ne peut pas apparaître sans que ce tableau ne soit complété : le type
 * `RefusModificationContact['nature']` l'y oblige, et c'est le point d'un dictionnaire fermé.
 */
const CLES_REFUS: Record<RefusModificationContact['nature'], CleTraduction> = {
	'sans-effet': 'contact.modification.refus.sansEffet',
	interdit: 'contact.modification.refus.interdit',
	doublon: 'contact.modification.refus.doublon',
	'organisation-inconnue': 'contact.modification.refus.organisation',
	'saisie-invalide': 'contact.modification.refus.saisie',
	indisponible: 'contact.modification.refus.indisponible',
}

/**
 * Les valeurs courantes du contact, telles que le formulaire les préremplit (§16.9 cas b).
 *
 * Une colonne `null` devient une chaîne VIDE : les champs sont des contrôles contrôlés, et leur
 * passer `null` les rendrait non contrôlés au premier rendu. `normaliserFacultatif` refait le
 * chemin inverse à l'envoi (§16.3).
 */
export function saisieDepuisContact(contact: {
	readonly full_name: string
	readonly organization_id: string | null
	readonly role_title: string | null
	readonly email: string | null
	readonly phone: string | null
}): SaisieContact {
	return {
		nom: contact.full_name,
		idOrganisation: contact.organization_id ?? '',
		fonction: contact.role_title ?? '',
		email: contact.email ?? '',
		telephone: contact.phone ?? '',
	}
}

export type ProprietesFormulaireModificationContact = {
	readonly client: ClientCrm
	readonly idContact: string
	/** Les valeurs courantes, qui préremplissent la saisie à l'ouverture (§16.9 cas b). */
	readonly valeurs: SaisieContact
	readonly organisations: EtatAsync<readonly OrganisationChoisissable[]>
	readonly onRelireOrganisations: () => void
	readonly onModifie: (contact: ContactDuCarnet) => void
	readonly onFermer: () => void
}

/**
 * Le formulaire de modification, monté dans le FLUX de la fiche au-dessus des deux zones (§16.2).
 *
 * LE FOCUS ENTRE sur le champ du nom (§16.9 cas b) ; il est RENDU à la commande d'ouverture par la
 * fiche à la fermeture (cas c), qui seule sait quand cette commande est remontée (§16.5).
 */
export function FormulaireModificationContact({
	client,
	idContact,
	valeurs,
	organisations,
	onRelireOrganisations,
	onModifie,
	onFermer,
}: ProprietesFormulaireModificationContact) {
	const [saisie, setSaisie] = useState<SaisieContact>(valeurs)
	const [refus, setRefus] = useState<RefusModificationContact | null>(null)
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
		// L'ENVOI NE PART QU'UNE FOIS (§16.9 cas o) : un second déclenchement pendant l'aller-retour
		// écrirait deux fois la même chose et ferait clignoter la fiche entre deux réponses.
		if (envoiEnCours) return
		// LE SEUL CONTRÔLE D'ÉCRAN, et il ne remplace aucune règle (§16.9 cas d) : la base refuse
		// déjà un nom blanc en `400` / `23514` (mesure 5). L'écran l'anticipe pour ne pas faire payer
		// un aller-retour à une faute évidente, et traduit quand même le refus serveur s'il survient.
		if (saisie.nom.trim() === '') {
			setNomManquant(true)
			setRefus(null)
			champNom.current?.focus()
			return
		}
		setNomManquant(false)
		setRefus(null)
		setEnvoiEnCours(true)
		const resultat = await modifierContact(client, { idContact, saisie })
		setEnvoiEnCours(false)
		if (resultat.statut === 'refus') {
			// LA SAISIE EST CONSERVÉE (§16.4) : elle est ce qu'il faut corriger — et dans le cas
			// `sans-effet`, elle est ce que la personne perdrait sans l'avoir jamais enregistré.
			setRefus(resultat.refus)
			return
		}
		onModifie(resultat.contact)
	}

	return (
		<form
			data-testid="formulaire-modification-contact"
			aria-label={t('contact.modification.title')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				void envoyer(evenement)
			}}
		>
			<h2 className="text-h3">{t('contact.modification.title')}</h2>

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
					data-testid="envoyer-modification-contact"
					aria-busy={envoiEnCours}
					className="min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface"
				>
					{t('contact.modification.submit')}
				</button>
				<button
					type="button"
					data-testid="annuler-modification-contact"
					className="min-h-[var(--size-target)] rounded-md border border-border px-4"
					onClick={onFermer}
				>
					{t('contact.modification.cancel')}
				</button>
			</div>

			{refus === null ? null : (
				<p role="alert" data-testid="refus-modification-contact" className="text-sm text-danger">
					{t(CLES_REFUS[refus.nature])}
				</p>
			)}
		</form>
	)
}
