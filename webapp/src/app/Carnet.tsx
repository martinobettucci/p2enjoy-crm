// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a :
//       le carnet de contacts
// @spec docs/SPEC-contacts.md §10.2 (où le carnet s'ancre), §10.5 (de quoi il a l'air),
//       §10.6 (contrat de comportement, cas a à g), §10.7 (limites nommées)
// @spec docs/SPEC-contacts.md §11.6 (le nom d'organisation devient un lien vers sa fiche : la
//       règle du §10.7 change par LIVRAISON, sa condition étant tombée), §11.9 cas i
// @spec docs/DESIGN_SYSTEM.md §5.19 (cette surface, révisé), §5.20 (la fiche, destination du
//       lien), §5.9 (tableau de données),
//       §5.8 (états systématiques), §2 (données techniques), §12.6 (débordement signalé)
//
// UN ÉCRAN QUI LIT, ET RIEN D'AUTRE. La sous-tranche 4a ne livre aucun geste de création, de
// modification ni de suppression : l'écriture est ouverte en base au `business_developer` depuis
// la tranche 1, et aucun écran ne l'exerce encore. L'écart est NOMMÉ au §10.7, non compensé par
// une commande morte.
//
// L'écran ne calcule AUCUN droit (§10.4) : il rend ce que le backend consent. Un appelant sans
// droit reçoit `200` et zéro ligne — mesuré —, ce qui est l'état vide ordinaire du §5.8 et non un
// refus à mettre en scène (docs/SPEC-permissions-rls.md §7).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { lireContactsDuCarnet, type ContactDuCarnet } from '../lib/contacts'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { cheminOrganisation } from './chemins'

/** Cellule ordinaire : une seule ligne de texte en ellipse, hauteur de cible (§5.9). */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[28ch]'

/**
 * Cellule de donnée technique (§2) : monospace et chiffres tabulaires, alignée à droite pour se
 * comparer colonne par colonne — la seule raison d'avoir des chiffres tabulaires (§5.9).
 */
const CLASSES_CELLULE_TECHNIQUE =
	'h-[var(--size-target)] px-3 text-right whitespace-nowrap max-w-[32ch] truncate'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'

export type ProprietesCarnet = {
	readonly client?: ClientCrm | null
}

export function Carnet({ client = clientCrm }: ProprietesCarnet = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly ContactDuCarnet[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par une nouvelle tentative, ne doit pas
	// écraser un état plus récent — même garde que `EtatMessagerie` et `AdministrationArborescence`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const lu = await lireContactsDuCarnet(client)
			if (rang !== courant.current) return
			// La double garde est celle d'`EtatMessagerie` : la fonction de lecture ne rend jamais
			// `chargement`, mais le type `EtatAsync` le porte structurellement, et seule cette
			// forme le nomme au lieu de le nier.
			if (lu.statut === 'erreur') {
				setEtat(enErreur(lu.erreur))
				return
			}
			if (lu.statut !== 'pret') return
			setEtat(pret(lu.donnees))
		})()
	}, [client, tentative])

	const reprendre = useCallback(() => setTentative((precedente) => precedente + 1), [])

	if (client === null) {
		return <EtatVide titre={t('contacts.noWorkspace.title')} corps={t('contacts.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('contacts.error.title')}
				corps={t('contacts.error.body')}
				libelleReprise={t('contacts.error.retry')}
				onReprise={reprendre}
			/>
		)
	}

	const contacts = etat.donnees

	// L'état vide n'offre AUCUNE action, et c'est l'écart assumé au §5.8 — celui que le §5.16 a
	// déjà pris pour la corbeille : le carnet ne livre aucun geste de création (§10.7), et un
	// bouton vers nulle part serait une commande morte.
	if (contacts.length === 0) {
		return <EtatVide titre={t('contacts.empty.title')} corps={t('contacts.empty.body')} />
	}

	return (
		<section aria-label={t('contacts.aria')} className="flex flex-col gap-4">
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-contacts" className="w-full border-collapse text-left">
					<caption className="sr-only">{t('contacts.table.aria')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>
								{t('contacts.table.name')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('contacts.table.organization')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('contacts.table.role')}
							</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('contacts.table.email')}
							</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('contacts.table.phone')}
							</th>
						</tr>
					</thead>
					<tbody>
						{contacts.map((contact) => (
							<tr
								key={contact.id}
								data-testid="ligne-contact"
								data-contact={contact.id}
								className="border-b border-border hover:bg-hover"
							>
								<td className={CLASSES_CELLULE} title={contact.full_name}>
									{contact.full_name}
								</td>
								{/*
								  LE NOM DE L'ORGANISATION EST UN LIEN VERS SA FICHE — §11.6, révision
								  du 2026-08-18. Il était un TEXTE tant que la fiche n'existait pas :
								  un lien sans destination aurait été mort (§10.7, §5.10). La
								  sous-tranche 4b livre cette destination, et la règle change donc par
								  LIVRAISON, non par contournement.

								  Une cellule sans organisation reste VIDE et SANS LIEN — ni tiret, ni
								  « non renseigné » (§5.9) : un lien n'apparaît que là où il a une
								  destination.

								  AUCUN `aria-label` sur le lien, et c'est délibéré : il remplacerait
								  le nom de l'organisation par un libellé identique sur chaque ligne,
								  rendant les liens indistinguables pour un lecteur d'écran (§8). Le
								  nom EST le libellé du lien.
								*/}
								<td
									className={CLASSES_CELLULE}
									title={contact.organisation === null ? undefined : contact.organisation.name}
								>
									{contact.organisation === null ? (
										''
									) : (
										<Link
											to={cheminOrganisation(contact.organisation.id)}
											data-testid="lien-organisation"
											className="inline-flex items-center min-h-[var(--size-target)] text-brand hover:underline"
										>
											{contact.organisation.name}
										</Link>
									)}
								</td>
								<td
									className={CLASSES_CELLULE}
									title={contact.role_title === null ? undefined : contact.role_title}
								>
									{contact.role_title ?? ''}
								</td>
								<td className={CLASSES_CELLULE_TECHNIQUE}>
									{contact.email === null ? '' : <code className="text-text-2">{contact.email}</code>}
								</td>
								<td className={CLASSES_CELLULE_TECHNIQUE}>
									{contact.phone === null ? '' : <code className="text-text-2">{contact.phone}</code>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}
