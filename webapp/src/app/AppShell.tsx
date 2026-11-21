// @spec CRM-161 (docs/BACKLOG.md) tranche T2.b — la bascule d'espace annoncée (docs/DESIGN_SYSTEM.md §5.113)
// @spec CRM-161 (docs/BACKLOG.md) tranche T2.c — changer d'espace remonte le contenu de la page (clé sur l'espace) ; docs/SPEC-espace-courant.md §15.4 bis
// @spec CRM-007 (docs/BACKLOG.md) — coquille de l'application
// @spec docs/DESIGN_SYSTEM.md §4 (architecture des écrans), §5.8 (états), §7, §8
// @spec docs/SPEC-webapp.md §5.1 (coquille), §7 (états), §9 (accessibilité), §11 (stockage)
// @spec CRM-161 (docs/BACKLOG.md) tranche T2.c — la page ne se monte qu'une fois les espaces lus, sous un squelette
//       (docs/SPEC-espace-courant.md §15.4 bis, décision 974 ; docs/DESIGN_SYSTEM.md §5.8)
// @spec CRM-157 (docs/BACKLOG.md) tranche T3 — `espaceLu` : le guide n'affirme rien de la messagerie tant que les espaces se
//       lisent (docs/SPEC-onboarding.md §11.1)
// @spec CRM-154 (docs/BACKLOG.md) tranche T4 — l'identifiant du track ouvert et la relecture, passés à la barre d'onglets
//       (docs/SPEC-administration-arborescence.md §15.4)
// @spec CRM-131 (docs/BACKLOG.md) — la mesure des channels lisibles, émise hors d'un track pour la barre d'onglets
//       (docs/SPEC-channels.md §5.5 ; docs/DESIGN_SYSTEM.md §4 ; décision 868)
// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — l'espace courant tiré de l'adresse ou de l'onglet, la barre latérale sur
//       cet espace, « Espace introuvable » (docs/SPEC-espace-courant.md §8.3, §15.2)
// @spec CRM-094 (docs/BACKLOG.md) tranches T2 et T3 — l'espace courant et son rôle rendus par un contexte,
//       et le guide flottant monté au bas de la zone principale (docs/SPEC-onboarding.md §10.2,
//       docs/DESIGN_SYSTEM.md §5.49)
// @spec CRM-101 (docs/BACKLOG.md) tranche T3 — le drapeau superadministrateur lu une fois, pour l'entrée « Plateforme »
//       (docs/SPEC-plateforme.md §7.1, docs/DESIGN_SYSTEM.md §5.56)
// @spec INC-254, décision 608 — docs/SPEC-webapp.md §6.3 bis : la barre latérale relit ses tracks au
//       signal des écritures de l'arborescence, sans squelette ; docs/DESIGN_SYSTEM.md §5.13
// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — la route passe ses ancêtres, la coquille y ajoute le workspace
//       (docs/SPEC-webapp.md §5.1 bis, règle 5)
//
// La coquille assemble les points de repère sémantiques exigés par docs/DESIGN_SYSTEM.md §8 —
// `aside`, `nav`, `header`, `main` — et décide, à un seul endroit, lequel des états de
// docs/DESIGN_SYSTEM.md §5.8 occupe la zone principale.
//
// Ce choix est centralisé parce qu'il doit être **exhaustif** : le type somme `EtatAsync`
// oblige à traiter chaque cas, et le traiter une seule fois évite qu'une route en oublie un.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkipLink } from '../components/ui/SkipLink'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatConfiguration, EtatErreur, EtatRefus } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { clientCrm } from '../lib/supabase'
import type { Channel } from '../lib/channels'
import { useMesureChannels } from '../lib/demarrage'
import type { NiveauAriane } from '../lib/fil-ariane'
import { useEstSuperadmin } from '../lib/plateforme'
import { estAdministrateur, useRoleWorkspace } from '../lib/roles'
import { useCapacitesEspace } from '../lib/capacites'
import { useApresTracksModifies, useTracks } from '../lib/tracks'
import { useWorkspaces } from '../lib/workspaces'
import { choisirEspace, constaterEspace } from '../lib/espace-onglet'
import { cheminEspace } from './chemins'
import { useAuthentification } from './Authentification'
import { FournisseurEspace } from './ContexteEspace'
import { GuideFlottant } from './GuideFlottant'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { useReplisidebar } from './preferences'

const ID_CONTENU = 'contenu-principal'
const AUCUN_ANCETRE: readonly NiveauAriane[] = []

export type ProprietesAppShell = {
	readonly cleTitreRoute: CleTraduction
	/**
	 * Titre affiché à la place du libellé traduit — `CRM-021`. Le nom d'un track est une
	 * **donnée**, pas une traduction (`docs/DESIGN_SYSTEM.md` §10) : il ne peut donc pas passer
	 * par une clé. La clé reste exigée comme repli, pour que l'en-tête ne soit jamais sans titre
	 * pendant le chargement ou lorsque le track est introuvable.
	 */
	readonly titreRoute?: string
	/**
	 * Les niveaux du fil d'Ariane entre le workspace et le titre — `CRM-110`. Absents hors d'une route de track : le
	 * fil y est alors `Workspace / titre` (docs/SPEC-webapp.md §5.1 bis).
	 */
	readonly ancetres?: readonly NiveauAriane[]
	/**
	 * Channels du track courant, pour la barre d'onglets — `CRM-021`. Absent hors d'une route de
	 * track : la barre affiche alors son état vide, comme depuis `CRM-007`.
	 */
	readonly etatChannels?: EtatAsync<readonly Channel[]>
	/**
	 * `CRM-134` — les archivés du track courant, lus avec ses onglets, pour le groupe « Archivés » de la barre
	 * (docs/SPEC-channels.md §11.3). Absents hors d'une route de track.
	 */
	readonly archivesChannels?: readonly Channel[]
	readonly onRechargerChannels?: () => void
	/** Slug du track porteur, pour construire l'adresse de chaque onglet. */
	readonly slugTrack?: string
	readonly children: ReactNode
}

export function AppShell({
	cleTitreRoute,
	titreRoute,
	ancetres = AUCUN_ANCETRE,
	etatChannels,
	archivesChannels,
	onRechargerChannels,
	slugTrack,
	children,
}: ProprietesAppShell) {
	const { replie, basculer } = useReplisidebar()
	const [tiroirOuvert, setTiroirOuvert] = useState(false)
	// Deux chargements indépendants depuis `CRM-020` : le contexte d'espace de travail, porté par
	// l'en-tête, et les tracks, portés par la barre latérale. Ils échouent séparément, et la zone
	// principale décide en les regardant **tous les deux** (voir `ZonePrincipale`).
	const { etat, recharger } = useWorkspaces(clientCrm)
	// `CRM-161` T2.a (docs/SPEC-espace-courant.md §15.2) : l'espace courant est celui de l'ADRESSE sur une page d'un espace,
	// le dernier de l'ONGLET sur une page globale, sinon le premier par nom. Un slug d'adresse qui ne nomme aucun espace lu
	// rend « Espace introuvable » (§8.3).
	const { slugEspace: slugAdresse } = useParams()
	const espaceChoisi = etat.statut === 'pret' ? choisirEspace(etat.donnees, slugAdresse) : null
	const espaceCourant = espaceChoisi?.genre === 'espace' ? espaceChoisi.espace : null
	// `CRM-161` T2.b (docs/DESIGN_SYSTEM.md §5.113) : la coquille constate l'espace qu'elle montre ; une bascule — par le menu,
	// ou par un lien d'un autre espace — est dite dans la région polie, sans bandeau.
	const [annonceBascule, setAnnonceBascule] = useState('')
	// `CRM-161` T2.c : la génération du contenu, qui ne change que d'un espace connu à un autre.
	const [generationEspace, setGenerationEspace] = useState(0)
	const slugPrecedent = useRef<string | null>(null)
	useEffect(() => {
		if (espaceCourant === null) return
		if (constaterEspace(espaceCourant.slug)) setAnnonceBascule(t('espace.bascule', { espace: espaceCourant.name }))
	}, [espaceCourant])
	// Les tracks attendent l'espace ; sans espace lisible (aucun, ou une lecture des espaces en échec), la barre lit sans
	// filtre, et la RLS rend ce qu'elle rendait — l'état vide ou l'erreur restent dits comme avant.
	const idEspaceDesTracks =
		espaceCourant?.id ?? (espaceChoisi?.genre === 'introuvable' ? (espaceChoisi.premier?.id ?? undefined) : undefined)
	const { etat: etatTracks, recharger: rechargerTracks, relire: relireTracks } = useTracks(
		clientCrm,
		etat.statut === 'chargement' ? null : idEspaceDesTracks,
	)
	// INC-254 (docs/SPEC-webapp.md §6.3 bis) : les routes de réglages rendent cette coquille au même
	// endroit, et React la GARDE d'une page à l'autre ; ses tracks, lus au montage, ne suivraient pas un
	// track créé sur l'arborescence. Le signal les fait relire, sans squelette.
	useApresTracksModifies(relireTracks)
	// L'espace courant est le premier rendu — patron de `Carnet` et `Objectifs` —, et son rôle est
	// celui que la base applique (`mon_role_espace`). Tenus ici une fois, rendus par le contexte au
	// guide et à sa pastille (docs/SPEC-onboarding.md §10.2) ; ils décident d'un affichage, jamais
	// d'un droit.
	const { etat: etatSession } = useAuthentification()
	const idUtilisateur = etatSession.statut === 'authentifie' ? etatSession.utilisateur.id : null
	const idWorkspace = espaceCourant?.id ?? null
	const { etat: etatRole } = useRoleWorkspace(clientCrm, idWorkspace, idUtilisateur)
	const estAdmin = estAdministrateur(etatRole)
	// `CRM-093` — les capacités de l'espace, lues sur sa ligne (docs/SPEC-droits-interface.md §2.2) : une requête à
	// part, pour qu'un défaut de lecture ne fasse jamais tomber la coquille, seulement l'aide d'interface.
	const capacites = useCapacitesEspace(clientCrm, idWorkspace)
	// `CRM-157` : tant que les espaces se lisent, `idWorkspace` nul ne veut pas dire « aucun espace » — le guide attend.
	const espaceLu = etat.statut !== 'chargement'
	const espaces = etat.statut === 'pret' ? etat.donnees : undefined
	const slugCourant = espaceCourant?.slug ?? null
	useEffect(() => {
		if (slugCourant === null) return
		if (slugPrecedent.current !== null && slugPrecedent.current !== slugCourant) setGenerationEspace((g) => g + 1)
		slugPrecedent.current = slugCourant
	}, [slugCourant])
	const contexteEspace = useMemo(
		() => ({ idWorkspace, estAdmin, capacites, espaceLu, slugEspace: slugCourant, ...(espaces === undefined ? {} : { espaces }) }),
		[idWorkspace, estAdmin, capacites, espaceLu, slugCourant, espaces],
	)
	// `CRM-101` — l'entrée « Plateforme » n'est rendue que si la base le dit (docs/DESIGN_SYSTEM.md §5.56) ;
	// pendant la lecture et en cas d'échec, elle est absente.
	const etatSuperadmin = useEstSuperadmin(clientCrm, idUtilisateur)
	const plateforme = etatSuperadmin.statut === 'pret' && etatSuperadmin.donnees
	// `CRM-131` — hors d'un track, avec une session, la barre dit si la personne lit des channels : la mesure de
	// l'accueil, émise ici seulement (docs/SPEC-channels.md §5.5). Sans session, aucune mesure, et la barre garde
	// « Aucun channel ».
	const sessionOuverte = etatSession.statut === 'authentifie'
	// `CRM-154` (docs/SPEC-administration-arborescence.md §15.4) : l'identifiant du track ouvert, pris dans les tracks
	// que la coquille lit déjà pour la barre latérale — la réorganisation et « Réorganiser » en ont besoin.
	const idTrackOuvert =
		slugTrack !== undefined && etatTracks.statut === 'pret'
			? etatTracks.donnees.find((track) => track.slug === slugTrack)?.id
			: undefined
	const presenceHorsTrack = useMesureChannels(slugTrack === undefined && sessionOuverte ? clientCrm : null)

	const toutRecharger = useCallback(() => {
		recharger()
		rechargerTracks()
		onRechargerChannels?.()
	}, [recharger, rechargerTracks, onRechargerChannels])

	const fermerTiroir = useCallback(() => setTiroirOuvert(false), [])
	const ouvrirTiroir = useCallback(() => setTiroirOuvert(true), [])

	// Échapper referme le tiroir : une surface qui recouvre l'écran doit toujours pouvoir se
	// refermer au clavier (docs/DESIGN_SYSTEM.md §8).
	useEffect(() => {
		if (!tiroirOuvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key === 'Escape') setTiroirOuvert(false)
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [tiroirOuvert])

	// La région polie annonce ce que l'utilisateur voit réellement changer : le contexte d'espace
	// de travail **et** le contenu de la barre latérale, qui liste les tracks depuis `CRM-020`.
	// N'annoncer que le premier laisserait le second changer en silence (docs/DESIGN_SYSTEM.md §8).
	//
	// Les deux annonces sont concaténées plutôt que mises en concurrence : une région `aria-live`
	// unique n'en relaie qu'une à la fois, et supprimer la seconde reviendrait à choisir laquelle
	// des deux informations l'utilisateur n'aura pas.
	const annonce = useMemo(() => {
		if (clientCrm === null) return ''
		const parts: string[] = []
		if (etat.statut === 'erreur') parts.push(t('live.workspaces.error'))
		else if (etat.statut === 'pret')
			parts.push(etat.donnees.length === 0 ? t('live.workspaces.empty') : t('live.workspaces.loaded'))
		if (etatTracks.statut === 'erreur') parts.push(t('live.tracks.error'))
		else if (etatTracks.statut === 'pret')
			parts.push(etatTracks.donnees.length === 0 ? t('live.tracks.empty') : t('live.tracks.loaded'))
		if (annonceBascule !== '') parts.push(annonceBascule)
		return parts.join(' ')
	}, [etat, etatTracks, annonceBascule])

	const coquille = (
		<div className="min-h-dvh flex flex-col">
			<SkipLink cible={ID_CONTENU} libelle={t('skip.toContent')} />
			<LiveRegion libelle={t('live.aria')} message={annonce} />

			<div className="flex flex-1 min-h-0">
				{/* Voile du tiroir : présent uniquement sous le palier « colonne », et
				    volontairement non focusable — la fermeture au clavier passe par Échap. */}
				{tiroirOuvert ? (
					<div
						aria-hidden="true"
						data-testid="voile-tiroir"
						onClick={fermerTiroir}
						className="fixed inset-0 z-30 bg-veil lg:hidden"
					/>
				) : null}

				<Sidebar
					replie={replie}
					onBasculerRepli={basculer}
					tiroirOuvert={tiroirOuvert}
					onFermerTiroir={fermerTiroir}
					etatTracks={etatTracks}
					plateforme={plateforme}
				/>

				<div className="flex flex-col flex-1 min-w-0">
					<Header
						titreRoute={titreRoute ?? t(cleTitreRoute)}
						ancetres={ancetres}
						onOuvrirTiroir={ouvrirTiroir}
						etatWorkspaces={etat}
					/>
					<TabBar
						etat={etatChannels}
						slugTrack={slugTrack}
						{...(archivesChannels === undefined ? {} : { archives: archivesChannels })}
						{...(slugTrack === undefined && sessionOuverte ? { presenceHorsTrack } : {})}
						{...(idTrackOuvert === undefined ? {} : { idTrack: idTrackOuvert })}
						{...(onRechargerChannels === undefined ? {} : { onRelire: onRechargerChannels })}
					/>
					<main id={ID_CONTENU} tabIndex={-1} className="flex-1 min-w-0 p-4 overflow-x-auto">
						{/* Le chargement des channels rejoint les deux autres : un échec ne doit pas
						    être avalé par une barre d'onglets qui n'a pas la place de l'expliquer,
						    exactement comme pour les tracks à `CRM-020`. */}
						{espaceChoisi?.genre === 'introuvable' ? (
							<EspaceIntrouvable premier={espaceChoisi.premier?.slug ?? null} />
						) : (
						<ZonePrincipale
							espacesLus={espaceLu}
							etats={
								etatChannels === undefined
									? [etat, etatTracks]
									: [etat, etatTracks, etatChannels]
							}
							recharger={toutRecharger}
							// `CRM-161` T2.c (docs/SPEC-espace-courant.md §15.4 bis) : changer d'espace REMONTE le contenu de la page —
							// aucun état, aucune liste lue d'un espace ne survit dans un autre. La clé ne change qu'à un VRAI
							// changement d'espace : un remontage au premier affichage perdait ce que la page avait déjà consommé
							// de son adresse (l'inbox et son `?message=`, retiré dès la lecture).
							contenu={<Fragment key={generationEspace}>{children}</Fragment>}
						/>
						)}
						<GuideFlottant />
					</main>
				</div>
			</div>
		</div>
	)

	return <FournisseurEspace valeur={contexteEspace}>{coquille}</FournisseurEspace>
}

/**
 * Décide ce qu'affiche la zone principale. L'ordre des cas est celui de leur gravité : une
 * configuration absente rend tout le reste indécidable, un refus est définitif là où une panne
 * de transport se retente.
 *
 * Depuis `CRM-020`, la décision porte sur **plusieurs** chargements. Aucun échec ne doit être
 * avalé : la barre latérale n'a pas la place d'expliquer une erreur, et si l'un des chargements
 * échoue sans que rien ne le dise, l'écran affiche un vide qui n'en est pas un — exactement la
 * valeur par défaut trompeuse que `CLAUDE.md` §18 interdit. Le premier échec rencontré occupe
 * donc la zone principale, et la reprise les relance **tous**.
 */
function ZonePrincipale({
	espacesLus,
	etats,
	recharger,
	contenu,
}: {
	/** `CRM-161` T2.c (décision 974) : faux tant que la coquille lit les espaces — la page attend alors. */
	readonly espacesLus: boolean
	readonly etats: readonly EtatAsync<unknown>[]
	readonly recharger: () => void
	readonly contenu: ReactNode
}) {
	if (clientCrm === null) {
		return (
			<EtatConfiguration
				titre={t('config.error.title')}
				corps={t('config.error.body')}
				detail={t('config.error.detail')}
			/>
		)
	}

	// Prédicat de type explicite : `filter` seul ne restreint pas le type somme, et le
	// compilateur refuserait ensuite l'accès à `erreur`.
	const estEnErreur = (
		etat: EtatAsync<unknown>,
	): etat is Extract<EtatAsync<unknown>, { statut: 'erreur' }> => etat.statut === 'erreur'

	const echecs = etats.filter(estEnErreur)
	// Un refus l'emporte sur une panne : il est définitif, tandis qu'une panne se retente. Les
	// présenter dans l'ordre inverse proposerait un bouton « Réessayer » à qui n'a pas les droits.
	const refus = echecs.find((etat) => etat.erreur.nature === 'forbidden')
	if (refus !== undefined) {
		return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
	}
	const panne = echecs[0]
	if (panne !== undefined) {
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={
					panne.erreur.nature === 'network' ? t('state.error.network') : t('state.error.unknown')
				}
				libelleReprise={t('state.error.retry')}
				onReprise={recharger}
			/>
		)
	}
	// `CRM-161` T2.c (docs/SPEC-espace-courant.md §15.4 bis, décision 974) : la page ne se monte qu'une fois les ESPACES
	// lus. Montée plus tôt, elle partait avec un espace nul, et chacune de ses lectures sans filtre d'espace : sous la RLS,
	// tous les espaces de la personne — Réglages ▸ Workflows y choisissait le défaut d'un autre espace, et ne relisait
	// jamais. Entre-temps, un squelette (§5.8), jamais un écran blanc.
	if (!espacesLus) {
		return <SkeletonListe lignes={6} libelle={t('state.loading.aria')} className="max-w-[960px]" />
	}
	// Une fois les espaces lus, `chargement` comme `pret` des tracks et des channels laissent la route rendre son propre
	// contenu : la coquille n'a pas à décider à sa place, et leurs squelettes vivent là où la donnée est attendue — barre
	// latérale et en-tête.
	return <>{contenu}</>
}

/**
 * `CRM-161` T2.a (docs/SPEC-espace-courant.md §8.3) : le slug de l'adresse ne nomme aucun espace que la personne lit. L'écran
 * ne dit jamais si l'espace existe ; il propose le premier espace par nom.
 */
function EspaceIntrouvable({ premier }: { readonly premier: string | null }) {
	return (
		<div data-testid="espace-introuvable" className="flex flex-col items-start gap-3 max-w-prose">
			<h2 className="text-h3 font-bold text-ink">{t('espace.introuvable.titre')}</h2>
			<p className="text-sm text-text-2">{t('espace.introuvable.corps')}</p>
			{premier === null ? null : (
				<Link to={cheminEspace(premier, '/inbox')} className="text-sm text-brand font-medium hover:underline">
					{t('espace.introuvable.lien')}
				</Link>
			)}
		</div>
	)
}
