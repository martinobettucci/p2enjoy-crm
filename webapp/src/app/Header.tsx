// @spec CRM-007 (docs/BACKLOG.md) — en-tête de la coquille
// @spec CRM-009 (docs/BACKLOG.md) — identité de session, connexion et déconnexion
// @spec CRM-022 (docs/BACKLOG.md) — nom et avatar du profil courant
// @spec docs/DESIGN_SYSTEM.md §4 (en-tête), §5.12 (session), §7, §8
// @spec docs/SPEC-webapp.md §5.1 ; docs/SPEC-auth.md §9.1, §9.4
// @spec docs/SPEC-identite.md §7 (identité d'en-tête)
//
// L'en-tête porte le fil d'Ariane et, sous 1024 px, l'ouverture du tiroir de navigation.
// La recherche annoncée par docs/DESIGN_SYSTEM.md §4 n'est pas livrée : aucun moteur ne la porte.
// L'identité de session, elle, vient de GoTrue depuis CRM-009 et offre toujours son action réelle.

import { LogIn, LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { t } from '../i18n'
import { Avatar } from '../components/ui/Avatar'
import { SkeletonListe } from '../components/ui/Skeleton'
import type { EtatAsync } from '../lib/async'
import type { Workspace } from '../lib/workspaces'
import { useAuthentification } from './Authentification'

export type ProprietesHeader = {
	readonly titreRoute: string
	readonly onOuvrirTiroir: () => void
	readonly etatWorkspaces: EtatAsync<readonly Workspace[]>
}

export function Header({ titreRoute, onOuvrirTiroir, etatWorkspaces }: ProprietesHeader) {
	return (
		<header
			aria-label={t('header.aria')}
			data-testid="entete"
			className="flex items-center gap-3 px-4 py-3 bg-surface border-b border-border"
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
			<nav aria-label={t('header.breadcrumb.aria')} className="min-w-0 flex-1">
				<ol className="flex items-center gap-2 min-w-0">
					<li className="hidden md:inline shrink-0 text-text-3 text-sm">{t('app.name')}</li>
					<li aria-hidden="true" className="hidden md:inline shrink-0 text-text-3">
						/
					</li>
					<li className="min-w-0">
						<h1 className="text-h2 truncate" title={titreRoute}>
							{titreRoute}
						</h1>
					</li>
				</ol>
			</nav>

			<ContexteWorkspace etat={etatWorkspaces} />
			<ControleSession />
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
