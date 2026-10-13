/* =====================================================================
   CONFIGURACIÓN DEL PANEL — edita aquí
   ===================================================================== */

export const DEMO = import.meta.env.MODE === 'demo' || new URLSearchParams(location.search).has('demo');
/** Frecuencia de actualización por defecto (segundos) y opciones del selector. 0 = pausado. */
export const REFRESH_S = 10;
export const REFRESH_OPTIONS = [5, 10, 30, 60, 0];

/** Rangos de las gráficas: minutos, paso en segundos y ventana de rate() de Prometheus. */
export const RANGES = {
  '15m': { label: '15 min', mins: 15, step: 15, win: '1m' },
  '1h': { label: '1 h', mins: 60, step: 15, win: '1m' },
  '6h': { label: '6 h', mins: 360, step: 90, win: '5m' },
  '24h': { label: '24 h', mins: 1440, step: 300, win: '5m' },
};
export const DEFAULT_RANGE = '1h';

/** Jobs de Prometheus que corresponden a node_exporter. */
export const NODE_JOBS = 'node_exporter|ec2_nodes|node|azure_nodes';

/**
 * Política de puertos PÚBLICOS (escuchan en 0.0.0.0), según el Security Group de AWS:
 *   allowed  = abierto a internet a propósito
 *   office   = solo desde la IP de la oficina
 *   sg       = cerrado en el Security Group
 *   critical = no debería estar expuesto
 * Lo que no esté aquí se marca como "Revisar".
 */
export const PORT_POLICY = {
  22: 'allowed', 80: 'allowed', 443: 'allowed',
  3306: 'critical', 5432: 'critical', 1433: 'critical', 27017: 'critical', 6379: 'critical', 9200: 'critical', 11211: 'critical',
};

/** Reglas por servidor (cada uno tiene su propio Security Group). */
export const PORT_POLICY_BY_SERVER = {
  'app-server': {
    1433: 'office', 3000: 'office', 3306: 'office', 8013: 'office', 8015: 'office', 8444: 'office', 8445: 'office',
    3012: 'sg', 8097: 'sg', 14001: 'sg', 14002: 'sg', 18080: 'sg', 18443: 'sg', 18843: 'sg', 18871: 'sg', 20443: 'sg', 60000: 'sg',
  },
  // 'core-database': { 3306: 'office' },
};

export const PORT_NAMES = {
  22: 'SSH', 53: 'DNS', 80: 'HTTP', 443: 'HTTPS', 1433: 'MSSQL', 3000: 'App', 3001: 'Grafana', 3306: 'MySQL', 33060: 'MySQL X',
  5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP alt', 9090: 'Prometheus', 9093: 'Alertmanager', 9100: 'node_exporter', 9115: 'Blackbox', 27017: 'MongoDB',
};

export const SVC_DESC = {
  nginx: 'Servidor web', apache2: 'Servidor web', docker: 'Contenedores', mysql: 'Base de datos', mariadb: 'Base de datos',
  postgresql: 'Base de datos', 'php8.3-fpm': 'PHP-FPM', 'php8.2-fpm': 'PHP-FPM', 'php8.1-fpm': 'PHP-FPM', 'pm2-ubuntu': 'Procesos Node.js',
  tomcat9: 'Java / Tomcat', tomcat10: 'Java / Tomcat', 'redis-server': 'Caché', mongod: 'Base de datos',
};

/** IPs de confianza para sesiones/accesos SSH. Las redes privadas se consideran internas. */
// 172.0.10.0/24 es la red de Azure (llega por la VPN AWS↔Azure)
export const KNOWN_IPS = { '203.0.113.10': 'Oficina principal', '172.0.10.20': 'Azure · active-directory', '172.0.10.30': 'Azure · applications' };

/** Intervalo de las sondas Blackbox (scrape_interval del job blackbox_http). */
export const PROBE_INTERVAL_S = 15;

export const SSL_WARN_DAYS = 21;
export const SSL_BAD_DAYS = 7;
