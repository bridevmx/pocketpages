import { CATEGORIES, pluralCategory, PluralCategory } from './plural'

/** One translation: a text, or a text for each form of a plural */
export type Message =
  | string
  | Partial<Record<PluralCategory | `${number}`, string>>

export type Messages = Map<string, Message>

const isPlain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * An object whose keys are forms of a plural (`one`, `other`, `0`...), as opposed to a
 * group of messages
 */
const isPlural = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  let hasForm = false
  for (const key of keys) {
    if (typeof value[key] !== 'string') return false
    if ((CATEGORIES as string[]).indexOf(key) !== -1) {
      hasForm = true
    } else if (!/^\d+$/.test(key)) {
      return false
    }
  }
  return hasForm
}

/**
 * `{ nav: { home: 'Home' } }` becomes `nav.home`, the way messages are asked for.
 * Names that start with an underscore are settings of the locale, not messages.
 */
export const flatten = (
  tree: unknown,
  into: Messages = new Map(),
  prefix = ''
): Messages => {
  if (!isPlain(tree)) return into
  for (const key of Object.keys(tree)) {
    if (prefix === '' && key.startsWith('_')) continue
    const value = tree[key]
    const name = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      into.set(name, value)
    } else if (isPlain(value)) {
      if (isPlural(value)) {
        into.set(name, value as Message)
      } else {
        flatten(value, into, name)
      }
    }
  }
  return into
}

const VAR = /\{(\w+)\}/g

export const interpolate = (
  text: string,
  vars?: Record<string, unknown>,
  escape?: (value: string) => string
): string => {
  if (!vars || text.indexOf('{') === -1) return text
  return text.replace(VAR, (whole, name: string) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (value === null || value === undefined) return ''
    const s = String(value)
    return escape ? escape(s) : s
  })
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * The text of a message for `count`, when it is a plural. `0` and `1` win over the
 * forms of the language when the message has them ("No items").
 */
export const pick = (
  message: Message,
  locale: string,
  count?: number
): string | undefined => {
  if (typeof message === 'string') return message
  if (count === undefined || typeof count !== 'number' || Number.isNaN(count)) {
    return message.other ?? message.one
  }
  const exact = message[String(count) as `${number}`]
  if (exact !== undefined) return exact
  return message[pluralCategory(locale, count)] ?? message.other
}
