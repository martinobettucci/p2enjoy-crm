// @spec CRM-149 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Prompts du connecteur — lire les prompts de l'espace, en ajouter,
//       les modifier, les supprimer avec une confirmation dans le flux
// @spec docs/SPEC-mcp.md §17.2, §17.3 (lecture par tout membre, écriture par l'administrateur ; supprimer détruit), §17.7
//       (l'écran) ; docs/DESIGN_SYSTEM.md §5.104 (la forme de Réglages ▸ Pastilles des mails reprise, l'identifiant en
//       monospace, quatre champs, la confirmation de suppression), §5.103, §5.59 (les commandes éteintes avec leur motif),
//       §5.13, §5.34, §5.8 ; docs/JOURNAL.md décision 930
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la capacité d'administrer, rendue par la base, éteint les commandes ;
//       la RLS de `mcp_prompts` reste seule juge de chaque écriture, et son refus est traduit sous les champs
//
// L'ÉCRAN EST LISIBLE PAR TOUT MEMBRE (§17.3) : on y lit ce que l'assistant lit. Qui n'administre pas l'espace voit les
// commandes, éteintes avec leur motif, jamais masquées (§5.59).

import { Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import {
	ajouterPrompt,
	LONGUEUR_CLE_PROMPT,
	LONGUEUR_DESCRIPTION_PROMPT,
	LONGUEUR_TEXTE_PROMPT,
	LONGUEUR_TITRE_PROMPT,
	lirePrompts,
	modifierPrompt,
	supprimerPrompt,
	type NatureRefusPrompt,
	type PromptConnecteur,
} from '../lib/prompts-connecteur'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { ConfirmationArchivage } from './ConfirmationArchivage'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_ZONE = 'rounded-sm border border-border bg-surface px-3 py-2 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'
const CLASSES_AIDE = 'text-sm text-text-3'
const ID_MOTIF = 'prompts-connecteur-lecture-seule'

const CLES_REFUS: Readonly<Record<NatureRefusPrompt, CleTraduction>> = {
	'cle-prise': 'admin.mcpPrompts.refus.cle',
	forme: 'admin.mcpPrompts.refus.forme',
	forbidden: 'admin.mcpPrompts.refus.forbidden',
	'sans-effet': 'admin.mcpPrompts.refus.sansEffet',
	network: 'admin.mcpPrompts.refus.panne',
	unknown: 'admin.mcpPrompts.refus.panne',
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly prompts: readonly PromptConnecteur[] }

type Ouverture =
	| { readonly type: 'creation' }
	| { readonly type: 'modification'; readonly prompt: PromptConnecteur }
	| { readonly type: 'suppression'; readonly prompt: PromptConnecteur }
	| null

export type ProprietesReglagesPromptsConnecteur = { readonly client?: ClientCrm | null }

export function ReglagesPromptsConnecteur({ client = clientCrm }: ProprietesReglagesPromptsConnecteur = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	// Éteint pendant la lecture de la capacité comme sur un refus ; le motif n'est dit que sur un refus établi (§5.59).
	const eteint = administration === 'refusee' || administration === 'en-lecture'
	const refuse = administration === 'refusee'
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [refusSuppression, setRefusSuppression] = useState<string | null>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert la fiche ou la confirmation (§5.13).
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lirePrompts(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', prompts: lu.donnees })
		})
	}, [client, idWorkspace, tentative])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		const cible = document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`)
		// Une commande disparue entre-temps : le focus va à « Nouveau prompt », toujours présent.
		;(cible ?? document.querySelector<HTMLElement>('[data-retour-focus="nouveau"]'))?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.mcpPrompts.noworkspace')} />
	}

	const fermer = () => {
		setRefusSuppression(null)
		setOuverture(null)
	}
	const relire = () => setTentative((n) => n + 1)
	const enregistre = (titre: string) => {
		setAnnonce(t('admin.mcpPrompts.saved', { titre }))
		fermer()
		relire()
	}
	const prompts = lecture.statut === 'pret' ? lecture.prompts : []

	const supprimer = async (prompt: PromptConnecteur) => {
		setEnCours(prompt.id)
		const issue = await supprimerPrompt(client, prompt.id)
		setEnCours(null)
		if (issue.statut === 'applique') {
			// La ligne va disparaître avec sa commande : le focus va à « Nouveau prompt », toujours présent (§5.13). Défaut
			// trouvé par la preuve au clavier — sans cela, il partait au bouton de la ligne, puis au document.
			retourFocus.current = 'nouveau'
			setAnnonce(t('admin.mcpPrompts.deleted', { titre: prompt.titre }))
			fermer()
			relire()
			return
		}
		const cle = issue.nature === 'network' || issue.nature === 'unknown' ? 'admin.mcpPrompts.refus.suppression' : CLES_REFUS[issue.nature]
		setRefusSuppression(t(cle))
	}

	const commande = (cle: string) => ({
		disabled: eteint,
		'data-retour-focus': cle,
		...(refuse ? { 'aria-describedby': ID_MOTIF } : {}),
	})

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-prompts-connecteur">
			<h2 className="text-h3">{t('admin.mcpPrompts.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.mcpPrompts.intro')}</p>
			{refuse ? <MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule> : null}
			{ouverture?.type === 'creation' ? null : (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variante="primaire"
						data-testid="nouveau-prompt"
						{...commande('nouveau')}
						onClick={() => {
							retourFocus.current = 'nouveau'
							setOuverture({ type: 'creation' })
						}}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.mcpPrompts.new')}
					</Button>
				</div>
			)}
			<p role="status" className="sr-only" data-testid="annonce-prompts">
				{annonce}
			</p>

			{ouverture?.type === 'creation' ? (
				<FichePrompt client={client} idWorkspace={idWorkspace} prompt={null} onFermer={fermer} onEnregistre={enregistre} />
			) : null}

			{lecture.statut === 'chargement' ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.mcpPrompts.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : prompts.length === 0 ? (
				ouverture?.type === 'creation' ? null : (
					<EtatVide titre={t('admin.mcpPrompts.empty.title')} corps={t('admin.mcpPrompts.empty.body')} />
				)
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-prompts">
					{prompts.map((prompt) =>
						ouverture?.type === 'modification' && ouverture.prompt.id === prompt.id ? (
							<li key={prompt.id} className="p-3 border-b border-border last:border-b-0">
								<FichePrompt
									client={client}
									idWorkspace={idWorkspace}
									prompt={prompt}
									onFermer={fermer}
									onEnregistre={enregistre}
								/>
							</li>
						) : (
							<li
								key={prompt.id}
								data-testid="ligne-prompt"
								data-prompt={prompt.cle}
								className="flex flex-col gap-1 px-4 py-3 border-b border-border last:border-b-0"
							>
								<div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-3">
									<span className="flex min-w-0 flex-col gap-1 md:flex-1">
										<span className="font-medium break-words">{prompt.titre}</span>
										{/* L'identifiant est une donnée technique — le nom que l'assistant montre (§2, §5.104). */}
										<code className="font-mono text-sm text-text-2 break-all" data-testid="cle-prompt">
											{prompt.cle}
										</code>
									</span>
									<span className="flex flex-wrap gap-1">
										<Button
											variante="discret"
											taille="compacte"
											{...commande(`modifier-${prompt.id}`)}
											aria-label={t('admin.mcpPrompts.edit.aria', { titre: prompt.titre })}
											onClick={() => {
												retourFocus.current = `modifier-${prompt.id}`
												setOuverture({ type: 'modification', prompt })
											}}
										>
											{t('admin.mcpPrompts.edit')}
										</Button>
										<Button
											variante="discret"
											taille="compacte"
											{...commande(`supprimer-${prompt.id}`)}
											disabled={eteint || enCours === prompt.id}
											aria-label={t('admin.mcpPrompts.delete.aria', { titre: prompt.titre })}
											onClick={() => {
												retourFocus.current = `supprimer-${prompt.id}`
												setRefusSuppression(null)
												setOuverture({ type: 'suppression', prompt })
											}}
										>
											{t('admin.mcpPrompts.delete')}
										</Button>
									</span>
								</div>
								<p className="text-sm text-text-2 break-words" data-testid="description-prompt">
									{prompt.description}
								</p>
								{ouverture?.type === 'suppression' && ouverture.prompt.id === prompt.id ? (
									<ConfirmationArchivage
										question={t('admin.mcpPrompts.delete.confirm', { titre: prompt.titre })}
										corps={t('admin.mcpPrompts.delete.confirm.body')}
										libelleAction={t('admin.mcpPrompts.delete.confirm.action')}
										refus={refusSuppression}
										enCours={enCours === prompt.id}
										fermerParEchap
										onAnnuler={fermer}
										onConfirmer={() => void supprimer(prompt)}
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
 * La fiche d'un prompt, dans le flux (§5.104) : titre, identifiant, description, texte. Un prompt nouveau en tête de liste,
 * un existant à sa place. Les bornes sont des `maxLength` ; la base tranche le reste (§5.34).
 */
function FichePrompt({
	client,
	idWorkspace,
	prompt,
	onFermer,
	onEnregistre,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly prompt: PromptConnecteur | null
	readonly onFermer: () => void
	readonly onEnregistre: (titre: string) => void
}) {
	const id = useId()
	const [titre, setTitre] = useState(prompt?.titre ?? '')
	const [cle, setCle] = useState(prompt?.cle ?? '')
	const [description, setDescription] = useState(prompt?.description ?? '')
	const [texte, setTexte] = useState(prompt?.texte ?? '')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const champTitre = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		champTitre.current?.focus()
	}, [])

	const envoyer = async () => {
		if (enCours) return
		setRefus(null)
		setEnCours(true)
		const saisie = { cle, titre, description, texte }
		const issue =
			prompt === null ? await ajouterPrompt(client, idWorkspace, saisie) : await modifierPrompt(client, prompt.id, saisie)
		setEnCours(false)
		if (issue.statut === 'applique') return onEnregistre(titre.trim())
		setRefus(t(CLES_REFUS[issue.nature]))
		// La saisie est gardée, et le focus revient au premier champ (§5.13).
		champTitre.current?.focus()
	}

	return (
		<form
			data-testid="fiche-prompt"
			aria-label={t(prompt === null ? 'admin.mcpPrompts.form.new' : 'admin.mcpPrompts.form.edit')}
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
				<label htmlFor={`${id}-titre`} className={CLASSES_LIBELLE}>
					{t('admin.mcpPrompts.field.title')}
				</label>
				<input
					id={`${id}-titre`}
					ref={champTitre}
					data-testid="prompt-titre"
					type="text"
					autoComplete="off"
					maxLength={LONGUEUR_TITRE_PROMPT}
					value={titre}
					onChange={(evenement) => setTitre(evenement.target.value)}
					className={CLASSES_CHAMP}
				/>
			</div>
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-cle`} className={CLASSES_LIBELLE}>
					{t('admin.mcpPrompts.field.key')}
				</label>
				<input
					id={`${id}-cle`}
					data-testid="prompt-cle"
					type="text"
					autoComplete="off"
					spellCheck={false}
					autoCapitalize="none"
					maxLength={LONGUEUR_CLE_PROMPT}
					value={cle}
					aria-describedby={`${id}-cle-aide`}
					onChange={(evenement) => setCle(evenement.target.value)}
					className={`${CLASSES_CHAMP} font-mono`}
				/>
				<p id={`${id}-cle-aide`} className={CLASSES_AIDE}>
					{t('admin.mcpPrompts.field.key.help')}
				</p>
			</div>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-description`} className={CLASSES_LIBELLE}>
					{t('admin.mcpPrompts.field.description')}
				</label>
				<textarea
					id={`${id}-description`}
					data-testid="prompt-description"
					rows={2}
					maxLength={LONGUEUR_DESCRIPTION_PROMPT}
					value={description}
					aria-describedby={`${id}-description-aide`}
					onChange={(evenement) => setDescription(evenement.target.value)}
					className={CLASSES_ZONE}
				/>
				<p id={`${id}-description-aide`} className={CLASSES_AIDE}>
					{t('admin.mcpPrompts.field.description.help')}
				</p>
			</div>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-texte`} className={CLASSES_LIBELLE}>
					{t('admin.mcpPrompts.field.body')}
				</label>
				<textarea
					id={`${id}-texte`}
					data-testid="prompt-texte"
					rows={12}
					maxLength={LONGUEUR_TEXTE_PROMPT}
					value={texte}
					aria-describedby={`${id}-texte-aide`}
					onChange={(evenement) => setTexte(evenement.target.value)}
					className={CLASSES_ZONE}
				/>
				<p id={`${id}-texte-aide`} className={CLASSES_AIDE}>
					{t('admin.mcpPrompts.field.body.help')}
				</p>
			</div>
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="refus-prompt"
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{refus}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{/* Jamais éteint par l'état des champs : aucune garde de saisie ne double une contrainte de la base (§5.34). */}
				<Button variante="primaire" type="submit" disabled={enCours} data-testid="prompt-enregistrer">
					{t(enCours ? 'admin.mcpPrompts.pending' : 'admin.mcpPrompts.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="prompt-annuler" onClick={onFermer}>
					{t('admin.mcpPrompts.cancel')}
				</Button>
			</div>
		</form>
	)
}
