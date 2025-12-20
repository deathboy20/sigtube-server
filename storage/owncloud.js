const { createClient } = require("webdav");
const dotenv = require("dotenv");
const http = require("http");
const https = require("https");

dotenv.config();

// Verify required environment variables
const requiredEnv = ['OWNCLOUD_URL', 'OWNCLOUD_USERNAME', 'OWNCLOUD_PASSWORD'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(`Critical Error: Missing environment variables: ${missingEnv.join(', ')}`);
}

const agentOptions = {
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000, // 60s socket timeout
};

const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

const owncloud = createClient(
  process.env.OWNCLOUD_URL,
  {
    username: process.env.OWNCLOUD_USERNAME,
    password: process.env.OWNCLOUD_PASSWORD,
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
  }
);

module.exports = { owncloud };
