# 3D Memory World

This workspace contains Shaivi's 3D Memory World inside the unified Mariinsky
project. Use the scripts from the repository root:

```bash
npm run dev
```

Mariinsky is served at `http://localhost:5173/` and this workspace is mounted at
`http://localhost:5173/world/`. Both applications and their API routes run in
the same Express process.

`npm start` builds this workspace and launches the combined production server.
The world's Supabase and Gemini configuration belongs in the ignored
`world/.env.local` file; required variable names are listed in the root
`.env.example`.
