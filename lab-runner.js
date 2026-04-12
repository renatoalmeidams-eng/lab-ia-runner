require("dotenv").config();
const express      = require("express");
const fs           = require("fs");
const path         = require("path");
const sharp        = require("sharp");
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const GITHUB_TOKEN    = process.env.GITHUB_TOKEN    || null;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || null;
const VERCEL_TOKEN    = process.env.VERCEL_TOKEN    || null;

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
    normalized === p || normalized.startsWith(p + "/") || path.basename(normalized) === p
  );
}

// ── ROTAS BÁSICAS ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.status(200).json({ ok: true, status: "running", uptime: process.uptime() });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true, status: "healthy", uptime: process.uptime(),
    last_cron: global.lastCronRun || null, base_path: BASE_PATH,
  });
});

// ── ROTA PREVIEW ──────────────────────────────────────────────────────────────

app.use("/preview/:projeto_id", (req, res, next) => {
  const distPath = path.join(BASE_PATH, `lab-${req.params.projeto_id}`, "dist");
  if (!fs.existsSync(distPath)) {
    return res.status(404).json({ ok: false, erro: "Preview não disponível — build não encontrado." });
  }
  req.url = req.url === "/" || req.url === "" ? "/index.html" : req.url;
  express.static(distPath)(req, res, () => {
    res.sendFile(path.join(distPath, "index.html"));
  });
});

// ── HELPERS DO RUNNER ─────────────────────────────────────────────────────────

function criarProjeto(nome) {
  const projetoPath = path.join(BASE_PATH, nome);
  if (!fs.existsSync(BASE_PATH)) fs.mkdirSync(BASE_PATH, { recursive: true });
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
`import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })`);
    fs.writeFileSync(path.join(projetoPath, "index.html"),
`<!DOCTYPE html>\n<html lang="pt-BR">\n  <head><meta charset="UTF-8" /><title>Lab IA</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>`);
    fs.writeFileSync(path.join(projetoPath, "src", "main.jsx"),
`import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App.jsx'\nReactDOM.createRoot(document.getElementById('root')).render(<App />)`);
    fs.writeFileSync(path.join(projetoPath, "src", "App.jsx"),
`export default function App() { return <h1>Lab IA</h1>; }`);
    execSync("npm install", { stdio: "inherit", cwd: projetoPath });
    console.log(`[runner] Projeto criado: ${projetoPath}`);
  }
  return projetoPath;
}

function aplicarArquivos(projetoPath, arquivos) {
  const aplicados = [], bloqueados = [];
  for (const arquivo of arquivos) {
    const caminho  = arquivo.caminho || arquivo.path;
    const conteudo = arquivo.codigo  || arquivo.content || "";
    if (!caminho) { console.warn("[runner] Arquivo sem caminho — ignorado"); continue; }
    if (isProtected(caminho)) { console.warn(`[runner] 🔒 Bloqueado: ${caminho}`); bloqueados.push(caminho); continue; }
    const fullPath = path.join(projetoPath, caminho);
    const dir = path.dirname(fullPath);
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
  try { execSync("npm install", { cwd: projetoPath, stdio: "pipe", timeout: 120000 }); }
  catch (e) { console.warn("[runner] npm install avisos:", e.message?.slice(0, 200)); }
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
  } catch (e) { console.error("[runner] Falha ao inserir log:", e.message); }
}

async function inserirEvento(projeto_id, tarefa_id, tipo, payload) {
  try {
    await supabase.from("eventos").insert({
      projeto_id, tarefa_id, tipo, payload: payload || {}, processado: false,
    });
  } catch (e) { console.error("[runner] Falha ao inserir evento:", e.message); }
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
  } catch (err) { console.warn(`[orchestrator] Erro ao notificar chat:`, err.message); }
}

async function notificarChatInicio(projeto_id, tarefa) {
  const titulo = tarefa.payload?.titulo || tarefa.tipo_tarefa;
  await notificarChat(projeto_id, `[Sistema] Iniciando tarefa: ${titulo} (tipo: ${tarefa.tipo_tarefa}).`);
}

async function notificarChatConclusao(projeto_id, tarefa, resumo) {
  await notificarChat(projeto_id, `[Sistema] ${resumo}`);
}

async function gerarCodigoComIA(tarefa, projeto) {
  try {
    console.log(`[orchestrator] Chamando executor IA — tarefa=${tarefa.id}`);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/executar-agente`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        agente: "executor", projeto_id: tarefa.projeto_id, tarefa_id: tarefa.id,
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
    const arquivos = Array.isArray(data.output?.arquivos) ? data.output.arquivos : [];
    console.log(`[orchestrator] Executor retornou ${arquivos.length} arquivo(s)`);
    if (!arquivos.length) console.warn(`[orchestrator] Output:`, JSON.stringify(data.output).slice(0, 500));
    return arquivos;
  } catch (err) {
    console.error(`[orchestrator] Erro ao chamar executor:`, err.message);
    return [];
  }
}

async function processarResultadoAuditoria(projeto, tarefa) {
  try {
    console.log(`[orchestrator] 🔍 Auditoria IA — tarefa=${tarefa.id}`);
    const tarefasIds = tarefa.payload?.tarefas_auditadas || [];
    const { data: tarefasAuditadas } = await supabase.from('tarefas')
      .select('id, tipo_tarefa, payload, resultado')
      .in('id', tarefasIds.length > 0 ? tarefasIds : ['00000000-0000-0000-0000-000000000000']);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/executar-agente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        agente: 'auditor', projeto_id: projeto.id, tarefa_id: tarefa.id,
        input: {
          tarefas: (tarefasAuditadas || []).map(t => ({
            id: t.id, tipo: t.tipo_tarefa, titulo: t.payload?.titulo,
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
      console.log(`[orchestrator] ⚠️ ${riscosCriticos.length} riscos críticos`);
      for (const risco of todosGraves) {
        if (!risco.mitigacao) continue;
        await supabase.from('tarefas').insert({
          projeto_id: projeto.id, plano_id: tarefa.plano_id, tipo_tarefa: 'correcao_bug',
          status: 'pendente', prioridade: risco.mitigacao.prioridade_num || 2,
          requer_aprovacao: false, ordem_execucao: 998,
          payload: { titulo: risco.mitigacao.titulo || 'Correção de risco', descricao: risco.mitigacao.descricao, risco_original: risco.descricao },
        });
      }
      await supabase.rpc('transicionar_etapa', { p_projeto_id: projeto.id, p_etapa_para: 'execucao', p_origem: 'auditoria_automatica' });
      await inserirEvento(projeto.id, tarefa.id, 'aprovacao_necessaria', { tipo: 'correcoes_geradas', total_riscos: riscosCriticos.length, resumo: output.resumo_auditoria });
      await notificarChatConclusao(projeto.id, tarefa, `${riscosCriticos.length} riscos críticos encontrados. Tarefas de correção criadas automaticamente.`);
    } else {
      console.log(`[orchestrator] ✅ Auditoria ok — revisão`);
      await supabase.rpc('transicionar_etapa', { p_projeto_id: projeto.id, p_etapa_para: 'revisao', p_origem: 'auditoria_automatica' });
      await inserirEvento(projeto.id, tarefa.id, 'execucao_sucesso', { tipo: 'auditoria_aprovada', resumo: output.resumo_auditoria, total_riscos: riscos.length });
      await notificarChatConclusao(projeto.id, tarefa, `Auditoria concluída sem riscos críticos. ${output.resumo_auditoria || ''}`);
    }
  } catch (err) {
    console.error('[orchestrator] Erro auditoria:', err.message);
    await supabase.from('tarefas').update({ status: 'pendente', em_execucao_por: null, iniciado_em: null }).eq('id', tarefa.id);
  }
}

async function verificarPlanoConcluidoEAuditar(projeto_id, plano_id) {
  if (!plano_id) return;
  try {
    const { data: tarefas } = await supabase.from('tarefas').select('id, status')
      .eq('plano_id', plano_id).neq('resultado->>aviso', 'duplicata');
    if (!tarefas || tarefas.length === 0) return;
    const pendentes  = tarefas.filter(t => !['concluida', 'bloqueado'].includes(t.status));
    if (pendentes.length > 0) return;
    const concluidas = tarefas.filter(t => t.status === 'concluida');
    if (concluidas.length === 0) return;

    console.log(`[orchestrator] ✅ Plano ${plano_id} concluído — auditoria automática`);
    const { data: auditoriaExistente } = await supabase.from('tarefas').select('id')
      .eq('projeto_id', projeto_id).eq('tipo_tarefa', 'auditoria').eq('plano_id', plano_id).limit(1);
    if (auditoriaExistente && auditoriaExistente.length > 0) return;

    await supabase.rpc('transicionar_etapa', { p_projeto_id: projeto_id, p_etapa_para: 'auditoria', p_origem: 'orchestrator' });
    const { data: novaTarefa } = await supabase.from('tarefas').insert({
      projeto_id, plano_id, tipo_tarefa: 'auditoria', status: 'pendente', prioridade: 5,
      requer_aprovacao: false, ordem_execucao: 999,
      payload: { titulo: 'Auditoria Automática do Plano', descricao: 'Auditar tarefas concluídas e identificar riscos', tarefas_auditadas: concluidas.map(t => t.id) },
    }).select('id').single();

    if (novaTarefa) {
      await inserirEvento(projeto_id, novaTarefa.id, 'aprovacao_necessaria', { tipo: 'auditoria_iniciada', plano_id, tarefas_concluidas: concluidas.length });
      await notificarChat(projeto_id, `[Sistema] Código gerado. Auditando riscos agora — isso leva alguns segundos.`);
    }
  } catch (err) { console.error('[orchestrator] Erro verificar plano:', err.message); }
}

// ── ROLLBACK AUTOMÁTICO DE IMPORTAÇÕES TRAVADAS ───────────────────────────────
// Detecta projetos parados em analisando_importacao sem upload pendente na fila.
// Causa: processar-upload-lovable falhou antes de criar o registro em uploads,
// deixando o projeto orphan nesse estado indefinidamente.
// Solução: após TIMEOUT_MINUTOS, volta para aguardando_lovable e avisa o usuário.

async function rollbackImportacoesTravadas() {
  const TIMEOUT_MINUTOS = 5;
  try {
    const limiteData = new Date(Date.now() - TIMEOUT_MINUTOS * 60 * 1000).toISOString();

    const { data: travados } = await supabase
      .from('projetos')
      .select('id, ideia')
      .eq('status_etapa', 'analisando_importacao')
      .lt('atualizado_em', limiteData);

    if (!travados || travados.length === 0) return;

    for (const projeto of travados) {
      // Verificar se há upload pendente real — se houver, o Railway vai processar normalmente
      const { data: uploadsPendentes } = await supabase
        .from('uploads')
        .select('id')
        .eq('projeto_id', projeto.id)
        .eq('analisado', false)
        .limit(1);

      if (uploadsPendentes && uploadsPendentes.length > 0) continue; // tem upload na fila — não intervir

      // Sem upload pendente = projeto orphan — rollback
      console.log(`[orchestrator] ⚠️ Rollback: projeto ${projeto.id} (${projeto.ideia}) travado em analisando_importacao sem upload na fila`);

      await supabase
        .from('projetos')
        .update({ status_etapa: 'aguardando_lovable' })
        .eq('id', projeto.id);

      await supabase.from('conversas').insert({
        projeto_id: projeto.id,
        papel: 'lab',
        mensagem: '⚠️ A análise do ZIP demorou mais que o esperado e foi reiniciada automaticamente. Por favor, faça o upload do ZIP novamente na aba **Upload Lovable**.',
        etapa: 'aguardando_lovable',
        acao: { tipo: 'rollback_importacao', agente: 'sistema' },
      });

      await inserirEvento(projeto.id, null, 'execucao_erro', {
        tipo: 'rollback_importacao_travada',
        motivo: 'analisando_importacao sem upload pendente por mais de ' + TIMEOUT_MINUTOS + ' minutos',
      });

      console.log(`[orchestrator] ✅ Rollback concluído: projeto ${projeto.id} devolvido para aguardando_lovable`);
    }
  } catch (err) {
    console.error('[orchestrator] Erro rollbackImportacoesTravadas:', err.message);
  }
}

// ── ANÁLISE DE IMPORTAÇÃO (ZIP grande via Railway) ────────────────────────────

async function processarImportacoesPendentes() {
  try {
    const { data: uploads } = await supabase
      .from('uploads')
      .select('id, projeto_id, storage_path, nome_arquivo, tamanho_bytes')
      .eq('tipo', 'importacao_externa')
      .eq('analisado', false)
      .not('projeto_id', 'is', null)
      .limit(1);

    if (!uploads || uploads.length === 0) return;

    const upload = uploads[0];
    console.log(`[orchestrator] 📦 Processando importação: ${upload.nome_arquivo} (${(upload.tamanho_bytes/1024/1024).toFixed(1)}MB)`);

    const { data: projeto } = await supabase.from('projetos').select('id, ideia').eq('id', upload.projeto_id).single();
    if (!projeto) return;

    await notificarChat(projeto.id, `[Sistema] Iniciando análise do código de ${upload.nome_arquivo}. Isso pode levar até 60 segundos.`);

    // Marcar como em processamento antes de iniciar (evitar duplo processamento)
    await supabase.from('uploads').update({ analisado: true }).eq('id', upload.id);

    // Baixar ZIP do Storage
    const { data: zipData, error: errDownload } = await supabase.storage
      .from('uploads-externos')
      .download(upload.storage_path);

    if (errDownload || !zipData) {
      console.error('[orchestrator] Erro ao baixar ZIP:', errDownload?.message);
      await supabase.from('uploads').update({ analisado: false }).eq('id', upload.id);
      await notificarChat(projeto.id, `[Sistema] Não consegui baixar o arquivo para análise. Erro: ${errDownload?.message}`);
      return;
    }

    // Descompactar ZIP
    const AdmZip = require('adm-zip');
    const arrayBuffer = await zipData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let arquivosSelecionados = {};
    let totalArquivos = 0;

    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      totalArquivos = entries.length;

      const IGNORAR     = ["node_modules/", ".git/", "dist/", "build/", ".next/", ".nuxt/", "coverage/", ".cache/"];
      const IGNORAR_EXT = [".lock", ".log", ".map", ".min.js", ".min.css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar"];

      const candidatos = entries.filter(e => {
        if (e.isDirectory) return false;
        const c = e.entryName;
        return !IGNORAR.some(p => c.includes(p)) && !IGNORAR_EXT.some(ext => c.toLowerCase().endsWith(ext));
      });

      const PRIORIDADE = [
        (c) => ["package.json","requirements.txt","go.mod","composer.json"].some(f => c.toLowerCase().endsWith(f)),
        (c) => ["readme.md","readme.txt"].some(f => c.toLowerCase().endsWith(f)),
        (c) => ["vite.config","next.config","tsconfig","webpack.config"].some(f => c.toLowerCase().includes(f)),
        (c) => c.toLowerCase().includes("migration") || c.toLowerCase().includes("schema") || c.toLowerCase().endsWith(".sql"),
        (c) => { const n = path.basename(c).toLowerCase(); return ["app.jsx","app.tsx","app.js","app.ts","index.js","index.ts","main.ts","main.js"].includes(n); },
        (c) => c.toLowerCase().includes("/routes/") || c.toLowerCase().includes("/pages/"),
        (c) => c.toLowerCase().includes("/src/") || c.toLowerCase().includes("/app/") || c.toLowerCase().includes("/lib/"),
      ];

      for (const filtro of PRIORIDADE) {
        if (Object.keys(arquivosSelecionados).length >= 50) break;
        for (const entry of candidatos) {
          if (Object.keys(arquivosSelecionados).length >= 50) break;
          if (!arquivosSelecionados[entry.entryName] && filtro(entry.entryName)) {
            try { arquivosSelecionados[entry.entryName] = entry.getData().toString('utf-8'); } catch {}
          }
        }
      }
      for (const entry of candidatos) {
        if (Object.keys(arquivosSelecionados).length >= 50) break;
        if (!arquivosSelecionados[entry.entryName]) {
          try { arquivosSelecionados[entry.entryName] = entry.getData().toString('utf-8'); } catch {}
        }
      }

      console.log(`[orchestrator] ZIP: total=${totalArquivos} selecionados=${Object.keys(arquivosSelecionados).length}`);
    } catch (e) {
      console.error('[orchestrator] Erro descompactar ZIP:', e.message);
      await supabase.from('uploads').update({ analisado: false }).eq('id', upload.id);
      await notificarChat(projeto.id, `[Sistema] Não consegui ler o arquivo ZIP. Verifique se o arquivo não está corrompido.`);
      return;
    }

    // Chamar analisador IA
    const agenteRes = await fetch(`${SUPABASE_URL}/functions/v1/executar-agente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        agente: 'analisador',
        input: { arquivos: arquivosSelecionados, total_arquivos: totalArquivos, contexto: 'Projeto externo importado para o Laboratório IA' },
      }),
    });

    const agenteData = await agenteRes.json();
    let analise = {};

    if (agenteRes.ok && agenteData.ok) {
      analise = agenteData.output || {};
      console.log('[orchestrator] ✅ Análise concluída');
    } else {
      console.error('[orchestrator] Análise falhou:', JSON.stringify(agenteData).slice(0, 200));
      analise = { resumo: `Projeto importado: ${projeto.ideia}`, stack: [], banco_detectado: null, problemas_detectados: [], sugestoes: [] };
    }

    // Atualizar projeto com dados da análise
    await supabase.from('projetos').update({
      stack_detectada:       analise.stack           || null,
      dependencias_externas: analise.dependencias    || null,
      banco_externo:         analise.banco_detectado || null,
      resumo_contexto:       String(analise.resumo   || projeto.ideia),
      status_etapa:          'aguardando_aprovacao',
    }).eq('id', projeto.id);

    await supabase.from('uploads').update({ analise }).eq('id', upload.id);

    // Formatar mensagem de análise em markdown estruturado
    const stackArr     = Array.isArray(analise.stack) ? analise.stack : [];
    const problemasArr = Array.isArray(analise.problemas_detectados) ? analise.problemas_detectados : [];
    const sugestoesArr = Array.isArray(analise.sugestoes) ? analise.sugestoes : [];
    const banco        = analise.banco_detectado;
    const bancoStr     = banco
      ? `${banco.tipo || 'postgresql'}${Array.isArray(banco.schemas) && banco.schemas.length ? ' — tabelas: ' + banco.schemas.join(', ') : ''}`
      : 'não detectado';

    const linhas = [
      `## ✅ Análise concluída`,
      ``,
      `**Stack detectada:**`,
      ...stackArr.map(s => `- ${s}`),
      ``,
      `**Banco de dados:** ${bancoStr}`,
    ];

    if (problemasArr.length > 0) {
      linhas.push(``, `**⚠️ Problemas encontrados (${problemasArr.length}):**`);
      problemasArr.slice(0, 5).forEach(p => linhas.push(`- ${p}`));
      if (problemasArr.length > 5) linhas.push(`- *(e mais ${problemasArr.length - 5} outros...)*`);
    } else {
      linhas.push(``, `**✅ Nenhum problema crítico encontrado**`);
    }

    if (sugestoesArr.length > 0) {
      linhas.push(``, `**💡 Sugestões principais (${sugestoesArr.length}):**`);
      sugestoesArr.slice(0, 3).forEach(s => linhas.push(`- ${s}`));
      if (sugestoesArr.length > 3) linhas.push(`- *(e mais ${sugestoesArr.length - 3} sugestões...)*`);
    }

    linhas.push(``, `O que você quer fazer primeiro?`);

    const mensagemFinal = linhas.join('\n');

    await supabase.from('conversas').insert({
      projeto_id: projeto.id, papel: 'lab', mensagem: mensagemFinal,
      etapa: 'aguardando_aprovacao', acao: { tipo: 'analise_concluida' },
    });

    await inserirEvento(projeto.id, null, 'execucao_sucesso', {
      tipo: 'analise_importacao_concluida',
      arquivos_analisados: Object.keys(arquivosSelecionados).length,
    });

    console.log(`[orchestrator] ✅ Importação processada: projeto=${projeto.id}`);

  } catch (err) {
    console.error('[orchestrator] Erro processarImportacoesPendentes:', err.message);
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
    if (executarBuildFlag && aplicados.length > 0) buildResult = executarBuild(projetoPath);
    return res.status(200).json({
      ok: aplicados.length > 0, aplicado: aplicados.length > 0, rodando,
      build: buildResult.ok ? "ok" : "falhou", build_erro: buildResult.erro,
      erro: aplicados.length === 0 ? "nenhum arquivo aplicado" : null,
      arquivos_escritos: aplicados, arquivos_bloqueados: bloqueados,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, aplicado: false, rodando: false, erro: err.message });
  }
});

// ── CICLO DO ORCHESTRATOR ─────────────────────────────────────────────────────

// ── PUSH PARA GITHUB APÓS BUILD OK ───────────────────────────────────────────

async function pushParaGitHub(projetoPath, projeto) {
  if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
    console.log('[GitHub] GITHUB_TOKEN ou GITHUB_USERNAME não configurados — pulando push');
    return null;
  }

  const repoName   = `lab-ia-${projeto.id.substring(0, 8)}`;
  const nomeApp    = (projeto.ideia || 'lab-ia-app')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').substring(0, 50);
  const repoSlug   = `lab-ia-${nomeApp}`;
  const repoDesc   = `${projeto.ideia || 'Lab IA App'} — gerado automaticamente pelo Laboratório IA`;

  try {
    // 1. Verificar se o repo já existe via API GitHub
    const checkRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${repoSlug}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'lab-ia-runner' },
    });

    // 2. Criar repo se não existir
    if (checkRes.status === 404) {
      console.log(`[GitHub] Criando repositório: ${repoSlug}`);
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'lab-ia-runner',
        },
        body: JSON.stringify({
          name: repoSlug, description: repoDesc,
          private: false, auto_init: false,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        console.error('[GitHub] Falha ao criar repo:', err.message);
        return null;
      }
      console.log(`[GitHub] ✅ Repositório criado: ${repoSlug}`);
    }

    // 3. Configurar git e fazer push
    const remoteUrl = `https://${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${repoSlug}.git`;

    const gitCommands = [
      `git init`,
      `git config user.email "lab-ia@runner.auto"`,
      `git config user.name "Lab IA Runner"`,
      `git add -A`,
      `git commit -m "build: deploy automático — Laboratório IA" --allow-empty`,
      `git branch -M main`,
      `git remote remove origin 2>/dev/null || true`,
      `git remote add origin ${remoteUrl}`,
      `git push -u origin main --force`,
    ];

    for (const cmd of gitCommands) {
      try {
        execSync(cmd, { cwd: projetoPath, stdio: 'pipe', timeout: 30000 });
      } catch (e) {
        // Ignorar erros não críticos (ex: remote já existe)
        if (!cmd.includes('push')) continue;
        console.error(`[GitHub] Erro no comando git: ${cmd.split(' ').slice(0,2).join(' ')}`, e.message?.slice(0, 200));
        return null;
      }
    }

    const repoUrl = `https://github.com/${GITHUB_USERNAME}/${repoSlug}`;
    console.log(`[GitHub] ✅ Push concluído: ${repoUrl}`);

    // 4. Salvar URL do repo no projeto
    await supabase.from('projetos').update({ github_url: repoUrl }).eq('id', projeto.id);

    return repoUrl;
  } catch (err) {
    console.error('[GitHub] Erro inesperado:', err.message);
    return null;
  }
}


// ── DEPLOY PARA VERCEL APÓS PUSH GITHUB ──────────────────────────────────────

async function deployParaVercel(repoUrl, projeto) {
  if (!VERCEL_TOKEN) {
    console.log('[Vercel] VERCEL_TOKEN não configurado — pulando deploy');
    return null;
  }
  if (!repoUrl) {
    console.log('[Vercel] Sem URL do GitHub — pulando deploy Vercel');
    return null;
  }

  const nomeApp  = (projeto.ideia || 'lab-ia-app')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').substring(0, 50);
  const repoSlug = `lab-ia-${nomeApp}`;

  try {
    // 1. Verificar se projeto Vercel já existe
    const listRes = await fetch(`https://api.vercel.com/v9/projects/${repoSlug}`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });

    let vercelProjectId = null;

    if (listRes.status === 404) {
      // 2. Criar projeto Vercel linkado ao repo GitHub
      console.log(`[Vercel] Criando projeto: ${repoSlug}`);
      const createRes = await fetch('https://api.vercel.com/v10/projects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: repoSlug,
          framework: 'vite',
          gitRepository: {
            type: 'github',
            repo: `${GITHUB_USERNAME}/${repoSlug}`,
          },
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          installCommand: 'npm install',
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        console.error('[Vercel] Falha ao criar projeto:', JSON.stringify(err).slice(0, 200));
        return null;
      }

      const created = await createRes.json();
      vercelProjectId = created.id;
      console.log(`[Vercel] ✅ Projeto criado: ${repoSlug} (id=${vercelProjectId})`);
    } else {
      const existing = await listRes.json();
      vercelProjectId = existing.id;
      console.log(`[Vercel] Projeto já existe: ${repoSlug} (id=${vercelProjectId})`);
    }

    // 3. Disparar deploy via API
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repoSlug,
        project: vercelProjectId,
        gitSource: {
          type: 'github',
          repoId: `${GITHUB_USERNAME}/${repoSlug}`,
          ref: 'main',
        },
        target: 'production',
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json();
      console.error('[Vercel] Falha ao criar deploy:', JSON.stringify(err).slice(0, 200));
      return null;
    }

    const deploy = await deployRes.json();
    const vercelUrl = `https://${deploy.url || `${repoSlug}.vercel.app`}`;
    console.log(`[Vercel] ✅ Deploy iniciado: ${vercelUrl}`);

    // 4. Salvar URL Vercel no projeto
    await supabase.from('projetos').update({ vercel_url: vercelUrl }).eq('id', projeto.id);

    return vercelUrl;
  } catch (err) {
    console.error('[Vercel] Erro inesperado:', err.message);
    return null;
  }
}

async function garantirPWA(projetoPath, nomeApp) {
  try {
    const publicDir = path.join(projetoPath, 'public');
    const iconsDir = path.join(publicDir, 'icons');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

    const inicial = (nomeApp || 'App').charAt(0).toUpperCase();
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#2563eb"/><text x="256" y="340" font-family="Arial,sans-serif" font-size="280" font-weight="bold" text-anchor="middle" fill="white">${inicial}</text></svg>`;
    const svgBuffer = Buffer.from(svgIcon);

    const icon192Path = path.join(iconsDir, 'icon-192.png');
    if (!fs.existsSync(icon192Path)) {
      await sharp(svgBuffer).resize(192, 192).png().toFile(icon192Path);
    }
    const icon512Path = path.join(iconsDir, 'icon-512.png');
    if (!fs.existsSync(icon512Path)) {
      await sharp(svgBuffer).resize(512, 512).png().toFile(icon512Path);
    }

    const manifestPath = path.join(publicDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const manifest = {
        name: nomeApp || 'Lab IA App',
        short_name: (nomeApp || 'App').substring(0, 12),
        description: `${nomeApp || 'App'} — gerado pelo Laboratório IA`,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        orientation: 'any',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    const swPath = path.join(publicDir, 'sw.js');
    if (!fs.existsSync(swPath)) {
      const sw = `const CACHE='lab-ia-v1';const ASSETS=['/','/index.html'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;
      fs.writeFileSync(swPath, sw);
    }

    console.log(`[PWA] ✅ ${nomeApp} — manifest, ícones e sw.js garantidos`);
    return true;
  } catch (err) {
    console.error('[PWA] Erro:', err.message);
    return false;
  }
}

async function executarCiclo() {
  global.lastCronRun = new Date().toISOString();
  try {
    // 0a. Rollback de projetos travados em analisando_importacao sem upload na fila
    await rollbackImportacoesTravadas();

    // 0b. Processar importações pendentes (ZIP grandes)
    await processarImportacoesPendentes();

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
      await supabase.from("tarefas").update({ status: "bloqueado", resultado: { erro: "max_retry_atingido", tentativas } }).eq("id", tarefa.id);
      await inserirEvento(tarefa.projeto_id, tarefa.id, "tarefa_bloqueada", { erro: "max_retry_atingido", tentativas });
      return;
    }

    // 4. Buscar projeto
    const { data: projeto } = await supabase.from("projetos")
      .select("id, origem, status_etapa, stack_detectada, dependencias_externas, banco_externo")
      .eq("id", tarefa.projeto_id).single();

    if (!projeto) {
      await supabase.from("tarefas").update({ status: "erro", resultado: { erro: "projeto_nao_encontrado" } }).eq("id", tarefa.id);
      return;
    }

    // 5. Verificar dependências
    if (tarefa.dependencias && tarefa.dependencias.length > 0) {
      const { data: deps } = await supabase.from("tarefas").select("id, status").in("id", tarefa.dependencias);
      const pendentes = (deps || []).filter(d => d.status !== "concluida");
      if (pendentes.length > 0) {
        await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
        return;
      }
    }

    // 6. Bloquear banco em projetos importados
    const TIPOS_BANCO = ["alterar_banco", "dropar_banco", "migrar_banco"];
    if (projeto.origem === "importado" && TIPOS_BANCO.includes(tarefa.tipo_tarefa)) {
      await supabase.from("tarefas").update({ status: "pendente", requer_aprovacao: true, em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
      await inserirEvento(projeto.id, tarefa.id, "aprovacao_necessaria", { motivo: "alteracao_banco_projeto_importado", tipo_tarefa: tarefa.tipo_tarefa });
      return;
    }

    // 7. Notificar início
    await notificarChatInicio(projeto.id, tarefa);

    // 8. Planejamento — concluir direto
    if (tarefa.tipo_tarefa === "planejamento") {
      await supabase.from("tarefas").update({ status: "concluida", resultado: { aviso: "planejamento_concluido" } }).eq("id", tarefa.id);
      await inserirLog(tarefa.id, "sucesso", null, tentativas);
      await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { tipo: "planejamento" });
      await notificarChatConclusao(projeto.id, tarefa, "Planejamento concluído.");
      return;
    }

    // 9. Auditoria — processar via IA
    if (tarefa.tipo_tarefa === "auditoria") {
      await processarResultadoAuditoria(projeto, tarefa);
      return;
    }

    // 10. Gerar arquivos via IA
    let arquivos = tarefa.payload?.arquivos || tarefa.resultado?.arquivos || [];
    if (!arquivos.length) {
      arquivos = await gerarCodigoComIA(tarefa, projeto);
      if (!arquivos || !arquivos.length) {
        const erro = "Executor não gerou arquivos válidos";
        await inserirLog(tarefa.id, "erro", erro, tentativas);
        if (tentativas >= MAX_RETRY) {
          await supabase.from("tarefas").update({ status: "bloqueado", resultado: { erro, tentativas } }).eq("id", tarefa.id);
          await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro, motivo: "executor_falhou" });
        } else {
          await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
          await inserirEvento(projeto.id, tarefa.id, "execucao_erro", { erro, proximo: "retry", tentativa: tentativas });
        }
        return;
      }
    }

    // 11. Aplicar arquivos
    const nomeProjeto = `lab-${tarefa.projeto_id}`;
    console.log(`[orchestrator] Aplicando ${arquivos.length} arquivo(s) — ${nomeProjeto}`);

    let resultadoRunner;
    try {
      const projetoPath               = criarProjeto(nomeProjeto);
      const rodando                   = verificarProjeto(projetoPath);
      const { aplicados, bloqueados } = aplicarArquivos(projetoPath, arquivos);
      const buildResult               = aplicados.length > 0 ? executarBuild(projetoPath) : { ok: true, erro: null };
      resultadoRunner = {
        ok: aplicados.length > 0, aplicado: aplicados.length > 0, rodando,
        build: buildResult.ok ? "ok" : "falhou", build_erro: buildResult.erro,
        erro: aplicados.length === 0 ? "nenhum arquivo aplicado" : null,
        arquivos_escritos: aplicados, arquivos_bloqueados: bloqueados,
      };
    } catch (errExec) {
      resultadoRunner = { ok: false, aplicado: false, rodando: false, erro: errExec.message };
    }

    // 12. Processar resultado
    if (resultadoRunner.ok && resultadoRunner.aplicado) {
      await supabase.from("tarefas").update({
        status: "concluida",
        resultado: {
          arquivos_gerados: arquivos.length, arquivos_escritos: resultadoRunner.arquivos_escritos || [],
          arquivos_bloqueados: resultadoRunner.arquivos_bloqueados || [],
          build: resultadoRunner.build, rodando: resultadoRunner.rodando,
        },
      }).eq("id", tarefa.id);

      await inserirLog(tarefa.id, "sucesso", null, tentativas);
      await inserirEvento(projeto.id, tarefa.id, "codigo_aplicado", { arquivos_escritos: resultadoRunner.arquivos_escritos || [], nomeProjeto });

      const arquivosStr = (resultadoRunner.arquivos_escritos || []).join(", ");
      if (resultadoRunner.build === "ok") {
        await inserirEvento(projeto.id, tarefa.id, "execucao_sucesso", { nomeProjeto, build: "ok" });
        // Garantir PWA após build ok
        if (projeto && projetoPath) await garantirPWA(projetoPath, projeto.ideia || 'Lab IA App');

        // Push para GitHub após build ok
        const githubUrl = await pushParaGitHub(projetoPath, projeto);

        // Deploy para Vercel após push GitHub
        const vercelUrl = await deployParaVercel(githubUrl, projeto);

        // Montar mensagem final com links
        const githubMsg = githubUrl ? ` GitHub: ${githubUrl}` : '';
        const vercelMsg = vercelUrl ? ` | App: ${vercelUrl}` : '';

        await notificarChatConclusao(projeto.id, tarefa, `Pronto — ${arquivosStr} criado com sucesso. Build ok.${githubMsg}${vercelMsg}`);
      } else {
        await inserirEvento(projeto.id, tarefa.id, "build_falhou", { nomeProjeto, erro: resultadoRunner.build_erro });
        await notificarChatConclusao(projeto.id, tarefa, `Arquivos aplicados (${arquivosStr}) mas o build encontrou um problema. Vou corrigir automaticamente.`);
      }

      console.log(`[orchestrator] ✅ Tarefa ${tarefa.id} concluída — build=${resultadoRunner.build}`);
      await verificarPlanoConcluidoEAuditar(projeto.id, tarefa.plano_id);

    } else {
      const erro = resultadoRunner.erro || "Erro desconhecido no runner";
      await inserirLog(tarefa.id, "erro", erro, tentativas);
      if (tentativas >= MAX_RETRY) {
        await supabase.from("tarefas").update({ status: "bloqueado", resultado: { erro, tentativas } }).eq("id", tarefa.id);
        await inserirEvento(projeto.id, tarefa.id, "tarefa_bloqueada", { erro, motivo: "max_retry_atingido" });
      } else {
        await supabase.from("tarefas").update({ status: "pendente", em_execucao_por: null, iniciado_em: null }).eq("id", tarefa.id);
        await inserirEvento(projeto.id, tarefa.id, "execucao_erro", { erro, proximo: "retry", tentativa: tentativas });
      }
    }

  } catch (err) {
    console.error("[orchestrator] ERRO INESPERADO:", err.message, err.stack?.slice(0, 500));
  }
}

// ── START SERVER + CRON ───────────────────────────────────────────────────────

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Lab Runner rodando na porta ${PORT}`);
  console.log(`📦 Projetos em: ${BASE_PATH}`);
  console.log(`⏱️  Cron iniciando em 5s — intervalo: ${CRON_MS}ms`);
  setTimeout(() => {
    console.log("[cron] ✅ Loop interno iniciado");
    executarCiclo();
    setInterval(executarCiclo, CRON_MS);
  }, 5000);
});

server.on("error",               (err) => console.error("❌ Server error:", err));
process.on("uncaughtException",  (err) => console.error("❌ Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("❌ Rejection:", err));
