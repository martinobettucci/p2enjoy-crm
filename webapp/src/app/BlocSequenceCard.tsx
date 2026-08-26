// @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//       TRANCHE 4, SOUS-TRANCHE 4c : l'armement depuis l'affaire
// @spec docs/SPEC-modeles-emails.md §13.8 (où le bloc vit, ses deux états, son dictionnaire fermé
//       de refus, et ce qu'il ne rend PAS), §13.1 question 3 (la mesure qui place le geste ici),
//       §12.4 (les huit refus de l'armement), §12.7 (les quatre fins), §12.11 (contrat d'API)
// @spec docs/DESIGN_SYSTEM.md §5.42 (ce bloc), §5.21 (sa place dans la colonne gauche), §5.5
//       (variantes), §5.8 (états systématiques), §9 (icônes Lucide)
//
// LE BLOC EST TOUJOURS RENDU, ET SA COMMANDE N'EST JAMAIS ÉTEINTE — ni selon le rôle, ni selon
// l'état de l'affaire (§5.3, §5.13, §5.21, §5.27, sans exception).
//
// EN PARTICULIER, L'ÉCRAN NE CALCULE PAS SI L'AFFAIRE EST FIGÉE. `public.cards_figees()` porte
// cette définition, une seule fois, et la recopier en TypeScript créerait la seconde définition que
// le §2.1 de `docs/SPEC-relances.md` existe pour empêcher. Le rédacteur arme, la base refuse en
// `card_not_stalled`, et le refus est TRADUIT en disant ce qu'il faudrait pour que le geste
// devienne possible.
//
// AUCUNE DATE DE PROCHAIN ENVOI (§13.8). Elle serait la seconde source de vérité que le §12.3 a
// refusée en base, et l'écran ne peut pas la calculer honnêtement : le job glisse la cadence sur
// l'envoi RÉEL (§12.5), et une échéance affichée serait fausse dès qu'un passage manquerait.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Play, Square } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireIdentitesDisponibles, type IdentiteEnvoi } from '../lib/envoi'
import {
	armerSequence,
	interrompreSequence,
	lireInscriptionActive,
	lireSequences,
	type InscriptionSequence,
	type IssueArmement,
	type SequenceRelance,
} from '../lib/sequences-relance'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/**
 * Le dictionnaire fermé des refus de l'armement — §13.8, chaque ligne MESURÉE le 2026-08-26.
 *
 * `identite-refusee` ET `refus` SONT DEUX ENTRÉES DISTINCTES, et ce n'est pas un raffinement : les
 * deux rendent `403` / `42501`, mais ils demandent deux gestes différents — choisir une autre
 * adresse, ou demander un droit.
 */
const REFUS: Readonly<Record<Exclude<IssueArmement, 'arme'>, CleTraduction>> = {
	'deja-armee': 'card.sequence.refusal.alreadyArmed',
	'non-figee': 'card.sequence.refusal.notStalled',
	'sequence-vide': 'card.sequence.refusal.emptySequence',
	'sequence-indisponible': 'card.sequence.refusal.unavailableSequence',
	'adresse-absente': 'card.sequence.refusal.noAddress',
	'identite-refusee': 'card.sequence.refusal.identity',
	refus: 'card.sequence.refusal.forbidden',
	'session-expiree': 'card.sequence.refusal.session',
	reseau: 'card.sequence.refusal.network',
	inconnu: 'card.sequence.refusal.unknown',
}

const CLASSES_CHAMP = [
	'min-h-[var(--size-target)] px-3 rounded-sm max-w-full',
	'border border-border bg-surface text-ink',
].join(' ')

const CLASSES_ETIQUETTE = 'flex flex-col gap-1 text-sm text-text-2 min-w-0'

export type ProprietesBlocSequenceCard = {
	readonly idCard: string
	readonly client?: ClientCrm | null
}

export function BlocSequenceCard({ idCard, client = clientCrm }: ProprietesBlocSequenceCard) {
	const [inscription, setInscription] = useState<EtatAsync<InscriptionSequence | null>>(enChargement)
	const [sequences, setSequences] = useState<readonly SequenceRelance[]>([])
	const [identites, setIdentites] = useState<readonly IdentiteEnvoi[]>([])
	const [idSequence, setIdSequence] = useState('')
	const [idIdentite, setIdIdentite] = useState('')
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const [tentative, setTentative] = useState(0)

	const authentification = useAuthentification()
	const idUtilisateur =
		authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null

	// Une réponse arrivée après le démontage ne doit pas écraser un état plus récent — même garde
	// que `BlocContactsCard` et `BlocCoutsCard`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setInscription(enChargement())
		void (async () => {
			const lue = await lireInscriptionActive(client, idCard)
			if (rang !== courant.current) return
			setInscription(lue)
		})()
	}, [client, idCard, tentative])

	// LES DEUX SÉLECTEURS SE CHARGENT UNE FOIS. Leur échec ne bloque pas la lecture de l'état : une
	// liste vide empêche d'armer et le DIT, elle n'empêche pas de voir ce qui est en cours.
	useEffect(() => {
		if (client === null) return
		let vivant = true
		void (async () => {
			const lues = await lireSequences(client)
			if (vivant && lues.statut === 'pret') setSequences(lues.donnees)
			// LE SÉLECTEUR D'IDENTITÉ RÉEMPLOIE `lireIdentitesDisponibles` DE `CRM-058`, et n'en écrit
			// pas un second (§13.8). Ce module porte déjà le filtre mesuré — la RLS ouvre la lecture
			// aux administrateurs sur TOUTES les identités du workspace, y compris celles de leurs
			// collègues —, et `armer_sequence_relance` reprend telle quelle la règle d'emprunt de
			// `queue_outbound_email`. Deux filtres pour une même règle divergeraient.
			const disponibles = await lireIdentitesDisponibles(client, idUtilisateur)
			if (vivant) setIdentites(disponibles)
		})()
		return () => {
			vivant = false
		}
	}, [client, idUtilisateur])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const armer = useCallback(async () => {
		if (client === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const issue = await armerSequence(client, idCard, idSequence, idIdentite)
		setEnCours(false)
		if (issue !== 'arme') {
			// Un refus n'efface pas les sélections : le rédacteur doit pouvoir corriger l'une des deux
			// sans tout ressaisir (§5.7 ter).
			setRefus(REFUS[issue])
			return
		}
		setAnnonce(t('card.sequence.armed'))
		recharger()
	}, [client, enCours, idCard, idIdentite, idSequence, recharger])

	const interrompre = useCallback(async () => {
		if (client === null || enCours) return
		const active = inscription.statut === 'pret' ? inscription.donnees : null
		if (active === null) return
		setEnCours(true)
		setRefus(null)
		const issue = await interrompreSequence(client, active.id)
		if (issue !== 'interrompue') {
			setEnCours(false)
			setRefus(issue === 'inconnu' ? 'card.sequence.refusal.unknown' : REFUS[issue])
			return
		}
		// `204` NE DIT PAS QU'UNE LIGNE A ÉTÉ FERMÉE : l'appel est IDEMPOTENT (§12.4), et le même
		// `204` couvre les deux cas. L'écran RELIT donc, et n'annonce l'interruption qu'après avoir
		// constaté que l'inscription active a disparu — la règle du §9.7, appliquée à une RPC.
		const relue = await lireInscriptionActive(client, idCard)
		setEnCours(false)
		if (relue.statut === 'pret' && relue.donnees === null) {
			setInscription(relue)
			setAnnonce(t('card.sequence.stopped'))
			return
		}
		setRefus('card.sequence.stop.refusal.stillActive')
		if (relue.statut === 'pret') setInscription(relue)
	}, [client, enCours, idCard, inscription])

	if (client === null) return null

	const active = inscription.statut === 'pret' ? inscription.donnees : null

	return (
		<section
			data-testid="bloc-sequence-card"
			aria-labelledby="bloc-sequence-titre"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			<h2 id="bloc-sequence-titre" className="text-h3 flex items-center gap-2">
				<CalendarClock aria-hidden="true" className="size-4 text-text-2" />
				{t('card.sequence.title')}
			</h2>
			<LiveRegion libelle={t('card.sequence.title')} message={annonce} />

			{inscription.statut === 'erreur' && (
				<p role="alert" data-testid="sequence-erreur" className="text-sm text-danger">
					{t('card.sequence.error')}
				</p>
			)}

			{active !== null ? (
				<div data-testid="sequence-active" className="flex flex-col gap-2">
					{/* L'ÉTAT DIT OÙ EN EST LA CADENCE, ET RIEN DE PLUS (§5.42). Le nom de la séquence et
					    l'adresse expéditrice viennent d'un SEUL appel, par jointure — mesuré. */}
					<p data-testid="sequence-active-nom" className="text-sm">
						{t('card.sequence.active.sequence', {
							sequence: active.sequence ?? t('card.sequence.field.sequence.none'),
						})}
					</p>
					{active.adresse !== null && (
						<p data-testid="sequence-active-adresse" className="text-sm text-text-2">
							{t('card.sequence.active.identity', { adresse: active.adresse })}
						</p>
					)}
					{/* LES DEUX COLONNES SONT NULLES ENSEMBLE OU RENSEIGNÉES ENSEMBLE, et une contrainte
					    le dit (§12.3) : l'écran n'a donc AUCUN cas mixte à inventer. */}
					<p data-testid="sequence-active-avancement" className="text-sm text-text-2">
						{active.last_position === null || active.last_sent_at === null
							? t('card.sequence.active.noStepSent')
							: t('card.sequence.active.lastStep', {
									position: String(active.last_position),
									date: new Date(active.last_sent_at).toLocaleDateString('fr-FR'),
								})}
					</p>
					<div>
						<Button
							variante="secondaire"
							data-testid="interrompre-sequence"
							disabled={enCours}
							onClick={() => void interrompre()}
						>
							<Square aria-hidden="true" className="size-4" />
							{enCours ? t('card.sequence.stopping') : t('card.sequence.stop')}
						</Button>
					</div>
				</div>
			) : (
				<div data-testid="sequence-armement" className="flex flex-col gap-3">
					<p className="text-sm text-text-2 max-w-[72ch]">{t('card.sequence.help')}</p>
					<p data-testid="sequence-vide" className="text-sm text-text-2">
						{t('card.sequence.empty')}
					</p>

					{sequences.length === 0 ? (
						<p data-testid="sequence-aucune-sequence" className="text-sm text-text-2">
							{t('card.sequence.noSequences')}
						</p>
					) : (
						<label className={CLASSES_ETIQUETTE}>
							{t('card.sequence.field.sequence')}
							{/* L'OPTION DE TÊTE EST VIDE : rien n'est présélectionné (§5.42, §9.5). */}
							<select
								data-testid="champ-sequence"
								value={idSequence}
								onChange={(evenement) => setIdSequence(evenement.target.value)}
								className={CLASSES_CHAMP}
							>
								<option value="">{t('card.sequence.field.sequence.none')}</option>
								{sequences.map((sequence) => (
									<option key={sequence.id} value={sequence.id}>
										{sequence.name}
									</option>
								))}
							</select>
						</label>
					)}

					{identites.length === 0 ? (
						<p data-testid="sequence-aucune-identite" className="text-sm text-text-2">
							{t('card.sequence.noIdentities')}
						</p>
					) : (
						<label className={CLASSES_ETIQUETTE}>
							{t('card.sequence.field.identity')}
							<select
								data-testid="champ-identite-sequence"
								value={idIdentite}
								onChange={(evenement) => setIdIdentite(evenement.target.value)}
								className={CLASSES_CHAMP}
							>
								<option value="">{t('card.sequence.field.identity.none')}</option>
								{/* UNE IDENTITÉ EST NOMMÉE `libellé — adresse`, forme du §5.35 : deux
								    identités d'une même personne peuvent porter le même libellé, et
								    l'adresse est leur clé. */}
								{identites.map((identite) => (
									<option key={identite.id} value={identite.id}>
										{identite.libelle} — {identite.adresse}
									</option>
								))}
							</select>
						</label>
					)}

					<div>
						{/* LA COMMANDE N'EST JAMAIS DÉSACTIVÉE PAR L'ÉTAT DES CHAMPS (§5.3 ter) : une
						    séquence non choisie part, et la base refuse en `sequence_not_available`. */}
						<Button
							variante="primaire"
							data-testid="armer-sequence"
							disabled={enCours}
							onClick={() => void armer()}
						>
							<Play aria-hidden="true" className="size-4" />
							{enCours ? t('card.sequence.arming') : t('card.sequence.arm')}
						</Button>
					</div>
				</div>
			)}

			{refus !== null && (
				<p role="alert" data-testid="refus-sequence" className="text-sm text-danger max-w-[72ch]">
					{t(refus)}
				</p>
			)}
		</section>
	)
}
