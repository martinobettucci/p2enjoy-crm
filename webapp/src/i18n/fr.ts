// @spec CRM-007 (docs/BACKLOG.md) — dictionnaire des textes visibles
// @spec docs/DESIGN_SYSTEM.md §10 (internationalisation) ; docs/SPEC-webapp.md §10
//
// **Toute** chaîne visible de l'application est ici, et nulle part ailleurs. Les libellés
// métier — tracks, channels, nœuds, champs — sont des **données**, pas des traductions
// (docs/DESIGN_SYSTEM.md §10) : ils n'ont donc pas vocation à rejoindre ce fichier.
//
// Aucune bibliothèque d'internationalisation n'est ajoutée (docs/JOURNAL.md décision 43) :
// une clé inconnue ne compile pas, ce qu'aucun format de messages ne garantit.

export const fr = {
	'app.name': 'P2Enjoy CRM',

	// --- Navigation ---------------------------------------------------------------------
	'nav.aria': 'Navigation principale',
	'nav.sidebar.aria': 'Barre latérale',
	'nav.sidebar.collapse': 'Replier la barre latérale',
	'nav.sidebar.expand': 'Déplier la barre latérale',
	'nav.sidebar.open': 'Ouvrir la navigation',
	'nav.sidebar.close': 'Fermer la navigation',
	'nav.section.tracks': 'Tracks',
	'nav.item.board': 'Board',
	'nav.item.inbox': 'Inbox',
	'nav.item.today': 'Ma journée',
	'nav.item.settings': 'Réglages',

	'skip.toContent': 'Aller au contenu',

	// --- En-tête ------------------------------------------------------------------------
	'header.aria': "En-tête de l'application",
	'header.breadcrumb.aria': "Fil d'Ariane",
	'header.workspace.unknown': 'Aucun workspace accessible',
	'header.workspace.loading': 'Chargement du workspace',

	// --- Onglets ------------------------------------------------------------------------
	'tabs.aria': 'Channels du track courant',
	'tabs.empty': 'Aucun channel',
	'tabs.empty.hint': 'Les channels apparaîtront ici une fois un track ouvert.',

	// --- Tracks -------------------------------------------------------------------------
	// Les libellés des tracks eux-mêmes sont des **données** et ne passent pas par ce
	// dictionnaire (docs/DESIGN_SYSTEM.md §10). Seul le vide est un texte d'interface.
	'tracks.empty.title': 'Aucun track',

	// --- Routes -------------------------------------------------------------------------
	'route.board.title': 'Board',
	'route.board.empty.title': 'Aucun board à afficher',
	// Corrigé par `CRM-020`, sur observation d'une capture. Le texte précédent affirmait
	// « Aucun track n'est accessible » alors que la barre latérale en listait trois : l'écran se
	// contredisait lui-même. Ce qui manque réellement pour ouvrir un board, ce sont les channels.
	'route.board.empty.body':
		"Un board affiche les cards d'un channel. Aucun channel n'est disponible dans cet espace de travail.",
	'route.inbox.title': 'Inbox',
	'route.inbox.empty.title': 'Aucun message',
	'route.inbox.empty.body': "La messagerie n'est pas encore raccordée à cet espace de travail.",
	'route.today.title': 'Ma journée',
	'route.today.empty.title': 'Rien pour aujourd’hui',
	'route.today.empty.body': 'Les prochaines actions et les relances dues apparaîtront ici.',
	'route.settings.title': 'Réglages',
	'route.settings.empty.title': 'Aucun réglage modifiable',
	'route.settings.empty.body': "La configuration de l'instance est tenue par le fichier d'environnement du serveur.",
	'route.track.title': 'Track',
	'route.track.notfound.title': 'Track introuvable',
	'route.track.notfound.body':
		"Aucun track de cet espace de travail ne correspond à cette adresse, ou votre compte n'y a pas accès.",
	'route.track.nochannel.title': 'Aucun channel dans ce track',
	'route.track.nochannel.body':
		"Les channels d'un track s'administrent par l'API : aucun écran de création n'est encore livré.",
	'route.track.pickchannel.title': 'Choisissez un channel',
	'route.track.pickchannel.body': 'Les onglets ci-dessus ouvrent les channels de ce track.',
	'route.channel.empty.title': 'Aucune card dans ce channel',
	'route.channel.empty.body':
		'Le board et la vue liste de ce channel arrivent avec les cards.',
	'route.card.title': 'Card',
	'route.card.notfound.title': 'Card introuvable',
	'route.card.notfound.body':
		"Aucune card ne correspond à cette adresse, ou votre compte n'y a pas accès.",
	'route.card.nostep.title': 'Étape introuvable',
	'route.card.nostep.body':
		"Cette card désigne une étape que votre compte n'a pas le droit de lire : son formulaire ne peut pas être composé.",
	'route.notfound.title': 'Page introuvable',
	'route.notfound.body': "Cette adresse ne correspond à aucun écran de l'application.",
	'route.notfound.action': "Revenir à l'accueil",

	// --- Formulaire conditionnel (docs/SPEC-form-composer.md §4) ---------------------------
	'form.title': 'Formulaire de la card',
	'form.step.prefix': 'Étape courante :',
	'form.readonly':
		"Consultation seule : enregistrer une valeur exige une session, et aucun écran de connexion n'est encore livré.",
	'form.empty': 'Aucun champ à afficher pour cette étape.',
	'form.required.sr': '(champ requis)',
	'form.required.reason': 'Requis pour passer à',
	'form.missing': "Ce champ est requis et n'est pas renseigné.",
	'form.select.none': '— Aucun choix —',
	'form.other.summary': "Informations d'autres étapes",

	// --- États (docs/DESIGN_SYSTEM.md §5.8) ----------------------------------------------
	'state.loading.aria': 'Chargement en cours',
	'state.error.title': 'Chargement impossible',
	'state.error.network': "Le serveur n'a pas répondu. Vérifiez que l'instance est démarrée, puis réessayez.",
	'state.error.unknown': "Une erreur inattendue s'est produite pendant le chargement.",
	'state.error.retry': 'Réessayer',
	'state.forbidden.title': 'Accès refusé',
	'state.forbidden.body': "Votre compte n'a pas les droits nécessaires sur cette ressource. Demandez l'accès à un administrateur de l'espace de travail.",

	// --- Configuration ------------------------------------------------------------------
	'config.error.title': 'Configuration incomplète',
	'config.error.body':
		"L'application n'a pas reçu l'adresse de l'API ou sa clé publique. Elle ne peut donc joindre aucun serveur.",
	'config.error.detail': 'Variables attendues au build : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.',

	// --- Région d'annonces (docs/DESIGN_SYSTEM.md §8) ------------------------------------
	'live.aria': 'Annonces',
	'live.workspaces.loaded': 'Espaces de travail chargés',
	'live.workspaces.empty': 'Aucun espace de travail accessible',
	'live.workspaces.error': 'Le chargement des espaces de travail a échoué',
	'live.tracks.loaded': 'Tracks chargés',
	'live.tracks.empty': 'Aucun track accessible',
	'live.tracks.error': 'Le chargement des tracks a échoué',
} as const

export type CleTraduction = keyof typeof fr
