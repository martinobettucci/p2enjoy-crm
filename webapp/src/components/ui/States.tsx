// @spec CRM-007 (docs/BACKLOG.md) — états vide, erreur et absence de droit
// @spec docs/DESIGN_SYSTEM.md §5.8 (quatre états explicites), §9 (pastille d'icône, Lucide)
// @spec docs/SPEC-webapp.md §7 (états systématiques)
//
// Les trois états partagent une même composition — pastille d'icône, titre, explication,
// action facultative — parce qu'ils répondent à la même question de l'utilisateur : « que
// s'est-il passé, et que puis-je faire ? ». Les distinguer visuellement sans les distinguer
// structurellement produirait trois variantes à maintenir au lieu d'une.
//
// Aucun de ces états n'est une page blanche, et aucun ne se contente d'un code d'erreur.

import type { LucideIcon } from 'lucide-react'
import { FolderOpen, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'

type TonEtat = 'neutre' | 'danger'

const PASTILLES: Readonly<Record<TonEtat, string>> = {
	neutre: 'bg-brand-soft text-brand',
	danger: 'bg-danger-soft text-danger',
}

type ProprietesBloc = {
	readonly icone: LucideIcon
	readonly ton: TonEtat
	readonly titre: string
	readonly corps: string
	readonly action?: ReactNode
	readonly testId: string
}

function BlocEtat({ icone: Icone, ton, titre, corps, action, testId }: ProprietesBloc) {
	return (
		<div
			data-testid={testId}
			className="flex flex-col items-center text-center gap-3 px-4 py-8 max-w-[60ch] mx-auto"
		>
			<span className={['flex items-center justify-center size-12 rounded-md', PASTILLES[ton]].join(' ')}>
				<Icone aria-hidden="true" size={24} strokeWidth={2} />
			</span>
			<h2 className="text-h3">{titre}</h2>
			<p className="text-text-2">{corps}</p>
			{action}
		</div>
	)
}

export type ProprietesEtatVide = {
	readonly titre: string
	readonly corps: string
	readonly action?: ReactNode
}

export function EtatVide({ titre, corps, action }: ProprietesEtatVide) {
	return (
		<BlocEtat
			icone={FolderOpen}
			ton="neutre"
			titre={titre}
			corps={corps}
			testId="etat-vide"
			{...(action === undefined ? {} : { action })}
		/>
	)
}

export type ProprietesEtatErreur = {
	readonly titre: string
	readonly corps: string
	readonly libelleReprise: string
	/** La reprise **relance la requête** ; elle ne recharge pas la page (docs/SPEC-webapp.md §7). */
	readonly onReprise: () => void
}

export function EtatErreur({ titre, corps, libelleReprise, onReprise }: ProprietesEtatErreur) {
	return (
		<BlocEtat
			icone={TriangleAlert}
			ton="danger"
			titre={titre}
			corps={corps}
			testId="etat-erreur"
			action={
				<Button variante="primaire" onClick={onReprise}>
					{libelleReprise}
				</Button>
			}
		/>
	)
}

export type ProprietesEtatRefus = {
	readonly titre: string
	readonly corps: string
}

export function EtatRefus({ titre, corps }: ProprietesEtatRefus) {
	return <BlocEtat icone={ShieldAlert} ton="danger" titre={titre} corps={corps} testId="etat-refus" />
}

export type ProprietesEtatConfiguration = {
	readonly titre: string
	readonly corps: string
	readonly detail: string
}

/**
 * Configuration de build incomplète. Aucune action de reprise n'est proposée : réessayer ne
 * peut rien changer, les variables sont figées au build (docs/SPEC-webapp.md §12.2). Le détail
 * technique est affiché parce qu'il nomme exactement ce qui manque à celui qui déploie — et
 * qu'il ne divulgue aucune valeur, seulement des noms de variables (CLAUDE.md §7).
 */
export function EtatConfiguration({ titre, corps, detail }: ProprietesEtatConfiguration) {
	return (
		<BlocEtat
			icone={TriangleAlert}
			ton="danger"
			titre={titre}
			corps={corps}
			testId="etat-configuration"
			action={<code className="text-text-3">{detail}</code>}
		/>
	)
}
