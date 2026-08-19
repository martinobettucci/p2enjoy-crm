// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 : les cinq champs d'un
//       contact, PARTAGÉS par le formulaire de création (4e) et celui de modification (4g)
// @spec docs/SPEC-contacts.md §14.1 (les cinq champs), §14.5 (cas d, k et l),
//       §16.2 (« les cinq champs sont ceux du §14.1, et ils ne sont pas réécrits »),
//       §13.5 (cas h et i : les trois états du sélecteur d'organisation)
// @spec docs/DESIGN_SYSTEM.md §5.23 (le formulaire de création), §5.25 (celui de modification),
//       §5.7 (contrôles), §5.8 (états systématiques)
//
// EXTRAIT SANS CHANGEMENT DE COMPORTEMENT. Ce module ne fait que déplacer les champs qui vivaient
// dans `FormulaireCreationContact`, avec leurs `data-testid`, leurs libellés, leurs identifiants
// d'accessibilité et les trois états du sélecteur d'organisation. La preuve de cette invariance est
// que `Carnet.test.tsx` reste vert SANS être modifié (§16.10).
//
// DEUX COPIES D'UNE MÊME SAISIE DIVERGERAIENT au premier champ ajouté (§16.2) : c'est le motif de
// l'extraction, et non une élégance.
//
// LES CLÉS DE TRADUCTION RESTENT `contacts.creation.*`, et ce n'est pas un oubli : ce sont les clés
// des CHAMPS, nommées à leur première livraison. Les renommer toucherait les preuves de 4e et le
// dictionnaire sans changer un seul texte visible — un mouvement sans contrepartie.

import { useId, type RefObject } from 'react'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { OrganisationChoisissable, SaisieContact } from '../lib/contacts'

export const CLASSES_CHAMP =
	'h-[var(--size-target)] w-full rounded-md border border-border bg-surface px-3 text-text-1'

export type ProprietesChampsContact = {
	readonly saisie: SaisieContact
	readonly onModifier: (champ: keyof SaisieContact, valeur: string) => void
	/** Vrai quand le seul contrôle d'écran a refusé l'envoi : le nom est blanc (§14.5 cas d). */
	readonly nomManquant: boolean
	/** Référence du champ du nom, portée par le formulaire qui fait entrer le focus. */
	readonly champNom: RefObject<HTMLInputElement | null>
	readonly organisations: EtatAsync<readonly OrganisationChoisissable[]>
	readonly onRelireOrganisations: () => void
}

/**
 * Les cinq champs d'un contact : nom (obligatoire), organisation, fonction, email, téléphone.
 *
 * Le composant ne décide RIEN : ni l'envoi, ni les refus, ni l'entrée du focus. Il rend une saisie
 * et signale ses changements — les deux formulaires qui l'emploient portent des contrats
 * d'écriture différents (§14.3 et §16.3), et c'est là que la différence doit vivre.
 */
export function ChampsContact({
	saisie,
	onModifier,
	nomManquant,
	champNom,
	organisations,
	onRelireOrganisations,
}: ProprietesChampsContact) {
	const idNom = useId()
	const idOrganisation = useId()
	const idFonction = useId()
	const idEmail = useId()
	const idTelephone = useId()
	const idErreurNom = useId()

	const listeIndisponible = organisations.statut !== 'pret'
	const listeVide = organisations.statut === 'pret' && organisations.donnees.length === 0

	return (
		<>
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
					onChange={(evenement) => onModifier('nom', evenement.target.value)}
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
					onChange={(evenement) => onModifier('idOrganisation', evenement.target.value)}
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
					onChange={(evenement) => onModifier('fonction', evenement.target.value)}
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
					onChange={(evenement) => onModifier('email', evenement.target.value)}
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
					onChange={(evenement) => onModifier('telephone', evenement.target.value)}
				/>
			</div>
		</>
	)
}
