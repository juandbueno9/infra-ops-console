import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 4000,
  host: process.env.HOST || '127.0.0.1',
  promUrl: (process.env.PROM_URL || 'http://127.0.0.1:9090').replace(/\/$/, ''),
  lokiUrl: (process.env.LOKI_URL || 'http://127.0.0.1:3100').replace(/\/$/, ''),
  dataDir: path.resolve(here, '..', process.env.DATA_DIR || 'data'),
  userHeader: (process.env.USER_HEADER || '').toLowerCase(),
  // Grafana para identificar al usuario por su sesión (producción). Vacío en desarrollo.
  grafanaUrl: (process.env.GRAFANA_URL || '').replace(/\/$/, ''),
  webDist: path.resolve(here, '..', '..', 'web', 'dist'),
  production: process.env.NODE_ENV === 'production',
};
