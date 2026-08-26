// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 6 : la SUPPRESSION d'un
//       contact depuis sa fiche
// @spec docs/SPEC-contacts.md §20.2 (les neuf mesures du 2026-08-26, et les quatre qui décident),
//       §20.4 (où le geste s'ancre, et le retour au carnet sur le seul succès),
//       §20.5 (dictionnaire FERMÉ des refus, dont trois natures inatteignables),
//       §20.6 (de quoi le geste a l'air, et les DEUX conséquences que la confirmation énonce),
//       §20.7 (contrat de comportement, cas a à n), §20.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.40 (ce geste), §5.24 révisé par livraison (la fiche porte DEUX
//       commandes), §5.27 (la mécanique de confirmation dont il hérite), §5.13 (confirmation DANS
//       LE FLUX, jamais en modale), §5.3 (bouton destructif), §6 (une confirmation NOMME son
//       objet), §9 (icônes), §10 (aucun texte en dur)
// @spec docs/SPEC-permissions-rls.md §7 (un refus silencieux est zéro ligne, jamais une erreur)
//
// TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE (§20.2, mesure 3). Une suppression est filtrée par
// la clause `USING` de `contacts_suppression_bizdev_admin`, qui rend la ligne INVISIBLE À
// L'ÉCRITURE : PostgREST rend `200` et zéro ligne, SANS aucune erreur, sur une ligne qui EXISTE et
// qui reste en base. Quitter la fiche sur ce silence annoncerait une suppression qui n'a pas eu
// lieu — le mensonge que `CLAUDE.md` §18 interdit, et que le §5.25 du design system nomme déjà.
//
// LA CONFIRMATION ÉNONCE DEUX CONSÉQUENCES, ET AUCUNE N'EST LISIBLE SUR L'ÉCRAN QU'ON REGARDE :
//
//   1. CE QUE LE GESTE EMPORTE — `card_contacts` référence `contacts` en `on delete cascade`, et le
//      trigger de la migration 0061 écrit `contact_unlinked` dans le fil de CHAQUE affaire encore
//      vivante. MESURÉ le 2026-08-26 : le fil de `…0c1` passe de 9 à 10 événements, et la trace
//      porte `{"role": "sonde", "contact_id": "…"}`. `card_events` étant append-only et refusant un
//      `DELETE` même à la clé de service (garantie de `CRM-044`), cette trace est DÉFINITIVE.
//   2. CE QUE LE GESTE NE DÉTRUIT PAS — les valeurs de formulaire qui désignent ce contact
//      DEMEURENT (décision 516, mesure 9). Propriété rassurante et contre-intuitive : la taire
//      laisserait croire à une purge.
//
// AUCUN COMPTAGE N'EST ÉMIS POUR CELA (§20.8) : le nombre d'affaires vient de la DONNÉE DÉJÀ LUE
// par la zone 2 de la fiche (§15.3). Compter les valeurs de formulaire, elles, demanderait de
// balayer `card_field_values` sur un `jsonb` sans index à chaque ouverture de la confirmation, pour
// une phrase que la mesure 9 rend vraie sans qu'on ait à compter.

import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { supprimerContact, type RefusSuppressionContact } from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire FERMÉ des refus, jamais le message du serveur (§20.5, règle du §12.5).
 *
 * **TROIS NATURES SONT STRUCTURELLEMENT INATTEIGNABLES ICI, ET ELLES PARTAGENT LE TEXTE
 * D'`indisponible`.** `doublon` (`23505`) suppose une INSERTION ; `organisation-inconnue` (`23503`)
 * suppose une clé étrangère SORTANTE à éprouver, et une suppression n'en éprouve aucune ;
 * `saisie-invalide` (`23514`) suppose une valeur écrite. Leur donner un texte propre ferait entrer
 * dans le produit une phrase que **rien** ne peut afficher, donc qu'aucune preuve ne peut éprouver.
 * Le dictionnaire reste exhaustif parce que le type l'impose — c'est la règle du §18.5, tenue à
 * l'identique.
 *
 * `sans-effet` y figure, à la différence du §18.5 : elle a ici sa propre entrée parce que le
 * classement la porte dans le MÊME type que les autres (§20.5), et son texte lui est propre — il
 * n'affirme ni le refus ni la disparition, les deux étant indistinguables (mesures 3 et 5).
 */
const MESSAGES_REFUS: Readonly<Record<RefusSuppressionContact['nature'], CleTraduction>> = {
	'sans-effet': 'contact.delete.noeffect',
	interdit: 'contact.delete.refus.forbidden',
	indisponible: 'contact.delete.refus.unavailable',
	doublon: 'contact.delete.refus.unavailable',
	'organisation-inconnue': 'contact.delete.refus.unavailable',
	'saisie-invalide': 'contact.delete.refus.unavailable',
}

export type ProprietesCommandeSuppression = {
	readonly confirmationOuverte: boolean
	readonly onDemander: () => void
	readonly commande: React.Ref<HTMLButtonElement>
}

/**
 * La commande, SECONDE de la zone de commandes de la fiche, après « Modifier » (§5.40).
 *
 * **L'ORDRE DE LECTURE MET LE GESTE RÉPARABLE AVANT L'IRRÉVERSIBLE**, comme le §5.16 place
 * « Restaurer » avant « Supprimer définitivement ».
 *
 * **Elle n'est jamais démontée**, à la différence de la commande de modification (§16.5) : sa
 * confirmation vit SOUS elle et non à sa place, et la retirer ferait sauter la hauteur de la zone
 * au moment précis où l'on demande à l'utilisateur de lire. Elle est seulement DÉSACTIVÉE tant que
 * sa confirmation est ouverte — il n'y a rien à rouvrir. Ce n'est pas une garde de droit (§20.6),
 * c'est une commande sans objet, exactement comme celle du §5.27.
 */
export function CommandeSuppressionContact({
	confirmationOuverte,
	onDemander,
	commande,
}: ProprietesCommandeSuppression) {
	return (
		<Button
			ref={commande}
			variante="destructif"
			disabled={confirmationOuverte}
			onClick={onDemander}
			data-testid="ouvrir-suppression-contact"
		>
			<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
			{t('contact.delete.action')}
		</Button>
	)
}

export type ProprietesConfirmationSuppression = {
	readonly client: ClientCrm
	readonly idContact: string
	/** Le nom du contact, que la confirmation NOMME (§6, §20.6). */
	readonly nom: string
	/** Le nombre d'affaires rattachées, pris de la DONNÉE DÉJÀ LUE — jamais d'une requête (§20.6). */
	readonly nombreAffaires: number
	/**
	 * Le geste est retombé : `message` vaut `null` sur un succès — l'appelant QUITTE alors la fiche
	 * pour le carnet (§20.4) —, et porte le texte à afficher sur les deux autres issues, où la fiche
	 * est relue et où l'on RESTE.
	 */
	readonly onGeste: (message: string | null) => void
	readonly onAnnuler: () => void
}

/**
 * La confirmation, DANS LE FLUX du document et jamais en modale (§5.13, §5.40).
 *
 * Elle NOMME LE CONTACT (§6) — c'est le §5.27 retourné : là-bas le contact était le décor et
 * l'affaire variait ; ici c'est le contact lui-même que l'on retire.
 */
export function ConfirmationSuppressionContact({
	client,
	idContact,
	nom,
	nombreAffaires,
	onGeste,
	onAnnuler,
}: ProprietesConfirmationSuppression) {
	const [enVol, setEnVol] = useState(false)
	const premier = useRef<HTMLButtonElement>(null)

	// Le focus ENTRE dans le bouton de confirmation à l'ouverture (§5.13, cas b du §20.7). Il peut
	// entrer au montage : ce bouton n'est jamais `disabled` au premier rendu, la confirmation ne
	// lisant rien.
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const confirmer = useCallback(async () => {
		setEnVol(true)
		const resultat = await supprimerContact(client, idContact)
		setEnVol(false)
		// LE SUCCÈS NE REND AUCUN MESSAGE : l'appelant quitte la fiche (§20.4). Un message affiché
		// sur un écran que l'on abandonne au même rendu ne serait jamais lu.
		onGeste(resultat.statut === 'supprimee' ? null : t(MESSAGES_REFUS[resultat.refus.nature]))
	}, [client, idContact, onGeste])

	return (
		<div
			data-testid="confirmation-suppression-contact"
			className="self-start max-w-[72ch] flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{t('contact.delete.confirm.title', { nom })}</p>
			{/*
			  CONSÉQUENCE 1 — CE QUE LE GESTE EMPORTE (§20.6, mesure 7). À ZÉRO, LA PHRASE N'EST PAS
			  RENDUE : annoncer « 0 affaire » ferait lire une conséquence inexistante. Le singulier
			  et le pluriel sont DEUX CLÉS et non une concaténation (`CLAUDE.md` §23), comme le fait
			  déjà `Objectifs` pour son compte de blocs — le moteur de traduction est délibérément
			  sans règle de pluriel (webapp/src/i18n/index.ts).
			*/}
			{nombreAffaires === 0 ? null : (
				<p className="text-sm text-text-2" data-testid="consequence-affaires-suppression">
					{nombreAffaires === 1
						? t('contact.delete.confirm.deals.one')
						: t('contact.delete.confirm.deals.many', { compte: String(nombreAffaires) })}
				</p>
			)}
			{/*
			  CONSÉQUENCE 2 — CE QUE LE GESTE NE DÉTRUIT PAS (§20.6, mesure 9, décision 516). Rendue
			  TOUJOURS, y compris à zéro affaire : une valeur de formulaire peut désigner un contact
			  qui n'est rattaché à aucune affaire, la résolution du §9.3 ne l'exigeant nulle part.
			*/}
			<p className="text-sm text-text-2" data-testid="consequence-valeurs-suppression">
				{t('contact.delete.confirm.values')}
			</p>
			<div className="flex gap-2">
				<Button
					ref={premier}
					variante="destructif"
					disabled={enVol}
					aria-busy={enVol}
					onClick={() => void confirmer()}
					data-testid="confirmer-suppression-contact"
				>
					{enVol ? t('contact.delete.pending') : t('contact.delete.confirm.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler} data-testid="annuler-suppression-contact">
					{t('contact.delete.cancel')}
				</Button>
			</div>
		</div>
	)
}
