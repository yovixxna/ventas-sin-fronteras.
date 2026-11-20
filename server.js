const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'clientes.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Inicializar Base de Datos SQLite
const db = new DatabaseSync(DB_PATH);

// Crear tabla si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL,
    telefono TEXT DEFAULT '',
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_clientes_estado ON clientes(estado);
  CREATE INDEX IF NOT EXISTS idx_clientes_cedula ON clientes(cedula);
`);

// Helper para parsear JSON del request body
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB max
        req.destroy();
        reject(new Error('Payload demasiado grande'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// Helper para respuestas JSON
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// Servir archivos estáticos
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  if (relativePath === '/dashboard' || relativePath === '/admin') {
    relativePath = '/dashboard.html';
  }

  const filePath = path.join(PUBLIC_DIR, relativePath);

  // Seguridad: evitar path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Acceso denegado');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 No Encontrado');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Servidor HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Manejar CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --- RUTAS DE API ---

  // 1. POST /api/clientes: Registrar un nuevo cliente
  if (pathname === '/api/clientes' && method === 'POST') {
    try {
      const data = await parseRequestBody(req);
      let { cedula, nombre, estado, telefono } = data;

      if (!cedula || !nombre || !estado) {
        return sendJSON(res, 400, {
          success: false,
          error: 'Cédula, nombre completo y estado son campos obligatorios.'
        });
      }

      cedula = String(cedula).trim().toUpperCase();
      nombre = String(nombre).trim();
      estado = String(estado).trim();
      telefono = telefono ? String(telefono).trim() : '';

      // Verificar si ya existe la cédula
      const checkStmt = db.prepare('SELECT id, nombre, estado FROM clientes WHERE cedula = ?');
      const existing = checkStmt.get(cedula);

      if (existing) {
        return sendJSON(res, 409, {
          success: false,
          error: `Ya existe un cliente registrado con la cédula ${cedula} (${existing.nombre}).`,
          existing
        });
      }

      const insertStmt = db.prepare(`
        INSERT INTO clientes (cedula, nombre, estado, telefono, fecha_registro)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      `);
      const result = insertStmt.run(cedula, nombre, estado, telefono);

      return sendJSON(res, 201, {
        success: true,
        message: 'Cliente registrado exitosamente.',
        cliente: {
          id: result.lastInsertRowid,
          cedula,
          nombre,
          estado,
          telefono
        }
      });
    } catch (err) {
      console.error('Error al registrar cliente:', err);
      return sendJSON(res, 500, {
        success: false,
        error: 'Ocurrió un error en el servidor al guardar los datos.'
      });
    }
  }

  // 2. GET /api/clientes: Obtener lista de clientes con filtros opcionales
  if (pathname === '/api/clientes' && method === 'GET') {
    try {
      const search = parsedUrl.searchParams.get('search') || '';
      const estadoFilter = parsedUrl.searchParams.get('estado') || '';

      let query = 'SELECT * FROM clientes WHERE 1=1';
      const params = [];

      if (search) {
        query += ' AND (cedula LIKE ? OR nombre LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      if (estadoFilter) {
        query += ' AND estado = ?';
        params.push(estadoFilter);
      }

      query += ' ORDER BY id DESC';

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

      return sendJSON(res, 200, {
        success: true,
        total: rows.length,
        clientes: rows
      });
    } catch (err) {
      console.error('Error al consultar clientes:', err);
      return sendJSON(res, 500, { success: false, error: 'Error al obtener clientes' });
    }
  }

  // 3. GET /api/stats: Métricas y conteo por estado para monitoreo
  if (pathname === '/api/stats' && method === 'GET') {
    try {
      // Total general
      const totalRow = db.prepare('SELECT COUNT(*) AS total FROM clientes').get();
      const totalClientes = totalRow ? totalRow.total : 0;

      // Desglose por estado
      const porEstadoStmt = db.prepare(`
        SELECT estado, COUNT(*) as cantidad,
               ROUND(COUNT(*) * 100.0 / MAX(1, (SELECT COUNT(*) FROM clientes)), 1) as porcentaje
        FROM clientes
        GROUP BY estado
        ORDER BY cantidad DESC, estado ASC
      `);
      const porEstado = porEstadoStmt.all();

      // Registrados hoy
      const hoyRow = db.prepare(`
        SELECT COUNT(*) as hoy FROM clientes 
        WHERE date(fecha_registro) = date('now', 'localtime')
      `).get();

      // Últimos 5 registros
      const ultimosStmt = db.prepare(`
        SELECT id, cedula, nombre, estado, fecha_registro 
        FROM clientes 
        ORDER BY id DESC LIMIT 5
      `);
      const ultimos = ultimosStmt.all();

      return sendJSON(res, 200, {
        success: true,
        stats: {
          total: totalClientes,
          hoy: hoyRow ? hoyRow.hoy : 0,
          total_estados: porEstado.length,
          top_estado: porEstado.length > 0 ? porEstado[0].estado : 'Ninguno',
          por_estado: porEstado,
          ultimos_registros: ultimos
        }
      });
    } catch (err) {
      console.error('Error al generar estadísticas:', err);
      return sendJSON(res, 500, { success: false, error: 'Error al calcular estadísticas' });
    }
  }

  // 4. DELETE /api/clientes/:id: Eliminar un registro
  if (pathname.startsWith('/api/clientes/') && method === 'DELETE') {
    try {
      const id = pathname.split('/')[3];
      const stmt = db.prepare('DELETE FROM clientes WHERE id = ?');
      const info = stmt.run(id);

      if (info.changes === 0) {
        return sendJSON(res, 404, { success: false, error: 'Cliente no encontrado' });
      }

      return sendJSON(res, 200, { success: true, message: 'Cliente eliminado correctamente' });
    } catch (err) {
      console.error('Error al eliminar cliente:', err);
      return sendJSON(res, 500, { success: false, error: 'Error al eliminar cliente' });
    }
  }

  // 5. GET /api/export.csv: Exportar datos a CSV
  if (pathname === '/api/export.csv' && method === 'GET') {
    try {
      const rows = db.prepare('SELECT id, cedula, nombre, estado, telefono, fecha_registro FROM clientes ORDER BY id ASC').all();
      let csv = '\uFEFFID,Cédula,Nombre Completo,Estado,Teléfono,Fecha de Registro\n';
      for (const r of rows) {
        const nom = `"${(r.nombre || '').replace(/"/g, '""')}"`;
        const est = `"${(r.estado || '').replace(/"/g, '""')}"`;
        csv += `${r.id},${r.cedula},${nom},${est},${r.telefono || ''},${r.fecha_registro}\n`;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="clientes_registrados.csv"'
      });
      return res.end(csv);
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: 'Error al exportar CSV' });
    }
  }

  // Si no es API, servir archivos estáticos (HTML, JS, CSS)
  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Sistema de Registro y Monitoreo de Clientes ACTIVO`);
  console.log(`📌 Formulario para Clientes:  http://localhost:${PORT}/`);
  console.log(`📊 Panel de Control y Métricas: http://localhost:${PORT}/dashboard`);
  console.log(`📁 Base de Datos SQLite:      ${DB_PATH}`);
  console.log(`======================================================\n`);
});
