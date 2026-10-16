import { expect, test } from 'bun:test'
import {
  languageOf,
  localizePath,
  matchLocale,
  normalizeLocale,
  parseAcceptLanguage,
  stripLocalePrefix,
} from './locale'
import { pluralCategory } from './plural'

test('locales are written the way browsers write them', () => {
  expect(normalizeLocale('es')).toBe('es')
  expect(normalizeLocale('ES')).toBe('es')
  expect(normalizeLocale('es_mx')).toBe('es-MX')
  expect(normalizeLocale('pt-br')).toBe('pt-BR')
  expect(normalizeLocale('zh-hant-tw')).toBe('zh-Hant-TW')
  for (const bad of [
    '',
    ' ',
    'e',
    '1234',
    'es-',
    '-es',
    'es/..',
    'es?x',
    '../etc',
    'es mx',
  ]) {
    expect(normalizeLocale(bad)).toBeUndefined()
  }
  expect(languageOf('pt-BR')).toBe('pt')
})

test('Accept-Language is read in order of preference', () => {
  expect(parseAcceptLanguage('es-MX,es;q=0.9,en;q=0.8')).toEqual([
    'es-MX',
    'es',
    'en',
  ])
  expect(parseAcceptLanguage('en;q=0.5, fr;q=0.9, de')).toEqual([
    'de',
    'fr',
    'en',
  ])
  expect(parseAcceptLanguage('*')).toEqual([])
  expect(parseAcceptLanguage('')).toEqual([])
  expect(parseAcceptLanguage('xx;q=0, en')).toEqual(['en'])
  expect(parseAcceptLanguage('en;q=abc, es')).toEqual(['en', 'es'])
  expect(parseAcceptLanguage('en, , ;q=1, es-419')).toEqual(['en', 'es-419'])
})

test('the best supported locale is found', () => {
  const supported = ['en', 'es', 'pt-BR']
  expect(matchLocale(['es'], supported)).toBe('es')
  expect(matchLocale(['es-MX'], supported)).toBe('es')
  expect(matchLocale(['pt'], supported)).toBe('pt-BR')
  expect(matchLocale(['pt-PT'], supported)).toBe('pt-BR')
  expect(matchLocale(['fr', 'de', 'es'], supported)).toBe('es')
  expect(matchLocale(['fr'], supported)).toBeUndefined()
  expect(matchLocale([], supported)).toBeUndefined()
  expect(matchLocale(['EN-us'], supported)).toBe('en')
})

test('locales are told from the start of a path', () => {
  const locales = ['en', 'es', 'pt-BR']
  expect(stripLocalePrefix('/es/about', locales)).toEqual({
    locale: 'es',
    path: '/about',
  })
  expect(stripLocalePrefix('/es', locales)).toEqual({ locale: 'es', path: '/' })
  expect(stripLocalePrefix('/es/', locales)).toEqual({
    locale: 'es',
    path: '/',
  })
  expect(stripLocalePrefix('/ES/about', locales)).toEqual({
    locale: 'es',
    path: '/about',
  })
  expect(stripLocalePrefix('/pt-br/a/b', locales)).toEqual({
    locale: 'pt-BR',
    path: '/a/b',
  })
  expect(stripLocalePrefix('/espanol/about', locales)).toEqual({
    locale: undefined,
    path: '/espanol/about',
  })
  expect(stripLocalePrefix('/about/es', locales)).toEqual({
    locale: undefined,
    path: '/about/es',
  })
  expect(stripLocalePrefix('/', locales)).toEqual({
    locale: undefined,
    path: '/',
  })
  expect(stripLocalePrefix('', locales)).toEqual({
    locale: undefined,
    path: '',
  })
  expect(stripLocalePrefix('//es/about', locales)).toEqual({
    locale: undefined,
    path: '//es/about',
  })
})

test('paths are put in a locale', () => {
  expect(localizePath('/about', 'es', 'en', false)).toBe('/es/about')
  expect(localizePath('/about', 'en', 'en', false)).toBe('/about')
  expect(localizePath('/about', 'en', 'en', true)).toBe('/en/about')
  expect(localizePath('/', 'es', 'en', false)).toBe('/es')
  expect(localizePath('/', 'en', 'en', false)).toBe('/')
  expect(localizePath('/a?b=1#c', 'es', 'en', false)).toBe('/es/a?b=1#c')
  expect(localizePath('https://example.com/x', 'es', 'en', false)).toBe(
    'https://example.com/x'
  )
  expect(localizePath('//example.com/x', 'es', 'en', false)).toBe(
    '//example.com/x'
  )
  expect(localizePath('#top', 'es', 'en', false)).toBe('#top')
})

const categories = (language: string, counts: number[]) =>
  counts.map((n) => pluralCategory(language, n))

test('English counts one and many', () => {
  expect(categories('en', [0, 1, 2, 5, 100, 1.5])).toEqual([
    'other',
    'one',
    'other',
    'other',
    'other',
    'other',
  ])
  expect(categories('es', [0, 1, 2])).toEqual(['other', 'one', 'other'])
  expect(categories('de-CH', [1, 2])).toEqual(['one', 'other'])
})

test('French and Portuguese count 0 as one', () => {
  expect(categories('fr', [0, 1, 1.5, 2])).toEqual([
    'one',
    'one',
    'one',
    'other',
  ])
  expect(categories('pt-BR', [0, 1, 2])).toEqual(['one', 'one', 'other'])
})

test('Asian languages have one form', () => {
  expect(categories('ja', [0, 1, 2, 100])).toEqual([
    'other',
    'other',
    'other',
    'other',
  ])
  expect(categories('zh-CN', [1])).toEqual(['other'])
})

test('Russian has one, few and many', () => {
  expect(
    categories(
      'ru',
      [1, 2, 3, 4, 5, 11, 12, 14, 20, 21, 22, 25, 101, 111, 112, 0]
    )
  ).toEqual([
    'one',
    'few',
    'few',
    'few',
    'many',
    'many',
    'many',
    'many',
    'many',
    'one',
    'few',
    'many',
    'one',
    'many',
    'many',
    'many',
  ])
  expect(pluralCategory('ru', 1.5)).toBe('other')
  expect(categories('uk', [21, 22, 5])).toEqual(['one', 'few', 'many'])
})

test('Polish and Czech', () => {
  expect(categories('pl', [1, 2, 5, 12, 22, 25, 0])).toEqual([
    'one',
    'few',
    'many',
    'many',
    'few',
    'many',
    'many',
  ])
  expect(categories('cs', [1, 2, 4, 5, 0])).toEqual([
    'one',
    'few',
    'few',
    'other',
    'other',
  ])
})

test('Arabic has all six', () => {
  expect(categories('ar', [0, 1, 2, 3, 10, 11, 99, 100, 102])).toEqual([
    'zero',
    'one',
    'two',
    'few',
    'few',
    'many',
    'many',
    'other',
    'other',
  ])
})

test('other languages with several forms', () => {
  expect(categories('sl', [1, 2, 3, 5, 101])).toEqual([
    'one',
    'two',
    'few',
    'other',
    'one',
  ])
  expect(categories('hr', [1, 2, 5, 11, 21])).toEqual([
    'one',
    'few',
    'other',
    'other',
    'one',
  ])
  expect(categories('lt', [1, 2, 10, 11, 21])).toEqual([
    'one',
    'few',
    'other',
    'other',
    'one',
  ])
  expect(categories('lv', [0, 1, 2, 11, 21])).toEqual([
    'zero',
    'one',
    'other',
    'zero',
    'one',
  ])
  expect(categories('ro', [1, 0, 2, 19, 20, 100])).toEqual([
    'one',
    'few',
    'few',
    'few',
    'other',
    'other',
  ])
  expect(categories('he', [1, 2, 3])).toEqual(['one', 'two', 'other'])
  expect(categories('ga', [1, 2, 4, 8, 11])).toEqual([
    'one',
    'two',
    'few',
    'many',
    'other',
  ])
  expect(categories('cy', [0, 1, 2, 3, 6, 7])).toEqual([
    'zero',
    'one',
    'two',
    'few',
    'many',
    'other',
  ])
})

test('negative numbers count like positive ones, languages we do not know like English', () => {
  expect(pluralCategory('en', -1)).toBe('one')
  expect(pluralCategory('xx', 1)).toBe('one')
  expect(pluralCategory('xx', 3)).toBe('other')
})
