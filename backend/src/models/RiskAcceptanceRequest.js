const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Request to accept a risk (ISO/IEC 27001:2022 6.1.3 f, ISO/IEC 27005:2022 9.6):
// four-eyes principle. A requester states the justification, the requested
// validity and the residual risk; a person with acceptance authority under the
// active methodology who is NOT the requester approves or rejects it. The risk
// owner confirms the acceptance of the residual risk (owner_confirmed).
//
// residual_* is a snapshot of the level the request is about: if the level of
// the risk changes before the decision, the request can no longer be approved.
// Acceptances given before 3.8.0 stay valid on the risk itself (accepted_by_id,
// accepted_until) without a request - nothing is migrated.
const RiskAcceptanceRequest = sequelize.define('RiskAcceptanceRequest', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'withdrawn'), allowNull: false, defaultValue: 'pending' },
  justification: { type: DataTypes.TEXT, allowNull: false },
  residual_risk_description: { type: DataTypes.TEXT },
  requested_until: { type: DataTypes.DATEONLY },
  residual_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },
  residual_likelihood: { type: DataTypes.INTEGER },
  residual_impact: { type: DataTypes.INTEGER },
  methodology_id: { type: DataTypes.INTEGER },
  requested_by_id: { type: DataTypes.INTEGER },
  requested_at: { type: DataTypes.DATE, allowNull: false },
  decided_by_id: { type: DataTypes.INTEGER },
  decided_at: { type: DataTypes.DATE },
  decision_reason: { type: DataTypes.TEXT },
  approved_until: { type: DataTypes.DATEONLY },
  owner_confirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  owner_confirmed_by_id: { type: DataTypes.INTEGER },
  owner_confirmed_at: { type: DataTypes.DATE },
  // Set when an approved acceptance ends on the risk: revoked, lapsed (level
  // rose) or superseded by a later approval. The decision itself stays.
  ended_at: { type: DataTypes.DATE },
  end_reason: { type: DataTypes.STRING(30) },
}, {
  tableName: 'risk_acceptance_requests', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ fields: ['risk_id', 'status'] }],
});

module.exports = RiskAcceptanceRequest;
