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
  process.env.OWNCLOUD_URL || "http://95.111.226.24:81/remote.php/dav/files/test/",
  {
    username: process.env.OWNCLOUD_USERNAME || "test",
    password: process.env.OWNCLOUD_PASSWORD || "123456",
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
  }
);

module.exports = { owncloud };
