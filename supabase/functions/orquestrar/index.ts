import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async () => {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let execucoes = 0;
  const maxLoops = 10;

  while (execucoes < maxLoops) {
    const res = await fetch(`${baseUrl}/functions/v1/executar-no`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    const data = await res.json();

    // se não tem mais tarefa → para
    if (data.msg === "sem tarefas") {
      return json({
        status: "finalizado",
        passos_executados: execucoes,
      });
    }

    execucoes++;
  }

  return json({
    status: "limite atingido",
    passos_executados: execucoes,
  });
});