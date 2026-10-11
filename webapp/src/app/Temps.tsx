// @spec CRM-098 (docs/BACKLOG.md) — tranche T2 : l'écran « Temps », route de premier niveau
// @spec docs/SPEC-temps.md §7.1 (« Temps », `/temps` ; « Saisir pour » réservé aux administrateurs), §5 (chacun saisit
//       son temps) ; docs/DESIGN_SYSTEM.md §5.54 (entrée de navigation, états), §5.8 (états explicites)
//
// Point de montage : il lit l'espace courant, l'utilisateur et son rôle, et confie la matrice à `SaisieTemps`. Sans
// session ni espace, l'écran rend un état vide qui le dit — jamais une page blanche.

import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { jourLocal } from '../lib/temps'
import { useAuthentification } from './Authentification'
import { useContexteEspace } from './ContexteEspace'
import { SaisieTemps } from './SaisieTemps'

export type ProprietesTemps = {
	readonly client?: ClientCrm | null
	/** Le jour local, injectable pour les preuves ; par défaut celui du poste. */
	readonly aujourdhui?: string
}

export function Temps({ client = clientCrm, aujourdhui = jourLocal(new Date()) }: ProprietesTemps = {}) {
	const { idWorkspace, estAdmin } = useContexteEspace()
	const authentification = useAuthentification()
	const idUtilisateur = authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null

	if (client === null || idWorkspace === null || idUtilisateur === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('time.noworkspace.body')} />
	}

	return (
		<SaisieTemps
			// Changer d'espace ou d'utilisateur repart d'un écran neuf : aucun état d'une personne ne survit à l'autre.
			key={`${idWorkspace}:${idUtilisateur}`}
			client={client}
			idWorkspace={idWorkspace}
			idUtilisateur={idUtilisateur}
			estAdmin={estAdmin}
			aujourdhui={aujourdhui}
		/>
	)
}
