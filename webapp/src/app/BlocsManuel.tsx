// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : le rendu d'un chapitre du manuel, bloc par bloc
// @spec docs/SPEC-manual.md §13.3 (des blocs rendus par des composants, jamais du HTML injecté ; liens internes et
//       externes ; images lues avec la session), §14.2 ; docs/DESIGN_SYSTEM.md §5.69 (les blocs suivent le design
//       system), §5.9 (tableau), §5.20 (lien externe annoncé), §12.6 (débordement signalé), §2 (typographie), §8
//
// LES CLÉS SONT DES RANGS, ET C'EST SÛR : un chapitre, ses listes et ses tableaux ne se réordonnent jamais à l'écran.
//
// AUCUN `dangerouslySetInnerHTML` SUR CETTE SURFACE (§13.3) : chaque genre de bloc a son composant, et un texte venu du
// manuel n'est jamais interprété comme du balisage. Un genre inconnu n'est pas rendu — un manuel construit par une
// version plus récente ne fait pas tomber l'écran.

import { ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n'
import { lireImage, type Bloc, type EnLigne } from '../lib/manuel'
import type { ClientCrm } from '../lib/supabase'
import { cheminAide } from './chemins'

/** Au-delà de cette largeur naturelle, une image est réduite à la colonne et s'offre en taille réelle (§5.69). */
const LARGEUR_REDUITE = 720

const CLASSES_LIEN = 'text-brand underline underline-offset-2 hover:text-brand-hover'


export function EnLigneManuel({ contenu }: { readonly contenu: readonly EnLigne[] }) {
	return (
		<>
			{contenu.map((noeud, rang) => (
				<NoeudEnLigne key={rang} noeud={noeud} />
			))}
		</>
	)
}

function NoeudEnLigne({ noeud }: { readonly noeud: EnLigne }): ReactNode {
	switch (noeud.type) {
		case 'text':
			return noeud.text
		case 'code':
			return <code>{noeud.text}</code>
		case 'break':
			return <br />
		case 'strong':
			return (
				<strong className="font-medium text-ink">
					<EnLigneManuel contenu={noeud.content} />
				</strong>
			)
		case 'emphasis':
			return (
				<em>
					<EnLigneManuel contenu={noeud.content} />
				</em>
			)
		case 'deleted':
			return (
				<del>
					<EnLigneManuel contenu={noeud.content} />
				</del>
			)
		case 'link':
			if ('target' in noeud)
				return (
					<Link to={cheminAide(noeud.target.chapter, noeud.target.anchor)} className={CLASSES_LIEN}>
						<EnLigneManuel contenu={noeud.content} />
					</Link>
				)
			return (
				<a href={noeud.href} target="_blank" rel="noreferrer noopener" className={`${CLASSES_LIEN} inline-flex items-center gap-1`}>
					<EnLigneManuel contenu={noeud.content} />
					<ExternalLink aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
					<span className="sr-only">{t('organization.website.newTab')}</span>
				</a>
			)
		default:
			return null
	}
}

/** Le titre d'une section : un niveau 3 du manuel est un `h2` de la page, le titre du chapitre étant le `h1` (§5.69). */
function Titre({ niveau, ancre, children }: { readonly niveau: number; readonly ancre: string | null; readonly children: ReactNode }) {
	const id = ancre ?? undefined
	if (niveau <= 3) return <h2 id={id} className="text-h2 font-bold text-ink mt-8 scroll-mt-[var(--spacing-12)]">{children}</h2>
	if (niveau === 4) return <h3 id={id} className="text-h3 font-bold text-ink mt-6 scroll-mt-[var(--spacing-12)]">{children}</h3>
	return <h4 id={id} className="font-medium text-ink mt-4">{children}</h4>
}

export function BlocsManuel({ blocs, client }: { readonly blocs: readonly Bloc[]; readonly client: ClientCrm | null }) {
	return (
		<>
			{blocs.map((bloc, rang) => (
				<BlocManuel key={rang} bloc={bloc} client={client} />
			))}
		</>
	)
}

function BlocManuel({ bloc, client }: { readonly bloc: Bloc; readonly client: ClientCrm | null }): ReactNode {
	switch (bloc.type) {
		case 'heading':
			return (
				<Titre niveau={bloc.level} ancre={bloc.anchor}>
					<EnLigneManuel contenu={bloc.content} />
				</Titre>
			)
		case 'paragraph':
			return (
				<p className="mt-3">
					<EnLigneManuel contenu={bloc.content} />
				</p>
			)
		case 'list': {
			const elements = bloc.items.map((item, rang) => (
				<li key={rang} className="mt-1 [&>p:first-child]:mt-0">
					<BlocsManuel blocs={item} client={client} />
				</li>
			))
			return bloc.ordered ? (
				<ol start={bloc.start ?? undefined} className="mt-3 pl-6 list-decimal">
					{elements}
				</ol>
			) : (
				<ul className="mt-3 pl-6 list-disc">{elements}</ul>
			)
		}
		case 'note':
			return (
				<div data-testid="note-manuel" className="mt-4 p-3 rounded-sm bg-hover border-l-[3px] border-border [&>p:first-child]:mt-0">
					<BlocsManuel blocs={bloc.blocks} client={client} />
				</div>
			)
		case 'table':
			return (
				<div className="mt-4 overflow-x-auto indique-debordement-x">
					<table className="min-w-full border-collapse text-sm">
						<thead>
							<tr className="border-b border-border">
								{bloc.header.map((cellule, rang) => (
									<th key={rang} scope="col" className={`px-3 py-2 bg-bg text-text-2 font-medium ${alignement(bloc.align[rang])}`}>
										<EnLigneManuel contenu={cellule} />
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{bloc.rows.map((rangee, i) => (
								<tr key={i} className="border-b border-border align-top">
									{rangee.map((cellule, j) => (
										<td key={j} className={`px-3 py-2 ${alignement(bloc.align[j])}`}>
											<EnLigneManuel contenu={cellule} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)
		case 'codeblock':
			return (
				<pre className="mt-4 p-3 rounded-sm bg-hover overflow-x-auto indique-debordement-x">
					<code>{bloc.text}</code>
				</pre>
			)
		case 'rule':
			return <hr className="mt-6 border-border" />
		case 'image':
			return <ImageManuel client={client} src={bloc.src} alt={bloc.alt} largeur={bloc.width} hauteur={bloc.height} />
		default:
			return null
	}
}

function alignement(sens: 'left' | 'center' | 'right' | null | undefined): string {
	if (sens === 'right') return 'text-right'
	if (sens === 'center') return 'text-center'
	return 'text-left'
}

type ProprietesImage = {
	readonly client: ClientCrm | null
	readonly src: string
	readonly alt: string
	readonly largeur: number | null
	readonly hauteur: number | null
}

/**
 * Une image du manuel, lue avec la session (§14.2) quand elle approche de l'écran, rendue depuis une adresse locale au
 * navigateur, et libérée quand elle quitte la page. Sa place est réservée par ses dimensions, lues dans le manifeste.
 */
export function ImageManuel({ client, src, alt, largeur, hauteur }: ProprietesImage) {
	const cadre = useRef<HTMLElement | null>(null)
	const [visible, setVisible] = useState(false)
	const [etat, setEtat] = useState<{ readonly statut: 'chargement' } | { readonly statut: 'prete'; readonly url: string } | { readonly statut: 'indisponible' }>({
		statut: 'chargement',
	})

	// CHARGÉE À L'APPROCHE, PAS À L'OUVERTURE DU CHAPITRE (§13.3). Sans observateur — un environnement de test, un
	// navigateur ancien —, elle est lue tout de suite : mieux vaut une requête de trop qu'une image jamais affichée.
	useEffect(() => {
		const element = cadre.current
		if (element === null || typeof IntersectionObserver === 'undefined') {
			setVisible(true)
			return
		}
		const observateur = new IntersectionObserver(
			(entrees) => {
				if (entrees.some((entree) => entree.isIntersecting)) {
					setVisible(true)
					observateur.disconnect()
				}
			},
			{ rootMargin: '400px 0px' },
		)
		observateur.observe(element)
		return () => observateur.disconnect()
	}, [])

	useEffect(() => {
		if (!visible) return
		if (client === null) {
			setEtat({ statut: 'indisponible' })
			return
		}
		let actuelle = true
		let url: string | null = null
		void lireImage(client, src).then((blob) => {
			if (!actuelle) return
			if (blob === null) {
				setEtat({ statut: 'indisponible' })
				return
			}
			url = URL.createObjectURL(blob)
			setEtat({ statut: 'prete', url })
		})
		return () => {
			actuelle = false
			if (url !== null) URL.revokeObjectURL(url)
		}
	}, [visible, client, src])

	const proportions = largeur !== null && hauteur !== null && largeur > 0 && hauteur > 0 ? `${largeur} / ${hauteur}` : undefined
	const bornee = largeur !== null ? `min(100%, ${largeur}px)` : '100%'

	return (
		<figure ref={cadre} data-testid="image-manuel" data-src={src} className="mt-4">
			{etat.statut === 'prete' ? (
				<img
					src={etat.url}
					alt={alt}
					width={largeur ?? undefined}
					height={hauteur ?? undefined}
					style={{ width: bornee, height: 'auto' }}
					className="block rounded-sm border border-border bg-surface"
				/>
			) : etat.statut === 'indisponible' ? (
				// INDISPONIBLE : SON TEXTE ALTERNATIF DANS LE MÊME CADRE, jamais l'icône d'image cassée (§5.69).
				<div
					data-testid="image-manuel-indisponible"
					style={{ width: bornee, aspectRatio: proportions }}
					className="flex items-center justify-center p-4 rounded-sm border border-border bg-surface text-sm text-text-2 text-center"
				>
					{alt}
				</div>
			) : (
				<div
					role="status"
					aria-busy="true"
					aria-label={t('help.image.loading', { alt })}
					style={{ width: bornee, aspectRatio: proportions ?? '16 / 9' }}
					className="rounded-sm bg-hover animate-pulse"
				/>
			)}
			{etat.statut === 'prete' && largeur !== null && largeur > LARGEUR_REDUITE ? (
				<a
					href={etat.url}
					target="_blank"
					rel="noreferrer noopener"
					aria-label={t('help.image.fullsize.aria', { alt })}
					className={`${CLASSES_LIEN} inline-flex items-center gap-1 mt-1 min-h-[var(--size-target)] text-sm`}
				>
					{t('help.image.fullsize')}
					<ExternalLink aria-hidden="true" size={14} strokeWidth={2} />
				</a>
			) : null}
		</figure>
	)
}
