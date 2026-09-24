# Guía futura: conectar pedidos de WhatsApp

La versión actual trabaja en este equipo y no se conecta a WhatsApp. El teléfono de pedidos que se mostrará en los tickets es **413-162-86-05**. Esta guía deja los pasos para una fase posterior, cuando el restaurante decida automatizar la recepción.

## Preparación

1. Confirmar que el restaurante controla el número **413-162-86-05** y decidir si se conectará una cuenta de WhatsApp Business mediante la plataforma oficial de Meta o un proveedor autorizado.
2. Revisar en Meta Business la titularidad del negocio, la verificación que solicite la plataforma, los permisos y el método de facturación vigentes.
3. Definir quién responderá los mensajes, en qué horario y qué casos deben pasar a una persona (cambios de ingredientes, alergias, direcciones incompletas, quejas y cancelaciones).
4. Mantener primero el número como dato impreso y de contacto; no registrar una integración externa hasta completar estas decisiones.

## Diseño de la integración

- Añadir un servicio del lado servidor para enviar y recibir mensajes. El navegador del punto de venta solo consultará las conversaciones y aprobará las órdenes.
- Recibir notificaciones en un endpoint HTTPS con verificación de la firma del proveedor. En desarrollo se puede usar un túnel temporal; producción requerirá un servidor público y una URL estable.
- Guardar tokens y secretos en variables de entorno del servidor. No incluirlos en JavaScript, `restaurante.json`, respaldos que descarga el navegador ni control de versiones.
- Registrar el identificador de cada mensaje recibido y procesarlo una sola vez. Las notificaciones repetidas deben responder con el resultado anterior para evitar pedidos duplicados.
- Asociar cada mensaje a un cliente y a una conversación. Conservar la hora, el estado de entrega del mensaje y las acciones que confirme un empleado.

## Flujo recomendado de pedidos

1. Responder con la carta y recopilar servicio (domicilio o recoger), platillos, variantes, tamaño, dirección y datos de contacto.
2. Convertir la conversación a un borrador con las mismas familias y precios de la carta local. Para el teléfono actual, una recogida solicitada por mensaje debe quedar marcada como **pedido telefónico / recoger en restaurante**.
3. Mostrar el borrador en el panel para que el administrador confirme precios, disponibilidad, comisión y forma de pago antes de enviarlo a cocina.
4. Confirmar al cliente solo después de que el panel acepte la comanda. En una fase futura, cuando un pedido para recoger termine su preparación, el servidor podrá enviar automáticamente el aviso para que el cliente pase por él. Mientras no exista esa conexión, el aviso se realiza mediante una llamada manual.
5. Configurar los mensajes plantilla y el consentimiento del cliente según las reglas vigentes de WhatsApp Business.

## Pruebas antes de activarla

- Usar un número de prueba y pedidos que no lleguen a la cocina real.
- Verificar mensajes repetidos, imágenes, texto libre, horarios sin atención, cambios de servicio, dirección incompleta y pérdida temporal de internet.
- Confirmar que una conversación no pueda crear un pedido pagado sin revisión del administrador.
- Medir costos de conversaciones y proveedor antes de habilitar el número del restaurante.

La conexión, los webhooks y el envío de mensajes no forman parte de este MVP local.
