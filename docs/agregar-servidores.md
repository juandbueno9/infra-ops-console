# Agregar los demás servidores al monitoreo

Todo es de **solo lectura**: el rol IAM solo permite *listar* instancias y *leer* CloudWatch.

## 1. Rol IAM para el servidor de monitoreo (una sola vez)

1. AWS → IAM → Políticas → Crear política → pestaña JSON → pega `deploy/stack/iam-monitoreo.json` → nombre `infra-ops-console-lectura`.
2. IAM → Roles → Crear rol → Servicio AWS → EC2 → adjunta `infra-ops-console-lectura` → nombre `infra-ops-console`.
3. EC2 → Instancias → `app-server` → Acciones → Seguridad → Modificar rol de IAM → `infra-ops-console`.
   (Si la instancia ya tiene un rol, agrega la política a ese rol en vez de cambiarlo.)

## 2. Security Group

En el Security Group de **cada servidor nuevo**, regla de entrada:

| Tipo | Puerto | Origen |
|---|---|---|
| TCP personalizado | 9100 | `172.31.33.88/32` (IP privada de app-server) |

Nunca abras 9100 a 0.0.0.0/0.

## 3. En cada servidor nuevo

```
scp ~/Documents/infra-ops-console/agent/infra-agent-install.sh SERVIDOR:/tmp/
ssh SERVIDOR
sudo bash /tmp/infra-agent-install.sh
sudo bash /tmp/infra-agent-install.sh --trivy
```

El primero instala node_exporter (escucha solo en la IP privada) y las métricas infra.
El segundo agrega el escaneo semanal de vulnerabilidades (solo si el servidor tiene Docker).

## 4. Etiqueta en AWS

EC2 → la instancia → Etiquetas → agregar `monitoreo` = `si`.

## 5. Activar el descubrimiento (una sola vez, en app-server)

```
sudo bash /tmp/infra-stack/instalar-stack.sh --ec2
```

A partir de ahí, **cualquier servidor con la etiqueta `monitoreo=si` aparece solo** en el panel en ~1 minuto.
Para retirarlo: quita la etiqueta y ejecuta `--uninstall` del agente.

## Opcional: CloudWatch (créditos de CPU, discos EBS, facturación)

Con el mismo rol:

```
sudo bash /tmp/infra-stack/instalar-stack.sh --aws
```

La facturación (`EstimatedCharges`) requiere activar «Recibir alertas de facturación» en
Billing → Preferencias de facturación, y solo existe en us-east-1.
