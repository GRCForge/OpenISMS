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
  'subjectrequests', 'myarea', 'aiact', 'bcm', 'dora',
  'networkdiscovery', 'tisax', 'policylibrary', 'managementreport',
  'pentests', 'vvt', 'documentanalysis', 'graph',
];

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'de', 'es'],
    defaultNS: 'common',
    ns: NAMESPACES,
    backend: {
      // Die Version haengt an der URL, damit ein Update seine Texte auch
      // wirklich zeigt.
      //
      // Die Sprachdateien tragen - anders als die gebauten JS-Buendel - keinen
      // Inhalts-Hash im Namen und werden mit einem Tag Cache-Lebensdauer
      // ausgeliefert. i18next holt sie per fetch NACH dem Seitenaufbau, und
      // davon ist selbst ein hartes Neuladen nicht erfasst. Nach einem Update
      // sah man deshalb bis zu 24 Stunden lang die alten Texte - neue
      // Beschriftungen fehlten, geaenderte blieben stehen, und beides sah nach
      // einem Fehler in der Uebersetzung aus statt nach einem Cache.
      loadPath: `/locales/{{lng}}/{{ns}}.json?v=${__APP_VERSION__}`,
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
