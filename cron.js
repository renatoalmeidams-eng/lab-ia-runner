// cron.js — dispara o runner manualmente ou via agendador externo
// Uso: node cron.js
// Ou configure no Railway como um Cron Job separado

const RUNNER_URL = process.env.RUNNER_URL || "http://localhost:3333";

async function executar() {
  try {
    const res = await fetch(`${RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();
    console.log(`[${new Date().toISOString()}] Cron:`, data);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Erro cron:`, err.message);
  }
}

// Executa a cada 15 segundos
setInterval(executar, 15000);

// Executa imediatamente na primeira vez
executar();
