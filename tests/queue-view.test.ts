import type { WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { QueueArticle } from "../src/queue-data";
import { QueueView } from "../src/queue-view";

import type ReadQueuePlugin from "../src/main";

// Obsidian patches createEl/createDiv/empty/etc. onto HTMLElement at runtime;
// the test environment (happy-dom) has none of them. Install minimal versions
// so QueueView.render() can build its DOM, and remove them afterwards so the
// augmentation doesn't leak into other test files sharing the worker.

type ElInfo =
  | { cls?: string; text?: string; attr?: Record<string, string> }
  | string;

function makeEl(parent: HTMLElement, tag: string, o?: ElInfo): HTMLElement {
  const el = document.createElement(tag);
  const info = typeof o === "string" ? { cls: o } : o;
  if (info?.cls) el.className = info.cls;
  if (info?.text !== undefined) el.textContent = info.text;
  if (info?.attr) {
    for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
  }
  parent.appendChild(el);
  return el;
}

const PROTO_KEYS = [
  "empty",
  "setText",
  "addClass",
  "removeClass",
  "createEl",
  "createDiv",
  "createSpan",
] as const;

function installObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.empty = function (this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.setText = function (this: HTMLElement, t: string): void {
    this.textContent = t;
  };
  proto.addClass = function (this: HTMLElement, ...c: string[]): void {
    this.classList.add(...c);
  };
  proto.removeClass = function (this: HTMLElement, ...c: string[]): void {
    this.classList.remove(...c);
  };
  proto.createEl = function (this: HTMLElement, tag: string, o?: ElInfo) {
    return makeEl(this, tag, o);
  };
  proto.createDiv = function (this: HTMLElement, o?: ElInfo) {
    return makeEl(this, "div", o);
  };
  proto.createSpan = function (this: HTMLElement, o?: ElInfo) {
    return makeEl(this, "span", o);
  };
}

function uninstallObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const k of PROTO_KEYS) delete proto[k];
}

function article(title: string, topic: string): QueueArticle {
  return {
    file: {
      path: `${title}.md`,
      stat: { size: 1500 },
    } as unknown as QueueArticle["file"],
    title,
    url: undefined,
    source: undefined,
    topic,
    author: undefined,
    published: undefined,
    savedAt: undefined,
    status: "unread",
    tags: [],
    snoozedUntil: undefined,
    readAt: undefined,
  };
}

interface RenderableView {
  render(): Promise<void>;
}

function makeView(articles: QueueArticle[]): {
  view: QueueView;
  container: HTMLElement;
} {
  const plugin = {
    loadQueueArticles: () => articles,
    settings: { collapsedGroupsByGroupBy: {} },
    app: {},
    saveSettings: async (): Promise<void> => undefined,
  } as unknown as ReadQueuePlugin;

  const leaf = {} as unknown as WorkspaceLeaf;
  const view = new QueueView(leaf, plugin);

  // The obsidian mock's ItemView is an empty class, so it stores neither
  // `leaf` nor `containerEl` — set both as the real ItemView would.
  // containerEl exposes the content root at child(1).
  const container = document.createElement("div");
  container.appendChild(document.createElement("div"));
  container.appendChild(document.createElement("div"));
  document.body.appendChild(container);
  (
    view as unknown as { containerEl: HTMLElement; leaf: WorkspaceLeaf }
  ).containerEl = container;
  (view as unknown as { leaf: WorkspaceLeaf }).leaf = leaf;

  return { view, container };
}

function titles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".readqueue-view__card-title"),
  ).map((el) => el.textContent ?? "");
}

describe("QueueView search input", () => {
  beforeAll(installObsidianDom);
  afterAll(() => {
    uninstallObsidianDom();
    document.body.innerHTML = "";
  });

  it("preserves the focused input across a keystroke (the mobile bug)", async () => {
    const { view, container } = makeView([
      article("Alpha", "tech"),
      article("Bravo", "tech"),
      article("Charlie", "macro"),
    ]);
    await (view as unknown as RenderableView).render();

    const input = container.querySelector<HTMLInputElement>(
      ".readqueue-view__search",
    );
    expect(input).not.toBeNull();
    if (!input) return;

    input.focus();
    expect(document.activeElement).toBe(input);

    input.value = "alpha";
    input.dispatchEvent(new Event("input"));

    // The exact same <input> node must still be mounted: a full re-render
    // would replace it, dropping focus and resetting scroll on every letter.
    expect(container.querySelector(".readqueue-view__search")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("alpha");

    expect(titles(container)).toEqual(["Alpha"]);
  });

  it("filters and restores the list as the query changes", async () => {
    const { view, container } = makeView([
      article("Alpha", "tech"),
      article("Bravo", "tech"),
    ]);
    await (view as unknown as RenderableView).render();

    const input = container.querySelector<HTMLInputElement>(
      ".readqueue-view__search",
    );
    if (!input) throw new Error("search input not rendered");

    input.value = "bravo";
    input.dispatchEvent(new Event("input"));
    expect(titles(container)).toEqual(["Bravo"]);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(titles(container).sort()).toEqual(["Alpha", "Bravo"]);
  });

  it("shows a filter-specific empty state, not 'nothing in the queue'", async () => {
    const { view, container } = makeView([article("Alpha", "tech")]);
    await (view as unknown as RenderableView).render();

    const input = container.querySelector<HTMLInputElement>(
      ".readqueue-view__search",
    );
    if (!input) throw new Error("search input not rendered");

    input.value = "zzzznomatch";
    input.dispatchEvent(new Event("input"));

    const empty = container.querySelector(".readqueue-view__list p");
    expect(empty?.textContent).toBe("Sin resultados para ese filtro.");
  });
});
