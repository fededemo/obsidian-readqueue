import { describe, expect, it, vi } from "vitest";
import type { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import {
  applyMarkAsRead,
  ensureReadingView,
  markAsRead,
  markAsReadMutation,
  openInReadingView,
  postponeArticle,
  shouldForcePreview,
  snoozeArticle,
  snoozeDate,
  unsnoozeArticle,
} from "../src/read-action";

const file = { basename: "test", path: "Inbox/Web/test.md" } as unknown as TFile;

describe("shouldForcePreview", () => {
  it("returns true for source: web-clipper", () => {
    expect(shouldForcePreview({ source: "web-clipper" })).toBe(true);
  });

  it("returns true for source: intake-defuddle", () => {
    expect(shouldForcePreview({ source: "intake-defuddle" })).toBe(true);
  });

  it("returns false for unknown source", () => {
    expect(shouldForcePreview({ source: "kindle" })).toBe(false);
  });

  it("returns false when source is missing", () => {
    expect(shouldForcePreview({})).toBe(false);
  });

  it("returns false when frontmatter is undefined", () => {
    expect(shouldForcePreview(undefined)).toBe(false);
  });

  it("returns false when source is not a string", () => {
    expect(shouldForcePreview({ source: 42 as unknown as string })).toBe(false);
  });
});

describe("markAsReadMutation", () => {
  it("returns status: read and ISO timestamp", () => {
    const now = new Date("2026-05-30T14:30:00Z");
    const mutation = markAsReadMutation(now);
    expect(mutation.status).toBe("read");
    expect(mutation.readAt).toBe("2026-05-30T14:30:00.000Z");
    expect(mutation.readTag).toBeUndefined();
  });

  it("uses current time by default", () => {
    const before = Date.now();
    const mutation = markAsReadMutation();
    const after = Date.now();
    const ts = new Date(mutation.readAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("attaches readTag when supplied non-empty", () => {
    const mutation = markAsReadMutation(new Date("2026-01-01Z"), "leido");
    expect(mutation.readTag).toBe("leido");
  });

  it("trims and ignores empty/whitespace readTag", () => {
    expect(markAsReadMutation(new Date("2026-01-01Z"), "").readTag).toBeUndefined();
    expect(markAsReadMutation(new Date("2026-01-01Z"), "   ").readTag).toBeUndefined();
    expect(markAsReadMutation(new Date("2026-01-01Z"), "  leido  ").readTag).toBe(
      "leido",
    );
  });
});

describe("applyMarkAsRead", () => {
  it("sets status and readAt on the frontmatter object", () => {
    const fm: Record<string, unknown> = { status: "unread", title: "x" };
    applyMarkAsRead(fm, { status: "read", readAt: "2026-05-30T00:00:00Z" });
    expect(fm.status).toBe("read");
    expect(fm.readAt).toBe("2026-05-30T00:00:00Z");
    expect(fm.title).toBe("x");
  });

  it("is idempotent for the same mutation", () => {
    const fm: Record<string, unknown> = {};
    const m = { status: "read", readAt: "2026-05-30T00:00:00Z" };
    applyMarkAsRead(fm, m);
    const first = { ...fm };
    applyMarkAsRead(fm, m);
    expect(fm).toEqual(first);
  });

  it("adds readTag to the tags array when supplied and missing", () => {
    const fm: Record<string, unknown> = { tags: ["reader"] };
    applyMarkAsRead(fm, {
      status: "read",
      readAt: "2026-05-30T00:00:00Z",
      readTag: "leido",
    });
    expect(fm.tags).toEqual(["reader", "leido"]);
  });

  it("does not duplicate the readTag when already present", () => {
    const fm: Record<string, unknown> = { tags: ["reader", "leido"] };
    applyMarkAsRead(fm, {
      status: "read",
      readAt: "2026-05-30T00:00:00Z",
      readTag: "leido",
    });
    expect(fm.tags).toEqual(["reader", "leido"]);
  });

  it("creates the tags array when missing", () => {
    const fm: Record<string, unknown> = {};
    applyMarkAsRead(fm, {
      status: "read",
      readAt: "2026-05-30T00:00:00Z",
      readTag: "leido",
    });
    expect(fm.tags).toEqual(["leido"]);
  });

  it("normalizes a string tags value into an array before appending", () => {
    const fm: Record<string, unknown> = { tags: "reader" };
    applyMarkAsRead(fm, {
      status: "read",
      readAt: "2026-05-30T00:00:00Z",
      readTag: "leido",
    });
    expect(fm.tags).toEqual(["reader", "leido"]);
  });
});

describe("openInReadingView", () => {
  it("opens the file with mode preview in a new leaf", async () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    const leaf = { openFile } as unknown as WorkspaceLeaf;
    const getLeaf = vi.fn().mockReturnValue(leaf);
    const app = { workspace: { getLeaf } } as unknown as App;

    await openInReadingView(app, file);

    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(openFile).toHaveBeenCalledWith(file, { state: { mode: "preview" } });
  });
});

describe("markAsRead", () => {
  it("invokes processFrontMatter and applies the mutation", async () => {
    const processFrontMatter = vi.fn(async (_: TFile, fn: (fm: Record<string, unknown>) => void) => {
      const fm: Record<string, unknown> = { status: "unread" };
      fn(fm);
      expect(fm.status).toBe("read");
      expect(typeof fm.readAt).toBe("string");
    });
    const app = { fileManager: { processFrontMatter } } as unknown as App;

    await markAsRead(app, file);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });
});

describe("ensureReadingView", () => {
  it("is a no-op when view is already in preview mode", async () => {
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const getViewState = vi.fn().mockReturnValue({ state: { mode: "preview" } });
    const leaf = { setViewState, getViewState } as unknown as WorkspaceLeaf;
    const view = { getMode: () => "preview" } as unknown as MarkdownView;

    await ensureReadingView(leaf, view);

    expect(setViewState).not.toHaveBeenCalled();
  });

  it("switches to preview when view is in source mode", async () => {
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const getViewState = vi.fn().mockReturnValue({
      type: "markdown",
      state: { mode: "source", source: false },
    });
    const leaf = { setViewState, getViewState } as unknown as WorkspaceLeaf;
    const view = { getMode: () => "source" } as unknown as MarkdownView;

    await ensureReadingView(leaf, view);

    expect(setViewState).toHaveBeenCalledTimes(1);
    const call = setViewState.mock.calls[0]![0] as { state: { mode: string } };
    expect(call.state.mode).toBe("preview");
  });

  it("preserves other state keys when switching", async () => {
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const getViewState = vi.fn().mockReturnValue({
      type: "markdown",
      state: { mode: "source", source: false, scroll: 42 },
    });
    const leaf = { setViewState, getViewState } as unknown as WorkspaceLeaf;
    const view = { getMode: () => "source" } as unknown as MarkdownView;

    await ensureReadingView(leaf, view);

    const call = setViewState.mock.calls[0]![0] as { state: Record<string, unknown> };
    expect(call.state.scroll).toBe(42);
    expect(call.state.source).toBe(false);
    expect(call.state.mode).toBe("preview");
  });
});

describe("snoozeDate", () => {
  it("adds the given number of days to now", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    expect(snoozeDate(7, now).toISOString()).toBe("2026-06-06T12:00:00.000Z");
  });

  it("accepts zero", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    expect(snoozeDate(0, now).toISOString()).toBe(now.toISOString());
  });
});

describe("snoozeArticle / unsnoozeArticle / postponeArticle", () => {
  it("snoozeArticle writes snoozedUntil as ISO string", async () => {
    const processFrontMatter = vi.fn(
      async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        expect(fm.snoozedUntil).toBe("2026-06-06T00:00:00.000Z");
      },
    );
    const app = { fileManager: { processFrontMatter } } as unknown as App;
    await snoozeArticle(app, file, new Date("2026-06-06T00:00:00Z"));
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it("unsnoozeArticle deletes the snoozedUntil key", async () => {
    const processFrontMatter = vi.fn(
      async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm: Record<string, unknown> = { snoozedUntil: "2030-01-01T00:00:00Z" };
        fn(fm);
        expect("snoozedUntil" in fm).toBe(false);
      },
    );
    const app = { fileManager: { processFrontMatter } } as unknown as App;
    await unsnoozeArticle(app, file);
  });

  it("postponeArticle updates savedAt to current time", async () => {
    const before = Date.now();
    let captured = "";
    const processFrontMatter = vi.fn(
      async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm: Record<string, unknown> = { savedAt: "2024-01-01T00:00:00Z" };
        fn(fm);
        captured = fm.savedAt as string;
      },
    );
    const app = { fileManager: { processFrontMatter } } as unknown as App;
    await postponeArticle(app, file);
    const after = Date.now();
    const ts = new Date(captured).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
