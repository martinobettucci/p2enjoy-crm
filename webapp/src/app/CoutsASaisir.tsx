// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6b : la SURFACE de l'onglet
//       « À saisir » — la barre d'onglets des deux écrans, la table de saisie en série et son
//       geste clavier
// @spec docs/SPEC-costs.md §4.8 (ce que l'onglet liste, la saisie qui s'enregistre pour elle-même,
//       la ligne enregistrée qui reste en place, zéro qui n'est pas un vide, la lecture seule, le
//       compteur, les trois états), §4.8.1 (le droit d'écriture rendu par la base, l'ancienneté sur
//       `created_at`, les trois issues), §4.8.2 (la portée du badge), §4.8.3 (l'arbitrage d'INC-182 :
//       la phrase de portée du compteur, rendue avec le badge sur le seul onglet « Vue
//       d'ensemble »), §4.0 (`?onglet=saisir`)
// @spec docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série des coûts réels), §5.9 (tableau de
//       données), §5.7 ter (champ qui s'enregistre pour lui-même), §5.6 (pilule), §5.8 (états),
//       §8 (accessibilité), §10 (aucun texte en dur), §12.6 (débordement signalé)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CET ÉCRAN NE JUGE AUCUN DROIT, IL EN LIT UN. `reel_saisissable` est une colonne de la réponse,
// évaluée par la base sous l'identité de l'appelant (§4.8.1) ; `estSaisissable` la lit et se replie
// vers le REFUS. Rien ici ne déduit un droit d'un rôle, ce que `CLAUDE.md` §10 interdit.
//
// LA LIGNE ENREGISTRÉE NE QUITTE JAMAIS LA TABLE À CHAUD (§4.8). C'est la règle qui commande toute
// la gestion d'état de ce fichier : la table rend les lignes que la LECTURE a rapportées, et aucun
// enregistrement ne les retranche. Les retirer à la volée ferait remonter les lignes suivantes sous
// les doigts de celui qui saisit, et lui ferait écrire une valeur dans la mauvaise ligne — c'est le
// défaut classique de ce genre d'écran, et il est interdit ici.
//
// LE BADGE EST LU AU MÊME ENDROIT QUE LA TABLE, et c'est pourquoi la lecture vit dans la zone à
// onglets et non dans le panneau. Le §4.8 exige que le badge soit rendu sur les DEUX onglets ; le
// faire dépendre d'une seconde source — un compte demandé à part — ouvrirait la divergence que le
// §4.8.2 cherche précisément à fermer.
//
// LA PHRASE DE PORTÉE EST RENDUE AVEC LE BADGE, ET SUR LE SEUL ONGLET « Vue d'ensemble » (§4.8.3).
// C'est cet onglet qui porte les mentions du §4.4, donc le seul endroit où deux nombres qui comptent
// deux populations se rencontrent ; sur l'onglet « À saisir », le tableau rendu EST la population du
// badge, et la phrase n'aurait rien à expliquer. Elle n'est pas conditionnée à une divergence
// observée : la mesurer obligerait cette zone à recompter la population de l'histogramme, c'est-à-
// dire à tenir une seconde source pour un nombre que la vue d'ensemble possède déjà.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireMontant } from '../lib/card-costs'
import {
	ancienneteEnJours,
	ancienneteEnRetard,
	compterEnAttente,
	enregistrerReel,
	estClos,
	estSaisissable,
	lireLignesASaisir,
	type LigneASaisir,
	type PorteeASaisir,
	type RefusSaisie,
} from '../lib/couts-a-saisir'
import { adresseAffaireLigne } from '../lib/couts-ecrans'
import type { ClientCrm } from '../lib/supabase'
import { formaterMontant } from './HistogrammeCouts'
import { lireOngletCouts, OngletsCouts } from './OngletsCouts'

/**
 * Les deux écrans à onglets, montés autour de leur vue d'ensemble.
 *
 * `ensemble` EST UN NŒUD ET NON UN COMPOSANT À MONTER : l'écran du track et celui du workspace
 * rendent deux vues d'ensemble différentes, avec leurs propres lectures et leurs propres états, et
 * les faire passer par une fabrique commune ferait de ce fichier le point de rencontre de deux
 * écrans qui n'ont en commun que leur barre d'onglets.
 */
export function ZoneCoutsAOnglets({
	client,
	portee,
	ensemble,
}: {
	readonly client: ClientCrm | null
	readonly portee: PorteeASaisir
	readonly ensemble: ReactNode
}) {
	const [parametres] = useSearchParams()
	const onglet = lireOngletCouts(parametres.get('onglet'))
	const { etat, recharger } = useLignesASaisir(client, portee)

	const nombreEnAttente = etat.statut === 'pret' ? compterEnAttente(etat.donnees) : null

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<OngletsCouts onglet={onglet} nombreEnAttente={nombreEnAttente} />
				{onglet === 'ensemble' && nombreEnAttente !== null && nombreEnAttente > 0 ? (
					<p data-testid="couts-portee-compteur" className="text-[13px] text-text-2">
						{t('costs.tabs.pending.scope')}
					</p>
				) : null}
			</div>
			{onglet === 'ensemble' ? (
				ensemble
			) : (
				<PanneauASaisir etat={etat} client={client} onReprise={recharger} />
			)}
		</div>
	)
}

/**
 * La lecture des lignes en attente, dans la portée de l'écran.
 *
 * ELLE EST FAITE SUR LES DEUX ONGLETS, et ce n'est pas un gaspillage : le badge du §4.8 porte le
 * nombre de lignes en attente, et il est rendu sur l'onglet « Vue d'ensemble » comme sur l'autre.
 * Une lecture différée au premier clic laisserait l'onglet sans badge tant que personne ne l'ouvre,
 * c'est-à-dire exactement là où le badge sert — c'est lui qui donne la raison de l'ouvrir.
 *
 * `JSON.stringify` SUR LA PORTÉE, ET C'EST DÉLIBÉRÉ : l'appelant construit un objet neuf à chaque
 * rendu, et une dépendance d'effet sur cet objet relancerait la lecture indéfiniment. La portée est
 * un couple de valeurs primitives (§4.8), donc sa forme sérialisée est une identité fidèle.
 */
function useLignesASaisir(client: ClientCrm | null, portee: PorteeASaisir) {
	const [etat, setEtat] = useState<EtatAsync<readonly LigneASaisir[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const clePortee = JSON.stringify(portee)

	useEffect(() => {
		if (client === null) return
		// Une réponse arrivée après un changement de portée ne doit pas écraser la suivante : le
		// drapeau est capturé par la fermeture, et le nettoyage de l'effet le baisse. Même garde que
		// `ContenuCoutsTrack`.
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const resultat = await lireLignesASaisir(client, JSON.parse(clePortee) as PorteeASaisir)
			if (courant) setEtat(resultat)
		})()
		return () => {
			courant = false
		}
	}, [client, clePortee, tentative])

	return { etat, recharger: () => setTentative((precedente) => precedente + 1) }
}

/** Le panneau de l'onglet : les quatre états du §5.8, puis la table. */
function PanneauASaisir({
	etat,
	client,
	onReprise,
}: {
	readonly etat: EtatAsync<readonly LigneASaisir[]>
	readonly client: ClientCrm | null
	readonly onReprise: () => void
}) {
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
				onReprise={onReprise}
			/>
		)
	}

	// « Tous les coûts réels sont saisis » — le §4.8 le nomme explicitement : « c'est une bonne
	// nouvelle, pas un état vide en défaut ». Il n'offre aucune action : il n'y a rien à faire d'une
	// attente vide, et la création d'une ligne de coût vit dans la fiche d'affaire (§4.6).
	if (etat.donnees.length === 0) {
		return <EtatVide titre={t('costs.pending.empty.title')} corps={t('costs.pending.empty.body')} />
	}

	return <TableASaisir lignes={etat.donnees} client={client} />
}

/**
 * La table de saisie en série — §4.8, `docs/DESIGN_SYSTEM.md` §5.31.
 *
 * LE TABLEAU DU §5.9, SANS ÉCART : `table` sémantique, en-tête collant, une ligne de texte par
 * cellule en ellipse avec la valeur entière en `title`, séparateurs sans zébrure, montants alignés
 * à droite en chiffres tabulaires, conteneur `overflow-x-auto` portant `.indique-debordement-x`
 * (§12.6) pour que la page ne défile jamais horizontalement (§7).
 *
 * `maintenant` EST FIGÉ AU MONTAGE, et non recalculé à chaque rendu : une ancienneté qui changerait
 * d'un rendu à l'autre ferait sauter une colonne pendant la saisie, et rendrait toute preuve
 * indéterministe. Le §4.8.1 mesure l'ancienneté sur `created_at`, jamais sur `updated_at`.
 */
export function TableASaisir({
	lignes,
	client,
}: {
	readonly lignes: readonly LigneASaisir[]
	readonly client: ClientCrm | null
}) {
	const [maintenant] = useState(() => new Date())
	// LES CHAMPS SONT REGISTRÉS POUR LE GESTE CLAVIER, et pour lui seul : `Entrée` porte le focus sur
	// le champ de la ligne SUIVANTE (§5.31), ce qu'aucun ordre de tabulation naturel ne fait. La
	// carte est indexée par identifiant de ligne plutôt que par rang : un rang deviendrait faux si la
	// lecture rapportait un ordre différent, et une ligne enregistrée ne quitte de toute façon jamais
	// la table (§4.8).
	const champs = useRef(new Map<string, HTMLInputElement | null>())

	const focaliserSuivant = (rang: number) => {
		const suivante = lignes[rang + 1]
		if (suivante === undefined) return
		champs.current.get(suivante.id)?.focus()
	}

	// L'état « aucune ligne écrivable, mais des lignes lisibles » du §4.8 : le tableau est rendu
	// ENTIER et le DIT EN TÊTE. Il recouvre le cas du `viewer`, et tout autre profil dont les droits
	// fins n'ouvrent aucun des channels concernés — le déduire d'un rôle serait faux (§4.8.1).
	const aucuneEcrivable = !lignes.some(estSaisissable)

	return (
		<section className="flex flex-col gap-3" data-testid="couts-a-saisir">
			{aucuneEcrivable ? (
				<p data-testid="couts-a-saisir-lecture-seule" className="text-sm text-text-2">
					{t('costs.pending.readonly.all')}
				</p>
			) : null}

			<div className="overflow-x-auto indique-debordement-x [contain:paint]">
				<table className="w-full text-sm border-collapse">
					<caption className="sr-only">{t('costs.pending.caption')}</caption>
					<thead>
						<tr className="text-left text-text-2 border-b border-border">
							<th scope="col" className="py-2 pr-4 font-medium">
								{t('costs.pending.column.age')}
							</th>
							<th scope="col" className="py-2 px-4 font-medium">
								{t('costs.pending.column.budget')}
							</th>
							<th scope="col" className="py-2 px-4 font-medium">
								{t('costs.pending.column.occurrence')}
							</th>
							<th scope="col" className="py-2 px-4 font-medium">
								{t('costs.pending.column.card')}
							</th>
							<th scope="col" className="py-2 px-4 font-medium">
								{t('costs.pending.column.label')}
							</th>
							<th scope="col" className="py-2 px-4 font-medium text-right">
								{t('costs.chart.legend.planned')}
							</th>
							<th scope="col" className="py-2 pl-4 font-medium text-right">
								{t('costs.pending.column.actual')}
							</th>
						</tr>
					</thead>
					<tbody>
						{lignes.map((ligne, rang) => (
							<LigneSaisie
								key={ligne.id}
								ligne={ligne}
								maintenant={maintenant}
								client={client}
								onEnregistrerChamp={(element) => champs.current.set(ligne.id, element)}
								onSuivant={() => focaliserSuivant(rang)}
							/>
						))}
					</tbody>
				</table>
			</div>

			{/* Les deux phrases que le §4.8 et le §5.31 exigent SOUS le tableau : « zéro est une valeur,
			    pas un vide », et la consigne clavier qui est la raison d'être de cet écran. Elles sont
			    écrites, jamais supposées comprises. */}
			<p className="text-[13px] text-text-2">{t('costs.pending.zero.notice')}</p>
			<p className="text-[13px] text-text-2">{t('costs.pending.keyboard.notice')}</p>
		</section>
	)
}

/** Ce qu'une ligne dit d'elle-même pendant et après sa saisie — les trois mentions du §5.7 ter. */
type EtatSaisie =
	| { readonly statut: 'repos' }
	/** La saisie n'est pas un nombre : rien n'est envoyé, et la saisie est CONSERVÉE. */
	| { readonly statut: 'invalide' }
	| { readonly statut: 'envoi' }
	| { readonly statut: 'enregistre' }
	/** Un refus, ou l'issue « sans effet » — ni un succès, ni une erreur (§4.8.1). */
	| { readonly statut: 'message'; readonly texte: string }

/**
 * Une ligne du tableau, et son champ qui s'enregistre pour lui-même (§5.7 ter).
 *
 * SIX RÈGLES QUI NE SE DEVINENT PAS.
 *
 * 1. **`Entrée` enregistre ET porte le focus sur la ligne suivante** (§5.31). Le focus part
 *    IMMÉDIATEMENT, sans attendre la réponse : une saisie en série qui attendrait l'aller-retour du
 *    serveur à chaque ligne ne serait pas une saisie en série. La ligne quittée porte sa propre
 *    mention, qui suit son envoi.
 *
 * 2. **`Échap` annule la saisie en cours et laisse la ligne intacte** (§5.31) : le champ revient à
 *    la dernière valeur enregistrée — ou au vide si aucune ne l'a été —, et la mention d'invalidité
 *    tombe avec elle. Aucune écriture n'est émise.
 *
 * 3. **Une ligne enregistrée RESTE EN PLACE**, sur un fond `--color-success-soft`, et ne quitte
 *    jamais la table à chaud (§4.8).
 *
 * 4. **Un champ vide n'envoie RIEN**, et zéro envoie zéro (§4.8, §2.3) : « nul n'est pas zéro ».
 *    C'est la distinction que cet onglet fait au clavier, et elle est écrite sous le tableau.
 *
 * 5. **Le contrôle n'est jamais désactivé pendant l'envoi** (§5.7 ter) : un contrôle désactivé perd
 *    le focus du clavier, ce qui interromprait précisément la série que `Entrée` vient de lancer.
 *    Il l'est en revanche lorsque la BASE refuse l'écriture (§4.8), avec son motif sous le champ.
 *
 * 6. **Deux envois de la même valeur ne partent pas deux fois.** `Entrée` est suivi d'un `blur`
 *    quand le focus s'en va : sans cette garde, chaque ligne serait écrite deux fois. La garde
 *    porte sur la valeur ENVOYÉE, jamais sur un minuteur (`CLAUDE.md` §18).
 */
function LigneSaisie({
	ligne,
	maintenant,
	client,
	onEnregistrerChamp,
	onSuivant,
}: {
	readonly ligne: LigneASaisir
	readonly maintenant: Date
	readonly client: ClientCrm | null
	readonly onEnregistrerChamp: (element: HTMLInputElement | null) => void
	readonly onSuivant: () => void
}) {
	const [valeur, setValeur] = useState('')
	const [etat, setEtat] = useState<EtatSaisie>({ statut: 'repos' })
	const envoyee = useRef<string | null>(null)

	const saisissable = estSaisissable(ligne)
	// LES DEUX ÉTATS SONT CALCULÉS HORS DU `className`, et ce n'est pas un goût de style : le
	// contrôle de classes de `scripts/lib/classes-css.mjs` lit TOUTE chaîne littérale d'une
	// expression `className`, si bien qu'une comparaison écrite là — `etat.statut === 'enregistre'`
	// — y serait prise pour une classe utilitaire absente du CSS produit. Le contrôle n'est pas
	// contourné, il est laissé exact : il n'a plus rien à confondre.
	const enregistre = etat.statut === 'enregistre'
	const invalide = etat.statut === 'invalide'
	const devise = ligne.budgets?.currency ?? ''
	const anciennete = ancienneteEnJours(ligne, maintenant)
	const enRetard = ancienneteEnRetard(ligne, maintenant)
	// LE NOM ACCESSIBLE EST CALCULÉ HORS DU JSX, et pas seulement pour la lisibilité : une
	// comparaison écrite dans un `className` ou un attribut est lue par `scripts/lib/classes-css.mjs`
	// comme une classe absente du CSS (INC-184, mesuré sur ce fichier même). Le motif est le même que
	// pour `enregistre` plus haut.
	const seuilDuBudget = ligne.budgets?.stale_after_days ?? null
	const titreAnciennete =
		anciennete === null || seuilDuBudget === null
			? null
			: t(enRetard ? 'costs.pending.age.late' : 'costs.pending.age.ontime', {
					n: String(anciennete),
					seuil: String(seuilDuBudget),
				})
	const adresse = adresseAffaireLigne(ligne)
	const titreAffaire = ligne.cards?.title ?? null
	const identifiantMention = `couts-saisir-${ligne.id}-mention`

	const soumettre = () => {
		if (!saisissable || client === null) return
		const montant = lireMontant(valeur)
		// Un champ vidé ne remet aucune ligne en attente et n'envoie rien : `enregistrerReel` ne prend
		// pas de `null`, et un geste qui EFFACERAIT un réel n'est spécifié nulle part (§4.8).
		if (montant.statut === 'absent') return
		if (montant.statut === 'invalide') {
			setEtat({ statut: 'invalide' })
			return
		}
		if (envoyee.current === valeur && etat.statut !== 'message') return
		envoyee.current = valeur
		setEtat({ statut: 'envoi' })
		void (async () => {
			const resultat = await enregistrerReel(client, ligne.id, montant.montant)
			if (resultat.statut === 'applique') {
				// La valeur RETENUE par la base remplace celle qui a été tapée : `numeric(14,2)` arrondit,
				// et afficher la saisie ferait croire enregistré autre chose que ce qui l'est (§4.8.1).
				const retenue = String(resultat.reel)
				envoyee.current = retenue
				setValeur(retenue)
				setEtat({ statut: 'enregistre' })
				return
			}
			// Un refus et un « sans effet » n'effacent pas la saisie (§5.7 ter), et rouvrent l'envoi :
			// la garde de double envoi ne doit pas empêcher de RÉESSAYER la même valeur.
			envoyee.current = null
			setEtat({
				statut: 'message',
				texte:
					resultat.statut === 'sans-effet'
						? t('costs.pending.refus.sans-effet')
						: texteRefusSaisie(resultat.refus),
			})
		})()
	}

	return (
		<tr
			data-testid="couts-a-saisir-ligne"
			data-ligne={ligne.id}
			className={[
				'border-b border-border h-[44px] align-top',
				'transition-colors duration-[var(--transition-duration-slow)]',
				// LE FOND DE SUCCÈS RESTE, IL NE S'ÉTEINT PAS SUR UN MINUTEUR. Le §4.8 pose que la ligne
				// « reste affichée, marquée enregistré, jusqu'au prochain chargement de l'onglet » : une
				// marque qui s'effacerait d'elle-même laisserait la table indistinguable de son état
				// d'avant, et un minuteur serait la temporisation arbitraire que `CLAUDE.md` §18 proscrit.
				enregistre ? 'bg-success-soft' : 'hover:bg-hover',
			].join(' ')}
		>
			{/* L'ancienneté est en 13 px `--color-text-2`, et passe en `--color-danger-on-soft` sur
			    `--color-danger-soft` au delà du seuil du budget — la forme exacte de la pastille
			    d'ancienneté d'une card (§5.1), et la seconde phrase du §5.31, tenue depuis
			    l'arbitrage d'INC-183 (§2.1 bis, décision 549).

			    TROIS ÉTATS, ET DEUX RENDUS. « Seuil non franchi » et « aucun seuil décidé » sont
			    tous deux neutres ; ce que la teinte ne distingue pas, le NOM ACCESSIBLE le dit, sans
			    quoi le signal n'existerait pas pour qui ne voit pas la couleur (§8). Un budget sans
			    seuil ne reçoit aucun nom accessible particulier : il n'y a rien à dire d'un seuil que
			    personne n'a décidé, et l'annoncer chaque ligne serait du bruit.

			    Une date illisible laisse la cellule VIDE (§5.9), jamais « 0 jour » — et une cellule
			    vide n'est jamais en retard : `ancienneteEnRetard` rend `false`. */}
			<td
				data-testid="couts-a-saisir-anciennete"
				data-retard={enRetard ? 'oui' : 'non'}
				className="py-2 pr-4 text-[13px] whitespace-nowrap"
			>
				{anciennete === null ? null : (
					<span
						data-testid="couts-a-saisir-anciennete-valeur"
						title={titreAnciennete ?? undefined}
						/* LA TEINTE EST PORTÉE PAR LA VALEUR, JAMAIS PAR LA CELLULE, et c'est un défaut
						   TROUVÉ EN REGARDANT LA CAPTURE (`CLAUDE.md` §16, capture
						   `docs/captures/CRM-084/anciennete-seuil-1440.jpg`) : posée sur le `td`, elle
						   peignait toute la largeur de la colonne — cent quinze pixels de fond rouge
						   derrière quatre caractères —, et la ligne entière se lisait comme une ligne
						   en erreur. Le §5.31 dit « comme la pastille d'ancienneté d'une card (§5.1) :
						   c'est le même signal, il doit avoir la même forme » ; une pastille se moule
						   sur sa valeur. La forme retenue est donc celle de la pilule « clôturé » de la
						   colonne d'à côté — `inline-flex`, `rounded-full`, `px-2` —, qui vit déjà dans
						   cette table : deux pastilles d'un même tableau qui ne se ressembleraient pas
						   se liraient comme deux natures de chose. */
						className={
							enRetard
								? 'inline-flex items-center rounded-full bg-danger-soft text-danger-on-soft px-2'
								: 'text-text-2'
						}
					>
						{t('costs.pending.age.days', { n: String(anciennete) })}
					</span>
				)}
			</td>
			<td className="py-2 px-4 max-w-[22ch]">
				<span className="block truncate" title={ligne.budgets?.name ?? ''}>
					{ligne.budgets?.name ?? ''}
				</span>
				{estClos(ligne) ? (
					<span
						data-testid="couts-a-saisir-clos"
						title={t('costs.pending.closed.aria')}
						className="mt-1 inline-flex items-center rounded-full bg-hover px-2 text-[12px] text-text-2"
					>
						{t('costs.pending.closed')}
					</span>
				) : null}
			</td>
			{/* Une ligne dont le budget n'est pas récurrent n'a AUCUNE occurrence : la cellule reste
			    VIDE — ni tiret, ni « non renseigné » (§5.9). */}
			<td className="py-2 px-4 max-w-[18ch] truncate" title={ligne.budget_occurrences?.label ?? ''}>
				{ligne.budget_occurrences?.label ?? ''}
			</td>
			<th scope="row" className="py-2 px-4 font-normal text-left text-ink max-w-[24ch] truncate">
				{titreAffaire === null ? (
					<span className="text-text-2">{t('costs.pending.card.unknown')}</span>
				) : adresse === null ? (
					<span title={titreAffaire}>{titreAffaire}</span>
				) : (
					<Link to={adresse} className="text-brand hover:underline" title={titreAffaire}>
						{titreAffaire}
					</Link>
				)}
			</th>
			<td className="py-2 px-4 max-w-[20ch] truncate" title={ligne.label}>
				{ligne.label}
			</td>
			<td className="py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap">
				{formaterMontant(ligne.estimated_cost, devise)}
			</td>
			<td className="py-2 pl-4 text-right">
				<input
					ref={onEnregistrerChamp}
					data-testid="couts-a-saisir-champ"
					// `inputMode` ET NON `type="number"` : un champ numérique natif laisse le navigateur
					// vider `value` sur une saisie qu'il juge invalide, si bien que `lireMontant` ne verrait
					// jamais le cas « invalide » qu'elle existe pour nommer — mesuré par `BlocCoutsCard`.
					inputMode="decimal"
					aria-label={t('costs.pending.field.aria', { nom: ligne.label })}
					aria-describedby={etat.statut === 'repos' && saisissable ? undefined : identifiantMention}
					aria-invalid={etat.statut === 'invalide' ? true : undefined}
					disabled={!saisissable}
					value={valeur}
					onChange={(evenement) => {
						setValeur(evenement.target.value)
						// La mention d'invalidité tombe dès que la saisie change : elle décrit la valeur
						// précédente, et la laisser ferait lire un refus sur ce qui vient d'être corrigé.
						if (etat.statut === 'invalide') setEtat({ statut: 'repos' })
					}}
					onBlur={soumettre}
					onKeyDown={(evenement) => {
						if (evenement.key === 'Enter') {
							// `preventDefault` : aucun formulaire n'entoure cette table, mais un `Entrée` non
							// intercepté déclencherait la soumission implicite du jour où l'un l'entourera.
							evenement.preventDefault()
							soumettre()
							onSuivant()
							return
						}
						if (evenement.key === 'Escape') {
							evenement.preventDefault()
							setValeur(envoyee.current ?? '')
							if (etat.statut === 'invalide') setEtat({ statut: 'repos' })
						}
					}}
					className={[
						'w-[12ch] min-h-[var(--size-target)] rounded-sm border px-2',
						'text-right font-mono tabular-nums',
						invalide ? 'border-danger' : 'border-border',
						'bg-surface text-ink disabled:bg-hover disabled:text-text-2',
					].join(' ')}
				/>
				<Mention etat={etat} saisissable={saisissable} identifiant={identifiantMention} />
			</td>
		</tr>
	)
}

/**
 * La mention d'état, SOUS le champ et dans la ligne — §5.31, §5.7 ter.
 *
 * TROIS MENTIONS, JAMAIS DEUX À LA FOIS, et le motif de lecture seule prend la place des trois
 * autres : un champ désactivé n'enregistre rien, donc aucune des trois n'a d'objet sur lui. Un
 * refus porte `role="alert"` ; l'attente et la confirmation ne l'ont pas — elles ne demandent
 * aucune action et interrompraient la saisie en série à chaque ligne.
 */
function Mention({
	etat,
	saisissable,
	identifiant,
}: {
	readonly etat: EtatSaisie
	readonly saisissable: boolean
	readonly identifiant: string
}) {
	if (!saisissable) {
		return (
			<span id={identifiant} className="block text-[13px] text-text-2 max-w-[24ch] text-right">
				{t('costs.pending.readonly.line')}
			</span>
		)
	}
	if (etat.statut === 'envoi') {
		return (
			<span id={identifiant} className="block text-[13px] text-text-3 text-right">
				{t('costs.pending.saving')}
			</span>
		)
	}
	if (etat.statut === 'enregistre') {
		return (
			<span
				id={identifiant}
				data-testid="couts-a-saisir-enregistre"
				className="block text-[13px] text-success text-right"
			>
				{t('costs.pending.saved')}
			</span>
		)
	}
	if (etat.statut === 'invalide') {
		return (
			<span
				id={identifiant}
				role="alert"
				className="block text-[13px] text-danger-on-soft text-right"
			>
				{t('costs.pending.invalid')}
			</span>
		)
	}
	if (etat.statut === 'message') {
		return (
			<span
				id={identifiant}
				role="alert"
				data-testid="couts-a-saisir-message"
				className="block text-[13px] text-danger-on-soft max-w-[28ch] text-right"
			>
				{etat.texte}
			</span>
		)
	}
	return null
}

/** Traduit un refus de saisie en un texte destiné à l'utilisateur — jamais un code brut (§5.14). */
export function texteRefusSaisie(refus: RefusSaisie): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('costs.pending.refus.forbidden')
		case 'montant-hors-echelle':
			return t('costs.pending.refus.montant-hors-echelle')
		case 'forme-refusee':
			return t('costs.pending.refus.forme-refusee')
		case 'reference-absente':
			return t('costs.pending.refus.reference-absente')
		case 'network':
			return t('costs.pending.refus.network')
		case 'unknown':
			return t('costs.pending.refus.unknown')
	}
}
