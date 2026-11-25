// @spec INC-314 (docs/BACKLOG.md « Relevé du 2026-11-25 », lot A ; docs/DESIGN_SYSTEM.md §3) — `pl-5` et `mt-0.5`, absente du CSS produit sur l'échelle close, remplacée par sa forme assumée
// @spec CRM-162 (docs/BACKLOG.md) — tranche T2 : le bloc « Tracks » de la fiche d'un espace, et le déplacement d'un track
//       vers un autre espace — le choix de l'arrivée, l'aperçu chiffré, les refus listés, la saisie du nom, l'issue
// @spec docs/SPEC-deplacement-track.md §4, §5, §6, §13 ; docs/DESIGN_SYSTEM.md §5.112, §5.56, §5.9 (tableaux), §5.27
//       (une ligne à elle), §5.40 (commande montée et désactivée), §5.50 (saisie qui confirme), §5.20 (`dl`)
// @spec CLAUDE.md §10 — aucun droit calculé : l'aperçu et le déplacement sont envoyés, la base tranche
//
// UN SEUL BLOC OUVERT À LA FOIS (§5.28) : le parent tient l'ouverture, comme pour les autres blocs de la fiche.

import { FolderSymlink, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	confirmationDeplacementValide,
	deplacerTrack,
	lireApercu,
	lireTracksEspace,
	type Apercu,
	type CodeRefusDeplacement,
	type FamilleReferentiel,
	type RefusDeplacement,
	type TrackEspace,
} from '../lib/deplacement-track'
import type { EspacePlateforme } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { cheminFicheEspace } from './chemins'
import { BlocMessage, CLASSES_CHAMP, Champ, type Message } from './TableauMembres'

const CLES_REFUS: Readonly<Record<CodeRefusDeplacement, CleTraduction>> = {
	same_workspace: 'platform.tracks.refus.same_workspace',
	track_trashed: 'platform.tracks.refus.track_trashed',
	homonym_track: 'platform.tracks.refus.homonym_track',
	shared_card: 'platform.tracks.refus.shared_card',
	non_member: 'platform.tracks.refus.non_member',
	armed_sequence: 'platform.tracks.refus.armed_sequence',
	queued_send: 'platform.tracks.refus.queued_send',
	pending_draft: 'platform.tracks.refus.pending_draft',
	field_type_conflict: 'platform.tracks.refus.field_type_conflict',
	daily_cap_exceeded: 'platform.tracks.refus.daily_cap_exceeded',
}

const CLES_FAMILLE: Readonly<Record<FamilleReferentiel, CleTraduction>> = {
	workflow: 'platform.tracks.famille.workflow',
	node: 'platform.tracks.famille.node',
	common_field: 'platform.tracks.famille.common_field',
	label: 'platform.tracks.famille.label',
	contact: 'platform.tracks.famille.contact',
	organization: 'platform.tracks.famille.organization',
	mail_label: 'platform.tracks.famille.mail_label',
	sequence: 'platform.tracks.famille.sequence',
	template: 'platform.tracks.famille.template',
}

const CLES_ECHEC: Readonly<Record<'confirmation' | 'forbidden' | 'introuvable' | 'network' | 'unknown', CleTraduction>> = {
	confirmation: 'platform.tracks.echec.confirmation',
	forbidden: 'platform.tracks.echec.forbidden',
	introuvable: 'platform.tracks.echec.introuvable',
	network: 'platform.tracks.echec.network',
	unknown: 'platform.tracks.echec.unknown',
}

const montant = (devise: string, valeur: number) =>
	devise === '' ? String(valeur) : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: devise }).format(valeur)

/** Le bloc « Tracks » de la fiche d'un espace (§5.112). */
export function BlocTracks({
	client,
	espace,
	espaces,
	ouvert,
	onOuvrir,
	onFermer,
	onDeplace,
	message,
}: {
	readonly client: ClientCrm
	readonly espace: EspacePlateforme
	readonly espaces: readonly EspacePlateforme[]
	/** Le track dont le déplacement est ouvert, ou `null`. */
	readonly ouvert: string | null
	readonly onOuvrir: (idTrack: string) => void
	readonly onFermer: () => void
	readonly onDeplace: (message: string) => void
	readonly message: Message
}) {
	const [lecture, setLecture] = useState<EtatAsync<readonly TrackEspace[]>>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const commandes = useRef(new Map<string, HTMLButtonElement>())
	const aRendre = useRef<string | null>(null)
	// L'espace d'arrivée du dernier déplacement : le message de succès mène à sa fiche (§5.112).
	const [arriveeDuSucces, setArriveeDuSucces] = useState<EspacePlateforme | null>(null)

	useEffect(() => {
		let vivant = true
		void lireTracksEspace(client, espace.id).then((etat) => {
			if (vivant) setLecture(etat)
		})
		return () => {
			vivant = false
		}
	}, [client, espace.id, tentative])

	// Le focus revient à la commande qui a ouvert le bloc, une fois refermé (§5.13).
	useEffect(() => {
		if (ouvert === null && aRendre.current !== null) {
			commandes.current.get(aRendre.current)?.focus()
			aRendre.current = null
		}
	}, [ouvert])

	const fermer = (idTrack: string) => {
		aRendre.current = idTrack
		onFermer()
	}

	return (
		<section aria-labelledby="titre-tracks" className="flex flex-col gap-4" data-testid="bloc-tracks">
			<h2 id="titre-tracks" className="text-h3">
				{t('platform.tracks.titre')}
			</h2>
			{message?.ton === 'succes' && arriveeDuSucces !== null ? (
				<p role="status" data-testid="message-tracks" className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm">
					{message.texte}{' '}
					<Link to={cheminFicheEspace(arriveeDuSucces.slug)} className="font-medium underline" data-testid="lien-arrivee">
						{t('platform.tracks.ouvrirArrivee', { espace: arriveeDuSucces.nom })}
					</Link>
				</p>
			) : (
				<BlocMessage message={message} testId="message-tracks" />
			)}
			{lecture.statut === 'chargement' ? <SkeletonListe lignes={3} libelle={t('state.loading.aria')} /> : null}
			{lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('platform.tracks.erreur')}
					corps={t('state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : null}
			{lecture.statut === 'pret' && lecture.donnees.length === 0 ? (
				<p className="text-text-2" data-testid="tracks-vide">
					{t('platform.tracks.vide')}
				</p>
			) : null}
			{lecture.statut === 'pret' && lecture.donnees.length > 0 ? (
				<table className="w-full text-sm" data-testid="tableau-tracks">
					<thead>
						<tr className="text-left text-text-2 border-b border-border">
							<th scope="col" className="py-2 pr-3 font-medium">{t('platform.tracks.col.nom')}</th>
							<th scope="col" className="py-2 pr-3 font-medium text-right">{t('platform.tracks.col.channels')}</th>
							<th scope="col" className="py-2 pr-3 font-medium text-right">{t('platform.tracks.col.affaires')}</th>
							<th scope="col" className="py-2 font-medium">
								<span className="sr-only">{t('platform.tracks.col.commandes')}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{lecture.donnees.map((track) => (
							<Fragment key={track.id}>
								<tr className="border-b border-border" data-testid="ligne-track" data-track={track.id}>
									<td className="py-2 pr-3 break-words">{track.nom}</td>
									<td className="py-2 pr-3 text-right tabular-nums">{track.channels}</td>
									<td className="py-2 pr-3 text-right tabular-nums">{track.affaires}</td>
									<td className="py-2 text-right">
										<Button
											ref={(element) => {
												if (element === null) commandes.current.delete(track.id)
												else commandes.current.set(track.id, element)
											}}
											variante="discret"
											taille="compacte"
											disabled={ouvert === track.id}
											onClick={() => onOuvrir(track.id)}
											data-testid="deplacer-track"
											aria-label={t('platform.tracks.deplacer.aria', { nom: track.nom })}
										>
											<FolderSymlink aria-hidden="true" size={16} />
											{t('platform.tracks.deplacer')}
										</Button>
									</td>
								</tr>
								{ouvert === track.id ? (
									<tr>
										<td colSpan={4} className="py-3">
											<Deplacement
												client={client}
												track={track}
												espaces={espaces.filter((e) => e.id !== espace.id)}
												onAnnuler={() => fermer(track.id)}
												onDeplace={(arrivee) => {
													setArriveeDuSucces(arrivee)
													onDeplace(t('platform.tracks.deplace', { nom: track.nom, espace: arrivee.nom }))
													setTentative((n) => n + 1)
												}}
											/>
										</td>
									</tr>
								) : null}
							</Fragment>
						))}
					</tbody>
				</table>
			) : null}
		</section>
	)
}

/** Le bloc du déplacement d'un track (§5.112) : l'arrivée, l'aperçu, les refus, la saisie. */
function Deplacement({
	client,
	track,
	espaces,
	onAnnuler,
	onDeplace,
}: {
	readonly client: ClientCrm
	readonly track: TrackEspace
	readonly espaces: readonly EspacePlateforme[]
	readonly onAnnuler: () => void
	readonly onDeplace: (arrivee: EspacePlateforme) => void
}) {
	const id = useId()
	const [arrivee, setArrivee] = useState('')
	const [apercu, setApercu] = useState<EtatAsync<Apercu> | null>(null)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refusBase, setRefusBase] = useState<readonly RefusDeplacement[] | null>(null)
	const [echec, setEchec] = useState<string | null>(null)
	const choix = useRef<HTMLSelectElement>(null)

	useEffect(() => {
		choix.current?.focus()
	}, [])

	useEffect(() => {
		if (arrivee === '') {
			setApercu(null)
			return
		}
		let vivant = true
		setApercu({ statut: 'chargement' })
		setRefusBase(null)
		setEchec(null)
		void lireApercu(client, track.id, arrivee).then((etat) => {
			if (vivant) setApercu(etat)
		})
		return () => {
			vivant = false
		}
	}, [client, track.id, arrivee, tentative])

	const deplacer = async () => {
		setEnvoi(true)
		setEchec(null)
		const issue = await deplacerTrack(client, track.id, arrivee, saisie)
		setEnvoi(false)
		if (issue.statut === 'deplace') {
			const espaceArrivee = espaces.find((e) => e.id === arrivee)
			if (espaceArrivee !== undefined) onDeplace(espaceArrivee)
			return
		}
		if (issue.statut === 'refuse') {
			setRefusBase(issue.refus)
			return
		}
		setEchec(t(CLES_ECHEC[issue.nature]))
	}

	const refus = refusBase ?? (apercu?.statut === 'pret' ? apercu.donnees.refus : [])
	const ordonnes = [...espaces].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

	return (
		<div
			role="group"
			aria-labelledby={`${id}-titre`}
			onKeyDown={(e) => {
				if (e.key === 'Escape' && !envoi) {
					e.preventDefault()
					onAnnuler()
				}
			}}
			data-testid="bloc-deplacement"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<p id={`${id}-titre`} className="font-medium">
				{t('platform.tracks.deplacement.titre', { nom: track.nom })}
			</p>
			<Champ id={`${id}-arrivee`} libelle={t('platform.tracks.arrivee')}>
				<select
					id={`${id}-arrivee`}
					ref={choix}
					value={arrivee}
					onChange={(e) => {
						setArrivee(e.target.value)
						setSaisie('')
					}}
					className={CLASSES_CHAMP}
					data-testid="choix-arrivee"
				>
					<option value="">{t('platform.tracks.arrivee.choisir')}</option>
					{ordonnes.map((e) => (
						<option key={e.id} value={e.id}>
							{e.nom}
						</option>
					))}
				</select>
			</Champ>

			{apercu?.statut === 'chargement' ? <SkeletonListe lignes={4} libelle={t('state.loading.aria')} /> : null}
			{apercu?.statut === 'erreur' ? (
				<EtatErreur
					titre={t('platform.tracks.apercu.erreur')}
					corps={t('state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : null}
			{apercu?.statut === 'pret' ? <ApercuDeplacement apercu={apercu.donnees} /> : null}

			{apercu?.statut === 'pret' && refus.length > 0 ? (
				<div role="alert" data-testid="refus-deplacement" className="flex flex-col gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm">
					<p className="flex items-start gap-2 font-medium">
						<TriangleAlert aria-hidden="true" size={16} className="shrink-0 mt-[2px]" />
						{t('platform.tracks.refus.titre')}
					</p>
					{refus.map((r) => (
						<div key={r.code} data-testid="refus" data-code={r.code}>
							<p>{t(CLES_REFUS[r.code], { espace: apercu.donnees.arrivee.nom })}</p>
							{r.elements.length > 0 ? (
								<ul className="list-disc pl-6">
									{r.elements.map((e, rang) => (
										<li key={rang} className="break-words">
											{e}
										</li>
									))}
								</ul>
							) : null}
						</div>
					))}
				</div>
			) : null}

			{apercu?.statut === 'pret' && refus.length === 0 ? (
				<Champ
					id={`${id}-nom`}
					libelle={t('platform.tracks.saisie')}
					aide={t('platform.tracks.saisie.aide', { nom: track.nom })}
				>
					<input
						id={`${id}-nom`}
						value={saisie}
						autoComplete="off"
						aria-describedby={`${id}-nom-aide`}
						onChange={(e) => setSaisie(e.target.value)}
						className={CLASSES_CHAMP}
						data-testid="saisie-nom-track"
					/>
				</Champ>
			) : null}
			{echec !== null ? (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm" data-testid="echec-deplacement">
					{echec}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				{apercu?.statut === 'pret' && refus.length === 0 ? (
					<Button
						variante="primaire"
						disabled={envoi || !confirmationDeplacementValide(saisie, track.nom)}
						aria-busy={envoi}
						onClick={() => void deplacer()}
						data-testid="confirmer-deplacement"
					>
						{envoi ? t('platform.envoi') : t('platform.tracks.confirmer')}
					</Button>
				) : null}
				<Button variante="secondaire" disabled={envoi} onClick={onAnnuler} data-testid="annuler-deplacement">
					{t('platform.annuler')}
				</Button>
			</div>
		</div>
	)
}

/** L'aperçu chiffré (§5, §5.112) : ce qui part, les référentiels, les temps et coûts, les adresses. */
function ApercuDeplacement({ apercu }: { readonly apercu: Apercu }) {
	const c = apercu.comptes
	const lignes: readonly [CleTraduction, number][] = [
		['platform.tracks.part.channels', c.channels],
		['platform.tracks.part.affaires', c.affaires],
		['platform.tracks.part.mails', c.mails],
		['platform.tracks.part.pieces', c.pieces],
		['platform.tracks.part.commentaires', c.commentaires],
		['platform.tracks.part.saisies', c.saisies],
		['platform.tracks.part.budgets', c.budgets],
		['platform.tracks.part.couts', c.couts],
		['platform.tracks.part.recettes', c.recettes],
		['platform.tracks.part.webhooks', c.webhooks],
	]
	const devises = [...new Set([...apercu.valeurDepart, ...apercu.valeurArrivee].map((m) => m.devise))]
	return (
		<div className="flex flex-col gap-4 text-sm" data-testid="apercu-deplacement">
			<section className="flex flex-col gap-2">
				<h3 className="font-medium">{t('platform.tracks.part')}</h3>
				<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 max-w-[40ch]">
					{lignes.map(([cle, valeur]) => (
						<Fragment key={cle}>
							<dt className="text-text-2">{t(cle)}</dt>
							<dd className="text-right tabular-nums" data-testid={`compte-${cle.split('.').pop()}`}>
								{valeur}
							</dd>
						</Fragment>
					))}
				</dl>
			</section>

			{apercu.referentiels.length > 0 ? (
				<section className="flex flex-col gap-2" data-testid="apercu-referentiels">
					<h3 className="font-medium">{t('platform.tracks.referentiels')}</h3>
					{apercu.referentiels.map((r) => (
						<div key={r.famille} className="flex flex-col gap-1" data-testid="famille-referentiel" data-famille={r.famille}>
							<p className="text-text-2">{t(CLES_FAMILLE[r.famille])}</p>
							{r.reutilises.length > 0 ? (
								<p className="break-words">
									<span className="text-text-2">{t('platform.tracks.reutilises')} </span>
									{r.reutilises.join(', ')}
								</p>
							) : null}
							{r.crees.length > 0 ? (
								<p className="break-words">
									<span className="text-text-2">{t('platform.tracks.crees')} </span>
									{r.crees.join(', ')}
								</p>
							) : null}
						</div>
					))}
				</section>
			) : null}

			<section className="flex flex-col gap-2" data-testid="apercu-couts">
				<h3 className="font-medium">{t('platform.tracks.couts')}</h3>
				{c.saisies === 0 ? (
					<p className="text-text-2">{t('platform.tracks.couts.aucun')}</p>
				) : (
					<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 max-w-[40ch]">
						{devises.map((devise) => {
							const depart = apercu.valeurDepart.find((m) => m.devise === devise)?.montant ?? 0
							const arrivee = apercu.valeurArrivee.find((m) => m.devise === devise)?.montant ?? 0
							return (
								<Fragment key={devise}>
									<dt className="text-text-2">{t('platform.tracks.couts.depart')}</dt>
									<dd className="text-right tabular-nums">{montant(devise, depart)}</dd>
									<dt className="text-text-2">{t('platform.tracks.couts.arrivee')}</dt>
									<dd className="text-right tabular-nums">{montant(devise, arrivee)}</dd>
									<dt className="text-text-2">{t('platform.tracks.couts.ecart')}</dt>
									<dd className="text-right tabular-nums">{(arrivee - depart >= 0 ? '+' : '') + montant(devise, arrivee - depart)}</dd>
								</Fragment>
							)
						})}
					</dl>
				)}
				{apercu.sansCout.length > 0 ? (
					<p className="break-words" data-testid="sans-cout">
						<span className="text-text-2">{t('platform.tracks.couts.sansCout')} </span>
						{apercu.sansCout.join(', ')}
					</p>
				) : null}
			</section>

			{apercu.doublons.length > 0 ? (
				<section className="flex flex-col gap-1" data-testid="apercu-doublons">
					<h3 className="font-medium">{t('platform.tracks.doublons')}</h3>
					<p className="text-text-2">{t('platform.tracks.doublons.regle')}</p>
					<ul className="list-disc pl-6">
						{apercu.doublons.map((d, rang) => (
							<li key={rang} className="break-words">
								{d}
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section className="flex flex-col gap-1">
				<h3 className="font-medium">{t('platform.tracks.adresses')}</h3>
				{apercu.arrivee.domaine === null ? (
					<p role="note" data-testid="adresses-sans-domaine" className="rounded-sm bg-accent-soft text-accent-on-soft px-3 py-2">
						{t('platform.tracks.adresses.sansDomaine')}
					</p>
				) : (
					<p data-testid="adresses-domaine">{t('platform.tracks.adresses.domaine', { domaine: apercu.arrivee.domaine })}</p>
				)}
			</section>
		</div>
	)
}
