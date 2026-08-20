// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 3 : le MONTAGE de l'écran du §4.2,
//       première surface de l'unité réellement atteignable par un utilisateur
// @spec docs/SPEC-costs.md §4.0 (adresse `/tracks/:slugTrack/couts`), §4.2 (histogramme du track,
//       un budget clôturé n'y figure pas), §4.4 (la mention des réels inconnus), §4.7 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.30 (l'histogramme), §5.8 (états systématiques), §4 (architecture),
//       §7 (responsive), §8 (accessibilité), §10 (aucun texte en dur)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// CET ÉCRAN NE CALCULE RIEN LUI-MÊME. L'agrégation, le groupement par devise et la lecture vivent
// dans `webapp/src/lib/couts-ecrans.ts` ; le rendu des barres, du tableau équivalent et de la
// mention du §4.4 vit dans `HistogrammeCouts.tsx`. Ce fichier ne fait que trois choses : résoudre
// le track depuis son slug, appeler la lecture, et traiter les états. Le découpage est celui de
// `RouteTrack` — la coquille résout, la zone rend —, et il est ce qui a permis d'éprouver les deux
// premières tranches en unitaire avant qu'aucune route n'existe.
//
// LE TRACK EST RÉSOLU PAR `useContenuTrack`, ET NON PAR UNE LECTURE PROPRE. Cette coquille a de
// toute façon besoin des channels du track pour sa barre d'onglets — c'est l'entrée de cet écran
// qui y vit (`TabBar`) —, si bien qu'une seconde lecture du track pour son seul identifiant serait
// une requête payée pour rien (`CLAUDE.md` §21).
//
// UN SLUG REFUSÉ ET UN SLUG INEXISTANT PRODUISENT LE MÊME ÉCRAN, comme dans `RouteTrack` : les
// distinguer renseignerait un appelant sans droit sur l'existence d'un track
// (`docs/SPEC-permissions-rls.md` §7).

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireHistogrammeTrack, type HistogrammeDevise } from '../lib/couts-ecrans'
import { clientCrm } from '../lib/supabase'
import type { ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { cheminCoutsBudget } from './chemins'
import { HistogrammeCouts, type GroupeHistogramme } from './HistogrammeCouts'

/** Classes du lien de retour, identiques à celles de `RouteTrack` (docs/DESIGN_SYSTEM.md §5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre de l'en-tête, remplacé par le nom du track dès qu'il est connu — le patron exact
 * de `RouteTrack`. Déclarée en constante et non écrite dans le JSX : le contrôle de clés mortes de
 * `webapp/src/i18n/i18n.test.ts` cherche les clés citées entre apostrophes.
 */
const CLE_TITRE_COUTS: CleTraduction = 'route.costs.track.title'

export function CoutsTrack() {
	const { slugTrack } = useParams()
	const { etat, recharger } = useContenuTrack(clientCrm, slugTrack)

	const track = etat.statut === 'pret' ? etat.donnees.track : null

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_COUTS}
			{...(track === null ? {} : { titreRoute: track.name })}
			etatChannels={projeterChannels(etat)}
			onRechargerChannels={recharger}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<ContenuCoutsTrack
				chargementTrack={etat.statut === 'chargement'}
				idTrack={track?.id ?? null}
				{...(slugTrack === undefined ? {} : { slugTrack })}
				client={clientCrm}
			/>
		</AppShell>
	)
}

/**
 * La zone principale, séparée de la coquille pour être éprouvable sans routeur ni session.
 *
 * `client` est une propriété et non un import direct, contrairement au reste de l'écran : c'est ce
 * qui permet aux preuves unitaires de lui donner un client construit, sans toucher à la
 * configuration globale. Le même patron que `Board` et `ListeCards`.
 */
export function ContenuCoutsTrack({
	chargementTrack,
	idTrack,
	slugTrack,
	client,
}: {
	readonly chargementTrack: boolean
	readonly idTrack: string | null
	/**
	 * Le slug du track, uniquement pour composer l'adresse du détail d'un budget (§4.3).
	 *
	 * FACULTATIF, ET SON ABSENCE RETIRE LE LIEN plutôt que de fabriquer une adresse partielle : un
	 * lien vers `/tracks/undefined/couts/…` mènerait à un écran que l'utilisateur croirait cassé,
	 * la règle d'`adresseAffaireLigne` et d'`adresseAffaire` du carnet.
	 */
	readonly slugTrack?: string
	readonly client: ClientCrm | null
}) {
	const [etat, setEtat] = useState<EtatAsync<readonly HistogrammeDevise[]>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		if (client === null || idTrack === null) return
		// Une réponse arrivée après un changement de track ne doit pas écraser la suivante : le
		// drapeau est capturé par la fermeture, et le nettoyage de l'effet le baisse. Même garde que
		// `useContenuTrack`, écrite ici parce que cet écran n'a qu'une lecture à protéger.
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const resultat = await lireHistogrammeTrack(client, idTrack)
			if (courant) setEtat(resultat)
		})()
		return () => {
			courant = false
		}
	}, [client, idTrack, tentative])

	// Pendant la résolution du track, la zone ne montre rien plutôt qu'un « introuvable » prématuré
	// — la règle de `RouteTrack` : annoncer une absence avant d'avoir la réponse serait la valeur
	// par défaut trompeuse que `CLAUDE.md` §18 interdit.
	if (chargementTrack) return null

	if (idTrack === null) {
		return (
			<EtatVide
				titre={t('route.track.notfound.title')}
				corps={t('route.track.notfound.body')}
				action={
					<Link to="/" className={CLASSES_RETOUR}>
						{t('route.notfound.action')}
					</Link>
				}
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

	// L'ÉTAT « AUCUN BUDGET » DU §4.7 N'OFFRE AUCUNE ACTION, et c'est délibéré. La spécification
	// écrit « l'action d'en créer un pour un administrateur ; pour un autre membre, la phrase
	// seule » ; or la création vit dans l'administration de l'arborescence (§4.1), derrière une
	// adresse que cet écran ne connaît pas et qu'un membre sans droit n'atteindrait pas. Y poser un
	// lien conditionné au rôle ferait calculer un droit à l'interface, ce que `CLAUDE.md` §10
	// interdit dans les deux sens. La phrase seule est donc rendue à tout le monde, et le geste
	// reste là où il est administré.
	if (etat.donnees.length === 0) {
		return <EtatVide titre={t('costs.track.empty.title')} corps={t('costs.track.empty.body')} />
	}

	return (
		<div className="flex flex-col gap-8 max-w-[960px]">
			{etat.donnees.map((histogramme) => (
				<HistogrammeCouts
					key={histogramme.devise}
					devise={histogramme.devise}
					groupes={enGroupes(histogramme, slugTrack)}
					total={histogramme.total}
					legendeColonne={t('costs.track.column')}
				/>
			))}
		</div>
	)
}

/**
 * Traduit un histogramme de devise en groupes rendables.
 *
 * Le §4.2 pose qu'« un budget récurrent apparaît ici agrégé, toutes occurrences confondues, en une
 * seule paire de barres » : c'est déjà ce que `lireHistogrammeTrack` rend — une entrée par budget,
 * ses lignes toutes occurrences confondues —, et cette fonction n'a donc rien à replier. Elle ne
 * fait que nommer.
 *
 * AUCUNE `precision` N'EST POSÉE ICI. Le champ existe pour l'écran du §4.3, où une paire de barres
 * désigne une occurrence et où la période la précise ; sur cet écran, une paire de barres désigne
 * un budget, et son nom est déjà unique parmi les budgets ouverts du track (§2.1). Y verser
 * l'enveloppe — `planned_amount`, facultative — mêlerait une troisième valeur à un graphique qui en
 * compare deux, et le §5.30 n'en déclare pas de troisième.
 */
export function enGroupes(
	histogramme: HistogrammeDevise,
	slugTrack?: string,
): readonly GroupeHistogramme[] {
	return histogramme.barres.map((barre) => ({
		cle: barre.budget.id,
		libelle: barre.budget.name,
		// LE LIEN VERS LE DÉTAIL DU §4.3, ajouté à la tranche 4 : sans lui, cet écran serait la seule
		// entrée d'une adresse qu'aucun geste n'ouvre. Il vit dans le tableau équivalent et non sur
		// la barre, que le §5.30 rend `aria-hidden`. Le nom accessible NOMME le budget : « Salon
		// 2025 » répété sur cinq lignes ne dirait pas ce que chaque lien ouvre.
		...(slugTrack === undefined
			? {}
			: {
					lien: {
						adresse: cheminCoutsBudget(slugTrack, barre.budget.id),
						nomAccessible: t('costs.track.detail.aria', { nom: barre.budget.name }),
					},
				}),
		agregat: barre.agregat,
	}))
}
