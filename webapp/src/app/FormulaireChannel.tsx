// @spec CRM-075 (docs/BACKLOG.md) — le formulaire d'un channel : créer et modifier
// @spec docs/SPEC-administration-arborescence.md §7 (les channels), §7.2 (un workflow obligatoire, aucun défaut
//       présélectionné, la liste vide dite), §8 (validation de forme), §9 (les refus)
// @spec CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.5 : sans workflow affectable, le
//       formulaire mène à l'éditeur de workflows
// @spec CRM-100 (docs/BACKLOG.md) tranche T1 — docs/SPEC-administration-arborescence.md §13.2 (le formulaire
//       PARTAGÉ entre l'arborescence et la vue d'un track ; « Nouveau workflow » et le workflow attendu, réservés à
//       la création), §13.4 (le slug confié à l'aller-retour seulement s'il a été saisi) ; docs/DESIGN_SYSTEM.md
//       §5.13, §5.55
//
// LE FORMULAIRE N'EST PAS RECOPIÉ dans la vue d'un track : il quitte `AdministrationArborescence.tsx` pour ce
// module, que les deux écrans importent. Ce qu'il demande, sa validation et ses refus sont ceux du §7, inchangés.

import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	nomConforme,
	proposerSlug,
	slugConforme,
	type WorkflowAffectable,
} from '../lib/administration-arborescence'
import type { SaisiePortee } from '../lib/nouveau-channel'
import { CHEMIN_ADMIN_WORKFLOWS } from './chemins'
import { AlerteRefus, ChampTexte } from './ElementsFormulaireAdmin'

export type SaisieChannel = {
	readonly nom: string
	readonly slug: string
	readonly description: string
	readonly idWorkflow: string
}

export type ProprietesFormulaireChannel = {
	readonly titre: string
	readonly initial: SaisieChannel
	readonly slugModifiable: boolean
	readonly workflows: EtatAsync<readonly WorkflowAffectable[]>
	readonly refus: string | null
	readonly enCours: boolean
	readonly onValider: (saisie: SaisieChannel) => void
	readonly onAnnuler: () => void
	/**
	 * `CRM-100`, §13.2 — l'adresse de l'aller-retour vers l'éditeur, calculée par l'écran hôte à partir de la saisie
	 * COURANTE. Fournie, elle rend « Nouveau workflow » sous le sélecteur dans les quatre états de la liste. Réservée à
	 * la création : la modification n'en fournit pas.
	 */
	readonly cheminNouveauWorkflow?: (saisie: SaisiePortee) => string
	/**
	 * `CRM-100`, §13.2 — le workflow créé pendant l'aller-retour. Présent dans la liste lue, il devient la valeur du
	 * sélecteur ; absent — propre à un autre track —, une ligne le dit.
	 */
	readonly idWorkflowAttendu?: string | null
}

export function FormulaireChannel({
	titre,
	initial,
	slugModifiable,
	workflows,
	refus,
	enCours,
	onValider,
	onAnnuler,
	cheminNouveauWorkflow,
	idWorkflowAttendu = null,
}: ProprietesFormulaireChannel) {
	const prefixe = useId()
	const [saisie, setSaisie] = useState(initial)
	// Un slug revenu de l'aller-retour a été SAISI (§13.4) : la proposition depuis le nom ne doit pas l'écraser. Un
	// slug égal à la proposition est indiscernable d'elle, et équivalent.
	const [slugTouche, setSlugTouche] = useState(initial.slug !== '' && initial.slug !== proposerSlug(initial.nom))
	const premier = useRef<HTMLInputElement>(null)

	useEffect(() => {
		premier.current?.focus()
	}, [])

	// Le workflow attendu est appliqué UNE fois, quand la liste est prête : une liste relue ensuite — après que le
	// workflow de départ a été posé depuis le guide flottant — ne doit pas écraser un choix fait entre-temps.
	const attenduApplique = useRef(false)
	const listePrete = workflows.statut === 'pret' ? workflows.donnees : null
	const attenduAffectable =
		idWorkflowAttendu === null || listePrete === null
			? null
			: listePrete.some((workflow) => workflow.id === idWorkflowAttendu)
	useEffect(() => {
		if (attenduApplique.current || idWorkflowAttendu === null || attenduAffectable === null) return
		attenduApplique.current = true
		if (attenduAffectable) setSaisie((precedente) => ({ ...precedente, idWorkflow: idWorkflowAttendu }))
	}, [attenduAffectable, idWorkflowAttendu])

	const slugMalforme = saisie.slug !== '' && !slugConforme(saisie.slug)
	// Un workflow est OBLIGATOIRE (docs/SPEC-workflow-engine.md §4.12.5). Le bouton reste désactivé
	// tant qu'aucun n'est choisi : ce n'est pas un droit calculé, c'est un champ requis dont
	// l'absence est refusée par la contrainte `NOT NULL`.
	const complet =
		nomConforme(saisie.nom) && saisie.slug !== '' && !slugMalforme && saisie.idWorkflow !== ''

	const aucunWorkflow = workflows.statut === 'pret' && workflows.donnees.length === 0
	// Le slug n'est confié à l'aller-retour que s'il a été saisi : une proposition se recalcule au retour (§13.4).
	const cheminCreationWorkflow =
		cheminNouveauWorkflow === undefined
			? null
			: cheminNouveauWorkflow({
					nom: saisie.nom,
					slug: slugTouche ? saisie.slug : '',
					description: saisie.description,
				})

	return (
		<form
			data-testid="formulaire-channel"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (complet && !enCours) onValider(saisie)
			}}
		>
			<h3 className="text-h3">{titre}</h3>
			<ChampTexte
				id={`${prefixe}-nom`}
				libelle={t('admin.form.name')}
				valeur={saisie.nom}
				refInterne={premier}
				onChange={(nom) =>
					setSaisie((precedente) => ({
						...precedente,
						nom,
						slug: slugModifiable && !slugTouche ? proposerSlug(nom) : precedente.slug,
					}))
				}
			/>
			<ChampTexte
				id={`${prefixe}-slug`}
				libelle={t('admin.form.slug')}
				valeur={saisie.slug}
				desactive={!slugModifiable}
				aide={slugModifiable ? t('admin.form.slug.help') : t('admin.form.slug.locked')}
				{...(slugMalforme ? { erreur: t('admin.form.slug.invalid') } : {})}
				onChange={(slug) => {
					setSlugTouche(true)
					setSaisie((precedente) => ({ ...precedente, slug }))
				}}
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-workflow`} className="text-sm text-text-2">
					{t('admin.form.workflow')}
				</label>
				{workflows.statut === 'chargement' ? (
					<span className="text-sm text-text-3">{t('admin.form.workflow.loading')}</span>
				) : null}
				{workflows.statut === 'erreur' ? (
					<span role="alert" className="text-sm text-danger-on-soft">
						{t('admin.form.workflow.error')}
					</span>
				) : null}
				{aucunWorkflow ? (
					// État vide, et non un contrôle d'accès : il n'y a rien à choisir.
					<p data-testid="admin-sans-workflow" className="flex flex-col gap-1 text-sm text-text-3">
						<span>{t('admin.form.workflow.none')}</span>
						{/* `CRM-094` (docs/SPEC-onboarding.md §10.5) : la phrase dit de créer un workflow ;
						    le chemin y mène. `CRM-100` (§13.2) : en création, par l'aller-retour, qui rend
						    la saisie ; le lien « Nouveau workflow » ci-dessous dit alors la même chose, et
						    celui-ci n'est pas répété. */}
						{cheminCreationWorkflow === null ? (
							<Link to={CHEMIN_ADMIN_WORKFLOWS} className="self-start font-medium text-brand underline">
								{t('admin.form.workflow.none.action')}
							</Link>
						) : null}
					</p>
				) : null}
				{workflows.statut === 'pret' && workflows.donnees.length > 0 ? (
					<select
						id={`${prefixe}-workflow`}
						value={saisie.idWorkflow}
						onChange={(evenement) =>
							setSaisie((precedente) => ({ ...precedente, idWorkflow: evenement.target.value }))
						}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					>
						{/* Aucun défaut n'est présélectionné : « le défaut silencieux transformerait une
						    omission du client en un choix qu'il n'a pas fait » (§4.12.5). */}
						<option value="">{t('admin.form.workflow.choose')}</option>
						{workflows.donnees.map((workflow) => (
							<option key={workflow.id} value={workflow.id}>
								{workflow.is_default
									? t('admin.form.workflow.default', { nom: workflow.name })
									: workflow.name}
							</option>
						))}
					</select>
				) : null}
				{attenduAffectable === false ? (
					// Une information, pas une erreur : rien n'a été refusé (docs/DESIGN_SYSTEM.md §5.55).
					<span data-testid="admin-workflow-non-affectable" className="text-sm text-text-2">
						{t('admin.form.workflow.notAssignable')}
					</span>
				) : null}
				{cheminCreationWorkflow === null ? null : (
					// Un LIEN : il change d'adresse (§12.1). La saisie part avec lui, dans l'adresse (§13.4).
					<Link
						to={cheminCreationWorkflow}
						data-testid="lien-nouveau-workflow"
						className="self-start inline-flex items-center gap-1 min-h-[var(--size-target)] font-medium text-brand underline"
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
						{t('admin.form.workflow.new')}
					</Link>
				)}
			</div>
			<ChampTexte
				id={`${prefixe}-description`}
				libelle={t('admin.form.description')}
				valeur={saisie.description}
				onChange={(description) => setSaisie((precedente) => ({ ...precedente, description }))}
			/>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<Button type="submit" variante="primaire" disabled={!complet || enCours}>
					{slugModifiable ? t('admin.action.create') : t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}
