const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE_PATH = "C:/lab-ia-projects";

function run(cmd, cwd = process.cwd()) {
  console.log(">>", cmd);
  execSync(cmd, { stdio: "inherit", cwd });
}

function criarProjeto(nome) {
  const projetoPath = path.join(BASE_PATH, nome);

  if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH);
  }

  if (fs.existsSync(projetoPath)) {
    console.log("Projeto já existe:", nome);
    return projetoPath;
  }

  console.log("Criando projeto React com Vite...");

  run(`npm create vite@latest ${nome} -- --template react`, BASE_PATH);

  console.log("Instalando dependências...");
  run(`npm install`, projetoPath);

  return projetoPath;
}

function rodarProjeto(projetoPath) {
  console.log("Iniciando servidor...");
  run(`npm run dev`, projetoPath);
}

function abrirNavegador() {
  const url = "http://localhost:5173";
  console.log("Abrindo navegador...");

  if (process.platform === "win32") {
    execSync(`start ${url}`);
  } else {
    execSync(`open ${url}`);
  }
}

// 🔥 EXECUÇÃO
const nomeProjeto = "projeto-" + Date.now();

const pathProjeto = criarProjeto(nomeProjeto);

// pequena espera para garantir build
setTimeout(() => {
  abrirNavegador();
  rodarProjeto(pathProjeto);
}, 2000);