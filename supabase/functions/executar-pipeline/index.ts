import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_EXECUCOES = 5;
const MAX_RETRY = 3;

interface Tarefa {
  id: string;
  status: string;
  risco_nivel: string | null;
  aprovado: boolean | null;
  dependencias: string[] | null;
  tipo_tarefa: "normal" | "mitigacao";
  tarefa_origem_id: string | null;
  ordem: number;
  payload: any;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getPrioridade(t: Tarefa): number {
  const p = t.payload?.prioridade || "media";

  if (t.tipo_tarefa === "mitigacao") return 4;
  if (p === "alta") return 3;
  if (p === "media") return 2;
  return 1;
}

function getTitulo(t: Tarefa): string {
  return t.payload?.titulo || t.id;
}

async function logExecucao(supabase: any, tarefa_id: string, status: string, erro?: string, tentativas = 0) {
  await supabase.from("logs_execucao").insert({
    tarefa_id,
    status,
    erro: erro || null,
    tentativas
  });
}

async function executarTarefa(url: string, key: string, tarefa_id: string) {
  const res = await fetch(`${url}/functions/v1/executar-tarefa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ tarefa_id }),
  });

  const data = await res.json();
  return res.ok ? { ok: true } : { ok: false, error: data };
}

async function updateStatus(supabase: any, id: string, status: string) {
  await supabase.from("tarefas").update({ status }).eq("id", id);
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const URL = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const { projeto_id } = await req.json();

    let execucoes = 0;

    // ─────────────── 1. MITIGAÇÕES ───────────────
    const { data: mitigacoes } = await supabase
      .from("tarefas")
      .select("*")
      .eq("projeto_id", projeto_id)
      .eq("tipo_tarefa", "mitigacao")
      .eq("status", "pendente");

    if (mitigacoes?.length) {
      for (const t of mitigacoes as Tarefa[]) {
        if (execucoes >= MAX_EXECUCOES) break;

        await updateStatus(supabase, t.id, "executando");

        const res = await executarTarefa(URL, KEY, t.id);

        if (!res.ok) {
          const tentativas = (t.payload?.tentativas || 0) + 1;

          await logExecucao(supabase, t.id, "erro", JSON.stringify(res.error), tentativas);

          if (tentativas >= MAX_RETRY) {
            await updateStatus(supabase, t.id, "bloqueado");
          } else {
            await supabase.from("tarefas").update({
              payload: { ...t.payload, tentativas }
            }).eq("id", t.id);
            await updateStatus(supabase, t.id, "pendente");
          }

          continue;
        }

        await updateStatus(supabase, t.id, "concluida");
        await logExecucao(supabase, t.id, "sucesso");

        execucoes++;
      }

      // revalidação
      const auditor = await fetch(`${URL}/functions/v1/executar-auditoria`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({ projeto_id }),
      });

      const auditorData = await auditor.json();

      return jsonResponse({
        ok: true,
        modo: "mitigacao",
        novas_mitigacoes: auditorData?.resumo?.mitigacoes_criadas || 0,
        reexecutar: (auditorData?.resumo?.mitigacoes_criadas || 0) > 0
      });
    }

    // ─────────────── 2. TAREFAS NORMAIS ───────────────
    const { data: tarefas } = await supabase
      .from("tarefas")
      .select("*")
      .eq("projeto_id", projeto_id)
      .eq("status", "pendente");

    const ordenadas = (tarefas as Tarefa[])
      .filter(t => t.tipo_tarefa !== "mitigacao")
      .sort((a, b) => getPrioridade(b) - getPrioridade(a));

    const executadas = [];

    for (const t of ordenadas) {
      if (execucoes >= MAX_EXECUCOES) break;

      // 🔒 aprovação obrigatória
      if (!t.aprovado) continue;

      // dependências
      if (t.dependencias?.length) {
        const { data: deps } = await supabase
          .from("tarefas")
          .select("status")
          .in("id", t.dependencias);

        if (deps?.some(d => d.status !== "concluida")) continue;
      }

      await updateStatus(supabase, t.id, "executando");

      const res = await executarTarefa(URL, KEY, t.id);

      if (!res.ok) {
        const tentativas = (t.payload?.tentativas || 0) + 1;

        await logExecucao(supabase, t.id, "erro", JSON.stringify(res.error), tentativas);

        if (tentativas >= MAX_RETRY) {
          await updateStatus(supabase, t.id, "bloqueado");
        } else {
          await supabase.from("tarefas").update({
            payload: { ...t.payload, tentativas }
          }).eq("id", t.id);
          await updateStatus(supabase, t.id, "pendente");
        }

        continue;
      }

      await updateStatus(supabase, t.id, "concluida");
      await logExecucao(supabase, t.id, "sucesso");

      executadas.push({
        id: t.id,
        titulo: getTitulo(t)
      });

      execucoes++;
    }

    return jsonResponse({
      ok: true,
      modo: "normal",
      executadas,
      reexecutar: false
    });

  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});