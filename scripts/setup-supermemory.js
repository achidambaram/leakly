require('dotenv').config();

async function setupSupermemory() {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) {
    console.error('Missing SUPERMEMORY_API_KEY in .env');
    process.exit(1);
  }

  // Step 1: Configure settings with filterPrompt
  console.log('Configuring Supermemory settings...');
  const settingsRes = await fetch('https://api.supermemory.ai/v3/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-supermemory-api-key': apiKey,
    },
    body: JSON.stringify({
      shouldLLMFilter: true,
      filterPrompt: `This is Leakly, an autonomous property maintenance dispatcher. containerTag is a property unit ID (e.g., "unit_2b"). We store tenant maintenance request history, unit repair history, vendor performance data, and property rules. Metadata includes tenantId, vendorId, propertyId, and category (plumbing, electrical, hvac, appliance, structural, pest, general).`,
    }),
  });

  if (!settingsRes.ok) {
    console.error('Failed to configure settings:', settingsRes.status, await settingsRes.text());
    process.exit(1);
  }
  console.log('Settings configured successfully.');

  // Step 2: Add test memory to verify connection
  console.log('Adding test memory...');
  const addRes = await fetch('https://api.supermemory.ai/v3/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-supermemory-api-key': apiKey,
    },
    body: JSON.stringify({
      content: 'Unit 2B had a plumbing leak in the kitchen sink. QuickFix Plumbing responded within 2 hours and fixed it for $180. Tenant: jane@example.com. The issue was a corroded pipe under the sink.',
      containerTag: 'unit_2b',
      metadata: {
        tenantId: 'tenant_jane',
        vendorId: 'vendor_quickfix',
        propertyId: 'prop_123',
        category: 'plumbing',
      },
    }),
  });

  if (!addRes.ok) {
    console.error('Failed to add memory:', addRes.status, await addRes.text());
    process.exit(1);
  }
  const addData = await addRes.json();
  console.log('Test memory added:', addData);

  // Step 3: Test retrieval with profile
  console.log('Testing profile retrieval...');
  // Give it a moment to index
  await new Promise((r) => setTimeout(r, 2000));

  const profileRes = await fetch('https://api.supermemory.ai/v4/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-supermemory-api-key': apiKey,
    },
    body: JSON.stringify({
      containerTag: 'unit_2b',
      q: 'plumbing issues in this unit',
    }),
  });

  if (!profileRes.ok) {
    console.error('Failed to get profile:', profileRes.status, await profileRes.text());
    process.exit(1);
  }
  const profileData = await profileRes.json();
  console.log('\nProfile data:');
  console.log('Static facts:', JSON.stringify(profileData.profile?.static, null, 2));
  console.log('Dynamic context:', JSON.stringify(profileData.profile?.dynamic, null, 2));
  if (profileData.searchResults) {
    console.log('Search results:', profileData.searchResults.results?.length, 'found');
  }

  console.log('\nSupermemory setup complete!');
}

setupSupermemory().catch(console.error);
