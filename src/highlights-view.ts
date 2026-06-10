import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";

import type { ArticleSource, ExtractedHighlight } from "./highlights-data";
import type ReadQueuePlugin from "./main";
import type { VaultFileHighlights } from "./main";

export const HIGHLIGHTS_VIEW_TYPE = "readqueue-highlights-view";

const SOURCE_BADGE: Record<ArticleSource, string> = {
  web: "web",
  kindle: "kindle",
  matter: "matter",
};

export class HighlightsView extends ItemView {
  plugin: ReadQueuePlugin;
  private cache: VaultFileHighlights[] | null = null;
  private searchQuery = "";
  private totalCount = 0;
  private rerenderTimer: number | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: ReadQueuePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return HIGHLIGHTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.totalCount > 0
      ? `Highlights (${this.totalCount})`
      : "Highlights";
  }

  override getIcon(): string {
    return "highlighter";
  }

  async onOpen(): Promise<void> {
    const invalidate = (path: string): void => {
      if (!this.plugin.isHighlightSourcePath(path)) return;
      this.cache = null;
      this.scheduleRender();
    };
    this.registerEvent(
      this.app.vault.on("modify", (f) => invalidate(f.path)),
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => invalidate(f.path)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => invalidate(f.path)),
    );
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.rerenderTimer !== undefined) {
      window.clearTimeout(this.rerenderTimer);
    }
  }

  async refresh(): Promise<void> {
    this.cache = null;
    await this.render();
  }

  /** Debounced: vault "modify" fires on every editor keystroke save. */
  private scheduleRender(): void {
    if (this.rerenderTimer !== undefined) {
      window.clearTimeout(this.rerenderTimer);
    }
    this.rerenderTimer = window.setTimeout(() => {
      this.rerenderTimer = undefined;
      void this.render();
    }, 1000);
  }

  private async render(): Promise<void> {
    if (this.cache === null) {
      this.cache = await this.plugin.collectHighlights();
    }
    const groups = this.cache;
    this.totalCount = groups.reduce((acc, g) => acc + g.highlights.length, 0);
    this.refreshTabTitle();

    const root = this.containerEl.children.item(1) ?? this.containerEl;
    if (!(root instanceof HTMLElement)) return;
    root.empty();
    root.addClass("readqueue-view", "readqueue-highlights");

    const stats = root.createDiv({ cls: "readqueue-view__stats" });
    stats.setText(
      `${this.totalCount} highlights · ${groups.length} notas`,
    );

    const searchEl = root.createEl("input", {
      cls: "readqueue-view__search",
      attr: {
        type: "search",
        placeholder: "Filtrar highlights / título / nota…",
        "aria-label": "Filtrar highlights",
      },
    });
    searchEl.value = this.searchQuery;
    searchEl.oninput = () => {
      this.searchQuery = searchEl.value;
      // search filters the already-extracted cache; no rescan
      this.renderList(listEl, this.filteredGroups());
    };

    const listEl = root.createDiv({ cls: "readqueue-view__list" });
    this.renderList(listEl, this.filteredGroups());
  }

  private filteredGroups(): VaultFileHighlights[] {
    const q = this.searchQuery.trim().toLowerCase();
    const groups = this.cache ?? [];
    if (!q) return groups;
    return groups
      .map((g) => {
        const titleHit = g.title.toLowerCase().includes(q);
        const highlights = titleHit
          ? g.highlights
          : g.highlights.filter((h) =>
              `${h.text} ${h.note ?? ""}`.toLowerCase().includes(q),
            );
        return { ...g, highlights };
      })
      .filter((g) => g.highlights.length > 0);
  }

  private renderList(
    listEl: HTMLElement,
    groups: readonly VaultFileHighlights[],
  ): void {
    listEl.empty();
    if (groups.length === 0) {
      listEl.createEl("p", {
        text: this.searchQuery.trim()
          ? "Sin resultados para ese filtro."
          : "No hay highlights todavía. Subrayá con ==…== en reading view.",
      });
      return;
    }
    for (const group of groups) {
      const header = listEl.createEl("h3", {
        cls: "readqueue-view__group-header readqueue-highlights__group",
      });
      header.createSpan({
        cls: "readqueue-view__group-label",
        text: group.title,
      });
      header.createSpan({
        cls: `readqueue-highlights__badge readqueue-highlights__badge--${group.articleSource}`,
        text: SOURCE_BADGE[group.articleSource],
      });
      header.createSpan({
        cls: "readqueue-view__group-count",
        text: ` (${group.highlights.length})`,
      });

      for (const h of group.highlights) {
        this.renderHighlight(listEl, h);
      }
    }
  }

  private renderHighlight(parent: HTMLElement, h: ExtractedHighlight): void {
    const card = parent.createDiv({
      cls: "readqueue-view__card readqueue-highlights__card",
    });
    card.createDiv({
      cls: "readqueue-highlights__text",
      text: h.text,
    });
    if (h.note) {
      card.createDiv({
        cls: "readqueue-highlights__note",
        text: `📝 ${h.note}`,
      });
    }
    if (h.location) {
      card.createDiv({
        cls: "readqueue-view__card-meta",
        text: h.location,
      });
    }
    card.onclick = (ev) => {
      ev.preventDefault();
      void this.openHighlight(h);
    };
  }

  /**
   * Jump-to-highlight: opens the note and scrolls via ephemeral state
   * `{ line }`. We computed the highlight's line during extraction, and
   * line-based eState works in both reading view and source mode — unlike
   * the undocumented `match`-based eState that the core search plugin uses,
   * which is fragile across Obsidian versions. Trade-off: it scrolls to the
   * line, it does not flash/select the exact text.
   */
  private async openHighlight(h: ExtractedHighlight): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(h.sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { eState: { line: h.line } });
  }

  private refreshTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }
}
