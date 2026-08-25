// @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
// @spec docs/SPEC-modeles-emails.md §9.1 (ce que l'écran est et où il vit), §9.2 (ce qu'il lit),
//       §9.3 (la palette des douze variables et son insertion), §9.4 (la liste), §9.5 (les trois
//       sources de la prévisualisation), §9.6 (ce que `variables_nulles` rend), §9.7 (la
//       confirmation de suppression), §9.8 (le dictionnaire fermé des refus)
// @spec docs/DESIGN_SYSTEM.md §5.39 (cette surface, en écarts du §5.34), §5.8 (états
//       systématiques), §5.18 (la liste plate), §5.23 (formulaire replié, dans le flux), §5.29
//       (le patron de suppression confirmée)
//
// UN ÉCRAN QUI LIT ET QUI ÉCRIT, ET QUI N'OUVRE AUCUNE POLITIQUE. La lecture et l'écriture passent
// par les routes REST de `mail_templates` sous la RLS de la migration `0055` ; la palette appelle
// le guichet de la `0057` ; la prévisualisation appelle `public.rendre_modele_email` de la `0056`.
// Aucun droit n'est calculé ici : l'écran envoie, et traduit le refus.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, PencilLine, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	enregistrerModeleEmail,
	insererTrou,
	libelleContactPrevisualisation,
	libelleIdentitePrevisualisation,
	lireAffairesPrevisualisation,
	lireModelesEmails,
	lireVariablesModele,
	rendreModeleEmail,
	supprimerModeleEmail,
	type AffairePrevisualisation,
	type IssueEcritureModele,
	type ModeleEmail,
	type RenduModeleEmail,
	type SaisieModeleEmail,
} from '../lib/modeles-emails'
import { lireContactsDuCarnet, type ContactDuCarnet } from '../lib/contacts'
import { lireIdentitesSortantes, type IdentiteSortante } from '../lib/mail-identites'
import { lireWorkspaces } from '../lib/workspaces'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire fermé des refus du §9.8 — aucune phrase du serveur n'atteint l'écran.
 *
 * Le motif est ici plus étroit que l'INC-193 des identités : le champ `details` d'un refus de
 * contrainte porte la LIGNE FAUTIVE ENTIÈRE, c'est-à-dire le corps du modèle.
 */
const REFUS: Readonly<Record<Exclude<IssueEcritureModele, 'enregistre'>, CleTraduction>> = {
	refus: 'admin.mailTemplates.refusal.forbidden',
	'zero-ligne': 'admin.mailTemplates.refusal.zeroLigne',
	'variable-inconnue-objet': 'admin.mailTemplates.refusal.subjectVariable',
	'variable-inconnue-corps': 'admin.mailTemplates.refusal.bodyVariable',
	'nom-borne': 'admin.mailTemplates.refusal.name',
	'objet-borne': 'admin.mailTemplates.refusal.subject',
	'corps-borne': 'admin.mailTemplates.refusal.body',
	'nom-pris': 'admin.mailTemplates.refusal.nameTaken',
	'session-expiree': 'admin.mailTemplates.refusal.session',
	reseau: 'admin.mailTemplates.refusal.network',
	inconnu: 'admin.mailTemplates.refusal.unknown',
}

const CLASSES_CHAMP = [
	'min-h-[var(--size-target)] px-3 rounded-sm max-w-full',
	'border border-border bg-surface text-ink',
].join(' ')

/** L'étiquette d'un champ : une colonne qui accepte de rétrécir — voir `CLASSES_CHAMP` au §5.35. */
const CLASSES_ETIQUETTE = 'flex flex-col gap-1 text-sm text-text-2 min-w-0'

/**
 * Le champ que le rédacteur a visité en dernier, et où la palette insère.
 *
 * `corps` est le défaut : à l'ouverture, aucun des deux n'a été visité, et un modèle porte
 * presque toujours plus de variables dans son corps que dans son objet (§9.3).
 */
type ChampVise = 'objet' | 'corps'

export type ProprietesReglagesModelesEmails = {
	readonly client?: ClientCrm | null
}

export function ReglagesModelesEmails({
	client = clientCrm,
}: ProprietesReglagesModelesEmails = {}) {
	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [etat, setEtat] = useState<EtatAsync<readonly ModeleEmail[]>>(enChargement)
	const [variables, setVariables] = useState<EtatAsync<readonly string[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState<SaisieModeleEmail | null>(null)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	/** Le modèle dont la prévisualisation est ouverte — jamais deux à la fois. */
	const [previsualise, setPrevisualise] = useState<ModeleEmail | null>(null)
	/** Le modèle dont la suppression attend sa confirmation (§9.7). */
	const [aSupprimer, setASupprimer] = useState<ModeleEmail | null>(null)

	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que les sept autres surfaces de réglages.
	const courant = useRef(0)
	/**
	 * La commande qui a ouvert la fiche, pour lui rendre le focus (§5.13).
	 *
	 * Même mécanique qu'au §5.35 : la commande d'une ligne survit à l'ouverture — la liste reste
	 * montée —, celle du bas est DÉTRUITE, et lui garder une référence rendrait le focus à un nœud
	 * détaché du document. La commande du bas porte donc sa propre référence, que React réassigne
	 * au nœud neuf, et l'origine ne retient que LAQUELLE des deux a ouvert.
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
			const lus = await lireModelesEmails(client)
			if (rang !== courant.current) return
			setEtat(lus.statut === 'pret' ? pret(lus.donnees) : lus)
		})()
	}, [client, tentative])

	// LA PALETTE SE CHARGE UNE FOIS, ET SON ÉCHEC NE BLOQUE PAS L'ÉCRAN (§9.3). Une liste de
	// variables illisible rend la palette muette et le dit ; elle n'empêche ni de lire, ni d'écrire
	// un modèle — c'est toujours la base qui refuse une variable inconnue.
	useEffect(() => {
		if (client === null) return
		let vivant = true
		void (async () => {
			const lues = await lireVariablesModele(client)
			if (vivant) setVariables(lues)
		})()
		return () => {
			vivant = false
		}
	}, [client])

	useEffect(() => {
		if (saisie !== null || !focusARendre.current) return
		focusARendre.current = false
		// Le nœud est relu MAINTENANT, après le rendu qui a remonté la commande du bas.
		const cible = origineEstCommandeDuBas.current ? commandeDuBas.current : origineFocus.current
		cible?.focus()
	}, [saisie])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const modeles = etat.statut === 'pret' ? etat.donnees : []

	const ouvrir = useCallback(
		(modele: ModeleEmail | null, depuis: HTMLButtonElement | null, estCommandeDuBas = false) => {
			if (idWorkspace === null) return
			if (depuis !== null) {
				origineFocus.current = depuis
				origineEstCommandeDuBas.current = estCommandeDuBas
			}
			setRefus(null)
			setASupprimer(null)
			setPrevisualise(null)
			setSaisie(
				modele === null
					? { idWorkspace, idModele: null, nom: '', objet: '', corps: '' }
					: {
							idWorkspace,
							idModele: modele.id,
							nom: modele.name,
							objet: modele.subject,
							corps: modele.body_text,
						},
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
		const resultat = await enregistrerModeleEmail(client, saisie)
		setEnCours(false)
		if (resultat.issue !== 'enregistre') {
			// Un refus n'efface pas la saisie et laisse la fiche ouverte (§5.7 ter, §9.8).
			setRefus(REFUS[resultat.issue])
			return
		}
		setSaisie(null)
		focusARendre.current = true
		setAnnonce(t('admin.mailTemplates.saved'))
		// LA LISTE EST RELUE, jamais complétée localement (§5.21) : c'est la relecture qui rend le
		// nom tel que `app.btrim_blancs` l'a normalisé, et non tel qu'il a été tapé.
		recharger()
	}, [client, enCours, recharger, saisie])

	const supprimer = useCallback(async () => {
		if (client === null || aSupprimer === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const issue = await supprimerModeleEmail(client, aSupprimer.id)
		setEnCours(false)
		setASupprimer(null)
		if (issue === 'supprime') {
			setSaisie(null)
			focusARendre.current = true
			setAnnonce(t('admin.mailTemplates.deleted'))
			recharger()
			return
		}
		// LE SILENCE DE LA CLAUSE `using` SE DIT EN TOUTES LETTRES (§9.7) : la lectrice qui confirme
		// reçoit `204` et la ligne est toujours là. L'écran n'annonce jamais un succès qui n'a pas eu
		// lieu.
		setRefus(
			issue === 'zero-ligne' ? 'admin.mailTemplates.delete.refusal.zeroLigne' : REFUS[issue],
		)
	}, [aSupprimer, client, enCours, recharger])

	if (client === null) {
		return (
			<EtatVide
				titre={t('admin.mailTemplates.noWorkspace.title')}
				corps={t('admin.mailTemplates.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.mailTemplates.error.title')}
				corps={t('admin.mailTemplates.error.body')}
				libelleReprise={t('admin.mailTemplates.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	return (
		// La borne est celle du §5.34, pour son motif : une ligne porte ici quatre éléments dont deux
		// commandes, et la borne d'un paragraphe de prose l'y replierait.
		<section
			aria-label={t('admin.mailTemplates.aria')}
			className="flex flex-col gap-4 max-w-[104ch]"
		>
			<LiveRegion libelle={t('admin.mailTemplates.live.aria')} message={annonce} />

			{modeles.length === 0 ? (
				// L'état vide PORTE le geste — §5.13, §9.4.
				<EtatVide
					titre={t('admin.mailTemplates.empty.title')}
					corps={t('admin.mailTemplates.empty.body')}
					action={
						saisie === null ? (
							<button
								type="button"
								ref={commandeDuBas}
								data-testid="ouvrir-modele"
								onClick={(evenement) => ouvrir(null, evenement.currentTarget, true)}
								className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white text-sm font-medium transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover disabled:opacity-60"
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.mailTemplates.open')}
							</button>
						) : undefined
					}
				/>
			) : (
				<ul
					data-testid="liste-modeles-emails"
					className="flex flex-col rounded-lg border border-border bg-surface"
				>
					{modeles.map((modele) => (
						<LigneModele
							key={modele.id}
							modele={modele}
							enCours={enCours}
							onPrevisualiser={() => {
								setSaisie(null)
								setASupprimer(null)
								setPrevisualise(modele)
							}}
							onModifier={(depuis) => ouvrir(modele, depuis)}
						/>
					))}
				</ul>
			)}

			{saisie === null
				? modeles.length > 0 && (
						<div>
							<button
								type="button"
								ref={commandeDuBas}
								data-testid="ouvrir-modele"
								onClick={(evenement) => ouvrir(null, evenement.currentTarget, true)}
								className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white text-sm font-medium transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover disabled:opacity-60"
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.mailTemplates.open')}
							</button>
						</div>
					)
				: null}

			{saisie !== null && (
				<FicheModele
					saisie={saisie}
					variables={variables}
					enCours={enCours}
					refus={refus}
					confirmation={aSupprimer}
					onChangement={setSaisie}
					onDemanderSuppression={() => {
						const courante = modeles.find((modele) => modele.id === saisie.idModele)
						if (courante !== undefined) setASupprimer(courante)
					}}
					onAnnulerSuppression={() => setASupprimer(null)}
					onConfirmerSuppression={() => void supprimer()}
					onAnnuler={fermer}
					onValider={() => void enregistrer()}
				/>
			)}

			{previsualise !== null && (
				<Previsualisation
					client={client}
					modele={previsualise}
					onFermer={() => setPrevisualise(null)}
				/>
			)}
		</section>
	)
}

/**
 * Une ligne de la liste plate du §5.39.
 *
 * LE NOM EST EN TÊTE, ET C'EST LA CLÉ — `mail_templates_workspace_name_key` le rend unique par
 * workspace. L'objet suit en second ton, et SES VARIABLES SE RENDENT TELLES QUELLES : la liste
 * n'est pas une prévisualisation, et substituer y supposerait une affaire qu'elle n'a pas.
 */
function LigneModele({
	modele,
	enCours,
	onPrevisualiser,
	onModifier,
}: {
	readonly modele: ModeleEmail
	readonly enCours: boolean
	readonly onPrevisualiser: () => void
	readonly onModifier: (depuis: HTMLButtonElement | null) => void
}) {
	return (
		<li
			data-testid="ligne-modele-email"
			data-modele={modele.id}
			className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-hover"
		>
			<span
				data-testid="nom-modele"
				className="font-medium truncate max-w-[34ch]"
				title={modele.name}
			>
				{modele.name}
			</span>
			<span
				data-testid="objet-modele"
				className="text-sm text-text-2 truncate max-w-[44ch]"
				title={modele.subject}
			>
				{modele.subject}
			</span>
			<span className="grow" />
			{/* Aucune commande n'est éteinte selon le rôle (§5.3, §5.13, §5.21, §5.27) : la lectrice
			    voit les deux, et c'est la base qui refuse — mesuré, `403` sur un `POST`, zéro ligne
			    sur un `PATCH`. */}
			<button
				type="button"
				data-testid="previsualiser-modele"
				disabled={enCours}
				onClick={onPrevisualiser}
				aria-label={t('admin.mailTemplates.preview.aria', { modele: modele.name })}
				className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-2 rounded-sm text-text-2 text-sm font-medium hover:bg-hover disabled:opacity-60"
			>
				<Eye aria-hidden="true" className="size-4" />
				{t('admin.mailTemplates.preview')}
			</button>
			<button
				type="button"
				data-testid="modifier-modele"
				disabled={enCours}
				onClick={(evenement) => onModifier(evenement.currentTarget)}
				aria-label={t('admin.mailTemplates.edit.aria', { modele: modele.name })}
				className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-2 rounded-sm text-text-2 text-sm font-medium hover:bg-hover disabled:opacity-60"
			>
				<PencilLine aria-hidden="true" className="size-4" />
				{t('admin.mailTemplates.edit')}
			</button>
		</li>
	)
}

/**
 * La fiche d'un modèle — création et modification confondues, comme au §5.35.
 *
 * LA SUPPRESSION VIT ICI, et non sur la ligne (§9.4, §5.29) : un geste destructeur ne se déclenche
 * pas depuis une liste qu'on balaye, et la fiche est le seul endroit où le rédacteur a sous les
 * yeux le texte qu'il va perdre.
 */
function FicheModele({
	saisie,
	variables,
	enCours,
	refus,
	confirmation,
	onChangement,
	onDemanderSuppression,
	onAnnulerSuppression,
	onConfirmerSuppression,
	onAnnuler,
	onValider,
}: {
	readonly saisie: SaisieModeleEmail
	readonly variables: EtatAsync<readonly string[]>
	readonly enCours: boolean
	readonly refus: CleTraduction | null
	/** Le modèle dont la suppression attend sa confirmation, ou `null`. */
	readonly confirmation: ModeleEmail | null
	readonly onChangement: (saisie: SaisieModeleEmail) => void
	readonly onDemanderSuppression: () => void
	readonly onAnnulerSuppression: () => void
	readonly onConfirmerSuppression: () => void
	readonly onAnnuler: () => void
	readonly onValider: () => void
}) {
	const premier = useRef<HTMLInputElement | null>(null)
	const champObjet = useRef<HTMLInputElement | null>(null)
	const champCorps = useRef<HTMLTextAreaElement | null>(null)
	const [vise, setVise] = useState<ChampVise>('corps')
	/**
	 * La commande de suppression, pour lui rendre le focus (§5.29).
	 *
	 * Elle reste MONTÉE pendant sa confirmation, mais elle est DÉSACTIVÉE, et un bouton désactivé
	 * REFUSE le focus : `focus()` appelé depuis le gestionnaire d'annulation laisserait le focus sur
	 * le document. Le remède est un drapeau puis un effet — aucune temporisation (`CLAUDE.md` §18).
	 */
	const commandeSuppression = useRef<HTMLButtonElement | null>(null)
	const focusARendre = useRef(false)

	// Ouvrir une fiche déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	useEffect(() => {
		if (confirmation !== null || !focusARendre.current) return
		focusARendre.current = false
		commandeSuppression.current?.focus()
	}, [confirmation])

	/**
	 * Insère une variable à la position du curseur du champ visé — §9.3.
	 *
	 * LE FOCUS EST RENDU AU CHAMP, ET LE CURSEUR REPOSÉ APRÈS LE TROU : sans cela, le rédacteur qui
	 * pose deux variables de suite verrait la seconde atterrir là où la première avait laissé le
	 * curseur avant l'insertion, c'est-à-dire avant elle. La repose est faite dans le même geste
	 * que l'écriture, jamais après une temporisation.
	 */
	const inserer = useCallback(
		(variable: string) => {
			const element = vise === 'objet' ? champObjet.current : champCorps.current
			const texte = vise === 'objet' ? saisie.objet : saisie.corps
			const debut = element?.selectionStart ?? texte.length
			const fin = element?.selectionEnd ?? debut
			const resultat = insererTrou(texte, debut, fin, variable)
			onChangement(
				vise === 'objet'
					? { ...saisie, objet: resultat.texte }
					: { ...saisie, corps: resultat.texte },
			)
			if (element !== null && element !== undefined) {
				element.focus()
				element.setSelectionRange(resultat.curseur, resultat.curseur)
			}
		},
		[onChangement, saisie, vise],
	)

	return (
		<form
			data-testid="fiche-modele-email"
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider()
			}}
		>
			<h3 className="text-h3">
				{saisie.idModele === null
					? t('admin.mailTemplates.form.title.new')
					: t('admin.mailTemplates.form.title.edit')}
			</h3>

			<label className={CLASSES_ETIQUETTE}>
				{t('admin.mailTemplates.field.name')}
				{/* AUCUNE GARDE DE SAISIE : ni `required`, ni `maxLength`. C'est la contrainte
				    `mail_templates_name_borne` qui tranche, et son refus est traduit (§5.3 ter). */}
				<input
					ref={premier}
					data-testid="champ-nom-modele"
					value={saisie.nom}
					onChange={(evenement) => onChangement({ ...saisie, nom: evenement.target.value })}
					className={CLASSES_CHAMP}
				/>
				<span className="text-sm text-text-3 max-w-[60ch]">
					{t('admin.mailTemplates.field.name.help')}
				</span>
			</label>

			<label className={CLASSES_ETIQUETTE}>
				{t('admin.mailTemplates.field.subject')}
				<input
					ref={champObjet}
					data-testid="champ-objet-modele"
					value={saisie.objet}
					onFocus={() => setVise('objet')}
					onChange={(evenement) => onChangement({ ...saisie, objet: evenement.target.value })}
					className={CLASSES_CHAMP}
				/>
			</label>

			<label className={CLASSES_ETIQUETTE}>
				{t('admin.mailTemplates.field.body')}
				{/* UNE `textarea`, ET NON UN `input` : le corps est du texte multiligne, et le
				    sous-système expédie du texte (`docs/SPEC-mail-subsystem.md` §18). */}
				<textarea
					ref={champCorps}
					data-testid="champ-corps-modele"
					rows={10}
					value={saisie.corps}
					onFocus={() => setVise('corps')}
					onChange={(evenement) => onChangement({ ...saisie, corps: evenement.target.value })}
					className={[CLASSES_CHAMP, 'py-2 leading-relaxed'].join(' ')}
				/>
			</label>

			<PaletteVariables variables={variables} onInserer={inserer} />

			{refus !== null && (
				<p
					role="alert"
					data-testid="refus-modele-email"
					className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					{t(refus)}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{/* JAMAIS DÉSACTIVÉ PAR L'ÉTAT DES CHAMPS (§5.34) : c'est la base qui refuse une saisie
				    incomplète, et l'écran traduit son refus. Il l'est pendant le vol. */}
				<button
					type="submit"
					data-testid="valider-modele-email"
					disabled={enCours}
					className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-60"
				>
					{enCours ? t('admin.mailTemplates.saving') : t('admin.mailTemplates.save')}
				</button>
				<button
					type="button"
					data-testid="annuler-modele-email"
					onClick={onAnnuler}
					className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-ink text-sm font-medium hover:bg-hover"
				>
					{t('admin.mailTemplates.cancel')}
				</button>
				<span className="grow" />
				{/* La commande de suppression n'existe que sur un modèle EXISTANT : une création n'a
				    rien à détruire. Elle n'est pas destructive elle-même — c'est le bouton de la
				    CONFIRMATION qui l'est (§5.5, §5.28). */}
				{saisie.idModele !== null && (
					<button
						type="button"
						ref={commandeSuppression}
						data-testid="supprimer-modele-email"
						disabled={enCours || confirmation !== null}
						onClick={onDemanderSuppression}
						className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-danger text-sm font-medium hover:bg-hover disabled:opacity-60"
					>
						<Trash2 aria-hidden="true" className="size-4" />
						{t('admin.mailTemplates.delete')}
					</button>
				)}
			</div>

			{confirmation !== null && (
				<ConfirmationSuppression
					nom={confirmation.name}
					onConfirmer={onConfirmerSuppression}
					onAnnuler={() => {
						focusARendre.current = true
						onAnnulerSuppression()
					}}
				/>
			)}
		</form>
	)
}

/**
 * La palette des douze variables — §9.3.
 *
 * LA LISTE VIENT DE LA BASE ET N'EST JAMAIS RECOPIÉE ICI : une treizième variable ajoutée au §2.4
 * y paraîtra sans qu'on touche à l'interface. Son échec de lecture ne bloque rien et se dit.
 */
function PaletteVariables({
	variables,
	onInserer,
}: {
	readonly variables: EtatAsync<readonly string[]>
	readonly onInserer: (variable: string) => void
}) {
	if (variables.statut === 'erreur') {
		return (
			<p data-testid="palette-variables-erreur" className="text-sm text-text-2">
				{t('admin.mailTemplates.variables.error')}
			</p>
		)
	}
	if (variables.statut !== 'pret' || variables.donnees.length === 0) return null
	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm font-medium text-ink">{t('admin.mailTemplates.variables.title')}</p>
			<p className="text-sm text-text-2 max-w-[72ch]">
				{t('admin.mailTemplates.variables.body')}
			</p>
			<ul data-testid="palette-variables" className="flex flex-wrap gap-2">
				{variables.donnees.map((variable) => (
					<li key={variable}>
						{/* LE NOM EST RENDU EN DONNÉE TECHNIQUE (§2 du design system) : c'est la chaîne
						    exacte que le rédacteur retrouvera dans son texte. */}
						<button
							type="button"
							data-testid="inserer-variable"
							data-variable={variable}
							onClick={() => onInserer(variable)}
							aria-label={t('admin.mailTemplates.variables.insert.aria', { variable })}
							className="min-h-[var(--size-target)] px-2 rounded-sm border border-border bg-surface text-sm text-text-2 font-mono hover:bg-hover"
						>
							{`{{${variable}}}`}
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}

/**
 * La confirmation de suppression — §9.7, patron du §5.29.
 *
 * ELLE NOMME LE MODÈLE ET N'ANNONCE AUCUNE CASCADE, et c'est une MESURE : `pg_constraint` ne porte
 * aucune clé étrangère vers `mail_templates` au 2026-08-25. Annoncer une rupture de séquence
 * décrirait un objet que la tranche 4 n'a pas posé, et promettre le refus de son futur
 * `on delete restrict` mentirait dans l'autre sens.
 */
function ConfirmationSuppression({
	nom,
	onConfirmer,
	onAnnuler,
}: {
	readonly nom: string
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
			data-testid="confirmation-suppression-modele"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{t('admin.mailTemplates.delete.confirm.title', { modele: nom })}</p>
			<p className="text-sm text-text-2">{t('admin.mailTemplates.delete.confirm.body')}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					ref={action}
					variante="destructif"
					taille="compacte"
					data-testid="confirmer-suppression-modele"
					onClick={onConfirmer}
				>
					{t('admin.mailTemplates.delete.confirm.action')}
				</Button>
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="annuler-suppression-modele"
					onClick={onAnnuler}
				>
					{t('admin.mailTemplates.delete.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * La prévisualisation d'un modèle sur une affaire réelle — §9.5, §9.6.
 *
 * AUCUN DES TROIS SÉLECTEURS NE PRÉSÉLECTIONNE, y compris celui de l'affaire, qui est pourtant
 * obligatoire : présélectionner la première affaire du tri ferait rendre un texte au sujet d'une
 * affaire que le rédacteur n'a pas désignée.
 */
function Previsualisation({
	client,
	modele,
	onFermer,
}: {
	readonly client: ClientCrm
	readonly modele: ModeleEmail
	readonly onFermer: () => void
}) {
	const [affaires, setAffaires] = useState<readonly AffairePrevisualisation[]>([])
	const [contacts, setContacts] = useState<readonly ContactDuCarnet[]>([])
	const [identites, setIdentites] = useState<readonly IdentiteSortante[]>([])
	const [idAffaire, setIdAffaire] = useState('')
	const [idContact, setIdContact] = useState('')
	const [idIdentite, setIdIdentite] = useState('')
	const [rendu, setRendu] = useState<EtatAsync<RenduModeleEmail | null> | null>(null)
	const [enVol, setEnVol] = useState(false)
	const premier = useRef<HTMLSelectElement | null>(null)

	useEffect(() => {
		premier.current?.focus()
	}, [])

	useEffect(() => {
		let vivant = true
		void (async () => {
			const [lesAffaires, lesContacts, lesIdentites] = await Promise.all([
				lireAffairesPrevisualisation(client),
				lireContactsDuCarnet(client),
				lireIdentitesSortantes(client),
			])
			if (!vivant) return
			// UN ÉCHEC DE SÉLECTEUR NE BLOQUE PAS LE RENDU : les trois listes sont des commodités de
			// choix, et la fonction accepte des identifiants quels qu'ils soient. Une liste vide se
			// voit — le sélecteur n'offre que son option vide —, et c'est plus honnête qu'un état
			// d'erreur qui masquerait les deux autres.
			if (lesAffaires.statut === 'pret') setAffaires(lesAffaires.donnees)
			if (lesContacts.statut === 'pret') setContacts(lesContacts.donnees)
			if (lesIdentites.statut === 'pret') setIdentites(lesIdentites.donnees)
		})()
		return () => {
			vivant = false
		}
	}, [client])

	const rendreMaintenant = useCallback(async () => {
		if (enVol) return
		setEnVol(true)
		const resultat = await rendreModeleEmail(client, {
			idModele: modele.id,
			idAffaire,
			idContact,
			idIdentite,
		})
		setEnVol(false)
		setRendu(resultat)
	}, [client, enVol, idAffaire, idContact, idIdentite, modele.id])

	return (
		<section
			data-testid="previsualisation-modele"
			aria-label={t('admin.mailTemplates.previewPane.title', { modele: modele.name })}
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
		>
			<h3 className="text-h3">
				{t('admin.mailTemplates.previewPane.title', { modele: modele.name })}
			</h3>

			<div className="flex flex-wrap gap-3">
				<label className={CLASSES_ETIQUETTE}>
					{t('admin.mailTemplates.previewPane.card')}
					<select
						ref={premier}
						data-testid="champ-affaire-previsualisation"
						value={idAffaire}
						onChange={(evenement) => setIdAffaire(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						{/* L'OPTION VIDE EST L'AVEU QU'AUCUN CHOIX N'EST FAIT (§9.5). C'est l'écart
						    assumé avec le §5.34, dont le sélecteur n'en porte aucune : là-bas la cible
						    est la clé de l'objet configuré, ici c'est un choix de simulation. */}
						<option value="">{t('admin.mailTemplates.previewPane.card.none')}</option>
						{affaires.map((affaire) => (
							<option key={affaire.id} value={affaire.id}>
								{affaire.title}
							</option>
						))}
					</select>
				</label>

				<label className={CLASSES_ETIQUETTE}>
					{t('admin.mailTemplates.previewPane.contact')}
					{/* LA LISTE PORTE TOUS LES CONTACTS LISIBLES, jamais les seuls contacts rattachés à
					    l'affaire : MESURÉ, `card_contacts` ne porte que 2 lignes pour 41 affaires, si
					    bien qu'un sélecteur restreint serait vide sur 39 affaires sur 41 (§9.5). */}
					<select
						data-testid="champ-contact-previsualisation"
						value={idContact}
						onChange={(evenement) => setIdContact(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						<option value="">{t('admin.mailTemplates.previewPane.contact.none')}</option>
						{contacts.map((contact) => (
							<option key={contact.id} value={contact.id}>
								{libelleContactPrevisualisation(contact)}
							</option>
						))}
					</select>
				</label>

				<label className={CLASSES_ETIQUETTE}>
					{t('admin.mailTemplates.previewPane.identity')}
					{/* AUCUNE PRÉSÉLECTION : « l'identité par défaut du workspace » N'EXISTE PAS —
					    mesuré, DEUX lignes du seed portent `is_default`, les index uniques partiels
					    garantissant l'unicité par personne et pour le service (§8.5). */}
					<select
						data-testid="champ-identite-previsualisation"
						value={idIdentite}
						onChange={(evenement) => setIdIdentite(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						<option value="">{t('admin.mailTemplates.previewPane.identity.none')}</option>
						{identites.map((identite) => (
							<option key={identite.id} value={identite.id}>
								{libelleIdentitePrevisualisation(identite)}
							</option>
						))}
					</select>
				</label>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{/* LE RENDU EST UN GESTE EXPLICITE (§9.5) : la fonction lit six tables sous RLS, et
				    rendre à chaque changement de sélecteur ferait trois appels pour un seul choix. */}
				<button
					type="button"
					data-testid="lancer-previsualisation"
					disabled={enVol}
					onClick={() => void rendreMaintenant()}
					className="inline-flex items-center gap-2 shrink-0 min-h-[var(--size-target)] px-4 rounded-sm bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-60"
				>
					{enVol
						? t('admin.mailTemplates.previewPane.running')
						: t('admin.mailTemplates.previewPane.run')}
				</button>
				<button
					type="button"
					data-testid="fermer-previsualisation"
					onClick={onFermer}
					className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-ink text-sm font-medium hover:bg-hover"
				>
					{t('admin.mailTemplates.previewPane.close')}
				</button>
			</div>

			<ResultatRendu rendu={rendu} />
		</section>
	)
}

/** Ce que le rendu donne à lire — §9.6, les quatre états et rien de plus. */
function ResultatRendu({ rendu }: { readonly rendu: EtatAsync<RenduModeleEmail | null> | null }) {
	if (rendu === null) {
		return (
			<p data-testid="previsualisation-inactive" className="text-sm text-text-2 max-w-[72ch]">
				{t('admin.mailTemplates.previewPane.idle')}
			</p>
		)
	}
	if (rendu.statut === 'erreur') {
		return (
			<p
				role="alert"
				data-testid="previsualisation-erreur"
				className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
			>
				{t('admin.mailTemplates.previewPane.error')}
			</p>
		)
	}
	if (rendu.statut !== 'pret') return null
	if (rendu.donnees === null) {
		// ZÉRO LIGNE N'EST PAS UNE ERREUR, et les deux causes sont VOLONTAIREMENT confondues : la
		// fonction les confond elle-même, et une phrase qui les distinguerait divulguerait ce que le
		// zéro-ligne cache (§9.6).
		return (
			<p data-testid="previsualisation-vide" className="text-sm text-text-2 max-w-[72ch]">
				{t('admin.mailTemplates.previewPane.empty')}
			</p>
		)
	}
	const nulles = rendu.donnees.variables_nulles
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
				<span className="text-sm text-text-2">
					{t('admin.mailTemplates.previewPane.subject')}
				</span>
				<p data-testid="rendu-objet" className="font-medium">
					{rendu.donnees.subject}
				</p>
				<span className="text-sm text-text-2 mt-2">
					{t('admin.mailTemplates.previewPane.body')}
				</span>
				{/* LE CORPS PRÉSERVE SES RETOURS À LA LIGNE : le sous-système expédie du TEXTE, et un
				    corps reflué mentirait sur ce qui partira (§9.6). */}
				<p data-testid="rendu-corps" className="whitespace-pre-wrap">
					{rendu.donnees.body_text}
				</p>
			</div>

			{/* UNE LISTE VIDE NE REND RIEN : l'absence dit déjà ce qu'un message répéterait (§5.9), et
			    le §1 réserve la couleur à ce qui la mérite. */}
			{nulles.length > 0 && (
				<div
					role="status"
					data-testid="variables-nulles"
					className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
				>
					{/* LE COMPTE EST EN TOUTES LETTRES ET DANS SON PROPRE ÉLÉMENT, et l'accord se fait
					    PAR CLÉ : « les 1 variables » serait faux (§10). */}
					<p data-testid="variables-nulles-compte" className="font-medium">
						{nulles.length === 1
							? t('admin.mailTemplates.previewPane.nulls.one')
							: t('admin.mailTemplates.previewPane.nulls.many', {
									compte: String(nulles.length),
								})}
					</p>
					<ul className="flex flex-wrap gap-2">
						{nulles.map((variable) => (
							<li
								key={variable}
								data-testid="variable-nulle"
								className="px-2 py-1 rounded-sm border border-border text-sm text-text-2 font-mono"
							>
								{`{{${variable}}}`}
							</li>
						))}
					</ul>
					<p className="text-sm text-text-2 max-w-[72ch]">
						{t('admin.mailTemplates.previewPane.nulls.body')}
					</p>
				</div>
			)}
		</div>
	)
}
