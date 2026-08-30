// @spec CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//       TRANCHE 3 a : l'écran `/pilotage`, à portée workspace
// @spec docs/SPEC-analytique.md §7.1 (taux de conversion des affaires DÉCIDÉES, et l'INCONNU),
//       §7.2 (prévisionnel par devise, terminaux exclus), §7.3 (les trois mentions obligatoires),
//       §8 (l'adresse, ce qui est arrêté et ce que la tranche 3 a ne livre pas),
//       §5.3 (le total est calculé APRÈS la RLS), §5.4 (l'anonyme est refusé par le privilège),
//       §11.2 (aucune conversion de devises)
// @spec docs/DESIGN_SYSTEM.md §5.48 (cet écran), §5.9 (le tableau), §5.20 (la liste de
//       définitions), §5.33 (le titre de devise et la phrase de portée), §5.30 (la graduation des
//       mentions), §5.8 (les états), §2 (données techniques), §7 (paliers), §8 (accessibilité),
//       §10 (aucun texte en dur), §12.6 (l'indication de débordement)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// CET ÉCRAN NE CALCULE RIEN LUI-MÊME, comme les trois écrans de coûts. La règle — probabilité
// effective, exclusions, montant pondéré — vit dans `public.entonnoir_conversion()` ; le repli, les
// deux grandeurs dérivées, le groupement par devise et les deux compteurs d'absence vivent dans
// `webapp/src/lib/analytique.ts`, avec leur suite unitaire. Ce fichier appelle la lecture, traite
// les états et rend.
//
// IL NE PORTE PAS SA PROPRE COQUILLE, comme `CoutsWorkspace` : son titre est une clé de traduction
// — « Pilotage » —, et son contenu ne dépend d'aucun paramètre d'adresse. C'est le critère qui range
// cette adresse dans `ROUTES` (§8).
//
// AUCUNE COMMANDE D'ÉCRITURE, ET L'ABSENCE EST ASSUMÉE (§5.48). Cet écran MESURE, il n'agit pas —
// la règle du §5.14 pour l'état de la messagerie, du §5.36 pour « Ma journée » et du §5.37 pour les
// affaires figées. Les trois colonnes de probabilité se saisissent au catalogue, dans l'éditeur de
// workflows et dans la fiche d'affaire ; un second chemin d'écriture ici en ferait une seconde
// définition du même geste.
//
// LA PORTÉE EST CELLE DU WORKSPACE, et le §8 nomme l'écart : le module porte déjà `restreindre`,
// éprouvé, mais nommer un track ou un channel demande une SECONDE lecture que la tranche 3 a ne
// fait pas. La phrase de portée le dit à l'écran plutôt que de le laisser deviner.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	absences,
	grouperParDevise,
	lireEntonnoir,
	previsionnel,
	replier,
	tauxConversion,
	type GenreNoeud,
	type GroupeDevise,
	type LigneEntonnoirLue,
	type NoeudEntonnoir,
	type PrevisionnelDevise,
	type TauxConversion,
} from '../lib/analytique'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/** L'en-tête d'une colonne (§5.9) : 13 px, texte secondaire, hauteur de cible. */
const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

/**
 * Cellule de donnée technique (§2, §5.9) : monospace, chiffres tabulaires, alignée à droite — la
 * seule raison d'avoir des chiffres tabulaires est de se comparer colonne par colonne.
 */
const CLASSES_CELLULE_TECHNIQUE =
	'h-[var(--size-target)] px-3 text-right whitespace-nowrap tabular-nums font-mono'

/** Cellule ordinaire : une ligne de texte, hauteur de cible (§5.9). */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[28ch]'

/**
 * Les trois mots du genre d'un nœud — §5.48.
 *
 * CE SONT LES MOTS EXACTS DU §5.18, et les clés sont donc celles de l'administration du catalogue,
 * jamais des clés jumelles : c'est la même donnée, `workflow_nodes_catalog.kind`, et deux écrans qui
 * la rendent ne peuvent pas la nommer de deux façons. Un second dictionnaire divergerait au premier
 * ajustement de libellé.
 */
const CLES_GENRE: Readonly<Record<GenreNoeud, CleTraduction>> = {
	open: 'admin.catalog.kind.open',
	won: 'admin.catalog.kind.won',
	lost: 'admin.catalog.kind.lost',
}

/**
 * Un montant, sans son code devise.
 *
 * `Intl.NumberFormat` est employé SANS `style: 'currency'`, pour le motif exact de
 * `formaterMontant` : la base ne contraint que la FORME du code devise, jamais sa liste réelle, et
 * `currency: 'XYZ'` lèverait `RangeError` sur un code que le navigateur ne connaît pas — l'écran
 * entier tomberait pour une devise saisie.
 */
function formaterMontant(valeur: number, locale = 'fr-FR'): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(valeur)
}

/**
 * Le taux en pourcentage, à une décimale.
 *
 * Il n'est appelé que sur un taux CONNU : l'inconnu porte une phrase et non un nombre (§7.1), et le
 * type le garantit — `taux` vaut `null` quand aucune affaire n'est décidée.
 */
function formaterTaux(taux: number, locale = 'fr-FR'): string {
	return new Intl.NumberFormat(locale, {
		style: 'percent',
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	}).format(taux)
}

export type ProprietesPilotage = {
	readonly client?: ClientCrm | null
}

export function Pilotage({ client = clientCrm }: ProprietesPilotage = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly LigneEntonnoirLue[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écraser un état plus récent — même garde
	// que `AffairesFigees`, `MaJournee` et `Carnet`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireEntonnoir(client)
			if (rang !== courant.current) return
			setEtat(lu)
		})()
	}, [client, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	// AUCUN CLIENT N'EST UN ÉTAT, PAS UNE ATTENTE (§5.33, §5.48). La configuration d'API absente ou
	// la session perdue rendent `clientCrm` nul ; laisser l'écran sur son squelette ferait attendre
	// indéfiniment une lecture que rien n'émettra — la page blanche déguisée que le §5.8 refuse.
	if (client === null) {
		return (
			<EtatVide
				titre={t('pilotage.noworkspace.title')}
				corps={t('pilotage.noworkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return (
			<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6">
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			</section>
		)
	}

	if (etat.statut === 'erreur') {
		// LE REFUS N'EST PAS DÉGUISÉ EN VIDE (§5.48). La fonction est refusée à l'anonyme PAR LE
		// PRIVILÈGE (§5.4) : elle rend `401`, jamais zéro ligne, et masquer ce `401` en « aucune
		// affaire » ferait lire une absence de DROIT comme un portefeuille vide.
		if (etat.erreur.nature === 'forbidden') {
			return (
				<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6">
					<EtatRefus titre={t('pilotage.forbidden.title')} corps={t('pilotage.forbidden.body')} />
				</section>
			)
		}
		return (
			<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6">
				<EtatErreur
					titre={t('pilotage.error.title')}
					corps={t(
						etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown',
					)}
					libelleReprise={t('state.error.retry')}
					onReprise={reprendre}
				/>
			</section>
		)
	}

	const lignes = etat.donnees
	const noeuds = replier(lignes)
	const groupes = grouperParDevise(noeuds)
	const previsions = previsionnel(lignes)
	const taux = tauxConversion(lignes)
	const manques = absences(lignes)

	// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION (§5.48), et c'est l'écart au §5.8 que la corbeille, le
	// carnet, les affaires figées et le panneau de notifications prennent déjà : une affaire se crée
	// depuis un board, que cet écran ne connaît pas, et y renvoyer conditionnellement au rôle ferait
	// calculer un droit à l'interface (`CLAUDE.md` §10).
	//
	// IL RECOUVRE DEUX SITUATIONS, ET C'EST DÉLIBÉRÉ : aucune affaire lisible, et aucune affaire
	// active. Les distinguer renseignerait un appelant sans droit sur l'existence d'affaires qu'il
	// ne lit pas (`docs/SPEC-permissions-rls.md` §7), et c'est la règle que le cumul des coûts, le
	// canevas d'objectifs et les affaires figées tiennent déjà.
	if (groupes.length === 0) {
		return (
			<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6">
				<EtatVide titre={t('pilotage.empty.title')} corps={t('pilotage.empty.body')} />
			</section>
		)
	}

	// LE TITRE DE DEVISE N'EST RENDU QUE S'IL Y EN A PLUSIEURS — la règle du §5.33, reprise sans
	// changement et pour son motif exact : deux tableaux empilés avec les mêmes en-têtes de colonne
	// ne diraient pas à l'œil que le second compte des francs, et sur une seule devise — le cas
	// attendu — le titre serait du bruit à chaque ouverture.
	const plusieursDevises = groupes.length > 1

	return (
		<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6 max-w-[960px]">
			<Grandeurs previsions={previsions} taux={taux} />
			{groupes.map((groupe) => (
				<Entonnoir
					key={groupe.devise}
					groupe={groupe}
					titreVisible={plusieursDevises}
				/>
			))}
			<Mentions manques={manques} />
		</section>
	)
}

/**
 * Les deux grandeurs dérivées, en tête d'écran — §7.1, §7.2, §5.48.
 *
 * UNE LISTE DE DÉFINITIONS ET NON UN TABLEAU (§5.20, §5.32) : le prévisionnel et le taux sont deux
 * couples terme / valeur qui NE SE COMPARENT PAS entre eux — l'un est de l'argent, l'autre une
 * proportion. Deux colonnes à partir de `md`, empilées en dessous ; `md` et jamais `sm`, qui est un
 * variant inconnu que Tailwind supprime en silence (§11, §5.20).
 */
function Grandeurs({
	previsions,
	taux,
}: {
	readonly previsions: readonly PrevisionnelDevise[]
	readonly taux: TauxConversion
}) {
	return (
		<dl
			data-testid="pilotage-grandeurs"
			className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<div className="flex flex-col gap-1">
				<dt className="text-sm text-text-2">{t('pilotage.forecast.term')}</dt>
				<dd data-testid="pilotage-previsionnel" className="flex flex-col gap-1">
					{previsions.length === 0 ? (
						/*
						  AUCUNE AFFAIRE OUVERTE NE REND AUCUN MONTANT, jamais « 0,00 ». Le module
						  garantit déjà qu'une devise entièrement close n'apparaît pas ; ici c'est le
						  portefeuille entier qui n'a aucune affaire ouverte, et un zéro se lirait
						  comme une prévision nulle au lieu d'une absence de prévision.
						*/
						<span className="text-text-2">{t('pilotage.forecast.none')}</span>
					) : (
						previsions.map((prevision) => (
							<span
								key={prevision.devise}
								data-testid="pilotage-previsionnel-devise"
								data-devise={prevision.devise}
								className="flex items-baseline gap-2"
							>
								{/*
								  LE CODE DEVISE OCCUPE SON PROPRE ÉLÉMENT, jamais un nœud de texte
								  accolé au nombre : c'est le défaut « Discussion1 » du §5.11, où
								  `gap` ne sépare pas un nœud anonyme.
								*/}
								<span className="text-h2 font-mono tabular-nums text-ink">
									{formaterMontant(prevision.montant)}
								</span>
								<span className="text-sm text-text-2">{prevision.devise}</span>
							</span>
						))
					)}
				</dd>
			</div>
			<div className="flex flex-col gap-1">
				{/*
				  LE TAUX PORTE SON NOM ENTIER, et jamais « taux de conversion » tout court (§7.1) :
				  ce nombre mesure la part gagnée parmi les affaires ACTUELLEMENT à un nœud terminal,
				  et non parmi les affaires entrées dans une période (§11.1). L'abréger ferait dire
				  au produit ce qu'il ne mesure pas.
				*/}
				<dt className="text-sm text-text-2">{t('pilotage.rate.term')}</dt>
				<dd data-testid="pilotage-taux" className="flex flex-col gap-1">
					{taux.taux === null ? (
						/*
						  ZÉRO AFFAIRE DÉCIDÉE REND UNE PHRASE, JAMAIS « 0 % » (§7.1, §5.48) : un taux
						  de 0 % dit « tout a été perdu », l'absence de toute décision ne dit rien.
						*/
						<span className="text-text-2">{t('pilotage.rate.unknown')}</span>
					) : (
						<>
							<span className="text-h2 font-mono tabular-nums text-ink">
								{formaterTaux(taux.taux)}
							</span>
							{/*
							  LE NUMÉRATEUR ET LE DÉNOMINATEUR SONT ÉCRITS EN TOUTES LETTRES : un
							  pourcentage nu ne dit pas sur combien il porte — le « chiffre qui ne dit
							  pas ce qu'il compte » que le §5.36 refuse. L'accord se fait par clé (§10).
							*/}
							<span data-testid="pilotage-taux-detail" className="text-[13px] text-text-2">
								{t(
									taux.gagnees > 1 ? 'pilotage.rate.detail' : 'pilotage.rate.detail.one',
									{ gagnees: String(taux.gagnees), decidees: String(taux.decidees) },
								)}
							</span>
						</>
					)}
				</dd>
			</div>
		</dl>
	)
}

/**
 * Un tableau de l'entonnoir, pour une devise — §5.48.
 *
 * UN TABLEAU DU §5.9 ET NON LA LISTE PLATE DU §5.18 : les colonnes sont les MÊMES pour chaque ligne
 * et SE COMPARENT d'un nœud à l'autre, ce qui est exactement la lecture qu'on vient faire ici.
 * C'est le critère que le §5.19 applique déjà au carnet.
 *
 * AUCUNE COLONNE N'EST TRIABLE, et c'est l'écart assumé avec le §5.9 : un entonnoir est un CHEMIN,
 * et le reclasser par montant en ferait un palmarès où « Perdu » remonterait au-dessus de
 * « Prospection ». L'ordre vient de `workflow_nodes_catalog.position`.
 */
function Entonnoir({
	groupe,
	titreVisible,
}: {
	readonly groupe: GroupeDevise
	readonly titreVisible: boolean
}) {
	const titre = t('pilotage.funnel.currency', { devise: groupe.devise })
	return (
		<section
			data-testid="pilotage-entonnoir"
			data-devise={groupe.devise}
			aria-label={titre}
			className="flex flex-col gap-2"
		>
			{titreVisible && <h2 className="text-h3 text-ink">{titre}</h2>}
			{/*
			  Le conteneur porte `.indique-debordement-x` (§12.6) : à 390 px les cinq colonnes ne
			  tiennent pas, et le tableau défile DANS SON CONTENEUR pendant que la page ne défile
			  jamais horizontalement (§7). Aucun `scroll-snap`, faute de colonne sur laquelle
			  s'ancrer (§5.9).
			*/}
			<div className="overflow-x-auto indique-debordement-x rounded-lg border border-border bg-surface">
				<table className="w-full border-collapse text-left">
					<caption className="sr-only">{titre}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>
								{t('pilotage.funnel.node')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('pilotage.funnel.kind')}
							</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('pilotage.funnel.deals')}
							</th>
							{/*
							  LES DEUX EN-TÊTES DE MONTANT NOMMENT LA DEVISE, ET C'EST UN DÉFAUT
							  TROUVÉ EN REGARDANT UNE CAPTURE (`CLAUDE.md` §16). Le titre `h2` n'est
							  rendu que s'il y a PLUSIEURS devises (§5.33) : sur une devise unique —
							  le cas attendu — plus rien à l'œil ne disait de quelle monnaie ces
							  nombres sont, hors le prévisionnel d'un bloc plus haut. C'est
							  exactement le « montant nu » que le §7.3 refuse, transposé au tableau.
							*/}
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('pilotage.funnel.amount', { devise: groupe.devise })}
							</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('pilotage.funnel.weighted', { devise: groupe.devise })}
							</th>
						</tr>
					</thead>
					<tbody>
						{groupe.noeuds.map((noeud) => (
							<LigneNoeud key={noeud.idNoeud} noeud={noeud} />
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}

function LigneNoeud({ noeud }: { readonly noeud: NoeudEntonnoir }) {
	return (
		<tr
			data-testid="pilotage-ligne"
			data-noeud={noeud.cle}
			className="border-b border-border last:border-b-0 hover:bg-hover"
		>
			{/*
			  `th scope="row"` ALIGNÉ À GAUCHE EXPLICITEMENT : un `th` est CENTRÉ par défaut, et
			  l'alignement s'écrit sur la cellule — la règle générale que le §5.30 a payée en
			  regardant une capture.
			*/}
			<th scope="row" className={`${CLASSES_CELLULE} font-medium text-left`} title={noeud.libelle}>
				{noeud.libelle}
			</th>
			{/*
			  LE GENRE EST UN MOT, jamais une teinte (§1) — et ce sont les mots EXACTS du §5.18. Il
			  n'est pas décoratif : c'est lui, et lui seul, qui dit pourquoi la ligne « Livré » ne
			  figure pas dans le prévisionnel de la tête d'écran.
			*/}
			<td data-testid="pilotage-genre" className={CLASSES_CELLULE}>
				{t(CLES_GENRE[noeud.genre])}
			</td>
			<td data-testid="pilotage-affaires" className={CLASSES_CELLULE_TECHNIQUE}>
				{noeud.affaires}
			</td>
			<td data-testid="pilotage-montant" className={CLASSES_CELLULE_TECHNIQUE}>
				{formaterMontant(noeud.montant)}
			</td>
			<td data-testid="pilotage-pondere" className={CLASSES_CELLULE_TECHNIQUE}>
				{formaterMontant(noeud.montantPondere)}
			</td>
		</tr>
	)
}

/**
 * Les deux mentions obligatoires du §7.3, puis la phrase de portée — §5.48.
 *
 * ELLES TRAVERSENT LES DEVISES, ET C'EST LICITE : ce sont des AFFAIRES, pas de l'argent. C'est le
 * motif exact pour lequel le module fait traverser les devises au seul compte des affaires
 * décidées — il n'additionne aucune monnaie.
 *
 * CHACUNE N'EST RENDUE QUE SI SON COMPTE EST NON NUL : « 0 affaire sans montant » est une phrase
 * qui ne dit rien, et le §5.31 a déjà tranché ce cas pour son badge.
 */
function Mentions({
	manques,
}: {
	readonly manques: { readonly sansMontant: number; readonly sansProbabilite: number }
}) {
	return (
		<div className="flex flex-col gap-1">
			{manques.sansMontant > 0 && (
				<p data-testid="pilotage-sans-montant" className="text-[13px] text-text-2">
					{t(
						manques.sansMontant > 1 ? 'pilotage.missing.amount' : 'pilotage.missing.amount.one',
						{ compte: String(manques.sansMontant) },
					)}
				</p>
			)}
			{manques.sansProbabilite > 0 && (
				<p data-testid="pilotage-sans-probabilite" className="text-[13px] text-text-2">
					{t(
						manques.sansProbabilite > 1
							? 'pilotage.missing.probability'
							: 'pilotage.missing.probability.one',
						{ compte: String(manques.sansProbabilite) },
					)}
				</p>
			)}
			{/*
			  LA PORTÉE DU CALCUL EST ÉCRITE, jamais supposée comprise — même place, même graduation
			  et même motif qu'au §5.33 : l'entonnoir est calculé APRÈS la RLS (§5.3), et deux
			  profils lisent donc deux nombres différents sur les mêmes données. Sans cette phrase,
			  l'écart se lirait comme une erreur de calcul, et quelqu'un finirait par « corriger » la
			  lecture. Elle dit aussi la portée workspace de la tranche 3 a (§8).
			*/}
			<p data-testid="pilotage-portee" className="text-[13px] text-text-2">
				{t('pilotage.scope')}
			</p>
		</div>
	)
}
