// @verifies CRM-037 (docs/BACKLOG.md) — composition du formulaire conditionnel
// @verifies docs/SPEC-form-composer.md §4.1 (composition), §4.2 (trois destinations),
//           §4.3 (« renseigné »), §4.4 (champ exigé), §3.1 (défaut « visible »), §5 (archivage)
// @verifies docs/SPEC-form-composer.md §6.6 (définition de « renseigné », côté SQL)
//
// Le jeu d'essai reprend **le seed réellement appliqué**, relu en base le 2026-08-05 : sept
// champs dont un archivé, l'étape `Prospection` et ses cinq règles pour six champs actifs. Ce
// n'est pas une décoration — c'est ce qui fait que le cas « un champ sans règle » est exercé par
// une donnée que le produit porte, et non par un cas inventé pour la preuve.

import { describe, expect, it } from 'vitest'
import {
	appliquerEcriture,
	CAS_RENSEIGNE,
	classerRefusValeur,
	composerFormulaire,
	estRenseigne,
	lireClesExigees,
	memeValeur,
	MESSAGE_VALEUR_INVALIDE,
	normaliserSaisie,
	VISIBILITE_PAR_DEFAUT,
	type ChampFormulaire,
	type RegleVisibilite,
	type ValeurChamp,
} from './formulaire'

const ETAPE = { id: 'etape-prospection', label: 'Prospection' }
const AUTRE_ETAPE = 'etape-negociation'

function champ(partiel: Partial<ChampFormulaire> & Pick<ChampFormulaire, 'id' | 'key' | 'position'>): ChampFormulaire {
	return {
		label: partiel.key,
		type: 'text',
		options: {},
		help_text: null,
		archived_at: null,
		...partiel,
	}
}

/** Les six champs actifs du seed, plus le champ archivé, dans leur ordre de `position`. */
const CHAMPS: readonly ChampFormulaire[] = [
	champ({ id: 'f-budget', key: 'budget', position: 1, type: 'money', label: 'Budget estimé' }),
	champ({ id: 'f-source', key: 'source', position: 2, type: 'select', label: 'Origine du contact' }),
	champ({ id: 'f-date', key: 'date-signature-prevue', position: 3, type: 'date' }),
	champ({ id: 'f-motif', key: 'motif-perte', position: 4, type: 'textarea' }),
	champ({ id: 'f-decideur', key: 'decideur-identifie', position: 5, type: 'checkbox' }),
	champ({ id: 'f-lien', key: 'lien-proposition', position: 6, type: 'url' }),
	champ({
		id: 'f-previsionnel',
		key: 'budget-previsionnel',
		position: 7,
		type: 'number',
		archived_at: '2026-08-03T00:00:00Z',
	}),
]

/** Les cinq règles du seed à l'étape `Prospection`. `decideur-identifie` n'en a aucune. */
const REGLES: readonly RegleVisibilite[] = [
	{ field_id: 'f-budget', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
	{ field_id: 'f-date', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-motif', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-lien', step_id: ETAPE.id, visibility: 'hidden' },
	// Règle d'une **autre** étape : elle ne doit avoir aucun effet ici.
	{ field_id: 'f-decideur', step_id: AUTRE_ETAPE, visibility: 'required' },
]

const composer = (valeurs: readonly ValeurChamp[] = []) =>
	composerFormulaire({ champs: CHAMPS, regles: REGLES, valeurs, etape: ETAPE })

describe('« renseigné » donne la même lecture que app.valeur_de_champ_est_vide (§4.3, §6.6)', () => {
	it.each(CAS_RENSEIGNE)('$nom', (cas) => {
		expect(estRenseigne(cas.valeur)).toBe(cas.renseigne)
	})

	it("l'absence de ligne n'est pas renseignée, comme un null explicite", () => {
		expect(estRenseigne(undefined)).toBe(false)
	})

	it('le tableau de cas couvre les cinq façons d’être vide du §6.6', () => {
		const vides = CAS_RENSEIGNE.filter((cas) => !cas.renseigne)
		// Quatre jusqu'à l'arbitrage du lot G, huit depuis : la tabulation, le saut de ligne,
		// l'espace insécable et le cadratin ont REJOINT les vides (INC-052, décision 374).
		expect(vides).toHaveLength(8)
		// `undefined` n'est pas une valeur `jsonb` : il est exercé par le test ci-dessus, et ne
		// peut pas figurer dans un tableau que la preuve d'API écrit en base.
		expect(vides.map((cas) => cas.nom)).toContain('null explicite')
	})

	it('une chaîne de blancs UNICODE est vide des deux côtés — INC-052, arbitrage rendu', () => {
		// TEST RETOURNÉ, NON RETIRÉ (décision 51). Il s'appelait « la tabulation n'est PAS un
		// espace pour `btrim` : la chaîne reste renseignée » et exigeait `true` sur les trois
		// premières lignes. C'était fidèle à la base : `btrim(texte)` sans second argument ne
		// retire que `U+0020`, et la décision 165 avait fait converger l'interface VERS ce
		// comportement faute d'arbitrage sur la règle.
		//
		// L'arbitrage est rendu (décision 367, lot G) et mis en œuvre par la décision 374 :
		// `app.btrim_blancs` retire les blancs Unicode, exactement ceux de `trim()`. Les deux
		// lectures convergent donc toujours, mais sur la règle élargie.
		expect(estRenseigne('\t')).toBe(false)
		expect(estRenseigne('\n')).toBe(false)
		expect(estRenseigne(' \t ')).toBe(false)
		expect(estRenseigne('   ')).toBe(false)
		// Deux blancs non-ASCII, que l'élargissement minimal `btrim(v, E' \\t\\r\\n')` n'aurait pas
		// couverts : ils mesurent que l'arbitrage porte bien sur l'ensemble Unicode.
		expect(estRenseigne('\u00A0')).toBe(false)
		expect(estRenseigne('\u2003')).toBe(false)
		// Et un texte ENTOURÉ de blancs reste renseigné : c'est un `btrim`, non une purge.
		expect(estRenseigne('\u2003Salon\u00A0')).toBe(true)
	})

	it('faux, zéro et « 0 » sont renseignés : une case décochée est une réponse', () => {
		expect(estRenseigne(false)).toBe(true)
		expect(estRenseigne(0)).toBe(true)
		expect(estRenseigne('0')).toBe(true)
	})
})

describe('composition du formulaire d’une étape (§4.1)', () => {
	it('part des champs, jamais des règles : un champ sans règle apparaît par le défaut « visible »', () => {
		const modele = composer()
		const cles = modele.champs.map((resolu) => resolu.champ.key)
		expect(cles).toContain('decideur-identifie')
		const decideur = modele.champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.visibilite).toBe(VISIBILITE_PAR_DEFAUT)
	})

	it('ignore les règles des autres étapes', () => {
		// `decideur-identifie` est `required` à l'étape `Négociation` : ici, il ne l'est pas.
		const decideur = composer().champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.visibilite).toBe('visible')
		expect(decideur?.manquant).toBe(false)
	})

	it('ordonne les champs par position, quel que soit l’ordre d’entrée', () => {
		const desordre = [...CHAMPS].reverse()
		const modele = composerFormulaire({ champs: desordre, regles: REGLES, valeurs: [], etape: ETAPE })
		expect(modele.champs.map((resolu) => resolu.champ.position)).toEqual([2, 5])
	})

	it('un champ « hidden » sans valeur n’apparaît nulle part', () => {
		const modele = composer()
		const partout = [...modele.champs, ...modele.autresEtapes].map((resolu) => resolu.champ.key)
		expect(partout).not.toContain('lien-proposition')
	})

	it('un champ « hidden » porteur d’une valeur va dans la section repliée (§4.2)', () => {
		// Le cas de la card `…0000c6` du seed : à `Prospection`, `motif-perte` est `hidden` et
		// porte pourtant une valeur.
		const modele = composer([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('motif-perte')
		expect(modele.autresEtapes.map((resolu) => resolu.champ.key)).toEqual(['motif-perte'])
	})

	it('un champ archivé porteur d’une valeur va dans la section repliée, jamais dans le formulaire (§5)', () => {
		const modele = composer([{ field_id: 'f-previsionnel', value: 72000 }])
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('budget-previsionnel')
		expect(modele.autresEtapes.map((resolu) => resolu.champ.key)).toContain('budget-previsionnel')
	})

	it('un champ archivé sans valeur n’apparaît nulle part', () => {
		const modele = composer()
		const partout = [...modele.champs, ...modele.autresEtapes].map((resolu) => resolu.champ.key)
		expect(partout).not.toContain('budget-previsionnel')
	})

	it('une visibilité inconnue du backend se replie sur « visible » plutôt que de masquer', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-budget', step_id: ETAPE.id, visibility: 'fantaisie' }],
			valeurs: [],
			etape: ETAPE,
		})
		expect(modele.champs.map((resolu) => resolu.champ.key)).toContain('budget')
	})
})

describe('champ exigé et manquant (§4.4)', () => {
	it('un champ « required » vide est manquant, et sa clé est listée', () => {
		const modele = composer()
		const source = modele.champs.find((resolu) => resolu.champ.key === 'source')
		expect(source?.visibilite).toBe('required')
		expect(source?.manquant).toBe(true)
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('renseigné, il cesse d’être manquant', () => {
		const modele = composer([{ field_id: 'f-source', value: 'salon' }])
		expect(modele.clesManquantes).toEqual([])
	})

	it('une valeur vidée explicitement le rend de nouveau manquant (INC-054)', () => {
		const modele = composer([{ field_id: 'f-source', value: null }])
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('une chaîne d’espaces ne renseigne pas un champ exigé', () => {
		const modele = composer([{ field_id: 'f-source', value: '   ' }])
		expect(modele.clesManquantes).toEqual(['source'])
	})

	it('un champ « visible » vide n’est jamais manquant : l’absence de règle n’exige rien', () => {
		const modele = composer()
		const decideur = modele.champs.find((resolu) => resolu.champ.key === 'decideur-identifie')
		expect(decideur?.renseigne).toBe(false)
		expect(decideur?.manquant).toBe(false)
	})

	it('les clés manquantes sortent dans l’ordre des positions', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [
				{ field_id: 'f-lien', step_id: ETAPE.id, visibility: 'required' },
				{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
			],
			valeurs: [],
			etape: ETAPE,
		})
		expect(modele.clesManquantes).toEqual(['source', 'lien-proposition'])
	})

	it('une case décochée satisfait un champ exigé : faux est une réponse', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-decideur', step_id: ETAPE.id, visibility: 'required' }],
			valeurs: [{ field_id: 'f-decideur', value: false }],
			etape: ETAPE,
		})
		expect(modele.clesManquantes).toEqual([])
	})
})

// ---------------------------------------------------------------------------------------------
// La saisie depuis la fiche — docs/SPEC-form-composer.md §4 bis
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-037 (docs/BACKLOG.md) — la saisie depuis la fiche
// @verifies docs/SPEC-form-composer.md §4 bis.3 (une écriture seulement si la valeur a changé),
//           §4 bis.4 (normalisation par type, aucun `trim`), §4 bis.5 (vider),
//           §4 bis.7 (dictionnaire fermé des refus), §4 bis.8 (mise à jour en place)

describe('normalisation d’une saisie (§4 bis.4)', () => {
	it('un montant et un nombre partent en NOMBRE, jamais en chaîne', () => {
		expect(normaliserSaisie('money', '45000')).toBe(45000)
		expect(normaliserSaisie('number', '12')).toBe(12)
	})

	it('une case à cocher part en BOOLÉEN, et décochée vaut `false` — jamais vide', () => {
		expect(normaliserSaisie('checkbox', true)).toBe(true)
		expect(normaliserSaisie('checkbox', false)).toBe(false)
	})

	it('une liste multiple part en TABLEAU, et le tableau vide vaut vide (§6.6)', () => {
		expect(normaliserSaisie('multiselect', ['salon', 'site'])).toEqual(['salon', 'site'])
		expect(normaliserSaisie('multiselect', [])).toBeNull()
	})

	it('toute autre saisie vide vaut `null` : vider est une écriture, pas une suppression (§4 bis.5)', () => {
		expect(normaliserSaisie('text', '')).toBeNull()
		expect(normaliserSaisie('money', '')).toBeNull()
		expect(normaliserSaisie('select', '')).toBeNull()
	})

	it('AUCUN `trim` : la base porte ce que l’utilisateur a saisi (§4 bis.4)', () => {
		// La chaîne de blancs est **vide au sens de « renseigné »** — c'est une règle de lecture, et
		// les deux lectures restent cohérentes sans que l'écriture ait à rogner quoi que ce soit.
		expect(normaliserSaisie('text', '   ')).toBe('   ')
		expect(estRenseigne(normaliserSaisie('text', '   '))).toBe(false)
		expect(normaliserSaisie('textarea', ' deux\n  lignes ')).toBe(' deux\n  lignes ')
	})

	it('un nombre non convertible reste une chaîne plutôt que de devenir `NaN`', () => {
		// `JSON.stringify(NaN)` rend `null`, donc « vidé » : une saisie serait silencieusement
		// effacée. Elle part telle quelle, et c'est le trigger de `CRM-036` qui la refuse.
		expect(normaliserSaisie('money', 'douze mille')).toBe('douze mille')
	})
})

describe('une écriture n’est émise que si la valeur a changé (§4 bis.3)', () => {
	it('aucune ligne et « vidé explicitement » sont la MÊME réponse', () => {
		expect(memeValeur(undefined, null)).toBe(true)
		expect(memeValeur(null, null)).toBe(true)
	})

	it('reconnaît l’égalité d’un tableau reconstruit, et la différence réelle', () => {
		expect(memeValeur(['salon'], ['salon'])).toBe(true)
		expect(memeValeur(['salon'], ['site'])).toBe(false)
		expect(memeValeur(45000, 45001)).toBe(false)
		expect(memeValeur(false, null)).toBe(false)
	})
})

describe('classement des refus d’écriture (§4 bis.7)', () => {
	it('400 + invalid_field_value est le refus du trigger de validation', () => {
		expect(classerRefusValeur(400, MESSAGE_VALEUR_INVALIDE).nature).toBe('invalid')
	})

	it('403 et 401 sont le refus de la politique d’écriture', () => {
		expect(classerRefusValeur(403, 'new row violates row-level security policy').nature).toBe('forbidden')
		expect(classerRefusValeur(401, 'JWT expired').nature).toBe('forbidden')
	})

	it('une absence de réponse est une panne de transport, jamais un refus', () => {
		expect(classerRefusValeur(undefined, 'Failed to fetch').nature).toBe('network')
	})

	it('un 400 qui n’est PAS `invalid_field_value` ne se fait pas passer pour lui', () => {
		// Le classement porte sur le `message`, identifiant stable de la migration `0013`, jamais
		// sur le `details`, qui est une phrase susceptible de changer sans préavis.
		expect(classerRefusValeur(400, 'invalid input syntax for type uuid').nature).toBe('unknown')
	})
})

describe('mise à jour du modèle après écriture (§4 bis.8)', () => {
	const modeleInitial = () =>
		composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' }],
			valeurs: [],
			etape: ETAPE,
		})

	it('renseigner un champ exigé le retire des clés manquantes, sans relecture', () => {
		const apres = appliquerEcriture(modeleInitial(), 'f-source', 'salon')
		expect(apres.clesManquantes).toEqual([])
		const resolu = apres.champs.find((champ) => champ.champ.id === 'f-source')
		expect(resolu?.renseigne).toBe(true)
		expect(resolu?.manquant).toBe(false)
	})

	it('vider un champ exigé le fait REVENIR dans les clés manquantes', () => {
		const renseigne = appliquerEcriture(modeleInitial(), 'f-source', 'salon')
		const vide = appliquerEcriture(renseigne, 'f-source', null)
		expect(vide.clesManquantes).toEqual(['source'])
	})

	it('« renseigné » est recalculé par le MÊME prédicat que la composition (§4.3)', () => {
		// Une chaîne de blancs est vide : si l'écriture recopiait un drapeau au lieu de recalculer,
		// le champ passerait pour renseigné et l'écran annoncerait passable une transition que la
		// garde refuse.
		const apres = appliquerEcriture(modeleInitial(), 'f-source', '   ')
		expect(apres.clesManquantes).toEqual(['source'])
	})

	it('la section repliée n’est pas touchée : aucun de ses champs n’est modifiable (§4 bis.1)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: [{ field_id: 'f-motif', step_id: ETAPE.id, visibility: 'hidden' }],
			valeurs: [{ field_id: 'f-motif', value: 'Budget gelé.' }],
			etape: ETAPE,
		})
		const apres = appliquerEcriture(modele, 'f-source', 'salon')
		expect(apres.autresEtapes).toEqual(modele.autresEtapes)
	})

	it('la visibilité ne dépend pas de la valeur, et ne bouge donc pas', () => {
		const apres = appliquerEcriture(modeleInitial(), 'f-source', 'salon')
		expect(apres.champs.find((champ) => champ.champ.id === 'f-source')?.visibilite).toBe('required')
	})
})

// @verifies CRM-037 (docs/BACKLOG.md) — reprise d'un déplacement refusé, quatrième destination
// @verifies docs/SPEC-form-composer.md §4 ter.2 (le transport est l'adresse), §4 ter.3 (la clé et
//           l'ordre), §4 ter.4 (rendu saisissable même si la règle le cache), §4 ter.7 (une clé
//           qui ne désigne rien est ignorée)
//
// Le jeu d'essai ci-dessus est **exactement** le cas mesuré sur la pile : `motif-perte` est
// `hidden` à l'étape courante et sans valeur, donc rendu NULLE PART par les trois destinations du
// §4.2 — et c'est le champ que `move_card` nomme dans dix des dix-neuf couples refusables du seed.
describe('les champs exigés par un déplacement refusé (§4 ter)', () => {
	it("sans `exiges`, rien ne change : un champ `hidden` et vide n'est rendu nulle part (§4.2)", () => {
		const modele = composer()
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('motif-perte')
		expect(modele.autresEtapes.map((resolu) => resolu.champ.key)).not.toContain('motif-perte')
		expect(modele.clesExigeesRetenues).toEqual([])
	})

	it('un champ `hidden` et vide, exigé par le déplacement, REJOINT le formulaire (§4 ter.4)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['motif-perte'],
		})
		const resolu = modele.champs.find((entree) => entree.champ.key === 'motif-perte')
		expect(resolu).toBeDefined()
		expect(resolu?.exigeParDeplacement).toBe(true)
		// Sa visibilité N'EST PAS réécrite : la règle de l'étape reste `hidden`, et c'est le chemin
		// d'arrivée qui le rend, pas une règle inventée. `manquant` garde donc la lecture du §4.4.
		expect(resolu?.visibilite).toBe('hidden')
		expect(resolu?.manquant).toBe(false)
		expect(modele.clesExigeesRetenues).toEqual(['motif-perte'])
	})

	it("le champ rejoint la liste à sa position naturelle, il ne remonte pas en tête (§4 ter.4)", () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['motif-perte'],
		})
		// `source` (position 2) précède `motif-perte` (position 4), qui précède `decideur-identifie`
		// (position 5) : la même fiche se lit pareil quel que soit le chemin par lequel on y arrive.
		expect(modele.champs.map((resolu) => resolu.champ.key)).toEqual([
			'source',
			'motif-perte',
			'decideur-identifie',
		])
	})

	it('un champ déjà visible qui est exigé porte les DEUX qualités, sans en perdre une (§4 ter.5)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['source'],
		})
		const resolu = modele.champs.find((entree) => entree.champ.key === 'source')
		expect(resolu?.visibilite).toBe('required')
		expect(resolu?.manquant).toBe(true)
		expect(resolu?.exigeParDeplacement).toBe(true)
	})

	it('un champ ARCHIVÉ reste hors du formulaire, même nommé par l’adresse (§4 ter.4)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['budget-previsionnel'],
		})
		expect(modele.champs.map((resolu) => resolu.champ.key)).not.toContain('budget-previsionnel')
		expect(modele.clesExigeesRetenues).toEqual([])
	})

	it('une clé qui ne désigne aucun champ est ignorée, sans erreur ni champ inventé (§4 ter.7)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['champ-qui-nexiste-pas'],
		})
		expect(modele.champs).toEqual(composer().champs)
		expect(modele.clesExigeesRetenues).toEqual([])
	})

	it('`clesExigeesRetenues` suit l’ordre du FORMULAIRE, pas celui de l’adresse (§4 ter.3)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			// L'adresse les donne à l'envers : le premier champ du défilement doit rester `source`.
			clesExigees: ['motif-perte', 'source'],
		})
		expect(modele.clesExigeesRetenues).toEqual(['source', 'motif-perte'])
	})

	it('une écriture ne retire pas l’exigence : elle vient du chemin, pas de la valeur (§4 ter.4)', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: REGLES,
			valeurs: [],
			etape: ETAPE,
			clesExigees: ['motif-perte'],
		})
		const apres = appliquerEcriture(modele, 'f-motif', 'Budget gelé.')
		const resolu = apres.champs.find((entree) => entree.champ.key === 'motif-perte')
		expect(resolu?.exigeParDeplacement).toBe(true)
		expect(resolu?.renseigne).toBe(true)
		expect(apres.clesExigeesRetenues).toEqual(['motif-perte'])
	})
})

// @verifies docs/SPEC-form-composer.md §4 ter.2 (l'adresse est un texte que l'on peut réécrire)
describe('lecture du paramètre `exiges` de l’adresse (§4 ter.2)', () => {
	it('sépare sur la virgule et retire les espaces', () => {
		expect(lireClesExigees(' budget , motif-perte ')).toEqual(['budget', 'motif-perte'])
	})

	it('écarte les entrées vides et les doublons, sans jamais échouer', () => {
		expect(lireClesExigees('budget,,budget, ,motif-perte')).toEqual(['budget', 'motif-perte'])
	})

	it('un paramètre absent ou vide ne demande rien', () => {
		expect(lireClesExigees(null)).toEqual([])
		expect(lireClesExigees(undefined)).toEqual([])
		expect(lireClesExigees('')).toEqual([])
		expect(lireClesExigees('  ,  ')).toEqual([])
	})
})
