// @spec CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, geste d'interface de la
//       comparaison copie ↔ source
// @spec CRM-078 (docs/BACKLOG.md) — cinquième tranche : les écrans du versionnement, dont ce
//       rendu est extrait sans changer ce qu'il produit
// @spec docs/SPEC-workflow-engine.md §4 quater.4 (les collections rendues, une collection vide
//       nommée), §4 quater.5 (comment un élément est nommé, et les quatre replis),
//       §7 ter.14.6 (nommer un élément sans l'inventer, d'où ces replis viennent)
// @spec docs/DESIGN_SYSTEM.md §5.15 (un ajout, un retrait et une modification se distinguent par un
//       mot et jamais par une seule teinte ; un attribut modifié s'écrit « avant → après » ; une
//       collection vide est nommée), §1 (la couleur ne porte jamais seule le sens),
//       §9 (icônes Lucide décoratives), §10 (aucun texte en dur, aucune concaténation)
//
// POURQUOI CE FICHIER EXISTE. Le produit compare deux fois : deux versions publiées d'un même
// workflow (`CRM-078`, §7 ter.14) et une copie avec sa source vivante (`CRM-032`, §4 quater). Les
// deux rendent EXACTEMENT la même forme de `changes` — mesuré, §4 quater.5 — et se rendaient donc
// à l'identique. Ce rendu vivait en privé dans `BlocVersionsWorkflow` ; le recopier dans la mention
// de divergence aurait posé deux écrans qui divergent au premier ajustement visuel. C'est le même
// motif qui a fait extraire `app.composition_collection_diff` côté base (§4 ter.4) et
// `composerCollections` côté module.
//
// CE FICHIER NE DÉCIDE DE RIEN. Il ne lit aucune donnée, n'appelle aucune fonction et ne calcule
// aucun droit : il rend ce que le module lui donne déjà mis en forme.

import { Minus, Pencil, Plus } from 'lucide-react'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import type { ElementCompare, NomElement } from '../lib/versions-workflow'

const ICONES_GENRE = { ajout: Plus, retrait: Minus, modification: Pencil } as const

const TONS_GENRE = {
	ajout: 'bg-success-soft text-success-on-soft',
	retrait: 'bg-danger-soft text-danger-on-soft',
	modification: 'bg-hover text-text-2',
} as const

const CLES_GENRE: Readonly<Record<ElementCompare['genre'], CleTraduction>> = {
	ajout: 'admin.workflows.versions.change.ajout',
	retrait: 'admin.workflows.versions.change.retrait',
	modification: 'admin.workflows.versions.change.modification',
}

/** Le nom d'un élément comparé, dans les trois formes que le module peut rendre (§7 ter.14.6). */
export function NomCompare({ nom }: { readonly nom: NomElement }) {
	if (nom.genre === 'libelle') return <span className="font-medium">{nom.texte}</span>
	if (nom.genre === 'renomme') {
		return (
			<span className="font-medium">
				{t('admin.workflows.versions.renamed', { avant: nom.avant, apres: nom.apres })}
			</span>
		)
	}
	// Dernier repli : les identifiants, en `code`. Mieux vaut un identifiant qu'une phrase à trou.
	return (
		<span className="flex flex-wrap gap-1">
			{nom.valeurs.map((valeur) => (
				<code key={valeur} className="rounded-sm bg-hover px-1 text-sm">
					{valeur}
				</code>
			))}
		</span>
	)
}

export function LigneElement({ element }: { readonly element: ElementCompare }) {
	const Icone = ICONES_GENRE[element.genre]
	return (
		<li className="flex flex-col gap-1 py-1">
			<span className="flex flex-wrap items-center gap-2">
				<span
					className={[
						'inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium',
						TONS_GENRE[element.genre],
					].join(' ')}
				>
					<Icone aria-hidden="true" size={14} strokeWidth={2} />
					{t(CLES_GENRE[element.genre])}
				</span>
				<NomCompare nom={element.nom} />
			</span>
			{element.attributs.length > 0 ? (
				<ul className="flex flex-col gap-1 pl-4 text-sm text-text-2">
					{element.attributs.map((attribut) => (
						<li key={attribut.nom}>
							{t('admin.workflows.versions.attribute', {
								attribut: attribut.nom,
								avant: attribut.avant ?? t('admin.workflows.versions.value.none'),
								apres: attribut.apres ?? t('admin.workflows.versions.value.none'),
							})}
						</li>
					))}
				</ul>
			) : null}
		</li>
	)
}

export type CollectionRendue<C extends string> = {
	readonly cle: C
	readonly elements: readonly ElementCompare[]
}

/**
 * Les collections d'une comparaison, dans l'ordre que l'appelant impose.
 *
 * L'ORDRE ET LA LISTE VIENNENT DE L'APPELANT, ET C'EST TOUTE LA GÉNÉRICITÉ DE CE COMPOSANT : la
 * comparaison de versions en rend **six**, celle de la copie à sa source en rend **cinq** — la
 * collection `workflow` étant exclue du document naturalisé (§4 ter.3), l'en-tête n'étant pas ce
 * que la copie copie. Rendre ici une liste figée obligerait l'un des deux écrans à afficher un
 * intitulé toujours vide, ce que le §4 quater.4 refuse explicitement.
 *
 * UNE COLLECTION VIDE EST NOMMÉE (`docs/DESIGN_SYSTEM.md` §5.15) : une liste vide se lirait comme un
 * défaut de chargement. Lorsque les deux côtés sont identiques, l'appelant n'affiche pas ce bloc du
 * tout — il n'y a rien à parcourir.
 */
export function ListeCollections<C extends string>({
	collections,
	ordre,
	libelles,
	marqueur,
}: {
	readonly collections: readonly CollectionRendue<C>[]
	readonly ordre: readonly C[]
	readonly libelles: Readonly<Record<C, CleTraduction>>
	readonly marqueur: string
}) {
	return (
		<ul data-testid={marqueur} className="flex flex-col gap-3">
			{ordre.map((cle) => {
				const collection = collections.find((entree) => entree.cle === cle)
				const elements = collection?.elements ?? []
				return (
					<li key={cle} className="flex flex-col gap-1">
						<h5 className="font-medium">{t(libelles[cle])}</h5>
						{elements.length === 0 ? (
							<p className="text-sm text-text-2">{t('admin.workflows.versions.compare.empty')}</p>
						) : (
							<ul className="flex flex-col">
								{elements.map((element) => (
									<LigneElement key={element.cle} element={element} />
								))}
							</ul>
						)}
					</li>
				)
			})}
		</ul>
	)
}
