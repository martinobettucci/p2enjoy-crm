// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4b :
//       la fiche d'organisation
// @spec docs/SPEC-contacts.md §11.2 (où la fiche s'ancre, et pourquoi hors de `ROUTES`),
//       §11.4 (trois absences rendent le même écran), §11.5 (de quoi elle a l'air),
//       §11.8 (limites nommées), §11.9 (contrat de comportement, cas a à i)
// @spec docs/DESIGN_SYSTEM.md §5.20 (cette surface), §5.9 (tableau de données),
//       §5.8 (états systématiques), §2 (données techniques), §8 (accessibilité),
//       §12.6 (débordement signalé)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// UN ÉCRAN QUI LIT, ET RIEN D'AUTRE, comme le carnet dont il prolonge la lecture. La sous-tranche
// 4b ne livre aucun geste de création, de modification ni de suppression d'organisation : les
// privilèges existent en base depuis la tranche 1, aucun écran ne les exerce encore. L'écart est
// NOMMÉ au §11.8, non compensé par une commande morte.
//
// TROIS ABSENCES, UN SEUL ÉCRAN, DÉLIBÉRÉMENT (§11.4). Une organisation inexistante, une
// organisation refusée à l'appelant et un identifiant qui n'est pas un uuid rendent tous les trois
// « organisation introuvable ». MESURÉ : les deux premières rendent `200` et `[]`, indistinguables
// par construction — les séparer renseignerait un appelant sans droit sur l'EXISTENCE d'une
// organisation. La troisième les rejoint parce qu'un `400` mènerait à un état d'erreur dont la
// reprise ne pourrait jamais aboutir.
//
// LA COQUILLE EST PORTÉE ICI, et non par la table `ROUTES` : le titre de la route est le NOM de
// l'organisation, donc une donnée et non une clé de traduction. C'est le patron exact de
// `RouteCard`, et il laisse intacte la couverture `ROUTES` ⇄ `ENTREES_TRANSVERSES` (§11.2).

import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { lireFicheOrganisation, type FicheOrganisationLue } from '../lib/contacts'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { CHEMIN_CONTACTS } from './chemins'

/** Cellule ordinaire du tableau des contacts — mêmes règles qu'au carnet (§5.9). */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[28ch]'

/** Cellule de donnée technique (§2) : alignée à droite pour se comparer colonne par colonne. */
const CLASSES_CELLULE_TECHNIQUE =
	'h-[var(--size-target)] px-3 text-right whitespace-nowrap max-w-[32ch] truncate'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

/** Classes du lien de retour, identiques à celles de `PageIntrouvable` (§5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre, remplacé par le nom de l'organisation dès qu'il est connu.
 *
 * Déclarée comme constante et non écrite dans le JSX, pour la raison exacte de `CLE_TITRE_CARD` :
 * le contrôle de clés mortes de `webapp/src/i18n/i18n.test.ts` cherche les clés citées entre
 * apostrophes, et un attribut JSX entre guillemets lui échapperait.
 */
const CLE_TITRE_ORGANISATION: CleTraduction = 'organization.route.title'

export type ProprietesFicheOrganisation = {
	readonly client?: ClientCrm | null
}

export type ProprietesContenuFiche = {
	readonly client?: ClientCrm | null
	/** Identifiant tel qu'il vient de l'adresse — donc de forme quelconque (§11.4). */
	readonly idOrganisation: string | undefined
}

/**
 * Une valeur de la liste de définitions : un couple libellé / valeur, la valeur restant VIDE
 * lorsque la donnée n'existe pas — ni tiret, ni « non renseigné » (§5.9, §5.20).
 */
function ValeurTechnique({ libelle, valeur }: { libelle: string; valeur: string | null }) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="text-sm text-text-2">{libelle}</dt>
			<dd className="min-h-[var(--size-target)] flex items-center">
				{valeur === null ? '' : <code className="text-text-2 break-all">{valeur}</code>}
			</dd>
		</div>
	)
}

/**
 * LA ROUTE : elle ne fait que deux choses — lire l'identifiant dans l'adresse, et poser la
 * coquille dont le titre est le NOM de l'organisation, donc une donnée (§11.2).
 *
 * Le CONTENU vit dans un composant distinct et exporté. Ce n'est pas un découpage de confort :
 * `AppShell` lit `clientCrm`, le client de MODULE, pour les espaces de travail et les tracks —
 * il ne s'injecte pas. Une preuve unitaire montée sur la route entière n'éprouverait donc que la
 * zone principale de la coquille, jamais la fiche. C'est le patron déjà tenu par `RouteCard`,
 * dont les preuves unitaires montent `BlocCorbeilleCard` et non la route. Le parcours complet,
 * coquille comprise, est éprouvé par `e2e/ui/contacts.spec.ts` sur la pile réelle.
 */
export function FicheOrganisation({ client = clientCrm }: ProprietesFicheOrganisation = {}) {
	const { idOrganisation } = useParams()
	const [nom, setNom] = useState<string | null>(null)
	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_ORGANISATION}
			{...(nom === null ? {} : { titreRoute: nom })}
		>
			<ContenuFicheOrganisation
				client={client}
				idOrganisation={idOrganisation}
				onNomConnu={setNom}
			/>
		</AppShell>
	)
}

export function ContenuFicheOrganisation({
	client = clientCrm,
	idOrganisation,
	onNomConnu,
}: ProprietesContenuFiche & { readonly onNomConnu?: (nom: string | null) => void }) {
	const [etat, setEtat] = useState<EtatAsync<FicheOrganisationLue | null>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par une nouvelle tentative, ne doit pas
	// écraser un état plus récent — même garde que `Carnet` et `EtatMessagerie`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireFicheOrganisation(client, idOrganisation)
			if (rang !== courant.current) return
			// La double garde est celle du carnet : la fonction de lecture ne rend jamais
			// `chargement`, mais le type `EtatAsync` le porte structurellement, et seule cette
			// forme le nomme au lieu de le nier.
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret(lu.donnees))
			// Le titre de la route est une DONNÉE : la coquille l'apprend du contenu, seul à lire.
			onNomConnu?.(lu.donnees === null ? null : lu.donnees.name)
		})()
		// `onNomConnu` est délibérément hors des dépendances : elle ne décrit PAS quoi lire, et
		// l'y mettre relancerait la lecture à chaque rendu du parent.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idOrganisation, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const organisation = etat.statut === 'pret' ? etat.donnees : null

	return (
		<ContenuFiche client={client} etat={etat} organisation={organisation} onReprise={reprendre} />
	)
}

type ProprietesContenu = {
	readonly client: ClientCrm | null
	readonly etat: EtatAsync<FicheOrganisationLue | null>
	readonly organisation: FicheOrganisationLue | null
	readonly onReprise: () => void
}

function ContenuFiche({ client, etat, organisation, onReprise }: ProprietesContenu) {
	if (client === null) {
		return (
			<EtatVide
				titre={t('organization.noWorkspace.title')}
				corps={t('organization.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('organization.error.title')}
				corps={t('organization.error.body')}
				libelleReprise={t('organization.error.retry')}
				onReprise={onReprise}
			/>
		)
	}

	// Cas e et f du §11.9 : inexistante, refusée, ou identifiant mal formé. Un seul écran, qui
	// porte un retour vers le carnet — la surface d'où l'on vient.
	if (organisation === null) {
		return (
			<EtatVide
				titre={t('organization.notFound.title')}
				corps={t('organization.notFound.body')}
				action={
					<Link to={CHEMIN_CONTACTS} className={CLASSES_RETOUR}>
						{t('organization.notFound.action')}
					</Link>
				}
			/>
		)
	}

	return (
		<section aria-label={t('organization.aria')} className="flex flex-col gap-6">
			{/*
			  ZONE 1 — CE QUI CARACTÉRISE L'ORGANISATION. Une liste de DÉFINITIONS et non un
			  tableau : ce sont des couples libellé/valeur qui ne se comparent pas entre eux
			  (§11.5, §5.20). Le nom n'y figure pas — il est le titre de la route.
			*/}
			<dl
				data-testid="caracteristiques-organisation"
				aria-label={t('organization.details.aria')}
				className="grid gap-4 md:grid-cols-2 max-w-[60ch]"
			>
				<ValeurTechnique libelle={t('organization.field.domain')} valeur={organisation.domain} />
				<div className="flex flex-col gap-1">
					<dt className="text-sm text-text-2">{t('organization.field.website')}</dt>
					<dd className="min-h-[var(--size-target)] flex items-center">
						{/*
						  LE SITE WEB EST UN LIEN, LE DOMAINE N'EN EST PAS UN (§11.5). Un site a une
						  destination réelle, et la contrainte de base garantit déjà sa forme
						  `http`/`https` : le lien ne peut donc pas être construit sur une valeur
						  qui n'en est pas une. Sa sortie du produit est ANNONCÉE — icône et texte
						  pour lecteur d'écran —, jamais subie.
						*/}
						{organisation.website === null ? (
							''
						) : (
							<a
								href={organisation.website}
								target="_blank"
								rel="noreferrer noopener"
								data-testid="lien-site-organisation"
								className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-brand hover:underline break-all"
							>
								<code>{organisation.website}</code>
								<ExternalLink aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
								<span className="sr-only">{t('organization.website.newTab')}</span>
							</a>
						)}
					</dd>
				</div>
			</dl>

			{/* ZONE 2 — LES CONTACTS. Lignes homogènes, donc le tableau du §5.9. */}
			<section className="flex flex-col gap-3">
				<h2 className="text-h3">{t('organization.contacts.title')}</h2>
				{organisation.contacts.length === 0 ? (
					// Cas d du §11.9 : l'état vide n'offre AUCUNE action — cette surface ne livre
					// aucun geste de création, et un bouton y serait un chemin vers nulle part.
					<EtatVide
						titre={t('organization.contacts.empty.title')}
						corps={t('organization.contacts.empty.body')}
					/>
				) : (
					<div className="overflow-x-auto indique-debordement-x">
						<table
							data-testid="tableau-contacts-organisation"
							className="w-full border-collapse text-left"
						>
							<caption className="sr-only">{t('organization.contacts.aria')}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className={CLASSES_ENTETE}>
										{t('contacts.table.name')}
									</th>
									<th scope="col" className={CLASSES_ENTETE}>
										{t('contacts.table.role')}
									</th>
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
										{t('contacts.table.email')}
									</th>
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
										{t('contacts.table.phone')}
									</th>
								</tr>
							</thead>
							<tbody>
								{organisation.contacts.map((contact) => (
									<tr
										key={contact.id}
										data-testid="ligne-contact-organisation"
										data-contact={contact.id}
										className="border-b border-border hover:bg-hover"
									>
										{/*
										  Le nom d'un contact n'est PAS un lien : il n'existe pas de
										  fiche de contact, et un lien y serait mort (§11.8). C'est la
										  règle que le §11.6 vient d'abandonner pour l'organisation,
										  tenue ici pour la raison exacte qui la fondait là.
										*/}
										<td className={CLASSES_CELLULE} title={contact.full_name}>
											{contact.full_name}
										</td>
										<td
											className={CLASSES_CELLULE}
											title={contact.role_title === null ? undefined : contact.role_title}
										>
											{contact.role_title ?? ''}
										</td>
										<td className={CLASSES_CELLULE_TECHNIQUE}>
											{contact.email === null ? (
												''
											) : (
												<code className="text-text-2">{contact.email}</code>
											)}
										</td>
										<td className={CLASSES_CELLULE_TECHNIQUE}>
											{contact.phone === null ? (
												''
											) : (
												<code className="text-text-2">{contact.phone}</code>
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
