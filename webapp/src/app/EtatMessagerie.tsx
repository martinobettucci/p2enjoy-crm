// @spec CRM-059 (docs/BACKLOG.md) — écran d'état de la messagerie
// @spec docs/SPEC-mail-subsystem.md §20.7 (les faits montrés), §20.11 (l'écran, ce qu'il lit et ne
//       fait pas)
// @spec docs/DESIGN_SYSTEM.md §5.14 (cette surface), §5.8 (états systématiques), §5.9 (tableau)
//
// UN ÉCRAN QUI LIT, ET RIEN D'AUTRE (§20.11.7). Aucune écriture, aucune action, aucun flux temps
// réel : la donnée est lue à l'ouverture, comme `AdministrationArborescence` lit la sienne.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	estCodeIncidentConnu,
	lireComptesMailEtat,
	lireCompteursFileSortante,
	type CodeIncidentMail,
	type CompteMailEtat,
	type CompteursFileSortante,
} from '../lib/mail-etat'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/** Le dictionnaire fermé du §20.11.4 : un code d'API n'est jamais affiché brut. */
const CLES_INCIDENT: Readonly<Record<CodeIncidentMail, CleTraduction>> = {
	auth_failed: 'admin.mail.incident.auth_failed',
	host_unreachable: 'admin.mail.incident.host_unreachable',
	connection_refused: 'admin.mail.incident.connection_refused',
	tls_failed: 'admin.mail.incident.tls_failed',
	timeout: 'admin.mail.incident.timeout',
	protocol_error: 'admin.mail.incident.protocol_error',
}

/**
 * Le texte de la colonne « Dernier incident », ou vide si `status <> 'error'` (§20.11.3).
 *
 * Un code inconnu du dictionnaire — impossible sous la contrainte `mail_inbound_accounts_erreur_code`
 * de la migration `0022`, mais l'écran ne suppose pas la base infaillible — reste **vide** plutôt
 * que d'afficher le code brut : celui-ci n'est pas un texte pour un humain.
 */
function texteIncident(compte: CompteMailEtat): string {
	if (compte.status !== 'error' || compte.last_error === null) return ''
	if (!estCodeIncidentConnu(compte.last_error)) return ''
	return t(CLES_INCIDENT[compte.last_error])
}

/** Date/heure locale courte, comme les échéances de la vue liste (`ListeCards.tsx`). */
function formaterRelève(horodatage: string): string {
	const date = new Date(horodatage)
	if (Number.isNaN(date.getTime())) return horodatage
	return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_CELLULE_TECHNIQUE = 'h-[var(--size-target)] px-3 text-right whitespace-nowrap'

type Donnees = {
	readonly comptes: readonly CompteMailEtat[]
	readonly compteurs: CompteursFileSortante
}

export type ProprietesEtatMessagerie = {
	readonly client?: ClientCrm | null
}

export function EtatMessagerie({ client = clientCrm }: ProprietesEtatMessagerie = {}) {
	const [etat, setEtat] = useState<EtatAsync<Donnees>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par une nouvelle tentative, ne doit pas
	// écraser un état plus récent — même garde que `AdministrationArborescence`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const [comptes, compteurs] = await Promise.all([
				lireComptesMailEtat(client),
				lireCompteursFileSortante(client),
			])
			if (rang !== courant.current) return
			// Le cas est traité par `statut === 'erreur'` puis `statut !== 'pret'`, jamais par la
			// seule négation : les fonctions de lecture ne rendent jamais `chargement`, mais le
			// type `EtatAsync` le porte structurellement, et seule cette double garde le nomme
			// (même motif que `AdministrationArborescence.tsx`).
			if (comptes.statut === 'erreur') {
				setEtat(enErreur(comptes.erreur))
				return
			}
			if (comptes.statut !== 'pret') return
			if (compteurs.statut === 'erreur') {
				setEtat(enErreur(compteurs.erreur))
				return
			}
			if (compteurs.statut !== 'pret') return
			setEtat(pret({ comptes: comptes.donnees, compteurs: compteurs.donnees }))
		})()
	}, [client, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	if (client === null) {
		return <EtatVide titre={t('admin.mail.noWorkspace.title')} corps={t('admin.mail.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.mail.error.title')}
				corps={t('admin.mail.error.body')}
				libelleReprise={t('admin.mail.error.retry')}
				onReprise={reprendre}
			/>
		)
	}

	const { comptes, compteurs } = etat.donnees

	// « Aucun compte visible » (§20.11.6) : l'appelant n'a ni compte propre ni droit
	// d'administration. L'écran le dit, il n'invente pas une liste vide qui prétendrait avoir
	// cherché sans rien trouver — c'est un état différent d'une liste réellement vide de résultat
	// de recherche, et il n'offre aucune action puisqu'en créer un compte n'appartient pas à
	// cette unité (§20.11.7).
	if (comptes.length === 0) {
		return <EtatVide titre={t('admin.mail.empty.title')} corps={t('admin.mail.empty.body')} />
	}

	return (
		<section aria-label={t('admin.mail.aria')} className="flex flex-col gap-6">
			<div className="flex flex-wrap gap-6">
				<Compteur libelle={t('admin.mail.counters.queued')} valeur={compteurs.enAttente} />
				<Compteur libelle={t('admin.mail.counters.failed')} valeur={compteurs.echecsDefinitifs} />
			</div>

			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-comptes-mail" className="w-full border-collapse text-left">
					<caption className="sr-only">{t('admin.mail.table.aria')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className="bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3">
								{t('admin.mail.table.label')}
							</th>
							<th
								scope="col"
								className="bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-right"
							>
								{t('admin.mail.table.lastSync')}
							</th>
							<th scope="col" className="bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3">
								{t('admin.mail.table.incident')}
							</th>
						</tr>
					</thead>
					<tbody>
						{comptes.map((compte) => (
							<tr
								key={compte.id}
								data-testid="ligne-compte-mail"
								data-compte={compte.id}
								className="border-b border-border hover:bg-hover"
							>
								<td className={CLASSES_CELLULE} title={compte.label}>
									{compte.label}
								</td>
								<td className={CLASSES_CELLULE_TECHNIQUE}>
									{compte.last_sync_at === null ? (
										<span>{t('admin.mail.table.never')}</span>
									) : (
										<code className="text-text-2">{formaterRelève(compte.last_sync_at)}</code>
									)}
								</td>
								<td className={CLASSES_CELLULE}>{texteIncident(compte)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}

/** Un chiffre et son libellé, sans pilule ni couleur d'alerte (§20.11.5, §5.14). */
function Compteur({ libelle, valeur }: { readonly libelle: string; readonly valeur: number }) {
	return (
		<div data-testid="compteur-mail" className="flex flex-col">
			<span className="text-h1 font-semibold text-ink tabular-nums">{valeur}</span>
			<span className="text-sm text-text-2">{libelle}</span>
		</div>
	)
}
