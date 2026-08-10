import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// Same resource files the mobile app uses — one translation source for both.
import en from '@topup/core/locales/en';
import fr from '@topup/core/locales/fr';

const STORE = 'topup.lang';

const initial = (() => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE) : null;
  if (saved === 'en' || saved === 'fr') return saved;
  return navigator.language?.slice(0, 2) === 'en' ? 'en' : 'fr';
})();

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const setLanguage = (code: string) => {
  i18n.changeLanguage(code);
  localStorage.setItem(STORE, code);
  document.documentElement.lang = code;
};

document.documentElement.lang = initial;

export default i18n;
