// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4f :
//       la fiche d'un contact, et l'HISTORIQUE TRANSVERSE que la Definition of Done nomme
// @spec docs/SPEC-contacts.md §15.2 (où la fiche s'ancre, et pourquoi hors de `ROUTES`),
//       §15.4 (trois absences rendent le même écran ; les droits fins traversent l'embarquement),
//       §15.5 (de quoi elle a l'air), §15.8 (limites nommées),
//       §15.9 (contrat de comportement, cas a à o)
// @spec docs/DESIGN_SYSTEM.md §5.24 (cette surface), §5.9 (tableau de données),
//       §5.6 (badges et pilules), §5.8 (états systématiques), §2 (données techniques),
//       §8 (accessibilité), §12.6 (débordement signalé)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// @spec docs/SPEC-contacts.md §16.2 (où le geste de MODIFICATION s'ancre), §16.5 (de quoi il a
//       l'air, et le retour du focus), §16.6 (l'écran ne calcule aucun droit),
//       §16.7 (ce que la fiche fait de la ligne rendue), §16.8 (limites nommées),
//       §16.9 (contrat de comportement, cas a à r)
// @spec docs/DESIGN_SYSTEM.md §5.25 (le formulaire de modification dans le flux de la fiche)
//
// @spec docs/SPEC-contacts.md §17.2 (où le geste de RATTACHEMENT s'ancre : DANS la zone des
//       affaires, et non à côté de « Modifier »), §17.3 (la liste n'est lue que si le geste est
//       ouvert), §17.6 (l'exclusion des affaires déjà rattachées, et la relecture après succès),
//       §17.7 (contrat de comportement, cas a à n), §17.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.26 (le geste de rattachement de la fiche de contact)
//
// @spec docs/SPEC-contacts.md §18.4 (où le geste de DÉTACHEMENT s'ancre : une quatrième colonne,
//       et la confirmation sur une ligne à elle), §18.6 (de quoi il a l'air, et la relecture dans
//       les TROIS issues), §18.7 (contrat de comportement, cas a à m), §18.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.27 (le geste de détachement), §5.24 révisé par livraison (le
//       tableau des affaires se lit désormais à QUATRE colonnes)
//
// @spec docs/SPEC-contacts.md §19.4 (où le geste de MODIFICATION DU RÔLE s'ancre : une seconde
//       commande dans la même colonne, et UN SEUL BLOC OUVERT dans tout le tableau),
//       §19.6 (de quoi il a l'air, et la fiche qui prend la ligne rendue SANS relire),
//       §19.7 (contrat de comportement, cas a à p), §19.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.28 (le geste de modification du rôle)
//
// @spec docs/SPEC-contacts.md §20.4 (où le geste de SUPPRESSION s'ancre : la zone de commandes, à
//       côté de « Modifier », et le retour au carnet sur le SEUL succès), §20.6 (les deux
//       conséquences énoncées, et la relecture sur les deux autres issues),
//       §20.7 (contrat de comportement, cas a à n), §20.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.40 (le geste de suppression), §5.24 révisé par livraison (la
//       fiche porte désormais DEUX commandes)
//
// L'ÉCRAN LIT, IL MODIFIE DEPUIS 4g, IL RATTACHE DEPUIS 4h, IL DÉTACHE DEPUIS 4i, IL CORRIGE LE
// RÔLE DEPUIS 4j ET IL SUPPRIME DEPUIS LA TRANCHE 6. L'écart que ce fichier nommait — « la
// SUPPRESSION d'un contact, dont le motif n'est pas le temps : elle dépend de l'arbitrage NON
// TRANCHÉ du §6 point 4 » — N'EXISTE PLUS. L'arbitrage est rendu (décision 516) : les valeurs
// `jsonb` qui désignent un contact supprimé sont CONSERVÉES, et le cas j du §13.5, livré par 4d,
// les rend déjà en « référence inconnue » plutôt qu'en champ vidé. Rien n'a eu à être écrit pour la
// lecture ; ce que la tranche 6 ajoute est le geste, et la PREUVE de cette chaîne sur une
// suppression réelle.
//
// L'ASYMÉTRIE QUE LE §17.8 ASSUMAIT EST COMBLÉE : le détachement, qui n'existait que depuis la
// fiche de l'affaire (§12.6), vit désormais aussi ici. Ce que 4h laissait ouvert — la place de la
// confirmation dans une LIGNE DE TABLEAU — est tranché au §18.4 : une ligne à elle, en `colSpan`,
// seul emplacement à la fois dans le flux, adjacent à sa ligne, et assez large pour nommer l'objet.
//
// TROIS ABSENCES, UN SEUL ÉCRAN, DÉLIBÉRÉMENT (§15.4). Un contact inexistant, un contact refusé à
// l'appelant et un identifiant qui n'est pas un uuid rendent tous les trois « contact
// introuvable ». MESURÉ : les deux premiers rendent `200` et `[]`, indistinguables par
// construction. La troisième les rejoint parce qu'un `400` mènerait à un état d'erreur dont la
// reprise ne pourrait jamais aboutir.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT SUR LES AFFAIRES, et la mesure dit pourquoi il n'a pas à le
// faire : les droits fins de `cards` TRAVERSENT l'embarquement. La lectrice, à qui le track
// « Conseil IA » est fermé, reçoit zéro rattachement sur la fiche de Léo, et l'affaire de Sophie
// sur la sienne. La zone vide d'un lecteur restreint est l'état vide ordinaire du §5.8, jamais un
// refus mis en scène.

import { Archive } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	lireAffairesRattachables,
	lireFicheContact,
	lireOrganisationsDuWorkspace,
	type AffaireRattachable,
	type ContactDuCarnet,
	type FicheContactLue,
	type OrganisationChoisissable,
} from '../lib/contacts'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { CHEMIN_CONTACTS, cheminOrganisation } from './chemins'
import {
	FormulaireModificationContact,
	saisieDepuisContact,
} from './FormulaireModificationContact'
import {
	CommandeRattachementAffaire,
	FormulaireRattachementAffaire,
} from './FormulaireRattachementAffaire'
import {
	CommandeDetachementAffaire,
	ConfirmationDetachementAffaire,
} from './DetachementAffaireContact'
import {
	CommandeRoleRattachement,
	FormulaireRoleRattachement,
} from './ModificationRoleRattachement'
import {
	CommandeSuppressionContact,
	ConfirmationSuppressionContact,
} from './SuppressionContact'

/** Cellule ordinaire du tableau des affaires — mêmes règles qu'au carnet (§5.9). */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

/** Classes du lien de retour, identiques à celles de la fiche d'organisation (§5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre, remplacé par le nom du contact dès qu'il est connu.
 *
 * Déclarée comme constante et non écrite dans le JSX, pour la raison exacte de
 * `CLE_TITRE_ORGANISATION` : le contrôle de clés mortes de `webapp/src/i18n/i18n.test.ts` cherche
 * les clés citées entre apostrophes, et un attribut JSX entre guillemets lui échapperait.
 */
const CLE_TITRE_CONTACT: CleTraduction = 'contact.route.title'

export type ProprietesFicheContact = {
	readonly client?: ClientCrm | null
}

export type ProprietesContenuFicheContact = {
	readonly client?: ClientCrm | null
	/** Identifiant tel qu'il vient de l'adresse — donc de forme quelconque (§15.4). */
	readonly idContact: string | undefined
}

/**
 * Une valeur de la liste de définitions : un couple libellé / valeur, la valeur restant VIDE
 * lorsque la donnée n'existe pas — ni tiret, ni « non renseigné » (§5.9, §5.24).
 *
 * `technique` distingue une donnée technique (§2), rendue en monospace, d'un texte ordinaire :
 * `email` et `phone` en sont, `role_title` n'en est PAS un — c'est un intitulé de fonction.
 */
function ValeurFiche({
	libelle,
	valeur,
	technique = false,
}: {
	libelle: string
	valeur: string | null
	technique?: boolean
}) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="text-sm text-text-2">{libelle}</dt>
			<dd className="min-h-[var(--size-target)] flex items-center">
				{valeur === null ? (
					''
				) : technique ? (
					<code className="text-text-2 break-all">{valeur}</code>
				) : (
					<span className="break-words">{valeur}</span>
				)}
			</dd>
		</div>
	)
}

/**
 * LA ROUTE : elle ne fait que deux choses — lire l'identifiant dans l'adresse, et poser la coquille
 * dont le titre est le NOM du contact, donc une donnée (§15.2).
 *
 * Le CONTENU vit dans un composant distinct et exporté, pour le motif exact de `FicheOrganisation` :
 * `AppShell` lit `clientCrm`, le client de MODULE, et ne s'injecte pas. Une preuve unitaire montée
 * sur la route entière n'éprouverait donc que la zone principale de la coquille, jamais la fiche.
 */
export function FicheContact({ client = clientCrm }: ProprietesFicheContact = {}) {
	const { idContact } = useParams()
	const [nom, setNom] = useState<string | null>(null)
	return (
		<AppShell cleTitreRoute={CLE_TITRE_CONTACT} {...(nom === null ? {} : { titreRoute: nom })}>
			<ContenuFicheContact client={client} idContact={idContact} onNomConnu={setNom} />
		</AppShell>
	)
}

export function ContenuFicheContact({
	client = clientCrm,
	idContact,
	onNomConnu,
}: ProprietesContenuFicheContact & { readonly onNomConnu?: (nom: string | null) => void }) {
	const [etat, setEtat] = useState<EtatAsync<FicheContactLue | null>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		if (client === null) return
		let vivant = true
		setEtat(enChargement())
		void (async () => {
			const lu = await lireFicheContact(client, idContact)
			// Une réponse arrivée après le démontage, ou périmée par une nouvelle tentative, ne doit
			// pas écraser un état plus récent — même garde que `Carnet` et `FicheOrganisation`.
			if (!vivant) return
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret(lu.donnees))
			// Le titre de la route est une DONNÉE : la coquille l'apprend du contenu, seul à lire.
			onNomConnu?.(lu.donnees === null ? null : lu.donnees.full_name)
		})()
		return () => {
			vivant = false
		}
		// `onNomConnu` est délibérément hors des dépendances : elle ne décrit PAS quoi lire, et l'y
		// mettre relancerait la lecture à chaque rendu du parent.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idContact, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const contact = etat.statut === 'pret' ? etat.donnees : null

	// --- SOUS-TRANCHE 4g : LE GESTE DE MODIFICATION (§16.2) -------------------------------------
	// Le formulaire est REPLIÉ PAR DÉFAUT : la fiche est d'abord une surface de lecture, et ce
	// qu'elle affiche est précisément ce que l'on vient corriger.
	const [ouvert, setOuvert] = useState(false)
	const [organisations, setOrganisations] =
		useState<EtatAsync<readonly OrganisationChoisissable[]>>(enChargement)
	const [tentativeOrganisations, setTentativeOrganisations] = useState(0)
	const commandeOuverture = useRef<HTMLButtonElement | null>(null)

	// LA LISTE DES ORGANISATIONS N'EST LUE QUE SI LE FORMULAIRE EST OUVERT — même motif qu'au
	// carnet (§13.4) : charger une liste pour un geste que la plupart des visites ne font pas
	// serait une requête gratuite.
	useEffect(() => {
		if (client === null || !ouvert) return
		let vivant = true
		setOrganisations(enChargement())
		void lireOrganisationsDuWorkspace(client).then((lues) => {
			if (vivant) setOrganisations(lues)
		})
		return () => {
			vivant = false
		}
	}, [client, ouvert, tentativeOrganisations])

	/**
	 * LE FOCUS EST RENDU à la commande d'ouverture APRÈS LE RENDU (§16.5, §16.9 cas c).
	 *
	 * La commande et le formulaire s'EXCLUENT : la commande est démontée tant que le formulaire est
	 * ouvert, et sa référence vaut `null` au moment où le gestionnaire de fermeture s'exécute.
	 * Appeler `focus()` depuis ce gestionnaire laisserait le focus sur le document — le défaut que
	 * la décision 453 a trouvé au carnet, et que `BlocContactsCard` résout déjà. Le drapeau est posé
	 * à la fermeture, l'effet rend le focus au tour suivant, quand la commande est remontée. Aucune
	 * temporisation (`CLAUDE.md` §18) : c'est le cycle de rendu de React qui ordonne les deux gestes.
	 */
	const [focusARendre, setFocusARendre] = useState(false)

	useEffect(() => {
		if (ouvert || !focusARendre) return
		commandeOuverture.current?.focus()
		setFocusARendre(false)
	}, [ouvert, focusARendre])

	const fermer = useCallback(() => {
		setOuvert(false)
		setFocusARendre(true)
	}, [])

	// --- TRANCHE 6 : LE GESTE DE SUPPRESSION (§20.4) --------------------------------------------
	// Il vit dans la zone de commandes, à côté de « Modifier » et APRÈS lui : l'ordre de lecture met
	// le geste réparable avant l'irréversible (§5.40). Il n'est PAS posé au carnet — le motif du
	// §16.2 vaut mot pour mot, et davantage : le carnet est la surface où l'on CHERCHE un contact,
	// et poser un geste irréversible au bout de chaque ligne d'une liste que l'on parcourt est le
	// patron qui produit les suppressions par mégarde.
	const [suppressionOuverte, setSuppressionOuverte] = useState(false)
	const [messageSuppression, setMessageSuppression] = useState<string | null>(null)
	const commandeSuppression = useRef<HTMLButtonElement | null>(null)
	const naviguer = useNavigate()

	/**
	 * LE FOCUS REVIENT À LA COMMANDE À LA FERMETURE, ET CE RETOUR EST DIFFÉRÉ (cas c du §20.7).
	 *
	 * **LE MOTIF EST CELUI DU §5.27, NON CELUI DE 4g**, et il est écrit pour qu'on ne recopie pas un
	 * remède sans sa cause : la commande de modification est DÉMONTÉE pendant que son formulaire est
	 * ouvert, sa référence vaut `null` ; celle-ci reste MONTÉE mais devient `disabled` tant que la
	 * confirmation est là, et **un élément désactivé ne reçoit pas le focus**. Le drapeau est posé à
	 * la fermeture, l'effet rend le focus au tour suivant, quand le bouton est de nouveau actif.
	 * **Aucune temporisation** (`CLAUDE.md` §18) : c'est le cycle de rendu de React qui ordonne les
	 * deux gestes.
	 */
	const [focusSuppressionARendre, setFocusSuppressionARendre] = useState(false)

	useEffect(() => {
		if (suppressionOuverte || !focusSuppressionARendre) return
		commandeSuppression.current?.focus()
		setFocusSuppressionARendre(false)
	}, [suppressionOuverte, focusSuppressionARendre])

	/**
	 * UNE SEULE QUESTION OUVERTE À TOUT INSTANT SUR CETTE FICHE (cas l du §20.7, §5.40).
	 *
	 * Ouvrir la confirmation REFERME le formulaire de modification, et réciproquement. C'est la
	 * règle du §19.4 — « un seul bloc ouvert » — étendue à deux gestes qui ne partagent pas leur
	 * forme : deux questions simultanées sur le même objet ne diraient pas à laquelle on répond, et
	 * l'une des deux est destructrice.
	 *
	 * La fermeture du formulaire de modification passe ici par `setOuvert(false)` SANS
	 * `setFocusARendre` : le focus part dans le bouton de confirmation qui vient d'apparaître
	 * (§20.7 cas b), et le lui reprendre pour le rendre à « Modifier » déplacerait l'utilisateur
	 * hors du geste qu'il vient d'ouvrir.
	 */
	const ouvrirSuppression = useCallback(() => {
		setOuvert(false)
		setSuppressionOuverte(true)
	}, [])

	const annulerSuppression = useCallback(() => {
		setSuppressionOuverte(false)
		setFocusSuppressionARendre(true)
	}, [])

	/**
	 * TROIS ISSUES, ET DEUX SEULEMENT RESTENT SUR L'ÉCRAN (§20.4, §20.6).
	 *
	 * **Le succès QUITTE la fiche pour le carnet.** La fiche d'un contact supprimé n'a plus de
	 * sujet : relire rendrait l'écran « contact introuvable » du §15.9 cas h — le même écran qu'un
	 * identifiant inconnu ou qu'un refus de lecture —, et un geste RÉUSSI se solderait par un écran
	 * d'échec dont l'utilisateur ne saurait pas conclure que sa suppression a abouti. Le carnet, lui,
	 * PROUVE le succès en ne portant plus la ligne.
	 *
	 * **Les deux autres issues RESTENT, et la fiche est RELUE** — après un « sans effet » parce que
	 * l'écran ne sait pas laquelle des deux causes s'applique et ne prétend pas le savoir, après un
	 * refus parce que l'état affiché peut être périmé. Aucun retrait optimiste : sur « sans effet »,
	 * il effacerait un contact que la base a GARDÉ (mesure 3).
	 */
	const surSuppression = useCallback(
		(message: string | null) => {
			if (message === null) {
				naviguer(CHEMIN_CONTACTS)
				return
			}
			setMessageSuppression(message)
			setSuppressionOuverte(false)
			setFocusSuppressionARendre(true)
			setTentative((precedente) => precedente + 1)
		},
		[naviguer],
	)

	/**
	 * LA FICHE PREND LA LIGNE RENDUE, ET NE RELIT RIEN (§16.7).
	 *
	 * PostgREST rend la ligne modifiée avec son organisation embarquée : relire serait une seconde
	 * requête pour une donnée déjà en main. La ZONE 2 — les affaires — n'est pas touchée, et ne doit
	 * pas l'être : aucune colonne de ce formulaire n'entre dans un rattachement, et la reconstruire
	 * relancerait la lecture à quatre niveaux du §15.3 pour un résultat identique.
	 *
	 * LE TITRE DE LA ROUTE SUIT LE NOUVEAU NOM (§16.9 cas f) : il est une donnée (§15.2), et un
	 * titre resté sur l'ancien nom après une correction de coquille serait le défaut même que l'on
	 * vient de corriger.
	 */
	const surModifie = useCallback(
		(modifie: ContactDuCarnet) => {
			setEtat((precedent) => {
				if (precedent.statut !== 'pret' || precedent.donnees === null) return precedent
				return pret({
					...precedent.donnees,
					full_name: modifie.full_name,
					email: modifie.email,
					phone: modifie.phone,
					role_title: modifie.role_title,
					organization_id: modifie.organisation?.id ?? null,
					// `ContactDuCarnet` ne rapporte pas `domain` : la fiche n'en affiche aucun, mais
					// son type le porte. Il est repris de l'état courant quand l'organisation n'a pas
					// changé, et laissé `null` sinon — l'inventer serait une supposition non mesurée.
					organisation:
						modifie.organisation === null
							? null
							: {
									...modifie.organisation,
									domain:
										precedent.donnees.organisation?.id === modifie.organisation.id
											? precedent.donnees.organisation.domain
											: null,
								},
				})
			})
			onNomConnu?.(modifie.full_name)
			fermer()
		},
		[fermer, onNomConnu],
	)

	// --- SOUS-TRANCHE 4h : LE GESTE DE RATTACHEMENT (§17.2) -------------------------------------
	// Il vit DANS la zone des affaires, et non ici à côté de la modification : un geste se pose près
	// de ce qu'il change. « Modifier » touche les caractéristiques et le titre de la route, celui-ci
	// ne touche que la zone 2 (§17.2, §5.26).
	const [rattachementOuvert, setRattachementOuvert] = useState(false)
	const [affaires, setAffaires] = useState<EtatAsync<readonly AffaireRattachable[]>>(enChargement)
	const [tentativeAffaires, setTentativeAffaires] = useState(0)
	const commandeRattachement = useRef<HTMLButtonElement | null>(null)

	// LA LISTE DES AFFAIRES N'EST LUE QUE SI LE GESTE EST OUVERT (§17.3, cas a du §17.7) : charger
	// quarante affaires pour un geste que la plupart des visites ne font pas serait une requête
	// gratuite. C'est la règle du §13.4, déjà tenue par le sélecteur d'organisations ci-dessus.
	useEffect(() => {
		if (client === null || !rattachementOuvert) return
		let vivant = true
		setAffaires(enChargement())
		void lireAffairesRattachables(client).then((lues) => {
			if (vivant) setAffaires(lues)
		})
		return () => {
			vivant = false
		}
	}, [client, rattachementOuvert, tentativeAffaires])

	// LE FOCUS EST RENDU à la commande APRÈS LE RENDU, pour le motif exact du geste de modification
	// ci-dessus (§17.6, cas c du §17.7) : la commande est démontée tant que le formulaire est
	// ouvert. Aucune temporisation.
	const [focusRattachementARendre, setFocusRattachementARendre] = useState(false)

	useEffect(() => {
		if (rattachementOuvert || !focusRattachementARendre) return
		commandeRattachement.current?.focus()
		setFocusRattachementARendre(false)
	}, [rattachementOuvert, focusRattachementARendre])

	const fermerRattachement = useCallback(() => {
		setRattachementOuvert(false)
		setFocusRattachementARendre(true)
	}, [])

	/**
	 * LA FICHE EST RELUE APRÈS UN RATTACHEMENT, JAMAIS COMPLÉTÉE LOCALEMENT (§17.6, §5.21).
	 *
	 * Une insertion optimiste contredirait l'ordre du serveur le temps d'un rendu, et masquerait un
	 * rattachement posé entre-temps par un collègue. La relecture est celle du §15.3 — la lecture
	 * entière de la fiche —, ce qui rapporte du même coup l'état d'ARCHIVAGE et l'ADRESSE de
	 * l'affaire ajoutée, que le sélecteur ne connaissait pas : il ne lit ni track ni channel (§17.3).
	 */
	const surRattachee = useCallback(() => {
		fermerRattachement()
		setTentative((precedente) => precedente + 1)
	}, [fermerRattachement])

	// --- SOUS-TRANCHES 4i ET 4j : LES DEUX GESTES DE LIGNE (§18.4, §19.4) -----------------------
	// L'état vit ICI et non dans la ligne, pour deux raisons que la spécification mesure :
	//
	// - UN SEUL BLOC OUVERT À TOUT INSTANT DANS LE TABLEAU, TOUTES LIGNES ET TOUS GESTES CONFONDUS
	//   (cas d du §18.7, cas e et f du §19.7). Le §18.4 posait « une seule confirmation à la fois » ;
	//   le §19.4 étend la règle aux DEUX gestes, parce qu'ils vivent désormais sur la même ligne.
	//   Deux blocs ouverts feraient deux questions dans le flux dont rien ne dirait laquelle on
	//   répond, et sur un tableau étroit ils se pousseraient l'un l'autre hors de vue. Le couple
	//   (geste, affaire) est la clé d'exclusivité, et en ouvrir un ferme l'autre sans code de plus ;
	// - LE MESSAGE DU DÉTACHEMENT SURVIT À LA RELECTURE (§18.6) : la relecture démonte et remonte le
	//   tableau, et un message porté par la ligne partirait avec elle — c'est-à-dire exactement dans
	//   le cas où il compte le plus, l'issue « sans effet » où la ligne RESTE. Le message du geste de
	//   RÔLE, lui, vit dans son formulaire (§19.6) : ce geste ne relit rien, et sa saisie doit être
	//   conservée près du champ qui l'a causée.
	const [blocOuvert, setBlocOuvert] = useState<BlocLigneOuvert>(null)
	const [messageDetachement, setMessageDetachement] = useState<string | null>(null)

	/**
	 * LA FICHE EST RELUE DANS LES TROIS ISSUES, JAMAIS AMPUTÉE LOCALEMENT (§18.6, §5.21).
	 *
	 * Après un succès parce que la ligne doit partir ; après un « sans effet » parce que l'écran ne
	 * sait pas laquelle des deux causes s'applique et ne prétend pas le savoir ; après un refus
	 * parce que l'état affiché peut être périmé. Un retrait optimiste contredirait l'ordre du
	 * serveur le temps d'un rendu, et sur l'issue « sans effet » il EFFACERAIT UNE LIGNE QUE LA BASE
	 * A GARDÉE — précisément le mensonge que le §18.3 interdit.
	 */
	const surDetachement = useCallback((message: string | null) => {
		setMessageDetachement(message)
		setBlocOuvert(null)
		setTentative((precedente) => precedente + 1)
	}, [])

	/**
	 * LA FICHE PREND LE RÔLE RENDU, ET NE RELIT RIEN (§19.6, règle du §16.7).
	 *
	 * **C'EST L'ÉCART MESURÉ AVEC 4h ET 4i, et il est écrit pour qu'on ne recopie pas une relecture
	 * sans son motif.** Là-bas la relecture existait parce qu'un rattachement AJOUTÉ apporte un état
	 * d'archivage et une adresse que le formulaire ne connaît pas, et parce qu'une ligne RETIRÉE
	 * change l'ensemble des lignes. Ici seule une valeur scalaire d'une ligne DÉJÀ AFFICHÉE est
	 * réécrite, et le `PATCH` la rend : relire serait une seconde requête pour une donnée en main.
	 *
	 * Le rôle posé est celui que la BASE a enregistré, jamais celui que l'appelant a tapé — la
	 * normalisation « blanc vaut `null` » vit dans la fonction, et la ligne rendue en porte le
	 * résultat (§19.2, mesures 8 à 10).
	 */
	const surRoleModifie = useCallback((idCard: string, role: string | null) => {
		setBlocOuvert(null)
		setEtat((precedent) => {
			if (precedent.statut !== 'pret' || precedent.donnees === null) return precedent
			return pret({
				...precedent.donnees,
				affaires: precedent.donnees.affaires.map((affaire) =>
					affaire.idCard === idCard ? { ...affaire, role } : affaire,
				),
			})
		})
	}, [])

	/**
	 * LE SÉLECTEUR N'OFFRE QUE LES AFFAIRES NON ENCORE RATTACHÉES à ce contact (§17.6, cas d).
	 *
	 * Ce n'est pas une garde de droit — c'est le refus d'une commande vouée au `409` (§17.4,
	 * mesure 8), la règle du §5.21. Le refus `deja-rattache` reste néanmoins traduit : deux
	 * utilisateurs peuvent agir à la même seconde, et l'écran ne prétend pas connaître l'état du
	 * serveur.
	 *
	 * L'exclusion se calcule sur les affaires que la FICHE affiche, qui sont déjà privées de celles
	 * de la corbeille par le serveur (§15.3) — et le sélecteur ne les offre pas non plus (§17.3).
	 * Les deux ensembles s'accordent donc sans qu'aucun des deux n'ait à connaître l'autre.
	 */
	const affairesOffertes: EtatAsync<readonly AffaireRattachable[]> =
		affaires.statut === 'pret' && contact !== null
			? pret(
					affaires.donnees.filter(
						(affaire) => !contact.affaires.some((liee) => liee.idCard === affaire.id),
					),
				)
			: affaires

	return (
		<ContenuFiche
			client={client}
			etat={etat}
			contact={contact}
			onReprise={reprendre}
			gestesLigne={{
				ouvert: blocOuvert,
				messageDetachement,
				onDemander: setBlocOuvert,
				onDetachement: surDetachement,
				onRoleModifie: surRoleModifie,
			}}
			gesteRattachement={
				// LE GESTE N'EXISTE QUE S'IL Y A UN CONTACT À RATTACHER (cas n du §17.7) : ni sur
				// l'introuvable, ni sur l'erreur, ni sans client. `ContenuFiche` rend ces trois états
				// avant d'atteindre la zone des affaires, mais le construire ici sans contact serait
				// impossible — le rattachement a besoin de son identifiant et de son workspace.
				client === null || contact === null ? null : rattachementOuvert ? (
					<FormulaireRattachementAffaire
						client={client}
						idWorkspace={contact.workspace_id}
						idContact={contact.id}
						affaires={affairesOffertes}
						onRelireAffaires={() => setTentativeAffaires((precedente) => precedente + 1)}
						onRattachee={surRattachee}
						onFermer={fermerRattachement}
					/>
				) : (
					// AUCUNE COMMANDE ÉTEINTE D'AVANCE SELON LE RÔLE (§17.6) : la lectrice voit le
					// geste, envoie, et reçoit un refus EXPLICITE — un vrai `403`, et non le silence
					// de la modification (§17.4, mesure 9).
					<CommandeRattachementAffaire
						commande={commandeRattachement}
						onOuvrir={() => setRattachementOuvert(true)}
					/>
				)
			}
			geste={
				// LE GESTE N'EXISTE QUE S'IL Y A QUELQUE CHOSE À MODIFIER (§16.9 cas r) : ni sur
				// l'introuvable, ni sur l'erreur, ni sans client. `ContenuFiche` rend ces trois états
				// avant d'atteindre le geste, mais le construire ici sans contact serait impossible —
				// le formulaire a besoin de ses valeurs courantes.
				client === null || contact === null ? null : ouvert ? (
					<FormulaireModificationContact
						client={client}
						idContact={contact.id}
						valeurs={saisieDepuisContact(contact)}
						organisations={organisations}
						onRelireOrganisations={() =>
							setTentativeOrganisations((precedente) => precedente + 1)
						}
						onModifie={surModifie}
						onFermer={fermer}
					/>
				) : (
					// AUCUNE COMMANDE ÉTEINTE D'AVANCE SELON LE RÔLE (§16.6) : la lectrice voit le
					// geste, envoie, et reçoit `sans-effet` traduit. Griser ferait passer une décision
					// de la base pour une décision d'écran (`CLAUDE.md` §10).
					<button
						type="button"
						ref={commandeOuverture}
						data-testid="ouvrir-modification-contact"
						className="self-start min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface"
						// RÉCIPROQUE DU CAS l DU §20.7 : ouvrir la modification referme la
						// confirmation de suppression. Une question destructrice laissée ouverte
						// derrière un formulaire que l'on vient d'ouvrir attendrait une réponse que
						// plus rien ne demande.
						onClick={() => {
							setSuppressionOuverte(false)
							setOuvert(true)
						}}
					>
						{t('contact.modification.open')}
					</button>
				)
			}
			gesteSuppression={
				// LE GESTE N'EXISTE QUE S'IL Y A QUELQUE CHOSE À SUPPRIMER (cas k du §20.7) : ni sur
				// l'introuvable, ni sur l'erreur, ni sans client. `ContenuFiche` rend ces trois états
				// avant d'atteindre la zone de commandes, mais le construire ici sans contact serait
				// impossible — la confirmation a besoin de son nom et de son compte d'affaires.
				//
				// LA COMMANDE N'EST JAMAIS DÉMONTÉE (§5.40) : sa confirmation vit SOUS elle et non à
				// sa place, et la retirer ferait sauter la hauteur de la zone au moment précis où
				// l'on demande à l'utilisateur de lire. Elle est seulement DÉSACTIVÉE — ce n'est pas
				// une garde de droit (§20.6), c'est une commande sans objet. AUCUNE COMMANDE N'EST
				// ÉTEINTE D'AVANCE SELON LE RÔLE : la lectrice la voit, confirme, et reçoit « sans
				// effet » (mesure 3).
				client === null || contact === null ? null : (
					<CommandeSuppressionContact
						commande={commandeSuppression}
						confirmationOuverte={suppressionOuverte}
						onDemander={ouvrirSuppression}
					/>
				)
			}
			confirmationSuppression={
				client === null || contact === null || !suppressionOuverte ? null : (
					<ConfirmationSuppressionContact
						client={client}
						idContact={contact.id}
						nom={contact.full_name}
						// LE COMPTE VIENT DE LA DONNÉE DÉJÀ LUE (§20.6), jamais d'une requête de
						// plus : la zone 2 le porte déjà (§15.3).
						nombreAffaires={contact.affaires.length}
						onGeste={surSuppression}
						onAnnuler={annulerSuppression}
					/>
				)
			}
			messageSuppression={messageSuppression}
		/>
	)
}

type ProprietesContenu = {
	readonly client: ClientCrm | null
	readonly etat: EtatAsync<FicheContactLue | null>
	readonly contact: FicheContactLue | null
	readonly onReprise: () => void
	/** Le geste de modification, ou `null` quand il n'y a rien à modifier (§16.9 cas r). */
	readonly geste?: React.ReactNode
	/** Le geste de rattachement, ou `null` quand il n'y a rien à rattacher (§17.7 cas n). */
	readonly gesteRattachement?: React.ReactNode
	/** La COMMANDE de suppression, ou `null` quand il n'y a rien à supprimer (§20.7 cas k). */
	readonly gesteSuppression?: React.ReactNode
	/**
	 * La CONFIRMATION de suppression, rendue SOUS les deux commandes (§5.40) et non à côté d'elles.
	 *
	 * Elle est un nœud DISTINCT de la commande, et non son enfant : la zone de commandes est une
	 * ligne (`flex-wrap`), et une confirmation qui y vivrait se placerait À CÔTÉ du bouton plutôt
	 * qu'en dessous — la question destructrice se lirait alors dans la marge du geste qui l'ouvre.
	 */
	readonly confirmationSuppression?: React.ReactNode
	/**
	 * Le message des deux issues qui RESTENT sur l'écran (§20.6), `role="alert"`.
	 *
	 * Il vit ICI et non dans la confirmation, pour le motif exact du message de détachement (§18.6) :
	 * la confirmation est DÉMONTÉE après le geste, et un message qu'elle porterait partirait avec
	 * elle — c'est-à-dire précisément dans le cas où il compte, l'issue « sans effet » où le contact
	 * RESTE. Il survit aussi à la relecture, qui remonte toute la fiche.
	 */
	readonly messageSuppression?: string | null
	/** L'état des DEUX gestes de ligne, tenu par la fiche pour l'exclusivité (§18.4, §19.4). */
	readonly gestesLigne?: EtatGestesLigne
}

/**
 * Le bloc ouvert dans le tableau, ou `null` — **il n'y en a JAMAIS plus d'un** (§19.4).
 *
 * Le couple (geste, affaire) porte l'exclusivité à lui seul : ouvrir un bloc écrase le précédent,
 * quelle que soit sa ligne et quel que soit son geste. Deux drapeaux séparés auraient laissé
 * coexister une confirmation de détachement et un formulaire de rôle.
 */
type BlocLigneOuvert = { readonly geste: 'detachement' | 'role'; readonly idCard: string } | null

/** Ce que la fiche transmet au tableau pour que chaque ligne porte ses gestes (§18.4, §19.4). */
type EtatGestesLigne = {
	readonly ouvert: BlocLigneOuvert
	/** Le message du DÉTACHEMENT, sous le tableau, qui SURVIT à la relecture (§18.6). */
	readonly messageDetachement: string | null
	readonly onDemander: (bloc: BlocLigneOuvert) => void
	readonly onDetachement: (message: string | null) => void
	readonly onRoleModifie: (idCard: string, role: string | null) => void
}

function ContenuFiche({
	client,
	etat,
	contact,
	onReprise,
	geste = null,
	gesteRattachement = null,
	gesteSuppression = null,
	confirmationSuppression = null,
	messageSuppression = null,
	gestesLigne,
}: ProprietesContenu) {
	if (client === null) {
		return (
			<EtatVide titre={t('contact.noWorkspace.title')} corps={t('contact.noWorkspace.body')} />
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('contact.error.title')}
				corps={t('contact.error.body')}
				libelleReprise={t('contact.error.retry')}
				onReprise={onReprise}
			/>
		)
	}

	// Cas h et i du §15.9 : inexistant, refusé, ou identifiant mal formé. Un seul écran, qui porte
	// un retour vers le carnet — la surface d'où l'on vient.
	if (contact === null) {
		return (
			<EtatVide
				titre={t('contact.notFound.title')}
				corps={t('contact.notFound.body')}
				action={
					<Link to={CHEMIN_CONTACTS} className={CLASSES_RETOUR}>
						{t('contact.notFound.action')}
					</Link>
				}
			/>
		)
	}

	return (
		<section aria-label={t('contact.aria')} className="flex flex-col gap-6">
			{/*
			  LE GESTE DE MODIFICATION — §16.2. Il vit AVANT les deux zones, dans le FLUX du
			  document : une modale recouvrirait précisément ce que l'on vient corriger. Le
			  formulaire ouvert REMPLACE la commande — les deux s'excluent (§16.5).

			  LA ZONE DE COMMANDES PORTE DEUX GESTES DEPUIS LA TRANCHE 6 (§5.24 révisé par
			  livraison, §5.40) : « Modifier » puis « Supprimer ». Ce sont deux gestes sur le MÊME
			  objet, non deux états d'un même geste, et l'ordre de lecture met le réparable avant
			  l'irréversible. Une SEULE question reste ouverte à tout instant (cas l du §20.7) :
			  ouvrir l'une referme l'autre.
			*/}
			<div className="flex flex-col items-start gap-3">
				{/*
				  LES DEUX COMMANDES SUR UNE MÊME LIGNE, la destructive en second. Quand le
				  formulaire de modification est ouvert il REMPLACE sa commande (§16.5) et occupe
				  cette ligne ; « Supprimer » reste à côté de lui, ce qui est exact — le geste reste
				  offert, et la règle du cas l a déjà fermé toute confirmation.
				*/}
				<div className="flex flex-wrap items-start gap-2">
					{geste}
					{gesteSuppression}
				</div>
				{/*
				  LA CONFIRMATION VIT SOUS LES DEUX COMMANDES, DANS LE FLUX (§5.40, §5.13) — jamais
				  en modale, et jamais dans une ligne de tableau : la règle du `colSpan` du §5.27
				  vaut pour une confirmation qui porte sur UNE LIGNE, et ce geste n'en vise aucune.
				*/}
				{confirmationSuppression}
				{/*
				  LE MESSAGE DES DEUX ISSUES QUI RESTENT (§20.6), `role="alert"`, jamais en tête
				  d'écran (§5.13, §5.16) : il se lit là où le geste a été demandé. Il SURVIT à la
				  relecture, qui remonte toute la fiche — c'est pourquoi il est porté par la fiche et
				  non par la confirmation, démontée après le geste (§18.6, même règle).
				*/}
				{messageSuppression === null ? null : (
					<p
						role="alert"
						data-testid="message-suppression-contact"
						className="text-sm text-danger max-w-[72ch]"
					>
						{messageSuppression}
					</p>
				)}
			</div>
			{/*
			  ZONE 1 — CE QUI CARACTÉRISE LE CONTACT. Une liste de DÉFINITIONS et non un tableau :
			  ce sont des couples libellé/valeur qui ne se comparent pas entre eux (§15.5, §5.24).
			  Le nom n'y figure pas — il est le titre de la route.
			*/}
			<dl
				data-testid="caracteristiques-contact"
				aria-label={t('contact.details.aria')}
				className="grid gap-4 md:grid-cols-2 max-w-[60ch]"
			>
				{/* `role_title` est un intitulé de fonction, PAS une donnée technique (§15.5). */}
				<ValeurFiche libelle={t('contact.field.role')} valeur={contact.role_title} />
				<div className="flex flex-col gap-1">
					<dt className="text-sm text-text-2">{t('contact.field.organization')}</dt>
					<dd className="min-h-[var(--size-target)] flex items-center">
						{/*
						  L'ORGANISATION EST UN LIEN VERS SA FICHE (§11, §15.5). Une valeur absente
						  reste VIDE et SANS LIEN — ni tiret, ni « non renseigné » : un lien
						  n'apparaît que là où il a une destination, la règle que le carnet tient
						  déjà depuis le §11.6.
						*/}
						{contact.organisation === null ? (
							''
						) : (
							<Link
								to={cheminOrganisation(contact.organisation.id)}
								data-testid="lien-organisation-contact"
								className="inline-flex items-center min-h-[var(--size-target)] text-brand hover:underline break-words"
							>
								{contact.organisation.name}
							</Link>
						)}
					</dd>
				</div>
				<ValeurFiche libelle={t('contact.field.email')} valeur={contact.email} technique />
				<ValeurFiche libelle={t('contact.field.phone')} valeur={contact.phone} technique />
			</dl>

			{/* ZONE 2 — LES AFFAIRES. Lignes homogènes, donc le tableau du §5.9. */}
			<section className="flex flex-col gap-3">
				<h2 className="text-h3">{t('contact.deals.title')}</h2>
				{/*
				  LE GESTE DE RATTACHEMENT — §17.2. Il vit DANS cette zone, sous son titre et
				  AU-DESSUS du tableau, jamais en tête de fiche à côté de « Modifier » : un geste se
				  pose près de ce qu'il change. Le tableau reste visible sous le formulaire — il est
				  précisément ce qui dit à quelles affaires le contact est DÉJÀ rattaché, et une
				  modale recouvrirait la réponse à la question que l'on se pose en l'ouvrant (§5.26).
				*/}
				{gesteRattachement}
				{contact.affaires.length === 0 ? (
					// Cas e et o du §15.9, RÉVISÉS PAR LIVRAISON (§17.6, §5.24) : l'état vide GARDE
					// désormais son geste — c'est lui qui le comble, la règle du §5.13 pour l'état
					// vide d'une surface qui agit. Le geste est rendu juste au-dessus, et l'état vide
					// lui-même n'en porte donc aucun : le répéter offrirait deux fois la même action
					// (§5.8, « comme lui, l'action n'est alors pas répétée »). C'est aussi l'écran
					// d'un lecteur restreint, sans mise en scène du refus.
					<EtatVide titre={t('contact.deals.empty.title')} corps={t('contact.deals.empty.body')} />
				) : (
					<div className="overflow-x-auto indique-debordement-x">
						<table data-testid="tableau-affaires-contact" className="w-full border-collapse text-left">
							<caption className="sr-only">{t('contact.deals.aria')}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className={CLASSES_ENTETE}>
										{t('contact.deals.table.deal')}
									</th>
									<th scope="col" className={CLASSES_ENTETE}>
										{t('contact.deals.table.role')}
									</th>
									<th scope="col" className={CLASSES_ENTETE}>
										{t('contact.deals.table.state')}
									</th>
									{/*
									  QUATRIÈME COLONNE — LES COMMANDES (§18.4, §5.27, §5.28). Son
									  en-tête est un LIBELLÉ LISIBLE et non une cellule vide : une
									  colonne sans nom n'est pas annonçable au lecteur d'écran (§8). Elle
									  porte DEUX commandes depuis 4j, et son libellé est déjà au pluriel.
									  Le motif des « trois colonnes et non cinq » du §5.24 est INCHANGÉ —
									  il visait les colonnes de DONNÉE, le track et le channel restant
									  dans l'adresse.
									*/}
									{gestesLigne === undefined || client === null ? null : (
										<th scope="col" className={CLASSES_ENTETE}>
											{t('contact.detach.column')}
										</th>
									)}
								</tr>
							</thead>
							<tbody>
								{contact.affaires.map((affaire) => (
									<LigneAffaireContact
										key={affaire.idCard}
										affaire={affaire}
										client={client}
										idContact={contact.id}
										gestesLigne={gestesLigne}
									/>
								))}
							</tbody>
						</table>
					</div>
				)}
				{/*
				  LE MESSAGE DU GESTE SE LIT SOUS LE TABLEAU, jamais en tête d'écran (§5.13, §5.16,
				  §18.6) — la place que le §5.21 lui donne déjà pour l'autre sens. Il SURVIT à la
				  relecture, ce que l'issue « sans effet » exige : c'est précisément le cas où la
				  ligne RESTE, et où un message emporté par le remontage du tableau laisserait
				  l'utilisateur devant une liste inchangée sans la moindre explication.
				*/}
				{gestesLigne?.messageDetachement == null ? null : (
					<p
						role="alert"
						data-testid="message-detachement-affaire"
						className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
					>
						{gestesLigne.messageDetachement}
					</p>
				)}
			</section>
		</section>
	)
}

/**
 * Une ligne du tableau des affaires, et — quand un de ses blocs est ouvert — LA LIGNE QUI LE PORTE.
 *
 * **Le bloc occupe une ligne à lui, en `colSpan`, immédiatement sous la sienne** (§18.4, §19.4,
 * §5.27, §5.28). Les deux autres emplacements sont écartés pour une raison mesurable : dans la
 * cellule de la commande, il serait TRONQUÉ par `CLASSES_CELLULE` (`max-w-[32ch]`, `truncate`) et
 * la règle du §6 — nommer l'objet — serait tenue dans le balisage et perdue à l'écran ; sous le
 * tableau, rien ne le relierait à SA ligne. Le fragment rend deux `tr` frères, ce qu'un `tbody`
 * accepte.
 *
 * **UN SEUL BLOC À TOUT INSTANT DANS LE TABLEAU** (§19.4) : la ligne ne décide de rien, elle lit le
 * couple (geste, affaire) que la fiche tient. Ouvrir le formulaire de rôle d'une ligne ferme donc la
 * confirmation de détachement d'une autre, et réciproquement, sans code de plus.
 */
function LigneAffaireContact({
	affaire,
	client,
	idContact,
	gestesLigne,
}: {
	readonly affaire: FicheContactLue['affaires'][number]
	readonly client: ClientCrm | null
	readonly idContact: string
	readonly gestesLigne: EtatGestesLigne | undefined
}) {
	const commandeDetachement = useRef<HTMLButtonElement>(null)
	const commandeRole = useRef<HTMLButtonElement>(null)
	const ouvert = gestesLigne?.ouvert
	const confirmee = ouvert?.geste === 'detachement' && ouvert.idCard === affaire.idCard
	const roleOuvert = ouvert?.geste === 'role' && ouvert.idCard === affaire.idCard
	// LES DEUX COMMANDES SONT DÉSACTIVÉES TANT QU'UN BLOC DE CETTE LIGNE EST OUVERT (§19.4) : une
	// commande dont le bloc est déjà là n'a rien à rouvrir, et l'autre ouvrirait un second bloc sur
	// la ligne que l'on est en train de lire. Ce n'est pas une garde de droit (§19.6).
	const blocDeCetteLigne = confirmee || roleOuvert

	/**
	 * LE FOCUS REVIENT À LA COMMANDE DE SA LIGNE À LA FERMETURE, ET CE RETOUR EST DIFFÉRÉ (cas c
	 * du §18.7, cas d du §19.7).
	 *
	 * **LE MOTIF DIFFÈRE DE CELUI DE 4g ET DE 4h.** Là-bas la commande est DÉMONTÉE pendant que le
	 * formulaire est ouvert, et sa référence vaut `null`. Ici elle reste montée — mais elle est
	 * `disabled` tant qu'un bloc de la ligne est ouvert, et **un élément désactivé ne reçoit pas le
	 * focus** : `focus()` appelé depuis le gestionnaire d'annulation serait un geste sans effet,
	 * exactement comme le sélecteur de 4h au montage. Le drapeau est posé à la fermeture, l'effet
	 * rend le focus au tour suivant, quand le bouton est de nouveau actif. **Aucune temporisation**
	 * (`CLAUDE.md` §18) : c'est le cycle de rendu de React qui ordonne les deux gestes.
	 *
	 * Le drapeau retient **quelle** commande reprend le focus : deux gestes vivent sur cette ligne,
	 * et rendre le focus à celle du détachement après avoir annulé le formulaire de rôle déplacerait
	 * l'utilisateur d'un geste à l'autre sans qu'il l'ait demandé.
	 */
	const [focusARendre, setFocusARendre] = useState<'detachement' | 'role' | null>(null)

	useEffect(() => {
		if (blocDeCetteLigne || focusARendre === null) return
		const cible = focusARendre === 'role' ? commandeRole : commandeDetachement
		cible.current?.focus()
		setFocusARendre(null)
	}, [blocDeCetteLigne, focusARendre])

	const annuler = useCallback(() => {
		gestesLigne?.onDemander(null)
		setFocusARendre('detachement')
	}, [gestesLigne])

	const annulerRole = useCallback(() => {
		gestesLigne?.onDemander(null)
		setFocusARendre('role')
	}, [gestesLigne])

	// Cas h du §19.7 : le formulaire se ferme et la cellule du rôle porte la nouvelle valeur. Le
	// focus revient à la commande de rôle, comme après une annulation — un geste abouti ne laisse
	// pas plus le focus sur le document qu'un geste abandonné (§8).
	const surRoleModifie = useCallback(
		(role: string | null) => {
			gestesLigne?.onRoleModifie(affaire.idCard, role)
			setFocusARendre('role')
		},
		[affaire.idCard, gestesLigne],
	)

	return (
		<>
			<tr
				data-testid="ligne-affaire-contact"
				data-card={affaire.idCard}
				className="border-b border-border hover:bg-hover"
			>
				{/*
				  LE TITRE D'UNE AFFAIRE EST UN LIEN VERS ELLE, construit sur les slugs rapportés par
				  l'embarquement (§15.3). Le track et le channel ne sont PAS des colonnes : ils sont
				  dans l'adresse, et les répéter remplirait la ligne d'une information que le clic
				  donne déjà (§15.5).
				*/}
				<td className={CLASSES_CELLULE} title={affaire.titre}>
					<Link
						to={affaire.adresse}
						data-testid="lien-affaire-contact"
						className="text-brand hover:underline"
					>
						{affaire.titre}
					</Link>
				</td>
				{/*
				  Le rôle du RATTACHEMENT — le rôle du contact dans cette affaire —, à ne pas
				  confondre avec sa fonction, rendue en zone 1. Les deux zones portent la
				  distinction ; aucune glose n'est nécessaire (§15.3). Valeur libre, jamais traduite.
				*/}
				<td className={CLASSES_CELLULE} title={affaire.role === null ? undefined : affaire.role}>
					{affaire.role ?? ''}
				</td>
				<td className="h-[var(--size-target)] px-3">
					{/*
					  UNE AFFAIRE ARCHIVÉE RESTE ATTEIGNABLE, ET SON ÉTAT EST DIT (§15.3). La taire
					  mentirait sur le passé, que cette page sert précisément. Pilule du §5.6, précédée
					  d'une icône afin que l'information ne repose jamais sur la seule couleur.
					*/}
					{affaire.archivee ? (
						<span
							data-testid="pilule-affaire-archivee"
							className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-on-soft px-3 py-1 text-sm"
						>
							<Archive aria-hidden="true" size={14} strokeWidth={2} />
							{t('contact.deals.archived')}
						</span>
					) : (
						''
					)}
				</td>
				{/*
				  LES DEUX COMMANDES DE LA LIGNE — §18.4 et §19.4. TOUTES LES LIGNES LES PORTENT, y
				  compris celle d'une affaire ARCHIVÉE : MESURÉ, la base accepte le détachement comme
				  la modification du rôle sur une affaire close, `app.can_write_card` dérivant du
				  channel et ne lisant ni `archived_at` ni `deleted_at` (§18.3 mesure 4, §19.3
				  mesure 4). AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (§18.6, §19.6) : la
				  lectrice RÉUSSIT ces gestes sur une affaire et reçoit le silence sur une autre,
				  toutes deux lisibles par elle — l'écran qui calculerait ce droit se tromperait.

				  L'ORDRE EST : MODIFIER LE RÔLE, PUIS DÉTACHER (§19.4). Le geste qui CORRIGE précède
				  le geste qui RETIRE, comme la colonne gauche de la fiche d'affaire place « Modifier »
				  avant le bloc de corbeille. Un geste destructeur ne se pose jamais en premier sous
				  le pointeur.
				*/}
				{gestesLigne === undefined || client === null ? null : (
					<td className="h-[var(--size-target)] px-3">
						{/*
						  LES DEUX COMMANDES NE SE REPLIENT PAS, ET C'EST UN DÉFAUT TROUVÉ PAR LA
						  VÉRIFICATION VISUELLE (`CLAUDE.md` §16), à 390 px. Écrites d'abord en
						  `flex-wrap`, elles passaient l'une sous l'autre et la LIGNE GAGNAIT DE LA
						  HAUTEUR — l'écart que le §5.21 assume pour sa LISTE PLATE, et qui ne se
						  transporte pas ici : le §5.9 pose qu'une ligne de tableau vaut
						  `--size-target`, et la réponse d'un tableau au manque de place est de
						  DÉFILER dans son conteneur (§7, §12.6), ce que celui-ci fait déjà. Sans
						  repli, la ligne garde sa hauteur, les cibles gardent leurs 40 px, et le
						  défilement — qui est le contrat de ce tableau — porte le reste.

						  `whitespace-nowrap` est posé sur la CELLULE et non sur chaque bouton, la
						  propriété étant héritée : sans lui, « Modifier le rôle » se coupait EN DEUX
						  LIGNES à l'intérieur de son propre bouton, et la ligne grandissait quand
						  même. Une règle de cellule dit ce qu'elle vise — cette colonne ne se replie
						  pas — là où deux classes de bouton l'auraient répétée.
						*/}
						<div className="flex items-center gap-2 whitespace-nowrap">
							<CommandeRoleRattachement
								commande={commandeRole}
								idCard={affaire.idCard}
								blocOuvert={blocDeCetteLigne}
								onDemander={() =>
									gestesLigne.onDemander({ geste: 'role', idCard: affaire.idCard })
								}
							/>
							<CommandeDetachementAffaire
								commande={commandeDetachement}
								idCard={affaire.idCard}
								confirmationOuverte={blocDeCetteLigne}
								onDemander={() =>
									gestesLigne.onDemander({ geste: 'detachement', idCard: affaire.idCard })
								}
							/>
						</div>
					</td>
				)}
			</tr>
			{/*
			  UNE LIGNE À ELLE, SUR TOUTE LA LARGEUR (§18.4, §19.4, §5.27, §5.28) : c'est le seul
			  emplacement à la fois DANS LE FLUX (§5.13), ADJACENT à la ligne concernée, et ASSEZ
			  LARGE pour nommer l'affaire — ce que la cellule bornée à `32ch` et tronquée de la
			  commande ne permettrait pas. Les deux gestes la partagent, et jamais en même temps.
			*/}
			{gestesLigne === undefined || client === null || !confirmee ? null : (
				<tr data-testid="ligne-confirmation-detachement" data-card={affaire.idCard}>
					<td colSpan={4} className="px-3">
						<ConfirmationDetachementAffaire
							client={client}
							idCard={affaire.idCard}
							idContact={idContact}
							titre={affaire.titre}
							onGeste={gestesLigne.onDetachement}
							onAnnuler={annuler}
						/>
					</td>
				</tr>
			)}
			{gestesLigne === undefined || client === null || !roleOuvert ? null : (
				<tr data-testid="ligne-formulaire-role" data-card={affaire.idCard}>
					<td colSpan={4} className="px-3">
						<FormulaireRoleRattachement
							client={client}
							idCard={affaire.idCard}
							idContact={idContact}
							titre={affaire.titre}
							role={affaire.role}
							onModifie={surRoleModifie}
							onFermer={annulerRole}
						/>
					</td>
				</tr>
			)}
		</>
	)
}
