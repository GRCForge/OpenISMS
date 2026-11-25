import React, { useState } from 'react';
import { ShieldCheck, Send, Check, X, Undo2, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import type { Risk, RiskAcceptanceRule, User } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../../contexts/ToastContext';

// Risk acceptance with the four-eyes principle (3.8.0, ISO 27001 6.1.3 f):
// request -> approve/reject by someone else with acceptance authority; the
// risk owner confirms the residual risk. Acceptances from before 3.8.0 stay
// valid and are shown as such.

interface Props {
  risk: Risk;
  user: User | null;
  canRequest: boolean;
  canSignOff: boolean;
  rule?: RiskAcceptanceRule;
  levelLabel: (key?: string | null) => string;
  onRevoke: () => void;
  onChanged: () => void;
}

const fmt = (d: string | null | undefined, lang: string) => (d ? new Date(d).toLocaleDateString(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB') : '–');

export const AcceptanceWorkflow: React.FC<Props> = ({ risk, user, canRequest, canSignOff, rule, levelLabel, onRevoke, onChanged }) => {
  const { t, i18n } = useTranslation('risks');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reqForm, setReqForm] = useState<{ open: boolean; justification: string; residual: string; until: string; confirm: boolean }>({ open: false, justification: '', residual: '', until: '', confirm: false });
  const [decision, setDecision] = useState<{ until: string; note: string; reason: string; rejecting: boolean }>({ until: '', note: '', reason: '', rejecting: false });
  const requests = risk.acceptanceRequests || [];
  const pending = requests.find(r => r.status === 'pending') || null;
  const current = risk.acceptance_request_id ? requests.find(r => r.id === risk.acceptance_request_id) || null : null;
  const isOwner = !!user && risk.owner_id === user.id;
  const lang = i18n.language;

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); toast.success(t('acceptanceFlow.done')); onChanged(); }
    catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorSignoff')); }
    finally { setBusy(false); }
  };

  const submitRequest = () => call(async () => {
    await api.post(`/risks/${risk.id}/acceptance-requests`, {
      justification: reqForm.justification, residual_risk_description: reqForm.residual || null,
      requested_until: reqForm.until || null, confirm_as_owner: isOwner && reqForm.confirm,
    });
    setReqForm({ open: false, justification: '', residual: '', until: '', confirm: false });
  });
  const approve = () => pending && call(async () => {
    await api.post(`/risks/${risk.id}/acceptance-requests/${pending.id}/approve`, { valid_until: decision.until || null, note: decision.note || null });
    setDecision({ until: '', note: '', reason: '', rejecting: false });
  });
  const reject = () => pending && call(async () => {
    await api.post(`/risks/${risk.id}/acceptance-requests/${pending.id}/reject`, { reason: decision.reason });
    setDecision({ until: '', note: '', reason: '', rejecting: false });
  });
  const withdraw = () => pending && call(() => api.post(`/risks/${risk.id}/acceptance-requests/${pending.id}/withdraw`, {}));
  const confirmOwner = (id: number) => call(() => api.post(`/risks/${risk.id}/acceptance-requests/${id}/confirm-owner`, {}));

  const area = 'w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2 text-xs dark:text-white';
  const ownRequest = !!pending && pending.requested_by_id === user?.id;

  return (
    <div className="md:col-span-2 p-4 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10 space-y-3">
      <h3 className="text-xs font-bold uppercase text-green-700 dark:text-green-400 flex items-center gap-1.5"><ShieldCheck size={13} /> {t('acceptanceFlow.title')}</h3>
      {rule && (
        <p className="text-[11px] text-gray-600 dark:text-slate-400">
          {t('acceptance.rule', { level: levelLabel(rule.level), roles: rule.roles.join(', ') })}
          {rule.max_months ? ` ${t('acceptance.maxMonths', { count: rule.max_months })}` : ''}
        </p>
      )}

      {risk.status === 'accepted' && risk.acceptedBy && (
        <div className="flex items-start justify-between gap-2 text-sm">
          <div>
            <p className="dark:text-slate-300 font-medium">{t('form.acceptedBy', { name: risk.acceptedBy.name })}</p>
            <p className="text-xs text-gray-500">{t('form.acceptedAt', { date: fmt(risk.accepted_at, lang) })}{risk.accepted_until ? ` ${t('form.acceptedUntil', { date: fmt(risk.accepted_until, lang) })}` : ''}</p>
            {!risk.acceptance_request_id && <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('acceptanceFlow.legacy')}</p>}
            {current && (current.owner_confirmed
              ? <p className="text-[11px] text-green-700 dark:text-green-400">{t('acceptanceFlow.ownerConfirmed', { name: current.ownerConfirmedBy?.name || '–' })}</p>
              : <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('acceptanceFlow.ownerPending')}</p>)}
          </div>
          <div className="flex flex-col items-end gap-1">
            {canSignOff && <button type="button" onClick={onRevoke} className="text-xs text-red-600 dark:text-red-400 hover:underline font-bold uppercase">{t('form.revokeSignoff')}</button>}
            {current && !current.owner_confirmed && isOwner && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => confirmOwner(current.id)}><UserCheck size={12} />{t('acceptanceFlow.confirmOwner')}</Button>}
          </div>
        </div>
      )}

      {risk.needs_reassessment && <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('acceptance.reassessFirst')}</p>}

      {pending && (
        <div className="p-3 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900/50 space-y-2 text-xs">
          <p className="font-semibold dark:text-slate-200">{t('acceptanceFlow.pending')}</p>
          <p className="text-gray-600 dark:text-slate-400">{t('acceptanceFlow.requestedBy', { name: pending.requestedBy?.name || '–', date: fmt(pending.requested_at, lang) })} · {t('acceptanceFlow.level', { level: levelLabel(pending.residual_level) })}{pending.requested_until ? ` · ${t('acceptanceFlow.until')}: ${fmt(pending.requested_until, lang)}` : ''}</p>
          <p className="dark:text-slate-300 whitespace-pre-wrap">{pending.justification}</p>
          {pending.residual_risk_description && <p className="text-gray-600 dark:text-slate-400 whitespace-pre-wrap">{t('acceptanceFlow.residual')}: {pending.residual_risk_description}</p>}
          {pending.owner_confirmed
            ? <p className="text-green-700 dark:text-green-400">{t('acceptanceFlow.ownerConfirmed', { name: pending.ownerConfirmedBy?.name || '–' })}</p>
            : <p className="text-amber-700 dark:text-amber-400">{t('acceptanceFlow.ownerPending')}</p>}
          <div className="flex flex-wrap gap-2">
            {!pending.owner_confirmed && isOwner && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => confirmOwner(pending.id)}><UserCheck size={12} />{t('acceptanceFlow.confirmOwner')}</Button>}
            {(ownRequest || user?.role === 'admin') && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={withdraw}><Undo2 size={12} />{t('acceptanceFlow.withdraw')}</Button>}
          </div>
          {ownRequest && <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('acceptanceFlow.ownSelf')}</p>}
          {canSignOff && !ownRequest && (
            decision.rejecting ? (
              <div className="space-y-2">
                <textarea className={area} rows={2} placeholder={t('acceptanceFlow.rejectReason')} value={decision.reason} onChange={e => setDecision({ ...decision, reason: e.target.value })} />
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="danger" disabled={busy || !decision.reason.trim()} onClick={reject}><X size={12} />{t('acceptanceFlow.reject')}</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setDecision({ ...decision, rejecting: false })}>{t('items.cancel')}</Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <Input label={t('form.signoffDate')} type="date" value={decision.until} onChange={e => setDecision({ ...decision, until: e.target.value })} />
                <Input label={t('acceptanceFlow.note')} value={decision.note} onChange={e => setDecision({ ...decision, note: e.target.value })} />
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={busy || !!risk.needs_reassessment} onClick={approve}><Check size={12} />{t('acceptanceFlow.approve')}</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setDecision({ ...decision, rejecting: true })}><X size={12} />{t('acceptanceFlow.reject')}</Button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {!pending && canRequest && !risk.needs_reassessment && (
        reqForm.open ? (
          <div className="p-3 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900/50 space-y-2">
            <textarea className={area} rows={3} placeholder={t('acceptanceFlow.justification')} value={reqForm.justification} onChange={e => setReqForm({ ...reqForm, justification: e.target.value })} />
            <textarea className={area} rows={2} placeholder={t('acceptanceFlow.residual')} value={reqForm.residual} onChange={e => setReqForm({ ...reqForm, residual: e.target.value })} />
            <Input label={t('acceptanceFlow.until')} type="date" value={reqForm.until} onChange={e => setReqForm({ ...reqForm, until: e.target.value })} />
            {isOwner && (
              <label className="flex items-start gap-2 text-xs dark:text-slate-300">
                <input type="checkbox" className="mt-0.5" checked={reqForm.confirm} onChange={e => setReqForm({ ...reqForm, confirm: e.target.checked })} />
                {t('acceptanceFlow.confirmAsOwner')}
              </label>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy || !reqForm.justification.trim()} onClick={submitRequest}><Send size={12} />{t('acceptanceFlow.submit')}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setReqForm({ ...reqForm, open: false })}>{t('items.cancel')}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="secondary" className="bg-white dark:bg-slate-900" onClick={() => setReqForm({ ...reqForm, open: true })}><Send size={12} />{t('acceptanceFlow.request')}</Button>
        )
      )}

      {requests.filter(r => r.status !== 'pending').length > 0 && (
        <details className="text-[11px] text-gray-600 dark:text-slate-400">
          <summary className="cursor-pointer">{t('acceptanceFlow.history')}</summary>
          <ul className="mt-1 space-y-1">
            {requests.filter(r => r.status !== 'pending').map(r => (
              <li key={r.id}>
                {t('acceptanceFlow.decidedBy', { status: t(`acceptanceFlow.statuses.${r.status}`), name: r.decidedBy?.name || '–', date: fmt(r.decided_at, lang) })}
                {' · '}{t('acceptanceFlow.requestedBy', { name: r.requestedBy?.name || '–', date: fmt(r.requested_at, lang) })}
                {r.decision_reason ? ` · ${r.decision_reason}` : ''}
                {r.end_reason ? ` · ${t('acceptanceFlow.ended', { reason: t(`acceptanceFlow.endReasons.${r.end_reason}`, { defaultValue: r.end_reason }) })}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
