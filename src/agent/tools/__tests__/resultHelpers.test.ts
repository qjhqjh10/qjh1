import { describe, it, expect } from 'vitest'
import { ok, err, errMsg } from '../resultHelpers'

describe('ok', () => {
  it('returns success result', () => {
    expect(ok('done')).toEqual({ status: 'success', summary: 'done', detail: undefined })
    expect(ok('done', 'details')).toEqual({ status: 'success', summary: 'done', detail: 'details' })
  })
})

describe('err', () => {
  it('formats Error objects', () => {
    expect(err('test_tool', new Error('something broke'))).toEqual({
      status: 'error', summary: 'test_tool 失败: something broke',
    })
  })

  it('formats string errors', () => {
    expect(err('tool', 'plain text')).toEqual({
      status: 'error', summary: 'tool 失败: 未知错误',
    })
  })
})

describe('errMsg', () => {
  it('returns custom error without tool prefix', () => {
    expect(errMsg('custom error', 'detail')).toEqual({
      status: 'error', summary: 'custom error', detail: 'detail',
    })
  })
})
