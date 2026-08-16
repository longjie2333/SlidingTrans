import { z } from "zod";

const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(200) })),
});

export function parseModelIds(value: unknown): string[] {
  const parsed = modelsResponseSchema.parse(value);
  return [...new Set(parsed.data.map((model) => model.id))].sort((left, right) => left.localeCompare(right));
}
