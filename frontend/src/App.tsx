import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ModulesProvider } from './contexts/ModulesContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { CommandPaletteProvider } from './contexts/CommandPaletteContext';
import { CommandPalette } from './components/CommandPalette';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ModuleGate } from './components/ModuleGate';
import { RoleGate } from './components/RoleGate';
import { Layout } from './components/Layout';

const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Assets = lazy(() => import('./pages/Assets').then(m => ({ default: m.Assets })));
const AssetDetail = lazy(() => import('./pages/AssetDetail').then(m => ({ default: m.AssetDetail })));
const Topology = lazy(() => import('./pages/Topology').then(m => ({ default: m.Topology })));
const Risks = lazy(() => import('./pages/Risks').then(m => ({ default: m.Risks })));
const Controls = lazy(() => import('./pages/Controls').then(m => ({ default: m.Controls })));
const Incidents = lazy(() => import('./pages/Incidents').then(m => ({ default: m.Incidents })));
const Assessments = lazy(() => import('./pages/Assessments').then(m => ({ default: m.Assessments })));
const Reminders = lazy(() => import('./pages/Reminders').then(m => ({ default: m.Reminders })));
const Users = lazy(() => import('./pages/Users').then(m => ({ default: m.Users })));
const AuditLogPage = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLogPage })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Compliance = lazy(() => import('./pages/Compliance').then(m => ({ default: m.Compliance })));
const PolicyLibrary = lazy(() => import('./pages/PolicyLibrary').then(m => ({ default: m.PolicyLibrary })));
const Import = lazy(() => import('./pages/Import').then(m => ({ default: m.Import })));
const Groups = lazy(() => import('./pages/Groups').then(m => ({ default: m.Groups })));
const Vendors = lazy(() => import('./pages/Vendors').then(m => ({ default: m.Vendors })));
const VendorContacts = lazy(() => import('./pages/VendorContacts').then(m => ({ default: m.VendorContacts })));
const AuthCallback = lazy(() => import('./pages/AuthCallback').then(m => ({ default: m.AuthCallback })));
const ManagementReport = lazy(() => import('./pages/ManagementReport').then(m => ({ default: m.ManagementReport })));
const Vvt = lazy(() => import('./pages/Vvt').then(m => ({ default: m.Vvt })));
const Tasks = lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const DataFlows = lazy(() => import('./pages/DataFlows').then(m => ({ default: m.DataFlows })));
const MyArea = lazy(() => import('./pages/MyArea').then(m => ({ default: m.MyArea })));
const NetworkDiscovery = lazy(() => import('./pages/NetworkDiscovery').then(m => ({ default: m.NetworkDiscovery })));
const SubjectRequests = lazy(() => import('./pages/SubjectRequests').then(m => ({ default: m.SubjectRequests })));
const LegalRequirements = lazy(() => import('./pages/LegalRequirements').then(m => ({ default: m.LegalRequirements })));
const Tisax = lazy(() => import('./pages/Tisax').then(m => ({ default: m.Tisax })));
const Dora = lazy(() => import('./pages/Dora').then(m => ({ default: m.Dora })));
const AiAct = lazy(() => import('./pages/AiAct').then(m => ({ default: m.AiAct })));
const Bcm = lazy(() => import('./pages/Bcm').then(m => ({ default: m.Bcm })));
const Pentests = lazy(() => import('./pages/Pentests').then(m => ({ default: m.Pentests })));
const Iso27001 = lazy(() => import('./pages/Iso27001').then(m => ({ default: m.Iso27001 })));
const BsiGrundschutz = lazy(() => import('./pages/BsiGrundschutz').then(m => ({ default: m.BsiGrundschutz })));
const Nis2 = lazy(() => import('./pages/Nis2').then(m => ({ default: m.Nis2 })));
const C5 = lazy(() => import('./pages/C5').then(m => ({ default: m.C5 })));

const App: React.FC = () => (
  <AuthProvider>
    <ModulesProvider>
    <ThemeProvider>
      <CommandPaletteProvider>
      <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="assets" element={<Assets />} />
              <Route path="assets/:id" element={<AssetDetail />} />
              <Route path="topology" element={<Topology />} />
              <Route path="risks" element={<Risks />} />
              <Route path="controls" element={<Controls />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="assessments" element={<Assessments />} />
              <Route path="reminders" element={<Reminders />} />
              <Route path="users" element={<RoleGate roles={['admin']}><Users /></RoleGate>} />
              <Route path="audit-log" element={<RoleGate roles={['admin', 'assessor']}><AuditLogPage /></RoleGate>} />
              <Route path="admin" element={<RoleGate roles={['admin']}><Admin /></RoleGate>} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="policies" element={<PolicyLibrary />} />
              <Route path="templates" element={<Navigate to="/policies?tab=templates" replace />} />
              <Route path="groups" element={<RoleGate roles={['admin']}><Groups /></RoleGate>} />
              <Route path="import" element={<RoleGate roles={['admin']}><Import /></RoleGate>} />
              <Route path="vendors" element={<Vendors />} />
              <Route path="contacts" element={<VendorContacts />} />
              <Route path="report" element={<ManagementReport />} />
              <Route path="my" element={<MyArea />} />
              <Route path="vvt" element={<ModuleGate module="dsgvo"><Vvt /></ModuleGate>} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="dataflows" element={<ModuleGate module="dsgvo"><DataFlows /></ModuleGate>} />
              <Route path="discovery" element={<ModuleGate module="discovery"><RoleGate roles={['admin']}><NetworkDiscovery /></RoleGate></ModuleGate>} />
              <Route path="subject-requests" element={<ModuleGate module="dsgvo"><SubjectRequests /></ModuleGate>} />
              <Route path="legal-requirements" element={<RoleGate roles={['admin', 'assessor', 'dpo']}><LegalRequirements /></RoleGate>} />
              <Route path="tisax" element={<ModuleGate module="tisax"><Tisax /></ModuleGate>} />
              <Route path="dora" element={<ModuleGate module="dora"><Dora /></ModuleGate>} />
              <Route path="ai-act" element={<ModuleGate module="ai_act"><AiAct /></ModuleGate>} />
              <Route path="bcm" element={<ModuleGate module="bcm"><Bcm /></ModuleGate>} />
              <Route path="pentests" element={<ModuleGate module="pentest"><Pentests /></ModuleGate>} />
              <Route path="iso27001" element={<ModuleGate module="iso27001"><Iso27001 /></ModuleGate>} />
              <Route path="bsi-grundschutz" element={<ModuleGate module="bsi_grundschutz"><BsiGrundschutz /></ModuleGate>} />
              <Route path="nis2" element={<ModuleGate module="nis2"><Nis2 /></ModuleGate>} />
              <Route path="c5" element={<ModuleGate module="c5"><C5 /></ModuleGate>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <CommandPalette />
      </BrowserRouter>
      </ToastProvider>
      </CommandPaletteProvider>
    </ThemeProvider>
    </ModulesProvider>
  </AuthProvider>
);

export default App;
