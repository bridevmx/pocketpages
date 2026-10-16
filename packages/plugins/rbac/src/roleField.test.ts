import { expect, test } from 'bun:test'
import { roleFieldRisks } from './roleField'

const users = (createRule: any, updateRule: any, hasField = true) => ({
  name: 'users',
  hasField,
  createRule,
  updateRule,
})

test('the rules PocketBase starts with leave the role open to everybody', () => {
  const risks = roleFieldRisks(users('', 'id = @request.auth.id'), 'role')
  expect(risks).toHaveLength(2)
  expect(risks[0]).toContain('Anybody')
  expect(risks[0]).toContain('"role"')
  expect(risks[1]).toContain('Every user')
})

test('rules that only superusers pass are fine', () => {
  expect(roleFieldRisks(users(null, null), 'role')).toEqual([])
})

test('rules that say something about the field are fine', () => {
  expect(
    roleFieldRisks(
      users(
        '@request.body.role:isset = false',
        'id = @request.auth.id && @request.body.role:isset = false'
      ),
      'role'
    )
  ).toEqual([])
})

test('a rule about another field does not protect this one', () => {
  const risks = roleFieldRisks(
    users('@request.body.verified:isset = false', 'id = @request.auth.id'),
    'role'
  )
  expect(risks).toHaveLength(2)
})

test('each rule is judged by itself', () => {
  const risks = roleFieldRisks(
    users('@request.body.role:isset = false', 'id = @request.auth.id'),
    'role'
  )
  expect(risks).toHaveLength(1)
  expect(risks[0]).toContain('Every user')
})

test('a collection without the field has nothing to protect', () => {
  expect(
    roleFieldRisks(users('', 'id = @request.auth.id', false), 'role')
  ).toEqual([])
})

test('the field can have another name', () => {
  expect(roleFieldRisks(users('', null), 'level')[0]).toContain('"level"')
  expect(
    roleFieldRisks(users('@request.body.level:isset = false', null), 'level')
  ).toEqual([])
})
