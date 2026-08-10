#!/usr/bin/env bash
# wg-agent installer for a fresh Ubuntu 24.04 Hetzner Cloud VPS.
# Usage (as root):
#   AGENT_TOKEN is NOT generated here — the Worker derives it from the endpoint
#   code, so a random one would be rejected. Add the endpoint in the admin
#   console and copy the token it shows, or GET /admin/endpoints/<CODE>/token.
#   AGENT_TOKEN="<from the console>" \
#   WG_ENDPOINT="paris.yourvpn.com:51820" \
#   API_DOMAIN="paris-api.yourvpn.com" \
#   bash install.sh
set -euo pipefail

: "${AGENT_TOKEN:?Set AGENT_TOKEN (copy it from the admin console)}"
: "${WG_ENDPOINT:?Set WG_ENDPOINT e.g. paris.yourvpn.com:51820}"
: "${API_DOMAIN:?Set API_DOMAIN e.g. paris-api.yourvpn.com}"

WG_IFACE="${WG_INTERFACE:-wg0}"
WG_PORT="${WG_ENDPOINT##*:}"
WG_SUBNET="${WG_SUBNET:-10.8.0.0/24}"
SERVER_ADDR="${WG_SUBNET%.*/*}.1/24"   # 10.8.0.0/24 -> 10.8.0.1/24
EGRESS_IF=$(ip route show default | awk '{print $5; exit}')

echo "==> Installing packages"
apt-get update -qq
apt-get install -y -qq wireguard qrencode curl ca-certificates gnupg nodejs

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
    > /etc/apt/sources.list.d/caddy.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "==> Configuring WireGuard interface ${WG_IFACE}"
umask 077
mkdir -p /etc/wireguard
if [ ! -f "/etc/wireguard/${WG_IFACE}.conf" ]; then
  SERVER_PRIV=$(wg genkey)
  cat > "/etc/wireguard/${WG_IFACE}.conf" <<EOF
[Interface]
PrivateKey = ${SERVER_PRIV}
Address = ${SERVER_ADDR}
ListenPort = ${WG_PORT}
SaveConfig = false
PostUp = iptables -t nat -A POSTROUTING -s ${WG_SUBNET} -o ${EGRESS_IF} -j MASQUERADE; iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s ${WG_SUBNET} -o ${EGRESS_IF} -j MASQUERADE; iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT
EOF
fi

echo "==> Enabling IP forwarding"
cat > /etc/sysctl.d/99-wg-forward.conf <<EOF
net.ipv4.ip_forward=1
EOF
sysctl --system >/dev/null

systemctl enable --now "wg-quick@${WG_IFACE}"

echo "==> Installing wg-agent"
mkdir -p /opt/wg-agent /var/lib/wg-agent
cp "$(dirname "$0")/agent.js" /opt/wg-agent/agent.js

cat > /etc/wg-agent.env <<EOF
AGENT_TOKEN=${AGENT_TOKEN}
WG_INTERFACE=${WG_IFACE}
WG_ENDPOINT=${WG_ENDPOINT}
WG_SUBNET=${WG_SUBNET}
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8100
EOF
chmod 600 /etc/wg-agent.env

cat > /etc/systemd/system/wg-agent.service <<'EOF'
[Unit]
Description=WireGuard provisioning agent
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
EnvironmentFile=/etc/wg-agent.env
ExecStart=/usr/bin/node /opt/wg-agent/agent.js
Restart=always
RestartSec=2
# Agent needs to run wg/wg-quick (root). Hardened where possible:
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now wg-agent

echo "==> Configuring Caddy TLS reverse proxy for ${API_DOMAIN}"
cat > /etc/caddy/Caddyfile <<EOF
${API_DOMAIN} {
    reverse_proxy 127.0.0.1:8100
}
EOF
systemctl restart caddy

echo "==> Basic firewall (ufw)"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null || true
  ufw allow 80/tcp >/dev/null || true       # Caddy ACME
  ufw allow 443/tcp >/dev/null || true      # agent API (TLS)
  ufw allow "${WG_PORT}/udp" >/dev/null || true
  ufw --force enable >/dev/null || true
fi

echo
echo "Done."
echo "  WireGuard:  ${WG_IFACE} on udp/${WG_PORT}, subnet ${WG_SUBNET}"
echo "  Agent API:  https://${API_DOMAIN}  (Bearer token in /etc/wg-agent.env)"
echo "  Test:       curl -H \"Authorization: Bearer \$AGENT_TOKEN\" https://${API_DOMAIN}/health"
