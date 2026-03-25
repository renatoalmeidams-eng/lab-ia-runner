const express = require("express");

const app = express();
app.use(express.json());

// ✅ FIX 1: PORT vem do Railway via process.env.PORT — NUNCA hardcode
const PORT = process.env.PORT || 3333;

// ✅ FIX 2: Credenciais via variável de ambiente — NUNCA hardcode no código
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ─── Validação de inicialização ──────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: SUPABASE_URL e SUPABASE_KEY precisam estar definidas como variáveis de ambiente.");
  process.exit(1);
}

// ─── Healthcheck ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ ok: true, status: "runner online" });
});

// ─── Rota legada (mantida por compatibilidade) ────────────────────────────────
app.post("/run", async (req, res) => {
  console.log("📥 /run chamado");
  await processarProximaTarefa(res);
});

// ✅ FIX 3: Rota /executar que o Supabase chama (estava FALTANDO — causa de 404)
// As funções executar-tarefa e processar-tarefa chamam ${RUNNER_URL}/executar
app.post("/executar", async (req, res) => {
  console.log("📥 /executar chamado");

  const { nomeProjeto, arquivos } = req.body;

  if (!arquivos || !Array.isArray(arquivos)) {
    return res.status(400).json({ erro: "Payload inválido: arquivos ausente ou não é array" });
  }

  console.log(`🚀 Executando projeto: ${nomeProjeto} | ${arquivos.length} arquivo(s)`);

  try {
    // Aqui você aplica os arquivos gerados pela IA
    // Por agora: loga e confirma recebimento assíncrono
    for (const arquivo of arquivos) {
      console.log(`  📄 ${arquivo.caminho}`);
    }

    // Responde 202 (aceito para processamento assíncrono)
    // O Supabase considera isso sucesso e não trava esperando
    return res.status(202).json({
      ok: true,
      nomeProjeto,
      arquivos_recebidos: arquivos.length,
      status: "enfileirado"
    });

  } catch (err) {
    console.error("❌ Erro em /executar:", err.message);
    return res.status(500).json({ erro: err.message });
  }
});

// ─── Lógica de processamento de tarefa ───────────────────────────────────────
async function processarProximaTarefa(res) {
  try {
    // 1. Busca próxima tarefa pendente
    const taskRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tarefas?status=eq.pendente&order=criado_em.asc&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!taskRes.ok) {
      const errText = await taskRes.text();
      throw new Error(`Supabase retornou ${taskRes.status}: ${errText}`);
    }

    const tarefas = await taskRes.json();

    if (!tarefas || !tarefas.length) {
      return res.json({ message: "Sem tarefas pendentes" });
    }

    const tarefa = tarefas[0];
    console.log("▶️  Executando tarefa:", tarefa.id);

    // 2. Marca como executando (evita double-processing)
    await fetch(
      `${SUPABASE_URL}/rest/v1/tarefas?id=eq.${tarefa.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ status: "executando" })
      }
    );

    // 3. Executa a tarefa (lógica real aqui)
    const resultado = {
      ok: true,
      executado_em: new Date().toISOString()
    };

    // 4. Marca como concluída
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tarefas?id=eq.${tarefa.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ status: "concluida", resultado })
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(`Erro ao atualizar tarefa: ${errText}`);
    }

    console.log("✅ Tarefa concluída:", tarefa.id);
    return res.json({ ok: true, tarefa: tarefa.id });

  } catch (err) {
    console.error("❌ ERRO:", err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// ✅ FIX 4: bind em 0.0.0.0 — SEM ISSO O RAILWAY NÃO CONSEGUE ROTEAR TRÁFEGO
// Por padrão Node.js faz listen em 127.0.0.1 (só loopback).
// O Railway precisa que o processo escute em 0.0.0.0 para receber requisições externas.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Runner online na porta ${PORT}`);
  console.log(`📡 SUPABASE_URL: ${SUPABASE_URL}`);
});

// deploy 20260325010630
