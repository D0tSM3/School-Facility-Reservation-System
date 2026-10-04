const fs = require('fs');
const content = fs.readFileSync('public/js/booking.js', 'utf8');
if (content.includes('200')) {
    console.log('200 is in booking.js at indices:', [...content.matchAll(/200/g)].map(m => m.index));
    const indices = [...content.matchAll(/200/g)].map(m => m.index);
    indices.forEach(idx => console.log(content.substring(idx - 20, idx + 20)));
}
