// @spec CRM-068 (docs/BACKLOG.md) — tranche T3a : le bloc « Checklist » de la fiche d'une affaire — lire, cocher, ajouter
//       et retirer un point
// @spec docs/SPEC-checklists.md §2 (points d'étape du rattachement, points libres de l'affaire), §3.2 (qui écrit quoi),
//       §3.4 (la mention d'un point exigé par une transition sortante), §4 (la fiche)
// @spec docs/DESIGN_SYSTEM.md §5.70 (ce bloc), §5.21 (la forme d'un bloc de colonne gauche), §5.7 bis (case native de
//       24 px), §5.31 bis (la case bascule au clic et revient si la base refuse), §5.41 (retrait sans confirmation), §5.50
//       (bouton désactivé tant que le champ est blanc), §5.59 (commandes éteintes avec le motif de la fiche), §5.8 (états),
//       §8 (accessibilité), §9 (icônes Lucide)
// @spec CLAUDE.md §10 — le bloc n'offre « Retirer » qu'aux points libres pour ne pas enseigner un geste qui n'existe pas ;
//       les politiques de `card_checklist_items` décident, et un refus malgré tout est dit
//
// LE MESSAGE D'UN GESTE VIT DANS LA LIGNE DU POINT, et celui de l'ajout sous le champ : chacun dit ce qui a échoué là où
// le geste a été fait (§5.70). Un retrait refusé laisse sa ligne en place, donc son message avec elle.

import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { useRefus } from '../components/ui/RefusCommandes'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	LONGUEUR_MAX_POINT,
	ajouterPointLibre,
	cocherPoint,
	lireChecklist,
	positionSuivante,
	retirerPointLibre,
	type ChecklistAffichee,
	type GroupeEtape,
	type IssueChecklist,
	type NatureRefusChecklist,
	type PointAffiche,
} from '../lib/checklists'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { formaterDateActivite } from './presentationActivites'

/** Le dictionnaire FERMÉ des refus : jamais le message du serveur (`CLAUDE.md` §20). */
export const MESSAGES_REFUS_CHECKLIST: Readonly<Record<NatureRefusChecklist, CleTraduction>> = {
	libelle: 'checklist.refus.libelle',
	forbidden: 'checklist.refus.forbidden',
	'sans-effet': 'checklist.refus.sans-effet',
	network: 'checklist.refus.network',
	unknown: 'checklist.refus.unknown',
}

/** Classes du champ d'ajout, celles du §5.7 : 40 px de haut, bordure, fond de surface, anneau de focus. */
const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')

const CLASSES_REFUS = 'rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft'

export type ProprietesBlocChecklistCard = {
	readonly idCard: string
	readonly idWorkspace: string
	/** Le rattachement de la fiche (`idRattachement`) : ses points d'étape sont montrés ; `null`, les libres seuls. */
	readonly idRattachement: string | null
	/** L'étape où se trouve le rattachement : ses points viennent d'abord, avec leurs mentions d'exigence. */
	readonly idEtapeCourante: string | null
	/** Appelé après chaque écriture appliquée : un cochage écrit une ligne du fil, que la fiche fait relire. */
	readonly onChange?: () => void
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

export function BlocChecklistCard({
	idCard,
	idWorkspace,
	idRattachement,
	idEtapeCourante,
	onChange,
	client = clientCrm,
}: ProprietesBlocChecklistCard) {
	const [etat, setEtat] = useState<EtatAsync<ChecklistAffichee>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)
	const [annonce, setAnnonce] = useState('')

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		void (async () => {
			const resultat = await lireChecklist(client, idCard, idRattachement, idEtapeCourante)
			// LA LISTE RESTE À L'ÉCRAN PENDANT UNE RELECTURE : le squelette est réservé au premier chargement (§5.8).
			if (rang === courant.current) setEtat(resultat)
		})()
	}, [client, idCard, idRattachement, idEtapeCourante, tentative])

	/** Relit le bloc après une écriture, annonce le geste, et prévient la fiche quand la base a changé quelque chose. */
	const apres = useCallback(
		(issue: IssueChecklist, texteAnnonce: string) => {
			setTentative((n) => n + 1)
			if (issue.statut === 'applique') {
				setAnnonce(texteAnnonce)
				onChange?.()
			}
		},
		[onChange],
	)

	// `CRM-068` T3b — L'ARRIVÉE PAR LE LIEN « Cocher ces points » DU BOARD (docs/DESIGN_SYSTEM.md §5.7 quinquies) : l'ancre
	// `#checklist` amène le bloc en vue et donne le focus au premier point exigé non coché, UNE FOIS par montage — un
	// défilement qui reprendrait la main pendant la saisie serait un vol de focus (§5.7 quater).
	const section = useRef<HTMLElement>(null)
	const arriveeTraitee = useRef(false)
	useEffect(() => {
		if (arriveeTraitee.current || etat.statut !== 'pret') return
		if (typeof window === 'undefined' || window.location.hash !== '#checklist') return
		arriveeTraitee.current = true
		const cible = premierPointAReprendre(etat.donnees)
		const element =
			cible === null
				? null
				: section.current?.querySelector<HTMLInputElement>(`[data-point="${cible}"] input[type="checkbox"]`)
		section.current?.scrollIntoView({ block: 'center', behavior: preferenceMouvementReduit() ? 'auto' : 'smooth' })
		element?.focus({ preventScroll: true })
	}, [etat])

	if (client === null) return null
	const checklist = etat.statut === 'pret' ? etat.donnees : null

	return (
		<section
			ref={section}
			id="checklist"
			data-testid="bloc-checklist-card"
			aria-labelledby="bloc-checklist-titre"
			className="flex flex-col gap-3 border-t border-border pt-4"
		>
			<h2 id="bloc-checklist-titre" className="flex flex-wrap items-baseline gap-x-3 text-h3">
				{t('checklist.title')}
				{checklist !== null && checklist.total > 0 ? (
					<span data-testid="checklist-compte" className="text-sm font-normal text-text-2">
						{t('checklist.count', { coches: String(checklist.coches), total: String(checklist.total) })}
					</span>
				) : null}
			</h2>
			<LiveRegion libelle={t('checklist.live.aria')} message={annonce} />

			{etat.statut === 'chargement' ? <SkeletonListe lignes={2} libelle={t('state.loading.aria')} /> : null}

			{etat.statut === 'erreur' ? (
				<div className="flex flex-col items-start gap-2" data-testid="erreur-checklist">
					<p role="alert" className={CLASSES_REFUS}>
						{t('checklist.error.body')}
					</p>
					<Button taille="compacte" onClick={() => setTentative((n) => n + 1)}>
						{t('checklist.error.retry')}
					</Button>
				</div>
			) : null}

			{checklist !== null && checklist.total === 0 ? (
				<p data-testid="checklist-vide" className="text-text-2">
					{t('checklist.empty')}
				</p>
			) : null}

			{checklist === null
				? null
				: [...(checklist.etapeCourante === null ? [] : [checklist.etapeCourante]), ...checklist.etapesPassees].map(
						(groupe) => (
							<GroupePoints
								key={groupe.idEtape ?? 'etape-supprimee'}
								titre={
									groupe.libelle === null
										? t('checklist.group.orphan')
										: t('checklist.group.step', { etape: groupe.libelle })
								}
								testid={groupe === checklist.etapeCourante ? 'checklist-etape-courante' : 'checklist-etape-passee'}
								points={groupe.points}
								client={client}
								onApres={apres}
							/>
						),
					)}

			{checklist === null ? null : (
				<GroupePoints
					titre={t('checklist.group.free')}
					testid="checklist-libres"
					points={checklist.libres}
					client={client}
					onApres={apres}
				>
					<AjoutPoint
						onAjouter={async (libelle) => {
							const issue = await ajouterPointLibre(client, idCard, idWorkspace, libelle, positionSuivante(checklist))
							apres(issue, t('checklist.live.added', { libelle: libelle.trim() }))
							return issue
						}}
					/>
				</GroupePoints>
			)}
		</section>
	)
}

/** Le point à reprendre à l'arrivée : le premier exigé non coché de l'étape courante, sinon le premier non coché. */
export function premierPointAReprendre(checklist: ChecklistAffichee): string | null {
	const courants = checklist.etapeCourante?.points ?? []
	return (
		courants.find((point) => !point.coche && point.exigePour.length > 0)?.id ??
		courants.find((point) => !point.coche)?.id ??
		null
	)
}

const preferenceMouvementReduit = (): boolean =>
	typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false

/** Un groupe titré `h3` ; vide, il n'est pas rendu, sauf s'il porte un geste (« Points libres » et son ajout). */
function GroupePoints({
	titre,
	testid,
	points,
	client,
	onApres,
	children,
}: {
	readonly titre: string
	readonly testid: string
	readonly points: GroupeEtape['points']
	readonly client: ClientCrm
	readonly onApres: (issue: IssueChecklist, annonce: string) => void
	readonly children?: ReactNode
}) {
	const idTitre = useId()
	if (points.length === 0 && children === undefined) return null
	return (
		<div data-testid={testid} className="flex flex-col gap-1">
			<h3 id={idTitre} className="text-sm font-medium text-text-2">
				{titre}
			</h3>
			{points.length === 0 ? null : (
				<ul aria-labelledby={idTitre} className="flex flex-col">
					{points.map((point) => (
						<LignePoint key={point.id} point={point} client={client} onApres={onApres} />
					))}
				</ul>
			)}
			{children}
		</div>
	)
}

function LignePoint({
	point,
	client,
	onApres,
}: {
	readonly point: PointAffiche
	readonly client: ClientCrm
	readonly onApres: (issue: IssueChecklist, annonce: string) => void
}) {
	const droit = useRefus()
	// La case bascule au clic ; `null` rend la valeur lue. Un refus la ramène là (§5.31 bis).
	const [voulu, setVoulu] = useState<boolean | null>(null)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<NatureRefusChecklist | null>(null)
	const idCase = useId()
	const idDetail = useId()

	// La relecture qui suit un geste apporte la valeur de la base : l'état voulu s'efface alors devant elle.
	useEffect(() => setVoulu(null), [point.coche])

	const ecrire = async (geste: () => Promise<IssueChecklist>, annonce: string) => {
		setEnVol(true)
		setRefus(null)
		const issue = await geste()
		setEnVol(false)
		if (issue.statut === 'refus') {
			setVoulu(null)
			setRefus(issue.nature)
		}
		onApres(issue, annonce)
	}

	const coche = voulu ?? point.coche
	const details = [
		point.coche
			? point.cocheLe === null
				? null
				: point.cochePar === null
					? t('checklist.checkedAt', { date: formaterDateActivite(point.cocheLe) })
					: t('checklist.checkedBy', { nom: point.cochePar, date: formaterDateActivite(point.cocheLe) })
			: null,
		...point.exigePour.map((etape) => t('checklist.required', { etape })),
	]

	return (
		<li data-testid="checklist-point" data-point={point.id} data-coche={String(point.coche)} className="flex flex-col py-1">
			<div className="flex items-start gap-2">
				<label htmlFor={idCase} className="flex min-h-[var(--size-target)] flex-1 cursor-pointer items-center gap-3">
					<input
						{...droit}
						id={idCase}
						type="checkbox"
						checked={coche}
						disabled={droit.disabled === true || enVol}
						aria-describedby={[droit['aria-describedby'], details.some((d) => d !== null) ? idDetail : undefined]
							.filter((id) => id !== undefined)
							.join(' ') || undefined}
						onChange={(e) => {
							const cible = e.target.checked
							setVoulu(cible)
							void ecrire(
								() => cocherPoint(client, point.id, cible),
								t(cible ? 'checklist.live.checked' : 'checklist.live.unchecked', { libelle: point.libelle }),
							)
						}}
						data-testid="checklist-case"
						className="size-6 shrink-0 accent-[var(--color-brand)]"
					/>
					<span className="break-words">{point.libelle}</span>
				</label>
				{point.libre ? (
					<Button
						{...droit}
						variante="discret"
						taille="compacte"
						disabled={droit.disabled === true || enVol}
						aria-label={t('checklist.remove.aria', { libelle: point.libelle })}
						data-testid="checklist-retirer"
						onClick={() =>
							void ecrire(
								() => retirerPointLibre(client, point.id),
								t('checklist.live.removed', { libelle: point.libelle }),
							)
						}
					>
						<X aria-hidden="true" size={16} strokeWidth={2} />
						{t('checklist.remove')}
					</Button>
				) : null}
			</div>
			{details.some((d) => d !== null) ? (
				<div id={idDetail} className="flex flex-col pl-[36px]">
					{details.map((detail, rang) =>
						detail === null ? null : (
							<span
								key={rang}
								data-testid={rang === 0 && point.coche ? 'checklist-coche-par' : 'checklist-exige'}
								className={rang === 0 && point.coche ? 'text-sm text-text-2' : 'text-sm text-text-3'}
							>
								{detail}
							</span>
						),
					)}
				</div>
			) : null}
			{refus === null ? null : (
				<p role="alert" data-testid="checklist-refus" className={`${CLASSES_REFUS} mt-1`}>
					{t(MESSAGES_REFUS_CHECKLIST[refus])}
				</p>
			)}
		</li>
	)
}

/** « Ajouter un point » : un champ et son bouton, dans le flux (§5.70). `Entrée` ajoute ; le champ garde le focus. */
function AjoutPoint({ onAjouter }: { readonly onAjouter: (libelle: string) => Promise<IssueChecklist> }) {
	const [libelle, setLibelle] = useState('')
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<NatureRefusChecklist | null>(null)
	// LE CHAMP N'EST PAS ÉTEINT PENDANT L'ENVOI, seul le bouton l'est : un champ désactivé perd le focus, et le navigateur
	// ne le lui rend pas au rendu qui le réactive — mesuré par l'E2E, que jsdom ne voit pas. `envoyer` refuse le double envoi.
	const droit = useRefus()
	const bouton = useRefus(enVol || libelle.trim() === '')
	const champ = useRef<HTMLInputElement>(null)
	const idChamp = useId()

	const envoyer = async (evenement: FormEvent) => {
		evenement.preventDefault()
		if (libelle.trim() === '' || enVol) return
		setEnVol(true)
		setRefus(null)
		const issue = await onAjouter(libelle)
		setEnVol(false)
		if (issue.statut === 'applique') setLibelle('')
		else setRefus(issue.nature)
		champ.current?.focus()
	}

	return (
		<form onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-1 pt-1" data-testid="checklist-ajout">
			<label htmlFor={idChamp} className="text-sm font-medium">
				{t('checklist.add.label')}
			</label>
			<div className="flex gap-2">
				<input
					{...droit}
					ref={champ}
					id={idChamp}
					type="text"
					value={libelle}
					maxLength={LONGUEUR_MAX_POINT}
					onChange={(e) => setLibelle(e.target.value)}
					data-testid="checklist-nouveau"
					className={CLASSES_CONTROLE}
				/>
				<Button {...bouton} type="submit" data-testid="checklist-ajouter">
					{t('checklist.add.submit')}
				</Button>
			</div>
			{refus === null ? null : (
				<p role="alert" data-testid="checklist-refus-ajout" className={CLASSES_REFUS}>
					{t(MESSAGES_REFUS_CHECKLIST[refus])}
				</p>
			)}
		</form>
	)
}
