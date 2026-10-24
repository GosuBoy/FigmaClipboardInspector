import { describe, expect, test } from 'bun:test'
import { createDemoCapture } from '../src/lib/demo'
import { decodeFigKiwi } from '../src/lib/decoder'

describe('Kiwi decoder', () => {
  test('decodes the embedded schema, layers, and binary blobs', () => {
    const fixture = createDemoCapture()
    expect(fixture.payload).not.toBeNull()
    expect(fixture.metadata).toEqual({ dataType: 'scene', fileKey: 'demo-local-only', pasteID: 42 })
    const parsed = decodeFigKiwi(fixture.payload!)
    expect(parsed.summary.version).toBe(106)
    expect(parsed.summary.nodeCount).toBe(5)
    expect(parsed.summary.schemaDefinitions).toBe(6)
    expect(parsed.summary.messageType).toBe('NODE_CHANGES')
    expect(parsed.summary.blobCount).toBe(2)
    expect(parsed.summary.nodes.map((node) => node.name)).toContain('Welcome card')
    const frame = parsed.summary.nodes.find((node) => node.name === 'Welcome card')!
    expect(frame.parentId).toBe('1:2')
    expect(frame.size).toBe('360 × 220')
    const blobs = parsed.message.blobs as { bytes: Uint8Array }[]
    expect(blobs[0].bytes).toEqual(new Uint8Array([0x00, 0xff, 0x1a, 0xb2, 0x5c, 0x90, 0x31, 0x04]))
    expect(blobs[1].bytes.byteLength).toBe(1032)
  })
})
