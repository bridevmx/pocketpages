import { expect, test } from 'bun:test'
import { Form } from './form'
import { fromJson, fromValueMap, parseUrlEncoded } from './input'
import { blank, FileLike, humanize, Schema, validate } from './schema'

const check = (
  schema: Schema,
  sent: Record<string, string | string[]>,
  files: Record<string, FileLike[]> = {}
) => {
  const input = Object.fromEntries(
    Object.entries(sent).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])
  )
  return validate(schema, input, files)
}

// --- input

test('url encoded text is read as it was sent', () => {
  expect(parseUrlEncoded('a=1&zip=01234&name=+Ana+&e=&tags=x&tags=y')).toEqual({
    a: ['1'],
    zip: ['01234'],
    name: [' Ana '],
    e: [''],
    tags: ['x', 'y'],
  })
})

test('names and values are decoded', () => {
  expect(parseUrlEncoded('na%20me=a%26b%3Dc&caf%C3%A9=%E2%9C%93')).toEqual({
    'na me': ['a&b=c'],
    café: ['✓'],
  })
  // A stray percent sign is kept
  expect(parseUrlEncoded('a=100%&b=%zz')).toEqual({ a: ['100%'], b: ['%zz'] })
  expect(parseUrlEncoded('flag')).toEqual({ flag: [''] })
  expect(parseUrlEncoded('')).toEqual({})
  expect(parseUrlEncoded('&&a=1&&')).toEqual({ a: ['1'] })
})

test('tags[] and tags are the same field', () => {
  expect(parseUrlEncoded('tags[]=a&tags[]=b&tags=c')).toEqual({
    tags: ['a', 'b', 'c'],
  })
  expect(parseUrlEncoded('[]=x')).toEqual({ '[]': ['x'] })
})

test('names like __proto__ are only names', () => {
  const input = parseUrlEncoded('__proto__=x&constructor=y')
  expect(Object.getPrototypeOf(input)).toBeNull()
  expect(input['__proto__']).toEqual(['x'])
  expect(({} as any).x).toBeUndefined()
})

test('value maps from PocketBase are read', () => {
  expect(fromValueMap({ a: ['1'], tags: ['x', 'y'] })).toEqual({
    a: ['1'],
    tags: ['x', 'y'],
  })
})

test('JSON bodies are turned into text, like forms', () => {
  expect(
    fromJson({
      a: 1,
      ok: true,
      name: 'Ana',
      tags: ['x', 2],
      gone: null,
      o: { k: 1 },
    })
  ).toEqual({
    a: ['1'],
    ok: ['true'],
    name: ['Ana'],
    tags: ['x', '2'],
    o: ['{"k":1}'],
  })
  expect(fromJson('text')).toEqual({})
  expect(fromJson(null)).toEqual({})
  expect(fromJson([1])).toEqual({})
})

// --- validation

test('strings are trimmed and only the fields of the schema are kept', () => {
  const r = check({ name: {} }, { name: '  Ana  ', admin: 'true' })
  expect(r.values).toEqual({ name: 'Ana' })
  expect(r.raw).toEqual({ name: '  Ana  ' })
  expect(r.errors).toEqual({})
})

test('trimming can be turned off', () => {
  expect(
    check({ name: { trim: false } }, { name: '  Ana  ' }).values.name
  ).toBe('  Ana  ')
})

test('numbers that look like numbers stay what they were typed as', () => {
  const r = check({ zip: {}, code: {} }, { zip: '01234', code: '1e3' })
  expect(r.values).toEqual({ zip: '01234', code: '1e3' })
})

test('required fields cannot be left empty', () => {
  const r = check({ name: { required: true }, bio: {} }, { name: '   ' })
  expect(r.errors).toEqual({ name: 'Name is required' })
  expect(r.values).toEqual({ name: '', bio: '' })
})

test('labels come from names, or from you', () => {
  expect(check({ first_name: { required: true } }, {}).errors.first_name).toBe(
    'First name is required'
  )
  expect(check({ firstName: { required: true } }, {}).errors.firstName).toBe(
    'First name is required'
  )
  expect(
    check({ n: { required: true, label: 'Your name' } }, {}).errors.n
  ).toBe('Your name is required')
  expect(humanize('user-email_address')).toBe('User email address')
})

test('defaults take the place of what was left empty', () => {
  const r = check(
    {
      role: { default: 'member', required: true },
      tags: { type: 'array', default: ['new'] },
      n: { type: 'int', default: 5 },
    },
    { role: '', n: '' }
  )
  expect(r.values).toEqual({ role: 'member', tags: ['new'], n: 5 })
  expect(r.errors).toEqual({})
})

test('emails', () => {
  const schema: Schema = { email: { type: 'email', required: true } }
  expect(check(schema, { email: ' Ana@Example.COM ' }).values.email).toBe(
    'ana@example.com'
  )
  expect(check(schema, { email: ' Ana@Example.COM ' }).raw.email).toBe(
    ' Ana@Example.COM '
  )
  for (const bad of [
    'ana',
    'ana@',
    '@example.com',
    'ana@example',
    'a na@example.com',
    'a@b@c.d',
  ]) {
    expect(check(schema, { email: bad }).errors.email).toBe(
      'Enter a valid email address'
    )
  }
  expect(
    check(schema, { email: 'a@' + 'b'.repeat(250) + '.com' }).errors.email
  ).toBeDefined()
  expect(
    check(
      { email: { type: 'email', lowercase: false } },
      { email: 'Ana@Example.com' }
    ).values.email
  ).toBe('Ana@Example.com')
  expect(check({ email: { type: 'email' } }, { email: '' }).errors).toEqual({})
})

test('urls', () => {
  const schema: Schema = { site: { type: 'url' } }
  expect(check(schema, { site: 'https://example.com/a?b=1' }).errors).toEqual(
    {}
  )
  expect(check(schema, { site: 'http://example.com' }).errors).toEqual({})
  for (const bad of [
    'example.com',
    'javascript:alert(1)',
    'ftp://example.com',
    'https://',
    'https://exa mple.com',
  ]) {
    expect(check(schema, { site: bad }).errors.site).toBe('Enter a valid URL')
  }
})

test('integers and numbers', () => {
  const schema: Schema = {
    age: { type: 'int', min: 18, max: 120 },
    price: { type: 'number', min: 0 },
  }
  expect(check(schema, { age: '42', price: '9.99' }).values).toEqual({
    age: 42,
    price: 9.99,
  })
  expect(check(schema, { age: '-1', price: '.5' }).errors.age).toBe(
    'Age must be at least 18'
  )
  expect(check(schema, { age: '121', price: '1' }).errors.age).toBe(
    'Age must be at most 120'
  )
  expect(check(schema, { age: '4.5', price: '1' }).errors.age).toBe(
    'Age must be a whole number'
  )
  expect(check(schema, { age: 'abc', price: '1' }).errors.age).toBe(
    'Age must be a whole number'
  )
  expect(check(schema, { age: '30', price: 'abc' }).errors.price).toBe(
    'Price must be a number'
  )
  expect(check(schema, { age: '30', price: '-0.5' }).errors.price).toBe(
    'Price must be at least 0'
  )
  expect(
    check(schema, { age: '99999999999999999999', price: '1' }).errors.age
  ).toBeDefined()
  expect(check(schema, { age: '0', price: '0' }).errors.price).toBeUndefined()
  expect(check(schema, { age: '', price: '' }).values).toEqual({
    age: null,
    price: null,
  })
})

test('booleans are checkboxes', () => {
  const schema: Schema = { agree: { type: 'boolean' } }
  for (const yes of ['on', 'true', '1', 'yes', 'ON', 'True']) {
    expect(check(schema, { agree: yes }).values.agree).toBe(true)
  }
  for (const no of ['', 'off', 'false', '0', 'no', 'whatever']) {
    expect(check(schema, { agree: no }).values.agree).toBe(false)
  }
  expect(check(schema, {}).values.agree).toBe(false)
  // A hidden field in front of a checkbox: the last one wins
  expect(check(schema, { agree: ['0', '1'] }).values.agree).toBe(true)
  expect(check(schema, { agree: ['0'] }).values.agree).toBe(false)
  expect(
    check({ terms: { type: 'boolean', required: true } }, {}).errors.terms
  ).toBe('Terms is required')
  expect(
    check({ terms: { type: 'boolean', required: true } }, { terms: 'on' })
      .errors
  ).toEqual({})
})

test('dates', () => {
  const schema: Schema = {
    day: { type: 'date', min: '2020-01-01', max: '2030-12-31' },
  }
  expect(check(schema, { day: '2024-02-29' }).values.day).toBe('2024-02-29')
  for (const bad of [
    '2023-02-29',
    '2024-13-01',
    '2024-00-10',
    '2024-1-1',
    '24-01-01',
    'tomorrow',
    '2024-04-31',
  ]) {
    expect(check(schema, { day: bad }).errors.day).toBe('Enter a valid date')
  }
  expect(check(schema, { day: '2019-12-31' }).errors.day).toBe(
    'Day must be at least 2020-01-01'
  )
  expect(check(schema, { day: '2031-01-01' }).errors.day).toBe(
    'Day must be at most 2030-12-31'
  )
})

test('dates with a time', () => {
  const schema: Schema = { at: { type: 'datetime' } }
  expect(check(schema, { at: '2024-05-06T07:08' }).values.at).toBe(
    '2024-05-06 07:08:00'
  )
  expect(check(schema, { at: '2024-05-06 07:08:09' }).values.at).toBe(
    '2024-05-06 07:08:09'
  )
  for (const bad of [
    '2024-05-06',
    '2024-05-06T25:00',
    '2024-05-06T10:61',
    '2024-02-30T10:00',
    'x',
  ]) {
    expect(check(schema, { at: bad }).errors.at).toBe(
      'Enter a valid date and time'
    )
  }
})

test('text has a length, counted in characters', () => {
  const schema: Schema = { bio: { minLength: 3, maxLength: 5 } }
  expect(check(schema, { bio: 'ab' }).errors.bio).toBe(
    'Bio must be at least 3 characters'
  )
  expect(check(schema, { bio: 'abcdef' }).errors.bio).toBe(
    'Bio must be at most 5 characters'
  )
  expect(check(schema, { bio: 'abcde' }).errors).toEqual({})
  // Emoji are one character, not two
  expect(check(schema, { bio: '😀😀😀😀😀' }).errors).toEqual({})
  // min and max do the same for text
  expect(check({ t: { min: 3 } }, { t: 'ab' }).errors.t).toBe(
    'T must be at least 3 characters'
  )
})

test('patterns and lists of options', () => {
  const schema: Schema = {
    zip: { pattern: '^\\d{5}$' },
    code: { pattern: '^[a-z]+$', patternFlags: 'i' },
    plan: { oneOf: ['free', 'pro'] },
    seats: { type: 'int', oneOf: [1, 5, 10] },
  }
  expect(
    check(schema, { zip: '01234', code: 'ABC', plan: 'pro', seats: '5' }).errors
  ).toEqual({})
  const bad = check(schema, {
    zip: '1234',
    code: '12',
    plan: 'enterprise',
    seats: '2',
  })
  expect(bad.errors).toEqual({
    zip: 'Zip is not in the right format',
    code: 'Code is not in the right format',
    plan: 'Plan is not one of the options',
    seats: 'Seats is not one of the options',
  })
})

test('arrays', () => {
  const schema: Schema = {
    tags: { type: 'array', min: 1, max: 3, oneOf: ['a', 'b', 'c', 'd'] },
    ids: { type: 'array', of: 'int' },
  }
  expect(check(schema, { tags: ['a', 'b'], ids: ['1', '2'] }).values).toEqual({
    tags: ['a', 'b'],
    ids: [1, 2],
  })
  expect(check(schema, { tags: ['a', ' ', 'b'] }).values.tags).toEqual([
    'a',
    'b',
  ])
  expect(check(schema, { tags: [] }).errors.tags).toBe('Choose at least 1')
  expect(check(schema, {}).errors.tags).toBe('Choose at least 1')
  expect(check(schema, { tags: ['a', 'b', 'c', 'd'] }).errors.tags).toBe(
    'Choose at most 3'
  )
  expect(check(schema, { tags: ['a', 'z'] }).errors.tags).toBe(
    'Tags is not one of the options'
  )
  expect(check(schema, { tags: ['a'], ids: ['1', 'x'] }).errors.ids).toBe(
    'Ids must be a whole number'
  )
  expect(check({ t: { type: 'array', required: true } }, {}).errors.t).toBe(
    'T is required'
  )
  expect(check({ t: { type: 'array' } }, {}).values.t).toEqual([])
  expect(check({ t: { type: 'array' } }, { t: 'one' }).values.t).toEqual([
    'one',
  ])
})

test('fields can be confirmed by another', () => {
  const schema: Schema = {
    password: { required: true, minLength: 8 },
    confirm: { match: 'password' },
  }
  expect(
    check(schema, { password: 'correct horse', confirm: 'correct horse' })
      .errors
  ).toEqual({})
  expect(
    check(schema, { password: 'correct horse', confirm: 'battery staple' })
      .errors
  ).toEqual({ confirm: 'Confirm does not match' })
  expect(check(schema, { password: 'short', confirm: 'short' }).errors).toEqual(
    { password: 'Password must be at least 8 characters' }
  )
})

test('your own checks get all of the values', () => {
  const schema: Schema = {
    from: { type: 'date' },
    to: {
      type: 'date',
      validate: (to, values) =>
        to && values.from && to < values.from
          ? 'The end is before the start'
          : undefined,
    },
  }
  expect(
    check(schema, { from: '2024-05-02', to: '2024-05-01' }).errors
  ).toEqual({ to: 'The end is before the start' })
  expect(
    check(schema, { from: '2024-05-01', to: '2024-05-02' }).errors
  ).toEqual({})
})

test('only the first thing wrong with a field is reported', () => {
  const r = check(
    { email: { type: 'email', required: true, validate: () => 'custom' } },
    { email: 'nope' }
  )
  expect(r.errors).toEqual({ email: 'Enter a valid email address' })
})

test('messages can be changed for a form, or for a field', () => {
  const schema: Schema = {
    name: { required: true },
    age: {
      type: 'int',
      min: 18,
      messages: { min: 'Come back when you are {min}' },
    },
  }
  const r = validate(
    schema,
    {},
    {},
    { messages: { required: 'Falta {label}' } }
  )
  expect(r.errors.name).toBe('Falta Name')
  const r2 = validate(
    schema,
    { name: ['x'], age: ['3'] },
    {},
    { messages: { min: 'ignored' } }
  )
  expect(r2.errors.age).toBe('Come back when you are 18')
})

test('files', () => {
  const png: FileLike = { originalName: 'Me.PNG', size: 1000 }
  const big: FileLike = { originalName: 'big.png', size: 5 * 1024 * 1024 }
  const exe: FileLike = { originalName: 'run.exe', size: 10 }
  const schema: Schema = {
    avatar: {
      type: 'file',
      required: true,
      maxSize: 2 * 1024 * 1024,
      accept: ['.png', '.jpg'],
    },
  }

  const ok = check(schema, {}, { avatar: [png] })
  expect(ok.errors).toEqual({})
  expect(ok.values.avatar).toBe(png)
  expect(ok.raw.avatar).toEqual(['Me.PNG'])
  expect(check(schema, {}, {}).errors.avatar).toBe('Avatar is required')
  expect(check(schema, {}, { avatar: [big] }).errors.avatar).toBe(
    'Avatar must be smaller than 2 MB'
  )
  expect(check(schema, {}, { avatar: [exe] }).errors.avatar).toBe(
    'Avatar must be one of: .png, .jpg'
  )
  expect(check(schema, {}, { avatar: [png, png] }).errors.avatar).toBe(
    'Choose at most 1'
  )
  expect(check({ avatar: { type: 'file' } }, {}, {}).values.avatar).toBeNull()

  const many = check(
    { photos: { type: 'file', multiple: true } },
    {},
    { photos: [png, exe] }
  )
  expect(many.values.photos).toEqual([png, exe])
  expect(
    check({ photos: { type: 'file', multiple: true } }, {}, {}).values.photos
  ).toEqual([])
})

// --- the form

test('a form that was not sent shows what it starts with', () => {
  const schema: Schema = {
    name: {},
    age: { type: 'int' },
    tags: { type: 'array' },
    agree: { type: 'boolean' },
  }
  const form = new Form(
    false,
    blank(schema, { name: 'Ana', age: 30, tags: ['a', 'b'], agree: true })
  )
  expect(form.ok).toBe(false)
  expect(form.invalid).toBe(false)
  expect(form.submitted).toBe(false)
  expect(form.errors).toEqual({})
  expect(form.value('name')).toBe('Ana')
  expect(form.value('age')).toBe('30')
  expect(form.value('tags')).toEqual(['a', 'b'])
  expect(form.has('tags', 'a')).toBe(true)
  expect(form.has('tags', 'z')).toBe(false)
  expect(form.has('agree')).toBe(true)
  expect(form.values.age).toBe(30)
  const empty = new Form(false, blank(schema))
  expect(empty.value('name')).toBe('')
  expect(empty.value('name', 'fallback')).toBe('fallback')
  expect(empty.has('agree')).toBe(false)
})

test('a form that was sent says what is wrong with it', () => {
  const schema: Schema = {
    name: { required: true },
    email: { type: 'email', required: true },
  }
  const form = new Form(true, check(schema, { name: '', email: 'nope' }))
  expect(form.ok).toBe(false)
  expect(form.invalid).toBe(true)
  expect(form.hasError('name')).toBe(true)
  expect(form.error('email')).toBe('Enter a valid email address')
  expect(form.error('other')).toBe('')
  expect(form.errorList()).toEqual([
    { field: 'name', message: 'Name is required' },
    { field: 'email', message: 'Enter a valid email address' },
  ])
  expect(form.value('email')).toBe('nope')

  const fine = new Form(
    true,
    check(schema, { name: 'Ana', email: 'ana@example.com' })
  )
  expect(fine.ok).toBe(true)
  expect(fine.invalid).toBe(false)
})
