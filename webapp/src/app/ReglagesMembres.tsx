// @spec CRM-070 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Membres, les membres de l'espace et leurs rôles
// @spec docs/SPEC-membres.md §3 (consultable par tout membre, commandes éteintes par la capacité d'administration),
//       §3.1 (changer le rôle, retirer, soi-même, le dernier administrateur), §3.4 (états et refus traduits), §4 (le
//       tableau partagé avec la plateforme) ; docs/SPEC-droits-interface.md §3, §4 ; docs/JOURNAL.md décisions 634, 635
// @spec docs/DESIGN_SYSTEM.md §5.61 (l'écran des membres), §5.59 (motif de bloc, commande éteinte lisible), §5.8 (états),
//       §5.27 (confirmation sur une ligne, message sous le tableau), §5.21 (relu après chaque écriture)
// @spec CLAUDE.md §10 — l'écran n'éteint que ce que la base refuse sur la ligne de l'espace ; chaque geste garde son refus
//
// L'ÉCRAN EST RELU APRÈS CHAQUE ÉCRITURE, JAMAIS COMPLÉTÉ LOCALEMENT, et la relecture garde à l'écran ce qu'elle relit :
// le squelette n'appartient qu'au premier chargement (§5.29 tranche 2 c).

import { useCallback, useEffect, useState } from 'react'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { motifVisible, proprietesCommande } from '../lib/capacites'
import {
	changerRoleMembre,
	lireMembresEspace,
	retirerMembreEspace,
	type IssueMembre,
	type MembreEspace,
	type MotifRefusMembre,
} from '../lib/membres-espace'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { lireWorkspaces } from '../lib/workspaces'
import { useAuthentification } from './Authentification'
import { useContexteEspace } from './ContexteEspace'
import { BlocMessage, TableauMembres, type MembreTableau, type Message } from './TableauMembres'

const ID_MOTIF_MEMBRES = 'membres-motif'

const REFUS: Readonly<Record<MotifRefusMembre, CleTraduction>> = {
	'dernier-administrateur': 'platform.refus.dernierAdministrateur',
	'sans-effet': 'members.refused.noEffect',
	droit: 'members.refused.forbidden',
	reseau: 'platform.refus.reseau',
	inconnu: 'platform.refus.inconnu',
}

type Donnees = { readonly nomEspace: string; readonly membres: readonly MembreEspace[] }

function messageDe(issue: IssueMembre, succes: string): Message {
	return issue.ok ? { ton: 'succes', texte: succes } : { ton: 'refus', texte: t(REFUS[issue.motif]) }
}

export type ProprietesReglagesMembres = { readonly client?: ClientCrm | null; readonly idUtilisateur?: string }

export function ReglagesMembres({ client = clientCrm, idUtilisateur }: ProprietesReglagesMembres = {}) {
	const authentification = useAuthentification()
	const idSession = idUtilisateur ?? (authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null)
	const { idWorkspace, capacites } = useContexteEspace()
	const [etat, setEtat] = useState<EtatAsync<Donnees>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [idConfirmation, setIdConfirmation] = useState<string | null>(null)
	const [message, setMessage] = useState<Message>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		let courant = true
		void Promise.all([lireWorkspaces(client), lireMembresEspace(client, idWorkspace)]).then(([espaces, membres]) => {
			if (!courant) return
			if (espaces.statut === 'erreur') return setEtat(enErreur(espaces.erreur))
			if (membres.statut === 'erreur') return setEtat(enErreur(membres.erreur))
			if (espaces.statut !== 'pret' || membres.statut !== 'pret') return
			const nomEspace = espaces.donnees.find((espace) => espace.id === idWorkspace)?.name ?? ''
			setEtat(pret({ nomEspace, membres: membres.donnees }))
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('members.noworkspace.body')} />
	}

	const commande = proprietesCommande(capacites.administration, ID_MOTIF_MEMBRES)
	const nomDe = (membre: MembreEspace) => membre.nom ?? t('members.unnamed')

	return (
		<div className="flex max-w-[960px] flex-col gap-4" data-testid="reglages-membres">
			<h2 className="text-h3">{t('members.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('members.intro')}</p>
			{motifVisible(capacites.administration) && (
				<MotifLectureSeule id={ID_MOTIF_MEMBRES} data-testid="motif-membres">
					{t('rights.readonly.administration')}
				</MotifLectureSeule>
			)}
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<EtatErreur
					titre={t('state.error.title')}
					corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : (
				<section aria-labelledby="titre-membres" className="flex flex-col gap-4">
					<h3 id="titre-membres" className="sr-only">
						{t('platform.membres.titre')}
					</h3>
					{etat.donnees.membres.length === 0 ? (
						<p className="text-text-2" data-testid="membres-vide">
							{t('platform.membres.vide')}
						</p>
					) : (
						<TableauMembres
							membres={etat.donnees.membres.map((membre): MembreTableau => ({ ...membre, nom: nomDe(membre) }))}
							nomEspace={etat.donnees.nomEspace}
							colonneSuperadmin={false}
							idConfirmation={idConfirmation}
							onDemanderRetrait={(membre) => {
								setMessage(null)
								setIdConfirmation(membre.idUtilisateur)
							}}
							onFermer={() => setIdConfirmation(null)}
							changerRole={async (membre, role) =>
								messageDe(
									await changerRoleMembre(client, idWorkspace, membre.idUtilisateur, role),
									t('platform.membres.roleChange', { nom: membre.nom }),
								)
							}
							retirer={async (membre) =>
								messageDe(
									await retirerMembreEspace(client, idWorkspace, membre.idUtilisateur),
									t('platform.membres.retire', { nom: membre.nom }),
								)
							}
							onMessage={(suivant) => {
								setMessage(suivant)
								relire()
							}}
							consequence={(membre) =>
								membre.idUtilisateur === idSession ? t('members.confirmation.self') : t('platform.membres.confirmation.consequence')
							}
							commande={commande}
						/>
					)}
					<BlocMessage message={message} testId="message-membres" />
				</section>
			)}
		</div>
	)
}
