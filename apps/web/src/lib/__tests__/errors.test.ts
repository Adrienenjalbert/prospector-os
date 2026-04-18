import { describe, it, expect } from 'vitest'
import { describeError, ensureNoError, wrapError } from '../errors'

/**
 * `wrapError` is the codebase-wide replacement for the
 * `throw new Error(\`...${err.message}\`)` pattern that scattered the
 * loss of `cause` chains across workflows + slice loaders. These
 * tests pin the contract so a refactor doesn't silently regress to
 * the old message-only pattern.
 */

describe('wrapError', () => {
  it('preserves the cause when given an Error', () => {
    const original = new Error('underlying')
    const wrapped = wrapError('top level', original)
    expect(wrapped.message).toBe('top level: underlying')
    expect(wrapped.cause).toBe(original)
  })

  it('coerces non-Error throws into an Error cause', () => {
    const wrapped = wrapError('top', { code: 'ENOENT' })
    expect(wrapped.message).toContain('top')
    expect(wrapped.cause).toBeInstanceOf(Error)
  })

  it('handles string causes', () => {
    const wrapped = wrapError('scope', 'plain string failure')
    expect(wrapped.message).toContain('plain string failure')
    expect(wrapped.cause).toBeInstanceOf(Error)
  })
})

describe('ensureNoError', () => {
  it('does nothing when error is null', () => {
    expect(() => ensureNoError(null, 'scope')).not.toThrow()
  })

  it('does nothing when error is undefined', () => {
    expect(() => ensureNoError(undefined, 'scope')).not.toThrow()
  })

  it('throws a wrapped error with the supplied scope as the message', () => {
    expect(() =>
      ensureNoError({ message: 'rls denied', code: '42501' }, 'companies query'),
    ).toThrowError(/companies query: rls denied/)
  })
})

describe('describeError', () => {
  it('returns Error.message for Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  it('returns the string itself for string', () => {
    expect(describeError('hello')).toBe('hello')
  })

  it('returns JSON for plain objects', () => {
    expect(describeError({ a: 1 })).toBe('{"a":1}')
  })

  it('falls back to String(...) for unstringifiable inputs', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(describeError(circular)).toBe('[object Object]')
  })
})
