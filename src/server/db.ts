import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      options: "-c timezone=Asia/Tehran",
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
export type Tx = Prisma.TransactionClient;
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let i = 0; i < 4; i++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Tehran'");
          return fn(tx);
        },
        { isolationLevel: "Serializable", timeout: 20000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        if (i < 3) continue;
        throw new AppError(
          409,
          "The school is busy. Please retry this operation.",
        );
      }
      throw error;
    }
  }
  throw new AppError(409, "Please retry the operation.");
}
// Shared transaction lock serializes mutations that affect authorization, seats, and schedules.
export async function mutationLock(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(719348201)`;
}
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  subjectId: string | null,
  details: Prisma.InputJsonValue = {},
  outcome = "SUCCESS",
) {
  await tx.auditEvent.create({
    data: { actorId, action, subjectId, details, outcome },
  });
}
