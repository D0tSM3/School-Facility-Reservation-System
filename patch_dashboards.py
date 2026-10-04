import os
import glob

for js_file in glob.glob('public/js/*-dashboard.js'):
    with open(js_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern 1
    find1 = "<p><strong>Requester:</strong> ${escapeHtml(req.customer_name)} (${escapeHtml(req.customer_email)})</p>"
    replace1 = "<p><strong>Requester:</strong> ${escapeHtml(req.customer_name)} (${escapeHtml(req.customer_email)})<br><span class=\"text-xs text-gray-500\">Account Type: ${escapeHtml(req.customer_account_type || 'Student')}</span></p>"
    
    # Pattern 2
    find2 = "<div><span class=\"font-semibold text-gray-900\">Requester:</span> ${escapeHtml(req.requester_name || 'Requester')} (${escapeHtml(req.requester_email || '?')})</div>"
    replace2 = "<div><span class=\"font-semibold text-gray-900\">Requester:</span> ${escapeHtml(req.requester_name || 'Requester')} (${escapeHtml(req.requester_email || '?')})<br><span class=\"text-xs text-gray-500\">Account Type: ${escapeHtml(req.requester_account_type || 'Student')}</span></div>"
    
    # Pattern 3
    find3 = "<span class=\"text-gray-400 block\">Requester</span>\n              <span class=\"font-bold text-gray-900\">${escapeHtml(res.customer_name || res.user_name || 'Requester')}</span>\n              <span class=\"text-gray-500 block\">${escapeHtml(res.customer_email || res.user_email || '?')}</span>"
    replace3 = "<span class=\"text-gray-400 block\">Requester</span>\n              <span class=\"font-bold text-gray-900\">${escapeHtml(res.customer_name || res.user_name || 'Requester')}</span>\n              <span class=\"text-gray-500 block\">${escapeHtml(res.customer_email || res.user_email || '?')}</span>\n              <span class=\"text-xs text-indigo-600 block font-medium mt-1\">Account Type: ${escapeHtml(res.customer_account_type || res.account_type || 'Student')}</span>"

    content = content.replace(find1, replace1)
    content = content.replace(find2, replace2)
    content = content.replace(find3, replace3)
    
    with open(js_file, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Patched {js_file}")

