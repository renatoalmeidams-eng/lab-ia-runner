import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizarRisco(r: any) {
  const map: any = { baixo: 1, medio: 2, alto: 3 };

  const impacto = r.impacto ?? "baixo";
  const prob = r.probabilidade ?? "baixo";

  const impacto_num = map[impacto];
  const probabilidade_num = map[prob];

  const score = impacto_num * probabilidade_num;

  const classificacao =
    score >= 6 ? "alto" : score >= 3 ? "medio" : "baixo";

  return {
    ...r,
    impacto_num,
    probabilidade_num,
    score,
    classificacao,
  };
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { projeto_id } = await req.json();

    if (!projeto_id) {
      return jsonResponse({ error: "projeto_id é obrigatório" }, 400);
    }

    // ── 1. Buscar tarefas
    const { data: tarefas, error: errT } = await supabase
      .from("tarefas")
      .select("*")
      .eq("projeto_id", projeto_id);

    if (errT) {
      return jsonResponse({ error: errT.message }, 500);
    }

    // ── 2. Chamar agente auditor
    const agente = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/executar-agente`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          agente: "auditor",
          input: { tarefas },
        }),
      }
    );

    const agenteData = await agente.json();
    const riscosRaw = agenteData?.output?.riscos || [];

    let mitigacoesCriadas = 0;

    // ── 3. Processar riscos
    for (const r of riscosRaw) {
      let risco;

      try {
        risco = normalizarRisco(r);
      } catch {
        continue;
      }

      // ── Apenas ações executáveis
      if (risco.mitigacao?.tipo !== "nova_tarefa") continue;

      // 🔥 GERAR ID MANUAL (OBRIGATÓRIO NO SEU SCHEMA)
      const novoId = crypto.randomUUID();

      const payloadInsert: any = {
        id: novoId,
        projeto_id,
        tipo_tarefa: "mitigacao",
        status: "pendente",
        aprovado: true,

        payload: {
          titulo: risco.mitigacao.titulo,
          descricao: risco.mitigacao.descricao,
          prioridade: risco.mitigacao.prioridade,
          risco_score: risco.score,
          origem: "auditoria"
        }
      };

      const { error: errM } = await supabase
        .from("tarefas")
        .insert(payloadInsert);

      if (errM) {
        return jsonResponse({
          erro_real: errM,
          payload_enviado: payloadInsert
        }, 500);
      }

      mitigacoesCriadas++;
    }

    // ── retorno final
    return jsonResponse({
      ok: true,
      projeto_id,
      mitigacoes_criadas: mitigacoesCriadas
    });

  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});