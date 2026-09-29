import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# 1. Remove refreshBtn variable and event listener
js = re.sub(r"const refreshBtn\s*=\s*el\('btn-refresh-queue'\);\n", "", js)
js = re.sub(r"const refreshIcon\s*=\s*el\('btn-refresh-icon'\);\n", "", js)
js = re.sub(r"if \(refreshBtn\) refreshBtn\.addEventListener\('click', \(\) => loadAll\(\{ notify: true \}\)\);\n", "", js)

# 2. Add searchInput state and listener
js = js.replace("const batchApproveBtn   = el('btn-batch-approve');", "const batchApproveBtn   = el('btn-batch-approve');\n  const searchInput       = el('searchInput');")
js = js.replace("loading: false", "loading: false,\n    searchQuery: ''")

# Add search listener
js = js.replace("if (batchApproveBtn) batchApproveBtn.addEventListener(", """
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = (e.target.value || '').trim().toLowerCase();
      renderAll();
    });
  }

  if (batchApproveBtn) batchApproveBtn.addEventListener(""")

# 3. Add checkboxes to reservationCard
# Find `<span class="px-2 py-1 rounded ${status.badgeClass}...` inside reservationCard
card_header_pattern = r'(<span class="px-2 py-1 rounded \$\{status\.badgeClass\}[^>]+>\$\{status\.label\}</span>)'
card_header_replacement = r'${isPending ? `<input type="checkbox" value="${id}" class="batch-checkbox w-4 h-4 text-[#7a1f2b] bg-gray-50 border-gray-300 rounded focus:ring-[#7a1f2b] cursor-pointer" onchange="window.CampusRoomStaff.updateBatchButton()">` : ""}\n                \1'
js = re.sub(card_header_pattern, card_header_replacement, js)

# 4. Filter logic in renderPending, renderMoves, renderCancelRequests
# Helper for filtering
filter_helper = """
  function matchSearch(obj) {
    if (!state.searchQuery) return true;
    const q = state.searchQuery;
    const fields = [
      obj.reservation_id,
      obj.customer_name,
      obj.customer_email,
      obj.room_name,
      obj.purpose,
      obj.room_type,
      obj.customer_reason,
      obj.staff_comment
    ];
    return fields.some(f => f && String(f).toLowerCase().includes(q));
  }

  function renderPending() {"""
js = js.replace("function renderPending() {", filter_helper)

# Apply filter to lists
js = js.replace("const pending = state.reservations.filter((r) => r.status === 'Pending');", "const pending = state.reservations.filter((r) => r.status === 'Pending' && matchSearch(r));")
js = js.replace("viewMoves.innerHTML = state.moveRequests.length", "const moves = state.moveRequests.filter(matchSearch);\n    viewMoves.innerHTML = moves.length")
js = js.replace("state.moveRequests.map(moveCard).join('')", "moves.map(moveCard).join('')")
js = js.replace("viewCancels.innerHTML = state.cancelRequests.length", "const cancels = state.cancelRequests.filter(matchSearch);\n    viewCancels.innerHTML = cancels.length")
js = js.replace("state.cancelRequests.map(cancelRequestCard).join('')", "cancels.map(cancelRequestCard).join('')")

# 5. updateBatchButton and batchApproveBtn handler
batch_logic = """
  function updateBatchButton() {
    if (!batchApproveBtn || !batchApproveLabel) return;
    const checkedCount = document.querySelectorAll('.batch-checkbox:checked').length;
    if (checkedCount > 0) {
      batchApproveBtn.disabled = false;
      batchApproveLabel.textContent = `Approve Selected (${checkedCount})`;
    } else {
      batchApproveBtn.disabled = true;
      batchApproveLabel.textContent = 'Approve Selected';
    }
  }

  if (batchApproveBtn) batchApproveBtn.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.batch-checkbox:checked')).map(cb => cb.value);
    if (checked.length === 0) return;

    if (!window.confirm(`Approve the ${checked.length} selected reservation(s)?`)) return;

    batchApproveBtn.disabled = true;
    const originalText = batchApproveLabel.textContent;
    batchApproveLabel.textContent = 'Processing...';

    let successCount = 0;
    for (const id of checked) {
      try {
        const res = await api(`/api/reservations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved', staff_comment: 'Batch approved' })
        });
        if (res.ok) successCount++;
      } catch (e) {
        console.error('Batch approve failed for', id, e);
      }
    }

    if (successCount > 0) {
      showToast(`Successfully approved ${successCount} reservations.`, 'success');
    }
    
    batchApproveLabel.textContent = 'Approve Selected';
    await loadAll();
    updateBatchButton();
  });
"""

# Replace the old batchApproveBtn handler
js = re.sub(
    r"if \(batchApproveBtn\) batchApproveBtn\.addEventListener\('click', async \(\) => \{.*?await loadAll\(\);\n\s*\}\);\n",
    batch_logic,
    js,
    flags=re.DOTALL
)

# 6. Export updateBatchButton
js = js.replace("toggleFacility", "toggleFacility,\n    updateBatchButton")

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
