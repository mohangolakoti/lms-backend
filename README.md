# LMS Backend

Production-grade Learning Management System API built with Node.js, Express, and MongoDB Atlas.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | MongoDB Atlas (Mongoose ODM) |
| Authentication | JWT (access + refresh tokens, HttpOnly cookies) |
| Storage | Cloudflare R2 (S3-compatible) |
| PDF Generation | Puppeteer (certificate rendering) |
| Email | Nodemailer (pooled SMTP) |
| Logging | Winston + daily log rotation |
| Containerisation | Docker (Alpine) |
| Deployment | Railway |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- A MongoDB Atlas account (free M0 tier works)

### 1. Clone and install

```bash
git clone <your-backend-repo-url>
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET at minimum
```

### 3. Seed the database (first time only)

```bash
npm run seed
```

This creates sample Admin, Instructor, and Student accounts for testing.

### 4. Start development server

```bash
npm run dev
```

Server starts at `http://localhost:3000`. API docs available at `http://localhost:3000/api-docs`.

---

## Environment Variables

See [`.env.example`](.env.example) for a full list with descriptions.

### Required for server to start

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret for signing access tokens (32+ chars) |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (different from JWT_SECRET) |

### Required for email features

| Variable | Description |
|----------|-------------|
| `EMAIL_HOST` | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_USER` | SMTP account email |
| `EMAIL_PASS` | SMTP App Password (not account password) |

### Required for file storage

| Variable | Description |
|----------|-------------|
| `R2_ENDPOINT` | Cloudflare R2 endpoint URL |
| `R2_ACCESS_KEY` | R2 API access key ID |
| `R2_SECRET_KEY` | R2 API secret access key |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Public CDN URL for your R2 bucket |

---

## Deployment on Railway

### 1. Create a Railway project

1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repository
3. Railway auto-detects Node.js via Nixpacks

### 2. Configure environment variables

In the Railway dashboard → your service → **Variables**, add all variables from `.env.example`.

Key production values:
```
NODE_ENV=production
MONGODB_URI=mongodb+srv://...          # Your Atlas URI
JWT_SECRET=<random 48+ char string>
JWT_REFRESH_SECRET=<different random string>
FRONTEND_URL=https://your-app.vercel.app
STORAGE_PROVIDER=r2
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

### 3. Set up GitHub Actions auto-deploy

Add this secret to your GitHub repo (**Settings → Secrets → Actions**):

| Secret | Where to find it |
|--------|-----------------|
| `RAILWAY_TOKEN` | railway.app → Account Settings → Tokens → New Token |

After adding the secret, every push to `main` will:
1. Run all tests
2. Deploy to Railway automatically (only if tests pass)

### 4. Health check

Railway uses `/health/live` to verify the deployment is healthy.

```bash
curl https://your-app.railway.app/health/live
# → { "status": "ok", "timestamp": "..." }
```

---

## API Documentation

Interactive Swagger docs are available at `/api-docs` when `NODE_ENV !== production`.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with hot reload (nodemon) |
| `npm test` | Run all tests |
| `npm run test:ci` | Run tests with coverage (CI mode) |
| `npm run seed` | Seed database with sample data |

---

## Project Structure

```
backend/
├── config/          # Database and JWT configuration
├── controllers/     # Business logic (admin, auth, instructor, student)
├── middleware/      # Auth, validators, rate limiting, error handlers
├── models/          # Mongoose schemas
├── routes/          # Express route definitions
├── seed/            # Database seeding scripts
├── tests/           # Jest integration tests
├── utils/           # Utilities (email, storage, certificates, logging)
├── .env.example     # Environment variable reference
├── Dockerfile       # Production Docker image
├── railway.toml     # Railway deployment configuration
└── index.js         # Server entry point
```

---

## User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Manage students, instructors, batches, courses, announcements, certificate templates |
| **Instructor** | Author courses (modules/lessons), create assessments, grade submissions |
| **Student** | Access assigned courses, take assessments, track progress, download certificates |

---

## Default Seed Credentials

After running `npm run seed`:

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@lms.com` | `Admin@123` |
| Instructor | `instructor1@lms.com` | `Instructor@123` |
| Student | `student1@lms.com` | `Student@123` |

> ⚠️ Change these credentials immediately in any non-development environment.
