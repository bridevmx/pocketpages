import { ValidationResult } from './schema'

/**
 * What `forms.parse()` gives back
 */
export class Form {
  /** Whether the visitor sent the form. A form that was not sent has nothing wrong with it. */
  readonly submitted: boolean
  /** The fields of the schema, as the types they asked for. Safe to save. */
  readonly values: Record<string, any>
  /** What was typed in, as text, to put back in the fields */
  readonly raw: Record<string, string | string[]>
  /** The first thing wrong with each field that has something wrong, by field */
  readonly errors: Record<string, string>

  constructor(submitted: boolean, result: ValidationResult) {
    this.submitted = submitted
    this.values = result.values
    this.raw = result.raw
    this.errors = result.errors
  }

  /** Sent, and nothing wrong with it */
  get ok(): boolean {
    return this.submitted && Object.keys(this.errors).length === 0
  }

  /** Sent, and something is wrong with it */
  get invalid(): boolean {
    return this.submitted && Object.keys(this.errors).length > 0
  }

  /** What is in a field, as text, for its `value` attribute. `fallback` if it is empty. */
  value(name: string, fallback = ''): string | string[] {
    const raw = this.raw[name]
    if (
      raw === undefined ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0)
    ) {
      return fallback
    }
    return raw
  }

  /** What is wrong with a field, `''` if nothing is */
  error(name: string): string {
    return this.errors[name] ?? ''
  }

  hasError(name: string): boolean {
    return name in this.errors
  }

  /** Every error, in the order of the schema: `[{ field, message }]` */
  errorList(): { field: string; message: string }[] {
    return Object.keys(this.errors).map((field) => ({
      field,
      message: this.errors[field]!,
    }))
  }

  /**
   * For checkboxes, radio buttons and options: whether the field holds `value`, or
   * anything at all if no value is given.
   */
  has(name: string, value?: string): boolean {
    const raw = this.raw[name]
    if (raw === undefined) return false
    const list = Array.isArray(raw) ? raw : [raw]
    if (value === undefined) {
      return list.some((item) => item !== '')
    }
    return list.indexOf(value) !== -1
  }
}
