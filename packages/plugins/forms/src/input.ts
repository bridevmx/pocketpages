/**
 * What a form sent, as strings. PocketBase's own `formData()` turns `"1"` into `1` and
 * `"true"` into `true`, which is not what a text field that was filled in with those
 * should end up with.
 */
export type RawInput = Record<string, string[]>

const decode = (s: string) => {
  const spaced = s.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    // A stray % in what the client sent
    return spaced
  }
}

/** `tags[]` is how some forms say that `tags` has several values */
const normalizeKey = (key: string) =>
  key.length > 2 && key.endsWith('[]') ? key.slice(0, -2) : key

const add = (input: RawInput, key: string, value: string) => {
  const name = normalizeKey(key)
  const list = input[name]
  if (list) {
    list.push(value)
  } else {
    input[name] = [value]
  }
}

/**
 * `a=1&b=2&b=3`, as found in query strings and `application/x-www-form-urlencoded`
 * bodies
 */
export const parseUrlEncoded = (encoded: string): RawInput => {
  const input: RawInput = Object.create(null)
  if (!encoded) return input
  const pairs = encoded.split('&')
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq === -1) {
      add(input, decode(pair), '')
    } else {
      add(input, decode(pair.slice(0, eq)), decode(pair.slice(eq + 1)))
    }
  }
  return input
}

/**
 * A map of names to arrays of strings, which is what Go's `url.Values` and the
 * multipart form values look like from JavaScript
 */
export const fromValueMap = (
  map: Record<string, ArrayLike<string>>
): RawInput => {
  const input: RawInput = Object.create(null)
  const keys = Object.keys(map)
  for (let i = 0; i < keys.length; i++) {
    const list = map[keys[i]!]
    if (!list) continue
    for (let j = 0; j < list.length; j++) {
      add(input, keys[i]!, String(list[j]))
    }
  }
  return input
}

const stringifyJsonValue = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) {
    const items: string[] = []
    for (let i = 0; i < value.length; i++) {
      items.push(...stringifyJsonValue(value[i]))
    }
    return items
  }
  if (typeof value === 'object') return [JSON.stringify(value)]
  return [String(value)]
}

/**
 * A JSON body, so that it goes through the same checks as a form
 */
export const fromJson = (body: unknown): RawInput => {
  const input: RawInput = Object.create(null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return input
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  for (let i = 0; i < keys.length; i++) {
    const values = stringifyJsonValue(record[keys[i]!])
    if (values.length > 0) input[normalizeKey(keys[i]!)] = values
  }
  return input
}
