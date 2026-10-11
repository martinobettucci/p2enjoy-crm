// @spec CRM-098 (docs/BACKLOG.md) — tranches T2 et T3 : l'écran « Temps », route de premier niveau, et ses deux onglets
// @spec docs/SPEC-temps.md §7.1 (« Temps », `/temps` ; onglets « Saisie » et « Rapport mensuel », `?onglet=rapport` ;
//       « Saisir pour » réservé aux administrateurs), §5 (chacun saisit son temps) ; docs/DESIGN_SYSTEM.md §5.54
//       (entrée de navigation, onglets du style de la fiche d'affaire, états), §5.8 (états explicites)
//
// Point de montage : il lit l'espace courant, l'utilisateur et son rôle, et confie chaque onglet à son composant. Sans
// session ni espace, l'écran rend un état vide qui le dit — jamais une page blanche.

import { Link, useSearchParams } from 'react-router'
import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { jourLocal } from '../lib/temps'
import { useAuthentification } from './Authentification'
import { useContexteEspace } from './ContexteEspace'
import { CLASSES_ACTIF, CLASSES_INACTIF, CLASSES_ONGLET } from './OngletsCouts'
import { RapportTemps } from './RapportTemps'
import { SaisieTemps } from './SaisieTemps'

/** Le paramètre d'adresse de l'onglet ; seule la valeur du rapport s'écrit, la saisie est l'onglet par défaut. */
export const CLE_URL_ONGLET_TEMPS = 'onglet' as const
export const VALEUR_URL_RAPPORT = 'rapport' as const

export type ProprietesTemps = {
	readonly client?: ClientCrm | null
	/** Le jour local, injectable pour les preuves ; par défaut celui du poste. */
	readonly aujourdhui?: string
}

export function Temps({ client = clientCrm, aujourdhui = jourLocal(new Date()) }: ProprietesTemps = {}) {
	const { idWorkspace, estAdmin } = useContexteEspace()
	const authentification = useAuthentification()
	const idUtilisateur = authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null
	const [parametres] = useSearchParams()
	const rapport = parametres.get(CLE_URL_ONGLET_TEMPS) === VALEUR_URL_RAPPORT

	if (client === null || idWorkspace === null || idUtilisateur === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('time.noworkspace.body')} />
	}

	// Changer d'espace ou d'utilisateur repart d'un écran neuf : aucun état d'une personne ne survit à l'autre.
	const cle = `${idWorkspace}:${idUtilisateur}`
	const proprietes = { client, idWorkspace, idUtilisateur, estAdmin, aujourdhui }

	return (
		<div className="flex flex-col gap-4">
			<OngletsTemps rapport={rapport} />
			{rapport ? <RapportTemps key={cle} {...proprietes} /> : <SaisieTemps key={cle} {...proprietes} />}
		</div>
	)
}

function OngletsTemps({ rapport }: { readonly rapport: boolean }) {
	const [parametres] = useSearchParams()
	// Chaque onglet garde son propre paramètre (la semaine, le mois) et laisse celui de l'autre.
	const versSaisie = new URLSearchParams(parametres)
	versSaisie.delete(CLE_URL_ONGLET_TEMPS)
	const versRapport = new URLSearchParams(parametres)
	versRapport.set(CLE_URL_ONGLET_TEMPS, VALEUR_URL_RAPPORT)
	const chaine = (p: URLSearchParams) => (p.toString() === '' ? '' : `?${p.toString()}`)

	return (
		<nav aria-label={t('time.tabs.aria')} className="flex items-center gap-1 overflow-x-auto border-b border-border indique-debordement-x">
			<Link
				to={{ search: chaine(versSaisie) }}
				data-testid="onglet-temps-saisie"
				{...(!rapport ? { 'aria-current': 'page' as const } : {})}
				className={`${CLASSES_ONGLET} ${!rapport ? CLASSES_ACTIF : CLASSES_INACTIF}`}
			>
				{t('time.tabs.entry')}
			</Link>
			<Link
				to={{ search: chaine(versRapport) }}
				data-testid="onglet-temps-rapport"
				{...(rapport ? { 'aria-current': 'page' as const } : {})}
				className={`${CLASSES_ONGLET} ${rapport ? CLASSES_ACTIF : CLASSES_INACTIF}`}
			>
				{t('time.tabs.report')}
			</Link>
		</nav>
	)
}
