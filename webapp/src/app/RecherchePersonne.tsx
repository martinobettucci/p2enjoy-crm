// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : chercher une personne connue, pour l'ajouter à un espace ou lui
//       accorder le drapeau
// @spec docs/SPEC-plateforme.md §6.3 (« Qui peut être posé comme membre ? »), §6.5 (`plateforme_profils`) ;
//       docs/DESIGN_SYSTEM.md §5.56, §5.22 (`select` natif, option vide en tête, quatre états), §5.21 (la liste n'offre
//       que ce qui n'aboutirait pas à un refus certain)
//
// Le CRM ne conserve aucune adresse : une personne se cherche par son NOM, et une personne jamais venue n'a pas de
// profil — le texte d'aide renvoie alors à l'inscription d'une attente.

import { useEffect, useId, useState, type Ref } from 'react'
import { t } from '../i18n'
import { enChargement, pret, type EtatAsync } from '../lib/async'
import { lireProfils, rechercheEmissible, type ProfilPlateforme } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'

const CLASSES_CHAMP =
	'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:bg-hover'

export type ProprietesRecherchePersonne = {
	readonly client: ClientCrm
	/** Les identifiants à ne pas proposer : ils aboutiraient à un geste sans objet (§5.21). */
	readonly exclus: ReadonlySet<string>
	readonly choix: string
	/** Le choix et le nom qui le désigne, ou deux chaînes vides quand l'option vide est reprise. */
	readonly onChoix: (id: string, nom: string) => void
	readonly aide: string
	/** Référence du premier champ, pour que le formulaire hôte y place le focus à l'ouverture (§5.13). */
	readonly refChamp?: Ref<HTMLInputElement>
}

export function RecherchePersonne({ client, exclus, choix, onChoix, aide, refChamp }: ProprietesRecherchePersonne) {
	const id = useId()
	const [terme, setTerme] = useState('')
	const [etat, setEtat] = useState<EtatAsync<readonly ProfilPlateforme[]>>(pret([]))

	useEffect(() => {
		if (!rechercheEmissible(terme)) {
			setEtat(pret([]))
			return
		}
		let vivant = true
		setEtat(enChargement())
		void lireProfils(client, terme).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, terme])

	const offerts = etat.statut === 'pret' ? etat.donnees.filter((profil) => !exclus.has(profil.id)) : []

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<label htmlFor={`${id}-terme`} className="text-sm text-text-2">
					{t('platform.recherche.champ')}
				</label>
				<input
					ref={refChamp}
					id={`${id}-terme`}
					type="search"
					value={terme}
					onChange={(e) => setTerme(e.target.value)}
					aria-describedby={`${id}-aide`}
					className={CLASSES_CHAMP}
				/>
				<p id={`${id}-aide`} className="text-sm text-text-3">
					{aide}
				</p>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${id}-choix`} className="text-sm text-text-2">
					{t('platform.recherche.resultats')}
				</label>
				{/* Pendant la lecture, et après son échec, le contrôle est désactivé : il n'y a rien à choisir (§5.22). */}
				<select
					id={`${id}-choix`}
					value={choix}
					onChange={(e) => onChoix(e.target.value, offerts.find((profil) => profil.id === e.target.value)?.nom ?? '')}
					disabled={etat.statut !== 'pret'}
					aria-busy={etat.statut === 'chargement'}
					data-testid="choix-personne"
					className={CLASSES_CHAMP}
				>
					<option value="">
						{etat.statut === 'chargement' ? t('platform.recherche.chargement') : t('platform.recherche.aucunChoix')}
					</option>
					{offerts.map((profil) => (
						<option key={profil.id} value={profil.id}>
							{profil.nom}
						</option>
					))}
				</select>
				{etat.statut === 'erreur' && (
					<p role="alert" className="text-sm text-danger-on-soft">
						{t('platform.recherche.erreur')}
					</p>
				)}
				{etat.statut === 'pret' && rechercheEmissible(terme) && offerts.length === 0 && (
					<p className="text-sm text-text-2">{t('platform.recherche.vide')}</p>
				)}
			</div>
		</div>
	)
}
