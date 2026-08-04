# Security Checklist (Etapa 14)

Checklist aplicado para el módulo de optimización IA en `crm-cogniflow`.

## 1) API keys y secretos

- [x] `ANTHROPIC_API_KEY` se consume solo por variable de entorno.
- [x] No se imprimen claves ni tokens en logs.
- [x] Se evita incluir secretos en `README.md`, migraciones o código.

## 2) Variables de entorno

- [x] Variables nuevas documentadas en `backend/.env.example`.
- [x] Variables nuevas documentadas en `README.md`.
- [x] Valores por defecto seguros para entorno local.

## 3) Logging y exposición de datos

- [x] Logs de cache/costo/timing solo en desarrollo (`NODE_ENV !== 'production'`).
- [x] Errores del proveedor IA se traducen a `502` genérico (`AppError`) sin filtrar internals.

## 4) Principio de mínimo privilegio

- [x] El servicio de clasificaciones depende de repositorios/cliente IA por inyección, sin acceso global innecesario.
- [x] El endpoint de uso requiere autenticación (`requireAuth`) vía rutas de clasificaciones.

## 5) Recomendaciones operativas (pendientes para producción)

- [ ] Rotar `ANTHROPIC_API_KEY` periódicamente.
- [ ] Separar keys por entorno (dev/staging/prod).
- [ ] Habilitar alerta cuando `cache_miss` o `estimated_cost_usd` superen umbral.
- [ ] Evaluar cache distribuido (Redis) si se escala a múltiples instancias.
