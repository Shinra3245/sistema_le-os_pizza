# Auditoría QA y de seguridad

**Sistema:** Pizzas a la Leña POS local

**Fecha:** 24 de septiembre de 2026

**Alcance:** frontend React, API Node.js, autenticación, sesiones, persistencia local, pedidos, caja, tickets, reportes, carta e inventario.

**Referencia:** OWASP ASVS 5.0, guías OWASP de autenticación, sesiones y CSRF, y reglas funcionales solicitadas para el restaurante.

## Dictamen ejecutivo de la auditoría inicial

En la revisión inicial, el sistema funcionaba como MVP local y sus flujos principales estaban implementados, pero **todavía no cumplía un nivel suficiente de seguridad e integridad para usarse en operación real sin correcciones**. El riesgo principal estaba en el servidor: aceptaba precios, productos y estados enviados por el navegador sin reconstruirlos ni comprobar la secuencia del pedido. Un usuario autenticado, una extensión del navegador o un fallo XSS podía registrar ventas negativas, cerrar pedidos sin pago o saltar la preparación.

Se identificaron:

- **3 hallazgos de prioridad crítica/alta inmediata**: integridad financiera, inyección HTML en tickets y exposición de archivos del proyecto.
- **5 hallazgos altos**: transiciones de estado sin control, carreras de escritura, validación insuficiente de pedidos/carta y permisos del archivo de operación.
- **9 hallazgos medios o bajos** de autenticación, sesión, trazabilidad, pruebas, accesibilidad y mantenimiento.

El servidor se enlaza por defecto a `127.0.0.1`, lo cual reduce la exposición desde otros equipos. Esta protección deja de aplicar si se configura `HOST=0.0.0.0`, se publica mediante un proxy o se comparte el equipo.

## Estado de remediación

**Actualización del 24 de septiembre de 2026:** se aplicaron las correcciones P0 y P1 y las mejoras necesarias del bloque P2. Los hallazgos S01 a S14 quedaron corregidos en la línea base actual:

- El servidor reconstruye artículos, variantes, tamaños, estaciones y precios desde la carta activa; ignora nombres y precios del navegador.
- Los pedidos usan comandos concretos para preparación, salida, pago y cancelación. Se rechazan pagos anticipados, cambios libres de estado y mesas duplicadas.
- Los tickets escapan todo texto dinámico, aíslan la ventana de impresión y usan CSP sin scripts.
- El servidor publica únicamente `dist`, protege mutaciones con token CSRF y origen, y añade cabeceras de seguridad y `no-store` a exportaciones.
- Las mutaciones se serializan, cada escritura usa un temporal único y los datos locales se fuerzan a carpeta `700` y archivos `600`.
- Se añadieron validación de órdenes, carta, ajustes e inventario; límite de acceso; sesiones por inactividad; bitácora persistente y retorno automático al login.
- Los folios son monotónicos, los cortes históricos pueden descargarse otra vez y los PDF conservan acentos con codificación WinAnsi.
- Three.js se carga bajo demanda, se retiró el frontend heredado y se corrigió el favicon.

La suite actual contiene siete recorridos de integración que verifican integridad financiera, flujo de domicilio, validación de datos, máquina de estados, CSRF, aislamiento de archivos, cabeceras, concurrencia, permisos, bitácora, límite de acceso, catálogo, exportaciones y corte de caja. Se ejecutó además una revisión visual en Chrome de la configuración inicial y del modal de pizza, incluida la exclusión mutua de comboboxes.

## Resultado de las verificaciones de la auditoría inicial

La tabla siguiente conserva la evidencia que originó las correcciones. El resultado posterior está documentado en **Estado de remediación** y en la suite actual.

| Verificación | Resultado | Evidencia |
|---|---:|---|
| Compilación de producción | Aprobada | `npm run build`; Vite generó `dist` sin error |
| Dependencias de producción | Aprobada | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades conocidas |
| Todas las dependencias | Aprobada | `npm audit --audit-level=moderate`: 0 vulnerabilidades conocidas |
| Árbol de dependencias | Aprobada | `npm ls --all --depth=4`: salida 0 |
| Pruebas incluidas en el repositorio | **Fallida** | 4/4 fallan durante la preparación porque la contraseña de prueba ya no cumple la política actual |
| Pruebas con fixture corregido en copia temporal | Aprobada | 4/4; no se alteraron archivos ni datos reales |
| Pruebas negativas de seguridad en almacén temporal | **Fallida** | Se aceptaron precio negativo, producto inexistente, pago anticipado de domicilio, cierre sin pago y dos órdenes abiertas para una mesa |
| Concurrencia de persistencia | **Fallida** | 12 escrituras simultáneas: 7 respuestas 200 y 5 respuestas 500 |
| PDF general y corte de caja | Aprobada con observación | 64 pedidos simulados, 3 páginas, PDF válido, texto y render legibles |
| Consistencia de carta | Aprobada con diferencia configurada | 77 esperados, 77 actuales, 0 faltantes, 0 extras, 0 registros inválidos; cambió el precio de la orilla de queso |
| Archivos sensibles ignorados por Git | Aprobada | datos locales, compilación, dependencias y guía local quedaron fuera del índice simulado |
| Búsqueda de secretos en fuentes | Aprobada | no se encontraron llaves privadas, API keys ni client secrets en los archivos revisados |

La cobertura porcentual no está medida. `node --experimental-test-coverage` reporta 100 % porque solo instrumenta el proceso de pruebas; el servidor evaluado se inicia como un proceso hijo y queda fuera de esa medición.

## Hallazgos de seguridad y confiabilidad

### S01 — Crítico: el servidor confía en precios y productos del navegador

**Evidencia:** `POST /api/orders` copia los artículos recibidos y `orderSubtotal` usa directamente `unitPrice` y `quantity`. En una prueba aislada se creó y cobró una orden con `productId: "no-existe"` y `unitPrice: -500`; quedó cerrada con total `-500` y cambio `500`.

**Impacto:** alteración de ventas, corte de caja, propinas, comisión de tarjeta, reportes y tickets.

**Corrección requerida:** aceptar solo identificadores y opciones; buscar el producto en la carta activa, validar variantes/tamaños y calcular el precio exclusivamente en el servidor. Rechazar cantidades no enteras, negativas o fuera de límite.

### S02 — Alta: inyección HTML almacenada en la ventana de impresión

**Evidencia:** `printTicket` escapa algunos datos del cliente, pero inserta sin escape `item.name`, detalles, notas, nombre del restaurante, forma de pago y títulos dentro de `document.write`.

**Impacto:** una nota o producto manipulado puede ejecutar JavaScript en una ventana del mismo origen, leer información visible o accionar la aplicación abierta.

**Corrección requerida:** construir el ticket con nodos y `textContent`, o escapar todos los valores dinámicos. Abrir la ventana con aislamiento de `opener` y aplicar una política CSP compatible con impresión.

### S03 — Alta: el servidor puede publicar código fuente y metadatos Git

**Evidencia aislada:** devolvió 200 para `/package.json`, `/.git/config` y `/src/react/App.jsx`. El servidor intenta leer primero desde `dist` y, si no encuentra el archivo, usa toda la raíz del proyecto como respaldo.

**Impacto:** divulgación de estructura, código, configuración y metadatos. El impacto crece si el servicio deja de ser exclusivamente local.

**Corrección requerida:** servir únicamente `dist` y una lista explícita de recursos públicos. Eliminar el respaldo a la raíz y denegar cualquier nombre que empiece con punto.

### S04 — Alta: el backend no aplica la máquina de estados del negocio

**Evidencia:** un `PATCH` asigna cualquier `body.status` y cualquier `body.paid`; el pago no verifica que cocina esté terminada ni que domicilio haya salido a reparto. Las pruebas lograron cerrar sin pago, pagar domicilio antes de preparación y liberar una mesa sin liquidar.

**Impacto:** órdenes desaparecen de pendientes, mesas se liberan, cobros se omiten y el historial deja de representar lo ocurrido.

**Corrección requerida:** definir transiciones permitidas por tipo de servicio y ejecutar comandos específicos (`terminarPreparacion`, `marcarSalida`, `liquidar`, `cancelar`) en lugar de aceptar estado libre.

### S05 — Alta: no se impide más de una orden abierta en la misma mesa

**Evidencia:** dos solicitudes consecutivas para la misma mesa fueron aceptadas.

**Impacto:** doble ocupación, comandas ambiguas y cobros asignados al pedido incorrecto.

**Corrección requerida:** comprobar en servidor que no exista otra orden abierta para la mesa y resolver la condición dentro de la misma sección crítica de persistencia.

### S06 — Alta: las escrituras concurrentes comparten el mismo archivo temporal

**Evidencia:** `saveStore` siempre usa `restaurante.json.tmp`. En 12 escrituras simultáneas, 5 terminaron con HTTP 500 por competencia entre `writeFile` y `rename`.

**Impacto:** operaciones perdidas o fallidas durante varios clics, pestañas, reintentos o futuras integraciones.

**Corrección requerida:** serializar mutaciones con una cola/mutex y usar archivos temporales únicos; para operación sostenida, migrar a SQLite con transacciones.

### S07 — Alta: validación incompleta de órdenes y catálogo

**Evidencia:** domicilio acepta nombre y dirección vacíos si el teléfono es válido; mesa no valida rango ni comensales; adiciones tampoco validan productos/precios. El catálogo permite identificadores duplicados, precios inválidos, textos sin límite y estructuras de variantes incompletas.

**Impacto:** datos inconsistentes, tickets incompletos, claves duplicadas de React y cálculos erróneos.

**Corrección requerida:** esquemas de validación en servidor con límites, unicidad y reglas por categoría y servicio.

### S08 — Alta en equipos compartidos: datos operativos legibles por otros usuarios locales

**Evidencia:** `data/auth.json` tiene modo `600`, pero `data/restaurante.json` tiene `644` y la carpeta `data` tiene `755`.

**Impacto:** otros usuarios del equipo pueden leer teléfonos, direcciones, ventas e historial.

**Corrección requerida:** crear carpeta con `700`, escribir el almacén con `600` y corregir permisos existentes.

### S09 — Media: no existe limitación de intentos de acceso

**Evidencia:** 12 contraseñas erróneas consecutivas respondieron 401; no hubo demora progresiva, bloqueo temporal ni 429.

**Impacto:** fuerza bruta local o desde red si el servidor se expone.

**Corrección requerida:** limitar por usuario y origen, aplicar espera progresiva y registrar el evento sin guardar contraseñas.

### S10 — Media: faltan cabeceras de seguridad y protección CSRF explícita

**Evidencia:** las respuestas JSON incluyen `nosniff` y `no-store`, pero las páginas, archivos y exportaciones no establecen CSP, `frame-ancestors`, política de referencia ni permisos. Las mutaciones usan cookie y no validan token CSRF ni `Origin`.

**Impacto:** aumenta el alcance de una inyección y deja protecciones dependientes de `SameSite=Strict` y del uso exclusivo en localhost.

**Corrección requerida:** cabeceras globales, validación de origen y token CSRF para mutaciones. Mantener HTTPS y cookie `Secure` si alguna vez se publica en red.

### S11 — Media: falta bitácora de eventos sensibles

**Evidencia:** no hay registro persistente de acceso correcto/fallido, cambio de contraseña, edición de carta, apertura/cierre, pago, reembolso o rechazo de autorización.

**Impacto:** no se puede reconstruir con certeza quién cambió datos o explicar diferencias de caja.

**Corrección requerida:** bitácora append-only con fecha, usuario, acción, entidad, resultado y motivo; nunca registrar contraseñas ni cookies.

### S12 — Media: la sesión expirada no se procesa en React

**Evidencia:** la capa API emite `pizzas:session-expired`, pero el frontend React no registra un listener. Solo la implementación heredada no utilizada lo escucha.

**Impacto:** después de ocho horas o un reinicio, la interfaz puede permanecer abierta mostrando errores sin volver al login.

**Corrección requerida:** escuchar el evento en `App`, limpiar estado y mostrar el login con un aviso de sesión terminada. Evaluar expiración por inactividad además del límite absoluto.

### S13 — Media: exportaciones con datos personales sin `no-store`

**Evidencia:** JSON, Excel y PDF incluyen información operativa; los endpoints de exportación no agregan `Cache-Control: no-store`.

**Impacto:** navegadores o intermediarios pueden conservar copias con teléfonos y direcciones.

**Corrección requerida:** añadir `no-store`, `nosniff` y controles consistentes a todos los archivos descargables.

### S14 — Baja: folios se repiten después de 999

**Evidencia:** el número se calcula con módulo 999 sobre el máximo histórico.

**Impacto:** tickets y búsquedas pueden tener folios ambiguos.

**Corrección requerida:** folio monotónico persistente, o folio compuesto por fecha y secuencia diaria.

## Hallazgos QA funcionales

### Q01 — La prueba oficial del repositorio está rota

La política actual exige mayúscula, minúscula y número, pero el fixture usa `prueba-segura`. Por ello `npm test` falla antes de ejecutar los cuatro casos. Una copia temporal con `Prueba-segura1` aprobó 4/4.

### Q02 — La prueba de inventario ya no valida la función actual

El caso “devuelve las existencias” añade un campo heredado al producto, pero `reserveInventory` y `restoreInventory` son funciones vacías y el inventario actual maneja materias primas independientes. La aserción solo comprueba que el valor enviado sigue presente.

### Q03 — La suite cubre pocos recorridos

No hay pruebas automáticas para creación/edición/eliminación de productos, tamaños de pizza, ingredientes de hamburguesa y su impresión, todos los métodos de pago, propinas y comisión, cierre de caja y su PDF, navegación desde mesas/resumen, contacto de recogida, cambio de contraseña, expiración, concurrencia, accesibilidad o inyección en tickets.

### Q04 — Los reportes PDF pierden acentos

Los PDF son válidos, multipágina, legibles y conservan el estilo visual. La normalización a fuentes estándar convierte textos como “Leña”, “Operación” y “Página” a versiones sin acento. Debe incrustarse una fuente con Unicode para conservar español correctamente.

### Q05 — El reporte histórico de corte solo está disponible en la sesión que lo cerró

El endpoint permite descargar exclusivamente el `lastClosedCashSessionId` guardado en memoria. Tras cerrar sesión o reiniciar el servidor ya no se puede volver a descargar ese corte, aunque exista en los datos.

### Q06 — La interfaz de pago usa alerta nativa

Un error de cobro llama `window.alert`, lo cual rompe el estilo del sistema y ofrece menos contexto que un mensaje accesible dentro del modal.

### Q07 — Controles personalizados con accesibilidad incompleta

El combobox no implementa navegación completa por flechas/Escape ni cierre al hacer clic fuera. Los modales carecen de trampa de foco y restauración del foco al cerrar.

### Q08 — Código heredado no utilizado

`src/ui/app.js` contiene una aplicación anterior completa, incluyendo conductas que ya no están conectadas. Aumenta el riesgo de mantener o auditar el archivo equivocado.

### Q09 — Recurso de favicon mal referenciado

`index.html` usa `/public/assets/portada-menu.jpeg`; en Vite los archivos de `public` se publican desde `/assets/...`.

### Q10 — Tamaño elevado del paquete principal

El JavaScript de producción mide aproximadamente 884 kB, 236 kB comprimido. Vite advierte que supera 500 kB. Conviene cargar Three.js y vistas administrativas bajo demanda.

### Q11 — El repositorio todavía no tiene una línea base versionada

Git está inicializado, pero todos los archivos del sistema aparecen sin seguimiento. Mientras no exista un primer commit revisado, Git no puede mostrar qué cambió, recuperar una versión conocida ni atribuir modificaciones. El `.gitignore` sí excluye datos locales, credenciales, dependencias y compilación.

## Revisión de reglas del restaurante

| Regla | Estado observado |
|---|---|
| Usuario administrador y contraseña fuerte | Implementado; hash `scrypt`, sal de 16 bytes y comparación constante |
| Apertura y cierre de caja | Implementado; requiere caja para cobrar |
| Separación Pizzas / Platillos / Bebidas | Implementado en interfaz y normalización |
| Teléfono de 10 dígitos | Implementado para domicilio y recogida telefónica; existe un registro histórico anterior con formato inválido |
| Tarjeta con 4 % | Cálculo implementado en servidor, pero parte de un subtotal no confiable |
| Propina tarjeta/transferencia | Implementada con límites básicos |
| Flujo domicilio con liquidación posterior | Implementado en interfaz; puede evadirse llamando la API |
| Una orden activa por mesa | Interfaz orientada a ello; servidor no lo garantiza |
| Hamburguesa imprime solo ingredientes retirados | La interfaz genera `Sin ingrediente`; falta prueba automática de ticket |
| Carta basada en `Menu_Completo` | 77/77 productos presentes; un suplemento tiene precio configurado distinto |
| Materias primas vacías y categorías libres | Implementado; aún no existe consumo por receta, según alcance actual |
| Reportes PDF/Excel | Implementados; PDF validado visualmente y Excel como XML Spreadsheet 2003 |

## Estado de la carta

- Versión de origen y versión almacenada: `Menu_Completo-2026-09-21-v3`.
- Productos esperados: 77.
- Productos actuales: 77.
- Faltantes: 0.
- Extras: 0.
- Registros estructuralmente inválidos en la comprobación básica: 0.
- Diferencia: `Orilla de queso (complemento)` tiene precios actuales de 30/50/70 frente a 35/50/60 en el origen. Esto parece una configuración posterior; debe confirmarse como decisión comercial.

Esta comprobación compara el almacén con `seed/menu_completo.json`, que es la fuente importada por el sistema. No constituye una nueva transcripción visual/OCR de las ocho imágenes originales.

## Plan de corrección recomendado

### Bloque P0 — antes de operación real

1. Recalcular en servidor productos, precios, estaciones, variantes y totales.
2. Sustituir el `PATCH` genérico por transiciones válidas por tipo de servicio.
3. Escapar o construir de forma segura todos los tickets.
4. Servir solo `dist` y recursos públicos.
5. Serializar escrituras o migrar la persistencia a SQLite.
6. Añadir pruebas negativas que demuestren que las cinco vulnerabilidades anteriores quedan rechazadas.

### Bloque P1 — seguridad operativa

1. Validar órdenes, carta, mesas, comensales, contacto y límites completos.
2. Evitar dos órdenes abiertas por mesa.
3. Corregir permisos de datos y cabeceras de descargas.
4. Añadir límite de acceso, bitácora y gestión de sesión expirada.
5. Reparar la suite oficial y reemplazar el caso obsoleto de inventario.

### Bloque P2 — calidad y mantenimiento

1. Crear pruebas E2E del navegador y medir cobertura real del servidor.
2. Mejorar accesibilidad de comboboxes y modales.
3. Habilitar consulta histórica segura de cortes.
4. Preservar acentos en PDF, corregir favicon y dividir el paquete JavaScript.
5. Retirar o archivar el frontend heredado cuando se confirme que no se usa.

## Criterio de salida para una segunda auditoría

La revisión puede considerarse aprobada cuando:

- ninguna solicitud puede fijar su propio precio, total, estación o estado;
- las transiciones inválidas responden 409/422 y no modifican datos;
- dos escrituras simultáneas no fallan ni pierden cambios;
- las notas y nombres con HTML se imprimen como texto;
- no se pueden descargar archivos fuera de `dist` y recursos públicos;
- `npm test` pasa desde un clon limpio;
- existen pruebas de los flujos de mesa, domicilio, recoger, caja, tarjeta, transferencia, propina, tickets y carta;
- el navegador completa los recorridos principales sin errores de consola y con navegación por teclado.

## Referencias

- [OWASP Application Security Verification Standard 5.0](https://owasp.org/projects/asvs/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP ASVS 5.0 — Fundamental Session Management Security](https://cornucopia.owasp.org/taxonomy/asvs-5.0/07-session-management/02-fundamental-session-management-security)
- [OWASP ASVS 5.0 — Security Events](https://cornucopia.owasp.org/taxonomy/asvs-5.0/16-security-logging-and-error-handling/03-security-events)
