const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const isDev = process.argv.includes('--dev');
if (isDev) {
  env.VITE_DEV_SERVER = 'true';
}

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error('Falha ao iniciar o Electron:', err);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code || 0);
});

