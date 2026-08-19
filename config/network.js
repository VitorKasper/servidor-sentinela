const os = require('os');

/**
 * Retorna os endereços IPv4 locais da máquina na rede (LAN).
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const interfaceName in interfaces) {
    const netInterfaces = interfaces[interfaceName];
    for (const net of netInterfaces) {
      // Ignora endereços internos (127.0.0.1) e somente IPv4
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          interface: interfaceName,
          address: net.address
        });
      }
    }
  }

  return addresses;
}

/**
 * Retorna o IP primário da rede local.
 */
function getPrimaryLocalIp() {
  const ips = getLocalIpAddresses();
  if (ips.length > 0) {
    // Dá preferência a interfaces Wi-Fi ou Ethernet
    const preferred = ips.find(i => 
      /wi-fi|ethernet|en|eth|wlan|lan/i.test(i.interface)
    );
    return preferred ? preferred.address : ips[0].address;
  }
  return 'localhost';
}

module.exports = {
  getLocalIpAddresses,
  getPrimaryLocalIp
};
