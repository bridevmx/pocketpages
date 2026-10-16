import { expect, test } from 'bun:test'
import { couldBeJson, tryParseJson } from './json'

const parses = (s: string) => {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

test('couldBeJson never rejects something JSON.parse accepts', () => {
  const valid = [
    '{}',
    '[]',
    '{"a":1}',
    '[1,2]',
    '"str"',
    '0',
    '-1',
    '12.5e3',
    'true',
    'false',
    'null',
    ' 1',
    '\t\n\r {"a":[1]} \n',
    '  "padded"',
    '-0.5',
  ]
  for (const s of valid) {
    expect(parses(s)).toBe(true)
    expect(couldBeJson(s)).toBe(true)
  }
})

test('couldBeJson rejects what is obviously not JSON', () => {
  const invalid = [
    '',
    ' ',
    '\n\n',
    '<html></html>',
    'hello',
    'Hello world',
    '[object Object]x'.slice(1),
    '/path',
    '%5B1%5D',
    'a=1',
    '\uFEFF{}',
    'undefined',
    'NaN',
    'Infinity',
    'x',
  ]
  for (const s of invalid) {
    expect(parses(s)).toBe(false)
    expect(couldBeJson(s)).toBe(false)
  }
})

test('couldBeJson agrees with JSON.parse on random strings', () => {
  let seed = 7
  const random = () =>
    (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const alphabet = ' \t\n{}[]":,-0123456789.etrufalsnx<>/'
  for (let i = 0; i < 20000; i++) {
    let s = ''
    const length = Math.floor(random() * 8)
    for (let j = 0; j < length; j++)
      s += alphabet[Math.floor(random() * alphabet.length)]
    if (parses(s)) expect(couldBeJson(s)).toBe(true)
  }
})

test('tryParseJson parses JSON and passes everything else through', () => {
  expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
  expect(tryParseJson('42')).toBe(42)
  expect(tryParseJson('true')).toBe(true)
  expect(tryParseJson('plain')).toBe('plain')
  expect(tryParseJson('{broken')).toBe('{broken')
  expect(tryParseJson('')).toBe('')
  expect(tryParseJson(undefined)).toBe(undefined)
})
