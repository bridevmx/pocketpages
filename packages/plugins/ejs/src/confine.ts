import { path } from 'pocketbase-node'

/**
 * Whether `candidate` is `root` itself or something under it, the same question
 * `pocketpages`'s own `resolve()`/`include()` ask (see its `confine()`), asked here with
 * Node's `path` because this plugin already uses it rather than `$filepath`. A plain
 * `candidate.startsWith(root)` is not this check: "pages" is a text prefix of a sibling
 * directory named "pages-backup" too, and that sibling is not inside `pages`.
 */
export const confine = (root: string, candidate: string): boolean => {
  if (candidate === root) return true
  const relative = path.relative(root, candidate)
  return (
    relative !== '..' &&
    !relative.startsWith('../') &&
    !relative.startsWith('..\\')
  )
}
