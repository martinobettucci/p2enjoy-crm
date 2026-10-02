// @spec CRM-097 (docs/BACKLOG.md) — tranche T2.c : l'aperçu modifiable d'une suggestion de workflow
// @spec docs/SPEC-ia.md §12.5 (« Relire » et « Corriger à la main » : ce qui se corrige, les retraits en cascade,
//       l'ajout d'une transition) ; docs/JOURNAL.md décision 618 (point 7)
// @spec docs/DESIGN_SYSTEM.md §5.52 (l'ordre de l'éditeur, nœud nommé par un mot, ce qui se corrige est un champ et
//       ce qui ne se corrige pas un texte, retraits sans confirmation et annoncés, l'étape initiale en radio),
//       §5.15 (listes et non diagramme, « Vers <étape> », clés en `code`, choix dans un `fieldset`), §5.7 (champs),
//       §8 (chaque contrôle nommé), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// Composant contrôlé : il ne garde que l'état d'ouverture du formulaire d'ajout. Chaque geste rend la proposition
// modifiée — et, pour un retrait, l'annonce de ce qu'il a emporté — au panneau, qui tient le brouillon.

import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import {
	ajouterTransition,
	designerInitiale,
	modifierChamp,
	modifierNoeud,
	modifierRegle,
	modifierTransition,
	noeudPropose,
	renommerWorkflow,
	retirerChamp,
	retirerEtape,
	retirerExigence,
	retirerRegle,
	retirerTransition,
	utiliserNoeudDuCatalogue,
	type PropositionIa,
} from '../lib/brouillon-ia'

// Clés écrites en toutes lettres, jamais composées (convention de `LIBELLES_TYPE` dans l'éditeur, contrôle des
// clés mortes de `i18n.test.ts`).
const LIBELLES_TYPE: Readonly<Record<string, CleTraduction>> = {
	text: 'admin.workflows.fields.type.text',
	textarea: 'admin.workflows.fields.type.textarea',
	number: 'admin.workflows.fields.type.number',
	money: 'admin.workflows.fields.type.money',
	date: 'admin.workflows.fields.type.date',
	datetime: 'admin.workflows.fields.type.datetime',
	select: 'admin.workflows.fields.type.select',
	multiselect: 'admin.workflows.fields.type.multiselect',
	checkbox: 'admin.workflows.fields.type.checkbox',
	url: 'admin.workflows.fields.type.url',
	email: 'admin.workflows.fields.type.email',
	phone: 'admin.workflows.fields.type.phone',
	user: 'admin.workflows.fields.type.user',
	contact: 'admin.workflows.fields.type.contact',
	file: 'admin.workflows.fields.type.file',
}
const TYPES = Object.keys(LIBELLES_TYPE)
const LIBELLES_NATURE: Readonly<Record<string, CleTraduction>> = {
	open: 'admin.catalog.kind.open',
	won: 'admin.catalog.kind.won',
	lost: 'admin.catalog.kind.lost',
}
const NATURES = Object.keys(LIBELLES_NATURE)
const LIBELLES_VISIBILITE: Readonly<Record<string, CleTraduction>> = {
	hidden: 'admin.workflows.rules.state.hidden',
	visible: 'admin.workflows.rules.state.visible',
	required: 'admin.workflows.rules.state.required',
}
const VISIBILITES = Object.keys(LIBELLES_VISIBILITE)

/** Un libellé connu, ou la valeur brute que la proposition porte — une valeur inconnue se montre, la base la dira. */
const libelleDe = (libelles: Readonly<Record<string, CleTraduction>>, valeur: string): string => {
	const cle = Object.hasOwn(libelles, valeur) ? libelles[valeur] : undefined
	return cle === undefined ? valeur : t(cle)
}

const CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'
const LISTE = 'flex flex-col divide-y divide-border rounded-lg border border-border'
const LIGNE = 'flex flex-wrap items-center gap-2 px-3 py-2'
const LIGNE_DOUBLE = 'flex flex-col gap-2 px-3 py-2'
const CLE = 'rounded-sm bg-hover px-1'
const PILULE = 'rounded-full bg-hover px-2 text-xs text-text-2'

type ProprietesApercu = {
	readonly proposition: PropositionIa
	/** Les nœuds VIVANTS du catalogue : clé → libellé. */
	readonly catalogue: ReadonlyMap<string, string>
	readonly desactive: boolean
	readonly onChange: (proposition: PropositionIa, annonce?: string) => void
}

export function ApercuPropositionIa({ proposition: p, catalogue, desactive, onChange }: ProprietesApercu) {
	const prefixe = useId()
	const [ajoutOuvert, setAjoutOuvert] = useState(false)
	// Fermé, le formulaire d'ajout rend le focus à la commande qui l'a ouvert — différé d'un rendu, la commande
	// étant démontée pendant la saisie (§5.25). Aucune temporisation.
	const boutonAjout = useRef<HTMLButtonElement | null>(null)
	const [rendreFocus, setRendreFocus] = useState(false)
	useEffect(() => {
		if (!rendreFocus || ajoutOuvert) return
		boutonAjout.current?.focus()
		setRendreFocus(false)
	}, [rendreFocus, ajoutOuvert])
	const fermerAjout = () => {
		setAjoutOuvert(false)
		setRendreFocus(true)
	}

	const nomEtape = (cle: string) => noeudPropose(p, cle)?.libelle || catalogue.get(cle) || cle
	// Un groupe de radios ne sait montrer qu'UN choix : quand la proposition porte plusieurs étapes initiales — un
	// défaut, que la base dit —, aucun radio n'est coché, plutôt que le dernier rendu, qui mentirait (§5.52).
	const initiales = p.etapes.filter((e) => e.initiale).length
	const nomChamp = (cle: string) => p.champs.find((c) => c.cle === cle)?.libelle || cle
	const departs = [
		...p.etapes.map((e) => e.noeud),
		...p.transitions.map((x) => x.de).filter((de, i, toutes) => !p.etapes.some((e) => e.noeud === de) && toutes.indexOf(de) === i),
	]

	return (
		<div className="flex flex-col gap-6" data-testid="ia-apercu">
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-nom`} className="text-sm text-text-2">
					{t('ia.apercu.nom')}
				</label>
				<input
					id={`${prefixe}-nom`}
					value={p.workflow.nom}
					disabled={desactive}
					onChange={(e) => onChange(renommerWorkflow(p, e.target.value))}
					className={CHAMP}
				/>
			</div>

			<section className="flex flex-col gap-2" aria-labelledby={`${prefixe}-etapes`}>
				<h3 id={`${prefixe}-etapes`}>{t('ia.apercu.etapes')}</h3>
				{p.etapes.length === 0 ? (
					<p className="text-sm text-text-2">{t('ia.apercu.etapes.vide')}</p>
				) : (
					<ol className={LISTE}>
						{p.etapes.map((etape) => {
							const propose = noeudPropose(p, etape.noeud)
							const auCatalogue = catalogue.has(etape.noeud)
							const nom = nomEtape(etape.noeud)
							return (
								<li key={etape.noeud} className={LIGNE_DOUBLE} data-testid="ia-etape">
									{/* Deux lignes à tous les paliers : le nom et son retrait, puis les attributs — un repli régulier, jamais
									    variable d'une ligne à l'autre (§5.37, défaut vu sur les captures à 390 et 1152 px). */}
									<div className="flex items-center gap-2">
										{propose === undefined ? (
											<span className="min-w-0 flex-1 font-medium">{nom}</span>
										) : (
											<input
												aria-label={t('ia.apercu.libelle.de', { objet: etape.noeud })}
												value={propose.libelle}
												disabled={desactive}
												onChange={(e) => onChange(modifierNoeud(p, etape.noeud, { libelle: e.target.value }))}
												className={`${CHAMP} min-w-0 flex-1`}
											/>
										)}
										<Button
											taille="compacte"
											variante="discret"
											aria-label={t('ia.apercu.retirer_etape', { etape: nom })}
											disabled={desactive}
											onClick={() => {
												const { proposition, emportes } = retirerEtape(p, etape.noeud)
												onChange(
													proposition,
													t('ia.annonce.retrait.etape', {
														etape: nom,
														transitions: String(emportes.transitions),
														regles: String(emportes.regles),
														exigences: String(emportes.exigences),
													}),
												)
											}}
										>
											<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
										</Button>
									</div>
									{/* Deux groupes qui se replient ENTIERS : l'identité du nœud, puis ses réglages — dont la largeur est
									    la même à chaque ligne, si bien que le repli l'est aussi (vu à 390 px). */}
									<div className="flex flex-wrap items-center gap-2">
										<span className="flex items-center gap-2">
											<code className={CLE}>{etape.noeud}</code>
											<span className={PILULE}>
												{propose !== undefined
													? t('ia.apercu.noeud.nouveau')
													: auCatalogue
														? t('ia.apercu.noeud.catalogue')
														: t('ia.apercu.noeud.inconnu')}
											</span>
										</span>
										<span className="flex flex-wrap items-center gap-2">
										{propose === undefined ? null : (
											<>
												<select
													aria-label={t('ia.apercu.nature', { etape: nom })}
													value={propose.nature}
													disabled={desactive}
													onChange={(e) => onChange(modifierNoeud(p, etape.noeud, { nature: e.target.value }))}
													className={CHAMP}
												>
													{NATURES.includes(propose.nature) ? null : (
														<option value={propose.nature}>{propose.nature}</option>
													)}
													{NATURES.map((nature) => (
														<option key={nature} value={nature}>
															{libelleDe(LIBELLES_NATURE, nature)}
														</option>
													))}
												</select>
												<input
													type="number"
													min={0}
													max={100}
													aria-label={t('ia.apercu.probabilite', { etape: nom })}
													value={propose.probabilite ?? ''}
													disabled={desactive}
													onChange={(e) =>
														onChange(modifierNoeud(p, etape.noeud, { probabilite: e.target.value === '' ? null : Number(e.target.value) }))
													}
													className={`${CHAMP} w-[6rem] tabular-nums`}
												/>
											</>
										)}
										<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
											<input
												type="radio"
												name={`${prefixe}-initiale`}
												className="size-6 accent-[var(--color-brand)]"
												aria-label={t('ia.apercu.initiale.choisir', { etape: nom })}
												checked={etape.initiale && initiales === 1}
												disabled={desactive}
												onChange={() => onChange(designerInitiale(p, etape.noeud))}
											/>
											<span aria-hidden="true">{t('ia.apercu.initiale')}</span>
										</label>
										{propose !== undefined && auCatalogue ? (
											<Button
												taille="compacte"
												variante="discret"
												disabled={desactive}
												onClick={() =>
													onChange(utiliserNoeudDuCatalogue(p, etape.noeud), t('ia.annonce.noeud_catalogue', { etape: etape.noeud }))
												}
											>
												{t('ia.apercu.utiliser_catalogue')}
											</Button>
										) : null}
										</span>
									</div>
								</li>
							)
						})}
					</ol>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby={`${prefixe}-transitions`}>
				<h3 id={`${prefixe}-transitions`}>{t('ia.apercu.transitions')}</h3>
				{p.etapes.length === 0 && p.transitions.length === 0 ? (
					<p className="text-sm text-text-2">{t('ia.apercu.transitions.vide')}</p>
				) : (
					<ul className="flex flex-col gap-3">
						{departs.map((de) => {
							const sorties = p.transitions.map((x, rang) => ({ x, rang })).filter(({ x }) => x.de === de)
							return (
								<li key={de} className="flex flex-col gap-1">
									<h4 className="text-sm font-medium text-text-2">{t('ia.apercu.depuis', { etape: nomEtape(de) })}</h4>
									{sorties.length === 0 ? (
										<p className="text-sm text-text-3">{t('ia.apercu.sorties.vide')}</p>
									) : (
										<ul className={LISTE}>
											{sorties.map(({ x, rang }) => (
												<li key={`${x.de}>${x.vers}#${rang}`} className={LIGNE_DOUBLE} data-testid="ia-transition">
													<div className="flex items-center gap-2">
														<ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="text-text-3" />
														<span className="min-w-0 flex-1 font-medium">{t('ia.apercu.vers', { etape: nomEtape(x.vers) })}</span>
														<Button
															taille="compacte"
															variante="discret"
															aria-label={t('ia.apercu.retirer_transition', { de: nomEtape(x.de), vers: nomEtape(x.vers) })}
															disabled={desactive}
															onClick={() => {
																const retrait = retirerTransition(p, rang)
																onChange(retrait.proposition, t('ia.annonce.retrait.transition', { exigences: String(retrait.emportes.exigences) }))
															}}
														>
															<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
														</Button>
													</div>
													<div className="flex flex-wrap items-center gap-2">
														<input
															aria-label={t('ia.apercu.libelle.transition', { de: nomEtape(x.de), vers: nomEtape(x.vers) })}
															value={x.libelle}
															disabled={desactive}
															onChange={(e) => onChange(modifierTransition(p, rang, { libelle: e.target.value }))}
															className={`${CHAMP} min-w-0 flex-1 basis-[12rem]`}
														/>
														<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
															<input
																type="checkbox"
																className="size-6 accent-[var(--color-brand)]"
																aria-label={t('ia.apercu.motif.de', { de: nomEtape(x.de), vers: nomEtape(x.vers) })}
																checked={x.commentaire_requis}
																disabled={desactive}
																onChange={(e) => onChange(modifierTransition(p, rang, { commentaire_requis: e.target.checked }))}
															/>
															<span aria-hidden="true">{t('ia.apercu.motif')}</span>
														</label>
													</div>
												</li>
											))}
										</ul>
									)}
								</li>
							)
						})}
					</ul>
				)}
				{ajoutOuvert ? (
					<FormulaireTransition
						etapes={p.etapes.map((e) => ({ cle: e.noeud, nom: nomEtape(e.noeud) }))}
						onAjouter={(transition) => {
							onChange(ajouterTransition(p, transition))
							fermerAjout()
						}}
						onAnnuler={fermerAjout}
					/>
				) : (
					<div>
						<Button ref={boutonAjout} variante="secondaire" taille="compacte" disabled={desactive} onClick={() => setAjoutOuvert(true)}>
							<Plus aria-hidden="true" size={16} strokeWidth={2} />
							{t('ia.apercu.ajouter_transition')}
						</Button>
					</div>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby={`${prefixe}-champs`}>
				<h3 id={`${prefixe}-champs`}>{t('ia.apercu.champs')}</h3>
				{p.champs.length === 0 ? (
					<p className="text-sm text-text-2">{t('ia.apercu.champs.vide')}</p>
				) : (
					<ul className={LISTE}>
						{p.champs.map((champ, rang) => {
							const nom = champ.libelle || champ.cle
							const aChoix = champ.type === 'select' || champ.type === 'multiselect'
							return (
								<li key={`${champ.cle}#${rang}`} className="flex flex-col gap-2 px-3 py-2" data-testid="ia-champ">
									<div className="flex items-center gap-2">
										<input
											aria-label={t('ia.apercu.libelle.de', { objet: champ.cle })}
											value={champ.libelle}
											disabled={desactive}
											onChange={(e) => onChange(modifierChamp(p, rang, { libelle: e.target.value }))}
											className={`${CHAMP} min-w-0 flex-1`}
										/>
										<Button
											taille="compacte"
											variante="discret"
											aria-label={t('ia.apercu.retirer_champ', { champ: nom })}
											disabled={desactive}
											onClick={() => {
												const { proposition, emportes } = retirerChamp(p, rang)
												onChange(
													proposition,
													t('ia.annonce.retrait.champ', { champ: nom, regles: String(emportes.regles), exigences: String(emportes.exigences) }),
												)
											}}
										>
											<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
										</Button>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<code className={CLE}>{champ.cle}</code>
										<select
											aria-label={t('ia.apercu.type', { champ: nom })}
											value={champ.type}
											disabled={desactive}
											onChange={(e) => onChange(modifierChamp(p, rang, { type: e.target.value }))}
											className={CHAMP}
										>
											{TYPES.includes(champ.type) ? null : <option value={champ.type}>{champ.type}</option>}
											{TYPES.map((type) => (
												<option key={type} value={type}>
													{libelleDe(LIBELLES_TYPE, type)}
												</option>
											))}
										</select>
									</div>
									{aChoix ? (
										<fieldset className="flex flex-col gap-2">
											<legend className="text-sm text-text-2">{t('ia.apercu.choix', { champ: nom })}</legend>
											{(champ.choix ?? []).map((choix, i) => (
												<div key={i} className="flex flex-wrap items-center gap-2">
													<input
														aria-label={t('ia.apercu.choix.libelle', { rang: String(i + 1), champ: nom })}
														value={choix}
														disabled={desactive}
														onChange={(e) =>
															onChange(modifierChamp(p, rang, { choix: (champ.choix ?? []).map((c, j) => (j === i ? e.target.value : c)) }))
														}
														className={`${CHAMP} min-w-0 flex-1 basis-[12rem]`}
													/>
													<Button
														taille="compacte"
														variante="discret"
														aria-label={t('ia.apercu.choix.retirer', { rang: String(i + 1), champ: nom })}
														disabled={desactive}
														onClick={() => onChange(modifierChamp(p, rang, { choix: (champ.choix ?? []).filter((_, j) => j !== i) }))}
													>
														<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
													</Button>
												</div>
											))}
											<div>
												<Button
													taille="compacte"
													variante="discret"
													disabled={desactive}
													onClick={() => onChange(modifierChamp(p, rang, { choix: [...(champ.choix ?? []), ''] }))}
												>
													<Plus aria-hidden="true" size={16} strokeWidth={2} />
													{t('ia.apercu.choix.ajouter')}
												</Button>
											</div>
										</fieldset>
									) : null}
									<div className="flex flex-wrap items-center gap-2">
										{champ.type === 'money' ? (
											<input
												aria-label={t('ia.apercu.devise', { champ: nom })}
												value={champ.devise ?? ''}
												maxLength={3}
												disabled={desactive}
												onChange={(e) => onChange(modifierChamp(p, rang, { devise: e.target.value === '' ? null : e.target.value.toUpperCase() }))}
												className={`${CHAMP} w-[6rem] uppercase`}
											/>
										) : null}
										<input
											aria-label={t('ia.apercu.aide', { champ: nom })}
											placeholder={t('ia.apercu.aide', { champ: nom })}
											value={champ.aide ?? ''}
											disabled={desactive}
											onChange={(e) => onChange(modifierChamp(p, rang, { aide: e.target.value === '' ? null : e.target.value }))}
											className={`${CHAMP} min-w-0 flex-1 basis-[12rem]`}
										/>
									</div>
								</li>
							)
						})}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby={`${prefixe}-regles`}>
				<h3 id={`${prefixe}-regles`}>{t('ia.apercu.regles')}</h3>
				{p.regles.length === 0 ? (
					<p className="text-sm text-text-2">{t('ia.apercu.regles.vide')}</p>
				) : (
					<ul className={LISTE}>
						{p.regles.map((regle, rang) => {
							const noms = { champ: nomChamp(regle.champ), etape: nomEtape(regle.etape) }
							return (
								<li key={`${regle.champ}@${regle.etape}#${rang}`} className={LIGNE} data-testid="ia-regle">
									<span className="min-w-0 flex-1 basis-[12rem]">{t('ia.apercu.regle', noms)}</span>
									<select
										aria-label={t('ia.apercu.regle.visibilite', noms)}
										value={regle.visibilite}
										disabled={desactive}
										onChange={(e) => onChange(modifierRegle(p, rang, e.target.value))}
										className={CHAMP}
									>
										{VISIBILITES.includes(regle.visibilite) ? null : (
											<option value={regle.visibilite}>{regle.visibilite}</option>
										)}
										{VISIBILITES.map((visibilite) => (
											<option key={visibilite} value={visibilite}>
												{libelleDe(LIBELLES_VISIBILITE, visibilite)}
											</option>
										))}
									</select>
									<Button
										taille="compacte"
										variante="discret"
										aria-label={t('ia.apercu.retirer_regle', noms)}
										disabled={desactive}
										onClick={() => onChange(retirerRegle(p, rang), t('ia.annonce.retrait.regle'))}
									>
										<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
									</Button>
								</li>
							)
						})}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby={`${prefixe}-exigences`}>
				<h3 id={`${prefixe}-exigences`}>{t('ia.apercu.exigences')}</h3>
				{p.exigences.length === 0 ? (
					<p className="text-sm text-text-2">{t('ia.apercu.exigences.vide')}</p>
				) : (
					<ul className={LISTE}>
						{p.exigences.map((exigence, rang) => {
							const noms = { de: nomEtape(exigence.de), vers: nomEtape(exigence.vers), champ: nomChamp(exigence.champ) }
							return (
								<li key={`${exigence.de}>${exigence.vers}@${exigence.champ}#${rang}`} className={LIGNE} data-testid="ia-exigence">
									<span className="min-w-0 flex-1 basis-[12rem]">{t('ia.apercu.exigence', noms)}</span>
									<Button
										taille="compacte"
										variante="discret"
										aria-label={t('ia.apercu.retirer_exigence', noms)}
										disabled={desactive}
										onClick={() => onChange(retirerExigence(p, rang), t('ia.annonce.retrait.exigence'))}
									>
										<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
									</Button>
								</li>
							)
						})}
					</ul>
				)}
			</section>
		</div>
	)
}

type ProprietesFormulaireTransition = {
	readonly etapes: readonly { readonly cle: string; readonly nom: string }[]
	readonly onAjouter: (transition: { de: string; vers: string; libelle: string; commentaire_requis: boolean }) => void
	readonly onAnnuler: () => void
}

/**
 * Le formulaire replié d'ajout d'une transition (§5.52) : deux `select` ouverts sur une option vide, un libellé,
 * la case du motif. « Ajouter » attend les deux étapes — des champs requis, non un droit (§5.50) ; le libellé
 * vide reste permis, et la base le dira.
 */
function FormulaireTransition({ etapes, onAjouter, onAnnuler }: ProprietesFormulaireTransition) {
	const prefixe = useId()
	const premier = useRef<HTMLSelectElement | null>(null)
	// Le focus entre dans le premier champ à l'ouverture (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])
	const [de, setDe] = useState('')
	const [vers, setVers] = useState('')
	const [libelle, setLibelle] = useState('')
	const [motif, setMotif] = useState(false)
	return (
		<form
			aria-label={t('ia.apercu.ajouter_transition')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(e) => {
				e.preventDefault()
				if (de === '' || vers === '') return
				onAjouter({ de, vers, libelle, commentaire_requis: motif })
			}}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onAnnuler()
			}}
		>
			<div className="flex flex-wrap gap-3">
				{(
					[
						['depart', de, setDe, 'ia.apercu.transition.depart'],
						['arrivee', vers, setVers, 'ia.apercu.transition.arrivee'],
					] as const
				).map(([cle, valeur, poser, libelleCle], i) => (
					<div key={cle} className="flex min-w-0 flex-1 basis-[12rem] flex-col gap-1">
						<label htmlFor={`${prefixe}-${cle}`} className="text-sm text-text-2">
							{t(libelleCle)}
						</label>
						<select
							id={`${prefixe}-${cle}`}
							ref={i === 0 ? premier : undefined}
							value={valeur}
							onChange={(e) => poser(e.target.value)}
							className={CHAMP}
						>
							<option value="">{t('ia.apercu.transition.choisir')}</option>
							{etapes.map((etape) => (
								<option key={etape.cle} value={etape.cle}>
									{etape.nom}
								</option>
							))}
						</select>
					</div>
				))}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-libelle`} className="text-sm text-text-2">
					{t('ia.apercu.libelle')}
				</label>
				<input id={`${prefixe}-libelle`} value={libelle} onChange={(e) => setLibelle(e.target.value)} className={CHAMP} />
			</div>
			<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
				<input type="checkbox" className="size-6 accent-[var(--color-brand)]" checked={motif} onChange={(e) => setMotif(e.target.checked)} />
				{t('ia.apercu.motif')}
			</label>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={de === '' || vers === ''}>
					{t('ia.apercu.transition.ajouter')}
				</Button>
				<Button variante="discret" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}
