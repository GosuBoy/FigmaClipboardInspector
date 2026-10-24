import { isKiwi } from './container'
import type { Capture, CaptureSource, Flavor } from '../types'

export const MAX_INPUT_BYTES = 48 * 1024 * 1024

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error('Invalid base64 payload')
  }
  const decoded = atob(normalized)
  if (decoded.length > MAX_INPUT_BYTES) throw new Error('Payload exceeds the 48 MiB safety limit')
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

export function bytesToBase64(data: Uint8Array): string {
  let value = ''
  for (let i = 0; i < data.length; i += 32768) {
    value += String.fromCharCode(...data.subarray(i, i + 32768))
  }
  return btoa(value)
}

function readMarker(html: string, marker: 'figma' | 'figmeta'): string | null {
  const open = '<!--(' + marker + ')'
  const close = '(\/' + marker + ')-->'
  const start = html.indexOf(open)
  if (start < 0) return null
  const end = html.indexOf(close, start + open.length)
  if (end < 0) return null
  return html.slice(start + open.length, end).trim()
}

export function extractFigmaHtml(html: string): { metadata: unknown | null; payload: Uint8Array | null; notes: string[] } {
  const notes: string[] = []
  let metadata: unknown | null = null
  let payload: Uint8Array | null = null

  const rawMeta = readMarker(html, 'figmeta')
  if (rawMeta !== null) {
    try {
      metadata = JSON.parse(new TextDecoder().decode(base64ToBytes(rawMeta))) as unknown
    } catch {
      notes.push('Figma metadata was present, but could not be decoded as JSON.')
    }
  }

  const rawPayload = readMarker(html, 'figma')
  if (rawPayload !== null) {
    try {
      payload = base64ToBytes(rawPayload)
      if (!isKiwi(payload)) notes.push('Figma marker found, but the decoded bytes are not a fig-kiwi stream.')
    } catch (error) {
      notes.push('Could not decode Figma binary: ' + errorMessage(error))
    }
  } else if (rawMeta) {
    notes.push('Found Figma metadata without a binary data-buffer.')
  }
  return { metadata, payload, notes }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function buildCapture(source: CaptureSource, flavors: Flavor[]): Capture {
  const html = flavors.find((item) => item.type.toLowerCase() === 'text/html')?.text ?? ''
  const plain = flavors.find((item) => item.type.toLowerCase() === 'text/plain')?.text ?? ''
  const extraction = extractFigmaHtml(html || plain)
  let payload = extraction.payload

  if (!payload) {
    for (const item of flavors) {
      if (item.bytes && isKiwi(item.bytes)) { payload = item.bytes; break }
      if (item.text && item.type !== 'text/html' && item.type !== 'text/plain') {
        const result = extractFigmaHtml(item.text)
        if (result.payload) { payload = result.payload; break }
      }
    }
  }

  if (!payload && plain.startsWith('fig-kiwi')) {
    extraction.notes.push('A fig-kiwi signature is visible as text, but text pastes do not preserve the original binary bytes.')
  }
  if (!payload && !html && !plain && !flavors.some((f) => f.bytes)) {
    extraction.notes.push('The browser exposed no readable clipboard representations.')
  }
  return {
    source,
    capturedAt: new Date().toISOString(),
    flavors,
    html,
    plain,
    metadata: extraction.metadata,
    payload,
    notes: extraction.notes,
  }
}

export async function flavorsFromPaste(event: ClipboardEvent): Promise<Flavor[]> {
  const transfer = event.clipboardData
  if (!transfer) return []
  const flavors: Flavor[] = []
  for (const type of Array.from(transfer.types)) {
    if (type === 'Files') continue
    const data = transfer.getData(type)
    if (data) flavors.push({ type, size: new TextEncoder().encode(data).byteLength, text: data })
    else flavors.push({ type, size: 0 })
  }
  for (const file of Array.from(transfer.files)) {
    if (file.size > MAX_INPUT_BYTES) {
      flavors.push({ type: file.type || 'application/octet-stream', size: file.size, name: file.name })
      continue
    }
    flavors.push({ type: file.type || 'application/octet-stream', size: file.size, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return flavors
}

export async function flavorsFromClipboardRead(): Promise<Flavor[]> {
  if (!navigator.clipboard?.read) throw new Error('Clipboard read() is unavailable in this browser. Use Ctrl/⌘+V instead.')
  const items = await navigator.clipboard.read()
  const flavors: Flavor[] = []
  for (const item of items) {
    for (const type of item.types) {
      const blob = await item.getType(type)
      if (blob.size > MAX_INPUT_BYTES) {
        flavors.push({ type, size: blob.size })
        continue
      }
      if (type.startsWith('text/') || type.includes('json') || type === 'image/svg+xml') {
        flavors.push({ type, size: blob.size, text: await blob.text() })
      } else {
        flavors.push({ type, size: blob.size, bytes: new Uint8Array(await blob.arrayBuffer()) })
      }
    }
  }
  return flavors
}
