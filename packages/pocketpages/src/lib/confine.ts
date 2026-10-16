/**
 * Whether `candidate` is `root` itself or something under it, so that `resolve()` and
 * `include()` can't be made to read a file outside the `pages` folder with a path full
 * of `..`. `$filepath.rel` is Go's, which never leaves `..` out when `candidate` is
 * not under `root`, on any platform.
 */
export const confine = (root: string, candidate: string): boolean => {
  if (candidate === root) return true
  const relative = $filepath.rel(root, candidate)
  return (
    relative !== '..' &&
    !relative.startsWith('../') &&
    !relative.startsWith('..\\')
  )
}
