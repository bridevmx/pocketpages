/**
 * What PocketBase's API rules let people do with the field that holds the roles.
 *
 * rbac trusts that field. PocketBase's own rules for a users collection let anybody
 * register and let every user edit their own record, so a `role` field that the rules do
 * not mention can be set to `admin` by the visitor, through the API, with one request.
 */

/** The part of a collection that this needs, so it can be tested without PocketBase */
export type RoleFieldCollection = {
  name: string
  hasField: boolean
  /** `null` means that only superusers can */
  createRule: string | null | undefined
  updateRule: string | null | undefined
}

const mentions = (rule: string, field: string) =>
  rule.indexOf(`@request.body.${field}`) !== -1

/**
 * What to warn about, `[]` when the field is protected. A rule is fine when it is `null`
 * (only superusers) or when it says something about `@request.body.<field>`, as in
 * `@request.body.role:isset = false`.
 */
export const roleFieldRisks = (
  collection: RoleFieldCollection,
  roleField: string
): string[] => {
  if (!collection.hasField) return []
  const risks: string[] = []
  const check = (
    what: string,
    rule: string | null | undefined,
    who: string
  ) => {
    if (rule === null || rule === undefined) return
    if (mentions(rule, roleField)) return
    risks.push(
      `${who} can set "${roleField}" when they ${what} a record of "${collection.name}" through PocketBase's API (its ${what === 'create' ? 'createRule' : 'updateRule'} says nothing about it). Add @request.body.${roleField}:isset = false to the rule.`
    )
  }
  check('create', collection.createRule, 'Anybody')
  check('update', collection.updateRule, 'Every user')
  return risks
}
