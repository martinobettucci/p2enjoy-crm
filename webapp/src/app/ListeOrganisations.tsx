// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : l'onglet « Organisations » du carnet — la liste et la création
// @spec docs/SPEC-organisations.md §2 (lister, créer, puis ouvrir la fiche), §3 (droits de la base, refus), §4 (de quoi il a
//       l'air) ; docs/DESIGN_SYSTEM.md §5.64 (tableau à quatre colonnes, « Nouvelle organisation »), §5.59 (commande
//       éteinte avec le motif quand la base refuse l'édition de l'espace), §5.9 (tableau), §5.8 (états), §12.6
//
// L'écran ne calcule aucun droit : il lit la capacité que la base rend (`edition_permise`) pour éteindre la commande, et
// traduit le refus de la base si elle survient malgré tout.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { motifVisible, proprietesCommande } from '../lib/capacites'
import {
	SAISIE_ORGANISATION_VIDE,
	creerOrganisation,
	lireOrganisations,
	type OrganisationListee,
} from '../lib/organisations'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { cheminOrganisation } from './chemins'
import { AppShell } from './AppShell'
import { useContexteEspace } from './ContexteEspace'
import { FormulaireOrganisation } from './FormulaireOrganisation'
import { OngletsCarnet } from './OngletsCarnet'

const ID_MOTIF = 'organisations-lecture-seule'
/** Le titre de la route, nommé hors du JSX pour le contrôle des clés mortes, comme `CLE_TITRE_CARD`. */
const CLE_TITRE: CleTraduction = 'route.organizations.title'

/** La route de l'onglet : sa coquille, les onglets du carnet, puis la liste. */
export function RouteOrganisations() {
	return (
		<AppShell cleTitreRoute={CLE_TITRE}>
			<div className="flex flex-col gap-4">
				<OngletsCarnet actif="organisations" />
				<ListeOrganisations />
			</div>
		</AppShell>
	)
}
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_CELLULE_TECHNIQUE = 'h-[var(--size-target)] px-3 text-right whitespace-nowrap max-w-[36ch] truncate'
const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

export function ListeOrganisations({ client = clientCrm }: { readonly client?: ClientCrm | null } = {}) {
	const { capacites } = useContexteEspace()
	const navigate = useNavigate()
	const espaces = useWorkspaces(client)
	const [etat, setEtat] = useState<EtatAsync<readonly OrganisationListee[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [ouvert, setOuvert] = useState(false)
	const [focusARendre, setFocusARendre] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		void (async () => {
			const lu = await lireOrganisations(client)
			if (rang === courant.current) setEtat(lu)
		})()
	}, [client, tentative])

	useEffect(() => {
		if (ouvert || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [ouvert, focusARendre])

	const fermer = useCallback(() => {
		setOuvert(false)
		setFocusARendre(true)
	}, [])

	if (client === null) {
		return <EtatVide titre={t('contacts.noWorkspace.title')} corps={t('contacts.noWorkspace.body')} />
	}
	if (etat.statut === 'chargement') return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('organizations.error.title')}
				corps={t('organizations.error.body')}
				libelleReprise={t('organizations.error.retry')}
				onReprise={() => setTentative((n) => n + 1)}
			/>
		)
	}

	const idWorkspace = espaces.etat.statut === 'pret' ? (espaces.etat.donnees[0]?.id ?? null) : null
	const droit = proprietesCommande(capacites.edition, ID_MOTIF)
	const geste =
		idWorkspace === null ? null : ouvert ? (
			<FormulaireOrganisation
				prefixe="organisation-nouvelle"
				titre={t('organizations.creation.title')}
				saisieInitiale={SAISIE_ORGANISATION_VIDE}
				libelleEnvoi={t('organizations.creation.submit')}
				libelleEnvoiEnCours={t('organizations.creation.pending')}
				onAnnuler={fermer}
				onEnvoyer={async (saisie) => {
					const issue = await creerOrganisation(client, idWorkspace, saisie)
					if (issue.statut === 'refus') return issue.nature
					// LA FICHE PORTE LA SUITE : ses contacts à rattacher (docs/DESIGN_SYSTEM.md §5.64).
					void navigate(cheminOrganisation(issue.id))
					return null
				}}
			/>
		) : (
			<>
				{motifVisible(capacites.edition) ? (
					<MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.edition')}</MotifLectureSeule>
				) : null}
				<button
					type="button"
					ref={commande}
					data-testid="ouvrir-creation-organisation"
					className="self-start min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface disabled:cursor-not-allowed disabled:opacity-70"
					{...droit}
					onClick={() => setOuvert(true)}
				>
					{t('organizations.creation.open')}
				</button>
			</>
		)

	return (
		<section aria-label={t('organizations.aria')} className="flex flex-col gap-4">
			{geste}
			{etat.donnees.length === 0 ? (
				<EtatVide titre={t('organizations.empty.title')} corps={t('organizations.empty.body')} />
			) : (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-organisations" className="w-full border-collapse text-left">
						<caption className="sr-only">{t('organizations.table.aria')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('organizations.table.name')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('organizations.table.domain')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('organizations.table.website')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('organizations.table.contacts')}</th>
							</tr>
						</thead>
						<tbody>
							{etat.donnees.map((organisation) => (
								<tr key={organisation.id} data-testid="ligne-organisation" data-organisation={organisation.id} className="border-b border-border hover:bg-hover">
									<td className={CLASSES_CELLULE} title={organisation.name}>
										<Link to={cheminOrganisation(organisation.id)} className="text-brand hover:underline" data-testid="lien-fiche-organisation">
											{organisation.name}
										</Link>
									</td>
									<td className={CLASSES_CELLULE_TECHNIQUE}>
										{organisation.domain === null ? '' : <code className="text-text-2">{organisation.domain}</code>}
									</td>
									<td className={CLASSES_CELLULE_TECHNIQUE}>
										{organisation.website === null ? '' : <code className="text-text-2">{organisation.website}</code>}
									</td>
									<td className={`${CLASSES_CELLULE_TECHNIQUE} tabular-nums`}>{organisation.contacts}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}
