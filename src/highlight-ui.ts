// Floating "Subrayar" button over text selections in reading view, plus the
// note modal. All Obsidian-coupled; the location logic lives in highlight.ts.

import {
  MarkdownView,
  Modal,
  Notice,
  type App,
  type Plugin,
  type TFile,
} from "obsidian";

import {
  applyHighlight,
  locateSelection,
  wrapSelectionAsHighlight,
  type LocateFailureReason,
  type OccurrenceHint,
} from "./highlight";

const FAILURE_NOTICES: Record<LocateFailureReason, string> = {
  empty: "No hay texto seleccionado.",
  "not-found":
    "No se encontró el texto seleccionado en el archivo fuente.",
  ambiguous: "Texto ambiguo, seleccioná un fragmento más largo.",
  "multi-block":
    "La selección cruza varios párrafos. Subrayá un párrafo por vez.",
  "inside-highlight":
    "La selección ya está dentro de un subrayado existente.",
};

const CONTEXT_CHARS = 120;
const SELECTION_DEBOUNCE_MS = 150;

interface SelectionSnapshot {
  file: TFile;
  text: string;
  hint: OccurrenceHint;
}

export class HighlightUI {
  private buttonEl: HTMLDivElement | null = null;
  private snapshot: SelectionSnapshot | null = null;
  private debounceTimer: number | null = null;
  private suspendSelectionTracking = false;

  constructor(
    private readonly plugin: Plugin,
    private readonly isFloatingButtonEnabled: () => boolean,
  ) {}

  register(): void {
    this.plugin.registerDomEvent(document, "selectionchange", () => {
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(
        () => this.onSelectionChange(),
        SELECTION_DEBOUNCE_MS,
      );
    });
    // capture phase so scrolls inside the preview pane also dismiss the button
    this.plugin.registerDomEvent(document, "scroll", () => this.hideButton(), true);
  }

  destroy(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.buttonEl?.remove();
    this.buttonEl = null;
    this.snapshot = null;
  }

  /**
   * Markdown editor with a live (non-empty) selection — covers source mode and
   * Live Preview, where `getMode()` is "source". Reading view returns null here
   * and falls back to the debounced preview snapshot path.
   */
  private activeEditorWithSelection(): MarkdownView | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") return null;
    return view.editor.getSelection().trim() ? view : null;
  }

  hasActionableSelection(): boolean {
    if (this.activeEditorWithSelection()) return true;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "preview") return false;
    return this.snapshot !== null;
  }

  highlightCurrentSelection(): void {
    const editView = this.activeEditorWithSelection();
    if (editView) {
      this.applyEditorHighlight(editView);
      return;
    }
    void this.applySnapshot();
  }

  highlightCurrentSelectionWithNote(): void {
    const editView = this.activeEditorWithSelection();
    if (editView) {
      this.promptNoteAndApplyEditor(editView);
      return;
    }
    this.promptNoteAndApply();
  }

  private applyEditorHighlight(view: MarkdownView, note?: string): void {
    const editor = view.editor;
    const selected = editor.getSelection();
    const replaced = wrapSelectionAsHighlight(selected, note);
    if (replaced === selected) {
      new Notice(FAILURE_NOTICES.empty);
      return;
    }
    editor.replaceSelection(replaced);
    new Notice(note ? "Subrayado + nota agregados." : "Subrayado agregado.");
  }

  private promptNoteAndApplyEditor(view: MarkdownView): void {
    const editor = view.editor;
    const selected = editor.getSelection();
    if (!selected.trim()) {
      new Notice(FAILURE_NOTICES.empty);
      return;
    }
    // capture the range before the modal steals focus and collapses the
    // selection; replaceRange re-applies against the exact span afterwards
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    new HighlightNoteModal(
      this.plugin.app,
      (note) => {
        const replaced = wrapSelectionAsHighlight(selected, note || undefined);
        editor.replaceRange(replaced, from, to);
        new Notice(note ? "Subrayado + nota agregados." : "Subrayado agregado.");
      },
      () => {},
    ).open();
  }

  private onSelectionChange(): void {
    if (this.suspendSelectionTracking) return;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const sel = window.getSelection();
    if (
      !view ||
      !view.file ||
      view.getMode() !== "preview" ||
      !sel ||
      sel.isCollapsed ||
      sel.rangeCount === 0
    ) {
      this.snapshot = null;
      this.hideButton();
      return;
    }
    const container = view.previewMode.containerEl;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      this.snapshot = null;
      this.hideButton();
      return;
    }
    const text = sel.toString();
    if (!text.trim()) {
      this.snapshot = null;
      this.hideButton();
      return;
    }
    this.snapshot = {
      file: view.file,
      text,
      hint: extractHint(container, range),
    };
    if (this.isFloatingButtonEnabled()) {
      this.showButton(range);
    }
  }

  private showButton(range: Range): void {
    const rects = range.getClientRects();
    const rect =
      rects.length > 0
        ? (rects.item(rects.length - 1) ?? range.getBoundingClientRect())
        : range.getBoundingClientRect();
    const el = this.ensureButtonEl();
    el.style.display = "flex";
    const left = Math.max(8, Math.min(rect.right - 40, window.innerWidth - 230));
    const top = Math.min(rect.bottom + 10, window.innerHeight - 60);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private hideButton(): void {
    if (this.buttonEl) this.buttonEl.style.display = "none";
  }

  private ensureButtonEl(): HTMLDivElement {
    if (this.buttonEl) return this.buttonEl;
    const el = document.body.createDiv({ cls: "readqueue-highlight-fab" });
    this.makeButton(el, "Subrayar", () => {
      void this.applySnapshot();
    });
    this.makeButton(el, "Subrayar + nota", () => {
      this.promptNoteAndApply();
    });
    this.buttonEl = el;
    return el;
  }

  private makeButton(
    parent: HTMLElement,
    label: string,
    onTrigger: () => void,
  ): void {
    const btn = parent.createEl("button", {
      text: label,
      cls: "readqueue-highlight-fab__btn",
    });
    btn.addEventListener("pointerdown", (ev) => {
      // keep the text selection alive while pressing the button
      ev.preventDefault();
      ev.stopPropagation();
    });
    btn.addEventListener("pointerup", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onTrigger();
    });
  }

  private promptNoteAndApply(): void {
    if (!this.snapshot) {
      new Notice(FAILURE_NOTICES.empty);
      return;
    }
    this.hideButton();
    // the modal steals focus and collapses the selection; the snapshot
    // survives because tracking is suspended until the modal closes
    this.suspendSelectionTracking = true;
    new HighlightNoteModal(
      this.plugin.app,
      (note) => {
        void this.applySnapshot(note || undefined);
      },
      () => {
        this.suspendSelectionTracking = false;
      },
    ).open();
  }

  private async applySnapshot(note?: string): Promise<void> {
    const snap = this.snapshot;
    this.hideButton();
    if (!snap) {
      new Notice(FAILURE_NOTICES.empty);
      return;
    }
    let failure: LocateFailureReason | null = null;
    // vault.process = atomic read-modify-write; locating inside the callback
    // guarantees offsets are computed against the exact content being written
    await this.plugin.app.vault.process(snap.file, (source) => {
      const res = locateSelection(source, snap.text, snap.hint);
      if (!res.ok) {
        failure = res.reason;
        return source;
      }
      return applyHighlight(source, res.range, note);
    });
    if (failure !== null) {
      new Notice(FAILURE_NOTICES[failure]);
      return;
    }
    this.snapshot = null;
    window.getSelection()?.removeAllRanges();
    new Notice(note ? "Subrayado + nota agregados." : "Subrayado agregado.");
  }
}

function extractHint(container: HTMLElement, range: Range): OccurrenceHint {
  let before = "";
  let after = "";
  try {
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    before = pre.toString().slice(-CONTEXT_CHARS);
  } catch {
    // selection start outside container — leave empty, hint is best-effort
  }
  try {
    const post = document.createRange();
    post.selectNodeContents(container);
    post.setStart(range.endContainer, range.endOffset);
    after = post.toString().slice(0, CONTEXT_CHARS);
  } catch {
    // ditto
  }
  return { before, after };
}

class HighlightNoteModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly onSubmit: (note: string) => void,
    private readonly onDone: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Subrayar con nota");
    const input = this.contentEl.createEl("textarea", {
      cls: "readqueue-highlight-note__input",
      attr: {
        rows: "3",
        placeholder:
          "Comentario — se guarda como %%comentario%% (invisible en reading view)",
      },
    });
    input.addEventListener("input", () => {
      this.value = input.value;
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        this.submit();
      }
    });
    const actions = this.contentEl.createDiv({
      cls: "readqueue-highlight-note__actions",
    });
    const submitBtn = actions.createEl("button", {
      text: "Subrayar",
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => this.submit());
    const cancelBtn = actions.createEl("button", { text: "Cancelar" });
    cancelBtn.addEventListener("click", () => this.close());
    window.setTimeout(() => input.focus(), 0);
  }

  private submit(): void {
    this.close();
    this.onSubmit(this.value.trim());
  }

  onClose(): void {
    this.contentEl.empty();
    this.onDone();
  }
}
