import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function limparJSON(texto: string): string {
  return texto
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/[\u0000-\u001F]+/g, "")
    .trim();
}

function extrairJSON(texto: string) {
  try {
    return JSON.parse(texto);
  } catch {
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("JSON inválido");
  }
}

serve(async (req) => {
  try {
    const { agente, input } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: promptData } = await supabase
      .from("prompts_sistema")
      .select("*")
      .eq("nome", agente)
      .single();

    if (!promptData) {
      return new Response(JSON.stringify({ error: "prompt não encontrado" }), { status: 404 });
    }

    const promptFinal = promptData.conteudo.replace(
      "{{INPUT}}",
      JSON.stringify(input)
    );

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "user", content: promptFinal }]
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Erro OpenAI", detalhe: raw }), { status: 500 });
    }

    const data = JSON.parse(raw);
    const respostaTexto = data.choices?.[0]?.message?.content;

    if (!respostaTexto) {
      return new Response(JSON.stringify({ error: "resposta vazia" }), { status: 500 });
    }

    const textoLimpo = limparJSON(respostaTexto);
    let json;

    try {
      json = extrairJSON(textoLimpo);
    } catch {
      return new Response(JSON.stringify({
        error: "IA não retornou JSON válido",
        conteudo: textoLimpo
      }), { status: 500 });
    }

    // =============================
    // 🔥 SALVAR TAREFAS AUTOMATICAMENTE
    // =============================
    if (agente === "planejador" && json.tarefas) {

      const tarefasFormatadas = json.tarefas.map((t: any) => ({
        id: t.id,
        projeto_id: input.projeto_id || null,
        ordem: t.ordem,
        fase: t.fase,
        titulo: t.titulo,
        descricao: t.descricao,
        dependencias: t.dependencias || [],
        pode_paralelizar_com: t.pode_paralelizar_com || [],
        complexidade: t.complexidade,
        payload: t
      }));

      await supabase.from("tarefas").insert(tarefasFormatadas);
    }

    return new Response(JSON.stringify({
      ok: true,
      agente,
      output: json
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message
    }), { status: 500 });
  }
});