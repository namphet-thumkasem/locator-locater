"use client";

import {
  BadgeHelp,
  Check,
  Clipboard,
  Code2,
  Copy,
  FileInput,
  Keyboard,
  Link2,
  Monitor,
  Moon,
  MousePointer2,
  PanelTop,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookmarkletCode, formatSnippet } from "@/lib/formatters";
import { createPageSnapshot, documentFromSnapshot, parseWorkbenchInput, testIdAttributes } from "@/lib/html";
import {
  findActionTarget,
  findByLocatorId,
  generateLocatorCandidates,
  manualLocatorCandidate,
  summarizeElement
} from "@/lib/locator";
import type {
  ElementSummary,
  Framework,
  LocatorCandidate,
  LocatorStrategy,
  RenderedHtmlBundle,
  SnippetMode,
  SnapshotResult,
  WorkbenchSource
} from "@/lib/types";

const STORAGE_KEY = "locator-workbench:last-input";
const SETTINGS_KEY = "locator-workbench:test-id-attributes";
const THEME_KEY = "locator-workbench:theme";
const DISMISS_OVERLAYS_KEY = "locator-workbench:dismiss-overlays";
const DEFAULT_TEST_ID_INPUT = "data-testid, data-test, data-cy, data-qa";

const PREVIEW_VIEWPORTS = [
  { id: "1440x900", label: "1440 x 900", width: 1440, height: 900, device: "desktop" },
  { id: "1024x768", label: "1024 x 768", width: 1024, height: 768, device: "tablet" },
  { id: "768x1024", label: "768 x 1024", width: 768, height: 1024, device: "tablet" },
  { id: "390x844", label: "390 x 844", width: 390, height: 844, device: "mobile" },
  { id: "360x740", label: "360 x 740", width: 360, height: 740, device: "mobile" }
] as const;

const DEVICE_DEFAULT_VIEWPORT: Record<PreviewDevice, PreviewViewportId> = {
  desktop: "1440x900",
  tablet: "768x1024",
  mobile: "390x844"
};

const PREVIEW_ZOOMS = [
  { value: "fit", label: "Fit" },
  { value: "100", label: "100%" },
  { value: "75", label: "75%" },
  { value: "50", label: "50%" }
] as const;


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
  candidates: LocatorCandidate[];
};

type SourceMode = "html" | "url";
type ManualStrategy = Extract<LocatorStrategy, "testId" | "css" | "xpath" | "text">;
type CopyState = "idle" | "snippet" | "selector" | "all" | "bookmarklet" | "manualSnippet" | "manualSelector";
type DialogPanel = "shortcuts" | "settings" | "help" | null;
type PreviewDevice = (typeof PREVIEW_VIEWPORTS)[number]["device"];
type PreviewViewportId = (typeof PREVIEW_VIEWPORTS)[number]["id"];
type PreviewZoom = (typeof PREVIEW_ZOOMS)[number]["value"];
type ThemeMode = "light" | "dark";

export function LocatorWorkbench() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const htmlInputRef = useRef<HTMLTextAreaElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const settingsInputRef = useRef<HTMLInputElement | null>(null);
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
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [testIdAttributesInput, setTestIdAttributesInput] = useState(DEFAULT_TEST_ID_INPUT);
  const [manualStrategy, setManualStrategy] = useState<ManualStrategy>("css");
  const [manualValue, setManualValue] = useState("");
  const [activeDialog, setActiveDialog] = useState<DialogPanel>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [dismissOverlays, setDismissOverlays] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [previewViewportId, setPreviewViewportId] = useState<PreviewViewportId>("1440x900");
  const [previewZoom, setPreviewZoom] = useState<PreviewZoom>("fit");
  const [previewFitScale, setPreviewFitScale] = useState(1);

  const configuredTestIdAttributes = useMemo(() => {
    return testIdAttributes(testIdAttributesInput.split(","));
  }, [testIdAttributesInput]);

  const selectedViewport = useMemo(() => {
    return PREVIEW_VIEWPORTS.find((viewport) => viewport.id === previewViewportId) ?? PREVIEW_VIEWPORTS[0];
  }, [previewViewportId]);

  const previewScale = previewZoom === "fit" ? previewFitScale : Number(previewZoom) / 100;

  const previewShellStyle = useMemo(() => {
    return {
      width: `${Math.round(selectedViewport.width * previewScale)}px`,
      height: `${Math.round(selectedViewport.height * previewScale)}px`
    };
  }, [previewScale, selectedViewport.height, selectedViewport.width]);

  const previewCanvasStyle = useMemo(() => {
    return {
      width: `${selectedViewport.width}px`,
      height: `${selectedViewport.height}px`,
      transform: previewScale === 1 ? undefined : `scale(${previewScale})`
    };
  }, [previewScale, selectedViewport.height, selectedViewport.width]);

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

  const manualCandidate = useMemo(() => {
    if (!snapshot || !manualValue.trim()) return null;
    const document = documentFromSnapshot(snapshot.html);
    return manualLocatorCandidate(document, manualStrategy, manualValue, {
      testIdAttribute: configuredTestIdAttributes[0]
    });
  }, [configuredTestIdAttributes, manualStrategy, manualValue, snapshot]);

  const manualSnippet = useMemo(() => {
    if (!manualCandidate) return null;
    return formatSnippet(manualCandidate, [manualCandidate, ...(selection?.candidates ?? [])], framework, snippetMode, selection?.target ?? null);
  }, [framework, manualCandidate, selection, snippetMode]);

  const manualMatchLocatorIds = useMemo(() => {
    if (!snapshot || !manualCandidate) return [];
    const document = documentFromSnapshot(snapshot.html);
    return matchingLocatorIds(document, manualCandidate);
  }, [manualCandidate, snapshot]);

  const selectLocatorId = useCallback(
    (locatorId: string) => {
      if (!snapshot) return;
      const document = documentFromSnapshot(snapshot.html);
      const target = findByLocatorId(document, locatorId);
      if (!target) return;

      const candidates = generateLocatorCandidates(document, target, {
        testIdAttributes: configuredTestIdAttributes
      });
      setSelection({
        target: summarizeElement(target),
        candidates
      });
      setSelectedCandidateId(candidates.find((candidate) => candidate.recommended)?.id ?? candidates[0]?.id ?? "");
      markIframeSelection(locatorId);
    },
    [configuredTestIdAttributes, snapshot]
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
    const restoredSettings = window.localStorage.getItem(SETTINGS_KEY) ?? DEFAULT_TEST_ID_INPUT;
    const restoredTheme = window.localStorage.getItem(THEME_KEY);
    const restoredDismissOverlays = window.localStorage.getItem(DISMISS_OVERLAYS_KEY);
    setInput(restoredInput);
    setTestIdAttributesInput(restoredSettings);
    if (restoredTheme === "dark" || restoredTheme === "light") setTheme(restoredTheme);
    if (restoredDismissOverlays === "false") setDismissOverlays(false);
    importValue(restoredInput, false);
  }, [importValue]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, testIdAttributesInput);
  }, [testIdAttributesInput]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(DISMISS_OVERLAYS_KEY, String(dismissOverlays));
  }, [dismissOverlays]);

  useEffect(() => {
    if (!selection || !snapshot) return;
    const document = documentFromSnapshot(snapshot.html);
    const target = findByLocatorId(document, selection.target.locatorId);
    if (!target) return;
    const candidates = generateLocatorCandidates(document, target, {
      testIdAttributes: configuredTestIdAttributes
    });
    setSelection((current) => current && { ...current, candidates });
    setSelectedCandidateId(candidates.find((candidate) => candidate.recommended)?.id ?? candidates[0]?.id ?? "");
  }, [configuredTestIdAttributes, snapshot, selection?.target.locatorId]);

  useEffect(() => {
    markIframeManualMatches(manualMatchLocatorIds);
  }, [manualMatchLocatorIds]);

  useEffect(() => {
    const element = previewFrameRef.current;
    if (!element) return;

    const updateFitScale = () => {
      const availableWidth = Math.max(1, element.clientWidth - 32);
      const availableHeight = Math.max(1, element.clientHeight - 32);
      const nextScale = Math.min(1, availableWidth / selectedViewport.width, availableHeight / selectedViewport.height);
      const roundedScale = Math.max(0.1, Number(nextScale.toFixed(3)));
      setPreviewFitScale((current) => (Math.abs(current - roundedScale) > 0.001 ? roundedScale : current));
    };

    updateFitScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFitScale);
      return () => window.removeEventListener("resize", updateFitScale);
    }

    const observer = new ResizeObserver(updateFitScale);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedViewport.height, selectedViewport.width]);

  useEffect(() => {
    if (activeDialog !== "settings") return;
    window.setTimeout(() => settingsInputRef.current?.focus(), 0);
  }, [activeDialog]);

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
        body: JSON.stringify({ url, dismissOverlays })
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
        viewport: body.viewport,
        ingestion: body.ingestion
      };
      const serialized = JSON.stringify(bundle, null, 2);
      setInput(serialized);
      importValue(serialized, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fetch that URL.");
    } finally {
      setIsFetchingUrl(false);
    }
  }, [dismissOverlays, importValue, urlInput]);

  const refreshSource = useCallback(() => {
    if (sourceMode === "url") {
      void importUrl();
      return;
    }
    importInput();
  }, [importInput, importUrl, sourceMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeDialog) {
        setActiveDialog(null);
        return;
      }

      const isCommand = event.metaKey || event.ctrlKey;
      if (!isCommand) return;

      if (event.key === "Enter") {
        event.preventDefault();
        refreshSource();
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (sourceMode === "url") {
          urlInputRef.current?.focus();
        } else {
          htmlInputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDialog, refreshSource, sourceMode]);

  const attachIframeHandlers = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument?.documentElement) return false;

    markIframeManualMatches(manualMatchLocatorIds);
    if (frameDocument.documentElement.dataset.locatorHandlersAttached === "true") return true;
    frameDocument.documentElement.dataset.locatorHandlersAttached = "true";

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
    return true;
  }, [manualMatchLocatorIds, selectLocatorId]);

  const targetFromPreviewPointer = useCallback((event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return null;

    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width / selectedViewport.width;
    const scaleY = rect.height / selectedViewport.height;
    const x = (event.clientX - rect.left) / Math.max(scaleX, 0.001);
    const y = (event.clientY - rect.top) / Math.max(scaleY, 0.001);
    const element = frameDocument.elementFromPoint(x, y);
    return element ? findActionTarget(element) : null;
  }, [selectedViewport.height, selectedViewport.width]);

  const selectPreviewPointerTarget = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = targetFromPreviewPointer(event);
    const locatorId = target?.getAttribute("data-locator-id");
    if (locatorId) selectLocatorId(locatorId);
  }, [selectLocatorId, targetFromPreviewPointer]);

  const markPreviewPointerHover = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;
    const target = targetFromPreviewPointer(event);
    frameDocument.querySelectorAll("[data-locator-hover]").forEach((element) => {
      element.removeAttribute("data-locator-hover");
    });
    target?.setAttribute("data-locator-hover", "true");
  }, [targetFromPreviewPointer]);

  const scrollPreviewFrame = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width / selectedViewport.width;
    const scaleY = rect.height / selectedViewport.height;
    frameWindow.scrollBy({
      left: event.deltaX / Math.max(scaleX, 0.001),
      top: event.deltaY / Math.max(scaleY, 0.001),
      behavior: "auto"
    });
  }, [selectedViewport.height, selectedViewport.width]);

  useEffect(() => {
    if (!snapshot) return;
    const frame = window.requestAnimationFrame(() => attachIframeHandlers());
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      if (attachIframeHandlers() || attempts >= 25) {
        window.clearInterval(interval);
      }
    }, 100);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [attachIframeHandlers, snapshot]);

  const markCopied = (state: CopyState) => {
    setCopyState(state);
    window.setTimeout(() => setCopyState("idle"), 1200);
  };

  const copySnippet = async () => {
    if (!snippet) return;
    await copyText(snippet.code);
    markCopied("snippet");
  };

  const copySelectedSelector = async () => {
    if (!selectedCandidate) return;
    await copyText(selectorTextFor(selectedCandidate));
    markCopied("selector");
  };

  const copyAllCandidates = async () => {
    if (!selection?.candidates.length) return;
    await copyText(
      selection.candidates
        .map((candidate, index) => {
          const marker = candidate.recommended ? " recommended" : "";
          return `${index + 1}. ${candidate.strategy}${marker}: ${selectorTextFor(candidate)} (${candidate.unique ? "unique" : `${candidate.matchCount} matches`})`;
        })
        .join("\n")
    );
    markCopied("all");
  };

  const copyManualSnippet = async () => {
    if (!manualSnippet) return;
    await copyText(manualSnippet.code);
    markCopied("manualSnippet");
  };

  const copyManualSelector = async () => {
    if (!manualCandidate) return;
    await copyText(selectorTextFor(manualCandidate));
    markCopied("manualSelector");
  };

  const copyBookmarklet = async () => {
    await copyText(bookmarkletCode());
    markCopied("bookmarklet");
  };

  const clearAll = () => {
    setInput("");
    setUrlInput("");
    setSource(null);
    setSnapshot(null);
    setSelection(null);
    setSelectedCandidateId("");
    setManualValue("");
    setError("");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const resetToSample = () => {
    setInput(SAMPLE_HTML);
    importValue(SAMPLE_HTML, true);
  };

  const toggleDialog = (dialog: Exclude<DialogPanel, null>) => {
    setActiveDialog((current) => (current === dialog ? null : dialog));
  };

  const selectPreviewDevice = (device: PreviewDevice) => {
    setPreviewDevice(device);
    setPreviewViewportId(DEVICE_DEFAULT_VIEWPORT[device]);
  };

  const selectPreviewViewport = (viewportId: PreviewViewportId) => {
    const viewport = PREVIEW_VIEWPORTS.find((item) => item.id === viewportId);
    setPreviewViewportId(viewportId);
    if (viewport) setPreviewDevice(viewport.device);
  };

  const restoreDefaultSettings = () => {
    setTestIdAttributesInput(DEFAULT_TEST_ID_INPUT);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  return (
    <main className="workbench-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Code2 size={21} />
          </div>
          <h1>Locator Workbench</h1>
          <span className="version-pill">MVP-2</span>
        </div>
        <div className="header-actions">
          <button
            className={activeDialog === "shortcuts" ? "ghost-button active" : "ghost-button"}
            onClick={() => toggleDialog("shortcuts")}
            type="button"
            aria-expanded={activeDialog === "shortcuts"}
          >
            <Keyboard size={15} />
            Shortcuts
          </button>
          <button
            className={activeDialog === "settings" ? "ghost-button active" : "ghost-button"}
            onClick={() => toggleDialog("settings")}
            type="button"
            aria-expanded={activeDialog === "settings"}
          >
            <Settings size={15} />
            Settings
          </button>
          <button
            className={activeDialog === "help" ? "ghost-button active" : "ghost-button"}
            onClick={() => toggleDialog("help")}
            type="button"
            aria-expanded={activeDialog === "help"}
          >
            <BadgeHelp size={15} />
            Help
          </button>
          <span className="header-divider" />
          <button className="icon-button" aria-label="Toggle theme" onClick={toggleTheme} type="button" title="Toggle theme">
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <span className="sandbox-pill">
            <span />
            Snapshot only
          </span>
          <button className="secondary-button compact-button" onClick={clearAll} type="button">
            <Trash2 size={15} />
            Clear All
          </button>
        </div>
      </header>

      {activeDialog ? (
        <WorkbenchDialog
          icon={dialogIcon(activeDialog)}
          title={dialogTitle(activeDialog)}
          onClose={() => setActiveDialog(null)}
        >
          {activeDialog === "shortcuts" ? (
            <div className="command-list">
              <button type="button" onClick={refreshSource}>
                <span>Import or refresh</span>
                <kbd>Cmd Enter</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveDialog(null);
                  if (sourceMode === "url") {
                    urlInputRef.current?.focus();
                  } else {
                    htmlInputRef.current?.focus();
                  }
                }}
              >
                <span>Focus source</span>
                <kbd>Cmd K</kbd>
              </button>
              <button type="button" onClick={() => setActiveDialog(null)}>
                <span>Dismiss panel</span>
                <kbd>Esc</kbd>
              </button>
            </div>
          ) : null}

          {activeDialog === "settings" ? (
            <div className="dialog-form">
              <label className="control-label" htmlFor="dialog-test-id-attributes">
                Test ID attributes
              </label>
              <input
                ref={settingsInputRef}
                id="dialog-test-id-attributes"
                className="url-input"
                value={testIdAttributesInput}
                onChange={(event) => setTestIdAttributesInput(event.target.value)}
                spellCheck={false}
              />
              <div className="dialog-actions">
                <button className="secondary-button" onClick={restoreDefaultSettings} type="button">
                  <RotateCcw size={15} />
                  Restore
                </button>
                <button className="primary-button" onClick={() => setActiveDialog(null)} type="button">
                  <Check size={15} />
                  Done
                </button>
              </div>
            </div>
          ) : null}

          {activeDialog === "help" ? (
            <div className="help-grid">
              <div>
                <strong>Source</strong>
                <span>Paste HTML or render a URL into a sanitized DOM snapshot.</span>
              </div>
              <div>
                <strong>Preview</strong>
                <span>Click a visible target to generate ranked locator candidates.</span>
              </div>
              <div>
                <strong>Inspector</strong>
                <span>Copy snippets, selectors, or test manual locator values.</span>
              </div>
            </div>
          ) : null}
        </WorkbenchDialog>
      ) : null}

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
                <button onClick={resetToSample} type="button">
                  <RotateCcw size={14} />
                  Reset
                </button>
              </div>
              <textarea
                ref={htmlInputRef}
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
                ref={urlInputRef}
                className="url-input"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com/dashboard"
                spellCheck={false}
                aria-label="Page URL"
              />
              <p className="small-copy">Renders the page in Chromium, captures the DOM, then imports the sanitized snapshot.</p>
              <label className="toggle-row">
                <input
                  checked={dismissOverlays}
                  onChange={(event) => setDismissOverlays(event.target.checked)}
                  type="checkbox"
                />
                <span>Auto-dismiss cookie banners, popups, and stale loading masks before capture</span>
              </label>
            </>
          )}
          {error ? <div className="error-note">{error}</div> : null}
          <button className="primary-button" disabled={isFetchingUrl} onClick={sourceMode === "url" ? importUrl : importInput} type="button">
            {isFetchingUrl ? <RefreshCw size={16} /> : <ShieldCheck size={16} />}
            {sourceMode === "url" ? (isFetchingUrl ? "Rendering URL" : "Render URL snapshot") : "Import snapshot"}
          </button>

          <div className="subsection">
            <SectionTitle icon={<Settings size={16} />} title="Locator Settings" />
            <label className="control-label" htmlFor="test-id-attributes">
              Test ID attributes
            </label>
            <input
              id="test-id-attributes"
              className="url-input"
              value={testIdAttributesInput}
              onChange={(event) => setTestIdAttributesInput(event.target.value)}
              spellCheck={false}
            />
            <p className="small-copy">Used when generating test-id candidates. Settings are stored locally with the workbench.</p>
          </div>

          <div className="subsection">
            <SectionTitle icon={<Clipboard size={16} />} title="Capture Bookmarklet" />
            <p className="small-copy">Copies document HTML plus URL, title, capture time, and viewport.</p>
            <button className="secondary-button full-width" onClick={copyBookmarklet} type="button">
              {copyState === "bookmarklet" ? <Check size={16} /> : <Copy size={16} />}
              {copyState === "bookmarklet" ? "Copied" : "Copy bookmarklet"}
            </button>
          </div>

          <MetadataPanel source={source} snapshot={snapshot} />
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
              <button
                className={previewDevice === "desktop" ? "active" : ""}
                onClick={() => selectPreviewDevice("desktop")}
                type="button"
                aria-label="Desktop preview"
                aria-pressed={previewDevice === "desktop"}
              >
                <Monitor size={16} />
              </button>
              <button
                className={previewDevice === "tablet" ? "active" : ""}
                onClick={() => selectPreviewDevice("tablet")}
                type="button"
                aria-label="Tablet preview"
                aria-pressed={previewDevice === "tablet"}
              >
                <PanelTop size={15} />
              </button>
              <button
                className={previewDevice === "mobile" ? "active" : ""}
                onClick={() => selectPreviewDevice("mobile")}
                type="button"
                aria-label="Mobile preview"
                aria-pressed={previewDevice === "mobile"}
              >
                <Smartphone size={15} />
              </button>
            </div>
            <select
              aria-label="Viewport size"
              value={previewViewportId}
              onChange={(event) => selectPreviewViewport(event.target.value as PreviewViewportId)}
            >
              {PREVIEW_VIEWPORTS.map((viewport) => (
                <option key={viewport.id} value={viewport.id}>
                  {viewport.label}
                </option>
              ))}
            </select>
            <select aria-label="Preview zoom" value={previewZoom} onChange={(event) => setPreviewZoom(event.target.value as PreviewZoom)}>
              {PREVIEW_ZOOMS.map((zoom) => (
                <option key={zoom.value} value={zoom.value}>
                  {zoom.label}
                </option>
              ))}
            </select>
          </div>
          <div className="preview-frame-wrap" ref={previewFrameRef}>
            {snapshot ? (
              <div className="preview-canvas-shell" style={previewShellStyle}>
                <div className="preview-canvas" style={previewCanvasStyle}>
                  <iframe
                    ref={iframeRef}
                    title="Snapshot preview"
                    sandbox="allow-same-origin"
                    srcDoc={snapshot.html}
                    onLoad={attachIframeHandlers}
                  />
                  <div
                    className="preview-click-layer"
                    aria-hidden="true"
                    onPointerDown={selectPreviewPointerTarget}
                    onMouseMove={markPreviewPointerHover}
                    onWheel={scrollPreviewFrame}
                  />
                </div>
              </div>
            ) : (
              <div className="empty-state">Import HTML to render a sanitized snapshot.</div>
            )}
          </div>
        </section>

        <aside className="pane inspector-pane">
          <NumberedTitle index={3} title="Inspector" />
          {selection ? (
            <>
              <TargetDetails target={selection.target} />
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
                copied={copyState}
                onFrameworkChange={setFramework}
                onModeChange={setSnippetMode}
                onCopy={copySnippet}
                onCopySelector={copySelectedSelector}
                onCopyAll={copyAllCandidates}
              />
            </>
          ) : (
            <div className="empty-state compact">Select a button, input, or link in the preview.</div>
          )}

          <ManualLocatorTester
            strategy={manualStrategy}
            value={manualValue}
            candidate={manualCandidate}
            snippet={manualSnippet?.code ?? ""}
            snippetWarning={manualSnippet?.warning}
            copied={copyState}
            disabled={!snapshot}
            matchCount={manualMatchLocatorIds.length}
            onStrategyChange={setManualStrategy}
            onValueChange={setManualValue}
            onCopy={copyManualSnippet}
            onCopySelector={copyManualSelector}
          />
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

function WorkbenchDialog({
  icon,
  title,
  children,
  onClose
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-panel"
        aria-modal="true"
        role="dialog"
        aria-labelledby="workbench-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="dialog-title">
            {icon}
            <h2 id="workbench-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function dialogTitle(dialog: Exclude<DialogPanel, null>) {
  if (dialog === "shortcuts") return "Shortcuts";
  if (dialog === "settings") return "Settings";
  return "Help";
}

function dialogIcon(dialog: Exclude<DialogPanel, null>) {
  if (dialog === "shortcuts") return <Keyboard size={17} />;
  if (dialog === "settings") return <Settings size={17} />;
  return <BadgeHelp size={17} />;
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
          <div>
            <span>Capture</span>
            <strong>
              {source.metadata.ingestion.overlayActions?.length
                ? `${source.metadata.ingestion.overlayActions.length} cleanup actions`
                : "No capture actions"}
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
              <span className="candidate-warning">{candidate.warnings[candidate.warnings.length - 1]}</span>
            ) : null}
            <span className="score-bar" style={{ ["--score" as string]: `${Math.max(8, Math.min(100, candidate.score))}%` }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ManualLocatorTester({
  strategy,
  value,
  candidate,
  snippet,
  snippetWarning,
  copied,
  disabled,
  matchCount,
  onStrategyChange,
  onValueChange,
  onCopy,
  onCopySelector
}: {
  strategy: ManualStrategy;
  value: string;
  candidate: LocatorCandidate | null;
  snippet: string;
  snippetWarning?: string;
  copied: CopyState;
  disabled: boolean;
  matchCount: number;
  onStrategyChange: (strategy: ManualStrategy) => void;
  onValueChange: (value: string) => void;
  onCopy: () => void;
  onCopySelector: () => void;
}) {
  return (
    <div className="subsection snippet-section">
      <div className="mini-heading">Manual Locator Tester</div>
      <select value={strategy} onChange={(event) => onStrategyChange(event.target.value as ManualStrategy)} disabled={disabled}>
        <option value="css">CSS</option>
        <option value="xpath">XPath</option>
        <option value="testId">Test ID value</option>
        <option value="text">Text</option>
      </select>
      <input
        className="url-input"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        spellCheck={false}
        placeholder={disabled ? "Import a snapshot first" : "Type a selector or value"}
        aria-label="Manual locator"
      />
      {candidate ? (
        <div className={candidate.unique ? "manual-result unique" : "manual-result warning"}>
          <strong>{candidate.unique ? "Unique match" : `${candidate.matchCount} matches`}</strong>
          <code>{candidate.value}</code>
          <span>{matchCount ? `${matchCount} preview match${matchCount === 1 ? "" : "es"} highlighted` : "No preview matches highlighted"}</span>
          {candidate.warnings.length ? <span>{candidate.warnings[candidate.warnings.length - 1]}</span> : null}
        </div>
      ) : null}
      {snippetWarning ? <div className="warning-note">{snippetWarning}</div> : null}
      {candidate ? <pre className="snippet-code">{snippet}</pre> : null}
      <div className="copy-action-row">
        <button
          className="secondary-button"
          onClick={onCopySelector}
          disabled={!candidate}
          type="button"
          aria-label="Copy manual selector"
        >
          {copied === "manualSelector" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "manualSelector" ? "Copied" : "Selector"}
        </button>
        <button
          className="primary-button"
          onClick={onCopy}
          disabled={!candidate}
          type="button"
          aria-label="Copy manual snippet"
        >
          {copied === "manualSnippet" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "manualSnippet" ? "Copied" : "Snippet"}
        </button>
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
  onCopy,
  onCopySelector,
  onCopyAll
}: {
  framework: Framework;
  mode: SnippetMode;
  snippet: string;
  warning?: string;
  copied: CopyState;
  onFrameworkChange: (framework: Framework) => void;
  onModeChange: (mode: SnippetMode) => void;
  onCopy: () => void;
  onCopySelector: () => void;
  onCopyAll: () => void;
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
      <div className="copy-action-row">
        <button className="secondary-button" onClick={onCopySelector} type="button" aria-label="Copy selected selector">
          {copied === "selector" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "selector" ? "Copied" : "Selector"}
        </button>
        <button className="secondary-button" onClick={onCopyAll} type="button" aria-label="Copy all candidates">
          {copied === "all" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "all" ? "Copied" : "All"}
        </button>
        <button className="primary-button" onClick={onCopy} type="button" aria-label="Copy selected snippet">
          {copied === "snippet" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "snippet" ? "Copied" : "Snippet"}
        </button>
      </div>
    </div>
  );
}

function selectorTextFor(candidate: LocatorCandidate) {
  if (candidate.strategy === "compound") {
    const css = candidate.parts?.css ?? candidate.value;
    const text = candidate.parts?.text;
    return text ? `${css} hasText ${JSON.stringify(text)}` : css;
  }
  return candidate.value;
}

function matchingLocatorIds(document: Document, candidate: LocatorCandidate): string[] {
  const elements = matchingElements(document, candidate);
  return elements
    .map((element) => element.getAttribute("data-locator-id"))
    .filter((locatorId): locatorId is string => Boolean(locatorId));
}

function matchingElements(document: Document, candidate: LocatorCandidate): Element[] {
  try {
    if (candidate.strategy === "testId" || candidate.strategy === "css") {
      return Array.from(document.querySelectorAll(candidate.value));
    }

    if (candidate.strategy === "xpath") {
      const result = document.evaluate(candidate.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return Array.from({ length: result.snapshotLength }, (_, index) => result.snapshotItem(index)).filter(
        (node): node is Element => Boolean(node && node.nodeType === Node.ELEMENT_NODE)
      );
    }

    if (candidate.strategy === "text") {
      return Array.from(document.body.querySelectorAll("*")).filter((element) => {
        return normalizeSnapshotText(element.textContent ?? "") === candidate.value;
      });
    }

    if (candidate.strategy === "compound") {
      const css = candidate.parts?.css;
      const text = candidate.parts?.text;
      if (!css || !text) return [];
      return Array.from(document.querySelectorAll(css)).filter((element) => {
        return normalizeSnapshotText(element.textContent ?? "").includes(text);
      });
    }
  } catch {
    return [];
  }

  return [];
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

function markIframeManualMatches(locatorIds: string[]) {
  const frame = document.querySelector<HTMLIFrameElement>("iframe[title='Snapshot preview']");
  const frameDocument = frame?.contentDocument;
  if (!frameDocument) return;

  frameDocument.querySelectorAll("[data-locator-manual-match]").forEach((element) => {
    element.removeAttribute("data-locator-manual-match");
  });

  for (const locatorId of locatorIds) {
    frameDocument
      .querySelector(`[data-locator-id="${CSS.escape(locatorId)}"]`)
      ?.setAttribute("data-locator-manual-match", "true");
  }
}

function normalizeSnapshotText(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
