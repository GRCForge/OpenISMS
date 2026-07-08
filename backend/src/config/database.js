const { Sequelize } = require('sequelize');

// min:2 keeps a small warm floor so the first request after an idle period does
// not pay a full MySQL connect+auth handshake (min:0 dropped every idle conn).
// connectTimeout fails fast on a dead DB instead of hanging up to `acquire` (30s).
const poolConfig = {
  max: Number(process.env.DB_POOL_MAX || 10),
  min: Number(process.env.DB_POOL_MIN || 2),
  acquire: 30000,
  idle: 10000,
};
const dialectOptions = { connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000) };

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'mysql',
    logging: false,
    pool: poolConfig,
    dialectOptions,
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'isms',
    process.env.DB_USER || 'isms_user',
    process.env.DB_PASSWORD || 'isms_password',
    {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      dialect: 'mysql',
      logging: false,
      pool: poolConfig,
      dialectOptions,
    }
  );
}

module.exports = sequelize;
