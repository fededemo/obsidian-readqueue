import { describe, expect, it } from "vitest";

import { isWebClipperOrphan } from "../src/queue-data";

const PROTECTED = [
  "Inbox/",
  "Inbox/Web/",
  "Inbox/Pending/",
  "Inbox/Read/",
  "Inbox/Legacy/",
  "Diario/",
];

const clip = { source: "https://example.com/post", tags: ["clippings"] };

describe("isWebClipperOrphan", () => {
  it("treats a clipping outside the managed inbox as an orphan", () => {
    expect(isWebClipperOrphan("Clippings/post.md", clip, PROTECTED)).toBe(true);
    expect(isWebClipperOrphan("post.md", clip, PROTECTED)).toBe(true);
  });

  it("never re-queues an archived read note (the Inbox/Read regression)", () => {
    expect(
      isWebClipperOrphan("Inbox/Read/2026-06/post.md", clip, PROTECTED),
    ).toBe(false);
  });

  it("never touches anything under the managed Inbox/ tree", () => {
    for (const p of [
      "Inbox/Web/x.md",
      "Inbox/Read/2026-06/x.md",
      "Inbox/Kindle/x.md",
      "Inbox/Legacy/x.md",
      "Inbox/whatever/x.md",
    ]) {
      expect(isWebClipperOrphan(p, clip, PROTECTED)).toBe(false);
    }
  });

  it("never moves a status:read note, even outside the read folder", () => {
    expect(
      isWebClipperOrphan(
        "somewhere/post.md",
        { ...clip, status: "read" },
        PROTECTED,
      ),
    ).toBe(false);
  });

  it("respects every protected prefix", () => {
    for (const p of PROTECTED) {
      expect(isWebClipperOrphan(`${p}post.md`, clip, PROTECTED)).toBe(false);
    }
  });

  it("ignores files without frontmatter", () => {
    expect(isWebClipperOrphan("Clippings/post.md", undefined, PROTECTED)).toBe(
      false,
    );
  });

  it("ignores non-clipping notes (no clip tag, no url, no intake source)", () => {
    expect(
      isWebClipperOrphan(
        "Notes/idea.md",
        { source: "manual", tags: ["zettel"] },
        PROTECTED,
      ),
    ).toBe(false);
  });

  it("detects clippings via tag, url source, or intake source", () => {
    expect(isWebClipperOrphan("x/a.md", { tags: "reader" }, PROTECTED)).toBe(
      true,
    );
    expect(
      isWebClipperOrphan("x/b.md", { source: "web-clipper" }, PROTECTED),
    ).toBe(true);
    expect(
      isWebClipperOrphan("x/c.md", { source: "intake-fxtwitter" }, PROTECTED),
    ).toBe(true);
    expect(
      isWebClipperOrphan("x/d.md", { source: "http://t.co/1" }, PROTECTED),
    ).toBe(true);
  });
});
