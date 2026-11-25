const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Risk treatment plan item (ISO/IEC 27001:2022 6.1.3 e, 8.3; ISO/IEC 27005:2022
// clause 9): one planned measure of a risk with option, responsible person or
// group, due date, status and costs. Optionally linked to an existing control
// and/or task; a task created from the item keeps the status in step
// (services/riskTreatmentService.js). The free-text risks.treatment_plan stays
// as it was - items are an addition, nothing is converted.
const RiskTreatmentItem = sequelize.define('RiskTreatmentItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  treatment_option: { type: DataTypes.ENUM('mitigate', 'transfer', 'avoid', 'accept'), allowNull: false, defaultValue: 'mitigate' },
  // Responsible: a user OR a group (mutually exclusive, like tasks).
  responsible_user_id: { type: DataTypes.INTEGER },
  responsible_group_id: { type: DataTypes.INTEGER },
  due_date: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.ENUM('planned', 'in_progress', 'implemented', 'discarded'), allowNull: false, defaultValue: 'planned' },
  // Mandatory when discarded.
  status_reason: { type: DataTypes.TEXT },
  completed_at: { type: DataTypes.DATE },
  // Costs in EUR: one-off and recurring (per year).
  cost_once: { type: DataTypes.DECIMAL(14, 2) },
  cost_recurring: { type: DataTypes.DECIMAL(14, 2) },
  control_id: { type: DataTypes.INTEGER },
  task_id: { type: DataTypes.INTEGER },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by_id: { type: DataTypes.INTEGER },
}, {
  tableName: 'risk_treatment_items', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ fields: ['risk_id'] }, { fields: ['task_id'] }, { fields: ['status', 'due_date'] }],
});

module.exports = RiskTreatmentItem;
