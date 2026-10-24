export type CaptureSource = 'Paste event' | 'Clipboard API' | 'File' | 'Demo'

export interface Flavor {
  type: string
  size: number
  text?: string
  bytes?: Uint8Array
  name?: string
}

export interface Capture {
  source: CaptureSource
  capturedAt: string
  flavors: Flavor[]
  html: string
  plain: string
  metadata: unknown | null
  payload: Uint8Array | null
  notes: string[]
}

export interface NodeSummary {
  index: number
  id: string
  parentId: string | null
  position: string
  name: string
  type: string
  size: string | null
}

export interface DecodeSummary {
  version: number
  compressedBytes: number
  schemaBytes: number
  messageBytes: number
  schemaCompression: string
  messageCompression: string
  schemaDefinitions: number
  messageType: string
  messageKeys: string[]
  nodeCount: number
  blobCount: number
  nodes: NodeSummary[]
  truncated: boolean
}
