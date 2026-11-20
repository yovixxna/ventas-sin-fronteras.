# Sistema de Registro y Monitoreo de Clientes

Este sistema permite que tus clientes se registren ellos mismos mediante un formulario web HTML moderno y responsive, guardando su **Cédula**, **Nombre Completo**, **Estado (Región)** y **Teléfono** en una base de datos **SQLite**.

Además, incluye un **Panel de Monitoreo en Tiempo Real (Dashboard)** con métricas automáticas y gráficos interactivos para llevar el control de cuántos clientes tienes y desde qué estados te compran.

---

## 🚀 Enlaces de Acceso (Servidor Activo)

- 📝 **Formulario de Registro para Clientes:** [http://localhost:3000/](http://localhost:3000/)
- 📊 **Panel de Control y Monitoreo:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- 📥 **Exportación Directa a Excel/CSV:** [http://localhost:3000/api/export.csv](http://localhost:3000/api/export.csv)

---

## 📁 Estructura del Proyecto

```text
registro-clientes/
├── server.js              # Servidor HTTP y API REST con Node.js y SQLite nativo
├── clientes.db            # Base de datos SQLite persistente
├── iniciar.bat            # Acceso directo para encender el servidor con doble clic
├── package.json           # Configuración del proyecto
├── seed.js                # Script con datos de ejemplo para pruebas
└── public/
    ├── index.html         # Formulario público HTML donde se anexan los clientes
    └── dashboard.html     # Panel de monitoreo con gráficos (Chart.js) y filtros
```

---

## 🛠️ Cómo Iniciar el Servidor

### Opción 1: Con doble clic en Windows
Haz doble clic sobre el archivo `iniciar.bat`.

### Opción 2: Desde la terminal
```bash
node server.js
```

---

## 📱 Cómo compartir el formulario con tus clientes (Red Local / Wi-Fi)

Si quieres que tus clientes o vendedores se registren desde sus teléfonos conectados a la misma red Wi-Fi:
1. Abre la consola (`cmd`) y escribe `ipconfig` para conocer tu dirección IPv4 (por ejemplo: `192.168.1.25`).
2. Indícales entrar desde su navegador a:
   `http://192.168.1.25:3000/`

---

## 📊 Características del Panel de Monitoreo

1. **KPIs en tiempo real**: Total de clientes, Estado líder con más compras, número de estados alcanzados y registros del día.
2. **Gráficos interactivos**:
   - Gráfico de barras con el ranking de clientes por estado.
   - Gráfico de dona con la cuota porcentual de mercado por región.
3. **Buscador y filtros**:
   - Búsqueda instantánea por Cédula o Nombre.
   - Filtrado dinámico por Estado.
4. **Exportar a Excel/CSV**: Descarga con un solo clic el listado completo para respaldos o reportes contables.
