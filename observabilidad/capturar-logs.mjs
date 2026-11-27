import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

// Guarda sólo campos acotados de los registros HTTP; no exporta rutas, IDs ni errores.
const archivo = join(dirname(fileURLToPath(import.meta.url)), 'logs', 'backend.log');
mkdirSync(dirname(archivo), { recursive: true });
const salida = createWriteStream(archivo, { flags: 'a', encoding: 'utf8' });
salida.on('error', (error) => {
  console.error('No se pudo escribir el archivo de observabilidad:', error.message);
  process.exitCode = 1;
  process.stdin.destroy();
});

const iniciarBackend = process.argv.includes('--iniciar-backend');
const backend = iniciarBackend ? spawn(process.execPath, ['src/servidor.js'], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..', 'viajes-backend'), stdio: ['inherit', 'pipe', 'inherit'] }) : null;
if (backend) {
  backend.on('error', (error) => { console.error('No se pudo iniciar el backend:', error.message); process.exitCode = 1; });
  backend.on('exit', (code, signal) => { if (code && !signal) process.exitCode = code; });
  process.on('SIGINT', () => { if (!backend.killed) backend.kill('SIGINT'); });
  process.on('SIGTERM', () => { if (!backend.killed) backend.kill('SIGTERM'); });
}
const lineas = createInterface({ input: backend ? backend.stdout : process.stdin, crlfDelay: Infinity });
lineas.on('line', (linea) => {
  let registro;
  try { registro = JSON.parse(linea); } catch { return; }
  if (registro.msg === 'servidor iniciado') console.log('Backend iniciado; capturando registros HTTP para Grafana.');
  if (registro.msg !== 'pedido http') return;
  const metodo = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(registro.metodo) ? registro.metodo : 'OTRO';
  if (!Number.isInteger(registro.status) || !Number.isFinite(registro.duracionMs)) return;
  const seguro = { time: registro.time, metodo, status: registro.status, duracionMs: registro.duracionMs, msg: 'pedido http' };
  const texto = JSON.stringify(seguro);
  salida.write(`${texto}\n`);
  console.log(texto);
});
lineas.on('close', () => salida.end());
