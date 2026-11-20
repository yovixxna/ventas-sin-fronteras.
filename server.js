const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'clientes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- SISTEMA DE BASE DE DATOS UNIVERSAL (Persistente en Disco) ---
let dbData = { clientes: [], nextId: 1 };

function cargarDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const contenido = fs.readFileSync(DB_FILE, 'utf8');
      dbData = JSON.parse(contenido);
      if (!Array.isArray(dbData.clientes)) dbData.clientes = [];
      if (!dbData.nextId) {
        dbData.nextId = dbData.clientes.reduce((max, c) => Math.max(max, c.id || 0), 0) + 1;
      }
    } else {
      guardarDB();
    }
  } catch (e) {
    console.error('Error al cargar clientes.json:', e);
    dbData = { clientes: [], nextId: 1 };
  }
}

function guardarDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (e) {
    console.error('Error al guardar en clientes.json:', e);
  }
}

cargarDB();

// Helper para parsear request body
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { req.destroy(); reject(new Error('Payload demasiado grande')); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (err) { reject(new Error('JSON invÃ¡lido')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// Servidor HTTP Principal
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // 1. POST /api/clientes (Guardar nuevo cliente)
  if (pathname === '/api/clientes' && method === 'POST') {
    try {
      const data = await parseRequestBody(req);
      let { cedula, nombre, estado, telefono } = data;

      if (!cedula || !nombre || !estado) {
        return sendJSON(res, 400, { success: false, error: 'CÃ©dula, nombre y estado son obligatorios.' });
      }

      cedula = String(cedula).trim().toUpperCase();
      nombre = String(nombre).trim();
      estado = String(estado).trim();
      telefono = telefono ? String(telefono).trim() : '';

      // Validar duplicados
      const existe = dbData.clientes.find(c => c.cedula === cedula);
      if (existe) {
        return sendJSON(res, 409, {
          success: false,
          error: `Ya existe un cliente con la cÃ©dula ${cedula} (${existe.nombre}).`
        });
      }

      const ahora = new Date();
      const fechaStr = ahora.toISOString().replace('T', ' ').substring(0, 19);

      const nuevoCliente = {
        id: dbData.nextId++,
        cedula,
        nombre,
        estado,
        telefono,
        fecha_registro: fechaStr
      };

      dbData.clientes.unshift(nuevoCliente);
      guardarDB();

      return sendJSON(res, 201, {
        success: true,
        message: 'Cliente registrado exitosamente.',
        cliente: nuevoCliente
      });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { success: false, error: 'Error al registrar cliente.' });
    }
  }

  // 2. GET /api/clientes (Listar clientes con bÃºsqueda)
  if (pathname === '/api/clientes' && method === 'GET') {
    const search = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
    const estadoFilter = parsedUrl.searchParams.get('estado') || '';

    let filtrados = dbData.clientes;

    if (search) {
      filtrados = filtrados.filter(c =>
        (c.cedula && c.cedula.toLowerCase().includes(search)) ||
        (c.nombre && c.nombre.toLowerCase().includes(search))
      );
    }
    if (estadoFilter) {
      filtrados = filtrados.filter(c => c.estado === estadoFilter);
    }

    return sendJSON(res, 200, {
      success: true,
      total: filtrados.length,
      clientes: filtrados
    });
  }

  // 3. GET /api/stats (MÃ©tricas y conteo por estado para monitoreo)
  if (pathname === '/api/stats' && method === 'GET') {
    const total = dbData.clientes.length;

    // Conteo por estado
    const mapaEstados = {};
    for (const c of dbData.clientes) {
      mapaEstados[c.estado] = (mapaEstados[c.estado] || 0) + 1;
    }

    const porEstado = Object.keys(mapaEstados).map(est => ({
      estado: est,
      cantidad: mapaEstados[est],
      porcentaje: total > 0 ? Math.round((mapaEstados[est] * 1000) / total) / 10 : 0
    })).sort((a, b) => b.cantidad - a.cantidad);

    // Registrados hoy
    const hoyStr = new Date().toISOString().substring(0, 10);
    const hoyCount = dbData.clientes.filter(c => c.fecha_registro && c.fecha_registro.startsWith(hoyStr)).length;

    return sendJSON(res, 200, {
      success: true,
      stats: {
        total,
        hoy: hoyCount,
        total_estados: porEstado.length,
        top_estado: porEstado.length > 0 ? porEstado[0].estado : 'Ninguno',
        por_estado: porEstado,
        ultimos_registros: dbData.clientes.slice(0, 5)
      }
    });
  }

  // 4. DELETE /api/clientes/:id (Eliminar un cliente)
  if (pathname.startsWith('/api/clientes/') && method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3], 10);
    const index = dbData.clientes.findIndex(c => c.id === id);

    if (index === -1) {
      return sendJSON(res, 404, { success: false, error: 'Cliente no encontrado' });
    }

    dbData.clientes.splice(index, 1);
    guardarDB();
    return sendJSON(res, 200, { success: true, message: 'Cliente eliminado correctamente' });
  }

  // 5. GET /api/export.csv (Descargar CSV)
  if (pathname === '/api/export.csv' && method === 'GET') {
    let csv = '\uFEFFID,CÃ©dula,Nombre Completo,Estado,TelÃ©fono,Fecha de Registro\n';
    for (const r of dbData.clientes) {
      const nom = `"${(r.nombre || '').replace(/"/g, '""')}"`;
      const est = `"${(r.estado || '').replace(/"/g, '""')}"`;
      csv += `${r.id},${r.cedula},${nom},${est},${r.telefono || ''},${r.fecha_registro}\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="clientes_ventas_sin_fronteras.csv"'
    });
    return res.end(csv);
  }

  // Servir archivos estÃ¡ticos si existen en public/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (pathname === '/dashboard' || pathname === '/admin') {
    filePath = path.join(PUBLIC_DIR, 'dashboard.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.html' ? 'text/html; charset=utf-8' :
                 ext === '.js' ? 'application/javascript' :
                 ext === '.css' ? 'text/css' :
                 ext === '.svg' ? 'image/svg+xml' : 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    return fs.createReadStream(filePath).pipe(res);
  }

  // RESPALDO INCORPORADO (Por si la carpeta public no se subiÃ³ a GitHub):
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_FORMULARIO);
  }

  if (pathname === '/dashboard' || pathname === '/admin' || pathname === '/dashboard.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_DASHBOARD);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 No Encontrado');
});

// HTML EMBEBIDO DEL FORMULARIO DE CLIENTES (Garantiza funcionamiento 100% en la nube)
const HTML_FORMULARIO = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Ventas Sin Fronteras - Registro de Clientes</title>
  <meta name="theme-color" content="#1d4ed8">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: linear-gradient(135deg, #f0f7ff 0%, #e0effe 50%, #ffffff 100%); min-height: 100vh; }
    input, select, button { font-size: 16px !important; }
  </style>
</head>
<body class="text-slate-800 flex flex-col justify-between p-3.5 sm:p-6 md:p-8 min-h-screen">
  <header class="max-w-md mx-auto w-full flex items-center justify-between py-2 mb-3">
    <div class="flex items-center gap-2.5">
      <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-700 via-blue-600 to-sky-500 flex items-center justify-center shadow-md shadow-blue-500/25 text-white flex-shrink-0">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      </div>
      <div>
        <h1 class="text-lg font-black text-blue-950 tracking-tight leading-tight">Ventas Sin Fronteras</h1>
        <p class="text-[11px] font-bold text-blue-600">Registro Oficial de Compras</p>
      </div>
    </div>
    <a href="/dashboard" class="p-2 rounded-xl bg-white text-blue-700 border border-blue-200 shadow-sm text-xs font-bold" title="Panel Administrativo">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
    </a>
  </header>

  <main class="max-w-md mx-auto w-full flex-1 flex flex-col justify-center">
    <div class="bg-white border border-blue-100 rounded-3xl p-5 sm:p-8 shadow-xl shadow-blue-900/10">
      <div class="text-center mb-6">
        <span class="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-extrabold tracking-wide mb-2">
          <span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span> FORMULARIO DE CLIENTES
        </span>
        <h2 class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Ingresa tus Datos</h2>
        <p class="text-xs text-slate-500 mt-1">Completa estos 3 campos para registrar tu compra:</p>
      </div>

      <div id="alertBox" class="hidden mb-5 p-3.5 rounded-2xl text-xs font-semibold leading-relaxed"></div>

      <form id="registroForm" class="space-y-4" onsubmit="registrarCliente(event)">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">CÃ©dula de Identidad <span class="text-rose-500">*</span></label>
          <div class="flex gap-2">
            <select id="tipoCedula" class="w-20 px-2.5 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-bold text-sm focus:border-blue-600 focus:bg-white focus:outline-none">
              <option value="V-">V-</option><option value="E-">E-</option><option value="J-">J-</option><option value="G-">G-</option><option value="">Doc</option>
            </select>
            <input type="text" id="numCedula" inputmode="numeric" placeholder="Ej: 24123456" required class="flex-1 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-bold placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none font-mono text-sm">
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nombre y Apellido <span class="text-rose-500">*</span></label>
          <input type="text" id="nombre" autocapitalize="words" placeholder="Ej: Carlos Eduardo PÃ©rez" required class="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold placeholder-slate-400 text-sm focus:border-blue-600 focus:bg-white focus:outline-none">
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Â¿Desde quÃ© Estado compras? <span class="text-rose-500">*</span></label>
          <select id="estado" required onchange="verificarOtro(this.value)" class="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold text-sm focus:border-blue-600 focus:bg-white focus:outline-none">
            <option value="" disabled selected>-- Elige tu Estado --</option>
            <option value="Amazonas">Amazonas</option><option value="AnzoÃ¡tegui">AnzoÃ¡tegui</option><option value="Apure">Apure</option><option value="Aragua">Aragua</option><option value="Barinas">Barinas</option><option value="BolÃ­var">BolÃ­var</option><option value="Carabobo">Carabobo</option><option value="Cojedes">Cojedes</option><option value="Delta Amacuro">Delta Amacuro</option><option value="Distrito Capital">Distrito Capital (Caracas)</option><option value="FalcÃ³n">FalcÃ³n</option><option value="GuÃ¡rico">GuÃ¡rico</option><option value="La Guaira">La Guaira</option><option value="Lara">Lara</option><option value="MÃ©rida">MÃ©rida</option><option value="Miranda">Miranda</option><option value="Monagas">Monagas</option><option value="Nueva Esparta">Nueva Esparta (Margarita)</option><option value="Portuguesa">Portuguesa</option><option value="Sucre">Sucre</option><option value="TÃ¡chira">TÃ¡chira</option><option value="Trujillo">Trujillo</option><option value="Yaracuy">Yaracuy</option><option value="Zulia">Zulia</option><option value="OTRO">Otro Estado o RegiÃ³n...</option>
          </select>
        </div>

        <div id="otroContainer" class="hidden">
          <input type="text" id="otroInput" placeholder="Escribe tu Estado o Ciudad" class="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold text-sm focus:border-blue-600 focus:bg-white focus:outline-none">
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">TelÃ©fono / WhatsApp <span class="text-slate-400 font-normal lowercase">(opcional)</span></label>
          <input type="tel" id="telefono" inputmode="tel" placeholder="Ej: 0414-1234567" class="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold placeholder-slate-400 text-sm focus:border-blue-600 focus:bg-white focus:outline-none font-mono">
        </div>

        <button type="submit" id="submitBtn" class="w-full mt-2 py-4 px-6 rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-sky-600 text-white font-extrabold text-base tracking-wide shadow-lg shadow-blue-600/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer">
          <span id="btnText">Enviar Registro</span>
        </button>
      </form>

      <div id="successCard" class="hidden text-center py-6">
        <div class="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-blue-100">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
        </div>
        <h3 class="text-xl font-black text-slate-900 mb-1">Â¡Registro Exitoso!</h3>
        <p class="text-xs text-slate-600 mb-5">Tus datos han sido registrados en <strong>Ventas Sin Fronteras</strong>.</p>
        <button onclick="nuevoRegistro()" class="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all">â† Registrar a otro cliente</button>
      </div>
    </div>
  </main>

  <footer class="max-w-md mx-auto w-full text-center text-[11px] text-slate-400 py-3">Â© 2026 Ventas Sin Fronteras â€¢ Nube 24/7</footer>

  <script>
    function verificarOtro(v) {
      const c = document.getElementById('otroContainer');
      const i = document.getElementById('otroInput');
      if (v === 'OTRO') { c.classList.remove('hidden'); i.required = true; i.focus(); }
      else { c.classList.add('hidden'); i.required = false; }
    }
    function mostrarAlerta(msg, err = true) {
      const b = document.getElementById('alertBox');
      b.classList.remove('hidden');
      b.className = err ? 'mb-5 p-3.5 rounded-2xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700' : 'mb-5 p-3.5 rounded-2xl text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800';
      b.innerHTML = msg;
    }
    async function registrarCliente(e) {
      e.preventDefault();
      const tipo = document.getElementById('tipoCedula').value;
      const num = document.getElementById('numCedula').value.trim();
      const nom = document.getElementById('nombre').value.trim();
      let est = document.getElementById('estado').value;
      if (est === 'OTRO') est = document.getElementById('otroInput').value.trim();
      const tel = document.getElementById('telefono').value.trim();
      const ced = (tipo + num).trim();

      const btn = document.getElementById('submitBtn');
      const txt = document.getElementById('btnText');
      btn.disabled = true; txt.textContent = 'Enviando...';

      try {
        const res = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cedula: ced, nombre: nom, estado: est, telefono: tel })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('registroForm').classList.add('hidden');
          document.getElementById('successCard').classList.remove('hidden');
        } else {
          mostrarAlerta(data.error || 'OcurriÃ³ un error');
        }
      } catch(e) {
        mostrarAlerta('No se pudo conectar con el servidor.');
      } finally {
        btn.disabled = false; txt.textContent = 'Enviar Registro';
      }
    }
    function nuevoRegistro() {
      document.getElementById('registroForm').reset();
      document.getElementById('otroContainer').classList.add('hidden');
      document.getElementById('registroForm').classList.remove('hidden');
      document.getElementById('successCard').classList.add('hidden');
      document.getElementById('alertBox').classList.add('hidden');
    }
  </script>
</body>
</html>`;

// HTML EMBEBIDO DEL DASHBOARD DE MONITOREO
const HTML_DASHBOARD = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ventas Sin Fronteras - Panel de Monitoreo</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f8fafc; } </style>
</head>
<body class="text-slate-800 min-h-screen flex flex-col">
  <nav class="bg-white border-b border-blue-100 sticky top-0 z-40 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-sky-500 flex items-center justify-center shadow-md text-white">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <div>
          <h1 class="text-lg font-extrabold text-blue-900">Ventas Sin Fronteras</h1>
          <span class="text-xs font-semibold text-emerald-600">â— Nube 24/7 Activa</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <a href="/api/export.csv" download="clientes.csv" class="px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 shadow-sm">Exportar Excel</a>
        <a href="/" target="_blank" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white shadow-md">Abrir Formulario</a>
      </div>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 flex-1">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
        <p class="text-xs font-bold uppercase text-slate-500">Total de Clientes</p>
        <h2 id="kpiTotal" class="text-3xl font-extrabold text-slate-900 mt-1">0</h2>
      </div>
      <div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
        <p class="text-xs font-bold uppercase text-slate-500">Estado LÃ­der</p>
        <h2 id="kpiTopEstado" class="text-2xl font-extrabold text-blue-800 mt-1 truncate">--</h2>
      </div>
      <div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
        <p class="text-xs font-bold uppercase text-slate-500">Estados con Clientes</p>
        <h2 id="kpiEstados" class="text-3xl font-extrabold text-indigo-700 mt-1">0</h2>
      </div>
      <div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
        <p class="text-xs font-bold uppercase text-slate-500">Nuevos Hoy</p>
        <h2 id="kpiHoy" class="text-3xl font-extrabold text-amber-600 mt-1">0</h2>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
        <h3 class="text-base font-bold text-slate-900 mb-4">Volumen de Clientes por Estado</h3>
        <div class="h-64"><canvas id="barChart"></canvas></div>
      </div>
      <div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
        <h3 class="text-base font-bold text-slate-900">DistribuciÃ³n Porcentual</h3>
        <div class="h-60 flex items-center justify-center my-auto"><canvas id="pieChart"></canvas></div>
        <div id="resumenEstados" class="text-xs text-slate-500 text-center pt-2 border-t border-slate-100">Cargando...</div>
      </div>
    </div>

    <div class="bg-white border border-blue-100 rounded-2xl shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 class="text-base font-bold text-slate-900">Directorio de Clientes</h3>
        <input type="text" id="searchInput" oninput="filtrar()" placeholder="Buscar por cÃ©dula o nombre..." class="px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-100 font-bold text-slate-600 border-b">
            <tr>
              <th class="py-3 px-4"># ID</th><th class="py-3 px-4">CÃ©dula</th><th class="py-3 px-4">Nombre</th><th class="py-3 px-4">Estado</th><th class="py-3 px-4">TelÃ©fono</th><th class="py-3 px-4">Fecha</th><th class="py-3 px-4 text-right">AcciÃ³n</th>
            </tr>
          </thead>
          <tbody id="tablaBody" class="divide-y divide-slate-100 font-medium">
            <tr><td colspan="7" class="py-6 text-center text-slate-400">Cargando datos...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    let clientes = [];
    let barInstance = null, pieInstance = null;
    const colores = ['#2563eb', '#0284c7', '#0d9488', '#16a34a', '#d97706', '#7c3aed', '#db2777'];

    async function cargar() {
      try {
        const sRes = await fetch('/api/stats');
        const sData = await sRes.json();
        if (sData.success) {
          const s = sData.stats;
          document.getElementById('kpiTotal').textContent = s.total;
          document.getElementById('kpiHoy').textContent = s.hoy;
          document.getElementById('kpiEstados').textContent = s.total_estados;
          document.getElementById('kpiTopEstado').textContent = s.top_estado;
          actualizarGraficos(s.por_estado);
        }

        const cRes = await fetch('/api/clientes');
        const cData = await cRes.json();
        if (cData.success) {
          clientes = cData.clientes;
          renderTabla(clientes);
        }
      } catch(e) {}
    }

    function filtrar() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const fil = clientes.filter(c => (c.cedula && c.cedula.toLowerCase().includes(q)) || (c.nombre && c.nombre.toLowerCase().includes(q)));
      renderTabla(fil);
    }

    function renderTabla(list) {
      const tbody = document.getElementById('tablaBody');
      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-400">No hay clientes registrados aÃºn.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(c => \`
        <tr class="hover:bg-blue-50/40">
          <td class="py-3 px-4 text-slate-400 font-mono">#\${c.id}</td>
          <td class="py-3 px-4 font-bold text-blue-700 font-mono">\${c.cedula}</td>
          <td class="py-3 px-4 font-bold text-slate-900">\${c.nombre}</td>
          <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">\${c.estado}</span></td>
          <td class="py-3 px-4 font-mono text-slate-600">\${c.telefono || '-'}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px] font-mono">\${c.fecha_registro}</td>
          <td class="py-3 px-4 text-right">
            <button onclick="eliminar(\${c.id})" class="text-rose-500 hover:text-rose-700 font-bold">âœ•</button>
          </td>
        </tr>
      \`).join('');
    }

    async function eliminar(id) {
      if (!confirm('Â¿Eliminar cliente?')) return;
      await fetch('/api/clientes/' + id, { method: 'DELETE' });
      cargar();
    }

    function actualizarGraficos(porEstado) {
      const labels = porEstado.map(x => x.estado);
      const data = porEstado.map(x => x.cantidad);

      if (barInstance) barInstance.destroy();
      barInstance = new Chart(document.getElementById('barChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Clientes', data, backgroundColor: '#2563eb', borderRadius: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      if (pieInstance) pieInstance.destroy();
      pieInstance = new Chart(document.getElementById('pieChart'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colores.slice(0, labels.length) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      document.getElementById('resumenEstados').innerHTML = porEstado.length > 0 ? \`LÃ­der: <strong>\${porEstado[0].estado}</strong> con \${porEstado[0].cantidad} cliente(s)\` : 'Sin datos';
    }

    window.onload = () => { cargar(); setInterval(cargar, 15000); };
  </script>
</body>
</html>`;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`ðŸš€ Ventas Sin Fronteras ACTIVO en puerto ${PORT}`);
  console.log(`======================================================\n`);
});
