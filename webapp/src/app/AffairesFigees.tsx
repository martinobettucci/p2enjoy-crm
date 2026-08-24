// @spec CRM-062 (docs/BACKLOG.md) — tranche 3c : l'écran qui liste les affaires figées
// @spec docs/SPEC-relances.md §10.4 (l'adresse et la place dans la navigation), §10.5 (les deux
//       lectures), §10.6 (aucune portée, et pourquoi), §10.7 (regroupement et classement),
//       §10.8 (ce que chaque ligne rend), §10.9 (les états), §10.10 (accessibilité)
// @spec docs/DESIGN_SYSTEM.md §5.37 (cette surface), §5.18 (liste plate), §5.29 (pilule de
//       channel), §5.8 (états), §5.6 (pilule neutre), §2 (données techniques), §7 (paliers)
//
// L'ÉCRAN NE CALCULE AUCUN DROIT (`CLAUDE.md` §10) : il rend ce que le backend consent. Un appelant
// sans session, ou sans droit sur un dossier, reçoit `200` et zéro ligne — mesuré —, ce qui est
// l'état vide ordinaire du §5.8 et non un refus à mettre en scène. Il ne nomme JAMAIS ce qu'il ne
// montre pas : aucune phrase ne dit « une affaire vous est masquée » (docs/SPEC-permissions-rls.md
// §7, §5.33 du design system).
//
// AUCUNE ÉCRITURE (§10.1) : ni report, ni « traité », ni mise en sommeil. Le seul chemin d'écriture
// est la fiche de l'affaire, et un second geste ici en ferait une seconde définition du même geste.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { SquareArrowOutUpRight } from 'lucide-react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { LiveRegion } from '../components/ui/LiveRegion'
import { t } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	lireAffairesFigees,
	regrouperParDossier,
	type AffaireFigee,
} from '../lib/affaires-figees'
import { clientCrm, type ClientCrm } from '../lib/supabase'

export type ProprietesAffairesFigees = {
	readonly client?: ClientCrm | null
}

export function AffairesFigees({ client = clientCrm }: ProprietesAffairesFigees = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly AffaireFigee[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écraser un état plus récent — même garde
	// que `MaJournee`, `Carnet` et `EtatMessagerie`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireAffairesFigees(client)
			if (rang !== courant.current) return
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret(lu.donnees))
		})()
	}, [client, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	if (client === null) {
		return <EtatVide titre={t('stalled.noWorkspace.title')} corps={t('stalled.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return (
			<section aria-label={t('stalled.aria')} className="flex flex-col gap-4">
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			</section>
		)
	}

	if (etat.statut === 'erreur') {
		return (
			<section aria-label={t('stalled.aria')} className="flex flex-col gap-4">
				<EtatErreur
					titre={t('stalled.error.title')}
					corps={t('stalled.error.body')}
					libelleReprise={t('stalled.error.retry')}
					onReprise={reprendre}
				/>
			</section>
		)
	}

	const groupes = regrouperParDossier(etat.donnees)
	const total = etat.donnees.length

	return (
		<section aria-label={t('stalled.aria')} className="flex flex-col gap-4">
			{/* LE COMPTE EST ANNONCÉ (§10.10) : une liste qui se recompose sans un mot est un
			    changement invisible pour qui ne voit pas l'écran. */}
			<LiveRegion
				libelle={t('stalled.live.aria')}
				message={t('stalled.live.message', { total: String(total) })}
			/>
			{total === 0 ? (
				/*
				  UN SEUL VIDE, ET IL N'OFFRE AUCUNE ACTION (§10.9). C'est l'écart assumé au §5.8 que
				  la corbeille (§5.16) et le carnet (§5.19) prennent déjà : il n'y a rien à faire
				  d'une liste d'affaires en retard qui est vide, et un bouton y serait un chemin vers
				  nulle part. Le message dit que l'état est SAIN, pas qu'il manque quelque chose.

				  Un seul, et non deux comme « Ma journée » : il n'y a aucune portée à élargir
				  (§10.6), donc rien ne distingue « rien pour moi » de « rien pour personne ».
				*/
				<EtatVide titre={t('stalled.empty.title')} corps={t('stalled.empty.body')} />
			) : (
				groupes.map((groupe) => (
					<section
						key={groupe.idChannel}
						data-testid="groupe-figees"
						data-dossier={groupe.idChannel}
						className="flex flex-col gap-2"
					>
						<h2 className="text-h3 text-ink">
							{groupe.nomChannel ?? t('stalled.group.unknown')}{' '}
							{/* LE COMPTE VIT DANS SON PROPRE ÉLÉMENT (§5.36, §5.11) : un nœud de texte
							    accolé au libellé devient un élément flex anonyme que `gap` ne sépare
							    pas — le défaut « Discussion1 ». */}
							<span data-testid="compte-groupe" className="text-text-2 tabular-nums">
								({groupe.affaires.length})
							</span>
						</h2>
						<ul className="flex flex-col rounded-lg border border-border bg-surface">
							{groupe.affaires.map((affaire) => (
								<li
									key={affaire.id}
									data-testid="ligne-figee"
									data-affaire={affaire.id}
									// SOUS LE PALIER `md`, LA LIGNE SE REPLIE ET GAGNE DE LA HAUTEUR
									// (§10.8) : cinq éléments ne tiennent pas sur 390 px, et la réponse
									// d'une liste plate au manque de place est de se replier, non de
									// tronquer une donnée. `md` et jamais `sm` (§11, §5.20).
									className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 px-3 py-2 md:py-0 md:min-h-[var(--size-target)] border-b border-border last:border-b-0 hover:bg-hover"
								>
									{/*
									  LE RETARD EST EN TÊTE DE LIGNE (§10.8), comme l'échéance de
									  « Ma journée » : c'est lui qui range cet écran, et une colonne
									  de nombres alignés se lit d'un regard.

									  LA TEINTE DE DANGER PORTE SUR LE RETARD, PAS SUR LA LIGNE : une
									  affaire figée est un travail à faire, pas une erreur. Le §1 est
									  tenu par le titre de l'écran et par l'unité, écrits en toutes
									  lettres.

									  L'UNITÉ OCCUPE SON PROPRE ÉLÉMENT, jamais un nœud de texte
									  accolé au nombre (§5.18, §5.11).
									*/}
									<code
										data-testid="retard-figee"
										className="shrink-0 tabular-nums text-sm px-2 py-1 rounded-full bg-danger-soft text-danger-on-soft"
									>
										{affaire.retardJours}
										<span className="ml-1">{t('stalled.unit.days')}</span>
									</code>
									{/*
									  Le titre EST le libellé du lien, sans `aria-label` qui le
									  remplacerait : deux liens portant le même libellé générique
									  seraient indiscernables au lecteur d'écran (§5.19).

									  Une affaire dont les slugs manquent reste LISTÉE, mais sans
									  lien : un lien vers une adresse incomplète mènerait à un écran
									  que l'utilisateur croirait cassé (§5.32).
									*/}
									<span
										// SOUS LE PALIER `md`, LE TITRE PREND SA PROPRE LIGNE — le repli
										// devient RÉGULIER, ce que le §10.8 exige de la ligne repliée.
										className="basis-full md:basis-auto min-w-0 grow truncate font-medium"
										title={affaire.titre}
									>
										{affaire.adresse === null ? (
											affaire.titre
										) : (
											<Link
												to={affaire.adresse}
												data-testid="lien-affaire-figee"
												className="text-brand hover:underline"
											>
												{affaire.titre}
											</Link>
										)}
									</span>
									{/*
									  L'ÉTAPE EST UNE PILULE NEUTRE (§5.6) : c'est le dossier interne
									  de l'affaire, pas son identité, et une teinte de donnée lui
									  ferait porter une urgence qu'elle n'a pas. Une étape que la
									  seconde lecture n'a pas rapportée ne rend RIEN — ni tiret, ni
									  « non renseigné » (§5.9).
									*/}
									{affaire.etape === null ? null : (
										<span
											data-testid="etape-figee"
											className="shrink-0 inline-flex items-center px-2 py-1 rounded-full bg-hover text-text-2 text-xs"
										>
											{affaire.etape}
										</span>
									)}
									{/*
									  LE SEUIL ACCOMPAGNE LE RETARD, et il n'est pas décoratif : un
									  retard sans son seuil n'a pas d'échelle (§10.8, même raison
									  qu'au §9.6 pour le `payload`).
									*/}
									<span data-testid="seuil-figee" className="shrink-0 text-sm text-text-2">
										{t('stalled.threshold', { seuil: String(affaire.seuilJours) })}
									</span>
									{/*
									  LA PILULE « Track › Channel » EST CELLE DU §5.29, réemployée
									  sans copie — c'est la même donnée, elle doit se reconnaître d'un
									  écran à l'autre. Elle FERME la ligne : elle situe l'affaire,
									  elle ne la nomme pas. Sans destination lisible, aucune pilule
									  n'est rendue : l'écran ne nomme jamais ce qu'il ne peut pas
									  ouvrir (§5.29).
									*/}
									{affaire.nomTrack === null ||
									affaire.nomChannel === null ||
									affaire.adresseChannel === null ? null : (
										<Link
											to={affaire.adresseChannel}
											data-testid="pilule-situation"
											// Son nom accessible NOMME sa destination : la même pilule
											// répétée sur quatre lignes ne dirait pas ce que chacune
											// ouvre (§5.29, §10.10).
											aria-label={t('stalled.pill.open', {
												track: affaire.nomTrack,
												channel: affaire.nomChannel,
											})}
											className="shrink-0 inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-full bg-brand-soft text-brand text-xs truncate hover:bg-brand-soft-strong"
										>
											<SquareArrowOutUpRight aria-hidden="true" size={12} strokeWidth={2} />
											<span className="truncate">
												{t('goals.block.pill', {
													track: affaire.nomTrack,
													channel: affaire.nomChannel,
												})}
											</span>
										</Link>
									)}
								</li>
							))}
						</ul>
					</section>
				))
			)}
		</section>
	)
}
