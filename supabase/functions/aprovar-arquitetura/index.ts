import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const { projeto_id } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Atualiza ou cria controle de execução
  const { data: existente } = await supabase
    .from("controle_execucao")
    .select("*")
    .eq("projeto_id", projeto_id)
    .single();

  if (existente) {
    await supabase
      .from("controle_execucao")
      .update({
        status: "executando",
        updated_at: new Date()
      })
      .eq("projeto_id", projeto_id);
  } else {
    await supabase
      .from("controle_execucao")
      .insert({
        projeto_id,
        status: "executando"
      });
  }

  return new Response(
    JSON.stringify({ ok: true, status: "executando" }),
    { headers: { "Content-Type": "application/json" } }
  );
});