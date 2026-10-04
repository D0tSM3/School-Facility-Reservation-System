import os
import re

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

def replacer(m):
    return """        let datesText = '';
        if (reservation.is_consecutive) {
           const mFirst = first.toLocaleDateString('en-US', { month: 'short' });
           const mLast = last.toLocaleDateString('en-US', { month: 'short' });
           const yFirst = first.getFullYear();
           const yLast = last.getFullYear();
           
           if (yFirst !== yLast) {
               datesText = `${mFirst} ${first.getDate()}, ${yFirst} \u2013 ${mLast} ${last.getDate()}, ${yLast}`;
           } else if (mFirst !== mLast) {
               datesText = `${mFirst} ${first.getDate()} \u2013 ${mLast} ${last.getDate()}, ${yFirst}`;
           } else {
               datesText = `${mFirst} ${first.getDate()}\u2013${last.getDate()}, ${yFirst}`;
           }
        } else {
           datesText = reservation.datesObj.map(d => `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`).join(', ') + `, ${first.getFullYear()}`;
        }"""

pattern = re.compile(r'        let datesText = \'\';\s*if \(reservation\.is_consecutive\) \{.*?\} else \{.*?\)', re.DOTALL)
content = pattern.sub(replacer, content)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
