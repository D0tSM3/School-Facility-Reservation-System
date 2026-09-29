import os

def redesign_staff():
    # 1. Grab standard head, sidebar, header
    with open("public/dashboard.html", "r", encoding="utf-8") as f:
        dashboard = f.read()

    head = dashboard.split('<body')[0]
    body_start = '<body class="bg-[#F8F9FA] font-sans text-gray-900 antialiased min-h-screen">'
    sidebar_header = dashboard.split('<main')[0].split('<body')[1].replace('class="bg-[#F8F9FA] font-sans text-gray-900 antialiased min-h-screen">', '')

    with open("public/staff-queue.html", "r", encoding="utf-8") as f:
        staff = f.read()

    # Extract the main and modals from staff-queue.html
    main_content = staff.split('<main')[1].split('</main>')[0]
    main_content = '<main' + main_content + '</main>'
    
    # Extract modals (everything after </main> and before <script src="js/app.js">)
    modals = staff.split('</main>')[1].split('<script src="js/app.js">')[0]
    
    # Extract scripts
    scripts = '<script src="js/app.js">' + staff.split('<script src="js/app.js">')[1]

    # Combine
    full_html = head + body_start + sidebar_header + main_content + modals + scripts

    # Now define replacements for classes
    replacements = {
        'bg-surface-container-lowest': 'bg-white',
        'bg-surface-container-highest': 'bg-gray-100',
        'bg-surface-container': 'bg-[#f8f9fb]',
        'bg-background': 'bg-[#f8f9fb]',
        'bg-tertiary': 'bg-[#7a1f2b]',
        'text-on-surface-variant': 'text-gray-500',
        'text-on-surface': 'text-gray-900',
        'text-on-tertiary': 'text-white',
        'text-primary': 'text-gray-900',
        'text-outline-variant': 'text-gray-300',
        'text-outline': 'text-gray-400',
        'font-headline-lg': 'text-2xl sm:text-3xl font-bold',
        'text-headline-lg': '',
        'font-headline-sm': 'text-lg font-bold',
        'text-headline-sm': '',
        'font-label-lg': 'text-sm font-semibold',
        'text-label-lg': '',
        'font-label-md': 'text-xs font-semibold',
        'text-label-md': '',
        'font-label-sm': 'text-[10px] font-bold uppercase tracking-wider',
        'text-label-sm': '',
        'font-body-md': 'text-sm',
        'text-body-md': '',
        'font-body-sm': 'text-xs',
        'text-body-sm': '',
        'p-space-lg': 'p-8',
        'p-space-md': 'p-5',
        'p-space-sm': 'p-3',
        'p-space-xs': 'p-2',
        'px-space-lg': 'px-8',
        'px-space-md': 'px-4',
        'px-space-sm': 'px-3',
        'px-space-xs': 'px-2',
        'py-space-lg': 'py-8',
        'py-space-md': 'py-4',
        'py-space-sm': 'py-2',
        'py-space-xs': 'py-1',
        'pb-space-lg': 'pb-8',
        'pb-space-sm': 'pb-3',
        'mb-space-lg': 'mb-8',
        'mb-space-sm': 'mb-4',
        'mb-space-xs': 'mb-2',
        'gap-space-lg': 'gap-6',
        'gap-space-md': 'gap-4',
        'gap-space-sm': 'gap-3',
        'gap-space-xs': 'gap-2',
        'space-y-space-md': 'space-y-4',
        'space-y-space-sm': 'space-y-3',
        'space-y-space-xs': 'space-y-2',
        'bg-primary-container': 'bg-[#7a1f2b]',
        'bg-primary': 'bg-[#5b0617]',
        'text-on-primary': 'text-white',
        'bg-error': 'bg-red-600',
        'text-on-error': 'text-white',
        'hover:bg-error-container': 'hover:bg-red-50',
        'text-error': 'text-red-600',
        'bg-secondary-fixed': 'bg-[#FDF2F4]',
        'text-on-secondary-fixed': 'text-[#7a1f2b]',
        'bg-secondary-fixed-dim': 'bg-emerald-500',
        'text-secondary': 'text-[#7a1f2b]',
        'bg-primary-fixed': 'bg-green-100',
        'text-on-primary-fixed': 'text-green-700',
        'bg-error-container': 'bg-red-100',
        'text-on-error-container': 'text-red-700'
    }

    # Apply to HTML
    for old, new in replacements.items():
        full_html = full_html.replace(old, new)
        
    # Clean up empty class spaces
    full_html = full_html.replace('class=" "', 'class=""').replace('  ', ' ')

    with open("public/staff-queue.html", "w", encoding="utf-8") as f:
        f.write(full_html)


    # Now apply to JS
    with open("public/js/staff-queue.js", "r", encoding="utf-8") as f:
        js_content = f.read()
        
    for old, new in replacements.items():
        js_content = js_content.replace(old, new)
        
    # Fix ACTIVE_TAB_CLASSES
    js_content = js_content.replace(
        "const ACTIVE_TAB_CLASSES = ['bg-white', 'text-gray-900', 'shadow-sm'];",
        "const ACTIVE_TAB_CLASSES = ['bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold'];\n  const INACTIVE_TAB_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'font-medium'];"
    )
    js_content = js_content.replace(
        "tabEl.classList.toggle('text-gray-500', !active);",
        "INACTIVE_TAB_CLASSES.forEach((cls) => tabEl.classList.toggle(cls, !active));"
    )

    with open("public/js/staff-queue.js", "w", encoding="utf-8") as f:
        f.write(js_content)

redesign_staff()
