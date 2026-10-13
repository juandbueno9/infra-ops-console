# Conectar facturación de AWS y S3 al panel

El panel lee **solo** datos de facturación (Cost Explorer), el inventario de buckets de S3 y sus métricas de tamaño.
No puede leer ni modificar el contenido de los archivos, ni cambiar nada en la cuenta.

## 1. Política de permisos (solo lectura)

Consola de AWS → **IAM → Políticas → Crear política → JSON** → pega `deploy/aws/iam-facturacion.json`.
Nombre: `Monitoreo-Facturacion-SoloLectura`.

## 2. Usuario `Monitoreo-Facturacion`

**IAM → Usuarios → Crear usuario**
- Nombre: `Monitoreo-Facturacion`
- **No** marcar "Proporcionar acceso a la consola".
- Permisos → *Adjuntar políticas directamente* → `Monitoreo-Facturacion-SoloLectura`.

## 3. Clave de acceso

Usuario → **Credenciales de seguridad → Crear clave de acceso** → *Aplicación que se ejecuta fuera de AWS*.
Copia la clave y el secreto (el secreto solo se muestra una vez).

## 4. Configurar el servidor del panel

En `server/.env` (este archivo no se sube a git):

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

Instala el SDK y reinicia:

```
npm --prefix server install
npm run dev
```

## 5. Cost Explorer

Si nadie lo ha abierto antes en la cuenta: **Billing and Cost Management → Cost Explorer** (se activa al entrar).
La primera vez los datos pueden tardar hasta 24 horas.

## Costos y seguridad

- Cost Explorer cobra **USD 0,01 por consulta**. El panel hace 4 consultas (diario, 6 meses, detalle por tipo de uso y pronóstico)
  y guarda el resultado **8 horas** (memoria + `server/data/aws-cache.json`): alrededor de USD 3–5 al mes. "Actualizar" solo vuelve a consultar
  si los datos tienen más de 10 minutos.
- Las métricas de tamaño de S3 (CloudWatch `AWS/S3`, diarias) son gratuitas dentro de la capa gratuita de la API.
- Las claves quedan solo en el servidor; el navegador nunca las ve. Rota la clave cada 90 días (IAM → clave → *Crear* nueva, actualizar `.env`, *Desactivar* la anterior).
- En producción, si el panel corre en una EC2, es mejor usar el **rol de la instancia** con la misma política: quita las claves de `.env` y pon `AWS_USE_ROLE=1`.

## Pesos colombianos (COP)

El botón USD / COP convierte con la **TRM oficial** del día (Superintendencia Financiera, datos.gov.co); si no responde,
usa una tasa de mercado. AWS factura en dólares: el valor en pesos es aproximado (el banco aplica su propia tasa).

## ¿Qué atacar primero?

La sección **"¿Qué está cobrando más y dónde ahorrar?"** agrupa el gasto por *tipo de uso* (horas de servidor por tipo de instancia,
discos gp2, snapshots, IP públicas, S3 Estándar, logs…), explica cada uno en español, estima el ahorro posible y muestra alertas
(picos diarios, servicios que crecen más de 15% frente al mes anterior, servicios nuevos y pronóstico sobre el presupuesto).
Los ahorros son **estimados** para priorizar; confírmalos en la consola antes de cambiar algo.
