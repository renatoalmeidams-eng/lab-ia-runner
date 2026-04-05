require("dotenv").config();
const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT         = parseInt(process.env.PORT, 10) || 3333;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BASE_PATH    = process.env.BASE_PATH || "C:/lab-ia-projects";
const MAX_RETRY    = 3;
const CRON_MS      = parseInt(process.env.CRON_INTERVALO_MS || "15000");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ FATAL: SUPABASE_URL e SUPABASE_KEY são obrigatórios");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PROTECTED_FILES = [
  ".env", ".env.local", ".env.production", ".env.development",
  "node_modules", ".git", ".gitignore",
];

function isProtected(caminho) {
  const normalized = caminho.replace(/\\/g, "/");
  return PROTECTED_FILES.some((p) =>
    normalized === p ||
    normalized.startsWith(p + "/") ||
    path.basename(normalized) === p
  );
}

app.get("/", (req, res) => {
  res.status(200).json({ ok: true, status: "running", uptime: process.uptime() });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    status: "healthy",
    uptime: process.uptime(),
    last_cron: global.lastCronRun || null,
    base_path: BASE_PATH,
  });
});

function criarProjeto(nome) {
  const projetoPath = path.join(BASE_PATH, nome);

  if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH, { recursive: true });
  }

  if (!fs.existsSync(projetoPath)) {
    console.log(`[runner] Criando projeto React: ${nome}`);

    fs.mkdirSync(projetoPath, { recursive: true });
    fs.mkdirSync(path.join(projetoPath, "src"), { recursive: true });
    fs.mkdirSync(path.join(projetoPath, "public"), { recursive: true });

    fs.writeFileSync(path.join(projetoPath, "package.json"), JSON.stringify({
      name: nome, version: "1.0.0", type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: { "react": "^18.2.0", "react-dom": "^18.2.0" },
      devDependencies: { "@vitejs/plugin-react": "^4.2.1", "vite": "^5.0.8" },
    }, null, 2));

    fs.writeFileSync(path.join(projetoPath, "vite.config.js"),
`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })`
    );

    fs.writeFileSync(path.join(projetoPath, "index.html"),
`<!DOCTYPE html>
<html lang="pt-BR">
  <head><meta charset="UTF-8" /><title>Lab IA</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`
    );

    fs.writeFileSync(path.join(projetoPath, "src", "main.jsx"),
`import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
ReactDOM.createRoot(document.getElementById('root')).render(<App />)`
    );

    fs.writeFileSync(path.join(projetoPath, "src", "App.jsx"),
`export default function App() { return <h1>Lab IA</h1>; }`
    );

    execSync("npm install", { stdio: "inherit", cwd: projetoPath });
    console.log(`[runner] Projeto criado: ${projetoPath}`);
  }

  return projetoPath;
}

function aplicarArquivos(projetoPath, arquivos) {
  const aplicados  = [];
  const bloqueados = [];

  for (const arquivo of arquivos) {
    const caminho  = arquivo.caminho || arquivo.path;
    const conteudo = arquivo.codigo  || arquivo.content || "";

    if (!caminho) { console.warn("[runner] Arquivo sem caminho — ignorado"); continue; }
    if (isProtected(caminho)) {
      console.warn(`[runner] 🔒 Bloqueado: ${caminho}`);
      bloqueados.push(caminho);
      continue;
    }

    const fullPath = path.join(projetoPath, caminho);
    const dir      = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(fullPath, conteudo, "utf-8");
    console.log(`[runner] ✅ Aplicado: ${caminho}`);
    aplicados.push(caminho);
  }

  return { aplicados, bloqueados };
}

function verificarProjeto(projetoPath) {
  try { return fs.existsSync(path.join(projetoPath, "package.json")); }
  catch { return false; }
}

function executarBuild(projetoPath) {
  console.log(`[runner] Instalando dependências antes do build...`);
  try {
    execSync("npm install", { cwd: projetoPath, stdio: "pipe", timeout: 120000 });
  } catch (e) {
    console.warn("[runner] npm install com avisos:", e.message?.slice(0, 200));
  }

  console.log(`[runner] Executando build em: ${projetoPath}`);
  try {
    execSync("npm run build", { cwd: projetoPath, stdio: "pipe", timeout: 60000 });
    console.log("[runner] ✅ Build concluído com sucesso");
    return { ok: true, erro: null };
  } catch (err) {
    const mensagem = err.stderr?.toString() || err.stdout?.toString() || err.message;
    console.error("[runner] ❌ Build falhou:", mensagem.slice(0, 500));
    return { ok: false, erro: mensagem.slice(0, 1000) };
  }
}

async function notificarChatConclusao(projeto_id, tarefa, resumo) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-projeto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ projeto_id, mensagem: `[Sistema] ${resumo} O que devo implementar agora?` }),
    });
    const data = await res.json();
    if (data.ok) console.log(`[orchestrator] 💬 Chat notificado: ${data.resposta?.substring(0, 80)}...`);
    else console.warn(`[orchestrator] Chat notificação falhou:`, data.erro);
  } catch (err) {
    console.warn(`[orchestrator] Erro ao notificar chat:`, err.message);
  }
}

async function inserirLog(tarefa_id, status, erro, tentativas) {
  try {
    await supabase.from("logs_execucao").insert({ tarefa_id, status, erro: erro || null, tentativas: tentativas || 0 });
  } catch (e) {
    console.error("[runner] Falha ao inserir log:", e.message);
  }
}

async function inserirEvento(projeto_id, tarefa_id, tipo, payload) {
  try {
    await supabase.from("eventos").insert({ projeto_id, tarefa_id, tipo, payload: payload || {}, processado: false });
  } catch (e) {
    console.error("[runner] Falha ao inserir evento:", e.message);
  }
}

async function gerarCodigoComIA(tarefa, projeto) {
  try {
    console.log(`[orchestrator] Chamando executor — tarefa=${tarefa.id}`);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/executar-agente`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        agente:     "executor",
        projeto_id: tarefa.projeto_id,
        tarefa_id:  tarefa.id,
        input: {
          titulo:             tarefa.payload?.titulo      || tarefa.tipo_tarefa,
          descricao:          tarefa.payload?.descricao   || "",
          stack:              tarefa.payload?.stack       || projeto?.stack_detectada || "React, Node.js",
          dependencias:       tarefa.payload?.dependencias || [],
          banco:              projeto?.banco_externo      || null,
          arquivos_esperados: tarefa.payload?.arquivos_esperados || [],
          complexidade:       tarefa.payload?.complexidade || "media",
        },
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      console.error(`[orchestrator] Executor falhou:`, JSON.stringify(data).slice(0, 200));
      return [];
    }

    const output   = data.output || {};
    const arquivos = Array.isArray(output.arquivos) ? output.arquivos : [];

    if (!arquivos.length) {
      console.warn(`[orchestrator] Executor não retornou arquivos válidos`);
      console.warn(`[orchestrator] Output keys:`, Object.keys(output).join(", "));
    }

    return arquivos;
  } catch (err) {
    console.error(`[orchestrator] Erro ao chamar executor:`, err.message);
    return [];
  }
}

app.post("/executar", async (req, res) => {
  const { nomeProjeto, arquivos = [], executarBuildFlag = false } = req.body;

  if (!nomeProjeto) return res.status(400).json({ ok: false, erro: "nomeProjeto obrigatório" });

  try {
    const projetoPath = criarProjeto(nomeProjeto);
    const rodando     = verificarProjeto(projetoPath);
    const { aplicados, bloqueados } = aplicarArquivos(projetoPath, arquivos);

    let buildResult = { ok: true, erro: null };
    if (executarBuildFlag && aplicados.length > 0) {
      buildResult = executarBuild(projetoPath);
    }

    console.log(`[runner] /executar — aplicado=${aplicados.length} bloqueados=${bloqueados.length} build=${buildResult.ok}`);

    return res.status(200).json({
      ok:                  buildResult.ok,
      aplicado:            aplicados.length > 0,
      rodando,
      build:               buildResult.ok ? "ok" : "falhou",
      build_erro:          buildResult.erro,
      erro:                buildResult.ok ? null : buildResult.erro,
      arquivos_escritos:   aplicados,
      arquivos_bloqueados: bloqueados,
    });
  } catch (err) {
    console.error("[runner] /executar ERRO:", err.message);
    return res.status(500).json({ ok: false, aplicado: false, rodando: false, erro: err.message });
  }
});

// ── ORCHESTRATOR LOOP (interno — substitui cron.js externo) ──────────────────
async function executarCiclo() {
  global.lastCronRun = new Date().toISOString();
  try {
    const { error: errReset } = await supabase.rpc("resetar_tarefas_travadas");
    if (errReset) console.error("[orchestrator] Falha ao resetar travadas:", errReset.message);

    const { data: tarefas, error: errPegar } = await supabase.rpc("pegar_tarefa");
    if (errPegar) { console.error("[orchestrator] Falha ao pegar tarefa:", errPegar.message); return; }

    if (!tarefas || tarefas.length === 0) { console.log("[orchestrator] Nenhuma tarefa pendente"); return; }

    const tarefa = tarefas[0];
    console.log(`[orchestrator] Tarefa: ${tarefa.id} | tipo=${tarefa.tipo_tarefa} | tentativas=${tarefa.tentativas || 0}`);

    const { data: projeto } = await supabase
      .from("projetos")
      .select("id, origem, status_etapa, stack_detectada, dependencias_externas, banco_externo")
      .eq("id", tarefa.projeto_id)
      .single();

    if (!projeto) {
      await supabase.from("tarefas").update({ status: "erro", resultado: { erro: "projeto_nao_encontrado" } }).eq("id", tarefa.id);
      return;
    }

    if (tarefa.dependencias && tarefa.dependencias.length > 0) {
      const { data: deps } = await supabase.from("tarefas").select("id, status").in("id", tarefa.dependencias);
      const pendentes = (deps || []).filter((d) => d.status !== "concluida");
      if (pendentes.length > 0) {
        await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
        return;
      }
    }

    const TIPOS_BANCO = ["alterar_banco", "dropar_banco", "migrar_banco"];
    if (projeto.origem === "importado" && TIPOS_BANCO.includes(tarefa.tipo_tarefa)) {
      await supabase.from("tarefas").update({ status: "pendente", requer_aprovacao: true, em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
      await inserirEvento(projeto.id, tarefa.id, "aprovacao_necessaria", { motivo: "alteracao_banco_projeto_importado" });
      return;
    }

    let arquivos = tarefa.payload?.arquivos || tarefa.resultado?.arquivos || [];

    if (!arquivos.length && tarefa.tipo_tarefa === "planejamento") {
      await supabase.from("tarefas").update({ status: "concluida", resultado: { aviso: "planejamento_concluido" } }).eq("id", tarefa.id);
      await inserirLog(tarefa.id, "sucesso", null, tarefa.tentativas || 0);
      await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { tipo: "planejamento" });
      await notificarChatConclusao(projeto.id, tarefa, "Planejamento concluído.");
      return;
    }

    if (!arquivos.length) {
      arquivos = await gerarCodigoComIA(tarefa, projeto);
      if (!arquivos || !arquivos.length) {
        const tentativas = (tarefa.tentativas || 0) + 1;
        const erro = "Executor não gerou arquivos válidos";
        await inserirLog(tarefa.id, "erro", erro, tentativas);
        if (tentativas >= MAX_RETRY) {
          await supabase.from("tarefas").update({ status: "bloqueado", resultado: { erro } }).eq("id", tarefa.id);
          await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro });
        } else {
          await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
        }
        return;
      }
    }

    const nomeProjeto = `lab-${tarefa.projeto_id}`;
    console.log(`[orchestrator] Aplicando ${arquivos.length} arquivos — projeto=${nomeProjeto}`);

    let resultadoRunner;
    try {
      const selfUrl = `http://localhost:${PORT}`;
      const runnerRes = await fetch(`${selfUrl}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeProjeto, arquivos, executarBuildFlag: true }),
      });
      resultadoRunner = await runnerRes.json();
    } catch (errFetch) {
      resultadoRunner = { ok: false, aplicado: false, rodando: false, erro: errFetch.message };
    }

    console.log(`[orchestrator] Runner: ok=${resultadoRunner.ok} build=${resultadoRunner.build}`);

    if (resultadoRunner.ok && resultadoRunner.aplicado) {
      await supabase.from("tarefas").update({
        status: "concluida",
        resultado: {
          arquivos_gerados:    arquivos.length,
          arquivos_escritos:   resultadoRunner.arquivos_escritos   || [],
          arquivos_bloqueados: resultadoRunner.arquivos_bloqueados || [],
          build:               resultadoRunner.build,
          rodando:             resultadoRunner.rodando,
        },
      }).eq("id", tarefa.id);

      await inserirLog(tarefa.id, "sucesso", null, tarefa.tentativas || 0);
      await inserirEvento(projeto.id, tarefa.id, "codigo_aplicado", {
        arquivos_escritos: resultadoRunner.arquivos_escritos || [],
        nomeProjeto,
      });

      if (resultadoRunner.build === "ok") {
        await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { nomeProjeto, build: "ok" });
        await notificarChatConclusao(projeto.id, tarefa, `Tarefa concluída: ${tarefa.payload?.titulo || tarefa.tipo_tarefa}. Build ok.`);
      }
      if (resultadoRunner.build === "falhou") {
        await inserirEvento(projeto.id, tarefa.id, "build_falhou", { nomeProjeto, erro: resultadoRunner.build_erro });
      }

      console.log(`[orchestrator] ✅ Tarefa ${tarefa.id} concluída — build=${resultadoRunner.build}`);

    } else {
      const tentativas = (tarefa.tentativas || 0) + 1;
      const erro       = resultadoRunner.erro || "Erro desconhecido no runner";
      await inserirLog(tarefa.id, "erro", erro, tentativas);
      if (tentativas >= MAX_RETRY) {
        await supabase.from("tarefas").update({ status: "bloqueado", resultado: { erro } }).eq("id", tarefa.id);
        await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro });
      } else {
        await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
      }
    }

  } catch (err) {
    console.error("[orchestrator] ERRO INESPERADO:", err.message);
  }
}

// ── START SERVER ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Lab Runner rodando na porta ${PORT}`);
  console.log(`📦 Projetos em: ${BASE_PATH}`);
  console.log(`⏱️  Cron interno iniciando em 5s — intervalo: ${CRON_MS}ms`);

  // Inicia o loop interno após 5s (aguarda o servidor estar pronto)
  setTimeout(() => {
    console.log("[cron] ✅ Loop interno iniciado");
    executarCiclo(); // primeiro ciclo imediato
    setInterval(executarCiclo, CRON_MS);
  }, 5000);
});

server.on("error",               (err) => console.error("❌ Server error:", err));
process.on("uncaughtException",  (err) => console.error("❌ Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("❌ Rejection:", err));
