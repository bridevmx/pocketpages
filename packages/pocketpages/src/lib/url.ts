/**
 * Extracts the path of an origin-form request target (`/some/path?query#hash`)
 * without running it through `url-parse`.
 *
 * It gives exactly what `url-parse` reports as `pathname` for these inputs, and
 * returns `undefined` for anything else (absolute URLs, `//host/...`, `*`...) so the
 * caller can fall back to the full parser.
 */
export const quickPathname = (raw: string): string | undefined => {
  if (raw.charCodeAt(0) !== 47 /* / */) return undefined
  const second = raw.charCodeAt(1)
  // `//` and `/\` look like a protocol relative URL to url-parse
  if (second === 47 /* / */ || second === 92 /* \ */) return undefined

  let end = raw.length
  const query = raw.indexOf('?')
  if (query !== -1) end = query
  const hash = raw.indexOf('#')
  if (hash !== -1 && hash < end) end = hash
  return end === raw.length ? raw : raw.slice(0, end)
}
