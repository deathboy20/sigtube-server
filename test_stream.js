const http = require('http');

const path = encodeURIComponent('/organizations/Marketing/images/2fe4f475-486d-491d-89c0-9c5d74c0ad32.jfif');
const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/files/stream?path=${path}`,
  method: 'GET',
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  
  res.on('data', (chunk) => {
    // console.log(`BODY: ${chunk}`);
  });
  
  res.on('end', () => {
    console.log('No more data in response.');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
