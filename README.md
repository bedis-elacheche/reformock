# Réformock

[![CI](https://github.com/bedis-elacheche/reformock/actions/workflows/ci.yml/badge.svg)](https://github.com/bedis-elacheche/reformock/actions/workflows/ci.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/belacheche/reformock?logo=docker)](https://hub.docker.com/r/belacheche/reformock)
[![Docker Image Version](https://img.shields.io/docker/v/belacheche/reformock?sort=semver&logo=docker&label=docker%20hub)](https://hub.docker.com/r/belacheche/reformock)

Image Docker Node.js simulant une **PDP (Plateforme de Dématérialisation Partenaire)** exposant l'API Flow Service de la norme expérimentale **AFNOR XP Z12-013** (réforme de la facturation électronique française), pour tester une chaîne d'intégration en l'absence d'environnement de test.

Le serveur **génère automatiquement des factures fictives** (UBL 2.1, UN/CEFACT CII, lisible PDF) et des **statuts de cycle de vie** (syntaxe CDAR), et les expose via les routes obligatoires de la norme.

## Démarrage rapide

L'image est publiée sur [Docker Hub](https://hub.docker.com/r/belacheche/reformock) :

```bash
docker run -p 3000:3000 belacheche/reformock
```

L'API est disponible sur `http://localhost:3000/v1` et la **console web de dépôt** sur `http://localhost:3000/`.

Le tag `latest` suit la branche `main`. Pour une chaîne d'intégration, épinglez plutôt une version : `belacheche/reformock:1.0.0` fige la version exacte, `belacheche/reformock:1.0` suit les correctifs de la mineure.

Pour construire depuis les sources (développement du mock) :

```bash
docker build -t reformock . && docker run -p 3000:3000 reformock
```

L'API est disponible sur `http://localhost:3000/v1` et la **console web de dépôt** sur `http://localhost:3000/`.

## Console web de dépôt

Ouvrez `http://localhost:3000/` dans un navigateur :

- **Glissez-déposez vos fichiers XML UBL** (ou CII, CDAR, Factur-X PDF), dépôt multiple supporté. Le mock détecte la syntaxe, extrait le n° de facture, l'émetteur, le destinataire et le montant TTC, puis rend le flux disponible via l'API standard (`POST /flows/search`, `GET /flows/{flowId}`).
- Choisissez la **direction** : `In` (défaut : vos UBL apparaissent comme des factures reçues, exactement ce que votre chaîne d'intégration ira chercher) ou `Out`, le **type de flux** (automatique par défaut) et un **trackingId** optionnel pour retrouver vos dépôts.
- Le **registre des flux** liste tout le contenu du mock (flux générés par le simulateur + vos dépôts, marqués `web`), avec filtres, téléchargement des composants XML/PDF et bouton « Vider le registre ».
- La console gère l'authentification OAuth2 (jeton obtenu automatiquement avec `test-client`/`test-secret`, modifiable).

**Tout ce qui est déposé via l'interface est éphémère** : stockage en mémoire uniquement, perdu au redémarrage du conteneur (un bandeau le rappelle dans l'interface).

L'interface s'appuie sur l'endpoint `POST /v1/admin/inject` (multipart, champ `files` répétable + `flowDirection`, `flowType`, `trackingId`), également utilisable en script :

```bash
curl -X POST http://localhost:3000/v1/admin/inject \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@facture1.xml;type=application/xml" \
  -F "files=@facture2.xml;type=application/xml" \
  -F "flowDirection=In" -F "trackingId=LOT-TEST-01"
```

## Routes exposées

Routes obligatoires de la norme (tableau 1 du Flow Service) :

| Route                              | Description                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /v1/healthcheck`              | Vérifier que le service est opérationnel (non authentifiée)                                                       |
| `POST /v1/flows`                   | Déposer un flux : multipart `file` + part JSON `flowInfo` → **202** `FullFlowInfo`                                |
| `POST /v1/flows/search`            | Rechercher des flux (corps `{ where, limit, cursor }`), pagination par curseur                                    |
| `GET /v1/flows/{flowId}`           | Récupérer un flux : `docType` = `Metadata` (défaut, renvoie `Flow` JSON), `Original`, `Converted`, `ReadableView` |
| `GET /v1/webhooks`                 | Lister les webhooks du porteur du jeton                                                                           |
| `POST /v1/webhooks`                | Souscrire à un webhook → **201** `{ webhookId, signingKey, createdAt }`                                           |
| `DELETE /v1/webhooks/{webhookUid}` | Se désabonner → **204**                                                                                           |

Toutes les erreurs suivent le schéma `Error` du contrat : `{ "errorCode": "...", "errorMessage": "..." }`.

Routes complémentaires du mock (hors contrat) :

| Route                                   | Description                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /oauth/token`                     | OAuth2 `client_credentials` et `password` (bearer RFC 6750)                           |
| `GET /.well-known/openid-configuration` | Document de découverte OIDC (issuer, token_endpoint, grants) — non authentifié        |
| `POST /v1/admin/flows/search`           | Recherche enrichie (n° facture, montants, statut, composants) utilisée par la console |
| `POST /v1/admin/inject`                 | Injecte des fichiers comme flux disponibles (voir Console web)                        |
| `POST /v1/admin/flows/{flowId}/status`  | Force un statut de cycle de vie sur une facture                                       |
| `POST /v1/admin/generate`               | Force la génération de N factures entrantes `{"count": 5}`                            |
| `POST /v1/admin/reset`                  | Vide le store en mémoire                                                              |

## Authentification

Conformément à la norme, l'API exige un bearer OAuth2 :

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"test-client","client_secret":"test-secret"}' \
  | jq -r .access_token)
```

Le grant `password` (RFC 6749 §4.3) est également supporté : il exige, en plus des
identifiants client, un couple `username`/`password` (défauts `test-user` / `test-password`,
surchargés par `OAUTH_USERNAME` / `OAUTH_PASSWORD`).

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"password","client_id":"test-client","client_secret":"test-secret","username":"test-user","password":"test-password"}' \
  | jq -r .access_token)
```

Pour tester sans auth : `AUTH_DISABLED=true`.

## Scénarios de test

### 1. Récupérer les factures d'achat entrantes (différentiel)

```bash
curl -s -X POST http://localhost:3000/v1/flows/search \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "where": {
          "flowType": ["SupplierInvoice", "SupplierInvoiceLC"],
          "flowDirection": ["In"],
          "updatedAfter": "2026-07-01T00:00:00Z"
        },
        "limit": 50
      }'
```

Le corps est un `SearchFlowParams` : au moins un critère est requis dans `where`. La réponse est un `SearchFlowContent` `{ limit, nextCursor?, filters, results: [Flow] }`. Pour paginer, rappelez la même requête en passant `nextCursor` de la réponse précédente dans `cursor` ; l'absence de `nextCursor` signale la fin. Pour le différentiel par date, filtrez sur `updatedAfter` (comparaison stricte `updatedAt > updatedAfter`).

### 2. Télécharger une facture (Original / lisible / conversion)

```bash
curl -s "http://localhost:3000/v1/flows/{flowId}?docType=Original"     -H "Authorization: Bearer $TOKEN" -o facture.xml
curl -s "http://localhost:3000/v1/flows/{flowId}?docType=ReadableView" -H "Authorization: Bearer $TOKEN" -o facture.pdf
curl -s "http://localhost:3000/v1/flows/{flowId}?docType=Converted"    -H "Authorization: Bearer $TOKEN" -o facture_convertie.xml
```

Sans `docType` (ou avec `docType=Metadata`, la valeur par défaut), la route retourne la ressource `Flow` en JSON au lieu d'un téléchargement.

### 3. Déposer une facture de vente et suivre son cycle de vie

Le dépôt est un `multipart/form-data` avec le fichier (`file`) et une part JSON `flowInfo` (`name` et `flowSyntax` obligatoires ; `trackingId`, `processingRule`, `flowProfile`, `sha256` optionnels) :

```bash
curl -s -X POST http://localhost:3000/v1/flows \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@ma_facture_ubl.xml;type=application/xml' \
  -F 'flowInfo={"name":"ma_facture_ubl.xml","flowSyntax":"UBL","trackingId":"MON-REF-ERP-001"};type=application/json'
# => 202 { "flowId": "...", "submittedAt": "...", "name": "...", "flowSyntax": "UBL",
#          "trackingId": "MON-REF-ERP-001", "processingRule": "B2B", "flowProfile": "CIUS", "sha256": "..." }
```

Si `flowInfo.sha256` est fourni, il est vérifié contre l'empreinte du fichier reçu (400 `CHECKSUM_MISMATCH` en cas d'écart). Le `trackingId` est optionnel, stocké tel quel (unicité non contrôlée), et utilisable comme critère de recherche. Après le dépôt, le simulateur génère progressivement les statuts de cycle de vie entrants (`CustomerInvoiceLC`, CDAR) : Émise par la plateforme (201) → Reçue (202) → Mise à disposition (203) → Prise en charge (204) → Approuvée (205) → Paiement transmis (211) → Encaissée (212). Récupérez-les :

```bash
curl -s -X POST http://localhost:3000/v1/flows/search \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"where":{"flowType":["CustomerInvoiceLC"],"flowDirection":["In"]}}'
```

### 4. Simuler le cycle de vie : forcer un statut sur une facture

Depuis la console web, chaque facture du registre a un menu déroulant **Statut** : choisissez le nouveau statut (un motif est demandé pour Approuvée partiellement, En litige, Suspendue, Refusée et Rejetée). Ou par API :

```bash
# Liste des statuts disponibles
curl -s http://localhost:3000/v1/admin/lifecycle-statuses -H "Authorization: Bearer $TOKEN"

# Forcer un statut
curl -s -X POST http://localhost:3000/v1/admin/flows/{flowId}/status \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"statusCode": "210", "reasonCode": "MONTANTTOTAL_ERR", "comment": "Montant TVA incorrect"}'
```

Effets du changement de statut :

- le flux facture est mis à jour (`updatedAt`, donc visible dans une recherche en différentiel via `where.updatedAfter`) ;
- un **flux de cycle de vie CDAR** est émis (`SupplierInvoiceLC` ou `CustomerInvoiceLC` selon le type de la facture), avec le motif dans `SpecifiedDocumentStatus` (`ReasonCode` MDT-113 + `Reason` MDT-114) : c'est ce flux que votre chaîne d'intégration récupère via `POST /flows/search` puis `GET /flows/{flowId}` ;
- `emitLifecycleFlow: false` dans le corps désactive l'émission du CDAR si vous voulez seulement changer la métadonnée ;
- `reasonCode` (MDT-113) est optionnel : à défaut, le motif par défaut du statut est utilisé, chaque statut n'acceptant qu'une liste fermée de motifs (BR-FR-CDV-CL-09) ;
- un `statusCode`/`statusName` libre est accepté pour tester des statuts hors référentiel.

Statuts du référentiel mock (liste fermée BR-FR-CDV-CL-06) : 200 Déposée, 201 Émise par la plateforme, 202 Reçue par la plateforme, 203 Mise à disposition, 204 Prise en charge, 205 Approuvée, 206 Approuvée partiellement, 207 En litige, 208 Suspendue, 209 Complétée, 210 Refusée, 211 Paiement transmis, 212 Encaissée, 213 Rejetée. La progression automatique après un `POST /flows` suit le cycle nominal (201 → … → 212) et **se fige si vous forcez manuellement 207, 210 ou 213**, pratique pour tester vos scénarios de rejet.

### 5. S'abonner aux événements par webhook

```bash
# Souscrire (filtres optionnels : flowTypes, flowDirection, ackStatus)
curl -s -X POST http://localhost:3000/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"callbackUrl":"https://mon-erp.example/webhook","flowDirection":"In","flowTypes":["SupplierInvoice"]}'
# => 201 { "webhookId": "...", "signingKey": "<base64>", "createdAt": "..." }
```

À chaque création ou changement de statut d'un flux correspondant aux filtres, le mock **POST** la ressource `Flow` (JSON) à votre `callbackUrl`, avec deux en-têtes :

- `Afnor-Signature-Timestamp` : epoch en secondes ;
- `Afnor-Signature` : `base64(HMAC-SHA-256(payload + "@" + timestamp))` calculé avec la `signingKey` renvoyée à la souscription.

Vérifiez la signature en recomposant l'empreinte `corps + "@" + timestamp` et en la comparant à l'en-tête. `GET /v1/webhooks` liste vos abonnements ; `DELETE /v1/webhooks/{webhookUid}` les supprime.

Deux garde-fous protègent le mock contre les abus :

- **Quota** : le nombre de webhooks est plafonné par `MAX_WEBHOOKS` (défaut `50`, `0` = illimité). Une souscription au-delà du quota renvoie `403 WEBHOOK_LIMIT_REACHED`.
- **Anti-SSRF** : le `callbackUrl` doit être en `http`/`https`, sans identifiants intégrés, et ne doit pas cibler une adresse privée, loopback, link-local ou réservée (le nom d'hôte est résolu par DNS et revérifié à chaque émission pour contrer le DNS rebinding). Un `callbackUrl` interdit renvoie `400 INVALID_CALLBACK_URL`. Pour tester en local contre `127.0.0.1`, mettez `WEBHOOK_ALLOW_PRIVATE=true`.

## Configuration (variables d'environnement)

Toute la configuration est centralisée, typée et validée dans [`src/config.ts`](src/config.ts) : les modules ne lisent jamais `process.env` directement. Une valeur invalide (entier, booléen, borne) arrête le démarrage avec un message explicite.

Les variables se surchargent de trois façons, par priorité croissante : valeurs par défaut → fichier `.env` (chargé automatiquement, support natif Node) → environnement réel (shell, `docker -e`, `docker compose`).

```bash
cp .env.example .env   # puis ajustez les valeurs ; .env n'est jamais committé
```

| Variable                                  | Défaut                        | Rôle                                                                                                                                |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                | `development`                 | Environnement d'exécution (`production` dans l'image)                                                                               |
| `HOST`                                    | `0.0.0.0`                     | Interface d'écoute                                                                                                                  |
| `PORT`                                    | `3000`                        | Port HTTP                                                                                                                           |
| `API_PREFIX`                              | `/v1`                         | Préfixe de versioning des routes                                                                                                    |
| `MAX_FILE_MB`                             | `100`                         | Taille maximale d'un fichier uploadé (Mo)                                                                                           |
| `RATE_LIMIT_ENABLED`                      | `true`                        | `false` pour désactiver la limitation de débit                                                                                      |
| `RATE_LIMIT_MAX`                          | `100`                         | Nombre maximal de requêtes par fenêtre et par IP                                                                                    |
| `RATE_LIMIT_WINDOW_SECONDS`               | `60`                          | Durée de la fenêtre de limitation (s)                                                                                               |
| `SEED_COUNT`                              | `20`                          | Factures fournisseurs générées au démarrage                                                                                         |
| `GENERATION_INTERVAL_SECONDS`             | `60`                          | Génération continue de 1–3 factures (0 = désactivé)                                                                                 |
| `LIFECYCLE_DELAY_SECONDS`                 | `15`                          | Délai entre chaque statut après un dépôt                                                                                            |
| `AUTH_DISABLED`                           | `false`                       | `true` pour désactiver le bearer                                                                                                    |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | `test-client` / `test-secret` | Identifiants du compte API                                                                                                          |
| `OAUTH_USERNAME` / `OAUTH_PASSWORD`       | `test-user` / `test-password` | Identifiants du grant `password`                                                                                                    |
| `TOKEN_TTL_SECONDS`                       | `3600`                        | Durée de vie des jetons                                                                                                             |
| `MAX_WEBHOOKS`                            | `50`                          | Nombre maximal de webhooks enregistrables (0 = illimité) ; au-delà, `POST /v1/webhooks` renvoie `403 WEBHOOK_LIMIT_REACHED`         |
| `WEBHOOK_ALLOW_PRIVATE`                   | `false`                       | `true` pour autoriser des `callbackUrl` vers des adresses privées/loopback (protection anti-SSRF désactivée, pratique en dev local) |

## Tests

La suite de tests s'appuie uniquement sur le **runner natif de Node** (`node:test`) et l'exécution TypeScript native — aucune dépendance supplémentaire.

```bash
pnpm test              # tous les tests (unitaires + intégration)
pnpm test:unit         # tests unitaires seuls
pnpm test:integration  # tests d'intégration seuls (HTTP via fastify.inject)
pnpm typecheck:test    # vérifie le typage des tests et des sources
```

- **Tests unitaires** (`test/unit/`) : détection de syntaxe et extraction de métadonnées (`parse`), modèle de stockage en mémoire et recherche/pagination par curseur (`store`), générateurs de données (SIREN/SIRET valides au sens de Luhn, clé TVA, cohérence des totaux) et générateurs XML/PDF (UBL, CII, CDAR, PDF), avec aller-retour génération → parsing.
- **Tests d'intégration** (`test/integration/`) : OAuth2 et middleware bearer, dépôt de flux `multipart` (checksum, auto-détection), recherche standard et pagination, téléchargement par `docType`, routes `admin` (inject, statut forcé, génération, reset), et webhooks avec **vérification réelle de la signature HMAC-SHA-256** via un callback local.

L'application est construite par `buildApp()` ([`src/app.ts`](src/app.ts)), ce qui permet aux tests d'utiliser `fastify.inject()` sans ouvrir de port ni démarrer le simulateur. [`src/index.ts`](src/index.ts) ne fait qu'assembler `buildApp()`, le seed et l'écoute réseau.

## Conformité et limites

- Mock aligné sur le contrat **AFNOR Flow Service 1.3.0** : dépôt `multipart` `file` + `flowInfo` → `202` `FullFlowInfo`, recherche `{ where, limit, cursor }` → `SearchFlowContent` avec pagination par curseur et résultats `Flow`, `GET` avec `docType` `Metadata`/`Original`/`Converted`/`ReadableView`, ressource `Webhook` avec callbacks signés HMAC-SHA-256, schéma d'erreur `Error` `{ errorCode, errorMessage }`, OAuth2 bearer. Les routes `/v1/admin/*` et la vue enrichie de la console sont **hors contrat** (outillage de test).
- Les XML UBL/CII générés sont structurellement représentatifs (EN 16931, SIREN/SIRET valides au sens de la clé de Luhn, TVA intracom cohérente) mais **non validés par schématron**, suffisant pour tester le transport, le parsing et l'orchestration, pas pour valider la conformité sémantique.
- Le `ReadableView` est un vrai PDF, mais pas un Factur-X PDF/A-3 complet.
- Stockage **en mémoire** : tout est perdu au redémarrage du conteneur (comportement voulu pour un environnement de test).
