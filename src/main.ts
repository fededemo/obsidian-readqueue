import { Plugin } from "obsidian";

export default class ReadQueuePlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("ReadQueue: loaded (scaffold — Fase 1 implementation pending)");
  }

  async onunload(): Promise<void> {
    console.log("ReadQueue: unloaded");
  }
}
