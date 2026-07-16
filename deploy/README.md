# Hyperush Panel — Self-hosted (Docker)

Kendi sunucunda çalışan, Supabase'e bağımlı olmayan sürüm. Postgres + Node.js
+ WebSocket realtime. İlk açılışta setup sihirbazı Google OAuth bilgilerini
sorar; Google ile giriş yapan **ilk kullanıcı otomatik admin** olur.

## Hızlı Başlangıç

```bash
cd deploy
cp .env.example .env
# .env içindeki POSTGRES_PASSWORD'u değiştir
docker compose up -d
```

Tarayıcıda `http://localhost:3000` → **Setup Wizard** açılır.

## Setup Sihirbazı

Sihirbazda dolduracakların:

| Alan | Açıklama |
|------|----------|
| Marka adı | Panelin üstünde görünecek isim |
| Uygulama URL'i | Tarayıcıda gördüğün adres (örn. `http://localhost:3000` veya `https://panel.sirket.com`) |
| Google Client ID | Google Cloud Console'dan alınır |
| Google Client Secret | Google Cloud Console'dan alınır |
| GitHub Client ID | (opsiyonel) — boş bırakırsan GitHub entegrasyonu devre dışı |
| GitHub Client Secret | (opsiyonel) |

**Session secret** ve **GitHub encryption key** otomatik üretilir — sana
sorulmaz. Bilgiler `/data/config.json` volume'una yazılır ve restart'a dayanır.

## Google OAuth Kurulumu

1. https://console.cloud.google.com → **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth client ID** → **Web application**
3. **Authorized redirect URIs** kısmına şunu ekle (sihirbaz sağda gösterir):
   ```
   http://localhost:3000/api/auth/google/callback
   ```
   (prod'da `https://panel.sirket.com/api/auth/google/callback`)
4. **OAuth consent screen** → **Internal** (Workspace ise) veya **External**
   seç. `openid`, `email`, `profile` scope'ları yeterli.
5. Client ID + Secret'ı kopyalayıp sihirbaza yapıştır.

## GitHub OAuth Kurulumu (opsiyonel)

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. **Authorization callback URL**:
   ```
   http://localhost:3000/api/auth/github/callback
   ```
3. Client ID + Secret'ı sihirbaza gir.

## İlk Kullanıcı = Admin

Sihirbaz bitince "Google ile Giriş Yap"a bas. Google'dan dönüş yapıldığında:
- Veritabanı boş → **role = admin, approved = true** olarak kaydolursun.
- Sonraki her Google girişi → **role = member, approved = false** olur;
  senin admin panelinden onaylamanı bekler.

## Mimari

```
┌──────────────────────────────────────────┐
│ docker-compose                           │
│                                          │
│  ┌─────────────┐  ┌────────────────────┐ │
│  │ postgres:16 │◄─┤ node app :3000     │ │
│  │  pgdata vol │  │  - Express REST    │ │
│  └─────────────┘  │  - WebSocket /ws   │ │
│                   │  - Setup wizard    │ │
│                   │  - /data/config.json│ │
│                   └────────────────────┘ │
└──────────────────────────────────────────┘
```

- **Realtime**: Postgres `LISTEN/NOTIFY` → WebSocket broadcast. Frontend
  `/ws` bağlanır, task/comment/commit değişiklikleri anlık gelir.
- **Auth**: HttpOnly signed cookie (HMAC-SHA256). Session secret sihirbazda
  otomatik üretildi.
- **GitHub token'ları**: AES-256-GCM ile şifreli (`github_encryption_key`
  config'te; disk'te asla plaintext yok).

## API (özet)

Tüm istekler cookie ile authenticated olmalı; `/api/admin/*` sadece admin.

- `GET /api/me` — mevcut kullanıcı
- `GET/POST/PATCH/DELETE /api/tasks[/:id]`
- `POST /api/tasks/:id/restore` — çöpten geri al
- `GET/POST /api/tasks/:id/comments` (thread için `parent_id`)
- `GET /api/github/repos` · `GET /api/github/branches?repo=...`
- `POST /api/tasks/:id/commits/sync` — bağlı repo/branch'tan commit çek
- `GET /api/admin/users` · `POST /api/admin/users/:id/approve|revoke|role`

## Frontend'i Yerleştirme

Bu paket **backend + setup wizard**'ı içerir. React frontend'ini şu şekilde
serve edersin:

```bash
# ana proje kökünde
bun run build
cp -r dist/* deploy/frontend/
```

Sonra `docker compose up -d --build`. Frontend `deploy/frontend/index.html`
üzerinden statik olarak servis edilir; API çağrıları aynı origin'e gider
(CORS derdi yok). Frontend'in Supabase yerine bu API'yi ve `/ws` WebSocket'i
kullanacak şekilde uyarlanması gerekir — bkz. `frontend-integration.md`.

## Yedekleme

```bash
# DB dump
docker compose exec db pg_dump -U hyperush hyperush > backup.sql

# Config
docker compose cp app:/data/config.json ./config.backup.json
```

## Farklı platformlara deploy

Bu paket standart Docker → **Coolify, Dokku, Railway, Fly.io, Render, VPS**
her yerde çalışır. Tek gereken:

1. Postgres bağlantısı (`DATABASE_URL`)
2. Kalıcı volume (`/data`)
3. Public HTTPS URL (WebSocket için `wss://` da otomatik çalışır)

Setup wizard sadece ilk açılışta gösterilir; sonraki restart'larda
`/data/config.json` yüklenir.

## Sorun Giderme

- **"setup_required" hatası** → `/setup` sayfasını tamamla.
- **Google callback "Invalid state"** → cookie'yi engelleyen bir proxy var
  mı? `SameSite=Lax` gerekli.
- **Migration failed** → `docker compose logs app` bak; genelde DB bağlantı
  sorunudur, `depends_on: service_healthy` bekler.
