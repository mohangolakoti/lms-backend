const isProduction = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || (!isProduction ? 'dev-only-secret-change-me' : undefined);
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || (!isProduction ? 'dev-only-refresh-secret-change-me' : undefined);

if (isProduction && (!jwtSecret || !jwtRefreshSecret)) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set in production');
}

module.exports = {
  jwtSecret,
  jwtRefreshSecret,
  jwtExpire: process.env.JWT_EXPIRE || '15m',
  jwtRefreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',
};


