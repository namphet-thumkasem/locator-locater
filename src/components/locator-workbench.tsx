"use client";

import {
  BadgeHelp,
  Bookmark,
  Check,
  Clipboard,
  Code2,
  Copy,
  FileInput,
  Keyboard,
  Layers3,
  Link2,
  Monitor,
  MousePointer2,
  PanelTop,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookmarkletCode, formatSnippet } from "@/lib/formatters";
import { createPageSnapshot, documentFromSnapshot, parseWorkbenchInput } from "@/lib/html";
import {
  findActionTarget,
  findByLocatorId,
  generateLocatorCandidates,
  getElementChain,
  summarizeElement
} from "@/lib/locator";
import type {
  ElementSummary,
  Framework,
  LocatorCandidate,
  RenderedHtmlBundle,
  SnippetMode,
  SnapshotResult,
  WorkbenchSource
} from "@/lib/types";

const STORAGE_KEY = "locator-workbench:last-input";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <title>Demo Dashboard</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #17202a; }
      .shell { max-width: 920px; margin: 32px auto; padding: 28px; background: white; border: 1px solid #d9e2ec; border-radius: 12px; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
      .primary { background: #0f766e; color: white; border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 700; }
      .secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; }
      label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
      input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; width: 280px; }
      .row { display: flex; gap: 14px; align-items: end; }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="toolbar">
        <div>
          <h1>Orders</h1>
          <p>Review pending fulfillment work.</p>
        </div>
        <button class="primary" data-testid="create-order">Create order</button>
      </div>
      <form class="row">
        <div>
          <label for="customer-email">Customer email</label>
          <input id="customer-email" name="email" type="email" placeholder="name@example.test" />
        </div>
        <button class="secondary" type="submit" aria-label="Search orders">Search</button>
      </form>
    </main>
  </body>
</html>`;

type SelectionState = {
  target: ElementSummary;
  chain: ElementSummary[];
  candidates: LocatorCandidate[];
};

type SourceMode = "html" | "url";

export function LocatorWorkbench() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("html");
  const [input, setInput] = useState(SAMPLE_HTML);
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState<WorkbenchSource | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [error, setError] = useState("");
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [framework, setFramework] = useState<Framework>("playwright");
  const [snippetMode, setSnippetMode] = useState<SnippetMode>("action");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const selectedCandidate = useMemo(() => {
    if (!selection?.candidates.length) return null;
    return (
      selection.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
      selection.candidates.find((candidate) => candidate.recommended) ??
      selection.candidates[0]
    );
  }, [selectedCandidateId, selection]);

  const snippet = useMemo(() => {
    if (!selectedCandidate) return null;
    return formatSnippet(selectedCandidate, selection?.candidates ?? [], framework, snippetMode, selection?.target ?? null);
  }, [framework, selectedCandidate, selection, snippetMode]);

  const selectLocatorId = useCallback(
    (locatorId: string) => {
      if (!snapshot) return;
      const document = documentFromSnapshot(snapshot.html);
      const target = findByLocatorId(document, locatorId);
      if (!target) return;

      const chain = getElementChain(target);
      const candidates = generateLocatorCandidates(document, target);
      setSelection({
        target: summarizeElement(target),
        chain,
        candidates
      });
      setSelectedCandidateId(candidates.find((candidate) => candidate.recommended)?.id ?? candidates[0]?.id ?? "");
      markIframeSelection(locatorId);
    },
    [snapshot]
  );

  const importValue = useCallback((rawValue: string, persist: boolean) => {
    const parsed = parseWorkbenchInput(rawValue);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    const nextSnapshot = createPageSnapshot(parsed.source.html);
    setError("");
    setSource(parsed.source);
    setSnapshot(nextSnapshot);
    setSelection(null);
    setSelectedCandidateId("");
    if (persist) window.localStorage.setItem(STORAGE_KEY, rawValue);
  }, []);

  useEffect(() => {
    const restoredInput = window.localStorage.getItem(STORAGE_KEY) ?? SAMPLE_HTML;
    setInput(restoredInput);
    importValue(restoredInput, false);
  }, [importValue]);

  const importInput = useCallback(() => {
    importValue(input, true);
  }, [importValue, input]);

  const importUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) {
      setError("Enter a URL to fetch.");
      return;
    }

    setIsFetchingUrl(true);
    setError("");

    try {
      const response = await fetch("/api/ingest-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const body = (await response.json().catch(() => null)) as Partial<RenderedHtmlBundle> & { message?: string } | null;

      if (!response.ok) {
        throw new Error(body?.message || "Could not fetch that URL.");
      }

      if (!body || typeof body.html !== "string") {
        throw new Error("URL response did not include HTML.");
      }

      const bundle: RenderedHtmlBundle = {
        html: body.html,
        url: typeof body.url === "string" ? body.url : url,
        title: typeof body.title === "string" ? body.title : undefined,
        capturedAt: typeof body.capturedAt === "string" ? body.capturedAt : new Date().toISOString(),
        viewport: body.viewport
      };
      const serialized = JSON.stringify(bundle, null, 2);
      setInput(serialized);
      importValue(serialized, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fetch that URL.");
    } finally {
      setIsFetchingUrl(false);
    }
  }, [importValue, urlInput]);

  const refreshSource = useCallback(() => {
    if (sourceMode === "url") {
      void importUrl();
      return;
    }
    importInput();
  }, [importInput, importUrl, sourceMode]);

  const attachIframeHandlers = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;

    frameDocument.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const eventElement = eventTargetElement(event.target);
        const target = eventElement ? findActionTarget(eventElement) : null;
        const locatorId = target?.getAttribute("data-locator-id");
        if (locatorId) selectLocatorId(locatorId);
      },
      true
    );

    frameDocument.addEventListener(
      "mouseover",
      (event) => {
        const eventElement = eventTargetElement(event.target);
        const target = eventElement ? findActionTarget(eventElement) : null;
        frameDocument.querySelectorAll("[data-locator-hover]").forEach((element) => {
          element.removeAttribute("data-locator-hover");
        });
        target?.setAttribute("data-locator-hover", "true");
      },
      true
    );
  }, [selectLocatorId]);

  const copySnippet = async () => {
    if (!snippet) return;
    await copyText(snippet.code);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1200);
  };

  const copyBookmarklet = async () => {
    await copyText(bookmarkletCode());
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1200);
  };

  const clearAll = () => {
    setInput("");
    setUrlInput("");
    setSource(null);
    setSnapshot(null);
    setSelection(null);
    setSelectedCandidateId("");
    setError("");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <main className="workbench-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Code2 size={21} />
          </div>
          <h1>Locator Workbench</h1>
          <span className="version-pill">v0.1.0</span>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button">
            <Keyboard size={15} />
            Shortcuts
          </button>
          <button className="ghost-button" type="button">
            <Settings size={15} />
            Settings
          </button>
          <button className="ghost-button" type="button">
            <BadgeHelp size={15} />
            Help
          </button>
          <span className="header-divider" />
          <button className="icon-button" aria-label="Theme" type="button">
            <Sun size={17} />
          </button>
          <span className="sandbox-pill">
            <span />
            Sandbox: On
          </span>
          <button className="secondary-button compact-button" onClick={clearAll} type="button">
            <Trash2 size={15} />
            Clear All
          </button>
        </div>
      </header>

      <section className="workbench-grid" aria-label="Locator workbench">
        <aside className="pane source-pane">
          <NumberedTitle index={1} title="Source" />
          <div className="source-tabs" aria-label="Source mode">
            <button className={sourceMode === "html" ? "active" : ""} onClick={() => setSourceMode("html")} type="button">
              <FileInput size={15} />
              HTML
            </button>
            <button className={sourceMode === "url" ? "active" : ""} onClick={() => setSourceMode("url")} type="button">
              <Link2 size={15} />
              URL
            </button>
          </div>
          {sourceMode === "html" ? (
            <>
              <div className="input-header">
                <span>Paste HTML</span>
                <button onClick={() => setInput(SAMPLE_HTML)} type="button">
                  <RotateCcw size={14} />
                  Reset
                </button>
              </div>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                spellCheck={false}
                aria-label="HTML or rendered HTML bundle"
              />
              <div className="input-stats">
                {input.length.toLocaleString()} characters · {Math.max(1, Math.round(input.length / 1024))} KB
              </div>
            </>
          ) : (
            <>
              <div className="input-header">
                <span>Page URL</span>
                <button onClick={() => setUrlInput("")} type="button">
                  <RotateCcw size={14} />
                  Clear
                </button>
              </div>
              <input
                className="url-input"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com/dashboard"
                spellCheck={false}
                aria-label="Page URL"
              />
              <p className="small-copy">Renders the page in Chromium, captures the DOM, then sanitizes the snapshot locally.</p>
            </>
          )}
          {error ? <div className="error-note">{error}</div> : null}
          <button className="primary-button" disabled={isFetchingUrl} onClick={sourceMode === "url" ? importUrl : importInput} type="button">
            {isFetchingUrl ? <RefreshCw size={16} /> : <ShieldCheck size={16} />}
            {sourceMode === "url" ? (isFetchingUrl ? "Rendering URL" : "Render URL snapshot") : "Import snapshot"}
          </button>

          <div className="subsection">
            <SectionTitle icon={<Clipboard size={16} />} title="Capture Bookmarklet" />
            <p className="small-copy">Copies document HTML plus URL, title, capture time, and viewport.</p>
            <button className="secondary-button full-width" onClick={copyBookmarklet} type="button">
              <Copy size={16} />
              Copy bookmarklet
            </button>
          </div>

          <MetadataPanel source={source} snapshot={snapshot} />
          <div className="subsection option-list">
            <div className="mini-heading">Options</div>
            <label>
              <input checked readOnly type="checkbox" />
              Remove scripts
            </label>
            <label>
              <input checked readOnly type="checkbox" />
              Remove external resources
            </label>
            <label>
              <input readOnly type="checkbox" />
              Sanitize IDs
            </label>
          </div>
          <div className="subsection encoding-block">
            <label className="control-label" htmlFor="encoding-select">
              Encoding
            </label>
            <select id="encoding-select" value="utf-8" onChange={() => undefined}>
              <option value="utf-8">UTF-8</option>
            </select>
          </div>
        </aside>

        <section className="pane preview-pane">
          <div className="pane-toolbar">
            <NumberedTitle index={2} title="Sandbox Preview" />
            <span className="status-pill">{selection ? "Target selected" : "Click a target"}</span>
          </div>
          <div className="preview-controls">
            <button className="icon-button" onClick={refreshSource} aria-label="Refresh preview" type="button">
              <RefreshCw size={16} />
            </button>
            <div className="device-control" aria-label="Preview device">
              <button className="active" type="button" aria-label="Desktop preview">
                <Monitor size={16} />
              </button>
              <button type="button" aria-label="Tablet preview">
                <PanelTop size={15} />
              </button>
              <button type="button" aria-label="Mobile preview">
                <Smartphone size={15} />
              </button>
            </div>
            <select aria-label="Viewport size" value="1440x900" onChange={() => undefined}>
              <option value="1440x900">1440 x 900</option>
            </select>
            <select aria-label="Preview zoom" value="fit" onChange={() => undefined}>
              <option value="fit">Fit</option>
            </select>
          </div>
          <div className="preview-frame-wrap">
            {snapshot ? (
              <iframe
                ref={iframeRef}
                title="Snapshot preview"
                sandbox="allow-same-origin"
                srcDoc={snapshot.html}
                onLoad={attachIframeHandlers}
              />
            ) : (
              <div className="empty-state">Import HTML to render a sanitized snapshot.</div>
            )}
          </div>
          <div className="preview-footer">
            <div className="preview-tabs">
              <button className="active" type="button">HTML</button>
              <button type="button">DOM Tree</button>
              <button type="button">Console</button>
            </div>
            <div className="crumb-line">
              {selection ? selection.chain.slice().reverse().map((item) => item.tagName).join(" › ") : "No target selected"}
            </div>
            <span className="footer-status">Sanitized · {snapshot ? "ready" : "waiting"}</span>
          </div>
        </section>

        <aside className="pane inspector-pane">
          <NumberedTitle index={3} title="Inspector" />
          {selection ? (
            <>
              <TargetDetails target={selection.target} />
              {/* <ElementChain chain={selection.chain} onSelect={selectLocatorId} selectedId={selection.target.locatorId} /> */}
              <CandidateList
                candidates={selection.candidates}
                selectedId={selectedCandidate?.id ?? ""}
                onSelect={setSelectedCandidateId}
              />
              <SnippetPanel
                framework={framework}
                mode={snippetMode}
                snippet={snippet?.code ?? ""}
                warning={snippet?.warning}
                copied={copyState === "copied"}
                onFrameworkChange={setFramework}
                onModeChange={setSnippetMode}
                onCopy={copySnippet}
              />
            </>
          ) : (
            <div className="empty-state compact">Select a button, input, or link in the preview.</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function NumberedTitle({ index, title }: { index: number; title: string }) {
  return (
    <div className="numbered-title">
      <span>{index}</span>
      <h2>{title}</h2>
    </div>
  );
}

function MetadataPanel({ source, snapshot }: { source: WorkbenchSource | null; snapshot: SnapshotResult | null }) {
  return (
    <div className="metadata-list">
      <div>
        <span>Source</span>
        <strong>{source?.kind === "bundle" ? "Rendered bundle" : source ? "HTML source" : "None"}</strong>
      </div>
      <div>
        <span>Title</span>
        <strong>{source?.metadata?.title ?? snapshot?.title ?? "Not provided"}</strong>
      </div>
      <div>
        <span>URL</span>
        <strong>{source?.metadata?.url ?? "Not provided"}</strong>
      </div>
      <div>
        <span>Sanitizer</span>
        <strong>{snapshot?.warnings.length ? `${snapshot.warnings.length} warnings` : snapshot ? "Clean" : "Waiting"}</strong>
      </div>
      {source?.metadata?.ingestion ? (
        <>
          <div>
            <span>Capture</span>
            <strong>
              {source.metadata.ingestion.mode === "rendered-dom" ? "Rendered DOM" : "Source HTML"} · CSS{" "}
              {source.metadata.ingestion.stylesheetsInlined}/{source.metadata.ingestion.stylesheetsInlined + source.metadata.ingestion.stylesheetsSkipped}
            </strong>
          </div>
          <div>
            <span>Scripts</span>
            <strong>
              {source.metadata.ingestion.scriptsDetected} captured, stripped in preview
            </strong>
          </div>
        </>
      ) : null}
      {source?.metadata?.ingestion?.warnings.length ? (
        <div className="metadata-warning">
          <span>Limits</span>
          <strong>{source.metadata.ingestion.warnings[0]}</strong>
        </div>
      ) : null}
    </div>
  );
}

function TargetDetails({ target }: { target: ElementSummary }) {
  const readableName = target.name || target.text || target.attributes.id || target.tagName;
  const visibleAttributes = Object.entries(target.attributes)
    .filter(([name]) => ["id", "class", "name", "type", "role", "aria-label", "data-testid", "data-test", "data-cy"].includes(name))
    .slice(0, 5);
  return (
    <div className="target-card">
      <div className="target-card-head">
        <div>
          <span className="field-label">Selected Target</span>
          <strong>{readableName}</strong>
        </div>
        <span className="tag-badge">{target.tagName}</span>
      </div>
      <div className="attribute-grid">
        <span>role</span>
        <code>{target.role ?? "none"}</code>
        <span>text</span>
        <code>{target.text || "empty"}</code>
        {visibleAttributes.map(([name, value]) => (
          <FragmentPair key={name} name={name} value={value} />
        ))}
      </div>
    </div>
  );
}

function FragmentPair({ name, value }: { name: string; value: string }) {
  return (
    <>
      <span>{name}</span>
      <code>{value}</code>
    </>
  );
}

function ElementChain({
  chain,
  onSelect,
  selectedId
}: {
  chain: ElementSummary[];
  onSelect: (locatorId: string) => void;
  selectedId: string;
}) {
  return (
    <div className="subsection">
      <div className="mini-heading">Element Chain</div>
      <div className="chain-list">
        {chain.map((item) => (
          <button
            className={item.locatorId === selectedId ? "chain-item selected" : "chain-item"}
            key={item.locatorId}
            onClick={() => onSelect(item.locatorId)}
            type="button"
          >
            <span>{item.locatorId}</span>
            <strong>{item.tagName}</strong>
            <small>{item.name || item.text || item.attributes.id || "unnamed"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function CandidateList({
  candidates,
  selectedId,
  onSelect
}: {
  candidates: LocatorCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="subsection">
      <div className="mini-heading">Locator Candidates</div>
      <div className="candidate-list candidate-table">
        {candidates.map((candidate, index) => (
          <button
            className={candidate.id === selectedId ? "candidate selected" : "candidate"}
            key={candidate.id}
            onClick={() => onSelect(candidate.id)}
            type="button"
          >
            <span className="rank-cell">{index + 1}</span>
            <span className="candidate-topline">
              <strong>{candidate.strategy}</strong>
              {candidate.recommended ? <span className="recommended">Recommended</span> : null}
            </span>
            <code>{candidate.value}</code>
            <span className="candidate-meta">
              {candidate.unique ? "Unique" : `${candidate.matchCount} matches`} · score {candidate.score}
            </span>
            {candidate.warnings.length ? (
              <span className="candidate-warning">{candidate.warnings[0]}</span>
            ) : null}
            <span className="score-bar" style={{ ["--score" as string]: `${Math.max(8, Math.min(100, candidate.score))}%` }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function SnippetPanel({
  framework,
  mode,
  snippet,
  warning,
  copied,
  onFrameworkChange,
  onModeChange,
  onCopy
}: {
  framework: Framework;
  mode: SnippetMode;
  snippet: string;
  warning?: string;
  copied: boolean;
  onFrameworkChange: (framework: Framework) => void;
  onModeChange: (mode: SnippetMode) => void;
  onCopy: () => void;
}) {
  return (
    <div className="subsection snippet-section">
      <div className="mini-heading">Snippet Output</div>
      <label className="control-label" htmlFor="framework-select">
        Framework
      </label>
      <select id="framework-select" value={framework} onChange={(event) => onFrameworkChange(event.target.value as Framework)}>
        <option value="playwright">Playwright</option>
        <option value="cypress">Cypress</option>
        <option value="selenium">Selenium</option>
        <option value="robot">Robot Framework</option>
        <option value="generic">Generic</option>
      </select>

      <div className="segmented-control" aria-label="Snippet mode">
        <button className={mode === "locator" ? "active" : ""} onClick={() => onModeChange("locator")} type="button">
          <Code2 size={15} />
          Locator
        </button>
        <button className={mode === "action" ? "active" : ""} onClick={() => onModeChange("action")} type="button">
          <MousePointer2 size={15} />
          Action
        </button>
      </div>

      {warning ? <div className="warning-note">{warning}</div> : null}
      <pre className="snippet-code">{snippet}</pre>
      <button className="primary-button full-width" onClick={onCopy} type="button">
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy snippet"}
      </button>
    </div>
  );
}

function markIframeSelection(locatorId: string) {
  const frame = document.querySelector<HTMLIFrameElement>("iframe[title='Snapshot preview']");
  const frameDocument = frame?.contentDocument;
  if (!frameDocument) return;

  frameDocument.querySelectorAll("[data-locator-selected]").forEach((element) => {
    element.removeAttribute("data-locator-selected");
  });
  frameDocument.querySelector(`[data-locator-id="${CSS.escape(locatorId)}"]`)?.setAttribute("data-locator-selected", "true");
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const maybeElement = target as Element;
  return maybeElement.nodeType === 1 && typeof maybeElement.getAttribute === "function" ? maybeElement : null;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}
