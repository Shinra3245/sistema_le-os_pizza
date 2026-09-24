# Recomendaciones visuales aplicadas

El sistema conserva la paleta crema, verde bosque y dorado del restaurante. Estas cinco mejoras mantienen ese lenguaje y reducen errores al capturar pedidos:

1. **Estados visibles en botones.** Usar una elevación sutil al pasar el cursor, un anillo de foco y un cambio de fondo para que cada acción tenga respuesta inmediata, incluida la navegación con teclado.
2. **Selectores con una sola lectura.** Mantener la flecha personalizada, una altura consistente y un borde verde tenue al enfocar. Las opciones de bebidas e ingredientes se presentan primero como tarjetas para evitar listas extensas y repetitivas.
3. **Checkboxes como controles de inclusión.** Mostrar una casilla verde con marca cuando el ingrediente está incluido y una tarjeta atenuada cuando se desmarca. El texto explica que las notas siguen disponibles para instrucciones adicionales.
4. **Tarjetas con jerarquía.** Reservar el color de fondo para la selección activa, usar iconos Tabler del mismo trazo y conservar un precio alineado al final. El estado libre/ocupado de mesas usa verde y terracota con etiquetas y punto de estado.
5. **Transiciones cortas y consistentes.** Animar entrada de secciones, hover y selección entre 160 y 220 ms, sin desplazar el contenido de forma brusca. La animación 2D de pizza queda reservada para la configuración de pizzas, donde aporta información.

## Verificación

- Los estilos de foco son visibles en botones, tarjetas, selects y checkboxes.
- Las tarjetas de bebidas muestran categorías **Sin alcohol** y **Alcohol** en una sola selección.
- Las hamburguesas muestran ingredientes incluidos/desmarcables y conservan **Nota para cocina**.
- Los iconos de platillos se sirven desde `public/assets/icons/` con el mismo set Tabler, color heredado y tamaño normalizado por CSS.

## Variantes para elegir

Las previsualizaciones completas se encuentran en [`opciones-visuales/`](./opciones-visuales/). Cada opción contiene capturas del resumen, pedido, hamburguesa y bebidas. La aplicación base se mantiene activa mientras se elige una variante.
