export type SourceKind = "html" | "bundle";

export type RenderedHtmlBundle = {
  html: string;
  url?: string;
  title?: string;
  capturedAt?: string;
  viewport?: {
    width?: number;
    height?: number;
  };
  ingestion?: {
    mode: "rendered-dom" | "source-html";
    stylesheetsInlined: number;
    stylesheetsSkipped: number;
    scriptsDetected: number;
    overlayActions?: string[];
    warnings: string[];
  };
};

export type WorkbenchSource = {
  kind: SourceKind;
  html: string;
  metadata?: Omit<RenderedHtmlBundle, "html">;
};

export type ParseResult =
  | { ok: true; source: WorkbenchSource }
  | { ok: false; message: string };

export type SnapshotResult = {
  html: string;
  title?: string;
  warnings: string[];
};

export type ElementSummary = {
  locatorId: string;
  tagName: string;
  role: string | null;
  name: string;
  text: string;
  attributes: Record<string, string>;
};

export type LocatorStrategy = "testId" | "role" | "label" | "text" | "css" | "compound" | "xpath";

export type LocatorCandidateParts = {
  css?: string;
  text?: string;
  testIdAttribute?: string;
  testIdValue?: string;
};

export type LocatorCandidate = {
  id: string;
  strategy: LocatorStrategy;
  label: string;
  value: string;
  score: number;
  unique: boolean;
  matchCount: number;
  recommended: boolean;
  warnings: string[];
  parts?: LocatorCandidateParts;
};

export type Framework = "playwright" | "cypress" | "selenium" | "robot" | "generic";

export type SnippetMode = "locator" | "action";

export type SnippetResult = {
  code: string;
  warning?: string;
};
