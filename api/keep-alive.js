/**
 * SpendWise keep-alive.
 *
 * Supabase pauses Free Plan projects after 7 days without activity. Any API
 * request resets that timer. Vercel Cron hits this endpoint on a schedule,
 * and this endpoint makes a real query against Postgres.
 *
 * A request to the *site* is not enough - Vercel serves that from its own
 * CDN and Supabase never hears about it. The database itself must be read,
 * which is what the fetch below does.
 *
 * The anon key is public by design; it already ships inside index.html.
 * Env vars are still the better home for it, so this prefers them and falls
 * back to the inline values so the cron works the moment you deploy, even
 * if you never set the env vars.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://eoacbspokedsxlgstljr.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvYWNic3Bva2Vkc3hsZ3N0bGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTc5MzgsImV4cCI6MjA5ODI5MzkzOH0.ev1LIPm4t-sTkRqmvQ6UlTu2NDZ7WvSaaoKp1NNsI8U";

export default async function handler(req, res) {
  const started = Date.now();

  // Optional hardening. If you set a CRON_SECRET env var in Vercel, only
  // callers presenting it get through. Without it, the endpoint is open -
  // which is harmless here, since all it can do is read one dummy row.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/heartbeat?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
        },
        // Never let a hung socket burn the whole function budget.
        signal: AbortSignal.timeout(8000),
      }
    );

    const body = await r.text();
    const ms = Date.now() - started;

    if (!r.ok) {
      // A non-2xx still reached Supabase, so the timer was probably reset
      // anyway - but surface it, because it usually means the heartbeat
      // table or its read policy is missing.
      console.error("keep-alive: HTTP " + r.status + " " + body.slice(0, 200));
      return res
        .status(502)
        .json({ ok: false, status: r.status, ms, hint: "run heartbeat-table.sql" });
    }

    console.log("keep-alive: ok in " + ms + "ms");
    return res.status(200).json({ ok: true, ms, at: new Date().toISOString() });
  } catch (e) {
    console.error("keep-alive: " + (e && e.message));
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
