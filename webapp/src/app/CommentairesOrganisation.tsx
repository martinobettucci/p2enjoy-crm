// @spec CRM-153 (docs/BACKLOG.md) — tranche T3 : le bloc « Commentaires » de la fiche d'une organisation — le fil dans
//       l'ordre croissant, le composeur en bas, le sélecteur de mentions, « Modifier » et « Supprimer » pour l'auteur,
//       « Supprimer » pour l'administrateur sur le commentaire d'un tiers, les pierres tombales ; l'ancre
//       `#commentaire-{id}` d'une notification, qui donne le focus au commentaire visé
// @spec docs/SPEC-organisations.md §9.2 (le fil « comme celui d'une affaire » ; commente qui peut modifier
//       l'organisation ; aucun temps réel : la fiche relit après chaque geste), §9.3 (la fiche) ; docs/DESIGN_SYSTEM.md
//       §5.107 (« le panneau du §5.10 tel quel », le §5.44, l'écart : le composeur suit la capacité d'éditer), §5.10,
//       §5.44, §5.59, §5.8
// @spec CLAUDE.md §10 — comparer l'auteur à la session et lire le rôle ne sert qu'à ne pas offrir une commande morte : la
//       RLS et les déclencheurs de `organization_comments` restent seuls juges, et leurs refus sont traduits
//
// LE COMMENTAIRE ET LE SÉLECTEUR SONT CEUX DU FIL D'UNE AFFAIRE (`CommentaireFil.tsx`), réemployés sans changer leur forme.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { proprietesCommande, type Capacite } from '../lib/capacites'
import type { CommentaireAffiche, NatureRefusPublication, ResultatGeste } from '../lib/commentaires'
import {
	lireCommentairesOrganisation,
	lireMentionnablesOrganisation,
	modifierCommentaireOrganisation,
	poserMentionsOrganisation,
	publierCommentaireOrganisation,
	supprimerCommentaireOrganisation,
} from '../lib/commentaires-organisation'
import { resumerPublication, type IssueMention, type NatureRefusMention, type PersonneMentionnable } from '../lib/mentions'
import type { ClientCrm } from '../lib/supabase'
import { Commentaire, SelecteurMentions, ancreCommentaire, natureDe } from './CommentaireFil'

/** Les refus d'une publication ou d'un geste d'auteur — ceux du fil d'une affaire, l'objet nommé « organisation ». */
const CLES_REFUS: Readonly<Record<NatureRefusPublication, CleTraduction>> = {
	forbidden: 'organization.comments.refus.forbidden',
	invalide: 'comments.refus.invalide',
	supprime: 'comments.refus.supprime',
	moderation: 'comments.refus.moderation',
	network: 'comments.refus.network',
	unknown: 'comments.refus.unknown',
}

const CLES_REFUS_MENTION: Readonly<Record<NatureRefusMention, CleTraduction>> = {
	'destinataire-sans-acces': 'organization.comments.mentions.refus.destinataire',
	'commentaire-supprime': 'comments.mentions.refus.commentaire-supprime',
	'commentaire-introuvable': 'comments.mentions.refus.commentaire-introuvable',
	forbidden: 'comments.mentions.refus.forbidden',
	network: 'comments.mentions.refus.network',
	unknown: 'comments.mentions.refus.unknown',
}

/** Une liste de mentions vide nomme l'espace, et non une affaire (§5.44). Constante : le contrôle des clés lit les apostrophes. */
const CLE_MENTIONS_VIDE: CleTraduction = 'organization.comments.mentions.empty'

export type ProprietesCommentairesOrganisation = {
	readonly client: ClientCrm
	readonly idOrganisation: string
	readonly idWorkspace: string | null
	/** La session : elle ne sert qu'à n'offrir à l'auteur que ses gestes (§5.10), jamais à décider un droit. */
	readonly idUtilisateur: string | null
	/** L'appelant administre l'espace : il reçoit, sur le commentaire d'un tiers, le seul geste de modération. */
	readonly estAdmin: boolean
	/** La capacité d'éditer l'espace (§5.59) : commenter est une écriture de l'organisation (§9.2). */
	readonly edition: Capacite
	/** Le motif de la fiche, cité par le composeur et les gestes refusés. */
	readonly idMotif: string
}

export function BlocCommentairesOrganisation({
	client,
	idOrganisation,
	idWorkspace,
	idUtilisateur,
	estAdmin,
	edition,
	idMotif,
}: ProprietesCommentairesOrganisation) {
	const droit = proprietesCommande(edition, idMotif)
	const [fil, setFil] = useState<EtatAsync<readonly CommentaireAffiche[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [brouillon, setBrouillon] = useState('')
	const [envoiEnCours, setEnvoiEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusPublication | null>(null)
	const [sansEffet, setSansEffet] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const zone = useRef<HTMLTextAreaElement>(null)
	const [selecteurOuvert, setSelecteurOuvert] = useState(false)
	const [mentionnables, setMentionnables] = useState<EtatAsync<readonly PersonneMentionnable[]> | null>(null)
	const [tentativeListe, setTentativeListe] = useState(0)
	const [choisies, setChoisies] = useState<ReadonlySet<string>>(() => new Set())
	const [mentionsRefusees, setMentionsRefusees] = useState<readonly IssueMention[]>([])
	const rang = useRef(0)
	const { hash } = useLocation()
	const ancreAtteinte = useRef<string | null>(null)

	// LE FIL EST RELU APRÈS CHAQUE GESTE (§9.2 : aucun temps réel). Une relecture garde le fil à l'écran ; le squelette
	// est réservé au premier chargement (§5.29 tranche 2 c).
	useEffect(() => {
		const r = ++rang.current
		void lireCommentairesOrganisation(client, idOrganisation).then((lu) => {
			if (r === rang.current) setFil(lu)
		})
	}, [client, idOrganisation, tentative])
	const relire = () => setTentative((n) => n + 1)

	// L'ANCRE D'UNE NOTIFICATION : le commentaire visé reçoit le focus, une seule fois par adresse (§5.107, §5.7 quater).
	useEffect(() => {
		if (fil.statut !== 'pret' || !hash.startsWith('#commentaire-') || ancreAtteinte.current === hash) return
		const cible = document.getElementById(decodeURIComponent(hash.slice(1)))
		if (cible === null) return
		ancreAtteinte.current = hash
		const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
		cible.scrollIntoView?.({ block: 'center', behavior: reduit ? 'auto' : 'smooth' })
		cible.focus({ preventScroll: true })
	}, [fil, hash])

	// LA LISTE DES MENTIONNABLES N'EST LUE QU'À LA PREMIÈRE OUVERTURE (§5.44), et relue sur reprise.
	useEffect(() => {
		if (!selecteurOuvert || idWorkspace === null) return
		if (mentionnables !== null && tentativeListe === 0) return
		let vivant = true
		setMentionnables(enChargement())
		void lireMentionnablesOrganisation(client, idWorkspace, idUtilisateur).then((lu) => {
			if (vivant) setMentionnables(lu)
		})
		return () => {
			vivant = false
		}
		// `mentionnables` est hors des dépendances : l'effet l'écrit (même règle que le fil d'une affaire).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idWorkspace, idUtilisateur, selecteurOuvert, tentativeListe])

	async function publier(evenement: FormEvent) {
		evenement.preventDefault()
		if (envoiEnCours || idWorkspace === null) return
		setEnvoiEnCours(true)
		setRefus(null)
		setSansEffet(false)
		setMentionsRefusees([])
		const resultat = await publierCommentaireOrganisation(client, idOrganisation, brouillon)
		if (resultat.statut === 'refus') {
			setEnvoiEnCours(false)
			// Le texte saisi est conservé, et le sélecteur garde ses choix : aucune mention n'a été tentée (§5.10, §5.44).
			setRefus(resultat.refus.nature)
			return
		}
		const aMentionner = mentionnables?.statut === 'pret' ? mentionnables.donnees.filter((p) => choisies.has(p.id)) : []
		const issues =
			resultat.idCommentaire === null || aMentionner.length === 0
				? []
				: await poserMentionsOrganisation(client, resultat.idCommentaire, idWorkspace, aMentionner)
		setEnvoiEnCours(false)
		const bilan = resumerPublication(issues)
		if (bilan.statut === 'partiel') {
			// Le commentaire publié n'est jamais retiré ; le sélecteur ne garde que les refusées (§5.44).
			setMentionsRefusees(bilan.refusees)
			setChoisies(new Set(bilan.refusees.map((issue) => issue.personne.id)))
		} else {
			setChoisies(new Set())
		}
		setBrouillon('')
		setAnnonce(t('live.comments.published'))
		// Le focus retourne dans le champ : « Publier », vidé, s'éteint et le perdrait (décision 315).
		zone.current?.focus()
		relire()
	}

	/** Un geste d'auteur : trois issues, jamais confondues — appliqué, refusé, ou sans effet (le `USING` a filtré). */
	async function appliquer(geste: () => Promise<ResultatGeste>, cleAnnonce: CleTraduction): Promise<boolean> {
		setRefus(null)
		setSansEffet(false)
		const resultat = await geste()
		if (resultat.statut === 'refus') {
			setRefus(resultat.refus.nature)
			return false
		}
		if (resultat.statut === 'sans-effet') {
			setSansEffet(true)
			relire()
			return false
		}
		setAnnonce(t(cleAnnonce))
		relire()
		return true
	}

	const commentaires = fil.statut === 'pret' ? fil.donnees : []

	return (
		<section aria-labelledby="titre-commentaires-organisation" className="flex flex-col gap-3" data-testid="commentaires-organisation">
			<h2 id="titre-commentaires-organisation" className="text-h3">
				{t('organization.comments.title')}
			</h2>
			<LiveRegion libelle={t('live.comments.aria')} message={annonce} />

			{/* Le refus de la base est lu par chaque commande du bloc : celles des commentaires comme le composeur (§5.59). */}
			<FournisseurRefus valeur={droit}>
				{fil.statut === 'chargement' ? (
					<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
				) : fil.statut === 'erreur' ? (
					<EtatErreur
						titre={t('organization.comments.error')}
						corps={t(fil.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
						libelleReprise={t('state.error.retry')}
						onReprise={relire}
					/>
				) : commentaires.length === 0 ? (
					<p className="text-sm text-text-2" data-testid="commentaires-organisation-vide">
						{t('organization.comments.empty')}
					</p>
				) : (
					<ol className="flex flex-col gap-2" data-testid="fil-commentaires-organisation">
						{commentaires.map((commentaire) => (
							<li key={commentaire.id}>
								<Commentaire
									commentaire={commentaire}
									ancre
									estAuteur={idUtilisateur !== null && commentaire.auteurId === idUtilisateur}
									estAdminWorkspace={estAdmin}
									onModifier={(corps) =>
										appliquer(() => modifierCommentaireOrganisation(client, commentaire.id, corps), 'live.comments.edited')
									}
									onSupprimer={(parModeration) =>
										appliquer(
											() => supprimerCommentaireOrganisation(client, commentaire.id),
											parModeration ? 'live.comments.moderated' : 'live.comments.deleted',
										)
									}
								/>
							</li>
						))}
					</ol>
				)}

				{sansEffet ? (
					<p role="alert" className="text-sm text-danger" data-testid="geste-sans-effet">
						{t('organization.comments.sansEffet')}
					</p>
				) : null}

				{/* Le composeur est TOUJOURS rendu ; refusé par la capacité d'éditer, il est inactif avec le motif (§5.107). */}
				<form onSubmit={(evenement) => void publier(evenement)} className="flex flex-col gap-2">
					<label htmlFor="commentaire-organisation-corps" className="sr-only">
						{t('comments.compose.label')}
					</label>
					<textarea
						ref={zone}
						id="commentaire-organisation-corps"
						data-testid="composeur-commentaire-organisation"
						rows={3}
						value={brouillon}
						onChange={(evenement) => setBrouillon(evenement.target.value)}
						placeholder={t('comments.compose.placeholder')}
						{...droit}
						className={[
							'w-full rounded-sm border border-border bg-surface px-3 py-2',
							'text-base text-ink placeholder:text-text-3',
							'focus:outline-none focus:ring-2 focus:ring-brand',
							'disabled:bg-hover disabled:text-text-2 disabled:cursor-not-allowed',
						].join(' ')}
					/>
					{refus === null ? null : (
						<p role="alert" className="text-sm text-danger" data-testid="refus-commentaire-organisation">
							{t(CLES_REFUS[refus])}
						</p>
					)}
					<SelecteurMentions
						commande={droit}
						ouvert={selecteurOuvert}
						onBasculer={() => setSelecteurOuvert((precedent) => !precedent)}
						etat={mentionnables}
						choisies={choisies}
						onBasculerPersonne={(idPersonne) =>
							setChoisies((precedentes) => {
								const suivantes = new Set(precedentes)
								if (suivantes.has(idPersonne)) suivantes.delete(idPersonne)
								else suivantes.add(idPersonne)
								return suivantes
							})
						}
						onReprise={() => setTentativeListe((n) => n + 1)}
						cleVide={CLE_MENTIONS_VIDE}
					/>
					{mentionsRefusees.length === 0 ? null : (
						<p role="alert" className="text-sm text-danger" data-testid="mentions-refusees">
							{t(mentionsRefusees.length === 1 ? 'comments.mentions.partiel' : 'comments.mentions.partiel.pluriel', {
								noms: mentionsRefusees.map((issue) => issue.personne.nom).join(', '),
								cause: t(CLES_REFUS_MENTION[natureDe(mentionsRefusees[0])]),
							})}
						</p>
					)}
					<div className="flex justify-end">
						<Button
							{...droit}
							type="submit"
							variante="primaire"
							data-testid="publier-commentaire-organisation"
							disabled={droit.disabled === true || brouillon.trim() === '' || envoiEnCours}
						>
							{envoiEnCours ? t('comments.compose.sending') : t('comments.compose.submit')}
						</Button>
					</div>
				</form>
			</FournisseurRefus>
		</section>
	)
}

/** L'adresse d'un commentaire dans la fiche — exportée pour la notification qui y mène. */
export { ancreCommentaire }
