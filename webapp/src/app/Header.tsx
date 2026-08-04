// @spec CRM-007 (docs/BACKLOG.md) — en-tête de la coquille
// @spec docs/DESIGN_SYSTEM.md §4 (en-tête : fil d'Ariane), §7 (tiroir sous 1024 px), §8
// @spec docs/SPEC-webapp.md §5.1 (coquille), §8 (responsive)
//
// L'en-tête porte le fil d'Ariane et, sous 1024 px, l'ouverture du tiroir de navigation.
// La recherche et le profil annoncés par docs/DESIGN_SYSTEM.md §4 ne sont pas livrés ici :
// la recherche n'a rien à interroger et le profil suppose une session, que cette unité ne
// livre pas (INC-021). Les placer en décor, inertes, serait afficher une commande morte.

import { Menu } from 'lucide-react'
import { t } from '../i18n'
import { SkeletonListe } from '../components/ui/Skeleton'
import type { EtatAsync } from '../lib/async'
import type { Workspace } from '../lib/workspaces'

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
		</header>
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
