/* Accessible week strip renderer; caller supplies already-loaded booking counts. */
(function (root) {
  'use strict';
  function render(container, days, selected, today, onSelect) {
    if (!container) return;
    container.innerHTML = days.map(d => {
      const n = Math.max(0, Number(d.count)||0), dots = Array.from({length:Math.min(3,n)},()=>'<i aria-hidden="true"></i>').join('');
      return '<button type="button" class="mc-daystrip-day'+(d.date===selected?' is-selected':'')+(d.date===today?' is-today':'')+(d.weekend?' is-weekend':'')+'" data-date="'+d.date+'" aria-pressed="'+(d.date===selected)+'" aria-label="'+d.label+' '+d.day+(d.date===today?' (today)':'')+'"><span class="mc-daystrip-dow">'+d.label+'</span><b>'+d.day+'</b><span class="mc-daystrip-dots">'+dots+(n>3?'<em>+</em>':'')+'</span></button>';
    }).join('');
    container.querySelectorAll('[data-date]').forEach(b=>b.addEventListener('click',()=>onSelect(b.dataset.date)));
  }
  root.MCDayStrip = Object.freeze({ render });
})(window);
