import { describe, it, expect } from 'vitest'
import { parseMcpBody, unwrapToolResult } from '@/lib/mcp'

describe('parseMcpBody', () => {
  it('parses plain JSON bodies', () => {
    const msg = parseMcpBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    expect((msg.result as { ok: boolean }).ok).toBe(true)
  })

  it('parses SSE-framed bodies (mcp-handler default)', () => {
    const msg = parseMcpBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"n":7}}\n\n')
    expect((msg.result as { n: number }).n).toBe(7)
  })

  it('throws on unrecognized framing', () => {
    expect(() => parseMcpBody('<html>nope</html>')).toThrow(/framing/)
  })
})

describe('unwrapToolResult', () => {
  it('parses the text content block as JSON', () => {
    const out = unwrapToolResult({ result: { content: [{ type: 'text', text: '{"a":1}' }] } })
    expect(out).toEqual({ a: 1 })
  })

  it('throws the tool error message on isError', () => {
    expect(() => unwrapToolResult({ result: { content: [{ type: 'text', text: 'ETH is unpriceable right now' }], isError: true } })).toThrow(
      /unpriceable/,
    )
  })

  it('throws on a JSON-RPC error', () => {
    expect(() => unwrapToolResult({ error: { message: 'boom' } })).toThrow(/boom/)
  })
})
