import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Download, CheckCircle, AlertCircle, ChevronRight, Table, Settings2 } from 'lucide-react';
import api from '../lib/api';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { useToast } from '../contexts/ToastContext';

type EntityType = 'asset' | 'user' | 'vendor' | 'risk' | 'vendor_contact';

interface PreviewData {
  headers: string[];
  preview: any[];
  mapping: Record<string, string>;
  fields: { key: string; label: string; required: boolean }[];
  totalRows: number;
}

export const Import: React.FC = () => {
  const { t } = useTranslation('import');
  const toast = useToast();
  const [entityType, setEntityType] = useState<EntityType>('asset');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelection = (f: File) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    setStep(1);
  };

  const getPreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', entityType);
      const { data } = await api.post('/import/preview', fd);
      setPreview(data);
      setMapping(data.mapping);
      setStep(2);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.previewError'));
    } finally { setLoading(false); }
  };

  const executeImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', entityType);
      fd.append('mapping', JSON.stringify(mapping));
      const { data } = await api.post('/import/process', fd);
      setResult(data);
      setStep(3);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.importError'));
    } finally { setLoading(false); }
  };

  const downloadTemplate = async () => {
    try {
      const response = await api.get(`/import/template?type=${entityType}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `isms-${entityType}-vorlage.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (err) {
      toast.error(t('toast.downloadError'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {step > 1 && <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}>{t('back')}</Button>}
          <Button variant="secondary" size="sm" onClick={downloadTemplate}><Download size={14} />{t('template')}</Button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-8">
        {[
          { step: 1, label: t('steps.upload'), icon: Upload },
          { step: 2, label: t('steps.mapping'), icon: Settings2 },
          { step: 3, label: t('steps.result'), icon: CheckCircle },
        ].map((s, i) => (
          <React.Fragment key={s.step}>
            <div className={`flex items-center gap-2 ${step >= s.step ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= s.step ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-800'}`}>
                <s.icon size={16} />
              </div>
              <span className="text-sm font-bold">{s.label}</span>
            </div>
            {i < 2 && <ChevronRight size={16} className="text-gray-300 dark:text-slate-700" />}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardBody className="space-y-6 p-8">
            <div className="max-w-md mx-auto space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-slate-200">{t('step1.whatToImport')}</label>
                <Select
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value as EntityType)}
                  options={[
                    { label: t('entityTypes.asset'), value: 'asset' },
                    { label: t('entityTypes.user'), value: 'user' },
                    { label: t('entityTypes.vendor'), value: 'vendor' },
                    { label: t('entityTypes.risk'), value: 'risk' },
                    { label: t('entityTypes.vendor_contact'), value: 'vendor_contact' },
                  ]}
                />
              </div>

              <div
                className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                  file ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-300 dark:border-slate-700 hover:border-blue-300 hover:bg-gray-50'
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelection(f);
                }}>
                <Upload size={40} className={`mx-auto mb-4 ${file ? 'text-blue-500' : 'text-gray-400'}`} />
                {file ? (
                  <div className="space-y-1">
                    <p className="font-bold text-gray-800 dark:text-slate-200">{file.name}</p>
                    <p className="text-xs text-gray-500">{t('step1.fileSizeKb', { size: (file.size / 1024).toFixed(1) })}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="font-bold text-gray-700 dark:text-slate-300">{t('step1.chooseFile')}</p>
                    <p className="text-xs text-gray-400">{t('step1.dropHint')}</p>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => e.target.files?.[0] && handleFileSelection(e.target.files[0])} />
              </div>

              <Button onClick={getPreview} disabled={!file || loading} className="w-full justify-center py-6 text-lg">
                {loading ? t('step1.analyzing') : t('step1.analyze')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 2 && preview && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><div className="flex items-center gap-2"><Table size={18} className="text-blue-500" /><h2 className="font-bold dark:text-white">{t('step2.previewTitle')}</h2></div></CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-800 border-b dark:border-slate-700">
                      {preview.headers.map(h => <th key={h} className="px-4 py-3 font-bold text-gray-600 dark:text-slate-400">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-800">
                    {preview.preview.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                        {preview.headers.map(h => <td key={h} className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><div className="flex items-center gap-2"><Settings2 size={18} className="text-purple-500" /><h2 className="font-bold dark:text-white">{t('step2.mappingTitle')}</h2></div></CardHeader>
              <CardBody className="space-y-4">
                <p className="text-sm text-gray-500 mb-4">{t('step2.mappingHint')}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  {preview.fields.map(field => (
                    <div key={field.key} className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </label>
                      <Select
                        value={mapping[field.key] || ''}
                        onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                        options={[
                          { label: t('step2.notImport'), value: '' },
                          ...preview.headers.map(h => ({ label: h, value: h }))
                        ]}
                      />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader><h2 className="font-bold dark:text-white">{t('step2.summaryTitle')}</h2></CardHeader>
              <CardBody className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('step2.file')}</span>
                    <span className="font-medium dark:text-slate-200">{file?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('step2.rows')}</span>
                    <span className="font-medium dark:text-slate-200">{preview.totalRows}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('step2.importType')}</span>
                    <span className="font-medium text-blue-600 dark:text-blue-400 uppercase text-xs font-bold">{entityType}</span>
                  </div>
                </div>
                <div className="pt-4 border-t dark:border-slate-800">
                  <Button onClick={executeImport} disabled={loading} className="w-full justify-center py-4">
                    {loading ? t('step2.importing') : t('step2.importButton', { count: preview.totalRows })}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <Card>
          <CardBody className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={40} />
            </div>
            <div>
              <h2 className="text-2xl font-bold dark:text-white">{t('step3.done')}</h2>
              <p className="text-gray-500">{t('step3.doneSubtitle', { count: result.created })}</p>
            </div>

            {result.errors.length > 0 && (
              <div className="max-w-2xl mx-auto text-left space-y-2">
                <p className="text-sm font-bold text-red-500 flex items-center gap-2">
                  <AlertCircle size={14} /> {t('step3.errorCount', { count: result.errors.length })}
                </p>
                <div className="max-h-60 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded-lg border border-red-100 dark:border-red-900/30">
                      {t('step3.rowError', { row: e.row })} {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center gap-3">
              <Button onClick={() => setStep(1)}>{t('step3.startNew')}</Button>
              <Button variant="secondary" onClick={() => window.history.back()}>{t('step3.backToOverview')}</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
