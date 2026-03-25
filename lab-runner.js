const express = require("express");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const BASE_PATH = "C:/Users/Renato/Desktop/lab-ia-workspace/projetos";

// =========================
// UTIL
// =========================
function run(cmd, cwd = process.cwd()) {
  console.log(">>", cmd);
  execSync(cmd, { stdio: "inherit", cwd });
}

// =========================
// CRIAR PROJETO
// =========================
function criarProjeto(nome) {
  const projetoPath = path.join(BASE_PATH, nome);

  if (!fs.existsSync(projetoPath)) {
    console.log("Criando projeto React...");

    run(`npm create vite@latest ${nome} -- --template react --yes`, BASE_PATH);
    run("npm install", projetoPath);
  }

  return projetoPath;
}

// =========================
// LIMPAR CODIGO
// =========================
function limparCodigo(codigo) {
  return codigo
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}

// =========================
// APLICAR ARQUIVOS
// =========================
function aplicarArquivos(projetoPath, arquivos) {
  arquivos.forEach((file) => {
    const fullPath = path.join(projetoPath, file.caminho);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const codigoLimpo = limparCodigo(file.codigo);

    console.log("Aplicando:", file.caminho);
    console.log("----");
    console.log(codigoLimpo.substring(0, 200));
    console.log("----");

    fs.writeFileSync(fullPath, codigoLimpo, "utf-8");

    console.log("OK:", file.caminho);
  });
}

// =========================
// RODAR PROJETO
// =========================
function rodarProjeto(projetoPath) {
  console.log("Iniciando projeto...");

  spawn("npm", ["run", "dev"], {
    cwd: projetoPath,
    stdio: "inherit",
    shell: true,
  });
}

// =========================
// ENDPOINT
// =========================
app.post("/executar", (req, res) => {
  const { nomeProjeto, arquivos } = req.body || {};

  if (!nomeProjeto || !Array.isArray(arquivos)) {
    return res.status(400).json({
      error: "payload invalido: nomeProjeto e arquivos[] sao obrigatorios",
    });
  }

  console.log("Recebido:", JSON.stringify(req.body));

  // Responde imediatamente para nao bloquear o caller.
  res.status(202).json({ ok: true, delegado: true });

  // Continua o processamento em background.
  setImmediate(() => {
    try {
      const projetoPath = criarProjeto(nomeProjeto);
      aplicarArquivos(projetoPath, arquivos);
      rodarProjeto(projetoPath);
    } catch (err) {
      console.error("Erro na execucao em background:", err);
    }
  });
});

// =========================
// START
// =========================
app.listen(3333, () => {
  console.log("Lab Runner rodando em http://localhost:3333");
});
