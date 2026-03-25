import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3333;

// 🔥 CONFIG (AJUSTADO COM SEU PROJECT)
const SUPABASE_URL = "https://vshanjsktdngwlzcfdlc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzaGFuanNrdGRuZ3dsemNmZGxjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NDE1OCwiZXhwIjoyMDg5NzMwMTU4fQ.nINfqUKx_7gK4_WFFCoEGQ4iz-Y3cLxrplpySh9nRPs";

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true });
});

// 🔹 EXECUTOR PRINCIPAL
app.post("/run", async (req, res) => {
  try {
    // 1. Buscar tarefa pendente
    const taskRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tarefas?status=eq.pendente&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const tarefas = await taskRes.json();

    if (!tarefas.length) {
      return res.json({ message: "Sem tarefas" });
    }

    const tarefa = tarefas[0];

    console.log("Executando tarefa:", tarefa.id);

    // 2. Simular execução (aqui entra IA depois)
    const resultado = {
      ok: true,
      executado_em: new Date().toISOString()
    };

    // 3. Atualizar tarefa para concluída
    await fetch(
      `${SUPABASE_URL}/rest/v1/tarefas?id=eq.${tarefa.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          status: "concluida",
          resultado
        })
      }
    );

    res.json({ ok: true, tarefa: tarefa.id });

  } catch (err) {
    console.error("Erro no runner:", err);

    res.status(500).json({
      ok: false,
      erro: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Runner rodando na porta ${PORT}`);
});