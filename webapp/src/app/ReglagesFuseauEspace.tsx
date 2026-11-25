// @spec INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.b : Réglages ▸ Fuseau horaire — lire le fuseau de
//       l'espace, le régler par `workspace_set_timezone`, dire l'heure qu'il est dans le fuseau retenu
// @spec docs/SPEC-modeles-emails.md §8.6 bis (la règle, qui règle), §8.6 ter (l'écran : ce qu'il lit, écrit et refuse) ;
//       docs/DESIGN_SYSTEM.md §5.117 (cet écran), §5.104 (la forme de Réglages ▸ Prompts du connecteur reprise), §5.59 (la commande éteinte avec son
//       motif), §5.7 (le champ), §5.13 (le refus dans le bloc), §5.22 (le `select` natif, groupé), §5.34 (une seule commande d'enregistrement),
//       §5.8 (les états) ; docs/JOURNAL.md décisions 992, 996 et 1000
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la capacité d'administrer, rendue par la base, éteint la commande ; la fonction reste
//       seule juge de chaque écriture, et son refus est traduit sous le champ
//
// L'ÉCRAN EST LISIBLE PAR TOUT MEMBRE : on y lit le fuseau qui écrit les heures des e-mails. Qui n'administre pas l'espace voit le champ et la commande,
// éteints avec leur motif, jamais masqués (§5.59).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import {
	ecartAvecNavigateur,
	formaterEcart,
	fuseauDuNavigateur,
	fuseauxDuNavigateur,
	grouperFuseaux,
	heureDansFuseau,
	lireFuseauEspace,
	reglerFuseauEspace,
	type NatureRefusFuseau,
	type RegionFuseau,
} from '../lib/fuseau-espace'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { AlerteRefus } from './ElementsFormulaireAdmin'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'
const CLASSES_AIDE = 'text-sm text-text-2'
const ID_MOTIF = 'fuseau-espace-lecture-seule'

const CLES_REFUS: Readonly<Record<NatureRefusFuseau, CleTraduction>> = {
	forbidden: 'admin.timezone.refus.forbidden',
	'fuseau-inconnu': 'admin.timezone.refus.inconnu',
	network: 'admin.timezone.refus.panne',
	unknown: 'admin.timezone.refus.panne',
}

const CLES_REGION: Readonly<Record<RegionFuseau, CleTraduction>> = {
	Africa: 'admin.timezone.region.Africa',
	America: 'admin.timezone.region.America',
	Antarctica: 'admin.timezone.region.Antarctica',
	Arctic: 'admin.timezone.region.Arctic',
	Asia: 'admin.timezone.region.Asia',
	Atlantic: 'admin.timezone.region.Atlantic',
	Australia: 'admin.timezone.region.Australia',
	Europe: 'admin.timezone.region.Europe',
	Indian: 'admin.timezone.region.Indian',
	Pacific: 'admin.timezone.region.Pacific',
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly fuseau: string }

export type ProprietesReglagesFuseauEspace = { readonly client?: ClientCrm | null }

export function ReglagesFuseauEspace({ client = clientCrm }: ProprietesReglagesFuseauEspace = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	// Éteint pendant la lecture de la capacité comme sur un refus ; le motif n'est dit que sur un refus établi (§5.59).
	const eteint = administration === 'refusee' || administration === 'en-lecture'
	const refuse = administration === 'refusee'
	const id = useId()
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [choix, setChoix] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	const champ = useRef<HTMLSelectElement | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lireFuseauEspace(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') {
				setLecture({ statut: 'erreur', nature: lu.erreur.nature })
				return
			}
			if (lu.statut !== 'pret') return
			setLecture({ statut: 'pret', fuseau: lu.donnees })
			setChoix(lu.donnees)
		})
	}, [client, idWorkspace, tentative])

	const fuseauChoisi = choix ?? (lecture.statut === 'pret' ? lecture.fuseau : null)
	const groupes = useMemo(
		() => (lecture.statut === 'pret' ? grouperFuseaux(fuseauxDuNavigateur(), lecture.fuseau) : []),
		[lecture],
	)
	// L'instant est pris quand le choix change, jamais à chaque rendu : l'heure affichée ne bouge pas sous la main de qui choisit.
	const instant = useMemo(() => new Date(), [fuseauChoisi])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.timezone.noworkspace')} />
	}

	const enregistrer = async () => {
		if (fuseauChoisi === null) return
		setEnCours(true)
		setRefus(null)
		const issue = await reglerFuseauEspace(client, idWorkspace, fuseauChoisi)
		setEnCours(false)
		if (issue.statut === 'applique') {
			setAnnonce(t('admin.timezone.saved', { fuseau: fuseauChoisi }))
			setTentative((n) => n + 1)
			return
		}
		setRefus(t(CLES_REFUS[issue.nature]))
		// Le focus revient au champ à corriger, la saisie conservée (§5.71, §5.117).
		champ.current?.focus()
	}

	const heureChoisie = fuseauChoisi === null ? null : heureDansFuseau(instant, fuseauChoisi)
	const fuseauNavigateur = fuseauDuNavigateur()
	const heureNavigateur = fuseauNavigateur === null ? null : heureDansFuseau(instant, fuseauNavigateur)
	const ecart = fuseauChoisi === null ? null : ecartAvecNavigateur(instant, fuseauChoisi)
	const idHeure = `${id}-heure`

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-fuseau-espace">
			<h2 className="text-h3">{t('admin.timezone.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.timezone.intro')}</p>
			{refuse ? <MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule> : null}
			<p role="status" className="sr-only" data-testid="annonce-fuseau">
				{annonce}
			</p>

			{lecture.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.timezone.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : (
				<form
					className="flex flex-col gap-4"
					noValidate
					onSubmit={(evenement) => {
						evenement.preventDefault()
						void enregistrer()
					}}
				>
					<div className="flex max-w-[48ch] flex-col gap-1">
						<label htmlFor={`${id}-champ`} className={CLASSES_LIBELLE}>
							{t('admin.timezone.field')}
						</label>
						<select
							ref={champ}
							id={`${id}-champ`}
							data-testid="champ-fuseau"
							value={fuseauChoisi ?? ''}
							disabled={eteint}
							aria-describedby={heureChoisie === null ? (refuse ? ID_MOTIF : undefined) : refuse ? `${idHeure} ${ID_MOTIF}` : idHeure}
							onChange={(evenement) => {
								setChoix(evenement.target.value)
								setRefus(null)
							}}
							className={CLASSES_CHAMP}
						>
							{groupes.map((groupe) => {
								const options = groupe.fuseaux.map((fuseau) => (
									<option key={fuseau} value={fuseau}>
										{fuseau}
									</option>
								))
								return groupe.region === null ? (
									options
								) : (
									<optgroup key={groupe.region} label={t(CLES_REGION[groupe.region])}>
										{options}
									</optgroup>
								)
							})}
						</select>
						{/* L'heure dans le fuseau retenu : donnée technique (§2), dans son propre élément, hors région vivante (§5.7 ter). */}
						{heureChoisie === null ? null : (
							<p id={idHeure} className={CLASSES_AIDE} data-testid="heure-fuseau">
								{heureNavigateur !== null && ecart !== null && ecart !== 0
									? t('admin.timezone.now.diff', {
											heure: heureChoisie,
											heureNavigateur,
											ecart: formaterEcart(ecart),
										})
									: t('admin.timezone.now', { heure: heureChoisie })}
							</p>
						)}
					</div>
					{refus === null ? null : <AlerteRefus message={refus} />}
					<div className="flex flex-wrap items-center gap-2">
						{/* La seule commande : une fonction, deux paramètres (§5.34). Jamais éteinte par l'état du champ (§5.3 ter). */}
						<Button
							variante="primaire"
							type="submit"
							data-testid="enregistrer-fuseau"
							disabled={eteint || enCours}
							aria-busy={enCours}
							aria-describedby={refuse ? ID_MOTIF : undefined}
						>
							{t(enCours ? 'admin.timezone.pending' : 'admin.timezone.save')}
						</Button>
					</div>
				</form>
			)}
		</div>
	)
}
