import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Update Alice's tenant email to the test tenant inbox
  const { error: e1 } = await supabase
    .from("property_units")
    .update({ tenant_email: "tastyhand664@agentmail.to" })
    .eq("id", "unit_1a");
  console.log("Updated tenant email:", e1 ? e1.message : "OK");

  // Update plumber vendor email to the test vendor inbox
  const { error: e2 } = await supabase
    .from("vendors")
    .update({ email: "magnificentnight712@agentmail.to" })
    .eq("id", "vendor_plumb_01");
  console.log("Updated vendor email:", e2 ? e2.message : "OK");

  // Verify
  const { data: unit } = await supabase.from("property_units").select("id, tenant_email, tenant_name").eq("id", "unit_1a").single();
  const { data: vendor } = await supabase.from("vendors").select("id, name, email").eq("id", "vendor_plumb_01").single();
  console.log("\nTenant:", unit);
  console.log("Vendor:", vendor);
}

main();
