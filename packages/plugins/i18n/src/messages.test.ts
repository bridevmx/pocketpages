import { expect, test } from 'bun:test'
import {
  dateFormatsOf,
  dateNamesOf,
  formatDate,
  formatNumber,
  numberFormatOf,
  toDate,
} from './format'
import { escapeHtml, flatten, interpolate, pick } from './messages'

test('messages are found by their path', () => {
  const messages = flatten({
    title: 'Hello',
    nav: { home: 'Home', deep: { er: 'Deeper' } },
    'dotted.key': 'Dotted',
    count: 3,
    list: ['a'],
    _format: { number: {} },
  })
  expect(Object.fromEntries(messages)).toEqual({
    title: 'Hello',
    'nav.home': 'Home',
    'nav.deep.er': 'Deeper',
    'dotted.key': 'Dotted',
  })
})

test('plurals are messages with the forms of a plural', () => {
  const messages = flatten({
    items: { one: '{count} item', other: '{count} items' },
    cart: { zero: 'Empty', one: 'One', other: 'Many', '5': 'Five' },
    only: { other: 'x' },
    group: { one: { nested: 'a' }, other: 'b' },
    mixed: { one: 'a', title: 'b' },
  })
  expect(messages.get('items')).toEqual({
    one: '{count} item',
    other: '{count} items',
  })
  expect(messages.get('cart')).toEqual({
    zero: 'Empty',
    one: 'One',
    other: 'Many',
    '5': 'Five',
  })
  expect(messages.get('only')).toEqual({ other: 'x' })
  // A group of messages that happens to have a message called "one" is a group
  expect(messages.get('group.other')).toBe('b')
  expect(messages.get('group.one.nested')).toBe('a')
  expect(messages.get('mixed.one')).toBe('a')
  expect(messages.get('mixed.title')).toBe('b')
})

test('the form of a plural comes from the count and the language', () => {
  const items = { one: '{count} item', other: '{count} items' }
  expect(pick(items, 'en', 1)).toBe('{count} item')
  expect(pick(items, 'en', 2)).toBe('{count} items')
  expect(pick(items, 'en', 0)).toBe('{count} items')
  expect(pick(items, 'fr', 0)).toBe('{count} item')
  expect(pick(items, 'en')).toBe('{count} items')
  expect(pick('plain', 'en', 5)).toBe('plain')
  const ru = { one: 'a', few: 'b', many: 'c', other: 'd' }
  expect(pick(ru, 'ru', 21)).toBe('a')
  expect(pick(ru, 'ru', 3)).toBe('b')
  expect(pick(ru, 'ru', 5)).toBe('c')
  // A language that needs a form the message does not have uses "other"
  expect(pick({ one: 'a', other: 'z' }, 'ru', 5)).toBe('z')
})

test('exact numbers win over the forms', () => {
  const cart = {
    '0': 'Your cart is empty',
    one: 'One thing',
    other: '{count} things',
  }
  expect(pick(cart, 'en', 0)).toBe('Your cart is empty')
  expect(pick(cart, 'en', 1)).toBe('One thing')
  expect(pick(cart, 'en', 4)).toBe('{count} things')
})

test('variables are put in', () => {
  expect(interpolate('Hello {name}!', { name: 'Ana' })).toBe('Hello Ana!')
  expect(interpolate('{a}{b}{a}', { a: 1, b: 2 })).toBe('121')
  expect(interpolate('Hello {name}', {})).toBe('Hello {name}')
  expect(interpolate('Hello {name}', { name: null })).toBe('Hello ')
  expect(interpolate('Hello', { name: 'x' })).toBe('Hello')
  expect(interpolate('Hello {name}')).toBe('Hello {name}')
  expect(interpolate('{ name } {1}', { name: 'x', 1: 'one' })).toBe(
    '{ name } one'
  )
})

test('variables can be escaped for HTML', () => {
  expect(
    interpolate('Hi <b>{name}</b>', { name: '<script>"x"&' }, escapeHtml)
  ).toBe('Hi <b>&lt;script&gt;&quot;x&quot;&amp;</b>')
})

test('numbers are written the way each language does', () => {
  const en = numberFormatOf('en-US')
  const de = numberFormatOf('de-DE')
  const fr = numberFormatOf('fr')
  const ru = numberFormatOf('ru')
  expect(formatNumber(1234567.891, en)).toBe('1,234,567.891')
  expect(formatNumber(1234567.891, de)).toBe('1.234.567,891')
  expect(formatNumber(1234567.891, fr)).toBe('1 234 567,891')
  expect(formatNumber(1234567.891, ru)).toBe('1 234 567,891')
  expect(formatNumber(1234.5, en, { decimals: 2 })).toBe('1,234.50')
  expect(formatNumber(1234.5678, en, { decimals: 0 })).toBe('1,235')
  expect(formatNumber(999, en)).toBe('999')
  expect(formatNumber(1000, en)).toBe('1,000')
  expect(formatNumber(-1234.5, de)).toBe('-1.234,5')
  expect(formatNumber(-0.001, en, { decimals: 1 })).toBe('0.0')
  expect(formatNumber(1234567, en, { grouping: false })).toBe('1234567')
  expect(formatNumber(0, en)).toBe('0')
  expect(formatNumber(NaN, en)).toBe('NaN')
  expect(formatNumber(1e21, en)).toBe('1e+21')
  expect(formatNumber(Infinity, en)).toBe('Infinity')
  expect(formatNumber('12' as any, en)).toBe('12')
  expect(numberFormatOf('xx')).toEqual({ group: ',', decimal: '.' })
  expect(numberFormatOf('en', { decimal: ',' })).toEqual({
    group: ',',
    decimal: ',',
  })
})

test('dates are written with patterns', () => {
  const date = new Date(Date.UTC(2024, 4, 6, 15, 8, 9))
  const en = dateNamesOf('en')
  expect(formatDate(date, 'YYYY-MM-DD HH:mm:ss', en)).toBe(
    '2024-05-06 15:08:09'
  )
  expect(formatDate(date, 'dddd, MMMM D, YYYY', en)).toBe('Monday, May 6, 2024')
  expect(formatDate(date, 'ddd MMM D YY', en)).toBe('Mon May 6 24')
  expect(formatDate(date, 'h:mm A', en)).toBe('3:08 PM')
  expect(formatDate(date, 'hh:mm a', en)).toBe('03:08 pm')
  expect(formatDate(new Date(Date.UTC(2024, 0, 1, 0, 5)), 'h:mm A', en)).toBe(
    '12:05 AM'
  )
  expect(formatDate(new Date(Date.UTC(2024, 0, 1, 12, 5)), 'h:mm A', en)).toBe(
    '12:05 PM'
  )
  expect(formatDate(date, '[Day] D [of] MMMM', en)).toBe('Day 6 of May')
  expect(formatDate(date, 'DD/MM/YYYY', dateNamesOf('es'))).toBe('06/05/2024')
  expect(formatDate(date, 'dddd D [de] MMMM', dateNamesOf('es'))).toBe(
    'lunes 6 de mayo'
  )
  expect(formatDate(date, 'D MMMM YYYY', dateNamesOf('de'))).toBe('6 Mai 2024')
  expect(formatDate(new Date('0005-01-01T00:00:00Z'), 'YYYY', en)).toBe('0005')
})

test('each language has its own dates', () => {
  const date = new Date(Date.UTC(2024, 4, 6, 15, 8, 9))
  const write = (locale: string, style: 'short' | 'medium' | 'long' | 'time') =>
    formatDate(date, dateFormatsOf(locale)[style], dateNamesOf(locale))
  expect(write('en-US', 'short')).toBe('05/06/2024')
  expect(write('en', 'long')).toBe('May 6, 2024')
  expect(write('es-MX', 'long')).toBe('6 de mayo de 2024')
  expect(write('es', 'short')).toBe('6/5/2024')
  expect(write('de', 'long')).toBe('6. Mai 2024')
  expect(write('fr', 'long')).toBe('6 mai 2024')
  expect(write('en', 'time')).toBe('3:08 PM')
  expect(write('fr', 'time')).toBe('15:08')
  expect(write('xx', 'short')).toBe('05/06/2024')
  expect(dateFormatsOf('en', { short: 'YYYY' }).short).toBe('YYYY')
  expect(dateNamesOf('en', { am: 'vorm.' }).am).toBe('vorm.')
})

test('things that can be a date', () => {
  expect(toDate(new Date(0))?.getTime()).toBe(0)
  expect(toDate(1000)?.getTime()).toBe(1000)
  expect(toDate('2024-05-06T07:08:09Z')?.toISOString()).toBe(
    '2024-05-06T07:08:09.000Z'
  )
  // The way PocketBase writes them
  expect(toDate('2024-05-06 07:08:09.123Z')?.toISOString()).toBe(
    '2024-05-06T07:08:09.123Z'
  )
  expect(toDate('2024-05-06')?.toISOString()).toBe('2024-05-06T00:00:00.000Z')
  expect(toDate('nonsense')).toBeUndefined()
  expect(toDate(new Date('x'))).toBeUndefined()
  expect(toDate(null as any)).toBeUndefined()
  expect(toDate({} as any)).toBeUndefined()
})
