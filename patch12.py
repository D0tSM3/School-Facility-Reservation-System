import os
import re

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """          if (reservation.is_consecutive) {
             datesText = `${monthFirst} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`;
          } else {
             datesText = reservation.datesObj.map(d => `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`).join(', ') + `, ${first.getFullYear()}`;
          }"""

replace = """          if (reservation.is_consecutive) {
             const mFirst = first.toLocaleDateString('en-US', { month: 'short' });
             const mLast = last.toLocaleDateString('en-US', { month: 'short' });
             const yFirst = first.getFullYear();
             const yLast = last.getFullYear();
             
             if (yFirst !== yLast) {
                 datesText = `${mFirst} ${first.getDate()}, ${yFirst} – ${mLast} ${last.getDate()}, ${yLast}`;
             } else if (mFirst !== mLast) {
                 datesText = `${mFirst} ${first.getDate()} – ${mLast} ${last.getDate()}, ${yFirst}`;
             } else {
                 datesText = `${mFirst} ${first.getDate()}–${last.getDate()}, ${yFirst}`;
             }
          } else {
             datesText = reservation.datesObj.map(d => `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`).join(', ') + `, ${first.getFullYear()}`;
          }"""

content = content.replace(find, replace)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
