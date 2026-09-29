import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix ReferenceError for refreshBtn
js = js.replace("[batchApproveBtn, refreshBtn, exportLogBtn]", "[batchApproveBtn, exportLogBtn]")

# Remove any remaining refreshBtn logic block
js = re.sub(r"// Refresh\s*// -+\s*if \(refreshBtn\) \{.*?(?=(// ---------------------------------------------------------------|// Export Global API))", "", js, flags=re.DOTALL)

# Fix the broken `if (batchApproveBtn) {` block that I accidentally created
# Let's find the spot where I injected searchInput
search_injection = """  if (batchApproveBtn) {
      
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = (e.target.value || '').trim().toLowerCase();
        renderAll();
      });
    }"""
js = js.replace(search_injection, """  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = (e.target.value || '').trim().toLowerCase();
      renderAll();
    });
  }""")

# Now let's completely replace the old batchApproveBtn handler!
# First, remove the old one. It starts around `if (batchApproveBtn) batchApproveBtn.addEventListener('click', async () => {`
# and ends with `await loadAll();\n    });`
old_batch_pattern = r"if \(batchApproveBtn\) batchApproveBtn\.addEventListener\('click', async \(\) => \{.*?await loadAll\(\);\n\s*\}\);"
js = re.sub(old_batch_pattern, "", js, flags=re.DOTALL)

# Also remove the `batchApproveLabel` assignments in `renderPending` because they interfere
js = re.sub(r"if \(batchApproveLabel\) \{.*?batchApproveLabel\.textContent = pending\.length.*?\}", "", js, flags=re.DOTALL)
js = js.replace("if (batchApproveBtn) batchApproveBtn.disabled = pending.length === 0;", "")

# Now define `updateBatchButton` and the NEW batch approve logic, right before the export block
batch_logic = """
  // ---------------------------------------------------------------
  // Batch approve
  // ---------------------------------------------------------------
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

  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', async () => {
      const checked = Array.from(document.querySelectorAll('.batch-checkbox:checked')).map(cb => cb.value);
      if (checked.length === 0) return;

      if (!window.confirm(`Approve the ${checked.length} selected reservation(s)?`)) return;

      batchApproveBtn.disabled = true;
      batchApproveLabel.textContent = 'Processing...';

      let successCount = 0;
      let failCount = 0;
      for (const id of checked) {
        try {
          const res = await api(`/api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Approved', staff_comment: 'Batch approved' })
          });
          if (res.ok) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
      }

      if (successCount > 0) {
        showToast(`Successfully approved ${successCount} reservations.`, 'success');
      }
      if (failCount > 0) {
        showToast(`Failed to approve ${failCount} reservations.`, 'error');
      }
      
      batchApproveLabel.textContent = 'Approve Selected';
      await loadAll();
    });
  }
"""

js = js.replace("// ---------------------------------------------------------------\n  // Export Global API", batch_logic + "\n  // ---------------------------------------------------------------\n  // Export Global API")


with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
