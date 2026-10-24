import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Binary, Check, ChevronRight,
  ClipboardPaste, Code2, Copy, FileText, Github, Layers, LoaderCircle,
  Search, ShieldCheck, Upload, X,
} from 'lucide-react'
import { buildCapture, errorMessage, flavorsFromClipboardRead, flavorsFromPaste, MAX_INPUT_BYTES } from './lib/clipboard'
import { isKiwi } from './lib/container'
import { createDemoCapture } from './lib/demo'
import { messagePage, type MessageEntry, type MessagePage, type MessagePath } from './lib/message'
import type { Capture, DecodeSummary, Flavor } from './types'
import './style.css'

type Tab = 'message' | 'layers' | 'raw'
type RawTab = 'formats' | 'html' | 'bytes'

type WorkerReply =
  | { kind: 'decoded'; summary: DecodeSummary }
  | { kind: 'viewed'; requestId: number; view: MessagePage }
  | { kind: 'exported'; blob: Blob }
  | { kind: 'bytes-exported'; blob: Blob }
  | { kind: 'error'; message: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MiB'
}

function number(value: number): string {
  return value.toLocaleString('en-US')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function copyText(value: string, onError: (message: string) => void): void {
  void navigator.clipboard.writeText(value).catch((error) => onError(errorMessage(error)))
}

function pathLabel(path: MessagePath): string {
  return '$' + path.map((part) => typeof part === 'number' ? '[' + part + ']' : /^[A-Za-z_$][\w$]*$/.test(part) ? '.' + part : '[' + JSON.stringify(part) + ']').join('')
}

function rowKey(entry: MessageEntry): string {
  return typeof entry.key === 'number' ? '[' + entry.key + ']' : entry.key
}

function App() {
  const [capture, setCapture] = useState<Capture | null>(null)
  const [summary, setSummary] = useState<DecodeSummary | null>(null)
  const [tab, setTab] = useState<Tab>('message')
  const [rawTab, setRawTab] = useState<RawTab>('formats')
  const [flavorIndex, setFlavorIndex] = useState(0)
  const [rawPage, setRawPage] = useState(0)
  const [path, setPath] = useState<MessagePath>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [view, setView] = useState<MessagePage | null>(null)
  const [jump, setJump] = useState('')
  const [layerQuery, setLayerQuery] = useState('')
  const [layerPage, setLayerPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const worker = useRef<Worker | null>(null)
  const currentRequest = useRef(0)

  const navigate = useCallback((next: MessagePath) => {
    setPath(next)
    setPageIndex(0)
    setJump('')
    setTab('message')
  }, [])

  const acceptCapture = useCallback((next: Capture) => {
    worker.current?.terminate()
    worker.current = null
    currentRequest.current += 1
    setCapture(next)
    setSummary(null)
    setView(null)
    setPath([])
    setPageIndex(0)
    setRawPage(0)
    setFlavorIndex(0)
    setLayerQuery('')
    setLayerPage(0)
    setTab('message')
    setBusy(false)
    setExporting(false)
    setNotice(next.notes.length ? next.notes.join(' ') : null)

    if (!next.payload) return
    if (!isKiwi(next.payload)) {
      setNotice('This payload is not a fig-kiwi container. You can still inspect its raw formats.')
      return
    }
    setBusy(true)
    const instance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (worker.current !== instance) return
      const reply = event.data
      switch (reply.kind) {
        case 'decoded':
          setSummary(reply.summary)
          setBusy(false)
          break
        case 'viewed':
          if (reply.requestId === currentRequest.current) setView(reply.view)
          break
        case 'exported':
          setExporting(false)
          downloadBlob(reply.blob, 'figma-kiwi-message.json')
          break
        case 'bytes-exported':
          downloadBlob(reply.blob, 'figma-kiwi-bytes.bin')
          break
        case 'error':
          setBusy(false)
          setExporting(false)
          setNotice(reply.message)
          break
      }
    }
    instance.onerror = (event) => {
      if (worker.current === instance) {
        setBusy(false)
        setExporting(false)
        setNotice('Kiwi decoder error: ' + event.message)
      }
    }
    instance.postMessage({ kind: 'decode', bytes: next.payload.slice() })
  }, [])

  useEffect(() => {
    if (!summary || !worker.current) return
    const requestId = ++currentRequest.current
    setView(null)
    worker.current.postMessage({ kind: 'view', requestId, path, page: pageIndex })
  }, [summary, path, pageIndex])

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      void flavorsFromPaste(event)
        .then((flavors) => acceptCapture(buildCapture('Paste event', flavors)))
        .catch((error) => setNotice(errorMessage(error)))
    }
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('paste', paste)
      worker.current?.terminate()
    }
  }, [acceptCapture])

  const readClipboard = async () => {
    try {
      const flavors = await flavorsFromClipboardRead()
      acceptCapture(buildCapture('Clipboard API', flavors))
    } catch (error) {
      setNotice('Clipboard read failed: ' + errorMessage(error) + '. Try ⌘V or Ctrl+V on this page.')
    }
  }

  const openFile = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      setNotice('File exceeds the 48 MiB input limit.')
      return
    }
    try {
      const isHtml = /\.(html?|txt)$/i.test(file.name) || file.type.startsWith('text/')
      const flavor: Flavor = isHtml
        ? { name: file.name, type: /\.(html?)$/i.test(file.name) ? 'text/html' : 'text/plain', size: file.size, text: await file.text() }
        : { name: file.name, type: file.type || 'application/octet-stream', size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) }
      acceptCapture(buildCapture('File', [flavor]))
    } catch (error) {
      setNotice('Cannot open file: ' + errorMessage(error))
    }
  }

  const exportMessage = () => {
    if (!summary || !worker.current) return
    setExporting(true)
    worker.current.postMessage({ kind: 'export' })
  }

  const matchingLayers = useMemo(() => {
    if (!summary) return []
    const q = layerQuery.trim().toLowerCase()
    return q ? summary.nodes.filter((item) => item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)) : summary.nodes
  }, [summary, layerQuery])

  const totalLayerPages = Math.max(1, Math.ceil(matchingLayers.length / 100))
  const visibleLayers = matchingLayers.slice(layerPage * 100, (layerPage + 1) * 100)
  const rawView = capture?.payload ? messagePage(capture.payload, [], rawPage) : null
  const selectedFlavor = capture?.flavors[flavorIndex]
  const allPages = view ? Math.max(1, Math.ceil(view.total / view.pageSize)) : 1
  const canJump = view?.kind === 'array' || view?.kind === 'bytes' || view?.kind === 'string'

  const renderPager = (current: number, total: number, update: (page: number) => void) => total > 1
    ? <div className="pager">
        <button disabled={current === 0} onClick={() => update(current - 1)}><ArrowLeft size={14}/> Previous</button>
        <span>Page {number(current + 1)} of {number(total)}</span>
        <button disabled={current + 1 >= total} onClick={() => update(current + 1)}>Next <ArrowRight size={14}/></button>
      </div>
    : null

  return <div className="app">
    <header className="site-header">
      <div className="brand"><span className="brand-glyph"><span/><span/><span/><span/></span><strong>Kiwi Inspector</strong><span className="brand-subtitle">Figma clipboard</span></div>
      <div className="header-links"><span className="local"><ShieldCheck size={15}/> Local only</span><a href="https://github.com/GosuBoy/FigmaClipboardInspector" rel="noreferrer" target="_blank" aria-label="Open GitHub repository"><Github size={18}/></a></div>
    </header>

    <main className="main">
      <div className="intro">
        <h1>Explore the Figma clipboard.</h1>
        <p>Copy a frame or layer in Figma, then paste here to inspect the complete Kiwi message.</p>
      </div>
      <section className="input-bar" aria-label="Capture options" onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void openFile(file) }}>
        <button className="primary-button" onClick={() => void readClipboard()}><ClipboardPaste size={17}/> Read clipboard</button>
        <button className="simple-button" onClick={() => fileInput.current?.click()}><Upload size={16}/> Open file</button>
        <button className="simple-button demo-button" onClick={() => acceptCapture(createDemoCapture())}>Try demo</button>
        <span className="paste-hint">{dragging ? 'Drop file to inspect' : 'Or press ⌘V / Ctrl+V anywhere'}</span>
        <input ref={fileInput} type="file" className="visually-hidden" accept=".html,.htm,.txt,.kiwi,.bin" aria-label="Choose file to inspect" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }} />
      </section>

      {notice && <div className="notice" role="alert"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={16}/></button></div>}

      {!capture ? <div className="empty">
        <div className="empty-icon"><ClipboardPaste size={32} strokeWidth={1.5}/></div>
        <h2>Nothing pasted yet</h2>
        <p>Paste a copied Figma layer, open a clipboard HTML / Kiwi file, or load the demo to explore the inspector.</p>
        <button className="simple-button" onClick={() => acceptCapture(createDemoCapture())}>Explore sample message <ArrowRight size={15}/></button>
      </div> : <>
        <div className="capture-summary">
          <div className="capture-title">
            <span className="tiny-indicator">{busy ? <LoaderCircle size={14} className="spinner"/> : summary ? <Check size={14}/> : <FileText size={14}/>}</span>
            <strong>{busy ? 'Decoding message…' : summary ? 'Kiwi message decoded' : 'Clipboard captured'}</strong>
            <small>{capture.source}</small>
          </div>
          <div className="summary-items">
            <span>{capture.flavors.length} formats</span>
            {capture.payload && <span>{formatSize(capture.payload.byteLength)} compressed</span>}
            {summary && <><span>v{summary.version}</span><span>{number(summary.nodeCount)} nodes</span><span>{number(summary.blobCount)} blobs</span></>}
          </div>
        </div>
        <section className="viewer">
          <div className="tabs" role="tablist" aria-label="Inspector views">
            <button role="tab" aria-selected={tab === 'message'} className={tab === 'message' ? 'active' : ''} onClick={() => setTab('message')}><Code2 size={16}/> Kiwi message</button>
            <button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}><Layers size={16}/> Layers</button>
            <button role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}><Binary size={16}/> Raw</button>
          </div>

          {tab === 'message' && <div className="panel">
            <div className="panel-header">
              <div><h2>Complete Kiwi message</h2><p>Browse every field, node, and blob. Large values load a page at a time.</p></div>
              <button className="download-button" disabled={!summary || exporting} onClick={exportMessage}>{exporting ? <LoaderCircle size={15} className="spinner"/> : <ArrowDownToLine size={15}/>} {exporting ? 'Exporting…' : 'Download full JSON'}</button>
            </div>
            {!summary ? <div className="not-available">{busy ? 'Decoding the embedded Kiwi schema and message…' : 'No decoded Kiwi message is available in this capture. Check the Raw tab for the accessible clipboard formats.'}</div> : <>
              <div className="breadcrumb" aria-label="Message path">
                <button onClick={() => navigate([])}>Message</button>
                {path.map((segment, index) => <span className="crumb" key={index}><ChevronRight size={13}/><button onClick={() => navigate(path.slice(0, index + 1))}>{typeof segment === 'number' ? '[' + segment + ']' : segment}</button></span>)}
                <button className="copy-path" title="Copy JSON path" onClick={() => copyText(pathLabel(path), setNotice)}><Copy size={14}/></button>
              </div>
              {!view ? <div className="loading-row"><LoaderCircle size={16} className="spinner"/> Loading field…</div> : <>
                <div className="value-header">
                  <span className="kind">{view.kind}</span><span>{view.preview}</span>
                  {view.kind === 'bytes' && <button onClick={() => worker.current?.postMessage({ kind: 'export-bytes', path })}><ArrowDownToLine size={14}/> Download bytes</button>}
                </div>
                {(view.kind === 'object' || view.kind === 'array') ? <div className="entry-list" role="list">
                  <div className="entry-head"><span>Field / index</span><span>Type</span><span>Value</span></div>
                  {view.entries.map((entry) => <button role="listitem" className="entry" key={String(entry.key)} onClick={() => navigate([...path, entry.key])} title={rowKey(entry)}>
                    <span className="entry-key">{rowKey(entry)}</span><span className="kind kind-small">{entry.kind}</span><span className="entry-preview">{entry.preview}</span><ChevronRight size={14} className="entry-arrow"/>
                  </button>)}
                  {!view.entries.length && <div className="no-entries">This {view.kind} is empty.</div>}
                </div> : view.kind === 'bytes' ? <pre className="data-value hex">{view.hex || '(empty buffer)'}</pre>
                  : <pre className="data-value">{view.text || (view.kind === 'string' ? '(empty string)' : '')}</pre>}
                {(view.kind === 'object' || view.kind === 'array' || view.kind === 'bytes' || view.kind === 'string') && <div className="page-controls">
                  <span>Showing {view.total ? number(view.start + 1) + '–' + number(view.end) + ' of ' + number(view.total) : '0'} {view.kind === 'bytes' ? 'bytes' : view.kind === 'string' ? 'characters' : 'entries'}</span>
                  {canJump && view.total > view.pageSize && <form className="jump-form" onSubmit={(event) => {
                    event.preventDefault()
                    const index = Number(jump)
                    if (!Number.isSafeInteger(index) || index < 0 || index >= view.total) { setNotice('Enter an index between 0 and ' + (view.total - 1)); return }
                    if (view.kind === 'array') navigate([...path, index])
                    else setPageIndex(Math.floor(index / view.pageSize))
                  }}><input type="number" min={0} max={Math.max(0, view.total - 1)} value={jump} onChange={(event) => setJump(event.target.value)} placeholder="Jump to index" aria-label="Jump to index"/><button type="submit">Go</button></form>}
                  {renderPager(pageIndex, allPages, setPageIndex)}
                </div>}
                <p className="viewer-footnote">The decoded message stays in memory in the worker. No fields or bytes are discarded; pages only limit what's drawn on screen.</p>
              </>}
            </>}
          </div>}

          {tab === 'layers' && <div className="panel">
            <div className="panel-header"><div><h2>Layers</h2><p>Pick a layer to jump to its complete NodeChange record in the message.</p></div></div>
            {!summary ? <div className="not-available">No decoded layer data. Paste a Figma frame or load the demo.</div> : <>
              <label className="search"><Search size={17}/><input value={layerQuery} onChange={(event) => { setLayerQuery(event.target.value); setLayerPage(0) }} placeholder="Find a layer by name, type, or ID…" aria-label="Search layers" /></label>
              <div className="layer-list">
                {visibleLayers.map((layer) => <button key={layer.index} className="layer" onClick={() => navigate(['nodeChanges', layer.index])}>
                  <span className="layer-icon">{layer.type.slice(0, 1)}</span>
                  <span className="layer-name"><strong>{layer.name}</strong><small>{layer.id}{layer.size ? ' · ' + layer.size : ''}</small></span>
                  <span className="layer-type">{layer.type}</span><ChevronRight size={15}/>
                </button>)}
                {!visibleLayers.length && <div className="no-entries">No layers match that search.</div>}
              </div>
              <div className="page-controls"><span>{number(matchingLayers.length)} matching layers{summary.truncated ? ' (index limited; all records accessible in Kiwi message)' : ''}</span>{renderPager(layerPage, totalLayerPages, setLayerPage)}</div>
            </>}
          </div>}

          {tab === 'raw' && <div className="panel">
            <div className="panel-header"><div><h2>Raw clipboard</h2><p>Original representations exposed by the browser.</p></div>{capture.payload && <button className="download-button" onClick={() => downloadBlob(new Blob([capture.payload!.slice().buffer]), 'figma-clipboard.kiwi')}><ArrowDownToLine size={15}/> Download Kiwi</button>}</div>
            <div className="subtabs">
              <button className={rawTab === 'formats' ? 'selected' : ''} onClick={() => setRawTab('formats')}>MIME formats</button>
              <button className={rawTab === 'html' ? 'selected' : ''} onClick={() => setRawTab('html')}>HTML</button>
              <button className={rawTab === 'bytes' ? 'selected' : ''} onClick={() => setRawTab('bytes')}>Hex</button>
            </div>
            {rawTab === 'formats' && <>
              <div className="format-list">{capture.flavors.map((flavor, index) => <button key={index} className={flavorIndex === index ? 'format selected' : 'format'} onClick={() => setFlavorIndex(index)}><span>{flavor.type}</span><small>{formatSize(flavor.size)}</small></button>)}</div>
              {selectedFlavor && <pre className="data-value raw-preview">{selectedFlavor.text ? selectedFlavor.text.slice(0, 12000) + (selectedFlavor.text.length > 12000 ? '\n… preview only' : '') : selectedFlavor.bytes ? messagePage(selectedFlavor.bytes).hex : 'This flavor has no readable data.'}</pre>}
              {capture.metadata !== null && <div className="meta"><strong>Figma metadata</strong><pre>{JSON.stringify(capture.metadata, null, 2)}</pre></div>}
            </>}
            {rawTab === 'html' && <>
              <pre className="data-value raw-preview">{capture.html ? capture.html.slice(0, 20000) + (capture.html.length > 20000 ? '\n… preview only; use Download HTML for the complete source.' : '') : 'No text/html representation in this capture.'}</pre>
              {capture.html && <button className="simple-button" onClick={() => downloadBlob(new Blob([capture.html], { type: 'text/html' }), 'figma-clipboard.html')}><ArrowDownToLine size={15}/> Download HTML</button>}
            </>}
            {rawTab === 'bytes' && (rawView ? <>
              <pre className="data-value hex">{rawView.hex}</pre>
              <div className="page-controls"><span>Bytes {number(rawView.start + 1)}–{number(rawView.end)} of {number(rawView.total)}</span>{renderPager(rawPage, Math.ceil(rawView.total / rawView.pageSize), setRawPage)}</div>
            </> : <div className="not-available">No binary Kiwi payload available.</div>)}
          </div>}
        </section>
      </>}

      <footer className="footer"><span><ShieldCheck size={15}/> Your clipboard never leaves your browser.</span><span>Unofficial Figma research tool · <a href="https://github.com/GosuBoy/FigmaClipboardInspector" rel="noreferrer" target="_blank">Source on GitHub</a></span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('app')!).render(<App />)
