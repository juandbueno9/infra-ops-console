// Configuración → Seguridad del panel: los 20 controles de seguridad de una aplicación, aplicados a este panel.
import { useEffect, useState } from 'react';
import { DEMO } from '../config.js';
import { Badge, Panel } from './ui.jsx';

const ST = { ok: ['Aplicado', 'ok'], na: ['No aplica', 'off'], todo: ['Acción tuya', 'warn'], bad: ['Revisar', 'crit'] };

function controls(s) {
  const dep = (d) => (d ? d.critical + d.high : null);
  const depS = dep(s?.deps?.server), depW = dep(s?.deps?.web);
  return [
    ['Ocultar las claves API', 'ok', 'Tokens de FortiGate, AWS, Azure, Keycloak y SNMP solo en el .env del servidor; el navegador nunca los recibe (revisado: ninguno aparece en la página compilada).'],
    ['Eliminar secretos de Git', 'ok', 'El proyecto no está en Git; .gitignore excluye .env por si se sube después. Ningún secreto escrito en el código.'],
    ['Clave pública de base de datos', 'na', 'El panel no se conecta a bases de datos desde el navegador: todo pasa por el backend.'],
    ['Seguridad por filas (RLS)', 'ok', 'Equivalente aplicado: roles de Keycloak. ROLE_MONITOREO_USER solo ve; los cambios exigen ROLE_MONITOREO_ADMIN y se validan en el servidor.'],
    ['Cifrar datos sensibles', s?.envProtected === false ? 'bad' : 'ok', `Todo viaja por HTTPS. El .env con las credenciales ${s?.envProtected === false ? 'tiene permisos abiertos: revisar' : 'solo lo lee el servicio del panel (permisos 640)'}. Las contraseñas de usuarios están en Keycloak.`],
    ['Autenticación en el servidor', s?.auth === false ? 'bad' : 'ok', s?.auth === false ? 'Keycloak no está configurado en este servidor.' : 'Toda página y toda /api exige sesión de Keycloak validada en el servidor; la sesión se cierra a los 4 min sin uso.'],
    ['Restringir acceso a registros', 'ok', 'La auditoría solo la ven y exportan administradores. Cada consulta de logs queda auditada. nginx además limita por IP.'],
    ['Bloquear manipulación de campos', 'ok', 'Cada cambio acepta solo campos conocidos con valores permitidos (nombres, reglas de puertos, correos de alerta); cuerpo máximo 16 KB.'],
    ['Proteger cookies de sesión', 'ok', 'Cookie __Host-infra_sid: HttpOnly, Secure, SameSite=Lax, sin dominio; se renueva en cada inicio de sesión y se borra al salir.'],
    ['Contraseñas con hash', 'na', 'El panel no guarda contraseñas: las maneja Keycloak (con hash).'],
    ['Limitar intentos de inicio', 'todo', `El panel limita a ${s?.rate?.login ?? 20} inicios de sesión por minuto por IP. Falta activar en Keycloak: Realm settings → Security defenses → Brute force detection.`],
    ['Protección contra bots', 'ok', `Límite por IP: ${s?.rate?.api ?? 1500} consultas y ${s?.rate?.write ?? 60} cambios por minuto; nginx con lista de IP permitidas y fail2ban en el servidor.`],
    ['Monitorizar consultas', 'ok', 'Las consultas a Prometheus y Loki pasan por el backend, solo lectura, con tiempo máximo, tamaño máximo y auditoría.'],
    ['Validar todas las entradas', 'ok', 'Hosts, puertos, nombres, correos y consultas se validan con listas permitidas en el servidor antes de usarse.'],
    ['Escapar contenido del usuario', 'ok', 'React escapa todo lo que se muestra; las etiquetas 3D y los correos usan escape explícito. CSP bloquea scripts inyectados.'],
    ['Restringir subida de archivos', 'na', 'El panel no permite subir archivos.'],
    ['Limitar respuestas de la API', 'ok', 'Logs máximo 5.000 líneas por consulta, auditoría paginada, respuestas sin caché (no-store).'],
    ['Cabeceras de seguridad', 'ok', 'CSP estricta, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP y HSTS.'],
    ['Forzar HTTPS', s?.https === false ? 'bad' : 'ok', s?.https === false ? 'Esta conexión llegó por HTTP.' : 'nginx con certificado; el panel redirige cualquier HTTP a HTTPS y envía HSTS (1 año).'],
    ['Escanear dependencias', depS == null && depW == null ? 'todo' : (depS || depW) ? 'bad' : 'ok',
      depS == null && depW == null ? 'Se escanea en cada publicación (npm audit). Aún no hay resultado: publica una vez.' : `Último escaneo — servidor: ${depS ?? '—'} críticas/altas · página: ${depW ?? '—'} críticas/altas (solo dependencias que llegan a producción).`],
  ];
}

export function SecurityControls() {
  const [s, setS] = useState(DEMO ? { auth: true, https: true, envProtected: true, rate: { login: 20, api: 1500, write: 60 }, deps: { server: { critical: 0, high: 0 }, web: { critical: 0, high: 0 } } } : null);
  useEffect(() => { if (!DEMO) fetch('api/security', { cache: 'no-store' }).then((r) => r.json()).then(setS).catch(() => setS({})); }, []);
  const list = controls(s);
  const n = (k) => list.filter((c) => c[1] === k).length;
  return (
    <Panel title="Seguridad del panel (20 controles)" meta={`${n('ok')} aplicados · ${n('na')} no aplican · ${n('todo')} pendiente(s) tuyos · ${n('bad')} por revisar`} className="col-span-12" bodyClass="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th className="w-8">#</th><th>Control</th><th>Estado</th><th>Cómo está en este panel</th></tr></thead>
        <tbody>{list.map(([t, k, d], i) => (
          <tr key={t}><td className="text-faint">{i + 1}</td><td className="text-ink whitespace-nowrap">{t}</td><td><Badge tone={ST[k][1]}>{ST[k][0]}</Badge></td><td className="text-[12px] text-ink2">{d}</td></tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}
