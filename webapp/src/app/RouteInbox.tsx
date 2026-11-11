// @spec CRM-057 (docs/BACKLOG.md) — inbox globale : trois panneaux, arborescence, non classés
// @spec CRM-128 (docs/BACKLOG.md) — tranche T4 : l'entrée de tête « Mails préparés », leur liste du plus ancien au plus
//       récent, la relecture dans le formulaire d'envoi prérempli, l'adresse `?brouillon=<id>` lue au montage et retirée
//       — docs/SPEC-mails-prepares.md §6.1 ; docs/DESIGN_SYSTEM.md §5.90 ; décision 829
// @spec docs/SPEC-mail-subsystem.md §18.3 (les trois panneaux), §18.4 (jamais le HTML d'un
//       expéditeur), §18.5 (la pièce jointe saine), §18.1 (les compteurs sont ceux de l'appelant)
// @spec docs/DESIGN_SYSTEM.md §5.4 (inbox), §5.8 (états systématiques), §7 (responsive), §10
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 e : la SURFACE du sommeil de fil,
//       docs/SPEC-cards.md §16.15.4 (la pastille), §16.15.5 (le filtre est une composition),
//       §16.15.6 (le geste à deux visages) ; docs/DESIGN_SYSTEM.md §5.3 septies
// @spec CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis : la SURFACE de la suggestion,
//       docs/SPEC-contacts.md §8.8.2 (où le bloc s'ancre), §8.8.4 (les quatre états),
//       §8.8.5 (ce que le bloc écrit et ce qu'il tait), §8.8.6 (le geste et ses refus) ;
//       docs/DESIGN_SYSTEM.md §5.4 ter
// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : les pièces d'un message par la liste partagée et son aperçu
//       (docs/DESIGN_SYSTEM.md §5.80, docs/SPEC-pieces-jointes.md §5)
// @spec CRM-065 (docs/BACKLOG.md) — sous-tranche 2c : l'inbox adressable,
//       docs/SPEC-recherche.md §15 (ce que 2c livre), §13.5 (le message mène à l'inbox, et son
//       adresse porte le message), M16 (le classement décide du dossier)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 f : LE GROUPEMENT en fils,
//       docs/SPEC-cards.md §16.16.3 (ce que la liste énumère), §16.16.4 (ce que la sélection
//       désigne et ce que le panneau de lecture ouvre), §16.16.5 (le sommeil transposé au fil),
//       §16.16.6 (les compteurs de l'arborescence ne changent pas) ;
//       docs/DESIGN_SYSTEM.md §5.4 bis
// @spec CRM-055 (docs/BACKLOG.md) — tranche 2 : le DÉCLASSEMENT, c'est-à-dire retirer un message
//       de l'affaire où il était classé, docs/SPEC-mail-subsystem.md §16.5.5 (la surface, sa
//       confirmation dans le flux et la conséquence nommée), §16.5.2 (le contrat traduit) ;
//       docs/DESIGN_SYSTEM.md §5.3 quater (confirmation dans le flux, jamais en modale)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 3 : le MODE D'AFFICHAGE entre dans l'adresse,
//       docs/SPEC-cards.md §16.17.1 (la décision, son motif et le contrat ligne à ligne),
//       §16.15.5 point 3 (révisé le 2026-08-29), §16.12.4 (la clé, la valeur et le repli, réemployés)
// @spec docs/JOURNAL.md décision 327, décision 536, décision 551
// @spec CRM-093 (docs/BACKLOG.md) — tranche T4 : le retrait et l'acceptation d'une suggestion s'éteignent avec leur
//       motif quand la base refuse l'écriture de l'affaire visée ; docs/SPEC-droits-interface.md §4, §5 (« Inbox ») ;
// @spec CRM-057 (docs/BACKLOG.md) — tranche 2 : lu / non lu — docs/SPEC-mail-subsystem.md §18 bis.2 (le fil marqué lu
//       à l'ouverture, le marquage manuel qui ne se défait pas de lui-même, « Tout marquer comme lu », le total gardé),
//       §18 bis.4 (l'écran, l'échec qui ne change rien) ; docs/DESIGN_SYSTEM.md §5.4 quinquies ; décisions 715 et 716 ;
//       docs/DESIGN_SYSTEM.md §5.59
//
// TROIS PANNEAUX SUR GRAND ÉCRAN, UNE PILE EN DESSOUS DE 1024 PX — et la pile est une vraie pile,
// non trois colonnes rétrécies : à cette largeur, trois colonnes ne montreraient ni un objet, ni un
// expéditeur, ni un corps. Un bouton « Retour » remonte d'un cran.
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. Les compteurs, la liste et le message sont ce que la RLS laisse
// passer (§18.1) ; l'écran ne filtre rien et ne devine rien.
// @spec CRM-111 (docs/BACKLOG.md) — tranche T6.1 : l'arbre de l'inbox — « Non classés », puis le nœud « Affaires »,
//       sans track ni channel (docs/DESIGN_SYSTEM.md §5.4 ; docs/SPEC-rattachements.md §7, décisions 657 et 818)
// @spec CRM-137 (docs/BACKLOG.md) — le formulaire de classement porte le sélecteur cherchable et « Expéditeur connu »,
//       à la place du `select` (docs/DESIGN_SYSTEM.md §5.94 ; docs/SPEC-mail-subsystem.md §26.3 ; décision 893)
// @spec CRM-140 (docs/BACKLOG.md) — tranche T3 : le corps du message ouvert rendu par `CorpsMessage`, monté avec la clé du
//       message (docs/SPEC-mail-subsystem.md §30.5, §30.8 ; docs/DESIGN_SYSTEM.md §5.100)
// @spec CRM-144 (docs/BACKLOG.md) — tranche T3 : les trois entrées de l'outbox dans la tête des dossiers, la vue d'un
//       dossier d'envois à la place des panneaux de messages, son adresse `?envois=` (docs/DESIGN_SYSTEM.md §5.98 ;
//       docs/SPEC-mail-subsystem.md §28.6) — les panneaux eux-mêmes vivent dans `OutboxInbox.tsx`
// @spec CRM-138 (docs/BACKLOG.md) — tranche T3 : la rangée de commandes du message ouvert — le sommeil, « Marquer comme non
//       lu » libellé, « Effacer » —, l'entrée « Corbeille » en dernier dans la tête des dossiers, la corbeille à la place des
//       panneaux de messages, son adresse `?corbeille=oui`, le focus après effacement et restauration (docs/DESIGN_SYSTEM.md
//       §5.102, §5.4 quinquies révisé ; docs/SPEC-mail-subsystem.md §29.1 ; décisions 878, 917, 920 et 921) — les panneaux
//       vivent dans `CorbeilleInbox.tsx`

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
	CheckCheck,
	ChevronDown,
	ChevronRight,
	Inbox,
	Mail,
	MailCheck,
	MailOpen,
	MailX,
	Moon,
	Sparkles,
	Sun,
	TriangleAlert,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { ErreurDonnees, EtatAsync } from '../lib/async'
import { motifVisible, proprietesCommande, useEcriturePermise, type Capacite } from '../lib/capacites'
import {
	MEME_SELECTION,
	classerMessage,
	declasserMessage,
	filEstNonLu,
	idsNonLus,
	lireCheminCard,
	lireDossierDuMessage,
	messageMeConcerne,
	marquerLus,
	marquerNonLu,
	textePastille,
	useArborescence,
	useFilsEndormis,
	useMessage,
	useMessages,
	type ArbreInbox,
	type MessageComplet,
	type MessageListe,
	type NatureRefusClassement,
	type PageMessages,
	type Selection,
} from '../lib/inbox'
import { BasculeSommeil, CLE_PRESET_SOMMEIL, PastilleSommeil } from '../components/ui/Sommeil'
import { ECHEANCES_USUELLES, echeanceSaisie, echeanceUsuelle } from '../lib/sommeil-card'
// LA CLÉ, LA VALEUR ET LE REPLI VIENNENT DU MODULE QUI LES A ARRÊTÉS (§16.12.4), comme
// `PARAMETRE_MESSAGE` plus bas et pour le même motif : une chaîne écrite deux fois se désaccorde au
// premier ajustement, et les trois écrans qui portent cette bascule cesseraient de s'entendre.
import {
	CLE_URL_SOMMEIL,
	VALEUR_URL_SOMMEIL_VISIBLES,
	lireModeSommeil,
} from '../lib/filtre-sommeil'
import {
	echeanceFil,
	endormirFil,
	reveillerFil,
	type FilsEndormis,
	type IssueSommeilFil,
	type ModeFils,
} from '../lib/sommeil-fil'
import { composerFils, filDuMessage, grouperEnFils } from '../lib/fil-inbox'
// LA CLÉ VIENT DU MODULE QUI L'A ARRÊTÉE (docs/SPEC-recherche.md §13.5), jamais d'un littéral
// recopié ici : une chaîne écrite deux fois se désaccorde au premier ajustement, et la palette
// composerait alors une adresse que l'inbox n'honorerait plus. `colonnes-recherche` n'importe rien,
// ce qui le rend atteignable depuis n'importe où (décision 177).
import { PARAMETRE_MESSAGE } from '../lib/colonnes-recherche'
import { objetDeReponse } from '../lib/envoi'
import { PARAMETRE_BROUILLON, lireMailsPrepares, type MailPrepare } from '../lib/mails-prepares'
import { clientCrm } from '../lib/supabase'
import { FormulaireEnvoi } from './FormulaireEnvoi'
import { EchecChargement, Panneau } from './PanneauInbox'
import { EntreesEnvois, PanneauDetailEnvoi, PanneauListeEnvois, useEnvois } from './OutboxInbox'
import {
	PARAMETRE_ENVOIS,
	dossierEnvoiDepuisAdresse,
	lireComptesEnvois,
	type ComptesEnvois,
	type DossierEnvoi,
} from '../lib/outbox'
import { SelecteurClassement, lecteurBase } from './SelecteurClassement'
import { EntreeCorbeille, PanneauCorbeille, RangeeCommandesMessage } from './CorbeilleInbox'
import {
	PARAMETRE_CORBEILLE,
	VALEUR_CORBEILLE,
	corbeilleDepuisAdresse,
	lireCorbeilleMessages,
	type MessageEnCorbeille,
} from '../lib/corbeille-inbox'
import { lireRetentionCorbeille } from '../lib/corbeille'
import { useContexteEspace } from './ContexteEspace'
import {
	CLE_URL_PASTILLE,
	FiltrePastille,
	PastillesLigne,
	PastillesMessageOuvert,
	VidePastille,
	catalogueOuVide,
	lirePastilleFiltre,
	useCataloguePastilles,
	type CataloguePastilles,
} from './PastillesInbox'
import type { Candidate } from '../lib/candidats-classement'
import { ListePiecesJointes } from './PiecesJointes'
import { CorpsMessage } from './CorpsMessage'
import { CaseSeulementMoi, ExplicationSeulementMoi, VideSeulementMoi } from './SeulementMoi'
import { useAuthentification } from './Authentification'
import {
	CLE_URL_COURRIER,
	ecrireModeCourrier,
	filtreApplique,
	lireModeCourrier,
	lirePresenceIdentite,
	type ModeCourrier,
	type PresenceIdentite,
} from '../lib/seulement-moi'

/** Le panneau visible sous 1024 px. Sur grand écran, les trois sont montrés ensemble. */
type Etage = 'dossiers' | 'liste' | 'message'

const dateLisible = (iso: string): string =>
	new Date(iso).toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})

/**
 * Le texte d'un marquage refusé ou perdu (§18 bis.4). Il dit que l'état N'A PAS changé : l'écran ne l'a pas modifié, et
 * l'utilisateur ne doit pas croire qu'il l'a été.
 */
function texteErreurLecture(erreur: ErreurDonnees): string {
	if (erreur.nature === 'network') return t('inbox.read.error.network')
	if (erreur.nature === 'forbidden') return t('inbox.read.error.forbidden')
	return t('inbox.read.error.unknown')
}

// =================================================================================================
// Panneau 1 — les dossiers
// =================================================================================================

function BoutonDossier({
	libelle,
	nombre,
	nonLus,
	profondeur,
	choisi,
	onChoisir,
	depliage,
}: {
	readonly libelle: string
	readonly nombre: number
	/** Les non lus de l'appelant, À CÔTÉ du total (§5.4 quinquies, décision 716). */
	readonly nonLus: number
	readonly profondeur: 0 | 1 | 2
	readonly choisi: boolean
	readonly onChoisir?: () => void
	readonly depliage?: { readonly ouvert: boolean; readonly basculer: () => void }
}) {
	// L'ÉCHELLE D'ESPACEMENT EST FERMÉE (docs/DESIGN_SYSTEM.md §3) : 4, 8, 12, 16, 24, 32, 48 px,
	// et rien entre. `pl-7` ou `pl-11` n'existent tout simplement pas — mesuré, ils ne sont pas
	// engendrés et le retrait disparaît en silence. Trois niveaux, trois pas de l'échelle.
	const indentation = ['pl-3', 'pl-6', 'pl-12'][profondeur]
	const pastille = textePastille(nonLus)
	return (
		<div className="flex items-stretch">
			{depliage !== undefined ? (
				<button
					type="button"
					aria-expanded={depliage.ouvert}
					aria-label={depliage.ouvert ? t('inbox.folders.collapse') : t('inbox.folders.expand')}
					onClick={depliage.basculer}
					className="flex items-center justify-center min-h-[var(--size-target)] w-8 text-text-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
				>
					{depliage.ouvert ? (
						<ChevronDown aria-hidden="true" size={16} />
					) : (
						<ChevronRight aria-hidden="true" size={16} />
					)}
				</button>
			) : null}
			<button
				type="button"
				// LA SÉLECTION S'ANNONCE, elle ne se contente pas d'une teinte : une sélection qui
				// n'existe qu'en couleur n'existe pas pour un lecteur d'écran (§5.4).
				aria-current={choisi ? 'true' : undefined}
				onClick={onChoisir}
				disabled={onChoisir === undefined}
				className={[
					// `min-w-0` SUR LE BOUTON, ET PAS SEULEMENT SUR SON TEXTE — mesuré : un élément de
					// flexbox a `min-width: auto` et refuse de rétrécir sous la largeur de son
					// contenu. Le bouton faisait 298 px dans un panneau de 263, débordait du cadre et
					// emportait son compteur hors de l'écran ; `truncate` sur le texte n'y pouvait
					// rien, faute d'une largeur à respecter. Défaut vu en capture, pas en test.
					'flex-1 min-w-0 flex items-center justify-between gap-2 text-left',
					'min-h-[var(--size-target)] pr-3 py-1',
					depliage === undefined ? indentation : 'pl-1',
					'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
					choisi ? 'bg-brand-soft text-brand font-medium' : 'text-ink hover:bg-hover',
					// LE NŒUD QUI PORTE UN NON LU PASSE EN GRAISSE MOYENNE (§5.4 quinquies) : la forme, et pas la seule
					// pastille, dit où aller.
					pastille !== null ? 'font-medium' : '',
					onChoisir === undefined ? 'cursor-default' : '',
				].join(' ')}
			>
				{/* `min-w-0` N'EST PAS DÉCORATIF, ET LE DÉFAUT A ÉTÉ VU EN CAPTURE : un élément de
				    flexbox a `min-width: auto` par défaut, donc refuse de rétrécir sous la largeur
				    de son texte. Sans lui, « Refonte intranet Ville de Lyon » débordait du panneau
				    et POUSSAIT son compteur hors de l'écran — `truncate` restait sans effet. */}
				<span className="truncate min-w-0">{libelle}</span>
				<span className="shrink-0 flex items-center gap-2">
					{/* LA PASTILLE DE LA CLOCHE (§5.43), RÉEMPLOYÉE : `aria-hidden`, parce que la phrase qui suit porte le
					    compte EXACT — « 99+ » annoncé tel quel dirait un nombre faux. Absente à zéro. */}
					{pastille === null ? null : (
						<>
							<span
								aria-hidden="true"
								data-testid="inbox-dossier-non-lus"
								className="min-w-4 px-1 rounded-full bg-brand text-white text-xs tabular-nums leading-tight text-center font-normal"
							>
								{pastille}
							</span>
							<span className="sr-only">
								{nonLus === 1
									? t('inbox.folders.unread.one')
									: t('inbox.folders.unread.many', { n: String(nonLus) })}
							</span>
						</>
					)}
					{/* LE TOTAL RESTE (décision 716) : un chiffre gris contre un aplat de marque, deux formes. */}
					<span className="text-sm text-text-3 tabular-nums font-normal">{nombre}</span>
				</span>
			</button>
		</div>
	)
}

/**
 * L'entrée de tête « Mails préparés » (§5.90) : le patron de `BoutonDossier` — compte en `--color-text-3` et pastille du
 * §5.43 qui porte le même nombre, puisque tout mail préparé attend un geste —, précédé de `MailCheck`. Le nom accessible
 * dit le compte entier.
 */
function EntreeMailsPrepares({
	nombre,
	choisi,
	onChoisir,
	refBouton,
}: {
	readonly nombre: number
	readonly choisi: boolean
	readonly onChoisir: () => void
	readonly refBouton: React.RefObject<HTMLButtonElement | null>
}) {
	const pastille = textePastille(nombre)
	return (
		<button
			ref={refBouton}
			type="button"
			aria-current={choisi ? 'true' : undefined}
			aria-label={
				nombre === 1
					? t('mailsPrepares.entree.aria.one')
					: t('mailsPrepares.entree.aria.many', { n: String(nombre) })
			}
			onClick={onChoisir}
			data-testid="inbox-mails-prepares"
			className={[
				'w-full min-w-0 flex items-center justify-between gap-2 text-left font-medium',
				'min-h-[var(--size-target)] pl-3 pr-3 py-1',
				'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
				choisi ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-hover',
			].join(' ')}
		>
			<span className="flex items-center gap-2 min-w-0">
				<MailCheck aria-hidden="true" size={16} className="shrink-0" />
				<span className="truncate min-w-0">{t('mailsPrepares.entree')}</span>
			</span>
			<span aria-hidden="true" className="shrink-0 flex items-center gap-2">
				{pastille === null ? null : (
					<span className="min-w-4 px-1 rounded-full bg-brand text-white text-xs tabular-nums leading-tight text-center font-normal">
						{pastille}
					</span>
				)}
				<span className="text-sm text-text-3 tabular-nums font-normal">{nombre}</span>
			</span>
		</button>
	)
}

/** La liste des mails préparés (§5.90) : une file de travail, du plus ancien au plus récent. */
function PanneauListePrepares({
	etat,
	idOuvert,
	onOuvrir,
	onRetour,
	onReprise,
	visible,
	refVide,
}: {
	readonly etat: EtatAsync<readonly MailPrepare[]>
	readonly idOuvert: string | null
	readonly onOuvrir: (id: string) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly visible: boolean
	readonly refVide: React.RefObject<HTMLDivElement | null>
}) {
	return (
		<Panneau
			id="prepares"
			titre={t('mailsPrepares.entree')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-list)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.folders')}
				</Button>
			}
		>
			{etat.statut === 'chargement' ? <SkeletonListe lignes={3} libelle={t('state.loading.aria')} /> : null}
			{etat.statut === 'erreur' ? <EchecChargement erreur={etat.erreur} onReprise={onReprise} /> : null}
			{etat.statut === 'pret' && etat.donnees.length === 0 ? (
				// LA CIBLE DU FOCUS QUAND LE DERNIER MAIL PART (§5.13) : l'entrée de tête a disparu avec lui.
				<div ref={refVide} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-brand">
					<EtatVide titre={t('mailsPrepares.liste.vide')} corps="" />
				</div>
			) : null}
			{etat.statut === 'pret' && etat.donnees.length > 0 ? (
				<ul data-testid="inbox-liste-prepares">
					{etat.donnees.map((mail) => (
						<li key={mail.id} className="border-b border-border">
							<button
								type="button"
								aria-current={mail.id === idOuvert ? 'true' : undefined}
								onClick={() => onOuvrir(mail.id)}
								data-testid="inbox-mail-prepare"
								data-mail={mail.id}
								className={[
									'w-full text-left flex flex-col gap-1 px-3 py-2 min-h-[var(--size-target)]',
									'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
									mail.id === idOuvert ? 'bg-brand-soft' : 'hover:bg-hover',
								].join(' ')}
							>
								<span className="text-sm text-text-2 break-words">{mail.destinataires.join(', ')}</span>
								<span className="font-medium break-words">{mail.objet}</span>
								{mail.titreCard === null ? null : (
									<span className="text-sm text-text-2 break-words">{mail.titreCard}</span>
								)}
								<span className="flex flex-wrap items-center gap-2">
									<span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 text-xs text-text-2">
										<Sparkles aria-hidden="true" size={12} />
										{mail.origine === 'mcp' ? t('mailsPrepares.origine.mcp') : t('mailsPrepares.origine.web')}
									</span>
									<span className="font-mono text-xs text-text-3 tabular-nums">
										{new Date(mail.creeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
		</Panneau>
	)
}

/** La relecture d'un mail préparé (§5.90) : le bandeau « pas envoyé », l'affaire, puis le formulaire d'envoi prérempli. */
function PanneauRelecture({
	etat,
	idOuvert,
	onRetour,
	onEnvoye,
	onEcarte,
	onPlusEnAttente,
	visible,
}: {
	readonly etat: EtatAsync<readonly MailPrepare[]>
	readonly idOuvert: string | null
	readonly onRetour: () => void
	readonly onEnvoye: () => void
	readonly onEcarte: () => void
	readonly onPlusEnAttente: () => void
	readonly visible: boolean
}) {
	const mail = etat.statut === 'pret' ? (etat.donnees.find((candidat) => candidat.id === idOuvert) ?? null) : null
	const idCardMail = mail?.idCard ?? null
	const [cheminCard, setCheminCard] = useState<{ readonly titre: string; readonly adresse: string } | null>(null)
	useEffect(() => {
		setCheminCard(null)
		if (idCardMail === null) return
		let vivant = true
		void lireCheminCard(clientCrm, idCardMail).then((lu) => {
			if (vivant) setCheminCard(lu)
		})
		return () => {
			vivant = false
		}
	}, [idCardMail])
	return (
		<Panneau
			id="relecture"
			titre={t('mailsPrepares.relecture.titre')}
			visible={visible}
			classe="flex-1 w-full min-w-0"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('mailsPrepares.retour')}
				</Button>
			}
		>
			{etat.statut === 'chargement' ? <SkeletonListe lignes={3} libelle={t('state.loading.aria')} /> : null}
			{etat.statut === 'pret' && idOuvert === null ? (
				<EtatVide titre={t('mailsPrepares.relecture.aucun.titre')} corps={t('mailsPrepares.relecture.aucun.corps')} />
			) : null}
			{etat.statut === 'pret' && idOuvert !== null && mail === null ? (
				// ABSENT, ÉCARTÉ, ENVOYÉ OU À AUTRUI : UNE SEULE PHRASE (§5.90) — rien ne distingue l'absent de l'interdit.
				<div data-testid="inbox-relecture-plus-en-attente">
					<EtatVide titre={t('mailsPrepares.refus.plusEnAttente.titre')} corps="" />
				</div>
			) : null}
			{mail === null ? null : (
				<article className="flex flex-col gap-4 p-4" data-testid="inbox-relecture">
					<p role="note" className="flex items-start gap-2 rounded-sm bg-accent-soft p-3 text-sm text-accent-on-soft">
						<TriangleAlert aria-hidden="true" size={16} className="shrink-0 mt-[2px]" />
						{t('mailsPrepares.relecture.consigne')}
					</p>
					{cheminCard === null ? null : (
						<p>
							<Link
								to={cheminCard.adresse}
								data-testid="inbox-relecture-card"
								className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
							>
								{cheminCard.titre}
							</Link>
						</p>
					)}
					<FormulaireEnvoi
						key={mail.id}
						idCard={mail.idCard}
						mailPrepare={mail}
						onEnvoye={onEnvoye}
						onEcarte={onEcarte}
						onPlusEnAttente={onPlusEnAttente}
					/>
				</article>
			)}
		</Panneau>
	)
}

/** `CRM-111` T6.1 : la clé de dépliage du nœud « Affaires », distincte de tout identifiant d'affaire. */
const NOEUD_AFFAIRES = 'affaires'

function PanneauDossiers({
	etat,
	selection,
	onChoisir,
	onReprise,
	visible,
	mailsPrepares,
	preparesChoisis,
	onChoisirPrepares,
	refEntreePrepares,
	courrier,
	envois,
	corbeille,
}: {
	/** `CRM-138` T3 (§5.102) : l'entrée « Corbeille », la dernière de la tête, toujours rendue. */
	readonly corbeille: {
		readonly nombre: number | null
		readonly choisie: boolean
		readonly onChoisir: () => void
		readonly refBouton: React.RefObject<HTMLButtonElement | null>
	}
	/** `CRM-144` T3 (§5.98) : les trois entrées de l'outbox, après « Mails préparés » et avant « Non classés ». */
	readonly envois: {
		readonly comptes: EtatAsync<ComptesEnvois>
		readonly choisi: DossierEnvoi | null
		readonly onChoisir: (dossier: DossierEnvoi) => void
		readonly refs: Readonly<Record<DossierEnvoi, React.RefObject<HTMLButtonElement | null>>>
	}
	/** `CRM-139` (§5.96) : la case « Seulement moi », dans l'en-tête des dossiers. */
	readonly courrier: {
		readonly mode: ModeCourrier
		readonly presence: PresenceIdentite
		readonly onMode: (mode: ModeCourrier) => void
		readonly onReprise: () => void
	}
	readonly etat: EtatAsync<ArbreInbox>
	readonly selection: Selection | null
	readonly onChoisir: (choix: Selection) => void
	readonly onReprise: () => void
	readonly visible: boolean
	readonly mailsPrepares: EtatAsync<readonly MailPrepare[]>
	readonly preparesChoisis: boolean
	readonly onChoisirPrepares: () => void
	readonly refEntreePrepares: React.RefObject<HTMLButtonElement | null>
}) {
	const [replies, setReplies] = useState<ReadonlySet<string>>(new Set())
	const basculer = useCallback((cle: string) => {
		setReplies((precedent) => {
			const suivant = new Set(precedent)
			if (suivant.has(cle)) suivant.delete(cle)
			else suivant.add(cle)
			return suivant
		})
	}, [])

	const idAideCourrier = useId()
	return (
		<Panneau
			id="dossiers"
			titre={t('inbox.folders.title')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-folders)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				// LA CASE QUALIFIE L'ARBORESCENCE ET LA LISTE : elle se lit avant elles, et reste rendue sur un vide (§5.96).
				<CaseSeulementMoi
					mode={courrier.mode}
					presence={courrier.presence}
					onMode={courrier.onMode}
					idAide={idAideCourrier}
				/>
			}
		>
			<ExplicationSeulementMoi presence={courrier.presence} idAide={idAideCourrier} onReprise={courrier.onReprise} />
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : null}
			{etat.statut === 'erreur' ? <EchecChargement erreur={etat.erreur} onReprise={onReprise} /> : null}
			{etat.statut === 'pret' ? (
				<nav aria-label={t('inbox.folders.aria')}>
					<ul>
						{/* `CRM-128` T4 (§5.90) : « Mails préparés » ouvre la tête, AVANT « Non classés », et n'existe que si la
						    personne en a en attente — absente pendant la lecture et sur son échec, jamais devinée (§5.31). */}
						{mailsPrepares.statut === 'pret' && mailsPrepares.donnees.length > 0 ? (
							<li>
								<EntreeMailsPrepares
									nombre={mailsPrepares.donnees.length}
									choisi={preparesChoisis}
									onChoisir={onChoisirPrepares}
									refBouton={refEntreePrepares}
								/>
							</li>
						) : null}
					</ul>
					{/* `CRM-144` T3 (§5.98) : l'outbox, toujours rendue, à zéro compris. */}
					<EntreesEnvois comptes={envois.comptes} choisi={envois.choisi} onChoisir={envois.onChoisir} refs={envois.refs} />
					<ul>
						{/* « Non classés » reste affiché MÊME À ZÉRO : c'est l'entrée du travail de tri,
						    et sa disparition ferait croire à une panne (§18.3). */}
						<li>
							<BoutonDossier
								libelle={t('inbox.folders.unclassified')}
								nombre={etat.donnees.nonClasses}
								nonLus={etat.donnees.nonClassesNonLus}
								profondeur={0}
								choisi={
									!preparesChoisis && envois.choisi === null && !corbeille.choisie && selection?.genre === 'non-classes'
								}
								onChoisir={() => onChoisir({ genre: 'non-classes' })}
							/>
						</li>
					</ul>
					{/* `CRM-111` T6.1 (§5.4) : un seul nœud « Affaires », plus de track ni de channel — le dossier d'une affaire vit
					    sous `CRM/Affaires/`, et une affaire partagée n'en a qu'un. */}
					{etat.donnees.affaires.cards.length === 0 ? (
						<EtatVide titre={t('inbox.folders.empty.title')} corps={t('inbox.folders.empty.body')} />
					) : (
						<ul className="border-t border-border mt-1 pt-1">
							<li>
								<BoutonDossier
									libelle={t('inbox.folders.cards')}
									nombre={etat.donnees.affaires.nombre}
									nonLus={etat.donnees.affaires.nonLus}
									profondeur={0}
									choisi={false}
									depliage={{
										ouvert: !replies.has(NOEUD_AFFAIRES),
										basculer: () => basculer(NOEUD_AFFAIRES),
									}}
								/>
								{replies.has(NOEUD_AFFAIRES) ? null : (
									<ul>
										{etat.donnees.affaires.cards.map((card) => (
											<li key={card.id}>
												<BoutonDossier
													libelle={card.titre}
													nombre={card.nombre}
													nonLus={card.nonLus}
													profondeur={1}
													choisi={selection?.genre === 'card' && selection.cardId === card.id}
													onChoisir={() => onChoisir({ genre: 'card', cardId: card.id })}
												/>
											</li>
										))}
									</ul>
								)}
							</li>
						</ul>
					)}
					{/* `CRM-138` T3 (§5.102) : « Corbeille », la dernière, séparée par une bordure haute, à zéro compris. */}
					<EntreeCorbeille
						nombre={corbeille.nombre}
						choisie={corbeille.choisie}
						onChoisir={corbeille.onChoisir}
						refBouton={corbeille.refBouton}
					/>
				</nav>
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// Panneau 2 — la liste
// =================================================================================================

function PanneauListe({
	etat,
	selection,
	idOuvert,
	onOuvrir,
	onRetour,
	onReprise,
	visible,
	fils,
	mode,
	onMode,
	maintenant,
	onToutMarquer,
	erreurMarquage,
	filtreCourrier,
	onToutAfficher,
	catalogue,
	pastille,
	onPastille,
}: {
	/** `CRM-141` T4 (§31.7) : le catalogue des pastilles lisibles, pour les pilules des lignes et le filtre. */
	readonly catalogue: CataloguePastilles
	/** Le filtre « Pastille » en vigueur, lu dans l'adresse ; `null` sans filtre. */
	readonly pastille: string | null
	readonly onPastille: (id: string | null) => void
	/** `CRM-139` (§27.4) : le filtre « Seulement moi » s'applique-t-il à cette liste ? */
	readonly filtreCourrier: boolean
	/** Le geste du vide sous le filtre : décocher la case. */
	readonly onToutAfficher: () => void
	readonly etat: EtatAsync<PageMessages>
	readonly selection: Selection | null
	readonly idOuvert: string | null
	readonly onOuvrir: (message: MessageListe) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly visible: boolean
	readonly fils: FilsEndormis
	readonly mode: ModeFils
	readonly onMode: (mode: ModeFils) => void
	/** L'instant du filtre, calculé UNE FOIS par rendu et partagé par toutes les lignes (§16.15.4). */
	readonly maintenant: Date
	/** « Tout marquer comme lu » : les identifiants non lus des fils affichés (§18 bis.2 point 5). */
	readonly onToutMarquer: (ids: readonly string[]) => void
	/** L'échec du dernier « Tout marquer comme lu », lu dans la liste ; `null` sinon. */
	readonly erreurMarquage: ErreurDonnees | null
}) {
	// LA COMPOSITION SE FAIT ICI, ET LA MESURE G L'IMPOSE : aucune requête ne peut demander « les
	// messages dont le fil n'est pas endormi », `app.cle_fil` vivant dans le schéma `app` que
	// PostgREST n'expose pas (§16.15.5). LE GROUPEMENT SUIT LA MÊME CONTRAINTE (§16.16.9) et se
	// fait donc au même endroit, sur la même page.
	//
	// L'ORDRE DES DEUX EST IMPOSÉ : grouper D'ABORD, filtrer ENSUITE. Filtrer des messages puis
	// grouper le reste ferait apparaître un fil amputé de ses messages endormis — or un fil est
	// endormi tout entier ou pas du tout (§16.16.5), et son compte deviendrait faux.
	const tous = etat.statut === 'pret' ? grouperEnFils(etat.donnees.messages) : []
	const compose =
		etat.statut === 'pret'
			? composerFils(tous, fils, mode, maintenant, idOuvert)
			: { visibles: [], masques: 0 }

	// L'ACTION N'EST PAS RÉPÉTÉE, ET C'EST UN DÉFAUT VU EN CAPTURE (docs/DESIGN_SYSTEM.md §5.3
	// quinquies, §5.8) : quand l'état vide porte la bascule, l'en-tête ne la porte plus. Les deux
	// ensemble donnaient DEUX cases à cocher identiques dans le même panneau, à quelques
	// centimètres l'une de l'autre — l'utilisateur ne pouvait que se demander si elles font la même
	// chose.
	const videParSommeil =
		etat.statut === 'pret' && selection !== null && compose.visibles.length === 0 && compose.masques > 0
	// « TOUT MARQUER COMME LU » PORTE SUR LES FILS AFFICHÉS, et il est absent quand aucun n'est non lu (§5.4
	// quinquies) : un geste sans effet possible ne s'offre pas.
	const nonLusAffiches = idsNonLus(compose.visibles.flatMap((fil) => fil.messages))
	// `CRM-141` T4 — LA RANGÉE D'ACTION EN TÊTE DE LA LISTE (§5.4 quinquies, §5.103) : le filtre « Pastille » à gauche,
	// « Tout marquer comme lu » à droite ; elle passe à la ligne sous `md`. Le filtre RESTE RENDU sur une liste vide : il est
	// la cause possible de ce vide (§5.3 septies).
	const rangeeAction =
		selection !== null && etat.statut === 'pret' && (catalogue.size > 0 || nonLusAffiches.length > 0) ? (
			<div
				className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 border-b border-border"
				data-testid="inbox-rangee-action"
			>
				<FiltrePastille catalogue={catalogue} valeur={pastille} onChange={onPastille} />
				{nonLusAffiches.length > 0 ? (
					<Button
						variante="discret"
						taille="compacte"
						className="ml-auto"
						data-testid="inbox-tout-marquer-lu"
						onClick={() => onToutMarquer(nonLusAffiches)}
					>
						<CheckCheck aria-hidden="true" size={16} />
						{t('inbox.read.markAll')}
					</Button>
				) : null}
			</div>
		) : null
	return (
		<Panneau
			id="liste"
			titre={t('inbox.list.title')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-list)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				<div className="flex items-center gap-2">
					{/* ELLE RESTE RENDUE Y COMPRIS SUR UNE LISTE VIDE (§5.3 septies) : elle est la
					    cause possible de ce vide, et la masquer priverait l'utilisateur du seul
					    geste qui l'en sort. SAUF quand l'état vide la porte déjà — voir
					    `videParSommeil`. */}
					{videParSommeil ? null : (
						<BasculeSommeil
							mode={mode === 'visibles' ? 'visibles' : 'masquees'}
							onMode={(suivant) => onMode(suivant)}
							libelle={t('inbox.sleep.filter')}
						/>
					)}
					<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
						{t('inbox.back.folders')}
					</Button>
				</div>
			}
		>
			{erreurMarquage !== null ? (
				<p role="alert" data-testid="inbox-lecture-refus" className="px-3 py-2 text-sm text-danger">
					{texteErreurLecture(erreurMarquage)}
				</p>
			) : null}
			{selection === null ? (
				<EtatVide titre={t('inbox.list.unselected.title')} corps={t('inbox.list.unselected.body')} />
			) : null}
			{selection !== null && etat.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : null}
			{selection !== null && etat.statut === 'erreur' ? (
				<EchecChargement erreur={etat.erreur} onReprise={onReprise} />
			) : null}
			{rangeeAction}
			{selection !== null && etat.statut === 'pret' ? (
				compose.visibles.length === 0 ? (
					// L'ÉTAT VIDE NE MENT PAS, ET SANS REQUÊTE SUPPLÉMENTAIRE (§16.15.5 point 2) :
					// l'écran CONNAÎT le nombre de messages masqués, puisqu'il les a lus. Un vide dû
					// au sommeil le dit et porte la bascule qui l'en sort ; un dossier réellement
					// vide garde sa mention d'origine.
					compose.masques > 0 ? (
						<EtatVide
							titre={t('inbox.sleep.empty.title')}
							corps={t('inbox.sleep.empty.body')}
							action={
								<BasculeSommeil
									mode="masquees"
									onMode={() => onMode('visibles')}
									libelle={t('inbox.sleep.filter')}
								/>
							}
						/>
					) : pastille !== null ? (
						// `CRM-141` T4 (§5.103) : un vide sous le filtre « Pastille » nomme la pastille et porte le geste qui l'efface.
						<VidePastille nom={catalogue.get(pastille)?.nom ?? ''} onToutes={() => onPastille(null)} />
					) : filtreCourrier ? (
						// `CRM-139` (§5.96) : un vide sous le filtre porte le geste qui le lève. Le sommeil, jugé après le filtre,
						// garde son propre vide ci-dessus.
						<VideSeulementMoi onToutAfficher={onToutAfficher} />
					) : (
						<EtatVide titre={t('inbox.list.empty.title')} corps={t('inbox.list.empty.body')} />
					)
				) : (
					<>
						{/* « TOUT MARQUER COMME LU » VIT DANS LA RANGÉE D'ACTION EN TÊTE DE LA LISTE, ET NON DANS L'EN-TÊTE
						    (§5.4 quinquies) — défaut vu en capture : à 360 px, le titre, ce bouton et la bascule de sommeil ne
						    tenaient pas sur une ligne. La rangée est rendue plus haut (`rangeeAction`), avec le filtre « Pastille ». */}
						{/* LA LISTE ÉNUMÈRE DES FILS (§16.16.3), et son nom accessible le dit : le
						    laisser annoncer « Messages du dossier » ferait parcourir des messages à
						    un lecteur d'écran là où l'écran présente des fils. */}
						<ul aria-label={t('inbox.thread.list.aria')}>
							{compose.visibles.map((fil) => {
								// LE PRÉDICAT EST DÉCIDÉ UNE FOIS PAR FIL, avec l'instant du filtre, et
								// la pastille ne le rejuge jamais (§16.15.4). Le fil étant devenu la
								// ligne, cette information cesse d'être répétée sur chacun de ses
								// messages (§5.4 bis).
								const echeance = echeanceFil(fils, fil.workspaceId, fil.cleFil, maintenant)
								// LA LIGNE RESTE MARQUÉE TANT QUE LE MESSAGE OUVERT APPARTIENT AU FIL
								// (§16.16.4), et non seulement quand il en est le dernier : sans cela,
								// choisir un message plus ancien dans le sélecteur effacerait le repère
								// de sélection de la liste (§5.4).
								const choisi = fil.messages.some((message) => message.id === idOuvert)
								// UN FIL EST NON LU DÈS QU'UN DE SES MESSAGES L'EST (§18 bis.2 point 4) : le liseré et la
								// graisse de la ligne non lue des notifications (§5.4 quinquies), et un MOT pour le §1.
								const nonLu = filEstNonLu(fil.messages)
								return (
									<li key={fil.cle}>
										<button
											type="button"
											data-testid="inbox-message"
											data-non-lu={nonLu ? 'true' : undefined}
											aria-current={choisi ? 'true' : undefined}
											// OUVRIR UN FIL OUVRE SON MESSAGE LE PLUS RÉCENT (§16.16.4) :
											// c'est celui dont la ligne vient d'afficher l'objet et la
											// date, et ouvrir le plus ancien ferait mentir la ligne
											// qu'on a cliquée.
											onClick={() => onOuvrir(fil.dernier)}
											className={[
												'w-full text-left px-3 py-2 border-b border-border',
												'min-h-[var(--size-target)]',
												'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
												choisi ? 'bg-brand-soft' : 'hover:bg-hover',
												nonLu ? 'border-l-[3px] border-l-brand' : '',
											].join(' ')}
										>
											{nonLu ? <span className="sr-only">{t('inbox.read.unreadPrefix')}</span> : null}
											<span className="block truncate text-sm text-text-2">
												{fil.dernier.expediteur}
											</span>
											<span className="flex items-center gap-2 min-w-0">
												<span
													className={['truncate text-ink', nonLu ? 'font-semibold' : 'font-medium'].join(' ')}
												>
													{fil.dernier.objet}
												</span>
												{/* LE BADGE N'APPARAÎT QU'AU-DELÀ DE UN (§5.4 bis) : un
												    « 1 » dirait ce que son absence dit déjà. Son nom
												    accessible est une phrase entière, un chiffre nu ne
												    disant pas ce qu'il compte. `shrink-0` : le compte
												    ne se laisse pas écraser par un objet long. */}
												{fil.nombre > 1 ? (
													<span
														data-testid="inbox-fil-compte"
														aria-label={t('inbox.thread.count', {
															n: String(fil.nombre),
														})}
														className="shrink-0 rounded-full bg-hover px-2 text-sm text-text-2 tabular-nums"
													>
														{fil.nombre}
													</span>
												) : null}
											</span>
											{/* `CRM-141` T4 (§5.103) : les pastilles posées du DERNIER message du fil, sous l'objet. */}
											<PastillesLigne ids={fil.dernier.pastilles ?? []} catalogue={catalogue} />
											<span className="flex items-center gap-2 text-sm text-text-3">
												<span className="truncate">{dateLisible(fil.dernier.recuLe)}</span>
												{/* LA PASTILLE EST CELLE DU BOARD, RÉEMPLOYÉE SANS COPIE
												    (§5.3 septies) : c'est la même information, elle doit se
												    reconnaître d'une vue à l'autre. */}
												<PastilleSommeil enSommeil={echeance !== null} echeance={echeance} />
											</span>
										</button>
									</li>
								)
							})}
						</ul>
						{/* L'ÉCRAN DIT QU'IL TRONQUE : une liste bornée en silence se lit comme une liste
						    complète, et l'utilisateur croirait avoir tout vu. */}
						{etat.donnees.tronquee ? (
							<p className="px-3 py-2 text-sm text-text-3">{t('inbox.list.truncated')}</p>
						) : null}
					</>
				)
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// Panneau 3 — le message
// =================================================================================================

/**
 * Les quatre refus possibles d'un classement, nommés **littéralement**.
 *
 * Une clé composée à la volée — `` t(`inbox.classify.refus.${nature}`) `` — compile, s'affiche, et
 * échappe pourtant au contrôle des clés mortes : le dictionnaire signalait ces quatre-là comme
 * inutilisées alors qu'elles l'étaient. Une table explicite les rend visibles à la fois du
 * compilateur et de la preuve.
 */
const LIBELLE_REFUS: Readonly<Record<NatureRefusClassement, CleTraduction>> = {
	forbidden: 'inbox.classify.refus.forbidden',
	card_indisponible: 'inbox.classify.refus.card_indisponible',
	network: 'inbox.classify.refus.network',
	unknown: 'inbox.classify.refus.unknown',
}

/**
 * Les refus d'un RETRAIT, et leur dictionnaire est DISTINCT de celui du classement.
 *
 * C'est la leçon de la décision 535, payée sur les objectifs : réemployer le texte du geste inverse
 * décrit à l'utilisateur ce qu'il n'a pas tenté, et l'envoie corriger ce qui n'est pas en cause.
 *
 * `card_indisponible` N'EST PAS LEVÉ PAR `unclassify_message` — elle ne vise aucune card, elle
 * quitte celle où le message se trouve. Il est néanmoins traduit, parce que la table est totale sur
 * `NatureRefusClassement` : un repli silencieux sur une clé manquante serait pire qu'une phrase
 * générique, et le classificateur est partagé par les deux gestes.
 */
const LIBELLE_REFUS_RETRAIT: Readonly<Record<NatureRefusClassement, CleTraduction>> = {
	forbidden: 'inbox.unclassify.refus.forbidden',
	card_indisponible: 'inbox.unclassify.refus.unknown',
	network: 'inbox.unclassify.refus.network',
	unknown: 'inbox.unclassify.refus.unknown',
}

function FormulaireClassement({
	message,
	onClasse,
	variante,
}: {
	readonly message: MessageComplet
	readonly onClasse: () => void
	/**
	 * La variante de la commande d'OUVERTURE, et d'elle seule (docs/DESIGN_SYSTEM.md §5.4 ter).
	 *
	 * Elle passe en `secondaire` tant qu'une suggestion est rendue à côté : deux boutons primaires
	 * dans le même pied ne diraient plus lequel est le chemin principal, et c'est le chemin court
	 * qui l'est quand un indice existe. La nature du geste ne change pas, seulement sa place dans
	 * une hiérarchie qui compte alors deux actions.
	 */
	readonly variante: 'primaire' | 'secondaire'
}) {
	const [ouvert, setOuvert] = useState(false)
	const [choix, setChoix] = useState<Candidate | null>(null)
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const champ = useRef<HTMLInputElement | null>(null)
	const commande = useRef<HTMLButtonElement | null>(null)
	// La commande est démontée pendant que le formulaire est ouvert : le focus lui revient au rendu suivant (§5.25).
	const rendreFocus = useRef(false)
	// `CRM-137` (docs/SPEC-mail-subsystem.md §26) : les candidates sont lues par la base, sous les droits de l'appelant,
	// et non plus par trois lectures côté client bornées à 200.
	const lecteur = useMemo(() => lecteurBase(clientCrm), [])

	// LE FOCUS SUIT L'OUVERTURE : sans cela, le clavier resterait sur un bouton qui vient de
	// disparaître et repartirait du début du document (docs/DESIGN_SYSTEM.md §10, §5.94).
	useEffect(() => {
		if (ouvert) champ.current?.focus()
		else if (rendreFocus.current) {
			rendreFocus.current = false
			commande.current?.focus()
		}
	}, [ouvert])

	const fermer = useCallback(() => {
		rendreFocus.current = true
		setOuvert(false)
		setChoix(null)
		setRefus(null)
	}, [])

	const soumettre = useCallback(async () => {
		if (choix === null) return
		setEnvoi(true)
		const echec = await classerMessage(clientCrm, message.id, choix.id)
		setEnvoi(false)
		if (echec !== null) {
			setRefus(t(LIBELLE_REFUS[echec.nature]))
			return
		}
		setRefus(null)
		setOuvert(false)
		onClasse()
	}, [choix, message.id, onClasse])

	if (!ouvert) {
		return (
			<Button ref={commande} variante={variante} onClick={() => setOuvert(true)} data-testid="inbox-classer">
				{t('inbox.classify.open')}
			</Button>
		)
	}

	return (
		<div className="flex flex-col gap-2" data-testid="inbox-formulaire-classement">
			<SelecteurClassement
				messageId={message.id}
				expediteur={message.expediteurAdresse}
				choix={choix}
				onChoisir={setChoix}
				onEchap={fermer}
				champ={champ}
				lire={lecteur}
			/>
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					variante="primaire"
					disabled={envoi || choix === null}
					onClick={() => void soumettre()}
					data-testid="inbox-classer-valider"
				>
					{envoi ? t('inbox.classify.working') : t('inbox.classify.submit')}
				</Button>
				<Button variante="secondaire" onClick={fermer}>
					{t('inbox.classify.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Retirer un message de l'affaire où il est classé — `CRM-055` tranche 2, §16.5.5.
 *
 * AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (`docs/DESIGN_SYSTEM.md` §5.3, §5.13,
 * §5.16, §5.21, §5.23, §5.25, §5.27, §5.28). L'écran offre, envoie, et TRADUIT le refus : la règle
 * vit dans `public.unclassify_message`, jamais ici. Depuis `CRM-093` (§5.59), la commande s'éteint
 * avec son motif quand la BASE rend refusée l'écriture de l'affaire quittée — une capacité lue sur
 * sa ligne, pas un rôle (docs/SPEC-droits-interface.md §5, ligne « Inbox »).
 *
 * LA CONFIRMATION VIT DANS LE FLUX, JAMAIS EN MODALE — le §5 n'en déclare aucune, et le §5.3 quater
 * a déjà tranché ce cas pour la mise à la corbeille. La commande qui l'ouvre est SECONDAIRE ; c'est
 * le bouton de la confirmation qui porte la teinte de danger : elle annonce le geste qu'on est sur
 * le point de commettre, pas celui qu'on envisage.
 *
 * ELLE NOMME UNE CONSÉQUENCE, ET C'EST TOUT SON OBJET (§16.5.2, mesure 2). Le geste peut retirer à
 * son auteur le seul chemin par lequel il voyait ce message — mesuré sur la pile : le `bizdev` le
 * voit par sa CARD SEULE, et déclassé il ne le voit plus. La phrase énonce la CONDITION plutôt que
 * de deviner un rôle : l'écran ne sait pas de quelles boîtes l'appelant répond, et l'inventer
 * ferait passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).
 */
const ID_MOTIF_RETRAIT = 'inbox-retrait-motif'
const ID_MOTIF_SUGGESTION = 'inbox-suggestion-motif'

function CommandeRetrait({
	message,
	onRetire,
}: {
	readonly message: MessageComplet
	readonly onRetire: () => void
}) {
	const [ouverte, setOuverte] = useState(false)
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const commande = useRef<HTMLButtonElement | null>(null)
	const confirmer = useRef<HTMLButtonElement | null>(null)
	const capacite = useEcriturePermise(clientCrm, 'cards', message.cardId)

	// LE FOCUS ENTRE DANS LA CONFIRMATION (§5.13) : sans cela le clavier resterait sur un bouton
	// qui vient de disparaître et repartirait du début du document.
	useEffect(() => {
		if (ouverte) confirmer.current?.focus()
	}, [ouverte])

	// ET IL REVIENT À LA COMMANDE QUI L'AVAIT OUVERTE : annuler au clavier ne doit pas perdre la
	// place de l'utilisateur dans le document.
	//
	// LE RETOUR PASSE PAR UN EFFET, ET NON PAR LE GESTIONNAIRE DE CLIC, parce que la commande
	// N'EXISTE PAS ENCORE au moment où l'on referme : la confirmation la remplace tant qu'elle est
	// ouverte, et `commande.current` vaut donc `null` dans le gestionnaire. MESURÉ : écrit dans le
	// gestionnaire, le focus retombait sur `body`, et l'assertion l'a montré avant l'œil.
	const [rendreFocus, setRendreFocus] = useState(false)
	useEffect(() => {
		if (!ouverte && rendreFocus) {
			commande.current?.focus()
			setRendreFocus(false)
		}
	}, [ouverte, rendreFocus])

	const fermer = useCallback(() => {
		setOuverte(false)
		setRefus(null)
		setRendreFocus(true)
	}, [])

	const retirer = useCallback(async () => {
		setEnvoi(true)
		const resultat = await declasserMessage(clientCrm, message.id)
		setEnvoi(false)
		if (resultat.refus !== null) {
			setRefus(t(LIBELLE_REFUS_RETRAIT[resultat.refus.nature]))
			return
		}
		setRefus(null)
		setOuverte(false)
		onRetire()
	}, [message.id, onRetire])

	if (!ouverte) {
		return (
			<div className="flex flex-col items-start gap-2 border-t border-border pt-3">
				{motifVisible(capacite) ? (
					<MotifLectureSeule id={ID_MOTIF_RETRAIT} data-testid="inbox-retrait-motif">
						{t('rights.readonly.inbox.unclassify')}
					</MotifLectureSeule>
				) : null}
				<Button
					ref={commande}
					variante="secondaire"
					onClick={() => setOuverte(true)}
					data-testid="inbox-retirer"
					{...proprietesCommande(capacite, ID_MOTIF_RETRAIT)}
				>
					<MailX aria-hidden="true" className="size-4" />
					{t('inbox.unclassify.open')}
				</Button>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="inbox-retrait-confirmation">
			{/* LE LIBELLÉ DE LA COMMANDE NOMMAIT LE GESTE ; C'EST LA CONFIRMATION QUI NOMME L'OBJET
			    (§6). L'objet du message est celui qui est ouvert, donc déjà sous les yeux : c'est
			    l'AFFAIRE quittée que cette phrase doit nommer, et elle le fait par la pilule
			    au-dessus. */}
			<p className="text-sm text-ink">{t('inbox.unclassify.confirm')}</p>
			<p className="text-sm text-text-2">{t('inbox.unclassify.consequence')}</p>
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					ref={confirmer}
					variante="destructif"
					disabled={envoi}
					onClick={() => void retirer()}
					data-testid="inbox-retirer-valider"
				>
					{envoi ? t('inbox.unclassify.working') : t('inbox.unclassify.submit')}
				</Button>
				<Button variante="secondaire" onClick={fermer} data-testid="inbox-retirer-annuler">
					{t('inbox.unclassify.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * La pilule de l'affaire — cliquable, et donc adressable.
 *
 * L'adresse est lue à l'ouverture du message, non portée par lui : la liste nomme les affaires,
 * elle ne les adresse pas. Tant qu'elle n'est pas connue, le titre seul est affiché — un lien mort
 * serait pire qu'un texte.
 */
function PiluleCard({ idCard }: { readonly idCard: string }) {
	const [cible, setCible] = useState<{ titre: string; adresse: string } | null>(null)
	useEffect(() => {
		let vivant = true
		void (async () => {
			const lue = await lireCheminCard(clientCrm, idCard)
			if (vivant) setCible(lue)
		})()
		return () => {
			vivant = false
		}
	}, [idCard])

	if (cible === null) return null
	return (
		<p className="text-sm text-text-2">
			{t('inbox.message.card')}{' '}
			<Link
				to={cible.adresse}
				data-testid="inbox-pilule-card"
				className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
			>
				{cible.titre}
			</Link>
		</p>
	)
}

// =================================================================================================
// La SUGGESTION de classement — CRM-060 sous-tranche 2 bis, docs/SPEC-contacts.md §8.8
// =================================================================================================

/**
 * Le bloc de suggestion, et le geste qui l'accepte.
 *
 * IL N'INTRODUIT AUCUN CONTRAT NOUVEAU : accepter une suggestion appelle `classify_message` avec
 * l'affaire suggérée, par la même fonction que le formulaire manuel (§8.8.6). Un second chemin
 * d'écriture divergerait du premier au premier ajustement, et la garde des deux droits du §18.2
 * doit rester UNE.
 *
 * LA SUGGESTION N'ACCORDE AUCUN DROIT (§8.1) : elle peut désigner une affaire que l'appelant n'a
 * pas le droit d'écrire, et le geste échoue alors comme tout classement manuel non autorisé. Aucun
 * rôle n'éteint la commande (docs/DESIGN_SYSTEM.md §5.4 ter) ; depuis `CRM-093` (§5.59), la capacité
 * d'écrire l'affaire suggérée, rendue par la base sur sa ligne, l'éteint avec son motif — et l'écran
 * traduit toujours le refus quand elle n'a pas pu être lue.
 */
function BlocSuggestion({
	idMessage,
	idCard,
	titre,
	adresse,
	onClasse,
}: {
	readonly idMessage: string
	readonly idCard: string
	readonly titre: string
	readonly adresse: string
	readonly onClasse: () => void
}) {
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const capacite = useEcriturePermise(clientCrm, 'cards', idCard)

	const accepter = useCallback(async () => {
		setEnVol(true)
		const echec = await classerMessage(clientCrm, idMessage, idCard)
		setEnVol(false)
		if (echec !== null) {
			// LE BLOC RESTE RENDU SUR UN REFUS (§8.8.6) : disparaître retirerait le seul endroit où
			// lire la cause. Les quatre refus sont ceux du classement manuel, mot pour mot — un même
			// refus ne se formule pas de deux façons selon le bouton qui l'a demandé.
			setRefus(t(LIBELLE_REFUS[echec.nature]))
			return
		}
		setRefus(null)
		onClasse()
	}, [idCard, idMessage, onClasse])

	return (
		<section
			data-testid="inbox-suggestion"
			aria-labelledby="inbox-suggestion-titre"
			// UNE CARTE DISCRÈTE, PAS UNE ALERTE (docs/DESIGN_SYSTEM.md §5.4 ter) : une suggestion
			// n'est ni une erreur ni un avertissement, et une teinte d'état lui ferait porter une
			// urgence qu'elle n'a pas.
			className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3"
		>
			<h4
				id="inbox-suggestion-titre"
				className="flex items-center gap-2 text-sm font-medium text-text-2"
			>
				<Sparkles aria-hidden="true" size={16} />
				{t('inbox.suggestion.title')}
			</h4>
			{/* L'AFFAIRE EST NOMMÉE **ET** ADRESSABLE (§8.8.5) : un indice qui ne nommerait pas sa
			    cible ne serait pas un indice, et un nom sans lien obligerait à chercher l'affaire
			    ailleurs pour la vérifier — or vérifier est ce que « à confirmer » demande. */}
			<p>
				<Link
					to={adresse}
					data-testid="inbox-suggestion-card"
					className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
				>
					{titre}
				</Link>
			</p>
			{/* LA RÈGLE EST ÉCRITE EN TOUTES LETTRES, et ce n'est pas une mesure refaite à l'écran :
			    la colonne n'est écrite que par `classer_message_automatiquement`, et elle ne peut pas
			    signifier autre chose (§8.8.5). AUCUNE DATE, aucun score : `suggested_at` daterait
			    l'indice et non l'affaire, et la règle 3 ne produit aucune probabilité. */}
			<p className="text-sm text-text-2">{t('inbox.suggestion.rule')}</p>
			{refus !== null ? (
				<p role="alert" data-testid="inbox-suggestion-refus" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			{/* `items-start` : dans une colonne flex, un bouton prend toute la largeur disponible et
			    traverserait le panneau de lecture entier (§5.3 septies, défaut mesuré). */}
			{motifVisible(capacite) ? (
				<MotifLectureSeule id={ID_MOTIF_SUGGESTION} data-testid="inbox-suggestion-motif">
					{t('rights.readonly.inbox.suggestion')}
				</MotifLectureSeule>
			) : null}
			<div className="flex items-start">
				<Button
					variante="primaire"
					{...proprietesCommande(capacite, ID_MOTIF_SUGGESTION, enVol)}
					onClick={() => void accepter()}
					data-testid="inbox-suggestion-accepter"
				>
					{enVol ? t('inbox.classify.working') : t('inbox.suggestion.accept')}
				</Button>
			</div>
		</section>
	)
}

/**
 * Le pied d'un message NON CLASSÉ : la phrase, la suggestion s'il y en a une, la commande manuelle.
 *
 * L'ORDRE PORTE UN SENS (§8.8.2) : la suggestion est le chemin court, la commande manuelle celui
 * qui marche toujours. Placer l'indice après la commande le ferait lire une fois la liste déroulée,
 * c'est-à-dire trop tard. Et la commande manuelle n'est JAMAIS remplacée : une suggestion peut
 * désigner la mauvaise affaire, et un écran qui n'offrirait que l'indice enfermerait l'utilisateur
 * dans un choix qu'il n'a pas fait.
 */
function PiedNonClasse({
	message,
	onClasse,
}: {
	readonly message: MessageComplet
	readonly onClasse: () => void
}) {
	const idSuggere = message.suggestionCardId
	const [cible, setCible] = useState<{ titre: string; adresse: string } | null>(null)

	// AUCUNE REQUÊTE QUAND IL N'Y A RIEN À RÉSOUDRE (§8.8.3) : un message sans suggestion ne
	// déclenche aucune lecture supplémentaire. La cible est remise à zéro à chaque changement de
	// message, sans quoi le bloc d'un message porterait l'affaire du précédent le temps d'un rendu.
	useEffect(() => {
		setCible(null)
		if (idSuggere === null) return
		let vivant = true
		void (async () => {
			const lue = await lireCheminCard(clientCrm, idSuggere)
			if (vivant) setCible(lue)
		})()
		return () => {
			vivant = false
		}
	}, [idSuggere])

	// UNE SUGGESTION DONT L'AFFAIRE N'EST PAS LISIBLE NE REND RIEN (§8.8.4, cas d) : `lireCheminCard`
	// rend `null`, et l'écran n'écrit surtout pas « une affaire vous est suggérée mais vous ne pouvez
	// pas la voir » — cette phrase divulguerait l'existence d'une affaire que la RLS ferme.
	const suggestion = idSuggere !== null && cible !== null ? { id: idSuggere, ...cible } : null

	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm text-text-2">{t('inbox.message.unclassified')}</p>
			{suggestion !== null ? (
				<BlocSuggestion
					idMessage={message.id}
					idCard={suggestion.id}
					titre={suggestion.titre}
					adresse={suggestion.adresse}
					onClasse={onClasse}
				/>
			) : null}
			<FormulaireClassement
				message={message}
				onClasse={onClasse}
				variante={suggestion !== null ? 'secondaire' : 'primaire'}
			/>
		</div>
	)
}


// =================================================================================================
// Le geste de sommeil d'un FIL — docs/SPEC-cards.md §16.15.6, docs/DESIGN_SYSTEM.md §5.3 septies
// =================================================================================================

/** Les cinq mentions atteignables. `refus` n'en est PAS : `snooze_thread` n'oppose aucun `forbidden`. */
const MENTION_FIL: Readonly<Record<Exclude<IssueSommeilFil, 'endormi' | 'reveille'>, CleTraduction>> = {
	introuvable: 'inbox.sleep.refus.notfound',
	'echeance-requise': 'inbox.sleep.refus.required',
	'echeance-passee': 'inbox.sleep.refus.past',
	reseau: 'inbox.sleep.refus.network',
	inconnu: 'inbox.sleep.refus.unknown',
}

/**
 * Le geste à deux visages du message ouvert.
 *
 * IL VIT ICI ET NON DANS LA LIGNE DE LISTE (§16.15.6) : une liste dont chaque ligne porte un bouton
 * n'est plus une liste, et le §5.4 tient une densité que cette tranche ne défait pas.
 *
 * LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE, quel que soit le profil : l'écran ne devine aucun
 * droit, il appuie et lit le refus (§5.3 septies).
 */
function GesteSommeilFil({
	workspaceId,
	cle,
	echeance,
	onFait,
}: {
	readonly workspaceId: string
	readonly cle: string
	readonly echeance: string | null
	readonly onFait: (issue: 'endormi' | 'reveille') => void
}) {
	const [ouvert, setOuvert] = useState(false)
	const [saisie, setSaisie] = useState('')
	const [issue, setIssue] = useState<IssueSommeilFil | null>(null)
	const [enVol, setEnVol] = useState(false)
	// LE FOCUS REVIENT À LA COMMANDE PAR SON CONTENEUR, et non par une `ref` sur le bouton :
	// `Button` est un composant de fonction simple, qui ne transmet aucune `ref` (§5.5). Lui en
	// ajouter une toucherait tous les écrans du produit pour un besoin local à celui-ci.
	const conteneurCommande = useRef<HTMLDivElement | null>(null)

	// LE PANNEAU SE REFERME QUAND LE MESSAGE CHANGE : sans cela, un panneau ouvert sur un message
	// s'appliquerait au suivant, et le refus affiché parlerait d'un fil qu'on ne lit plus.
	useEffect(() => {
		setOuvert(false)
		setIssue(null)
		setSaisie('')
	}, [cle, workspaceId])

	const fermer = useCallback(() => {
		setOuvert(false)
		setIssue(null)
		conteneurCommande.current?.querySelector('button')?.focus()
	}, [])

	const appliquer = useCallback(
		async (until: string | null) => {
			if (clientCrm === null) return
			setEnVol(true)
			const resultat = await endormirFil(clientCrm, workspaceId, cle, until)
			setEnVol(false)
			setIssue(resultat.issue)
			if (resultat.issue !== 'endormi') return
			setOuvert(false)
			setSaisie('')
			onFait('endormi')
		},
		[cle, onFait, workspaceId],
	)

	const reveiller = useCallback(async () => {
		if (clientCrm === null) return
		setEnVol(true)
		const resultat = await reveillerFil(clientCrm, workspaceId, cle)
		setEnVol(false)
		setIssue(resultat.issue)
		if (resultat.issue !== 'reveille') return
		onFait('reveille')
	}, [cle, onFait, workspaceId])

	const mention =
		issue === null || issue === 'endormi' || issue === 'reveille' ? null : MENTION_FIL[issue]

	// UN SEUL VISAGE À LA FOIS (§16.15.6). Le réveil n'ouvre aucun panneau : il n'a pas de
	// paramètre, et il est réversible d'un geste — une confirmation serait un obstacle.
	if (echeance !== null) {
		return (
			// `items-start` : une SECONDAIRE COMPACTE ne s'étire pas (§5.5, §5.3 septies). Dans une
			// colonne flex, un bouton prend toute la largeur disponible — au palier 1440 px il
			// traversait le panneau de lecture entier, ce qui lui donnait le poids d'une action
			// principale qu'il n'a pas. Défaut vu en capture, pas en test.
			<div ref={conteneurCommande} className="flex flex-col items-start gap-1">
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="fil-reveiller"
					disabled={enVol}
					onClick={() => void reveiller()}
				>
					<Sun aria-hidden="true" size={16} />
					{enVol ? t('card.sleep.pending') : t('inbox.sleep.wake')}
				</Button>
				{mention !== null ? (
					<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
						{t(mention)}
					</p>
				) : null}
			</div>
		)
	}

	if (!ouvert) {
		return (
			<div ref={conteneurCommande} className="flex flex-col items-start gap-1">
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="fil-endormir"
					onClick={() => {
						setIssue(null)
						setOuvert(true)
					}}
				>
					<Moon aria-hidden="true" size={16} />
					{t('inbox.sleep.open')}
				</Button>
				{mention !== null ? (
					<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
						{t(mention)}
					</p>
				) : null}
			</div>
		)
	}

	return (
		<div
			data-testid="fil-panneau"
			// `w-full` (`CRM-138`, §5.102) : ouvert dans la rangée de commandes, le panneau prend sa propre ligne, et les
			// autres commandes passent dessous plutôt que de se serrer à côté de lui.
			className="flex flex-col gap-2 rounded-md border border-border p-3 w-full"
			// `Échap` REFERME EN RENDANT LE FOCUS À LA COMMANDE (§5.3 quater, sans changement) :
			// un panneau qu'on ferme en perdant le focus oblige à retraverser l'écran au clavier.
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') fermer()
			}}
		>
			<p className="text-sm font-medium text-text-2">{t('card.sleep.legend')}</p>
			<div className="flex flex-wrap gap-2">
				{ECHEANCES_USUELLES.map((usuelle) => (
					<Button
						key={usuelle.cle}
						variante="discret"
						taille="compacte"
						data-testid={`fil-preset-${usuelle.cle}`}
						disabled={enVol}
						// COMPTÉE DEPUIS L'INSTANT DU GESTE, jamais depuis celui du rendu (§16.11.3) :
						// un panneau ouvert dix minutes décalerait sinon toutes ses échéances.
						onClick={() => void appliquer(echeanceUsuelle(usuelle.jours))}
					>
						{t(CLE_PRESET_SOMMEIL[usuelle.cle])}
					</Button>
				))}
			</div>
			<label className="flex flex-col gap-1 text-sm text-text-2">
				{t('card.sleep.custom')}
				{/* NI `min` NI `required` (§5.3 septies) : une échéance passée est ENVOYÉE, et c'est
				    `snooze_date_in_past` qui la refuse — mesure K2. Doubler la garde ici masquerait
				    sa disparition le jour où elle disparaîtrait. */}
				<input
					type="datetime-local"
					data-testid="fil-echeance"
					value={saisie}
					onChange={(evenement) => setSaisie(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border px-2"
				/>
			</label>
			{/* LE REFUS N'EFFACE PAS LA SAISIE : la corriger vaut mieux que la retaper. */}
			{mention !== null ? (
				<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
					{t(mention)}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					variante="primaire"
					taille="compacte"
					data-testid="fil-soumettre"
					disabled={enVol}
					onClick={() => void appliquer(echeanceSaisie(saisie))}
				>
					{enVol ? t('card.sleep.pending') : t('inbox.sleep.open')}
				</Button>
				<Button variante="discret" taille="compacte" onClick={fermer}>
					{t('card.sleep.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Le sélecteur des messages d'un fil — §16.16.4, docs/DESIGN_SYSTEM.md §5.4 bis.
 *
 * IL N'EXISTE QU'AU-DELÀ D'UN MESSAGE, et c'est ce qui rend cette tranche sûre : là où les fils
 * sont d'un message — tout le courrier reçu avant le correctif du §16.16.2 —, le panneau de lecture
 * reste **exactement** celui d'avant. Une liste d'un élément n'est pas un choix, et l'afficher
 * quand même donnerait à croire qu'il manque quelque chose.
 *
 * L'ORDRE EST CELUI DE LA LISTE — le plus récent d'abord —, et il n'est pas recalculé : deux ordres
 * sur un même écran rendraient « la première ligne » ambiguë (§16.16.4).
 */
function SelecteurFil({
	messages,
	idOuvert,
	onOuvrir,
}: {
	readonly messages: readonly MessageListe[]
	readonly idOuvert: string
	readonly onOuvrir: (message: MessageListe) => void
}) {
	if (messages.length < 2) return null
	return (
		<section
			data-testid="inbox-fil-selecteur"
			aria-label={t('inbox.thread.picker.aria')}
			className="flex flex-col gap-1 rounded-md border border-border p-2"
		>
			<h4 className="text-sm font-medium text-text-2">{t('inbox.thread.picker.title')}</h4>
			<ul>
				{messages.map((message) => (
					<li key={message.id}>
						<button
							type="button"
							data-testid="inbox-fil-message"
							// LE MESSAGE AFFICHÉ S'ANNONCE, il ne se contente pas d'une teinte : une
							// sélection qui n'existe qu'en couleur n'existe pas pour un lecteur
							// d'écran (§5.4, §10).
							aria-current={message.id === idOuvert ? 'true' : undefined}
							onClick={() => onOuvrir(message)}
							className={[
								'w-full text-left px-2 rounded-sm min-h-[var(--size-target)]',
								'flex items-center gap-2 min-w-0',
								'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
								message.id === idOuvert ? 'bg-brand-soft text-brand font-medium' : 'hover:bg-hover',
							].join(' ')}
						>
							<span className="truncate min-w-0">{message.expediteur}</span>
							<span className="shrink-0 ml-auto text-sm text-text-3">
								{dateLisible(message.recuLe)}
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	)
}

function PanneauMessage({
	etat,
	onRetour,
	onReprise,
	onClasse,
	onRepondu,
	visible,
	fils,
	maintenant,
	onSommeil,
	messagesDuFil,
	onOuvrir,
	lu,
	onBasculerLecture,
	erreurMarquage,
	retention,
	onEfface,
	catalogue,
	edition,
	onAnnonce,
}: {
	/** `CRM-141` T4 (§31.7) : le catalogue des pastilles, la capacité d'éditer l'espace, et la région vivante. */
	readonly catalogue: CataloguePastilles
	readonly edition: Capacite
	readonly onAnnonce: (texte: string) => void
	/** `CRM-138` T3 : la rétention de la corbeille, lue en base, que la confirmation d'« Effacer » cite. */
	readonly retention: EtatAsync<number>
	/** `CRM-138` T3 : le message vient d'être mis à la corbeille. */
	readonly onEfface: (id: string) => void
	readonly etat: EtatAsync<MessageComplet | null>
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly onClasse: () => void
	readonly onRepondu: () => void
	readonly visible: boolean
	readonly fils: FilsEndormis
	readonly maintenant: Date
	readonly onSommeil: (issue: 'endormi' | 'reveille') => void
	/** Les messages du fil ouvert, dans l'ordre de la liste. Vide tant que rien n'est ouvert. */
	readonly messagesDuFil: readonly MessageListe[]
	readonly onOuvrir: (message: MessageListe) => void
	/** L'état de lecture du message affiché, lu dans la page ; `null` tant qu'il n'y est pas connu. */
	readonly lu: boolean | null
	readonly onBasculerLecture: (id: string, lu: boolean) => void
	/** L'échec du dernier marquage de ce panneau ; `null` sinon. */
	readonly erreurMarquage: ErreurDonnees | null
}) {
	const echeance =
		etat.statut === 'pret' && etat.donnees !== null
			? echeanceFil(fils, etat.donnees.workspaceId, etat.donnees.cleFil, maintenant)
			: null
	const idAffiche = etat.statut === 'pret' && etat.donnees !== null ? etat.donnees.id : null
	// Le message ouvert, nommé pour les rappels qui ne gardent pas le rétrécissement de `etat` (`CRM-141` T4).
	const donneesOuvertes = etat.statut === 'pret' ? etat.donnees : null
	return (
		<Panneau
			id="message"
			titre={t('inbox.message.title')}
			visible={visible}
			classe="flex-1 w-full min-w-0"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.list')}
				</Button>
			}
		>
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : null}
			{etat.statut === 'erreur' ? <EchecChargement erreur={etat.erreur} onReprise={onReprise} /> : null}
			{etat.statut === 'pret' && etat.donnees === null ? (
				<EtatVide
					titre={t('inbox.message.unselected.title')}
					corps={t('inbox.message.unselected.body')}
				/>
			) : null}
			{etat.statut === 'pret' && etat.donnees !== null ? (
				<article className="flex flex-col gap-4 p-4" data-testid="inbox-message-ouvert">
					<header className="flex flex-col gap-1">
						<h3 className="text-h3 break-words min-w-0">{etat.donnees.objet}</h3>
						<p className="text-sm text-text-2 break-words">
							{t('inbox.message.from')} : {etat.donnees.expediteur}
						</p>
						{etat.donnees.destinataires.length > 0 ? (
							<p className="text-sm text-text-2 break-words">
								{t('inbox.message.to')} : {etat.donnees.destinataires.join(', ')}
							</p>
						) : null}
						{etat.donnees.copies.length > 0 ? (
							<p className="text-sm text-text-2 break-words">
								{t('inbox.message.cc')} : {etat.donnees.copies.join(', ')}
							</p>
						) : null}
						{/* LA COPIE CACHÉE D'UN MESSAGE ENVOYÉ, LISIBLE DANS L'AFFAIRE (§19 bis.2 point 2, §5.4 sexies) : cachée
						    aux destinataires, pas à l'équipe. Absente d'un message reçu. */}
						{etat.donnees.copiesCachees.length > 0 ? (
							<p className="text-sm text-text-2 break-words" data-testid="inbox-message-cci">
								{t('inbox.message.bcc')} : {etat.donnees.copiesCachees.join(', ')}
							</p>
						) : null}
						<p className="flex items-center gap-2 text-sm text-text-3">
							<span>
								{t('inbox.message.received')} {dateLisible(etat.donnees.recuLe)}
							</span>
							{/* LA MÊME PASTILLE QU'EN LISTE, au même endroit relatif : la date, puis
							    l'état de son fil (§5.3 septies). */}
							<PastilleSommeil enSommeil={echeance !== null} echeance={echeance} />
						</p>
						{/* `CRM-138` T3 — UNE RANGÉE DE COMMANDES (§5.102), dans cet ordre : le sommeil, la lecture, « Effacer ».
						    Le geste de sommeil vit dans le message ouvert (§16.15.6) ; le message ouvert n'est jamais masqué par
						    le filtre (§16.15.5). Montée avec la clé du message : la confirmation d'« Effacer » se referme et sa
						    case se décoche d'un message à l'autre. */}
						{/* `CRM-141` T4 (§5.103) : la ligne des pastilles et de l'état d'évaluation vient avant la rangée ; « Réévaluer
						    les pastilles » et « Pastilles » s'y placent après la lecture, avant « Effacer » ; le panneau, dessous. */}
						<div className="pt-1">
							<PastillesMessageOuvert
								key={etat.donnees.id}
								idMessage={etat.donnees.id}
								idEspace={etat.donnees.workspaceId}
								envoye={etat.donnees.envoye}
								catalogue={catalogue}
								edition={edition}
								onAnnonce={onAnnonce}
								rangee={(pastilles) =>
									donneesOuvertes === null ? null : (
									<RangeeCommandesMessage
										key={donneesOuvertes.id}
										idMessage={donneesOuvertes.id}
										objet={donneesOuvertes.objet}
										effacableDansBoite={donneesOuvertes.effacableDansBoite}
										retention={retention}
										onEfface={() => onEfface(idAffiche ?? '')}
										refermerConfirmation={pastilles.refermerConfirmation}
										onConfirmationOuverte={pastilles.onConfirmationOuverte}
										commandes={
											<>
												<GesteSommeilFil
													workspaceId={donneesOuvertes.workspaceId}
													cle={donneesOuvertes.cleFil}
													echeance={echeance}
													onFait={onSommeil}
												/>
												{lu === null || idAffiche === null ? null : (
													<Button
														taille="compacte"
														data-testid="inbox-basculer-lecture"
														onClick={() => onBasculerLecture(idAffiche, lu)}
													>
														{lu ? <Mail aria-hidden="true" size={16} /> : <MailOpen aria-hidden="true" size={16} />}
														{lu ? t('inbox.read.markUnread') : t('inbox.read.markRead')}
													</Button>
												)}
												{pastilles.commandes}
											</>
										}
									/>
								)}
							/>
						</div>
						{erreurMarquage !== null ? (
							<p role="alert" data-testid="inbox-lecture-refus" className="text-sm text-danger">
								{texteErreurLecture(erreurMarquage)}
							</p>
						) : null}
					</header>

					{/* LE SÉLECTEUR VIT SOUS L'EN-TÊTE (§5.4 bis), après le geste et avant le corps :
					    il choisit ce que le corps montre, et le placer après l'aurait fait lire une
					    fois le message déjà parcouru. Il ne rend rien sur un fil d'un seul message. */}
					<SelecteurFil
						messages={messagesDuFil}
						idOuvert={etat.donnees.id}
						onOuvrir={onOuvrir}
					/>

					{/* `CRM-140` (§30, docs/DESIGN_SYSTEM.md §5.100) : le HTML dans un cadre isolé, le texte sinon. Aucun
					    `dangerouslySetInnerHTML` : le HTML de l'expéditeur n'atteint jamais le DOM de l'écran. La CLÉ du
					    message rend « Afficher les images » à son premier état à chaque message ouvert. */}
					<CorpsMessage
						key={etat.donnees.id}
						html={etat.donnees.corpsHtml}
						texte={etat.donnees.corps}
						pieces={etat.donnees.pieces}
						client={clientCrm}
					/>

					{etat.donnees.pieces.length > 0 ? (
						<section>
							<h4 className="text-sm font-medium text-text-2">{t('inbox.attachments.title')}</h4>
							{/* `CRM-074` T3 (docs/DESIGN_SYSTEM.md §5.80) : la liste partagée avec le fil de l'affaire, et l'aperçu. */}
							<ListePiecesJointes pieces={etat.donnees.pieces} client={clientCrm} />
						</section>
					) : null}

					<footer className="border-t border-border pt-3">
						{etat.donnees.cardId !== null ? (
							<div className="flex flex-col gap-2">
								<PiluleCard idCard={etat.donnees.cardId} />
								{/* RÉPONDRE DEPUIS L'INBOX EMPRUNTE LE MÊME CHEMIN QUE DEPUIS LA CARD
								    (§19.6) : même composant, même garde, seule la card diffère — ici,
								    celle du message ouvert. Un message NON classé n'a pas d'affaire,
								    donc pas d'adresse de retour : il faut d'abord le classer, et
								    l'écran le dit au lieu d'offrir une action qui échouerait. */}
								<FormulaireEnvoi
									idCard={etat.donnees.cardId}
									destinataire={etat.donnees.expediteurAdresse}
									objet={objetDeReponse(etat.donnees.objet)}
									repondA={etat.donnees.id}
									onEnvoye={onRepondu}
								/>
								{/* LE RETRAIT EST EN BAS, ET SÉPARÉ (§5.3 quater) : ce n'est pas ce qu'on
								    vient faire sur un message. Il réemploie `onClasse` parce que les deux
								    gestes demandent la MÊME chose à l'écran — relire l'arborescence, la
								    liste et le message —, et qu'un second rappel identique n'aurait fait
								    que doubler le chemin. */}
								<CommandeRetrait message={etat.donnees} onRetire={onClasse} />
							</div>
						) : (
							<PiedNonClasse message={etat.donnees} onClasse={onClasse} />
						)}
					</footer>
				</article>
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// L'écran
// =================================================================================================

export function RouteInbox() {
	const [selection, setSelection] = useState<Selection | null>(null)
	const [idOuvert, setIdOuvert] = useState<string | null>(null)
	const [etage, setEtage] = useState<Etage>('dossiers')
	const [annonce, setAnnonce] = useState('')
	// `CRM-128` T4 (§5.90) : la vue « Mails préparés » remplace les deux panneaux de messages quand son entrée est choisie.
	const [preparesChoisis, setPreparesChoisis] = useState(false)
	const [idPrepare, setIdPrepare] = useState<string | null>(null)
	const [mailsPrepares, setMailsPrepares] = useState<EtatAsync<readonly MailPrepare[]>>({ statut: 'chargement' })
	const [focusApresGeste, setFocusApresGeste] = useState(false)
	const refEntreePrepares = useRef<HTMLButtonElement | null>(null)
	const refVidePrepares = useRef<HTMLDivElement | null>(null)
	const relirePrepares = useCallback(() => {
		void lireMailsPrepares(clientCrm).then(setMailsPrepares)
	}, [])
	useEffect(() => {
		relirePrepares()
	}, [relirePrepares])
	// LES DEUX ÉCHECS DE MARQUAGE SONT LUS LÀ OÙ LE GESTE A ÉTÉ FAIT (§18 bis.4) : la liste pour « Tout marquer comme
	// lu », le panneau de lecture pour l'ouverture et la bascule.
	const [erreurLectureListe, setErreurLectureListe] = useState<ErreurDonnees | null>(null)
	const [erreurLectureMessage, setErreurLectureMessage] = useState<ErreurDonnees | null>(null)
	// LE FIL À MARQUER LU, POSÉ PAR UNE OUVERTURE ET CONSOMMÉ UNE SEULE FOIS (§18 bis.2 points 3 et 4) : une fois le
	// marquage parti, relire la liste ne le relance pas — sinon « Marquer comme non lu » serait défait par la relecture
	// même qu'il provoque.
	const filAMarquer = useRef<string | null>(null)

	// =============================================================================================
	// LES PARAMÈTRES D'ADRESSE DE L'INBOX — ils sont DEUX, et de deux natures différentes
	// =============================================================================================
	//
	// `message` (CRM-065 sous-tranche 2c, docs/SPEC-recherche.md §15 et §15.1) est une DESTINATION :
	// la palette du §13.5 y mène, l'inbox l'honore puis le retire.
	//
	// `sommeil` (§16.17.1, tranche 3) est un CONTRÔLE de l'écran, et il reste dans l'adresse.
	const [parametresUrl, setParametresUrl] = useSearchParams()

	// LU AU MONTAGE ET UNE SEULE FOIS (§15) — PAR CONSTRUCTION, ET NON PAR UN DRAPEAU. L'initialiseur
	// paresseux de `useState` n'est évalué qu'au premier rendu : la valeur ne peut plus changer
	// ensuite, quoi qu'il advienne de l'adresse.
	//
	// LA PREMIÈRE RÉDACTION EMPLOYAIT UN `ref` GARDE-FOU DANS UN EFFET DÉPENDANT DE `parametresUrl`,
	// ET ELLE ÉTAIT FAUSSE — mesuré par la preuve, pas deviné : retirer le paramètre change
	// `parametresUrl`, l'effet se rejoue, et son NETTOYAGE tue la lecture encore en vol. Le drapeau
	// empêchait bien un second départ, mais rien n'empêchait l'annulation du premier : l'écran
	// retirait le paramètre et n'ouvrait jamais le message. La dépendance stable supprime la cause
	// au lieu d'ajouter une garde de plus.
	const [demandeInitiale] = useState(() => parametresUrl.get(PARAMETRE_MESSAGE))
	// `CRM-128` T4 : `brouillon` est une destination, comme `message` — le lien que donne l'assistant (§5.90).
	const [brouillonDemande] = useState(() => parametresUrl.get(PARAMETRE_BROUILLON))
	useEffect(() => {
		if (brouillonDemande === null || brouillonDemande === '') return
		setParametresUrl(
			(precedents) => {
				const suivants = new URLSearchParams(precedents)
				suivants.delete(PARAMETRE_BROUILLON)
				return suivants
			},
			{ replace: true },
		)
		setPreparesChoisis(true)
		setSelection(null)
		setIdPrepare(brouillonDemande)
		// SOUS 1024 PX, ON ARRIVE SUR LA RELECTURE : le lien désigne un mail précis.
		setEtage('message')
	}, [brouillonDemande, setParametresUrl])

	// LE MODE D'AFFICHAGE ENTRE DANS L'ADRESSE — §16.17.1, tranche 3, arbitrage du 2026-08-29.
	//
	// LES CONSTANTES SONT IMPORTÉES DE `filtre-sommeil.ts`, JAMAIS RÉÉCRITES ICI : le board et la vue
	// liste portent la même bascule sous la même clé depuis la tranche 2 b (§16.12.4), et une
	// seconde déclaration de la chaîne `sommeil` serait la première divergence entre les trois
	// écrans. `lireModeSommeil` replie de surcroît toute valeur inconnue sur le défaut, de sorte
	// qu'une faute de frappe dans une adresse partagée ne fasse jamais apparaître des fils qu'on
	// croyait rangés.
	//
	// LA RÉDACTION PRÉCÉDENTE — UN `useState` — REPOSAIT SUR DEUX PRÉMISSES FAUSSES, mesurées avant
	// d'être corrigées : « l'inbox ne lit aucun paramètre d'adresse » (elle lit `message` depuis
	// `CRM-065`, six lignes plus haut) et « le filtre ne survit pas au changement de dossier » (rien
	// ne réinitialisait cet état quand `selection` changeait). Le mode est une préférence
	// d'affichage de l'écran : il vaut pour tous ses dossiers, et il survit désormais aussi au
	// rechargement.
	const mode: ModeFils = lireModeSommeil(parametresUrl.get(CLE_URL_SOMMEIL))
	const changerMode = useCallback(
		(suivant: ModeFils) => {
			// PAS DE `replace` ICI, contrairement au retrait de `message` : la bascule est un geste de
			// l'utilisateur, et « Précédent » doit pouvoir le défaire. Le retrait de `message`, lui,
			// n'est le geste de personne.
			//
			// La forme fonctionnelle conserve les autres paramètres sans faire dépendre ce rappel de
			// `parametresUrl`, dont le changement le recréerait à chaque navigation.
			setParametresUrl((precedents) => {
				const suivants = new URLSearchParams(precedents)
				// Le défaut ne s'écrit JAMAIS dans l'adresse (§12.2) : la vue par défaut reste l'adresse
				// la plus courte, ici comme sur le board.
				if (suivant === 'visibles') suivants.set(CLE_URL_SOMMEIL, VALEUR_URL_SOMMEIL_VISIBLES)
				else suivants.delete(CLE_URL_SOMMEIL)
				return suivants
			})
		},
		[setParametresUrl],
	)

	useEffect(() => {
		if (demandeInitiale === null || demandeInitiale === '') return

		// LE PARAMÈTRE EST RETIRÉ MÊME QUAND IL N'EST PAS HONORÉ (§15.1) — décidé par le TRAITEMENT,
		// jamais par le succès —, et il l'est TOUT DE SUITE, avant même de savoir si le message se
		// lit : l'écran doit être indiscernable d'une arrivée sans paramètre, et l'adresse fait
		// partie de cet état. `replace` : un remplacement d'historique, sans quoi le bouton
		// « Précédent » ramènerait à l'adresse porteuse et rouvrirait le message.
		//
		// LA FORME FONCTIONNELLE N'EST PAS UN STYLE : elle évite de faire dépendre cet effet de
		// `parametresUrl`, dont le changement le rejouerait. Les autres paramètres sont conservés,
		// comme le `sommeil` du board (docs/SPEC-cards.md §16.12.4).
		setParametresUrl(
			(precedents) => {
				const suivants = new URLSearchParams(precedents)
				suivants.delete(PARAMETRE_MESSAGE)
				return suivants
			},
			{ replace: true },
		)

		let vivant = true
		void (async () => {
			// LE DOSSIER SE DÉDUIT DU MESSAGE, il ne se devine pas : `card_id` décide (M16), et le
			// message non classé va aux « Non classés » plutôt que de rester sans dossier.
			const dossier = await lireDossierDuMessage(clientCrm, demandeInitiale)
			if (!vivant) return
			// UN IDENTIFIANT INCONNU N'EST PAS UNE ERREUR (§15) : la boîte s'ouvre sans sélection, et
			// aucun bandeau ne signale l'échec — un refus ne se distingue pas d'une absence.
			if (dossier === null) return
			setSelection(dossier)
			filAMarquer.current = demandeInitiale
			setIdOuvert(demandeInitiale)
			// SOUS 1024 PX, ON ARRIVE SUR LE MESSAGE, pas sur les dossiers : l'utilisateur a demandé
			// un message précis, et lui rendre la pile au premier étage lui ferait refaire à la main
			// les deux pas que l'adresse venait de lui épargner.
			setEtage('message')
		})()
		return () => {
			vivant = false
		}
	}, [demandeInitiale, setParametresUrl])

	// `CRM-139` — « SEULEMENT MOI » (docs/SPEC-mail-subsystem.md §27.4). Un CONTRÔLE de l'écran, comme `sommeil` : il
	// reste dans l'adresse, sous la clé `courrier`, et rien n'est stocké sur l'appareil. Le filtre ne s'applique qu'avec
	// une identité personnelle ; tant que sa présence n'est pas lue, l'arborescence et la liste attendent.
	const modeCourrier: ModeCourrier = lireModeCourrier(parametresUrl.get(CLE_URL_COURRIER))
	const changerModeCourrier = useCallback(
		(suivant: ModeCourrier) => {
			// Un geste de l'utilisateur : « Précédent » le défait, comme la bascule de sommeil.
			setParametresUrl((precedents) => ecrireModeCourrier(precedents, suivant))
		},
		[setParametresUrl],
	)
	const { etat: etatSession } = useAuthentification()
	const idUtilisateur = etatSession.statut === 'authentifie' ? etatSession.utilisateur.id : null
	const [presence, setPresence] = useState<PresenceIdentite>('chargement')
	const [essaiPresence, setEssaiPresence] = useState(0)
	useEffect(() => {
		// SANS SESSION, PERSONNE N'A D'IDENTITÉ : le filtre ne s'applique pas. Seule une session en cours d'ouverture fait
		// attendre l'écran.
		if (etatSession.statut === 'anonyme') {
			setPresence('aucune')
			return
		}
		if (idUtilisateur === null) return
		let vivant = true
		setPresence('chargement')
		void lirePresenceIdentite(clientCrm, idUtilisateur).then((lue) => {
			if (vivant) setPresence(lue)
		})
		return () => {
			vivant = false
		}
	}, [etatSession.statut, idUtilisateur, essaiPresence])
	const filtreCourrier = filtreApplique(modeCourrier, presence)

	// L'ADRESSE D'UN MESSAGE L'EMPORTE SUR LA CASE (§27.4) : la palette mène à un message, jamais à un panneau vide. Le
	// message demandé est retenu à l'amorce ; dès que le filtre est connu et s'il s'applique, on demande à la base si ce
	// message concerne la personne, et la case passe décochée s'il ne la concerne pas. Une seule fois.
	const messageAVerifier = useRef<string | null>(demandeInitiale)
	useEffect(() => {
		const id = messageAVerifier.current
		if (id === null || id === '' || filtreCourrier === null) return
		messageAVerifier.current = null
		if (!filtreCourrier) return
		let vivant = true
		void messageMeConcerne(clientCrm, id).then((concerne) => {
			if (!vivant || concerne !== false) return
			setParametresUrl((precedents) => ecrireModeCourrier(precedents, 'tous'), { replace: true })
		})
		return () => {
			vivant = false
		}
	}, [filtreCourrier, setParametresUrl])

	const arbre = useArborescence(clientCrm, filtreCourrier)
	// `CRM-141` T4 — LE FILTRE « PASTILLE » ENTRE DANS L'ADRESSE (§31.7, clé `pastille`) : un contrôle de l'écran, comme
	// `sommeil`. Une valeur mal formée vaut l'absence de filtre ; le choisir est un geste, que « Précédent » défait.
	const pastilleFiltre = lirePastilleFiltre(parametresUrl.get(CLE_URL_PASTILLE))
	const changerPastille = useCallback(
		(id: string | null) => {
			setParametresUrl((precedents) => {
				const suivants = new URLSearchParams(precedents)
				if (id === null) suivants.delete(CLE_URL_PASTILLE)
				else suivants.set(CLE_URL_PASTILLE, id)
				return suivants
			})
		},
		[setParametresUrl],
	)
	const catalogue = catalogueOuVide(useCataloguePastilles())
	const liste = useMessages(clientCrm, selection, filtreCourrier, pastilleFiltre)
	const message = useMessage(clientCrm, idOuvert)
	const fils = useFilsEndormis(clientCrm)

	// UN SEUL INSTANT PAR RENDU DE LISTE, partagé par le filtre, les pastilles de ligne et celle du
	// message ouvert (§16.15.4). Il est recalculé quand la liste ou l'état des fils est relu — donc
	// après chaque geste —, jamais à chaque ligne : sinon une échéance franchie pendant le rendu
	// marquerait une ligne et pas sa voisine.
	const maintenant = useMemo(() => new Date(), [liste.etat, fils.etat])

	const filsEndormis = fils.etat.statut === 'pret' ? fils.etat.donnees : new Map<string, string>()

	// LE FIL DU MESSAGE OUVERT EST CALCULÉ SUR LA PAGE COURANTE, et il alimente le SEUL sélecteur
	// du §16.16.4. Il n'est PAS relu au serveur : la page porte déjà les messages du fil qu'elle a
	// rapportés, et une seconde lecture ferait diverger ce que la liste montre de ce que le
	// sélecteur propose — un fil de la page pourrait alors offrir un message que la liste ignore.
	//
	// LA CONSÉQUENCE EST ASSUMÉE ET ÉCRITE (§16.16.3) : un fil dont la page ne porte qu'une partie
	// des messages n'en propose que cette partie. C'est la même borne que celle du compte affiché,
	// et la mention « la liste est tronquée » la signale déjà.
	const messagesDuFil = useMemo(() => {
		if (liste.etat.statut !== 'pret') return []
		return filDuMessage(grouperEnFils(liste.etat.donnees.messages), idOuvert)?.messages ?? []
	}, [liste.etat, idOuvert])

	// APRÈS UN GESTE DE SOMMEIL, l'état des fils est relu — c'est LUI qui décide de la pastille et
	// du filtre —, et la liste ne l'est pas : elle n'a pas changé côté serveur (mesure G), et la
	// relire ferait clignoter l'écran pour rien.
	const apresSommeil = useCallback(
		(issue: 'endormi' | 'reveille') => {
			setAnnonce(issue === 'endormi' ? t('inbox.sleep.announce.slept') : t('inbox.sleep.announce.woken'))
			fils.recharger()
		},
		[fils],
	)

	// `CRM-144` T3 — L'OUTBOX (§5.98). Le dossier d'envois ouvert est une DÉSIGNATION de ce qui est montré, comme un dossier :
	// il vit dans l'adresse, sous la clé `envois`, et un rechargement le garde. « Seulement moi » ne s'y applique pas.
	const dossierEnvoi = dossierEnvoiDepuisAdresse(parametresUrl.get(PARAMETRE_ENVOIS))
	const [idEnvoi, setIdEnvoi] = useState<string | null>(null)
	const [comptesEnvois, setComptesEnvois] = useState<EtatAsync<ComptesEnvois>>({ statut: 'chargement' })
	const relireComptesEnvois = useCallback(() => {
		void lireComptesEnvois(clientCrm).then(setComptesEnvois)
	}, [])
	useEffect(() => {
		relireComptesEnvois()
	}, [relireComptesEnvois])
	const envois = useEnvois(dossierEnvoi)
	const refFile = useRef<HTMLButtonElement | null>(null)
	const refEnvoyes = useRef<HTMLButtonElement | null>(null)
	const refEchecs = useRef<HTMLButtonElement | null>(null)
	const refsEnvois = useMemo(() => ({ file: refFile, envoyes: refEnvoyes, echecs: refEchecs }), [])
	// `CRM-138` T3 : QUITTER UNE VUE ADRESSÉE quitte l'outbox ET la corbeille, en UNE écriture d'adresse — deux écritures
	// fonctionnelles d'affilée partiraient du même état, et la seconde effacerait la première.
	const quitterEnvois = useCallback(() => {
		setIdEnvoi(null)
		setParametresUrl((precedents) => {
			if (!precedents.has(PARAMETRE_ENVOIS) && !precedents.has(PARAMETRE_CORBEILLE)) return precedents
			const suivants = new URLSearchParams(precedents)
			suivants.delete(PARAMETRE_ENVOIS)
			suivants.delete(PARAMETRE_CORBEILLE)
			return suivants
		})
	}, [setParametresUrl])
	const choisirEnvois = useCallback(
		(dossier: DossierEnvoi) => {
			setPreparesChoisis(false)
			setIdPrepare(null)
			setSelection(null)
			setIdOuvert(null)
			setIdEnvoi(null)
			setEtage('liste')
			// Un geste de l'utilisateur : « Précédent » le défait.
			setParametresUrl((precedents) => {
				const suivants = new URLSearchParams(precedents)
				suivants.set(PARAMETRE_ENVOIS, dossier)
				suivants.delete(PARAMETRE_CORBEILLE)
				return suivants
			})
			relireComptesEnvois()
		},
		[setParametresUrl, relireComptesEnvois],
	)
	// APRÈS UNE ANNULATION OU UNE REMISE EN FILE : la ligne quitte son dossier, le détail se referme, les comptes sont relus,
	// et le focus va à l'entrée du dossier quitté (§5.13 : jamais sur un élément qui disparaît).
	const apresGesteEnvoi = useCallback(
		(geste: 'annule' | 'reessaye') => {
			setAnnonce(geste === 'annule' ? t('outbox.annule') : t('outbox.reessaye'))
			setIdEnvoi(null)
			setEtage('liste')
			envois.relire()
			relireComptesEnvois()
			if (dossierEnvoi !== null) refsEnvois[dossierEnvoi].current?.focus()
		},
		[envois, relireComptesEnvois, dossierEnvoi, refsEnvois],
	)
	const maintenantEnvois = useMemo(() => new Date(), [envois.etat])

	const choisirPrepares = useCallback(() => {
		quitterEnvois()
		setPreparesChoisis(true)
		setSelection(null)
		setIdOuvert(null)
		setIdPrepare(null)
		setEtage('liste')
	}, [quitterEnvois])

	// APRÈS UN ENVOI OU UN ÉCART, LA LISTE EST RELUE, LA RELECTURE SE REFERME, ET LE FOCUS VA À L'ENTRÉE si elle reste,
	// sinon à l'état vide de la liste (§5.13 : jamais sur un élément qui disparaît).
	const apresGestePrepare = useCallback(
		(texte: string) => {
			setAnnonce(texte)
			setIdPrepare(null)
			setFocusApresGeste(true)
			relirePrepares()
		},
		[relirePrepares],
	)
	useEffect(() => {
		if (!focusApresGeste || mailsPrepares.statut !== 'pret') return
		setFocusApresGeste(false)
		if (mailsPrepares.donnees.length > 0) refEntreePrepares.current?.focus()
		else refVidePrepares.current?.focus()
	}, [focusApresGeste, mailsPrepares])

	const choisirDossier = useCallback(
		(choix: Selection) => {
			quitterEnvois()
			setPreparesChoisis(false)
			setIdPrepare(null)
			setSelection((precedent) => (MEME_SELECTION(precedent, choix) ? precedent : choix))
			setIdOuvert(null)
			setEtage('liste')
			setErreurLectureListe(null)
			setErreurLectureMessage(null)
		},
		[quitterEnvois],
	)

	// =============================================================================================
	// `CRM-138` T3 — LA CORBEILLE DE L'INBOX (docs/DESIGN_SYSTEM.md §5.102 ; docs/SPEC-mail-subsystem.md §29.1)
	// =============================================================================================
	//
	// Le dossier ouvert est une DÉSIGNATION de ce qui est montré (§5.36) : il vit dans l'adresse, sous la clé `corbeille`,
	// comme `envois`. La liste est ce que `trashed_messages` rend ; la rétention est LUE EN BASE ; la phrase « Vous voyez
	// les messages que vous avez effacés » suit la capacité d'administrer rendue par la base (§5.59), jamais un rôle.
	const { idWorkspace, capacites } = useContexteEspace()
	const corbeilleChoisie = dossierEnvoi === null && corbeilleDepuisAdresse(parametresUrl.get(PARAMETRE_CORBEILLE))
	const [corbeille, setCorbeille] = useState<EtatAsync<readonly MessageEnCorbeille[]>>({ statut: 'chargement' })
	const relireCorbeille = useCallback(() => {
		if (idWorkspace === null) return
		void lireCorbeilleMessages(clientCrm, idWorkspace).then(setCorbeille)
	}, [idWorkspace])
	useEffect(() => {
		relireCorbeille()
	}, [relireCorbeille])
	const [retention, setRetention] = useState<EtatAsync<number>>({ statut: 'chargement' })
	useEffect(() => {
		if (clientCrm === null) return
		let vivant = true
		void lireRetentionCorbeille(clientCrm).then((lue) => {
			if (vivant) setRetention(lue)
		})
		return () => {
			vivant = false
		}
	}, [])
	const refEntreeCorbeille = useRef<HTMLButtonElement | null>(null)
	const refVideCorbeille = useRef<HTMLDivElement | null>(null)
	const refsLignesCorbeille = useRef<Map<string, HTMLLIElement>>(new Map())
	const [mentionCorbeille, setMentionCorbeille] = useState('')
	const choisirCorbeille = useCallback(() => {
		setPreparesChoisis(false)
		setIdPrepare(null)
		setSelection(null)
		setIdOuvert(null)
		setIdEnvoi(null)
		setMentionCorbeille('')
		setEtage('liste')
		// Un geste de l'utilisateur : « Précédent » le défait.
		setParametresUrl((precedents) => {
			const suivants = new URLSearchParams(precedents)
			suivants.set(PARAMETRE_CORBEILLE, VALEUR_CORBEILLE)
			suivants.delete(PARAMETRE_ENVOIS)
			return suivants
		})
		relireCorbeille()
	}, [setParametresUrl, relireCorbeille])

	// APRÈS UNE RESTAURATION, LE FOCUS VA À LA LIGNE QUI A PRIS SA PLACE, sinon à la précédente, sinon à l'état vide
	// (§5.13 : jamais sur un élément qui disparaît). Le rang est relevé AVANT la relecture, et appliqué à la liste relue.
	const focusCorbeille = useRef<{ readonly rang: number; readonly avant: unknown } | null>(null)
	const apresRestauration = useCallback(
		(id: string) => {
			const rang = corbeille.statut === 'pret' ? corbeille.donnees.findIndex((ligne) => ligne.id === id) : 0
			focusCorbeille.current = { rang: Math.max(rang, 0), avant: corbeille }
			setMentionCorbeille(t('inbox.trash.announce.restored'))
			relireCorbeille()
			arbre.recharger()
			liste.recharger()
		},
		[corbeille, relireCorbeille, arbre, liste],
	)
	useEffect(() => {
		const attente = focusCorbeille.current
		if (attente === null || corbeille === attente.avant || corbeille.statut !== 'pret') return
		focusCorbeille.current = null
		const lignes = corbeille.donnees
		if (lignes.length === 0) {
			refVideCorbeille.current?.focus()
			return
		}
		const cible = lignes[Math.min(attente.rang, lignes.length - 1)]
		if (cible !== undefined) refsLignesCorbeille.current.get(cible.id)?.focus()
	}, [corbeille])

	// APRÈS UN EFFACEMENT (§5.102) : le message ouvert se referme sur l'état « absence de sélection », la région vivante
	// le dit, les comptes sont relus, et le focus va à la ligne qui a pris la place de celle du message, ou à l'entrée du
	// dossier si la liste est vide. Le rang de la ligne est relevé AVANT la relecture.
	const focusApresEffacement = useRef<{ readonly rang: number; readonly avant: unknown } | null>(null)
	const apresEffacement = useCallback(
		(_id: string) => {
			const lignes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="inbox-message"]'))
			const rang = lignes.findIndex((ligne) => ligne.getAttribute('aria-current') === 'true')
			focusApresEffacement.current = { rang: Math.max(rang, 0), avant: liste.etat }
			setAnnonce(t('inbox.trash.announce.deleted'))
			setIdOuvert(null)
			setEtage('liste')
			arbre.recharger()
			liste.recharger()
			relireCorbeille()
		},
		[arbre, liste, relireCorbeille],
	)
	useEffect(() => {
		const attente = focusApresEffacement.current
		if (attente === null || liste.etat === attente.avant || liste.etat.statut !== 'pret') return
		focusApresEffacement.current = null
		// LA LISTE RELUE EST RENDUE AVANT D'ÊTRE PARCOURUE : le cadre suivant porte ses lignes.
		requestAnimationFrame(() => {
			const lignes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="inbox-message"]'))
			const cible = lignes[Math.min(attente.rang, lignes.length - 1)]
			if (cible !== undefined) {
				cible.focus()
				return
			}
			const entree = document.querySelector<HTMLButtonElement>(
				'[data-testid="inbox-panneau-dossiers"] button[aria-current="true"]',
			)
			// SOUS 1024 PX, L'ENTRÉE VIT DANS LE PANNEAU DES DOSSIERS, que la pile cache : on y remonte d'un cran.
			if (entree !== null && entree.offsetParent === null) {
				setEtage('dossiers')
				requestAnimationFrame(() => entree.focus())
				return
			}
			entree?.focus()
		})
	}, [liste.etat])

	const ouvrirMessage = useCallback((lu: MessageListe) => {
		filAMarquer.current = lu.id
		setErreurLectureMessage(null)
		setIdOuvert(lu.id)
		setEtage('message')
	}, [])

	// OUVRIR UN FIL LE MARQUE LU TOUT ENTIER (§18 bis.2 point 3) : ses messages non lus de la page, et eux seuls. Le
	// marquage attend que la page du dossier soit lue — à l'arrivée par l'adresse, le dossier et le message sont posés
	// ensemble, et la page vide du dossier précédent ne dit encore rien du fil. Un message ouvert que la page ne porte
	// pas (liste tronquée) est marqué seul.
	useEffect(() => {
		const cible = filAMarquer.current
		if (cible === null || cible !== idOuvert || liste.etat.statut !== 'pret') return
		if (messagesDuFil.length === 0 && liste.etat.donnees.messages.length === 0) return
		filAMarquer.current = null
		const ids = messagesDuFil.length > 0 ? idsNonLus(messagesDuFil) : [cible]
		if (ids.length === 0) return
		void marquerLus(clientCrm, ids).then((erreur) => {
			if (erreur !== null) {
				setErreurLectureMessage(erreur)
				return
			}
			arbre.recharger()
			liste.recharger()
		})
	}, [idOuvert, liste, messagesDuFil, arbre])

	const basculerLecture = useCallback(
		(id: string, lu: boolean) => {
			setErreurLectureMessage(null)
			void (lu ? marquerNonLu(clientCrm, id) : marquerLus(clientCrm, [id])).then((erreur) => {
				if (erreur !== null) {
					setErreurLectureMessage(erreur)
					return
				}
				setAnnonce(lu ? t('inbox.read.announce.unread') : t('inbox.read.announce.read'))
				arbre.recharger()
				liste.recharger()
			})
		},
		[arbre, liste],
	)

	const toutMarquerLu = useCallback(
		(ids: readonly string[]) => {
			setErreurLectureListe(null)
			void marquerLus(clientCrm, ids).then((erreur) => {
				if (erreur !== null) {
					setErreurLectureListe(erreur)
					return
				}
				setAnnonce(t('inbox.read.announce.all'))
				arbre.recharger()
				liste.recharger()
			})
		},
		[arbre, liste],
	)

	const luAffiche = useMemo(
		() => messagesDuFil.find((candidat) => candidat.id === idOuvert)?.lu ?? null,
		[messagesDuFil, idOuvert],
	)

	// APRÈS UN CLASSEMENT, TOUT CE QUI A CHANGÉ EST RELU : les compteurs de l'arbre, la liste des
	// non classés d'où le message sort, et le message lui-même, qui porte désormais une affaire.
	const apresClassement = useCallback(() => {
		setAnnonce(t('inbox.classify.done'))
		arbre.recharger()
		liste.recharger()
		message.recharger()
	}, [arbre, liste, message])

	const titreArbre = useMemo(
		() => (arbre.etat.statut === 'pret' ? arbre.etat.donnees.nonClasses : 0),
		[arbre.etat],
	)

	return (
		<div className="flex flex-col h-full min-h-0" data-testid="route-inbox">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-border lg:hidden">
				<Inbox aria-hidden="true" size={18} className="text-brand" />
				<span className="font-medium">{t('route.inbox.title')}</span>
				<span className="text-sm text-text-3">
					{t('inbox.folders.unclassified')} : {titreArbre}
				</span>
			</div>
			<div className="flex flex-1 min-h-0 flex-col lg:flex-row">
				<PanneauDossiers
					etat={arbre.etat}
					selection={selection}
					onChoisir={choisirDossier}
					onReprise={arbre.reprendre}
					visible={etage === 'dossiers'}
					mailsPrepares={mailsPrepares}
					preparesChoisis={preparesChoisis}
					onChoisirPrepares={choisirPrepares}
					refEntreePrepares={refEntreePrepares}
					courrier={{
						mode: modeCourrier,
						presence,
						onMode: changerModeCourrier,
						onReprise: () => setEssaiPresence((n) => n + 1),
					}}
					envois={{ comptes: comptesEnvois, choisi: dossierEnvoi, onChoisir: choisirEnvois, refs: refsEnvois }}
					corbeille={{
						nombre: corbeille.statut === 'pret' ? corbeille.donnees.length : null,
						choisie: corbeilleChoisie,
						onChoisir: choisirCorbeille,
						refBouton: refEntreeCorbeille,
					}}
				/>
				{dossierEnvoi !== null ? (
					<>
						<PanneauListeEnvois
							dossier={dossierEnvoi}
							etat={envois.etat}
							idOuvert={idEnvoi}
							maintenant={maintenantEnvois}
							onOuvrir={(id) => {
								setIdEnvoi(id)
								setEtage('message')
							}}
							onRetour={() => setEtage('dossiers')}
							onReprise={envois.relire}
							onPlus={envois.plus}
							visible={etage === 'liste'}
						/>
						<PanneauDetailEnvoi
							dossier={dossierEnvoi}
							etat={envois.etat}
							idOuvert={idEnvoi}
							onRetour={() => setEtage('liste')}
							onFait={apresGesteEnvoi}
							onRelire={() => {
								envois.relire()
								relireComptesEnvois()
							}}
							visible={etage === 'message'}
						/>
					</>
				) : corbeilleChoisie ? (
					<PanneauCorbeille
						etat={corbeille}
						retention={retention}
						personnelle={capacites.administration === 'refusee'}
						mention={mentionCorbeille}
						onRestaure={apresRestauration}
						onRetour={() => setEtage('dossiers')}
						onReprise={relireCorbeille}
						visible={etage === 'liste'}
						refVide={refVideCorbeille}
						refsLignes={refsLignesCorbeille}
					/>
				) : preparesChoisis ? (
					<>
						<PanneauListePrepares
							etat={mailsPrepares}
							idOuvert={idPrepare}
							onOuvrir={(id) => {
								setIdPrepare(id)
								setEtage('message')
							}}
							onRetour={() => setEtage('dossiers')}
							onReprise={relirePrepares}
							visible={etage === 'liste'}
							refVide={refVidePrepares}
						/>
						<PanneauRelecture
							etat={mailsPrepares}
							idOuvert={idPrepare}
							onRetour={() => setEtage('liste')}
							onEnvoye={() => apresGestePrepare(t('envoi.file'))}
							onEcarte={() => apresGestePrepare(t('mailsPrepares.ecarte'))}
							onPlusEnAttente={relirePrepares}
							visible={etage === 'message'}
						/>
					</>
				) : (
					<>
				<PanneauListe
					etat={liste.etat}
					selection={selection}
					idOuvert={idOuvert}
					onOuvrir={ouvrirMessage}
					onRetour={() => setEtage('dossiers')}
					onReprise={liste.reprendre}
					visible={etage === 'liste'}
					fils={filsEndormis}
					mode={mode}
					onMode={changerMode}
					maintenant={maintenant}
					onToutMarquer={toutMarquerLu}
					erreurMarquage={erreurLectureListe}
					filtreCourrier={filtreCourrier === true}
					onToutAfficher={() => changerModeCourrier('tous')}
					catalogue={catalogue}
					pastille={pastilleFiltre}
					onPastille={changerPastille}
				/>
				<PanneauMessage
					etat={message.etat}
					onRetour={() => setEtage('liste')}
					onReprise={message.reprendre}
					onClasse={apresClassement}
					onRepondu={apresClassement}
					visible={etage === 'message'}
					fils={filsEndormis}
					maintenant={maintenant}
					onSommeil={apresSommeil}
					messagesDuFil={messagesDuFil}
					onOuvrir={ouvrirMessage}
					lu={luAffiche}
					onBasculerLecture={basculerLecture}
					erreurMarquage={erreurLectureMessage}
					retention={retention}
					onEfface={apresEffacement}
					catalogue={catalogue}
					edition={capacites.edition}
					onAnnonce={setAnnonce}
				/>
					</>
				)}
			</div>
			<LiveRegion libelle={t('route.inbox.title')} message={annonce} />
		</div>
	)
}
