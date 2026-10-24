/** Mechanical framing of a self-describing fig-kiwi container. */
export interface KiwiChunks {
  version: number
  schema: Uint8Array
  message: Uint8Array
}

const MAGIC = new TextEncoder().encode('fig-kiwi')

export function readKiwiContainer(data: Uint8Array): KiwiChunks {
  if (data.byteLength < 20) throw new Error('Not enough data for a fig-kiwi header')
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) throw new Error('Expected the fig-kiwi signature')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const version = view.getUint32(8, true)
  let offset = 12

  function nextChunk(): Uint8Array {
    if (offset + 4 > data.byteLength) throw new Error('Missing Kiwi chunk length')
    const size = view.getUint32(offset, true)
    offset += 4
    if (size > data.byteLength - offset) throw new Error('Kiwi chunk exceeds file boundary')
    const chunk = data.subarray(offset, offset + size)
    offset += size
    return chunk
  }

  const schema = nextChunk()
  const message = nextChunk()
  if (!schema.length || !message.length) throw new Error('Empty Kiwi schema or message chunk')
  return { version, schema, message }
}

export function writeKiwiContainer(version: number, schema: Uint8Array, message: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + 4 + 4 + schema.length + 4 + message.length)
  output.set(MAGIC, 0)
  const view = new DataView(output.buffer)
  view.setUint32(8, version, true)
  view.setUint32(12, schema.length, true)
  output.set(schema, 16)
  view.setUint32(16 + schema.length, message.length, true)
  output.set(message, 20 + schema.length)
  return output
}

export function isKiwi(data: Uint8Array): boolean {
  return data.length >= 8 && MAGIC.every((byte, index) => data[index] === byte)
}
