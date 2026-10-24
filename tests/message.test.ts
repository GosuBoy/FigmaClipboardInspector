import { describe, expect, test } from 'bun:test'
import { createDemoCapture } from '../src/lib/demo'
import { decodeFigKiwi } from '../src/lib/decoder'
import { fullMessageJsonBlob, messagePage, valueAtPath } from '../src/lib/message'

describe('Whole Kiwi message viewer', () => {
  const decoded = decodeFigKiwi(createDemoCapture().payload!)

  test('starts at the full decoded message, not an individual node', () => {
    const root = messagePage(decoded.message)
    expect(root.kind).toBe('object')
    expect(root.entries.map((field) => field.key)).toContain('nodeChanges')
    expect(root.entries.map((field) => field.key)).toContain('type')
    const changes = messagePage(decoded.message, ['nodeChanges'])
    expect(changes.kind).toBe('array')
    expect(changes.total).toBe(5)
    expect(changes.entries[4].key).toBe(4)
    const node = messagePage(decoded.message, ['nodeChanges', 2])
    expect(node.entries.find((field) => field.key === 'name')?.preview).toBe('"Welcome card"')
    const name = messagePage(decoded.message, ['nodeChanges', 2, 'name'])
    expect(name.text).toBe('Welcome card')
  })

  test('pages large arrays and strings without omitting any entry or character', () => {
    const root = { huge: Array.from({ length: 250 }, (_, i) => ({ value: i })), description: 'abc'.repeat(3000) }
    expect(messagePage(root, ['huge'], 0).entries.length).toBe(100)
    expect(messagePage(root, ['huge'], 1).entries[0].key).toBe(100)
    expect(messagePage(root, ['huge'], 2).entries.length).toBe(50)
    const page0 = messagePage(root, ['description'], 0)
    const page1 = messagePage(root, ['description'], 1)
    expect(page0.text! + page1.text!).toBe(root.description)
    expect(() => valueAtPath(root, ['notAField'])).toThrow('Invalid Kiwi message path')
    expect(() => valueAtPath(root, ['huge', 250])).toThrow('Invalid Kiwi message path')
    expect(() => valueAtPath(root, ['constructor'])).toThrow('Invalid Kiwi message path')
  })

  test('pages binary buffers and exports every byte losslessly', async () => {
    const bytes = Uint8Array.from({ length: 1100 }, (_, i) => i % 256)
    const root = { blobs: [{ bytes }], big: 9223372036854775807n, weird: Infinity, empty: undefined }
    const page = messagePage(root, ['blobs', 0, 'bytes'], 2)
    expect(page.kind).toBe('bytes')
    expect(page.start).toBe(1024)
    expect(page.end).toBe(1100)
    expect(page.hex).toContain('00000400')
    const json = JSON.parse(await fullMessageJsonBlob(root).text())
    expect(json.blobs[0].bytes.__kiwiType).toBe('Uint8Array')
    expect(Uint8Array.from(atob(json.blobs[0].bytes.data) as string, (char) => char.charCodeAt(0))).toEqual(bytes)
    expect(json.big.value).toBe('9223372036854775807')
    expect(json.weird.value).toBe('Infinity')
    expect(json.empty.__kiwiType).toBe('undefined')
  })

  test('exports the entire decoded Kiwi document', async () => {
    const json = JSON.parse(await fullMessageJsonBlob(decoded.message).text())
    expect(json.type).toBe('NODE_CHANGES')
    expect(json.nodeChanges).toHaveLength(5)
    expect(json.nodeChanges[4].name).toBe('Inspect anything')
  })
})
