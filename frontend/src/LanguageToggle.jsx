/**
 * The language toggle (🇦🇷 ES | 🇺🇸 EN), in the top right of the landing
 * page's hero, as in the wireframes. Only the landing page is translated so
 * far; the other pages will carry the toggle in their header once they are.
 *
 * Choosing a language rewrites ?lang= in the current URL (language.js) and
 * keeps everything else in it, such as a search and its filters. It replaces
 * the current history entry rather than adding one, so the Back button still
 * goes to the previous page, not the previous language.
 */

import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, readLanguage, setLanguageParam } from './language.js';

/**
 * Renders one button per language, with the current one highlighted.
 *
 * @param {object} props
 * @param {boolean} [props.onDark] True when the toggle sits on a dark
 *   background (the hero), which gives it light text and borders.
 * @returns {JSX.Element} The toggle.
 */
function LanguageToggle({ onDark = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = readLanguage(searchParams);
  const { t } = useTranslation();

  /**
   * Switches the page to a language by writing it into the URL.
   *
   * @param {string} code The language chosen, e.g. "es".
   */
  const choose = (code) => {
    if (code === current) return;
    setSearchParams(setLanguageParam(searchParams, code), { replace: true });
  };

  return (
    <div
      className={onDark ? 'language-toggle on-dark' : 'language-toggle'}
      role="group"
      aria-label={t('common.languageToggle')}
    >
      {LANGUAGES.map((language) => (
        <button
          key={language.code}
          type="button"
          className={language.code === current ? 'language-option is-active' : 'language-option'}
          aria-pressed={language.code === current}
          // Each language names itself, in its own language, for screen readers.
          aria-label={language.name}
          lang={language.code}
          onClick={() => choose(language.code)}
        >
          <span className="language-flag" aria-hidden="true">{language.flag}</span>
          <span aria-hidden="true">{language.label}</span>
        </button>
      ))}
    </div>
  );
}

export default LanguageToggle;
