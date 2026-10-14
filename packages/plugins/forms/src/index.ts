import type {
  PagesRequest,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import { Form } from './form'
import { fromJson, fromValueMap, parseUrlEncoded, RawInput } from './input'
import { blank, FileLike, Messages, Schema, validate } from './schema'

export { Form } from './form'
export type {
  FieldSpec,
  FieldType,
  FileLike,
  Messages,
  Rule,
  Schema,
} from './schema'

export type FormsOptions = PluginOptionsBase & {
  /**
   * Let a form that can only `POST` ask for another method with a hidden field
   * (`<input type="hidden" name="_method" value="DELETE">`). On unless told otherwise.
   */
  methodOverride: boolean
  /** The field that asks for it, `_method` unless told otherwise */
  methodField: string
  /** The status invalid forms are answered with. Left alone unless you say. */
  invalidStatus: number
  /** What to say when something is wrong, by rule, in place of the default messages */
  messages: Messages
}

export type ParseOptions = {
  /**
   * Where the fields come from: the body of the request (`body`), its query string
   * (`query`), or the one that fits the method (`auto`, the default: the body for
   * anything that changes something, the query string for `GET`).
   */
  source?: 'auto' | 'body' | 'query'
  /** What the fields hold when the form has not been sent yet */
  defaults?: Record<string, unknown>
  /** Messages for this form, over those of the plugin */
  messages?: Messages
  /** The status to answer with if the form is invalid, over the plugin's `invalidStatus` */
  status?: number
}

export type FormsApi = {
  /**
   * Reads the fields of `schema` from the request, converts them to the types they
   * ask for and checks them
   */
  parse: (schema: Schema, options?: ParseOptions) => Form
  /** A form that was not sent, to show for the first time */
  blank: (schema: Schema, defaults?: Record<string, unknown>) => Form
}

const VALID_KEYS = [
  'debug',
  'methodOverride',
  'methodField',
  'invalidStatus',
  'messages',
]

/** The most of a multipart body that is kept in memory, the rest goes to disk */
const MAX_MULTIPART_MEMORY = 32 << 20

type Cached = { body?: RawInput; query?: RawInput }

const cacheOf = (request: PagesRequest): Cached => {
  const state = request.state
  return state.forms ?? (state.forms = {})
}

const contentTypeOf = (request: PagesRequest) =>
  request.header('Content-Type').toLowerCase()

const isForm = (contentType: string) =>
  contentType.startsWith('application/x-www-form-urlencoded') ||
  contentType.startsWith('multipart/form-data')

/**
 * What the body of the request holds, as the text that was sent
 */
const readBody = (request: PagesRequest): RawInput => {
  const cache = cacheOf(request)
  if (cache.body) return cache.body
  const contentType = contentTypeOf(request)
  const raw = request.event.request!
  let input: RawInput
  if (contentType.startsWith('multipart/form-data')) {
    raw.parseMultipartForm(MAX_MULTIPART_MEMORY)
    input = fromValueMap(raw.multipartForm!.value as any)
  } else if (
    contentType.startsWith('application/x-www-form-urlencoded') &&
    // Go only reads the body of these
    ['POST', 'PUT', 'PATCH'].indexOf(raw.method) !== -1
  ) {
    raw.parseForm()
    input = parseUrlEncoded(raw.postForm!.encode())
  } else {
    // JSON, and whatever else PocketBase knows how to read
    input = fromJson(request.body())
  }
  cache.body = input
  return input
}

const readQuery = (request: PagesRequest): RawInput => {
  const cache = cacheOf(request)
  if (!cache.query) {
    cache.query = parseUrlEncoded(request.event.request!.url!.rawQuery)
  }
  return cache.query
}

const readFiles = (request: PagesRequest, schema: Schema) => {
  const files: Record<string, FileLike[]> = {}
  const names = Object.keys(schema)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    if (schema[name]!.type !== 'file') continue
    try {
      files[name] = Array.from(request.event.findUploadedFiles(name)) as any
    } catch {
      // No file was sent under that name
      files[name] = []
    }
  }
  return files
}

const formsPluginFactory: PluginFactory<FormsOptions> = (config, extra) => {
  const { dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-forms: unknown option '${key}'`)
    }
  })

  const options = {
    methodOverride: true,
    methodField: '_method',
    invalidStatus: undefined as number | undefined,
    messages: {} as Messages,
    ...extra,
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.methodField)) {
    throw new Error(
      `pocketpages-plugin-forms: invalid methodField ${JSON.stringify(options.methodField)}`
    )
  }

  return {
    name: 'forms',

    onRequest: ({ request, route }) => {
      if (
        !options.methodOverride ||
        request.method !== 'POST' ||
        !route ||
        route.isStatic ||
        !isForm(contentTypeOf(request))
      ) {
        return
      }
      let wanted: string | undefined
      try {
        wanted = readBody(request)[options.methodField]?.[0]?.toUpperCase()
      } catch (e) {
        // The page will find out when it reads the form
        dbg(`could not read the form to look for ${options.methodField}: ${e}`)
        return
      }
      if (wanted === 'PUT' || wanted === 'PATCH' || wanted === 'DELETE') {
        dbg(
          `${request.pathname}: ${options.methodField} turns POST into ${wanted}`
        )
        request.method = wanted
      }
    },

    onExtendContextApi: ({ api }) => {
      const { request, response } = api

      const forms: FormsApi = {
        blank: (schema, defaults) => new Form(false, blank(schema, defaults)),

        parse: (schema, parseOptions = {}) => {
          const source = parseOptions.source ?? 'auto'
          const method = request.method
          const fromBody =
            source === 'body' ||
            (source === 'auto' && method !== 'GET' && method !== 'HEAD')

          let input: RawInput
          try {
            input = fromBody ? readBody(request) : readQuery(request)
          } catch (e) {
            dbg(`could not read the form: ${e}`)
            throw new BadRequestError('The form could not be read')
          }

          // A form of the query string is only sent if something in it is a field
          const submitted =
            fromBody || Object.keys(schema).some((name) => name in input)
          if (!submitted) {
            return new Form(false, blank(schema, parseOptions.defaults))
          }

          const result = validate(
            schema,
            input,
            fromBody ? readFiles(request, schema) : {},
            { messages: { ...options.messages, ...parseOptions.messages } }
          )
          const form = new Form(true, result)
          const status = parseOptions.status ?? options.invalidStatus
          if (form.invalid && status !== undefined) {
            response.status(status)
          }
          return form
        },
      }
      api.forms = forms
    },
  }
}

export default formsPluginFactory
