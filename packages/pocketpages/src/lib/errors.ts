const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a teapot",
  422: 'Unprocessable Entity',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

export const statusText = (status: number): string =>
  STATUS_TEXT[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error')

/**
 * The HTTP status a thrown value stands for.
 *
 * PocketBase's error classes (`BadRequestError`, `NotFoundError`, `ForbiddenError`,
 * `TooManyRequestsError`, `new ApiError(status, message)`...) are plain objects with a
 * `status`, not `Error` instances. Anything else that gets thrown, including the
 * errors of the PocketBase JS SDK, is an internal error.
 */
export const getErrorStatus = (error: unknown): number => {
  if (
    error !== null &&
    typeof error === 'object' &&
    !(error instanceof Error)
  ) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status >= 400 && status <= 599) {
      return Math.floor(status)
    }
  }
  return 500
}

/**
 * What to tell a developer about a thrown value
 */
export const describeError = (error: unknown): string => {
  if (
    error !== null &&
    typeof error === 'object' &&
    !(error instanceof Error)
  ) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return `${error}`
}

/**
 * Clients that ask for JSON and would not know what to do with a web page
 */
export const prefersJson = (accept: string): boolean => {
  if (!accept) return false
  const lower = accept.toLowerCase()
  return (
    (lower.indexOf('application/json') !== -1 ||
      lower.indexOf('+json') !== -1) &&
    lower.indexOf('text/html') === -1
  )
}
