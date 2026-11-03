// @spec CRM-112 (docs/BACKLOG.md) — tranche T4.b : le panneau des filtres de champ de la vue liste — un `fieldset` par champ,
//       le contrôle selon le type, « Appliquer » et « Fermer », la borne illisible refusée sous son champ
// @spec docs/DESIGN_SYSTEM.md §5.92, §5.7, §5.7 bis, §8 ; docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/JOURNAL.md
//       décision 831
//
// Le panneau ne lit ni n'écrit rien : il compose les paramètres bruts `c.<clé>` et les rend à l'appelant, qui les porte dans
// l'adresse. Rien ne filtre avant « Appliquer ».

import { useId, useState, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import { choixDuChamp } from '../lib/administration-workflows'
import type { ChampCommun } from '../lib/champs-communs'
import { formaterFiltre, interpreterFiltre, lireNombre, sorteDuType, type FiltreCommun } from '../lib/filtres-communs'

/** Ce que l'écran garde d'un champ pendant la saisie, avant « Appliquer ». */
type Brouillon = {
	readonly texte: string
	readonly cles: readonly string[]
	readonly de: string
	readonly a: string
	readonly etat: '' | 'oui' | 'non' | 'vide'
}

const VIDE: Brouillon = { texte: '', cles: [], de: '', a: '', etat: '' }

function brouillonDe(filtre: FiltreCommun | null): Brouillon {
	if (filtre === null) return VIDE
	switch (filtre.sorte) {
		case 'contient':
			return { ...VIDE, texte: filtre.texte }
		case 'choix':
			return { ...VIDE, cles: filtre.cles }
		case 'bornes':
			return { ...VIDE, de: filtre.de === null ? '' : String(filtre.de), a: filtre.a === null ? '' : String(filtre.a) }
		case 'dates':
			return { ...VIDE, de: filtre.du ?? '', a: filtre.au ?? '' }
		case 'case':
			return { ...VIDE, etat: filtre.etat }
	}
}

/** Le filtre qu'un brouillon dit, ou une erreur de borne ; `null` : le champ ne filtre pas. */
function filtreDe(champ: ChampCommun, brouillon: Brouillon): FiltreCommun | null | 'illisible' {
	switch (sorteDuType(champ.type)) {
		case 'contient':
			return brouillon.texte.trim() === '' ? null : { sorte: 'contient', texte: brouillon.texte.trim() }
		case 'choix':
			return brouillon.cles.length === 0 ? null : { sorte: 'choix', cles: brouillon.cles }
		case 'bornes': {
			const de = lireNombre(brouillon.de)
			const a = lireNombre(brouillon.a)
			if (Number.isNaN(de) || Number.isNaN(a)) return 'illisible'
			return de === null && a === null ? null : { sorte: 'bornes', de, a }
		}
		case 'dates':
			return brouillon.de === '' && brouillon.a === '' ? null : { sorte: 'dates', du: brouillon.de || null, au: brouillon.a || null }
		case 'case':
			return brouillon.etat === '' ? null : { sorte: 'case', etat: brouillon.etat }
		default:
			return null
	}
}

export type ProprietesPanneauFiltresCommuns = {
	readonly id: string
	readonly champs: readonly ChampCommun[]
	/** Les paramètres bruts de l'adresse (`ParametresListe.communs`). */
	readonly bruts: Readonly<Record<string, string>>
	readonly onAppliquer: (bruts: Readonly<Record<string, string>>) => void
	readonly onFermer: () => void
}

export function PanneauFiltresCommuns({ id, champs, bruts, onAppliquer, onFermer }: ProprietesPanneauFiltresCommuns) {
	const prefixe = useId()
	const [brouillons, setBrouillons] = useState<Readonly<Record<string, Brouillon>>>(() =>
		Object.fromEntries(champs.map((champ) => [champ.key, brouillonDe(bruts[champ.key] === undefined ? null : interpreterFiltre(champ, bruts[champ.key] ?? ''))])),
	)
	const [illisibles, setIllisibles] = useState<ReadonlySet<string>>(new Set())

	const modifier = (cle: string, changement: Partial<Brouillon>) =>
		setBrouillons((precedents) => ({ ...precedents, [cle]: { ...(precedents[cle] ?? VIDE), ...changement } }))

	const appliquer = () => {
		const sortie: Record<string, string> = {}
		const erreurs = new Set<string>()
		for (const champ of champs) {
			const filtre = filtreDe(champ, brouillons[champ.key] ?? VIDE)
			if (filtre === 'illisible') erreurs.add(champ.key)
			else if (filtre !== null) {
				const brut = formaterFiltre(filtre)
				if (brut !== null) sortie[champ.key] = brut
			}
		}
		setIllisibles(erreurs)
		// Une borne illisible ne part pas : rien n'est appliqué tant qu'elle reste (§5.92).
		if (erreurs.size === 0) onAppliquer(sortie)
	}

	const echap = (evenement: KeyboardEvent) => {
		if (evenement.key !== 'Escape') return
		evenement.stopPropagation()
		onFermer()
	}

	return (
		<section
			id={id}
			data-testid="panneau-filtres-communs"
			aria-label={t('liste.communs.panneau.aria')}
			onKeyDown={echap}
			className="flex flex-col gap-4 bg-surface border border-border rounded-md p-4"
		>
			<div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
				{champs.map((champ) => {
					const brouillon = brouillons[champ.key] ?? VIDE
					const idChamp = `${prefixe}-${champ.key}`
					const illisible = illisibles.has(champ.key)
					return (
						<fieldset key={champ.id} data-champ={champ.key} data-testid="filtre-commun" className="flex flex-col gap-2 min-w-0">
							<legend className="text-sm text-text-2 mb-1">{champ.label}</legend>
							<ControleFiltre champ={champ} brouillon={brouillon} idChamp={idChamp} illisible={illisible} onChange={(c) => modifier(champ.key, c)} />
						</fieldset>
					)
				})}
			</div>
			<p className="text-sm text-text-2">{t('liste.communs.note')}</p>
			<div className="flex flex-wrap gap-2">
				<Button variante="primaire" data-testid="appliquer-filtres-communs" onClick={appliquer}>
					{t('liste.communs.appliquer')}
				</Button>
				<Button variante="discret" data-testid="fermer-filtres-communs" onClick={onFermer}>
					{t('liste.communs.fermer')}
				</Button>
			</div>
		</section>
	)
}

const CLASSES_SAISIE = 'min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base min-w-0 w-full'

function ControleFiltre({
	champ,
	brouillon,
	idChamp,
	illisible,
	onChange,
}: {
	readonly champ: ChampCommun
	readonly brouillon: Brouillon
	readonly idChamp: string
	readonly illisible: boolean
	readonly onChange: (changement: Partial<Brouillon>) => void
}) {
	const sorte = sorteDuType(champ.type)
	if (sorte === 'contient')
		return (
			<div className="flex flex-col gap-1">
				<label htmlFor={idChamp} className="text-sm text-text-2">
					{t('liste.communs.contient')}
				</label>
				<input id={idChamp} type="text" value={brouillon.texte} onChange={(e) => onChange({ texte: e.target.value })} className={CLASSES_SAISIE} />
			</div>
		)
	if (sorte === 'choix') {
		const aide = `${idChamp}-aide`
		return (
			<div className="flex flex-col gap-1" role="group" aria-describedby={aide}>
				<p id={aide} className="text-sm text-text-2">
					{t(champ.type === 'select' ? 'liste.communs.choix.aide' : 'liste.communs.multi.aide')}
				</p>
				{choixDuChamp(champ).map((choix) => {
					const coche = brouillon.cles.includes(choix.key)
					return (
						<label key={choix.key} className="flex items-center gap-2 min-h-[var(--size-target)]">
							<input
								type="checkbox"
								className="size-6 shrink-0"
								checked={coche}
								onChange={() => onChange({ cles: coche ? brouillon.cles.filter((c) => c !== choix.key) : [...brouillon.cles, choix.key] })}
							/>
							<span className="min-w-0 break-words">{choix.label}</span>
						</label>
					)
				})}
			</div>
		)
	}
	if (sorte === 'bornes' || sorte === 'dates') {
		const type = sorte === 'bornes' ? 'text' : 'date'
		const erreur = `${idChamp}-erreur`
		return (
			<div className="flex flex-col gap-1">
				<div className="grid grid-cols-2 gap-2">
					{(['de', 'a'] as const).map((borne) => (
						<div key={borne} className="flex flex-col gap-1 min-w-0">
							<label htmlFor={`${idChamp}-${borne}`} className="text-sm text-text-2">
								{t(sorte === 'bornes' ? (borne === 'de' ? 'liste.communs.de' : 'liste.communs.a') : borne === 'de' ? 'liste.communs.du' : 'liste.communs.au')}
							</label>
							<input
								id={`${idChamp}-${borne}`}
								type={type}
								{...(sorte === 'bornes' ? { inputMode: 'decimal' as const } : {})}
								value={brouillon[borne]}
								aria-invalid={illisible || undefined}
								aria-describedby={illisible ? erreur : undefined}
								onChange={(e) => onChange({ [borne]: e.target.value })}
								className={CLASSES_SAISIE}
							/>
						</div>
					))}
				</div>
				{illisible ? (
					<p id={erreur} className="text-sm text-danger">
						{t('liste.communs.erreur.nombre')}
					</p>
				) : null}
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={idChamp} className="sr-only">
				{champ.label}
			</label>
			<select id={idChamp} value={brouillon.etat} onChange={(e) => onChange({ etat: e.target.value as Brouillon['etat'] })} className={CLASSES_SAISIE}>
				<option value="">{t('liste.communs.case.indifferent')}</option>
				<option value="oui">{t('liste.communs.case.oui')}</option>
				<option value="non">{t('liste.communs.case.non')}</option>
				<option value="vide">{t('liste.communs.case.vide')}</option>
			</select>
		</div>
	)
}
