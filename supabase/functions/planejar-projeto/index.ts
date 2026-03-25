import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { projeto_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // =============================
    // 1. GERAR TAREFAS (SE NÃO EXISTIREM)
    // =============================

    const tarefasGeradas = [
      { titulo: "Criar estrutura base", ordem: 1 },
      { titulo: "Configurar banco de dados", ordem: 2 },
      { titulo: "Criar endpoints iniciais", ordem: 3 }
    ];

    const { data: tarefasExistentes } = await supabase
      .from("fila_tarefas")
      .select("*")
      .eq("projeto_id", projeto_id);

    if (!tarefasExistentes || tarefasExistentes.length === 0) {
      for (const tarefa of tarefasGeradas) {
        await supabase.from("fila_tarefas").insert({
          projeto_id,
          descricao: tarefa.titulo,
          status: "pendente",
          ordem: tarefa.ordem,
          aprovado: false,
          modo_execucao: "manual"
        });
      }
    }

    // =============================
    // 2. GERAR RISCOS (ANTI-LOOP)
    // =============================

    const { data: riscosExistentes } = await supabase
      .from("riscos")
      .select("*")
      .eq("projeto_id", projeto_id);

    let riscosDetectados = [];

    if (!riscosExistentes || riscosExistentes.length === 0) {
      riscosDetectados = [
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

      for (const risco of riscosDetectados) {
        await supabase.from("riscos").insert({
          projeto_id,
          descricao: risco.descricao,
          impacto: risco.impacto,
          solucao: risco.solucao,
          status: "pendente"
        });
      }
    } else {
      riscosDetectados = riscosExistentes;
    }

    // =============================
    // 3. RETORNO
    // =============================

    return new Response(JSON.stringify({
      ok: true,
      tarefas: tarefasGeradas,
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