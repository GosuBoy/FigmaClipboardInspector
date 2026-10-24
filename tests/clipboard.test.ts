import { describe, expect, test } from 'bun:test'
import { base64ToBytes, buildCapture, extractFigmaHtml } from '../src/lib/clipboard'
import { isKiwi, readKiwiContainer, writeKiwiContainer } from '../src/lib/container'

describe('Clipboard envelope', () => {
  test('extracts figmeta JSON and figma bytes', () => {
    const bytes = writeKiwiContainer(106, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]))
    const payload = btoa(String.fromCharCode(...bytes))
    const meta = btoa(JSON.stringify({ dataType: 'scene', fileKey: 'unit' }))
    const html = '<span data-metadata="<!--(figmeta)' + meta + '(/figmeta)-->"></span><span data-buffer="<!--(figma)' + payload + '(/figma)-->"></span>'
    const parsed = extractFigmaHtml(html)
    expect(parsed.metadata).toEqual({ dataType: 'scene', fileKey: 'unit' })
    expect(parsed.payload).toEqual(bytes)
    expect(parsed.notes).toHaveLength(0)
  })

  test('recognizes plain clipboard content without pretending it is Figma', () => {
    const capture = buildCapture('Paste event', [{ type: 'text/plain', size: 5, text: 'hello' }])
    expect(capture.payload).toBeNull()
    expect(capture.plain).toBe('hello')
    expect(capture.flavors).toHaveLength(1)
  })

  test('rejects invalid base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow('Invalid base64')
    expect(extractFigmaHtml('<!--(figma)!!!(/figma)-->').payload).toBeNull()
  })

  test('validates chunk boundaries and magic', () => {
    const binary = writeKiwiContainer(106, new Uint8Array([10, 20]), new Uint8Array([30, 40, 50]))
    expect(isKiwi(binary)).toBe(true)
    const decoded = readKiwiContainer(binary)
    expect(decoded.version).toBe(106)
    expect(decoded.schema).toEqual(new Uint8Array([10, 20]))
    expect(decoded.message).toEqual(new Uint8Array([30, 40, 50]))
    expect(() => readKiwiContainer(binary.subarray(0, binary.byteLength - 1))).toThrow('boundary')
    expect(() => readKiwiContainer(new Uint8Array(20))).toThrow('signature')
  })
})
