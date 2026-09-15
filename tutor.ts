// Equilibrium — AI tutor proxy.
// The Anthropic key is a Supabase secret and never reaches the browser.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function
// named "tutor", paste this file, then add the ANTHROPIC_API_KEY secret.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "The tutor is not configured yet." }, 500);

  try {
    const { messages, system, max_tokens } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "No question was sent." }, 400);
    }
    // Keep costs predictable and refuse oversized payloads.
    const trimmed = messages.slice(-16).map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content).slice(0, 6000),
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(Number(max_tokens) || 1000, 4000),
        system: typeof system === "string" ? system : undefined,
        messages: trimmed,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("anthropic error", res.status, detail);
      return json({ error: "The tutor is unavailable right now." }, 502);
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");

    return json({ text });
  } catch (err) {
    console.error(err);
    return json({ error: "The tutor could not be reached." }, 500);
  }
});
