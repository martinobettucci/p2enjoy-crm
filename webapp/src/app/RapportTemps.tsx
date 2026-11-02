// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : l'onglet « Rapport mensuel » de l'écran « Temps », et les montants
//       du coût du personnel
// @spec docs/SPEC-temps.md §4 (« non valorisé », jamais zéro ; une devise par montant), §5.1 (un membre ne lit que son
//       temps ; un administrateur, celui de chacun), §7.3 (navigation de mois ; « Toute l'équipe » ; une ligne par
//       cible ; totaux) ; docs/DESIGN_SYSTEM.md §5.54 (rapport : tableau du §5.9, retraits, pilule « non valorisé » ;
//       navigation de mois), §5.6, §5.8
// @spec docs/INCONSISTENCY_REPORT.md INC-333, décision 801 — le mois se choisit par la navigation partagée
//       (`NavigationMois`), titre `h2` du rapport ; docs/manual.md §28.4
// @spec CRM-111 (docs/BACKLOG.md) — tranche T4.2 : la pilule « partagée » d'une ligne d'affaire et la mention sous le
//       tableau ; docs/DESIGN_SYSTEM.md §5.54 (« La saisie partagée »), §5.60 ; docs/SPEC-temps.md §7.3 ; manual.md §28.4
//
// La base valorise et filtre : l'écran nomme, regroupe et affiche.

import { useEffect, useState } from 'react'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireMembresAffectables, type MembreAffectable } from '../lib/entete-card'
import {
	bornesDuMois,
	composerRapport,
	idsANommer,
	lireNoms,
	lireTempsValorise,
	type Cumul,
	type LigneRapport,
	type Noms,
	type SectionRapport,
} from '../lib/rapport-temps'
import type { ClientCrm } from '../lib/supabase'
import { enHeures, enJours } from '../lib/temps'
import { NavigationMois, libelleMois, useMoisDeLAdresse } from './NavigationMois'
import { formaterDuree } from './SaisieTemps'

const EQUIPE = 'equipe' as const

const FORMAT_MONTANT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Les montants d'un cumul, une devise par montant, sans jamais les additionner entre elles (§4). */
export function montantsEnMots(cumul: Cumul): readonly string[] {
	return Object.entries(cumul.montants)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([devise, montant]) => t('time.amount', { montant: FORMAT_MONTANT.format(montant), devise }))
}

/** La cellule « Coût » : les montants, et ce qui n'est pas valorisé — dit, jamais compté pour zéro. */
export function CelluleCout({ cumul }: { readonly cumul: Cumul }) {
	const montants = montantsEnMots(cumul)
	return (
		<span className="inline-flex flex-wrap items-center justify-end gap-2">
			{montants.map((m) => (
				<span key={m} className="whitespace-nowrap">
					{m}
				</span>
			))}
			{cumul.minutesNonValorisees > 0 ? (
				<span className="inline-flex whitespace-nowrap rounded-full bg-hover px-2 text-[13px] text-text-2" data-testid="temps-non-valorise">
					{montants.length === 0
						? t('time.report.unvalued')
						: t('time.report.unvaluedPart', { duree: formaterDuree(enHeures(cumul.minutesNonValorisees)) })}
				</span>
			) : null}
		</span>
	)
}

/**
 * La marque d'une ligne d'affaire partagée (§5.54) : la forme exacte de « partielle » (§5.60) — point neutre, aucune
 * icône —, son nom accessible disant pourquoi. Elle ne nomme ni le nombre ni les autres channels (§5.33).
 */
export function PilulePartagee({ raison }: { readonly raison?: string } = {}) {
	// `CRM-111` T5.2 : « Rentabilité » réemploie la pilule avec sa propre raison (docs/DESIGN_SYSTEM.md §5.60).
	const nom = raison ?? t('time.report.shared.aria')
	return (
		<span
			role="img"
			aria-label={nom}
			title={nom}
			className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-hover px-2 text-xs text-text-2"
			data-testid="temps-partagee"
		>
			<span aria-hidden="true" className="inline-block size-2 rounded-full bg-text-3" />
			<span aria-hidden="true">{t('time.report.shared')}</span>
		</span>
	)
}

/** La mention sous un tableau dont le total compte une fois ce que plusieurs lignes montrent (§5.54, §5.30). */
export function MentionPartagee() {
	return (
		<p className="text-sm text-text-2" data-testid="temps-partagee-mention">
			{t('time.report.shared.note')}
		</p>
	)
}

export type ProprietesRapportTemps = {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly idUtilisateur: string
	readonly estAdmin: boolean
	readonly aujourdhui: string
}

type Donnees = { readonly sections: readonly SectionRapport[]; readonly noms: Noms }

export function RapportTemps({ client, idWorkspace, idUtilisateur, estAdmin, aujourdhui }: ProprietesRapportTemps) {
	const { mois, moisCourant, allerA } = useMoisDeLAdresse(aujourdhui)
	const [personne, setPersonne] = useState<string>(idUtilisateur)
	const [membres, setMembres] = useState<readonly MembreAffectable[]>([])
	const [etat, setEtat] = useState<EtatAsync<Donnees>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		if (!estAdmin) return
		let courant = true
		void lireMembresAffectables(client, idWorkspace).then((resultat) => {
			if (courant && resultat.statut === 'pret') setMembres(resultat.donnees)
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, estAdmin])

	useEffect(() => {
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const { debut, fin } = bornesDuMois(mois)
			const lignes = await lireTempsValorise(client, debut, fin, personne === EQUIPE ? {} : { profil: personne })
			if (!courant) return
			if (lignes.statut !== 'pret') return setEtat(lignes)
			const noms = await lireNoms(client, idsANommer(lignes.donnees))
			if (!courant) return
			if (noms.statut !== 'pret') return setEtat(noms)
			const nommer = (genre: 'track' | 'channel' | 'card', id: string) =>
				(genre === 'track' ? noms.donnees.tracks : genre === 'channel' ? noms.donnees.channels : noms.donnees.cards).get(id) ?? ''
			setEtat({ statut: 'pret', donnees: { sections: composerRapport(lignes.donnees, nommer), noms: noms.donnees } })
		})()
		return () => {
			courant = false
		}
	}, [client, mois, personne, tentative])

	return (
		<div className="flex flex-col gap-4" data-testid="temps-rapport">
			<div className="flex flex-wrap items-end gap-4">
				<NavigationMois mois={mois} moisCourant={moisCourant} allerA={allerA} titre testId="temps-rapport-mois" />
				{estAdmin ? (
					<label className="flex flex-col gap-1 text-sm text-text-2">
						{t('time.report.person')}
						<select
							value={personne}
							onChange={(e) => setPersonne(e.target.value)}
							data-testid="temps-rapport-personne"
							className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
						>
							<option value={idUtilisateur}>{t('time.for.me')}</option>
							{membres
								.filter((m) => m.id !== idUtilisateur)
								.map((m) => (
									<option key={m.id} value={m.id}>
										{m.nom}
									</option>
								))}
							<option value={EQUIPE}>{t('time.report.team')}</option>
						</select>
					</label>
				) : null}
			</div>

			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<EtatErreur
					titre={t('state.error.title')}
					corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : etat.donnees.sections.length === 0 ? (
				<EtatVide titre={t('time.report.empty.title', { mois: libelleMois(mois) })} corps={t('time.report.empty.body')} />
			) : (
				etat.donnees.sections.map((section) => (
					<section key={section.profil} className="flex flex-col gap-2" data-testid="temps-rapport-section">
						{personne === EQUIPE ? (
							<h3 className="text-h3">{etat.donnees.noms.profils.get(section.profil) ?? t('time.report.unnamedPerson')}</h3>
						) : null}
						<TableauRapport section={section} noms={etat.donnees.noms} />
						{section.partagee ? <MentionPartagee /> : null}
					</section>
				))
			)}
		</div>
	)
}

const RETRAITS = ['pl-3 font-medium', 'pl-6', 'pl-[36px]'] as const

function libelleLigne(ligne: LigneRapport, noms: Noms): string {
	const id = ligne.card_id ?? ligne.channel_id ?? ligne.track_id
	const carte = ligne.card_id !== null ? noms.cards : ligne.channel_id !== null ? noms.channels : noms.tracks
	return (id === null ? undefined : carte.get(id)) ?? t('time.report.unnamed')
}

/**
 * Le chemin d'une ligne d'affaire partagée (§5.54) : ses lignes sous chaque channel portent le même nom, et le rapport
 * ne rend un track ou un channel que s'il porte du temps direct — sans ce chemin, deux lignes identiques se suivent.
 */
function cheminLigne(ligne: LigneRapport, noms: Noms): string {
	const nom = (carte: ReadonlyMap<string, string>, id: string | null) =>
		(id === null ? undefined : carte.get(id)) ?? t('time.report.unnamed')
	return t('time.report.shared.path', { track: nom(noms.tracks, ligne.track_id), channel: nom(noms.channels, ligne.channel_id) })
}

function TableauRapport({ section, noms }: { readonly section: SectionRapport; readonly noms: Noms }) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border indique-debordement-x">
			<table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
						{/* Colonnes FIXES : les sections de « Toute l'équipe » s'alignent d'un tableau à l'autre (constaté sur la
						    capture : chaque tableau calculait ses propres largeurs). */}
						<colgroup>
							<col />
							<col className="w-[14ch]" />
							<col className="w-[28ch]" />
						</colgroup>
				<thead className="bg-surface">
					<tr className="border-b border-border">
						<th scope="col" className="px-3 py-2 text-left font-medium">
							{t('time.matrix.target')}
						</th>
						<th scope="col" className="px-3 py-2 text-right font-medium">
							{t('time.report.time')}
						</th>
						<th scope="col" className="px-3 py-2 text-right font-medium">
							{t('time.report.cost')}
						</th>
					</tr>
				</thead>
				<tbody>
					{section.lignes.map((ligne) => (
						<tr key={ligne.cle} className="border-b border-border" data-testid="temps-rapport-ligne">
							<th scope="row" className={`py-2 pr-3 text-left font-normal ${RETRAITS[ligne.niveau]}`}>
								{ligne.partagee ? (
									<span className="inline-flex flex-wrap items-center gap-2">
										<span>{libelleLigne(ligne, noms)}</span>
										<span className="text-sm text-text-2" data-testid="temps-partagee-chemin">
											{cheminLigne(ligne, noms)}
										</span>
										<PilulePartagee />
									</span>
								) : (
									libelleLigne(ligne, noms)
								)}
							</th>
							<td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formaterDuree(enJours(ligne.cumul.minutes))}</td>
							<td className="px-3 py-2 text-right tabular-nums">
								<CelluleCout cumul={ligne.cumul} />
							</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row" className="px-3 py-2 text-left font-medium">
							{t('time.report.total')}
						</th>
						<td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums" data-testid="temps-rapport-total">
							{formaterDuree(enJours(section.total.minutes))}
						</td>
						<td className="px-3 py-2 text-right font-medium tabular-nums">
							<CelluleCout cumul={section.total} />
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	)
}
