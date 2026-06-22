import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

const NAMESPACES = [
  'common', 'nav', 'auth', 'profile',
  'dashboard', 'assets', 'risks', 'incidents',
  'tasks', 'compliance', 'users', 'vendors', 'admin',
  'groups', 'reminders', 'assessments', 'controls',
  'auditlog', 'legalrequirements', 'topology',
  'vendorcontacts', 'import', 'cves', 'dataflows',
  'c5', 'bsigrundschutz', 'iso27001', 'nis2',
];

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'de'],
    defaultNS: 'common',
    ns: NAMESPACES,
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'isms_lang',
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  });

export default i18n;
