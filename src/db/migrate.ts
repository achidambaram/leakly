import { supabase } from "./index.js";

// Verify connection by checking if tables exist
async function checkConnection() {
  const { data, error } = await supabase.from("property_units").select("id").limit(1);
  if (error) {
    console.error("Supabase error:", error.message);
    console.error("Run supabase-migration.sql in the Supabase Dashboard SQL Editor first.");
    process.exit(1);
  }
  console.log("Supabase connected successfully.");
}

await checkConnection();
