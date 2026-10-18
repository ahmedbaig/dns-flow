export const CAPTURED = 'example';

export const CLIENTS = [
  { name: 'Alex iPhone', vendor: 'Apple, Inc.', via: 'U7 Lite', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 6, 2x2', channel: '44 (5 GHz, 80 MHz)', ip: '10.10.10.21', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '6.2 GB', uptime: '9h 12m', type: 'phone', wgPeer: 'Alex Phone' },
  { name: 'Sam iPhone', vendor: 'Apple, Inc.', via: 'UniFi Express 7', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 7, 2x2', channel: '37 (6 GHz, 160 MHz)', ip: '10.10.10.22', activity: '120 Kbps', down: '110 Kbps', up: '10 Kbps', usage: '4.1 GB', uptime: '3h 40m', type: 'phone', wgPeer: 'Sam Phone' },
  { name: 'Work laptop', vendor: 'Apple, Inc.', via: 'UniFi Express 7', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 6, 2x2', channel: '37 (6 GHz, 160 MHz)', ip: '10.10.10.30', activity: '2 Kbps', down: '1 Kbps', up: '1 Kbps', usage: '850 MB', uptime: '1d 2h', type: 'laptop' },
  { name: 'MacBook Pro', vendor: 'Apple, Inc.', via: 'wired', network: 'trusted', ip: '10.10.10.10', activity: '300 Kbps', down: '200 Kbps', up: '100 Kbps', usage: '7.5 GB', uptime: '20d 4h', type: 'laptop', wgPeer: 'Laptop' },
  { name: 'iPad', vendor: 'Apple, Inc.', via: 'U7 Lite', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 6, 2x2', channel: '44 (5 GHz, 80 MHz)', ip: '10.10.10.40', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '120 MB', uptime: '2d 1h', type: 'tablet' },
  { name: 'Handheld console', vendor: 'Sony Corporation', via: 'U7 Lite', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 5, 1x1', channel: '44 (5 GHz, 80 MHz)', ip: '10.10.10.50', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '40 MB', uptime: '3d 6h', type: 'handheld' },
  { name: 'Mac mini (Wi-Fi)', vendor: 'Apple, Inc.', via: 'U7 Lite', network: 'trusted', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 6, 2x2', channel: '44 (5 GHz, 80 MHz)', ip: '10.10.10.60', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '12 GB', uptime: '1d 1h', type: 'desktop' },
  { name: 'Apple Watch', vendor: 'Apple, Inc.', via: null, network: 'trusted', ip: '10.10.10.70', lastSeen: 'yesterday 18:30', type: 'watch' },
  { name: 'Guest phone', vendor: 'Samsung Group', via: null, network: 'trusted', ip: '10.10.10.71', lastSeen: 'yesterday 22:10', type: 'phone' },
  { name: 'Raspberry Pi (Wi-Fi)', vendor: 'Raspberry Pi Foundation', via: 'U7 Lite', network: 'iot', ssid: 'Home', experience: 'Excellent', tech: 'WiFi 5, 1x1', channel: '44 (5 GHz, 80 MHz)', ip: '10.10.30.5', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '5 MB', uptime: '2h 10m', type: 'pi' },
  { name: 'Robot vacuum', vendor: 'Dreametech', via: 'U7 Lite', network: 'iot', ssid: 'Home IoT', experience: 'Good', tech: 'WiFi 4, 1x1', channel: '6 (2.4 GHz, 20 MHz)', ip: '10.10.30.100', activity: '2 Kbps', down: '1 Kbps', up: '1 Kbps', usage: '12 MB', uptime: '11h', type: 'vacuum' },
  { name: 'Front camera', vendor: 'TP-Link', via: 'U7 Lite', network: 'iot', ssid: 'Home IoT', experience: 'Excellent', tech: 'WiFi 6, 1x1', channel: '6 (2.4 GHz, 20 MHz)', ip: '10.10.30.11', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '6 MB', uptime: '2d 17h', type: 'camera' },
  { name: 'Back camera', vendor: 'TP-Link', via: 'UniFi Express 7', network: 'iot', ssid: 'Home IoT', experience: 'Excellent', tech: 'WiFi 6, 1x1', channel: '6 (2.4 GHz, 20 MHz)', ip: '10.10.30.12', activity: '128 bps', down: '0 bps', up: '128 bps', usage: '30 MB', uptime: '20d 3h', type: 'camera' },
  { name: 'Metrics', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.5', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '70 KB', uptime: '21d', type: 'container', profile: 'scraper' },
  { name: 'Grafana', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.7', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '1.3 MB', uptime: '21d', type: 'container', profile: 'scraper' },
  { name: 'NGINX Proxy', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.3', activity: '15 Kbps', down: '13 Kbps', up: '2 Kbps', usage: '22 MB', uptime: '21d', type: 'container', profile: 'proxy' },
  { name: 'Databases', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.4', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '14 KB', uptime: '21d', type: 'container' },
  { name: 'Apps', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.6', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '35 MB', uptime: '21d', type: 'container' },
  { name: 'Proxmox host', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.20', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '550 KB', uptime: '22d', type: 'server', role: 'host' },
  { name: 'DNS 1', vendor: 'Proxmox', via: 'wired', network: 'servers', ip: '10.10.20.2', activity: '100 Kbps', down: '75 Kbps', up: '25 Kbps', usage: '330 MB', uptime: '22d', type: 'container', role: 'adguard' },
  { name: 'Mac mini', vendor: 'Apple, Inc.', via: 'wired', network: 'servers', ip: '10.10.20.10', activity: '300 Kbps', down: '160 Kbps', up: '140 Kbps', usage: '40 GB', uptime: '22d', type: 'desktop' },
  { name: 'WireGuard VPN', vendor: 'Proxmox', via: 'wired', network: 'lab', ip: '10.10.50.20', activity: '6 Kbps', down: '3 Kbps', up: '3 Kbps', usage: '40 MB', uptime: '21d', type: 'container', role: 'wireguard' },
  { name: 'GitLab', vendor: 'Proxmox', via: 'wired', network: 'lab', ip: '10.10.50.40', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '1.3 GB', uptime: '19d', type: 'container', profile: 'lab' },
  { name: 'Container registry', vendor: 'Proxmox', via: 'wired', network: 'lab', ip: '10.10.50.41', activity: '0 bps', down: '0 bps', up: '0 bps', usage: null, uptime: '19d', type: 'container', profile: 'lab' },
  { name: 'Test box', vendor: 'Proxmox', via: 'wired', network: 'lab', ip: '10.10.50.30', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '8 KB', uptime: '20d', type: 'container', profile: 'lab' },
  { name: 'Raspberry Pi', vendor: 'Raspberry Pi Foundation', via: 'wired', network: 'main', ip: '192.168.0.3', activity: '0 bps', down: '0 bps', up: '0 bps', usage: '13 MB', uptime: '22d', type: 'pi' },
  { name: 'Game console', vendor: 'Sony Corporation', via: 'wired', network: 'main', ip: '192.168.0.120', activity: '0 bps', down: '0 bps', up: '0 bps', usage: null, uptime: '22d', type: 'console' },
  { name: '24-port switch', vendor: 'NETGEAR', via: 'UniFi Express 7 Port 1', network: 'main', ip: '192.168.0.119', activity: '0 bps', down: '0 bps', up: '0 bps', usage: null, uptime: '21d', type: 'switch', role: 'gs724t' },
  { name: 'Living room TV', vendor: 'LG Corporation', via: null, network: 'main', ip: '192.168.0.20', lastSeen: 'yesterday 17:52', type: 'tv' },
];

export const PEERS = [
  { name: 'cloud-monitor', ip: '10.9.0.3', type: 'cloud', note: 'WireGuard peer · not in the UniFi list (layer 3)', wgPeer: 'Oracle VM' },
];
