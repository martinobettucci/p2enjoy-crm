// @spec CRM-007 (docs/BACKLOG.md) — en-tête de la coquille
// @spec CRM-009 (docs/BACKLOG.md) — identité de session, connexion et déconnexion
// @spec CRM-022 (docs/BACKLOG.md) — nom et avatar du profil courant
// @spec CRM-064 (docs/BACKLOG.md) — tranche 3a : la cloche de notifications, entre le contexte
//       d'espace de travail et l'identité de session (docs/DESIGN_SYSTEM.md §5.43)
// @spec CRM-065 (docs/BACKLOG.md) — sous-tranche 2b : la palette de recherche, entre le fil
//       d'Ariane et le contexte (docs/DESIGN_SYSTEM.md §5.46, docs/SPEC-recherche.md §12.1)
// @spec docs/DESIGN_SYSTEM.md §4 (en-tête), §5.12 (session), §7, §8
// @spec docs/SPEC-webapp.md §5.1 ; docs/SPEC-auth.md §9.1, §9.4
// @spec docs/SPEC-identite.md §7 (identité d'en-tête)
//
// L'en-tête porte le fil d'Ariane et, sous 1024 px, l'ouverture du tiroir de navigation.
//
// LA RECHERCHE ANNONCÉE PAR docs/DESIGN_SYSTEM.md §4 EST LIVRÉE — `CRM-065` sous-tranche 2b. Ce
// commentaire écrivait « n'est pas livrée : aucun moteur ne la porte », et le motif est tombé PAR
// LIVRAISON : la tranche 1 a posé `public.recherche_globale`, la sous-tranche 2a le moteur d'appel.
//
// L'identité de session, elle, vient de GoTrue depuis CRM-009 et offre toujours son action réelle.

import { LogIn, LogOut, Menu } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { t } from '../i18n'
import { Avatar } from '../components/ui/Avatar'
import { SkeletonListe } from '../components/ui/Skeleton'
import type { EtatAsync } from '../lib/async'
import type { Workspace } from '../lib/workspaces'
import { useAuthentification } from './Authentification'
import { ClocheNotifications } from './Notifications'
import { PaletteRecherche } from './PaletteRecherche'

export type ProprietesHeader = {
	readonly titreRoute: string
	readonly onOuvrirTiroir: () => void
	readonly etatWorkspaces: EtatAsync<readonly Workspace[]>
}

export function Header({ titreRoute, onOuvrirTiroir, etatWorkspaces }: ProprietesHeader) {
	// LE FIL D'ARIANE CÈDE SOUS `lg` PENDANT QUE LA RECHERCHE EST OUVERTE (docs/DESIGN_SYSTEM.md
	// §5.46 et §12.2), et c'est un DÉBORDEMENT MESURÉ à 390 px, non une préférence : avec le champ
	// ouvert, l'identité de session sortait du cadre et la page défilait horizontalement (§7).
	//
	// CE N'EST PAS UNE ENTORSE À L'ORDRE DE SACRIFICE DU §12.2, qui régit l'en-tête AU REPOS : le
	// titre y reste inconditionnel. Ici la recherche est une surface que l'utilisateur vient
	// D'OUVRIR et qu'`Échap` referme — la fermeture EST le point d'accès que le §7 exige.
	const [rechercheOuverte, setRechercheOuverte] = useState(false)
	const surOuvertureRecherche = useCallback((ouvert: boolean) => setRechercheOuverte(ouvert), [])

	return (
		<header
			aria-label={t('header.aria')}
			data-testid="entete"
			// `relative` PORTE LE PANNEAU DE NOTIFICATIONS (`CRM-064`), qui s'ancre sur
			// l'en-tête et non sur la cloche : ancré sur elle, il sortait de l'écran par la
			// gauche à 390 px — défaut trouvé en regardant une capture (`CLAUDE.md` §16).
			className="relative flex items-center gap-3 px-4 py-3 bg-surface border-b border-border"
		>
			<button
				type="button"
				onClick={onOuvrirTiroir}
				data-testid="ouvrir-tiroir"
				title={t('nav.sidebar.open')}
				className={[
					'inline-flex lg:hidden items-center justify-center shrink-0',
					'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
					'transition-colors duration-[var(--transition-duration-fast)]',
				].join(' ')}
			>
				<Menu aria-hidden="true" size={20} />
				<span className="sr-only">{t('nav.sidebar.open')}</span>
			</button>

			{/* Ordre de sacrifice sous les petits paliers : ce qui disparaît en premier est le
			    plus redondant. Le nom du produit est déjà porté par la barre latérale et
			    l'onglet du navigateur ; le titre de la route, lui, ne se déduit de rien —
			    il reste donc visible partout (docs/DESIGN_SYSTEM.md §7 : aucun contenu masqué
			    sans point d'accès). Mesuré à 390 px avant correction : le titre disparaissait
			    au profit du contexte, ce que la capture a montré. */}
			<nav
				aria-label={t('header.breadcrumb.aria')}
				className={[rechercheOuverte ? 'hidden lg:block' : 'block', 'min-w-0 flex-1'].join(' ')}
			>
				<ol className="flex items-center gap-2 min-w-0">
					{/* `lg` ET NON `md` DEPUIS `CRM-065`, ET LE MOTIF EST ÉTABLI PAR COMPARAISON À LA
					    LIGNE DE BASE (`CLAUDE.md` §16, `docs/CloudWorker.md` §2.4). La capture
					    `docs/captures/CRM-076/workflows-md-900.jpg` du commit d'avant la session rend
					    « Éditeur de workflows » ENTIER ; la même capture, avec la commande de
					    recherche en place, rend « Éditeur de wor… ».

					    LA CAUSE N'EST PAS LE CHAMP — il n'apparaît qu'à partir de `lg` —, C'EST LA
					    COMMANDE À ICÔNE, quarante pixels de plus sur une ligne qui n'en avait plus.
					    Le nom du produit est `shrink-0` : il ne cède pas, et c'est donc le titre qui
					    paie. Le §12.2 l'interdit — « le titre de la route ne se déduit de rien » — et
					    l'ordre de sacrifice qu'il pose désigne le nom du produit en premier. L'ordre
					    est inchangé ; seul son SEUIL descend d'un palier, parce que la ligne a gagné
					    un occupant. */}
					<li className="hidden lg:inline shrink-0 text-text-3 text-sm">{t('app.name')}</li>
					<li aria-hidden="true" className="hidden lg:inline shrink-0 text-text-3">
						/
					</li>
					<li className="min-w-0">
						<h1 className="text-h2 truncate" title={titreRoute}>
							{titreRoute}
						</h1>
					</li>
				</ol>
			</nav>

			{/*
			  LA RECHERCHE VIT ENTRE LE FIL D'ARIANE ET LE CONTEXTE, à la place que le §4 du design
			  system lui donne depuis `CRM-000` (`CRM-065`, docs/SPEC-recherche.md §12.1). L'ordre
			  de la ligne est : fil d'Ariane, RECHERCHE, contexte, cloche, identité.

			  Elle vient AVANT la cloche et l'identité parce qu'elle porte sur le produit entier et
			  non sur l'utilisateur — le §5.43 a posé le sens de la fin de cette ligne, « ce que le
			  produit a à me dire précède qui je suis ».

			  Elle ne rend rien sans session (§14.5) : la RPC refuse l'anonyme par le PRIVILÈGE, et
			  un champ offert à un anonyme promettrait une recherche que la base refuse.
			*/}
			<PaletteRecherche onOuvertureChange={surOuvertureRecherche} />

			{/*
			  SOUS `md`, LA FIN DE LA LIGNE CÈDE PENDANT QUE LA RECHERCHE EST OUVERTE, et c'est un
			  défaut trouvé EN REGARDANT UNE CAPTURE (`CLAUDE.md` §16,
			  docs/captures/CRM-065/recherche-palette-sm-390.jpg). Le fil d'Ariane seul ne suffisait
			  pas : à 390 px, le contexte, la cloche et l'identité laissaient au champ SOIXANTE
			  pixels, où l'on ne lisait plus ce que l'on venait de taper. Un champ de recherche dont
			  la saisie est invisible n'est pas un champ de recherche.

			  C'est le patron du §5.3 quater — « le panneau remplace la commande, il ne s'y ajoute
			  pas » — appliqué à une ligne entière, et `Échap` la restaure. Le §12.2 régit l'en-tête
			  AU REPOS ; il n'est pas contredit.

			  L'ORDRE, LUI, NE CHANGE PAS (`CRM-064`, docs/SPEC-notifications.md §23.1,
			  docs/DESIGN_SYSTEM.md §5.43) : ce que le produit a à me dire précède qui je suis, et le
			  geste qui SORT du produit ferme la ligne.
			*/}
			<div
				data-testid="entete-fin"
				className={[
					rechercheOuverte ? 'hidden lg:flex' : 'flex',
					'items-center gap-3 min-w-0',
				].join(' ')}
			>
				<ContexteWorkspace etat={etatWorkspaces} />
				{/* La cloche ne rend rien sans session — l'en-tête rend « Se connecter » à sa place
				    (§5.12), et une cloche offerte à un anonyme annoncerait une boîte qu'aucune
				    session ne peut remplir. */}
				<ClocheNotifications />
				<ControleSession />
			</div>
		</header>
	)
}

function ControleSession() {
	const { etat, profilCourant, deconnecter } = useAuthentification()
	const location = useLocation()
	const navigate = useNavigate()
	const [enCours, setEnCours] = useState(false)
	const [erreur, setErreur] = useState(false)

	if (etat.statut !== 'authentifie') {
		return (
			<Link
				to="/connexion"
				state={{ retour: `${location.pathname}${location.search}` }}
				className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm text-brand font-medium hover:bg-hover"
			>
				<LogIn aria-hidden="true" size={18} />
				<span className="hidden md:inline">{t('header.auth.login')}</span>
				<span className="sr-only md:hidden">{t('header.auth.login')}</span>
			</Link>
		)
	}
	const profil =
		profilCourant.statut === 'pret' && profilCourant.donnees !== null
			? profilCourant.donnees
			: null
	const email = etat.utilisateur.email ?? ''

	return (
		<div className="flex items-center gap-2 min-w-0">
			{erreur ? (
				<span role="alert" className="text-sm text-danger-on-soft">
					{t('header.auth.logout.error')}
				</span>
			) : null}
			{profil === null ? (
				<span
					data-testid="identite-session-repli"
					className="hidden md:inline max-w-[var(--size-placeholder)] truncate text-sm text-text-2"
					title={email}
				>
					{email}
				</span>
			) : (
				<div data-testid="identite-session" className="flex items-center gap-2 min-w-0">
					<Avatar profil={profil} taille={32} decoratif />
					<span
						className="max-w-[96px] md:max-w-[var(--size-placeholder)] truncate text-sm text-text-2"
						title={email}
					>
						{profil.full_name}
					</span>
				</div>
			)}
			<button
				type="button"
				disabled={enCours}
				onClick={() => {
					if (enCours) return
					setEnCours(true)
					setErreur(false)
					void deconnecter().then((resultat) => {
						setEnCours(false)
						if (!resultat.ok) {
							setErreur(true)
							return
						}
						navigate('/connexion', { replace: true })
					})
				}}
				className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm text-brand font-medium hover:bg-hover disabled:opacity-70 disabled:cursor-not-allowed"
			>
				<LogOut aria-hidden="true" size={18} />
				<span className="hidden md:inline">{t('header.auth.logout')}</span>
				<span className="sr-only md:hidden">{t('header.auth.logout')}</span>
			</button>
		</div>
	)
}

/**
 * Nomme le contexte courant. Sans session, la RLS en refus par défaut ne rend aucune ligne :
 * l'en-tête le dit explicitement plutôt que d'afficher un espace vide dont l'utilisateur ne
 * pourrait rien conclure (docs/SPEC-webapp.md §6.3).
 */
function ContexteWorkspace({ etat }: { readonly etat: EtatAsync<readonly Workspace[]> }) {
	if (etat.statut === 'chargement') {
		return (
			<SkeletonListe
				lignes={1}
				libelle={t('header.workspace.loading')}
				className="hidden md:block w-[var(--size-placeholder)] shrink-0"
			/>
		)
	}
	if (etat.statut === 'erreur' || etat.donnees.length === 0) {
		return (
			<span
				data-testid="workspace-absent"
				className="hidden md:inline shrink-0 text-sm text-text-3 truncate"
			>
				{t('header.workspace.unknown')}
			</span>
		)
	}
	return (
		<span
			data-testid="workspace-courant"
			className="hidden md:inline shrink-0 text-sm text-text-2 truncate"
		>
			{etat.donnees[0]?.name}
		</span>
	)
}
