# MongoDB Setup Guide

## Issue: Connection Refused Error

If you see `ECONNREFUSED ::1:27017` or `ECONNREFUSED 127.0.0.1:27017`, MongoDB is not running.

## Option 1: Using MongoDB Atlas (Cloud - Easiest & Free) ⭐ RECOMMENDED

**No installation required!**

1. **Sign up for free account**
   - Visit: https://www.mongodb.com/cloud/atlas/register
   - Create a free M0 cluster (512MB storage)

2. **Create database user**
   - Go to Database Access → Add New Database User
   - Create username/password (save these!)

3. **Whitelist your IP**
   - Go to Network Access → Add IP Address
   - Click "Add Current IP Address" or use `0.0.0.0/0` for development

4. **Get connection string**
   - Go to Database → Connect → Connect your application
   - Copy the connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/`)

5. **Update `.env` file** (in backend directory)
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/institutional-lms?retryWrites=true&w=majority
   ```
   Replace `username`, `password`, and `cluster` with your actual values.
   **Note:** Make sure to URL-encode special characters in password (e.g., `@` becomes `%40`)

6. **Test connection** (from backend directory)
   ```bash
   cd backend
   npm run seed
   ```

## Option 2: Using Docker (If Docker is installed)

### Install Docker Desktop (if not installed)
- Download: https://www.docker.com/products/docker-desktop/
- Install and restart your computer

### Start MongoDB with Docker

```bash
# Navigate to backend directory
cd backend

# Start MongoDB only (simplest)
docker-compose -f docker-compose.mongodb-only.yml up -d

# Or start everything (MongoDB + API)
docker-compose up -d

# Check if running
docker ps

# View logs
docker-compose logs mongodb

# Stop MongoDB
docker-compose -f docker-compose.mongodb-only.yml down
```

If you have Docker installed, use docker-compose:

```bash
# Start MongoDB and API together
docker-compose up -d

# Or start only MongoDB
docker-compose up -d mongodb

# Check if MongoDB is running
docker-compose ps
```

This will start MongoDB on port 27017 automatically.

## Option 2: Install and Run MongoDB Locally

### Windows:

1. **Download MongoDB Community Server**
   - Visit: https://www.mongodb.com/try/download/community
   - Download Windows installer
   - Run the installer and follow the setup wizard

2. **Start MongoDB Service**
   ```powershell
   # Start MongoDB service
   net start MongoDB
   
   # Or if installed as a service, it should start automatically
   ```

3. **Verify MongoDB is running**
   ```powershell
   # Check MongoDB service status
   Get-Service MongoDB
   
   # Or test connection
   mongosh
   ```

### Alternative: Run MongoDB Manually

```powershell
# Navigate to MongoDB bin directory (usually)
cd "C:\Program Files\MongoDB\Server\7.0\bin"

# Start MongoDB
.\mongod.exe --dbpath "C:\data\db"
```

**Note:** Make sure the `C:\data\db` directory exists or create it first.

## Option 3: Use MongoDB Atlas (Cloud - Free Tier)

1. Sign up at https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Get connection string
4. Update `.env` file:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/institutional-lms
   ```

## Verify Connection

After starting MongoDB, test the connection:

```bash
# Test with mongosh (MongoDB Shell)
mongosh

# Or test with Node.js
node -e "require('mongoose').connect('mongodb+srv://lms:lms@123@cluster0.vmrjoej.mongodb.net/?appName=Cluster0').then(() => console.log('Connected!')).catch(e => console.log('Error:', e.message))"
```

## Troubleshooting

### Port 27017 Already in Use
```powershell
# Find what's using port 27017
netstat -ano | findstr :27017

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

### MongoDB Service Won't Start
- Check MongoDB logs (usually in `C:\Program Files\MongoDB\Server\7.0\log\`)
- Ensure you have admin privileges
- Try running MongoDB manually instead of as a service

### Permission Issues
- Run PowerShell/Command Prompt as Administrator
- Ensure MongoDB data directory has proper permissions

## Quick Start with Docker

The easiest way is to use Docker Compose:

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs mongodb

# Stop everything
docker-compose down
```

This will automatically:
- Download MongoDB image
- Start MongoDB container
- Set up the database
- Configure networking

