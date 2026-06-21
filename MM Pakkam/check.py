content = open('live_report2.html', encoding='utf-8').read()

def check_balance(text):
    stack = []
    lines = text.split('\n')
    for i, line in enumerate(lines):
        for j, char in enumerate(line):
            if char in '{[(': 
                stack.append((char, i+1, j+1))
            elif char in '}])':
                if not stack:
                    print(f"Extra closing {char} at line {i+1}")
                else:
                    top = stack.pop()
                    expected = {'{': '}', '[': ']', '(': ')'}[top[0]]
                    if char != expected:
                        print(f"Mismatch at line {i+1}: expected {expected} but got {char}. Opened at line {top[1]}")
    for item in stack:
        print(f"Unclosed {item[0]} opened at line {item[1]}")

check_balance(content)
