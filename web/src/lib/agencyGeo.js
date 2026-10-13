// Ubicación de la sede y las 16 agencias (datos de EJEMPLO para el modo demo; reemplázalos por tus sedes reales).
// Edita aquí si abren/cierran agencias o para afinar la posición. La IP debe coincidir con deploy/agencias.csv.
export const HUB_IP = '192.168.10.254'; // Bogotá Principal = sede principal (FortiGate / fin del túnel VPN-AWS)

// pub = IP pública del Internet de la agencia (tabla del proveedor del FortiGate)
export const AGENCY_GEO = [
  { ip: '192.168.10.254', name: 'Bogotá Principal', city: 'Bogotá', lat: 4.711, lon: -74.0721, hub: true },
  { ip: '192.168.11.254', name: 'Medellín', pub: '203.0.113.26', city: 'Medellín', lat: 6.2442, lon: -75.5812 },
  { ip: '192.168.12.254', name: 'Barranquilla', pub: '203.0.113.27', city: 'Barranquilla', lat: 10.9685, lon: -74.7813 },
  { ip: '192.168.13.254', name: 'Cartagena', pub: '203.0.113.28', city: 'Cartagena', lat: 10.391, lon: -75.4794 },
  { ip: '192.168.14.254', name: 'Bucaramanga', pub: '203.0.113.29', city: 'Bucaramanga', lat: 7.1193, lon: -73.1227 },
  { ip: '192.168.15.254', name: 'Cúcuta', pub: '203.0.113.30', city: 'Cúcuta', lat: 7.8939, lon: -72.5078 },
  { ip: '192.168.16.254', name: 'Santa Marta', pub: '203.0.113.31', city: 'Santa Marta', lat: 11.2408, lon: -74.199 },
  { ip: '192.168.17.254', name: 'Usaquén', pub: '203.0.113.32', city: 'Bogotá', lat: 4.6949, lon: -74.0306 },
  { ip: '192.168.18.254', name: 'Villavicencio', pub: '203.0.113.33', city: 'Villavicencio', lat: 4.142, lon: -73.6266 },
  { ip: '192.168.19.254', name: 'Neiva', pub: '203.0.113.34', city: 'Neiva', lat: 2.9273, lon: -75.2819 },
  { ip: '192.168.20.254', name: 'Pasto', pub: '203.0.113.35', city: 'Pasto', lat: 1.2136, lon: -77.2811 },
  { ip: '192.168.21.254', name: 'Montería', pub: '203.0.113.36', city: 'Montería', lat: 8.7479, lon: -75.8814 },
  { ip: '192.168.22.254', name: 'Tunja', pub: '203.0.113.37', city: 'Tunja', lat: 5.5353, lon: -73.3678 },
  { ip: '192.168.23.254', name: 'Valledupar', pub: '203.0.113.38', city: 'Valledupar', lat: 10.4631, lon: -73.2532 },
  { ip: '192.168.24.254', name: 'Sincelejo', pub: '203.0.113.39', city: 'Sincelejo', lat: 9.3047, lon: -75.3978 },
  { ip: '192.168.25.254', name: 'Yopal', pub: '203.0.113.40', city: 'Yopal', lat: 5.3378, lon: -72.3959 },
];

/** Región AWS donde corre el monitoreo (fuera del mapa: se dibuja el enlace saliendo hacia el norte). */
export const AWS_SITE = { name: 'AWS us-east-1', city: 'N. Virginia', lat: 39.04, lon: -77.49 };

export function kmBetween(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
