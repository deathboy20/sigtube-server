const { createClient } = require("webdav");
const dotenv = require("dotenv");
const http = require("http");
const https = require("https");

dotenv.config();

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
