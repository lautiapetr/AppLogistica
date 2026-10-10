# LogisPro

Aplicación logística multiempresa construida con React, TypeScript, Vite y Supabase. La base de datos aplica aislamiento por empresa, permisos y mutaciones críticas mediante RLS y RPCs.

Las migraciones deben aplicarse en orden. Estadísticas V2 está validada hasta `202608270010_financial_statistics_export.sql`. La siguiente migración pendiente, `202608270011_company_holiday_calendar.sql`, inicia las extensiones de producto con un calendario empresarial de feriados tenant-safe y auditado. Después de cada migración pendiente, valida el flujo correspondiente en el proyecto Supabase antes de continuar con la siguiente fase.

## Frontend

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Mapas sin claves

Los mapas usan Leaflet/React-Leaflet con teselas estándar de OpenStreetMap. La
búsqueda de ciudades usa Nominatim únicamente cuando el usuario pulsa Buscar o
Enter, con caché local y límite de una consulta por segundo. No se necesita
ninguna API key.

Opcionalmente pueden configurarse `VITE_OSM_TILE_URL` y
`VITE_NOMINATIM_URL` para cambiar a otra infraestructura compatible sin tocar
el código. Debe conservarse siempre la atribución de OpenStreetMap y respetarse
la política del servidor elegido.

## Base Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
