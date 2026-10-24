import { compileSchema, encodeBinarySchema, parseSchema } from 'kiwi-schema'
import { deflateRaw } from 'pako'
import { bytesToBase64, buildCapture } from './clipboard'
import { writeKiwiContainer } from './container'
import type { Capture } from '../types'

const DEMO_SCHEMA = [
  'struct Guid { uint sessionID; uint localID; }',
  'struct ParentIndex { Guid guid; string position; }',
  'struct Size { float x; float y; }',
  'message NodeChange {',
  ' Guid guid = 1;',
  ' ParentIndex parentIndex = 2;',
  ' string type = 3;',
  ' string name = 4;',
  ' Size size = 5;',
  '}',
  'struct BlobData { byte[] bytes; }',
  'message Message {',
  ' string type = 1;',
  ' NodeChange[] nodeChanges = 2;',
  ' BlobData[] blobs = 3;',
  '}',
].join('\n')

export function createDemoCapture(): Capture {
  const schema = parseSchema(DEMO_SCHEMA)
  const encoder = compileSchema(schema) as unknown as { encodeMessage(value: unknown): Uint8Array }
  const message = {
    type: 'NODE_CHANGES',
    nodeChanges: [
      { guid: { sessionID: 1, localID: 1 }, type: 'DOCUMENT', name: 'Document' },
      { guid: { sessionID: 1, localID: 2 }, parentIndex: { guid: { sessionID: 1, localID: 1 }, position: 'a' }, type: 'CANVAS', name: 'Page 1' },
      { guid: { sessionID: 1, localID: 3 }, parentIndex: { guid: { sessionID: 1, localID: 2 }, position: 'a' }, type: 'FRAME', name: 'Welcome card', size: { x: 360, y: 220 } },
      { guid: { sessionID: 1, localID: 4 }, parentIndex: { guid: { sessionID: 1, localID: 3 }, position: 'a' }, type: 'RECTANGLE', name: 'Background', size: { x: 360, y: 220 } },
      { guid: { sessionID: 1, localID: 5 }, parentIndex: { guid: { sessionID: 1, localID: 3 }, position: 'b' }, type: 'TEXT', name: 'Inspect anything', size: { x: 280, y: 52 } },
    ],
    blobs: [
      { bytes: new Uint8Array([0x00, 0xff, 0x1a, 0xb2, 0x5c, 0x90, 0x31, 0x04]) },
      { bytes: Uint8Array.from({ length: 1032 }, (_, index) => index % 256) },
    ],
  }
  const binary = writeKiwiContainer(106, deflateRaw(encodeBinarySchema(schema)), deflateRaw(encoder.encodeMessage(message)))
  const metadata = bytesToBase64(new TextEncoder().encode(JSON.stringify({ dataType: 'scene', fileKey: 'demo-local-only', pasteID: 42 })))
  const html = '<meta charset="utf-8"><span data-metadata="<!--(figmeta)' + metadata + '(/figmeta)-->"></span><span data-buffer="<!--(figma)' + bytesToBase64(binary) + '(/figma)-->"></span>'
  return buildCapture('Demo', [{ type: 'text/html', size: new TextEncoder().encode(html).byteLength, text: html }])
}
