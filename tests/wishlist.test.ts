import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectWishlist,
  decodeEntities,
  parseWishlistId,
  parseWishlistPage,
  wishlistItemToDesired,
  wishlistUrl,
  type FetchResult,
} from "../src/wishlist";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, `fixtures/${name}`), "utf-8");

const page1 = fixture("amazon-wishlist-page1.html");
const page2 = fixture("amazon-wishlist-page2.html");

describe("parseWishlistPage", () => {
  it("extracts items with asin, title and author from the first page", () => {
    const page = parseWishlistPage(page1);
    expect(page.items.length).toBe(10);
    const first = page.items[0];
    expect(first?.asin).toBe("0387981462");
    expect(first?.title).toContain("Hidden Champions");
    expect(first?.author).toBe("Hermann Simon");
    const outlive = page.items.find((i) => i.asin === "B0B1BTJLJN");
    expect(outlive?.title).toBe("Outlive: The Science and Art of Longevity");
    // binding suffix "(Kindle Edition)" stripped, multi-author kept
    expect(outlive?.author).toBe("Peter Attia MD, Bill Gifford");
  });

  it("exposes a nextPath while more pages remain", () => {
    const page = parseWishlistPage(page1);
    expect(page.nextPath).toBeDefined();
    expect(page.nextPath).toContain("/hz/wishlist/slv/items");
    // entity-decoded: the raw HTML has &amp; in the input value
    expect(page.nextPath).not.toContain("&amp;");
    expect(page.nextPath).toContain("paginationToken=");
  });

  it("parses the paginated fragment (page 2) the same way", () => {
    const page = parseWishlistPage(page2);
    expect(page.items.length).toBe(10);
    expect(page.items[0]?.title).toContain("Suicidal Empathy");
    expect(page.items[0]?.author).toBe("Gad Saad");
  });

  it("does not duplicate ASINs within a page", () => {
    const asins = parseWishlistPage(page1).items.map((i) => i.asin);
    expect(new Set(asins).size).toBe(asins.length);
  });

  it("returns no nextPath when there is no showMoreUrl", () => {
    const page = parseWishlistPage(`<ul id="g-items"></ul>`);
    expect(page.items).toHaveLength(0);
    expect(page.nextPath).toBeUndefined();
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("it&#39;s")).toBe("it's");
    expect(decodeEntities("&#x2019;")).toBe("’");
    expect(decodeEntities("plain")).toBe("plain");
  });
});

describe("parseWishlistId", () => {
  it("extracts the id from a full share URL", () => {
    expect(parseWishlistId("https://www.amazon.com/hz/wishlist/ls/TA4HR5QISRKH?ref_=x")).toBe(
      "TA4HR5QISRKH",
    );
  });
  it("accepts a bare id", () => {
    expect(parseWishlistId("TA4HR5QISRKH")).toBe("TA4HR5QISRKH");
  });
  it("rejects junk", () => {
    expect(parseWishlistId("")).toBeUndefined();
    expect(parseWishlistId("not a list")).toBeUndefined();
  });
});

describe("collectWishlist", () => {
  const emptyPage = `<ul id="g-items"></ul>`;

  it("follows pagination across pages and dedupes by ASIN", async () => {
    const responses = [page1, page2, emptyPage];
    let call = 0;
    const fetchText = async (): Promise<FetchResult> => ({
      status: 200,
      text: responses[call++] ?? emptyPage,
    });
    const res = await collectWishlist("TA4HR5QISRKH", fetchText);
    expect(res.pages).toBe(3);
    expect(res.items).toHaveLength(20);
    expect(res.truncated).toBe(false);
    // no cross-page dupes
    expect(new Set(res.items.map((i) => i.asin)).size).toBe(20);
  });

  it("stops at maxPages and flags truncation", async () => {
    // every page has a nextPath → it would loop forever without the cap
    const fetchText = async (): Promise<FetchResult> => ({ status: 200, text: page1 });
    const res = await collectWishlist("X", fetchText, { maxPages: 2 });
    expect(res.pages).toBe(2);
    expect(res.truncated).toBe(true);
    // page1 has 10 unique asins; the second fetch returns the same → deduped
    expect(res.items).toHaveLength(10);
  });

  it("reports HTTP errors without throwing", async () => {
    const fetchText = async (): Promise<FetchResult> => ({ status: 503, text: "" });
    const res = await collectWishlist("X", fetchText);
    expect(res.error).toBe("http-503");
    expect(res.items).toHaveLength(0);
  });

  it("builds the right start URL", () => {
    expect(wishlistUrl("ABC")).toBe("https://www.amazon.com/hz/wishlist/ls/ABC");
  });
});

describe("wishlistItemToDesired", () => {
  it("maps to a wishlist-shelf DesiredBook with a /dp/ url", () => {
    const desired = wishlistItemToDesired({
      asin: "B0B1BTJLJN",
      itemId: "I1",
      title: "Outlive",
      author: "Peter Attia",
    });
    expect(desired).toEqual({
      asin: "B0B1BTJLJN",
      title: "Outlive",
      author: "Peter Attia",
      shelf: "wishlist",
      url: "https://www.amazon.com/dp/B0B1BTJLJN",
    });
  });
});
