/**
 * Cheap pre-check for `JSON.parse`: can this string possibly be valid JSON?
 *
 * Plain strings (HTML, query string values, cookie values...) are by far the common
 * case, and letting `JSON.parse` throw and catching the SyntaxError for each of them
 * is wasted work. A JSON text is a value that starts (after optional whitespace) with
 * `{`, `[`, `"`, `-`, a digit, or one of the literals `true`, `false` and `null`.
 */
export const couldBeJson = (s: string): boolean => {
  const n = s.length
  let i = 0
  while (i < n) {
    const c = s.charCodeAt(i)
    // JSON whitespace: space, tab, line feed, carriage return
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++
    } else {
      break
    }
  }
  if (i === n) return false
  const c = s.charCodeAt(i)
  return (
    c === 123 || // {
    c === 91 || // [
    c === 34 || // "
    c === 45 || // -
    (c >= 48 && c <= 57) || // 0-9
    c === 116 || // t
    c === 102 || // f
    c === 110 // n
  )
}

/**
 * Parses `value` as JSON, returning it untouched when it is not.
 */
export const tryParseJson = (value: string | undefined) => {
  if (!value) return value
  if (!couldBeJson(value)) return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
