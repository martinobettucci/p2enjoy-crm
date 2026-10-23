// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : le bloc des attentes de la fiche d'un espace, extrait de
//       `PlateformeEspace.tsx` sans changer son rendu ; docs/SPEC-plateforme.md §7.3, §7.5
// @spec CRM-070 (docs/BACKLOG.md) — tranche T3 : le même bloc sert Réglages ▸ Membres ; docs/SPEC-membres.md §3.2
//       (inscrire, remplacer, retirer ; en attente, en suspens), §4 (un composant partagé, deux couches d'accès)
// @spec docs/DESIGN_SYSTEM.md §5.9 (tableaux), §5.13 (formulaire dans le flux), §5.23 (la commande s'exclut du formulaire
//       qu'elle ouvre), §5.25 (retour du focus), §5.27 (message sous le tableau), §5.41 (retrait sans confirmation de
//       ce qu'un formulaire repose), §5.61 (le bloc partagé)
// @spec CLAUDE.md §10 — le bloc ne décide aucun droit : ses deux gestes sont fournis par l'écran, qui parle à la base
//
// COMME `TableauMembres`, LE BLOC NE CONNAÎT NI LA PLATEFORME NI LA RLS : la fiche de la plateforme branche ses gestes
// sur `plateforme_inviter` et `plateforme_retirer_attente`, l'écran des réglages sur `inscrire_attente` et
// `workspace_invitations`. Les libellés restent sous `platform.attentes.*` (§5.61).

import { MailMinus, MailPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { RoleEspace } from '../lib/plateforme'
import { formaterDate, libelleRole } from './presentation-plateforme'
import {
	BlocMessage,
	CLASSES_CELLULE,
	CLASSES_CHAMP,
	CLASSES_COMMANDES,
	CLASSES_DATE,
	CLASSES_ENTETE,
	Champ,
	SelectRole,
	useRetourFocus,
	type Message,
} from './TableauMembres'

/** Une ligne du bloc. `enSuspens` est calculé par l'écran, qui sait combien l'espace a d'administrateurs membres. */
export type AttenteTableau = {
	readonly email: string
	/** `null` pour un rôle que la plateforme ne sait pas lire ; la cellule reste alors vide. */
	readonly role: RoleEspace | null
	readonly invitePar: string | null
	readonly depuis: string
	readonly enSuspens: boolean
}

/** L'issue d'une inscription : le message à afficher sous le tableau, ou le refus à dire dans le formulaire. */
export type IssueFormulaire = { readonly ok: true; readonly message: Message } | { readonly ok: false; readonly refus: string }

export type ProprietesBlocAttentes = {
	readonly attentes: readonly AttenteTableau[]
	/** Le niveau du titre de section : `h2` sur la fiche de la plateforme, `h3` sous le titre « Membres » des réglages. */
	readonly niveauTitre: 'h2' | 'h3'
	/** Le rôle proposé par le formulaire : administrateur pour un espace qui n'en a pas, lecteur sinon. */
	readonly roleParDefaut: RoleEspace
	/** Le formulaire est ouvert : le seul bloc ouvert de l'écran (§5.28). */
	readonly ouvert: boolean
	readonly onOuvrir: () => void
	readonly onFermer: () => void
	readonly message: Message
	readonly onMessage: (message: Message) => void
	readonly inscrire: (email: string, role: RoleEspace) => Promise<IssueFormulaire>
	readonly retirer: (attente: AttenteTableau) => Promise<Message>
}

export function BlocAttentes({
	attentes,
	niveauTitre,
	roleParDefaut,
	ouvert,
	onOuvrir,
	onFermer,
	message,
	onMessage,
	inscrire,
	retirer,
}: ProprietesBlocAttentes) {
	const focus = useRetourFocus(ouvert)
	const [enVol, setEnVol] = useState<string | null>(null)
	const Titre = niveauTitre

	// Retirer une attente n'a pas de confirmation : rien n'est détruit qu'un formulaire de deux champs ne repose
	// (§5.41, §5.56).
	const retirerAttente = async (attente: AttenteTableau) => {
		setEnVol(attente.email)
		const suivant = await retirer(attente)
		setEnVol(null)
		onMessage(suivant)
	}

	return (
		<section aria-labelledby="titre-attentes" className="flex flex-col gap-4">
			<Titre id="titre-attentes" className="text-h3">
				{t('platform.attentes.titre')}
			</Titre>
			{attentes.length === 0 ? (
				<p className="text-text-2" data-testid="attentes-vide">
					{t('platform.attentes.vide')}
				</p>
			) : (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-attentes" className="w-full border-collapse">
						<caption className="sr-only">{t('platform.attentes.titre')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.adresse')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.role')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.attentes.colonne.invitePar')}</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.colonne.depuis')}</th>
								<th scope="col" className={CLASSES_ENTETE}>{t('platform.colonne.commandes')}</th>
							</tr>
						</thead>
						<tbody>
							{attentes.map((attente) => (
								<tr key={attente.email} data-testid="ligne-attente" data-email={attente.email} className="border-b border-border hover:bg-hover">
									<td className={CLASSES_CELLULE} title={attente.email}>
										<code>{attente.email}</code>
									</td>
									<td className={`${CLASSES_CELLULE} max-w-none`}>
										<span className="inline-flex items-center gap-2">
											{libelleRole(attente.role)}
											{attente.enSuspens && (
												<span aria-label={t('platform.attentes.enSuspens.aria')} role="img">
													<Badge ton="accent">{t('platform.attentes.enSuspens')}</Badge>
												</span>
											)}
										</span>
									</td>
									<td className={CLASSES_CELLULE}>{attente.invitePar ?? t('platform.auteurInconnu')}</td>
									<td className={CLASSES_DATE}>{formaterDate(attente.depuis)}</td>
									<td className={CLASSES_COMMANDES}>
										<Button
											variante="discret"
											taille="compacte"
											disabled={enVol === attente.email}
											onClick={() => void retirerAttente(attente)}
											aria-label={t('platform.attentes.retirer.aria', { email: attente.email })}
										>
											<MailMinus aria-hidden="true" size={16} />
											{enVol === attente.email ? t('platform.envoi') : t('platform.attentes.retirer')}
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<BlocMessage message={message} testId="message-attentes" />
			{ouvert ? (
				<FormulaireAttente
					roleParDefaut={roleParDefaut}
					inscrire={inscrire}
					onFermer={() => {
						focus.demander()
						onFermer()
					}}
					onInscrite={(suivant) => {
						onFermer()
						onMessage(suivant)
					}}
				/>
			) : (
				<div>
					<Button ref={focus.commande} onClick={onOuvrir} data-testid="inscrire-attente">
						<MailPlus aria-hidden="true" size={18} />
						{t('platform.attentes.inscrire')}
					</Button>
				</div>
			)}
		</section>
	)
}

function FormulaireAttente({
	roleParDefaut,
	inscrire,
	onFermer,
	onInscrite,
}: {
	readonly roleParDefaut: RoleEspace
	readonly inscrire: (email: string, role: RoleEspace) => Promise<IssueFormulaire>
	readonly onFermer: () => void
	readonly onInscrite: (message: Message) => void
}) {
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<RoleEspace>(roleParDefaut)
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const premier = useRef<HTMLInputElement>(null)
	useEffect(() => premier.current?.focus(), [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await inscrire(email, role)
		setEnvoi(false)
		if (issue.ok) onInscrite(issue.message)
		else setRefus(issue.refus)
	}

	return (
		<form
			onSubmit={(e) => void soumettre(e)}
			onKeyDown={(e) => e.key === 'Escape' && onFermer()}
			aria-label={t('platform.attentes.inscrire')}
			data-testid="formulaire-attente"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<Champ id="attente-email" libelle={t('platform.attentes.colonne.adresse')} aide={t('platform.attentes.aide')}>
				<input
					ref={premier}
					id="attente-email"
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					aria-describedby="attente-email-aide"
					className={`${CLASSES_CHAMP} font-mono`}
				/>
			</Champ>
			<Champ id="attente-role" libelle={t('platform.attentes.colonne.role')}>
				<SelectRole id="attente-role" valeur={role} onChange={setRole} />
			</Champ>
			{refus !== null && (
				<p role="alert" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{refus}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi || email.trim() === ''}>
					{envoi ? t('platform.envoi') : t('platform.attentes.inscrire.confirmer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}
