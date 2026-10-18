import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const fetchRequestSchema = z
  .object({
    url: z.string().min(1).max(2048),
    engine: z.string().min(1).max(40).optional(),
    ai: z
      .object({
        summary: z.boolean().optional(),
        tags: z.boolean().optional(),
        translate: z.boolean().optional(),
        analyze: z.boolean().optional(),
        language: z.string().min(2).max(10).optional(),
        quality: z.boolean().optional(),
      })
      .strict()
      .optional(),
    archive: z
      .union([
        z.boolean(),
        z
          .object({ channels: z.array(z.string().min(1).max(40)).max(6) })
          .strict(),
      ])
      .optional(),
  })
  .strict();

export type FetchRequestBody = z.infer<typeof fetchRequestSchema>;

export const aiTaskSchema = z.enum(["translate", "summarize", "titles", "tags", "analyze"]);

export const aiRequestSchema = z
  .object({
    id: z.string().regex(UUID).optional(),
    url: z.string().min(1).max(2048).optional(),
    task: aiTaskSchema,
    language: z.string().min(2).max(10).optional(),
    summary_length: z.enum(["short", "medium", "long"]).optional(),
    quality: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.id || value.url), { message: "id or url is required" });

export type AiRequestBody = z.infer<typeof aiRequestSchema>;

export const archiveRequestSchema = z
  .object({
    id: z.string().regex(UUID),
    channels: z.array(z.string().min(1).max(40)).max(6).optional(),
  })
  .strict();

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().max(40).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
  platform: z.string().max(20).optional(),
  before: z.string().max(40).optional(),
  sort: z.enum(["relevance", "recent"]).optional(),
});
