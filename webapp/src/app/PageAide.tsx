// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : les pages de l'aide, le sommaire et un chapitre
// @spec docs/SPEC-manual.md §13.1 (les adresses `/aide` et `/aide/:chapitre`, le fil d'Ariane), §13.3 (le rendu),
//       §13.4 (les états) ; docs/SPEC-webapp.md §5.1 bis, §5.2 ; docs/DESIGN_SYSTEM.md §5.69 (le sommaire, un
//       chapitre, « Dans ce chapitre », chapitre précédent et suivant), §5.8 (états), §7 (paliers), §8
//
// Les deux pages vivent dans la coquille ordinaire : sans session, la coquille mène à l'écran de connexion. C'est une
// aide d'interface ; la règle, elle, est tenue par le stockage, qui ne rend le manuel qu'à une session (§14).

import { useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { Chapitre, ChapitreDuSommaire, Sommaire } from '../lib/manuel'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { BlocsManuel, EnLigneManuel } from './BlocsManuel'
import { CHEMIN_AIDE, cheminAide } from './chemins'
import { useChapitreManuel, useSommaireManuel } from './lecture-manuel'

const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

const CLASSES_LIEN = 'text-brand underline-offset-2 hover:underline'

type ProprietesPage = { readonly client?: ClientCrm | null }

// =================================================================================================
// Le sommaire, `/aide`
// =================================================================================================

/** Le sommaire, sous la coquille montée par `App` (titre « Aide »). */
export function SommaireAide({ client = clientCrm }: ProprietesPage = {}) {
	const { etat, reessayer } = useSommaireManuel(client)

	if (etat.statut === 'chargement') return <SkeletonListe lignes={8} libelle={t('help.contents.loading')} className="max-w-[72ch]" />
	if (etat.statut === 'erreur')
		return (
			<EtatErreur
				titre={t('help.error.title')}
				corps={t('help.error.body')}
				libelleReprise={t('help.retry')}
				onReprise={reessayer}
			/>
		)

	const sommaire = etat.donnees
	return (
		<div data-testid="sommaire-aide" className="max-w-[72ch] xl:max-w-none">
			{sommaire.introduction.length > 0 ? (
				<div className="max-w-[72ch] [&>p:first-child]:mt-0 [&>div:first-child]:mt-0">
					<BlocsManuel blocs={sommaire.introduction} client={client} />
				</div>
			) : null}
			<nav aria-label={t('help.contents.aria')} className="mt-6">
				<ol className="grid gap-x-12 gap-y-6 xl:grid-cols-2">
					{sommaire.chapters.map((chapitre) => (
						<li key={chapitre.slug} data-testid="chapitre-sommaire">
							<Link to={cheminAide(chapitre.slug)} className={`${CLASSES_LIEN} font-medium inline-flex items-center min-h-[var(--size-target)]`}>
								{chapitre.title}
							</Link>
							{chapitre.sections.length > 0 ? (
								<ul className="flex flex-col">
									{chapitre.sections.map((section) => (
										<li key={section.anchor}>
											<Link
												to={cheminAide(chapitre.slug, section.anchor)}
												className={`${CLASSES_LIEN} inline-flex items-center min-h-[var(--size-target)] py-2 text-sm text-text-2`}
											>
												{section.title}
											</Link>
										</li>
									))}
								</ul>
							) : null}
						</li>
					))}
				</ol>
			</nav>
		</div>
	)
}

// =================================================================================================
// Un chapitre, `/aide/:chapitre`
// =================================================================================================

/** Un chapitre : sa propre coquille, son titre étant une donnée du manuel (§13.1). */
export function ChapitreAide({ client = clientCrm }: ProprietesPage = {}) {
	const { chapitre: slug = '' } = useParams()
	const { etat, reessayer } = useChapitreManuel(client, slug)
	const { etat: etatSommaire } = useSommaireManuel(client)
	const chapitre = etat.statut === 'pret' ? etat.donnees : null

	// Le titre n'est jamais « Aide », déjà l'ancêtre : « Chapitre » pendant la lecture ou après un échec, « Chapitre
	// introuvable » quand le manuel ne le porte pas (constaté sur capture, 2026-10-27).
	const titre = chapitre?.title ?? (etat.statut === 'pret' ? t('help.chapter.notfound.title') : undefined)
	return (
		<AppShell
			cleTitreRoute={'route.help.chapter.title'}
			{...(titre === undefined ? {} : { titreRoute: titre })}
			ancetres={[{ libelle: t('route.help.title'), vers: CHEMIN_AIDE }]}
		>
			<VueChapitre
				etat={etat}
				reessayer={reessayer}
				client={client}
				voisins={etatSommaire.statut === 'pret' && chapitre !== null ? voisinsDe(etatSommaire.donnees, chapitre.slug) : null}
			/>
		</AppShell>
	)
}

/** Les états d'un chapitre (§13.4), sans la coquille : ce que la preuve unitaire monte. */
export function VueChapitre({
	etat,
	reessayer,
	client,
	voisins,
}: {
	readonly etat: EtatAsync<Chapitre | null>
	readonly reessayer: () => void
	readonly client: ClientCrm | null
	readonly voisins: Voisins | null
}) {
	if (etat.statut === 'chargement') return <SkeletonListe lignes={10} libelle={t('help.chapter.loading')} className="max-w-[72ch]" />
	if (etat.statut === 'erreur')
		return (
			<EtatErreur titre={t('help.error.title')} corps={t('help.error.body')} libelleReprise={t('help.retry')} onReprise={reessayer} />
		)
	if (etat.donnees === null)
		// INCONNU, REFUSÉ OU MAL FORMÉ : LE MÊME ÉCRAN, et son lien vers le sommaire (§13.4).
		return (
			<EtatVide
				titre={t('help.chapter.notfound.title')}
				corps={t('help.chapter.notfound.body')}
				action={
					<Link to={CHEMIN_AIDE} className={CLASSES_RETOUR}>
						{t('help.panel.contents')}
					</Link>
				}
			/>
		)
	return <ContenuChapitre chapitre={etat.donnees} client={client} voisins={voisins} />
}

type Voisins = { readonly precedent: ChapitreDuSommaire | null; readonly suivant: ChapitreDuSommaire | null }

export function voisinsDe(sommaire: Sommaire, slug: string): Voisins | null {
	const rang = sommaire.chapters.findIndex((c) => c.slug === slug)
	if (rang < 0) return null
	return { precedent: sommaire.chapters[rang - 1] ?? null, suivant: sommaire.chapters[rang + 1] ?? null }
}

function ContenuChapitre({
	chapitre,
	client,
	voisins,
}: {
	readonly chapitre: Chapitre
	readonly client: ClientCrm | null
	readonly voisins: Voisins | null
}) {
	const { hash } = useLocation()
	const sections = chapitre.blocks.flatMap((bloc) =>
		bloc.type === 'heading' && bloc.level === 3 && bloc.anchor !== null ? [{ ancre: bloc.anchor, contenu: bloc.content }] : [],
	)

	// UNE SECTION S'ATTEINT PAR LE FRAGMENT (§13.1) : une fois le chapitre rendu, la page s'y porte. Le navigateur ne le
	// fait pas seul, le contenu arrivant après l'adresse.
	useEffect(() => {
		const ancre = decodeURIComponent(hash.replace(/^#/, ''))
		if (ancre === '') return
		document.getElementById(ancre)?.scrollIntoView({ block: 'start' })
	}, [hash])

	return (
		<article data-testid="chapitre-aide" data-slug={chapitre.slug} className="max-w-[72ch]">
			{sections.length > 0 ? (
				<nav aria-label={t('help.chapter.toc')} className="mb-6">
					<p className="text-sm font-medium text-text-2">{t('help.chapter.toc')}</p>
					<ul className="flex flex-col">
						{sections.map((section) => (
							<li key={section.ancre}>
								<a href={`#${section.ancre}`} className={`${CLASSES_LIEN} inline-flex items-center min-h-[var(--size-target)] py-2 text-sm`}>
									<EnLigneManuel contenu={section.contenu} />
								</a>
							</li>
						))}
					</ul>
				</nav>
			) : null}

			<div className="[&>h2:first-child]:mt-0 [&>p:first-child]:mt-0">
				<BlocsManuel blocs={chapitre.blocks} client={client} />
			</div>

			{voisins !== null && (voisins.precedent !== null || voisins.suivant !== null) ? (
				<nav aria-label={t('help.chapter.neighbours')} className="mt-12 pt-4 border-t border-border flex flex-col gap-2 md:flex-row md:justify-between">
					{voisins.precedent === null ? (
						<span />
					) : (
						<Link to={cheminAide(voisins.precedent.slug)} className={`${CLASSES_LIEN} inline-flex items-center min-h-[var(--size-target)]`}>
							{t('help.chapter.previous', { titre: voisins.precedent.title })}
						</Link>
					)}
					{voisins.suivant === null ? null : (
						<Link
							to={cheminAide(voisins.suivant.slug)}
							className={`${CLASSES_LIEN} inline-flex items-center min-h-[var(--size-target)] md:text-right`}
						>
							{t('help.chapter.next', { titre: voisins.suivant.title })}
						</Link>
					)}
				</nav>
			) : null}
		</article>
	)
}
