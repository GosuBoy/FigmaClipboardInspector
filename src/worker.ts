import { decodeFigKiwi, safeJson } from './lib/decoder'

type WorkerCommand =
  | { kind: 'decode'; bytes: Uint8Array }
  | { kind: 'inspect'; index: number }
  | { kind: 'export' }

let current: ReturnType<typeof decodeFigKiwi> | null = null

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  try {
    const command = event.data
    if (command.kind === 'decode') {
      current = decodeFigKiwi(command.bytes)
      self.postMessage({ kind: 'decoded', summary: current.summary })
    } else if (command.kind === 'inspect') {
      const row = current?.message.nodeChanges
      const nodes = Array.isArray(row) ? row : []
      self.postMessage({ kind: 'inspected', index: command.index, json: safeJson(nodes[command.index] ?? null) })
    } else if (command.kind === 'export') {
      if (!current) throw new Error('No decoded document to export')
      self.postMessage({ kind: 'exported', json: safeJson(current.message, 60_000_000) })
    }
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
