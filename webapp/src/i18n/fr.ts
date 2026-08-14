// @spec CRM-007 (docs/BACKLOG.md) — dictionnaire des textes visibles
// @spec CRM-009 (docs/BACKLOG.md) — textes de connexion, session et déconnexion
// @spec CRM-022 (docs/BACKLOG.md) — noms, avatars, responsables, auteurs et acteurs
// @spec CRM-075 (docs/BACKLOG.md) — textes de l'administration de l'arborescence
// @spec docs/DESIGN_SYSTEM.md §5.12, §5.13, §10 ; docs/SPEC-auth.md §9 ; docs/SPEC-webapp.md §10
// @spec docs/SPEC-administration-arborescence.md §9 (chaque refus a son texte)
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
	// --- Composition et réponse — CRM-058, docs/SPEC-mail-subsystem.md §19.6 --------------
	'envoi.open': 'Écrire un message',
	'envoi.reply': 'Répondre',
	'envoi.identity': 'Expédier depuis',
	'envoi.identity.empty': "Aucune adresse d'expédition ne vous est attribuée.",
	'envoi.to': 'Destinataires',
	'envoi.to.placeholder': 'adresse@exemple.fr, autre@exemple.fr',
	'envoi.subject': 'Objet',
	'envoi.body': 'Message',
	'envoi.submit': 'Mettre en file',
	'envoi.sending': 'Mise en file…',
	'envoi.cancel': 'Annuler',
	// « MIS EN FILE », ET NON « ENVOYÉ » : le worker n'a pas encore parlé, et annoncer une remise
	// qui n'a pas eu lieu serait une simulation de succès.
	'envoi.file': 'Message mis en file : il partira à la prochaine passe d’envoi.',
	'envoi.file.aria': 'Confirmation d’envoi',
	'envoi.replyto.hint': "Les réponses reviendront dans cette affaire, quelle que soit l'adresse de votre correspondant.",
	'envoi.refus.forbidden': "Vous ne pouvez pas écrire au nom de cette affaire, ou emprunter cette adresse d'expédition.",
	'envoi.refus.invalide': "Cette affaire ne peut pas recevoir de réponse, ou le message n'a pas de destinataire.",
	'envoi.refus.quota': "Cette adresse d'expédition a atteint son plafond du jour.",
	'envoi.refus.network': "Le message n'a pas pu être mis en file. Vérifiez votre connexion, puis réessayez.",
	'envoi.refus.unknown': "Le message n'a pas pu être mis en file.",
	'envoi.refus.incomplet': 'Choisissez une adresse d’expédition, au moins un destinataire, et écrivez un message.',

	'inbox.error.title': 'Messagerie indisponible',
	'inbox.back.folders': 'Retour aux dossiers',
	'inbox.back.list': 'Retour aux messages',
	'route.today.title': 'Ma journée',
	'route.today.empty.title': 'Rien pour aujourd’hui',
	'route.today.empty.body': 'Les prochaines actions et les relances dues apparaîtront ici.',
	'route.settings.title': 'Réglages',
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
	// Le second `P0001` du trigger, distingué du premier (décision 376). Le message dit ce que
	// l'appelant PEUT faire, et non seulement ce qui lui est refusé : un modérateur bloqué sans
	// autre indication chercherait la panne là où il n'y en a pas.
	'comments.refus.moderation':
		"Le commentaire d'une autre personne ne peut pas être modifié. Vous pouvez seulement le retirer.",
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
	// Modération — docs/DESIGN_SYSTEM.md §5.10, docs/SPEC-cards.md §13.6. Le libellé de l'action est
	// celui de l'auteur : c'est le MÊME geste, et lui inventer un mot de métier — « modérer »,
	// « retirer » — obligerait l'utilisateur à deviner qu'ils désignent la même chose. La
	// confirmation, elle, est DISTINCTE : elle nomme le propriétaire du propos et la trace laissée.
	'comments.moderation.confirm.title': 'Retirer le commentaire d’une autre personne ?',
	'comments.moderation.confirm.body':
		'Le texte sera définitivement effacé et la place du commentaire restera visible dans le fil. '
		+ 'Ce retrait sera enregistré sous votre nom.',
	'comments.moderation.confirm.action': 'Retirer définitivement',
	// La pierre tombale d'un retrait par un tiers, distinguée de celle d'une suppression par
	// l'auteur. Le NOM du modérateur n'est pas nommé — docs/SPEC-cards.md §13.13, point 7.
	'comments.deleted.moderation': 'Commentaire retiré par la modération',
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
	'live.comments.moderated': 'Commentaire retiré',

	// --- Administration de l'arborescence — CRM-075 --------------------------------------
	// docs/SPEC-administration-arborescence.md, docs/DESIGN_SYSTEM.md §5.13.
	'admin.settings.index.title': 'Sections de réglages',
	'admin.settings.index.tree': "Arborescence : tracks et channels",
	'admin.settings.index.tree.body':
		"Créer, renommer, réordonner et archiver les tracks et les channels de l'espace de travail.",
	'admin.settings.instance':
		"La configuration de l'instance elle-même reste tenue par le fichier d'environnement du serveur.",

	'admin.tree.title': "Administration de l'arborescence",
	'admin.tree.aria': "Tracks et channels de l'espace de travail",
	'admin.tree.showArchived': 'Afficher les archivés',
	'admin.tree.archived': 'Archivé',
	'admin.tree.channels.aria': 'Channels du track {track}',

	'admin.tree.empty.title': 'Aucun track dans cet espace de travail',
	'admin.tree.empty.body':
		'Un track regroupe des channels, qui portent les affaires. Créez le premier pour commencer.',
	'admin.tree.error.title': "L'arborescence n'a pas pu être chargée",
	'admin.tree.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.tree.error.retry': 'Réessayer',
	'admin.tree.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.tree.noWorkspace.body':
		"Sans espace de travail, il n'y a pas d'arborescence à administrer.",

	'admin.tree.channels.empty': "Ce track n'a aucun channel.",
	'admin.tree.channels.error': 'Les channels de ce track n’ont pas pu être chargés.',

	// Commandes de ligne.
	'admin.action.expand': 'Déplier {nom}',
	'admin.action.collapse': 'Replier {nom}',
	'admin.action.up': 'Monter {nom}',
	'admin.action.down': 'Descendre {nom}',
	'admin.action.rename': 'Modifier {nom}',
	'admin.action.archive': 'Archiver {nom}',
	'admin.action.unarchive': 'Désarchiver {nom}',
	'admin.action.newTrack': 'Nouveau track',
	'admin.action.newChannel': 'Nouveau channel',
	'admin.action.save': 'Enregistrer',
	'admin.action.create': 'Créer',
	'admin.action.cancel': 'Annuler',

	'admin.move.disabled.top': 'Déjà en tête de liste',
	'admin.move.disabled.bottom': 'Déjà en fin de liste',
	'admin.move.impossible':
		"Ce déplacement n'aurait aucun effet visible : deux positions voisines sont indistinctes. Le réordonnancement demande une renumérotation, qui n'est pas encore livrée.",

	// Formulaires.
	'admin.form.track.create': 'Nouveau track',
	'admin.form.track.edit': 'Modifier le track',
	'admin.form.channel.create': 'Nouveau channel',
	'admin.form.channel.edit': 'Modifier le channel',
	'admin.form.name': 'Nom',
	'admin.form.slug': 'Slug',
	'admin.form.slug.help': "Identifiant d'URL : minuscules, chiffres et tirets.",
	'admin.form.slug.invalid':
		'Ce slug ne respecte pas la forme attendue : minuscules, chiffres et tirets simples.',
	'admin.form.slug.locked':
		"Le slug ne se modifie pas depuis cet écran : c'est l'adresse partageable du track.",
	'admin.form.color': 'Couleur',
	'admin.form.icon': 'Icône',
	'admin.form.description': 'Description',
	'admin.form.workflow': 'Workflow',
	'admin.form.workflow.choose': 'Choisir un workflow…',
	'admin.form.workflow.default': '{nom} (par défaut)',
	'admin.form.workflow.none':
		"Aucun workflow n'est affectable à ce track. Un channel doit en suivre un ; créez d'abord un workflow global ou propre à ce track.",
	'admin.form.workflow.loading': 'Chargement des workflows…',

	// Confirmation d'archivage (docs/DESIGN_SYSTEM.md §6).
	'admin.archive.confirm.track': 'Archiver le track « {nom} » ?',
	'admin.archive.confirm.channel': 'Archiver le channel « {nom} » ?',
	'admin.archive.confirm.body':
		"Il sera masqué des écrans, sans être supprimé, et pourra être désarchivé. Les channels d'un track archivé ne sont pas archivés avec lui.",
	'admin.archive.confirm.action': 'Archiver',

	// Refus (docs/SPEC-administration-arborescence.md §9).
	'admin.refus.forbidden':
		"Seul un administrateur de cet espace de travail peut modifier l'arborescence.",
	'admin.refus.slug-pris': 'Ce slug est déjà utilisé.',
	'admin.refus.workflow-hors-track': "Ce workflow n'est pas affectable à ce track.",
	'admin.refus.forme-refusee': 'Cette valeur a été refusée : vérifiez le nom et le slug.',
	'admin.refus.reference-absente':
		"Ce track n'existe plus, ou n'appartient pas à cet espace de travail.",
	'admin.refus.network': "La requête n'a pas abouti. Réessayez.",
	'admin.refus.unknown': "L'enregistrement a échoué.",
	'admin.refus.sans-effet':
		"Rien n'a été modifié : vous n'avez plus le droit d'écrire sur cet objet, ou il a disparu.",

	'live.admin.aria': "Annonces de l'administration",
	'live.admin.created': 'Créé',
	'live.admin.updated': 'Modifié',
	'live.admin.moved': 'Déplacé',
	'live.admin.archived': 'Archivé',
	'live.admin.unarchived': 'Désarchivé',

	// --- Éditeur de workflows — CRM-076, docs/SPEC-workflow-engine.md §7 bis ---------------
	'admin.settings.index.workflows': 'Workflows : étapes et composition',
	'admin.settings.index.workflows.body':
		"Composer un workflow : choisir ses étapes dans le catalogue, les ordonner, surcharger leur libellé, leur probabilité et leur seuil de relance, désigner l'étape initiale, et déclarer les transitions qui relient les étapes.",
	'admin.workflows.title': 'Éditeur de workflows',
	'admin.workflows.aria': "Workflows de l'espace de travail",
	'admin.workflows.list.aria': 'Choisir un workflow',
	'admin.workflows.steps.aria': 'Étapes de {workflow}',
	'admin.workflows.default': 'Par défaut',
	'admin.workflows.scope.global': 'Global',
	'admin.workflows.scope.track': 'Propre à un track',
	'admin.workflows.empty.title': "Aucun workflow dans cet espace de travail",
	'admin.workflows.empty.body':
		"Un workflow se crée par l'API ou par la copie vers un track ; cet écran compose les workflows existants.",
	'admin.workflows.error.title': "Les workflows n'ont pas pu être chargés",
	'admin.workflows.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.workflows.choose.title': 'Choisissez un workflow',
	'admin.workflows.choose.body': 'Ses étapes apparaîtront ici, dans leur ordre.',
	'admin.workflows.steps.empty': "Ce workflow n'a aucune étape.",
	'admin.workflows.steps.empty.hint':
		"Ajoutez une première étape depuis le catalogue : elle deviendra l'étape initiale si vous la désignez.",
	'admin.workflows.steps.error': 'Les étapes de ce workflow n’ont pas pu être chargées.',
	'admin.workflows.initial': 'Étape initiale',
	'admin.workflows.initial.none':
		"Ce workflow n'a aucune étape initiale : aucune card ne peut y entrer tant qu'elle n'est pas désignée.",
	'admin.workflows.overridden': 'Libellé surchargé',
	'admin.workflows.fromCatalog': 'Du catalogue : {libelle}',
	'admin.workflows.probability': 'Probabilité : {valeur} %',
	'admin.workflows.probability.default': 'Probabilité du catalogue',
	'admin.workflows.stale': 'Relance après {valeur} j',
	'admin.workflows.stale.default': 'Seuil du catalogue',

	'admin.workflows.action.add': 'Ajouter une étape',
	'admin.workflows.action.addNode': 'Ajouter {nom}',
	'admin.workflows.action.override': 'Surcharger {nom}',
	'admin.workflows.action.setInitial': 'Désigner {nom} comme étape initiale',
	'admin.workflows.action.remove': 'Retirer {nom}',
	'admin.workflows.catalogue.title': 'Nœuds ajoutables',
	'admin.workflows.catalogue.empty':
		'Tous les nœuds actifs du catalogue sont déjà des étapes de ce workflow.',
	'admin.workflows.catalogue.loading': 'Chargement du catalogue…',
	'admin.workflows.catalogue.error': 'Le catalogue n’a pas pu être chargé.',

	'admin.workflows.form.override': 'Surcharges de {nom}',
	'admin.workflows.form.label': 'Libellé surchargé',
	'admin.workflows.form.label.help':
		'Laisser vide reprend le libellé du catalogue. Une valeur blanche est refusée.',
	'admin.workflows.form.probability': 'Probabilité (%)',
	'admin.workflows.form.probability.help':
		'De 0 à 100. Laisser vide reprend la probabilité du catalogue ; 0 est une valeur, pas une absence.',
	'admin.workflows.form.probability.invalid': 'La probabilité doit être comprise entre 0 et 100.',
	'admin.workflows.form.stale': 'Seuil de relance (jours)',
	'admin.workflows.form.stale.help':
		'Nombre entier de jours, strictement positif. Laisser vide reprend le seuil du catalogue.',
	'admin.workflows.form.stale.invalid':
		'Le seuil de relance doit être un nombre entier de jours strictement positif.',

	'admin.workflows.remove.confirm': 'Retirer l’étape « {nom} » ?',
	'admin.workflows.remove.confirm.body':
		"Elle est retirée du workflow, et le nœud reste au catalogue. Une étape occupée par des cards ne peut pas être retirée : la base le refuse.",
	'admin.workflows.remove.confirm.action': 'Retirer',

	'admin.workflows.refus.forbidden':
		'Seul un administrateur de cet espace de travail peut composer un workflow.',
	'admin.workflows.refus.noeud-deja-employe': 'Ce nœud est déjà une étape de ce workflow.',
	'admin.workflows.refus.etape-occupee':
		"Cette étape porte des affaires : elle ne peut pas être retirée tant qu'elles l'occupent.",
	'admin.workflows.refus.reference-absente':
		"Ce workflow ou ce nœud n'existe plus, ou n'appartient pas à cet espace de travail.",
	'admin.workflows.refus.forme-refusee':
		'Cette valeur a été refusée : vérifiez le libellé, la probabilité et le seuil.',
	'admin.workflows.refus.network': "La requête n'a pas abouti. Réessayez.",
	'admin.workflows.refus.unknown': "L'enregistrement a échoué.",

	// --- Les arêtes du graphe — deuxième tranche, docs/SPEC-workflow-engine.md §7 bis.9 -----
	'admin.workflows.transitions.aria': 'Transitions de {workflow}',
	'admin.workflows.transitions.title': 'Transitions déclarées',
	'admin.workflows.transitions.intro':
		"Une card ne peut aller que là où une transition la mène. Une étape sans sortie est un point d'arrivée.",
	'admin.workflows.transitions.loading': 'Chargement des transitions…',
	'admin.workflows.transitions.error': 'Les transitions de ce workflow n’ont pas pu être chargées.',
	'admin.workflows.transitions.none': 'Aucune sortie : les cards s’y arrêtent.',
	'admin.workflows.transitions.toward': 'Vers {arrivee}',
	'admin.workflows.transitions.label.default': 'Libellé de l’étape d’arrivée',
	'admin.workflows.transitions.requireComment': 'Motif exigé',
	'admin.workflows.transitions.tooFewSteps':
		'Une transition relie deux étapes : ajoutez-en une seconde avant d’en déclarer une.',

	'admin.workflows.transitions.action.declare': 'Déclarer une transition',
	'admin.workflows.transitions.action.edit': 'Modifier la transition {depart} vers {arrivee}',
	'admin.workflows.transitions.action.remove': 'Retirer la transition {depart} vers {arrivee}',

	'admin.workflows.transitions.form.declare': 'Nouvelle transition',
	'admin.workflows.transitions.form.edit': 'Transition {depart} vers {arrivee}',
	'admin.workflows.transitions.form.from': 'Étape de départ',
	'admin.workflows.transitions.form.to': 'Étape d’arrivée',
	'admin.workflows.transitions.form.to.empty':
		'Toutes les arrivées possibles depuis cette étape sont déjà déclarées.',
	'admin.workflows.transitions.form.label': 'Libellé du bouton',
	'admin.workflows.transitions.form.label.help':
		'Laisser vide affiche le libellé de l’étape d’arrivée dans le menu d’une card. Une valeur blanche est refusée.',
	'admin.workflows.transitions.form.label.invalid': 'Le libellé ne peut pas être blanc.',
	'admin.workflows.transitions.form.requireComment': 'Exiger un motif',
	'admin.workflows.transitions.form.requireComment.help':
		'Le déplacement d’une card par cette transition sera refusé sans commentaire.',

	'admin.workflows.transitions.remove.confirm': 'Retirer la transition {depart} vers {arrivee} ?',
	'admin.workflows.transitions.remove.confirm.body':
		'Les cards ne pourront plus emprunter ce chemin. Les deux étapes restent dans le workflow.',
	'admin.workflows.transitions.remove.confirm.action': 'Retirer la transition',

	'admin.workflows.refus.arete-deja-declaree': 'Cette transition est déjà déclarée.',
	'admin.workflows.refus.transition.reference-absente':
		'Une des deux étapes n’existe plus dans ce workflow.',
	'admin.workflows.refus.transition.forme-refusee':
		'Cette transition a été refusée : une étape ne va pas vers elle-même, et un libellé fourni ne peut pas être blanc.',
	'admin.workflows.refus.sans-effet':
		"Rien n'a été modifié : vous n'avez plus le droit d'écrire sur ce workflow, ou l'étape a disparu.",

	'live.workflows.added': 'Étape ajoutée',
	'live.workflows.moved': 'Étape déplacée',
	'live.workflows.overridden': 'Surcharges enregistrées',
	'live.workflows.initial': 'Étape initiale désignée',
	'live.workflows.removed': 'Étape retirée',
	'live.workflows.transition.declared': 'Transition déclarée',
	'live.workflows.transition.updated': 'Transition modifiée',
	'live.workflows.transition.removed': 'Transition retirée',

	// --- Les champs du formulaire — troisième tranche, docs/SPEC-workflow-engine.md §7 bis.10 ---
	'admin.workflows.fields.aria': 'Champs du formulaire de {workflow}',
	'admin.workflows.fields.title': 'Champs du formulaire',
	'admin.workflows.fields.intro':
		'Les questions posées sur chaque affaire de ce workflow. Leur visibilité étape par étape n’est pas encore réglable depuis cet écran.',
	'admin.workflows.fields.loading': 'Chargement des champs…',
	'admin.workflows.fields.error': 'Les champs de ce workflow n’ont pas pu être chargés.',
	'admin.workflows.fields.empty': 'Aucun champ dans ce formulaire',
	'admin.workflows.fields.empty.hint':
		'Les affaires de ce workflow n’ont aucune question à renseigner. Déclarez un premier champ pour en poser une.',
	'admin.workflows.fields.archived': 'Archivé',

	'admin.workflows.fields.action.declare': 'Déclarer un champ',
	'admin.workflows.fields.action.edit': 'Modifier le champ {nom}',
	'admin.workflows.fields.action.archive': 'Archiver le champ {nom}',
	'admin.workflows.fields.action.restore': 'Restaurer le champ {nom}',

	'admin.workflows.fields.form.declare': 'Nouveau champ',
	'admin.workflows.fields.form.edit': 'Champ « {nom} »',
	'admin.workflows.fields.form.key': 'Clé',
	'admin.workflows.fields.form.key.help':
		'Minuscules, chiffres et tirets simples. Elle identifie le champ dans les exports et les messages d’erreur, et ne se modifie plus ensuite.',
	'admin.workflows.fields.form.key.invalid':
		'La clé n’accepte que des minuscules, des chiffres et des tirets simples, sans tiret au début ni à la fin.',
	'admin.workflows.fields.form.key.frozen':
		'Clé : {cle}. Elle ne se modifie pas : les exports et les messages d’erreur la citent. Archivez ce champ et redéclarez-en un pour en changer.',
	'admin.workflows.fields.form.label': 'Libellé',
	'admin.workflows.fields.form.label.help': 'Le texte affiché au-dessus de la question, sur chaque affaire.',
	'admin.workflows.fields.form.label.invalid': 'Le libellé ne peut pas être blanc.',
	'admin.workflows.fields.form.type': 'Type',
	'admin.workflows.fields.form.type.help':
		'Il détermine ce qu’une réponse peut contenir. Il se choisit maintenant et ne se modifie plus ensuite.',
	'admin.workflows.fields.form.type.frozen':
		'Type : {type}. Il ne se modifie pas : les réponses déjà saisies resteraient dans l’ancien format, et aucune conversion n’existe encore.',
	'admin.workflows.fields.form.help': 'Texte d’aide',
	'admin.workflows.fields.form.help.help':
		'Facultatif. Affiché sous la question pour expliquer ce qui est attendu.',
	'admin.workflows.fields.form.help.invalid': 'Le texte d’aide ne peut pas être blanc : laissez-le vide.',
	'admin.workflows.fields.form.currency': 'Devise',
	'admin.workflows.fields.form.currency.help': 'Code de trois lettres, par exemple EUR.',
	'admin.workflows.fields.form.currency.invalid':
		'La devise s’écrit en trois lettres majuscules, par exemple EUR.',
	'admin.workflows.fields.form.choices': 'Choix proposés',
	'admin.workflows.fields.form.choices.help':
		'Au moins un choix. La clé identifie la réponse et ne doit apparaître qu’une fois ; le libellé est ce que l’équipe lit.',
	'admin.workflows.fields.form.choices.key': 'Clé du choix',
	'admin.workflows.fields.form.choices.label': 'Libellé du choix',
	'admin.workflows.fields.form.choices.add': 'Ajouter un choix',
	'admin.workflows.fields.form.choices.remove': 'Retirer le choix {nom}',
	'admin.workflows.fields.form.choices.invalid.aucun-choix':
		'Un champ à choix a besoin d’au moins un choix.',
	'admin.workflows.fields.form.choices.invalid.cle-vide': 'Chaque choix a besoin d’une clé.',
	'admin.workflows.fields.form.choices.invalid.libelle-vide': 'Chaque choix a besoin d’un libellé.',
	'admin.workflows.fields.form.choices.invalid.cle-dupliquee':
		'Deux choix portent la même clé : les réponses seraient impossibles à distinguer.',

	'admin.workflows.fields.archive.confirm': 'Archiver le champ « {nom} » ?',
	'admin.workflows.fields.archive.confirm.body':
		'Il disparaît des formulaires, les réponses déjà saisies sont conservées, et la restauration le remet en place. Le produit ne supprime aucun champ.',
	'admin.workflows.fields.archive.confirm.action': 'Archiver',

	// Les quinze types de docs/SPEC-form-composer.md §2.3.
	'admin.workflows.fields.type.text': 'Texte court',
	'admin.workflows.fields.type.textarea': 'Texte long',
	'admin.workflows.fields.type.number': 'Nombre',
	'admin.workflows.fields.type.money': 'Montant',
	'admin.workflows.fields.type.date': 'Date',
	'admin.workflows.fields.type.datetime': 'Date et heure',
	'admin.workflows.fields.type.select': 'Choix unique',
	'admin.workflows.fields.type.multiselect': 'Choix multiple',
	'admin.workflows.fields.type.checkbox': 'Case à cocher',
	'admin.workflows.fields.type.url': 'Adresse web',
	'admin.workflows.fields.type.email': 'Adresse email',
	'admin.workflows.fields.type.phone': 'Téléphone',
	'admin.workflows.fields.type.user': 'Membre de l’espace',
	'admin.workflows.fields.type.contact': 'Contact',
	'admin.workflows.fields.type.file': 'Fichier',

	'admin.workflows.refus.champ.cle-deja-prise': 'Cette clé est déjà prise dans ce workflow.',
	'admin.workflows.refus.champ.reference-absente':
		'Ce workflow n’existe plus, ou n’appartient pas à cet espace de travail.',
	'admin.workflows.refus.champ.forme-refusee':
		'Ce champ a été refusé : vérifiez la clé, le libellé, le texte d’aide, le type et ses options.',

	'live.workflows.field.declared': 'Champ déclaré',
	'live.workflows.field.updated': 'Champ modifié',
	'live.workflows.field.moved': 'Champ déplacé',
	'live.workflows.field.archived': 'Champ archivé',
	'live.workflows.field.restored': 'Champ restauré',

	// --- État de la messagerie — CRM-059, docs/SPEC-mail-subsystem.md §20.11 --------------
	'admin.settings.index.mail': 'État de la messagerie',
	'admin.settings.index.mail.body':
		'Dernière relève de chaque boîte entrante, dernier incident, file sortante en attente et en échec définitif.',

	'admin.mail.title': 'État de la messagerie',
	'admin.mail.aria': 'État des comptes de messagerie et de la file sortante',
	'admin.mail.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.mail.noWorkspace.body': "Sans espace de travail, il n'y a pas de messagerie à superviser.",
	'admin.mail.empty.title': 'Aucune boîte à superviser',
	'admin.mail.empty.body':
		"Aucun compte de messagerie entrante n'est visible avec ce compte.",
	'admin.mail.error.title': "L'état de la messagerie n'a pas pu être chargé",
	'admin.mail.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.mail.error.retry': 'Réessayer',

	'admin.mail.counters.queued': "En attente d'envoi",
	'admin.mail.counters.failed': 'Échecs définitifs',

	'admin.mail.table.aria': 'Comptes de messagerie entrante',
	'admin.mail.table.label': 'Boîte',
	'admin.mail.table.lastSync': 'Dernière relève réussie',
	'admin.mail.table.incident': 'Dernier incident',
	'admin.mail.table.never': 'Jamais relevée',

	// Dictionnaire fermé des six codes de `mail_inbound_accounts_erreur_code` (migration 0022) —
	// jamais le texte du serveur distant (docs/SPEC-mail-subsystem.md §13.7, §20.11.4).
	'admin.mail.incident.auth_failed': 'Authentification refusée',
	'admin.mail.incident.host_unreachable': 'Hôte injoignable',
	'admin.mail.incident.connection_refused': 'Connexion refusée',
	'admin.mail.incident.tls_failed': 'Échec TLS',
	'admin.mail.incident.timeout': 'Délai dépassé',
	'admin.mail.incident.protocol_error': 'Erreur de protocole',
} as const

export type CleTraduction = keyof typeof fr
