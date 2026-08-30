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
// LA PORTÉE SE CHOISIT DEPUIS LA TRANCHE 3 b, ET ELLE NE RELIT RIEN (`docs/SPEC-analytique.md`
// §8 bis.3). La fonction rend déjà le grain le plus fin (§5.2) et le module porte `restreindre`,
// éprouvé : changer de portée replie des lignes DÉJÀ lues. Un appel par portée aurait fait de ce
// sélecteur un filtre serveur, c'est-à-dire une seconde définition de la restriction.
//
// @spec CRM-066 — TRANCHE 3 b : le sélecteur de portée
// @spec docs/SPEC-analytique.md §8 bis.2 (l'adresse porte DEUX clés, et M8 l'impose),
//       §8 bis.3 (changer de portée ne relit rien ; les grandeurs et les mentions suivent la
//       portée), §8 bis.4 (la seconde lecture, et son échec qui ne casse pas l'écran)
// @spec docs/DESIGN_SYSTEM.md §5.48 bis (le sélecteur, sa place, ses états, la phrase de portée)
//
// @spec CRM-066 — TRANCHE 3 c : les nœuds du catalogue sans affaire, NOMMÉS
// @spec docs/SPEC-analytique.md §8 bis.5 (la forme tranchée : un nom, jamais un zéro), §5.1 (révisé
//       sur place par cette tranche), §11.2 (aucune addition de deux devises)
// @spec docs/DESIGN_SYSTEM.md §5.48 bis (la mention des nœuds vides, sa place et sa graduation)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	absences,
	grouperParDevise,
	lireEntonnoir,
	lireNoeudsCatalogue,
	noeudsSansAffaire,
	previsionnel,
	replier,
	restreindre,
	tauxConversion,
	type GenreNoeud,
	type GroupeDevise,
	type LigneEntonnoirLue,
	type NoeudCatalogue,
	type NoeudEntonnoir,
	type PrevisionnelDevise,
	type TauxConversion,
} from '../lib/analytique'
import {
	CLE_URL_CHANNEL,
	CLE_URL_TRACK,
	ecrirePorteeUrl,
	lirePorteeUrl,
	lirePorteesOffrables,
	nommerPortee,
	porteeAnalytique,
	porteeDepuisOption,
	resoudrePorteeUrl,
	valeurOption,
	type PorteeUrl,
	type TrackPortee,
} from '../lib/pilotage-portee'
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

	// L'ESPACE DE TRAVAIL VIENT DE L'ENTONNOIR LUI-MÊME, ET NON D'UNE LECTURE SÉPARÉE (§8 bis.4).
	// `entonnoir_conversion()` rend `workspace_id` sur chaque ligne : la portée offerte est donc
	// celle de ce qui est RÉELLEMENT mesuré, structurellement, plutôt que celle qu'une lecture
	// séparée de `workspaces` aurait nommée — deux sources pour un même fait finissent par
	// diverger, et c'est le mode de défaillance qu'INC-138 et la décision 560 ont déjà coûté.
	// Aucune ligne ne rend aucun espace : il n'y a alors rien à découper, et l'écran rend son état
	// vide sans sélecteur.
	const idWorkspace = etat.statut === 'pret' ? (etat.donnees[0]?.workspace_id ?? null) : null

	const [portees, setPortees] = useState<EtatAsync<readonly TrackPortee[]>>(enChargement)
	const courantPortees = useRef(0)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const rang = ++courantPortees.current
		setPortees(enChargement())
		void (async () => {
			const lu = await lirePorteesOffrables(client, idWorkspace)
			if (rang !== courantPortees.current) return
			setPortees(lu)
		})()
	}, [client, idWorkspace, tentative])

	const arbre = useMemo(() => (portees.statut === 'pret' ? portees.donnees : []), [portees])

	// LA TROISIÈME LECTURE — le catalogue, pour NOMMER les nœuds vides (§8 bis.5). Elle est traitée
	// comme la seconde : son échec ne casse pas l'écran, et la mention n'est simplement pas écrite.
	// Nommer un nœud vide enrichit la lecture, il n'en est pas la condition.
	const [catalogue, setCatalogue] = useState<EtatAsync<readonly NoeudCatalogue[]>>(enChargement)
	const courantCatalogue = useRef(0)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const rang = ++courantCatalogue.current
		setCatalogue(enChargement())
		void (async () => {
			const lu = await lireNoeudsCatalogue(client, idWorkspace)
			if (rang !== courantCatalogue.current) return
			setCatalogue(lu)
		})()
	}, [client, idWorkspace, tentative])

	const noeudsCatalogue = useMemo(
		() => (catalogue.statut === 'pret' ? catalogue.donnees : []),
		[catalogue],
	)

	// LA PORTÉE APPLIQUÉE EST CELLE QUE L'ARBRE RÉSOUT, jamais celle que l'adresse demande
	// (§8 bis.2). Un slug inconnu ou fermé replie sur l'espace de travail, sans aucune erreur — et
	// le repli n'est pas silencieux à l'œil, puisque c'est cette valeur-ci que le sélecteur affiche
	// et que la phrase de portée nomme.
	const [parametres, setParametres] = useSearchParams()
	const demandee = lirePorteeUrl(parametres.get(CLE_URL_TRACK), parametres.get(CLE_URL_CHANNEL))
	const portee = resoudrePorteeUrl(demandee, arbre)

	const choisirPortee = useCallback(
		(choisie: PorteeUrl) => {
			// `replace` ET NON `push` : douze essais de portée ne doivent pas coûter douze retours
			// arrière pour quitter l'écran (§5.48 bis). L'adresse reste partageable — elle porte la
			// portée choisie.
			//
			// Les paramètres sont RECONSTRUITS et non fusionnés : cette route n'en porte aucun autre
			// (`docs/SPEC-analytique.md` §8), et fusionner laisserait derrière un `channel` orphelin
			// au passage d'une portée de channel à une portée de track — c'est-à-dire l'adresse
			// exacte que M8 rend inexploitable.
			setParametres(ecrirePorteeUrl(choisie), { replace: true })
		},
		[setParametres],
	)

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

	// LES QUATRE GRANDEURS SUIVENT LA PORTÉE, ET C'EST OPPOSABLE (§8 bis.3). Le prévisionnel, le
	// taux et les deux compteurs d'absence sont calculés sur les lignes RESTREINTES, jamais sur les
	// lignes lues : un prévisionnel d'espace de travail au-dessus d'un entonnoir de channel serait un
	// écran qui ment sur ce qu'il montre.
	const lignes = restreindre(etat.donnees, porteeAnalytique(portee, arbre))
	const noeuds = replier(lignes)
	const groupes = grouperParDevise(noeuds)
	const previsions = previsionnel(lignes)
	const taux = tauxConversion(lignes)
	const manques = absences(lignes)
	const nomPortee = nommerPortee(portee, arbre)
	const vides = noeudsSansAffaire(noeudsCatalogue, lignes)

	// LE SÉLECTEUR N'EST RENDU QUE S'IL Y A QUELQUE CHOSE À DÉCOUPER. Aucune ligne dans l'espace de
	// travail entier ne laisse aucune portion à isoler — et aucune lecture d'arborescence n'a même
	// pu partir, faute d'espace de travail à nommer.
	const selecteur =
		etat.donnees.length === 0 ? null : (
			<SelecteurPortee
				arbre={arbre}
				portee={portee}
				// LA DÉROGATION BORNÉE DU §5.22, tenue sans changement : pendant la lecture de sa
				// liste et après son échec, le contrôle est DÉSACTIVÉ. Ce n'est pas une extinction
				// selon le rôle — il n'y a alors rien à choisir, et un `select` vide mais actif serait
				// une commande morte. L'entonnoir, lui, est rendu : la liste n'est pas la condition
				// de la lecture (§8 bis.4).
				actif={portees.statut === 'pret' && arbre.length > 0}
				enChargement={portees.statut === 'chargement'}
				onChoix={choisirPortee}
			/>
		)

	// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION (§5.48), et c'est l'écart au §5.8 que la corbeille, le
	// carnet, les affaires figées et le panneau de notifications prennent déjà : une affaire se crée
	// depuis un board, que cet écran ne connaît pas, et y renvoyer conditionnellement au rôle ferait
	// calculer un droit à l'interface (`CLAUDE.md` §10).
	//
	// IL RECOUVRE DEUX SITUATIONS, ET C'EST DÉLIBÉRÉ : aucune affaire lisible, et aucune affaire
	// active. Les distinguer renseignerait un appelant sans droit sur l'existence d'affaires qu'il
	// ne lit pas (`docs/SPEC-permissions-rls.md` §7), et c'est la règle que le cumul des coûts, le
	// canevas d'objectifs et les affaires figées tiennent déjà.
	//
	// LE SÉLECTEUR SURVIT À L'ÉTAT VIDE, ET C'EST L'ÉCART DÉLIBÉRÉ AU §5.8 QUE LE §5.48 bis ÉCRIT.
	// Une portée sans affaire active rend l'état vide SOUS le sélecteur : le remplacer enfermerait
	// le lecteur dans une portée qu'il ne pourrait plus quitter qu'en éditant l'adresse.
	//
	// ET LE TEXTE N'EST PAS LE MÊME SELON QUE LA PORTÉE OU L'ESPACE ENTIER EST VIDE : « ouvrez une
	// affaire depuis un board » serait faux là où l'espace de travail en porte trente-neuf. Nommer
	// la portée CHOISIE ne divulgue rien — c'est le lecteur qui vient de la choisir.
	if (groupes.length === 0) {
		const videDePortee = portee.type !== 'workspace'
		return (
			<section aria-label={t('pilotage.aria')} className="flex flex-col gap-6">
				{selecteur}
				<EtatVide
					titre={t(videDePortee ? 'pilotage.empty.scope.title' : 'pilotage.empty.title')}
					corps={t(videDePortee ? 'pilotage.empty.scope.body' : 'pilotage.empty.body')}
				/>
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
			{/*
			  LE SÉLECTEUR EST EN TÊTE, AU-DESSUS DES DEUX GRANDEURS (§5.48 bis) : il qualifie tout ce
			  qui suit, et ce qui qualifie se lit avant ce qu'il qualifie — l'ordre que le §5.32 tient
			  déjà pour l'identité d'un budget devant son histogramme.
			*/}
			{selecteur}
			<Grandeurs previsions={previsions} taux={taux} />
			{groupes.map((groupe) => (
				<Entonnoir
					key={groupe.devise}
					groupe={groupe}
					titreVisible={plusieursDevises}
				/>
			))}
			<Mentions manques={manques} portee={portee} nomPortee={nomPortee} vides={vides} />
		</section>
	)
}

/**
 * Le sélecteur de portée — `docs/DESIGN_SYSTEM.md` §5.48 bis, `docs/SPEC-analytique.md` §8 bis.
 *
 * UN `select` NATIF ET NON UNE BARRE D'ONGLETS : le nombre de portées croît avec le nombre de
 * channels — six dans le jeu de démonstration, des dizaines dans un espace réel —, et une barre
 * d'onglets déborderait dès le troisième track. C'est le critère déjà écrit au §5.22 pour le champ
 * « Channel visé », et les `optgroup` sont le seul moyen natif de grouper des options sans réécrire
 * un sélecteur au clavier.
 *
 * IL AFFICHE LA PORTÉE RÉELLEMENT APPLIQUÉE, jamais celle que l'adresse demande : la valeur reçue
 * ici est déjà passée par `resoudrePorteeUrl`.
 */
function SelecteurPortee({
	arbre,
	portee,
	actif,
	enChargement: chargement,
	onChoix,
}: {
	readonly arbre: readonly TrackPortee[]
	readonly portee: PorteeUrl
	readonly actif: boolean
	readonly enChargement: boolean
	readonly onChoix: (portee: PorteeUrl) => void
}) {
	return (
		<div className="flex flex-col gap-1">
			{/*
			  UN `label` VISIBLE, jamais un `aria-label` seul (§8) : c'est un champ de formulaire, et
			  la règle du §5.22 ne souffre pas d'exception ici.
			*/}
			<label htmlFor="pilotage-portee" className="text-sm text-text-2">
				{t('pilotage.scope.label')}
			</label>
			<select
				id="pilotage-portee"
				data-testid="pilotage-selecteur-portee"
				className="h-[var(--size-target)] w-full max-w-[420px] rounded-md border border-border bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
				value={valeurOption(portee)}
				disabled={!actif}
				onChange={(evenement) => onChoix(porteeDepuisOption(evenement.target.value))}
			>
				{/*
				  « Tout l'espace de travail » EST HORS DE TOUT GROUPE et vient en tête : c'est le
				  défaut, et c'est la seule portée qui n'appartient à aucun track.
				*/}
				<option value="">{t('pilotage.scope.all')}</option>
				{/*
				  PENDANT LA LECTURE, UNE OPTION INERTE PLUTÔT QU'UNE LISTE VIDE — patron du §5.22 :
				  un sélecteur qui n'offre rien sans dire pourquoi se lit comme un espace sans track.
				*/}
				{chargement ? (
					<option value="chargement" disabled>
						{t('pilotage.scope.loading')}
					</option>
				) : null}
				{arbre.map((track) => (
					// L'INTITULÉ DU GROUPE EST UNE DONNÉE — le nom du track —, jamais une traduction
					// (§10).
					//
					// ET CHAQUE OPTION NOMME AUSSI SON TRACK, ce qui est un DÉFAUT TROUVÉ EN
					// REGARDANT UNE CAPTURE (`CLAUDE.md` §16) : un `select` FERMÉ ne rend que le
					// texte de l'option retenue, et l'intitulé de son groupe est invisible dans cet
					// état — celui que l'utilisateur voit en permanence. « Tout le track » s'y lisait
					// sans dire lequel, et un nom de channel sans dire de quel track, alors qu'il
					// n'est unique que dans son track (M8). La redondance dans la liste OUVERTE est
					// le prix de la justesse dans la liste FERMÉE, qui est le cas majoritaire : c'est
					// exactement l'arbitrage que le §5.48 a déjà rendu pour les en-têtes de montant.
					<optgroup key={track.id} label={track.nom}>
						<option value={valeurOption({ type: 'track', track: track.slug })}>
							{t('pilotage.scope.wholeTrack', { track: track.nom })}
						</option>
						{track.channels.map((channel) => (
							<option
								key={channel.id}
								value={valeurOption({
									type: 'channel',
									track: track.slug,
									channel: channel.slug,
								})}
							>
								{t('pilotage.scope.channelOption', {
									track: track.nom,
									channel: channel.nom,
								})}
							</option>
						))}
					</optgroup>
				))}
			</select>
		</div>
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
	portee,
	nomPortee,
	vides,
}: {
	readonly manques: { readonly sansMontant: number; readonly sansProbabilite: number }
	readonly portee: PorteeUrl
	readonly nomPortee: string | null
	readonly vides: readonly NoeudCatalogue[]
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
			  LES NŒUDS VIDES SONT NOMMÉS, SANS DEVISE ET SANS MONTANT (§8 bis.5, §5.48 bis). Ce que
			  l'écran sait d'eux est exactement « aucune affaire ne s'y trouve » — un COMPTE
			  d'affaires, qui traverse licitement les devises parce qu'il n'additionne aucun argent.
			  Un « 0,00 » dans le tableau d'une devise aurait affirmé une mesure que l'écran n'a pas
			  faite, et lui aurait inventé une devise qu'aucune affaire n'y porte.

			  ILS SONT NOMMÉS DANS L'ORDRE DU CATALOGUE, jamais un autre : l'entonnoir est un CHEMIN,
			  et l'ordre dit OÙ est le trou. La liste est composée par `Intl.ListFormat`, et non par
			  une concaténation : « a, b et c » n'est pas la même phrase dans deux langues, et le
			  §23 de `CLAUDE.md` interdit de construire une phrase par concaténation.
			*/}
			{vides.length > 0 && (
				<p data-testid="pilotage-noeuds-vides" className="text-[13px] text-text-2">
					{t(vides.length > 1 ? 'pilotage.empty.nodes' : 'pilotage.empty.nodes.one', {
						noeuds: new Intl.ListFormat('fr-FR', { style: 'long', type: 'conjunction' }).format(
							vides.map((noeud) => noeud.libelle),
						),
					})}
				</p>
			)}
			{/*
			  LA PORTÉE DU CALCUL EST ÉCRITE, jamais supposée comprise — même place, même graduation
			  et même motif qu'au §5.33 : l'entonnoir est calculé APRÈS la RLS (§5.3), et deux
			  profils lisent donc deux nombres différents sur les mêmes données. Sans cette phrase,
			  l'écart se lirait comme une erreur de calcul, et quelqu'un finirait par « corriger » la
			  lecture.

			  ELLE NOMME LA PORTÉE COURANTE depuis la tranche 3 b (§5.48 bis), là où la tranche 3 a
			  déclarait l'espace de travail en dur — et le nom du track ou du channel y est une
			  DONNÉE (§10). Un nom absent de l'arbre ramène à la phrase d'espace de travail, ce qui
			  est exactement la portée que `resoudrePorteeUrl` a déjà appliquée : les deux ne peuvent
			  pas diverger.
			*/}
			<p data-testid="pilotage-portee" className="text-[13px] text-text-2">
				{portee.type === 'workspace' || nomPortee === null
					? t('pilotage.scope')
					: t(portee.type === 'track' ? 'pilotage.scope.track' : 'pilotage.scope.channel', {
							nom: nomPortee,
						})}
			</p>
		</div>
	)
}
