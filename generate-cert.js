const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'HackedVault Dev' },
    { name: 'organizationalUnitName', value: 'Development' }
];

const pems = selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 365,
    keySize: 2048,
});

const certDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir);
}

fs.writeFileSync(path.join(certDir, 'private-key.pem'), pems.private);
fs.writeFileSync(path.join(certDir, 'public-cert.pem'), pems.cert);

console.log('SSL certificates generated successfully in ./certs directory');
