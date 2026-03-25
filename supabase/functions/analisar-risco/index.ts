import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { projeto_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 🔍 Simulação de análise de risco (depois entra IA)
    const riscosDetectados = [
      {
        descricao: "Falta de validação de entrada de dados",
        impacto: "Possível erro ou inconsistência no sistema",
        solucao: "Implementar validação no backend"
      },
      {
        descricao: "Ausência de tratamento de erro",
        impacto: "Sistema pode quebrar silenciosamente",
        solucao: "Adicionar try/catch e logs"
      }
    ];

    // 💾 Salvar riscos
    for (const risco of riscosDetectados) {
      await supabase.from("riscos").insert({
        projeto_id,
        descricao: risco.descricao,
        impacto: risco.impacto,
        solucao: risco.solucao
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      riscos: riscosDetectados
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message
    }), { status: 500 });
  }
});