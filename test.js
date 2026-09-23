const mongoose = require('mongoose');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

async function fetchTokens() {
  try {
    await mongoose.connect(process.env.DATABASE_URL || '');
    const customDomain = 'masheco.tech';
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;

    console.log(`Fetching latest tokens for ${customDomain}...`);
    const res = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames?hostname=${customDomain}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const cfData = res.data.result[0];
    if (cfData) {
      const validationRecords = [...(cfData?.ssl?.validation_records || [])];
      
      if (cfData?.ownership_verification) {
        validationRecords.push({
          txt_name: cfData.ownership_verification.name,
          txt_value: cfData.ownership_verification.value
        });
      }
      if (cfData?.ownership_verification_http) {
        validationRecords.push({
          http_url: cfData.ownership_verification_http.http_url,
          http_body: cfData.ownership_verification_http.http_body
        });
      }

      console.log(`Saving updated records to Database...`);
      const db = mongoose.connection.db;
      await db.collection('tenants').updateOne(
        { customDomain: customDomain },
        { $set: { 
            sslValidationRecords: validationRecords 
          } 
        }
      );

      console.log('Database updated successfully with latest tokens!');
      console.log(JSON.stringify(validationRecords, null, 2));
    }
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
  } finally {
    mongoose.disconnect();
  }
}

fetchTokens();
