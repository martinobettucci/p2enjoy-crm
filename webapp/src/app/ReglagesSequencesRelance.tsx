// @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//       TRANCHE 4, SOUS-TRANCHE 4c : L'ÉCRAN
// @spec docs/SPEC-modeles-emails.md §13.4 (ce que l'écran est et où il vit), §13.5 (la liste),
//       §13.5 bis (l'embarquement ambigu, mesuré), §13.6 (la fiche, les paliers, le
//       réordonnancement, les deux suppressions), §13.7 (le dictionnaire fermé des refus)
// @spec docs/DESIGN_SYSTEM.md §5.41 (cette surface, en écarts du §5.39), §5.8 (états
//       systématiques), §5.18 (la liste plate), §5.23 (fiche repliée, dans le flux), §5.29 (le
//       patron de suppression confirmée), §5.5 (variantes), §9 (icônes Lucide)
//
// UN ÉCRAN QUI LIT ET QUI ÉCRIT, ET QUI N'OUVRE AUCUNE POLITIQUE. La lecture et l'écriture passent
// par les routes REST de `mail_sequences` et `mail_sequence_steps` sous la RLS de la migration
// `0059` ; le réordonnancement appelle `public.reordonner_paliers_sequence` de la `0062`. Aucun
// droit n'est calculé ici : l'écran envoie, et traduit le refus.
//
// LA POSITION N'EST JAMAIS UN CHAMP (§13.6). C'est le rang dans la liste, déplacé par deux flèches,
// et deux chemins vers le même fait — un champ et des flèches — divergeraient au premier geste.
// C'est l'écart le plus net avec le §5.39, et il est imposé par la forme de la RPC : elle prend un
// ORDRE, pas des positions.
//
// UN DÉPLACEMENT RELIT LA LISTE, IL NE LA RÉORDONNE JAMAIS LOCALEMENT. La RPC rend `0` lorsque la
// politique ne consent pas — MESURÉ sur la lectrice, §13.10 ligne 4 —, et une liste réordonnée
// d'avance montrerait un ordre que la base n'a pas.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, PencilLine, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	ajouterPalier,
	enregistrerSequence,
	libellePalier,
	lirePaliers,
	lireSequences,
	ordreApresDeplacement,
	rangSuivant,
	reordonnerPaliers,
	retirerPalier,
	supprimerSequence,
	type IssueEcritureSequence,
	type PalierSequence,
	type SaisieSequence,
	type SequenceRelance,
} from '../lib/sequences-relance'
import { lireModelesEmails, type ModeleEmail } from '../lib/modeles-emails'
import { lireWorkspaces } from '../lib/workspaces'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire fermé des refus du §13.7 — aucune phrase du serveur n'atteint l'écran.
 *
 * Le motif est celui du §9.8 : le champ `details` d'un refus de contrainte porte la LIGNE FAUTIVE
 * ENTIÈRE. Une séquence n'a pas de corps de 20 000 caractères, mais la discipline ne se relâche pas
 * d'un écran à l'autre — c'est ce qui la rend vérifiable.
 */
const REFUS: Readonly<Record<Exclude<IssueEcritureSequence, 'enregistre'>, CleTraduction>> = {
	refus: 'admin.sequences.refusal.forbidden',
	'zero-ligne': 'admin.sequences.refusal.zeroLigne',
	'nom-borne': 'admin.sequences.refusal.name',
	'nom-pris': 'admin.sequences.refusal.nameTaken',
	'delai-borne': 'admin.sequences.refusal.delay',
	'position-borne': 'admin.sequences.refusal.position',
	'position-prise': 'admin.sequences.refusal.positionTaken',
	'ordre-invalide': 'admin.sequences.refusal.order',
	'sequence-armee': 'admin.sequences.refusal.armed',
	'modele-introuvable': 'admin.sequences.refusal.templateGone',
	'session-expiree': 'admin.sequences.refusal.session',
	reseau: 'admin.sequences.refusal.network',
	inconnu: 'admin.sequences.refusal.unknown',
}

const CLASSES_CHAMP = [
	'min-h-[var(--size-target)] px-3 rounded-sm max-w-full',
	'border border-border bg-surface text-ink',
].join(' ')

/** L'étiquette d'un champ : une colonne qui accepte de rétrécir — voir `CLASSES_CHAMP` au §5.35. */
const CLASSES_ETIQUETTE = 'flex flex-col gap-1 text-sm text-text-2 min-w-0'

const CLASSES_COMMANDE_PRIMAIRE = [
	'inline-flex items-center gap-2 shrink-0',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
	'disabled:opacity-60',
].join(' ')

export type ProprietesReglagesSequencesRelance = {
	readonly client?: ClientCrm | null
}

export function ReglagesSequencesRelance({
	client = clientCrm,
}: ProprietesReglagesSequencesRelance = {}) {
	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [etat, setEtat] = useState<EtatAsync<readonly SequenceRelance[]>>(enChargement)
	const [modeles, setModeles] = useState<EtatAsync<readonly ModeleEmail[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState<SaisieSequence | null>(null)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	/** La séquence dont la suppression attend sa confirmation (§13.6). */
	const [aSupprimer, setASupprimer] = useState<SequenceRelance | null>(null)

	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que les huit autres surfaces de réglages.
	const courant = useRef(0)
	/**
	 * La commande qui a ouvert la fiche, pour lui rendre le focus (§5.13).
	 *
	 * Même mécanique qu'au §5.39 : la commande d'une ligne survit à l'ouverture, celle du bas est
	 * DÉTRUITE, et lui garder une référence rendrait le focus à un nœud détaché du document.
	 */
	const origineFocus = useRef<HTMLButtonElement | null>(null)
	const origineEstCommandeDuBas = useRef(false)
	const commandeDuBas = useRef<HTMLButtonElement | null>(null)
	/** Le retour du focus est DIFFÉRÉ d'un tour de rendu : la commande est démontée (§5.25). */
	const focusARendre = useRef(false)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const espaces = await lireWorkspaces(client)
			if (rang !== courant.current) return
			if (espaces.statut === 'erreur') {
				setEtat(enErreur(espaces.erreur))
				return
			}
			if (espaces.statut !== 'pret') return
			setIdWorkspace(espaces.donnees[0]?.id ?? null)
			const lues = await lireSequences(client)
			if (rang !== courant.current) return
			setEtat(lues.statut === 'pret' ? pret(lues.donnees) : lues)
		})()
	}, [client, tentative])

	// LES MODÈLES SE CHARGENT UNE FOIS, ET LEUR ÉCHEC NE BLOQUE PAS L'ÉCRAN. Un sélecteur de modèle
	// vide empêche d'ajouter un palier et le dit ; il n'empêche ni de lire, ni de renommer, ni de
	// réordonner — c'est le raisonnement de la palette du §9.3, transposé.
	useEffect(() => {
		if (client === null) return
		let vivant = true
		void (async () => {
			const lus = await lireModelesEmails(client)
			if (vivant) setModeles(lus)
		})()
		return () => {
			vivant = false
		}
	}, [client])

	useEffect(() => {
		if (saisie !== null || !focusARendre.current) return
		focusARendre.current = false
		const cible = origineEstCommandeDuBas.current ? commandeDuBas.current : origineFocus.current
		cible?.focus()
	}, [saisie])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const sequences = etat.statut === 'pret' ? etat.donnees : []

	const ouvrir = useCallback(
		(
			sequence: SequenceRelance | null,
			depuis: HTMLButtonElement | null,
			estCommandeDuBas = false,
		) => {
			if (idWorkspace === null) return
			if (depuis !== null) {
				origineFocus.current = depuis
				origineEstCommandeDuBas.current = estCommandeDuBas
			}
			setRefus(null)
			setASupprimer(null)
			setSaisie(
				sequence === null
					? { idWorkspace, idSequence: null, nom: '' }
					: { idWorkspace, idSequence: sequence.id, nom: sequence.name },
			)
		},
		[idWorkspace],
	)

	const fermer = useCallback(() => {
		focusARendre.current = true
		setRefus(null)
		setASupprimer(null)
		setSaisie(null)
	}, [])

	const enregistrer = useCallback(async () => {
		if (client === null || saisie === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const resultat = await enregistrerSequence(client, saisie)
		setEnCours(false)
		if (resultat.issue !== 'enregistre') {
			// Un refus n'efface pas la saisie et laisse la fiche ouverte (§5.7 ter, §13.7).
			setRefus(REFUS[resultat.issue])
			return
		}
		setAnnonce(t('admin.sequences.saved'))
		// LA FICHE RESTE OUVERTE APRÈS UNE CRÉATION, ET C'EST VOULU (§13.6) : la zone des paliers
		// n'apparaît qu'une fois la séquence enregistrée — `sequence_id` est `not null` —, et la
		// refermer obligerait le rédacteur à rouvrir la fiche qu'il vient d'écrire pour poser son
		// premier palier.
		setSaisie({ ...saisie, idSequence: resultat.sequence.id, nom: resultat.sequence.name })
		// LA LISTE EST RELUE, jamais complétée localement (§5.21) : c'est la relecture qui rend le
		// nom tel que `app.btrim_blancs` l'a normalisé, et non tel qu'il a été tapé.
		recharger()
	}, [client, enCours, recharger, saisie])

	const supprimer = useCallback(async () => {
		if (client === null || aSupprimer === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const issue = await supprimerSequence(client, aSupprimer.id)
		setEnCours(false)
		setASupprimer(null)
		if (issue === 'supprime') {
			setSaisie(null)
			focusARendre.current = true
			setAnnonce(t('admin.sequences.deleted'))
			recharger()
			return
		}
		// LE SILENCE DE LA CLAUSE `using` SE DIT EN TOUTES LETTRES (§13.6, §9.7) : la lectrice qui
		// confirme reçoit `204` et la ligne est toujours là. Et `sequence-armee` est le refus que la
		// confirmation ne pouvait pas promettre : il est traduit ici plutôt que rangé dans `inconnu`.
		setRefus(issue === 'zero-ligne' ? 'admin.sequences.delete.refusal.zeroLigne' : REFUS[issue])
	}, [aSupprimer, client, enCours, recharger])

	if (client === null) {
		return (
			<EtatVide
				titre={t('admin.sequences.noWorkspace.title')}
				corps={t('admin.sequences.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.sequences.error.title')}
				corps={t('admin.sequences.error.body')}
				libelleReprise={t('admin.sequences.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	return (
		// La borne est celle du §5.34, pour son motif : une ligne porte ici trois éléments dont une
		// commande, et la borne d'un paragraphe de prose l'y replierait.
		<section aria-label={t('admin.sequences.aria')} className="flex flex-col gap-4 max-w-[104ch]">
			<LiveRegion libelle={t('admin.sequences.live.aria')} message={annonce} />

			{sequences.length === 0 ? (
				// L'état vide PORTE le geste — §5.13, §13.5.
				<EtatVide
					titre={t('admin.sequences.empty.title')}
					corps={t('admin.sequences.empty.body')}
					action={
						saisie === null ? (
							<button
								type="button"
								ref={commandeDuBas}
								data-testid="ouvrir-sequence"
								onClick={(evenement) => ouvrir(null, evenement.currentTarget, true)}
								className={CLASSES_COMMANDE_PRIMAIRE}
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.sequences.open')}
							</button>
						) : undefined
					}
				/>
			) : (
				<ul
					data-testid="liste-sequences"
					className="flex flex-col rounded-lg border border-border bg-surface"
				>
					{sequences.map((sequence) => (
						<LigneSequence
							key={sequence.id}
							sequence={sequence}
							enCours={enCours}
							onModifier={(depuis) => ouvrir(sequence, depuis)}
						/>
					))}
				</ul>
			)}

			{saisie === null
				? sequences.length > 0 && (
						<div>
							<button
								type="button"
								ref={commandeDuBas}
								data-testid="ouvrir-sequence"
								onClick={(evenement) => ouvrir(null, evenement.currentTarget, true)}
								className={CLASSES_COMMANDE_PRIMAIRE}
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.sequences.open')}
							</button>
						</div>
					)
				: null}

			{saisie !== null && (
				<FicheSequence
					client={client}
					saisie={saisie}
					modeles={modeles}
					enCours={enCours}
					refus={refus}
					confirmation={aSupprimer}
					onChangement={setSaisie}
					onAnnonce={setAnnonce}
					onDemanderSuppression={() => {
						const courante = sequences.find((sequence) => sequence.id === saisie.idSequence)
						if (courante !== undefined) setASupprimer(courante)
					}}
					onAnnulerSuppression={() => setASupprimer(null)}
					onConfirmerSuppression={() => void supprimer()}
					onPaliersChanges={recharger}
					onAnnuler={fermer}
					onValider={() => void enregistrer()}
				/>
			)}
		</section>
	)
}

/**
 * Une ligne de la liste plate du §5.41.
 *
 * LE NOM EST EN TÊTE, ET C'EST LA CLÉ — `mail_sequences_workspace_name_key` le rend unique par
 * workspace. LE NOMBRE DE PALIERS SUIT, EN TOUTES LETTRES ET DANS SON PROPRE ÉLÉMENT : ce n'est pas
 * « un chiffre qui ne dit pas ce qu'il compte » (§5.36), c'est la seule donnée qui dise si la
 * cadence est utilisable — une séquence sans palier n'arme rien, et la base rend `sequence_empty`.
 */
function LigneSequence({
	sequence,
	enCours,
	onModifier,
}: {
	readonly sequence: SequenceRelance
	readonly enCours: boolean
	readonly onModifier: (depuis: HTMLButtonElement) => void
}) {
	return (
		<li
			data-testid="ligne-sequence"
			data-sequence={sequence.id}
			className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 px-3 py-2 md:py-0 md:min-h-[var(--size-target)] border-b border-border last:border-b-0 hover:bg-hover"
		>
			<span
				data-testid="nom-sequence"
				className="basis-full md:basis-auto min-w-0 grow truncate font-medium"
				title={sequence.name}
			>
				{sequence.name}
			</span>
			{/* LE COMPTE VIT DANS SON PROPRE ÉLÉMENT (§5.36, §5.11) : un nœud de texte accolé au nom
			    devient un élément flex anonyme que `gap` ne sépare pas — le défaut « Discussion1 ».
			    L'ACCORD SE FAIT PAR CLÉ (§10), jamais par un gabarit paramétré. */}
			<span data-testid="compte-paliers" className="shrink-0 text-sm text-text-2 tabular-nums">
				{sequence.paliers === 0
					? t('admin.sequences.steps.none')
					: sequence.paliers === 1
						? t('admin.sequences.steps.one')
						: t('admin.sequences.steps.many', { compte: String(sequence.paliers) })}
			</span>
			{/* UNE SEULE COMMANDE : rien à prévisualiser — une séquence n'a pas de texte propre, et le
			    §5.39 prévisualise déjà les modèles vers lesquels ses paliers renvoient. La commande
			    n'est JAMAIS éteinte selon le rôle (§5.3, §5.13, §5.21, sans exception). */}
			<button
				type="button"
				data-testid="modifier-sequence"
				disabled={enCours}
				onClick={(evenement) => onModifier(evenement.currentTarget)}
				aria-label={t('admin.sequences.edit.aria', { sequence: sequence.name })}
				className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-sm hover:bg-hover disabled:opacity-60"
			>
				<PencilLine aria-hidden="true" className="size-4" />
				{t('admin.sequences.edit')}
			</button>
		</li>
	)
}

/**
 * La fiche d'une séquence — §13.6.
 *
 * DEUX ZONES, ET L'ORDRE EST CELUI DE LA DÉPENDANCE : une séquence existe avant d'avoir des
 * paliers, et la migration `0059` l'impose — `sequence_id` est `not null`. La zone des paliers
 * n'apparaît donc qu'après la création, et elle dit alors ce qu'il faut faire.
 */
function FicheSequence({
	client,
	saisie,
	modeles,
	enCours,
	refus,
	confirmation,
	onChangement,
	onAnnonce,
	onDemanderSuppression,
	onAnnulerSuppression,
	onConfirmerSuppression,
	onPaliersChanges,
	onAnnuler,
	onValider,
}: {
	readonly client: ClientCrm
	readonly saisie: SaisieSequence
	readonly modeles: EtatAsync<readonly ModeleEmail[]>
	readonly enCours: boolean
	readonly refus: CleTraduction | null
	readonly confirmation: SequenceRelance | null
	readonly onChangement: (saisie: SaisieSequence) => void
	readonly onAnnonce: (message: string) => void
	readonly onDemanderSuppression: () => void
	readonly onAnnulerSuppression: () => void
	readonly onConfirmerSuppression: () => void
	readonly onPaliersChanges: () => void
	readonly onAnnuler: () => void
	readonly onValider: () => void
}) {
	const premierChamp = useRef<HTMLInputElement | null>(null)
	const commandeSuppression = useRef<HTMLButtonElement | null>(null)
	const focusARendre = useRef(false)

	// LE FOCUS ENTRE DANS LE PREMIER CHAMP (§5.34) : sans cela, le clavier resterait sur une commande
	// qui vient de disparaître et repartirait du début du document.
	useEffect(() => {
		premierChamp.current?.focus()
	}, [])

	useEffect(() => {
		if (confirmation !== null || !focusARendre.current) return
		focusARendre.current = false
		commandeSuppression.current?.focus()
	}, [confirmation])

	return (
		<form
			data-testid="fiche-sequence"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider()
			}}
		>
			<h2 className="text-h3">
				{saisie.idSequence === null
					? t('admin.sequences.form.title.new')
					: t('admin.sequences.form.title.edit')}
			</h2>

			<label className={CLASSES_ETIQUETTE}>
				{t('admin.sequences.field.name')}
				{/* AUCUNE GARDE DE SAISIE : ni `required`, ni `maxLength` (§5.3 ter). C'est
				    `mail_sequences_name_borne` qui refuse, refus traduit par le §13.7 — deux règles
				    pour un même fait divergeraient, et celle de l'écran serait la fausse. */}
				<input
					ref={premierChamp}
					type="text"
					data-testid="champ-nom-sequence"
					value={saisie.nom}
					onChange={(evenement) => onChangement({ ...saisie, nom: evenement.target.value })}
					className={CLASSES_CHAMP}
				/>
			</label>

			{refus !== null && (
				<p role="alert" data-testid="refus-sequence" className="text-sm text-danger max-w-[72ch]">
					{t(refus)}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{/* LA COMMANDE D'ENREGISTREMENT EST UNIQUE ET N'EST JAMAIS DÉSACTIVÉE PAR L'ÉTAT DES
				    CHAMPS (§5.34) : un nom vide part, et la base le refuse en le nommant. */}
				<Button
					variante="primaire"
					type="submit"
					data-testid="valider-sequence"
					disabled={enCours}
				>
					{enCours ? t('admin.sequences.saving') : t('admin.sequences.save')}
				</Button>
				<Button variante="secondaire" data-testid="annuler-sequence" onClick={onAnnuler}>
					{t('admin.sequences.cancel')}
				</Button>
				<span className="grow" />
				{/* La commande de suppression n'existe que sur une séquence EXISTANTE : une création n'a
				    rien à détruire. Elle n'est pas destructive elle-même — c'est le bouton de la
				    CONFIRMATION qui l'est (§5.5, §5.28). */}
				{saisie.idSequence !== null && (
					<button
						type="button"
						ref={commandeSuppression}
						data-testid="supprimer-sequence"
						disabled={enCours || confirmation !== null}
						onClick={onDemanderSuppression}
						className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-danger text-sm font-medium hover:bg-hover disabled:opacity-60"
					>
						<Trash2 aria-hidden="true" className="size-4" />
						{t('admin.sequences.delete')}
					</button>
				)}
			</div>

			{confirmation !== null && (
				<ConfirmationSuppressionSequence
					sequence={confirmation}
					onConfirmer={onConfirmerSuppression}
					onAnnuler={() => {
						focusARendre.current = true
						onAnnulerSuppression()
					}}
				/>
			)}

			{saisie.idSequence === null ? (
				// UNE SÉQUENCE EN COURS DE CRÉATION N'A PAS D'IDENTIFIANT : proposer d'y ajouter un
				// palier serait proposer une écriture que la base refusera en `23503`. La zone dit ce
				// qu'il faut faire plutôt que d'offrir un geste mort.
				<p data-testid="paliers-differes" className="text-sm text-text-2 max-w-[72ch]">
					{t('admin.sequences.steps.deferred')}
				</p>
			) : (
				<ZonePaliers
					client={client}
					idWorkspace={saisie.idWorkspace}
					idSequence={saisie.idSequence}
					modeles={modeles}
					onAnnonce={onAnnonce}
					onPaliersChanges={onPaliersChanges}
				/>
			)}
		</form>
	)
}

/**
 * La confirmation de suppression d'une séquence — §13.6, patron du §5.29.
 *
 * ELLE ANNONCE LA CASCADE, COMPTÉE DEPUIS LA DONNÉE DÉJÀ LUE : `on delete cascade` emporte les
 * paliers, et c'est mesuré (§11.5 point m). Elle annonce AUSSI la règle qu'elle ne peut pas
 * promettre — une séquence ARMÉE ne se supprime pas —, sans chiffre : l'écran ne lit pas les
 * inscriptions, et un nombre lu ici pourrait changer entre la lecture et le geste.
 */
function ConfirmationSuppressionSequence({
	sequence,
	onConfirmer,
	onAnnuler,
}: {
	readonly sequence: SequenceRelance
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const action = useRef<HTMLButtonElement | null>(null)
	// LE FOCUS ENTRE SUR LE BOUTON D'ACTION — patron du §5.29.
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-suppression-sequence"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">
				{t('admin.sequences.delete.confirm.title', { sequence: sequence.name })}
			</p>
			<p data-testid="confirmation-cascade" className="text-sm text-text-2">
				{sequence.paliers === 0
					? t('admin.sequences.delete.confirm.noSteps')
					: sequence.paliers === 1
						? t('admin.sequences.delete.confirm.oneStep')
						: t('admin.sequences.delete.confirm.manySteps', {
								compte: String(sequence.paliers),
							})}
			</p>
			<p data-testid="confirmation-regle" className="text-sm text-text-2 max-w-[72ch]">
				{t('admin.sequences.delete.confirm.armedRule')}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					ref={action}
					variante="destructif"
					taille="compacte"
					data-testid="confirmer-suppression-sequence"
					onClick={onConfirmer}
				>
					{t('admin.sequences.delete.confirm.action')}
				</Button>
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="annuler-suppression-sequence"
					onClick={onAnnuler}
				>
					{t('admin.sequences.delete.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * La zone des paliers — §13.6.
 *
 * ELLE PORTE SON PROPRE ÉTAT ET SA PROPRE LECTURE : les paliers d'une séquence ne se lisent que
 * lorsqu'on ouvre sa fiche, et les charger avec la liste rapatrierait la cadence de toutes les
 * séquences pour n'en montrer qu'une.
 */
function ZonePaliers({
	client,
	idWorkspace,
	idSequence,
	modeles,
	onAnnonce,
	onPaliersChanges,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly idSequence: string
	readonly modeles: EtatAsync<readonly ModeleEmail[]>
	readonly onAnnonce: (message: string) => void
	readonly onPaliersChanges: () => void
}) {
	const [etat, setEtat] = useState<EtatAsync<readonly PalierSequence[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [idModele, setIdModele] = useState('')
	const [delai, setDelai] = useState('')
	const courant = useRef(0)

	useEffect(() => {
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lus = await lirePaliers(client, idSequence)
			if (rang !== courant.current) return
			setEtat(lus)
		})()
	}, [client, idSequence, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
		// LA LISTE DES SÉQUENCES EST RELUE AUSSI : son compte de paliers vient de la base (§13.5), et
		// le recalculer localement en ferait une seconde source de vérité.
		onPaliersChanges()
	}, [onPaliersChanges])

	const paliers = etat.statut === 'pret' ? etat.donnees : []

	const deplacer = useCallback(
		async (idPalier: string, sens: 'monter' | 'descendre') => {
			if (enCours) return
			const ordre = ordreApresDeplacement(paliers, idPalier, sens)
			setEnCours(true)
			setRefus(null)
			const issue = await reordonnerPaliers(client, idSequence, ordre)
			setEnCours(false)
			if (issue !== 'reordonne') {
				// `zero-ligne` EST LE REFUS DE LA POLITIQUE, et il a son propre message : la RPC a rendu
				// `200` et `0` — un succès HTTP portant un refus métier (§13.3).
				setRefus(
					issue === 'zero-ligne' ? 'admin.sequences.reorder.refusal.zeroLigne' : REFUS[issue],
				)
				return
			}
			onAnnonce(t('admin.sequences.reordered'))
			// LA LISTE EST RELUE, JAMAIS RÉORDONNÉE LOCALEMENT (§5.41) : une liste réordonnée d'avance
			// montrerait un ordre que la base n'a pas.
			recharger()
		},
		[client, enCours, idSequence, onAnnonce, paliers, recharger],
	)

	const ajouter = useCallback(async () => {
		if (enCours) return
		setEnCours(true)
		setRefus(null)
		// LE RANG EST CALCULÉ DEPUIS LA DONNÉE DÉJÀ LUE (§13.6) : aucune requête de plus. Deux onglets
		// peuvent proposer le même rang, et la base refuse alors en `position-prise` — le refus est
		// traduit plutôt que masqué par une relecture qui ne supprimerait pas la course.
		const issue = await ajouterPalier(
			client,
			{ idWorkspace, idSequence, idModele, delai },
			rangSuivant(paliers),
		)
		setEnCours(false)
		if (issue !== 'enregistre') {
			setRefus(issue === 'zero-ligne' ? 'admin.sequences.steps.refusal.zeroLigne' : REFUS[issue])
			return
		}
		setIdModele('')
		setDelai('')
		onAnnonce(t('admin.sequences.steps.added'))
		recharger()
	}, [client, delai, enCours, idModele, idSequence, idWorkspace, onAnnonce, paliers, recharger])

	const retirer = useCallback(
		async (idPalier: string) => {
			if (enCours) return
			setEnCours(true)
			setRefus(null)
			const issue = await retirerPalier(client, idPalier)
			setEnCours(false)
			if (issue !== 'enregistre') {
				setRefus(
					issue === 'zero-ligne' ? 'admin.sequences.steps.remove.refusal.zeroLigne' : REFUS[issue],
				)
				return
			}
			onAnnonce(t('admin.sequences.steps.removed'))
			recharger()
		},
		[client, enCours, onAnnonce, recharger],
	)

	const listeModeles = modeles.statut === 'pret' ? modeles.donnees : []

	return (
		<div className="flex flex-col gap-3 border-t border-border pt-4">
			<h3 className="text-h3">{t('admin.sequences.steps.title')}</h3>
			<p className="text-sm text-text-2 max-w-[72ch]">{t('admin.sequences.steps.help')}</p>

			{etat.statut === 'chargement' && <SkeletonListe lignes={2} libelle={t('state.loading.aria')} />}

			{etat.statut === 'erreur' && (
				<p role="alert" data-testid="paliers-erreur" className="text-sm text-danger">
					{t('admin.sequences.steps.error')}
				</p>
			)}

			{etat.statut === 'pret' && paliers.length === 0 && (
				<p data-testid="paliers-vides" className="text-sm text-text-2 max-w-[72ch]">
					{t('admin.sequences.steps.empty')}
				</p>
			)}

			{paliers.length > 0 && (
				<ul
					data-testid="liste-paliers"
					className="flex flex-col rounded-lg border border-border bg-surface"
				>
					{paliers.map((palier, rang) => (
						<li
							key={palier.id}
							data-testid="ligne-palier"
							data-palier={palier.id}
							data-position={palier.position}
							className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 px-3 py-2 md:py-0 md:min-h-[var(--size-target)] border-b border-border last:border-b-0 hover:bg-hover"
						>
							{/* LE RANG EST EN TÊTE, EN `tabular-nums` — comme le retard du §5.37. C'est lui
							    qui range cette liste, et une colonne de nombres alignés se lit d'un regard. */}
							<span
								data-testid="rang-palier"
								className="shrink-0 tabular-nums text-sm px-2 py-1 rounded-full bg-hover text-text-2"
							>
								{palier.position}
							</span>
							<span
								data-testid="libelle-palier"
								className="basis-full md:basis-auto min-w-0 grow truncate"
								title={libellePalier(palier)}
							>
								{libellePalier(palier)}
							</span>
							{/* « Monter » SUR LE PREMIER ET « Descendre » SUR LE DERNIER SONT MONTÉS ET
							    DÉSACTIVÉS (§5.41). Ce n'est PAS un droit calculé : c'est un geste sans objet
							    sur cet élément-là. Leur `aria-label` NOMME le palier — deux flèches
							    identiques répétées ne diraient pas ce que chacune déplace. */}
							<button
								type="button"
								data-testid="monter-palier"
								disabled={enCours || rang === 0}
								onClick={() => void deplacer(palier.id, 'monter')}
								aria-label={t('admin.sequences.steps.up.aria', { palier: libellePalier(palier) })}
								className="inline-flex items-center justify-center shrink-0 size-[var(--size-target)] rounded-sm border border-border bg-surface hover:bg-hover disabled:opacity-60"
							>
								<ArrowUp aria-hidden="true" className="size-4" />
							</button>
							<button
								type="button"
								data-testid="descendre-palier"
								disabled={enCours || rang === paliers.length - 1}
								onClick={() => void deplacer(palier.id, 'descendre')}
								aria-label={t('admin.sequences.steps.down.aria', {
									palier: libellePalier(palier),
								})}
								className="inline-flex items-center justify-center shrink-0 size-[var(--size-target)] rounded-sm border border-border bg-surface hover:bg-hover disabled:opacity-60"
							>
								<ArrowDown aria-hidden="true" className="size-4" />
							</button>
							{/* « Retirer » N'A PAS DE CONFIRMATION, ET C'EST UN ÉCART MOTIVÉ AU §6 : le geste
							    ne détruit AUCUN texte — le modèle reste, la séquence reste, seule la ligne
							    qui les relie disparaît, et la reposer est un formulaire de deux champs. */}
							<button
								type="button"
								data-testid="retirer-palier"
								disabled={enCours}
								onClick={() => void retirer(palier.id)}
								aria-label={t('admin.sequences.steps.remove.aria', {
									palier: libellePalier(palier),
								})}
								className="inline-flex items-center justify-center shrink-0 size-[var(--size-target)] rounded-sm border border-border bg-surface text-danger hover:bg-hover disabled:opacity-60"
							>
								<X aria-hidden="true" className="size-4" />
							</button>
						</li>
					))}
				</ul>
			)}

			{refus !== null && (
				<p role="alert" data-testid="refus-palier" className="text-sm text-danger max-w-[72ch]">
					{t(refus)}
				</p>
			)}

			{/* L'AJOUT NE DEMANDE PAS SA POSITION (§13.6) : le palier ajouté prend le rang suivant,
			    calculé depuis la donnée déjà lue. Un champ de position ferait saisir deux fois la même
			    intention. */}
			<div className="flex flex-wrap items-end gap-2">
				<label className={CLASSES_ETIQUETTE}>
					{t('admin.sequences.steps.field.template')}
					<select
						data-testid="champ-modele-palier"
						value={idModele}
						onChange={(evenement) => setIdModele(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						{/* L'OPTION DE TÊTE EST VIDE : rien n'est présélectionné (§5.41, §9.5). Le
						    sélecteur porte TOUS les modèles que l'appelant lit — un modèle sert plusieurs
						    paliers, et aucune option n'est retirée parce qu'elle est déjà employée. */}
						<option value="">{t('admin.sequences.steps.field.template.none')}</option>
						{listeModeles.map((modele) => (
							<option key={modele.id} value={modele.id}>
								{modele.name}
							</option>
						))}
					</select>
				</label>
				<label className={CLASSES_ETIQUETTE}>
					{t('admin.sequences.steps.field.delay')}
					{/* AUCUNE GARDE DE SAISIE : ni `required`, ni `min`, ni `max` (§5.3 ter). C'est
					    `mail_sequence_steps_delai_borne` qui refuse, refus traduit. */}
					<input
						type="number"
						data-testid="champ-delai-palier"
						value={delai}
						onChange={(evenement) => setDelai(evenement.target.value)}
						className={`${CLASSES_CHAMP} w-32`}
					/>
				</label>
				<Button
					variante="secondaire"
					data-testid="ajouter-palier"
					disabled={enCours}
					onClick={() => void ajouter()}
				>
					<Plus aria-hidden="true" className="size-4" />
					{t('admin.sequences.steps.add')}
				</Button>
			</div>
		</div>
	)
}
