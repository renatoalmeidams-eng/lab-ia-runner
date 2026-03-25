import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { ideia } = await req.json();

  // 🔥 aqui você transforma ideia em tarefa inicial
  await supabase.from("fila_tarefas").insert({
    descricao: ideia,
    status: "pendente",
  });

  return json({ ok: true });
});