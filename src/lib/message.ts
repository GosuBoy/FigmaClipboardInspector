/** Lossless, paginated inspection of a decoded Kiwi message.
 * Objects, arrays and byte buffers remain in the decoder worker.
 * Only the current page crosses the worker boundary.
 */

export type MessagePath = Array<string | number>
export type MessageKind = 'object' | 'array' | 'bytes' | 'string' | 'number' | 'boolean' | 'bigint' | 'null' | 'undefined'

export interface MessageEntry {
  key: string | number
  kind: MessageKind
  preview: string
}

export interface MessagePage {
  path: MessagePath
  kind: MessageKind
  preview: string
  total: number
  start: number
  end: number
  entries: MessageEntry[]
  text?: string
  hex?: string
  pageSize: number
}

export function kindOf(value: unknown): MessageKind {
  if (value === null) return 'null'
  if (value instanceof Uint8Array) return 'bytes'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value as MessageKind
}

export function valueAtPath(root: unknown, path: MessagePath): unknown {
  let value = root
  for (const segment of path) {
    if (typeof segment === 'number' && Array.isArray(value) && Number.isSafeInteger(segment) && segment >= 0 && segment < value.length) {
      value = value[segment]
    } else if (typeof segment === 'string' && value !== null && typeof value === 'object' &&
               !Array.isArray(value) && !(value instanceof Uint8Array) &&
               Object.prototype.hasOwnProperty.call(value, segment)) {
      value = (value as Record<string, unknown>)[segment]
    } else {
      throw new Error('Invalid Kiwi message path at ' + String(segment))
    }
  }
  return value
}

export function previewOf(value: unknown): string {
  const kind = kindOf(value)
  if (kind === 'bytes') return (value as Uint8Array).byteLength.toLocaleString('en-US') + ' bytes'
  if (kind === 'array') return (value as unknown[]).length.toLocaleString('en-US') + ' items'
  if (kind === 'object') return Object.keys(value as object).length.toLocaleString('en-US') + ' fields'
  if (kind === 'string') {
    const str = (value as string).replace(/\s+/g, ' ')
    return JSON.stringify(str.length > 110 ? str.slice(0, 110) + '…' : str)
  }
  if (kind === 'undefined') return 'undefined'
  if (kind === 'bigint') return (value as bigint).toString() + 'n'
  return String(value)
}

function hexDump(data: Uint8Array, start: number, end: number): string {
  const lines: string[] = []
  for (let offset = start; offset < end; offset += 16) {
    const chunk = data.subarray(offset, Math.min(offset + 16, end))
    const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const ascii = Array.from(chunk, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('')
    lines.push(offset.toString(16).padStart(8, '0') + '  ' + hex + '  |' + ascii + '|')
  }
  return lines.join('\n')
}

/** Page sizes: object/array 100 entries, bytes 512 bytes, text 8192 UTF-16 units. */
export function messagePage(root: unknown, path: MessagePath = [], page = 0): MessagePage {
  const value = valueAtPath(root, path)
  const kind = kindOf(value)
  const pageSize = kind === 'bytes' ? 512 : kind === 'string' ? 8192 : 100
  const total = kind === 'array' ? (value as unknown[]).length
    : kind === 'object' ? Object.keys(value as object).length
    : kind === 'bytes' ? (value as Uint8Array).byteLength
    : kind === 'string' ? (value as string).length
    : 0
  const safePage = Number.isSafeInteger(page) && page >= 0 ? page : 0
  const start = Math.min(total, safePage * pageSize)
  const end = Math.min(total, start + pageSize)
  const entries: MessageEntry[] = []

  if (kind === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj).slice(start, end)) {
      entries.push({ key, kind: kindOf(obj[key]), preview: previewOf(obj[key]) })
    }
  } else if (kind === 'array') {
    const array = value as unknown[]
    for (let index = start; index < end; index++) {
      entries.push({ key: index, kind: kindOf(array[index]), preview: previewOf(array[index]) })
    }
  }

  const result: MessagePage = { path, kind, preview: previewOf(value), total, start, end, entries, pageSize }
  if (kind === 'bytes') result.hex = hexDump(value as Uint8Array, start, end)
  if (kind === 'string') result.text = (value as string).slice(start, end)
  if (!['object', 'array', 'bytes', 'string'].includes(kind)) result.text = previewOf(value)
  return result
}

/** Full document export. Typed arrays use lossless base64 to avoid JSON's huge numeric arrays;
 * BigInt and nonfinite numbers are tagged, preserving values without string truncation.
 * Builds a Blob from buffered parts so large documents never require one giant JSON string.
 */
export function fullMessageJsonBlob(value: unknown): Blob {
  const parts: string[] = []
  let buffer = ''
  const active = new Set<object>()
  const emit = (text: string) => {
    buffer += text
    if (buffer.length >= 128 * 1024) { parts.push(buffer); buffer = '' }
  }

  const write = (input: unknown, depth: number) => {
    if (depth > 500) throw new Error('Message nesting exceeds safe export depth')
    if (input instanceof Uint8Array) {
      emit('{"__kiwiType":"Uint8Array","encoding":"base64","data":"')
      // A multiple of three keeps each base64 part independently concatenable.
      for (let i = 0; i < input.byteLength; i += 24 * 1024) {
        emit(btoa(String.fromCharCode(...input.subarray(i, i + 24 * 1024))))
      }
      emit('"}')
    } else if (typeof input === 'bigint') {
      emit('{"__kiwiType":"bigint","value":' + JSON.stringify(input.toString()) + '}')
    } else if (input === undefined) {
      emit('{"__kiwiType":"undefined"}')
    } else if (typeof input === 'number' && !Number.isFinite(input)) {
      emit('{"__kiwiType":"nonfinite-number","value":' + JSON.stringify(String(input)) + '}')
    } else if (input === null || typeof input !== 'object') {
      emit(JSON.stringify(input))
    } else {
      if (active.has(input)) throw new Error('Circular reference in Kiwi message')
      active.add(input)
      if (Array.isArray(input)) {
        emit('[')
        input.forEach((item, index) => {
          if (index) emit(',')
          write(item, depth + 1)
        })
        emit(']')
      } else {
        emit('{')
        Object.keys(input).forEach((key, index) => {
          if (index) emit(',')
          emit(JSON.stringify(key) + ':')
          write((input as Record<string, unknown>)[key], depth + 1)
        })
        emit('}')
      }
      active.delete(input)
    }
  }
  write(value, 0)
  if (buffer) parts.push(buffer)
  return new Blob(parts, { type: 'application/json' })
}
