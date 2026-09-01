// Minimal MCP Streamable-HTTP client for the Pantessa agent desk — a plain
// fetch loop, no SDK, so the template shows the whole wire. JSON-RPC in,
// SSE frames out; the mcp-session-id header threads the session.
import { DESK_URL } from './config'

export interface ToolResult {
  isError: boolean
  /** Parsed JSON payload on success; the refusal text on error. */
  payload: any
}

export class DeskClient {
  private id = 0
  private session: string | null = null

  /** When true, every desk call carries `x-yf-internal-run: 1` so a drill
   *  against a real deployment never counts toward records/referrals
   *  (SECOND-MANAGER-CONTRACT §7.7). The default dry-run run sets this. */
  constructor(private readonly internalRun = false) {}

  private async rpc(method: string, params?: unknown): Promise<any> {
    const res = await fetch(DESK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.internalRun ? { 'x-yf-internal-run': '1' } : {}),
        ...(this.session ? { 'mcp-session-id': this.session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    })
    this.session = res.headers.get('mcp-session-id') ?? this.session
    const raw = await res.text()
    const frame = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .find((l) => l.includes(`"id":${this.id}`))
    return frame ? JSON.parse(frame).result : undefined
  }

  async init(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'roster-manager-template', version: '0.1.0' },
    })
    await this.rpc('notifications/initialized')
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.rpc('tools/call', { name, arguments: args })
    const text: string = result?.content?.find((c: any) => c.type === 'text')?.text ?? ''
    if (result?.isError) return { isError: true, payload: text }
    try {
      return { isError: false, payload: text ? JSON.parse(text) : null }
    } catch {
      return { isError: false, payload: text }
    }
  }
}
