import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownToLine, ArrowRight, Binary, Check, ChevronDown, ChevronRight,
  CircleAlert, Clipboard, ClipboardPaste, Code2, Copy, FileJson2, FileText,
  Github, Info, Layers3, LoaderCircle, Search, ShieldCheck, Sparkles, Upload,
  X,
} from 'lucide-react'
import { buildCapture, errorMessage, flavorsFromClipboardRead, flavorsFromPaste, MAX_INPUT_BYTES } from './lib/clipboard'
import { isKiwi } from './lib/container'
import { createDemoCapture } from './lib/demo'
import type { Capture, DecodeSummary, Flavor, NodeSummary } from './types'
import './style.css'

type Tab = 'overview' | 'layers' | 'json' | 'hex' | 'html' | 'formats'
type WorkerReply =
  | { kind: 'decoded'; summary: DecodeSummary }
  | { kind: 'inspected'; index: number; json: string }
  | { kind: 'exported'; json: string }
  | { kind: 'error'; message: string }

const NAV: { id: Tab; label: string; icon: typeof Layers3 }[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'layers', label: 'Layers', icon: Layers3 },
  { id: 'json', label: 'Node JSON', icon: Code2 },
  { id: 'hex', label: 'Hex', icon: Binary },
  { id: 'html', label: 'HTML', icon: FileText },
  { id: 'formats', label: 'Formats', icon: Clipboard },
]

function formatSize(size: number): string {
  if (!Number.isFinite(size)) return '—'
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KiB'
  return (size / (1024 * 1024)).toFixed(2) + ' MiB'
}

function formatCount(number: number): string {
  return new Intl.NumberFormat('en-US').format(number)
}

function downloadBytes(data: BlobPart, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function hexDump(bytes: Uint8Array, start: number, count: number): string {
  const result: string[] = []
  for (let offset = start; offset < Math.min(bytes.byteLength, start + count); offset += 16) {
    const slice = bytes.subarray(offset, Math.min(offset + 16, bytes.byteLength))
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const ascii = Array.from(slice, (byte) => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '·').join('')
    result.push(offset.toString(16).padStart(8, '0') + '  ' + hex + '  |' + ascii + '|')
  }
  return result.join('\n')
}

interface TreeRow {
  node: NodeSummary
  depth: number
  childCount: number
  expanded: boolean
}

function visibleNodes(nodes: NodeSummary[], expanded: Set<string>, search: string): TreeRow[] {
  const query = search.trim().toLowerCase()
  if (query) {
    return nodes.filter((node) => (
      node.name.toLowerCase().includes(query)
      || node.type.toLowerCase().includes(query)
      || node.id.includes(query)
    )).slice(0, 400).map((node) => ({ node, depth: 0, childCount: 0, expanded: false }))
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, NodeSummary[]>()
  const roots: NodeSummary[] = []
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) {
      roots.push(node)
    } else {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }
  }
  const sort = (a: NodeSummary, b: NodeSummary) => a.position < b.position ? -1 : a.position > b.position ? 1 : a.index - b.index
  roots.sort(sort)
  for (const siblings of children.values()) siblings.sort(sort)

  const output: TreeRow[] = []
  const seen = new Set<number>()
  const walk = (node: NodeSummary, depth: number) => {
    if (output.length >= 450 || seen.has(node.index)) return
    seen.add(node.index)
    const descendants = children.get(node.id) ?? []
    const isExpanded = expanded.has(node.id)
    output.push({ node, depth, childCount: descendants.length, expanded: isExpanded })
    if (isExpanded) for (const child of descendants) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return output
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="metric-card">
    <span className="metric-label">{title}</span>
    <strong className="metric-number" title={value}>{value}</strong>
    <span className="metric-detail">{detail}</span>
  </div>
}

function ClipboardMark() {
  return <div className="brand-mark" aria-hidden="true">
    <span className="mark-red" /><span className="mark-orange" />
    <span className="mark-purple" /><span className="mark-green" /><span className="mark-blue" />
  </div>
}

function App() {
  const [capture, setCapture] = useState<Capture | null>(null)
  const [summary, setSummary] = useState<DecodeSummary | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [hexStart, setHexStart] = useState(0)
  const [flavorIndex, setFlavorIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const selectedRef = useRef<number | null>(null)
  const currentFileRef = useRef(0)

  const selectNode = useCallback((index: number) => {
    selectedRef.current = index
    setSelected(index)
    setDetail('')
    workerRef.current?.postMessage({ kind: 'inspect', index })
  }, [])

  const applyCapture = useCallback((next: Capture) => {
    workerRef.current?.terminate()
    workerRef.current = null
    selectedRef.current = null
    setCapture(next)
    setSummary(null)
    setDetail('')
    setSelected(null)
    setExpanded(new Set())
    setSearch('')
    setHexStart(0)
    setFlavorIndex(0)
    setTab('overview')
    setNotice(null)

    if (!next.payload) { setBusy(false); return }
    if (!isKiwi(next.payload)) {
      setNotice('Figma payload was found, but its signature is not fig-kiwi.')
      setBusy(false)
      return
    }
    setBusy(true)

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (workerRef.current !== worker) return
      const result = event.data
      if (result.kind === 'decoded') {
        setSummary(result.summary)
        setBusy(false)
        const defaults = new Set(result.summary.nodes.filter((node) => node.type === 'DOCUMENT' || node.type === 'CANVAS').map((node) => node.id))
        setExpanded(defaults)
        const first = result.summary.nodes.find((node) => node.type === 'FRAME') ?? result.summary.nodes[0]
        if (first) {
          selectedRef.current = first.index
          setSelected(first.index)
          worker.postMessage({ kind: 'inspect', index: first.index })
        }
      } else if (result.kind === 'inspected') {
        if (selectedRef.current === result.index) setDetail(result.json)
      } else if (result.kind === 'exported') {
        downloadBytes(result.json, 'figma-clipboard-decoded.json', 'application/json')
      } else if (result.kind === 'error') {
        setBusy(false)
        setNotice('Kiwi decoding failed: ' + result.message)
      }
    }
    worker.onerror = (event) => {
      if (workerRef.current === worker) {
        setBusy(false)
        setNotice('Decoder worker error: ' + event.message)
      }
    }
    worker.postMessage({ kind: 'decode', bytes: next.payload.slice() })
  }, [])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      void flavorsFromPaste(event).then((flavors) => applyCapture(buildCapture('Paste event', flavors))).catch((error) => setNotice(errorMessage(error)))
    }
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
      workerRef.current?.terminate()
    }
  }, [applyCapture])

  const readClipboard = async () => {
    try {
      setNotice(null)
      const flavors = await flavorsFromClipboardRead()
      applyCapture(buildCapture('Clipboard API', flavors))
    } catch (error) {
      setNotice('Clipboard access: ' + errorMessage(error))
    }
  }

  const acceptFile = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      setNotice('File is larger than the 48 MiB inspection limit.')
      return
    }
    const request = ++currentFileRef.current
    try {
      const textLike = /\.(html?|txt)$/i.test(file.name) || /^text\//.test(file.type)
      const flavor: Flavor = textLike
        ? { type: /\.(html?)$/i.test(file.name) ? 'text/html' : 'text/plain', size: file.size, text: await file.text(), name: file.name }
        : { type: file.type || 'application/octet-stream', size: file.size, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }
      if (request === currentFileRef.current) applyCapture(buildCapture('File', [flavor]))
    } catch (error) {
      setNotice('File read failed: ' + errorMessage(error))
    }
  }

  const loadDemo = () => {
    try { applyCapture(createDemoCapture()) }
    catch (error) { setNotice('Demo creation failed: ' + errorMessage(error)) }
  }

  const toggleNode = (id: string) => {
    setExpanded((before) => {
      const after = new Set(before)
      if (after.has(id)) after.delete(id)
      else after.add(id)
      return after
    })
  }

  const tree = useMemo(() => summary ? visibleNodes(summary.nodes, expanded, search) : [], [summary, expanded, search])
  const chosenNode = summary?.nodes.find((node) => node.index === selected)
  const chosenFlavor = capture?.flavors[flavorIndex]
  const hasPayload = !!capture?.payload
  const decoded = !!summary
  const stat = busy ? 'Decoding Kiwi…' : decoded ? 'Kiwi decoded' : hasPayload ? 'Decode unavailable' : capture ? 'Captured' : 'Ready to inspect'

  const renderOverview = () => {
    if (!capture) {
      return <div className="empty-state">
        <div className="empty-illustration"><div className="empty-plate plate-back" /><div className="empty-plate plate-mid" /><div className="empty-plate plate-front"><ClipboardPaste size={30} strokeWidth={1.5} /></div></div>
        <div className="eyebrow center">START EXPLORING</div>
        <h2>Everything your clipboard holds.</h2>
        <p>Copy a layer or frame in Figma, then paste anywhere on this page. We will unwrap the HTML envelope, decode the Kiwi message, and show you what is inside.</p>
        <div className="empty-actions">
          <button className="primary-btn" onClick={readClipboard}><ClipboardPaste size={17} /> Read clipboard</button>
          <button className="secondary-btn" onClick={loadDemo}><Sparkles size={16} /> Explore demo</button>
        </div>
        <div className="key-hint"><kbd>⌘</kbd> + <kbd>V</kbd> <span>or Ctrl + V · works without granting persistent clipboard access</span></div>
      </div>
    }

    return <div className="panel-content">
      <div className="section-heading"><div><span className="eyebrow">CAPTURE REPORT</span><h2>Clipboard breakdown</h2></div><span className={decoded ? 'status-chip good' : busy ? 'status-chip working' : 'status-chip muted'}>{busy ? <LoaderCircle size={13} className="spin" /> : decoded ? <Check size={13} /> : <Info size={13} />}{stat}</span></div>
      <div className="pipeline">
        <div className="pipeline-step"><span className="step-number">01</span><div><strong>Captured</strong><small>{capture.flavors.length} representation(s)</small></div><span className="step-check"><Check size={15}/></span></div>
        <ArrowRight size={16} className="pipeline-arrow"/>
        <div className="pipeline-step"><span className="step-number">02</span><div><strong>Unwrapped</strong><small>{hasPayload ? formatSize(capture.payload!.byteLength) + ' binary' : 'No Figma buffer'}</small></div><span className={'step-check ' + (hasPayload ? '' : 'dim')}>{hasPayload ? <Check size={15}/> : '—'}</span></div>
        <ArrowRight size={16} className="pipeline-arrow"/>
        <div className="pipeline-step"><span className="step-number">03</span><div><strong>Kiwi decoded</strong><small>{decoded ? formatCount(summary.nodeCount) + ' nodes' : busy ? 'Processing…' : 'Not available'}</small></div><span className={'step-check ' + (decoded ? '' : 'dim')}>{decoded ? <Check size={15}/> : '—'}</span></div>
      </div>

      <div className="detail-grid">
        <div className="detail-card"><div className="card-title"><span>Container</span><Binary size={15}/></div><dl>
          <dt>Format</dt><dd>{hasPayload ? isKiwi(capture.payload!) ? 'fig-kiwi' : 'Unknown binary' : 'Not present'}</dd>
          <dt>Version</dt><dd>{summary ? summary.version : '—'}</dd>
          <dt>Schema codec</dt><dd>{summary?.schemaCompression ?? '—'}</dd>
          <dt>Message codec</dt><dd>{summary?.messageCompression ?? '—'}</dd>
          <dt>Unpacked message</dt><dd>{summary ? formatSize(summary.messageBytes) : '—'}</dd>
        </dl></div>
        <div className="detail-card"><div className="card-title"><span>Figma metadata</span><FileJson2 size={15}/></div><pre className="mini-code">{capture.metadata ? JSON.stringify(capture.metadata, null, 2) : 'No figmeta JSON found in this capture.'}</pre></div>
      </div>
      {summary && <div className="detail-card wide-card"><div className="card-title"><span>Decoded message</span><Code2 size={15}/></div><div className="token-cloud">{summary.messageKeys.map((key) => <span className="token" key={key}>{key}</span>)}</div><p className="supporting-copy">The embedded Kiwi schema defines {formatCount(summary.schemaDefinitions)} types. Explore the layer tree or inspect individual node properties without sending anything to a server.</p></div>}
      {(!decoded && !busy) && <div className="info-strip"><Info size={17}/><span>{hasPayload ? 'Binary detected, but structured decoding is not available for this capture.' : 'No fig-kiwi buffer found. Inspect the HTML and MIME representations to see what the browser exposed.'}</span></div>}
      {capture.notes.map((note, index) => <div key={index} className="info-strip"><CircleAlert size={16}/><span>{note}</span></div>)}
    </div>
  }

  const renderLayers = () => !summary ? <div className="unavailable"><Layers3 size={30}/><h3>No decoded layers yet</h3><p>Paste a Figma layer or load the demo to explore its hierarchy.</p><button className="secondary-btn" onClick={loadDemo}>Load demo</button></div> :
    <div className="layers-layout">
      <section className="tree-pane">
        <div className="pane-title"><span>Layer hierarchy</span><span className="count">{formatCount(summary.nodeCount)}</span></div>
        <label className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, type or ID" aria-label="Search layers" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14}/></button>}</label>
        <div className="tree-scroll" role="tree" aria-label="Figma layer tree">
          {tree.map(({node,depth,childCount,expanded:opened}) => <div key={node.index} className={'tree-entry ' + (selected === node.index ? 'selected' : '')} style={{paddingLeft: 10 + depth * 16}}>
            <button className="tree-toggle" onClick={() => toggleNode(node.id)} disabled={!childCount || !!search} aria-label={opened ? 'Collapse' : 'Expand'}>{childCount ? opened ? <ChevronDown size={14}/> : <ChevronRight size={14}/> : <span className="tree-empty"/>}</button>
            <button className="tree-target" onClick={() => selectNode(node.index)} role="treeitem" aria-selected={selected === node.index}>
              <span className={'node-glyph node-' + node.type.toLowerCase().replace(/[^a-z]/g, '')}>{node.type.charAt(0)}</span>
              <span className="tree-text"><strong title={node.name}>{node.name}</strong><small>{node.type}</small></span>
              {node.size && <span className="tree-size">{node.size}</span>}
            </button>
          </div>)}
          {tree.length === 0 && <div className="tree-message">No matching layers.</div>}
          {tree.length >= 400 && <div className="tree-message">Showing a limited set of rows. Search to narrow the result.</div>}
          {summary.truncated && <div className="tree-message">Layer index truncated at 75,000 entries for responsiveness.</div>}
        </div>
      </section>
      <section className="inspector-pane">
        <div className="pane-title"><span>Node properties</span><span className="mono subtle">{chosenNode?.id ?? '—'}</span></div>
        {chosenNode ? <>
          <div className="node-detail-head"><span className={'node-glyph large node-' + chosenNode.type.toLowerCase().replace(/[^a-z]/g, '')}>{chosenNode.type.charAt(0)}</span><div><h3>{chosenNode.name}</h3><span>{chosenNode.type} {chosenNode.size ? '· ' + chosenNode.size : ''}</span></div></div>
          <div className="prop-grid"><div>GUID<strong>{chosenNode.id}</strong></div><div>Parent<strong>{chosenNode.parentId ?? 'Root'}</strong></div><div>Node index<strong>#{chosenNode.index}</strong></div><div>Position<strong>{chosenNode.position || '—'}</strong></div></div>
          <div className="inline-header"><span>RAW NODE JSON</span><button onClick={() => setTab('json')}>Expand <ArrowRight size={13}/></button></div>
          <pre className="code-window details-preview">{detail || 'Loading node properties…'}</pre>
        </> : <div className="unavailable small"><p>Select a layer to inspect its raw properties.</p></div>}
      </section>
    </div>

  const renderJson = () => <div className="panel-content fill-content">
    <div className="section-heading"><div><span className="eyebrow">DATA INSPECTOR</span><h2>Selected node JSON</h2><p>Exact decoded fields, with binary blobs summarized.</p></div><button className="toolbar-btn" disabled={!detail} onClick={() => void navigator.clipboard.writeText(detail).catch((error) => setNotice(errorMessage(error)))}><Copy size={15}/> Copy JSON</button></div>
    {summary && <div className="json-node-selector"><span className="node-glyph">{chosenNode?.type.charAt(0) ?? 'N'}</span><div><strong>{chosenNode?.name ?? 'Select a node'}</strong><small>{chosenNode?.id ?? 'Choose one in Layers'}</small></div><button className="secondary-btn compact" onClick={() => setTab('layers')}>Browse layers <ArrowRight size={14}/></button></div>}
    <pre className="code-window large-code">{detail || 'No decoded node selected. Select a layer to view its properties here.'}</pre>
  </div>

  const renderHex = () => <div className="panel-content fill-content">
    <div className="section-heading"><div><span className="eyebrow">BINARY VIEWER</span><h2>Raw clipboard bytes</h2><p>Original fig-kiwi container, without modification.</p></div>{hasPayload && <button className="toolbar-btn" onClick={() => downloadBytes(capture!.payload!.slice().buffer, 'figma-clipboard.kiwi')}><ArrowDownToLine size={15}/> Download binary</button>}</div>
    {hasPayload ? <>
      <div className="hex-toolbar"><div><span className="mono subtle">OFFSET</span><strong>0x{hexStart.toString(16).padStart(8, '0')}</strong></div><div><span className="mono subtle">TOTAL</span><strong>{formatSize(capture!.payload!.byteLength)}</strong></div><div className="paging"><button disabled={hexStart === 0} onClick={() => setHexStart((v) => Math.max(0, v - 512))}>Previous</button><button disabled={hexStart + 512 >= capture!.payload!.byteLength} onClick={() => setHexStart((v) => v + 512)}>Next 512 B <ArrowRight size={13}/></button></div></div>
      <pre className="code-window hex-window">{hexDump(capture!.payload!, hexStart, 512)}</pre>
    </> : <div className="unavailable"><Binary size={30}/><h3>No binary payload</h3><p>The browser did not expose a Figma Kiwi buffer for this capture.</p></div>}
  </div>

  const renderHtml = () => <div className="panel-content fill-content">
    <div className="section-heading"><div><span className="eyebrow">CLIPBOARD ENVELOPE</span><h2>Original HTML</h2><p>Raw text/html containing figmeta and figma markers, when available.</p></div>{capture?.html && <button className="toolbar-btn" onClick={() => void navigator.clipboard.writeText(capture.html).catch((error) => setNotice(errorMessage(error)))}><Copy size={15}/> Copy HTML</button>}</div>
    <div className="info-strip"><Info size={17}/><span>HTML is displayed as escaped text; it is never executed or inserted into the page.</span></div>
    <pre className="code-window large-code">{capture?.html ? capture.html.slice(0, 40000) + (capture.html.length > 40000 ? '\n\n… [view limited to 40,000 characters; Copy HTML includes the full value]' : '') : 'This capture has no text/html representation.'}</pre>
  </div>

  const renderFormats = () => <div className="panel-content fill-content">
    <div className="section-heading"><div><span className="eyebrow">MIME INSPECTOR</span><h2>Clipboard representations</h2><p>The formats the browser actually exposed, not hidden native clipboard formats.</p></div></div>
    {capture ? <div className="format-layout">
      <div className="format-list">{capture.flavors.map((flavor, index) => <button key={index} className={'format-row ' + (flavorIndex === index ? 'current' : '')} onClick={() => setFlavorIndex(index)}><FileText size={15}/><span><strong>{flavor.type}</strong><small>{flavor.name ?? (flavor.bytes ? 'Binary representation' : 'Text representation')}</small></span><em>{formatSize(flavor.size)}</em></button>)}</div>
      <div className="format-details"><div className="card-title"><span>{chosenFlavor?.type ?? 'No MIME types'}</span><span className="count">{chosenFlavor ? formatSize(chosenFlavor.size) : '—'}</span></div><pre className="code-window format-code">{chosenFlavor?.text !== undefined ? chosenFlavor.text.slice(0, 20000) + (chosenFlavor.text.length > 20000 ? '\n… [preview truncated]' : '') : chosenFlavor?.bytes ? hexDump(chosenFlavor.bytes, 0, 512) : 'No accessible data for this representation.'}</pre></div>
    </div> : <div className="unavailable"><Clipboard size={30}/><p>Capture a clipboard item to see its MIME formats.</p></div>}
  </div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><ClipboardMark/><div><strong>Figma <span>Clipboard</span></strong><small>INSPECTOR / LAB</small></div></div>
      <div className="sidebar-divider" />
      <div className="sidebar-section"><div className="side-label">01 / CAPTURE</div>
        <button className="capture-button" onClick={() => void readClipboard()}><span className="capture-icon"><ClipboardPaste size={21}/></span><span><strong>Read clipboard</strong><small>Clipboard API · permission may be requested</small></span><ArrowRight size={16} className="capture-arrow"/></button>
        <div className={'drop-zone ' + (isDragging ? 'dragging' : '')} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setIsDragging(false) }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); if (event.dataTransfer.files[0]) void acceptFile(event.dataTransfer.files[0]) }} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}>
          <Upload size={19}/><strong>Drop a payload here</strong><span>or click to select .html, .txt, .kiwi</span>
        </div>
        <input ref={fileInputRef} className="hidden" type="file" accept=".html,.htm,.txt,.kiwi,.bin,.fig" aria-label="Choose a clipboard payload file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void acceptFile(file); event.target.value = '' }} />
        <button className="demo-link" onClick={loadDemo}><Sparkles size={15}/> Try with sample data <ArrowRight size={14}/></button>
      </div>

      <div className="sidebar-divider" />
      <div className="sidebar-section flavors-section"><div className="side-label">02 / MIME FORMATS <span>{capture?.flavors.length ?? 0}</span></div>
        {capture?.flavors.length ? <div className="sidebar-formats">{capture.flavors.map((flavor, index) => <button key={index} className={'sidebar-format ' + (tab === 'formats' && index === flavorIndex ? 'chosen' : '')} onClick={() => { setFlavorIndex(index); setTab('formats') }}><span className="format-led"/><span title={flavor.type}>{flavor.type}</span><small>{formatSize(flavor.size)}</small></button>)}</div> : <div className="no-formats">No clipboard data yet.<br/>Your MIME types will appear here.</div>}
      </div>

      <div className="sidebar-bottom"><div className="privacy-block"><ShieldCheck size={18}/><div><strong>100% client-side</strong><small>No uploads, accounts or tracking. Clipboard data stays in this browser tab.</small></div></div><a href="https://github.com/GosuBoy/FigmaClipboardInspector" target="_blank" rel="noreferrer" className="github-link"><Github size={16}/> Open source on GitHub <ArrowRight size={14}/></a></div>
    </aside>

    <main className="workspace">
      <header className="top-bar"><div className="breadcrumb"><span>WORKSPACE</span><ChevronRight size={14}/><strong>Clipboard inspector</strong></div><div className="top-right"><span className="local-indicator"><span/> LOCAL PROCESSING</span><a href="https://github.com/GosuBoy/FigmaClipboardInspector" target="_blank" rel="noreferrer" title="View repository"><Github size={18}/></a></div></header>
      <div className="content-wrap">
        <div className="page-intro"><div className="intro-heading"><span className="eyebrow"><span className="eyebrow-dot"/> REVERSE ENGINEERING TOOLS / 001</span><h1>See what <span>Figma</span> copied.</h1><p>Peek inside the clipboard. Decode Kiwi, explore layers, inspect raw formats — all without a server.</p></div><div className="capture-state"><span className={'pulse ' + (decoded ? 'active' : busy ? 'loading' : '')}/><span>{stat}</span>{capture && <small>{capture.source} · {new Date(capture.capturedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})}</small>}</div></div>
        {notice && <div className="warning-banner" role="alert"><CircleAlert size={18}/><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16}/></button></div>}
        <div className="metrics-grid">
          <Metric title="MIME FORMATS" value={capture ? formatCount(capture.flavors.length) : '—'} detail="Representations exposed"/>
          <Metric title="KIWI NODES" value={summary ? formatCount(summary.nodeCount) : busy ? '···' : '—'} detail={decoded ? 'Decoded layer changes' : 'Waiting for Kiwi'}/>
          <Metric title="SCHEMA TYPES" value={summary ? formatCount(summary.schemaDefinitions) : busy ? '···' : '—'} detail="Embedded schema"/>
          <Metric title="PAYLOAD SIZE" value={capture?.payload ? formatSize(capture.payload.byteLength) : '—'} detail="Original compressed bytes"/>
        </div>
        <section className="main-card">
          <nav className="tab-bar" aria-label="Inspector views">{NAV.map(({id,label,icon:Icon}) => <button key={id} className={'tab-button ' + (tab === id ? 'active' : '')} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={16}/><span>{label}</span></button>)}
            <div className="tab-actions">{capture?.payload && <button className="export-button" onClick={() => downloadBytes(capture.payload!.slice().buffer, 'figma-clipboard.kiwi')} title="Download original Kiwi binary"><ArrowDownToLine size={15}/><span>Raw</span></button>}{summary && <button className="export-button" onClick={() => workerRef.current?.postMessage({ kind: 'export' })} title="Export decoded JSON with binary buffers summarized"><FileJson2 size={15}/><span>JSON</span></button>}</div>
          </nav>
          <div className="tab-content">{tab === 'overview' ? renderOverview() : tab === 'layers' ? renderLayers() : tab === 'json' ? renderJson() : tab === 'hex' ? renderHex() : tab === 'html' ? renderHtml() : renderFormats()}</div>
        </section>
        <footer className="page-footer"><span><ShieldCheck size={14}/> Processed locally on your device</span><span>Unofficial research tool · Not affiliated with Figma</span></footer>
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('app')!).render(<App />)
