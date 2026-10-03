// @spec CRM-097 (docs/BACKLOG.md) — tranche T3.c : ce qu'une suggestion change à un workflow existant, et où vont les
//       affaires des étapes qu'elle retire
// @spec docs/SPEC-ia.md §13.6 (le différentiel en tête de l'aperçu ; les affaires des étapes retirées : leur nombre,
//       un `select` ouvert sur « Aucune destination », jamais présélectionné ; choisir écrit le remappage) ;
//       docs/DESIGN_SYSTEM.md §5.53 (une section par collection, « Ajouté » / « Retiré » / « Modifié » de la
//       comparaison de versions réemployés, « Retiré — archivé » pour un champ, le nom du workflow, l'attribut nommé
//       par un mot, une étape retirée vide qui ne paraît pas), §5.15, §8, §10 ; décision 620
//
// Composants de présentation : ils ne lisent rien et ne décident de rien. Le différentiel vient de
// `lib/differentiel-ia.ts`, et le panneau tient le brouillon où un choix de destination s'écrit.

import { useId } from 'react'
import { LigneElement } from './CollectionsComparees'
import { libelleType, libelleVisibilite } from './ApercuPropositionIa'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import {
	COLLECTIONS_DIFFERENTIEL,
	type AttributChange,
	type Changement,
	type CodeAttribut,
	type CollectionDifferentiel,
	type EtapeRetireeOccupee,
	type ValeurAttribut,
} from '../lib/differentiel-ia'
import type { ElementCompare } from '../lib/versions-workflow'

// Clés écrites en toutes lettres, jamais composées (contrôle des clés mortes de `i18n.test.ts`).
const TITRES: Readonly<Record<CollectionDifferentiel, CleTraduction>> = {
	workflow: 'ia.differentiel.workflow',
	etapes: 'ia.apercu.etapes',
	transitions: 'ia.apercu.transitions',
	champs: 'ia.apercu.champs',
	regles: 'ia.apercu.regles',
	exigences: 'ia.apercu.exigences',
}

const ATTRIBUTS: Readonly<Record<CodeAttribut, CleTraduction>> = {
	nom: 'ia.differentiel.attribut.nom',
	initiale: 'ia.differentiel.attribut.initiale',
	rang: 'ia.differentiel.attribut.rang',
	libelle: 'ia.differentiel.attribut.libelle',
	commentaire_requis: 'ia.differentiel.attribut.commentaire_requis',
	type: 'ia.differentiel.attribut.type',
	choix: 'ia.differentiel.attribut.choix',
	devise: 'ia.differentiel.attribut.devise',
	aide: 'ia.differentiel.attribut.aide',
	visibilite: 'ia.differentiel.attribut.visibilite',
}

export type Nommage = { readonly etape: (cle: string) => string; readonly champ: (cle: string) => string }

/** Une valeur d'attribut en mots : `null` est rendu « aucune valeur » par la ligne (§5.15). */
function valeurEnMots(code: CodeAttribut, valeur: ValeurAttribut): string | null {
	if (valeur === null) return null
	if (typeof valeur === 'boolean') return valeur ? t('ia.differentiel.oui') : t('ia.differentiel.non')
	if (typeof valeur === 'number') return String(valeur)
	if (Array.isArray(valeur)) return valeur.length === 0 ? null : valeur.join(', ')
	if (code === 'libelle' && valeur === '') return t('ia.apercu.libelle.arrivee')
	if (code === 'type') return libelleType(valeur as string)
	if (code === 'visibilite') return libelleVisibilite(valeur as string)
	return valeur as string
}

function nomDuChangement(changement: Changement, noms: Nommage): string {
	const objet = changement.objet
	switch (objet.collection) {
		case 'workflow':
			return t('ia.differentiel.nom_workflow')
		case 'etapes':
			return noms.etape(objet.cle)
		case 'transitions':
			return t('ia.apercu.transition.nom', { de: noms.etape(objet.de), vers: noms.etape(objet.vers) })
		case 'champs':
			return noms.champ(objet.cle)
		case 'regles':
			return t('ia.apercu.regle', { champ: noms.champ(objet.champ), etape: noms.etape(objet.etape) })
		case 'exigences':
			return t('ia.apercu.exigence', { de: noms.etape(objet.de), vers: noms.etape(objet.vers), champ: noms.champ(objet.champ) })
	}
}

/** Le changement dans la forme des lignes de la comparaison de versions, réemployées sans copie (§5.53). */
function enElement(changement: Changement, rang: number, noms: Nommage): ElementCompare {
	return {
		genre: changement.genre,
		cle: `${changement.objet.collection}#${rang}`,
		nom: { genre: 'libelle', texte: nomDuChangement(changement, noms) },
		attributs: changement.attributs.map((a: AttributChange) => ({
			nom: t(ATTRIBUTS[a.code]),
			avant: valeurEnMots(a.code, a.avant),
			apres: valeurEnMots(a.code, a.apres),
		})),
	}
}

/**
 * « Ce qui change » : une section par collection qui change, dans l'ordre de l'éditeur ; une collection sans
 * changement se tait, et aucun changement du tout se dit en une phrase (§5.53).
 */
export function DifferentielIa({ changements, noms }: { readonly changements: readonly Changement[]; readonly noms: Nommage }) {
	const idTitre = useId()
	return (
		<section aria-labelledby={idTitre} data-testid="ia-differentiel" className="flex flex-col gap-2">
			<h3 id={idTitre}>{t('ia.differentiel.titre')}</h3>
			{changements.length === 0 ? (
				<p className="text-sm text-text-2">{t('ia.differentiel.aucun')}</p>
			) : (
				<ul className="flex flex-col gap-3 rounded-lg border border-border px-3 py-2">
					{COLLECTIONS_DIFFERENTIEL.map((collection) => {
						const lignes = changements.map((c, rang) => ({ c, rang })).filter(({ c }) => c.objet.collection === collection)
						if (lignes.length === 0) return null
						return (
							<li key={collection} className="flex flex-col gap-1" data-testid={`ia-differentiel-${collection}`}>
								<h4 className="text-sm font-medium text-text-2">{t(TITRES[collection])}</h4>
								<ul className="flex flex-col">
									{lignes.map(({ c, rang }) => (
										<LigneElement
											key={rang}
											element={enElement(c, rang, noms)}
											{...(c.genre === 'retrait' && c.objet.collection === 'champs'
												? { libelleGenre: t('ia.differentiel.retire_archive') }
												: {})}
										/>
									))}
								</ul>
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}

/**
 * « Où vont les affaires des étapes retirées » : une ligne par étape retirée qui en porte, leur nombre par clé, et
 * un `select` ouvert sur « Aucune destination » — jamais présélectionné, aucune destination n'est devinée (§5.53).
 */
export function RemappagesIa({
	lignes,
	destinations,
	noms,
	desactive,
	onChoisir,
}: {
	readonly lignes: readonly EtapeRetireeOccupee[]
	/** Les étapes de la cible : seules destinations possibles. */
	readonly destinations: readonly string[]
	readonly noms: Nommage
	readonly desactive: boolean
	readonly onChoisir: (de: string, vers: string | null) => void
}) {
	const idTitre = useId()
	if (lignes.length === 0) return null
	return (
		<section aria-labelledby={idTitre} data-testid="ia-remappages" className="flex flex-col gap-2">
			<h3 id={idTitre}>{t('ia.remappage.titre')}</h3>
			<ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
				{lignes.map((ligne) => {
					const nom = noms.etape(ligne.cle)
					return (
						<li key={ligne.cle} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="ia-remappage">
							<span className="min-w-0 flex-1 basis-[12rem] font-medium">{nom}</span>
							<span className="text-sm text-text-2">
								{ligne.affaires === 1
									? t('ia.remappage.affaires.un')
									: t('ia.remappage.affaires.plusieurs', { nombre: String(ligne.affaires) })}
							</span>
							<label className="inline-flex flex-wrap items-center gap-2 text-sm text-text-2">
								<span aria-hidden="true">{t('ia.remappage.destination')}</span>
								<select
									aria-label={t('ia.remappage.destination.de', { etape: nom })}
									value={ligne.destination ?? ''}
									disabled={desactive}
									onChange={(e) => onChoisir(ligne.cle, e.target.value === '' ? null : e.target.value)}
									className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
								>
									<option value="">{t('ia.remappage.aucune')}</option>
									{/* Une destination que la cible n'a plus reste montrée : la base dira qu'elle est absente. */}
									{ligne.destination !== null && !destinations.includes(ligne.destination) ? (
										<option value={ligne.destination}>{ligne.destination}</option>
									) : null}
									{destinations.map((cle) => (
										<option key={cle} value={cle}>
											{noms.etape(cle)}
										</option>
									))}
								</select>
							</label>
						</li>
					)
				})}
			</ul>
		</section>
	)
}
