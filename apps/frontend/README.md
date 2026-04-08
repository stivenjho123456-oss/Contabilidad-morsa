# Frontend

Frontend React + Vite de Contabilidad Morsa.

## Desarrollo local

```bash
npm install
npm run dev
```

## Variables de entorno

Usa `.env` o variables del proveedor de hosting.

Ejemplo:

```text
VITE_API_URL=https://tu-api.example.com
```

Si `VITE_API_URL` no está definida, en desarrollo local el frontend usa `http://127.0.0.1:8010` cuando corre en `127.0.0.1:5175`.

## Build

```bash
npm run build
```

## Vercel

Configuración recomendada:

- Root Directory: `apps/frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
