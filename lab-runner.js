require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: SUPABASE_URL e SUPABASE_KEY não configuradas");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔥 HEALTHCHECK ULTRA RÁPIDO
app.get("/", (req, res) => {
  return res.status(200).send("OK");
});

// 🔁 RESET
async function resetarTarefasTravadas() {
  await supabase.rpc("resetar_tarefas_travadas");
}

// 🔒 LOCK
async function pegarTarefa() {
  const { data } = await supabase.rpc("pegar_tarefa");
  return data && data.length ? data[0] : null;
}

// ▶ EXECUÇÃO
async function executarTarefa(tarefa) {
  const resultado = {
    sucesso: true,
    payload: tarefa.payload || null
  };

  await supabase
    .from("tarefas")
    .update({
      status: "concluida",
      resultado
    })
    .eq("id", tarefa.id);
}

// 🔁 RUN
app.post("/run", async (req, res) => {
  res.json({ status: "processando" }); // responde IMEDIATO

  try {
    await resetarTarefasTravadas();
    const tarefa = await pegarTarefa();

    if (!tarefa) return;

    await executarTarefa(tarefa);
  } catch (err) {
    console.error("Erro:", err.message);
  }
});

// 🔗 EXECUTAR
app.post("/executar", async (req, res) => {
  return res.status(200).json({ ok: true });
});

// START
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Runner rodando na porta ${PORT}`);
});