# Plan de Implementación - Optimización de Costos de IA
## Proyecto: CogniFlow

# Objetivo

Implementar un conjunto de mejoras relacionadas con:

- Optimización del consumo de tokens.
- Disminución del costo de llamadas a Anthropic.
- Sistema de cache de respuestas.
- Sistema de monitoreo de consumo.
- Cuotas simuladas por usuario.
- Dashboard financiero de IA.

IMPORTANTE:

Antes de modificar código:

1. Analizar toda la estructura actual del proyecto.
2. Reutilizar componentes existentes.
3. Mantener el estilo de código.
4. No romper funcionalidades existentes.
5. No duplicar lógica.

---

# ETAPA 1 - Auditoría del proyecto

Primero recorrer el proyecto completo.

Identificar:

- endpoints existentes
- estructura Express
- pool.query
- clasificación de leads
- uso actual de Anthropic
- variables de entorno
- frontend React
- hooks existentes
- componentes reutilizables
- páginas existentes

Documentar mentalmente dónde implementar cada mejora.

No crear código nuevo si ya existe algo reutilizable.

---

# ETAPA 2 - Optimización de llamadas a Anthropic

## 2.1 Modelo

Verificar que el modelo utilizado sea:

```
claude-haiku-4-5
```

Solo cambiarlo si actualmente usa un modelo más caro.

---

## 2.2 Reducir contexto

Actualmente solamente deben enviarse los últimos mensajes relevantes.

Implementar:

```
chat_history.slice(-3)
```

si todavía no existe.

Nunca enviar historiales completos.

---

## 2.3 Limitar salida

Agregar

```
max_tokens: 300
```

o verificar que exista.

Debe existir un límite duro.

---

## 2.4 JSON Schema

La respuesta del modelo debe utilizar

```
output_config.format = json_schema
```

No utilizar respuestas libres.

El objetivo es:

- menor costo
- respuestas predecibles
- fácil parseo

---

# ETAPA 3 - Prompt Caching (Anthropic)

Analizar el prompt actual.

Separarlo en dos bloques.

Bloque A (cacheable):

- instrucciones del sistema
- reglas
- contexto fijo

Bloque B:

- información dinámica
- lead
- mensajes

Marcar únicamente el bloque fijo como cacheable utilizando cache_control.

No modificar el contenido del prompt.

Solo reorganizarlo.

---

# ETAPA 4 - Cache de Respuestas (Application Cache)

Implementar patrón Cache Aside.

Flujo:

1 Buscar cache.

2 Si existe

Devolver resultado.

No llamar Anthropic.

3 Si no existe

Llamar Anthropic.

Guardar respuesta.

Responder.

---

## Clave del cache

La clave debe construirse utilizando:

- modelo
- prompt
- contenido del lead

Generar hash SHA256.

Ejemplo conceptual:

```
hash(
modelo +
prompt +
lead
)
```

---

## TTL

Configurable.

Ejemplo:

24 horas.

---

## Estadísticas

Registrar:

cache_hit

cache_miss

cache_saved_tokens

cache_saved_calls

---

# ETAPA 5 - Evitar llamadas duplicadas

Antes de clasificar:

Verificar si ya existe exactamente la misma clasificación reciente.

Si existe:

reutilizar.

Si no:

clasificar.

Nunca pagar dos veces por el mismo input.

---

# ETAPA 6 - Sistema de precios

Crear un archivo de configuración.

Ejemplo:

```
config/modelPrices.ts
```

Debe contener algo similar a:

```
{
  "claude-haiku-4-5": {
      input: ...,
      output: ...
  }
}
```

No hardcodear precios en varios lugares.

Centralizar.

---

# ETAPA 7 - Cálculo de costos

Cada clasificación deberá calcular:

- tokens entrada
- tokens salida
- costo input
- costo output
- costo total

Guardar:

```
estimated_cost_usd
```

o calcularlo dinámicamente.

---

# ETAPA 8 - Cuota simulada

Implementar cuota mensual.

Ejemplo:

10000 tokens.

Debe ser configurable.

---

Cuando el usuario supere la cuota:

Mostrar advertencia visible.

El equipo puede elegir:

- bloquear
- permitir continuar

Pero la decisión debe ser visible.

Nunca silenciosa.

---

# ETAPA 9 - Endpoint de consumo

Crear endpoint nuevo.

Ejemplo:

```
GET /api/usage
```

Reutilizar el patrón existente.

Consulta base:

```sql
SELECT
user_id,
DATE(created_at) AS dia,
model_used,
SUM(tokens_used) AS tokens,
COUNT(*) AS llamadas
FROM classifications
WHERE user_id = $1
GROUP BY
user_id,
dia,
model_used
ORDER BY dia DESC;
```

---

El endpoint debe devolver además:

- costo diario
- costo total
- tokens
- llamadas
- cache hits
- cache misses
- ahorro por cache

---

# ETAPA 10 - Dashboard Frontend

Crear una nueva página.

Reutilizar:

- hooks
- layouts
- tablas
- cards

No crear componentes repetidos.

---

Mostrar:

## Consumo diario

- tokens

- costo USD

- llamadas

---

## Consumo mensual

- total tokens

- total USD

---

## Cuota

Barra de progreso.

Ejemplo

████████░░

75%

---

## Cache

Mostrar:

Cache Hits

Cache Misses

Llamadas evitadas

Tokens ahorrados

USD ahorrados

---

## Gráficos

Si el proyecto ya usa alguna librería de gráficos:

reutilizarla.

No agregar otra.

Mostrar:

- consumo diario

- costo diario

---

# ETAPA 11 - Estadísticas

Agregar métricas.

Ejemplo:

```
total_calls

cached_calls

saved_calls

saved_tokens

saved_usd

average_cost

average_tokens
```

---

# ETAPA 12 - Variables de entorno

Agregar:

```
MONTHLY_TOKEN_QUOTA

CACHE_TTL

ENABLE_CACHE

ENABLE_PROMPT_CACHE
```

Nunca hardcodear.

---

# ETAPA 13 - Logging

Agregar logs únicamente en desarrollo.

Mostrar:

Cache Hit

Cache Miss

Costo calculado

Tokens utilizados

Modelo

Tiempo de respuesta

No imprimir API Keys.

---

# ETAPA 14 - Seguridad

Revisar:

- API Keys

- Rotación de claves

- Variables de entorno

- Principio de mínimo privilegio

Nunca dejar secretos en el código.

---

# ETAPA 15 - Testing

Verificar:

✔ clasificación normal

✔ cache hit

✔ cache miss

✔ cálculo de costos

✔ cuota

✔ endpoint

✔ frontend

✔ dashboard

✔ estadísticas

---

# ETAPA 16 - Refactor

Antes de finalizar:

Eliminar código duplicado.

Extraer funciones reutilizables.

Mantener consistencia.

Ejecutar lint.

Ejecutar tests.

---

# Resultado esperado

El sistema deberá ser capaz de:

✔ Clasificar utilizando Claude Haiku.

✔ Reducir consumo de tokens.

✔ Limitar salida.

✔ Utilizar JSON Schema.

✔ Aprovechar Prompt Cache.

✔ Implementar Response Cache.

✔ Evitar llamadas duplicadas.

✔ Calcular costos reales.

✔ Simular cuotas mensuales.

✔ Mostrar dashboard financiero.

✔ Medir ahorro por cache.

✔ Mantener compatibilidad con el código existente.

No romper funcionalidades previas.

Priorizar reutilización de código antes que crear nuevas implementaciones.