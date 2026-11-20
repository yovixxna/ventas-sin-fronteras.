const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// 1. Iniciar servidor Node.js
require('./server.js');

// 2. Iniciar Cloudflare Tunnel para dar enlace público a los celulares
const cloudflaredBin = path.join(__dirname, 'cloudflared.exe');

if (fs.existsSync(cloudflaredBin)) {
  const tunnel = spawn(cloudflaredBin, ['tunnel', '--url', 'http://localhost:3000']);
  
  let urlDetectada = false;

  const buscarUrl = (data) => {
    const texto = data.toString();
    const match = texto.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlDetectada) {
      urlDetectada = true;
      const publicUrl = match[0];
      
      // Guardar en archivo para que el dashboard lo lea
      fs.writeFileSync(path.join(__dirname, 'public', 'tunnel_url.txt'), publicUrl, 'utf8');

      console.log('\n========================================================================');
      console.log('🌍 ENLACE PÚBLICO PARA TELÉFONOS (Mándale este enlace a tus clientes):');
      console.log(`👉 ${publicUrl}`);
      console.log('========================================================================\n');
    }
  };

  tunnel.stdout.on('data', buscarUrl);
  tunnel.stderr.on('data', buscarUrl);

  tunnel.on('close', (code) => {
    console.log(`Túnel cerrado con código ${code}`);
  });
} else {
  console.log('⚠️ cloudflared.exe no encontrado. El sistema funcionará solo en red local.');
}
