const dotenv = require('dotenv');

const result = dotenv.config();
if (result.error) {
  console.warn('Warning: .env file not found or could not be loaded.');
}

module.exports = {
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGODB_URI,
  whatsappApiUrl: process.env.WHATSAPP_API_URL,
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappGroupId: process.env.WHATSAPP_GROUP_ID,
  whatsappProvider:
    process.env.WHATSAPP_PROVIDER ||
    (/graph\.facebook\.com/i.test(process.env.WHATSAPP_API_URL || '')
      ? 'meta'
      : 'whapi'),
  adminNumber: process.env.ADMIN_PHONE_NUMBER,
  adminSecret: process.env.ADMIN_SECRET,
  checkIntervalSeconds: Number(process.env.CHECK_INTERVAL_SECONDS || 5),
};
