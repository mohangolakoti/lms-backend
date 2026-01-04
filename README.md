# Institutional Learning Management System (LMS) - Backend

A production-grade backend for an Institutional Learning Management System built with Node.js, Express.js, and MongoDB. This LMS is designed for institutions where students automatically get access to courses assigned based on their batch/term.

## Features

- **Authentication & Authorization**: JWT-based authentication with role-based access control (Admin, Instructor, Student)
- **Auto-Assigned Courses**: Students automatically see courses matching their batch (longTerm/shortTerm)
- **Progress Tracking**: Comprehensive progress tracking for courses, modules, and lessons
- **Assessments & Quizzes**: Create and submit assessments with automatic grading
- **Announcements & Notifications**: Global and course-specific announcements with notifications
- **Analytics Dashboard**: Admin and instructor dashboards with detailed analytics
- **Security**: Helmet, CORS, rate limiting, input validation
- **API Documentation**: Swagger/OpenAPI documentation
- **Docker Support**: Dockerfile and docker-compose for easy deployment

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (Access + Refresh tokens)
- **Security**: Helmet, CORS, express-rate-limit, bcryptjs
- **Validation**: express-validator
- **Logging**: Winston
- **Documentation**: Swagger/OpenAPI

## Project Structure

```
backend/
  /config          - Configuration files (database, JWT)
  /controllers     - Route controllers (auth, student, admin, instructor)
  /models          - Mongoose models (User, Course, Progress, Assessment, etc.)
  /routes          - Express routes
  /middleware      - Custom middleware (auth, error handling, rate limiting)
  /utils           - Utility functions (logger, token generation, email)
  /seed            - Database seed data
  index.js         - Application entry point
  package.json     - Dependencies and scripts
  .env             - Environment variables (create from .env.example)
```

## Installation

### Prerequisites

- Node.js 18+ installed
- MongoDB installed and running (or use Docker)
- npm or yarn

### Local Setup

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and set your configuration:
   ```env
   NODE_ENV=development
   PORT=3000
   MONGODB_URI=mongodb+srv://lms:lms@123@cluster0.vmrjoej.mongodb.net/?appName=Cluster0
   JWT_SECRET=your-super-secret-jwt-key
   JWT_REFRESH_SECRET=your-super-secret-refresh-key
   FRONTEND_URL=http://localhost:3001
   ```

4. **Seed the database** (optional)
   ```bash
   npm run seed
   ```

5. **Start the server**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

6. **Access API Documentation**
   - Swagger UI: http://localhost:3000/api-docs
   - Health Check: http://localhost:3000/health

## Docker Setup

### Using Docker Compose

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Build and start containers**
   ```bash
   docker-compose up -d
   ```

3. **View logs**
   ```bash
   docker-compose logs -f api
   ```

4. **Stop containers**
   ```bash
   docker-compose down
   ```

### Using Dockerfile only

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Build the image**
   ```bash
   docker build -t lms-backend .
   ```

3. **Run the container**
   ```bash
   docker run -p 3000:3000 --env-file .env lms-backend
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgotpassword` - Request password reset
- `PUT /api/auth/resetpassword/:token` - Reset password
- `PUT /api/auth/updatepassword` - Update password

### Student Routes (Protected)
- `GET /api/students/dashboard` - Get student dashboard
- `GET /api/students/courses` - Get assigned courses
- `GET /api/students/courses/:courseId` - Get course details
- `PUT /api/students/courses/:courseId/lessons/:lessonId/progress` - Update lesson progress
- `GET /api/students/assessments` - Get assessments
- `POST /api/students/assessments/:assessmentId/submit` - Submit assessment
- `GET /api/students/announcements` - Get announcements
- `GET /api/students/notifications` - Get notifications
- `PUT /api/students/notifications/:notificationId/read` - Mark notification as read

### Admin Routes (Protected)
- `GET /api/admin/dashboard` - Get admin dashboard stats
- `GET /api/admin/students` - Get all students
- `GET /api/admin/students/:id` - Get student details
- `PUT /api/admin/students/:id/status` - Block/unblock student
- `GET /api/admin/courses` - Get all courses
- `POST /api/admin/courses` - Create course
- `PUT /api/admin/courses/:id` - Update course
- `DELETE /api/admin/courses/:id` - Delete course
- `GET /api/admin/courses/:id/analytics` - Get course analytics
- `POST /api/admin/announcements` - Create announcement
- `GET /api/admin/instructors` - Get all instructors

### Instructor Routes (Protected)
- `GET /api/instructors/dashboard` - Get instructor dashboard
- `GET /api/instructors/courses` - Get instructor's courses
- `POST /api/instructors/courses` - Create course
- `PUT /api/instructors/courses/:id` - Update course
- `POST /api/instructors/courses/:id/modules` - Add module
- `PUT /api/instructors/courses/:courseId/modules/:moduleId` - Update module
- `DELETE /api/instructors/courses/:courseId/modules/:moduleId` - Delete module
- `POST /api/instructors/courses/:courseId/modules/:moduleId/lessons` - Add lesson
- `PUT /api/instructors/courses/:courseId/modules/:moduleId/lessons/:lessonId` - Update lesson
- `DELETE /api/instructors/courses/:courseId/modules/:moduleId/lessons/:lessonId` - Delete lesson
- `POST /api/instructors/assessments` - Create assessment
- `GET /api/instructors/assessments` - Get assessments
- `GET /api/instructors/courses/:courseId/progress` - Get student progress
- `GET /api/instructors/assessments/:assessmentId/submissions` - Get submissions
- `PUT /api/instructors/submissions/:submissionId/grade` - Grade submission

## Authentication

All protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Getting Access Token

1. Login via `POST /api/auth/login`
2. Receive `token` and `refreshToken` in response
3. Use `token` for subsequent API calls

## Seed Data

The seed script creates:
- 1 Admin user: `admin@lms.com` / `admin123`
- 2 Instructors: `instructor1@lms.com`, `instructor2@lms.com` / `instructor123`
- 10 Students: `student1@lms.com` to `student10@lms.com` / `student123`
- 3 Sample courses with modules and lessons

Run seed: `npm run seed`

## Models

### User
- name, email, password, mobile
- role: admin | instructor | student
- status: active | blocked
- batch: longTerm | shortTerm (for students)
- externalProfiles, avatarUrl, lastLogin

### Course
- title, description, term, level
- modules[] with lessons[]
- visibility: published | draft
- instructorId

### Progress
- userId, courseId
- moduleProgress[], lessonProgress[]
- totalTimeSpent, overallCoursePercentage
- completed, completedAt

### Assessment
- courseId, moduleId (optional)
- title, questions[], duration
- totalMarks, passingMarks
- visibility: published | draft

### Submission
- userId, assessmentId
- answers[], score, percentage
- passed, timeTaken, submittedAt

### Announcement
- title, message
- target: global | course
- courseId (if course-specific)
- pinned, createdBy

### Notification
- userId, type, title, message
- payload, read, readAt

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcryptjs for password encryption
- **Rate Limiting**: Prevents brute force attacks
- **Helmet**: Security headers
- **CORS**: Configurable cross-origin resource sharing
- **Input Validation**: express-validator for request validation
- **Blocked User Check**: Blocked users cannot access protected routes

## Error Handling

Centralized error handling middleware catches and formats all errors:
- Validation errors
- Database errors
- Authentication errors
- Custom application errors

## Logging

Winston logger configured for:
- Console output (development)
- File logging (error.log, combined.log)
- Structured JSON logging

## Testing

```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong JWT secrets
3. Configure MongoDB connection string
4. Set up proper CORS origins
5. Configure email service for password reset
6. Set up file storage (S3 or local)
7. Use process manager (PM2) or container orchestration

## Environment Variables

See `.env.example` for all available environment variables.

## License

ISC

## Support

For issues and questions, please contact the development team.


