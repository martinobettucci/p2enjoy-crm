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
// L'ÉCRAN LIT, ET DEPUIS LA SOUS-TRANCHE 4g IL MODIFIE — cela, et rien de plus. La SUPPRESSION
// reste absente, et son motif n'est pas le temps : elle dépend de l'arbitrage NON TRANCHÉ du §6
// point 4, les valeurs `jsonb` qui désignent un contact supprimé demeurant en base. Le
// rattachement depuis cette page reste absent lui aussi (§15.8). Les deux écarts sont NOMMÉS au
// §16.8, non compensés par des commandes mortes.
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
import { Link, useParams } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	lireFicheContact,
	lireOrganisationsDuWorkspace,
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

	return (
		<ContenuFiche
			client={client}
			etat={etat}
			contact={contact}
			onReprise={reprendre}
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
						onClick={() => setOuvert(true)}
					>
						{t('contact.modification.open')}
					</button>
				)
			}
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
}

function ContenuFiche({ client, etat, contact, onReprise, geste = null }: ProprietesContenu) {
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
			*/}
			{geste}
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
				{contact.affaires.length === 0 ? (
					// Cas e et o du §15.9 : l'état vide n'offre AUCUNE action — cette surface ne
					// livre aucun geste de rattachement, et un bouton y serait un chemin vers nulle
					// part. C'est aussi l'écran d'un lecteur restreint, sans mise en scène du refus.
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
								</tr>
							</thead>
							<tbody>
								{contact.affaires.map((affaire) => (
									<tr
										key={affaire.idCard}
										data-testid="ligne-affaire-contact"
										data-card={affaire.idCard}
										className="border-b border-border hover:bg-hover"
									>
										{/*
										  LE TITRE D'UNE AFFAIRE EST UN LIEN VERS ELLE, construit sur
										  les slugs rapportés par l'embarquement (§15.3). Le track et
										  le channel ne sont PAS des colonnes : ils sont dans
										  l'adresse, et les répéter remplirait la ligne d'une
										  information que le clic donne déjà (§15.5).
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
										  Le rôle du RATTACHEMENT — le rôle du contact dans cette
										  affaire —, à ne pas confondre avec sa fonction, rendue en
										  zone 1. Les deux zones portent la distinction ; aucune glose
										  n'est nécessaire (§15.3). Valeur libre, donc jamais traduite.
										*/}
										<td
											className={CLASSES_CELLULE}
											title={affaire.role === null ? undefined : affaire.role}
										>
											{affaire.role ?? ''}
										</td>
										<td className="h-[var(--size-target)] px-3">
											{/*
											  UNE AFFAIRE ARCHIVÉE RESTE ATTEIGNABLE, ET SON ÉTAT EST DIT
											  (§15.3). La taire mentirait sur le passé, que cette page
											  sert précisément. Pilule du §5.6, précédée d'une icône afin
											  que l'information ne repose jamais sur la seule couleur.
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
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</section>
	)
}
