import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = {
  auth: false,
};

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let tarefa: any = null;

  try {
    console.log("🚀 processar-tarefa iniciado");

    const { data: tarefas, error } = await supabase
      .from("tarefas")
      .select("*")
      .eq("status", "pendente")
      .order("criado_em", { ascending: true })
      .limit(1);

    if (error) {
      console.error("❌ erro ao buscar tarefas:", error);
      return new Response(JSON.stringify({ erro: error.message }), { status: 500 });
    }

    if (!tarefas || tarefas.length === 0) {
      console.log("⚠️ nenhuma tarefa pendente encontrada");
      return new Response(JSON.stringify({ ok: true }));
    }

    tarefa = tarefas[0];

    console.log("📌 tarefa encontrada:", tarefa.id);

    await supabase
      .from("tarefas")
      .update({ status: "executando" })
      .eq("id", tarefa.id);

    const runnerUrl = Deno.env.get("RUNNER_URL");

    console.log("🌐 RUNNER_URL:", runnerUrl);

    if (!runnerUrl) {
      throw new Error("RUNNER_URL não definida");
    }

    // ── CHAMAR IA ──────────────────────────────────────────────────────────────
    console.log("🤖 chamando executar-agente para tarefa:", tarefa.id);

    const { data: respostaIA, error: erroIA } = await supabase.functions.invoke("executar-agente", {
      body: {
        agente: "executor",
        input: tarefa.payload,
      },
    });

    console.log("📨 resposta da IA:", JSON.stringify(respostaIA));

    if (erroIA || !respostaIA) {
      const msgErro = erroIA ? String(erroIA) : "resposta vazia da IA";
      console.error("❌ erro na IA:", msgErro);
      await supabase
        .from("tarefas")
        .update({ status: "erro", resultado: { erro: msgErro } })
        .eq("id", tarefa.id);
      return new Response(JSON.stringify({ erro: msgErro }), { status: 500 });
    }

    const arquivos = respostaIA?.output?.arquivos || respostaIA?.arquivos;

    if (!arquivos || !Array.isArray(arquivos) || arquivos.length === 0) {
      const msgErro = "IA não retornou arquivos válidos";
      console.error("❌", msgErro, JSON.stringify(respostaIA));
      await supabase
        .from("tarefas")
        .update({ status: "erro", resultado: { erro: msgErro, respostaIA } })
        .eq("id", tarefa.id);
      return new Response(JSON.stringify({ erro: msgErro }), { status: 500 });
    }

    // ── CHAMAR RUNNER ──────────────────────────────────────────────────────────
    const payload = {
      nomeProjeto: "lab-" + tarefa.id,
      arquivos: arquivos,
    };

    console.log("📤 payload enviado ao runner:", JSON.stringify(payload));

    const response = await fetch(`${runnerUrl}/executar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    console.log("📥 resposta runner:", text);

    if (!response.ok) {
      throw new Error(`Erro runner: ${text}`);
    }

    let resultado;
    try {
      resultado = JSON.parse(text);
    } catch {
      resultado = { raw: text };
    }

    await supabase
      .from("tarefas")
      .update({
        status: "concluida",
        resultado,
      })
      .eq("id", tarefa.id);

    console.log("✅ tarefa concluída:", tarefa.id);

    return new Response(JSON.stringify({ ok: true }));

  } catch (err) {
    console.error("🔥 erro geral:", err);

    if (tarefa?.id) {
      await supabase
        .from("tarefas")
        .update({
          status: "erro",
          resultado: { erro: String(err) },
        })
        .eq("id", tarefa.id);
    }

    return new Response(
      JSON.stringify({ erro: err.message }),
      { status: 500 }
    );
  }
});
