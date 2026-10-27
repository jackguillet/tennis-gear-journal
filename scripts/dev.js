// npm run dev -> http://localhost:3000
//   In-memory Postgres and a local stand-in for Neon Auth, unless you pass real ones:
//   USE_DATABASE_URL=1 (with DATABASE_URL) and NEON_AUTH_BASE_URL in .env.local.
import { startServer } from "./server.js";

const port = Number(process.env.PORT) || 3000;
const { origin, localAuth } = await startServer({ port, useDatabaseUrl: process.env.USE_DATABASE_URL === "1" });
console.log(`Stringbed Meter on ${origin}`);
console.log(localAuth ? "Accounts: local stand-in for Neon Auth (in memory)." : `Accounts: Neon Auth at ${process.env.NEON_AUTH_BASE_URL}`);
