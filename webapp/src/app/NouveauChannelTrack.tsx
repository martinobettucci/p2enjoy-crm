// @spec CRM-100 (docs/BACKLOG.md) — tranche T1 : « Nouveau channel » dans la vue d'un track, formulaire sur place
// @spec docs/SPEC-administration-arborescence.md §13.3 (ce que l'écran fait à l'ouverture, ce qu'il envoie, après un
//       succès, après un refus, « Annuler » et `Échap`), §13.4 (l'aller-retour depuis la vue d'un track), §13.6 (au
//       retour : le brouillon et le workflow attendu), §7.2 et §7.3 (la liste des workflows, le `workspace_id` du track)
// @spec docs/DESIGN_SYSTEM.md §5.55 (le formulaire en tête de la zone principale), §5.13, §5.50 (`Échap` referme)
// @spec docs/JOURNAL.md décision 623
// @spec CRM-116 (docs/BACKLOG.md) tranche T3 — la couleur envoyée à la création, reprise du brouillon au retour
//       (docs/SPEC-administration-arborescence.md §14.3)
//
// LE FORMULAIRE EST UN ÉTAT DE L'ADRESSE : `nouveau-channel=1`. Ce composant n'est monté que lorsque la vue du track
// le lit, et le referme en retirant ses paramètres — jamais par un état local, qu'un retour de l'éditeur de workflows
// ne saurait pas rouvrir. Le focus d'après — la commande, ou l'onglet du channel créé — est posé par la route, qui
// survit à ce composant.

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	creerChannel,
	lireWorkflowsAffectables,
	proposerSlug,
	type WorkflowAffectable,
} from '../lib/administration-arborescence'
import type { TrackOuvert } from '../lib/channels'
import { useApresWorkflowDeDepart } from '../lib/demarrage'
import {
	cheminEditeurNouveauWorkflow,
	lireBrouillon,
	origineDepuisTrack,
	sansNouveauChannel,
} from '../lib/nouveau-channel'
import type { ClientCrm } from '../lib/supabase'
import { texteRefus } from './ElementsFormulaireAdmin'
import { FormulaireChannel, type SaisieChannel } from './FormulaireChannel'

export type ProprietesZoneNouveauChannel = {
	readonly client: ClientCrm
	readonly track: TrackOuvert
	/** Le channel est créé : la route ouvre son board, relit les channels et annonce. */
	readonly onCree: (slug: string, nom: string) => void
	/** Le formulaire est refermé sans création : la route rend le focus à la commande. */
	readonly onFerme: () => void
}

export function ZoneNouveauChannel({ client, track, onCree, onFerme }: ProprietesZoneNouveauChannel) {
	const [parametres, setParametres] = useSearchParams()
	const { pathname, search } = useLocation()
	// Le brouillon est lu AU MONTAGE seulement : la saisie vit ensuite dans le formulaire, et l'adresse n'en reçoit
	// une copie qu'au départ vers l'éditeur (§13.4).
	const [brouillon] = useState(() => lireBrouillon(parametres))
	const [workflows, setWorkflows] = useState<EtatAsync<readonly WorkflowAffectable[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)

	// La liste des workflows affectables est lue À L'OUVERTURE (§7.2), avec le `workspace_id` du track (§7.3).
	useEffect(() => {
		let vivant = true
		setWorkflows(enChargement())
		void lireWorkflowsAffectables(client, track.workspace_id, track.id).then((lus) => {
			if (vivant) setWorkflows(lus)
		})
		return () => {
			vivant = false
		}
	}, [client, track.workspace_id, track.id, tentative])

	// Le workflow de départ posé depuis le guide flottant, formulaire ouvert : la liste se relit, la saisie survit —
	// la règle de l'arborescence (`CRM-094`, docs/SPEC-onboarding.md §10.3).
	const relire = useCallback(() => setTentative((precedente) => precedente + 1), [])
	useApresWorkflowDeDepart(relire)

	const fermer = useCallback(() => {
		setParametres((courants) => sansNouveauChannel(courants), { replace: true })
		onFerme()
	}, [setParametres, onFerme])

	const valider = useCallback(
		async (saisie: SaisieChannel) => {
			setEnCours(true)
			setRefus(null)
			try {
				const resultat = await creerChannel(client, {
					idWorkspace: track.workspace_id,
					idTrack: track.id,
					idWorkflow: saisie.idWorkflow,
					nom: saisie.nom,
					slug: saisie.slug,
					description: saisie.description,
					couleur: saisie.couleur,
				})
				if (resultat.statut === 'refus') {
					setRefus(texteRefus(resultat.refus))
					return
				}
				if (resultat.statut === 'sans-effet') {
					setRefus(t('admin.refus.sans-effet'))
					return
				}
				onCree(saisie.slug, saisie.nom.trim())
			} finally {
				setEnCours(false)
			}
		},
		[client, track.workspace_id, track.id, onCree],
	)

	return (
		<div
			className="px-4 pt-4"
			// `Échap` referme depuis un champ, comme « Annuler » (docs/DESIGN_SYSTEM.md §5.50).
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				fermer()
			}}
		>
			<FormulaireChannel
				titre={t('admin.form.channel.create')}
				initial={{
					nom: brouillon.nom,
					// Un slug absent du brouillon n'a pas été saisi : il se repropose depuis le nom (§13.4).
					slug: brouillon.slug === '' ? proposerSlug(brouillon.nom) : brouillon.slug,
					description: brouillon.description,
					idWorkflow: '',
					couleur: brouillon.couleur,
				}}
				slugModifiable
				workflows={workflows}
				refus={refus}
				enCours={enCours}
				onAnnuler={fermer}
				onValider={(saisie) => void valider(saisie)}
				idWorkflowAttendu={brouillon.idWorkflow}
				cheminNouveauWorkflow={(saisie) =>
					cheminEditeurNouveauWorkflow(track.id, origineDepuisTrack(pathname, search, saisie))
				}
			/>
		</div>
	)
}
