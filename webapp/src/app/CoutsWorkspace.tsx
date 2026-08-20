// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 5 : le MONTAGE de l'écran du §4.5,
//       le cumul du workspace, dernier des trois écrans de l'unité
// @spec docs/SPEC-costs.md §4.0 (adresse `/couts`, seule des trois à figurer dans `ROUTES`),
//       §4.5 (un groupe de barres par track, cumul calculé APRÈS la RLS, regroupement par devise),
//       §4.4 (la mention des réels inconnus), §4.7 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.33 (cet écran), §5.30 (l'histogramme), §5.8 (états systématiques),
//       §4 (barre latérale et entrées transverses), §7 (responsive), §8 (accessibilité),
//       §10 (aucun texte en dur)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// CET ÉCRAN NE CALCULE RIEN LUI-MÊME, comme les deux autres. La lecture, le cumul par track et le
// groupement par devise vivent dans `webapp/src/lib/couts-ecrans.ts` ; le rendu des barres, du
// tableau équivalent et de la mention du §4.4 vit dans `HistogrammeCouts.tsx`. Ce fichier appelle
// la lecture et traite les états.
//
// IL NE PORTE PAS SA PROPRE COQUILLE, à la différence de `CoutsTrack` et de `CoutsBudget`. Son
// titre est une clé de traduction — « Coûts » —, et non le nom d'un track ou d'un budget, et son
// contenu ne dépend d'aucun paramètre d'adresse : la coquille commune de `ROUTES` suffit (§4.0),
// et c'est précisément le critère qui range cette adresse dans `ROUTES` là où les deux autres
// suivent le patron de `CHEMIN_CARD`.
//
// LA PORTÉE DU CUMUL EST ÉCRITE À L'ÉCRAN, et ce n'est pas de la prose décorative. Le §4.5 pose que
// le total est calculé après la RLS : deux profils lisent donc deux nombres différents sur les
// mêmes données, et c'est le comportement VOULU — un total juste au centime près qui divulguerait
// par soustraction l'existence d'un budget fermé serait un défaut d'autorisation. Sans la phrase,
// l'écart se lirait comme une erreur de calcul, et quelqu'un finirait par « corriger » la lecture.

import { useEffect, useState } from 'react'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireCumulWorkspace, type HistogrammeDeviseTracks } from '../lib/couts-ecrans'
import { clientCrm } from '../lib/supabase'
import type { ClientCrm } from '../lib/supabase'
import { cheminCoutsTrack } from './chemins'
import { HistogrammeCouts, type GroupeHistogramme } from './HistogrammeCouts'

export function CoutsWorkspace() {
	return <ContenuCoutsWorkspace client={clientCrm} />
}

/**
 * La zone principale, séparée de son point de montage pour être éprouvable sans routeur ni session.
 *
 * `client` est une propriété et non un import direct, comme dans `ContenuCoutsTrack` : c'est ce qui
 * permet aux preuves unitaires de lui donner un client construit, sans toucher à la configuration
 * globale.
 */
export function ContenuCoutsWorkspace({ client }: { readonly client: ClientCrm | null }) {
	const [etat, setEtat] = useState<EtatAsync<readonly HistogrammeDeviseTracks[]>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		if (client === null) return
		// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté : le
		// drapeau est capturé par la fermeture, et le nettoyage de l'effet le baisse. Même garde que
		// `ContenuCoutsTrack`, qui n'a lui aussi qu'une lecture à protéger.
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const resultat = await lireCumulWorkspace(client)
			if (courant) setEtat(resultat)
		})()
		return () => {
			courant = false
		}
	}, [client, tentative])

	// AUCUN CLIENT N'EST UN ÉTAT, PAS UNE ATTENTE. La configuration d'API absente ou la session
	// perdue rendent `clientCrm` nul ; laisser l'écran sur son squelette ferait attendre
	// indéfiniment une lecture que rien n'émettra — la page blanche déguisée que le §5.8 refuse.
	// C'est l'état que `Objectifs` et le carnet traitent déjà, nommé ici pour cet écran.
	if (client === null) {
		return (
			<EtatVide
				titre={t('costs.workspace.noworkspace.title')}
				corps={t('costs.workspace.noworkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return (
			<div className="py-2">
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	if (etat.statut === 'erreur') {
		if (etat.erreur.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => setTentative((precedente) => precedente + 1)}
			/>
		)
	}

	// L'ÉTAT VIDE DU §4.7 N'OFFRE AUCUNE ACTION, et c'est la règle que l'écran du track a déjà prise
	// (§5.32 du design system, `CoutsTrack`) : la création d'un budget vit dans l'administration de
	// l'arborescence (§4.1), derrière une adresse que cet écran ne connaît pas et qu'un membre sans
	// droit n'atteindrait pas. Y poser un lien conditionné au rôle ferait calculer un droit à
	// l'interface, ce que `CLAUDE.md` §10 interdit dans les deux sens.
	//
	// IL RECOUVRE DEUX SITUATIONS, ET C'EST DÉLIBÉRÉ : aucun track lisible, et des tracks lisibles
	// dont aucun ne porte de budget ouvert. Les distinguer renseignerait un appelant sans droit sur
	// l'existence de tracks qu'il ne lit pas (`docs/SPEC-permissions-rls.md` §7), et c'est la règle
	// que les fiches de contact et d'organisation tiennent déjà.
	if (etat.donnees.length === 0) {
		return (
			<EtatVide titre={t('costs.workspace.empty.title')} corps={t('costs.workspace.empty.body')} />
		)
	}

	return (
		<div className="flex flex-col gap-8 max-w-[960px]">
			{etat.donnees.map((histogramme) => (
				<HistogrammeCouts
					key={histogramme.devise}
					devise={histogramme.devise}
					groupes={enGroupesDeTracks(histogramme)}
					total={histogramme.total}
					legendeColonne={t('costs.workspace.column')}
				/>
			))}
			{/* La portée du cumul, SOUS les histogrammes et non au-dessus : c'est une note de lecture
			    des nombres qu'on vient de lire, pas un avertissement à franchir avant de les voir.
			    Même place et même graduation que la mention du §4.4, qui est de la même nature. */}
			<p className="text-[13px] text-text-2">{t('costs.workspace.scope')}</p>
		</div>
	)
}

/**
 * Traduit un histogramme de devise en groupes rendables.
 *
 * Le §4.5 pose que chaque groupe cumule « les budgets ouverts » de son track : c'est déjà ce que
 * `lireCumulWorkspace` rend — une entrée par track et par devise —, et cette fonction n'a donc rien
 * à replier. Elle ne fait que nommer et adresser.
 *
 * LE LIBELLÉ MÈNE AUX COÛTS DU TRACK, et ce lien n'est pas un ornement : sans lui, cet écran serait
 * une impasse — on y lirait qu'un track dépense sans aucun moyen d'aller voir QUELS budgets. Il vit
 * dans le tableau équivalent et non sur la barre, que le §5.30 rend `aria-hidden` : y poser une
 * cible interactive la retirerait au clavier et au lecteur d'écran. Le nom accessible NOMME le
 * track, la règle du §5.29 pour les commandes répétées d'une liste.
 *
 * AUCUNE `precision` N'EST POSÉE ICI, comme sur l'écran du §4.2. Le champ existe pour la période
 * d'une occurrence (§4.3) ; sur cet écran, une paire de barres désigne un track, dont le nom se
 * suffit. Y verser le nombre de budgets cumulés mêlerait un compte à un graphique qui compare deux
 * montants, et le §5.30 ne déclare pas de troisième série.
 */
export function enGroupesDeTracks(
	histogramme: HistogrammeDeviseTracks,
): readonly GroupeHistogramme[] {
	return histogramme.barres.map((barre) => ({
		cle: barre.track.id,
		libelle: barre.track.name,
		lien: {
			adresse: cheminCoutsTrack(barre.track.slug),
			nomAccessible: t('costs.workspace.detail.aria', { nom: barre.track.name }),
		},
		agregat: barre.agregat,
	}))
}
