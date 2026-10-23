// @spec CRM-070 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Membres, les membres de l'espace et leurs rôles
// @spec docs/SPEC-membres.md §3 (consultable par tout membre, commandes éteintes par la capacité d'administration),
//       §3.1 (changer le rôle, retirer, soi-même, le dernier administrateur), §3.4 (états et refus traduits), §4 (le
//       tableau partagé avec la plateforme) ; docs/SPEC-droits-interface.md §3, §4 ; docs/JOURNAL.md décisions 634, 635
// @spec docs/DESIGN_SYSTEM.md §5.61 (l'écran des membres), §5.59 (motif de bloc, commande éteinte lisible), §5.8 (états),
//       §5.27 (confirmation sur une ligne, message sous le tableau), §5.21 (relu après chaque écriture)
// @spec CRM-070 (docs/BACKLOG.md) — tranche T3 : la section « Attentes », rendue au seul administrateur de l'espace ;
//       docs/SPEC-membres.md §3.2 (inscrire, remplacer, retirer ; en attente, en suspens), §5 point 3 ;
//       docs/DESIGN_SYSTEM.md §5.61, §5.28 (un seul bloc ouvert)
// @spec CRM-070 (docs/BACKLOG.md) — tranche T4 : la section « Droits fins », rendue au seul administrateur de l'espace —
//       la lecture de l'accès effectif lui est réservée par la base (docs/SPEC-membres.md §3.3, §5 point 1)
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
	attenteSuspendue,
	changerRoleMembre,
	inscrireAttente,
	lireAttentesEspace,
	lireMembresEspace,
	retirerAttenteEspace,
	retirerMembreEspace,
	type AttenteEspace,
	type IssueMembre,
	type MembreEspace,
	type MotifRefusMembre,
} from '../lib/membres-espace'
import type { RoleEspace } from '../lib/plateforme'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { lireWorkspaces } from '../lib/workspaces'
import { useAuthentification } from './Authentification'
import { useContexteEspace } from './ContexteEspace'
import { BlocAttentes, type IssueFormulaire } from './BlocAttentes'
import { DroitsFins } from './DroitsFins'
import { libelleRole } from './presentation-plateforme'
import { BlocMessage, TableauMembres, type MembreTableau, type Message } from './TableauMembres'

const ID_MOTIF_MEMBRES = 'membres-motif'

const REFUS: Readonly<Record<MotifRefusMembre, CleTraduction>> = {
	'dernier-administrateur': 'platform.refus.dernierAdministrateur',
	'sans-effet': 'members.refused.noEffect',
	'adresse-invalide': 'platform.refus.adresse',
	'role-invalide': 'platform.refus.role',
	droit: 'members.refused.forbidden',
	reseau: 'platform.refus.reseau',
	inconnu: 'platform.refus.inconnu',
}

type Donnees = {
	readonly nomEspace: string
	readonly membres: readonly MembreEspace[]
	/** `null` pour qui n'administre pas l'espace : la section est absente, sans phrase qui dirait qu'elle existe (§3.2). */
	readonly attentes: readonly AttenteEspace[] | null
}

/** Le seul bloc ouvert de l'écran (§5.28) : une confirmation de retrait, ou le formulaire d'une attente. */
type Ouverture = { readonly type: 'retirer-membre'; readonly idUtilisateur: string } | { readonly type: 'inscrire' } | null

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
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [message, setMessage] = useState<Message>(null)
	const [messageAttentes, setMessageAttentes] = useState<Message>(null)
	// Les attentes ne sont lues que si la base dit que l'appelant administre l'espace : pour un autre membre, la RLS
	// rendrait une liste vide, que l'écran ne doit pas montrer comme « aucune attente ».
	const administre = capacites.administration === 'permise'

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		let courant = true
		void Promise.all([
			lireWorkspaces(client),
			lireMembresEspace(client, idWorkspace),
			administre ? lireAttentesEspace(client, idWorkspace) : Promise.resolve(null),
		]).then(([espaces, membres, attentes]) => {
			if (!courant) return
			if (espaces.statut === 'erreur') return setEtat(enErreur(espaces.erreur))
			if (membres.statut === 'erreur') return setEtat(enErreur(membres.erreur))
			if (attentes !== null && attentes.statut === 'erreur') return setEtat(enErreur(attentes.erreur))
			if (espaces.statut !== 'pret' || membres.statut !== 'pret' || (attentes !== null && attentes.statut !== 'pret')) return
			const nomEspace = espaces.donnees.find((espace) => espace.id === idWorkspace)?.name ?? ''
			setEtat(pret({ nomEspace, membres: membres.donnees, attentes: attentes === null ? null : attentes.donnees }))
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, administre, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('members.noworkspace.body')} />
	}

	const commande = proprietesCommande(capacites.administration, ID_MOTIF_MEMBRES)
	const nomDe = (membre: MembreEspace) => membre.nom ?? t('members.unnamed')
	const ouvrir = (suivante: Ouverture) => {
		setOuverture(suivante)
		setMessage(null)
		setMessageAttentes(null)
	}
	const inscrire = async (email: string, role: RoleEspace): Promise<IssueFormulaire> => {
		const issue = await inscrireAttente(client, idWorkspace, email, role)
		if (!issue.ok) return { ok: false, refus: t(REFUS[issue.motif]) }
		const adresse = email.trim().toLowerCase()
		return {
			ok: true,
			message: {
				ton: 'succes',
				texte:
					issue.remplace === null
						? t('platform.attentes.inscrite', { email: adresse })
						: t('members.attentes.remplacee', { email: adresse, avant: libelleRole(issue.remplace), apres: libelleRole(role) }),
			},
		}
	}

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
							idConfirmation={ouverture?.type === 'retirer-membre' ? ouverture.idUtilisateur : null}
							onDemanderRetrait={(membre) => ouvrir({ type: 'retirer-membre', idUtilisateur: membre.idUtilisateur })}
							onFermer={() => setOuverture(null)}
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
			{etat.statut === 'pret' && etat.donnees.attentes !== null && (
				<BlocAttentes
					attentes={etat.donnees.attentes.map((attente) => ({
						...attente,
						enSuspens: attenteSuspendue(attente.role, etat.donnees.membres.filter((membre) => membre.role === 'admin').length),
					}))}
					niveauTitre="h3"
					roleParDefaut="viewer"
					ouvert={ouverture?.type === 'inscrire'}
					onOuvrir={() => ouvrir({ type: 'inscrire' })}
					onFermer={() => setOuverture(null)}
					message={messageAttentes}
					onMessage={(suivant) => {
						setMessageAttentes(suivant)
						relire()
					}}
					inscrire={inscrire}
					retirer={async (attente) =>
						messageDe(
							await retirerAttenteEspace(client, idWorkspace, attente.email),
							t('platform.attentes.retiree', { email: attente.email }),
						)
					}
				/>
			)}
			{etat.statut === 'pret' && administre && (
				<DroitsFins
					client={client}
					idWorkspace={idWorkspace}
					membres={etat.donnees.membres.map((membre) => ({
						idUtilisateur: membre.idUtilisateur,
						nom: nomDe(membre),
						administrateur: membre.role === 'admin',
					}))}
					texteRefus={(motif) => t(REFUS[motif])}
				/>
			)}
		</div>
	)
}
