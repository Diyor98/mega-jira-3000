# Mega Jira 3000 — AWS EC2 Deployment Guide

## Architecture

```
Browser → :3000 (Next.js) → :3001 (NestJS API) → PostgreSQL + Redis
```

All services run on a single EC2 instance via Docker Compose.

---

## Prerequisites

- AWS account with EC2 access
- SSH key pair created in your target region
- Basic familiarity with AWS Console and SSH

---

## Step 1: Launch EC2 Instance

1. Go to **EC2 > Launch Instance** in AWS Console

2. Configure:
   - **Name:** `mega-jira-3000`
   - **AMI:** Amazon Linux 2023 (or Ubuntu 24.04)
   - **Instance type:** `t3.medium` (2 vCPU, 4 GB RAM — minimum for building Docker images)
   - **Key pair:** Select your existing key pair (or create one)
   - **Storage:** 30 GB gp3

3. **Security Group** — create or select one with these inbound rules:

   | Type | Port | Source | Purpose |
   |------|------|--------|---------|
   | SSH | 22 | Your IP | SSH access |
   | Custom TCP | 3000 | 0.0.0.0/0 | Frontend (Next.js) |
   | Custom TCP | 3001 | 0.0.0.0/0 | API (NestJS) |

4. Launch and note the **Public IPv4 address** (e.g., `54.123.45.67`)

---

## Step 2: Connect and Install Docker

SSH into your instance:

```bash
ssh -i your-key.pem ec2-user@54.123.45.67
```

> On Ubuntu, use `ubuntu@...` instead of `ec2-user@...`

### Amazon Linux 2023:

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install Docker Compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Apply group change (or logout/login)
newgrp docker
```

### Ubuntu 24.04:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ubuntu
newgrp docker
```

Verify:

```bash
docker --version
docker compose version
```

---

## Step 3: Clone and Configure

```bash
git clone https://github.com/YOUR_USERNAME/bmad-final.git
cd bmad-final
```

> If your repo is private, use SSH: `git clone git@github.com:YOUR_USERNAME/bmad-final.git`
> Or use a personal access token: `git clone https://TOKEN@github.com/YOUR_USERNAME/bmad-final.git`

### Create production environment file

```bash
cp docker/.env.prod.example docker/.env.prod
nano docker/.env.prod
```

Update these values — **replace `YOUR_EC2_PUBLIC_IP` with your actual EC2 IP**:

```env
# Database
DB_USER=mega
DB_PASSWORD=super_secure_db_password_2026
DB_NAME=mega_prod

# Redis
REDIS_PASSWORD=super_secure_redis_password_2026

# JWT — generate a random string: openssl rand -base64 32
JWT_SECRET=YOUR_RANDOM_32_CHAR_STRING_HERE
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Ports
API_PORT=3001
WEB_PORT=3000

# URLs — CRITICAL: use your EC2 public IP
NEXT_PUBLIC_API_URL=http://54.123.45.67:3001/api/v1
WEB_URL=http://54.123.45.67:3000
```

Generate a secure JWT secret:

```bash
openssl rand -base64 32
```

---

## Step 4: Build and Start

```bash
cd docker
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This will:
1. Build the API Docker image (NestJS)
2. Build the Web Docker image (Next.js with standalone output)
3. Start PostgreSQL 16, Redis 7, API, and Web containers

First build takes 3-5 minutes. Watch the logs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

Wait until you see:
```
api-1  | API running on http://localhost:3001
web-1  | ▲ Next.js 16.x
web-1  |   - Local: http://localhost:3000
```

---

## Step 5: Run Database Migrations

The database is empty — you need to run Drizzle migrations:

```bash
# Enter the API container
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api sh

# Inside the container, run migrations
# Note: drizzle-kit needs the schema files which aren't in the prod image
# Instead, we'll run migrations from outside using a one-off container
exit
```

Actually, the simplest approach — run migrations from the build stage:

```bash
# Run migrations using a temporary container with full build context
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api sh -c "
  cd /app && node -e \"
    const postgres = require('postgres');
    const fs = require('fs');
    const sql = postgres(process.env.DATABASE_URL);
    async function migrate() {
      const files = fs.readdirSync('/app/migrations').filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        console.log('Running migration:', file);
        const content = fs.readFileSync('/app/migrations/' + file, 'utf8');
        const statements = content.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          await sql.unsafe(stmt);
        }
      }
      console.log('All migrations complete');
      await sql.end();
    }
    migrate().catch(e => { console.error(e); process.exit(1); });
  \"
"
```

---

## Step 6: Verify

### Health check:

```bash
curl http://localhost:3001/api/v1/health
```

Expected: `{"data":{"status":"ok"}}`

### From your browser:

- **Frontend:** `http://54.123.45.67:3000`
- **API Health:** `http://54.123.45.67:3001/api/v1/health`

### Register a user:

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123"}'
```

### Test login:

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123"}' \
  -c cookies.txt -v
```

### Create a project (with auth cookie):

```bash
curl -X POST http://localhost:3001/api/v1/projects \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Mega Platform","key":"MEGA"}'
```

### Create an issue:

```bash
curl -X POST http://localhost:3001/api/v1/projects/MEGA/issues \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"First issue","type":"Story","priority":"P2"}'
```

---

## Management Commands

### View logs:

```bash
cd ~/bmad-final/docker
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f        # all
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api     # API only
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f web     # Web only
```

### Restart services:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart api
docker compose -f docker-compose.prod.yml --env-file .env.prod restart web
```

### Rebuild after code changes:

```bash
cd ~/bmad-final
git pull
cd docker
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build api web
```

### Stop everything:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

### Stop everything AND delete data:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
```

### Shell into a container:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api sh
docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres psql -U mega mega_prod
```

---

## Troubleshooting

### "Cannot reach server" in browser

1. Check security group allows ports 3000 and 3001 from 0.0.0.0/0
2. Verify `NEXT_PUBLIC_API_URL` uses the EC2 **public** IP, not private
3. Verify `WEB_URL` matches the URL you use in the browser (for CORS)

### API returns CORS errors

The API only allows requests from the origin in `WEB_URL`. Make sure:
- `WEB_URL=http://54.123.45.67:3000` (matches exactly what's in the browser address bar)
- No trailing slash

### Database connection refused

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Check that `postgres` is healthy. If not:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs postgres
```

### Cookies not being set (login works via curl but not browser)

Cookies with `secure: true` only work over HTTPS. In production mode (`NODE_ENV=production`), cookies are set with `secure: true`. For HTTP testing, either:
- Use HTTPS with a domain + SSL cert (recommended)
- Or temporarily override: add `COOKIE_SECURE=false` env var (requires code change)

**Quick fix for HTTP testing:** SSH into the API container and check if `NODE_ENV` is set to `production`. The cookie `secure` flag is tied to `NODE_ENV === 'production'`. If you need to test over plain HTTP, set `NODE_ENV=development` in docker-compose.prod.yml for the API service temporarily.

### Build fails with out-of-memory

`t3.micro` (1 GB RAM) is too small. Use `t3.medium` (4 GB) minimum, or add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
```

---

## Optional: Domain + HTTPS with Caddy

If you have a domain, add Caddy as a reverse proxy for automatic HTTPS:

```bash
# Install Caddy on the host (not in Docker)
sudo dnf install -y caddy   # Amazon Linux
# or
sudo apt install -y caddy   # Ubuntu
```

Create `/etc/caddy/Caddyfile`:

```
mega.yourdomain.com {
    reverse_proxy localhost:3000
}

api.mega.yourdomain.com {
    reverse_proxy localhost:3001
}
```

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

Then update your `.env.prod`:

```env
NEXT_PUBLIC_API_URL=https://api.mega.yourdomain.com/api/v1
WEB_URL=https://mega.yourdomain.com
```

Rebuild the web container (since `NEXT_PUBLIC_API_URL` is baked at build time):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build web
```

Point your DNS A records for `mega.yourdomain.com` and `api.mega.yourdomain.com` to the EC2 public IP. Caddy auto-provisions Let's Encrypt certificates.

---

## Cost Estimate

| Resource | Spec | Monthly Cost |
|----------|------|-------------|
| EC2 t3.medium | 2 vCPU, 4 GB RAM | ~$30 |
| EBS gp3 30 GB | Storage | ~$2.50 |
| **Total** | | **~$32.50/month** |

Free tier eligible: `t3.micro` works for the API alone but may struggle with Docker builds.
