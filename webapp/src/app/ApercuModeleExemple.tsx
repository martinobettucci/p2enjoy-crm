// @spec CRM-125 (docs/BACKLOG.md) T3 — l'aperçu des paliers d'une séquence sur le jeu d'exemple : le rendu partagé par
//       modèle, le bloc d'aperçu, la mention « données d'exemple », l'aperçu de la séquence entière
// @spec docs/SPEC-modeles-emails.md §14.5 (l'écran), §14.4 (l'identité fictive dite), §9.6 (le corps garde ses retours
//       à la ligne), §10 (la signature après `-- `) ; docs/DESIGN_SYSTEM.md §5.41 (révision `CRM-125`), §5.8 (états)
//
// LE RENDU EST UN GESTE EXPLICITE (§14.5) : rien n'est demandé avant un clic, et un modèle n'est rendu qu'une fois —
// deux paliers du même modèle partagent le même aperçu. « Réessayer » est le seul chemin qui redemande.

import { useCallback, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { rendreApercuExemple, type ApercuExemple } from '../lib/modeles-emails'
import { delaisCumules, type PalierSequence } from '../lib/sequences-relance'
import type { ClientCrm } from '../lib/supabase'

export type EtatApercu = EtatAsync<ApercuExemple | null>

/** Les aperçus déjà demandés, par modèle, et le geste qui en demande un. */
export function useApercusExemple(client: ClientCrm) {
	const [apercus, setApercus] = useState<ReadonlyMap<string, EtatApercu>>(new Map())
	const demandes = useRef(new Set<string>())

	const demander = useCallback(
		(idModele: string, forcer = false) => {
			if (demandes.current.has(idModele) && !forcer) return
			demandes.current.add(idModele)
			setApercus((avant) => new Map(avant).set(idModele, enChargement()))
			void (async () => {
				const rendu = await rendreApercuExemple(client, idModele)
				setApercus((avant) => new Map(avant).set(idModele, rendu))
			})()
		},
		[client],
	)

	return { apercus, demander }
}

/** Vrai dès qu'un aperçu rendu dit que l'expéditeur est fictif (§14.4) : la règle vaut pour la personne, pas le modèle. */
export function identiteFictive(apercus: ReadonlyMap<string, EtatApercu>): boolean {
	for (const etat of apercus.values()) {
		if (etat.statut === 'pret' && etat.donnees !== null && etat.donnees.identity_is_sample) return true
	}
	return false
}

export function ApercuModeleExemple({
	etat,
	onReprise,
	testId,
}: {
	readonly etat: EtatApercu | undefined
	readonly onReprise: () => void
	readonly testId: string
}) {
	if (etat === undefined || etat.statut === 'chargement') {
		return <SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
	}
	if (etat.statut === 'erreur') {
		return (
			<div role="alert" data-testid={`${testId}-erreur`} className="flex flex-wrap items-center gap-2 text-sm text-danger">
				<span>{t('admin.sequences.preview.error')}</span>
				<Button variante="secondaire" onClick={onReprise}>
					{t('admin.sequences.preview.retry')}
				</Button>
			</div>
		)
	}
	if (etat.donnees === null) {
		return (
			<p data-testid={`${testId}-illisible`} className="text-sm text-text-2">
				{t('admin.sequences.preview.unreadable')}
			</p>
		)
	}
	const apercu = etat.donnees
	return (
		<div data-testid={testId} className="flex flex-col gap-1 min-w-0 rounded-lg border border-border bg-surface p-3">
			<span className="text-sm text-text-2">{t('admin.mailTemplates.previewPane.subject')}</span>
			<p data-testid={`${testId}-objet`} className="font-medium break-words">
				{apercu.subject}
			</p>
			<span className="text-sm text-text-2 mt-2">{t('admin.mailTemplates.previewPane.body')}</span>
			{/* LE CORPS PRÉSERVE SES RETOURS À LA LIGNE (§9.6), et la signature suit après le séparateur `-- ` que
			    l'expédition pose (§10) : l'aperçu montre le message tel qu'il partira. */}
			<p data-testid={`${testId}-corps`} className="whitespace-pre-wrap break-words">
				{apercu.body_text}
				{apercu.signature_text !== null && `\n\n-- \n${apercu.signature_text}`}
			</p>
		</div>
	)
}

/** La mention permanente au-dessus de tout aperçu : un aperçu ne se lit jamais comme un vrai message (§14.5). */
export function MentionDonneesExemple({ fictive }: { readonly fictive: boolean }) {
	return (
		<div role="note" data-testid="mention-donnees-exemple" className="flex flex-col gap-1 text-sm text-text-2 max-w-[72ch]">
			<p>{t('admin.sequences.preview.notice')}</p>
			{fictive && <p data-testid="mention-identite-fictive">{t('admin.sequences.preview.identitySample')}</p>}
		</div>
	)
}

/** L'aperçu de toute la séquence : chaque palier dans l'ordre, titré par son rang et ses deux délais (§14.5). */
export function ApercuSequence({
	paliers,
	apercus,
	onReprise,
	onFermer,
}: {
	readonly paliers: readonly PalierSequence[]
	readonly apercus: ReadonlyMap<string, EtatApercu>
	readonly onReprise: (idModele: string) => void
	readonly onFermer: () => void
}) {
	const cumuls = delaisCumules(paliers)
	return (
		<section
			data-testid="apercu-sequence"
			aria-label={t('admin.sequences.preview.title')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
		>
			<h4 className="font-medium">{t('admin.sequences.preview.title')}</h4>
			<MentionDonneesExemple fictive={identiteFictive(apercus)} />
			<ol className="flex flex-col gap-3">
				{paliers.map((palier) => (
					<li key={palier.id} data-testid="apercu-sequence-palier" className="flex flex-col gap-2 min-w-0">
						<p data-testid="apercu-sequence-titre" className="text-sm font-medium tabular-nums">
							{t('admin.sequences.preview.stepTitle', {
								rang: String(palier.position),
								delai: String(palier.delai_jours),
								cumul: String(cumuls.get(palier.id) ?? palier.delai_jours),
							})}
						</p>
						<ApercuModeleExemple
							etat={apercus.get(palier.template_id)}
							onReprise={() => onReprise(palier.template_id)}
							testId="apercu-sequence-rendu"
						/>
					</li>
				))}
			</ol>
			<div>
				<Button variante="secondaire" data-testid="fermer-apercu-sequence" onClick={onFermer}>
					{t('admin.sequences.preview.close')}
				</Button>
			</div>
		</section>
	)
}
