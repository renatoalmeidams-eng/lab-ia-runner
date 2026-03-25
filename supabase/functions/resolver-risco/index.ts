import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { risco_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 🔄 Resolver risco
    const { data: risco } = await supabase
      .from("riscos")
      .update({ status: "resolvido" })
      .eq("id", risco_id)
      .select()
      .single();

    if (!risco) {
      return new Response(JSON.stringify({
        error: "Risco não encontrado"
      }), { status: 404 });
    }

    const projeto_id = risco.projeto_id;

    // 🔍 Verificar se ainda existem riscos pendentes
    const { data: riscosPendentes } = await supabase
      .from("riscos")
      .select("*")
      .eq("projeto_id", projeto_id)
      .eq("status", "pendente");

    // 🚀 Se NÃO houver mais riscos → executa automaticamente
    if (!riscosPendentes || riscosPendentes.length === 0) {

      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/processar-tarefa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
        },
        body: JSON.stringify({ projeto_id })
      });

      return new Response(JSON.stringify({
        ok: true,
        mensagem: "Risco resolvido e execução iniciada automaticamente"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      mensagem: "Risco resolvido, ainda existem riscos pendentes"
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message
    }), { status: 500 });
  }
});