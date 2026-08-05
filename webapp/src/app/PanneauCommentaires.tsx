// @spec CRM-043 (docs/BACKLOG.md) — panneau de commentaires du détail de card
// @spec docs/SPEC-cards.md §13.10 (ce que le panneau montre), §13.4 (la pierre tombale),
//       §13.5 (la mention « modifié »), §13.6 (le refus vient du backend)
// @spec docs/DESIGN_SYSTEM.md §5.10 (panneau de commentaires), §5.3 (détail de card),
//       §5.8 (états systématiques), §7 (responsive), §8 (accessibilité), §12.3 (libellé masqué)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// LE COMPOSANT NE PORTE AUCUNE RÈGLE. L'ordre du fil, la classification des refus et la règle
// d'abonnement vivent dans `webapp/src/lib/commentaires.ts`, vérifiables sans navigateur. Ici, on
// rend.
//
// LE COMPOSEUR EST TOUJOURS RENDU, et c'est délibéré (`CLAUDE.md` §10) : l'interface ne calcule
// aucun droit d'écriture, elle envoie et traduit le refus du backend. Masquer le bouton pour un
// `viewer` serait une aide d'interface prise pour une autorisation — et il faudrait pour cela
// calculer côté client une règle que seule la base connaît.
//
// AUCUN NOM D'AUTEUR N'EST AFFICHÉ. `profiles` n'est lisible par aucun jeton d'utilisateur
// (INC-014) ; la vue liste a tranché le même cas en ne rendant **pas du tout** la colonne
// « Responsable » plutôt qu'en la rendant vide (docs/DESIGN_SYSTEM.md §12.5). La règle est
// reconduite, et la limite est nommée au §13.10 plutôt que comblée par un identifiant technique.

import { useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import {
	publierCommentaire,
	useFilCommentaires,
	type CommentaireAffiche,
	type NatureRefusPublication,
} from '../lib/commentaires'
import type { ClientCrm } from '../lib/supabase'

/** Traductions des quatre refus, écrites une fois — le composant n'en construit aucune. */
const CLES_REFUS: Readonly<Record<NatureRefusPublication, Parameters<typeof t>[0]>> = {
	forbidden: 'comments.refus.forbidden',
	invalide: 'comments.refus.invalide',
	network: 'comments.refus.network',
	unknown: 'comments.refus.unknown',
}

export type ProprietesPanneauCommentaires = {
	readonly client: ClientCrm | null
	readonly idCard: string
	/**
	 * Le workspace de la card, tel que la route l'a lu.
	 *
	 * Il n'est **pas** décidé ici : le trigger de la migration 15 le remplace par celui de la card
	 * (décision 200). Il traverse le composant parce que le générateur de types, qui ne voit pas
	 * les triggers, déclare la colonne obligatoire à l'insertion.
	 */
	readonly idWorkspace: string
}

export function PanneauCommentaires({ client, idCard, idWorkspace }: ProprietesPanneauCommentaires) {
	const { etat, recharger } = useFilCommentaires(client, idCard)
	const [brouillon, setBrouillon] = useState('')
	const [envoiEnCours, setEnvoiEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusPublication | null>(null)
	const [annonce, setAnnonce] = useState('')

	async function publier(evenement: FormEvent) {
		evenement.preventDefault()
		if (client === null || envoiEnCours) return
		setEnvoiEnCours(true)
		setRefus(null)
		const resultat = await publierCommentaire(client, {
			idCard,
			idWorkspace,
			corps: brouillon,
		})
		setEnvoiEnCours(false)
		if (resultat.statut === 'refus') {
			// LE TEXTE SAISI EST CONSERVÉ (docs/DESIGN_SYSTEM.md §5.10) : le vider ferait perdre à
			// l'utilisateur un texte pour une erreur qui n'est pas la sienne.
			setRefus(resultat.refus.nature)
			return
		}
		setBrouillon('')
		setAnnonce(t('live.comments.published'))
		// Le flux relira de lui-même (décision 201) ; ce rechargement est ce qui rend l'écran juste
		// même lorsque l'abonnement a échoué — auquel cas rien d'autre ne le mettrait à jour.
		recharger()
	}

	return (
		<section aria-label={t('comments.aria')} className="flex flex-col gap-4">
			<h2 className="text-base font-medium text-ink">{t('comments.title')}</h2>

			<LiveRegion libelle={t('live.comments.aria')} message={annonce} />

			<Fil etat={etat} onReprise={recharger} />

			<form onSubmit={publier} className="flex flex-col gap-2">
				<label htmlFor="commentaire-corps" className="sr-only">
					{t('comments.compose.label')}
				</label>
				<textarea
					id="commentaire-corps"
					rows={3}
					value={brouillon}
					onChange={(evenement) => setBrouillon(evenement.target.value)}
					placeholder={t('comments.compose.placeholder')}
					className={[
						'w-full rounded-sm border border-border bg-surface px-3 py-2',
						'text-base text-ink placeholder:text-muted',
						'focus:outline-none focus:ring-2 focus:ring-brand',
					].join(' ')}
				/>
				{refus === null ? null : (
					<p role="alert" className="text-sm text-danger">
						{t(CLES_REFUS[refus])}
					</p>
				)}
				<div className="flex justify-end">
					<Button
						type="submit"
						variante="primaire"
						disabled={brouillon.trim() === '' || envoiEnCours}
					>
						{envoiEnCours ? t('comments.compose.sending') : t('comments.compose.submit')}
					</Button>
				</div>
			</form>
		</section>
	)
}

function Fil({
	etat,
	onReprise,
}: {
	readonly etat: ReturnType<typeof useFilCommentaires>['etat']
	readonly onReprise: () => void
}) {
	// Pendant le chargement, le fil ne montre rien plutôt qu'un « aucun commentaire » prématuré :
	// annoncer l'absence avant d'avoir la réponse serait une valeur par défaut trompeuse
	// (`CLAUDE.md` §18).
	if (etat.statut === 'chargement') return null

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('comments.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={onReprise}
			/>
		)
	}

	if (etat.donnees.length === 0) {
		return <EtatVide titre={t('comments.empty.title')} corps={t('comments.empty.body')} />
	}

	// Ordre CROISSANT — le plus ancien en haut, le composeur en bas (docs/DESIGN_SYSTEM.md §5.10).
	// C'est la projection qui l'établit, jamais ce rendu.
	return (
		<ol className="flex flex-col gap-3">
			{etat.donnees.map((commentaire) => (
				<li key={commentaire.id}>
					<Commentaire commentaire={commentaire} />
				</li>
			))}
		</ol>
	)
}

function Commentaire({ commentaire }: { readonly commentaire: CommentaireAffiche }) {
	return (
		<article className="rounded-sm bg-surface px-3 py-2">
			<p className="text-sm text-muted">
				<time dateTime={commentaire.creeLe}>{formaterDate(commentaire.creeLe)}</time>
				{commentaire.modifieLe === null ? null : (
					<span
						className="before:content-['·'] before:mx-1"
						title={`${t('comments.edited.title')} ${formaterDate(commentaire.modifieLe)}`}
					>
						{t('comments.edited')}
					</span>
				)}
			</p>
			{commentaire.supprime ? (
				// Il n'y a rien d'autre à afficher : la base ne porte plus de corps
				// (docs/SPEC-cards.md §13.4). La place est TENUE — masquer la ligne ferait
				// disparaître un tour de parole d'une conversation.
				<p className="text-base italic text-muted">{t('comments.deleted')}</p>
			) : (
				// `whitespace-pre-wrap` : le corps est du markdown STOCKÉ, rendu en TEXTE BRUT.
				// L'interpréter sans politique d'assainissement ouvrirait une injection, et aucune
				// unité ne porte cette politique (docs/SPEC-cards.md §13.13).
				<p className="whitespace-pre-wrap break-words text-base text-ink">{commentaire.corps}</p>
			)}
		</article>
	)
}

/**
 * Date absolue, en français, sans bibliothèque.
 *
 * Une date relative — « il y a 3 heures » — exigerait de se rafraîchir pour ne pas mentir, et
 * `docs/DESIGN_SYSTEM.md` §5.10 demande une date absolue. Une valeur illisible n'est pas remplacée
 * par une date inventée : elle est rendue telle quelle, ce qui se voit.
 */
function formaterDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}
