import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { tarefa_id } = await req.json();

    if (!tarefa_id) {
      return new Response(
        JSON.stringify({ error: "tarefa_id obrigatorio" }),
        { status: 400 }
      );
    }

    console.log("tarefa recebida", { tarefa_id });

    // =========================
    // 1. BUSCAR TAREFA
    // =========================
    const { data: tarefa, error: erroTarefa } = await supabase
      .from("tarefas")
      .select("*")
      .eq("id", tarefa_id)
      .single();

    if (erroTarefa || !tarefa) {
      return new Response(
        JSON.stringify({ error: "tarefa nao encontrada" }),
        { status: 404 }
      );
    }

    // =========================
    // 2. CHAMAR EXECUTOR (IA)
    // =========================
    const { data: respostaIA, error: erroIA } =
      await supabase.functions.invoke("executar-agente", {
        body: {
          agente: "executor",
          input: tarefa,
        },
      });

    if (erroIA || !respostaIA) {
      return new Response(
        JSON.stringify({ error: "erro ao executar IA", detalhe: erroIA }),
        { status: 500 }
      );
    }

    console.log("IA executada", { tarefa_id });

    // =========================
    // 3. EXTRAIR ARQUIVOS
    // =========================
    const arquivos =
      respostaIA?.output?.arquivos ||
      respostaIA?.arquivos ||
      [];

    if (!arquivos || !arquivos.length) {
      return new Response(
        JSON.stringify({
          error: "IA nao retornou arquivos",
          respostaIA,
        }),
        { status: 500 }
      );
    }

    // =========================
    // 4. CHAMAR RUNNER (ASSÍNCRONO)
    // =========================
    const runnerUrl = Deno.env.get("RUNNER_URL");

    if (!runnerUrl) {
      return new Response(
        JSON.stringify({ error: "RUNNER_URL nao configurada" }),
        { status: 500 }
      );
    }

    const controller = new AbortController();
    const timeoutMs = 3000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      nomeProjeto: "lab-" + tarefa_id,
      arquivos,
    };

    console.log("envio para runner", { tarefa_id });

    let delegou = false;

    try {
      const response = await fetch(`${runnerUrl}/executar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Runner ideal responde 202
      if (response.ok) {
        delegou = true;
        console.log("execução delegada (runner respondeu)", {
          tarefa_id,
          status: response.status,
        });
      } else {
        console.error("runner respondeu erro", {
          tarefa_id,
          status: response.status,
        });
      }

    } catch (err) {
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";

      if (isTimeout) {
        delegou = true;
        console.log("execução delegada (timeout)", {
          tarefa_id,
          timeoutMs,
        });
      } else {
        console.error("falha ao chamar runner", {
          tarefa_id,
          erro: String(err),
        });

        return new Response(
          JSON.stringify({
            error: "falha ao chamar runner",
            detalhe: String(err),
          }),
          { status: 502 }
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // =========================
    // 5. ATUALIZAR STATUS (CORRETO)
    // =========================
    await supabase
      .from("tarefas")
      .update({
        status: "executando",
        resultado: {
          arquivos_gerados: arquivos.length,
          runner: delegou ? "delegado_async" : "nao_confirmado",
        },
      })
      .eq("id", tarefa_id);

    // =========================
    // 6. RESPOSTA RÁPIDA
    // =========================
    return new Response(
      JSON.stringify({
        ok: true,
        tarefa_id,
        status: "executando",
        runner: "delegado_async",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error("ERRO GERAL:", err);

    return new Response(
      JSON.stringify({
        error: "erro interno",
        detalhe: String(err),
      }),
      { status: 500 }
    );
  }
});