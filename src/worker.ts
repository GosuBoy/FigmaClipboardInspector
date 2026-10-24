import { decodeFigKiwi } from './lib/decoder'
import { fullMessageJsonBlob, messagePage, valueAtPath, type MessagePath } from './lib/message'

type WorkerCommand =
  | { kind: 'decode'; bytes: Uint8Array }
  | { kind: 'view'; requestId: number; path: MessagePath; page: number }
  | { kind: 'export' }
  | { kind: 'export-bytes'; path: MessagePath }

let current: ReturnType<typeof decodeFigKiwi> | null = null

self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  try {
    const command = event.data
    if (command.kind === 'decode') {
      current = decodeFigKiwi(command.bytes)
      self.postMessage({ kind: 'decoded', summary: current.summary })
    } else {
      if (!current) throw new Error('No Kiwi message has been decoded')
      if (command.kind === 'view') {
        const view = messagePage(current.message, command.path, command.page)
        self.postMessage({ kind: 'viewed', requestId: command.requestId, view })
      } else if (command.kind === 'export') {
        // The complete decoded message, without the former 60-million-character cutoff.
        // Bytes and BigInt use reversible tagged JSON representations.
        const blob = fullMessageJsonBlob(current.message)
        self.postMessage({ kind: 'exported', blob })
      } else if (command.kind === 'export-bytes') {
        const data = valueAtPath(current.message, command.path)
        if (!(data instanceof Uint8Array)) throw new Error('Selected value is not a byte buffer')
        const blob = new Blob([data.slice().buffer], { type: 'application/octet-stream' })
        self.postMessage({ kind: 'bytes-exported', blob })
      }
    }
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
