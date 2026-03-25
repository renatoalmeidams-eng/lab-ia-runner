import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-haiku-20240307";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractJSON(raw: string) {
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/([\[\{][\s\S]*[\]\}])/);
  if (match) {
    try { return JSON.parse(match[1]); } catch {}
  }
  throw new Error("JSON inválido");
}

// 🔥 DETECTOR DE LIXO DO CLAUDE
function codigoInvalido(code: string) {
  if (!code) return true;

  const lixo = [
    "exemplo de implementação",
    "example implementation",
    "pseudo",
    "lorem",
  ];

  const lower = code.toLowerCase();

  return lixo.some(l => lower.includes(l));
}

// 🔥 GERADOR AUTOMÁTICO DE SQL
function gerarSQLFallback(titulo: string) {
  return `
CREATE TABLE IF NOT EXISTS ${titulo
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .substring(0, 30)} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em TIMESTAMP DEFAULT NOW()
);
`;
}

function validarRiscos(output: any) {
  const riscos = output?.riscos;

  if (!Array.isArray(riscos) || riscos.length === 0) {
    return "riscos vazio";
  }

  return null;
}

async function criarTarefas(supabase: any, no: any, output: any) {
  const riscos = output?.riscos || [];

  const tarefas = riscos.map((r: any, i: number) => {
    let tipo = r.implementacao?.tipo || "backend";
    let codigo = r.implementacao?.codigo_exemplo || "";

    // 🔥 CORREÇÃO AUTOMÁTICA
    if (codigoInvalido(codigo)) {
      tipo = "sql";
      codigo = gerarSQLFallback(r.descricao || `tarefa_${i}`);
    }

    return {
      execucao_id: no.execucao_id,
      no_origem_id: no.id,
      titulo: (r.descricao || `Risco ${i}`).substring(0, 200),
      descricao: `${r.impacto || ""} | ${r.solucao || ""}`,
      tipo,
      codigo,
      status: "pendente",
    };
  });

  await supabase.from("tarefas").insert(tarefas);
}

function buildPrompt(tipo: string, input: any) {
  if (tipo === "pesquisador") {
    return `
RETORNE JSON:
{
 "resumo": "",
 "viabilidade": ""
}
Ideia: ${input.ideia}`;
  }

  if (tipo === "arquiteto") {
    return `
RETORNE JSON.

OBRIGATÓRIO:
- gerar código REAL
- evitar exemplos
- evitar texto genérico

{
 "riscos": [
   {
     "descricao": "",
     "impacto": "",
     "solucao": "",
     "implementacao": {
       "tipo": "",
       "codigo_exemplo": ""
     }
   }
 ]
}

Input:
${JSON.stringify(input)}
`;
  }

  return "JSON";
}

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  const { data: no } = await supabase
    .from("nos_execucao")
    .select("*")
    .eq("status", "pendente")
    .limit(1)
    .maybeSingle();

  if (!no) return json({ msg: "sem tarefas" });

  await supabase
    .from("nos_execucao")
    .update({ status: "executando" })
    .eq("id", no.id);

  const prompt = buildPrompt(no.tipo_agente, no.input);

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const raw = data?.content?.[0]?.text || "";

  let parsed;

  try {
    parsed = extractJSON(raw);
  } catch {
    return json({ error: "json invalido" });
  }

  if (no.tipo_agente === "pesquisador") {
    await supabase.from("nos_execucao").insert({
      execucao_id: no.execucao_id,
      tipo_agente: "arquiteto",
      status: "pendente",
      input: parsed,
    });

    return json({ etapa: "pesquisador → arquiteto" });
  }

  if (no.tipo_agente === "arquiteto") {
    await criarTarefas(supabase, no, parsed);

    return json({ status: "tarefas criadas com fallback inteligente" });
  }

  return json({ ok: true });
});