// scripts/record-fixtures.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadChargers } from '../src/registry.js';

// Reuses the server's own configuration so there is a single way to point at
// a charger. Records from the first one when several are configured.
const HOST = Object.values(loadChargers(process.env))[0];
const OUT = 'tests/fixtures';

const ENDPOINTS: Array<[name: string, path: string]> = [
  ['device', '/device'],
  ['elements-cfg', '/elements?level=cfg'],
  ['evsm-elements', '/modules/evsm/elements'],
  ['modulator-stat', '/modules/modulator?level=stat'],
  ['modulator-cfg', '/modules/modulator?level=cfg'],
  ['modulator-historic', '/modules/modulator/historic'],
  ['scheduler-cfg', '/modules/scheduler/elements?level=cfg'],
  ['solar-cfg', '/modules/solar?level=cfg'],
  ['spl-cfg', '/modules/spl?level=cfg'],
  ['hmi-cfg', '/modules/hmi?level=cfg'],
  ['modbus-cfg', '/modules/modbus?level=cfg'],
  ['ocpp-all', '/modules/ocpp?level=all'],
  ['mqtt-stat', '/modules/mqtt?level=stat'],
];

function fetchOnce(path: string): string {
  // il device è fragile: fino a 6 tentativi
  for (let i = 0; i < 6; i++) {
    try {
      const body = execFileSync(
        'curl',
        ['-s', '-m', '20', '--http1.0', `http://${HOST}${path}`],
        { encoding: 'utf8' },
      );
      if (body.length > 0) return body;
    } catch { /* riprova */ }
  }
  throw new Error(`nessuna risposta da ${path} dopo 6 tentativi`);
}

mkdirSync(OUT, { recursive: true });
for (const [name, path] of ENDPOINTS) {
  const body = fetchOnce(path);
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ status: 200, body }, null, 2));
  console.log(`${name}: ${body.length} byte`);
}
