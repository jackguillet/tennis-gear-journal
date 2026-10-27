// Creates the tables now instead of on the first sync. Optional:
//   DATABASE_URL=postgres://... npm run db:migrate
import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";

await ensureSchema(db());
console.log("Tables are ready.");
