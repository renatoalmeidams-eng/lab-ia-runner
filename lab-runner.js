const express = require("express");
const app = express();

const PORT = process.env.PORT || 3333;

app.use(express.json());

// Health check (necessário pro Railway)
app.get("/", (req, res) => {
  res.json({ ok: true });
});

// Endpoint principal (runner)
app.post("/", async (req, res) => {
  try {
    const { objetivo } = req.body || {};

    console.log("Recebido:", objetivo);

    // Aqui depois entra execução real (IA / código / projetos)
    res.json({
      ok: true,
      recebido: objetivo || null
    });

  } catch (error) {
    console.error("Erro no runner:", error);

    res.status(500).json({
      ok: false,
      erro: error.message
    });
  }
});

// Start do servidor (OBRIGATÓRIO pro Railway)
app.listen(PORT, () => {
  console.log(`Runner rodando na porta ${PORT}`);
});