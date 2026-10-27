import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Auth (managed Better Auth): accounts for you and your friends.
  // Postgres is always on; the app reads DATABASE_URL.
  auth: true,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
