# Branches supprimées — inventaire de récupération

## Ce qui s'est passé

La consigne du responsable (`CLAUDE.md` §13) interdit toute création de branche,
de worktree ou d'environnement Git parallèle : le travail se fait sur `main`
exclusivement, dans le dépôt et le répertoire courants. Quarante et une branches
`claude/happy-goldberg-*` ont malgré tout été poussées sur `origin` par des
exécutions parallèles. Elles ont été supprimées sur instruction explicite du
responsable.

## Ce qui a été vérifié avant la suppression

Mesures faites sur l'arbre et l'historique, branche par branche :

- **26 branches** étaient déjà entièrement contenues dans `main`.
- **15 branches** n'y étaient pas. Leur contenu propre a été comparé fichier par
  fichier à `main` : il s'agit de réimplémentations parallèles des mêmes unités,
  que `main` porte sous ses noms retenus — `ListeCards.tsx` pour `Liste.tsx`,
  `Board.tsx` pour `BoardChannel.tsx`, `PanneauTimeline.tsx` pour
  `PanneauCommentaires.tsx`, `0017_move_card_to_channel.sql` pour
  `0017_deplacement_channel.sql` et `0017_changement_channel.sql`,
  `stalwart/config.toml` pour `stalwart/config.json.template`.
- **Une seule branche**, `claude/happy-goldberg-qt5vfi`, portait des décisions
  absentes de `main` : dix-huit entrées de journal dont cinq arbitrages du
  responsable, plus `docs/ARBITRAGES.md`. Ce contenu a été récupéré sur `main`
  avant la suppression — voir `docs/ARBITRAGES_RECUPERES.md` et
  `docs/ARBITRAGES.md`.

Aucune autre branche ne portait de contenu unique.

## Empreintes des têtes supprimées

Ces empreintes sont conservées pour rendre une restauration possible tant que le
ramasse-miettes du dépôt distant n'est pas passé. Restauration :
`git push origin <sha>:refs/heads/<nom>`.

| Branche | Tête |
|---|---|
| `claude/happy-goldberg-2q72gg` | `b05efaa2649f96974621850609ddfdeea5c79ea9` |
| `claude/happy-goldberg-3otm9i` | `922c051794ac4d736c8489d85e4ed8852384f4d0` |
| `claude/happy-goldberg-3qm9z9` | `2adec3da810d956bfdf1629cfcd683c6e8e834af` |
| `claude/happy-goldberg-3ujqsw` | `e216558d7ecb5aa47194fdbc7cbb47701e4f5514` |
| `claude/happy-goldberg-442dio` | `5831473c2e1e8efaf1b9631ec267b1ac2da0ae60` |
| `claude/happy-goldberg-45espd` | `8244818d0dadfe7cf3a221777a230d1fe2c239e5` |
| `claude/happy-goldberg-4fxusn` | `827d5668b92aed06af663774286f7f3f64f0799a` |
| `claude/happy-goldberg-4sqpwf` | `43203a580f3f811032c8bd5fcebafd80c5a38ff3` |
| `claude/happy-goldberg-4uydvf` | `cfd14fb949d1c31ca7510971425e001e8e1503da` |
| `claude/happy-goldberg-8n6nnd` | `f4c44fdec741c14ef992574ca38cbca86f338ad7` |
| `claude/happy-goldberg-9angpi` | `e216558d7ecb5aa47194fdbc7cbb47701e4f5514` |
| `claude/happy-goldberg-9qh92a` | `26fc45fb9d7c372ff9abc05ad778621f92e7cf79` |
| `claude/happy-goldberg-a0fp4k` | `1364bf3d57939cb1d5b12ccaa8a1eabcf8b9dec9` |
| `claude/happy-goldberg-am313o` | `a24271220a6ab14317ae96ce9ce593da9f9802be` |
| `claude/happy-goldberg-aokdoy` | `731ea7e9952f17a8f1fb58f0938c2bd6a9a4260d` |
| `claude/happy-goldberg-brz6dq` | `3f76149f7a3eeca211a43ff827be41019dd4ac71` |
| `claude/happy-goldberg-c627zj` | `914384feda141ea63a9452a1694993adadc72bef` |
| `claude/happy-goldberg-cf564z` | `c3a72be584914c9ced5243ce3dfb332aeb88c312` |
| `claude/happy-goldberg-cmlb8g` | `7564175d4e7612dbb10436ef0e6cce0f43bb2262` |
| `claude/happy-goldberg-d5sx7w` | `6a4d527f167006c3ee6e0bb106fb223d8f409fdf` |
| `claude/happy-goldberg-d66ejz` | `13da2b7411fea05f6a1e40f52bdde918bb0aaea7` |
| `claude/happy-goldberg-epjfsk` | `044502010124d86709eaff3ad4bffb6247a78545` |
| `claude/happy-goldberg-g5ba0m` | `e0d6c4ce94aef9dde6c99906fbc7d3bdbfe67373` |
| `claude/happy-goldberg-i6xeib` | `cd7539d69cd7cc8b050ad40ea86edda0ae10895c` |
| `claude/happy-goldberg-jh0oi2` | `177d55b079b5804166658bafba46ff0ad40c77a3` |
| `claude/happy-goldberg-jmw2pb` | `c8a865de194f800daff408ec8d6b3c6b635f119e` |
| `claude/happy-goldberg-mj2jyd` | `9a83ae53b6af964fd6fd17ef0a6c59865a82556c` |
| `claude/happy-goldberg-odk970` | `0b28d736a2376e0104037795e7bda6d0dc981570` |
| `claude/happy-goldberg-oe884g` | `91d428d0e1f8292819afcc21895ae2d69137ca10` |
| `claude/happy-goldberg-pgyhe1` | `cd7539d69cd7cc8b050ad40ea86edda0ae10895c` |
| `claude/happy-goldberg-qt5vfi` | `c98045caa9a41f0933258d613954152d81c621ba` |
| `claude/happy-goldberg-rguskx` | `8f7dc59674e5d34673c30607ade22d6295fccf03` |
| `claude/happy-goldberg-s6b1t0` | `aae9aeeb18966f574c488ece56fcdaffcdd564a9` |
| `claude/happy-goldberg-s7y3o6` | `1a2238a7e4feba651b02ec9ae6a8817ac6a19016` |
| `claude/happy-goldberg-sqtt9d` | `5ffb1f4b78349cc5c6cdfad9e2dd219d13f8a2f9` |
| `claude/happy-goldberg-szblin` | `0cabd08439dbd40b2083645cdc83db7a6cc5434f` |
| `claude/happy-goldberg-u6rduu` | `a42f7987f046de18049da7f36205b46307e74a39` |
| `claude/happy-goldberg-um0mbt` | `b9ca989b567e93e40334bfab1be4c58a559ed7bf` |
| `claude/happy-goldberg-w9q87o` | `7ed5e2c250fac75f1dba8513d2a19a13ab84e141` |
| `claude/happy-goldberg-wq44ln` | `52dc4ff766a8cd1d6d4e13d99b550a5610d40704` |
| `claude/happy-goldberg-xpvra9` | `ef1a6359dac896f361f712ef40d26ff909c4fd58` |
