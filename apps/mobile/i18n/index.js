import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '@topup/core/locales/en';
import fr from '@topup/core/locales/fr';

// `name` is endonymic on purpose — you should recognise your own language even
// when the app is currently in one you can't read.
export const LANGS = [
  { code: 'en', label: 'EN', name: 'English', english: 'English' },
  { code: 'fr', label: 'FR', name: 'Français', english: 'French' },
];

const LANG_STORE = 'topup.lang';

// Ivorian market, so fall back to French unless the device says otherwise.
const deviceLang = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2) === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
};

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: deviceLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Applies the stored preference once at boot, before the first paint that matters.
export const loadStoredLanguage = async () => {
  try {
    const saved = await AsyncStorage.getItem(LANG_STORE);
    if (saved && LANGS.some((l) => l.code === saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // Keep the device default.
  }
};

export const setLanguage = (code) => {
  i18n.changeLanguage(code);
  AsyncStorage.setItem(LANG_STORE, code).catch(() => {});
};

export default i18n;
