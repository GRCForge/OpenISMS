'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const { Op } = require('sequelize');
const express = require('express');
const { createMcpCors } = require('./cors');
const { hashToken } = require('../services/cryptoService');
const {
  BSI_LAYERS, LAYER_ALIASES: BSI_LAYER_ALIASES, normalizeBsiLayer,
  BSI_STATUSES, STATUS_ALIASES: BSI_STATUS_ALIASES, normalizeBsiStatus,
} = require('../services/bsiLayers');
const bsiDomains = require('../services/bsiDomainService');
const bsiCheck = require('../services/bsiCheckService');

// ─── Auth ────────────────────────────────────────────────────────────────────
// See ./auth.js (token types) and ./oauthResource.js (OAuth 2.1 resource server).
const { mcpAuth, describeAuthModes } = require('./auth');

// ─── Models (loaded lazily so DB is ready) ───────────────────────────────────

function getModels() {
  return require('../models');
}

// ─── Audit & User logging helpers ────────────────────────────────────────────

async function logAudit(action, entityType, entityId, entityName, details = {}, mcpUser = null) {
  try {
    const { AuditLog } = getModels();
    await AuditLog.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      actor_id: mcpUser?.id || null,
      actor_name: mcpUser?.name || 'MCP Client',
      details,
      ip_address: '127.0.0.1',
    });
  } catch (e) {
    console.error('[MCP Audit] Failed to write log:', e.message);
  }
}

async function getValidUserId(mcpUser) {
  let userId = mcpUser?.id || null;
  if (!userId || userId === 0) {
    const { User } = getModels();
    const { findUserIdsWithRole } = require('../services/accessService');
    const [adminId] = await findUserIdsWithRole('admin');
    const firstUser = (adminId && await User.findByPk(adminId)) || await User.findOne();
    userId = firstUser ? firstUser.id : 1;
  }
  return userId;
}

// ─── Permission & Module Gating ──────────────────────────────────────────────

const TOOL_GATES = {
  // --- Assets & CVEs ---
  'isms_create_asset': { perm: ['assets', 'create'], needsWrite: true },
  'isms_update_asset': { perm: ['assets', 'edit_basics'], needsWrite: true },
  'isms_delete_asset': { perm: ['assets', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_refresh_asset_cves': { perm: ['assets', 'cve'], needsWrite: true },
  'isms_refresh_all_asset_cves': { perm: ['assets', 'cve'], requiredRoles: ['admin', 'it-staff'] },
  'isms_suggest_cpe': { perm: ['assets', 'cve'], moduleKey: 'discovery' },
  'isms_resolve_cpe': { perm: ['assets', 'cve'], moduleKey: 'discovery', needsWrite: true },
  'isms_create_assessment': { perm: ['assessments', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Drittsystem-Anbindungen ---
  // Lesen darf, wer das Inventar bewertet; ausloesen nur Admin/IT. Die
  // Konfiguration inkl. Secret bleibt der Weboberflaeche vorbehalten und ist
  // bewusst NICHT ueber MCP aenderbar.
  'isms_checkmk_status': { perm: ['integrations', 'view'], requiredRoles: ['admin', 'it-staff', 'assessor'] },
  'isms_checkmk_hosts': { perm: ['integrations', 'view'], requiredRoles: ['admin', 'it-staff', 'assessor'] },
  'isms_checkmk_sync': { perm: ['integrations', 'sync'], requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  // --- Risks & Threats ---
  'isms_create_risk': { perm: ['risks', 'create'], needsWrite: true },
  'isms_update_risk': { perm: ['risks', 'edit'], needsWrite: true },
  // Freigabe ohne needsWrite: Die Geschaeftsleitung (management, sonst nur
  // lesend) soll akzeptieren koennen, wenn die Methodik es ihr zuweist. Wer
  // welche Stufe akzeptieren darf, prueft services/riskService.js.
  'isms_signoff_risk': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner', 'management'] },
  'isms_revoke_risk_signoff': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner', 'management'] },
  'isms_delete_risk': { perm: ['risks', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  // Same matrix entries as PATCH /api/risks/:id/residual-override and the
  // category routes; record rights in services/riskService.js.
  'isms_override_risk_residual': { perm: ['risks', 'override_residual'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // Risk treatment plan and acceptance workflow (3.8.0): same matrix entries
  // as the routes in routes/risks.js; record rights, four-eyes principle and
  // acceptance authority in services/riskService.js.
  'isms_list_risk_treatment_items': { perm: ['risks', 'view'] },
  'isms_create_risk_treatment_item': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_risk_treatment_item': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_create_task_from_treatment_item': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_get_risk_treatment_plan': { perm: ['risks', 'view'] },
  'isms_list_risk_acceptance_requests': { perm: ['risks', 'view'] },
  'isms_request_risk_acceptance': { perm: ['risks', 'request_acceptance'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_withdraw_risk_acceptance': { perm: ['risks', 'request_acceptance'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  // Deciding without needsWrite, like isms_signoff_risk (management decides).
  'isms_approve_risk_acceptance': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner', 'management'] },
  'isms_reject_risk_acceptance': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner', 'management'] },
  // Any role may own a risk; the owner check is in the service.
  'isms_confirm_risk_acceptance_as_owner': { perm: ['risks', 'view'] },
  // Risk monitoring (3.9.0): same matrix entries as the routes in
  // routes/risks.js; record rights in the services.
  'isms_get_risk_history': { perm: ['risks', 'view'] },
  'isms_get_risk_trend': { perm: ['risks', 'view'] },
  'isms_get_risk_monitoring_summary': { perm: ['risks', 'view'] },
  'isms_list_risk_review_flags': { perm: ['risks', 'view'] },
  'isms_review_risk': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_list_risk_kris': { perm: ['risks', 'view'] },
  'isms_link_risk_kri': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_risk_kri': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_unlink_risk_kri': { perm: ['risks', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_create_risk_category': { perm: ['risks', 'manage_methodology'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_risk_category': { perm: ['risks', 'manage_methodology'], requiredRoles: ['admin'], needsWrite: true },
  // Vulnerability register: like routes/vulnerabilities.js.
  'isms_list_vulnerabilities': { perm: ['vulnerabilities', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management'] },
  'isms_create_vulnerability': { perm: ['vulnerabilities', 'manage'], requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_update_vulnerability': { perm: ['vulnerabilities', 'manage'], requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_delete_vulnerability': { perm: ['vulnerabilities', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_import_asset_cves_as_vulnerabilities': { perm: ['vulnerabilities', 'manage'], requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_create_threat': { perm: ['threats', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Management Reviews ---
  'isms_create_review_signoff': { perm: ['review', 'sign_off'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Incidents ---
  'isms_create_incident': { perm: ['incidents', 'create'], needsWrite: true },
  'isms_update_incident_status': { perm: ['incidents', 'edit'], needsWrite: true },
  'isms_update_incident': { perm: ['incidents', 'edit'], needsWrite: true },
  'isms_delete_incident': { perm: ['incidents', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  // --- Tasks & Reminders ---
  'isms_create_task': { perm: ['tasks', 'create'], needsWrite: true },
  'isms_update_task': { perm: ['tasks', 'edit'], needsWrite: true },
  'isms_complete_task': { perm: ['tasks', 'edit'], needsWrite: true },
  'isms_delete_task': { perm: ['tasks', 'delete'], needsWrite: true },
  'isms_acknowledge_reminder': { perm: ['reminders', 'acknowledge'], needsWrite: true },
  'isms_dismiss_reminder': { perm: ['reminders', 'acknowledge'], needsWrite: true },
  // --- Controls ---
  'isms_create_control': { perm: ['controls', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_control_status': { perm: ['controls', 'edit'], needsWrite: true },
  'isms_update_control': { perm: ['controls', 'edit'], needsWrite: true },
  'isms_delete_control': { perm: ['controls', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Compliance Catalogs ---
  'isms_list_iso27001_controls': { perm: ['iso27001', 'view'], moduleKey: 'iso27001' },
  'isms_update_iso27001_control': { perm: ['iso27001', 'edit'], moduleKey: 'iso27001', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_bsi_requirements': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_update_bsi_requirement': { perm: ['bsi_grundschutz', 'edit'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  // Informationsverbund / Modellierung: dieselben Matrix-Eintraege wie die REST-Routen
  // (routes/bsi-domains.js) und dieselbe Logik (services/bsiDomainService.js).
  'isms_list_bsi_domains': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_get_bsi_domain': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_suggest_bsi_modeling': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_assign_bsi_target_object': { perm: ['bsi_grundschutz', 'manage_domain'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_model_bsi_module': { perm: ['bsi_grundschutz', 'manage_domain'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // IT-Grundschutz-Check: wie GET/PUT /api/bsi-grundschutz/domains/:id/check.
  'isms_get_bsi_check': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_set_bsi_check_status': { perm: ['bsi_grundschutz', 'edit'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  // Risk analysis per BSI 200-3 and realisation plan (3.10.0): same matrix
  // entries as the routes in routes/bsi-domains.js; risks.create/edit, record
  // rights and visibility in services/bsiRiskAnalysisService.js.
  'isms_get_bsi_risk_analysis': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_set_bsi_risk_analysis_target': { perm: ['bsi_grundschutz', 'risk_analysis'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_assess_bsi_threat': { perm: ['bsi_grundschutz', 'risk_analysis'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_classify_bsi_threat': { perm: ['bsi_grundschutz', 'risk_analysis'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_get_bsi_realization_plan': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  // Report catalogue: metadata and download paths only, no binary data. Each
  // entry is filtered by the permission of its download endpoint.
  'isms_list_reports': { perm: ['reports', 'view'] },
  // --- Bedrohungslage / Threat Intelligence ---
  'isms_list_threat_sources': { perm: ['threat_intel', 'view'], moduleKey: 'threat_intel' },
  'isms_list_threat_advisories': { perm: ['threat_intel', 'view'], moduleKey: 'threat_intel' },
  'isms_get_threat_intel_stats': { perm: ['threat_intel', 'view'], moduleKey: 'threat_intel' },
  'isms_create_threat_advisory': { perm: ['threat_intel', 'create'], moduleKey: 'threat_intel', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_assess_threat_advisory': { perm: ['threat_intel', 'assess'], moduleKey: 'threat_intel', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_record_threat_source_review': { perm: ['threat_intel', 'review'], moduleKey: 'threat_intel', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_nis2_measures': { perm: ['nis2', 'view'], moduleKey: 'nis2' },
  'isms_list_nis2_self_check': { perm: ['nis2', 'view'], moduleKey: 'nis2' },
  'isms_get_nis2_gaps': { perm: ['nis2', 'view'], moduleKey: 'nis2' },
  'isms_answer_nis2_self_check': { perm: ['nis2', 'edit'], moduleKey: 'nis2', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_nis2_measure': { perm: ['nis2', 'edit'], moduleKey: 'nis2', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_list_c5_criteria': { perm: ['c5', 'view'], moduleKey: 'c5' },
  'isms_update_c5_criterion': { perm: ['c5', 'edit'], moduleKey: 'c5', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_tisax_requirements': { perm: ['tisax', 'view'], moduleKey: 'tisax' },
  'isms_update_tisax_requirement': { perm: ['tisax', 'edit'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_list_tisax_assessments': { perm: ['tisax', 'view'], moduleKey: 'tisax' },
  'isms_create_tisax_assessment': { perm: ['tisax', 'create'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_tisax_assessment': { perm: ['tisax', 'edit'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_tisax_assessment': { perm: ['tisax', 'delete'], moduleKey: 'tisax', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Trainings ---
  'isms_create_training_course': { perm: ['compliance_trainings', 'create'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_training_course': { perm: ['compliance_trainings', 'edit'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_training_course': { perm: ['compliance_trainings', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_record_user_training': { perm: ['compliance_trainings', 'create'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_user_training': { perm: ['compliance_trainings', 'edit'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_user_training': { perm: ['compliance_trainings', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Audit Logs ---
  'isms_list_audit_logs': { perm: ['auditlog', 'view'], requiredRoles: ['admin', 'assessor'] },
  'isms_verify_audit_logs': { perm: ['auditlog', 'verify'], requiredRoles: ['admin'] },
  // --- Legal Requirements ---
  'isms_create_legal_requirement': { perm: ['legal_requirements', 'create'], needsWrite: true },
  'isms_update_legal_requirement': { perm: ['legal_requirements', 'edit'], needsWrite: true },
  'isms_delete_legal_requirement': { perm: ['legal_requirements', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- EU AI Act ---
  'isms_list_ai_systems': { perm: ['ai_act', 'view'], moduleKey: 'ai_act' },
  'isms_create_ai_system': { perm: ['ai_act', 'create'], moduleKey: 'ai_act', needsWrite: true },
  'isms_update_ai_system': { perm: ['ai_act', 'edit'], moduleKey: 'ai_act', needsWrite: true },
  'isms_delete_ai_system': { perm: ['ai_act', 'delete'], moduleKey: 'ai_act', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Policies & Templates ---
  'isms_create_policy': { perm: ['policies', 'create'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_update_policy': { perm: ['policies', 'edit'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_delete_policy': { perm: ['policies', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_acknowledge_policy': { needsWrite: true },
  'isms_delete_template': { perm: ['templates', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Audits, CAPA & KPIs ---
  'isms_create_audit': { perm: ['compliance_audits', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit': { perm: ['compliance_audits', 'edit'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_audit': { perm: ['compliance_audits', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_audit_finding': { perm: ['compliance_audits', 'create_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit_finding': { perm: ['compliance_audits', 'edit_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_audit_finding': { perm: ['compliance_audits', 'delete_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_create_kpi': { perm: ['compliance_kpis', 'create'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_kpi': { perm: ['compliance_kpis', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_kpi': { perm: ['compliance_kpis', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_record_kpi_measurement': { perm: ['compliance_kpis', 'measure'], needsWrite: true },
  // --- Settings & Admin ---
  'isms_set_feature_status': { perm: ['modules', 'edit'], requiredRoles: ['admin'] },
  'isms_get_settings': { perm: ['admin', 'settings'], requiredRoles: ['admin'] },
  'isms_update_settings': { perm: ['admin', 'settings'], requiredRoles: ['admin'], needsWrite: true },
  'isms_get_permissions': { perm: ['admin', 'permissions'], requiredRoles: ['admin'] },
  'isms_update_permissions': { perm: ['admin', 'permissions'], requiredRoles: ['admin'], needsWrite: true },
  'isms_list_custom_roles': { perm: ['admin', 'roles'], requiredRoles: ['admin'] },
  'isms_create_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_run_automation': { perm: ['admin', 'maintenance'], requiredRoles: ['admin'], needsWrite: true },
  // --- Users, Groups & Tokens ---
  'isms_create_user': { perm: ['users', 'create'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_user': { perm: ['users', 'edit'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_user': { perm: ['users', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_add_group_member': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_remove_group_member': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_api_token': { perm: ['tokens', 'create'], needsWrite: true },
  'isms_revoke_api_token': { perm: ['tokens', 'delete'], needsWrite: true },
  // --- Pentests ---
  'isms_list_pentests': { perm: ['pentests', 'view'], moduleKey: 'pentest' },
  'isms_create_pentest': { perm: ['pentests', 'create'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_pentest': { perm: ['pentests', 'edit'], moduleKey: 'pentest', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_pentest': { perm: ['pentests', 'delete'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_pentest_findings': { perm: ['pentests', 'view'], moduleKey: 'pentest' },
  'isms_create_pentest_finding': { perm: ['pentests', 'create'], moduleKey: 'pentest', needsWrite: true },
  'isms_update_pentest_finding': { perm: ['pentests', 'edit'], moduleKey: 'pentest', needsWrite: true },
  'isms_delete_pentest_finding': { perm: ['pentests', 'delete_findings'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  // --- GDPR / DSGVO ---
  'isms_list_vvt_entries': { perm: ['vvt', 'view'], moduleKey: 'dsgvo' },
  'isms_get_vvt_entry': { perm: ['vvt', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_vvt_entry': { perm: ['vvt', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_vvt_entry': { perm: ['vvt', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_vvt_entry': { perm: ['vvt', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_get_vvt_dsfa': { perm: ['vvt', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_vvt_dsfa': { perm: ['vvt', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_vvt_dsfa': { perm: ['vvt', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_vvt_dsfa': { perm: ['vvt', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_list_dataflows': { perm: ['dataflows', 'view'], moduleKey: 'dsgvo' },
  'isms_get_dataflow': { perm: ['dataflows', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_dataflow': { perm: ['dataflows', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_dataflow': { perm: ['dataflows', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_dataflow': { perm: ['dataflows', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_list_subject_requests': { perm: ['subject_requests', 'view'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo', 'assessor'] },
  'isms_create_subject_request': { perm: ['subject_requests', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  'isms_update_subject_request_status': { perm: ['subject_requests', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  'isms_delete_subject_request': { perm: ['subject_requests', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  // --- Vendors ---
  'isms_get_vendor': { perm: ['vendors', 'view_details'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_create_vendor': { perm: ['vendors', 'create'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_vendor': { perm: ['vendors', 'edit'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_vendor': { perm: ['vendors', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_assess_vendor': { perm: ['vendors', 'assess'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_add_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_list_vendor_triage_runs': { perm: ['vendor_triage', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_get_vendor_triage_run': { perm: ['vendor_triage', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_run_vendor_triage': { perm: ['vendor_triage', 'run'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_get_triage_profiles': { perm: ['triage_profiles', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_update_triage_profiles': { perm: ['triage_profiles', 'edit'], requiredRoles: ['admin'], needsWrite: true },
  // --- BCM ---
  'isms_list_bcm_processes': { perm: ['bcm', 'view'], moduleKey: 'bcm' },
  'isms_create_bcm_process': { perm: ['bcm', 'create'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_bcm_process': { perm: ['bcm', 'edit'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_bcm_process': { perm: ['bcm', 'delete'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_bcm_exercises': { perm: ['bcm', 'view'], moduleKey: 'bcm' },
  'isms_create_bcm_exercise': { perm: ['bcm', 'create'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_bcm_exercise': { perm: ['bcm', 'edit'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_bcm_exercise': { perm: ['bcm', 'delete'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- DORA ---
  'isms_list_dora_third_parties': { perm: ['dora', 'view'], moduleKey: 'dora' },
  'isms_create_dora_third_party': { perm: ['dora', 'create'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_dora_third_party': { perm: ['dora', 'edit'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_dora_third_party': { perm: ['dora', 'delete'], moduleKey: 'dora', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_dora_tests': { perm: ['dora', 'view'], moduleKey: 'dora' },
  'isms_create_dora_test': { perm: ['dora', 'create'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_dora_test': { perm: ['dora', 'edit'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_dora_test': { perm: ['dora', 'delete'], moduleKey: 'dora', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Auto-Discovery ---
  'isms_list_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'] },
  'isms_approve_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  'isms_ignore_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  'isms_delete_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  // --- Comments & Documents ---
  'isms_add_asset_comment': { perm: ['comments', 'create'], needsWrite: true },
  'isms_delete_asset_comment': { perm: ['comments', 'delete'], needsWrite: true },
  'isms_delete_document': { perm: ['documents', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // Read-only tools that had no gate at all: any authenticated MCP client could
  // call them. They carry no role requirement here either — the matrix decides,
  // and where it says nothing they stay open, exactly as before.
  'isms_get_asset': { perm: ['assets', 'view'] },
  'isms_get_asset_cve_report': { perm: ['assets', 'view'] },
  'isms_get_central_cve_report': { perm: ['assets', 'cve'] },
  'isms_get_compliance_overview': { perm: ['compliance', 'view'] },
  'isms_get_dashboard': { perm: ['dashboard', 'view'] },
  'isms_get_framework_mapping_overview': { perm: ['mappings', 'view'] },
  'isms_get_framework_mapping_stats': { perm: ['mappings', 'view'] },
  'isms_get_group': { perm: ['groups', 'view'] },
  'isms_get_management_report': { perm: ['reports', 'view'] },
  'isms_get_policy': { perm: ['policies', 'view'] },
  'isms_get_policy_acknowledgments': { perm: ['policies', 'acknowledgments'] },
  'isms_get_review_signoffs': { perm: ['review', 'view'] },
  'isms_get_risk': { perm: ['risks', 'view'] },
  'isms_get_risk_methodology': { perm: ['risks', 'view'] },
  'isms_list_risk_categories': { perm: ['risks', 'view'] },
  'isms_get_task': { perm: ['tasks', 'view'] },
  'isms_get_task_stats': { perm: ['tasks', 'view'] },
  'isms_list_api_tokens': { perm: ['tokens', 'view'] },
  'isms_list_assessments': { perm: ['assessments', 'view'] },
  'isms_list_asset_comments': { perm: ['comments', 'view'] },
  'isms_list_assets': { perm: ['assets', 'view'] },
  'isms_list_audits': { perm: ['compliance_audits', 'view'] },
  'isms_list_controls': { perm: ['controls', 'view'] },
  'isms_list_documents': { perm: ['documents', 'view'] },
  'isms_list_features': { perm: ['modules', 'view'] },
  'isms_list_groups': { perm: ['groups', 'view'] },
  'isms_list_incidents': { perm: ['incidents', 'view'] },
  'isms_list_kpis': { perm: ['compliance_kpis', 'view'] },
  'isms_list_legal_requirements': { perm: ['legal_requirements', 'view'] },
  'isms_list_policies': { perm: ['policies', 'view'] },
  'isms_list_reminders': { perm: ['reminders', 'view'] },
  'isms_list_risks': { perm: ['risks', 'view'] },
  'isms_list_tasks': { perm: ['tasks', 'view'] },
  'isms_list_templates': { perm: ['templates', 'view'] },
  'isms_list_threats': { perm: ['threats', 'view'] },
  'isms_list_training_courses': { perm: ['compliance_trainings', 'view'] },
  'isms_list_user_trainings': { perm: ['compliance_trainings', 'view'] },
  'isms_list_users': { perm: ['users', 'view'] },
  'isms_list_vendors': { perm: ['vendors', 'view'] },
  'isms_lookup_framework_mappings': { perm: ['mappings', 'view'] },
};

async function gateTool(mcpUser, moduleKey = null, requiredRoles = null, needsWrite = false, perm = null) {
  if (moduleKey) {
    const { getModules } = require('../middleware/modules');
    const modules = await getModules();
    if (!modules[moduleKey]) {
      return { content: [{ type: 'text', text: `Zugriff verweigert: Das Modul '${moduleKey}' ist im ISMS nicht aktiviert.` }], isError: true };
    }
  }

  const { hasRole, isReadOnly, rolesOf, BUILTIN_ROLES } = require('../services/accessService');
  const denyWrite = () => ({ content: [{ type: 'text', text: 'Zugriff verweigert: Schreibrechte erforderlich.' }], isError: true });

  // Same contract as requirePermission on the REST side: each role of the user
  // is asked, and one that allows is enough. Its permission set decides where it
  // defines module+action; where it says nothing, the tool's role list decides
  // (no list = any role). An admin who edits the matrix or a custom role sees the
  // change here too.
  if (perm) {
    try {
      const { decide } = require('../services/permissionService');
      if (!(await decide(mcpUser, perm[0], perm[1], requiredRoles || BUILTIN_ROLES))) {
        return { content: [{ type: 'text', text: `Zugriff verweigert: Die Berechtigung '${perm[0]}.${perm[1]}' fehlt für Ihre Rollen.` }], isError: true };
      }
    } catch (e) {
      // Never fail open — a broken matrix lookup must not hand out access.
      console.error('[MCP] Permission check failed:', e.message);
      return { content: [{ type: 'text', text: 'Berechtigungsprüfung fehlgeschlagen.' }], isError: true };
    }
  } else if (requiredRoles && !hasRole(mcpUser, requiredRoles)) {
    return { content: [{ type: 'text', text: `Zugriff verweigert: Diese Aktion erfordert eine der folgenden Rollen: ${requiredRoles.join(', ')}.` }], isError: true };
  }

  // Mirrors requireWriteAccess(): viewer, management and employee are read-only;
  // one role that may write is enough.
  if (needsWrite && isReadOnly(rolesOf(mcpUser))) return denyWrite();

  return null;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

// Tools that only touch the caller's own account (cf. /api/me, /api/auth/tokens).
const SELF_SERVICE_TOOLS = new Set([
  'isms_get_my_overview', 'isms_list_notifications',
  'isms_list_api_tokens', 'isms_create_api_token', 'isms_revoke_api_token',
]);

const toolsToRegister = [];
const server = {
  tool: (name, description, schemaOrCallback, maybeCallback) => {
    let schema = null;
    let originalCallback = null;

    if (typeof schemaOrCallback === 'function') {
      originalCallback = schemaOrCallback;
    } else {
      schema = schemaOrCallback;
      originalCallback = maybeCallback;
    }

    const wrappedCallback = async (args, context) => {
      const mcpUser = context?.mcpUser || context?._mcpUser || context?.authInfo;
      const ctx = { ...context, mcpUser };
      // Roles come from groups. Without any role a user has access to their own
      // account only — the MCP equivalent of the self-service routes.
      const { rolesOf } = require('../services/accessService');
      if (rolesOf(mcpUser).length === 0 && !SELF_SERVICE_TOOLS.has(name)) {
        return { content: [{ type: 'text', text: 'Zugriff verweigert: Ihr Konto gehört zu keiner Gruppe mit einer Rolle.' }], isError: true };
      }
      const gate = TOOL_GATES[name];
      if (gate) {
        const errorResult = await gateTool(
          mcpUser,
          gate.moduleKey || null,
          gate.requiredRoles || null,
          gate.needsWrite || false,
          gate.perm || null
        );
        if (errorResult) return errorResult;
      }
      return originalCallback(args, ctx);
    };

    if (schema) {
      toolsToRegister.push([name, description, schema, wrappedCallback]);
    } else {
      toolsToRegister.push([name, description, wrappedCallback]);
    }
  }
};

// ─── Assets ──────────────────────────────────────────────────────────────────

server.tool(
  'isms_list_assets',
  'List assets from the ISMS asset register. Returns id, name, type, classification, status, hosting_type, lifecycle_status, patch_status, nis2_relevant.',
  {
    search:         z.string().optional().describe('Search in name'),
    type:           z.string().optional().describe('Filter by type (hardware, software, application, service, data, process, personal, ai_application, ai_agent, other)'),
    status:         z.string().optional().describe('Filter by status (active, inactive, decommissioned, all). Defaults to active and inactive (non-decommissioned) assets.'),
    classification: z.string().optional().describe('Filter by classification (public, internal, confidential, secret)'),
    limit:          z.number().int().min(1).max(500).default(50).describe('Max results'),
  },
  async ({ search, type, status, classification, limit }) => {
    const { Asset } = getModels();
    const where = {};
    if (type) where.type = type;
    if (status) {
      if (status !== 'all') where.status = status;
    } else {
      where.status = { [Op.ne]: 'decommissioned' };
    }
    if (classification) where.classification = classification;
    if (search) where.name = { [Op.iLike]: `%${search}%` };

    const assets = await Asset.findAll({
      where, limit,
      order: [['name', 'ASC']],
      attributes: ['id','name','type','classification','status','hosting_type','lifecycle_status','patch_status','nis2_relevant','rto','rpo','sdo','mto','ioa','cve_critical','cve_high','created_at'],
    });
    return { content: [{ type: 'text', text: JSON.stringify(assets, null, 2) }] };
  }
);

server.tool(
  'isms_get_asset',
  'Get full details of a single asset including its latest CIA assessment, linked risks, incidents, and compliance frameworks.',
  { id: z.number().int().describe('Asset ID') },
  async ({ id }) => {
    const { Asset, Assessment, Risk, Incident, User } = getModels();
    const asset = await Asset.findByPk(id, {
      include: [
        { model: Assessment, as: 'Assessments', limit: 1, order: [['created_at', 'DESC']] },
        { model: User, as: 'owner', attributes: ['id','name','email'] },
        { model: User, as: 'assessor', attributes: ['id','name','email'] },
      ],
    });
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

server.tool(
  'isms_create_asset',
  'Create a new asset in the ISMS asset register.',
  {
    name:           z.string().min(1).describe('Asset name'),
    type:           z.enum(['hardware','software','application','service','data','process','personal','ai_application','ai_agent','other']).describe('Asset type'),
    classification: z.enum(['public','internal','confidential','secret']).default('internal'),
    description:    z.string().optional(),
    hosting_type:   z.enum(['on-premise','cloud_public','cloud_private','hybrid']).optional(),
    lifecycle_status: z.enum(['evaluation','production','maintenance','archived']).default('production'),
    nis2_relevant:  z.boolean().default(false),
    owner_id:       z.number().int().optional().describe('User ID of the asset owner. Defaults to the calling MCP user.'),
    assessor_id:    z.number().int().optional().describe('User ID of the assessor. Defaults to the calling MCP user.'),
    rto:            z.string().optional().describe('Recovery Time Objective (Wiederanlaufzeit, e.g. 4h)'),
    rpo:            z.string().optional().describe('Recovery Point Objective (Datenverlust-Toleranz, e.g. 1h)'),
    sdo:            z.string().optional().describe('Service Delivery Objective (Mindest-Service-Level im Notbetrieb, e.g. 24h)'),
    mto:            z.string().optional().describe('Maximum Tolerable Outage (Maximal tolerierbare Ausfallzeit, e.g. 48h)'),
    ioa:            z.string().optional().describe('Impact of Activity / Disruption (Ausfallwirkung, e.g. High)'),
    // Felder, die das Modell laengst kennt, hier aber bislang fehlten. Ohne sie
    // konnte ein Import Standort, Version oder Hersteller nicht mitgeben und
    // musste sie in die Beschreibung schreiben.
    location:       z.string().optional().describe('Physical or logical location (e.g. rack, site, IP)'),
    version:        z.string().optional(),
    vendor:         z.string().optional().describe('Vendor/manufacturer name (free text)'),
    tags:           z.array(z.string()).optional(),
    patch_status:   z.enum(['up-to-date','pending','critical']).optional(),
    eol_date:       z.string().optional().describe('End-of-life date (YYYY-MM-DD)'),
    external_source: z.string().optional().describe("Third-party system this asset came from, e.g. 'checkmk'"),
    external_id:    z.string().optional().describe('Identifier of this asset in the third-party system (e.g. CheckMK hostname)'),
  },
  async (args, { mcpUser }) => {
    const { Asset } = getModels();

    // owner_id und assessor_id sind im Modell NOT NULL. Sie waren hier bislang
    // optional bzw. gar nicht vorhanden, wodurch jeder Aufruf an der
    // Datenbank-Constraint scheiterte — das Tool war nie funktionsfaehig.
    // getValidUserId() faellt auf den aufrufenden MCP-Benutzer und sonst auf
    // einen Admin zurueck, so wie isms_create_assessment es bereits tut.
    const fallbackUserId = await getValidUserId(mcpUser);

    const asset = await Asset.create({
      ...args,
      owner_id: args.owner_id || fallbackUserId,
      assessor_id: args.assessor_id || fallbackUserId,
      status: 'active',
    });

    // Schreibende MCP-Aufrufe gehoerten schon immer ins Audit-Log; hier fehlte
    // der Eintrag. Ein Asset, dessen Entstehung nicht protokolliert ist, ist
    // fuer eine Nachweisfuehrung wertlos.
    await logAudit('create', 'Asset', asset.id, asset.name, {
      type: asset.type,
      classification: asset.classification,
      via: 'mcp',
      external_source: asset.external_source || null,
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

// ─── Drittsystem-Anbindung: CheckMK ──────────────────────────────────────────

server.tool(
  'isms_checkmk_status',
  'Show the CheckMK integration configuration (without the secret) and the result of the last sync run.',
  {},
  async () => {
    const { getIntegrationPublic } = require('../services/settingsService');
    return { content: [{ type: 'text', text: JSON.stringify(await getIntegrationPublic('checkmk'), null, 2) }] };
  }
);

server.tool(
  'isms_checkmk_hosts',
  'Fetch the live host list from CheckMK (name, IP, state, plugin output). Read-only, writes nothing to the ISMS.',
  {},
  async () => {
    const { getIntegrationConfig } = require('../services/settingsService');
    const { adapter } = require('../services/integrations');
    const cmk = adapter('checkmk');
    const cfg = await getIntegrationConfig('checkmk');
    if (!cfg.url || !cfg.secret) {
      return { content: [{ type: 'text', text: 'CheckMK integration is not configured.' }], isError: true };
    }
    const { hosts } = await cmk.vorschau(cfg);
    return { content: [{ type: 'text', text: JSON.stringify(hosts, null, 2) }] };
  }
);

server.tool(
  'isms_checkmk_sync',
  'Reconcile the ISMS asset register against CheckMK. Linked assets get fresh live status; unknown hosts land in the discovery staging area as pending — assets are never created automatically, approval stays a human decision. Use dry_run first.',
  {
    dry_run: z.boolean().optional().default(true).describe('true (default) reports what would change without writing anything'),
  },
  async ({ dry_run }, { mcpUser }) => {
    const { getIntegrationConfig, setIntegration } = require('../services/settingsService');
    const { adapter } = require('../services/integrations');
    const { abgleichen } = require('../services/discoverySync');
    const cmk = adapter('checkmk');

    const cfg = await getIntegrationConfig('checkmk');
    if (!cfg.url || !cfg.secret) {
      return { content: [{ type: 'text', text: 'CheckMK integration is not configured.' }], isError: true };
    }
    if (!cfg.enabled) {
      return { content: [{ type: 'text', text: 'CheckMK integration is disabled. Enable it before syncing.' }], isError: true };
    }

    const { records, zusatz } = await cmk.lesen(cfg);
    const result = await abgleichen({
      source: cmk.id,
      records,
      dryRun: dry_run,
      zaehltBestandVollstaendig: cmk.zaehltBestandVollstaendig,
      zusatz,
    });

    // Ein Probelauf setzt keinen Sync-Stand — sonst behauptet die Anzeige eine
    // Aktualitaet, die nie geschrieben wurde.
    if (!dry_run) {
      await setIntegration('checkmk', {
        lastSyncAt: result.run_at,
        lastSyncSummary: {
          hosts_seen: result.hosts_seen,
          assets_updated: result.assets_updated,
          staging_created: result.staging_created,
          staging_updated: result.staging_updated,
          assets_missing: result.assets_missing,
        },
      });
    }

    await logAudit(dry_run ? 'read' : 'update', 'Integration', null, 'CheckMK', {
      action: dry_run ? 'sync_dry_run' : 'sync',
      hosts_seen: result.hosts_seen,
      assets_updated: result.assets_updated,
      staging_created: result.staging_created,
      assets_missing: result.assets_missing,
      via: 'mcp',
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── CVE Reports ─────────────────────────────────────────────────────────────

server.tool(
  'isms_get_asset_cve_report',
  'Get the CVE vulnerability report for a single asset, optionally refreshing it from external sources.',
  {
    id:      z.number().int().describe('Asset ID'),
    refresh: z.boolean().optional().default(false).describe('Trigger a real-time refresh from NVD/Shodan APIs'),
  },
  async ({ id, refresh }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    if (refresh) {
      const { fetchCVEsForAsset } = require('../services/cveService');
      const result = await fetchCVEsForAsset(asset);
      if (result) {
        await asset.update({
          cve_critical: result.counts.critical,
          cve_high:     result.counts.high,
          cve_medium:   result.counts.medium,
          cve_low:      result.counts.low,
          cve_ids:      result.cveList,
          cve_last_checked: new Date(),
        });
      }
    }

    let cves = [];
    if (asset.cve_ids) {
      try {
        cves = typeof asset.cve_ids === 'string' ? JSON.parse(asset.cve_ids) : asset.cve_ids;
      } catch (e) {
        cves = [];
      }
    }

    const report = {
      asset_id: asset.id,
      asset_name: asset.name,
      cpe: asset.cpe,
      cpe_title: asset.cpe_title,
      cve_last_checked: asset.cve_last_checked,
      counts: {
        critical: asset.cve_critical,
        high: asset.cve_high,
        medium: asset.cve_medium,
        low: asset.cve_low,
      },
      cves: cves
    };

    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  }
);

server.tool(
  'isms_get_central_cve_report',
  'Get a central CVE report aggregated across all non-decommissioned assets, showing unique CVEs and their affected assets.',
  {
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter CVEs by severity'),
    limit:    z.number().int().min(1).max(500).default(50).describe('Max results'),
  },
  async ({ severity, limit }) => {
    const { Asset } = getModels();
    const assets = await Asset.findAll({
      attributes: ['id', 'name', 'cve_ids'],
      where: {
        status: { [Op.ne]: 'decommissioned' }
      }
    });

    const cveMap = {};
    for (const asset of assets) {
      let cves = [];
      if (asset.cve_ids) {
        try {
          cves = typeof asset.cve_ids === 'string' ? JSON.parse(asset.cve_ids) : asset.cve_ids;
        } catch (e) {
          cves = [];
        }
      }
      if (Array.isArray(cves)) {
        for (const cve of cves) {
          if (!cve.id) continue;
          const cveSeverity = cve.severity || 'none';
          if (severity && cveSeverity !== severity) continue;

          if (!cveMap[cve.id]) {
            cveMap[cve.id] = {
              id: cve.id,
              score: Number(cve.score) || 0,
              severity: cveSeverity,
              description: cve.description || '',
              published: cve.published || '',
              source: cve.source || '',
              assets: []
            };
          }
          if (!cveMap[cve.id].assets.some(a => a.id === asset.id)) {
            cveMap[cve.id].assets.push({ id: asset.id, name: asset.name });
          }
        }
      }
    }

    const cveList = Object.values(cveMap);
    cveList.sort((a, b) => b.score - a.score);
    const resultList = cveList.slice(0, limit);

    return { content: [{ type: 'text', text: JSON.stringify(resultList, null, 2) }] };
  }
);

server.tool(
  'isms_update_asset',
  'Update details of an existing asset in the ISMS asset register.',
  {
    id:             z.number().int().describe('Asset ID'),
    name:           z.string().optional().describe('Asset name'),
    type:           z.enum(['hardware','software','application','service','data','process','personal','ai_application','ai_agent','other']).optional().describe('Asset type'),
    classification: z.enum(['public','internal','confidential','secret']).optional().describe('Classification level'),
    description:    z.string().optional().describe('Detailed description'),
    hosting_type:   z.enum(['on-premise','cloud_public','cloud_private','hybrid']).optional(),
    lifecycle_status: z.enum(['evaluation','production','maintenance','archived']).optional(),
    nis2_relevant:  z.boolean().optional(),
    owner_id:       z.number().int().optional().describe('User ID of the asset owner'),
    assessor_id:    z.number().int().optional().describe('User ID of the risk assessor'),
    patch_status:   z.enum(['up-to-date','pending','critical']).optional(),
    rto:            z.string().optional().describe('Recovery Time Objective (Wiederanlaufzeit, e.g. 4h)'),
    rpo:            z.string().optional().describe('Recovery Point Objective (Datenverlust-Toleranz, e.g. 1h)'),
    sdo:            z.string().optional().describe('Service Delivery Objective (Mindest-Service-Level im Notbetrieb, e.g. 24h)'),
    mto:            z.string().optional().describe('Maximum Tolerable Outage (Maximal tolerierbare Ausfallzeit, e.g. 48h)'),
    ioa:            z.string().optional().describe('Impact of Activity / Disruption (Ausfallwirkung, e.g. High)'),
    location:       z.string().optional().describe('Physical or logical location (e.g. rack, site, IP)'),
    version:        z.string().optional(),
    vendor:         z.string().optional().describe('Vendor/manufacturer name (free text)'),
    // Verknuepfung zu einem Drittsystem. isms_create_asset kennt diese Felder
    // bereits, das Update-Tool nicht — dadurch liess sich ein BESTEHENDES
    // Asset nicht nachtraeglich an eine Quelle binden. Folge: der CheckMK-Sync
    // schlug es bei jedem Lauf erneut als unbekannt vor und haette beim
    // Freigeben eine Dublette erzeugt. Betroffen waren vier Geraete, die
    // laengst im Register standen.
    external_source: z.string().optional().describe("Third-party system this asset is linked to, e.g. 'checkmk'"),
    external_id:    z.string().optional().describe('Identifier in the third-party system (e.g. CheckMK hostname)'),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    // Eine frisch gesetzte Verknuepfung gilt ab jetzt als bestaetigt. Ohne
    // diesen Zeitstempel behandelt der naechste Sync-Lauf das Asset als
    // "seit jeher nicht gemeldet" und markiert es faelschlich als MISSING.
    if (updates.external_id && !asset.external_last_seen_at) {
      updates.external_last_seen_at = new Date();
    }

    // Feldebene, spiegelt routes/assets.js. Das Tool-Gate prueft nur
    // assets.edit_basics — die Matrix trennt davon aber assets.edit_compliance
    // fuer classification, nis2_relevant, rto und rpo. Ohne diese Pruefung
    // liesse sich ueber MCP aendern, was ueber REST und die Weboberflaeche mit
    // 403 abgelehnt wird: dieselbe Kontrolle, auf einem Pfad wirksam, auf dem
    // anderen umgehbar. Die Routenebene wurde angeglichen, die Feldebene nicht.
    const COMPLIANCE_FIELDS = ['classification', 'nis2_relevant', 'rto', 'rpo'];
    const touchedCompliance = COMPLIANCE_FIELDS.filter(
      f => updates[f] !== undefined && String(updates[f]) !== String(asset[f])
    );
    if (touchedCompliance.length > 0) {
      let compliancePermitted;
      try {
        const { decide } = require('../services/permissionService');
        // Sagt die Matrix nichts, gilt dieselbe Rollenliste wie im REST-Handler.
        compliancePermitted = await decide(mcpUser, 'assets', 'edit_compliance', ['admin', 'assessor', 'dpo']);
      } catch (e) {
        // Nie fail-open: eine kaputte Matrix-Abfrage darf keinen Zugriff gewaehren.
        console.error('[MCP] edit_compliance check failed:', e.message);
        compliancePermitted = false;
      }
      if (!compliancePermitted) {
        return {
          content: [{ type: 'text', text: `Zugriff verweigert: Ihre Rolle darf folgende geschuetzte Felder nicht aendern: ${touchedCompliance.join(', ')}` }],
          isError: true,
        };
      }
    }

    // Dasselbe fuer den Security-Bereich (assets.edit_security). Von dessen
    // Feldern bietet dieses Tool derzeit nur patch_status an; die Pruefung
    // steht trotzdem ueber der ganzen Liste, damit sie mitwaechst, falls
    // weitere Felder aufgenommen werden.
    const SECURITY_FIELDS = ['patch_status', 'hardening_status', 'eol_date', 'backup_plan', 'last_restore_test'];
    const touchedSecurity = SECURITY_FIELDS.filter(
      f => updates[f] !== undefined && String(updates[f]) !== String(asset[f])
    );
    if (touchedSecurity.length > 0) {
      try {
        const { decide } = require('../services/permissionService');
        const { BUILTIN_ROLES } = require('../services/accessService');
        const verdict = (await decide(mcpUser, 'assets', 'edit_security', BUILTIN_ROLES)) ? true : false;
        // Im REST-Handler blockiert nur ein ausdrueckliches false — sagt die
        // Matrix nichts, darf jeder ran, der edit_basics passiert hat. Diese
        // Auslegung wird hier bewusst uebernommen, damit beide Pfade dieselbe
        // Entscheidung treffen.
        if (verdict === false) {
          return {
            content: [{ type: 'text', text: `Zugriff verweigert: Ihre Rolle darf folgende Sicherheitsfelder nicht aendern: ${touchedSecurity.join(', ')}` }],
            isError: true,
          };
        }
      } catch (e) {
        console.error('[MCP] edit_security check failed:', e.message);
        return {
          content: [{ type: 'text', text: 'Zugriff verweigert: Berechtigungspruefung fehlgeschlagen.' }],
          isError: true,
        };
      }
    }

    if (updates.lifecycle_status === 'archived') {
      updates.status = 'inactive';
    } else if (updates.lifecycle_status && ['production', 'maintenance', 'evaluation'].includes(updates.lifecycle_status)) {
      if (asset.status === 'inactive') updates.status = 'active';
    }

    await asset.update(updates);

    // Wie zuvor bei isms_create_asset fehlte hier der Audit-Eintrag. Eine
    // nachtraegliche Aenderung an einem bestehenden Asset muss nachvollziehbar
    // sein — wer wann welches Feld angefasst hat.
    await logAudit('update', 'Asset', asset.id, asset.name, {
      fields: Object.keys(updates),
      via: 'mcp',
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

server.tool(
  'isms_refresh_asset_cves',
  'Trigger a real-time CVE vulnerability refresh from external APIs for a specific asset.',
  {
    id: z.number().int().describe('Asset ID'),
  },
  async ({ id }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    const { fetchCVEsForAsset } = require('../services/cveService');
    const result = await fetchCVEsForAsset(asset);
    if (!result) {
      return { content: [{ type: 'text', text: 'No search parameters found for asset (e.g. type, vendor, version, package_name, cpe)' }], isError: true };
    }

    await asset.update({
      cve_critical: result.counts.critical,
      cve_high:     result.counts.high,
      cve_medium:   result.counts.medium,
      cve_low:      result.counts.low,
      cve_ids:      result.cveList,
      cve_last_checked: new Date(),
    });

    return { content: [{ type: 'text', text: JSON.stringify({ asset_id: asset.id, asset_name: asset.name, counts: result.counts, total: result.total, source: result.source }, null, 2) }] };
  }
);

server.tool(
  'isms_refresh_all_asset_cves',
  'Trigger a background/real-time CVE vulnerability refresh from external APIs for all non-decommissioned assets.',
  {},
  async () => {
    const { Asset } = getModels();
    const assets = await Asset.findAll({
      where: { status: { [Op.ne]: 'decommissioned' } }
    });

    const { fetchCVEsForAsset } = require('../services/cveService');
    let updatedCount = 0;
    let errorsCount = 0;

    for (const asset of assets) {
      try {
        const result = await fetchCVEsForAsset(asset);
        if (result) {
          await asset.update({
            cve_critical: result.counts.critical,
            cve_high:     result.counts.high,
            cve_medium:   result.counts.medium,
            cve_low:      result.counts.low,
            cve_ids:      result.cveList,
            cve_last_checked: new Date(),
          });
          updatedCount++;
        }
      } catch (e) {
        errorsCount++;
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify({ message: 'CVE refresh completed', total_assets: assets.length, successfully_updated: updatedCount, failed_updates: errorsCount }, null, 2) }] };
  }
);

server.tool(
  'isms_suggest_cpe',
  'Get CPE 2.3 format suggestions from NVD for an asset or search query to enable accurate vulnerability matching.',
  {
    id:    z.number().int().optional().describe('Asset ID to look up suggestions for'),
    query: z.string().optional().describe('Search query string (e.g. "nginx", "apache tomcat", "postgresql")'),
  },
  async ({ id, query }) => {
    const { Asset } = getModels();
    const { suggestCPEsForAsset } = require('../services/cveService');
    let assetObj = null;
    if (id) {
      assetObj = await Asset.findByPk(id);
      if (!assetObj) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    }
    
    let suggestions;
    if (query && query.trim().length >= 3) {
      suggestions = await suggestCPEsForAsset({ name: query.trim(), vendor: null });
    } else if (assetObj) {
      suggestions = await suggestCPEsForAsset(assetObj);
    } else {
      return { content: [{ type: 'text', text: 'Either asset id or search query (min 3 chars) is required.' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ suggestions }, null, 2) }] };
  }
);

server.tool(
  'isms_resolve_cpe',
  'Resolve or assign a standardized CPE (Common Platform Enumeration) string to an asset for automated CVE scanning.',
  {
    id:    z.number().int().describe('Asset ID'),
    cpe:   z.string().optional().describe('Standardized CPE 2.3 identifier, e.g. "cpe:2.3:a:nginx:nginx"'),
    title: z.string().optional().describe('Human-readable product title, e.g. "Nginx"'),
  },
  async ({ id, cpe, title }, { mcpUser }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    if (cpe && title) {
      const cleanCpe = String(cpe).trim();
      const cleanTitle = String(title).trim();
      if (!cleanCpe.startsWith('cpe:2.3:')) {
        return { content: [{ type: 'text', text: 'Invalid CPE format. Must start with cpe:2.3:' }], isError: true };
      }
      await asset.update({ cpe: cleanCpe, cpe_title: cleanTitle, cpe_resolved_at: new Date() });
      await logAudit('update', 'asset', asset.id, asset.name, { action: 'set_cpe', cpe: cleanCpe, title: cleanTitle }, mcpUser);
      return { content: [{ type: 'text', text: JSON.stringify({ found: true, cpe: cleanCpe, title: cleanTitle }, null, 2) }] };
    }

    const { resolveCPEForAsset } = require('../services/cveService');
    const result = await resolveCPEForAsset(asset);
    if (!result) {
      return { content: [{ type: 'text', text: 'No matching CPE entry found in NVD. Please verify vendor/name or provide CPE manually.' }], isError: true };
    }

    await asset.update({ cpe: result.cpe, cpe_title: result.title, cpe_resolved_at: new Date() });
    await logAudit('update', 'asset', asset.id, asset.name, { action: 'auto_resolve_cpe', cpe: result.cpe, title: result.title }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ found: true, cpe: result.cpe, title: result.title }, null, 2) }] };
  }
);

server.tool(
  'isms_create_assessment',
  'Create a CIA (Confidentiality, Integrity, Availability) protection needs and risk assessment for an asset.',
  {
    asset_id:                z.number().int().describe('Asset ID to assess'),
    confidentiality:         z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Vertraulichkeit (C)'),
    integrity:               z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Integrität (I)'),
    availability:            z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Verfügbarkeit (A)'),
    notes:                   z.string().optional().describe('Assessment notes / justification'),
    mitigation:              z.string().optional().describe('Planned mitigation measures'),
    risk_treatment:          z.enum(['mitigate', 'accept', 'transfer', 'avoid']).optional().default('mitigate'),
    treatment_justification: z.string().optional(),
    accepted_by:             z.string().optional().describe('Name of manager accepting residual risk (if risk_treatment is accept)'),
    accepted_until:          z.string().optional().describe('ISO Date (YYYY-MM-DD) until acceptance is valid'),
  },
  async (args, { mcpUser }) => {
    const { Assessment, Asset, Reminder, Task } = getModels();
    const { checkAndManageAssetTasks } = require('../services/taskAutomationService');
    const asset = await Asset.findByPk(args.asset_id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    const { score, level } = Assessment.calculateRisk(args.confidentiality, args.integrity, args.availability);
    const assessed_at = new Date();
    const oneYearOut = new Date(assessed_at);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

    const acceptedUntilDate = (args.risk_treatment === 'accept' && args.accepted_until && args.accepted_until !== 'Invalid date')
      ? new Date(args.accepted_until) : null;
    const next_review_at = (acceptedUntilDate && acceptedUntilDate < oneYearOut)
      ? acceptedUntilDate : oneYearOut;

    await Assessment.update({ is_current: false }, { where: { asset_id: args.asset_id, is_current: true } });

    const assessor_id = await getValidUserId(mcpUser);
    const assessment = await Assessment.create({
      asset_id: args.asset_id,
      assessor_id,
      confidentiality: args.confidentiality,
      integrity: args.integrity,
      availability: args.availability,
      risk_score: score,
      risk_level: level,
      notes: args.notes,
      mitigation: args.mitigation,
      risk_treatment: args.risk_treatment || null,
      treatment_justification: args.treatment_justification || null,
      accepted_by: args.risk_treatment === 'accept' ? (args.accepted_by || null) : null,
      accepted_until: acceptedUntilDate ? args.accepted_until : null,
      assessed_at,
      next_review_at,
      is_current: true,
    });

    await Reminder.destroy({ where: { asset_id: args.asset_id, status: 'pending' } });

    const isAcceptance = args.risk_treatment === 'accept' && acceptedUntilDate;
    const taskTitle = isAcceptance
      ? `Risikoakzeptanz läuft ab: ${asset.name}`
      : `Review fällig: ${asset.name}`;
    const taskDesc = isAcceptance
      ? `Die Risikoakzeptanz für Asset „${asset.name}" läuft am ${args.accepted_until} ab und muss erneuert oder das Risiko anders behandelt werden.`
      : `Regelmäßige Überprüfung der Schutzbedarfsfeststellung (Risikobewertung) für das Asset „${asset.name}".`;

    const task = await Task.create({
      title: taskTitle,
      description: taskDesc,
      priority: isAcceptance && level === 'critical' ? 'high' : 'medium',
      assigned_to_id: asset.assessor_id || assessor_id,
      due_date: next_review_at.toISOString().split('T')[0],
      related_type: 'asset',
      related_id: asset.id,
      tags: isAcceptance ? ['Risikoakzeptanz', 'Risiko'] : ['Review', 'Risiko'],
      created_by_id: assessor_id,
    });

    await Reminder.create({
      asset_id: args.asset_id,
      assessment_id: assessment.id,
      due_date: next_review_at.toISOString().split('T')[0],
      status: 'pending',
      task_id: task.id,
      notes: isAcceptance ? `Risikoakzeptanz von „${args.accepted_by || 'unbekannt'}" gültig bis ${args.accepted_until}` : null,
    });

    await logAudit('assess', 'assessment', assessment.id, asset.name, {
      asset_id: args.asset_id, risk_score: score, risk_level: level,
    }, mcpUser);

    await checkAndManageAssetTasks(asset);

    return { content: [{ type: 'text', text: JSON.stringify(assessment, null, 2) }] };
  }
);

server.tool(
  'isms_list_assessments',
  'List Schutzbedarfsfeststellungen / CIA assessments for assets.',
  {
    asset_id: z.number().int().optional().describe('Filter by asset ID'),
    limit:    z.number().int().min(1).max(200).default(50),
  },
  async ({ asset_id, limit }) => {
    const { Assessment, Asset, User } = getModels();
    const where = asset_id ? { asset_id } : {};
    const assessments = await Assessment.findAll({
      where, limit,
      include: [
        { model: Asset, attributes: ['id', 'name', 'type', 'classification'] },
        { model: User, as: 'assessorUser', attributes: ['id', 'name', 'email'] },
      ],
      order: [['assessed_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(assessments, null, 2) }] };
  }
);

server.tool(
  'isms_delete_asset',
  'Decommission / delete an asset from the active register.',
  {
    id: z.number().int().describe('Asset ID to decommission'),
  },
  async ({ id }, { mcpUser }) => {
    const { Asset } = getModels();
    const { checkAndManageAssetTasks } = require('../services/taskAutomationService');
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    await asset.update({ status: 'decommissioned' });
    await checkAndManageAssetTasks(asset);
    await logAudit('delete', 'asset', asset.id, asset.name, {}, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Asset "${asset.name}" (ID: ${asset.id}) marked as decommissioned.` }, null, 2) }] };
  }
);

// ─── Risks ───────────────────────────────────────────────────────────────────
//
// Schreibende Risiko-Tools laufen ueber services/riskService.js - dieselben
// Regeln wie die REST-Routen (Datensatzrechte, Akzeptanzbefugnis, Methodik).
// Antworten tragen die Bewertungsfelder der Methodik: methodology_version,
// needs_reassessment, effective_level, appetite_max_level, appetite_exceeded.

const mcpReq = (mcpUser) => ({ user: mcpUser ? { id: mcpUser.id, name: mcpUser.name || 'MCP Client', role: mcpUser.role, roles: mcpUser.roles, accessGrants: mcpUser.accessGrants } : null, ip: '127.0.0.1' });
const mcpRiskError = (e) => {
  if (e && Number.isInteger(e.status) && e.status < 500 && !(typeof e.name === 'string' && e.name.startsWith('Sequelize'))) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
  if (e && typeof e.name === 'string' && e.name.startsWith('Sequelize')) {
    // '' statt ' ': nur so erkennt CodeQL js/log-injection die Bereinigung (#282).
    console.error('[MCP] Risiko:', String(e.message).replace(/\n|\r/g, ''));
    return { content: [{ type: 'text', text: 'Ungültige Eingabe.' }], isError: true };
  }
  throw e;
};

server.tool(
  'isms_get_risk_methodology',
  'Get the active risk methodology (ISO 27005): likelihood and impact scales with criteria, risk levels with score thresholds, the risk matrix, risk appetite per category and acceptance authority per level. Pass version_id to read an earlier (superseded) version; list_versions returns the version history.',
  {
    version_id:    z.number().int().optional().describe('ID of a specific methodology version (default: active version)'),
    list_versions: z.boolean().optional().default(false).describe('Also return the version history with the number of risks assessed under each version'),
  },
  async ({ version_id, list_versions }) => {
    const rm = require('../services/riskMethodology');
    const profile = version_id ? await rm.getProfile(version_id) : await rm.getActiveProfile();
    if (!profile) return { content: [{ type: 'text', text: 'Methodology version not found' }], isError: true };
    const out = { methodology: rm.scaleInfo(profile) };
    if (list_versions) out.versions = await rm.listVersions();
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
);

server.tool(
  'isms_list_risks',
  'List risks from the risk register with optional filters. Each risk carries its methodology version, whether it needs reassessment under the active methodology, and whether it exceeds the risk appetite of its category (appetite_exceeded).',
  {
    status:  z.enum(['open','in_treatment','accepted','closed']).optional(),
    level:   z.enum(['low','medium','high','critical']).optional().describe('Filter by residual risk level'),
    search:  z.string().optional().describe('Search in title/description'),
    appetite_exceeded:  z.boolean().optional().describe('Only risks above the risk appetite of their category'),
    needs_reassessment: z.boolean().optional().describe('Only risks assessed under an older methodology version'),
    category: z.string().optional().describe('Filter by risk category key (see isms_list_risk_categories)'),
    limit:   z.number().int().min(1).max(200).default(50),
  },
  async ({ status, level, search, appetite_exceeded, needs_reassessment, category, limit }) => {
    const { Risk, User } = getModels();
    const { escapeLike } = require('../utils/sqlUtils');
    const { decorate: decorateRisks } = require('../services/riskService');
    const where = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (level) where.residual_level = level;
    if (search) where[Op.or] = [
      { title: { [Op.iLike]: `%${escapeLike(search)}%` } },
      { description: { [Op.iLike]: `%${escapeLike(search)}%` } },
    ];
    // Die Methodik-Filter wirken auf berechnete Felder; ohne sie greift das Limit in der Datenbank.
    const filtered = appetite_exceeded !== undefined || needs_reassessment !== undefined;
    const risks = await Risk.findAll({
      where, ...(filtered ? {} : { limit }),
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'owner', attributes: ['id','name'] }],
    });
    let out = await decorateRisks(risks);
    if (appetite_exceeded !== undefined) out = out.filter(r => r.appetite_exceeded === appetite_exceeded);
    if (needs_reassessment !== undefined) out = out.filter(r => r.needs_reassessment === needs_reassessment);
    return { content: [{ type: 'text', text: JSON.stringify(out.slice(0, limit), null, 2) }] };
  }
);

server.tool(
  'isms_get_risk',
  'Get full details of a single risk including linked controls, threats, assets, risk scenarios (asset(s) x threat x vulnerability), impact dimensions, assessment rationale, gross/net/target level, net-risk override, treatment options, treatment plan items with progress and costs, acceptance requests, sign-off status, methodology version and risk appetite check.',
  {
    id: z.number().int().describe('Risk ID'),
  },
  async ({ id }, { mcpUser }) => {
    const { Risk } = getModels();
    const riskService = require('../services/riskService');
    const risk = await Risk.findByPk(id, { include: riskService.includeDetail() });
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
    // Wie GET /api/risks/:id: Detail nur fuer admin, assessor und den Risiko-Owner.
    if (!riskService.canViewRisk(mcpUser, risk)) return { content: [{ type: 'text', text: 'Zugriff verweigert: Nur admin, assessor oder der Risiko-Owner sehen das Risiko im Detail.' }], isError: true };
    const out = (await riskService.decorate([risk], { detail: true }))[0];
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
);

server.tool(
  'isms_create_risk',
  'Add a new risk to the risk register. Likelihood and impact are values on the scales of the active risk methodology (see isms_get_risk_methodology; 3 to 6 levels). A rationale for likelihood and for impact is mandatory. If the methodology defines impact dimensions, impact_dimensions may rate them; the overall impact is then their maximum. category must be a key from isms_list_risk_categories.',
  {
    title:                z.string().min(1),
    description:          z.string().optional(),
    category:             z.string().optional().describe('Risk category key (isms_list_risk_categories)'),
    inherent_likelihood:  z.number().int().min(1).max(6),
    inherent_impact:      z.number().int().min(1).max(6).describe('Overall impact; ignored when impact_dimensions rates at least one dimension'),
    likelihood_rationale: z.string().min(1).describe('Why this likelihood (mandatory)'),
    impact_rationale:     z.string().min(1).describe('Why this impact (mandatory)'),
    impact_dimensions:    z.record(z.string(), z.number().int().min(1).max(6).nullable()).optional().describe('Impact per dimension, e.g. {"confidentiality":4,"financial":2}; only dimensions of the active methodology'),
    target_likelihood:    z.number().int().min(1).max(6).optional().describe('Target risk after planned treatment (together with target_impact)'),
    target_impact:        z.number().int().min(1).max(6).optional(),
    scenarios:            z.array(z.object({ asset_ids: z.array(z.number().int()).optional(), threat_id: z.number().int().nullable().optional(), vulnerability_id: z.number().int().nullable().optional(), description: z.string().optional() })).optional().describe('Risk scenarios: asset(s) x threat x vulnerability'),
    treatment:            z.enum(['mitigate','accept','transfer','avoid']).default('mitigate'),
    treatment_plan:       z.string().optional(),
    treatment_options:    z.array(z.enum(['mitigate','accept','transfer','avoid'])).optional().describe('All treatment options (several allowed); treatment stays the main option and is always included'),
    owner_id:             z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    try {
      const { inherent_likelihood, inherent_impact, ...rest } = args;
      const risk = await require('../services/riskService').createRisk(
        { ...rest, likelihood: inherent_likelihood, impact: inherent_impact, status: 'open' },
        mcpUser, mcpReq(mcpUser),
      );
      return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_update_risk',
  'Update an existing risk in the risk register including likelihood, impact, impact dimensions, target risk, scenarios, treatment, and linked controls/assets. Values are on the scale of the methodology version the risk is assessed under; set reassess=true (with likelihood, impact and both rationales on the active scale) to move a risk to the active methodology version. Changing likelihood or impact requires likelihood_rationale / impact_rationale in the same call. Status "accepted" is only set via isms_signoff_risk; the net risk is overridden via isms_override_risk_residual.',
  {
    id:             z.number().int().describe('Risk ID'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    category:       z.string().optional(),
    owner_id:       z.number().int().optional(),
    likelihood:     z.number().int().min(1).max(6).optional(),
    impact:         z.number().int().min(1).max(6).optional(),
    likelihood_rationale: z.string().optional().describe('Mandatory whenever likelihood changes'),
    impact_rationale:     z.string().optional().describe('Mandatory whenever impact or an impact dimension changes'),
    impact_dimensions:    z.record(z.string(), z.number().int().min(1).max(6).nullable()).nullable().optional().describe('Impact per dimension (replaces all); null clears'),
    target_likelihood:    z.number().int().min(1).max(6).nullable().optional(),
    target_impact:        z.number().int().min(1).max(6).nullable().optional(),
    scenarios:            z.array(z.object({ asset_ids: z.array(z.number().int()).optional(), threat_id: z.number().int().nullable().optional(), vulnerability_id: z.number().int().nullable().optional(), description: z.string().optional() })).optional().describe('Risk scenarios, replaces all'),
    treatment:      z.enum(['mitigate', 'accept', 'transfer', 'avoid']).optional(),
    treatment_plan: z.string().optional(),
    treatment_options: z.array(z.enum(['mitigate', 'accept', 'transfer', 'avoid'])).optional().describe('All treatment options (replaces the list; the main option is always included)'),
    status:         z.enum(['open', 'in_treatment', 'accepted', 'closed']).optional(),
    review_date:    z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    reassess:       z.boolean().optional().describe('Reassess under the active methodology version (requires likelihood and impact)'),
    asset_ids:      z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    threat_ids:     z.array(z.number().int()).optional().describe('Linked Threat IDs'),
    vvt_ids:        z.array(z.number().int()).optional().describe('Linked VVT entry IDs'),
    incident_ids:   z.array(z.number().int()).optional().describe('Linked Incident IDs'),
    controls:       z.array(z.object({ id: z.number().int(), effectiveness: z.number().int().min(1).max(5).optional() })).optional().describe('Linked Controls with effectiveness (1-5)'),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    try {
      const { Risk } = getModels();
      const risk = await Risk.findByPk(id);
      if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
      const updated = await require('../services/riskService').updateRisk(risk, updates, mcpUser, mcpReq(mcpUser), { partial: true });
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_signoff_risk',
  'Digitally sign off a risk acceptance (NIS-2 management sign-off). Since 3.8.0 this approves the pending acceptance request of the risk (four-eyes principle: the requester cannot approve; request first with isms_request_risk_acceptance). The acceptance authority of the active risk methodology decides which roles may accept which risk level and for how many months at most; without valid_until the requested validity or the longest permitted one is used.',
  {
    id:          z.number().int().describe('Risk ID'),
    valid_until: z.string().optional().describe('ISO Date (YYYY-MM-DD) until acceptance is valid'),
    request_id:  z.number().int().optional().describe('ID of the pending acceptance request (default: the pending request of the risk)'),
  },
  async ({ id, valid_until, request_id }, { mcpUser }) => {
    try {
      const { Risk } = getModels();
      const risk = await Risk.findByPk(id);
      if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
      const out = await require('../services/riskService').signoffRisk(risk, mcpUser, valid_until, mcpReq(mcpUser), { requestId: request_id ?? null });
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_revoke_risk_signoff',
  'Revoke a previous risk sign-off / acceptance, setting it back to in_treatment.',
  {
    id: z.number().int().describe('Risk ID'),
  },
  async ({ id }, { mcpUser }) => {
    try {
      const { Risk } = getModels();
      const risk = await Risk.findByPk(id);
      if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
      const out = await require('../services/riskService').revokeRisk(risk, mcpUser, mcpReq(mcpUser));
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_delete_risk',
  'Delete a risk from the risk register and cancel related open tasks.',
  {
    id: z.number().int().describe('Risk ID to delete'),
  },
  async ({ id }, { mcpUser }) => {
    const { Risk, Task } = getModels();
    const risk = await Risk.findByPk(id);
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };

    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'risk', related_id: risk.id, status: { [Op.in]: ['open', 'in_progress'] } } }
    );

    await logAudit('delete', 'risk', risk.id, risk.title, {}, mcpUser);
    await risk.destroy();

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Risk "${risk.title}" (ID: ${id}) deleted.` }, null, 2) }] };
  }
);

server.tool(
  'isms_override_risk_residual',
  'Override the calculated net (residual) risk of a risk with a rationale, or return to the calculation (override=false). The calculation from implemented controls stays the default; an override is marked, audit-logged with the calculated value, and reported as residual_calculated.',
  {
    id:                  z.number().int().describe('Risk ID'),
    override:            z.boolean().describe('true = set manual net values, false = back to calculation'),
    residual_likelihood: z.number().int().min(1).max(6).optional(),
    residual_impact:     z.number().int().min(1).max(6).optional(),
    reason:              z.string().optional().describe('Rationale (mandatory when override=true)'),
  },
  async ({ id, ...body }, { mcpUser }) => {
    try {
      const { Risk } = getModels();
      const risk = await Risk.findByPk(id);
      if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
      const out = await require('../services/riskService').overrideResidual(risk, body, mcpUser, mcpReq(mcpUser));
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

// ─── Risk treatment plan and acceptance workflow (3.8.0) ─────────────────────
// Same service functions as routes/risks.js (services/riskService.js).

const mcpJson = (out) => ({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
const mcpNotFound = (what) => ({ content: [{ type: 'text', text: `${what} not found` }], isError: true });
const treatmentItemSchema = {
  title:                z.string().optional().describe('Title of the measure (mandatory on create)'),
  description:          z.string().nullable().optional(),
  treatment_option:     z.enum(['mitigate', 'transfer', 'avoid', 'accept']).optional(),
  responsible_user_id:  z.number().int().nullable().optional().describe('Responsible person (user ID) - or a group, not both'),
  responsible_group_id: z.number().int().nullable().optional().describe('Responsible group (group ID)'),
  due_date:             z.string().nullable().optional().describe('ISO Date (YYYY-MM-DD)'),
  status:               z.enum(['planned', 'in_progress', 'implemented', 'discarded']).optional(),
  status_reason:        z.string().nullable().optional().describe('Reason - mandatory for status discarded'),
  cost_once:            z.number().min(0).nullable().optional().describe('One-off cost in EUR'),
  cost_recurring:       z.number().min(0).nullable().optional().describe('Recurring cost in EUR per year'),
  control_id:           z.number().int().nullable().optional().describe('Linked existing control'),
  task_id:              z.number().int().nullable().optional().describe('Linked existing task'),
  sort_order:           z.number().int().min(0).optional(),
};

server.tool(
  'isms_list_risk_treatment_items',
  'List the structured treatment plan of one risk: measures with option, responsible person/group, due date, status, costs (EUR), linked control and task. Record rights as for isms_get_risk.',
  { risk_id: z.number().int().describe('Risk ID') },
  async ({ risk_id }, { mcpUser }) => {
    try {
      const risk = await getModels().Risk.findByPk(risk_id);
      if (!risk) return mcpNotFound('Risk');
      return mcpJson(await require('../services/riskService').listTreatmentItems(risk, mcpUser));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_create_risk_treatment_item',
  'Add a measure to the treatment plan of a risk (ISO 27001 6.1.3 e). Responsible is a person or a group; status discarded needs status_reason. The free-text treatment_plan of the risk is not changed.',
  { risk_id: z.number().int().describe('Risk ID'), ...treatmentItemSchema },
  async ({ risk_id, ...body }, { mcpUser }) => {
    try {
      const risk = await getModels().Risk.findByPk(risk_id);
      if (!risk) return mcpNotFound('Risk');
      return mcpJson(await require('../services/riskService').createTreatmentItem(risk, body, mcpUser, mcpReq(mcpUser)));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_update_risk_treatment_item',
  'Change a measure of a risk treatment plan (only the fields sent). Setting status implemented also completes a linked task; discarded (with status_reason) cancels an open linked task. Every change is audit-logged.',
  { risk_id: z.number().int().describe('Risk ID'), item_id: z.number().int().describe('Treatment item ID'), ...treatmentItemSchema },
  async ({ risk_id, item_id, ...body }, { mcpUser }) => {
    try {
      const { Risk, RiskTreatmentItem } = getModels();
      const risk = await Risk.findByPk(risk_id);
      if (!risk) return mcpNotFound('Risk');
      const item = await RiskTreatmentItem.findOne({ where: { id: item_id, risk_id } });
      if (!item) return mcpNotFound('Treatment item');
      return mcpJson(await require('../services/riskService').updateTreatmentItem(risk, item, body, mcpUser, mcpReq(mcpUser)));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_create_task_from_treatment_item',
  'Create a task from a treatment item (assigned to its responsible person or group, due date of the item, priority from the risk level unless given). When the task is done, the item becomes implemented automatically (audit-logged). Needs tasks.create as well.',
  {
    risk_id:  z.number().int().describe('Risk ID'),
    item_id:  z.number().int().describe('Treatment item ID'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  },
  async ({ risk_id, item_id, priority }, { mcpUser }) => {
    try {
      const { Risk, RiskTreatmentItem } = getModels();
      const risk = await Risk.findByPk(risk_id);
      if (!risk) return mcpNotFound('Risk');
      const item = await RiskTreatmentItem.findOne({ where: { id: item_id, risk_id } });
      if (!item) return mcpNotFound('Treatment item');
      return mcpJson(await require('../services/riskService').createTaskForTreatmentItem(risk, item, mcpUser, mcpReq(mcpUser), { priority }));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_get_risk_treatment_plan',
  'Risk treatment plan overview across risks (evidence for ISO 27001 6.1.3 e): all measures with risk, responsible, due date, status, overdue flag and costs, a summary, and risks without an active measure. admin/assessor/management see everything; others their own risks and the measures they are responsible for.',
  {
    status:              z.enum(['planned', 'in_progress', 'implemented', 'discarded']).optional(),
    overdue:             z.boolean().optional().describe('Only overdue measures'),
    risk_id:             z.number().int().optional(),
    responsible_user_id: z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    try {
      return mcpJson(await require('../services/riskService').treatmentPlan(mcpUser, args));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_list_risk_acceptance_requests',
  'List risk acceptance requests (approval queue) with requester, decision, residual level and owner confirmation. Visible: requests on risks the caller may sign off and the caller\'s own requests.',
  {
    status:  z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
    risk_id: z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    try {
      return mcpJson(await require('../services/riskService').listAcceptanceRequests(mcpUser, args));
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_request_risk_acceptance',
  'Request the acceptance of a risk (four-eyes principle, ISO 27001 6.1.3 f): justification, requested validity and residual risk. The current level is stored with the request; a person with acceptance authority who is not the requester approves it (isms_approve_risk_acceptance). One pending request per risk. confirm_as_owner records the risk owner\'s confirmation when the caller owns the risk.',
  {
    risk_id:                   z.number().int().describe('Risk ID'),
    justification:             z.string().min(1).describe('Why the risk should be accepted'),
    residual_risk_description: z.string().optional().describe('Description of the residual risk'),
    requested_until:           z.string().optional().describe('Requested validity, ISO Date (YYYY-MM-DD)'),
    confirm_as_owner:          z.boolean().optional(),
  },
  async ({ risk_id, ...body }, { mcpUser }) => {
    try {
      const risk = await getModels().Risk.findByPk(risk_id);
      if (!risk) return mcpNotFound('Risk');
      return mcpJson(await require('../services/riskService').requestAcceptance(risk, body, mcpUser, mcpReq(mcpUser)));
    } catch (e) { return mcpRiskError(e); }
  }
);

// decide(svc, risk, request, user, body, req) - fixed per tool, never from input.
const decideTool = (decide) => async ({ risk_id, request_id, ...body }, { mcpUser }) => {
  try {
    const svc = require('../services/riskService');
    const risk = await getModels().Risk.findByPk(risk_id);
    if (!risk) return mcpNotFound('Risk');
    const reqRow = await svc.findAcceptanceRequest(risk.id, request_id);
    if (!reqRow) return mcpNotFound('Acceptance request');
    return mcpJson(await decide(svc, risk, reqRow, mcpUser, body, mcpReq(mcpUser)));
  } catch (e) { return mcpRiskError(e); }
};

server.tool(
  'isms_approve_risk_acceptance',
  'Approve a pending risk acceptance request. Only a person with acceptance authority for the level under the active methodology who is NOT the requester; the level must still be the requested one. Sets the risk to accepted until valid_until (default: requested validity, capped by the methodology).',
  {
    risk_id:     z.number().int().describe('Risk ID'),
    request_id:  z.number().int().describe('Acceptance request ID'),
    valid_until: z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    note:        z.string().optional(),
  },
  decideTool((svc, risk, r, u, body, req) => svc.approveAcceptance(risk, r, u, body, req)),
);

server.tool(
  'isms_reject_risk_acceptance',
  'Reject a pending risk acceptance request with a reason (acceptance authority for the level, not the requester).',
  {
    risk_id:    z.number().int().describe('Risk ID'),
    request_id: z.number().int().describe('Acceptance request ID'),
    reason:     z.string().min(1).describe('Reason for the rejection'),
  },
  decideTool((svc, risk, r, u, body, req) => svc.rejectAcceptance(risk, r, u, body, req)),
);

server.tool(
  'isms_withdraw_risk_acceptance',
  'Withdraw an own pending risk acceptance request (requester or admin).',
  {
    risk_id:    z.number().int().describe('Risk ID'),
    request_id: z.number().int().describe('Acceptance request ID'),
    note:       z.string().optional(),
  },
  decideTool((svc, risk, r, u, body, req) => svc.withdrawAcceptance(risk, r, u, body, req)),
);

server.tool(
  'isms_confirm_risk_acceptance_as_owner',
  'As the risk owner, confirm the acceptance of the residual risk on a pending or approved acceptance request (ISO 27001 6.1.3 f).',
  {
    risk_id:    z.number().int().describe('Risk ID'),
    request_id: z.number().int().describe('Acceptance request ID'),
  },
  decideTool((svc, risk, r, u, body, req) => svc.confirmAcceptanceAsOwner(risk, r, u, req)),
);

// ─── Risk monitoring (3.9.0) ─────────────────────────────────────────────────
// Same service functions as routes/risks.js (services/riskMonitoringService.js,
// services/riskHistoryService.js); record rights in the services.

const withRisk = (fn) => async ({ risk_id, ...args }, { mcpUser }) => {
  try {
    const risk = await getModels().Risk.findByPk(risk_id);
    if (!risk) return mcpNotFound('Risk');
    return mcpJson(await fn(risk, args, mcpUser));
  } catch (e) { return mcpRiskError(e); }
};

server.tool(
  'isms_get_risk_history',
  'Assessment history of a risk (ISO 27005 clause 10): one immutable entry per change of gross, net or target assessment with values, levels, scores, methodology version, trigger (created, assessment, reassessment, carry_over, residual_override, residual_recalculated, review, baseline_at_upgrade, system), user and time. Record rights as for isms_get_risk.',
  { risk_id: z.number().int().describe('Risk ID'), limit: z.number().int().min(1).max(2000).optional() },
  withRisk((risk, { limit }, u) => require('../services/riskHistoryService').listHistory(risk, u, { limit })),
);

server.tool(
  'isms_get_risk_trend',
  'Trend heat map of the risk register: compares the assessments valid at two dates - how many risks moved from which matrix cell to which, level transitions, and counts of improved/worsened/unchanged risks. basis residual (net, falls back to gross) or inherent (gross).',
  {
    from:  z.string().describe('Start date YYYY-MM-DD'),
    to:    z.string().describe('End date YYYY-MM-DD'),
    basis: z.enum(['residual', 'inherent']).optional().default('residual'),
  },
  async (args) => {
    try { return mcpJson(await require('../services/riskHistoryService').trendHeatmap(args)); } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_get_risk_monitoring_summary',
  'Risk monitoring figures: risks by level, trend over the last 90 days, overdue periodic reviews, KRI breaches, risks above appetite, open reassessments by trigger, expiring and expired acceptances.',
  {},
  async () => {
    try { return mcpJson(await require('../services/riskMonitoringService').monitoringSummary()); } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_list_risk_review_flags',
  'Reassessment list: risks flagged "needs reassessment" with the reason - incident, audit finding, threat advisory, critical/high CVE, KRI breach or overdue periodic review - the follow-up events and the task of the risk owner. admin/assessor/management see all risks, others their own.',
  {
    status:       z.enum(['open', 'resolved', 'all']).optional().default('open'),
    trigger_type: z.enum(['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue']).optional(),
    risk_id:      z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    try { return mcpJson(await require('../services/riskMonitoringService').listFlags(mcpUser, args)); } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_review_risk',
  'Confirm the periodic review / reassessment of a risk with a note (mandatory). Records a review entry in the assessment history, resets the review cycle, resolves the open reassessment flags (all or flag_ids) and completes their tasks. Changed values are saved with isms_update_risk first.',
  {
    risk_id:  z.number().int().describe('Risk ID'),
    note:     z.string().min(1).describe('Result of the review'),
    flag_ids: z.array(z.number().int()).optional().describe('Only these open flags (default: all open flags of the risk)'),
  },
  withRisk((risk, body, u) => require('../services/riskMonitoringService').reviewRisk(risk, body, u, mcpReq(u))),
);

server.tool(
  'isms_list_risk_kris',
  'Key risk indicators of a risk: linked KPIs with threshold, direction (above/below), last value and breach state.',
  { risk_id: z.number().int().describe('Risk ID') },
  withRisk((risk, args, u) => require('../services/riskMonitoringService').listKris(risk, u)),
);

server.tool(
  'isms_link_risk_kri',
  'Link an existing KPI to a risk as key risk indicator with a threshold and a direction (above: breach when the value is greater, below: when smaller). A breach flags the risk for reassessment and creates a task for the owner once per breach.',
  {
    risk_id:   z.number().int().describe('Risk ID'),
    kpi_id:    z.number().int().describe('KPI ID (isms_list_kpis)'),
    threshold: z.number().describe('Threshold value'),
    direction: z.enum(['above', 'below']).optional().default('above'),
    note:      z.string().optional(),
  },
  withRisk((risk, body, u) => require('../services/riskMonitoringService').createKri(risk, body, u, mcpReq(u))),
);

server.tool(
  'isms_update_risk_kri',
  'Change threshold, direction or note of a KRI link (the KPI itself cannot be changed). Re-evaluated at once.',
  {
    risk_id:   z.number().int().describe('Risk ID'),
    kri_id:    z.number().int().describe('KRI link ID'),
    threshold: z.number().optional(),
    direction: z.enum(['above', 'below']).optional(),
    note:      z.string().nullable().optional(),
  },
  withRisk(async (risk, { kri_id, ...body }, u) => {
    const link = await getModels().RiskKri.findOne({ where: { id: kri_id, risk_id: risk.id } });
    if (!link) throw Object.assign(new Error('KRI link not found'), { status: 404 });
    return require('../services/riskMonitoringService').updateKri(risk, link, body, u, mcpReq(u));
  }),
);

server.tool(
  'isms_unlink_risk_kri',
  'Remove a KRI link from a risk (the KPI stays). Audit-logged.',
  {
    risk_id: z.number().int().describe('Risk ID'),
    kri_id:  z.number().int().describe('KRI link ID'),
  },
  withRisk(async (risk, { kri_id }, u) => {
    const link = await getModels().RiskKri.findOne({ where: { id: kri_id, risk_id: risk.id } });
    if (!link) throw Object.assign(new Error('KRI link not found'), { status: 404 });
    return require('../services/riskMonitoringService').deleteKri(risk, link, u, mcpReq(u));
  }),
);

server.tool(
  'isms_list_risk_categories',
  'List the risk category taxonomy (key, labels de/en/es, active, number of risks). Risks and the risk appetite refer to the key.',
  {
    include_inactive: z.boolean().optional().default(true),
  },
  async ({ include_inactive }) => {
    const out = await require('../services/riskCategoryService').list({ includeInactive: include_inactive });
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
);

server.tool(
  'isms_create_risk_category',
  'Add an entry to the risk category taxonomy. The key (a-z, 0-9, _) is derived from the English label if omitted and never changes afterwards.',
  {
    key:         z.string().optional(),
    label_de:    z.string().min(1),
    label_en:    z.string().min(1),
    label_es:    z.string().optional(),
    description: z.string().optional(),
    sort_order:  z.number().int().min(0).optional(),
  },
  async (args, { mcpUser }) => {
    try {
      const row = await require('../services/riskCategoryService').create(args);
      await require('../services/auditService').auditFromReq(mcpReq(mcpUser), 'create', 'risk_category', row.id, row.key, { key: row.key, label_de: row.label_de, label_en: row.label_en, label_es: row.label_es, active: row.active });
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_update_risk_category',
  'Change labels, description, order or active flag of a risk category. The key cannot be changed; deactivated categories are no longer offered for new risks.',
  {
    id:          z.number().int().describe('Category ID'),
    label_de:    z.string().optional(),
    label_en:    z.string().optional(),
    label_es:    z.string().optional(),
    description: z.string().optional(),
    active:      z.boolean().optional(),
    sort_order:  z.number().int().min(0).optional(),
  },
  async ({ id, ...body }, { mcpUser }) => {
    try {
      const { RiskCategory } = getModels();
      const row = await RiskCategory.findByPk(id);
      if (!row) return { content: [{ type: 'text', text: 'Risk category not found' }], isError: true };
      const { before, after } = await require('../services/riskCategoryService').update(row, body);
      await require('../services/auditService').auditFromReq(mcpReq(mcpUser), 'update', 'risk_category', row.id, row.key, { before, after });
      return { content: [{ type: 'text', text: JSON.stringify(after, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

// ─── Vulnerabilities ─────────────────────────────────────────────────────────
// Same functions as routes/vulnerabilities.js (services/vulnerabilityService.js).

server.tool(
  'isms_list_vulnerabilities',
  'List vulnerabilities from the vulnerability register (manual or taken over from asset CVE data) with linked assets and the number of risks whose scenarios use them.',
  {
    status:   z.enum(['open', 'mitigated', 'closed']).optional(),
    source:   z.enum(['manual', 'cve']).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
    asset_id: z.number().int().optional(),
    search:   z.string().optional().describe('Search in title, CVE id, description'),
    limit:    z.number().int().min(1).max(500).default(100),
  },
  async (args) => {
    try {
      const out = await require('../services/vulnerabilityService').listVulnerabilities({ ...args, asset_id: args.asset_id === undefined ? undefined : String(args.asset_id) });
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_create_vulnerability',
  'Record a vulnerability manually (title, description, severity, CVSS, related assets). CVEs from asset data are taken over with isms_import_asset_cves_as_vulnerabilities.',
  {
    title:       z.string().min(1),
    description: z.string().optional(),
    severity:    z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
    cvss_score:  z.number().min(0).max(10).optional(),
    asset_ids:   z.array(z.number().int()).optional(),
  },
  async (args, { mcpUser }) => {
    try {
      const out = await require('../services/vulnerabilityService').createVulnerability(args, mcpUser, mcpReq(mcpUser));
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_update_vulnerability',
  'Update a vulnerability (title, description, status, severity, CVSS, related assets). The CVE id of a CVE entry cannot be changed.',
  {
    id:          z.number().int(),
    title:       z.string().optional(),
    description: z.string().optional(),
    status:      z.enum(['open', 'mitigated', 'closed']).optional(),
    severity:    z.enum(['critical', 'high', 'medium', 'low', 'none']).nullable().optional(),
    cvss_score:  z.number().min(0).max(10).nullable().optional(),
    asset_ids:   z.array(z.number().int()).optional().describe('Replaces all related assets'),
  },
  async ({ id, ...body }, { mcpUser }) => {
    try {
      const { Vulnerability } = getModels();
      const v = await Vulnerability.findByPk(id);
      if (!v) return { content: [{ type: 'text', text: 'Vulnerability not found' }], isError: true };
      const out = await require('../services/vulnerabilityService').updateVulnerability(v, body, mcpReq(mcpUser), { partial: true });
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_delete_vulnerability',
  'Delete a vulnerability. Refused while it is used in a risk scenario (set status closed instead).',
  {
    id: z.number().int(),
  },
  async ({ id }, { mcpUser }) => {
    try {
      const { Vulnerability } = getModels();
      const v = await Vulnerability.findByPk(id);
      if (!v) return { content: [{ type: 'text', text: 'Vulnerability not found' }], isError: true };
      await require('../services/vulnerabilityService').deleteVulnerability(v, mcpReq(mcpUser));
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, id }, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_import_asset_cves_as_vulnerabilities',
  'Take over selected CVEs from the CVE data of an asset (nightly CVE run) as vulnerabilities. Only the named CVE ids are taken over; without cve_ids the tool lists the CVEs of the asset and whether each is already registered. A CVE already registered gets the asset added.',
  {
    asset_id: z.number().int(),
    cve_ids:  z.array(z.string()).max(100).optional().describe('CVE identifiers to take over (CVE-YYYY-NNNN)'),
  },
  async ({ asset_id, cve_ids }, { mcpUser }) => {
    try {
      const svc = require('../services/vulnerabilityService');
      if (!cve_ids || cve_ids.length === 0) {
        const out = await svc.assetCves(asset_id);
        if (!out) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      }
      const out = await svc.importAssetCves(asset_id, cve_ids, mcpUser, mcpReq(mcpUser));
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_list_threats',
  'List cybersecurity threats from the standardized threat catalog.',
  {
    search: z.string().optional().describe('Filter threats by code, title, or category'),
  },
  async ({ search }) => {
    const { Threat } = getModels();
    const where = {};
    if (search) {
      where[Op.or] = [
        { code: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const threats = await Threat.findAll({ where, order: [['code', 'ASC']] });
    return { content: [{ type: 'text', text: JSON.stringify(threats, null, 2) }] };
  }
);

// ─── Incidents ───────────────────────────────────────────────────────────────

server.tool(
  'isms_list_incidents',
  'List security incidents. Returns ref, title, category, severity, status, nis2_reportable, detected_at.',
  {
    status:   z.string().optional().describe('Filter by status (reported, investigating, contained, resolved, closed)'),
    severity: z.string().optional().describe('Filter by severity (low, medium, high, critical)'),
    search:   z.string().optional(),
    limit:    z.number().int().min(1).max(200).default(50),
  },
  async ({ status, severity, search, limit }) => {
    const { Incident, User } = getModels();
    const where = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (search) where.title = { [Op.iLike]: `%${search}%` };

    const incidents = await Incident.findAll({
      where, limit,
      order: [['detected_at', 'DESC']],
      include: [{ model: User, as: 'assignee', attributes: ['id','name'] }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(incidents, null, 2) }] };
  }
);

server.tool(
  'isms_create_incident',
  'Report a new security incident.',
  {
    title:         z.string().min(1),
    description:   z.string().optional(),
    category:      z.enum(['malware','phishing','data_breach','dos','unauthorized_access','misconfiguration','loss_theft','social_engineering','other']),
    severity:      z.enum(['low','medium','high','critical']),
    nis2_reportable: z.boolean().default(false),
    detected_at:   z.string().optional().describe('ISO 8601 datetime, defaults to now'),
    assignee_id:   z.number().int().optional(),
    asset_ids:     z.array(z.number().int()).optional().describe('Affected Asset IDs (risks on these assets are flagged for reassessment)'),
  },
  async ({ asset_ids, ...args }, { mcpUser }) => {
    const { Incident } = getModels();
    const incident = await Incident.create({
      ...args,
      detected_at: args.detected_at || new Date(),
      status: 'reported',
      reporter_id: mcpUser?.id ?? null,
    });
    if (Array.isArray(asset_ids)) await incident.setAssets(asset_ids);
    // Same reassessment trigger as POST /api/incidents (3.9.0).
    await require('../services/riskMonitoringService').onIncident(incident, { created: true }, mcpReq(mcpUser));
    return { content: [{ type: 'text', text: JSON.stringify(incident, null, 2) }] };
  }
);

server.tool(
  'isms_update_incident_status',
  'Update the status of an incident.',
  {
    id:             z.number().int(),
    status:         z.enum(['reported','investigating','contained','resolved','closed']),
    resolution:     z.string().optional().describe('Resolution notes'),
    lessons_learned: z.string().optional(),
  },
  async ({ id, status, resolution, lessons_learned }) => {
    const { Incident } = getModels();
    const incident = await Incident.findByPk(id);
    if (!incident) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };
    const updates = { status };
    if (resolution) updates.corrective_actions = resolution;
    if (lessons_learned) updates.lessons_learned = lessons_learned;
    if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date();
    await incident.update(updates);
    return { content: [{ type: 'text', text: JSON.stringify(incident, null, 2) }] };
  }
);

server.tool(
  'isms_update_incident',
  'Update an existing security incident details.',
  {
    id:             z.number().int().describe('Incident ID'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    category:       z.enum(['malware','phishing','data_breach','dos','unauthorized_access','misconfiguration','loss_theft','social_engineering','other']).optional(),
    severity:       z.enum(['low','medium','high','critical']).optional(),
    status:         z.enum(['reported','investigating','contained','resolved','closed']).optional(),
    assignee_id:    z.number().int().optional(),
    nis2_reportable: z.boolean().optional(),
    impact:         z.string().optional(),
    root_cause:     z.string().optional(),
    corrective_actions: z.string().optional(),
    lessons_learned: z.string().optional(),
    asset_ids:      z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    risk_ids:       z.array(z.number().int()).optional().describe('Linked Risk IDs'),
  },
  async ({ id, asset_ids, risk_ids, ...updates }, { mcpUser }) => {
    const { Incident } = getModels();
    const monitoring = require('../services/riskMonitoringService');
    const incident = await Incident.findByPk(id);
    if (!incident) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };

    if (updates.status === 'resolved' || updates.status === 'closed') {
      updates.resolved_at = new Date();
    }
    const prevSeverity = incident.severity;
    const links = await monitoring.incidentLinkIds(incident);

    await incident.update(updates);

    if (asset_ids !== undefined) await incident.setAssets(asset_ids);
    if (risk_ids !== undefined) await incident.setRisks(risk_ids);
    // Same reassessment trigger as PUT /api/incidents/:id (3.9.0).
    await monitoring.onIncident(incident, { previousSeverity: prevSeverity, ...(await monitoring.addedIncidentLinks(incident, links)) }, mcpReq(mcpUser));

    const updatedIncident = await Incident.findByPk(id, {
      include: [
        { model: getModels().User, as: 'assignee', attributes: ['id', 'name'] },
        { model: getModels().Asset, as: 'assets', attributes: ['id', 'name'] }
      ]
    });

    return { content: [{ type: 'text', text: JSON.stringify(updatedIncident, null, 2) }] };
  }
);

// ─── Tasks ───────────────────────────────────────────────────────────────────

server.tool(
  'isms_list_tasks',
  'List tasks. Supports filtering by status and assignee. Group-assigned tasks are included.',
  {
    status:          z.enum(['open','in_progress','done','cancelled']).optional(),
    priority:        z.enum(['low','medium','high','critical']).optional(),
    assigned_to_id:  z.number().int().optional(),
    limit:           z.number().int().min(1).max(200).default(50),
  },
  async ({ status, priority, assigned_to_id, limit }) => {
    const { Task, User, Group } = getModels();
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assigned_to_id) where.assigned_to_id = assigned_to_id;

    const tasks = await Task.findAll({
      where, limit,
      order: [['due_date', 'ASC'], ['created_at', 'DESC']],
      include: [
        { model: User, as: 'assignee', attributes: ['id','name'], required: false },
        { model: Group, as: 'assignedGroup', attributes: ['id','name','color'], required: false },
        { model: User, as: 'completedBy', attributes: ['id','name'], required: false },
      ],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }
);

server.tool(
  'isms_create_task',
  'Create a new task. Assign to a user OR a group (first-to-complete semantics for groups).',
  {
    title:                 z.string().min(1),
    description:           z.string().optional(),
    priority:              z.enum(['low','medium','high','critical']).default('medium'),
    due_date:              z.string().optional().describe('ISO 8601 date (YYYY-MM-DD)'),
    assigned_to_id:        z.number().int().optional().describe('Assign to specific user'),
    assigned_to_group_id:  z.number().int().optional().describe('Assign to a group (mutually exclusive with assigned_to_id)'),
    related_type:          z.string().optional().describe('e.g. asset, risk, incident'),
    related_id:            z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    const { Task } = getModels();
    if (args.assigned_to_id && args.assigned_to_group_id) {
      return { content: [{ type: 'text', text: 'Cannot assign to both user and group' }], isError: true };
    }
    const task = await Task.create({ ...args, status: 'open', created_by_id: mcpUser?.id || null });
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'isms_complete_task',
  'Mark a task as done.',
  {
    id: z.number().int(),
  },
  async ({ id }, { mcpUser }) => {
    const { Task } = getModels();
    const task = await Task.findByPk(id);
    if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    await task.update({
      status: 'done',
      completed_by_id: mcpUser?.id || null,
      completed_at: new Date(),
    });
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

// ─── Controls / SoA ──────────────────────────────────────────────────────────

server.tool(
  'isms_list_controls',
  'List security controls and their implementation status (Statement of Applicability).',
  {
    framework: z.string().optional().describe('Filter by framework (iso27001, nis2, bsi, custom)'),
    status:    z.string().optional().describe('Filter by status (implemented, planned, not_applicable)'),
    search:    z.string().optional(),
    limit:     z.number().int().min(1).max(500).default(100),
  },
  async ({ framework, status, search, limit }) => {
    const { Control, Policy } = getModels();
    const where = {};
    if (framework) where.framework = framework;
    if (status) where.status = status;
    if (search) where[Op.or] = [
      { code: { [Op.iLike]: `%${search}%` } },
      { title: { [Op.iLike]: `%${search}%` } },
    ];

    const controls = await Control.findAll({
      where, limit,
      order: [['framework', 'ASC'], ['code', 'ASC']],
      include: [{ model: Policy, as: 'policies', through: { attributes: [] }, required: false }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(controls, null, 2) }] };
  }
);

server.tool(
  'isms_update_control_status',
  'Update the implementation status of a control.',
  {
    id:             z.number().int(),
    status:         z.enum(['implemented', 'planned', 'not_applicable']),
    justification:  z.string().optional().describe('Required/used for not_applicable'),
  },
  async ({ id, status, justification }) => {
    const { Control, Iso27001Control } = getModels();
    const control = await Control.findByPk(id);
    if (!control) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };
    
    const updates = { status };
    if (justification !== undefined) {
      updates.applicability_justification = justification;
    }
    await control.update(updates);

    // Sync status back to module-specific table (best-effort)
    const SOA_TO_ISO = { implemented: 'implemented', not_applicable: 'not_applicable', planned: 'in_progress' };
    if (control.framework === 'iso27001' && control.code && SOA_TO_ISO[status]) {
      Iso27001Control.update(
        { implementation_status: SOA_TO_ISO[status] },
        { where: { ref: control.code } }
      ).catch(() => {});
    }

    return { content: [{ type: 'text', text: JSON.stringify(control, null, 2) }] };
  }
);

server.tool(
  'isms_update_control',
  'Update details, implementation status, or applicability justification of a compliance control / measure.',
  {
    id:             z.number().int().describe('Control ID'),
    status:         z.enum(['implemented', 'planned', 'not_applicable']).optional().describe('SoA implementation status'),
    applicability_justification: z.string().optional().describe('Justification for applicability or non-applicability'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    type:           z.enum(['organizational', 'people', 'physical', 'technological']).optional(),
  },
  async ({ id, ...updates }) => {
    const { Control, Iso27001Control } = getModels();
    const control = await Control.findByPk(id);
    if (!control) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };

    await control.update(updates);

    // Sync status back to module-specific table (best-effort)
    const SOA_TO_ISO = { implemented: 'implemented', not_applicable: 'not_applicable', planned: 'in_progress' };
    if (updates.status !== undefined && control.framework === 'iso27001' && control.code && SOA_TO_ISO[updates.status]) {
      Iso27001Control.update(
        { implementation_status: SOA_TO_ISO[updates.status] },
        { where: { ref: control.code } }
      ).catch(() => {});
    }

    return { content: [{ type: 'text', text: JSON.stringify(control, null, 2) }] };
  }
);

// ─── Dashboard & Reports ─────────────────────────────────────────────────────

server.tool(
  'isms_get_dashboard',
  'Get current ISMS dashboard summary: asset counts, risk distribution, open incidents, overdue reviews, compliance coverage.',
  {},
  async () => {
    const { Asset, Risk, Incident, Reminder, Control } = getModels();
    const [
      totalAssets, activeAssets, openIncidents, criticalRisks, highRisks,
      overdueReminders, implementedControls, totalControls,
    ] = await Promise.all([
      Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
      Asset.count({ where: { status: 'active' } }),
      Incident.count({ where: { status: { [Op.notIn]: ['resolved','closed'] } } }),
      Risk.count({ where: { status: { [Op.notIn]: ['accepted','closed'] }, residual_level: 'critical' } }),
      Risk.count({ where: { status: { [Op.notIn]: ['accepted','closed'] }, residual_level: 'high' } }),
      Reminder.count({ where: { status: 'overdue' } }),
      Control.count({ where: { status: 'implemented' } }),
      Control.count(),
    ]);
    const coverage = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;
    const summary = { totalAssets, activeAssets, openIncidents, criticalRisks, highRisks, overdueReminders, controlCoverage: `${coverage}%`, implementedControls, totalControls };
    // Risk monitoring figures (3.9.0), same as GET /api/dashboard.
    summary.riskMonitoring = await require('../services/riskMonitoringService').monitoringSummary();
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }
);

server.tool(
  'isms_get_management_report',
  'Fetch the full management report: 12-month trends, risk/control/task distribution, auto-calculated KPIs (Health Score, MTTR, coverage rates) and manual KPIs.',
  {},
  async () => {
    // DIESELBE Berechnung wie im Managementbericht.
    //
    // Der Kommentar hier lautete "Reuse the same logic as the report route" -
    // und tat es nicht: Es folgte eine EIGENE Formel (40/20/30/10 statt
    // 30/25/25/20, Aufgabenquote statt Bewertungsabdeckung). Dieselbe
    // Installation lieferte dem Bericht und diesem Werkzeug verschiedene
    // Zahlen. Jetzt rechnet services/healthScore.js fuer beide.
    try {
      const healthScore = require('../services/healthScore');
      const { Asset, Risk, Control, Reminder, Assessment } = getModels();
      const [totalAssets, assessedAssets, implementedControls, totalControls,
             criticalRisks, highRisks, totalRisks, overdueReminders] = await Promise.all([
        Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
        Assessment.count({ where: { is_current: true } }),
        Control.count({ where: { status: 'implemented' } }),
        Control.count(),
        Risk.count({ where: { residual_level: 'critical', status: { [Op.notIn]: ['accepted', 'closed'] } } }),
        Risk.count({ where: { residual_level: 'high', status: { [Op.notIn]: ['accepted', 'closed'] } } }),
        Risk.count(),
        Reminder.count({ where: { status: 'overdue' } }),
      ]);
      const health = healthScore.berechne({
        totalAssets, assessedAssets, totalControls, implementedControls,
        overdueReviews: overdueReminders, criticalRisks, highRisks, totalRisks,
      });
      const report = {
        health_score: health.score,
        health_score_parts: health.parts,
        // Ohne die Basis laesst sich eine 0 nicht von "alles schlecht"
        // unterscheiden - sie kann auch heissen: noch nichts erfasst.
        health_score_basis: health.basis,
        control_coverage: totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0,
        assessment_coverage: totalAssets > 0 ? Math.round((assessedAssets / totalAssets) * 100) : 0,
        open_high_risks: criticalRisks + highRisks,
        overdue_reminders: overdueReminders,
        total_assets: totalAssets,
        // Risk monitoring (3.9.0), same as GET /api/report/trends.
        risk_monitoring: await require('../services/riskMonitoringService').monitoringSummary(),
      };
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'isms_get_compliance_overview',
  'Get compliance framework coverage overview: percentage of implemented controls per framework.',
  {},
  async () => {
    const { Control, sequelize } = getModels();
    const rows = await Control.findAll({
      attributes: [
        'framework',
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status='implemented' THEN 1 ELSE 0 END")), 'implemented'],
      ],
      group: ['framework'],
      raw: true,
    });
    const overview = rows.map(r => ({
      framework: r.framework,
      total: parseInt(r.total),
      implemented: parseInt(r.implemented) || 0,
      coverage: r.total > 0 ? `${Math.round((parseInt(r.implemented) || 0) / r.total * 100)}%` : '0%',
    }));
    return { content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }] };
  }
);

server.tool(
  'isms_get_review_signoffs',
  'List historical Management Review sign-offs (ISO 27001 Kap. 9.3).',
  {},
  async () => {
    const { ReviewSignOff, User } = getModels();
    const signOffs = await ReviewSignOff.findAll({
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
      order: [['approved_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(signOffs, null, 2) }] };
  }
);

server.tool(
  'isms_create_review_signoff',
  'Submit a new Management Review digital sign-off and approval (ISO 27001 Kap. 9.3).',
  {
    report_date: z.string().optional().describe('ISO Date (YYYY-MM-DD) of report, defaults to today'),
    notes:       z.string().optional().describe('Management review notes, executive summary, or decisions'),
  },
  async ({ report_date, notes }, { mcpUser }) => {
    const { ReviewSignOff, User } = getModels();
    const approved_by_id = await getValidUserId(mcpUser);
    const signOff = await ReviewSignOff.create({
      report_date: report_date || new Date().toISOString().slice(0, 10),
      approved_by_id,
      approved_at: new Date(),
      notes,
    });
    const full = await ReviewSignOff.findByPk(signOff.id, {
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
    });
    await logAudit('create', 'review_signoff', signOff.id, `Management Review ${signOff.report_date}`, { notes }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(full, null, 2) }] };
  }
);

// ─── Users & Groups ──────────────────────────────────────────────────────────

server.tool(
  'isms_list_users',
  'List all users. Admin operation — returns name, email, role (the most privileged role the user holds through groups), active status.',
  {
    role:   z.string().optional().describe('Filter: users who hold this role through a group'),
    active: z.boolean().optional().describe('Filter by active status'),
  },
  async ({ role, active }) => {
    const { User } = getModels();
    const where = {};
    // Roles come from groups: filter by who holds the role through a group.
    if (role) where.id = await require('../services/accessService').findUserIdsWithRole(role, { activeOnly: false });
    if (active !== undefined) where.active = active;
    const users = await User.findAll({
      where,
      attributes: ['id','name','email','role','department','active','last_seen_at'],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] };
  }
);

server.tool(
  'isms_list_groups',
  'List all groups/teams with their members and the roles each group carries (roles reach users only through groups).',
  {},
  async () => {
    const { Group } = getModels();
    const groups = await Group.findAll({ include: mcpGroupInclude(), order: [['name', 'ASC']] });
    return { content: [{ type: 'text', text: JSON.stringify(groups.map(mcpGroupJson), null, 2) }] };
  }
);

// ─── Pentests (v2.2.0) ───────────────────────────────────────────────────────

server.tool(
  'isms_list_pentests',
  'List all pentest projects from the pentest register, including owner and findings summary.',
  {},
  async () => {
    const { PentestProject, User, PentestFinding } = getModels();
    const projects = await PentestProject.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: PentestFinding, as: 'findings', attributes: ['id', 'severity', 'status'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
  }
);

server.tool(
  'isms_create_pentest',
  'Register a new pentest project.',
  {
    title:       z.string().min(1).describe('Project title'),
    description: z.string().optional().describe('Details about scope/target'),
    target:      z.string().optional().describe('Scope target (IPs, domains, apps)'),
    status:      z.enum(['planned', 'active', 'completed']).default('planned'),
    owner_id:    z.number().int().optional().describe('User ID of the project owner'),
  },
  async (args, { mcpUser }) => {
    const { PentestProject } = getModels();
    const owner_id = args.owner_id || await getValidUserId(mcpUser);
    const project = await PentestProject.create({ ...args, owner_id });
    await logAudit('create', 'pentest_project', project.id, project.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  }
);

server.tool(
  'isms_list_pentest_findings',
  'List findings for a specific pentest project with optional severity and status filters.',
  {
    project_id: z.number().int().describe('Pentest project ID'),
    severity:   z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by severity'),
    status:     z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional().describe('Filter by status'),
  },
  async ({ project_id, severity, status }) => {
    const { PentestFinding, User } = getModels();
    const where = { project_id };
    if (severity) where.severity = severity;
    if (status) where.status = status;

    const findings = await PentestFinding.findAll({
      where,
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'email'] }],
      order: [['severity', 'ASC'], ['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(findings, null, 2) }] };
  }
);

server.tool(
  'isms_create_pentest_finding',
  'Add a new finding to a pentest project.',
  {
    project_id:  z.number().int().describe('Pentest project ID'),
    title:       z.string().min(1).describe('Finding title'),
    description: z.string().optional().describe('Detailed explanation of vulnerability'),
    severity:    z.enum(['low', 'medium', 'high', 'critical']),
    status:      z.enum(['open', 'in_progress', 'resolved', 'ignored']).default('open'),
    remediation: z.string().optional().describe('Remediation recommendation'),
    assignee_id: z.number().int().optional().describe('User ID assigned to resolve finding'),
  },
  async (args, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const finding = await PentestFinding.create(args);
    await logAudit('create', 'pentest_finding', finding.id, finding.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_update_pentest_finding',
  'Update details or status of an existing pentest finding.',
  {
    id:          z.number().int().describe('Finding ID'),
    title:       z.string().optional(),
    description: z.string().optional(),
    severity:    z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status:      z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional(),
    remediation: z.string().optional(),
    assignee_id: z.number().int().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const finding = await PentestFinding.findByPk(id);
    if (!finding) return { content: [{ type: 'text', text: 'Finding not found' }], isError: true };
    await finding.update(updates);
    await logAudit('update', 'pentest_finding', finding.id, finding.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

// ─── GDPR / DSGVO (v2.2.0) ───────────────────────────────────────────────────

server.tool(
  'isms_list_vvt_entries',
  'List all records of processing activities (VVT - Verzeichnis von Verarbeitungstätigkeiten) for GDPR/DSGVO compliance.',
  {},
  async () => {
    const { VvtEntry, User, Vendor, Asset } = getModels();
    const entries = await VvtEntry.findAll({
      include: [
        { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'processor', attributes: ['id', 'name'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
      ],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
  }
);

server.tool(
  'isms_create_vvt_entry',
  'Create a new VVT entry in the GDPR/DSGVO record of processing activities.',
  {
    name:                    z.string().min(1).describe('Process name'),
    purpose:                 z.string().describe('Purpose of processing'),
    legal_basis:             z.string().describe('Legal basis (e.g. GDPR Art. 6(1)(b))'),
    data_categories:         z.array(z.string()).optional().describe('Categories of personal data processed'),
    special_categories:      z.boolean().optional().describe('Special/sensitive data (e.g. health data, biometric)'),
    data_subjects:           z.array(z.string()).optional().describe('Categories of affected data subjects'),
    recipients:              z.array(z.string()).optional().describe('Internal/external recipients of the data'),
    third_country_transfers: z.boolean().optional().describe('Data transfer details outside EU/EEA'),
    transfer_safeguards:     z.string().optional().describe('Safeguards for transfer (e.g., SCCs)'),
    retention_period:        z.string().optional().describe('Data retention duration'),
    retention_legal_basis:   z.string().optional().describe('Legal basis for keeping the data'),
    deletion_procedure:      z.string().optional().describe('How data is safely deleted'),
    security_measures:       z.string().optional().describe('Technical/organizational measures (TOMs)'),
    responsible_id:          z.number().int().optional().describe('User ID of process owner'),
    processor_id:            z.number().int().optional().describe('Vendor ID of data processor'),
    status:                  z.enum(['draft', 'active', 'archived']).default('active'),
    notes:                   z.string().optional(),
    dsfa_required:           z.boolean().default(false).describe('Whether a DSFA / DPIA is required'),
    asset_ids:               z.array(z.number().int()).optional().describe('Associated Asset IDs'),
    vendor_ids:              z.array(z.number().int()).optional().describe('Associated Vendor IDs'),
  },
  async ({ asset_ids, vendor_ids, ...fields }, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const responsible_id = fields.responsible_id || await getValidUserId(mcpUser);
    const entry = await VvtEntry.create({ ...fields, responsible_id });
    if (Array.isArray(asset_ids)) await entry.setAssets(asset_ids);
    if (Array.isArray(vendor_ids)) await entry.setVendors(vendor_ids);
    await logAudit('create', 'vvt', entry.id, entry.name, fields, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  'isms_list_subject_requests',
  'List GDPR Subject Access Requests (Betroffenenanfragen) with optional status filter.',
  {
    status: z.enum(['received', 'in_progress', 'completed', 'rejected', 'extended']).optional().describe('Filter by request status'),
  },
  async ({ status }) => {
    const { SubjectRequest, User } = getModels();
    const where = {};
    if (status) where.status = status;
    const requests = await SubjectRequest.findAll({
      where,
      include: [{ model: User, as: 'handler', attributes: ['id', 'name', 'email'] }],
      order: [['received_date', 'DESC'], ['id', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(requests, null, 2) }] };
  }
);

server.tool(
  'isms_create_subject_request',
  'Register a new GDPR Subject Access Request (Betroffenenanfrage). Due date is automatically calculated as +30 days.',
  {
    requester_name:       z.string().min(1).describe('Name of the person requesting data'),
    requester_email:      z.string().email().describe('Email address of the requester'),
    type:                 z.enum(['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent']),
    received_date:        z.string().describe('ISO date (YYYY-MM-DD) when request was received'),
    due_date:             z.string().optional().describe('ISO date (YYYY-MM-DD). If omitted, +30 days from received_date'),
    description:          z.string().optional().describe('Request details'),
    handler_id:           z.number().int().optional().describe('User ID of the DPO/Handler'),
    notes:                z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const body = { ...args };
    if (!body.due_date && body.received_date) {
      const d = new Date(body.received_date);
      d.setDate(d.getDate() + 30);
      body.due_date = d.toISOString().split('T')[0];
    }
    const handler_id = body.handler_id || await getValidUserId(mcpUser);
    const request = await SubjectRequest.create({ ...body, handler_id });
    const year = new Date(request.created_at || new Date()).getFullYear();
    const ref = `BSA-${year}-${String(request.id).padStart(3, '0')}`;
    await request.update({ ref });
    await logAudit('create', 'subject_request', request.id, `${ref} (${request.requester_name})`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(request, null, 2) }] };
  }
);

server.tool(
  'isms_update_subject_request_status',
  'Update status, decision, or handler of a GDPR Subject Access Request.',
  {
    id:               z.number().int().describe('Subject request ID'),
    status:           z.enum(['received', 'in_progress', 'completed', 'rejected', 'extended']),
    decision:         z.string().optional().describe('Decision details (e.g. data sent, rejected reason)'),
    notes:            z.string().optional(),
    handler_id:       z.number().int().optional(),
    extended_until:   z.string().optional().describe('Extended due date ISO YYYY-MM-DD'),
    extension_reason: z.string().optional(),
  },
  async ({ id, status, decision, notes, handler_id, extended_until, extension_reason }, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const request = await SubjectRequest.findByPk(id);
    if (!request) return { content: [{ type: 'text', text: 'Subject request not found' }], isError: true };

    const updates = { status };
    if (decision !== undefined) updates.decision = decision;
    if (notes !== undefined) updates.notes = notes;
    if (handler_id !== undefined) updates.handler_id = handler_id;
    if (extended_until !== undefined) updates.extended_until = extended_until;
    if (extension_reason !== undefined) updates.extension_reason = extension_reason;

    if (status === 'completed' && !request.completed_at) {
      updates.completed_at = new Date();
    }

    await request.update(updates);
    await logAudit('update', 'subject_request', request.id, request.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(request, null, 2) }] };
  }
);

// ─── Vendor Risk Management (v2.2.0) ─────────────────────────────────────────

server.tool(
  'isms_list_vendors',
  'List all vendors/processors with their details and risk levels.',
  {
    risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by risk level'),
  },
  async ({ risk_level }, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const where = {};
    if (risk_level) where.risk_level = risk_level;

    // Spiegelt routes/vendors.js: das Tool-Gate prueft vendors.view, die
    // Kontaktdaten haengen aber an vendors.view_details. Ohne diese Trennung
    // liefert MCP Lieferanten-Kontaktdaten an Rollen aus, denen die REST-API
    // und die Weboberflaeche sie vorenthalten (viewer, employee, management,
    // owner). Es geht dabei um personenbezogene Daten, nicht nur um eine
    // Berechtigungsfeinheit.
    let staff;
    try {
      const { decide } = require('../services/permissionService');
      staff = await decide(mcpUser, 'vendors', 'view_details', ['admin', 'assessor', 'it-staff', 'dpo']);
    } catch (e) {
      // Nie fail-open: im Zweifel die eingeschraenkte Sicht ausliefern.
      console.error('[MCP] vendors.view_details check failed:', e.message);
      staff = false;
    }

    const vendors = staff
      ? await Vendor.findAll({ where, include: [{ model: VendorContact, as: 'contacts' }], order: [['name', 'ASC']] })
      : await Vendor.findAll({ where, attributes: ['id', 'name', 'type', 'criticality'], order: [['name', 'ASC']] });

    return { content: [{ type: 'text', text: JSON.stringify(vendors, null, 2) }] };
  }
);

server.tool(
  'isms_create_vendor',
  'Register a new vendor/processor in the vendor register.',
  {
    name:    z.string().min(1).describe('Vendor name'),
    type:    z.enum(['it_provider', 'software_vendor', 'hardware_vendor', 'cloud_provider', 'support', 'consultant', 'other', 'software', 'cloud', 'hardware', 'consulting', 'hosting', 'logistics']).default('other').describe('Vendor type'),
    website: z.string().optional(),
    phone:   z.string().optional(),
    address: z.string().optional(),
    notes:   z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor } = getModels();
    const vendor = await Vendor.create(args);
    await logAudit('create', 'vendor', vendor.id, vendor.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(vendor, null, 2) }] };
  }
);

server.tool(
  'isms_assess_vendor',
  'Perform or update the security and risk assessment of a vendor/processor.',
  {
    id:                  z.number().int().describe('Vendor ID'),
    risk_level:          z.enum(['low', 'medium', 'high', 'critical']).describe('Assessed risk level'),
    risk_score:          z.number().int().min(1).max(25).describe('Calculated risk score (e.g., probability x impact, 1-25)'),
    data_processor:      z.boolean().describe('Is the vendor a processor of personal data (GDPR)?'),
    dpa_signed:          z.boolean().describe('Is the Data Processing Agreement (DPA/AVV) signed?'),
    dpa_signed_at:       z.string().optional().describe('ISO date (YYYY-MM-DD) when DPA was signed'),
    iso27001_certified:  z.boolean().describe('Is the vendor ISO 27001 certified?'),
    soc2_certified:      z.boolean().describe('Has the vendor a SOC2 Type II report?'),
    gdpr_compliant:      z.boolean().describe('Is the vendor evaluated as GDPR compliant?'),
    fourth_party_risks:  z.string().optional().describe('Notes on subcontractors/fourth-parties'),
    assessment_notes:    z.string().optional().describe('Summary of the audit/assessment'),
    next_review_date:    z.string().optional().describe('ISO date (YYYY-MM-DD) for next audit'),
  },
  async ({ id, dpa_signed_at, next_review_date, ...updates }, { mcpUser }) => {
    const { Vendor } = getModels();
    const vendor = await Vendor.findByPk(id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };

    const cleanDate = (val) => (val === '' || val === 'Invalid date' || !val) ? null : val;
    const assessed_by_id = await getValidUserId(mcpUser);

    const fullUpdates = {
      ...updates,
      dpa_signed_at: cleanDate(dpa_signed_at),
      next_review_date: cleanDate(next_review_date),
      last_assessed_at: new Date(),
      assessed_by_id,
    };

    await vendor.update(fullUpdates);
    await logAudit('update', 'vendor', vendor.id, vendor.name, { action: 'risk_assessment', ...fullUpdates }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(vendor, null, 2) }] };
  }
);

// ─── Business Continuity Management (v2.2.0) ─────────────────────────────────

server.tool(
  'isms_list_bcm_processes',
  'List all critical business processes from the Business Impact Analysis (BIA).',
  {},
  async () => {
    const { BcmProcess, User } = getModels();
    const processes = await BcmProcess.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(processes, null, 2) }] };
  }
);

server.tool(
  'isms_list_bcm_exercises',
  'List BCM tests, exercises, and drills performed for business continuity.',
  {},
  async () => {
    const { BcmExercise, BcmProcess } = getModels();
    const exercises = await BcmExercise.findAll({
      include: [{ model: BcmProcess, as: 'process', attributes: ['id', 'name', 'criticality'] }],
      order: [['exercise_date', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(exercises, null, 2) }] };
  }
);

server.tool(
  'isms_create_bcm_exercise',
  'Create/log a new BCM tabletop exercise, simulation, or full drill.',
  {
    title:            z.string().min(1).describe('Exercise/Drill title'),
    process_id:       z.number().int().describe('Associated BCM/BIA Process ID'),
    exercise_type:    z.enum(['tabletop', 'simulation', 'technical_recovery', 'full_failover']).describe('Type of test'),
    exercise_date:    z.string().describe('ISO Date (YYYY-MM-DD) when test took place'),
    participants:     z.string().optional().describe('List of participants'),
    result:           z.enum(['pending', 'passed', 'passed_with_findings', 'failed']).default('passed'),
    findings:         z.string().optional().describe('Gaps/issues identified during the test'),
    actions:          z.string().optional().describe('Corrective actions planned (remediation)'),
    notes:            z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const exercise = await BcmExercise.create(args);
    await logAudit('create', 'bcm_exercise', exercise.id, exercise.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(exercise, null, 2) }] };
  }
);

// ─── DORA Compliance (v2.2.0) ────────────────────────────────────────────────

server.tool(
  'isms_list_dora_third_parties',
  'List ICT third-party service providers registered under DORA regulations.',
  {},
  async () => {
    const { DoraThirdParty } = getModels();
    const providers = await DoraThirdParty.findAll({
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }] };
  }
);

server.tool(
  'isms_list_dora_tests',
  'List digital operational resilience tests required by DORA.',
  {},
  async () => {
    const { DoraResilienceTest } = getModels();
    const tests = await DoraResilienceTest.findAll({
      order: [['test_date', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tests, null, 2) }] };
  }
);

// ─── Auto-Discovery (v2.2.0) ─────────────────────────────────────────────────

server.tool(
  'isms_list_discovered_software',
  'List staged auto-discovered software and hosts from network scans or agents.',
  {
    status: z.enum(['pending', 'approved', 'ignored']).optional().default('pending').describe('Filter by staged status'),
  },
  async ({ status }) => {
    const { DiscoveredSoftware } = getModels();
    const list = await DiscoveredSoftware.findAll({
      where: { status },
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  'isms_approve_discovered_software',
  'Approve a staged discovered item, which converts it into an active Asset.',
  {
    id:         z.number().int().describe('Staged item ID'),
    asset_type: z.enum(['hardware', 'software', 'application', 'service', 'other']).optional().describe('Asset type to override'),
  },
  async ({ id, asset_type }, { mcpUser }) => {
    const { DiscoveredSoftware, Asset } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Staged item not found' }], isError: true };
    if (item.status === 'approved') return { content: [{ type: 'text', text: 'Item is already approved' }], isError: true };

    const isNetworkScan = item.source === 'network-scan';
    const searchWhere = isNetworkScan && item.ip
      ? { name: { [Op.iLike]: `%${item.ip}%` } }
      : { name: item.name };

    const existing = await Asset.findOne({
      where: { ...searchWhere, status: { [Op.ne]: 'decommissioned' } }
    });

    if (!existing) {
      let tags, description;
      const today = new Date().toISOString().split('T')[0];

      if (isNetworkScan) {
        const openPorts = item.open_ports ? JSON.parse(item.open_ports) : [];
        const portTags = openPorts.map(p => `port:${p.port}`);
        tags = ['network-scan', `ip:${item.ip}`, ...portTags];
        if (item.os) tags.push(`os:${item.os.replace(/\s+/g, '_')}`);
        const services = openPorts.map(p => p.service).join(', ');
        description = `Netzwerk-Scan: ${item.ip}${item.hostname !== item.ip ? ` (${item.hostname})` : ''}${item.os ? ` · System: ${item.os}${item.version ? ` ${item.version}` : ''}` : ''}${services ? ` · Dienste: ${services}` : ''} — freigegeben am ${today}`;
      } else {
        tags = ['auto-discovered', `host:${item.hostname}`];
        if (item.ip) tags.push(`ip:${item.ip}`);
        description = `Automatisch erkannt auf ${item.hostname}${item.ip ? ` (${item.ip})` : ''}${item.os ? ` · ${item.os}` : ''} und am ${today} freigegeben.`;
      }

      const creatorId = await getValidUserId(mcpUser);

      await Asset.create({
        name:             item.name,
        type:             asset_type || item.asset_type || 'software',
        classification:   'internal',
        lifecycle_status: 'evaluation',
        location:         item.ip || null,
        version:          item.version || null,
        vendor:           item.vendor  || null,
        owner_id:         creatorId,
        assessor_id:      creatorId,
        tags:             tags,
        description,
        status:           'active',
      });
    }

    await item.update({ status: 'approved' });
    await logAudit('approve_discovery', 'asset', item.id, item.name, { asset_type }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Discovered software approved and added/merged into active Assets.` }, null, 2) }] };
  }
);

server.tool(
  'isms_ignore_discovered_software',
  'Ignore a staged discovered item so it is hidden from approval queues.',
  {
    id: z.number().int().describe('Staged item ID'),
  },
  async ({ id }, { mcpUser }) => {
    const { DiscoveredSoftware } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Staged item not found' }], isError: true };
    await item.update({ status: 'ignored' });
    await logAudit('ignore_discovery', 'discovered_software', item.id, item.name, {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Item marked as ignored.' }, null, 2) }] };
  }
);

// ─── Search ───────────────────────────────────────────────────────────────────

server.tool(
  'isms_search',
  'Cross-entity search across assets, risks, incidents, and tasks.',
  {
    query: z.string().min(1).describe('Search term'),
    limit: z.number().int().min(1).max(20).default(10).describe('Results per entity type'),
  },
  async ({ query, limit }) => {
    const { Asset, Risk, Incident, Task } = getModels();
    const like = { [Op.iLike]: `%${query}%` };
    const [assets, risks, incidents, tasks] = await Promise.all([
      Asset.findAll({ where: { name: like }, limit, attributes: ['id','name','type','status'] }),
      Risk.findAll({ where: { title: like }, limit, attributes: ['id','ref','title','residual_level','status'] }),
      Incident.findAll({ where: { title: like }, limit, attributes: ['id','ref','title','severity','status'] }),
      Task.findAll({ where: { title: like }, limit, attributes: ['id','title','status','priority','due_date'] }),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ assets, risks, incidents, tasks }, null, 2) }] };
  }
);

server.tool(
  'isms_list_features',
  'List all system compliance modules/features and their activation status (enabled/disabled).',
  {},
  async () => {
    const { getModules } = require('../middleware/modules');
    const modules = await getModules();
    return { content: [{ type: 'text', text: JSON.stringify(modules, null, 2) }] };
  }
);

server.tool(
  'isms_set_feature_status',
  'Enable or disable a specific system feature/module.',
  {
    feature: z.enum(['dsgvo', 'tisax', 'dora', 'ai_act', 'bcm', 'pentest', 'discovery', 'iso27001', 'bsi_grundschutz', 'nis2', 'c5', 'mcp', 'threat_intel']).describe('The feature key'),
    enabled: z.boolean().describe('Set true to enable, false to disable'),
  },
  async ({ feature, enabled }) => {
    const { getSetting, setSetting } = require('../services/settingsService');
    const { invalidateModulesCache, MODULE_DEFAULTS } = require('../middleware/modules');

    const raw = await getSetting('modules');
    let stored = {};
    if (raw) {
      try {
        stored = JSON.parse(raw);
        if (typeof stored === 'string') stored = JSON.parse(stored);
      } catch (e) {
        stored = {};
      }
    }
    
    const value = { ...MODULE_DEFAULTS, ...stored };
    value[feature] = enabled;

    await setSetting('modules', value);
    invalidateModulesCache();

    return { content: [{ type: 'text', text: JSON.stringify({ feature, enabled, current_state: value }, null, 2) }] };
  }
);

// ─── EU AI Act (v2.2.0) ──────────────────────────────────────────────────────

server.tool(
  'isms_list_ai_systems',
  'List all registered AI systems from the EU AI Act compliance register.',
  {
    risk_category:     z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).optional().describe('Filter by AI Act risk category'),
    conformity_status: z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).optional(),
    approval_status:   z.enum(['approved', 'not_approved']).optional(),
  },
  async ({ risk_category, conformity_status, approval_status }) => {
    const { AiSystem, User, Vendor } = getModels();
    const where = {};
    if (risk_category) where.risk_category = risk_category;
    if (conformity_status) where.conformity_status = conformity_status;
    if (approval_status) where.approval_status = approval_status;

    const systems = await AiSystem.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'vendor', attributes: ['id', 'name'] },
      ],
      order: [['risk_category', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(systems, null, 2) }] };
  }
);

server.tool(
  'isms_create_ai_system',
  'Register a new AI system in the EU AI Act register.',
  {
    name:               z.string().min(1).describe('AI system name'),
    description:        z.string().optional(),
    risk_category:      z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).default('minimal'),
    use_case:           z.string().optional(),
    provider:           z.string().optional().describe('Vendor or provider of the AI model'),
    vendor_id:          z.number().int().optional(),
    location:           z.string().optional(),
    deployed_since:     z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    owner_id:           z.number().int().optional(),
    conformity_status:  z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).default('not_assessed'),
    approval_status:    z.enum(['approved', 'not_approved']).default('approved'),
    documentation_url:  z.string().optional(),
    last_review_date:   z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    notes:              z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { AiSystem } = getModels();
    const owner_id = args.owner_id || await getValidUserId(mcpUser);
    const system = await AiSystem.create({ ...args, owner_id });
    await logAudit('create', 'ai_system', system.id, system.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(system, null, 2) }] };
  }
);

server.tool(
  'isms_update_ai_system',
  'Update details, conformity status, or risk category of an AI system in the EU AI Act register.',
  {
    id:                 z.number().int().describe('AI System ID'),
    name:               z.string().optional(),
    description:        z.string().optional(),
    risk_category:      z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).optional(),
    use_case:           z.string().optional(),
    provider:           z.string().optional(),
    vendor_id:          z.number().int().optional(),
    location:           z.string().optional(),
    deployed_since:     z.string().optional(),
    owner_id:           z.number().int().optional(),
    conformity_status:  z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).optional(),
    approval_status:    z.enum(['approved', 'not_approved']).optional(),
    documentation_url:  z.string().optional(),
    last_review_date:   z.string().optional(),
    notes:              z.string().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { AiSystem } = getModels();
    const system = await AiSystem.findByPk(id);
    if (!system) return { content: [{ type: 'text', text: 'AI System not found' }], isError: true };

    await system.update(updates);
    await logAudit('update', 'ai_system', system.id, system.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(system, null, 2) }] };
  }
);

server.tool(
  'isms_delete_ai_system',
  'Delete an AI system from the EU AI Act register and cancel associated open tasks.',
  {
    id: z.number().int().describe('AI System ID to delete'),
  },
  async ({ id }, { mcpUser }) => {
    const { AiSystem, Task } = getModels();
    const system = await AiSystem.findByPk(id);
    if (!system) return { content: [{ type: 'text', text: 'AI System not found' }], isError: true };

    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'ai_system', related_id: system.id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );

    await logAudit('delete', 'ai_system', system.id, system.name, {}, mcpUser);
    await system.destroy();

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `AI System "${system.name}" (ID: ${id}) deleted.` }, null, 2) }] };
  }
);

// ─── Policies (v2.2.0) ───────────────────────────────────────────────────────

server.tool(
  'isms_list_policies',
  'List security policies, guidelines, and procedures with linked assets and controls.',
  {
    category: z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).optional().describe('Filter by policy category'),
    status:   z.enum(['draft', 'active', 'retired']).optional().describe('Filter by status'),
    search:   z.string().optional().describe('Search in title, code, or description'),
  },
  async ({ category, status, search }) => {
    const { Policy, Asset, Control } = getModels();
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const policies = await Policy.findAll({
      where,
      include: [
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework'], through: { attributes: [] } },
      ],
      order: [['code', 'ASC'], ['title', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(policies, null, 2) }] };
  }
);

server.tool(
  'isms_get_policy',
  'Get full details of a single policy including version history, mapped controls, and assets.',
  {
    id: z.number().int().describe('Policy ID'),
  },
  async ({ id }) => {
    const { Policy, PolicyVersion, Asset, Control } = getModels();
    const policy = await Policy.findByPk(id, {
      include: [
        { model: PolicyVersion, as: 'history', attributes: ['id', 'version', 'created_at', 'notes'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: [] } },
      ],
    });
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_create_policy',
  'Register a new policy, guideline, or procedure in the policy management system.',
  {
    title:       z.string().min(1).describe('Policy title'),
    code:        z.string().optional().describe('Policy code, e.g. "POL-001"'),
    description: z.string().optional().describe('Summary / content of the policy'),
    category:    z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).default('policy'),
    status:      z.enum(['draft', 'active', 'retired']).default('active'),
    version:     z.string().default('1.0'),
    valid_from:  z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    valid_until: z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    asset_ids:   z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    control_ids: z.array(z.number().int()).optional().describe('Linked Control IDs (TOMs)'),
  },
  async ({ asset_ids, control_ids, ...fields }, { mcpUser }) => {
    const { Policy } = getModels();
    const policy = await Policy.create(fields);
    if (Array.isArray(asset_ids)) await policy.setAssets(asset_ids);
    if (Array.isArray(control_ids)) await policy.setControls(control_ids);
    await logAudit('create', 'policy', policy.id, policy.title, fields, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_update_policy',
  'Update details, status, or mapped controls of an existing policy.',
  {
    id:          z.number().int().describe('Policy ID'),
    title:       z.string().optional(),
    code:        z.string().optional(),
    description: z.string().optional(),
    category:    z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).optional(),
    status:      z.enum(['draft', 'active', 'retired']).optional(),
    version:     z.string().optional(),
    valid_from:  z.string().optional(),
    valid_until: z.string().optional(),
    asset_ids:   z.array(z.number().int()).optional(),
    control_ids: z.array(z.number().int()).optional(),
  },
  async ({ id, asset_ids, control_ids, ...updates }, { mcpUser }) => {
    const { Policy } = getModels();
    const policy = await Policy.findByPk(id);
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };

    await policy.update(updates);
    if (Array.isArray(asset_ids)) await policy.setAssets(asset_ids);
    if (Array.isArray(control_ids)) await policy.setControls(control_ids);

    await logAudit('update', 'policy', policy.id, policy.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_acknowledge_policy',
  'Submit user acknowledgment/acceptance of a security policy.',
  {
    id: z.number().int().describe('Policy ID to acknowledge'),
  },
  async ({ id }, { mcpUser }) => {
    const { Policy, PolicyAcknowledgment } = getModels();
    const policy = await Policy.findByPk(id);
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };

    const user_id = await getValidUserId(mcpUser);
    const existing = await PolicyAcknowledgment.findOne({ where: { policy_id: id, user_id } });
    if (existing) {
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Policy already acknowledged.', acknowledged_at: existing.acknowledged_at }, null, 2) }] };
    }

    const ack = await PolicyAcknowledgment.create({
      policy_id: id,
      user_id,
      acknowledged_at: new Date(),
    });

    await logAudit('acknowledge', 'policy', policy.id, policy.title, { acknowledged_by: user_id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(ack, null, 2) }] };
  }
);

// ─── Compliance Audits, CAPA & KPIs (v2.2.0) ─────────────────────────────────

server.tool(
  'isms_list_audits',
  'List internal, external, and certification audits along with findings and CAPA tasks.',
  {
    audit_type: z.enum(['internal', 'external', 'certification']).optional().describe('Filter by audit type'),
    status:     z.enum(['planned', 'in_progress', 'completed']).optional().describe('Filter by status'),
  },
  async ({ audit_type, status }) => {
    const { Audit, AuditFinding, User, Task } = getModels();
    const where = {};
    if (audit_type) where.audit_type = audit_type;
    if (status) where.status = status;

    const audits = await Audit.findAll({
      where,
      include: [
        {
          model: AuditFinding,
          as: 'findings',
          include: [
            { model: User, as: 'assignee', attributes: ['id', 'name'] },
            { model: Task, as: 'capaTask', attributes: ['id', 'title', 'status'] },
          ],
        },
      ],
      order: [['start_date', 'DESC'], ['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(audits, null, 2) }] };
  }
);

server.tool(
  'isms_create_audit',
  'Plan or log a new compliance audit (internal, external, or certification).',
  {
    title:       z.string().min(1).describe('Audit title / objective'),
    scope:       z.string().optional().describe('Scope and audited departments / systems'),
    audit_type:  z.enum(['internal', 'external', 'certification']).default('internal'),
    status:      z.enum(['planned', 'in_progress', 'completed']).default('planned'),
    auditor:     z.string().optional().describe('Auditor or auditing company name'),
    start_date:  z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    end_date:    z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    report_link: z.string().optional().describe('Link to final audit report'),
    notes:       z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Audit } = getModels();
    const audit = await Audit.create(args);
    await logAudit('create', 'audit', audit.id, audit.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }] };
  }
);

server.tool(
  'isms_update_audit',
  'Update details or status of an existing compliance audit.',
  {
    id:          z.number().int().describe('Audit ID'),
    title:       z.string().optional(),
    scope:       z.string().optional(),
    audit_type:  z.enum(['internal', 'external', 'certification']).optional(),
    status:      z.enum(['planned', 'in_progress', 'completed']).optional(),
    auditor:     z.string().optional(),
    start_date:  z.string().optional(),
    end_date:    z.string().optional(),
    report_link: z.string().optional(),
    notes:       z.string().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { Audit } = getModels();
    const audit = await Audit.findByPk(id);
    if (!audit) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };

    await audit.update(updates);
    await logAudit('update', 'audit', audit.id, audit.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }] };
  }
);

server.tool(
  'isms_create_audit_finding',
  'Create a new finding / deviation from an audit and optionally assign it for remediation.',
  {
    audit_id:    z.number().int().describe('Audit ID'),
    title:       z.string().min(1).describe('Finding title / issue description'),
    description: z.string().optional().describe('Detailed observation and standard non-conformity'),
    severity:    z.enum(['minor', 'major', 'observation']).default('observation'),
    status:      z.enum(['open', 'resolved', 'wont_fix']).default('open'),
    assignee_id: z.number().int().optional().describe('User ID responsible for resolution'),
    risk_ids:    z.array(z.number().int()).max(100).optional().describe('Related risk IDs - these risks are flagged for reassessment'),
  },
  async ({ risk_ids, ...args }, { mcpUser }) => {
    const { Audit, AuditFinding, Risk } = getModels();
    const audit = await Audit.findByPk(args.audit_id);
    if (!audit) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };
    const riskIds = [...new Set(risk_ids || [])];
    if (riskIds.length && await Risk.count({ where: { id: riskIds } }) !== riskIds.length) return { content: [{ type: 'text', text: 'Unknown risk in risk_ids' }], isError: true };

    const finding = await AuditFinding.create(args);
    if (riskIds.length) await finding.setRisks(riskIds);
    await logAudit('create', 'audit_finding', finding.id, finding.title, { ...args, risk_ids: riskIds }, mcpUser);
    // Same reassessment trigger as POST /api/compliance/audits/:id/findings (3.9.0).
    if (riskIds.length) await require('../services/riskMonitoringService').onAuditFinding(finding, riskIds, mcpReq(mcpUser));
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_update_audit_finding',
  'Update status, severity, or remediation details of an audit finding.',
  {
    id:          z.number().int().describe('Audit Finding ID'),
    title:       z.string().optional(),
    description: z.string().optional(),
    severity:    z.enum(['minor', 'major', 'observation']).optional(),
    status:      z.enum(['open', 'resolved', 'wont_fix']).optional(),
    assignee_id: z.number().int().optional(),
    risk_ids:    z.array(z.number().int()).max(100).optional().describe('Related risk IDs (replaces the list); newly linked risks are flagged for reassessment'),
  },
  async ({ id, risk_ids, ...updates }, { mcpUser }) => {
    const { AuditFinding, Risk } = getModels();
    const finding = await AuditFinding.findByPk(id);
    if (!finding) return { content: [{ type: 'text', text: 'Audit finding not found' }], isError: true };
    let added = [];
    if (risk_ids !== undefined) {
      const riskIds = [...new Set(risk_ids)];
      if (riskIds.length && await Risk.count({ where: { id: riskIds } }) !== riskIds.length) return { content: [{ type: 'text', text: 'Unknown risk in risk_ids' }], isError: true };
      const prev = (await finding.getRisks({ attributes: ['id'], joinTableAttributes: [] })).map(r => r.id);
      await finding.setRisks(riskIds);
      added = riskIds.filter(x => !prev.includes(x));
      updates = { ...updates, risk_ids: riskIds };
    }

    const { risk_ids: _ignored, ...fields } = updates;
    await finding.update(fields);
    await logAudit('update', 'audit_finding', finding.id, finding.title, updates, mcpUser);
    if (added.length) await require('../services/riskMonitoringService').onAuditFinding(finding, added, mcpReq(mcpUser));
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_list_kpis',
  'List security & compliance KPIs along with measurement history and target values.',
  {},
  async () => {
    const { Kpi, KpiMeasurement, User } = getModels();
    const kpis = await Kpi.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: KpiMeasurement, as: 'measurements', order: [['measured_at', 'DESC']] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(kpis, null, 2) }] };
  }
);

server.tool(
  'isms_record_kpi_measurement',
  'Record a new measured value for a security KPI.',
  {
    kpi_id:      z.number().int().describe('KPI ID'),
    value:       z.number().describe('Measured numerical value'),
    measured_at: z.string().optional().describe('ISO Date (YYYY-MM-DD), defaults to today'),
    notes:       z.string().optional(),
  },
  async ({ kpi_id, value, measured_at, notes }, { mcpUser }) => {
    const { Kpi, KpiMeasurement } = getModels();
    const kpi = await Kpi.findByPk(kpi_id);
    if (!kpi) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };

    const measurement = await KpiMeasurement.create({
      kpi_id,
      value,
      measured_at: measured_at || new Date().toISOString().split('T')[0],
      notes,
    });

    await kpi.update({ current_value: value });
    await logAudit('create', 'kpi_measurement', measurement.id, `KPI: ${kpi.title}`, { value }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(measurement, null, 2) }] };
  }
);




// ─── Threats ─────────────────────────────────────────────────────────────────

server.tool(
  'isms_create_threat',
  'Add a custom cybersecurity threat to the ISMS threat catalog.',
  {
    name: z.string().min(1).describe('Threat name / title'),
    category: z.string().optional().describe('Threat category (e.g. Malware, Phishing, Physical, Human Error)'),
    description: z.string().optional().describe('Threat description'),
    default_likelihood: z.number().int().min(1).max(5).default(3).describe('Default likelihood (1-5)'),
    default_impact: z.number().int().min(1).max(5).default(3).describe('Default impact (1-5)'),
  },
  async (args, { mcpUser }) => {
    const { Threat } = getModels();
    const item = await Threat.create(args);
    await logAudit('create', 'threat', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

// ─── Incident Deletion ───────────────────────────────────────────────────────

server.tool(
  'isms_delete_incident',
  'Delete / remove a security incident from the incident register.',
  { id: z.number().int().describe('Incident ID') },
  async ({ id }, { mcpUser }) => {
    const { Incident } = getModels();
    const item = await Incident.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };
    await logAudit('delete', 'incident', item.id, item.title || `Incident #${item.id}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Task Details, Stats & Deletion ──────────────────────────────────────────

server.tool(
  'isms_get_task',
  'Get full details of a specific task including assignee, group members, and creator.',
  { id: z.number().int().describe('Task ID') },
  async ({ id }) => {
    const { Task, User, Group } = getModels();
    const item = await Task.findByPk(id, {
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'createdBy', attributes: ['id', 'name'] },
        { model: User, as: 'completedBy', attributes: ['id', 'name'] },
        {
          model: Group,
          as: 'assignedGroup',
          attributes: ['id', 'name', 'color'],
          include: [{ model: User, as: 'members', attributes: ['id', 'name', 'email'], through: { attributes: [] } }],
        },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_task',
  'Update details, status, priority, due date, or assignees of a task.',
  {
    id: z.number().int().describe('Task ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    due_date: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    reminder_date: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    assigned_to_id: z.number().int().nullable().optional(),
    assigned_to_group_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { Task } = getModels();
    const item = await Task.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.status === 'done' && !item.completed_at) {
      updates.completed_at = new Date();
      updates.completed_by_id = await getValidUserId(mcpUser);
    }
    await item.update(updates);
    await logAudit('update', 'task', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_task',
  'Delete a task from the system.',
  { id: z.number().int().describe('Task ID') },
  async ({ id }, { mcpUser }) => {
    const { Task } = getModels();
    const item = await Task.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    await logAudit('delete', 'task', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_task_stats',
  'Get aggregated task counts (open, in_progress, done, overdue).',
  {},
  async () => {
    const { Task, Asset } = getModels();
    const inactiveAssets = await Asset.findAll({
      where: { status: { [Op.in]: ['inactive', 'decommissioned'] } },
      attributes: ['id'],
      raw: true,
    });
    const inactiveAssetIds = new Set(inactiveAssets.map(a => a.id));
    const activeAssetFilter = inactiveAssetIds.size > 0 ? {
      [Op.or]: [
        { related_type: { [Op.ne]: 'asset' } },
        { related_type: null },
        { related_id: { [Op.notIn]: [...inactiveAssetIds] } },
      ]
    } : {};
    const todayStr = new Date().toISOString().slice(0, 10);
    const [open, in_progress, done, overdue] = await Promise.all([
      Task.count({ where: { status: 'open', ...activeAssetFilter } }),
      Task.count({ where: { status: 'in_progress', ...activeAssetFilter } }),
      Task.count({ where: { status: 'done', ...activeAssetFilter } }),
      Task.count({ where: { status: { [Op.notIn]: ['done', 'cancelled'] }, due_date: { [Op.lt]: todayStr }, ...activeAssetFilter } }),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ open, in_progress, done, overdue }, null, 2) }] };
  }
);

// ─── Reminders, Notifications & User Dashboard ───────────────────────────────

server.tool(
  'isms_list_reminders',
  'List active and pending asset review reminders.',
  {
    status: z.enum(['pending', 'acknowledged', 'overdue', 'all']).default('all'),
  },
  async ({ status }) => {
    const { Reminder, Asset } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    const items = await Reminder.findAll({
      where,
      include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'] }],
      order: [['due_date', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_acknowledge_reminder',
  'Acknowledge / complete an asset review reminder, auto-closing any associated task.',
  { id: z.number().int().describe('Reminder ID') },
  async ({ id }, { mcpUser }) => {
    const { Reminder, Task } = getModels();
    const item = await Reminder.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Reminder not found' }], isError: true };
    const userId = await getValidUserId(mcpUser);
    await item.update({ status: 'acknowledged', acknowledged_at: new Date(), acknowledged_by: userId });
    if (item.task_id) {
      await Task.update({ status: 'done', completed_at: new Date(), completed_by_id: userId }, { where: { id: item.task_id } });
    }
    await logAudit('acknowledge', 'reminder', item.id, `Reminder #${item.id}`, { asset_id: item.asset_id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_dismiss_reminder',
  'Dismiss an asset review reminder.',
  { id: z.number().int().describe('Reminder ID') },
  async ({ id }, { mcpUser }) => {
    const { Reminder } = getModels();
    const item = await Reminder.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Reminder not found' }], isError: true };
    await item.update({ dismissed: true });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }] };
  }
);

server.tool(
  'isms_list_notifications',
  'List pending notifications, overdue reminders, and assets requiring review.',
  {},
  async (args, { mcpUser }) => {
    const { Reminder, Asset, Notification, User, sequelize } = getModels();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().split('T')[0];
    const userId = mcpUser?.id || 1;

    const [overdueRows, upcomingRows, unassessedAssets, userNotes] = await Promise.all([
      Reminder.findAll({
        where: { status: 'overdue', dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Reminder.findAll({
        where: { status: 'pending', due_date: { [Op.between]: [todayStr, in30Str] }, dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Asset.findAll({
        where: {
          status: 'active',
          id: { [Op.notIn]: sequelize.literal('(SELECT asset_id FROM assessments WHERE is_current = true AND asset_id IS NOT NULL)') },
        },
        attributes: ['id', 'name', 'type', 'classification'],
      }),
      Notification.findAll({
        where: { user_id: userId, read: false },
        include: [{ model: User, as: 'actor', attributes: ['name'] }],
        order: [['created_at', 'DESC']],
        limit: 20,
      }),
    ]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          overdueReminders: overdueRows,
          upcomingReminders: upcomingRows,
          unassessedAssets,
          unreadNotifications: userNotes,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'isms_get_my_overview',
  'Get personalized user dashboard summary (assigned assets, open tasks, unread notifications, pending policy acknowledgments, training statuses).',
  {},
  async (args, { mcpUser }) => {
    const { Asset, Task, Notification, Policy, PolicyAcknowledgment, UserTraining, GroupMember } = getModels();
    const userId = mcpUser?.id || 1;

    const memberOf = await GroupMember.findAll({ where: { user_id: userId } });
    const groupIds = memberOf.map(m => m.group_id);
    const taskOr = [{ assigned_to_id: userId }];
    if (groupIds.length > 0) taskOr.push({ assigned_to_group_id: { [Op.in]: groupIds } });

    const [ownedAssets, myTasks, unreadNotifs, trainings, allPolicies, acks] = await Promise.all([
      Asset.findAll({ where: { owner_id: userId, status: 'active' }, attributes: ['id', 'name', 'type', 'classification'] }),
      Task.findAll({ where: { [Op.or]: taskOr, status: { [Op.notIn]: ['done', 'cancelled'] } }, order: [['due_date', 'ASC']] }),
      Notification.findAll({ where: { user_id: userId, read: false }, limit: 10 }),
      UserTraining.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']] }),
      Policy.findAll({ where: { status: 'active' }, attributes: ['id', 'title', 'version'] }),
      PolicyAcknowledgment.findAll({ where: { user_id: userId } }),
    ]);

    const ackPolicyIds = new Set(acks.map(a => a.policy_id));
    const pendingPolicies = allPolicies.filter(p => !ackPolicyIds.has(p.id));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          user: { id: userId, name: mcpUser?.name, role: mcpUser?.role },
          ownedAssetsCount: ownedAssets.length,
          ownedAssets,
          openTasksCount: myTasks.length,
          openTasks: myTasks,
          unreadNotificationsCount: unreadNotifs.length,
          unreadNotifications: unreadNotifs,
          pendingPolicyAcknowledgmentsCount: pendingPolicies.length,
          pendingPolicies,
          trainings,
        }, null, 2),
      }],
    };
  }
);

// ─── Controls Management ─────────────────────────────────────────────────────

server.tool(
  'isms_create_control',
  'Create a new custom security control in the Statement of Applicability (SoA) register.',
  {
    code: z.string().min(1).describe('Control reference code (e.g. C-01, ISO-5.1)'),
    framework: z.string().default('custom').describe('Framework identifier (iso27001, bsi, nis2, c5, custom)'),
    title: z.string().min(1).describe('Control title'),
    description: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['not_applicable', 'planned', 'in_progress', 'implemented']).default('planned'),
    justification: z.string().optional(),
    owner_id: z.number().int().optional(),
    evidence: z.string().optional(),
    implementation_notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Control } = getModels();
    const item = await Control.create(args);
    await logAudit('create', 'control', item.id, `${item.code}: ${item.title}`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_control',
  'Delete a security control from the Statement of Applicability register.',
  { id: z.number().int().describe('Control ID') },
  async ({ id }, { mcpUser }) => {
    const { Control } = getModels();
    const item = await Control.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };
    await logAudit('delete', 'control', item.id, `${item.code}: ${item.title}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── User, Group & API Token Management ──────────────────────────────────────

// Since v3.10.0 roles reach users only through groups. The user tools take
// group_ids; the former role / custom_role_id parameters are still accepted
// and mean "the group that carries this role" (created on demand).
const ROLE_ENUM = ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee'];
const mcpError = (text) => ({ content: [{ type: 'text', text }], isError: true });
const mcpAccessError = (e) => {
  const { AccessError } = require('../services/accessService');
  if (e instanceof AccessError) return mcpError(e.message);
  throw e;
};
const mcpMayManageRoles = async (mcpUser) => {
  const { decide } = require('../services/permissionService');
  return decide(mcpUser, 'admin', 'roles', ['admin']);
};
const mcpGroupIds = async (args) => {
  const { Group, CustomRole } = getModels();
  const access = require('../services/accessService');
  if (Array.isArray(args.group_ids)) {
    const ids = [...new Set(args.group_ids)];
    const found = ids.length ? await Group.count({ where: { id: ids } }) : 0;
    if (found !== ids.length) throw new access.AccessError('Unknown group in group_ids');
    return ids;
  }
  if (args.custom_role_id) {
    const cr = await CustomRole.findByPk(args.custom_role_id);
    if (!cr) throw new access.AccessError('Custom role not found');
    return [(await access.groupForCustomRole(cr)).id];
  }
  if (args.role) return [(await access.groupForSystemRole(args.role)).id];
  return undefined;
};
const mcpGroupJson = (g) => {
  const j = g.toJSON();
  j.roles = (j.groupRoles || []).map((r) => (r.system_role ? { system_role: r.system_role } : { custom_role_id: r.custom_role_id, name: r.customRole?.name || null }));
  delete j.groupRoles;
  return j;
};
const mcpGroupInclude = () => {
  const { User, GroupRole, CustomRole } = getModels();
  return [
    { model: User, as: 'members', attributes: ['id', 'name', 'email', 'role'], through: { attributes: ['source'] } },
    { model: GroupRole, as: 'groupRoles', attributes: ['system_role', 'custom_role_id'], include: [{ model: CustomRole, as: 'customRole', attributes: ['id', 'name'] }] },
  ];
};

server.tool(
  'isms_create_user',
  'Create a new user account (admin only). Roles come from groups: pass group_ids (or, for compatibility, role / custom_role_id, which add the user to the group carrying that role).',
  {
    name: z.string().min(1).describe('User display name'),
    email: z.string().email().describe('User email address'),
    password: z.string().min(8).describe('Initial password'),
    group_ids: z.array(z.number().int()).optional().describe('Groups the user joins; their roles define the user\'s permissions'),
    role: z.enum(ROLE_ENUM).optional().describe('Deprecated: joins the group carrying this built-in role'),
    department: z.string().optional(),
    custom_role_id: z.number().int().nullable().optional().describe('Deprecated: joins the group carrying this custom role'),
  },
  async (args, { mcpUser }) => {
    const { User, GroupMember } = getModels();
    const access = require('../services/accessService');
    const { validate: validatePassword } = require('../services/passwordPolicy');
    const check = await validatePassword(args.password);
    if (!check.valid) return mcpError(`Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}`);
    try {
      const groupIds = (await mcpGroupIds(args)) || [];
      if (groupIds.length && !(await mcpMayManageRoles(mcpUser))) return mcpError('Assigning groups requires the permission admin.roles');
      const user = await User.create({
        name: args.name,
        email: args.email.toLowerCase().trim(),
        password_hash: await User.hashPassword(args.password),
        role: 'none',
        department: args.department || null,
      });
      for (const gid of groupIds) await GroupMember.findOrCreate({ where: { group_id: gid, user_id: user.id }, defaults: { source: 'manual' } });
      await access.syncUserRoles([user.id]);
      await user.reload();
      await logAudit('create', 'user', user.id, user.name, { role: user.role, group_ids: groupIds, email: user.email, via: 'mcp' }, mcpUser);
      const userJson = user.toJSON();
      delete userJson.password_hash;
      return { content: [{ type: 'text', text: JSON.stringify(userJson, null, 2) }] };
    } catch (e) { return mcpAccessError(e); }
  }
);

server.tool(
  'isms_update_user',
  'Update user details, group memberships, department, or active status (admin only). group_ids replaces the user\'s groups.',
  {
    id: z.number().int().describe('User ID'),
    name: z.string().optional(),
    email: z.string().email().optional(),
    group_ids: z.array(z.number().int()).optional().describe('Replaces the user\'s group memberships'),
    role: z.enum(ROLE_ENUM).optional().describe('Deprecated: sets the memberships to the group carrying this built-in role'),
    department: z.string().optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).optional(),
    custom_role_id: z.number().int().nullable().optional().describe('Deprecated: sets the memberships to the group carrying this custom role'),
  },
  async (args, { mcpUser }) => {
    const { User, GroupMember } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const user = await User.findByPk(args.id);
    if (!user) return mcpError('User not found');
    const { id, password, custom_role_id, role, group_ids, ...updates } = args;
    if (user.id === mcpUser?.id && updates.active === false) return mcpError('Cannot deactivate own account');
    try {
      const groupIds = await mcpGroupIds({ group_ids, custom_role_id, role });
      if (groupIds !== undefined && !(await mcpMayManageRoles(mcpUser))) return mcpError('Assigning groups requires the permission admin.roles');
      if (password) {
        const { validate: validatePassword } = require('../services/passwordPolicy');
        const check = await validatePassword(password);
        if (!check.valid) return mcpError(`Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}`);
        updates.password_hash = await User.hashPassword(password);
        updates.password_changed_at = new Date();
      }
      await sequelize.transaction(async (t) => {
        await user.update(updates, { transaction: t });
        if (groupIds !== undefined) {
          await GroupMember.destroy({ where: { user_id: user.id }, transaction: t });
          for (const gid of groupIds) await GroupMember.create({ group_id: gid, user_id: user.id, source: 'manual' }, { transaction: t });
        }
        if (groupIds !== undefined || updates.active === false) await access.assertAdminRemains(t);
        if (groupIds !== undefined && user.id === mcpUser?.id && !(await access.findUserIdsWithRole('admin', { transaction: t })).includes(user.id)
          && access.hasRole(mcpUser, 'admin')) {
          throw new access.AccessError('Cannot remove the administrator role from your own account');
        }
      });
      if (groupIds !== undefined) await access.syncUserRoles([user.id]);
      await user.reload();
      const logged = { ...updates };
      delete logged.password_hash;
      await logAudit('update', 'user', user.id, user.name, { ...logged, ...(groupIds !== undefined ? { group_ids: groupIds } : {}), via: 'mcp' }, mcpUser);
      const userJson = user.toJSON();
      delete userJson.password_hash;
      return { content: [{ type: 'text', text: JSON.stringify(userJson, null, 2) }] };
    } catch (e) { return mcpAccessError(e); }
  }
);

server.tool(
  'isms_delete_user',
  'Deactivate a user account (admin only). Accounts are deactivated, not removed, so their history stays attributable — the same as the web UI.',
  { id: z.number().int().describe('User ID') },
  async ({ id }, { mcpUser }) => {
    const { User } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const user = await User.findByPk(id);
    if (!user) return mcpError('User not found');
    if (user.id === mcpUser?.id) return mcpError('Cannot delete own account');
    try {
      await sequelize.transaction(async (t) => {
        await user.update({ active: false }, { transaction: t });
        await access.assertAdminRemains(t);
      });
    } catch (e) { return mcpAccessError(e); }
    await logAudit('deactivate', 'user', user.id, user.name, { via: 'mcp' }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deactivatedId: id }) }] };
  }
);

server.tool(
  'isms_get_group',
  'Get details of a group / team including its members and the roles it carries.',
  { id: z.number().int().describe('Group ID') },
  async ({ id }) => {
    const { Group } = getModels();
    const group = await Group.findByPk(id, { include: mcpGroupInclude() });
    if (!group) return mcpError('Group not found');
    return { content: [{ type: 'text', text: JSON.stringify(mcpGroupJson(group), null, 2) }] };
  }
);

const ROLE_REFS = z.array(z.object({
  system_role: z.enum(ROLE_ENUM).optional(),
  custom_role_id: z.number().int().optional(),
})).describe('Roles the group carries: [{ system_role }] or [{ custom_role_id }]. Members receive all of them.');

const mcpSetGroupRoles = async (groupId, roles, transaction) => {
  const { GroupRole, CustomRole } = getModels();
  const access = require('../services/accessService');
  await GroupRole.destroy({ where: { group_id: groupId }, transaction });
  const seen = new Set();
  for (const r of roles) {
    if (r.system_role && !r.custom_role_id) {
      if (seen.has(`s:${r.system_role}`)) continue;
      seen.add(`s:${r.system_role}`);
      await GroupRole.create({ group_id: groupId, system_role: r.system_role }, { transaction });
    } else if (r.custom_role_id && !r.system_role) {
      if (!(await CustomRole.findByPk(r.custom_role_id, { transaction }))) throw new access.AccessError(`Custom role ${r.custom_role_id} not found`);
      if (seen.has(`c:${r.custom_role_id}`)) continue;
      seen.add(`c:${r.custom_role_id}`);
      await GroupRole.create({ group_id: groupId, custom_role_id: r.custom_role_id }, { transaction });
    } else {
      throw new access.AccessError('Each role needs exactly one of system_role or custom_role_id');
    }
  }
};

server.tool(
  'isms_create_group',
  'Create a group (admin only). Groups are teams for task assignment and the only way roles reach users: pass roles to make the group grant permissions.',
  {
    name: z.string().min(1).describe('Group name'),
    description: z.string().optional(),
    color: z.string().default('#3b82f6').describe('Hex color code'),
    roles: ROLE_REFS.optional(),
  },
  async (args, { mcpUser }) => {
    const { Group } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const { roles, ...fields } = args;
    if (roles?.length && !(await mcpMayManageRoles(mcpUser))) return mcpError('Assigning roles requires the permission admin.roles');
    try {
      const userId = await getValidUserId(mcpUser);
      const item = await sequelize.transaction(async (t) => {
        const g = await Group.create({ ...fields, created_by_id: userId }, { transaction: t });
        if (roles?.length) await mcpSetGroupRoles(g.id, roles, t);
        return g;
      });
      access.invalidateAccessCache();
      await logAudit('create', 'group', item.id, item.name, { ...fields, roles: roles || [], via: 'mcp' }, mcpUser);
      const full = await Group.findByPk(item.id, { include: mcpGroupInclude() });
      return { content: [{ type: 'text', text: JSON.stringify(mcpGroupJson(full), null, 2) }] };
    } catch (e) { return mcpAccessError(e); }
  }
);

server.tool(
  'isms_update_group',
  'Update group name, description, color, or the roles it carries (admin only). roles replaces the group\'s roles.',
  {
    id: z.number().int().describe('Group ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    roles: ROLE_REFS.optional(),
  },
  async (args, { mcpUser }) => {
    const { Group, GroupMember } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const item = await Group.findByPk(args.id);
    if (!item) return mcpError('Group not found');
    const { id, roles, ...updates } = args;
    if (roles !== undefined && !(await mcpMayManageRoles(mcpUser))) return mcpError('Assigning roles requires the permission admin.roles');
    try {
      await sequelize.transaction(async (t) => {
        await item.update(updates, { transaction: t });
        if (roles !== undefined) {
          await mcpSetGroupRoles(item.id, roles, t);
          await access.assertAdminRemains(t);
        }
      });
      if (roles !== undefined) {
        const members = await GroupMember.findAll({ where: { group_id: item.id }, attributes: ['user_id'] });
        await access.syncUserRoles(members.map((m) => m.user_id));
      }
      await logAudit('update', 'group', item.id, item.name, { ...updates, ...(roles !== undefined ? { roles } : {}), via: 'mcp' }, mcpUser);
      const full = await Group.findByPk(item.id, { include: mcpGroupInclude() });
      return { content: [{ type: 'text', text: JSON.stringify(mcpGroupJson(full), null, 2) }] };
    } catch (e) { return mcpAccessError(e); }
  }
);

server.tool(
  'isms_delete_group',
  'Delete a group (admin only). Its members lose the roles the group carried.',
  { id: z.number().int().describe('Group ID') },
  async ({ id }, { mcpUser }) => {
    const { Group, GroupMember, GroupRole } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const item = await Group.findByPk(id);
    if (!item) return mcpError('Group not found');
    if ((await GroupRole.count({ where: { group_id: id } })) && !(await mcpMayManageRoles(mcpUser))) {
      return mcpError('Deleting a group that carries roles requires the permission admin.roles');
    }
    const members = await GroupMember.findAll({ where: { group_id: id }, attributes: ['user_id'] });
    try {
      await sequelize.transaction(async (t) => {
        await GroupRole.destroy({ where: { group_id: id }, transaction: t });
        await GroupMember.destroy({ where: { group_id: id }, transaction: t });
        await item.destroy({ transaction: t });
        await access.assertAdminRemains(t);
      });
    } catch (e) { return mcpAccessError(e); }
    await access.syncUserRoles(members.map((m) => m.user_id));
    await logAudit('delete', 'group', item.id, item.name, { via: 'mcp' }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_add_group_member',
  'Add a user as member to a group (admin only). The user receives the roles the group carries.',
  {
    group_id: z.number().int().describe('Group ID'),
    user_id: z.number().int().describe('User ID to add'),
  },
  async ({ group_id, user_id }, { mcpUser }) => {
    const { Group, User, GroupMember, GroupRole } = getModels();
    const access = require('../services/accessService');
    const group = await Group.findByPk(group_id);
    if (!group) return mcpError('Group not found');
    const user = await User.findByPk(user_id);
    if (!user) return mcpError('User not found');
    if ((await GroupRole.count({ where: { group_id } })) && !(await mcpMayManageRoles(mcpUser))) {
      return mcpError('This group carries roles; changing its members requires the permission admin.roles');
    }
    const [, created] = await GroupMember.findOrCreate({ where: { group_id, user_id }, defaults: { source: 'manual' } });
    if (!created) return mcpError('User is already a member of this group');
    await access.syncUserRoles([user_id]);
    await logAudit('update', 'group', group.id, group.name, { action: 'add_member', user_name: user.name, via: 'mcp' }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, group_id, user_id }) }] };
  }
);

server.tool(
  'isms_remove_group_member',
  'Remove a user from a group (admin only). The user loses the roles the group carried.',
  {
    group_id: z.number().int().describe('Group ID'),
    user_id: z.number().int().describe('User ID to remove'),
  },
  async ({ group_id, user_id }, { mcpUser }) => {
    const { Group, GroupMember, GroupRole } = getModels();
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const group = await Group.findByPk(group_id);
    if (!group) return mcpError('Group not found');
    if ((await GroupRole.count({ where: { group_id } })) && !(await mcpMayManageRoles(mcpUser))) {
      return mcpError('This group carries roles; changing its members requires the permission admin.roles');
    }
    let deleted = 0;
    try {
      deleted = await sequelize.transaction(async (t) => {
        const n = await GroupMember.destroy({ where: { group_id, user_id }, transaction: t });
        if (n) await access.assertAdminRemains(t);
        return n;
      });
    } catch (e) { return mcpAccessError(e); }
    if (!deleted) return mcpError('User is not a member of this group');
    await access.syncUserRoles([user_id]);
    await logAudit('update', 'group', group.id, group.name, { action: 'remove_member', user_id, via: 'mcp' }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, group_id, user_id }) }] };
  }
);

server.tool(
  'isms_list_api_tokens',
  'List active API tokens for the authenticated user.',
  {},
  async (args, { mcpUser }) => {
    const { ApiToken } = getModels();
    const userId = mcpUser?.id || 1;
    const tokens = await ApiToken.findAll({
      where: { user_id: userId },
      attributes: ['id', 'user_id', 'name', 'token_prefix', 'expires_at', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tokens, null, 2) }] };
  }
);

server.tool(
  'isms_create_api_token',
  'Generate a new API token for the authenticated user (returns plaintext token string once).',
  {
    name: z.string().min(1).describe('Token description / name (e.g. CI/CD Pipeline, MCP Assistant)'),
    expires_at: z.string().optional().describe('Expiration ISO date (YYYY-MM-DD)'),
  },
  async ({ name, expires_at }, { mcpUser }) => {
    const { ApiToken } = getModels();
    const crypto = require('crypto');
    const userId = await getValidUserId(mcpUser);
    const tokenStr = 'isms_api_' + crypto.randomBytes(32).toString('hex');
    const newToken = await ApiToken.create({
      user_id: userId,
      name: name.trim(),
      token: null,
      token_hash: hashToken(tokenStr),
      token_prefix: tokenStr.slice(0, 17),
      expires_at: expires_at ? new Date(expires_at) : null,
    });
    await logAudit('create', 'api_token', newToken.id, newToken.name, { expires_at }, mcpUser);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: newToken.id,
          name: newToken.name,
          token_prefix: newToken.token_prefix,
          token: tokenStr,
          expires_at: newToken.expires_at,
          warning: 'Please save this token now. It cannot be retrieved again.',
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'isms_revoke_api_token',
  'Revoke / delete an API token.',
  { id: z.number().int().describe('API Token ID') },
  async ({ id }, { mcpUser }) => {
    const { ApiToken } = getModels();
    const userId = mcpUser?.id;
    const where = { id };
    if (!require('../services/accessService').hasRole(mcpUser, 'admin') && userId) where.user_id = userId;
    const token = await ApiToken.findOne({ where });
    if (!token) return { content: [{ type: 'text', text: 'API token not found' }], isError: true };
    await logAudit('delete', 'api_token', token.id, token.name, {}, mcpUser);
    await token.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Vendor Management & Triage ──────────────────────────────────────────────

server.tool(
  'isms_get_vendor',
  'Get full details of a single vendor / third-party processor including contacts, linked incidents, and VVT entries.',
  { id: z.number().int().describe('Vendor ID') },
  async ({ id }) => {
    const { Vendor, VendorContact, User, Incident, VvtEntry } = getModels();
    const item = await Vendor.findByPk(id, {
      include: [
        { model: VendorContact, as: 'contacts' },
        { model: User, as: 'assessedBy', attributes: ['id', 'name'] },
        { model: Incident, as: 'incidents', through: { attributes: [] } },
        { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vendor',
  'Update vendor information (name, type, website, phone, address, notes).',
  {
    id: z.number().int().describe('Vendor ID'),
    name: z.string().optional(),
    type: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor } = getModels();
    const item = await Vendor.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'vendor', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vendor',
  'Delete a vendor from the register.',
  { id: z.number().int().describe('Vendor ID') },
  async ({ id }, { mcpUser }) => {
    const { Vendor } = getModels();
    const item = await Vendor.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    await logAudit('delete', 'vendor', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_add_vendor_contact',
  'Add a contact person to a vendor.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    name: z.string().min(1).describe('Contact person name'),
    email: z.string().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(args.vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.create(args);
    await logAudit('create', 'vendor', vendor.id, vendor.name, { action: 'add_contact', contact_name: contact.name }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }] };
  }
);

server.tool(
  'isms_update_vendor_contact',
  'Update a vendor contact person.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    contact_id: z.number().int().describe('Contact ID'),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(args.vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.findOne({ where: { id: args.contact_id, vendor_id: args.vendor_id } });
    if (!contact) return { content: [{ type: 'text', text: 'Contact not found' }], isError: true };
    const { vendor_id, contact_id, ...updates } = args;
    await contact.update(updates);
    await logAudit('update', 'vendor', vendor.id, vendor.name, { action: 'update_contact', contact_name: contact.name }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vendor_contact',
  'Delete a vendor contact person.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    contact_id: z.number().int().describe('Contact ID'),
  },
  async ({ vendor_id, contact_id }, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.findOne({ where: { id: contact_id, vendor_id } });
    if (!contact) return { content: [{ type: 'text', text: 'Contact not found' }], isError: true };
    const contactName = contact.name;
    await contact.destroy();
    await logAudit('delete', 'vendor', vendor.id, vendor.name, { action: 'delete_contact', contact_name: contactName }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedContactId: contact_id }) }] };
  }
);

server.tool(
  'isms_list_vendor_triage_runs',
  'List AI contract analysis triage runs for a vendor.',
  { vendor_id: z.number().int().describe('Vendor ID') },
  async ({ vendor_id }) => {
    const { VendorTriageRun, Document, User } = getModels();
    const runs = await VendorTriageRun.findAll({
      where: { vendor_id },
      include: [
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
  }
);

server.tool(
  'isms_get_vendor_triage_run',
  'Get full analysis findings and summary of a specific vendor contract triage run.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    run_id: z.number().int().describe('Triage run ID'),
  },
  async ({ vendor_id, run_id }) => {
    const { VendorTriageRun, VendorFinding, Document, User } = getModels();
    const run = await VendorTriageRun.findOne({
      where: { id: run_id, vendor_id },
      include: [
        { model: VendorFinding, as: 'findings' },
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      order: [[{ model: VendorFinding, as: 'findings' }, 'id', 'ASC']],
    });
    if (!run) return { content: [{ type: 'text', text: 'Triage run not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
  }
);

server.tool(
  'isms_run_vendor_triage',
  'Start an AI contract analysis for a document already attached to a vendor. Runs asynchronously: '
  + 'this returns the created run immediately with status "pending" — poll isms_get_vendor_triage_run for findings. '
  + 'Consumes LLM budget, so it is gated on vendor_triage.run rather than on read access to the results.',
  {
    vendor_id: z.number().int().positive().describe('Vendor ID'),
    document_id: z.number().int().positive().describe('ID of a document attached to THIS vendor'),
    doc_type: z.string().optional().describe('Analysis profile key (see isms_get_triage_profiles); unknown values fall back to "other"'),
  },
  async ({ vendor_id, document_id, doc_type }, { mcpUser }) => {
    const { VendorTriageRun, Vendor, Document } = getModels();

    const vendor = await Vendor.findByPk(vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };

    // Scoped to the vendor on purpose: without the vendor_id in the lookup this
    // would analyse any document in the installation by id.
    const doc = await Document.findOne({ where: { id: document_id, vendor_id } });
    if (!doc) return { content: [{ type: 'text', text: 'Document not found for this vendor' }], isError: true };

    const { getProfiles } = require('../services/triageProfiles');
    const profiles = await getProfiles();
    const resolvedDocType = typeof doc_type === 'string' && Object.hasOwn(profiles, doc_type) ? doc_type : 'other';

    const run = await VendorTriageRun.create({
      vendor_id,
      document_id: doc.id,
      doc_type: resolvedDocType,
      status: 'pending',
      triggered_by_id: await getValidUserId(mcpUser),
    });

    await logAudit('create', 'vendor', vendor_id, vendor.name, {
      action: 'triage_started', run_id: run.id, document: doc.original_name, via: 'mcp',
    }, mcpUser);

    // Same as the REST route: do not await, the analysis takes minutes.
    const { runTriage } = require('../services/vendorTriageService');
    runTriage(run.id).catch(err => console.error(`[Triage] MCP run ${run.id} failed:`, err.message));

    return { content: [{ type: 'text', text: JSON.stringify({
      run_id: run.id, vendor: vendor.name, document: doc.original_name,
      doc_type: resolvedDocType, status: 'pending',
      hint: 'Ergebnisse mit isms_get_vendor_triage_run abrufen, sobald der Status auf "done" steht.',
    }, null, 2) }] };
  }
);

server.tool(
  'isms_get_triage_profiles',
  'Get vendor contract analysis triage criteria profiles and reference baselines.',
  {},
  async () => {
    const { getProfiles } = require('../services/triageProfiles');
    const profiles = await getProfiles();
    return { content: [{ type: 'text', text: JSON.stringify(profiles, null, 2) }] };
  }
);

server.tool(
  'isms_update_triage_profiles',
  'Update vendor contract analysis triage criteria profiles (admin only).',
  { profiles: z.record(z.any()).describe('Custom profile overrides dictionary') },
  async ({ profiles }, { mcpUser }) => {
    const { saveProfiles } = require('../services/triageProfiles');
    const saved = await saveProfiles(profiles || {});
    await logAudit('update', 'settings', null, 'Vertragsanalyse-Profile', { profiles: Object.keys(saved) }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
  }
);

// ─── BCM & DORA Enhancements ─────────────────────────────────────────────────

server.tool(
  'isms_create_bcm_process',
  'Register a critical business process in the BIA (Business Impact Analysis) register.',
  {
    name: z.string().min(1).describe('Process name'),
    description: z.string().optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    rto_hours: z.number().optional().describe('Recovery Time Objective in hours'),
    rpo_hours: z.number().optional().describe('Recovery Point Objective in hours'),
    owner_id: z.number().int().optional(),
    dependencies: z.string().optional(),
    recovery_strategy: z.string().optional(),
    status: z.enum(['active', 'in_review', 'archived']).default('active'),
    last_test_date: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.create(args);
    await logAudit('create', 'bcm_process', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_bcm_process',
  'Update details, RTO, RPO, or recovery strategy of a BCM process.',
  {
    id: z.number().int().describe('BCM process ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    rto_hours: z.number().optional(),
    rpo_hours: z.number().optional(),
    owner_id: z.number().int().nullable().optional(),
    dependencies: z.string().optional(),
    recovery_strategy: z.string().optional(),
    status: z.enum(['active', 'in_review', 'archived']).optional(),
    last_test_date: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'BCM process not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'bcm_process', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_bcm_process',
  'Delete a BCM business process from the BIA register.',
  { id: z.number().int().describe('BCM process ID') },
  async ({ id }, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'BCM process not found' }], isError: true };
    await logAudit('delete', 'bcm_process', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_update_bcm_exercise',
  'Update a BCM test, exercise, or drill record.',
  {
    id: z.number().int().describe('BCM exercise ID'),
    process_id: z.number().int().nullable().optional(),
    title: z.string().optional(),
    exercise_type: z.enum(['tabletop', 'simulation', 'parallel', 'full_interruption']).optional(),
    exercise_date: z.string().optional(),
    participants: z.string().optional(),
    result: z.enum(['passed', 'partially_passed', 'failed']).optional(),
    findings: z.string().optional(),
    actions: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const item = await BcmExercise.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'BCM exercise not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'bcm_exercise', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_bcm_exercise',
  'Delete a BCM exercise record.',
  { id: z.number().int().describe('BCM exercise ID') },
  async ({ id }, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const item = await BcmExercise.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'BCM exercise not found' }], isError: true };
    await logAudit('delete', 'bcm_exercise', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_dora_third_party',
  'Register an ICT third-party service provider under DORA (EU 2022/2554) regulations.',
  {
    name: z.string().min(1).describe('Service provider name'),
    ict_service: z.string().min(1).describe('ICT service type (e.g. Cloud Hosting, Core Banking SaaS)'),
    criticality: z.enum(['critical', 'important', 'standard']).default('important'),
    contract_start: z.string().optional(),
    contract_end: z.string().optional(),
    country: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    sla_rto_hours: z.number().optional(),
    sla_rpo_hours: z.number().optional(),
    last_review_date: z.string().optional(),
    next_review_date: z.string().optional(),
    status: z.enum(['active', 'in_onboarding', 'terminated']).default('active'),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.create(args);
    await logAudit('create', 'dora_third_party', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dora_third_party',
  'Update a DORA ICT third-party provider record.',
  {
    id: z.number().int().describe('DORA provider ID'),
    name: z.string().optional(),
    ict_service: z.string().optional(),
    criticality: z.enum(['critical', 'important', 'standard']).optional(),
    contract_start: z.string().optional(),
    contract_end: z.string().optional(),
    country: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    sla_rto_hours: z.number().optional(),
    sla_rpo_hours: z.number().optional(),
    last_review_date: z.string().optional(),
    next_review_date: z.string().optional(),
    status: z.enum(['active', 'in_onboarding', 'terminated']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DORA third-party not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dora_third_party', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dora_third_party',
  'Delete a DORA ICT third-party provider record.',
  { id: z.number().int().describe('DORA provider ID') },
  async ({ id }, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DORA third-party not found' }], isError: true };
    await logAudit('delete', 'dora_third_party', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_dora_test',
  'Register a DORA digital operational resilience test (Art. 24-26, e.g. vulnerability scan, TLPT, penetration test).',
  {
    title: z.string().min(1).describe('Test title'),
    test_type: z.enum(['vulnerability_scan', 'pentest', 'tlpt_threat_led', 'gap_analysis', 'scenario_test', 'source_code_review']).default('pentest'),
    test_date: z.string().min(1).describe('Date of test (YYYY-MM-DD)'),
    performed_by: z.string().optional().describe('Internal auditor or external security testing company'),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).default('planned'),
    result: z.enum(['passed', 'passed_with_findings', 'failed']).optional(),
    findings: z.string().optional(),
    remediation: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.create(args);
    await logAudit('create', 'dora_test', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dora_test',
  'Update details, results, or remediation of a DORA resilience test.',
  {
    id: z.number().int().describe('DORA test ID'),
    title: z.string().optional(),
    test_type: z.enum(['vulnerability_scan', 'pentest', 'tlpt_threat_led', 'gap_analysis', 'scenario_test', 'source_code_review']).optional(),
    test_date: z.string().optional(),
    performed_by: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    result: z.enum(['passed', 'passed_with_findings', 'failed']).optional(),
    findings: z.string().optional(),
    remediation: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DORA test not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dora_test', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dora_test',
  'Delete a DORA resilience test record.',
  { id: z.number().int().describe('DORA test ID') },
  async ({ id }, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DORA test not found' }], isError: true };
    await logAudit('delete', 'dora_test', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Pentests (Update & Delete) ──────────────────────────────────────────────

server.tool(
  'isms_update_pentest',
  'Update an existing pentest project.',
  {
    id: z.number().int().describe('Pentest project ID'),
    title: z.string().optional(),
    scope: z.string().optional(),
    vendor: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'completed', 'retesting', 'closed']).optional(),
    report_url: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { PentestProject } = getModels();
    const item = await PentestProject.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Pentest project not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'pentest_project', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_pentest',
  'Delete a pentest project and all of its associated findings.',
  { id: z.number().int().describe('Pentest project ID') },
  async ({ id }, { mcpUser }) => {
    const { PentestProject, PentestFinding } = getModels();
    const item = await PentestProject.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Pentest project not found' }], isError: true };
    await logAudit('delete', 'pentest_project', item.id, item.title, {}, mcpUser);
    await PentestFinding.destroy({ where: { project_id: id } });
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_pentest_finding',
  'Delete a finding from a pentest project.',
  {
    project_id: z.number().int().describe('Pentest project ID'),
    id: z.number().int().describe('Finding ID'),
  },
  async ({ project_id, id }, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const item = await PentestFinding.findOne({ where: { id, project_id } });
    if (!item) return { content: [{ type: 'text', text: 'Pentest finding not found' }], isError: true };
    await logAudit('delete', 'pentest_finding', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Policies & Templates (Delete) ───────────────────────────────────────────

server.tool(
  'isms_delete_policy',
  'Delete a security policy from the repository.',
  { id: z.number().int().describe('Policy ID') },
  async ({ id }, { mcpUser }) => {
    const { Policy } = getModels();
    const item = await Policy.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };
    await logAudit('delete', 'policy', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_policy_acknowledgments',
  'List employee acknowledgments / signatures for a specific security policy.',
  { id: z.number().int().describe('Policy ID') },
  async ({ id }) => {
    const { PolicyAcknowledgment, User } = getModels();
    const acks = await PolicyAcknowledgment.findAll({
      where: { policy_id: id },
      include: [{ model: User, attributes: ['id', 'name', 'email', 'department'] }],
      order: [['acknowledged_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(acks, null, 2) }] };
  }
);

server.tool(
  'isms_list_templates',
  'List policy and ISMS document templates available in the template library.',
  {},
  async () => {
    const { Template } = getModels();
    const items = await Template.findAll({ order: [['name', 'ASC']] });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_delete_template',
  'Delete a document template from the library.',
  { id: z.number().int().describe('Template ID') },
  async ({ id }, { mcpUser }) => {
    const { Template } = getModels();
    const item = await Template.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Template not found' }], isError: true };
    await logAudit('delete', 'template', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Audits, Findings & KPIs (Delete & Create) ───────────────────────────────

server.tool(
  'isms_delete_audit',
  'Delete a compliance audit.',
  { id: z.number().int().describe('Audit ID') },
  async ({ id }, { mcpUser }) => {
    const { Audit } = getModels();
    const item = await Audit.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };
    await logAudit('delete', 'audit', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_audit_finding',
  'Delete an audit finding / deviation.',
  { id: z.number().int().describe('Audit finding ID') },
  async ({ id }, { mcpUser }) => {
    const { AuditFinding } = getModels();
    const item = await AuditFinding.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Audit finding not found' }], isError: true };
    await logAudit('delete', 'audit_finding', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_kpi',
  'Create a new security or compliance KPI metric to track.',
  {
    title: z.string().min(1).describe('KPI title'),
    description: z.string().optional(),
    target: z.number().describe('Target metric value'),
    current_value: z.number().default(0),
    status: z.enum(['green', 'yellow', 'red']).default('green'),
    owner_id: z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.create(args);
    await logAudit('create', 'kpi', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_kpi',
  'Update an existing security KPI (target, current value, status, owner).',
  {
    id: z.number().int().describe('KPI ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    target: z.number().optional(),
    current_value: z.number().optional(),
    status: z.enum(['green', 'yellow', 'red']).optional(),
    owner_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'kpi', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_kpi',
  'Delete a security KPI metric.',
  { id: z.number().int().describe('KPI ID') },
  async ({ id }, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };
    await logAudit('delete', 'kpi', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Auto-Discovery Software Deletion ────────────────────────────────────────

server.tool(
  'isms_delete_discovered_software',
  'Delete a staged discovered host or software item from the discovery inbox.',
  { id: z.number().int().describe('Discovery item ID') },
  async ({ id }, { mcpUser }) => {
    const { DiscoveredSoftware } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Discovered software item not found' }], isError: true };
    await logAudit('delete', 'discovered_software', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);



// ─── Compliance Catalogs (ISO 27001, BSI, NIS-2, C5, TISAX) ────────────────

server.tool(
  'isms_list_iso27001_controls',
  'List all ISO 27001 Annex A controls including applicability, implementation status, owner, evidence, and notes.',
  {
    search: z.string().optional().describe('Search in control reference or title'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all').describe('Filter by implementation status'),
    applicable: z.boolean().optional().describe('Filter by applicability'),
    limit: z.number().int().min(1).max(500).default(100).describe('Max results'),
  },
  async ({ search, status, applicable, limit }) => {
    const { Iso27001Control, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (applicable !== undefined) where.applicable = applicable;
    if (search) {
      where[Op.or] = [
        { ref: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await Iso27001Control.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['ref', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_iso27001_control',
  'Update details, applicability, justification, or implementation status of an ISO 27001 Annex A control.',
  {
    id: z.number().int().describe('ISO 27001 control record ID'),
    applicable: z.boolean().optional().describe('Whether the control is applicable'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    justification: z.string().optional().describe('Justification for inclusion or exclusion'),
    owner_id: z.number().int().nullable().optional().describe('User ID of the control owner'),
    evidence: z.string().optional().describe('Audit evidence / documentation description'),
    notes: z.string().optional(),
    last_review_date: z.string().optional().describe('ISO date (YYYY-MM-DD) of last review'),
  },
  async (args, { mcpUser }) => {
    const { Iso27001Control, Control } = getModels();
    const item = await Iso27001Control.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'ISO 27001 control not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    const ISO_TO_SOA = { implemented: 'implemented', not_applicable: 'not_applicable', not_started: 'planned', in_progress: 'planned' };
    if (updates.implementation_status && ISO_TO_SOA[updates.implementation_status]) {
      Control.update(
        { status: ISO_TO_SOA[updates.implementation_status] },
        { where: { framework: 'iso27001', code: item.ref } }
      ).catch(() => {});
    }
    await logAudit('update', 'iso27001_control', item.id, item.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_bsi_requirements',
  'List BSI IT-Grundschutz requirements and Bausteine with implementation status.',
  {
    search: z.string().optional().describe('Search in req_id, baustein_id, or title'),
    layer: z.enum([...BSI_LAYERS, ...Object.keys(BSI_LAYER_ALIASES)]).optional()
      .describe(`Filter by Kompendium layer: ${BSI_LAYERS.join(', ')}. "ORG" is accepted as an alias for ORP.`),
    status: z.enum([...BSI_STATUSES, ...Object.keys(BSI_STATUS_ALIASES), 'all']).default('all')
      .describe(`Implementation status: ${BSI_STATUSES.join(', ')} or all. Check values ja/teilweise/nein/entbehrlich/offen are mapped to implemented/in_progress/not_implemented/not_applicable/not_started.`),
    limit: z.number().int().min(1).max(500).default(100).describe('Max results'),
  },
  async ({ search, layer, status, limit }) => {
    const { BsiRequirement, User } = getModels();
    // Nur Anforderungen des aktiven Katalogs (abgeloeste bleiben in der DB, siehe BsiRequirement.retired)
    // und nur der Umsetzungsstand des Standard-Informationsverbunds (weitere Verbuende: isms_list_bsi_domains ff.).
    const where = { ...(await bsiDomains.baselineWhere()), retired: false };
    if (status && status !== 'all') where.implementation_status = normalizeBsiStatus(status);
    if (layer) where.layer = normalizeBsiLayer(layer);
    if (search) {
      where[Op.or] = [
        { req_id: { [Op.iLike]: `%${search}%` } },
        { baustein_id: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await BsiRequirement.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['layer', 'ASC'], ['baustein_id', 'ASC'], ['req_id', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_bsi_requirement',
  'Update implementation status, justification, responsible person, notes or review date of a BSI IT-Grundschutz requirement in the default information domain (the list returned by isms_list_bsi_requirements). For target objects and other domains use isms_set_bsi_check_status. A justification is required for not_implemented (nein) and not_applicable (entbehrlich).',
  {
    id: z.number().int().describe('BSI requirement ID'),
    implementation_status: z.enum([...BSI_STATUSES, ...Object.keys(BSI_STATUS_ALIASES)]).optional()
      .describe(`${BSI_STATUSES.join(', ')}. Check values ja/teilweise/nein/entbehrlich/offen are mapped to implemented/in_progress/not_implemented/not_applicable/not_started.`),
    justification: z.string().max(10000).nullable().optional().describe('Required when the status is not_implemented or not_applicable'),
    responsible_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BsiRequirement } = getModels();
    // Wie PUT /api/bsi-grundschutz/:id: nur der Verbund-Stand des Standard-Verbunds.
    const item = await BsiRequirement.findOne({ where: { id: args.id, ...(await bsiDomains.baselineWhere()) } });
    if (!item) return { content: [{ type: 'text', text: 'BSI requirement not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.implementation_status !== undefined) {
      updates.implementation_status = normalizeBsiStatus(updates.implementation_status);
    }
    let values;
    try {
      values = bsiCheck.validateEntryInput(updates, item);
      await bsiCheck.checkReferences(values);
    } catch (e) {
      if (e instanceof bsiCheck.CheckError) return { content: [{ type: 'text', text: e.message }], isError: true };
      throw e;
    }
    const { before, changes } = await bsiCheck.applyEntryValues(item, values);
    if (Object.keys(changes).length) await logAudit('update', 'bsi_requirement', item.id, item.req_id, { before, after: changes }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

// ─── BSI IT-Grundschutz: Informationsverbund und Modellierung ────────────────
// Fehler des Dienstes (fehlender Verbund, fremdes Zielobjekt, nicht sichtbares
// Asset, doppelte Zuordnung) kommen als isError zurueck, wie die REST-Antwort.
const bsiDomainResult = async (fn) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    if (e instanceof bsiDomains.DomainError || e instanceof bsiCheck.CheckError) return { content: [{ type: 'text', text: e.message }], isError: true };
    throw e;
  }
};

server.tool(
  'isms_list_bsi_domains',
  'List BSI IT-Grundschutz information domains (Informationsverbuende) with protection approach (basis/standard/kern), assigned catalogue and counts of target objects and modelled modules.',
  {},
  async () => bsiDomainResult(() => bsiDomains.listDomains())
);

server.tool(
  'isms_get_bsi_domain',
  'Get one BSI information domain with its target objects (assets with Grundschutz target type) and its modelling (modules/practices assigned to target objects or to the whole domain). Only target objects whose asset the caller may see are returned.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID (see isms_list_bsi_domains)'),
  },
  async ({ domain_id }, { mcpUser }) => bsiDomainResult(async () => ({
    ...(await bsiDomains.getDomain(domain_id)),
    target_objects: await bsiDomains.listTargetObjects(domain_id, mcpUser),
    modeling: await bsiDomains.listModeling(domain_id, mcpUser),
  }))
);

server.tool(
  'isms_suggest_bsi_modeling',
  'Suggest modules (Kompendium Bausteine) or practices (Grundschutz++) for a target object, or for the whole domain when target_object_id is omitted (process layers ISMS/ORP/CON/OPS/DER). Suggestions are not applied automatically; use isms_model_bsi_module to apply one.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID'),
    target_object_id: z.number().int().positive().optional().describe('Target object ID; omit for the whole domain'),
  },
  async ({ domain_id, target_object_id }, { mcpUser }) => bsiDomainResult(() => bsiDomains.suggestModeling(domain_id, target_object_id, mcpUser))
);

server.tool(
  'isms_assign_bsi_target_object',
  'Assign an asset from the asset register to a BSI information domain as target object. target_type is suggested from the asset type when omitted (hardware->it_system, software/application/service->application, process->business_process); information/data/personnel assets need an explicit target_type.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID'),
    asset_id: z.number().int().positive().describe('Asset ID from the asset register'),
    target_type: z.enum(bsiDomains.TARGET_TYPES).optional().describe(`Grundschutz target object type: ${bsiDomains.TARGET_TYPES.join(', ')}`),
    notes: z.string().max(10000).optional(),
  },
  async ({ domain_id, asset_id, target_type, notes }, { mcpUser }) => bsiDomainResult(async () => {
    const { domain, targetObject, asset } = await bsiDomains.addTargetObject(domain_id, { asset_id, target_type, notes }, mcpUser);
    await logAudit('create', 'bsi_target_object', targetObject.id, asset.name, {
      domain_id: domain.id, asset_id: asset.id, target_type: targetObject.target_type,
    }, mcpUser);
    return targetObject;
  })
);

server.tool(
  'isms_model_bsi_module',
  'Model a module (Kompendium Baustein) or practice (Grundschutz++) of the domain\'s active catalogue on a target object, or on the whole domain when target_object_id is omitted. System-layer Bausteine (APP, SYS, IND, NET, INF) require a target object of the same domain.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID'),
    module_id: z.string().min(1).max(40).describe('Module ID from the catalogue, e.g. SYS.1.1 or GC.1'),
    target_object_id: z.number().int().positive().optional().describe('Target object ID; omit for the whole domain'),
    notes: z.string().max(10000).optional(),
  },
  async ({ domain_id, module_id, target_object_id, notes }, { mcpUser }) => bsiDomainResult(async () => {
    const { domain, modeling, module: mod, target } = await bsiDomains.addModeling(domain_id, { module_id, target_object_id, notes }, mcpUser);
    await logAudit('create', 'bsi_modeling', modeling.id, mod.module_id, {
      domain_id: domain.id, target_object_id: modeling.target_object_id, asset_id: target?.asset?.id ?? null,
      module_id: mod.module_id, catalog_id: modeling.catalog_id,
    }, mcpUser);
    return modeling;
  })
);

server.tool(
  'isms_get_bsi_check',
  'Read the IT-Grundschutz-Check of an information domain: every requirement of the modelled modules that the domain\'s protection approach makes relevant (basis: B; standard: B+S; kern: B+S+H), per target object or for the whole domain, with status (ja/teilweise/nein/entbehrlich/offen), justification, responsible user/group, due date, costs, evidence documents and linked controls. Optionally with fulfilment and cost summary per module and target object.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID'),
    target_object_id: z.union([z.number().int().positive(), z.literal('domain')]).optional().describe('Only this target object, or "domain" for domain-wide requirements only'),
    status: z.enum([...BSI_STATUSES, ...Object.keys(BSI_STATUS_ALIASES)]).optional().describe('Only entries with this status'),
    include_summary: z.boolean().default(true).describe('Include fulfilment and cost summary'),
    limit: z.number().int().min(1).max(2000).default(500).describe('Max entries returned'),
  },
  async ({ domain_id, target_object_id, status, include_summary, limit }, { mcpUser }) => bsiDomainResult(async () => {
    const c = await bsiCheck.getCheck(domain_id, mcpUser, { targetObjectId: target_object_id });
    const wanted = status ? normalizeBsiStatus(status) : null;
    const entries = wanted ? c.entries.filter(e => e.implementation_status === wanted) : c.entries;
    return {
      domain: c.domain, levels: c.levels,
      summary: include_summary ? bsiCheck.summarize(c.entries) : undefined,
      total_entries: entries.length, entries: entries.slice(0, limit), unmodeled: c.unmodeled,
    };
  })
);

server.tool(
  'isms_set_bsi_check_status',
  'Set the IT-Grundschutz-Check result of one requirement for a target object (or for the whole domain when target_object_id is omitted). The module must be modelled there. A justification is required for nein (not_implemented) and entbehrlich (not_applicable). document_ids / control_ids replace the linked evidence documents / controls (controls need controls.edit).',
  {
    domain_id: z.number().int().positive().describe('Information domain ID'),
    req_id: z.string().min(1).max(40).describe('Requirement ID, e.g. SYS.1.1.A1'),
    target_object_id: z.number().int().positive().optional().describe('Target object ID; omit for the whole domain'),
    implementation_status: z.enum([...BSI_STATUSES, ...Object.keys(BSI_STATUS_ALIASES)]).optional()
      .describe('ja/teilweise/nein/entbehrlich/offen or implemented/in_progress/not_implemented/not_applicable/not_started'),
    justification: z.string().max(10000).nullable().optional(),
    responsible_id: z.number().int().positive().nullable().optional().describe('Responsible user ID'),
    responsible_group_id: z.number().int().positive().nullable().optional().describe('Responsible group ID'),
    due_date: z.string().nullable().optional().describe('Implementation due date YYYY-MM-DD'),
    cost_once: z.number().min(0).nullable().optional().describe('One-off cost in EUR'),
    cost_recurring: z.number().min(0).nullable().optional().describe('Recurring cost in EUR per year'),
    notes: z.string().max(10000).nullable().optional(),
    last_review_date: z.string().nullable().optional().describe('YYYY-MM-DD'),
    document_ids: z.array(z.number().int().positive()).max(200).optional().describe('Evidence document IDs (replaces the list)'),
    control_ids: z.array(z.number().int().positive()).max(200).optional().describe('Control IDs (replaces the list)'),
    realization_priority: z.enum(['high', 'medium', 'low']).nullable().optional().describe('Priority in the realisation plan (A.6); null = suggested from the requirement level'),
  },
  async ({ domain_id, ...body }, { mcpUser }) => bsiDomainResult(async () => {
    if (body.implementation_status !== undefined) body.implementation_status = normalizeBsiStatus(body.implementation_status);
    const r = await bsiCheck.setCheckEntry(domain_id, body, mcpUser);
    const changed = Object.keys(r.changes).length || r.docsAdded.length || r.docsRemoved.length || r.controlsAdded.length || r.controlsRemoved.length;
    if (r.created || changed) {
      await logAudit(r.created ? 'create' : 'update', 'bsi_requirement', r.row.id, r.row.req_id, {
        domain_id: r.domain.id, target_object_id: r.row.target_object_id, asset_id: r.target?.asset_id ?? null,
        before: r.before, after: r.changes,
        documents_added: r.docsAdded, documents_removed: r.docsRemoved,
        controls_added: r.controlsAdded, controls_removed: r.controlsRemoved,
      }, mcpUser);
    }
    return r.row;
  })
);

// ─── BSI 200-3 risk analysis, realisation plan, reports (3.10.0) ────────────
// Same service functions as routes/bsi-domains.js; the service writes the
// signed audit entries (auditFromReq with the MCP user).
const bsiRiskAnalysis = require('../services/bsiRiskAnalysisService');
const bsiAnalysisResult = async (fn) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    if (e instanceof bsiDomains.DomainError || e instanceof bsiCheck.CheckError || e instanceof bsiRiskAnalysis.RiskAnalysisError) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
    return mcpRiskError(e);
  }
};

server.tool(
  'isms_get_bsi_risk_analysis',
  'Read the risk analysis per BSI-Standard 200-3 of an information domain. Without target_object_id: every target object with protection need (from the CIA assessment of its asset: 1-3 normal, 4 high, 5 very high), the reasons why a risk analysis is needed (high_protection_need, no_module, scenario_not_covered), manual decision and progress. With target_object_id: the threat overview (47 elementary threats plus additional threats) with relevance, coverage by the modelled modules (always manual - the catalogues carry no threat mapping), the risk created from each classification and the additional measures from the treatment plans.',
  {
    domain_id: z.number().int().positive().describe('Information domain ID (see isms_list_bsi_domains)'),
    target_object_id: z.number().int().positive().optional().describe('Target object ID for the threat overview'),
    only_relevant: z.boolean().default(false).describe('Threat overview: only threats assessed as relevant or with a risk'),
  },
  async ({ domain_id, target_object_id, only_relevant }, { mcpUser }) => bsiAnalysisResult(async () => {
    if (!target_object_id) return bsiRiskAnalysis.getAnalysis(domain_id, mcpUser);
    const a = await bsiRiskAnalysis.getTargetAnalysis(domain_id, target_object_id, mcpUser);
    return only_relevant ? { ...a, threats: a.threats.filter(t => t.relevant === true || t.has_risk) } : a;
  })
);

server.tool(
  'isms_set_bsi_risk_analysis_target',
  'Add a target object to the BSI 200-3 risk analysis or remove it by hand (decision include/exclude with decision_reason; auto = the computed criteria decide), mark an operating scenario the modules do not cover (scenario_not_covered with scenario_note), or set the progress (open/in_progress/completed).',
  {
    domain_id: z.number().int().positive(),
    target_object_id: z.number().int().positive(),
    decision: z.enum(['auto', 'include', 'exclude']).optional(),
    decision_reason: z.string().max(10000).nullable().optional().describe('Mandatory for include/exclude'),
    scenario_not_covered: z.boolean().optional(),
    scenario_note: z.string().max(10000).nullable().optional().describe('Mandatory when scenario_not_covered is true'),
    status: z.enum(['open', 'in_progress', 'completed']).optional(),
  },
  async ({ domain_id, target_object_id, ...body }, { mcpUser }) => bsiAnalysisResult(() => bsiRiskAnalysis.setTargetDecision(domain_id, target_object_id, body, mcpUser, mcpReq(mcpUser)))
);

server.tool(
  'isms_assess_bsi_threat',
  'Assess a threat in the threat overview of a target object (BSI 200-3 ch. 4): relevant (true/false), coverage by the modelled modules (unknown/covered/partially/not_covered) with notes. To add an additional threat: threat_id of an existing non-elementary threat with add_additional=true, or new_threat (creating a threat needs threats.create). The target object must be selected for the risk analysis.',
  {
    domain_id: z.number().int().positive(),
    target_object_id: z.number().int().positive(),
    threat_id: z.number().int().positive().optional().describe('Threat ID (elementary threats: source bsi_elementar)'),
    add_additional: z.boolean().default(false).describe('Add threat_id as an additional threat to the overview'),
    new_threat: z.object({ title: z.string().min(1).max(255), code: z.string().max(20).optional(), description: z.string().max(10000).optional() }).optional(),
    relevant: z.boolean().nullable().optional(),
    relevance_note: z.string().max(10000).nullable().optional(),
    coverage: z.enum(['unknown', 'covered', 'partially', 'not_covered']).optional(),
    coverage_note: z.string().max(10000).nullable().optional(),
  },
  async ({ domain_id, target_object_id, threat_id, add_additional, new_threat, ...assessment }, { mcpUser }) => bsiAnalysisResult(async () => {
    const req = mcpReq(mcpUser);
    let id = threat_id;
    const adding = !!(new_threat || add_additional);
    if (adding) {
      if (!new_threat && !threat_id) throw new bsiRiskAnalysis.RiskAnalysisError(400, 'threat_id oder new_threat angeben');
      const row = await bsiRiskAnalysis.addAdditionalThreat(domain_id, target_object_id, new_threat ? { ...new_threat, relevance_note: assessment.relevance_note } : { threat_id, relevance_note: assessment.relevance_note }, mcpUser, req);
      id = row.threat_id;
    }
    if (!id) throw new bsiRiskAnalysis.RiskAnalysisError(400, 'threat_id angeben');
    const fields = Object.fromEntries(Object.entries(assessment).filter(([, v]) => v !== undefined));
    if (Object.keys(fields).length) await bsiRiskAnalysis.setThreatAssessment(domain_id, target_object_id, id, fields, mcpUser, req);
    else if (!adding) throw new bsiRiskAnalysis.RiskAnalysisError(400, 'Keine Aenderung angegeben');
    const a = await bsiRiskAnalysis.getTargetAnalysis(domain_id, target_object_id, mcpUser);
    return a.threats.find(t => t.threat.id === id) || null;
  })
);

server.tool(
  'isms_classify_bsi_threat',
  'Classify a relevant threat of a target object (BSI 200-3 ch. 5): frequency (likelihood) x impact on the scales of the active risk methodology, both with a rationale. The first classification creates a risk in the register (scenario: asset of the target object x threat; owner defaults to the asset owner); later classifications update that risk - never a second one. Treat the risk via its treatment plan (isms_create_risk_treatment_item).',
  {
    domain_id: z.number().int().positive(),
    target_object_id: z.number().int().positive(),
    threat_id: z.number().int().positive(),
    likelihood: z.number().int().min(1).max(6).describe('Frequency on the likelihood scale of the active methodology'),
    impact: z.number().int().min(1).max(6),
    likelihood_rationale: z.string().min(1).max(4000),
    impact_rationale: z.string().min(1).max(4000),
    impact_dimensions: z.record(z.string(), z.number().int().min(1).max(6).nullable()).optional(),
    owner_id: z.number().int().positive().optional().describe('Risk owner (default: owner of the asset)'),
    category: z.string().optional().describe('Risk category key (isms_list_risk_categories)'),
  },
  async ({ domain_id, target_object_id, threat_id, ...body }, { mcpUser }) => bsiAnalysisResult(() => bsiRiskAnalysis.classifyThreat(domain_id, target_object_id, threat_id, body, mcpUser, mcpReq(mcpUser)))
);

server.tool(
  'isms_get_bsi_realization_plan',
  'Realisation plan of an information domain (BSI reference document A.6): every requirement of the IT-Grundschutz-Check with status nein or teilweise, plus the additional measures from the risk analysis taken over into the plan - with responsible, due date, costs and priority (set, or suggested: B high / S medium / H low; measures from the risk level). Sorted by priority and due date, with a summary.',
  {
    domain_id: z.number().int().positive(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    limit: z.number().int().min(1).max(2000).default(500),
  },
  async ({ domain_id, priority, limit }, { mcpUser }) => bsiAnalysisResult(async () => {
    const plan = await bsiRiskAnalysis.getRealizationPlan(domain_id, mcpUser);
    const items = priority ? plan.items.filter(i => i.priority === priority) : plan.items;
    return { domain: plan.domain, generated_at: plan.generated_at, summary: plan.summary, total_items: items.length, items: items.slice(0, limit) };
  })
);

server.tool(
  'isms_list_reports',
  'List the reports that can be downloaded as DOCX or PDF: risk report, risk treatment plan (ISO 27001 6.1.3 e) and, per information domain, the BSI reference documents A.1-A.6. Returns metadata and download paths only (no file content); download with GET <path>?format=docx|pdf using the same authentication as the REST API. Only reports the caller may download are listed.',
  {},
  async (_args, { mcpUser }) => {
    try {
      const { can } = require('../services/permissionService');
      const { getModules } = require('../middleware/modules');
      const ok = async (module, action, fallback) => { const v = await can(mcpUser, module, action); return v === true || (v !== false && fallback.includes(mcpUser?.role)); };
      const viewers = ['admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'];
      const reportsSvc = require('../services/reportService');
      const bsiOn = !!(await getModules()).bsi_grundschutz && await ok('bsi_grundschutz', 'view', viewers);
      const catalog = reportsSvc.reportCatalog(bsiOn ? await bsiDomains.listDomains() : []);
      if (!(await ok('risks', 'view', viewers))) catalog.risk_reports = [];
      const base = (process.env.APP_URL || '').replace(/\/+$/, '');
      if (/^https?:\/\/[^\s/]+$/.test(base)) {
        for (const r of catalog.risk_reports) r.url = `${base}${r.path}`;
        for (const d of catalog.bsi_reference_documents) for (const r of d.documents) r.url = `${base}${r.path}`;
      }
      return mcpJson(catalog);
    } catch (e) { return mcpRiskError(e); }
  }
);

server.tool(
  'isms_list_nis2_measures',
  'List NIS-2 criteria: the measures of Art. 20, 21 and 23 NIS-2 (§ 30 Abs. 2 Nr. 1-10 BSIG) with their sub-requirements, plus the BSIG duties without a counterpart in the directive (§§ 31, 33, 34, 35, 39). A row with children is a bracket: parent_ref links them, and only the leaves count towards the rate.',
  {
    search: z.string().optional().describe('Search in article_ref or title'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, status, limit }) => {
    const { Nis2Measure, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (search) {
      where[Op.or] = [
        { article_ref: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await Nis2Measure.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['article_ref', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_nis2_measure',
  'Update implementation status, responsible person, deadline, or evidence of a NIS-2 criterion. Set a conditional duty (see scope_note, e.g. the criteria for operators of critical facilities) to not_applicable to drop it from the rate.',
  {
    id: z.number().int().describe('NIS-2 measure ID'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    responsible_id: z.number().int().nullable().optional(),
    evidence: z.string().optional(),
    deadline: z.string().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Nis2Measure } = getModels();
    const item = await Nis2Measure.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'NIS-2 measure not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'nis2_measure', item.id, item.article_ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

// ─── Bedrohungslage (NIS-2 Art. 21(2)(a), ISO 27001 A.5.7) ──────────────────

server.tool(
  'isms_list_threat_sources',
  'List the monitored threat-intelligence sources (national CSIRT, CERTs, vendors, security news) with their review cadence and whether a review is overdue.',
  {
    only_overdue: z.boolean().default(false).describe('Only sources whose review is overdue'),
    only_active: z.boolean().default(true),
  },
  async ({ only_overdue, only_active }) => {
    const { ThreatSource, User } = getModels();
    const { isOverdue, toDateOnly } = require('../services/threatIntelService');
    const where = only_active ? { active: true } : {};
    const sources = await ThreatSource.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['type', 'ASC'], ['name', 'ASC']],
    });
    const today = toDateOnly(new Date());
    const rows = sources
      .map(src => ({ ...src.toJSON(), overdue: isOverdue(src, today) }))
      .filter(src => !only_overdue || src.overdue);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  'isms_list_threat_advisories',
  'List external threat advisories with their assessment and what they turned into (risk, task, incident).',
  {
    search: z.string().optional().describe('Search in title, summary, external id or CVE'),
    status: z.enum(['new', 'in_assessment', 'action_required', 'mitigated', 'closed', 'all']).default('all'),
    relevance: z.enum(['not_assessed', 'not_relevant', 'monitor', 'relevant', 'critical', 'all']).default('all'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, status, relevance, severity, limit }) => {
    const { ThreatAdvisory, ThreatSource, User, Risk, Task } = getModels();
    const where = {};
    if (status !== 'all') where.status = status;
    if (relevance !== 'all') where.relevance = relevance;
    if (severity !== 'all') where.severity = severity;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { summary: { [Op.iLike]: `%${search}%` } },
        { external_id: { [Op.iLike]: `%${search}%` } },
        { cve_ids: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await ThreatAdvisory.findAll({
      where,
      include: [
        { model: ThreatSource, as: 'source', attributes: ['id', 'name', 'type'] },
        { model: User, as: 'assessedBy', attributes: ['id', 'name'] },
        { model: Risk, as: 'risk', attributes: ['id', 'ref', 'title'] },
        { model: Task, as: 'task', attributes: ['id', 'title', 'status'] },
      ],
      order: [['published_at', 'DESC NULLS LAST'], ['created_at', 'DESC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_get_threat_intel_stats',
  'Evidence figures for NIS2 Art. 21(2)(a): how the threat landscape is monitored (sources, cadence, overdue reviews, national CSIRT coverage) and how advisories are fed into risk management (assessment and handover rates).',
  {},
  async () => {
    const { ThreatSource, ThreatAdvisory } = getModels();
    const { isOverdue, toDateOnly } = require('../services/threatIntelService');
    const today = toDateOnly(new Date());
    const sources = await ThreatSource.findAll();
    const active = sources.filter(s => s.active);
    const total = await ThreatAdvisory.count();
    const unassessed = await ThreatAdvisory.count({ where: { relevance: 'not_assessed' } });
    const needsHandling = await ThreatAdvisory.count({ where: { relevance: { [Op.in]: ['relevant', 'critical'] } } });
    const handled = await ThreatAdvisory.count({
      where: {
        relevance: { [Op.in]: ['relevant', 'critical'] },
        [Op.or]: [{ risk_id: { [Op.ne]: null } }, { task_id: { [Op.ne]: null } }, { incident_id: { [Op.ne]: null } }],
      },
    });
    const stats = {
      monitoring: {
        sources_total: sources.length,
        sources_active: active.length,
        sources_overdue: active.filter(s => isOverdue(s, today)).length,
        national_csirt_covered: active.some(s => s.type === 'national_csirt'),
      },
      handling: {
        advisories_total: total,
        unassessed,
        assessment_rate: total ? Math.round(((total - unassessed) / total) * 100) : 0,
        needs_handling: needsHandling,
        handled,
        handling_rate: needsHandling ? Math.round((handled / needsHandling) * 100) : 0,
      },
    };
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  }
);

server.tool(
  'isms_create_threat_advisory',
  'Record an external threat advisory (authority warning, vendor advisory, security news) in the threat register.',
  {
    title: z.string().describe('Advisory title'),
    source_id: z.number().int().optional().describe('ID of the source it came from'),
    external_id: z.string().optional().describe('Identifier at the source, e.g. WID-SEC-2026-0001'),
    summary: z.string().optional(),
    url: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
    cve_ids: z.string().optional().describe('Comma-separated CVE identifiers'),
    published_at: z.string().optional().describe('ISO date the advisory was published'),
  },
  async (args, { mcpUser }) => {
    const { ThreatAdvisory } = getModels();
    const advisory = await ThreatAdvisory.create({ ...args, relevance: 'not_assessed', status: 'new', ingested_via: 'manual' });
    await logAudit('create', 'threat_advisory', advisory.id, advisory.title, { severity: advisory.severity }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(advisory, null, 2) }] };
  }
);

server.tool(
  'isms_assess_threat_advisory',
  'Assess an advisory: is it relevant to this organisation, and what follows from it. Records who assessed it and when — this is the evidence NIS2 Art. 21(2)(a) asks for.',
  {
    id: z.number().int().describe('Advisory ID'),
    relevance: z.enum(['not_relevant', 'monitor', 'relevant', 'critical']),
    status: z.enum(['new', 'in_assessment', 'action_required', 'mitigated', 'closed']).optional(),
    assessment_notes: z.string().optional().describe('Why is it relevant, or not? Which systems are affected?'),
  },
  async ({ id, relevance, status, assessment_notes }, { mcpUser }) => {
    const { ThreatAdvisory } = getModels();
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return { content: [{ type: 'text', text: 'Advisory not found' }], isError: true };
    const nextStatus = status || (relevance === 'not_relevant' ? 'closed' : 'in_assessment');
    await advisory.update({
      relevance,
      status: nextStatus,
      assessment_notes: assessment_notes ?? advisory.assessment_notes,
      // Der Bewerter kommt aus der Sitzung, nie aus den Argumenten — sonst
      // liesse sich eine Bewertung jemandem zuschreiben, der sie nie getroffen hat.
      assessed_by_id: mcpUser?.id || null,
      assessed_at: new Date(),
    });
    await logAudit('assess', 'threat_advisory', advisory.id, advisory.title, { relevance, status: nextStatus }, mcpUser);
    // Same reassessment trigger as POST /api/threat-intel/advisories/:id/assess (3.9.0).
    await require('../services/riskMonitoringService').onThreatAdvisory(advisory, {}, mcpReq(mcpUser));
    return { content: [{ type: 'text', text: JSON.stringify(advisory, null, 2) }] };
  }
);

server.tool(
  'isms_record_threat_source_review',
  'Record that a threat source was reviewed today and schedule the next review from its cadence.',
  {
    id: z.number().int().describe('Threat source ID'),
    note: z.string().optional().describe('What was there? Any relevant advisories, and what came of them?'),
  },
  async ({ id, note }, { mcpUser }) => {
    const { ThreatSource } = getModels();
    const { nextReviewDate, toDateOnly } = require('../services/threatIntelService');
    const source = await ThreatSource.findByPk(id);
    if (!source) return { content: [{ type: 'text', text: 'Threat source not found' }], isError: true };
    const today = toDateOnly(new Date());
    await source.update({ last_reviewed_at: today, next_review_at: nextReviewDate(source.review_frequency), last_review_note: note ?? null });
    await logAudit('review', 'threat_source', source.id, source.name, { reviewed_at: today, next_review_at: source.next_review_at, note }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(source, null, 2) }] };
  }
);

// ─── NIS-2-Standortbestimmung ────────────────────────────────────────────────

server.tool(
  'isms_list_nis2_self_check',
  'List the NIS2 self-check questions with their two answers (implementation and evidence), the article each maps to, and the recommendation attached to it.',
  {
    category: z.string().optional().describe('Filter by topic, e.g. "Bedrohungsanalyse"'),
    only_gaps: z.boolean().default(false).describe('Only questions that are not both implemented and evidenced'),
    limit: z.number().int().min(1).max(200).default(100),
  },
  async ({ category, only_gaps, limit }) => {
    const { Nis2SelfCheckItem } = getModels();
    const { gapKind } = require('../services/nis2SelfCheckScoring');
    const where = {};
    if (category) where.category = category;
    const items = await Nis2SelfCheckItem.findAll({ where, order: [['sort_order', 'ASC']], limit });
    const rows = items
      .map(i => i.toJSON())
      .filter(i => !only_gaps || (gapKind(i) && gapKind(i) !== 'unanswered'));
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  'isms_get_nis2_gaps',
  'The NIS2 gap picture: fulfilment rate and maturity per topic, coverage per article of the directive, and the ranked list of gaps with the recommendation for each. Gaps are split into not implemented, partly implemented, and implemented but not evidenced.',
  {},
  async () => {
    const { Nis2SelfCheckItem, Nis2Measure, Setting } = getModels();
    const { summarise } = require('../services/nis2SelfCheckScoring');
    const { DEFAULT_SCORING, normaliseScoring } = require('../services/nis2ScoringModel');
    const readSetting = async (key) => {
      try {
        const row = await Setting.findByPk(key);
        return typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
      } catch { return null; }
    };
    // Das Betroffenheitsprofil entscheidet, was ueberhaupt zaehlt; das
    // Bewertungsmodell, wie daraus Prozente werden. Beides muss hier dasselbe
    // sein wie in der Oberflaeche — sonst nennt ein Assistent andere Zahlen
    // als das Dashboard, und beide sehen richtig aus.
    const profile = await readSetting('nis2_profile');
    const entityType = profile?.entity_type || 'unknown';
    const scoring = normaliseScoring(await readSetting('nis2_scoring') ?? DEFAULT_SCORING);
    const [items, measures] = await Promise.all([Nis2SelfCheckItem.findAll(), Nis2Measure.findAll()]);
    const stats = summarise(items, entityType, measures, scoring);
    return { content: [{ type: 'text', text: JSON.stringify({ entity_type: entityType, scoring, ...stats }, null, 2) }] };
  }
);

server.tool(
  'isms_answer_nis2_self_check',
  'Answer a NIS2 self-check question on both axes: is the measure implemented, and can it be evidenced.',
  {
    question_ref: z.string().describe('Question identifier, e.g. q7'),
    answer_implementation: z.enum(['not_assessed', 'yes', 'partly', 'no']).optional(),
    answer_evidence: z.enum(['not_assessed', 'yes', 'partly', 'no']).optional(),
    evidence_source: z.string().optional().describe('What the answer rests on — policy, minutes, ticket'),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Nis2SelfCheckItem } = getModels();
    const item = await Nis2SelfCheckItem.findOne({ where: { question_ref: args.question_ref } });
    if (!item) return { content: [{ type: 'text', text: `Question ${args.question_ref} not found` }], isError: true };
    const { question_ref, ...patch } = args;
    if (patch.answer_implementation !== undefined || patch.answer_evidence !== undefined) {
      // Wer geantwortet hat, kommt aus der Sitzung, nie aus den Argumenten.
      patch.answered_by_id = mcpUser?.id || null;
      patch.answered_at = new Date();
    }
    await item.update(patch);
    await logAudit('update', 'nis2_self_check', item.id, item.question_ref, {
      answer_implementation: patch.answer_implementation, answer_evidence: patch.answer_evidence,
    }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_c5_criteria',
  'List BSI C5 (Cloud Computing Compliance Criteria Catalogue) criteria.',
  {
    search: z.string().optional().describe('Search in criterion_id or title'),
    domain: z.string().optional().describe('Filter by domain (e.g. OAS, OIS, SEC, CRY, …)'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, domain, status, limit }) => {
    const { C5Criterion, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (domain) where.domain = domain;
    if (search) {
      where[Op.or] = [
        { criterion_id: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await C5Criterion.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['domain', 'ASC'], ['criterion_id', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_c5_criterion',
  'Update implementation status, responsible person, or evidence of a C5 criterion.',
  {
    id: z.number().int().describe('C5 criterion ID'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    responsible_id: z.number().int().nullable().optional(),
    evidence: z.string().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { C5Criterion } = getModels();
    const item = await C5Criterion.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'C5 criterion not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'c5_criterion', item.id, item.criterion_id, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_tisax_requirements',
  'List VDA-ISA requirements for TISAX assessment.',
  {
    search: z.string().optional().describe('Search in ref or title'),
    chapter: z.string().optional().describe('Filter by chapter'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, chapter, status, limit }) => {
    const { TisaxRequirement } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (chapter) where.chapter = chapter;
    if (search) {
      where[Op.or] = [
        { ref: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await TisaxRequirement.findAll({ where, order: [['ref', 'ASC']], limit });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_tisax_requirement',
  'Update maturity level, target level, status, or notes of a TISAX VDA-ISA requirement.',
  {
    id: z.number().int().describe('TISAX requirement ID'),
    maturity_level: z.number().min(0).max(5).optional(),
    target_level: z.number().min(0).max(5).optional(),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxRequirement } = getModels();
    const item = await TisaxRequirement.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX requirement not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'tisax_requirement', item.id, item.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_tisax_assessments',
  'List TISAX assessment projects and label tracking records.',
  {
    status: z.enum(['planned', 'in_progress', 'passed', 'failed', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(50),
  },
  async ({ status, limit }) => {
    const { TisaxAssessment, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    const items = await TisaxAssessment.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_create_tisax_assessment',
  'Register a new TISAX assessment / label tracking project.',
  {
    scope_description: z.string().min(1).describe('Assessment scope description'),
    assessment_level: z.enum(['AL1', 'AL2', 'AL3']).default('AL2'),
    label_requested: z.string().optional().describe('E.g. Info High, Info Very High, Prototype, Data Protection'),
    status: z.enum(['planned', 'in_progress', 'passed', 'failed']).default('planned'),
    auditor_company: z.string().optional().describe('Audit provider / testing service provider'),
    assessment_date: z.string().optional().describe('ISO date of audit'),
    label_valid_until: z.string().optional().describe('ISO date of validity (usually 3 years)'),
    owner_id: z.number().int().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.create(args);
    await logAudit('create', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_tisax_assessment',
  'Update an existing TISAX assessment record.',
  {
    id: z.number().int().describe('TISAX assessment ID'),
    scope_description: z.string().optional(),
    assessment_level: z.enum(['AL1', 'AL2', 'AL3']).optional(),
    label_requested: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'passed', 'failed']).optional(),
    auditor_company: z.string().optional(),
    assessment_date: z.string().optional(),
    label_valid_until: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX assessment not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_tisax_assessment',
  'Delete a TISAX assessment record.',
  { id: z.number().int().describe('TISAX assessment ID') },
  async ({ id }, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX assessment not found' }], isError: true };
    await logAudit('delete', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Framework Mappings ──────────────────────────────────────────────────────

server.tool(
  'isms_lookup_framework_mappings',
  'Look up cross-framework mappings for a specific control reference across ISO 27001, NIS-2, BSI IT-Grundschutz, and C5.',
  {
    framework: z.enum(['iso27001', 'nis2', 'bsi_grundschutz', 'c5']).describe('Source framework'),
    ref: z.string().min(1).describe('Control reference code (e.g. 5.1, A.5.1, OPS.1.1.4.A1, CRY-01)'),
  },
  async ({ framework, ref }) => {
    const controlMappings = require('../services/controlMappings');
    const { Iso27001Control, Nis2Measure, BsiRequirement, C5Criterion } = getModels();
    const related = controlMappings.lookup(framework, ref);

    const [isoDb, nisDb, bsiDb, c5Db] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'implementation_status'] }).catch(() => []),
    ]);

    const statusMap = {
      iso27001: new Map(isoDb.map(x => [x.ref, x.implementation_status])),
      nis2: new Map(nisDb.map(x => [x.article_ref, x.implementation_status])),
      bsi_grundschutz: new Map(bsiDb.map(x => [x.req_id, x.implementation_status])),
      c5: new Map(c5Db.map(x => [x.criterion_id, x.implementation_status])),
    };

    const enriched = related.map(m => ({
      framework: m.framework,
      ref: m.ref,
      type: m.type,
      status: statusMap[m.framework]?.get(m.ref) || 'not_started',
    }));

    return { content: [{ type: 'text', text: JSON.stringify({ framework, ref, related: enriched }, null, 2) }] };
  }
);

server.tool(
  'isms_get_framework_mapping_stats',
  'Get statistics on cross-framework control mappings between ISO 27001, NIS-2, BSI IT-Grundschutz, and C5.',
  {},
  async () => {
    const controlMappings = require('../services/controlMappings');
    return { content: [{ type: 'text', text: JSON.stringify(controlMappings.stats(), null, 2) }] };
  }
);

server.tool(
  'isms_get_framework_mapping_overview',
  'Get a complete overview table matrix of cross-framework control mappings.',
  {},
  async () => {
    const controlMappings = require('../services/controlMappings');
    const { Iso27001Control, Nis2Measure, BsiRequirement, C5Criterion } = getModels();

    const [isoControls, nisMeasures, bsiReqs, c5Criteria] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'title', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'title', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'title', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'title', 'implementation_status'] }).catch(() => []),
    ]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          stats: controlMappings.stats(),
          iso27001Count: isoControls.length,
          nis2Count: nisMeasures.length,
          bsiCount: bsiReqs.length,
          c5Count: c5Criteria.length,
        }, null, 2),
      }],
    };
  }
);

// ─── Awareness & Trainings ───────────────────────────────────────────────────

server.tool(
  'isms_list_training_courses',
  'List compliance and security training courses / curriculum with assignment and completion stats.',
  {
    search: z.string().optional().describe('Search in training title or description'),
    mandatory: z.boolean().optional().describe('Filter by mandatory flag'),
    limit: z.number().int().min(1).max(500).default(50),
  },
  async ({ search, mandatory, limit }) => {
    const { Training, UserTraining, User } = getModels();
    const where = {};
    if (mandatory !== undefined) where.mandatory = mandatory;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await Training.findAll({
      where,
      include: [{
        model: UserTraining,
        as: 'assignments',
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] }]
      }],
      order: [['date', 'DESC']],
      limit,
    });
    const formatted = items.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      date: t.date,
      mandatory: t.mandatory,
      total_assigned: t.assignments?.length || 0,
      total_completed: (t.assignments || []).filter(a => a.completed_at !== null).length,
      assignments: t.assignments,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
  }
);

server.tool(
  'isms_create_training_course',
  'Create a new security awareness or compliance training course in the catalog.',
  {
    title: z.string().min(1).describe('Training title (e.g. Information Security Awareness 2026)'),
    description: z.string().optional().describe('Training course description and learning objectives'),
    date: z.string().min(1).describe('Training date or deadline (YYYY-MM-DD)'),
    mandatory: z.boolean().default(true).describe('Whether this training is mandatory for employees'),
  },
  async (args, { mcpUser }) => {
    const { Training } = getModels();
    const item = await Training.create(args);
    await logAudit('create', 'training', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_training_course',
  'Update an existing training course details.',
  {
    id: z.number().int().describe('Training course ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    date: z.string().optional(),
    mandatory: z.boolean().optional(),
  },
  async (args, { mcpUser }) => {
    const { Training, UserTraining } = getModels();
    const item = await Training.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Training course not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    if (updates.title) {
      await UserTraining.update({ training_title: updates.title }, { where: { training_id: item.id } });
    }
    await logAudit('update', 'training', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_training_course',
  'Delete a training course and cancel associated tasks.',
  { id: z.number().int().describe('Training course ID') },
  async ({ id }, { mcpUser }) => {
    const { Training, Task } = getModels();
    const item = await Training.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Training course not found' }], isError: true };
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'training', related_id: id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await logAudit('delete', 'training', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_list_user_trainings',
  'List user training participation and completion records.',
  {
    user_id: z.number().int().optional().describe('Filter by specific user ID'),
    training_id: z.number().int().optional().describe('Filter by training course ID'),
    status: z.enum(['pending', 'valid', 'expired', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ user_id, training_id, status, limit }) => {
    const { UserTraining, User, Training } = getModels();
    const where = {};
    if (user_id) where.user_id = user_id;
    if (training_id) where.training_id = training_id;
    if (status && status !== 'all') where.status = status;
    const items = await UserTraining.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] },
        { model: Training, as: 'training' },
      ],
      order: [['completed_at', 'DESC'], ['created_at', 'DESC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_record_user_training',
  'Record a training completion or assign a training to a registered user or external employee.',
  {
    user_id: z.number().int().nullable().optional().describe('User ID if registered user'),
    training_id: z.number().int().nullable().optional().describe('Training course ID'),
    training_title: z.string().optional().describe('Title of training if not linked to course ID'),
    employee_name: z.string().optional().describe('External employee name'),
    employee_email: z.string().optional().describe('External employee email'),
    completed_at: z.string().nullable().optional().describe('ISO date (YYYY-MM-DD) of completion'),
    expires_at: z.string().nullable().optional().describe('ISO date (YYYY-MM-DD) of validity expiration'),
    certificate_url: z.string().optional(),
    status: z.enum(['pending', 'valid', 'expired']).default('valid'),
  },
  async (args, { mcpUser }) => {
    const { UserTraining, Training } = getModels();
    const data = { ...args };
    if (data.training_id && !data.training_title) {
      const tr = await Training.findByPk(data.training_id);
      if (tr) data.training_title = tr.title;
    }
    if (data.completed_at) {
      data.status = 'valid';
    } else {
      data.status = 'pending';
    }
    const item = await UserTraining.create(data);
    await logAudit('create', 'user_training', item.id, item.training_title || 'Training Record', args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_user_training',
  'Update an individual user training record (completion date, expiration, certificate).',
  {
    id: z.number().int().describe('User training record ID'),
    completed_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    certificate_url: z.string().optional(),
    status: z.enum(['pending', 'valid', 'expired']).optional(),
  },
  async (args, { mcpUser }) => {
    const { UserTraining } = getModels();
    const item = await UserTraining.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'User training record not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.completed_at !== undefined) {
      updates.status = updates.completed_at ? 'valid' : 'pending';
    }
    await item.update(updates);
    await logAudit('update', 'user_training', item.id, item.training_title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_user_training',
  'Delete a user training record.',
  { id: z.number().int().describe('User training record ID') },
  async ({ id }, { mcpUser }) => {
    const { UserTraining } = getModels();
    const item = await UserTraining.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'User training record not found' }], isError: true };
    await logAudit('delete', 'user_training', item.id, item.training_title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Audit Logs & Verification ──────────────────────────────────────────────

server.tool(
  'isms_list_audit_logs',
  'Query immutable ISMS audit log entries with filters.',
  {
    entity_type: z.string().optional().describe('Filter by entity type (asset, risk, incident, user, etc.)'),
    action: z.string().optional().describe('Filter by action (create, update, delete, assess, signoff, etc.)'),
    actor_id: z.number().int().optional().describe('Filter by actor user ID'),
    search: z.string().optional().describe('Search in entity name'),
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  },
  async ({ entity_type, action, actor_id, search, from, to, limit, offset }) => {
    const { AuditLog } = getModels();
    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (action) where.action = action;
    if (actor_id) where.actor_id = actor_id;
    if (search) where.entity_name = { [Op.iLike]: `%${search}%` };
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }
    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ total: count, logs: rows }, null, 2) }] };
  }
);

server.tool(
  'isms_verify_audit_logs',
  'Verify the cryptographic HMAC tamper-evidence integrity chain of the entire ISMS audit log.',
  {},
  async () => {
    const { AuditLog } = getModels();
    const { verifyAuditRow } = require('../services/auditService');
    const BATCH = 1000;
    let offset = 0, total = 0, intact = 0, tampered = 0, unverifiable = 0;
    const tamperedIds = [];
    for (;;) {
      const rows = await AuditLog.findAll({ order: [['id', 'ASC']], limit: BATCH, offset });
      if (rows.length === 0) break;
      for (const row of rows) {
        total++;
        const result = verifyAuditRow(row);
        if (result === null) unverifiable++;
        else if (result) intact++;
        else { tampered++; if (tamperedIds.length < 100) tamperedIds.push(row.id); }
      }
      offset += rows.length;
      if (rows.length < BATCH) break;
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total,
          intact,
          tampered,
          unverifiable,
          tamperedIds,
          isCompromised: tampered > 0,
        }, null, 2),
      }],
    };
  }
);

// ─── Legal Requirements / Rechtskataster ────────────────────────────────────

server.tool(
  'isms_list_legal_requirements',
  'List legal and regulatory compliance requirements in the legal register (Rechtskataster).',
  {
    category: z.string().optional().describe('Filter by category (e.g. Datenschutz, IT-Sicherheit, Arbeitsrecht)'),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable', 'all']).default('all'),
    search: z.string().optional().describe('Search in title or description'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ category, status, search, limit }) => {
    const { LegalRequirement, User } = getModels();
    const where = {};
    if (category) where.category = category;
    if (status && status !== 'all') where.status = status;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const items = await LegalRequirement.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['title', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_create_legal_requirement',
  'Add a new legal requirement or regulation to the legal register.',
  {
    title: z.string().min(1).describe('Law / Regulation title (e.g. DSGVO, BSIG, TKG, NIS-2-Umsetzungsgesetz)'),
    category: z.string().optional().describe('Category (e.g. IT-Sicherheit, Datenschutz, Branchenrecht)'),
    description: z.string().optional(),
    reference_url: z.string().optional(),
    applicable_since: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    review_date: z.string().optional().describe('Next review date (YYYY-MM-DD)'),
    owner_id: z.number().int().optional(),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable']).default('compliant'),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.create(args);
    await logAudit('create', 'legal_requirement', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_legal_requirement',
  'Update a legal requirement in the legal register.',
  {
    id: z.number().int().describe('Legal requirement ID'),
    title: z.string().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    reference_url: z.string().optional(),
    applicable_since: z.string().optional(),
    review_date: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Legal requirement not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'legal_requirement', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_legal_requirement',
  'Delete a legal requirement from the legal register.',
  { id: z.number().int().describe('Legal requirement ID') },
  async ({ id }, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Legal requirement not found' }], isError: true };
    await logAudit('delete', 'legal_requirement', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── GDPR Data Flows & DSFA ──────────────────────────────────────────────────

server.tool(
  'isms_list_dataflows',
  'List data flow mappings between systems and assets in compliance with GDPR Art. 30.',
  {
    status: z.enum(['active', 'planned', 'deprecated', 'all']).default('all'),
    contains_personal_data: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ status, contains_personal_data, limit }) => {
    const { DataFlow, Asset } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (contains_personal_data !== undefined) where.contains_personal_data = contains_personal_data;
    const items = await DataFlow.findAll({
      where,
      include: [
        { model: Asset, as: 'source', attributes: ['id', 'name', 'type'] },
        { model: Asset, as: 'target', attributes: ['id', 'name', 'type'] },
      ],
      order: [['name', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_get_dataflow',
  'Get full details of a specific data flow.',
  { id: z.number().int().describe('Data flow ID') },
  async ({ id }) => {
    const { DataFlow, Asset } = getModels();
    const item = await DataFlow.findByPk(id, {
      include: [
        { model: Asset, as: 'source', attributes: ['id', 'name', 'type'] },
        { model: Asset, as: 'target', attributes: ['id', 'name', 'type'] },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_create_dataflow',
  'Register a new data flow between source and target assets/systems.',
  {
    name: z.string().min(1).describe('Data flow name'),
    description: z.string().optional(),
    source_id: z.number().int().optional().describe('Source asset ID'),
    target_id: z.number().int().optional().describe('Target asset ID'),
    data_categories: z.string().optional().describe('Categories of transferred data'),
    transfer_mechanism: z.string().optional().describe('E.g. REST API, SFTP, Direct DB, Kafka'),
    encryption: z.string().optional().describe('E.g. TLS 1.3, AES-256, None'),
    frequency: z.string().optional().describe('E.g. Real-time, Hourly, Daily batch'),
    contains_personal_data: z.boolean().default(false),
    notes: z.string().optional(),
    status: z.enum(['active', 'planned', 'deprecated']).default('active'),
  },
  async (args, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.create(args);
    await logAudit('create', 'dataflow', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dataflow',
  'Update details of an existing data flow.',
  {
    id: z.number().int().describe('Data flow ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    source_id: z.number().int().nullable().optional(),
    target_id: z.number().int().nullable().optional(),
    data_categories: z.string().optional(),
    transfer_mechanism: z.string().optional(),
    encryption: z.string().optional(),
    frequency: z.string().optional(),
    contains_personal_data: z.boolean().optional(),
    notes: z.string().optional(),
    status: z.enum(['active', 'planned', 'deprecated']).optional(),
  },
  async (args, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dataflow', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dataflow',
  'Delete a data flow record.',
  { id: z.number().int().describe('Data flow ID') },
  async ({ id }, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    await logAudit('delete', 'dataflow', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_vvt_entry',
  'Get full details of a single VVT processing activity (Verarbeitungstätigkeit) including linked assets and processors.',
  { id: z.number().int().describe('VVT entry ID') },
  async ({ id }) => {
    const { VvtEntry, User, Vendor, Asset } = getModels();
    const item = await VvtEntry.findByPk(id, {
      include: [
        { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'processor', attributes: ['id', 'name'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vvt_entry',
  'Update a GDPR Record of Processing Activities (VVT) entry.',
  {
    id: z.number().int().describe('VVT entry ID'),
    name: z.string().optional(),
    purpose: z.string().optional(),
    legal_basis: z.string().optional(),
    data_categories: z.string().optional(),
    special_categories: z.string().optional(),
    data_subjects: z.string().optional(),
    recipients: z.string().optional(),
    third_country_transfers: z.string().optional(),
    transfer_safeguards: z.string().optional(),
    retention_period: z.string().optional(),
    retention_legal_basis: z.string().optional(),
    deletion_procedure: z.string().optional(),
    security_measures: z.string().optional(),
    responsible_id: z.number().int().nullable().optional(),
    processor_id: z.number().int().nullable().optional(),
    status: z.enum(['draft', 'in_review', 'active', 'archived']).optional(),
    notes: z.string().optional(),
    dsfa_required: z.boolean().optional(),
    last_review_date: z.string().optional(),
    asset_ids: z.array(z.number().int()).optional(),
    vendor_ids: z.array(z.number().int()).optional(),
  },
  async (args, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const item = await VvtEntry.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    const { id, asset_ids, vendor_ids, ...updates } = args;
    await item.update(updates);
    if (Array.isArray(asset_ids)) await item.setAssets(asset_ids);
    if (Array.isArray(vendor_ids)) await item.setVendors(vendor_ids);
    await logAudit('update', 'vvt', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vvt_entry',
  'Delete a VVT entry from the GDPR register.',
  { id: z.number().int().describe('VVT entry ID') },
  async ({ id }, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const item = await VvtEntry.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    await logAudit('delete', 'vvt', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_vvt_dsfa',
  'Get the DSFA (Data Protection Impact Assessment / Datenschutz-Folgenabschätzung) for a VVT entry.',
  { vvt_id: z.number().int().describe('VVT entry ID') },
  async ({ vvt_id }) => {
    const { Dsfa, User } = getModels();
    const item = await Dsfa.findOne({
      where: { vvt_id },
      include: [{ model: User, as: 'approver', attributes: ['id', 'name'] }],
    });
    if (!item) return { content: [{ type: 'text', text: 'No DSFA found for this VVT entry' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_create_vvt_dsfa',
  'Create a DSFA (Data Protection Impact Assessment) according to GDPR Art. 35 for a VVT entry.',
  {
    vvt_id: z.number().int().describe('VVT entry ID'),
    title: z.string().min(1).describe('DSFA assessment title'),
    processing_description: z.string().optional(),
    necessity_assessment: z.string().optional(),
    risks_identified: z.string().optional(),
    measures_taken: z.string().optional(),
    residual_risk: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
    dpa_consultation_required: z.boolean().default(false),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected']).default('draft'),
    approver_id: z.number().int().optional(),
    approval_date: z.string().optional(),
    next_review_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Dsfa } = getModels();
    const existing = await Dsfa.findOne({ where: { vvt_id: args.vvt_id } });
    if (existing) return { content: [{ type: 'text', text: 'DSFA already exists for this VVT entry' }], isError: true };
    const item = await Dsfa.create(args);
    await logAudit('create', 'dsfa', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vvt_dsfa',
  'Update an existing DSFA assessment.',
  {
    id: z.number().int().describe('DSFA ID'),
    title: z.string().optional(),
    processing_description: z.string().optional(),
    necessity_assessment: z.string().optional(),
    risks_identified: z.string().optional(),
    measures_taken: z.string().optional(),
    residual_risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    dpa_consultation_required: z.boolean().optional(),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected']).optional(),
    approver_id: z.number().int().nullable().optional(),
    approval_date: z.string().optional(),
    next_review_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Dsfa } = getModels();
    const item = await Dsfa.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DSFA not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dsfa', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vvt_dsfa',
  'Delete a DSFA record.',
  { id: z.number().int().describe('DSFA ID') },
  async ({ id }, { mcpUser }) => {
    const { Dsfa } = getModels();
    const item = await Dsfa.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DSFA not found' }], isError: true };
    await logAudit('delete', 'dsfa', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_subject_request',
  'Delete a GDPR Subject Access Request (Betroffenenanfrage).',
  { id: z.number().int().describe('Subject request ID') },
  async ({ id }, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const item = await SubjectRequest.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Subject request not found' }], isError: true };
    await logAudit('delete', 'subject_request', item.id, item.ref, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Settings, Custom Roles & Automation ─────────────────────────────────────

server.tool(
  'isms_get_settings',
  'Get general system settings (appName, review intervals, audit retention, SSO configuration, etc.).',
  {},
  async () => {
    const { getGeneral } = require('../services/settingsService');
    const settings = await getGeneral();
    return { content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }] };
  }
);

server.tool(
  'isms_update_settings',
  'Update general system settings (admin only).',
  {
    appName: z.string().optional(),
    reviewIntervalMonths: z.number().int().min(1).max(60).optional(),
    ssoAutoProvision: z.boolean().optional(),
    ssoDefaultGroupId: z.number().int().nullable().optional().describe('Group new SSO users join when no claim mapping matches (null = none)'),
    ssoDefaultRole: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).optional().describe('Deprecated: sets the SSO default group to the group carrying this role'),
    ssoAllowedDomains: z.string().optional(),
    ssoStrictRoleSync: z.boolean().optional(),
    auditLogRetentionMonths: z.number().int().min(3).max(120).optional(),
  },
  async (args, { mcpUser }) => {
    const { getGeneral, setGeneral } = require('../services/settingsService');
    const { ssoDefaultGroupPatch } = require('../services/ssoGroupSync');
    const { ssoDefaultGroupId, ssoDefaultRole, ...rest } = args;
    let groupPatch;
    try { groupPatch = await ssoDefaultGroupPatch({ ssoDefaultGroupId, ssoDefaultRole }); }
    catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    const before = await getGeneral();
    const saved = await setGeneral({ ...rest, ...groupPatch });
    await logAudit('update', 'settings', null, 'Allgemeine Einstellungen', { before, after: saved }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
  }
);

server.tool(
  'isms_get_permissions',
  'Get the role permissions matrix mapping system actions to roles.',
  {},
  async () => {
    const { getPermissions, DEFAULT_PERMISSIONS } = require('../services/settingsService');
    const permissions = await getPermissions();
    return { content: [{ type: 'text', text: JSON.stringify({ permissions, defaults: DEFAULT_PERMISSIONS }, null, 2) }] };
  }
);

server.tool(
  'isms_update_permissions',
  'Update the role permissions matrix (admin only).',
  { permissions: z.record(z.any()).describe('Permissions matrix object') },
  async ({ permissions }, { mcpUser }) => {
    const { getPermissions, setPermissions } = require('../services/settingsService');
    const { invalidatePermissionCache } = require('../services/permissionService');
    const before = await getPermissions();
    const saved = await setPermissions(permissions);
    invalidatePermissionCache();
    await logAudit('update', 'settings', null, 'Rollen & Rechte', { before, after: saved }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ permissions: saved }, null, 2) }] };
  }
);

server.tool(
  'isms_list_custom_roles',
  'List custom roles (named permission sets) with their permission matrices, the groups that carry them and how many users hold them through those groups.',
  {},
  async () => {
    const { CustomRole, GroupRole, Group, GroupMember } = getModels();
    const roles = await CustomRole.findAll({ order: [['name', 'ASC']] });
    const links = await GroupRole.findAll({
      where: { custom_role_id: { [Op.ne]: null } },
      include: [{ model: Group, attributes: ['id', 'name'], include: [{ model: GroupMember, as: 'groupMembers', attributes: ['user_id'] }] }],
    });
    const result = roles.map(r => {
      const mine = links.filter(l => l.custom_role_id === r.id && l.Group);
      const users = new Set(mine.flatMap(l => l.Group.groupMembers.map(m => m.user_id)));
      return { ...r.toJSON(), users_count: users.size, groups: mine.map(l => ({ id: l.Group.id, name: l.Group.name })) };
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'isms_create_custom_role',
  'Create a custom user role with specific permissions (admin only).',
  {
    name: z.string().min(1).describe('Custom role name'),
    description: z.string().optional(),
    base_role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).default('viewer'),
    permissions: z.record(z.any()).optional().describe('Custom permissions matrix override'),
  },
  async (args, { mcpUser }) => {
    const { CustomRole } = getModels();
    const { sanitizeMatrix, invalidatePermissionCache } = require('../services/permissionService');
    const role = await CustomRole.create({
      name: args.name.trim(),
      description: args.description || null,
      base_role: args.base_role,
      permissions: sanitizeMatrix(args.permissions),
    });
    invalidatePermissionCache();
    await logAudit('create', 'custom_role', role.id, role.name, { permissions: role.permissions }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(role, null, 2) }] };
  }
);

server.tool(
  'isms_update_custom_role',
  'Update a custom user role (admin only).',
  {
    id: z.number().int().describe('Custom role ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    base_role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).optional(),
    permissions: z.record(z.any()).optional(),
  },
  async (args, { mcpUser }) => {
    const { CustomRole } = getModels();
    const { sanitizeMatrix, invalidatePermissionCache } = require('../services/permissionService');
    const role = await CustomRole.findByPk(args.id);
    if (!role) return { content: [{ type: 'text', text: 'Custom role not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.permissions) updates.permissions = sanitizeMatrix(updates.permissions);
    const beforeBaseRole = role.base_role;
    await role.update(updates);
    if (updates.base_role && updates.base_role !== beforeBaseRole) {
      const access = require('../services/accessService');
      await access.syncUserRoles();
      if ((await access.findUserIdsWithRole('admin')).length === 0) {
        await role.update({ base_role: beforeBaseRole });
        await access.syncUserRoles();
        return mcpError('This change would leave the installation without an active administrator.');
      }
    }
    invalidatePermissionCache();
    await logAudit('update', 'custom_role', role.id, role.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(role, null, 2) }] };
  }
);

server.tool(
  'isms_delete_custom_role',
  'Delete a custom role (admin only).',
  { id: z.number().int().describe('Custom role ID') },
  async ({ id }, { mcpUser }) => {
    const { CustomRole, User, GroupRole } = getModels();
    const { invalidatePermissionCache } = require('../services/permissionService');
    const access = require('../services/accessService');
    const sequelize = require('../config/database');
    const role = await CustomRole.findByPk(id);
    if (!role) return mcpError('Custom role not found');
    const name = role.name;
    try {
      await sequelize.transaction(async (t) => {
        await GroupRole.destroy({ where: { custom_role_id: role.id }, transaction: t });
        await User.update({ custom_role_id: null }, { where: { custom_role_id: role.id }, transaction: t });
        await role.destroy({ transaction: t });
        await access.assertAdminRemains(t);
      });
    } catch (e) { return mcpAccessError(e); }
    await access.syncUserRoles();
    invalidatePermissionCache();
    await logAudit('delete', 'custom_role', id, name, {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_run_automation',
  'Trigger background automation rules manually (generating recurring tasks, review reminders, and CVE status updates).',
  {},
  async (args, { mcpUser }) => {
    const { runTaskAutomation } = require('../services/taskAutomationService');
    await runTaskAutomation();
    await logAudit('execute', 'settings', null, 'Task-Automatisierung manuell gestartet', {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Automation executed successfully' }) }] };
  }
);

// ─── Comments & Documents ────────────────────────────────────────────────────

server.tool(
  'isms_list_asset_comments',
  'List comments and meeting notes for a specific asset.',
  { asset_id: z.number().int().describe('Asset ID') },
  async ({ asset_id }) => {
    const { Comment, User } = getModels();
    const comments = await Comment.findAll({
      where: { asset_id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role'] }],
      order: [['created_at', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
  }
);

server.tool(
  'isms_add_asset_comment',
  'Add a meeting note or comment to an asset, supporting @mentions and auto-task checkboxes ("- [ ] @mention Task").',
  {
    asset_id: z.number().int().describe('Asset ID'),
    content: z.string().min(1).describe('Comment content / meeting notes'),
    meeting_date: z.string().optional().describe('Optional ISO meeting date (YYYY-MM-DD)'),
    parent_id: z.number().int().optional().describe('Parent comment ID if thread reply'),
  },
  async ({ asset_id, content, meeting_date, parent_id }, { mcpUser }) => {
    const { Comment, Asset } = getModels();
    const asset = await Asset.findByPk(asset_id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    const userId = await getValidUserId(mcpUser);
    const comment = await Comment.create({
      asset_id,
      user_id: userId,
      parent_id: parent_id || null,
      content: content.trim(),
      meeting_date: meeting_date || null,
    });
    await logAudit('create', 'asset', asset.id, asset.name, { action: 'add_comment', comment_id: comment.id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
  }
);

server.tool(
  'isms_delete_asset_comment',
  'Delete a comment or meeting note from an asset.',
  {
    asset_id: z.number().int().describe('Asset ID'),
    comment_id: z.number().int().describe('Comment ID'),
  },
  async ({ asset_id, comment_id }, { mcpUser }) => {
    const { Comment, Asset } = getModels();
    const comment = await Comment.findOne({ where: { id: comment_id, asset_id } });
    if (!comment) return { content: [{ type: 'text', text: 'Comment not found' }], isError: true };
    const asset = await Asset.findByPk(asset_id);
    await comment.destroy();
    if (asset) {
      await logAudit('delete', 'asset', asset.id, asset.name, { action: 'delete_comment', comment_id }, mcpUser);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedCommentId: comment_id }) }] };
  }
);

server.tool(
  'isms_list_documents',
  'List attached documents and metadata for an asset, vendor, or incident.',
  {
    entity_type: z.enum(['asset', 'vendor', 'incident']).describe('Entity type'),
    entity_id: z.number().int().describe('Entity ID'),
  },
  async ({ entity_type, entity_id }) => {
    const { Document, User } = getModels();
    const where = {};
    if (entity_type === 'asset') where.asset_id = entity_id;
    if (entity_type === 'vendor') where.vendor_id = entity_id;
    if (entity_type === 'incident') where.incident_id = entity_id;
    const items = await Document.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_delete_document',
  'Delete an uploaded document attachment and its file from storage.',
  { doc_id: z.number().int().describe('Document record ID') },
  async ({ doc_id }, { mcpUser }) => {
    const { Document } = getModels();
    const doc = await Document.findByPk(doc_id);
    if (!doc) return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
    const fs = require('fs');
    const path = require('path');
    const UPLOAD_DIR = require('../services/uploadStorage').uploadRoot();
    if (doc.filename) {
      const filePath = path.join(UPLOAD_DIR, path.basename(doc.filename));
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn('Could not delete file:', e.message); }
    }
    await logAudit('delete', 'document', doc.id, doc.original_name, {}, mcpUser);
    await doc.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedDocId: doc_id }) }] };
  }
);


// ─── HTTP Transport & Router ─────────────────────────────────────────────────

const sessions = new Map(); // sessionId → StreamableHTTPServerTransport
const sseTransports = new Map(); // sessionId → SSEServerTransport

function createServerInstance() {
  const connectionServer = new McpServer({
    name: 'OpenISMS',
    version: (() => {
      try {
        const fs = require('fs');
        const path = require('path');
        return fs.readFileSync(path.join(__dirname, '../../../VERSION'), 'utf8').trim();
      } catch { return '2.2.22'; }
    })(),
  });

  for (const args of toolsToRegister) {
    connectionServer.tool(...args);
  }

  return connectionServer;
}

function createMcpRouter() {
  const { apiLimiter } = require('../middleware/rateLimiter');
  const router = express.Router();

  // CORS and Origin check for MCP endpoints, configurable via MCP_CORS_ORIGINS
  // (see ./cors.js and .env.example). Non-browser MCP clients send no Origin and
  // are unaffected; a browser page on an origin that is not allowed gets 403
  // before it reaches the transport (MCP spec: validate Origin against DNS
  // rebinding). Default allow-list is APP_URL; "*" is an explicit opt-in.
  // No credentials: this router authenticates by header/token, never by cookie.
  const mcpCors = createMcpCors();
  console.log(`[MCP] CORS/Origin policy: ${mcpCors.policy.any ? 'any origin (*)' : mcpCors.policy.origins.join(', ')} (${mcpCors.policy.source})`);
  router.use(mcpCors);

  // Startmeldung der aktiven Anmeldewege (ohne Werte). Asynchron, weil die
  // OIDC-Konfiguration aus der Datenbank kommen kann; ein Fehler hier darf
  // den Start nicht aufhalten.
  setTimeout(() => {
    describeAuthModes()
      .then((modes) => console.log(`[MCP] Auth modes: ${modes}`))
      .catch(() => {});
  }, 5000).unref();

  router.use(apiLimiter);
  router.use(express.json({ limit: '10mb' }));
  router.use(mcpAuth);

  // POST / (and /mcp) — Streamable HTTP client -> server messages (also initializes session)
  // Unknown or expired Streamable HTTP session (e.g. after a server restart):
  // the MCP spec (transports, "Session Management") requires HTTP 404 so the
  // client starts a new session. Answering via a fresh, uninitialized
  // transport returned 400 "Server not initialized" and clients stayed stuck.
  const sessionNotFound = (res) => res.status(404).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Session not found' },
    id: null,
  });

  router.post('/', async (req, res) => {
    const existingId = req.headers['mcp-session-id'];
    let transport = existingId ? sessions.get(existingId) : null;

    if (existingId && !transport) return sessionNotFound(res);

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const connectionServer = createServerInstance();
      await connectionServer.connect(transport);
    }

    req.auth = req.mcpUser;
    req._mcpUser = req.mcpUser;
    await transport.handleRequest(req, res, req.body);
  });

  // GET / (and /mcp) — SSE event stream (server -> client)
  router.get('/', async (req, res) => {
    const id = req.headers['mcp-session-id'];
    const transport = id && sessions.get(id);
    if (transport) {
      req.auth = req.mcpUser;
      req._mcpUser = req.mcpUser;
      return await transport.handleRequest(req, res);
    }
    if (id) return sessionNotFound(res);

    // Standard SSE client initialization (e.g. mcp-remote, Claude Desktop)
    const sseTransport = new SSEServerTransport('/mcp/messages', res);
    sseTransports.set(sseTransport.sessionId, sseTransport);
    res.on('close', () => {
      sseTransports.delete(sseTransport.sessionId);
    });

    const connectionServer = createServerInstance();
    await connectionServer.connect(sseTransport);
  });

  // GET /sse (and /mcp/sse) — explicit SSE stream initialization
  router.get('/sse', async (req, res) => {
    const sseTransport = new SSEServerTransport('/mcp/messages', res);
    sseTransports.set(sseTransport.sessionId, sseTransport);
    res.on('close', () => {
      sseTransports.delete(sseTransport.sessionId);
    });

    const connectionServer = createServerInstance();
    await connectionServer.connect(sseTransport);
  });

  // POST /messages (and /mcp/messages) — legacy SSE message endpoint
  router.post('/messages', async (req, res) => {
    const sessionId = String(req.query.sessionId || req.headers['mcp-session-id'] || '').trim();
    const transport = sessionId && sseTransports.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: 'MCP: SSE session not found or expired' });
    }
    req.auth = req.mcpUser;
    req._mcpUser = req.mcpUser;
    await transport.handlePostMessage(req, res, req.body);
  });

  // DELETE / (and /mcp) — terminate Streamable HTTP session
  router.delete('/', async (req, res) => {
    const id = req.headers['mcp-session-id'];
    if (!id || !sessions.has(id)) return sessionNotFound(res);
    await sessions.get(id).close();
    sessions.delete(id);
    res.status(200).end();
  });

  return router;
}

module.exports = { createMcpRouter };
