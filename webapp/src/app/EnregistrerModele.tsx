// @spec CRM-068 (docs/BACKLOG.md) — tranche T4b1 : « Enregistrer comme modèle », sur la fiche d'une affaire
// @spec docs/SPEC-checklists.md §3.6 (`save_card_as_template` : réservé à l'administrateur, reprend titre, description,
//       montant, réponses et libellés des points, sans les cochages) ; docs/DESIGN_SYSTEM.md §5.71, §5.59 (la capacité
//       d'administrer l'espace ; écart borné de « Nouveau channel » : le motif porté par la commande), §5.3 quater
//       (panneau dans le flux sous l'en-tête, `Échap` referme), §9 (`CopyPlus`)
//
// LA COMMANDE ET LE PANNEAU VIVENT EN DEUX PLACES de l'en-tête — la commande dans la rangée de « Mettre en sommeil », le
// panneau sous elle —, et l'état qui les relie appartient donc à l'en-tête (`EnTeteCard.tsx`), comme son édition.

import { CopyPlus, TriangleAlert } from 'lucide-react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { proprietesCommande } from '../lib/capacites'
import { enregistrerCommeModele, type NatureRefusEnregistrement } from '../lib/modeles-affaires'
import type { ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'

const CLE_COMMANDE: CleTraduction = 'card.template.save.open'

/**
 * La commande, secondaire compacte (§5.71). Elle suit la capacité d'ADMINISTRER L'ESPACE, et non celle d'écrire sur
 * l'affaire : un modèle est un objet de l'espace. Refusée, elle reste montée et lisible, et porte elle-même son motif
 * — un bandeau dans l'en-tête de chaque fiche, pour une seule commande, serait du bruit (§5.59, écart de « Nouveau
 * channel »).
 */
export const CommandeEnregistrerModele = forwardRef<HTMLButtonElement, { readonly onOuvrir: () => void }>(
	function CommandeEnregistrerModele({ onOuvrir }, ref) {
		const { capacites } = useContexteEspace()
		const idMotif = useId()
		const droit = proprietesCommande(capacites.administration, idMotif)
		const refusee = capacites.administration === 'refusee'
		return (
			<>
				<Button {...droit}
					ref={ref}
					taille="compacte"
					variante="secondaire"
					aria-expanded={false}
					data-testid="entete-card-enregistrer-modele"
					{...(refusee ? { title: t('card.template.save.readonly') } : {})}
					onClick={onOuvrir}
				>
					<CopyPlus aria-hidden="true" size={16} strokeWidth={2} />
					{t(CLE_COMMANDE)}
				</Button>
				{refusee ? (
					<span id={idMotif} className="sr-only">
						{t('card.template.save.readonly')}
					</span>
				) : null}
			</>
		)
	},
)

const CLES_REFUS: Readonly<Record<NatureRefusEnregistrement, CleTraduction>> = {
	reserve: 'card.template.save.refus.reserve',
	'nom-pris': 'card.template.save.refus.nom',
	forme: 'card.template.save.refus.forme',
	introuvable: 'card.template.save.refus.introuvable',
	network: 'card.template.save.refus.panne',
	unknown: 'card.template.save.refus.panne',
}

/**
 * Le panneau, dans le flux sous l'en-tête (§5.3 quater) : « Nom du modèle », prérempli du titre, ce qui est repris, puis
 * « Enregistrer » et « Annuler ». Le succès s'annonce et nomme le modèle ; le panneau reste ouvert pour le dire, et
 * « Fermer » remplace alors « Annuler ».
 */
export function PanneauEnregistrerModele({
	client,
	idRattachement,
	titreAffaire,
	onFermer,
}: {
	readonly client: ClientCrm
	readonly idRattachement: string | null
	readonly titreAffaire: string
	readonly onFermer: () => void
}) {
	const idChamp = useId()
	const idRefus = useId()
	const [nom, setNom] = useState(titreAffaire)
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusEnregistrement | null>(null)
	const [enregistre, setEnregistre] = useState<string | null>(null)
	const champ = useRef<HTMLInputElement | null>(null)
	const blanc = nom.trim() === ''

	// LE FOCUS ENTRE DANS LE CHAMP, son texte sélectionné (§5.13) : le titre prérempli se garde ou se remplace d'un geste.
	// `select()` seul ne déplace pas le focus — trouvé par la preuve unitaire.
	useEffect(() => {
		champ.current?.focus()
		champ.current?.select()
	}, [])

	const envoyer = async () => {
		if (blanc || enCours) return
		setRefus(null)
		setEnregistre(null)
		setEnCours(true)
		const issue =
			idRattachement === null
				? ({ statut: 'refus', nature: 'introuvable' } as const)
				: await enregistrerCommeModele(client, idRattachement, nom.trim())
		setEnCours(false)
		if (issue.statut === 'applique') {
			setEnregistre(nom.trim())
			return
		}
		// LA SAISIE EST CONSERVÉE (§5.7 ter), le focus rendu au champ pour la corriger.
		setRefus(issue.nature)
		champ.current?.focus()
	}

	const fermer = () => {
		if (enCours) return
		onFermer()
	}

	return (
		<form
			data-testid="entete-card-panneau-modele"
			aria-label={t('card.template.save.aria')}
			className="flex flex-col gap-2 rounded-lg border border-border p-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				evenement.stopPropagation()
				fermer()
			}}
		>
			<div className="flex flex-col gap-1">
				<label htmlFor={idChamp} className="text-sm text-text-2">
					{t('card.template.save.name')}
				</label>
				<input
					id={idChamp}
					ref={champ}
					data-testid="entete-card-nom-modele"
					type="text"
					autoComplete="off"
					maxLength={120}
					value={nom}
					onChange={(evenement) => setNom(evenement.target.value)}
					{...(refus === null ? {} : { 'aria-describedby': idRefus })}
					className="min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base"
				/>
			</div>
			<p className="text-sm text-text-2 max-w-[72ch]">{t('card.template.save.hint')}</p>
			{refus === null ? null : (
				<p
					id={idRefus}
					role="alert"
					data-testid="entete-card-refus-modele"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{t(CLES_REFUS[refus])}</span>
				</p>
			)}
			<p role="status" data-testid="entete-card-modele-enregistre" className="text-sm">
				{enregistre === null ? '' : t('card.template.save.done', { nom: enregistre })}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button variante="primaire" type="submit" disabled={blanc || enCours} data-testid="entete-card-modele-enregistrer">
					{t(enCours ? 'card.template.save.pending' : 'card.template.save.submit')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="entete-card-modele-annuler" onClick={fermer}>
					{t(enregistre === null ? 'card.template.save.cancel' : 'card.template.save.close')}
				</Button>
			</div>
		</form>
	)
}
