import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Update unit_1a to use Arjun's Gmail
  const { error } = await supabase
    .from("property_units")
    .update({ tenant_email: "achidambers@gmail.com", tenant_name: "Arjun Chidambaram" })
    .eq("id", "unit_1a");
  console.log("Updated unit_1a tenant:", error ? error.message : "OK");

  // Verify
  const { data } = await supabase.from("property_units").select("*").eq("id", "unit_1a").single();
  console.log("Unit:", data);
}

main();
