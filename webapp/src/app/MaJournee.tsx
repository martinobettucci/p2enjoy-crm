// @spec CRM-061 (docs/BACKLOG.md) — tranche 1 : l'écran « Ma journée »
// @spec docs/SPEC-cards.md §17.2 (l'adresse porte la portée), §17.3 (la portée par défaut),
//       §17.4 (ce que la vue lit), §17.5 (les trois sections), §17.6 (ce que chaque ligne rend),
//       §17.8 (états systématiques), §17.9 (accessibilité et clavier), §17.10 (ce qui n'est pas livré)
// @spec docs/DESIGN_SYSTEM.md §5.36 (cette surface), §5.18 (liste plate), §5.29 (pilule de channel),
//       §5.8 (états), §2 (données techniques), §12.1 (ce qui change d'adresse est un lien)
//
// L'ADRESSE `/ma-journee` RENDAIT UN ÉTAT VIDE INCONDITIONNEL DEPUIS `CRM-007` : une entrée de barre
// latérale qui ne menait nulle part, alors que le modèle — `next_action`, `next_action_at` et leur
// index — est livré depuis `CRM-040`. Cet écran est ce qui manquait.
//
// L'écran ne calcule AUCUN droit (§17.1) : il rend ce que le backend consent. Un appelant sans
// session, ou sans droit, reçoit `200` et zéro ligne — mesuré —, ce qui est l'état vide ordinaire du
// §5.8 et non un refus à mettre en scène (`docs/SPEC-permissions-rls.md` §7).
//
// AUCUNE ÉCRITURE (§17.10) : ni report d'échéance, ni « fait », ni saisie. Le seul chemin d'écriture
// de ces deux colonnes est l'en-tête de la fiche (§15 bis), et un second geste ici en ferait une
// seconde définition du même geste.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SquareArrowOutUpRight } from 'lucide-react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { LiveRegion } from '../components/ui/LiveRegion'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	CLE_URL_PORTEE,
	HORIZON_JOURS,
	VALEUR_URL_PORTEE_TOUS,
	bornesJournee,
	decouperEnSections,
	lireJournee,
	lirePortee,
	type AffaireDuJour,
	type Portee,
	type SectionJournee,
} from '../lib/ma-journee'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/** Les libellés des trois sections, déclarés une fois — l'ordre vient du module de composition. */
const TITRES_SECTION: Record<SectionJournee, CleTraduction> = {
	retard: 'today.section.late',
	aujourdhui: 'today.section.today',
	avenir: 'today.section.upcoming',
}

/**
 * L'échéance en clair.
 *
 * DONNÉE TECHNIQUE au sens du §2 : monospace et chiffres tabulaires, posés par la classe de la
 * cellule. **L'heure est rendue avec la date** (§5.36) : une échéance du jour sans heure ne dirait
 * pas si la matinée est déjà passée.
 */
function echeanceEnClair(echeance: Date): string {
	return new Intl.DateTimeFormat('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(echeance)
}

export type ProprietesMaJournee = {
	readonly client?: ClientCrm | null
	/**
	 * L'instant qui découpe la journée, **injectable** pour la raison du §16.11.1 : sans lui, aucune
	 * preuve ne pourrait éprouver les deux côtés d'une borne sans dépendre de l'heure à laquelle elle
	 * s'exécute.
	 */
	readonly maintenant?: Date
}

export function MaJournee({ client = clientCrm, maintenant }: ProprietesMaJournee = {}) {
	const [parametres] = useSearchParams()
	const portee: Portee = lirePortee(parametres.get(CLE_URL_PORTEE))
	const { etat: session } = useAuthentification()
	const idUtilisateur = session.statut === 'authentifie' ? session.utilisateur.id : null

	// L'INSTANT EST FIGÉ POUR LA DURÉE D'UN CHARGEMENT, ET IL VOYAGE AVEC LES DONNÉES.
	//
	// La requête et le découpage doivent employer la **même** borne : deux appels à `new Date()`
	// séparés de quelques millisecondes suffiraient, au passage de minuit, à demander la journée
	// d'hier et à la découper sur celle d'aujourd'hui. L'instant est donc arrêté dans l'effet, avec
	// la lecture, et rangé dans l'état à côté des affaires — plutôt que recalculé au rendu.
	type ContenuJournee = {
		readonly affaires: readonly AffaireDuJour[]
		readonly instant: Date
	}
	const [etat, setEtat] = useState<EtatAsync<ContenuJournee>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par un changement de portée, ne doit pas
	// écraser un état plus récent — même garde que `Carnet` et `EtatMessagerie`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		const instant = maintenant ?? new Date()
		setEtat(enChargement())
		void (async () => {
			const lu = await lireJournee(client, { portee, idUtilisateur, maintenant: instant })
			if (rang !== courant.current) return
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret({ affaires: lu.donnees, instant }))
		})()
	}, [client, portee, idUtilisateur, maintenant, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	// LA BASCULE DE PORTÉE EST UNE PAIRE DE LIENS (§5.36, §12.1) : les deux portées changent
	// d'adresse, et ce qui change d'adresse est un lien — en faire un contrôle de formulaire
	// retirerait le clic du milieu, le nouvel onglet et la copie de l'adresse.
	//
	// ELLE RESTE RENDUE SUR UN ÉCRAN VIDE : elle est la cause possible de ce vide, et la masquer
	// priverait l'utilisateur du seul geste qui l'en sort (§5.3 quinquies, §5.31).
	const bascule = (
		<nav aria-label={t('today.scope.aria')} data-testid="portee-journee">
			<ul className="flex items-center gap-1 border-b border-border">
				{(
					[
						{ portee: 'moi' as const, cle: 'today.scope.mine' as CleTraduction, adresse: '/ma-journee' },
						{
							portee: 'tous' as const,
							cle: 'today.scope.all' as CleTraduction,
							adresse: `/ma-journee?${CLE_URL_PORTEE}=${VALEUR_URL_PORTEE_TOUS}`,
						},
					] as const
				).map((entree) => (
					<li key={entree.portee}>
						<Link
							to={entree.adresse}
							data-testid="lien-portee"
							data-portee={entree.portee}
							// `aria-current` est posé À LA MAIN, et non par `NavLink` : les deux entrées
							// partagent le même chemin et ne diffèrent que par leur chaîne de requête, que
							// `NavLink` ne compare pas — il poserait l'attribut sur les DEUX. C'est le cas
							// déjà rencontré par les onglets de coûts (§5.31), et la même réponse.
							{...(portee === entree.portee ? { 'aria-current': 'page' as const } : {})}
							className={[
								'inline-flex items-center min-h-[var(--size-target)] px-3 text-sm',
								// Les deux états portent une bordure de MÊME ÉPAISSEUR, pour que le texte ne
								// se décale pas au changement de portée (§12.1).
								portee === entree.portee
									? 'border-b-2 border-brand text-brand font-medium'
									: 'border-b-2 border-transparent text-text-2 hover:text-ink',
							].join(' ')}
						>
							{t(entree.cle)}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	)

	if (client === null) {
		return <EtatVide titre={t('today.noWorkspace.title')} corps={t('today.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return (
			<section aria-label={t('today.aria')} className="flex flex-col gap-4">
				{bascule}
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			</section>
		)
	}

	if (etat.statut === 'erreur') {
		return (
			<section aria-label={t('today.aria')} className="flex flex-col gap-4">
				{bascule}
				<EtatErreur
					titre={t('today.error.title')}
					corps={t('today.error.body')}
					libelleReprise={t('today.error.retry')}
					onReprise={reprendre}
				/>
			</section>
		)
	}

	const sections = decouperEnSections(etat.donnees.affaires, bornesJournee(etat.donnees.instant))
	const total = etat.donnees.affaires.length

	return (
		<section aria-label={t('today.aria')} className="flex flex-col gap-4">
			{bascule}
			{/* Le changement de portée est ANNONCÉ (§17.9) : une liste qui se recompose sans un mot
			    est un changement invisible pour qui ne voit pas l'écran. */}
			<LiveRegion
				libelle={t('today.live.aria')}
				message={t('today.live.message', {
					portee: portee === 'moi' ? t('today.scope.mine') : t('today.scope.all'),
					total: String(total),
				})}
			/>
			{total === 0 ? (
				/*
				  DEUX VIDES DISTINCTS, ET AUCUN NE SE CONFOND AVEC L'AUTRE (§17.8, §5.36).
				  « Rien pour moi » PORTE l'action qui élargit la portée — le patron du §5.8, un état
				  vide porte le geste qui l'en sort ; « rien pour personne » n'en porte AUCUNE, il n'y
				  a rien à élargir et un bouton y serait un chemin vers nulle part (§5.16, §5.19).
				*/
				portee === 'moi' ? (
					<EtatVide
						titre={t('today.empty.mine.title')}
						corps={t('today.empty.mine.body', { jours: String(HORIZON_JOURS) })}
						action={
							<Link
								to={`/ma-journee?${CLE_URL_PORTEE}=${VALEUR_URL_PORTEE_TOUS}`}
								data-testid="elargir-portee"
								className="inline-flex items-center min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface"
							>
								{t('today.empty.mine.action')}
							</Link>
						}
					/>
				) : (
					<EtatVide
						// L'horizon est écrit DANS LE TITRE, et le paramètre y est donc passé : sans lui,
						// le gabarit `{jours}` atteignait l'écran tel quel. Défaut trouvé par la preuve
						// unitaire du second vide, pas à la lecture.
						titre={t('today.empty.all.title', { jours: String(HORIZON_JOURS) })}
						corps={t('today.empty.all.body')}
					/>
				)
			) : (
				sections.map(({ section, affaires }) => {
					const enRetard = section === 'retard'
					// UNE SECTION VIDE N'EST PAS RENDUE (§17.8, §5.36) : trois titres surmontant trois
					// vides diraient trois fois « rien » là où leur absence le dit une fois. Le cas où
					// TOUT est vide est traité juste au-dessus, et il est explicite.
					return affaires.length === 0 ? null : (
						<section
							key={section}
							data-testid="section-journee"
							data-section={section}
							className="flex flex-col gap-2"
						>
							<h2 className="text-h3 text-ink">
								{t(TITRES_SECTION[section])}{' '}
								{/* LE COMPTE VIT DANS SON PROPRE ÉLÉMENT (§5.36, §5.11) : un nœud de texte
								    accolé au libellé devient un élément flex anonyme que `gap` ne sépare
								    pas — le défaut « Discussion1 ». */}
								<span data-testid="compte-section" className="text-text-2 tabular-nums">
									({affaires.length})
								</span>
							</h2>
							{/*
							  `enRetard` est calculé ICI, hors du JSX, et ce n'est pas un détail de style :
							  le contrôle de classes du harnais (`scripts/lib/classes-css.mjs`, §11 du
							  design system) lit les chaînes littérales d'un attribut `className`, et un
							  `section === 'retard' ? … : …` écrit à même l'attribut lui ferait prendre
							  `retard` pour une classe absente du CSS produit. Un faux positif dans ce
							  contrôle est aussi coûteux qu'un vrai : il apprend à ne plus le lire.
							*/}
							<ul className="flex flex-col rounded-lg border border-border bg-surface">
								{affaires.map((affaire) => (
									<li
										key={affaire.id}
										data-testid="ligne-journee"
										data-affaire={affaire.id}
										// SOUS LE PALIER `md`, LA LIGNE SE REPLIE ET GAGNE DE LA HAUTEUR
										// (§5.36) : quatre éléments ne tiennent pas sur 390 px, et la réponse
										// d'une liste plate au manque de place est de se replier, non de
										// tronquer une donnée. `md` et jamais `sm` (§11, §5.20).
										className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 px-3 py-2 md:py-0 md:min-h-[var(--size-target)] border-b border-border last:border-b-0 hover:bg-hover"
									>
										{/*
										  L'ÉCHÉANCE EST EN TÊTE DE LIGNE (§5.36), contrairement à toutes les
										  autres listes du produit : c'est elle qui range cet écran, et une
										  colonne de dates alignées se lit d'un regard.

										  LA TEINTE DE DANGER PORTE SUR L'ÉCHÉANCE, PAS SUR LA LIGNE : une
										  affaire en retard est un travail à faire, pas une erreur. Le §1 est
										  tenu par le titre de la section, qui écrit « En retard » en toutes
										  lettres.
										*/}
										<code
											data-testid="echeance-journee"
											className={[
												'shrink-0 tabular-nums text-sm px-2 py-1 rounded-full',
												enRetard ? 'bg-danger-soft text-danger-on-soft' : 'text-text-2',
											].join(' ')}
										>
											{echeanceEnClair(affaire.echeance)}
										</code>
										{/*
										  Le titre EST le libellé du lien, sans `aria-label` qui le
										  remplacerait : deux liens portant le même libellé générique seraient
										  indiscernables au lecteur d'écran (§17.9, §5.19).

										  Une affaire dont les slugs manquent reste LISTÉE, mais sans lien : un
										  lien vers une adresse incomplète mènerait à un écran que
										  l'utilisateur croirait cassé (§5.32).
										*/}
										<span
											className="min-w-0 grow truncate font-medium"
											title={affaire.titre}
										>
											{affaire.adresse === null ? (
												affaire.titre
											) : (
												<Link
													to={affaire.adresse}
													data-testid="lien-affaire-journee"
													className="text-brand hover:underline"
												>
													{affaire.titre}
												</Link>
											)}
										</span>
										{/*
										  UNE PROCHAINE ACTION ABSENTE NE REND RIEN — ni tiret, ni « non
										  renseigné » (§5.9, §17.6). Les deux colonnes sont indépendantes en
										  base, et l'échéance seule reste une information.
										*/}
										<span
											data-testid="action-journee"
											className="min-w-0 grow truncate text-sm text-text-2"
											{...(affaire.prochaineAction === null
												? {}
												: { title: affaire.prochaineAction })}
										>
											{affaire.prochaineAction ?? ''}
										</span>
										{/*
										  LA PILULE « Track › Channel » EST CELLE DU §5.29, réemployée sans
										  copie — c'est la même donnée, elle doit se reconnaître d'un écran à
										  l'autre. Elle FERME la ligne : elle situe l'affaire, elle ne la nomme
										  pas. Sans destination lisible, aucune pilule n'est rendue : l'écran
										  ne nomme jamais ce qu'il ne peut pas ouvrir (§5.29).
										*/}
										{affaire.nomTrack === null || affaire.nomChannel === null ? null : (
											<span
												data-testid="pilule-situation"
												className="shrink-0 inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-full bg-brand-soft text-brand text-xs truncate"
											>
												<SquareArrowOutUpRight aria-hidden="true" size={12} strokeWidth={2} />
												<span className="truncate">
													{t('goals.block.pill', {
														track: affaire.nomTrack,
														channel: affaire.nomChannel,
													})}
												</span>
											</span>
										)}
									</li>
								))}
							</ul>
						</section>
					)
				})
			)}
		</section>
	)
}
