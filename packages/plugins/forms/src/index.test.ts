import { expect, test } from 'bun:test'

const g = globalThis as any
g.BadRequestError = class {
  status = 400
  constructor(public message = '') {}
}

const { default: factory } = await import('./index')

const make = (options: Record<string, any> = {}) =>
  factory({ globalApi: {}, dbg: () => {} } as any, { debug: false, ...options })

type Init = {
  method?: string
  contentType?: string
  /** What Go finds in the body, for forms */
  body?: string
  multipart?: Record<string, string[]>
  json?: unknown
  query?: string
  files?: Record<string, { originalName: string; size: number }[]>
  route?: any
}

const exchange = (init: Init = {}) => {
  const calls = { parseForm: 0, parseMultipartForm: 0 }
  const raw = {
    method: init.method ?? 'POST',
    url: { rawQuery: init.query ?? '' },
    parseForm: () => void calls.parseForm++,
    postForm: { encode: () => init.body ?? '' },
    parseMultipartForm: () => void calls.parseMultipartForm++,
    multipartForm: { value: init.multipart ?? {} },
  }
  const status: number[] = []
  const request: any = {
    method: init.method ?? 'POST',
    pathname: '/x',
    state: {},
    header: (name: string) =>
      name.toLowerCase() === 'content-type' ? (init.contentType ?? '') : '',
    body: () => init.json ?? {},
    event: {
      request: raw,
      findUploadedFiles: (name: string) => {
        if (!init.files?.[name]) throw new Error('http: no such file')
        return init.files[name]
      },
    },
  }
  const response: any = {
    status: (code?: number) =>
      code === undefined ? 200 : void status.push(code),
  }
  const route = 'route' in init ? init.route : { isStatic: false }
  return { request, response, route, calls, status }
}

const run = (plugin: any, x: ReturnType<typeof exchange>) => {
  plugin.onRequest({ request: x.request, response: x.response, route: x.route })
  const api: any = { request: x.request, response: x.response }
  plugin.onExtendContextApi({ api, route: x.route })
  return api
}

const FORM = 'application/x-www-form-urlencoded'
const MULTIPART = 'multipart/form-data; boundary=x'

test('unknown options are refused', () => {
  expect(() => make({ methodOverride: true, nope: 1 })).toThrow(
    "unknown option 'nope'"
  )
  expect(() => make({ methodField: 'bad name' })).toThrow('invalid methodField')
})

test('a form that says what method it wants gets it', () => {
  const plugin = make()
  for (const wanted of ['DELETE', 'put', 'Patch']) {
    const x = exchange({ contentType: FORM, body: `_method=${wanted}&a=1` })
    run(plugin, x)
    expect(x.request.method).toBe(wanted.toUpperCase())
  }
})

test('only some methods can be asked for, and only by POST forms of pages', () => {
  const plugin = make()
  const asked = (init: Init) => {
    const x = exchange({ body: '_method=DELETE', contentType: FORM, ...init })
    plugin.onRequest!({
      request: x.request,
      response: x.response,
      route: x.route,
    })
    return x.request.method
  }
  expect(asked({})).toBe('DELETE')
  expect(asked({ body: '_method=GET' })).toBe('POST')
  expect(asked({ body: '_method=TRACE' })).toBe('POST')
  expect(asked({ body: '_method=' })).toBe('POST')
  expect(asked({ method: 'GET' })).toBe('GET')
  expect(asked({ method: 'PUT' })).toBe('PUT')
  expect(asked({ contentType: 'application/json' })).toBe('POST')
  expect(asked({ route: null })).toBe('POST')
  expect(asked({ route: { isStatic: true } })).toBe('POST')
  expect(
    asked({ contentType: MULTIPART, multipart: { _method: ['PATCH'] } })
  ).toBe('PATCH')
})

test('the field and the feature can be changed', () => {
  const x = exchange({ contentType: FORM, body: 'verb=DELETE' })
  make({ methodField: 'verb' }).onRequest!({
    request: x.request,
    response: x.response,
    route: x.route,
  })
  expect(x.request.method).toBe('DELETE')

  const y = exchange({ contentType: FORM, body: '_method=DELETE' })
  make({ methodOverride: false }).onRequest!({
    request: y.request,
    response: y.response,
    route: y.route,
  })
  expect(y.request.method).toBe('POST')
})

test('the body is only read once, however many times it is asked for', () => {
  const plugin = make()
  const x = exchange({ contentType: FORM, body: '_method=PUT&name=Ana' })
  const api = run(plugin, x)
  api.forms.parse({ name: {} })
  api.forms.parse({ name: {} })
  expect(x.calls.parseForm).toBe(1)
})

test('forms are read from what was sent', () => {
  const api = run(
    make(),
    exchange({
      contentType: FORM,
      body: 'name=+Ana+&zip=01234&tags=a&tags=b&n=7&_csrf=x',
    })
  )
  const form = api.forms.parse({
    name: { required: true },
    zip: {},
    tags: { type: 'array' },
    n: { type: 'int' },
  })
  expect(form.ok).toBe(true)
  expect(form.submitted).toBe(true)
  expect(form.values).toEqual({
    name: 'Ana',
    zip: '01234',
    tags: ['a', 'b'],
    n: 7,
  })
})

test('multipart forms are read, and so are their files', () => {
  const file = { originalName: 'me.png', size: 10 }
  const api = run(
    make(),
    exchange({
      contentType: MULTIPART,
      multipart: { name: ['Ana'], tags: ['a', 'b'] },
      files: { avatar: [file] },
    })
  )
  const form = api.forms.parse({
    name: {},
    tags: { type: 'array' },
    avatar: { type: 'file', required: true },
  })
  expect(form.ok).toBe(true)
  expect(form.values.avatar).toBe(file)
  expect(form.values.tags).toEqual(['a', 'b'])
  const missing = run(
    make(),
    exchange({ contentType: MULTIPART, multipart: { name: ['Ana'] } })
  )
  expect(
    missing.forms.parse({ avatar: { type: 'file', required: true } }).errors
  ).toEqual({ avatar: 'Avatar is required' })
})

test('JSON bodies are read like forms', () => {
  const api = run(
    make(),
    exchange({
      contentType: 'application/json',
      json: { name: 'Ana', age: 30, ok: true, tags: ['a'] },
    })
  )
  const form = api.forms.parse({
    name: {},
    age: { type: 'int' },
    ok: { type: 'boolean' },
    tags: { type: 'array' },
  })
  expect(form.values).toEqual({ name: 'Ana', age: 30, ok: true, tags: ['a'] })
})

test('real DELETE requests are read through PocketBase', () => {
  const api = run(
    make(),
    exchange({ method: 'DELETE', contentType: FORM, json: { confirm: 'yes' } })
  )
  expect(api.forms.parse({ confirm: {} }).values).toEqual({ confirm: 'yes' })
})

test('forms of the query string are only sent when a field is in it', () => {
  const none = run(make(), exchange({ method: 'GET', query: 'page=2' }))
  const form = none.forms.parse(
    { q: { required: true } },
    { defaults: { q: 'start' } }
  )
  expect(form.submitted).toBe(false)
  expect(form.ok).toBe(false)
  expect(form.errors).toEqual({})
  expect(form.value('q')).toBe('start')

  const sent = run(
    make(),
    exchange({ method: 'GET', query: 'q=hello+world&page=2' })
  )
  const found = sent.forms.parse({ q: { required: true } })
  expect(found.ok).toBe(true)
  expect(found.values.q).toBe('hello world')

  const empty = run(make(), exchange({ method: 'GET', query: 'q=' }))
  expect(empty.forms.parse({ q: { required: true } }).errors).toEqual({
    q: 'Q is required',
  })
})

test('the source can be chosen', () => {
  const api = run(
    make(),
    exchange({
      method: 'POST',
      contentType: FORM,
      body: 'a=body',
      query: 'a=query',
    })
  )
  expect(api.forms.parse({ a: {} }).values.a).toBe('body')
  expect(api.forms.parse({ a: {} }, { source: 'query' }).values.a).toBe('query')
  const get = run(make(), exchange({ method: 'GET', query: 'a=query' }))
  expect(get.forms.parse({ a: {} }, { source: 'auto' }).values.a).toBe('query')
})

test('invalid forms can change the status of the page', () => {
  const invalid = { name: { required: true } }
  const x = exchange({ contentType: FORM, body: 'name=' })
  run(make({ invalidStatus: 422 }), x).forms.parse(invalid)
  expect(x.status).toEqual([422])

  const y = exchange({ contentType: FORM, body: 'name=' })
  run(make(), y).forms.parse(invalid)
  expect(y.status).toEqual([])

  const z = exchange({ contentType: FORM, body: 'name=' })
  run(make({ invalidStatus: 422 }), z).forms.parse(invalid, { status: 400 })
  expect(z.status).toEqual([400])

  const valid = exchange({ contentType: FORM, body: 'name=Ana' })
  run(make({ invalidStatus: 422 }), valid).forms.parse(invalid)
  expect(valid.status).toEqual([])
})

test('messages come from the plugin, then from the form', () => {
  const x = exchange({ contentType: FORM, body: '' })
  const api = run(make({ messages: { required: 'Falta {label}' } }), x)
  expect(api.forms.parse({ name: { required: true } }).errors.name).toBe(
    'Falta Name'
  )
  expect(
    api.forms.parse(
      { name: { required: true } },
      { messages: { required: 'Manque {label}' } }
    ).errors.name
  ).toBe('Manque Name')
})

test('forms that cannot be read are bad requests', () => {
  const x = exchange({ contentType: FORM, body: 'a=1' })
  x.request.event.request.parseForm = () => {
    throw new Error('body too large')
  }
  const api = run(make(), x)
  let error: any
  try {
    api.forms.parse({ a: {} })
  } catch (e) {
    error = e
  }
  expect(error?.status).toBe(400)
})

test('blank forms start from defaults', () => {
  const api = run(make(), exchange({ method: 'GET' }))
  const form = api.forms.blank(
    { name: {}, age: { type: 'int' } },
    { name: 'Ana', age: 3 }
  )
  expect(form.submitted).toBe(false)
  expect(form.value('name')).toBe('Ana')
  expect(form.values.age).toBe(3)
})
