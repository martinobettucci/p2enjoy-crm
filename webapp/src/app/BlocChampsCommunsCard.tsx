// @spec CRM-112 (docs/BACKLOG.md) — tranche T8 : l'arrivée sur un champ demandé attend que la partie commune ait fini sa
//       lecture — le bloc, au-dessus, repoussait sinon le champ hors de la fenêtre (docs/DESIGN_SYSTEM.md §5.88, §5.7 quater ;
//       docs/SPEC-form-composer.md §4 ter.6 ; décision 856)
// @spec CRM-112 (docs/BACKLOG.md) — tranche T3.c : la partie commune de la fiche — les champs de l'affaire, éditables par qui
//       écrit l'affaire, l'archivé porteur d'une valeur en lecture, le champ demandé par un déplacement refusé
// @spec docs/SPEC-champs-communs.md §3.3 (une valeur par affaire), §4 (lecture et écriture), §5, §7 (précision T3.c) ;
//       docs/DESIGN_SYSTEM.md §5.88 (le bloc), §5.7 à §5.7 quater (le champ, réemployé), §5.59 (capacité de l'affaire),
//       §5.8 (états), §5.36 (un bloc sans objet n'est pas rendu)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la RLS de `card_common_field_values` juge chaque écriture, et son
//       refus est traduit sous le champ
//
// Le bloc lit lui-même ce qu'il rend — les champs de l'espace et les valeurs de l'affaire — : la fiche n'en dépend pas, et
// un échec n'atteint que lui. Chaque champ est le `ChampSaisie` du formulaire d'étape, avec ses contrôles et ses états.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { useRefus } from '../components/ui/RefusCommandes'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import { composerPartieCommune, ecrireValeurCommune, lireChampsCommunsEspace, lireValeursCommunes, type PartieCommune } from '../lib/champs-communs'
import type { Json } from '../lib/database.types'
import { resoudreApresEcriture, type ChampResolu } from '../lib/formulaire'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { ChampSaisie, INACTIF, useListesReference, ValeurLectureSeule, type EtatEcriture } from './FormulaireCard'

export type ProprietesBlocChampsCommuns = {
	readonly idCard: string
	readonly idWorkspace: string
	/** Les clés qu'un déplacement refusé a demandées (`exiges`) : celles des champs communs y sont mises en évidence. */
	readonly clesExigees: readonly string[]
	/** Le focus n'est pris ici que si le formulaire d'étape n'a aucun champ demandé (§5.88 : un seul focus par demande). */
	readonly focaliser: boolean
	/**
	 * `CRM-112` T8 : appelé quand la lecture du bloc est terminée — rendu, vide ou en erreur. Le bloc vit AU-DESSUS du
	 * formulaire et de la checklist, et sa hauteur ne se connaît qu'alors : leur arrivée sur un champ demandé l'attend.
	 */
	readonly onLu?: () => void
	readonly client?: ClientCrm | null
}

export function BlocChampsCommunsCard({ idCard, idWorkspace, clesExigees, focaliser, onLu, client = clientCrm }: ProprietesBlocChampsCommuns) {
	const droit = useRefus()
	const [partie, setPartie] = useState<EtatAsync<PartieCommune>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [etats, setEtats] = useState<Readonly<Record<string, EtatEcriture>>>({})
	const signatureExigees = clesExigees.join(',')

	useEffect(() => {
		if (client === null) return
		let vivant = true
		void Promise.all([lireChampsCommunsEspace(client, idWorkspace), lireValeursCommunes(client, idCard)]).then(([champs, valeurs]) => {
			if (!vivant) return
			if (champs.statut === 'erreur') return setPartie(champs)
			if (valeurs.statut === 'erreur') return setPartie(valeurs)
			if (champs.statut === 'pret' && valeurs.statut === 'pret') {
				setPartie({ statut: 'pret', donnees: composerPartieCommune(champs.donnees, valeurs.donnees, signatureExigees === '' ? [] : signatureExigees.split(',')) })
			}
		})
		return () => {
			vivant = false
		}
	}, [client, idWorkspace, idCard, signatureExigees, tentative])

	// `CRM-112` T8 : la fin de la lecture, signalée à la fiche ; la relecture après une écriture ne repasse pas par le
	// chargement, et ne la signale donc pas une seconde fois.
	const lectureTerminee = partie.statut !== 'chargement'
	useEffect(() => {
		if (lectureTerminee) onLu?.()
	}, [lectureTerminee, onLu])

	const donnees = partie.statut === 'pret' ? partie.donnees : null
	const rendus = donnees === null ? [] : [...donnees.actifs, ...donnees.archives]
	const { listes, relancer } = useListesReference(
		client,
		idWorkspace,
		rendus.some((r) => r.champ.type === 'contact'),
		rendus.some((r) => r.champ.type === 'user'),
	)

	// Le focus sur le premier champ commun demandé, UNE fois par demande, et seulement si le formulaire d'étape n'en a pas.
	const demandeHonoree = useRef<string | null>(null)
	const premiere = donnees?.clesExigeesRetenues[0]
	useEffect(() => {
		if (!focaliser || premiere === undefined || demandeHonoree.current === signatureExigees) return
		if (droit.disabled === true && droit['aria-describedby'] === undefined) return
		demandeHonoree.current = signatureExigees
		const controle = document.getElementById(`commun-${premiere}`)
		controle?.focus()
		if (controle !== null && typeof controle.scrollIntoView === 'function') controle.scrollIntoView({ block: 'center' })
	}, [focaliser, premiere, signatureExigees, droit])

	const enregistrer = useCallback(
		async (resolu: ChampResolu, valeur: Json) => {
			if (client === null) return
			const id = resolu.champ.id
			setEtats((precedents) => ({ ...precedents, [id]: { phase: 'envoi' } }))
			const resultat = await ecrireValeurCommune(client, { idCard, idChamp: id, idWorkspace, valeur })
			if (resultat.statut === 'enregistree') {
				setPartie((precedente) =>
					precedente.statut !== 'pret'
						? precedente
						: {
								statut: 'pret',
								donnees: {
									...precedente.donnees,
									actifs: precedente.donnees.actifs.map((r) => (r.champ.id === id ? resoudreApresEcriture(r, valeur) : r)),
								},
							},
				)
				setEtats((precedents) => ({ ...precedents, [id]: { phase: 'enregistre' } }))
				return
			}
			setEtats((precedents) => ({ ...precedents, [id]: { phase: 'refus', nature: resultat.refus.nature } }))
		},
		[client, idCard, idWorkspace],
	)

	// Un bloc sans objet n'est pas rendu (§5.36) : ni champ actif, ni archivé porteur d'une valeur.
	if (donnees !== null && rendus.length === 0) return null

	return (
		<section aria-labelledby="champs-communs-titre" data-testid="bloc-champs-communs" className="flex flex-col gap-3 border-t border-border pt-6">
			<header className="flex flex-col gap-1">
				<h2 id="champs-communs-titre" className="text-h3">
					{t('card.commonFields.title')}
				</h2>
				<p className="text-sm text-text-2">{t('card.commonFields.intro')}</p>
			</header>
			{partie.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('card.commonFields.loading')} />
			) : partie.statut === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
					<span>{t('card.commonFields.error')}</span>
					<Button variante="secondaire" taille="compacte" onClick={() => setTentative((n) => n + 1)}>
						{t('state.error.retry')}
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{partie.donnees.actifs.map((resolu) => (
						<ChampSaisie
							key={resolu.champ.id}
							prefixeId="commun"
							resolu={resolu}
							etape=""
							etat={etats[resolu.champ.id] ?? INACTIF}
							ecrituresPossibles={client !== null && droit.disabled !== true}
							motifRefus={droit['aria-describedby']}
							listes={listes}
							onReprise={relancer}
							onEnregistrer={enregistrer}
						/>
					))}
					{partie.donnees.archives.length === 0 ? null : (
						<dl className="flex flex-col gap-2" data-testid="champs-communs-archives">
							{partie.donnees.archives.map((resolu) => (
								<div key={resolu.champ.id} data-testid={`commun-archive-${resolu.champ.key}`} className="flex flex-col">
									<dt className="flex flex-wrap items-center gap-2 text-sm text-text-2">
										{resolu.champ.label}
										<span className="rounded-full bg-hover px-2 text-xs text-text-2">{t('card.commonFields.archived')}</span>
									</dt>
									<dd className="text-base text-text">
										<ValeurLectureSeule resolu={resolu} listes={listes} />
									</dd>
								</div>
							))}
						</dl>
					)}
				</div>
			)}
		</section>
	)
}
