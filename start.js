require('dotenv').config();
const { spawn } = require('child_process');

// Inicia o runner (servidor HTTP na porta 3333)
const runner = spawn('node', ['lab-runner.js'], {
  stdio: 'inherit',
  env: process.env
});

runner.on('error', (err) => {
  console.error('[start] Erro ao iniciar runner:', err.message);
  process.exit(1);
});

runner.on('exit', (code) => {
  console.error('[start] Runner encerrou com código:', code);
  process.exit(code || 1);
});

// Aguarda 3s para o runner subir antes do cron
setTimeout(() => {
  const cron = spawn('node', ['cron.js'], {
    stdio: 'inherit',
    env: process.env
  });

  cron.on('error', (err) => {
    console.error('[start] Erro ao iniciar cron:', err.message);
  });

  cron.on('exit', (code) => {
    console.error('[start] Cron encerrou com código:', code);
  });

  console.log('[start] ✅ Runner + Cron iniciados');
}, 3000);

process.on('SIGTERM', () => {
  console.log('[start] SIGTERM — encerrando...');
  runner.kill('SIGTERM');
  process.exit(0);
});
