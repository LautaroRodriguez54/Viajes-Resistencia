# Registro de pruebas de carga

## 27/11/2026 — creación de viajes, rampa local

Entorno descartable en la computadora de desarrollo: backend Node 22.23.5, PostgreSQL/PostGIS en Docker, k6 2.4.0 y captura de logs con Alloy activa. Se utilizó una sola cuenta de pasajero de prueba y se llamó únicamente a `POST /viajes`. El backend y k6 se ejecutaron en la misma computadora; no se midieron CPU, memoria ni recursos de infraestructura. Es una medición local, no una capacidad de producción.

Escenario: `estres-viajes.js`; rampa progresiva de 0 a 2, 10 y 30 usuarios virtuales, 30 segundos de mantenimiento en cada nivel y descenso a 0. Cada usuario virtual hace una pausa de un segundo por iteración. Duración total aproximada: 2 min 30 s. Los umbrales del 1 % son provisionales.

| Medida | Resultado |
| --- | ---: |
| Solicitudes | 1.874 |
| Solicitudes por segundo (media de toda la rampa) | 12,43 |
| Viajes creados según comprobación HTTP 201 | 1.874 de 1.874 |
| Errores HTTP | 0 % |
| Tiempo medio HTTP | 8,39 ms |
| Tiempo p95 HTTP | 10,13 ms |
| Tiempo máximo HTTP | 125,43 ms |

Los percentiles y la tasa son agregados de toda la rampa; no permiten comparar por separado cada nivel de carga. No se alcanzó ni identificó un punto de saturación. Para concluir sobre estrés se requieren más repeticiones, escenarios más representativos, métricas de recursos y pruebas de mayor carga con un plan y límites acordados. Las solicitudes usaron siempre la misma cuenta, no simularon choferes ni asignaciones, y generaron datos en las bases de prueba.

Se hizo además una corrida exploratoria anterior con el backend en Node 24.20.0: 1.874 solicitudes, 0 % de errores, media 8,13 ms y p95 9,88 ms. Se conserva únicamente como referencia; Node 24 está fuera de la versión requerida y no se considera validación del proyecto.
