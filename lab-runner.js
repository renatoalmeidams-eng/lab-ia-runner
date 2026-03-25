require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// 🔐 Validação obrigatória
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: SUPABASE_URL e SUPABASE_KEY não configuradas");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Healthcheck ─────────────────────────────
app.get("/", (req, res) => {
  res.json({ ok: true });
});

// 🔁 RESET DE TAREFAS TRAVADAS
async function resetarTarefasTravadas() {
  console.log("♻️ Resetando tarefas travadas...");

  const { error } = await supabase.rpc("resetar_tarefas_travadas");

  if (error) {
    console.error("Erro ao resetar tarefas:", error.message);
  }
}

// 🔒 PEGAR TAREFA COM LOCK (CRÍTICO)
async function pegarTarefa() {
  const { data, error } = await supabase.rpc("pegar_tarefa");

  if (error) {
    console.error("Erro ao pegar tarefa:", error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}

// ▶ EXECUTAR TAREFA
async function executarTarefa(tarefa) {
  console.log(`🚀 Executando tarefa ${tarefa.id}`);

  try {
    const resultado = {
      sucesso: true,
      mensagem: "Tarefa executada com sucesso",
      payload: tarefa.payload || null
    };

    const { error } = await supabase
      .from("tarefas")
      .update({
        status: "concluida",
        resultado
      })
      .eq("id", tarefa.id);

    if (error) {
      console.error("Erro ao salvar resultado:", error.message);
    }

    console.log(`✅ Tarefa ${tarefa.id} concluída`);
  } catch (err) {
    console.error(`❌ Erro na tarefa ${tarefa.id}`, err.message);

    await supabase
      .from("tarefas")
      .update({
        status: "erro",
        resultado: { erro: err.message }
      })
      .eq("id", tarefa.id);
  }
}

// 🔁 ROTA PRINCIPAL
app.post("/run", async (req, res) => {
  console.log("🔄 Iniciando execução");

  try {
    await resetarTarefasTravadas();

    const tarefa = await pegarTarefa();

    if (!tarefa) {
      console.log("📭 Sem tarefas");
      return res.json({ message: "Sem tarefas" });
    }

    await executarTarefa(tarefa);

    return res.json({
      message: "Tarefa executada",
      tarefa_id: tarefa.id
    });
  } catch (err) {
    console.error("Erro geral:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 🔗 ROTA COMPATÍVEL COM EDGE FUNCTION
app.post("/executar", async (req, res) => {
  return app._router.handle(req, res);
});

// 🚀 START
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Runner rodando na porta ${PORT}`);
});