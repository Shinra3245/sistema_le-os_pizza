# Pizzas a la Leña · sistema local

MVP local para tomar pedidos de mesa, domicilio y para recoger; configurar pizzas por tamaño, sabor completo o por mitades, comandear por estación, cobrar y hacer el corte de caja.

El frontend está construido con **React 19 y Vite**. Node.js mantiene el servidor local, las rutas API y los datos persistentes.

## Iniciar

Requiere Node.js 20 o posterior. Desde esta carpeta:

```bash
npm start
```

Abre `http://127.0.0.1:4173`. En el primer inicio, el usuario administrador es `pizzas` y el sistema te pedirá crear una contraseña. Al entrar se abre la caja con el fondo inicial del turno; registra el efectivo contado al terminar, revisa el corte y cierra la sesión. La contraseña se guarda como hash local en `data/auth.json`. El servidor escucha únicamente en el equipo local y las dependencias quedan instaladas con el proyecto, así que el sistema no requiere conexión a internet para operar después de ejecutar `npm install`. Los pedidos y ajustes se guardan en `data/restaurante.json`; respáldalo periódicamente o usa **Ajustes → Descargar respaldo**.

## Desarrollo con Vite

Para desarrollo con recarga automática, usa dos terminales:

```bash
npm run server
```

```bash
npm run dev
```

Vite se abre en `http://127.0.0.1:5173` y redirige las llamadas `/api` al servidor de Node.js en el puerto `4173`. Para operación normal basta `npm start`: compila React a `dist/` y sirve esa versión desde `http://127.0.0.1:4173`.

## Bloques de desarrollo

1. **Pedidos y carta — implementado:** mesa con número de comensales, domicilio con datos de entrega, para llevar, buscador/filtros, platillo libre y carta editable. La captura agrupa las variantes de papas, hamburguesas, ensaladas, pastas y limonadas/naranjadas bajo un producto general; sus opciones y precios se eligen en el panel de configuración. Los sabores de pizza también se agrupan en una sola opción; desde ahí se eligen tamaño, categoría y especialidad, una o dos mitades y orilla de queso. La ilustración de pepperoni permanece monocromática en pizza completa y usa tonos azul/rojo suaves cuando se divide en mitades. En tickets, la pizza partida se muestra como «sabor / sabor» sin etiquetas de mitades.
2. **Comandas y preparación — implementado:** al pulsar **Enviar a cocina**, el sistema imprime automáticamente una comanda independiente para cada estación: Pizzas, Platillos y Bebidas. Desde el detalle se termina toda la preparación en una sola acción y cada estación permite reimprimir su ticket.
3. **Caja y cobro — implementado:** apertura de turno con fondo inicial y corte con efectivo esperado, efectivo contado, diferencia, venta, comisión, propinas, pagos por método y pedidos aún en curso. Tarjeta agrega 4% al subtotal. Tarjeta y transferencia aceptan propina opcional como porcentaje entero o cantidad en pesos; efectivo calcula cambio. El corte se guarda con la cuenta administradora antes de cerrar sesión.
4. **Operación diaria — implementado:** en domicilio, al marcar la salida se imprime la cuenta que viaja con el pedido; la venta queda pendiente hasta que el repartidor regresa y entrega el dinero a caja. En pedidos para recoger, el aviso al cliente se realiza manualmente y el cobro se registra igual que en mesa. El historial identifica consumo en mesa, domicilio y recogida.
5. **Futuro — indicado:** integración con Facebook, WhatsApp e Instagram, pendiente de definir cuentas y flujo de autorización del restaurante. La guía de WhatsApp está en `docs/whatsapp-integracion-futura.md`.

La carta inicial de 77 productos y sus descripciones procede solo de las ocho láminas PNG de `../Menu_Completo`; no se importan los directorios `Menu_1` ni `Menu_2`. Los precios de pizza cambian por tamaño y categoría. El suplemento de orilla se agrega al tamaño elegido. En pizza mitad y mitad, se promedian los precios de los dos sabores. Los productos con variantes —como papas, hamburguesas, ensaladas, pastas y bebidas— se muestran como un producto general y se configuran dentro del pedido.

El teléfono del restaurante en los tickets y en el panel de Ajustes es **413-162-86-05**. La impresión genera comandas independientes por estación y una cuenta del cliente con detalle de comisión, propina y total cobrado.

## Impresión

La impresión usa el diálogo del navegador. Elige 58 mm u 80 mm en **Ajustes → Ancho del ticket** y selecciona el mismo ancho en las preferencias de la impresora. Las comandas de cocina muestran fecha, hora, servicio/mesa y platillos, sin número de venta, personas ni texto de verificación. Para domicilio, la cuenta con el total y la indicación de pago pendiente se imprime al marcar la salida; al regresar el repartidor se registra el dinero y se cierra el pedido. Para mesa y recoger, la cuenta se imprime al confirmar el pago.

## Límite actual del MVP

Los pedidos y ajustes están en archivos locales de esta computadora. El acceso actual usa la cuenta administradora local y no tiene sincronización remota ni envío automático a redes sociales. Una integración futura debe acordar primero dónde se recibirán pedidos y qué cuentas administrará el restaurante. El formato debe terminar de ajustarse con una prueba en la impresora térmica que usa el restaurante; desde aquí se puede revisar el diálogo de impresión, pero no confirmar el corte y avance físicos del papel.
