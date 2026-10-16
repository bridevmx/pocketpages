import { expect, test } from 'bun:test'
import {
  describeError,
  getErrorStatus,
  prefersJson,
  statusText,
} from './errors'

// PocketBase's error classes are plain objects, not Error instances
const apiError = (status: number, message = '') => ({
  status,
  message,
  data: {},
})

test('PocketBase errors stand for their status', () => {
  expect(getErrorStatus(apiError(400))).toBe(400)
  expect(getErrorStatus(apiError(403))).toBe(403)
  expect(getErrorStatus(apiError(404))).toBe(404)
  expect(getErrorStatus(apiError(429))).toBe(429)
  expect(getErrorStatus(apiError(503))).toBe(503)
  expect(getErrorStatus(apiError(404.9))).toBe(404)
})

test('everything else is an internal error', () => {
  class WithStatus extends Error {
    status = 404
  }
  expect(getErrorStatus(new Error('boom'))).toBe(500)
  expect(getErrorStatus(new WithStatus('record not found'))).toBe(500)
  expect(getErrorStatus(apiError(200))).toBe(500)
  expect(getErrorStatus(apiError(302))).toBe(500)
  expect(getErrorStatus(apiError(999))).toBe(500)
  expect(getErrorStatus({ status: '404' })).toBe(500)
  expect(getErrorStatus('oops')).toBe(500)
  expect(getErrorStatus(null)).toBe(500)
  expect(getErrorStatus(undefined)).toBe(500)
  expect(getErrorStatus(404)).toBe(500)
})

test('errors are described by their message when they have one', () => {
  expect(describeError(apiError(404, 'No such post'))).toBe('No such post')
  expect(describeError(new Error('boom'))).toBe('Error: boom')
  expect(describeError('oops')).toBe('oops')
  expect(describeError(apiError(404, ''))).toBe('[object Object]')
})

test('statuses have a name', () => {
  expect(statusText(400)).toBe('Bad Request')
  expect(statusText(403)).toBe('Forbidden')
  expect(statusText(429)).toBe('Too Many Requests')
  expect(statusText(500)).toBe('Internal Server Error')
  expect(statusText(599)).toBe('Internal Server Error')
  expect(statusText(499)).toBe('Error')
})

test('clients that only want JSON are told apart from browsers', () => {
  expect(prefersJson('application/json')).toBe(true)
  expect(prefersJson('application/json, text/plain, */*')).toBe(true)
  expect(prefersJson('application/vnd.api+json')).toBe(true)
  expect(
    prefersJson('text/html,application/xhtml+xml,application/json;q=0.9')
  ).toBe(false)
  expect(prefersJson('*/*')).toBe(false)
  expect(prefersJson('')).toBe(false)
})
