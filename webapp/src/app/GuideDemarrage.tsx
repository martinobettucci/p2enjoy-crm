// @spec CRM-079 (docs/BACKLOG.md) — guide de démarrage : l'écran
// @spec docs/SPEC-onboarding.md §4 (où le guide vit), §5 (interruption et reprise),
//       §6 (états, et il y en a cinq), §7 (accessibilité et clavier)
// @spec docs/DESIGN_SYSTEM.md §5.17 (de quoi l'écran a l'air), §5.8 (états), §8, §9
//
// L'écran LIT et RENVOIE. Il n'écrit rien, ne crée ni track, ni channel, ni affaire : chaque étape
// pointe vers l'écran réellement livré qui l'accomplit (docs/SPEC-onboarding.md §1.2).
//
// Il n'interroge AUCUN rôle et n'éteint AUCUN lien. Les écrans visés portent déjà leurs propres
// refus, mesurés et prouvés par leurs unités ; un lien éteint d'après un rôle lu côté client ferait
// passer une règle de base pour une décision d'interface (`CLAUDE.md` §10, §6.3 de la spécification).

import { Circle, CircleCheck, CircleHelp } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { EtatVide } from '../components/ui/States'
import {
	compterAccomplies,
	estAccomplie,
	mesureEnCours,
	resteUneEtape,
	useDemarrage,
	type CleEtapeDemarrage,
	type EtapeDemarrage,
	type ProgressionDemarrage,
} from '../lib/demarrage'
import { clientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_ARBORESCENCE, CHEMIN_DEMARRAGE, CHEMIN_ETAT_MESSAGERIE } from './chemins'
import { useMasqueDemarrage } from './preferences'

/**
 * Ce que chaque étape dit et où elle mène. Une table, et non cinq blocs de JSX : les cinq lignes
 * partagent exactement la même composition, et les distinguer structurellement produirait cinq
 * variantes à maintenir au lieu d'une.
 *
 * `destination` absente pour la première étape : elle est accomplie par la connexion elle-même, et
 * un lien vers l'écran courant serait une commande morte (docs/SPEC-onboarding.md §3).
 */
type DescriptionEtape = {
	readonly cle: CleEtapeDemarrage
	readonly cleTitre: CleTraduction
	readonly cleCorps: CleTraduction
	readonly destination?: string
	readonly cleAction?: CleTraduction
}

export const ETAPES_DEMARRAGE: readonly DescriptionEtape[] = [
	{
		cle: 'espace',
		cleTitre: 'onboarding.step.espace.title',
		cleCorps: 'onboarding.step.espace.body',
	},
	{
		cle: 'track',
		cleTitre: 'onboarding.step.track.title',
		cleCorps: 'onboarding.step.track.body',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.track.action',
	},
	{
		cle: 'channel',
		cleTitre: 'onboarding.step.channel.title',
		cleCorps: 'onboarding.step.channel.body',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.channel.action',
	},
	{
		cle: 'affaire',
		cleTitre: 'onboarding.step.affaire.title',
		cleCorps: 'onboarding.step.affaire.body',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.affaire.action',
	},
	{
		cle: 'messagerie',
		cleTitre: 'onboarding.step.messagerie.title',
		cleCorps: 'onboarding.step.messagerie.body',
		destination: CHEMIN_ETAT_MESSAGERIE,
		cleAction: 'onboarding.step.messagerie.action',
	},
]

export type ProprietesVueGuideDemarrage = {
	readonly progression: ProgressionDemarrage
	readonly recharger: () => void
	/**
	 * Commande de masquage — rendue uniquement là où le masquage a un sens, c'est-à-dire sur `/`.
	 * `/demarrage` ignore la préférence et ne propose donc pas de la poser (§4.1, §5).
	 */
	readonly onMasquer?: () => void
}

/**
 * Le rendu, sans mesure : les deux surfaces du §4 mesurent chacune UNE fois et rendent cette vue.
 * Mesurer ici obligerait l'accueil à compter deux fois pour décider puis afficher.
 */
export function VueGuideDemarrage({ progression, recharger, onMasquer }: ProprietesVueGuideDemarrage) {
	const { accomplies, total } = compterAccomplies(progression)

	return (
		<section
			data-testid="guide-demarrage"
			aria-labelledby="titre-guide-demarrage"
			className="flex flex-col gap-4 max-w-[70ch]"
		>
			<header className="flex flex-col gap-2">
				<h2 id="titre-guide-demarrage" className="text-h3">
					{t('onboarding.title')}
				</h2>
				<p className="text-text-2">{t('onboarding.intro')}</p>
				<Progression accomplies={accomplies} total={total} progression={progression} />
			</header>

			<ol className="flex flex-col rounded-lg border border-border bg-surface">
				{ETAPES_DEMARRAGE.map((description, rang) => (
					<LigneEtape
						key={description.cle}
						description={description}
						etat={progression.etapes[rang] ?? { statut: 'chargement' }}
						onReprise={recharger}
					/>
				))}
			</ol>

			{onMasquer === undefined ? null : (
				<div className="flex flex-col gap-1">
					<Button variante="secondaire" onClick={onMasquer} data-testid="masquer-guide">
						{t('onboarding.hide')}
					</Button>
					<p className="text-sm text-text-3">{t('onboarding.hide.help')}</p>
				</div>
			)}
		</section>
	)
}

/**
 * La progression s'écrit EN TOUTES LETTRES, et la barre qui l'accompagne est décorative
 * (docs/DESIGN_SYSTEM.md §5.17). Une barre seule ne se lit ni à la voix, ni en cas de daltonisme.
 *
 * Tant qu'une mesure est en vol, aucun chiffre n'est écrit : « 0 étape sur 5 » serait faux, et
 * l'annoncer puis le corriger ferait sauter le compte sous les yeux de l'utilisateur.
 */
function Progression({
	accomplies,
	total,
	progression,
}: {
	readonly accomplies: number
	readonly total: number
	readonly progression: ProgressionDemarrage
}) {
	const enCours = progression.etapes.some((etat) => etat.statut === 'chargement')
	if (enCours) {
		return (
			<p data-testid="progression-demarrage" className="text-sm text-text-2">
				{t('onboarding.progress.loading')}
			</p>
		)
	}
	const largeur = total === 0 ? 0 : Math.round((accomplies / total) * 100)
	return (
		<div className="flex flex-col gap-1">
			<p data-testid="progression-demarrage" className="text-sm text-text-2">
				{t('onboarding.progress', { faites: String(accomplies), total: String(total) })}
			</p>
			<span aria-hidden="true" className="block h-1 rounded-sm bg-hover">
				<span className="block h-1 rounded-sm bg-brand" style={{ width: `${largeur}%` }} />
			</span>
		</div>
	)
}

/**
 * Une ligne, trois états (docs/SPEC-onboarding.md §6.2), et un mot dans chacun : l'icône double le
 * texte, elle ne le remplace pas (docs/DESIGN_SYSTEM.md §1, §9).
 *
 * Une étape accomplie GARDE son lien : on ajoute un second track après le premier.
 */
function LigneEtape({
	description,
	etat,
	onReprise,
}: {
	readonly description: DescriptionEtape
	readonly etat: EtatAsync<EtapeDemarrage>
	readonly onReprise: () => void
}) {
	return (
		<li
			data-testid={`etape-${description.cle}`}
			className="flex flex-col gap-2 px-4 py-3 border-b border-border last:border-b-0"
		>
			<div className="flex items-start gap-3">
				<MarqueurEtat etat={etat} />
				<div className="flex flex-col gap-1 min-w-0">
					<span className="font-medium">{t(description.cleTitre)}</span>
					<span className="text-sm text-text-2">{t(description.cleCorps)}</span>
					<StatutEtape etat={etat} onReprise={onReprise} />
				</div>
			</div>
			{description.destination === undefined || description.cleAction === undefined ? null : (
				<Link
					to={description.destination}
					data-testid={`lien-${description.cle}`}
					className={[
						'inline-flex items-center self-start',
						'min-h-[var(--size-target)] px-4 rounded-sm',
						'bg-surface text-ink border border-border font-medium',
						'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
					].join(' ')}
				>
					{t(description.cleAction)}
				</Link>
			)}
		</li>
	)
}

function MarqueurEtat({ etat }: { readonly etat: EtatAsync<EtapeDemarrage> }) {
	if (etat.statut === 'erreur') {
		return <CircleHelp aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-text-3" />
	}
	if (estAccomplie(etat)) {
		return <CircleCheck aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-success" />
	}
	return <Circle aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-text-3" />
}

/**
 * Le mot qui porte l'état, et lui seul décide.
 *
 * Un refus n'offre AUCUNE reprise : il est définitif tant que la session ne change pas. Une panne
 * en offre une, qui relance réellement les cinq mesures (docs/SPEC-onboarding.md §6.1).
 */
function StatutEtape({
	etat,
	onReprise,
}: {
	readonly etat: EtatAsync<EtapeDemarrage>
	readonly onReprise: () => void
}) {
	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={1} libelle={t('onboarding.step.loading')} className="max-w-[24ch]" />
	}
	if (etat.statut === 'erreur') {
		return (
			<span className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-text-3">{t('onboarding.step.unmeasured')}</span>
				{etat.erreur.nature === 'forbidden' ? null : (
					<Button variante="discret" taille="compacte" onClick={onReprise}>
						{t('state.error.retry')}
					</Button>
				)}
			</span>
		)
	}
	// « Fait » emprunte la teinte de succès du §1 ; « à faire » reste en texte secondaire. La
	// couleur ne porte rien seule — le mot la double —, mais deux états écrits de la même encre
	// obligeraient à lire chaque ligne pour distinguer ce qui reste.
	return estAccomplie(etat) ? (
		<span className="text-sm font-medium text-success">{t('onboarding.step.done')}</span>
	) : (
		<span className="text-sm text-text-2">{t('onboarding.step.todo')}</span>
	)
}

// ---------------------------------------------------------------------------------------------
// Les deux surfaces du §4, et elles ne rendent pas la même chose
// ---------------------------------------------------------------------------------------------

/**
 * `/demarrage` — le guide, TOUJOURS (docs/SPEC-onboarding.md §4.1).
 *
 * Même intégralement accompli, même masqué pour la session : c'est ce qui le rend **relançable**.
 * Il n'offre donc pas la commande de masquage — la poser depuis l'écran qui l'ignore n'aurait
 * aucun effet observable, et une commande sans effet est une commande morte.
 */
export function GuideDemarrage() {
	const { progression, recharger } = useDemarrage(clientCrm)
	return <VueGuideDemarrage progression={progression} recharger={recharger} />
}

/**
 * `/` — l'accueil, et sa décision (docs/SPEC-onboarding.md §4.2).
 *
 * Quatre cas, et l'ordre compte. Le chargement passe AVANT tout : rendre l'état vide pendant que
 * les mesures sont en vol ferait clignoter l'écran d'arrivée et afficherait « aucun board » à qui
 * en a. Une seule mesure sert la décision et le rendu.
 */
export function AccueilDemarrage() {
	const { progression, recharger } = useDemarrage(clientCrm)
	const { masque, masquer } = useMasqueDemarrage()

	if (mesureEnCours(progression)) {
		return <VueGuideDemarrage progression={progression} recharger={recharger} />
	}
	if (resteUneEtape(progression) && !masque) {
		return <VueGuideDemarrage progression={progression} recharger={recharger} onMasquer={masquer} />
	}
	return (
		<EtatVide
			titre={t('route.board.empty.title')}
			corps={t('route.board.empty.body')}
			action={
				resteUneEtape(progression) ? (
					// Masqué ne veut pas dire perdu : le lien discret est le chemin de retour promis
					// par la phrase d'aide du bouton de masquage (§5).
					<Link
						to={CHEMIN_DEMARRAGE}
						data-testid="rouvrir-guide"
						className={[
							'inline-flex items-center justify-center',
							'min-h-[var(--size-target)] px-4 rounded-sm',
							'bg-surface text-ink border border-border font-medium',
							'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
						].join(' ')}
					>
						{t('onboarding.reopen')}
					</Link>
				) : undefined
			}
		/>
	)
}
