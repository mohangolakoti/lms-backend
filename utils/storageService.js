const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');

/**
 * Cloud object storage service with Cloudflare R2 as the primary provider.
 *
 * Cloudflare R2 is S3-compatible, so switching to AWS S3, GCS, or any other
 * S3-compatible provider only requires changing the three R2_* environment variables.
 *
 * Environment variables:
 *   R2_ENDPOINT       - https://<account_id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY     - R2 API access key ID
 *   R2_SECRET_KEY     - R2 API secret access key
 *   R2_BUCKET         - Bucket name (e.g. "lms-assets")
 *   R2_PUBLIC_URL     - Public CDN base URL (e.g. https://pub-<hash>.r2.dev)
 *                       If not set, presigned URLs are used instead.
 *   STORAGE_PROVIDER  - "r2" (default) | "local" (dev only — no R2 needed)
 */

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'r2';

// ---------------------------------------------------------------------------
// R2 / S3 Client (singleton)
// ---------------------------------------------------------------------------

let _r2Client = null;

const getR2Client = () => {
  if (_r2Client) return _r2Client;

  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY) {
    throw new Error(
      'R2 storage not configured. Set R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY environment variables.'
    );
  }

  _r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY,
    },
  });

  return _r2Client;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a Buffer or Readable stream to cloud storage.
 *
 * @param {object} params
 * @param {Buffer|Readable} params.body       - File content
 * @param {string}          params.key        - Storage path / object key (e.g. "certificates/CERT-2026-ABC.pdf")
 * @param {string}          params.mimeType   - Content-Type header
 * @param {string}          [params.cacheControl] - Cache-Control header (default: 1 year for static assets)
 * @returns {Promise<string>} Public URL of the uploaded object
 */
const uploadFile = async ({ body, key, mimeType, cacheControl = 'public, max-age=31536000' }) => {
  if (STORAGE_PROVIDER === 'local') {
    return uploadLocal({ body, key, mimeType });
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET environment variable is not set');

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
    CacheControl: cacheControl,
  });

  await getR2Client().send(command);
  logger.info(`Storage: uploaded ${key}`, { bucket, mimeType });

  return getPublicUrl(key);
};

/**
 * Delete an object from cloud storage.
 *
 * @param {string} key - Storage path / object key
 */
const deleteFile = async (key) => {
  if (STORAGE_PROVIDER === 'local') return deleteLocal(key);

  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET environment variable is not set');

  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await getR2Client().send(command);
  logger.info(`Storage: deleted ${key}`, { bucket });
};

/**
 * Get the public URL for a stored object.
 * Uses R2_PUBLIC_URL (CDN) if configured, otherwise generates a presigned URL valid for 7 days.
 *
 * @param {string} key - Storage path / object key
 * @returns {Promise<string>|string} URL
 */
const getPublicUrl = (key) => {
  if (process.env.R2_PUBLIC_URL) {
    const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
    return `${base}/${key}`;
  }
  // Fall back to presigned URL if no public domain is configured
  return getPresignedUrl(key);
};

/**
 * Generate a short-lived presigned URL for private objects.
 *
 * @param {string} key           - Storage path / object key
 * @param {number} [expiresIn]   - TTL in seconds (default: 604800 = 7 days)
 * @returns {Promise<string>} Presigned URL
 */
const getPresignedUrl = async (key, expiresIn = 604800) => {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET environment variable is not set');

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getR2Client(), command, { expiresIn });
};

// ---------------------------------------------------------------------------
// Local fallback (development without R2)
// ---------------------------------------------------------------------------

const fs = require('fs/promises');
const path = require('path');

const localRoot = path.resolve(process.env.UPLOAD_PATH || './uploads');

const uploadLocal = async ({ body, key }) => {
  const filePath = path.join(localRoot, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  // Return a URL relative to the API base for local development
  return `/uploads/${key.replace(/\\/g, '/')}`;
};

const deleteLocal = async (key) => {
  const filePath = path.join(localRoot, key);
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  getPublicUrl,
  getPresignedUrl,
};
