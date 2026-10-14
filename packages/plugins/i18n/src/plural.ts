export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

type Rule = (n: number) => PluralCategory

const between = (n: number, from: number, to: number) => n >= from && n <= to

const none: Rule = () => 'other'
const oneIfOne: Rule = (n) => (n === 1 ? 'one' : 'other')
const oneIfZeroOrOne: Rule = (n) => (n >= 0 && n < 2 ? 'one' : 'other')

const eastSlavic: Rule = (n) => {
  if (!Number.isInteger(n)) return 'other'
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'one'
  if (between(m10, 2, 4) && !between(m100, 12, 14)) return 'few'
  return 'many'
}

const polish: Rule = (n) => {
  if (!Number.isInteger(n)) return 'other'
  if (n === 1) return 'one'
  const m10 = n % 10
  const m100 = n % 100
  if (between(m10, 2, 4) && !between(m100, 12, 14)) return 'few'
  return 'many'
}

const czech: Rule = (n) => {
  if (!Number.isInteger(n)) return 'many'
  if (n === 1) return 'one'
  if (between(n, 2, 4)) return 'few'
  return 'other'
}

const southSlavic: Rule = (n) => {
  if (!Number.isInteger(n)) return 'other'
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'one'
  if (between(m10, 2, 4) && !between(m100, 12, 14)) return 'few'
  return 'other'
}

const slovenian: Rule = (n) => {
  if (!Number.isInteger(n)) return 'few'
  const m100 = n % 100
  if (m100 === 1) return 'one'
  if (m100 === 2) return 'two'
  if (between(m100, 3, 4)) return 'few'
  return 'other'
}

const lithuanian: Rule = (n) => {
  if (!Number.isInteger(n)) return 'many'
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && !between(m100, 11, 19)) return 'one'
  if (between(m10, 2, 9) && !between(m100, 11, 19)) return 'few'
  return 'other'
}

const latvian: Rule = (n) => {
  if (!Number.isInteger(n)) return 'other'
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 0 || between(m100, 11, 19)) return 'zero'
  if (m10 === 1 && m100 !== 11) return 'one'
  return 'other'
}

const romanian: Rule = (n) => {
  if (n === 1) return 'one'
  if (!Number.isInteger(n)) return 'other'
  if (n === 0 || between(n % 100, 1, 19)) return 'few'
  return 'other'
}

const arabic: Rule = (n) => {
  if (!Number.isInteger(n)) return 'other'
  if (n === 0) return 'zero'
  if (n === 1) return 'one'
  if (n === 2) return 'two'
  const m100 = n % 100
  if (between(m100, 3, 10)) return 'few'
  if (between(m100, 11, 99)) return 'many'
  return 'other'
}

const hebrew: Rule = (n) => (n === 1 ? 'one' : n === 2 ? 'two' : 'other')

const irish: Rule = (n) => {
  if (n === 1) return 'one'
  if (n === 2) return 'two'
  if (between(n, 3, 6)) return 'few'
  if (between(n, 7, 10)) return 'many'
  return 'other'
}

const welsh: Rule = (n) => {
  if (n === 0) return 'zero'
  if (n === 1) return 'one'
  if (n === 2) return 'two'
  if (n === 3) return 'few'
  if (n === 6) return 'many'
  return 'other'
}

const RULES: Record<string, Rule> = {}
const assign = (languages: string, rule: Rule) =>
  languages.split(' ').forEach((language) => (RULES[language] = rule))

// Cardinal plural rules of Unicode CLDR, for whole numbers
assign('ja zh ko vi th id ms my km lo jv', none)
assign(
  'en de nl sv nb nn no da fi et it ca es el hu bg eu gl af tr sq sw ur ta te ml eo fy lb ka uz tk ps so ne',
  oneIfOne
)
assign('fr pt hi bn fa gu kn zu am hy', oneIfZeroOrOne)
assign('ru uk be', eastSlavic)
assign('pl', polish)
assign('cs sk', czech)
assign('hr sr bs', southSlavic)
assign('sl', slovenian)
assign('lt', lithuanian)
assign('lv', latvian)
assign('ro mo', romanian)
assign('ar', arabic)
assign('he iw', hebrew)
assign('ga', irish)
assign('cy', welsh)

/**
 * Which form of a word goes with `count` in `language`: "1 item", "2 items". There is no
 * `Intl.PluralRules` in the JS runtime of PocketBase, so the rules are here. Languages
 * not listed here are treated like English.
 */
export const pluralCategory = (
  language: string,
  count: number
): PluralCategory => {
  const rule = RULES[language.split('-')[0]!.toLowerCase()] ?? oneIfOne
  return rule(Math.abs(count))
}

export const CATEGORIES: PluralCategory[] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]
