window.openBookingModal = async function(roomId, rebookId = null) {
  if (roomId) window.bookingModalTargetRoomId = roomId;
  if (rebookId) window.bookingModalRebookId = rebookId;
  
  const container = document.getElementById('bookingModalContainer');
  if (!container) return;
  
  if (!container.hasChildNodes()) {
    try {
      const res = await fetch('book-room.html');
      container.innerHTML = await res.text();
      
      if (typeof window.initBookingForm === 'function') window.initBookingForm();
      if (typeof window.initBookingInlineScripts === 'function') window.initBookingInlineScripts();
      
      const modal = document.getElementById('bookingModalOverlay');
      const closeBtn = document.getElementById('closeBookingModalBtn');
      const cancelBtn = document.getElementById('cancelModalBtn');

      function closeModal() {
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
          // Clear it so reopening resets state (important for rebook vs normal)
          container.innerHTML = '';
        }
      }

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) {
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', closeModal);
      }
    } catch (e) {
      console.error('Failed to load modal', e);
      return;
    }
  }
  
  const modal = document.getElementById('bookingModalOverlay');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  
  const roomSelect = document.getElementById('roomSelect');
  if (roomSelect && roomId) {
    roomSelect.value = roomId;
    roomSelect.dispatchEvent(new Event('change'));
  }
};
