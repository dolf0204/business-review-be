#!/usr/bin/env sh
# One-time preparation of a fresh Ubuntu 24.04 server. Run as root:  sh setup-server.sh
# NOT TESTED on a real server yet. Read it before running it.
set -eu
[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }

apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades

# Docker from Docker's own apt repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Firewall: only SSH and the web. The database and Redis are never reachable from outside.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Some swap so a build cannot run the server out of memory.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

systemctl enable --now fail2ban unattended-upgrades
mkdir -p /opt/businessask
echo "Done. Next: clone the two repositories into /opt/businessask and follow deploy/README.md."
