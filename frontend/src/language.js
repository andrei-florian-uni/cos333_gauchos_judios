/**
 * The languages of the interface, and how the visitor's choice is kept in the
 * page's URL.
 *
 * The design keeps the language in the URL (?lang=es) so that a shared link
 * opens in the sender's language (Project Design › Application Interface).
 * English is the default and is left out of the URL; any other language is
 * written as ?lang=<code>. Nothing is stored in the browser, so an address
 * typed without ?lang opens in English.
 *
 * This module only reads and writes query parameters; it has no React code,
 * so that it can be tested on its own. `useLanguage.js` reads the language
 * from the current URL inside a component.
 *
 * Only the landing page is translated for now; the other pages stay in
 * English until their features are complete (team decision, 2026-11-15).
 * Hebrew is still to come. Adding it means one more entry in LANGUAGES, a
 * he.json file in locales/, and Bootstrap's right-to-left stylesheet.
 */

/** The query parameter that holds the language. */
export const LANGUAGE_PARAM = 'lang';

/** The language used when the URL names none, or names one the site lacks. */
export const DEFAULT_LANGUAGE = 'en';

/**
 * The languages of the toggle, in the order shown (the wireframes put ES
 * first). Windows draws flag emoji as two letters ("AR", "US"), which is why
 * the toggle always shows the short label beside the flag.
 */
export const LANGUAGES = [
  { code: 'es', flag: '🇦🇷', label: 'ES', name: 'Español' },
  { code: 'en', flag: '🇺🇸', label: 'EN', name: 'English' },
];

/**
 * Tells whether the site has a language.
 *
 * @param {string} code A language code, e.g. "es".
 * @returns {boolean} True if LANGUAGES lists the code.
 */
export function isSupportedLanguage(code) {
  return LANGUAGES.some((language) => language.code === code);
}

/**
 * Reads the language from a URL's query parameters. A missing or unknown
 * code gives the default language, so a mistyped link still opens.
 *
 * @param {URLSearchParams} searchParams The URL's query parameters.
 * @returns {string} The language code, e.g. "es".
 */
export function readLanguage(searchParams) {
  const code = (searchParams.get(LANGUAGE_PARAM) || '').trim().toLowerCase();
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * Returns a copy of some query parameters with the language set. The default
 * language is written by leaving the parameter out.
 *
 * @param {URLSearchParams} searchParams The parameters to start from; left unchanged.
 * @param {string} language The language code to set.
 * @returns {URLSearchParams} The new parameters, with `lang` last when it is set.
 */
export function setLanguageParam(searchParams, language) {
  const params = new URLSearchParams(searchParams);
  params.delete(LANGUAGE_PARAM);
  if (language !== DEFAULT_LANGUAGE) params.set(LANGUAGE_PARAM, language);
  return params;
}

/**
 * Builds a link to one part of the landing page in a language, for the
 * navigation bar (SiteNav.jsx), in the form React Router's `Link` takes.
 *
 * @param {string} id The id of the part, e.g. "history".
 * @param {string} language The language code, e.g. "es".
 * @returns {{pathname: string, search: string, hash: string}} The link's
 *   target, e.g. { pathname: '/', search: '?lang=es', hash: '#history' };
 *   the search is empty for the default language.
 */
export function landingLink(id, language) {
  const query = setLanguageParam(new URLSearchParams(), language).toString();
  return { pathname: '/', search: query ? `?${query}` : '', hash: `#${id}` };
}
