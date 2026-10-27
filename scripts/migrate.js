// Creates the tables now instead of on the first sync. Optional. Uses the direct
// (unpooled) connection, as Neon recommends for schema changes:
//   npm run db:migrate   (reads DATABASE_URL_UNPOOLED, then DATABASE_URL)
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
const { db } = await import("../lib/db.js");
import { ensureSchema } from "../lib/schema.js";

await ensureSchema(db());
console.log("Tables are ready.");
process.exit(0);
