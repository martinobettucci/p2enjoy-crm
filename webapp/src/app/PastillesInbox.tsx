// @spec CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles d'un mail dans l'inbox — dans la ligne d'un fil (trois au
//       plus, puis « +n »), le filtre « Pastille » et son état vide, et le message ouvert : la ligne de ses pastilles et de
//       son état d'évaluation, « Réévaluer les pastilles », « Pastilles » et son panneau de cases
// @spec docs/SPEC-mail-subsystem.md §31.4 (les gestes et leurs refus), §31.7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.103,
//       §5.73 (la grammaire des étiquettes reprise), §5.102 (la rangée de commandes), §5.59 (commandes refusées), §5.8 ;
//       docs/JOURNAL.md décisions 883, 924 et 926 ; CLAUDE.md §10 — l'écran n'accorde aucun droit : la base tranche
//
// LA COULEUR NE PORTE JAMAIS SEULE L'INFORMATION (§1) : chaque pilule écrit son nom, l'origine se dit en mots.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Sparkles, Tags, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { PastilleEtiquette, PastilleReste } from '../components/ui/PastilleEtiquette'
import { EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import type { Capacite } from '../lib/capacites'
import { lireCataloguePastillesMail, type PastilleMail } from '../lib/pastilles-mail'
import {
	demanderReevaluation,
	lirePastillesDuMessage,
	poserPastilleMessage,
	resoudrePastilles,
	type NatureRefusGestePastille,
	type PastillesDuMessage,
	type PoseDeMessage,
} from '../lib/pastilles-message'
import { clientCrm } from '../lib/supabase'

/** La clé d'adresse du filtre « Pastille » (§31.7) : un contrôle de l'écran, qui reste dans l'adresse. */
export const CLE_URL_PASTILLE = 'pastille'

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La valeur lue dans l'adresse ; une valeur mal formée — une adresse retouchée — vaut l'absence de filtre. */
export const lirePastilleFiltre = (valeur: string | null): string | null =>
	valeur !== null && FORME_UUID.test(valeur) ? valeur.toLowerCase() : null

/** Trois pastilles au plus sur une ligne de la liste, puis « +n » (§5.103, §5.73). */
export const PLAFOND_PASTILLES_LIGNE = 3

export type CataloguePastilles = ReadonlyMap<string, PastilleMail>

const CATALOGUE_VIDE: CataloguePastilles = new Map()

/**
 * Le catalogue de l'inbox, lu une fois : toutes les pastilles lisibles, archivées comprises. Tant qu'il n'est pas lu — ou
 * s'il n'a pas pu l'être —, l'écran n'affiche aucune pilule et pas de filtre : jamais une pilule sans nom.
 */
export function useCataloguePastilles(): EtatAsync<CataloguePastilles> {
	const [etat, setEtat] = useState<EtatAsync<CataloguePastilles>>(enChargement)
	useEffect(() => {
		let vivant = true
		if (clientCrm === null) return
		void lireCataloguePastillesMail(clientCrm).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [])
	return etat
}

export const catalogueOuVide = (etat: EtatAsync<CataloguePastilles>): CataloguePastilles =>
	etat.statut === 'pret' ? etat.donnees : CATALOGUE_VIDE

const nomArchive = (p: PastilleMail): string | undefined =>
	p.archivee ? t('mailLabels.pill.archived', { nom: p.nom }) : undefined

// =================================================================================================
// La liste des mails
// =================================================================================================

/**
 * Les pastilles POSÉES d'une ligne de fil, dans l'ordre du nom, trois au plus puis « +n ». Rendues en `span` : elles vivent
 * dans le bouton de la ligne, dont le nom accessible les énumère après l'objet (§5.103). Aucune : rien n'est rendu.
 */
export function PastillesLigne({ ids, catalogue }: { readonly ids: readonly string[]; readonly catalogue: CataloguePastilles }) {
	const pastilles = resoudrePastilles(ids, catalogue)
	if (pastilles.length === 0) return null
	const visibles = pastilles.slice(0, PLAFOND_PASTILLES_LIGNE)
	const masquees = pastilles.slice(visibles.length).map((p) => p.nom)
	return (
		<span data-testid="inbox-pastilles-ligne" className="flex flex-wrap gap-1 min-w-0 pt-1">
			{visibles.map((p) => (
				<PastilleEtiquette key={p.id} etiquette={p} nomAccessible={nomArchive(p)} />
			))}
			{masquees.length === 0 ? null : (
				<PastilleReste
					n={masquees.length}
					noms={masquees.join(', ')}
					nomAccessible={t('inbox.labels.more.aria', { n: String(masquees.length), noms: masquees.join(', ') })}
				/>
			)}
		</span>
	)
}

/**
 * Le filtre « Pastille » (§5.103) : un `select` natif libellé ; les actives dans l'ordre du nom, puis les archivées,
 * suffixées — on retrouve ainsi les mails d'une pastille qu'on vient de retirer. Absent sans catalogue lu ou vide.
 */
export function FiltrePastille({
	catalogue,
	valeur,
	onChange,
}: {
	readonly catalogue: CataloguePastilles
	readonly valeur: string | null
	readonly onChange: (id: string | null) => void
}) {
	const id = useId()
	if (catalogue.size === 0) return null
	// Le catalogue est déjà trié : les actives d'abord, puis les archivées, chacune dans l'ordre du nom.
	const pastilles = [...catalogue.values()]
	return (
		<span className="flex items-center gap-2 min-w-0">
			<label htmlFor={id} className="text-sm text-text-2 shrink-0">
				{t('inbox.labels.filter')}
			</label>
			<select
				id={id}
				data-testid="inbox-filtre-pastille"
				value={valeur ?? ''}
				onChange={(evenement) => onChange(evenement.target.value === '' ? null : evenement.target.value)}
				className="min-h-[var(--size-target)] min-w-0 max-w-[16rem] rounded-lg border border-border bg-surface px-2 text-sm text-ink"
			>
				<option value="">{t('inbox.labels.filter.all')}</option>
				{pastilles.map((p) => (
					<option key={p.id} value={p.id}>
						{p.archivee ? t('inbox.labels.filter.archived', { nom: p.nom }) : p.nom}
					</option>
				))}
			</select>
		</span>
	)
}

/** Le vide d'un filtre qui ne trouve rien : il nomme la pastille, et porte le geste qui l'efface (§5.103, §5.51). */
export function VidePastille({ nom, onToutes }: { readonly nom: string; readonly onToutes: () => void }) {
	return (
		<EtatVide
			titre={t('inbox.labels.filter.empty.title', { nom })}
			corps={t('inbox.labels.filter.empty.body')}
			action={
				<Button taille="compacte" data-testid="inbox-filtre-pastille-toutes" onClick={onToutes}>
					{t('inbox.labels.filter.all')}
				</Button>
			}
		/>
	)
}

// =================================================================================================
// Le message ouvert
// =================================================================================================

const REFUS: Readonly<Record<NatureRefusGestePastille, CleTraduction>> = {
	'message-introuvable': 'inbox.labels.refus.message',
	forbidden: 'inbox.labels.refus.forbidden',
	'pastille-introuvable': 'inbox.labels.refus.pastille',
	'pastille-archivee': 'inbox.labels.refus.archivee',
	'mail-envoye': 'inbox.labels.refus.envoye',
	network: 'inbox.labels.refus.reseau',
	unknown: 'inbox.labels.refus.inconnu',
}

/** L'origine d'une ligne, en mots (§5.103) ; `null` si la pastille n'a jamais été posée ni retirée sur ce message. */
export function origineDe(pose: PoseDeMessage | undefined): string | null {
	if (pose === undefined) return null
	if (!pose.appliquee) return t('inbox.labels.origin.removed')
	return pose.origine === 'llm' ? t('inbox.labels.origin.llm') : t('inbox.labels.origin.manual')
}

/** Ce que la rangée de commandes du message reçoit de ce bloc (§5.102, §5.103). */
export type ProprietesRangee = {
	/** « Réévaluer les pastilles » et « Pastilles », à placer après « Marquer comme non lu », avant « Effacer ». */
	readonly commandes: ReactNode
	/** Change à chaque ouverture du panneau : la confirmation d'« Effacer » se referme. */
	readonly refermerConfirmation: number
	/** La confirmation d'« Effacer » s'ouvre : le panneau se referme. */
	readonly onConfirmationOuverte: () => void
}

/**
 * Les pastilles du message ouvert : la ligne de ses pastilles posées et de son état d'évaluation, sous l'en-tête ; la
 * rangée de commandes, rendue par l'appelant avec les deux commandes de ce bloc ; et le panneau « Pastilles », dans le flux
 * sous la rangée. Monté avec la clé du message : tout se referme d'un message à l'autre.
 */
export function PastillesMessageOuvert({
	idMessage,
	idEspace,
	envoye,
	catalogue,
	edition,
	onAnnonce,
	rangee,
}: {
	readonly idMessage: string
	readonly idEspace: string
	/** Un mail envoyé n'est pas évalué : ni état ni « Réévaluer les pastilles » ; il se pastille à la main (§31.4). */
	readonly envoye: boolean
	readonly catalogue: CataloguePastilles
	/** La capacité d'éditer l'espace : la règle des gestes (décision 926). Une aide d'interface ; la base tranche. */
	readonly edition: Capacite
	readonly onAnnonce: (texte: string) => void
	readonly rangee: (proprietes: ProprietesRangee) => ReactNode
}) {
	const [etat, setEtat] = useState<EtatAsync<PastillesDuMessage>>(enChargement)
	const [ouvert, setOuvert] = useState(false)
	const [refermer, setRefermer] = useState(0)
	const [reevaluationEnVol, setReevaluationEnVol] = useState(false)
	const [refusReevaluation, setRefusReevaluation] = useState<NatureRefusGestePastille | null>(null)
	// La case reflète le clic tout de suite, et revient si la base refuse (§5.103) : la valeur voulue, par pastille.
	const [voulues, setVoulues] = useState<ReadonlyMap<string, boolean>>(new Map())
	const [enVol, setEnVol] = useState<ReadonlySet<string>>(new Set())
	const [refusCase, setRefusCase] = useState<{ readonly id: string; readonly nature: NatureRefusGestePastille } | null>(null)
	const refCommande = useRef<HTMLButtonElement | null>(null)
	const enVolRef = useRef<Set<string>>(new Set())
	const refPanneau = useRef<HTMLDivElement | null>(null)
	const idPanneau = useId()
	const idMotif = useId()
	const permise = edition === 'permise'

	const relire = useCallback(async () => {
		if (clientCrm === null) return
		const resultat = await lirePastillesDuMessage(clientCrm, idMessage)
		setEtat(resultat)
	}, [idMessage])

	useEffect(() => {
		void relire()
	}, [relire])

	// LE FOCUS ENTRE SUR LA PREMIÈRE CASE à l'ouverture (§5.73), et revient à « Pastilles » à la fermeture.
	useEffect(() => {
		if (ouvert) refPanneau.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')?.focus()
	}, [ouvert])

	const fermer = useCallback(() => {
		setOuvert(false)
		setRefusCase(null)
		requestAnimationFrame(() => refCommande.current?.focus())
	}, [])

	const reevaluer = useCallback(async () => {
		if (clientCrm === null) return
		setReevaluationEnVol(true)
		setRefusReevaluation(null)
		const issue = await demanderReevaluation(clientCrm, idMessage)
		setReevaluationEnVol(false)
		if (issue.statut === 'refus') {
			setRefusReevaluation(issue.nature)
			return
		}
		onAnnonce(t('inbox.labels.reevaluate.done'))
		await relire()
	}, [idMessage, onAnnonce, relire])

	const basculer = useCallback(
		async (pastille: PastilleMail, appliquee: boolean) => {
			// Un second clic pendant l'appel est ignoré : la case n'est PAS désactivée, ce qui lui ferait perdre le focus (§22).
			if (clientCrm === null || enVolRef.current.has(pastille.id)) return
			setRefusCase(null)
			setVoulues((avant) => new Map(avant).set(pastille.id, appliquee))
			enVolRef.current.add(pastille.id)
			setEnVol((avant) => new Set(avant).add(pastille.id))
			const issue = await poserPastilleMessage(clientCrm, idMessage, pastille.id, appliquee)
			if (issue.statut === 'refus') setRefusCase({ id: pastille.id, nature: issue.nature })
			else {
				onAnnonce(t(appliquee ? 'inbox.labels.set.done' : 'inbox.labels.unset.done', { nom: pastille.nom }))
				await relire()
			}
			// Relue ou refusée, la case revient à ce que la base porte.
			setVoulues((avant) => {
				const suivantes = new Map(avant)
				suivantes.delete(pastille.id)
				return suivantes
			})
			enVolRef.current.delete(pastille.id)
			setEnVol((avant) => {
				const suivants = new Set(avant)
				suivants.delete(pastille.id)
				return suivants
			})
		},
		[idMessage, onAnnonce, relire],
	)

	const poses = etat.statut === 'pret' ? etat.donnees.poses : []
	const parPastille = new Map(poses.map((pose) => [pose.idPastille, pose]))
	const posees = resoudrePastilles(
		poses.filter((pose) => pose.appliquee).map((pose) => pose.idPastille),
		catalogue,
	)
	const evaluation = etat.statut === 'pret' ? etat.donnees.evaluation : null
	const duMessage = [...catalogue.values()].filter((p) => p.idEspace === idEspace)
	const actives = duMessage.filter((p) => !p.archivee)
	// Les archivées encore posées se décochent seulement (§5.103).
	const archiveesPosees = duMessage.filter((p) => p.archivee && parPastille.get(p.id)?.appliquee === true)
	const cochee = (p: PastilleMail): boolean => voulues.get(p.id) ?? parPastille.get(p.id)?.appliquee === true

	const commandes = (
		<>
			{envoye ? null : (
				<Button
					taille="compacte"
					data-testid="inbox-reevaluer-pastilles"
					disabled={!permise || reevaluationEnVol}
					aria-busy={reevaluationEnVol || undefined}
					aria-describedby={permise ? undefined : idMotif}
					onClick={() => void reevaluer()}
				>
					<Sparkles aria-hidden="true" size={16} />
					{t('inbox.labels.reevaluate')}
				</Button>
			)}
			<Button
				ref={refCommande}
				taille="compacte"
				data-testid="inbox-pastilles"
				aria-expanded={ouvert}
				aria-controls={ouvert ? idPanneau : undefined}
				onClick={() => {
					if (ouvert) {
						fermer()
						return
					}
					setOuvert(true)
					setRefermer((n) => n + 1)
				}}
			>
				<Tags aria-hidden="true" size={16} />
				{t('inbox.labels.toggle')}
			</Button>
		</>
	)

	return (
		<div className="flex flex-col gap-2">
			{/* LA LIGNE DES PASTILLES, sous l'en-tête et avant la rangée (§5.103) ; aucune ligne s'il n'y a rien à dire. */}
			{etat.statut === 'erreur' ? (
				<p className="text-sm text-danger" data-testid="inbox-pastilles-erreur">
					{t('inbox.labels.error.read')}
				</p>
			) : null}
			{posees.length > 0 || evaluation === 'pending' || evaluation === 'failed' ? (
				<div className="flex flex-wrap items-center gap-1" data-testid="inbox-pastilles-message">
					{posees.map((p) => {
						const origine = origineDe(parPastille.get(p.id)) ?? ''
						return (
							<PastilleEtiquette
								key={p.id}
								etiquette={p}
								nomAccessible={t(p.archivee ? 'inbox.labels.pill.archivedOrigin' : 'inbox.labels.pill.origin', {
									nom: p.nom,
									origine,
								})}
							/>
						)
					})}
					{evaluation === 'pending' ? (
						<span className="text-[13px] text-text-2" data-testid="inbox-pastilles-etat">
							{t('inbox.labels.state.pending')}
						</span>
					) : null}
					{evaluation === 'failed' ? (
						<span className="inline-flex items-center gap-1 text-[13px] text-danger-on-soft" data-testid="inbox-pastilles-etat">
							<TriangleAlert aria-hidden="true" size={14} />
							{t('inbox.labels.state.failed')}
						</span>
					) : null}
				</div>
			) : null}

			{rangee({ commandes, refermerConfirmation: refermer, onConfirmationOuverte: () => setOuvert(false) })}

			{refusReevaluation !== null ? (
				<p role="alert" className="text-sm text-danger" data-testid="inbox-reevaluer-refus">
					{t(REFUS[refusReevaluation])}
				</p>
			) : null}
			{/* La description de « Réévaluer les pastilles » refusée, quand le panneau qui porte le motif est fermé. */}
			{!permise && !ouvert ? (
				<span id={idMotif} hidden>
					{t('rights.readonly.edition')}
				</span>
			) : null}

			{ouvert ? (
				<div
					id={idPanneau}
					ref={refPanneau}
					data-testid="inbox-panneau-pastilles"
					className="flex flex-col gap-3 rounded-lg border border-border p-3"
					onKeyDown={(evenement) => {
						if (evenement.key !== 'Escape') return
						evenement.stopPropagation()
						fermer()
					}}
				>
					{permise ? null : <MotifLectureSeule id={idMotif}>{t('rights.readonly.edition')}</MotifLectureSeule>}
					<fieldset className="flex flex-col gap-1 min-w-0">
						<legend className="text-sm font-medium text-text-2 pb-1">{t('inbox.labels.panel.legend')}</legend>
						{actives.length === 0 ? <p className="text-sm text-text-2">{t('inbox.labels.panel.empty')}</p> : null}
						{[...actives, ...archiveesPosees].map((p) => {
							const origine = origineDe(parPastille.get(p.id))
							const coche = cochee(p)
							// Une archivée ne se pose plus : décochée, sa case s'éteint.
							const eteinte = !permise || (p.archivee && !coche)
							return (
								<label
									key={p.id}
									data-testid="inbox-case-pastille"
									className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)] min-w-0"
								>
									<input
										type="checkbox"
										className="size-6 shrink-0 accent-[var(--color-brand)]"
										checked={coche}
										disabled={eteinte}
										aria-busy={enVol.has(p.id) || undefined}
										aria-describedby={permise ? undefined : idMotif}
										onChange={(evenement) => void basculer(p, evenement.target.checked)}
									/>
									<PastilleEtiquette etiquette={p} nomAccessible={nomArchive(p)} />
									{origine === null ? null : <span className="text-[13px] text-text-2">{origine}</span>}
								</label>
							)
						})}
						{refusCase !== null ? (
							<p role="alert" className="text-sm text-danger" data-testid="inbox-case-pastille-refus">
								{t(REFUS[refusCase.nature])}
							</p>
						) : null}
					</fieldset>
					<div>
						<Button variante="discret" taille="compacte" data-testid="inbox-pastilles-fermer" onClick={fermer}>
							{t('inbox.labels.panel.close')}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	)
}
