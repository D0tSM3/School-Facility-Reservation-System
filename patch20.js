const fs = require('fs');
let content = fs.readFileSync('public/js/reservations.js', 'utf8');
content = content.replace(/â€“/g, '\u2013');
content = content.replace(/Ã¢â‚¬â€/g, '\u2014');
fs.writeFileSync('public/js/reservations.js', content, 'utf8');
