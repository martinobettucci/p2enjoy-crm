// @spec CRM-141 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Pastilles des mails — lire la liste de l'espace, la créer, la
//       modifier, archiver avec confirmation, désarchiver sans confirmation
// @spec docs/SPEC-mail-subsystem.md §31.2, §31.3 (lecture par tout membre, écriture par l'administrateur), §31.6 (les
//       défauts), §31.7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.103 (la forme de Réglages ▸ Étiquettes reprise, le descriptif
//       sous la pilule, la confirmation d'archivage dans le flux, le refus de doublon qui nomme « Afficher les archivées »),
//       §5.73, §5.68 (le sélecteur de couleur), §5.59 (les commandes éteintes avec leur motif), §5.29 bis, §5.13, §5.8 ;
//       docs/JOURNAL.md décision 926 (supprimer, c'est archiver)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la capacité d'administrer, rendue par la base, éteint les commandes ;
//       la RLS de `mail_labels` reste seule juge de chaque écriture, et son refus est traduit sous les champs
//
// L'ÉCRAN EST LISIBLE PAR TOUT MEMBRE (§31.3) : on y lit ce que l'IA lit pour décider. Qui n'administre pas l'espace voit
// les commandes, éteintes avec leur motif, jamais masquées (§5.59).

import { Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { PastilleEtiquette } from '../components/ui/PastilleEtiquette'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import type { CouleurNoeud } from '../lib/board'
import { couleurEtiquette } from '../lib/etiquettes'
import {
	archiverPastilleMail,
	creerPastilleMail,
	LONGUEUR_DESCRIPTIF_PASTILLE,
	LONGUEUR_NOM_PASTILLE,
	lirePastillesMail,
	modifierPastilleMail,
	type NatureRefusPastilleMail,
	type PastilleMail,
} from '../lib/pastilles-mail'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { ConfirmationArchivage } from './ConfirmationArchivage'
import { useContexteEspace } from './ContexteEspace'
import { SelecteurCouleur } from './SelecteurCouleur'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'
const ID_MOTIF = 'pastilles-mail-lecture-seule'

const CLES_REFUS: Readonly<Record<NatureRefusPastilleMail, CleTraduction>> = {
	'nom-pris': 'admin.mailLabels.refus.nom',
	forme: 'admin.mailLabels.refus.forme',
	forbidden: 'admin.mailLabels.refus.forbidden',
	'sans-effet': 'admin.mailLabels.refus.sansEffet',
	network: 'admin.mailLabels.refus.panne',
	unknown: 'admin.mailLabels.refus.panne',
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly pastilles: readonly PastilleMail[] }

type Ouverture =
	| { readonly type: 'creation' }
	| { readonly type: 'modification'; readonly pastille: PastilleMail }
	| { readonly type: 'archivage'; readonly pastille: PastilleMail }
	| null

export type ProprietesReglagesPastillesMail = { readonly client?: ClientCrm | null }

export function ReglagesPastillesMail({ client = clientCrm }: ProprietesReglagesPastillesMail = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	// Éteint pendant la lecture de la capacité comme sur un refus ; le motif n'est dit que sur un refus établi (§5.59).
	const eteint = administration === 'refusee' || administration === 'en-lecture'
	const refuse = administration === 'refusee'
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [archives, setArchives] = useState(false)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [refusArchivage, setRefusArchivage] = useState<string | null>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert la fiche ou la confirmation (§5.13).
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lirePastillesMail(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', pastilles: lu.donnees })
		})
	}, [client, idWorkspace, tentative])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`)?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.mailLabels.noworkspace')} />
	}

	const fermer = () => {
		setRefusArchivage(null)
		setOuverture(null)
	}
	const relire = () => setTentative((n) => n + 1)
	const enregistree = (nom: string) => {
		setAnnonce(t('admin.mailLabels.saved', { nom }))
		fermer()
		relire()
	}
	const pastilles = lecture.statut === 'pret' ? lecture.pastilles : []

	const archiver = async (pastille: PastilleMail, archive: boolean) => {
		setEnCours(pastille.id)
		const issue = await archiverPastilleMail(client, pastille.id, archive)
		setEnCours(null)
		if (issue.statut === 'applique') {
			setAnnonce(t(archive ? 'admin.mailLabels.archived.done' : 'admin.mailLabels.unarchived', { nom: pastille.nom }))
			fermer()
			relire()
			return
		}
		const texte = t(CLES_REFUS[issue.nature])
		if (archive) setRefusArchivage(texte)
		else setAnnonce(texte)
	}

	const visibles = pastilles.filter((p) => archives || !p.archivee)
	const commande = (props: { readonly cle: string }) => ({
		disabled: eteint,
		'data-retour-focus': props.cle,
		...(refuse ? { 'aria-describedby': ID_MOTIF } : {}),
	})

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-pastilles-mail">
			<h2 className="text-h3">{t('admin.mailLabels.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.mailLabels.intro')}</p>
			{refuse ? <MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule> : null}
			<div className="flex flex-wrap items-center gap-3">
				{ouverture?.type === 'creation' ? null : (
					<Button
						variante="primaire"
						data-testid="nouvelle-pastille"
						{...commande({ cle: 'nouvelle' })}
						onClick={() => {
							retourFocus.current = 'nouvelle'
							setOuverture({ type: 'creation' })
						}}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.mailLabels.new')}
					</Button>
				)}
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						data-testid="pastilles-archivees"
						checked={archives}
						onChange={(evenement) => setArchives(evenement.target.checked)}
						className="size-6 accent-[var(--color-brand)]"
					/>
					{t('admin.mailLabels.showArchived')}
				</label>
			</div>
			<p role="status" className="sr-only" data-testid="annonce-pastilles">
				{annonce}
			</p>

			{ouverture?.type === 'creation' ? (
				<FichePastille
					client={client}
					idWorkspace={idWorkspace}
					pastille={null}
					pastilles={pastilles}
					onFermer={fermer}
					onEnregistree={enregistree}
				/>
			) : null}

			{lecture.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.mailLabels.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : visibles.length === 0 ? (
				ouverture?.type === 'creation' ? null : (
					<EtatVide titre={t('admin.mailLabels.empty.title')} corps={t('admin.mailLabels.empty.body')} />
				)
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-pastilles-mail">
					{visibles.map((pastille) =>
						ouverture?.type === 'modification' && ouverture.pastille.id === pastille.id ? (
							<li key={pastille.id} className="p-3 border-b border-border last:border-b-0">
								<FichePastille
									client={client}
									idWorkspace={idWorkspace}
									pastille={pastille}
									pastilles={pastilles}
									onFermer={fermer}
									onEnregistree={enregistree}
								/>
							</li>
						) : (
							<li
								key={pastille.id}
								data-testid="ligne-pastille-mail"
								data-pastille={pastille.id}
								className="flex flex-col gap-2 px-4 py-3 border-b border-border last:border-b-0"
							>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1">
										<PastilleEtiquette
											etiquette={pastille}
											{...(pastille.archivee
												? { nomAccessible: t('mailLabels.pill.archived', { nom: pastille.nom }) }
												: {})}
										/>
										{/* La mention est TEXTUELLE, jamais une teinte seule (§5.13). */}
										{pastille.archivee ? <Badge ton="accent">{t('admin.mailLabels.archived')}</Badge> : null}
									</span>
									<span className="flex flex-wrap gap-1">
										{pastille.archivee ? null : (
											<Button
												variante="discret"
												taille="compacte"
												{...commande({ cle: `modifier-${pastille.id}` })}
												aria-label={t('admin.mailLabels.edit.aria', { nom: pastille.nom })}
												onClick={() => {
													retourFocus.current = `modifier-${pastille.id}`
													setOuverture({ type: 'modification', pastille })
												}}
											>
												{t('admin.mailLabels.edit')}
											</Button>
										)}
										<Button
											variante="discret"
											taille="compacte"
											{...commande({ cle: `archiver-${pastille.id}` })}
											disabled={eteint || enCours === pastille.id}
											aria-label={t(pastille.archivee ? 'admin.mailLabels.unarchive.aria' : 'admin.mailLabels.archive.aria', {
												nom: pastille.nom,
											})}
											onClick={() => {
												// Désarchiver défait, sans confirmation (§5.29 bis) ; archiver la demande, dans le flux (§5.103).
												if (pastille.archivee) {
													void archiver(pastille, false)
													return
												}
												retourFocus.current = `archiver-${pastille.id}`
												setRefusArchivage(null)
												setOuverture({ type: 'archivage', pastille })
											}}
										>
											{t(pastille.archivee ? 'admin.mailLabels.unarchive' : 'admin.mailLabels.archive')}
										</Button>
									</span>
								</div>
								<p className="text-sm text-text-2 break-words" data-testid="descriptif-pastille-mail">
									{pastille.descriptif}
								</p>
								{ouverture?.type === 'archivage' && ouverture.pastille.id === pastille.id ? (
									<ConfirmationArchivage
										question={t('admin.mailLabels.archive.confirm', { nom: pastille.nom })}
										corps={t('admin.mailLabels.archive.confirm.body')}
										refus={refusArchivage}
										enCours={enCours === pastille.id}
										fermerParEchap
										onAnnuler={fermer}
										onConfirmer={() => void archiver(pastille, true)}
									/>
								) : null}
							</li>
						),
					)}
				</ul>
			)}
		</div>
	)
}

/**
 * La fiche d'une pastille, dans le flux (§5.103) : nom, couleur, descriptif pour l'IA. Une pastille nouvelle en tête, une
 * existante à sa place. Le refus de doublon nomme « Afficher les archivées » quand le nom est pris par une archivée.
 */
function FichePastille({
	client,
	idWorkspace,
	pastille,
	pastilles,
	onFermer,
	onEnregistree,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly pastille: PastilleMail | null
	readonly pastilles: readonly PastilleMail[]
	readonly onFermer: () => void
	readonly onEnregistree: (nom: string) => void
}) {
	const id = useId()
	const [nom, setNom] = useState(pastille?.nom ?? '')
	const [couleur, setCouleur] = useState<CouleurNoeud>(pastille?.couleur ?? 'neutral')
	const [descriptif, setDescriptif] = useState(pastille?.descriptif ?? '')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const champNom = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	const envoyer = async () => {
		if (enCours) return
		setRefus(null)
		setEnCours(true)
		const saisie = { nom, couleur, descriptif }
		const issue =
			pastille === null
				? await creerPastilleMail(client, idWorkspace, saisie)
				: await modifierPastilleMail(client, pastille.id, saisie)
		setEnCours(false)
		if (issue.statut === 'applique') return onEnregistree(nom.trim())
		// Un nom pris par une ARCHIVÉE : le refus nomme le geste qui la montre (§5.29 bis, règle générale).
		const priseParArchivee =
			issue.nature === 'nom-pris' &&
			pastilles.some((p) => p.archivee && p.id !== pastille?.id && p.nom.toLocaleLowerCase('fr') === nom.trim().toLocaleLowerCase('fr'))
		setRefus(t(priseParArchivee ? 'admin.mailLabels.refus.nomArchivee' : CLES_REFUS[issue.nature]))
		// La saisie est gardée, et le focus revient au nom (§5.73).
		champNom.current?.focus()
	}

	return (
		<form
			data-testid="fiche-pastille-mail"
			aria-label={t(pastille === null ? 'admin.mailLabels.form.new' : 'admin.mailLabels.form.edit')}
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
					{t('admin.mailLabels.field.name')}
				</label>
				<input
					id={`${id}-nom`}
					ref={champNom}
					data-testid="pastille-nom"
					type="text"
					autoComplete="off"
					maxLength={LONGUEUR_NOM_PASTILLE}
					value={nom}
					onChange={(evenement) => setNom(evenement.target.value)}
					className={CLASSES_CHAMP}
				/>
			</div>
			<SelecteurCouleur valeur={couleur} onChange={(valeur) => setCouleur(couleurEtiquette(valeur))} />
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-descriptif`} className={CLASSES_LIBELLE}>
					{t('admin.mailLabels.field.description')}
				</label>
				<textarea
					id={`${id}-descriptif`}
					data-testid="pastille-descriptif"
					rows={4}
					maxLength={LONGUEUR_DESCRIPTIF_PASTILLE}
					value={descriptif}
					aria-describedby={`${id}-aide`}
					onChange={(evenement) => setDescriptif(evenement.target.value)}
					className="rounded-sm border border-border bg-surface px-3 py-2 text-base text-text"
				/>
				<p id={`${id}-aide`} className="text-sm text-text-3">
					{t('admin.mailLabels.field.description.help')}
				</p>
			</div>
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="refus-pastille-mail"
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{refus}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{/* Jamais éteint par l'état des champs : aucune garde de saisie ne double une contrainte de la base (§5.34). */}
				<Button variante="primaire" type="submit" disabled={enCours} data-testid="pastille-enregistrer">
					{t(enCours ? 'admin.mailLabels.pending' : 'admin.mailLabels.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="pastille-annuler" onClick={onFermer}>
					{t('admin.mailLabels.cancel')}
				</Button>
			</div>
		</form>
	)
}
