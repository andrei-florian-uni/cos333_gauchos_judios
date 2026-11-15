/**
 * Sets up i18next, which supplies every piece of interface text in the
 * visitor's language (Project Design › Application Architecture: react-i18next).
 *
 * The text lives in locales/en.json and locales/es.json: `common` for text
 * shared between pages and `landing` for the landing page, the only page
 * translated so far. The other pages will add their own objects.
 * Components read it with react-i18next's `useTranslation` hook, e.g.
 * t('landing.hero.learnMore'). Both files are bundled with the app, so a
 * change of language needs no request.
 *
 * The starting language is read from the URL before the first render, so a
 * Spanish link never shows English first. After that, `LanguageSync` in
 * App.jsx keeps i18next in step with the URL.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import { DEFAULT_LANGUAGE, LANGUAGES, readLanguage } from './language.js';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: readLanguage(new URLSearchParams(window.location.search)),
  // A text missing from one language falls back to the English one.
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((language) => language.code),
  // React already escapes text it renders, so i18next must not escape it again.
  interpolation: { escapeValue: false },
  // The texts are bundled, so i18next is ready before the first render.
  initAsync: false,
});

export default i18n;
