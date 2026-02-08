#!/bin/bash
# Run this ON the DigitalOcean droplet (159.89.157.120)
# SSH in first: ssh root@159.89.157.120

apt update
apt install -y mosh tmux
ufw allow 60000:61000/udp

echo "Done! mosh and tmux installed."
