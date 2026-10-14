/**
 * Per-runtime switches.
 *
 * PocketBase runs handlers inside a pool of long-lived goja runtimes, so module level
 * state lives as long as the runtime does and is shared by every request that runtime
 * serves (a runtime only ever serves one request at a time). That makes it the right
 * place for things we would otherwise have to re-read from Go on every call.
 */
export const runtime: {
  /** `undefined` until it is known; see `isDebug()` */
  debug: boolean | undefined
  /** Whether file system lookups and file contents may be memoized */
  cache: boolean
} = {
  debug: undefined,
  cache: false,
}
