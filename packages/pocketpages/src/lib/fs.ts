/**
 * Cheap file system helpers for the PocketBase JSVM (goja).
 *
 * `pocketbase-node`'s `fs.readFileSync` turns the byte array returned by `$os.readFile`
 * into a string one character at a time in JS (~5µs per byte: ~30ms for a 6KB file and
 * ~9s for a 200KB one), and its `existsSync` makes several Go calls plus a MIME sniff.
 * The helpers below do the same job in a single Go call.
 */

/**
 * Reads a UTF-8 file. The bytes are converted to a string on the Go side.
 */
export const readText = (path: string): string => toString($os.readFile(path))

export const pathExists = (path: string): boolean => {
  try {
    $filesystem.fileFromPath(path)
    return true
  } catch {
    return false
  }
}

export const isDir = (path: string): boolean => {
  try {
    $os.readDir(path)
    return true
  } catch {
    return false
  }
}

export const isFile = (path: string): boolean =>
  pathExists(path) && !isDir(path)
