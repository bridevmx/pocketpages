import { expect, test } from 'bun:test'
import ejs from 'pocketbase-ejs'
import { compileTemplate, withServerBlocks } from './compile'

const options = {
  compileDebug: true,
  async: false,
  filename: '/pages/test.ejs',
}

const render = (
  compile: (t: string, o: any) => any,
  template: string,
  data: any
) =>
  compile(template, { ...options, includeFile: () => () => 'INCLUDED' })(data)

const both = (template: string, data: any = {}) => {
  const expected = render(
    (t, o) => ejs.compile(withServerBlocks(t), o),
    template,
    data
  )
  const actual = render((t, o) => compileTemplate(ejs, t, o), template, data)
  expect(actual).toBe(expected)
  return actual as string
}

test('renders the same output as EJS', () => {
  expect(both('Hello <%= name %>!', { name: 'World' })).toBe('Hello World!')
  both('<% if (a) { %>yes<% } else { %>no<% } %>', { a: true })
  both('<% items.forEach(function (i) { %><li><%= i %></li>\n<% }) %>', {
    items: [1, 2, 3],
  })
  both('<%# a comment %>text<%_ let x = 1 _%>\n<%= x %>')
  both('<%% literal %%> <%= "<&>\'\\"" %> <%- "<b>" %>')
  both('')
  both('plain text only')
  both('multi\nline\n<%= 1 +\n 2 %>\nend\r\nwindows')
  both('slash \\ and "quotes" and \'single\' and `tick` ${notInterpolated}')
  both('<script server>const v = 5</script><%= v %>')
})

test('appends values like string concatenation does', () => {
  const values: any[] = [
    'text',
    '',
    0,
    1.5,
    -2,
    NaN,
    Infinity,
    true,
    false,
    null,
    undefined,
    [1, 2],
    [],
    {},
    { a: 1 },
    new Date(0),
    () => 1,
    /re/g,
    { toString: () => 'custom toString' },
    { valueOf: () => 42, toString: () => 'string wins?' },
    { valueOf: () => 'from valueOf' },
    Object.create(null, { toString: { value: () => 'null proto' } }),
    [null, undefined, 'x'],
  ]
  for (const value of values) {
    both('raw: <%- value %>|escaped: <%= value %>', { value })
  }
})

test('keeps __append and __output usable from templates', () => {
  expect(both('a<% __append("b") %>c')).toBe('abc')
  // Whatever is added to __output directly is not interleaved with the rest of the
  // output (it comes first), but it is not lost either
  const run = (compile: (t: string, o: any) => any) =>
    render(compile, 'a<% __output += "b" %>c', {})
  expect(run((t, o) => ejs.compile(t, o))).toBe('abc')
  expect(run((t, o) => compileTemplate(ejs, t, o))).toBe('bac')
})

test('renders includes', () => {
  expect(both("before <%- include('anything', {}) %> after")).toBe(
    'before INCLUDED after'
  )
})

test('large outputs', () => {
  const html = both(
    '<% for (let i = 0; i < 5000; i++) { %><div><%= i %></div>\n<% } %>'
  )
  expect(html.split('\n').length).toBe(5001)
})

test('falls back to ejs.compile for options it does not know', () => {
  const run = (template: string, extra: any) =>
    compileTemplate(ejs, template, { ...options, ...extra })({ a: 1, b: 2 })
  expect(run('<%= a %>-<%= b %>', { outputFunctionName: 'echo' })).toBe('1-2')
  expect(run('<%= a %>-<%= b %>', { destructuredLocals: ['a', 'b'] })).toBe(
    '1-2'
  )
  expect(
    run('<%= it.a %>-<%= it.b %>', { strict: true, localsName: 'it' })
  ).toBe('1-2')
  expect(run('<%= locals.a %>-<%= locals.b %>', { _with: false })).toBe('1-2')
  expect(
    run('<% echo(a) %>|<% echo(b) %>', { outputFunctionName: 'echo' })
  ).toBe('1|2')
})

test('honours the prepend option', () => {
  const run = (compile: (t: string, o: any) => any) =>
    render(compile, '<%= twice(2) %>', { twice: (n: number) => n * 2 })
  const prepended = { prepend: 'const unused = 1;\n' }
  const withPrepend = (compile: any) => (t: string, o: any) =>
    compile(t, { ...o, ...prepended })
  expect(
    run(withPrepend((t: string, o: any) => compileTemplate(ejs, t, o)))
  ).toBe('4')
})

test('uses ejs.compile when the Template class is not there', () => {
  const calls: any[] = []
  const fake = {
    compile: (text: string, o: any) => {
      calls.push(text)
      return () => 'fallback'
    },
  }
  expect(compileTemplate(fake, 'x', options)({})).toBe('fallback')
  expect(calls).toEqual(['x'])
})

test('server blocks become code blocks', () => {
  expect(withServerBlocks('a<script server>1</script>b')).toBe('a<% 1 %>b')
  expect(withServerBlocks('<script server>\n  x()\n</script>')).toBe(
    '<% \n  x()\n %>'
  )
  expect(withServerBlocks('<script>not server</script>')).toBe(
    '<script>not server</script>'
  )
  expect(withServerBlocks('no scripts')).toBe('no scripts')
})
