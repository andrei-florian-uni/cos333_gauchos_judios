/**
 * The useLanguage hook: the language of the page, as named in its URL.
 *
 * The URL is the one place the language is kept (see language.js), so
 * components read it from there rather than from i18next. `LanguageSync` in
 * App.jsx makes i18next follow the same value.
 */

import { useSearchParams } from 'react-router-dom';
import { readLanguage } from './language.js';

/**
 * Reads the language from the current page's URL.
 *
 * @returns {string} The language code, e.g. "es"; "en" when the URL names none.
 */
export function useLanguage() {
  const [searchParams] = useSearchParams();
  return readLanguage(searchParams);
}
