/* Small safe-text list popover for crowded booking clusters. */
(function (root) {
  'use strict';
  const esc = v => String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function open(anchor, items) {
    close(); const pop=document.createElement('div'); pop.className='mc-more-popover'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','More bookings');
    pop.innerHTML='<button type="button" class="mc-more-close" aria-label="Close">×</button><strong>Bookings at this time</strong><ul>'+items.map(x=>'<li><b>'+esc(x.title||'Reserved')+'</b><span>'+esc(x.detail||'')+'</span></li>').join('')+'</ul>';
    document.body.appendChild(pop); const r=anchor.getBoundingClientRect(); pop.style.left=Math.min(r.left,window.innerWidth-pop.offsetWidth-12)+'px'; pop.style.top=Math.min(r.bottom+6,window.innerHeight-pop.offsetHeight-12)+'px';
    pop.querySelector('button').addEventListener('click',close); return pop;
  }
  function close(){document.querySelectorAll('.mc-more-popover').forEach(x=>x.remove());}
  root.MCPopover=Object.freeze({open,close});
})(window);
