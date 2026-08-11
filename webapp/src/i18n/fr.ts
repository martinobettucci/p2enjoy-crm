// @spec CRM-007 (docs/BACKLOG.md) — dictionnaire des textes visibles
// @spec CRM-009 (docs/BACKLOG.md) — textes de connexion, session et déconnexion
// @spec CRM-022 (docs/BACKLOG.md) — noms, avatars, responsables, auteurs et acteurs
// @spec docs/DESIGN_SYSTEM.md §5.12, §10 ; docs/SPEC-auth.md §9 ; docs/SPEC-webapp.md §10
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
	'header.auth.login': 'Se connecter',
	'header.auth.logout': 'Se déconnecter',
	'header.auth.logout.error': "La déconnexion n'a pas abouti. Réessayez.",
	'identity.owner.aria': 'Responsable : {nom}',

	// --- Authentification ---------------------------------------------------------------
	'auth.route.title': 'Se connecter',
	'auth.intro': "L'accès est réservé aux membres invités de votre espace de travail.",
	'auth.email.label': 'Adresse email',
	'auth.email.placeholder': 'prenom@entreprise.fr',
	'auth.password.label': 'Mot de passe',
	'auth.submit': 'Se connecter',
	'auth.submitting': 'Connexion…',
	'auth.error.credentials': "L'adresse email ou le mot de passe est incorrect.",
	'auth.error.network': "Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez.",
	'auth.error.configuration': "L'application n'est pas configurée pour joindre le serveur.",
	'auth.loading': 'Restauration de votre session',

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
	// L'état vide « la messagerie n'est pas encore raccordée » de `CRM-007` est RETIRÉ : il ne
	// décrivait plus rien depuis que `CRM-057` livre l'écran, et une clé qui ment est pire qu'une
	// clé absente. Les états vides de l'inbox sont désormais ceux de chaque panneau.

	// --- Inbox globale — CRM-057, docs/DESIGN_SYSTEM.md §5.4 -----------------------------
	'inbox.folders.aria': 'Dossiers de la messagerie',
	'inbox.folders.title': 'Dossiers',
	'inbox.folders.unclassified': 'Non classés',
	'inbox.folders.empty.title': 'Aucun courrier rangé',
	'inbox.folders.empty.body': "Les messages classés dans une affaire apparaîtront ici, sous leur track.",
	'inbox.folders.expand': 'Déplier',
	'inbox.folders.collapse': 'Replier',
	'inbox.list.aria': 'Messages du dossier',
	'inbox.list.title': 'Messages',
	'inbox.list.empty.title': 'Aucun message dans ce dossier',
	'inbox.list.empty.body': 'Rien à trier ici pour le moment.',
	'inbox.list.truncated': 'Seuls les 50 messages les plus récents sont affichés.',
	'inbox.list.unselected.title': 'Choisissez un dossier',
	'inbox.list.unselected.body': 'La liste des messages apparaîtra ici.',
	'inbox.message.title': 'Message',
	'inbox.message.unselected.title': 'Aucun message ouvert',
	'inbox.message.unselected.body': 'Choisissez un message dans la liste pour le lire.',
	'inbox.message.from': 'De',
	'inbox.message.to': 'À',
	'inbox.message.cc': 'Copie',
	'inbox.message.received': 'Reçu le',
	'inbox.message.empty.body': 'Ce message ne comporte aucun texte.',
	// Le corps réduit depuis du HTML est ANNONCÉ : l'utilisateur doit savoir que la mise en forme
	// de l'expéditeur n'est pas affichée, et pourquoi (§18.4).
	'inbox.message.reduced': 'Mise en forme retirée : ce message est affiché en texte seul.',
	'inbox.message.card': 'Classé dans',
	'inbox.message.unclassified': 'Ce message n’est classé dans aucune affaire.',
	'inbox.attachments.title': 'Pièces jointes',
	'inbox.attachments.download': 'Télécharger',
	'inbox.attachments.status.pending': 'en cours d’analyse',
	'inbox.attachments.status.infected': 'écartée par l’antivirus',
	'inbox.attachments.status.skipped': 'non analysée',
	'inbox.attachments.status.unknown': 'statut d’analyse inconnu',
	'inbox.attachments.unavailable': 'Le lien de téléchargement n’a pas pu être obtenu.',
	'inbox.classify.open': 'Classer dans une affaire',
	'inbox.classify.label': 'Affaire de destination',
	'inbox.classify.submit': 'Classer',
	'inbox.classify.cancel': 'Annuler',
	'inbox.classify.working': 'Classement…',
	'inbox.classify.empty': 'Aucune affaire modifiable dans cet espace de travail.',
	'inbox.classify.done': 'Message classé.',
	'inbox.classify.refus.forbidden': 'Vous ne pouvez pas classer ce message dans cette affaire.',
	'inbox.classify.refus.card_indisponible': 'Cette affaire est archivée ou en corbeille : elle ne reçoit pas de courrier.',
	'inbox.classify.refus.network': "Le classement n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
	'inbox.classify.refus.unknown': "Le classement n'a pas abouti.",
	'inbox.error.title': 'Messagerie indisponible',
	'inbox.back.folders': 'Retour aux dossiers',
	'inbox.back.list': 'Retour aux messages',
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
		"Les affaires s'y créent par l'API : aucun écran de création n'est encore livré.",
	'route.channel.noworkflow.title': 'Aucun workflow sur ce channel',
	'route.channel.noworkflow.body':
		"Un board a besoin des étapes d'un workflow : ce channel n'en désigne aucun que votre compte puisse lire.",
	'route.channel.nostep.title': 'Ce workflow ne déclare aucune étape',
	'route.channel.nostep.body':
		"Un board sans étape n'a aucune colonne. Les étapes d'un workflow s'administrent par l'API.",
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
		"Consultation seule : l'enregistrement des réponses n'est pas encore livré dans cette fiche.",
	'form.empty': 'Aucun champ à afficher pour cette étape.',
	'form.required.sr': '(champ requis)',
	'form.required.reason': 'Requis pour passer à',
	'form.missing': "Ce champ est requis et n'est pas renseigné.",
	'form.select.none': '— Aucun choix —',
	'form.other.summary': "Informations d'autres étapes",

	// --- Board kanban (docs/SPEC-workflow-engine.md §7) ------------------------------------
	'board.aria': 'Board du channel',
	'board.column.empty': 'Aucune affaire à cette étape.',
	'board.age.days': 'j dans cette étape',
	'board.menu.open': 'Déplacer',
	'board.menu.none': 'Aucun déplacement déclaré depuis cette étape',
	// Clé **paramétrée** : le repli du libellé d'une transition nomme son étape d'arrivée sans que
	// le composant construise la phrase (docs/SPEC-workflow-engine.md §7.5, CLAUDE.md §23).
	'board.transition.fallback': 'Passer à {etape}',
	'board.comment.label': 'Motif exigé pour passer à',
	'board.comment.notstored':
		"Ce motif est exigé pour valider le déplacement. Il n'est pas encore conservé : l'historique des affaires arrive avec les commentaires.",
	'board.comment.submit': 'Déplacer',
	'board.comment.cancel': 'Annuler',
	'board.refusal.dismiss': 'Fermer',
	'board.refusal.card_not_found':
		"Cette affaire n'est plus accessible. Rechargez le board pour voir son état réel.",
	'board.refusal.forbidden': "Votre compte n'a pas le droit d'écrire dans ce channel.",
	'board.refusal.step_not_in_workflow':
		"Cette étape n'appartient pas au workflow de l'affaire.",
	'board.refusal.transition_not_allowed':
		"Ce déplacement n'est pas déclaré dans le workflow de l'affaire.",
	'board.refusal.comment_required': 'Ce déplacement exige un motif.',
	'board.refusal.missing_required_fields':
		"Ces questions doivent avoir une réponse avant d'entrer dans cette étape :",
	'board.refusal.anonyme':
		'Déplacer une affaire exige une session. Connectez-vous, puis réessayez.',
	'board.refusal.unknown': 'Le serveur a refusé ce déplacement sans motif connu de cet écran :',

	// --- Vue liste (docs/SPEC-cards.md §12) ------------------------------------------------
	'liste.aria': 'Affaires du channel',
	'liste.vue.aria': 'Vue du channel',
	'liste.vue.board': 'Tableau',
	'liste.vue.liste': 'Liste',
	'liste.filtres.aria': 'Filtres de la liste',
	'liste.filtre.etape': 'Étape',
	'liste.filtre.etape.toutes': 'Toutes les étapes',
	'liste.filtre.recherche': 'Rechercher une affaire',
	'liste.filtre.recherche.submit': 'Rechercher',
	'liste.filtre.effacer': 'Effacer les filtres',
	'liste.colonne.title': 'Affaire',
	'liste.colonne.owner': 'Responsable',
	'liste.colonne.etape': 'Étape',
	'liste.colonne.amount': 'Montant',
	'liste.colonne.next_action': 'Prochaine action',
	'liste.colonne.next_action_at': 'Échéance',
	// Paramétrée, jamais construite par concaténation (CLAUDE.md §23, décision 180).
	'liste.tri.aria': 'Trier par {colonne}',
	'liste.total': 'Affaires : {total}',
	'liste.page.position': 'Page {rang} sur {pages}',
	'liste.page.precedente': 'Page précédente',
	'liste.page.suivante': 'Page suivante',
	'liste.empty.title': 'Aucune affaire dans ce channel',
	'liste.empty.body':
		"Les affaires s'y créent par l'API : aucun écran de création n'est encore livré.",
	'liste.filtered.title': 'Aucune affaire ne correspond',
	'liste.filtered.body':
		'Aucune affaire de ce channel ne répond aux filtres appliqués. Effacez-les pour revoir la liste entière.',
	'liste.gone.title': "Cette page n'existe plus",
	'liste.gone.body':
		"Le nombre d'affaires a diminué depuis l'ouverture de cette page : le rang demandé dépasse désormais la dernière page.",
	'liste.gone.action': 'Revenir à la première page',

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

	// --- Panneau de commentaires — CRM-043, docs/DESIGN_SYSTEM.md §5.10 ------------------
	'comments.title': 'Historique et discussion',
	'comments.aria': 'Fil de cette affaire',
	'comments.empty.title': 'Aucun événement pour le moment',
	'comments.empty.body': 'Cette affaire n’a encore aucune histoire à raconter.',
	'timeline.filters.aria': 'Filtres du fil',
	'timeline.filter.discussion': 'Discussion',
	'timeline.filter.etapes': 'Étapes',
	'timeline.filter.champs': 'Champs',
	'timeline.filter.organisation': 'Organisation',
	'timeline.filter.cycle': 'Cycle de vie',
	'timeline.filtered.title': 'Aucun élément pour ces filtres',
	'timeline.filtered.body': 'Réactivez une famille pour revoir le fil complet.',
	'timeline.event.created': 'Affaire créée',
	'timeline.event.moved': 'Étape franchie',
	'timeline.event.channel_changed': 'Dossier changé',
	'timeline.event.workflow_changed': 'Workflow modifié',
	'timeline.event.assigned': 'Responsable modifié',
	'timeline.event.archived': 'Affaire archivée',
	'timeline.event.unarchived': 'Affaire désarchivée',
	'timeline.event.trashed': 'Affaire mise à la corbeille',
	'timeline.event.restored': 'Affaire restaurée',
	'timeline.event.field_changed': 'Champ renseigné',
	'timeline.event.mail_received': 'Message reçu',
	'timeline.event.unknown': 'Événement',
	// Le fil nomme le courrier qu'il annonce — un événement qui ne dit pas de quel message il
	// parle n'est pas une mémoire (docs/SPEC-mail-subsystem.md §18.6).
	'timeline.mail.summary': '{objet} — de {expediteur}',
	'comments.error.title': 'Discussion indisponible',
	'comments.deleted': 'Commentaire supprimé',
	'comments.author.deleted': 'Compte supprimé',
	'comments.author.unavailable': 'Auteur indisponible',
	'comments.edited': 'modifié',
	'comments.edited.title': 'Modifié le',
	'comments.compose.label': 'Votre commentaire',
	'comments.compose.placeholder': 'Écrire un commentaire…',
	'comments.compose.submit': 'Publier',
	'comments.compose.sending': 'Publication…',
	'comments.refus.forbidden': "Vous ne pouvez pas commenter cette affaire. Votre texte est conservé ci-dessus.",
	'comments.refus.invalide': 'Un commentaire ne peut être vide ni dépasser 10 000 caractères.',
	'comments.refus.network': "Le commentaire n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
	'comments.refus.unknown': "Le commentaire n'a pas pu être publié.",
	'comments.refus.supprime': 'Ce commentaire a été supprimé : il ne peut plus être modifié.',
	// Actions de l'auteur — docs/DESIGN_SYSTEM.md §5.10. Le libellé de suppression nomme le
	// caractère irréversible du geste plutôt que de le laisser à la confirmation seule.
	'comments.action.edit': 'Modifier',
	'comments.action.delete': 'Supprimer',
	'comments.edit.label': 'Corriger votre commentaire',
	'comments.edit.save': 'Enregistrer',
	'comments.edit.saving': 'Enregistrement…',
	'comments.edit.cancel': 'Annuler',
	'comments.delete.confirm.title': 'Supprimer ce commentaire ?',
	'comments.delete.confirm.body':
		'Le texte sera définitivement effacé. La place du commentaire reste visible dans le fil.',
	'comments.delete.confirm.action': 'Supprimer définitivement',
	'comments.delete.confirm.cancel': 'Conserver',
	'comments.delete.deleting': 'Suppression…',
	'comments.geste.sans-effet':
		"Ce commentaire n'est plus le vôtre, ou vous n'écrivez plus sur cette affaire : rien n'a été modifié.",
	'timeline.actor': 'par {nom}',

	// --- Région d'annonces (docs/DESIGN_SYSTEM.md §8) ------------------------------------
	'live.aria': 'Annonces',
	'live.workspaces.loaded': 'Espaces de travail chargés',
	'live.workspaces.empty': 'Aucun espace de travail accessible',
	'live.workspaces.error': 'Le chargement des espaces de travail a échoué',
	'live.tracks.loaded': 'Tracks chargés',
	'live.tracks.empty': 'Aucun track accessible',
	'live.tracks.error': 'Le chargement des tracks a échoué',
	'live.liste.aria': 'Annonces de la liste',
	'live.liste.loaded': 'Liste des affaires mise à jour',
	'live.board.aria': 'Annonces du board',
	'live.board.moved': 'Affaire déplacée vers',
	'live.board.refused': 'Déplacement refusé',
	'live.comments.aria': 'Annonces de la discussion',
	'live.comments.published': 'Commentaire publié',
	'live.comments.edited': 'Commentaire modifié',
	'live.comments.deleted': 'Commentaire supprimé',
} as const

export type CleTraduction = keyof typeof fr
