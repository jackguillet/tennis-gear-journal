export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export async function readJson(request, maxBytes = 512 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("Request is too large."), { status: 413 });
  try { return JSON.parse(text || "{}"); }
  catch { throw Object.assign(new Error("Request body is not valid JSON."), { status: 400 }); }
}
