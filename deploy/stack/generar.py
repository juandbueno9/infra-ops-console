#!/usr/bin/env python3
"""Generadores del instalador del stack la empresa (sin dependencias externas).

  compose   <ctx.json>                 → imprime docker-compose.infra.yml
  prom      <prometheus.yml> <ctx.json> → imprime prometheus.yml con reglas/alerting/jobs agregados
  envfile   <.env> <archivo_principal>  → imprime .env con COMPOSE_FILE que incluye el archivo infra

Nunca borra nada existente: solo agrega lo que falta.
"""
import json
import re
import sys


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


# ---------------------------------------------------------------- compose
def compose(ctx):
    net = ctx["net_key"]
    gw = ctx["gw"]
    out = [
        "# =====================================================================",
        "#  Infra Ops · servicios agregados por instalar-stack.sh",
        "#  Archivo aparte: docker-compose.yml original NO se modifica.",
        "#  Docker lo carga por COMPOSE_FILE en .env. Para quitar todo:",
        "#    docker compose rm -sf " + " ".join(ctx["new_services"]),
        "#    y borrar la línea COMPOSE_FILE de .env",
        "# =====================================================================",
        "services:",
        "  loki:",
        "    image: grafana/loki:3.1.1",
        "    container_name: infra-loki",
        "    restart: unless-stopped",
        "    command: [\"-config.file=/etc/loki/infra.yml\"]",
        "    volumes:",
        f"      - {ctx['infra_dir']}/loki.yml:/etc/loki/infra.yml:ro",
        "      - infra_loki_data:/loki",
        "    ports: [\"127.0.0.1:3100:3100\"]",
        f"    networks: [{net}]",
        "  promtail:",
        "    image: grafana/promtail:3.1.1",
        "    container_name: infra-promtail",
        "    restart: unless-stopped",
        "    command: [\"-config.file=/etc/promtail/infra.yml\"]",
        "    volumes:",
        f"      - {ctx['infra_dir']}/promtail.yml:/etc/promtail/infra.yml:ro",
        "      - /var/log:/var/log:ro",
        "      - /var/run/docker.sock:/var/run/docker.sock:ro",
        "      - infra_promtail_positions:/positions",
        "    depends_on: [loki]",
        f"    networks: [{net}]",
    ]
    if ctx.get("add_alertmanager"):
        out += [
            "  infra-alertmanager:",
            "    image: prom/alertmanager:v0.27.0",
            "    container_name: infra-alertmanager",
            "    restart: unless-stopped",
            "    command: [\"--config.file=/etc/alertmanager/infra.yml\", \"--storage.path=/alertmanager\"]",
            "    volumes:",
            f"      - {ctx['infra_dir']}/alertmanager.yml:/etc/alertmanager/infra.yml:ro",
            "      - infra_alertmanager_data:/alertmanager",
            "    ports: [\"127.0.0.1:9093:9093\"]",
            f"    networks: [{net}]",
        ]
    if ctx.get("prom_override"):
        po = ctx["prom_override"]
        out += [f"  {ctx['prom_svc']}:"]
        if po.get("command"):
            out += ["    command:"] + [f"      - {q(a)}" for a in po["command"]]
        if po.get("volumes"):
            out += ["    volumes:"] + [f"      - {v}" for v in po["volumes"]]
    feats = set(ctx.get("features", []))
    if "mysql" in feats:
        out += [
            "  infra-mysqld-exporter:",
            "    image: prom/mysqld-exporter:v0.15.1",
            "    container_name: infra-mysqld-exporter",
            "    restart: unless-stopped",
            "    network_mode: host",
            f"    env_file: [{ctx['infra_dir']}/bd.env]",
            "    command:",
            "      - '--mysqld.address=127.0.0.1:3306'",
            "      - '--mysqld.username=infra_monitor'",
            f"      - '--web.listen-address={gw}:9104'",
        ]
    if "postgres" in feats:
        out += [
            "  infra-postgres-exporter:",
            "    image: prometheuscommunity/postgres-exporter:v0.15.0",
            "    container_name: infra-postgres-exporter",
            "    restart: unless-stopped",
            "    network_mode: host",
            f"    env_file: [{ctx['infra_dir']}/bd.env]",
            "    command:",
            f"      - '--web.listen-address={gw}:9187'",
        ]
    if "mssql" in feats:
        out += [
            "  infra-mssql-exporter:",
            "    image: awaragi/prometheus-mssql-exporter:v1.3.0",
            "    container_name: infra-mssql-exporter",
            "    restart: unless-stopped",
            f"    env_file: [{ctx['infra_dir']}/bd.env]",
            "    environment: { EXPOSE: '4000' }",
            "    extra_hosts: ['host.docker.internal:host-gateway']",
            f"    networks: [{net}]",
        ]
    if "aws" in feats:
        out += [
            "  infra-cloudwatch:",
            "    image: ghcr.io/nerdswords/yet-another-cloudwatch-exporter:v0.61.2",
            "    container_name: infra-cloudwatch",
            "    restart: unless-stopped",
            "    command: [\"-config.file=/config/yace.yml\", \"-listen-address=:5000\"]",
            "    volumes:",
            f"      - {ctx['infra_dir']}/yace.yml:/config/yace.yml:ro",
            f"    networks: [{net}]",
        ]
    out += ["", "volumes:", "  infra_loki_data:", "  infra_promtail_positions:"]
    if ctx.get("add_alertmanager"):
        out += ["  infra_alertmanager_data:"]
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- prometheus.yml
RELABEL_NONE = ""


def job_blocks(ctx):
    feats = set(ctx.get("features", []))
    gw, host = ctx["gw"], ctx["hostname"]
    jobs = []
    if not has_job(ctx["_prom"], "infra-loki"):
        jobs.append(f"""
  # Infra Ops · salud de Loki y Promtail
  - job_name: 'infra-loki'
    static_configs:
      - targets: ['loki:3100', 'promtail:9080']
""")
    if ctx.get("add_alertmanager") and not has_job(ctx["_prom"], "infra-alertmanager"):
        jobs.append("""
  - job_name: 'infra-alertmanager'
    static_configs:
      - targets: ['infra-alertmanager:9093']
""")
    if "mysql" in feats and not has_job(ctx["_prom"], "infra-mysql"):
        jobs.append(f"""
  # Infra Ops · MySQL (usuario de solo lectura infra_monitor)
  - job_name: 'infra-mysql'
    static_configs:
      - targets: ['{gw}:9104']
        labels: {{ servidor: {q(host)}, motor: 'mysql' }}
""")
    if "postgres" in feats and not has_job(ctx["_prom"], "infra-postgres"):
        jobs.append(f"""
  # Infra Ops · PostgreSQL (rol pg_monitor)
  - job_name: 'infra-postgres'
    static_configs:
      - targets: ['{gw}:9187']
        labels: {{ servidor: {q(host)}, motor: 'postgresql' }}
""")
    if "mssql" in feats and not has_job(ctx["_prom"], "infra-mssql"):
        jobs.append(f"""
  # Infra Ops · SQL Server
  - job_name: 'infra-mssql'
    static_configs:
      - targets: ['infra-mssql-exporter:4000']
        labels: {{ servidor: {q(host)}, motor: 'sqlserver' }}
""")
    if "aws" in feats and not has_job(ctx["_prom"], "infra-cloudwatch"):
        jobs.append("""
  # Infra Ops · AWS CloudWatch (EC2, EBS, facturación)
  - job_name: 'infra-cloudwatch'
    scrape_interval: 5m
    scrape_timeout: 2m
    static_configs:
      - targets: ['infra-cloudwatch:5000']
""")
    if "ec2" in feats and not has_job(ctx["_prom"], "ec2_nodes"):
        jobs.append("""
  # Infra Ops · servidores EC2 con la etiqueta monitoreo=si (descubrimiento automático)
  - job_name: 'ec2_nodes'
    ec2_sd_configs:
      - region: us-east-1
        port: 9100
        filters:
          - name: tag:monitoreo
            values: [si]
          - name: instance-state-name
            values: [running]
    relabel_configs:
      - source_labels: [__meta_ec2_private_ip]
        target_label: __address__
        replacement: '${1}:9100'
      - source_labels: [__meta_ec2_tag_Name]
        target_label: instance
      - source_labels: [__meta_ec2_instance_id]
        target_label: instance_id
""")
    return "".join(jobs)


def has_job(prom, name):
    return re.search(r"job_name:\s*['\"]?" + re.escape(name) + r"['\"]?\s*$", prom, re.M) is not None


def insert_jobs(text, jobs):
    if not jobs.strip():
        return text
    L = text.rstrip("\n").split("\n")
    s = next(k for k, l in enumerate(L) if re.match(r"^scrape_configs:", l))
    e = next((k for k in range(s + 1, len(L)) if re.match(r"^[A-Za-z_]", L[k])), len(L))
    while e - 1 > s and (L[e - 1].strip() == "" or L[e - 1].startswith("#")):
        e -= 1
    m = next((re.match(r"^(\s*)- ", L[k]) for k in range(s + 1, e) if re.match(r"^\s*- ", L[k])), None)
    ind = m.group(1) if m else "  "
    J = jobs.rstrip("\n").split("\n")
    J = [(ind + l[2:]) if l.startswith("  ") else l for l in J]
    return "\n".join(L[:e] + J + L[e:]) + "\n"


def prom(text, ctx):
    ctx = dict(ctx, _prom=text)
    rules = ctx["rules_path"]
    # rule_files
    if not re.search(r"^rule_files:", text, re.M):
        text = text.rstrip("\n") + f"\n\nrule_files:\n  - {rules}\n"
    elif rules not in text:
        L = text.split("\n")
        i = next(k for k, l in enumerate(L) if re.match(r"^rule_files:", l))
        if L[i].strip() in ("rule_files: []", "rule_files: null"):
            L[i] = "rule_files:"
        nxt = next((l for l in L[i + 1:] if l.strip()), "")
        ind = re.match(r"^(\s*)", nxt).group(1) if nxt.lstrip().startswith("-") else "  "
        L.insert(i + 1, f"{ind}- {rules}")
        text = "\n".join(L)
    # alerting (solo si no existe)
    if not re.search(r"^alerting:", text, re.M):
        text = text.rstrip("\n") + f"\n\nalerting:\n  alertmanagers:\n    - static_configs:\n        - targets: ['{ctx['am_target']}']\n"
    # Sin avisos: las alertas de las reglas infra no se envían a un Alertmanager que ya tiene canales
    if ctx.get("silence_notifications") and not re.search(r"regex:\s*['\"]?infra['\"]?\s*$", text, re.M):
        L = text.split("\n")
        i = next((k for k, l in enumerate(L) if re.match(r"^alerting:", l)), None)
        if i is not None:
            nxt = next((l for l in L[i + 1:] if l.strip() and not l.lstrip().startswith("#")), "  x")
            ind = re.match(r"^(\s*)", nxt).group(1) or "  "
            j = next((k for k in range(i + 1, len(L)) if re.match(r"^\s*alert_relabel_configs:", L[k])), None)
            if j is not None:
                it = next((re.match(r"^(\s*)-", l).group(1) for l in L[j + 1:] if l.lstrip().startswith("-")), ind + "  ")
                block = [f"{it}- source_labels: [origen]", f"{it}  regex: infra", f"{it}  action: drop"]
                L[j + 1:j + 1] = block
            else:
                block = [f"{ind}# la empresa: las reglas infra se ven en el panel pero NO se envían (hasta configurar avisos)",
                         f"{ind}alert_relabel_configs:", f"{ind}  - source_labels: [origen]", f"{ind}    regex: infra", f"{ind}    action: drop"]
                L[i + 1:i + 1] = block
            text = "\n".join(L)
    return insert_jobs(text, job_blocks(ctx))


# ---------------------------------------------------------------- .env
def envfile(text, main_name):
    L = text.split("\n") if text else []
    for k, l in enumerate(L):
        m = re.match(r"^\s*COMPOSE_FILE\s*=\s*(.*)$", l)
        if m:
            files = [f for f in re.split(r"[:,]", m.group(1).strip().strip("'\"")) if f]
            if "docker-compose.infra.yml" not in files:
                files.append("docker-compose.infra.yml")
            L[k] = "COMPOSE_FILE=" + ":".join(files)
            return "\n".join(L).rstrip("\n") + "\n"
    body = "\n".join(L).rstrip("\n")
    add = f"# la empresa: carga también los servicios de monitoreo (docker-compose.infra.yml)\nCOMPOSE_FILE={main_name}:docker-compose.infra.yml\n"
    return (body + "\n\n" if body else "") + add


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "compose":
        sys.stdout.write(compose(json.load(open(sys.argv[2]))))
    elif cmd == "prom":
        sys.stdout.write(prom(open(sys.argv[2]).read(), json.load(open(sys.argv[3]))))
    elif cmd == "envfile":
        try:
            t = open(sys.argv[2]).read()
        except FileNotFoundError:
            t = ""
        sys.stdout.write(envfile(t, sys.argv[3]))
    else:
        sys.exit("uso: generar.py compose|prom|envfile ...")
