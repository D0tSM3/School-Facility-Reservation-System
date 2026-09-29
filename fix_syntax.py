with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix the broken line in renderPending
broken_part = """)`
        : 'Batch Approve All Pending';
    }
    
  }"""
js = js.replace(broken_part, "\n  }")

# Check if there is a stray `)`
js = js.replace("    )`\n        : 'Batch Approve All Pending';\n    }\n    \n  }", "\n  }")

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
