// @spec CRM-144 (docs/BACKLOG.md) — tranche T3 : l'outbox dans l'inbox — les trois entrées de tête « En file », « Envoyés »,
//       « Échecs », la liste de chaque dossier, le détail d'un envoi, « Annuler l'envoi » confirmé dans le flux,
//       « Réessayer » sans confirmation, l'envoi en cours d'envoi et l'issue incertaine sans commande, les commandes selon
//       la capacité rendue par la base sur la ligne (docs/DESIGN_SYSTEM.md §5.98, §5.59, §5.13 ; docs/SPEC-mail-subsystem.md
//       §28.3 à §28.7 ; décisions 898, 906 et 910)
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. La liste est ce que la RLS de `mail_outbox` laisse passer ; la commande s'éteint avec son
// motif quand la base rend `outbox_gestes_permis` faux sur la ligne, et reste offerte quand elle ne l'a pas rendu. Les
// deux gestes sont des fonctions de la base, qui refusent de toute façon, et leur refus est traduit dans le bloc.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Ban, MailWarning, Mails, Redo2, Send, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { lireCheminCard, textePastille } from '../lib/inbox'
import {
	DOSSIERS_ENVOI,
	PAGE_ENVOYES,
	annulerEnvoi,
	classerMotif,
	departEchu,
	gesteDe,
	lireEnvois,
	reessayerEnvoi,
	type ComptesEnvois,
	type DossierEnvoi,
	type EnvoiOutbox,
	type MotifEnvoi,
	type PageEnvois,
	type RefusEnvoiOutbox,
} from '../lib/outbox'
import { clientCrm } from '../lib/supabase'
import { Panneau } from './PanneauInbox'

const dateCourte = (iso: string): string =>
	new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

const LIBELLE: Record<DossierEnvoi, CleTraduction> = {
	file: 'outbox.dossier.file',
	envoyes: 'outbox.dossier.envoyes',
	echecs: 'outbox.dossier.echecs',
}
const ICONE: Record<DossierEnvoi, typeof Mails> = { file: Mails, envoyes: Send, echecs: MailWarning }
const VIDE: Record<DossierEnvoi, CleTraduction> = {
	file: 'outbox.liste.vide.file',
	envoyes: 'outbox.liste.vide.envoyes',
	echecs: 'outbox.liste.vide.echecs',
}

/** Le dictionnaire des motifs (§28.7), clé par clé : aucune clé n'est composée, le contrôle des clés les voit toutes. */
const PHRASE_MOTIF: Readonly<Record<MotifEnvoi, CleTraduction>> = {
	auth_failed: 'outbox.motif.auth_failed',
	tls_failed: 'outbox.motif.tls_failed',
	timeout: 'outbox.motif.timeout',
	host_unreachable: 'outbox.motif.host_unreachable',
	connection_refused: 'outbox.motif.connection_refused',
	protocol_error: 'outbox.motif.protocol_error',
	quota_exceeded: 'outbox.motif.quota_exceeded',
	credentials_missing: 'outbox.motif.credentials_missing',
	storage_unavailable: 'outbox.motif.storage_unavailable',
	attachment_infected: 'outbox.motif.attachment_infected',
	attachment_missing: 'outbox.motif.attachment_missing',
	worker_interrompu: 'outbox.motif.worker_interrompu',
	inconnu: 'outbox.motif.inconnu',
}

/** Le dictionnaire des refus (§28.3, §28.4), clé par clé. */
const PHRASE_REFUS: Readonly<Record<RefusEnvoiOutbox, CleTraduction>> = {
	parti: 'outbox.refus.parti',
	en_cours: 'outbox.refus.en_cours',
	deja_annule: 'outbox.refus.deja_annule',
	en_echec: 'outbox.refus.en_echec',
	deja_en_file: 'outbox.refus.deja_en_file',
	incertain: 'outbox.refus.incertain',
	introuvable: 'outbox.refus.introuvable',
	refuse: 'outbox.refus.refuse',
	affaire_indisponible: 'outbox.refus.affaire_indisponible',
	quota: 'outbox.refus.quota',
	reseau: 'outbox.refus.reseau',
	inconnu: 'outbox.refus.inconnu',
}

/** La phrase d'un motif (§28.7) ; un code inconnu rend « cause non reconnue », jamais le code brut. */
export function phraseMotif(code: string | null): string | null {
	const motif = classerMotif(code)
	return motif === null ? null : t(PHRASE_MOTIF[motif])
}

// =================================================================================================
// Panneau 1 — les trois entrées de tête
// =================================================================================================

/**
 * Les trois entrées de l'outbox (§5.98) : toujours rendues, à zéro compris ; le compte n'est pas rendu pendant la lecture
 * ni sur son échec ; seule « Échecs » porte la pastille du §5.43, en teinte de danger, parce qu'un échec attend un geste.
 */
export function EntreesEnvois({
	comptes,
	choisi,
	onChoisir,
	refs,
}: {
	readonly comptes: EtatAsync<ComptesEnvois>
	readonly choisi: DossierEnvoi | null
	readonly onChoisir: (dossier: DossierEnvoi) => void
	readonly refs: Readonly<Record<DossierEnvoi, React.RefObject<HTMLButtonElement | null>>>
}) {
	return (
		<ul aria-label={t('outbox.groupe')} data-testid="inbox-envois" className="border-b border-border pb-1 mb-1">
			{DOSSIERS_ENVOI.map((dossier) => {
				const nombre = comptes.statut === 'pret' ? comptes.donnees[dossier] : null
				const libelle = t(LIBELLE[dossier])
				const pastille = dossier === 'echecs' && nombre !== null ? textePastille(nombre) : null
				const Icone = ICONE[dossier]
				return (
					<li key={dossier}>
						<button
							ref={refs[dossier]}
							type="button"
							aria-current={choisi === dossier ? 'true' : undefined}
							aria-label={
								nombre === null
									? t('outbox.dossier.aria.lecture', { dossier: libelle })
									: nombre === 1
										? t('outbox.dossier.aria.one', { dossier: libelle })
										: t('outbox.dossier.aria.many', { dossier: libelle, n: String(nombre) })
							}
							onClick={() => onChoisir(dossier)}
							data-testid={`inbox-envois-${dossier}`}
							className={[
								'w-full min-w-0 flex items-center justify-between gap-2 text-left',
								'min-h-[var(--size-target)] pl-3 pr-3 py-1',
								'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
								choisi === dossier ? 'bg-brand-soft text-brand font-medium' : 'text-ink hover:bg-hover',
								pastille !== null ? 'font-medium' : '',
							].join(' ')}
						>
							<span className="flex items-center gap-2 min-w-0">
								<Icone aria-hidden="true" size={16} className="shrink-0" />
								<span className="truncate min-w-0">{libelle}</span>
							</span>
							<span aria-hidden="true" className="shrink-0 flex items-center gap-2">
								{pastille === null ? null : (
									<span className="min-w-4 px-1 rounded-full bg-danger text-white text-xs tabular-nums leading-tight text-center font-normal">
										{pastille}
									</span>
								)}
								{nombre === null ? null : (
									<span className="text-sm text-text-3 tabular-nums font-normal">{nombre}</span>
								)}
							</span>
						</button>
					</li>
				)
			})}
		</ul>
	)
}

// =================================================================================================
// Panneaux 2 et 3 — la liste d'un dossier et le détail d'un envoi
// =================================================================================================

/** La date d'une ligne, selon le dossier (§5.98). */
function dateDeLigne(envoi: EnvoiOutbox, dossier: DossierEnvoi, maintenant: Date): string {
	if (dossier === 'file') {
		return departEchu(envoi, maintenant)
			? t('outbox.liste.prochainPassage')
			: t('outbox.liste.prevu', { date: dateCourte(envoi.prevuLe) })
	}
	if (dossier === 'envoyes') return t('outbox.liste.envoyeLe', { date: dateCourte(envoi.envoyeLe ?? envoi.misAJourLe) })
	return t('outbox.liste.echecLe', { date: dateCourte(envoi.misAJourLe) })
}

function LigneEnvoi({
	envoi,
	dossier,
	ouvert,
	maintenant,
	onOuvrir,
}: {
	readonly envoi: EnvoiOutbox
	readonly dossier: DossierEnvoi
	readonly ouvert: boolean
	readonly maintenant: Date
	readonly onOuvrir: () => void
}) {
	const motif = phraseMotif(envoi.motif)
	return (
		<li className="border-b border-border">
			<button
				type="button"
				aria-current={ouvert ? 'true' : undefined}
				onClick={onOuvrir}
				data-testid="inbox-envoi"
				data-envoi={envoi.id}
				className={[
					'w-full text-left flex flex-col gap-1 px-3 py-2 min-h-[var(--size-target)]',
					'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
					ouvert ? 'bg-brand-soft' : 'hover:bg-hover',
				].join(' ')}
			>
				<span className="text-sm text-text-2 break-words">{envoi.destinataires.join(', ')}</span>
				<span className="font-medium break-words">{envoi.objet}</span>
				{dossier === 'echecs' && motif !== null ? (
					<span className="flex items-start gap-1 text-sm text-danger-on-soft">
						<MailWarning aria-hidden="true" size={14} className="shrink-0 mt-[3px]" />
						<span className="break-words">{motif}</span>
					</span>
				) : null}
				{envoi.titreCard === null ? null : (
					<span className="text-sm text-text-2 break-words">{envoi.titreCard}</span>
				)}
				<span className="flex flex-wrap items-center gap-2 text-sm text-text-2">
					{envoi.expediteur === null ? null : <code className="break-all">{envoi.expediteur}</code>}
					{envoi.auteur === null ? null : <span>{t('outbox.liste.par', { auteur: envoi.auteur })}</span>}
				</span>
				<span className="flex flex-wrap items-center gap-2">
					{envoi.statut === 'sending' ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 text-xs text-text-2">
							<span aria-hidden="true" className="size-1 rounded-full bg-text-3" />
							{t('outbox.liste.enCours')}
						</span>
					) : null}
					<span className="font-mono text-xs text-text-3 tabular-nums">{dateDeLigne(envoi, dossier, maintenant)}</span>
				</span>
				{dossier === 'file' && envoi.essais > 0 && motif !== null ? (
					<span className="text-sm text-text-2 break-words">
						{envoi.essais === 1
							? t('outbox.liste.essais.one', { motif })
							: t('outbox.liste.essais', { n: String(envoi.essais), motif })}
					</span>
				) : null}
			</button>
		</li>
	)
}

export function PanneauListeEnvois({
	dossier,
	etat,
	idOuvert,
	maintenant,
	onOuvrir,
	onRetour,
	onReprise,
	onPlus,
	visible,
}: {
	readonly dossier: DossierEnvoi
	readonly etat: EtatAsync<PageEnvois>
	readonly idOuvert: string | null
	readonly maintenant: Date
	readonly onOuvrir: (id: string) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly onPlus: () => void
	readonly visible: boolean
}) {
	return (
		<Panneau
			id="envois"
			titre={t(LIBELLE[dossier])}
			visible={visible}
			classe="lg:w-[var(--size-inbox-list)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.folders')}
				</Button>
			}
		>
			{etat.statut === 'chargement' ? <SkeletonListe lignes={3} libelle={t('state.loading.aria')} /> : null}
			{etat.statut === 'erreur' ? (
				<div role="alert">
					<EtatErreur
						titre={t('outbox.liste.erreur')}
						corps={t('state.error.unknown')}
						libelleReprise={t('state.error.retry')}
						onReprise={onReprise}
					/>
				</div>
			) : null}
			{etat.statut === 'pret' && etat.donnees.envois.length === 0 ? <EtatVide titre={t(VIDE[dossier])} corps="" /> : null}
			{etat.statut === 'pret' && etat.donnees.envois.length > 0 ? (
				<>
					<ul data-testid="inbox-liste-envois" data-dossier={dossier}>
						{etat.donnees.envois.map((envoi) => (
							<LigneEnvoi
								key={envoi.id}
								envoi={envoi}
								dossier={dossier}
								ouvert={envoi.id === idOuvert}
								maintenant={maintenant}
								onOuvrir={() => onOuvrir(envoi.id)}
							/>
						))}
					</ul>
					{etat.donnees.plusAnciens ? (
						<div className="p-3">
							<Button taille="compacte" onClick={onPlus} data-testid="inbox-envois-plus">
								{t('outbox.liste.plus')}
							</Button>
						</div>
					) : null}
				</>
			) : null}
		</Panneau>
	)
}

/** Une ligne terme / valeur du détail (§5.3 bis) ; absente quand la valeur l'est. */
function Donnee({ terme, children }: { readonly terme: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1 md:flex-row md:gap-3">
			<dt className="text-sm text-text-2 md:w-[var(--size-placeholder)] shrink-0">{terme}</dt>
			<dd className="min-w-0 break-words">{children}</dd>
		</div>
	)
}

/** Les commandes d'un envoi et leurs issues (§5.98). */
function CommandesEnvoi({
	envoi,
	onFait,
	onRelire,
}: {
	readonly envoi: EnvoiOutbox
	readonly onFait: (geste: 'annule' | 'reessaye') => void
	readonly onRelire: () => void
}) {
	const geste = gesteDe(envoi)
	const [confirmation, setConfirmation] = useState(false)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<RefusEnvoiOutbox | null>(null)
	const refCommande = useRef<HTMLButtonElement | null>(null)
	const refConfirmer = useRef<HTMLButtonElement | null>(null)
	const idMotif = useId()
	const idQuestion = useId()
	// LA CAPACITÉ RENDUE PAR LA BASE (§5.59) : refusée, la commande reste montée, `disabled`, lisible, et cite le motif ;
	// non lue (`null`), elle reste offerte.
	const refusee = envoi.gestesPermis === false

	useEffect(() => {
		if (confirmation) refConfirmer.current?.focus()
	}, [confirmation])

	const abandonner = useCallback(() => {
		setConfirmation(false)
		// LE FOCUS REVIENT À LA COMMANDE QUI A OUVERT LA CONFIRMATION (§5.13).
		requestAnimationFrame(() => refCommande.current?.focus())
	}, [])

	const executer = useCallback(
		async (fonction: typeof annulerEnvoi, issue: 'annule' | 'reessaye') => {
			setEnVol(true)
			setRefus(null)
			const resultat = await fonction(clientCrm, envoi.id)
			setEnVol(false)
			if (resultat === null) {
				setConfirmation(false)
				onFait(issue)
				return
			}
			setRefus(resultat)
			// L'ÉTAT A CHANGÉ SOUS LES YEUX : la liste est relue (§5.98).
			onRelire()
		},
		[envoi.id, onFait, onRelire],
	)

	if (geste === 'en_cours') {
		return (
			<p className="text-sm text-text-2" data-testid="inbox-envoi-en-cours">
				{t('outbox.enCours.phrase')}
			</p>
		)
	}
	if (geste === 'incertain') {
		return (
			<p
				role="note"
				data-testid="inbox-envoi-incertain"
				className="flex items-start gap-2 rounded-sm bg-accent-soft p-3 text-sm text-accent-on-soft"
			>
				<TriangleAlert aria-hidden="true" size={16} className="shrink-0 mt-[2px]" />
				{t('outbox.incertain.phrase')}
			</p>
		)
	}
	if (geste === 'aucun') return null

	return (
		<div className="flex flex-col gap-3 border-t border-border pt-3" data-testid="inbox-envoi-commandes">
			{refusee ? (
				<MotifLectureSeule id={idMotif} data-testid="inbox-envoi-motif">
					{t('outbox.motifLectureSeule')}
				</MotifLectureSeule>
			) : null}
			{geste === 'annuler' ? (
				<>
					<div className="flex flex-wrap gap-2">
						<Button
							ref={refCommande}
							disabled={refusee || enVol}
							aria-describedby={refusee ? idMotif : undefined}
							aria-expanded={confirmation}
							onClick={() => {
								setRefus(null)
								setConfirmation(true)
							}}
							data-testid="inbox-envoi-annuler"
						>
							<Ban aria-hidden="true" size={16} />
							{t('outbox.annuler')}
						</Button>
					</div>
					{confirmation ? (
						<div
							role="group"
							aria-labelledby={idQuestion}
							data-testid="inbox-envoi-confirmation"
							className="flex flex-col gap-3 rounded-lg border border-border p-3"
							onKeyDown={(evenement) => {
								if (evenement.key === 'Escape' && !enVol) {
									evenement.stopPropagation()
									abandonner()
								}
							}}
						>
							<p id={idQuestion} className="break-words">
								{t('outbox.annuler.question', { objet: envoi.objet })}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									ref={refConfirmer}
									variante="destructif"
									disabled={enVol}
									aria-busy={enVol ? 'true' : undefined}
									onClick={() => void executer(annulerEnvoi, 'annule')}
									data-testid="inbox-envoi-annuler-confirmer"
								>
									{enVol ? t('outbox.annuler.enCours') : t('outbox.annuler.confirmer')}
								</Button>
								<Button disabled={enVol} onClick={abandonner} data-testid="inbox-envoi-annuler-garder">
									{t('outbox.annuler.garder')}
								</Button>
							</div>
						</div>
					) : null}
				</>
			) : (
				<div className="flex flex-wrap gap-2">
					<Button
						variante="primaire"
						disabled={refusee || enVol}
						aria-describedby={refusee ? idMotif : undefined}
						aria-busy={enVol ? 'true' : undefined}
						onClick={() => void executer(reessayerEnvoi, 'reessaye')}
						data-testid="inbox-envoi-reessayer"
					>
						<Redo2 aria-hidden="true" size={16} />
						{enVol ? t('outbox.reessayer.enCours') : t('outbox.reessayer')}
					</Button>
				</div>
			)}
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="inbox-envoi-refus"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft p-3 text-sm text-danger-on-soft"
				>
					<TriangleAlert aria-hidden="true" size={16} className="shrink-0 mt-[2px]" />
					{t(PHRASE_REFUS[refus])}
				</p>
			)}
		</div>
	)
}

export function PanneauDetailEnvoi({
	dossier,
	etat,
	idOuvert,
	onRetour,
	onFait,
	onRelire,
	visible,
}: {
	readonly dossier: DossierEnvoi
	readonly etat: EtatAsync<PageEnvois>
	readonly idOuvert: string | null
	readonly onRetour: () => void
	readonly onFait: (geste: 'annule' | 'reessaye') => void
	readonly onRelire: () => void
	readonly visible: boolean
}) {
	const envoi = etat.statut === 'pret' ? (etat.donnees.envois.find((candidat) => candidat.id === idOuvert) ?? null) : null
	const idCard = envoi?.idCard ?? null
	const [cheminCard, setCheminCard] = useState<{ readonly titre: string; readonly adresse: string } | null>(null)
	useEffect(() => {
		setCheminCard(null)
		if (idCard === null) return
		let vivant = true
		void lireCheminCard(clientCrm, idCard).then((lu) => {
			if (vivant) setCheminCard(lu)
		})
		return () => {
			vivant = false
		}
	}, [idCard])
	const motif = envoi === null ? null : phraseMotif(envoi.motif)
	return (
		<Panneau
			id="envoi"
			titre={t('outbox.detail.titre')}
			visible={visible}
			classe="flex-1 w-full min-w-0"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('outbox.retour')}
				</Button>
			}
		>
			{etat.statut === 'pret' && idOuvert === null ? (
				<EtatVide titre={t('outbox.detail.aucun.titre')} corps={t('outbox.detail.aucun.corps')} />
			) : null}
			{etat.statut === 'pret' && idOuvert !== null && envoi === null ? (
				<div data-testid="inbox-envoi-introuvable">
					<EtatVide titre={t('outbox.detail.introuvable')} corps="" />
				</div>
			) : null}
			{envoi === null ? null : (
				<article className="flex flex-col gap-4 p-4" data-testid="inbox-envoi-detail" data-envoi={envoi.id}>
					<h3 className="text-h3 font-bold text-ink break-words">{envoi.objet}</h3>
					<dl className="flex flex-col gap-2">
						<Donnee terme={t('outbox.detail.destinataires')}>{envoi.destinataires.join(', ')}</Donnee>
						{envoi.copies.length === 0 ? null : (
							<Donnee terme={t('outbox.detail.copie')}>{envoi.copies.join(', ')}</Donnee>
						)}
						{envoi.copiesCachees.length === 0 ? null : (
							<Donnee terme={t('outbox.detail.copieCachee')}>{envoi.copiesCachees.join(', ')}</Donnee>
						)}
						<Donnee terme={t('outbox.detail.expediteur')}>
							{envoi.expediteur === null ? t('outbox.detail.inconnu') : <code className="break-all">{envoi.expediteur}</code>}
						</Donnee>
						<Donnee terme={t('outbox.detail.auteur')}>{envoi.auteur ?? t('outbox.detail.inconnu')}</Donnee>
						<Donnee terme={t('outbox.detail.affaire')}>
							{cheminCard === null ? (
								(envoi.titreCard ?? t('outbox.detail.inconnu'))
							) : (
								<Link
									to={cheminCard.adresse}
									data-testid="inbox-envoi-card"
									className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
								>
									{cheminCard.titre}
								</Link>
							)}
						</Donnee>
						{dossier === 'file' ? (
							<Donnee terme={t('outbox.detail.prevu')}>
								<code>{departEchu(envoi, new Date()) ? t('outbox.liste.prochainPassage') : dateCourte(envoi.prevuLe)}</code>
							</Donnee>
						) : null}
						{dossier === 'envoyes' ? (
							<Donnee terme={t('outbox.detail.envoyeLe')}>
								<code>{dateCourte(envoi.envoyeLe ?? envoi.misAJourLe)}</code>
							</Donnee>
						) : null}
						{dossier === 'echecs' ? (
							<Donnee terme={t('outbox.detail.echecLe')}>
								<code>{dateCourte(envoi.misAJourLe)}</code>
							</Donnee>
						) : null}
						{motif === null ? null : <Donnee terme={t('outbox.detail.motif')}>{motif}</Donnee>}
						{envoi.essais > 0 ? (
							<Donnee terme={t('outbox.detail.essais')}>
								<code>{envoi.essais}</code>
							</Donnee>
						) : null}
					</dl>
					<p className="whitespace-pre-wrap break-words">{envoi.corps}</p>
					<CommandesEnvoi key={envoi.id} envoi={envoi} onFait={onFait} onRelire={onRelire} />
				</article>
			)}
		</Panneau>
	)
}

/** La lecture d'un dossier, sa page et sa relecture. */
export function useEnvois(dossier: DossierEnvoi | null): {
	readonly etat: EtatAsync<PageEnvois>
	readonly relire: () => void
	readonly plus: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<PageEnvois>>({ statut: 'chargement' })
	const [limite, setLimite] = useState(PAGE_ENVOYES)
	const [essai, setEssai] = useState(0)
	useEffect(() => {
		setLimite(PAGE_ENVOYES)
	}, [dossier])
	useEffect(() => {
		if (dossier === null) return
		let vivant = true
		// UNE RELECTURE N'EFFACE PAS LA LISTE QU'ELLE RELIT (§5.13) : le squelette ne paraît qu'au premier chargement d'un
		// dossier.
		void lireEnvois(clientCrm, dossier, limite).then((lu) => {
			if (vivant) setEtat(lu)
		})
		return () => {
			vivant = false
		}
	}, [dossier, limite, essai])
	useEffect(() => {
		setEtat({ statut: 'chargement' })
	}, [dossier])
	return {
		etat,
		relire: useCallback(() => setEssai((n) => n + 1), []),
		plus: useCallback(() => setLimite((n) => n + PAGE_ENVOYES), []),
	}
}
