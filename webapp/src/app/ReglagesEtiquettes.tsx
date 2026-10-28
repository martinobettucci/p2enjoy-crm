// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Étiquettes — lire, poser, modifier, archiver le catalogue
// @spec docs/SPEC-etiquettes-digest.md §2.1 (écriture administrateur, lecture membre ; nom unique parmi les non archivées),
//       §3 ; docs/DESIGN_SYSTEM.md §5.73 (l'écran, la couleur en cinq radios nommées), §5.71 et §5.39 (la forme reprise),
//       §5.59 (capacité d'administrer), §5.8 (états), §5.41 (archivage sans confirmation)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : refusée par la base, la capacité d'administrer ferme l'écran ; la
//       RLS de `labels` reste seule juge de chaque écriture, et son refus est traduit sous les champs

import { Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { PastilleEtiquette } from '../components/ui/PastilleEtiquette'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import type { CouleurNoeud } from '../lib/board'
import {
	archiverEtiquette,
	COULEURS_ETIQUETTE,
	lireEtiquettes,
	modifierEtiquette,
	poserEtiquette,
	type Etiquette,
	type NatureRefusEtiquette,
} from '../lib/etiquettes'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'

const CLES_COULEUR: Readonly<Record<CouleurNoeud, CleTraduction>> = {
	brand: 'admin.labels.color.brand',
	success: 'admin.labels.color.success',
	accent: 'admin.labels.color.accent',
	danger: 'admin.labels.color.danger',
	neutral: 'admin.labels.color.neutral',
}

const CLES_REFUS: Readonly<Record<NatureRefusEtiquette, CleTraduction>> = {
	'nom-pris': 'admin.labels.refus.nom',
	forme: 'admin.labels.refus.forme',
	archivee: 'admin.labels.refus.panne',
	forbidden: 'admin.labels.refus.forbidden',
	'sans-effet': 'admin.labels.refus.sansEffet',
	network: 'admin.labels.refus.panne',
	unknown: 'admin.labels.refus.panne',
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly etiquettes: readonly Etiquette[] }

type Ouverture = { readonly type: 'creation' } | { readonly type: 'modification'; readonly etiquette: Etiquette } | null

export type ProprietesReglagesEtiquettes = { readonly client?: ClientCrm | null }

export function ReglagesEtiquettes({ client = clientCrm }: ProprietesReglagesEtiquettes = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [archives, setArchives] = useState(false)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert la fiche (§5.13) : « Nouvelle étiquette », ou « Modifier » de sa ligne.
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null || administration === 'en-lecture' || administration === 'refusee') return
		const r = ++rang.current
		void lireEtiquettes(client, { archives: true }).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', etiquettes: lu.donnees })
		})
	}, [client, idWorkspace, administration, tentative])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`)?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.labels.noworkspace')} />
	}
	if (administration === 'refusee' || (lecture.statut === 'erreur' && lecture.nature === 'forbidden')) {
		return <EtatRefus titre={t('admin.labels.forbidden.title')} corps={t('admin.labels.forbidden.body')} />
	}

	const fermer = () => setOuverture(null)
	const relire = () => setTentative((n) => n + 1)
	const enregistree = (nom: string) => {
		setAnnonce(t('admin.labels.saved', { nom }))
		fermer()
		relire()
	}

	const archiver = async (etiquette: Etiquette) => {
		setEnCours(etiquette.id)
		const issue = await archiverEtiquette(client, etiquette.id, !etiquette.archivee)
		setEnCours(null)
		if (issue.statut === 'applique') {
			setAnnonce(t(etiquette.archivee ? 'admin.labels.unarchived' : 'admin.labels.archived.done', { nom: etiquette.nom }))
			relire()
			return
		}
		// Désarchiver une étiquette dont le nom a été repris entre-temps : la base refuse (`23505`), et l'écran le dit.
		setAnnonce(t(CLES_REFUS[issue.nature]))
	}

	const visibles = lecture.statut === 'pret' ? lecture.etiquettes.filter((e) => archives || !e.archivee) : []

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-etiquettes">
			<h2 className="text-h3">{t('admin.labels.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.labels.intro')}</p>
			<div className="flex flex-wrap items-center gap-3">
				{ouverture?.type === 'creation' ? null : (
					<Button
						variante="primaire"
						data-retour-focus="nouvelle"
						data-testid="nouvelle-etiquette"
						onClick={() => {
							retourFocus.current = 'nouvelle'
							setOuverture({ type: 'creation' })
						}}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.labels.new')}
					</Button>
				)}
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						data-testid="etiquettes-archivees"
						checked={archives}
						onChange={(evenement) => setArchives(evenement.target.checked)}
					/>
					{t('admin.labels.showArchived')}
				</label>
			</div>
			<p role="status" className="sr-only" data-testid="annonce-etiquettes">
				{annonce}
			</p>

			{ouverture?.type === 'creation' ? (
				<FicheEtiquette client={client} idWorkspace={idWorkspace} etiquette={null} onFermer={fermer} onEnregistree={enregistree} />
			) : null}

			{lecture.statut === 'chargement' || administration === 'en-lecture' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.labels.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : visibles.length === 0 ? (
				ouverture?.type === 'creation' ? null : (
					<EtatVide titre={t('admin.labels.empty.title')} corps={t('admin.labels.empty.body')} />
				)
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-etiquettes">
					{visibles.map((etiquette) =>
						ouverture?.type === 'modification' && ouverture.etiquette.id === etiquette.id ? (
							<li key={etiquette.id} className="p-3 border-b border-border last:border-b-0">
								<FicheEtiquette
									client={client}
									idWorkspace={idWorkspace}
									etiquette={etiquette}
									onFermer={fermer}
									onEnregistree={enregistree}
								/>
							</li>
						) : (
							<li
								key={etiquette.id}
								data-testid="ligne-etiquette"
								data-etiquette={etiquette.id}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-border last:border-b-0"
							>
								<span className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1">
									<PastilleEtiquette etiquette={etiquette} />
									{etiquette.archivee ? <Badge ton="accent">{t('admin.labels.archived')}</Badge> : null}
								</span>
								<span className="flex flex-wrap gap-1">
									{etiquette.archivee ? null : (
										<Button
											variante="discret"
											taille="compacte"
											data-retour-focus={`modifier-${etiquette.id}`}
											aria-label={t('admin.labels.edit.aria', { nom: etiquette.nom })}
											onClick={() => {
												retourFocus.current = `modifier-${etiquette.id}`
												setOuverture({ type: 'modification', etiquette })
											}}
										>
											{t('admin.labels.edit')}
										</Button>
									)}
									<Button
										variante="discret"
										taille="compacte"
										disabled={enCours === etiquette.id}
										aria-label={t(etiquette.archivee ? 'admin.labels.unarchive.aria' : 'admin.labels.archive.aria', {
											nom: etiquette.nom,
										})}
										onClick={() => void archiver(etiquette)}
									>
										{t(etiquette.archivee ? 'admin.labels.unarchive' : 'admin.labels.archive')}
									</Button>
								</span>
							</li>
						),
					)}
				</ul>
			)}
		</div>
	)
}

/** La fiche d'une étiquette, dans le flux (§5.73) : nom et couleur, une étiquette nouvelle en tête, une existante à sa place. */
function FicheEtiquette({
	client,
	idWorkspace,
	etiquette,
	onFermer,
	onEnregistree,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly etiquette: Etiquette | null
	readonly onFermer: () => void
	readonly onEnregistree: (nom: string) => void
}) {
	const id = useId()
	const [nom, setNom] = useState(etiquette?.nom ?? '')
	const [couleur, setCouleur] = useState<CouleurNoeud>(etiquette?.couleur ?? 'neutral')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusEtiquette | null>(null)
	const champNom = useRef<HTMLInputElement | null>(null)
	const blanc = nom.trim() === ''

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	const envoyer = async () => {
		if (blanc || enCours) return
		setRefus(null)
		setEnCours(true)
		const issue =
			etiquette === null
				? await poserEtiquette(client, idWorkspace, { nom, couleur })
				: await modifierEtiquette(client, etiquette.id, { nom, couleur })
		setEnCours(false)
		if (issue.statut === 'applique') return onEnregistree(nom.trim())
		setRefus(issue.nature)
		// La saisie est gardée, et le focus revient au nom à corriger (§5.71).
		champNom.current?.focus()
	}

	return (
		<form
			data-testid="fiche-etiquette"
			aria-label={t(etiquette === null ? 'admin.labels.form.new' : 'admin.labels.form.edit')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape' || enCours) return
				evenement.preventDefault()
				evenement.stopPropagation()
				onFermer()
			}}
		>
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-nom`} className={CLASSES_LIBELLE}>
					{t('admin.labels.field.name')}
				</label>
				<input
					id={`${id}-nom`}
					ref={champNom}
					data-testid="etiquette-nom"
					type="text"
					autoComplete="off"
					maxLength={40}
					value={nom}
					onChange={(evenement) => setNom(evenement.target.value)}
					className={CLASSES_CHAMP}
				/>
			</div>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium text-ink">{t('admin.labels.field.color')}</legend>
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{COULEURS_ETIQUETTE.map((teinte) => (
						<label key={teinte} className="inline-flex min-h-[var(--size-target)] items-center gap-2">
							<input
								type="radio"
								name={`${id}-couleur`}
								value={teinte}
								checked={couleur === teinte}
								onChange={() => setCouleur(teinte)}
								className="size-4 accent-[var(--color-brand)]"
							/>
							<PastilleEtiquette etiquette={{ nom: t(CLES_COULEUR[teinte]), couleur: teinte, archivee: false }} />
						</label>
					))}
				</div>
			</fieldset>
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="refus-etiquette"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{t(CLES_REFUS[refus])}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button variante="primaire" type="submit" disabled={blanc || enCours} data-testid="etiquette-enregistrer">
					{t(enCours ? 'admin.labels.pending' : 'admin.labels.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="etiquette-annuler" onClick={onFermer}>
					{t('admin.labels.cancel')}
				</Button>
			</div>
		</form>
	)
}
