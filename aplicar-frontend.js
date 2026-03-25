const fs = require("fs");
const path = require("path");

const BASE_PATH = "C:/lab-ia-projects";

// pega o último projeto criado
function getUltimoProjeto() {
  const projetos = fs.readdirSync(BASE_PATH);
  return projetos.sort().pop();
}

function aplicarCodigo(codigo) {
  const projeto = getUltimoProjeto();
  const appPath = path.join(BASE_PATH, projeto, "src", "App.jsx");

  if (!fs.existsSync(appPath)) {
    console.log("App.jsx não encontrado");
    return;
  }

  // backup
  fs.copyFileSync(appPath, appPath + ".bak");

  // escreve novo código
  fs.writeFileSync(appPath, codigo);

  console.log("✅ App.jsx atualizado com sucesso");
}

// 🔥 entrada manual (depois vira IA)
const codigo = `
export default function App() {
  return (
    <div style={{ padding: 40 }}>
      <h1>🔥 Sistema gerado pela IA</h1>
      <p>Frontend atualizado automaticamente</p>
    </div>
  );
}
`;

aplicarCodigo(codigo);