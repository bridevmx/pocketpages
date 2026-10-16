import { RawInput } from './input'

export type FieldType =
  | 'string'
  | 'email'
  | 'url'
  | 'int'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'array'
  | 'file'

export type FileLike = {
  name?: string
  originalName: string
  size: number
}

export type Rule =
  | 'required'
  | 'email'
  | 'url'
  | 'int'
  | 'number'
  | 'date'
  | 'datetime'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'pattern'
  | 'oneOf'
  | 'match'
  | 'minItems'
  | 'maxItems'
  | 'fileSize'
  | 'fileType'
  | 'custom'

export type FieldSpec = {
  /** What the field holds, `string` unless told otherwise */
  type?: FieldType
  /** What the field is called in messages, taken from its name unless told */
  label?: string
  required?: boolean
  /** Used when the field is left empty, instead of the empty value of its type */
  default?: unknown
  /** Strings lose the spaces around them, unless this is `false` */
  trim?: boolean
  /** Emails are lower case, unless this is `false` */
  lowercase?: boolean
  /** Strings: the fewest characters */
  minLength?: number
  /** Strings: the most characters */
  maxLength?: number
  /**
   * The fewest: characters for strings, the value for numbers, items for arrays
   */
  min?: number | string
  /**
   * The most: characters for strings, the value for numbers, items for arrays
   */
  max?: number | string
  /** A regular expression the value has to match (the source, without slashes) */
  pattern?: string
  /** Flags of the pattern, `i` for instance */
  patternFlags?: string
  /** The values that are allowed. For arrays, each item has to be one of them. */
  oneOf?: unknown[]
  /** Arrays: what the items are, `string` unless told otherwise */
  of?: Exclude<FieldType, 'array' | 'file' | 'boolean'>
  /** Another field that has to hold the same value, to confirm a password */
  match?: string
  /** Files: the most bytes */
  maxSize?: number
  /** Files: the extensions that are allowed, `['.png', '.jpg']` */
  accept?: string[]
  /** Files: more than one can be uploaded */
  multiple?: boolean
  /** What to say, by rule, for this field. `{label}`, `{min}` and `{max}` are filled in. */
  messages?: Partial<Record<Rule, string>>
  /**
   * Your own check. Gets the value and all of the values, returns the message to show
   * if something is wrong.
   */
  validate?: (
    value: any,
    values: Record<string, any>
  ) => string | false | null | undefined | void
}

export type Schema = Record<string, FieldSpec>

export type Messages = Partial<Record<Rule, string>>

export const DEFAULT_MESSAGES: Record<Rule, string> = {
  required: '{label} is required',
  email: 'Enter a valid email address',
  url: 'Enter a valid URL',
  int: '{label} must be a whole number',
  number: '{label} must be a number',
  date: 'Enter a valid date',
  datetime: 'Enter a valid date and time',
  minLength: '{label} must be at least {min} characters',
  maxLength: '{label} must be at most {max} characters',
  min: '{label} must be at least {min}',
  max: '{label} must be at most {max}',
  pattern: '{label} is not in the right format',
  oneOf: '{label} is not one of the options',
  match: '{label} does not match',
  minItems: 'Choose at least {min}',
  maxItems: 'Choose at most {max}',
  fileSize: '{label} must be smaller than {max}',
  fileType: '{label} must be one of: {accept}',
  custom: '{label} is not valid',
}

export type ValidationResult = {
  /** The coerced values of the fields of the schema */
  values: Record<string, any>
  /** What was typed in, to show again */
  raw: Record<string, string | string[]>
  /** The first thing wrong with each field that has something wrong */
  errors: Record<string, string>
}

export type ValidateOptions = {
  messages?: Messages
}

/** `first_name` and `firstName` are "First name" */
export const humanize = (name: string): string => {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`
  }
  return `${bytes} bytes`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i
const INT = /^[+-]?\d+$/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const TRUE_VALUES = ['on', 'true', '1', 'yes', 'y']

const isRealDate = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1) return false
  const days = [31, 28, 29, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const max = month === 2 ? (leap ? 29 : 28) : days[month - 1]!
  return day <= max
}

const codePoints = (s: string) => Array.from(s).length

type Failure = { rule: Rule; params?: Record<string, string> }

/**
 * Turns one string into the type a field asks for. Returns the failure when it is not
 * of that type.
 */
const coerceScalar = (
  type: Exclude<FieldType, 'array' | 'file' | 'boolean'>,
  text: string,
  spec: FieldSpec
): { value: unknown } | Failure => {
  switch (type) {
    case 'string':
      return { value: text }
    case 'email': {
      if (text.length > 254 || !EMAIL.test(text)) return { rule: 'email' }
      return { value: spec.lowercase === false ? text : text.toLowerCase() }
    }
    case 'url':
      return URL_PATTERN.test(text) ? { value: text } : { rule: 'url' }
    case 'int': {
      if (!INT.test(text)) return { rule: 'int' }
      const n = Number(text)
      return Number.isSafeInteger(n) ? { value: n } : { rule: 'int' }
    }
    case 'number': {
      if (!NUMBER.test(text)) return { rule: 'number' }
      const n = Number(text)
      return Number.isFinite(n) ? { value: n } : { rule: 'number' }
    }
    case 'date': {
      const m = DATE.exec(text)
      if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return { rule: 'date' }
      }
      return { value: text }
    }
    case 'datetime': {
      const m = DATETIME.exec(text)
      if (!m) return { rule: 'datetime' }
      const [year, month, day] = m[1]!.split('-').map(Number)
      const hour = Number(m[2])
      const minute = Number(m[3])
      const second = m[4] ? Number(m[4]) : 0
      if (
        !isRealDate(year!, month!, day!) ||
        hour > 23 ||
        minute > 59 ||
        second > 59
      ) {
        return { rule: 'datetime' }
      }
      return {
        value: `${m[1]} ${m[2]}:${m[3]}:${String(second).padStart(2, '0')}`,
      }
    }
  }
}

const emptyValue = (spec: FieldSpec): unknown => {
  if (spec.default !== undefined) return spec.default
  switch (spec.type ?? 'string') {
    case 'int':
    case 'number':
      return null
    case 'boolean':
      return false
    case 'array':
      return []
    case 'file':
      return spec.multiple ? [] : null
    default:
      return ''
  }
}

/** Checks a scalar against the rules that go with its type */
const checkScalar = (
  type: Exclude<FieldType, 'array' | 'file' | 'boolean'>,
  value: unknown,
  spec: FieldSpec
): Failure | undefined => {
  if (type === 'int' || type === 'number') {
    const n = value as number
    if (typeof spec.min === 'number' && n < spec.min) {
      return { rule: 'min', params: { min: String(spec.min) } }
    }
    if (typeof spec.max === 'number' && n > spec.max) {
      return { rule: 'max', params: { max: String(spec.max) } }
    }
  } else if (type === 'date' || type === 'datetime') {
    const s = value as string
    if (typeof spec.min === 'string' && s < spec.min) {
      return { rule: 'min', params: { min: spec.min } }
    }
    if (typeof spec.max === 'string' && s > spec.max) {
      return { rule: 'max', params: { max: spec.max } }
    }
  } else {
    const length = codePoints(value as string)
    const min =
      spec.minLength ?? (typeof spec.min === 'number' ? spec.min : undefined)
    const max =
      spec.maxLength ?? (typeof spec.max === 'number' ? spec.max : undefined)
    if (min !== undefined && length < min) {
      return { rule: 'minLength', params: { min: String(min) } }
    }
    if (max !== undefined && length > max) {
      return { rule: 'maxLength', params: { max: String(max) } }
    }
  }
  if (spec.pattern !== undefined) {
    if (!new RegExp(spec.pattern, spec.patternFlags).test(String(value))) {
      return { rule: 'pattern' }
    }
  }
  if (spec.oneOf && spec.oneOf.indexOf(value) === -1) {
    return { rule: 'oneOf' }
  }
  return undefined
}

const fill = (template: string, params: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in params ? params[key]! : whole
  )

/**
 * Reads the fields of `schema` out of `input` (and `files`), turns them into the types
 * the schema asks for, and says what is wrong with them.
 *
 * Fields that are not in the schema are left out of the result, so that nothing the
 * client invents ends up in a record.
 */
export const validate = (
  schema: Schema,
  input: RawInput,
  files: Record<string, FileLike[]>,
  options: ValidateOptions = {}
): ValidationResult => {
  const values: Record<string, any> = {}
  const raw: Record<string, string | string[]> = {}
  const errors: Record<string, string> = {}
  const names = Object.keys(schema)

  const messageFor = (name: string, failure: Failure, spec: FieldSpec) => {
    const template =
      spec.messages?.[failure.rule] ??
      options.messages?.[failure.rule] ??
      DEFAULT_MESSAGES[failure.rule]
    const params: Record<string, string> = {
      label: spec.label ?? humanize(name),
      accept: (spec.accept ?? []).join(', '),
      ...failure.params,
    }
    return fill(template, params)
  }

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const spec = schema[name]!
    const type = spec.type ?? 'string'
    const fail = (failure: Failure) => {
      if (!(name in errors)) errors[name] = messageFor(name, failure, spec)
    }

    const sent = input[name] ?? []

    // --- files
    if (type === 'file') {
      const uploaded = files[name] ?? []
      raw[name] = uploaded.map((file) => file.originalName)
      if (uploaded.length === 0) {
        values[name] = emptyValue(spec)
        if (spec.required && spec.default === undefined)
          fail({ rule: 'required' })
        continue
      }
      let failed = false
      for (let j = 0; j < uploaded.length && !failed; j++) {
        const file = uploaded[j]!
        if (spec.maxSize !== undefined && file.size > spec.maxSize) {
          fail({ rule: 'fileSize', params: { max: formatBytes(spec.maxSize) } })
          failed = true
        } else if (spec.accept) {
          const dot = file.originalName.lastIndexOf('.')
          const extension =
            dot === -1 ? '' : file.originalName.slice(dot).toLowerCase()
          if (!spec.accept.some((a) => a.toLowerCase() === extension)) {
            fail({ rule: 'fileType' })
            failed = true
          }
        }
      }
      if (!failed && !spec.multiple && uploaded.length > 1) {
        fail({ rule: 'maxItems', params: { max: '1' } })
        failed = true
      }
      values[name] = spec.multiple ? uploaded : uploaded[0]
      continue
    }

    // --- arrays
    if (type === 'array') {
      const trim = spec.trim !== false
      const items = sent
        .map((item) => (trim ? item.trim() : item))
        .filter((item) => item !== '')
      raw[name] = sent
      const itemType = spec.of ?? 'string'
      const coerced: unknown[] = []
      let failed = false
      for (let j = 0; j < items.length && !failed; j++) {
        const result = coerceScalar(itemType, items[j]!, spec)
        if ('rule' in result) {
          fail(result)
          failed = true
          break
        }
        if (spec.oneOf && spec.oneOf.indexOf(result.value) === -1) {
          fail({ rule: 'oneOf' })
          failed = true
          break
        }
        coerced.push(result.value)
      }
      if (!failed) {
        if (coerced.length === 0 && spec.default !== undefined) {
          values[name] = spec.default
        } else {
          values[name] = coerced
        }
        const empty = coerced.length === 0
        const min =
          typeof spec.min === 'number'
            ? spec.min
            : spec.required && spec.default === undefined
              ? 1
              : 0
        if (empty && spec.default !== undefined) {
          // Left empty, so it is the default
        } else if (coerced.length < min) {
          fail(
            spec.required && empty
              ? { rule: 'required' }
              : { rule: 'minItems', params: { min: String(min) } }
          )
        } else if (typeof spec.max === 'number' && coerced.length > spec.max) {
          fail({ rule: 'maxItems', params: { max: String(spec.max) } })
        }
      } else {
        values[name] = []
      }
      continue
    }

    // --- one value: the last one wins, like the browser does with a hidden field in
    // front of a checkbox
    const last = sent.length > 0 ? sent[sent.length - 1]! : undefined
    const text =
      last === undefined ? undefined : spec.trim === false ? last : last.trim()
    raw[name] = last === undefined ? '' : last

    if (type === 'boolean') {
      const on =
        text !== undefined && TRUE_VALUES.indexOf(text.toLowerCase()) !== -1
      values[name] = on
      if (!on && spec.required) fail({ rule: 'required' })
      continue
    }

    if (text === undefined || text === '') {
      values[name] = emptyValue(spec)
      if (spec.required && spec.default === undefined)
        fail({ rule: 'required' })
      continue
    }

    const result = coerceScalar(type, text, spec)
    if ('rule' in result) {
      values[name] = emptyValue(spec)
      fail(result)
      continue
    }
    values[name] = result.value
    const broken = checkScalar(type, result.value, spec)
    if (broken) fail(broken)
  }

  // Checks that look at other fields wait until all of them are in
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const spec = schema[name]!
    if (name in errors) continue
    const fail = (failure: Failure) => {
      errors[name] = messageFor(name, failure, spec)
    }
    if (spec.match !== undefined) {
      const other = raw[spec.match]
      const mine = raw[name]
      const same =
        typeof mine === 'string' && typeof other === 'string' && mine === other
      if (!same) {
        fail({ rule: 'match' })
        continue
      }
    }
    if (spec.validate) {
      const message = spec.validate(values[name], values)
      if (message) {
        errors[name] = String(message)
      }
    }
  }

  return { values, raw, errors }
}

const toRaw = (value: unknown): string | string[] => {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((item) => String(item))
  return String(value)
}

/**
 * A form nobody has sent yet: what each field starts with, and nothing wrong with any
 * of them
 */
export const blank = (
  schema: Schema,
  defaults: Record<string, unknown> = {}
): ValidationResult => {
  const values: Record<string, any> = {}
  const raw: Record<string, string | string[]> = {}
  const names = Object.keys(schema)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const spec = schema[name]!
    const start = name in defaults ? defaults[name] : emptyValue(spec)
    values[name] = start
    const type = spec.type ?? 'string'
    raw[name] =
      type === 'file'
        ? []
        : type === 'boolean'
          ? start
            ? 'on'
            : ''
          : toRaw(start)
  }
  return { values, raw, errors: {} }
}
