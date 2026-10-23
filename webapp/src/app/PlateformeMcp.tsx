// @spec CRM-103 (docs/BACKLOG.md) — tranche T2 : l'onglet « Connecteur MCP » de la plateforme
// @spec docs/SPEC-mcp.md §8.1 (comptes, « Accorder des droits à un utilisateur » par `plateforme_utilisateurs`, journal
//       des appels), §8.2 (`mcp_comptes_liste`) ; docs/DESIGN_SYSTEM.md §5.56 (onglet « Connecteur MCP » : trois blocs
//       dans l'ordre, nom en lien, « Sans profil dans le CRM » en pilule `accent`, recherche reprise de l'onglet
//       « Utilisateurs »), §5.9, §5.8, §5.46 ; arbitrages A3 et A5
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : chaque lecture est gardée en base par le drapeau

import { Search } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireComptesMcp, lireUtilisateurs, type CompteMcp, type UtilisateurPlateforme } from '../lib/plateforme'
import { DELAI_FRAPPE_MS } from '../lib/recherche'
import type { ClientCrm } from '../lib/supabase'
import { cheminFicheMcp } from './chemins'
import { JournalAppelsMcp } from './JournalAppelsMcp'
import { formaterDate } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_DROITE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'
const CLASSES_LIEN = 'text-brand font-medium underline-offset-2 hover:underline'

export function PlateformeMcp({ client }: { readonly client: ClientCrm }) {
	return (
		<div className="flex flex-col gap-8" data-testid="plateforme-mcp">
			<ComptesMcp client={client} />
			<AccorderDroits client={client} />
			<JournalAppelsMcp client={client} titre={t('platform.mcp.journal.titre')} />
		</div>
	)
}

function ComptesMcp({ client }: { readonly client: ClientCrm }) {
	const id = useId()
	const [etat, setEtat] = useState<EtatAsync<readonly CompteMcp[]>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		let vivant = true
		void lireComptesMcp(client).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
			<h2 id={`${id}-titre`} className="text-h2">
				{t('platform.mcp.comptes.titre')}
			</h2>
			{etat.statut === 'chargement' && <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />}
			{etat.statut === 'erreur' && (
				<EtatErreur
					titre={t('platform.mcp.comptes.erreur.title')}
					corps={t('platform.mcp.comptes.erreur.body')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			)}
			{etat.statut === 'pret' && etat.donnees.length === 0 && (
				<p className="text-text-2" data-testid="comptes-mcp-vide">
					{t('platform.mcp.comptes.vide')}
				</p>
			)}
			{etat.statut === 'pret' && etat.donnees.length > 0 && (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-comptes-mcp" className="w-full border-collapse">
						<caption className="sr-only">{t('platform.mcp.comptes.titre')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.utilisateurs.colonne.nom')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.mcp.comptes.colonne.adresse')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.mcp.comptes.colonne.activite')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.mcp.comptes.colonne.espaces')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.superadmin')}</th>
							</tr>
						</thead>
						<tbody>
							{etat.donnees.map((compte) => (
								<tr key={compte.sub} data-testid="ligne-compte-mcp" data-sub={compte.sub} className="border-b border-border hover:bg-hover">
									{/* Une seule ligne (§5.9) : replié, le nom passait sur deux lignes et la pilule « Sans profil » se
									    cassait mot à mot sous 1024 px — constaté sur les captures de T3. Le tableau défile dans son conteneur. */}
									<th scope="row" className="h-[var(--size-target)] px-3 text-left font-normal whitespace-nowrap">
										<span className="flex items-center gap-2">
											<Link to={cheminFicheMcp(compte.sub)} className={CLASSES_LIEN}>
												{compte.nom}
											</Link>
											{!compte.avecProfil && <Badge ton="accent">{t('platform.mcp.sansProfil')}</Badge>}
										</span>
									</th>
									<td className={CLASSES_CELLULE} title={compte.email}>
										<code>{compte.email}</code>
									</td>
									<td className={CLASSES_DROITE}>{formaterDate(compte.derniereActivite)}</td>
									<td className={CLASSES_DROITE}>{compte.espacesOuverts}</td>
									<td className="h-[var(--size-target)] px-3">{compte.superadmin && <Badge ton="brand">{t('platform.membres.superadmin')}</Badge>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

type EtatRecherche =
	| { readonly statut: 'repos' }
	| { readonly statut: 'erreur' }
	| { readonly statut: 'pret'; readonly terme: string; readonly utilisateurs: readonly UtilisateurPlateforme[] }

/** Chercher un utilisateur du CRM, venu ou non au connecteur, pour ouvrir sa fiche (A5). Rien n'est listé à vide. */
function AccorderDroits({ client }: { readonly client: ClientCrm }) {
	const id = useId()
	const [saisie, setSaisie] = useState('')
	const [etat, setEtat] = useState<EtatRecherche>({ statut: 'repos' })
	const [enLecture, setEnLecture] = useState(false)

	useEffect(() => {
		const terme = saisie.trim()
		if (terme === '') {
			setEnLecture(false)
			setEtat({ statut: 'repos' })
			return
		}
		let vivant = true
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
	}, [client, saisie])

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-3">
			<h2 id={`${id}-titre`} className="text-h2">
				{t('platform.mcp.accorder.titre')}
			</h2>
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-recherche`} className="text-sm text-text-2">
					{t('platform.utilisateurs.recherche')}
				</label>
				<div className="relative">
					<Search aria-hidden="true" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
					<input
						id={`${id}-recherche`}
						type="search"
						data-testid="recherche-accorder"
						autoComplete="off"
						value={saisie}
						aria-describedby={`${id}-aide`}
						onChange={(evenement) => setSaisie(evenement.target.value)}
						className="w-full min-h-[var(--size-target)] pl-[36px] pr-3 rounded-sm border border-border bg-surface text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
					/>
				</div>
				<p id={`${id}-aide`} className="text-sm text-text-3">
					{t('platform.mcp.accorder.aide')}
				</p>
			</div>
			<div aria-busy={enLecture} aria-live="polite">
				{etat.statut === 'erreur' && (
					<p role="alert" className="text-sm text-danger-on-soft">
						{t('platform.mcp.accorder.erreur')}
					</p>
				)}
				{etat.statut === 'pret' && etat.utilisateurs.length === 0 && (
					<p className="text-text-2">{t('platform.utilisateurs.vide.recherche', { terme: etat.terme })}</p>
				)}
				{etat.statut === 'pret' && etat.utilisateurs.length > 0 && (
					<ul className="flex flex-col" data-testid="resultats-accorder">
						{etat.utilisateurs.map((utilisateur) => (
							<li key={utilisateur.id} className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)] border-b border-border">
								<Link to={cheminFicheMcp(utilisateur.id)} className={CLASSES_LIEN}>
									{utilisateur.nom}
								</Link>
								{utilisateur.connecteurDerniereActivite === null && (
									<span className="text-sm text-text-2">{t('platform.utilisateurs.jamaisConnecte')}</span>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	)
}
