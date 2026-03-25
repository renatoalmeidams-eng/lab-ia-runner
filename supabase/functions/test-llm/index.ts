import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-haiku-20240307";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let prompt: string;
  try {
    const body = await req.json();
    prompt = body?.prompt;
    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid prompt" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text();
    return new Response(
      JSON.stringify({ error: errorText }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const data = await anthropicResponse.json();
  const text = data?.content?.[0]?.text;

  return new Response(
    JSON.stringify({ response: text }),
    { headers: { "Content-Type": "application/json" } }
  );
});