import { decodeBinarySchema, compileSchema } from 'kiwi-schema'
import { inflate, inflateRaw } from 'pako'
import { decompress } from 'fzstd'
import { readKiwiContainer } from './container'
import type { DecodeSummary, NodeSummary } from '../types'

const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_NODE_ROWS = 75000

type AnyRecord = Record<string, unknown>
export interface DecodedDocument {
  summary: DecodeSummary
  message: AnyRecord
}

function object(value: unknown): AnyRecord {
  return value && typeof value === 'object' ? value as AnyRecord : {}
}

function guidKey(value: unknown): string | null {
  const guid = object(value)
  if (guid.sessionID === undefined || guid.localID === undefined) return null
  return String(guid.sessionID) + ':' + String(guid.localID)
}

function nodeInfo(node: unknown, index: number): NodeSummary {
  const value = object(node)
  const parent = object(value.parentIndex)
  const size = object(value.size)
  const width = typeof size.x === 'number' ? Math.round(size.x * 10) / 10 : null
  const height = typeof size.y === 'number' ? Math.round(size.y * 10) / 10 : null
  return {
    index,
    id: guidKey(value.guid) ?? 'unknown:' + index,
    parentId: guidKey(parent.guid),
    position: String(parent.position ?? ''),
    name: typeof value.name === 'string' ? value.name : 'Unnamed',
    type: String(value.type ?? 'UNKNOWN'),
    size: width === null || height === null ? null : width + ' × ' + height,
  }
}

function uncompress(chunk: Uint8Array): { bytes: Uint8Array; method: string } {
  const isZstd = chunk.length >= 4 && chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd
  let bytes: Uint8Array
  let method: string
  if (isZstd) {
    bytes = decompress(chunk)
    method = 'zstd'
  } else {
    try {
      bytes = inflateRaw(chunk)
      method = 'raw deflate'
    } catch {
      try {
        bytes = inflate(chunk)
        method = 'zlib'
      } catch {
        throw new Error('Unknown compression (first bytes: ' + Array.from(chunk.subarray(0, 4)).map((v) => v.toString(16).padStart(2, '0')).join(' ') + ')')
      }
    }
  }
  if (bytes.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error('Decompressed Kiwi chunk exceeds 256 MiB')
  return { bytes, method }
}

export function decodeFigKiwi(data: Uint8Array): DecodedDocument {
  const chunks = readKiwiContainer(data)
  const rawSchema = uncompress(chunks.schema)
  const schema = decodeBinarySchema(rawSchema.bytes)
  const root = compileSchema(schema) as unknown as Record<string, (input: Uint8Array) => unknown>
  const rawMessage = uncompress(chunks.message)
  const decoder = root.decodeMessage ?? root.decodeNodeChanges
  if (typeof decoder !== 'function') throw new Error('Kiwi schema has neither a Message nor a NodeChanges decoder')
  const message = object(decoder.call(root, rawMessage.bytes))
  const changes = Array.isArray(message.nodeChanges) ? message.nodeChanges : []
  const nodes = changes.slice(0, MAX_NODE_ROWS).map(nodeInfo)
  const blobs = Array.isArray(message.blobs) ? message.blobs : []
  return {
    summary: {
      version: chunks.version,
      compressedBytes: data.byteLength,
      schemaBytes: rawSchema.bytes.byteLength,
      messageBytes: rawMessage.bytes.byteLength,
      schemaCompression: rawSchema.method,
      messageCompression: rawMessage.method,
      schemaDefinitions: schema.definitions.length,
      messageType: String(message.type ?? 'unknown'),
      messageKeys: Object.keys(message),
      nodeCount: changes.length,
      blobCount: blobs.length,
      nodes,
      truncated: changes.length > MAX_NODE_ROWS,
    },
    message,
  }
}

export function safeJson(value: unknown, maxString = 400000): string {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString()
    if (item instanceof Uint8Array) {
      return { kind: 'Uint8Array', length: item.byteLength, headHex: Array.from(item.subarray(0, 64)).map((byte) => byte.toString(16).padStart(2, '0')).join(' ') }
    }
    return item
  }, 2)
  if (!text) return 'null'
  return text.length > maxString ? text.slice(0, maxString) + '\n… [large JSON truncated]' : text
}
