// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : le tableau des membres de la fiche d'un espace, extrait de
//       `PlateformeEspace.tsx` sans changer son rendu ; docs/SPEC-plateforme.md §7.3, §7.5
// @spec CRM-070 (docs/BACKLOG.md) — tranche T2 : le même tableau sert Réglages ▸ Membres ; docs/SPEC-membres.md §3.1
//       (rôle, retrait confirmé, soi-même), §4 (un composant partagé, deux couches d'accès distinctes)
// @spec docs/DESIGN_SYSTEM.md §5.9 (tableaux), §5.27 (confirmation sur une ligne à elle, message sous le tableau),
//       §5.40 (commande montée et désactivée), §5.7 ter (le rôle écrit au choix), §5.59 (commandes éteintes avec motif),
//       §5.61 (le tableau partagé)
// @spec CLAUDE.md §10 — le tableau ne décide aucun droit : ses deux gestes sont fournis par l'écran, qui parle à la base
//
// LE TABLEAU NE CONNAÎT NI LA PLATEFORME NI LA RLS. L'écran lui passe deux gestes, `changerRole` et `retirer`, qui
// rendent chacun le message à afficher ; la fiche de la plateforme les branche sur les fonctions `plateforme_*`,
// l'écran des réglages sur `workspace_members`. Les libellés restent sous `platform.membres.*` : leur réemploi est dit
// au design system (§5.61), non dupliqué.

import { UserMinus } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { ProprietesCommande } from '../lib/capacites'
import { ROLES_ESPACE, type RoleEspace } from '../lib/plateforme'
import { formaterDate, libelleRole } from './presentation-plateforme'

export const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
export const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
export const CLASSES_DATE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'
export const CLASSES_COMMANDES = 'h-[var(--size-target)] px-3 whitespace-nowrap'
export const CLASSES_CHAMP =
	'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'

/** Un message de bloc : une issue lue sous le tableau, `status` ou `alert` (§5.27). */
export type Message = { readonly ton: 'succes' | 'refus'; readonly texte: string } | null

/** Une ligne du tableau. `superadmin` n'est lu que si la colonne est demandée. */
export type MembreTableau = {
	readonly idUtilisateur: string
	readonly nom: string
	readonly role: RoleEspace
	readonly depuis: string
	readonly superadmin?: boolean
}

export function BlocMessage({ message, testId }: { readonly message: Message; readonly testId: string }) {
	if (message === null) return null
	return message.ton === 'succes' ? (
		<p role="status" data-testid={testId} className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm">
			{message.texte}
		</p>
	) : (
		<p role="alert" data-testid={testId} className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
			{message.texte}
		</p>
	)
}

export function SelectRole({
	id,
	valeur,
	onChange,
	libelle,
	commande,
}: {
	readonly id: string
	readonly valeur: RoleEspace
	readonly onChange: (role: RoleEspace) => void
	readonly libelle?: string
	/** Éteint par une capacité refusée, et citant alors son motif (§5.59). */
	readonly commande?: ProprietesCommande
}) {
	return (
		<select
			id={id}
			value={valeur}
			aria-label={libelle}
			onChange={(e) => onChange(e.target.value as RoleEspace)}
			className={CLASSES_CHAMP}
			{...commande}
		>
			{ROLES_ESPACE.map((role) => (
				<option key={role} value={role}>
					{libelleRole(role)}
				</option>
			))}
		</select>
	)
}

/** Aucune capacité fournie : rien n'est éteint. */
const SANS_CAPACITE: ProprietesCommande = {}

export type ProprietesTableauMembres = {
	readonly membres: readonly MembreTableau[]
	/** Le nom de l'espace, cité par la confirmation de retrait. */
	readonly nomEspace: string
	/** La colonne « Superadministrateur » : la plateforme seule la montre. */
	readonly colonneSuperadmin: boolean
	/** Le membre dont la confirmation de retrait est ouverte : le seul bloc ouvert de l'écran (§5.28). */
	readonly idConfirmation: string | null
	readonly onDemanderRetrait: (membre: MembreTableau) => void
	/** Ferme la confirmation : à l'annulation, et après le retrait, quelle qu'en soit l'issue. */
	readonly onFermer: () => void
	readonly changerRole: (membre: MembreTableau, role: RoleEspace) => Promise<Message>
	readonly retirer: (membre: MembreTableau) => Promise<Message>
	readonly onMessage: (message: Message) => void
	/** La conséquence dite par la confirmation ; par défaut, celle de la plateforme. */
	readonly consequence?: (membre: MembreTableau) => string
	/** Les commandes de chaque ligne, éteintes par une capacité refusée (§5.59) ; absent, rien n'est éteint. */
	readonly commande?: ProprietesCommande
}

export function TableauMembres({
	membres,
	nomEspace,
	colonneSuperadmin,
	idConfirmation,
	onDemanderRetrait,
	onFermer,
	changerRole,
	retirer,
	onMessage,
	consequence = () => t('platform.membres.confirmation.consequence'),
	commande = SANS_CAPACITE,
}: ProprietesTableauMembres) {
	const [roleEnVol, setRoleEnVol] = useState<Readonly<Record<string, RoleEspace>>>({})

	const choisirRole = async (membre: MembreTableau, role: RoleEspace) => {
		setRoleEnVol((precedent) => ({ ...precedent, [membre.idUtilisateur]: role }))
		const message = await changerRole(membre, role)
		setRoleEnVol((precedent) => {
			const suivant = { ...precedent }
			delete suivant[membre.idUtilisateur]
			return suivant
		})
		onMessage(message)
	}

	const colonnes = colonneSuperadmin ? 5 : 4
	return (
		<div className="overflow-x-auto indique-debordement-x">
			<table data-testid="tableau-membres" className="w-full border-collapse">
				<caption className="sr-only">{t('platform.membres.titre')}</caption>
				<thead>
					<tr className="border-b border-border">
						<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.nom')}</th>
						<th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.role')}</th>
						{colonneSuperadmin && <th scope="col" className={CLASSES_ENTETE}>{t('platform.membres.colonne.superadmin')}</th>}
						<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.colonne.depuis')}</th>
						<th scope="col" className={CLASSES_ENTETE}>{t('platform.colonne.commandes')}</th>
					</tr>
				</thead>
				<tbody>
					{membres.map((membre) => (
						<LigneMembre
							key={membre.idUtilisateur}
							membre={membre}
							nomEspace={nomEspace}
							colonneSuperadmin={colonneSuperadmin}
							colonnes={colonnes}
							role={roleEnVol[membre.idUtilisateur] ?? membre.role}
							confirmation={idConfirmation === membre.idUtilisateur}
							consequence={consequence(membre)}
							commande={commande}
							onChangerRole={(role) => void choisirRole(membre, role)}
							onRetirer={() => onDemanderRetrait(membre)}
							onAnnuler={onFermer}
							retirer={async () => {
								const message = await retirer(membre)
								onFermer()
								onMessage(message)
							}}
						/>
					))}
				</tbody>
			</table>
		</div>
	)
}

function LigneMembre({
	membre,
	nomEspace,
	colonneSuperadmin,
	colonnes,
	role,
	confirmation,
	consequence,
	commande,
	onChangerRole,
	onRetirer,
	onAnnuler,
	retirer,
}: {
	readonly membre: MembreTableau
	readonly nomEspace: string
	readonly colonneSuperadmin: boolean
	readonly colonnes: number
	readonly role: RoleEspace
	readonly confirmation: boolean
	readonly consequence: string
	readonly commande: ProprietesCommande
	readonly onChangerRole: (role: RoleEspace) => void
	readonly onRetirer: () => void
	readonly onAnnuler: () => void
	readonly retirer: () => Promise<void>
}) {
	const bouton = useRef<HTMLButtonElement>(null)
	const [envoi, setEnvoi] = useState(false)
	// La commande reste montée mais DÉSACTIVÉE pendant sa confirmation, et un bouton désactivé refuse le focus : il lui
	// est rendu un tour de rendu plus tard, une fois réactivé — un drapeau, puis un effet (§5.29 tranche 2 b-2 c).
	const rendreFocus = useRef(false)
	useEffect(() => {
		if (!confirmation && rendreFocus.current) {
			rendreFocus.current = false
			bouton.current?.focus()
		}
	}, [confirmation])
	const annuler = () => {
		rendreFocus.current = true
		onAnnuler()
	}
	const confirmer = async () => {
		setEnvoi(true)
		await retirer()
		setEnvoi(false)
	}
	return (
		<Fragment>
			<tr data-testid="ligne-membre" data-membre={membre.idUtilisateur} className="border-b border-border hover:bg-hover">
				<td className={CLASSES_CELLULE} title={membre.nom}>{membre.nom}</td>
				<td className={CLASSES_CELLULE}>
					<SelectRole
						id={`role-${membre.idUtilisateur}`}
						valeur={role}
						libelle={t('platform.membres.role.aria', { nom: membre.nom })}
						onChange={onChangerRole}
						commande={commande}
					/>
				</td>
				{colonneSuperadmin && (
					<td className={CLASSES_CELLULE}>{membre.superadmin === true && <Badge ton="brand">{t('platform.membres.superadmin')}</Badge>}</td>
				)}
				<td className={CLASSES_DATE}>{formaterDate(membre.depuis)}</td>
				<td className={CLASSES_COMMANDES}>
					{/* La commande reste montée, désactivée pendant sa confirmation : le focus lui revient sans attente (§5.27). */}
					<Button
						ref={bouton}
						variante="discret"
						taille="compacte"
						{...commande}
						disabled={commande.disabled === true || confirmation}
						onClick={onRetirer}
						aria-label={t('platform.membres.retirer.aria', { nom: membre.nom })}
					>
						<UserMinus aria-hidden="true" size={16} />
						{t('platform.membres.retirer')}
					</Button>
				</td>
			</tr>
			{confirmation && (
				<tr>
					<td colSpan={colonnes} className="p-0">
						<div
							role="group"
							aria-labelledby={`confirmation-membre-${membre.idUtilisateur}`}
							onKeyDown={(e) => {
								if (e.key === 'Escape') annuler()
							}}
							className="sticky left-0 max-w-[calc(100vw-32px)] flex flex-col gap-3 bg-surface border-b border-border p-4"
						>
							<p id={`confirmation-membre-${membre.idUtilisateur}`} className="font-medium">
								{t('platform.membres.confirmation', { nom: membre.nom, espace: nomEspace })}
							</p>
							<p className="text-sm text-text-2">{consequence}</p>
							<div className="flex flex-wrap gap-2">
								<Button variante="destructif" disabled={envoi} onClick={() => void confirmer()} autoFocus>
									{envoi ? t('platform.envoi') : t('platform.membres.retirer.confirmer')}
								</Button>
								<Button onClick={annuler}>{t('platform.annuler')}</Button>
							</div>
						</div>
					</td>
				</tr>
			)}
		</Fragment>
	)
}
