const { Sequelize } = require('sequelize');

const poolConfig = { max: 10, min: 0, acquire: 30000, idle: 10000 };

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'mysql',
    logging: false,
    pool: poolConfig,
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
    }
  );
}

module.exports = sequelize;
