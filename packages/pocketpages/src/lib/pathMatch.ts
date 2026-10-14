const SPECIAL = /[.+?^${}()|[\]\\]/g

/**
 * Turns a path pattern into a regular expression.
 *
 * - `*` stands for anything within one segment
 * - `**` stands for any number of segments, none included: `/blog/**` matches `/blog`,
 *   `/blog/` and `/blog/2024/a-post`
 *
 * Everything else must match as it is written, case included.
 */
const compile = (pattern: string): RegExp => {
  let source = ''
  const segments = pattern.split('/')
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const last = i === segments.length - 1
    if (segment === '**') {
      // Takes the slash before it along, so that it can match nothing at all
      source += last ? '(?:/.*)?' : '(?:/[^/]+)*'
      continue
    }
    if (i > 0) source += '/'
    source +=
      segment === '*'
        ? '[^/]+'
        : segment.replace(SPECIAL, '\\$&').replace(/\*/g, '[^/]*')
  }
  return new RegExp(`^${source}/?$`)
}

/**
 * Makes a function that tells whether a URL path matches any of the patterns. Meant to
 * be made once, when a plugin is set up.
 */
export const pathMatcher = (
  patterns: string | string[]
): ((pathname: string) => boolean) => {
  const list = typeof patterns === 'string' ? [patterns] : patterns
  const expressions = list.map(compile)
  if (expressions.length === 1) {
    const only = expressions[0]!
    return (pathname) => only.test(pathname)
  }
  return (pathname) => {
    for (let i = 0; i < expressions.length; i++) {
      if (expressions[i]!.test(pathname)) return true
    }
    return false
  }
}
