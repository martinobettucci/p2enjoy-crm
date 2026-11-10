// @spec CRM-146 (docs/BACKLOG.md) — tranche T2 : la barre « Réel sur prévu » de la liste des organisations et le bloc
//       « Recettes avec cette organisation » de sa fiche
// @spec docs/SPEC-recettes.md §12.2 (la part réalisée), §12.4 (la colonne de la liste), §12.5 (le bloc de la fiche : le
//       tableau, les mentions, le vide sans action, l'erreur et sa reprise dans le bloc seul, le squelette, aucun lien)
// @spec docs/DESIGN_SYSTEM.md §5.97 (la jauge du §5.29 réemployée, `aria-hidden`, sans couleur de jugement ; une ligne par
//       devise empilée ; le code devise dans son propre élément), §5.9 (tableau, cellule vide), §5.30 (mentions), §5.60
//       (surface bordée, une valeur par devise), §5.8 (états), §5.48 (la portée), §12.6 (débordement signalé), §10 (accord)
//
// LA BARRE DOUBLE LE TEXTE À L'ŒIL, ET LUI SEUL PORTE L'INFORMATION (§5.97) : elle est cachée aux lecteurs d'écran, et le
// texte « 163 000,00 sur 210 000,00 EUR » ou « 78 % » est toujours rendu à côté d'elle.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	largeurBarre,
	lireTotauxOrganisations,
	mentionsOrganisation,
	partRealisee,
	pourcentageEntier,
	type TotalDevise,
	type TotauxParOrganisation,
} from '../lib/recettes-organisation'
import type { ClientCrm } from '../lib/supabase'
import { montantEnClair } from './BlocRentabiliteCard'

/**
 * La jauge du §5.29, à largeur fixe pour que les barres d'une colonne se comparent. `part` nulle : la part est sans
 * objet, la place est gardée vide pour que les textes restent alignés (§5.97).
 */
export function BarreRecette({ part }: { readonly part: number | null }) {
	if (part === null) return <span aria-hidden="true" data-testid="barre-recette-sans-objet" className="w-[96px] shrink-0" />
	return (
		<span aria-hidden="true" data-testid="barre-recette" className="w-[96px] shrink-0 h-[6px] rounded-full bg-brand-soft overflow-hidden">
			<span data-testid="barre-recette-remplissage" className="block h-full bg-brand" style={{ width: `${largeurBarre(part)}%` }} />
		</span>
	)
}

function Code({ devise }: { readonly devise: string }) {
	return <span className="text-sm text-text-2">{devise}</span>
}

/**
 * La cellule « Réel sur prévu » d'une organisation (§12.4) : une ligne par devise, empilées. Sans recette, la cellule
 * reste vide (§5.9) — ni barre à zéro, ni « 0 sur 0 ».
 */
export function ReelSurPrevu({ totaux }: { readonly totaux: readonly TotalDevise[] }) {
	if (totaux.length === 0) return null
	return (
		// UNE GRILLE PAR LIGNE, LA BARRE AU BORD GAUCHE DE LA CELLULE : toutes les barres de la colonne partent du même
		// bord et se comparent d'une organisation à l'autre ; le texte reste aligné à droite (constaté sur la capture
		// du 2026-11-10 : en ligne, chaque barre suivait la longueur de son texte).
		<span className="flex w-full flex-col gap-1">
			{totaux.map((total) => (
				<span
					key={total.devise}
					data-testid="reel-sur-prevu"
					data-devise={total.devise}
					className="grid grid-cols-[96px_1fr_auto] items-center gap-2 whitespace-nowrap"
				>
					<BarreRecette part={partRealisee(total.prevu, total.reel)} />
					<span className="text-right tabular-nums">
						{total.reel === null
							? t('organizations.revenues.noActual', { prevu: montantEnClair(total.prevu) })
							: t('organizations.revenues.progress', { reel: montantEnClair(total.reel), prevu: montantEnClair(total.prevu) })}
					</span>
					<Code devise={total.devise} />
				</span>
			))}
		</span>
	)
}

/** La liste attend ses deux lectures ensemble ; les totaux d'une organisation absente de la réponse sont vides. */
export const AUCUN_TOTAL: readonly TotalDevise[] = []

const ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'
const CELLULE = 'h-[var(--size-target)] px-3 text-right whitespace-nowrap tabular-nums'

/**
 * Le bloc « Recettes avec cette organisation » de la fiche (§12.5). Il lit lui-même, après la fiche, et porte ses
 * propres états : son échec ne retire pas le reste de la fiche, et « Réessayer » ne relit que lui.
 */
export function BlocRecettesOrganisation({
	client,
	idOrganisation,
}: {
	readonly client: ClientCrm
	readonly idOrganisation: string
}) {
	const [etat, setEtat] = useState<EtatAsync<TotauxParOrganisation>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireTotauxOrganisations(client, idOrganisation)
			if (rang === courant.current) setEtat(lu)
		})()
	}, [client, idOrganisation, tentative])

	const reprendre = useCallback(() => setTentative((n) => n + 1), [])

	return (
		<section aria-labelledby="titre-recettes-organisation" data-testid="recettes-organisation" className="flex flex-col gap-3">
			<h2 id="titre-recettes-organisation" className="text-h3">
				{t('organization.revenues.title')}
			</h2>
			<ContenuRecettes etat={etat} idOrganisation={idOrganisation} onReprise={reprendre} />
		</section>
	)
}

function ContenuRecettes({
	etat,
	idOrganisation,
	onReprise,
}: {
	readonly etat: EtatAsync<TotauxParOrganisation>
	readonly idOrganisation: string
	readonly onReprise: () => void
}) {
	if (etat.statut === 'chargement') return <SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('organization.revenues.error.title')}
				corps={t('organization.revenues.error.body')}
				libelleReprise={t('organization.revenues.error.retry')}
				onReprise={onReprise}
			/>
		)
	}
	const totaux = etat.donnees.get(idOrganisation) ?? AUCUN_TOTAL
	if (totaux.length === 0) {
		// LE VIDE N'OFFRE AUCUNE ACTION (§5.97) : la fiche ne crée pas de recette.
		return <EtatVide titre={t('organization.revenues.empty.title')} corps={t('organization.revenues.empty.body')} />
	}
	const mentions = mentionsOrganisation(totaux)
	return (
		<>
			<div className="overflow-x-auto indique-debordement-x rounded-lg border border-border bg-surface">
				<table data-testid="tableau-recettes-organisation" className="w-full border-collapse">
					<caption className="sr-only">{t('organization.revenues.aria')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={`${ENTETE} text-left`}>{t('organization.revenues.column.currency')}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t('organization.revenues.column.estimated')}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t('organization.revenues.column.actual')}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t('organization.revenues.column.progress')}</th>
						</tr>
					</thead>
					<tbody>
						{totaux.map((total) => {
							const part = partRealisee(total.prevu, total.reel)
							return (
								<tr key={total.devise} data-testid="ligne-recettes-organisation" data-devise={total.devise} className="border-b border-border last:border-b-0">
									<th scope="row" className="h-[var(--size-target)] px-3 text-left font-medium">
										{total.devise}
									</th>
									<td className={CELLULE}>{montantEnClair(total.prevu)}</td>
									<td className={CELLULE}>{total.reel === null ? '' : montantEnClair(total.reel)}</td>
									<td className={CELLULE}>
										{part === null ? (
											''
										) : (
											<span className="inline-flex items-center justify-end gap-2">
												<BarreRecette part={part} />
												<span>{t('organization.revenues.percent', { n: String(pourcentageEntier(part)) })}</span>
											</span>
										)}
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
			<div data-testid="mentions-recettes-organisation" className="flex flex-col gap-1 text-sm text-text-2">
				<p>
					{t(mentions.affaires === 1 ? 'organization.revenues.cards.one' : 'organization.revenues.cards.many', {
						n: String(mentions.affaires),
					})}
				</p>
				{mentions.affairesPartagees > 0 ? (
					<p data-testid="mention-recettes-partagees">
						{t(mentions.affairesPartagees === 1 ? 'organization.revenues.shared.one' : 'organization.revenues.shared.many', {
							n: String(mentions.affairesPartagees),
						})}
					</p>
				) : null}
				{mentions.lignesSansReel > 0 ? (
					<p data-testid="mention-recettes-sans-reel">
						{t(mentions.lignesSansReel === 1 ? 'organization.revenues.withoutActual.one' : 'organization.revenues.withoutActual.many', {
							n: String(mentions.lignesSansReel),
						})}
					</p>
				) : null}
				<p>{t('organization.revenues.scope')}</p>
			</div>
		</>
	)
}
