import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, AppError, transaction, audit } from "@/server/db";
import { viewer, login, checkOrigin, COOKIE, digest } from "@/server/auth";
import { commands, date } from "@/server/validation";
import { jalali } from "@/lib/calendar";
import { execute, snapshot, bookingHistory } from "@/server/service";
export const dynamic = "force-dynamic";
function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path.join("/");
    if (request.method === "GET" && path === "health/live")
      return response({ status: "ok" });
    if (request.method === "GET" && path === "health/ready") {
      await db.$queryRaw`SELECT 1`;
      return response({ status: "ready" });
    }
    if (request.method === "POST") checkOrigin(request);
    if (request.method === "POST" && path === "auth/login") {
      const input = z
        .union([
          z.object({ code: z.string().min(20).max(100) }),
          z.object({
            email: z.email().max(254),
            password: z.string().min(1).max(256),
          }),
        ])
        .parse(await request.json());
      const raw = await login(
        input,
        request.headers.get("x-real-ip") || "local",
      );
      const res = response({ ok: true });
      res.cookies.set(COOKIE, raw, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      return res;
    }
    const user = await viewer();
    if (!user) throw new AppError(401, "Please sign in.");
    if (request.method === "POST" && path === "auth/logout") {
      const raw = request.cookies.get(COOKIE)?.value;
      await transaction(async (tx) => {
        if (raw)
          await tx.authSession.deleteMany({ where: { id: digest(raw) } });
        await audit(tx, user.id, "SIGN_OUT", user.id);
      });
      const res = response({ ok: true });
      res.cookies.delete(COOKIE);
      return res;
    }
    if (request.method === "GET" && path === "workspace") {
      const query = z
        .object({
          start: date.optional(),
          end: date.optional(),
          student: z.union([z.uuid(), z.literal("")]).optional(),
          page: z.coerce.number().int().min(1).max(10000).optional(),
          q: z.string().max(100).optional(),
        })
        .parse(Object.fromEntries(request.nextUrl.searchParams));
      if (!!query.start !== !!query.end)
        throw new AppError(400, "Provide both calendar range dates.");
      if (query.start && query.end) {
        const first = jalali(query.start),
          last = jalali(query.end);
        if (
          last.compare(first) <= 0 ||
          last.compare(first.add({ months: 2 })) > 0
        )
          throw new AppError(
            400,
            "Choose a calendar range of at most two months.",
          );
      }
      return response(await snapshot(user.id, request.nextUrl.searchParams));
    }
    if (request.method === "GET" && path === "bookings") {
      return response(
        await bookingHistory(user.id, request.nextUrl.searchParams),
      );
    }
    if (request.method === "POST" && path === "commands")
      return response(
        await execute(
          user.id,
          commands.parse(await request.json()),
          digest(request.cookies.get(COOKIE)!.value),
        ),
      );
    throw new AppError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof AppError)
      return response({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return response(
        { error: error.issues.map((i) => i.message).join(" ") },
        400,
      );
    if (error instanceof SyntaxError)
      return response({ error: "Invalid request." }, 400);
    if (error instanceof RangeError)
      return response(
        { error: "The selected Tehran date or time is invalid." },
        400,
      );
    if (error instanceof Error && "code" in error && error.code === "P2002")
      return response({ error: "This record already exists." }, 409);
    console.error("Request failed", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return response(
      { error: "The request could not be completed. Please try again." },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
