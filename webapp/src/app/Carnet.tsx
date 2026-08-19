// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a :
//       le carnet de contacts
// @spec docs/SPEC-contacts.md §10.2 (où le carnet s'ancre), §10.5 (de quoi il a l'air),
//       §10.6 (contrat de comportement, cas a à g), §10.7 (limites nommées)
// @spec docs/SPEC-contacts.md §11.6 (le nom d'organisation devient un lien vers sa fiche : la
//       règle du §10.7 change par LIVRAISON, sa condition étant tombée), §11.9 cas i
// @spec docs/SPEC-contacts.md §14 (sous-tranche 4e : la CRÉATION d'un contact) — §14.2 (où le
//       geste s'ancre), §14.5 (contrat de comportement, cas a à l), §14.6 (l'écran ne calcule
//       aucun droit), §14.7 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.19 (cette surface, révisé), §5.20 (la fiche, destination du
//       lien), §5.9 (tableau de données),
//       §5.8 (états systématiques), §2 (données techniques), §12.6 (débordement signalé)
//
// UN ÉCRAN QUI LISAIT SEULEMENT, JUSQU'À LA SOUS-TRANCHE 4e. Le carnet porte désormais le geste
// de CRÉATION (§14), et lui seul : ni modification, ni suppression, ni création d'organisation —
// ces trois manques sont NOMMÉS au §14.7, non compensés par des commandes mortes.
//
// LE WORKSPACE COURANT EST LE PREMIER RENDU PAR `lireWorkspaces`, patron déjà porté par
// `AdministrationCatalogue`, `AdministrationArborescence`, `AdministrationWorkflows` et le
// `Header` : le produit n'a pas encore de sélecteur d'espace de travail, et en inventer un ici
// poserait une surface que rien ne spécifie.
//
// L'écran ne calcule AUCUN droit (§10.4) : il rend ce que le backend consent. Un appelant sans
// droit reçoit `200` et zéro ligne — mesuré —, ce qui est l'état vide ordinaire du §5.8 et non un
// refus à mettre en scène (docs/SPEC-permissions-rls.md §7).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	lireContactsDuCarnet,
	lireOrganisationsDuWorkspace,
	type ContactDuCarnet,
	type OrganisationChoisissable,
} from '../lib/contacts'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { cheminOrganisation } from './chemins'
import { FormulaireCreationContact } from './FormulaireCreationContact'

/** Cellule ordinaire : une seule ligne de texte en ellipse, hauteur de cible (§5.9). */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[28ch]'

/**
 * Cellule de donnée technique (§2) : monospace et chiffres tabulaires, alignée à droite pour se
 * comparer colonne par colonne — la seule raison d'avoir des chiffres tabulaires (§5.9).
 */
const CLASSES_CELLULE_TECHNIQUE =
	'h-[var(--size-target)] px-3 text-right whitespace-nowrap max-w-[32ch] truncate'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

export type ProprietesCarnet = {
	readonly client?: ClientCrm | null
}

export function Carnet({ client = clientCrm }: ProprietesCarnet = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly ContactDuCarnet[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par une nouvelle tentative, ne doit pas
	// écraser un état plus récent — même garde que `EtatMessagerie` et `AdministrationArborescence`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireContactsDuCarnet(client)
			if (rang !== courant.current) return
			// La double garde est celle d'`EtatMessagerie` : la fonction de lecture ne rend jamais
			// `chargement`, mais le type `EtatAsync` le porte structurellement, et seule cette
			// forme le nomme au lieu de le nier.
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret(lu.donnees))
		})()
	}, [client, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	// LE FORMULAIRE EST REPLIÉ PAR DÉFAUT (§14.2) : le carnet est d'abord une surface de lecture,
	// et un formulaire toujours déplié pousserait le tableau sous la ligne de flottaison.
	const [ouvert, setOuvert] = useState(false)
	const [ajoutes, setAjoutes] = useState<readonly ContactDuCarnet[]>([])
	const [organisations, setOrganisations] =
		useState<EtatAsync<readonly OrganisationChoisissable[]>>(enChargement)
	const [tentativeOrganisations, setTentativeOrganisations] = useState(0)
	const commandeOuverture = useRef<HTMLButtonElement | null>(null)
	const espaces = useWorkspaces(client)

	// LA LISTE DES ORGANISATIONS N'EST LUE QUE SI LE FORMULAIRE EST OUVERT — même motif que le
	// §13.4 : charger une liste pour un geste que la plupart des visites ne font pas serait une
	// requête gratuite. Le carnet est une surface de lecture avant d'être une surface de saisie.
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
	 * LE FOCUS EST RENDU à la commande qui a ouvert le formulaire (§14.5 cas c,
	 * `docs/DESIGN_SYSTEM.md` §5.23 et §5.21), et il l'est APRÈS LE RENDU.
	 *
	 * DÉFAUT TROUVÉ PAR LA PREUVE UNITAIRE DU CAS c, le 2026-08-19, et corrigé à sa CAUSE : la
	 * commande d'ouverture est DÉMONTÉE tant que le formulaire est ouvert — les deux s'excluent —,
	 * si bien qu'appeler `focus()` depuis le gestionnaire de fermeture visait une référence
	 * **nulle** et laissait le focus sur le document. Activer « Annuler » au clavier renvoyait donc
	 * en tête de page, exactement ce que le §5.21 interdit.
	 *
	 * C'est le défaut, et le remède, que la preuve clavier de `CRM-077` a déjà établis pour
	 * `BlocContactsCard` : le drapeau est posé à la fermeture, et l'effet rend le focus au tour
	 * suivant, quand la commande est remontée. Aucune temporisation n'est employée (`CLAUDE.md`
	 * §18) — c'est le cycle de rendu de React qui ordonne les deux gestes, pas une horloge.
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

	// LA LIGNE CRÉÉE REJOINT LE TABLEAU SANS RELIRE LA LISTE (§14.5 cas e) : PostgREST rend la
	// ligne créée avec son organisation embarquée, et le tri est celui du serveur — `full_name`,
	// avec la collation de la base, que `localeCompare('fr')` reproduit ici.
	const surCree = useCallback(
		(contact: ContactDuCarnet) => {
			setAjoutes((precedents) => [...precedents, contact])
			fermer()
		},
		[fermer],
	)

	if (client === null) {
		return <EtatVide titre={t('contacts.noWorkspace.title')} corps={t('contacts.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('contacts.error.title')}
				corps={t('contacts.error.body')}
				libelleReprise={t('contacts.error.retry')}
				onReprise={reprendre}
			/>
		)
	}

	// Les contacts créés dans cette visite REJOIGNENT leur place de tri, sans relecture (§14.5
	// cas e). Le tri du serveur est `full_name` ; `localeCompare('fr')` le reproduit à l'écran.
	const contacts = [...etat.donnees, ...ajoutes].sort((gauche, droite) =>
		gauche.full_name.localeCompare(droite.full_name, 'fr'),
	)
	const idWorkspace = espaces.etat.statut === 'pret' ? (espaces.etat.donnees[0]?.id ?? null) : null

	// LE GESTE DE CRÉATION — §14.2. Il vit entre le titre et le tableau, dans le FLUX du document,
	// et il est le MÊME dans l'état vide : un carnet vide est précisément celui où l'on veut
	// ajouter un contact. L'écart du §5.8 que la sous-tranche 4a assumait — « l'état vide n'offre
	// aucune action » — tombe donc par LIVRAISON, sa condition (aucun geste de création) ayant
	// cessé d'être vraie.
	const geste =
		idWorkspace === null ? null : ouvert ? (
			<FormulaireCreationContact
				client={client}
				idWorkspace={idWorkspace}
				organisations={organisations}
				onRelireOrganisations={() => setTentativeOrganisations((precedente) => precedente + 1)}
				onCree={surCree}
				onFermer={fermer}
			/>
		) : (
			<button
				type="button"
				ref={commandeOuverture}
				data-testid="ouvrir-creation-contact"
				className="self-start min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface"
				onClick={() => setOuvert(true)}
			>
				{t('contacts.creation.open')}
			</button>
		)

	if (contacts.length === 0) {
		return (
			<section aria-label={t('contacts.aria')} className="flex flex-col gap-4">
				{geste}
				<EtatVide titre={t('contacts.empty.title')} corps={t('contacts.empty.body')} />
			</section>
		)
	}

	return (
		<section aria-label={t('contacts.aria')} className="flex flex-col gap-4">
			{geste}
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-contacts" className="w-full border-collapse text-left">
					<caption className="sr-only">{t('contacts.table.aria')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>
								{t('contacts.table.name')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('contacts.table.organization')}
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
						{contacts.map((contact) => (
							<tr
								key={contact.id}
								data-testid="ligne-contact"
								data-contact={contact.id}
								className="border-b border-border hover:bg-hover"
							>
								<td className={CLASSES_CELLULE} title={contact.full_name}>
									{contact.full_name}
								</td>
								{/*
								  LE NOM DE L'ORGANISATION EST UN LIEN VERS SA FICHE — §11.6, révision
								  du 2026-08-18. Il était un TEXTE tant que la fiche n'existait pas :
								  un lien sans destination aurait été mort (§10.7, §5.10). La
								  sous-tranche 4b livre cette destination, et la règle change donc par
								  LIVRAISON, non par contournement.

								  Une cellule sans organisation reste VIDE et SANS LIEN — ni tiret, ni
								  « non renseigné » (§5.9) : un lien n'apparaît que là où il a une
								  destination.

								  AUCUN `aria-label` sur le lien, et c'est délibéré : il remplacerait
								  le nom de l'organisation par un libellé identique sur chaque ligne,
								  rendant les liens indistinguables pour un lecteur d'écran (§8). Le
								  nom EST le libellé du lien.
								*/}
								<td
									className={CLASSES_CELLULE}
									title={contact.organisation === null ? undefined : contact.organisation.name}
								>
									{contact.organisation === null ? (
										''
									) : (
										<Link
											to={cheminOrganisation(contact.organisation.id)}
											data-testid="lien-organisation"
											className="inline-flex items-center min-h-[var(--size-target)] text-brand hover:underline"
										>
											{contact.organisation.name}
										</Link>
									)}
								</td>
								<td
									className={CLASSES_CELLULE}
									title={contact.role_title === null ? undefined : contact.role_title}
								>
									{contact.role_title ?? ''}
								</td>
								<td className={CLASSES_CELLULE_TECHNIQUE}>
									{contact.email === null ? '' : <code className="text-text-2">{contact.email}</code>}
								</td>
								<td className={CLASSES_CELLULE_TECHNIQUE}>
									{contact.phone === null ? '' : <code className="text-text-2">{contact.phone}</code>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}
