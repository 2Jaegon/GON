import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  loadImageCatalog,
  ImageCatalogSchema,
  FORBIDDEN_BRANDS,
  DEFAULT_CATALOG_PATH
} from "@aso/core";

describe("Image Prompt Catalog & Loader", () => {
  it("loads the default image prompt catalog successfully", () => {
    const catalog = loadImageCatalog();
    expect(catalog).toBeDefined();
    expect(catalog.categories).toHaveLength(13);

    const parsed = ImageCatalogSchema.safeParse(catalog);
    expect(parsed.success).toBe(true);
  });

  it("contains all 13 categories C1 to C13 with correct properties", () => {
    const catalog = loadImageCatalog();
    const expectedIds = [
      "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13"
    ];

    const actualIds = catalog.categories.map((c) => c.id);
    expect(actualIds).toEqual(expectedIds);

    for (const cat of catalog.categories) {
      expect(cat.id).toMatch(/^C([1-9]|1[0-3])$/);
      expect(cat.name).toBeTruthy();
      expect(cat.triggers.length).toBeGreaterThan(0);
      expect(cat.template).toBeTruthy();
      expect(cat.ruleBlocks.length).toBeGreaterThan(0);
      expect(typeof cat.requiredRefs.count).toBe("number");
      expect(typeof cat.requiredRefs.role).toBe("string");
    }
  });

  it("contains rule blocks dictionary and excluded list", () => {
    const catalog = loadImageCatalog();
    expect(catalog.ruleBlocks).toBeDefined();
    expect(Object.keys(catalog.ruleBlocks).length).toBeGreaterThanOrEqual(15);
    expect(catalog.ruleBlocks["B1"]).toBeDefined();
    expect(catalog.ruleBlocks["B2"]).toBeDefined();

    expect(catalog.excluded).toBeDefined();
    expect(catalog.excluded.some((e) => e.id === "C14")).toBe(true);
    expect(catalog.excluded.some((e) => e.id === "C15")).toBe(true);
  });

  it("ensures all templates use English, contain valid {slot} placeholders, and have no forbidden brand names or [출처]", () => {
    const catalog = loadImageCatalog();
    const rawJson = JSON.stringify(catalog);

    // No [출처] string anywhere in the catalog
    expect(rawJson).not.toContain("[출처]");
    expect(rawJson).not.toContain("출처:");

    // No forbidden brand/IP names
    for (const brand of FORBIDDEN_BRANDS) {
      const regex = new RegExp(`\\b${brand}\\b`, "i");
      expect(regex.test(rawJson), `Catalog should not contain brand: ${brand}`).toBe(false);
    }

    // All templates must have {slot} format placeholders
    for (const cat of catalog.categories) {
      const slotMatches = cat.template.match(/\{[a-zA-Z0-9_]+\}/g);
      expect(slotMatches, `Category ${cat.id} must contain {slot} placeholders`).not.toBeNull();
      expect(slotMatches!.length).toBeGreaterThan(0);

      // Template should not contain hangul (English only for generation)
      const hasHangul = /[가-힣]/.test(cat.template);
      expect(hasHangul, `Template for ${cat.id} must be in English`).toBe(false);
    }
  });

  it("loads from a custom file path", () => {
    const customPath = path.resolve(process.cwd(), "config/image-prompt-catalog.json");
    const catalog = loadImageCatalog(customPath);
    expect(catalog.categories).toHaveLength(13);
  });
});
