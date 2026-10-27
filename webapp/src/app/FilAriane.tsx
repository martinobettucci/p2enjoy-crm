// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — le fil d'Ariane de l'en-tête, du workspace à l'objet ouvert
// @spec docs/SPEC-webapp.md §5.1 bis (niveaux ; règles 2, 4 et 5)
// @spec docs/DESIGN_SYSTEM.md §5.62 (liens, titre, troncature, ligne propre sous `lg`, repli, états), §12.2 (ordre de
//       sacrifice), §5.43 (panneau ancré à l'en-tête, Échap et clic extérieur), §5.46 (le fil cède à la recherche
//       ouverte), §7 (aucun contenu masqué sans point d'accès), §8 (cibles ≥ 40 px, focus visible)
// @spec docs/JOURNAL.md décision 641 — sous 1024 px, le fil prend sa propre ligne ; le repli ne sert plus que sous `md`
// @spec CRM-117 (docs/BACKLOG.md) tranche T2 — `shrinkAncetre` : un nom plus court que le plancher garde sa largeur
//
// Le premier niveau est le workspace, le dernier le titre de la route — seul `h1` de la page. Entre les deux, les
// ancêtres que la route a composés (`webapp/src/lib/fil-ariane.ts`).
//
// SOUS `lg`, LE FIL PASSE À LA LIGNE SUIVANTE DE L'EN-TÊTE, sur toute sa largeur (décision 641) : `order-last` et
// `basis-full` dans un en-tête qui passe en `flex-wrap`. Mesuré avant : sur une seule ligne, la fin de l'en-tête ne
// laissait au titre qu'une vingtaine de pixels à 390 px — « B. » pour « Board » —, et le fil l'effaçait tout à fait.
//
// L'ORDRE DE SACRIFICE EST ÉCRIT EN CLASSES : sous `md`, tout niveau sauf le parent immédiat et le titre quitte la
// ligne et rejoint le panneau du repli, qui n'existe qu'à ce palier. Le panneau liste donc exactement ce que la ligne
// ne montre pas, sans mesurer l'écran.

import { Ellipsis } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n'
import { SkeletonListe } from '../components/ui/Skeleton'
import type { EtatAsync } from '../lib/async'
import type { NiveauAriane } from '../lib/fil-ariane'
import type { Workspace } from '../lib/workspaces'

export type ProprietesFilAriane = {
	readonly titre: string
	readonly ancetres: readonly NiveauAriane[]
	readonly etatWorkspaces: EtatAsync<readonly Workspace[]>
	/** La recherche ouverte sous `lg` fait céder le fil entier (§5.46). */
	readonly rechercheOuverte: boolean
}

const CLASSES_LIEN = [
	'flex items-center min-w-0 min-h-[var(--size-target)] rounded-sm',
	'text-sm text-text-2 hover:underline',
].join(' ')

export function FilAriane({ titre, ancetres, etatWorkspaces, rechercheOuverte }: ProprietesFilAriane) {
	const [ouvert, setOuvert] = useState(false)
	const idPanneau = useId()
	const ancre = useRef<HTMLDivElement | null>(null)
	const bouton = useRef<HTMLButtonElement | null>(null)
	const panneau = useRef<HTMLDivElement | null>(null)

	const fermer = useCallback(() => {
		setOuvert(false)
		bouton.current?.focus()
	}, [])

	// `Échap` referme et rend le focus au repli, qui reste monté — patron du panneau de notifications (§5.43).
	useEffect(() => {
		if (!ouvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key === 'Escape') fermer()
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [ouvert, fermer])

	// Un clic extérieur referme SANS rendre le focus : le pointeur l'a déjà porté ailleurs (§5.43).
	useEffect(() => {
		if (!ouvert) return
		const surClic = (evenement: MouseEvent) => {
			const cible = evenement.target
			if (cible instanceof Node && ancre.current?.contains(cible) === true) return
			setOuvert(false)
		}
		globalThis.addEventListener('mousedown', surClic)
		return () => globalThis.removeEventListener('mousedown', surClic)
	}, [ouvert])

	// Le focus entre dans le panneau à l'ouverture : le `Tab` suivant parcourt les niveaux masqués (§5.13).
	useEffect(() => {
		if (ouvert) panneau.current?.focus()
	}, [ouvert])

	const dernier = ancetres.length - 1

	return (
		<nav
			aria-label={t('header.breadcrumb.aria')}
			data-testid="fil-ariane"
			className={[
				rechercheOuverte ? 'hidden lg:block' : 'block',
				// Sous `lg`, la ligne suivante de l'en-tête, entière ; à partir de `lg`, la place que la ligne lui laisse.
				'min-w-0 grow shrink order-last basis-full lg:order-none lg:basis-0',
			].join(' ')}
		>
			{/* `ancre` ne sert qu'à reconnaître un clic intérieur : il n'est PAS positionné, et le panneau s'ancre donc
			    à l'en-tête, qui occupe toute la largeur — ancré au repli, il sortirait de l'écran à 390 px (§5.43). */}
			<div ref={ancre} className="min-w-0">
				<ol className="flex items-center gap-2 min-w-0">
					<li className="flex md:hidden items-center gap-2 shrink-0">
						<button
							ref={bouton}
							type="button"
							data-testid="fil-ariane-repli"
							aria-expanded={ouvert}
							aria-controls={idPanneau}
							title={t('header.breadcrumb.more')}
							onClick={() => setOuvert((precedent) => !precedent)}
							className={[
								'inline-flex items-center justify-center shrink-0',
								'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
								'transition-colors duration-[var(--transition-duration-fast)]',
							].join(' ')}
						>
							<Ellipsis aria-hidden="true" size={20} />
							<span className="sr-only">{t('header.breadcrumb.more')}</span>
						</button>
						<Separateur />
					</li>
					{/* Un ancêtre cède avant le titre (`shrink-[4]`), mais jamais sous dix caractères : en deçà, « P2E… /
					    Stu… » ne nomme plus rien — mesuré à 1152 px sur le titre le plus long du seed (§5.62). Un nom plus
					    court que ce plancher garde sa largeur propre (`shrinkAncetre`) : le plancher l'écartait du titre. */}
					<li className="hidden md:flex items-center gap-2 min-w-[10ch] max-w-[24ch] shrink-[4]">
						<NiveauWorkspace etat={etatWorkspaces} enLigne />
						<Separateur />
					</li>
					{ancetres.map((niveau, rang) => (
						<li
							key={niveau.vers}
							data-testid="fil-ariane-ancetre"
							className={[
								// Sous `md`, seul le parent immédiat reste en ligne (§12.2).
								rang === dernier ? 'flex' : 'hidden md:flex',
								'items-center gap-2',
								shrinkAncetre(niveau.libelle),
							].join(' ')}
						>
							<Link to={niveau.vers} title={niveau.libelle} className={CLASSES_LIEN}>
								<span className="truncate">{niveau.libelle}</span>
							</Link>
							<Separateur />
						</li>
					))}
					<li className="min-w-0 shrink">
						<h1 aria-current="page" className="text-h2 truncate" title={titre}>
							{titre}
						</h1>
					</li>
				</ol>

				{ouvert ? (
					<div
						ref={panneau}
						id={idPanneau}
						tabIndex={-1}
						role="region"
						aria-label={t('header.breadcrumb.panel.aria')}
						data-testid="fil-ariane-panneau"
						className={[
							'absolute top-full left-4 z-40 mt-2 md:hidden',
							'max-w-[calc(100%-2rem)] min-w-[24ch] py-1',
							'bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)]',
						].join(' ')}
					>
						<ul className="flex flex-col">
							<li className="px-3">
								<NiveauWorkspace etat={etatWorkspaces} onSuivre={() => setOuvert(false)} />
							</li>
							{ancetres.slice(0, dernier).map((niveau) => (
								<li key={niveau.vers} className="px-3">
									<Link
										to={niveau.vers}
										title={niveau.libelle}
										onClick={() => setOuvert(false)}
										className={CLASSES_LIEN}
									>
										<span className="truncate">{niveau.libelle}</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
		</nav>
	)
}

/**
 * `CRM-117` — le plancher de `10ch` ne vaut que pour un nom qui peut céder jusqu'à lui. Un nom plus court, « Aide »,
 * recevait la largeur du plancher et s'écartait du titre de la moitié d'un mot (capture du 2026-10-27, §5.62) : il garde
 * sa largeur propre, toujours inférieure au plancher, et ne cède pas.
 */
export function shrinkAncetre(libelle: string): string {
	return libelle.length < 10 ? 'shrink-0' : 'min-w-[10ch] max-w-[24ch] shrink-[4]'
}

function Separateur() {
	return (
		<span aria-hidden="true" className="shrink-0 text-text-3">
			/
		</span>
	)
}

/**
 * Le workspace courant, premier niveau du fil : le premier rendu par `lireWorkspaces` (docs/SPEC-webapp.md §6.3).
 * Sans donnée, il le dit en texte, sans lien (règle 4) — le message que portait le contexte d'espace de fin de ligne.
 * Les identifiants de preuve sont ceux de ce contexte, `CRM-007` : c'est la même information, déplacée.
 */
function NiveauWorkspace({
	etat,
	enLigne = false,
	onSuivre,
}: {
	readonly etat: EtatAsync<readonly Workspace[]>
	readonly enLigne?: boolean
	readonly onSuivre?: () => void
}) {
	const suffixe = enLigne ? '' : '-repli'
	if (etat.statut === 'chargement') {
		return (
			<SkeletonListe
				lignes={1}
				libelle={t('header.workspace.loading')}
				className="w-[var(--size-placeholder)] max-w-full"
			/>
		)
	}
	const workspace = etat.statut === 'pret' ? etat.donnees[0] : undefined
	if (workspace === undefined) {
		return (
			<span
				data-testid={`workspace-absent${suffixe}`}
				className="flex items-center min-h-[var(--size-target)] text-sm text-text-3 truncate"
			>
				{t('header.workspace.unknown')}
			</span>
		)
	}
	return (
		<Link
			to="/"
			data-testid={`workspace-courant${suffixe}`}
			title={workspace.name}
			className={CLASSES_LIEN}
			{...(onSuivre === undefined ? {} : { onClick: onSuivre })}
		>
			<span className="truncate">{workspace.name}</span>
		</Link>
	)
}
