// Stubs of value exports from "obsidian" so tests can import modules
// that depend on them. None of these are expected to be called during tests
// — tests inject explicit fakes via IntakeDeps. Calls throw so accidental
// reliance shows up loudly.

export function htmlToMarkdown(_html: string): string {
  throw new Error("obsidian-mock: htmlToMarkdown was called — inject a fake via deps");
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export async function requestUrl(_opts: unknown): Promise<{ status: number; text: string }> {
  throw new Error("obsidian-mock: requestUrl was called — inject a fake via deps");
}

export function stringifyYaml(_value: unknown): string {
  throw new Error("obsidian-mock: stringifyYaml was called — inject a fake via deps");
}

export class Plugin {}
export class ItemView {}

export type App = unknown;
export type TFile = unknown;
export type WorkspaceLeaf = unknown;
export type MarkdownView = unknown;
export type FrontMatterCache = unknown;
