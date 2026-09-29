import os

# The script and style to inject into every HTML head
fouc_fix = """
  <!-- FOUC Preventer -->
  <script>
    (function() {
      const role = localStorage.getItem('campus_role');
      if (role) {
        document.documentElement.setAttribute('data-role', role.toLowerCase());
      }
    })();
  </script>
  <style>
    /* Prevent sidebar flash */
    html[data-role="staff"] aside nav a[data-path="customer-dashboard"],
    html[data-role="staff"] aside nav a[data-path="rooms"],
    html[data-role="staff"] aside nav a[data-path="my-reservations"],
    html[data-role="admin"] aside nav a[data-path="customer-dashboard"],
    html[data-role="admin"] aside nav a[data-path="rooms"],
    html[data-role="admin"] aside nav a[data-path="my-reservations"] {
      display: none !important;
    }
    
    html[data-role="staff"] aside nav a[data-path="staff-dashboard"],
    html[data-role="admin"] aside nav a[data-path="staff-dashboard"] {
      display: flex !important;
    }
    
    html[data-role="admin"] aside nav a[data-path="admin-governance"] {
      display: flex !important;
    }
  </style>
"""

# 1. Update all HTML files
for filename in os.listdir("public"):
    if not filename.endswith(".html"):
        continue
    
    filepath = os.path.join("public", filename)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Avoid double injection
    if "<!-- FOUC Preventer -->" not in content:
        # Inject right before </head>
        content = content.replace('</head>', fouc_fix + '\n </head>')

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

# 2. Update auth.js to set localStorage on login
with open("public/js/auth.js", "r", encoding="utf-8") as f:
    auth_js = f.read()

if "localStorage.setItem('campus_role'" not in auth_js:
    # Inject it before the window.location.href redirects
    auth_js = auth_js.replace("if (payload.role === 'Admin') {", "localStorage.setItem('campus_role', payload.role);\n            if (payload.role === 'Admin') {")
    with open("public/js/auth.js", "w", encoding="utf-8") as f:
        f.write(auth_js)

# 3. Update app.js to clear localStorage on logout or session failure
with open("public/js/app.js", "r", encoding="utf-8") as f:
    app_js = f.read()

if "localStorage.removeItem('campus_role')" not in app_js:
    # Clear on auth failure
    app_js = app_js.replace("// No active session", "localStorage.removeItem('campus_role');\n        // No active session")
    # Clear on manual logout success
    app_js = app_js.replace(".then(() => { window.location.href = 'index.html'; })", ".then(() => { localStorage.removeItem('campus_role'); window.location.href = 'index.html'; })")
    # Clear on manual logout failure
    app_js = app_js.replace("console.error(err);\n          window.location.href = 'index.html';", "console.error(err);\n          localStorage.removeItem('campus_role');\n          window.location.href = 'index.html';")
    
    with open("public/js/app.js", "w", encoding="utf-8") as f:
        f.write(app_js)

