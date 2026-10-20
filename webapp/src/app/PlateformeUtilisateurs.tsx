// @spec CRM-101 (docs/BACKLOG.md) — tranche T6 : l'onglet « Utilisateurs » de la plateforme, en lecture seule
// @spec docs/SPEC-plateforme.md §6.5 (`plateforme_utilisateurs`), §7.2 (qui est un utilisateur) ; docs/DESIGN_SYSTEM.md
//       §5.56 (onglet « Utilisateurs » : recherche, tableau, espaces en liste de liens, « Jamais connecté », troncature
//       écrite), §5.46 (la liste précédente reste affichée pendant la lecture suivante), §5.9, §5.8 ; arbitrage A6
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la base garde la lecture par le drapeau
//
// Lecture seule, et l'absence de geste est assumée : poser une appartenance ou le drapeau reste dans la fiche d'un espace
// et dans l'onglet des superadministrateurs (§5.48, une seule définition d'un geste).

import { Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { BORNE_UTILISATEURS, lireUtilisateurs, type UtilisateurPlateforme } from '../lib/plateforme'
import { DELAI_FRAPPE_MS } from '../lib/recherche'
import type { ClientCrm } from '../lib/supabase'
import { cheminFicheEspace } from './chemins'
import { formaterDate, libelleRole } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 align-top py-2'

type EtatUtilisateurs =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur' }
	| { readonly statut: 'pret'; readonly terme: string; readonly utilisateurs: readonly UtilisateurPlateforme[] }

export function PlateformeUtilisateurs({ client }: { readonly client: ClientCrm }) {
	const id = useId()
	const [saisie, setSaisie] = useState('')
	const [etat, setEtat] = useState<EtatUtilisateurs>({ statut: 'chargement' })
	const [enLecture, setEnLecture] = useState(false)
	const [tentative, setTentative] = useState(0)

	// La lecture part après `DELAI_FRAPPE_MS` de repos (§5.46). La liste précédente RESTE affichée sous `aria-busy`
	// pendant la lecture suivante : le squelette est réservé au premier chargement.
	useEffect(() => {
		let vivant = true
		const terme = saisie.trim()
		setEnLecture(true)
		const minuterie = globalThis.setTimeout(() => {
			void lireUtilisateurs(client, terme).then((resultat) => {
				if (!vivant) return
				setEnLecture(false)
				setEtat(resultat.statut === 'pret' ? { statut: 'pret', terme, utilisateurs: resultat.donnees } : { statut: 'erreur' })
			})
		}, DELAI_FRAPPE_MS)
		return () => {
			vivant = false
			globalThis.clearTimeout(minuterie)
		}
	}, [client, saisie, tentative])

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 id={`${id}-titre`} className="text-h2">
					{t('platform.utilisateurs.titre')}
				</h2>
				<p className="text-sm text-text-2">{t('platform.utilisateurs.lelabs')}</p>
			</div>

			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-recherche`} className="text-sm text-text-2">
					{t('platform.utilisateurs.recherche')}
				</label>
				<div className="relative">
					<Search aria-hidden="true" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
					<input
						id={`${id}-recherche`}
						type="search"
						data-testid="recherche-utilisateurs"
						autoComplete="off"
						value={saisie}
						onChange={(evenement) => setSaisie(evenement.target.value)}
						// `pl-[36px]` : la marge de l'icône de 16 px et son écart, valeur arbitraire assumée, celle de la palette
						// (§5.46) — l'échelle close n'a pas de 36 px.
						className="w-full min-h-[var(--size-target)] pl-[36px] pr-3 rounded-sm border border-border bg-surface text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
					/>
				</div>
			</div>

			<ContenuUtilisateurs etat={etat} enLecture={enLecture} onReprise={() => setTentative((n) => n + 1)} />
		</section>
	)
}

function ContenuUtilisateurs({
	etat,
	enLecture,
	onReprise,
}: {
	readonly etat: EtatUtilisateurs
	readonly enLecture: boolean
	readonly onReprise: () => void
}) {
	if (etat.statut === 'chargement') return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.utilisateurs.erreur.title')}
				corps={t('platform.utilisateurs.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={onReprise}
			/>
		)
	}
	if (etat.utilisateurs.length === 0) {
		return (
			<EtatVide
				titre={t('platform.utilisateurs.vide.title')}
				corps={etat.terme === '' ? t('platform.utilisateurs.vide.body') : t('platform.utilisateurs.vide.recherche', { terme: etat.terme })}
			/>
		)
	}
	return (
		<div className="flex flex-col gap-2" aria-busy={enLecture}>
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-utilisateurs" className="w-full border-collapse">
					<caption className="sr-only">{t('platform.utilisateurs.titre')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.utilisateurs.colonne.nom')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.utilisateurs.colonne.espaces')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.superadmin')}</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.utilisateurs.colonne.connecteur')}</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.utilisateurs.colonne.depuis')}</th>
						</tr>
					</thead>
					<tbody>
						{etat.utilisateurs.map((utilisateur) => (
							<LigneUtilisateur key={utilisateur.id} utilisateur={utilisateur} />
						))}
					</tbody>
				</table>
			</div>
			{etat.utilisateurs.length >= BORNE_UTILISATEURS && (
				<p className="text-xs text-text-3" data-testid="troncature-utilisateurs">
					{t('platform.utilisateurs.troncature', { n: String(BORNE_UTILISATEURS) })}
				</p>
			)}
		</div>
	)
}

function LigneUtilisateur({ utilisateur }: { readonly utilisateur: UtilisateurPlateforme }) {
	return (
		<tr data-testid="ligne-utilisateur" data-id={utilisateur.id} className="border-b border-border hover:bg-hover">
			<th scope="row" className={`${CLASSES_CELLULE} text-left font-normal max-w-[32ch] truncate`} title={utilisateur.nom}>
				{utilisateur.nom}
			</th>
			<td className={CLASSES_CELLULE}>
				{utilisateur.espaces.length === 0 ? (
					<span className="text-text-2">{t('platform.utilisateurs.aucunEspace')}</span>
				) : (
					// Une liste de liens : la cellule se replie, la ligne gagne de la hauteur — en ellipse, des liens
					// disparaîtraient (§5.56, l'écart que le §5.31 assume pour sa mention).
					<ul className="flex flex-col gap-1">
						{utilisateur.espaces.map((espace) => (
							<li key={espace.slug} className="flex flex-wrap items-center gap-2">
								<Link to={cheminFicheEspace(espace.slug)} className="text-brand font-medium underline-offset-2 hover:underline">
									{espace.nom}
								</Link>
								{espace.role !== null && <Badge>{libelleRole(espace.role)}</Badge>}
							</li>
						))}
					</ul>
				)}
			</td>
			<td className={CLASSES_CELLULE}>{utilisateur.superadmin && <Badge ton="brand">{t('platform.membres.superadmin')}</Badge>}</td>
			<td className={`${CLASSES_CELLULE} text-right tabular-nums whitespace-nowrap`}>
				{utilisateur.connecteurDerniereActivite === null ? (
					<span className="text-text-2">{t('platform.utilisateurs.jamaisConnecte')}</span>
				) : (
					formaterDate(utilisateur.connecteurDerniereActivite)
				)}
			</td>
			<td className={`${CLASSES_CELLULE} text-right tabular-nums whitespace-nowrap`}>{formaterDate(utilisateur.creeLe)}</td>
		</tr>
	)
}
