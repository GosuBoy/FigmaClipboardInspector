import { describe, expect, test } from 'bun:test'
import { createDemoCapture } from '../src/lib/demo'
import { decodeFigKiwi, safeJson } from '../src/lib/decoder'

describe('Kiwi decoder', () => {
  test('decodes embedded schema and produces inspectable layers', () => {
    const fixture = createDemoCapture()
    expect(fixture.payload).not.toBeNull()
    expect(fixture.metadata).toEqual({ dataType: 'scene', fileKey: 'demo-local-only', pasteID: 42 })
    const parsed = decodeFigKiwi(fixture.payload!)
    expect(parsed.summary.version).toBe(106)
    expect(parsed.summary.nodeCount).toBe(5)
    expect(parsed.summary.schemaDefinitions).toBe(5)
    expect(parsed.summary.messageType).toBe('NODE_CHANGES')
    expect(parsed.summary.nodes.map((node) => node.name)).toContain('Welcome card')
    const frame = parsed.summary.nodes.find((node) => node.name === 'Welcome card')!
    expect(frame.parentId).toBe('1:2')
    expect(frame.size).toBe('360 × 220')
  })

  test('serializes bigints and binary safely for inspection', () => {
    const json = safeJson({ serial: 42n, data: new Uint8Array([1, 2, 3]) })
    expect(json).toContain('"42"')
    expect(json).toContain('"length": 3')
    expect(json).toContain('01 02 03')
  })
})
