// @spec CRM-070 (docs/BACKLOG.md) — tranche T4 : les droits fins d'un membre, par track et par channel, et l'accès qui en
//       résulte ; docs/SPEC-membres.md §3.3 (hérité, membre, lecture, aucun accès ; l'accès effectif calculé par la base,
//       jamais à l'écran ; un administrateur n'est jamais restreint), §5 point 1 ; docs/SPEC-permissions-rls.md §3.3,
//       §3.3 bis
// @spec docs/DESIGN_SYSTEM.md §5.61 (la matrice des droits fins), §5.9 (tableaux), §5.7 ter (écrit au choix), §5.27
//       (message sous le tableau), §5.29 tranche 2 c (la relecture garde la liste)
// @spec CLAUDE.md §10 — la matrice ne décide aucun droit : elle pose une ligne, la politique décide, la base recalcule
//
// L'ACCÈS EFFECTIF EST RELU APRÈS CHAQUE ÉCRITURE, JAMAIS DÉDUIT : « le plus spécifique gagne » vit dans les fonctions de
// la RLS, et `acces_effectif_membre` les appelle. Recalculer ici créerait une seconde règle, qui finirait par mentir.

import { useEffect, useState } from 'react'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	lireDroitsFins,
	poserDroitFin,
	type AccesEffectif,
	type AccesPose,
	type DroitFin,
	type MotifRefusMembre,
} from '../lib/membres-espace'
import type { ClientCrm } from '../lib/supabase'
import { BlocMessage, CLASSES_CHAMP, CLASSES_ENTETE, Champ, type Message } from './TableauMembres'

/** Un membre que la matrice peut montrer. */
export type MembreDroits = { readonly idUtilisateur: string; readonly nom: string; readonly administrateur: boolean }

const VALEUR_HERITE = 'herite'
const CHOIX: readonly { readonly valeur: AccesPose | typeof VALEUR_HERITE; readonly cle: CleTraduction }[] = [
	{ valeur: VALEUR_HERITE, cle: 'members.rights.posed.inherited' },
	{ valeur: 'member', cle: 'members.rights.posed.member' },
	{ valeur: 'viewer', cle: 'members.rights.posed.viewer' },
	{ valeur: 'none', cle: 'members.rights.posed.none' },
]
const EFFECTIF: Readonly<Record<AccesEffectif, CleTraduction>> = {
	write: 'members.rights.effective.write',
	read: 'members.rights.effective.read',
	none: 'members.rights.effective.none',
}

const libelleChoix = (valeur: AccesPose | typeof VALEUR_HERITE) => t(CHOIX.find((choix) => choix.valeur === valeur)!.cle)

/** Le premier membre qui n'administre pas — le seul dont la matrice restreint quelque chose —, ou le premier. */
function membreParDefaut(membres: readonly MembreDroits[]): string | null {
	return (membres.find((membre) => !membre.administrateur) ?? membres[0])?.idUtilisateur ?? null
}

export function DroitsFins({
	client,
	idWorkspace,
	membres,
	texteRefus,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly membres: readonly MembreDroits[]
	readonly texteRefus: (motif: MotifRefusMembre) => string
}) {
	const [choisi, setChoisi] = useState<string | null>(() => membreParDefaut(membres))
	const [etat, setEtat] = useState<EtatAsync<readonly DroitFin[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [enVol, setEnVol] = useState<string | null>(null)
	const [message, setMessage] = useState<Message>(null)

	// Un membre retiré entre-temps n'est plus choisi : la matrice passe au membre par défaut.
	const idMembre = choisi !== null && membres.some((membre) => membre.idUtilisateur === choisi) ? choisi : membreParDefaut(membres)
	const membre = membres.find((candidat) => candidat.idUtilisateur === idMembre) ?? null

	useEffect(() => {
		if (idMembre === null) return
		let courant = true
		void lireDroitsFins(client, idWorkspace, idMembre).then((resultat) => {
			if (courant) setEtat(resultat)
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, idMembre, tentative])

	if (membre === null) return null

	const choisir = (id: string) => {
		setChoisi(id)
		setMessage(null)
		setEtat(enChargement())
	}

	const poser = async (droit: DroitFin, valeur: string) => {
		const acces = valeur === VALEUR_HERITE ? null : (valeur as AccesPose)
		setEnVol(droit.id)
		const issue = await poserDroitFin(client, droit.objet, droit.id, membre.idUtilisateur, acces)
		setEnVol(null)
		setMessage(
			issue.ok
				? {
						ton: 'succes',
						texte: t('members.rights.changed', { nom: membre.nom, objet: droit.nom, droit: libelleChoix(acces ?? VALEUR_HERITE) }),
					}
				: { ton: 'refus', texte: texteRefus(issue.motif) },
		)
		setTentative((n) => n + 1)
	}

	return (
		<section aria-labelledby="titre-droits" className="flex flex-col gap-4" data-testid="droits-fins">
			<h3 id="titre-droits" className="text-h3">
				{t('members.rights.title')}
			</h3>
			<p className="max-w-[72ch] text-sm text-text-2">{t('members.rights.intro')}</p>
			<div className="max-w-[40ch]">
				<Champ id="droits-membre" libelle={t('members.rights.member')}>
					<select id="droits-membre" value={membre.idUtilisateur} onChange={(e) => choisir(e.target.value)} className={CLASSES_CHAMP}>
						{membres.map((candidat) => (
							<option key={candidat.idUtilisateur} value={candidat.idUtilisateur}>
								{candidat.nom}
							</option>
						))}
					</select>
				</Champ>
			</div>
			{membre.administrateur && (
				<p className="max-w-[72ch] text-sm text-text-2" data-testid="droits-administrateur">
					{t('members.rights.admin')}
				</p>
			)}
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<EtatErreur
					titre={t('state.error.title')}
					corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : etat.donnees.length === 0 ? (
				<p className="text-text-2" data-testid="droits-vide">
					{t('members.rights.empty')}
				</p>
			) : (
				<div className="overflow-x-auto indique-debordement-x" aria-busy={enVol !== null}>
					<table data-testid="tableau-droits" className="w-full border-collapse">
						<caption className="sr-only">{t('members.rights.caption', { nom: membre.nom })}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('members.rights.column.object')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('members.rights.column.posed')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('members.rights.column.effective')}</th>
							</tr>
						</thead>
						<tbody>
							{etat.donnees.map((droit) => (
								<tr key={droit.id} data-testid="ligne-droit" data-objet={droit.objet} data-id={droit.id} className="border-b border-border hover:bg-hover">
									<th
										scope="row"
										className={`h-[var(--size-target)] px-3 text-left font-normal ${droit.objet === 'track' ? 'font-medium' : 'pl-8'}`}
									>
										{droit.nom}
										{droit.archive && <span className="ml-2 text-sm text-text-3">{t('members.rights.archived')}</span>}
									</th>
									<td className="h-[var(--size-target)] px-3">
										<select
											value={droit.pose ?? VALEUR_HERITE}
											aria-label={t('members.rights.posed.aria', { objet: droit.nom })}
											disabled={membre.administrateur || enVol !== null}
											onChange={(e) => void poser(droit, e.target.value)}
											className={CLASSES_CHAMP}
										>
											{CHOIX.map((choix) => (
												<option key={choix.valeur} value={choix.valeur}>
													{t(choix.cle)}
												</option>
											))}
										</select>
									</td>
									<td className="h-[var(--size-target)] px-3" data-testid="acces-effectif">
										{t(EFFECTIF[droit.effectif])}
										{droit.objet === 'track' && droit.effectif === 'none' && droit.lisibleParUnChannel === true && (
											<span className="block text-sm text-text-2">{t('members.rights.readableByChannel')}</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<BlocMessage message={message} testId="message-droits" />
		</section>
	)
}
