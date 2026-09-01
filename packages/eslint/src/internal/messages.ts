/**
 * ESLint message templates aligned with the language server presentation layer.
 */

export const RULE_MESSAGES = {
  missingKey: 'Translation key "{{key}}" does not exist.',
  unusedKey: 'Translation key "{{key}}" is unused.',
  unusedKeyDynamic:
    'Translation key "{{key}}" may be unused — possible dynamic usage matching {{site}}.',
  duplicateKey:
    'Duplicate translation key "{{key}}" defined {{count}} times{{localeSuffix}}.',
  untranslatedText: 'This text has no translation: "{{text}}"',
  localeMissing:
    'Translation key "{{key}}" is missing in {{locales}}.',
  localeExtra:
    'Translation key "{{key}}" is not defined in base locale "{{baseLocale}}".',
} as const;

export type RuleMessageId = keyof typeof RULE_MESSAGES;
