const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VendorContact = sequelize.define('VendorContact', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  vendor_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  email: { type: DataTypes.STRING(200) },
  phone: { type: DataTypes.STRING(50) },
  role: { type: DataTypes.STRING(100) },
  notes: { type: DataTypes.TEXT },
});

module.exports = VendorContact;
