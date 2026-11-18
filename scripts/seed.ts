import "dotenv/config";
import { db, transaction, audit, mutationLock } from "../src/server/db";
if (process.env.NODE_ENV === "production")
  throw new Error("Sample seed is disabled in production.");
const target = new URL(process.env.DATABASE_URL || "");
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !["/lingua_dev", "/lingua_test"].includes(target.pathname)
)
  throw new Error(
    "Sample seed requires a localhost development/test database.",
  );
await transaction(async (tx) => {
  await mutationLock(tx);
  for (const item of [
    {
      title: "Family and Friends 1A",
      description: "A friendly foundation for confident young learners.",
      instructor: "Emma Wilson",
      location: "Studio 1",
      capacity: 1,
    },
    {
      title: "Everyday English",
      description: "Practical conversation for a wider world.",
      instructor: "Daniel Reed",
      location: "Studio 2",
      capacity: 1,
    },
    {
      title: "Speaking with Confidence",
      description: "Find your voice in a supportive conversation group.",
      instructor: "Sophie Clark",
      location: "Conversation room",
      capacity: 1,
    },
  ])
    if (!(await tx.course.findFirst({ where: { title: item.title } }))) {
      const c = await tx.course.create({ data: item });
      await audit(tx, null, "SEED_COURSE", null, {
        courseId: c.id,
        title: c.title,
      });
    }
});
await db.$disconnect();
console.log("Sample courses created. No users or access codes were created.");
