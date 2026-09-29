import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Add a register link at the bottom of the right panel, before the "Secured by..." footer.
# Let's locate the exact spot
pattern = r'(<div class="mt-8 flex items-center justify-center gap-1.5 text-on-surface-variant opacity-70">)'

register_link = """<div class="mt-4 flex items-center justify-center">
              <p class="text-[14px] text-gray-600 font-medium">
                Don't have an account? 
                <a href="register.html" class="text-[#7a1f2b] font-bold hover:underline ml-1">Register</a>
              </p>
            </div>
            
            """

html = re.sub(pattern, register_link + r'\1', html)

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)
