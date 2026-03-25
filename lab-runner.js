require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// ⚠️ CRÍTICO: Railway precisa responder rápido
app.use(express.json());

// 🔥 FORÇA PORTA DO RAILWAY
const PORT = parseInt(process.env.PORT, 10) || 8080;

// 🔐 ENV
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: ENV não configurada");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔥 HEALTHCHECK DIRETO (SEM PROMISE, SEM ASYNC)
app.get("/", (req, res) => {
  res.set("Content-Type", "application/json");
  res.status(200).send(JSON.stringify({ ok: true }));
});

// 🔁 RESET
async function resetarTarefasTravadas() {
  try {
    await supabase.rpc("resetar_tarefas_travadas");
  } catch (e) {
    console.error("reset erro:", e.message);
  }
}

// 🔒 LOCK
async function pegarTarefa() {
  try {
    const { data } = await supabase.rpc("pegar_tarefa");
    return data && data.length ? data[0] : null;
  } catch (e) {
    console.error("pegar erro:", e.message);
    return null;
  }
}

// ▶ EXECUÇÃO
async function executarTarefa(tarefa) {
  try {
    await supabase
      .from("tarefas")
      .update({
        status: "concluida",
        resultado: {
          sucesso: true,
          payload: tarefa.payload || null
        }
      })
      .eq("id", tarefa.id);
  } catch (e) {
    console.error("exec erro:", e.message);
  }
}

// 🔁 RUN (resposta imediata)
app.post("/run", (req, res) => {
  res.status(200).json({ ok: true });

  (async () => {
    await resetarTarefasTravadas();
    const tarefa = await pegarTarefa();
    if (!tarefa) return;
    await executarTarefa(tarefa);
  })();
});

// 🔗 EXECUTAR (sem loop interno)
app.post("/executar", (req, res) => {
  res.status(200).json({ ok: true });
});

// 🔥 START ROBUSTO
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Runner rodando na porta ${PORT}`);
});

// 🚨 LOG DE ERROS (evita crash silencioso)
server.on("error", (err) => {
  console.error("❌ Server error:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Rejection:", err);
});