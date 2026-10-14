/**
 * Template compilation.
 *
 * EJS builds the output of a template with `__output += chunk`. Strings are immutable
 * and goja copies the whole string on every concatenation, so rendering N chunks costs
 * O(N²): a 40KB page takes ~7ms to concatenate, a 380KB one more than half a second,
 * where collecting the chunks in an array and joining them once takes a few ms.
 *
 * `compileTemplate()` compiles with that change, leaving everything else about the
 * generated code (and so the line numbers in error messages) the way EJS makes it.
 */

const SERVER_BLOCK = /<script\s+server>([\s\S]*?)<\/script>/g
const JS_IDENTIFIER = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/

/**
 * `<script server>...</script>` is the same as `<% ... %>`
 */
export const withServerBlocks = (template: string) =>
  template.includes('server>')
    ? template.replaceAll(SERVER_BLOCK, '<% $1 %>')
    : template

/**
 * Compiles `template` with the output collected in an array. Falls back to
 * `ejs.compile()` for anything this does not know how to do: other versions of EJS,
 * or options that change how the generated code is laid out.
 */
export const compileTemplate = (
  ejs: any,
  template: string,
  options: Record<string, any>
): ((data: any) => string) => {
  const text = withServerBlocks(template)
  const Template = ejs.Template
  if (
    typeof Template !== 'function' ||
    typeof Template.prototype?.generateSource !== 'function' ||
    typeof Template.prototype?.compile !== 'function'
  ) {
    return ejs.compile(text, options)
  }

  const templ = new Template(text, { ...options })
  const opts = templ.opts
  if (
    !opts ||
    opts.client ||
    opts.strict ||
    opts.async ||
    opts.outputFunctionName ||
    (opts.destructuredLocals && opts.destructuredLocals.length) ||
    !JS_IDENTIFIER.test(opts.localsName)
  ) {
    return templ.compile()
  }

  templ.generateSource()

  // The same three lines EJS puts in front of the generated code, with the output
  // collected differently. `__output` is still declared for templates that use it
  // (anything added to it comes before the rest of the output).
  let header = opts.prepend
  header += '  var __output = "", __chunks = [];\n'
  header +=
    '  function __append(s) { if (s !== undefined && s !== null) __chunks.push("" + s) }\n'
  let footer = ''
  if (opts._with !== false) {
    header += '  with (' + opts.localsName + ' || {}) {\n'
    footer += '  }\n'
  }
  footer += '  return __output + __chunks.join("");\n'

  // compile() counts the lines in front of the generated code to report where an
  // error happened, from the options and not from what it ends up compiling
  opts.prepend = header
  templ.source = header + templ.source + footer
  return templ.compile()
}
