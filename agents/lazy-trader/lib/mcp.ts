/**
 * A minimal MCP Streamable-HTTP caller — one JSON-RPC `tools/call` POST, no
 * session dance. Yeetful's fleet (mcp-handler) answers such posts directly,
 * framed either as plain JSON or as SSE (`event: message` / `data: {...}`).
 *
 * `fetchLike` is the seam: plain `fetch` for free doors, the expense account's
 * paid fetch (`account.pay`) for x402 doors — the payer plumbing handles the
 * 402 → pay → retry loop, this module never sees a challenge.
 */

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Extract the first JSON-RPC message from a plain-JSON or SSE-framed body. */
export function parseMcpBody(text: string): { result?: unknown; error?: { message?: string } } {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      if (payload && payload !== '[DONE]') return JSON.parse(payload)
    }
  }
  throw new Error(`Unrecognized MCP response framing: ${trimmed.slice(0, 120)}`)
}

/** Unwrap a tools/call result: Yeetful services return one text content block
 *  holding JSON (or a plain error message with isError). */
export function unwrapToolResult(msg: { result?: unknown; error?: { message?: string } }): unknown {
  if (msg.error) throw new Error(msg.error.message || 'MCP error')
  const result = msg.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined
  const text = result?.content?.find((c) => c.type === 'text')?.text ?? ''
  if (result?.isError) throw new Error(text || 'Tool call failed')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function callMcpTool(
  endpoint: string,
  tool: string,
  args: Record<string, unknown>,
  fetchLike: FetchLike = fetch,
): Promise<unknown> {
  const res = await fetchLike(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${tool} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return unwrapToolResult(parseMcpBody(text))
}
