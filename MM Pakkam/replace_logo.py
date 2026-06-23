import os
import re

svg = """<svg viewBox="0 0 100 100" width="32" height="32" xmlns="http://www.w3.org/2000/svg" style="z-index: 2; position: relative;">
  <mask id="crossMask">
    <rect width="100" height="100" fill="white" />
    <path d="M 41 33 h 18 v 34 h -18 z M 33 41 h 34 v 18 h -34 z" fill="black" rx="2" />
    <line x1="15" y1="15" x2="85" y2="85" stroke="black" stroke-width="2" stroke-linecap="round" />
    <line x1="15" y1="85" x2="85" y2="15" stroke="black" stroke-width="2" stroke-linecap="round" />
  </mask>
  <g mask="url(#crossMask)" fill="#ffffff">
    <path d="M 50 50 L 28 28 A 15.55 15.55 0 0 1 50 6 A 15.55 15.55 0 0 1 72 28 Z" />
    <path d="M 50 50 L 72 28 A 15.55 15.55 0 0 1 94 50 A 15.55 15.55 0 0 1 72 72 Z" />
    <path d="M 50 50 L 72 72 A 15.55 15.55 0 0 1 50 94 A 15.55 15.55 0 0 1 28 72 Z" />
    <path d="M 50 50 L 28 72 A 15.55 15.55 0 0 1 6 50 A 15.55 15.55 0 0 1 28 28 Z" />
  </g>
</svg>"""

directory = "."

for root, _, files in os.walk(directory):
    for filename in files:
        if filename.endswith(".html"):
            filepath = os.path.join(root, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Replace inner text of logo-icon and brand-logo-icon
            content = re.sub(r'<div class="logo-icon">\s*(BW|MM|M)\s*</div>', f'<div class="logo-icon">{svg}</div>', content)
            content = re.sub(r'<div class="brand-logo-icon">\s*(BW|MM|M)\s*</div>', f'<div class="brand-logo-icon">{svg}</div>', content)
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Processed {filename}")
