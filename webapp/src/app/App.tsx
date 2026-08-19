// @spec CRM-007 (docs/BACKLOG.md) — racine applicative et routage
// @spec CRM-009 (docs/BACKLOG.md) — route de connexion et restauration de session
// @spec CRM-075 (docs/BACKLOG.md) — route de l'administration de l'arborescence
// @spec CRM-076 (docs/BACKLOG.md) — route de l'éditeur de workflows
// @spec CRM-059 (docs/BACKLOG.md) — route de l'écran d'état de la messagerie
// @spec CRM-077 (docs/BACKLOG.md) — route de la corbeille (docs/SPEC-corbeille.md §4.1)
// @spec CRM-060 (docs/BACKLOG.md) — route de la fiche d'organisation (docs/SPEC-contacts.md §11.2)
// @spec CRM-086 (docs/BACKLOG.md) — route de l'écran de coûts d'un track (docs/SPEC-costs.md §4.0)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.2 (session), §12.3 (chargement différé)
// @spec docs/SPEC-auth.md §9.1 ; docs/JOURNAL.md décision 248
//
// Le routage est déclaré à partir de la table de `routes.tsx` : ajouter une route ne demande
// pas de toucher à ce fichier, et le titre affiché par l'en-tête ne peut pas diverger de la
// route rendue, puisqu'ils viennent de la même description.

import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { AppShell } from './AppShell'
import { FournisseurAuthentification, useAuthentification } from './Authentification'
import { ChargementAuthentification, EcranConnexion } from './EcranConnexion'
import { GuideDemarrage } from './GuideDemarrage'
import {
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_ADMIN_CATALOGUE,
	CHEMIN_ADMIN_WORKFLOWS,
	CHEMIN_CARD,
	CHEMIN_CORBEILLE,
	CHEMIN_COUTS_TRACK,
	CHEMIN_DEMARRAGE,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_LISTE,
	CHEMIN_CONTACT,
	CHEMIN_OBJECTIFS_TABLEAU,
	CHEMIN_ORGANISATION,
	CHEMINS_TRACK,
	CLE_TITRE_ADMIN_ARBORESCENCE,
	CLE_TITRE_ADMIN_CATALOGUE,
	CLE_TITRE_ADMIN_WORKFLOWS,
	CLE_TITRE_CORBEILLE,
	CLE_TITRE_DEMARRAGE,
	CLE_TITRE_ETAT_MESSAGERIE,
	CLE_TITRE_INTROUVABLE,
	CLE_TITRE_OBJECTIFS,
	PageIntrouvable,
	ROUTES,
} from './routes'

const RouteTrack = lazy(async () => ({ default: (await import('./RouteTrack')).RouteTrack }))
/**
 * L'écran d'administration de `CRM-075`, chargé à la demande comme l'inbox et le board : la
 * plupart des sessions ne l'ouvrent pas, et il n'a pas à peser sur leur premier rendu
 * (`CLAUDE.md` §21). MESURÉ : le paquet séparé pèse 21 ko.
 */
const AdministrationArborescence = lazy(async () => ({
	default: (await import('./AdministrationArborescence')).AdministrationArborescence,
}))
/** L'éditeur de workflows de `CRM-076`, chargé à la demande pour la même raison. */
const AdministrationWorkflows = lazy(async () => ({
	default: (await import('./AdministrationWorkflows')).AdministrationWorkflows,
}))
/**
 * Le canevas d'objectifs de `CRM-083`, chargé à la demande pour la même raison que les surfaces
 * d'administration : il emporte le tracé SVG du diagramme, que les sessions qui n'ouvrent jamais
 * un tableau n'ont pas à télécharger (`CLAUDE.md` §21).
 */
const CanevasObjectifs = lazy(async () => ({
	default: (await import('./Objectifs')).CanevasObjectifs,
}))
/** L'administration du catalogue de `CRM-030`, chargée à la demande pour la même raison. */
const AdministrationCatalogue = lazy(async () => ({
	default: (await import('./AdministrationCatalogue')).AdministrationCatalogue,
}))
/** L'écran d'état de la messagerie de `CRM-059`, chargé à la demande pour la même raison. */
const EtatMessagerie = lazy(async () => ({
	default: (await import('./EtatMessagerie')).EtatMessagerie,
}))
/** La corbeille de `CRM-077`, chargée à la demande pour la même raison que les trois autres. */
const Corbeille = lazy(async () => ({ default: (await import('./Corbeille')).Corbeille }))
/**
 * Le guide de démarrage de `CRM-079`. Il n'est PAS chargé à la demande, contrairement aux quatre
 * surfaces d'administration : `AccueilDemarrage` le rend déjà sur `/`, la toute première route
 * ouverte après la connexion. Le différer ferait télécharger un second paquet pour du code que le
 * paquet principal contient de toute façon.
 */
const RouteCard = lazy(async () => ({ default: (await import('./RouteCard')).RouteCard }))
/**
 * L'écran de coûts d'un track — `CRM-086`, `docs/SPEC-costs.md` §4.2. Chargé à la demande pour le
 * motif exact des surfaces d'administration et du canevas d'objectifs : il emporte l'histogramme,
 * que les sessions qui n'ouvrent jamais les coûts n'ont pas à télécharger (`CLAUDE.md` §21).
 *
 * Il porte sa PROPRE coquille, comme `RouteTrack` et `RouteCard` : son titre est le nom du track,
 * donc une donnée, et sa barre d'onglets dépend du chargement des channels.
 */
const CoutsTrack = lazy(async () => ({ default: (await import('./CoutsTrack')).CoutsTrack }))
/**
 * La fiche d'organisation de `CRM-060` tranche 4b, chargée à la demande comme le carnet dont elle
 * prolonge la lecture — même motif : un écran que la plupart des sessions n'ouvrent pas n'a pas à
 * peser sur le premier rendu de toutes les autres (`CLAUDE.md` §21).
 *
 * Elle porte sa PROPRE coquille, comme `RouteCard` : son titre est le nom de l'organisation, donc
 * une donnée (docs/SPEC-contacts.md §11.2).
 */
const FicheOrganisation = lazy(async () => ({
	default: (await import('./FicheOrganisation')).FicheOrganisation,
}))

/**
 * La fiche d'un contact — `CRM-060` tranche 4f.
 *
 * Elle porte sa PROPRE coquille, comme `FicheOrganisation` : son titre est le nom du contact, donc
 * une donnée (docs/SPEC-contacts.md §15.2).
 */
const FicheContact = lazy(async () => ({
	default: (await import('./FicheContact')).FicheContact,
}))

/** État bref mais explicite pendant le téléchargement d'une route métier. */
export function ChargementRoute() {
	return (
		<main className="min-h-dvh bg-bg px-4 py-6">
			<SkeletonListe lignes={6} libelle={t('state.loading.aria')} className="max-w-[960px] mx-auto" />
		</main>
	)
}

export function App() {
	return (
		<BrowserRouter>
			<FournisseurAuthentification>
				<RoutesApplication />
			</FournisseurAuthentification>
		</BrowserRouter>
	)
}

function RoutesApplication() {
	const { etat } = useAuthentification()
	if (etat.statut === 'chargement') {
		return <ChargementAuthentification />
	}

	return (
		<Suspense fallback={<ChargementRoute />}>
			<Routes>
				<Route path="/connexion" element={<EcranConnexion />} />
				{ROUTES.map((route) => (
					<Route
						key={route.chemin}
						path={route.chemin}
						element={<AppShell cleTitreRoute={route.cleTitre}>{route.rendu()}</AppShell>}
					/>
				))}
				{/* Les routes d'un track portent leur propre coquille : leur titre est le nom du
				    track — une donnée — et leur barre d'onglets dépend du chargement (`CRM-021`). */}
				{CHEMINS_TRACK.map((chemin) => (
					<Route key={chemin} path={chemin} element={<RouteTrack />} />
				))}
				{/* L'écran de coûts d'un track — `CRM-086`, docs/SPEC-costs.md §4.0 et §4.2. Hors de
				    `ROUTES` : son titre est le nom du track — une donnée —, et son contenu dépend
				    d'un paramètre d'adresse. Il ne dispute rien à `/tracks/:slugTrack/:slugChannel`,
				    react-router classant ses routes par spécificité : un segment littéral l'emporte
				    sur un segment dynamique de même rang, quel que soit l'ordre de déclaration. */}
				<Route path={CHEMIN_COUTS_TRACK} element={<CoutsTrack />} />
				{/* La vue liste d'un channel — `CRM-042`. Même coquille et même résolution de track
				    que le board, dont elle n'est qu'une seconde lecture : ce qui change est la zone
				    principale, pas la route de track (docs/SPEC-cards.md §12.2). */}
				<Route path={CHEMIN_LISTE} element={<RouteTrack vue="liste" />} />
				{/* Le détail d'une card porte lui aussi sa propre coquille : son titre est celui de
				    la card, et son contenu dépend de son identifiant (`CRM-037`). Déclarée **après**
				    les routes de track, dont elle prolonge le chemin. */}
				<Route path={CHEMIN_CARD} element={<RouteCard />} />
				{/* La fiche d'organisation — `CRM-060` tranche 4b, docs/SPEC-contacts.md §11.2. Une
				    route de DÉTAIL sous le carnet, hors de `ROUTES` : son titre est le nom de
				    l'organisation — une donnée —, et son contenu dépend d'un paramètre d'URL.
				    Déclarée APRÈS la route du carnet, dont elle prolonge le chemin. */}
				<Route path={CHEMIN_ORGANISATION} element={<FicheOrganisation />} />
				{/* La fiche d'un contact — `CRM-060` tranche 4f, docs/SPEC-contacts.md §15.2. Elle
				    est déclarée APRÈS celle de l'organisation, mais l'ordre ne la départage pas :
				    ce patron porte DEUX segments là où celui de l'organisation en porte TROIS, et
				    aucune adresse ne peut satisfaire les deux. Hors de `ROUTES` : son titre est le
				    nom du contact — une donnée —, et son contenu dépend d'un paramètre d'URL. */}
				<Route path={CHEMIN_CONTACT} element={<FicheContact />} />
				{/* Le canevas d'un tableau d'objectifs — `CRM-083`, docs/SPEC-goals.md §5.2. Hors
				    de `ROUTES` : son titre est le nom du tableau — une donnée —, et son contenu
				    dépend d'un paramètre d'URL. Déclarée APRÈS la liste, dont elle prolonge le
				    chemin. */}
				<Route
					path={CHEMIN_OBJECTIFS_TABLEAU}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_OBJECTIFS}>
							<CanevasObjectifs />
						</AppShell>
					}
				/>
				{/* L'administration de l'arborescence — `CRM-075`. Elle porte la coquille commune et
				    son titre est une clé de traduction, mais elle n'est pas une entrée de la barre
				    latérale : on y arrive par l'index des réglages
				    (docs/SPEC-administration-arborescence.md §3.1). */}
				<Route
					path={CHEMIN_ADMIN_ARBORESCENCE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ADMIN_ARBORESCENCE}>
							<AdministrationArborescence />
						</AppShell>
					}
				/>
				{/* L'éditeur de workflows — `CRM-076`. Même position que l'administration de
				    l'arborescence : hors de la barre latérale, atteint depuis l'index des
				    réglages (docs/SPEC-workflow-engine.md §7 bis.2). */}
				<Route
					path={CHEMIN_ADMIN_WORKFLOWS}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ADMIN_WORKFLOWS}>
							<AdministrationWorkflows />
						</AppShell>
					}
				/>
				{/* L'administration du catalogue de nœuds — `CRM-030`. Même position que les
				    autres surfaces d'administration : hors de la barre latérale, atteinte depuis
				    l'index des réglages (docs/SPEC-workflow-engine.md §2 bis.2). */}
				<Route
					path={CHEMIN_ADMIN_CATALOGUE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ADMIN_CATALOGUE}>
							<AdministrationCatalogue />
						</AppShell>
					}
				/>
				{/* L'écran d'état de la messagerie — `CRM-059`. Même position que l'administration
				    de l'arborescence : hors de la barre latérale, atteint depuis l'index des
				    réglages (docs/SPEC-mail-subsystem.md §20.11.1). */}
				<Route
					path={CHEMIN_ETAT_MESSAGERIE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ETAT_MESSAGERIE}>
							<EtatMessagerie />
						</AppShell>
					}
				/>
				{/* La corbeille — `CRM-077`. Même position que les trois autres surfaces
				    d'administration : hors de la barre latérale, atteinte depuis l'index des
				    réglages (docs/SPEC-corbeille.md §4.1). */}
				<Route
					path={CHEMIN_CORBEILLE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_CORBEILLE}>
							<Corbeille />
						</AppShell>
					}
				/>
				{/* Le guide de démarrage — `CRM-079`, docs/SPEC-onboarding.md §4.1. Il est TOUJOURS
				    rendu ici, même intégralement accompli et même masqué pour la session : c'est ce
				    qui le rend relançable. */}
				<Route
					path={CHEMIN_DEMARRAGE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_DEMARRAGE}>
							<GuideDemarrage />
						</AppShell>
					}
				/>
				<Route
					path="*"
					element={
						<AppShell cleTitreRoute={CLE_TITRE_INTROUVABLE}>
							<PageIntrouvable />
						</AppShell>
					}
				/>
			</Routes>
		</Suspense>
	)
}
