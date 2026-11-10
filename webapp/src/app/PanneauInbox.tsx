// @spec CRM-057 (docs/BACKLOG.md) — l'enveloppe des panneaux de l'inbox et l'échec d'un chargement, partagés par les
//       panneaux des messages, des mails préparés (CRM-128) et de l'outbox (CRM-144 T3) ; docs/DESIGN_SYSTEM.md §5.4, §5.8,
//       §5.98 ; docs/SPEC-mail-subsystem.md §18.3
//
// SORTIS DE `RouteInbox.tsx` À L'IDENTIQUE par `CRM-144` T3 : l'outbox vit dans son propre module, qui ne peut pas importer la
// route sans dépendance circulaire.

import { EtatErreur, EtatRefus } from '../components/ui/States'
import { t } from '../i18n'

/**
 * Enveloppe commune aux trois panneaux.
 *
 * `aria-labelledby` relie chaque région à son propre titre : trois régions anonymes seraient
 * indistinguables à la navigation par régions (docs/DESIGN_SYSTEM.md §10).
 */
export function Panneau({
	id,
	titre,
	visible,
	classe,
	entete,
	children,
}: {
	readonly id: string
	readonly titre: string
	readonly visible: boolean
	readonly classe: string
	readonly entete?: React.ReactNode
	readonly children: React.ReactNode
}) {
	return (
		<section
			aria-labelledby={`${id}-titre`}
			data-testid={`inbox-panneau-${id}`}
			className={[visible ? 'flex' : 'hidden', 'lg:flex flex-col min-h-0', classe].join(' ')}
		>
			<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
				<h2 id={`${id}-titre`} className="text-sm font-medium text-text-2 uppercase tracking-wide">
					{titre}
				</h2>
				{entete}
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
		</section>
	)
}

/**
 * L'échec d'un chargement, présenté selon ce qu'il EST.
 *
 * UN REFUS N'EST PAS UNE PANNE, et lui offrir « Réessayer » serait promettre qu'un second essai
 * pourrait changer la réponse : le backend a répondu, et il a dit non. C'est le cas d'un visiteur
 * anonyme qui arrive sur cette adresse — la messagerie n'est pas publique, et l'écran le dit au
 * lieu d'afficher une erreur de chargement (docs/DESIGN_SYSTEM.md §5.8).
 */
export function EchecChargement({
	erreur,
	onReprise,
}: {
	readonly erreur: { readonly nature: string }
	readonly onReprise: () => void
}) {
	if (erreur.nature === 'forbidden') {
		return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
	}
	return (
		<EtatErreur
			titre={t('inbox.error.title')}
			corps={t('state.error.unknown')}
			libelleReprise={t('state.error.retry')}
			onReprise={onReprise}
		/>
	)
}
