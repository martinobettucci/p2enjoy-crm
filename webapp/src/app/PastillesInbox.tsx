// @spec CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles d'un mail dans l'inbox — dans la ligne d'un fil (trois au
//       plus, puis « +n »), le filtre « Pastille » et son état vide, et le message ouvert : la ligne de ses pastilles et de
//       son état d'évaluation, « Réévaluer les pastilles », « Pastilles » et son panneau de cases
// @spec docs/SPEC-mail-subsystem.md §31.4 (les gestes et leurs refus), §31.7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.103,
//       §5.73 (la grammaire des étiquettes reprise), §5.102 (la rangée de commandes), §5.59 (commandes refusées), §5.8 ;
//       docs/JOURNAL.md décisions 883, 924 et 926 ; CLAUDE.md §10 — l'écran n'accorde aucun droit : la base tranche
//
// @spec CRM-155 (docs/BACKLOG.md) — tranche T1 : les pastilles en FILTRES RAPIDES — une bascule par pastille active de
//       l'espace courant, plusieurs en OU, le volet « Pastilles archivées » replié par défaut, « Toutes les pastilles »,
//       la clé `pastille` en liste nettoyée, et le vide à plusieurs pastilles
// @spec docs/SPEC-mail-subsystem.md §31.12.1, §31.12.3, §31.12.4 ; docs/DESIGN_SYSTEM.md §5.108 (la bascule du §5.11) ;
//       docs/JOURNAL.md décisions 943 et 948
//
// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : le panneau « Pastilles » s'exclut avec le bloc « Transférer ce message »,
//       et les transferts se lisent sous la ligne des pastilles — docs/DESIGN_SYSTEM.md §5.109 bis
//
// LA COULEUR NE PORTE JAMAIS SEULE L'INFORMATION (§1) : chaque pilule écrit son nom, l'origine se dit en mots.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Sparkles, Tags, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { POINTS, PastilleEtiquette, PastilleReste } from '../components/ui/PastilleEtiquette'
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

/**
 * La clé d'adresse du filtre (§31.7) : un contrôle de l'écran, qui reste dans l'adresse. `CRM-155` (§31.12.3) : elle se
 * RÉPÈTE, une valeur par pastille active ; une adresse à une seule valeur, celle de `CRM-141`, reste valide.
 */
export const CLE_URL_PASTILLE = 'pastille'

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Les pastilles de l'espace courant, actives puis archivées, chacune dans l'ordre du nom (le catalogue est déjà trié). */
export function pastillesDeLEspace(
	catalogue: CataloguePastilles,
	idEspace: string | null,
): { readonly actives: readonly PastilleMail[]; readonly archivees: readonly PastilleMail[] } {
	const deLEspace = idEspace === null ? [] : [...catalogue.values()].filter((p) => p.idEspace === idEspace)
	return { actives: deLEspace.filter((p) => !p.archivee), archivees: deLEspace.filter((p) => p.archivee) }
}

/**
 * Le filtre lu dans l'adresse (§31.12.3) : chaque valeur qui n'a pas la forme d'un `uuid`, ou qui n'est pas une pastille de
 * l'espace courant — active ou archivée —, est IGNORÉE, une à une ; les doublons tombent ; l'ordre de l'adresse est gardé.
 * Une liste vide : aucun filtre.
 */
export function lirePastillesFiltre(
	valeurs: readonly string[],
	catalogue: CataloguePastilles,
	idEspace: string | null,
): readonly string[] {
	const retenues: string[] = []
	for (const valeur of valeurs) {
		if (!FORME_UUID.test(valeur)) continue
		const id = valeur.toLowerCase()
		if (catalogue.get(id)?.idEspace !== idEspace || idEspace === null || retenues.includes(id)) continue
		retenues.push(id)
	}
	return retenues
}

/** L'adresse porte-t-elle au moins une valeur bien formée ? Tant que le catalogue n'est pas lu, la liste attend. */
export const adresseDemandeUnFiltre = (valeurs: readonly string[]): boolean => valeurs.some((v) => FORME_UUID.test(v))

/** Une bascule : la pastille entre dans le filtre, ou en sort (§31.12.2). */
export const basculerDansFiltre = (filtre: readonly string[], id: string): readonly string[] =>
	filtre.includes(id) ? filtre.filter((autre) => autre !== id) : [...filtre, id]

/**
 * Les noms entre guillemets, en disjonction — « « Lead » ou « Spam » » —, par `Intl.ListFormat` et jamais par
 * concaténation (`CLAUDE.md` §23). Les guillemets encadrent le nom d'espaces insécables (§5.51).
 */
export function nomsEnDisjonction(noms: readonly string[]): string {
	const cites = noms.map((nom) => `«\u00a0${nom}\u00a0»`)
	return new Intl.ListFormat('fr', { style: 'long', type: 'disjunction' }).format(cites)
}

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
 * Une bascule de pastille (§5.108) : la bascule de la barre de filtres du fil (§5.11), reprise sans écart — un bouton
 * `aria-pressed`, jamais une case —, avec le point de tête de la pastille (§5.73).
 */
function BasculePastille({
	pastille,
	active,
	onBasculer,
	refBouton,
}: {
	readonly pastille: PastilleMail
	readonly active: boolean
	readonly onBasculer: () => void
	readonly refBouton?: (element: HTMLButtonElement | null) => void
}) {
	const archive = nomArchive(pastille)
	return (
		<button
			ref={refBouton}
			type="button"
			data-testid="inbox-bascule-pastille"
			data-pastille={pastille.id}
			aria-pressed={active}
			aria-label={archive}
			title={archive}
			onClick={onBasculer}
			className={`inline-flex items-center gap-2 min-h-[var(--size-target)] max-w-full rounded-full border px-3 text-sm transition-colors duration-[var(--transition-duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
				active
					? 'border-brand bg-brand-soft text-brand font-medium'
					: 'border-border bg-surface text-text-2 hover:bg-hover'
			}`}
		>
			<span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${POINTS[pastille.couleur]}`} />
			<span className="min-w-0 break-words text-left">{pastille.nom}</span>
		</button>
	)
}

/**
 * Les FILTRES RAPIDES (§5.108, §31.12.1) : « Filtrer par pastille », une bascule par pastille active de l'espace courant,
 * toutes visibles et à la ligne ; le volet « Pastilles archivées », replié par défaut et ouvert d'office quand l'adresse
 * active une archivée ; « Toutes les pastilles » quand une bascule est active. Absent sans pastille dans l'espace courant.
 */
export function FiltresPastilles({
	catalogue,
	idEspace,
	filtre,
	onChange,
}: {
	readonly catalogue: CataloguePastilles
	readonly idEspace: string | null
	/** Le filtre en vigueur, déjà nettoyé (`lirePastillesFiltre`). */
	readonly filtre: readonly string[]
	readonly onChange: (filtre: readonly string[]) => void
}) {
	const idTitre = useId()
	const idVolet = useId()
	const { actives, archivees } = pastillesDeLEspace(catalogue, idEspace)
	// OUVERT D'OFFICE À L'ARRIVÉE sur une archivée active : un filtre en vigueur n'est jamais caché (§31.12.1). Ensuite,
	// c'est la personne qui décide ; l'état n'entre ni dans l'adresse ni dans un stockage (`CLAUDE.md` §11).
	const archiveeActiveALArrivee = archivees.some((p) => filtre.includes(p.id))
	const [voletOuvert, setVoletOuvert] = useState(archiveeActiveALArrivee)
	const [ouvertureFaite, setOuvertureFaite] = useState(archiveeActiveALArrivee)
	// Le catalogue peut arriver après le premier rendu : l'ouverture d'office se fait une fois, à sa première lecture.
	useEffect(() => {
		if (ouvertureFaite || !archiveeActiveALArrivee) return
		setVoletOuvert(true)
		setOuvertureFaite(true)
	}, [archiveeActiveALArrivee, ouvertureFaite])
	const premiereBascule = useRef<HTMLButtonElement | null>(null)

	if (actives.length === 0 && archivees.length === 0) return null
	const basculer = (id: string) => onChange(basculerDansFiltre(filtre, id))
	return (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="inbox-filtres-pastilles"
			className="flex flex-col gap-2 px-3 py-2 border-b border-border"
		>
			<span id={idTitre} className="text-[13px] text-text-2">
				{t('inbox.labels.filter')}
			</span>
			{actives.length === 0 ? null : (
				<div className="flex flex-wrap gap-2 min-w-0">
					{actives.map((p, rang) => (
						<BasculePastille
							key={p.id}
							pastille={p}
							active={filtre.includes(p.id)}
							onBasculer={() => basculer(p.id)}
							refBouton={
								rang === 0
									? (element) => {
											premiereBascule.current = element
										}
									: undefined
							}
						/>
					))}
				</div>
			)}
			{archivees.length === 0 && filtre.length === 0 ? null : (
				<div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
					{archivees.length === 0 ? (
						<span />
					) : (
						<Button
							variante="discret"
							taille="compacte"
							data-testid="inbox-volet-archivees"
							aria-expanded={voletOuvert}
							aria-controls={voletOuvert ? idVolet : undefined}
							onClick={() => {
								setVoletOuvert((ouvert) => !ouvert)
								setOuvertureFaite(true)
							}}
						>
							{voletOuvert ? (
								<ChevronDown aria-hidden="true" size={16} />
							) : (
								<ChevronRight aria-hidden="true" size={16} />
							)}
							{t('inbox.labels.filter.archivedPanel', { n: String(archivees.length) })}
						</Button>
					)}
					{filtre.length === 0 ? null : (
						<Button
							variante="discret"
							taille="compacte"
							data-testid="inbox-filtre-pastille-toutes"
							onClick={() => {
								onChange([])
								// La commande disparaît avec le filtre : le focus passe à la première bascule (§5.108).
								requestAnimationFrame(() => premiereBascule.current?.focus())
							}}
						>
							{t('inbox.labels.filter.all')}
						</Button>
					)}
				</div>
			)}
			{voletOuvert && archivees.length > 0 ? (
				<div
					id={idVolet}
					role="group"
					aria-label={t('inbox.labels.filter.archivedGroup')}
					data-testid="inbox-volet-archivees-contenu"
					className="flex flex-wrap gap-2 min-w-0"
				>
					{archivees.map((p) => (
						<BasculePastille key={p.id} pastille={p} active={filtre.includes(p.id)} onBasculer={() => basculer(p.id)} />
					))}
				</div>
			) : null}
		</div>
	)
}

/**
 * Le vide d'un filtre qui ne trouve rien : il nomme la ou les pastilles, et porte le geste qui l'efface (§5.103, §5.108,
 * §5.51).
 */
export function VidePastilles({ noms, onToutes }: { readonly noms: readonly string[]; readonly onToutes: () => void }) {
	return (
		<EtatVide
			titre={
				noms.length === 1
					? t('inbox.labels.filter.empty.title', { nom: noms[0] ?? '' })
					: t('inbox.labels.filter.empty.titleMany', { noms: nomsEnDisjonction(noms) })
			}
			corps={t('inbox.labels.filter.empty.body')}
			action={
				<Button taille="compacte" data-testid="inbox-filtre-pastille-toutes-vide" onClick={onToutes}>
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
	refermer: refermerExterne = 0,
	onPanneauOuvert,
	apresLigne = null,
}: {
	/**
	 * `CRM-156` T4 (docs/DESIGN_SYSTEM.md §5.109 bis) : le bloc « Transférer ce message » s'exclut avec ce panneau. Chaque
	 * changement de ce compteur le referme ; son ouverture le signale par `onPanneauOuvert`.
	 */
	readonly refermer?: number
	readonly onPanneauOuvert?: () => void
	/** `CRM-156` T4 : les transferts du message, sous la ligne des pastilles et avant la rangée. */
	readonly apresLigne?: ReactNode
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

	// `CRM-156` T4 : un autre bloc s'ouvre — le panneau se referme, sans voler le focus.
	useEffect(() => {
		if (refermerExterne === 0) return
		setOuvert(false)
		setRefusCase(null)
	}, [refermerExterne])

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
					onPanneauOuvert?.()
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

			{apresLigne}

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
