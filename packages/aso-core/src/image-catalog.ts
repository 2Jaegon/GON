import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const FORBIDDEN_BRANDS = [
  "Disney",
  "Spotify",
  "Adidas",
  "CELINE",
  "alo",
  "Starbucks",
  "Apple",
  "AirPods",
  "Lawson",
  "Zara",
  "H&M",
  "Canon",
  "iPhone",
] as const;

export const DEFAULT_CATALOG_PATH = path.resolve(process.cwd(), "config/image-prompt-catalog.json");

export const ImageCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  triggers: z.array(z.string()),
  requiredRefs: z.object({
    count: z.number(),
    role: z.string(),
  }),
  template: z.string(),
  ruleBlocks: z.array(z.string()),
});

export const ImageRuleBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  instruction: z.string(),
});

export const ImageExcludedSchema = z.object({
  id: z.string(),
  name: z.string(),
  reason: z.string(),
});

export const ImageCatalogSchema = z.object({
  categories: z.array(ImageCategorySchema),
  ruleBlocks: z.record(ImageRuleBlockSchema),
  excluded: z.array(ImageExcludedSchema),
});

export type ImageCategory = z.infer<typeof ImageCategorySchema>;
export type ImageRuleBlock = z.infer<typeof ImageRuleBlockSchema>;
export type ImageExcluded = z.infer<typeof ImageExcludedSchema>;
export type ImageCatalog = z.infer<typeof ImageCatalogSchema>;

export function loadImageCatalog(filePath: string = DEFAULT_CATALOG_PATH): ImageCatalog {
  let resolvedPath = filePath;
  if (!fs.existsSync(resolvedPath)) {
    // Fallback: look relative to current working dir or gon root
    const fallback = path.resolve(process.cwd(), "config/image-prompt-catalog.json");
    if (fs.existsSync(fallback)) {
      resolvedPath = fallback;
    } else {
      throw new Error(`Image catalog file not found at: ${filePath}`);
    }
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsedJson = JSON.parse(raw);
  return ImageCatalogSchema.parse(parsedJson);
}

