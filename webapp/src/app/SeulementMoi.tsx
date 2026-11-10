// @spec CRM-139 (docs/BACKLOG.md) — « Seulement moi » dans l'inbox : la case de l'en-tête des dossiers, son état désactivé
//       qui explique, et le vide de la liste sous le filtre qui porte son action
// @spec docs/DESIGN_SYSTEM.md §5.96 ; §5.7 bis (la case de 24 px, son libellé pour cible étendue), §5.3 quinquies (un vide
//       dû à un filtre porte son geste), §8 (un état désactivé explique pourquoi) ; docs/SPEC-mail-subsystem.md §27.4 ;
//       docs/JOURNAL.md décisions 879 et 902
//
// CE COMPOSANT NE FILTRE RIEN : la base le fait (`concerns_me`, `inbox_arborescence(p_only_me)`). Il rend la case et
// rapporte le geste ; l'adresse garde l'état (`seulement-moi.ts`).

import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { ModeCourrier, PresenceIdentite } from '../lib/seulement-moi'
import { CHEMIN_ADMIN_IDENTITES_MAIL } from './chemins'

/**
 * La case, dans l'en-tête du panneau des dossiers.
 *
 * Elle n'est active qu'avec une identité personnelle. Pendant la lecture des identités, elle est rendue cochée et
 * désactivée, sans texte : rien ne clignote d'un état à l'autre (§5.96). Sans identité, ou sur un échec, elle est
 * décochée et désactivée, et `idAide` désigne l'explication rendue sous l'en-tête.
 */
export function CaseSeulementMoi({
	mode,
	presence,
	onMode,
	idAide,
}: {
	readonly mode: ModeCourrier
	readonly presence: PresenceIdentite
	readonly onMode: (mode: ModeCourrier) => void
	readonly idAide: string
}) {
	const active = presence === 'presente'
	const cochee = active ? mode === 'moi' : presence === 'chargement'
	const explique = presence === 'aucune' || presence === 'erreur'
	return (
		<label
			className={[
				'inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm text-text-2',
				active ? 'cursor-pointer' : 'cursor-not-allowed',
			].join(' ')}
		>
			<input
				type="checkbox"
				data-testid="inbox-seulement-moi"
				checked={cochee}
				disabled={!active}
				onChange={(evenement) => onMode(evenement.target.checked ? 'moi' : 'tous')}
				{...(explique ? { 'aria-describedby': idAide } : {})}
				className="size-6 shrink-0 accent-brand"
			/>
			{t('inbox.mine.label')}
		</label>
	)
}

/**
 * L'explication de la case désactivée, sous l'en-tête : sans identité, le lien qui en ajoute une ; sur un échec,
 * « Réessayer ». Rien pendant la lecture, rien avec une identité.
 */
export function ExplicationSeulementMoi({
	presence,
	idAide,
	onReprise,
}: {
	readonly presence: PresenceIdentite
	readonly idAide: string
	readonly onReprise: () => void
}) {
	if (presence !== 'aucune' && presence !== 'erreur') return null
	return (
		<div
			id={idAide}
			data-testid="inbox-seulement-moi-explication"
			className="flex flex-col items-start gap-1 px-3 py-2 border-b border-border text-sm text-text-2"
		>
			<p className="break-words">{t(presence === 'aucune' ? 'inbox.mine.none' : 'inbox.mine.error')}</p>
			{presence === 'aucune' ? (
				<Link
					to={CHEMIN_ADMIN_IDENTITES_MAIL}
					className="inline-flex min-h-[var(--size-target)] items-center text-brand underline focus-visible:outline-2 focus-visible:outline-brand"
				>
					{t('inbox.mine.none.link')}
				</Link>
			) : (
				<Button variante="discret" taille="compacte" onClick={onReprise}>
					{t('inbox.mine.retry')}
				</Button>
			)}
		</div>
	)
}

/** Le vide de la liste sous le filtre : il porte le geste qui le lève, la case décochée (§5.3 quinquies). */
export function VideSeulementMoi({ onToutAfficher }: { readonly onToutAfficher: () => void }) {
	return (
		<EtatVide
			titre={t('inbox.mine.empty.title')}
			corps={t('inbox.mine.empty.body')}
			action={
				<Button variante="secondaire" taille="compacte" data-testid="inbox-seulement-moi-tout" onClick={onToutAfficher}>
					{t('inbox.mine.empty.action')}
				</Button>
			}
		/>
	)
}
