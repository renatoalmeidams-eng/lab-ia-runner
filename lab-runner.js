require("dotenv").config();
const express      = require("express");
const fs           = require("fs");
const path         = require("path");
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

// ── ROTAS BÁSICAS ─────────────────────────────────────────────────────────────

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

// ── ROTA PREVIEW ──────────────────────────────────────────────────────────────

app.use("/preview/:projeto_id", (req, res, next) => {
  const distPath = path.join(BASE_PATH, `lab-${req.params.projeto_id}`, "dist");
  if (!fs.existsSync(distPath)) {
    return res.status(404).json({
      ok: false,
      erro: "Preview não disponível — build não encontrado para este projeto.",
    });
  }
  // Serve index.html para qualquer rota (SPA fallback)
  req.url = req.url === "/" || req.url === "" ? "/index.html" : req.url;
  express.static(distPath)(req, res, () => {
    res.sendFile(path.join(distPath, "index.html"));
  });
});

// ── HELPERS DO RUNNER ─────────────────────────────────────────────────────────

function criarProjeto(nome) {
  const projetoPath = path.join(BASE_PATH, nome);

  if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH, { recursive: true });
  }

  if (!fs.existsSync(projetoPath)) {
    console.log(`[runner] Criando projeto: ${nome}`);

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
  console.log(`[runner] npm install...`);
  try {
    execSync("npm install", { cwd: projetoPath, stdio: "pipe", timeout: 120000 });
  } catch (e) {
    console.warn("[runner] npm install avisos:", e.message?.slice(0, 200));
  }

  console.log(`[runner] npm run build...`);
  try {
    execSync("npm run build", { cwd: projetoPath, stdio: "pipe", timeout: 60000 });
    console.log("[runner] ✅ Build ok");
    return { ok: true, erro: null };
  } catch (err) {
    const mensagem = err.stderr?.toString() || err.stdout?.toString() || err.message;
    console.error("[runner] ❌ Build falhou:", mensagem.slice(0, 500));
    return { ok: false, erro: mensagem.slice(0, 1000) };
  }
}

// ── HELPERS DO ORCHESTRATOR ───────────────────────────────────────────────────

async function inserirLog(tarefa_id, status, resultado, tentativas) {
  try {
    await supabase.from("logs_execucao").insert({
      tarefa_id, status, resultado: resultado || null, tentativas: tentativas || 0,
    });
  } catch (e) {
    console.error("[runner] Falha ao inserir log:", e.message);
  }
}

async function inserirEvento(projeto_id, tarefa_id, tipo, payload) {
  try {
    await supabase.from("eventos").insert({
      projeto_id, tarefa_id, tipo, payload: payload || {}, processado: false,
    });
  } catch (e) {
    console.error("[runner] Falha ao inserir evento:", e.message);
  }
}

async function notificarChat(projeto_id, mensagem) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-projeto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ projeto_id, mensagem }),
    });
    const data = await res.json();
    if (!data.ok) console.warn(`[orchestrator] Chat notificação falhou:`, data.erro);
  } catch (err) {
    console.warn(`[orchestrator] Erro ao notificar chat:`, err.message);
  }
}

async function notificarChatInicio(projeto_id, tarefa) {
  const titulo = tarefa.payload?.titulo || tarefa.tipo_tarefa;
  await notificarChat(projeto_id,
    `[Sistema] Iniciando tarefa: ${titulo} (tipo: ${tarefa.tipo_tarefa}).`
  );
}

async function notificarChatConclusao(projeto_id, tarefa, resumo) {
  await notificarChat(projeto_id, `[Sistema] ${resumo}`);
}

async function gerarCodigoComIA(tarefa, projeto) {
  try {
    console.log(`[orchestrator] Chamando executor IA — tarefa=${tarefa.id}`);

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
          stack:              tarefa.payload?.stack       || projeto?.stack_detectada || "React + Vite (frontend)",
          dependencias:       tarefa.payload?.dependencias || [],
          banco:              projeto?.banco_externo      || null,
          arquivos_esperados: tarefa.payload?.arquivos_esperados || [],
          complexidade:       tarefa.payload?.complexidade || "media",
        },
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      console.error(`[orchestrator] Executor falhou HTTP ${res.status}:`, JSON.stringify(data).slice(0, 300));
      return [];
    }

    const output   = data.output || {};
    const arquivos = Array.isArray(output.arquivos) ? output.arquivos : [];

    console.log(`[orchestrator] Executor retornou ${arquivos.length} arquivo(s)`);
    if (!arquivos.length) {
      console.warn(`[orchestrator] Output completo:`, JSON.stringify(output).slice(0, 500));
    }

    return arquivos;
  } catch (err) {
    console.error(`[orchestrator] Erro ao chamar executor:`, err.message);
    return [];
  }
}

async function processarResultadoAuditoria(projeto, tarefa) {
  try {
    console.log(`[orchestrator] 🔍 Executando auditoria IA — tarefa=${tarefa.id}`);

    const tarefasIds = tarefa.payload?.tarefas_auditadas || [];
    const { data: tarefasAuditadas } = await supabase
      .from('tarefas')
      .select('id, tipo_tarefa, payload, resultado')
      .in('id', tarefasIds.length > 0 ? tarefasIds : ['00000000-0000-0000-0000-000000000000']);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/executar-agente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        agente: 'auditor',
        projeto_id: projeto.id,
        tarefa_id: tarefa.id,
        input: {
          tarefas: (tarefasAuditadas || []).map(t => ({
            id: t.id,
            tipo: t.tipo_tarefa,
            titulo: t.payload?.titulo,
            arquivos: t.resultado?.arquivos_escritos || [],
          })),
          stack: projeto.stack_detectada || 'React + Vite (frontend)',
          banco: projeto.banco_externo || null,
        },
      }),
    });

    const data = await res.json();
    const output = data.output || {};
    const riscos = output.riscos || [];

    await supabase.from('tarefas').update({
      status: 'concluida',
      resultado: { riscos, resumo: output.resumo_auditoria || 'Auditoria concluída' },
    }).eq('id', tarefa.id);

    await inserirLog(tarefa.id, 'sucesso', null, tarefa.tentativas || 1);

    const riscosCriticos = riscos.filter(r => r.bloqueia_execucao || r.score >= 6);
    const riscosAltos    = riscos.filter(r => !riscosCriticos.includes(r) && (r.classificacao === 'alto' || r.impacto === 'alto'));
    const todosGraves    = [...riscosCriticos, ...riscosAltos];

    if (todosGraves.length > 0) {
      console.log(`[orchestrator] ⚠️ ${riscosCriticos.length} riscos críticos — criando tarefas de correção`);

      for (const risco of todosGraves) {
        if (!risco.mitigacao) continue;
        await supabase.from('tarefas').insert({
          projeto_id:       projeto.id,
          plano_id:         tarefa.plano_id,
          tipo_tarefa:      'correcao_bug',
          status:           'pendente',
          prioridade:       risco.mitigacao.prioridade_num || 2,
          requer_aprovacao: false,
          ordem_execucao:   998,
          payload: {
            titulo:         risco.mitigacao.titulo || 'Correção de risco',
            descricao:      risco.mitigacao.descricao,
            risco_original: risco.descricao,
          },
        });
      }

      await supabase.rpc('transicionar_etapa', {
        p_projeto_id: projeto.id,
        p_etapa_para: 'execucao',
        p_origem:     'auditoria_automatica',
      });

      await inserirEvento(projeto.id, tarefa.id, 'aprovacao_necessaria', {
        tipo:         'correcoes_geradas',
        total_riscos: riscosCriticos.length,
        resumo:       output.resumo_auditoria,
      });

      await notificarChatConclusao(projeto.id, tarefa,
        `${riscosCriticos.length} riscos críticos encontrados. Tarefas de correção criadas automaticamente.`
      );

    } else {
      console.log(`[orchestrator] ✅ Auditoria ok — transitando para revisão`);

      await supabase.rpc('transicionar_etapa', {
        p_projeto_id: projeto.id,
        p_etapa_para: 'revisao',
        p_origem:     'auditoria_automatica',
      });

      await inserirEvento(projeto.id, tarefa.id, 'execucao_sucesso', {
        tipo:         'auditoria_aprovada',
        resumo:       output.resumo_auditoria,
        total_riscos: riscos.length,
      });

      await notificarChatConclusao(projeto.id, tarefa,
        `Auditoria concluída sem riscos críticos. ${output.resumo_auditoria || ''}`
      );
    }

  } catch (err) {
    console.error('[orchestrator] Erro ao processar auditoria:', err.message);
    await supabase.from('tarefas')
      .update({ status: 'pendente', em_execucao_por: null, iniciado_em: null })
      .eq('id', tarefa.id);
  }
}

async function verificarPlanoConcluidoEAuditar(projeto_id, plano_id) {
  if (!plano_id) return;
  try {
    const { data: tarefas } = await supabase
      .from('tarefas')
      .select('id, status')
      .eq('plano_id', plano_id)
      .neq('resultado->>aviso', 'duplicata');

    if (!tarefas || tarefas.length === 0) return;

    const pendentes = tarefas.filter(t => !['concluida', 'bloqueado'].includes(t.status));
    if (pendentes.length > 0) return;

    const concluidas = tarefas.filter(t => t.status === 'concluida');
    if (concluidas.length === 0) return;

    console.log(`[orchestrator] ✅ Plano ${plano_id} concluído — disparando auditoria automática`);

    const { data: auditoriaExistente } = await supabase
      .from('tarefas')
      .select('id')
      .eq('projeto_id', projeto_id)
      .eq('tipo_tarefa', 'auditoria')
      .eq('plano_id', plano_id)
      .limit(1);

    if (auditoriaExistente && auditoriaExistente.length > 0) {
      console.log(`[orchestrator] Auditoria já existe para plano ${plano_id} — ignorando`);
      return;
    }

    await supabase.rpc('transicionar_etapa', {
      p_projeto_id: projeto_id,
      p_etapa_para: 'auditoria',
      p_origem:     'orchestrator',
    });

    const { data: novaTarefa } = await supabase.from('tarefas').insert({
      projeto_id,
      plano_id,
      tipo_tarefa:      'auditoria',
      status:           'pendente',
      prioridade:       5,
      requer_aprovacao: false,
      ordem_execucao:   999,
      payload: {
        titulo:            'Auditoria Automática do Plano',
        descricao:         'Auditar todas as tarefas concluídas do plano e identificar riscos ou bugs',
        tarefas_auditadas: concluidas.map(t => t.id),
      },
    }).select('id').single();

    if (novaTarefa) {
      await inserirEvento(projeto_id, novaTarefa.id, 'aprovacao_necessaria', {
        tipo:               'auditoria_iniciada',
        plano_id,
        tarefas_concluidas: concluidas.length,
      });
      await notificarChat(projeto_id,
        `[Sistema] Código gerado. Auditando riscos agora — isso leva alguns segundos.`
      );
      console.log(`[orchestrator] 🔍 Tarefa de auditoria criada: ${novaTarefa.id}`);
    }
  } catch (err) {
    console.error('[orchestrator] Erro ao verificar plano concluído:', err.message);
  }
}

// ── ROTA /executar ────────────────────────────────────────────────────────────

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

    return res.status(200).json({
      ok:                  aplicados.length > 0,
      aplicado:            aplicados.length > 0,
      rodando,
      build:               buildResult.ok ? "ok" : "falhou",
      build_erro:          buildResult.erro,
      erro:                aplicados.length === 0 ? "nenhum arquivo aplicado" : null,
      arquivos_escritos:   aplicados,
      arquivos_bloqueados: bloqueados,
    });

  } catch (err) {
    console.error("[runner] /executar ERRO:", err.message);
    return res.status(500).json({ ok: false, aplicado: false, rodando: false, erro: err.message });
  }
});

// ── CICLO DO ORCHESTRATOR ─────────────────────────────────────────────────────

async function executarCiclo() {
  global.lastCronRun = new Date().toISOString();
  try {
    // 1. Liberar tarefas travadas
    const { error: errReset } = await supabase.rpc("resetar_tarefas_travadas");
    if (errReset) console.error("[orchestrator] Falha ao resetar travadas:", errReset.message);

    // 2. Pegar próxima tarefa
    const { data: tarefas, error: errPegar } = await supabase.rpc("pegar_tarefa");
    if (errPegar) { console.error("[orchestrator] Falha ao pegar tarefa:", errPegar.message); return; }
    if (!tarefas || tarefas.length === 0) { console.log("[orchestrator] Nenhuma tarefa pendente"); return; }

    const tarefa     = tarefas[0];
    const tentativas = tarefa.tentativas || 1;

    console.log(`[orchestrator] Tarefa: ${tarefa.id} | tipo=${tarefa.tipo_tarefa} | tentativa=${tentativas}/${MAX_RETRY}`);

    // 3. Verificar MAX_RETRY
    if (tentativas > MAX_RETRY) {
      await supabase.from("tarefas")
        .update({ status: "bloqueado", resultado: { erro: "max_retry_atingido", tentativas } })
        .eq("id", tarefa.id);
      await inserirEvento(tarefa.projeto_id, tarefa.id, "tarefa_bloqueada", { erro: "max_retry_atingido", tentativas });
      return;
    }

    // 4. Buscar projeto
    const { data: projeto } = await supabase
      .from("projetos")
      .select("id, origem, status_etapa, stack_detectada, dependencias_externas, banco_externo")
      .eq("id", tarefa.projeto_id)
      .single();

    if (!projeto) {
      await supabase.from("tarefas")
        .update({ status: "erro", resultado: { erro: "projeto_nao_encontrado" } })
        .eq("id", tarefa.id);
      return;
    }

    // 5. Verificar dependências
    if (tarefa.dependencias && tarefa.dependencias.length > 0) {
      const { data: deps } = await supabase
        .from("tarefas").select("id, status").in("id", tarefa.dependencias);
      const pendentes = (deps || []).filter((d) => d.status !== "concluida");
      if (pendentes.length > 0) {
        await supabase.from("tarefas")
          .update({ status: "pendente", em_execucao_por: null, iniciado_em: null })
          .eq("id", tarefa.id);
        return;
      }
    }

    // 6. Bloquear alterações de banco em projetos importados
    const TIPOS_BANCO = ["alterar_banco", "dropar_banco", "migrar_banco"];
    if (projeto.origem === "importado" && TIPOS_BANCO.includes(tarefa.tipo_tarefa)) {
      await supabase.from("tarefas")
        .update({ status: "pendente", requer_aprovacao: true, em_execucao_por: null, iniciado_em: null })
        .eq("id", tarefa.id);
      await inserirEvento(projeto.id, tarefa.id, "aprovacao_necessaria", {
        motivo: "alteracao_banco_projeto_importado", tipo_tarefa: tarefa.tipo_tarefa,
      });
      return;
    }

    // 7. Notificar início da tarefa no chat
    await notificarChatInicio(projeto.id, tarefa);

    // 8. Tarefas de planejamento — concluir direto
    if (tarefa.tipo_tarefa === "planejamento") {
      await supabase.from("tarefas")
        .update({ status: "concluida", resultado: { aviso: "planejamento_concluido" } })
        .eq("id", tarefa.id);
      await inserirLog(tarefa.id, "sucesso", null, tentativas);
      await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { tipo: "planejamento" });
      await notificarChatConclusao(projeto.id, tarefa, "Planejamento concluído.");
      return;
    }

    // 9. Tarefa de auditoria — processar via IA direto
    if (tarefa.tipo_tarefa === "auditoria") {
      await processarResultadoAuditoria(projeto, tarefa);
      return;
    }

    // 10. Gerar arquivos via IA
    let arquivos = tarefa.payload?.arquivos || tarefa.resultado?.arquivos || [];

    if (!arquivos.length) {
      console.log(`[orchestrator] Sem arquivos no payload — chamando executor IA`);
      arquivos = await gerarCodigoComIA(tarefa, projeto);

      if (!arquivos || !arquivos.length) {
        const erro = "Executor não gerou arquivos válidos";
        await inserirLog(tarefa.id, "erro", erro, tentativas);

        if (tentativas >= MAX_RETRY) {
          await supabase.from("tarefas")
            .update({ status: "bloqueado", resultado: { erro, tentativas } })
            .eq("id", tarefa.id);
          await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro, motivo: "executor_falhou" });
        } else {
          await supabase.from("tarefas")
            .update({ status: "pendente", em_execucao_por: null, iniciado_em: null })
            .eq("id", tarefa.id);
          await inserirEvento(projeto.id, tarefa.id, "execucao_erro", { erro, proximo: "retry", tentativa: tentativas });
        }
        return;
      }
    }

    // 11. Aplicar arquivos no disco
    const nomeProjeto = `lab-${tarefa.projeto_id}`;
    console.log(`[orchestrator] Aplicando ${arquivos.length} arquivo(s) — projeto=${nomeProjeto}`);

    let resultadoRunner;
    try {
      const projetoPath               = criarProjeto(nomeProjeto);
      const rodando                   = verificarProjeto(projetoPath);
      const { aplicados, bloqueados } = aplicarArquivos(projetoPath, arquivos);
      const buildResult               = aplicados.length > 0 ? executarBuild(projetoPath) : { ok: true, erro: null };

      resultadoRunner = {
        ok:                  aplicados.length > 0,
        aplicado:            aplicados.length > 0,
        rodando,
        build:               buildResult.ok ? "ok" : "falhou",
        build_erro:          buildResult.erro,
        erro:                aplicados.length === 0 ? "nenhum arquivo aplicado" : null,
        arquivos_escritos:   aplicados,
        arquivos_bloqueados: bloqueados,
      };
    } catch (errExec) {
      resultadoRunner = { ok: false, aplicado: false, rodando: false, erro: errExec.message };
    }

    // 12. Processar resultado
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

      await inserirLog(tarefa.id, "sucesso", null, tentativas);
      await inserirEvento(projeto.id, tarefa.id, "codigo_aplicado", {
        arquivos_escritos: resultadoRunner.arquivos_escritos || [],
        nomeProjeto,
      });

      const arquivosStr = (resultadoRunner.arquivos_escritos || []).join(", ");

      if (resultadoRunner.build === "ok") {
        await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { nomeProjeto, build: "ok" });
        await notificarChatConclusao(projeto.id, tarefa,
          `Pronto — ${arquivosStr} criado com sucesso. Build ok.`
        );
      } else {
        await inserirEvento(projeto.id, tarefa.id, "build_falhou", {
          nomeProjeto, erro: resultadoRunner.build_erro,
        });
        await notificarChatConclusao(projeto.id, tarefa,
          `Arquivos aplicados (${arquivosStr}) mas o build encontrou um problema. Vou corrigir automaticamente.`
        );
      }

      console.log(`[orchestrator] ✅ Tarefa ${tarefa.id} concluída — build=${resultadoRunner.build}`);
      await verificarPlanoConcluidoEAuditar(projeto.id, tarefa.plano_id);

    } else {
      const erro = resultadoRunner.erro || "Erro desconhecido no runner";
      await inserirLog(tarefa.id, "erro", erro, tentativas);

      if (tentativas >= MAX_RETRY) {
        await supabase.from("tarefas")
          .update({ status: "bloqueado", resultado: { erro, tentativas } })
          .eq("id", tarefa.id);
        await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro, motivo: "max_retry_atingido" });
      } else {
        await supabase.from("tarefas")
          .update({ status: "pendente", em_execucao_por: null, iniciado_em: null })
          .eq("id", tarefa.id);
        await inserirEvento(projeto.id, tarefa.id, "execucao_erro", { erro, proximo: "retry", tentativa: tentativas });
      }
    }

  } catch (err) {
    console.error("[orchestrator] ERRO INESPERADO:", err.message, err.stack?.slice(0, 500));
  }
}

// ── START SERVER + CRON INTERNO ───────────────────────────────────────────────

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Lab Runner rodando na porta ${PORT}`);
  console.log(`📦 Projetos em: ${BASE_PATH}`);
  console.log(`⏱️  Cron interno iniciando em 5s — intervalo: ${CRON_MS}ms`);

  setTimeout(() => {
    console.log("[cron] ✅ Loop interno iniciado");
    executarCiclo();
    setInterval(executarCiclo, CRON_MS);
  }, 5000);
});

server.on("error",               (err) => console.error("❌ Server error:", err));
process.on("uncaughtException",  (err) => console.error("❌ Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("❌ Rejection:", err));
