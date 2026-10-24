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
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §8.5 (déconnexion), §9.3 (en-tête)
// @spec CRM-092 (docs/BACKLOG.md) tranche T9, docs/SPEC-session-sso.md §8.7 — sans session, aucune coquille :
//       l'en-tête n'a plus de rendu anonyme (docs/JOURNAL.md décision 601)
// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — le fil d'Ariane nomme l'arborescence, du workspace à l'objet ouvert, et
//       absorbe le contexte d'espace de fin de ligne (docs/SPEC-webapp.md §5.1 bis ; docs/DESIGN_SYSTEM.md §5.62, §12.2)
// @spec CRM-110 — INC-293, décision 679 (option b du responsable) : entre `lg` et `xl`, le nom de la session passe en
//       `sr-only` pour que le titre de route tienne (docs/DESIGN_SYSTEM.md §12.2, §12.3, §5.12)
//
// L'en-tête porte le fil d'Ariane et, sous 1024 px, l'ouverture du tiroir de navigation.
//
// LA RECHERCHE ANNONCÉE PAR docs/DESIGN_SYSTEM.md §4 EST LIVRÉE — `CRM-065` sous-tranche 2b. Ce
// commentaire écrivait « n'est pas livrée : aucun moteur ne la porte », et le motif est tombé PAR
// LIVRAISON : la tranche 1 a posé `public.recherche_globale`, la sous-tranche 2a le moteur d'appel.
//
// L'identité de session vient de l'échangeur de session depuis `CRM-092` — plus de GoTrue — et offre
// toujours son action réelle : « Se déconnecter » ferme la session serveur (§8.5).

import { LogOut, Menu } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../i18n'
import { Avatar } from '../components/ui/Avatar'
import type { EtatAsync } from '../lib/async'
import type { NiveauAriane } from '../lib/fil-ariane'
import type { Workspace } from '../lib/workspaces'
import { useAuthentification } from './Authentification'
import { FilAriane } from './FilAriane'
import { ClocheNotifications } from './Notifications'
import { PaletteRecherche } from './PaletteRecherche'

export type ProprietesHeader = {
	readonly titreRoute: string
	/** Les niveaux entre le workspace et le titre, composés par la route (`CRM-110`, §5.1 bis). */
	readonly ancetres: readonly NiveauAriane[]
	readonly onOuvrirTiroir: () => void
	readonly etatWorkspaces: EtatAsync<readonly Workspace[]>
}

export function Header({ titreRoute, ancetres, onOuvrirTiroir, etatWorkspaces }: ProprietesHeader) {
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
			// `flex-wrap` sous `lg` : le fil d'Ariane y prend la ligne suivante, entière (`CRM-110`, décision 641).
			className="relative flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-surface border-b border-border"
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

			{/* Sous `lg`, le fil quitte cette ligne : l'espaceur pousse les commandes à droite, comme le fil le faisait.
			    Pendant la recherche ouverte, le champ prend la place libre, et l'espaceur s'efface. */}
			<div aria-hidden="true" className={rechercheOuverte ? 'hidden' : 'grow lg:hidden'} />

			{/* LE FIL NOMME L'ARBORESCENCE, DU WORKSPACE À L'OBJET OUVERT (`CRM-110`, §5.62). Il remplace le nom du
			    produit, que la barre latérale et l'onglet du navigateur portent déjà, et l'ordre de sacrifice du §12.2
			    s'y applique désormais : les ancêtres se replient, le titre de la route ne cède jamais. Sous `lg`, il
			    est rendu sur la ligne suivante (décision 641). */}
			<FilAriane
				titre={titreRoute}
				ancetres={ancetres}
				etatWorkspaces={etatWorkspaces}
				rechercheOuverte={rechercheOuverte}
			/>

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
				{/* Le contexte d'espace qui ouvrait cette fin de ligne est passé en tête du fil (`CRM-110`, §5.62).
				    Sans session, aucune coquille n'est rendue (`CRM-092` T9, §5.12). */}
				<ClocheNotifications />
				<ControleSession />
			</div>
		</header>
	)
}

function ControleSession() {
	const { etat, profilCourant, deconnecter } = useAuthentification()
	const navigate = useNavigate()
	const [enCours, setEnCours] = useState(false)
	const [erreur, setErreur] = useState(false)

	// Sans session, `ExigerSession` ne rend aucune coquille (docs/SPEC-session-sso.md §8.7) : il n'y a
	// plus de rendu anonyme à offrir ici.
	if (etat.statut !== 'authentifie') return null
	const profil =
		profilCourant.statut === 'pret' && profilCourant.donnees !== null
			? profilCourant.donnees
			: null
	const email = etat.utilisateur.email

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
				// ENTRE `lg` ET `xl`, LE NOM CÈDE SA PLACE AU TITRE DE ROUTE (INC-293, décision 679, docs/DESIGN_SYSTEM.md
				// §12.2) : sur une seule ligne, le fil, le champ de recherche, la cloche et l'identité laissaient 105 px au
				// titre long d'une affaire à 1152 px. Le nom passe en `sr-only` — masqué, jamais retiré (§12.3) —, l'avatar
				// reste, et l'adresse reste en infobulle sur l'identité entière.
				<div data-testid="identite-session" className="flex items-center gap-2 min-w-0" title={email}>
					<Avatar profil={profil} taille={32} decoratif />
					<span className="max-w-[96px] md:max-w-[var(--size-placeholder)] truncate text-sm text-text-2 lg:sr-only xl:not-sr-only">
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
