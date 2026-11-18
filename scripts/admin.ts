import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash, argon2id } from "argon2";
import { db, transaction, mutationLock, audit } from "../src/server/db";
async function hidden(prompt: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error("Run this command in an interactive terminal.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const read = (buffer: Buffer) => {
      for (const c of buffer.toString()) {
        if (c === "\r" || c === "\n") {
          stdin.off("data", read);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          stdin.off("data", read);
          stdin.setRawMode(false);
          stdin.pause();
          reject(new Error("Cancelled."));
          return;
        }
        if (c === "\u007f" || c === "\b") {
          value = value.slice(0, -1);
        } else if (c >= " ") value += c;
      }
    };
    stdin.on("data", read);
  });
}
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  const name = (await rl.question("Admin name: ")).trim();
  rl.close();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2)
    throw new Error("Enter a valid email and name.");
  const password = await hidden("Password (at least 14 characters; hidden): ");
  const confirm = await hidden("Confirm password: ");
  if (password.length < 14 || password !== confirm)
    throw new Error("Passwords must match and contain at least 14 characters.");
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  await transaction(async (tx) => {
    await mutationLock(tx);
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && existing.role !== "ADMIN")
      throw new Error("This email belongs to a student.");
    const user = await tx.user.upsert({
      where: { email },
      create: { name, email, role: "ADMIN", passwordHash },
      update: { name, passwordHash, active: true, archivedAt: null },
    });
    await tx.authSession.deleteMany({ where: { userId: user.id } });
    await audit(tx, user.id, "ADMIN_CREDENTIAL_RESET", user.id);
  });
  console.log("Administrator saved. Existing sessions have been revoked.");
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
