export const json = async (url: string, body?: unknown) => {
  const r = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(d.error || "Request failed."), {
      status: r.status,
    });
  return d;
};
