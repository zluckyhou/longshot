/** Fills data-i18n markup from _locales, and exposes lookups to scripts. */
export const t = (key, ...subs) =>
  chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined) || key;

export function localizeDocument(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = t(title.dataset.i18n);
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
