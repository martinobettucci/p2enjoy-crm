// @spec CRM-103 (docs/BACKLOG.md) — tranche T2 : la fiche d'un utilisateur pour le connecteur, et sa matrice
// @spec docs/SPEC-mcp.md §8.1 (fiche de tout utilisateur, venu ou non ; sélecteur d'espace dans l'adresse ; rôle dans le
//       CRM et « pas membre » ; superadministrateur qui franchit la matrice ; enregistrement de la matrice entière), §8.2
//       (`mcp_compte`, `mcp_poser_droits`, refus), §6.1 (familles et actions) ; docs/DESIGN_SYSTEM.md §5.56 (onglet
//       « Connecteur MCP », fiche), §5.29 ter et §5.59 (capacité rendue par la base, jamais un rôle lu), §5.34
//       (commande d'enregistrement unique), §5.7 bis (case de 24 px), §5.15 (nom accessible famille ET action), §5.8
// @spec Arbitrages A2 (le droit effectif est l'intersection de la matrice et du CRM), A5 et D9 (un compte sans profil n'a
//       pas de matrice) ; CLAUDE.md §10 — l'écran ne décide aucun droit : la base garde chaque lecture et chaque écriture

import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	ACTIONS_MCP,
	FAMILLES_MCP,
	caseMcp,
	lireFicheMcp,
	poserDroitsMcp,
	type ActionMcp,
	type CaseMcp,
	type EspaceFicheMcp,
	type FamilleMcp,
	type FicheMcp,
} from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_PLATEFORME_MCP } from './chemins'
import { JournalAppelsMcp } from './JournalAppelsMcp'
import { formaterDate, libelleAction, libelleFamille, libelleRole, porteeFamille, texteRefus } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 whitespace-nowrap'
const CLASSES_BANDEAU =
	'flex items-start gap-2 rounded-lg bg-accent-soft text-accent-on-soft px-3 py-2 text-sm max-w-[70ch]'

type Message = { readonly ton: 'succes' | 'refus'; readonly texte: string } | null

const memes = (a: ReadonlySet<CaseMcp>, b: ReadonlySet<CaseMcp>): boolean => a.size === b.size && [...a].every((c) => b.has(c))
/** L'action dans une phrase — « Affaires : modifier » (§5.56) —, le libellé de colonne gardant sa majuscule. */
const actionEnPhrase = (action: ActionMcp): string => libelleAction(action).toLocaleLowerCase('fr-FR')

export function PlateformeMcpCompte({ client }: { readonly client: ClientCrm }) {
	const { sub = '' } = useParams()
	const [parametres, setParametres] = useSearchParams()
	const [etat, setEtat] = useState<EtatAsync<FicheMcp>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		let vivant = true
		void lireFicheMcp(client, sub).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, sub, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	if (etat.statut === 'chargement') return <SkeletonListe lignes={6} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur' && etat.erreur.detail === 'profil_introuvable') {
		return (
			<EtatVide
				titre={t('platform.mcp.fiche.introuvable.title')}
				corps={t('platform.mcp.fiche.introuvable.body')}
				action={
					<Link to={CHEMIN_PLATEFORME_MCP} className="inline-flex items-center min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white font-medium">
						{t('platform.mcp.fiche.retour')}
					</Link>
				}
			/>
		)
	}
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.mcp.fiche.erreur.title')}
				corps={t('platform.mcp.fiche.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={relire}
			/>
		)
	}

	const fiche = etat.donnees
	const slug = parametres.get('espace')
	const espace = fiche.espaces.find((e) => e.slug === slug) ?? fiche.espaces[0] ?? null

	return (
		<div className="flex flex-col gap-6" data-testid="fiche-mcp">
			<div className="flex flex-col gap-2">
				<Link to={CHEMIN_PLATEFORME_MCP} className="text-sm text-brand underline-offset-2 hover:underline self-start">
					{t('platform.mcp.fiche.retour')}
				</Link>
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="text-h2">{fiche.nom}</h2>
					{fiche.superadmin && <Badge ton="brand">{t('platform.membres.superadmin')}</Badge>}
				</div>
				{fiche.email !== null && <code className="text-sm">{fiche.email}</code>}
				<p className="text-text-2" data-testid="fiche-mcp-activite">
					{fiche.derniereActivite === null
						? t('platform.mcp.fiche.jamais')
						: t('platform.mcp.fiche.activite', { date: formaterDate(fiche.derniereActivite) })}
				</p>
			</div>

			{!fiche.avecProfil ? (
				<p role="status" data-testid="fiche-mcp-sans-profil" className={CLASSES_BANDEAU}>
					<TriangleAlert aria-hidden="true" size={16} className="mt-[2px] shrink-0" />
					<span>{t('platform.mcp.fiche.sansProfil')}</span>
				</p>
			) : espace === null ? (
				<p className="text-text-2">{t('platform.mcp.fiche.aucunEspace')}</p>
			) : (
				<MatriceMcp
					// Une matrice par fiche et par espace : changer d'espace repart de l'état enregistré (§5.56). La relecture
					// après un enregistrement ne la remonte pas : le message de l'issue doit rester lisible.
					key={`${fiche.sub}:${espace.slug}`}
					client={client}
					fiche={fiche}
					espace={espace}
					onEspace={(prochain) => setParametres({ espace: prochain }, { replace: true })}
					onEnregistre={relire}
				/>
			)}

			{fiche.connecte && <JournalAppelsMcp client={client} sub={fiche.sub} titre={t('platform.mcp.fiche.journal')} />}
		</div>
	)
}

type ProprietesMatrice = {
	readonly client: ClientCrm
	readonly fiche: FicheMcp
	readonly espace: EspaceFicheMcp
	readonly onEspace: (slug: string) => void
	readonly onEnregistre: () => void
}

function MatriceMcp({ client, fiche, espace, onEspace, onEnregistre }: ProprietesMatrice) {
	const id = useId()
	const [brouillon, setBrouillon] = useState<ReadonlySet<CaseMcp>>(espace.droits)
	const [vol, setVol] = useState(false)
	const [message, setMessage] = useState<Message>(null)
	// La matrice relue après un enregistrement devient l'état de référence de la saisie.
	useEffect(() => setBrouillon(espace.droits), [espace.droits])
	const modifie = useMemo(() => !memes(brouillon, espace.droits), [brouillon, espace.droits])
	// Le drapeau vient de la base sur la fiche : la matrice est franchie, ses cases restent lisibles (§5.29 ter).
	const franchie = fiche.superadmin

	const basculer = (famille: FamilleMcp, action: ActionMcp) => {
		setMessage(null)
		setBrouillon((precedent) => {
			const suivant = new Set(precedent)
			const c = caseMcp(famille, action)
			if (suivant.has(c)) suivant.delete(c)
			else suivant.add(c)
			return suivant
		})
	}
	const toutes = (lot: readonly CaseMcp[]) => {
		setMessage(null)
		setBrouillon((precedent) => {
			const suivant = new Set(precedent)
			const pleines = lot.every((c) => suivant.has(c))
			for (const c of lot) {
				if (pleines) suivant.delete(c)
				else suivant.add(c)
			}
			return suivant
		})
	}
	const enregistrer = async () => {
		setVol(true)
		const issue = await poserDroitsMcp(client, fiche.sub, espace.workspaceId, brouillon)
		setVol(false)
		if (issue.statut === 'ok') {
			setMessage({ ton: 'succes', texte: t('platform.mcp.enregistre') })
			onEnregistre()
		} else {
			setMessage({ ton: 'refus', texte: texteRefus(issue.refus) })
		}
	}

	const caseDeFamille = (famille: FamilleMcp) => ACTIONS_MCP.map((action) => caseMcp(famille, action))
	const caseDAction = (action: ActionMcp) => FAMILLES_MCP.map((famille) => caseMcp(famille, action))
	const pleines = (lot: readonly CaseMcp[]) => lot.every((c) => brouillon.has(c))

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-espace`} className="text-sm text-text-2">
					{t('platform.mcp.fiche.espace')}
				</label>
				<select
					id={`${id}-espace`}
					data-testid="choix-espace-mcp"
					value={espace.slug}
					disabled={modifie}
					aria-describedby={modifie ? `${id}-verrou` : undefined}
					onChange={(evenement) => onEspace(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:bg-hover"
				>
					{fiche.espaces.map((e) => (
						<option key={e.slug} value={e.slug}>
							{t('platform.mcp.fiche.espace.option', {
								nom: e.nom,
								role: e.role === null ? t('platform.mcp.fiche.espace.pasMembre') : libelleRole(e.role),
							})}
						</option>
					))}
				</select>
				{modifie && (
					<p id={`${id}-verrou`} className="text-sm text-text-3">
						{t('platform.mcp.fiche.espace.verrou')}
					</p>
				)}
			</div>

			{espace.role === null ? (
				<p role="status" data-testid="fiche-mcp-hors-espace" className={CLASSES_BANDEAU}>
					<TriangleAlert aria-hidden="true" size={16} className="mt-[2px] shrink-0" />
					<span>{t('platform.mcp.fiche.horsEspace')}</span>
				</p>
			) : (
				<p className="text-text-2" data-testid="fiche-mcp-role">
					{t('platform.mcp.fiche.role', { role: libelleRole(espace.role) })}
				</p>
			)}

			<h3 id={`${id}-titre`} className="text-h3">
				{t('platform.mcp.matrice.titre', { espace: espace.nom })}
			</h3>
			{franchie && (
				<MotifLectureSeule id={`${id}-franchie`} data-testid="fiche-mcp-franchie">
					{t('platform.mcp.fiche.superadmin')}
				</MotifLectureSeule>
			)}
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="matrice-mcp" className="border-collapse">
					<caption className="sr-only">{t('platform.mcp.matrice.titre', { espace: espace.nom })}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={`${CLASSES_ENTETE} text-left`}>
								{t('platform.mcp.matrice.famille')}
							</th>
							{ACTIONS_MCP.map((action) => {
								const lot = caseDAction(action)
								return (
									<th key={action} scope="col" className={`${CLASSES_ENTETE} text-center align-bottom py-2`}>
										<span className="flex flex-col items-center gap-1">
											<span>{libelleAction(action)}</span>
											<Button
												variante="discret"
												taille="compacte"
												disabled={franchie || vol}
												aria-describedby={franchie ? `${id}-franchie` : undefined}
												aria-label={t(pleines(lot) ? 'platform.mcp.toute.action.decocher' : 'platform.mcp.toute.action.cocher', {
													action: actionEnPhrase(action),
												})}
												onClick={() => toutes(lot)}
											>
												{t('platform.mcp.toute.action')}
											</Button>
										</span>
									</th>
								)
							})}
						</tr>
					</thead>
					<tbody>
						{FAMILLES_MCP.map((famille) => {
							const lot = caseDeFamille(famille)
							return (
								<tr key={famille} data-testid="ligne-famille" data-famille={famille} className="border-b border-border">
									<th scope="row" className="px-3 py-2 text-left font-normal align-top">
										<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
											<span className="font-medium text-ink">{libelleFamille(famille)}</span>
											<Button
												variante="discret"
												taille="compacte"
												disabled={franchie || vol}
												aria-describedby={franchie ? `${id}-franchie` : undefined}
												aria-label={t(pleines(lot) ? 'platform.mcp.toute.famille.decocher' : 'platform.mcp.toute.famille.cocher', {
													famille: libelleFamille(famille),
												})}
												onClick={() => toutes(lot)}
											>
												{t('platform.mcp.toute.famille')}
											</Button>
										</span>
										<span className="block text-sm text-text-2">{porteeFamille(famille)}</span>
									</th>
									{ACTIONS_MCP.map((action) => (
										<td key={action} className="px-3 text-center align-middle">
											<label className="inline-flex items-center justify-center min-h-[var(--size-target)] min-w-[var(--size-target)] cursor-pointer">
												<input
													type="checkbox"
													data-testid={`case-${famille}-${action}`}
													checked={brouillon.has(caseMcp(famille, action))}
													disabled={franchie || vol}
													aria-label={t('platform.mcp.case.aria', { famille: libelleFamille(famille), action: actionEnPhrase(action) })}
													aria-describedby={franchie ? `${id}-franchie` : undefined}
													onChange={() => basculer(famille, action)}
													className="size-6 accent-brand"
												/>
											</label>
										</td>
									))}
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<Button variante="primaire" disabled={!modifie || vol || franchie} onClick={() => void enregistrer()} data-testid="enregistrer-mcp">
						{vol ? t('platform.mcp.enregistrement') : t('platform.mcp.enregistrer')}
					</Button>
					<Button
						disabled={!modifie || vol}
						onClick={() => {
							setBrouillon(espace.droits)
							setMessage(null)
						}}
					>
						{t('platform.mcp.annuler')}
					</Button>
					{modifie && <span className="text-sm text-text-3">{t('platform.mcp.nonEnregistre')}</span>}
				</div>
				{message !== null &&
					(message.ton === 'succes' ? (
						<p role="status" data-testid="message-mcp" className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm self-start">
							{message.texte}
						</p>
					) : (
						<p role="alert" data-testid="message-mcp" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm self-start">
							{message.texte}
						</p>
					))}
			</div>
		</section>
	)
}
