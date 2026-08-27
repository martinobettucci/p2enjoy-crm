// @spec CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences
// @spec docs/SPEC-notifications.md §42.1 (il n'y a qu'un canal), §43.4 (l'absence de ligne vaut
//       consentement), §44 (le filtrage est à la lecture, donc l'écran ne filtre rien),
//       §46.3 (la RPC, unique chemin d'écriture, et l'état qu'elle rend)
// @spec docs/DESIGN_SYSTEM.md §5.45 (cette surface), §5.7 ter (l'écriture immédiate et ses six
//       règles), §5.8 (états systématiques), §5.13 (étiquettes et focus)
//
// UN ÉCRAN QUI LIT ET QUI ÉCRIT, ET QUI NE DÉCIDE RIEN DE CE QUI EST REÇU. La préférence agit en
// base, dans la troisième condition de `notifications_lecture` (§45.2) ; cet écran ne masque
// aucune notification et n'en compte aucune. Il pose une décision et rend celle que la base a
// retenue.
//
// IL N'EST PAS RÉSERVÉ À L'ADMINISTRATRICE, et c'est le premier de `/reglages` dans ce cas
// (§5.45). Aucun rôle n'est lu ici : la politique `notification_preferences_lecture` rend à
// chacun sa propre ligne, et la RPC écrit celle de son appelant — il n'y a rien à filtrer.

import { useCallback, useEffect, useState } from 'react'
import { EtatErreur } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	ecrirePreferenceNotification,
	lirePreferencesNotifications,
	type NatureRefusPreference,
	type PreferenceNotification,
	type TypePreference,
} from '../lib/preferences-notifications'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/**
 * Le libellé et l'explication de chaque type.
 *
 * **LE LIBELLÉ DIT CE QU'ON REÇOIT, JAMAIS CE QU'ON COUPE** (§5.45). Une case « Couper les
 * mentions » demanderait de cocher pour obtenir moins : la double négation est la faute de
 * lisibilité que le §10 du design system interdit.
 */
const LIBELLES: Readonly<
	Record<TypePreference, { readonly titre: CleTraduction; readonly corps: CleTraduction }>
> = {
	mention: {
		titre: 'settings.notifications.type.mention',
		corps: 'settings.notifications.type.mention.body',
	},
}

/**
 * Le dictionnaire FERMÉ des refus d'écriture — aucune phrase du serveur n'atteint l'écran.
 *
 * `type-inconnu` ET `sans-session` NE DEMANDENT PAS LE MÊME GESTE : la première signale une
 * application en avance sur sa base, la seconde une session à rouvrir. Les confondre rendrait un
 * message faux, ce que `CLAUDE.md` §18 proscrit.
 */
const REFUS: Readonly<Record<NatureRefusPreference, CleTraduction>> = {
	'type-inconnu': 'settings.notifications.refusal.unknownType',
	'sans-session': 'settings.notifications.refusal.session',
	'valeur-absente': 'settings.notifications.refusal.unknown',
	forbidden: 'settings.notifications.refusal.forbidden',
	network: 'settings.notifications.refusal.network',
	unknown: 'settings.notifications.refusal.unknown',
}

/** Ce que l'écran sait d'une case en cours d'écriture, ou dont l'écriture a échoué. */
type EtatEcriture =
	| { readonly phase: 'repos' }
	| { readonly phase: 'envoi' }
	| { readonly phase: 'refus'; readonly cle: CleTraduction }

/**
 * Le client est INJECTABLE, comme dans `Corbeille` et `EtatMessagerie` : c'est ce qui rend l'écran
 * éprouvable sans pile. `clientCrm` peut être `null` quand la configuration manque — l'écran rend
 * alors son état d'erreur plutôt qu'une page blanche.
 */
export type ProprietesReglagesNotifications = {
	readonly client?: ClientCrm | null
}

export function ReglagesNotifications({
	client = clientCrm,
}: ProprietesReglagesNotifications = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly PreferenceNotification[]>>(enChargement())
	const [ecritures, setEcritures] = useState<Readonly<Record<string, EtatEcriture>>>({})
	const [annonce, setAnnonce] = useState('')

	const recharger = useCallback(() => {
		let vivant = true
		setEtat(enChargement())
		if (client === null) {
			// SANS CONFIGURATION, L'ÉCRAN NOMME LE PROBLÈME plutôt que de rester en chargement
			// perpétuel — le §5.8 refuse la page blanche autant que le sablier sans fin.
			setEtat(enErreur(classerErreur(undefined, 'client_absent')))
			return () => {
				vivant = false
			}
		}
		void lirePreferencesNotifications(client).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client])

	useEffect(() => recharger(), [recharger])

	/**
	 * Bascule une case.
	 *
	 * **LA CASE NE SE COCHE QU'APRÈS LA RÉPONSE** (§5.45) : l'état local n'est touché qu'avec la
	 * ligne que la RPC rend. Une bascule optimiste puis annulée par un refus afficherait un état
	 * que l'utilisateur a vu et qui n'a jamais existé.
	 *
	 * **LA CASE N'EST JAMAIS DÉSACTIVÉE PENDANT L'ENVOI** (§5.7 ter) : un contrôle désactivé perd
	 * le focus du clavier. C'est la mention sous la case qui dit l'envoi, pas l'inertie du
	 * contrôle.
	 */
	const basculer = useCallback(
		async (type: TypePreference, valeurDemandee: boolean) => {
			if (client === null) return
			setEcritures((precedent) => ({ ...precedent, [type]: { phase: 'envoi' } }))
			setAnnonce(t('settings.notifications.saving'))

			const issue = await ecrirePreferenceNotification(client, type, valeurDemandee)

			if (issue.statut === 'refus') {
				const cle = REFUS[issue.nature]
				setEcritures((precedent) => ({ ...precedent, [type]: { phase: 'refus', cle } }))
				setAnnonce(t(cle))
				return
			}

			setEtat((precedent) =>
				precedent.statut === 'pret'
					? pret(
							precedent.donnees.map((preference) =>
								preference.type === type ? issue.preference : preference,
							),
						)
					: precedent,
			)
			setEcritures((precedent) => ({ ...precedent, [type]: { phase: 'repos' } }))
			setAnnonce(
				issue.preference.recevoirDansApplication
					? t('settings.notifications.saved.on')
					: t('settings.notifications.saved.off'),
			)
		},
		[client],
	)

	if (etat.statut === 'chargement') {
		return (
			<section className="flex flex-col gap-4 max-w-[70ch]" aria-busy="true">
				<Entete />
				<SkeletonListe lignes={1} libelle={t('settings.notifications.loading')} />
			</section>
		)
	}

	if (etat.statut === 'erreur') {
		return (
			<section className="flex flex-col gap-4 max-w-[70ch]">
				<Entete />
				<EtatErreur
					titre={t('settings.notifications.error.title')}
					corps={t('settings.notifications.error.body')}
					libelleReprise={t('settings.notifications.error.retry')}
					onReprise={() => {
						recharger()
					}}
				/>
			</section>
		)
	}

	return (
		<section className="flex flex-col gap-4 max-w-[70ch]">
			<Entete />
			{/* IL N'Y A PAS D'ÉTAT VIDE (§5.45) : la liste des types est FIXE, elle ne vient pas du
			    serveur. Un `fieldset` porte les cases, sa `legend` les nomme collectivement. */}
			<fieldset className="flex flex-col rounded-lg border border-border bg-surface">
				<legend className="sr-only">{t('settings.notifications.legend')}</legend>
				{etat.donnees.map((preference) => {
					const libelle = LIBELLES[preference.type]
					const ecriture = ecritures[preference.type] ?? { phase: 'repos' }
					const idMention = `pref-${preference.type}-mention`
					return (
						<div key={preference.type} className="flex flex-col gap-1 px-4 py-3">
							<label className="flex items-start gap-3 min-h-[var(--size-target)] cursor-pointer">
								<input
									type="checkbox"
									className="mt-1 size-4 accent-[var(--color-primary)]"
									checked={preference.recevoirDansApplication}
									aria-describedby={ecriture.phase === 'repos' ? undefined : idMention}
									onChange={(evenement) => {
										void basculer(preference.type, evenement.target.checked)
									}}
								/>
								<span className="flex flex-col gap-1">
									<span className="font-medium">{t(libelle.titre)}</span>
									<span className="text-sm text-text-2">{t(libelle.corps)}</span>
								</span>
							</label>
							{/* LA MENTION D'ÉTAT VIT SOUS LA CASE (§5.7 ter), jamais en tête d'écran, et
							    une seule à la fois : deux mentions superposées feraient croire à deux
							    écritures. */}
							{ecriture.phase === 'envoi' ? (
								<p id={idMention} className="text-sm text-text-3 pl-7">
									{t('settings.notifications.saving')}
								</p>
							) : null}
							{ecriture.phase === 'refus' ? (
								<p
									id={idMention}
									className="text-sm text-danger-on-soft bg-danger-soft rounded px-2 py-1 ml-7"
								>
									{t(ecriture.cle)}
								</p>
							) : null}
						</div>
					)
				})}
			</fieldset>
			<LiveRegion libelle={t('settings.notifications.live')} message={annonce} />
		</section>
	)
}

/**
 * L'en-tête, et la phrase qui dit ce que couper fait RÉELLEMENT.
 *
 * ELLE N'EST PAS DÉCORATIVE. Le §44 décide que couper **masque** sans détruire, et le §44.1 que la
 * notification masquée ne peut plus être marquée lue. Un écran qui tairait la première laisserait
 * croire à une suppression ; taire la seconde n'aurait aucune conséquence visible, la ligne
 * n'étant de toute façon pas rendue.
 */
function Entete() {
	return (
		<header className="flex flex-col gap-1">
			<h2 className="text-h3">{t('settings.notifications.title')}</h2>
			<p className="text-sm text-text-2">{t('settings.notifications.intro')}</p>
		</header>
	)
}
