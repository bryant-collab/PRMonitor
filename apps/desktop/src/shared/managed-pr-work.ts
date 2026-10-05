import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u);
export const managedPrWorkSchema = z
  .object({
    managedPrId: id,
    nextOffset: z.number().int().min(1).max(50000).optional(),
    reviews: z
      .array(
        z
          .object({ bundleId: id, updatedAt: z.string().min(1).max(128) })
          .strict(),
      )
      .max(50),
    synchronization: z
      .array(z.object({ batchId: id, resultId: id }).strict())
      .max(50),
  })
  .strict();
export type ManagedPrWork = z.infer<typeof managedPrWorkSchema>;
