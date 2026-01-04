# Quick Start Guide

## Prerequisites
- Node.js 18+ installed
- MongoDB (choose one):
  - **MongoDB Atlas** (Cloud - Free, Recommended ⭐) - No installation needed
  - Docker (for local MongoDB)
  - MongoDB installed locally

## Setup Steps

1. **Navigate to backend directory** (if not already there)
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `MONGODB_URI` 
     - **For MongoDB Atlas**: `mongodb+srv://lms:lms@123@cluster0.vmrjoej.mongodb.net/?appName=Cluster0`
     - **For local MongoDB**: `mongodb+srv://lms:lms@123@cluster0.vmrjoej.mongodb.net/?appName=Cluster0`
   - `JWT_SECRET` (use a strong secret)
   - `JWT_REFRESH_SECRET` (use a strong secret)

   **💡 Quick MongoDB Setup:**
   - **Easiest**: Use MongoDB Atlas (free cloud database) - See `MONGODB_SETUP.md`
   - **Local**: Install Docker and run `docker-compose -f docker-compose.mongodb-only.yml up -d`

3. **Seed database** (optional)
   ```bash
   npm run seed
   ```
   This creates:
   - Admin: `admin@lms.com` / `admin123`
   - Instructors: `instructor1@lms.com`, `instructor2@lms.com` / `instructor123`
   - Students: `student1@lms.com` to `student10@lms.com` / `student123`
   - Sample courses

4. **Start server**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

5. **Access API**
   - API: http://localhost:3000
   - Swagger Docs: http://localhost:3000/api-docs
   - Health Check: http://localhost:3000/health

## Testing Authentication

1. **Login as student**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"student1@lms.com","password":"student123"}'
   ```

2. **Use token for protected routes**
   ```bash
   curl -X GET http://localhost:3000/api/students/dashboard \
     -H "Authorization: Bearer YOUR_TOKEN_HERE"
   ```

## Docker Quick Start

```bash
# Make sure you're in the backend directory
cd backend

# Start MongoDB and API
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop
docker-compose down
```

## Key Features

- ✅ JWT Authentication (Access + Refresh tokens)
- ✅ Role-based access control (Admin, Instructor, Student)
- ✅ Auto-assigned courses based on batch
- ✅ Progress tracking (course, module, lesson level)
- ✅ Assessments and quizzes
- ✅ Announcements and notifications
- ✅ Analytics dashboards
- ✅ Swagger API documentation

## API Structure

- `/api/auth/*` - Authentication endpoints
- `/api/students/*` - Student endpoints (requires student role)
- `/api/admin/*` - Admin endpoints (requires admin role)
- `/api/instructors/*` - Instructor endpoints (requires instructor/admin role)

## Next Steps

1. Configure email service for password reset (update `.env`)
2. Set up file upload storage (S3 or local)
3. Configure production environment variables
4. Set up monitoring and logging
5. Deploy to production server


