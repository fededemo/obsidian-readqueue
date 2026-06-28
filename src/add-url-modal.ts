import { Modal, Notice, TFile, type App } from "obsidian";

import { looksLikeUrl, normalizeUrlInput } from "./add-url";
import type ReadQueuePlugin from "./main";

/**
 * Palette command "Agregar URL a la cola": one input, clipboard prefill,
 * and the same intake pipeline as the pending-folder scan (processUrl).
 */
export class AddUrlModal extends Modal {
  private plugin: ReadQueuePlugin;
  private busy = false;

  constructor(app: App, plugin: ReadQueuePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.titleEl.setText("Agregar URL a la cola");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("readqueue-addurl");

    const input = contentEl.createEl("input", {
      cls: "readqueue-addurl__input",
      attr: {
        type: "text",
        placeholder: "https://…",
        "aria-label": "URL del artículo",
      },
    });
    const errorEl = contentEl.createDiv({ cls: "readqueue-addurl__error" });
    const actions = contentEl.createDiv({ cls: "readqueue-addurl__actions" });
    const submit = actions.createEl("button", {
      cls: "mod-cta",
      text: "Agregar",
    });

    try {
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (!input.value && looksLikeUrl(text)) input.value = text.trim();
        })
        .catch(() => undefined);
    } catch {
      // clipboard unavailable (permissions, mobile webview) — skip prefill
    }

    const doSubmit = (): void => {
      if (this.busy) return;
      const url = normalizeUrlInput(input.value);
      if (!url) {
        errorEl.setText("Eso no parece una URL válida (http/https).");
        return;
      }
      errorEl.setText("");
      this.busy = true;
      submit.disabled = true;
      submit.setText("Procesando…");
      void this.plugin.addUrlToQueue(url).then((outcome) => {
        if (outcome.ok && outcome.destination) {
          this.close();
          this.showSuccessNotice(outcome.title ?? url, outcome.destination);
          return;
        }
        if (outcome.skipped === "duplicate") {
          this.close();
          this.plugin.notifyDuplicate(outcome.existing);
          return;
        }
        this.busy = false;
        submit.disabled = false;
        submit.setText("Agregar");
        errorEl.setText(
          `No se pudo procesar: ${outcome.error ?? "error desconocido"}`,
        );
      });
    };

    submit.onclick = doSubmit;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        doSubmit();
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private showSuccessNotice(title: string, destination: string): void {
    const notice = new Notice("", 10_000);
    notice.noticeEl.createSpan({
      text: `ReadQueue: «${title}» agregado a la cola. `,
    });
    const open = notice.noticeEl.createEl("a", { text: "Abrir" });
    open.onclick = (ev) => {
      ev.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(destination);
      if (file instanceof TFile) {
        void this.app.workspace
          .getLeaf(false)
          .openFile(file, { state: { mode: "preview" } });
      }
      notice.hide();
    };
  }
}
