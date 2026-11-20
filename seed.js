const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'clientes.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL,
    telefono TEXT DEFAULT '',
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const ejemplos = [
  { cedula: 'V-21345678', nombre: 'Alejandro Rodríguez', estado: 'Distrito Capital', telefono: '0414-1112233' },
  { cedula: 'V-19876543', nombre: 'Mariana Silva', estado: 'Miranda', telefono: '0424-2223344' },
  { cedula: 'V-25432198', nombre: 'Carlos Eduardo Mendoza', estado: 'Carabobo', telefono: '0412-3334455' },
  { cedula: 'V-18765432', nombre: 'Daniela Colmenares', estado: 'Zulia', telefono: '0416-4445566' },
  { cedula: 'V-23456789', nombre: 'Jesús Alberto Marcano', estado: 'Anzoátegui', telefono: '0414-5556677' },
  { cedula: 'V-20123987', nombre: 'Valeria Valentina Torres', estado: 'Lara', telefono: '0424-6667788' },
  { cedula: 'V-22987123', nombre: 'Andrés Morales', estado: 'Distrito Capital', telefono: '0412-7778899' },
  { cedula: 'V-17654321', nombre: 'Patricia Fernández', estado: 'Miranda', telefono: '0414-8889900' },
  { cedula: 'V-24567890', nombre: 'Gabriel Ortega', estado: 'Aragua', telefono: '0424-9990011' },
  { cedula: 'V-26123456', nombre: 'Stephanie Blanco', estado: 'Distrito Capital', telefono: '0416-0001122' }
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO clientes (cedula, nombre, estado, telefono, fecha_registro)
  VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
`);

let insertados = 0;
for (const e of ejemplos) {
  const info = insert.run(e.cedula, e.nombre, e.estado, e.telefono);
  if (info.changes > 0) insertados++;
}

console.log(`✅ Base de datos inicializada: ${insertados} clientes de prueba insertados.`);
