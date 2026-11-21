# API Ops (déploiements gérés)

L’API Ops (`/api/v1/ops`) est une interface de gestion **facultative** utilisée par un plan de contrôle Turbo EA Cloud pour exploiter des instances hébergées. Sur une installation auto-hébergée, elle est **désactivée par défaut** : chaque route répond `404`, sauf si l’instance a été démarrée avec une variable d’environnement `OPS_PUBLIC_KEY`. Turbo EA ne contient aucune logique de facturation ou de licence.

## Authentification

Chaque requête Ops doit être signée avec la clé Ed25519 **privée** détenue par le plan de contrôle ; l’instance vérifie la signature avec la clé **publique** de `OPS_PUBLIC_KEY` (base64, 32 octets bruts). La signature couvre la méthode HTTP, le chemin avec la chaîne de requête, un hachage SHA-256 du corps, un horodatage et un nonce à usage unique :

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

En-têtes : `X-Ops-Timestamp` (secondes Unix, ±5 minutes), `X-Ops-Nonce` (utilisé une fois, protection contre les rejeux), `X-Ops-Signature` (signature Ed25519 en base64).

## Points de terminaison

| Méthode | Chemin | Fonction |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Version, nombres d’utilisateurs et de fiches, état de la base de données |
| POST | `/api/v1/ops/rescue-access` | Crée un compte administrateur opérateur **à durée limitée** |
| DELETE | `/api/v1/ops/rescue-access` | Révoque immédiatement un compte de secours |
| GET | `/api/v1/ops/export` | Diffuse le paquet d’export de l’espace de travail expurgé de ses secrets |

## Accès de secours — garanties de transparence

L’accès opérateur à durée limitée (« accès de secours ») est conçu pour ne jamais pouvoir se produire à l’insu des administrateurs :

- **Chaque octroi et révocation notifie tous les administrateurs de l’instance** dans l’application *et* par e-mail, avec le nom de l’opérateur, le motif indiqué et l’heure d’expiration.
- **Chaque action est consignée dans le journal d’événements de l’instance.**
- **L’expiration est appliquée par l’instance elle-même** : les comptes de secours portent un horodatage `access_expires_at` ; les comptes expirés sont refusés lors de l’authentification et désactivés par une tâche d’arrière-plan horaire. Une panne du plan de contrôle ne peut jamais prolonger l’accès.
- Les comptes de secours utilisent une adresse réservée dédiée (`rescue-…@rescue.turboea.invalid`), ce qui les rend faciles à reconnaître dans la liste des utilisateurs et à désactiver manuellement à tout moment.

## Export de l’espace de travail

`GET /api/v1/ops/export` renvoie le même paquet que **Admin → Paramètres → Migration → Transfert de l’espace de travail → Exporter** : l’espace de travail complet avec tous les secrets supprimés. Le plan de contrôle l’utilise pour les exports de données demandés par les clients (portabilité des données au titre du RGPD) et pour les sauvegardes de sécurité avant les mises à niveau ou suppressions.
