# Déploiement

---

## 1. Checklist avant mise en production

À faire **avant** la première mise en service, sans exception :

- [ ] `JWT_SECRET` généré aléatoirement, au moins 32 caractères.
      `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
      Le serveur **refuse de démarrer** en production si le secret est absent, trop court,
      ou resté sur la valeur de développement.
- [ ] Mot de passe de l'administrateur changé (`Admin123!` est une valeur de démonstration).
- [ ] `DATABASE_URL` pointant sur une base dédiée, avec un utilisateur non superadmin.
- [ ] `CORS_ORIGINS` limité aux domaines réellement utilisés.
- [ ] `NODE_ENV=production` — active les en-têtes HSTS et la CSP stricte.
- [ ] HTTPS terminé en amont (reverse proxy) ; `trust proxy` est activé automatiquement.
- [ ] Sauvegarde PostgreSQL planifiée **et restauration testée**.
- [ ] Jeu de démonstration non installé : `npm run db:seed -- --core-only`.

---

## 2. Variables d'environnement

| Variable                 | Obligatoire       | Rôle                                                           |
| ------------------------ | ----------------- | -------------------------------------------------------------- |
| `DATABASE_URL`           | oui               | `postgresql://user:pass@hôte:5432/base`                        |
| `JWT_SECRET`             | oui en production | Signature des jetons d'accès                                   |
| `NODE_ENV`               | —                 | `production` active sécurité et service des fichiers statiques |
| `PORT`                   | —                 | Port d'écoute (5000 par défaut)                                |
| `APP_URL`                | —                 | Origine publique                                               |
| `CORS_ORIGINS`           | —                 | Origines autorisées, séparées par des virgules                 |
| `ACCESS_TOKEN_TTL`       | —                 | Durée du jeton d'accès (`15m` par défaut)                      |
| `REFRESH_TOKEN_TTL_DAYS` | —                 | Durée du jeton de rafraîchissement (30 jours)                  |
| `DATABASE_POOL_MAX`      | —                 | Taille du pool (10 par défaut)                                 |
| `LOG_LEVEL`              | —                 | `debug` · `info` · `warn` · `error`                            |

La coquille desktop appelle l'API depuis `tauri://localhost` : ces origines sont autorisées
par défaut, inutile de les ajouter à `CORS_ORIGINS`.

---

## 3. Déploiement classique (VPS, Node + reverse proxy)

```bash
git clone <dépôt> /opt/erp-sahel && cd /opt/erp-sahel
npm ci
cp .env.example .env && $EDITOR .env      # renseigner DATABASE_URL et JWT_SECRET

npm run build
npm run db:migrate                         # migrations versionnées
npm run db:seed -- --core-only             # permissions, rôles, société, admin

npm start                                  # ou via systemd, voir ci-dessous
```

### Service systemd

```ini
# /etc/systemd/system/erp-sahel.service
[Unit]
Description=ERP Sahel
After=network.target postgresql.service

[Service]
Type=simple
User=erp
WorkingDirectory=/opt/erp-sahel
EnvironmentFile=/opt/erp-sahel/.env
ExecStart=/usr/bin/node dist/index.cjs
Restart=always
RestartSec=5
# Le processus n'a besoin d'écrire nulle part en dehors de son répertoire.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/erp-sahel

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now erp-sahel
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name erp.exemple.mr;

    ssl_certificate     /etc/letsencrypt/live/erp.exemple.mr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/erp.exemple.mr/privkey.pem;

    # Les instantanés de synchronisation et les logos en data URI dépassent
    # la limite par défaut de 1 Mo.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # laisse passer un gros lot de synchronisation
    }
}

server {
    listen 80;
    server_name erp.exemple.mr;
    return 301 https://$host$request_uri;
}
```

---

## 4. Déploiement Docker

```bash
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
docker compose --profile full up -d
docker compose exec app node -e "require('./dist/index.cjs')"   # vérification
```

L'image finale n'embarque que les dépendances de production et s'exécute sans privilèges.
Une sonde `HEALTHCHECK` interroge `/api/health`.

---

## 5. Application desktop (Tauri)

Utile là où la connexion est franchement mauvaise : le cache hors ligne vit alors dans un
fichier SQLite applicatif que le système n'évince pas, et une **connexion à froid sans
réseau** devient possible sur un poste déjà synchronisé.

Prérequis de compilation (Linux) :

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
rustup default stable
```

```bash
npm run tauri:build     # produit .deb, .AppImage (Linux) ; .msi (Windows) ; .dmg (macOS)
```

L'application pointe vers l'URL du serveur configurée au premier lancement.

---

## 6. Sauvegarde et restauration

```bash
# Sauvegarde quotidienne
pg_dump --format=custom --file=/var/backups/erp-$(date +%F).dump "$DATABASE_URL"

# Restauration
pg_restore --clean --if-exists --dbname="$DATABASE_URL" /var/backups/erp-2026-09-23.dump
```

**Testez la restauration.** Une sauvegarde jamais restaurée n'est pas une sauvegarde.

Les postes conservent leurs ventes non synchronisées localement : après une restauration,
ils les remonteront d'eux-mêmes, et l'idempotence évite les doublons pour les opérations
déjà ingérées avant l'incident.

---

## 7. Supervision

| Point de contrôle       | Où                                                                              |
| ----------------------- | ------------------------------------------------------------------------------- |
| `GET /api/health`       | Disponibilité du processus (sans accès base)                                    |
| `GET /api/health/db`    | Connectivité PostgreSQL                                                         |
| Journaux                | JSON en production, clés sensibles masquées                                     |
| État de synchronisation | Écran **Synchronisation** : file locale, journal serveur, postes                |
| Postes silencieux       | `sync_devices.last_push_at` — un poste muet depuis plusieurs jours doit alerter |

---

## 8. Mise à jour

```bash
git pull
npm ci
npm run build
npm run db:migrate      # jamais db:push en production
sudo systemctl restart erp-sahel
```

Le Service Worker détecte la nouvelle version et l'active sans attendre la fermeture de
tous les onglets — un poste de caisse reste ouvert des journées entières.
